const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./auth');

const CATEGORIES = "'cong_tac_dang','giao_duc_ct','thi_dua','dan_van','van_hoa','huan_luyen','hau_can','khac'";
const PRIORITIES = "'thuong','gap','hoa_toc'";
const STATUSES = "'chua_lam','dang_lam','cho_duyet','hoan_thanh'";

const MIGRATIONS = [
  `
  CREATE TABLE units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES units(id)
  );
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    rank TEXT,
    position TEXT,
    unit_id INTEGER REFERENCES units(id),
    role TEXT NOT NULL CHECK (role IN ('admin','manager','member')),
    party_status TEXT NOT NULL DEFAULT 'khong' CHECK (party_status IN ('dang_vien','du_bi','doan_vien','khong')),
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE task_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT CHECK (category IS NULL OR category IN (${CATEGORIES})),
    description TEXT,
    items_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE recurring_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'khac' CHECK (category IN (${CATEGORIES})),
    priority TEXT NOT NULL DEFAULT 'thuong' CHECK (priority IN (${PRIORITIES})),
    assignee_ids_json TEXT NOT NULL DEFAULT '[]',
    frequency TEXT NOT NULL CHECK (frequency IN ('tuan','thang')),
    day_value INTEGER NOT NULL,
    lead_days INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    last_generated TEXT
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'khac' CHECK (category IN (${CATEGORIES})),
    priority TEXT NOT NULL DEFAULT 'thuong' CHECK (priority IN (${PRIORITIES})),
    status TEXT NOT NULL DEFAULT 'chua_lam' CHECK (status IN (${STATUSES})),
    due_date TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    template_id INTEGER REFERENCES task_templates(id) ON DELETE SET NULL,
    recurring_id INTEGER REFERENCES recurring_rules(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);
  CREATE TABLE task_assignees (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (task_id, user_id)
  );
  CREATE INDEX idx_task_assignees_user ON task_assignees(user_id);
  CREATE TABLE checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT,
    type TEXT,
    created_by INTEGER REFERENCES users(id)
  );
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  `
  CREATE TABLE soldiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    birth_date TEXT,
    gender TEXT CHECK (gender IS NULL OR gender IN ('nam','nu')),
    hometown TEXT,
    residence TEXT,
    ethnicity TEXT,
    religion TEXT,
    education TEXT,
    specialty TEXT,
    rank TEXT,
    rank_date TEXT,
    position TEXT,
    unit_id INTEGER REFERENCES units(id),
    enlist_date TEXT,
    discharge_date TEXT,
    youth_join_date TEXT,
    party_join_date TEXT,
    party_official_date TEXT,
    health_class TEXT,
    blood_type TEXT,
    phone TEXT,
    status TEXT NOT NULL DEFAULT 'dang_cong_tac' CHECK (status IN ('dang_cong_tac','da_ra_quan','chuyen_don_vi')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_soldiers_unit ON soldiers(unit_id);
  CREATE TABLE soldier_family (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    soldier_id INTEGER NOT NULL REFERENCES soldiers(id) ON DELETE CASCADE,
    relation TEXT,
    full_name TEXT,
    birth_year TEXT,
    job TEXT,
    address TEXT,
    hardship_note TEXT
  );
  CREATE INDEX idx_soldier_family_soldier ON soldier_family(soldier_id);
  CREATE TABLE soldier_career (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    soldier_id INTEGER NOT NULL REFERENCES soldiers(id) ON DELETE CASCADE,
    from_date TEXT,
    to_date TEXT,
    position TEXT,
    unit_text TEXT
  );
  CREATE INDEX idx_soldier_career_soldier ON soldier_career(soldier_id);
  CREATE TABLE soldier_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    soldier_id INTEGER NOT NULL REFERENCES soldiers(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('khen_thuong','ky_luat')),
    date TEXT,
    form TEXT,
    reason TEXT,
    decision_no TEXT
  );
  CREATE INDEX idx_soldier_awards_soldier ON soldier_awards(soldier_id);
  CREATE TABLE soldier_leaves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    soldier_id INTEGER NOT NULL REFERENCES soldiers(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('phep','tranh_thu')),
    from_date TEXT,
    to_date TEXT,
    destination TEXT,
    note TEXT
  );
  CREATE INDEX idx_soldier_leaves_soldier ON soldier_leaves(soldier_id, from_date);
  CREATE TABLE soldier_thoughts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    soldier_id INTEGER NOT NULL REFERENCES soldiers(id) ON DELETE CASCADE,
    date TEXT,
    content TEXT,
    level TEXT NOT NULL DEFAULT 'binh_thuong' CHECK (level IN ('binh_thuong','can_quan_tam','dac_biet')),
    measures TEXT,
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX idx_soldier_thoughts_soldier ON soldier_thoughts(soldier_id, date);
  CREATE TABLE import_drafts (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    payload TEXT,
    expires_at INTEGER
  );
  `,
  `
  CREATE TABLE doc_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'khac' CHECK (category IN ('ke_hoach','bao_cao','dang','danh_sach','khac')),
    mode TEXT NOT NULL DEFAULT 'chung' CHECK (mode IN ('chung','tung_nguoi','danh_sach')),
    file BLOB NOT NULL,
    manual_fields TEXT NOT NULL DEFAULT '[]',
    builtin_key TEXT UNIQUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE user_totp (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_enc TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
    recovery_hashes TEXT NOT NULL DEFAULT '[]',
    last_step INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE sessions ADD COLUMN mfa_pending TEXT CHECK (mfa_pending IS NULL OR mfa_pending IN ('setup','verify'));
  ALTER TABLE sessions ADD COLUMN mfa_deadline INTEGER;
  ALTER TABLE sessions ADD COLUMN mfa_fails INTEGER NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE sessions ADD COLUMN mfa_secret_enc TEXT;
  ALTER TABLE user_totp ADD COLUMN fails INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE user_totp ADD COLUMN locked_until INTEGER;
  DELETE FROM user_totp WHERE enabled = 0;
  `,
];

// Migration đánh số phiên bản; schema_version giữ một dòng cho mỗi phiên bản đã áp dụng.
function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  const current = row && row.v ? row.v : 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}

const SEED_TEMPLATES = [
  {
    name: 'Tổ chức kỷ niệm ngày thành lập QĐND 22/12',
    category: 'giao_duc_ct',
    description: 'Tổ chức các hoạt động kỷ niệm ngày thành lập Quân đội nhân dân Việt Nam 22/12.',
    items: [
      'Xây dựng kế hoạch', 'Phân công lực lượng', 'Chuẩn bị hội trường, khánh tiết',
      'Nội dung tọa đàm/nói chuyện truyền thống', 'Văn nghệ', 'Thể thao', 'Tin bài truyền thanh', 'Tổng hợp báo cáo',
    ],
  },
  {
    name: 'Sinh hoạt chi bộ thường kỳ',
    category: 'cong_tac_dang',
    description: 'Chuẩn bị và tiến hành sinh hoạt chi bộ thường kỳ.',
    items: ['Dự thảo nghị quyết', 'Báo cáo kết quả tháng', 'Chuẩn bị điều hành', 'Hoàn thiện biên bản'],
  },
];

function seedTemplates(db) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM task_templates').get();
  if (c > 0) return;
  const ins = db.prepare('INSERT INTO task_templates (name, category, description, items_json) VALUES (?, ?, ?, ?)');
  for (const t of SEED_TEMPLATES) ins.run(t.name, t.category, t.description, JSON.stringify(t.items));
}

function seed(db) {
  seedTemplates(db);
  // Nạp trễ để tránh vòng phụ thuộc db ↔ services.
  require('./services/docTemplates').seedBuiltins(db);
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (c > 0) return;
  db.exec('BEGIN');
  try {
    const unit = db.prepare('INSERT INTO units (name) VALUES (?)').run('Đại đội 1');
    db.prepare(
      `INSERT INTO users (username, password_hash, full_name, unit_id, role, must_change_password)
       VALUES ('admin', ?, 'Quản trị viên', ?, 'admin', 1)`
    ).run(hashPassword('admin123'), Number(unit.lastInsertRowid));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDb, migrate, seed };
