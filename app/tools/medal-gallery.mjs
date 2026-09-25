// The medal icon gallery (Tony 2026-09-25): every icon in src/hud/medalicons.js in every style, day and night, at 24,
// 32 and 48 px, the multi-kill escalation strip, a scoreboard legend, and mocks of the phone's AWARDS tab, kill card and
// PLAYERS medals column with the icons in place of the words. It asserts nothing and ships nothing: Tony picks a style.
// The mocks are the REAL HUD (?demo&stage=...) with the medal words swapped for icons in the page after it renders;
// the HUD itself does not use the icons yet.
// Run from app/ after `npm run build`: node tools/medal-gallery.mjs [out-dir]
// The default out-dir is C:\Users\Tony\brx-medals (WSL: /mnt/c/Users/Tony/brx-medals). Nothing here goes in the repo.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'node:url';
import { medalIcon, MEDAL_ICON_VARIANTS, MEDAL_ICON_NOTES, MEDAL_PALETTE } from '../src/hud/medalicons.js';
import { MEDALS, AWARDS } from '../src/transport/contract.gen.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const OUT = path.resolve(process.argv[2] || '/mnt/c/Users/Tony/brx-medals');
fs.mkdirSync(OUT, { recursive: true });
if (!fs.existsSync(path.join(WWW, 'app.js'))) throw new Error('www/app.js is missing: run `npm run build` first');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const LABEL = Object.fromEntries([...MEDALS.map(m => [m.key, m.label]), ...AWARDS.map(a => [a.key, a.label])]);
const MEDAL_KEYS = MEDALS.map(m => m.key), AWARD_KEYS = AWARDS.map(a => a.key);
const LADDER = MEDALS.filter(m => m.kind === 'multi').map(m => m.key);
const SKINS = ['day', 'night'], SIZES = [24, 32, 48];
const icon = (k, v, skin, size) => medalIcon(k, { variant: v, night: skin === 'night', size, label: LABEL[k] });

