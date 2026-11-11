# Thiết kế: Hệ thống Quản lý – Giao việc cho Chính trị viên

Ngày: 11/11/2026 · Trạng thái: chờ duyệt

## 1. Mục đích và phạm vi

Website nội bộ giúp Chính trị viên và người chỉ huy **giao việc, theo dõi, đánh giá** công việc của cán bộ, chiến sĩ; về sau mở rộng sang hồ sơ quân nhân, tạo văn bản theo mẫu và trợ lý AI.

**Ràng buộc:**
- Chạy trong **mạng nội bộ, không cần Internet**. Không gửi dữ liệu ra ngoài.
- Chỉ người có tài khoản do Admin (người chỉ huy) cấp mới truy cập được.
- Chạy được trên máy cấu hình trung bình (ví dụ Surface, Windows) làm máy chủ.
- Giao diện tiếng Việt, người dùng trình độ tin học mức khá.

**Lộ trình 4 phần** (mỗi phần có kế hoạch và nghiệm thu riêng):

| Phần | Nội dung | Tài liệu này |
|---|---|---|
| 1 | Lõi: tài khoản, phân quyền, giao việc, lịch, bảng tổng hợp, thông minh Nhóm A, xuất Excel | **Thiết kế chi tiết** |
| 2 | Hồ sơ quân nhân, nhắc mốc, phép, tư tưởng | Định hướng |
| 3 | Kho mẫu Word, tự điền, tạo hàng loạt | Định hướng |
| 4 | Trợ lý AI cục bộ (Ollama) | Định hướng |

## 2. Kiến trúc (Phần 1)

- **Máy chủ:** Node.js ≥ 22.13 + Express. Giao diện kết xuất phía máy chủ bằng EJS, JavaScript phía trình duyệt chỉ dùng cho kéo thả Kanban, biểu đồ, form động.
- **Cơ sở dữ liệu:** SQLite qua mô-đun có sẵn `node:sqlite` (không cần biên dịch, chạy được cả Windows ARM). Một file `data/data.db`; sao lưu = chép file.
- **Thư viện ngoài tối thiểu:** `express`, `ejs`, `exceljs`. Biểu đồ dùng Chart.js đóng gói sẵn trong thư mục `public/vendor` (không tải từ Internet).
- **Khởi chạy:** `npm start` → lắng nghe cổng 3000 trên mọi địa chỉ; các máy trong mạng vào `http://<IP-máy-chủ>:3000`.

### Cấu trúc mã

```
src/
  server.js            khởi tạo app, gắn route
  db.js                kết nối, tạo bảng (migration), dữ liệu mẫu ban đầu
  auth.js              băm mật khẩu (scrypt), phiên đăng nhập, middleware phân quyền
  services/
    tasks.js           CRUD công việc, chuyển trạng thái, quá hạn
    smart.js           gợi ý người làm, quá tải, điểm ưu tiên, hiệu suất
    recurring.js       sinh việc định kỳ
    reports.js         tổng hợp số liệu, soạn báo cáo văn bản
    excel.js           xuất Excel
    audit.js           nhật ký
  routes/              auth, dashboard, tasks, calendar, users, units, templates, reports, admin
views/                 EJS
public/                css, js, vendor
test/                  kiểm thử (node:test)
```

Mỗi `service` chỉ làm việc với CSDL và không biết đến HTTP → kiểm thử độc lập được.

## 3. Phân quyền 3 cấp

| Vai trò | Mã | Quyền |
|---|---|---|
| Chỉ huy (Admin) | `admin` | Toàn quyền: tài khoản, đơn vị, cấu hình, nhật ký + mọi quyền của `manager` |
| Chính trị viên / Cán bộ quản lý | `manager` | Giao, sửa, xóa, duyệt việc; xem toàn bộ việc và thống kê; quản lý mẫu và việc định kỳ |
| Cán bộ / Chiến sĩ | `member` | Xem việc mình được giao; cập nhật tiến độ, checklist; gửi báo cáo kết quả; trao đổi trong việc |

- Kiểm tra quyền **ở phía máy chủ** cho từng route, không chỉ ẩn nút.
- Tài khoản do Admin tạo, có mật khẩu tạm; **bắt buộc đổi mật khẩu** lần đầu đăng nhập.
- Admin có thể khóa tài khoản, đặt lại mật khẩu. Không cho tự xóa/khóa chính mình; luôn còn ít nhất 1 admin hoạt động.
- Đăng nhập sai 5 lần liên tiếp → khóa tạm 15 phút.
- Phiên: mã ngẫu nhiên lưu trong bảng `sessions`, cookie `HttpOnly`, `SameSite=Strict`, hết hạn sau 8 giờ không hoạt động. Mọi form POST có mã chống CSRF.

