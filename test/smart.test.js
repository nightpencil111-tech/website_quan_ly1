const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const tasks = require('../src/services/tasks');
const users = require('../src/services/users');
const smart = require('../src/services/smart');

const TODAY = '2026-11-11';

function mkUser(db, username, role = 'member', active = 1) {
  const id = Number(db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, active) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hashPassword('x'), `Họ ${username}`, role, active).lastInsertRowid);
  return { id, role };
}
const mk = (db, by, assignees, o = {}) => tasks.createTask(db, {
  title: 'Việc', category: 'khac', priority: 'thuong', due_date: '2026-11-30', assignee_ids: assignees, ...o,
}, by.id);
function complete(db, id, completedAt) {
  db.prepare("UPDATE tasks SET status='hoan_thanh', completed_at=? WHERE id=?").run(completedAt, id);
}

function scenario() {
  const db = makeDb();
  const mgr = mkUser(db, 'mgr', 'manager');
  const a = mkUser(db, 'a');
  const b = mkUser(db, 'b');
  const c = mkUser(db, 'c');
  const locked = mkUser(db, 'locked');
  const admin = mkUser(db, 'adm', 'admin');
  for (let i = 0; i < 4; i++) mk(db, mgr, [b.id]);
  for (let i = 0; i < 3; i++) {
    const id = mk(db, mgr, [c.id], { category: 'cong_tac_dang', due_date: '2026-11-05' });
    complete(db, id, '2026-11-04 10:00:00');
  }
  mk(db, mgr, [c.id]);
  mk(db, mgr, [locked.id]); // người bị khóa vẫn còn việc
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(locked.id);
  return { db, mgr, a, b, c, locked, admin };
}

test('suggestAssignees: C đứng đầu, B cuối, lý do, không có người bị khóa/admin', () => {
  const { db, a, b, c, locked, admin } = scenario();
  const s = smart.suggestAssignees(db, { category: 'cong_tac_dang' }, TODAY);
  assert.equal(s[0].user_id, c.id);
  assert.equal(s[s.length - 1].user_id, b.id);
  assert.ok(s[0].reasons.some((r) => r.includes('Công tác Đảng')));
  assert.ok(s[0].reasons.some((r) => r.includes('100% đúng hạn')));
  assert.ok(!s.some((x) => x.user_id === locked.id));
  assert.ok(!s.some((x) => x.user_id === admin.id));
  assert.equal(s[0].rank, 1);
  // a: rảnh, 0.5*1 + 0 + 0.2*0.5 = 0.6
  const sa = s.find((x) => x.user_id === a.id);
  assert.equal(sa.score, 0.6);
  assert.ok(sa.reasons.includes('Chưa có việc nào'));
});

test('suggestAssignees: giới hạn limit, cờ quá tải theo ngưỡng và theo cùng hạn', () => {
  const { db, mgr, a, b } = scenario();
  assert.equal(smart.suggestAssignees(db, { category: 'khac' }, TODAY, 2).length, 2);
  for (let i = 0; i < 2; i++) mk(db, mgr, [b.id]); // b: 6 việc > 5
  let s = smart.suggestAssignees(db, { category: 'khac' }, TODAY);
  assert.equal(s.find((x) => x.user_id === b.id).overloaded, true);
  assert.equal(s.find((x) => x.user_id === a.id).overloaded, false);
  mk(db, mgr, [a.id], { due_date: '2026-12-01' });
  mk(db, mgr, [a.id], { due_date: '2026-12-01' });
  s = smart.suggestAssignees(db, { category: 'khac', due_date: '2026-12-01' }, TODAY);
  const sa = s.find((x) => x.user_id === a.id);
  assert.equal(sa.overloaded, true);
  assert.ok(sa.reasons.some((r) => r.includes('cùng hạn')));
  s = smart.suggestAssignees(db, { category: 'khac', due_date: '2026-12-02' }, TODAY);
  assert.equal(s.find((x) => x.user_id === a.id).overloaded, false);
});

test('suggestAssignees: nhóm không ai có việc → thành phần tải = 1', () => {
  const db = makeDb();
  mkUser(db, 'x1'); mkUser(db, 'x2');
  const s = smart.suggestAssignees(db, { category: 'khac' }, TODAY);
  assert.equal(s.length, 2);
  assert.equal(s[0].score, 0.6);
});

test('overloadWarnings: vượt ngưỡng và ≥3 việc cùng hạn', () => {
  const db = makeDb();
  const mgr = mkUser(db, 'mgr', 'manager');
  const d = mkUser(db, 'd');
  const e = mkUser(db, 'e');
  mkUser(db, 'f');
  for (let i = 0; i < 6; i++) mk(db, mgr, [d.id], { due_date: `2026-12-${10 + i}` });
  for (let i = 0; i < 3; i++) mk(db, mgr, [e.id], { due_date: '2026-12-01' });
  let w = smart.overloadWarnings(db);
  assert.deepEqual(w.map((x) => x.user_id).sort(), [d.id, e.id].sort());
  assert.deepEqual(w.find((x) => x.user_id === e.id).same_day, [{ date: '2026-12-01', count: 3 }]);
  assert.equal(w.find((x) => x.user_id === d.id).same_day.length, 0);
  assert.equal(w.find((x) => x.user_id === d.id).open_count, 6);
  users.setSetting(db, 'overload_threshold', '2');
  w = smart.overloadWarnings(db);
  assert.equal(w.find((x) => x.user_id === e.id).open_count, 3);
});

