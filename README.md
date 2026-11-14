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

Để xem thử giao diện với dữ liệu hư cấu (3 trung đội, 1 quản lý, 10 chiến sĩ, khoảng 30 công việc, vài sự kiện, 21 hồ sơ quân nhân kèm gia đình, khen thưởng, nghỉ phép, tư tưởng, cấu hình thời hạn nhắc mốc và thông tin đơn vị mẫu để thử tạo văn bản Word):

```powershell
npm run demo
```

Lệnh này từ chối chạy nếu cơ sở dữ liệu không phải bản mới cài (đã có công việc, đã có tài khoản ngoài admin, hoặc admin đã đổi mật khẩu); chỉ thêm `-- --force` khi thật sự cần (khi đó mật khẩu admin bị đặt lại, có cảnh báo). Tài khoản thử, mật khẩu chung `Demo@1234`: `admin`, `ctv` (quản lý), `cs01` … `cs10` (chiến sĩ). Chế độ này đặt lại mật khẩu `admin` thành `Demo@1234`, vì vậy **không chạy trên hệ thống thật**. Muốn dùng thử trên dữ liệu riêng, đặt biến `DB_PATH`, ví dụ:

```powershell
$env:DB_PATH = "data\demo.db"; npm run demo; npm start
```

Dữ liệu thử để **Trợ lý AI tắt** (`ai_enabled = 0`); muốn thử phần AI, bật theo mục 13. Các chức năng giao việc nhanh, hỏi đáp và dàn ý không cần AI.

Công cụ chụp ảnh `npm run screenshots` chỉ dành cho lập trình viên và cần cài Playwright riêng (không nằm trong thư viện bắt buộc):

```powershell
npm i -D playwright
npx playwright install chromium
```

## 5. Sao lưu và khôi phục

- **Sao lưu:** đăng nhập bằng `admin`, vào **Sao lưu dữ liệu** và bấm tải về. Nếu hệ thống đã có khóa xác thực 2 lớp (`data/secret.key`), tệp tải về là `saoluu-YYYY-MM-DD.zip` chứa `data.db` và `secret.key`; nếu không, là tệp `.db`. Cũng có thể chạy `npm run backup` (hoặc `scripts\windows\backup.cmd`): tạo `backups/saoluu-YYYY-MM-DD-HHmm.db` kèm `.key` cùng tên, giữ 30 bản mới nhất; đổi thư mục bằng `backupDir` trong `quanly.config.json` hoặc biến `QLCTV_BACKUP_DIR`.
- **Khôi phục:** (1) dừng ứng dụng (Ctrl+C); (2) xóa `data/data.db-wal` và `data/data.db-shm` nếu có; (3) chép bản sao lưu đè thành `data/data.db` (giải nén nếu là `.zip`; với bản `saoluu-...-HHmm.db` thì đổi tên thành `data.db`), **đồng thời chép khóa `secret.key` (hoặc `saoluu-...-HHmm.key` đổi tên thành `secret.key`) vào cùng thư mục `data/`**, nếu thiếu khóa thì mọi tài khoản đã bật 2 lớp không đăng nhập được; (4) khởi động lại ứng dụng. Không bỏ qua bước 2, nếu không dữ liệu cũ có thể bị trộn lẫn hoặc báo hỏng.
- Ứng dụng luôn dùng `data/data.db` nằm cạnh thư mục ứng dụng, dù khởi động từ thư mục nào (có thể đổi bằng biến `DB_PATH`). Dừng bằng Ctrl+C để dữ liệu được ghi gọn.
- Bản sao lưu chứa cả mật khẩu đã băm của mọi tài khoản: cất giữ ở nơi an toàn, không gửi qua kênh không được phép. Bản sao lưu không chứa phiên đăng nhập (đã xóa khi sao lưu), nên sau khi khôi phục mọi người phải đăng nhập lại.

## 6. Tự chạy khi bật máy và tự sao lưu (Windows)

**Lưu ý:** các kịch bản dưới đây chưa được nhà phát triển chạy thử trên Windows (chỉ rà soát kỹ bằng mắt); đồng chí chạy thử và báo lại nếu có lỗi.

1. Mở PowerShell bằng quyền Administrator (chuột phải, "Run as administrator"), vào thư mục ứng dụng.
2. Chạy: `powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1`. Kịch bản tạo tác vụ `QuanLyCTV-Web` (chạy khi bật máy, tự chạy lại khi lỗi, nhật ký ở `logs\server.log`) và `QuanLyCTV-SaoLuu` (02:30 hằng ngày), mở cổng tường lửa nếu chạy nội bộ, rồi khởi động ngay. Chạy lại là cài đè.
3. Gỡ: `powershell -ExecutionPolicy Bypass -File scripts\windows\uninstall.ps1`.
4. Chạy tay không cài tác vụ: nhấp đúp `scripts\windows\start.cmd`. Nếu tác vụ đang chạy, `start.cmd` sẽ báo lỗi `EADDRINUSE` (cổng đã bị chiếm): dừng tác vụ trước bằng `Stop-ScheduledTask -TaskName QuanLyCTV-Web` trong PowerShell **mở bằng quyền Administrator** (xem "Dừng ứng dụng" ở mục 15).
5. Tác vụ chạy qua `scripts\windows\run-server.cmd`: nếu máy chủ thoát vì lỗi thì chờ 60 giây rồi chạy lại. Ở chế độ Internet, nếu kiểm tra khởi động không đạt (ví dụ chưa đổi mật khẩu `admin`), máy chủ sẽ thử lại mỗi 60 giây và ghi lý do bằng tiếng Việt vào `logs\server.log` mỗi lần; sửa xong sẽ tự chạy. Nhật ký quá khoảng 10 MB được đổi thành `server.old.log`.
6. Tường lửa: chỉ mở cổng khi `mode` là `noi_bo` hoặc `listenLan` là `true` trong `quanly.config.json`, và chỉ cho hồ sơ mạng Domain/Private (Wi-Fi công cộng không được mở). Biến môi trường không ảnh hưởng quyết định này.

