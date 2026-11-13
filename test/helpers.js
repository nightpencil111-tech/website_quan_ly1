const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb, seed } = require('../src/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-ctv-'));
  return openDb(path.join(dir, 'test.db'));
}

// Khởi động server tạm trên cổng ngẫu nhiên, CSDL tạm đã seed.
// opts.config: cấu hình chạy (mặc định chế độ nội bộ); opts.now: đồng hồ giả cho bộ chống dò mật khẩu.
async function startServer(opts = {}) {
  const { createApp } = require('../src/server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-ctv-srv-'));
  const { app, db } = createApp({ dbPath: path.join(dir, 'test.db'), config: opts.config || { mode: 'noi_bo' }, now: opts.now });
  seed(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    db,
    app,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => { try { db.close(); } catch {} resolve(); });
    }),
  };
}

// Đăng nhập, trả về cookie và csrf (đọc từ <meta name="csrf"> của trang chủ).
async function loginAs(base, username, pw) {
  const r = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password: pw }),
  });
  const setCookie = r.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  const page = await fetch(`${base}/`, { headers: { cookie }, redirect: 'manual' });
  let csrf = null;
  if (page.status === 200) {
    const m = (await page.text()).match(/<meta name="csrf" content="([^"]+)"/);
    csrf = m ? m[1] : null;
  }
  return { cookie, csrf };
}

module.exports = { makeDb, startServer, loginAs };
