// Tiny static server for webapp/ (mirrors Cloudflare assets: directory index, .md as text/markdown).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(process.env.SITE_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'webapp'));
const PORT = Number(process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml', '.apk': 'application/vnd.android.package-archive' };
// Mirror Cloudflare's _redirects so the gate exercises real redirect behaviour, not the file's text.
// Without this the suite passed while seven live pages sat in an infinite loop in production.
// Read PER REQUEST, not once at module load: playwright starts this server before globalSetup runs
// the build, so a cached copy served the PREVIOUS build's rules and the guard missed its own bug.
const readRedirects = () => {
  const f = path.join(ROOT, '_redirects');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => { const [from, to, code] = l.split(/\s+/); return { from, to, code: Number(code) || 302 }; })
    // Cloudflare ignores a malformed line; emitting `Location: undefined` would be worse than none.
    // NB: this mirror handles only literal paths and a trailing /*. No :placeholders, no :splat
    // substitution, no 200-rewrites. _redirects here is a frozen all-static file, but a rule using
    // any of those would silently never match rather than fail loudly.
    .filter(r => r.from && r.to && r.from.startsWith('/') && r.to.startsWith('/'));
};
const redirectFor = p => {
  for (const r of readRedirects()) {
    if (r.from.endsWith('/*')) { const base = r.from.slice(0, -2); if (p === base || p.startsWith(base + '/')) return r; }
    else if (r.from === p) return r;
  }
  return null;
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.includes('..')) { res.writeHead(400); return res.end(); }
  const rd = redirectFor(p);
  if (rd) { res.writeHead(rd.code, { Location: rd.to }); return res.end(); }
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
