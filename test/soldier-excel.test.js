const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { makeDb, startServer, loginAs } = require('./helpers');
const { hashPassword } = require('../src/auth');
const soldiers = require('../src/services/soldiers');
const xl = require('../src/services/soldierExcel');
const { AppError } = require('../src/util/errors');

const readRows = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
};

async function sampleFile() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hồ sơ');
  ws.addRow(xl.TEMPLATE_COLUMNS);
  ws.addRow(['Lê Văn Một', new Date(Date.UTC(2003, 7, 15)), 'Nam', 'binh nhi', '', 'Chiến sĩ', 'đại đội 1', '', 'Hà Nam']); // 2
  ws.addRow(['Phạm Thị Hai', '05/03/2004', 'Nữ']); // 3
  ws.addRow(['', '01/01/2000']); // 4 thiếu tên
  ws.addRow(['Ngô Văn Ba', '31/02/2004']); // 5 ngày sai
  ws.addRow(['Đỗ Văn Tư', '', '', '', '', '', 'Đơn vị ma']); // 6
  ws.addRow(['Nguyễn Văn Có', '01/01/2001']); // 7 trùng CSDL
  ws.addRow([]); ws.addRow(['', '']); // trống
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('xuất và mẫu có đúng tiêu đề', async () => {
  const wb = await readRows(await xl.exportWorkbook([]));
  assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), xl.EXPORT_COLUMNS);
  assert.equal(xl.EXPORT_COLUMNS.length, 10);
  const t = await readRows(await xl.templateWorkbook());
  assert.deepEqual(t.worksheets[0].getRow(1).values.slice(1), xl.TEMPLATE_COLUMNS);
  assert.ok(t.getWorksheet('Hướng dẫn'));
});

test('parseImport: hợp lệ, lỗi theo dòng Excel, trùng', async () => {
  const db = makeDb();
  db.prepare("INSERT INTO units (name) VALUES ('Đại đội 1')").run();
  soldiers.createSoldier(db, { full_name: 'Nguyễn Văn Có', birth_date: '2001-01-01' }, null);
  const r = await xl.parseImport(db, await sampleFile());
  assert.equal(r.valid.length, 2);
  assert.equal(r.valid[0].birth_date, '2003-08-15');
  assert.equal(r.valid[0].rank, 'Binh nhì');
  assert.equal(r.valid[0].gender, 'nam');
  assert.ok(r.valid[0].unit_id);
  assert.equal(r.valid[1].birth_date, '2004-03-05');
  assert.deepEqual(r.errors.map((e) => e.row), [4, 5, 6]);
  assert.match(r.errors[0].message, /Họ và tên/);
  assert.match(r.errors[1].message, /Ngày sinh/);
  assert.match(r.errors[2].message, /Đơn vị/);
  assert.deepEqual(r.duplicates, [{ row: 7, full_name: 'Nguyễn Văn Có' }]);
});

