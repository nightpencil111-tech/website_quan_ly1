// Xuất / nhập hồ sơ quân nhân bằng Excel (exceljs).
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { AppError } = require('../util/errors');
const { fold } = require('../util/text');
const { RANKS, SOLDIER_LABELS } = require('../util/ranks');
const { fmtDate } = require('../util/date');
const soldiers = require('./soldiers');
const audit = require('./audit');

const EXPORT_COLUMNS = ['STT', 'Họ tên', 'Ngày sinh', 'Cấp bậc', 'Chức vụ', 'Đơn vị', 'Nhập ngũ', 'Quê quán', 'Đảng/Đoàn', 'Trạng thái'];
const TEMPLATE_COLUMNS = [
  'Họ tên*', 'Ngày sinh', 'Giới tính', 'Cấp bậc', 'Ngày nhận cấp bậc', 'Chức vụ', 'Đơn vị', 'Ngày nhập ngũ',
  'Quê quán', 'Dân tộc', 'Tôn giáo', 'Văn hóa', 'SĐT', 'Ngày vào Đoàn', 'Ngày vào Đảng', 'Ngày chính thức',
];
// Trường dữ liệu tương ứng từng cột mẫu.
const TEMPLATE_FIELDS = [
  'full_name', 'birth_date', 'gender', 'rank', 'rank_date', 'position', 'unit', 'enlist_date',
  'hometown', 'ethnicity', 'religion', 'education', 'phone', 'youth_join_date', 'party_join_date', 'party_official_date',
];
const DATE_KEYS = new Set(['birth_date', 'rank_date', 'enlist_date', 'youth_join_date', 'party_join_date', 'party_official_date']);
const PARTY_LABEL = { dang_vien: 'Đảng viên', du_bi: 'Đảng viên dự bị', doan_vien: 'Đoàn viên', khong: '' };
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;
const DRAFT_MINUTES = 30;

async function toBuffer(wb) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function headerSheet(wb, name, columns, widths) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((header, i) => ({ header, width: widths ? widths[i] : 18 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

async function exportWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = headerSheet(wb, 'Danh sách trích ngang', EXPORT_COLUMNS, [6, 28, 12, 18, 22, 22, 12, 28, 18, 16]);
  rows.forEach((s, i) => ws.addRow([
    i + 1, s.full_name, fmtDate(s.birth_date), s.rank || '', s.position || '', s.unit_name || '',
    fmtDate(s.enlist_date), s.hometown || '', PARTY_LABEL[s.party_state ?? soldiers.partyState(s)] || '',
    SOLDIER_LABELS.status[s.status] || s.status || '',
  ]));
  return toBuffer(wb);
}

async function templateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = headerSheet(wb, 'Hồ sơ', TEMPLATE_COLUMNS, [24, 13, 10, 18, 16, 20, 20, 14, 26, 12, 12, 10, 14, 14, 14, 16]);
  // Dòng ví dụ hư cấu; để trống cột Đơn vị vì tên đơn vị phải khớp đơn vị đã có trong hệ thống.
  // Cột văn bản đặt định dạng Text để Excel không tự đổi "12/12" thành ngày hay bỏ số 0 đầu của SĐT.
  [9, 10, 11, 12, 13].forEach((c) => { ws.getColumn(c).numFmt = '@'; });
  ws.addRow([
    'Nguyễn Văn Mẫu', '15/08/2003', 'Nam', 'Binh nhì', '01/03/2023', 'Chiến sĩ', '', '01/03/2023',
    'Xã Ví Dụ, huyện Mẫu, tỉnh Giả Định', 'Kinh', 'Không', '12/12', '0900000000', '26/03/2019', '', '',
  ]);
  const g = wb.addWorksheet('Hướng dẫn');
  g.getColumn(1).width = 110;
  [
    'HƯỚNG DẪN NHẬP DANH SÁCH QUÂN NHÂN',
    '1. Điền dữ liệu ở sheet "Hồ sơ", mỗi quân nhân một dòng, bắt đầu từ dòng 2. Dòng 2 là dòng ví dụ hư cấu, đồng chí xóa hoặc sửa trước khi nhập.',
    '2. Chỉ cột "Họ tên*" là bắt buộc; các cột khác có thể để trống.',
    '3. Ngày nhập theo định dạng dd/mm/yyyy (ví dụ 05/03/2004), hoặc dùng ô ngày của Excel.',
    '4. Giới tính ghi "Nam" hoặc "Nữ".',
    '5. Cấp bậc ghi đúng một trong: ' + RANKS.join(', ') + '.',
    '6. Tên đơn vị phải trùng với đơn vị đã có trong hệ thống (không phân biệt hoa thường, dấu); đơn vị chưa có thì tạo trước ở mục quản trị.',
    '7. Hồ sơ trùng họ tên và ngày sinh với hồ sơ đã có (hoặc trùng ngay trong tệp) sẽ bị bỏ qua và được liệt kê ở bước xem trước.',
    '8. Các cột Quê quán, Dân tộc, Tôn giáo, Văn hóa, SĐT đã đặt sẵn định dạng Text: đồng chí nhập thẳng (ví dụ SĐT 0912345678, Văn hóa 12/12). Nếu dán thêm dòng ngoài vùng mẫu, hãy đặt các cột này về định dạng Text trước khi gõ để Excel không bỏ số 0 đầu hoặc đổi thành ngày.',
    '9. Tệp phải là .xlsx, dung lượng tối đa 2MB. Không nhập thông tin tư tưởng, hoàn cảnh gia đình qua tệp này.',
  ].forEach((line, i) => {
    const row = g.addRow([line]);
    row.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0) row.font = { bold: true };
  });
  return toBuffer(wb);
}

