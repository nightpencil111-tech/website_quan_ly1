// Dữ liệu thử (toàn bộ hư cấu): npm run demo
// Dùng DB_PATH (mặc định data/data.db cạnh ứng dụng). Từ chối chạy nếu DB đã có công việc, trừ khi có --force.
const { openDb, seed } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { today, addDays, weekday } = require('../src/util/date');
const users = require('../src/services/users');
const tasks = require('../src/services/tasks');
const events = require('../src/services/events');
const recurring = require('../src/services/recurring');
const soldiers = require('../src/services/soldiers');
const items = require('../src/services/soldierItems');
const milestones = require('../src/services/milestones');
const { addMonths } = require('../src/util/date');

const PASSWORD = 'Demo@1234';

// Hồ sơ quân nhân thử (hư cấu). Ngày tính tương đối so với hôm nay để mốc nhắc luôn hiển thị.
// [họ tên, giới tính, cấp bậc, chức vụ, chỉ số đơn vị, nhập ngũ (tháng trước), nhận cấp bậc (tháng trước), vào Đoàn (năm trước), vào Đảng (tháng trước), chính thức (tháng trước)]
const PROFILES = [
  ['Nguyễn Văn An', 'Trung sĩ', 'Tiểu đội trưởng', 0, 20, 9, 6, 15, 4],
  ['Trần Minh Bảo', 'Hạ sĩ', 'Chiến sĩ', 0, 14, 7, 5],
  ['Lê Quốc Cường', 'Binh nhất', 'Chiến sĩ', 0, 23.5, 4.5, 5],
  ['Phạm Đức Dũng', 'Thượng sĩ', 'Tiểu đội trưởng', 1, 30, 12, 8, 30, 20],
  ['Hoàng Thanh Hải', 'Trung sĩ', 'Phó tiểu đội trưởng', 1, 18, 8, 6, 11.5],
  ['Vũ Hữu Khang', 'Binh nhì', 'Chiến sĩ', 1, 6, 5.8, 3],
  ['Đặng Gia Long', 'Hạ sĩ', 'Chiến sĩ', 1, 15, 3, 4],
  ['Bùi Anh Minh', 'Thượng sĩ', 'Tiểu đội trưởng', 2, 33, 10, 8, 36, 24],
  ['Ngô Trọng Nghĩa', 'Binh nhất', 'Chiến sĩ', 2, 9, 2, 4],
  ['Đỗ Thế Phong', 'Hạ sĩ', 'Chiến sĩ', 2, 16, 6.2],
];
const EXTRA = [
  ['Lý Hoàng Anh', 'Binh nhì', 'Chiến sĩ', 0, 4, 4],
  ['Mai Xuân Bách', 'Binh nhất', 'Chiến sĩ', 0, 12, 6.1],
  ['Trịnh Công Danh', 'Hạ sĩ', 'Chiến sĩ', 0, 20, 5.9],
  ['Phan Nhật Đức', 'Binh nhì', 'Chiến sĩ', 1, 5, 5],
  ['Tạ Quang Giang', 'Trung sĩ', 'Chiến sĩ', 1, 22, 2],
  ['Cao Văn Hiếu', 'Binh nhất', 'Chiến sĩ', 1, 11, 5],
  ['Dương Tiến Khải', 'Hạ sĩ', 'Chiến sĩ', 2, 17, 4],
  ['Lương Thái Lộc', 'Binh nhì', 'Chiến sĩ', 2, 3, 3],
  ['Kiều Đình Nam', 'Thượng sĩ', 'Chiến sĩ', 2, 28, 7],
  ['Hà Minh Phúc', 'Binh nhất', 'Chiến sĩ', 2, 10, 3],
];

const MEMBERS = [
  ['cs01', 'Nguyễn Văn An', 'Trung sĩ', 'Tiểu đội trưởng', 0, 'dang_vien'],
  ['cs02', 'Trần Minh Bảo', 'Hạ sĩ', 'Chiến sĩ', 0, 'doan_vien'],
  ['cs03', 'Lê Quốc Cường', 'Binh nhất', 'Chiến sĩ', 0, 'doan_vien'],
  ['cs04', 'Phạm Đức Dũng', 'Thượng sĩ', 'Tiểu đội trưởng', 1, 'dang_vien'],
  ['cs05', 'Hoàng Thanh Hải', 'Trung sĩ', 'Phó tiểu đội trưởng', 1, 'du_bi'],
  ['cs06', 'Vũ Hữu Khang', 'Binh nhì', 'Chiến sĩ', 1, 'doan_vien'],
  ['cs07', 'Đặng Gia Long', 'Hạ sĩ', 'Chiến sĩ', 1, 'doan_vien'],
  ['cs08', 'Bùi Anh Minh', 'Thượng sĩ', 'Tiểu đội trưởng', 2, 'dang_vien'],
  ['cs09', 'Ngô Trọng Nghĩa', 'Binh nhất', 'Chiến sĩ', 2, 'doan_vien'],
  ['cs10', 'Đỗ Thế Phong', 'Hạ sĩ', 'Chiến sĩ', 2, 'khong'],
];

