// Báo cáo: nút "Sao chép" nội dung báo cáo.
(function () {
  var btn = document.getElementById('copy-btn'), ta = document.getElementById('report-text'), msg = document.getElementById('copy-msg');
  if (!btn || !ta || !msg) return;
  function done(ok) { msg.textContent = ok ? 'Đã sao chép báo cáo.' : 'Không sao chép được, đồng chí hãy bôi đen và sao chép thủ công.'; }
  function fallback() {
    ta.focus(); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    done(ok);
  }
  btn.addEventListener('click', function () {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(ta.value).then(function () { done(true); }, fallback);
    else fallback();
  });
})();
