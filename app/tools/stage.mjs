// The STAGE harness: the real HUD (www/) in a phone-sized frame, with a sidebar that jumps it to any
// screen state (`?demo&stage=<state>`, src/demo.js) and an event panel that forces in-game events —
// fire, hit, death, respawn, kill confirm, gun drop, MC loss, end, panic — by hand. For visual review
// and design feedback, no hardware, no server.   Run: npm run ui:stage   → http://localhost:4190/
import path from 'path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const PORT = +process.env.PORT || 4190;
await startStaticServer(WWW, { port: PORT, decodePath: true, headers: { 'cache-control': 'no-store' },
  missingBody: pathname => 'not found: ' + pathname,
  types: { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json',
    '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.woff2': 'font/woff2' },
  handler: ({ pathname, serve }) => {
    if (pathname === '/' || pathname === '/stage') serve('stage.html', { root: HERE });
    else if (pathname === '/hud' || pathname === '/hud/') serve('index.html');
    else if (pathname.startsWith('/hud/')) serve(pathname.slice(5));
    else return false;
    return true;
  },
});
console.log(`STAGE harness → http://localhost:${PORT}/   (HUD alone: http://localhost:${PORT}/hud/?demo&stage=live)`);
