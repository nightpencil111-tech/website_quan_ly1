# Phần 2 – Hồ sơ quân nhân: Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm quản lý hồ sơ toàn bộ quân nhân (kể cả người không có tài khoản), mục con, nhắc mốc, xem hồ sơ của mình, nhập/xuất Excel vào hệ thống Phần 1.

**Architecture:** Giữ kiến trúc Phần 1: service thuần nhận `db` trong `src/services/`, router dạng `(db) => Router` gắn trong `src/server.js`, view EJS bọc layout. Thêm một migration mới vào mảng `MIGRATIONS` của `src/db.js`. Ẩn dữ liệu nhạy cảm ngay trong service (`redactForMember`).

**Tech Stack:** Node.js ≥ 22.13, express 4, ejs 3, node:sqlite, exceljs 4 (đã có). Không thêm phụ thuộc runtime. Tải file Excel lên: trình duyệt đọc file bằng `FileReader`, gửi base64 trong JSON (giới hạn 3mb riêng cho route nhập) — tránh cần thư viện multipart.

**Spec:** `docs/superpowers/specs/2026-11-12-phan2-ho-so-quan-nhan-design.md` (kế thừa `docs/superpowers/specs/2026-11-11-quanly-ctv-design.md`)

## Global Constraints

- Không thêm phụ thuộc runtime; không tài nguyên Internet.
- Giao diện, thông báo tiếng Việt có dấu, xưng "đồng chí".
- Mọi router: `requireLogin` trước `requireRole`. Mọi POST có `_csrf` hoặc header `X-CSRF-Token`.
- Ngày lưu `YYYY-MM-DD`; "hôm nay" = `today()` (giờ VN); hiển thị `fmtDate` / `fmtDateTime`.
- Mã trạng thái hồ sơ: `dang_cong_tac`, `da_ra_quan`, `chuyen_don_vi`. Giới tính `nam`, `nu`. Khen thưởng/kỷ luật `khen_thuong`, `ky_luat`. Phép `phep`, `tranh_thu`. Mức tư tưởng `binh_thuong`, `can_quan_tam`, `dac_biet`.
- Loại mốc: `chuyen_dang` "Chuyển Đảng chính thức", `het_han_phuc_vu` "Hết hạn phục vụ tại ngũ", `nien_han_quan_ham` "Đến niên hạn xét thăng quân hàm".
- Danh mục cấp bậc (thứ tự): Binh nhì, Binh nhất, Hạ sĩ, Trung sĩ, Thượng sĩ, Thiếu úy, Trung úy, Thượng úy, Đại úy, Thiếu tá, Trung tá, Thượng tá, Đại tá, Quân nhân chuyên nghiệp, Công nhân viên quốc phòng (2 mục cuối không có niên hạn).
- Khóa settings: `party_probation_months`, `service_months`, `rank_intervals` (JSON object cấp bậc → số tháng), `reminder_days` (mặc định 30). Ba khóa đầu **không có giá trị mặc định**.
- Dữ liệu nhạy cảm: toàn bộ `soldier_thoughts` và trường `soldier_family.hardship_note` — member không bao giờ nhận được, kể cả qua JSON/Excel.
- Nhật ký: `soldier_view`, `soldier_create`, `soldier_update`, `soldier_delete`, `soldier_<family|career|award|leave|thought>_<create|update|delete>`, `soldier_link`, `soldier_import`, `soldier_export`, `milestone_settings` — thêm nhãn tiếng Việt vào bản đồ nhãn nhật ký hiện có trong `src/routes/admin.js`.
- Mã nguồn hiện có là nền: đọc `src/db.js`, `src/auth.js`, `src/routes/tasks.js`, `src/routes/admin.js`, `src/util/*` để theo đúng mẫu.

## Review Focus

