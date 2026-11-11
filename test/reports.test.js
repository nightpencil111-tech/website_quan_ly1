const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const tasks = require('../src/services/tasks');
const reports = require('../src/services/reports');
const { AppError } = require('../src/util/errors');

const TODAY = '2026-11-11'; // Thứ Tư
function mkUser(db, username, role = 'member') {
  const id = Number(db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
    .run(username, hashPassword('pw12345678'), `Họ ${username}`, role).lastInsertRowid);
  return { id, role };
}
const mk = (db, by, assignees, o = {}) => tasks.createTask(db, {
  title: 'Việc', category: 'khac', priority: 'thuong', due_date: '2026-11-12', assignee_ids: assignees, ...o,
}, by.id);
const done = (db, id, at) => db.prepare("UPDATE tasks SET status='hoan_thanh', completed_at=? WHERE id=?").run(at, id);

function scenario() {
  const db = makeDb();
  const mgr = mkUser(db, 'mgr', 'manager');
  const a = mkUser(db, 'a');
  const b = mkUser(db, 'b');
  // kỳ báo cáo 09/11 - 15/11
  const t1 = mk(db, mgr, [a.id], { title: 'Học NQ', category: 'giao_duc_ct', due_date: '2026-11-10' });
  done(db, t1, '2026-11-10'); // tuần này
  const t2 = mk(db, mgr, [a.id], { title: 'Sinh hoạt', category: 'giao_duc_ct', due_date: '2026-11-15' });
  const t3 = mk(db, mgr, [b.id], { title: 'Đảng phí', category: 'cong_tac_dang', due_date: '2026-11-09' });
  done(db, t3, '2026-11-08'); // tuần trước, hạn trong kỳ
  mk(db, mgr, [b.id], { title: 'Quá hạn kỳ này', category: 'cong_tac_dang', due_date: '2026-11-09' });
  mk(db, mgr, [b.id], { title: 'Quá hạn cũ', category: 'khac', due_date: '2026-10-01' });
  mk(db, mgr, [a.id], { title: 'Kỳ sau', category: 'dan_van', due_date: '2026-11-20' });
  mk(db, mgr, [a.id], { title: 'Xa', category: 'dan_van', due_date: '2026-12-30' });
  return { db, mgr, a, b, t2 };
}

test('dashboardStats: manager thấy tất cả, member chỉ của mình', () => {
  const { db, mgr, a } = scenario();
  const m = reports.dashboardStats(db, mgr, TODAY);
  assert.equal(m.counts.total, 7);
  assert.equal(m.counts.hoan_thanh, 2);
  assert.equal(m.counts.overdue, 2);
  assert.equal(m.counts.done_this_week, 1); // chỉ t1 (10/11); t3 hoàn thành 08/11 là CN tuần trước
  assert.ok(m.byPerson.length === 2);
  assert.ok(Array.isArray(m.overload));
  assert.deepEqual(m.upcoming.map((t) => t.title), ['Sinh hoạt']);
  const mem = reports.dashboardStats(db, a, TODAY);
  assert.equal(mem.counts.total, 4);
  assert.equal(mem.byPerson, undefined);
  assert.equal(mem.overload, undefined);
});

test('periodReport: kết quả, tồn tại, phương hướng, văn bản', () => {
  const { db } = scenario();
  const r = reports.periodReport(db, '2026-11-09', '2026-11-15', TODAY);
  const gd = r.sections.ketQua.find((x) => x.category === 'giao_duc_ct');
  assert.deepEqual([gd.done, gd.total], [1, 2]);
  const dang = r.sections.ketQua.find((x) => x.category === 'cong_tac_dang');
  assert.deepEqual([dang.done, dang.total], [1, 2]);
  assert.equal(r.sections.ketQua.find((x) => x.category === 'dan_van'), undefined);
  assert.deepEqual(r.sections.tonTai.map((t) => t.title).sort(), ['Quá hạn cũ', 'Quá hạn kỳ này']);
  assert.deepEqual(r.sections.phuongHuong.map((t) => t.title), ['Kỳ sau']);
  const lines = r.text.split('\n');
  assert.equal(lines[0], 'BÁO CÁO KẾT QUẢ THỰC HIỆN NHIỆM VỤ');
  assert.equal(lines[1], '(Từ ngày 09/11/2026 đến ngày 15/11/2026)');
  for (const h of ['I. TÌNH HÌNH CHUNG', 'II. KẾT QUẢ THỰC HIỆN', 'III. TỒN TẠI, HẠN CHẾ', 'IV. PHƯƠNG HƯỚNG NHIỆM VỤ KỲ TỚI']) assert.ok(r.text.includes(h), h);
  assert.ok(r.text.includes('- Quá hạn kỳ này'));
});

