# Quản lý công tác chính trị

Ứng dụng web chạy trong mạng nội bộ, giúp cán bộ chính trị giao việc, theo dõi tiến độ, lập lịch công tác và tổng hợp báo cáo. Không cần Internet khi chạy: không dùng CDN hay font trực tuyến.

## 1. Yêu cầu

- **Node.js 22 LTS, bản từ 22.13 trở lên** (tải tại https://nodejs.org, chọn bản LTS).
- Chạy được trên Windows x64 và Windows ARM (ví dụ Surface), cũng như Linux/macOS.
- Dữ liệu lưu trong một tệp SQLite (`data/data.db`), không cần cài cơ sở dữ liệu riêng.

## 2. Cài đặt trên Windows, từng bước

1. Tải và cài Node.js bản LTS từ nodejs.org (chọn đúng bản x64 hoặc ARM64 của máy).
2. Chép hoặc giải nén thư mục ứng dụng vào máy, ví dụ `C:\QuanLyCTV`.
3. Mở thư mục đó trong File Explorer, bấm chuột phải vào vùng trống, chọn **Open in Terminal** (hoặc mở PowerShell rồi `cd C:\QuanLyCTV`).
4. Chạy lệnh cài thư viện (cần Internet một lần; hoặc chép sẵn thư mục `node_modules` từ máy khác):
   ```powershell
   npm install
   ```
5. Khởi động:
   ```powershell
   npm start
   ```
6. Mở trình duyệt, truy cập `http://localhost:3000`.

### Đăng nhập lần đầu

Tài khoản quản trị mặc định: **admin / admin123**. Hệ thống bắt buộc đổi mật khẩu ngay ở lần đăng nhập đầu tiên. Sau đó quản trị viên vào mục **Tài khoản** để tạo tài khoản cho cán bộ, chiến sĩ (mật khẩu tạm được hiển thị một lần, người dùng phải đổi khi đăng nhập).

## 3. Cho các máy khác trong mạng truy cập

1. Trên máy chạy ứng dụng, mở PowerShell và gõ `ipconfig`, ghi lại địa chỉ **IPv4 Address** (ví dụ `192.168.1.20`).
2. Mở cổng 3000 trong Windows Defender Firewall. Mở PowerShell **bằng quyền Administrator** và chạy:
   ```powershell
   New-NetFirewallRule -DisplayName "QuanLyCTV 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
   ```
3. Trên máy khác cùng mạng, mở trình duyệt và truy cập `http://<IP>:3000`, ví dụ `http://192.168.1.20:3000`.

## 4. Dữ liệu thử (tùy chọn)

Để xem thử giao diện với dữ liệu hư cấu (3 trung đội, 1 quản lý, 10 chiến sĩ, khoảng 30 công việc, vài sự kiện, 21 hồ sơ quân nhân kèm gia đình, khen thưởng, nghỉ phép, tư tưởng và cấu hình thời hạn nhắc mốc mẫu):

```powershell
npm run demo
```

Lệnh này từ chối chạy nếu cơ sở dữ liệu không phải bản mới cài (đã có công việc, đã có tài khoản ngoài admin, hoặc admin đã đổi mật khẩu); chỉ thêm `-- --force` khi thật sự cần (khi đó mật khẩu admin bị đặt lại, có cảnh báo). Tài khoản thử, mật khẩu chung `Demo@1234`: `admin`, `ctv` (quản lý), `cs01` … `cs10` (chiến sĩ). Chế độ này đặt lại mật khẩu `admin` thành `Demo@1234`, vì vậy **không chạy trên hệ thống thật**. Muốn dùng thử trên dữ liệu riêng, đặt biến `DB_PATH`, ví dụ:

```powershell
$env:DB_PATH = "data\demo.db"; npm run demo; npm start
```

Công cụ chụp ảnh `npm run screenshots` chỉ dành cho lập trình viên và cần cài Playwright riêng (không nằm trong thư viện bắt buộc):

```powershell
npm i -D playwright
npx playwright install chromium
```

## 5. Sao lưu và khôi phục

- **Sao lưu:** đăng nhập bằng `admin`, vào **Sao lưu dữ liệu** và bấm tải về; hoặc dừng ứng dụng (Ctrl+C) rồi chép tệp `data/data.db` (kèm `data.db-wal`, `data.db-shm` nếu có).
- **Khôi phục:** (1) dừng ứng dụng (Ctrl+C); (2) xóa `data/data.db-wal` và `data/data.db-shm` nếu có; (3) đổi tên bản sao lưu tải về (dạng `saoluu-YYYY-MM-DD.db`) thành `data.db` và chép đè vào thư mục `data/`; (4) khởi động lại ứng dụng. Không bỏ qua bước 2, nếu không dữ liệu cũ có thể bị trộn lẫn hoặc báo hỏng.
- Ứng dụng luôn dùng `data/data.db` nằm cạnh thư mục ứng dụng, dù khởi động từ thư mục nào (có thể đổi bằng biến `DB_PATH`). Dừng bằng Ctrl+C để dữ liệu được ghi gọn.
- Bản sao lưu chứa cả mật khẩu đã băm của mọi tài khoản: cất giữ ở nơi an toàn, không gửi qua kênh không được phép.

## 6. Tự chạy khi bật máy (tùy chọn)

Tạo tệp `start.bat` trong thư mục ứng dụng với nội dung `cd /d C:\QuanLyCTV && npm start`, rồi đặt lối tắt của tệp vào thư mục khởi động (`Win + R`, gõ `shell:startup`). Hoặc dùng Task Scheduler với trình kích hoạt "At startup".

## 7. Lưu ý bảo mật

- Chỉ dùng trong mạng nội bộ; không mở cổng ra Internet.
- **Không nhập thông tin mật** (tài liệu, nội dung có độ mật) vào hệ thống.
- Đổi mật khẩu mặc định ngay; đăng nhập sai 5 lần sẽ bị khóa 15 phút; phiên làm việc hết hạn sau 8 giờ không hoạt động.
- Tuân thủ quy định của đơn vị về quản lý, sử dụng máy tính và dữ liệu.

## 8. Vai trò

| Vai trò | Quyền chính |
|---|---|
| Quản trị viên (`admin`) | Toàn quyền: tài khoản, đơn vị, cài đặt, nhật ký, sao lưu, đồng thời có mọi quyền của quản lý |
| Quản lý (`manager`, ví dụ chính trị viên) | Giao việc, sửa/xóa việc, duyệt hoàn thành, xem quân số, báo cáo, hiệu suất, lịch, mẫu và việc định kỳ |
| Chiến sĩ (`member`) | Xem và cập nhật việc được giao (chưa làm → đang làm → chờ duyệt), checklist, bình luận, xem lịch |

## 9. Chức năng

- Giao việc kèm lĩnh vực, mức ưu tiên (thường/gấp/hỏa tốc), hạn, nhiều người thực hiện, checklist; gợi ý người thực hiện và cảnh báo quá tải.
- Danh sách có lọc, tìm kiếm tiếng Việt (có dấu hoặc không dấu), bảng Kanban kéo thả (kéo thả dành cho chuột; trên màn hình cảm ứng như Surface, hãy mở công việc và bấm các nút chuyển trạng thái), "Việc của tôi" sắp theo mức khẩn.
- Mẫu công việc và việc định kỳ (hằng tuần/tháng) tự sinh việc.
- Lịch công tác theo tháng, kết hợp hạn chót công việc.
- Bảng tổng quan, báo cáo kết quả theo kỳ (sao chép/xuất Excel), thống kê hiệu suất, xuất danh sách việc ra Excel.
- Hồ sơ quân nhân: lý lịch, gia đình, quá trình công tác, khen thưởng/kỷ luật, nghỉ phép, theo dõi tư tưởng; nhắc mốc (chuyển Đảng chính thức, hết hạn phục vụ, niên hạn thăng quân hàm); nhập/xuất Excel (xem mục 11).
- Quản trị tài khoản, đơn vị, nhật ký thao tác, sao lưu.

## 10. Lộ trình

- **Phần 1 (đã xong):** lõi hệ thống: tài khoản, giao việc, Kanban, lịch, báo cáo.
- **Phần 2 (đã xong):** hồ sơ quân nhân, nhắc mốc, nhập/xuất Excel.
- **Phần 3:** công tác Đảng, đoàn thể, thi đua – khen thưởng chuyên sâu.
- **Phần 4:** tổng hợp, thống kê nâng cao và hoàn thiện.

## 11. Hồ sơ quân nhân

### Lưu những gì

Mỗi quân nhân có một hồ sơ gồm: lý lịch (họ tên, ngày sinh, quê quán, dân tộc, tôn giáo, trình độ, cấp bậc và ngày nhận, ngày nhập ngũ, ngày vào Đoàn/Đảng/chuyển chính thức, sức khỏe, điện thoại), thân nhân trong gia đình (kèm ghi chú hoàn cảnh khó khăn), quá trình công tác, khen thưởng và kỷ luật, nghỉ phép/tranh thủ, và nhật ký theo dõi tư tưởng. Hồ sơ có thể liên kết với một tài khoản đăng nhập (chọn ở form tài khoản, Quản trị → Tài khoản; trang hồ sơ hiển thị tài khoản đã liên kết). Khóa tài khoản không ảnh hưởng hồ sơ.

### Ai xem được gì

| Vai trò | Quyền với hồ sơ |
|---|---|
| Quản trị viên, Quản lý | Xem, thêm, sửa, xóa mọi hồ sơ và mọi mục (kể cả tư tưởng, hoàn cảnh khó khăn); trang Mốc sắp đến; nhập/xuất Excel |
| Chiến sĩ | Chỉ xem hồ sơ của chính mình ở mục **Hồ sơ của tôi**. **Không** thấy tư tưởng và ghi chú hoàn cảnh khó khăn (kể cả khi xuất dữ liệu). Mọi trang `/soldiers*` khác trả về 403 |

### Cấu hình thời hạn nhắc mốc

Quản trị viên vào **Cài đặt → Thời hạn nhắc mốc** để nhập: thời gian đảng viên dự bị (tháng), thời hạn phục vụ tại ngũ (tháng), niên hạn xét thăng quân hàm theo từng cấp bậc (tháng) và số ngày báo trước (mặc định 30). Mốc nào chưa nhập thì hệ thống **không tính** và hiện cảnh báo "Chưa cấu hình" ở trang Mốc sắp đến.

**Lưu ý:** các con số trong dữ liệu thử (dự bị 12 tháng, phục vụ 24 tháng, niên hạn 6 tháng cho các cấp từ Binh nhì đến Thượng sĩ) chỉ là **số liệu thử để minh họa**. Khi dùng thật, quản trị viên phải tự nhập số liệu đúng theo quy định hiện hành; ứng dụng không có sẵn giá trị mặc định.

### Nhập hồ sơ từ Excel

1. Vào **Hồ sơ quân nhân → Nhập Excel**, bấm **tệp mẫu (.xlsx)** để tải mẫu.
2. Điền dữ liệu ở sheet "Hồ sơ", mỗi quân nhân một dòng từ dòng 2 (xóa hoặc sửa dòng ví dụ). Chỉ cột **Họ tên** là bắt buộc.
3. Ngày nhập theo dạng **dd/mm/yyyy** (ô ngày của Excel cũng được nhận).
4. Cột **Đơn vị** phải trùng tên đơn vị đã có trong hệ thống: quản trị viên cần tạo đơn vị trước khi nhập.
5. Các cột Quê quán, Dân tộc, Tôn giáo, Văn hóa, **SĐT** trong tệp mẫu đã đặt sẵn định dạng **Text**; nếu tự thêm dòng ngoài vùng mẫu, đặt các cột này về Text trước khi gõ để giữ số 0 đầu và tránh Excel đổi "12/12" thành ngày.
6. Chọn tệp (.xlsx, tối đa 2MB), bấm **Tải lên và xem trước**. Màn hình xem trước liệt kê dòng hợp lệ, dòng lỗi (kèm lý do) và dòng trùng (cùng họ tên và ngày sinh); dòng lỗi và trùng sẽ bị bỏ qua.
7. Kiểm tra rồi bấm **Xác nhận nhập**; bản xem trước không xác nhận sẽ hết hạn sau 30 phút. Việc nhập được ghi vào nhật ký.

### Xuất danh sách trích ngang

Ở **Hồ sơ quân nhân**, lọc theo đơn vị, cấp bậc, trạng thái rồi bấm **Xuất Excel** để tải danh sách trích ngang (họ tên, ngày sinh, cấp bậc, chức vụ, đơn vị, nhập ngũ, quê quán, Đảng/Đoàn, trạng thái). Danh sách không chứa dữ liệu tư tưởng. Việc xuất được ghi vào nhật ký.

### Bảo mật dữ liệu tư tưởng

Dữ liệu tư tưởng và hoàn cảnh khó khăn là thông tin nhạy cảm: chỉ cấp tài khoản Quản lý cho người thật sự được phép; không chia sẻ ảnh màn hình hay bản sao lưu (`data.db` chứa toàn bộ) ra ngoài; nhập nội dung ngắn gọn, khách quan, không ghi thông tin mật. Mọi thao tác xem, sửa, nhập, xuất hồ sơ đều có trong **Nhật ký**.

## 12. Xử lý sự cố

- **Cổng 3000 đang được dùng** (`EADDRINUSE`): chọn cổng khác, ví dụ `$env:PORT = 8080; npm start`, rồi mở cổng đó trong tường lửa.
- **Báo phiên bản Node quá cũ** hoặc lỗi `node:sqlite`: kiểm tra `node -v`, cài lại Node.js 22 LTS (≥ 22.13).
- **Máy khác không vào được:** kiểm tra IP bằng `ipconfig`, hai máy cùng mạng, đã mở cổng tường lửa như mục 3.
- **Quên mật khẩu:** quản trị viên bấm "Đặt lại mật khẩu" ở mục Tài khoản. Nếu quên mật khẩu admin duy nhất, liên hệ người cài đặt để khôi phục từ bản sao lưu.
- Đặt đường dẫn dữ liệu khác bằng biến `DB_PATH`.
