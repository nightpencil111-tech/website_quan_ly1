// Sửa các phát hiện của đợt rà soát cuối Phần 5 (I1–I4, M7–M9, M12, M13).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const { makeDb, startServer, loginAs } = require('./helpers');
const { seed, openDb } = require('../src/db');
const { hashPassword, login } = require('../src/auth');
const { createIpLimiter, createAccountIpLimiter, ipKey } = require('../src/security');

const INTERNET = { mode: 'internet', publicUrl: 'https://may.tailnet.ts.net' };
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const PW = 'MatKhau#2026';
const LOCK_RE = /khóa/;

function addUser(db, username, role = 'member') {
  const r = db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword(PW), 'Đồng chí ' + username, role);
  return Number(r.lastInsertRowid);
}

async function postLogin(base, username, password, headers = {}) {
  const r = await fetch(base + '/login', {
    method: 'POST', redirect: 'manual', headers: { ...FORM, ...headers },
    body: new URLSearchParams({ username, password }),
  });
  return { status: r.status, location: r.headers.get('location'), text: await r.text(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

// ---------- I1: IP trong nhật ký ----------
test('I1: chế độ Internet, yêu cầu từ loopback kèm X-Forwarded-For 1.2.3.4 → dòng nhật ký có ip = 1.2.3.4', async (t) => {
  const s = await startServer({ config: INTERNET });
  t.after(() => s.close());
  addUser(s.db, 'quanly1', 'manager');
  let r = await postLogin(s.base, 'quanly1', 'sai', { 'x-forwarded-for': '1.2.3.4' });
  assert.equal(r.status, 200);
  r = await postLogin(s.base, 'quanly1', PW, { 'x-forwarded-for': '1.2.3.4' });
  assert.equal(r.location, '/2fa/setup');
  const fail = s.db.prepare("SELECT ip FROM audit_log WHERE action = 'login_fail' ORDER BY id DESC").get();
  const ok = s.db.prepare("SELECT ip FROM audit_log WHERE action = 'login' ORDER BY id DESC").get();
  assert.equal(fail.ip, '1.2.3.4');
  assert.equal(ok.ip, '1.2.3.4');
  // Sai mã 2 lớp ở bước bật cũng ghi IP.
  const page = await (await fetch(s.base + '/2fa/setup', { headers: { cookie: r.cookie, 'x-forwarded-for': '1.2.3.4' } })).text();
  const csrf = page.match(/<meta name="csrf" content="([^"]+)"/)[1];
  await fetch(s.base + '/2fa/setup', {
    method: 'POST', redirect: 'manual', headers: { ...FORM, cookie: r.cookie, 'x-forwarded-for': '1.2.3.4' },
    body: new URLSearchParams({ _csrf: csrf, code: '000000' }),
  });
  const mfaFail = s.db.prepare("SELECT ip, detail FROM audit_log WHERE action = 'login_fail' AND detail LIKE '%2 lớp%' ORDER BY id DESC").get();
  assert.ok(mfaFail, 'có dòng sai mã 2 lớp');
  assert.equal(mfaFail.ip, '1.2.3.4');
});

test('I1: trang Nhật ký có cột IP', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  s.db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'admin'").run();
  const a = await loginAs(s.base, 'admin', 'admin123');
  const html = await (await fetch(s.base + '/admin/audit', { headers: { cookie: a.cookie } })).text();
  assert.match(html, /<th>IP<\/th>/);
  assert.match(html, /<td>127\.0\.0\.1<\/td>/);
});

// ---------- I2: khóa theo (tài khoản, IP), trần toàn cục, miễn cho người ngồi tại máy chủ ----------
test('I2: kẻ gian ở một IP chỉ tự khóa mình; quản trị viên ở IP khác vẫn đăng nhập được', () => {
  const db = makeDb();
  seed(db);
  const accountLimiter = createAccountIpLimiter();
  for (let i = 0; i < 5; i++) login(db, 'admin', 'sai', { ip: '6.6.6.6', accountLimiter });
  const atk = login(db, 'admin', 'admin123', { ip: '6.6.6.6', accountLimiter });
  assert.equal(atk.ok, false);
  assert.match(atk.error, LOCK_RE);
  const real = login(db, 'admin', 'admin123', { ip: '10.0.0.5', accountLimiter });
  assert.equal(real.ok, true, 'IP khác không bị ảnh hưởng');
  assert.equal(db.prepare("SELECT locked_until FROM users WHERE username='admin'").get().locked_until, null);
});

test('I2: trần toàn cục — 30 lần sai từ nhiều IP trong 15 phút → khóa tài khoản mọi nơi 15 phút (có nhật ký)', () => {
  const db = makeDb();
  seed(db);
  const accountLimiter = createAccountIpLimiter();
  let r;
  for (let i = 0; i < 30; i++) r = login(db, 'admin', 'sai', { ip: `10.1.${i}.1`, accountLimiter });
  assert.match(r.error, LOCK_RE);
  const fresh = login(db, 'admin', 'admin123', { ip: '172.16.0.9', accountLimiter });
  assert.equal(fresh.ok, false, 'IP mới cũng bị khóa');
  assert.match(fresh.error, LOCK_RE);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='login_fail' AND detail LIKE '%30 lần%'").get());
  // Hết hạn → vào được, bộ đếm về 0.
  db.prepare("UPDATE users SET locked_until=? WHERE username='admin'").run(new Date(Date.now() - 1000).toISOString());
  assert.equal(login(db, 'admin', 'admin123', { ip: '172.16.0.9', accountLimiter }).ok, true);
  assert.equal(db.prepare("SELECT failed_logins f FROM users WHERE username='admin'").get().f, 0);
});

test('I2: lần sai cũ hơn 15 phút không cộng vào trần toàn cục', () => {
  const db = makeDb();
  seed(db);
  const accountLimiter = createAccountIpLimiter();
  for (let i = 0; i < 29; i++) login(db, 'admin', 'sai', { ip: `10.2.${i}.1`, accountLimiter });
  db.prepare("UPDATE users SET fail_window_start = ? WHERE username='admin'").run(Date.now() - 16 * 60 * 1000);
  const r = login(db, 'admin', 'sai', { ip: '10.3.0.1', accountLimiter });
  assert.doesNotMatch(r.error, LOCK_RE);
  assert.equal(db.prepare("SELECT failed_logins f FROM users WHERE username='admin'").get().f, 1);
});

test('I2 HTTP: người ngồi tại máy chủ (loopback, không X-Forwarded-For) được miễn khóa tài khoản ở chế độ Internet', async (t) => {
  const s = await startServer({ config: INTERNET });
  t.after(() => s.close());
  const atk = { 'x-forwarded-for': '6.6.6.6' };
  for (let i = 0; i < 5; i++) await postLogin(s.base, 'admin', 'sai', atk);
  let r = await postLogin(s.base, 'admin', 'admin123', atk);
  assert.match(r.text, /Tài khoản đang bị khóa/);
  r = await postLogin(s.base, 'admin', 'admin123', { 'x-forwarded-for': '7.7.7.7' });
  assert.equal(r.status, 302, 'IP khác vào được');
  // Khóa toàn cục: IP lạ bị chặn, người tại máy chủ vẫn vào được (vẫn phải đúng mật khẩu + 2 lớp).
  s.db.prepare("UPDATE users SET locked_until = ? WHERE username = 'admin'").run(new Date(Date.now() + 10 * 60 * 1000).toISOString());
  r = await postLogin(s.base, 'admin', 'admin123', { 'x-forwarded-for': '8.8.8.8' });
  assert.match(r.text, /Tài khoản đang bị khóa/);
  r = await postLogin(s.base, 'admin', 'sai');
  assert.match(r.text, /Tên đăng nhập hoặc mật khẩu không đúng/, 'tại máy chủ vẫn phải đúng mật khẩu');
  r = await postLogin(s.base, 'admin', 'admin123');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/2fa/setup', 'tại máy chủ vẫn phải qua 2 lớp');
});

test('I2 HTTP: chế độ nội bộ không miễn khóa cho loopback', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  for (let i = 0; i < 5; i++) await postLogin(s.base, 'admin', 'sai');
  const r = await postLogin(s.base, 'admin', 'admin123');
  assert.match(r.text, /Tài khoản đang bị khóa/);
});

