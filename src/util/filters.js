// Chuẩn hóa bộ lọc công việc từ query/body; dùng chung cho /tasks và /export/tasks.
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'string') {
      if (v.trim() !== '') out[k] = v;
    } else if (Array.isArray(v)) {
      if (v.length) out[k] = v;
    } else if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function parseFilters(query) {
  const q = clean(query);
  const f = {};
  for (const k of ['status', 'category', 'priority', 'q']) if (typeof q[k] === 'string') f[k] = q[k].trim();
  if (q.assignee_id && /^\d+$/.test(String(q.assignee_id))) f.assignee_id = Number(q.assignee_id);
  for (const k of ['done_from', 'done_to']) if (typeof q[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q[k].trim())) f[k] = q[k].trim();
  if (q.overdue === '1') f.overdue = true;
  return f;
}

// Member luôn bị giới hạn vào việc của chính mình.
function scopeFilters(user, query) {
  const f = parseFilters(query);
  if (user.role !== 'admin' && user.role !== 'manager') f.assignee_id = user.id;
  return f;
}

module.exports = { clean, parseFilters, scopeFilters };
