const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { seed } = require('../src/db');
const { hashPassword, verifyPassword, login } = require('../src/auth');

test('hash rồi verify đúng/sai', () => {
  const h = hashPassword('matkhau123');
  assert.match(h, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword('matkhau123', h), true);
  assert.equal(verifyPassword('sai', h), false);
});

function setup() {
  const db = makeDb();
  seed(db);
  return db;
}

test('đăng nhập đúng tạo phiên', () => {
  const db = setup();
  const r = login(db, 'admin', 'admin123');
  assert.equal(r.ok, true);
  assert.ok(r.sessionId);
  assert.ok(db.prepare('SELECT 1 FROM sessions WHERE id=?').get(r.sessionId));
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='login'").get());
});

test('sai 5 lần thì khóa, lần 6 dù đúng vẫn bị từ chối', () => {
  const db = setup();
  for (let i = 0; i < 5; i++) {
    const r = login(db, 'admin', 'sai');
    assert.equal(r.ok, false);
  }
  const r = login(db, 'admin', 'admin123');
  assert.equal(r.ok, false);
  assert.match(r.error, /khóa/);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='login_fail'").get());
});

test('hết hạn khóa thì đăng nhập được và failed_logins về 0', () => {
  const db = setup();
  for (let i = 0; i < 5; i++) login(db, 'admin', 'sai');
  db.prepare("UPDATE users SET locked_until=? WHERE username='admin'").run(new Date(Date.now() - 60000).toISOString());
  const r = login(db, 'admin', 'admin123');
  assert.equal(r.ok, true);
  assert.equal(db.prepare("SELECT failed_logins AS f FROM users WHERE username='admin'").get().f, 0);
});

test('tài khoản active=0 không đăng nhập được', () => {
  const db = setup();
  db.prepare("UPDATE users SET active=0 WHERE username='admin'").run();
  const r = login(db, 'admin', 'admin123');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('tên đăng nhập không tồn tại', () => {
  const db = setup();
  assert.equal(login(db, 'khongco', 'x').ok, false);
});
