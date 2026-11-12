// Dựng docx tối giản hợp lệ (Word/LibreOffice mở được) cho test.
const PizZip = require('pizzip');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function makeDocx(content) {
  const body = Array.isArray(content)
    ? content.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('')
    : content.xmlBody;
  const zip = new PizZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>');
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>');
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Ghép chữ w:t theo đoạn (w:br → xuống dòng trong đoạn), các đoạn cách nhau '\n'.
function docxText(buffer) {
  const xml = new PizZip(buffer).file('word/document.xml').asText();
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  return paras.map((p) => {
    let out = '';
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/>/g;
    let m;
    while ((m = re.exec(p))) out += m[1] === undefined ? '\n' : unesc(m[1]);
    return out;
  }).join('\n');
}

module.exports = { makeDocx, docxText };
