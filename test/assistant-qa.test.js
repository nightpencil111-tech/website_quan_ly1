const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { answer, suggestions, INTENTS } = require('../src/services/assistant/qa');
const tasksSvc = require('../src/services/tasks');
const { setSetting } = require('../src/services/users');

const TODAY = '2026-11-13'; // thứ Sáu
const SECRET_THOUGHT = 'TUTUONG_NHAY_CAM_XYZ';
const SECRET_FAMILY = 'HOANCANH_NHAY_CAM_XYZ';

function setup() {
  const db = makeDb();
  const u = (name) => Number(db.prepare('INSERT INTO units (name) VALUES (?)').run(name).lastInsertRowid);
  const td1 = u('Trung đội 1');
  const td2 = u('Trung đội 2');
  const mk = (username, full_name, role, unit) => Number(db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, active, unit_id) VALUES (?, ?, ?, ?, 1, ?)'
  ).run(username, 'x', full_name, role, unit).lastInsertRowid);
  const ids = {
    mgr: mk('mgr', 'Phạm Quản Lý', 'manager', td1),
    hung: mk('hung', 'Trần Văn Hùng', 'member', td1),
    binh: mk('binh', 'Võ Văn Bình', 'member', td2),
    an1: mk('an1', 'Nguyễn Văn An', 'member', td1),
    an2: mk('an2', 'Lê An', 'member', td2),
    cuong: mk('cuong', 'Đặng Cường', 'member', td2),
  };
  const user = (k, role) => ({ id: ids[k], role, full_name: k });
  const U = { mgr: user('mgr', 'manager'), hung: user('hung', 'member'), binh: user('binh', 'member') };

  const task = (title, due, assignee_ids, status) => {
    const id = tasksSvc.createTask(db, { title, due_date: due, assignee_ids }, ids.mgr);
    if (status === 'hoan_thanh') {
      db.prepare("UPDATE tasks SET status='hoan_thanh', completed_at=? WHERE id=?").run('2026-11-11', id);
    }
    return id;
  };
  const t = {
    qh1: task('Việc quá hạn của Hùng', '2026-11-10', [ids.hung]),
    qh2: task('Việc quá hạn của Bình', '2026-11-05', [ids.binh]),
    qh3: task('Việc quá hạn của An', '2026-11-01', [ids.an1]),
    today: task('Việc hạn hôm nay', '2026-11-13', [ids.hung]),
    week: task('Việc hạn Chủ nhật', '2026-11-15', [ids.binh]),
    far: task('Việc hạn cuối tháng', '2026-11-28', [ids.hung]),
    done: task('Việc đã xong', '2026-11-12', [ids.hung], 'hoan_thanh'),
  };

  setSetting(db, 'party_probation_months', 12);
  setSetting(db, 'service_months', 24);
  setSetting(db, 'reminder_days', 90);

  const sol = (o) => Number(db.prepare(
    `INSERT INTO soldiers (full_name, rank, unit_id, position, status, party_join_date, party_official_date, youth_join_date, enlist_date, discharge_date)
     VALUES (@full_name, @rank, @unit_id, @position, 'dang_cong_tac', @pj, @po, @yj, @en, @dis)`
  ).run({ rank: 'Hạ sĩ', position: 'Chiến sĩ', pj: null, po: null, yj: null, en: null, dis: null, ...o }).lastInsertRowid);
  const s = {
    a: sol({ full_name: 'Hoàng Đảng Dự', unit_id: td1, pj: '2025-12-01', yj: '2020-01-01' }), // dự bị, chuyển ~12/2026
    b: sol({ full_name: 'Lý Đảng Chính', unit_id: td2, pj: '2020-01-01', po: '2021-01-01', yj: '2015-01-01' }),
    c: sol({ full_name: 'Mai Đoàn Viên', unit_id: td2, yj: '2021-01-01', dis: '2026-12-20' }),
    d: sol({ full_name: 'Ngô Trung Đội Hai', unit_id: td2, rank: 'Binh nhì' }),
  };
  db.prepare("INSERT INTO soldier_leaves (soldier_id, kind, from_date, to_date, destination) VALUES (?, 'phep', '2026-11-12', '2026-11-16', 'DIACHI_NGHI_PHEP')").run(s.d);
  db.prepare("INSERT INTO soldier_thoughts (soldier_id, date, content, level, measures) VALUES (?, '2026-11-10', ?, 'dac_biet', 'BIENPHAP_NHAY_CAM')").run(s.a, SECRET_THOUGHT);
  db.prepare('INSERT INTO soldier_family (soldier_id, relation, full_name, hardship_note) VALUES (?, ?, ?, ?)').run(s.a, 'Mẹ', 'Bà X', SECRET_FAMILY);
  db.prepare('UPDATE soldiers SET notes = ? WHERE id = ?').run(SECRET_FAMILY, s.b);
  return { db, ids, U, t, s, td1, td2 };
}

