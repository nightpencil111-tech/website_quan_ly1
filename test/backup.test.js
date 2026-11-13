const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openDb, seed } = require('../src/db');
const { backup } = require('../scripts/backup');

function setup(withKey = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-ctv-bk-'));
  const dbPath = path.join(root, 'data', 'data.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  seed(db);
  if (withKey) fs.writeFileSync(path.join(root, 'data', 'secret.key'), Buffer.alloc(32, 7));
  return { root, dbPath, db, dir: path.join(root, 'backups') };
}

test('backup: tên tệp theo giờ Việt Nam, mở được, có bảng users, kèm secret.key', () => {
  const t = setup();
  try {
    // 18:05 UTC ngày 12 = 01:05 ngày 13 giờ Việt Nam
    const p = backup({ dbPath: t.dbPath, dir: t.dir, now: new Date('2026-11-12T18:05:00Z') });
    assert.equal(path.basename(p), 'saoluu-2026-11-13-0105.db');
    const b = new DatabaseSync(p);
    assert.ok(b.prepare("SELECT name FROM sqlite_master WHERE name='users'").get());
    assert.ok(b.prepare('SELECT COUNT(*) c FROM users').get().c >= 1);
    b.close();
    const k = path.join(t.dir, 'saoluu-2026-11-13-0105.key');
    assert.deepEqual(fs.readFileSync(k), Buffer.alloc(32, 7));
  } finally { t.db.close(); }
});

test('backup: không có secret.key thì chỉ tạo tệp .db', () => {
  const t = setup(false);
  try {
    backup({ dbPath: t.dbPath, dir: t.dir, now: new Date('2026-01-01T00:00:00Z') });
    assert.deepEqual(fs.readdirSync(t.dir), ['saoluu-2026-01-01-0700.db']);
  } finally { t.db.close(); }
});

test('backup: 35 lần chỉ giữ 30 bản mới nhất (cả .db lẫn .key)', () => {
  const t = setup();
  try {
    for (let i = 0; i < 35; i++) {
      backup({ dbPath: t.dbPath, dir: t.dir, now: new Date(Date.UTC(2026, 0, 1, 0, i)) });
    }
    const files = fs.readdirSync(t.dir).sort();
    assert.equal(files.filter((f) => f.endsWith('.db')).length, 30);
    assert.equal(files.filter((f) => f.endsWith('.key')).length, 30);
    assert.ok(!files.includes('saoluu-2026-01-01-0700.db'));
    assert.ok(!files.includes('saoluu-2026-01-01-0704.key'));
    assert.ok(files.includes('saoluu-2026-01-01-0705.db'));
    assert.ok(files.includes('saoluu-2026-01-01-0734.db'));
  } finally { t.db.close(); }
});

test('backup: thư mục chưa có thì được tạo; tệp lạ không bị xóa', () => {
  const t = setup();
  try {
    const dir = path.join(t.root, 'a', 'b');
    backup({ dbPath: t.dbPath, dir, keep: 1, now: new Date('2026-01-01T00:00:00Z') });
    fs.writeFileSync(path.join(dir, 'ghichu.txt'), 'x');
    backup({ dbPath: t.dbPath, dir, keep: 1, now: new Date('2026-01-02T00:00:00Z') });
    assert.deepEqual(fs.readdirSync(dir).sort(), ['ghichu.txt', 'saoluu-2026-01-02-0700.db', 'saoluu-2026-01-02-0700.key']);
  } finally { t.db.close(); }
});

test('backup: CSDL không tồn tại -> lỗi tiếng Việt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-ctv-bk-'));
  assert.throws(() => backup({ dbPath: path.join(root, 'khong.db'), dir: path.join(root, 'b') }), /Không tìm thấy/);
  assert.ok(!fs.existsSync(path.join(root, 'khong.db')));
});

test('backup CLI: thành công in đường dẫn; lỗi thoát mã 1', () => {
  const t = setup();
  try {
    const script = path.join(__dirname, '..', 'scripts', 'backup.js');
    const env = { ...process.env, DB_PATH: t.dbPath, QLCTV_BACKUP_DIR: t.dir };
    const ok = spawnSync(process.execPath, ['--no-warnings=ExperimentalWarning', script], { env, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Đã sao lưu/);
    assert.match(ok.stdout, /saoluu-\d{4}-\d{2}-\d{2}-\d{4}\.db/);
    const bad = spawnSync(process.execPath, ['--no-warnings=ExperimentalWarning', script],
      { env: { ...env, DB_PATH: path.join(t.root, 'khong.db') }, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Không tìm thấy/);
  } finally { t.db.close(); }
});
