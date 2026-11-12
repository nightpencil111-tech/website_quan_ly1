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

// Cộng n tháng, kẹp về ngày cuối tháng nếu tháng đích ngắn hơn (31/01 + 1 → 28|29/02).
function addMonths(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const pad = (x, w = 2) => String(x).padStart(w, '0');
  return `${pad(ny, 4)}-${pad(nm + 1)}-${pad(Math.min(day, last))}`;
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

// 'YYYY-MM-DD HH:MM:SS' (UTC, như SQLite lưu created_at) → 'dd/mm/yyyy HH:mm' giờ Việt Nam.
function fmtDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
  if (!m) return '';
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + VN_OFFSET_MS;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

module.exports = { today, addDays, addMonths, daysBetween, weekday, fmtDate, fmtDateTime };
