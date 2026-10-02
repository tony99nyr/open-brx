// The King of the Hill "a capture begins" gallery (Tony, bench 2026-10-02): frozen renders of the REAL HUD (?demo) for
// Tony's pick, day and night, at both screen-gate widths. HILL CAPTURE STARTED (engine.js `_hillBegins`), in two team colours,
// beside the hill badges that ship (HILL CAPTURED, HILL LOST), over time, the clash with the down screen, when the
// holder hears "Hill Contested", and the Rockets shot-ready shine before and after.
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
const serve = async root => { const srv = http.createServer((req, res) => { const rel = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0];
  try { const b = fs.readFileSync(path.join(root, decodeURIComponent(rel))); res.setHeader('content-type', TYPES[path.extname(rel)] || 'application/octet-stream'); res.end(b); } catch { res.statusCode = 404; res.end(); } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); return srv; };
const srv = await serve(WWW), PORT = srv.address().port;
// The Rockets before/after (bench 2026-10-02): BEFORE_WWW is a copy of app/www built WITHOUT the fix (the parent commit).
// Without it the page shows the built frames only and says so.
const BEFORE_WWW = process.env.BEFORE_WWW || null;
const srvB = BEFORE_WWW ? await serve(path.resolve(BEFORE_WWW)) : null;
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
const openPg = async (view, stage, skin, port = PORT) => {
  const pg = await b.newPage({ viewport: { width: view.width, height: view.height } }); pg.__err = []; pg.on('pageerror', e => pg.__err.push(e.message));
  await pg.addInitScript(INIT);
  await pg.goto(`http://127.0.0.1:${port}/?demo&stage=${stage}${skin.q}`);
  return pg;
};
const shot = async (pg, f) => { await pg.screenshot({ path: path.join(OUT, f) }); return f; };
const at = async (pg, t0, t) => { const wait = t0 + t * 1000 - (await pg.evaluate(() => Date.now())); if (wait > 0) await pg.waitForTimeout(wait); };
const fail = (pg, what) => { if (pg.__err.length) throw new Error(`${what}: ${pg.__err.join(' | ')}`); };

// ---- each badge over time, from its first frame: the arrival, held, and settled (dimmed after 4 s) ----
const BADGES = [
  ['hill_capture_started', 'live-hill-capture-ours', 'HILL CAPTURE STARTED, our team (blue)', 'Our bar leaves 0 on a point nobody holds. Everyone in range sees this badge, in BLUE.'],
  ['hill_capture_started', 'live-hill-capture-enemy', 'HILL CAPTURE STARTED, the other team (red)', 'RED`s bar leaves 0. We see it too, in RED: the badge always wears the capturing team`s colour.'],
  ['hill_captured', 'live-hill-captured', 'HILL CAPTURED (ships)', 'For comparison: the badge that ships today.'],
  ['hill_lost', 'live-hill-lost', 'HILL LOST (ships)', 'For comparison: the badge that ships today.'],
];
const TIMES = [[0.15, 'arriving'], [1, 'held'], [4.6, 'settled (dims after 4 s)']];
const seqs = [];
for (const [kind, stage, label, note] of BADGES) {
  const id = stage.replace(/^live-/, '');
  const runs = [];
  for (const skin of SKINS) for (const view of VIEWS) {
    const pg = await openPg(view, stage, skin);
    await pg.waitForFunction(k => window.__badge[k], kind, { timeout: 15000 });
    const t0 = await pg.evaluate(k => window.__badge[k], kind), frames = [];
    for (const [t, what] of TIMES) { await at(pg, t0, t); frames.push({ t, what, f: await shot(pg, `seq-${id}-${skin.name}-${view.name}-${String(t).replace('.', '_')}.png`) }); }
    fail(pg, `${stage} ${skin.name} ${view.name}`);
    runs.push({ skin: skin.name, view, frames }); await pg.close();
  }
  seqs.push({ kind, label, note, runs }); console.log('badge', id);
}

