# Thiết kế Phần 4: Trợ lý (quy tắc + AI cục bộ)

Ngày: 13/11/2026 · Trạng thái: chờ duyệt · Kế thừa: thiết kế Phần 1–3

## 1. Mục đích, quyết định đã chốt

Máy chủ của người dùng chỉ có **8GB RAM**, nên chọn **hướng kết hợp**:
- **Phần quy tắc** (không cần AI, chạy mọi máy): giao việc bằng câu tự nhiên, hỏi đáp dữ liệu theo mẫu câu, dàn ý văn bản.
- **Phần AI** qua Ollama (bật/tắt, mặc định tắt): viết nội dung, sửa văn bản. Địa chỉ Ollama cấu hình được (máy này hoặc máy khác trong mạng nội bộ).

Ràng buộc chung giữ nguyên (offline, tiếng Việt, quyền phía máy chủ, CSRF, nhật ký). **Không thêm phụ thuộc runtime** (gọi Ollama bằng `fetch` có sẵn của Node).

## 2. Giao việc nhanh (`src/services/assistant/taskParser.js`)

`parseTaskSentence(db, text, today) → {title, assignees: [{id, full_name}], ambiguous: [{phrase, candidates:[{id, full_name, unit_name}]}], unmatched: [phrase], due_date|null, due_phrase|null, priority, category, notes: string[]}`

- **Người**: cụm sau "đ/c", "đồng chí", "giao cho", "giao", nối bởi "và", ",", "cùng". So khớp với người dùng đang hoạt động (role member/manager) theo `fold`: khớp đủ họ tên > khớp tên gọi (từ cuối) > khớp 2 từ cuối. Nhiều kết quả → `ambiguous`; không có → `unmatched`.
- **Hạn**: "hôm nay", "ngày mai", "ngày kia", "thứ Hai…Chủ nhật/CN" (lần tới, nếu là hôm nay thì hôm nay; "thứ X tuần sau" = tuần sau), "dd/mm", "dd/mm/yyyy", "ngày d tháng m", "trong N ngày", "N ngày nữa", "tuần sau"(= thứ Hai tuần sau… → chọn Chủ nhật tuần sau? → **thứ Sáu tuần sau**), "cuối tuần" (Chủ nhật tuần này), "cuối tháng", "đầu tháng sau" (ngày 5 tháng sau). Đứng sau "hạn", "trước", "chậm nhất", "xong trước" hoặc độc lập. Ngày đã qua (dd/mm không năm) → năm sau.
- **Ưu tiên**: "hỏa tốc"/"khẩn" → hoa_toc; "gấp"/"ưu tiên" → gap; mặc định thuong.
- **Lĩnh vực** theo từ khóa (fold): chi bộ, đảng, nghị quyết, đảng viên → cong_tac_dang; học chính trị, giáo dục chính trị, thời sự → giao_duc_ct; thi đua, khen thưởng → thi_dua; dân vận, nhân dân, địa phương → dan_van; văn nghệ, thể thao, hội thao, văn hóa → van_hoa; huấn luyện, bắn, điều lệnh → huan_luyen; hậu cần, kỹ thuật, quân trang, doanh trại → hau_can; khác → khac.
- **Tiêu đề**: câu gốc bỏ phần giao/người/hạn/ưu tiên, bỏ dấu câu thừa, viết hoa chữ đầu; rỗng → AppError "Chưa có nội dung công việc".
- Kết quả **không lưu**: chuyển sang form `/tasks/new` đã điền sẵn (người, hạn, ưu tiên, lĩnh vực, tiêu đề, mô tả = câu gốc) để người dùng kiểm tra rồi lưu như bình thường.

## 3. Hỏi đáp dữ liệu (`src/services/assistant/qa.js`)

`answer(db, user, text, today) → {intent, title, columns, rows: [{cells, href?}], summary, empty_text}` hoặc `{intent: null, suggestions: [câu mẫu]}`.

Ý định (khớp từ khóa trên chuỗi `fold`; ưu tiên ý định cụ thể hơn):
| Mã | Ví dụ câu | Quyền |
|---|---|---|
| `viec_qua_han` | việc nào quá hạn | member: việc của mình |
| `viec_cua` | việc của đ/c Hùng | manager/admin (member: chỉ chính mình) |
| `viec_den_han` | việc đến hạn tuần này / hôm nay / 7 ngày tới | theo phạm vi |
| `viec_cua_toi` | việc của tôi | mọi người |
| `nghi_phep` | ai đang nghỉ phép | manager/admin |
| `chuyen_dang` | ai sắp chuyển Đảng chính thức | manager/admin |
| `het_han_phuc_vu` | ai sắp hết hạn phục vụ / xuất ngũ | manager/admin |
| `nien_han` | ai đến niên hạn quân hàm | manager/admin |
| `dem_dang_doan` | bao nhiêu đảng viên / đoàn viên | manager/admin |
| `danh_sach_don_vi` | danh sách Trung đội 2 | manager/admin |
| `qua_tai` | ai đang quá tải | manager/admin |
| `tinh_hinh` | tình hình tuần này / tháng này | manager/admin (member: số liệu của mình) |

Không khớp → gợi ý 6 câu mẫu theo vai trò. **Không có ý định nào trả về dữ liệu tư tưởng/hoàn cảnh.** Member hỏi ý định ngoài quyền → "Đồng chí không có quyền xem thông tin này".

## 4. Dàn ý văn bản (`src/services/assistant/outlines.js`)

