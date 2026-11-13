// Hiểu câu giao việc tiếng Việt → bản nháp công việc (không ghi CSDL).
//
// Cách làm: câu gốc được chuẩn hóa NFC rồi bỏ dấu "thẳng hàng" (foldAligned: cùng độ dài),
// mọi so khớp chạy trên bản bỏ dấu, còn các đoạn cần loại khỏi tiêu đề được cắt theo chỉ số
// trên câu gốc nên tiêu đề giữ nguyên dấu và chữ hoa.
//
// Nhận người (heuristic):
//  - Từ dẫn: "đ/c", "đ.c", "đc"/"dc", "đồng chí", "giao cho" (bắt buộc có tên sau), "giao" (chỉ khi
//    sau đó là từ dẫn khác hoặc một tên khớp được — để "giao nhiệm vụ" không bị cắt).
//  - Sau từ dẫn lấy tối đa 4 từ liên tiếp nằm trong tập "từ có trong tên" của ứng viên; thử từ cụm
//    dài nhất về ngắn nhất, cụm đầu tiên khớp được ứng viên thì dùng. Không có cụm nào khớp mà có
//    từ dẫn bắt buộc → lấy các từ trong tập tên (hoặc 1 từ đầu nếu không có) làm cụm "không tìm thấy".
//  - So khớp: đủ họ tên > tên gọi (từ cuối) > 2 từ cuối. Nhiều ứng viên → ambiguous (không tự chọn).
//  - Nối người bằng "và", "cùng", "với", dấu phẩy; sau từ nối phải là từ dẫn hoặc tên khớp được.
//  - Ứng viên: người dùng đang hoạt động, vai trò member/manager (như gợi ý người thực hiện).
const { fold } = require('../../util/text');
const { AppError } = require('../../util/errors');
const { resolveDatePhrase, foldAligned, normalizeText, origMatches } = require('./dateWords');

const B = '(?<![a-z0-9])';
const E = '(?![a-z0-9])';

// Tìm mọi lần xuất hiện của cụm (đã bỏ dấu); forms = các dạng có dấu chấp nhận (ngoài dạng không dấu).
function findAll(orig, folded, pattern, forms) {
  const re = new RegExp(`${B}${pattern}${E}`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(folded))) {
    const start = m.index;
    const end = start + m[0].length;
    if (!forms || origMatches(orig, folded, start, end, forms)) out.push({ start, end });
  }
  return out;
}

const PRIORITY_WORDS = [
  { key: 'hoa_toc', pattern: 'hoa toc', forms: ['hỏa tốc', 'hoả tốc'] },
  { key: 'hoa_toc', pattern: 'khan cap', forms: ['khẩn cấp'] },
  { key: 'hoa_toc', pattern: 'khan', forms: ['khẩn'] },
  { key: 'gap', pattern: 'gap', forms: ['gấp'] },
  { key: 'gap', pattern: 'uu tien', forms: ['ưu tiên'] },
];

// Thứ tự = thứ tự ưu tiên khi hai lĩnh vực cùng xuất hiện ở cùng vị trí.
const CATEGORY_WORDS = [
  ['cong_tac_dang', [['chi bo', ['chi bộ']], ['dang vien', ['đảng viên']], ['nghi quyet', ['nghị quyết']], ['dang', ['đảng']]]],
  ['giao_duc_ct', [['hoc chinh tri', ['học chính trị']], ['giao duc chinh tri', ['giáo dục chính trị']], ['thoi su', ['thời sự']]]],
  ['thi_dua', [['thi dua', ['thi đua']], ['khen thuong', ['khen thưởng']]]],
  ['dan_van', [['dan van', ['dân vận']], ['nhan dan', ['nhân dân']], ['dia phuong', ['địa phương']]]],
  ['van_hoa', [['van nghe', ['văn nghệ']], ['the thao', ['thể thao']], ['hoi thao', ['hội thao']], ['van hoa', ['văn hóa', 'văn hoá']]]],
  ['huan_luyen', [['huan luyen', ['huấn luyện']], ['dieu lenh', ['điều lệnh']], ['ban sung', ['bắn súng']], ['ban dan', ['bắn đạn']], ['ban', ['bắn']]]],
  ['hau_can', [['hau can', ['hậu cần']], ['ky thuat', ['kỹ thuật', 'kĩ thuật']], ['quan trang', ['quân trang']], ['doanh trai', ['doanh trại']]]],
];