// ---- Đọc ô ----
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text ?? '').join('').trim();
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return cellText(v.text);
    if ('error' in v) return '';
  }
  return String(v).trim();
}

const iso = (d) => d.toISOString().slice(0, 10);

function toDateString(v) {
  if (v === '') return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'sai' : iso(v);
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return Number.isNaN(d.getTime()) ? 'sai' : iso(d);
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return s; // để normalize báo "không hợp lệ"
}

// Ô văn bản bị Excel tự đổi thành ngày: không bỏ đi mà hiển thị lại (Văn hóa -> d/m, trường khác -> dd/mm/yyyy).
function dateAsText(d, field) {
  if (Number.isNaN(d.getTime())) return '';
  if (field === 'education') return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

// SĐT gõ ở ô General thành số: trả lại chuỗi, thêm số 0 đầu khi còn 9 chữ số.
function phoneText(v) {
  const s = String(v);
  return typeof v === 'number' && /^\d{9}$/.test(s) ? '0' + s : s;
}

const dupKey = (name, birth) => `${fold(String(name).trim()).replace(/\s+/g, ' ')}|${birth || ''}`;

async function parseImport(db, buffer) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new AppError('Tệp không đúng định dạng Excel (.xlsx)');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('Tệp không đúng định dạng Excel (.xlsx)');

  // Ánh xạ cột theo tiêu đề; thiếu tiêu đề thì dùng đúng thứ tự cột của tệp mẫu.
  const colOf = {};
  const head = ws.getRow(1);
  TEMPLATE_FIELDS.forEach((f, i) => {
    const want = fold(TEMPLATE_COLUMNS[i].replace('*', '')).trim();
    let found = 0;
    for (let c = 1; c <= Math.max(ws.columnCount, TEMPLATE_COLUMNS.length); c++) {
      if (fold(String(cellText(head.getCell(c).value)).replace('*', '')).trim() === want) { found = c; break; }
    }
    colOf[f] = found || i + 1;
  });

  const units = db.prepare('SELECT id, name FROM units').all();
  const unitByName = new Map();
  for (const u of units) {
    const k = fold(u.name).trim();
    unitByName.set(k, [...(unitByName.get(k) || []), u]);
  }
  const seen = new Set();
  for (const s of db.prepare('SELECT full_name, birth_date FROM soldiers').all()) seen.add(dupKey(s.full_name, s.birth_date));

  const valid = [];
  const errors = [];
  const duplicates = [];
  const rowNums = [];
  ws.eachRow({ includeEmpty: false }, (_row, n) => { if (n >= 2) rowNums.push(n); });
  let filled = 0;
  for (const n of rowNums) {
    const row = ws.getRow(n);
    const raw = {};
    let any = false;
    for (const f of TEMPLATE_FIELDS) {
      const v = cellText(row.getCell(colOf[f]).value);
      raw[f] = v;
      if (v !== '') any = true;
    }
    if (!any) continue;
    if (++filled > MAX_ROWS) throw new AppError(`Tệp có quá nhiều dòng (tối đa ${MAX_ROWS} dòng)`);
    try {
      const input = {};
      for (const f of TEMPLATE_FIELDS) {
        if (f === 'unit' || f === 'gender' || f === 'rank') continue;
        if (DATE_KEYS.has(f)) input[f] = toDateString(raw[f]);
        else if (raw[f] instanceof Date) input[f] = dateAsText(raw[f], f);
        else input[f] = f === 'phone' ? phoneText(raw[f]) : String(raw[f]);
      }
      if (raw.gender !== '') {
        const g = fold(String(raw.gender)).trim();
        input.gender = g === 'nam' ? 'nam' : g === 'nu' ? 'nu' : null;
        if (!input.gender) throw new AppError('Giới tính phải là Nam hoặc Nữ');
      }
      if (raw.rank !== '') {
        const rk = RANKS.find((x) => fold(x) === fold(String(raw.rank)).trim().replace(/\s+/g, ' '));
        if (!rk) throw new AppError(`Cấp bậc "${raw.rank}" không hợp lệ`);
        input.rank = rk;
      }
      let unitName = '';
      if (raw.unit !== '') {
        const found = unitByName.get(fold(String(raw.unit)).trim()) || [];
        if (!found.length) throw new AppError(`Đơn vị "${raw.unit}" không tồn tại trong hệ thống`);
        if (found.length > 1) throw new AppError(`Tên đơn vị "${raw.unit}" trùng nhiều đơn vị, đề nghị đổi tên cho khác nhau`);
        const u = found[0];
        input.unit_id = u.id;
        unitName = u.name;
      }
      const f = soldiers.normalize(db, input);
      const key = dupKey(f.full_name, f.birth_date);
      if (seen.has(key)) {
        duplicates.push({ row: n, full_name: f.full_name });
        continue;
      }
      seen.add(key);
      valid.push({ ...f, row: n, unit_name: unitName });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      errors.push({ row: n, message: e.message });
    }
  }
  return { valid, errors, duplicates };
}

