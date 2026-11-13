// Hỏi đáp dữ liệu theo mẫu câu (không dùng AI): nhận diện ý định trên câu đã bỏ dấu rồi truy vấn
// các service sẵn có. Chỉ trả về những cột an toàn (tên, đơn vị, ngày, số liệu) — tuyệt đối không
// đưa dữ liệu tư tưởng/hoàn cảnh/ghi chú hồ sơ vào câu trả lời.
const { fold } = require('../../util/text');
const { LABELS } = require('../../util/text');
const { SOLDIER_LABELS } = require('../../util/ranks');
const { addDays, daysBetween, fmtDate } = require('../../util/date');
const tasksSvc = require('./../tasks');
const smart = require('./../smart');
const milestones = require('./../milestones');
const soldiersSvc = require('./../soldiers');
const reports = require('./../reports');
const users = require('./../users');
const { findPersonByText } = require('./taskParser');

const DENIED = 'Đồng chí không có quyền xem thông tin này';
const ALL = ['admin', 'manager', 'member'];
const MGR = ['admin', 'manager'];
const isMgr = (u) => MGR.includes(u.role);

// ---- Phạm vi thời gian ----
function parseScope(f, today, def = 'tuan_nay') {
  let key = def;
  if (/\bhom nay\b/.test(f)) key = 'hom_nay';
  else if (/\b7 ngay (toi|ke tiep|sap toi|qua)\b/.test(f)) key = 'bay_ngay';
  else if (/\bthang nay\b/.test(f)) key = 'thang_nay';
  else if (/\btuan nay\b/.test(f)) key = 'tuan_nay';
  const week = reports.weekRange(today);
  const month = reports.monthRange(today);
  switch (key) {
    case 'hom_nay': return { key, label: 'hôm nay', from: today, to: today };
    case 'bay_ngay': return { key, label: '7 ngày tới', from: today, to: addDays(today, 7) };
    case 'thang_nay': return { key, label: 'tháng này', from: today, to: month.to };
    default: return { key: 'tuan_nay', label: 'tuần này', from: today, to: week.to };
  }
}

// ---- Dựng hàng ----
const who = (t) => (t.assignees || []).map((a) => a.full_name).join(', ');
function taskRow(t) {
  const st = LABELS.status[t.status] + (t.overdue ? ' (quá hạn)' : '');
  return { cells: [t.title, who(t) || '—', fmtDate(t.due_date) || '—', st], href: `/tasks/${t.id}` };
}
const TASK_COLS = ['Công việc', 'Người thực hiện', 'Hạn', 'Trạng thái'];
const open = (list) => list.filter((t) => t.status !== 'hoan_thanh');
const soldierHref = (id) => `/soldiers/${id}`;

function res(intent, summary, rows, extra = {}) {
  return { intent, summary, rows, ...extra };
}

// ---- Truy vấn ----
function qViecQuaHan({ db, user, today, mine }) {
  const filters = { overdue: true };
  const own = mine || !isMgr(user);
  if (own) filters.assignee_id = user.id;
  const list = tasksSvc.listTasks(db, filters, today);
  const n = list.length;
  return res('viec_qua_han', n ? `Có ${n} việc quá hạn${own ? ' của đồng chí' : ''}.` : 'Không có việc nào quá hạn.',
    list.map(taskRow), { columns: TASK_COLS, empty_text: 'Không có việc nào quá hạn.' });
}

function qViecCuaToi({ db, user, today }) {
  const list = open(tasksSvc.listTasks(db, { assignee_id: user.id }, today));
  const n = list.length;
  return res('viec_cua_toi', n ? `Đồng chí có ${n} việc chưa hoàn thành.` : 'Đồng chí không có việc nào chưa hoàn thành.',
    list.map(taskRow), { columns: TASK_COLS, empty_text: 'Đồng chí không có việc nào chưa hoàn thành.' });
}

function qViecDenHan({ db, user, today, f, mine }) {
  const sc = parseScope(f, today);
  const filters = { from: sc.from, to: sc.to };
  const own = mine || !isMgr(user);
  if (own) filters.assignee_id = user.id;
  const list = open(tasksSvc.listTasks(db, filters, today));
  const n = list.length;
  return res('viec_den_han', n ? `Có ${n} việc đến hạn ${sc.label}.` : `Không có việc nào đến hạn ${sc.label}.`,
    list.map(taskRow), { columns: TASK_COLS, empty_text: `Không có việc nào đến hạn ${sc.label}.` });
}

