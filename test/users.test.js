const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { hashPassword, verifyPassword } = require('../src/auth');
const { AppError } = require('../src/util/errors');
const users = require('../src/services/users');
const audit = require('../src/services/audit');

function setup() {
  const db = makeDb();
  const unit = Number(db.prepare("INSERT INTO units (name) VALUES ('Đại đội 1')").run().lastInsertRowid);
  const admin = Number(db.prepare(
    "INSERT INTO users (username, password_hash, full_name, unit_id, role) VALUES ('admin', ?, 'Admin', ?, 'admin')"
  ).run(hashPassword('x'), unit).lastInsertRowid);
  return { db, unit, admin };
}
const data = (o = {}) => ({ username: 'nva', full_name: 'Nguyễn Văn A', rank: 'Thượng úy', role: 'member', party_status: 'dang_vien', ...o });

test('createUser: mật khẩu tạm 8 ký tự, must_change_password=1, dùng được', () => {
  const { db, admin } = setup();
  const { id, tempPassword } = users.createUser(db, data(), admin);
  assert.equal(tempPassword.length, 8);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  assert.equal(u.must_change_password, 1);
  assert.ok(verifyPassword(tempPassword, u.password_hash));
  assert.equal(audit.list(db, {})[0].action, 'user_create');
});

test('createUser: trùng tên đăng nhập → AppError', () => {
  const { db, admin } = setup();
  users.createUser(db, data(), admin);
  assert.throws(() => users.createUser(db, data(), admin), (e) => e instanceof AppError && e.message === 'Tên đăng nhập đã tồn tại');
});

test('setActive: admin không tự khóa mình; không khóa admin hoạt động cuối cùng', () => {
  const { db, admin } = setup();
  assert.throws(() => users.setActive(db, admin, false, admin), AppError);
  const { id: other } = users.createUser(db, data({ username: 'admin2', role: 'admin' }), admin);
  // khóa admin2 bởi admin1: ok; sau đó còn đúng 1 admin
  users.setActive(db, other, false, admin);
  assert.equal(db.prepare('SELECT active FROM users WHERE id = ?').get(other).active, 0);
  users.setActive(db, other, true, admin);
  // manager không thể khóa admin cuối cùng
  const { id: mgr } = users.createUser(db, data({ username: 'mgr1', role: 'manager' }), admin);
  users.setActive(db, other, false, mgr);
  assert.throws(() => users.setActive(db, admin, false, mgr),
    (e) => e instanceof AppError && e.message === 'Phải còn ít nhất một chỉ huy (Admin) hoạt động');
});

test('updateUser: không hạ vai trò admin cuối cùng', () => {
  const { db, admin } = setup();
  assert.throws(() => users.updateUser(db, admin, data({ role: 'member' }), admin), AppError);
  users.updateUser(db, admin, data({ role: 'admin', full_name: 'Tên mới' }), admin);
  assert.equal(db.prepare('SELECT full_name FROM users WHERE id = ?').get(admin).full_name, 'Tên mới');
});

test('resetPassword đặt lại must_change_password=1', () => {
  const { db, admin } = setup();
  const { id } = users.createUser(db, data(), admin);
  db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(id);
  const pw = users.resetPassword(db, id, admin);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  assert.equal(u.must_change_password, 1);
  assert.ok(verifyPassword(pw, u.password_hash));
});

test('đơn vị: xóa đơn vị đang có người → AppError; đổi tên, tạo, xóa đơn vị trống', () => {
  const { db, unit, admin } = setup();
  assert.throws(() => users.deleteUnit(db, unit, admin), AppError);
  const id = users.createUnit(db, 'Đại đội 2', admin);
  users.updateUnit(db, id, 'Đại đội 3', admin);
  assert.ok(users.listUnits(db).some((u) => u.name === 'Đại đội 3'));
  users.deleteUnit(db, id, admin);
  assert.ok(!users.listUnits(db).some((u) => u.id === id));
});

test('listUsers: open_tasks, unit_name, includeInactive', () => {
  const { db, admin } = setup();
  const { id } = users.createUser(db, data(), admin);
  for (const st of ['chua_lam', 'dang_lam', 'hoan_thanh']) {
    const t = Number(db.prepare("INSERT INTO tasks (title, status) VALUES ('t', ?)").run(st).lastInsertRowid);
    db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)').run(t, id);
  }
  users.setActive(db, id, false, admin);
  assert.ok(!users.listUsers(db).some((u) => u.id === id));
  const u = users.listUsers(db, { includeInactive: true }).find((x) => x.id === id);
  assert.equal(u.open_tasks, 2);
  assert.equal(users.listUsers(db).find((x) => x.id === admin).unit_name, 'Đại đội 1');
});

test('settings: mặc định 5, đặt và đọc lại', () => {
  const { db } = setup();
  assert.equal(users.getSetting(db, 'overload_threshold', 5), 5);
  users.setSetting(db, 'overload_threshold', 7);
  assert.equal(users.getOverloadThreshold(db), 7);
});

test('audit.list: kèm full_name, phân trang', () => {
  const { db, admin } = setup();
  for (let i = 0; i < 3; i++) audit.log(db, admin, 'x', String(i), null);
  const rows = audit.list(db, { limit: 2, offset: 0 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].full_name, 'Admin');
  assert.equal(rows[0].target, '2');
  assert.equal(audit.list(db, { limit: 2, offset: 2 }).length, 1);
});

test('không xóa đơn vị còn hồ sơ quân nhân', () => {
  const db = makeDb();
  const u = Number(db.prepare("INSERT INTO units (name) VALUES ('ĐV')").run().lastInsertRowid);
  db.prepare("INSERT INTO soldiers (full_name, unit_id) VALUES ('A', ?)").run(u);
  assert.throws(() => users.deleteUnit(db, u, null), /hồ sơ quân nhân/);
});
