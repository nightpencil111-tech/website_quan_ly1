// Hiểu cụm ngày tiếng Việt trong câu giao việc ("hạn thứ Sáu", "20/12", "trong 3 ngày"...).
// So khớp trên chuỗi đã bỏ dấu (foldAligned) có cùng độ dài với câu gốc, nên chỉ số
// khớp được dùng lại để cắt đúng đoạn gốc (giữ dấu, chữ hoa) ra khỏi tiêu đề.
const { fold } = require('../../util/text');
const { addDays, addMonths, weekday } = require('../../util/date');

// Bỏ dấu + chữ thường, giữ nguyên độ dài (mỗi ký tự gốc ↔ đúng một ký tự).
// Câu gốc phải được chuẩn hóa NFC trước (xem normalizeText).
function normalizeText(s) {
  return String(s ?? '').normalize('NFC');
}

function foldAligned(s) {
  const src = normalizeText(s);
  let out = '';
  for (const ch of src.split('')) {
    if (ch.charCodeAt(0) < 128) { out += ch.toLowerCase(); continue; }
    const f = fold(ch);
    out += f.length === 1 ? f : (f.length ? f[0] : ' ');
  }
  return out;
}

// Đoạn gốc [start, end) có được viết đúng dạng có dấu cho phép, hoặc viết không dấu hẳn không?
// Dùng để phân biệt "thứ" với "thư", "giao" với "giáo", "đảng" với "đang"...
function origMatches(orig, folded, start, end, forms) {
  const o = orig.slice(start, end).toLowerCase();
  if (o === folded.slice(start, end)) return true;
  return forms.some((f) => f.normalize('NFC') === o);
}

const B = '(?<![a-z0-9])';
const E = '(?![a-z0-9])';

const WD = {
  hai: 1, 2: 1, ba: 2, 3: 2, tu: 3, 4: 3, nam: 4, 5: 4, sau: 5, 6: 5, bay: 6, 7: 6,
};

const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Ngày/tháng không ghi năm: chưa qua (kể cả hôm nay) → năm nay, đã qua → năm sau.
function dayMonth(today, d, m, y) {
  if (y) return validDate(Number(y), Number(m), Number(d));
  const ty = Number(today.slice(0, 4));
  const thisYear = validDate(ty, Number(m), Number(d));
  if (thisYear && thisYear >= today) return thisYear;
  return validDate(ty + 1, Number(m), Number(d));
}

// Lần tới của thứ wd (1=Thứ Hai..7=Chủ nhật), nếu hôm nay đúng thứ đó thì là hôm nay.
function nextWeekday(today, wd) {
  return addDays(today, (wd - weekday(today) + 7) % 7);
}

function lastOfMonth(d) {
  const [y, m] = d.split('-').map(Number);
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

// Mỗi mẫu: regex trên chuỗi đã bỏ dấu, hàm tính ngày (null = bỏ qua), kiểm tra dấu (tùy chọn).
const PATTERNS = [
  { re: `${B}hom nay${E}`, fn: (m, t) => t },
  { re: `${B}ngay mai${E}`, fn: (m, t) => addDays(t, 1) },
  { re: `${B}ngay (?:kia|mot)${E}`, fn: (m, t) => addDays(t, 2) },
  {
    // "thứ X" / "chủ nhật" / "CN", có thể kèm "tuần sau|tuần tới".
    // "thứ X tuần sau" = thứ X của tuần lịch kế tiếp (Thứ Hai tuần sau + X − 1; Chủ nhật = +6).
    re: `${B}(?:thu (hai|ba|tu|nam|sau|bay|[2-7])|chu nhat|cn)(?: (tuan (?:sau|toi)))?${E}`,
    fn: (m, t) => {
      const wd = m[1] ? WD[m[1]] : 7;
      if (m[2]) return addDays(t, 8 - weekday(t) + wd - 1);
      return nextWeekday(t, wd);
    },
    check: (orig, folded, start, m) => !m[1] || origMatches(orig, folded, start, start + 3, ['thứ']),
  },
  {
    // "20/12", "ngày 20/12/2027": dấu "/" bắt buộc; dạng gạch "20-12" chỉ nhận khi có "ngày" đứng trước
    // (để "họp 2-3 lần" không thành ngày 02/03).
    re: `${B}(?:ngay )?(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}))?(?![0-9/-])`,
    fn: (m, t) => dayMonth(t, m[1], m[2], m[3]),
  },
  {
    re: `${B}ngay (\\d{1,2})-(\\d{1,2})(?:-(\\d{4}))?(?![0-9/-])`,
    fn: (m, t) => dayMonth(t, m[1], m[2], m[3]),
  },
  {
    re: `${B}ngay (\\d{1,2}) thang (\\d{1,2})(?: nam (\\d{4}))?${E}`,
    fn: (m, t) => dayMonth(t, m[1], m[2], m[3]),
  },
  { re: `${B}trong (?:vong )?(\\d{1,3}) ngay(?: toi)?${E}`, fn: (m, t) => addDays(t, Number(m[1])) },
  { re: `${B}(\\d{1,3}) ngay (?:nua|toi)${E}`, fn: (m, t) => addDays(t, Number(m[1])) },
  // "sau N ngày" (= hôm nay + N); chỉ khi viết "sau" (không phải "sáu").
  {
    re: `${B}sau (\\d{1,3}) ngay(?: (?:nua|toi))?${E}`,
    fn: (m, t) => addDays(t, Number(m[1])),
    check: (orig, folded, start) => origMatches(orig, folded, start, start + 3, ['sau']),
  },
  // "tuần sau" = thứ Sáu của tuần lịch kế tiếp.
  { re: `${B}tuan (?:sau|toi)${E}`, fn: (m, t) => addDays(t, 8 - weekday(t) + 4) },
  // "cuối tuần" = Chủ nhật tuần này (hôm nay Chủ nhật → hôm nay).
  { re: `${B}cuoi tuan(?: nay)?${E}`, fn: (m, t) => addDays(t, 7 - weekday(t)) },
  { re: `${B}cuoi thang (?:sau|toi)${E}`, fn: (m, t) => lastOfMonth(addMonths(t.slice(0, 8) + '01', 1)) },
  { re: `${B}cuoi thang(?: nay)?${E}`, fn: (m, t) => lastOfMonth(t) },
  { re: `${B}dau thang (?:sau|toi)${E}`, fn: (m, t) => addMonths(t.slice(0, 8) + '05', 1) },
].map((p) => ({ ...p, re: new RegExp(p.re, 'g') }));

// Từ dẫn trước cụm ngày, được tính vào phrase để loại khỏi tiêu đề.
const PREFIX = new RegExp(`${B}(?:han chot|han|xong truoc|truoc|cham nhat)\\s*:?\\s*$`);

function resolveDatePhrase(text, today) {
  const orig = normalizeText(text);
  const folded = foldAligned(orig);
  let best = null;
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(folded))) {
      const start = m.index;
      const end = start + m[0].length;
      if (best && (start > best.start || (start === best.start && end <= best.end))) continue;
      if (p.check && !p.check(orig, folded, start, m)) continue;
      const date = p.fn(m, today);
      if (!date) continue;
      best = { start, end, date };
    }
  }
  if (!best) return null;
  const pre = PREFIX.exec(folded.slice(0, best.start));
  const start = pre ? pre.index : best.start;
  return { date: best.date, phrase: orig.slice(start, best.end), start, end: best.end };
}

module.exports = { resolveDatePhrase, foldAligned, normalizeText, origMatches };
