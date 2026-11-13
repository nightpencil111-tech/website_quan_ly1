const express = require('express');
const auth = require('../auth');
const audit = require('../services/audit');
const { IP_BLOCK_MESSAGE, IP_MAX_FAILS } = require('../security');

module.exports = (db) => {
  const r = express.Router();

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect('/');
    const error = req.query.sai_ma ? 'Nhập sai mã xác thực quá 5 lần, đồng chí đăng nhập lại' : null;
    res.render('login', { title: 'Đăng nhập', error, username: '' });
  });

  r.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    // Chống dò mật khẩu theo IP (req.ip: IP thật sau Funnel ở chế độ Internet, xem trust proxy trong server.js).
    const limiter = req.app.locals.ipLimiter;
    const ip = req.ip || '';
    if (limiter && limiter.check(ip).blocked) {
      return res.status(429).render('login', { title: 'Đăng nhập', error: IP_BLOCK_MESSAGE, username: username || '' });
    }
    const result = auth.login(db, username, password, { config: req.app.locals.config, now: req.app.locals.now });
    if (!result.ok) {
      if (limiter && limiter.fail(ip).justBlocked) {
        audit.log(db, null, 'login_ip_blocked', ip, `Sai mật khẩu ${IP_MAX_FAILS} lần trong 15 phút, khóa thiết bị 15 phút`);
        return res.status(429).render('login', { title: 'Đăng nhập', error: IP_BLOCK_MESSAGE, username: username || '' });
      }
      return res.status(200).render('login', { title: 'Đăng nhập', error: result.error, username: username || '' });
    }
    auth.setSessionCookie(res, result.sessionId);
    // Chế độ Internet: 2 lớp trước, đổi mật khẩu bắt buộc sau (mật khẩu mặc định bị lộ chưa đủ để vào hệ thống).
    if (result.mfa) return res.redirect(`/2fa/${result.mfa}`);
    res.redirect(result.mustChangePassword ? '/change-password' : '/');
  });

  function doLogout(req, res) {
    auth.logout(db, req.sessionId);
    auth.clearSessionCookie(res);
    res.redirect('/login');
  }
  r.post('/logout', doLogout);
  r.get('/logout', doLogout);

  r.get('/change-password', auth.requireLogin, (req, res) => {
    res.render('change-password', { title: 'Đổi mật khẩu', error: null });
  });

  r.post('/change-password', auth.requireLogin, (req, res) => {
    const { current, password, confirm } = req.body || {};
    const fail = (error) => res.status(200).render('change-password', { title: 'Đổi mật khẩu', error });
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!auth.verifyPassword(current || '', row.password_hash)) return fail('Mật khẩu hiện tại không đúng');
    if (typeof password !== 'string' || password.length < 8) return fail('Mật khẩu mới phải có tối thiểu 8 ký tự');
    if (password !== confirm) return fail('Mật khẩu xác nhận không khớp');
    if (password === current) return fail('Mật khẩu mới phải khác mật khẩu cũ');
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(auth.hashPassword(password), req.user.id);
    audit.log(db, req.user.id, 'change_password', req.user.username, null);
    res.redirect('/');
  });

  return r;
};