Cấu hình tùy chọn: chép `quanly.config.example.json` thành `quanly.config.json` rồi sửa (JSON không có chú thích): `mode` (`noi_bo` hoặc `internet`), `port`, `publicUrl`, `listenLan`, `backupDir` (thư mục sao lưu, để trống là `backups`). Chạy lại `install.ps1` sau khi đổi `port` hoặc `mode` để cập nhật tường lửa.

## 7. Lưu ý bảo mật

- Mặc định chỉ dùng trong mạng nội bộ. Muốn truy cập từ ngoài Internet phải làm đúng mục 15 (có xác thực 2 lớp, HTTPS) và được chỉ huy cho phép; không tự mở cổng router.
- **Không nhập thông tin mật** (tài liệu, nội dung có độ mật) vào hệ thống.
- Đổi mật khẩu mặc định ngay; đăng nhập sai 5 lần từ một máy sẽ khóa tài khoản với máy đó 15 phút (chi tiết ở mục 15, phần Lưu ý); phiên làm việc hết hạn sau 8 giờ không hoạt động; đổi mật khẩu sẽ đăng xuất các phiên khác của tài khoản.
- Tuân thủ quy định của đơn vị về quản lý, sử dụng máy tính và dữ liệu.

## 8. Vai trò

| Vai trò | Quyền chính |
|---|---|
| Quản trị viên (`admin`) | Toàn quyền: tài khoản, đơn vị, cài đặt, nhật ký, sao lưu, đồng thời có mọi quyền của quản lý |
| Quản lý (`manager`, ví dụ chính trị viên) | Giao việc, sửa/xóa việc, duyệt hoàn thành, xem quân số, báo cáo, hiệu suất, lịch, mẫu và việc định kỳ; **Văn bản**: tạo văn bản Word từ mẫu, tải mẫu riêng lên và quản lý mẫu |
| Chiến sĩ (`member`) | Xem và cập nhật việc được giao (chưa làm → đang làm → chờ duyệt), checklist, bình luận, xem lịch |

## 9. Chức năng

- Giao việc kèm lĩnh vực, mức ưu tiên (thường/gấp/hỏa tốc), hạn, nhiều người thực hiện, checklist; gợi ý người thực hiện và cảnh báo quá tải.
- Danh sách có lọc, tìm kiếm tiếng Việt (có dấu hoặc không dấu), bảng Kanban kéo thả (kéo thả dành cho chuột; trên màn hình cảm ứng như Surface, hãy mở công việc và bấm các nút chuyển trạng thái), "Việc của tôi" sắp theo mức khẩn.
- Mẫu công việc và việc định kỳ (hằng tuần/tháng) tự sinh việc.
- Lịch công tác theo tháng, kết hợp hạn chót công việc.
- Bảng tổng quan, báo cáo kết quả theo kỳ (sao chép/xuất Excel), thống kê hiệu suất, xuất danh sách việc ra Excel.
- Hồ sơ quân nhân: lý lịch, gia đình, quá trình công tác, khen thưởng/kỷ luật, nghỉ phép, theo dõi tư tưởng; nhắc mốc (chuyển Đảng chính thức, hết hạn phục vụ, niên hạn thăng quân hàm); nhập/xuất Excel (xem mục 11).
- Văn bản Word: tạo kế hoạch, báo cáo, danh sách quân nhân/đảng viên từ mẫu có sẵn hoặc mẫu riêng, tự điền thông tin đơn vị và hồ sơ quân nhân (xem mục 12).
- Trợ lý: giao việc bằng một câu nói thường, hỏi đáp về công việc/quân số, dàn ý văn bản và (tùy chọn) AI chạy cục bộ hỗ trợ viết nháp (xem mục 13).
- Quản trị tài khoản, đơn vị, nhật ký thao tác, sao lưu.
- Truy cập qua Internet (tùy chọn): chế độ `internet` qua Tailscale Funnel, HTTPS, bắt buộc xác thực 2 lớp cho quản trị/quản lý, mã dự phòng, giới hạn đăng nhập sai theo địa chỉ IP (xem mục 15).

## 10. Lộ trình

- **Phần 1 (đã xong):** lõi hệ thống: tài khoản, giao việc, Kanban, lịch, báo cáo.
- **Phần 2 (đã xong):** hồ sơ quân nhân, nhắc mốc, nhập/xuất Excel.
- **Phần 3 (đã xong):** kho mẫu văn bản Word: mẫu dựng sẵn, tải mẫu riêng, tự nhận dạng chỗ cần điền, tạo văn bản và danh sách từ hồ sơ.
- **Phần 4 (đã xong):** trợ lý: giao việc nhanh bằng câu nói, hỏi đáp, dàn ý văn bản, AI cục bộ (Ollama) hỗ trợ soạn thảo.

