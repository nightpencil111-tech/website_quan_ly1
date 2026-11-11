const express = require('express');
const { requireLogin } = require('../auth');

// Bản tạm; Task 9 thay nội dung.
module.exports = () => {
  const r = express.Router();
  r.get('/', requireLogin, (req, res) => {
    res.render('dashboard', { title: 'Tổng quan' });
  });
  return r;
};
