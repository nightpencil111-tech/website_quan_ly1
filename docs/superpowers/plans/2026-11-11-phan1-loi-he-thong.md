# Phần 1 – Lõi hệ thống: Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Website nội bộ có đăng nhập, phân quyền 3 cấp, giao và theo dõi công việc, lịch, bảng tổng hợp, tính năng thông minh Nhóm A và xuất Excel.

**Architecture:** Express + EJS kết xuất phía máy chủ; `node:sqlite` làm CSDL một file. Logic nghiệp vụ nằm trong `src/services/*` (hàm thuần nhận `db`), route chỉ đọc request → gọi service → render. Kiểm thử bằng `node:test`.

**Tech Stack:** Node.js ≥ 22.13, express 4, ejs 3, exceljs 4, Chart.js 4 (đóng gói trong `public/vendor`), Playwright (chỉ để chụp màn hình kiểm tra).

**Spec:** `docs/superpowers/specs/2026-11-11-quanly-ctv-design.md`

## Global Constraints

- Không tải bất kỳ tài nguyên nào từ Internet khi chạy (không CDN, không font online).
- Toàn bộ chữ trên giao diện, thông báo lỗi bằng tiếng Việt có dấu; xưng hô "đồng chí".
- Phụ thuộc runtime chỉ: `express`, `ejs`, `exceljs`, `chart.js` (copy file `chart.umd.js` vào `public/vendor`).
- Mật khẩu băm bằng `crypto.scrypt` (N mặc định, salt 16 byte), so sánh bằng `timingSafeEqual`.
- Cookie phiên `sid`: `HttpOnly`, `SameSite=Strict`; hết hạn sau 8 giờ không hoạt động.
- Đăng nhập sai 5 lần liên tiếp → khóa 15 phút.
- Mọi POST phải có `_csrf` khớp phiên, sai → 403.
- Ngày lưu dạng chuỗi `YYYY-MM-DD` theo giờ Việt Nam (UTC+7); "hôm nay" lấy qua `today()` trong `src/util/date.js`.
- Mã vai trò: `admin`, `manager`, `member`. Mã trạng thái: `chua_lam`, `dang_lam`, `cho_duyet`, `hoan_thanh`. Mã ưu tiên: `thuong`, `gap`, `hoa_toc` (hệ số 1, 1.5, 2).
- Lĩnh vực (mã → nhãn): `cong_tac_dang` Công tác Đảng; `giao_duc_ct` Giáo dục chính trị; `thi_dua` Thi đua – Khen thưởng; `dan_van` Dân vận; `van_hoa` Văn hóa – Văn nghệ; `huan_luyen` Huấn luyện; `hau_can` Hậu cần – Kỹ thuật; `khac` Khác.
- Cổng mặc định 3000, lắng nghe `0.0.0.0`; biến môi trường `PORT`, `DB_PATH` (mặc định `data/data.db`).

## Review Focus

1. **Ngày theo giờ Việt Nam** — lúc 06:00 sáng giờ VN (23:00 UTC hôm trước), việc có hạn hôm qua phải là "quá hạn", việc hạn hôm nay thì chưa. Test ở Task 1 (`today()`) và Task 4.
2. **Tìm kiếm tiếng Việt** — gõ "đảng" phải tìm thấy "Công tác Đảng", gõ không dấu "dang" cũng tìm thấy. SQLite `LIKE` không xử lý được → lọc trong JS bằng hàm `fold()`. Test ở Task 4.
3. **Chiến sĩ gõ thẳng URL việc của người khác** (`/tasks/12`, POST `/tasks/12/status`) → 403, không lộ nội dung. Test ở Task 5.
4. **Tài khoản bị khóa nhưng còn việc** — việc vẫn hiện tên người đó kèm "(đã khóa)"; không xuất hiện trong gợi ý người thực hiện và danh sách chọn người. Test ở Task 6.
5. **Xuất Excel khi bộ lọc không có kết quả / nội dung có dấu** — vẫn trả file .xlsx hợp lệ có dòng tiêu đề, tên file có dấu được mã hóa đúng (`filename*=UTF-8''`). Test ở Task 9.

---

## Cấu trúc file

