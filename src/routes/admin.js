const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const users = require('../services/users');
const audit = require('../services/audit');
const soldiers = require('../services/soldiers');
const milestones = require('../services/milestones');
const unitInfo = require('../services/unitInfo');
const aiSvc = require('../services/assistant/ai');
const { RANKS, RANKS_WITHOUT_INTERVAL } = require('../util/ranks');
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
  doc_template_create: 'Tạo mẫu văn bản', doc_template_update: 'Sửa mẫu văn bản', doc_template_delete: 'Xóa mẫu văn bản',
  doc_template_restore: 'Khôi phục mẫu văn bản dựng sẵn', doc_generate: 'Tạo văn bản', unit_info_settings: 'Đổi thông tin đơn vị',
  soldier_view: 'Xem hồ sơ quân nhân', soldier_create: 'Tạo hồ sơ quân nhân', soldier_update: 'Sửa hồ sơ quân nhân',
  soldier_delete: 'Xóa hồ sơ quân nhân', soldier_link: 'Liên kết tài khoản với hồ sơ',
  soldier_import: 'Nhập hồ sơ từ Excel', soldier_export: 'Xuất hồ sơ ra Excel', milestone_settings: 'Đổi cài đặt mốc nhắc',
  soldier_family_create: 'Thêm thân nhân', soldier_family_update: 'Sửa thân nhân', soldier_family_delete: 'Xóa thân nhân',
  soldier_career_create: 'Thêm quá trình công tác', soldier_career_update: 'Sửa quá trình công tác', soldier_career_delete: 'Xóa quá trình công tác',
  soldier_award_create: 'Thêm khen thưởng/kỷ luật', soldier_award_update: 'Sửa khen thưởng/kỷ luật', soldier_award_delete: 'Xóa khen thưởng/kỷ luật',
  soldier_leave_create: 'Thêm nghỉ phép', soldier_leave_update: 'Sửa nghỉ phép', soldier_leave_delete: 'Xóa nghỉ phép',
  soldier_thought_create: 'Thêm ghi nhận tư tưởng', soldier_thought_update: 'Sửa ghi nhận tư tưởng', soldier_thought_delete: 'Xóa ghi nhận tư tưởng',
  ai_run: 'Dùng trợ lý AI', ai_settings: 'Đổi cài đặt trợ lý AI',
  login_ip_blocked: 'Khóa thiết bị (IP) do đăng nhập sai nhiều lần',
};

