// Thông minh Nhóm A: gợi ý người thực hiện, cảnh báo quá tải, điểm ưu tiên, hiệu suất.
const { PRIORITY_WEIGHT, LABELS } = require('../util/text');
const { daysBetween } = require('../util/date');
const { getOverloadThreshold } = require('./users');

const SAME_DAY_LIMIT = 3;
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Gợi ý người thực hiện (spec 6.1).
 * điểm = 0.5×(1 − tải/tải_max) + 0.3×kinh_nghiệm + 0.2×đúng_hạn
 * Chỉ người active, vai trò member/manager. `due_date` (tuỳ chọn) dùng kiểm tra cùng hạn:
 * nếu người đó đã có ≥ (3 − 1) việc mở cùng ngày hạn đó thì thêm việc này sẽ thành ≥ 3 → overloaded.
 * Sắp theo điểm thô giảm dần, hòa → ít việc mở hơn → họ tên. `score` chỉ làm tròn để hiển thị.
 */
function suggestAssignees(db, { category, due_date } = {}, today, limit = 5) {
  const people = db.prepare(
    "SELECT id, full_name FROM users WHERE active = 1 AND role IN ('member','manager')"
  ).all();
  if (!people.length) return [];
  const open = db.prepare(
    `SELECT ta.user_id, t.priority, t.due_date FROM task_assignees ta
       JOIN tasks t ON t.id = ta.task_id WHERE t.status != 'hoan_thanh'`
  ).all();
  const done = db.prepare(
    `SELECT ta.user_id, t.category, t.due_date, t.completed_at FROM task_assignees ta
       JOIN tasks t ON t.id = ta.task_id WHERE t.status = 'hoan_thanh'`
  ).all();
  const threshold = getOverloadThreshold(db);

  const stats = new Map(people.map((p) => [p.id, {
    p, load: 0, openCount: 0, sameDue: 0, exp: 0, done: 0, onTime: 0,
  }]));
  for (const o of open) {
    const s = stats.get(o.user_id);
    if (!s) continue;
    s.load += PRIORITY_WEIGHT[o.priority] || 1;
    s.openCount += 1;
    if (due_date && o.due_date === due_date) s.sameDue += 1;
  }
  for (const d of done) {
    const s = stats.get(d.user_id);
    if (!s) continue;
    s.done += 1;
    if (d.category === category) s.exp += 1;
    if (d.due_date && d.completed_at && d.completed_at.slice(0, 10) <= d.due_date) s.onTime += 1;
  }
  const all = [...stats.values()];
  const maxLoad = Math.max(...all.map((s) => s.load));
  const maxExp = Math.max(...all.map((s) => s.exp));
  const catLabel = LABELS.category[category] || category;

  const rows = all.map((s) => {
    const loadTerm = maxLoad === 0 ? 1 : 1 - s.load / maxLoad;
    const expTerm = maxExp === 0 ? 0 : s.exp / maxExp;
    const onTimeRate = s.done === 0 ? 0.5 : s.onTime / s.done;
    const raw = 0.5 * loadTerm + 0.3 * expTerm + 0.2 * onTimeRate;
    const reasons = [s.openCount ? `Đang có ${s.openCount} việc` : 'Chưa có việc nào'];
    if (s.exp > 0) reasons.push(`Đã làm ${s.exp} việc ${catLabel}`);
    if (s.done > 0) reasons.push(`${Math.round(onTimeRate * 100)}% đúng hạn`);
    const sameDayFull = !!due_date && s.sameDue + 1 >= SAME_DAY_LIMIT;
    if (sameDayFull) reasons.push(`Đã có ${s.sameDue} việc cùng hạn ${due_date.split('-').reverse().join('/')}`);
    return {
      raw, openCount: s.openCount,
      user_id: s.p.id, full_name: s.p.full_name, score: round(raw), reasons,
      overloaded: s.openCount > threshold || sameDayFull,
    };
  });
  rows.sort((x, y) => (y.raw - x.raw) || (x.openCount - y.openCount) || x.full_name.localeCompare(y.full_name, 'vi'));
  return rows.slice(0, limit).map((r, i) => ({
    user_id: r.user_id, full_name: r.full_name, rank: i + 1, score: r.score, reasons: r.reasons, overloaded: r.overloaded,
  }));
}

