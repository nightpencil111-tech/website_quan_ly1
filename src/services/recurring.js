const { AppError } = require('../util/errors');
const { LABELS } = require('../util/text');
const { addDays, daysBetween, weekday } = require('../util/date');
const audit = require('./audit');
const tasks = require('./tasks');

function hydrate(row) {
  if (!row) return null;
  let ids = [];
  try { ids = JSON.parse(row.assignee_ids_json); } catch { ids = []; }
  return { ...row, assignee_ids: ids };
}

function listRules(db) {
  return db.prepare('SELECT * FROM recurring_rules ORDER BY id').all().map(hydrate);
}

function getRule(db, id) {
  return hydrate(db.prepare('SELECT * FROM recurring_rules WHERE id = ?').get(id));
}

function validate(f) {
  const title = String(f.title ?? '').trim();
  if (!title) throw new AppError('Tiêu đề không được để trống');
  const category = f.category || 'khac';
  if (!Object.hasOwn(LABELS.category, category)) throw new AppError('Lĩnh vực không hợp lệ');
  const priority = f.priority || 'thuong';
  if (!Object.hasOwn(LABELS.priority, priority)) throw new AppError('Mức ưu tiên không hợp lệ');
  if (f.frequency !== 'tuan' && f.frequency !== 'thang') throw new AppError('Tần suất không hợp lệ');
  const day = Number(f.day_value);
  const max = f.frequency === 'tuan' ? 7 : 31;
  if (!Number.isInteger(day) || day < 1 || day > max) {
    throw new AppError(f.frequency === 'tuan' ? 'Thứ trong tuần phải từ Thứ Hai đến Chủ nhật' : 'Ngày trong tháng phải từ 1 đến 31');
  }
  const lead = f.lead_days === undefined || f.lead_days === '' ? 2 : Number(f.lead_days);
  if (!Number.isInteger(lead) || lead < 0 || lead > 60) throw new AppError('Số ngày báo trước phải từ 0 đến 60');
  const ids = [...new Set([].concat(f.assignee_ids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) throw new AppError('Phải chọn ít nhất một người thực hiện');
  const active = f.active === undefined ? 1 : (f.active === 0 || f.active === '0' || f.active === false ? 0 : 1);
  return {
    title, description: String(f.description ?? '').trim() || null, category, priority,
    ids, frequency: f.frequency, day, lead, active,
  };
}

function createRule(db, f, actorId) {
  const v = validate(f);
  const id = Number(db.prepare(
    `INSERT INTO recurring_rules (title, description, category, priority, assignee_ids_json, frequency, day_value, lead_days, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(v.title, v.description, v.category, v.priority, JSON.stringify(v.ids), v.frequency, v.day, v.lead, v.active).lastInsertRowid);
  audit.log(db, actorId, 'rule_create', `rule:${id}`, v.title);
  return id;
}

function updateRule(db, id, f, actorId) {
  if (!getRule(db, id)) throw new AppError('Không tìm thấy quy tắc');
  const v = validate(f);
  db.prepare(
    `UPDATE recurring_rules SET title=?, description=?, category=?, priority=?, assignee_ids_json=?,
       frequency=?, day_value=?, lead_days=?, active=? WHERE id=?`
  ).run(v.title, v.description, v.category, v.priority, JSON.stringify(v.ids), v.frequency, v.day, v.lead, v.active, id);
  audit.log(db, actorId, 'rule_update', `rule:${id}`, v.title);
}

function deleteRule(db, id, actorId) {
  const cur = getRule(db, id);
  if (!cur) throw new AppError('Không tìm thấy quy tắc');
  db.prepare('DELETE FROM recurring_rules WHERE id = ?').run(id);
  audit.log(db, actorId, 'rule_delete', `rule:${id}`, cur.title);
}

const pad = (n) => String(n).padStart(2, '0');
function monthDay(y, m, day) {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1..12
  return `${y}-${pad(m)}-${pad(Math.min(day, last))}`;
}

// Ngày xảy ra đầu tiên >= fromDate.
function nextOccurrence(rule, fromDate) {
  const day = Number(rule.day_value);
  if (rule.frequency === 'tuan') {
    return addDays(fromDate, (day - weekday(fromDate) + 7) % 7);
  }
  let y = Number(fromDate.slice(0, 4));
  let m = Number(fromDate.slice(5, 7));
  let d = monthDay(y, m, day);
  if (d < fromDate) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    d = monthDay(y, m, day);
  }
  return d;
}

// Người tạo việc sinh tự động: quản trị viên đầu tiên còn hoạt động (bảng quy tắc không lưu người tạo).
function systemActorId(db) {
  const u = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
  return u ? u.id : null;
}

// Sinh việc cho các quy tắc đến hạn báo trước. createTask tự mở transaction (R9);
// chống trùng bằng cách kiểm tra việc cùng recurring_id + due_date.
function generateDue(db, today) {
  let count = 0;
  const actor = systemActorId(db);
  for (const rule of listRules(db)) {
    try {
      if (!rule.active) continue;
      const occ = nextOccurrence(rule, today);
      if (daysBetween(today, occ) > rule.lead_days) continue;
      if (rule.last_generated && rule.last_generated >= occ) continue; // đã sinh kỳ này (kể cả khi việc đã bị xóa/đổi hạn)
      const exists = db.prepare('SELECT 1 FROM tasks WHERE recurring_id = ? AND due_date = ?').get(rule.id, occ);
      if (exists) continue;
      const assignees = rule.assignee_ids.filter((uid) =>
        db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(uid));
      if (assignees.length === 0) continue;
      tasks.createTask(db, {
        title: rule.title, description: rule.description, category: rule.category, priority: rule.priority,
        due_date: occ, assignee_ids: assignees, recurring_id: rule.id,
      }, actor);
      db.prepare('UPDATE recurring_rules SET last_generated = ? WHERE id = ?').run(occ, rule.id);
      count += 1;
    } catch (e) {
      // một quy tắc hỏng không làm dừng các quy tắc khác
      console.error(`Lỗi sinh việc định kỳ cho quy tắc ${rule.id}:`, e);
    }
  }
  return count;
}

module.exports = { listRules, getRule, createRule, updateRule, deleteRule, nextOccurrence, generateDue };
