const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { hashPassword } = require('../src/auth');
const { AppError } = require('../src/util/errors');
const tasks = require('../src/services/tasks');
const audit = require('../src/services/audit');

const TODAY = '2026-11-11';

function mkUser(db, username, role, active = 1) {
  const id = Number(db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, active) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hashPassword('x'), `Họ ${username}`, role, active).lastInsertRowid);
  return { id, role };
}

function setup() {
  const db = makeDb();
  const admin = mkUser(db, 'admin', 'admin');
  const manager = mkUser(db, 'mgr', 'manager');
  const m1 = mkUser(db, 'm1', 'member');
  const m2 = mkUser(db, 'm2', 'member');
  return { db, admin, manager, m1, m2 };
}
const mk = (db, by, assignees, o = {}) => tasks.createTask(db, {
  title: 'Việc A', category: 'khac', priority: 'thuong', due_date: '2026-11-20', assignee_ids: assignees, ...o,
}, by.id);

test('member đổi trạng thái: chỉ việc của mình, chỉ các bước được phép', () => {
  const { db, m1, m2, manager } = setup();
  const id = mk(db, manager, [m1.id]);
  assert.throws(() => tasks.changeStatus(db, id, 'dang_lam', m2), AppError);
  tasks.changeStatus(db, id, 'dang_lam', m1);
  assert.equal(tasks.getTask(db, id).status, 'dang_lam');
  assert.throws(() => tasks.changeStatus(db, id, 'hoan_thanh', m1), AppError);
  tasks.changeStatus(db, id, 'cho_duyet', m1, 'Đã xong phần việc');
  assert.equal(tasks.getTask(db, id).status, 'cho_duyet');
  assert.throws(() => tasks.changeStatus(db, id, 'cho_duyet', manager), AppError);
});

test('manager trả lại cần ghi chú; có ghi chú → comment tự động + audit', () => {
  const { db, m1, manager } = setup();
  const id = mk(db, manager, [m1.id], { status: undefined });
  tasks.changeStatus(db, id, 'dang_lam', m1);
  tasks.changeStatus(db, id, 'cho_duyet', m1);
  assert.throws(() => tasks.changeStatus(db, id, 'dang_lam', manager), AppError);
  assert.throws(() => tasks.changeStatus(db, id, 'dang_lam', manager, '   '), AppError);
  tasks.changeStatus(db, id, 'dang_lam', manager, 'Bổ sung số liệu');
  const t = tasks.getTask(db, id);
  assert.equal(t.status, 'dang_lam');
  assert.ok(t.comments.some((c) => c.content === 'Chuyển trạng thái: Chờ duyệt → Đang làm — Bổ sung số liệu'));
  assert.ok(audit.list(db, {}).some((a) => a.action === 'task_status'));
});

test('hoàn thành đặt completed_at = today; progress 100', () => {
  const { db, m1, manager } = setup();
  const id = mk(db, manager, [m1.id]);
  tasks.changeStatus(db, id, 'hoan_thanh', manager, undefined, TODAY);
  const t = tasks.getTask(db, id, TODAY);
  assert.equal(t.completed_at, TODAY);
  assert.equal(t.progress, 100);
});

test('progress theo checklist', () => {
  const { db, m1, manager } = setup();
  const id = mk(db, manager, [m1.id], { checklist: ['a', 'b', 'c'] });
  assert.equal(tasks.getTask(db, id).progress, 0);
  const t = tasks.getTask(db, id);
  tasks.toggleChecklistItem(db, t.checklist[0].id, m1);
  assert.equal(tasks.getTask(db, id).progress, 33);
  const id2 = mk(db, manager, [m1.id]);
  assert.equal(tasks.getTask(db, id2).progress, 0);
});

test('overdue theo today truyền vào', () => {
  const { db, m1, manager } = setup();
  const a = mk(db, manager, [m1.id], { due_date: '2026-11-10' });
  const b = mk(db, manager, [m1.id], { due_date: '2026-11-11' });
  const c = mk(db, manager, [m1.id], { due_date: '2026-11-10' });
  tasks.changeStatus(db, c, 'hoan_thanh', manager, undefined, TODAY);
  assert.equal(tasks.getTask(db, a, TODAY).overdue, true);
  assert.equal(tasks.getTask(db, b, TODAY).overdue, false);
  assert.equal(tasks.getTask(db, c, TODAY).overdue, false);
  assert.equal(tasks.listTasks(db, { overdue: true }, TODAY).length, 1);
});