- **Phần 5 (đã xong):** đưa lên Internet an toàn: chế độ `internet`, xác thực 2 lớp, kiểm tra khởi động, kịch bản Windows tự chạy và sao lưu, hướng dẫn Tailscale Funnel (mục 15).

Cả 5 phần đã hoàn thành.

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

## 12. Văn bản Word

Mục **Văn bản** (menu bên trái; dành cho Quản trị viên và Quản lý) giúp tạo nhanh văn bản `.docx` từ mẫu, tự điền thông tin đơn vị và hồ sơ quân nhân.

### Bước đầu: cài thông tin đơn vị

Quản trị viên vào **Cài đặt → Thông tin đơn vị** và nhập: cấp trên, đơn vị, Đảng ủy, Chi bộ, địa danh, chức vụ, cấp bậc, họ tên người ký và họ tên bí thư (mỗi ô tối đa 120 ký tự). Các thông tin này tự điền vào đầu văn bản và phần chữ ký. Ô nào để trống thì văn bản để trống chỗ đó (trang tạo văn bản có cảnh báo nếu chưa cài).

### Tạo văn bản

1. Vào **Văn bản**, chọn mẫu rồi bấm **Tạo văn bản**.
2. Với mẫu cần quân nhân (danh sách, hoặc mỗi người một văn bản): lọc danh sách rồi tích chọn quân nhân. Chọn nhiều người ở mẫu "mỗi người một văn bản" sẽ nhận một tệp nén `.zip` (tên trùng được thêm ` (2)`, ` (3)`).
3. Nhập các ô cần gõ tay (số văn bản, trích yếu, nội dung, nơi nhận...). Ô "Ngày tháng" để trống sẽ lấy ngày hôm nay, dạng "Địa danh, ngày d tháng m năm yyyy".
4. Bấm **Tạo và tải văn bản**. Mở tệp bằng Word và rà soát lại trước khi ký, gửi.

Văn bản không bao giờ chứa dữ liệu tư tưởng hay ghi chú hoàn cảnh khó khăn, kể cả khi mẫu có ô như `{tu_tuong}` (ô đó ra trống). Mỗi lần tạo đều ghi vào **Nhật ký**.

### 5 mẫu dựng sẵn

- **Kế hoạch**, **Báo cáo**: văn bản chung, đầu văn bản hai cột (đơn vị | quốc hiệu, tiêu ngữ), nội dung, nơi nhận, chữ ký.
- **Báo cáo Chi bộ**: đầu văn bản Đảng (Đảng ủy, Chi bộ | Đảng Cộng sản Việt Nam), có dòng "Kính gửi", ký T/M Chi bộ - Bí thư.
- **Danh sách quân nhân**, **Danh sách đảng viên**: khổ ngang, bảng tự thêm dòng cho từng quân nhân đã chọn.

Đồng chí có thể tải tệp gốc (**Quản lý mẫu → Tải tệp mẫu về**), sửa trong Word rồi tải lại. Mẫu dựng sẵn không xóa được; nếu lỡ sửa hỏng, dùng **Khôi phục mẫu gốc** trong Quản lý mẫu. Lưu ý: mẫu dựng sẵn chỉ có thể thức cơ bản, đồng chí cần đối chiếu với quy định hiện hành của đơn vị.

### Tải mẫu riêng

1. **Văn bản → Tải mẫu lên**, chọn tệp **.docx** (tối đa 5MB). Tệp Word cũ `.doc` thì mở bằng Word, chọn **Save As** (Lưu thành) và đổi kiểu thành `.docx` rồi tải lại.
2. Hệ thống tự tìm các chỗ cần điền: nhãn như "Họ và tên: ......", "Ngày sinh: ......", "Quê quán: ______" (chỗ trống phải là dãy dấu chấm `......`, dấu ba chấm `……` hoặc gạch dưới `______`; nhãn chỉ có dấu hai chấm rồi để trống như "Họ và tên:" thì **không** được nhận ra, đồng chí gõ thêm dấu chấm hoặc tự gõ mã `{ho_ten}`. Nhãn bị Word tách thành nhiều đoạn chữ vẫn nhận ra). Dòng "……, ngày …… tháng …… năm 20……" được nhận là một chỗ (ngày tháng có địa danh); dấu lửng trong câu văn mặc định **bỏ qua**.
3. Ở trang xem lại, với mỗi chỗ tìm được, chọn: điền tự động bằng một trường của hệ thống (họ tên, ngày sinh, cấp bậc...), tạo **ô nhập tay** mới (gõ khi tạo văn bản), hoặc **bỏ qua**.
4. Đặt tên mẫu, chọn nhóm và chế độ (văn bản chung / mỗi quân nhân một văn bản / một danh sách nhiều người), rồi **Lưu thành mẫu**. Danh mục đầy đủ các mã trường xem ở **Danh mục ô trống**.

### Tự viết ô trống trong Word

Đồng chí cũng có thể gõ trực tiếp vào mẫu Word:

