const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const docTemplates = require('../services/docTemplates');
const docDetect = require('../services/docDetect');
const { inspectTemplate } = require('../services/docRender');
const { FIELD_CATALOG } = require('../services/docFields');
const unitInfo = require('../services/unitInfo');
const soldiers = require('../services/soldiers');
const soldierExcel = require('../services/soldierExcel');
const users = require('../services/users');
const { today } = require('../util/date');
const { fold } = require('../util/text');
const { AppError } = require('../util/errors');
const { SOLDIER_LABELS } = require('../util/ranks');
const { clean } = require('../util/filters');

const CATEGORY_LABELS = {
  ke_hoach: 'Kế hoạch', bao_cao: 'Báo cáo', dang: 'Văn bản Đảng', danh_sach: 'Danh sách', khac: 'Khác',
};
const MODE_LABELS = {
  chung: 'Văn bản chung (không chọn quân nhân)',
  tung_nguoi: 'Mỗi quân nhân một văn bản',
  danh_sach: 'Một danh sách nhiều quân nhân',
};
const TYPE_LABELS = { text: 'Một dòng', textarea: 'Nhiều dòng', date: 'Ngày' };
const PARTY_FILTERS = [['dang_vien', 'Đảng viên'], ['du_bi', 'Đảng viên dự bị'], ['doan_vien', 'Đoàn viên'], ['khong', 'Chưa vào Đảng/Đoàn']];
const MAX_FILE = 5 * 1024 * 1024;
const CATALOG_CODES = new Set(FIELD_CATALOG.map((f) => f.code));
const DONE_MSGS = {
  created: 'Đã tạo mẫu mới. Đồng chí kiểm tra lại các trường nhập tay bên dưới.',
  saved: 'Đã lưu mẫu.',
  file: 'Đã thay tệp mẫu.',
  restored: 'Đã khôi phục mẫu gốc.',
  deleted: 'Đã xóa mẫu.',
};

const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

