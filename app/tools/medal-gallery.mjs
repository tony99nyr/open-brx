// The medal icon gallery (Tony 2026-09-25): style B (the roundel), Tony's pick, day and night at 24, 32 and 48 px; the
// multi-kill escalation strip; the round 3 "pick one" options for BEAT DOWN, which draws a placeholder initial until
// he picks (IRON MAN is picked); and the real HUD's recap (AWARDS and PLAYERS tabs) with the icons in.
// It asserts nothing (app/tools/screens.mjs is the gate). Run from app/ after `npm run build`:
//   node tools/medal-gallery.mjs [out-dir]
// The default out-dir is C:\Users\Tony\brx-medals (WSL: /mnt/c/Users/Tony/brx-medals). Nothing here goes in the repo.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'node:url';
import { medalIcon, roundelIcon, MEDAL_PALETTE } from '../src/hud/medalicons.js';
import { MEDALS, AWARDS } from '../src/transport/contract.gen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const OUT = path.resolve(process.argv[2] || '/mnt/c/Users/Tony/brx-medals');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^mock-.*\.png$/.test(f)) fs.rmSync(path.join(OUT, f));   // no stale style A/C mocks
if (!fs.existsSync(path.join(WWW, 'app.js'))) throw new Error('www/app.js is missing: run `npm run build` first');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const LABEL = Object.fromEntries([...MEDALS.map(m => [m.key, m.label]), ...AWARDS.map(a => [a.key, a.label])]);
const MEDAL_KEYS = MEDALS.map(m => m.key), AWARD_KEYS = AWARDS.map(a => a.key);
const LADDER = MEDALS.filter(m => m.kind === 'multi').map(m => m.key);
const SKINS = ['day', 'night'], SIZES = [24, 32, 48];
const icon = (k, skin, size) => medalIcon(k, { night: skin === 'night', size, label: LABEL[k] });

// ---- the fresh options for the two icons Tony called weak. ORIGINAL designs, drawn in the same 32-unit box. ----
// Beat Down, round 3 (Tony 2026-09-25): "B3c is closest but still looks weird. maybe try a different kind of fist or
// glove?" Four new directions, with B3c (from round 2) beside them as the reference. ORIGINAL designs.
const GLOVE = 'M10.6 17.6V11.2c0-3.6 2.6-5.8 6.2-5.8 3.9 0 6.6 2.6 6.6 6.4v4.9c0 2.1-1.3 3.6-3.4 3.9h-7.6c-1.1 0-1.8-.8-1.8-1.9z';
const B3C = (c, a, gap) => `<g transform="rotate(62 16 16)"><path d="${GLOVE}" fill="${c}"/>`
  + `<path d="M12.4 11.8c2.6 1.3 6.9 1.3 9.6-.4" fill="none" stroke="${gap}" stroke-width="1.4" stroke-linecap="round"/>`
  + `<path d="M11.2 13c-2.2 0-3.3 1.4-3.3 2.9 0 1.9 1.5 3.3 3.8 3.3h3c1 0 1.7-.7 1.7-1.6s-.7-1.6-1.7-1.6h-2.2z" fill="${c}" stroke="${gap}" stroke-width="1.5" paint-order="stroke"/>`
  + `<rect x="11.6" y="21" width="10.6" height="5.4" rx="1.1" fill="${a}"/><path d="M14.6 21.8l4.6 3.8M19.2 21.8l-4.6 3.8" stroke="${gap}" stroke-width="1.3" stroke-linecap="round"/></g>`;
// A clenched fist seen from the front: four knuckles across the top, the thumb folded across under them, the wrist below.
const FINGERS = [8.4, 12.2, 16, 19.8];
const fist = (c, a, gap, { tips = 'solid', band = true } = {}) =>
  `<rect x="8.6" y="12" width="14.8" height="9.4" rx="2.4" fill="${c}"/>`
  + FINGERS.map(x => tips === 'open'
    ? `<rect x="${x + 0.5}" y="7.6" width="2.8" height="6" rx="1.4" fill="none" stroke="${c}" stroke-width="1.4"/>`
    : `<rect x="${x}" y="7" width="3.8" height="8.6" rx="1.9" fill="${c}" stroke="${gap}" stroke-width="1.1" paint-order="stroke"/>`).join('')
  + `<rect x="8" y="15.4" width="11.4" height="3.8" rx="1.9" fill="${c}" stroke="${gap}" stroke-width="1.5" paint-order="stroke"/>`
  + `<path d="M11 21.4h10v4.2H11z" fill="${c}"/>` + (band ? `<rect x="10.6" y="22" width="10.8" height="2" rx=".6" fill="${a}"/>` : '');