const ask = (ctx, who, text) => answer(ctx.db, ctx.U[who], text, TODAY);

test('việc quá hạn (có dấu và không dấu): quản lý thấy tất cả, có href', () => {
  const ctx = setup();
  for (const q of ['Việc nào quá hạn?', 'viec nao qua han', 'Nhiệm vụ quá hạn']) {
    const r = ask(ctx, 'mgr', q);
    assert.equal(r.intent, 'viec_qua_han', q);
    assert.equal(r.rows.length, 3);
    assert.ok(r.rows.every((x) => /^\/tasks\/\d+$/.test(x.href)));
    assert.equal(r.summary, 'Có 3 việc quá hạn.');
  }
});

test('member hỏi việc quá hạn chỉ thấy việc của mình', () => {
  const ctx = setup();
  const r = ask(ctx, 'hung', 'việc nào quá hạn');
  assert.equal(r.intent, 'viec_qua_han');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].href, `/tasks/${ctx.t.qh1}`);
  assert.ok(!JSON.stringify(r).includes('Bình'));
});

test('viec_cua_toi và viec_den_han theo phạm vi thời gian', () => {
  const ctx = setup();
  let r = ask(ctx, 'hung', 'Việc của tôi');
  assert.equal(r.intent, 'viec_cua_toi');
  assert.equal(r.rows.length, 3); // quá hạn, hôm nay, cuối tháng (đã xong không tính)
  r = ask(ctx, 'mgr', 'viec den han hom nay');
  assert.equal(r.intent, 'viec_den_han');
  assert.equal(r.rows.length, 1);
  r = ask(ctx, 'mgr', 'Việc đến hạn tuần này');
  assert.equal(r.rows.length, 2);
  r = ask(ctx, 'mgr', 'viec den han 7 ngay toi');
  assert.equal(r.rows.length, 2);
  r = ask(ctx, 'mgr', 'viec den han thang nay');
  assert.equal(r.rows.length, 3);
  r = ask(ctx, 'hung', 'viec den han tuan nay');
  assert.equal(r.rows.length, 1);
});

test('viec_cua: quản lý hỏi việc của một người; tên trùng → yêu cầu nói rõ', () => {
  const ctx = setup();
  let r = ask(ctx, 'mgr', 'việc của đ/c Hùng');
  assert.equal(r.intent, 'viec_cua');
  assert.equal(r.rows.length, 3);
  r = ask(ctx, 'mgr', 'viec cua dong chi Nguyen Van An');
  assert.equal(r.intent, 'viec_cua');
  assert.equal(r.rows.length, 1);
  r = ask(ctx, 'mgr', 'Việc của đ/c An');
  assert.equal(r.intent, 'viec_cua');
  assert.deepEqual(r.rows.length, 2);
  assert.match(r.summary, /họ tên/);
  assert.ok(r.summary.includes('Nguyễn Văn An') && r.summary.includes('Lê An'));
  assert.ok(r.rows.every((x) => !x.href));
  r = ask(ctx, 'mgr', 'việc của đ/c Zzz');
  assert.equal(r.intent, 'viec_cua');
  assert.equal(r.rows.length, 0);
  assert.match(r.summary, /Không tìm thấy/);
});

test('member hỏi vượt quyền bị từ chối, không rò dữ liệu', () => {
  const ctx = setup();
  for (const q of ['ai sắp chuyển đảng chính thức', 'việc của đ/c Hùng', 'ai đang nghỉ phép', 'danh sách trung đội 2',
    'bao nhiêu đảng viên', 'ai quá tải', 'ai sắp hết hạn phục vụ', 'niên hạn thăng quân hàm']) {
    const r = ask(ctx, 'binh', q);
    assert.ok(r.intent, q);
    assert.equal(r.denied, true, q);
    assert.equal(r.summary, 'Đồng chí không có quyền xem thông tin này');
    assert.deepEqual(r.rows, []);
  }
});

