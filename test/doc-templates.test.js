const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PizZip = require('pizzip');
const { makeDb } = require('./helpers');
const { makeDocx, docxText } = require('./helpers-docx');
const { seed } = require('../src/db');
const { AppError } = require('../src/util/errors');
const S = require('../src/services/soldiers');
const { createUnit } = require('../src/services/users');
const { saveUnitInfo } = require('../src/services/unitInfo');
const { FIELD_CATALOG } = require('../src/services/docFields');
const { inspectTemplate } = require('../src/services/docRender');
const T = require('../src/services/docTemplates');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CATALOG = new Set(FIELD_CATALOG.map((f) => f.code));
const KEYS = ['ke_hoach', 'bao_cao', 'bao_cao_chi_bo', 'danh_sach_quan_nhan', 'danh_sach_dang_vien'];
const MANUAL = {
  so_van_ban: '12/KH-ĐĐ', trich_yeu: 'Huấn luyện tháng 12', noi_dung: 'Dòng thứ nhất\nDòng thứ hai',
  noi_nhan: '- Tiểu đoàn;\n- Lưu.', kinh_gui: 'Đảng ủy Tiểu đoàn',
};

const byKey = (db, key) => T.listTemplates(db).find((t) => t.builtin_key === key);

function setup() {
  const db = makeDb();
  seed(db);
  saveUnitInfo(db, {
    cap_tren: 'TIỂU ĐOÀN 9', don_vi: 'ĐẠI ĐỘI 7', dang_uy: 'ĐẢNG ỦY TIỂU ĐOÀN 9', chi_bo: 'CHI BỘ ĐẠI ĐỘI 7',
    dia_danh: 'Xã Thử', nguoi_ky_chuc_vu: 'ĐẠI ĐỘI TRƯỞNG', nguoi_ky_cap_bac: 'Đại úy', nguoi_ky_ho_ten: 'Phạm Văn Ký',
    bi_thu_ho_ten: 'Hoàng Văn Thư',
  }, null);
  const u1 = createUnit(db, 'B Trung đội 2', null);
  const u2 = createUnit(db, 'A Trung đội 1', null);
  const ids = {
    dv: S.createSoldier(db, { full_name: 'Đỗ Văn Đảng', unit_id: u1, birth_date: '2000-01-02', party_join_date: '2024-02-03', party_official_date: '2025-02-03' }, null),
    db: S.createSoldier(db, { full_name: 'Bùi Văn Bị', unit_id: u2, party_join_date: '2025-06-07' }, null),
    qc: S.createSoldier(db, { full_name: 'Cao Văn Chúng', unit_id: u2, ethnicity: 'Tày' }, null),
  };
  return { db, ids };
}

test('seed hai lần -> đúng 5 mẫu dựng sẵn; getTemplate không kèm file', () => {
  const db = makeDb();
  seed(db);
  seed(db);
  const list = T.listTemplates(db);
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((t) => t.builtin_key).sort(), [...KEYS].sort());
  const t = T.getTemplate(db, byKey(db, 'ke_hoach').id);
  assert.equal(t.file, undefined);
  assert.ok(Array.isArray(t.manual_fields));
  assert.equal(t.mode, 'chung');
  assert.equal(byKey(db, 'danh_sach_quan_nhan').mode, 'danh_sach');
  assert.ok(Buffer.isBuffer(T.getTemplateFile(db, t.id)));
});

test('mẫu dựng sẵn: không lỗi, mọi mã thuộc danh mục hoặc trường nhập tay', () => {
  const { db } = setup();
  for (const key of KEYS) {
    const t = T.getTemplate(db, byKey(db, key).id);
    const r = inspectTemplate(T.getTemplateFile(db, t.id));
    assert.deepEqual(r.errors, [], key);
    const manual = new Set(t.manual_fields.map((f) => f.code));
    for (const tag of r.tags) assert.ok(CATALOG.has(tag) || manual.has(tag), `${key}: ${tag}`);
    for (const code of manual) assert.ok(r.tags.includes(code), `${key}: thiếu {${code}}`);
    if (t.mode === 'danh_sach') assert.deepEqual(r.loops, ['ds'], key);
    const trich = t.manual_fields.find((f) => f.code === 'trich_yeu');
    assert.equal(trich.required, true);
    assert.equal(trich.label, 'Trích yếu');
  }
});

