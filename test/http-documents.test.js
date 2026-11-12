const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const soldiers = require('../src/services/soldiers');
const unitInfo = require('../src/services/unitInfo');
const docTemplates = require('../src/services/docTemplates');
const { makeDocx, docxText } = require('./helpers-docx');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function boot() {
  const s = await startServer();
  const ids = {};
  for (const [u, role] of [['mgr', 'manager'], ['mem', 'member']]) {
    ids[u] = Number(s.db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
      .run(u, hashPassword('pw12345678'), `Tên ${u}`, role).lastInsertRowid);
  }
  s.db.prepare('UPDATE users SET must_change_password = 0, password_hash = ? WHERE username = ?').run(hashPassword('admin123'), 'admin');
  ids.sa = soldiers.createSoldier(s.db, { full_name: 'Nguyễn Văn An', rank: 'Binh nhất' }, ids.mgr);
  ids.sb = soldiers.createSoldier(s.db, { full_name: 'Trần Văn Bình', rank: 'Hạ sĩ' }, ids.mgr);
  unitInfo.saveUnitInfo(s.db, { cap_tren: 'TIEU-DOAN-X', don_vi: 'Đại đội 1' }, ids.mgr);
  return { s, ids };
}
const get = (s, sess, p) => fetch(s.base + p, { headers: { cookie: sess.cookie }, redirect: 'manual' });
const post = (s, sess, p, body = {}) => fetch(s.base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: sess.cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: sess.csrf, ...body }),
});
const postJson = (s, sess, p, obj) => fetch(s.base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: sess.cookie, 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': sess.csrf },
  body: JSON.stringify(obj),
});
const tplId = (s, name) => s.db.prepare('SELECT id FROM doc_templates WHERE name = ?').get(name).id;

test('member bị chặn /documents*', async () => {
  const { s } = await boot();
  try {
    const mem = await loginAs(s.base, 'mem', 'pw12345678');
    for (const p of ['/documents', '/documents/fields', '/documents/templates/upload', `/documents/${tplId(s, 'Kế hoạch')}/generate`]) {
      assert.equal((await get(s, mem, p)).status, 403, p);
    }
    assert.equal((await post(s, mem, `/documents/${tplId(s, 'Kế hoạch')}/generate`, {})).status, 403);
  } finally { await s.close(); }
});

test('manager mở các trang không lỗi', async () => {
  const { s } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const id = tplId(s, 'Kế hoạch');
    const dsId = tplId(s, 'Danh sách quân nhân');
    for (const p of ['/documents', '/documents/fields', '/documents/templates/upload', `/documents/${id}/generate`,
      `/documents/${dsId}/generate?q=Nguy`, `/documents/templates/${id}/edit`]) {
      const r = await get(s, m, p);
      assert.equal(r.status, 200, p);
    }
    assert.equal((await get(s, m, `/documents/templates/${id}/file`)).headers.get('content-type'), DOCX);
    assert.equal((await get(s, m, '/documents/9999/generate')).status, 404);
  } finally { await s.close(); }
});

test('tạo văn bản chung: tải docx, thiếu trường bắt buộc → 400', async () => {
  const { s } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const id = tplId(s, 'Kế hoạch');
    const r = await post(s, m, `/documents/${id}/generate`, { 'manual[trich_yeu]': 'Trích yếu thử', 'manual[noi_dung]': 'Nội dung thử nghiệm' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), DOCX);
    assert.match(r.headers.get('content-disposition'), /attachment; filename="[^"]+"; filename\*=UTF-8''/);
    const text = docxText(Buffer.from(await r.arrayBuffer()));
    assert.match(text, /Nội dung thử nghiệm/);
    assert.match(text, /TIEU-DOAN-X/);
    const bad = await post(s, m, `/documents/${id}/generate`, { 'manual[noi_dung]': 'Giữ lại nội dung' });
    assert.equal(bad.status, 400);
    const html = await bad.text();
    assert.match(html, /Trích yếu/);
    assert.match(html, /Giữ lại nội dung/);
    assert.equal(s.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'doc_generate'").get().c, 1);
  } finally { await s.close(); }
});

test('danh sách quân nhân: chọn 2 người → docx có 2 họ tên; không chọn → 400', async () => {
  const { s, ids } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const id = tplId(s, 'Danh sách quân nhân');
    const r = await fetch(s.base + `/documents/${id}/generate`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: m.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `_csrf=${encodeURIComponent(m.csrf)}&soldier_ids=${ids.sa}&soldier_ids=${ids.sb}&manual%5Btrich_yeu%5D=Tr%C3%ADch`,
    });
    assert.equal(r.status, 200);
    const text = docxText(Buffer.from(await r.arrayBuffer()));
    assert.match(text, /Nguyễn Văn An/);
    assert.match(text, /Trần Văn Bình/);
    const none = await post(s, m, `/documents/${id}/generate`, { 'manual[trich_yeu]': 'x' });
    assert.equal(none.status, 400);
    assert.match(await none.text(), /Chưa chọn quân nhân/);
  } finally { await s.close(); }
});

