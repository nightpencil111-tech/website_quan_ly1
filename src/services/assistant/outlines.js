// Dàn ý văn bản: văn bản thuần (các dòng cách nhau "\n") để đưa vào ô nhập nội dung.
const { AppError } = require('../../util/errors');
const reports = require('../reports');

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const lower1 = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

function topicOf(opts) {
  return clean(opts && opts.topic);
}

function keHoach(db, opts) {
  const topic = topicOf(opts);
  const T = topic ? lower1(topic) : '…';
  return [
    topic ? `KẾ HOẠCH ${topic.toUpperCase()}` : 'KẾ HOẠCH …',
    '',
    'I. MỤC ĐÍCH, YÊU CẦU',
    '1. Mục đích',
    `- Nhằm ${T}, góp phần nâng cao chất lượng công tác của đơn vị.`,
    '2. Yêu cầu',
    '- Bảo đảm đúng nội dung, đúng thời gian, đúng thành phần.',
    '- Thực hiện nghiêm quy định, bảo đảm an toàn tuyệt đối.',
    '',
    'II. NỘI DUNG',
    '1. …',
    '2. …',
    '',
    'III. THỜI GIAN, ĐỊA ĐIỂM',
    '- Thời gian: …',
    '- Địa điểm: …',
    '',
    'IV. LỰC LƯỢNG, THÀNH PHẦN',
    '- …',
    '',
    'V. TỔ CHỨC THỰC HIỆN',
    '- Phân công người chịu trách nhiệm từng nội dung: …',
    '- Báo cáo kết quả về cấp trên sau khi hoàn thành.',
    '',
    'VI. CÔNG TÁC BẢO ĐẢM',
    '- Vật chất, trang thiết bị: …',
    '- Quân y, an toàn: …',
  ].join('\n');
}

function baoCao(db, opts) {
  const topic = topicOf(opts);
  return [
    topic ? `BÁO CÁO ${topic.toUpperCase()}` : 'BÁO CÁO …',
    '',
    'I. TÌNH HÌNH CHUNG',
    `- Khái quát tình hình đơn vị${topic ? ` liên quan đến ${lower1(topic)}` : ''}: …`,
    '',
    'II. KẾT QUẢ THỰC HIỆN',
    '1. …',
    '2. …',
    '',
    'III. ƯU ĐIỂM, KHUYẾT ĐIỂM',
    '1. Ưu điểm: …',
    '2. Khuyết điểm, tồn tại: …',
    '',
    'IV. PHƯƠNG HƯỚNG, NHIỆM VỤ THỜI GIAN TỚI',
    '- …',
    '',
    'V. ĐỀ XUẤT, KIẾN NGHỊ',
    '- …',
  ].join('\n');
}

function baoCaoTuan(db, opts, today) {
  const { from, to } = reports.weekRange(today);
  const dm = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return `BÁO CÁO TUẦN (${dm(from)}–${dm(to)})\n${reports.periodReport(db, from, to, today).text}`;
}

function bienBan(db, opts) {
  const topic = topicOf(opts);
  return [
    topic ? `BIÊN BẢN ${topic.toUpperCase()}` : 'BIÊN BẢN SINH HOẠT',
    '',
    '1. Thời gian, địa điểm: …',
    '2. Thành phần: …',
    '- Có mặt: … đồng chí; vắng mặt: … đồng chí (lý do: …)',
    '3. Chủ trì, thư ký: …',
    `4. Nội dung${topic ? ` (${lower1(topic)})` : ''}:`,
    '- …',
    '- Ý kiến phát biểu: …',
    '5. Kết luận: …',
    '',
    'Cuộc họp kết thúc hồi … giờ … cùng ngày.',
  ].join('\n');
}

const OUTLINES = {
  ke_hoach: { label: 'Kế hoạch', build: keHoach },
  bao_cao: { label: 'Báo cáo', build: baoCao },
  bao_cao_tuan: { label: 'Báo cáo tuần', build: baoCaoTuan },
  bien_ban_sinh_hoat: { label: 'Biên bản sinh hoạt', build: bienBan },
};

function buildOutline(db, key, opts, today) {
  if (typeof key !== 'string' || !Object.hasOwn(OUTLINES, key)) throw new AppError('Mẫu dàn ý không hợp lệ');
  return OUTLINES[key].build(db, opts || {}, today);
}

module.exports = { OUTLINES, buildOutline };
