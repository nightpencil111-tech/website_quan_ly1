const express = require('express');
const { requireLogin, requireRole, forbid } = require('../auth');
const tasks = require('../services/tasks');
const users = require('../services/users');
const { AppError } = require('../util/errors');
const { LABELS } = require('../util/text');

const isManager = (u) => u.role === 'admin' || u.role === 'manager';
const MANAGERS = ['admin', 'manager'];

// Ruling R8: bỏ chuỗi rỗng; assignee_ids → mảng số nguyên; overdue chỉ khi '1'.
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'string') {
      if (v.trim() !== '') out[k] = v;
    } else if (Array.isArray(v)) {
      if (v.length) out[k] = v;
    } else if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function parseIds(v) {
  if (v === undefined || v === null || v === '') return [];
  return [].concat(v).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
}

function parseFilters(query) {
  const q = clean(query);
  const f = {};
  for (const k of ['status', 'category', 'priority', 'q']) if (typeof q[k] === 'string') f[k] = q[k].trim();
  if (q.assignee_id && /^\d+$/.test(String(q.assignee_id))) f.assignee_id = Number(q.assignee_id);
  if (q.overdue === '1') f.overdue = true;
  return f;
}

function formData(body) {
  const b = clean(body);
  const data = {};
  for (const k of ['title', 'description', 'category', 'priority', 'due_date']) if (b[k] !== undefined) data[k] = b[k];
  data.assignee_ids = parseIds(b.assignee_ids);
  if (typeof b.checklist === 'string') data.checklist = b.checklist.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return data;
}

// Các nút chuyển trạng thái hợp lệ cho người dùng hiện tại.
function statusActions(task, user) {
  const acts = [];
  const add = (to, label, opts = {}) => acts.push({ to, label, ...opts });
  const s = task.status;
  if (isManager(user)) {
    if (s === 'chua_lam') add('dang_lam', 'Bắt đầu thực hiện');
    if (s === 'dang_lam') add('cho_duyet', 'Báo cáo hoàn thành', { note: 'optional' });
    if (s === 'cho_duyet') {
      add('hoan_thanh', 'Duyệt hoàn thành');
      add('dang_lam', 'Trả lại', { note: 'required' });
    }
    if (s === 'chua_lam' || s === 'dang_lam') add('hoan_thanh', 'Hoàn thành ngay', { secondary: true });
    if (s === 'hoan_thanh') add('dang_lam', 'Mở lại', { note: 'optional' });
  } else {
    if (s === 'chua_lam') add('dang_lam', 'Bắt đầu thực hiện');
    if (s === 'dang_lam') add('cho_duyet', 'Báo cáo hoàn thành', { note: 'optional' });
  }
  return acts;
}

