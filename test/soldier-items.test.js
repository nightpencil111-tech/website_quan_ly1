const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { AppError } = require('../src/util/errors');
const S = require('../src/services/soldiers');
const I = require('../src/services/soldierItems');

function setup() {
  const db = makeDb();
  const sid = S.createSoldier(db, { full_name: 'Nguyễn Văn An' }, null);
  const other = S.createSoldier(db, { full_name: 'Trần Văn Bình' }, null);
  return { db, sid, other };
}
const audits = (db, a) => db.prepare('SELECT COUNT(*) c FROM audit_log WHERE action = ?').get(a).c;

test('ITEM_TYPES có đủ 5 loại', () => {
  assert.deepEqual(Object.keys(I.ITEM_TYPES).sort(), ['award', 'career', 'family', 'leave', 'thought']);
});

test('family: thêm/sửa/xóa, bắt buộc relation và full_name', () => {
  const { db, sid } = setup();
  assert.throws(() => I.addItem(db, 'family', sid, { relation: 'Cha' }, 1), AppError);
  assert.throws(() => I.addItem(db, 'family', sid, { full_name: 'A' }, 1), AppError);
  const id = I.addItem(db, 'family', sid, { relation: 'Cha', full_name: 'Nguyễn Văn B', hardship_note: 'khó khăn' }, null);
  assert.equal(I.getItem(db, 'family', id).soldier_id, sid);
  I.updateItem(db, 'family', id, { relation: 'Cha', full_name: 'Nguyễn Văn C', job: 'Nông' }, null);
  assert.equal(I.getItem(db, 'family', id).full_name, 'Nguyễn Văn C');
  assert.equal(I.listItems(db, 'family', sid).length, 1);
  I.deleteItem(db, 'family', id, null);
  assert.equal(I.getItem(db, 'family', id), null);
  assert.equal(audits(db, 'soldier_family_create'), 1);
  assert.equal(audits(db, 'soldier_family_update'), 1);
  assert.equal(audits(db, 'soldier_family_delete'), 1);
});

test('career: to_date >= from_date, ngày hợp lệ', () => {
  const { db, sid } = setup();
  assert.throws(() => I.addItem(db, 'career', sid, { from_date: '2024-05-01', to_date: '2024-04-01' }, 1), AppError);
  assert.throws(() => I.addItem(db, 'career', sid, { from_date: '2024-13-01' }, 1), AppError);
  const id = I.addItem(db, 'career', sid, { from_date: '2024-01-01', to_date: '2024-05-01', position: 'Chiến sĩ' }, null);
  assert.throws(() => I.updateItem(db, 'career', id, { from_date: '2024-06-01', to_date: '2024-05-01' }, null), AppError);
  I.updateItem(db, 'career', id, { from_date: '2024-01-01', position: 'Tiểu đội phó' }, null);
  assert.equal(I.getItem(db, 'career', id).position, 'Tiểu đội phó');
  I.deleteItem(db, 'career', id, null);
  assert.equal(audits(db, 'soldier_career_delete'), 1);
});

test('award: kind đúng mã', () => {
  const { db, sid } = setup();
  assert.throws(() => I.addItem(db, 'award', sid, { kind: 'xyz' }, 1), AppError);
  assert.throws(() => I.addItem(db, 'award', sid, {}, 1), AppError);
  const id = I.addItem(db, 'award', sid, { kind: 'khen_thuong', date: '2025-01-02', form: 'Giấy khen' }, null);
  I.updateItem(db, 'award', id, { kind: 'ky_luat', date: '2025-01-02' }, null);
  assert.equal(I.getItem(db, 'award', id).kind, 'ky_luat');
  I.deleteItem(db, 'award', id, null);
  assert.equal(I.listItems(db, 'award', sid).length, 0);
});

test('leave: to<from lỗi, kind đúng mã', () => {
  const { db, sid } = setup();
  assert.throws(() => I.addItem(db, 'leave', sid, { kind: 'phep', from_date: '2026-03-10', to_date: '2026-03-09' }, 1), AppError);
  assert.throws(() => I.addItem(db, 'leave', sid, { kind: 'nghi', from_date: '2026-03-10' }, 1), AppError);
  const id = I.addItem(db, 'leave', sid, { kind: 'phep', from_date: '2026-03-10', to_date: '2026-03-12' }, null);
  I.updateItem(db, 'leave', id, { kind: 'tranh_thu', from_date: '2026-03-10', to_date: '2026-03-12' }, null);
  assert.equal(I.getItem(db, 'leave', id).kind, 'tranh_thu');
  I.deleteItem(db, 'leave', id, null);
  assert.equal(audits(db, 'soldier_leave_create'), 1);
});

