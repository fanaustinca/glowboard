// Tiny static file server for local use and the UI tests:  node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
export function serve(port = 0) {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      const file = path === '/' ? '/index.html' : path;
      try { const buf = await readFile(join(root, file)); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(buf); }
      catch { res.writeHead(404); res.end('not found'); }
    }).listen(port, '127.0.0.1', () => resolve(srv));
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const s = await serve(+process.argv[2] || 8080); console.log('http://127.0.0.1:' + s.address().port); }
