// Công cụ phát triển (tùy chọn): chụp ảnh màn hình các trang chính vào screenshots/.
// Cần Playwright cài riêng (không nằm trong dependencies): npm i -D playwright (hoặc dùng bản có sẵn).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/server');
const { fillDemo, PASSWORD } = require('./demo-data');
const ExcelJS = require('exceljs');

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

  await session('admin', async (shot) => {
    await shot('02-admin-tai-khoan', '/admin/users');
    await shot('03-admin-don-vi', '/admin/units');
    await shot('04-admin-nhat-ky', '/admin/audit');
    await shot('05-admin-cai-dat-thoi-han', '/admin/settings');
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
    const leaks = ['Tư tưởng', 'GHI CHÚ TƯ TƯỞNG CỦA AN', 'GHI CHÚ HOÀN CẢNH CỦA AN'].filter((t) => mine.includes(t));
    if (leaks.length === 0) pass('Hồ sơ của tôi (cs01): không có dữ liệu tư tưởng/hoàn cảnh khó khăn');
    else fail('Hồ sơ của tôi (cs01) lộ dữ liệu nhạy cảm: ' + leaks.join(', '));
  });

  await browser.close();
  await new Promise((r) => server.close(r));
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? 'KẾT QUẢ: CÓ LỖI' : 'KẾT QUẢ: TẤT CẢ ĐẠT');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