// ---- the clash: a capture starts while I am DOWN ----
const clash = [];
for (const skin of SKINS) for (const view of VIEWS) {
  const pg = await openPg(view, 'down-hill-capture', skin), frames = [];
  await pg.waitForFunction(() => { const s = window.brxDemo && window.brxDemo.state(); return s && !s.alive && s.lanes && s.lanes.obj.hill && s.lanes.obj.hill.kind === 'hill_capture_started'; }, null, { timeout: 15000 });
  await pg.waitForTimeout(300);
  frames.push({ f: await shot(pg, `clash-${skin.name}-${view.name}-0.png`), cap: '<b>Down</b> RED started to capture 0.3 s ago. The badge waits on the lane; the down screen owns the phone.' });
  await pg.waitForFunction(() => window.brxDemo.state().alive, null, { timeout: 15000 });
  const t0 = await pg.evaluate(() => Date.now());
  await at(pg, t0, 0.4); frames.push({ f: await shot(pg, `clash-${skin.name}-${view.name}-1.png`), cap: '<b>Respawn +0.4 s</b> REDEPLOYED. The badge draws at once, beside it (as HILL CAPTURED does today).' });
  await at(pg, t0, 2.6); frames.push({ f: await shot(pg, `clash-${skin.name}-${view.name}-2.png`), cap: '<b>Respawn +2.6 s</b> The live HUD, the badge still up, already dimmed: its 4 s ran while I was down, and it clears 8 s after it arrived.' });
  fail(pg, `clash ${skin.name} ${view.name}`);
  clash.push({ skin: skin.name, view, frames }); await pg.close(); console.log('clash', skin.name, view.name);
}
// ---- Rockets: the shot-ready shine (bench 2026-10-02, "The little green animation doesn't play for rockets") ----
// Frames from the rocket's own report: dimmed while the next rocket is not due, then the green shine at 1 s.
const RK_TIMES = [[0.4, 'dimmed: the next rocket is not due'], [1.06, 'the next rocket is due: the shine']];
const rockets = [];
for (const [which, port] of [['before', srvB && srvB.address().port], ['built', PORT]]) {
  if (!port) continue;
  for (const skin of SKINS) for (const view of VIEWS) {
    const pg = await openPg(view, 'live-pu-rockets', skin, port);
    await pg.waitForFunction(() => { const s = window.brxDemo && window.brxDemo.state(); return s && s.activeSlot === 2 && !s.switchCard && !document.querySelector('#overlay .mo.switched, #overlay .mo.switching'); }, null, { timeout: 15000 });
    await pg.waitForTimeout(1500);   // the ACTIVE card's fade is gone
    const t0 = await pg.evaluate(() => { window.brxDemo.puFire(); return Date.now(); }), frames = [];
    for (const [t, what] of RK_TIMES) { await at(pg, t0, t); frames.push({ t, what, cool: await pg.evaluate(() => document.getElementById('frame').dataset.cool || 'none'), f: await shot(pg, `rockets-${which}-${skin.name}-${view.name}-${String(t).replace('.', '_')}.png`) }); }
    fail(pg, `rockets ${which} ${skin.name} ${view.name}`);
    rockets.push({ which, skin: skin.name, view, frames }); await pg.close();
  }
  console.log('rockets', which);
}
// ---- "Hill Contested": when the voice line plays (Tony, 2026-10-02). Audio, so a timeline: the real engine on the
// stage, fed one control point's adverts on a script, with every VB0O write it makes stamped. BLUE (tid 1) holds it.
const CT_SCRIPT = [[0, 1, 100, 'BLUE holds it: scoring'], [1.5, 1 | 2, 98, 'RED steps in: contested, scoring stops'], [4, 1, 98, 'RED leaves: scoring resumes'],
  [6, 1 | 2, 97, 'RED is back: contested again'], [7, 1 | 2, 97, 'still contested (adverts and ticks go on)'], [8, 1 | 2, 96, 'still contested'], [9.5, 1, 96, 'scoring resumes']];
