// Dữ liệu thử (toàn bộ hư cấu): npm run demo
// Dùng DB_PATH (mặc định data/data.db). Từ chối chạy nếu DB đã có công việc, trừ khi có --force.
const { openDb, seed } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { today, addDays, weekday } = require('../src/util/date');
const users = require('../src/services/users');
const tasks = require('../src/services/tasks');
const events = require('../src/services/events');
const recurring = require('../src/services/recurring');

const PASSWORD = 'Demo@1234';

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
  const existing = db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c;
  if (existing > 0 && !force) {
    throw new Error('CSDL đã có công việc. Dùng --force nếu đồng chí chắc chắn muốn thêm dữ liệu thử.');
  }
  const t0 = today();
  const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(PASSWORD), admin.id);

  const unitIds = ['Trung đội 1', 'Trung đội 2', 'Trung đội 3'].map((n) => users.createUnit(db, n, admin.id));
  const unitId = (x) => (typeof x === 'object' && x !== null ? x.id : x);
  const units = unitIds.map(unitId);
  if (units.some((x) => !Number.isInteger(Number(x)))) {
    throw new Error('Không tạo được đơn vị');
  }

  const mgrId = insertUser(db, {
    username: 'ctv', full_name: 'Trần Quang Huy', rank: 'Thiếu úy', position: 'Chính trị viên phó đại đội',
    unit_id: Number(units[0]), role: 'manager', party_status: 'dang_vien',
  });
  const ids = MEMBERS.map((m) => insertUser(db, {
    username: m[0], full_name: m[1], rank: m[2], position: m[3], unit_id: Number(units[m[4]]), role: 'member', party_status: m[5],
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
  log(`Đã tạo dữ liệu thử: ${db.prepare('SELECT COUNT(*) AS c FROM tasks').get().c} công việc.`);
  return { password: PASSWORD, accounts: ['admin', 'ctv', ...MEMBERS.map((m) => m[0])] };
}

module.exports = { fillDemo, PASSWORD };

if (require.main === module) {
  const dbPath = process.env.DB_PATH || 'data/data.db';
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
