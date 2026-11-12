(function () {
  var body = document.getElementById('mf-body');
  var add = document.getElementById('mf-add');
  if (!body || !add) return;
  function cell(node) { var td = document.createElement('td'); td.appendChild(node); return td; }
  function input(name, ph) {
    var i = document.createElement('input');
    i.type = 'text'; i.name = name; i.placeholder = ph || ''; i.maxLength = 120;
    return i;
  }
  function select(name, opts) {
    var s = document.createElement('select');
    s.name = name;
    opts.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1]; s.appendChild(op);
    });
    return s;
  }
  function removeBtn() {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-danger'; b.textContent = 'Xóa dòng';
    return b;
  }
  add.addEventListener('click', function () {
    var tr = document.createElement('tr');
    tr.appendChild(cell(input('mf_code[]', 'vd: ghi_chu')));
    tr.appendChild(cell(input('mf_label[]', 'Nhãn hiển thị')));
    tr.appendChild(cell(select('mf_type[]', [['text', 'Một dòng'], ['textarea', 'Nhiều dòng'], ['date', 'Ngày']])));
    tr.appendChild(cell(select('mf_required[]', [['0', 'Không'], ['1', 'Có']])));
    tr.appendChild(cell(removeBtn()));
    body.appendChild(tr);
  });
  body.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.tagName === 'BUTTON' && t.parentNode && t.parentNode.parentNode) {
      var tr = t.parentNode.parentNode;
      tr.parentNode.removeChild(tr);
    }
  });
})();
