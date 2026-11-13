# Phần 5 – Đưa website ra Internet: Thiết kế và kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cho phép truy cập website qua Internet bằng Tailscale Funnel (HTTPS, địa chỉ cố định, chỉ cài trên máy Surface), với gia cố bảo mật (chế độ Internet, chống dò mật khẩu theo IP, xác thực 2 lớp bắt buộc cho Chỉ huy/Chính trị viên, kiểm tra an toàn khi khởi động) và chạy ổn định trên Windows (tự chạy khi bật máy, tự sao lưu hằng ngày).

**Đã duyệt trong trò chuyện (13/11/2026):** Tailscale Funnel; gia cố như mục dưới; người dùng tự cài Tailscale/bật Funnel trên máy Surface theo hướng dẫn. Người dùng đã được nhắc về quy định bảo vệ bí mật nhà nước và cần báo cáo chỉ huy.

**Architecture:** Cấu hình chạy đọc từ tệp `quanly.config.json` ở thư mục ứng dụng (mặc định không có = chế độ nội bộ như cũ) và biến môi trường (ưu tiên biến môi trường). Mã 2 lớp TOTP (RFC 6238) tự viết bằng `crypto` có sẵn; ảnh QR dùng thư viện `qrcode` (thuần JS, chạy offline). Kịch bản Windows bằng PowerShell + Task Scheduler.

**Tech Stack:** Node.js ≥ 22.13, express 4, ejs 3, node:sqlite; phụ thuộc mới duy nhất: `qrcode` (ghi phiên bản cố định).

## Global Constraints

- Chế độ: `mode` = `noi_bo` (mặc định) | `internet`. Nguồn: env `QLCTV_MODE` > `quanly.config.json` `{ "mode": "internet", "port": 3000, "publicUrl": "https://…" }` > mặc định. Env `PORT` vẫn ưu tiên cho cổng.
- Chế độ internet: cookie phiên thêm `Secure`; `app.set('trust proxy', 'loopback')` (Funnel chuyển tiếp từ 127.0.0.1); khi chạy internet chỉ lắng nghe `127.0.0.1` (Funnel nối vào localhost; mạng LAN vẫn dùng được ở chế độ nội bộ — chế độ internet ưu tiên an toàn) — trừ khi config `"listenLan": true`.
- Tiêu đề bảo mật (cả hai chế độ): `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` (nếu có style inline thì thêm `'unsafe-inline'` CHỈ cho style-src); chế độ internet thêm `Strict-Transport-Security: max-age=31536000`. Không còn script inline hay thuộc tính `on*=` trong view (chuyển sang tệp JS; xác nhận xóa dùng `data-confirm="…"` + `public/js/confirm.js`).
- Chống dò mật khẩu theo IP: ≥ 10 lần đăng nhập sai từ một IP trong 15 phút → khóa IP đó 15 phút ("Quá nhiều lần đăng nhập sai từ thiết bị này, thử lại sau 15 phút"); lưu trong bộ nhớ (Map, dọn định kỳ); áp dụng cả bước nhập mã 2 lớp. Giữ nguyên khóa theo tài khoản (5 lần).
- Xác thực 2 lớp (TOTP, SHA-1, 6 số, chu kỳ 30 giây, chấp nhận lệch ±1 chu kỳ, không dùng lại cùng mã trong cửa sổ đó): bảng `user_totp(user_id PK, secret_enc, enabled, recovery_hashes JSON, last_step, created_at)`; secret mã hóa AES-256-GCM với khóa trong `data/secret.key` (tạo ngẫu nhiên lần đầu, quyền chỉ đọc chủ sở hữu khi có thể). 10 mã dự phòng (8 ký tự), lưu băm scrypt, dùng một lần.
- Bắt buộc 2 lớp: chế độ internet + vai trò admin/manager → sau mật khẩu, nếu chưa bật thì chuyển tới trang bật 2 lớp (không vào được trang khác); nếu đã bật thì trang nhập mã. Member: tùy chọn (trang "Bảo mật tài khoản"). Chế độ nội bộ: tùy chọn cho mọi người.
- Phiên ở trạng thái "đã qua mật khẩu, chưa qua 2 lớp" không được truy cập trang nào khác ngoài `/2fa/*` và `/logout`; hết hạn sau 5 phút.
- Admin: "Đặt lại xác thực 2 lớp" cho một tài khoản (audit `totp_reset`); người dùng tự tắt cần nhập mã hiện tại.
- Kiểm tra khi khởi động ở chế độ internet — từ chối chạy (in lý do tiếng Việt, thoát mã 1) nếu: tài khoản `admin` còn `must_change_password=1`; tồn tại tài khoản dữ liệu thử (username `ctv` hoặc `cs01`…`cs10` có mật khẩu `Demo@1234`); hoặc chưa đặt `publicUrl` bắt đầu bằng `https://`.
- Nhật ký: `totp_enable`, `totp_disable`, `totp_reset`, `login_ip_blocked`, `recovery_code_used` (nhãn tiếng Việt trong `AUDIT_ACTIONS`).
- Kịch bản Windows trong `scripts/windows/`: `start.cmd`, `install.ps1` (Task Scheduler: chạy `node src/server.js` khi khởi động máy dưới tài khoản hiện tại, khởi động lại khi lỗi, thư mục làm việc = thư mục ứng dụng; tác vụ sao lưu 02:30 hằng ngày), `uninstall.ps1`, `backup.cmd`; `scripts/backup.js` (VACUUM INTO `backups/saoluu-YYYY-MM-DD-HHmm.db`, giữ 30 bản mới nhất, thư mục cấu hình được). Không thể chạy thử PowerShell trên Linux: viết cẩn thận, `Set-StrictMode`, kiểm tra quyền Administrator, thông báo tiếng Việt; README ghi rõ chưa được chạy thử trên Windows bởi nhà phát triển.
- Toàn bộ giao diện tiếng Việt, xưng "đồng chí". Commit trailers như các phần trước, `git push` sau mỗi commit.

