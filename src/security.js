// Tiêu đề bảo mật HTTP và bộ chống dò mật khẩu theo IP.

// style-src cần 'unsafe-inline' vì một số view dùng thuộc tính style (vd. độ rộng thanh tiến độ).
// Script chỉ nạp từ tệp của chính hệ thống (không có script inline, không có thuộc tính on*=).
const CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

function securityHeaders(config) {
  const internet = config && config.mode === 'internet';
  return (req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    res.set('Content-Security-Policy', CSP);
    if (internet) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

const IP_MAX_FAILS = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_BLOCK_MS = 15 * 60 * 1000;
const IP_BLOCK_MESSAGE = 'Quá nhiều lần đăng nhập sai từ thiết bị này, thử lại sau 15 phút';

// Khai triển địa chỉ IPv6 thành 8 nhóm hex; null nếu không hợp lệ.
function expandIpv6(s) {
  let str = s.toLowerCase();
  const v4 = str.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const p = v4.slice(1).map(Number);
    if (p.some((x) => x > 255)) return null;
    str = str.slice(0, -v4[0].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = str.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 2 && fill === 0)) return null;
  const all = [...head, ...Array(fill).fill('0'), ...tail];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all;
}

// Khóa đếm theo địa chỉ: IPv4 giữ nguyên; IPv4 ánh xạ (::ffff:a.b.c.d) → a.b.c.d;
// IPv6 lấy tiền tố /64 (một thuê bao Internet thường có cả /64, đổi địa chỉ trong đó không né được bộ đếm).
function ipKey(ip) {
  let s = String(ip || '').trim();
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  if (!s.includes(':')) return s;
  const mapped = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) return mapped[1];
  const g = expandIpv6(s);
  if (!g) return s.toLowerCase();
  return g.slice(0, 4).map((x) => parseInt(x, 16).toString(16)).join(':') + '::/64';
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Người dùng ngồi ngay tại máy chủ (chế độ Internet): kết nối từ loopback và KHÔNG có tiêu đề chuyển tiếp của proxy
// (Tailscale Funnel luôn thêm X-Forwarded-For). Dùng để miễn khóa tài khoản do kẻ khác nhập sai mật khẩu.
function isLocalConsole(req) {
  const config = req.app && req.app.locals && req.app.locals.config;
  if (!config || config.mode !== 'internet') return false;
  const addr = req.socket && req.socket.remoteAddress;
  if (!LOOPBACK.has(addr)) return false;
  const h = req.headers || {};
  return h['x-forwarded-for'] === undefined && h.forwarded === undefined && h['tailscale-funnel-request'] === undefined;
}

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

// Chế độ Internet: mọi yêu cầu thay đổi dữ liệu (kể cả đăng nhập) phải đến từ chính trang của hệ thống.
// Có Sec-Fetch-Site → chỉ nhận same-origin hoặc none; không có → Origin (nếu có) phải trùng publicUrl
// (hoặc là http://localhost khi người dùng ngồi tại máy chủ). Chống CSRF đăng nhập.
function sameOriginGuard(config) {
  const internet = config && config.mode === 'internet';
  const publicOrigin = internet ? originOf(config.publicUrl) : null;
  return (req, res, next) => {
    if (!internet || SAFE_METHODS.includes(req.method)) return next();
    const site = req.get('sec-fetch-site');
    let ok;
    if (site !== undefined) {
      ok = site === 'same-origin' || site === 'none';
    } else {
      const origin = req.get('origin');
      ok = origin === undefined || (!!publicOrigin && origin === publicOrigin) || (LOOPBACK_ORIGIN.test(origin) && isLocalConsole(req));
    }
    if (ok) return next();
    res.set('Connection', 'close');
    return res.status(403).render('error', {
      title: 'Yêu cầu không hợp lệ',
      code: 403,
      message: 'Yêu cầu không xuất phát từ trang của hệ thống, đồng chí mở lại địa chỉ hệ thống rồi thử lại',
    });
  };
}

// Bộ đếm lần sai trong bộ nhớ: khóa → { fails: [thời điểm], blockedUntil }. Dọn định kỳ các mục đã hết hạn.
// keyOf: chuẩn hóa khóa (mặc định giữ nguyên).
function createFailLimiter({ now = Date.now, maxFails = IP_MAX_FAILS, windowMs = IP_WINDOW_MS, blockMs = IP_BLOCK_MS, keyOf = (k) => String(k) } = {}) {
  const map = new Map();

  // k: khóa đã chuẩn hóa.
  function entryOf(k) {
    const t = now();
    const e = map.get(k);
    if (!e) return null;
    if (e.blockedUntil && e.blockedUntil <= t) e.blockedUntil = 0;
    e.fails = e.fails.filter((x) => t - x < windowMs);
    if (!e.blockedUntil && e.fails.length === 0) {
      map.delete(k);
      return null;
    }
    return e;
  }

  function check(key) {
    const e = entryOf(keyOf(key));
    if (e && e.blockedUntil) return { blocked: true, retryAfterMs: e.blockedUntil - now() };
    return { blocked: false, retryAfterMs: 0 };
  }

  // Ghi một lần sai; justBlocked = true đúng một lần, khi lần sai này bắt đầu khóa.
  function fail(key) {
    const k = keyOf(key);
    const t = now();
    const e = entryOf(k) || { fails: [], blockedUntil: 0 };
    map.set(k, e);
    if (e.blockedUntil) return { blocked: true, justBlocked: false };
    e.fails.push(t);
    if (e.fails.length >= maxFails) {
      e.blockedUntil = t + blockMs;
      e.fails = [];
      return { blocked: true, justBlocked: true };
    }
    return { blocked: false, justBlocked: false };
  }

  function reset(key) {
    map.delete(keyOf(key));
  }

  function sweep() {
    for (const k of [...map.keys()]) entryOf(k);
  }

  const timer = setInterval(sweep, 5 * 60 * 1000);
  timer.unref?.();

  return { check, fail, reset, sweep, size: () => map.size, stop: () => clearInterval(timer) };
}

// Chống dò theo IP (IPv6 gộp theo /64).
function createIpLimiter(opts = {}) {
  return createFailLimiter({ ...opts, keyOf: ipKey });
}

// Khóa mật khẩu theo (tài khoản, IP): 5 lần sai từ một IP chỉ khóa tài khoản đó với IP đó, 15 phút.
const ACCOUNT_IP_MAX_FAILS = 5;
const accountIpKey = (userId, ip) => `${userId}|${ipKey(ip)}`;
function createAccountIpLimiter(opts = {}) {
  return createFailLimiter({ maxFails: ACCOUNT_IP_MAX_FAILS, ...opts });
}

module.exports = {
  securityHeaders, sameOriginGuard, createIpLimiter, createFailLimiter, createAccountIpLimiter, accountIpKey, ipKey, isLocalConsole,
  CSP, IP_BLOCK_MESSAGE, IP_MAX_FAILS, ACCOUNT_IP_MAX_FAILS,
};
