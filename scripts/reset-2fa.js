// Đặt lại xác thực 2 lớp cho một tài khoản, chạy NGAY TRÊN MÁY CHỦ (cần quyền truy cập tệp dữ liệu).
// Dùng khi quản trị viên mất cả điện thoại lẫn mã dự phòng. Không cần dừng máy chủ.
// Dùng: node scripts/reset-2fa.js <tên đăng nhập>      (DB_PATH để chỉ tệp dữ liệu khác data/data.db)
const fs = require('node:fs');
const path = require('node:path');
const audit = require('../src/services/audit');

const APP_DIR = path.join(__dirname, '..');

// Xóa bản 2 lớp, mọi phiên đăng nhập và khóa sai mật khẩu của tài khoản; ghi nhật ký totp_reset (chi tiết "CLI").
function reset2fa(db, username) {
  const name = String(username || '').trim();
  const user = name ? db.prepare('SELECT id, username FROM users WHERE username = ?').get(name) : null;
  if (!user) return { ok: false, message: `Không tìm thấy tài khoản "${name}".` };
  const had = !!db.prepare('SELECT 1 FROM user_totp WHERE user_id = ?').get(user.id);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM user_totp WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, fail_window_start = NULL WHERE id = ?').run(user.id);
    audit.log(db, null, 'totp_reset', user.username, 'CLI');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return {
    ok: true,
    message: `Đã đặt lại xác thực 2 lớp cho tài khoản "${user.username}"` +
      (had ? '' : ' (tài khoản này chưa bật 2 lớp)') +
      '. Đã đăng xuất mọi phiên và mở khóa đăng nhập. Lần đăng nhập tới, đồng chí sẽ được yêu cầu bật lại 2 lớp' +
      ' (chế độ Internet, tài khoản chỉ huy/quản trị).',
  };
}

module.exports = { reset2fa };

if (require.main === module) {
  const username = process.argv[2];
  if (!username) {
    console.error('Cách dùng: node scripts/reset-2fa.js <tên đăng nhập>   (ví dụ: node scripts/reset-2fa.js admin)');
    process.exit(1);
  }
  const dbPath = process.env.DB_PATH || path.join(APP_DIR, 'data', 'data.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Không tìm thấy tệp dữ liệu: ${dbPath}. Đồng chí chạy lệnh này trong thư mục ứng dụng trên máy chủ.`);
    process.exit(1);
  }
  let db;
  try {
    db = require('../src/db').openDb(dbPath);
    // Máy chủ có thể đang chạy và ghi CSDL: chờ tối đa 5 giây thay vì báo lỗi "database is locked".
    db.exec('PRAGMA busy_timeout = 5000');
    const r = reset2fa(db, username);
    if (!r.ok) {
      console.error(r.message);
      process.exitCode = 1;
    } else {
      console.log(r.message);
      console.log('Lưu ý: nếu tài khoản đang bị khóa tạm thời với một thiết bị (bộ nhớ của máy chủ), khóa đó tự hết sau 15 phút hoặc khi khởi động lại ứng dụng.');
    }
  } catch (e) {
    console.error('Đặt lại thất bại: ' + e.message);
    process.exitCode = 1;
  } finally {
    try { db && db.close(); } catch { /* bỏ qua */ }
  }
}
