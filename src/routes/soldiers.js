const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const soldiers = require('../services/soldiers');
const soldierItems = require('../services/soldierItems');
const milestones = require('../services/milestones');
const users = require('../services/users');
const audit = require('../services/audit');
const { today } = require('../util/date');
const { AppError } = require('../util/errors');
const { RANKS, SOLDIER_LABELS } = require('../util/ranks');
const { clean } = require('../util/filters');
const soldierExcel = require('../services/soldierExcel');

const { ITEM_TYPES } = soldierItems;

const TABS = [
  { key: 'ly-lich', label: 'Lý lịch' },
  { key: 'gia-dinh', label: 'Gia đình', type: 'family' },
  { key: 'cong-tac', label: 'Quá trình công tác', type: 'career' },
  { key: 'khen-thuong', label: 'Khen thưởng, kỷ luật', type: 'award' },
  { key: 'phep', label: 'Nghỉ phép', type: 'leave' },
  { key: 'tu-tuong', label: 'Tư tưởng', type: 'thought', sensitive: true },
];

// Danh sách trường của form mục con: [tên, nhãn, kiểu, lựa chọn?]
const ITEM_FORMS = {
  family: [
    ['relation', 'Quan hệ', 'text'], ['full_name', 'Họ tên', 'text'], ['birth_year', 'Năm sinh', 'text'],
    ['job', 'Nghề nghiệp', 'text'], ['address', 'Nơi ở', 'text'], ['hardship_note', 'Ghi chú hoàn cảnh', 'textarea'],
  ],
  career: [
    ['from_date', 'Từ ngày', 'date'], ['to_date', 'Đến ngày', 'date'],
    ['position', 'Chức vụ', 'text'], ['unit_text', 'Đơn vị', 'text'],
  ],
  award: [
    ['kind', 'Loại', 'select', 'awardKind'], ['date', 'Ngày', 'date'], ['form', 'Hình thức', 'text'],
    ['reason', 'Lý do', 'textarea'], ['decision_no', 'Số quyết định', 'text'],
  ],
  leave: [
    ['kind', 'Loại nghỉ', 'select', 'leaveKind'], ['from_date', 'Từ ngày', 'date'], ['to_date', 'Đến ngày', 'date'],
    ['destination', 'Nơi đến', 'text'], ['note', 'Ghi chú', 'textarea'],
  ],
  thought: [
    ['date', 'Ngày', 'date'], ['level', 'Mức độ', 'select', 'thoughtLevel'],
    ['content', 'Nội dung', 'textarea'], ['measures', 'Biện pháp', 'textarea'],
  ],
};
const TAB_OF_TYPE = Object.fromEntries(TABS.filter((t) => t.type).map((t) => [t.type, t.key]));

const SOLDIER_FIELDS = [
  'full_name', 'gender', 'rank', 'unit_id', 'status', 'position', 'birth_date', 'rank_date', 'enlist_date',
  'discharge_date', 'youth_join_date', 'party_join_date', 'party_official_date', 'hometown', 'residence',
  'ethnicity', 'religion', 'education', 'specialty', 'health_class', 'blood_type', 'phone', 'notes',
];

const MANAGERS = ['admin', 'manager'];

