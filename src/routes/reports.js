const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const reports = require('../services/reports');
const smart = require('../services/smart');
const tasks = require('../services/tasks');
const excel = require('../services/excel');
const { today } = require('../util/date');
const { AppError } = require('../util/errors');
const { scopeFilters } = require('../util/filters');

const MANAGERS = ['admin', 'manager'];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function sendXlsx(res, buf, ascii, vietnamese) {
  res.set('Content-Type', XLSX);
  res.set('Content-Disposition', `attachment; filename="${ascii}.xlsx"; filename*=UTF-8''${encodeURIComponent(vietnamese + '.xlsx')}`);
  res.send(buf);
}

module.exports = (db) => {
  const r = express.Router();
  r.use(['/reports', '/export'], requireLogin);

  const wrap = (view, build) => (req, res, next) => {
    try {
      res.render(view, build(req));
    } catch (e) {
      if (!(e instanceof AppError)) return next(e);
      res.status(400).render(view, { ...build({ query: {} }), error: e.message });
    }
  };

  const ranges = () => ({ week: reports.weekRange(today()), month: reports.monthRange(today()) });

  r.get('/reports', requireRole(...MANAGERS), wrap('reports/index', (req) => {
    const range = reports.parseRange(req.query, today());
    return { title: 'Báo cáo', error: null, range, report: reports.periodReport(db, range.from, range.to, today()), ...ranges() };
  }));

  r.get('/reports/performance', requireRole(...MANAGERS), wrap('reports/performance', (req) => {
    const range = reports.parseRange(req.query, today(), reports.monthRange(today()));
    const SORTS = ['full_name', 'assigned', 'completed', 'on_time', 'overdue', 'rate'];
    const sort = SORTS.includes(req.query.sort) ? req.query.sort : null;
    const rows = smart.performance(db, range, today());
    if (sort === 'full_name') rows.sort((a, b) => a.full_name.localeCompare(b.full_name, 'vi'));
    else if (sort) rows.sort((a, b) => b[sort] - a[sort]);
    return { title: 'Hiệu suất', error: null, range, rows, sort, ...ranges() };
  }));

  r.get('/export/tasks', (req, res, next) => {
    try {
      const rows = tasks.listTasks(db, scopeFilters(req.user, req.query), today());
      excel.tasksWorkbook(rows).then((buf) => sendXlsx(res, buf, 'Danh-sach-cong-viec', 'Danh sách công việc'), next);
    } catch (e) { next(e); }
  });

  const exportGuard = (fn, monthly = false) => (req, res, next) => {
    let range;
    try { range = reports.parseRange(req.query, today(), monthly ? reports.monthRange(today()) : undefined); } catch (e) {
      if (e instanceof AppError) return res.status(400).render('error', { title: 'Lỗi', code: 400, message: e.message });
      return next(e);
    }
    fn(range, res).then(() => {}, next);
  };

  r.get('/export/performance', requireRole(...MANAGERS), exportGuard(async (range, res) => {
    const buf = await excel.performanceWorkbook(smart.performance(db, range, today()));
    sendXlsx(res, buf, 'Hieu-suat', 'Hiệu suất');
  }, true));

  r.get('/export/report', requireRole(...MANAGERS), exportGuard(async (range, res) => {
    const buf = await excel.reportWorkbook(reports.periodReport(db, range.from, range.to, today()));
    sendXlsx(res, buf, 'Bao-cao', 'Báo cáo');
  }));

  return r;
};
