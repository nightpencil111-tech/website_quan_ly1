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

function seed(db) {
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