function qViecCua({ db, today, rest }) {
  const { phrase, found } = findPersonByText(db, rest);
  if (!found.length) {
    return res('viec_cua', `Không tìm thấy đồng chí${phrase ? ` tên '${phrase}'` : ''}.`, [], { columns: TASK_COLS });
  }
  if (found.length > 1) {
    const names = found.map((c) => `${c.full_name}${c.unit_name ? ` (${c.unit_name})` : ''}`).join('; ');
    return res('viec_cua', `Có ${found.length} đồng chí tên '${phrase}', đồng chí nói rõ họ tên: ${names}.`,
      found.map((c) => ({ cells: [c.full_name, c.unit_name || '—'] })), { columns: ['Họ tên', 'Đơn vị'], ambiguous: true });
  }
  const p = found[0];
  const list = open(tasksSvc.listTasks(db, { assignee_id: p.id }, today));
  const n = list.length;
  return res('viec_cua', n ? `Đồng chí ${p.full_name} có ${n} việc chưa hoàn thành.` : `Đồng chí ${p.full_name} không có việc nào chưa hoàn thành.`,
    list.map(taskRow), { columns: TASK_COLS, empty_text: `Đồng chí ${p.full_name} không có việc nào chưa hoàn thành.` });
}

function qNghiPhep({ db, today, f }) {
  const sc = parseScope(f, today, 'hom_nay');
  const from = sc.key === 'hom_nay' ? today : sc.from;
  const to = sc.key === 'hom_nay' ? today : sc.to;
  const rows = db.prepare(
    `SELECT l.kind, l.from_date, l.to_date, s.id AS soldier_id, s.full_name, un.name AS unit_name
       FROM soldier_leaves l JOIN soldiers s ON s.id = l.soldier_id LEFT JOIN units un ON un.id = s.unit_id
      WHERE s.status = 'dang_cong_tac' AND l.from_date IS NOT NULL
        AND l.from_date <= ? AND COALESCE(l.to_date, l.from_date) >= ?
      ORDER BY l.from_date, s.full_name`
  ).all(to, from);
  const n = new Set(rows.map((r) => r.soldier_id)).size;
  const label = sc.key === 'hom_nay' ? 'hôm nay' : sc.label;
  return res('nghi_phep', n ? `Có ${n} đồng chí nghỉ phép/tranh thủ ${label}.` : `Không có đồng chí nào nghỉ phép ${label}.`,
    rows.map((r) => ({
      cells: [r.full_name, r.unit_name || '—', SOLDIER_LABELS.leaveKind[r.kind] || r.kind,
        `${fmtDate(r.from_date)} – ${fmtDate(r.to_date || r.from_date)}`],
      href: soldierHref(r.soldier_id),
    })), { columns: ['Họ tên', 'Đơn vị', 'Loại', 'Thời gian'], empty_text: `Không có đồng chí nào nghỉ phép ${label}.` });
}

function milestoneAnswer(code, kind, noun, { db, today }) {
  const m = milestones.upcomingMilestones(db, today);
  const items = m.items.filter((i) => i.kind === kind);
  const n = items.length;
  const unconfigured = m.missingConfig.includes(kind);
  const empty = unconfigured && !n ? `Chưa cấu hình thông số nên chưa tính được mốc ${noun}.` : `Không có ai sắp ${noun}.`;
  return res(code, n ? `Có ${n} đồng chí sắp ${noun}.` : empty,
    items.map((i) => ({
      cells: [i.full_name, i.unit_name || '—', fmtDate(i.due_date),
        i.days_left >= 0 ? `còn ${i.days_left} ngày` : `quá ${-i.days_left} ngày`],
      href: soldierHref(i.soldier_id),
    })), { columns: ['Họ tên', 'Đơn vị', 'Ngày', 'Thời hạn'], empty_text: empty });
}

function qDemDangDoan({ db }) {
  const list = soldiersSvc.listSoldiers(db, { status: 'dang_cong_tac' });
  const c = { dang_vien: 0, du_bi: 0, doan_vien: 0, khong: 0 };
  for (const s of list) c[s.party_state] += 1;
  return res('dem_dang_doan',
    `Có ${c.dang_vien} đảng viên chính thức, ${c.du_bi} đảng viên dự bị, ${c.doan_vien} đoàn viên trên tổng số ${list.length} quân nhân đang công tác.`,
    [
      { cells: ['Đảng viên chính thức', String(c.dang_vien)] },
      { cells: ['Đảng viên dự bị', String(c.du_bi)] },
      { cells: ['Đoàn viên', String(c.doan_vien)] },
      { cells: ['Chưa vào Đảng, Đoàn', String(c.khong)] },
    ], { columns: ['Nhóm', 'Số lượng'] });
}

