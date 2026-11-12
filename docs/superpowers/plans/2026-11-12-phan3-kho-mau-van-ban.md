# Phần 3 – Kho mẫu văn bản Word: Kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo văn bản Word đúng thể thức từ mẫu (5 mẫu dựng sẵn + mẫu người dùng tải lên có tự nhận dạng chỗ điền), tự điền thông tin đơn vị và hồ sơ quân nhân, một hoặc hàng loạt.

**Architecture:** Theo mẫu Phần 1–2: service thuần trong `src/services/`, router `(db) => Router`, view EJS. Kết xuất bằng `docxtemplater` + `pizzip` (cú pháp `{ma}`, vòng lặp `{#ds}…{/ds}`, `linebreaks: true`, `nullGetter` trả chuỗi rỗng). Mẫu dựng sẵn là file `.docx` dựng bằng script Python (`python-docx`, chỉ dùng lúc phát triển) và commit vào `templates/builtin/`.

**Tech Stack:** Node.js ≥ 22.13, express 4, ejs 3, node:sqlite, exceljs, **docxtemplater, pizzip** (mới). LibreOffice (`soffice`) chỉ dùng trong kiểm thử trực quan nếu có.

**Spec:** `docs/superpowers/specs/2026-11-12-phan3-kho-mau-van-ban-design.md`

## Global Constraints

- Phụ thuộc runtime được thêm: chỉ `docxtemplater` và `pizzip` (phiên bản ổn định hiện hành, ghi cố định trong package.json).
- Mọi giao diện, thông báo tiếng Việt, xưng "đồng chí"; mọi router `requireLogin` trước `requireRole('admin','manager')`; mọi POST có CSRF.
- Ô trống `{ma}`; vòng lặp `{#ds}…{/ds}`; giá trị thiếu → `''` (không bao giờ in `undefined`/`null`).
- Mã trường chung: `cap_tren, don_vi, dang_uy, chi_bo, dia_danh, ngay_thang, ngay, thang, nam, nguoi_ky_chuc_vu, nguoi_ky_cap_bac, nguoi_ky_ho_ten, bi_thu_ho_ten`.
- Mã trường quân nhân: `stt, ho_ten, ngay_sinh, gioi_tinh, cap_bac, chuc_vu, don_vi_qn, que_quan, noi_o, dan_toc, ton_giao, van_hoa, chuyen_mon, nhap_ngu, ngay_vao_doan, ngay_vao_dang, ngay_chinh_thuc, dang_doan, suc_khoe, sdt`. Ngày dạng dd/mm/yyyy.
- **Cấm** đưa dữ liệu `soldier_thoughts` hoặc `hardship_note` vào bất kỳ dữ liệu kết xuất nào.
- `ngay_thang` = `"<dia_danh>, ngày <d> tháng <m> năm <yyyy>"` (không số 0 đầu ngày/tháng; thiếu địa danh → bỏ phần "<dia_danh>, ").
- Chế độ mẫu: `chung`, `tung_nguoi`, `danh_sach`. Nhóm: `ke_hoach`, `bao_cao`, `dang`, `danh_sach`, `khac`. Kiểu trường nhập tay: `text`, `textarea`, `date`.
- Khóa settings thông tin đơn vị: `unit_cap_tren, unit_don_vi, unit_dang_uy, unit_chi_bo, unit_dia_danh, unit_nguoi_ky_chuc_vu, unit_nguoi_ky_cap_bac, unit_nguoi_ky_ho_ten, unit_bi_thu_ho_ten` (≤ 120 ký tự).
- Nhật ký: `doc_template_create`, `doc_template_update`, `doc_template_delete`, `doc_template_restore`, `doc_generate`, `unit_info_settings` — thêm nhãn tiếng Việt vào `AUDIT_ACTIONS`.
- Tải file lên: base64 trong JSON qua parser riêng `express.json({limit:'8mb'})` gắn trước parser chung cho đúng đường dẫn; file giải mã ≤ 5MB.
- Tên file tải về: dùng Content-Disposition như Phần 1 (ASCII fallback + `filename*=UTF-8''`); tên trong zip bỏ ký tự `\ / : * ? " < > |`, trùng tên thêm ` (2)`, ` (3)`.
- Code nền: đọc `globals.md` trong workspace để biết API Phần 1–2.

