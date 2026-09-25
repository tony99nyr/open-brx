// F352 kill card gallery: frozen renders of the shipped card and variants A/B/C, both skins, both screen-gate widths.
// Run from app/: node shots/kill-card/gallery.mjs   (needs a fresh `npm run build`). Writes shots + index.html here.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', '..', 'www');
const TYPES = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => { const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { const b = fs.readFileSync(path.join(WWW, decodeURIComponent(rel))); res.setHeader('content-type', TYPES[path.extname(rel)] || 'application/octet-stream'); res.end(b); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const PORT = srv.address().port;
const VIEWS = [{ name: 'pixel', width: 891, height: 411 }, { name: 'se', width: 667, height: 375 }];   // = screens.mjs VIEWS
const SKINS = [{ name: 'day', q: '' }, { name: 'night', q: '&night' }];
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fmt = ms => ms == null ? '—' : (ms / 1000).toFixed(1) + ' s';
const INIT = () => {
  window.__kc = []; window.__ann = [];
  const t = () => Date.now();
  new MutationObserver(ms => { for (const m of ms) {
    const kind = n => !n.classList ? null : n.classList.contains('co') ? 'co' : (n.classList.contains('lh') || (n.querySelector && n.querySelector('.lh'))) ? 'lh' : (n.querySelector && n.querySelector('.lo')) ? 'lo' : null;
    for (const n of m.addedNodes) { const k = kind(n); if (k) window.__kc.push({ ev: 'add', k, t: t() }); }
    for (const n of m.removedNodes) { const k = kind(n); if (k) window.__kc.push({ ev: 'rm', k, t: t() }); }
  } }).observe(document, { subtree: true, childList: true });
  let last = null;
  setInterval(() => { const e = window.brx && window.brx.engine, c = e && e._ann && e._ann.current;
    if (c && c !== last) { last = c; window.__ann.push({ kind: c.kind, medals: (c.medals || []).map(x => x.m), start: c.startedAt, audioUntil: c.audioUntil, muted: !!c.muted }); } }, 20);
};
const FIRST = '.mo.co, #lanes .lh, #lanes .lo';
const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const openPg = async (view, stage, kc, skin) => {
  const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); pg.__err = []; pg.on('pageerror', e => pg.__err.push(e.message));
  await pg.addInitScript(INIT);
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=${stage}&kc=${kc}${skin.q}`);
  await pg.waitForSelector(FIRST, { timeout: 12000 });
  return pg;
};
const t0Of = async pg => pg.evaluate(() => (window.__kc.find(e => e.ev === 'add') || {}).t);   // the first kill/lead overlay on screen
const annOf = async (pg, t0) => (await pg.evaluate(() => window.__ann)).map(a => `${a.kind}${a.medals.length ? ' (' + a.medals.join(', ') + ')' : ''}${a.muted ? ' [muted]' : ''} ${((a.start - t0) / 1000).toFixed(1)}-${((a.audioUntil - t0) / 1000).toFixed(1)} s`);

// ---- single frames: [id, section, label, kc, stage] ----
const ROWS = [];
for (const [c, label, stage] of [['kl', 'Kill + lead taken at once', 'live-announcer'], ['fb', 'FIRST BLOOD + lead taken at once (the real first kill)', 'live-announcer-fb'],
  ['lo', 'Lead alone (a teammate\'s kill; I did nothing)', 'live-lead-alone'], ['ir', 'Kill confirmed by the IR word only', 'live-callout-kill']]) ROWS.push([`ln-${c}`, 'ln', label, 'ln', stage]);
for (const L of ['l1', 'l2']) for (const [c, label, stage] of [['kl', 'Kill + lead taken', 'live-announcer'], ['fb', 'Kill + FIRST BLOOD + lead taken', 'live-announcer-fb'],
  ['dk', 'DOUBLE KILL + lead taken', 'live-announcer-medal'], ['lo', 'Lead alone', 'live-lead-alone'], ['ir', 'Kill confirmed by the IR word only', 'live-callout-kill']]) ROWS.push([`${L}-${c}`, L, label, L, stage]);
ROWS.push(['ref-a', 'ref', 'A: today\'s card, heavier (2.5 s)', 'a', 'live-kill'], ['ref-b', 'ref', 'B: KILL and name (2.5 s)', 'b', 'live-kill'], ['ref-c', 'ref', 'C: B + medal line (3.5 s)', 'c', 'live-kill-first-blood']);
const results = [];
for (const [id, section, label, kc, stage] of ROWS) for (const skin of SKINS) for (const view of VIEWS) {
  const pg = await openPg(view, stage, kc, skin);
  await pg.waitForTimeout(900);
  const base = `${id}-${skin.name}-${view.name}`;
  await pg.screenshot({ path: `${HERE}/${base}.png` });
  await pg.waitForFunction(() => !document.querySelector('.mo.co, #lanes .lh'), null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(kc === 'ln' ? 2600 : 300);
  const t0 = await t0Of(pg), ev = await pg.evaluate(() => window.__kc);
  // the moment's end: the last removal of the card, or of the hero (a re-render replaces the hero node; the last one counts)
  const adds = ev.filter(e => e.ev === 'add' && (e.k === 'co' || e.k === 'lh')), rms = ev.filter(e => e.ev === 'rm' && (e.k === 'co' || e.k === 'lh'));
  const onScreen = await pg.evaluate(() => !!document.querySelector('.mo.co, #lanes .lh'));
  const rm = !onScreen && rms.length && (!adds.length || rms[rms.length - 1].t >= adds[adds.length - 1].t) ? rms[rms.length - 1] : null;
  const m = { gone: rm && t0 ? rm.t - t0 : null, items: await annOf(pg, t0) };
  if (pg.__err.length) throw new Error(`${base}: ${pg.__err.join(' | ')}`);
  results.push({ id, section, label, skin: skin.name, view: view.name, shot: `${base}.png`, m });
  console.log(base, JSON.stringify(m)); await pg.close();
}
// ---- storyboard: the spree, one width, both skins ----
const SB = [[0.3, 'kill 1: FIRST BLOOD + YOUR TEAM TAKES THE LEAD'], [1.3, 'kill 2: DOUBLE KILL'], [2.35, 'HILL CAPTURED (2.0) + teammate down (2.2)'], [2.8, 'kill 3: TRIPLE KILL'],
  [3.8, 'kill 4: KILLTACULAR'], [4.8, 'kill 5: KILLTACULAR + KILLING SPREE'], [5.8, 'kill 6: KILLAMANJARO (proposal)'], [8.6, 'after the hold']];
const story = [];
for (const kc of ['ln', 'l1', 'l2']) for (const skin of SKINS) {
  const view = VIEWS[0], pg = await openPg(view, 'live-spree', kc, skin), t0 = await t0Of(pg), frames = [];
  for (const [t, label] of SB) {
    const wait = t0 + t * 1000 - (await pg.evaluate(() => Date.now()));
    if (wait > 0) await pg.waitForTimeout(wait);
    const f = `story-${kc}-${skin.name}-${String(t).replace('.', '_')}.png`;
    await pg.screenshot({ path: `${HERE}/${f}` }); frames.push({ t, label, f });
  }
  await pg.waitForTimeout(3000);
  const items = await annOf(pg, t0);
  if (pg.__err.length) throw new Error(`story ${kc}: ${pg.__err.join(' | ')}`);
  story.push({ kc, skin: skin.name, frames, items }); console.log('story', kc, skin.name, items.join(' | '));
  await pg.close();
}
await b.close(); srv.close();
fs.writeFileSync(`${HERE}/results.json`, JSON.stringify({ results, story }, null, 1));
// ---- the page ----
const cell = r => `<figure><img src="${r.shot}" alt="${esc(r.label)} ${r.skin} ${r.view}"><figcaption>${r.skin} · ${r.view} ${r.view === 'pixel' ? '891×411' : '667×375'}</figcaption></figure>`;
const sec = (title, lede, sid) => {
  let h = `<h2>${esc(title)}</h2><p class="hold">${esc(lede)}</p>`;
  for (const [id, section, label] of ROWS.filter(r => r[1] === sid)) {
    const rs = results.filter(r => r.id === id), m0 = rs[0].m;
    h += `<section><h3>${esc(label)}</h3><p class="hold">On screen ${fmt(m0.gone)}. Voice, one line at a time: ${esc(m0.items.join(' · ') || 'none')}.</p><div class="grid">${rs.map(cell).join('')}</div></section>`;
  }
  return h;
};
const LN = { ln: 'Three lanes', l1: 'L1 (comparison)', l2: 'L2 (comparison)' };
const sb = ['ln', 'l1', 'l2'].map(kc => story.filter(s => s.kc === kc).map(s => `<h3>${LN[kc]} · ${s.skin}</h3><div class="strip">${s.frames.map(f => `<figure><img src="${f.f}" alt="t ${f.t} s"><figcaption><b>t ${f.t} s</b> ${esc(f.label)}</figcaption></figure>`).join('')}</div>`
  + `<p class="hold">Voice: ${esc(s.items.join(' · '))}</p>`).join('')).join('');
fs.writeFileSync(`${HERE}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kill and lead alerts</title>
<style>:root{color-scheme:dark;--bg:#0b0e12;--fg:#e8edf2;--mut:#8a96a3}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 2px;border-top:1px solid #222;padding-top:14px}h3{font-size:14px;margin:16px 0 4px}.hold{margin:0 0 10px;color:var(--mut);max-width:1100px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(400px,1fr));gap:12px}.strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}.strip figure{flex:0 0 360px}
figure{margin:0}img{width:100%;height:auto;display:block;border:1px solid #222}figcaption{font-size:12px;color:var(--mut);margin-top:3px}figcaption b{color:var(--fg)}
.note{max-width:1100px;border-left:3px solid #d9a441;padding:6px 12px;background:#15130c;margin:10px 0}</style></head><body>
<h1>Kill and lead alerts: the three-lane proposal</h1>
<p class="hold">F352, stage only (the shipped card is unchanged). Frozen renders of the real HUD (?demo). <b>HERO</b> (centre, over the HUD): my kill and my newest medal; a spree builds, the newest medal big and the earlier ones as a fading ladder, with a ×N kill count; it holds 2.5 s after the last kill. <b>OBJECTIVE</b> (right): one badge per key (lead, hill), up until the next one of its key replaces it; it dims after 4 s. <b>FEED</b> (left): teammate down, enemy down, pickups and other match news, 4 s a row. Every item shows when its event ARRIVES, with a small source line (MC, IR 15 for the S57 IR word, BLE for a station). No weapon, no "+1 / K 1".</p>
<div class="note"><b>The voice cannot say every line.</b> Each line runs about 1.9 s and the kills come 1 s apart, so the announcer queue says one line at a time and folds kills that are still waiting into the newest medal line. The voice says a subset (first blood, the lead, then the newest medal each time the gun is free); the screen shows everything. The exact lines each run spoke are under each storyboard.</div>
<div class="note"><b>Found while building the storyboard: in a spree the lead and hill LINES are dropped.</b> My kill confirm outranks every other line and never expires, while the lead line waits at most 4 s and the hill line 3 s. With a kill every second, both expire unheard (see the voice lines under the storyboard). The lanes still show both. Whether a lead or hill line should jump the queue, or be said after the spree, is a decision for Tony.</div>
<div class="note"><b>KILLAMANJARO is a proposal.</b> MC's medal ladder today is double kill (2), triple kill (3), killtacular (4+), killing spree (5 streak) and unstoppable (10 streak). The gun has a killamanjaro line, but MC does not award it yet, so the t 5.8 s frame shows what it would look like.</div>
<h2>Storyboard: a six-kill spree with the lead and the hill landing inside it</h2>
<p class="hold">Kills 1 s apart from t 0; the hill capture at t 2.0 s and a teammate down at t 2.2 s. Pixel width (891×411). Three lanes first, then L1 and L2 for comparison.</p>
${sb}
${sec('Three lanes: single frames', 'Both skins, both screen-gate widths.', 'ln')}
${sec('L1 (comparison): one overlay, the lead as a strip on the kill', 'The strip shows from the first frame; the overlay holds until the last paired line ends.', 'l1')}
${sec('L2 (comparison): split screen, kill left, lead badge right', 'Both halves from the first frame.', 'l2')}
${sec('Reference: A, B, C single frames', 'The earlier variants, without the weapon and with the source line in place of "+1 ELIMINATION · K 1".', 'ref')}
</body></html>`);
console.log('gallery:', `${HERE}/index.html`);
