const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const { seed } = require('../src/db');
const { AppError } = require('../src/util/errors');
const tpl = require('../src/services/templates');
const tasks = require('../src/services/tasks');

function mkUser(db, username, role) {
  return Number(db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword('x'), `Họ ${username}`, role).lastInsertRowid);
}

test('seed thêm 2 mẫu, idempotent', () => {
  const db = makeDb();
  seed(db); seed(db);
  const list = tpl.listTemplates(db);
  assert.equal(list.length, 2);
  const a = list.find((t) => t.name === 'Tổ chức kỷ niệm ngày thành lập QĐND 22/12');
  const b = list.find((t) => t.name === 'Sinh hoạt chi bộ thường kỳ');
  assert.equal(a.items.length, 8);
  assert.equal(b.items.length, 4);
});

test('CRUD mẫu và nhật ký', () => {
  const db = makeDb();
  const admin = mkUser(db, 'ad', 'admin');
  const id = tpl.createTemplate(db, { name: 'Mẫu 1', category: 'dan_van', description: 'mô tả', items: 'a\n\n b \nc' }, admin);
  assert.deepEqual(tpl.getTemplate(db, id).items, ['a', 'b', 'c']);
  tpl.updateTemplate(db, id, { name: 'Mẫu 2', category: '', description: '', items: ['x'] }, admin);
  const t = tpl.getTemplate(db, id);
  assert.equal(t.name, 'Mẫu 2'); assert.equal(t.category, null); assert.deepEqual(t.items, ['x']);
  assert.throws(() => tpl.createTemplate(db, { name: '  ' }, admin), AppError);
  tpl.deleteTemplate(db, id, admin);
  assert.equal(tpl.getTemplate(db, id), null);
  const acts = db.prepare('SELECT action FROM audit_log').all().map((r) => r.action);
  assert.deepEqual(acts, ['template_create', 'template_update', 'template_delete']);
});

test('instantiate tạo việc đúng số mục checklist và gán template_id', () => {
  const db = makeDb();
  seed(db);
  const mgr = mkUser(db, 'mg', 'manager');
  const m = mkUser(db, 'm1', 'member');
  const t = tpl.listTemplates(db).find((x) => x.items.length === 8);
  const id = tpl.instantiate(db, t.id, { due_date: '2026-12-20', assignee_ids: [m], priority: 'gap' }, mgr);
  const task = tasks.getTask(db, id);
  assert.equal(task.checklist.length, 8);
  assert.equal(task.template_id, t.id);
  assert.equal(task.priority, 'gap');
  assert.equal(task.title, t.name);
  assert.throws(() => tpl.instantiate(db, 9999, { due_date: '2026-12-20', assignee_ids: [m] }, mgr), AppError);
});

test('HTTP: /templates chỉ manager/admin; tab; giao theo mẫu điền sẵn', async () => {
  const s = await startServer();
  try {
    const { db, base } = s;
    db.prepare("UPDATE users SET must_change_password = 0 WHERE username='admin'").run();
    db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)').run('mg', hashPassword('pw'), 'Quản lý', 'manager');
    db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)').run('sd', hashPassword('pw'), 'Chiến sĩ', 'member');
    const mem = await loginAs(base, 'sd', 'pw');
    assert.equal((await fetch(`${base}/templates`, { headers: { cookie: mem.cookie } })).status, 403);
    const mg = await loginAs(base, 'mg', 'pw');
    const h = { cookie: mg.cookie };
    let r = await fetch(`${base}/templates`, { headers: h });
    assert.equal(r.status, 200);
    let html = await r.text();
    assert.match(html, /Mẫu công việc/); assert.match(html, /Giao theo mẫu/);
    r = await fetch(`${base}/templates?tab=recurring`, { headers: h });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Việc định kỳ/);
    r = await fetch(`${base}/tasks/new?template=2`, { headers: h });
    html = await r.text();
    assert.equal(r.status, 200);
    assert.match(html, /Sinh hoạt chi bộ thường kỳ/);
    assert.match(html, /dự thảo nghị quyết/i);
    assert.match(html, /name="template_id" value="2"/);
    // tạo việc qua form → có template_id và checklist
    const sd = db.prepare("SELECT id FROM users WHERE username='sd'").get().id;
    r = await fetch(`${base}/tasks`, {
      method: 'POST', redirect: 'manual',
      headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: mg.csrf, title: 'Họp chi bộ', category: 'cong_tac_dang', priority: 'thuong', due_date: '2026-12-01', assignee_ids: String(sd), template_id: '2', checklist: 'một\nhai' }),
    });
    assert.equal(r.status, 302);
    const t = db.prepare('SELECT * FROM tasks ORDER BY id DESC LIMIT 1').get();
    assert.equal(t.template_id, 2);
    // tạo mẫu qua HTTP
    r = await fetch(`${base}/templates`, {
      method: 'POST', redirect: 'manual',
      headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: mg.csrf, name: 'Mẫu mới', category: 'khac', description: '', items: 'a\nb' }),
    });
    assert.equal(r.status, 302);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM task_templates WHERE name='Mẫu mới'").get().c, 1);
    // chạy sinh việc thủ công
    r = await fetch(`${base}/templates/generate`, {
      method: 'POST', redirect: 'manual',
      headers: { ...h, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: mg.csrf }),
    });
    assert.equal(r.status, 302);
    r = await fetch(`${base}${r.headers.get('location')}`, { headers: h });
    assert.match(await r.text(), /Đã sinh 0 công việc/);
  } finally { await s.close(); }
});