module.exports = (db) => {
  const r = express.Router();
  r.use('/my-profile', requireLogin);
  r.use('/soldiers', requireLogin, requireRole(...MANAGERS));

  const notFound = (res, msg = 'Không tìm thấy hồ sơ') => res.status(404).render('error', { title: 'Không tìm thấy', code: 404, message: msg });
  const wrap = (fn, onError) => (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (e) {
      if (e instanceof AppError) return onError(req, res, e);
      next(e);
    }
  };
  const pick = (body) => {
    const b = clean(body);
    const out = {};
    for (const k of SOLDIER_FIELDS) out[k] = b[k] === undefined ? '' : b[k];
    return out;
  };
  const formCtx = (extra) => ({
    units: users.listUnits(db), RANKS, SL: SOLDIER_LABELS, error: null, ...extra,
  });

  // ---- Danh sách ----
  r.get('/soldiers', (req, res) => {
    const filters = clean(req.query);
    res.render('soldiers/list', {
      title: 'Hồ sơ quân nhân', soldiers: soldiers.listSoldiers(db, filters), filters,
      units: users.listUnits(db), RANKS, SL: SOLDIER_LABELS,
    });
  });

  // ---- Xuất / nhập Excel ----
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const sendXlsx = (res, buf, ascii, vietnamese) => {
    res.set('Content-Type', XLSX);
    res.set('Content-Disposition', `attachment; filename="${ascii}.xlsx"; filename*=UTF-8''${encodeURIComponent(vietnamese + '.xlsx')}`);
    res.send(buf);
  };

  r.get('/soldiers/export', async (req, res, next) => {
    try {
      const rows = soldiers.listSoldiers(db, clean(req.query));
      const buf = await soldierExcel.exportWorkbook(rows);
      audit.log(db, req.user.id, 'soldier_export', 'soldier', `${rows.length} hồ sơ`);
      sendXlsx(res, buf, 'danh-sach-trich-ngang', 'Danh sách trích ngang');
    } catch (e) { next(e); }
  });

  r.get('/soldiers/import', (req, res) => {
    res.render('soldiers/import', { title: 'Nhập hồ sơ từ Excel', error: null });
  });

  r.get('/soldiers/import/template', async (req, res, next) => {
    try {
      sendXlsx(res, await soldierExcel.templateWorkbook(), 'mau-nhap-quan-nhan', 'Mẫu nhập quân nhân');
    } catch (e) { next(e); }
  });

  r.post('/soldiers/import/preview', async (req, res, next) => {
    try {
      const { fileName, data } = req.body || {};
      if (typeof data !== 'string' || !data) throw new AppError('Đồng chí chưa chọn tệp Excel');
      if (!/\.xlsx$/i.test(String(fileName || ''))) throw new AppError('Chỉ nhận tệp Excel .xlsx');
      const buf = Buffer.from(data, 'base64');
      if (!buf.length) throw new AppError('Tệp rỗng');
      if (buf.length > soldierExcel.MAX_BYTES) throw new AppError('Tệp quá lớn, dung lượng tối đa 2MB');
      const parsed = await soldierExcel.parseImport(db, buf);
      const id = soldierExcel.saveDraft(db, req.user.id, { fileName: String(fileName), ...parsed });
      res.json({ ok: true, redirect: `/soldiers/import/${id}` });
    } catch (e) {
      if (e instanceof AppError) return res.status(400).json({ ok: false, error: e.message });
      next(e);
    }
  });

  r.get('/soldiers/import/:draftId', (req, res) => {
    try {
      const d = soldierExcel.getDraft(db, req.params.draftId, req.user.id);
      res.render('soldiers/import-preview', { title: 'Xem trước nhập hồ sơ', draftId: req.params.draftId, d, error: null });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      res.status(404).render('soldiers/import', { title: 'Nhập hồ sơ từ Excel', error: e.message });
    }
  });

  r.post('/soldiers/import/:draftId/confirm', (req, res) => {
    try {
      soldierExcel.commitImport(db, req.params.draftId, req.user.id, req.user.id);
      res.redirect('/soldiers');
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      res.status(400).render('soldiers/import', { title: 'Nhập hồ sơ từ Excel', error: e.message });
    }
  });

  r.post('/soldiers/import/:draftId/cancel', (req, res) => {
    soldierExcel.discardDraft(db, req.params.draftId, req.user.id);
    res.redirect('/soldiers/import');
  });

  r.get('/soldiers/milestones', (req, res) => {
    const ms = milestones.upcomingMilestones(db, today());
    const groups = Object.keys(SOLDIER_LABELS.milestoneKind).map((kind) => ({
      kind, label: SOLDIER_LABELS.milestoneKind[kind], items: ms.items.filter((i) => i.kind === kind),
    }));
    res.render('soldiers/milestones', {
      title: 'Mốc sắp đến', groups, missing: ms.missingConfig, missingText: ms.missingConfig.map((k) => SOLDIER_LABELS.milestoneKind[k]).join('; '), SL: SOLDIER_LABELS, isAdmin: req.user.role === 'admin',
    });
  });

  r.get('/soldiers/new', (req, res) => {
    res.render('soldiers/form', formCtx({ title: 'Thêm hồ sơ quân nhân', target: null, form: { status: 'dang_cong_tac' } }));
  });

  r.post('/soldiers', wrap((req, res) => {
    const id = soldiers.createSoldier(db, pick(req.body), req.user.id);
    res.redirect(`/soldiers/${id}`);
  }, (req, res, e) => {
    res.status(400).render('soldiers/form', formCtx({ title: 'Thêm hồ sơ quân nhân', target: null, form: req.body, error: e.message }));
  }));

  // ---- Chi tiết ----
  const profileCtx = (profile, tab, base) => ({
    profile, TABS: profile.thoughts ? TABS : TABS.filter((t) => !t.sensitive), tab, base, SL: SOLDIER_LABELS, ITEM_FORMS,
  });
  const pickTab = (q, profile) => {
    const t = TABS.find((x) => x.key === q && (profile.thoughts || !x.sensitive));
    return t ? t.key : 'ly-lich';
  };

  r.get('/soldiers/:id(\\d+)', (req, res) => {
    const id = Number(req.params.id);
    const profile = soldiers.getProfile(db, id, today());
    if (!profile) return notFound(res);
    audit.log(db, req.user.id, 'soldier_view', `soldier:${id}`, profile.soldier.full_name);
    const tab = pickTab(req.query.tab, profile);
    const ms = milestones.upcomingMilestones(db, today(), { soldierId: id });
    res.render('soldiers/detail', {
      title: profile.soldier.full_name, ...profileCtx(profile, tab, `/soldiers/${id}`), manage: true, milestones: ms.items,
    });
  });

  const loadSoldier = (req, res, next) => {
    const s = soldiers.getSoldier(db, Number(req.params.id));
    if (!s) return notFound(res);
    req.soldier = s;
    next();
  };

  r.get('/soldiers/:id(\\d+)/edit', loadSoldier, (req, res) => {
    res.render('soldiers/form', formCtx({ title: 'Sửa hồ sơ quân nhân', target: req.soldier, form: req.soldier }));
  });

  r.post('/soldiers/:id(\\d+)', loadSoldier, wrap((req, res) => {
    soldiers.updateSoldier(db, req.soldier.id, pick(req.body), req.user.id);
    res.redirect(`/soldiers/${req.soldier.id}`);
  }, (req, res, e) => {
    res.status(400).render('soldiers/form', formCtx({ title: 'Sửa hồ sơ quân nhân', target: req.soldier, form: req.body, error: e.message }));
  }));

  r.post('/soldiers/:id(\\d+)/delete', loadSoldier, (req, res) => {
    soldiers.deleteSoldier(db, req.soldier.id, req.user.id);
    res.redirect('/soldiers');
  });

  // ---- Mục con ----
  const loadType = (req, res, next) => {
    if (!Object.hasOwn(ITEM_TYPES, req.params.type)) return notFound(res, 'Không tìm thấy mục');
    req.type = req.params.type;
    next();
  };
  const loadItem = (req, res, next) => {
    const item = soldierItems.getItem(db, req.type, Number(req.params.itemId));
    if (!item || item.soldier_id !== req.soldier.id) return notFound(res, 'Không tìm thấy mục');
    req.item = item;
    next();
  };
  const itemCtx = (req, extra) => ({
    soldier: req.soldier, type: req.type, typeLabel: ITEM_TYPES[req.type].label, fields: ITEM_FORMS[req.type],
    SL: SOLDIER_LABELS, error: null, back: `/soldiers/${req.soldier.id}?tab=${TAB_OF_TYPE[req.type]}`, ...extra,
  });
  const itemData = (req) => {
    const out = {};
    const b = clean(req.body);
    for (const [name] of ITEM_FORMS[req.type]) out[name] = b[name] === undefined ? '' : b[name];
    return out;
  };
  const back = (req) => `/soldiers/${req.soldier.id}?tab=${TAB_OF_TYPE[req.type]}`;
  const base = '/soldiers/:id(\\d+)/:type';
  const pre = [loadSoldier, loadType];

  r.get(`${base}/new`, ...pre, (req, res) => {
    res.render('soldiers/item-form', itemCtx(req, { title: `Thêm: ${ITEM_TYPES[req.type].label}`, item: null, form: {} }));
  });

  r.post(base, ...pre, wrap((req, res) => {
    soldierItems.addItem(db, req.type, req.soldier.id, itemData(req), req.user.id);
    res.redirect(back(req));
  }, (req, res, e) => {
    res.status(400).render('soldiers/item-form', itemCtx(req, { title: `Thêm: ${ITEM_TYPES[req.type].label}`, item: null, form: req.body, error: e.message }));
  }));

  r.get(`${base}/:itemId(\\d+)/edit`, ...pre, loadItem, (req, res) => {
    res.render('soldiers/item-form', itemCtx(req, { title: `Sửa: ${ITEM_TYPES[req.type].label}`, item: req.item, form: req.item }));
  });

  r.post(`${base}/:itemId(\\d+)`, ...pre, loadItem, wrap((req, res) => {
    soldierItems.updateItem(db, req.type, req.item.id, itemData(req), req.user.id);
    res.redirect(back(req));
  }, (req, res, e) => {
    res.status(400).render('soldiers/item-form', itemCtx(req, { title: `Sửa: ${ITEM_TYPES[req.type].label}`, item: req.item, form: req.body, error: e.message }));
  }));

  r.post(`${base}/:itemId(\\d+)/delete`, ...pre, loadItem, (req, res) => {
    soldierItems.deleteItem(db, req.type, req.item.id, req.user.id);
    res.redirect(back(req));
  });

  // ---- Hồ sơ của tôi ----
  r.get('/my-profile', (req, res) => {
    const s = soldiers.findByUser(db, req.user.id);
    if (!s) return res.render('soldiers/my-profile', { title: 'Hồ sơ của tôi', profile: null });
    let profile = soldiers.getProfile(db, s.id, today());
    audit.log(db, req.user.id, 'soldier_view', `soldier:${s.id}`, profile.soldier.full_name);
    if (req.user.role === 'member') profile = soldiers.redactForMember(profile);
    const tab = pickTab(req.query.tab, profile);
    const ms = milestones.upcomingMilestones(db, today(), { soldierId: s.id });
    res.render('soldiers/my-profile', {
      title: 'Hồ sơ của tôi', ...profileCtx(profile, tab, '/my-profile'), manage: false, milestones: req.user.role === 'member' ? [] : ms.items,
    });
  });

  return r;
};
