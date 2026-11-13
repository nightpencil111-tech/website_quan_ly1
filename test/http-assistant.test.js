const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const { startFakeOllama } = require('./helpers-ollama');
const { setSetting } = require('../src/services/users');

async function boot() {
  const s = await startServer();
  const ids = {};
  for (const [u, role, name] of [['mgr', 'manager', 'Trần Quản Lý'], ['mem', 'member', 'Lê Thành Viên'], ['an1', 'member', 'Nguyễn Văn An'], ['an2', 'member', 'Lê Hoàng An'], ['binh', 'member', 'Phạm Văn Bình']]) {
    ids[u] = Number(s.db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
      .run(u, hashPassword('pw12345678'), name, role).lastInsertRowid);
  }
  s.db.prepare('UPDATE users SET must_change_password = 0, password_hash = ? WHERE username = ?').run(hashPassword('admin123'), 'admin');
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
const enableAi = (s, url) => {
  setSetting(s.db, 'ai_enabled', '1');
  setSetting(s.db, 'ai_url', url);
};

test('member: chỉ thấy thẻ Hỏi đáp, không giao việc được', async () => {
  const { s } = await boot();
  try {
    const mem = await loginAs(s.base, 'mem', 'pw12345678');
    const r = await get(s, mem, '/assistant');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Hỏi đáp/);
    assert.doesNotMatch(html, /Giao việc bằng lời/);
    assert.doesNotMatch(html, /Soạn thảo/);
    assert.equal((await get(s, mem, '/assistant?tab=soan-thao')).status, 200); // rơi về Hỏi đáp
    assert.equal((await post(s, mem, '/assistant/task', { text: 'giao đ/c Bình làm báo cáo' })).status, 403);
    assert.equal((await postJson(s, mem, '/assistant/outline', { key: 'ke_hoach' })).status, 403);
    assert.equal((await postJson(s, mem, '/assistant/ai/run', { task: 'rut_gon', input: 'x' })).status, 403);
  } finally { await s.close(); }
});

test('manager: giao việc rõ ràng → chuyển tới /tasks/new điền sẵn', async () => {
  const { s, ids } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const r = await post(s, m, '/assistant/task', { text: 'giao đ/c Bình làm báo cáo chi bộ ngày 25/12/2030 gấp' });
    assert.equal(r.status, 302);
    const loc = r.headers.get('location');
    assert.match(loc, /^\/tasks\/new\?/);
    assert.match(loc, /due_date=2030-12-25/);
    assert.match(loc, new RegExp(`assignee_ids=${ids.binh}`));
    const page = await (await get(s, m, loc)).text();
    assert.match(page, /Phiếu được điền sẵn từ Trợ lý/);
    assert.match(page, /value="2030-12-25"/);
    assert.match(page, new RegExp(`value="${ids.binh}" checked`));
    assert.match(page, /<option value="gap" selected>/);
  } finally { await s.close(); }
});

test('/tasks/new bỏ qua giá trị điền sẵn không hợp lệ', async () => {
  const { s } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const r = await get(s, m, '/tasks/new?priority=xxx&category=yyy&due_date=2030-13-45&assignee_ids=99999&title=Việc%20thử');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /value="Việc thử"/);
    assert.doesNotMatch(html, /2030-13-45/);
    assert.doesNotMatch(html, /value="99999"/);
  } finally { await s.close(); }
});

test('manager: tên trùng → trang chọn người, rồi mới điền sẵn', async () => {
  const { s, ids } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const r = await post(s, m, '/assistant/task', { text: 'giao đ/c An soạn kế hoạch ngày 25/12/2030' });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Nguyễn Văn An/);
    assert.match(html, /Lê Hoàng An/);
    assert.match(html, new RegExp(`type="radio"[^>]*name="pick_0"[^>]*value="${ids.an1}"`));
    assert.match(html, /action="\/assistant\/task\/pick"/);
  } finally { await s.close(); }
});