## Review Focus

1. **Nhãn bị tách thành nhiều run trong XML** (Word hay tách "Họ và " / "tên:") — nhận dạng phải ghép chữ theo đoạn. Test ở Task 4.
2. **Ký tự đặc biệt trong dữ liệu** (`&`, `<`, dấu ngoặc nhọn trong tên/ghi chú) — kết xuất ra XML hợp lệ, mở được bằng Word/LibreOffice. Test ở Task 2.
3. **Mẫu người dùng có cú pháp sai** (`{ho_ten` thiếu ngoặc, `{#ds}` không đóng) — báo lỗi tiếng Việt khi lưu, không 500 khi tạo. Test ở Task 2 và Task 5.
4. **Chọn nhiều người trùng họ tên** khi tạo zip — không ghi đè file. Test ở Task 2.
5. **Dữ liệu nhạy cảm** — không trường nào lấy từ tư tưởng/hoàn cảnh, kể cả khi mẫu chứa `{tu_tuong}` hay `{hardship_note}` → ra rỗng. Test ở Task 1.

---

## Cấu trúc file

```
src/services/docFields.js       FIELD_CATALOG, commonData(db, today, overrides), soldierData(soldier, stt), vnDateLine
src/services/unitInfo.js        getUnitInfo(db), saveUnitInfo(db, data, actorId)
src/services/docRender.js       inspectTemplate(buffer) → {tags, loops, errors}, renderDocx(buffer, data) → Buffer, buildZip(files) → Buffer, safeFileName
src/services/docTemplates.js    CRUD, listTemplates, getTemplate, restoreBuiltin, seedBuiltins(db), generate(db, templateId, {soldierIds, manual, ngay_thang}, actorId)
src/services/docDetect.js       LABELS (từ khóa → mã), detect(buffer) → suggestions[], applySuggestions(buffer, decisions) → Buffer
src/routes/documents.js         /documents, /documents/templates…, /documents/fields
src/db.js                       + migration: doc_templates
templates/builtin/*.docx        5 mẫu dựng sẵn; scripts/build-templates.py (python-docx) dựng lại
views/documents/*.ejs, public/js/doc-upload.js
test/doc-fields.test.js, test/doc-render.test.js, test/doc-templates.test.js, test/doc-detect.test.js, test/http-documents.test.js, test/helpers-docx.js (dựng docx tối giản bằng pizzip cho test)
```

---

### Task 1: Thông tin đơn vị và danh mục trường

**Files:** Create `src/services/unitInfo.js`, `src/services/docFields.js`, `test/doc-fields.test.js`; Modify `package.json` (thêm docxtemplater, pizzip — cài luôn ở task này).

**Interfaces:**
- `getUnitInfo(db): Record<UnitKey, string>` (thiếu → `''`); `saveUnitInfo(db, data, actorId)` (cắt khoảng trắng, > 120 ký tự → AppError nêu tên trường; audit `unit_info_settings`).
- `FIELD_CATALOG: {code, label, group: 'chung'|'quan_nhan'}[]` (đủ mã ở Global Constraints, nhãn tiếng Việt).
- `vnDateLine(diaDanh: string, isoDate: string): string`.
- `commonData(db, today, overrides = {}): object` — mã chung; `ngay/thang/nam` là chuỗi; overrides.ngay_thang (chuỗi tự do) thay `ngay_thang`.
- `soldierData(soldier, stt): object` — đủ mã quân nhân từ hồ sơ (dùng `getSoldier` kết quả + `partyState` để ra `dang_doan` nhãn tiếng Việt, `gioi_tinh` "Nam"/"Nữ"), mọi giá trị là chuỗi (thiếu → `''`).

