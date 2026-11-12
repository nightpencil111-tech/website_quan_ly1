const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const users = require('../services/users');
const audit = require('../services/audit');
const { AppError } = require('../util/errors');
const { today } = require('../util/date');
const { LABELS } = require('../util/text');

const PAGE = 50;
const AUDIT_ACTIONS = {
  login: 'Đăng nhập', login_fail: 'Đăng nhập thất bại', logout: 'Đăng xuất', change_password: 'Đổi mật khẩu',
  user_create: 'Tạo tài khoản', user_update: 'Sửa tài khoản', user_lock: 'Khóa tài khoản', user_unlock: 'Mở khóa tài khoản',
  user_reset_password: 'Đặt lại mật khẩu', unit_create: 'Tạo đơn vị', unit_update: 'Sửa đơn vị', unit_delete: 'Xóa đơn vị',
  task_create: 'Tạo công việc', task_update: 'Sửa công việc', task_delete: 'Xóa công việc', task_status: 'Chuyển trạng thái công việc',
  template_create: 'Tạo mẫu công việc', template_update: 'Sửa mẫu công việc', template_delete: 'Xóa mẫu công việc',
  rule_create: 'Tạo việc định kỳ', rule_update: 'Sửa việc định kỳ', rule_delete: 'Xóa việc định kỳ',
  event_create: 'Tạo sự kiện lịch', event_update: 'Sửa sự kiện lịch', event_delete: 'Xóa sự kiện lịch',
  settings_update: 'Đổi cài đặt', backup: 'Sao lưu dữ liệu',
  soldier_view: 'Xem hồ sơ quân nhân', soldier_create: 'Tạo hồ sơ quân nhân', soldier_update: 'Sửa hồ sơ quân nhân',
  soldier_delete: 'Xóa hồ sơ quân nhân', soldier_link: 'Liên kết tài khoản với hồ sơ',
  soldier_import: 'Nhập hồ sơ từ Excel', soldier_export: 'Xuất hồ sơ ra Excel', milestone_settings: 'Đổi cài đặt mốc nhắc',
  soldier_family_create: 'Thêm thân nhân', soldier_family_update: 'Sửa thân nhân', soldier_family_delete: 'Xóa thân nhân',
  soldier_career_create: 'Thêm quá trình công tác', soldier_career_update: 'Sửa quá trình công tác', soldier_career_delete: 'Xóa quá trình công tác',
  soldier_award_create: 'Thêm khen thưởng/kỷ luật', soldier_award_update: 'Sửa khen thưởng/kỷ luật', soldier_award_delete: 'Xóa khen thưởng/kỷ luật',
  soldier_leave_create: 'Thêm nghỉ phép', soldier_leave_update: 'Sửa nghỉ phép', soldier_leave_delete: 'Xóa nghỉ phép',
  soldier_thought_create: 'Thêm ghi nhận tư tưởng', soldier_thought_update: 'Sửa ghi nhận tư tưởng', soldier_thought_delete: 'Xóa ghi nhận tư tưởng',
};