`OUTLINES`: `ke_hoach` (I. MỤC ĐÍCH, YÊU CẦU – 1. Mục đích, 2. Yêu cầu; II. NỘI DUNG; III. THỜI GIAN, ĐỊA ĐIỂM; IV. LỰC LƯỢNG, THÀNH PHẦN; V. TỔ CHỨC THỰC HIỆN; VI. CÔNG TÁC BẢO ĐẢM), `bao_cao` (I. TÌNH HÌNH CHUNG; II. KẾT QUẢ THỰC HIỆN; III. ƯU ĐIỂM, KHUYẾT ĐIỂM; IV. PHƯƠNG HƯỚNG, NHIỆM VỤ THỜI GIAN TỚI; V. ĐỀ XUẤT, KIẾN NGHỊ), `bao_cao_tuan` (dùng `periodReport` Phần 1 cho tuần hiện tại, có số liệu thật), `bien_ban_sinh_hoat` (Thời gian, địa điểm; Thành phần; Chủ trì, thư ký; Nội dung; Kết luận). `buildOutline(db, key, {topic}, today) → string` (dòng, dùng được cho textarea `noi_dung`; có `{topic}` thì chèn vào câu mục đích).

## 5. AI qua Ollama (`src/services/assistant/ai.js`)

- Cài đặt (admin, khóa settings): `ai_enabled` (0/1, mặc định 0), `ai_url` (mặc định `http://127.0.0.1:11434`), `ai_model` (mặc định `qwen2.5:3b`), `ai_timeout_s` (mặc định 180), mẫu văn theo loại `ai_samples` (JSON `{ke_hoach, bao_cao, chung}` mỗi mục ≤ 4000 ký tự).
- **Chặn địa chỉ ngoài mạng nội bộ**: chỉ chấp nhận host là `localhost`, `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `::1`, hoặc tên máy không có dấu chấm; phân giải DNS rồi kiểm tra IP; sai → AppError khi lưu và khi gọi.
- `checkConnection()` → `GET /api/tags` → danh sách mô hình đã cài, mô hình đã chọn có trong danh sách không.
- `generate({task, input, docType, extra}, onChunk, signal)` → `POST /api/chat` stream; `task` ∈ `viet_noi_dung` (từ trích yếu + dàn ý/yêu cầu ngắn), `sua_chinh_ta`, `van_phong_quan_doi`, `rut_gon`, `viet_lai`. Lời nhắc hệ thống tiếng Việt cố định theo task (văn phong hành chính quân đội, không bịa số liệu/tên người, giữ nguyên ý, chỉ trả về văn bản). Có mẫu văn → thêm làm ví dụ. Đầu vào ≤ 8000 ký tự.
- Route stream: `POST /assistant/ai/run` (JSON) → trả `text/plain; charset=utf-8` chunked; client đọc bằng `ReadableStream`, nút Dừng hủy `AbortController` (máy chủ hủy yêu cầu tới Ollama khi client ngắt). Một yêu cầu AI đồng thời cho mỗi người dùng (đang chạy → 429 "Đồng chí đang có một yêu cầu AI chưa xong").
- Dữ liệu gửi đi chỉ gồm: văn bản người dùng nhập, trích yếu, tên loại văn bản, tên đơn vị (cap_tren/don_vi). **Không** gửi hồ sơ quân nhân, tư tưởng, danh sách người.
- AI tắt / lỗi kết nối / hết giờ → thông báo tiếng Việt rõ ràng, không 500.
- Nhật ký: `ai_run` (task, số ký tự vào/ra, thời gian — **không** lưu nội dung), `ai_settings`.

## 6. Giao diện

- Menu **"Trợ lý"** (`/assistant`), 3 thẻ: **Giao việc nhanh** (admin/manager) · **Hỏi đáp** (mọi người) · **Soạn thảo** (admin/manager).
- Tổng quan: ô "Hỏi nhanh" gửi tới thẻ Hỏi đáp.
- Form tạo văn bản (Phần 3): cạnh ô `noi_dung` (textarea) có nút "Chèn dàn ý" (chọn loại + chủ đề), "AI viết nội dung", "AI sửa…" (menu task). Nút AI ẩn khi AI tắt.
- Thẻ Soạn thảo: ô văn bản vào, chọn tác vụ, khung kết quả hiện dần, nút Dừng, Sao chép, Dùng kết quả (thay vào ô vào).
- Quản trị → Cài đặt: mục "Trợ lý AI" (bật/tắt, địa chỉ, mô hình, thời gian chờ, mẫu văn, nút Kiểm tra kết nối hiển thị kết quả).

## 7. Kiểm thử

- Bộ hiểu câu: ≥ 25 câu mẫu (có dấu/không dấu, nhiều người, trùng tên, ngày tương đối quanh cuối tuần/cuối tháng/cuối năm, không có hạn).
- Hỏi đáp: mỗi ý định ≥ 1 câu; phạm vi member; không lộ dữ liệu nhạy cảm; câu lạ → gợi ý.
- Dàn ý: đủ mục; báo cáo tuần có số liệu.
- AI: máy chủ Ollama giả trong test (HTTP cục bộ trả stream) — chạy đúng, ngắt giữa chừng, lỗi kết nối, AI tắt, chặn địa chỉ công cộng (vd `8.8.8.8`, `example.com`), giới hạn đồng thời, payload không chứa dữ liệu hồ sơ.
- Ảnh màn hình 3 thẻ + nút AI trong form văn bản (AI giả).

## 8. Ngoài phạm vi

AI tự lưu dữ liệu; AI đọc hồ sơ để trả lời; nhận giọng nói; tải mô hình từ website.
