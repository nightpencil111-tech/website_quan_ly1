# Thiết kế Phần 3: Kho mẫu văn bản Word

Ngày: 12/11/2026 · Trạng thái: chờ duyệt · Kế thừa: thiết kế Phần 1, Phần 2

## 1. Mục đích và phạm vi

Tạo văn bản Word đúng thể thức đơn vị từ mẫu, tự điền thông tin đơn vị và hồ sơ quân nhân; tạo một hoặc hàng loạt; người dùng tự thêm mẫu bằng cách tải file Word lên, hệ thống tự nhận dạng chỗ cần điền.

**Quyết định đã chốt:**
- Cả hai cách: (a) 5 mẫu dựng sẵn theo thể thức văn bản của đơn vị (Kế hoạch, Báo cáo, Báo cáo Chi bộ, Danh sách quân nhân, Danh sách đảng viên); (b) tải file Word lên → nhận dạng nhãn quen thuộc → xác nhận → lưu mẫu.
- Nhận dạng theo quy tắc (chưa dùng AI; AI ở Phần 4).
- Phần thân văn bản (mục đích, yêu cầu, nội dung…) nhập tay; Phần 4 bổ sung AI soạn.
- Mẫu dựng sẵn chỉ theo **thể thức** quan sát từ văn bản mẫu người dùng gửi; không chép nội dung, tên người.

Ràng buộc chung Phần 1–2 giữ nguyên. **Phụ thuộc mới được phép:** `docxtemplater` và `pizzip` (đọc/ghi docx, nén zip; chạy offline, thuần JavaScript).

## 2. Thể thức (quan sát từ văn bản đơn vị)

- A4; văn bản thường khổ dọc, danh sách khổ ngang; Times New Roman 13–14; lề trái 3,5 cm, phải 1,5–2 cm, trên 2 cm, dưới 1,5–2 cm.
- Đầu văn bản chính quyền: bảng 2 cột không viền — trái: `TIỂU ĐOÀN …` / `ĐẠI ĐỘI …` (in đậm, gạch chân dòng cuối) / `Số: …/KH-…`; phải: `CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM` / `Độc lập - Tự do - Hạnh phúc` / `<Địa danh>, ngày … tháng … năm …` (nghiêng).
- Đầu văn bản Đảng: trái `ĐẢNG ỦY …` / `CHI BỘ …` / `*`; phải `ĐẢNG CỘNG SẢN VIỆT NAM` / địa danh, ngày tháng.
- Cuối văn bản: bảng 2 cột — trái `Nơi nhận:` + danh sách; phải chức vụ người ký (in đậm) / khoảng trống ký / `<Cấp bậc> <Họ tên>`. Văn bản Đảng: `T/M CHI BỘ` / `BÍ THƯ` / họ tên.

## 3. Dữ liệu tự điền (danh mục trường)

Cú pháp ô trống `{ma_truong}`; bảng lặp `{#ds}…{/ds}` (một dòng bảng lặp cho mỗi người).

**Trường chung** (từ cài đặt "Thông tin đơn vị" + hôm nay):
`cap_tren` (TIỂU ĐOÀN 4), `don_vi` (ĐẠI ĐỘI 3), `dang_uy` (ĐẢNG ỦY TIỂU ĐOÀN 4), `chi_bo` (CHI BỘ ĐẠI ĐỘI 3), `dia_danh` (Đồng Nai), `ngay_thang` ("Đồng Nai, ngày 12 tháng 11 năm 2026"), `ngay`, `thang`, `nam`, `nguoi_ky_chuc_vu`, `nguoi_ky_cap_bac`, `nguoi_ky_ho_ten`, `bi_thu_ho_ten`.

**Trường quân nhân** (từ hồ sơ Phần 2; dùng trong văn bản một người hoặc trong `{#ds}`):
`stt`, `ho_ten`, `ngay_sinh` (dd/mm/yyyy), `gioi_tinh`, `cap_bac`, `chuc_vu`, `don_vi_qn` (tên đơn vị của quân nhân), `que_quan`, `noi_o`, `dan_toc`, `ton_giao`, `van_hoa`, `chuyen_mon`, `nhap_ngu`, `ngay_vao_doan`, `ngay_vao_dang`, `ngay_chinh_thuc`, `dang_doan` (Đảng viên/Đảng viên dự bị/Đoàn viên/Quần chúng), `suc_khoe`, `sdt`.
**Không bao giờ** có trường từ mục tư tưởng hoặc ghi chú hoàn cảnh gia đình.

**Trường nhập tay** (khai báo theo từng mẫu): mã, nhãn tiếng Việt, kiểu `text` | `textarea` (nhiều dòng, giữ xuống dòng) | `date` (điền dạng dd/mm/yyyy), bắt buộc hay không. Dùng chung cho cả lô.

Thiếu giá trị → ô trống được thay bằng chuỗi rỗng (không in `undefined`).

## 4. Mẫu và chế độ

`doc_templates`: id, name, category (`ke_hoach`/`bao_cao`/`dang`/`danh_sach`/`khac`), mode (`chung` – không cần chọn người; `tung_nguoi` – mỗi người một file; `danh_sach` – một file có bảng lặp), file (BLOB docx), manual_fields (JSON), builtin (0/1), created_by, created_at, updated_at.

