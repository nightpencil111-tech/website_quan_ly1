const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { hashPassword } = require('../src/auth');
const { AppError } = require('../src/util/errors');
const rec = require('../src/services/recurring');

function mkUser(db, username, role, active = 1) {
  return Number(db.prepare('INSERT INTO users (username, password_hash, full_name, role, active) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword('x'), `Họ ${username}`, role, active).lastInsertRowid);
}
function setup() {
  const db = makeDb();
  const admin = mkUser(db, 'ad', 'admin');
  const m = mkUser(db, 'm1', 'member');
  return { db, admin, m };
}
const weekly = (m, o = {}) => ({ title: 'Báo cáo tuần', category: 'cong_tac_dang', priority: 'thuong', assignee_ids: [m], frequency: 'tuan', day_value: 1, lead_days: 2, ...o });

test('nextOccurrence tuần và tháng', () => {
  assert.equal(rec.nextOccurrence({ frequency: 'tuan', day_value: 1 }, '2026-11-14'), '2026-11-16');
  assert.equal(rec.nextOccurrence({ frequency: 'tuan', day_value: 1 }, '2026-11-16'), '2026-11-16');
  assert.equal(rec.nextOccurrence({ frequency: 'tuan', day_value: 7 }, '2026-11-14'), '2026-11-15');
  assert.equal(rec.nextOccurrence({ frequency: 'thang', day_value: 31 }, '2026-11-10'), '2026-11-30');
  assert.equal(rec.nextOccurrence({ frequency: 'thang', day_value: 5 }, '2026-11-10'), '2026-12-05');
  assert.equal(rec.nextOccurrence({ frequency: 'thang', day_value: 31 }, '2026-11-30'), '2026-11-30');
  assert.equal(rec.nextOccurrence({ frequency: 'thang', day_value: 31 }, '2026-12-01'), '2026-12-31');
  assert.equal(rec.nextOccurrence({ frequency: 'thang', day_value: 30 }, '2027-02-01'), '2027-02-28');
});

test('hằng tuần Thứ Hai, lead 2: sinh 1 lần, không trùng', () => {
  const { db, admin, m } = setup();
  const rid = rec.createRule(db, weekly(m), admin);
  assert.equal(rec.generateDue(db, '2026-11-13'), 0);
  assert.equal(rec.generateDue(db, '2026-11-14'), 1);
  const t = db.prepare('SELECT * FROM tasks WHERE recurring_id = ?').all(rid);
  assert.equal(t.length, 1);
  assert.equal(t[0].due_date, '2026-11-16');
  assert.equal(t[0].created_by, admin);
  assert.equal(rec.generateDue(db, '2026-11-14'), 0);
  assert.equal(rec.generateDue(db, '2026-11-15'), 0);
  assert.equal(db.prepare('SELECT last_generated FROM recurring_rules WHERE id=?').get(rid).last_generated, '2026-11-16');
  // tuần sau sinh tiếp
  assert.equal(rec.generateDue(db, '2026-11-21'), 1);
});

test('hằng tháng ngày 31 → cuối tháng 11; không sinh quy tắc tắt', () => {
  const { db, admin, m } = setup();
  rec.createRule(db, weekly(m, { frequency: 'thang', day_value: 31, lead_days: 0 }), admin);
  const off = rec.createRule(db, weekly(m, { active: 0 }), admin);
  assert.equal(rec.generateDue(db, '2026-11-29'), 0);
  assert.equal(rec.generateDue(db, '2026-11-30'), 1);
  assert.equal(db.prepare("SELECT due_date FROM tasks WHERE recurring_id IS NOT NULL").get().due_date, '2026-11-30');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tasks WHERE recurring_id = ?').get(off).c, 0);
});

test('bỏ qua người bị khóa; không còn ai thì không sinh', () => {
  const { db, admin, m } = setup();
  const locked = mkUser(db, 'lk', 'member', 0);
  const rid = rec.createRule(db, weekly(m, { assignee_ids: [m, locked] }), admin);
  assert.equal(rec.generateDue(db, '2026-11-14'), 1);
  const ids = db.prepare('SELECT user_id FROM task_assignees').all().map((r) => r.user_id);
  assert.deepEqual(ids, [m]);
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(m);
  assert.equal(rec.generateDue(db, '2026-11-21'), 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tasks WHERE recurring_id = ?').get(rid).c, 1);
});

test('CRUD quy tắc, kiểm tra hợp lệ, nhật ký', () => {
  const { db, admin, m } = setup();
  assert.throws(() => rec.createRule(db, weekly(m, { day_value: 8 }), admin), AppError);
  assert.throws(() => rec.createRule(db, weekly(m, { frequency: 'nam' }), admin), AppError);
  assert.throws(() => rec.createRule(db, weekly(m, { title: ' ' }), admin), AppError);
  const id = rec.createRule(db, weekly(m), admin);
  assert.deepEqual(rec.getRule(db, id).assignee_ids, [m]);
  rec.updateRule(db, id, weekly(m, { title: 'Mới', day_value: 3, active: 0 }), admin);
  const r = rec.listRules(db)[0];
  assert.equal(r.title, 'Mới'); assert.equal(r.day_value, 3); assert.equal(r.active, 0);
  rec.deleteRule(db, id, admin);
  assert.equal(rec.listRules(db).length, 0);
  const acts = db.prepare('SELECT action FROM audit_log').all().map((x) => x.action);
  assert.deepEqual(acts, ['rule_create', 'rule_update', 'rule_delete']);
});
