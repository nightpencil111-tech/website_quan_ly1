// Bảng tổng hợp và báo cáo kỳ (spec 6.7).
const tasksSvc = require('./tasks');
const smart = require('./smart');
const { LABELS } = require('../util/text');
const { addDays, weekday, fmtDate } = require('../util/date');
const { AppError } = require('../util/errors');

const CATS = Object.keys(LABELS.category);
const isoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
  && new Date(s).toISOString().slice(0, 10) === s;

function weekRange(today) {
  const from = addDays(today, 1 - weekday(today));
  return { from, to: addDays(from, 6) };
}

function monthRange(today) {
  const [y, m] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

// Đọc from/to từ query; thiếu cả hai → tuần hiện tại. Sai → AppError.
function parseRange(query, today, fallback = weekRange(today)) {
  const from = String(query?.from ?? '').trim();
  const to = String(query?.to ?? '').trim();
  if (!from && !to) return fallback;
  if (!isoDate(from) || !isoDate(to)) throw new AppError('Ngày không hợp lệ, đồng chí vui lòng chọn lại khoảng thời gian');
  if (from > to) throw new AppError('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  return { from, to };
}

function dashboardStats(db, user, today) {
  const isMgr = user.role === 'admin' || user.role === 'manager';
  const all = tasksSvc.listTasks(db, isMgr ? {} : { assignee_id: user.id }, today);
  const week = weekRange(today);
  const counts = {
    total: all.length, chua_lam: 0, dang_lam: 0, cho_duyet: 0, hoan_thanh: 0, overdue: 0, done_this_week: 0,
  };
  for (const t of all) {
    counts[t.status] += 1;
    if (t.overdue) counts.overdue += 1;
    if (t.status === 'hoan_thanh' && t.completed_at && t.completed_at >= week.from && t.completed_at <= week.to) counts.done_this_week += 1;
  }
  const byCategory = CATS.map((c) => {
    const ts = all.filter((t) => t.category === c);
    return { category: c, label: LABELS.category[c], total: ts.length, done: ts.filter((t) => t.status === 'hoan_thanh').length };
  }).filter((x) => x.total > 0);
  const limit = addDays(today, 7);
  const upcoming = all.filter((t) => t.status !== 'hoan_thanh' && t.due_date && t.due_date >= today && t.due_date <= limit);
  const out = { counts, byCategory, upcoming, week };
  if (isMgr) {
    const m = new Map();
    for (const t of all) {
      for (const a of t.assignees) {
        if (!m.has(a.id)) m.set(a.id, { user_id: a.id, full_name: a.full_name, open: 0, done: 0 });
        m.get(a.id)[t.status === 'hoan_thanh' ? 'done' : 'open'] += 1;
      }
    }
    out.byPerson = [...m.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'vi'));
    out.overload = smart.overloadWarnings(db);
  }
  return out;
}

const who = (t) => (t.assignees || []).map((a) => a.full_name).join(', ');

function periodReport(db, from, to, today) {
  const inRange = tasksSvc.listTasks(db, { from, to }, today);
  const open = tasksSvc.listTasks(db, {}, today).filter((t) => t.status !== 'hoan_thanh' && t.due_date);
  const tonTai = open.filter((t) => t.due_date <= to && t.due_date < today);
  const nextEnd = addDays(to, 7);
  const phuongHuong = open.filter((t) => t.due_date > to && t.due_date <= nextEnd);

  const ketQua = CATS.map((c) => {
    const items = inRange.filter((t) => t.category === c);
    return { category: c, label: LABELS.category[c], done: items.filter((t) => t.status === 'hoan_thanh').length, total: items.length, items };
  }).filter((x) => x.total > 0);

  const total = inRange.length;
  const done = inRange.filter((t) => t.status === 'hoan_thanh').length;
  const onTime = inRange.filter((t) => t.status === 'hoan_thanh' && t.completed_at && t.completed_at <= t.due_date).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const chung = { total, done, onTime, pct, remaining: total - done };

  const L = [];
  L.push('BÁO CÁO KẾT QUẢ THỰC HIỆN NHIỆM VỤ');
  L.push(`(Từ ngày ${fmtDate(from)} đến ngày ${fmtDate(to)})`);
  L.push('');
  L.push('I. TÌNH HÌNH CHUNG');
  if (!total) L.push('Trong kỳ báo cáo không có nhiệm vụ nào đến hạn.');
  else {
    L.push(`Trong kỳ, tổng số nhiệm vụ đến hạn là ${total}; đã hoàn thành ${done} nhiệm vụ, đạt ${pct}%; trong đó ${onTime} nhiệm vụ hoàn thành đúng hạn. Còn ${total - done} nhiệm vụ chưa hoàn thành.`);
  }
  L.push('');
  L.push('II. KẾT QUẢ THỰC HIỆN');
  if (!ketQua.length) L.push('Không có nhiệm vụ nào trong kỳ.');
  ketQua.forEach((k, i) => {
    L.push(`${i + 1}. ${k.label}: hoàn thành ${k.done}/${k.total} nhiệm vụ.`);
    for (const t of k.items) {
      L.push(`- ${t.title} (hạn ${fmtDate(t.due_date)}${who(t) ? `; ${who(t)}` : ''}): ${t.status === 'hoan_thanh' ? 'đã hoàn thành' : LABELS.status[t.status].toLowerCase()}.`);
    }
  });
  L.push('');
  L.push('III. TỒN TẠI, HẠN CHẾ');
  if (!tonTai.length) L.push('Không có nhiệm vụ quá hạn chưa hoàn thành.');
  else {
    L.push(`Còn ${tonTai.length} nhiệm vụ quá hạn chưa hoàn thành:`);
    for (const t of tonTai) L.push(`- ${t.title} (hạn ${fmtDate(t.due_date)}${who(t) ? `; ${who(t)}` : ''}).`);
  }
  L.push('');
  L.push('IV. PHƯƠNG HƯỚNG NHIỆM VỤ KỲ TỚI');
  if (!phuongHuong.length) L.push('Chưa có nhiệm vụ đến hạn trong 07 ngày tới.');
  else {
    L.push(`Tập trung thực hiện ${phuongHuong.length} nhiệm vụ đến hạn trong 07 ngày tới (đến ngày ${fmtDate(nextEnd)}):`);
    for (const t of phuongHuong) L.push(`- ${t.title} (hạn ${fmtDate(t.due_date)}${who(t) ? `; ${who(t)}` : ''}).`);
  }
  L.push('- Khắc phục các tồn tại nêu trên, bảo đảm hoàn thành đúng hạn các nhiệm vụ được giao.');

  return { from, to, sections: { chung, ketQua, tonTai, phuongHuong }, text: L.join('\n') };
}

module.exports = { dashboardStats, periodReport, weekRange, monthRange, parseRange };
