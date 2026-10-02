// The King of the Hill "a capture begins" gallery (Tony, bench 2026-10-02): frozen renders of the REAL HUD (?demo) for
// Tony's pick, day and night, at both screen-gate widths. TAKING THE HILL and HILL UNDER ATTACK (engine.js `_hillBegins`)
// beside the hill badges that ship (HILL CAPTURED, HILL LOST), over time, and the clash with the down screen.
// It asserts nothing (app/tools/screens.mjs is the gate).
// Run from app/ after `npm run build`: node tools/koth-capture-alert-gallery.mjs [out-dir]
// The default out-dir is C:\Users\Tony\brx-koth-capture-alert (WSL: /mnt/c/Users/Tony/brx-koth-capture-alert).
// The screenshots never go in the repo.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const HERE = path.dirname(fileURLToPath(import.meta.url)), WWW = path.resolve(HERE, '..', 'www');
const OUT = path.resolve(process.argv[2] || '/mnt/c/Users/Tony/brx-koth-capture-alert');
fs.mkdirSync(OUT, { recursive: true });
let BASE = '?'; try { BASE = execFileSync('git', ['log', '-1', '--format=%h %s'], { cwd: HERE }).toString().trim(); } catch { /* not a checkout: say so on the page */ }
const TYPES = { '.js': 'text/javascript', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => { const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { const b = fs.readFileSync(path.join(WWW, decodeURIComponent(rel))); res.setHeader('content-type', TYPES[path.extname(rel)] || 'application/octet-stream'); res.end(b); } catch { res.statusCode = 404; res.end(); } });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const VIEWS = [{ name: 'pixel', width: 891, height: 411, label: '891×411' }, { name: 'se', width: 667, height: 375, label: '667×375' }];   // = screens.mjs VIEWS
const SKINS = [{ name: 'day', q: '' }, { name: 'night', q: '&night' }];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// the moment each hill badge first appeared, stamped by a MutationObserver (frames are timed from it, never from page load)
const INIT = () => {
  window.__badge = {};
  new MutationObserver(() => { for (const o of document.querySelectorAll('#lanes .lo[data-key="hill"]')) if (!window.__badge[o.dataset.kind]) window.__badge[o.dataset.kind] = Date.now(); })
    .observe(document, { subtree: true, childList: true, attributes: true });
};
const b = await chromium.launch();
const openPg = async (view, stage, skin) => {
  const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); pg.__err = []; pg.on('pageerror', e => pg.__err.push(e.message));
  await pg.addInitScript(INIT);
  await pg.goto(`http://127.0.0.1:${PORT}/?demo&stage=${stage}${skin.q}`);
  return pg;
};
const shot = async (pg, f) => { await pg.screenshot({ path: path.join(OUT, f) }); return f; };
const at = async (pg, t0, t) => { const wait = t0 + t * 1000 - (await pg.evaluate(() => Date.now())); if (wait > 0) await pg.waitForTimeout(wait); };
const fail = (pg, what) => { if (pg.__err.length) throw new Error(`${what}: ${pg.__err.join(' | ')}`); };

// ---- each badge over time, from its first frame: the arrival, held, and settled (dimmed after 4 s) ----
const BADGES = [
  ['hill_taking', 'live-hill-taking', 'TAKING THE HILL (new)', 'Our bar leaves 0 on a point nobody holds.'],
  ['hill_attack', 'live-hill-attack', 'HILL UNDER ATTACK (new)', 'The other team starts to drain the point we hold.'],
  ['hill_captured', 'live-hill-captured', 'HILL CAPTURED (ships)', 'For comparison: the badge that ships today.'],
  ['hill_lost', 'live-hill-lost', 'HILL LOST (ships)', 'For comparison: the badge that ships today.'],
];
const TIMES = [[0.15, 'arriving'], [1, 'held'], [4.6, 'settled (dims after 4 s)']];
const seqs = [];
for (const [kind, stage, label, note] of BADGES) {
  const runs = [];
  for (const skin of SKINS) for (const view of VIEWS) {
    const pg = await openPg(view, stage, skin);
    await pg.waitForFunction(k => window.__badge[k], kind, { timeout: 15000 });
    const t0 = await pg.evaluate(k => window.__badge[k], kind), frames = [];
    for (const [t, what] of TIMES) { await at(pg, t0, t); frames.push({ t, what, f: await shot(pg, `seq-${kind}-${skin.name}-${view.name}-${String(t).replace('.', '_')}.png`) }); }
    fail(pg, `${stage} ${skin.name} ${view.name}`);
    runs.push({ skin: skin.name, view, frames }); await pg.close();
  }
  seqs.push({ kind, label, note, runs }); console.log('badge', kind);
}

