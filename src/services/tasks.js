const { AppError } = require('../util/errors');
const { today: vnToday } = require('../util/date');
const { fold, LABELS } = require('../util/text');
const audit = require('./audit');

const isManager = (u) => u && (u.role === 'admin' || u.role === 'manager');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isOverdue(task, today = vnToday()) {
  return task.status !== 'hoan_thanh' && !!task.due_date && task.due_date < today;
}

function taskProgress(task, done = 0, total = 0) {
  if (task.status === 'hoan_thanh') return 100;
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// allowInactive: id người đã được giao việc này, được giữ nguyên dù tài khoản đã bị khóa (R11).
function checkAssignees(db, ids, allowInactive = []) {
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError('Phải chọn ít nhất một người thực hiện');
  const uniq = [...new Set(ids.map(Number))];
  for (const id of uniq) {
    const u = Number.isInteger(id) && db.prepare('SELECT active FROM users WHERE id = ?').get(id);
    if (!u || (!u.active && !allowInactive.includes(id))) throw new AppError('Người thực hiện không tồn tại hoặc đã bị khóa');
  }
  return uniq;
}

function validateFields(f) {
  const title = String(f.title ?? '').trim();
  if (!title) throw new AppError('Tiêu đề không được để trống');
  if (!validDate(f.due_date)) throw new AppError('Hạn hoàn thành không hợp lệ');
  if (!Object.hasOwn(LABELS.category, f.category)) throw new AppError('Lĩnh vực không hợp lệ');
  if (!Object.hasOwn(LABELS.priority, f.priority)) throw new AppError('Mức ưu tiên không hợp lệ');
  return title;
}

function createTask(db, data, actorId) {
  const f = { category: 'khac', priority: 'thuong', ...data };
  const title = validateFields(f);
  const ids = checkAssignees(db, f.assignee_ids);
  return tx(db, () => {
    const id = Number(db.prepare(
      `INSERT INTO tasks (title, description, category, priority, due_date, created_by, template_id, recurring_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(title, f.description ?? null, f.category, f.priority, f.due_date, actorId ?? null,
      f.template_id ?? null, f.recurring_id ?? null).lastInsertRowid);
    const ins = db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)');
    ids.forEach((u) => ins.run(id, u));
    const ci = db.prepare('INSERT INTO checklist_items (task_id, content, position) VALUES (?, ?, ?)');
    (f.checklist || []).map((s) => String(s).trim()).filter(Boolean).forEach((c, i) => ci.run(id, c, i));
    audit.log(db, actorId, 'task_create', `task:${id}`, title);
    return id;
  });
}

function updateTask(db, id, fields, actor) {
  if (!isManager(actor)) throw new AppError('Đồng chí không có quyền sửa công việc');
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!cur) throw new AppError('Không tìm thấy công việc');
  const f = {
    title: cur.title, description: cur.description, category: cur.category,
    priority: cur.priority, due_date: cur.due_date, ...fields,
  };
  const title = validateFields(f);
  const currentIds = db.prepare('SELECT user_id FROM task_assignees WHERE task_id = ?').all(id).map((r) => r.user_id);
  const ids = fields.assignee_ids !== undefined ? checkAssignees(db, fields.assignee_ids, currentIds) : null;
  tx(db, () => {
    db.prepare('UPDATE tasks SET title=?, description=?, category=?, priority=?, due_date=? WHERE id=?')
      .run(title, f.description ?? null, f.category, f.priority, f.due_date, id);
    if (ids) {
      db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(id);
      const ins = db.prepare('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)');
      ids.forEach((u) => ins.run(id, u));
    }
    audit.log(db, actor.id, 'task_update', `task:${id}`, title);
  });
}

function deleteTask(db, id, actor) {
  if (!isManager(actor)) throw new AppError('Đồng chí không có quyền xóa công việc');
  const cur = db.prepare('SELECT title FROM tasks WHERE id = ?').get(id);
  if (!cur) throw new AppError('Không tìm thấy công việc');
  tx(db, () => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    audit.log(db, actor.id, 'task_delete', `task:${id}`, cur.title);
  });
}

function getTask(db, id, today = vnToday()) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) return null;
  t.assignees = db.prepare(
    `SELECT u.id, u.full_name, u.rank, u.active FROM task_assignees ta
       JOIN users u ON u.id = ta.user_id WHERE ta.task_id = ? ORDER BY u.full_name`
  ).all(id);
  t.checklist = db.prepare('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position, id').all(id);
  t.comments = db.prepare(
    `SELECT c.*, u.full_name FROM task_comments c LEFT JOIN users u ON u.id = c.user_id
      WHERE c.task_id = ? ORDER BY c.id`
  ).all(id);
  t.progress = taskProgress(t, t.checklist.filter((c) => c.done).length, t.checklist.length);
  t.overdue = isOverdue(t, today);
  return t;
}

function isAssignee(db, taskId, userId) {
  return !!db.prepare('SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?').get(taskId, userId);
}

function canView(task, user) {
  if (!task || !user) return false;
  if (isManager(user)) return true;
  return (task.assignees || []).some((a) => a.id === user.id);
}

function listTasks(db, filters = {}, today = vnToday()) {
  const where = [];
  const args = [];
  if (filters.status) { where.push('t.status = ?'); args.push(filters.status); }
  if (filters.category) { where.push('t.category = ?'); args.push(filters.category); }
  if (filters.priority) { where.push('t.priority = ?'); args.push(filters.priority); }
  if (filters.assignee_id) {
    where.push('EXISTS (SELECT 1 FROM task_assignees x WHERE x.task_id = t.id AND x.user_id = ?)');
    args.push(Number(filters.assignee_id));
  }
  if (filters.from) { where.push('t.due_date >= ?'); args.push(filters.from); }
  if (filters.to) { where.push('t.due_date <= ?'); args.push(filters.to); }
  if (filters.done_from) { where.push('t.completed_at >= ?'); args.push(filters.done_from); }
  if (filters.done_to) { where.push('t.completed_at <= ?'); args.push(filters.done_to); }
  if (filters.overdue) { where.push("t.status != 'hoan_thanh' AND t.due_date < ?"); args.push(today); }
  const rows = db.prepare(
    `SELECT t.*,
       (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id = t.id) AS cl_total,
       (SELECT COUNT(*) FROM checklist_items c WHERE c.task_id = t.id AND c.done = 1) AS cl_done
       FROM tasks t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.due_date ASC, t.id ASC`
  ).all(...args);
  const q = filters.q ? fold(String(filters.q).trim()) : '';
  const asg = db.prepare(
    `SELECT u.id, u.full_name, u.active FROM task_assignees ta JOIN users u ON u.id = ta.user_id
      WHERE ta.task_id = ? ORDER BY u.full_name`
  );
  const out = [];
  for (const r of rows) {
    if (q && !fold(`${r.title} ${r.description ?? ''}`).includes(q)) continue;
    r.assignees = asg.all(r.id);
    r.progress = taskProgress(r, r.cl_done, r.cl_total);
    r.overdue = isOverdue(r, today);
    out.push(r);
  }
  return out;
}

function changeStatus(db, id, newStatus, actor, note, today = vnToday()) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) throw new AppError('Không tìm thấy công việc');
  if (!Object.hasOwn(LABELS.status, newStatus)) throw new AppError('Trạng thái không hợp lệ');
  if (t.status === newStatus) throw new AppError('Công việc đã ở trạng thái này');
  const text = String(note ?? '').trim();
  if (!isManager(actor)) {
    if (!isAssignee(db, id, actor.id)) throw new AppError('Đồng chí không được giao công việc này');
    const ok = (t.status === 'chua_lam' && newStatus === 'dang_lam')
      || (t.status === 'dang_lam' && newStatus === 'cho_duyet');
    if (!ok) throw new AppError('Đồng chí không có quyền chuyển sang trạng thái này');
  } else if (t.status === 'cho_duyet' && newStatus === 'dang_lam' && !text) {
    throw new AppError('Phải nhập lý do khi trả lại công việc');
  }
  const msg = `Chuyển trạng thái: ${LABELS.status[t.status]} → ${LABELS.status[newStatus]}${text ? ` — ${text}` : ''}`;
  tx(db, () => {
    db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?')
      .run(newStatus, newStatus === 'hoan_thanh' ? today : null, id);
    db.prepare('INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)').run(id, actor.id, msg);
    audit.log(db, actor.id, 'task_status', `task:${id}`, `${t.status} → ${newStatus}${text ? ` — ${text}` : ''}`);
  });
}

function requireAssigneeOrManager(db, taskId, actor) {
  if (!isManager(actor) && !isAssignee(db, taskId, actor.id)) {
    throw new AppError('Đồng chí không được giao công việc này');
  }
}

function addChecklistItem(db, taskId, content, actor) {
  if (!db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId)) throw new AppError('Không tìm thấy công việc');
  requireAssigneeOrManager(db, taskId, actor);
  const text = String(content ?? '').trim();
  if (!text) throw new AppError('Nội dung mục không được để trống');
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM checklist_items WHERE task_id = ?').get(taskId).p;
  return Number(db.prepare('INSERT INTO checklist_items (task_id, content, position) VALUES (?, ?, ?)')
    .run(taskId, text, pos).lastInsertRowid);
}

function toggleChecklistItem(db, itemId, actor) {
  const it = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(itemId);
  if (!it) throw new AppError('Không tìm thấy mục checklist');
  requireAssigneeOrManager(db, it.task_id, actor);
  db.prepare('UPDATE checklist_items SET done = 1 - done WHERE id = ?').run(itemId);
}

function addComment(db, taskId, actor, content) {
  const t = getTask(db, taskId);
  if (!t) throw new AppError('Không tìm thấy công việc');
  if (!canView(t, actor)) throw new AppError('Đồng chí không có quyền xem công việc này');
  const text = String(content ?? '').trim();
  if (!text) throw new AppError('Nội dung trao đổi không được để trống');
  return Number(db.prepare('INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)')
    .run(taskId, actor.id, text).lastInsertRowid);
}

module.exports = {
  createTask, updateTask, deleteTask, getTask, listTasks, canView, changeStatus,
  addChecklistItem, toggleChecklistItem, addComment, taskProgress, isOverdue,
};