const CT_END = 10.5, contestRuns = [];
for (const [who, q] of [['BLUE, the holder', ''], ['RED, the attacker standing on the point', '&team=red']]) {
  const pg = await openPg(VIEWS[0], 'live-koth', { name: 'day', q }, PORT);
  await pg.waitForFunction(() => { const s = window.brxDemo && window.brxDemo.state(); return s && s.phase === 'live' && s.alive; }, null, { timeout: 15000 });
  await pg.waitForTimeout(1500);
  const said = await pg.evaluate(async ([script, end]) => {
    const e = window.brx.engine, out = [], w = e.writer, t0 = Date.now();
    e.writer = fr => { for (const f of fr) if (/VB0O/.test(f)) out.push((Date.now() - t0) / 1000); return w(fr); };
    for (const [t, state, value] of script) { const wait = t0 + t * 1000 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); window.brxDemo.point(1, state, value); }
    await new Promise(r => setTimeout(r, Math.max(0, t0 + end * 1000 - Date.now())));
    e.writer = w; return out;
  }, [CT_SCRIPT, CT_END]);
  fail(pg, `contested ${who}`);
  contestRuns.push({ who, said }); await pg.close(); console.log('contested', who, said);
}
await b.close(); srv.close(); if (srvB) srvB.close();

// Tony's notes after each round go here, verbatim, with where the page answers each one.
const CHANGED = [
  ['1', 'the copy: one generic badge, HILL CAPTURE STARTED, tinted in the CAPTURING team`s colour, shown to everyone whenever any team`s capture progress starts rising', 'built. It replaces TAKING THE HILL and HILL UNDER ATTACK (and the interim TEAM / ENEMY IS CAPTURING). See the side by side, in BLUE and in RED.'],
  ['2', 'attackers draining an enemy point see it too', 'built: a drain is a capture starting, for both sides. One episode per capturing team, so a steal (the drain, then the build) is one badge.'],
  ['3', 'if we have the voice then we dont need the badge', 'no CONTESTED badge.'],
  ['Voice', 'Hill contested should play whenever you stop scoring points because of the other team`s presence', 'built: the HOLDING team hears it once each time a contest stops its scoring, and again after scoring resumed and stopped again. The attacker does not. See the timeline.'],
];
const fig = (f, cap) => `<figure><img src="${f}" alt="${esc(cap.replace(/<[^>]+>/g, ''))}" loading="lazy"><figcaption>${cap}</figcaption></figure>`;
const title = s => `${s.skin === 'day' ? 'Day' : 'Night'} · ${s.view.label}`;
// side by side: the four badges at the "held" frame, one row per skin and width
const side = SKINS.flatMap(skin => VIEWS.map(view => `<h3>${title({ skin: skin.name, view })}</h3><div class="row4">${seqs.map(s => {
  const r = s.runs.find(x => x.skin === skin.name && x.view === view), fr = r.frames[1];
  return fig(fr.f, `<b>${esc(s.label)}</b>`); }).join('')}</div>`)).join('');
const seqHtml = seqs.slice(0, 2).map(s => `<section><h3>${esc(s.label)}</h3><p class="mut">${esc(s.note)}</p>${s.runs.map(r => `<h3 class="mut">${title(r)}</h3><div class="strip">${r.frames.map(fr => fig(fr.f, `<b>t ${fr.t} s</b> ${esc(fr.what)}`)).join('')}</div>`).join('')}</section>`).join('');
const rkHtml = SKINS.flatMap(skin => VIEWS.map(view => { const cell = w => rockets.find(x => x.which === w && x.skin === skin.name && x.view === view);
  const strip = (w, lab) => { const r = cell(w); return r ? `<p class="mut"><b>${lab}</b></p><div class="strip">${r.frames.map(fr => fig(fr.f, `<b>t ${fr.t} s</b> ${esc(fr.what)} (gauge cue: ${esc(fr.cool)})`)).join('')}</div>` : ''; };
  return `<h3>${title({ skin: skin.name, view })}</h3>${strip('before', 'BEFORE (0.4.16)')}${strip('built', 'BUILT')}`; })).join('');