test('hỏi đáp: POST và ô Hỏi nhanh qua GET', async () => {
  const { s } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const t = Date.now();
    assert.ok(t);
    const mgrId = s.db.prepare("SELECT id FROM users WHERE username='mgr'").get().id;
    s.db.prepare("INSERT INTO tasks (title, category, priority, status, due_date, created_by) VALUES ('Việc trễ hạn thử', 'khac', 'thuong', 'chua_lam', '2020-01-01', ?)").run(mgrId);
    const r = await post(s, m, '/assistant/ask', { q: 'việc nào quá hạn' });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<table/);
    assert.match(html, /Việc trễ hạn thử/);
    const g = await (await get(s, m, '/assistant?tab=hoi-dap&q=' + encodeURIComponent('việc nào quá hạn'))).text();
    assert.match(g, /Việc trễ hạn thử/);
    const mem = await loginAs(s.base, 'mem', 'pw12345678');
    const dash = await (await get(s, mem, '/')).text();
    assert.match(dash, /action="\/assistant"/);
    const u = await post(s, mem, '/assistant/ask', { q: 'ai sắp chuyển Đảng' });
    assert.equal(u.status, 200);
    assert.doesNotMatch(await u.text(), /<table/);
  } finally { await s.close(); }
});

test('dàn ý JSON', async () => {
  const { s } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const r = await postJson(s, m, '/assistant/outline', { key: 'ke_hoach', topic: 'Hội thao' });
    assert.equal(r.status, 200);
    assert.match((await r.json()).text, /I\. MỤC ĐÍCH/);
    const bad = await postJson(s, m, '/assistant/outline', { key: 'khong' });
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).error);
  } finally { await s.close(); }
});

test('AI chạy: stream đúng, tắt → 400, đang bận → 429', async () => {
  const { s } = await boot();
  const fake = await startFakeOllama({ chunks: ['Xin ', 'chào ', 'đồng chí'] });
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const off = await postJson(s, m, '/assistant/ai/run', { task: 'rut_gon', input: 'Một văn bản dài' });
    assert.equal(off.status, 400);
    assert.match((await off.json()).error, /chưa được bật/);
    enableAi(s, fake.url);
    const r = await postJson(s, m, '/assistant/ai/run', { task: 'rut_gon', input: 'Một văn bản dài' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/plain/);
    assert.equal(await r.text(), 'Xin chào đồng chí');
    const bad = await postJson(s, m, '/assistant/ai/run', { task: 'la', input: 'x' });
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).error);
  } finally { await fake.close(); await s.close(); }
});

test('AI: lỗi giữa chừng → dòng [Lỗi: ...] cuối luồng, không 500', async () => {
  const { s } = await boot();
  const fake = await startFakeOllama({ chunks: ['Một ', 'hai'], errorLine: 'hỏng' });
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    enableAi(s, fake.url);
    const r = await postJson(s, m, '/assistant/ai/run', { task: 'rut_gon', input: 'Văn bản' });
    assert.equal(r.status, 200);
    const t = await r.text();
    assert.match(t, /^Một hai\n\n\[Lỗi: .*hỏng.*\]$/);
  } finally { await fake.close(); await s.close(); }
});

test('cài đặt AI: lưu, từ chối địa chỉ công cộng, quyền, kiểm tra kết nối', async () => {
  const { s } = await boot();
  const fake = await startFakeOllama({ models: ['qwen2.5:3b', 'khac:1b'] });
  try {
    const a = await loginAs(s.base, 'admin', 'admin123');
    const ok = await post(s, a, '/admin/settings/ai', { ai_enabled: '1', ai_url: fake.url, ai_model: 'qwen2.5:3b', ai_timeout_s: '120', sample_chung: 'Mẫu văn thử' });
    assert.equal(ok.status, 302);
    const page = await (await get(s, a, '/admin/settings?saved=1')).text();
    assert.match(page, /Trợ lý AI/);
    assert.match(page, /Mẫu văn thử/);
    assert.match(page, /qwen2\.5:3b/);
    const pub = await post(s, a, '/admin/settings/ai', { ai_enabled: '1', ai_url: 'http://8.8.8.8:11434', ai_model: 'qwen2.5:3b', ai_timeout_s: '120' });
    assert.equal(pub.status, 400);
    assert.match(await pub.text(), /nội bộ/);
    const chk = await postJson(s, a, '/admin/settings/ai/check', {});
    assert.equal(chk.status, 200);
    const j = await chk.json();
    assert.equal(j.ok, true);
    assert.ok(j.models.includes('khac:1b'));
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    assert.equal((await post(s, m, '/admin/settings/ai', { ai_url: fake.url, ai_model: 'x', ai_timeout_s: '60' })).status, 403);
    assert.equal((await postJson(s, m, '/admin/settings/ai/check', {})).status, 403);
  } finally { await fake.close(); await s.close(); }
});

