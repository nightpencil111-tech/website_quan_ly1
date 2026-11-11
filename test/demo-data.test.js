const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { seed } = require('../src/db');
const { fillDemo } = require('../scripts/demo-data');
const { hashPassword } = require('../src/auth');
const tasks = require('../src/services/tasks');

const REFUSE = /--force/;

test('demo: DB mới seed xong được chấp nhận và admin dùng được Demo@1234', () => {
  const db = makeDb();
  seed(db);
  fillDemo(db);
  const a = db.prepare("SELECT must_change_password FROM users WHERE username = 'admin'").get();
  assert.equal(a.must_change_password, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c >= 30);
});

test('demo: từ chối khi đã có công việc', () => {
  const db = makeDb();
  seed(db);
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES ('u1', ?, 'U', 'member')").run(hashPassword('x'));
  const u = db.prepare("SELECT id FROM users WHERE username = 'u1'").get();
  tasks.createTask(db, { title: 'T', due_date: '2030-01-01', assignee_ids: [u.id] }, admin.id);
  assert.throws(() => fillDemo(db), REFUSE);
});

test('demo: từ chối khi có tài khoản ngoài admin (chưa có việc)', () => {
  const db = makeDb();
  seed(db);
  db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES ('u1', ?, 'U', 'member')").run(hashPassword('x'));
  assert.throws(() => fillDemo(db), REFUSE);
});

test('demo: từ chối khi admin đã đổi mật khẩu', () => {
  const db = makeDb();
  seed(db);
  db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'admin'").run();
  assert.throws(() => fillDemo(db), REFUSE);
});

test('demo: --force chạy được và in cảnh báo đặt lại mật khẩu admin', () => {
  const db = makeDb();
  seed(db);
  db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'admin'").run();
  const lines = [];
  fillDemo(db, { force: true, log: (m) => lines.push(m) });
  assert.ok(lines.some((l) => l.includes('CẢNH BÁO') && l.includes('Demo@1234')));
});
