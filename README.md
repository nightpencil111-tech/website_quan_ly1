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

Để xem thử giao diện với dữ liệu hư cấu (3 trung đội, 1 quản lý, 10 chiến sĩ, khoảng 30 công việc, vài sự kiện):

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
- **Khôi phục:** dừng ứng dụng, thay tệp `data/data.db` bằng bản sao lưu, khởi động lại.
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
- Danh sách có lọc, tìm kiếm tiếng Việt (có dấu hoặc không dấu), bảng Kanban kéo thả, "Việc của tôi" sắp theo mức khẩn.
- Mẫu công việc và việc định kỳ (hằng tuần/tháng) tự sinh việc.
- Lịch công tác theo tháng, kết hợp hạn chót công việc.
- Bảng tổng quan, báo cáo kết quả theo kỳ (sao chép/xuất Excel), thống kê hiệu suất, xuất danh sách việc ra Excel.
- Quản trị tài khoản, đơn vị, nhật ký thao tác, sao lưu.

## 10. Lộ trình

- **Phần 1 (hiện tại):** lõi hệ thống: tài khoản, giao việc, Kanban, lịch, báo cáo.
- **Phần 2:** quản lý quân số và hồ sơ chi tiết.
- **Phần 3:** công tác Đảng, đoàn thể, thi đua – khen thưởng chuyên sâu.
- **Phần 4:** tổng hợp, thống kê nâng cao và hoàn thiện.

## 11. Xử lý sự cố

- **Cổng 3000 đang được dùng** (`EADDRINUSE`): chọn cổng khác, ví dụ `$env:PORT = 8080; npm start`, rồi mở cổng đó trong tường lửa.
- **Báo phiên bản Node quá cũ** hoặc lỗi `node:sqlite`: kiểm tra `node -v`, cài lại Node.js 22 LTS (≥ 22.13).
- **Máy khác không vào được:** kiểm tra IP bằng `ipconfig`, hai máy cùng mạng, đã mở cổng tường lửa như mục 3.
- **Quên mật khẩu:** quản trị viên bấm "Đặt lại mật khẩu" ở mục Tài khoản. Nếu quên mật khẩu admin duy nhất, liên hệ người cài đặt để khôi phục từ bản sao lưu.
- Đặt đường dẫn dữ liệu khác bằng biến `DB_PATH`.
