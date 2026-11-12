const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { openDb, seed } = require('./db');
const auth = require('./auth');

function createApp({ dbPath }) {
  const db = openDb(dbPath);
  const app = express();
  app.disable('x-powered-by');
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
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(auth.loadSession(db));
  app.use((req, res, next) => {
    res.locals.path = req.path;
    res.locals.flash = null;
    next();
  });
  app.use(auth.csrfCheck);

  app.use(require('./routes/auth')(db));
  app.use(require('./routes/dashboard')(db));
  app.use(require('./routes/people')(db));
  app.use(require('./routes/tasks')(db));
  app.use(require('./routes/templates')(db));
  app.use(require('./routes/calendar')(db));
  app.use(require('./routes/reports')(db));
  app.use(require('./routes/soldiers')(db));
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
  const { app, db } = createApp({ dbPath });
  seed(db);
  const { generateDue } = require('./services/recurring');
  const { today } = require('./util/date');
  const runRecurring = () => {
    try { generateDue(db, today()); } catch (e) { console.error('Lỗi sinh việc định kỳ:', e); }
  };
  runRecurring();
  setInterval(runRecurring, 3600 * 1000).unref();
  const port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Hệ thống đã chạy. Mở trình duyệt và truy cập: http://localhost:${port}`);
    console.log('Các máy khác trong mạng nội bộ truy cập qua địa chỉ IP của máy này, cổng ' + port);
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
