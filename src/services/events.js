const { AppError } = require('../util/errors');
const { today: vnToday, addDays, weekday } = require('../util/date');
const audit = require('./audit');
const tasks = require('./tasks');

const EVENT_TYPES = {
  sinh_hoat_chi_bo: 'Sinh hoạt chi bộ',
  hoc_chinh_tri: 'Học chính trị',
  ngay_le: 'Ngày lễ – kỷ niệm',
  hoi_nghi: 'Hội nghị',
  khac: 'Khác',
};

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validate(f) {
  const title = String(f.title ?? '').trim();
  if (!title) throw new AppError('Tiêu đề sự kiện không được để trống');
  const start = String(f.start_date ?? '').trim();
  if (!validDate(start)) throw new AppError('Ngày bắt đầu không hợp lệ');
  const endRaw = String(f.end_date ?? '').trim();
  const end = endRaw || start;
  if (!validDate(end)) throw new AppError('Ngày kết thúc không hợp lệ');
  if (end < start) throw new AppError('Ngày kết thúc không được trước ngày bắt đầu');
  const type = f.type ? String(f.type) : 'khac';
  if (!Object.hasOwn(EVENT_TYPES, type)) throw new AppError('Loại sự kiện không hợp lệ');
  const description = String(f.description ?? '').trim() || null;
  return { title, start, end, type, description };
}

function createEvent(db, data, actorId) {
  const v = validate(data);
  const id = Number(db.prepare(
    'INSERT INTO events (title, description, start_date, end_date, type, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(v.title, v.description, v.start, v.end, v.type, actorId ?? null).lastInsertRowid);
  audit.log(db, actorId, 'event_create', `event:${id}`, v.title);
  return id;
}

function getEvent(db, id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) || null;
}

function updateEvent(db, id, data, actorId) {
  if (!getEvent(db, id)) throw new AppError('Không tìm thấy sự kiện');
  const v = validate(data);
  db.prepare('UPDATE events SET title = ?, description = ?, start_date = ?, end_date = ?, type = ? WHERE id = ?')
    .run(v.title, v.description, v.start, v.end, v.type, id);
  audit.log(db, actorId, 'event_update', `event:${id}`, v.title);
}

function deleteEvent(db, id, actorId) {
  const e = getEvent(db, id);
  if (!e) throw new AppError('Không tìm thấy sự kiện');
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  audit.log(db, actorId, 'event_delete', `event:${id}`, e.title);
}

function pad(n) { return String(n).padStart(2, '0'); }

// Lưới tháng: từ Thứ Hai trước/bằng ngày 1 đến Chủ nhật sau/bằng ngày cuối.
function monthView(db, year, month, user, today = vnToday()) {
  const first = `${year}-${pad(month)}-01`;
  const last = addDays(`${month === 12 ? year + 1 : year}-${pad(month === 12 ? 1 : month + 1)}-01`, -1);
  const gridStart = addDays(first, -(weekday(first) - 1));
  const gridEnd = addDays(last, 7 - weekday(last));

  const events = db.prepare(
    'SELECT * FROM events WHERE start_date <= ? AND COALESCE(end_date, start_date) >= ? ORDER BY start_date, id'
  ).all(gridEnd, gridStart);
  const filters = { from: gridStart, to: gridEnd };
  if (user && user.role === 'member') filters.assignee_id = user.id;
  const taskRows = tasks.listTasks(db, filters, today);

  const weeks = [];
  let d = gridStart;
  while (d <= gridEnd) {
    const week = [];
    for (let i = 0; i < 7; i++, d = addDays(d, 1)) {
      week.push({
        date: d,
        inMonth: d >= first && d <= last,
        isToday: d === today,
        events: events.filter((e) => e.start_date <= d && (e.end_date || e.start_date) >= d),
        tasks: taskRows.filter((t) => t.due_date === d),
      });
    }
    weeks.push(week);
  }
  return { year, month, weeks };
}

module.exports = { EVENT_TYPES, createEvent, getEvent, updateEvent, deleteEvent, monthView };