// ---- the clash: HILL UNDER ATTACK lands while I am DOWN ----
const clash = [];
for (const skin of SKINS) for (const view of VIEWS) {
  const pg = await openPg(view, 'down-hill-attack', skin), frames = [];
  await pg.waitForFunction(() => { const s = window.brxDemo && window.brxDemo.state(); return s && !s.alive && s.lanes && s.lanes.obj.hill && s.lanes.obj.hill.kind === 'hill_attack'; }, null, { timeout: 15000 });
  await pg.waitForTimeout(300);
  frames.push({ f: await shot(pg, `clash-${skin.name}-${view.name}-0.png`), cap: '<b>Down</b> The attack arrived 0.3 s ago. It waits on the badge; the down screen owns the phone.' });
  await pg.waitForFunction(() => window.brxDemo.state().alive, null, { timeout: 15000 });
  const t0 = await pg.evaluate(() => Date.now());
  await at(pg, t0, 0.4); frames.push({ f: await shot(pg, `clash-${skin.name}-${view.name}-1.png`), cap: '<b>Respawn +0.4 s</b> REDEPLOYED. The badge draws at once, beside it (as HILL CAPTURED does today).' });
  await at(pg, t0, 2.6); frames.push({ f: await shot(pg, `clash-${skin.name}-${view.name}-2.png`), cap: '<b>Respawn +2.6 s</b> The live HUD, the badge still up, already dimmed: its 4 s ran while I was down, and it clears 8 s after it arrived.' });
  fail(pg, `clash ${skin.name} ${view.name}`);
  clash.push({ skin: skin.name, view, frames }); await pg.close(); console.log('clash', skin.name, view.name);
}
await b.close(); srv.close();

// Tony's notes after each round go here, verbatim, with where the page answers each one.
const CHANGED = [];
const fig = (f, cap) => `<figure><img src="${f}" alt="${esc(cap.replace(/<[^>]+>/g, ''))}" loading="lazy"><figcaption>${cap}</figcaption></figure>`;
const title = s => `${s.skin === 'day' ? 'Day' : 'Night'} · ${s.view.label}`;
// side by side: the four badges at the "held" frame, one row per skin and width
const side = SKINS.flatMap(skin => VIEWS.map(view => `<h3>${title({ skin: skin.name, view })}</h3><div class="row4">${seqs.map(s => {
  const r = s.runs.find(x => x.skin === skin.name && x.view === view), fr = r.frames[1];
  return fig(fr.f, `<b>${esc(s.label)}</b>`); }).join('')}</div>`)).join('');
