const { fmtDate } = require('../util/date');
const { SOLDIER_LABELS } = require('../util/ranks');
const { partyState } = require('./soldiers');
const { getUnitInfo } = require('./unitInfo');

const PARTY_LABELS = { dang_vien: 'Đảng viên', du_bi: 'Đảng viên dự bị', doan_vien: 'Đoàn viên', khong: 'Quần chúng' };

const c = (code, label, example) => ({ code, label, group: 'chung', example });
const q = (code, label, example) => ({ code, label, group: 'quan_nhan', example });

const FIELD_CATALOG = [
  c('cap_tren', 'Cấp trên', 'TIỂU ĐOÀN 4'),
  c('don_vi', 'Đơn vị', 'ĐẠI ĐỘI 3'),
  c('dang_uy', 'Đảng ủy', 'ĐẢNG ỦY TIỂU ĐOÀN 4'),
  c('chi_bo', 'Chi bộ', 'CHI BỘ ĐẠI ĐỘI 3'),
  c('dia_danh', 'Địa danh', 'Đồng Nai'),
  c('ngay_thang', 'Ngày tháng đầy đủ', 'Đồng Nai, ngày 12 tháng 11 năm 2026'),
  c('ngay', 'Ngày', '12'),
  c('thang', 'Tháng', '11'),
  c('nam', 'Năm', '2026'),
  c('nguoi_ky_chuc_vu', 'Chức vụ người ký', 'Đại đội trưởng'),
  c('nguoi_ky_cap_bac', 'Cấp bậc người ký', 'Thượng úy'),
  c('nguoi_ky_ho_ten', 'Họ tên người ký', 'Trần Văn Bình'),
  c('bi_thu_ho_ten', 'Họ tên bí thư', 'Lê Văn Cường'),
  q('stt', 'Số thứ tự', '1'),
  q('ho_ten', 'Họ và tên', 'Nguyễn Văn An'),
  q('ngay_sinh', 'Ngày sinh', '07/05/2003'),
  q('gioi_tinh', 'Giới tính', 'Nam'),
  q('cap_bac', 'Cấp bậc', 'Binh nhất'),
  q('chuc_vu', 'Chức vụ', 'Chiến sĩ'),
  q('don_vi_qn', 'Đơn vị của quân nhân', 'Đại đội 3'),
  q('que_quan', 'Quê quán', 'Đồng Nai'),
  q('noi_o', 'Nơi ở hiện nay', 'Biên Hòa, Đồng Nai'),
  q('dan_toc', 'Dân tộc', 'Kinh'),
  q('ton_giao', 'Tôn giáo', 'Không'),
  q('van_hoa', 'Trình độ văn hóa', '12/12'),
  q('chuyen_mon', 'Chuyên môn', 'Cơ khí'),
  q('nhap_ngu', 'Ngày nhập ngũ', '15/02/2025'),
  q('ngay_vao_doan', 'Ngày vào Đoàn', '26/03/2019'),
  q('ngay_vao_dang', 'Ngày vào Đảng', '02/01/2025'),
  q('ngay_chinh_thuc', 'Ngày chuyển Đảng chính thức', '02/01/2026'),
  q('dang_doan', 'Đảng viên/Đoàn viên', 'Đoàn viên'),
  q('suc_khoe', 'Sức khỏe (loại)', 'Loại 1'),
  q('sdt', 'Số điện thoại', '0901234567'),
];

// "Đồng Nai, ngày 2 tháng 11 năm 2026"; thiếu địa danh thì bỏ phần đầu.
function vnDateLine(diaDanh, isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const line = `ngày ${d} tháng ${m} năm ${y}`;
  const place = String(diaDanh ?? '').trim();
  return place ? `${place}, ${line}` : line;
}

function commonData(db, today, overrides = {}) {
  const info = getUnitInfo(db);
  const [y, m, d] = String(today).split('-').map(Number);
  const out = {
    ...info,
    ngay_thang: vnDateLine(info.dia_danh, today),
    ngay: String(d), thang: String(m), nam: String(y),
  };
  if (overrides.ngay_thang !== undefined && overrides.ngay_thang !== null && String(overrides.ngay_thang) !== '') {
    out.ngay_thang = String(overrides.ngay_thang);
  }
  return out;
}

const s = (v) => (v === undefined || v === null ? '' : String(v));

// Chỉ lấy trường được liệt kê; tuyệt đối không đụng tới tư tưởng / hoàn cảnh gia đình.
function soldierData(sol, stt) {
  return {
    stt: s(stt),
    ho_ten: s(sol.full_name),
    ngay_sinh: fmtDate(sol.birth_date),
    gioi_tinh: s(SOLDIER_LABELS.gender[sol.gender]),
    cap_bac: s(sol.rank),
    chuc_vu: s(sol.position),
    don_vi_qn: s(sol.unit_name),
    que_quan: s(sol.hometown),
    noi_o: s(sol.residence),
    dan_toc: s(sol.ethnicity),
    ton_giao: s(sol.religion),
    van_hoa: s(sol.education),
    chuyen_mon: s(sol.specialty),
    nhap_ngu: fmtDate(sol.enlist_date),
    ngay_vao_doan: fmtDate(sol.youth_join_date),
    ngay_vao_dang: fmtDate(sol.party_join_date),
    ngay_chinh_thuc: fmtDate(sol.party_official_date),
    dang_doan: PARTY_LABELS[partyState(sol)],
    suc_khoe: s(sol.health_class),
    sdt: s(sol.phone),
  };
}

module.exports = { FIELD_CATALOG, PARTY_LABELS, vnDateLine, commonData, soldierData };