## 4. Mô hình dữ liệu

- `units` (id, name, parent_id) — đại đội / trung đội / tổ.
- `users` (id, username, password_hash, full_name, rank, position, unit_id, role, party_status [`dang_vien`/`du_bi`/`doan_vien`/`khong`], phone, active, must_change_password, failed_logins, locked_until, created_at).
- `tasks` (id, title, description, category, priority [`thuong`/`gap`/`hoa_toc`], status [`chua_lam`/`dang_lam`/`cho_duyet`/`hoan_thanh`], due_date, created_by, created_at, completed_at, template_id, recurring_id).
- `task_assignees` (task_id, user_id).
- `checklist_items` (id, task_id, content, done, position).
- `task_comments` (id, task_id, user_id, content, created_at).
- `events` (id, title, description, start_date, end_date, type, created_by) — sự kiện lịch công tác.
- `task_templates` (id, name, category, description, items_json) — mẫu gồm nhiều đầu việc con.
- `recurring_rules` (id, title, description, category, priority, assignee_ids_json, frequency [`tuan`/`thang`], day_value, lead_days, active, last_generated) .
- `audit_log` (id, user_id, action, target, detail, created_at).
- `settings` (key, value) — ngưỡng quá tải, cấu hình AI (Phần 4).

Phần 2–4 sẽ **thêm bảng mới** (vd. `soldier_profiles`, `doc_templates`), không sửa cấu trúc bảng lõi. Migration đánh số phiên bản trong bảng `schema_version`.

**Quá hạn** không lưu thành trạng thái riêng: là điều kiện `status != hoan_thanh AND due_date < hôm nay`, tính khi truy vấn → không lệch dữ liệu.

**Lĩnh vực công việc:** Công tác Đảng, Giáo dục chính trị, Thi đua – Khen thưởng, Dân vận, Văn hóa – Văn nghệ, Huấn luyện, Hậu cần – Kỹ thuật, Khác.

## 5. Luồng công việc

`chua_lam → dang_lam → cho_duyet → hoan_thanh`

- `member` chuyển được: chua_lam→dang_lam, dang_lam→cho_duyet (kèm báo cáo kết quả). Chỉ với việc mình được giao.
- `manager`/`admin` chuyển được mọi bước, kể cả trả lại (cho_duyet→dang_lam kèm lý do).
- Tiến độ % = số mục checklist đã xong / tổng (nếu có checklist); `hoan_thanh` = 100%.
- Mọi thay đổi trạng thái ghi vào `audit_log` và tạo một dòng trao đổi tự động trong việc.

## 6. Tính năng thông minh – Nhóm A (thuật toán, offline)

1. **Gợi ý người thực hiện** — khi tạo việc, chấm điểm từng `member`/`manager` đang hoạt động:
   `điểm = 0.5 × (1 − tải_hiện_tại/tải_tối_đa_trong_nhóm) + 0.3 × kinh_nghiệm_lĩnh_vực + 0.2 × tỷ_lệ_đúng_hạn`
   - tải hiện tại = số việc chưa hoàn thành, có trọng số ưu tiên (thường 1, gấp 1.5, hỏa tốc 2);
   - kinh nghiệm = số việc cùng lĩnh vực đã hoàn thành / số lớn nhất trong nhóm;
   - tỷ lệ đúng hạn = việc hoàn thành trước/đúng hạn / việc đã hoàn thành (người chưa có lịch sử: 0.5).
   Hiển thị top 5 kèm lý do ("đang có 1 việc", "đã làm 4 việc Công tác Đảng", "92% đúng hạn").
