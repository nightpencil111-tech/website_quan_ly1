// Tên người "không tìm thấy" truyền qua URL: chỉ chữ cái và dấu cách, ≤ 40 ký tự, tối đa 5 tên.
function cleanNames(v) {
  const out = [];
  for (const x of [].concat(v ?? [])) {
    if (typeof x !== 'string') continue;
    const s = x.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (s && s.length <= 40 && /^[\p{L} ]+$/u.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= 5) break;
  }
  return out;
}
// Tên đơn vị truyền qua URL ("Trung đội 2"): chữ cái, chữ số và dấu cách, ≤ 60 ký tự, tối đa 5.
function cleanUnits(v) {
  const out = [];
  for (const x of [].concat(v ?? [])) {
    if (typeof x !== 'string') continue;
    const s = x.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (s && s.length <= 60 && /^[\p{L}\p{N} ]+$/u.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= 5) break;
  }
  return out;
}
module.exports = { cleanNames, cleanUnits };