1. **Member lấy dữ liệu nhạy cảm qua đường vòng** — `/soldiers/:id` của chính mình, `/my-profile`, xuất Excel, trang mốc: member chỉ thấy hồ sơ của mình qua `/my-profile`, không thấy tư tưởng và hardship_note; mọi `/soldiers*` khác → 403. Test ở Task 2 và Task 4.
2. **Cộng tháng vào ngày cuối tháng / năm nhuận** — 31/01/2028 + 1 tháng = 29/02/2028; 31/08 + 6 tháng = 28/02 hoặc 29/02. Test ở Task 3.
3. **Mốc chưa cấu hình** — không ném lỗi, không tính, trả về trong `missingConfig`. Test ở Task 3.
4. **Excel nhập có ngày dạng ô ngày Excel (Date object) lẫn chuỗi dd/mm/yyyy, ô trống, dòng trống ở cuối** — đọc đúng, bỏ dòng trống, báo lỗi rõ cho ngày sai. Test ở Task 6.
5. **Xóa hồ sơ đã liên kết tài khoản / xóa tài khoản đã liên kết hồ sơ** — hồ sơ xóa thì bảng con xóa theo; tài khoản xóa/khóa thì hồ sơ vẫn còn (user_id SET NULL). Test ở Task 1.

---

## Cấu trúc file

```
src/db.js                       + migration v(n+1): soldiers, soldier_family, soldier_career, soldier_awards, soldier_leaves, soldier_thoughts, import_drafts
src/util/ranks.js               RANKS, RANKS_WITHOUT_INTERVAL, SOLDIER_LABELS (status, gender, award kind, leave kind, thought level, milestone kind)
src/util/date.js                + addMonths(d, n)
src/services/soldiers.js        CRUD hồ sơ, listSoldiers(filters), getSoldier, linkUser, redactForMember
src/services/soldierItems.js    CRUD 5 loại mục con (một bộ hàm chung theo cấu hình loại)
src/services/milestones.js      getMilestoneSettings, saveMilestoneSettings, upcomingMilestones, soldierStats
src/services/soldierExcel.js    exportWorkbook(rows), templateWorkbook(), parseImport(buffer, db) → {valid, errors}, commitImport
src/routes/soldiers.js          /soldiers, /soldiers/:id (+ mục con), /soldiers/milestones, /my-profile, /soldiers/export, /soldiers/import*
views/soldiers/{list,detail,form,item-form,milestones,import,import-preview,my-profile}.ejs
views/soldiers/_tabs.ejs, views/soldiers/_item-tables.ejs
public/js/soldier-import.js     đọc file → base64 → POST JSON
test/soldiers.test.js, test/soldier-items.test.js, test/milestones.test.js, test/http-soldiers.test.js, test/soldier-excel.test.js
```

---

### Task 1: CSDL và dịch vụ hồ sơ chính

**Files:** Modify `src/db.js` (thêm migration); Create `src/util/ranks.js`, `src/services/soldiers.js`, `test/soldiers.test.js`; Modify `src/util/date.js` (`addMonths`), `test/util.test.js`.

**Interfaces:**
- Produces: `addMonths(d: string, n: number): string` (kẹp ngày cuối tháng); `RANKS: string[]`, `RANKS_WITHOUT_INTERVAL: string[]`, `SOLDIER_LABELS = { status, gender, awardKind, leaveKind, thoughtLevel, milestoneKind }`.
- `createSoldier(db, data, actorId): number`; `updateSoldier(db, id, data, actorId)`; `deleteSoldier(db, id, actorId)`; `getSoldier(db, id): Soldier|null` (kèm `unit_name`, `username` nếu liên kết); `listSoldiers(db, {unit_id?, rank?, party?: 'dang_vien'|'du_bi'|'doan_vien'|'khong', status?, q?}): Soldier[]` sắp theo đơn vị rồi họ tên; `findByUser(db, userId): Soldier|null`; `linkUser(db, soldierId, userId|null, actorId)`; `listUnlinked(db): Soldier[]`.
- Trạng thái Đảng/Đoàn suy ra: `dang_vien` (có party_official_date), `du_bi` (có party_join_date, chưa chính thức), `doan_vien` (có youth_join_date, không có party_join_date), `khong`. Trả về trong trường `party_state`.
- Validation (AppError tiếng Việt): full_name bắt buộc; mọi ngày hợp lệ `YYYY-MM-DD` hoặc rỗng; rank thuộc `RANKS` hoặc rỗng; status/gender đúng mã; unit_id tồn tại hoặc rỗng; party_official_date ≥ party_join_date; linkUser: user tồn tại, chưa liên kết hồ sơ khác ("Tài khoản này đã liên kết với hồ sơ khác").

