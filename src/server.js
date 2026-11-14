const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { openDb, seed } = require('./db');
const auth = require('./auth');
const { loadConfig, normalizeConfig } = require('./config');
const { securityHeaders, sameOriginGuard, createIpLimiter, createAccountIpLimiter } = require('./security');

// config: cấu hình chạy (mặc định đọc từ biến môi trường + quanly.config.json); now: đồng hồ (để test giả lập thời gian).
function createApp({ dbPath, config, now } = {}) {
  config = config ? normalizeConfig(config) : loadConfig(process.env, path.join(__dirname, '..'));
  const db = openDb(dbPath);
  const app = express();
  app.disable('x-powered-by');
  app.locals.config = config;
  app.locals.ipLimiter = createIpLimiter(now ? { now } : {});
  app.locals.accountLimiter = createAccountIpLimiter(now ? { now } : {});
  app.locals.now = now || Date.now;
  // Khóa mã hóa secret 2 lớp: <thư mục CSDL>/secret.key (CSDL trong bộ nhớ → khóa tạm).
  app.locals.totpKey = dbPath && dbPath !== ':memory:'
    ? require('./services/totp').loadKey(path.dirname(path.resolve(dbPath)))
    : require('node:crypto').randomBytes(32);
  // Chế độ Internet: Tailscale Funnel chuyển tiếp từ 127.0.0.1 → chỉ tin X-Forwarded-For từ localhost.
  // Chế độ nội bộ: không tin proxy nào (req.ip = địa chỉ kết nối thật).
  app.set('trust proxy', config.mode === 'internet' ? 'loopback' : false);
  app.use(securityHeaders(config));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.db = db;
  app.locals.fmtDate = require('./util/date').fmtDate;
  app.locals.fmtDateTime = require('./util/date').fmtDateTime;

  // Khung giao diện: render view thành `body` rồi nhét vào views/layout.ejs.
  app.use((req, res, next) => {
    const raw = res.render.bind(res);
    res.render = (view, options, cb) => {
      const opts = { ...res.locals, ...(options || {}) };
      raw(view, opts, (err, body) => {
        if (err) return cb ? cb(err) : next(err);
        raw('layout', { ...opts, body }, cb);
      });
    };
    next();
  });
  // Giá trị mặc định cho giao diện, để trang lỗi vẫn hiển thị được khi body-parser lỗi trước loadSession.
  app.use((req, res, next) => {
    res.locals.user = null;
    res.locals.csrf = '';
    res.locals.path = req.path;
    res.locals.flash = null;
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public')));
  // Chế độ Internet: chặn yêu cầu thay đổi dữ liệu từ trang khác (trước khi đọc thân yêu cầu).
  app.use(sameOriginGuard(config));
  // Phiên đọc từ cookie, không cần thân yêu cầu → chạy TRƯỚC các bộ đọc thân, để thân lớn chỉ được đọc khi đã đăng nhập.
  app.use(auth.loadSession(db));
  // Đường tải tệp lớn (base64 trong JSON): Excel nhập hồ sơ 3MB, mẫu Word 8MB. Chỉ chỉ huy/quản trị đã đăng nhập đầy đủ
  // mới được gửi thân lớn; người khác bị trả 401 (chưa đăng nhập) / 403 (không đủ quyền) ngay, KHÔNG đọc thân (chống làm treo máy bằng yêu cầu ẩn danh).
  const largeBodyGuard = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.user && ['admin', 'manager'].includes(req.user.role)) return next();
    res.set('Connection', 'close');
    if (req.user) return res.status(403).json({ error: 'Đồng chí không có quyền thực hiện chức năng này' });
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });
  };
  for (const [p, limit] of [
    ['/soldiers/import/preview', '3mb'],
    ['/documents/templates/upload', '8mb'],
    ['/documents/templates/:id/file', '8mb'],
  ]) app.use(p, largeBodyGuard, express.json({ limit }));
  app.use(auth.mfaGate);
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.locals.path = req.path;
    res.locals.flash = null;
    res.locals.hasProfile = !!(req.user && db.prepare('SELECT 1 FROM soldiers WHERE user_id = ?').get(req.user.id));
    next();
  });
  app.use(auth.csrfCheck);

  app.use(require('./routes/auth')(db));
  app.use(require('./routes/twofa')(db));
  app.use(require('./routes/dashboard')(db));
  app.use(require('./routes/people')(db));
  app.use(require('./routes/tasks')(db));
  app.use(require('./routes/templates')(db));
  app.use(require('./routes/calendar')(db));
  app.use(require('./routes/reports')(db));
  app.use(require('./routes/soldiers')(db));
  app.use(require('./routes/documents')(db));
  app.use(require('./routes/assistant')(db));
  app.use(require('./routes/admin')(db));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Không tìm thấy', code: 404, message: 'Không tìm thấy trang đồng chí yêu cầu' });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return;
    let status = 500;
    let message = 'Hệ thống gặp sự cố, đồng chí vui lòng thử lại sau hoặc báo quản trị viên';
    if (err && err.type === 'entity.too.large') {
      status = 413;
      message = 'Nội dung quá dài, đồng chí vui lòng rút gọn rồi gửi lại';
    } else if (err && err.status >= 400 && err.status < 500) {
      status = 400;
      message = 'Dữ liệu gửi lên không hợp lệ, đồng chí vui lòng kiểm tra lại';
    }
    const wantsJson = req.is('json') || /application\/json/.test(req.get('accept') || '');
    if (wantsJson) return res.status(status).json({ ok: false, error: message });
    res.status(status).render('error', { title: status === 500 ? 'Lỗi hệ thống' : 'Yêu cầu không hợp lệ', code: status, message }, (e, html) => {
      if (e || !html) {
        console.error(e);
        return res.status(status).type('text/plain; charset=utf-8').send(message);
      }
      res.send(html);
    });
  });

  return { app, db };
}

