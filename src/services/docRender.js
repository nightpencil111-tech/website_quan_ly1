// Kết xuất mẫu Word (.docx) bằng docxtemplater, kiểm tra mẫu và nén nhiều file.
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const { AppError } = require('../util/errors');

const BAD_FORMAT = 'Tệp không đúng định dạng Word (.docx)';
const OPTIONS = { paragraphLoop: true, linebreaks: true, nullGetter: () => '', errorLogging: false };

function openZip(buffer) {
  let zip;
  try {
    zip = new PizZip(buffer);
  } catch (e) {
    throw new AppError(BAD_FORMAT);
  }
  if (!zip.file('word/document.xml')) throw new AppError(BAD_FORMAT);
  return zip;
}

function describeError(p) {
  const tag = p.xtag || p.openingtag || '';
  switch (p.id) {
    case 'unclosed_tag': return `Ô trống "${p.context || '{' + tag}" thiếu dấu đóng }`;
    case 'unopened_tag': return `Ô trống "${p.context || tag + '}'}" thiếu dấu mở {`;
    case 'unclosed_loop': return `Vòng lặp {#${tag}} chưa có {/${tag}}`;
    case 'unopened_loop': return `Có {/${tag}} nhưng chưa có vòng lặp {#${tag}} đi trước`;
    case 'closing_tag_does_not_match_opening_tag':
      return `Vòng lặp {#${p.openingtag}} bị đóng nhầm bằng {/${p.closingtag}}`;
    case 'raw_xml_tag_should_be_only_text_in_paragraph':
      return `Ô trống {@${tag}} phải nằm riêng trong một đoạn`;
    case 'duplicate_open_tag':
    case 'duplicate_close_tag':
      return 'Có hai dấu { hoặc } liền nhau không hợp lệ' + (p.context ? ` gần "${p.context}"` : '');
    default: return `Mẫu có cú pháp ô trống không hợp lệ${tag ? ` ở "${tag}"` : ''}`;
  }
}

function compileErrors(e) {
  const list = e && e.properties && Array.isArray(e.properties.errors) ? e.properties.errors : [e];
  const out = [];
  for (const x of list) {
    const msg = x && x.properties && x.properties.id ? describeError(x.properties) : 'Mẫu có cú pháp ô trống không hợp lệ';
    if (!out.includes(msg)) out.push(msg);
  }
  return out;
}

function walkTags(node, tags, loops) {
  for (const [k, v] of Object.entries(node || {})) {
    if (v && typeof v === 'object' && Object.keys(v).length) {
      if (!loops.includes(k)) loops.push(k);
      walkTags(v, tags, loops);
    } else if (!tags.includes(k)) tags.push(k);
  }
}

function inspectTemplate(buffer) {
  const res = { tags: [], loops: [], errors: [] };
  try {
    const zip = openZip(buffer);
    const t = new Docxtemplater(zip, OPTIONS).getTags();
    const parts = [t.document, ...(t.headers || []), ...(t.footers || [])];
    for (const part of parts) if (part && part.tags) walkTags(part.tags, res.tags, res.loops);
  } catch (e) {
    if (e instanceof AppError) res.errors.push(e.message);
    else if (e && e.properties && e.properties.id) res.errors.push(...compileErrors(e));
    else res.errors.push(BAD_FORMAT);
  }
  return res;
}

function renderDocx(buffer, data) {
  const zip = openZip(buffer);
  try {
    const doc = new Docxtemplater(zip, OPTIONS);
    doc.render(data || {});
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e && e.properties && e.properties.id) throw new AppError('Mẫu văn bản có lỗi: ' + compileErrors(e).join('; '));
    throw new AppError('Không thể kết xuất văn bản từ mẫu này');
  }
}

function safeFileName(name) {
  let s = String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.slice(0, 120).replace(/[. ]+$/, '').replace(/^\s+/, '');
  return s || 'van-ban';
}

function splitExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

function buildZip(files) {
  const zip = new PizZip();
  const used = new Set();
  for (const f of files) {
    const [base, ext] = splitExt(safeFileName(f.name));
    let name = base + ext;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
    used.add(name.toLowerCase());
    zip.file(name, f.buffer, { createFolders: false, binary: true });
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { inspectTemplate, renderDocx, safeFileName, buildZip };