test('priorityScore: hỏa tốc > thường, quá hạn lên đầu', () => {
  const t = (priority, due_date) => ({ priority, due_date });
  assert.equal(smart.priorityScore(t('hoa_toc', '2026-11-12'), TODAY), 2);
  assert.equal(smart.priorityScore(t('thuong', '2026-11-12'), TODAY), 1);
  assert.equal(smart.priorityScore(t('hoa_toc', '2026-11-11'), TODAY), 4); // hôm nay: 2/0.5
  assert.ok(smart.priorityScore(t('thuong', '2026-11-10'), TODAY) > smart.priorityScore(t('hoa_toc', '2026-11-11'), TODAY));
});

test('todayList: chỉ việc chưa xong của người đó, quá hạn trước', () => {
  const { db, mgr, a, b } = scenario();
  const late = mk(db, mgr, [a.id], { due_date: '2026-11-01' });
  const urgent = mk(db, mgr, [a.id], { priority: 'hoa_toc', due_date: '2026-11-12' });
  const norm = mk(db, mgr, [a.id], { due_date: '2026-11-12' });
  const done = mk(db, mgr, [a.id]);
  complete(db, done, '2026-11-10 09:00:00');
  mk(db, mgr, [b.id]);
  const l = smart.todayList(db, a.id, TODAY);
  assert.deepEqual(l.map((t) => t.id), [late, urgent, norm]);
});

test('performance: tính đúng theo khoảng hạn', () => {
  const db = makeDb();
  const mgr = mkUser(db, 'mgr', 'manager');
  const a = mkUser(db, 'a');
  const k = mkUser(db, 'k');
  const t1 = mk(db, mgr, [a.id], { due_date: '2026-11-05' }); complete(db, t1, '2026-11-05 08:00:00');
  const t2 = mk(db, mgr, [a.id], { due_date: '2026-11-06' }); complete(db, t2, '2026-11-08 08:00:00');
  mk(db, mgr, [a.id], { due_date: '2026-11-07' }); // quá hạn
  mk(db, mgr, [a.id], { due_date: '2026-11-20' }); // chưa tới hạn
  mk(db, mgr, [a.id], { due_date: '2026-10-01' }); // ngoài khoảng
  const t6 = mk(db, mgr, [k.id], { due_date: '2026-11-03' }); complete(db, t6, '2026-11-03 08:00:00');
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(k.id);
  const p = smart.performance(db, { from: '2026-11-01', to: '2026-11-30' }, TODAY);
  const pa = p.find((x) => x.user_id === a.id);
  assert.deepEqual({ ...pa }, { user_id: a.id, full_name: pa.full_name, assigned: 4, completed: 2, on_time: 1, overdue: 1, rate: 0.25 });
  assert.equal(p[0].user_id, k.id); // rate 1 xếp trước
  assert.equal(p.find((x) => x.user_id === mgr.id), undefined);
});

test('HTTP: /api/suggest cần đăng nhập và quyền quản lý; /my dùng todayList', async () => {
  const srv = await startServer();
  try {
    const { db, base } = srv;
    db.prepare('UPDATE users SET must_change_password=0').run();
    const mgr = mkUser(db, 'mgr1', 'manager'); // mật khẩu 'x' băm sẵn
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword('pw12345'), mgr.id);
    const mem = mkUser(db, 'mem1');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword('pw12345'), mem.id);
    const lk = mkUser(db, 'lk1', 'member', 0);
    let r = await fetch(`${base}/api/suggest?category=khac`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    const m = await loginAs(base, 'mem1', 'pw12345');
    r = await fetch(`${base}/api/suggest?category=khac`, { headers: { cookie: m.cookie } });
    assert.equal(r.status, 403);
    const g = await loginAs(base, 'mgr1', 'pw12345');
    r = await fetch(`${base}/api/suggest?category=khac&due_date=2026-12-01`, { headers: { cookie: g.cookie } });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.ok(j.suggestions.length >= 1);
    assert.ok(!j.suggestions.some((s) => s.user_id === lk.id));
    // 7 người thừa kế tải thấp + 1 người quá tải xếp ngoài top 5
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(mkUser(db, 'free' + i).id);
    const heavy = mkUser(db, 'heavy');
    for (let i = 0; i < 6; i++) mk(db, mgr, [heavy.id]);
    r = await fetch(`${base}/api/suggest?category=khac`, { headers: { cookie: g.cookie } });
    const j2 = await r.json();
    assert.equal(j2.suggestions.length, 5);
    assert.ok(!j2.suggestions.some((s) => s.user_id === heavy.id));
    assert.ok(j2.overloaded_ids.includes(heavy.id));
    assert.ok(!j2.overloaded_ids.includes(ids[0]));
    r = await fetch(`${base}/api/suggest?category=__proto__`, { headers: { cookie: g.cookie } });
    assert.equal(r.status, 200);
    r = await fetch(`${base}/api/suggest?category=constructor`, { headers: { cookie: g.cookie } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    r = await fetch(`${base}/my`, { headers: { cookie: g.cookie } });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Việc cần làm hôm nay/);
  } finally { await srv.close(); }
});
