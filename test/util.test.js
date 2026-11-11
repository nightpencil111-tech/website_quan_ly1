const test = require('node:test');
const assert = require('node:assert/strict');
const { today, addDays, daysBetween, weekday } = require('../src/util/date');
const { fold, LABELS, PRIORITY_WEIGHT } = require('../src/util/text');

test('today theo giờ Việt Nam', () => {
  assert.equal(today(new Date('2026-11-10T23:30:00Z')), '2026-11-11');
  assert.equal(today(new Date('2026-11-10T16:59:00Z')), '2026-11-10');
});
test('addDays qua năm', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});
test('daysBetween', () => {
  assert.equal(daysBetween('2026-11-11', '2026-11-14'), 3);
  assert.equal(daysBetween('2026-11-14', '2026-11-11'), -3);
});
test('weekday 1=Thứ Hai … 7=Chủ nhật', () => {
  assert.equal(weekday('2026-11-16'), 1);
  assert.equal(weekday('2026-11-22'), 7);
});
test('fold bỏ dấu và lowercase', () => {
  assert.equal(fold('Công tác ĐẢNG'), 'cong tac dang');
  assert.equal(fold('đảng'), 'dang');
});
test('LABELS và PRIORITY_WEIGHT', () => {
  assert.equal(LABELS.category.cong_tac_dang, 'Công tác Đảng');
  assert.equal(LABELS.priority.hoa_toc, 'Hỏa tốc');
  assert.equal(LABELS.status.cho_duyet, 'Chờ duyệt');
  assert.equal(LABELS.role.admin, 'Chỉ huy (Admin)');
  assert.deepEqual(PRIORITY_WEIGHT, { thuong: 1, gap: 1.5, hoa_toc: 2 });
});
