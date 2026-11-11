const { AppError } = require('../util/errors');
const { LABELS } = require('../util/text');
const audit = require('./audit');
const tasks = require('./tasks');

function parseItems(items) {
  const arr = Array.isArray(items) ? items : String(items ?? '').split(/\r?\n/);
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

function hydrate(row) {
  if (!row) return null;
  let items = [];
  try { items = JSON.parse(row.items_json); } catch { items = []; }
  return { ...row, items };
}

function listTemplates(db) {
  return db.prepare('SELECT * FROM task_templates ORDER BY id').all().map(hydrate);
}

function getTemplate(db, id) {
  return hydrate(db.prepare('SELECT * FROM task_templates WHERE id = ?').get(id));
}

function validate(f) {
  const name = String(f.name ?? '').trim();
  if (!name) throw new AppError('Tên mẫu không được để trống');
  const category = f.category ? String(f.category) : null;
  if (category && !Object.hasOwn(LABELS.category, category)) throw new AppError('Lĩnh vực không hợp lệ');
  const description = String(f.description ?? '').trim() || null;
  return { name, category, description, items: parseItems(f.items) };
}

function createTemplate(db, f, actorId) {
  const v = validate(f);
  const id = Number(db.prepare('INSERT INTO task_templates (name, category, description, items_json) VALUES (?, ?, ?, ?)')
    .run(v.name, v.category, v.description, JSON.stringify(v.items)).lastInsertRowid);
  audit.log(db, actorId, 'template_create', `template:${id}`, v.name);
  return id;
}

function updateTemplate(db, id, f, actorId) {
  if (!getTemplate(db, id)) throw new AppError('Không tìm thấy mẫu công việc');
  const v = validate(f);
  db.prepare('UPDATE task_templates SET name=?, category=?, description=?, items_json=? WHERE id=?')
    .run(v.name, v.category, v.description, JSON.stringify(v.items), id);
  audit.log(db, actorId, 'template_update', `template:${id}`, v.name);
}

function deleteTemplate(db, id, actorId) {
  const cur = getTemplate(db, id);
  if (!cur) throw new AppError('Không tìm thấy mẫu công việc');
  db.prepare('DELETE FROM task_templates WHERE id = ?').run(id);
  audit.log(db, actorId, 'template_delete', `template:${id}`, cur.name);
}

// createTask tự mở transaction (R9) nên không bọc BEGIN ở đây.
function instantiate(db, templateId, data, actorId) {
  const t = getTemplate(db, templateId);
  if (!t) throw new AppError('Không tìm thấy mẫu công việc');
  return tasks.createTask(db, {
    title: data.title || t.name,
    description: t.description,
    category: t.category || 'khac',
    priority: data.priority || 'thuong',
    due_date: data.due_date,
    assignee_ids: data.assignee_ids,
    checklist: t.items,
    template_id: t.id,
  }, actorId);
}

module.exports = { listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate, instantiate, parseItems };
