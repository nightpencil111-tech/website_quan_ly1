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
  const buf = makeDocx(['Ngày ...... tháng ...... năm ......', 'Ds: ......', 'Lý do: ....', 'Lý do: ....', '...........', '1234: ....',
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