// ---------- I3: thân yêu cầu lớn trước khi xác thực ----------
// Gửi tiêu đề Content-Length 7MB nhưng KHÔNG gửi thân: máy chủ phải trả 401 ngay mà không chờ đọc thân.
function bigPost(base, urlPath, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + urlPath);
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(7 * 1024 * 1024), ...(cookie ? { cookie } : {}) },
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('máy chủ chờ đọc thân yêu cầu (không trả lời ngay)')); }, 3000);
    req.on('response', (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { clearTimeout(timer); req.destroy(); resolve({ status: res.statusCode, body: data }); });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.flushHeaders();
  });
}

test('I3: POST 7MB chưa đăng nhập (401) hoặc vai trò chiến sĩ (403) tới đường tải lớn → trả lời ngay, không đọc thân', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  addUser(s.db, 'chiensi1');
  const m = await loginAs(s.base, 'chiensi1', PW);
  for (const p of ['/soldiers/import/preview', '/documents/templates/upload', '/documents/templates/1/file']) {
    let r = await bigPost(s.base, p, null);
    assert.equal(r.status, 401, p);
    assert.deepEqual(JSON.parse(r.body), { error: 'Phiên đăng nhập không hợp lệ' });
    r = await bigPost(s.base, p, m.cookie);
    assert.equal(r.status, 403, p + ' (chiến sĩ đã đăng nhập: không đủ quyền)');
    assert.match(JSON.parse(r.body).error, /không có quyền/);
  }
});

