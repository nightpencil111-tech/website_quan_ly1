const crypto = require('node:crypto');
const { hashPassword } = require('../auth');
const audit = require('./audit');
const { AppError } = require('../util/errors');

const ROLES = ['admin', 'manager', 'member'];
const PARTY = { dang_vien: 'Đảng viên', du_bi: 'Đảng viên dự bị', doan_vien: 'Đoàn viên', khong: 'Quần chúng' };
const LAST_ADMIN_MSG = 'Phải còn ít nhất một chỉ huy (Admin) hoạt động';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function tempPassword() {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

function listUsers(db, { includeInactive = false } = {}) {
  return db.prepare(
    `SELECT u.id, u.username, u.full_name, u.rank, u.position, u.unit_id, u.role, u.party_status,
            u.phone, u.active, u.must_change_password, un.name AS unit_name,
            (SELECT COUNT(*) FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
              WHERE ta.user_id = u.id AND t.status != 'hoan_thanh') AS open_tasks
       FROM users u LEFT JOIN units un ON un.id = u.unit_id
      ${includeInactive ? '' : 'WHERE u.active = 1'}
      ORDER BY u.active DESC, u.full_name COLLATE NOCASE`
  ).all();
}

function getUser(db, id) {
  return db.prepare(
    `SELECT u.id, u.username, u.full_name, u.rank, u.position, u.unit_id, u.role, u.party_status,
            u.phone, u.active, u.must_change_password
       FROM users u WHERE u.id = ?`
  ).get(id);
}

function clean(data) {
  const t = (v) => (v === undefined || v === null ? '' : String(v).trim());
  const d = {
    username: t(data.username),
    full_name: t(data.full_name),
    rank: t(data.rank) || null,
    position: t(data.position) || null,
    unit_id: data.unit_id === '' || data.unit_id == null ? null : Number(data.unit_id),
    role: t(data.role) || 'member',
    party_status: t(data.party_status) || 'khong',
    phone: t(data.phone) || null,
  };
  if (!d.full_name) throw new AppError('Họ tên không được để trống');
  if (!ROLES.includes(d.role)) throw new AppError('Vai trò không hợp lệ');
  if (!PARTY[d.party_status]) throw new AppError('Diện Đảng/Đoàn không hợp lệ');
  if (d.unit_id !== null && !Number.isInteger(d.unit_id)) throw new AppError('Đơn vị không hợp lệ');
  return d;
}

function checkUnit(db, unitId) {
  if (unitId !== null && !db.prepare('SELECT 1 FROM units WHERE id = ?').get(unitId)) {
    throw new AppError('Đơn vị không tồn tại');
  }
}

function activeAdminCount(db, exceptId) {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(exceptId).c;
}

function createUser(db, data, actorId) {
  const d = clean(data);
  if (!d.username) throw new AppError('Tên đăng nhập không được để trống');
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(d.username)) {
    throw new AppError('Tên đăng nhập gồm 3–32 ký tự chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang');
  }
  checkUnit(db, d.unit_id);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(d.username)) {
    throw new AppError('Tên đăng nhập đã tồn tại');
  }
  const pw = tempPassword();
  const r = db.prepare(
    `INSERT INTO users (username, password_hash, full_name, rank, position, unit_id, role, party_status, phone, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(d.username, hashPassword(pw), d.full_name, d.rank, d.position, d.unit_id, d.role, d.party_status, d.phone);
  const id = Number(r.lastInsertRowid);
  audit.log(db, actorId, 'user_create', d.username, `Tạo tài khoản ${d.full_name} (${d.role})`);
  return { id, tempPassword: pw };
}

function updateUser(db, id, data, actorId) {
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw new AppError('Không tìm thấy tài khoản');
  const d = clean({ ...data, username: cur.username });
  checkUnit(db, d.unit_id);
  if (id === actorId && d.role !== cur.role) throw new AppError('Đồng chí không thể tự thay đổi vai trò của mình');
  if (cur.role === 'admin' && cur.active && d.role !== 'admin' && activeAdminCount(db, id) === 0) {
    throw new AppError(LAST_ADMIN_MSG);
  }
  db.prepare(
    `UPDATE users SET full_name = ?, rank = ?, position = ?, unit_id = ?, role = ?, party_status = ?, phone = ? WHERE id = ?`
  ).run(d.full_name, d.rank, d.position, d.unit_id, d.role, d.party_status, d.phone, id);
  audit.log(db, actorId, 'user_update', cur.username, `Sửa tài khoản ${d.full_name} (${d.role})`);
}

function setActive(db, id, active, actorId) {
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw new AppError('Không tìm thấy tài khoản');
  const a = active ? 1 : 0;
  if (!a) {
    if (id === actorId) throw new AppError('Đồng chí không thể tự khóa tài khoản của mình');
    if (cur.role === 'admin' && cur.active && activeAdminCount(db, id) === 0) throw new AppError(LAST_ADMIN_MSG);
  }
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(a, id);
  if (!a) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  audit.log(db, actorId, a ? 'user_unlock' : 'user_lock', cur.username, a ? 'Mở khóa tài khoản' : 'Khóa tài khoản');
}

function resetPassword(db, id, actorId) {
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!cur) throw new AppError('Không tìm thấy tài khoản');
  const pw = tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?')
    .run(hashPassword(pw), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  audit.log(db, actorId, 'user_reset_password', cur.username, 'Đặt lại mật khẩu');
  return pw;
}

// ---- Đơn vị ----
function listUnits(db) {
  return db.prepare(
    `SELECT un.*, (SELECT COUNT(*) FROM users u WHERE u.unit_id = un.id) AS member_count
       FROM units un ORDER BY un.name COLLATE NOCASE`
  ).all();
}

function unitName(name) {
  const n = String(name ?? '').trim();
  if (!n) throw new AppError('Tên đơn vị không được để trống');
  return n;
}

function createUnit(db, name, actorId) {
  const n = unitName(name);
  const r = db.prepare('INSERT INTO units (name) VALUES (?)').run(n);
  audit.log(db, actorId, 'unit_create', n, 'Tạo đơn vị');
  return Number(r.lastInsertRowid);
}

function updateUnit(db, id, name, actorId) {
  const n = unitName(name);
  const cur = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!cur) throw new AppError('Không tìm thấy đơn vị');
  db.prepare('UPDATE units SET name = ? WHERE id = ?').run(n, id);
  audit.log(db, actorId, 'unit_update', n, `Đổi tên từ "${cur.name}"`);
}

function deleteUnit(db, id, actorId) {
  const cur = db.prepare('SELECT * FROM units WHERE id = ?').get(id);
  if (!cur) throw new AppError('Không tìm thấy đơn vị');
  if (db.prepare('SELECT 1 FROM users WHERE unit_id = ?').get(id)) {
    throw new AppError('Đơn vị đang có người, đồng chí chuyển người sang đơn vị khác trước khi xóa');
  }
  if (db.prepare('SELECT 1 FROM units WHERE parent_id = ?').get(id)) {
    throw new AppError('Đơn vị đang có đơn vị trực thuộc, không thể xóa');
  }
  db.prepare('DELETE FROM units WHERE id = ?').run(id);
  audit.log(db, actorId, 'unit_delete', cur.name, 'Xóa đơn vị');
}

// ---- Cài đặt ----
function getSetting(db, key, def) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r && r.value !== null ? r.value : def;
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function getOverloadThreshold(db) {
  const n = Number(getSetting(db, 'overload_threshold', 5));
  return Number.isInteger(n) && n >= 1 ? n : 5;
}

module.exports = {
  PARTY, ROLES, listUsers, getUser, createUser, updateUser, setActive, resetPassword,
  listUnits, createUnit, updateUnit, deleteUnit, getSetting, setSetting, getOverloadThreshold,
};