- Ô trống: gõ mã trong ngoặc nhọn, ví dụ `{ho_ten}`, `{ngay_thang}`, `{don_vi}`. Gõ liền một lần, không đổi kiểu chữ giữa chừng để Word không tách ô. Mã sai hoặc thiếu ngoặc (như `{ho_ten`) sẽ bị báo lỗi bằng tiếng Việt khi lưu mẫu.
- Bảng lặp theo danh sách: ở dòng dữ liệu của bảng, gõ `{#ds}` ở **ô đầu tiên** và `{/ds}` ở **ô cuối cùng** của dòng đó (ví dụ ô đầu `{#ds}{stt}`, ô cuối `{sdt}{/ds}`). Hệ thống nhân dòng ấy lên cho mỗi quân nhân đã chọn.
- Giá trị thiếu được để trống, không bao giờ in chữ "undefined".
- Dấu ngoặc nhọn trong dữ liệu (ví dụ trong nội dung gõ tay) được in nguyên văn `{ }`, không bị hiểu nhầm là ô trống. Riêng dấu ngoặc nhọn đứng lẻ có sẵn **trong tệp mẫu tải lên** (thân văn bản, đầu/chân trang, chú thích, nhận xét, thuộc tính tài liệu) được đổi thành ngoặc toàn chiều rộng ｛ ｝ khi lưu mẫu để mẫu không bị lỗi.
- Trường nhập nhiều dòng (ví dụ `noi_dung`): `{noi_dung}` đưa cả nội dung vào một đoạn; muốn mỗi dòng thành một đoạn riêng (giữ căn đều, thụt đầu dòng) thì gõ ba đoạn liền nhau `{#noi_dung_doan}`, `{.}`, `{/noi_dung_doan}` (xem **Danh mục ô trống**).

### Lưu ý bảo mật và xử lý sự cố

- **Không đưa tài liệu mật, tài liệu nội bộ lên bất kỳ dịch vụ bên ngoài nào** (trang web chuyển đổi, soạn thảo trực tuyến...). Mẫu tải lên chỉ nằm trong cơ sở dữ liệu cục bộ của ứng dụng, không gửi ra Internet; vẫn không nên đưa nội dung có độ mật vào mẫu.
- Tệp tải về mở ra báo "nội dung không đọc được" (unreadable content): đồng chí giữ lại tệp, ghi lại mẫu và dữ liệu đã dùng rồi báo người cài đặt để xử lý.
- Tải mẫu lên báo lỗi cú pháp: kiểm tra từng cặp ngoặc `{ }` và cặp `{#ds}` / `{/ds}`.
- Mẫu dựng sẵn do tệp trong thư mục `templates/builtin` tạo ra; sau khi nâng cấp ứng dụng, dùng **Khôi phục mẫu gốc** để nhận bản mẫu mới nhất (sẽ mất chỉnh sửa của đồng chí trên mẫu đó).

## 13. Trợ lý

Mục **Trợ lý** (menu bên trái) gồm ba thẻ. Quản trị viên và Quản lý thấy cả ba; chiến sĩ chỉ thấy **Hỏi đáp**. Giao việc nhanh, Hỏi đáp và Dàn ý chạy hoàn toàn bằng quy tắc trong ứng dụng, **không cần AI**.

### Giao việc nhanh

Đồng chí gõ một câu như nói chuyện, ví dụ:

- `giao đ/c Bảo soạn báo cáo chi bộ trước thứ Sáu tuần sau, gấp`
- `Bảo và Cường dọn dẹp phòng truyền thống trước ngày 20/12`
- `nhắc đồng chí Hải nộp danh sách đảng viên vào cuối tháng, hỏa tốc` (nếu có nhiều người tên Hải, trợ lý hỏi chọn đúng người)

Trợ lý nhận ra: **người thực hiện** (sau "đ/c", "đồng chí", "giao", "giao cho"; theo họ tên, tên gọi hoặc hai từ cuối; nhiều người nối bằng "và", "cùng", dấu phẩy; tên đứng ngay đầu câu không có "đ/c" chỉ được nhận khi có từ hai người trở lên, viết hoa, như ví dụ thứ hai; "giao cho Trung đội 2 …" được hiểu là giao cho đơn vị, đồng chí tự chọn người), **hạn** (ngày cụ thể như `20/12` hoặc `ngày 20-12`, hôm nay, ngày mai, thứ trong tuần này/tuần sau, cuối tuần, cuối tháng, trong N ngày, sau N ngày...), **mức ưu tiên** (thường, gấp, hỏa tốc) và **lĩnh vực** (theo từ khóa trong câu). Phần còn lại thành tiêu đề; câu gốc được ghi vào ô **Nội dung** của phiếu để đồng chí đối chiếu. Nếu một tên trùng nhiều người, trợ lý hiện trang **Chọn đúng người**; tên không tìm thấy được ghi chú trên phiếu.

Kết quả được **điền sẵn vào phiếu giao việc**; đồng chí **luôn đọc lại và sửa trước khi bấm Lưu**, trợ lý không tự giao việc.

### Hỏi đáp

Gõ câu hỏi hoặc bấm câu gợi ý. Trợ lý chỉ trả lời từ dữ liệu trong ứng dụng, không bịa.

| Vai trò | Câu hỏi mẫu |
|---|---|
| Mọi người | `việc nào quá hạn`; `việc của tôi`; `việc đến hạn hôm nay`; `việc đến hạn tuần này`; `việc đến hạn 7 ngày tới`; `tình hình tuần này` |
| Quản lý, quản trị viên (thêm) | `việc của Bảo`; `ai đang quá tải`; `ai đang nghỉ phép hôm nay`; `ai sắp chuyển Đảng chính thức`; `ai sắp hết hạn phục vụ`; `ai đến niên hạn xét thăng quân hàm`; `bao nhiêu đảng viên`; `danh sách quân số trung đội 1` |

