// Công cụ phát triển (tùy chọn): chụp ảnh màn hình các trang chính vào screenshots/.
// Cần Playwright cài riêng (không nằm trong dependencies): npm i -D playwright (hoặc dùng bản có sẵn).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/server');
const { fillDemo, PASSWORD } = require('./demo-data');
const ExcelJS = require('exceljs');
const { startFakeOllama } = require('../test/helpers-ollama');

const OUT = path.join(__dirname, '..', 'screenshots');
const DESKTOP = { width: 1366, height: 900 };
const MOBILE = { width: 390, height: 844 };

let failed = false;
const pass = (m) => console.log('PASS ' + m);
const fail = (m) => { failed = true; console.log('FAIL ' + m); };

async function main() {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qlctv-'));
  const { app, db } = createApp({ dbPath: path.join(tmp, 'shots.db') });
  fillDemo(db);
  // Máy Ollama giả (chỉ dùng để chụp ảnh) với nội dung kế hoạch hư cấu.
  const fake = await startFakeOllama({
    models: ['qwen2.5:3b'],
    chunks: ['1. Mục đích, yêu cầu\n', 'Nâng cao nhận thức chính trị, củng cố tinh thần đoàn kết trong đơn vị.\n', '2. Nội dung, hình thức\n', 'Sinh hoạt vào sáng thứ Bảy hằng tuần, mỗi buổi 90 phút.\n', '3. Tổ chức thực hiện\n', 'Các trung đội chủ động xây dựng kế hoạch chi tiết và báo cáo kết quả.'],
  });
  const setSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  setSetting.run('ai_enabled', '1');
  setSetting.run('ai_url', fake.url);
  setSetting.run('ai_model', 'qwen2.5:3b');
  const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();

  async function session(username, fn) {
    const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1, locale: 'vi-VN' });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('response', (r) => { if (r.status() >= 400 && r.request().resourceType() === 'document') problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.goto(base + '/login');
    if (username === 'admin') await page.screenshot({ path: path.join(OUT, '01-dang-nhap.png'), fullPage: true });
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([page.waitForNavigation(), page.click('button[type="submit"]')]);
    const shot = async (name, url, opts = {}) => {
      const before = problems.length;
      const resp = await page.goto(base + url);
      if (opts.prepare) await opts.prepare();
      if (opts.size) await page.setViewportSize(opts.size);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
      if (opts.size) await page.setViewportSize(DESKTOP);
      if (resp.status() >= 400) problems.push(`HTTP ${resp.status()} ${url}`);
      if (problems.length === before) pass(`${name} (${url})`); else fail(`${name}: ${problems.slice(before).join('; ')}`);
    };
    try { await fn(shot, page); } finally { await ctx.close(); }
    if (problems.length) problems.forEach((p) => fail(`[${username}] ${p}`));
  }

  await session('admin', async (shot, page) => {
    await shot('02-admin-tai-khoan', '/admin/users');
    await shot('03-admin-don-vi', '/admin/units');
    await shot('04-admin-nhat-ky', '/admin/audit');
    await shot('05-admin-cai-dat-thoi-han', '/admin/settings');
    await shot('06-admin-thong-tin-don-vi', '/admin/settings', {
      prepare: async () => { await page.locator('form[action="/admin/settings/unit-info"]').scrollIntoViewIfNeeded(); },
    });
  });

  await session('admin', async (shot, page) => {
    await shot('07-admin-cai-dat-tro-ly-ai', '/admin/settings', {
      prepare: async () => {
        await page.click('#ai-check');
        await page.waitForFunction(() => /Kết nối được/.test(document.getElementById('ai-check-out').textContent), null, { timeout: 8000 })
          .catch(() => fail('cài đặt AI: Kiểm tra kết nối không báo kết nối được'));
        await page.evaluate(() => window.scrollTo(0, 0));
      },
    });
    const t = await page.locator('#ai-check-out').innerText();
    if (/qwen2\.5:3b/.test(t)) pass('cài đặt AI: Kiểm tra kết nối liệt kê mô hình'); else fail('cài đặt AI: không thấy tên mô hình (' + t + ')');
  });

  await session('ctv', async (shot, page) => {
    await shot('10-ctv-tong-quan', '/');
    await shot('11-ctv-danh-sach', '/tasks');
    await shot('12-ctv-kanban', '/kanban');
    await shot('13-ctv-giao-viec-goi-y', '/tasks/new', {
      prepare: async () => {
        await page.fill('input[name="title"]', 'Tổ chức buổi giao lưu văn nghệ');
        await page.selectOption('select[name="category"]', 'van_hoa');
        await page.fill('input[name="due_date"]', '2099-01-01');
        await page.dispatchEvent('input[name="due_date"]', 'change');
        await page.waitForSelector('.suggest-card', { timeout: 5000 }).catch(() => fail('form giao việc: không thấy gợi ý người thực hiện'));
      },
    });
    await shot('14-ctv-lich', '/calendar');
    await shot('15-ctv-bao-cao', '/reports');
    await shot('16-ctv-hieu-suat', '/reports/performance');
    await shot('17-ctv-quan-so', '/people');
    await shot('18-ctv-mau-viec-dinh-ky', '/templates');
    await shot('18b-ctv-viec-dinh-ky', '/templates?tab=recurring');
    await shot('19-ctv-tong-quan-dien-thoai', '/', { size: MOBILE });

    // Hồ sơ quân nhân
    await shot('30-ctv-ho-so-danh-sach', '/soldiers');
    const sid = db.prepare("SELECT id FROM soldiers WHERE full_name = 'Lê Quốc Cường'").get().id;
    await shot('31-ctv-ho-so-ly-lich', `/soldiers/${sid}?tab=ly-lich`);
    await shot('32-ctv-ho-so-phep', `/soldiers/${db.prepare("SELECT id FROM soldiers WHERE full_name = 'Trần Minh Bảo'").get().id}?tab=phep`);
    await shot('33-ctv-ho-so-tu-tuong', `/soldiers/${sid}?tab=tu-tuong`);
    await shot('34-ctv-moc-nhac', '/soldiers/milestones');

    // Nhập Excel: tạo tệp .xlsx (2 dòng hợp lệ + 1 dòng lỗi) rồi đi qua trang nhập thật
    const xl = path.join(tmp, 'nhap-thu.xlsx');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Hồ sơ');
    ws.addRow(['Họ tên*', 'Ngày sinh', 'Giới tính', 'Cấp bậc', 'Ngày nhận cấp bậc', 'Chức vụ', 'Đơn vị', 'Ngày nhập ngũ', 'Quê quán', 'Dân tộc', 'Tôn giáo', 'Văn hóa', 'SĐT', 'Ngày vào Đoàn', 'Ngày vào Đảng', 'Ngày chính thức']);
    ws.addRow(['Chu Văn Sơn', '12/03/2005', 'Nam', 'Binh nhì', '01/09/2025', 'Chiến sĩ', 'Trung đội 1', '01/09/2025', 'Hà Nam', 'Kinh', '', '12/12', '0900000101', '', '', '']);
    ws.addRow(['Âu Thị Thu', '20/07/2004', 'Nữ', 'Binh nhất', '01/03/2026', 'Y tế', 'Trung đội 2', '01/09/2025', 'Phú Thọ', 'Kinh', '', '12/12', '0900000102', '', '', '']);
    ws.addRow(['Mạc Văn Tín', '31/02/2005', 'Nam', 'Binh nhì', '', 'Chiến sĩ', 'Đơn vị không có', '01/09/2025', '', '', '', '', '', '', '', '']);
    await wb.xlsx.writeFile(xl);
    await page.goto(base + '/soldiers/import');
    await page.setInputFiles('#import-file', xl);
    await Promise.all([page.waitForURL(/\/soldiers\/import\/[0-9a-f-]{36}/, { timeout: 8000 }), page.click('#import-btn')])
      .catch(() => fail('nhập Excel: không chuyển sang trang xem trước'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '35-ctv-nhap-excel-xem-truoc.png'), fullPage: true });
    const prev = await page.locator('body').innerText();
    if (/Chu Văn Sơn/.test(prev) && /Hợp lệ: 2/.test(prev) && /Lỗi: 1/.test(prev)) pass('nhập Excel: trang xem trước hiện dòng hợp lệ và dòng lỗi');
    else fail('nhập Excel: trang xem trước thiếu dữ liệu');

    // Kéo thả Kanban thật: "Chưa làm" -> "Đang làm"
    await page.goto(base + '/kanban');
    const card = page.locator('.kanban-col[data-status="chua_lam"] .kanban-card').first();
    const id = await card.getAttribute('data-id');
    // Thả lên tiêu đề cột (luôn nằm trong khung nhìn) để Playwright không cuộn trang giữa chừng.
    await page.dragAndDrop(`.kanban-card[data-id="${id}"]`, '.kanban-col[data-status="dang_lam"] h2');
    await page.waitForTimeout(800);
    await page.reload();
    const inDoing = await page.locator(`.kanban-col[data-status="dang_lam"] .kanban-card[data-id="${id}"]`).count();
    if (inDoing === 1) pass(`Kanban kéo thả: việc #${id} chuyển từ "Chưa làm" sang "Đang làm" và còn nguyên sau khi tải lại`);
    else fail(`Kanban kéo thả: việc #${id} không ở cột "Đang làm" sau khi tải lại`);
  });

  // Văn bản Word (Phần 3)
  await session('ctv', async (shot, page) => {
    const tid = (key) => db.prepare('SELECT id FROM doc_templates WHERE builtin_key = ?').get(key).id;
    await shot('40-ctv-van-ban', '/documents');
    await shot('41-ctv-tao-ke-hoach', `/documents/${tid('ke_hoach')}/generate`, {
      prepare: async () => {
        await page.fill('input[name="manual[so_van_ban]"]', '15/KH-ĐĐ1');
        await page.fill('input[name="manual[trich_yeu]"]', 'tổ chức sinh hoạt chính trị tháng 12');
        await page.fill('textarea[name="manual[noi_dung]"]', '1. Mục đích, yêu cầu\nNâng cao nhận thức chính trị cho cán bộ, chiến sĩ.\n2. Nội dung, thời gian\nSinh hoạt vào sáng thứ Bảy hằng tuần.');
        await page.fill('textarea[name="manual[noi_nhan]"]', '- Tiểu đoàn 1;\n- Lưu: VT.');
      },
    });
    await shot('42-ctv-tao-danh-sach-quan-nhan', `/documents/${tid('danh_sach_quan_nhan')}/generate`, {
      prepare: async () => {
        await page.fill('input[name="manual[so_van_ban]"]', '08/DS-ĐĐ1');
        await page.fill('input[name="manual[trich_yeu]"]', 'danh sách quân nhân Trung đội 1');
        for (const i of [0, 1, 2, 3]) await page.locator('.pick').nth(i).check();
      },
    });

    // Tải thật một văn bản Kế hoạch và kiểm tra là tệp .docx (zip, bắt đầu bằng PK)
    await page.goto(base + `/documents/${tid('ke_hoach')}/generate`);
    await page.fill('input[name="manual[so_van_ban]"]', '15/KH-ĐĐ1');
    await page.fill('input[name="manual[trich_yeu]"]', 'tổ chức sinh hoạt chính trị');
    await page.fill('textarea[name="manual[noi_dung]"]', 'Nội dung thử & kiểm tra {ngoặc}.');
    const dlRespP = page.waitForResponse((r) => r.request().method() === 'POST' && /\/generate$/.test(r.url()));
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('form.form-card button[type="submit"]')])
      .catch(() => [null]);
    const dlResp = await dlRespP.catch(() => null);
    if (!dl || !dlResp) fail('tạo văn bản: không tải được tệp Kế hoạch');
    else {
      const f = path.join(tmp, 'ke-hoach-tai-ve.docx');
      await dl.saveAs(f);
      const head = fs.readFileSync(f).subarray(0, 2).toString('latin1');
      const cd = (await dlResp.allHeaders())['content-disposition'] || '';
      // Lưu ý: suggestedFilename() của Chromium không tin cậy trong môi trường chạy tự động, nên kiểm tra tiêu đề Content-Disposition.
      if (head === 'PK' && /filename\*=UTF-8''[^;]*\.docx/.test(cd)) pass('tạo văn bản: tải về tệp .docx hợp lệ (bắt đầu bằng PK, tên tệp tiếng Việt trong Content-Disposition)');
      else fail('tạo văn bản: tệp tải về không phải .docx (' + cd + ', đầu tệp ' + head + ')');
    }

    // Tải mẫu riêng: docx nhỏ có "Họ và tên: ......" và "Lý do: ______"
    const docxPath = path.join(tmp, 'mau-rieng.docx');
    const py = require('node:child_process').spawnSync('python3', ['-c', `
import docx, sys
d = docx.Document()
d.add_paragraph('GIẤY XÁC NHẬN')
d.add_paragraph('Họ và tên: ......')
d.add_paragraph('Lý do: ______')
d.save(sys.argv[1])`, docxPath]);
    if (py.status !== 0) fail('không dựng được tệp mẫu thử bằng python-docx');
    else {
      await page.goto(base + '/documents/templates/upload');
      await page.setInputFiles('#doc-file', docxPath);
      await Promise.all([page.waitForURL(/\/documents\/templates\/review\//, { timeout: 8000 }), page.click('#doc-btn')])
        .catch(() => fail('tải mẫu riêng: không chuyển sang trang xem lại nhận dạng'));
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, '43-ctv-tai-mau-xem-lai.png'), fullPage: true });
      const t = await page.locator('body').innerText();
      if (/Họ và tên/.test(t) && /Lý do/.test(t)) pass('tải mẫu riêng: trang xem lại nhận dạng hiện "Họ và tên" và "Lý do"');
      else fail('tải mẫu riêng: trang xem lại thiếu nhãn nhận dạng');
    }
    await shot('44-ctv-danh-muc-o-trong', '/documents/fields');
  });

  // Trợ lý (Phần 4)
  await session('ctv', async (shot, page) => {
    const sentence = 'giao đ/c Bảo soạn báo cáo chi bộ trước thứ Sáu tuần sau, gấp';
    await shot('50-ctv-tro-ly-giao-viec', '/assistant?tab=giao-viec', {
      prepare: async () => { await page.fill('textarea[name="text"]', sentence); },
    });
    await Promise.all([page.waitForURL(/\/tasks\/new\?/, { timeout: 8000 }), page.click('form[action="/assistant/task"] button[type="submit"]')])
      .catch(() => fail('giao việc nhanh: không chuyển sang form giao việc'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '52-ctv-giao-viec-dien-san.png'), fullPage: true });
    const checked = await page.locator('input[name="assignee_ids"]:checked').count();
    const titleVal = await page.inputValue('input[name="title"]');
    if (checked >= 1 && titleVal) pass('giao việc nhanh: form /tasks/new có người thực hiện được tích sẵn và tiêu đề điền sẵn');
    else fail(`giao việc nhanh: form chưa điền sẵn (người tích: ${checked}, tiêu đề: "${titleVal}")`);

    // Câu có tên trùng nhiều người -> trang chọn đúng người
    await page.goto(base + '/assistant?tab=giao-viec');
    await page.fill('textarea[name="text"]', 'giao đ/c Hải chuẩn bị buổi sinh hoạt trước thứ Sáu tuần sau');
    await page.click('form[action="/assistant/task"] button[type="submit"]');
    await page.waitForLoadState();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '51-ctv-tro-ly-chon-nguoi.png'), fullPage: true });
    if (await page.locator('input[type="radio"][name="pick_0"]').count() >= 2) pass('giao việc nhanh: tên trùng hiện trang chọn đúng người');
    else fail('giao việc nhanh: không thấy trang chọn người cho tên trùng');

    await shot('53-ctv-tro-ly-hoi-dap', '/assistant?tab=hoi-dap', {
      prepare: async () => {
        await page.fill('input[name="q"]', 'việc nào quá hạn');
        await Promise.all([page.waitForNavigation(), page.click('form[action="/assistant/ask"] button[type="submit"]')]);
      },
    });
    if (await page.locator('table').count() >= 1) pass('hỏi đáp: có bảng kết quả'); else fail('hỏi đáp: không có bảng kết quả');

    await shot('54-ctv-tro-ly-soan-thao', '/assistant?tab=soan-thao', {
      prepare: async () => {
        await page.click('#ol-btn');
        await page.waitForFunction(() => document.getElementById('ai-input').value.length > 10, null, { timeout: 5000 });
        await page.click('#ai-run');
        await page.waitForFunction(() => /Xong/.test(document.querySelector('[data-role="status"]').textContent), null, { timeout: 15000 })
          .catch(() => fail('AI soạn thảo: không chạy xong'));
      },
    });
    const aiOut = await page.locator('[data-role="out"]').first().innerText();
    if (aiOut.includes('Nâng cao nhận thức chính trị')) pass('AI soạn thảo: kết quả chứa nội dung của máy AI giả');
    else fail('AI soạn thảo: kết quả không chứa nội dung mong đợi');

    const tidKh = db.prepare("SELECT id FROM doc_templates WHERE builtin_key = 'ke_hoach'").get().id;
    await shot('55-ctv-van-ban-nut-ai', `/documents/${tidKh}/generate`, {
      prepare: async () => {
        await page.click('[data-role="ol-btn"]');
        await page.waitForFunction(() => document.querySelector('textarea[name="manual[noi_dung]"]').value.length > 10, null, { timeout: 5000 })
          .catch(() => fail('form văn bản: Chèn dàn ý không điền vào ô nội dung'));
      },
    });
  });

  await session('cs01', async (shot, page) => {
    await shot('20-cs-viec-cua-toi', '/my');
    await shot('21-cs-viec-cua-toi-dien-thoai', '/my', { size: MOBILE });
    await shot('22-cs-kanban', '/kanban');
    await shot('23-cs-ho-so-cua-toi', '/my-profile');
    await shot('24-cs-ho-so-cua-toi-dien-thoai', '/my-profile', { size: MOBILE });
    let mine = '';
    for (const tab of ['ly-lich', 'gia-dinh', 'tu-tuong']) {
      await page.goto(base + '/my-profile?tab=' + tab);
      mine += '\n' + await page.locator('body').innerText();
    }
    await shot('56-cs-tro-ly', '/assistant');
    const tabsText = await page.locator('nav.tabs').innerText();
    if (/Hỏi đáp/.test(tabsText) && !/Giao việc nhanh/.test(tabsText) && !/Soạn thảo/.test(tabsText)) pass('Trợ lý (cs01): chỉ có tab Hỏi đáp, không có Giao việc/Soạn thảo');
    else fail('Trợ lý (cs01): hiện tab không đúng: ' + tabsText);
    const leaks = ['Tư tưởng', 'GHI CHÚ TƯ TƯỞNG CỦA AN', 'GHI CHÚ HOÀN CẢNH CỦA AN'].filter((t) => mine.includes(t));
    if (leaks.length === 0) pass('Hồ sơ của tôi (cs01): không có dữ liệu tư tưởng/hoàn cảnh khó khăn');
    else fail('Hồ sơ của tôi (cs01) lộ dữ liệu nhạy cảm: ' + leaks.join(', '));
  });

  await browser.close();
  await fake.close();
  await new Promise((r) => server.close(r));
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? 'KẾT QUẢ: CÓ LỖI' : 'KẾT QUẢ: TẤT CẢ ĐẠT');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
