const { AppError } = require('../util/errors');
const { fold } = require('../util/text');
const { RANKS, SOLDIER_LABELS } = require('../util/ranks');
const audit = require('./audit');
const { today, daysBetween } = require('../util/date');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_FIELDS = {
  birth_date: 'Ngày sinh', rank_date: 'Ngày nhận cấp bậc', enlist_date: 'Ngày nhập ngũ',
  discharge_date: 'Ngày xuất ngũ', youth_join_date: 'Ngày vào Đoàn',
  party_join_date: 'Ngày vào Đảng', party_official_date: 'Ngày chuyển Đảng chính thức',
};
const TEXT_FIELDS = [
  'hometown', 'residence', 'ethnicity', 'religion', 'education', 'specialty',
  'position', 'health_class', 'blood_type', 'phone', 'notes',
];
const FIELDS = ['full_name', 'gender', 'rank', 'unit_id', 'status', ...Object.keys(DATE_FIELDS), ...TEXT_FIELDS];

function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

// Chuẩn hóa + kiểm tra; trả về object đầy đủ các trường (rỗng → null).
function normalize(db, f) {
  const out = {};
  const full = String(f.full_name ?? '').trim();
  if (!full) throw new AppError('Họ và tên không được để trống');
  out.full_name = full;
  for (const [k, label] of Object.entries(DATE_FIELDS)) {
    const v = blank(f[k]) ? null : String(f[k]).trim();
    if (v !== null && !validDate(v)) throw new AppError(`${label} không hợp lệ`);
    out[k] = v;
  }
  if (out.party_official_date && !out.party_join_date) {
    throw new AppError('Có ngày chuyển Đảng chính thức thì phải có ngày vào Đảng');
  }
  if (out.party_official_date && out.party_official_date < out.party_join_date) {
    throw new AppError('Ngày chuyển Đảng chính thức không được trước ngày vào Đảng');
  }
  out.rank = blank(f.rank) ? null : String(f.rank).trim();
  if (out.rank !== null && !RANKS.includes(out.rank)) throw new AppError('Cấp bậc không hợp lệ');
  out.gender = blank(f.gender) ? null : String(f.gender);
  if (out.gender !== null && !Object.hasOwn(SOLDIER_LABELS.gender, out.gender)) throw new AppError('Giới tính không hợp lệ');
  out.status = blank(f.status) ? 'dang_cong_tac' : String(f.status);
  if (!Object.hasOwn(SOLDIER_LABELS.status, out.status)) throw new AppError('Trạng thái không hợp lệ');
  if (blank(f.unit_id)) out.unit_id = null;
  else {
    const uid = Number(f.unit_id);
    if (!Number.isInteger(uid) || !db.prepare('SELECT 1 FROM units WHERE id = ?').get(uid)) throw new AppError('Đơn vị không tồn tại');
    out.unit_id = uid;
  }
  for (const k of TEXT_FIELDS) out[k] = blank(f[k]) ? null : String(f[k]).trim();
  return out;
}

function partyState(s) {
  if (s.party_official_date) return 'dang_vien';
  if (s.party_join_date) return 'du_bi';
  if (s.youth_join_date) return 'doan_vien';
  return 'khong';
}

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function checkLink(db, soldierId, userId) {
  if (!Number.isInteger(userId)) throw new AppError('Tài khoản không tồn tại');
  const u = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!u) throw new AppError('Tài khoản không tồn tại');
  const other = db.prepare('SELECT id FROM soldiers WHERE user_id = ? AND id != ?').get(userId, soldierId ?? 0);
  if (other) throw new AppError('Tài khoản này đã liên kết với hồ sơ khác');
}

const SELECT = `SELECT s.*, un.name AS unit_name, u.username AS username
                  FROM soldiers s LEFT JOIN units un ON un.id = s.unit_id LEFT JOIN users u ON u.id = s.user_id`;

function decorate(s) {
  s.party_state = partyState(s);
  return s;
}

function createSoldier(db, data, actorId) {
  const f = normalize(db, data);
  const userId = blank(data.user_id) ? null : Number(data.user_id);
  return tx(db, () => {
    if (userId !== null) checkLink(db, null, userId);
    const cols = FIELDS.filter((k) => f[k] !== undefined);
    const id = Number(db.prepare(
      `INSERT INTO soldiers (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`
    ).run(userId, ...cols.map((k) => f[k])).lastInsertRowid);
    audit.log(db, actorId, 'soldier_create', `soldier:${id}`, f.full_name);
    return id;
  });
}

