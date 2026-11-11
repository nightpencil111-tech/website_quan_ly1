(function () {
  var board = document.getElementById('kanban');
  if (!board) return;
  var msg = document.getElementById('kanban-msg');
  var csrf = (document.querySelector('meta[name="csrf"]') || {}).content || '';
  var dragged = null;
  var origin = null;

  function showError(text) {
    msg.textContent = text;
    msg.hidden = false;
  }

  function updateCounts() {
    board.querySelectorAll('.kanban-col').forEach(function (col) {
      col.querySelector('h2 .badge').textContent = col.querySelectorAll('.kanban-card').length;
    });
  }

  board.addEventListener('dragstart', function (e) {
    var card = e.target.closest && e.target.closest('.kanban-card');
    if (!card) return;
    dragged = card;
    origin = { list: card.parentNode, next: card.nextSibling };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
    card.classList.add('dragging');
  });
  board.addEventListener('dragend', function () {
    if (dragged) dragged.classList.remove('dragging');
    board.querySelectorAll('.kanban-col').forEach(function (c) { c.classList.remove('drop'); });
  });
  board.querySelectorAll('.kanban-col').forEach(function (col) {
    col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', function () { col.classList.remove('drop'); });
    col.addEventListener('drop', function (e) {
      e.preventDefault();
      col.classList.remove('drop');
      if (!dragged) return;
      var card = dragged;
      var list = col.querySelector('.kanban-list');
      if (list === origin.list) return;
      var from = origin.list.parentNode.dataset.status;
      var to = col.dataset.status;
      var note = '';
      if (from === 'cho_duyet' && to === 'dang_lam') {
        note = window.prompt('Nhập lý do trả lại công việc:');
        if (!note || !note.trim()) { showError('Phải nhập lý do khi trả lại công việc'); return; }
      }
      var back = origin;
      list.appendChild(card);
      updateCounts();
      msg.hidden = true;
      fetch('/tasks/' + card.dataset.id + '/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ status: to, note: note })
      }).then(function (r) {
        return r.json().catch(function () { return { ok: false, error: 'Phản hồi không hợp lệ từ máy chủ' }; });
      }).then(function (d) {
        if (!d.ok) throw new Error(d.error || 'Không thể chuyển trạng thái');
      }).catch(function (err) {
        back.list.insertBefore(card, back.next);
        updateCounts();
        showError(err.message || 'Không thể chuyển trạng thái');
      });
    });
  });
})();
