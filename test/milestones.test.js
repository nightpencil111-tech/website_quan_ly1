const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { AppError } = require('../src/util/errors');
const S = require('../src/services/soldiers');
const I = require('../src/services/soldierItems');
const M = require('../src/services/milestones');

const T = '2026-11-11';
const mk = (db, d) => S.createSoldier(db, { full_name: 'Nguyễn Văn An', ...d }, null);

test('chưa cấu hình: items rỗng, missingConfig có chuyen_dang và het_han_phuc_vu', () => {
  const db = makeDb();
  mk(db, { party_join_date: '2025-11-20', enlist_date: '2025-01-01' });
  const r = M.upcomingMilestones(db, T);
  assert.deepEqual(r.items, []);
  assert.ok(r.missingConfig.includes('chuyen_dang'));
  assert.ok(r.missingConfig.includes('het_han_phuc_vu'));
  assert.equal(M.getMilestoneSettings(db).reminder_days, 30);
  assert.equal(M.getMilestoneSettings(db).party_probation_months, null);
});

test('chuyen_dang: dự bị 12 tháng, kết nạp 2025-11-20 → days_left 9', () => {
  const db = makeDb();
  const id = mk(db, { party_join_date: '2025-11-20' });
  M.saveMilestoneSettings(db, { party_probation_months: '12' }, null);
  const r = M.upcomingMilestones(db, T);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].kind, 'chuyen_dang');
  assert.equal(r.items[0].due_date, '2026-11-20');
  assert.equal(r.items[0].days_left, 9);
  assert.equal(r.items[0].soldier_id, id);
  assert.ok(!r.missingConfig.includes('chuyen_dang'));
  S.updateSoldier(db, id, { full_name: 'Nguyễn Văn An', party_join_date: '2025-11-20', party_official_date: '2026-11-01' }, null);
  assert.deepEqual(M.upcomingMilestones(db, T).items, []);
});

test('da_ra_quan không nhắc', () => {
  const db = makeDb();
  mk(db, { party_join_date: '2025-11-20', status: 'da_ra_quan' });
  M.saveMilestoneSettings(db, { party_probation_months: 12 }, null);
  assert.deepEqual(M.upcomingMilestones(db, T).items, []);
});

test('discharge_date ưu tiên hơn service_months', () => {
  const db = makeDb();
  mk(db, { enlist_date: '2025-02-01', discharge_date: '2026-11-15' });
  M.saveMilestoneSettings(db, { service_months: 24 }, null);
  const r = M.upcomingMilestones(db, T);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].due_date, '2026-11-15');
  assert.equal(r.items[0].kind, 'het_han_phuc_vu');
  const db2 = makeDb();
  mk(db2, { enlist_date: '2024-11-20' });
  M.saveMilestoneSettings(db2, { service_months: 24 }, null);
  assert.equal(M.upcomingMilestones(db2, T).items[0].due_date, '2026-11-20');
});

test('niên hạn quân hàm: Trung sĩ 6 tháng, rank_date 2026-05-31 → 2026-11-30', () => {
  const db = makeDb();
  mk(db, { rank: 'Trung sĩ', rank_date: '2026-05-31' });
  let r = M.upcomingMilestones(db, T);
  assert.deepEqual(r.items, []);
  assert.ok(r.missingConfig.includes('nien_han_quan_ham'));
  M.saveMilestoneSettings(db, { rank_intervals: { 'Trung sĩ': '6' } }, null);
  r = M.upcomingMilestones(db, T);
  assert.equal(r.items[0].kind, 'nien_han_quan_ham');
  assert.equal(r.items[0].due_date, '2026-11-30');
  assert.ok(!r.missingConfig.includes('nien_han_quan_ham'));
});

test('quá hạn 30 ngày còn, 31 ngày thì không; ngoài reminder_days không lấy', () => {
  const db = makeDb();
  mk(db, { discharge_date: '2026-10-12' }); // -30
  mk(db, { discharge_date: '2026-10-11' }); // -31
  mk(db, { discharge_date: '2026-12-11' }); // +30
  mk(db, { discharge_date: '2026-12-12' }); // +31
  const r = M.upcomingMilestones(db, T);
  assert.deepEqual(r.items.map((i) => i.days_left), [-30, 30]);
  assert.ok(r.items[0].unit_name === null || typeof r.items[0].unit_name === 'string');
});