const PICK = {
  melee_kill: { title: 'Beat Down, round 3: pick one', opts: [
    ['B3c · Glove, mid-punch (round 2, the reference)', 'the laced glove turned side-on: closest so far, but it reads oddly', B3C],
    ['B4 · Bare fist', 'a clenched fist from the front: four knuckles, the thumb folded across, an amber wrist wrap', (c, a, gap) => fist(c, a, gap)],
    ['B5 · Gauntlet', 'an armoured fist: a knuckle plate, a finger plate and a flared cuff, with bolts', (c, a, gap) =>
      `<path d="M9 10.2 11.8 7h8.4l2.8 3.2v3.2H9z" fill="${c}"/>` + [12.2, 16, 19.8].map(x => `<circle cx="${x}" cy="10.4" r="1.1" fill="${gap}"/>`).join('')
      + `<path d="M9 14.6h14v3.6l-2 1.8H11l-2-1.8z" fill="${c}"/><path d="M10.8 21.2h10.4l2 4.8H8.8z" fill="${c}"/><rect x="10.8" y="21.2" width="10.4" height="1.3" fill="${a}"/>`],
    ['B6 · Fist and impact', 'the bare fist, smaller, with an amber impact burst at its knuckles', (c, a, gap) =>
      `<g transform="translate(-2.2 2.4) scale(.84) translate(3 3)">${fist(c, a, gap, { band: false })}</g>`
      + `<path d="M21.6 8.6l2.4-2.6M23.2 11.4l3.2-.8M19.6 7.2l.4-3.2" stroke="${a}" stroke-width="1.8" stroke-linecap="round"/>`],
    ['B7 · Fingerless glove', 'a tactical glove on a fist: bare fingertips drawn open, the padded glove below, an amber strap', (c, a, gap) => fist(c, a, gap, { tips: 'open' })],
  ] },
};

