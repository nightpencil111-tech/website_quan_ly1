const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');

const dirWith = (content) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlctv-cfg-'));
  if (content !== undefined) fs.writeFileSync(path.join(dir, 'quanly.config.json'), content);
  return dir;
};

test('loadConfig: không có tệp, không có env → chế độ nội bộ, cổng 3000', () => {
  const c = loadConfig({}, dirWith());
  assert.equal(c.mode, 'noi_bo');
  assert.equal(c.port, 3000);
  assert.equal(c.publicUrl, '');
  assert.equal(c.listenLan, false);
});

test('loadConfig: đọc tệp quanly.config.json', () => {
  const c = loadConfig({}, dirWith(JSON.stringify({ mode: 'internet', port: 4000, publicUrl: 'https://may.tailnet.ts.net', listenLan: true })));
  assert.deepEqual(c, { mode: 'internet', port: 4000, publicUrl: 'https://may.tailnet.ts.net', listenLan: true });
});

test('loadConfig: biến môi trường thắng tệp (QLCTV_MODE, PORT)', () => {
  const dir = dirWith(JSON.stringify({ mode: 'internet', port: 4000, publicUrl: 'https://a.ts.net' }));
  const c = loadConfig({ QLCTV_MODE: 'noi_bo', PORT: '5000' }, dir);
  assert.equal(c.mode, 'noi_bo');
  assert.equal(c.port, 5000);
  assert.equal(c.publicUrl, 'https://a.ts.net');
  const c2 = loadConfig({ QLCTV_MODE: 'internet' }, dirWith());
  assert.equal(c2.mode, 'internet');
  assert.equal(c2.port, 3000);
});

test('loadConfig: JSON hỏng → lỗi tiếng Việt rõ ràng', () => {
  assert.throws(() => loadConfig({}, dirWith('{ "mode": "internet", ')), /quanly\.config\.json.*không đúng định dạng JSON/);
});

test('loadConfig: chế độ không hợp lệ → lỗi tiếng Việt', () => {
  assert.throws(() => loadConfig({ QLCTV_MODE: 'abc' }, dirWith()), /Chế độ chạy "abc" không hợp lệ/);
  assert.throws(() => loadConfig({}, dirWith('{"mode":"lan"}')), /Chế độ chạy "lan" không hợp lệ/);
});
