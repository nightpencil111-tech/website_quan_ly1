const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { hashPassword } = require('../src/auth');
const totp = require('../src/services/totp');

const H = { 'content-type': 'application/x-www-form-urlencoded' };
const INTERNET = { mode: 'internet', publicUrl: 'https://may.tailnet.ts.net' };
const PW = 'MatKhau#2026';
const BLOCK_MSG = 'Quá nhiều lần đăng nhập sai từ thiết bị này, thử lại sau 15 phút';

function addUser(db, username, role, extra = {}) {
  const r = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, must_change_password) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hashPassword(PW), 'Đồng chí ' + username, role, extra.mustChange ? 1 : 0);
  return Number(r.lastInsertRowid);
}

// Trình duyệt tối giản: giữ cookie, đọc csrf từ <meta>.
function client(base, ip = '10.9.8.7') {
  const c = { cookie: '', csrf: '', ip };
  const take = (r) => {
    const all = r.headers.getSetCookie();
    if (all.length) {
      const v = all[all.length - 1].split(';')[0];
      c.cookie = /^sid=$/.test(v) ? '' : v;
    }
    return r;
  };
  const readCsrf = (html) => {
    const m = html.match(/<meta name="csrf" content="([^"]*)"/);
    if (m && m[1]) c.csrf = m[1];
  };
  c.get = async (url) => {
    const r = take(await fetch(base + url, { headers: { cookie: c.cookie, 'x-forwarded-for': c.ip }, redirect: 'manual' }));
    const text = await r.text();
    readCsrf(text);
    return { status: r.status, location: r.headers.get('location'), text };
  };
  c.post = async (url, body = {}) => {
    const r = take(await fetch(base + url, {
      method: 'POST', redirect: 'manual',
      headers: { ...H, cookie: c.cookie, 'x-forwarded-for': c.ip },
      body: new URLSearchParams({ _csrf: c.csrf, ...body }),
    }));
    const text = await r.text();
    readCsrf(text);
    return { status: r.status, location: r.headers.get('location'), text };
  };
  c.login = (username, password = PW) => c.post('/login', { username, password });
  return c;
}

const secretFromPage = (html) => {
  const m = html.match(/<code class="totp-key">([A-Z2-7 ]+)<\/code>/);
  assert.ok(m, 'trang bật 2 lớp phải hiện khóa dạng chữ');
  return m[1].replace(/\s+/g, '');
};
const codesFromPage = (html) => html.match(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/g) || [];
const stepOf = (ms) => Math.floor(ms / 30000);

