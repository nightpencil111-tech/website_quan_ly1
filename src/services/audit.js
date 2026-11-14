// Nhật ký hoạt động. opts.ip: địa chỉ IP của người gửi yêu cầu (đăng nhập, xác thực 2 lớp...).
function log(db, userId, action, target, detail, opts = {}) {
  const ip = opts && opts.ip ? String(opts.ip).slice(0, 64) : null;
  db.prepare('INSERT INTO audit_log (user_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
    .run(userId ?? null, action, target ?? null, detail ?? null, ip);
}

function list(db, { limit = 50, offset = 0 } = {}) {
  return db.prepare(
    `SELECT a.*, u.full_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
}

function count(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
}

module.exports = { log, list, count };