Chiến sĩ chỉ hỏi được về việc của chính mình. **Trợ lý không bao giờ trả lời về tư tưởng, hoàn cảnh khó khăn** (kể cả với quản lý); các nội dung này chỉ xem trong hồ sơ quân nhân.

### Dàn ý

Ở thẻ **Soạn thảo** (và ngay trong form tạo văn bản), chọn loại rồi bấm **Chèn dàn ý** để có khung văn bản có sẵn: **Kế hoạch**, **Báo cáo**, **Báo cáo tuần**, **Biên bản sinh hoạt** (báo cáo tuần tự lấy số liệu công việc trong tuần từ ứng dụng; kế hoạch, báo cáo và biên bản là khung mục để đồng chí điền); có thể nhập chủ đề. Nếu ô đã có chữ, hệ thống hỏi trước khi thay.

### Trợ lý AI (tùy chọn)

AI dùng để viết nội dung từ dàn ý, sửa chính tả, chỉnh văn phong quân đội, rút gọn, viết lại. AI chạy bằng phần mềm **Ollama** ngay trên máy của đơn vị.

**Cài trên chính máy chạy ứng dụng (Windows):**

1. Tải Ollama từ **ollama.com**, chạy tệp cài đặt.
2. Mở PowerShell và tải mô hình (cần Internet một lần):
   ```powershell
   ollama pull qwen2.5:3b
   ```
3. Vào **Quản trị → Cài đặt → Trợ lý AI**: tích **Bật Trợ lý AI**, giữ địa chỉ `http://127.0.0.1:11434`, mô hình `qwen2.5:3b`, bấm **Lưu cài đặt Trợ lý AI**, rồi bấm **Kiểm tra kết nối** (phải liệt kê được mô hình `qwen2.5:3b`).

**Máy 8GB RAM:** mỗi câu trả lời có thể mất **30–90 giây**. Nên đóng bớt ứng dụng khác khi chạy AI; nếu hay báo hết thời gian chờ, tăng "Thời gian chờ" trong Cài đặt. Một lúc chỉ chạy một yêu cầu AI.

**Dùng máy khác mạnh hơn trong mạng nội bộ:**

1. Trên máy đó cài Ollama và `ollama pull` mô hình như trên.
2. Đặt biến môi trường `OLLAMA_HOST=0.0.0.0` (System Properties → Advanced → Environment Variables → New, hoặc gõ "Edit the system environment variables"), rồi thoát và mở lại Ollama.
3. Mở cổng 11434 vào máy đó, PowerShell quyền Administrator:
   ```powershell
   New-NetFirewallRule -DisplayName "Ollama 11434" -Direction Inbound -Protocol TCP -LocalPort 11434 -Action Allow
   ```
4. Ở **Cài đặt → Trợ lý AI** nhập `http://<IP>:11434` (dùng **địa chỉ IP**, ví dụ `http://192.168.1.50:11434`, không dùng tên có dấu chấm; địa chỉ ngoài mạng nội bộ bị từ chối), lưu rồi **Kiểm tra kết nối**.

**Riêng tư và lưu ý:**

- AI chỉ chạy trên máy của đơn vị. Chỉ **đoạn chữ đồng chí gõ vào** được gửi cho AI; AI không đọc hồ sơ quân nhân, không gửi gì ra Internet.
- Kết quả AI **có thể sai hoặc bịa số liệu**; luôn đọc lại, sửa trước khi dùng. Đây chỉ là bản nháp hỗ trợ.
- **Không dán nội dung có độ mật** vào ô soạn thảo.
- Có thể dán vài đoạn văn bản mẫu của đơn vị ở Cài đặt → Trợ lý AI để AI viết theo văn phong đó.
- Mỗi lần chạy AI được ghi vào Nhật ký (không lưu nội dung).

## 14. Xử lý sự cố

- **Cổng 3000 đang được dùng** (`EADDRINUSE`): chọn cổng khác, ví dụ `$env:PORT = 8080; npm start`, rồi mở cổng đó trong tường lửa.
- **Báo phiên bản Node quá cũ** hoặc lỗi `node:sqlite`: kiểm tra `node -v`, cài lại Node.js 22 LTS (≥ 22.13).
- **Máy khác không vào được:** kiểm tra IP bằng `ipconfig`, hai máy cùng mạng, đã mở cổng tường lửa như mục 3.
- **Quên mật khẩu:** quản trị viên bấm "Đặt lại mật khẩu" ở mục Tài khoản. Nếu quên mật khẩu admin duy nhất, liên hệ người cài đặt để khôi phục từ bản sao lưu. Quản trị viên mất cả điện thoại lẫn mã dự phòng 2 lớp: chạy `scripts\windows\reset-2fa.cmd` ngay trên máy chủ (mục 15).
- Đặt đường dẫn dữ liệu khác bằng biến `DB_PATH`.

## 15. Đưa lên Internet