test('parseImport: buffer rác và trùng trong file', async () => {
  const db = makeDb();
  await assert.rejects(xl.parseImport(db, Buffer.from('không phải excel')), (e) => e instanceof AppError && /\.xlsx/.test(e.message));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('a');
  ws.addRow(xl.TEMPLATE_COLUMNS);
  ws.addRow(['An', '01/01/2000']); ws.addRow(['AN', '01/01/2000']);
  const r = await xl.parseImport(db, Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(r.valid.length, 1);
  assert.equal(r.duplicates[0].row, 3);
});

test('commitImport: giao dịch, draft người khác bị từ chối', async () => {
  const db = makeDb();
  const u1 = Number(db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES ('a','x','A','manager')").run().lastInsertRowid);
  const u2 = Number(db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES ('b','x','B','manager')").run().lastInsertRowid);
  const p = await xl.parseImport(db, await sampleFile());
  const id = xl.saveDraft(db, u1, p);
  assert.throws(() => xl.commitImport(db, id, u2, u2), AppError);
  assert.deepEqual(xl.commitImport(db, id, u1, u1), { inserted: 2, skipped: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM soldiers').get().c, 2);
  assert.equal(db.prepare("SELECT detail FROM audit_log WHERE action='soldier_import'").get().detail, '2 hồ sơ');
  assert.throws(() => xl.commitImport(db, id, u1, u1), AppError);
  const old = xl.saveDraft(db, u1, p);
  db.prepare('UPDATE import_drafts SET expires_at = 1 WHERE id = ?').run(old);
  assert.throws(() => xl.commitImport(db, old, u1, u1), AppError);
});

test('HTTP: member 403, xuất, mẫu, preview 3mb, 413, xác nhận', async () => {
  const s = await startServer();
  try {
    for (const [u, role] of [['mgr', 'manager'], ['mem', 'member']]) {
      s.db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)').run(u, hashPassword('pw12345678'), u, role);
    }
    const mem = await loginAs(s.base, 'mem', 'pw12345678');
    assert.equal((await fetch(s.base + '/soldiers/export', { headers: { cookie: mem.cookie } })).status, 403);
    const mgr = await loginAs(s.base, 'mgr', 'pw12345678');
    const H = { cookie: mgr.cookie };
    const ex = await fetch(s.base + '/soldiers/export', { headers: H });
    assert.equal(ex.status, 200);
    assert.match(ex.headers.get('content-type'), /spreadsheetml/);
    assert.equal((await fetch(s.base + '/soldiers/import', { headers: H })).status, 200);
    const tpl = Buffer.from(await (await fetch(s.base + '/soldiers/import/template', { headers: H })).arrayBuffer());
    const preview = (body, csrf = mgr.csrf) => fetch(s.base + '/soldiers/import/preview', {
      method: 'POST', headers: { ...H, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body),
    });
    assert.equal((await preview({ fileName: 'a.xlsx', data: tpl.toString('base64') }, 'sai')).status, 403);
    const pr = await preview({ fileName: 'a.xlsx', data: tpl.toString('base64') });
    const j = await pr.json();
    assert.equal(pr.status, 200);
    assert.ok(j.ok && j.redirect);
    const page = await (await fetch(s.base + j.redirect, { headers: H })).text();
    assert.match(page, /Xác nhận nhập 1 hồ sơ/);
    const bad = await preview({ fileName: 'a.xlsx', data: Buffer.from('rác').toString('base64') });
    assert.equal(bad.status, 400);
    const big = await preview({ fileName: 'a.xlsx', data: 'A'.repeat(3.5 * 1024 * 1024) });
    assert.equal(big.status, 413);
    assert.equal((await big.json()).ok, false);
    const cf = await fetch(s.base + j.redirect + '/confirm', {
      method: 'POST', redirect: 'manual', headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: mgr.csrf }),
    });
    assert.equal(cf.status, 302);
    assert.equal(s.db.prepare('SELECT COUNT(*) c FROM soldiers').get().c, 1);
    const ex2 = await fetch(s.base + '/soldiers/export?q=M%E1%BA%ABu', { headers: H });
    assert.equal(ex2.status, 200);
    assert.equal(s.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='soldier_export'").get().c, 2);
  } finally { await s.close(); }
});

const oneRow = async (cells, extraRows = []) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('a');
  ws.addRow(xl.TEMPLATE_COLUMNS);
  ws.addRow(cells);
  extraRows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};
const blank = (n) => new Array(n).fill('');

test('mẫu: cột văn bản định dạng Text và có hướng dẫn', async () => {
  const t = await readRows(await xl.templateWorkbook());
  const ws = t.worksheets[0];
  for (const c of [9, 10, 11, 12, 13]) assert.equal(ws.getColumn(c).numFmt, '@', `cột ${c}`);
  const guide = t.getWorksheet('Hướng dẫn');
  let text = '';
  guide.eachRow((r) => { text += r.getCell(1).value + '\n'; });
  assert.match(text, /định dạng Text/);
});

test('parseImport: SĐT dạng số 9 chữ số được thêm số 0 đầu; chuỗi giữ nguyên', async () => {
  const db = makeDb();
  const row = (name, phone) => { const r = blank(16); r[0] = name; r[12] = phone; return r; };
  const r = await xl.parseImport(db, await oneRow(row('An', 912345678), [row('Bình', '0987654321'), row('Chi', 987654321)]));
  assert.deepEqual(r.valid.map((s) => s.phone), ['0912345678', '0987654321', '0987654321']);
});

test('parseImport: ô văn bản bị Excel đổi thành ngày không bị bỏ', async () => {
  const db = makeDb();
  const r0 = blank(16);
  r0[0] = 'An';
  r0[11] = new Date(Date.UTC(2026, 11, 12)); // Văn hóa 12/12
  r0[8] = new Date(Date.UTC(2020, 2, 5)); // Quê quán
  const r = await xl.parseImport(db, await oneRow(r0));
  assert.equal(r.valid[0].education, '12/12');
  assert.equal(r.valid[0].hometown, '05/03/2020');
});

test('parseImport: tên đơn vị trùng nhiều đơn vị bị báo lỗi', async () => {
  const db = makeDb();
  db.prepare("INSERT INTO units (name) VALUES ('Tiểu đội 1')").run();
  db.prepare("INSERT INTO units (name) VALUES ('Tiểu đội 1')").run();
  const r0 = blank(16); r0[0] = 'An'; r0[6] = 'tieu doi 1';
  const r = await xl.parseImport(db, await oneRow(r0));
  assert.equal(r.valid.length, 0);
  assert.match(r.errors[0].message, /Tên đơn vị "tieu doi 1" trùng nhiều đơn vị, đề nghị đổi tên cho khác nhau/);
});

test('parseImport: giới hạn dòng chỉ đếm dòng có dữ liệu', async () => {
  const db = makeDb();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('a');
  ws.addRow(xl.TEMPLATE_COLUMNS);
  ws.addRow(['An', '01/01/2000']);
  for (let n = 3; n <= 5000; n++) ws.getRow(n).getCell(1).numFmt = '@'; // chỉ định dạng, không dữ liệu
  const r = await xl.parseImport(db, Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(r.valid.length, 1);

  const big = new ExcelJS.Workbook();
  const bs = big.addWorksheet('a');
  bs.addRow(xl.TEMPLATE_COLUMNS);
  for (let n = 0; n < 2001; n++) bs.addRow([`Người ${n}`, '']);
  await assert.rejects(xl.parseImport(db, Buffer.from(await big.xlsx.writeBuffer())), /quá nhiều dòng/);
});

test('commitImport: kiểm tra lại trùng lúc nhập', async () => {
  const db = makeDb();
  const u = Number(db.prepare("INSERT INTO users (username, password_hash, full_name, role) VALUES ('a','x','A','manager')").run().lastInsertRowid);
  const p = await xl.parseImport(db, await sampleFile());
  const id = xl.saveDraft(db, u, p);
  soldiers.createSoldier(db, { full_name: 'Phạm Thị Hai', birth_date: '2004-03-05' }, null); // thêm tay sau khi xem trước
  assert.deepEqual(xl.commitImport(db, id, u, u), { inserted: 1, skipped: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM soldiers').get().c, 2);
});