function detectPriority(orig, folded) {
  let priority = 'thuong';
  const spans = [];
  for (const w of PRIORITY_WORDS) {
    for (const s of findAll(orig, folded, w.pattern, w.forms)) {
      if (spans.some((x) => s.start < x.end && x.start < s.end)) continue;
      spans.push(s);
      if (w.key === 'hoa_toc' || priority === 'thuong') priority = w.key;
    }
  }
  return { priority, spans };
}

function detectCategory(orig, folded) {
  let best = null;
  for (const [key, words] of CATEGORY_WORDS) {
    for (const [pattern, forms] of words) {
      const s = findAll(orig, folded, pattern, forms)[0];
      if (s && (!best || s.start < best.start)) best = { key, start: s.start };
    }
  }
  return best ? best.key : 'khac';
}

function loadCandidates(db) {
  return db.prepare(
    `SELECT u.id, u.full_name, un.name AS unit_name FROM users u
       LEFT JOIN units un ON un.id = u.unit_id
      WHERE u.active = 1 AND u.role IN ('member','manager') ORDER BY u.id`
  ).all().map((c) => ({ ...c, words: fold(c.full_name).split(/\s+/).filter(Boolean) }));
}

// Cụm tên (đã bỏ dấu, các từ cách 1 dấu cách) → ứng viên theo thứ tự ưu tiên.
function resolveName(cands, phrase) {
  const pw = phrase.split(' ');
  const full = cands.filter((c) => c.words.join(' ') === phrase);
  if (full.length) return full;
  if (pw.length === 1) {
    const given = cands.filter((c) => c.words[c.words.length - 1] === phrase);
    if (given.length) return given;
  }
  if (pw.length === 2) {
    return cands.filter((c) => c.words.length >= 2 && c.words.slice(-2).join(' ') === phrase);
  }
  return [];
}

