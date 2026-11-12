const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { migrate } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { AppError } = require('../src/util/errors');
const S = require('../src/services/soldiers');
const { RANKS, RANKS_WITHOUT_INTERVAL, SOLDIER_LABELS } = require('../src/util/ranks');

function mkUser(db, username) {
  return Number(db.prepare(
    "INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, 'member')"
  ).run(username, hashPassword('x12345678'), username).lastInsertRowid);
}

test('ranks và nhãn', () => {
  assert.equal(RANKS.length, 15);
  assert.deepEqual(RANKS_WITHOUT_INTERVAL, ['Quân nhân chuyên nghiệp', 'Công nhân viên quốc phòng']);
  assert.equal(SOLDIER_LABELS.status.da_ra_quan, 'Đã ra quân');
  assert.equal(SOLDIER_LABELS.milestoneKind.chuyen_dang, 'Chuyển Đảng chính thức');
});

test('migrate chạy hai lần không lỗi', () => {
  const db = makeDb();
  migrate(db);
  migrate(db);
  assert.ok(db.prepare('SELECT COUNT(*) c FROM soldiers').get());
});

test('tạo hồ sơ: họ tên bắt buộc, mặc định trạng thái', () => {
  const db = makeDb();
  assert.throws(() => S.createSoldier(db, { full_name: '  ' }, null), AppError);
  const id = S.createSoldier(db, { full_name: 'Nguyễn Văn An', rank: 'Binh nhì' }, null);
  const s = S.getSoldier(db, id);
  assert.equal(s.status, 'dang_cong_tac');
  assert.equal(s.rank, 'Binh nhì');
  assert.equal(s.party_state, 'khong');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='soldier_create'").get().c, 1);
});

test('validation ngày, cấp bậc, mã, đơn vị', () => {
  const db = makeDb();
  const bad = (d) => assert.throws(() => S.createSoldier(db, { full_name: 'A', ...d }, null), AppError);
  bad({ birth_date: '2000-02-30' });
  bad({ enlist_date: '01/02/2020' });
  bad({ rank: 'Đại tướng' });
  bad({ status: 'xyz' });
  bad({ gender: 'x' });
  bad({ unit_id: 9999 });
  bad({ party_join_date: '2022-05-01', party_official_date: '2022-01-01' });
  const id = S.createSoldier(db, { full_name: 'A', birth_date: '', rank: '', unit_id: '' }, null);
  assert.equal(S.getSoldier(db, id).birth_date, null);
});

test('party_state 4 trường hợp', () => {
  const db = makeDb();
  const mk = (d) => S.getSoldier(db, S.createSoldier(db, { full_name: 'X', ...d }, null)).party_state;
  assert.equal(mk({ party_join_date: '2020-01-01', party_official_date: '2021-01-01' }), 'dang_vien');
  assert.equal(mk({ party_join_date: '2020-01-01' }), 'du_bi');
  assert.equal(mk({ youth_join_date: '2015-03-26' }), 'doan_vien');
  assert.equal(mk({}), 'khong');
});

test('listSoldiers: q bỏ dấu, lọc, sắp theo đơn vị rồi họ tên', () => {
  const db = makeDb();
  const u0 = Number(db.prepare("INSERT INTO units (name) VALUES ('Đại đội 1')").run().lastInsertRowid);
  const u1 = Number(db.prepare("INSERT INTO units (name) VALUES ('Đại đội 2')").run().lastInsertRowid);
  const a = S.createSoldier(db, { full_name: 'Nguyễn Văn An', unit_id: u1, rank: 'Hạ sĩ', youth_join_date: '2015-03-26' }, null);
  S.createSoldier(db, { full_name: 'Trần Bình', unit_id: u0, position: 'Tiểu đội trưởng' }, null);
  S.createSoldier(db, { full_name: 'Lê Cường', unit_id: u0, status: 'da_ra_quan' }, null);
  assert.deepEqual(S.listSoldiers(db, { q: 'nguyen van' }).map((s) => s.id), [a]);
  assert.equal(S.listSoldiers(db, { q: 'tieu doi' }).length, 1);
  assert.deepEqual(S.listSoldiers(db, {}).map((s) => s.full_name), ['Lê Cường', 'Trần Bình', 'Nguyễn Văn An']);
  assert.equal(S.listSoldiers(db, { unit_id: u1 }).length, 1);
  assert.equal(S.listSoldiers(db, { rank: 'Hạ sĩ' }).length, 1);
  assert.equal(S.listSoldiers(db, { status: 'da_ra_quan' }).length, 1);
  assert.deepEqual(S.listSoldiers(db, { party: 'doan_vien' }).map((s) => s.id), [a]);
  assert.equal(S.listSoldiers(db, { party: 'khong' }).length, 2);
  assert.equal(S.listSoldiers(db, {})[0].unit_name, 'Đại đội 1');
});

