const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, makeDb } = require('./helpers');
const { createIpLimiter } = require('../src/security');
const { startupProblems } = require('../src/startupCheck');
const { seed } = require('../src/db');
const { hashPassword } = require('../src/auth');

const form = (o) => new URLSearchParams(o);
const H = { 'content-type': 'application/x-www-form-urlencoded' };
const INTERNET = { mode: 'internet', publicUrl: 'https://may.tailnet.ts.net' };
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const BLOCK_MSG = 'Quá nhiều lần đăng nhập sai từ thiết bị này, thử lại sau 15 phút';

function postLogin(base, username, password, headers = {}) {
  return fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { ...H, ...headers }, body: form({ username, password }) });
}

test('tiêu đề bảo mật ở chế độ nội bộ (không có HSTS)', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  for (const url of ['/login', '/css/app.css', '/khong-co']) {
    const r = await fetch(s.base + url);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', url);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', url);
    assert.equal(r.headers.get('referrer-policy'), 'same-origin', url);
    assert.equal(r.headers.get('content-security-policy'), CSP, url);
    assert.equal(r.headers.get('strict-transport-security'), null, url);
  }
});

test('tiêu đề bảo mật ở chế độ Internet có HSTS', async (t) => {
  const s = await startServer({ config: INTERNET });
  t.after(() => s.close());
  const r = await fetch(s.base + '/login');
  assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(r.headers.get('content-security-policy'), CSP);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('cookie phiên có Secure chỉ ở chế độ Internet', async (t) => {
  const a = await startServer();
  const b = await startServer({ config: INTERNET });
  t.after(() => Promise.all([a.close(), b.close()]));
  const ra = await postLogin(a.base, 'admin', 'admin123');
  assert.equal(ra.status, 302);
  assert.doesNotMatch(ra.headers.get('set-cookie'), /Secure/i);
  const rb = await postLogin(b.base, 'admin', 'admin123');
  assert.equal(rb.status, 302);
  assert.match(rb.headers.get('set-cookie'), /;\s*Secure/i);
  // Cookie gia hạn ở mỗi request và cookie xóa khi đăng xuất cũng có Secure.
  const cookie = rb.headers.get('set-cookie').split(';')[0];
  const r2 = await fetch(b.base + '/change-password', { headers: { cookie }, redirect: 'manual' });
  assert.match(r2.headers.get('set-cookie'), /;\s*Secure/i);
  const r3 = await fetch(b.base + '/logout', { headers: { cookie }, redirect: 'manual' });
  assert.match(r3.headers.get('set-cookie'), /Max-Age=0.*Secure|Secure.*Max-Age=0/i);
});

test('bộ chống dò theo IP (đơn vị): 10 lần sai → khóa 15 phút, IP khác không ảnh hưởng', () => {
  let t = 1_000_000;
  const lim = createIpLimiter({ now: () => t });
  for (let i = 0; i < 9; i++) {
    assert.equal(lim.check('1.1.1.1').blocked, false);
    assert.equal(lim.fail('1.1.1.1').justBlocked, false);
  }
  assert.equal(lim.check('1.1.1.1').blocked, false);
  assert.equal(lim.fail('1.1.1.1').justBlocked, true, 'lần sai thứ 10 bắt đầu khóa');
  assert.equal(lim.check('1.1.1.1').blocked, true);
  assert.equal(lim.fail('1.1.1.1').justBlocked, false, 'chỉ báo bắt đầu khóa một lần');
  assert.equal(lim.check('2.2.2.2').blocked, false);
  t += 15 * 60 * 1000 - 1;
  assert.equal(lim.check('1.1.1.1').blocked, true);
  t += 2;
  assert.equal(lim.check('1.1.1.1').blocked, false, 'sau 15 phút mở lại');
  assert.equal(lim.fail('1.1.1.1').justBlocked, false, 'đếm lại từ đầu sau khi mở');
});

test('bộ chống dò theo IP: lần sai cũ hơn 15 phút không tính', () => {
  let t = 0;
  const lim = createIpLimiter({ now: () => t });
  for (let i = 0; i < 9; i++) lim.fail('1.1.1.1');
  t += 15 * 60 * 1000 + 1;
  assert.equal(lim.fail('1.1.1.1').justBlocked, false);
  assert.equal(lim.check('1.1.1.1').blocked, false);
  lim.reset('1.1.1.1');
  for (let i = 0; i < 9; i++) lim.fail('1.1.1.1');
  lim.reset('1.1.1.1');
  assert.equal(lim.fail('1.1.1.1').justBlocked, false);
});

test('HTTP: 10 lần sai cùng IP → lần 11 bị chặn kể cả đúng mật khẩu; IP khác vẫn vào; 15 phút sau mở lại', async (t) => {
  let now = Date.now();
  const s = await startServer({ config: INTERNET, now: () => now });
  t.after(() => s.close());
  const A = { 'x-forwarded-for': '1.2.3.4' };
  const B = { 'x-forwarded-for': '5.6.7.8' };
  for (let i = 0; i < 9; i++) {
    const r = await postLogin(s.base, 'nguoi-la-' + i, 'sai', A);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /không đúng/);
  }
  const tenth = await postLogin(s.base, 'nguoi-la-9', 'sai', A);
  assert.equal(tenth.status, 429, 'lần sai thứ 10 bắt đầu khóa');
  assert.match(await tenth.text(), new RegExp(BLOCK_MSG));
  const blocked = await postLogin(s.base, 'admin', 'admin123', A);
  assert.equal(blocked.status, 429);
  assert.match(await blocked.text(), new RegExp(BLOCK_MSG));
  assert.equal(blocked.headers.get('set-cookie'), null);
  const logs = s.db.prepare("SELECT target FROM audit_log WHERE action = 'login_ip_blocked'").all();
  assert.deepEqual(logs.map((l) => l.target), ['1.2.3.4'], 'ghi nhật ký một lần khi bắt đầu khóa');
  const other = await postLogin(s.base, 'admin', 'admin123', B);
  assert.equal(other.status, 302, 'IP khác vẫn đăng nhập được');
  now += 15 * 60 * 1000 + 1000;
  const again = await postLogin(s.base, 'admin', 'admin123', A);
  assert.equal(again.status, 302, 'sau 15 phút mở lại');
});

test('nhãn nhật ký login_ip_blocked tiếng Việt', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'admin.js'), 'utf8');
  assert.match(src, /login_ip_blocked: '[^']*(IP|thiết bị)[^']*'/);
});