function insertUser(db, u) {
  const r = db.prepare(
    `INSERT INTO users (username, password_hash, full_name, rank, position, unit_id, role, party_status, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(u.username, hashPassword(PASSWORD), u.full_name, u.rank, u.position, u.unit_id, u.role, u.party_status);
  return Number(r.lastInsertRowid);
}

function fillDemo(db, { force = false, log = () => {} } = {}) {
  seed(db);
  const t0 = today();
  const reasons = [];
  if (db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c > 0) reasons.push('đã có công việc');
  if (db.prepare("SELECT COUNT(*) AS c FROM users WHERE username != 'admin'").get().c > 0) reasons.push('đã có tài khoản ngoài admin');
  if (db.prepare("SELECT COUNT(*) AS c FROM users WHERE username = 'admin' AND must_change_password = 0").get().c > 0) {
    reasons.push('admin đã đặt mật khẩu riêng');
  }
  if (reasons.length && !force) {
    throw new Error(`CSDL không phải bản mới cài (${reasons.join('; ')}). Dùng --force nếu đồng chí chắc chắn muốn thêm dữ liệu thử.`);
  }
  if (reasons.length) {
    log(`CẢNH BÁO: mật khẩu tài khoản admin sẽ bị đặt lại thành ${PASSWORD} (${reasons.join('; ')}).`);
  }
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(PASSWORD), admin.id);

  const units = ['Trung đội 1', 'Trung đội 2', 'Trung đội 3'].map((n) => users.createUnit(db, n, admin.id));

  const mgrId = insertUser(db, {
    username: 'ctv', full_name: 'Trần Quang Huy', rank: 'Thiếu úy', position: 'Chính trị viên phó đại đội',
    unit_id: units[0], role: 'manager', party_status: 'dang_vien',
  });
  const ids = MEMBERS.map((m) => insertUser(db, {
    username: m[0], full_name: m[1], rank: m[2], position: m[3], unit_id: units[m[4]], role: 'member', party_status: m[5],
  }));
  const mgr = { id: mgrId, role: 'manager' };
  const asMember = (i) => ({ id: ids[i], role: 'member' });

  // [tiêu đề, lĩnh vực, ưu tiên, hạn (ngày so với hôm nay), người thực hiện (chỉ số), trạng thái, ngày hoàn thành (so với hôm nay)]
  const T = [
    ['Soạn nội dung sinh hoạt chính trị tuần', 'giao_duc_ct', 'thuong', -9, [0], 'hoan_thanh', -10],
    ['Báo cáo kết quả thi đua tháng trước', 'thi_dua', 'thuong', -12, [3], 'hoan_thanh', -12],
    ['Cập nhật bảng tin đơn vị', 'van_hoa', 'thuong', -6, [1], 'hoan_thanh', -4],
    ['Tổng hợp danh sách đoàn viên ưu tú', 'cong_tac_dang', 'gap', -15, [4], 'hoan_thanh', -11],
    ['Kiểm tra vệ sinh doanh trại', 'hau_can', 'thuong', -20, [5, 6], 'hoan_thanh', -22],
    ['Chuẩn bị tiết mục văn nghệ chào mừng', 'van_hoa', 'gap', -8, [2, 6], 'hoan_thanh', -9],
    ['Hoàn thiện hồ sơ khen thưởng quý', 'thi_dua', 'thuong', -5, [7], 'hoan_thanh', -5],
    ['Ôn luyện nội dung huấn luyện điều lệnh', 'huan_luyen', 'thuong', -3, [8, 9], 'hoan_thanh', -3],
    ['Viết tin bài gửi bản tin nội bộ', 'van_hoa', 'thuong', -18, [1], 'hoan_thanh', -16],
    ['Thăm hỏi gia đình quân nhân có hoàn cảnh khó khăn', 'dan_van', 'gap', -2, [3], 'hoan_thanh', -2],
    // quá hạn
    ['Nộp báo cáo đánh giá chất lượng sinh hoạt chi bộ', 'cong_tac_dang', 'hoa_toc', -4, [0], 'dang_lam'],
    ['Sửa chữa bảng tuyên truyền ngoài sân', 'hau_can', 'thuong', -7, [5], 'chua_lam'],
    ['Thống kê kết quả học tập chính trị', 'giao_duc_ct', 'gap', -1, [4], 'cho_duyet'],
    ['Liên hệ chính quyền địa phương về hoạt động dân vận', 'dan_van', 'thuong', -3, [7], 'chua_lam'],
    // hôm nay / tuần này
    ['Họp giao ban chính trị đầu tuần', 'cong_tac_dang', 'gap', 0, [0, 3], 'dang_lam'],
    ['Nộp biên bản họp tổ', 'cong_tac_dang', 'thuong', 0, [1], 'chua_lam'],
    ['Soạn giáo án giáo dục truyền thống', 'giao_duc_ct', 'thuong', 1, [2], 'dang_lam'],
    ['Chuẩn bị hội thi "Tiểu đội mạnh"', 'thi_dua', 'gap', 2, [4, 5], 'dang_lam'],
    ['Kiểm tra kỹ thuật thiết bị truyền thanh', 'hau_can', 'thuong', 3, [9], 'chua_lam'],
    ['Phối hợp tập huấn bắn súng', 'huan_luyen', 'thuong', 4, [6, 7], 'chua_lam'],
    ['Báo cáo nhanh tình hình tư tưởng', 'cong_tac_dang', 'hoa_toc', 1, [3], 'cho_duyet'],
    // xa hơn
    ['Xây dựng kế hoạch kỷ niệm 22/12', 'giao_duc_ct', 'gap', 9, [0, 8], 'dang_lam'],
    ['Tổ chức giao lưu văn nghệ với đơn vị bạn', 'van_hoa', 'thuong', 12, [2, 6], 'chua_lam'],
    ['Phát động phong trào thi đua quý', 'thi_dua', 'thuong', 15, [7], 'chua_lam'],
    ['Giúp dân gặt lúa tại địa phương kết nghĩa', 'dan_van', 'thuong', 18, [5, 8, 9], 'chua_lam'],
    ['Lập kế hoạch bổ sung vật tư hậu cần', 'hau_can', 'thuong', 20, [3], 'chua_lam'],
    ['Tập huấn công tác Đảng cho đảng viên mới', 'cong_tac_dang', 'thuong', 25, [4], 'chua_lam'],
    ['Soạn đề cương tuyên truyền pháp luật', 'giao_duc_ct', 'thuong', 6, [1], 'dang_lam'],
    ['Rà soát nhu cầu học tập của chiến sĩ', 'khac', 'thuong', 8, [9], 'chua_lam'],
    ['Báo cáo tổng kết công tác tháng', 'cong_tac_dang', 'gap', 10, [0], 'chua_lam'],
  ];
  const checklists = {
    'Xây dựng kế hoạch kỷ niệm 22/12': ['Dự thảo kế hoạch', 'Phân công lực lượng', 'Xin ý kiến chỉ huy'],
    'Chuẩn bị hội thi "Tiểu đội mạnh"': ['Thể lệ hội thi', 'Ban giám khảo', 'Phần thưởng'],
  };
  for (const t of T) {
    const [title, category, priority, off, who, status, doneOff] = t;
    const id = tasks.createTask(db, {
      title, category, priority, due_date: addDays(t0, off), assignee_ids: who.map((i) => ids[i]),
      description: 'Công việc thuộc dữ liệu thử (hư cấu).', checklist: checklists[title],
    }, mgrId);
    const route = { dang_lam: ['dang_lam'], cho_duyet: ['dang_lam', 'cho_duyet'], hoan_thanh: ['dang_lam', 'cho_duyet', 'hoan_thanh'] }[status] || [];
    const doneDay = doneOff === undefined ? t0 : addDays(t0, doneOff);
    for (const s of route) {
      const actor = s === 'hoan_thanh' ? mgr : asMember(who[0]);
      tasks.changeStatus(db, id, s, actor, undefined, doneDay);
    }
  }
  const first = db.prepare("SELECT id FROM tasks WHERE title LIKE 'Xây dựng kế hoạch%'").get();
  if (first) {
    tasks.addComment(db, first.id, mgr, 'Đồng chí An ưu tiên hoàn thành bản dự thảo trước thứ Sáu.');
    const item = db.prepare('SELECT id FROM checklist_items WHERE task_id = ? ORDER BY position LIMIT 1').get(first.id);
    if (item) tasks.toggleChecklistItem(db, item.id, mgr);
  }

  // Việc định kỳ: sinh việc báo cáo hằng tuần
  recurring.createRule(db, {
    title: 'Báo cáo nhanh tình hình đơn vị hằng tuần', category: 'cong_tac_dang', priority: 'thuong',
    assignee_ids: [ids[0], ids[3]], frequency: 'tuan', day_value: weekday(addDays(t0, 3)), lead_days: 2,
  }, mgrId);

  // Sự kiện trong tháng hiện tại
  const month = t0.slice(0, 8);
  const lastDay = new Date(Date.UTC(Number(t0.slice(0, 4)), Number(t0.slice(5, 7)), 0)).getUTCDate();
  const inMonth = (d) => (d.startsWith(month) ? d : `${month}${String(Math.min(lastDay, Math.max(1, Number(t0.slice(8)) + 1))).padStart(2, '0')}`);
  const ev = [
    ['Sinh hoạt chi bộ định kỳ', 'sinh_hoat_chi_bo', addDays(t0, 2)],
    ['Học tập nghị quyết mới', 'hoc_chinh_tri', addDays(t0, 5)],
    ['Hội nghị tổng kết công tác tháng', 'hoi_nghi', `${month}${String(lastDay).padStart(2, '0')}`],
    ['Ngày hội truyền thống đơn vị', 'ngay_le', addDays(t0, -3)],
  ];
  for (const [title, type, d] of ev) {
    events.createEvent(db, { title, type, start_date: inMonth(d), end_date: inMonth(d) }, mgrId);
  }
  seedSoldiers(db, { t0, mgrId, ids, units, admin });
  log(`Đã tạo dữ liệu thử: ${db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c} công việc.`);
  return { password: PASSWORD, accounts: ['admin', 'ctv', ...MEMBERS.map((m) => m[0])] };
}

function seedSoldiers(db, { t0, mgrId, ids, units, admin }) {
  const mo = (n) => addDays(addMonths(t0, -Math.floor(n)), -Math.round((n % 1) * 30));
  const yr = (n) => addMonths(t0, -12 * n);
  const make = (p, userId, i) => {
    const [name, rank, position, u, enlist, rankM, youthY, partyM, officialM] = p;
    return soldiers.createSoldier(db, {
      full_name: name, gender: 'nam', rank, position, unit_id: units[u],
      birth_date: addMonths(t0, -12 * (19 + (i % 5))), enlist_date: mo(enlist), rank_date: mo(rankM),
      youth_join_date: youthY ? yr(Math.min(youthY, 6)) : null,
      party_join_date: partyM ? mo(partyM) : null,
      party_official_date: officialM ? mo(officialM) : null,
      hometown: ['Nam Định', 'Thái Bình', 'Nghệ An', 'Hà Tĩnh', 'Bắc Giang'][i % 5],
      ethnicity: 'Kinh', education: '12/12', phone: `09000000${String(i).padStart(2, '0')}`,
      user_id: userId,
    }, admin.id);
  };
  // ctv
  const ctvSid = soldiers.createSoldier(db, {
    full_name: 'Trần Quang Huy', gender: 'nam', rank: 'Thiếu úy', position: 'Chính trị viên phó đại đội', unit_id: units[0],
    birth_date: addMonths(t0, -12 * 27), enlist_date: addMonths(t0, -12 * 6), rank_date: addMonths(t0, -12 * 2),
    party_join_date: addMonths(t0, -12 * 5), party_official_date: addMonths(t0, -12 * 4), hometown: 'Hải Dương',
    ethnicity: 'Kinh', education: 'Đại học', user_id: mgrId,
  }, admin.id);
  const sid = PROFILES.map((p, i) => make(p, ids[i], i));
  EXTRA.forEach((e, i) => make([e[0], e[1], e[2], e[3], e[4], e[5], 5 - (i % 3), null, null], null, i + 20));

  const A = admin.id;
  // Gia đình (hardship_note là dữ liệu nhạy cảm)
  items.addItem(db, 'family', sid[0], { relation: 'Bố', full_name: 'Nguyễn Văn Bình', birth_year: '1968', job: 'Làm nông', address: 'Nam Định' }, A);
  items.addItem(db, 'family', sid[0], { relation: 'Mẹ', full_name: 'Phạm Thị Hoa', birth_year: '1970', job: 'Làm nông', address: 'Nam Định' }, A);
  items.addItem(db, 'family', sid[2], { relation: 'Mẹ', full_name: 'Lê Thị Mai', birth_year: '1972', job: 'Buôn bán nhỏ', address: 'Nghệ An', hardship_note: 'HOÀN CẢNH KHÓ KHĂN THỬ: bố mất sớm, mẹ nuôi hai con' }, A);
  items.addItem(db, 'family', sid[5], { relation: 'Bố', full_name: 'Vũ Hữu Tài', birth_year: '1975', job: 'Công nhân', address: 'Bắc Giang' }, A);
  // Quá trình công tác
  items.addItem(db, 'career', sid[0], { from_date: mo(20), to_date: mo(12), position: 'Chiến sĩ', unit_text: 'Trung đội 1' }, A);
  items.addItem(db, 'career', sid[0], { from_date: mo(12), position: 'Tiểu đội trưởng', unit_text: 'Trung đội 1' }, A);
  items.addItem(db, 'career', sid[3], { from_date: mo(30), to_date: mo(14), position: 'Chiến sĩ', unit_text: 'Trung đội 2' }, A);
  // Khen thưởng, kỷ luật
  items.addItem(db, 'award', sid[0], { kind: 'khen_thuong', date: mo(5), form: 'Giấy khen', reason: 'Hoàn thành xuất sắc nhiệm vụ huấn luyện', decision_no: '12/QĐ-TĐ' }, A);
  items.addItem(db, 'award', sid[3], { kind: 'khen_thuong', date: mo(8), form: 'Chiến sĩ thi đua', reason: 'Dẫn đầu phong trào thi đua quý', decision_no: '07/QĐ-TĐ' }, A);
  items.addItem(db, 'award', sid[6], { kind: 'ky_luat', date: mo(2), form: 'Khiển trách', reason: 'Vi phạm giờ giấc sinh hoạt', decision_no: '03/QĐ-KL' }, A);
  // Nghỉ phép (một người đang nghỉ hôm nay)
  items.addItem(db, 'leave', sid[1], { kind: 'phep', from_date: addDays(t0, -2), to_date: addDays(t0, 3), destination: 'Thái Bình', note: 'Phép năm' }, A);
  items.addItem(db, 'leave', sid[4], { kind: 'tranh_thu', from_date: addDays(t0, -40), to_date: addDays(t0, -38), destination: 'Hà Nội' }, A);
  items.addItem(db, 'leave', sid[8], { kind: 'phep', from_date: addDays(t0, 10), to_date: addDays(t0, 17), destination: 'Nghệ An', note: 'Phép năm' }, A);
  // Tư tưởng (nhạy cảm; mục mới nhất mức "Cần quan tâm")
  items.addItem(db, 'thought', sid[2], { date: addDays(t0, -40), content: 'Ổn định, hoàn thành nhiệm vụ.', level: 'binh_thuong' }, A);
  items.addItem(db, 'thought', sid[2], { date: addDays(t0, -3), content: 'TƯ TƯỞNG THỬ: lo lắng chuyện gia đình, cần trò chuyện thêm.', level: 'can_quan_tam', measures: 'Chính trị viên gặp trực tiếp, thăm hỏi gia đình.' }, A);
  items.addItem(db, 'thought', sid[6], { date: addDays(t0, -10), content: 'Chấp hành tốt sau khi được nhắc nhở.', level: 'binh_thuong' }, A);

  milestones.saveMilestoneSettings(db, {
    party_probation_months: 12, service_months: 24, reminder_days: 30,
    rank_intervals: { 'Binh nhì': 6, 'Binh nhất': 6, 'Hạ sĩ': 6, 'Trung sĩ': 6, 'Thượng sĩ': 6 },
  }, A);
  return { ctvSid };
}

module.exports = { fillDemo, PASSWORD };

if (require.main === module) {
  const dbPath = process.env.DB_PATH || require('node:path').join(__dirname, '..', 'data', 'data.db');
  const db = openDb(dbPath);
  try {
    const r = fillDemo(db, { force: process.argv.includes('--force'), log: console.log });
    console.log('\nTài khoản thử (mật khẩu chung: ' + r.password + '):');
    console.log('  admin  - Quản trị viên');
    console.log('  ctv    - Quản lý (Chính trị viên)');
    console.log('  cs01 … cs10 - Chiến sĩ');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