const seqHtml = seqs.slice(0, 2).map(s => `<section><h3>${esc(s.label)}</h3><p class="mut">${esc(s.note)}</p>${s.runs.map(r => `<h3 class="mut">${title(r)}</h3><div class="strip">${r.frames.map(fr => fig(fr.f, `<b>t ${fr.t} s</b> ${esc(fr.what)}`)).join('')}</div>`).join('')}</section>`).join('');
const clashHtml = clash.map(c => `<h3>${title(c)}</h3><div class="strip">${c.frames.map(fr => fig(fr.f, fr.cap)).join('')}</div>`).join('');
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KOTH capture alerts</title>
<style>:root{color-scheme:dark;--bg:#0b0e12;--fg:#e8edf2;--mut:#8a96a3;--edge:#262d36}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1500px;margin:0 auto}h1{font-size:22px;margin:0 0 6px}h2{font-size:18px;margin:34px 0 4px;border-top:1px solid var(--edge);padding-top:14px}h3{font-size:14px;margin:18px 0 6px}
p{margin:0 0 10px;max-width:1000px}.mut{color:var(--mut)}.strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}.strip figure{flex:0 0 380px}
.row4{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:8px}figure{margin:0}img{width:100%;height:auto;display:block;border:1px solid var(--edge)}
figcaption{font-size:12px;color:var(--mut);margin-top:3px}figcaption b{color:var(--fg)}
.q{border:1px solid #b58432;background:#15130c;padding:10px 14px;margin:12px 0 18px;max-width:1000px}.q h2{border:0;margin:0 0 4px;padding:0;font-size:16px}
ol,ul{margin:4px 0 10px;padding-left:20px;max-width:1000px}li{margin-bottom:6px}</style></head><body><main>
<h1>King of the Hill: a capture begins</h1>
<p class="mut">Frozen renders of the real phone HUD. The demo stages drive the real engine with phone control-point adverts. Day and night, at the two screen-gate widths. Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC on ${esc(BASE)} (branch hud-capture-begins-alert, not on main yet).</p>
<div class="q"><h2>Open questions</h2><ol>
<li><b>The copy.</b> Built: <b>TAKING THE HILL</b> (our bar leaves 0) and <b>HILL UNDER ATTACK</b> (the other team starts to drain our point). Keep these, or another pair, for example CAPTURING THE HILL and DEFEND THE HILL? DOWN is not used: it is reserved for waiting to respawn. A or B?</li>
<li><b>Buzz and voice for HILL UNDER ATTACK.</b> Every hill and lead badge already gives one short tap, so both new badges tap today. The sound catalogue has no "capturing" or "under attack" line; the nearest is VB0O "Hill Contested" (2.1 s), which the phone already says when two teams stand on a point. A: the tap only (built). B: a stronger buzz for UNDER ATTACK only. C: B, and also say VB0O.</li>
<li><b>The attacker's drain.</b> To take an enemy point, a team first drains it to 0, then builds it. Built: the attackers see TAKING THE HILL only when their own bar leaves 0, after the point goes neutral (the defenders see UNDER ATTACK at the start of the drain). Should the attackers also see TAKING THE HILL when the drain starts? A: as built. B: at the drain.</li>
<li><b>Contested has no card.</b> On the player HUD, "Hill Contested" is a voice line only; there is no CONTESTED badge to compare with. Add one (same badge, amber), or leave it? A: leave. B: add.</li>
<li><b>After a respawn.</b> A hill badge that arrived while I was down draws at once beside REDEPLOYED (see the clash). That is what HILL CAPTURED does today. A: keep. B: hold every hill badge until REDEPLOYED ends, as the kill card does.</li>
</ol></div>
${CHANGED.length ? `<div class="q"><h2>Changed since your notes</h2><ul>${CHANGED.map(([n, note, what]) => `<li><b>${n}</b> “${esc(note)}” → ${what}</li>`).join('')}</ul></div>` : ''}
<h2>How it decides</h2>
<ul><li>The phone decides from the control point's advert it already hears (owner, held, rising, falling, progress). No MC.</li>
<li>Once per capture episode, never per advert. A capture that stalls and resumes is the same episode, until the progress returns to 0 or the point changes owner. An attack episode also ends when we build the point back to 100.</li>
<li>The first advert of a point is adopted silently, as the owner is: walking up to a capture already under way says nothing. A flapping advert gives at most one badge of each kind per 10 s.</li>
<li>It is the same OBJECTIVE hill badge as HILL CAPTURED and HILL LOST, so the newest hill fact replaces the last one, and it waits under the down screen and the weapon switch card exactly as they do. UNDER ATTACK takes the red look of HILL LOST.</li>
<li>Phone control points only. A grenade hill sends no progress, so it cannot say when a capture begins.</li></ul>
<h2>Side by side: the new badges beside the ones that ship</h2>
<p class="mut">Each 1 s after it appeared.</p>
${side}
<h2>Over time</h2>
<p class="mut">Time 0 is the badge's first frame. It dims after 4 s and clears after 8 s, like every hill badge.</p>
${seqHtml}
<h2>Clash: HILL UNDER ATTACK while I am down</h2>
${clashHtml}
</main></body></html>`);
console.log('gallery:', path.join(OUT, 'index.html'));
