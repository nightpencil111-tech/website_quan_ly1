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