module.exports = { createApp };

if (require.main === module) {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'data.db');
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  let config;
  try {
    config = loadConfig(process.env, path.join(__dirname, '..'));
  } catch (e) {
    console.error('Không khởi động được: ' + e.message);
    process.exit(1);
  }
  const { app, db } = createApp({ dbPath, config });
  seed(db);
  const { startupProblems } = require('./startupCheck');
  const problems = startupProblems(db, config);
  if (problems.length) {
    console.error('Từ chối chạy ở chế độ Internet vì chưa an toàn:');
    problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}`));
    try { db.close(); } catch { /* bỏ qua */ }
    process.exit(1);
  }
  const { generateDue } = require('./services/recurring');
  const { today } = require('./util/date');
  const runRecurring = () => {
    try { generateDue(db, today()); } catch (e) { console.error('Lỗi sinh việc định kỳ:', e); }
  };
  runRecurring();
  setInterval(runRecurring, 3600 * 1000).unref();
  const port = config.port;
  // Chế độ Internet chỉ nghe 127.0.0.1 (Funnel nối vào localhost) trừ khi cấu hình listenLan: true.
  const host = config.mode === 'internet' && !config.listenLan ? '127.0.0.1' : '0.0.0.0';
  const server = app.listen(port, host, () => {
    console.log(`Hệ thống đã chạy. Mở trình duyệt và truy cập: http://localhost:${port}`);
    if (config.mode === 'internet') {
      console.log(`Chế độ Internet: truy cập từ xa qua ${config.publicUrl}`);
      if (host === '127.0.0.1') console.log('Chỉ nhận kết nối từ chính máy này (Tailscale Funnel); các máy trong mạng nội bộ không truy cập trực tiếp được.');
    }
    if (host === '0.0.0.0') console.log('Các máy khác trong mạng nội bộ truy cập qua địa chỉ IP của máy này, cổng ' + port);
  });
  // Tắt êm: đóng CSDL để WAL được ghi gọn vào data.db.
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close();
    server.closeAllConnections?.();
    try { db.close(); } catch (e) { console.error(e); }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