2. **Cảnh báo quá tải** — một người có số việc mở > ngưỡng (mặc định 5, chỉnh trong cài đặt) hoặc ≥ 3 việc cùng hạn trong một ngày → cảnh báo khi giao việc và trên bảng tổng hợp.
3. **Điểm ưu tiên và "Việc cần làm hôm nay"** — `điểm = hệ_số_ưu_tiên × (1 / max(số_ngày_còn_lại, 0.5))`; việc quá hạn lên đầu. Mỗi người thấy danh sách của mình sắp theo điểm.
4. **Việc định kỳ** — quy tắc hằng tuần (thứ mấy) hoặc hằng tháng (ngày mấy); việc được sinh trước `lead_days` ngày. Chạy khi máy chủ khởi động và mỗi giờ; không sinh trùng (kiểm tra theo `recurring_id` + hạn).
5. **Mẫu công việc** — chọn mẫu → sinh việc chính kèm checklist; có sẵn vài mẫu (vd. "Tổ chức kỷ niệm ngày 22/12", "Sinh hoạt chi bộ thường kỳ").
6. **Checklist** — đã nêu ở mục 5.
7. **Tự soạn báo cáo tuần/tháng** — chọn khoảng thời gian → văn bản tổng hợp theo bố cục: *I. Tình hình chung; II. Kết quả thực hiện (theo lĩnh vực); III. Tồn tại, hạn chế (việc quá hạn, chưa xong); IV. Phương hướng (việc đến hạn kỳ sau)*. Xem trên web, sao chép, hoặc xuất Excel. (Xuất Word bổ sung ở Phần 3.)
8. **Đánh giá hiệu suất** — theo người, trong khoảng thời gian: số việc giao, hoàn thành, đúng hạn, quá hạn, tỷ lệ; sắp xếp được. Chỉ `manager`/`admin` xem.

## 7. Giao diện

- Menu trái theo vai trò: Tổng quan · Việc của tôi · Công việc (danh sách / Kanban) · Lịch công tác · Quân số · Mẫu & Việc định kỳ · Báo cáo & Hiệu suất · Quản trị (tài khoản, đơn vị, cài đặt, nhật ký).
- Tông xanh quân đội, chữ rõ, dùng được trên điện thoại (menu thu gọn).
- Bảng tổng hợp: thẻ số liệu (tổng, đang làm, chờ duyệt, quá hạn, hoàn thành tuần này), biểu đồ theo lĩnh vực và theo người, danh sách sắp đến hạn, cảnh báo quá tải.
- Lịch tháng: hạn chót công việc + sự kiện; bấm ngày để thêm sự kiện (`manager`/`admin`).
- Xuất Excel: danh sách công việc theo bộ lọc hiện tại; bảng hiệu suất; báo cáo.

## 8. Xử lý lỗi

- Lỗi nhập liệu: báo ngay trên form bằng tiếng Việt, giữ lại dữ liệu đã nhập.
- Truy cập không đủ quyền: trang 403 "Đồng chí không có quyền thực hiện chức năng này".
- Lỗi máy chủ: trang 500 thân thiện; chi tiết ghi ra console, không lộ cho người dùng.
- Admin có nút **Sao lưu dữ liệu** (tải file .db) trong trang Quản trị.

## 9. Kiểm thử

- `node:test` cho services: phân quyền chuyển trạng thái, tính quá hạn, chấm điểm gợi ý, sinh việc định kỳ không trùng, nội dung báo cáo.
- Kiểm thử HTTP (supertest-like qua `fetch` tới server chạy ở cổng tạm): chưa đăng nhập bị chuyển về /login; `member` không vào được /admin, không sửa việc người khác; CSRF bị từ chối khi thiếu mã.
- Chạy thực bằng Playwright, chụp màn hình các trang chính.

## 10. Định hướng các phần sau

- **Phần 2 – Hồ sơ quân nhân:** bảng `soldier_profiles` liên kết `users` (hoặc quân nhân không có tài khoản); quá trình công tác, khen thưởng/kỷ luật, gia đình, Đảng/Đoàn, phép; nhắc mốc (chuyển Đảng chính thức, hết hạn phục vụ, niên hạn quân hàm); chỉ `admin`/`manager` xem đầy đủ, mọi lần xem ghi nhật ký.
- **Phần 3 – Kho mẫu văn bản:** tải mẫu .docx có trường `{ho_ten}`…, điền từ hồ sơ, tạo đơn lẻ/hàng loạt, xuất Word.
- **Phần 4 – Trợ lý AI:** kết nối Ollama tại `localhost`, mặc định tắt; soạn/sửa văn bản dựa trên mẫu đã lưu ("học theo mẫu"), hỏi đáp dữ liệu, giao việc bằng câu tự nhiên (AI chỉ điền form, người dùng xác nhận trước khi lưu). Khuyến nghị máy ≥ 16GB RAM.

## 11. Ngoài phạm vi Phần 1

Đính kèm tệp, thông báo đẩy, phân quyền theo nhiều cấp đơn vị, đồng bộ nhiều máy chủ.
