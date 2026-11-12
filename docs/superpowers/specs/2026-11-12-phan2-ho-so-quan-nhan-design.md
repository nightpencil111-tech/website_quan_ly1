# Thiết kế Phần 2: Hồ sơ quân nhân

Ngày: 12/11/2026 · Trạng thái: chờ duyệt · Kế thừa: `2026-11-11-quanly-ctv-design.md` (Phần 1)

## 1. Mục đích và phạm vi

Bổ sung chức năng quản lý **hồ sơ toàn bộ quân nhân** của đơn vị: lý lịch, gia đình, quá trình công tác, khen thưởng – kỷ luật, phép – tranh thủ, diễn biến tư tưởng; **nhắc mốc** (chuyển Đảng chính thức, hết hạn phục vụ, niên hạn quân hàm); xuất/nhập Excel.

**Quyết định đã chốt với người dùng:**
- Quân nhân **có thể không có tài khoản**; hồ sơ là thực thể riêng, Admin liên kết với tài khoản khi cần.
- **Không đặt sẵn thời hạn** cho các mốc; Admin tự nhập. Mốc chưa cấu hình → không tính, hiển thị "Chưa cấu hình".
- Chiến sĩ được xem hồ sơ của chính mình (chỉ đọc), **trừ** mục tư tưởng và ghi chú hoàn cảnh gia đình.

Mọi ràng buộc chung của Phần 1 giữ nguyên: offline, tiếng Việt, ngày `YYYY-MM-DD` theo giờ VN, kiểm tra quyền phía máy chủ, CSRF, nhật ký, không thêm thư viện ngoài (dùng `exceljs` sẵn có cho nhập/xuất).

## 2. Mô hình dữ liệu (migration mới, không sửa bảng cũ)

`soldiers`
- id, user_id (NULL, UNIQUE, → users ON DELETE SET NULL)
- full_name (bắt buộc), birth_date, gender (`nam`/`nu`), hometown, residence, ethnicity, religion, education (văn hóa), specialty (chuyên môn)
- rank, rank_date, position, unit_id (→ units), enlist_date, discharge_date (dự kiến xuất ngũ, nhập tay; nếu trống mà đã cấu hình số tháng phục vụ thì tính từ enlist_date)
- youth_join_date, party_join_date, party_official_date
- health_class, blood_type, phone
- status: `dang_cong_tac` / `da_ra_quan` / `chuyen_don_vi` (mặc định `dang_cong_tac`)
- notes, created_at, updated_at

Bảng con (đều có `soldier_id → soldiers ON DELETE CASCADE`):
- `soldier_family`: relation, full_name, birth_year, job, address, **hardship_note** (ghi chú hoàn cảnh – nhạy cảm)
- `soldier_career`: from_date, to_date, position, unit_text
- `soldier_awards`: kind (`khen_thuong`/`ky_luat`), date, form (hình thức), reason, decision_no
- `soldier_leaves`: kind (`phep`/`tranh_thu`), from_date, to_date, destination, note
- `soldier_thoughts` (**nhạy cảm**): date, content, level (`binh_thuong`/`can_quan_tam`/`dac_biet`), measures, recorded_by (→ users)

`settings` (bảng có sẵn) thêm khóa: `party_probation_months`, `service_months`, `rank_intervals` (JSON: `{"Binh nhì": 6, "Thiếu úy": 24, …}` – số tháng để lên bậc kế), `reminder_days` (mặc định 30). Ba khóa đầu mặc định **không có**.

Danh mục cấp bậc theo thứ tự (dùng cho chọn cấp bậc và niên hạn): Binh nhì, Binh nhất, Hạ sĩ, Trung sĩ, Thượng sĩ, Thiếu úy, Trung úy, Thượng úy, Đại úy, Thiếu tá, Trung tá, Thượng tá, Đại tá, Quân nhân chuyên nghiệp, Công nhân viên quốc phòng. Hai mục cuối không có niên hạn.

## 3. Nhắc mốc (service `milestones.js`)

`upcomingMilestones(db, today)` → danh sách `{soldier_id, full_name, unit, kind, due_date, days_left}` cho quân nhân `dang_cong_tac`, `0 ≤ days_left ≤ reminder_days` hoặc đã quá hạn tối đa 30 ngày (để không bị bỏ sót):
- `chuyen_dang`: có party_join_date, chưa có party_official_date, đã cấu hình `party_probation_months` → due = party_join_date + N tháng.
- `het_han_phuc_vu`: discharge_date nếu có; ngược lại enlist_date + `service_months` (nếu cấu hình).
- `nien_han_quan_ham`: rank_date + `rank_intervals[rank]` (nếu cấu hình cho cấp bậc đó).

Cộng tháng: ngày cuối tháng được kẹp (31/01 + 1 tháng = 28/02 hoặc 29/02 năm nhuận). Mốc chưa cấu hình được liệt kê trong `missingConfig` để giao diện hiển thị "Chưa cấu hình".

Thống kê thêm: `onLeaveToday` (có bản ghi phép bao trùm hôm nay), `needAttention` (bản ghi tư tưởng **mới nhất** của người đó có mức `can_quan_tam` hoặc `dac_biet`).

