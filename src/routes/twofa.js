// Xác thực 2 lớp: bật (/2fa/setup), nhập mã khi đăng nhập (/2fa/verify, /2fa/recovery), trang Bảo mật tài khoản.
const express = require('express');
const QRCode = require('qrcode');
const auth = require('../auth');
const audit = require('../services/audit');
const totp = require('../services/totp');
const { IP_BLOCK_MESSAGE, IP_MAX_FAILS } = require('../security');

const WRONG_CODE = 'Mã xác nhận không đúng hoặc đã hết hạn, đồng chí xem lại mã mới nhất trên điện thoại và nhập lại';
const WRONG_RECOVERY = 'Mã dự phòng không đúng hoặc đã dùng';
const LOCKED = 'Tài khoản tạm khóa xác thực 2 lớp 15 phút do nhập sai nhiều lần';
const ACCOUNT_MAX_FAILS = 10;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;
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

  // Secret chờ xác nhận gắn với PHIÊN (sessions.mfa_secret_enc), không ghi vào user_totp trước khi xác nhận:
  // phiên khác (kể cả kẻ gian có mật khẩu) không thấy và không thay được secret người dùng đang quét.
  // Dùng lại trong cùng phiên để mã QR không đổi khi tải lại trang.
  function sessionSecret(req, create) {
    const row = db.prepare('SELECT mfa_secret_enc FROM sessions WHERE id = ?').get(req.sessionId);
    if (row && row.mfa_secret_enc) {
      try { return totp.decryptSecret(row.mfa_secret_enc, key(req)); } catch { /* khóa đổi → tạo secret mới */ }
    }
    if (!create) return null;
    const secret = totp.generateSecret();
    db.prepare('UPDATE sessions SET mfa_secret_enc = ? WHERE id = ?').run(totp.encryptSecret(secret, key(req)), req.sessionId);
    return secret;
  }

  // ---- Khóa theo tài khoản: 10 mã sai (mọi IP, mọi phiên) → khóa xác thực 2 lớp 15 phút ----
  const accountLocked = (req, row) => !!(row && row.locked_until && row.locked_until > clock(req));
  // Ghi một lần sai; trả về true nếu lần này bắt đầu khóa.
  function accountFail(req, who) {
    const row = getRow(who.id);
    if (!row || !row.enabled) return false;
    const fails = (row.fails || 0) + 1;
    if (fails >= ACCOUNT_MAX_FAILS) {
      db.prepare('UPDATE user_totp SET fails = 0, locked_until = ? WHERE user_id = ?').run(clock(req) + ACCOUNT_LOCK_MS, who.id);
      audit.log(db, who.id, 'totp_locked', who.username, `Nhập sai mã 2 lớp ${ACCOUNT_MAX_FAILS} lần, khóa xác thực 2 lớp 15 phút`, ipOf(req));
      return true;
    }
    db.prepare('UPDATE user_totp SET fails = ? WHERE user_id = ?').run(fails, who.id);
    return false;
  }
  const accountOk = (who) => db.prepare('UPDATE user_totp SET fails = 0, locked_until = NULL WHERE user_id = ?').run(who.id);
  const noStore = (res) => res.set('Cache-Control', 'no-store');
  const ipOf = (req) => ({ ip: req.ip || null });

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

  // Nhập sai mã: đếm theo IP (chung với đăng nhập), theo tài khoản (10 lần → khóa 15 phút) và theo phiên chờ
  // (5 lần → hủy phiên). rerender(locked): locked = true khi lần sai này khóa tài khoản.
  function wrongCode(req, res, who, rerender) {
    const locked = accountFail(req, who);
    const ip = req.ip || '';
    const lim = req.app.locals.ipLimiter;
    const f = lim ? lim.fail(ip) : { blocked: false, justBlocked: false };
    if (f.justBlocked) {
      audit.log(db, null, 'login_ip_blocked', ip, `Nhập sai mã xác thực 2 lớp/mật khẩu ${IP_MAX_FAILS} lần trong 15 phút, khóa thiết bị 15 phút`, ipOf(req));
    }
    if (req.pending) {
      const fails = req.pending.fails + 1;
      if (fails >= auth.MFA_MAX_FAILS) {
        audit.log(db, who.id, 'login_fail', who.username, `Nhập sai mã xác thực 2 lớp ${auth.MFA_MAX_FAILS} lần, hủy phiên đăng nhập`, ipOf(req));
        if (f.blocked) return blockedResponse(req, res);
        destroySession(req, res);
        return res.redirect('/login?sai_ma=1');
      }
      db.prepare('UPDATE sessions SET mfa_fails = ? WHERE id = ?').run(fails, req.sessionId);
      audit.log(db, who.id, 'login_fail', who.username, 'Sai mã xác thực 2 lớp', ipOf(req));
    }
    if (f.blocked) return blockedResponse(req, res);
    return rerender(locked);
  }

  // Hiển thị bộ mã dự phòng (một lần, không lưu đệm).
  function showRecoveryCodes(res, codes, next) {
    noStore(res);
    res.render('twofa/recovery-codes', { title: 'Mã dự phòng', codes, next });
  }

  // ---- Bật 2 lớp ----
  async function renderSetup(req, res, who, error, status = 200) {
    const secret = sessionSecret(req, true);
    const uri = totp.otpauthUri(secret, who.username, totp.ISSUER);
    const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: 'M', margin: 1, width: 220 });
    noStore(res);
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
      const secret = sessionSecret(req, false);
      if (!secret) return res.redirect('/2fa/setup');
      const step = totp.verifyTotp(secret, req.body.code, clock(req), null);
      if (step === null) {
        return wrongCode(req, res, who, () => renderSetup(req, res, who, WRONG_CODE).catch(next));
      }
      const codes = totp.makeRecoveryCodes();
      // Chỉ bật khi tài khoản CHƯA có bản bật, với đúng secret đã hiện cho phiên này.
      if (!totp.enableForUser(db, who.id, totp.encryptSecret(secret, key(req)), totp.hashRecoveryCodes(codes), step)) {
        db.prepare('UPDATE sessions SET mfa_secret_enc = NULL WHERE id = ?').run(req.sessionId);
        if (req.pending) {
          db.prepare("UPDATE sessions SET mfa_pending = 'verify' WHERE id = ?").run(req.sessionId);
          return res.redirect('/2fa/verify');
        }
        return res.redirect('/account/security');
      }
      audit.log(db, who.id, 'totp_enable', who.username, null, ipOf(req));
      if (req.pending) auth.completeMfa(db, req, res);
      else db.prepare('UPDATE sessions SET mfa_secret_enc = NULL WHERE id = ?').run(req.sessionId);
      showRecoveryCodes(res, codes, req.pending ? '/' : '/account/security');
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
    if (accountLocked(req, row)) return renderVerify(res, LOCKED, null, 429);
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
    if (step === null) {
      return wrongCode(req, res, who, (locked) => renderVerify(res, locked ? LOCKED : WRONG_CODE, null, locked ? 429 : 200));
    }
    accountOk(who);
    audit.log(db, who.id, 'login', who.username, 'Đúng mã xác thực 2 lớp', ipOf(req));
    auth.completeMfa(db, req, res);
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
    if (accountLocked(req, row)) return renderVerify(res, null, LOCKED, 429);
    const hashes = hashesOf(row);
    const idx = totp.matchRecoveryCode(req.body.recovery_code, hashes);
    if (idx < 0) {
      return wrongCode(req, res, who, (locked) => renderVerify(res, null, locked ? LOCKED : WRONG_RECOVERY, locked ? 429 : 200));
    }
    const used = hashes.splice(idx, 1)[0];
    // Xóa có điều kiện: hai yêu cầu cùng lúc không dùng được một mã hai lần.
    const ch = db.prepare(
      `UPDATE user_totp SET recovery_hashes = ?, fails = 0, locked_until = NULL
        WHERE user_id = ? AND recovery_hashes = ?`
    ).run(JSON.stringify(hashes), who.id, row.recovery_hashes);
    if (ch.changes !== 1 || !used) return renderVerify(res, null, WRONG_RECOVERY);
    audit.log(db, who.id, 'recovery_code_used', who.username, `Còn ${hashes.length} mã dự phòng`, ipOf(req));
    auth.completeMfa(db, req, res);
    res.redirect('/');
  });

  // ---- Bảo mật tài khoản ----
  const renderSecurity = (req, res, error, status = 200) => {
    const row = getRow(req.user.id);
    const enabled = !!(row && row.enabled);
    noStore(res);
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
    if (accountLocked(req, row)) { renderSecurity(req, res, LOCKED, 429); return null; }
    let step = null;
    try {
      step = totp.verifyTotp(totp.decryptSecret(row.secret_enc, key(req)), req.body.code, clock(req), row.last_step);
    } catch { step = null; }
    if (step !== null) {
      const ch = db.prepare('UPDATE user_totp SET last_step = ?, fails = 0, locked_until = NULL WHERE user_id = ? AND (last_step IS NULL OR last_step < ?)')
        .run(step, req.user.id, step);
      if (ch.changes !== 1) step = null;
    }
    if (step === null) {
      wrongCode(req, res, req.user, (locked) => renderSecurity(req, res, locked ? LOCKED : WRONG_CODE, locked ? 429 : 200));
      return null;
    }
    return step;
  }

  r.post('/account/security/disable', auth.requireLogin, (req, res) => {
    if (!canDisable(req, req.user)) return res.status(403).render('error', { title: 'Không tắt được', code: 403, message: NO_DISABLE });
    const step = checkCurrentCode(req, res);
    if (step === null) return;
    db.prepare('DELETE FROM user_totp WHERE user_id = ?').run(req.user.id);
    audit.log(db, req.user.id, 'totp_disable', req.user.username, null, ipOf(req));
    res.redirect('/account/security');
  });

  r.post('/account/security/recovery-codes', auth.requireLogin, (req, res) => {
    const step = checkCurrentCode(req, res);
    if (step === null) return;
    const codes = totp.makeRecoveryCodes();
    db.prepare('UPDATE user_totp SET recovery_hashes = ? WHERE user_id = ?').run(JSON.stringify(totp.hashRecoveryCodes(codes)), req.user.id);
    audit.log(db, req.user.id, 'totp_recovery_regen', req.user.username, null, ipOf(req));
    showRecoveryCodes(res, codes, '/account/security');
  });

  return r;
};
