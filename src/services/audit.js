// Nhật ký hoạt động. (Task 3 bổ sung hàm list.)
function log(db, userId, action, target, detail) {
  db.prepare('INSERT INTO audit_log (user_id, action, target, detail) VALUES (?, ?, ?, ?)')
    .run(userId ?? null, action, target ?? null, detail ?? null);
}

module.exports = { log };
