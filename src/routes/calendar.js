const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const events = require('../services/events');
const { today } = require('../util/date');
const { AppError } = require('../util/errors');

const isoDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');

module.exports = (db) => {
  const r = express.Router();
  const mgr = requireRole('admin', 'manager');
  r.use('/calendar', requireLogin);

  const wrap = (fn, onError) => (req, res, next) => {
    try { fn(req, res, next); } catch (e) {
      if (e instanceof AppError) return onError(req, res, e);
      next(e);
    }
  };
  const notFound = (res) => res.status(404).render('error', { title: 'Không tìm thấy', code: 404, message: 'Không tìm thấy sự kiện yêu cầu' });

  function renderMonth(req, res, status, { form, error } = {}) {
    const now = today();
    let y = parseInt(req.query.y, 10);
    let m = parseInt(req.query.m, 10);
    if (!Number.isInteger(y) || !Number.isInteger(m) || y < 2000 || y > 2100 || m < 1 || m > 12) {
      y = Number(now.slice(0, 4)); m = Number(now.slice(5, 7));
    }
    const view = events.monthView(db, y, m, req.user, now);
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    const canEdit = req.user.role === 'admin' || req.user.role === 'manager';
    const add = canEdit ? (form ? form.start_date : isoDate(req.query.add)) : '';
    res.status(status).render('calendar', {
      title: 'Lịch công tác', view, y, m, prev, next, today: now, canEdit, EVENT_TYPES: events.EVENT_TYPES,
      addForm: add || form ? { type: 'khac', ...(form || {}), start_date: add || '' } : null, error: error || null,
    });
  }

  r.get('/calendar', (req, res) => renderMonth(req, res, 200));

  r.post('/calendar/events', mgr, wrap((req, res) => {
    const id = events.createEvent(db, req.body, req.user.id);
    const e = events.getEvent(db, id);
    res.redirect(`/calendar?y=${e.start_date.slice(0, 4)}&m=${Number(e.start_date.slice(5, 7))}`);
  }, (req, res, e) => {
    const d = isoDate(req.body.start_date);
    if (d) { req.query.y = d.slice(0, 4); req.query.m = d.slice(5, 7); }
    renderMonth(req, res, 400, { form: req.body, error: e.message });
  }));

  const evForm = (res, status, target, form, error) => res.status(status).render('calendar-event', {
    title: 'Sự kiện', target, form, error, EVENT_TYPES: events.EVENT_TYPES,
    canEdit: res.locals.user.role === 'admin' || res.locals.user.role === 'manager',
  });

  r.get('/calendar/events/:id(\\d+)', (req, res) => {
    const e = events.getEvent(db, Number(req.params.id));
    if (!e) return notFound(res);
    evForm(res, 200, e, e, null);
  });
  r.post('/calendar/events/:id(\\d+)', mgr, wrap((req, res) => {
    events.updateEvent(db, Number(req.params.id), req.body, req.user.id);
    const s = isoDate(req.body.start_date);
    res.redirect(`/calendar?y=${s.slice(0, 4)}&m=${Number(s.slice(5, 7))}`);
  }, (req, res, e) => {
    const t = events.getEvent(db, Number(req.params.id));
    if (!t) return notFound(res);
    evForm(res, 400, t, req.body, e.message);
  }));
  r.post('/calendar/events/:id(\\d+)/delete', mgr, wrap((req, res) => {
    const e = events.getEvent(db, Number(req.params.id));
    events.deleteEvent(db, Number(req.params.id), req.user.id);
    res.redirect(`/calendar?y=${e.start_date.slice(0, 4)}&m=${Number(e.start_date.slice(5, 7))}`);
  }, (req, res, e) => res.redirect('/calendar?msg=' + encodeURIComponent(e.message))));

  return r;
};
