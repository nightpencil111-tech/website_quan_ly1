// Tự nhận dạng chỗ cần điền (dấu chấm / gạch dưới sau nhãn) trong mẫu Word và thay bằng ô trống {ma}.
// Làm việc trực tiếp trên chuỗi XML: ghép chữ các w:t theo từng đoạn (kể cả trong bảng), nên nhãn
// bị Word tách thành nhiều run vẫn nhận ra; khi thay chỉ sửa nội dung w:t, giữ nguyên run và định dạng.
const PizZip = require('pizzip');
const { AppError } = require('../util/errors');
const { fold } = require('../util/text');
const { FIELD_CATALOG } = require('./docFields');

const BAD_FORMAT = 'Tệp không đúng định dạng Word (.docx)';
const LIST_LOOP = 'ds';
const CATALOG = new Set(FIELD_CATALOG.map((f) => f.code));
const CODE_RE = /^[a-z][a-z0-9_]{0,39}$/; // trùng quy tắc mã trường nhập tay của docTemplates
const MAX_NEW_CODE = 30;
const MAX_LABEL_WORDS = 6;
const MAX_CONTEXT = 120;

// Từ khóa đã fold (không dấu, chữ thường) → mã trường quân nhân. Khớp nhãn dài nhất trước.
const LABELS = [
  { code: 'ho_ten', keys: ['ho va ten', 'ho ten'] },
  { code: 'ngay_sinh', keys: ['ngay sinh', 'sinh ngay', 'ngay thang nam sinh'] },
  { code: 'cap_bac', keys: ['cap bac'] },
  { code: 'chuc_vu', keys: ['chuc vu'] },
  { code: 'don_vi_qn', keys: ['don vi'] },
  { code: 'que_quan', keys: ['que quan'] },
  { code: 'noi_o', keys: ['noi o', 'tru quan', 'noi o hien nay'] },
  { code: 'dan_toc', keys: ['dan toc'] },
  { code: 'ton_giao', keys: ['ton giao'] },
  { code: 'van_hoa', keys: ['trinh do van hoa', 'van hoa'] },
  { code: 'chuyen_mon', keys: ['chuyen mon'] },
  { code: 'nhap_ngu', keys: ['nhap ngu', 'ngay nhap ngu'] },
  { code: 'ngay_vao_doan', keys: ['ngay vao doan'] },
  { code: 'ngay_vao_dang', keys: ['ngay vao dang'] },
  { code: 'ngay_chinh_thuc', keys: ['ngay chinh thuc'] },
  { code: 'sdt', keys: ['dien thoai', 'so dien thoai', 'sdt'] },
  { code: 'gioi_tinh', keys: ['gioi tinh'] },
  { code: 'suc_khoe', keys: ['suc khoe'] },
];
const KEYS = LABELS.flatMap((l) => l.keys.map((k) => ({ key: k, code: l.code }))).sort((a, b) => b.key.length - a.key.length);

// ---------- XML ----------
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k === 'amp') return '&';
  if (k === 'lt') return '<';
  if (k === 'gt') return '>';
  if (k === 'quot') return '"';
  if (k === 'apos') return "'";
  const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
  try { return String.fromCodePoint(n); } catch (e2) { return m; }
});
const encode = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Đoạn: w:p tự đóng | mở | đóng; chữ: w:t (không khớp w:tab/w:tbl/w:tc/w:tr, w:instrText, w:delText);
// w:tab / w:br / w:cr trong run → ký tự ảo '\t' / '\n' (chỉ để tách nhãn, không bao giờ bị sửa).
const TOKEN = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\s*\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g;

// → [{index, text, segs: [{ts, te, text, at, len, open}]}] theo thứ tự mở đoạn.
function parseParagraphs(xml) {
  const paras = [];
  const stack = [];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(xml))) {
    const tok = m[0];
    if (tok.startsWith('</w:p')) { stack.pop(); continue; }
    if (/^<w:p[\s>/]/.test(tok)) {
      const p = { index: paras.length, text: '', segs: [] };
      paras.push(p);
      if (!tok.endsWith('/>')) stack.push(p);
      continue;
    }
    const p = stack[stack.length - 1];
    if (!p) continue;
    if (tok.startsWith('<w:tab')) { p.text += '\t'; continue; }
    if (tok.startsWith('<w:br') || tok.startsWith('<w:cr')) { p.text += '\n'; continue; }
    if (m[1] === undefined) continue; // <w:t/> rỗng
    const text = decode(m[1]);
    const open = tok.slice(0, tok.indexOf('>') + 1);
    p.segs.push({ ts: p.text.length, te: p.text.length + text.length, text, at: m.index, len: tok.length, open });
    p.text += text;
  }
  return paras;
}

