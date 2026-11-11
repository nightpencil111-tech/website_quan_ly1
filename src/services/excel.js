// Xuất Excel (exceljs). Trả về Buffer.
const ExcelJS = require('exceljs');
const { LABELS } = require('../util/text');
const { fmtDate } = require('../util/date');

const people = (t) => (t.assignees || []).map((a) => a.full_name + (a.active === 0 || a.active === false ? ' (đã khóa)' : '')).join(', ');

function sheet(wb, name, columns) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map(([header, width]) => ({ header, width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

const TASK_COLS = [['STT', 6], ['Tên công việc', 44], ['Lĩnh vực', 24], ['Người thực hiện', 32], ['Hạn', 12], ['Ưu tiên', 10], ['Trạng thái', 14], ['Tiến độ', 9]];
const taskRow = (t, i) => [
  i + 1, t.title, LABELS.category[t.category] || t.category, people(t), fmtDate(t.due_date),
  LABELS.priority[t.priority] || t.priority, LABELS.status[t.status] || t.status, `${t.progress ?? (t.status === 'hoan_thanh' ? 100 : 0)}%`,
];

async function toBuffer(wb) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function tasksWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = sheet(wb, 'Công việc', TASK_COLS);
  rows.forEach((t, i) => ws.addRow(taskRow(t, i)));
  return toBuffer(wb);
}

async function performanceWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = sheet(wb, 'Hiệu suất', [['STT', 6], ['Họ và tên', 30], ['Số việc giao', 14], ['Hoàn thành', 12], ['Đúng hạn', 12], ['Quá hạn', 10], ['Tỷ lệ đúng hạn', 16]]);
  rows.forEach((r, i) => ws.addRow([i + 1, r.full_name, r.assigned, r.completed, r.on_time, r.overdue, `${Math.round((r.rate || 0) * 100)}%`]));
  return toBuffer(wb);
}

async function reportWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Báo cáo');
  ws.getColumn(1).width = 120;
  report.text.split('\n').forEach((line, i) => {
    const row = ws.addRow([line]);
    row.alignment = { wrapText: true, vertical: 'top' };
    if (i === 0 || /^(I|II|III|IV)\. /.test(line)) row.font = { bold: true };
  });
  const ws2 = sheet(wb, 'Tồn tại', TASK_COLS);
  (report.sections.tonTai || []).forEach((t, i) => ws2.addRow(taskRow(t, i)));
  return toBuffer(wb);
}

module.exports = { tasksWorkbook, performanceWorkbook, reportWorkbook };
