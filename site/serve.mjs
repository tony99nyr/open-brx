// Tiny static server for webapp/ (mirrors Cloudflare assets: directory index, .md as text/markdown).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(process.env.SITE_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'webapp'));
const PORT = Number(process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml', '.apk': 'application/vnd.android.package-archive' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.includes('..')) { res.writeHead(400); return res.end(); }
  let f = path.join(ROOT, p);
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) { if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }); return res.end(); } f = path.join(f, 'index.html'); }
  if (!fs.existsSync(f)) { // mirror Cloudflare's not_found_handling = 404-page
    const nf = path.join(ROOT, '404.html');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'x-site-root': ROOT });
    return res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : '<h1>404</h1>');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-site-root': ROOT });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
