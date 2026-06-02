// Tiny static dev server for Groove Galaxy.
// Sends `Cache-Control: no-store` so the browser never serves stale code/assets —
// essential for a service-worker app (plain `python -m http.server` caches forever).
//   node tools/serve.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const ROOT = process.cwd();
const PORT = +(process.argv[2] || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.vrm': 'application/octet-stream', '.vrma': 'application/octet-stream', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = normalize(join(ROOT, p));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('404 Not Found');
  }
});
server.listen(PORT, () => console.log(`Groove Galaxy dev server → http://127.0.0.1:${PORT}/  (no-store)`));
