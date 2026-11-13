// Ô "chọn tất cả" (#check-all) bật/tắt mọi ô .pick.
(function () {
  var all = document.getElementById('check-all');
  if (!all) return;
  all.addEventListener('change', function () {
    document.querySelectorAll('.pick').forEach(function (c) { c.checked = all.checked; });
  });
})();