// Áp các sửa đổi {start, end, text} (tọa độ trong chữ của đoạn, không chồng nhau) vào XML.
// Chữ thay thế được ghi vào w:t chứa ký tự đầu của vùng sửa; các w:t sau chỉ bị cắt phần thuộc vùng.
function applyEdits(xml, paraEdits) {
  const reps = [];
  for (const { para, edits } of paraEdits) {
    edits.sort((a, b) => a.start - b.start);
    for (const seg of para.segs) {
      const hit = edits.filter((e) => e.start < seg.te && e.end > seg.ts);
      if (!hit.length) continue;
      let out = '';
      let pos = seg.ts;
      for (const e of hit) {
        out += seg.text.slice(pos - seg.ts, Math.max(e.start, seg.ts) - seg.ts);
        if (e.start >= seg.ts) out += e.text;
        pos = Math.min(e.end, seg.te);
      }
      out += seg.text.slice(pos - seg.ts);
      let open = seg.open;
      if (/^\s|\s$/.test(out) && !/xml:space=/.test(open)) open = open.replace(/^<w:t/, '<w:t xml:space="preserve"');
      reps.push({ at: seg.at, len: seg.len, str: `${open}${encode(out)}</w:t>` });
    }
  }
  reps.sort((a, b) => b.at - a.at);
  for (const r of reps) xml = xml.slice(0, r.at) + r.str + xml.slice(r.at + r.len);
  return xml;
}

// ---------- Nhận dạng ----------
const BLANK = /[.…]+|_{3,}/g;
const weight = (s) => (s[0] === '_' ? s.length : [...s].reduce((n, c) => n + (c === '…' ? 3 : 1), 0));

function findBlanks(text) {
  const out = [];
  BLANK.lastIndex = 0;
  let m;
  while ((m = BLANK.exec(text))) {
    if (weight(m[0]) < 3) continue;
    const b = { start: m.index, end: m.index + m[0].length };
    const prev = out[out.length - 1];
    // "……… ………" (chỉ cách nhau khoảng trắng) hoặc ngày "..../..../...." là một chỗ trống.
    if (prev && /^[ \u00a0]*\/?[ \u00a0]*$/.test(text.slice(prev.end, b.start))) prev.end = b.end;
    else out.push(b);
  }
  return out;
}

function extractLabel(before) {
  let s = before.replace(/[\s:]+$/u, '');
  // "Họ tên (chữ in hoa):" → bỏ phần trong ngoặc ngay trước chỗ trống.
  for (let guard = 0; guard < 3 && /[)}\]]$/.test(s); guard++) {
    const open = { ')': '(', '}': '{', ']': '[' }[s[s.length - 1]];
    const i = s.lastIndexOf(open);
    if (i < 0) break;
    s = s.slice(0, i).replace(/[\s:]+$/u, '');
  }
  const cut = Math.max(...[...'.;,()!?:\n\t…[]{}'].map((c) => s.lastIndexOf(c)));
  s = s.slice(cut + 1).replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const words = s.split(/\s+/).filter(Boolean);
  return words.slice(-MAX_LABEL_WORDS).join(' ');
}

function matchCode(label) {
  const f = fold(label).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!f) return null;
  const hit = KEYS.find(({ key }) => f === key || f.endsWith(' ' + key));
  return hit ? hit.code : null;
}

function slug(label) {
  let s = fold(label).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (s && !/^[a-z]/.test(s)) s = 'truong_' + s;
  return s.slice(0, MAX_NEW_CODE).replace(/_+$/, '');
}

function uniqueCode(base, used) {
  let code = base;
  for (let n = 2; CATALOG.has(code) || code === LIST_LOOP || used.has(code); n++) {
    const suffix = `_${n}`;
    code = base.slice(0, MAX_NEW_CODE - suffix.length).replace(/_+$/, '') + suffix;
  }
  used.add(code);
  return code;
}