```
package.json
src/server.js              createApp({ dbPath }) → { app, db }; listen khi chạy trực tiếp
src/db.js                  openDb(path), migrate(db), seed(db)
src/util/date.js           today(), addDays(d, n), daysBetween(a, b), weekday(d)
src/util/text.js           fold(s)  (bỏ dấu + lowercase), labels (lĩnh vực, ưu tiên, trạng thái, vai trò)
src/auth.js                hashPassword, verifyPassword, login, logout, loadSession, requireLogin, requireRole, csrf
src/services/audit.js      log(db, userId, action, target, detail), list(db, {limit, offset})
src/services/users.js      list/create/update/setActive/resetPassword/changePassword, units CRUD
src/services/tasks.js      createTask, updateTask, deleteTask, getTask, listTasks, changeStatus, checklist & comments, canView
src/services/smart.js      suggestAssignees, overloadWarnings, priorityScore, todayList, performance
src/services/recurring.js  rules CRUD, generateDue(db, today)
src/services/templates.js  templates CRUD, instantiate(db, templateId, data, actorId)
src/services/events.js     events CRUD, monthView(db, year, month)
src/services/reports.js    dashboardStats(db), periodReport(db, from, to)
src/services/excel.js      tasksWorkbook(rows), performanceWorkbook(rows), reportWorkbook(report)
src/routes/*.js            auth, dashboard, tasks, calendar, people, templates, reports, admin
views/layout.ejs + views/<trang>.ejs, views/partials/*
public/css/app.css, public/js/kanban.js, public/js/task-form.js, public/vendor/chart.umd.js
test/*.test.js, test/helpers.js (tạo db tạm, server tạm, đăng nhập lấy cookie + csrf)
README.md                  hướng dẫn cài & chạy trên Windows bằng tiếng Việt
```

---

### Task 1: Khung dự án, CSDL, tiện ích ngày/chữ

**Files:** Create `package.json`, `src/db.js`, `src/util/date.js`, `src/util/text.js`, `test/helpers.js`, `test/db.test.js`, `test/util.test.js`, `.gitignore` (`node_modules`, `data/`, `screenshots/`)

**Interfaces:**
- Produces: `openDb(path: string): DatabaseSync` (đã bật `foreign_keys`, đã `migrate`); `seed(db)` tạo đơn vị "Đại đội 1" và tài khoản `admin` / mật khẩu `admin123` với `must_change_password=1` nếu bảng users rỗng; `today(now?: Date): string`; `addDays(d: string, n: number): string`; `daysBetween(a: string, b: string): number` (b − a); `weekday(d: string): number` (1=Thứ Hai … 7=Chủ nhật); `fold(s: string): string`; `LABELS = { category, priority, status, role }`; `PRIORITY_WEIGHT = { thuong: 1, gap: 1.5, hoa_toc: 2 }`.
- `test/helpers.js`: `makeDb(): DatabaseSync` (file tạm trong thư mục tạm của OS).

- [ ] **Step 1:** `npm init -y`, đặt `"type": "commonjs"`, `"engines": {"node": ">=22.13"}`, scripts `start: node src/server.js`, `test: node --test test/`. Cài `express@4 ejs@3 exceljs@4 chart.js@4`.
- [ ] **Step 2: Test fail** — `test/util.test.js`: `today(new Date('2026-11-10T23:30:00Z')) === '2026-11-11'`; `addDays('2026-12-31', 1) === '2027-01-01'`; `daysBetween('2026-11-11','2026-11-14') === 3`; `weekday('2026-11-16') === 1`; `fold('Công tác ĐẢNG') === 'cong tac dang'`. `test/db.test.js`: sau `openDb` có đủ bảng trong spec mục 4 + `sessions`, `schema_version`; gọi `migrate` hai lần không lỗi; `seed` hai lần chỉ có 1 admin.
- [ ] **Step 3:** Chạy `npm test` → FAIL (module chưa có).
- [ ] **Step 4:** Viết `date.js`, `text.js` (`fold`: `normalize('NFD')`, bỏ `\p{M}`, thay `đ/Đ`→`d`, lowercase), `db.js` với schema đúng spec mục 4 (thêm `sessions(id TEXT PK, user_id, csrf, expires_at)`), CHECK constraint cho các mã ở Global Constraints, index `tasks(status, due_date)`, `task_assignees(user_id)`.
- [ ] **Step 5:** `npm test` → PASS. Commit `feat: khung dự án và CSDL`.

