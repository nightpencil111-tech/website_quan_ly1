function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

const LABELS = {
  category: {
    cong_tac_dang: 'Công tác Đảng',
    giao_duc_ct: 'Giáo dục chính trị',
    thi_dua: 'Thi đua – Khen thưởng',
    dan_van: 'Dân vận',
    van_hoa: 'Văn hóa – Văn nghệ',
    huan_luyen: 'Huấn luyện',
    hau_can: 'Hậu cần – Kỹ thuật',
    khac: 'Khác',
  },
  priority: { thuong: 'Thường', gap: 'Gấp', hoa_toc: 'Hỏa tốc' },
  status: { chua_lam: 'Chưa làm', dang_lam: 'Đang làm', cho_duyet: 'Chờ duyệt', hoan_thanh: 'Hoàn thành' },
  role: { admin: 'Chỉ huy (Admin)', manager: 'Chính trị viên / Quản lý', member: 'Cán bộ / Chiến sĩ' },
};

const PRIORITY_WEIGHT = { thuong: 1, gap: 1.5, hoa_toc: 2 };

module.exports = { fold, LABELS, PRIORITY_WEIGHT };