test('generate từng mẫu dựng sẵn: không sót ngoặc, có dữ liệu đơn vị và người được chọn', () => {
  const { db, ids } = setup();
  const all = [ids.dv, ids.db, ids.qc];
  for (const key of KEYS) {
    const t = byKey(db, key);
    const out = T.generate(db, t.id, { soldierIds: all, manual: MANUAL }, null, '2026-11-12');
    assert.equal(out.contentType, DOCX);
    assert.equal(out.fileName, `${t.name}.docx`);
    const text = docxText(out.buffer);
    assert.ok(!/[{}]/.test(text), `${key}: ${text}`);
    assert.ok(text.includes('Xã Thử, ngày 12 tháng 11 năm 2026'), key);
    assert.ok(text.includes('Huấn luyện tháng 12'), key);
    if (key === 'bao_cao_chi_bo') {
      assert.ok(text.includes('CHI BỘ ĐẠI ĐỘI 7') && text.includes('Hoàng Văn Thư') && text.includes('Đảng ủy Tiểu đoàn'));
    } else {
      assert.ok(text.includes('ĐẠI ĐỘI 7') && text.includes('Đại úy Phạm Văn Ký'), key);
    }
    if (key === 'ke_hoach' || key === 'bao_cao') assert.ok(text.includes('Dòng thứ nhất\nDòng thứ hai'));
    if (key === 'danh_sach_quan_nhan') {
      // thứ tự đơn vị rồi họ tên, stt từ 1
      const order = ['Bùi Văn Bị', 'Cao Văn Chúng', 'Đỗ Văn Đảng'].map((n) => text.indexOf(n));
      assert.ok(order.every((i) => i > 0), key);
      assert.ok(order[0] < order[1] && order[1] < order[2], key);
      assert.ok(text.includes('1\nBùi Văn Bị') && text.includes('3\nĐỗ Văn Đảng'));
      assert.ok(text.includes('Tày'));
    }
    if (key === 'danh_sach_dang_vien') {
      assert.ok(text.includes('Đỗ Văn Đảng') && text.includes('Bùi Văn Bị'));
      assert.ok(!text.includes('Cao Văn Chúng'));
      assert.ok(text.includes('03/02/2024') && text.includes('03/02/2025'));
      assert.ok(text.includes('1\nBùi Văn Bị') && text.includes('2\nĐỗ Văn Đảng'));
    }
  }
  const logs = db.prepare("SELECT * FROM audit_log WHERE action='doc_generate' ORDER BY id").all();
  assert.equal(logs.length, 5);
  assert.match(logs[3].detail, /3 người/);
  assert.match(logs[4].detail, /2 người/);
  assert.match(logs[0].detail, /0 người/);
});

test('generate: kiểm tra trường bắt buộc, danh sách cần người, ghi đè ngày tháng', () => {
  const { db, ids } = setup();
  const kh = byKey(db, 'ke_hoach').id;
  assert.throws(() => T.generate(db, kh, { manual: { noi_dung: 'x' } }, null, '2026-11-12'),
    (e) => e instanceof AppError && /Trích yếu/.test(e.message));
  assert.throws(() => T.generate(db, kh, { manual: { trich_yeu: 'x', noi_dung: '   ' } }, null, '2026-11-12'),
    (e) => e instanceof AppError && /Nội dung/.test(e.message));
  const ds = byKey(db, 'danh_sach_quan_nhan').id;
  assert.throws(() => T.generate(db, ds, { soldierIds: [], manual: MANUAL }, null, '2026-11-12'),
    (e) => e instanceof AppError && /quân nhân/.test(e.message));
  const dv = byKey(db, 'danh_sach_dang_vien').id;
  assert.throws(() => T.generate(db, dv, { soldierIds: [ids.qc], manual: MANUAL }, null, '2026-11-12'),
    (e) => e instanceof AppError && /Đảng/.test(e.message));
  const out = T.generate(db, kh, { soldierIds: [ids.qc], manual: MANUAL, ngay_thang: 'Nơi khác, ngày 1 tháng 1 năm 2027' }, null, '2026-11-12');
  assert.ok(docxText(out.buffer).includes('Nơi khác, ngày 1 tháng 1 năm 2027'));
  assert.throws(() => T.generate(db, 99999, { manual: MANUAL }, null, '2026-11-12'), AppError);
});

test('tung_nguoi: 1 người -> docx; 2 người trùng tên -> zip 2 file khác tên; ngày nhập tay dd/mm/yyyy', () => {
  const { db } = setup();
  const a = S.createSoldier(db, { full_name: 'Lý Văn Trùng' }, null);
  const b = S.createSoldier(db, { full_name: 'Lý Văn Trùng' }, null);
  const { id, warnings } = T.createTemplate(db, {
    name: 'Giấy giới thiệu', category: 'khac', mode: 'tung_nguoi',
    file: makeDocx(['Đồng chí {ho_ten} – {don_vi}', 'Từ ngày {tu_ngay}']),
    manual_fields: [{ code: 'tu_ngay', label: 'Từ ngày', type: 'date', required: true }],
  }, null);
  assert.deepEqual(warnings, []);
  assert.throws(() => T.generate(db, id, { soldierIds: [a], manual: { tu_ngay: '2026-13-40' } }, null, '2026-11-12'),
    (e) => e instanceof AppError && /Từ ngày/.test(e.message));
  const one = T.generate(db, id, { soldierIds: [a], manual: { tu_ngay: '2026-12-01' } }, null, '2026-11-12');
  assert.equal(one.contentType, DOCX);
  assert.equal(one.fileName, 'Giấy giới thiệu - Lý Văn Trùng.docx');
  assert.equal(docxText(one.buffer), 'Đồng chí Lý Văn Trùng – ĐẠI ĐỘI 7\nTừ ngày 01/12/2026');
  const two = T.generate(db, id, { soldierIds: [a, b], manual: { tu_ngay: '2026-12-01' } }, null, '2026-11-12');
  assert.equal(two.contentType, 'application/zip');
  assert.equal(two.fileName, 'Giấy giới thiệu.zip');
  const names = Object.keys(new PizZip(two.buffer).files).sort();
  assert.deepEqual(names, ['Giấy giới thiệu - Lý Văn Trùng (2).docx', 'Giấy giới thiệu - Lý Văn Trùng.docx']);
  assert.throws(() => T.generate(db, id, { soldierIds: [], manual: { tu_ngay: '2026-12-01' } }, null, '2026-11-12'), AppError);
});

