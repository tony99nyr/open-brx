// The STAGE harness: the real HUD (www/) in a phone-sized frame, with a sidebar that jumps it to any
// screen state (`?demo&stage=<state>`, src/demo.js) and an event panel that forces in-game events —
// fire, hit, death, respawn, kill confirm, gun drop, MC loss, end, panic — by hand. For visual review
// and design feedback, no hardware, no server.   Run: npm run ui:stage   → http://localhost:4190/
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const PORT = +process.env.PORT || 4190;
const TYPES = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = rel === '/' || rel === '/stage' ? path.join(HERE, 'stage.html') : path.join(WWW, rel === '/hud' || rel === '/hud/' ? 'index.html' : rel.replace(/^\/hud\//, ''));
  try { const b = fs.readFileSync(file); res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream'); res.setHeader('cache-control', 'no-store'); res.end(b); }
  catch { res.statusCode = 404; res.end('not found: ' + rel); }
}).listen(PORT, () => console.log(`STAGE harness → http://localhost:${PORT}/   (HUD alone: http://localhost:${PORT}/hud/?demo&stage=live)`));
