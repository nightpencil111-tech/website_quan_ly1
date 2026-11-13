const express = require('express');
const { requireLogin, requireRole, forbid } = require('../auth');
const tasks = require('../services/tasks');
const users = require('../services/users');
const smart = require('../services/smart');
const templates = require('../services/templates');
const { today } = require('../util/date');
const { AppError } = require('../util/errors');
const { LABELS } = require('../util/text');
const { cleanNames, cleanUnits } = require('../util/names');
const { clean, scopeFilters: scope } = require('../util/filters');

const isManager = (u) => u.role === 'admin' || u.role === 'manager';
const MANAGERS = ['admin', 'manager'];

function parseIds(v) {
  if (v === undefined || v === null || v === '') return [];
  return [].concat(v).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
}

function formData(db, body) {
  const b = clean(body);
  const data = {};
  for (const k of ['title', 'description', 'category', 'priority', 'due_date']) if (b[k] !== undefined) data[k] = b[k];
  data.assignee_ids = parseIds(b.assignee_ids);
  if (/^\d+$/.test(String(b.template_id ?? '')) && db.prepare('SELECT 1 FROM task_templates WHERE id = ?').get(Number(b.template_id))) data.template_id = Number(b.template_id);
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
  r.use(['/tasks', '/kanban', '/my', '/api/suggest'], requireLogin);

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

  const scopeFilters = (req) => scope(req.user, req.query);
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
    people: users.listUsers(db), LABELS, error: null, checklistText: '', prefilled: false, prefillNotes: [], ...extra,
  });

  // Điền sẵn từ Trợ lý: giá trị nào không hợp lệ thì bỏ qua, không báo lỗi.
  const prefill = (q) => {
    const form = {};
    const one = (v) => (typeof v === 'string' ? v.trim() : '');
    const title = one(q.title).slice(0, 200);
    if (title) form.title = title;
    const desc = one(q.description).slice(0, 4000);
    if (desc) form.description = desc;
    if (Object.hasOwn(LABELS.priority, one(q.priority))) form.priority = one(q.priority);
    if (Object.hasOwn(LABELS.category, one(q.category))) form.category = one(q.category);
    const d = one(q.due_date);
    const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00Z') : null;
    if (dt && !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d) form.due_date = d;
    const ids = parseIds(q.assignee_ids);
    if (ids.length) {
      const ok = new Set(users.listUsers(db).map((p) => p.id));
      const valid = [...new Set(ids)].filter((i) => ok.has(i));
      if (valid.length) form.assignee_ids = valid;
    }
    const notes = [
      ...cleanUnits(q.unit).map((u) => `Giao cho đơn vị: ${u} — đồng chí chọn người thực hiện`),
      ...cleanNames(q.unmatched).map((n) => `Không tìm thấy người tên “${n}” (có thể đã bị khóa hoặc gõ sai).`),
    ];
    return { form, notes, any: Object.keys(form).length > 0 };
  };

  r.get('/tasks/new', requireRole(...MANAGERS), (req, res) => {
    const form = { category: 'khac', priority: 'thuong', assignee_ids: [] };
    let checklistText = '';
    const tid = /^\d+$/.test(String(req.query.template ?? '')) ? Number(req.query.template) : null;
    const tpl = tid ? templates.getTemplate(db, tid) : null;
    if (tpl) {
      form.title = tpl.name;
      form.description = tpl.description || '';
      if (tpl.category) form.category = tpl.category;
      form.template_id = tpl.id;
      checklistText = tpl.items.join('\n');
    }
    const pre = prefill(req.query);
    Object.assign(form, pre.form);
    res.render('tasks/form', formCtx({ title: 'Giao việc mới', target: null, form, checklistText, prefilled: pre.any, prefillNotes: pre.notes }));
  });

  r.post('/tasks', requireRole(...MANAGERS), wrap((req, res) => {
    const id = tasks.createTask(db, formData(db, req.body), req.user.id);
    res.redirect(`/tasks/${id}`);
  }, (req, res, e) => {
    const d = formData(db, req.body);
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
    const d = formData(db, req.body);
    delete d.checklist;
    tasks.updateTask(db, req.task.id, d, req.user);
    res.redirect(`/tasks/${req.task.id}`);
  }, (req, res, e) => {
    const d = formData(db, req.body);
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

  // Việc cần làm hôm nay: quá hạn trước, sau đó theo điểm ưu tiên.
  r.get('/my', (req, res) => {
    res.render('tasks/mine', { title: 'Việc của tôi', tasks: smart.todayList(db, req.user.id, today()), LABELS });
  });

  r.get('/api/suggest', requireRole(...MANAGERS), (req, res) => {
    const q = clean(req.query);
    const category = typeof q.category === 'string' && Object.hasOwn(LABELS.category, q.category) ? q.category : 'khac';
    const due = typeof q.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.due_date) ? q.due_date : undefined;
    const all = smart.suggestAssignees(db, { category, due_date: due }, today(), Infinity);
    res.json({
      ok: true,
      suggestions: all.slice(0, 5),
      overloaded_ids: all.filter((s) => s.overloaded).map((s) => s.user_id), // mọi ứng viên, không chỉ top 5
    });
  });

  return r;
};
