const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const users = require('../services/users');

module.exports = (db) => {
  const r = express.Router();
  r.get('/people', requireLogin, requireRole('admin', 'manager'), (req, res) => {
    const unitId = parseInt(req.query.unit, 10) || null;
    let rows = users.listUsers(db);
    if (unitId) rows = rows.filter((u) => u.unit_id === unitId);
    res.render('people', { title: 'Quân số', rows, units: users.listUnits(db), unitId, party: users.PARTY });
  });
  return r;
};