function purgeDrafts(db) {
  db.prepare('DELETE FROM import_drafts WHERE expires_at < ?').run(Date.now());
}

function saveDraft(db, userId, payload) {
  purgeDrafts(db);
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO import_drafts (id, user_id, payload, expires_at) VALUES (?, ?, ?, ?)')
    .run(id, userId, JSON.stringify(payload), Date.now() + DRAFT_MINUTES * 60 * 1000);
  return id;
}

// `kind`: loại bản nháp mong đợi (null = nhập hồ sơ quân nhân, không có trường kind; 'doc_template' = mẫu văn bản).
function getDraft(db, draftId, userId, kind = null) {
  const d = db.prepare('SELECT * FROM import_drafts WHERE id = ?').get(String(draftId));
  let payload = null;
  if (d && d.user_id === userId && d.expires_at >= Date.now()) {
    try { payload = JSON.parse(d.payload); } catch { payload = null; }
  }
  if (!payload || (payload.kind || null) !== kind) {
    throw new AppError('Bản xem trước không tồn tại hoặc đã hết hạn, đồng chí vui lòng tải tệp lên lại');
  }
  return payload;
}

function discardDraft(db, draftId, userId, kind = null) {
  try {
    getDraft(db, draftId, userId, kind);
  } catch {
    return;
  }
  db.prepare('DELETE FROM import_drafts WHERE id = ? AND user_id = ?').run(String(draftId), userId);
}

function commitImport(db, draftId, userId, actorId) {
  const payload = getDraft(db, draftId, userId);
  const rows = payload.valid || [];
  if (!rows.length) throw new AppError('Không có hồ sơ hợp lệ để nhập');
  let inserted = 0;
  let skipped = 0;
  db.exec('BEGIN');
  try {
    // Kiểm tra lại trùng ngay lúc nhập: CSDL có thể đã đổi từ khi xem trước.
    const seen = new Set(db.prepare('SELECT full_name, birth_date FROM soldiers').all().map((s) => dupKey(s.full_name, s.birth_date)));
    for (const r of rows) {
      const key = dupKey(r.full_name, r.birth_date);
      if (seen.has(key)) { skipped++; continue; }
      seen.add(key);
      soldiers.insertSoldier(db, r, actorId);
      inserted++;
    }
    audit.log(db, actorId, 'soldier_import', 'soldier', `${inserted} hồ sơ${skipped ? `, bỏ qua ${skipped} trùng` : ''}`);
    db.prepare('DELETE FROM import_drafts WHERE id = ?').run(String(draftId));
    db.prepare('DELETE FROM import_drafts WHERE expires_at < ?').run(Date.now());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { inserted, skipped };
}

module.exports = {
  EXPORT_COLUMNS, TEMPLATE_COLUMNS, MAX_BYTES, exportWorkbook, templateWorkbook, parseImport,
  saveDraft, getDraft, discardDraft, commitImport,
};