- [ ] **Step 1: Test fail** — `addMonths('2028-01-31',1)==='2028-02-29'`, `addMonths('2026-08-31',6)==='2027-02-28'`, `addMonths('2026-12-15',1)==='2027-01-15'`; tạo hồ sơ không họ tên → AppError; `listSoldiers({q:'nguyen van'})` tìm thấy "Nguyễn Văn An"; `party_state` đúng 4 trường hợp; xóa hồ sơ → bảng con cùng `soldier_id` rỗng; xóa user đã liên kết → hồ sơ còn, `user_id` NULL; linkUser trùng → AppError; migrate chạy 2 lần không lỗi.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Cài đặt (schema đúng spec §2, CHECK cho các mã, index `soldiers(unit_id)`, `soldier_leaves(soldier_id, from_date)`, `soldier_thoughts(soldier_id, date)`; `import_drafts(id TEXT PK, user_id, payload TEXT, expires_at INTEGER)`). Audit `soldier_create/update/delete/link`.
- [ ] **Step 4:** PASS toàn bộ. Commit `feat: CSDL và dịch vụ hồ sơ quân nhân`.

### Task 2: Mục con và lọc dữ liệu nhạy cảm

**Files:** Create `src/services/soldierItems.js`, `test/soldier-items.test.js`; Modify `src/services/soldiers.js` (thêm `getProfile`, `redactForMember`).

**Interfaces:**
- `ITEM_TYPES = { family, career, award, leave, thought }` — mỗi loại khai báo bảng, các trường, trường bắt buộc, kiểm tra riêng.
- `listItems(db, type, soldierId)`, `addItem(db, type, soldierId, data, actorId): number`, `updateItem(db, type, itemId, data, actorId)`, `deleteItem(db, type, itemId, actorId)`, `getItem(db, type, itemId)` (có `soldier_id` để route kiểm tra thuộc hồ sơ).
- Kiểm tra: career/leave `to_date ≥ from_date`; award kind, leave kind, thought level đúng mã; family `relation` và `full_name` bắt buộc; thought `content` bắt buộc, `recorded_by = actorId`.
- `getProfile(db, id): {soldier, family, career, awards, leaves, thoughts, leaveDaysThisYear}` — `leaveDaysThisYear` = tổng số ngày (tính cả hai đầu) các bản ghi `phep` giao với năm hiện tại, chỉ phần nằm trong năm.
- `redactForMember(profile): profile` — trả bản sao **không có** khóa `thoughts` và bỏ `hardship_note` khỏi từng dòng family.
- Audit `soldier_<type>_<create|update|delete>`.

- [ ] **Step 1: Test fail** — thêm/sửa/xóa từng loại; leave to<from → AppError; `leaveDaysThisYear` với phép 28/12/2026–03/01/2027 khi năm hiện tại 2026 = 4; `redactForMember` không còn `thoughts`, family không còn `hardship_note`, và `JSON.stringify(redacted)` không chứa nội dung tư tưởng/hoàn cảnh đã nhập.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS. Commit `feat: mục con hồ sơ và lọc dữ liệu nhạy cảm`.

### Task 3: Nhắc mốc và thống kê

**Files:** Create `src/services/milestones.js`, `test/milestones.test.js`.

