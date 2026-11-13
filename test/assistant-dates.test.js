const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDatePhrase, foldAligned } = require('../src/services/assistant/dateWords');

const FRI = '2026-11-13'; // thứ Sáu

const d = (text, today = FRI) => resolveDatePhrase(text, today)?.date ?? null;

test('foldAligned giữ nguyên độ dài để ánh xạ về câu gốc', () => {
  const s = 'Giao đ/c Hùng chuẩn bị, HẠN thứ Sáu';
  const f = foldAligned(s);
  assert.equal(f.length, s.length);
  assert.equal(f, 'giao d/c hung chuan bi, han thu sau');
  // Chuỗi dạng tổ hợp (NFD) vẫn được chuẩn hóa NFC trước khi so.
  const nfd = 'Hùng'.normalize('NFD');
  assert.equal(foldAligned(nfd), 'hung');
});

test('thứ trong tuần quanh mốc thứ Sáu', () => {
  assert.equal(d('hạn thứ Sáu'), '2026-11-13');
  assert.equal(d('thứ hai'), '2026-11-16');
  assert.equal(d('thu 2 tuan sau'), '2026-11-23');
  assert.equal(d('xong trước chủ nhật'), '2026-11-15');
  assert.equal(d('hạn CN'), '2026-11-15');
  assert.equal(d('thứ 7'), '2026-11-14');
  // Hôm nay Chủ nhật + "thứ Hai" → ngày mai.
  assert.equal(d('thứ Hai', '2026-11-15'), '2026-11-16');
});

test('chữ "thư" (thư từ) không bị hiểu là "thứ"', () => {
  assert.equal(resolveDatePhrase('gửi thư hai bản cho đơn vị', FRI), null);
});

test('ngày tương đối', () => {
  assert.equal(d('hôm nay'), '2026-11-13');
  assert.equal(d('ngày mai'), '2026-11-14');
  assert.equal(d('ngay kia'), '2026-11-15');
  assert.equal(d('trong 3 ngày'), '2026-11-16');
  assert.equal(d('5 ngày nữa'), '2026-11-18');
  assert.equal(d('cuối tuần'), '2026-11-15');
  assert.equal(d('cuối tháng'), '2026-11-30');
  assert.equal(d('tuần sau'), '2026-11-20');
  assert.equal(d('đầu tháng sau'), '2026-12-05');
});

test('qua mốc cuối năm / tháng 31 ngày', () => {
  assert.equal(d('trong 3 ngày', '2026-12-30'), '2027-01-02');
  assert.equal(d('cuối tháng', '2026-12-30'), '2026-12-31');
});

test('ngày tháng cụ thể', () => {
  assert.equal(d('20/12'), '2026-12-20');
  assert.equal(d('5/1'), '2027-01-05');
  assert.equal(d('ngày 3 tháng 12'), '2026-12-03');
  assert.equal(d('10/11'), '2027-11-10'); // đã qua → năm sau
  assert.equal(d('13/11'), '2026-11-13'); // hôm nay chưa qua
  assert.equal(d('hạn 15/3/2027'), '2027-03-15');
});

test('không có ngày hoặc ngày sai → null', () => {
  assert.equal(resolveDatePhrase('chuẩn bị nội dung sinh hoạt', FRI), null);
  assert.equal(resolveDatePhrase('31/02', FRI), null);
});

test('phrase là đoạn gốc (kèm từ "hạn") để loại khỏi tiêu đề', () => {
  const r = resolveDatePhrase('Chuẩn bị báo cáo, hạn thứ Sáu', FRI);
  assert.equal(r.phrase, 'hạn thứ Sáu');
  const r2 = resolveDatePhrase('Làm xong trước ngày 20/12 nhé', FRI);
  assert.equal(r2.phrase, 'xong trước ngày 20/12');
  assert.equal(r2.date, '2026-12-20');
});
