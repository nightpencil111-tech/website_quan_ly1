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
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
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
  app.use(require('./routes/admin')(db));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Không tìm thấy', code: 404, message: 'Không tìm thấy trang đồng chí yêu cầu' });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).render('error', { title: 'Lỗi hệ thống', code: 500, message: 'Hệ thống gặp sự cố, đồng chí vui lòng thử lại sau hoặc báo quản trị viên' });
  });

  return { app, db };
}

module.exports = { createApp };

if (require.main === module) {
  const dbPath = process.env.DB_PATH || 'data/data.db';
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const { app, db } = createApp({ dbPath });
  seed(db);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Hệ thống đã chạy. Mở trình duyệt và truy cập: http://localhost:${port}`);
    console.log('Các máy khác trong mạng nội bộ truy cập qua địa chỉ IP của máy này, cổng ' + port);
  });
}