### Task 2: Xác thực, phiên, CSRF, khung giao diện

**Files:** Create `src/auth.js`, `src/server.js`, `src/routes/auth.js`, `views/layout.ejs`, `views/login.ejs`, `views/change-password.ejs`, `views/error.ejs`, `public/css/app.css`, `test/auth.test.js`, `test/http-auth.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces: `hashPassword(pw): string` (dạng `scrypt$<saltHex>$<hashHex>`); `verifyPassword(pw, stored): boolean`; `login(db, username, pw): {ok:true, sessionId} | {ok:false, error}`; middleware `loadSession(db)` gắn `req.user` (null nếu không có) và `res.locals.user`, `res.locals.csrf`, gia hạn phiên; `requireLogin`, `requireRole(...roles)`; `csrfCheck` (cho mọi POST); `createApp({ dbPath }): { app, db }`; helper render lỗi `res.status(403).render('error', {...})` với câu "Đồng chí không có quyền thực hiện chức năng này".
- `test/helpers.js` thêm: `startServer(): {base, db, close}`, `loginAs(base, username, pw): {cookie, csrf}` (đọc csrf từ thẻ `<meta name="csrf">` của trang chủ).

- [ ] **Step 1: Test fail** — `auth.test.js`: hash rồi verify đúng/sai; sai 5 lần → lần thứ 6 dù đúng mật khẩu vẫn `{ok:false}` với lỗi chứa "khóa"; sau khi đặt `locked_until` về quá khứ thì đăng nhập được và `failed_logins` về 0; tài khoản `active=0` không đăng nhập được. `http-auth.test.js`: GET `/` chưa đăng nhập → 302 tới `/login`; đăng nhập admin lần đầu → 302 tới `/change-password` và mọi trang khác cũng chuyển về đó; POST thiếu `_csrf` → 403; phiên có `expires_at` quá khứ → coi như chưa đăng nhập; `/logout` xóa phiên.
- [ ] **Step 2:** Chạy → FAIL.
- [ ] **Step 3:** Cài đặt. Layout: thanh bên trái theo vai trò (spec mục 7), header có tên + cấp bậc + nút Đăng xuất, nút thu gọn menu trên màn hình hẹp (≤ 768px); màu chủ đạo `#3b5323` (xanh quân đội), nền `#f4f5f0`. Đổi mật khẩu: tối thiểu 8 ký tự, xác nhận khớp, khác mật khẩu cũ. Ghi audit `login`, `login_fail`, `logout`, `change_password` (audit service tối thiểu tạo ở task này: `log(db, userId, action, target, detail)`).
- [ ] **Step 4:** `npm test` → PASS. Chạy `npm start`, mở `/login` kiểm tra trực quan. Commit `feat: đăng nhập, phiên, CSRF, khung giao diện`.

### Task 3: Quản trị tài khoản, đơn vị, nhật ký, sao lưu

**Files:** Create `src/services/users.js`, `src/services/audit.js` (hoàn thiện `list`), `src/routes/admin.js`, `src/routes/people.js`, `views/admin/users.ejs`, `views/admin/user-form.ejs`, `views/admin/units.ejs`, `views/admin/audit.ejs`, `views/admin/settings.ejs`, `views/people.ejs`, `test/users.test.js`, `test/http-admin.test.js`

**Interfaces:**
- Produces: `listUsers(db, {includeInactive=false}): User[]` (kèm `unit_name`, `open_tasks` — số việc chưa hoàn thành); `createUser(db, data, actorId): {id, tempPassword}` (mật khẩu tạm 8 ký tự ngẫu nhiên, `must_change_password=1`); `updateUser(db, id, data, actorId)`; `setActive(db, id, active, actorId)`; `resetPassword(db, id, actorId): tempPassword`; `listUnits/createUnit/updateUnit/deleteUnit`; `getSetting(db, key, default)`, `setSetting(db, key, value)` (khóa `overload_threshold` mặc định `5`).
- Lỗi nghiệp vụ ném `new AppError(message)` (định nghĩa trong `src/util/errors.js`), route bắt và hiển thị trên form.

