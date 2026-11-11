const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quanly-ctv-'));
  return openDb(path.join(dir, 'test.db'));
}

module.exports = { makeDb };
