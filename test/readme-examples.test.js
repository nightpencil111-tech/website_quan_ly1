// Giữ README (mục 13 "Trợ lý") và hành vi thật khớp nhau: chạy MỌI câu ví dụ trong README trên dữ liệu thử.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeDb } = require('./helpers');
const { fillDemo } = require('../scripts/demo-data');
const { parseTaskSentence } = require('../src/services/assistant/taskParser');
const qa = require('../src/services/assistant/qa');

const TODAY = '2026-11-13';
const README = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
const SECTION = README.slice(README.indexOf('## 13. Trợ lý'), README.indexOf('## 14.'));

function demo() {
  const db = makeDb();
  fillDemo(db);
  const name = (full) => db.prepare('SELECT id FROM users WHERE full_name = ?').get(full).id;
  const user = (username) => db.prepare('SELECT id, role, full_name FROM users WHERE username = ?').get(username);
  return { db, name, user };
}

const TASKS = [
  {
    text: 'giao đ/c Bảo soạn báo cáo chi bộ trước thứ Sáu tuần sau, gấp',
    assignees: ['Trần Minh Bảo'], ambiguous: 0, due: '2026-11-20', priority: 'gap', title: 'Soạn báo cáo chi bộ',
  },
  {
    text: 'Bảo và Cường dọn dẹp phòng truyền thống trước ngày 20/12',
    assignees: ['Trần Minh Bảo', 'Lê Quốc Cường'], ambiguous: 0, due: '2026-12-20', priority: 'thuong', title: 'Dọn dẹp phòng truyền thống',
  },
  {
    text: 'nhắc đồng chí Hải nộp danh sách đảng viên vào cuối tháng, hỏa tốc',
    assignees: [], ambiguous: 1, due: '2026-11-30', priority: 'hoa_toc', title: 'Nộp danh sách đảng viên',
  },
];

for (const t of TASKS) {
  test(`README giao việc nhanh: ${t.text}`, () => {
    assert.ok(SECTION.includes('`' + t.text + '`'), 'câu ví dụ phải có trong README mục 13');
    const { db } = demo();
    const r = parseTaskSentence(db, t.text, TODAY);
    assert.deepEqual(r.assignees.map((a) => a.full_name), t.assignees);
    assert.equal(r.ambiguous.length, t.ambiguous);
    assert.deepEqual(r.unmatched, []);
    assert.equal(r.due_date, t.due);
    assert.equal(r.priority, t.priority);
    assert.equal(r.title, t.title);
  });
}

const EVERYONE = [
  ['việc nào quá hạn', 'viec_qua_han'], ['việc của tôi', 'viec_cua_toi'], ['việc đến hạn hôm nay', 'viec_den_han'],
  ['việc đến hạn tuần này', 'viec_den_han'], ['việc đến hạn 7 ngày tới', 'viec_den_han'], ['tình hình tuần này', 'tinh_hinh'],
];
const MANAGER_ONLY = [
  ['việc của Bảo', 'viec_cua'], ['ai đang quá tải', 'qua_tai'], ['ai đang nghỉ phép hôm nay', 'nghi_phep'],
  ['ai sắp chuyển Đảng chính thức', 'chuyen_dang'], ['ai sắp hết hạn phục vụ', 'het_han_phuc_vu'],
  ['ai đến niên hạn xét thăng quân hàm', 'nien_han'], ['bao nhiêu đảng viên', 'dem_dang_doan'],
  ['danh sách quân số trung đội 1', 'danh_sach_don_vi'],
];

test('README hỏi đáp: câu của mọi người chạy được với chiến sĩ và quản lý', () => {
  const { db, user } = demo();
  for (const [q, intent] of EVERYONE) {
    assert.ok(SECTION.includes('`' + q + '`'), `thiếu trong README: ${q}`);
    for (const u of ['cs01', 'ctv']) {
      const r = qa.answer(db, user(u), q, TODAY);
      assert.equal(r.intent, intent, `${u}: ${q}`);
      assert.ok(!r.denied, `${u}: ${q}`);
    }
  }
});

test('README hỏi đáp: câu của quản lý chạy được với quản lý và bị từ chối với chiến sĩ', () => {
  const { db, user } = demo();
  for (const [q, intent] of MANAGER_ONLY) {
    assert.ok(SECTION.includes('`' + q + '`'), `thiếu trong README: ${q}`);
    const m = qa.answer(db, user('ctv'), q, TODAY);
    assert.equal(m.intent, intent, `ctv: ${q}`);
    assert.ok(!m.denied, `ctv: ${q}`);
    const s = qa.answer(db, user('cs01'), q, TODAY);
    assert.equal(s.denied, true, `cs01: ${q}`);
  }
});

test('README: câu hỏi về tư tưởng, hoàn cảnh bị từ chối với mọi vai trò', () => {
  const { db, user } = demo();
  for (const u of ['admin', 'ctv', 'cs01']) {
    for (const q of ['tư tưởng của An thế nào', 'ai có hoàn cảnh khó khăn']) {
      const r = qa.answer(db, user(u), q, TODAY);
      assert.equal(r.intent, 'tu_choi');
      assert.deepEqual(r.rows, []);
    }
  }
});

test('câu thường mở đầu bằng từ ghép trùng tên người: không giao cho ai, giữ nguyên tiêu đề', () => {
  const { db } = demo();
  for (const t of ['Bảo đảm an toàn doanh trại', 'An toàn giao thông', 'Phong trào thi đua', 'Minh bạch tài chính',
    'Long trọng kỷ niệm', 'Nghĩa trang liệt sĩ', 'Dũng cảm cứu người', 'Cường độ huấn luyện']) {
    const r = parseTaskSentence(db, t, TODAY);
    assert.deepEqual(r.assignees, [], t);
    assert.deepEqual(r.ambiguous, [], t);
    assert.deepEqual(r.unmatched, [], t);
    assert.equal(r.title, t);
  }
});

test('hỏi đáp: việc quá hạn/đến hạn của một người (dữ liệu thử)', () => {
  const { db, user } = demo();
  const mgr = user('ctv');
  const bao = user('cs02');
  const cuong = user('cs03');
  let r = qa.answer(db, mgr, 'việc quá hạn của Bảo', TODAY);
  assert.equal(r.intent, 'viec_qua_han');
  assert.ok(r.summary.includes('Trần Minh Bảo'), r.summary);
  assert.ok(r.rows.every((x) => x.cells[1].includes('Trần Minh Bảo')));
  r = qa.answer(db, mgr, 'việc đến hạn tháng này của Bảo', TODAY);
  assert.equal(r.intent, 'viec_den_han');
  assert.ok(r.summary.includes('Trần Minh Bảo'), r.summary);
  assert.ok(r.rows.every((x) => x.cells[1].includes('Trần Minh Bảo')));
  // chiến sĩ: chỉ hỏi được của chính mình
  r = qa.answer(db, bao, 'việc quá hạn của Bảo', TODAY);
  assert.ok(!r.denied);
  assert.ok(r.rows.every((x) => x.cells[1].includes('Trần Minh Bảo')));
  for (const q of ['việc quá hạn của Bảo', 'việc đến hạn của Bảo']) {
    r = qa.answer(db, cuong, q, TODAY);
    assert.equal(r.denied, true, q);
    assert.deepEqual(r.rows, []);
  }
});