// ---- the recap on the real HUD, as it ships (the icons are wired in; nothing is patched) ----
const TYPES = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => { const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { const b = fs.readFileSync(path.join(WWW, decodeURIComponent(rel))); res.setHeader('content-type', TYPES[path.extname(rel)] || 'application/octet-stream'); res.end(b); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const VIEWS = [{ name: 'pixel', width: 891, height: 411 }, { name: 'se', width: 667, height: 375 }];   // = screens.mjs VIEWS
const MOCKS = [
  { what: 'awards', stage: 'result-awards', wait: '.result .aw', label: 'End of match, AWARDS tab: your awards as big icons, then one icon per award with its holder and the number that earned it. The name is on a long press and in the legend.' },
  { what: 'players', stage: 'result-players', wait: '.result .lbr', label: 'End of match, PLAYERS tab: the MEDALS column as icons (×N when earned more than once), with a legend under the board.' },
];
const b = await chromium.launch();
const shots = [];
for (const m of MOCKS) for (const view of VIEWS) for (const skin of SKINS) {
  const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=${m.stage}${skin === 'night' ? '&night' : ''}`);
  await pg.waitForSelector(m.wait, { timeout: 20000 }); await pg.waitForTimeout(400);
  const f = `mock-${m.what}-${view.name}-${skin}.png`;
  await pg.screenshot({ path: path.join(OUT, f) });
  if (errs.length) throw new Error(`${m.what} ${view.name} ${skin}: ${errs.join(' | ')}`);
  shots.push({ ...m, view, skin, f }); console.log('mock', m.what, view.name, skin);
  await pg.close();
}
await b.close(); srv.close();

// ---- the page ----
const cell = (k, skin) => `<div class="cell"><div class="row">${SIZES.map(s => icon(k, skin, s)).join('')}</div><div class="k">${esc(LABEL[k] || k)}<small>${esc(k)}${k === 'melee_kill' ? ' · placeholder' : ''}</small></div></div>`;
const grid = (keys, skin) => `<div class="grid">${keys.map(k => cell(k, skin)).join('')}</div>`;
const pick = key => { const p = PICK[key];
  return `<div class="pick"><h3>${esc(p.title)}</h3><div class="opts">${p.opts.map(([name, what, g]) => `<div class="opt"><b>${esc(name)}</b><span>${esc(what)}</span>
    ${SKINS.map(skin => `<div class="plate ${skin} row">${SIZES.map(s => roundelIcon(g, { key, night: skin === 'night', size: s, label: name })).join('')}</div>`).join('')}</div>`).join('')}</div></div>`; };
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Medal Icons</title><style>
body{margin:0;background:#0b0f16;color:#dfe8ef;font:14px/1.45 system-ui,sans-serif;padding:16px}
header{max-width:1100px}h1{font-size:22px;margin:0 0 6px}h2{font-size:17px;margin:28px 0 8px;color:#fff}h3{margin:0 0 6px;font-size:15px}h4{margin:14px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8aa}
.q{font-size:20px;font-weight:700;color:#ffc53d;margin:10px 0}.legal{color:#9ab;font-size:13px}
.plate{border-radius:10px;padding:14px;margin:10px 0}.plate.day{background:${MEDAL_PALETTE.day.bg}}.plate.night{background:${MEDAL_PALETTE.night.bg};color:#d65454}.plate.night h4{color:#cc4e4e}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.cell{display:flex;flex-direction:column;gap:4px}.row{display:flex;align-items:flex-end;gap:8px}.k{font-size:11px;line-height:1.2}.k small{display:block;opacity:.6}
.strip{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap}.strip div{display:flex;flex-direction:column;align-items:center;font-size:11px}
.pick{border:1px solid #ffc53d55;border-radius:10px;padding:12px;margin:10px 0}.opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.opt{display:flex;flex-direction:column;gap:2px}.opt span{font-size:12px;opacity:.8}.opt .plate{margin:4px 0;padding:10px}
figure{margin:10px 0}figure img{max-width:100%;height:auto;border:1px solid #223;border-radius:6px}figcaption{font-size:12px;opacity:.85}
</style></head><body><header>
<h1>Open BRX medal and award icons: style B (roundel)</h1>
<p class="legal">Original designs, not Halo's art. No shape, layout or colour scheme is copied from Bungie's medals. Every icon is inline SVG with no fonts or external files.</p>
<p>Only the recap uses the icons: the phone's AWARDS and PLAYERS tabs, and Mission Control's recap (with its words kept beside them). The in-game kill card and alerts keep their words.</p>
<p class="q">IRON MAN is picked (I2b, the bevelled iron heart). Pick one BEAT DOWN (for example "B5"). Until then it draws a placeholder initial.</p></header>
<section id="pick"><h2>Pick one</h2>${pick('melee_kill')}</section>
<section id="set"><h2>The set</h2>
${SKINS.map(skin => `<div class="plate ${skin}"><h3>${skin === 'day' ? 'Day' : 'Night (red and amber only, on #120505)'}</h3>
  <h4>Escalation strip: double kill to killionaire</h4>
  <div class="strip">${LADDER.map(k => `<div>${icon(k, skin, 48)}<span>${MEDALS.find(x => x.key === k).count}</span></div>`).join('')}</div>
  <h4>Medals at 24, 32 and 48 px</h4>${grid(MEDAL_KEYS, skin)}
  <h4>End-of-match awards</h4>${grid(AWARD_KEYS, skin)}
  <h4>Unknown key (the fallback)</h4>${grid(['some_new_key'], skin)}</div>`).join('')}</section>
<section id="recap"><h2>The phone's recap, rendered by the real HUD</h2>
${shots.map(s => `<figure><img src="${s.f}" width="${s.view.width}" height="${s.view.height}" loading="lazy" alt=""><figcaption>${esc(s.view.name)} · ${esc(s.skin)} · ${esc(s.label)}</figcaption></figure>`).join('')}</section>
</body></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('wrote', path.join(OUT, 'index.html'), `(${shots.length} mocks)`);
