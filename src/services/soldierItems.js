const { AppError } = require('../util/errors');
const { SOLDIER_LABELS } = require('../util/ranks');
const audit = require('./audit');
const { validDate } = require('./soldiers');

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

// Cấu hình từng loại mục con: bảng, trường được phép ghi, trường bắt buộc, ngày, mã liệt kê, kiểm tra riêng.
const ITEM_TYPES = {
  family: {
    table: 'soldier_family', audit: 'family', label: 'Thân nhân',
    fields: ['relation', 'full_name', 'birth_year', 'job', 'address', 'hardship_note'],
    required: { relation: 'Quan hệ', full_name: 'Họ tên thân nhân' },
    order: 'id',
  },
  career: {
    table: 'soldier_career', audit: 'career', label: 'Quá trình công tác',
    fields: ['from_date', 'to_date', 'position', 'unit_text'],
    dates: { from_date: 'Từ ngày', to_date: 'Đến ngày' },
    range: ['from_date', 'to_date'],
    order: 'from_date, id',
  },
  award: {
    table: 'soldier_awards', audit: 'award', label: 'Khen thưởng, kỷ luật',
    fields: ['kind', 'date', 'form', 'reason', 'decision_no'],
    required: { kind: 'Loại' },
    dates: { date: 'Ngày' },
    enums: { kind: ['awardKind', 'Loại khen thưởng/kỷ luật'] },
    order: 'date, id',
  },
  leave: {
    table: 'soldier_leaves', audit: 'leave', label: 'Nghỉ phép',
    fields: ['kind', 'from_date', 'to_date', 'destination', 'note'],
    required: { kind: 'Loại nghỉ' },
    dates: { from_date: 'Từ ngày', to_date: 'Đến ngày' },
    enums: { kind: ['leaveKind', 'Loại nghỉ'] },
    range: ['from_date', 'to_date'],
    order: 'from_date, id',
  },
  thought: {
    table: 'soldier_thoughts', audit: 'thought', label: 'Tư tưởng',
    fields: ['date', 'content', 'level', 'measures'],
    required: { content: 'Nội dung' },
    dates: { date: 'Ngày' },
    enums: { level: ['thoughtLevel', 'Mức độ'] },
    defaults: { level: 'binh_thuong' },
    order: 'date, id',
  },
};

function cfg(type) {
  if (!Object.hasOwn(ITEM_TYPES, type)) throw new AppError('Loại mục không hợp lệ');
  return ITEM_TYPES[type];
}

// Chỉ lấy trường khai báo trong cấu hình, chuẩn hóa rỗng → null, kiểm tra.
function normalize(c, data) {
  const out = {};
  for (const k of c.fields) {
    let v = blank(data[k]) ? null : String(data[k]).trim();
    if (v === null && c.defaults && c.defaults[k]) v = c.defaults[k];
    out[k] = v;
  }
  for (const [k, label] of Object.entries(c.required || {})) {
    if (out[k] === null) throw new AppError(`${label} không được để trống`);
  }
  for (const [k, label] of Object.entries(c.dates || {})) {
    if (out[k] !== null && !validDate(out[k])) throw new AppError(`${label} không hợp lệ`);
  }
  for (const [k, [labelKey, label]] of Object.entries(c.enums || {})) {
    if (out[k] !== null && !Object.hasOwn(SOLDIER_LABELS[labelKey], out[k])) throw new AppError(`${label} không hợp lệ`);
  }
  if (c.range) {
    const [a, b] = c.range;
    if (out[a] && out[b] && out[b] < out[a]) throw new AppError('Ngày kết thúc không được trước ngày bắt đầu');
  }
  return out;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function listItems(db, type, soldierId) {
  const c = cfg(type);
  return db.prepare(`SELECT * FROM ${c.table} WHERE soldier_id = ? ORDER BY ${c.order}`).all(soldierId);
}

function getItem(db, type, itemId) {
  const c = cfg(type);
  return db.prepare(`SELECT * FROM ${c.table} WHERE id = ?`).get(itemId) ?? null;
}

function addItem(db, type, soldierId, data, actorId) {
  const c = cfg(type);
  if (!db.prepare('SELECT 1 FROM soldiers WHERE id = ?').get(soldierId)) throw new AppError('Không tìm thấy hồ sơ');
  const f = normalize(c, data);
  const cols = [...c.fields];
  const vals = c.fields.map((k) => f[k]);
  if (type === 'thought') { cols.push('recorded_by'); vals.push(actorId ?? null); }
  return tx(db, () => {
    const id = Number(db.prepare(
      `INSERT INTO ${c.table} (soldier_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
    ).run(soldierId, ...vals).lastInsertRowid);
    audit.log(db, actorId, `soldier_${c.audit}_create`, `soldier:${soldierId}`, `${c.label} #${id}`);
    return id;
  });
}

function updateItem(db, type, itemId, data, actorId) {
  const c = cfg(type);
  const cur = getItem(db, type, itemId);
  if (!cur) throw new AppError('Không tìm thấy mục');
  const f = normalize(c, { ...cur, ...data });
  tx(db, () => {
    db.prepare(`UPDATE ${c.table} SET ${c.fields.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...c.fields.map((k) => f[k]), itemId);
    audit.log(db, actorId, `soldier_${c.audit}_update`, `soldier:${cur.soldier_id}`, `${c.label} #${itemId}`);
  });
}

function deleteItem(db, type, itemId, actorId) {
  const c = cfg(type);
  const cur = getItem(db, type, itemId);
  if (!cur) throw new AppError('Không tìm thấy mục');
  tx(db, () => {
    db.prepare(`DELETE FROM ${c.table} WHERE id = ?`).run(itemId);
    audit.log(db, actorId, `soldier_${c.audit}_delete`, `soldier:${cur.soldier_id}`, `${c.label} #${itemId}`);
  });
}

module.exports = { ITEM_TYPES, listItems, getItem, addItem, updateItem, deleteItem };
