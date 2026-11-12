const test = require('node:test');
const assert = require('node:assert/strict');
const PizZip = require('pizzip');
const { makeDocx, docxText } = require('./helpers-docx');
const D = require('../src/services/docDetect');
const { inspectTemplate, renderDocx } = require('../src/services/docRender');
const { FIELD_CATALOG } = require('../src/services/docFields');
const { AppError } = require('../src/util/errors');

const docXml = (buf) => new PizZip(buf).file('word/document.xml').asText();
const useAll = (sugs) => sugs.map((s) => ({ id: s.id, action: s.code ? 'use' : 'manual', code: s.code || s.newCode }));
const para = (runs) => '<w:p>' + runs.map((r) => `<w:r>${r.b ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${r.t}</w:t></w:r>`).join('') + '</w:p>';

test('LABELS: đủ mã theo bản thiết kế, từ khóa không dấu', () => {
  const codes = D.LABELS.map((l) => l.code);
  for (const c of ['ho_ten', 'ngay_sinh', 'cap_bac', 'chuc_vu', 'don_vi_qn', 'que_quan', 'noi_o', 'dan_toc', 'ton_giao',
    'van_hoa', 'chuyen_mon', 'nhap_ngu', 'ngay_vao_doan', 'ngay_vao_dang', 'ngay_chinh_thuc', 'sdt', 'gioi_tinh', 'suc_khoe']) {
    assert.ok(codes.includes(c), c);
  }
  const catalog = new Set(FIELD_CATALOG.map((f) => f.code));
  for (const l of D.LABELS) {
    assert.ok(catalog.has(l.code), l.code);
    for (const k of l.keys) assert.match(k, /^[a-z ]+$/);
  }
});

test('detect: "Họ và tên: ……" → ho_ten; áp dụng → "Họ và tên: {ho_ten}"', () => {
  const buf = makeDocx(['Họ và tên: ……………………']);
  const { suggestions } = D.detect(buf);
  assert.equal(suggestions.length, 1);
  const s = suggestions[0];
  assert.equal(s.code, 'ho_ten');
  assert.equal(s.newCode, null);
  assert.equal(s.label, 'Họ và tên');
  assert.equal(s.paragraphIndex, 0);
  assert.equal(s.context, 'Họ và tên: ……………………');
  assert.equal(typeof s.id, 'string');
  const out = D.applySuggestions(buf, useAll(suggestions));
  assert.equal(docxText(out.buffer), 'Họ và tên: {ho_ten}');
  assert.deepEqual(out.manualFields, []);
  assert.deepEqual(inspectTemplate(out.buffer).errors, []);
});

test('detect: nhãn tách 3 run (đậm/thường) vẫn nhận ra, định dạng nhãn giữ nguyên', () => {
  const buf = makeDocx({ xmlBody: para([{ t: 'Họ và ', b: true }, { t: 'tên', b: true }, { t: ': ......' }]) });
  const { suggestions } = D.detect(buf);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].code, 'ho_ten');
  const out = D.applySuggestions(buf, useAll(suggestions));
  assert.equal(docxText(out.buffer), 'Họ và tên: {ho_ten}');
  const xml = docXml(out.buffer);
  assert.equal((xml.match(/<w:b\/>/g) || []).length, 2);
  assert.ok(xml.includes('<w:t xml:space="preserve">: {ho_ten}</w:t>'));
});

test('detect: chỗ trống trải nhiều run → dồn vào run đầu, run sau bị cắt phần trống', () => {
  const buf = makeDocx({ xmlBody: para([{ t: 'Chức vụ: ...' }, { t: '.....', b: true }, { t: '.. (ghi rõ)' }]) });
  const { suggestions } = D.detect(buf);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].code, 'chuc_vu');
  const out = D.applySuggestions(buf, useAll(suggestions));
  assert.equal(docxText(out.buffer), 'Chức vụ: {chuc_vu} (ghi rõ)');
  assert.deepEqual(inspectTemplate(out.buffer).errors, []);
});