// Tách câu bỏ dấu thành token: từ, "d/c", "d.c", dấu câu (mỗi ký tự).
function tokenize(folded) {
  const re = /d\/c|d\.c|[a-z0-9]+|[^\sa-z0-9]/g;
  const out = [];
  let m;
  while ((m = re.exec(folded))) out.push({ t: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

// Trả về {len, required} nếu tại token i có từ dẫn chỉ người.
function triggerAt(orig, folded, toks, i) {
  const a = toks[i];
  if (!a) return null;
  const b = toks[i + 1];
  const ok = (end, forms) => origMatches(orig, folded, a.start, end, forms);
  if (a.t === 'giao' && b && b.t === 'cho' && b.start === a.end + 1 && ok(b.end, ['giao cho'])) {
    return { len: 2, required: true };
  }
  if (a.t === 'dong' && b && b.t === 'chi' && b.start === a.end + 1 && ok(b.end, ['đồng chí'])) {
    return { len: 2, required: true };
  }
  if (a.t === 'd/c' || a.t === 'd.c' || a.t === 'dc') return { len: 1, required: true };
  if (a.t === 'giao' && ok(a.end, ['giao'])) return { len: 1, required: false };
  return null;
}

const isWord = (tok) => tok && /^[a-z0-9]+$/.test(tok.t);
const SEPARATORS = new Set([',', 'va', 'cung', 'voi']);

function parsePeople(orig, folded, cands, blocked) {
  const nameTokens = new Set(cands.flatMap((c) => c.words));
  const toks = tokenize(folded).filter((t) => !blocked(t.start, t.end));
  const persons = [];
  const spans = [];

  // Đọc một cụm tên bắt đầu ở token i. Trả về {person, next} hoặc null.
  const readName = (i, required) => {
    const words = [];
    for (let j = i; j < toks.length && words.length < 4; j++) {
      if (!isWord(toks[j]) || SEPARATORS.has(toks[j].t) || triggerAt(orig, folded, toks, j)) break;
      if (!nameTokens.has(toks[j].t)) break;
      words.push(toks[j]);
    }
    for (let k = words.length; k >= 1; k--) {
      const found = resolveName(cands, words.slice(0, k).map((w) => w.t).join(' '));
      if (found.length) return { person: { words: words.slice(0, k), found }, next: i + k };
    }
    if (!required) return null;
    let take = words;
    if (!take.length) {
      const w = toks[i];
      if (!isWord(w) || SEPARATORS.has(w.t) || triggerAt(orig, folded, toks, i)) return null;
      take = [w];
    }
    return { person: { words: take, found: [] }, next: i + take.length };
  };

  let i = 0;
  while (i < toks.length) {
    const trg = triggerAt(orig, folded, toks, i);
    if (!trg) { i += 1; continue; }
    // Chuỗi người: [từ dẫn] tên (nối [từ dẫn] tên)*
    const chainStart = toks[i].start;
    let chainEnd = null;
    let j = i;
    let cur = trg;
    for (;;) {
      j += cur ? cur.len : 0;
      // "giao" + từ dẫn khác ("giao đ/c Hùng"): bỏ qua "giao".
      const inner = triggerAt(orig, folded, toks, j);
      if (inner && cur && inner.required) { cur = inner; continue; }
      const r = readName(j, cur ? cur.required : false);
      if (!r) break;
      persons.push(r.person);
      chainEnd = toks[r.next - 1].end;
      j = r.next;
      const sep = toks[j];
      if (!sep || !SEPARATORS.has(sep.t)) break;
      const nextTrg = triggerAt(orig, folded, toks, j + 1);
      if (nextTrg) { j += 1; cur = nextTrg; continue; }
      // Sau từ nối không có từ dẫn: chỉ nhận nếu là tên khớp được.
      const probe = readName(j + 1, false);
      if (!probe) break;
      j += 1;
      cur = null;
    }
    if (chainEnd !== null) {
      spans.push({ start: chainStart, end: chainEnd });
      i = toks.findIndex((t) => t.start >= chainEnd);
      if (i < 0) break;
    } else {
      i += 1;
    }
  }
  return { persons, spans };
}

function buildTitle(orig, spans) {
  let s = orig;
  const sorted = [...spans].sort((a, b) => b.start - a.start);
  for (const sp of sorted) s = s.slice(0, sp.start) + ' ' + s.slice(sp.end);
  s = s.replace(/\s+/g, ' ')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/^[\s,;:.!?\-–—]+|[\s,;:.!?\-–—]+$/g, '')
    .trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

function parseTaskSentence(db, text, today) {
  const orig = normalizeText(text).replace(/\s+/g, ' ').trim();
  if (!orig) throw new AppError('Chưa có nội dung công việc');
  const folded = foldAligned(orig);
  const removed = [];
  const blocked = (s, e) => removed.some((r) => s < r.end && r.start < e);

  const due = resolveDatePhrase(orig, today);
  if (due) removed.push({ start: due.start, end: due.end });

  const pr = detectPriority(orig, folded);
  for (const s of pr.spans) if (!blocked(s.start, s.end)) removed.push(s);

  const cands = loadCandidates(db);
  const people = parsePeople(orig, folded, cands, blocked);
  removed.push(...people.spans);

  const assignees = [];
  const ambiguous = [];
  const unmatched = [];
  const notes = [];
  for (const p of people.persons) {
    const phrase = orig.slice(p.words[0].start, p.words[p.words.length - 1].end);
    if (p.found.length === 1) {
      const c = p.found[0];
      if (!assignees.some((a) => a.id === c.id)) assignees.push({ id: c.id, full_name: c.full_name });
    } else if (p.found.length > 1) {
      ambiguous.push({
        phrase,
        candidates: p.found.map((c) => ({ id: c.id, full_name: c.full_name, unit_name: c.unit_name })),
      });
      notes.push(`Có ${p.found.length} người tên '${phrase}' — đồng chí chọn đúng người.`);
    } else {
      unmatched.push(phrase);
      notes.push(`Không tìm thấy người tên '${phrase}' (có thể đã bị khóa hoặc chưa có tài khoản).`);
    }
  }
  if (!people.persons.length) notes.push('Chưa xác định người thực hiện — đồng chí chọn trong biểu mẫu.');
  if (!due) notes.push('Chưa xác định hạn hoàn thành.');

  const title = buildTitle(orig, removed);
  if (!/[\p{L}\p{N}]/u.test(title)) throw new AppError('Chưa có nội dung công việc');

  return {
    title,
    assignees,
    ambiguous,
    unmatched,
    due_date: due ? due.date : null,
    due_phrase: due ? due.phrase : null,
    priority: pr.priority,
    category: detectCategory(orig, folded),
    notes,
  };
}

module.exports = { parseTaskSentence };
