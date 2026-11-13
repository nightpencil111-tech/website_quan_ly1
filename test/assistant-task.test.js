const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { parseTaskSentence } = require('../src/services/assistant/taskParser');
const { AppError } = require('../src/util/errors');

const TODAY = '2026-11-13';

function setup() {
  const db = makeDb();
  const unit = Number(db.prepare("INSERT INTO units (name) VALUES ('Đại đội 1')").run().lastInsertRowid);
  const mk = (username, full_name, role = 'member', active = 1) => Number(db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, active, unit_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(username, 'x', full_name, role, active, unit).lastInsertRowid);
  const ids = {
    an1: mk('an1', 'Nguyễn Văn An'),
    an2: mk('an2', 'Lê An', 'manager'),
    hung: mk('hung', 'Trần Văn Hùng'),
    dung: mk('dung', 'Phạm Đức Dũng', 'member', 0),
    hai: mk('hai', 'Hoàng Thanh Hải'),
    boss: mk('boss', 'Đỗ Văn Tùng', 'admin'),
  };
  return { db, ids };
}

test('câu đầy đủ: người, ưu tiên, lĩnh vực, hạn, tiêu đề', () => {
  const { db, ids } = setup();
  const r = parseTaskSentence(db, 'Giao đ/c Hùng chuẩn bị nội dung sinh hoạt chi bộ, gấp, hạn thứ Sáu', TODAY);
  assert.deepEqual(r.assignees, [{ id: ids.hung, full_name: 'Trần Văn Hùng' }]);
  assert.deepEqual(r.ambiguous, []);
  assert.deepEqual(r.unmatched, []);
  assert.equal(r.priority, 'gap');
  assert.equal(r.category, 'cong_tac_dang');
  assert.equal(r.due_date, '2026-11-13');
  assert.equal(r.due_phrase, 'hạn thứ Sáu');
  assert.equal(r.title, 'Chuẩn bị nội dung sinh hoạt chi bộ');
});

test('tên một chữ trùng nhau → ambiguous, không tự chọn', () => {
  const { db, ids } = setup();
  const r = parseTaskSentence(db, 'giao dc an va dc hai to chuc hoi thao', TODAY);
  assert.deepEqual(r.assignees, [{ id: ids.hai, full_name: 'Hoàng Thanh Hải' }]);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].phrase, 'an');
  assert.deepEqual(r.ambiguous[0].candidates.map((c) => c.id).sort((a, b) => a - b), [ids.an1, ids.an2]);
  assert.equal(r.ambiguous[0].candidates[0].unit_name, 'Đại đội 1');
  assert.equal(r.category, 'van_hoa');
  assert.equal(r.priority, 'thuong');
  assert.equal(r.due_date, null);
  assert.equal(r.title, 'To chuc hoi thao');
  assert.ok(r.notes.some((n) => n.includes("'an'")));
});

test('người bị khóa → unmatched, có ghi chú', () => {
  const { db } = setup();
  const r = parseTaskSentence(db, 'đ/c Dũng kiểm tra quân trang', TODAY);
  assert.deepEqual(r.assignees, []);
  assert.deepEqual(r.unmatched, ['Dũng']);
  assert.equal(r.category, 'hau_can');
  assert.equal(r.title, 'Kiểm tra quân trang');
  assert.ok(r.notes.some((n) => n.includes("Không tìm thấy người tên 'Dũng'")));
});

test('admin không là ứng viên', () => {
  const { db } = setup();
  const r = parseTaskSentence(db, 'đ/c Tùng kiểm tra doanh trại', TODAY);
  assert.deepEqual(r.assignees, []);
  assert.deepEqual(r.unmatched, ['Tùng']);
});

test('hỏa tốc', () => {
  const { db } = setup();
  const r = parseTaskSentence(db, 'hỏa tốc: báo cáo tình hình tư tưởng', TODAY);
  assert.equal(r.priority, 'hoa_toc');
  assert.equal(r.category, 'khac');
  assert.equal(r.title, 'Báo cáo tình hình tư tưởng');
  assert.deepEqual(r.assignees, []);
});