test('detect: đoạn trong ô bảng được nhận ra', () => {
  const xmlBody = '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc>' +
    para([{ t: 'Đơn vị: ____' }]) + '</w:tc></w:tr></w:tbl><w:p/>';
  const buf = makeDocx({ xmlBody });
  const { suggestions } = D.detect(buf);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].code, 'don_vi_qn');
  const out = D.applySuggestions(buf, useAll(suggestions));
  assert.ok(docxText(out.buffer).includes('Đơn vị: {don_vi_qn}'));
});

test('detect: "Lý do: ________" → newCode ly_do; manual → manualFields', () => {
  const buf = makeDocx(['Lý do: ________']);
  const { suggestions } = D.detect(buf);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].code, null);
  assert.equal(suggestions[0].newCode, 'ly_do');
  assert.equal(suggestions[0].label, 'Lý do');
  const out = D.applySuggestions(buf, [{ id: suggestions[0].id, action: 'manual', code: 'ly_do' }]);
  assert.equal(docxText(out.buffer), 'Lý do: {ly_do}');
  assert.deepEqual(out.manualFields, [{ code: 'ly_do', label: 'Lý do', type: 'text', required: false }]);
  assert.deepEqual(inspectTemplate(out.buffer).errors, []);
});

test('detect: hai chỗ trống trong một đoạn → 2 đề xuất', () => {
  const buf = makeDocx(['Cấp bậc: ...... Chức vụ: ......']);
  const { suggestions } = D.detect(buf);
  assert.deepEqual(suggestions.map((s) => s.code), ['cap_bac', 'chuc_vu']);
  assert.deepEqual(suggestions.map((s) => s.label), ['Cấp bậc', 'Chức vụ']);
  assert.notEqual(suggestions[0].id, suggestions[1].id);
  const out = D.applySuggestions(buf, useAll(suggestions));
  assert.equal(docxText(out.buffer), 'Cấp bậc: {cap_bac} Chức vụ: {chuc_vu}');
  const r = inspectTemplate(out.buffer);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.tags.sort(), ['cap_bac', 'chuc_vu']);
});

test('detect: đoạn không có chỗ trống → 0; hai dấu chấm không tính', () => {
  assert.equal(D.detect(makeDocx(['Báo cáo tình hình đơn vị.', 'Kết luận.. hết'])).suggestions.length, 0);
});

test('detect: action skip giữ nguyên đoạn; id lạ bị bỏ qua', () => {
  const buf = makeDocx(['Cấp bậc: ...... Chức vụ: ......']);
  const { suggestions } = D.detect(buf);
  const out = D.applySuggestions(buf, [{ id: suggestions[0].id, action: 'skip' }, { id: suggestions[1].id, action: 'use', code: 'chuc_vu' }, { id: 'p99-0', action: 'use', code: 'ho_ten' }]);
  assert.equal(docxText(out.buffer), 'Cấp bậc: ...... Chức vụ: {chuc_vu}');
  const out2 = D.applySuggestions(buf, []);
  assert.equal(docxText(out2.buffer), 'Cấp bậc: ...... Chức vụ: ......');
});

test('detect: nhãn sau số thứ tự, khớp nhãn dài nhất, nhãn tối đa 6 từ', () => {
  const buf = makeDocx([
    '1. Ngày vào Đảng: ………',
    'Số điện thoại: .......',
    'a) Nơi ở hiện nay: ______',
    'Tôi xin cam đoan rằng mọi thông tin kê khai ở trên: ......',
  ]);
  const s = D.detect(buf).suggestions;
  assert.deepEqual(s.map((x) => x.code), ['ngay_vao_dang', 'sdt', 'noi_o', null]);
  assert.equal(s[0].label, 'Ngày vào Đảng');
  assert.equal(s[3].label, 'thông tin kê khai ở trên');
  assert.equal(s[3].newCode, 'thong_tin_ke_khai_o_tren');
  assert.deepEqual(s.map((x) => x.paragraphIndex), [0, 1, 2, 3]);
});