test('restoreBuiltin đưa file và trường nhập tay về bản gốc', () => {
  const { db } = setup();
  const t = byKey(db, 'bao_cao');
  const original = fs.readFileSync(path.join(__dirname, '..', 'templates', 'builtin', 'bao-cao.docx'));
  assert.ok(T.getTemplateFile(db, t.id).equals(original));
  T.updateTemplate(db, t.id, { name: 'Báo cáo sửa', file: makeDocx(['{trich_yeu}']), manual_fields: [] }, null);
  assert.equal(T.getTemplate(db, t.id).name, 'Báo cáo sửa');
  assert.ok(!T.getTemplateFile(db, t.id).equals(original));
  T.restoreBuiltin(db, t.id, null);
  assert.ok(T.getTemplateFile(db, t.id).equals(original));
  assert.equal(T.getTemplate(db, t.id).name, 'Báo cáo');
  assert.ok(T.getTemplate(db, t.id).manual_fields.some((f) => f.code === 'noi_dung'));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='doc_template_restore'").get().c, 1);
  const custom = T.createTemplate(db, { name: 'X', category: 'khac', mode: 'chung', file: makeDocx(['a']), manual_fields: [] }, null);
  assert.throws(() => T.restoreBuiltin(db, custom.id, null), AppError);
});

test('createTemplate/updateTemplate: lỗi cú pháp -> AppError; cảnh báo mã lạ; kiểm tra dữ liệu', () => {
  const { db } = setup();
  const adminId = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
  assert.throws(() => T.createTemplate(db, { name: 'Lỗi', category: 'khac', mode: 'chung', file: makeDocx(['{ho_ten']) }, null),
    (e) => e instanceof AppError && /thiếu dấu đóng/.test(e.message));
  assert.throws(() => T.createTemplate(db, { name: 'Rác', category: 'khac', mode: 'chung', file: Buffer.from('rác') }, null),
    (e) => e instanceof AppError && /không đúng định dạng/.test(e.message));
  assert.throws(() => T.createTemplate(db, { name: '  ', category: 'khac', mode: 'chung', file: makeDocx(['a']) }, null), AppError);
  assert.throws(() => T.createTemplate(db, { name: 'A', category: 'xyz', mode: 'chung', file: makeDocx(['a']) }, null), AppError);
  assert.throws(() => T.createTemplate(db, { name: 'A', category: 'khac', mode: 'xyz', file: makeDocx(['a']) }, null), AppError);
  assert.throws(() => T.createTemplate(db, {
    name: 'A', category: 'khac', mode: 'chung', file: makeDocx(['a']),
    manual_fields: [{ code: 'Sai Mã', label: 'x', type: 'text' }],
  }, null), AppError);
  const r = T.createTemplate(db, {
    name: 'Mẫu lạ', category: 'khac', mode: 'chung',
    file: makeDocx(['{ho_ten} {ma_la} {ghi_chu}']),
    manual_fields: [{ code: 'ghi_chu', label: 'Ghi chú', type: 'textarea' }],
  }, adminId);
  assert.deepEqual(r.warnings, ['ma_la']);
  const t = T.getTemplate(db, r.id);
  assert.deepEqual(t.manual_fields, [{ code: 'ghi_chu', label: 'Ghi chú', type: 'textarea', required: false }]);
  assert.equal(t.builtin_key, null);
  assert.equal(t.created_by, adminId);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='doc_template_create'").get().c, 1);
  const u = T.updateTemplate(db, r.id, { name: 'Mẫu lạ 2' }, null);
  assert.deepEqual(u.warnings, ['ma_la']);
  assert.equal(T.getTemplate(db, r.id).name, 'Mẫu lạ 2');
  assert.throws(() => T.updateTemplate(db, r.id, { file: makeDocx(['{#ds}']) }, null), AppError);
  T.deleteTemplate(db, r.id, null);
  assert.equal(T.getTemplate(db, r.id), null);
  assert.throws(() => T.deleteTemplate(db, byKey(db, 'ke_hoach').id, null), AppError);
  assert.equal(T.listTemplates(db).length, 5);
});