test('listTasks: tìm tiếng Việt, lọc, sắp theo hạn, có assignees', () => {
  const { db, m1, m2, manager } = setup();
  mk(db, manager, [m1.id], { title: 'Chuẩn bị sinh hoạt Công tác Đảng', due_date: '2026-12-01' });
  mk(db, manager, [m2.id], { title: 'Việc khác', due_date: '2026-11-15', category: 'dan_van' });
  assert.equal(tasks.listTasks(db, { q: 'dang' }, TODAY).length, 1);
  assert.equal(tasks.listTasks(db, { q: 'Đảng' }, TODAY).length, 1);
  const all = tasks.listTasks(db, {}, TODAY);
  assert.deepEqual(all.map((r) => r.due_date), ['2026-11-15', '2026-12-01']);
  assert.equal(all[0].assignees[0].id, m2.id);
  assert.equal(tasks.listTasks(db, { assignee_id: m1.id }, TODAY).length, 1);
  assert.equal(tasks.listTasks(db, { category: 'dan_van' }, TODAY).length, 1);
  assert.equal(tasks.listTasks(db, { from: '2026-11-16' }, TODAY).length, 1);
});

test('createTask: kiểm tra đầu vào', () => {
  const { db, m1, manager } = setup();
  const locked = mkUser(db, 'lk', 'member', 0);
  assert.throws(() => mk(db, manager, []), (e) => e instanceof AppError && e.message === 'Phải chọn ít nhất một người thực hiện');
  assert.throws(() => mk(db, manager, [m1.id], { title: '  ' }), AppError);
  assert.throws(() => mk(db, manager, [m1.id], { due_date: '' }), AppError);
  assert.throws(() => mk(db, manager, [m1.id], { due_date: '2026-13-40' }), AppError);
  assert.throws(() => mk(db, manager, [m1.id], { category: 'x' }), AppError);
  assert.throws(() => mk(db, manager, [locked.id]), AppError);
  assert.throws(() => mk(db, manager, [9999]), AppError);
});

test('canView, update/delete quyền, getTask null, người bị khóa', () => {
  const { db, m1, m2, manager, admin } = setup();
  const id = mk(db, manager, [m1.id]);
  const t = tasks.getTask(db, id);
  assert.equal(tasks.canView(t, m1), true);
  assert.equal(tasks.canView(t, m2), false);
  assert.equal(tasks.canView(t, manager), true);
  assert.equal(tasks.getTask(db, 999), null);
  assert.throws(() => tasks.updateTask(db, id, { title: 'X' }, m1), AppError);
  assert.throws(() => tasks.deleteTask(db, id, m1), AppError);
  tasks.updateTask(db, id, { title: 'Mới', assignee_ids: [m2.id] }, manager);
  assert.equal(tasks.getTask(db, id).title, 'Mới');
  assert.equal(tasks.getTask(db, id).assignees[0].id, m2.id);
  assert.throws(() => tasks.updateTask(db, id, { title: '' }, manager), AppError);
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(m2.id);
  assert.equal(tasks.getTask(db, id).assignees[0].active, 0);
  tasks.deleteTask(db, id, admin);
  assert.equal(tasks.getTask(db, id), null);
});

test('checklist & comment: quyền', () => {
  const { db, m1, m2, manager } = setup();
  const id = mk(db, manager, [m1.id]);
  tasks.addChecklistItem(db, id, 'Mục 1', m1);
  assert.throws(() => tasks.addChecklistItem(db, id, 'x', m2), AppError);
  const item = tasks.getTask(db, id).checklist[0];
  assert.throws(() => tasks.toggleChecklistItem(db, item.id, m2), AppError);
  tasks.toggleChecklistItem(db, item.id, m1);
  assert.equal(tasks.getTask(db, id).checklist[0].done, 1);
  tasks.toggleChecklistItem(db, item.id, manager);
  assert.equal(tasks.getTask(db, id).checklist[0].done, 0);
  assert.throws(() => tasks.addComment(db, id, m2, 'hi'), AppError);
  assert.throws(() => tasks.addComment(db, id, m1, '  '), AppError);
  tasks.addComment(db, id, m1, 'Đã nhận');
  assert.equal(tasks.getTask(db, id).comments.at(-1).content, 'Đã nhận');
});