> **CẢNH BÁO QUAN TRỌNG.** Luật Bảo vệ bí mật nhà nước 2018 (Điều 5, các hành vi bị nghiêm cấm) **cấm** soạn thảo, lưu giữ tài liệu có nội dung bí mật nhà nước trên máy tính, thiết bị đã hoặc đang kết nối với mạng Internet, **mạng máy tính, mạng viễn thông** (trừ trường hợp luật cho phép theo quy định về cơ yếu). Như vậy **chạy trong mạng nội bộ cũng không phải là ngoại lệ**: dù ở chế độ nào cũng không nhập nội dung mật. Trước khi làm các bước dưới đây, đồng chí **phải báo cáo và được sự đồng ý của chỉ huy đơn vị và cán bộ bảo mật**. Khi hệ thống mở ra Internet, **tuyệt đối không nhập bất kỳ nội dung có độ mật nào** (tài liệu, tư tưởng chi tiết, thông tin nhạy cảm). Nếu chưa được phép, chỉ dùng trong mạng nội bộ (mục 2 và 3).
>
> Hồ sơ quân nhân có thông tin gia đình, sức khỏe, ghi nhận tư tưởng: đây là **dữ liệu cá nhân** (một phần có thể là dữ liệu cá nhân nhạy cảm) theo Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân và các văn bản sửa đổi, thay thế (nếu có). Đưa các dữ liệu này lên một hệ thống truy cập được từ Internet cần chỉ huy cân nhắc; nhà phát triển không đưa ra ý kiến pháp lý, đồng chí hỏi cán bộ bảo mật hoặc pháp chế của đơn vị.

Cách làm: dùng **Tailscale Funnel** để cấp một địa chỉ `https://...ts.net` trỏ vào máy Surface đang chạy ứng dụng; không phải mở cổng trên router. Cần một tài khoản Google hoặc Microsoft để đăng nhập Tailscale.

**Các bước (làm lần lượt, đúng thứ tự):**

1. **Chuẩn bị dữ liệu ở chế độ nội bộ** (chưa có `quanly.config.json`, hoặc `mode` là `noi_bo`):
   1. Khởi động ứng dụng (`npm start` hoặc nhấp đúp `scripts\windows\start.cmd`; nếu đã cài tự chạy ở mục 6 thì ứng dụng đang chạy sẵn).
   2. **Trên chính máy Surface**, mở trình duyệt vào `http://localhost:3000`, đăng nhập `admin` (mật khẩu `admin123`, hoặc `Demo@1234` nếu từng chạy `npm run demo`) và **đổi mật khẩu**: với `admin123` hệ thống tự yêu cầu đổi; với `Demo@1234` thì bấm **Đổi mật khẩu** ở góc trên (với dữ liệu thử hệ thống không tự yêu cầu). Kiểm tra khi khởi động ở chế độ Internet sẽ từ chối chạy nếu `admin` còn mật khẩu `admin123` hoặc `Demo@1234`.
   3. Nếu từng chạy `npm run demo` trên dữ liệu này, phải bỏ dữ liệu thử (kiểm tra khi khởi động ở chế độ Internet sẽ **từ chối chạy** nếu còn tài khoản thử dùng mật khẩu `Demo@1234` hoặc `admin` chưa đổi mật khẩu):
      - **Chưa nhập dữ liệu thật nào:** vào **Quản trị → Sao lưu dữ liệu** tải một bản sao lưu cho chắc, dừng ứng dụng (mục "Dừng ứng dụng" dưới đây), **đổi tên** thư mục `data` thành `data-thu` (đổi tên, không xóa), khởi động lại để có cơ sở dữ liệu mới, rồi làm lại bước 1.2 với `admin / admin123`.
      - **Đã nhập dữ liệu thật:** **không** đổi tên hay xóa thư mục `data`. Vào **Quản trị → Tài khoản**, với từng tài khoản thử `ctv`, `cs01` … `cs10`: bấm **Đặt lại mật khẩu** (mật khẩu `Demo@1234` mất hiệu lực) rồi bấm **Khóa** ở tài khoản đó; xóa tay các công việc, hồ sơ hư cấu nếu không cần.
   4. Dừng ứng dụng (xem "Dừng ứng dụng" dưới đây).
2. **Cài Tailscale cho Windows.** Tải tại https://tailscale.com/download, cài đặt, mở và đăng nhập bằng tài khoản Google hoặc Microsoft.
3. **Cài đặt Tailscale cần thiết** (làm trên trang quản trị Tailscale, đăng nhập tại tailscale.com bằng cùng tài khoản, và trên biểu tượng Tailscale ở góc màn hình). Giao diện Tailscale có thể đổi; tên chức năng dưới đây là tên Tailscale đặt, nếu không thấy đúng chỗ thì xem **tailscale.com/kb/1223/funnel**:
   - Bật **MagicDNS** và **HTTPS Certificates** (chứng chỉ HTTPS) cho mạng Tailscale (thường ở trang DNS). Không có hai mục này thì Funnel không cấp được địa chỉ `https://`.
   - Cho phép **Funnel** với máy này (thuộc tính `funnel` trong chính sách truy cập). Cách dễ nhất: ở bước 6, nếu chưa được phép, lệnh `tailscale funnel` sẽ **in ra một đường link** `https://login.tailscale.com/...`; mở link đó, bấm đồng ý, rồi chạy lại lệnh.
   - Trên máy Surface: bấm biểu tượng Tailscale ở khay hệ thống, bật **Run unattended** (chạy cả khi chưa đăng nhập Windows). Nếu không bật, sau khi khởi động lại máy, ứng dụng vẫn chạy nhưng Internet không vào được cho đến khi có người đăng nhập Windows.
   - Trong trang quản trị Tailscale, mục danh sách máy (Machines): ở máy Surface chọn **Disable key expiry** (tắt hết hạn khóa). Nếu không, khoảng 180 ngày sau Funnel sẽ ngừng mà không báo.