- [ ] **Step 1: Test fail** — trùng `username` → AppError "Tên đăng nhập đã tồn tại"; admin tự khóa mình → AppError; khóa admin cuối cùng đang hoạt động → AppError "Phải còn ít nhất một chỉ huy (Admin) hoạt động"; xóa đơn vị đang có người → AppError; `resetPassword` đặt lại `must_change_password=1`. HTTP: `manager` và `member` GET `/admin/users` → 403; `manager` GET `/people` → 200; `member` GET `/people` → 403; admin GET `/admin/backup` → tải về `Content-Type: application/octet-stream` (dùng `db.exec("VACUUM INTO ...")` ra file tạm rồi gửi).
- [ ] **Step 2:** Chạy → FAIL. **Step 3:** Cài đặt; sau khi tạo tài khoản hiển thị mật khẩu tạm một lần kèm lời nhắc chuyển cho người dùng. Trang Quân số (`/people`): bảng họ tên, cấp bậc, chức vụ, đơn vị, Đảng/Đoàn, số việc đang làm, lọc theo đơn vị. Nhật ký phân trang 50 dòng.
- [ ] **Step 4:** `npm test` → PASS. Commit `feat: quản trị tài khoản, đơn vị, nhật ký, sao lưu`.

### Task 4: Dịch vụ công việc

**Files:** Create `src/services/tasks.js`, `test/tasks.test.js`

**Interfaces:**
- Produces:
  - `createTask(db, {title, description, category, priority, due_date, assignee_ids: number[], checklist?: string[], template_id?, recurring_id?}, actorId): number`
  - `updateTask(db, id, fields, actor)`; `deleteTask(db, id, actor)` (chỉ admin/manager)
  - `getTask(db, id): TaskDetail | null` — gồm `assignees[{id, full_name, rank, active}]`, `checklist[]`, `comments[]`, `progress` (0–100), `overdue: boolean`
  - `listTasks(db, {status?, category?, priority?, assignee_id?, q?, overdue?, from?, to?}, today): TaskRow[]` sắp theo `due_date` tăng dần
  - `canView(task, user): boolean` (admin/manager luôn true; member khi là người được giao)
  - `changeStatus(db, id, newStatus, actor, note?)` — luật chuyển theo spec mục 5; vi phạm → AppError; trả lại `cho_duyet→dang_lam` bắt buộc `note`; vào `hoan_thanh` đặt `completed_at = today()`; ghi audit và comment tự động "Chuyển trạng thái: X → Y" (+ ghi chú).
  - `addChecklistItem`, `toggleChecklistItem(db, itemId, actor)` (member chỉ với việc mình được giao), `addComment(db, taskId, actor, content)`
- `overdue` = `status != 'hoan_thanh' && due_date < today`.

- [ ] **Step 1: Test fail** —
  - member đổi `chua_lam→dang_lam` việc mình: OK; việc người khác: AppError; member `dang_lam→hoan_thanh`: AppError; member `dang_lam→cho_duyet`: OK.
  - manager trả lại không có ghi chú: AppError; có ghi chú: OK và có comment chứa ghi chú.
  - progress: 3 mục checklist, xong 1 → 33; trạng thái `hoan_thanh` → 100; không có checklist & chưa xong → 0.
  - overdue với today='2026-11-11': hạn '2026-11-10' chưa xong → true; hạn '2026-11-11' → false; hạn '2026-11-10' đã hoàn thành → false.
  - `listTasks({q:'dang'})` và `{q:'Đảng'}` đều tìm thấy việc tiêu đề "Chuẩn bị sinh hoạt Công tác Đảng".
  - `createTask` không có người thực hiện → AppError "Phải chọn ít nhất một người thực hiện"; thiếu tiêu đề hoặc hạn → AppError.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt (lọc `q` trong JS bằng `fold` trên tiêu đề + mô tả). **Step 4:** PASS. Commit `feat: dịch vụ công việc`.

### Task 5: Trang công việc – danh sách, chi tiết, Kanban, Việc của tôi

**Files:** Create `src/routes/tasks.js`, `views/tasks/list.ejs`, `views/tasks/detail.ejs`, `views/tasks/form.ejs`, `views/tasks/kanban.ejs`, `views/tasks/mine.ejs`, `views/partials/task-badges.ejs`, `public/js/kanban.js`, `test/http-tasks.test.js`

