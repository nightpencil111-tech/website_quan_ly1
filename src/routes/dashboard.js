const express = require('express');
const { requireLogin } = require('../auth');
const milestones = require('../services/milestones');
const { SOLDIER_LABELS } = require('../util/ranks');
const reports = require('../services/reports');
const { today } = require('../util/date');
const { LABELS } = require('../util/text');

// JSON an toàn để nhúng vào <script type="application/json">: thoát '<' (và U+2028/2029).
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028]/g, '\\u2028').replace(/[\u2029]/g, '\\u2029');

module.exports = (db) => {
  const r = express.Router();
  r.get('/', requireLogin, (req, res) => {
    const stats = reports.dashboardStats(db, req.user, today());
    const chartData = safeJson({
      byCategory: stats.byCategory,
      byPerson: stats.byPerson || null,
    });
    let soldierBox = null;
    if (req.user.role === 'admin' || req.user.role === 'manager') {
      const ms = milestones.upcomingMilestones(db, today());
      soldierBox = { items: ms.items.slice(0, 5), total: ms.items.length, stats: milestones.soldierStats(db, today()) };
    }
    res.render('dashboard', { title: 'Tổng quan', stats, chartData, LABELS, soldierBox, MK: SOLDIER_LABELS.milestoneKind });
  });
  return r;
};