4. **Lấy địa chỉ công khai và tạo cấu hình.** Mở PowerShell, chạy:
   ```powershell
   (tailscale status --json | ConvertFrom-Json).Self.DNSName
   ```
   Kết quả dạng `surface.tail1234.ts.net.` (bỏ dấu chấm cuối). Chép `quanly.config.example.json` thành `quanly.config.json`, mở bằng Notepad, sửa `"mode": "internet"` và `"publicUrl": "https://surface.tail1234.ts.net"` (thay bằng tên của máy; giữ nguyên dấu nháy, dấu phẩy).
5. **Chạy ứng dụng ở chế độ Internet.** Trước hết **bảo đảm không còn bản ứng dụng nào đang chạy** ở chế độ nội bộ (đóng mọi cửa sổ `start.cmd`, làm theo "Dừng ứng dụng"). Mở PowerShell **bằng quyền Administrator**, vào thư mục ứng dụng, chạy `powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1`. **Chạy lại lệnh này sau mỗi lần sửa `quanly.config.json`.** Mở `logs\server.log`: phải có dòng `Chế độ Internet: truy cập từ xa qua https://...`; nếu thấy "Từ chối chạy ở chế độ Internet" thì sửa theo lý do ghi trong đó.
6. **Chỉ bây giờ mới bật Funnel** (khi ứng dụng đã chạy ở chế độ Internet, để Internet không bao giờ vào được bản chạy chế độ nội bộ). Trong PowerShell:
   ```powershell
   tailscale funnel --bg 3000
   ```
   Lệnh in ra địa chỉ `https://<tên-máy>.<tên-mạng>.ts.net`, phải **trùng** với `publicUrl`. (Nếu đổi cổng thì thay `3000` bằng cổng đó.) Nếu lệnh in ra một đường link thay vì địa chỉ, làm theo bước 3 rồi chạy lại.
7. **Bật xác thực 2 lớp cho admin.** **Cài Google Authenticator hoặc Microsoft Authenticator trên điện thoại trước**, vì sau khi nhập mật khẩu chỉ có **5 phút** để bật 2 lớp (quá 5 phút phải đăng nhập lại). Trên **máy tính** (ngay máy Surface cũng được), mở địa chỉ công khai `https://...ts.net`, đăng nhập `admin`. Trang bật 2 lớp hiện mã QR **trên màn hình máy tính**: dùng **điện thoại** quét mã đó trong ứng dụng xác thực. Không quét được thì chọn **Nhập khóa thiết lập** (Google) hoặc **Nhập mã theo cách thủ công** (Microsoft) và gõ khóa chữ hiện dưới mã QR, cách này cũng dùng được. Nhập mã 6 số, rồi **chép 10 mã dự phòng ra giấy** và cất kỹ. Sau đó thử đăng nhập lại từ điện thoại (**tắt Wi-Fi, dùng 4G**) để chắc chắn vào được từ Internet.
8. **Tạo tài khoản** cho cán bộ, chiến sĩ (Quản trị → Tài khoản) và gửi địa chỉ công khai cho họ. Tài khoản quản trị và quản lý sẽ phải bật 2 lớp ở lần đăng nhập đầu (nhắc họ cài ứng dụng xác thực trước và dùng máy tính để hiện mã QR, hoặc nhập khóa thủ công trên chính điện thoại); chiến sĩ có thể tự bật ở **Bảo mật tài khoản**. Nên tạo thêm **một tài khoản quản trị thứ hai** (bật 2 lớp, mật khẩu cất riêng) để dự phòng.
9. **Kiểm tra địa chỉ IP thật.** Nhờ một người đăng nhập từ điện thoại dùng 4G, rồi vào **Quản trị → Nhật ký**, xem cột **IP** của dòng "Đăng nhập": phải là IP của người đó, **không phải `127.0.0.1`** (dòng đăng nhập ngay trên máy Surface qua `http://localhost:3000` thì là `127.0.0.1`, đúng như vậy). Nếu mọi lần đăng nhập từ xa đều là `127.0.0.1`: **tắt Funnel ngay (bước 10) và báo lại**, vì khi đó mọi người dùng chung một bộ đếm đăng nhập sai và chức năng chống dò mật khẩu không đúng.
10. **Tắt Internet tạm thời:** `tailscale funnel --https=443 off` hoặc `tailscale funnel reset` (lệnh `reset` xóa cả cấu hình `tailscale serve` khác nếu có). Bật lại: `tailscale funnel --bg 3000`. Xem trạng thái: `tailscale funnel status`.

**Dừng ứng dụng** (dùng ở bước 1, bước 5 và khi khôi phục):

- Đang chạy bằng cửa sổ `start.cmd` hoặc `npm start`: bấm Ctrl+C trong cửa sổ đó.
- Đã cài tự chạy (mục 6): mở PowerShell **bằng quyền Administrator** (tác vụ được cài với quyền cao nhất, PowerShell thường không dừng được) và chạy:
  ```powershell
  Stop-ScheduledTask -TaskName QuanLyCTV-Web
  Get-Process node -ErrorAction SilentlyContinue
  ```
  Nếu lệnh thứ hai còn in ra tiến trình `node`, mở Task Manager (Ctrl+Shift+Esc) → thẻ **Details**, chọn `node.exe` → **End task** (nhà phát triển chưa kiểm chứng trên Windows việc dừng tác vụ có dừng luôn `node.exe` hay không). Chỉ chép đè tệp dữ liệu khi không còn `node.exe` nào. Chạy lại: `Start-ScheduledTask -TaskName QuanLyCTV-Web` (cũng bằng quyền Administrator).