test('chỉ có người, không có nội dung → AppError', () => {
  const { db } = setup();
  assert.throws(() => parseTaskSentence(db, 'giao đ/c Hùng', TODAY),
    (e) => e instanceof AppError && e.message === 'Chưa có nội dung công việc');
  assert.throws(() => parseTaskSentence(db, '   ', TODAY),
    (e) => e instanceof AppError && e.message === 'Chưa có nội dung công việc');
});

test('đủ họ tên → khớp đúng 1 người', () => {
  const { db, ids } = setup();
  const r = parseTaskSentence(db, 'Giao cho Nguyễn Văn An viết báo cáo thi đua trước 20/12', TODAY);
  assert.deepEqual(r.assignees, [{ id: ids.an1, full_name: 'Nguyễn Văn An' }]);
  assert.deepEqual(r.ambiguous, []);
  assert.equal(r.category, 'thi_dua');
  assert.equal(r.due_date, '2026-12-20');
  assert.equal(r.title, 'Viết báo cáo thi đua');
});

test('"giáo dục chính trị" không bị hiểu là "giao"; hai từ cuối tên', () => {
  const { db, ids } = setup();
  const r = parseTaskSentence(db, 'đồng chí Thanh Hải tổ chức giáo dục chính trị tuần sau', TODAY);
  assert.deepEqual(r.assignees, [{ id: ids.hai, full_name: 'Hoàng Thanh Hải' }]);
  assert.equal(r.category, 'giao_duc_ct');
  assert.equal(r.due_date, '2026-11-20');
  assert.equal(r.title, 'Tổ chức giáo dục chính trị');
});

test('nối nhiều người bằng dấu phẩy và "cùng", không trùng lặp', () => {
  const { db, ids } = setup();
  const r = parseTaskSentence(db, 'đ/c Hùng, đ/c Hải cùng đ/c Hùng huấn luyện điều lệnh', TODAY);
  assert.deepEqual(r.assignees.map((a) => a.id), [ids.hung, ids.hai]);
  assert.equal(r.category, 'huan_luyen');
  assert.equal(r.title, 'Huấn luyện điều lệnh');
});

test('không ghi người / hạn → ghi chú nhắc kiểm tra', () => {
  const { db } = setup();
  const r = parseTaskSentence(db, 'sửa chữa doanh trại', TODAY);
  assert.deepEqual(r.assignees, []);
  assert.equal(r.due_date, null);
  assert.equal(r.due_phrase, null);
  assert.equal(r.category, 'hau_can');
  assert.ok(r.notes.length >= 2);
});

test('dấu câu cuối được dọn, từ dẫn ở cuối câu không gây lỗi', () => {
  const { db, ids } = setup();
  const r = parseTaskSentence(db, 'Đ/C HÙNG: viết bản tin thời sự, khẩn cấp!', TODAY);
  assert.equal(r.title, 'Viết bản tin thời sự');
  assert.equal(r.priority, 'hoa_toc');
  assert.deepEqual(r.assignees.map((a) => a.id), [ids.hung]);
  assert.doesNotThrow(() => parseTaskSentence(db, 'kiểm tra quân trang d/c', TODAY));
  // "giao" không kèm người thì giữ nguyên trong tiêu đề.
  assert.equal(parseTaskSentence(db, 'giao nhiệm vụ huấn luyện', TODAY).title, 'Giao nhiệm vụ huấn luyện');
});

test('danh sách tên trần ở đầu câu: nhận khi mọi cụm khớp và còn cụm động từ', () => {
  const { db, ids } = setup();
  const r = parseTaskSentence(db, 'Hùng và Hải dọn dẹp phòng truyền thống trước ngày 20/12', TODAY);
  assert.deepEqual(r.assignees.map((a) => a.id), [ids.hung, ids.hai]);
  assert.equal(r.title, 'Dọn dẹp phòng truyền thống');
  assert.equal(r.due_date, '2026-12-20');
  const amb = parseTaskSentence(db, 'Hùng, An soạn kế hoạch', TODAY);
  assert.deepEqual(amb.assignees.map((a) => a.id), [ids.hung]);
  assert.equal(amb.ambiguous.length, 1);
  assert.equal(amb.title, 'Soạn kế hoạch');
});

