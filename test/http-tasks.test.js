const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const tasks = require('../src/services/tasks');

async function boot() {
  const s = await startServer();
  const ids = {};
  for (const [u, role] of [['mgr', 'manager'], ['ma', 'member'], ['mb', 'member']]) {
    ids[u] = Number(s.db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
      .run(u, hashPassword('pw12345678'), `Tên ${u}`, role).lastInsertRowid);
  }
  ids.taskA = tasks.createTask(s.db, { title: 'Việc của A', due_date: '2099-01-01', assignee_ids: [ids.ma] }, ids.mgr);
  ids.taskB = tasks.createTask(s.db, { title: 'Bí mật của B', due_date: '2099-01-01', assignee_ids: [ids.mb] }, ids.mgr);
  return { s, ids };
}
const get = (s, sess, p, headers = {}) => fetch(s.base + p, { headers: { cookie: sess.cookie, ...headers }, redirect: 'manual' });
const post = (s, sess, p, body, headers = {}) => fetch(s.base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: sess.cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: new URLSearchParams({ _csrf: sess.csrf, ...body }),
});

test('member không xem/sửa được việc của người khác', async () => {
  const { s, ids } = await boot();
  try {
    const ma = await loginAs(s.base, 'ma', 'pw12345678');
    const r = await get(s, ma, `/tasks/${ids.taskB}`);
    assert.equal(r.status, 403);
    assert.ok(!(await r.text()).includes('Bí mật của B'));
    assert.equal((await post(s, ma, `/tasks/${ids.taskB}/status`, { status: 'dang_lam' })).status, 403);
    assert.equal((await get(s, ma, '/tasks/new')).status, 403);
    assert.equal((await get(s, ma, `/tasks/${ids.taskA}`)).status, 200);
    const list = await (await get(s, ma, '/tasks')).text();
    assert.ok(list.includes('Việc của A') && !list.includes('Bí mật của B'));
    const kb = await (await get(s, ma, '/kanban')).text();
    assert.ok(kb.includes('Việc của A') && !kb.includes('Bí mật của B'));
    assert.equal((await get(s, ma, '/my')).status, 200);
  } finally { await s.close(); }
});

test('chưa đăng nhập bị chuyển tới /login', async () => {
  const { s } = await boot();
  try {
    const r = await fetch(s.base + '/tasks', { redirect: 'manual' });
    assert.equal(r.status, 302);
  } finally { await s.close(); }
});

test('manager tạo, sửa, xóa việc', async () => {
  const { s, ids } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    assert.equal((await get(s, m, '/tasks/new')).status, 200);
    const r = await post(s, m, '/tasks', {
      title: 'Việc mới', description: '', category: 'dan_van', priority: 'gap', due_date: '2099-02-02',
      assignee_ids: String(ids.ma), checklist: 'Mục 1\n\nMục 2',
    });
    assert.equal(r.status, 302);
    const loc = r.headers.get('location');
    assert.match(loc, /^\/tasks\/\d+$/);
    const t = tasks.getTask(s.db, Number(loc.split('/')[2]));
    assert.equal(t.checklist.length, 2);
    const bad = await post(s, m, '/tasks', { title: '', due_date: '2099-02-02', assignee_ids: String(ids.ma) });
    assert.equal(bad.status, 400);
    assert.ok((await bad.text()).includes('Tiêu đề không được để trống'));
    assert.equal((await post(s, m, `${loc}`, { title: 'Đã sửa', category: 'khac', priority: 'thuong', due_date: '2099-03-03', assignee_ids: String(ids.mb) })).status, 302);
    assert.equal(tasks.getTask(s.db, t.id).title, 'Đã sửa');
    assert.equal((await get(s, m, `${loc}/edit`)).status, 200);
    assert.equal((await post(s, m, `${loc}/delete`, {})).status, 302);
    assert.equal(tasks.getTask(s.db, t.id), null);
    const ma = await loginAs(s.base, 'ma', 'pw12345678');
    assert.equal((await post(s, ma, `/tasks/${ids.taskA}/delete`, {})).status, 403);
    assert.equal((await post(s, ma, '/tasks', { title: 'x' })).status, 403);
  } finally { await s.close(); }
});

test('đổi trạng thái JSON cho Kanban', async () => {
  const { s, ids } = await boot();
  try {
    const ma = await loginAs(s.base, 'ma', 'pw12345678');
    const json = { accept: 'application/json' };
    let r = await post(s, ma, `/tasks/${ids.taskA}/status`, { status: 'dang_lam' }, json);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    r = await post(s, ma, `/tasks/${ids.taskA}/status`, { status: 'hoan_thanh' }, json);
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.equal(body.ok, false);
    assert.ok(body.error);
    // gửi bằng header X-CSRF-Token + JSON
    r = await fetch(`${s.base}/tasks/${ids.taskA}/status`, {
      method: 'POST', headers: { cookie: ma.cookie, 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': ma.csrf },
      body: JSON.stringify({ status: 'cho_duyet', note: 'Xong' }),
    });
    assert.deepEqual(await r.json(), { ok: true });
    // không có quyền → 403 JSON
    r = await post(s, ma, `/tasks/${ids.taskB}/status`, { status: 'dang_lam' }, json);
    assert.equal(r.status, 403);
  } finally { await s.close(); }
});

test('checklist, bình luận, bộ lọc, các trang hiển thị', async () => {
  const { s, ids } = await boot();
  try {
    const ma = await loginAs(s.base, 'ma', 'pw12345678');
    assert.equal((await post(s, ma, `/tasks/${ids.taskA}/checklist`, { content: 'Mục mới' })).status, 302);
    const t = tasks.getTask(s.db, ids.taskA);
    assert.equal(t.checklist.length, 1);
    assert.equal((await post(s, ma, `/tasks/${ids.taskA}/checklist/${t.checklist[0].id}/toggle`, {})).status, 302);
    assert.equal(tasks.getTask(s.db, ids.taskA).checklist[0].done, 1);
    assert.equal((await post(s, ma, `/tasks/${ids.taskA}/comments`, { content: 'Đã nhận' })).status, 302);
    const page = await (await get(s, ma, `/tasks/${ids.taskA}`)).text();
    assert.ok(page.includes('Đã nhận') && page.includes('Bắt đầu thực hiện') && page.includes('01/01/2099'));
    assert.equal((await post(s, ma, `/tasks/${ids.taskB}/comments`, { content: 'hack' })).status, 403);
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const l = await (await get(s, m, `/tasks?q=viec&overdue=&status=&assignee_id=${ids.ma}`)).text();
    assert.ok(l.includes('Việc của A') && !l.includes('Bí mật của B'));
    assert.equal((await get(s, m, '/kanban')).status, 200);
    assert.equal((await get(s, m, '/my')).status, 200);
  } finally { await s.close(); }
});
