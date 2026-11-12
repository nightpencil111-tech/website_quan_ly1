// Kho mẫu văn bản Word: lưu mẫu (CSDL), 5 mẫu dựng sẵn, tạo văn bản từ mẫu.
const fs = require('node:fs');
const path = require('node:path');
const { AppError } = require('../util/errors');
const { fmtDate } = require('../util/date');
const audit = require('./audit');
const { getSoldier } = require('./soldiers');
const { FIELD_CATALOG, commonData, soldierData } = require('./docFields');
const { inspectTemplate, renderDocx, buildZip, safeFileName } = require('./docRender');

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ZIP_TYPE = 'application/zip';
const CATEGORIES = ['ke_hoach', 'bao_cao', 'dang', 'danh_sach', 'khac'];
const MODES = ['chung', 'tung_nguoi', 'danh_sach'];
const FIELD_TYPES = ['text', 'textarea', 'date'];
const CATALOG = new Set(FIELD_CATALOG.map((f) => f.code));
const LIST_LOOP = 'ds';
// Trường nhiều dòng `x` còn có mảng `x_doan` (mỗi dòng một phần tử) để mẫu lặp đoạn {#x_doan}{.}{/x_doan}:
// mỗi dòng thành một đoạn riêng, giữ căn đều và thụt đầu dòng của đoạn mẫu.
const PARA_SUFFIX = '_doan';
const MAX_FILE = 5 * 1024 * 1024;
const BUILTIN_DIR = path.join(__dirname, '..', '..', 'templates', 'builtin');

const mf = (code, label, type, required = false) => ({ code, label, type, required });
const SO = mf('so_van_ban', 'Số văn bản', 'text');
const TRICH_YEU = mf('trich_yeu', 'Trích yếu', 'text', true);
const NOI_DUNG = mf('noi_dung', 'Nội dung', 'textarea', true);
const NOI_NHAN = mf('noi_nhan', 'Nơi nhận', 'textarea');

const BUILTINS = [
  { key: 'ke_hoach', file: 'ke-hoach.docx', name: 'Kế hoạch', category: 'ke_hoach', mode: 'chung',
    manual_fields: [SO, TRICH_YEU, NOI_DUNG, NOI_NHAN] },
  { key: 'bao_cao', file: 'bao-cao.docx', name: 'Báo cáo', category: 'bao_cao', mode: 'chung',
    manual_fields: [SO, TRICH_YEU, NOI_DUNG, NOI_NHAN] },
  { key: 'bao_cao_chi_bo', file: 'bao-cao-chi-bo.docx', name: 'Báo cáo Chi bộ', category: 'dang', mode: 'chung',
    manual_fields: [SO, TRICH_YEU, mf('kinh_gui', 'Kính gửi', 'text'), NOI_DUNG, NOI_NHAN] },
  { key: 'danh_sach_quan_nhan', file: 'danh-sach-quan-nhan.docx', name: 'Danh sách quân nhân', category: 'danh_sach',
    mode: 'danh_sach', manual_fields: [SO, TRICH_YEU, NOI_NHAN] },
  { key: 'danh_sach_dang_vien', file: 'danh-sach-dang-vien.docx', name: 'Danh sách đảng viên', category: 'danh_sach',
    mode: 'danh_sach', manual_fields: [SO, TRICH_YEU, NOI_NHAN] },
];
const PARTY_LIST_KEY = 'danh_sach_dang_vien';

const readBuiltinFile = (def) => fs.readFileSync(path.join(BUILTIN_DIR, def.file));
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

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

