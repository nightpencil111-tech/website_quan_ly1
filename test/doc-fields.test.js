const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { AppError } = require('../src/util/errors');
const S = require('../src/services/soldiers');
const { createUnit } = require('../src/services/users');
const { getUnitInfo, saveUnitInfo } = require('../src/services/unitInfo');
const F = require('../src/services/docFields');

const COMMON = ['cap_tren', 'don_vi', 'dang_uy', 'chi_bo', 'dia_danh', 'ngay_thang', 'ngay', 'thang', 'nam',
  'nguoi_ky_chuc_vu', 'nguoi_ky_cap_bac', 'nguoi_ky_ho_ten', 'bi_thu_ho_ten'];
const PERSON = ['stt', 'ho_ten', 'ngay_sinh', 'gioi_tinh', 'cap_bac', 'chuc_vu', 'don_vi_qn', 'que_quan', 'noi_o',
  'dan_toc', 'ton_giao', 'van_hoa', 'chuyen_mon', 'nhap_ngu', 'ngay_vao_doan', 'ngay_vao_dang', 'ngay_chinh_thuc',
  'dang_doan', 'suc_khoe', 'sdt'];

test('vnDateLine', () => {
  assert.equal(F.vnDateLine('Đồng Nai', '2026-11-02'), 'Đồng Nai, ngày 2 tháng 11 năm 2026');
  assert.equal(F.vnDateLine('', '2026-01-05'), 'ngày 5 tháng 1 năm 2026');
});

test('FIELD_CATALOG đủ mã, có nhãn và ví dụ', () => {
  assert.deepEqual(F.FIELD_CATALOG.filter((f) => f.group === 'chung').map((f) => f.code), COMMON);
  assert.deepEqual(F.FIELD_CATALOG.filter((f) => f.group === 'quan_nhan').map((f) => f.code), PERSON);
  for (const f of F.FIELD_CATALOG) assert.ok(f.label && f.example, f.code);
});

test('unit info lưu/đọc/kiểm tra độ dài', () => {
  const db = makeDb();
  assert.equal(getUnitInfo(db).don_vi, '');
  assert.throws(() => saveUnitInfo(db, { don_vi: 'x'.repeat(121) }, null), (e) => e instanceof AppError && /Đơn vị/.test(e.message));
  saveUnitInfo(db, { don_vi: '  ĐẠI ĐỘI 3 ', dia_danh: 'Đồng Nai' }, null);
  const u = getUnitInfo(db);
  assert.equal(u.don_vi, 'ĐẠI ĐỘI 3');
  assert.equal(u.dia_danh, 'Đồng Nai');
  assert.equal(u.cap_tren, '');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='unit_info_settings'").get().c, 1);
});

test('commonData', () => {
  const db = makeDb();
  saveUnitInfo(db, { don_vi: 'ĐẠI ĐỘI 3', dia_danh: 'Đồng Nai', bi_thu_ho_ten: 'Lê Văn B' }, null);
  const c = F.commonData(db, '2026-11-02');
  assert.deepEqual(Object.keys(c).sort(), [...COMMON].sort());
  assert.equal(c.ngay_thang, 'Đồng Nai, ngày 2 tháng 11 năm 2026');
  assert.deepEqual([c.ngay, c.thang, c.nam], ['2', '11', '2026']);
  assert.equal(c.don_vi, 'ĐẠI ĐỘI 3');
  assert.equal(F.commonData(db, '2026-11-02', { ngay_thang: 'Hà Nội, ngày 1' }).ngay_thang, 'Hà Nội, ngày 1');
});

test('soldierData', () => {
  const db = makeDb();
  const unitId = createUnit(db, 'Đại đội 3', null);
  const id = S.createSoldier(db, {
    full_name: 'Nguyễn Văn An', birth_date: '2003-05-07', gender: 'nam', rank: 'Binh nhất', position: 'Chiến sĩ',
    unit_id: unitId, hometown: 'Đồng Nai', party_join_date: '2025-01-02', youth_join_date: '2019-03-26',
  }, null);
  const d = F.soldierData(S.getSoldier(db, id), 3);
  assert.deepEqual(Object.keys(d).sort(), [...PERSON].sort());
  assert.ok(!Object.keys(d).some((k) => /thought|hardship|tu_tuong/.test(k)));
  assert.equal(d.stt, '3');
  assert.equal(d.ngay_sinh, '07/05/2003');
  assert.equal(d.gioi_tinh, 'Nam');
  assert.equal(d.dang_doan, 'Đảng viên dự bị');
  assert.equal(d.ngay_vao_dang, '02/01/2025');
  assert.equal(d.ngay_chinh_thuc, '');
  assert.equal(d.don_vi_qn, 'Đại đội 3');
  for (const v of Object.values(d)) assert.equal(typeof v, 'string');
  const e = F.soldierData(S.getSoldier(db, S.createSoldier(db, { full_name: 'B' }, null)), 1);
  assert.equal(e.dang_doan, 'Quần chúng');
  for (const v of Object.values(e)) assert.equal(typeof v, 'string');
});