module.exports = (db) => {
  const r = express.Router();
  r.use('/admin', requireLogin, requireRole('admin'));

  const formCtx = (extra) => ({
    units: users.listUnits(db), roles: LABELS.role, party: users.PARTY, error: null, ...extra,
    unlinked: soldiers.listUnlinked(db), linked: extra && extra.target ? soldiers.findByUser(db, extra.target.id) : null,
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

  // Hồ sơ được chọn phải tồn tại và chưa liên kết với tài khoản khác. Trả về id hoặc null.
  const checkSoldierChoice = (raw, userId) => {
    const v = String(raw ?? '').trim();
    if (!v) return null;
    const sid = Number(v);
    const sol = Number.isInteger(sid) ? soldiers.getSoldier(db, sid) : null;
    if (!sol) throw new AppError('Hồ sơ quân nhân không tồn tại');
    if (sol.user_id && sol.user_id !== userId) throw new AppError('Hồ sơ này đã được liên kết với tài khoản khác');
    return sid;
  };

  // ---- Tài khoản ----
  const listWithLinks = () => {
    const link = new Map(soldiers.listSoldiers(db, {}).filter((x) => x.user_id).map((x) => [x.user_id, x]));
    return users.listUsers(db, { includeInactive: true }).map((u) => ({ ...u, soldier: link.get(u.id) || null }));
  };
  const renderList = (req, res, extra = {}) => res.render('admin/users', {
    title: 'Quản trị tài khoản', tab: 'users', users: listWithLinks(),
    roles: LABELS.role, party: users.PARTY, error: null, ...extra,
  });

  r.get('/admin/users', (req, res) => renderList(req, res));

  r.get('/admin/users/new', (req, res) => {
    res.render('admin/user-form', formCtx({ title: 'Thêm tài khoản', tab: 'users', target: null, form: { role: 'member', party_status: 'khong' } }));
  });

  r.post('/admin/users', handle((req, res) => {
    // Kiểm tra liên kết trước khi tạo tài khoản để không tạo dở dang.
    const sid = checkSoldierChoice(req.body.soldier_id, null);
    const { id, tempPassword } = users.createUser(db, req.body, req.user.id);
    if (sid !== null) soldiers.linkUser(db, sid, id, req.user.id);
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
    const sid = checkSoldierChoice(req.body.soldier_id, req.target.id);
    users.updateUser(db, req.target.id, req.body, req.user.id);
    const cur = soldiers.findByUser(db, req.target.id);
    if ((cur ? cur.id : null) !== sid) {
      if (cur) soldiers.linkUser(db, cur.id, null, req.user.id);
      if (sid !== null) soldiers.linkUser(db, sid, req.target.id, req.user.id);
    }
    res.redirect('/admin/users');
  }, (req, res, e) => {
    res.status(400).render('admin/user-form', formCtx({ title: 'Sửa tài khoản', tab: 'users', target: req.target, form: { ...req.body, username: req.target.username }, error: e.message }));
  }));

  r.post('/admin/users/:id/active', loadTarget, handle((req, res) => {
    users.setActive(db, req.target.id, req.body.active === '1', req.user.id);
    res.redirect('/admin/users');
  }, (req, res, e) => res.status(400).render('admin/users', {
    title: 'Quản trị tài khoản', tab: 'users', users: listWithLinks(),
    roles: LABELS.role, party: users.PARTY, error: e.message,
  })));

  r.post('/admin/users/:id/reset', loadTarget, handle((req, res) => {
    const tempPassword = users.resetPassword(db, req.target.id, req.user.id);
    res.render('admin/temp-password', { title: 'Mật khẩu tạm', tab: 'users', target: req.target, tempPassword, created: false });
  }, (req, res, e) => res.status(400).render('admin/users', {
    title: 'Quản trị tài khoản', tab: 'users', users: listWithLinks(),
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
  const renderSettings = (res, error, saved, status = 200, value, extra = {}) => res.status(status).render('admin/settings', {
    title: 'Cài đặt hệ thống', tab: 'settings', error, saved,
    threshold: value !== undefined ? value : users.getOverloadThreshold(db),
    ms: milestones.getMilestoneSettings(db), msRanks: RANKS.filter((k) => !RANKS_WITHOUT_INTERVAL.includes(k)),
    msForm: null, msError: null, unit: unitInfo.getUnitInfo(db), unitKeys: unitInfo.UNIT_KEYS, unitExamples: unitInfo.UNIT_EXAMPLES, unitError: null, ai: aiSvc.getAiSettings(db), aiError: null, ...extra,
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

  r.post('/admin/settings/milestones', handle((req, res) => {
    const b = req.body;
    const intervals = {};
    for (const [k, v] of Object.entries(b)) {
      const m = /^rank_intervals\[(.+)\]$/.exec(k);
      if (m) intervals[m[1]] = v;
    }
    if (b.rank_intervals && typeof b.rank_intervals === 'object') Object.assign(intervals, b.rank_intervals);
    milestones.saveMilestoneSettings(db, { ...b, rank_intervals: intervals }, req.user.id);
    res.redirect('/admin/settings?saved=1');
  }, (req, res, e) => {
    const b = req.body;
    const ri = {};
    for (const [k, v] of Object.entries(b)) {
      const m = /^rank_intervals\[(.+)\]$/.exec(k);
      if (m) ri[m[1]] = v;
    }
    renderSettings(res, null, false, 400, undefined, { msError: e.message, msForm: { ...b, rank_intervals: ri } });
  }));

  r.post('/admin/settings/unit-info', handle((req, res) => {
    unitInfo.saveUnitInfo(db, req.body, req.user.id);
    res.redirect('/admin/settings?saved=1');
  }, (req, res, e) => {
    const unit = {};
    for (const k of Object.keys(unitInfo.UNIT_KEYS)) unit[k] = String(req.body[k] ?? '');
    renderSettings(res, null, false, 400, undefined, { unitError: e.message, unit });
  }));

  r.post('/admin/settings/ai', async (req, res, next) => {
    const b = req.body || {};
    try {
      await aiSvc.saveAiSettings(db, b, req.user.id);
      res.redirect('/admin/settings?saved=1');
    } catch (e) {
      if (!(e instanceof AppError)) return next(e);
      const str = (v) => String(v ?? '');
      renderSettings(res, null, false, 400, undefined, {
        aiError: e.message,
        ai: {
          ai_enabled: b.ai_enabled === '1' ? '1' : '0', ai_url: str(b.ai_url), ai_model: str(b.ai_model), ai_timeout_s: str(b.ai_timeout_s),
          ai_samples: { ke_hoach: str(b.sample_ke_hoach), bao_cao: str(b.sample_bao_cao), chung: str(b.sample_chung) },
        },
      });
    }
  });

  r.post('/admin/settings/ai/check', async (req, res, next) => {
    try {
      res.json(await aiSvc.checkConnection(db));
    } catch (e) {
      next(e);
    }
  });

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
