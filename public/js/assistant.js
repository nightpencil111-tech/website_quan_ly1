(function () {
  var meta = document.querySelector('meta[name="csrf"]');
  var token = meta ? meta.content : '';
  var EXPIRED = 'Phiên làm việc đã hết hạn hoặc không hợp lệ, đồng chí tải lại trang và thử lại.';
  var ERR_TAIL = /\n\n\[Lỗi: ([^\]]*)\]$/;

  function postJson(url, obj, signal) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify(obj),
      signal: signal,
    });
  }

  function errorOf(res) {
    if (res.status === 403) return Promise.resolve(EXPIRED);
    return res.json().then(function (j) { return (j && j.error) || 'Yêu cầu không thực hiện được.'; })
      .catch(function () { return 'Yêu cầu không thực hiện được.'; });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy'));
    });
  }

  // Khung kết quả AI: [data-ai-panel] với các phần tử data-role = out, stop, copy, use, status.
  function Panel(root, onUse) {
    this.root = root;
    this.out = root.querySelector('[data-role="out"]');
    this.stop = root.querySelector('[data-role="stop"]');
    this.copy = root.querySelector('[data-role="copy"]');
    this.use = root.querySelector('[data-role="use"]');
    this.status = root.querySelector('[data-role="status"]');
    this.busy = false;
    this.ctrl = null;
    var self = this;
    this.stop.addEventListener('click', function () { if (self.ctrl) self.ctrl.abort(); });
    this.copy.addEventListener('click', function () {
      copyText(self.out.textContent).then(function () { self.say('Đã sao chép.'); },
        function () { self.say('Không sao chép được, đồng chí bôi đen và sao chép thủ công.'); });
    });
    this.use.addEventListener('click', function () { onUse(self.out.textContent); });
  }
  Panel.prototype.say = function (t) { this.status.textContent = t; };
  Panel.prototype.setDone = function (hasText) {
    this.stop.disabled = true;
    this.copy.disabled = !hasText;
    this.use.disabled = !hasText;
  };
  // Chạy một tác vụ; locks = các nút/ô cần khóa trong lúc chạy.
  Panel.prototype.run = function (payload, locks) {
    var self = this;
    if (self.busy) return Promise.resolve();
    self.busy = true;
    self.ctrl = new AbortController();
    self.root.hidden = false;
    self.out.textContent = '';
    self.say('Đang chạy, đồng chí chờ trong giây lát...');
    self.stop.disabled = false;
    self.copy.disabled = true;
    self.use.disabled = true;
    locks.forEach(function (el) { el.disabled = true; });
    var dec = new TextDecoder('utf-8');
    function finish() {
      var m = ERR_TAIL.exec(self.out.textContent);
      if (m) {
        self.out.textContent = self.out.textContent.replace(ERR_TAIL, '');
        self.say('Lỗi: ' + m[1]);
      }
      self.setDone(self.out.textContent.length > 0);
    }
    return postJson('/assistant/ai/run', payload, self.ctrl.signal).then(function (res) {
      if (!res.ok) {
        return errorOf(res).then(function (msg) { self.say('Lỗi: ' + msg); self.setDone(false); });
      }
      var reader = res.body.getReader();
      var pump = function () {
        return reader.read().then(function (r) {
          if (r.done) {
            var tail = dec.decode();
            if (tail) self.out.textContent += tail;
            if (!ERR_TAIL.test(self.out.textContent)) self.say('Xong. Đồng chí đọc lại trước khi dùng.');
            finish();
            return null;
          }
          self.out.textContent += dec.decode(r.value, { stream: true });
          return pump();
        });
      };
      return pump();
    }).catch(function (e) {
      if (e && e.name === 'AbortError') self.say('Đã dừng.');
      else self.say('Lỗi kết nối, đồng chí vui lòng thử lại.');
      self.setDone(self.out.textContent.length > 0);
    }).then(function () {
      self.busy = false;
      self.ctrl = null;
      locks.forEach(function (el) { el.disabled = false; });
    });
  };

  // Chèn dàn ý vào ô văn bản (hỏi trước khi ghi đè).
  function insertOutline(keySel, topicEl, target, btn, note) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      postJson('/assistant/outline', { key: keySel.value, topic: topicEl.value })
        .then(function (res) {
          if (!res.ok) return errorOf(res).then(function (m) { note(m); });
          return res.json().then(function (j) {
            if (target.value.trim() && !window.confirm('Ô đang có nội dung. Thay bằng dàn ý mới?')) return;
            target.value = j.text;
            note('');
          });
        })
        .catch(function () { note('Lỗi kết nối, đồng chí vui lòng thử lại.'); })
        .then(function () { btn.disabled = false; });
    });
  }

  // ---- Tab Soạn thảo ----
  var compose = document.getElementById('compose');
  if (compose) {
    var input = document.getElementById('ai-input');
    var olNote = document.createElement('span');
    olNote.className = 'muted';
    document.getElementById('ol-btn').after(olNote);
    insertOutline(document.getElementById('ol-key'), document.getElementById('ol-topic'), input,
      document.getElementById('ol-btn'), function (m) { olNote.textContent = m; });
    var panelEl = compose.querySelector('[data-ai-panel]');
    var runBtn = document.getElementById('ai-run');
    if (panelEl && runBtn) {
      var panel = new Panel(panelEl, function (text) {
        if (input.value.trim() && !window.confirm('Thay nội dung đang có bằng kết quả AI?')) return;
        input.value = text;
      });
      runBtn.addEventListener('click', function () {
        if (!input.value.trim()) { panel.root.hidden = false; panel.say('Đồng chí nhập nội dung trước.'); return; }
        panel.run({
          task: document.getElementById('ai-task').value,
          input: input.value,
          docType: document.getElementById('ai-doctype').value,
          extra: { trich_yeu: document.getElementById('ai-trichyeu').value },
        }, [runBtn]);
      });
    }
  }

  // ---- Form tạo văn bản ----
  document.querySelectorAll('.ai-bar').forEach(function (bar) {
    var form = bar.closest('form');
    var target = form.elements[bar.getAttribute('data-target')];
    if (!target) return;
    var docType = bar.getAttribute('data-doctype') || '';
    var note = bar.querySelector('[data-role="note"]');
    var say = function (m) { note.textContent = m; };
    insertOutline(bar.querySelector('[data-role="ol-key"]'), bar.querySelector('[data-role="ol-topic"]'), target,
      bar.querySelector('[data-role="ol-btn"]'), say);
    var panelEl2 = bar.querySelector('[data-ai-panel]');
    if (!panelEl2) return; // AI tắt
    var trich = function () {
      var el = form.elements['manual[trich_yeu]'];
      return el && typeof el.value === 'string' ? el.value.trim() : '';
    };
    var write = bar.querySelector('[data-role="write"]');
    var fix = bar.querySelector('[data-role="fix"]');
    var p = new Panel(panelEl2, function (text) {
      if (target.value.trim() && !window.confirm('Ô đang có nội dung. Ghi đè bằng kết quả AI?')) return;
      target.value = text;
    });
    write.addEventListener('click', function () {
      var brief = [trich(), target.value.trim()].filter(Boolean).join('\n');
      if (!brief) { p.root.hidden = false; p.say('Đồng chí nhập trích yếu hoặc dàn ý vào ô trước.'); return; }
      p.run({ task: 'viet_noi_dung', input: brief, docType: docType, extra: { trich_yeu: trich() } }, [write, fix]);
    });
    fix.addEventListener('change', function () {
      var task = fix.value;
      if (!task) return;
      fix.value = '';
      if (!target.value.trim()) { p.root.hidden = false; p.say('Ô đang trống, chưa có gì để sửa.'); return; }
      p.run({ task: task, input: target.value, docType: docType, extra: { trich_yeu: trich() } }, [write, fix]);
    });
  });
})();
