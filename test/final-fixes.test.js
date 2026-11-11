const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const { AppError } = require('../src/util/errors');
const { fmtDateTime } = require('../src/util/date');
const tasks = require('../src/services/tasks');
const rec = require('../src/services/recurring');
const users = require('../src/services/users');
const events = require('../src/services/events');
const tpl = require('../src/services/templates');
const { parseFilters } = require('../src/util/filters');

function mkUser(db, username, role, active = 1) {
  return Number(db.prepare('INSERT INTO users (username, password_hash, full_name, role, active) VALUES (?, ?, ?, ?, ?)')
    .run(username, hashPassword('pw12345678'), `Họ ${username}`, role, active).lastInsertRowid);
}
const form = { 'content-type': 'application/x-www-form-urlencoded' };

// ---- I1 ----
test('I1: JSON hỏng và form quá lớn trả trang tiếng Việt, không lộ stack', async () => {
  const s = await startServer();
  try {
    mkUser(s.db, 'mgr', 'manager');
    const sess = await loginAs(s.base, 'mgr', 'pw12345678');
    let r = await fetch(s.base + '/tasks', { method: 'POST', headers: { cookie: sess.cookie, 'content-type': 'application/json' }, body: '{bad json' });
    let t = await r.text();
    assert.equal(r.status, 400);
    assert.ok(t.includes('Dữ liệu gửi lên không hợp lệ'), t);
    assert.ok(!/ReferenceError|at .*\.js|node_modules/.test(t));
    r = await fetch(s.base + '/tasks', { method: 'POST', headers: { cookie: sess.cookie, 'content-type': 'application/json', accept: 'application/json' }, body: '{bad json' });
    assert.equal(r.status, 400);
    assert.ok((await r.json()).error.includes('không hợp lệ'));
    // chưa đăng nhập cũng không lộ stack
    r = await fetch(s.base + '/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    t = await r.text();
    assert.equal(r.status, 400);
    assert.ok(!/ReferenceError|node_modules/.test(t));
    // 1,2 MB hợp lệ vẫn qua giới hạn 1mb? không: > 1mb bị từ chối thân thiện
    r = await fetch(s.base + '/tasks', { method: 'POST', headers: { cookie: sess.cookie, ...form }, body: 'description=' + 'a'.repeat(1.2 * 1024 * 1024) });
    t = await r.text();
    assert.equal(r.status, 413);
    assert.ok(t.includes('Nội dung quá dài'), t);
    assert.ok(!/ReferenceError|node_modules/.test(t));
    // 150KB vẫn được chấp nhận (vào tới CSRF → 403 thân thiện, không phải 413)
    r = await fetch(s.base + '/tasks', { method: 'POST', headers: { cookie: sess.cookie, ...form }, body: 'description=' + 'a'.repeat(150 * 1024) });
    assert.notEqual(r.status, 413);
  } finally { await s.close(); }
});

// ---- I2 ----
test('I2: updateTask giữ được người đã bị khóa, nhưng không thêm người khóa mới', () => {
  const db = makeDb();
  const mgr = mkUser(db, 'mg', 'manager');
  const a = mkUser(db, 'a', 'member');
  const b = mkUser(db, 'b', 'member');
  const c = mkUser(db, 'c', 'member');
  const id = tasks.createTask(db, { title: 'X', due_date: '2099-01-01', assignee_ids: [a, b] }, mgr);
  db.prepare('UPDATE users SET active = 0 WHERE id IN (?, ?)').run(b, c);
  tasks.updateTask(db, id, { title: 'Y', assignee_ids: [a, b] }, { id: mgr, role: 'manager' });
  assert.equal(tasks.getTask(db, id).title, 'Y');
  assert.equal(tasks.getTask(db, id).assignees.length, 2);
  assert.throws(() => tasks.updateTask(db, id, { assignee_ids: [a, b, c] }, { id: mgr, role: 'manager' }), AppError);
});

test('I2 HTTP: sửa việc có người bị khóa giữ nguyên → 302', async () => {
  const s = await startServer();
  try {
    const mg = mkUser(s.db, 'mgr', 'manager');
    const a = mkUser(s.db, 'a', 'member');
    const id = tasks.createTask(s.db, { title: 'X', due_date: '2099-01-01', assignee_ids: [a] }, mg);
    s.db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(a);
    const sess = await loginAs(s.base, 'mgr', 'pw12345678');
    const r = await fetch(`${s.base}/tasks/${id}`, {
      method: 'POST', redirect: 'manual', headers: { cookie: sess.cookie, ...form },
      body: new URLSearchParams({ _csrf: sess.csrf, title: 'Mới', category: 'khac', priority: 'thuong', due_date: '2099-02-02', assignee_ids: String(a) }),
    });
    assert.equal(r.status, 302);
    assert.equal(tasks.getTask(s.db, id).title, 'Mới');
  } finally { await s.close(); }
});

// ---- R10 ----
test('fmtDateTime: UTC → giờ Việt Nam, qua ngày', () => {
  assert.equal(fmtDateTime('2026-11-10 17:30:00'), '11/11/2026 00:30');
  assert.equal(fmtDateTime('2026-12-31 18:05:09'), '01/01/2027 01:05');
  assert.equal(fmtDateTime('2026-11-11 02:00:00'), '11/11/2026 09:00');
  assert.equal(fmtDateTime(null), '');
  assert.equal(fmtDateTime('rác'), '');
});

// ---- Audit ----
test('Nhật ký: nhãn tiếng Việt, mã lạ giữ nguyên, trạng thái dịch', async () => {
  const s = await startServer();
  try {
    mkUser(s.db, 'adm', 'admin');
    s.db.prepare("UPDATE users SET must_change_password = 0 WHERE username='adm'").run();
    const sess = await loginAs(s.base, 'adm', 'pw12345678');
    const au = require('../src/services/audit');
    au.log(s.db, null, 'task_status', 'task:1', 'chua_lam → dang_lam — ghi chú');
    au.log(s.db, null, 'ma_la_hoac', 'x', null);
    const t = await (await fetch(s.base + '/admin/audit', { headers: { cookie: sess.cookie } })).text();
    assert.ok(t.includes('Đăng nhập'), 'login label');
    assert.ok(t.includes('Chưa làm → Đang làm'), 'status detail');
    assert.ok(t.includes('ma_la_hoac'));
    assert.ok(!t.includes('(giờ UTC)'));
  } finally { await s.close(); }
});

// ---- generateDue ----
test('generateDue không sinh lại việc đã bị xóa hoặc đổi hạn', () => {
  const db = makeDb();
  const ad = mkUser(db, 'ad', 'admin');
  const m = mkUser(db, 'm1', 'member');
  rec.createRule(db, { title: 'T', category: 'khac', priority: 'thuong', assignee_ids: [m], frequency: 'tuan', day_value: 1, lead_days: 2 }, ad);
  assert.equal(rec.generateDue(db, '2026-11-14'), 1);
  db.prepare('DELETE FROM tasks').run();
  assert.equal(rec.generateDue(db, '2026-11-14'), 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM tasks').get().c, 0);
  // kỳ kế tiếp vẫn sinh
  assert.equal(rec.generateDue(db, '2026-11-21'), 1);
});

test('generateDue: lỗi bất kỳ ở một quy tắc không chặn quy tắc khác', () => {
  const db = makeDb();
  const ad = mkUser(db, 'ad', 'admin');
  const m = mkUser(db, 'm1', 'member');
  const r1 = rec.createRule(db, { title: 'Hỏng', category: 'khac', priority: 'thuong', assignee_ids: [m], frequency: 'tuan', day_value: 1, lead_days: 2 }, ad);
  rec.createRule(db, { title: 'Tốt', category: 'khac', priority: 'thuong', assignee_ids: [m], frequency: 'tuan', day_value: 1, lead_days: 2 }, ad);
  db.prepare("UPDATE recurring_rules SET assignee_ids_json = '{\"a\":1}' WHERE id = ?").run(r1);
  const orig = console.error; const logged = [];
  console.error = (...a) => logged.push(a.join(' '));
  try {
    assert.equal(rec.generateDue(db, '2026-11-14'), 1);
  } finally { console.error = orig; }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tasks WHERE title = 'Tốt'").get().c, 1);
  assert.ok(logged.some((l) => l.includes(`quy tắc ${r1}`)));
});

// ---- Calendar ----
test('Lịch: xóa sự kiện không tồn tại → 404; cập nhật chuyển về tháng đã lưu', async () => {
  const s = await startServer();
  try {
    const mg = mkUser(s.db, 'mgr', 'manager');
    const sess = await loginAs(s.base, 'mgr', 'pw12345678');
    const post = (p, body) => fetch(s.base + p, { method: 'POST', redirect: 'manual', headers: { cookie: sess.cookie, ...form }, body: new URLSearchParams({ _csrf: sess.csrf, ...body }) });
    assert.equal((await post('/calendar/events/9999/delete', {})).status, 404);
    const id = events.createEvent(s.db, { title: 'E', start_date: '2026-11-05', type: 'khac' }, mg);
    const r = await post(`/calendar/events/${id}`, { title: 'E', start_date: ' 2027-03-09 ', type: 'khac' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/calendar?y=2027&m=3');
  } finally { await s.close(); }
});

// ---- M1 ----
test('M1: /templates không phản chiếu msg tùy ý', async () => {
  const s = await startServer();
  try {
    mkUser(s.db, 'mgr', 'manager');
    const sess = await loginAs(s.base, 'mgr', 'pw12345678');
    const g = async (q) => (await fetch(`${s.base}/templates?tab=recurring${q}`, { headers: { cookie: sess.cookie } })).text();
    assert.ok(!(await g('&msg=BiaDat123')).includes('BiaDat123'));
    assert.ok((await g('&done=generated&n=3')).includes('Đã sinh 3 công việc'));
    assert.ok(!(await g('&done=<script>')).includes('<script>alert'));
  } finally { await s.close(); }
});

// ---- done filter ----
test('listTasks/parseFilters: lọc theo ngày hoàn thành', () => {
  const db = makeDb();
  const mg = mkUser(db, 'mg', 'manager');
  const m = mkUser(db, 'm1', 'member');
  const mk = (t) => tasks.createTask(db, { title: t, due_date: '2099-01-01', assignee_ids: [m] }, mg);
  const a = mk('a'); const b = mk('b'); mk('c');
  tasks.changeStatus(db, a, 'hoan_thanh', { id: mg, role: 'manager' }, '', '2026-11-10');
  tasks.changeStatus(db, b, 'hoan_thanh', { id: mg, role: 'manager' }, '', '2026-10-01');
  const f = parseFilters({ status: 'hoan_thanh', done_from: '2026-11-09', done_to: '2026-11-15', done_x: '1' });
  assert.deepEqual(tasks.listTasks(db, f).map((t) => t.title), ['a']);
  assert.equal(parseFilters({ done_from: 'rác' }).done_from, undefined);
});

// ---- M2 ----
test('M2: admin không tự đổi vai trò của mình', () => {
  const db = makeDb();
  const a1 = mkUser(db, 'a1', 'admin'); mkUser(db, 'a2', 'admin');
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(a1);
  assert.throws(() => users.updateUser(db, a1, { ...cur, role: 'manager' }, a1), /tự thay đổi vai trò/);
  users.updateUser(db, a1, { ...cur, role: 'admin', full_name: 'Tên mới' }, a1);
});

// ---- M3 ----
test('M3: instantiate xác thực lại dữ liệu qua createTask', () => {
  const db = makeDb();
  const mg = mkUser(db, 'mg', 'manager');
  const m = mkUser(db, 'm1', 'member');
  const id = tpl.createTemplate(db, { name: 'M', category: 'dan_van', items: 'a' }, mg);
  assert.throws(() => tpl.instantiate(db, id, { due_date: '2026-12-20', assignee_ids: [m], priority: 'bogus' }, mg), /Mức ưu tiên không hợp lệ/);
  assert.throws(() => tpl.instantiate(db, id, { due_date: 'rác', assignee_ids: [m] }, mg), /Hạn hoàn thành/);
  assert.equal(tasks.getTask(db, tpl.instantiate(db, id, { due_date: '2026-12-20', assignee_ids: [m] }, mg)).category, 'dan_van');
});

// ---- Dashboard link ----
test('Dashboard: thẻ "Hoàn thành tuần này" link kèm khoảng ngày', async () => {
  const s = await startServer();
  try {
    mkUser(s.db, 'mgr', 'manager');
    const sess = await loginAs(s.base, 'mgr', 'pw12345678');
    const t = await (await fetch(s.base + '/', { headers: { cookie: sess.cookie } })).text();
    assert.match(t, /\/tasks\?status=hoan_thanh&amp;done_from=\d{4}-\d{2}-\d{2}&amp;done_to=\d{4}-\d{2}-\d{2}/);
  } finally { await s.close(); }
});