test('I3: chế độ Internet, phiên chờ 2 lớp cũng bị chặn ở đường tải lớn', async (t) => {
  const s = await startServer({ config: INTERNET });
  t.after(() => s.close());
  addUser(s.db, 'quanly1', 'manager');
  const r = await postLogin(s.base, 'quanly1', PW, { 'x-forwarded-for': '1.2.3.4' });
  assert.equal(r.location, '/2fa/setup');
  const b = await bigPost(s.base, '/documents/templates/upload', r.cookie);
  assert.equal(b.status, 401);
});

// ---------- I4: CLI đặt lại 2 lớp ----------
test('I4: reset2fa xóa 2 lớp, phiên, khóa của tài khoản và ghi nhật ký totp_reset "CLI"', () => {
  const { reset2fa } = require('../scripts/reset-2fa');
  const db = makeDb();
  seed(db);
  const uid = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
  const other = addUser(db, 'khac');
  db.prepare("INSERT INTO user_totp (user_id, secret_enc, enabled) VALUES (?, 'x', 1)").run(uid);
  db.prepare("INSERT INTO user_totp (user_id, secret_enc, enabled) VALUES (?, 'y', 1)").run(other);
  db.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)').run('s1', uid, 'c', Date.now() + 1e6);
  db.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)').run('s2', other, 'c', Date.now() + 1e6);
  db.prepare("UPDATE users SET failed_logins = 12, locked_until = '2999-01-01T00:00:00Z', fail_window_start = 1 WHERE id = ?").run(uid);
  const r = reset2fa(db, 'admin');
  assert.equal(r.ok, true);
  assert.match(r.message, /admin/);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM user_totp WHERE user_id = ?').get(uid).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id = ?').get(uid).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM user_totp WHERE user_id = ?').get(other).c, 1, 'không đụng tài khoản khác');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id = ?').get(other).c, 1);
  const u = db.prepare('SELECT failed_logins, locked_until, fail_window_start FROM users WHERE id = ?').get(uid);
  assert.deepEqual({ ...u }, { failed_logins: 0, locked_until: null, fail_window_start: null });
  const a = db.prepare("SELECT target, detail FROM audit_log WHERE action = 'totp_reset'").get();
  assert.equal(a.target, 'admin');
  assert.equal(a.detail, 'CLI');
  const bad = reset2fa(db, 'khong-co');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Không tìm thấy/);
});

