const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const totp = require('../src/services/totp');

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

test('totpAt khớp vector RFC 6238 (SHA-1, 6 số)', () => {
  assert.equal(totp.totpAt(RFC_SECRET, Math.floor(59 / 30)), '287082');
  assert.equal(totp.totpAt(RFC_SECRET, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.totpAt(RFC_SECRET, Math.floor(1111111111 / 30)), '050471');
  assert.equal(totp.totpAt(RFC_SECRET, Math.floor(1234567890 / 30)), '005924');
  assert.equal(totp.totpAt(RFC_SECRET, Math.floor(2000000000 / 30)), '279037');
  // Cùng secret dạng base32 cho cùng kết quả.
  const b32 = totp.base32Encode(RFC_SECRET);
  assert.equal(b32, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totp.totpAt(b32, Math.floor(59 / 30)), '287082');
});

test('base32 (RFC 4648, không đệm) mã hóa/giải mã hai chiều', () => {
  for (let n = 0; n < 25; n++) {
    const buf = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
    assert.deepEqual(totp.base32Decode(totp.base32Encode(buf)), buf);
  }
  assert.equal(totp.base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.deepEqual(totp.base32Decode('mzxw 6ytb oi'), Buffer.from('foobar'));
});

test('generateSecret: 20 byte ngẫu nhiên → 32 ký tự base32', () => {
  const a = totp.generateSecret();
  const b = totp.generateSecret();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.notEqual(a, b);
  assert.equal(totp.base32Decode(a).length, 20);
});

test('verifyTotp chấp nhận lệch ±1 bước, từ chối ±2, từ chối dùng lại (replay)', () => {
  const secret = totp.generateSecret();
  const now = 1_700_000_000_000;
  const cur = Math.floor(now / 30000);
  assert.equal(totp.verifyTotp(secret, totp.totpAt(secret, cur), now, null), cur);
  assert.equal(totp.verifyTotp(secret, totp.totpAt(secret, cur - 1), now, null), cur - 1);
  assert.equal(totp.verifyTotp(secret, totp.totpAt(secret, cur + 1), now, null), cur + 1);
  // ±2 bước: từ chối (trừ khi trùng ngẫu nhiên với mã trong cửa sổ — kiểm tra điều kiện đó).
  const win = [cur - 1, cur, cur + 1].map((s) => totp.totpAt(secret, s));
  for (const s of [cur - 2, cur + 2]) {
    const c = totp.totpAt(secret, s);
    if (!win.includes(c)) assert.equal(totp.verifyTotp(secret, c, now, null), null, 'bước ' + (s - cur));
  }
  // Replay: bước ≤ lastStep bị từ chối.
  assert.equal(totp.verifyTotp(secret, totp.totpAt(secret, cur), now, cur), null);
  assert.equal(totp.verifyTotp(secret, totp.totpAt(secret, cur - 1), now, cur), null);
  assert.equal(totp.verifyTotp(secret, totp.totpAt(secret, cur + 1), now, cur), cur + 1);
  // Định dạng sai.
  assert.equal(totp.verifyTotp(secret, '', now, null), null);
  assert.equal(totp.verifyTotp(secret, 'abcdef', now, null), null);
  assert.equal(totp.verifyTotp(secret, '12345', now, null), null);
  // Cho phép khoảng trắng trong mã (người dùng gõ "123 456").
  const spaced = totp.totpAt(secret, cur).replace(/^(\d{3})/, '$1 ');
  assert.equal(totp.verifyTotp(secret, spaced, now, null), cur);
});

test('otpauthUri đúng định dạng cho Google/Microsoft Authenticator', () => {
  const uri = totp.otpauthUri('JBSWY3DPEHPK3PXP', 'quan.ly', 'QuanLyCTV');
  assert.equal(uri, 'otpauth://totp/QuanLyCTV:quan.ly?secret=JBSWY3DPEHPK3PXP&issuer=QuanLyCTV&algorithm=SHA1&digits=6&period=30');
});

test('mã hóa secret AES-256-GCM: hai chiều, không lộ bản rõ, sửa dữ liệu thì lỗi', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-key-'));
  const key = totp.loadKey(dir);
  assert.equal(key.length, 32);
  assert.deepEqual(totp.loadKey(dir), key, 'lần sau đọc lại đúng khóa cũ');
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(dir, 'secret.key')).mode & 0o777, 0o600);
  }
  const secret = totp.generateSecret();
  const enc = totp.encryptSecret(secret, key);
  assert.ok(!enc.includes(secret));
  assert.notEqual(totp.encryptSecret(secret, key), enc, 'IV ngẫu nhiên');
  assert.equal(totp.decryptSecret(enc, key), secret);
  const raw = Buffer.from(enc, 'base64');
  raw[raw.length - 1] ^= 1;
  assert.throws(() => totp.decryptSecret(raw.toString('base64'), key));
  const other = totp.loadKey(fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-key-')));
  assert.throws(() => totp.decryptSecret(enc, other));
});

test('mã dự phòng: 10 mã dạng ABCD-EFGH, băm scrypt, dùng đúng mã nào trả về vị trí mã đó', () => {
  const codes = totp.makeRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const hashes = totp.hashRecoveryCodes(codes);
  assert.equal(hashes.length, 10);
  for (const h of hashes) for (const c of codes) assert.ok(!h.includes(c));
  assert.equal(totp.matchRecoveryCode(codes[3], hashes), 3);
  assert.equal(totp.matchRecoveryCode(codes[7].toLowerCase().replace('-', ' '), hashes), 7, 'không phân biệt hoa thường, dấu gạch');
  assert.equal(totp.matchRecoveryCode('AAAA-AAAA', hashes), -1);
  assert.equal(totp.matchRecoveryCode('', hashes), -1);
});