test('periodReport: kỳ không có việc vẫn tạo văn bản', () => {
  const db = makeDb();
  const r = reports.periodReport(db, '2026-01-01', '2026-01-07', TODAY);
  assert.ok(r.text.includes('IV. PHƯƠNG HƯỚNG'));
});

test('weekRange / monthRange / parseRange', () => {
  assert.deepEqual(reports.weekRange('2026-11-11'), { from: '2026-11-09', to: '2026-11-15' });
  assert.deepEqual(reports.weekRange('2026-11-15'), { from: '2026-11-09', to: '2026-11-15' });
  assert.deepEqual(reports.monthRange('2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(reports.parseRange({}, TODAY), { from: '2026-11-09', to: '2026-11-15' });
  assert.throws(() => reports.parseRange({ from: '2026-11-20', to: '2026-11-01' }, TODAY), AppError);
  assert.throws(() => reports.parseRange({ from: 'abc', to: '2026-11-01' }, TODAY), AppError);
});

test('HTTP: trang tổng quan, báo cáo, phân quyền', async () => {
  const s = await startServer();
  try {
    mkUser(s.db, 'mgr', 'manager');
    const ma = mkUser(s.db, 'ma');
    tasks.createTask(s.db, { title: '<b>Việc A</b>', due_date: '2099-01-01', assignee_ids: [ma.id] }, ma.id);
    const mgr = await loginAs(s.base, 'mgr', 'pw12345678');
    const mem = await loginAs(s.base, 'ma', 'pw12345678');
    const get = (sess, p) => fetch(s.base + p, { headers: { cookie: sess.cookie }, redirect: 'manual' });
    assert.equal((await fetch(s.base + '/reports', { redirect: 'manual' })).status, 302);
    assert.equal((await fetch(s.base + '/export/tasks', { redirect: 'manual' })).status, 302);
    let r = await get(mgr, '/');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('vendor/chart.umd.js') && html.includes('Hoàn thành tuần này'));
    assert.equal((await get(mem, '/')).status, 200);
    assert.equal((await get(mgr, '/reports')).status, 200);
    assert.ok((await (await get(mgr, '/reports')).text()).includes('BÁO CÁO KẾT QUẢ THỰC HIỆN NHIỆM VỤ'));
    assert.equal((await get(mgr, '/reports?from=2026-11-20&to=2026-11-01')).status, 400);
    assert.equal((await get(mgr, '/reports/performance')).status, 200);
    for (const p of ['/reports', '/reports/performance', '/export/performance', '/export/report']) assert.equal((await get(mem, p)).status, 403, p);
    for (const p of ['/export/performance', '/export/report']) {
      r = await get(mgr, p);
      assert.equal(r.status, 200, p);
      assert.match(r.headers.get('content-type'), /spreadsheetml\.sheet/);
    }
    // không lọt chuỗi chưa escape vào dashboard của member
    const memHtml = await (await get(mem, '/')).text();
    assert.ok(!memHtml.includes('<b>Việc A</b>'));
  } finally { await s.close(); }
});

test('HTTP: /export/tasks — tên file, tập rỗng, member chỉ thấy việc của mình', async () => {
  const ExcelJS = require('exceljs');
  const s = await startServer();
  try {
    const mgrU = mkUser(s.db, 'mgr', 'manager');
    const ma = mkUser(s.db, 'ma');
    const mb = mkUser(s.db, 'mb');
    tasks.createTask(s.db, { title: 'Việc của A', due_date: '2099-01-01', assignee_ids: [ma.id] }, mgrU.id);
    tasks.createTask(s.db, { title: 'Bí mật của B', due_date: '2099-01-01', assignee_ids: [mb.id] }, mgrU.id);
    const mgr = await loginAs(s.base, 'mgr', 'pw12345678');
    const mem = await loginAs(s.base, 'ma', 'pw12345678');
    const read = async (sess, p) => {
      const r = await fetch(s.base + p, { headers: { cookie: sess.cookie } });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
      return { r, rows: wb.worksheets[0].getSheetValues().slice(1) };
    };
    let { r, rows } = await read(mgr, '/export/tasks');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''Danh%20s%C3%A1ch%20c%C3%B4ng%20vi%E1%BB%87c\.xlsx/);
    assert.match(r.headers.get('content-disposition'), /filename="Danh-sach-cong-viec\.xlsx"/);
    assert.equal(rows.length, 3);
    ({ r, rows } = await read(mgr, '/export/tasks?q=khongcogi'));
    assert.equal(r.status, 200);
    assert.equal(rows.length, 1); // chỉ dòng tiêu đề
    ({ rows } = await read(mem, '/export/tasks'));
    assert.equal(rows.length, 2);
    ({ rows } = await read(mem, `/export/tasks?assignee_id=${mb.id}`));
    assert.equal(rows.length, 2);
    assert.ok(!JSON.stringify(rows).includes('Bí mật'));
  } finally { await s.close(); }
});