function updateSoldier(db, id, data, actorId) {
  const cur = db.prepare('SELECT * FROM soldiers WHERE id = ?').get(id);
  if (!cur) throw new AppError('Không tìm thấy hồ sơ');
  const f = normalize(db, { ...cur, ...data });
  tx(db, () => {
    db.prepare(
      `UPDATE soldiers SET ${FIELDS.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`
    ).run(...FIELDS.map((k) => f[k]), id);
    audit.log(db, actorId, 'soldier_update', `soldier:${id}`, f.full_name);
  });
}

function deleteSoldier(db, id, actorId) {
  const cur = db.prepare('SELECT full_name FROM soldiers WHERE id = ?').get(id);
  if (!cur) throw new AppError('Không tìm thấy hồ sơ');
  tx(db, () => {
    db.prepare('DELETE FROM soldiers WHERE id = ?').run(id);
    audit.log(db, actorId, 'soldier_delete', `soldier:${id}`, cur.full_name);
  });
}

function getSoldier(db, id) {
  const s = db.prepare(`${SELECT} WHERE s.id = ?`).get(id);
  return s ? decorate(s) : null;
}

function findByUser(db, userId) {
  const s = db.prepare(`${SELECT} WHERE s.user_id = ?`).get(userId);
  return s ? decorate(s) : null;
}

function listSoldiers(db, filters = {}) {
  const where = [];
  const args = [];
  if (filters.unit_id) { where.push('s.unit_id = ?'); args.push(Number(filters.unit_id)); }
  if (filters.rank) { where.push('s.rank = ?'); args.push(filters.rank); }
  if (filters.status) { where.push('s.status = ?'); args.push(filters.status); }
  const rows = db.prepare(
    `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(un.name, '') COLLATE NOCASE, s.full_name COLLATE NOCASE, s.id`
  ).all(...args);
  const q = filters.q ? fold(String(filters.q).trim()) : '';
  const out = [];
  for (const r of rows) {
    decorate(r);
    if (filters.party && r.party_state !== filters.party) continue;
    if (q && !fold(`${r.full_name} ${r.position ?? ''}`).includes(q)) continue;
    out.push(r);
  }
  return out;
}

function linkUser(db, soldierId, userId, actorId) {
  const cur = db.prepare('SELECT full_name FROM soldiers WHERE id = ?').get(soldierId);
  if (!cur) throw new AppError('Không tìm thấy hồ sơ');
  const uid = blank(userId) ? null : Number(userId);
  tx(db, () => {
    if (uid !== null) checkLink(db, soldierId, uid);
    db.prepare("UPDATE soldiers SET user_id = ?, updated_at = datetime('now') WHERE id = ?").run(uid, soldierId);
    audit.log(db, actorId, 'soldier_link', `soldier:${soldierId}`, uid === null ? 'Gỡ liên kết tài khoản' : `user:${uid}`);
  });
}

function listUnlinked(db) {
  return db.prepare(`${SELECT} WHERE s.user_id IS NULL ORDER BY s.full_name COLLATE NOCASE, s.id`).all().map(decorate);
}

// Số ngày phép năm (kind='phep', tính cả hai đầu) nằm trong năm của `now`.
function leaveDays(leaves, now) {
  const y = now.slice(0, 4);
  const lo = `${y}-01-01`;
  const hi = `${y}-12-31`;
  let total = 0;
  for (const l of leaves) {
    if (l.kind !== 'phep' || !l.from_date) continue;
    const from = l.from_date < lo ? lo : l.from_date;
    const toRaw = l.to_date || l.from_date;
    const to = toRaw > hi ? hi : toRaw;
    if (to < from) continue;
    total += daysBetween(from, to) + 1;
  }
  return total;
}

function getProfile(db, id, now = today()) {
  const soldier = getSoldier(db, id);
  if (!soldier) return null;
  const items = require('./soldierItems');
  const leaves = items.listItems(db, 'leave', id);
  return {
    soldier,
    family: items.listItems(db, 'family', id),
    career: items.listItems(db, 'career', id),
    awards: items.listItems(db, 'award', id),
    leaves,
    thoughts: items.listItems(db, 'thought', id),
    leaveDaysThisYear: leaveDays(leaves, now),
  };
}

// Bản sao cho tài khoản member: không có tư tưởng, không có ghi chú hoàn cảnh.
function redactForMember(profile) {
  const { thoughts, ...rest } = profile;
  return {
    ...rest,
    soldier: { ...profile.soldier },
    family: (profile.family || []).map(({ hardship_note, ...f }) => f),
  };
}

module.exports = {
  validDate, getProfile, redactForMember,
  createSoldier, updateSoldier, deleteSoldier, getSoldier, listSoldiers,
  findByUser, linkUser, listUnlinked, partyState,
};
