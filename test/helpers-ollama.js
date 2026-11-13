// Máy Ollama giả cho kiểm thử: HTTP cục bộ, trả stream NDJSON như /api/chat thật.
const http = require('node:http');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// opts: models (tên mô hình cho /api/tags), chunks (các đoạn nội dung trả về), delayMs (nghỉ giữa các đoạn),
// hang (gửi header + các đoạn rồi treo, không bao giờ kết thúc), status (mã lỗi HTTP cho /api/chat),
// errorLine (chuỗi lỗi gửi thành dòng {"error": ...} sau các đoạn), redirect (trả 302 sang địa chỉ khác).
// Trả {url, requests, abortedByClient(), close()}; close() hủy cả các kết nối đang mở.
async function startFakeOllama(opts = {}) {
  const {
    models = ['qwen2.5:3b'], chunks = [], delayMs = 0, hang = false, status = 200, errorLine = null, redirect = null,
  } = opts;
  const requests = [];
  const sockets = new Set();
  let abortedByClient = 0; // số yêu cầu /api/chat bị phía gọi đóng trước khi trả xong

  const server = http.createServer(async (req, res) => {
    const body = await new Promise((resolve) => {
      const parts = [];
      req.on('data', (c) => parts.push(c));
      req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    });
    requests.push({ method: req.method, path: req.url, headers: req.headers, raw: body, body: body ? JSON.parse(body) : null });

    if (redirect) {
      res.writeHead(302, { location: redirect });
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ models: models.map((name) => ({ name, model: name })) }));
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      if (status !== 200) {
        res.writeHead(status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: `lỗi giả ${status}` }));
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      res.on('close', () => { if (!res.writableFinished) abortedByClient += 1; });
      try {
        for (const c of chunks) {
          if (res.destroyed) return;
          const line = Buffer.from(JSON.stringify({ model: 'gia', message: { role: 'assistant', content: c }, done: false }) + '\n');
          // Gửi mỗi dòng thành hai mảnh (cắt theo byte) để thử ghép dòng/ký tự UTF-8 bị cắt đôi.
          const cut = Math.floor(line.length / 2);
          res.write(line.subarray(0, cut));
          await wait(5);
          res.write(line.subarray(cut));
          if (delayMs) await wait(delayMs);
        }
        if (hang) return; // treo: không kết thúc
        if (errorLine) res.write(JSON.stringify({ error: errorLine }) + '\n');
        else res.write(JSON.stringify({ model: 'gia', message: { role: 'assistant', content: '' }, done: true }) + '\n');
        res.end();
      } catch { /* client đã ngắt */ }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    requests,
    abortedByClient: () => abortedByClient,
    close: () => new Promise((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    }),
  };
}

module.exports = { startFakeOllama };
