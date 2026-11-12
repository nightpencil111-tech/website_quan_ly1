const RANKS = [
  'Binh nhì', 'Binh nhất', 'Hạ sĩ', 'Trung sĩ', 'Thượng sĩ',
  'Thiếu úy', 'Trung úy', 'Thượng úy', 'Đại úy',
  'Thiếu tá', 'Trung tá', 'Thượng tá', 'Đại tá',
  'Quân nhân chuyên nghiệp', 'Công nhân viên quốc phòng',
];
const RANKS_WITHOUT_INTERVAL = ['Quân nhân chuyên nghiệp', 'Công nhân viên quốc phòng'];

const SOLDIER_LABELS = {
  status: { dang_cong_tac: 'Đang công tác', da_ra_quan: 'Đã ra quân', chuyen_don_vi: 'Chuyển đơn vị' },
  gender: { nam: 'Nam', nu: 'Nữ' },
  awardKind: { khen_thuong: 'Khen thưởng', ky_luat: 'Kỷ luật' },
  leaveKind: { phep: 'Nghỉ phép', tranh_thu: 'Tranh thủ' },
  thoughtLevel: { binh_thuong: 'Bình thường', can_quan_tam: 'Cần quan tâm', dac_biet: 'Đặc biệt' },
  milestoneKind: {
    chuyen_dang: 'Chuyển Đảng chính thức',
    het_han_phuc_vu: 'Hết hạn phục vụ tại ngũ',
    nien_han_quan_ham: 'Đến niên hạn xét thăng quân hàm',
  },
};

module.exports = { RANKS, RANKS_WITHOUT_INTERVAL, SOLDIER_LABELS };