**Interfaces:**
- `getMilestoneSettings(db): {party_probation_months: number|null, service_months: number|null, rank_intervals: Record<string,number>, reminder_days: number}`; `saveMilestoneSettings(db, data, actorId)` (số nguyên 1–600 hoặc rỗng → xóa khóa; reminder_days 1–365; rank chỉ nhận cấp bậc có niên hạn; audit `milestone_settings`).
- `upcomingMilestones(db, today, {soldierId?} = {}): {items: [{soldier_id, full_name, unit_name, kind, due_date, days_left}], missingConfig: string[]}` — quy tắc đúng spec §3; chỉ `status='dang_cong_tac'`; lấy khi `-30 ≤ days_left ≤ reminder_days`; sắp theo due_date. `missingConfig` gồm mã loại mốc chưa cấu hình (với niên hạn: khi có ít nhất một quân nhân mang cấp bậc chưa cấu hình niên hạn).
- `soldierStats(db, today): {total, onLeaveToday: number, needAttention: [{soldier_id, full_name, level, date}]}` — needAttention theo bản ghi tư tưởng mới nhất (date lớn nhất, hòa thì id lớn nhất) có mức `can_quan_tam`/`dac_biet`.

- [ ] **Step 1: Test fail** — chưa cấu hình gì → `items=[]`, `missingConfig` có `chuyen_dang`, `het_han_phuc_vu`; cấu hình dự bị 12 tháng, kết nạp 2025-11-20, today 2026-11-11 → 1 mục `chuyen_dang` days_left 9; đã có party_official_date → không nhắc; `da_ra_quan` → không nhắc; discharge_date nhập tay được ưu tiên hơn service_months; niên hạn "Trung sĩ" 6 tháng, rank_date 2026-05-31 → due 2026-11-30; quá hạn 31 ngày → không còn trong danh sách; needAttention: người có bản ghi cũ `dac_biet` nhưng mới nhất `binh_thuong` → không có; onLeaveToday đếm đúng người có phép bao trùm today (không đếm trùng nếu 2 bản ghi).
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS. Commit `feat: nhắc mốc và thống kê hồ sơ`.

### Task 4: Trang hồ sơ, mục con, Hồ sơ của tôi

**Files:** Create `src/routes/soldiers.js`, `views/soldiers/list.ejs`, `views/soldiers/detail.ejs`, `views/soldiers/form.ejs`, `views/soldiers/item-form.ejs`, `views/soldiers/my-profile.ejs`, `views/soldiers/_tabs.ejs`, `views/soldiers/_item-tables.ejs`, `test/http-soldiers.test.js`; Modify `src/server.js` (gắn router), `views/layout.ejs` (menu), `src/routes/admin.js` (nhãn nhật ký), `public/css/app.css`.

**Interfaces / routes:**
- admin+manager: `GET /soldiers` (lọc qua query, tìm `q`), `GET /soldiers/new`, `POST /soldiers`, `GET /soldiers/:id(\\d+)` (`?tab=ly-lich|gia-dinh|cong-tac|khen-thuong|phep|tu-tuong`; ghi audit `soldier_view`), `GET /soldiers/:id/edit`, `POST /soldiers/:id`, `POST /soldiers/:id/delete`, `GET /soldiers/:id/:type/new`, `POST /soldiers/:id/:type`, `GET /soldiers/:id/:type/:itemId/edit`, `POST /soldiers/:id/:type/:itemId`, `POST /soldiers/:id/:type/:itemId/delete` — `:type` ∈ family|career|award|leave|thought; item phải thuộc `:id` (khác → 404).
- mọi vai trò: `GET /my-profile` — hồ sơ liên kết với `req.user.id`; member nhận `redactForMember`; chưa liên kết → trang thông báo "Tài khoản của đồng chí chưa được liên kết với hồ sơ. Đề nghị liên hệ chỉ huy." (200). Ghi audit `soldier_view`.
- Menu: admin/manager "Hồ sơ quân nhân" (`/soldiers`); mọi vai trò "Hồ sơ của tôi" (`/my-profile`).
- Trang chi tiết: đầu trang tóm tắt (họ tên, cấp bậc, chức vụ, đơn vị, trạng thái, Đảng/Đoàn, tài khoản liên kết, số ngày phép đã nghỉ năm nay); 6 thẻ; mỗi thẻ là bảng + nút Thêm/Sửa/Xóa (xóa POST + `confirm()`); thẻ Tư tưởng tô màu theo mức.
- Form hồ sơ: các trường spec §2, cấp bậc là `<select>` từ `RANKS`, đơn vị `<select>`, ngày `type=date`.

