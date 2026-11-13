const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');

async function boot() {
  const s = await startServer();
  s.db.prepare('UPDATE users SET must_change_password = 0 WHERE username = ?').run('admin');
  s.db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hashPassword('admin123'), 'admin');
  for (const [u, role] of [['mgr', 'manager'], ['mem', 'member']]) {
    s.db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)")
      .run(u, hashPassword('pw12345678'), u, role);
  }
  return s;
}
const get = (s, sess, p) => fetch(s.base + p, { headers: { cookie: sess.cookie }, redirect: 'manual' });
const post = (s, sess, p, body) => fetch(s.base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: sess.cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: sess.csrf, ...body }),
});

test('phân quyền /admin và /people', async () => {
  const s = await boot();
  try {
    const mgr = await loginAs(s.base, 'mgr', 'pw12345678');
    const mem = await loginAs(s.base, 'mem', 'pw12345678');
    assert.equal((await get(s, mgr, '/admin/users')).status, 403);
    assert.equal((await get(s, mem, '/admin/users')).status, 403);
    assert.equal((await get(s, mgr, '/admin/backup')).status, 403);
    assert.equal((await get(s, mgr, '/people')).status, 200);
    assert.equal((await get(s, mem, '/people')).status, 403);
    assert.equal((await fetch(s.base + '/admin/users', { redirect: 'manual' })).status, 302);
  } finally { await s.close(); }
});

test('admin: danh sách, tạo tài khoản hiện mật khẩu tạm, khóa, đơn vị, cài đặt, nhật ký', async () => {
  const s = await boot();
  try {
    const adm = await loginAs(s.base, 'admin', 'admin123');
    for (const p of ['/admin/users', '/admin/users/new', '/admin/units', '/admin/settings', '/admin/audit', '/people']) {
      assert.equal((await get(s, adm, p)).status, 200, p);
    }
    let r = await post(s, adm, '/admin/users', { username: 'newbie', full_name: 'Trần Văn B', role: 'member', party_status: 'doan_vien' });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Mật khẩu tạm/);
    r = await post(s, adm, '/admin/users', { username: 'newbie', full_name: 'Trùng', role: 'member' });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Tên đăng nhập đã tồn tại/);
    const id = s.db.prepare("SELECT id FROM users WHERE username='newbie'").get().id;
    r = await post(s, adm, `/admin/users/${id}/active`, { active: '0' });
    assert.equal(r.status, 302);
    assert.match(await (await get(s, adm, '/admin/users')).text(), /Đã khóa/);
    const adminId = s.db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
    r = await post(s, adm, `/admin/users/${adminId}/active`, { active: '0' });
    assert.equal(r.status, 400);
    r = await post(s, adm, '/admin/settings', { overload_threshold: '0' });
    assert.equal(r.status, 400);
    r = await post(s, adm, '/admin/settings', { overload_threshold: '8' });
    assert.equal(r.status, 302);
    assert.match(await (await get(s, adm, '/admin/settings')).text(), /value="8"/);
    r = await post(s, adm, '/admin/units', { name: 'Đại đội 9' });
    assert.equal(r.status, 302);
    assert.match(await (await get(s, adm, '/admin/units')).text(), /Đại đội 9/);
    r = await post(s, adm, '/admin/units/1/delete', {});
    assert.equal(r.status, 400);
  } finally { await s.close(); }
});

test('admin: sao lưu có secret.key thì tải về .zip gồm data.db và secret.key', async () => {
  const s = await boot();
  try {
    const adm = await loginAs(s.base, 'admin', 'admin123');
    const r = await get(s, adm, '/admin/backup');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.match(r.headers.get('content-disposition'), /attachment; filename="saoluu-\d{4}-\d{2}-\d{2}\.zip"/);
    const zip = new (require('pizzip'))(Buffer.from(await r.arrayBuffer()));
    assert.equal(zip.file('data.db').asNodeBuffer().subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal(zip.file('secret.key').asNodeBuffer().length, 32);
  } finally { await s.close(); }
});

test('admin: sao lưu không có secret.key thì tải về .db như cũ', async () => {
  const s = await boot();
  try {
    const dbFile = s.db.prepare('PRAGMA database_list').get().file;
    require('node:fs').rmSync(require('node:path').join(require('node:path').dirname(dbFile), 'secret.key'));
    const adm = await loginAs(s.base, 'admin', 'admin123');
    const r = await get(s, adm, '/admin/backup');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/octet-stream');
    assert.match(r.headers.get('content-disposition'), /attachment; filename="saoluu-\d{4}-\d{2}-\d{2}\.db"/);
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
  } finally { await s.close(); }
});
