const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAs } = require('./helpers');

const form = (o) => new URLSearchParams(o);
const H = { 'content-type': 'application/x-www-form-urlencoded' };

test('HTTP: xác thực, phiên, CSRF', async (t) => {
  const s = await startServer();
  t.after(() => s.close());

  await t.test('GET / chưa đăng nhập → 302 /login', async () => {
    const r = await fetch(s.base + '/', { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
  });

  await t.test('trang /login hiển thị', async () => {
    const r = await fetch(s.base + '/login');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Đăng nhập/);
  });

  await t.test('đăng nhập sai báo lỗi', async () => {
    const r = await fetch(s.base + '/login', { method: 'POST', headers: H, body: form({ username: 'admin', password: 'sai' }), redirect: 'manual' });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /không đúng/);
  });

  let cookie;
  await t.test('admin lần đầu → /change-password, mọi trang khác cũng chuyển về đó', async () => {
    const r = await fetch(s.base + '/login', { method: 'POST', headers: H, body: form({ username: 'admin', password: 'admin123' }), redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/change-password');
    const sc = r.headers.get('set-cookie');
    assert.match(sc, /HttpOnly/i);
    assert.match(sc, /SameSite=Strict/i);
    cookie = sc.split(';')[0];
    const r2 = await fetch(s.base + '/', { headers: { cookie }, redirect: 'manual' });
    assert.equal(r2.status, 302);
    assert.equal(r2.headers.get('location'), '/change-password');
    const r3 = await fetch(s.base + '/change-password', { headers: { cookie } });
    assert.equal(r3.status, 200);
  });

  await t.test('POST thiếu _csrf → 403', async () => {
    const r = await fetch(s.base + '/change-password', { method: 'POST', headers: { ...H, cookie }, body: form({ current: 'admin123', password: 'matkhaumoi1', confirm: 'matkhaumoi1' }), redirect: 'manual' });
    assert.equal(r.status, 403);
  });

  await t.test('POST khi chưa đăng nhập, không csrf → 403', async () => {
    const r = await fetch(s.base + '/change-password', { method: 'POST', headers: H, body: form({ password: 'x' }), redirect: 'manual' });
    assert.equal(r.status, 403);
  });

  await t.test('đổi mật khẩu: kiểm tra và thành công', async () => {
    const csrf = s.db.prepare('SELECT csrf FROM sessions').get().csrf;
    const post = (o) => fetch(s.base + '/change-password', { method: 'POST', headers: { ...H, cookie }, body: form({ _csrf: csrf, ...o }), redirect: 'manual' });
    assert.match(await (await post({ current: 'admin123', password: 'ngan', confirm: 'ngan' })).text(), /8 ký tự/);
    assert.match(await (await post({ current: 'admin123', password: 'matkhaumoi1', confirm: 'khac12345' })).text(), /khớp/);
    assert.match(await (await post({ current: 'admin123', password: 'admin123', confirm: 'admin123' })).text(), /khác/);
    const ok = await post({ current: 'admin123', password: 'matkhaumoi1', confirm: 'matkhaumoi1' });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('location'), '/');
    const r = await fetch(s.base + '/', { headers: { cookie }, redirect: 'manual' });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Tổng quan/);
    assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action='change_password'").get());
  });

  await t.test('loginAs lấy được csrf; header X-CSRF-Token được chấp nhận; menu admin', async () => {
    const { cookie: c, csrf } = await loginAs(s.base, 'admin', 'matkhaumoi1');
    assert.ok(csrf);
    const page = await (await fetch(s.base + '/', { headers: { cookie: c } })).text();
    assert.match(page, /\/admin\/users/);
    assert.match(page, /Đăng xuất/);
    const bad = await fetch(s.base + '/logout', { method: 'POST', headers: { cookie: c }, redirect: 'manual' });
    assert.equal(bad.status, 403);
    const ok = await fetch(s.base + '/logout', { method: 'POST', headers: { cookie: c, 'X-CSRF-Token': csrf }, redirect: 'manual' });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('location'), '/login');
    assert.equal((await fetch(s.base + '/', { headers: { cookie: c }, redirect: 'manual' })).status, 302);
    assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action='logout'").get());
  });

  await t.test('phiên hết hạn → coi như chưa đăng nhập', async () => {
    const { cookie: c } = await loginAs(s.base, 'admin', 'matkhaumoi1');
    assert.equal((await fetch(s.base + '/', { headers: { cookie: c }, redirect: 'manual' })).status, 200);
    s.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1000);
    const r = await fetch(s.base + '/', { headers: { cookie: c }, redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
  });

  await t.test('404', async () => {
    const r = await fetch(s.base + '/khong-co');
    assert.equal(r.status, 404);
  });
});