test('detect: newCode tránh mã danh mục, ds, mã đã dùng; hợp lệ với quy tắc trường nhập tay', () => {
  const buf = makeDocx(['Ngày: ...... Tháng: ...... Năm: ......', 'Ds: ......', 'Lý do: ....', 'Lý do: ....', '...........', '1234: ....',
    'Nội dung rất rất rất dài dòng quá mức: ......']);
  const s = D.detect(buf).suggestions;
  const codes = s.map((x) => x.newCode);
  assert.deepEqual(codes.slice(0, 6), ['ngay_2', 'thang_2', 'nam_2', 'ds_2', 'ly_do', 'ly_do_2']);
  assert.equal(codes[6], 'truong_7');
  assert.match(codes[7], /^[a-z]/);
  const catalog = new Set(FIELD_CATALOG.map((f) => f.code));
  for (const c of codes) {
    assert.match(c, /^[a-z][a-z0-9_]{0,29}$/);
    assert.ok(!catalog.has(c) && c !== 'ds', c);
  }
  assert.equal(new Set(codes).size, codes.length);
  const out = D.applySuggestions(buf, useAll(s));
  assert.deepEqual(inspectTemplate(out.buffer).errors, []);
  assert.equal(out.manualFields.length, s.length);
  assert.equal(out.manualFields[6].label, 'Trường 7');
});

test('applySuggestions: mã không hợp lệ hoặc manual trùng danh mục → AppError', () => {
  const buf = makeDocx(['Lý do: ......']);
  const id = D.detect(buf).suggestions[0].id;
  assert.throws(() => D.applySuggestions(buf, [{ id, action: 'use', code: 'a}b' }]), AppError);
  assert.throws(() => D.applySuggestions(buf, [{ id, action: 'manual', code: 'ho_ten' }]), AppError);
  assert.throws(() => D.applySuggestions(buf, [{ id, action: 'manual', code: 'ds' }]), AppError);
  assert.throws(() => D.applySuggestions(Buffer.from('xx'), []), AppError);
});

test('dấu ngoặc nhọn có sẵn: detect báo, apply đổi sang ngoặc toàn khổ; ô trống hợp lệ giữ nguyên', () => {
  const buf = makeDocx({ xmlBody: para([{ t: 'Ghi chú {xem phụ lục' }, { t: '} và mục }' }]) + para([{ t: 'Đã có {ho_ten} &amp; Lý do: ....' }]) });
  const d = D.detect(buf);
  assert.equal(d.braces.length, 1);
  assert.ok(d.braces[0].includes('Ghi chú'));
  assert.ok(inspectTemplate(buf).errors.length > 0);
  const out = D.applySuggestions(buf, useAll(d.suggestions));
  const text = docxText(out.buffer);
  assert.ok(text.includes('Ghi chú ｛xem phụ lục｝ và mục ｝'));
  assert.ok(text.includes('Đã có {ho_ten} & Lý do: {ly_do}'));
  const r = inspectTemplate(out.buffer);
  assert.deepEqual(r.errors, []);
  const rendered = renderDocx(out.buffer, { ho_ten: 'An', ly_do: 'Ốm' });
  assert.ok(docxText(rendered).includes('Đã có An & Lý do: Ốm'));
});

