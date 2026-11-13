// Xác nhận trước khi thực hiện thao tác (thay cho onsubmit="return confirm(...)" vì CSP chặn script inline).
// Dùng: <form data-confirm="Xóa công việc này?"> hoặc <button data-confirm="..."> / <a data-confirm="...">.
(function () {
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.getAttribute) return;
    var msg = form.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('button[data-confirm], a[data-confirm], input[type="submit"][data-confirm]') : null;
    if (!el) return;
    if (!window.confirm(el.getAttribute('data-confirm'))) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
})();