**Interfaces:**
- Consumes: Task 4.
- Routes: `GET /tasks` (bộ lọc qua query), `GET /tasks/new`, `POST /tasks`, `GET /tasks/:id`, `GET /tasks/:id/edit`, `POST /tasks/:id`, `POST /tasks/:id/delete`, `POST /tasks/:id/status` (body `status`, `note`; trả JSON nếu `Accept: application/json` — dùng cho Kanban), `POST /tasks/:id/checklist`, `POST /tasks/:id/checklist/:itemId/toggle`, `POST /tasks/:id/comments`, `GET /kanban`, `GET /my`.
- member: `/tasks` và `/kanban` chỉ hiển thị việc của mình; `/tasks/new` → 403.

- [ ] **Step 1: Test fail** — member A GET `/tasks/<id việc của B>` → 403 và thân trang không chứa tiêu đề việc; POST `/tasks/<id>/status` việc của B → 403; member GET `/tasks/new` → 403; manager tạo việc qua POST → 302 tới `/tasks/<id>`; Kanban POST status JSON trả `{ok:true}` hoặc `{ok:false,error}` với 400.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. Kanban: 4 cột theo trạng thái, kéo thả HTML5 gọi POST JSON (gửi header `X-CSRF-Token`; `csrfCheck` chấp nhận header này), lỗi thì trả thẻ về chỗ cũ và hiện thông báo. Huy hiệu: màu ưu tiên (Hỏa tốc đỏ, Gấp cam), nhãn "Quá hạn" đỏ, thanh tiến độ. Người bị khóa hiển thị "(đã khóa)".
- [ ] **Step 4:** PASS + kiểm tra trực quan. Commit `feat: trang công việc và Kanban`.

### Task 6: Thông minh Nhóm A – gợi ý, quá tải, ưu tiên, hiệu suất

**Files:** Create `src/services/smart.js`, `public/js/task-form.js`, `test/smart.test.js`; Modify `src/routes/tasks.js` (thêm `GET /api/suggest?category=&due_date=`), `views/tasks/form.ejs`, `views/tasks/mine.ejs`

**Interfaces:**
- Consumes: Task 4, `PRIORITY_WEIGHT`, `getSetting`.
- Produces:
  - `suggestAssignees(db, {category, due_date}, today, limit=5): [{user_id, full_name, rank, score, reasons: string[], overloaded: boolean}]` — công thức đúng spec mục 6.1; chỉ người `active=1` và vai trò `member`/`manager`; nếu tải tối đa của nhóm = 0 thì thành phần tải = 1 cho mọi người; kinh nghiệm max = 0 → 0.
  - `overloadWarnings(db, today): [{user_id, full_name, open_count, same_day: {date, count}[]}]` — vượt `overload_threshold` hoặc ≥ 3 việc mở cùng hạn.
  - `priorityScore(task, today): number` — `PRIORITY_WEIGHT[p] / max(daysLeft, 0.5)`; quá hạn: cộng 1000 để luôn đứng đầu.
  - `todayList(db, userId, today): TaskRow[]` — việc chưa hoàn thành của người đó sắp giảm dần theo `priorityScore`.
  - `performance(db, {from, to}): [{user_id, full_name, assigned, completed, on_time, overdue, rate}]` — tính trên việc có `due_date` trong khoảng; `rate` = on_time/assigned (0 nếu assigned=0).
- [ ] **Step 1: Test fail** — dựng dữ liệu: A rảnh, chưa có lịch sử; B 4 việc mở; C đã hoàn thành 3 việc `cong_tac_dang` đúng hạn, 1 việc mở. `suggestAssignees({category:'cong_tac_dang'})` → C đứng đầu, B đứng cuối; lý do của C chứa "Công tác Đảng"; người bị khóa không xuất hiện. Ngưỡng 5, D có 6 việc mở → có trong `overloadWarnings`; E có 3 việc cùng hạn → có `same_day`. `priorityScore`: hỏa tốc còn 1 ngày (2) > thường còn 1 ngày (1); quá hạn > mọi việc chưa quá hạn. `performance` tính đúng `rate` trên dữ liệu dựng sẵn.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. Form giao việc: khi chọn lĩnh vực/hạn thì gọi `/api/suggest`, hiện thẻ gợi ý (bấm để thêm vào người thực hiện), cảnh báo vàng nếu người được chọn đang quá tải. Trang `/my` hiển thị "Việc cần làm hôm nay" theo `todayList`.
- [ ] **Step 4:** PASS. Commit `feat: gợi ý người thực hiện, cảnh báo quá tải, ưu tiên`.

