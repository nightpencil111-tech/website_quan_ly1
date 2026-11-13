// Hành vi giao diện chung (thay cho thuộc tính onclick/onchange inline vì CSP).
(function () {
  // Nút thu gọn/mở menu trên điện thoại.
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.menu-toggle') : null;
    if (btn) document.body.classList.toggle('nav-open');
  });
  // <select data-autosubmit>: đổi lựa chọn thì gửi biểu mẫu ngay.
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el && el.hasAttribute && el.hasAttribute('data-autosubmit') && el.form) el.form.submit();
  });
})();
