const crypto = require('node:crypto');

// Định dạng: scrypt$<saltHex>$<hashHex>
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length === 0) return false;
  const actual = crypto.scryptSync(String(password), Buffer.from(parts[1], 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}



const audit = require('./services/audit');

const { createAccountIpLimiter, accountIpKey, ACCOUNT_IP_MAX_FAILS } = require('./security');

// Khóa mật khẩu: 5 lần sai từ một IP → khóa tài khoản đó CHỈ với IP đó 15 phút (bộ nhớ, xem security.js);
// thêm trần toàn cục: 30 lần sai từ mọi IP trong 15 phút → khóa tài khoản ở mọi nơi 15 phút (users.locked_until).
const GLOBAL_MAX_FAILS = 30;
const LOCK_MS = 15 * 60 * 1000;
const BAD_LOGIN = 'Tên đăng nhập hoặc mật khẩu không đúng';
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = 'sid';
// Xác thực 2 lớp: vai trò bắt buộc ở chế độ Internet; phiên "đã qua mật khẩu, chưa qua 2 lớp" sống tối đa 5 phút.
const MFA_ROLES = ['admin', 'manager'];
const MFA_PENDING_MS = 5 * 60 * 1000;
const MFA_MAX_FAILS = 5;

function totpEnabled(db, userId) {
  return !!db.prepare('SELECT 1 FROM user_totp WHERE user_id = ? AND enabled = 1').get(userId);
}

function mfaRequiredByRole(config, role) {
  return !!(config && config.mode === 'internet' && MFA_ROLES.includes(role));
}

// Sau khi đúng mật khẩu: 'verify' (đã bật 2 lớp, ở mọi chế độ), 'setup' (bắt buộc mà chưa bật) hoặc null.
function mfaRequirement(db, user, config) {
  if (totpEnabled(db, user.id)) return 'verify';
  if (mfaRequiredByRole(config, user.role)) return 'setup';
  return null;
}

// locked_until lưu ISO UTC; chấp nhận cả số (epoch ms) và 'YYYY-MM-DD HH:MM:SS' (UTC).
function lockedUntilMs(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (/^\d+$/.test(String(v))) return Number(v);
  const s = String(v);
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? 0 : t;
}

// Bộ khóa (tài khoản, IP) mặc định theo từng CSDL, khi gọi login() không truyền opts.accountLimiter (vd. test đơn vị).
const defaultLimiters = new WeakMap();
function defaultAccountLimiter(db) {
  let l = defaultLimiters.get(db);
  if (!l) {
    l = createAccountIpLimiter();
    defaultLimiters.set(db, l);
  }
  return l;
}

// Băm giả để tên đăng nhập không tồn tại cũng tốn thời gian như sai mật khẩu (không đo được thời gian để dò tên).
let dummyHash = null;
function dummyVerify(password) {
  if (!dummyHash) dummyHash = hashPassword(crypto.randomBytes(16).toString('hex'));
  verifyPassword(password, dummyHash);
}

// Ghi một lần sai vào trần toàn cục (cửa sổ 15 phút); trả về true nếu lần này khóa tài khoản.
function globalFail(db, user, now) {
  let start = Number(user.fail_window_start) || 0;
  let fails = user.failed_logins || 0;
  if (!start || now - start >= LOCK_MS) {
    start = now;
    fails = 0;
  }
  fails += 1;
  if (fails >= GLOBAL_MAX_FAILS) {
    db.prepare('UPDATE users SET failed_logins = 0, fail_window_start = NULL, locked_until = ? WHERE id = ?')
      .run(new Date(now + LOCK_MS).toISOString(), user.id);
    return true;
  }
  db.prepare('UPDATE users SET failed_logins = ?, fail_window_start = ? WHERE id = ?').run(fails, start, user.id);
  return false;
}

// opts.config: cấu hình chạy (quyết định có bắt buộc 2 lớp); opts.now: đồng hồ;
// opts.ip: IP người gửi (ghi nhật ký, khóa theo IP); opts.accountLimiter: bộ khóa (tài khoản, IP);
// opts.exemptLocks: người ngồi tại máy chủ ở chế độ Internet → không bị khóa tài khoản (vẫn phải đúng mật khẩu + 2 lớp).
function login(db, username, password, opts = {}) {
  const clock = opts.now || Date.now;
  const ip = opts.ip ? String(opts.ip) : '';
  const aopts = { ip: ip || null };
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  // Cùng một thông báo cho tên không tồn tại, sai mật khẩu, tài khoản vô hiệu hóa (không lộ tên đăng nhập).
  const bad = { ok: false, error: BAD_LOGIN };
  const now = clock();
  const limiter = opts.accountLimiter || defaultAccountLimiter(db);
  const lockedMsg = (ms) => `Tài khoản đang bị khóa do nhập sai nhiều lần, thử lại sau ${Math.max(1, Math.ceil(ms / 60000))} phút`;
  const pairLockedMsg = `Nhập sai quá ${ACCOUNT_IP_MAX_FAILS} lần, tài khoản bị khóa 15 phút`;
  if (!user) {
    // Tên không tồn tại cũng được đếm theo (tên, IP) để thông báo khóa giống hệt tên có thật (không dò được tên).
    const name = String(username || '').trim().slice(0, 100);
    const ghostKey = accountIpKey('u:' + name, ip);
    const gc = limiter.check(ghostKey);
    if (gc.blocked) {
      audit.log(db, null, 'login_fail', name, 'Tên đăng nhập không tồn tại (đang khóa với thiết bị này)', aopts);
      return { ok: false, error: lockedMsg(gc.retryAfterMs) };
    }
    dummyVerify(password);
    audit.log(db, null, 'login_fail', name, 'Tên đăng nhập không tồn tại', aopts);
    if (limiter.fail(ghostKey).justBlocked) return { ok: false, error: pairLockedMsg };
    return bad;
  }
  const pairKey = accountIpKey(user.id, ip);
  const until = lockedUntilMs(user.locked_until);
  if (!opts.exemptLocks) {
    if (until > now) {
      audit.log(db, user.id, 'login_fail', user.username, 'Tài khoản đang bị khóa tạm thời (sai mật khẩu nhiều lần từ nhiều nơi)', aopts);
      return { ok: false, error: lockedMsg(until - now) };
    }
    const pc = limiter.check(pairKey);
    if (pc.blocked) {
      audit.log(db, user.id, 'login_fail', user.username, 'Tài khoản đang bị khóa tạm thời với thiết bị này', aopts);
      return { ok: false, error: lockedMsg(pc.retryAfterMs) };
    }
  }
  if (until > 0 && until <= now) {
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, fail_window_start = NULL WHERE id = ?').run(user.id);
    user.failed_logins = 0;
    user.fail_window_start = null;
  }
  const passwordOk = verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    if (opts.exemptLocks) {
      audit.log(db, user.id, 'login_fail', user.username, 'Sai mật khẩu (tại máy chủ)', aopts);
      return bad;
    }
    const pair = limiter.fail(pairKey);
    if (globalFail(db, user, now)) {
      audit.log(db, user.id, 'login_fail', user.username, `Sai mật khẩu ${GLOBAL_MAX_FAILS} lần trong 15 phút (mọi thiết bị), khóa tài khoản 15 phút`, aopts);
      return { ok: false, error: 'Nhập sai quá nhiều lần, tài khoản bị khóa 15 phút' };
    }
    if (pair.justBlocked) {
      audit.log(db, user.id, 'login_fail', user.username, `Sai mật khẩu ${ACCOUNT_IP_MAX_FAILS} lần, khóa tài khoản 15 phút với thiết bị này`, aopts);
      return { ok: false, error: pairLockedMsg };
    }
    audit.log(db, user.id, 'login_fail', user.username, 'Sai mật khẩu', aopts);
    return bad;
  }
  if (!user.active) {
    audit.log(db, user.id, 'login_fail', user.username, 'Tài khoản đã bị vô hiệu hóa', aopts);
    return bad;
  }
  limiter.reset(pairKey);
  const sessionId = crypto.randomBytes(32).toString('hex');
  const mfa = mfaRequirement(db, user, opts.config);
  const deadline = mfa ? now + MFA_PENDING_MS : null;
  db.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at, mfa_pending, mfa_deadline) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sessionId, user.id, crypto.randomBytes(24).toString('hex'), Date.now() + SESSION_MS, mfa, deadline);
  audit.log(db, user.id, 'login', user.username, mfa ? 'Đúng mật khẩu, chờ xác thực 2 lớp' : null, aopts);
  return { ok: true, sessionId, mustChangePassword: !!user.must_change_password, mfa };
}

