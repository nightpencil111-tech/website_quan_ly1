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

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const SESSION_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME = 'sid';

// locked_until lưu ISO UTC; chấp nhận cả số (epoch ms) và 'YYYY-MM-DD HH:MM:SS' (UTC).
function lockedUntilMs(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (/^\d+$/.test(String(v))) return Number(v);
  const s = String(v);
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? 0 : t;
}

function login(db, username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  const bad = { ok: false, error: 'Tên đăng nhập hoặc mật khẩu không đúng' };
  if (!user) {
    audit.log(db, null, 'login_fail', String(username || ''), 'Tên đăng nhập không tồn tại');
    return bad;
  }
  if (!user.active) {
    audit.log(db, user.id, 'login_fail', user.username, 'Tài khoản đã bị vô hiệu hóa');
    return { ok: false, error: 'Tài khoản đã bị khóa, đồng chí liên hệ quản trị viên' };
  }
  const now = Date.now();
  const until = lockedUntilMs(user.locked_until);
  if (until > now) {
    const mins = Math.ceil((until - now) / 60000);
    audit.log(db, user.id, 'login_fail', user.username, 'Tài khoản đang bị khóa tạm thời');
    return { ok: false, error: `Tài khoản đang bị khóa do nhập sai nhiều lần, thử lại sau ${mins} phút` };
  }
  if (until > 0) {
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
    user.failed_logins = 0;
  }
  if (!verifyPassword(password, user.password_hash)) {
    const fails = user.failed_logins + 1;
    if (fails >= MAX_FAILS) {
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
        .run(fails, new Date(now + LOCK_MS).toISOString(), user.id);
      audit.log(db, user.id, 'login_fail', user.username, 'Sai mật khẩu, tài khoản bị khóa 15 phút');
      return { ok: false, error: 'Nhập sai quá 5 lần, tài khoản bị khóa 15 phút' };
    }
    db.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').run(fails, user.id);
    audit.log(db, user.id, 'login_fail', user.username, 'Sai mật khẩu');
    return bad;
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
  const sessionId = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, user.id, crypto.randomBytes(24).toString('hex'), now + SESSION_MS);
  audit.log(db, user.id, 'login', user.username, null);
  return { ok: true, sessionId, mustChangePassword: !!user.must_change_password };
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

function setSessionCookie(res, sessionId) {
  res.append('Set-Cookie', `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

function loadSession(db) {
  return (req, res, next) => {
    req.user = null;
    req.sessionId = null;
    res.locals.user = null;
    res.locals.csrf = '';
    const sid = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (sid) {
      const row = db.prepare(
        `SELECT s.id AS sid, s.csrf, s.expires_at, u.*
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`
      ).get(sid);
      const now = Date.now();
      if (row && row.expires_at > now && row.active) {
        db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(now + SESSION_MS, sid);
        const { sid: _s, csrf, expires_at, password_hash, ...user } = row;
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

function forbid(res) {
  res.status(403).render('error', {
    title: 'Không có quyền',
    code: 403,
    message: 'Đồng chí không có quyền thực hiện chức năng này',
  });
}

// Chuyển về trang đổi mật khẩu khi tài khoản còn cờ must_change_password.
function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
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
};
