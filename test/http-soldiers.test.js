const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const soldiers = require('../src/services/soldiers');
const items = require('../src/services/soldierItems');

async function boot() {
  const s = await startServer();
  const ids = {};
  for (const [u, role] of [['mgr', 'manager'], ['ma', 'member'], ['mc', 'member']]) {
    ids[u] = Number(s.db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
      .run(u, hashPassword('pw12345678'), `Tên ${u}`, role).lastInsertRowid);
  }
  ids.sa = soldiers.createSoldier(s.db, { full_name: 'Nguyễn Văn An', rank: 'Binh nhất', user_id: ids.ma }, ids.mgr);
  ids.sb = soldiers.createSoldier(s.db, { full_name: 'Trần Văn Bình' }, ids.mgr);
  ids.famA = items.addItem(s.db, 'family', ids.sa, { relation: 'Cha', full_name: 'Nguyễn Cha', hardship_note: 'HOANCANH-BIMAT' }, ids.mgr);
  items.addItem(s.db, 'thought', ids.sa, { content: 'TUTUONG-BIMAT', level: 'dac_biet' }, ids.mgr);
  return { s, ids };
}
const get = (s, sess, p) => fetch(s.base + p, { headers: { cookie: sess.cookie }, redirect: 'manual' });
const post = (s, sess, p, body = {}) => fetch(s.base + p, {
  method: 'POST', redirect: 'manual',
  headers: { cookie: sess.cookie, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ _csrf: sess.csrf, ...body }),
});

test('member bị chặn mọi đường /soldiers*', async () => {
  const { s, ids } = await boot();
  try {
    const ma = await loginAs(s.base, 'ma', 'pw12345678');
    for (const p of ['/soldiers', `/soldiers/${ids.sa}`, `/soldiers/${ids.sa}/thought/new`, '/soldiers/new']) {
      assert.equal((await get(s, ma, p)).status, 403, p);
    }
    assert.equal((await post(s, ma, `/soldiers/${ids.sa}/thought`, { content: 'x' })).status, 403);
    assert.equal((await post(s, ma, `/soldiers/${ids.sa}/delete`)).status, 403);
    const anon = await fetch(s.base + '/my-profile', { redirect: 'manual' });
    assert.equal(anon.status, 302);
  } finally { await s.close(); }
});

test('manager tạo hồ sơ, xem, lọc, audit, item đúng chủ', async () => {
  const { s, ids } = await boot();
  try {
    const m = await loginAs(s.base, 'mgr', 'pw12345678');
    const r = await post(s, m, '/soldiers', { full_name: 'Lê Văn Cường', rank: 'Hạ sĩ', status: 'dang_cong_tac' });
    assert.equal(r.status, 302);
    const newId = Number(r.headers.get('location').match(/^\/soldiers\/(\d+)$/)[1]);
    assert.ok(newId > 0);
    const bad = await post(s, m, '/soldiers', { full_name: '' });
    assert.equal(bad.status, 400);

    const d = await get(s, m, `/soldiers/${ids.sa}?tab=tu-tuong`);
    assert.equal(d.status, 200);
    const html = await d.text();
    assert.ok(html.includes('TUTUONG-BIMAT'));
    assert.ok((await (await get(s, m, `/soldiers/${ids.sa}?tab=gia-dinh`)).text()).includes('HOANCANH-BIMAT'));
    assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action = 'soldier_view'").get());

    const list = await (await get(s, m, '/soldiers?q=nguyen')).text();
    assert.ok(list.includes('Nguyễn Văn An') && !list.includes('Trần Văn Bình'));

    assert.equal((await get(s, m, `/soldiers/${ids.sb}/family/${ids.famA}/edit`)).status, 404);
    assert.equal((await post(s, m, `/soldiers/${ids.sb}/family/${ids.famA}`, { relation: 'x', full_name: 'y' })).status, 404);
    assert.equal((await post(s, m, `/soldiers/${ids.sb}/family/${ids.famA}/delete`)).status, 404);
    assert.equal((await get(s, m, `/soldiers/${ids.sa}/family/${ids.famA}/edit`)).status, 200);
    assert.equal((await get(s, m, `/soldiers/${ids.sa}/hack/new`)).status, 404);
    assert.equal((await get(s, m, `/soldiers/${ids.sa}/constructor/new`)).status, 404);

    const add = await post(s, m, `/soldiers/${ids.sa}/leave`, { kind: 'phep', from_date: '2026-03-01', to_date: '2026-03-05' });
    assert.equal(add.status, 302);
    assert.equal(add.headers.get('location'), `/soldiers/${ids.sa}?tab=phep`);
    const t = await post(s, m, `/soldiers/${ids.sa}/thought`, { content: 'Ghi mới', level: 'can_quan_tam' });
    assert.equal(t.status, 302);
    assert.equal(s.db.prepare("SELECT recorded_by FROM soldier_thoughts WHERE content = 'Ghi mới'").get().recorded_by, ids.mgr);
    const badItem = await post(s, m, `/soldiers/${ids.sa}/leave`, { kind: 'phep', from_date: 'xx' });
    assert.equal(badItem.status, 400);

    assert.equal((await post(s, m, `/soldiers/${ids.sb}/delete`)).status, 302);
    assert.equal(s.db.prepare('SELECT 1 FROM soldiers WHERE id = ?').get(ids.sb), undefined);
  } finally { await s.close(); }
});

test('/my-profile: member thấy hồ sơ mình, không thấy dữ liệu nhạy cảm', async () => {
  const { s } = await boot();
  try {
    const ma = await loginAs(s.base, 'ma', 'pw12345678');
    const r = await get(s, ma, '/my-profile');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('Nguyễn Văn An'));
    assert.ok(!html.includes('TUTUONG-BIMAT') && !html.includes('HOANCANH-BIMAT'));
    assert.ok(!html.includes('Tư tưởng'));
    const all = await (await get(s, ma, '/my-profile?tab=tu-tuong')).text();
    assert.ok(!all.includes('TUTUONG-BIMAT') && !all.includes('Tư tưởng'));
    assert.ok(s.db.prepare("SELECT 1 FROM audit_log WHERE action = 'soldier_view'").get());

    const mc = await loginAs(s.base, 'mc', 'pw12345678');
    const un = await get(s, mc, '/my-profile');
    assert.equal(un.status, 200);
    assert.ok((await un.text()).includes('chưa được liên kết'));
  } finally { await s.close(); }
});