test('luồng 2 lớp ở chế độ Internet cho manager: bắt buộc bật, nhập mã, mã dự phòng, chặn IP, admin đặt lại', async (t) => {
  let now = Date.now();
  const s = await startServer({ config: INTERNET, now: () => now });
  t.after(() => s.close());
  const uid = addUser(s.db, 'quanly1', 'manager');

  // 1. Đúng mật khẩu → bắt buộc bật 2 lớp; mọi trang khác chuyển về /2fa/setup.
  const c = client(s.base);
  let r = await c.login('quanly1');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/2fa/setup');
  for (const url of ['/tasks', '/', '/account/security', '/change-password', '/people', '/assistant']) {
    r = await c.get(url);
    assert.equal(r.status, 302, url);
    assert.equal(r.location, '/2fa/setup', url);
  }
  // POST đến trang khác cũng không thực hiện được.
  r = await c.get('/2fa/setup');
  assert.equal(r.status, 200);
  assert.match(r.text, /<img[^>]+src="data:image\/png;base64,/, 'ảnh QR dạng data URL');
  assert.match(r.text, /Google Authenticator/);
  assert.match(r.text, /Microsoft Authenticator/);
  const secret = secretFromPage(r.text);
  r = await c.post('/tasks', { title: 'Lách 2 lớp' });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/2fa/setup');
  assert.equal(s.db.prepare("SELECT COUNT(*) c FROM tasks WHERE title = 'Lách 2 lớp'").get().c, 0);

  // Secret trong CSDL không phải bản rõ.
  const row = s.db.prepare('SELECT * FROM user_totp WHERE user_id = ?').get(uid);
  assert.equal(row.enabled, 0);
  assert.ok(!row.secret_enc.includes(secret));
  assert.equal(totp.decryptSecret(row.secret_enc, s.app.locals.totpKey), secret);

  // Mã sai → báo lỗi, chưa bật.
  r = await c.post('/2fa/setup', { code: '000000' === totp.totpAt(secret, stepOf(now)) ? '111111' : '000000' });
  assert.equal(r.status, 200);
  assert.match(r.text, /Mã xác nhận không đúng/);

  // 2. Bật bằng mã đúng → hiện 10 mã dự phòng một lần.
  r = await c.post('/2fa/setup', { code: totp.totpAt(secret, stepOf(now)) });
  assert.equal(r.status, 200);
  const codes = codesFromPage(r.text);
  assert.equal(new Set(codes).size, 10);
  assert.match(r.text, /Tôi đã lưu các mã này/);
  assert.equal(s.db.prepare('SELECT enabled FROM user_totp WHERE user_id = ?').get(uid).enabled, 1);
  assert.equal(s.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'totp_enable'").get().c, 1);
  r = await c.get('/tasks');
  assert.equal(r.status, 200, 'đã qua 2 lớp → vào được');
  r = await c.get('/account/security');
  assert.equal(r.status, 200);
  assert.match(r.text, /Đã bật/);
  assert.match(r.text, /Còn 10 mã dự phòng/);
  assert.equal(codesFromPage(r.text).length, 0, 'mã dự phòng chỉ hiện một lần');
  // manager ở chế độ Internet không được tự tắt.
  r = await c.post('/account/security/disable', { code: totp.totpAt(secret, stepOf(now) + 1) });
  assert.equal(r.status, 403);
  assert.equal(s.db.prepare('SELECT enabled FROM user_totp WHERE user_id = ?').get(uid).enabled, 1);

  // 3. Đăng xuất, đăng nhập lại → /2fa/verify; trang khác bị chặn.
  await c.post('/logout');
  now += 30000;
  r = await c.login('quanly1');
  assert.equal(r.location, '/2fa/verify');
  r = await c.get('/tasks');
  assert.equal(r.location, '/2fa/verify');
  r = await c.get('/2fa/setup');
  assert.equal(r.location, '/2fa/verify', 'không tạo lại secret khi đang chờ nhập mã');
  r = await c.get('/2fa/verify');
  assert.equal(r.status, 200);
  assert.match(r.text, /Dùng mã dự phòng/);

  // 4. Mã sai: 5 lần trên một phiên → hủy phiên; tổng 10 lần từ một IP → khóa IP.
  const wrong = () => {
    const good = [-1, 0, 1].map((d) => totp.totpAt(secret, stepOf(now) + d));
    return ['000000', '111111', '222222', '333333'].find((x) => !good.includes(x));
  };
  for (let i = 1; i <= 5; i++) {
    r = await c.post('/2fa/verify', { code: wrong() });
    if (i < 5) { assert.equal(r.status, 200); assert.match(r.text, /Mã xác nhận không đúng/); }
  }
  assert.equal(r.status, 302);
  assert.equal(r.location, '/login?sai_ma=1', '5 lần sai trên một phiên → về đăng nhập');
  assert.match((await c.get(r.location)).text, /Nhập sai mã xác thực quá 5 lần/);
  r = await c.get('/2fa/verify');
  assert.equal(r.location, '/login');
  r = await c.login('quanly1');
  assert.equal(r.location, '/2fa/verify');
  for (let i = 6; i <= 10; i++) r = await c.post('/2fa/verify', { code: wrong() });
  assert.equal(r.status, 429, 'lần sai thứ 10 từ một IP → khóa IP');
  assert.match(r.text, new RegExp(BLOCK_MSG));
  assert.equal(s.db.prepare("SELECT target FROM audit_log WHERE action = 'login_ip_blocked'").get().target, c.ip);
  r = await c.login('quanly1');
  assert.equal(r.status, 429, 'IP bị khóa không đăng nhập được');

  // 5. Từ IP khác: mã đúng → vào được; dùng lại cùng mã (replay) → từ chối.
  const d = client(s.base, '10.1.1.1');
  r = await d.login('quanly1');
  assert.equal(r.location, '/2fa/verify');
  await d.get('/2fa/verify');
  const code = totp.totpAt(secret, stepOf(now));
  r = await d.post('/2fa/verify', { code });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/');
  assert.equal((await d.get('/tasks')).status, 200);
  const e = client(s.base, '10.1.1.2');
  await e.login('quanly1');
  await e.get('/2fa/verify');
  r = await e.post('/2fa/verify', { code });
  assert.equal(r.status, 200, 'mã vừa dùng không được dùng lại');
  assert.match(r.text, /Mã xác nhận không đúng/);
  assert.equal((await e.get('/tasks')).location, '/2fa/verify');

  // 6. Mã dự phòng → vào được; dùng lại mã đó → từ chối.
  r = await e.post('/2fa/recovery', { recovery_code: codes[0].toLowerCase() });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/');
  assert.equal((await e.get('/tasks')).status, 200);
  assert.equal(s.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'recovery_code_used'").get().c, 1);
  assert.match((await e.get('/account/security')).text, /Còn 9 mã dự phòng/);
  const f = client(s.base, '10.1.1.3');
  await f.login('quanly1');
  await f.get('/2fa/verify');
  r = await f.post('/2fa/recovery', { recovery_code: codes[0] });
  assert.equal(r.status, 200);
  assert.match(r.text, /Mã dự phòng không đúng hoặc đã dùng/);
  assert.equal((await f.get('/tasks')).location, '/2fa/verify');

  // 7. Admin đặt lại 2 lớp cho manager → phiên của manager bị hủy, lần sau phải bật lại.
  s.db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'admin'").run();
  const adminId = s.db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  s.db.prepare('INSERT INTO user_totp (user_id, secret_enc, enabled, recovery_hashes) VALUES (?, ?, 1, ?)')
    .run(adminId, totp.encryptSecret(secret, s.app.locals.totpKey), '[]');
  const a = client(s.base, '10.2.2.2');
  r = await a.login('admin', 'admin123');
  assert.equal(r.location, '/2fa/verify');
  await a.get('/2fa/verify');
  now += 60000;
  r = await a.post('/2fa/verify', { code: totp.totpAt(secret, stepOf(now)) });
  assert.equal(r.location, '/');
  r = await a.get('/admin/users');
  assert.match(r.text, /Đặt lại xác thực 2 lớp/);
  r = await a.post(`/admin/users/${uid}/totp-reset`);
  assert.equal(r.status, 302);
  assert.equal(s.db.prepare('SELECT COUNT(*) c FROM user_totp WHERE user_id = ?').get(uid).c, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id = ?').get(uid).c, 0);
  assert.equal(s.db.prepare("SELECT target FROM audit_log WHERE action = 'totp_reset'").get().target, 'quanly1');
  assert.equal((await d.get('/tasks')).location, '/login', 'phiên cũ của manager bị hủy');
  r = await d.login('quanly1');
  assert.equal(r.location, '/2fa/setup', 'lần sau phải bật lại');
  // Không phải admin thì không đặt lại được.
  r = await d.post(`/admin/users/${adminId}/totp-reset`);
  assert.notEqual(r.status, 200);
  assert.equal(s.db.prepare('SELECT COUNT(*) c FROM user_totp WHERE user_id = ?').get(adminId).c, 1);
});

test('chế độ Internet: member không bị bắt buộc; chế độ nội bộ không bắt buộc ai', async (t) => {
  const inet = await startServer({ config: INTERNET });
  const lan = await startServer();
  t.after(() => Promise.all([inet.close(), lan.close()]));
  addUser(inet.db, 'thanhvien', 'member');
  let r = await client(inet.base).login('thanhvien');
  assert.equal(r.location, '/');
  addUser(lan.db, 'quanly2', 'manager');
  const c = client(lan.base);
  r = await c.login('quanly2');
  assert.equal(r.location, '/');
  assert.equal((await c.get('/tasks')).status, 200);
  r = await client(lan.base).login('admin', 'admin123');
  assert.equal(r.location, '/change-password');
});

test('chế độ Internet: 2 lớp trước, đổi mật khẩu bắt buộc sau', async (t) => {
  const s = await startServer({ config: INTERNET });
  t.after(() => s.close());
  addUser(s.db, 'quanly3', 'manager', { mustChange: true });
  const c = client(s.base);
  let r = await c.login('quanly3');
  assert.equal(r.location, '/2fa/setup');
  r = await c.get('/2fa/setup');
  const secret = secretFromPage(r.text);
  r = await c.post('/2fa/setup', { code: totp.totpAt(secret, stepOf(Date.now())) });
  assert.equal(r.status, 200);
  r = await c.post('/2fa/done');
  assert.equal(r.status, 302);
  r = await c.get(r.location);
  assert.equal(r.location, '/change-password');
});

test('phiên chờ 2 lớp quá 5 phút → về /login', async (t) => {
  let now = Date.now();
  const s = await startServer({ config: INTERNET, now: () => now });
  t.after(() => s.close());
  addUser(s.db, 'quanly4', 'manager');
  const c = client(s.base);
  await c.login('quanly4');
  assert.equal((await c.get('/2fa/setup')).status, 200);
  now += 4 * 60 * 1000;
  assert.equal((await c.get('/2fa/setup')).status, 200, 'chưa quá 5 phút');
  now += 61 * 1000;
  let r = await c.get('/2fa/setup');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/login');
  assert.equal(s.db.prepare('SELECT COUNT(*) c FROM sessions').get().c, 0);
  r = await c.get('/tasks');
  assert.equal(r.location, '/login');
});

test('chế độ Internet: phiên cũ (tạo trước khi bật chế độ Internet) của manager chưa bật 2 lớp bị chuyển sang bật 2 lớp', async (t) => {
  const s = await startServer({ config: INTERNET });
  t.after(() => s.close());
  const uid = addUser(s.db, 'quanly5', 'manager');
  s.db.prepare("INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES ('phiencu', ?, 'x', ?)").run(uid, Date.now() + 3600e3);
  const c = client(s.base);
  c.cookie = 'sid=phiencu';
  const r = await c.get('/tasks');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/2fa/setup');
});

test('Bảo mật tài khoản: member tự bật, tạo lại mã dự phòng và tắt bằng mã hiện tại (chế độ nội bộ)', async (t) => {
  let now = Date.now();
  const s = await startServer({ now: () => now });
  t.after(() => s.close());
  const uid = addUser(s.db, 'canbo', 'member');
  const c = client(s.base);
  await c.login('canbo');
  let r = await c.get('/');
  assert.match(r.text, /href="\/account\/security"/, 'liên kết Bảo mật tài khoản ở thanh trên');
  r = await c.get('/account/security');
  assert.equal(r.status, 200);
  assert.match(r.text, /Chưa bật/);
  r = await c.get('/2fa/setup');
  assert.equal(r.status, 200);
  const secret = secretFromPage(r.text);
  r = await c.post('/2fa/setup', { code: totp.totpAt(secret, stepOf(now)) });
  assert.equal(codesFromPage(r.text).length, 10);
  now += 30000;
  // Tạo lại mã dự phòng: mã sai → lỗi; mã đúng → 10 mã mới.
  r = await c.post('/account/security/recovery-codes', { code: '12' });
  assert.match(r.text, /Mã xác nhận không đúng/);
  r = await c.post('/account/security/recovery-codes', { code: totp.totpAt(secret, stepOf(now)) });
  assert.equal(codesFromPage(r.text).length, 10);
  now += 30000;
  // Tắt: mã sai → không tắt; mã đúng → tắt.
  r = await c.post('/account/security/disable', { code: 'abc' });
  assert.match(r.text, /Mã xác nhận không đúng/);
  assert.equal(s.db.prepare('SELECT COUNT(*) c FROM user_totp WHERE user_id = ?').get(uid).c, 1);
  r = await c.post('/account/security/disable', { code: totp.totpAt(secret, stepOf(now)) });
  assert.equal(r.status, 302);
  assert.equal(s.db.prepare('SELECT COUNT(*) c FROM user_totp WHERE user_id = ?').get(uid).c, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'totp_disable'").get().c, 1);
  await c.post('/logout');
  r = await c.get('/2fa/setup');
  assert.equal(r.location, '/login', 'chưa đăng nhập thì không vào trang bật 2 lớp');
  // Chế độ nội bộ: người đã tự bật 2 lớp thì đăng nhập cũng phải nhập mã.
  s.db.prepare('INSERT INTO user_totp (user_id, secret_enc, enabled, recovery_hashes) VALUES (?, ?, 1, ?)')
    .run(uid, totp.encryptSecret(secret, s.app.locals.totpKey), '[]');
  r = await c.login('canbo');
  assert.equal(r.location, '/2fa/verify');
  assert.equal((await c.get('/tasks')).location, '/2fa/verify');
});

test('nhãn nhật ký 2 lớp tiếng Việt', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  for (const k of ['totp_enable', 'totp_disable', 'totp_reset', 'recovery_code_used']) {
    assert.match(src, new RegExp(k + ": '[^']+'"), k);
  }
});