## 4. Phân quyền

| Chức năng | admin / manager | member |
|---|---|---|
| Danh sách, xem, thêm, sửa, xóa hồ sơ và mục con | ✔ | ✘ |
| Xem hồ sơ của chính mình (`/my-profile`, qua user_id liên kết) | ✔ | ✔ chỉ đọc, **ẩn** thẻ Tư tưởng và trường hardship_note |
| Liên kết hồ sơ ↔ tài khoản | admin | ✘ |
| Cấu hình thời hạn | admin | ✘ |
| Nhập/xuất Excel | ✔ | ✘ |

Phần ẩn phải được lọc **ở service/route**, không chỉ ẩn trên giao diện. Nhật ký: `soldier_view` (mỗi lần mở hồ sơ, kể cả member tự xem), `soldier_create/update/delete`, `soldier_<mục>_create/update/delete`, `soldier_import`, `soldier_export`, `milestone_settings`.

## 5. Giao diện

- Menu mới **"Hồ sơ quân nhân"** (admin, manager); member có mục **"Hồ sơ của tôi"** nếu tài khoản đã liên kết.
- `/soldiers`: bảng họ tên, cấp bậc, chức vụ, đơn vị, Đảng/Đoàn, trạng thái; lọc đơn vị, cấp bậc, Đảng/Đoàn, trạng thái; tìm kiếm không dấu (dùng `fold`); nút Thêm, Xuất Excel, Nhập Excel.
- `/soldiers/:id`: đầu trang tóm tắt + thẻ **Lý lịch / Gia đình / Công tác / Khen thưởng – Kỷ luật / Phép / Tư tưởng**; mỗi thẻ con là bảng + form thêm/sửa/xóa (POST + confirm).
- `/soldiers/milestones`: danh sách mốc sắp đến, nhóm theo loại, kèm cảnh báo cấu hình còn thiếu.
- Tổng quan (admin/manager): hộp "Mốc sắp đến" (5 dòng gần nhất), số người đang nghỉ phép, số người cần quan tâm tư tưởng.
- Quản trị → Cài đặt: phần "Thời hạn nhắc mốc" (số tháng dự bị Đảng, số tháng phục vụ, bảng niên hạn theo cấp bậc, số ngày báo trước).
- Quản trị → Tài khoản: form tài khoản có ô chọn hồ sơ để liên kết (hồ sơ chưa liên kết); trang hồ sơ hiển thị tài khoản liên kết.

## 6. Nhập / xuất Excel

- Xuất "Danh sách trích ngang" theo bộ lọc: STT, Họ tên, Ngày sinh, Cấp bậc, Chức vụ, Đơn vị, Nhập ngũ, Quê quán, Đảng/Đoàn, Trạng thái. Không xuất dữ liệu tư tưởng.
- Nhập: tải **file mẫu** (cùng cột như trên + Dân tộc, Tôn giáo, Văn hóa, SĐT; ngày dạng dd/mm/yyyy hoặc ô ngày Excel). Tải lên → trang **xem trước**: dòng hợp lệ, dòng lỗi kèm lý do (thiếu họ tên, ngày sai, đơn vị không tồn tại → gợi ý tạo đơn vị trước). Bấm **Xác nhận** mới ghi (một giao dịch). Trùng họ tên + ngày sinh với hồ sơ có sẵn → bỏ qua và báo. Giới hạn file 2MB, chỉ `.xlsx`.
- File tải lên đọc trong bộ nhớ (không lưu đĩa). Dữ liệu xem trước giữ trong phiên tạm (bảng `import_drafts` hoặc bộ nhớ có hết hạn 30 phút) – dùng bảng để an toàn khi khởi động lại.

## 7. Xử lý lỗi

Theo Phần 1: AppError → báo trên form, giữ dữ liệu đã nhập; id không tồn tại → 404; không đủ quyền → 403. Ngày kết thúc phải ≥ ngày bắt đầu (công tác, phép). party_official_date ≥ party_join_date.

## 8. Kiểm thử

- Service: tính mốc (chưa cấu hình, cuối tháng, năm nhuận, đã chuyển chính thức thì không nhắc, ra quân thì không nhắc), onLeaveToday, needAttention theo bản ghi mới nhất.
- Quyền: member không vào `/soldiers`, `/soldiers/:id`; member tự xem không thấy tư tưởng và hardship_note (kiểm tra thân trang); member không liên kết → `/my-profile` báo chưa liên kết.
- Nhập Excel: file đúng, file có dòng lỗi, file không phải xlsx, trùng hồ sơ; xuất Excel rỗng vẫn có dòng tiêu đề.
- Nhật ký có `soldier_view`.
- Chụp màn hình các trang mới (dữ liệu demo bổ sung hồ sơ cho cs01…cs10 và ~10 quân nhân không tài khoản).

## 9. Ngoài phạm vi Phần 2

Ảnh chân dung, đính kèm tệp, in lý lịch theo mẫu Word (thuộc Phần 3), phân quyền theo đơn vị.
