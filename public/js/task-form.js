// Gợi ý người thực hiện và cảnh báo quá tải trên form giao việc. Không dùng innerHTML với dữ liệu người dùng.
(function () {
  var form = document.getElementById('task-form');
  var box = document.getElementById('suggest-box');
  if (!form || !box) return;
  var cat = form.elements.category;
  var due = form.elements.due_date;
  var overloaded = {};
  var seq = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function checkbox(id) {
    var boxes = form.querySelectorAll('input[name="assignee_ids"]');
    for (var i = 0; i < boxes.length; i++) if (boxes[i].value === String(id)) return boxes[i];
    return null;
  }

  function refreshWarnings() {
    var old = form.querySelectorAll('.overload-warning');
    for (var i = 0; i < old.length; i++) old[i].remove();
    Object.keys(overloaded).forEach(function (id) {
      var cb = checkbox(id);
      if (cb && cb.checked) {
        var w = el('span', 'overload-warning', ' Cảnh báo: người này đang quá tải');
        w.style.cssText = 'background:#fff3cd;color:#664d03;border:1px solid #ffda6a;padding:1px 6px;margin-left:6px;border-radius:4px;font-size:.85em';
        cb.parentNode.appendChild(w);
      }
    });
  }

  function setOverloaded(ids) {
    overloaded = {};
    (ids || []).forEach(function (id) { overloaded[id] = true; });
  }

  function render(list) {
    box.textContent = '';
    if (!list.length) { refreshWarnings(); return; }
    box.appendChild(el('div', 'muted', 'Gợi ý người thực hiện (bấm để chọn):'));
    var wrap = el('div', 'suggest-cards');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:6px 0';
    list.forEach(function (s) {
      var card = el('button', 'suggest-card');
      card.type = 'button';
      card.style.cssText = 'text-align:left;border:1px solid #9aa88a;border-radius:6px;background:#f4f7ef;padding:6px 10px;cursor:pointer';
      card.appendChild(el('strong', '', '#' + s.rank + ' ' + s.full_name + ' · ' + s.score));
      card.appendChild(el('div', 'muted', s.reasons.join(' · ')));
      if (s.overloaded) card.appendChild(el('div', '', 'Đang quá tải')).style.color = '#664d03';
      card.addEventListener('click', function () {
        var cb = checkbox(s.user_id);
        if (cb) { cb.checked = true; refreshWarnings(); }
      });
      wrap.appendChild(card);
    });
    box.appendChild(wrap);
    refreshWarnings();
  }

  function load() {
    var mine = ++seq;
    var url = '/api/suggest?category=' + encodeURIComponent(cat.value) + '&due_date=' + encodeURIComponent(due.value || '');
    fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { suggestions: [] }; })
      .then(function (j) { if (mine === seq) { setOverloaded(j.overloaded_ids); render(j.suggestions || []); } })
      .catch(function () { if (mine === seq) { setOverloaded([]); box.textContent = ''; refreshWarnings(); } });
  }

  cat.addEventListener('change', load);
  due.addEventListener('change', load);
  form.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'assignee_ids') refreshWarnings();
  });
  load();
})();