## Review Focus

1. Bỏ qua 2 lớp bằng cách gọi thẳng trang khác khi phiên mới qua mật khẩu → phải bị chặn. Test Task 2.
2. Dùng lại mã TOTP vừa dùng (replay) và mã dự phòng đã dùng → từ chối. Test Task 2.
3. CSP làm hỏng chức năng (Kanban, gợi ý người, biểu đồ, tải tệp, trợ lý stream, nút xóa có xác nhận) → chạy `npm run screenshots` với CSP bật và không có lỗi console. Task 1/4.
4. IP thật sau proxy: không tin `X-Forwarded-For` từ máy khác ngoài localhost; chế độ nội bộ không tin proxy. Test Task 1.
5. Kiểm tra khởi động chặn đúng các trường hợp nguy hiểm và không chặn cấu hình đúng. Test Task 1.

---

### Task 1: Chế độ Internet, tiêu đề bảo mật, CSP, chống dò theo IP, kiểm tra khởi động

**Files:** Create `src/config.js` (`loadConfig(env, appDir) → {mode, port, publicUrl, listenLan}`), `src/security.js` (`securityHeaders(config)`, `ipLimiter` với `check(ip)`, `fail(ip)`, `reset(ip)`), `src/startupCheck.js` (`startupProblems(db, config) → string[]`), `public/js/confirm.js`, các tệp JS thay script inline; Modify `src/server.js`, `src/auth.js` (cookie Secure theo config; IP limiter trong login), các view có script inline / `onsubmit` / `onclick`, `views/layout.ejs` (nạp confirm.js), `AUDIT_ACTIONS`; Test `test/security.test.js`, `test/config.test.js`.

- [ ] **Step 1: Test fail** — loadConfig: env thắng file, file thiếu → noi_bo, JSON hỏng → lỗi tiếng Việt rõ ràng; headers có đủ giá trị ở Global Constraints, HSTS chỉ ở internet; cookie có `Secure` chỉ ở internet; IP limiter: 10 lần sai cùng IP → lần 11 bị chặn kể cả mật khẩu đúng, IP khác vẫn đăng nhập được, sau 15 phút (giả lập thời gian) mở lại; trust proxy: ở internet, request từ 127.0.0.1 với `X-Forwarded-For: 1.2.3.4` → ip 1.2.3.4; ở noi_bo → bỏ qua header; startupProblems trả đúng lý do cho từng trường hợp và rỗng cho cấu hình tốt; quét `views/**/*.ejs` không còn `<script>` có nội dung inline hay thuộc tính `on[a-z]+=` (test tĩnh).
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt; chuyển mọi script inline sang `public/js/*.js` (dữ liệu truyền qua `data-*` hoặc `<script type="application/json">` — loại này không bị CSP chặn vì không thực thi). **Step 4:** PASS toàn bộ + `npm run screenshots` TẤT CẢ ĐẠT (không lỗi console do CSP). Commit `feat: chế độ Internet, tiêu đề bảo mật và chống dò mật khẩu`.

### Task 2: Xác thực 2 lớp (TOTP)

**Files:** Create `src/services/totp.js` (`generateSecret()`, `totpAt(secret, step)`, `verifyTotp(secret, code, now, lastStep) → step|null`, `otpauthUri(secret, username, issuer)`, mã hóa/giải mã secret, `makeRecoveryCodes()`), `src/routes/twofa.js` (`/2fa/setup` GET/POST, `/2fa/verify` GET/POST, `/2fa/recovery` POST, `/account/security` GET + tắt 2 lớp POST), views tương ứng, `public/js/twofa.js` nếu cần; Modify `src/db.js` (migration `user_totp`), `src/auth.js` (trạng thái phiên chờ 2 lớp; `requireLogin` chặn mọi đường dẫn ngoài `/2fa/*`, `/logout`, tĩnh), `src/routes/admin.js` + view tài khoản (nút Đặt lại 2 lớp), `package.json` (`qrcode` phiên bản cố định), `AUDIT_ACTIONS`; Test `test/totp.test.js`, `test/http-2fa.test.js`.