const context = (text) => {
  const s = text.replace(/[\t\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > MAX_CONTEXT ? s.slice(0, MAX_CONTEXT - 1) + '…' : s;
};

// Ngoặc nhọn có sẵn trong chữ làm hỏng cú pháp mẫu: giữ ô trống hợp lệ ({ma}, {#ds}, {/ds}, {.}),
// mọi dấu { } khác → vị trí cần đổi sang ngoặc toàn khổ ｛ ｝.
const TAG_NAME = /^(?:[#/^]?[a-z][a-z0-9_]*|\.)$/i;
function strayBraces(text) {
  const keep = new Set();
  const re = /\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    if (TAG_NAME.test(m[1].trim())) { keep.add(m.index); keep.add(m.index + m[0].length - 1); }
  }
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if ((text[i] === '{' || text[i] === '}') && !keep.has(i)) out.push(i);
  }
  return out;
}

function analyze(xml) {
  const paras = parseParagraphs(xml);
  const suggestions = [];
  const braces = [];
  const used = new Set();
  for (const p of paras) {
    if (strayBraces(p.text).length) braces.push(context(p.text));
    let prevEnd = 0;
    findBlanks(p.text).forEach((b, k) => {
      const label = extractLabel(p.text.slice(prevEnd, b.start));
      prevEnd = b.end;
      const code = matchCode(label);
      const n = suggestions.length + 1;
      const newCode = code ? null : uniqueCode(slug(label) || `truong_${n}`, used);
      suggestions.push({
        id: `p${p.index}-${k}`, paragraphIndex: p.index, context: context(p.text), label, code, newCode,
        _para: p, _start: b.start, _end: b.end, _fieldLabel: (label || `Trường ${n}`).slice(0, 120),
      });
    });
  }
  return { paras, suggestions, braces };
}

const publicView = ({ id, paragraphIndex, context: ctx, label, code, newCode }) => ({ id, paragraphIndex, context: ctx, label, code, newCode });

function openDocument(buffer) {
  let zip;
  try {
    zip = new PizZip(buffer);
  } catch (e) {
    throw new AppError(BAD_FORMAT);
  }
  const doc = zip.file('word/document.xml');
  if (!doc) throw new AppError(BAD_FORMAT);
  return { zip, xml: doc.asText() };
}

const otherParts = (zip) => Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n));

function detect(buffer) {
  const { zip, xml } = openDocument(buffer);
  const { suggestions, braces } = analyze(xml);
  for (const name of otherParts(zip)) {
    for (const p of parseParagraphs(zip.file(name).asText())) if (strayBraces(p.text).length) braces.push(context(p.text));
  }
  return { suggestions: suggestions.map(publicView), braces };
}

const braceEdits = (p) => strayBraces(p.text).map((i) => ({ start: i, end: i + 1, text: p.text[i] === '{' ? '｛' : '｝' }));

function applySuggestions(buffer, decisions) {
  const { zip, xml } = openDocument(buffer);
  const { paras, suggestions } = analyze(xml);
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const edits = new Map(paras.map((p) => [p, braceEdits(p)]));
  const manualFields = [];
  for (const d of Array.isArray(decisions) ? decisions : []) {
    const s = d && byId.get(String(d.id));
    if (!s || d.action === 'skip') continue;
    if (d.action !== 'use' && d.action !== 'manual') throw new AppError('Lựa chọn cho chỗ cần điền không hợp lệ');
    const code = String(d.code ?? '').trim();
    if (!CODE_RE.test(code) || code === LIST_LOOP) {
      throw new AppError(`Mã trường "${code}" không hợp lệ (chỉ chữ thường không dấu, chữ số và dấu _)`);
    }
    if (d.action === 'manual') {
      if (CATALOG.has(code)) throw new AppError(`Mã trường nhập tay "${code}" trùng mã có sẵn`);
      if (!manualFields.some((f) => f.code === code)) manualFields.push({ code, label: s._fieldLabel, type: 'text', required: false });
    }
    byId.delete(s.id); // mỗi chỗ trống chỉ thay một lần
    edits.get(s._para).push({ start: s._start, end: s._end, text: `{${code}}` });
  }
  const list = [...edits].filter(([, e]) => e.length).map(([para, e]) => ({ para, edits: e }));
  zip.file('word/document.xml', applyEdits(xml, list));
  for (const name of otherParts(zip)) {
    const part = zip.file(name).asText();
    const pl = parseParagraphs(part).map((p) => ({ para: p, edits: braceEdits(p) })).filter((x) => x.edits.length);
    if (pl.length) zip.file(name, applyEdits(part, pl));
  }
  return { buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), manualFields };
}

module.exports = { LABELS, detect, applySuggestions };