module.exports = (db) => {
  const r = express.Router();
  r.use(['/tasks', '/kanban', '/my'], requireLogin);

  const wantsJson = (req) => req.is('json') || /application\/json/.test(req.get('accept') || '');
  const notFound = (res) => res.status(404).render('error', { title: 'Không tìm thấy', code: 404, message: 'Không tìm thấy công việc' });
  const jsonFail = (res, status, error) => res.status(status).json({ ok: false, error });

  const wrap = (fn, onError) => (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (e) {
      if (e instanceof AppError) {
        if (onError) return onError(req, res, e);
        if (wantsJson(req)) return jsonFail(res, 400, e.message);
        return res.status(400).render('error', { title: 'Lỗi', code: 400, message: e.message });
      }
      next(e);
    }
  };

  // Nạp việc + kiểm tra quyền xem (member xem việc người khác → 403, không lộ nội dung).
  const loadTask = (req, res, next) => {
    const id = Number(req.params.id);
    const t = Number.isInteger(id) ? tasks.getTask(db, id) : null;
    if (!t) return wantsJson(req) ? jsonFail(res, 404, 'Không tìm thấy công việc') : notFound(res);
    if (!tasks.canView(t, req.user)) return wantsJson(req) ? jsonFail(res, 403, 'Đồng chí không có quyền với công việc này') : forbid(res);
    req.task = t;
    next();
  };

  const scopeFilters = (req) => {
    const f = parseFilters(req.query);
    if (!isManager(req.user)) f.assignee_id = req.user.id;
    return f;
  };
  const qs = (req) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(clean(req.query))) if (typeof v === 'string') p.set(k, v);
    return p.toString();
  };

  r.get('/tasks', (req, res) => {
    const filters = scopeFilters(req);
    res.render('tasks/list', {
      title: 'Công việc', tasks: tasks.listTasks(db, filters), filters,
      query: qs(req), people: isManager(req.user) ? users.listUsers(db) : [], LABELS,
    });
  });

  const formCtx = (extra) => ({
    people: users.listUsers(db), LABELS, error: null, checklistText: '', ...extra,
  });

  r.get('/tasks/new', requireRole(...MANAGERS), (req, res) => {
    res.render('tasks/form', formCtx({
      title: 'Giao việc mới', target: null,
      form: { category: 'khac', priority: 'thuong', assignee_ids: [] },
    }));
  });

  r.post('/tasks', requireRole(...MANAGERS), wrap((req, res) => {
    const id = tasks.createTask(db, formData(req.body), req.user.id);
    res.redirect(`/tasks/${id}`);
  }, (req, res, e) => {
    const d = formData(req.body);
    res.status(400).render('tasks/form', formCtx({
      title: 'Giao việc mới', target: null, error: e.message,
      form: { ...d, assignee_ids: d.assignee_ids }, checklistText: (d.checklist || []).join('\n'),
    }));
  }));

  r.get('/tasks/:id', loadTask, (req, res) => {
    const t = req.task;
    res.render('tasks/detail', {
      title: t.title, task: t, LABELS, actions: statusActions(t, req.user),
      manager: isManager(req.user), error: null,
    });
  });

  r.get('/tasks/:id/edit', requireRole(...MANAGERS), loadTask, (req, res) => {
    const t = req.task;
    // giữ cả người bị khóa đang được giao để không mất khi lưu lại
    const extra = t.assignees.filter((a) => !a.active);
    res.render('tasks/form', formCtx({
      title: 'Sửa công việc', target: t, extraPeople: extra,
      form: { ...t, assignee_ids: t.assignees.map((a) => a.id) },
    }));
  });

  r.post('/tasks/:id', requireRole(...MANAGERS), loadTask, wrap((req, res) => {
    const d = formData(req.body);
    delete d.checklist;
    tasks.updateTask(db, req.task.id, d, req.user);
    res.redirect(`/tasks/${req.task.id}`);
  }, (req, res, e) => {
    const d = formData(req.body);
    res.status(400).render('tasks/form', formCtx({
      title: 'Sửa công việc', target: req.task, error: e.message, extraPeople: req.task.assignees.filter((a) => !a.active),
      form: { ...d },
    }));
  }));

  r.post('/tasks/:id/delete', requireRole(...MANAGERS), loadTask, wrap((req, res) => {
    tasks.deleteTask(db, req.task.id, req.user);
    res.redirect('/tasks');
  }));

  r.post('/tasks/:id/status', loadTask, wrap((req, res) => {
    const b = clean(req.body);
    tasks.changeStatus(db, req.task.id, b.status, req.user, b.note);
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect(`/tasks/${req.task.id}`);
  }, (req, res, e) => {
    if (wantsJson(req)) return jsonFail(res, 400, e.message);
    const t = tasks.getTask(db, req.task.id);
    res.status(400).render('tasks/detail', {
      title: t.title, task: t, LABELS, actions: statusActions(t, req.user), manager: isManager(req.user), error: e.message,
    });
  }));

  const detailError = (req, res, e) => {
    const t = tasks.getTask(db, req.task.id);
    res.status(400).render('tasks/detail', {
      title: t.title, task: t, LABELS, actions: statusActions(t, req.user), manager: isManager(req.user), error: e.message,
    });
  };

  r.post('/tasks/:id/checklist', loadTask, wrap((req, res) => {
    tasks.addChecklistItem(db, req.task.id, req.body.content, req.user);
    res.redirect(`/tasks/${req.task.id}`);
  }, detailError));

  r.post('/tasks/:id/checklist/:itemId/toggle', loadTask, wrap((req, res) => {
    const itemId = Number(req.params.itemId);
    if (!req.task.checklist.some((c) => c.id === itemId)) throw new AppError('Không tìm thấy mục checklist');
    tasks.toggleChecklistItem(db, itemId, req.user);
    res.redirect(`/tasks/${req.task.id}`);
  }, detailError));

  r.post('/tasks/:id/comments', loadTask, wrap((req, res) => {
    tasks.addComment(db, req.task.id, req.user, req.body.content);
    res.redirect(`/tasks/${req.task.id}`);
  }, detailError));

  r.get('/kanban', (req, res) => {
    const filters = {};
    if (!isManager(req.user)) filters.assignee_id = req.user.id;
    const all = tasks.listTasks(db, filters);
    const columns = Object.keys(LABELS.status).map((code) => ({ code, label: LABELS.status[code], tasks: all.filter((t) => t.status === code) }));
    res.render('tasks/kanban', { title: 'Bảng Kanban', columns, LABELS });
  });

  // Task 6 sẽ thay thứ tự bằng "Việc cần làm hôm nay".
  r.get('/my', (req, res) => {
    const mine = tasks.listTasks(db, { assignee_id: req.user.id }).filter((t) => t.status !== 'hoan_thanh');
    res.render('tasks/mine', { title: 'Việc của tôi', tasks: mine, LABELS });
  });

  return r;
};