- [ ] **Step 1: Test fail** — member GET `/soldiers`, `/soldiers/1`, `/soldiers/1/thought/new`, POST `/soldiers/1/thought` → 403; manager tạo hồ sơ → 302 tới `/soldiers/<id>`; item của hồ sơ A truy cập qua `/soldiers/B/family/<itemA>/edit` → 404; member đã liên kết GET `/my-profile` → 200, thân trang chứa họ tên, **không** chứa nội dung tư tưởng và hardship_note đã nhập, không có thẻ "Tư tưởng"; member chưa liên kết → 200 chứa "chưa được liên kết"; sau khi manager xem `/soldiers/<id>` có dòng audit `soldier_view`; `/soldiers?q=nguyen` lọc đúng.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS; chạy server tạm và mở các trang → không 500. Commit `feat: trang hồ sơ quân nhân và hồ sơ của tôi`.

### Task 5: Trang mốc, tổng quan, cài đặt thời hạn, liên kết tài khoản

**Files:** Create `views/soldiers/milestones.ejs`, `test/http-milestones.test.js`; Modify `src/routes/soldiers.js` (`GET /soldiers/milestones` — đăng ký **trước** `/soldiers/:id`), `src/routes/dashboard.js` + `views/dashboard.ejs` (hộp mốc 5 dòng, số đang nghỉ phép, danh sách cần quan tâm — chỉ admin/manager), `src/routes/admin.js` + `views/admin/settings.ejs` (phần "Thời hạn nhắc mốc": 2 ô số tháng, bảng niên hạn theo `RANKS` trừ 2 mục không niên hạn, ô số ngày báo trước), `src/routes/admin.js` + `views/admin/user-form.ejs` (ô chọn hồ sơ để liên kết: hồ sơ chưa liên kết + hồ sơ hiện tại; tùy chọn "Không liên kết").

- [ ] **Step 1: Test fail** — admin lưu cài đặt `party_probation_months=12` → `getMilestoneSettings` trả 12; ô để trống → null; giá trị "abc" → 400 có thông báo; manager POST cài đặt → 403; trang `/soldiers/milestones` hiện cảnh báo "Chưa cấu hình" khi thiếu; dashboard của manager chứa "Mốc sắp đến", của member thì không; admin liên kết hồ sơ khi sửa tài khoản → `findByUser` trả hồ sơ; chọn hồ sơ đã liên kết người khác → thông báo lỗi.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS. Commit `feat: nhắc mốc trên giao diện, cài đặt thời hạn, liên kết tài khoản`.

### Task 6: Xuất và nhập Excel

**Files:** Create `src/services/soldierExcel.js`, `views/soldiers/import.ejs`, `views/soldiers/import-preview.ejs`, `public/js/soldier-import.js`, `test/soldier-excel.test.js`; Modify `src/routes/soldiers.js`, `src/server.js` (route nhập dùng `express.json({limit:'3mb'})` riêng — gắn **trước** parser chung hoặc dùng parser cục bộ trên route).