- Mẫu dựng sẵn: 5 mẫu (Kế hoạch – `chung`; Báo cáo – `chung`; Báo cáo Chi bộ – `chung`; Danh sách quân nhân – `danh_sach`; Danh sách đảng viên – `danh_sach`, chỉ lấy người có ngày vào Đảng). Cài khi bảng trống (idempotent). Mẫu dựng sẵn sửa được tên/trường nhập tay, thay file được; "Khôi phục mẫu gốc" đưa về bản dựng sẵn.
- Khi lưu mẫu (tải lên hoặc thay file): kiểm tra mở được, cú pháp ô trống hợp lệ; liệt kê các mã chưa có trong danh mục và chưa khai báo nhập tay → cảnh báo (không chặn).

## 5. Tạo văn bản

`/documents` (admin, manager):
1. Chọn mẫu → form: nếu mode ≠ `chung` thì chọn quân nhân (lọc đơn vị, trạng thái, Đảng/Đoàn; chọn tất cả); các trường nhập tay; tùy chọn ghi đè `ngay_thang`.
2. `chung` hoặc `danh_sach` → một file `.docx`; `tung_nguoi` → một người: `.docx`, nhiều người: `.zip` các file tên `<Tên mẫu> - <Họ tên>.docx` (lọc ký tự cấm trên Windows, trùng tên thêm số).
3. Nhật ký `doc_generate` (mẫu, số người, danh sách id). Không lưu file đã tạo trên máy chủ.

## 6. Tải mẫu lên và tự nhận dạng

1. Tải `.docx` (≤ 5MB; trình duyệt gửi base64 như Phần 2, parser riêng 8mb trước parser chung). `.doc` → hướng dẫn mở Word → Lưu thành .docx.
2. Nhận dạng trong từng đoạn văn (kể cả trong ô bảng): ghép chữ các run; tìm **nhãn quen thuộc** (bảng từ khóa không dấu → mã trường: "họ và tên"/"họ tên" → ho_ten; "ngày sinh"/"sinh ngày" → ngay_sinh; "cấp bậc" → cap_bac; "chức vụ" → chuc_vu; "đơn vị" → don_vi_qn; "quê quán" → que_quan; "nơi ở"/"trú quán" → noi_o; "dân tộc" → dan_toc; "tôn giáo" → ton_giao; "nhập ngũ" → nhap_ngu; "ngày vào đảng" → ngay_vao_dang; "ngày chính thức" → ngay_chinh_thuc; "điện thoại" → sdt; …) theo sau là `:` và/hoặc chuỗi dấu chấm `…`/`.....`/gạch dưới `____`. Mỗi chỗ tìm được = một **đề xuất**: đoạn văn, nhãn, mã đề xuất.
3. Ngoài ra đề xuất cho chuỗi dấu chấm/gạch dưới đứng sau nhãn không quen → trường nhập tay mới (mã tự sinh từ nhãn, không dấu).
4. Màn hình xác nhận: bảng đề xuất (nhãn, ngữ cảnh, chọn mã từ danh mục / "Trường nhập tay mới" / "Bỏ qua"). Lưu → thay phần dấu chấm/gạch dưới (hoặc phần sau dấu hai chấm nếu trống) bằng `{ma}`. Định dạng của đoạn: giữ định dạng run đầu tiên của phần được thay; phần nhãn giữ nguyên.
5. Tải lại bản đã đánh dấu để kiểm tra; sửa tay trong Word rồi "Thay file" được.

## 7. Cài đặt "Thông tin đơn vị"

Admin → Cài đặt: cap_tren, don_vi, dang_uy, chi_bo, dia_danh, nguoi_ky_chuc_vu, nguoi_ky_cap_bac, nguoi_ky_ho_ten, bi_thu_ho_ten (chuỗi, ≤ 120 ký tự). Thiếu → ô trống để rỗng và trang tạo văn bản nhắc "Chưa cài đặt thông tin đơn vị".

## 8. Quyền và nhật ký

admin + manager: mọi chức năng mẫu và tạo văn bản. member: không. Admin: cài đặt thông tin đơn vị. Nhật ký: `doc_template_create/update/delete/restore`, `doc_generate`, `unit_info_settings`.

## 9. Xử lý lỗi

File hỏng/không phải docx → "Tệp không đúng định dạng Word (.docx)". Lỗi cú pháp ô trống (thiếu ngoặc, vòng lặp không đóng) → thông báo tiếng Việt nêu tên ô trống. Lỗi khi tạo văn bản → trang lỗi thân thiện, không 500 thô.

## 10. Kiểm thử

- Danh mục trường: dữ liệu quân nhân đủ mã, không có khóa nhạy cảm; `ngay_thang` đúng dạng.
- Kết xuất: một người, danh sách (bảng lặp đúng số dòng), zip nhiều file (tên an toàn, trùng tên), xuống dòng trong textarea, giá trị thiếu → rỗng.
- 5 mẫu dựng sẵn: kết xuất với dữ liệu thử không còn ký tự `{` `}` sót, không lỗi.
- Nhận dạng: đoạn "Họ và tên: ……………" → `{ho_ten}`; nhãn bị tách nhiều run; trong ô bảng; nhãn không quen → nhập tay mới; đoạn không có chỗ trống → không đề xuất.
- Quyền: member 403; tải lên file rác → báo lỗi; nhật ký `doc_generate`.
- Ảnh màn hình và mở thử file kết xuất bằng LibreOffice chuyển PDF để kiểm tra trực quan.

## 11. Ngoài phạm vi

AI soạn nội dung (Phần 4); sửa văn bản trực tiếp trên web; chữ ký số; lưu trữ văn bản đã tạo; xuất PDF trên máy chủ.