test('thought: content bắt buộc, level đúng mã, recorded_by = actor', () => {
  const { db, sid } = setup();
  const u = Number(db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES ('cb','x','CB','admin')").run().lastInsertRowid);
  assert.throws(() => I.addItem(db, 'thought', sid, { content: ' ' }, u), AppError);
  assert.throws(() => I.addItem(db, 'thought', sid, { content: 'a', level: 'sai' }, u), AppError);
  const id = I.addItem(db, 'thought', sid, { content: 'Tư tưởng ổn', level: 'can_quan_tam', recorded_by: 999 }, u);
  assert.equal(I.getItem(db, 'thought', id).recorded_by, u);
  I.updateItem(db, 'thought', id, { content: 'Đã tốt hơn', level: 'binh_thuong' }, null);
  const t = I.getItem(db, 'thought', id);
  assert.equal(t.content, 'Đã tốt hơn');
  assert.equal(t.recorded_by, u);
  I.deleteItem(db, 'thought', id, u);
  assert.equal(audits(db, 'soldier_thought_delete'), 1);
});

test('không mass-assign soldier_id; loại/mục không tồn tại báo lỗi', () => {
  const { db, sid, other } = setup();
  const id = I.addItem(db, 'family', sid, { relation: 'Mẹ', full_name: 'M', soldier_id: other }, null);
  assert.equal(I.getItem(db, 'family', id).soldier_id, sid);
  I.updateItem(db, 'family', id, { relation: 'Mẹ', full_name: 'M2', soldier_id: other }, null);
  assert.equal(I.getItem(db, 'family', id).soldier_id, sid);
  assert.throws(() => I.addItem(db, 'bogus', sid, {}, null), AppError);
  assert.throws(() => I.addItem(db, 'family', 9999, { relation: 'a', full_name: 'b' }, null), AppError);
  assert.throws(() => I.updateItem(db, 'family', 9999, { relation: 'a', full_name: 'b' }, null), AppError);
  assert.throws(() => I.deleteItem(db, 'family', 9999, null), AppError);
});

test('leaveDaysThisYear: phép vắt năm chỉ tính phần trong năm; bỏ tranh_thu; thiếu to_date = 1 ngày', () => {
  const { db, sid } = setup();
  I.addItem(db, 'leave', sid, { kind: 'phep', from_date: '2026-12-28', to_date: '2027-01-03' }, null);
  I.addItem(db, 'leave', sid, { kind: 'tranh_thu', from_date: '2026-05-01', to_date: '2026-05-10' }, null);
  const p = S.getProfile(db, sid, '2026-06-01');
  assert.equal(p.leaveDaysThisYear, 4);
  I.addItem(db, 'leave', sid, { kind: 'phep', from_date: '2025-12-30', to_date: '2026-01-02' }, null);
  I.addItem(db, 'leave', sid, { kind: 'phep', from_date: '2026-07-07' }, null);
  assert.equal(S.getProfile(db, sid, '2026-06-01').leaveDaysThisYear, 4 + 2 + 1);
});

test('getProfile: đủ khóa, null nếu không có hồ sơ', () => {
  const { db, sid } = setup();
  assert.equal(S.getProfile(db, 9999), null);
  const p = S.getProfile(db, sid);
  assert.deepEqual(Object.keys(p).sort(), ['awards', 'career', 'family', 'leaveDaysThisYear', 'leaves', 'soldier', 'thoughts']);
  assert.equal(p.soldier.id, sid);
});

test('redactForMember: bỏ thoughts + hardship_note, không sửa bản gốc', () => {
  const { db, sid } = setup();
  I.addItem(db, 'family', sid, { relation: 'Cha', full_name: 'B', hardship_note: 'HOANCANH_BI_MAT' }, null);
  I.addItem(db, 'thought', sid, { content: 'TUTUONG_BI_MAT' }, null);
  const p = S.getProfile(db, sid);
  const r = S.redactForMember(p);
  assert.ok(!('thoughts' in r));
  assert.ok(!('hardship_note' in r.family[0]));
  assert.equal(r.family[0].full_name, 'B');
  const js = JSON.stringify(r);
  assert.ok(!js.includes('TUTUONG_BI_MAT') && !js.includes('HOANCANH_BI_MAT'));
  assert.ok('thoughts' in p);
  assert.equal(p.family[0].hardship_note, 'HOANCANH_BI_MAT');
  assert.equal(p.thoughts.length, 1);
});