test('updateSoldier làm mới updated_at, ghi nhật ký; không tìm thấy → lỗi', () => {
  const db = makeDb();
  const id = S.createSoldier(db, { full_name: 'A' }, null);
  db.prepare("UPDATE soldiers SET updated_at='2000-01-01 00:00:00' WHERE id=?").run(id);
  S.updateSoldier(db, id, { full_name: 'B', rank: 'Trung sĩ' }, null);
  const s = S.getSoldier(db, id);
  assert.equal(s.full_name, 'B');
  assert.notEqual(s.updated_at, '2000-01-01 00:00:00');
  assert.throws(() => S.updateSoldier(db, id, { full_name: '' }, null), AppError);
  assert.throws(() => S.updateSoldier(db, 999, { full_name: 'x' }, null), AppError);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='soldier_update'").get().c, 1);
});

test('xóa hồ sơ xóa bảng con', () => {
  const db = makeDb();
  const id = S.createSoldier(db, { full_name: 'A' }, null);
  db.prepare("INSERT INTO soldier_family (soldier_id, relation) VALUES (?, 'Cha')").run(id);
  db.prepare("INSERT INTO soldier_career (soldier_id, position) VALUES (?, 'x')").run(id);
  db.prepare("INSERT INTO soldier_awards (soldier_id, kind) VALUES (?, 'khen_thuong')").run(id);
  db.prepare("INSERT INTO soldier_leaves (soldier_id, kind) VALUES (?, 'phep')").run(id);
  db.prepare("INSERT INTO soldier_thoughts (soldier_id, content) VALUES (?, 'x')").run(id);
  S.deleteSoldier(db, id, null);
  for (const t of ['soldiers', 'soldier_family', 'soldier_career', 'soldier_awards', 'soldier_leaves', 'soldier_thoughts']) {
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c, 0, t);
  }
  assert.equal(S.getSoldier(db, id), null);
  assert.throws(() => S.deleteSoldier(db, id, null), AppError);
});

test('liên kết tài khoản', () => {
  const db = makeDb();
  const u = mkUser(db, 'u1');
  const a = S.createSoldier(db, { full_name: 'A' }, null);
  const b = S.createSoldier(db, { full_name: 'B' }, null);
  assert.equal(S.listUnlinked(db).length, 2);
  S.linkUser(db, a, u, null);
  assert.equal(S.findByUser(db, u).id, a);
  assert.equal(S.getSoldier(db, a).username, 'u1');
  assert.deepEqual(S.listUnlinked(db).map((s) => s.id), [b]);
  assert.throws(() => S.linkUser(db, b, u, null), /đã liên kết với hồ sơ khác/);
  assert.throws(() => S.linkUser(db, b, 9999, null), AppError);
  S.linkUser(db, a, u, null); // liên kết lại chính nó: không lỗi
  S.linkUser(db, a, null, null);
  assert.equal(S.findByUser(db, u), null);
  assert.ok(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='soldier_link'").get().c >= 2);
});

test('xóa tài khoản đã liên kết: hồ sơ còn, user_id NULL', () => {
  const db = makeDb();
  const u = mkUser(db, 'u2');
  const a = S.createSoldier(db, { full_name: 'A', user_id: u }, null);
  assert.equal(S.findByUser(db, u).id, a);
  db.prepare('DELETE FROM users WHERE id = ?').run(u);
  assert.equal(S.getSoldier(db, a).user_id, null);
});

test('thông báo riêng khi thiếu ngày vào Đảng; user_id không hợp lệ', () => {
  const db = makeDb();
  assert.throws(() => S.createSoldier(db, { full_name: 'A', party_official_date: '2022-01-01' }, null),
    /phải có ngày vào Đảng/);
  const id = S.createSoldier(db, { full_name: 'A' }, null);
  assert.throws(() => S.linkUser(db, id, 'abc', null), /Tài khoản không tồn tại/);
  assert.throws(() => S.createSoldier(db, { full_name: 'B', user_id: 'x' }, null), AppError);
});
