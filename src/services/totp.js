// Xác thực 2 lớp bằng mã trên điện thoại (TOTP, RFC 6238): SHA-1, 6 số, chu kỳ 30 giây.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PERIOD_MS = 30 * 1000;
const DIGITS = 6;
const WINDOW = 1; // chấp nhận lệch ±1 chu kỳ
const ISSUER = 'QuanLyCTV';
const KEY_FILE = 'secret.key';

// ---- Base32 (RFC 4648, không đệm '=') ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const s = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Khóa base32 không hợp lệ');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// secret: chuỗi base32 hoặc Buffer khóa thô; step: số thứ tự chu kỳ 30 giây.
function totpAt(secret, step) {
  const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

// Trả về bước (step) của mã nếu hợp lệ trong cửa sổ ±1 và lớn hơn lastStep (chống dùng lại); ngược lại null.
function verifyTotp(secret, code, now, lastStep) {
  const c = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = Math.floor(now / PERIOD_MS);
  const given = Buffer.from(c);
  let found = null;
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = cur + d;
    if (lastStep !== null && lastStep !== undefined && step <= lastStep) continue;
    const ok = crypto.timingSafeEqual(Buffer.from(totpAt(secret, step)), given);
    if (ok && found === null) found = step;
  }
  return found;
}

function otpauthUri(secret, username, issuer = ISSUER) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(username)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_MS / 1000}`;
}

// Hiển thị khóa theo nhóm 4 ký tự cho dễ gõ tay.
function formatSecret(secret) {
  return String(secret).replace(/(.{4})(?=.)/g, '$1 ');
}

// ---- Mã hóa secret khi lưu (AES-256-GCM), khóa trong <thư mục CSDL>/secret.key ----
function loadKey(dir) {
  const file = path.join(dir, KEY_FILE);
  try {
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw new Error(`Tệp khóa ${file} không hợp lệ (phải đúng 32 byte)`);
    return key;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  fs.mkdirSync(dir, { recursive: true });
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(file, key, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') return loadKey(dir); // tiến trình khác vừa tạo
    throw e;
  }
  try { fs.chmodSync(file, 0o600); } catch { /* Windows: bỏ qua */ }
  return key;
}

// Kết quả: base64(iv[12] | tag[16] | ciphertext).
function encryptSecret(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

function decryptSecret(enc, key) {
  const raw = Buffer.from(String(enc), 'base64');
  if (raw.length < 29) throw new Error('Dữ liệu mã hóa không hợp lệ');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

// ---- Mã dự phòng: 10 mã ABCD-EFGH (bỏ I, O, 0, 1 dễ nhầm), lưu băm scrypt, dùng một lần ----
const RC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RC_COUNT = 10;

function makeRecoveryCodes() {
  const set = new Set();
  while (set.size < RC_COUNT) {
    let s = '';
    for (let i = 0; i < 8; i++) s += RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)];
    set.add(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return [...set];
}

function normalizeRecoveryCode(code) {
  const s = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : '';
}

// Một muối chung cho bộ 10 mã của một người → mỗi lần thử chỉ tốn một lần scrypt.
// Định dạng từng phần tử: "<saltHex>$<hashHex>".
function hashRecoveryCodes(codes) {
  const salt = crypto.randomBytes(16);
  return codes.map((c) => `${salt.toString('hex')}$${crypto.scryptSync(normalizeRecoveryCode(c), salt, 32).toString('hex')}`);
}

// Trả về vị trí mã khớp trong danh sách băm, hoặc -1.
function matchRecoveryCode(code, hashes) {
  const c = normalizeRecoveryCode(code);
  if (!c || !Array.isArray(hashes)) return -1;
  const cache = new Map();
  let found = -1;
  hashes.forEach((h, i) => {
    const [saltHex, hashHex] = String(h).split('$');
    if (!saltHex || !hashHex) return;
    if (!cache.has(saltHex)) cache.set(saltHex, crypto.scryptSync(c, Buffer.from(saltHex, 'hex'), 32));
    const expected = Buffer.from(hashHex, 'hex');
    const actual = cache.get(saltHex);
    if (expected.length === actual.length && crypto.timingSafeEqual(actual, expected) && found < 0) found = i;
  });
  return found;
}

module.exports = {
  base32Encode, base32Decode, generateSecret, totpAt, verifyTotp, otpauthUri, formatSecret,
  loadKey, encryptSecret, decryptSecret, makeRecoveryCodes, normalizeRecoveryCode, hashRecoveryCodes, matchRecoveryCode,
  ISSUER, PERIOD_MS,
};