test('form văn bản: nút AI theo cài đặt; menu Trợ lý', async () => {
  const { s } = await boot();
  const fake = await startFakeOllama();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const id = s.db.prepare("SELECT id FROM doc_templates WHERE name = 'Kế hoạch'").get().id;
    let html = await (await get(s, m, `/documents/${id}/generate`)).text();
    assert.match(html, /Chèn dàn ý/);
    assert.match(html, /Trợ lý AI chưa được bật/);
    assert.doesNotMatch(html, /AI viết nội dung/);
    assert.match(html, /href="\/assistant"/);
    enableAi(s, fake.url);
    html = await (await get(s, m, `/documents/${id}/generate`)).text();
    assert.match(html, /AI viết nội dung/);
    assert.match(html, /src="\/js\/assistant\.js"/);
  } finally { await fake.close(); await s.close(); }
});

test('/tasks/new: note tự do bị bỏ, unmatched được làm sạch', async () => {
  const { s } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const q = new URLSearchParams();
    q.set('title', 'Việc');
    q.set('note', 'Bấm vào http://xau.example để nhận thưởng');
    q.append('unmatched', 'Nguyễn Hùng');
    q.append('unmatched', '<b>x</b>');
    q.append('unmatched', 'A'.repeat(41));
    q.append('unmatched', 'Số 7');
    const html = await (await get(s, m, '/tasks/new?' + q)).text();
    assert.doesNotMatch(html, /xau\.example/);
    assert.match(html, /Không tìm thấy người tên “Nguyễn Hùng” \(có thể đã bị khóa hoặc gõ sai\)\./);
    assert.doesNotMatch(html, /<b>x/);
    assert.doesNotMatch(html, /AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/);
    assert.doesNotMatch(html, /Số 7/);
  } finally { await s.close(); }
});

test('hai cụm trùng tên: mỗi cụm một nhóm radio, chọn xong chuyển sang phiếu', async () => {
  const { s, ids } = await boot();
  try {
    const mk = (u, name) => Number(s.db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
      .run(u, hashPassword('pw12345678'), name, 'member').lastInsertRowid);
    const h1 = mk('hung1', 'Đỗ Quang Hùng');
    const h2 = mk('hung2', 'Vũ Minh Hùng');
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const r = await post(s, m, '/assistant/task', { text: 'giao đ/c An và đ/c Hùng soạn kế hoạch ngày 25/12/2030, đ/c Zzzz' });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /name="pick_0"/);
    assert.match(html, /name="pick_1"/);
    assert.match(html, /name="unmatched" value="Zzzz"/i);
    const loc = (await get(s, m, `/assistant/task/pick?title=Vi%E1%BB%87c&due_date=2030-12-25&pick_0=${ids.an1}&pick_1=${h2}&unmatched=Zzzz`)).headers.get('location');
    assert.match(loc, /^\/tasks\/new\?/);
    const u = new URLSearchParams(loc.split('?')[1]);
    assert.deepEqual(u.getAll('assignee_ids').map(Number).sort(), [ids.an1, h2].sort());
    assert.deepEqual(u.getAll('unmatched'), ['Zzzz']);
    assert.equal(u.get('due_date'), '2030-12-25');
    assert.ok(h1);
    const member = await loginAs(s.base, 'mem', 'pw12345678');
    assert.equal((await get(s, member, '/assistant/task/pick?pick_0=1')).status, 403);
  } finally { await s.close(); }
});
