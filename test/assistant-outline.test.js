const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { OUTLINES, buildOutline } = require('../src/services/assistant/outlines');
const tasksSvc = require('../src/services/tasks');
const { AppError } = require('../src/util/errors');

const TODAY = '2026-11-13'; // tuần 09/11–15/11

test('kế hoạch: đủ 6 mục và chèn chủ đề vào mục đích', () => {
  const db = makeDb();
  const t = buildOutline(db, 'ke_hoach', { topic: 'tổ chức hội thao quốc phòng' }, TODAY);
  for (const h of ['I. MỤC ĐÍCH, YÊU CẦU', '1. Mục đích', '2. Yêu cầu', 'II. NỘI DUNG', 'III. THỜI GIAN, ĐỊA ĐIỂM',
    'IV. LỰC LƯỢNG, THÀNH PHẦN', 'V. TỔ CHỨC THỰC HIỆN', 'VI. CÔNG TÁC BẢO ĐẢM']) {
    assert.ok(t.includes(h), h);
  }
  const purpose = t.split('\n').find((l) => l.includes('Mục đích') === false && l.includes('tổ chức hội thao quốc phòng'));
  assert.ok(purpose, 'topic nằm trong câu mục đích');
  assert.ok(t.indexOf('tổ chức hội thao quốc phòng') < t.indexOf('2. Yêu cầu'));
  assert.ok(!buildOutline(db, 'ke_hoach', {}, TODAY).includes('undefined'));
});

test('báo cáo: đủ 5 mục', () => {
  const t = buildOutline(makeDb(), 'bao_cao', { topic: 'công tác huấn luyện' }, TODAY);
  for (const h of ['I. TÌNH HÌNH CHUNG', 'II. KẾT QUẢ THỰC HIỆN', 'III. ƯU ĐIỂM, KHUYẾT ĐIỂM',
    'IV. PHƯƠNG HƯỚNG, NHIỆM VỤ THỜI GIAN TỚI', 'V. ĐỀ XUẤT, KIẾN NGHỊ']) {
    assert.ok(t.includes(h), h);
  }
  assert.ok(t.includes('công tác huấn luyện'));
});

test('báo cáo tuần: số liệu thật và tiêu đề tuần', () => {
  const db = makeDb();
  const mgr = Number(db.prepare("INSERT INTO users (username, password_hash, full_name, role, active) VALUES ('m','x','Quản Lý','manager',1)").run().lastInsertRowid);
  for (const [title, due, done] of [['Việc A', '2026-11-10', 1], ['Việc B', '2026-11-12', 1], ['Việc C', '2026-11-14', 0]]) {
    const id = tasksSvc.createTask(db, { title, due_date: due, assignee_ids: [mgr] }, mgr);
    if (done) db.prepare("UPDATE tasks SET status='hoan_thanh', completed_at=? WHERE id=?").run(due, id);
  }
  const t = buildOutline(db, 'bao_cao_tuan', {}, TODAY);
  assert.match(t.split('\n')[0], /^BÁO CÁO TUẦN \(09\/11–15\/11\)$/);
  assert.ok(t.includes('tổng số nhiệm vụ đến hạn là 3; đã hoàn thành 2 nhiệm vụ'));
  assert.ok(t.includes('Việc A'));
});

test('biên bản sinh hoạt: đủ mục', () => {
  const t = buildOutline(makeDb(), 'bien_ban_sinh_hoat', { topic: 'sinh hoạt chi bộ tháng 11' }, TODAY);
  for (const h of ['BIÊN BẢN', 'Thời gian, địa điểm', 'Thành phần', 'Chủ trì, thư ký', 'Nội dung', 'Kết luận']) {
    assert.ok(t.includes(h), h);
  }
  assert.ok(t.includes('sinh hoạt chi bộ tháng 11'));
});

test('OUTLINES có nhãn; key lạ → AppError', () => {
  assert.deepEqual(Object.keys(OUTLINES).sort(), ['bao_cao', 'bao_cao_tuan', 'bien_ban_sinh_hoat', 'ke_hoach']);
  for (const o of Object.values(OUTLINES)) assert.ok(o.label && typeof o.build === 'function');
  assert.throws(() => buildOutline(makeDb(), 'xyz', {}, TODAY), AppError);
  assert.throws(() => buildOutline(makeDb(), '__proto__', {}, TODAY), AppError);
});
