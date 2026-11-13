const express = require('express');
const { requireLogin, requireRole } = require('../auth');
const { today } = require('../util/date');
const { AppError } = require('../util/errors');
const { parseTaskSentence } = require('../services/assistant/taskParser');
const qa = require('../services/assistant/qa');
const outlines = require('../services/assistant/outlines');
const ai = require('../services/assistant/ai');
const { cleanNames } = require('../util/names');

const MANAGERS = ['admin', 'manager'];
const isManager = (u) => MANAGERS.includes(u.role);
const MAX_Q = 300;
const MAX_TASK_TEXT = 1000;

module.exports = (db) => {
  const r = express.Router();
  r.use('/assistant', requireLogin);

  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const tabsFor = (user) => (isManager(user)
    ? [['giao-viec', 'Giao việc bằng lời'], ['hoi-dap', 'Hỏi đáp'], ['soan-thao', 'Soạn thảo']]
    : [['hoi-dap', 'Hỏi đáp']]);

  const renderIndex = (req, res, tab, extra = {}, status = 200) => {
    const tabs = tabsFor(req.user);
    const cur = tabs.some(([k]) => k === tab) ? tab : (isManager(req.user) ? 'giao-viec' : 'hoi-dap');
    const s = ai.getAiSettings(db);
    res.status(status).render('assistant/index', {
      title: 'Trợ lý', tabs, tab: cur, manager: isManager(req.user), aiEnabled: s.ai_enabled === '1',
      outlineList: Object.entries(outlines.OUTLINES).map(([k, v]) => [k, v.label]),
      suggestions: qa.suggestions(req.user.role), q: '', result: null, taskText: '', error: null, ...extra,
    });
  };

  const runAsk = (req, text) => {
    const q = str(text, MAX_Q);
    return { q, result: q ? qa.answer(db, req.user, q, today()) : null };
  };

  r.get('/assistant', (req, res) => {
    const tab = String(req.query.tab || '');
    const asking = typeof req.query.q === 'string' && req.query.q.trim();
    renderIndex(req, res, asking ? 'hoi-dap' : tab, asking ? runAsk(req, req.query.q) : {});
  });

  r.post('/assistant/ask', (req, res) => {
    renderIndex(req, res, 'hoi-dap', runAsk(req, req.body.q));
  });

  // ---- Giao việc bằng lời ----
  const prefillQuery = (draft, assigneeIds, unmatched) => {
    const p = new URLSearchParams();
    p.set('title', draft.title);
    if (draft.priority) p.set('priority', draft.priority);
    if (draft.category) p.set('category', draft.category);
    if (draft.due_date) p.set('due_date', draft.due_date);
    for (const id of assigneeIds) p.append('assignee_ids', String(id));
    for (const n of cleanNames(unmatched)) p.append('unmatched', n);
    return p;
  };

  r.post('/assistant/task', requireRole(...MANAGERS), (req, res, next) => {
    const text = str(req.body.text, MAX_TASK_TEXT);
    try {
      const draft = parseTaskSentence(db, text, today());
      const ids = draft.assignees.map((a) => a.id);
      if (draft.ambiguous.length) {
        return res.render('assistant/task-result', {
          title: 'Chọn đúng người', draft, resolved: draft.assignees,
        });
      }
      res.redirect('/tasks/new?' + prefillQuery(draft, ids, draft.unmatched).toString());
    } catch (e) {
      if (e instanceof AppError) return renderIndex(req, res, 'giao-viec', { taskText: text, error: e.message }, 400);
      next(e);
    }
  });

  // Chọn người cho các cụm trùng tên (pick_0, pick_1, ...) rồi chuyển sang phiếu điền sẵn.
  r.get('/assistant/task/pick', requireRole(...MANAGERS), (req, res) => {
    const ids = [];
    const add = (v) => { const n = Number(v); if (Number.isInteger(n) && n > 0 && !ids.includes(n)) ids.push(n); };
    [].concat(req.query.assignee_ids ?? []).forEach(add);
    for (let i = 0; i < 20; i += 1) add(req.query[`pick_${i}`]);
    const draft = {
      title: str(req.query.title, 200), priority: str(req.query.priority, 20), category: str(req.query.category, 20), due_date: str(req.query.due_date, 10),
    };
    res.redirect('/tasks/new?' + prefillQuery(draft, ids, req.query.unmatched).toString());
  });

  // ---- Dàn ý ----
  r.post('/assistant/outline', requireRole(...MANAGERS), (req, res) => {
    try {
      const text = outlines.buildOutline(db, req.body.key, { topic: str(req.body.topic, 200) }, today());
      res.json({ ok: true, text });
    } catch (e) {
      if (e instanceof AppError) return res.status(400).json({ ok: false, error: e.message });
      throw e;
    }
  });

  // ---- AI (luồng văn bản) ----
  r.post('/assistant/ai/run', requireRole(...MANAGERS), async (req, res) => {
    const b = req.body || {};
    const ctrl = new AbortController();
    let started = false;
    res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
    const onChunk = (chunk) => {
      if (res.destroyed) throw new Error('Client đã đóng kết nối');
      if (!started) {
        started = true;
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      }
      res.write(chunk);
    };
    try {
      await ai.runAi(db, req.user, {
        task: typeof b.task === 'string' ? b.task : '',
        input: typeof b.input === 'string' ? b.input : '',
        docType: typeof b.docType === 'string' ? b.docType : '',
        extra: b.extra && typeof b.extra === 'object' ? { trich_yeu: typeof b.extra.trich_yeu === 'string' ? b.extra.trich_yeu : '' } : {},
      }, onChunk, ctrl.signal);
      if (!started) res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end();
    } catch (e) {
      const msg = e instanceof AppError ? e.message : 'Trợ lý AI gặp sự cố';
      if (!(e instanceof AppError)) console.error(e);
      if (res.destroyed) return;
      if (!started) return res.status(e.status === 429 ? 429 : 400).json({ ok: false, error: msg });
      res.write(`\n\n[Lỗi: ${msg}]`);
      res.end();
    }
  });

  return r;
};