function logout(db, sessionId) {
  if (!sessionId) return;
  const s = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(sessionId);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  if (s) audit.log(db, s.user_id, 'logout', null, null);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* bỏ qua */ }
  }
  return out;
}

// Chế độ Internet (qua HTTPS của Tailscale Funnel): cookie thêm Secure.
function cookieSuffix(res) {
  const config = res.app && res.app.locals && res.app.locals.config;
  return config && config.mode === 'internet' ? '; Secure' : '';
}

function setSessionCookie(res, sessionId) {
  res.append('Set-Cookie', `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${cookieSuffix(res)}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSuffix(res)}`);
}

// Phiên chờ 2 lớp: req.user = null (mọi trang coi như chưa đăng nhập), req.pending = { state, user, fails }.
function loadSession(db) {
  return (req, res, next) => {
    req.user = null;
    req.pending = null;
    req.sessionId = null;
    res.locals.user = null;
    res.locals.csrf = '';
    const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (sid) {
      const row = db.prepare(
        `SELECT s.id AS sid, s.csrf, s.expires_at, s.mfa_pending, s.mfa_deadline, s.mfa_fails,
                (SELECT t.enabled FROM user_totp t WHERE t.user_id = u.id) AS totp_enabled, u.*
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
      ).get(sid);
      const now = Date.now();
      const clock = (req.app && req.app.locals && req.app.locals.now) || Date.now;
      const config = req.app && req.app.locals && req.app.locals.config;
      if (row && row.expires_at > now && row.active) {
        let state = row.mfa_pending;
        let deadline = row.mfa_deadline;
        // Trạng thái chờ luôn suy lại từ CSDL: tài khoản đã bật 2 lớp (vd. trên phiên khác) thì phiên chờ bật
        // chuyển sang nhập mã (giữ hạn và số lần sai) — phiên cũ không được bật lại/thay secret.
        if (state === 'setup' && row.totp_enabled) {
          state = 'verify';
          db.prepare("UPDATE sessions SET mfa_pending = 'verify', mfa_secret_enc = NULL WHERE id = ?").run(sid);
        }
        // Phiên đã có từ trước (vd. tạo khi còn chạy chế độ nội bộ) của vai trò bắt buộc mà chưa bật 2 lớp → buộc bật.
        if (!state && mfaRequiredByRole(config, row.role) && !row.totp_enabled) {
          state = 'setup';
          deadline = clock() + MFA_PENDING_MS;
          db.prepare("UPDATE sessions SET mfa_pending = 'setup', mfa_deadline = ?, mfa_fails = 0 WHERE id = ?").run(deadline, sid);
        }
        const { sid: _s, csrf, expires_at, password_hash, mfa_pending, mfa_deadline, mfa_fails, totp_enabled, ...user } = row;
        if (state) {
          if (!(deadline > clock())) {
            db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
            clearSessionCookie(res);
            return next();
          }
          req.pending = { state, user, fails: row.mfa_fails || 0 };
          req.sessionId = sid;
          req.csrf = csrf;
          res.locals.csrf = csrf;
          setSessionCookie(res, sid);
          return next();
        }
        db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(now + SESSION_MS, sid);
        req.user = user;
        req.sessionId = sid;
        req.csrf = csrf;
        res.locals.user = user;
        res.locals.csrf = csrf;
        setSessionCookie(res, sid);
      } else {
        if (row) db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
        clearSessionCookie(res);
      }
    }
    next();
  };
}

// Đặt ngay sau loadSession: phiên chờ 2 lớp chỉ được vào /2fa/* và /logout (tệp tĩnh phục vụ trước loadSession).
function mfaGate(req, res, next) {
  if (!req.pending) return next();
  if (req.path.startsWith('/2fa/') || req.path === '/logout') return next();
  return res.redirect(`/2fa/${req.pending.state}`);
}

// Hoàn tất bước 2 lớp: thay bằng phiên đăng nhập đầy đủ với mã phiên và csrf MỚI (xóa phiên chờ cũ).
function completeMfa(db, req, res) {
  const old = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(req.sessionId);
  if (!old) return;
  const sid = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)').run(sid, old.user_id, csrf, Date.now() + SESSION_MS);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  req.sessionId = sid;
  req.csrf = csrf;
  res.locals.csrf = csrf;
  setSessionCookie(res, sid);
}

function forbid(res) {
  res.status(403).render('error', {
    title: 'Không có quyền',
    code: 403,
    message: 'Đồng chí không có quyền thực hiện chức năng này',
  });
}

// Chuyển về trang đổi mật khẩu khi tài khoản còn cờ must_change_password.
function requireLogin(req, res, next) {
  if (!req.user) return res.redirect(req.pending ? `/2fa/${req.pending.state}` : '/login');
  if (req.user.must_change_password && req.path !== '/change-password' && req.path !== '/logout') {
    return res.redirect('/change-password');
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) return forbid(res);
    next();
  };
}

// Mọi POST (và PUT/PATCH/DELETE) phải kèm token khớp phiên, trong trường _csrf hoặc header X-CSRF-Token.
// Riêng /login chưa có phiên nên được miễn (cookie SameSite=Strict).
function csrfCheck(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/login') return next();
  const token = (req.body && req.body._csrf) || req.get('X-CSRF-Token') || '';
  const expected = req.csrf || '';
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('error', {
      title: 'Yêu cầu không hợp lệ',
      code: 403,
      message: 'Phiên làm việc không hợp lệ hoặc đã hết hạn, đồng chí vui lòng tải lại trang và thử lại',
    });
  }
  next();
}

module.exports = {
  hashPassword, verifyPassword, login, logout, loadSession, requireLogin, requireRole, csrfCheck,
  forbid, setSessionCookie, clearSessionCookie, parseCookies, COOKIE_NAME,
  mfaGate, completeMfa, mfaRequirement, mfaRequiredByRole, totpEnabled, MFA_ROLES, MFA_PENDING_MS, MFA_MAX_FAILS,
};
