const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const { makeDocx, docxText } = require('./helpers-docx');
const R = require('../src/services/docRender');
const { AppError } = require('../src/util/errors');

const docXml = (buf) => new PizZip(buf).file('word/document.xml').asText();

test('render: ký tự đặc biệt được thoát, XML hợp lệ', () => {
  const out = R.renderDocx(makeDocx(['Họ tên: {ho_ten}']), { ho_ten: 'A & <B> {C}' });
  assert.equal(docxText(out), 'Họ tên: A & <B> {C}');
  const xml = docXml(out);
  assert.ok(xml.includes('A &amp; &lt;B&gt; {C}'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#)/.test(xml));
  assert.ok(!xml.includes('<B>'));
});

test('render: bảng lặp 3 dòng', () => {
  const row = '<w:tr><w:tc><w:p><w:r><w:t>{#ds}{stt}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{ho_ten}{/ds}</w:t></w:r></w:p></w:tc></w:tr>';
  const xmlBody = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid>' + row + '</w:tbl><w:p/>';
  const out = R.renderDocx(makeDocx({ xmlBody }), { ds: [{ stt: 1, ho_ten: 'An' }, { stt: 2, ho_ten: 'Bình' }, { stt: 3, ho_ten: 'Cường' }] });
  assert.equal((docXml(out).match(/<w:tr>/g) || []).length, 3);
  assert.ok(docxText(out).includes('1\nAn'));
  assert.ok(docxText(out).includes('3\nCường'));
});

test('render: textarea nhiều dòng -> w:br; thiếu khóa/null -> rỗng', () => {
  const out = R.renderDocx(makeDocx(['{nd}', 'X{thieu}Y{nul}Z']), { nd: 'dòng 1\ndòng 2', nul: null });
  assert.ok(docXml(out).includes('<w:br/>'));
  assert.equal(docxText(out), 'dòng 1\ndòng 2\nXYZ');
});

test('render: mẫu sai cú pháp -> AppError tiếng Việt', () => {
  assert.throws(() => R.renderDocx(makeDocx(['{ho_ten']), {}), (e) => e instanceof AppError && /thiếu dấu đóng/.test(e.message));
  assert.throws(() => R.renderDocx(Buffer.from('rác'), {}), (e) => e instanceof AppError && /không đúng định dạng/.test(e.message));
});

test('inspectTemplate: liệt kê trường và vòng lặp', () => {
  const r = R.inspectTemplate(makeDocx(['{ho_ten} {#ds}{stt}{/ds}']));
  assert.deepEqual(r.errors, []);
  assert.ok(r.tags.includes('ho_ten') && r.tags.includes('stt'));
  assert.deepEqual(r.loops, ['ds']);
});

test('inspectTemplate: lỗi cú pháp', () => {
  let r = R.inspectTemplate(makeDocx(['{ho_ten']));
  assert.ok(r.errors.some((e) => /thiếu dấu đóng/.test(e)), r.errors.join('|'));
  r = R.inspectTemplate(makeDocx(['{#ds}{stt}']));
  assert.ok(r.errors.some((e) => /Vòng lặp \{#ds\} chưa có \{\/ds\}/.test(e)), r.errors.join('|'));
  r = R.inspectTemplate(makeDocx(['abc {/ds}']));
  assert.ok(r.errors.length > 0);
  r = R.inspectTemplate(Buffer.from('rác rưởi'));
  assert.ok(r.errors.some((e) => /không đúng định dạng/.test(e)));
  const z = new PizZip(); z.file('x.txt', 'a');
  r = R.inspectTemplate(z.generate({ type: 'nodebuffer' }));
  assert.ok(r.errors.some((e) => /không đúng định dạng/.test(e)));
});

test('safeFileName', () => {
  assert.doesNotMatch(R.safeFileName('a/b:c*?'), /[\\/:*?"<>|]/);
  assert.equal(R.safeFileName(''), 'van-ban');
  assert.equal(R.safeFileName('  ... '), 'van-ban');
  assert.equal(R.safeFileName('abc. '), 'abc');
  assert.equal(R.safeFileName('x'.repeat(300)).length, 120);
});

test('buildZip: tên trùng thêm (2), (3), tên Việt giữ nguyên', () => {
  const b = Buffer.from('x');
  const zip = R.buildZip([{ name: 'Nguyễn Văn A.docx', buffer: b }, { name: 'Nguyễn Văn A.docx', buffer: b }, { name: 'Nguyễn Văn A.docx', buffer: b }]);
  const names = Object.keys(new PizZip(zip).files);
  assert.deepEqual(names, ['Nguyễn Văn A.docx', 'Nguyễn Văn A (2).docx', 'Nguyễn Văn A (3).docx']);
});

test('render: thẻ prototype (constructor, __proto__, toString) ra rỗng, kể cả trong vòng lặp', () => {
  const out = R.renderDocx(makeDocx(['[{constructor}][{__proto__}][{toString}][{hasOwnProperty}]']), { a: 1 });
  assert.equal(docxText(out), '[][][][]');
  const out2 = R.renderDocx(makeDocx(['{#ds}[{ho_ten}{constructor}{toString}]{/ds}']), { ds: [{ ho_ten: 'An' }, { ho_ten: 'Bình' }] });
  assert.equal(docxText(out2), '[An][Bình]');
  const out3 = R.renderDocx(makeDocx(['{#ds}{.},{/ds}']), { ds: ['x', 'y'] });
  assert.equal(docxText(out3), 'x,y,');
});

test('safeFileName: tên dành riêng của Windows', () => {
  for (const n of ['CON', 'con.docx', 'NUL', 'aux.txt', 'COM1', 'LPT9.docx', 'Prn']) {
    assert.match(R.safeFileName(n), /^_/, n);
  }
  assert.equal(R.safeFileName('CON.docx'), '_CON.docx');
  assert.equal(R.safeFileName('console.docx'), 'console.docx');
  assert.equal(R.safeFileName('COM10'), 'COM10');
});

test('safeFileName/buildZip: cắt phần tên, giữ đuôi; hậu tố không vượt giới hạn', () => {
  const n = R.safeFileName('x'.repeat(300) + '.docx');
  assert.equal(n.length, 120);
  assert.ok(n.endsWith('.docx'));
  const b = Buffer.from('x');
  const names = Object.keys(new PizZip(R.buildZip([{ name: n, buffer: b }, { name: n, buffer: b }])).files);
  assert.equal(names.length, 2);
  assert.ok(names.every((x) => x.length <= 120 && x.endsWith('.docx')));
});

test('inspectTemplate: vòng lặp rỗng nằm trong loops; unopened có thông báo tiếng Việt', () => {
  assert.deepEqual(R.inspectTemplate(makeDocx(['{#ds}{/ds}'])).loops, ['ds']);
  const r = R.inspectTemplate(makeDocx(['abc {/ds}']));
  assert.ok(r.errors.some((e) => /Có \{\/ds\} nhưng chưa có vòng lặp \{#ds\}/.test(e)), r.errors.join('|'));
});

// Tệp nén "bom": vài chục KB nhưng giải nén ra hàng chục MB.
function bomb(parts) {
  const PizZip = require('pizzip');
  const zip = new PizZip(makeDocx(['a']));
  for (const [name, mb] of parts) zip.file(name, ' '.repeat(mb * 1024 * 1024));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

test('zip bomb: một phần > 20MB hoặc tổng > 50MB -> AppError, không giải nén', () => {
  const D = require('../src/services/docDetect');
  const one = bomb([['word/document.xml', 30]]);
  assert.ok(one.length < 1024 * 1024, `${one.length}`);
  const many = bomb([['word/a.xml', 18], ['word/b.xml', 18], ['word/c.xml', 18]]);
  for (const buf of [one, many]) {
    const isBig = (e) => e instanceof AppError && e.message === 'Tệp Word quá lớn hoặc không hợp lệ';
    assert.throws(() => R.renderDocx(buf, {}), isBig);
    assert.throws(() => D.detect(buf), isBig);
    assert.throws(() => D.applySuggestions(buf, []), isBig);
    assert.deepEqual(R.inspectTemplate(buf).errors, ['Tệp Word quá lớn hoặc không hợp lệ']);
  }
  // tệp bình thường vẫn qua
  assert.deepEqual(R.inspectTemplate(bomb([['word/a.xml', 1]])).errors, []);
});
