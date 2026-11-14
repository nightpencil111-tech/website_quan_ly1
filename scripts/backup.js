// Sao lưu CSDL: VACUUM INTO (an toàn khi máy chủ đang chạy) + chép secret.key (khóa giải mã 2 lớp).
// Dùng: node scripts/backup.js   (DB_PATH, QLCTV_BACKUP_DIR hoặc "backupDir" trong quanly.config.json)
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { today } = require('../src/util/date');
const { stripSessions } = require('../src/db');

const APP_DIR = path.join(__dirname, '..');
const NAME_RE = /^saoluu-\d{4}-\d{2}-\d{2}-\d{4}\.db$/;

// 'YYYY-MM-DD-HHmm' theo giờ Việt Nam (UTC+7), không phụ thuộc múi giờ máy.
function stamp(now) {
  const vn = new Date(now.getTime() + 7 * 3600 * 1000).toISOString();
  return `${today(now)}-${vn.slice(11, 13)}${vn.slice(14, 16)}`;
}

function backup({ dbPath, dir, keep = 30, now = new Date() }) {
  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(`Không tìm thấy tệp dữ liệu để sao lưu: ${dbPath}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const base = `saoluu-${stamp(now)}`;
  const out = path.join(dir, `${base}.db`);
  if (fs.existsSync(out)) fs.rmSync(out);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  try {
    stripSessions(out);
  } catch (e) {
    fs.rmSync(out, { force: true });
    throw e;
  }
  const keySrc = path.join(path.dirname(dbPath), 'secret.key');
  if (fs.existsSync(keySrc)) fs.copyFileSync(keySrc, path.join(dir, `${base}.key`));
  // Giữ `keep` bản mới nhất (tên có giờ nên sắp theo tên là sắp theo thời gian).
  const snaps = fs.readdirSync(dir).filter((f) => NAME_RE.test(f)).sort();
  for (const f of snaps.slice(0, Math.max(0, snaps.length - keep))) {
    fs.rmSync(path.join(dir, f), { force: true });
    fs.rmSync(path.join(dir, f.replace(/\.db$/, '.key')), { force: true });
  }
  return out;
}

function resolveBackupDir(env = process.env, appDir = APP_DIR) {
  if (env.QLCTV_BACKUP_DIR) return path.resolve(env.QLCTV_BACKUP_DIR);
  try {
    const c = JSON.parse(fs.readFileSync(path.join(appDir, 'quanly.config.json'), 'utf8').replace(/^﻿/, ''));
    if (c && typeof c.backupDir === 'string' && c.backupDir.trim()) return path.resolve(appDir, c.backupDir.trim());
  } catch { /* không có / hỏng cấu hình: dùng mặc định */ }
  return path.join(appDir, 'backups');
}

module.exports = { backup, resolveBackupDir };

if (require.main === module) {
  try {
    const dbPath = process.env.DB_PATH || path.join(APP_DIR, 'data', 'data.db');
    const out = backup({ dbPath, dir: resolveBackupDir() });
    console.log(`Đã sao lưu: ${out}`);
    if (fs.existsSync(out.replace(/\.db$/, '.key'))) console.log('Đã kèm khóa 2 lớp (secret.key) - cần giữ cùng bản sao lưu khi khôi phục.');
  } catch (e) {
    console.error('Sao lưu thất bại: ' + e.message);
    process.exit(1);
  }
}