- [ ] **Step 1: Test fail** — `vnDateLine('Đồng Nai','2026-11-02') === 'Đồng Nai, ngày 2 tháng 11 năm 2026'`; `vnDateLine('', '2026-01-05') === 'ngày 5 tháng 1 năm 2026'`; `soldierData` với hồ sơ có party_join_date chưa chính thức → `dang_doan === 'Đảng viên dự bị'`, `ngay_sinh` dạng `dd/mm/yyyy`; khóa của `soldierData` đúng tập mã quân nhân (so khớp tuyệt đối với danh sách) và không chứa khóa nào có chữ `thought`/`hardship`/`tu_tuong`; giá trị không có `undefined`/`null`; `saveUnitInfo` chuỗi 121 ký tự → AppError; lưu rồi `getUnitInfo` trả đúng.
- [ ] **Step 2:** FAIL. **Step 3:** `npm i docxtemplater pizzip` (ghi phiên bản cố định), cài đặt. **Step 4:** PASS toàn bộ. Commit `feat: thông tin đơn vị và danh mục trường văn bản`.

### Task 2: Kết xuất Word và nén zip

**Files:** Create `src/services/docRender.js`, `test/helpers-docx.js`, `test/doc-render.test.js`.

**Interfaces:**
- `test/helpers-docx.js`: `makeDocx(paragraphs: string[] | {xmlBody: string}): Buffer` (docx tối giản hợp lệ: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`; hỗ trợ chèn bảng có dòng lặp), `docxText(buffer): string` (ghép chữ `w:t` của document.xml, ngăn đoạn bằng `\n`).
- `inspectTemplate(buffer): {tags: string[], loops: string[], errors: string[]}` — lỗi dịch sang tiếng Việt: "Ô trống "{x" thiếu dấu đóng }", "Vòng lặp {#ds} chưa có {/ds}", hoặc "Tệp không đúng định dạng Word (.docx)".
- `renderDocx(buffer, data): Buffer` — `paragraphLoop: true`, `linebreaks: true`, `nullGetter: () => ''`; lỗi → AppError tiếng Việt.
- `safeFileName(name): string`; `buildZip(files: {name, buffer}[]): Buffer` (tên trùng → thêm ` (2)`…).

- [ ] **Step 1: Test fail** — render `"Họ tên: {ho_ten}"` với `ho_ten: 'A & <B> {C}'` → `docxText` chứa đúng chuỗi đó và XML parse lại được (dùng PizZip đọc lại + kiểm tra không có `&` trần); bảng lặp `{#ds}{stt}. {ho_ten}{/ds}` với 3 người → 3 dòng; textarea `"dòng 1\ndòng 2"` → có `<w:br/>`; thiếu khóa → rỗng; `inspectTemplate` trên `"{ho_ten"` → errors chứa "thiếu dấu đóng"; trên buffer rác → "không đúng định dạng"; `buildZip` 2 file "Nguyễn Văn A.docx" → tên thứ hai "Nguyễn Văn A (2).docx"; `safeFileName('a/b:c*?')` không còn ký tự cấm.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS. Commit `feat: kết xuất văn bản Word và nén nhiều file`.

### Task 3: Lưu trữ mẫu, 5 mẫu dựng sẵn, tạo văn bản

**Files:** Modify `src/db.js` (migration `doc_templates`); Create `scripts/build-templates.py`, `templates/builtin/ke-hoach.docx`, `bao-cao.docx`, `bao-cao-chi-bo.docx`, `danh-sach-quan-nhan.docx`, `danh-sach-dang-vien.docx`, `src/services/docTemplates.js`, `test/doc-templates.test.js`.

**Interfaces:**
- Bảng `doc_templates(id, name, category, mode, file BLOB, manual_fields TEXT JSON, builtin_key TEXT NULL UNIQUE, created_by, created_at, updated_at)`.
- `seedBuiltins(db)` (chỉ khi bảng trống; gọi trong `seed()`); `listTemplates(db)`; `getTemplate(db, id)` (kèm `manual_fields` đã parse, không kèm file); `getTemplateFile(db, id): Buffer`; `createTemplate(db, {name, category, mode, file, manual_fields}, actorId)` (kiểm tra `inspectTemplate` — errors → AppError; trả `{id, warnings}` với warnings = mã chưa có trong catalog và chưa khai báo nhập tay); `updateTemplate(db, id, data, actorId)` (file tùy chọn); `deleteTemplate`; `restoreBuiltin(db, id, actorId)`; `generate(db, id, {soldierIds, manual, ngay_thang}, actorId, today): {fileName, buffer, contentType}` — kiểm tra trường nhập tay bắt buộc (AppError nêu nhãn), ngày nhập tay `YYYY-MM-DD` → dd/mm/yyyy; mode `chung` bỏ qua soldierIds; `danh_sach` cần ≥ 1 người, dữ liệu `ds` theo thứ tự đơn vị rồi họ tên, `stt` từ 1; mẫu "Danh sách đảng viên" (builtin_key `danh_sach_dang_vien`) chỉ giữ người có ngay_vao_dang; `tung_nguoi` 1 người → docx, nhiều → zip; audit `doc_generate` kèm số người.
- Mẫu dựng sẵn (python-docx, đúng thể thức spec §2: A4, Times New Roman 14 (bảng 13), lề trái 3,5 cm, phải 2 cm, trên 2 cm, dưới 2 cm; danh sách khổ ngang lề 2/1,5/2/2): đầu văn bản bảng 2 cột không viền dùng `{cap_tren}`, `{don_vi}`, `Số: {so_van_ban}`, quốc hiệu, `{ngay_thang}` nghiêng; tiêu đề in đậm căn giữa (`KẾ HOẠCH` + `{trich_yeu}`; `BÁO CÁO` + `{trich_yeu}`); thân `{noi_dung}`; cuối bảng 2 cột `Nơi nhận:` + `{noi_nhan}` | `{nguoi_ky_chuc_vu}` / dòng trống ×3 / `{nguoi_ky_cap_bac} {nguoi_ky_ho_ten}`. Báo cáo Chi bộ: `{dang_uy}` / `{chi_bo}` / `*` | `ĐẢNG CỘNG SẢN VIỆT NAM` / `{ngay_thang}`; ký `T/M CHI BỘ` / `BÍ THƯ` / `{bi_thu_ho_ten}`; thêm `Kính gửi: {kinh_gui}`. Danh sách quân nhân: tiêu đề `DANH SÁCH` + `{trich_yeu}`; bảng cột TT | Họ và tên | Ngày sinh | Cấp bậc | Chức vụ | Đơn vị | Dân tộc | Quê quán | Ghi chú, dòng lặp `{#ds}{stt}|{ho_ten}|{ngay_sinh}|{cap_bac}|{chuc_vu}|{don_vi_qn}|{dan_toc}|{que_quan}|{/ds}`. Danh sách đảng viên: cột TT | Họ và tên | Ngày sinh | Dân tộc / Tôn giáo | Quê quán | Ngày vào Đảng / Chính thức | Ghi chú. Trường nhập tay khai báo trong seed: `so_van_ban` (text), `trich_yeu` (text, bắt buộc), `noi_dung` (textarea, bắt buộc – trừ danh sách), `noi_nhan` (textarea), `kinh_gui` (text, chỉ Chi bộ).

- [ ] **Step 1: Test fail** — seed 2 lần → đúng 5 mẫu; mỗi mẫu dựng sẵn `inspectTemplate` không lỗi và mọi tag thuộc catalog hoặc trường nhập tay khai báo; generate từng mẫu với hồ sơ thử → `docxText` không còn `{` hay `}`, chứa họ tên người được chọn (mẫu danh sách); danh sách đảng viên loại người không có ngày vào Đảng; thiếu `trich_yeu` → AppError chứa nhãn; `tung_nguoi` (mẫu tạo trong test) 2 người trùng tên → zip có 2 file khác tên; `restoreBuiltin` sau khi thay file → file trở lại bản gốc; createTemplate với file lỗi cú pháp → AppError; warnings liệt kê `{ma_la}`.
- [ ] **Step 2:** FAIL. **Step 3:** Viết script Python dựng 5 file, chạy, commit file; cài đặt service. **Step 4:** PASS. Nếu có `soffice`: chuyển 5 file kết xuất sang PDF trong thư mục tạm và xem ảnh trang đầu (ghi kết quả trong report). Commit `feat: kho mẫu văn bản và 5 mẫu dựng sẵn`.

### Task 4: Tự nhận dạng chỗ cần điền

**Files:** Create `src/services/docDetect.js`, `test/doc-detect.test.js`.

**Interfaces:**
- `LABELS: {code, keys: string[]}[]` — từ khóa đã `fold` (không dấu): ho_ten ["ho va ten","ho ten"], ngay_sinh ["ngay sinh","sinh ngay","ngay thang nam sinh"], cap_bac ["cap bac"], chuc_vu ["chuc vu"], don_vi_qn ["don vi"], que_quan ["que quan"], noi_o ["noi o","tru quan","noi o hien nay"], dan_toc ["dan toc"], ton_giao ["ton giao"], van_hoa ["trinh do van hoa","van hoa"], chuyen_mon ["chuyen mon"], nhap_ngu ["nhap ngu","ngay nhap ngu"], ngay_vao_doan ["ngay vao doan"], ngay_vao_dang ["ngay vao dang"], ngay_chinh_thuc ["ngay chinh thuc"], sdt ["dien thoai","so dien thoai","sdt"], gioi_tinh ["gioi tinh"], suc_khoe ["suc khoe"]. Khớp nhãn dài nhất trước.
- `detect(buffer): {suggestions: [{id, paragraphIndex, context, label, code|null, newCode|null}]}` — duyệt mọi `w:p` trong `word/document.xml` (kể cả trong bảng), ghép chữ các `w:t`; mẫu chỗ trống: chuỗi ≥ 3 dấu chấm (`.` hoặc `…`) hoặc ≥ 3 `_`, có thể có `:` trước; nhãn = cụm chữ ngay trước chỗ trống (trong cùng đoạn, sau dấu câu/ đầu đoạn gần nhất, tối đa 6 từ); nhãn khớp LABELS → `code`, không khớp → `newCode` = fold nhãn thay khoảng trắng bằng `_` (ASCII, ≤ 30 ký tự, không trùng mã catalog). Một đoạn có thể có nhiều chỗ trống.
- `applySuggestions(buffer, decisions: {id, action: 'use'|'manual'|'skip', code}[]): {buffer, manualFields: {code,label,type:'text',required:false}[]}` — thay đúng phần dấu chấm/gạch dưới bằng `{code}`; xử lý trường hợp chỗ trống trải nhiều run (dồn chữ vào run chứa ký tự đầu của chỗ trống, các run còn lại phần chỗ trống bị cắt); phần còn lại của đoạn giữ nguyên run và định dạng.

- [ ] **Step 1: Test fail** — đoạn "Họ và tên: ……………………" → 1 đề xuất code ho_ten, áp dụng → `docxText` "Họ và tên: {ho_ten}"; nhãn tách 3 run ("Họ và ", "tên", ": ......") → vẫn nhận ra; đoạn trong ô bảng → nhận ra; "Lý do: ________" → newCode `ly_do`, action manual → manualFields chứa `{code:'ly_do', label:'Lý do'}`; hai chỗ trống trong một đoạn ("Cấp bậc: ...... Chức vụ: ......") → 2 đề xuất; đoạn không có chỗ trống → 0; action skip giữ nguyên; kết quả sau áp dụng qua `inspectTemplate` không lỗi.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt (thao tác XML bằng chuỗi/regex cẩn thận hoặc DOM tối giản tự viết; không thêm thư viện). **Step 4:** PASS. Commit `feat: tự nhận dạng chỗ cần điền trong mẫu Word`.

### Task 5: Giao diện văn bản

**Files:** Create `src/routes/documents.js`, `views/documents/index.ejs`, `generate.ejs`, `template-form.ejs`, `upload.ejs`, `detect-review.ejs`, `fields.ejs`, `public/js/doc-upload.js`, `test/http-documents.test.js`; Modify `src/server.js` (router + parser 8mb trên `/documents/templates/upload` và `/documents/templates/:id/file`), `views/layout.ejs` (menu "Văn bản" cho admin/manager), `src/routes/admin.js` + `views/admin/settings.ejs` (mục "Thông tin đơn vị"), `AUDIT_ACTIONS`.

**Routes (admin+manager trừ khi ghi chú):**
- `GET /documents` — danh sách mẫu theo nhóm, nút "Tạo văn bản", "Tải mẫu lên", "Danh mục ô trống"; cảnh báo nếu thông tin đơn vị trống.
- `GET /documents/:id(\\d+)/generate` — form: chọn quân nhân (khi mode ≠ chung; lọc đơn vị/trạng thái/Đảng-Đoàn, ô "Chọn tất cả"), trường nhập tay theo kiểu, ô `ngay_thang` tùy chọn; `POST` cùng đường dẫn → tải file (lỗi → render lại form 400 giữ dữ liệu).
- `GET /documents/fields` — bảng danh mục mã trường + mô tả + ví dụ cách dùng `{ma}` và `{#ds}…{/ds}`.
- `GET /documents/templates/upload` + `POST /documents/templates/upload` (JSON `{fileName, data}` base64 → `detect` → lưu nháp vào `import_drafts` (dùng lại bảng Phần 2, payload JSON có buffer base64 + suggestions) → `{ok, redirect}`); `GET /documents/templates/review/:draftId` (bảng đề xuất: nhãn, ngữ cảnh, select mã/“Trường nhập tay mới”/“Bỏ qua”, tên mẫu, nhóm, chế độ) → `POST` → `applySuggestions` + `createTemplate` → redirect `/documents/templates/:id/edit` hiện warnings.
- `GET /documents/templates/:id(\\d+)/edit` + `POST` (tên, nhóm, chế độ, bảng trường nhập tay thêm/xóa dòng); `GET /documents/templates/:id/file` (tải file mẫu); `POST /documents/templates/:id/file` (thay file, JSON base64); `POST /documents/templates/:id/delete` (mẫu dựng sẵn: không xóa, chỉ khôi phục); `POST /documents/templates/:id/restore`.
- Admin: Cài đặt → "Thông tin đơn vị" (form 9 trường, POST `/admin/settings/unit-info`).

- [ ] **Step 1: Test fail** — member GET `/documents` → 403; manager tạo văn bản từ mẫu Kế hoạch (điền trich_yeu, noi_dung) → 200 content-type docx, `docxText` chứa nội dung và `cap_tren` đã cài; thiếu trich_yeu → 400 chứa nhãn; danh sách quân nhân chọn 2 người → docx có 2 họ tên; tải lên docx có "Họ và tên: ......" → review page chứa "Họ và tên" → xác nhận → mẫu mới có tag `ho_ten`; tải lên rác → JSON lỗi "không đúng định dạng"; audit có `doc_generate`; admin lưu thông tin đơn vị → `getUnitInfo` đúng; manager POST thông tin đơn vị → 403.
- [ ] **Step 2:** FAIL. **Step 3:** Cài đặt. **Step 4:** PASS; chạy server tạm mở các trang → không 500. Commit `feat: giao diện tạo văn bản và quản lý mẫu`.

### Task 6: Dữ liệu thử, ảnh màn hình, kiểm tra trực quan, hướng dẫn

**Files:** Modify `scripts/demo-data.js` (thông tin đơn vị mẫu hư cấu: TIỂU ĐOÀN 1 / ĐẠI ĐỘI 1, Đảng ủy/Chi bộ tương ứng, địa danh "Đồng Nai", người ký hư cấu), `scripts/screenshots.js` (trang Văn bản, form tạo Kế hoạch, review nhận dạng, danh mục ô trống, cài đặt thông tin đơn vị), `README.md` (mục "Văn bản Word": tạo văn bản, mẫu dựng sẵn, tải mẫu riêng, cách viết ô trống/bảng lặp, khôi phục mẫu gốc, lưu ý không đưa tài liệu mật lên).

- [ ] **Step 1:** `npm test` PASS; `npm run screenshots` TẤT CẢ ĐẠT. **Step 2:** Kết xuất 5 mẫu với dữ liệu demo, chuyển PDF bằng `soffice --headless --convert-to pdf` (nếu có) rồi chuyển trang 1 sang PNG (`pdftoppm` nếu có) vào `screenshots/` và XEM từng ảnh: thể thức đúng (đầu văn bản 2 cột, quốc hiệu, chữ ký), không tràn trang, không còn `{`. Sửa mẫu nếu sai (chạy lại script Python). **Step 3:** Commit `docs: dữ liệu thử, ảnh và hướng dẫn Phần 3`.
