// Cài đặt Trợ lý AI: nút "Kiểm tra kết nối".
(function () {
  var btn = document.getElementById('ai-check');
  var out = document.getElementById('ai-check-out');
  if (!btn || !out) return;
  var meta = document.querySelector('meta[name="csrf"]');
  btn.addEventListener('click', function () {
    btn.disabled = true;
    out.textContent = 'Đang kiểm tra (đồng chí lưu cài đặt trước nếu vừa sửa)...';
    fetch('/admin/settings/ai/check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': meta ? meta.content : '' }, body: '{}' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) out.textContent = 'Kết nối được. Mô hình trên máy AI: ' + (j.models.join(', ') || '(chưa có)') + (j.hasModel ? '' : ' — chưa có mô hình đã cài đặt ở trên.');
        else out.textContent = 'Lỗi: ' + (j.error || 'không rõ');
      })
      .catch(function () { out.textContent = 'Lỗi kết nối hoặc phiên hết hạn, đồng chí tải lại trang.'; })
      .then(function () { btn.disabled = false; });
  });
})();