/** Cảnh báo quá tải: số việc mở > ngưỡng hoặc ≥ 3 việc mở cùng hạn. Chỉ tính người đang hoạt động. */
function overloadWarnings(db, today) { // eslint-disable-line no-unused-vars
  const threshold = getOverloadThreshold(db);
  const rows = db.prepare(
    `SELECT u.id AS user_id, u.full_name, t.due_date FROM users u
       JOIN task_assignees ta ON ta.user_id = u.id JOIN tasks t ON t.id = ta.task_id
      WHERE u.active = 1 AND t.status != 'hoan_thanh' ORDER BY u.full_name COLLATE NOCASE, t.due_date`
  ).all();
  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, { user_id: r.user_id, full_name: r.full_name, open_count: 0, days: new Map() });
    const u = byUser.get(r.user_id);
    u.open_count += 1;
    if (r.due_date) u.days.set(r.due_date, (u.days.get(r.due_date) || 0) + 1);
  }
  const out = [];
  for (const u of byUser.values()) {
    const same_day = [...u.days].filter(([, c]) => c >= SAME_DAY_LIMIT).map(([date, count]) => ({ date, count }));
    if (u.open_count > threshold || same_day.length) {
      out.push({ user_id: u.user_id, full_name: u.full_name, open_count: u.open_count, same_day });
    }
  }
  return out;
}

/** Điểm ưu tiên = hệ_số / max(ngày_còn_lại, 0.5); quá hạn cộng 1000 để luôn đứng đầu. */
function priorityScore(task, today) {
  const w = PRIORITY_WEIGHT[task.priority] || 1;
  const left = task.due_date ? daysBetween(today, task.due_date) : 365;
  return w / Math.max(left, 0.5) + (left < 0 ? 1000 : 0);
}

/** Việc chưa hoàn thành của một người, điểm ưu tiên giảm dần (quá hạn trước). */
function todayList(db, userId, today) {
  const tasks = require('./tasks');
  return tasks.listTasks(db, { assignee_id: userId }, today)
    .filter((t) => t.status !== 'hoan_thanh')
    .map((t) => ({ t, s: priorityScore(t, today) }))
    .sort((a, b) => (b.s - a.s) || (a.t.due_date || '').localeCompare(b.t.due_date || '') || (a.t.id - b.t.id))
    .map((x) => x.t);
}

/** Hiệu suất theo người, trên việc có due_date trong [from, to]. */
function performance(db, { from, to }, today) {
  const rows = db.prepare(
    `SELECT u.id AS user_id, u.full_name, t.status, t.due_date, t.completed_at
       FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id JOIN users u ON u.id = ta.user_id
      WHERE t.due_date >= ? AND t.due_date <= ?`
  ).all(from, to);
  const todayStr = today || require('../util/date').today();
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.user_id)) m.set(r.user_id, { user_id: r.user_id, full_name: r.full_name, assigned: 0, completed: 0, on_time: 0, overdue: 0, rate: 0 });
    const s = m.get(r.user_id);
    s.assigned += 1;
    if (r.status === 'hoan_thanh') {
      s.completed += 1;
      if (r.completed_at && r.completed_at.slice(0, 10) <= r.due_date) s.on_time += 1;
    } else if (r.due_date < todayStr) s.overdue += 1;
  }
  const out = [...m.values()];
  for (const s of out) s.rate = s.assigned ? s.on_time / s.assigned : 0;
  out.sort((a, b) => (b.rate - a.rate) || (b.completed - a.completed) || a.full_name.localeCompare(b.full_name, 'vi'));
  return out;
}

module.exports = { suggestAssignees, overloadWarnings, priorityScore, todayList, performance };
