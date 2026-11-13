const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = 'quanly.config.json';
const MODES = ['noi_bo', 'internet'];

// Chuẩn hóa cấu hình chạy: điền giá trị mặc định, kiểm tra chế độ.
function normalizeConfig(c = {}) {
  const mode = c.mode === undefined || c.mode === null || c.mode === '' ? 'noi_bo' : String(c.mode);
  if (!MODES.includes(mode)) {
    throw new Error(`Chế độ chạy "${mode}" không hợp lệ, chỉ nhận "noi_bo" (mạng nội bộ) hoặc "internet"`);
  }
  const port = Number(c.port) || 3000;
  return {
    mode,
    port,
    publicUrl: typeof c.publicUrl === 'string' ? c.publicUrl.trim() : '',
    listenLan: c.listenLan === true,
  };
}

// Thứ tự ưu tiên: biến môi trường (QLCTV_MODE, PORT, QLCTV_PUBLIC_URL) > tệp quanly.config.json > mặc định.
function loadConfig(env = process.env, appDir = path.join(__dirname, '..')) {
  const file = path.join(appDir, CONFIG_FILE);
  let fromFile = {};
  let raw = null;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Không đọc được tệp cấu hình ${CONFIG_FILE}: ${e.message}`);
  }
  if (raw !== null) {
    try {
      fromFile = JSON.parse(raw.replace(/^﻿/, ''));
    } catch (e) {
      throw new Error(`Tệp cấu hình ${CONFIG_FILE} không đúng định dạng JSON (${e.message}). Đồng chí kiểm tra lại dấu ngoặc, dấu phẩy, dấu nháy kép.`);
    }
    if (!fromFile || typeof fromFile !== 'object' || Array.isArray(fromFile)) {
      throw new Error(`Tệp cấu hình ${CONFIG_FILE} phải là một đối tượng JSON, ví dụ { "mode": "internet" }`);
    }
  }
  const merged = { ...fromFile };
  if (env.QLCTV_MODE) merged.mode = env.QLCTV_MODE;
  if (env.PORT) merged.port = env.PORT;
  if (env.QLCTV_PUBLIC_URL) merged.publicUrl = env.QLCTV_PUBLIC_URL;
  return normalizeConfig(merged);
}

module.exports = { loadConfig, normalizeConfig, CONFIG_FILE };
