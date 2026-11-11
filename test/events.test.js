const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const { AppError } = require('../src/util/errors');
const ev = require('../src/services/events');
const tasks = require('../src/services/tasks');

function mkUser(db, username, role) {
  return Number(db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword('x'), `Họ ${username}`, role).lastInsertRowid);
}
const flat = (v) => v.weeks.flat();
const dayOf = (v, d) => flat(v).find((x) => x.date === d);

test('monthView 11/2026: 6 hàng, 26/10 → 06/12, tuần bắt đầu Thứ Hai', () => {
  const db = makeDb();
  const admin = mkUser(db, 'ad', 'admin');
  const v = ev.monthView(db, 2026, 11, { id: admin, role: 'admin' }, '2026-11-11');
  assert.equal(v.weeks.length, 6);
  assert.ok(v.weeks.every((w) => w.length === 7));
  assert.equal(v.weeks[0][0].date, '2026-10-26');
  assert.equal(v.weeks[5][6].date, '2026-12-06');
  assert.equal(dayOf(v, '2026-10-26').inMonth, false);
  assert.equal(dayOf(v, '2026-11-01').inMonth, true);
  assert.equal(dayOf(v, '2026-11-11').isToday, true);
  assert.equal(flat(v).filter((d) => d.isToday).length, 1);
});

test('monthView 2/2026: lưới từ 26/01 đến 01/03', () => {
  const db = makeDb();
  const v = ev.monthView(db, 2026, 2, { id: 1, role: 'admin' }, '2026-11-11');
  assert.equal(v.weeks[0][0].date, '2026-01-26');
  assert.equal(v.weeks.at(-1)[6].date, '2026-03-01');
});

test('sự kiện 2 ngày xuất hiện ở cả 2 ngày; sự kiện tràn tháng vẫn hiện', () => {
  const db = makeDb();
  const mgr = mkUser(db, 'mg', 'manager');
  ev.createEvent(db, { title: 'Hội nghị', start_date: '2026-11-10', end_date: '2026-11-11', type: 'hoi_nghi' }, mgr);
  ev.createEvent(db, { title: 'Tập huấn', start_date: '2026-10-28', end_date: '2026-11-02', type: 'khac' }, mgr);
  const v = ev.monthView(db, 2026, 11, { id: mgr, role: 'manager' }, '2026-11-11');
  assert.equal(dayOf(v, '2026-11-10').events.length, 1);
  assert.equal(dayOf(v, '2026-11-11').events.length, 1);
  assert.equal(dayOf(v, '2026-11-12').events.length, 0);
  assert.equal(dayOf(v, '2026-10-30').events[0].title, 'Tập huấn');
  assert.equal(dayOf(v, '2026-11-02').events[0].title, 'Tập huấn');
});

test('member chỉ thấy việc của mình, sự kiện thì thấy hết', () => {
  const db = makeDb();
  const mgr = mkUser(db, 'mg', 'manager');
  const a = mkUser(db, 'a', 'member');
  const b = mkUser(db, 'b', 'member');
  tasks.createTask(db, { title: 'Việc A', due_date: '2026-11-15', assignee_ids: [a] }, mgr);
  tasks.createTask(db, { title: 'Việc B', due_date: '2026-11-15', assignee_ids: [b] }, mgr);
  ev.createEvent(db, { title: 'SK', start_date: '2026-11-15' }, mgr);
  const va = ev.monthView(db, 2026, 11, { id: a, role: 'member' }, '2026-11-11');
  assert.deepEqual(dayOf(va, '2026-11-15').tasks.map((t) => t.title), ['Việc A']);
  assert.equal(dayOf(va, '2026-11-15').events.length, 1);
  const vm = ev.monthView(db, 2026, 11, { id: mgr, role: 'manager' }, '2026-11-11');
  assert.equal(dayOf(vm, '2026-11-15').tasks.length, 2);
});

