// The medal icon gallery (Tony 2026-09-25): style B (the roundel), Tony's pick, day and night at 24, 32 and 48 px; the
// multi-kill escalation strip; the "pick one" options for the two icons he asked to redo (BEAT DOWN and IRON MAN, which
// draw a placeholder initial until he picks); and the real HUD's recap (AWARDS and PLAYERS tabs) with the icons in.
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
const PICK = {
  melee_kill: { title: 'BEAT DOWN (a melee finish)', opts: [
    ['B1 · Hammer blow', 'a war hammer mid-swing, with amber impact lines', (c, a) =>
      `<g transform="rotate(-38 16 16)"><rect x="9" y="6.4" width="14" height="6.4" rx="1.2" fill="${c}"/><rect x="14.9" y="12.4" width="2.2" height="13.6" rx=".9" fill="${c}"/></g>`
      + `<path d="M6.4 20.6h3.4M7.2 24l2.6-1.8M10.4 26.2l1-2.8" stroke="${a}" stroke-width="1.8" stroke-linecap="round"/>`],
    ['B2 · Takedown', 'a heavy downward strike cracking the ground', (c, a) =>
      `<path d="M13.4 6.2h5.2v7.6h3.8L16 20.6l-6.4-6.8h3.8z" fill="${c}"/><rect x="7" y="22.4" width="18" height="2.4" rx="1" fill="${a}"/>`
      + `<path d="M11 22.4 9.4 19.6M21 22.4l1.6-2.8" stroke="${a}" stroke-width="1.6" stroke-linecap="round"/>`],
    ['B3 · Glove', 'a padded fighting glove, side on, with an amber cuff', (c, a) =>
      `<path d="M11.4 9.6c0-2 1.8-3.2 4-3.2h3.2c3.2 0 5 2.4 5 5.8v4.2c0 2.4-1.5 3.9-3.6 3.9h-6.8c-1.1 0-1.8-.8-1.8-1.9z" fill="${c}"/>`
      + `<path d="M11.4 12.6c-2.2 0-3.2 1.4-3.2 2.8 0 1.5 1.2 2.6 3.2 2.6" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>`
      + `<rect x="12.2" y="21.4" width="10.4" height="4" rx="1" fill="${a}"/>`],
  ] },
  iron_man: { title: 'IRON MAN (fewest deaths, endurance)', opts: [
    ['I1 · Riveted plate', 'a slab of armour plate with four amber rivets', (c, a, gap) =>
      `<path d="M9 8.4h14l1.6 3v10.4L16 25.8l-8.6-4V11.4z" fill="${c}"/><path d="M16 9.6v14.8" stroke="${gap}" stroke-width="1.4"/>`
      + [[11.2, 12], [20.8, 12], [11.2, 19.4], [20.8, 19.4]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.4" fill="${a}"/>`).join('')],
    ['I2 · Iron heart', 'a heart with a band of plate across it: the one who keeps going', (c, a, gap) =>
      `<path d="M16 25C9.6 20.4 7.4 17 7.4 13.4a4.3 4.3 0 0 1 8.6-1.6 4.3 4.3 0 0 1 8.6 1.6c0 3.6-2.2 7-8.6 11.6z" fill="${c}"/>`
      + `<path d="M8.2 16.6h15.6" stroke="${gap}" stroke-width="2.6"/><path d="M9.6 16.6h12.8" stroke="${a}" stroke-width="1.2"/>`],
    ['I3 · Unbroken loop', 'an endless loop: a whole match without falling', (c, a) =>
      `<path d="M16 16c-2.6-3.8-7.2-3.8-7.2 0s4.6 3.8 7.2 0 7.2-3.8 7.2 0-4.6 3.8-7.2 0z" fill="none" stroke="${c}" stroke-width="2.8" stroke-linejoin="round"/>`
      + `<circle cx="16" cy="16" r="1.6" fill="${a}"/>`],
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
const cell = (k, skin) => `<div class="cell"><div class="row">${SIZES.map(s => icon(k, skin, s)).join('')}</div><div class="k">${esc(LABEL[k] || k)}<small>${esc(k)}${k === 'melee_kill' || k === 'iron_man' ? ' · placeholder' : ''}</small></div></div>`;
const grid = (keys, skin) => `<div class="grid">${keys.map(k => cell(k, skin)).join('')}</div>`;
const pick = key => { const p = PICK[key];
  return `<div class="pick"><h3>${esc(p.title)}: pick one</h3><div class="opts">${p.opts.map(([name, what, g]) => `<div class="opt"><b>${esc(name)}</b><span>${esc(what)}</span>
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
<p class="q">Pick one BEAT DOWN and one IRON MAN (for example "B2, I1"). Until then both draw a placeholder initial.</p></header>
<section id="pick"><h2>Pick one</h2>${pick('melee_kill')}${pick('iron_man')}</section>
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