module.exports = (db) => {
  const r = express.Router();
  r.use('/admin', requireLogin, requireRole('admin'));

  const formCtx = (extra) => ({
    units: users.listUnits(db), roles: LABELS.role, party: users.PARTY, error: null, ...extra,
  });
  const idOf = (req) => Number(req.params.id);

  // Bắt AppError → hiển thị trên form; lỗi khác chuyển cho handler chung.
  const handle = (fn, onError) => (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (e) {
      if (e instanceof AppError) return onError(req, res, e);
      next(e);
    }
  };

  // ---- Tài khoản ----
  const renderList = (req, res, extra = {}) => res.render('admin/users', {
    title: 'Quản trị tài khoản', tab: 'users', users: users.listUsers(db, { includeInactive: true }),
    roles: LABELS.role, party: users.PARTY, error: null, ...extra,
  });

  r.get('/admin/users', (req, res) => renderList(req, res));

  r.get('/admin/users/new', (req, res) => {
    res.render('admin/user-form', formCtx({ title: 'Thêm tài khoản', tab: 'users', target: null, form: { role: 'member', party_status: 'khong' } }));
  });

  r.post('/admin/users', handle((req, res) => {
    const { id, tempPassword } = users.createUser(db, req.body, req.user.id);
    res.render('admin/temp-password', {
      title: 'Mật khẩu tạm', tab: 'users', target: users.getUser(db, id), tempPassword, created: true,
    });
  }, (req, res, e) => {
    res.status(400).render('admin/user-form', formCtx({ title: 'Thêm tài khoản', tab: 'users', target: null, form: req.body, error: e.message }));
  }));

  const loadTarget = (req, res, next) => {
    const t = users.getUser(db, idOf(req));
    if (!t) return res.status(404).render('error', { title: 'Không tìm thấy', code: 404, message: 'Không tìm thấy tài khoản' });
    req.target = t;
    next();
  };

  r.get('/admin/users/:id/edit', loadTarget, (req, res) => {
    res.render('admin/user-form', formCtx({ title: 'Sửa tài khoản', tab: 'users', target: req.target, form: req.target }));
  });

  r.post('/admin/users/:id', loadTarget, handle((req, res) => {
    users.updateUser(db, req.target.id, req.body, req.user.id);
    res.redirect('/admin/users');
  }, (req, res, e) => {
    res.status(400).render('admin/user-form', formCtx({ title: 'Sửa tài khoản', tab: 'users', target: req.target, form: { ...req.body, username: req.target.username }, error: e.message }));
  }));

  r.post('/admin/users/:id/active', loadTarget, handle((req, res) => {
    users.setActive(db, req.target.id, req.body.active === '1', req.user.id);
    res.redirect('/admin/users');
  }, (req, res, e) => res.status(400).render('admin/users', {
    title: 'Quản trị tài khoản', tab: 'users', users: users.listUsers(db, { includeInactive: true }),
    roles: LABELS.role, party: users.PARTY, error: e.message,
  })));

  r.post('/admin/users/:id/reset', loadTarget, handle((req, res) => {
    const tempPassword = users.resetPassword(db, req.target.id, req.user.id);
    res.render('admin/temp-password', { title: 'Mật khẩu tạm', tab: 'users', target: req.target, tempPassword, created: false });
  }, (req, res, e) => res.status(400).render('admin/users', {
    title: 'Quản trị tài khoản', tab: 'users', users: users.listUsers(db, { includeInactive: true }),
    roles: LABELS.role, party: users.PARTY, error: e.message,
  })));

  // ---- Đơn vị ----
  const renderUnits = (res, error, status = 200) =>
    res.status(status).render('admin/units', { title: 'Quản trị đơn vị', tab: 'units', units: users.listUnits(db), error });

  r.get('/admin/units', (req, res) => renderUnits(res, null));
  r.post('/admin/units', handle((req, res) => {
    users.createUnit(db, req.body.name, req.user.id);
    res.redirect('/admin/units');
  }, (req, res, e) => renderUnits(res, e.message, 400)));
  r.post('/admin/units/:id/delete', handle((req, res) => {
    users.deleteUnit(db, idOf(req), req.user.id);
    res.redirect('/admin/units');
  }, (req, res, e) => renderUnits(res, e.message, 400)));
  r.post('/admin/units/:id', handle((req, res) => {
    users.updateUnit(db, idOf(req), req.body.name, req.user.id);
    res.redirect('/admin/units');
  }, (req, res, e) => renderUnits(res, e.message, 400)));

  // ---- Cài đặt ----
  const renderSettings = (res, error, saved, status = 200, value) => res.status(status).render('admin/settings', {
    title: 'Cài đặt hệ thống', tab: 'settings', error, saved,
    threshold: value !== undefined ? value : users.getOverloadThreshold(db),
  });
  r.get('/admin/settings', (req, res) => renderSettings(res, null, req.query.saved === '1'));
  r.post('/admin/settings', handle((req, res) => {
    const raw = String(req.body.overload_threshold ?? '').trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isInteger(n) || n < 1) {
      throw new AppError('Ngưỡng quá tải phải là số nguyên từ 1 trở lên');
    }
    users.setSetting(db, 'overload_threshold', n);
    audit.log(db, req.user.id, 'settings_update', 'overload_threshold', String(n));
    res.redirect('/admin/settings?saved=1');
  }, (req, res, e) => renderSettings(res, e.message, false, 400, req.body.overload_threshold)));

  // ---- Nhật ký ----
  r.get('/admin/audit', (req, res) => {
    const total = audit.count(db);
    const pages = Math.max(1, Math.ceil(total / PAGE));
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);
    const detailText = (a) => {
      if (!a.detail) return '';
      if (a.action !== 'task_status') return a.detail;
      return a.detail.replace(/\b(chua_lam|dang_lam|cho_duyet|hoan_thanh)\b/g, (k) => LABELS.status[k]);
    };
    res.render('admin/audit', {
      actionLabel: (c) => AUDIT_ACTIONS[c] || c, detailText,
      title: 'Nhật ký hoạt động', tab: 'audit', rows: audit.list(db, { limit: PAGE, offset: (page - 1) * PAGE }), page, pages, total,
    });
  });

  // ---- Sao lưu ----
  r.get('/admin/backup', (req, res, next) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-ctv-bak-'));
    const file = path.join(dir, 'saoluu.db');
    const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    try {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    } catch (e) {
      cleanup();
      return next(e);
    }
    audit.log(db, req.user.id, 'backup', null, 'Tải bản sao lưu CSDL');
    res.set('Content-Type', 'application/octet-stream');
    res.download(file, `saoluu-${today()}.db`, (err) => {
      cleanup();
      if (err && !res.headersSent) next(err);
    });
  });

  return r;
};