test('soldierId lọc theo một người, sắp theo due_date', () => {
  const db = makeDb();
  const a = mk(db, { discharge_date: '2026-11-20' });
  mk(db, { discharge_date: '2026-11-15' });
  assert.equal(M.upcomingMilestones(db, T).items[0].due_date, '2026-11-15');
  const r = M.upcomingMilestones(db, T, { soldierId: a });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].soldier_id, a);
});

test('saveMilestoneSettings: kiểm tra đầu vào, xóa khóa, audit', () => {
  const db = makeDb();
  assert.throws(() => M.saveMilestoneSettings(db, { party_probation_months: '0' }, 1), (e) => e instanceof AppError && /dự bị/i.test(e.message));
  assert.throws(() => M.saveMilestoneSettings(db, { service_months: '601' }, 1), AppError);
  assert.throws(() => M.saveMilestoneSettings(db, { service_months: '1.5' }, 1), AppError);
  assert.throws(() => M.saveMilestoneSettings(db, { reminder_days: '366' }, 1), AppError);
  assert.throws(() => M.saveMilestoneSettings(db, { rank_intervals: { 'Đại tá': 5, 'Quân nhân chuyên nghiệp': 3 } }, 1), AppError);
  assert.throws(() => M.saveMilestoneSettings(db, { rank_intervals: { 'Xyz': 3 } }, 1), AppError);
  M.saveMilestoneSettings(db, { party_probation_months: '12', service_months: '24', reminder_days: '45', rank_intervals: { 'Hạ sĩ': '12', 'Trung sĩ': '' } }, 1);
  let s = M.getMilestoneSettings(db);
  assert.deepEqual(s, { party_probation_months: 12, service_months: 24, reminder_days: 45, rank_intervals: { 'Hạ sĩ': 12 } });
  M.saveMilestoneSettings(db, { party_probation_months: '', service_months: '', reminder_days: '', rank_intervals: {} }, 1);
  s = M.getMilestoneSettings(db);
  assert.deepEqual(s, { party_probation_months: null, service_months: null, reminder_days: 30, rank_intervals: {} });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='milestone_settings'").get().c, 2);
});

test('rank_intervals JSON hỏng được coi là {}', () => {
  const db = makeDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('rank_intervals', '{hỏng')").run();
  assert.deepEqual(M.getMilestoneSettings(db).rank_intervals, {});
});

test('soldierStats: needAttention theo bản ghi mới nhất; onLeaveToday không đếm trùng', () => {
  const db = makeDb();
  const a = mk(db, {});
  const b = mk(db, { full_name: 'Trần Văn Bình' });
  const c = mk(db, { full_name: 'Lê Văn Cường' });
  I.addItem(db, 'thought', a, { date: '2026-10-01', level: 'dac_biet', content: 'x' }, null);
  I.addItem(db, 'thought', a, { date: '2026-11-01', level: 'binh_thuong', content: 'y' }, null);
  I.addItem(db, 'thought', b, { date: '2026-10-01', level: 'binh_thuong', content: 'x' }, null);
  I.addItem(db, 'thought', b, { date: '2026-11-01', level: 'can_quan_tam', content: 'y' }, null);
  I.addItem(db, 'leave', a, { kind: 'phep', from_date: '2026-11-08', to_date: '2026-11-15' }, null);
  I.addItem(db, 'leave', a, { kind: 'tranh_thu', from_date: '2026-11-10', to_date: '2026-11-12' }, null);
  I.addItem(db, 'leave', c, { kind: 'phep', from_date: '2026-11-12', to_date: '2026-11-13' }, null);
  const st = M.soldierStats(db, T);
  assert.equal(st.total, 3);
  assert.equal(st.onLeaveToday, 1);
  assert.equal(st.needAttention.length, 1);
  assert.equal(st.needAttention[0].soldier_id, b);
  assert.equal(st.needAttention[0].level, 'can_quan_tam');
  assert.equal(st.needAttention[0].date, '2026-11-01');
});
