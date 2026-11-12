const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const soldiers = require('../src/services/soldiers');
const { getMilestoneSettings } = require('../src/services/milestones');

async function boot() {
  const s = await startServer();
  s.db.prepare('UPDATE users SET must_change_password = 0 WHERE username = ?').run('admin');
  s.db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hashPassword('admin123'), 'admin');
  for (const [u, role] of [['mgr', 'manager'], ['mem', 'member']]) {
    s.db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
      .run(u, hashPassword('pw12345678'), u, role);
  }
  return s;
}
const get = (s, sess, p) => fetch(s.base + p, { headers: { cookie: sess.cookie }, redirect: 'manual' });
const post = (s, sess, p, body) => fetch(s.base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: sess.cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: sess.csrf, ...body }),
});
const uid = (s, name) => s.db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;

test('cài đặt thời hạn nhắc mốc', async () => {
  const s = await boot();
  try {
    const adm = await loginAs(s.base, 'admin', 'admin123');
    const mgr = await loginAs(s.base, 'mgr', 'pw12345678');
    let res = await post(s, adm, '/admin/settings/milestones', { party_probation_months: '12', service_months: '', reminder_days: '45', 'rank_intervals[Binh nhì]': '24' });
    assert.equal(res.status, 302);
    const cfg = getMilestoneSettings(s.db);
    assert.equal(cfg.party_probation_months, 12);
    assert.equal(cfg.service_months, null);
    assert.equal(cfg.reminder_days, 45);
    assert.equal(cfg.rank_intervals['Binh nhì'], 24);
    res = await post(s, adm, '/admin/settings/milestones', { party_probation_months: 'abc' });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /phải là số nguyên/);
    res = await post(s, mgr, '/admin/settings/milestones', { party_probation_months: '6' });
    assert.equal(res.status, 403);
    assert.equal(getMilestoneSettings(s.db).party_probation_months, 12);
    const page = await (await get(s, adm, '/admin/settings')).text();
    assert.match(page, /Thời hạn nhắc mốc/);
    assert.match(page, /rank_intervals\[Binh nhì\]/);
    assert.doesNotMatch(page, /rank_intervals\[Công nhân viên quốc phòng\]/);
  } finally { await s.close(); }
});

test('trang mốc và tổng quan', async () => {
  const s = await boot();
  try {
    const adm = await loginAs(s.base, 'admin', 'admin123');
    const mgr = await loginAs(s.base, 'mgr', 'pw12345678');
    const mem = await loginAs(s.base, 'mem', 'pw12345678');
    let res = await get(s, mgr, '/soldiers/milestones');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Chưa cấu hình/);
    assert.match(html, /Đề nghị chỉ huy cấu hình/);
    assert.match(await (await get(s, adm, '/soldiers/milestones')).text(), /href="\/admin\/settings"/);
    assert.equal((await get(s, mem, '/soldiers/milestones')).status, 403);
    assert.match(await (await get(s, mgr, '/')).text(), /Mốc sắp đến/);
    assert.doesNotMatch(await (await get(s, mem, '/')).text(), /Mốc sắp đến/);
  } finally { await s.close(); }
});

test('liên kết tài khoản với hồ sơ', async () => {
  const s = await boot();
  try {
    const adm = await loginAs(s.base, 'admin', 'admin123');
    const memId = uid(s, 'mem');
    const a = soldiers.createSoldier(s.db, { full_name: 'Nguyễn A' }, 1);
    const b = soldiers.createSoldier(s.db, { full_name: 'Trần B' }, 1);
    const form = await (await get(s, adm, `/admin/users/${memId}/edit`)).text();
    assert.match(form, /Liên kết hồ sơ quân nhân/);
    assert.match(form, /Nguyễn A/);
    const base = { full_name: 'mem', role: 'member', party_status: 'khong' };
    let res = await post(s, adm, `/admin/users/${memId}`, { ...base, soldier_id: String(a) });
    assert.equal(res.status, 302);
    assert.equal(soldiers.findByUser(s.db, memId).id, a);
    assert.match(await (await get(s, adm, '/admin/users')).text(), /Nguyễn A/);
    // đổi sang hồ sơ khác
    res = await post(s, adm, `/admin/users/${memId}`, { ...base, soldier_id: String(b) });
    assert.equal(res.status, 302);
    assert.equal(soldiers.findByUser(s.db, memId).id, b);
    // hồ sơ đã liên kết người khác
    const mgrId = uid(s, 'mgr');
    res = await post(s, adm, `/admin/users/${mgrId}`, { full_name: 'mgr', role: 'manager', party_status: 'khong', soldier_id: String(b) });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /đã được liên kết/);
    // gỡ liên kết
    res = await post(s, adm, `/admin/users/${memId}`, { ...base, soldier_id: '' });
    assert.equal(res.status, 302);
    assert.equal(soldiers.findByUser(s.db, memId), null);
    // tạo mới có liên kết
    res = await post(s, adm, '/admin/users', { username: 'newu', full_name: 'Mới', role: 'member', party_status: 'khong', soldier_id: String(a) });
    assert.equal(res.status, 200);
    assert.equal(soldiers.findByUser(s.db, uid(s, 'newu')).id, a);
  } finally { await s.close(); }
});