- [ ] **Step 1: Test fail** — `totpAt` khớp vector RFC 6238 (secret ASCII "12345678901234567890", T=59 → 287082 với 6 số; T=1111111109 → 081804); verifyTotp chấp nhận ±1 bước, từ chối ±2, từ chối bước ≤ lastStep (replay); secret lưu trong DB không phải bản rõ; luồng HTTP ở chế độ internet: manager đăng nhập đúng mật khẩu → 302 `/2fa/setup`, GET `/tasks` → 302 về `/2fa/setup`; bật bằng mã đúng → hiện 10 mã dự phòng một lần; đăng xuất, đăng nhập lại → `/2fa/verify`; mã sai 10 lần → bị chặn theo IP; mã đúng → vào được; dùng mã dự phòng → vào được, dùng lại mã đó → từ chối; admin đặt lại 2 lớp cho manager → lần sau phải bật lại; member ở chế độ internet không bị bắt buộc; chế độ nội bộ không bắt buộc ai; phiên chờ 2 lớp quá 5 phút → về `/login`.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt; trang bật 2 lớp hiện ảnh QR (data URL từ `qrcode`), khóa dạng chữ để nhập tay, hướng dẫn tiếng Việt (Google Authenticator / Microsoft Authenticator), ô nhập mã xác nhận. **Step 4:** PASS. Commit `feat: xác thực 2 lớp bằng mã trên điện thoại`.

### Task 3: Chạy trên Windows: tự khởi động, tự sao lưu

**Files:** Create `scripts/backup.js` (`backup({dbPath, dir, keep=30, now}) → path`), `scripts/windows/start.cmd`, `install.ps1`, `uninstall.ps1`, `backup.cmd`, `quanly.config.example.json`; Modify `package.json` (script `backup`), `.gitignore` (`backups/`, `quanly.config.json`, `data/secret.key`); Test `test/backup.test.js`.

- [ ] **Step 1: Test fail** — backup tạo tệp đúng tên theo thời gian, tệp mở được bằng node:sqlite và có bảng users; chạy 35 lần (thời gian giả khác nhau) → còn đúng 30 tệp mới nhất; thư mục chưa có → tạo; DB không tồn tại → lỗi tiếng Việt, thoát mã 1 khi chạy CLI.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. PowerShell: `install.ps1` kiểm tra Administrator, tìm `node.exe` (Get-Command), tạo 2 tác vụ `QuanLyCTV-Web` (AtStartup, RestartCount 999 / RestartInterval 1 phút, ExecutionTimeLimit 0) và `QuanLyCTV-SaoLuu` (Daily 02:30), mở cổng tường lửa 3000 chỉ khi config `listenLan` hoặc chế độ nội bộ, in hướng dẫn bước tiếp; `uninstall.ps1` gỡ cả hai. `start.cmd` chạy `node src\server.js` từ thư mục ứng dụng. Kiểm tra cú pháp bằng đọc kỹ (không có pwsh). **Step 4:** PASS. Commit `feat: tự chạy khi bật máy và tự sao lưu hằng ngày trên Windows`.

### Task 4: Hướng dẫn và kiểm tra toàn hệ thống

**Files:** Modify `README.md` (mục mới "Đưa lên Internet": cảnh báo quy định bảo mật + báo cáo chỉ huy; các bước: 1) đổi mật khẩu admin, xóa dữ liệu thử (xóa thư mục data rồi chạy lại, hoặc dùng tài khoản thật); 2) tạo `quanly.config.json` từ mẫu với `mode: internet`; 3) cài Tailscale cho Windows (tailscale.com/download), đăng nhập; 4) trong trang quản trị Tailscale bật HTTPS Certificates và Funnel cho máy (policy `funnel` attribute) — mô tả theo tài liệu chính thức; 5) chạy `tailscale funnel --bg 3000`, lấy địa chỉ `https://<máy>.<tailnet>.ts.net`, ghi vào `publicUrl`; 6) chạy `scripts\windows\install.ps1` bằng PowerShell Administrator; 7) đăng nhập, bật 2 lớp; 8) gửi địa chỉ cho cán bộ, chiến sĩ; tắt truy cập Internet: `tailscale funnel --https=443 off` hoặc `tailscale funnel reset`; khôi phục từ sao lưu; xử lý sự cố. Ghi rõ: kịch bản Windows và lệnh Tailscale chưa được nhà phát triển chạy thử trên Windows — gặp lỗi chụp màn hình gửi lại), `scripts/screenshots.js` (chụp trang bật 2 lớp, trang nhập mã, trang Bảo mật tài khoản; chạy toàn bộ với chế độ internet giả lập qua env và CSP bật; tự sinh mã TOTP trong script để đăng nhập; kiểm tra không lỗi console CSP).

- [ ] **Step 1:** `npm test` PASS; `npm run screenshots` TẤT CẢ ĐẠT. **Step 2:** Xem ảnh mới. **Step 3:** Commit `docs: hướng dẫn đưa website lên Internet`, push.
