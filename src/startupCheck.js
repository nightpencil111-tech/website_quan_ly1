const { verifyPassword } = require('./auth');

const DEMO_PASSWORD = 'Demo@1234';
const DEMO_USERNAMES = ['ctv', ...Array.from({ length: 10 }, (_, i) => 'cs' + String(i + 1).padStart(2, '0'))];

// Các lý do không cho chạy ở chế độ Internet (rỗng = an toàn để chạy).
function startupProblems(db, config) {
  if (!config || config.mode !== 'internet') return [];
  const problems = [];
  const admin = db.prepare("SELECT must_change_password FROM users WHERE username = 'admin'").get();
  if (admin && admin.must_change_password) {
    problems.push('Tài khoản admin vẫn dùng mật khẩu ban đầu: đồng chí đăng nhập ở chế độ nội bộ và đổi mật khẩu admin trước khi bật chế độ Internet.');
  }
  const ph = DEMO_USERNAMES.map(() => '?').join(', ');
  const demo = db.prepare(`SELECT username, password_hash FROM users WHERE username IN (${ph}) ORDER BY username`).all(...DEMO_USERNAMES)
    .filter((u) => verifyPassword(DEMO_PASSWORD, u.password_hash))
    .map((u) => u.username);
  if (demo.length) {
    problems.push(`Còn tài khoản dữ liệu thử dùng mật khẩu ${DEMO_PASSWORD} (${demo.join(', ')}): đồng chí xóa dữ liệu thử hoặc đổi mật khẩu các tài khoản này trước khi bật chế độ Internet.`);
  }
  const url = typeof config.publicUrl === 'string' ? config.publicUrl.trim() : '';
  if (!/^https:\/\/\S+/i.test(url)) {
    problems.push('Chưa đặt publicUrl bắt đầu bằng https:// trong tệp quanly.config.json (địa chỉ Tailscale Funnel, vd. https://may.tailnet.ts.net).');
  }
  return problems;
}

module.exports = { startupProblems, DEMO_USERNAMES, DEMO_PASSWORD };