function qDanhSachDonVi({ db, f }) {
  const units = users.listUnits(db);
  let best = null;
  for (const u of units) {
    const name = fold(u.name).trim();
    if (!name) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(f) && (!best || name.length > fold(best.name).length)) best = u;
  }
  if (!best) {
    return res('danh_sach_don_vi', `Có ${units.length} đơn vị. Đồng chí nói rõ tên đơn vị để xem danh sách quân nhân.`,
      units.map((u) => ({ cells: [u.name, String(u.member_count)] })), { columns: ['Đơn vị', 'Số tài khoản'] });
  }
  const list = soldiersSvc.listSoldiers(db, { unit_id: best.id, status: 'dang_cong_tac' });
  const n = list.length;
  return res('danh_sach_don_vi', n ? `${best.name} có ${n} quân nhân đang công tác.` : `${best.name} chưa có quân nhân nào.`,
    list.map((s) => ({ cells: [s.full_name, s.rank || '—', s.position || '—'], href: soldierHref(s.id) })),
    { columns: ['Họ tên', 'Cấp bậc', 'Chức vụ'], empty_text: `${best.name} chưa có quân nhân nào.` });
}

function qQuaTai({ db }) {
  const list = smart.overloadWarnings(db);
  const n = list.length;
  return res('qua_tai', n ? `Có ${n} đồng chí đang quá tải công việc.` : 'Không có đồng chí nào quá tải.',
    list.map((w) => ({
      cells: [w.full_name, `${w.open_count} việc đang mở`,
        w.same_day.length ? w.same_day.map((d) => `${d.count} việc cùng hạn ${fmtDate(d.date)}`).join('; ') : '—'],
    })), { columns: ['Họ tên', 'Việc đang mở', 'Ghi chú'], empty_text: 'Không có đồng chí nào quá tải.' });
}

// Chỉ số liệu tổng hợp — không nêu tên ai và không có thông tin tư tưởng.
function qTinhHinh({ db, user, today, f }) {
  const sc = parseScope(f, today);
  const stats = reports.dashboardStats(db, user, today);
  const c = stats.counts;
  let doneFrom = reports.weekRange(today).from;
  let doneLabel = 'tuần này';
  if (sc.key === 'hom_nay') { doneFrom = today; doneLabel = 'hôm nay'; }
  else if (sc.key === 'thang_nay') { doneFrom = reports.monthRange(today).from; doneLabel = 'tháng này'; }
  else if (sc.key === 'bay_ngay') { doneFrom = addDays(today, -6); doneLabel = '7 ngày qua'; }
  const filters = { status: 'hoan_thanh', done_from: doneFrom, done_to: today };
  if (!isMgr(user)) filters.assignee_id = user.id;
  const done = tasksSvc.listTasks(db, filters, today).length;
  const rows = [
    { cells: ['Chưa làm', String(c.chua_lam)] },
    { cells: ['Đang làm', String(c.dang_lam)] },
    { cells: ['Chờ duyệt', String(c.cho_duyet)] },
    { cells: ['Hoàn thành (tổng)', String(c.hoan_thanh)] },
    { cells: ['Quá hạn', String(c.overdue)] },
    { cells: [`Hoàn thành ${doneLabel}`, String(done)] },
  ];
  let summary = `${isMgr(user) ? 'Toàn đơn vị' : 'Đồng chí'} có ${c.total} việc, ${c.overdue} việc quá hạn, đã hoàn thành ${done} việc ${doneLabel}.`;
  if (isMgr(user)) {
    const onLeave = milestones.soldierStats(db, today).onLeaveToday;
    const upcoming = milestones.upcomingMilestones(db, today).items.length;
    rows.push({ cells: ['Quân nhân nghỉ phép hôm nay', String(onLeave)] });
    rows.push({ cells: ['Mốc sắp đến hạn', String(upcoming)] });
    summary += ` Hôm nay có ${onLeave} quân nhân nghỉ phép, ${upcoming} mốc sắp đến hạn.`;
  }
  return res('tinh_hinh', summary, rows, { columns: ['Chỉ số', 'Số lượng'] });
}