test('bỏ qua instrText, giữ run tab/ngắt dòng; giữ xml:space khi có khoảng trắng đầu/cuối', () => {
  const xmlBody = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE ..... </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t>Quê quán:</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>.......</w:t></w:r><w:r><w:br/></w:r><w:r><w:t xml:space="preserve">Dân tộc: ...... </w:t></w:r></w:p>';
  const buf = makeDocx({ xmlBody });
  const s = D.detect(buf).suggestions;
  assert.deepEqual(s.map((x) => x.code), ['que_quan', 'dan_toc']);
  const out = D.applySuggestions(buf, useAll(s));
  const xml = docXml(out.buffer);
  assert.ok(xml.includes('<w:tab/>') && xml.includes('<w:br/>') && xml.includes('PAGE ..... '));
  assert.ok(xml.includes('<w:t xml:space="preserve">Dân tộc: {dan_toc} </w:t>'));
  assert.deepEqual(inspectTemplate(out.buffer).errors, []);
});

test('detect: chỗ trống ngày "..../..../...." là một; nhãn bỏ phần ghi chú trong ngoặc ngay trước dấu hai chấm', () => {
  const buf = makeDocx(['Ngày sinh: ......../......../........', 'Họ và tên (chữ in hoa): ......', 'Ghi chú {nếu có}: ......']);
  const s = D.detect(buf).suggestions;
  assert.deepEqual(s.map((x) => [x.label, x.code || x.newCode]), [['Ngày sinh', 'ngay_sinh'], ['Họ và tên', 'ho_ten'], ['Ghi chú', 'ghi_chu']]);
  const out = D.applySuggestions(buf, useAll(s));
  assert.equal(docxText(out.buffer), 'Ngày sinh: {ngay_sinh}\nHọ và tên (chữ in hoa): {ho_ten}\nGhi chú ｛nếu có｝: {ghi_chu}');
});

// Hộp văn bản Word: cùng nội dung lưu hai lần (mc:Choice cho Word mới, mc:Fallback cho Word cũ).
function textBox(inner) {
  return '<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
    `<mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>${inner}</w:txbxContent></wps:txbx></w:drawing></mc:Choice>` +
    `<mc:Fallback><w:pict><v:textbox><w:txbxContent>${inner}</w:txbxContent></v:textbox></w:pict></mc:Fallback>` +
    '</mc:AlternateContent></w:r></w:p>';
}

test('hộp văn bản: chỗ trống trong mc:Choice/mc:Fallback chỉ hiện một lần, áp dụng cho cả hai', () => {
  const inner = para([{ t: 'Lý do: ........' }]) + para([{ t: 'Họ và tên: ........' }]);
  const buf = makeDocx({ xmlBody: textBox(inner) + para([{ t: 'Lý do: ......' }]) });
  const s = D.detect(buf).suggestions;
  assert.deepEqual(s.map((x) => x.code || x.newCode), ['ly_do', 'ho_ten', 'ly_do_2']);
  const out = D.applySuggestions(buf, useAll(s).slice(0, 2));
  const xml = docXml(out.buffer);
  assert.equal((xml.match(/Lý do: \{ly_do\}/g) || []).length, 2);
  assert.equal((xml.match(/Họ và tên: \{ho_ten\}/g) || []).length, 2);
  assert.deepEqual(out.manualFields.map((f) => f.code), ['ly_do']);
  assert.ok(docxText(out.buffer).includes('Lý do: ......'));
  // bỏ qua → cả hai giữ nguyên
  const skip = D.applySuggestions(buf, [{ id: s[0].id, action: 'skip' }]);
  assert.equal((docXml(skip.buffer).match(/Lý do: \.{8}/g) || []).length, 2);
});