test('trust proxy: chế độ Internet tin X-Forwarded-For từ 127.0.0.1; chế độ nội bộ bỏ qua', async (t) => {
  const inet = await startServer({ config: INTERNET });
  const lan = await startServer();
  t.after(() => Promise.all([inet.close(), lan.close()]));
  assert.equal(inet.app.get('trust proxy fn')('127.0.0.1', 0), true);
  assert.equal(inet.app.get('trust proxy fn')('10.0.0.5', 0), false, 'không tin proxy ngoài localhost');
  assert.equal(lan.app.get('trust proxy fn')('127.0.0.1', 0), false);
  // Chế độ nội bộ: X-Forwarded-For bị bỏ qua → đổi header không lách được khóa.
  for (let i = 0; i < 10; i++) await postLogin(lan.base, 'x' + i, 'sai', { 'x-forwarded-for': '1.2.3.4' });
  const r = await postLogin(lan.base, 'admin', 'admin123', { 'x-forwarded-for': '9.9.9.9' });
  assert.equal(r.status, 429);
  const row = lan.db.prepare("SELECT target FROM audit_log WHERE action = 'login_ip_blocked'").get();
  assert.equal(row.target, '127.0.0.1');
  // Chế độ Internet: IP lấy từ X-Forwarded-For.
  for (let i = 0; i < 10; i++) await postLogin(inet.base, 'x' + i, 'sai', { 'x-forwarded-for': '1.2.3.4' });
  const row2 = inet.db.prepare("SELECT target FROM audit_log WHERE action = 'login_ip_blocked'").get();
  assert.equal(row2.target, '1.2.3.4');
});