test('danh sách tên trần: câu thường không bị hiểu thành người', () => {
  const { db } = setup();
  db.prepare("INSERT INTO users (username, password_hash, full_name, role, active) VALUES ('bao', 'x', 'Trần Bảo', 'member', 1)").run();
  for (const t of ['Báo cáo tình hình tuần này', 'Hùng', 'Hùng và', 'Hùng và dọn dẹp', 'Hùng và Xyz làm việc']) {
    const r = parseTaskSentence(db, t, TODAY);
    assert.deepEqual(r.assignees, [], t);
    assert.deepEqual(r.ambiguous, [], t);
  }
  assert.equal(parseTaskSentence(db, 'Báo cáo tình hình tuần này', TODAY).title, 'Báo cáo tình hình tuần này');
});

test('tiêu đề: bỏ giới từ thừa sau khi cắt ngày và bỏ động từ nhắc ở đầu khi có người', () => {
  const { db, ids } = setup();
  const r = parseTaskSentence(db, 'nhắc đồng chí Hùng nộp danh sách đảng viên vào cuối tháng', TODAY);
  assert.deepEqual(r.assignees.map((a) => a.id), [ids.hung]);
  assert.equal(r.title, 'Nộp danh sách đảng viên');
  assert.equal(parseTaskSentence(db, 'Nộp danh sách đảng viên chậm nhất ngày mai', TODAY).title, 'Nộp danh sách đảng viên');
  assert.equal(parseTaskSentence(db, 'yêu cầu đ/c Hùng báo cáo trước thứ Sáu', TODAY).title, 'Báo cáo');
  // không có người → giữ nguyên động từ
  assert.equal(parseTaskSentence(db, 'nhắc nộp báo cáo vào cuối tháng', TODAY).title, 'Nhắc nộp báo cáo');
});

test('tên trần đầu câu: một tên đơn lẻ không bao giờ là người; cần ≥ 2 tên viết hoa', () => {
  const { db, ids } = setup();
  // Một tên trần → không nhận
  const one = parseTaskSentence(db, 'Hùng dọn dẹp kho', TODAY);
  assert.deepEqual(one.assignees, []);
  assert.equal(one.title, 'Hùng dọn dẹp kho');
  // Hai tên nhưng không viết hoa → không nhận
  const low = parseTaskSentence(db, 'hùng và hải dọn dẹp kho', TODAY);
  assert.deepEqual(low.assignees, []);
  assert.equal(low.title, 'Hùng và hải dọn dẹp kho');
  // Hai tên viết hoa → nhận
  const two = parseTaskSentence(db, 'Hùng, Hải dọn dẹp kho', TODAY);
  assert.deepEqual(two.assignees.map((a) => a.id), [ids.hung, ids.hai]);
  assert.equal(two.title, 'Dọn dẹp kho');
});

test('giao cho đơn vị: không coi là người, có ghi chú, bỏ khỏi tiêu đề', () => {
  const { db } = setup();
  db.prepare("INSERT INTO units (name) VALUES ('Trung đội 2')").run();
  const r = parseTaskSentence(db, 'giao cho Trung đội 2 sơn lại cổng doanh trại trước 20/12', TODAY);
  assert.deepEqual(r.assignees, []);
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(r.ambiguous, []);
  assert.deepEqual(r.units, ['Trung đội 2']);
  assert.equal(r.title, 'Sơn lại cổng doanh trại');
  assert.equal(r.due_date, '2026-12-20');
  assert.ok(r.notes.includes('Giao cho đơn vị: Trung đội 2 — đồng chí chọn người thực hiện'));
  assert.ok(!r.notes.some((n) => n.startsWith('Không tìm thấy')));
  // Đơn vị không có trong danh sách nhưng đúng dạng "tiểu đội N" cũng nhận là đơn vị.
  const t = parseTaskSentence(db, 'giao cho tiểu đội 3 trực nhật', TODAY);
  assert.deepEqual(t.units, ['tiểu đội 3']);
  assert.deepEqual(t.unmatched, []);
  assert.equal(t.title, 'Trực nhật');
});