### Task 7: Mẫu công việc và việc định kỳ

**Files:** Create `src/services/templates.js`, `src/services/recurring.js`, `src/routes/templates.js`, `views/templates/index.ejs`, `views/templates/form.ejs`, `views/templates/recurring-form.ejs`, `test/templates.test.js`, `test/recurring.test.js`; Modify `src/db.js` (seed 2 mẫu), `src/server.js` (gọi `generateDue` khi khởi động và `setInterval` mỗi giờ)

**Interfaces:**
- Produces: `listTemplates/createTemplate/updateTemplate/deleteTemplate`; `instantiate(db, templateId, {due_date, assignee_ids, priority?}, actorId): taskId` (checklist = các đầu việc của mẫu, `template_id` gán); `listRules/createRule/updateRule/deleteRule`; `nextOccurrence(rule, fromDate): string` ; `generateDue(db, today): number` (số việc đã sinh).
- Mẫu seed: "Tổ chức kỷ niệm ngày thành lập QĐND 22/12" (8 đầu việc: xây dựng kế hoạch; phân công lực lượng; chuẩn bị hội trường, khánh tiết; nội dung tọa đàm/nói chuyện truyền thống; văn nghệ; thể thao; tin bài truyền thanh; tổng hợp báo cáo) và "Sinh hoạt chi bộ thường kỳ" (4 đầu việc: dự thảo nghị quyết; báo cáo kết quả tháng; chuẩn bị điều hành; hoàn thiện biên bản).

- [ ] **Step 1: Test fail** — `instantiate` tạo việc có đúng số mục checklist; quy tắc hằng tuần Thứ Hai, `lead_days=2`: `generateDue(db,'2026-11-14')` (Thứ Bảy) sinh 1 việc hạn '2026-11-16'; gọi lại cùng ngày → 0; `generateDue(db,'2026-11-13')` → 0. Hằng tháng ngày 31: tháng 11 → hạn '2026-11-30' (ngày cuối tháng). Quy tắc `active=0` không sinh.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt; trang `/templates` (chỉ manager/admin) có hai tab Mẫu / Việc định kỳ, nút "Giao theo mẫu" mở form với checklist đã điền sẵn.
- [ ] **Step 4:** PASS. Commit `feat: mẫu công việc và việc định kỳ`.

### Task 8: Lịch công tác

**Files:** Create `src/services/events.js`, `src/routes/calendar.js`, `views/calendar.ejs`, `test/events.test.js`

**Interfaces:**
- Produces: `createEvent/updateEvent/deleteEvent`; `monthView(db, year, month, user): { weeks: Day[][] }`, `Day = { date, inMonth, isToday, events[], tasks[] }` — tuần bắt đầu Thứ Hai; member chỉ thấy hạn chót việc của mình, sự kiện thì ai cũng thấy.
- Route `GET /calendar?y=&m=`, `POST /calendar/events`, `POST /calendar/events/:id/delete` (thêm/xóa: manager/admin).
- [ ] **Step 1: Test fail** — `monthView(2026, 11)` có 6 hàng tuần, ô đầu là "2026-10-26" (1/11/2026 là Chủ nhật), ô cuối là "2026-12-06"; sự kiện kéo dài 2 ngày xuất hiện ở cả 2 ngày; member không thấy việc của người khác.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt, nút tháng trước/sau, ô hôm nay nổi bật, bấm ngày mở form thêm sự kiện (loại: Sinh hoạt chi bộ, Học chính trị, Ngày lễ – kỷ niệm, Hội nghị, Khác).
- [ ] **Step 4:** PASS. Commit `feat: lịch công tác`.

### Task 9: Bảng tổng hợp, báo cáo, hiệu suất, xuất Excel

**Files:** Create `src/services/reports.js`, `src/services/excel.js`, `src/routes/dashboard.js`, `src/routes/reports.js`, `views/dashboard.ejs`, `views/reports/index.ejs`, `views/reports/performance.ejs`, `test/reports.test.js`, `test/excel.test.js`