test('validate sự kiện + audit + sửa + xóa', () => {
  const db = makeDb();
  const mgr = mkUser(db, 'mg', 'manager');
  assert.throws(() => ev.createEvent(db, { title: ' ', start_date: '2026-11-10' }, mgr), AppError);
  assert.throws(() => ev.createEvent(db, { title: 'x', start_date: '2026-13-40' }, mgr), AppError);
  assert.throws(() => ev.createEvent(db, { title: 'x', start_date: '2026-11-10', end_date: '2026-11-09' }, mgr), AppError);
  assert.throws(() => ev.createEvent(db, { title: 'x', start_date: '2026-11-10', type: 'bay' }, mgr), AppError);
  const id = ev.createEvent(db, { title: 'x', start_date: '2026-11-10' }, mgr);
  assert.equal(ev.getEvent(db, id).end_date, '2026-11-10');
  assert.equal(ev.getEvent(db, id).type, 'khac');
  ev.updateEvent(db, id, { title: 'y', start_date: '2026-11-10', end_date: '2026-11-12', type: 'ngay_le' }, mgr);
  assert.equal(ev.getEvent(db, id).title, 'y');
  ev.deleteEvent(db, id, mgr);
  assert.equal(ev.getEvent(db, id), null);
  const acts = db.prepare('SELECT action FROM audit_log').all().map((r) => r.action);
  assert.deepEqual(acts, ['event_create', 'event_update', 'event_delete']);
  assert.equal(ev.EVENT_TYPES.sinh_hoat_chi_bo, 'Sinh hoạt chi bộ');
});

test('HTTP: /calendar, thêm/xóa sự kiện, quyền member', async () => {
  const s = await startServer();
  try {
    const { db, base } = s;
    db.prepare("UPDATE users SET must_change_password = 0 WHERE username='admin'").run();
    const m = mkUser(db, 'mem', 'member');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword('pw123456'), m);
    const adm = await loginAs(base, 'admin', 'admin123');
    const mem = await loginAs(base, 'mem', 'pw123456');
    const noLogin = await fetch(`${base}/calendar`, { redirect: 'manual' });
    assert.equal(noLogin.status, 302);
    for (const q of ['', '?y=2026&m=2', '?y=abc&m=99', '?y=2026&m=11&add=2026-11-20']) {
      const r = await fetch(`${base}/calendar${q}`, { headers: { cookie: adm.cookie } });
      assert.equal(r.status, 200, q);
    }
    const page = await (await fetch(`${base}/calendar?y=2026&m=11`, { headers: { cookie: adm.cookie } })).text();
    assert.match(page, /Tháng 11\/2026/);
    assert.match(page, /Thứ Hai/);
    const post = (c, path, body) => fetch(`${base}${path}`, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: c.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: c.csrf, ...body }),
    });
    assert.equal((await post(mem, '/calendar/events', { title: 'a', start_date: '2026-11-20' })).status, 403);
    const bad = await post(adm, '/calendar/events', { title: 'a', start_date: '2026-11-20', end_date: '2026-11-01' });
    assert.equal(bad.status, 400);
    const ok = await post(adm, '/calendar/events', { title: 'Họp chi bộ', start_date: '2026-11-20', type: 'sinh_hoat_chi_bo' });
    assert.equal(ok.status, 302);
    const e = db.prepare('SELECT * FROM events').get();
    const memPage = await (await fetch(`${base}/calendar?y=2026&m=11`, { headers: { cookie: mem.cookie } })).text();
    assert.match(memPage, /Họp chi bộ/);
    assert.doesNotMatch(memPage, /\/calendar\/events\/\d+\/delete/);
    assert.equal((await post(mem, `/calendar/events/${e.id}/delete`, {})).status, 403);
    assert.equal((await fetch(`${base}/calendar/events/${e.id}`, { headers: { cookie: adm.cookie } })).status, 200);
    assert.equal((await post(adm, `/calendar/events/${e.id}`, { title: 'Họp mới', start_date: '2026-11-20', type: 'khac' })).status, 302);
    assert.equal((await post(adm, `/calendar/events/${e.id}/delete`, {})).status, 302);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM events').get().c, 0);
  } finally { await s.close(); }
});
