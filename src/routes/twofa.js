// Xác thực 2 lớp: bật (/2fa/setup), nhập mã khi đăng nhập (/2fa/verify, /2fa/recovery), trang Bảo mật tài khoản.
const express = require('express');
const QRCode = require('qrcode');
const auth = require('../auth');
const audit = require('../services/audit');
const totp = require('../services/totp');
const { IP_BLOCK_MESSAGE, IP_MAX_FAILS } = require('../security');

const WRONG_CODE = 'Mã xác nhận không đúng hoặc đã hết hạn, đồng chí xem lại mã mới nhất trên điện thoại và nhập lại';
const WRONG_RECOVERY = 'Mã dự phòng không đúng hoặc đã dùng';
const NO_DISABLE = 'Ở chế độ Internet, tài khoản chỉ huy/quản trị bắt buộc dùng xác thực 2 lớp nên không tự tắt được. Nếu mất điện thoại, đồng chí dùng mã dự phòng hoặc nhờ quản trị viên đặt lại.';

module.exports = (db) => {
  const r = express.Router();
  const clock = (req) => (req.app.locals.now || Date.now)();
  const key = (req) => req.app.locals.totpKey;
  const getRow = (userId) => db.prepare('SELECT * FROM user_totp WHERE user_id = ?').get(userId);
  const hashesOf = (row) => {
    try {
      const v = JSON.parse(row.recovery_hashes || '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const canDisable = (req, user) => !auth.mfaRequiredByRole(req.app.locals.config, user.role);
  const safeNext = (v) => (v === '/account/security' ? v : '/');

  // Người đang bật 2 lớp: phiên chờ bước 'setup', hoặc người đã đăng nhập chưa bật. Trả về null nếu đã chuyển hướng.
  function setupUser(req, res) {
    if (req.pending) {
      if (req.pending.state !== 'setup') { res.redirect('/2fa/verify'); return null; }
      return req.pending.user;
    }
    if (!req.user) { res.redirect('/login'); return null; }
    if (req.user.must_change_password) { res.redirect('/change-password'); return null; }
    if (auth.totpEnabled(db, req.user.id)) { res.redirect('/account/security'); return null; }
    return req.user;
  }

  function verifyUser(req, res) {
    if (req.pending && req.pending.state === 'verify') return req.pending.user;
    if (req.pending) res.redirect('/2fa/setup');
    else res.redirect(req.user ? '/' : '/login');
    return null;
  }

  // Secret đang chờ xác nhận (enabled = 0): dùng lại nếu có để mã QR không đổi khi tải lại trang.
  function pendingSecret(req, userId) {
    const row = getRow(userId);
    if (row && !row.enabled) {
      try { return totp.decryptSecret(row.secret_enc, key(req)); } catch { /* khóa đổi → tạo secret mới */ }
    }
    const secret = totp.generateSecret();
    db.prepare(
      `INSERT INTO user_totp (user_id, secret_enc, enabled, recovery_hashes, last_step) VALUES (?, ?, 0, '[]', NULL)
       ON CONFLICT(user_id) DO UPDATE SET secret_enc = excluded.secret_enc, enabled = 0, recovery_hashes = '[]', last_step = NULL,
         created_at = datetime('now')`
    ).run(userId, totp.encryptSecret(secret, key(req)));
    return secret;
  }

  function destroySession(req, res) {
    if (req.sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
    auth.clearSessionCookie(res);
  }

  // Thiết bị (IP) đang bị khóa? Nếu có thì trả lời 429 và trả về true.
  function ipBlocked(req, res) {
    const lim = req.app.locals.ipLimiter;
    if (!lim || !lim.check(req.ip || '').blocked) return false;
    blockedResponse(req, res);
    return true;
  }

  function blockedResponse(req, res) {
    if (req.pending) {
      destroySession(req, res);
      return res.status(429).render('login', { title: 'Đăng nhập', error: IP_BLOCK_MESSAGE, username: '' });
    }
    return res.status(429).render('error', { title: 'Tạm khóa', code: 429, message: IP_BLOCK_MESSAGE });
  }

  // Nhập sai mã: đếm theo IP (chung với đăng nhập) và theo phiên chờ (5 lần → hủy phiên).
  function wrongCode(req, res, who, rerender) {
    const ip = req.ip || '';
    const lim = req.app.locals.ipLimiter;
    const f = lim ? lim.fail(ip) : { blocked: false, justBlocked: false };
    if (f.justBlocked) {
      audit.log(db, null, 'login_ip_blocked', ip, `Nhập sai mã xác thực 2 lớp/mật khẩu ${IP_MAX_FAILS} lần trong 15 phút, khóa thiết bị 15 phút`);
    }
    if (req.pending) {
      const fails = req.pending.fails + 1;
      if (fails >= auth.MFA_MAX_FAILS) {
        audit.log(db, who.id, 'login_fail', who.username, `Nhập sai mã xác thực 2 lớp ${auth.MFA_MAX_FAILS} lần, hủy phiên đăng nhập`);
        if (f.blocked) return blockedResponse(req, res);
        destroySession(req, res);
        return res.redirect('/login?sai_ma=1');
      }
      db.prepare('UPDATE sessions SET mfa_fails = ? WHERE id = ?').run(fails, req.sessionId);
      audit.log(db, who.id, 'login_fail', who.username, 'Sai mã xác thực 2 lớp');
    }
    if (f.blocked) return blockedResponse(req, res);
    return rerender();
  }

  // Tạo bộ mã dự phòng mới và hiển thị một lần.
  function showRecoveryCodes(res, userId, next, extraSql = '', extraArgs = []) {
    const codes = totp.makeRecoveryCodes();
    db.prepare(`UPDATE user_totp SET recovery_hashes = ?${extraSql} WHERE user_id = ?`)
      .run(JSON.stringify(totp.hashRecoveryCodes(codes)), ...extraArgs, userId);
    res.render('twofa/recovery-codes', { title: 'Mã dự phòng', codes, next });
  }

  // ---- Bật 2 lớp ----
  async function renderSetup(req, res, who, error, status = 200) {
    const secret = pendingSecret(req, who.id);
    const uri = totp.otpauthUri(secret, who.username, totp.ISSUER);
    const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
    res.status(status).render('twofa/setup', {
      title: 'Bật xác thực 2 lớp', qr, secretText: totp.formatSecret(secret), issuer: totp.ISSUER,
      account: who.username, error, forced: !!req.pending,
    });
  }

  r.get('/2fa/setup', async (req, res, next) => {
    try {
      const who = setupUser(req, res);
      if (!who) return;
      await renderSetup(req, res, who, null);
    } catch (e) { next(e); }
  });

  r.post('/2fa/setup', async (req, res, next) => {
    try {
      const who = setupUser(req, res);
      if (!who) return;
      if (ipBlocked(req, res)) return;
      const row = getRow(who.id);
      if (!row || row.enabled) return res.redirect('/2fa/setup');
      let secret;
      try { secret = totp.decryptSecret(row.secret_enc, key(req)); } catch { return res.redirect('/2fa/setup'); }
      const step = totp.verifyTotp(secret, req.body.code, clock(req), null);
      if (step === null) {
        return wrongCode(req, res, who, () => renderSetup(req, res, who, WRONG_CODE).catch(next));
      }
      db.prepare('UPDATE user_totp SET enabled = 1, last_step = ? WHERE user_id = ?').run(step, who.id);
      audit.log(db, who.id, 'totp_enable', who.username, null);
      if (req.pending) auth.completeMfa(db, req.sessionId);
      showRecoveryCodes(res, who.id, req.pending ? '/' : '/account/security');
    } catch (e) { next(e); }
  });

  // Sau khi xem mã dự phòng ("Tôi đã lưu các mã này").
  r.post('/2fa/done', (req, res) => {
    res.redirect(safeNext(req.body && req.body.next));
  });

  // ---- Nhập mã khi đăng nhập ----
  const renderVerify = (res, error, recoveryError, status = 200) =>
    res.status(status).render('twofa/verify', { title: 'Xác thực 2 lớp', error, recoveryError });

  r.get('/2fa/verify', (req, res) => {
    if (!verifyUser(req, res)) return;
    renderVerify(res, null, null);
  });

  r.post('/2fa/verify', (req, res) => {
    const who = verifyUser(req, res);
    if (!who) return;
    if (ipBlocked(req, res)) return;
    const row = getRow(who.id);
    if (!row || !row.enabled) {
      destroySession(req, res);
      return res.redirect('/login');
    }
    let step = null;
    try {
      step = totp.verifyTotp(totp.decryptSecret(row.secret_enc, key(req)), req.body.code, clock(req), row.last_step);
    } catch { step = null; }
    // Ghi bước đã dùng có điều kiện → cùng một mã không dùng được hai lần.
    if (step !== null) {
      const ch = db.prepare('UPDATE user_totp SET last_step = ? WHERE user_id = ? AND (last_step IS NULL OR last_step < ?)')
        .run(step, who.id, step);
      if (ch.changes !== 1) step = null;
    }
    if (step === null) return wrongCode(req, res, who, () => renderVerify(res, WRONG_CODE, null));
    auth.completeMfa(db, req.sessionId);
    res.redirect('/');
  });

  r.post('/2fa/recovery', (req, res) => {
    const who = verifyUser(req, res);
    if (!who) return;
    if (ipBlocked(req, res)) return;
    const row = getRow(who.id);
    if (!row || !row.enabled) {
      destroySession(req, res);
      return res.redirect('/login');
    }
    const hashes = hashesOf(row);
    const idx = totp.matchRecoveryCode(req.body.recovery_code, hashes);
    if (idx < 0) return wrongCode(req, res, who, () => renderVerify(res, null, WRONG_RECOVERY));
    hashes.splice(idx, 1);
    db.prepare('UPDATE user_totp SET recovery_hashes = ? WHERE user_id = ?').run(JSON.stringify(hashes), who.id);
    audit.log(db, who.id, 'recovery_code_used', who.username, `Còn ${hashes.length} mã dự phòng`);
    auth.completeMfa(db, req.sessionId);
    res.redirect('/');
  });

  // ---- Bảo mật tài khoản ----
  const renderSecurity = (req, res, error, status = 200) => {
    const row = getRow(req.user.id);
    const enabled = !!(row && row.enabled);
    res.status(status).render('account-security', {
      title: 'Bảo mật tài khoản', enabled, remaining: enabled ? hashesOf(row).length : 0,
      required: auth.mfaRequiredByRole(req.app.locals.config, req.user.role), canDisable: canDisable(req, req.user), error,
    });
  };

  r.get('/account/security', auth.requireLogin, (req, res) => renderSecurity(req, res, null));

  // Kiểm tra mã hiện tại cho thao tác trên trang Bảo mật tài khoản; trả về bước hoặc null (đã trả lời).
  function checkCurrentCode(req, res) {
    if (ipBlocked(req, res)) return null;
    const row = getRow(req.user.id);
    if (!row || !row.enabled) { res.redirect('/account/security'); return null; }
    let step = null;
    try {
      step = totp.verifyTotp(totp.decryptSecret(row.secret_enc, key(req)), req.body.code, clock(req), row.last_step);
    } catch { step = null; }
    if (step === null) {
      wrongCode(req, res, req.user, () => renderSecurity(req, res, WRONG_CODE));
      return null;
    }
    return step;
  }

  r.post('/account/security/disable', auth.requireLogin, (req, res) => {
    if (!canDisable(req, req.user)) return res.status(403).render('error', { title: 'Không tắt được', code: 403, message: NO_DISABLE });
    const step = checkCurrentCode(req, res);
    if (step === null) return;
    db.prepare('DELETE FROM user_totp WHERE user_id = ?').run(req.user.id);
    audit.log(db, req.user.id, 'totp_disable', req.user.username, null);
    res.redirect('/account/security');
  });

  r.post('/account/security/recovery-codes', auth.requireLogin, (req, res) => {
    const step = checkCurrentCode(req, res);
    if (step === null) return;
    audit.log(db, req.user.id, 'totp_recovery_regen', req.user.username, null);
    showRecoveryCodes(res, req.user.id, '/account/security', ', last_step = ?', [step]);
  });

  return r;
};