// ---- Ý định: thứ tự = mức cụ thể giảm dần ----
const INTENTS = [
  { code: 'viec_cua_toi', roles: ALL, run: qViecCuaToi, patterns: [
    /\b(viec|nhiem vu)( cua)? (toi|minh|em)\b(?! (qua han|den han))/,
    /\b(toi|minh) (dang )?(co|phai|can) (lam )?(nhung |cac )?(viec|nhiem vu)/,
  ] },
  { code: 'viec_cua', roles: MGR, run: qViecCua, patterns: [/\b(viec|nhiem vu) cua (?!toi\b|minh\b|em\b)\S/] },
  { code: 'viec_qua_han', roles: ALL, run: qViecQuaHan, patterns: [
    /\bqua han\b.*\b(viec|nhiem vu|cong viec)\b/, /\b(viec|nhiem vu|cong viec)\b.*\bqua han\b/, /\bqua han\b/,
  ] },
  { code: 'qua_tai', roles: MGR, run: qQuaTai, patterns: [/\bqua tai\b/, /\bnhieu viec nhat\b/, /\bai\b.*\bqua nhieu viec\b/] },
  { code: 'viec_den_han', roles: ALL, run: qViecDenHan, patterns: [
    /\b(viec|nhiem vu|cong viec)\b.*\b(den han|sap han|sap den han|het han)\b/,
    /\b(den han|sap den han|sap het han)\b.*\b(viec|nhiem vu|cong viec)\b/,
    /\b(viec|nhiem vu|cong viec) (hom nay|tuan nay|thang nay|7 ngay toi)\b/,
    /\bhan (hom nay|tuan nay|thang nay)\b/,
  ] },
  { code: 'nghi_phep', roles: MGR, run: qNghiPhep, patterns: [/\b(nghi phep|di phep|tranh thu|dang nghi)\b/, /\bai\b.*\bnghi\b/] },
  { code: 'chuyen_dang', roles: MGR, run: (c) => milestoneAnswer('chuyen_dang', 'chuyen_dang', 'chuyển Đảng chính thức', c),
    patterns: [/\bchuyen dang\b/, /\bdang chinh thuc\b/, /\bdang vien du bi\b.*\bchuyen\b/] },
  { code: 'het_han_phuc_vu', roles: MGR, run: (c) => milestoneAnswer('het_han_phuc_vu', 'het_han_phuc_vu', 'hết hạn phục vụ tại ngũ', c),
    patterns: [/\bhet han phuc vu\b/, /\bxuat ngu\b/, /\bra quan\b/, /\bphuc vu tai ngu\b/] },
  { code: 'nien_han', roles: MGR, run: (c) => milestoneAnswer('nien_han', 'nien_han_quan_ham', 'đến niên hạn xét thăng quân hàm', c),
    patterns: [/\bnien han\b/, /\bthang quan ham\b/, /\blen quan ham\b/, /\bxet quan ham\b/] },
  { code: 'dem_dang_doan', roles: MGR, run: qDemDangDoan, patterns: [
    /\b(bao nhieu|dem|so luong|thong ke)\b.*\b(dang vien|doan vien|du bi)\b/, /\b(dang vien|doan vien)\b/,
  ] },
  { code: 'danh_sach_don_vi', roles: MGR, run: qDanhSachDonVi, patterns: [
    /\b(danh sach|liet ke|quan so|ds)\b/, /\bdon vi\b.*\b(co|gom)\b.*\b(ai|nhung ai)\b/,
  ] },
  { code: 'tinh_hinh', roles: ALL, run: qTinhHinh, patterns: [/\btinh hinh\b/, /\btong quan\b/, /\btong hop\b/, /\btong ket\b/, /\bbao cao nhanh\b/] },
];

const SUGGESTIONS = {
  member: [
    'Việc nào quá hạn?', 'Việc của tôi', 'Việc đến hạn hôm nay',
    'Việc đến hạn tuần này', 'Việc đến hạn 7 ngày tới', 'Tình hình tuần này',
  ],
  manager: [
    'Việc nào quá hạn?', 'Việc đến hạn tuần này', 'Ai đang nghỉ phép hôm nay?',
    'Ai sắp chuyển Đảng chính thức?', 'Ai đang quá tải?', 'Tình hình tuần này',
  ],
};

function suggestions(role) {
  return [...(role === 'member' ? SUGGESTIONS.member : SUGGESTIONS.manager)];
}

function normalizeQuestion(text) {
  return fold(String(text ?? '').normalize('NFC'))
    .replace(/[?!,;:"“”]+/g, ' ').replace(/\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

function answer(db, user, text, today) {
  const f = normalizeQuestion(text);
  const intent = INTENTS.find((i) => i.patterns.some((p) => p.test(f)));
  if (!intent) {
    return {
      intent: null,
      summary: 'Tôi chưa hiểu câu hỏi. Đồng chí thử một trong các câu mẫu bên dưới.',
      rows: [],
      suggestions: suggestions(user.role),
    };
  }
  if (!intent.roles.includes(user.role)) {
    return { intent: intent.code, denied: true, summary: DENIED, rows: [] };
  }
  const m = /\b(?:viec|nhiem vu) cua (.+)$/.exec(f);
  const mine = /\bcua (toi|minh)\b/.test(f);
  return intent.run({ db, user, today, f, rest: m ? m[1] : '', mine });
}

module.exports = { INTENTS, answer, suggestions };
