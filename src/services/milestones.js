// Nhắc mốc và thống kê hồ sơ quân nhân.
const { AppError } = require('../util/errors');
const { RANKS, RANKS_WITHOUT_INTERVAL } = require('../util/ranks');
const { addMonths, daysBetween } = require('../util/date');
const { getSetting } = require('./users');
const audit = require('./audit');

const DEFAULT_REMINDER = 30;
const OVERDUE_LIMIT = 30;

function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function readRankIntervals(db) {
  try {
    const o = JSON.parse(getSetting(db, 'rank_intervals', '{}'));
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      const n = intOrNull(v);
      if (n !== null) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function getMilestoneSettings(db) {
  const rd = intOrNull(getSetting(db, 'reminder_days', null));
  return {
    party_probation_months: intOrNull(getSetting(db, 'party_probation_months', null)),
    service_months: intOrNull(getSetting(db, 'service_months', null)),
    rank_intervals: readRankIntervals(db),
    reminder_days: rd === null ? DEFAULT_REMINDER : rd,
  };
}

function parseInt1(v, max, label) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isInteger(n) || n < 1 || n > max) {
    throw new AppError(`${label} phải là số nguyên từ 1 đến ${max}.`);
  }
  return n;
}

function saveMilestoneSettings(db, data = {}, actorId) {
  const probation = parseInt1(data.party_probation_months, 600, 'Thời gian đảng viên dự bị (tháng)');
  const service = parseInt1(data.service_months, 600, 'Thời hạn phục vụ tại ngũ (tháng)');
  const reminder = parseInt1(data.reminder_days, 365, 'Số ngày nhắc trước');
  const intervals = {};
  for (const [rank, v] of Object.entries(data.rank_intervals || {})) {
    if (!RANKS.includes(rank)) throw new AppError(`Cấp bậc "${rank}" không hợp lệ.`);
    if (RANKS_WITHOUT_INTERVAL.includes(rank)) throw new AppError(`Cấp bậc "${rank}" không có niên hạn.`);
    const n = parseInt1(v, 600, `Niên hạn cấp bậc ${rank} (tháng)`);
    if (n !== null) intervals[rank] = n;
  }
  // Ghi trực tiếp thay vì users.setSetting: cần xóa khóa khi để trống và gói trong một giao dịch.
  const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const del = db.prepare('DELETE FROM settings WHERE key = ?');
  const apply = (k, v) => (v === null ? del.run(k) : put.run(k, String(v)));
  db.exec('BEGIN');
  try {
    apply('party_probation_months', probation);
    apply('service_months', service);
    apply('reminder_days', reminder);
    apply('rank_intervals', Object.keys(intervals).length ? JSON.stringify(intervals) : null);
    audit.log(db, actorId, 'milestone_settings', null,
      `dự bị=${probation ?? '-'}; tại ngũ=${service ?? '-'}; nhắc=${reminder ?? DEFAULT_REMINDER}; niên hạn=${Object.keys(intervals).length} cấp bậc`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function upcomingMilestones(db, today, { soldierId } = {}) {
  const cfg = getMilestoneSettings(db);
  let sql = `SELECT s.id, s.full_name, s.rank, s.rank_date, s.enlist_date, s.discharge_date,
                    s.party_join_date, s.party_official_date, u.name AS unit_name
               FROM soldiers s LEFT JOIN units u ON u.id = s.unit_id
              WHERE s.status = 'dang_cong_tac'`;
  const args = [];
  if (soldierId !== undefined && soldierId !== null) { sql += ' AND s.id = ?'; args.push(soldierId); }
  const soldiers = db.prepare(sql).all(...args);

  const items = [];
  const missing = new Set();
  if (cfg.party_probation_months === null) missing.add('chuyen_dang');
  if (cfg.service_months === null) missing.add('het_han_phuc_vu');

  for (const s of soldiers) {
    const due = [];
    if (s.party_join_date && !s.party_official_date && cfg.party_probation_months !== null) {
      due.push(['chuyen_dang', addMonths(s.party_join_date, cfg.party_probation_months)]);
    }
    if (s.discharge_date) due.push(['het_han_phuc_vu', s.discharge_date]);
    else if (s.enlist_date && cfg.service_months !== null) {
      due.push(['het_han_phuc_vu', addMonths(s.enlist_date, cfg.service_months)]);
    }
    if (s.rank && RANKS.includes(s.rank) && !RANKS_WITHOUT_INTERVAL.includes(s.rank)) {
      const n = cfg.rank_intervals[s.rank];
      if (n === undefined) missing.add('nien_han_quan_ham');
      else if (s.rank_date) due.push(['nien_han_quan_ham', addMonths(s.rank_date, n)]);
    }
    for (const [kind, due_date] of due) {
      const days_left = daysBetween(today, due_date);
      if (days_left >= -OVERDUE_LIMIT && days_left <= cfg.reminder_days) {
        items.push({ soldier_id: s.id, full_name: s.full_name, unit_name: s.unit_name, kind, due_date, days_left });
      }
    }
  }
  items.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.full_name.localeCompare(b.full_name, 'vi') || a.kind.localeCompare(b.kind));
  return { items, missingConfig: [...missing] };
}

function soldierStats(db, today) {
  const total = db.prepare("SELECT COUNT(*) c FROM soldiers WHERE status = 'dang_cong_tac'").get().c;
  const onLeaveToday = db.prepare(
    `SELECT COUNT(DISTINCT l.soldier_id) c
       FROM soldier_leaves l JOIN soldiers s ON s.id = l.soldier_id
      WHERE s.status = 'dang_cong_tac' AND l.from_date IS NOT NULL AND l.from_date <= ? AND COALESCE(l.to_date, l.from_date) >= ?`
  ).get(today, today).c;
  const needAttention = db.prepare(
    `SELECT s.id AS soldier_id, s.full_name, t.level, t.date
       FROM soldiers s JOIN soldier_thoughts t ON t.id = (
              SELECT id FROM soldier_thoughts WHERE soldier_id = s.id
               ORDER BY date DESC, id DESC LIMIT 1)
      WHERE s.status = 'dang_cong_tac' AND t.level IN ('can_quan_tam', 'dac_biet')
      ORDER BY t.date DESC, s.full_name`
  ).all();
  return { total, onLeaveToday, needAttention };
}

module.exports = { getMilestoneSettings, saveMilestoneSettings, upcomingMilestones, soldierStats };