const pct = t => `${(100 * t / CT_END).toFixed(2)}%`;
const ctSeg = CT_SCRIPT.map(([t, state, , what], i) => { const to = i + 1 < CT_SCRIPT.length ? CT_SCRIPT[i + 1][0] : CT_END;
  return `<div class="seg ${state & 2 ? 'ct' : 'ok'}" style="left:${pct(t)};width:${pct(to - t)}" title="${esc(what)}"></div>`; }).join('');
const ctRows = contestRuns.map(r => `<div class="tl"><span class="tlab">${esc(r.who)}</span><div class="track">${r.said.map(t => `<div class="vo" style="left:${pct(t)}"><span>Hill Contested</span></div>`).join('')}</div></div>`).join('');
const ctHtml = `<div class="tl"><span class="tlab">The point (advert)</span><div class="track">${ctSeg}</div></div>${ctRows}
<div class="tl"><span class="tlab"></span><div class="track axis">${Array.from({ length: Math.floor(CT_END) + 1 }, (_, i) => `<span style="left:${pct(i)}">${i} s</span>`).join('')}</div></div>
<ol class="mut">${CT_SCRIPT.map(([t, , , what]) => `<li>${t} s: ${esc(what)}</li>`).join('')}</ol>
<p class="mut">What the engine wrote: ${contestRuns.map(r => `${esc(r.who)}: ${r.said.length ? r.said.map(t => t.toFixed(1) + ' s').join(', ') : 'nothing'}`).join(' · ')}.</p>`;
const clashHtml = clash.map(c => `<h3>${title(c)}</h3><div class="strip">${c.frames.map(fr => fig(fr.f, fr.cap)).join('')}</div>`).join('');
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KOTH capture alerts</title>
<style>:root{color-scheme:dark;--bg:#0b0e12;--fg:#e8edf2;--mut:#8a96a3;--edge:#262d36}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:1500px;margin:0 auto}h1{font-size:22px;margin:0 0 6px}h2{font-size:18px;margin:34px 0 4px;border-top:1px solid var(--edge);padding-top:14px}h3{font-size:14px;margin:18px 0 6px}
p{margin:0 0 10px;max-width:1000px}.mut{color:var(--mut)}.strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}.strip figure{flex:0 0 380px}
.row4{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:8px}figure{margin:0}img{width:100%;height:auto;display:block;border:1px solid var(--edge)}
figcaption{font-size:12px;color:var(--mut);margin-top:3px}figcaption b{color:var(--fg)}
.q{border:1px solid #b58432;background:#15130c;padding:10px 14px;margin:12px 0 18px;max-width:1000px}.q h2{border:0;margin:0 0 4px;padding:0;font-size:16px}
ol,ul{margin:4px 0 10px;padding-left:20px;max-width:1000px}li{margin-bottom:6px}.done{color:var(--mut)}
.tl{display:flex;align-items:center;gap:10px;margin:6px 0;max-width:1100px}.tlab{flex:0 0 260px;font-size:12px;color:var(--mut)}.track{position:relative;flex:1;height:30px;border:1px solid var(--edge);background:#11161c}
.seg{position:absolute;top:0;bottom:0}.seg.ok{background:#1d4d33}.seg.ct{background:#6b4a12}.vo{position:absolute;top:0;bottom:0;border-left:3px solid #ffb020}.vo span{position:absolute;left:4px;top:6px;font-size:11px;white-space:nowrap;color:#ffd27a}
.axis{border:0;background:none;height:16px}.axis span{position:absolute;font-size:11px;color:var(--mut);transform:translateX(-50%)}</style></head><body><main>
<h1>King of the Hill: a capture begins</h1>
<p class="mut">Frozen renders of the real phone HUD. The demo stages drive the real engine with phone control-point adverts. Day and night, at the two screen-gate widths. Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC on ${esc(BASE)} (branch hud-capture-begins-alert, not on main yet).</p>
<div class="q"><h2>Open question</h2><ol start="4">
<li><b>After a respawn.</b> A hill badge that arrived while I was down draws at once beside REDEPLOYED (see the clash). That is what HILL CAPTURED does today. A: keep. B: hold every hill badge until REDEPLOYED ends, as the kill card does.</li>
</ol><p class="done">Answered: 1, the copy (one badge, HILL CAPTURE STARTED, in the capturing team's colour); 2, the attackers' drain (everyone sees the badge, attackers too); 3, no CONTESTED badge (the holder's "Hill Contested" voice line is the whole signal). See "Changed since your notes".</p></div>
${CHANGED.length ? `<div class="q"><h2>Changed since your notes</h2><ul>${CHANGED.map(([n, note, what]) => `<li><b>${n}</b> “${esc(note)}” → ${what}</li>`).join('')}</ul></div>` : ''}
<h2>How it decides</h2>
<ul><li>The phone decides from the control point's advert it already hears (owner, held, contested, rising, falling, progress). No MC.</li>
<li>HILL CAPTURE STARTED: a team's capture starts when its bar leaves 0 on a point nobody holds, or when it starts to drain a point another team holds or is building.</li>
<li>Once per capture episode per team, never per advert. A capture that stalls and resumes is one episode, and so is a steal (the drain to 0, then the build). It ends when that team's progress is gone, the point is whole again, or the team owns it. At most one badge per team per 10 s, against a flapping advert.</li>
<li>The first advert of a point is adopted silently, as the owner is: walking up to a capture already under way shows nothing.</li>
<li>It is the same OBJECTIVE hill badge as HILL CAPTURED and HILL LOST, so the newest hill fact replaces the last one, and it waits under the down screen and the weapon switch card exactly as they do.</li>
<li>⚠ The advert names the point's team, never the drainer. With two teams the drainer is the other one. With three or more a drain shows nothing, and the badge waits for the thief's own build, which the advert does name.</li>
<li>Phone control points only. A grenade hill sends no progress, so it cannot say when a capture begins.</li></ul>
<h2>Side by side: the new badges beside the ones that ship</h2>
<p class="mut">Each 1 s after it appeared.</p>
${side}
<h2>Over time</h2>
<p class="mut">Time 0 is the badge's first frame. It dims after 4 s and clears after 8 s, like every hill badge.</p>
${seqHtml}
<h2>Clash: a capture starts while I am down</h2>
${clashHtml}
<h2>"Hill Contested": when the voice line plays</h2>
<p class="mut">Audio, so a timeline from the real engine (the stage at 891×411, by day). Green: BLUE scores. Amber: contested, so nobody scores. The marks are the engine's own "Hill Contested" writes. The holder hears it once per stall and again after scoring resumed; never per advert or tick. The attacker standing on the point hears nothing: the stall is the holder's.</p>
${ctHtml}
<h2>Rockets: the green shine (bench 2026-10-02)</h2>
<p class="mut">“The little green animation doesn't play for rockets.” The animation is the shot-ready cue: after a round from a slow weapon the ammo gauge dims, then a green shine runs across it when the next round is due. It read only the two loadout slots, so a pickup heavy never had it. The Rockets fire one round a second, which is long enough; the delay was never the cause. Built: a held heavy gets the same cue. The switch card on the pickup (SWITCHING, then ACTIVE) was already the same as an ALT switch, and is unchanged. Night has no moving shine by design: the digits brighten instead. Time 0 is the rocket's report.${srvB ? '' : ' (The BEFORE row was not rendered in this run.)'}</p>
${rkHtml}
</main></body></html>`);
console.log('gallery:', path.join(OUT, 'index.html'));