**Interfaces:**
- Consumes: Task 4, 6.
- Produces: `dashboardStats(db, user, today): {counts:{total, chua_lam, dang_lam, cho_duyet, hoan_thanh, overdue, done_this_week}, byCategory, byPerson, upcoming (7 ngày tới), overload}` (member: chỉ số liệu của mình, không có byPerson/overload); `periodReport(db, from, to, today): {from, to, sections: {chung, ketQua: [{category, label, done, total, items}], tonTai: TaskRow[], phuongHuong: TaskRow[]}, text: string}`; `tasksWorkbook(rows): Promise<Buffer>`, `performanceWorkbook(rows)`, `reportWorkbook(report)`.
- Routes: `GET /` (dashboard), `GET /reports?from=&to=` (mặc định tuần hiện tại Thứ Hai–Chủ nhật; có nút "Tháng này"), `GET /reports/performance`, `GET /export/tasks?<bộ lọc như /tasks>`, `GET /export/performance`, `GET /export/report`. Báo cáo & hiệu suất: manager/admin; `/export/tasks` cho mọi vai trò nhưng member chỉ có việc của mình.
- `text` của báo cáo theo bố cục spec mục 6.7, mở đầu "BÁO CÁO KẾT QUẢ THỰC HIỆN NHIỆM VỤ (Từ ngày dd/mm/yyyy đến ngày dd/mm/yyyy)"; ngày hiển thị dạng `dd/mm/yyyy`.
- [ ] **Step 1: Test fail** — `periodReport` trên dữ liệu dựng sẵn: số đã hoàn thành theo lĩnh vực đúng; việc quá hạn nằm trong `tonTai`; việc hạn trong 7 ngày sau `to` nằm trong `phuongHuong`; `text` chứa "I. TÌNH HÌNH CHUNG" … "IV. PHƯƠNG HƯỚNG". Excel: `tasksWorkbook([])` đọc lại bằng exceljs có 1 dòng tiêu đề "STT, Tên công việc, Lĩnh vực, Người thực hiện, Hạn, Ưu tiên, Trạng thái, Tiến độ"; với dòng có dấu, đọc lại giữ nguyên. HTTP: `/export/tasks` trả header `Content-Disposition` chứa `filename*=UTF-8''`; member `/reports` → 403.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. Dashboard: 6 thẻ số liệu, biểu đồ cột theo lĩnh vực và theo người (Chart.js từ `/vendor/chart.umd.js`), danh sách sắp đến hạn, hộp cảnh báo quá tải. Trang báo cáo có ô văn bản đã soạn + nút "Sao chép" + "Xuất Excel".
- [ ] **Step 4:** PASS. Commit `feat: bảng tổng hợp, báo cáo, xuất Excel`.

### Task 10: Dữ liệu thử, kiểm tra toàn hệ thống, hướng dẫn sử dụng

**Files:** Create `scripts/demo-data.js` (`npm run demo`: tạo 3 trung đội, 1 manager `ctv` và 10 member với cấp bậc/chức vụ hư cấu, ~30 việc đa trạng thái, vài sự kiện; mật khẩu chung `Demo@1234`, không ép đổi), `scripts/screenshots.js`, `README.md`

- [ ] **Step 1:** `npm test` → toàn bộ PASS.
- [ ] **Step 2:** `npm run demo` trên DB tạm, `npm start`, chạy `node scripts/screenshots.js` (Playwright, đăng nhập lần lượt admin/ctv/member, chụp: đăng nhập, tổng quan, việc của tôi, danh sách, Kanban, form giao việc có gợi ý, lịch, báo cáo, hiệu suất, quản trị tài khoản; thêm 1 ảnh khung điện thoại 390px) vào `screenshots/`. Xem ảnh, sửa lỗi hiển thị nếu có.
- [ ] **Step 3:** README tiếng Việt: yêu cầu (Node.js 22 LTS bản ≥ 22.13), cài đặt trên Windows từng bước (tải Node, giải nén, `npm install`, `npm start`), cách xem IP máy (`ipconfig`) để máy khác truy cập, mở cổng 3000 trên Windows Firewall, tài khoản mặc định và yêu cầu đổi mật khẩu, sao lưu/khôi phục (chép `data/data.db`), lưu ý bảo mật (chỉ dùng mạng nội bộ, không nhập thông tin mật).
- [ ] **Step 4:** Commit `docs: hướng dẫn cài đặt, dữ liệu thử`.
