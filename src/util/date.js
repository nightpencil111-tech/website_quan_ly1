// Ngày lưu dạng 'YYYY-MM-DD' theo giờ Việt Nam (UTC+7).
const VN_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86400000;

function today(now = new Date()) {
  return new Date(now.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function toUtcMs(d) {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

function addDays(d, n) {
  return new Date(toUtcMs(d) + n * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / DAY_MS);
}

// 1 = Thứ Hai … 7 = Chủ nhật
function weekday(d) {
  const w = new Date(toUtcMs(d)).getUTCDay();
  return w === 0 ? 7 : w;
}

// 'YYYY-MM-DD' → 'dd/mm/yyyy' để hiển thị.
function fmtDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

module.exports = { today, addDays, daysBetween, weekday, fmtDate };