**Interfaces:**
- `EXPORT_COLUMNS` = STT, Họ tên, Ngày sinh, Cấp bậc, Chức vụ, Đơn vị, Nhập ngũ, Quê quán, Đảng/Đoàn, Trạng thái. `exportWorkbook(rows): Promise<Buffer>`.
- `TEMPLATE_COLUMNS` = Họ tên*, Ngày sinh, Giới tính, Cấp bậc, Ngày nhận cấp bậc, Chức vụ, Đơn vị, Ngày nhập ngũ, Quê quán, Dân tộc, Tôn giáo, Văn hóa, SĐT, Ngày vào Đoàn, Ngày vào Đảng, Ngày chính thức. `templateWorkbook(): Promise<Buffer>` (dòng 1 tiêu đề, dòng 2 ví dụ hư cấu, sheet "Hướng dẫn").
- `parseImport(db, buffer): Promise<{valid: SoldierInput[], errors: [{row, message}], duplicates: [{row, full_name}]}>` — nhận ngày là Date của Excel hoặc chuỗi `dd/mm/yyyy`/`yyyy-mm-dd`; đơn vị khớp theo tên (không phân biệt hoa thường, so `fold`); cấp bậc khớp `RANKS` theo `fold`; giới tính "Nam/Nữ"; bỏ dòng trống hoàn toàn; trùng (fold họ tên + ngày sinh) với CSDL hoặc trong chính file → `duplicates`. File không phải xlsx hợp lệ → AppError "Tệp không đúng định dạng Excel (.xlsx)".
- `saveDraft(db, userId, payload): draftId` (hết hạn 30 phút), `commitImport(db, draftId, userId, actorId): number` (một giao dịch, ghi audit `soldier_import` kèm số dòng; draft của người khác hoặc hết hạn → AppError).
- Routes (admin+manager): `GET /soldiers/export` (theo bộ lọc như `/soldiers`, audit `soldier_export`, Content-Disposition như Phần 1, tên "Danh sách trích ngang"), `GET /soldiers/import` (trang tải lên + link mẫu), `GET /soldiers/import/template`, `POST /soldiers/import/preview` (JSON `{fileName, data: base64}` → lưu draft → JSON `{ok, redirect}`), `GET /soldiers/import/:draftId` (trang xem trước), `POST /soldiers/import/:draftId/confirm`.

- [ ] **Step 1: Test fail** — `exportWorkbook([])` có dòng tiêu đề đúng 10 cột; file mẫu đọc lại có dòng tiêu đề đúng; parse file dựng bằng exceljs gồm: 1 dòng đúng (ngày là Date), 1 dòng ngày chuỗi `05/03/2004`, 1 dòng thiếu họ tên, 1 dòng ngày `31/02/2004`, 1 dòng đơn vị không tồn tại, 1 dòng trùng hồ sơ có sẵn, 2 dòng trống cuối → valid 2, errors 3 (đúng số dòng Excel), duplicates 1; buffer rác → AppError; commit với draft của người khác → AppError; member GET `/soldiers/export` → 403; POST preview > 3mb → 413 thân thiện.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS. Commit `feat: xuất và nhập danh sách quân nhân bằng Excel`.

### Task 7: Dữ liệu thử, ảnh màn hình, hướng dẫn

**Files:** Modify `scripts/demo-data.js` (hồ sơ cho ctv, cs01…cs10 đã liên kết tài khoản + 10 quân nhân không tài khoản; vài người gia đình/khen thưởng/phép đang nghỉ hôm nay/tư tưởng "Cần quan tâm"; cấu hình thời hạn mẫu để mốc hiển thị: dự bị 12 tháng, phục vụ 24 tháng, niên hạn Binh nhì 6 – ghi rõ trong README đây chỉ là **số liệu thử**, khi dùng thật Admin tự nhập), `scripts/screenshots.js` (thêm: danh sách hồ sơ, chi tiết 3 thẻ Lý lịch/Phép/Tư tưởng, trang mốc, cài đặt thời hạn, xem trước nhập Excel, Hồ sơ của tôi của cs01 desktop + 390px), `README.md` (mục "Hồ sơ quân nhân": cách dùng, nhập Excel, cấu hình thời hạn, lưu ý bảo mật dữ liệu tư tưởng).

- [ ] **Step 1:** `npm test` → PASS. **Step 2:** `npm run screenshots` → TẤT CẢ ĐẠT; xem từng ảnh mới, sửa lỗi hiển thị. Thêm vào script một kiểm tra: trang `/my-profile` của cs01 không chứa chữ "Tư tưởng". **Step 3:** Commit `docs: dữ liệu thử và hướng dẫn Phần 2`.