test('I4: chạy CLI thật trên tệp CSDL', () => {
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-ctv-r2fa-'));
  const dbPath = path.join(dir, 'data.db');
  const db = openDb(dbPath);
  seed(db);
  const uid = db.prepare("SELECT id FROM users WHERE username='admin'").get().id;
  db.prepare("INSERT INTO user_totp (user_id, secret_enc, enabled) VALUES (?, 'x', 1)").run(uid);
  db.close();
  const script = path.join(__dirname, '..', 'scripts', 'reset-2fa.js');
  const ok = spawnSync(process.execPath, ['--no-warnings', script, 'admin'], { env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Đã đặt lại xác thực 2 lớp/);
  const no = spawnSync(process.execPath, ['--no-warnings', script], { env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8' });
  assert.equal(no.status, 1);
  assert.match(no.stderr, /Cách dùng/);
  const check = new DatabaseSync(dbPath);
  assert.equal(check.prepare('SELECT COUNT(*) c FROM user_totp').get().c, 0);
  check.close();
});

// ---------- M7: Origin / Sec-Fetch-Site ở chế độ Internet ----------
test('M7: chế độ Internet chặn POST khác nguồn (Origin lạ hoặc Sec-Fetch-Site cross-site), cho phép cùng nguồn', async (t) => {
  const s = await startServer({ config: INTERNET });
  t.after(() => s.close());
  const ip = { 'x-forwarded-for': '1.2.3.4' };
  let r = await postLogin(s.base, 'admin', 'admin123', { ...ip, origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  r = await postLogin(s.base, 'admin', 'admin123', { ...ip, 'sec-fetch-site': 'cross-site' });
  assert.equal(r.status, 403);
  r = await postLogin(s.base, 'admin', 'admin123', { ...ip, 'sec-fetch-site': 'same-site' });
  assert.equal(r.status, 403);
  r = await postLogin(s.base, 'admin', 'admin123', { ...ip, 'sec-fetch-site': 'cross-site', origin: 'https://may.tailnet.ts.net' });
  assert.equal(r.status, 403, 'Sec-Fetch-Site được ưu tiên khi có');
  assert.equal(s.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'login%'").get().c, 0, 'bị chặn trước khi kiểm tra mật khẩu');
  r = await postLogin(s.base, 'admin', 'admin123', { ...ip, origin: 'https://may.tailnet.ts.net' });
  assert.equal(r.status, 302);
  r = await postLogin(s.base, 'admin', 'admin123', { ...ip, 'sec-fetch-site': 'same-origin', origin: 'https://may.tailnet.ts.net' });
  assert.equal(r.status, 302);
  r = await postLogin(s.base, 'admin', 'admin123', { ...ip, 'sec-fetch-site': 'none' });
  assert.equal(r.status, 302);
  r = await postLogin(s.base, 'admin', 'admin123', ip);
  assert.equal(r.status, 302, 'không có cả hai tiêu đề (trình duyệt cũ, công cụ) → cho qua');
  // Yêu cầu GET không bị ảnh hưởng.
  const g = await fetch(s.base + '/login', { headers: { ...ip, 'sec-fetch-site': 'cross-site' } });
  assert.equal(g.status, 200);
  // Người tại máy chủ mở http://localhost:<cổng> bằng trình duyệt không gửi Sec-Fetch-Site.
  r = await postLogin(s.base, 'admin', 'admin123', { origin: s.base });
  assert.equal(r.status, 302, 'Origin loopback từ chính máy chủ được chấp nhận');
  r = await postLogin(s.base, 'admin', 'admin123', { ...ip, origin: s.base });
  assert.equal(r.status, 403, 'Origin loopback qua Funnel bị từ chối');
});

test('M7: chế độ nội bộ không kiểm tra Origin', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const r = await postLogin(s.base, 'admin', 'admin123', { origin: 'http://192.168.1.20:3000' });
  assert.equal(r.status, 302);
});

// ---------- M8: không lộ tên đăng nhập ----------
test('M8: cùng một thông báo cho tên không tồn tại / sai mật khẩu / tài khoản vô hiệu hóa', () => {
  const db = makeDb();
  seed(db);
  addUser(db, 'nghi');
  db.prepare("UPDATE users SET active = 0 WHERE username = 'nghi'").run();
  const a = login(db, 'khongco', 'x', { ip: '1.1.1.1' });
  const b = login(db, 'admin', 'sai', { ip: '1.1.1.2' });
  const c = login(db, 'nghi', PW, { ip: '1.1.1.3' });
  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal(c.ok, false);
  assert.equal(a.error, b.error);
  assert.equal(b.error, c.error);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='login_fail' AND detail LIKE '%vô hiệu hóa%'").get());
});

test('M8: tên không tồn tại vẫn tốn thời gian băm như tên có thật', () => {
  const db = makeDb();
  seed(db);
  const time = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
  login(db, 'khongco', 'x'); // khởi tạo băm giả
  const unknown = time(() => login(db, 'khongco2', 'x', { ip: '9.9.9.1' }));
  const known = time(() => login(db, 'admin', 'sai', { ip: '9.9.9.2' }));
  assert.ok(unknown > known / 4, `tên không tồn tại ${unknown}ms so với ${known}ms`);
});

// ---------- M9: sao lưu không chứa phiên ----------
test('M9: sao lưu bằng lệnh (npm run backup) không chứa phiên đăng nhập', () => {
  const { backup } = require('../scripts/backup');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-ctv-bk9-'));
  const dbPath = path.join(root, 'data', 'data.db');
  const db = openDb(dbPath);
  seed(db);
  const sid = 'a'.repeat(30) + 'SESSIONMARKER' + 'b'.repeat(21);
  db.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, 1, ?, ?)').run(sid, 'csrfmarker', Date.now() + 1e6);
  try {
    const out = backup({ dbPath, dir: path.join(root, 'backups') });
    const b = new DatabaseSync(out);
    assert.equal(b.prepare('SELECT COUNT(*) c FROM sessions').get().c, 0);
    assert.ok(b.prepare('SELECT COUNT(*) c FROM users').get().c >= 1);
    b.close();
    assert.equal(fs.readFileSync(out).includes('SESSIONMARKER'), false, 'mã phiên không còn sót trong tệp');
    assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions').get().c, 1, 'CSDL đang chạy giữ nguyên phiên');
  } finally { db.close(); }
});

test('M9: /admin/backup không chứa phiên, có Cache-Control: no-store', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  s.db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'admin'").run();
  const a = await loginAs(s.base, 'admin', 'admin123');
  const r = await fetch(s.base + '/admin/backup', { headers: { cookie: a.cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control') || '', /no-store/);
  const buf = Buffer.from(await r.arrayBuffer());
  let dbBuf = buf;
  if (/zip/.test(r.headers.get('content-type'))) {
    const PizZip = require('pizzip');
    dbBuf = new PizZip(buf).file('data.db').asNodeBuffer();
  }
  const sid = a.cookie.split('=')[1];
  assert.equal(dbBuf.includes(sid), false, 'mã phiên đang dùng không nằm trong bản sao lưu');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-ctv-bk9h-')), 'x.db');
  fs.writeFileSync(f, dbBuf);
  const b = new DatabaseSync(f);
  assert.equal(b.prepare('SELECT COUNT(*) c FROM sessions').get().c, 0);
  b.close();
});

// ---------- M12: IPv6 theo /64 ----------
test('M12: bộ chống dò gộp IPv6 theo tiền tố /64', () => {
  assert.equal(ipKey('2001:db8:1:2:aaaa::1'), ipKey('2001:0db8:0001:0002:ffff:1:2:3'));
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));
  assert.equal(ipKey('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(ipKey('1.2.3.4'), '1.2.3.4');
  const lim = createIpLimiter();
  for (let i = 1; i <= 10; i++) lim.fail(`2001:db8:1:2::${i.toString(16)}`);
  assert.equal(lim.check('2001:db8:1:2:dead:beef:0:1').blocked, true, 'đổi địa chỉ trong cùng /64 vẫn bị khóa');
  assert.equal(lim.check('2001:db8:1:3::1').blocked, false);
  lim.stop();
});

// ---------- M13: đổi mật khẩu hủy các phiên khác ----------
test('M13: đổi mật khẩu xóa các phiên khác của tài khoản, giữ phiên hiện tại', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  addUser(s.db, 'chiensi2');
  const otherUser = addUser(s.db, 'chiensi3');
  const a = await loginAs(s.base, 'chiensi2', PW);
  const b = await loginAs(s.base, 'chiensi2', PW);
  await loginAs(s.base, 'chiensi3', PW);
  const r = await fetch(s.base + '/change-password', {
    method: 'POST', redirect: 'manual', headers: { ...FORM, cookie: a.cookie },
    body: new URLSearchParams({ _csrf: a.csrf, current: PW, password: 'MatKhauMoi#1', confirm: 'MatKhauMoi#1' }),
  });
  assert.equal(r.status, 302);
  assert.equal((await fetch(s.base + '/', { headers: { cookie: a.cookie }, redirect: 'manual' })).status, 200, 'phiên hiện tại còn');
  const rb = await fetch(s.base + '/', { headers: { cookie: b.cookie }, redirect: 'manual' });
  assert.equal(rb.status, 302);
  assert.equal(rb.headers.get('location'), '/login', 'phiên khác bị hủy');
  assert.equal(s.db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id = ?').get(otherUser).c, 1, 'tài khoản khác không bị ảnh hưởng');
});

// ---------- Rà soát lại: N1, N2, N5 ----------
test('N1: admin còn mật khẩu dữ liệu thử Demo@1234 (npm run demo không bắt đổi) → kiểm tra khởi động chặn', () => {
  const { fillDemo } = require('../scripts/demo-data');
  const { startupProblems } = require('../src/startupCheck');
  const db = makeDb();
  fillDemo(db);
  assert.equal(db.prepare("SELECT must_change_password m FROM users WHERE username='admin'").get().m, 0);
  db.prepare("UPDATE users SET password_hash = ? WHERE username <> 'admin'").run(hashPassword('KhacDemo#2026'));
  const p = startupProblems(db, INTERNET);
  assert.equal(p.length, 1, p.join(' | '));
  assert.match(p[0], /admin/);
  assert.match(p[0], /Demo@1234/);
  assert.match(p[0], /Đổi mật khẩu/);
  db.prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'").run(hashPassword('MatKhauManh#2026'));
  assert.deepEqual(startupProblems(db, INTERNET), []);
});

test('N2: tên có thật và tên không tồn tại nhận cùng chuỗi thông báo qua 7 lần sai (kể cả thông báo khóa)', () => {
  const db = makeDb();
  seed(db);
  const accountLimiter = createAccountIpLimiter();
  const seq = (name) => Array.from({ length: 7 }, () => login(db, name, 'sai', { ip: '5.5.5.5', accountLimiter }).error);
  const real = seq('admin');
  const ghost = seq('khong-ton-tai');
  assert.deepEqual(ghost, real);
  assert.match(real[4], /Nhập sai quá 5 lần/);
  assert.match(real[6], /đang bị khóa/);
  // IP khác không bị ảnh hưởng với tên không tồn tại.
  assert.doesNotMatch(login(db, 'khong-ton-tai', 'sai', { ip: '5.5.5.6', accountLimiter }).error, LOCK_RE);
});

test('N5: isLocalConsole cần Host loopback và không có X-Forwarded-Proto/Host', () => {
  const { isLocalConsole } = require('../src/security');
  const req = (headers, addr = '127.0.0.1', mode = 'internet') => ({
    app: { locals: { config: { mode } } }, socket: { remoteAddress: addr }, headers,
  });
  for (const host of ['localhost', 'localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'LOCALHOST']) {
    assert.equal(isLocalConsole(req({ host })), true, host);
  }
  for (const host of ['may.tailnet.ts.net', 'may.tailnet.ts.net:443', '127.0.0.1.evil.com', '', '10.0.0.1:3000']) {
    assert.equal(isLocalConsole(req({ host })), false, host);
  }
  assert.equal(isLocalConsole(req({ host: 'localhost' })), true);
  assert.equal(isLocalConsole(req({ host: 'localhost', 'x-forwarded-proto': 'https' })), false);
  assert.equal(isLocalConsole(req({ host: 'localhost', 'x-forwarded-host': 'may.tailnet.ts.net' })), false);
  assert.equal(isLocalConsole(req({ host: 'localhost', 'x-forwarded-for': '1.2.3.4' })), false);
  assert.equal(isLocalConsole(req({ host: 'localhost' }, '10.0.0.2')), false);
  assert.equal(isLocalConsole(req({ host: 'localhost' }, '127.0.0.1', 'noi_bo')), false);
});

test('N5 HTTP: yêu cầu loopback có X-Forwarded-Proto không được miễn khóa tài khoản', async (t) => {
  const s = await startServer({ config: INTERNET });
  t.after(() => s.close());
  const proxied = { 'x-forwarded-proto': 'https' };
  for (let i = 0; i < 5; i++) await postLogin(s.base, 'admin', 'sai', proxied);
  let r = await postLogin(s.base, 'admin', 'admin123', proxied);
  assert.match(r.text, /Tài khoản đang bị khóa/);
  r = await postLogin(s.base, 'admin', 'admin123');
  assert.equal(r.status, 302, 'tại máy chủ thật sự (Host 127.0.0.1) vẫn được miễn');
});
