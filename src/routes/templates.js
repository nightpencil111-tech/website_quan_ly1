const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const templates = require('../services/templates');
const recurring = require('../services/recurring');
const users = require('../services/users');
const { today } = require('../util/date');
const { AppError } = require('../util/errors');
const { LABELS } = require('../util/text');

const FREQ = { tuan: 'Hằng tuần', thang: 'Hằng tháng' };
const WEEKDAYS = { 1: 'Thứ Hai', 2: 'Thứ Ba', 3: 'Thứ Tư', 4: 'Thứ Năm', 5: 'Thứ Sáu', 6: 'Thứ Bảy', 7: 'Chủ nhật' };

const ids = (v) => (v === undefined || v === '' ? [] : [].concat(v).map(Number).filter((n) => Number.isInteger(n) && n > 0));

module.exports = (db) => {
  const r = express.Router();
  r.use('/templates', requireLogin, requireRole('admin', 'manager'));

  const wrap = (fn, onError) => (req, res, next) => {
    try { fn(req, res, next); } catch (e) {
      if (e instanceof AppError) return onError(req, res, e);
      next(e);
    }
  };
  const notFound = (res) => res.status(404).render('error', { title: 'Không tìm thấy', code: 404, message: 'Không tìm thấy mục yêu cầu' });
  // Thông báo chỉ qua mã, ánh xạ sang câu cố định (không phản chiếu văn bản tùy ý từ URL).
  const backTo = (res, tab, code, n) => res.redirect(`/templates?tab=${tab}${code ? '&done=' + code : ''}${n !== undefined ? '&n=' + Number(n) : ''}`);
  const doneMsg = (code, n) => {
    if (code === 'generated') return `Đã sinh ${Math.min(Math.max(parseInt(n, 10) || 0, 0), 100000)} công việc`;
    if (code === 'delete_failed') return 'Không thể xóa: mục không còn tồn tại';
    return null;
  };

  r.get('/templates', (req, res) => {
    const tab = req.query.tab === 'recurring' ? 'recurring' : 'templates';
    const people = users.listUsers(db, { includeInactive: true });
    const nameOf = new Map(people.map((p) => [p.id, p.full_name + (p.active ? '' : ' (đã khóa)')]));
    const rules = recurring.listRules(db).map((x) => ({
      ...x,
      assignee_names: x.assignee_ids.map((i) => nameOf.get(i) || '?').join(', '),
      next: x.active ? recurring.nextOccurrence(x, today()) : null,
    }));
    res.render('templates/index', {
      title: 'Mẫu & Việc định kỳ', tab, templates: templates.listTemplates(db), rules, LABELS, FREQ, WEEKDAYS,
      msg: doneMsg(req.query.done, req.query.n),
    });
  });

  // --- Mẫu công việc ---
  const tplForm = (res, status, target, form, error) => res.status(status).render('templates/form', {
    title: target ? 'Sửa mẫu công việc' : 'Thêm mẫu công việc', target, form, error, LABELS,
  });

  r.get('/templates/new', (req, res) => tplForm(res, 200, null, { items: '' }, null));
  r.post('/templates', wrap((req, res) => {
    templates.createTemplate(db, req.body, req.user.id);
    backTo(res, 'templates');
  }, (req, res, e) => tplForm(res, 400, null, req.body, e.message)));

  r.get('/templates/:id(\\d+)/edit', (req, res) => {
    const t = templates.getTemplate(db, Number(req.params.id));
    if (!t) return notFound(res);
    tplForm(res, 200, t, { ...t, items: t.items.join('\n') }, null);
  });
  r.post('/templates/:id(\\d+)', wrap((req, res) => {
    templates.updateTemplate(db, Number(req.params.id), req.body, req.user.id);
    backTo(res, 'templates');
  }, (req, res, e) => {
    const t = templates.getTemplate(db, Number(req.params.id));
    if (!t) return notFound(res);
    tplForm(res, 400, t, req.body, e.message);
  }));
  r.post('/templates/:id(\\d+)/delete', wrap((req, res) => {
    templates.deleteTemplate(db, Number(req.params.id), req.user.id);
    backTo(res, 'templates');
  }, (req, res) => backTo(res, 'templates', 'delete_failed')));

  // --- Việc định kỳ ---
  const ruleForm = (res, status, target, form, error) => res.status(status).render('templates/recurring-form', {
    title: target ? 'Sửa việc định kỳ' : 'Thêm việc định kỳ', target, error, LABELS, FREQ, WEEKDAYS,
    people: users.listUsers(db), form: { ...form, assignee_ids: ids(form.assignee_ids) },
  });
  const ruleDefaults = { category: 'khac', priority: 'thuong', frequency: 'tuan', day_value: 1, lead_days: 2, active: 1, assignee_ids: [] };
  const ruleBody = (b) => ({ ...b, assignee_ids: ids(b.assignee_ids), active: b.active === '1' ? 1 : 0 });

  r.get('/templates/recurring/new', (req, res) => ruleForm(res, 200, null, ruleDefaults, null));
  r.post('/templates/recurring', wrap((req, res) => {
    recurring.createRule(db, ruleBody(req.body), req.user.id);
    backTo(res, 'recurring');
  }, (req, res, e) => ruleForm(res, 400, null, ruleBody(req.body), e.message)));

  r.get('/templates/recurring/:id(\\d+)/edit', (req, res) => {
    const x = recurring.getRule(db, Number(req.params.id));
    if (!x) return notFound(res);
    ruleForm(res, 200, x, x, null);
  });
  r.post('/templates/recurring/:id(\\d+)', wrap((req, res) => {
    recurring.updateRule(db, Number(req.params.id), ruleBody(req.body), req.user.id);
    backTo(res, 'recurring');
  }, (req, res, e) => {
    const x = recurring.getRule(db, Number(req.params.id));
    if (!x) return notFound(res);
    ruleForm(res, 400, x, ruleBody(req.body), e.message);
  }));
  r.post('/templates/recurring/:id(\\d+)/delete', wrap((req, res) => {
    recurring.deleteRule(db, Number(req.params.id), req.user.id);
    backTo(res, 'recurring');
  }, (req, res) => backTo(res, 'recurring', 'delete_failed')));

  r.post('/templates/generate', wrap((req, res) => {
    const n = recurring.generateDue(db, today());
    backTo(res, 'recurring', 'generated', n);
  }, (req, res) => backTo(res, 'recurring')));

  return r;
};