module.exports = (db) => {
  const r = express.Router();
  r.use('/documents', requireLogin, requireRole('admin', 'manager'));

  const wrap = (fn, onError) => (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (e) {
      if (e instanceof AppError) return onError(req, res, e);
      next(e);
    }
  };
  const jsonWrap = (fn) => (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (e) {
      if (e instanceof AppError) return res.status(400).json({ ok: false, error: e.message });
      next(e);
    }
  };
  const notFound = (res, msg = 'Không tìm thấy mẫu văn bản') => res.status(404).render('error', { title: 'Không tìm thấy', code: 404, message: msg });
  const idOf = (req) => Number(req.params.id);
  const tplOr404 = (req, res) => {
    const t = docTemplates.getTemplate(db, idOf(req));
    if (!t) notFound(res);
    return t;
  };
  const unitEmpty = () => Object.values(unitInfo.getUnitInfo(db)).every((v) => !v);
  const base = () => ({ CAT: CATEGORY_LABELS, MODE: MODE_LABELS, TYPES: TYPE_LABELS, isAdmin: false });

  const sendFile = (res, fileName, buffer, contentType) => {
    const ascii = fold(fileName).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'van-ban';
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  };

  // Giải mã tệp .docx gửi dạng base64 trong JSON.
  const readUpload = (body) => {
    const { fileName, data } = body || {};
    if (typeof data !== 'string' || !data) throw new AppError('Đồng chí chưa chọn tệp Word');
    if (!/\.docx$/i.test(String(fileName || ''))) throw new AppError('Chỉ nhận tệp Word .docx');
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) throw new AppError('Tệp rỗng');
    if (buf.length > MAX_FILE) throw new AppError('Tệp mẫu vượt quá 5MB');
    return { fileName: String(fileName), buf };
  };

  // ---- Danh sách mẫu ----
  r.get('/documents', (req, res) => {
    const list = docTemplates.listTemplates(db);
    const groups = Object.keys(CATEGORY_LABELS).map((k) => ({ key: k, label: CATEGORY_LABELS[k], items: list.filter((t) => t.category === k) }))
      .filter((g) => g.items.length);
    res.render('documents/index', {
      ...base(), title: 'Văn bản', groups, unitEmpty: unitEmpty(), isAdmin: req.user.role === 'admin',
      msg: DONE_MSGS[req.query.done] || null,
    });
  });

  r.get('/documents/fields', (req, res) => {
    res.render('documents/fields', {
      ...base(), title: 'Danh mục ô trống',
      common: FIELD_CATALOG.filter((f) => f.group === 'chung'), soldier: FIELD_CATALOG.filter((f) => f.group !== 'chung'),
    });
  });

  // ---- Tải mẫu lên ----
  r.get('/documents/templates/upload', (req, res) => {
    res.render('documents/upload', { ...base(), title: 'Tải mẫu Word lên' });
  });

  r.post('/documents/templates/upload', jsonWrap((req, res) => {
    const { fileName, buf } = readUpload(req.body);
    const { suggestions, braces } = docDetect.detect(buf);
    const id = soldierExcel.saveDraft(db, req.user.id, { kind: 'doc_template', fileName, data: buf.toString('base64'), suggestions, braces });
    res.json({ ok: true, redirect: `/documents/templates/review/${id}` });
  }));

  const renderReview = (res, draftId, d, error, form, status = 200) => {
    const f = form || {};
    const base0 = d.fileName.replace(/\.docx$/i, '');
    res.status(status).render('documents/detect-review', {
      ...base(), title: 'Kiểm tra mẫu vừa tải lên', draftId, d, error, catalog: FIELD_CATALOG,
      form: { name: f.name ?? base0, category: f.category ?? 'khac', mode: f.mode ?? null, decisions: f.decisions || {} },
    });
  };
  const loadDraft = (req, res) => {
    try {
      const d = soldierExcel.getDraft(db, req.params.draftId, req.user.id);
      if (d.kind !== 'doc_template') throw new AppError('Bản xem trước không tồn tại hoặc đã hết hạn, đồng chí vui lòng tải tệp lên lại');
      return d;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      res.status(404).render('documents/upload', { ...base(), title: 'Tải mẫu Word lên', error: e.message });
      return null;
    }
  };

  r.get('/documents/templates/review/:draftId', (req, res) => {
    const d = loadDraft(req, res);
    if (d) renderReview(res, req.params.draftId, d, null);
  });

  r.post('/documents/templates/review/:draftId', (req, res, next) => {
    const d = loadDraft(req, res);
    if (!d) return;
    const decisions = {};
    const list = [];
    for (const s of d.suggestions) {
      const v = String(req.body[`decision_${s.id}`] ?? 'skip');
      decisions[s.id] = v;
      if (v === 'skip') list.push({ id: s.id, action: 'skip' });
      else if (v === 'manual') list.push({ id: s.id, action: 'manual', code: s.newCode });
      else if (v.startsWith('use:')) list.push({ id: s.id, action: 'use', code: v.slice(4) });
      else list.push({ id: s.id, action: 'skip' });
    }
    const form = { name: req.body.name, category: req.body.category, mode: req.body.mode, decisions };
    try {
      const applied = docDetect.applySuggestions(Buffer.from(d.data, 'base64'), list);
      const manual = [...applied.manualFields];
      const made = docTemplates.createTemplate(db, {
        name: req.body.name, category: req.body.category, mode: req.body.mode, file: applied.buffer, manual_fields: manual,
      }, req.user.id);
      soldierExcel.discardDraft(db, req.params.draftId, req.user.id);
      res.redirect(`/documents/templates/${made.id}/edit?done=created`);
    } catch (e) {
      if (e instanceof AppError) return renderReview(res, req.params.draftId, d, e.message, form, 400);
      next(e);
    }
  });

  r.post('/documents/templates/review/:draftId/cancel', (req, res) => {
    soldierExcel.discardDraft(db, req.params.draftId, req.user.id);
    res.redirect('/documents');
  });

  // ---- Sửa mẫu ----
  const warningsOf = (id) => {
    const t = docTemplates.getTemplate(db, id);
    const info = inspectTemplate(docTemplates.getTemplateFile(db, id));
    const known = new Set([...t.manual_fields.map((f) => f.code), ...info.loops]);
    return {
      errors: info.errors,
      unknown: info.tags.filter((c) => c !== '.' && !CATALOG_CODES.has(c) && !known.has(c)),
    };
  };
  const renderEdit = (res, t, error, form, status = 200, done = null) => {
    const w = warningsOf(t.id);
    res.status(status).render('documents/template-form', {
      ...base(), title: `Mẫu: ${t.name}`, t, error, msg: DONE_MSGS[done] || null, warnings: w,
      form: form || { name: t.name, category: t.category, mode: t.mode, manual_fields: t.manual_fields },
    });
  };

  r.get('/documents/templates/:id(\\d+)/edit', (req, res) => {
    const t = tplOr404(req, res);
    if (t) renderEdit(res, t, null, null, 200, req.query.done);
  });

  const manualFromBody = (b) => {
    const codes = asArray(b['mf_code[]']);
    const labels = asArray(b['mf_label[]']);
    const types = asArray(b['mf_type[]']);
    const reqd = asArray(b['mf_required[]']);
    return codes.map((code, i) => ({ code, label: labels[i] ?? '', type: types[i] ?? 'text', required: reqd[i] === '1' }))
      .filter((f) => String(f.code).trim() || String(f.label).trim());
  };

  r.post('/documents/templates/:id(\\d+)/edit', (req, res, next) => {
    const t = tplOr404(req, res);
    if (!t) return;
    const form = { name: req.body.name, category: req.body.category, mode: req.body.mode, manual_fields: manualFromBody(req.body) };
    try {
      docTemplates.updateTemplate(db, t.id, { ...form }, req.user.id);
      res.redirect(`/documents/templates/${t.id}/edit?done=saved`);
    } catch (e) {
      if (e instanceof AppError) return renderEdit(res, t, e.message, form, 400);
      next(e);
    }
  });

  r.get('/documents/templates/:id(\\d+)/file', (req, res) => {
    const t = tplOr404(req, res);
    if (!t) return;
    sendFile(res, `${t.name}.docx`, docTemplates.getTemplateFile(db, t.id), docTemplates.DOCX_TYPE);
  });

  r.post('/documents/templates/:id(\\d+)/file', jsonWrap((req, res) => {
    const t = docTemplates.getTemplate(db, idOf(req));
    if (!t) return res.status(404).json({ ok: false, error: 'Không tìm thấy mẫu văn bản' });
    const { buf } = readUpload(req.body);
    docTemplates.updateTemplate(db, t.id, { file: buf }, req.user.id);
    res.json({ ok: true, redirect: `/documents/templates/${t.id}/edit?done=file` });
  }));

  r.post('/documents/templates/:id(\\d+)/delete', (req, res, next) => {
    const t = tplOr404(req, res);
    if (!t) return;
    try {
      docTemplates.deleteTemplate(db, t.id, req.user.id);
      res.redirect('/documents?done=deleted');
    } catch (e) {
      if (e instanceof AppError) return renderEdit(res, t, e.message, null, 400);
      next(e);
    }
  });

  r.post('/documents/templates/:id(\\d+)/restore', (req, res, next) => {
    const t = tplOr404(req, res);
    if (!t) return;
    try {
      docTemplates.restoreBuiltin(db, t.id, req.user.id);
      res.redirect(`/documents/templates/${t.id}/edit?done=restored`);
    } catch (e) {
      if (e instanceof AppError) return renderEdit(res, t, e.message, null, 400);
      next(e);
    }
  });

  // ---- Tạo văn bản ----
  const renderGenerate = (res, t, { filters = {}, error = null, form = {}, status = 200 } = {}) => {
    const needPeople = t.mode !== 'chung';
    res.status(status).render('documents/generate', {
      ...base(), title: `Tạo văn bản: ${t.name}`, t, error, filters, unitEmpty: unitEmpty(), unit: unitInfo.getUnitInfo(db),
      unitKeys: unitInfo.UNIT_KEYS, isAdmin: res.locals.user && res.locals.user.role === 'admin',
      people: needPeople ? soldiers.listSoldiers(db, filters) : [], units: users.listUnits(db), SL: SOLDIER_LABELS, PARTY: PARTY_FILTERS,
      form: { soldier_ids: (form.soldier_ids || []).map(String), manual: form.manual || {}, ngay_thang: form.ngay_thang || '' },
    });
  };

  r.get('/documents/:id(\\d+)/generate', (req, res) => {
    const t = tplOr404(req, res);
    if (t) renderGenerate(res, t, { filters: clean(req.query) });
  });

  r.post('/documents/:id(\\d+)/generate', (req, res, next) => {
    const t = tplOr404(req, res);
    if (!t) return;
    const manual = {};
    for (const [k, v] of Object.entries(req.body)) {
      const m = /^manual\[([a-z][a-z0-9_]*)\]$/.exec(k);
      if (m && typeof v === 'string') manual[m[1]] = v;
    }
    const soldierIds = asArray(req.body.soldier_ids).map(String);
    const ngayThang = typeof req.body.ngay_thang === 'string' ? req.body.ngay_thang.trim() : '';
    const form = { soldier_ids: soldierIds, manual, ngay_thang: ngayThang };
    try {
      const out = docTemplates.generate(db, t.id, { soldierIds, manual, ngay_thang: ngayThang || undefined }, req.user.id, today());
      sendFile(res, out.fileName, out.buffer, out.contentType);
    } catch (e) {
      if (e instanceof AppError) return renderGenerate(res, t, { error: e.message, form, status: 400 });
      next(e);
    }
  });

  return r;
};