// ---- the mocks: the real HUD, with the words swapped for icons in the page ----
const TYPES = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => { const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { const b = fs.readFileSync(path.join(WWW, decodeURIComponent(rel))); res.setHeader('content-type', TYPES[path.extname(rel)] || 'application/octet-stream'); res.end(b); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port, VIEW = { width: 891, height: 411 };

// In the page: the AWARDS tab icon-first, the kill card's medal line, and the PLAYERS medals column.
const PATCH = ({ ic, labelToKey, what }) => {
  const css = document.createElement('style');
  css.textContent = `.mi{display:block;flex:none}.mk-me{display:flex;gap:10px;align-items:flex-end;margin-top:4px}
    .mk-me span{position:relative}.mk-me b{position:absolute;right:-4px;bottom:-4px;font-size:10px;padding:0 3px;border-radius:3px;background:var(--edge,#223);color:var(--num)}
    .result .awl:has(.mk-grid){display:block;width:100%;max-width:none}.mk-grid{width:100%;box-sizing:border-box;display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px 10px;padding:4px 2px}
    .mk-aw{display:flex;align-items:center;gap:7px;min-width:0}.mk-aw .t{display:flex;flex-direction:column;min-width:0;line-height:1.15}
    .mk-aw .n{font-size:12px;color:var(--num);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mk-aw .s{font-size:10px;color:var(--mut)}
    .mk-aw.me .n{color:var(--warn)}.mk-row{display:flex;gap:3px;align-items:center;justify-content:flex-start}`;
  document.head.appendChild(css);
  if (what === 'awards') {
    const me = document.querySelector('.result .awme .awm');
    if (me) { const n = {}; me.querySelectorAll('[data-award]').forEach(e => { const k = e.dataset.award; n[k] = (n[k] || 0) + 1; });
      me.outerHTML = `<div class="mk-me">${Object.keys(n).map(k => `<span>${ic[k][44]}${n[k] > 1 ? `<b>×${n[k]}</b>` : ''}</span>`).join('')}</div>`; }
    const l = document.querySelector('.result .awl');
    if (l) l.innerHTML = `<div class="mk-grid">${[...l.querySelectorAll('.aw')].map(a => {
      const k = a.dataset.award, n = a.querySelector('.awn'), s = a.querySelector('.aws');
      return `<div class="mk-aw${a.classList.contains('me') ? ' me' : ''}">${ic[k][32]}<span class="t"><span class="n">${n ? n.innerHTML.replace(/<b>.*<\/b>/, '').trim() : ''}</span><span class="s">${s ? s.textContent.split(' · ')[0] : ''}</span></span></div>`; }).join('')}</div>`;
  }
  if (what === 'kill') {
    const big = document.querySelector('#lanes .lhm .medal');
    if (big) big.outerHTML = ic[big.dataset.m][44];
    document.querySelectorAll('#lanes .lhl .lm[data-m]').forEach(e => { const o = e.style.opacity; e.outerHTML = `<span style="opacity:${o};display:inline-block;margin-right:4px">${ic[e.dataset.m][24]}</span>`; });
  }
  if (what === 'players') {
    document.querySelectorAll('.result .lbr .c.m').forEach(c => {
      const keys = c.textContent.split(' · ').map(s => labelToKey[s.trim()]).filter(Boolean);
      c.innerHTML = `<span class="mk-row">${keys.map(k => ic[k][20]).join('')}</span>`; });
  }
  // stop the HUD's own render loop from putting the words back before the screenshot
  document.querySelectorAll('.result, #lanes').forEach(e => e.setAttribute('data-mock', what));
};
const MOCKS = [
  { what: 'awards', stage: 'result-awards', wait: '.result .aw', label: 'End of match, AWARDS tab: icons first. Your own awards as big icons (×N when you hold one twice), then one icon per award with its holder and the number that earned it. No award names.' },
  { what: 'kill', stage: 'live-spree', wait: '#lanes .lhm .medal', label: 'The kill card during a spree: the newest medal as a big icon, the earlier ones as a small fading ladder.' },
  { what: 'players', stage: 'result-players', wait: '.result .lbr', label: 'End of match, PLAYERS tab: the MEDALS column as icons.' },
];
const b = await chromium.launch();
const shots = [];
for (const m of MOCKS) for (const v of MEDAL_ICON_VARIANTS) for (const skin of SKINS) {
  const pg = await b.newPage({ viewport: VIEW }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=${m.stage}${skin === 'night' ? '&night' : ''}`);
  await pg.waitForSelector(m.wait, { timeout: 20000 });
  if (m.what === 'kill') await pg.waitForFunction(() => document.querySelectorAll('#lanes .lhl .lm').length >= 2, null, { timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(300);
  const ic = {}; for (const k of [...MEDAL_KEYS, ...AWARD_KEYS]) ic[k] = Object.fromEntries([20, 24, 32, 44].map(s => [s, icon(k, v, skin, s)]));
  const labelToKey = Object.fromEntries(MEDALS.map(x => [x.label, x.key]));
  // freeze the page first (the HUD re-renders on a timer), then swap the words for icons
  await pg.evaluate(() => { const w = window; const id = w.setTimeout(() => {}, 0); for (let i = 0; i <= id; i++) { w.clearTimeout(i); w.clearInterval(i); } w.requestAnimationFrame = () => 0; });
  await pg.evaluate(PATCH, { ic, labelToKey, what: m.what });
  await pg.waitForTimeout(80);
  const f = `mock-${m.what}-${v}-${skin}.png`;
  await pg.screenshot({ path: path.join(OUT, f) });
  if (errs.length) throw new Error(`${m.what} ${v} ${skin}: ${errs.join(' | ')}`);
  shots.push({ ...m, v, skin, f }); console.log('mock', m.what, v, skin);
  await pg.close();
}
await b.close(); srv.close();

// ---- the page ----
const cell = (k, v, skin) => `<div class="cell"><div class="row">${SIZES.map(s => icon(k, v, skin, s)).join('')}</div><div class="k">${esc(LABEL[k] || k)}<small>${esc(k)}</small></div></div>`;
const grid = (keys, v, skin) => `<div class="grid">${keys.map(k => cell(k, v, skin)).join('')}</div>`;
const variantBlock = v => `<section id="${v}"><h2>${esc(MEDAL_ICON_NOTES[v])}</h2>
  ${SKINS.map(skin => `<div class="plate ${skin}"><h3>${skin === 'day' ? 'Day' : 'Night (red and amber only, on #120505)'}</h3>
    <h4>Escalation strip: double kill to killionaire (48 px, then 24 px)</h4>
    <div class="strip">${LADDER.map(k => `<div>${icon(k, v, skin, 48)}<span>${MEDALS.find(x => x.key === k).count}</span></div>`).join('')}</div>
    <div class="strip small">${LADDER.map(k => icon(k, v, skin, 24)).join('')}</div>
    <h4>Medals (in-match) at 24, 32 and 48 px</h4>${grid(MEDAL_KEYS, v, skin)}
    <h4>End-of-match awards</h4>${grid(AWARD_KEYS, v, skin)}
    <h4>Unknown key (the fallback)</h4>${grid(['some_new_key'], v, skin)}
    <h4>Mocks on the real HUD</h4>${shots.filter(s => s.v === v && s.skin === skin).map(s => `<figure><img src="${s.f}" width="891" height="411" loading="lazy" alt=""><figcaption>${esc(s.label)}</figcaption></figure>`).join('')}
  </div>`).join('')}</section>`;
const legend = v => `<div class="legend">${[...MEDAL_KEYS, ...AWARD_KEYS.filter(k => !MEDAL_KEYS.includes(k))].map(k => `<div>${icon(k, v, 'day', 28)}<span>${esc(LABEL[k])}</span></div>`).join('')}</div>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Medal Icon Styles</title><style>
body{margin:0;background:#0b0f16;color:#dfe8ef;font:14px/1.45 system-ui,sans-serif;padding:16px}
header{max-width:1100px}h1{font-size:22px;margin:0 0 6px}h2{font-size:17px;margin:28px 0 8px;color:#fff}h3{margin:0 0 6px;font-size:15px}h4{margin:14px 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8aa}
.q{font-size:20px;font-weight:700;color:#ffc53d;margin:10px 0}.legal{color:#9ab;font-size:13px}ul{margin:6px 0 0;padding-left:18px}
nav a{color:#5fd6ff;margin-right:14px}
.plate{border-radius:10px;padding:14px;margin:10px 0}.plate.day{background:${MEDAL_PALETTE.day.bg}}.plate.night{background:${MEDAL_PALETTE.night.bg};color:#d65454}.plate.night h4{color:#cc4e4e}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.cell{display:flex;flex-direction:column;gap:4px}.row{display:flex;align-items:flex-end;gap:8px}.k{font-size:11px;line-height:1.2}.k small{display:block;opacity:.6}
.strip{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap}.strip div{display:flex;flex-direction:column;align-items:center;font-size:11px}.strip.small{gap:6px;margin-top:8px}
figure{margin:10px 0}figure img{max-width:100%;height:auto;border:1px solid #223;border-radius:6px}figcaption{font-size:12px;opacity:.85}
.legend{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px 12px;background:#05080d;padding:12px;border-radius:10px}.legend div{display:flex;gap:8px;align-items:center;font-size:12px}
</style></head><body><header>
<h1>Open BRX medal and award icons: three styles</h1>
<p class="legal">Original designs, not Halo's art. No shape, layout or colour scheme is copied from Bungie's medals. Every icon is inline SVG with no fonts or external files.</p>
<ul>${MEDAL_ICON_VARIANTS.map(v => `<li><a href="#${v}">${esc(MEDAL_ICON_NOTES[v])}</a></li>`).join('')}</ul>
<p>The glyph for each key is the same in all three styles, so you pick a style, not a mapping. A multi-kill shows its tier as rays (one per kill); five kills and up turn the core amber, seven and up add an outer ring of dots. B adds one tick per kill, C one pip per kill.</p>
<p class="q">Which style? A, B or C.</p>
<nav>${MEDAL_ICON_VARIANTS.map(v => `<a href="#${v}">${v}</a>`).join('')}<a href="#legend">legend</a></nav></header>
${MEDAL_ICON_VARIANTS.map(variantBlock).join('')}
<section id="legend"><h2>Scoreboard legend (so players learn them): icon = name</h2>
${MEDAL_ICON_VARIANTS.map(v => `<h4>${esc(v)}</h4>${legend(v)}`).join('')}</section>
</body></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('wrote', path.join(OUT, 'index.html'), `(${shots.length} mocks)`);
