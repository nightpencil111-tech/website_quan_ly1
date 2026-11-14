const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { migrate, seed } = require('../src/db');
const { verifyPassword } = require('../src/auth');

const TABLES = ['units', 'users', 'tasks', 'task_assignees', 'checklist_items', 'task_comments',
  'events', 'task_templates', 'recurring_rules', 'audit_log', 'settings', 'sessions', 'schema_version'];

test('openDb tạo đủ bảng và bật foreign_keys', () => {
  const db = makeDb();
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of TABLES) assert.ok(names.includes(t), 'thiếu bảng ' + t);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

test('migrate chạy hai lần không lỗi', () => {
  const db = makeDb();
  migrate(db);
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM schema_version').get().c, 6);
});

test('seed hai lần chỉ có 1 admin', () => {
  const db = makeDb();
  seed(db);
  seed(db);
  const admins = db.prepare("SELECT * FROM users WHERE username='admin'").all();
  assert.equal(admins.length, 1);
  assert.equal(admins[0].role, 'admin');
  assert.equal(admins[0].must_change_password, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM units').get().c, 1);
  assert.equal(db.prepare('SELECT name FROM units').get().name, 'Đại đội 1');
  assert.equal(verifyPassword('admin123', admins[0].password_hash), true);
  assert.equal(verifyPassword('sai', admins[0].password_hash), false);
});

test('CHECK constraint từ chối mã sai', () => {
  const db = makeDb();
  seed(db);
  assert.throws(() => db.prepare("INSERT INTO tasks (title, category, priority, status, created_by) VALUES ('x','khac','xx','chua_lam',1)").run());
});
