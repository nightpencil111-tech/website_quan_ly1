const { AppError } = require('../util/errors');
const { getSetting, setSetting } = require('./users');
const audit = require('./audit');

const MAX_LEN = 120;
// Khóa trường (không tiền tố) → nhãn; khóa lưu trong settings có tiền tố `unit_`.
const UNIT_KEYS = {
  cap_tren: 'Cấp trên', don_vi: 'Đơn vị', dang_uy: 'Đảng ủy', chi_bo: 'Chi bộ', dia_danh: 'Địa danh',
  nguoi_ky_chuc_vu: 'Chức vụ người ký', nguoi_ky_cap_bac: 'Cấp bậc người ký',
  nguoi_ky_ho_ten: 'Họ tên người ký', bi_thu_ho_ten: 'Họ tên bí thư',
};

function getUnitInfo(db) {
  const out = {};
  for (const k of Object.keys(UNIT_KEYS)) out[k] = String(getSetting(db, `unit_${k}`, '') ?? '');
  return out;
}

function saveUnitInfo(db, data = {}, actorId) {
  const vals = {};
  for (const [k, label] of Object.entries(UNIT_KEYS)) {
    const v = String(data[k] ?? '').trim();
    if (v.length > MAX_LEN) throw new AppError(`${label} không được quá ${MAX_LEN} ký tự`);
    vals[k] = v;
  }
  for (const [k, v] of Object.entries(vals)) setSetting(db, `unit_${k}`, v);
  audit.log(db, actorId, 'unit_info_settings', null, 'Cập nhật thông tin đơn vị');
}

module.exports = { UNIT_KEYS, getUnitInfo, saveUnitInfo };