function parseManual(json) {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Chuẩn hóa danh sách trường nhập tay: [{code, label, type, required}].
function normalizeManual(list) {
  if (list === undefined || list === null || list === '') return [];
  let arr = list;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { throw new AppError('Danh sách trường nhập tay không hợp lệ'); }
  }
  if (!Array.isArray(arr)) throw new AppError('Danh sách trường nhập tay không hợp lệ');
  const out = [];
  const seen = new Set();
  for (const f of arr) {
    const code = String((f && f.code) ?? '').trim();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(code)) {
      throw new AppError(`Mã trường nhập tay "${code}" không hợp lệ (chỉ chữ thường không dấu, chữ số và dấu _)`);
    }
    if (CATALOG.has(code) || code === LIST_LOOP) throw new AppError(`Mã trường nhập tay "${code}" trùng mã có sẵn`);
    if (seen.has(code)) throw new AppError(`Mã trường nhập tay "${code}" bị khai báo hai lần`);
    seen.add(code);
    const label = String(f.label ?? '').trim() || code;
    if (label.length > 120) throw new AppError(`Nhãn của trường "${code}" quá dài (tối đa 120 ký tự)`);
    const type = blank(f.type) ? 'text' : String(f.type);
    if (!FIELD_TYPES.includes(type)) throw new AppError(`Kiểu của trường "${label}" không hợp lệ`);
    const required = [true, 1, '1', 'true', 'on'].includes(f.required);
    out.push({ code, label, type, required });
  }
  for (const f of out) {
    if (f.type === 'textarea' && seen.has(f.code + PARA_SUFFIX)) {
      throw new AppError(`Mã trường nhập tay "${f.code + PARA_SUFFIX}" trùng mã tự sinh của trường nhiều dòng "${f.label}"`);
    }
  }
  return out;
}

function checkMeta(name, category, mode) {
  const n = String(name ?? '').trim();
  if (!n) throw new AppError('Tên mẫu không được để trống');
  if (n.length > 200) throw new AppError('Tên mẫu quá dài (tối đa 200 ký tự)');
  if (!CATEGORIES.includes(category)) throw new AppError('Nhóm mẫu không hợp lệ');
  if (!MODES.includes(mode)) throw new AppError('Chế độ mẫu không hợp lệ');
  return n;
}

// Kiểm tra file mẫu; trả về các mã chưa có trong danh mục và chưa khai báo nhập tay.
function checkFile(file, manual) {
  if (!Buffer.isBuffer(file) || file.length === 0) throw new AppError('Chưa chọn tệp mẫu Word (.docx)');
  if (file.length > MAX_FILE) throw new AppError('Tệp mẫu vượt quá 5MB');
  const r = inspectTemplate(file);
  if (r.errors.length) throw new AppError(r.errors.join('; '));
  return unknownTags(r, manual);
}

function unknownTags(r, manual) {
  const codes = new Set(manual.map((f) => f.code));
  return r.tags.filter((t) => t !== '.' && !CATALOG.has(t) && !codes.has(t) && !r.loops.includes(t));
}

function rowToTemplate(row) {
  return row ? { ...row, manual_fields: parseManual(row.manual_fields) } : null;
}

const META_COLS = 'id, name, category, mode, manual_fields, builtin_key, created_by, created_at, updated_at';

function listTemplates(db) {
  return db.prepare(`SELECT ${META_COLS} FROM doc_templates ORDER BY builtin_key IS NULL, id`).all().map(rowToTemplate);
}

function getTemplate(db, id) {
  return rowToTemplate(db.prepare(`SELECT ${META_COLS} FROM doc_templates WHERE id = ?`).get(id));
}

function getTemplateFile(db, id) {
  const row = db.prepare('SELECT file FROM doc_templates WHERE id = ?').get(id);
  if (!row) throw new AppError('Không tìm thấy mẫu văn bản');
  return Buffer.from(row.file);
}

function mustGet(db, id) {
  const row = db.prepare('SELECT * FROM doc_templates WHERE id = ?').get(id);
  if (!row) throw new AppError('Không tìm thấy mẫu văn bản');
  return row;
}