test('nghi_phep, chuyen_dang, het_han_phuc_vu, nien_han', () => {
  const ctx = setup();
  let r = ask(ctx, 'mgr', 'Ai đang nghỉ phép hôm nay?');
  assert.equal(r.intent, 'nghi_phep');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].href, `/soldiers/${ctx.s.d}`);
  r = ask(ctx, 'mgr', 'ai nghi phep');
  assert.equal(r.intent, 'nghi_phep');
  r = ask(ctx, 'mgr', 'Ai sắp chuyển Đảng chính thức?');
  assert.equal(r.intent, 'chuyen_dang');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].href, `/soldiers/${ctx.s.a}`);
  r = ask(ctx, 'mgr', 'ai sap het han phuc vu');
  assert.equal(r.intent, 'het_han_phuc_vu');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].href, `/soldiers/${ctx.s.c}`);
  r = ask(ctx, 'mgr', 'Ai đến niên hạn xét thăng quân hàm?');
  assert.equal(r.intent, 'nien_han');
  assert.ok(Array.isArray(r.rows));
});

test('dem_dang_doan, danh_sach_don_vi, qua_tai', () => {
  const ctx = setup();
  let r = ask(ctx, 'mgr', 'Có bao nhiêu đảng viên?');
  assert.equal(r.intent, 'dem_dang_doan');
  assert.match(r.summary, /1 đảng viên chính thức/);
  r = ask(ctx, 'mgr', 'danh sách trung đội 2');
  assert.equal(r.intent, 'danh_sach_don_vi');
  assert.equal(r.rows.length, 3);
  assert.ok(r.rows.every((x) => /^\/soldiers\/\d+$/.test(x.href)));
  assert.ok(!JSON.stringify(r).includes('Hoàng Đảng Dự'));
  r = ask(ctx, 'mgr', 'danh sach trung doi 1');
  assert.equal(r.rows.length, 1);
  for (let i = 0; i < 6; i++) tasksSvc.createTask(ctx.db, { title: `Việc nhiều ${i}`, due_date: '2026-12-01', assignee_ids: [ctx.ids.cuong] }, ctx.ids.mgr);
  r = ask(ctx, 'mgr', 'Ai đang quá tải?');
  assert.equal(r.intent, 'qua_tai');
  assert.equal(r.rows.length, 1);
  assert.match(r.rows[0].cells[0], /Đặng Cường/);
});

test('tinh_hinh chỉ có số liệu', () => {
  const ctx = setup();
  let r = ask(ctx, 'mgr', 'Tình hình tuần này');
  assert.equal(r.intent, 'tinh_hinh');
  assert.ok(r.rows.length >= 6);
  assert.ok(r.rows.some((x) => /nghỉ/i.test(x.cells[0])));
  r = ask(ctx, 'hung', 'tinh hinh');
  assert.equal(r.intent, 'tinh_hinh');
  assert.ok(!r.rows.some((x) => /nghỉ|mốc/i.test(x.cells[0])));
});

test('không bao giờ lộ dữ liệu tư tưởng/hoàn cảnh', () => {
  const ctx = setup();
  const qs = ['việc quá hạn', 'việc của tôi', 'việc đến hạn tuần này', 'việc của đ/c Hùng', 'ai nghỉ phép',
    'ai sắp chuyển đảng', 'ai sắp hết hạn phục vụ', 'niên hạn quân hàm', 'bao nhiêu đảng viên',
    'danh sách trung đội 1', 'danh sách trung đội 2', 'ai quá tải', 'tình hình tuần này', 'xin chào'];
  for (const who of ['mgr', 'hung']) {
    for (const q of qs) {
      const j = JSON.stringify(ask(ctx, who, q));
      for (const secret of [SECRET_THOUGHT, SECRET_FAMILY, 'BIENPHAP_NHAY_CAM', 'DIACHI_NGHI_PHEP', 'cần quan tâm', 'Đặc biệt']) {
        assert.ok(!j.includes(secret), `${who}: ${q}: ${secret}`);
      }
    }
  }
});

test('câu lạ → intent null kèm 6 gợi ý; suggestions theo vai trò', () => {
  const ctx = setup();
  const r = ask(ctx, 'mgr', 'thời tiết ngày mai thế nào');
  assert.equal(r.intent, null);
  assert.equal(r.suggestions.length, 6);
  assert.deepEqual(r.rows, []);
  assert.equal(suggestions('manager').length, 6);
  assert.equal(suggestions('member').length, 6);
  // mọi gợi ý của vai trò nhận diện được ý định và không bị từ chối
  for (const role of ['admin', 'manager', 'member']) {
    for (const q of suggestions(role)) {
      const a = answer(ctx.db, { id: ctx.ids.hung, role, full_name: 'x' }, q, TODAY);
      assert.ok(a.intent, q);
      assert.ok(!a.denied, `${role}: ${q}`);
    }
  }
  assert.ok(INTENTS.length >= 12);
});
