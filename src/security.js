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

// Lưu trong bộ nhớ: ip → { fails: [thời điểm], blockedUntil }. Dọn định kỳ các mục đã hết hạn.
function createIpLimiter({ now = Date.now, maxFails = IP_MAX_FAILS, windowMs = IP_WINDOW_MS, blockMs = IP_BLOCK_MS } = {}) {
  const map = new Map();

  function entry(ip) {
    const t = now();
    const e = map.get(ip);
    if (!e) return null;
    if (e.blockedUntil && e.blockedUntil <= t) e.blockedUntil = 0;
    e.fails = e.fails.filter((x) => t - x < windowMs);
    if (!e.blockedUntil && e.fails.length === 0) {
      map.delete(ip);
      return null;
    }
    return e;
  }

  function check(ip) {
    const e = entry(ip);
    if (e && e.blockedUntil) return { blocked: true, retryAfterMs: e.blockedUntil - now() };
    return { blocked: false, retryAfterMs: 0 };
  }

  // Ghi một lần sai; justBlocked = true đúng một lần, khi lần sai này bắt đầu khóa IP.
  function fail(ip) {
    const t = now();
    const e = entry(ip) || { fails: [], blockedUntil: 0 };
    map.set(ip, e);
    if (e.blockedUntil) return { blocked: true, justBlocked: false };
    e.fails.push(t);
    if (e.fails.length >= maxFails) {
      e.blockedUntil = t + blockMs;
      e.fails = [];
      return { blocked: true, justBlocked: true };
    }
    return { blocked: false, justBlocked: false };
  }

  function reset(ip) {
    map.delete(ip);
  }

  function sweep() {
    for (const ip of [...map.keys()]) entry(ip);
  }

  const timer = setInterval(sweep, 5 * 60 * 1000);
  timer.unref?.();

  return { check, fail, reset, sweep, size: () => map.size, stop: () => clearInterval(timer) };
}

module.exports = { securityHeaders, createIpLimiter, CSP, IP_BLOCK_MESSAGE, IP_MAX_FAILS };
