(function () {
  var MAX = 5 * 1024 * 1024;
  var input = document.getElementById('doc-file');
  var btn = document.getElementById('doc-btn');
  var msg = document.getElementById('doc-msg');
  if (!input || !btn || !msg) return;
  var url = btn.getAttribute('data-url');
  function show(t, err) { msg.textContent = t; msg.className = err ? 'error' : 'muted'; }
  btn.addEventListener('click', function () {
    var f = input.files && input.files[0];
    if (!f) return show('Đồng chí chưa chọn tệp.', true);
    if (!/\.docx$/i.test(f.name)) return show('Chỉ nhận tệp Word .docx.', true);
    if (f.size > MAX) return show('Tệp quá lớn, dung lượng tối đa 5MB.', true);
    btn.disabled = true;
    show('Đang tải lên...', false);
    var reader = new FileReader();
    reader.onerror = function () { btn.disabled = false; show('Không đọc được tệp.', true); };
    reader.onload = function () {
      var data = String(reader.result).replace(/^data:[^,]*,/, '');
      var meta = document.querySelector('meta[name="csrf"]');
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': meta ? meta.content : '' },
        body: JSON.stringify({ fileName: f.name, data: data }),
      }).then(function (res) {
        return res.json().catch(function () { return { ok: false, error: 'Phản hồi không hợp lệ' }; });
      }).then(function (j) {
        if (j.ok && j.redirect) { window.location.href = j.redirect; return; }
        btn.disabled = false;
        show(j.error || 'Không tải lên được tệp.', true);
      }).catch(function () { btn.disabled = false; show('Lỗi kết nối, đồng chí vui lòng thử lại.', true); });
    };
    reader.readAsDataURL(f);
  });
})();