**Lưu ý:**

- Ở chế độ Internet, trên chính máy Surface thường dùng được `http://localhost:3000` (Chrome và Edge coi `localhost` là an toàn nên giữ được đăng nhập); nếu trình duyệt không giữ được đăng nhập (trang đăng nhập cứ hiện lại), dùng địa chỉ công khai `https://...ts.net`.
- **`listenLan: true` ở chế độ Internet:** các máy trong mạng nội bộ vào bằng `http://<IP>:3000` sẽ **không đăng nhập được** (cookie đăng nhập chỉ gửi qua HTTPS). Đây là cấu hình không hỗ trợ; ở chế độ Internet, mọi người (kể cả trong mạng nội bộ) dùng địa chỉ `https://...ts.net`.
- Máy Surface **phải luôn bật và có mạng**. Vào Settings → System → Power, đặt "Sleep" thành **Never** khi cắm điện.
- Địa chỉ `...ts.net` sẽ **bị công khai**: mọi chứng chỉ HTTPS đều được ghi vào nhật ký công khai (Certificate Transparency), nên các máy quét trên Internet tìm ra địa chỉ chỉ sau vài phút. Thấy trong **Nhật ký** nhiều lần "Đăng nhập thất bại" hoặc "Khóa thiết bị (IP)" từ IP lạ là chuyện **bình thường**; hệ thống đã tự khóa. Chỉ lo khi thấy "Đăng nhập" thành công lạ: đổi mật khẩu tài khoản đó ngay.
- **Khóa khi đăng nhập sai:** sai mật khẩu 5 lần từ một thiết bị (IP) thì tài khoản bị khóa **với riêng thiết bị đó** 15 phút, người dùng ở nơi khác vẫn đăng nhập được; sai tổng cộng 30 lần từ mọi nơi trong 15 phút thì tài khoản bị khóa ở mọi nơi 15 phút. Một thiết bị sai 10 lần (bất kỳ tài khoản nào) thì thiết bị đó bị chặn 15 phút. **Người ngồi ngay tại máy Surface**, mở `http://localhost:3000`, **không bị khóa tài khoản** (vẫn phải đúng mật khẩu và mã 2 lớp): nếu kẻ gian cố tình nhập sai để khóa `admin`, quản trị viên vẫn đăng nhập được tại máy Surface.
- Ai biết mật khẩu một tài khoản có thể cố tình nhập sai mã 2 lớp để **khóa xác thực 2 lớp của tài khoản đó 15 phút** (gây phiền, không vào được hệ thống). Nếu nghi ngờ: đổi mật khẩu tài khoản (đổi mật khẩu sẽ **đăng xuất mọi phiên khác** của tài khoản), kiểm tra **Nhật ký**.
- Mất điện thoại: quản trị viên bấm **Đặt lại xác thực 2 lớp** ở mục Tài khoản, người dùng bật lại ở lần đăng nhập kế. Quản trị viên mất điện thoại: dùng **mã dự phòng** (ô "Dùng mã dự phòng" ở trang nhập mã), hoặc nhờ quản trị viên thứ hai đặt lại.
- **Quản trị viên mất cả điện thoại lẫn mã dự phòng** (và không có quản trị viên thứ hai): **ngồi tại máy Surface**, nhấp đúp `scripts\windows\reset-2fa.cmd`, gõ tên đăng nhập (ví dụ `admin`) rồi Enter; hoặc trong PowerShell ở thư mục ứng dụng chạy `node scripts\reset-2fa.js admin`. Lệnh xóa xác thực 2 lớp của tài khoản đó, đăng xuất mọi phiên, mở khóa đăng nhập và ghi vào Nhật ký ("Đặt lại xác thực 2 lớp", chi tiết `CLI`); không cần dừng ứng dụng. Lần đăng nhập tới, tài khoản phải bật lại 2 lớp (bước 7). **Không** khôi phục bản sao lưu để làm việc này: bản sao lưu chứa đúng khóa 2 lớp cũ (nằm trên điện thoại đã mất), và sẽ làm mất dữ liệu nhập sau ngày sao lưu.
- **Khôi phục từ sao lưu:** gói `.zip` tải về chứa `data.db` và `secret.key`; sao lưu hằng ngày trong `backups\` là từng cặp `.db` + `.key`. Dừng ứng dụng (xem "Dừng ứng dụng"), chép vào thư mục `data\` với tên `data.db` và `secret.key`, xóa `data.db-wal` và `data.db-shm` nếu có, rồi `Start-ScheduledTask -TaskName QuanLyCTV-Web` (PowerShell quyền Administrator). Bản sao lưu chứa khóa `secret.key` và mật khẩu đã băm, nên cất như tài liệu quan trọng; bản sao lưu **không** chứa phiên đăng nhập, sau khi khôi phục mọi người đăng nhập lại.
- Các kịch bản Windows và lệnh Tailscale **chưa được nhà phát triển chạy thử trên Windows**. Nếu gặp lỗi, chụp màn hình thông báo và gửi lại để sửa.