test('dòng ngày tháng: "……, ngày …… tháng …… năm 20……" là một chỗ → {ngay_thang}', () => {
  const buf = makeDocx(['………………, ngày …… tháng …… năm 20……', 'Đồng Nai, ngày ..... tháng ..... năm .......',
    'Hôm nay, ngày ...... tháng ...... năm 20......, tại hội trường']);
  const s = D.detect(buf).suggestions;
  assert.equal(s.length, 3, JSON.stringify(s));
  assert.equal(s[0].code, 'ngay_thang');
  assert.equal(s[0].kind, 'date_place');
  assert.equal(s[1].kind, 'date');
  assert.equal(s[2].kind, 'date');
  const out = D.applySuggestions(buf, [
    { id: s[0].id, action: 'use', code: 'ngay_thang' }, { id: s[1].id, action: 'date' }, { id: s[2].id, action: 'date' },
  ]);
  assert.equal(docxText(out.buffer), '{ngay_thang}\nĐồng Nai, ngày {ngay} tháng {thang} năm {nam}\n' +
    'Hôm nay, ngày {ngay} tháng {thang} năm {nam}, tại hội trường');
  assert.deepEqual(out.manualFields, []);
  const r = renderDocx(out.buffer, { ngay_thang: 'Xã A, ngày 2 tháng 3 năm 2026', ngay: '2', thang: '3', nam: '2026' });
  assert.ok(docxText(r).includes('Đồng Nai, ngày 2 tháng 3 năm 2026'));
  assert.ok(!docxText(r).includes('202026'));
  // chọn mã khác cho dòng ngày → thay cả cụm
  const other = D.applySuggestions(buf, [{ id: s[1].id, action: 'use', code: 'ngay_thang' }]);
  assert.ok(docxText(other.buffer).includes('Đồng Nai, ngày {ngay_thang}\n'), docxText(other.buffer));
});

test('mặc định: dấu … trong câu văn → prose (Bỏ qua); "Nhãn: ……" thì không', () => {
  const buf = makeDocx(['Các đơn vị TP. Hồ Chí Minh...', 'Tổ chức học tập, sinh hoạt …', 'Ghi chú: ...', 'Lý do ........ đã nêu']);
  const s = D.detect(buf).suggestions;
  assert.deepEqual(s.map((x) => !!x.prose), [true, true, false, false]);
  assert.deepEqual(s.slice(2).map((x) => [x.label, x.newCode]), [['Ghi chú', 'ghi_chu'], ['Lý do', 'ly_do']]);
});

test('ngoặc nhọn lẻ trong chú thích, nhận xét, thuộc tính tài liệu → đổi sang toàn khổ, mẫu lưu được', () => {
  const zip = new PizZip(makeDocx(['Họ và tên: ......']));
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  zip.file('word/footnotes.xml', `<?xml version="1.0"?><w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:t>Xem {phụ lục</w:t></w:r></w:p></w:footnote></w:footnotes>`);
  zip.file('word/comments.xml', `<?xml version="1.0"?><w:comments ${W}><w:comment w:id="0"><w:p><w:r><w:t>sửa } sau</w:t></w:r></w:p></w:comment></w:comments>`);
  zip.file('docProps/core.xml', '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Mẫu {cũ</dc:title></cp:coreProperties>');
  const ct = zip.file('[Content_Types].xml').asText().replace('</Types>',
    '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
    '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>');
  zip.file('[Content_Types].xml', ct);
  const buf = zip.generate({ type: 'nodebuffer' });
  assert.ok(renderDocxFails(buf), 'mẫu gốc phải lỗi cú pháp');
  const d = D.detect(buf);
  assert.ok(d.braces.some((b) => b.includes('Xem {phụ lục')), d.braces.join('|'));
  assert.ok(d.braces.some((b) => b.includes('Mẫu {cũ')), d.braces.join('|'));
  const out = D.applySuggestions(buf, useAll(d.suggestions));
  const z = new PizZip(out.buffer);
  assert.ok(z.file('word/footnotes.xml').asText().includes('Xem ｛phụ lục'));
  assert.ok(z.file('word/comments.xml').asText().includes('sửa ｝ sau'));
  assert.ok(z.file('docProps/core.xml').asText().includes('Mẫu ｛cũ'));
  assert.deepEqual(inspectTemplate(out.buffer).errors, []);
  assert.ok(docxText(renderDocx(out.buffer, { ho_ten: 'An' })).includes('Họ và tên: An'));
});

function renderDocxFails(buf) {
  try { renderDocx(buf, {}); return false; } catch (e) { return e instanceof AppError; }
}