function seedBuiltins(db) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM doc_templates').get();
  if (c > 0) return;
  const ins = db.prepare(
    'INSERT INTO doc_templates (name, category, mode, file, manual_fields, builtin_key) VALUES (?, ?, ?, ?, ?, ?)'
  );
  tx(db, () => {
    for (const b of BUILTINS) {
      ins.run(b.name, b.category, b.mode, readBuiltinFile(b), JSON.stringify(b.manual_fields), b.key);
    }
  });
}

function createTemplate(db, data, actorId) {
  const category = data.category ?? 'khac';
  const mode = data.mode ?? 'chung';
  const name = checkMeta(data.name, category, mode);
  const manual = normalizeManual(data.manual_fields);
  const warnings = checkFile(data.file, manual);
  const id = tx(db, () => {
    const newId = Number(db.prepare(
      'INSERT INTO doc_templates (name, category, mode, file, manual_fields, created_by) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, category, mode, data.file, JSON.stringify(manual), actorId ?? null).lastInsertRowid);
    audit.log(db, actorId, 'doc_template_create', `doc_template:${newId}`, name);
    return newId;
  });
  return { id, warnings };
}

// Cập nhật tên/nhóm/chế độ/trường nhập tay; file tùy chọn (không gửi → giữ file cũ).
function updateTemplate(db, id, data, actorId) {
  const cur = mustGet(db, id);
  const category = data.category ?? cur.category;
  const mode = data.mode ?? cur.mode;
  const name = checkMeta(data.name ?? cur.name, category, mode);
  const manual = data.manual_fields === undefined ? parseManual(cur.manual_fields) : normalizeManual(data.manual_fields);
  const hasFile = data.file !== undefined && data.file !== null;
  const file = hasFile ? data.file : Buffer.from(cur.file);
  const warnings = hasFile ? checkFile(file, manual) : unknownTags(inspectTemplate(file), manual);
  tx(db, () => {
    db.prepare(
      `UPDATE doc_templates SET name = ?, category = ?, mode = ?, file = ?, manual_fields = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(name, category, mode, file, JSON.stringify(manual), id);
    audit.log(db, actorId, 'doc_template_update', `doc_template:${id}`, name + (hasFile ? ' (thay file)' : ''));
  });
  return { warnings };
}

function deleteTemplate(db, id, actorId) {
  const cur = mustGet(db, id);
  if (cur.builtin_key) throw new AppError('Không thể xóa mẫu dựng sẵn; đồng chí có thể dùng "Khôi phục mẫu gốc"');
  tx(db, () => {
    db.prepare('DELETE FROM doc_templates WHERE id = ?').run(id);
    audit.log(db, actorId, 'doc_template_delete', `doc_template:${id}`, cur.name);
  });
}

// Đưa mẫu dựng sẵn về bản gốc: file đọc lại từ đĩa, tên/nhóm/chế độ/trường nhập tay như lúc cài.
function restoreBuiltin(db, id, actorId) {
  const cur = mustGet(db, id);
  const def = BUILTINS.find((b) => b.key === cur.builtin_key);
  if (!def) throw new AppError('Mẫu này không phải mẫu dựng sẵn');
  const file = readBuiltinFile(def);
  tx(db, () => {
    db.prepare(
      `UPDATE doc_templates SET name = ?, category = ?, mode = ?, file = ?, manual_fields = ?, updated_at = datetime('now')
        WHERE id = ?`
    ).run(def.name, def.category, def.mode, file, JSON.stringify(def.manual_fields), id);
    audit.log(db, actorId, 'doc_template_restore', `doc_template:${id}`, def.name);
  });
}

function validIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Chỉ nhận các trường nhập tay đã khai báo; bắt buộc → báo lỗi nêu nhãn; ngày → dd/mm/yyyy.
function manualData(fields, manual) {
  const src = manual && typeof manual === 'object' ? manual : {};
  const out = {};
  for (const f of fields) {
    const raw = Object.hasOwn(src, f.code) ? src[f.code] : '';
    let v = raw === undefined || raw === null ? '' : String(raw);
    v = f.type === 'textarea' ? v.replace(/\r\n?/g, '\n').trim() : v.trim();
    if (f.required && !v) throw new AppError(`Chưa nhập "${f.label}"`);
    if (f.type === 'date' && v) {
      if (!validIsoDate(v)) throw new AppError(`"${f.label}" không phải ngày hợp lệ`);
      v = fmtDate(v);
    }
    out[f.code] = v;
  }
  for (const f of fields) {
    const key = f.code + PARA_SUFFIX;
    if (f.type === 'textarea' && !Object.hasOwn(out, key) && !CATALOG.has(key)) out[key] = paragraphs(out[f.code]);
  }
  return out;
}

// Chia nội dung nhiều dòng thành các đoạn; bỏ dòng trống ở cuối, giữ dòng trống ở giữa (đoạn trống).
function paragraphs(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+$/u, ''));
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}

// Hồ sơ đã chọn, theo thứ tự đơn vị rồi họ tên (như danh sách quân nhân).
function selectedSoldiers(db, soldierIds) {
  const ids = [...new Set((Array.isArray(soldierIds) ? soldierIds : [soldierIds])
    .map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  const rows = db.prepare(
    `SELECT s.id FROM soldiers s LEFT JOIN units un ON un.id = s.unit_id
      WHERE s.id IN (${ids.map(() => '?').join(', ')})
      ORDER BY COALESCE(un.name, '') COLLATE NOCASE, s.full_name COLLATE NOCASE, s.id`
  ).all(...ids);
  return rows.map((r) => getSoldier(db, r.id));
}

function generate(db, id, opts, actorId, today) {
  const tpl = mustGet(db, id);
  const { soldierIds, manual, ngay_thang: ngayThang } = opts || {};
  const fields = parseManual(tpl.manual_fields);
  const base = { ...commonData(db, today, { ngay_thang: ngayThang }), ...manualData(fields, manual) };
  const file = Buffer.from(tpl.file);
  let people = [];
  let result;
  if (tpl.mode === 'chung') {
    result = { fileName: safeFileName(`${tpl.name}.docx`), buffer: renderDocx(file, base), contentType: DOCX_TYPE };
  } else {
    people = selectedSoldiers(db, soldierIds);
    if (tpl.builtin_key === PARTY_LIST_KEY) {
      people = people.filter((s) => s.party_join_date);
      if (!people.length) throw new AppError('Chưa chọn quân nhân nào có ngày vào Đảng');
    }
    if (!people.length) throw new AppError('Chưa chọn quân nhân nào');
    if (tpl.mode === 'danh_sach') {
      const ds = people.map((s, i) => soldierData(s, i + 1));
      result = { fileName: safeFileName(`${tpl.name}.docx`), buffer: renderDocx(file, { ...base, [LIST_LOOP]: ds }), contentType: DOCX_TYPE };
    } else {
      const files = people.map((s, i) => {
        const d = soldierData(s, i + 1);
        return { name: `${tpl.name} - ${d.ho_ten}.docx`, buffer: renderDocx(file, { ...base, ...d }) };
      });
      result = files.length === 1
        ? { fileName: safeFileName(files[0].name), buffer: files[0].buffer, contentType: DOCX_TYPE }
        : { fileName: safeFileName(`${tpl.name}.zip`), buffer: buildZip(files), contentType: ZIP_TYPE };
    }
  }
  const ids = people.map((s) => s.id);
  audit.log(db, actorId, 'doc_generate', `doc_template:${tpl.id}`,
    `${tpl.name}; ${ids.length} người${ids.length ? `; id: ${ids.join(',')}` : ''}`);
  return result;
}

module.exports = {
  BUILTINS, CATEGORIES, MODES, FIELD_TYPES, DOCX_TYPE, ZIP_TYPE,
  seedBuiltins, listTemplates, getTemplate, getTemplateFile, createTemplate, updateTemplate, deleteTemplate,
  restoreBuiltin, generate, normalizeManual,
};
