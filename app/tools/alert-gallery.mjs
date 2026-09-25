// The HUD alert lanes gallery (docs/announcer.md "The three lanes", F351/F352): frozen renders of the REAL HUD (?demo)
// for Tony's review, day and night, at both screen-gate widths. It asserts nothing (app/tools/screens.mjs is the gate).
// Run from app/ after `npm run build`: node tools/alert-gallery.mjs [out-dir]
// The default out-dir is C:\Users\Tony\brx-alerts (WSL: /mnt/c/Users/Tony/brx-alerts). The screenshots never go in the repo.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const OUT = path.resolve(process.argv[2] || '/mnt/c/Users/Tony/brx-alerts');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => { const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { const b = fs.readFileSync(path.join(WWW, decodeURIComponent(rel))); res.setHeader('content-type', TYPES[path.extname(rel)] || 'application/octet-stream'); res.end(b); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const VIEWS = [{ name: 'pixel', width: 891, height: 411, label: '891×411' }, { name: 'se', width: 667, height: 375, label: '667×375' }];   // = screens.mjs VIEWS
const SKINS = [{ name: 'day', q: '' }, { name: 'night', q: '&night' }];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// the time the first hero appeared, and every announcer line the voice started (to print what was SAID beside what was SHOWN)
const INIT = () => {
  window.__hero = null; window.__ann = [];
  new MutationObserver(() => { if (!window.__hero && document.querySelector('#lanes .lh')) window.__hero = Date.now(); }).observe(document, { subtree: true, childList: true });
  let last = null;
  setInterval(() => { const e = window.brx && window.brx.engine, c = e && e._ann && e._ann.current;
    if (c && c !== last) { last = c; window.__ann.push({ kind: c.kind, medals: (c.medals || []).map(x => x.m), start: c.startedAt, muted: !!c.muted }); } }, 20);
};
const b = await chromium.launch();
const openPg = async (view, stage, skin) => {
  const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); pg.__err = []; pg.on('pageerror', e => pg.__err.push(e.message));
  await pg.addInitScript(INIT);
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=${stage}${skin.q}`);
  return pg;
};
const said = async (pg, t0) => (await pg.evaluate(() => window.__ann)).filter(a => a.start >= t0 - 50)
  .map(a => `${a.kind.replace(/_/g, ' ')}${a.medals.length ? ' (' + a.medals.join(', ').replace(/_/g, ' ') + ')' : ''}${a.muted ? ' [muted]' : ''} at ${((a.start - t0) / 1000).toFixed(1)} s`);

// ---- the storyboard: every skin and width ----
const SB = [[0.3, 'Kill 1: FIRST BLOOD, and YOUR TEAM TAKES THE LEAD on the same tick'], [1.3, 'Kill 2: DOUBLE KILL'], [1.95, 'HILL CAPTURED (1.6 s) and a teammate down (1.8 s)'],
  [2.3, 'Kill 3: TRIPLE KILL'], [3.3, 'Kill 4: KILLTACULAR'], [4.3, 'Kill 5: KILLTROCITY and KILLING SPREE'], [5.3, 'Kill 6: KILLAMANJARO'], [8.6, 'After the hold: the badges stay']];
const story = [];
for (const skin of SKINS) for (const view of VIEWS) {
  const pg = await openPg(view, 'live-spree', skin);
  await pg.waitForFunction(() => window.__hero, null, { timeout: 15000 });
  const t0 = await pg.evaluate(() => window.__hero), frames = [];
  for (const [t, label] of SB) {
    const wait = t0 + t * 1000 - (await pg.evaluate(() => Date.now()));
    if (wait > 0) await pg.waitForTimeout(wait);
    const f = `story-${skin.name}-${view.name}-${String(t).replace('.', '_')}.png`;
    await pg.screenshot({ path: path.join(OUT, f) }); frames.push({ t, label, f });
  }
  const voice = await said(pg, t0);
  if (pg.__err.length) throw new Error(`story ${skin.name} ${view.name}: ${pg.__err.join(' | ')}`);
  story.push({ skin: skin.name, view, frames, voice }); console.log('story', skin.name, view.name);
  await pg.close();
}
// ---- single moments: [id, label, stage, ms after load, an action to run first] ----
const ONE = [
  ['kill', 'My kill (MC names the victim)', 'live-kill', 3000],
  ['ir', 'My kill, confirmed by the IR word only (the victim\'s team, until their DOWN word names them)', 'live-callout-kill', 3000],
  ['together', 'My kill, the lead and a hill capture at the same moment', 'live-kill-lead-hill', 3000],
  ['lead', 'The lead alone (a teammate\'s kill): the badge stays until replaced', 'live-lead-alone', 3000],
  ['feed', 'Feed: a teammate down', 'live-callout-teammate', 3000],
  ['alert', 'Feed: another MC alert (BOMB PLANTED)', 'live-alert', 3100],
  ['pickup', 'Feed: a powerup spawn, beside the powerup hint', 'live-pu-spawn', 3600],
  ['beatdown', 'BEAT DOWN, a melee kill (new medal; label only, no voice yet)', 'live-kill-beat-down', 3000],
  ['killjoy', 'KILLJOY, an enemy\'s spree ended (new medal; HUD text only)', 'live-kill-killjoy', 3000],
  ['stunned', 'My kill while STUNNED: the hero is one row, the tell stays readable', 'live-stunned', 2600, "window.brxDemo.killMedals(['double_kill', 'killing_spree'], 'VIPER')", 300],
  ['hitkill', 'My kill while taking a hit: the hero is one row above TAKING FIRE and the damage number', 'live-hit', 2350, "window.brxDemo.hit(); window.brxDemo.killMedals(['double_kill'], 'VIPER')", 250],
  ['awards', 'End of match: the AWARDS tab (A63 honours: every row, mine first)', 'result-awards', 4200],
];
const singles = [];
for (const [id, label, stage, ms, act, after] of ONE) {
  const cells = [];
  for (const skin of SKINS) for (const view of VIEWS) {
    const pg = await openPg(view, stage, skin); await pg.waitForTimeout(ms);
    if (act) { await pg.evaluate(act); await pg.waitForTimeout(after || 300); }
    const f = `one-${id}-${skin.name}-${view.name}.png`; await pg.screenshot({ path: path.join(OUT, f) });
    if (pg.__err.length) throw new Error(`${id}: ${pg.__err.join(' | ')}`);
    cells.push({ f, skin: skin.name, view }); await pg.close();
  }
  singles.push({ id, label, cells }); console.log('one', id);
}
await b.close(); srv.close();

// Tony's notes on the kill-card gallery (2026-09-24), verbatim, and where this gallery answers each one.
const CHANGED = [
  ['Earlier', 'kill confirm goes away a little too fast, we need to work on that UI a bit', 'the HERO holds 2.5 s after the last kill, and longer while that kill\'s line still plays (every storyboard frame).'],
  ['1', 'hmm its a mix. this doesnt really work. the your team takes the lead event can occur at the same time as the kill screen. we have no examples of that', 'the storyboard at t 0.3 s and the single moment "My kill, the lead and a hill capture at the same moment": the lead badge shows beside the kill from the first frame.'],
  ['2', 'events can overlay on top , they dont have to fit into the standard UI. The +1 elmination K1 is not needed that is assumed. I like seeing the source small underneath MC or IR 15 I guess?', 'the HERO overlays the centre of the HUD; "+1 ELIMINATION" and "K 1" are gone; every item has a small source line (MC, IR 15, or BLE for a station).'],
  ['3', 'we dont need to see the weapon used to get the kill. we know it as the player', 'no weapon on any alert.'],
  ['4', 'and lets enumerate the streaks here... it could be double kill, triple kill, killtactular, killing spree, killamonjaro all back to back', 'the storyboard: six kills 1 s apart, on MC\'s ladder (FIRST BLOOD, DOUBLE KILL, TRIPLE KILL, KILLTACULAR, KILLTROCITY with KILLING SPREE, KILLAMANJARO), with a ×N count and the earlier medals on a fading ladder.'],
  ['5', 'it could also have takes the lead, hill captured during all of that', 'the storyboard at t 0.3 s (the lead) and t 1.95 s (HILL CAPTURED and a teammate down), inside the spree.'],
  ['6', 'so we need a better system of showing these alerts', 'the three lanes: HERO (centre), OBJECTIVE (right), FEED (left).'],
  ['7', 'is my favoriate one! (Killamanjaro)', 'KILLAMANJARO is kill 6 of the storyboard (t 5.3 s).'],
  ['8', 'the sound docs have several of those kill spree sounds, lets use em', 'the voice uses MC\'s ladder, a voiced medal on every kill from 2 to 8 (A61, already on main); a spree now voices the streak line too (KILLING SPREE was folded away before). The lines the voice said are printed under each storyboard.'],
  ['9', 'I like the 3 lanes. The separate alerts on the right.', 'this is now the only design: the lead and hill badges on the right, each until replaced.'],
  ['10', 'they go silent when kill streaks are showing.', 'merged from main: a lead or hill line during a kill streak is dropped; its badge still shows at once. The voice lines under each storyboard are what this build said.'],
  ['VQA', 'the kill hero hid STUNNED / DISARMED, TAKING FIRE, SMOKED and RECOIL', 'while a centre tell is up the hero is one row above it (KILL ×N and the medal): see "My kill while STUNNED" and "My kill while taking a hit".'],
  ['VQA', 'by day every badge blinked on each redraw', 'the lanes now keep each item\'s node; only a new item fades in.'],
  ['Polish r2', 'the feed stacked over the vitals when two rows landed in one ms', 'each feed row has its own id, so old rows always leave.'],
  ['Polish r3', 'lane labels and the awards stat line were under the 11 px SE floor', 'every lane label, source line and awards stat is now 11 px or more on the small screen, at 4.5:1 at night; a long awards list says MORE ↓.'],
  ['VQA', 'awards', 'the AWARDS tab shows MC\'s real end-of-match honours (A63): every one, mine first with a star and YOU, then in award order, SHARED where a tie holds, MC\'s stat on its own line; the HONORS strip is hidden on that tab.'],
];
const fig = (f, cap) => `<figure><img src="${f}" alt="${esc(cap)}" loading="lazy"><figcaption>${cap}</figcaption></figure>`;
const storyHtml = SKINS.map(skin => VIEWS.map(view => { const s = story.find(x => x.skin === skin.name && x.view === view);
  return `<h3>${skin.name === 'day' ? 'Day' : 'Night'} · ${view.label}</h3><div class="strip">${s.frames.map(fr => fig(fr.f, `<b>t ${fr.t} s</b> ${esc(fr.label)}`)).join('')}</div>`
    + `<p class="note-s">What the voice said: ${esc(s.voice.join(' · ') || 'nothing')}.</p>`; }).join('')).join('');
const oneHtml = singles.map(s => `<section><h3>${esc(s.label)}</h3><div class="grid">${s.cells.map(c => fig(c.f, `${c.skin} · ${c.view.label}`)).join('')}</div></section>`).join('');
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HUD alert lanes</title>
<style>:root{color-scheme:dark;--bg:#0b0e12;--fg:#e8edf2;--mut:#8a96a3;--edge:#262d36}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1500px;margin:0 auto}h1{font-size:22px;margin:0 0 6px}h2{font-size:18px;margin:34px 0 4px;border-top:1px solid var(--edge);padding-top:14px}h3{font-size:14px;margin:18px 0 6px}
p{margin:0 0 10px;max-width:1000px}.mut,.note-s{color:var(--mut)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}.strip figure{flex:0 0 360px}figure{margin:0}img{width:100%;height:auto;display:block;border:1px solid var(--edge)}
figcaption{font-size:12px;color:var(--mut);margin-top:3px}figcaption b{color:var(--fg)}
.changed{border:1px dashed #b58432;background:#15130c;padding:10px 14px;margin:12px 0 18px;max-width:1000px}.changed h2{border:0;margin:0 0 4px;padding:0;font-size:16px}
ul{margin:4px 0 10px;padding-left:20px;max-width:1000px}</style></head><body><main>
<h1>HUD alert lanes</h1>
<p class="mut">Frozen renders of the real phone HUD (the demo stages drive the real engine). Day and night, at the two screen-gate widths. Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.</p>
<div class="changed" id="changed"><h2>Changed since your notes</h2><ul>${CHANGED.map(([n, note, what]) => `<li><b>${n}</b> “${esc(note)}” → ${what}</li>`).join('')}</ul></div>
<h2>The design</h2>
<ul><li><b>HERO</b>, centre, over the HUD: my kill, the victim's name and my newest medal. A spree adds a ×N count and a ladder of the earlier medals, newest first, fading. It holds 2.5 s after the last kill (longer while that kill's line still plays).</li>
<li><b>OBJECTIVE</b>, right: the lead badge and the hill badge. Each stays until the next one of its kind replaces it; it dims after 4 s.</li>
<li><b>FEED</b>, left: teammate and enemy downs, powerup spawns and swaps, and every other MC alert. 4 s a row, the newest three.</li>
<li>Each item shows when its event arrives, so a kill, the lead and the hill at the same moment are on screen together. A small source line says who confirmed it: MC, IR 15 (the gun's IR word) or BLE (a station). No weapon, no "+1 ELIMINATION", no K count.</li>
<li>The voice still says one line at a time. Your rule that the lead and hill lines are voice-silent during a spree is built in a separate lane, so the voice lines under each storyboard are what THIS build said.</li>
<li>Night: red and amber on black only. No white flash, no strobe, no motion.</li></ul>
<h2>Storyboard: a six-kill spree with the lead, the hill and a teammate down inside it</h2>
<p class="mut">Kills 1 s apart from t 0, on MC's medal ladder.</p>
${storyHtml}
<h2>Single moments</h2>
${oneHtml}
</main></body></html>`);
console.log('gallery:', path.join(OUT, 'index.html'));