test('tải mẫu lên → review → xác nhận → mẫu mới dùng được', async () => {
  const { s, ids } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const buf = makeDocx(['BẢN TỰ KIỂM ĐIỂM', 'Họ và tên: ......', 'Cấp bậc: ......']);
    const up = await postJson(s, m, '/documents/templates/upload', { fileName: 'Tu kiem diem.docx', data: buf.toString('base64') });
    const j = await up.json();
    assert.equal(j.ok, true);
    assert.match(j.redirect, /^\/documents\/templates\/review\//);
    const rv = await get(s, m, j.redirect);
    assert.equal(rv.status, 200);
    const html = await rv.text();
    assert.match(html, /Họ và tên/);
    // quyết định: mục 0 → ho_ten, mục 1 → cap_bac (theo id trong form)
    const ids2 = [...html.matchAll(/name="decision_([\w-]+)"/g)].map((x) => x[1]);
    assert.ok(ids2.length >= 2);
    const body = { _csrf: m.csrf, name: 'Tự kiểm điểm', category: 'khac', mode: 'tung_nguoi' };
    for (const id of ids2) body[`decision_${id}`] = 'use:' + (id === ids2[0] ? 'ho_ten' : 'cap_bac');
    const conf = await post(s, m, j.redirect, body);
    assert.equal(conf.status, 302);
    assert.match(conf.headers.get('location'), /^\/documents\/templates\/\d+\/edit/);
    const t = s.db.prepare("SELECT id FROM doc_templates WHERE name = 'Tự kiểm điểm'").get();
    const meta = docTemplates.getTemplate(s.db, t.id);
    assert.equal(meta.mode, 'tung_nguoi');
    const { inspectTemplate } = require('../src/services/docRender');
    assert.ok(inspectTemplate(docTemplates.getTemplateFile(s.db, t.id)).tags.includes('ho_ten'));
    const g = await fetch(s.base + `/documents/${t.id}/generate`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: m.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: `_csrf=${encodeURIComponent(m.csrf)}&soldier_ids=${ids.sa}`,
    });
    assert.equal(g.status, 200);
    assert.match(docxText(Buffer.from(await g.arrayBuffer())), /Họ và tên: Nguyễn Văn An/);
    assert.equal((await get(s, m, conf.headers.get('location'))).status, 200);
  } finally { await s.close(); }
});

test('tải lên rác → JSON lỗi; thay file; xóa/khôi phục', async () => {
  const { s } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const up = await postJson(s, m, '/documents/templates/upload', { fileName: 'x.docx', data: Buffer.from('rác rưởi').toString('base64') });
    assert.equal(up.status, 400);
    assert.match((await up.json()).error, /không đúng định dạng/);
    const none = await postJson(s, m, '/documents/templates/upload', { fileName: 'x.docx' });
    assert.equal(none.status, 400);
    const kh = tplId(s, 'Kế hoạch');
    const d = await post(s, m, `/documents/templates/${kh}/delete`);
    assert.equal(d.status, 400);
    assert.ok(s.db.prepare('SELECT 1 FROM doc_templates WHERE id = ?').get(kh));
    const rs = await post(s, m, `/documents/templates/${kh}/restore`);
    assert.equal(rs.status, 302);
    const created = docTemplates.createTemplate(s.db, { name: 'Tạm', category: 'khac', mode: 'chung', file: makeDocx(['Xin chào {don_vi}']) }, 1);
    const rep = await postJson(s, m, `/documents/templates/${created.id}/file`, { fileName: 'm.docx', data: makeDocx(['Mới {cap_tren}']).toString('base64') });
    assert.equal((await rep.json()).ok, true);
    const bad = await postJson(s, m, `/documents/templates/${created.id}/file`, { fileName: 'm.docx', data: makeDocx(['Hỏng {cap_tren']).toString('base64') });
    assert.equal(bad.status, 400);
    const del = await post(s, m, `/documents/templates/${created.id}/delete`);
    assert.equal(del.status, 302);
    assert.equal(s.db.prepare('SELECT 1 FROM doc_templates WHERE id = ?').get(created.id), undefined);
  } finally { await s.close(); }
});

test('sửa mẫu: thêm trường nhập tay; mẫu cú pháp sai không làm 500 khi tạo', async () => {
  const { s } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const t = docTemplates.createTemplate(s.db, { name: 'Mẫu A', category: 'khac', mode: 'chung', file: makeDocx(['{ghi_chu_a}']) }, 1);
    const r = await post(s, m, `/documents/templates/${t.id}/edit`, {
      name: 'Mẫu A2', category: 'bao_cao', mode: 'chung',
      'mf_code[]': 'ghi_chu_a', 'mf_label[]': 'Ghi chú A', 'mf_type[]': 'textarea', 'mf_required[]': '1',
    });
    assert.equal(r.status, 302);
    const meta = docTemplates.getTemplate(s.db, t.id);
    assert.equal(meta.name, 'Mẫu A2');
    assert.deepEqual(meta.manual_fields.map((f) => [f.code, f.type, f.required]), [['ghi_chu_a', 'textarea', true]]);
    const bad = await post(s, m, `/documents/templates/${t.id}/edit`, { name: '', category: 'khac', mode: 'chung' });
    assert.equal(bad.status, 400);
    const g = await post(s, m, `/documents/${t.id}/generate`, { 'manual[ghi_chu_a]': 'abc & <x>' });
    assert.equal(g.status, 200);
  } finally { await s.close(); }
});

test('thông tin đơn vị: admin lưu được, manager bị chặn', async () => {
  const { s } = await boot();
  try {
    const a = await loginAs(s.base, 'admin', 'admin123');
    const body = {};
    for (const k of Object.keys(unitInfo.UNIT_KEYS)) body[k] = `giá trị ${k}`;
    const r = await post(s, a, '/admin/settings/unit-info', body);
    assert.equal(r.status, 302);
    assert.equal(unitInfo.getUnitInfo(s.db).dia_danh, 'giá trị dia_danh');
    assert.equal((await get(s, a, '/admin/settings')).status, 200);
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    assert.equal((await post(s, m, '/admin/settings/unit-info', body)).status, 403);
  } finally { await s.close(); }
});
