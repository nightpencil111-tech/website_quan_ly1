const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const excel = require('../src/services/excel');

const load = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
};
const HEAD = ['STT', 'Tên công việc', 'Lĩnh vực', 'Người thực hiện', 'Hạn', 'Ưu tiên', 'Trạng thái', 'Tiến độ'];

test('tasksWorkbook rỗng: chỉ có dòng tiêu đề', async () => {
  const wb = await load(await excel.tasksWorkbook([]));
  const ws = wb.worksheets[0];
  assert.equal(ws.rowCount, 1);
  assert.deepEqual(ws.getRow(1).values.slice(1), HEAD);
  assert.equal(ws.getRow(1).font.bold, true);
  assert.ok(ws.getColumn(2).width > 20);
});

test('tasksWorkbook: giữ nguyên dấu tiếng Việt, ngày dd/mm/yyyy, nối người', async () => {
  const rows = [{
    title: 'Tổ chức kỷ niệm 22/12', category: 'cong_tac_dang', priority: 'hoa_toc', status: 'dang_lam', due_date: '2026-12-22',
    progress: 50, assignees: [{ full_name: 'Nguyễn Văn Đức' }, { full_name: 'Trần Thị Hạnh', active: 0 }],
  }];
  const ws = (await load(await excel.tasksWorkbook(rows))).worksheets[0];
  assert.deepEqual(ws.getRow(2).values.slice(1), [
    1, 'Tổ chức kỷ niệm 22/12', 'Công tác Đảng', 'Nguyễn Văn Đức, Trần Thị Hạnh (đã khóa)', '22/12/2026', 'Hỏa tốc', 'Đang làm', '50%',
  ]);
});

test('performanceWorkbook', async () => {
  const ws = (await load(await excel.performanceWorkbook([
    { full_name: 'Lê Văn Ánh', assigned: 4, completed: 3, on_time: 2, overdue: 1, rate: 0.5 },
  ]))).worksheets[0];
  assert.equal(ws.getRow(1).values[2], 'Họ và tên');
  assert.equal(ws.getRow(2).values[2], 'Lê Văn Ánh');
  assert.equal(ws.getRow(2).values[7], '50%');
});

test('reportWorkbook: văn bản + sheet tồn tại', async () => {
  const report = {
    from: '2026-11-09', to: '2026-11-15', text: 'BÁO CÁO\n(Từ ngày)\nI. TÌNH HÌNH CHUNG',
    sections: { tonTai: [{ title: 'Việc trễ', category: 'khac', due_date: '2026-11-01', assignees: [{ full_name: 'A' }], status: 'chua_lam', priority: 'thuong', progress: 0 }] },
  };
  const wb = await load(await excel.reportWorkbook(report));
  assert.equal(wb.worksheets.length, 2);
  assert.equal(wb.worksheets[0].getRow(3).values[1], 'I. TÌNH HÌNH CHUNG');
  assert.equal(wb.worksheets[1].getRow(2).values[2], 'Việc trễ');
});
