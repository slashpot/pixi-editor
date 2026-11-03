// diag branch only: a WebContainer control with no dependencies, to see whether
// StackBlitz itself crashes on iPad Safari when nothing from this project runs
import { createServer } from 'node:http';

const html = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<body style="margin:0;padding:24px;font:24px system-ui;background:#17121f;color:#fff">
  <h1>Control: plain Node server</h1>
  <p id="t">loading…</p>
  <script>
    let n = 0;
    setInterval(() => (document.getElementById('t').textContent = 'alive ' + ++n + 's'), 1000);
  </script>
</body>`;

createServer((req, res) => {
  console.log('[control]', req.method, req.url);
  res.setHeader('content-type', 'text/html');
  res.end(html);
}).listen(5173, () => console.log('[control] listening on http://localhost:5173'));