test('startupProblems: chế độ nội bộ không kiểm tra', () => {
  const db = makeDb(); seed(db);
  assert.deepEqual(startupProblems(db, { mode: 'noi_bo', publicUrl: '' }), []);
});

test('startupProblems: từng trường hợp nguy hiểm ở chế độ Internet và cấu hình tốt', () => {
  const db = makeDb(); seed(db);
  const good = { mode: 'internet', publicUrl: 'https://may.tailnet.ts.net' };
  // admin còn phải đổi mật khẩu
  let p = startupProblems(db, good);
  assert.equal(p.length, 1);
  assert.match(p[0], /admin.*đổi mật khẩu/);
  db.prepare("UPDATE users SET must_change_password = 0, password_hash = ? WHERE username = 'admin'").run(hashPassword('MatKhauManh#2026'));
  assert.deepEqual(startupProblems(db, good), [], 'cấu hình tốt → không có lỗi');
  // publicUrl
  for (const bad of ['', 'http://may.tailnet.ts.net', 'may.ts.net', undefined]) {
    p = startupProblems(db, { mode: 'internet', publicUrl: bad });
    assert.equal(p.length, 1, String(bad));
    assert.match(p[0], /publicUrl.*https:\/\//);
  }
  // tài khoản dữ liệu thử
  const ins = db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, 'Thử', 'member')");
  ins.run('cs03', hashPassword('Demo@1234'));
  ins.run('ctv', hashPassword('Demo@1234'));
  ins.run('cs11', hashPassword('Demo@1234'));
  ins.run('cs04', hashPassword('KhacDemo#1'));
  p = startupProblems(db, good);
  assert.equal(p.length, 1);
  assert.match(p[0], /dữ liệu thử/);
  assert.match(p[0], /ctv/);
  assert.match(p[0], /cs03/);
  assert.doesNotMatch(p[0], /cs11|cs04/);
  // nhiều lỗi cùng lúc
  db.prepare("UPDATE users SET must_change_password = 1 WHERE username = 'admin'").run();
  assert.equal(startupProblems(db, { mode: 'internet' }).length, 3);
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.ejs') ? [p] : [];
  });
}

test('không còn script inline hay thuộc tính on*= trong views (CSP)', () => {
  const files = walk(path.join(__dirname, '..', 'views'));
  assert.ok(files.length > 20);
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(path.join(__dirname, '..'), f);
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(src))) {
      const attrs = m[1];
      if (/type=["']application\/json["']/i.test(attrs)) continue;
      if (/\bsrc=/i.test(attrs) && m[2].trim() === '') continue;
      bad.push(`${rel}: <script${attrs}>`);
    }
    if (/<script\b(?![^>]*>[\s\S]*?<\/script>)/i.test(src)) bad.push(`${rel}: <script> không đóng`);
    const on = src.match(/\son[a-z]+\s*=\s*["']/gi);
    if (on) bad.push(`${rel}: ${on.join(', ')}`);
    if (/javascript:/i.test(src)) bad.push(`${rel}: javascript:`);
  }
  assert.deepEqual(bad, []);
});

test('layout nạp confirm.js; confirm.js xử lý data-confirm', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'views', 'layout.ejs'), 'utf8');
  assert.match(layout, /<script src="\/js\/confirm\.js"( defer)?><\/script>/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'confirm.js'), 'utf8');
  assert.match(js, /data-confirm/);
  assert.match(js, /preventDefault/);
});

test('trang có nút xóa dùng data-confirm thay cho onsubmit', () => {
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'views', 'tasks', 'detail.ejs'), 'utf8');
  assert.match(tpl, /data-confirm="Xóa công việc này\?[^"]*"/);
});
