// Full end-to-end UI suite: Mission Control web UI + two phone HUDs through every flow, driven through
// the REAL widgets (typed inputs, taps, confirm steps). Spawns its own isolated MC (--demo --no-auth on
// free ports). Asserts both UIs + server state at each step, audits UX (console errors, animations,
// tap targets, aria), and writes shots + a report to app/shots/e2e/. Run: npm run ui:e2e
// Parallel runs: every port is free by default. Set E2E_MC_PORT, E2E_MC_WS_PORT, E2E_OLD_MC_PORT,
// E2E_OLD_MC_WS_PORT or E2E_HUD_PORT to pin one. Set E2E_OUT to write shots + report to another directory.
import { chromium } from 'playwright';
import { monotonicDate } from './monotonic-date.mjs';
import { spawn } from 'node:child_process';
import http from 'http'; import net from 'node:net'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'node:url';
import { DEMO_WEAPONS } from '../src/demo-catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');                       // app/
const REPO = path.resolve(ROOT, '..');
const OUT = process.env.E2E_OUT ? path.resolve(process.env.E2E_OUT) : path.join(ROOT, 'shots', 'e2e');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

// ---------- derived arsenal pool sizes ----------
// Never hardcode a catalogue count here: the same drift broke this file plus the phone's and MC's
// own perk-count tests in one day (2026-09-19), because someone swapped one hardcoded number for
// another instead of deriving it. DEMO_WEAPONS is the artefact the phone actually reads (generated
// from weapons.json + perks.json by mcp/tools/gen_ui_catalog.py) — a row is IN this array only when
// it is not `hidden` (a hidden row is dropped entirely, never flagged `hidden: false`), so its
// length alone is the visible count.
//
// The "N OF M" text is not "N allowed of M non-sidearm lethal primaries" — it is DESIGNER's own
// arithmetic (webapp/mc/src/screens/Designer.tsx SlotEditor + gameSummary.ts computePool/kindRows),
// re-derived here rather than guessed at, because the two halves do NOT move the same way:
//   - M (the denominator) is ALWAYS `weapons.length`, the WHOLE visible catalogue — sidearms and
//     non-lethal support weapons included, never kind- or rule-filtered.
//   - PRIMARY's N excludes `pickup_only` (the heavies) AND `lethal === false` (the non-lethal support
//     guns, weapon-design.md §7.4) — but NOT sidearms; a pistol is a legal primary (kindRows: kind
//     'weapon' returns every non-heavy row, sidearms included).
//   - SECONDARY's "…WEAPONS" N excludes only `pickup_only` — no `lethal` filter at all, so the two
//     non-lethal support guns ARE legal secondaries (confirmed against the live DESIGNER, not assumed).
const VISIBLE_WEAPONS = DEMO_WEAPONS.length;
const PRIMARY_ALLOWED = DEMO_WEAPONS.filter(w => !w.pickup_only && w.lethal !== false).length;
const SECONDARY_ALLOWED = DEMO_WEAPONS.filter(w => !w.pickup_only).length;
// The PISTOLS counts read the same way, and `sidearm` is DESIGNER's own predicate for them
// (Designer.tsx SlotEditor: `weapons.filter(w => w.tags.includes('sidearm'))` for the denominator,
// the allowed rows for the numerator). One trigger moves all three sidearm gates at once — unhiding
// the glock — and whoever does that will not open this file, so none of them may be typed.
const SIDEARMS = DEMO_WEAPONS.filter(w => (w.tags ?? []).includes('sidearm'));
const SIDEARM_IDS = SIDEARMS.filter(w => !w.pickup_only).map(w => w.weapon_id);
const SIDEARM_NAMES = SIDEARMS.filter(w => !w.pickup_only).map(w => w.name);
const SIDEARM_POOL = `SIDEARMS ONLY · ${SIDEARM_IDS.length} OF ${SIDEARMS.length} PISTOLS`;
for (const [label, n, floor] of [['visible', VISIBLE_WEAPONS, 6], ['primary pool', PRIMARY_ALLOWED, 6],
                                 ['secondary weapons pool', SECONDARY_ALLOWED, 6], ['sidearm pool', SIDEARM_IDS.length, 2]]) {
  if (n < floor) { console.error(`FATAL: derived arsenal ${label} collapsed to ${n} — DEMO_WEAPONS looks empty or mis-shapen`); process.exit(3); }
}
const BASE_POOL = `${PRIMARY_ALLOWED} OF ${VISIBLE_WEAPONS}`;               // NO HEAVIES and OPEN both land here (primary)
const AR_OFF_POOL = `${PRIMARY_ALLOWED - 1} OF ${VISIBLE_WEAPONS}`;         // one primary (Assault Rifle) tapped off
const SECONDARY_WEAPONS_POOL = `${SECONDARY_ALLOWED} OF ${VISIBLE_WEAPONS} WEAPONS`;   // secondary slot, WEAPONS kind, OPEN rules
/** A derived string is DATA, and data in a pattern position must be escaped, or the guard's meaning stops
 *  being ours and becomes the catalogue's to change. Ship a weapon called `USP-S (Mk2)` or `Rail Gun [heavy]`
 *  and an unescaped assertion does not fail: it quietly starts matching a pattern nobody wrote, which is the
 *  same fault as a guard that reads text instead of behaviour. Returns `s` as a RegExp LITERAL. EVERY
 *  `new RegExp(...)` built from catalogue-derived text in this file goes through here -- one helper, no copies. */
const rxLit = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A port from the environment, else a free one from the OS. Two runs in two worktrees must not share a port. */
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, () => { const { port } = s.address(); s.close(() => res(port)); }); });
const envPort = async (name) => { const v = process.env[name]; if (v === undefined || v === '') return freePort(); const n = Number(v); if (!Number.isInteger(n) || n <= 0 || n > 65535) { console.error(`FATAL: ${name}=${v} is not a port`); process.exit(3); } return n; };
const MC_PORT = await envPort('E2E_MC_PORT'), MC_WS_PORT = await envPort('E2E_MC_WS_PORT');
const OLD_MC_PORT = await envPort('E2E_OLD_MC_PORT'), OLD_MC_WS_PORT = await envPort('E2E_OLD_MC_WS_PORT');
const HUD_PORT = await envPort('E2E_HUD_PORT');
const MC = `http://127.0.0.1:${MC_PORT}`, HUD = `http://127.0.0.1:${HUD_PORT}`;
let WS = '';   // read from lan.ws_url — the NetServer binds the LAN IP, NOT loopback (first-run finding)

// ---------- tiny framework ----------
const results = []; const findings = [];
let curFlow = 'boot'; let shotN = 0;
let failN = 0;
const ONLY = process.env.ONLY;   // ONLY=<substring> runs just the matching step(s) — for steps that stand alone (e.g. F8b compat)
const step = async (name, fn) => {
  if (ONLY && !name.includes(ONLY) && curFlow !== 'F9 ux-audit') return;   // the rollup + report always run
  const t0 = Date.now();
  try { await fn(); results.push({ flow: curFlow, name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name}`); }
  catch (e) {
    results.push({ flow: curFlow, name, ok: false, ms: Date.now() - t0, err: String(e.message || e).slice(0, 900) });
    console.log(`  ✖ ${name} — ${e.message}`);
    // forensic capture: the exact screens + clickable inventory at the moment of failure
    try {
      const tag = `FAIL${String(++failN).padStart(2, '0')}`;
      for (const [nm, pg] of [['mc', mc], ['hudA', hudA], ['hudB', hudB]]) {
        if (pg) await pg.screenshot({ path: path.join(OUT, `${tag}-${nm}.png`) }).catch(() => {});
      }
      if (mc) {
        const btns = await mc.evaluate(() => [...document.querySelectorAll('button')].map(b => ({ t: (b.textContent || '').trim().slice(0, 26), d: b.disabled, v: b.offsetParent !== null })).filter(b => b.t));
        console.log(`    [forensics] mc buttons: ${JSON.stringify(btns)}`);
        const stt = await fetch(MC + '/api/state').then(r => r.json()).catch(() => null);
        if (stt) console.log(`    [forensics] phase=${stt.phase} go=${stt.readiness?.go} board=${JSON.stringify((stt.readiness?.board || []).map(r => [r.sticker, r.status, (r.blockers || [])[0]]))}`);
      }
    } catch { /* forensics must never mask the failure */ }
  }
};
const flow = (name) => { curFlow = name; console.log(`\n■ ${name}`); };
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = 'condition') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return; } catch { } await sleep(300); } throw new Error(`timeout waiting for ${what}`); };
const api = async (m, p, b) => { const r = await fetch(MC + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return r.json(); };
const st = () => api('GET', '/api/state');
/** MC stepper by position (ARMORY 0 · GAMES/BUILD 1 · KIT 2 · LOBBY 3 · LIVE 4 · RECAP 5) — labels are being renamed, positions are not. */
const nav = (i) => mc.locator('nav button').nth(i).click();

// ---------- servers ----------
const hudSrv = http.createServer((req, res) => { const p = path.join(ROOT, 'www', req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  try { res.setHeader('content-type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'image/jpeg'); res.end(fs.readFileSync(p)); } catch { res.statusCode = 404; res.end(); } }).listen(HUD_PORT);
// refuse to run against a STALE server: a leftover MC on a pinned port once made a whole run test old code
if (await fetch(MC + '/api/state').then(r => r.ok).catch(() => false)) {
  console.error(`FATAL: something already listens on ${MC_PORT} — kill the stale MC first (a previous run left one behind?)`);
  process.exit(3);
}
// The suite serves git-ignored build artifacts as-is: a stale dist once made a whole run "pass" on old UI code
// (review #11). Refuse to run when the sources are newer than the bundles (ALLOW_STALE=1 overrides, e.g. mid-edit).
const newest = (dir) => { let m = 0; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else m = Math.max(m, fs.statSync(f).mtimeMs); } }; walk(dir); return m; };
const mcDistDir = path.join(REPO, 'webapp/mc/dist/assets');
const mcBundle = fs.existsSync(mcDistDir) ? fs.readdirSync(mcDistDir).filter(f => /^index-.*\.js$/.test(f)).map(f => path.join(mcDistDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] : null;
const hudBundle = path.join(ROOT, 'www', 'app.js');
{
  const stale = [];
  if (!mcBundle) stale.push('webapp/mc/dist missing — cd webapp/mc && npm run build');
  else if (newest(path.join(REPO, 'webapp/mc/src')) > fs.statSync(mcBundle).mtimeMs) stale.push('webapp/mc/src is newer than dist — cd webapp/mc && npm run build');
  if (!fs.existsSync(hudBundle)) stale.push('app/www/app.js missing — cd app && npm run build');
  else if (newest(path.join(ROOT, 'src')) > fs.statSync(hudBundle).mtimeMs) stale.push('app/src is newer than www/app.js — cd app && npm run build');
  if (stale.length && !process.env.ALLOW_STALE) { console.error('FATAL: STALE BUNDLE — ' + stale.join('; ')); process.exit(3); }
  if (stale.length) console.log('WARNING (ALLOW_STALE): ' + stale.join('; '));
  console.log('serving MC bundle', mcBundle ? path.basename(mcBundle) : '(none)', '· HUD bundle', path.basename(hudBundle));
}
const mcLog = fs.openSync(path.join(OUT, 'mc-server.log'), 'w');
const PY = process.env.MC_PY || path.join(REPO, '.venv/bin/python');   // test-all passes MC_PY; a worktree may have no .venv
const mcProc = spawn(PY, ['-m', 'brx_mcp.mc', '--demo', '--no-auth', '--port', String(MC_PORT), '--ws-port', String(MC_WS_PORT), '-v'], { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', mcLog, mcLog] });
process.on('exit', () => { try { mcProc.kill(); } catch {} });   // the watchdog/timeout path must not leak the server
await until(async () => mcProc.exitCode === null && (await fetch(MC + '/api/state')).ok, 30000, 'MC server');
// a spawned MC that died (port taken between the pick and the bind) must not let another process answer for it
await sleep(300);
if (mcProc.exitCode !== null) { console.error(`FATAL: the suite's MC exited (code ${mcProc.exitCode}) — see ${path.join(OUT, 'mc-server.log')}`); process.exit(3); }
// ws_url races startup: until the socket binds it can read ':0' (typed verbatim into hudA once —
// the whole suite then dialed a dead port). Wait for a REAL port.
for (let i = 0; i < 40; i++) {
  WS = (await (await fetch(MC + '/api/state')).json()).lan.ws_url;
  if (/:[1-9]\d*\/ws$/.test(WS)) break;
  await new Promise(r => setTimeout(r, 250));
}
if (!/:[1-9]\d*\/ws$/.test(WS)) { console.error('FATAL: lan.ws_url never got a real port:', WS); process.exit(2); }
console.log('node ws:', WS);

// ---------- pages + UX collectors ----------
const browser = monotonicDate(await chromium.launch());
const jsErrors = [];
let expectHttpErrors = false;   // a step that deliberately provokes a 4xx (F3b j) sets this so the rollup doesn't count it
const mkPage = async (name, viewport) => {
  // Each page gets its OWN context: pages share localStorage otherwise, so both HUDs helloed with the SAME
  // persisted node_id and the A8 takeover machinery ate them (the hudB-never-binds mystery, 2026-08-26).
  const ctx = await browser.newContext({ viewport });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(6000);   // a missing selector fails the STEP in 6 s, not 30 s
  pg.on('pageerror', e => jsErrors.push({ page: name, flow: curFlow, err: String(e.message).slice(0, 200) }));
  pg.on('console', m => { if (m.type() === 'error' && !(expectHttpErrors && /Failed to load resource/.test(m.text()))) jsErrors.push({ page: name, flow: curFlow, err: 'console: ' + m.text().slice(0, 200) }); });
  pg.on('response', r => { if (r.status() >= 400 && !expectHttpErrors) jsErrors.push({ page: name, flow: curFlow, err: `HTTP ${r.status()} ${r.request().method()} ${r.url().slice(-60)}` }); });
  return pg;
};
const mc = await mkPage('mc', { width: 1280, height: 800 });
const hudA = await mkPage('hudA', { width: 891, height: 411 });
const hudB = await mkPage('hudB', { width: 891, height: 411 });
const shot = async (pg, tag) => pg.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-${tag}.png`) });
const hudState = (pg) => pg.evaluate(() => window.brx.engine.state());
const anim = async (pg, sel) => pg.evaluate(s => { const el = document.querySelector(s); return el ? getComputedStyle(el).animationName : null; }, sel);
const textAudit = async (pg, screen) => {
  // the stepper's "01".."06" numerals used to saturate the 6-item cap so nothing real ever surfaced (review #6):
  // nav is excluded and the list is uncapped
  const tiny = await pg.evaluate(() => { const out = new Set();
    for (const el of document.querySelectorAll('span,div,td,th,button,a,label')) {
      if (!el.offsetParent || el.children.length || el.closest('nav')) continue;
      const t = (el.textContent || '').trim(); if (!t) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 10) out.add(`${Math.round(fs)}px: "${t.slice(0, 30)}"`);
    } return [...out]; });
  for (const t of tiny) findings.push({ kind: 'tiny-text', where: screen, what: t });
};
const overlapAudit = async (pg, screen, sels) => {
  const boxes = [];
  for (const sel of sels) { const el = pg.locator(sel).first(); if (await el.count()) { const b = await el.boundingBox(); if (b) boxes.push({ sel, ...b }); } }
  const bad = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (ox > 4 && oy > 4) bad.push(`${a.sel} × ${b.sel} overlap ${Math.round(ox)}x${Math.round(oy)}px`);
  }
  for (const w of bad) findings.push({ kind: 'overlap', where: screen, what: w });
  return bad;
};
/** `hard`: on GAMES / DESIGNER / KIT a primary control under 36 px FAILS the step (review #6) — findings only elsewhere. */
const tapAudit = async (pg, screen, hard = false) => {
  const rows = await pg.evaluate(hard => [...document.querySelectorAll('button,[role="button"]')]
    .filter(el => el.offsetParent !== null && !(hard && el.closest('header')))   // hard audits judge the SCREEN's controls, not the shell
    .map(el => { const r = el.getBoundingClientRect(); return { t: (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 28), h: Math.round(r.height), w: Math.round(r.width), aria: !!(el.getAttribute('aria-label') || (el.textContent || '').trim()) }; }), hard);
  const small = [];
  for (const r of rows) { if (r.h < 36) { findings.push({ kind: 'tap-target', where: `${screen}`, what: `"${r.t}" is ${r.w}x${r.h}px (<36px tall)` }); small.push(`"${r.t}" ${r.w}x${r.h}`); } if (!r.aria) findings.push({ kind: 'a11y', where: screen, what: 'button with no accessible name' }); }
  if (hard && small.length) throw new Error(`${screen}: ${small.length} control(s) under 36 px tall — ${small.slice(0, 8).join(', ')}`);
};
/** ONLY= runs skip the boot steps: make sure the MC page is loaded before a standalone step drives it. */
const ensureMc = async () => { if (mc.url() === 'about:blank') { await mc.goto(MC + '/', { waitUntil: 'networkidle' }); await until(async () => (await mc.locator('nav button').count()) >= 5, 25000, 'MC shell'); } };   // the header has FIVE phase tabs since the ☰ menu (F2-21); waiting for six made every standalone step time out before it began (2026-09-04)
// F411: the old GAMES card-shelf (CREATE A GAME, CUSTOMIZE/EDIT/COPY/DELETE cards) is retired along
// with the whole-game SavedGame/preset system it edited (games-presets.md §1: "BUILD creates presets,
// PLAY picks presets"). PLAY's pickers are always on screen (no shelf to open), and a game is now
// composed from eight independent piece picks rather than one saved, named "game" you play/edit/copy.
/** PLAY's mode picker (Games.tsx): a bespoke `role="group" aria-label="game mode"` row of buttons,
 *  `aria-pressed` by the server's own `game_pick`. One tap applies a mode (bench 2026-09-28: the
 *  reshape confirm is gone), and no warning may appear. */
const modeBtn = (label) => mc.locator('[data-testid="picker-mode"]').getByRole('button', { name: label });
const playMode = async (label) => {
  const btn = modeBtn(label);
  if ((await btn.getAttribute('aria-pressed')) === 'true') return;
  await btn.click();
  await until(async () => (await btn.getAttribute('aria-pressed')) === 'true', 6000, `${label} picked on one tap`);
  expect((await mc.locator('[data-testid="confirm-switch"]').count()) === 0, `${label}: no roster warning`);
};
/** BUILD → PLAY, the `◂ BACK TO PLAY` link (screens/Build.tsx). BUILD never starts a game, so unlike
 *  the retired DESIGNER this has no "unsaved edits" confirm to walk through. */
const backToPlay = async (pg = mc) => {
  await pg.click('button:has-text("◂ BACK TO PLAY")');
  await until(async () => (await pg.locator('text=Pick Game').count()) > 0, 6000, 'back on PLAY');
};
/** The MC error strip (CommandBar `button[role=alert]` — a dismissable ▲ line). */
const errStrip = async () => (await mc.locator('button[role="alert"]').allTextContents()).join(' | ');
// End BRAVO's KIT try-out the way a host does. The caller has already seen the server start the try-out. The
// END TRY-OUT button appears only after the next state push reaches the console, so wait for it, never peek once.
const endTryout = async () => {
  const btn = mc.locator('text=END TRY-OUT').first();
  await until(async () => btn.isVisible().catch(() => false), 6000, 'END TRY-OUT on the KIT hero');
  await btn.click();
  await until(async () => !(await st()).kit.trying[pB.player_id], 6000, 'BRAVO try-out ended');
};

let guns = [], pA, pB, bravoTeam, bravoTid;
const watchdog = setTimeout(() => { console.log('WATCHDOG: 7 min — aborting'); try { fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ aborted: true, results, findings, jsErrors }, null, 1)); } catch {} process.exit(2); }, 420000);
watchdog.unref && watchdog.unref();

// ═══ F0 · production-wired hidden door ═══
// This deliberately drives the built app, not tapgate.js in isolation. It prevents the production installer
// call from disappearing while its unit tests remain green (the source-text grep that used to guard this did
// not prove any behavior at all).
flow('F0 utility-door');
await step('built HUD: quick taps and a mid-hold gun link stay put; a held 7th enters utility mode', async () => {
  const pg = await mkPage('utilityDoor', { width: 891, height: 411 });
  try {
    const openHud = async () => {
      await pg.goto(HUD + '/', { waitUntil: 'domcontentloaded' });
      await until(async () => (await pg.locator('#frame').count()) === 1, 6000, 'HUD frame');
    };
    const down = () => pg.locator('#frame').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true });
    const up = () => pg.locator('#frame').dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', isPrimary: true });
    await openHud();
    for (let i = 0; i < 7; i++) { await down(); await up(); await sleep(40); }
    await sleep(1600);
    expect(!pg.url().endsWith('/utility.html'), 'seven quick contacts entered utility mode');

    await openHud();
    for (let i = 0; i < 6; i++) { await down(); await up(); await sleep(40); }
    await down();
    await pg.evaluate(() => { window.brx.link.connected = true; });
    await sleep(1600);
    expect(!pg.url().endsWith('/utility.html'), 'a gun link completed during the hold but utility mode still opened');

    await openHud();
    for (let i = 0; i < 6; i++) { await down(); await up(); await sleep(40); }
    await down();
    await until(() => pg.url().endsWith('/utility.html'), 3000, 'held seventh contact to enter utility mode');
  } finally { await pg.context().close(); }
});

// ═══ F1 · MC setup: armory scan, mode select, config guards ═══
flow('F1 mc-setup');
await step('MC loads at ARMORY (muster)', async () => {
  await api('POST', '/api/session/new', { keep_roster: false });
  await mc.goto(MC + '/'); await until(async () => (await mc.locator('text=MISSION CONTROL').count()) > 0, 10000, 'MC shell');
});
await step('scan armory from the UI → rows appear', async () => {
  await mc.click('text=ARMORY'); await mc.click('text=SCAN ARMORY');
  await until(async () => { const s = await st(); guns = s.armory || []; return (await api('GET', '/api/armory')).length >= 2; }, 15000, 'armory rows');
  guns = await api('GET', '/api/armory');
  await until(async () => (await mc.locator(`text=${guns[0].gun_id}`).count()) > 0, 8000, 'armory row rendered');
  await shot(mc, 'armory-scanned'); await tapAudit(mc, 'armory'); await textAudit(mc, 'armory');
});
await step('the ARMORY gate (HARDWARE READY ▸, or what it waits for) advances to PLAY — the PLAY screen renders (dead GO chip regression)', async () => {
  await mc.click('[data-testid="armory-gate"]');
  await until(async () => (await st()).phase === 'build', 6000, 'server phase build');
  await until(async () => (await mc.locator('[data-testid="picker-mode"]').count()) > 0, 6000, 'PLAY screen rendered (the GAME MODE picker)');
  expect((await mc.locator('text=Pick Game').count()) > 0, 'PLAY header missing');
});
await step('PLAY: the mode picker switches the game — aria-pressed follows the server, the operator note follows the mode (screen truth)', async () => {
  await playMode('FREE-FOR-ALL');
  await until(async () => (await st()).config.mode === 'ffa', 5000, 'ffa applied');
  expect((await modeBtn('FREE-FOR-ALL').getAttribute('aria-pressed')) === 'true', 'FFA button not marked picked');
  // FFA carries no operator note (games-redesign.md §9); TDM's is TEAM HITS DON'T COUNT — the switch
  // below proves the note follows the mode, not just the server's config.
  expect((await mc.locator('[data-testid="operator-note"]').count()) === 0, 'FFA should show no operator note');
  await playMode('TEAM DEATHMATCH');
  await until(async () => (await st()).config.mode === 'tdm', 5000, 'tdm back');
  expect((await modeBtn('TEAM DEATHMATCH').getAttribute('aria-pressed')) === 'true', 'TDM button not marked picked');
  await until(async () => (await mc.locator('[data-testid="operator-note"]').count()) > 0, 6000, 'TDM operator note');
  expect((await mc.locator('[data-testid="operator-note"]').textContent()).includes("TEAM HITS DON'T COUNT"), 'TDM note missing');
  await shot(mc, 'games-modes'); await textAudit(mc, 'play');
});
await step('PLAY: every primary control is ≥ 36 px tall (tap audit is a failure here, not a finding)', async () => { await tapAudit(mc, 'play', true); });
await step('PLAY: NIGHT (MATCH SETTINGS strip) changes the server config and survives a mode switch (F410 removed the venue picker — only NIGHT is tested here)', async () => {
  const daynight = mc.locator('[role="group"][aria-label="day or night"]');
  await daynight.locator('button:has-text("NIGHT")').click();
  await until(async () => (await st()).config.night === true, 5000, 'night on the server');
  await playMode('FREE-FOR-ALL');
  await until(async () => (await st()).config.mode === 'ffa', 5000, 'ffa');
  expect((await st()).config.night === true, 'night was reset by switching mode: ' + JSON.stringify((await st()).config.night));
  await playMode('TEAM DEATHMATCH');
  await until(async () => (await modeBtn('TEAM DEATHMATCH').getAttribute('aria-pressed')) === 'true', 6000, 'TDM playing');
  await daynight.locator('button:has-text("DAY")').click();
  await until(async () => (await st()).config.night === false, 5000, 'day restored');
});
await step('config: fast respawn + short match for the run', async () => {
  const r = await api('PUT', '/api/config', { time_limit_s: 120, respawn: { type: 'auto', delay_s: 4 } });
  expect(r.ok, 'config PUT failed: ' + JSON.stringify(r.errors));
});
await step('LOAD ▸ on PLAY shows LOADED · SENT n/n PHONES and swaps the control to CONTINUE TO KIT ▸; CONTINUE TO KIT ▸ advances to KIT — the KIT screen renders', async () => {
  // PLAY has two states, restored in VQA round 1 (Games.tsx): LOAD ▸ announces the game to the
  // phones and stays on PLAY, then CONTINUE TO KIT ▸ is the way on (`api.setPhase('kit')`). ARMORY's
  // gate is HARDWARE READY ▸.
  await mc.click('[data-testid="game-load"] button:has-text("LOAD ▸")');
  await until(async () => (await st()).game?.loaded === true, 6000, 'server game.loaded');
  await until(async () => (await mc.locator('[data-testid="game-continue-kit"]').count()) > 0, 6000, 'PLAY swaps LOAD for CONTINUE TO KIT');
  expect((await mc.locator('[data-testid="game-loaded-status"]').textContent()).startsWith('LOADED'), 'no LOADED status line after LOAD');
  expect((await st()).phase === 'build', 'LOAD must not advance the phase');
  await mc.click('[data-testid="game-continue-kit"] button:has-text("CONTINUE TO KIT ▸")');
  await until(async () => (await st()).phase === 'kit', 6000, 'server phase kit');
  await until(async () => (await mc.locator('text=KIT EACH PLAYER').count()) > 0 && (await mc.locator('input[aria-label="new operator callsign"]').count()) > 0, 6000, 'KIT screen rendered (header + roster input)');
});
await step('guard: the LOBBY push button exists AND is disabled with an empty roster', async () => {
  // F1 flake (test:all --ui load, 2026-09-27): this used to wait 6 s for the button to render, then
  // make ONE bare `isDisabled()` call with no retry, inheriting the page's blanket 6 s default
  // (mkPage's setDefaultTimeout). Under ~30 concurrent jobs that single un-retried CDP round trip
  // could itself exceed 6 s even once the button already existed and was already correctly disabled —
  // "locator.isDisabled: Timeout 6000ms exceeded" on a passing page. Wait on the real conditions
  // instead (LOBBY actually mounted, the roster read as empty, then the button), each through the
  // polling `until()` helper with a load-tolerant ceiling, and poll the disabled check too rather than
  // trust one shot. This does not weaken the assertion: it still fails if the button never appears or
  // is ever not disabled — break the product (enable it with an empty roster) and this still times out.
  await nav(3);
  await until(async () => (await mc.locator('text=A5 // LOBBY').count()) > 0, 20000, 'LOBBY screen mounted');
  await until(async () => (await mc.locator('[data-roster-empty="1"]').count()) > 0, 20000, 'roster read as empty');
  const btn = mc.locator('[data-lobby-primary="push"] button').first();
  await until(async () => (await btn.count()) > 0, 20000, 'PUSH button rendered');
  await until(async () => (await btn.isDisabled({ timeout: 5000 }).catch(() => false)) === true, 20000, 'push button disabled with empty roster');
  await nav(2);   // back to kit for the join flow
});

// ═══ F2 · roster + both HUDs join (typed-URL UX and fast path) ═══
flow('F2 join');
await step('add ALPHA + BRAVO through the roster input', async () => {
  for (const nm of ['ALPHA', 'BRAVO']) {
    await mc.fill('input[aria-label="new operator callsign"]', nm);
    await mc.click('button:has-text("ADD")');
    await until(async () => (await st()).players.some(p => p.display === nm), 5000, nm + ' added');
  }
});
await step('bind guns through the Kit gun picker; BRAVO to the OTHER team via the team chip — rows leave NO GUN', async () => {
  const s = await st(); pA = s.players.find(p => p.display === 'ALPHA'); pB = s.players.find(p => p.display === 'BRAVO');
  // F413: every team mode defaults to RED + BLUE. BRAVO takes the team ALPHA is NOT on, so the two
  // play on opposite sides (the recap below expects BRAVO's team to win); was a hard-coded YELLOW.
  const other = s.config.teams.find(t => t.team_id !== pA.team_id);
  bravoTeam = other.team_id; bravoTid = other.tid;   // fakeGun.hit/kill name the shooter's $TID
  const row = nm => mc.locator('div[role="button"]:has-text("' + nm + '")').first();
  await row('ALPHA').click();
  const sel = mc.locator('select[aria-label="gun for ALPHA"]');
  const opts = await sel.locator('option').allTextContents();
  expect(guns.every(g => opts.some(o => o.includes(g.gun_id))), 'gun picker does not list every scanned gun: ' + opts.join(','));
  await sel.selectOption(guns[0].gun_id);
  await until(async () => { const t = await row('ALPHA').textContent(); return t.includes(guns[0].gun_id) && !t.includes('NO GUN'); }, 6000, 'ALPHA row shows its gun');
  await row('BRAVO').click();
  await mc.locator('select[aria-label="gun for BRAVO"]').selectOption(guns[1].gun_id);
  await mc.locator('[role="group"][aria-label="team"] button:has-text("' + bravoTeam.toUpperCase() + '")').click();
  await until(async () => { const p = (await st()).players.find(p => p.player_id === pB.player_id); return p.gun_id === guns[1].gun_id && p.team_id === bravoTeam; }, 6000, 'BRAVO gun + team on the server');
  expect((await mc.locator('[role="group"][aria-label="team"] button[aria-pressed="true"]').textContent()).includes(bravoTeam.toUpperCase()), bravoTeam + ' chip not pressed');
  await textAudit(mc, 'kit');
});
await step('KIT: every primary control is ≥ 36 px tall (tap audit is a failure here, not a finding)', async () => { await tapAudit(mc, 'kit', true); });
await step('hudA joins by TYPING the ws URL (the real join UX)', async () => {
  await hudA.goto(`${HUD}/?gun=${encodeURIComponent(guns[0].gun_id + '-' + guns[0].ble.tail)}`);
  await hudA.fill('#mcurl', WS); await hudA.click('button:has-text("CONNECT")');
  await until(async () => (await hudState(hudA)).wsState === 'bound', 10000, 'hudA bound');
  await until(async () => (await st()).players.find(p => p.player_id === pA.player_id).node_id, 10000, 'ALPHA node bound');
  await until(async () => (await hudState(hudA)).phase === 'kitted', 8000, 'hudA kitted');
  await shot(hudA, 'hudA-kitted'); await tapAudit(hudA, 'hud-kitted'); await textAudit(hudA, 'hud-kitted');
});
await step('A10 §4.6: hudA lands on the BRIEFING (game name + loadout line) → BUILD MY KIT ▸ reveals the plates + READY UP', async () => {
  await until(async () => (await hudA.locator('.bf .bfname').count()) > 0, 6000, 'briefing screen');
  const nm = (await hudA.locator('.bf .bfname').textContent()) || '';
  const g = (await st()).config.mode;
  expect(nm.length > 3, 'briefing has no game name');
  expect((await hudA.locator('.bf .bfload').count()) > 0, 'briefing has no loadout line');
  await shot(hudA, 'hudA-briefing'); await tapAudit(hudA, 'hud-briefing'); await textAudit(hudA, 'hud-briefing');
  await hudA.click('[data-act="onBriefDone"]');
  await until(async () => (await hudA.locator('.plate.slot').count()) === 3 && (await hudA.locator('[data-act="onReady"]').count()) > 0, 5000, 'plates + READY UP after the briefing');
  expect((await hudA.locator('[data-act="onBriefing"]').count()) > 0, 'no BRIEFING button on the kitted screen');
  console.log('    briefing for mode', g, '→', nm.trim());
});
await step('hudB joins on the fast path (?mc=)', async () => {
  await hudB.goto(`${HUD}/?mc=${encodeURIComponent(WS)}&gun=${encodeURIComponent(guns[1].gun_id + '-' + guns[1].ble.tail)}`);
  await until(async () => (await st()).players.find(p => p.player_id === pB.player_id).node_id, 10000, 'BRAVO node bound');
  await until(async () => (await hudState(hudB)).phase === 'kitted', 8000, 'hudB kitted');
});
await step('hudB: BUILD MY KIT ▸ (through the briefing) so the plates are up for the rest of the run', async () => {
  await until(async () => (await hudB.locator('[data-act="onBriefDone"]').count()) > 0, 6000, 'hudB briefing');
  await hudB.click('[data-act="onBriefDone"]');
  await until(async () => (await hudB.locator('.plate.slot').count()) === 3, 5000, 'hudB plates');
});
await step('MC shows both nodes LINKED on Kit', async () => {
  await until(async () => (await mc.locator('text=LINKED').count()) >= 1, 8000, 'LINKED badge');
  await shot(mc, 'kit-two-linked');
});

// ═══ F3 · try-out from the MC UI ═══
flow('F3 tryout');
await step('select ALPHA, tap the SMG card → TRYING chip pulses', async () => {
  await mc.locator('div[role="button"]:has-text("ALPHA")').first().click();
  await mc.locator('div[role="button"][aria-label*="SMG"]').first().click();
  await until(async () => (await mc.locator('text=TRYING SMG').count()) > 0, 6000, 'TRYING chip');
  // The chip sits in a no-wrap wrapper span since 88b4d202, and the wrapper's text also starts with TRYING.
  // Read the innermost span: that is the chip that carries the pulse.
  const a = await mc.evaluate(() => { const el = [...document.querySelectorAll('span')].find(x => x.textContent.startsWith('TRYING') && !x.querySelector('span')); return el ? getComputedStyle(el).animationName : null; });
  expect(a && a !== 'none', 'TRYING chip has no pulse animation');
});
await step('hudA shows the try-out hero panel (art + stats)', async () => {
  await until(async () => (await hudA.locator('.tryout').count()) > 0, 6000, 'hero panel');
  expect((await hudA.locator('.tryout .nm').textContent()).includes('SMG'), 'panel is not the SMG');
  // The magazine comes from the catalogue the MC ships, not a literal: the SMG went 72 -> 54 and the literal went stale.
  const smgMag = JSON.parse(fs.readFileSync(path.join(REPO, 'mcp/brx_mcp/mc/weapons.json'), 'utf8')).weapons.find(w => w.weapon_id === 'smg').mag;
  const ln = await hudA.locator('.tryout .ln').textContent();
  expect(ln.includes(`MAG ${smgMag} `), `panel missing MAG ${smgMag}: ${ln}`);
  // A26/defect-2 (2026-09-18): weapon art moved from a CSS background-image (no onerror hook) to an
  // <img>, so a missing jpg can show a fallback glyph instead of the empty box — see the .wpic step below.
  const src = await hudA.evaluate(() => document.querySelector('.tryout .art .wpic')?.getAttribute('src') || '');
  expect(src.includes('smg.jpg'), 'panel art is not smg.jpg');
  await shot(hudA, 'hudA-tryout'); await shot(mc, 'kit-trying');
});
await step('weapon description renders in the hero panel', async () => {
  // This waited for the literal phrase "a hit every", which only existed while `desc` doubled as a
  // balance changelog ("8 a hit every 95ms from a 72-round mag..."). `desc` became player copy on
  // 2026-09-18 and the phrase went with it, so the step was pinned to prose rather than to the thing
  // it meant to check. It now asserts the SELECTED weapon's own description off `demo-catalog.js`,
  // the artefact the UI renders from, so a rewording moves the step instead of breaking it.
  const smg = DEMO_WEAPONS.find(w => w.weapon_id === 'smg');
  expect(!!smg, 'the demo catalogue has no SMG to check a description against');
  // a CONTIGUOUS phrase from the front of the description, escaped and joined on flexible
  // whitespace, so it matches the rendered text however the panel wraps it
  const words = (smg.desc || '').trim().split(/\s+/).slice(0, 5);
  expect(words.length >= 4, `the SMG description is too short to assert on: ${smg.desc}`);
  const probe = new RegExp(words.map(rxLit).join('\\s+'), 'i');
  await until(async () => (await mc.locator(`text=${probe}`).count()) > 0, 6000,
              `the SMG description did not render (looked for "${words.join(' ')}" from demo-catalog.js)`);
});
await step('voice change makes the TAGGER speak (apply.preview reaches the gun)', async () => {
  const before = await hudA.evaluate(() => window.fakeGun.writes.filter(f => f.startsWith('$PLAY')).length);
  // The MALE/FEMALE toggle became a full persona picker: $PSET's trailing tokens are a positional
  // voice pack and the bank carries ~15 families, of which the console offered two (2026-09-01).
  await mc.selectOption('select[aria-label^="voice for"]', 'medic');
  await until(async () => (await hudA.evaluate(() => window.fakeGun.writes.filter(f => f.startsWith('$PLAY')).length)) > before, 8000, 'a $PLAY frame reached the fake gun');
});
await step('diag panel: SHARE LOG ships to MC; PANIC is gone (player-side panic bricks the player)', async () => {
  await hudA.click('#info');
  expect((await hudA.locator('button:has-text("PANIC")').count()) === 0, 'HUD diag must not offer PANIC');
  await hudA.click('button:has-text("SHARE LOG")');
  await until(async () => (await hudA.evaluate(() => window.brx.log.join(' '))).includes('log sent to MC'), 6000, 'log queued to MC');
  await hudA.click('[data-act="onCloseDiag"]');   // F122 (28c9e768) renamed CLOSE ✕ to CLOSE: find the control by its action
  await until(async () => (await hudA.locator('button:has-text("SHARE LOG")').isVisible().catch(() => false)) === false, 4000, 'diag panel closed');
});
await step('END TRY-OUT clears the panel', async () => {
  await mc.click('text=END TRY-OUT');
  await until(async () => (await hudA.locator('.tryout').count()) === 0, 6000, 'panel gone');
});

// ═══ F3b · LOADOUT v2 (docs/spec/loadout.md §6): rules, phone self-serve picks, perks, locks, saved games ═══
flow('F3b loadout');
let cfgBeforeRules = null;
await step('A10 §4.1: host back on PLAY (phase build) → phones show SETTING UP THE GAME, no plates, no READY UP; back to KIT → BRIEFING again', async () => {
  await api('POST', '/api/phase', { phase: 'build' });
  await until(async () => (await hudA.locator('.lobby .setup').count()) > 0 && (await hudA.locator('.plate.slot').count()) === 0 && (await hudA.locator('[data-act="onReady"]').count()) === 0, 8000, 'hudA setting-up screen');
  expect((await hudA.locator('.lobby .setup .t').textContent() || '').includes('SETTING UP'), 'setting-up copy missing');
  await shot(hudA, 'hudA-setting-up');
  const before = (await hudA.evaluate(() => window.brx.engine.reports ? 1 : 0)) ?? 0; void before;
  await api('POST', '/api/phase', { phase: 'kit' });
  await until(async () => (await hudA.locator('.bf .bfname').count()) > 0, 8000, 'briefing after CONTINUE to KIT');
  await hudA.click('[data-act="onBriefDone"]');
  await until(async () => (await hudA.locator('.plate.slot').count()) === 3, 5000, 'plates back');
  await until(async () => (await hudB.locator('[data-act="onBriefDone"]').count()) > 0, 6000, 'hudB briefing');
  await hudB.click('[data-act="onBriefDone"]');
  await until(async () => (await hudB.locator('.plate.slot').count()) === 3, 5000, 'hudB plates back');
});
await step(`(a) PLAY: FREE-FOR-ALL → Kit arsenal "${BASE_POOL}", Rocket tile disabled (pickup_only, never in any pool)`, async () => {
  // F411 decoupled mode from a loadout ruleset: FFA no longer carries its own "NO HEAVIES" default
  // (that lived in the retired GAMES tile/SavedGame system) — a fresh session's misc_loadouts piece is
  // the `standard` builtin, heavies ON, so loadout_policy.preset is OPEN here. Rocket Launcher and Rail
  // Gun stay disabled regardless: pickup_only excludes them from every pool unconditionally, which is
  // exactly why NO HEAVIES and OPEN always landed on the same derived BASE_POOL (see the top of this
  // file) — this step now proves the half of that fact F411 left in place.
  cfgBeforeRules = (await st()).config;
  await nav(1);
  await playMode('FREE-FOR-ALL');            // the roster is unaffected: FFA's own team layout matches TDM's split
  await until(async () => (await st()).config.loadout_policy.preset === 'open', 6000, 'preset open');
  await nav(2);
  await mc.locator('div[role="button"]:has-text("ALPHA")').first().click();
  await until(async () => (await mc.locator(`text=${BASE_POOL}`).count()) > 0, 6000, `arsenal header ${BASE_POOL}`);
  const dis = await mc.locator('div[role="button"][aria-label*="Rocket"]').first().getAttribute('aria-disabled');
  expect(dis === 'true', 'Rocket Launcher tile is not aria-disabled (pickup_only)');
  await shot(mc, 'kit-no-heavies');
});
await step('(a2) defect-2: a missing weapon photo on the KIT arsenal tile shows a glyph, not a silent empty box', async () => {
  // `WeaponArt` (Kit.tsx) renders an <img>, whose onError swaps in a generic weapon glyph — a CSS
  // background-image has no such hook, and a missing jpg used to leave the plain #0a1626-toned tile
  // with nothing on screen saying why (field 2026-09-18, `stripper`/`smoke_gun` before their art
  // landed). Force every weapon jpg to 404 and remount the arsenal grid (PERK unmounts it, PRIMARY
  // remounts it) so its <img>s are recreated under the route.
  await mc.route('**/assets/weapons/*.jpg', route => route.fulfill({ status: 404, body: '' }));
  expectHttpErrors = true;
  try {
    await mc.locator('div[role="button"][aria-pressed]:has-text("PERK")').first().click();
    await mc.locator('div[role="button"]:has-text("PRIMARY")').first().click();
    const tile = mc.locator('div[role="button"][aria-label*="SMG"]').first();
    await until(async () => (await tile.locator('img').count()) === 0, 6000, 'the broken <img> is gone from the SMG tile');
    expect((await tile.locator('svg').count()) > 0, 'no fallback glyph rendered on the SMG tile');
    const box = await tile.locator('svg').first().boundingBox();
    expect(!!box && box.width > 4 && box.height > 4, 'fallback glyph has no visible size: ' + JSON.stringify(box));
    // the WeaponHero panel (the big art beside the slot rail) uses the same component — same check
    // there. NB: the always-mounted PRIMARY/SECONDARY/PERK rail icons also use it but never remount
    // here (nothing changed their weapon_id), so their already-loaded photo is correctly untouched —
    // this only asserts the panes that DID remount under the 404 route.
    await until(async () => (await mc.locator('[data-testid="weapon-hero-art"][data-art="fallback"]').count()) > 0, 6000, 'hero panel is still showing the broken <img>');
    await shot(mc, 'kit-missing-art');
  } finally { await mc.unroute('**/assets/weapons/*.jpg'); expectHttpErrors = false; }
});
await step('(b) hudA: PRIMARY plate → browser → SMG row → EQUIPPED ✓ → MC roster shows SMG (ack + catalog DELIVERED)', async () => {
  await hudA.click('.plate.slot.tap[data-arg="primary"]');
  await until(async () => (await hudA.locator('.lo').count()) > 0, 5000, 'loadout browser open');
  await hudA.click('.lrow[data-arg="weapon:smg"]');
  await until(async () => (await hudA.locator('.ackchip.ok').count()) > 0, 6000, 'EQUIPPED chip');
  const ack = await hudA.evaluate(() => window.brx.engine.loadoutAck);
  expect(ack && ack.ok && ack.key === 'weapon:smg', 'loadout_ack was not delivered for weapon:smg: ' + JSON.stringify(ack));
  const cat = await hudA.evaluate(() => (window.brx.engine.catalog || {}).weapons?.length || 0);
  expect(cat >= VISIBLE_WEAPONS, 'assign did not carry the catalog (weapons=' + cat + ', expected >= ' + VISIBLE_WEAPONS + ')');
  await until(async () => (await mc.locator('div[role="button"]:has-text("ALPHA")').first().textContent()).includes('SMG'), 6000, 'MC roster line shows SMG');
  await shot(hudA, 'hudA-loadout-equipped'); await shot(mc, 'kit-phone-pick');
});
await step('(b2) defect-2: a missing weapon photo in the phone rack shows a glyph, not a silent #0a1626 box', async () => {
  // hud.js `weaponArt` renders an <img> whose onerror swaps to a generic glyph (`.wpicfb`) — a CSS
  // background-image has no error hook, and a missing jpg used to leave the plain box on screen with
  // nothing saying why (field 2026-09-18). Force every weapon jpg to 404 and switch tabs and back so
  // the rack's <img>s are recreated under the route.
  await hudA.route('**/assets/weapons/*.jpg', route => route.fulfill({ status: 404, body: '' }));
  expectHttpErrors = true;
  try {
    await hudA.click('.lotab[data-arg="secondary"]');
    await hudA.click('.lotab[data-arg="primary"]');
    const row = hudA.locator('.lrow[data-arg="weapon:smg"] .thumb');
    await until(async () => (await row.evaluate(el => getComputedStyle(el.querySelector('.wpic')).display)) === 'none', 6000, 'the broken <img> is hidden on the SMG row');
    // Wait for the glyph too, do not assert it straight after the hide. `onerror` hides the <img> and
    // shows the fallback in two separate style writes, so a synchronous assert here races the second
    // one and fails intermittently with "the fallback glyph is not shown" while the UI is correct
    // (seen 2026-09-18). The repo's rule: wait for the condition, never for the previous condition.
    await until(async () => (await row.evaluate(el => getComputedStyle(el.querySelector('.wpicfb')).display)) === 'flex', 6000, 'the fallback glyph is not shown on the SMG row');
    expect((await row.locator('svg').count()) > 0, 'no fallback glyph rendered on the SMG row');
    // .lrow .thumb is a fixed 66×36 CSS box (index.html) — the frame itself is scaled to fit the
    // viewport (`_fitMcLinked`-style transform), so read the authored size, not a scaled bounding rect.
    const size = await row.evaluate(el => ({ w: parseFloat(getComputedStyle(el).width), h: parseFloat(getComputedStyle(el).height) }));
    expect(Math.round(size.w) === 66 && Math.round(size.h) === 36, 'the fallback shifted the row-thumb size: ' + JSON.stringify(size));
    // the detail hero pane uses the same helper — same check there. ⓘ on a DIFFERENT row (shotgun, not
    // yet equipped/rendered) so this is a fresh <img> under the route, not the already-focused SMG one
    // hud.js only just skipped re-rendering unchanged.
    await hudA.click('.lrow[data-arg="weapon:shotgun"] .linfo');
    await until(async () => (await hudA.locator('.lodetail .art .wpicfb').isVisible().catch(() => false)), 6000, 'hero pane fallback glyph');
    expect((await hudA.locator('.lodetail .art .wpic').evaluate(el => getComputedStyle(el).display)) === 'none', 'hero pane still shows the broken <img>');
    await shot(hudA, 'hudA-loadout-missing-art');
  } finally { await hudA.unroute('**/assets/weapons/*.jpg'); expectHttpErrors = false; }
});
// A26 (S20): TRY IT is gone. The SMG row tapped in (b) equipped it AND armed it for test-firing, so MC's
// TRYING chip must already be up with NO second control touched — and the player must still be in the rack,
// because a try-out takeover on every pick would eject them from the list they are scrolling.
await step('(c) A26: the (b) pick already armed the try-out — MC says TRYING SMG and the rack stays on screen', async () => {
  await until(async () => (await mc.locator('text=TRYING SMG').count()) > 0, 6000, 'MC TRYING chip (no TRY IT was tapped)');
  expect((await hudA.locator('.tryout').count()) === 0, 'the try-out panel took over the browser — A26 says the rack stays');
  await until(async () => (await hudA.locator('.lo .lolist').count()) > 0, 5000, 'still in the rack');
  expect((await hudA.locator('text=TRY IT').count()) === 0, 'TRY IT is gone (A26)');
  expect((await hudA.locator('text=REVIEW KIT').count()) > 0, 'the action bar reads REVIEW KIT');
});
await step('(c2) A26: REVIEW KIT ▸ closes the rack onto the three-plate kit summary with READY UP', async () => {
  await hudA.click('.lobtn.review');
  await until(async () => (await hudA.locator('.lobby .plates .plate.slot').count()) === 3, 5000, 'three slot plates');
  expect((await hudA.locator('text=READY UP').count()) > 0, 'READY UP is not on the kit summary');
  await hudA.click('.plate.slot.tap[data-arg="primary"]');
  await until(async () => (await hudA.locator('.lo .lolist').count()) > 0, 5000, 'back in the rack for (d)');
});
await step('(d) hudA PERK tab → Body Armor → MC PERK card + roster show BODY ARMOR (A14: the secondary stays)', async () => {
  await hudA.click('.lotab[data-arg="perk"]');
  await hudA.click('.lrow[data-arg="perk:body_armor"]');
  await until(async () => { const a = await hudA.evaluate(() => window.brx.engine.loadoutAck); return a && a.ok && a.key === 'perk:body_armor'; }, 6000, 'ack for the perk');
  await until(async () => (await st()).players.find(p => p.player_id === pA.player_id).loadout.perk === 'body_armor', 5000, 'server loadout.perk');
  await until(async () => (await mc.locator('div[role="button"]:has-text("ALPHA")').first().textContent()).includes('◆ BODY ARMOR'), 6000, 'roster ◆ BODY ARMOR');
  expect((await mc.locator('text=BODY ARMOR').count()) >= 2, 'PERK card does not show BODY ARMOR');
  await shot(hudA, 'hudA-loadout-perk'); await shot(mc, 'kit-phone-perk');
});
await step('(e) no heavy is listed on the phone under NO HEAVIES', async () => {
  // The phone's PRIMARY tab lists exactly the MC primary pool: a pistol is a legal primary, a
  // `pickup_only` heavy is excluded before NO HEAVIES' own rule applies, and a non-lethal support gun
  // may never be a primary. That is PRIMARY_ALLOWED, derived at the top of this file.
  await hudA.click('.lotab[data-arg="primary"]');
  await until(async () => (await hudA.locator('.lrow').count()) === PRIMARY_ALLOWED, 5000, `${PRIMARY_ALLOWED} rows (the primary pool)`);
  expect((await hudA.locator('.lrow[data-arg="weapon:rocket_launcher"]').count()) === 0, 'rocket launcher listed under NO HEAVIES');
});
await step('(f) READY UP while a try-out is armed ends it; first ready does NOT advance to lobby', async () => {
  // A26: the row tap is the whole try-out. READY UP lives on the kit summary, so the path out of the rack is
  // REVIEW KIT ▸ — and leaving the rack must not leave a try-out panel sitting over the plates.
  await hudA.click('.lrow[data-arg="weapon:shotgun"]');
  await until(async () => { const a = await hudA.evaluate(() => window.brx.engine.loadoutAck); return a && a.ok && a.key === 'weapon:shotgun'; }, 6000, 'shotgun equipped');
  await until(async () => (await mc.locator('text=TRYING SHOTGUN').count()) > 0, 6000, 'MC TRYING SHOTGUN (armed by the row tap alone)');
  await hudA.click('.lobtn.review');
  await until(async () => (await hudA.locator('.lobby .plates .plate.slot').count()) === 3, 6000, 'the three-plate kit summary');
  expect((await hudA.locator('.tryout').count()) === 0, 'a try-out panel is covering the kit summary');
  await until(async () => (await hudA.locator('[data-act="onReady"]').count()) > 0, 5000, 'READY UP visible');
  await hudA.locator('[data-act="onReady"]').first().dispatchEvent('click');   // the HUD re-renders on the ack-chip timer; a stability-gated click races it
  await until(async () => (await st()).players.find(p => p.player_id === pA.player_id).ready === true, 6000, 'ALPHA ready');
  await until(async () => (await mc.locator('text=TRYING SHOTGUN').count()) === 0, 6000, 'MC TRYING chip cleared by ready');
  await sleep(600);
  expect((await st()).phase === 'kit', 'phase advanced to lobby on the FIRST ready (regression)');
  await hudA.locator('[data-act="onReady"]').first().dispatchEvent('click');   // un-ready again so F4 readies both from a clean state
  await until(async () => (await st()).players.find(p => p.player_id === pA.player_id).ready === false, 6000, 'ALPHA un-ready');
});
await step('(g) BUILD + PLAY: a FIXED-primary piece (Silenced Sniper) picked on PLAY → both phones padlocked "FIXED BY THE HOST"; MC shows the LOADOUTS RESET notice', async () => {
  // F411 retired the whole-game SavedGame this step used to drive through the GAMES card + DESIGNER
  // (games-presets.md §1: "No migration"). The FIXED-primary hazard it protects is unchanged — BUILD
  // creates the piece (BUILD's own editor UI is its own e2e suite's job, test/e2e/build.mjs), PLAY
  // picks it, same as an operator would. Created via the API rather than driving BUILD's editor here,
  // to keep this suite's job (MC + phones, end to end) separate from BUILD's own.
  const piece = await api('POST', '/api/pieces', { kind: 'primary', name: 'Silenced Sniper',
    value: { choice: 'fixed', kinds: ['weapon'], fixed_id: 'sniper_rifle', exclude_tags: [], exclude_ids: [], only_ids: [] } });
  expect(piece.piece_id, 'BUILD did not create the Silenced Sniper piece: ' + JSON.stringify(piece));
  await nav(1);
  await until(async () => (await mc.locator('[data-testid="picker-primary"]').count()) > 0, 6000, 'the PRIMARY picker to appear with a second piece');
  await mc.locator('[data-testid="picker-primary"]').getByRole('button', { name: 'Silenced Sniper' }).click();
  await until(async () => { const c = (await st()).config; return c.loadout_policy.primary.choice === 'fixed' && c.loadout_policy.primary.fixed_id === 'sniper_rifle'; }, 6000, 'silenced sniper applied');
  for (const [pg, nm] of [[hudA, 'hudA'], [hudB, 'hudB']]) {
    // A PRIMARY piece fixes the primary only; the secondary and perk stay the player's pick (the old
    // whole-game Silenced Sniper also fixed those two, so it locked three plates).
    await until(async () => (await pg.locator('.plate.slot.locked').count()) >= 1, 8000, nm + ' locked primary plate');
    expect((await pg.locator('text=FIXED BY THE HOST').count()) > 0, nm + ' missing FIXED BY THE HOST');
  }
  await until(async () => (await mc.locator('text=/LOADOUTS? RESET/i').count()) > 0, 6000, 'the amber LOADOUTS RESET notice on PLAY');
  expect((await mc.locator('[data-testid="picker-primary"]').getByRole('button', { name: 'Silenced Sniper' }).getAttribute('aria-pressed')) === 'true', 'Silenced Sniper option not marked picked');
  await shot(mc, 'games-snipers-reset'); await shot(hudA, 'hudA-locked-snipers');
});
await step('(g2) KIT under Silenced Sniper: both slot cards read FIXED (locked by the game); tapping the SMG tile leaves the loadout unchanged', async () => {
  await nav(2);
  await mc.locator('div[role="button"]:has-text("ALPHA")').first().click();
  await until(async () => (await mc.locator('text=/FIXED (BY THE GAME|· SET IN)/').count()) >= 2, 6000, 'both slot cards read FIXED (locked by the game)');
  const before = JSON.stringify((await st()).players.find(p => p.player_id === pA.player_id).loadout);
  const smg = mc.locator('div[role="button"][aria-label*="SMG"]').first();
  expect((await smg.getAttribute('aria-disabled')) === 'true', 'SMG tile is not aria-disabled under a fixed primary');
  await smg.click({ force: true });
  await sleep(700);
  expect(JSON.stringify((await st()).players.find(p => p.player_id === pA.player_id).loadout) === before, 'tapping a disabled tile changed the loadout');
  expect((await mc.locator('text=TRYING SMG').count()) === 0, 'a disabled tile started a try-out');
  await shot(mc, 'kit-fixed-locked');
});
// F411 retired DESIGNER's whole-game create/edit/copy (a named SavedGame you both authored and played)
// along with the store it lived in (`/api/presets`, games-presets.md §1: "No migration"). Its nearest
// surviving analogue is FAVOURITES (games-presets.md §6): a named bundle of PLAY's own whole pick —
// not an editable/copyable entity, just save the current pick under a name, load it back, rename it,
// delete it. (h)/(h2)/(h3) below prove that shape instead; there is no "copy" or "notes" field, so
// those parts of the old flow have no home any more.
await step('(h) PLAY: SAVE AS A FAVOURITE names the current pick → it appears as a chip', async () => {
  await nav(1);
  await mc.locator('[data-testid="save-favourite"] button').click();
  await mc.fill('input[aria-label="favourite name"]', 'e2e test');
  await mc.click('[data-testid="save-favourite-form"] button:has-text("SAVE")');
  await until(async () => (await api('GET', '/api/favourites')).some(f => f.name === 'e2e test'), 6000, 'favourite saved server-side');
  await until(async () => (await mc.locator('[data-testid="favourites-row"]').getByText('e2e test', { exact: false }).count()) > 0, 6000, 'favourite chip on PLAY');
  await shot(mc, 'games-saved');
});
await step('(h2) PLAY: renaming a favourite (✎ → ✓) commits the new name', async () => {
  const fav = (await api('GET', '/api/favourites')).find(f => f.name === 'e2e test');
  expect(fav, 'no "e2e test" favourite to rename');
  await mc.locator('button[aria-label="rename e2e test"]').click();
  const box = mc.locator(`[data-testid="favourite-rename-${fav.favourite_id}"]`);
  await box.locator('input').fill('e2e test renamed');
  await box.locator('button[aria-label="save rename"]').click();
  await until(async () => (await api('GET', '/api/favourites')).some(f => f.favourite_id === fav.favourite_id && f.name === 'e2e test renamed'), 6000, 'rename committed server-side');
  await until(async () => (await mc.locator('[data-testid="favourites-row"]').getByText('e2e test renamed', { exact: false }).count()) > 0, 6000, 'renamed chip on screen');
});
await step('(h3) PLAY: loading a favourite re-applies its whole pick; delete is a two-tap confirm', async () => {
  await playMode('TEAM DEATHMATCH');   // move the live pick away from the saved FFA + fixed-primary bundle first
  const fav = (await api('GET', '/api/favourites')).find(f => f.name === 'e2e test renamed');
  await mc.locator(`[data-testid="favourite-chip-${fav.favourite_id}"] button`).first().click();
  // Bench 2026-09-28: the pick changed since the save, so the load asks DISCARD YOUR CHANGES? first.
  const ask = mc.locator('[data-testid="favourite-discard"]');
  await until(async () => (await ask.count()) === 1, 6000, 'DISCARD YOUR CHANGES? over changed picks');
  await ask.getByRole('button', { name: 'DISCARD' }).click();
  await until(async () => (await st()).config.mode === 'ffa', 6000, 'loading the favourite re-applied its pick (ffa)');
  await mc.locator('button[aria-label="delete e2e test renamed"]').click();
  await mc.click(`[data-testid="favourite-confirm-delete-${fav.favourite_id}"] button:has-text("CONFIRM")`);
  await until(async () => !(await api('GET', '/api/favourites')).some(f => f.favourite_id === fav.favourite_id), 6000, 'favourite deleted server-side');
  // the FAVOURITE is gone; the PRIMARY piece it referenced still exists (BUILD's own store, untouched
  // by deleting a favourite) — put PLAY back on the builtin so the rest of this run kits normally.
  await mc.locator('[data-testid="picker-primary"]').getByRole('button', { name: 'ALL' }).click();
  await until(async () => (await st()).config.loadout_policy.primary.choice === 'player', 6000, 'primary rules restored to ALL');
});
await step('(i) KIT host-side slot 2: pick a secondary weapon → card + roster line; PERK card → Extended Mags → card (A14: the weapon stays)', async () => {
  await nav(1);
  await playMode('FREE-FOR-ALL');          // back to OPEN rules (player picks every slot)
  await until(async () => (await st()).config.loadout_policy.preset === 'open', 6000, 'open');
  await nav(2);
  await mc.locator('div[role="button"]:has-text("BRAVO")').first().click();
  await mc.locator('div[role="button"]:has-text("SECONDARY")').first().click();
  await until(async () => (await mc.locator('text=ARSENAL // SECONDARY').count()) > 0, 6000, 'arsenal shows the SECONDARY slot');
  await until(async () => (await mc.locator('div[role="button"][aria-label*="Suppressor"]').count()) > 0, 6000, 'weapon tiles for slot 2');
  await mc.locator('div[role="button"][aria-label*="Suppressor"]').first().click();
  await until(async () => { const p = (await st()).players.find(p => p.player_id === pB.player_id); return p.loadout.weapons[1]?.weapon_id === 'suppressor'; }, 6000, 'server slot 2 = suppressor');
  // The KIT sends the try-out AFTER the PATCH resolves, so "slot 2 = suppressor" can be true before the try-out
  // starts. Wait for the try-out itself, or the END TRY-OUT below races it (flaky since the A14 perk slot).
  await until(async () => (await st()).kit.trying[pB.player_id] === 'suppressor', 6000, 'server try-out = suppressor');
  await until(async () => (await mc.locator('div[role="button"]:has-text("SECONDARY")').first().textContent()).includes('SUPPRESSOR'), 6000, 'SECONDARY card shows SUPPRESSOR');
  await until(async () => /SUPPRESSOR/.test(await mc.locator('div[role="button"]:has-text("BRAVO")').first().textContent()), 6000, 'roster line shows the secondary');
  await mc.locator('div[role="button"][aria-pressed]:has-text("PERK")').first().click();     // A14: the PERK card opens the perk arsenal
  await until(async () => (await mc.locator('text=ARSENAL // PERK').count()) > 0, 6000, 'arsenal shows the PERK slot');
  await mc.locator('div[role="button"][aria-label="Extended Mags perk"]').first().click();
  await until(async () => { const p = (await st()).players.find(p => p.player_id === pB.player_id); return p.loadout.perk === 'extended_mags' && p.loadout.weapons[1]?.weapon_id === 'suppressor'; }, 6000, 'server perk = extended_mags AND slot-2 weapon kept (A14)');
  await until(async () => (await mc.locator('div[role="button"][aria-pressed]:has-text("PERK")').first().textContent()).includes('EXTENDED MAGS'), 6000, 'PERK card shows EXTENDED MAGS');
  await until(async () => /◆ EXTENDED MAGS/.test(await mc.locator('div[role="button"]:has-text("BRAVO")').first().textContent()), 6000, 'roster ◆ EXTENDED MAGS');
  // Picking a perk leaves the slot-2 WEAPON try-out running with no END TRY-OUT in sight (the perk hero has none) —
  // recorded as a UI finding; the host has to re-focus a weapon card to end it.
  if ((await st()).kit.trying[pB.player_id]) findings.push({ kind: 'ux', where: 'kit', what: 'equipping a perk over a tried-out secondary weapon leaves that try-out armed; the perk hero offers no END TRY-OUT' });
  await mc.locator('div[role="button"]:has-text("PRIMARY")').first().click();
  await endTryout();
  await shot(mc, 'kit-secondary-host');
});
await step(`(i2) A12: sidearm-only slot 2 → KIT arsenal header reads "${SIDEARM_IDS.length} SIDEARMS", only pistol tiles, hint says SIDEARM; a pistol equips; rules restored`, async () => {
  await api('PUT', '/api/config', { loadout_policy: { secondary: { kinds: ['sidearm'] } } });
  // Compared as a SET: which pistols the server offers is this step's point, and the order is the
  // server's own (see the SIDEARM_IDS derivation at the top of this file — a hidden weapon has no row).
  const wantIds = [...SIDEARM_IDS].sort().join(',');
  await until(async () => [...(await st()).loadout_pool.secondary_weapons].sort().join(',') === wantIds, 6000, `server pool = the visible pistols (${wantIds})`);
  await mc.locator('div[role="button"]:has-text("BRAVO")').first().click();
  await mc.locator('div[role="button"]:has-text("SECONDARY")').first().click();
  const sidearmHdr = `ARSENAL // SECONDARY · ${SIDEARM_IDS.length} SIDEARMS`;
  await until(async () => (await mc.locator(`text=${sidearmHdr}`).count()) > 0, 6000, `arsenal header reads ${sidearmHdr}`);   // A14: no kind Seg on slot 2 any more
  expect((await mc.locator('button:has-text("WEAPONS ·")').count()) === 0, 'a WEAPONS chip should not show under a sidearm-only rule');
  await until(async () => (await mc.locator('div[role="button"][aria-label*="Desert Eagle"]').count()) > 0, 6000, 'pistol tiles for slot 2');
  expect((await mc.locator('text=SLOT 2 IS A SIDEARM').count()) > 0, 'the hint should read SLOT 2 IS A SIDEARM');
  await mc.locator('div[role="button"][aria-label*="Desert Eagle"]').first().click();
  await until(async () => { const p = (await st()).players.find(p => p.player_id === pB.player_id); return p.loadout.weapons[1]?.weapon_id === 'deagle'; }, 6000, 'server slot 2 = deagle');
  await until(async () => (await st()).kit.trying[pB.player_id] === 'deagle', 6000, 'server try-out = deagle');   // sent after the PATCH: see (i)
  await until(async () => (await mc.locator('div[role="button"]:has-text("SECONDARY")').first().textContent()).includes('DESERT EAGLE'), 6000, 'SECONDARY card shows DESERT EAGLE');
  await shot(mc, 'kit-sidearms-only');
  await endTryout();
  await api('PUT', '/api/config', { loadout_policy: { preset: 'no_heavies' } });
  await until(async () => (await st()).config.loadout_policy.preset === 'no_heavies', 6000, 'rules restored to NO HEAVIES');
});
await step('(j) a REJECTED host pick shows the server\'s error — no "CHANGED FROM THEIR PHONE", no try-out of the refused weapon', async () => {
  await mc.locator('div[role="button"]:has-text("BRAVO")').first().click();
  await mc.locator('div[role="button"]:has-text("PRIMARY")').first().click();
  const before = JSON.stringify((await st()).players.find(p => p.player_id === pB.player_id).loadout);
  await mc.route('**/api/players/*', async r => {
    if (r.request().method() === 'PATCH') return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"weapon not allowed by the rules"}' });
    return r.continue();
  });
  expectHttpErrors = true;
  try {
    await mc.locator('div[role="button"][aria-label*="Shotgun"]').first().click();
    await until(async () => /weapon not allowed by the rules/i.test(await errStrip()), 6000, 'the server\'s error in the strip');
    await sleep(800);
    expect(/weapon not allowed by the rules/i.test(await errStrip()), 'error strip was wiped by a later call');
    expect((await mc.locator('text=CHANGED FROM THEIR PHONE').count()) === 0, 'a rejected host pick was blamed on the phone');
    expect((await mc.locator('text=TRYING SHOTGUN').count()) === 0, 'a try-out started for the refused weapon');
    expect((await st()).kit.trying[pB.player_id] !== 'shotgun', 'server started a try-out of the refused weapon after the rejected PATCH');
    expect(JSON.stringify((await st()).players.find(p => p.player_id === pB.player_id).loadout) === before, 'loadout changed despite the 400');
    await shot(mc, 'kit-rejected-pick');
  } finally { await mc.unroute('**/api/players/*'); expectHttpErrors = false; }
  await mc.locator('button[role="alert"]').first().click().catch(() => {});   // dismiss the strip
});
// `(k) DESIGNER: PLAY THIS NOW` is DELETED: it proved a single action that edited a draft's time
// limit, saved+named it, applied it and jumped straight to KIT in one tap. PLAY has no draft to save
// (every pick applies at once), and BUILD never starts a game (games-presets.md §1), so that
// collapsed action has no home. The pieces it protects are covered elsewhere: TIME is a real control on
// PLAY's own MATCH SETTINGS strip (`(a)`/`(g)` above pick pieces the same way), and LOAD ▸ → CONTINUE
// TO KIT ▸ landing on KIT is F1's own "LOAD ▸ on PLAY..." step.
await step('restore OPEN rules + the run config so the match flow continues unchanged', async () => {
  const c = cfgBeforeRules;
  await api('PUT', '/api/config', { mode: c.mode, environment: c.environment, night: c.night, time_limit_s: c.time_limit_s, respawn: c.respawn, scoring: c.scoring, health: c.health, teams: c.teams, loadout_policy: { preset: 'open' } });
  await api('PATCH', `/api/players/${pB.player_id}`, { team_id: bravoTeam, loadout: { weapons: [{ weapon_id: 'assault_rifle' }] } });
  await api('PATCH', `/api/players/${pA.player_id}`, { loadout: { weapons: [{ weapon_id: 'smg' }] } });
  await until(async () => { const s = await st(); return s.config.loadout_policy.preset === 'open' && s.players.find(p => p.player_id === pA.player_id).loadout.weapons[0].weapon_id === 'smg'; }, 6000, 'restored');
  await nav(2);
});

// ═══ F4 · ready → push → armed → reschedule → abort ═══
flow('F4 lobby-armed');
await step('both HUDs tap READY UP', async () => {
  for (const [pg, pid] of [[hudA, () => pA.player_id], [hudB, () => pB.player_id]]) {
    await pg.click('[data-act="onReady"]');
    await until(async () => (await st()).players.find(p => p.player_id === pid()).ready, 6000, 'ready flag');
  }
  await until(async () => (await st()).readiness.go === true, 20000, 'readiness green-light');
});
await step('PUSH CONFIG from the Lobby UI → 2/2 acked', async () => {
  // all-ready AUTO-advances kit→lobby (the view follows) — only click Kit's CONTINUE if that didn't happen
  if ((await st()).phase !== 'lobby') { await mc.click('button:has-text("CONTINUE ▸")'); }
  await until(async () => (await st()).phase === 'lobby', 6000, 'server phase lobby');
  await until(async () => (await mc.locator('[data-lobby-primary="push"] button').count()) > 0, 6000, 'lobby rail visible');
  // Bench 2026-09-17: the countdown picker appears only once the push is in sync, beside ARM COUNTDOWN.
  expect((await mc.locator('select[aria-label="countdown length"]').count()) === 0, 'no countdown picker before the push');
  await mc.click('[data-lobby-primary="push"] button');
  await until(async () => { const s = await st(); const a = s.lobby.acks || {}; return Object.values(a).filter(x => x.ok).length === 2; }, 20000, '2 acks');
  await until(async () => (await mc.locator('button:has-text("ARM COUNTDOWN")').count()) > 0, 8000, 'arm button');
  await until(async () => (await mc.locator('select[aria-label="countdown length"] option', { hasText: '00:10' }).count()) > 0, 8000, 'quick 10s runway preset in the picker once in sync');
  await shot(mc, 'lobby-acked');
});
await step('HUDs show ARMED-PENDING then echo OK (head landed)', async () => {
  await until(async () => (await hudState(hudA)).headEcho, 8000, 'hudA echo');
  await shot(hudA, 'hudA-lobby-echo');
});
await step('ARM COUNTDOWN (01:00 runway) → Armed screen + HUD T-MINUS overlay', async () => {
  // the countdown segmented control became a <select> when the lobby rail was rebuilt (2026-09-01)
  await mc.selectOption('select[aria-label="countdown length"]', '60');
  await mc.click('button:has-text("ARM COUNTDOWN")');
  await until(async () => (await st()).phase === 'armed', 8000, 'phase armed');
  await until(async () => (await hudA.locator('.mo.tminus').count()) > 0, 8000, 'hudA T-minus overlay');
  const t = await hudA.locator('.mo.tminus').textContent();
  expect(/T-MINUS/i.test(t), 'overlay has no T-MINUS text');
  await shot(hudA, 'hudA-tminus'); await shot(mc, 'armed-screen'); await tapAudit(mc, 'armed');
});
await step('RESCHEDULE is a two-step confirm and moves go-live', async () => {
  const before = (await st()).start.go_live_t;
  await mc.click('button:has-text("RESCHEDULE")');
  await mc.click('button:has-text("CONFIRM — RESTART")');
  await until(async () => (await st()).start.go_live_t > before, 8000, 'go_live_t moved');
});
await step('ABORT is a two-step confirm → back to lobby, HUDs stand down', async () => {
  await mc.click('button:has-text("ABORT")');
  await mc.click('button:has-text("CONFIRM ABORT")');
  await until(async () => (await st()).phase === 'lobby', 8000, 'phase lobby');
  await until(async () => (await hudState(hudA)).phase === 'lobby', 8000, 'hudA stood down');
  await shot(hudA, 'hudA-aborted');
});

// ═══ F5 · live: countdown → combat → death overlays → respawn ═══
flow('F5 live');
await step('start (4 s runway via API — 60 s UI minimum is too slow for CI) → both live', async () => {
  await api('POST', '/api/start', { runway_s: 4 });
  await until(async () => (await hudState(hudA)).phase === 'live' && (await hudState(hudB)).phase === 'live', 15000, 'both live');
  const w = await anim(hudA, '.mo.tminus');   // overlay should be gone
  await shot(hudA, 'hudA-live');
});
await step('WEAPONS HOT pill on go', async () => {
  await until(async () => (await hudA.locator('text=WEAPONS HOT').count()) > 0, 3500, 'WEAPONS HOT moment (4 s window)');
});
await step('BRAVO fires; ALPHA takes hits → TAKING FIRE state', async () => {
  await hudB.evaluate(() => window.fakeGun.fire(3));
  const s0 = await hudState(hudA); const pool0 = (s0.hp || 0) + (s0.armor || 0);   // armor absorbs first: the POOL must drop
  await hudA.evaluate(([n, tid]) => window.fakeGun.hit(6, n, tid), [pB.player_num, bravoTid]);
  let sawFire = false;
  await until(async () => { if ((await hudA.locator('.takingfire').count()) > 0) sawFire = true; const s1 = await hudState(hudA); return (s1.hp || 0) + (s1.armor || 0) < pool0; }, 3000, 'HP/armor dropped after the hit');
  for (let i = 0; i < 6 && !sawFire; i++) { await sleep(250); if ((await hudA.locator('.takingfire').count()) > 0) sawFire = true; }
  expect(sawFire, 'TAKING FIRE state never appeared after a hit');
  await shot(hudA, 'hudA-taking-fire');
});
await step('F265: BRAVO miss-only shots refresh ALPHA’s visible PLAYERS board accuracy and keep it LIVE', async () => {
  // The hit above establishes BRAVO's first credited shots.  These next shots deliberately produce no
  // hit/death event: the server must publish the status-derived shots/accuracy change to every bound HUD.
  await hudA.click('[aria-label="Player scores"]');
  await until(async () => (await hudA.locator('.bdpanel').count()) === 1, 6000, 'ALPHA scores board');
  const bravoRow = hudA.locator('.bdpanel .bdr').filter({ hasText: 'BRAVO' });
  const bravoAccuracy = async () => {
    const m = (await bravoRow.innerText()).match(/(\d+)%/);
    return m ? Number(m[1]) : null;
  };
  await until(async () => (await bravoAccuracy()) > 0, 6000, 'credited BRAVO accuracy on ALPHA board');
  const before = await bravoAccuracy();
  expect(before > 0, 'the credited hit must establish a non-zero BRAVO accuracy: ' + before + '%');
  await hudB.evaluate(() => window.fakeGun.fire(4));
  await until(async () => {
    const after = await bravoAccuracy();
    return after !== null && after < before;
  }, 8000, 'BRAVO miss-only accuracy refresh on ALPHA board');
  expect((await hudA.locator('#bdage').innerText()).trim() === 'LIVE', 'fresh score push must keep the board LIVE');
  await hudA.setViewportSize({ width: 740, height: 340 });
  await until(async () => {
    const box = await bravoRow.boundingBox();
    return !!box && box.x >= 0 && box.x + box.width <= 740 && box.y >= 0 && box.y + box.height <= 340;
  }, 3000, 'BRAVO row inside short phone viewport');
  await shot(hudA, 'hudA-f265-miss-only-score');
  await hudA.setViewportSize({ width: 891, height: 411 });
  await hudA.click('[aria-label="Close scores"]');
});
await step('NIGHT OPS live layout: stats must not stack on the ammo corner (regression)', async () => {
  await hudA.evaluate(() => { window.brx.engine.night = true; window.brx.engine._changed(); });
  await hudA.waitForTimeout(400);
  await shot(hudA, 'hudA-night-live');
  const ov = await overlapAudit(hudA, 'hud-night-live', ['.stats', '.ammo', '.vitals', '.clockplate']);
  expect(ov.length === 0, 'night live overlaps: ' + ov.join('; '));
  await hudA.evaluate(() => { window.brx.engine.night = false; window.brx.engine._changed(); });
  await hudA.waitForTimeout(300);
});
await step('RELOAD warns only when actually low; pips track the real mag (loadout-agnostic)', async () => {
  const M = await hudA.evaluate(() => window.brx.engine.state().mag);
  expect(M > 0, 'engine must know the mag');
  const toHalf = M - Math.ceil(M * 0.6);
  await hudA.evaluate(n => window.fakeGun.fire(n), toHalf);          // ~60% full
  await hudA.waitForTimeout(400);
  expect((await hudA.locator('.reload').count()) === 0, `RELOAD must not nag at ~60% of ${M}`);
  const st1 = await hudA.evaluate(() => window.brx.engine.state());
  // Bench 2026-09-17: one pip per round up to 30 rounds, a continuous bar above that.
  if (st1.mag <= 30) {
    const lit = await hudA.locator('.alive .pips i:not(.spent)').count();
    expect(lit === st1.ammo, `pips ${lit} should equal the rounds left ${st1.ammo}/${st1.mag}`);
  } else {
    expect((await hudA.locator('.alive .pips > i').count()) === 0, `a ${st1.mag}-round mag shows a bar, not pips`);
    // "ammobar", not "ammo" -- item 1 (bench 2026-09-17): the bar's class must never collide with the
    // ammo COLUMN's own `.ammo` (position:absolute), which floated the bar over the mag digits.
    expect((await hudA.locator('.alive .bar.ammobar').count()) > 0, `a ${st1.mag}-round mag shows the ammo bar`);
  }
  const low = Math.max(0, st1.ammo - Math.max(1, Math.floor(M * 0.1)));
  await hudA.evaluate(n => window.fakeGun.fire(n), low);             // down to ~10%
  await until(async () => (await hudA.locator('.reload').count()) > 0, 3000, `RELOAD must warn at ~10% of ${M}`);
  await hudA.evaluate(() => window.fakeGun.reload());
  await until(async () => (await hudA.locator('.reload').count()) === 0, 3000, 'RELOAD clears on a fresh mag');
});
await step('kill → DOWN overlay names the killer; MC live rows score it exactly', async () => {
  await hudA.evaluate(([n, tid]) => window.fakeGun.kill(n, tid), [pB.player_num, bravoTid]);
  await until(async () => (await hudA.locator('.mo.down').count()) > 0, 6000, 'DOWN overlay');
  await shot(hudA, 'hudA-down');
  await mc.click('text=LIVE');
  await until(async () => { return st().then(s => { const r = (s.live && s.live.rows) || []; const b = r.find(x => x.display === 'BRAVO'); const a = r.find(x => x.display === 'ALPHA'); return b && a && b.kills === 1 && a.deaths === 1; }); }, 12000, 'exact K/D on MC');
  await shot(mc, 'live-scoreboard');
});
await step('auto respawn (4 s) → REDEPLOYED moment', async () => {
  await until(async () => (await hudState(hudA)).alive === true, 12000, 'respawned');
  await shot(hudA, 'hudA-redeployed');
});

// ═══ F6 · resync mid-live (§3.10) ═══
flow('F6 resync');
await step('BLE drop → NO GUN + reconnect banner (dot blinks)', async () => {
  await hudA.evaluate(() => window.fakeGun.drop());
  await until(async () => (await hudA.locator('text=NO GUN').count()) > 0, 5000, 'NO GUN');
  expect((await hudA.locator('text=GUN LINK LOST').count()) > 0, 'no reconnect banner');
  const a = await anim(hudA, '.dot.off');
  expect(a && a !== 'none', 'NO GUN dot does not blink');
  await shot(hudA, 'hudA-ble-drop');
});
await step('relink → RECONCILING (S7.1: a rejoin holds the gun 3 s, no trigger-first prompt); it clears on its own and a shot goes out', async () => {
  await hudA.evaluate(() => window.fakeGun.relink());
  await until(async () => { const s = await hudState(hudA); return s.reconciling || (await hudA.locator('.reconciling').count()) > 0; }, 6000, 'RECONCILING takeover after the relink');
  await shot(hudA, 'hudA-reconciling');
  await until(async () => { const s = await hudState(hudA); return !s.reconciling && !s.resync; }, 6000, 'reconcile window cleared with no prompt');
  await hudA.evaluate(() => window.fakeGun.fire(1));
  await until(async () => !(await hudState(hudA)).resync, 6000, 'no resync prompt after the shot');
});

// ═══ F7 · end early (confirm) → result → over → recap → CSV → new match ═══
flow('F7 end-recap');
await step('END MATCH EARLY is a two-step confirm', async () => {
  await mc.click('text=END MATCH EARLY');
  await mc.click('text=CONFIRM END');
  await until(async () => (await st()).phase === 'recap', 10000, 'recap phase');
});
await step('HUDs show the FINAL RESULTS screen with stats; OK → the next-match screen', async () => {
  await until(async () => (await hudA.locator('.result').count()) > 0, 8000, 'result screen');
  // A24 replaced the GAME OVER banner with the FINAL RESULTS screen: the kicker is on it in every
  // state (outcome in, pending, or MC never reached), which is exactly why it is what we assert.
  expect((await hudA.locator('text=FINAL RESULTS').count()) > 0, 'no FINAL RESULTS headline');
  const accTxt = (await hudA.locator('.result .cell:has-text("ACCURACY") b').innerText()).trim();
  if (accTxt !== '\u2014') expect(parseInt(accTxt, 10) <= 100, `accuracy reads ${accTxt} — >100% means double-scaled (server sends PERCENT)`);
  expect((await hudA.locator('.result .cell').count()) >= 4, 'stat cells missing');
  await shot(hudA, 'hudA-result'); await shot(hudB, 'hudB-result'); await tapAudit(hudA, 'hud-result');
  const ov = await overlapAudit(hudA, 'hud-result', ['.result .banner', '.result .rstats', '.result .sess', '.result .foot .ready', '.result .syncline']);
  expect(ov.length === 0, 'result-screen elements overlap: ' + ov.join('; '));
  await hudA.setViewportSize({ width: 740, height: 340 });      // shorter real-phone aspect
  await hudA.waitForTimeout(300);
  const ov2 = await overlapAudit(hudA, 'hud-result-short', ['.result .banner', '.result .rstats', '.result .foot .ready']);
  expect(ov2.length === 0, 'result overlaps on a short viewport: ' + ov2.join('; '));
  await hudA.setViewportSize({ width: 891, height: 411 });
  try {
    await until(async () => ((await hudA.locator('.result .syncline').textContent().catch(() => '')) || '').includes('SENT TO THE HOST'), 6000, 'score-delivery confirmation (1s sync poller)');
  } catch (e) {
    const ring = await hudA.evaluate(() => { const t = window.brx.transport; return JSON.stringify({ state: t.state, pending: t.ring.pending().map(x => ({ seq: x.seq, type: x.type, match: x.match_id })) }); });
    throw new Error(e.message + ' — ring ' + ring);
  }
  await hudA.click('[data-act="onEndOk"]');
  // F117 retired the declarative "MATCH COMPLETE" label — the over screen's one control now says what to do.
  await until(async () => (await hudA.locator('text=READY FOR NEXT MATCH').count()) > 0, 6000, 'over screen');
  const hist = await hudA.evaluate(() => JSON.parse(localStorage.getItem('brx.history') || '[]'));
  expect(hist.length === 1 && hist[0].deaths === 1, 'history entry wrong: ' + JSON.stringify(hist));
});
await step('recap is FINAL with connected empty nodes; honors hidden; DATA SYNC board shows ✓', async () => {
  await until(async () => { const s = await st(); return s.recap && s.recap.provisional === false; }, 15000, 'recap finality (zero pending, nodes connected)');
  await mc.click('text=RECAP').catch(() => {});
  expect((await mc.locator('text=PROVISIONAL —').count()) === 0, 'provisional banner must be gone');
  expect((await mc.locator('text=DATA SYNC').count()) > 0, 'DATA SYNC board missing');
  await until(async () => (await mc.locator('text=SYNCED ✓').count()) >= 2, 8000, 'both players synced');
  const ovr = await overlapAudit(mc, 'recap', ['text=/MATCH COMPLETE ·/', 'text=EXPORT CSV', 'text=FULL STATS']);
  expect(ovr.length === 0, 'recap overlaps: ' + ovr.join('; '));
  await shot(mc, 'recap-final');
});
await step("MC recap: rows + BRAVO's team wins + CSV exports", async () => {
  await until(async () => (await mc.locator('text=EXPORT CSV').count()) > 0, 8000, 'recap screen');
  const s = await st();
  expect(s.recap.winner && s.recap.winner.team_id === bravoTeam, bravoTeam + ' should win 1-0: ' + JSON.stringify(s.recap.winner));
  const href = await mc.locator('a:has-text("EXPORT CSV")').getAttribute('href');
  const csv = await (await fetch(MC + href)).text();
  expect(csv.includes('ALPHA') && csv.includes('BRAVO'), 'CSV missing players');
  await shot(mc, 'recap'); await tapAudit(mc, 'recap');
});
await step('NEW SESSION → muster; the HUD LEAVES MATCH COMPLETE and shows SETTING UP THE GAME (kit closed until the host reaches KIT — screen truth)', async () => {
  // Bench 2026-09-17: the RECAP-only NEW SESSION control left the command bar (A43 — LOAD after a
  // match already starts the next one, and RECAP's NEXT MATCH ▸ covers the one-tap case). This step
  // needs the same server transition (a fresh muster, roster kept), so it calls the route directly.
  await api('POST', '/api/session/new', { keep_roster: true });
  await until(async () => (await st()).phase === 'muster', 8000, 'muster');
  expect((await st()).players.length === 2, 'roster not kept');
  await until(async () => (await hudA.locator('text=MATCH COMPLETE').count()) === 0, 10000, 'over screen must clear on new match');
  await until(async () => (await hudA.locator('.lobby .setup').count()) > 0 && (await hudA.locator('[data-act="onReady"]').count()) === 0, 8000, 'SETTING UP THE GAME (no READY UP) while MC is at muster');
  await shot(hudA, 'hudA-new-match-setting-up');
});

// ═══ F8 · guards: panic + evict ═══
flow('F8 guards');
await step('PANIC is a two-step confirm; HUDs tear down to kitted', async () => {
  // PANIC moved out of the header into the ☰ menu when the bar was simplified (2026-09-02) — it is a
  // fleet-wide safe, and a red button permanently in the corner was both loud and easy to brush.
  await mc.click('button[aria-haspopup="menu"]');
  await mc.click('button[role="menuitem"]:has-text("Panic")');
  await mc.click('button:has-text("CONFIRM")');
  let a = null;
  await until(async () => { a = await hudState(hudA); return a.phase === 'kitted' || a.phase === 'lobby'; }, 5000, 'hudA stood down after panic').catch(e => { throw new Error(e.message + ': ' + a?.phase); });
  await shot(mc, 'post-panic');
});
await step('EVICT is a two-step confirm and kicks the node', async () => {
  await nav(2);
  await mc.locator('div[role="button"]:has-text("ALPHA")').first().click();
  await mc.click('button:has-text("EVICT")');
  await mc.click('button:has-text("CONFIRM KICK")');
  await until(async () => { const s = await st(); return !s.players.find(p => p.player_id === pA.player_id).node_id; }, 8000, 'ALPHA unbound');
  await until(async () => { const s = await st(); return s.players.find(p => p.player_id === pA.player_id).node_id; }, 20000, 'hudA auto-rejoined after evict');
});

// F8a `DESIGNER controls` is DELETED: it drove the OLD Designer.tsx slot-rule editor (HEAVY chip,
// OPEN/SNIPERS templates, per-tile taps, the read-only ADVANCED presentation table) in deep, tile-by-
// tile detail, with no phone/HUD involvement at all -- pure MC-screen coverage. BUILD's real editor
// (screens/presets/editors.tsx) replaces Designer.tsx and has its own e2e suite, test/e2e/build.mjs,
// owned by the BUILD lane; this suite's job is end-to-end coverage through the phones, which that
// editor's controls do not touch. The one FIXED-primary/phone-lock hazard worth keeping end-to-end is
// covered above ((g), BUILD + PLAY: Silenced Sniper).


flow('F8b compat-older-server');
await step('compat-older-server: new UI renders ARMORY / PLAY / BUILD / KIT / LOBBY against a server with no loadout fields and no A10 routes', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });   // own context: its 404s are EXPECTED, keep them out of the global audit
  const pg = await ctx.newPage(); pg.setDefaultTimeout(6000);
  const errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
  pg.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  // a faithful pre-A10 shape: no policy, no pool, no browsing, no active preset, no perk on any loadout
  const strip = o => { if (o && typeof o === 'object') { delete o.loadout_policy; delete o.loadout_pool; delete o.active_preset_id; if (o.kit) delete o.kit.browsing; if (o.loadout && typeof o.loadout === 'object') delete o.loadout.perk; for (const k of Object.keys(o)) strip(o[k]); } return o; };
  await pg.route('**/api/**', async r => {
    const u = r.request().url();
    if (/\/api\/(presets|perks|loadout\/pool|presentation)/.test(u)) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });   // pre-A10 / pre-A11 server
    const res = await r.fetch(); let body = await res.text();
    try { body = JSON.stringify(strip(JSON.parse(body))); } catch { /* not JSON */ }
    await r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  // page.route() cannot touch the WebSocket — the live snapshot stream used to arrive COMPLETE, so this step never
  // actually deprived the UI of the loadout fields (review #4). routeWebSocket strips every snapshot frame in flight.
  let wsFrames = 0;
  await pg.routeWebSocket('**/ui-ws*', ws => {
    const server = ws.connectToServer();
    server.onMessage(m => { try { const j = JSON.parse(String(m)); if (j.kind === 'snapshot') { strip(j.state); wsFrames++; } ws.send(JSON.stringify(j)); } catch { ws.send(m); } });
    ws.onMessage(m => server.send(m));
  });
  await pg.goto(MC + '/', { waitUntil: 'networkidle' });
  const nav = async i => { await pg.locator('nav button').nth(i).click(); await pg.waitForTimeout(400); };
  const noCrash = async where => expect((await pg.locator('text=CONSOLE ERROR').count()) === 0, `crash banner on ${where}: ${errs.join(' | ')}`);
  await until(async () => wsFrames > 0, 8000, 'a stripped snapshot arrived over the WebSocket');
  const live = await pg.evaluate(() => fetch('/api/state').then(r => r.json()));
  expect(live.loadout_policy === undefined, 'REST strip failed');
  await nav(1); await noCrash('PLAY');
  await until(async () => (await pg.locator('text=MC SERVER IS OLDER THAN THIS CONSOLE').count()) > 0, 6000, 'the "server predates this UI" banner');
  // F411: `game_pick` and `/api/pieces` are NOT stripped here (this fixture is a server predating
  // loadout policy, not predating PLAY/BUILD itself), so PLAY still renders its pickers normally
  // rather than the F411-specific play-stale-server banner (that path is covered in koth.mjs).
  expect((await pg.locator('[data-testid="picker-mode"]').count()) > 0, 'PLAY renders no mode picker against this stale server');
  await pg.locator('button:has-text("BUILD ▸")').click();
  await pg.waitForTimeout(400); await noCrash('BUILD');
  expect((await pg.locator('text=[ BUILD ]').count()) > 0, 'BUILD does not render against this stale server');
  await pg.locator('button:has-text("◂ BACK TO PLAY")').click();
  await pg.waitForTimeout(400);
  await nav(2); await noCrash('KIT');
  await until(async () => (await pg.locator('text=KIT EACH PLAYER').count()) > 0, 6000, 'KIT rendered');
  expect((await pg.locator('text=GAME RULES').count()) === 0, 'KIT shows a GAME RULES chip with no policy');
  if ((await pg.locator('div[role="button"]:has-text("ALPHA")').count()) > 0) { await pg.locator('div[role="button"]:has-text("ALPHA")').first().click(); await pg.waitForTimeout(400); await noCrash('KIT (player selected)'); expect((await pg.locator('div[role="button"]:has-text("PRIMARY")').count()) > 0, 'KIT slot cards missing for a selected player'); }
  await nav(3); await noCrash('LOBBY'); await until(async () => (await pg.locator('[data-lobby-primary="push"] button').count()) > 0, 6000, 'LOBBY rendered');
  await nav(0); await noCrash('ARMORY');
  await pg.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-compat-older-server.png`) });
  expect(errs.length === 0, 'errors against the stale server: ' + errs.join(' | '));
  await ctx.close();
});

// ═══ F8c · compat: a session persisted BEFORE A10 restores and every page renders (review #12) ═══
flow('F8c compat-old-session');
await step('compat-old-session: MC booted from a pre-A10 session.json → PLAY shows the restored mode picked, KIT shows the restored players, GAME RULES = OPEN, no crash', async () => {
  const MC2 = `http://127.0.0.1:${OLD_MC_PORT}`;
  if (await fetch(MC2 + '/api/state').then(r => r.ok).catch(() => false)) throw new Error(`something already listens on ${OLD_MC_PORT}`);
  const tmp = fs.mkdtempSync(path.join(OUT, 'session-'));
  const sf = path.join(tmp, 'session.json');
  fs.copyFileSync(path.join(HERE, 'fixtures', 'session-preA10.json'), sf);
  const log2 = fs.openSync(path.join(OUT, 'mc-server-oldsession.log'), 'w');
  // NOT --demo: its seeding re-adds GUN-A..H and crashes on the restored players' guns ("gun GUN-A is already assigned",
  // __main__.py build()) — a server finding, recorded in the report; --ephemeral keeps presets off the host's shelf
  findings.push({ kind: 'server', where: 'brx_mcp.mc --demo --session-file', what: '--demo seeding collides with restored players (ValueError: gun GUN-A is already assigned) — the demo seed should skip guns a restored player holds' });
  const proc2 = spawn(PY, ['-m', 'brx_mcp.mc', '--ephemeral', '--no-auth', '--port', String(OLD_MC_PORT), '--ws-port', String(OLD_MC_WS_PORT), '--session-file', sf], { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', log2, log2] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage(); pg.setDefaultTimeout(6000);
  const errs = []; pg.on('pageerror', e => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
  try {
    await until(async () => (await fetch(MC2 + '/api/state')).ok, 30000, 'old-session MC');
    const s2 = await (await fetch(MC2 + '/api/state')).json();
    expect(s2.players.some(p => p.display === 'RESTORED-A') && s2.players.some(p => p.display === 'RESTORED-B'), 'fixture players not restored: ' + s2.players.map(p => p.display).join(','));
    expect(s2.config.loadout_policy && s2.config.loadout_policy.preset === 'open', 'restored config did not get a normalised OPEN policy');
    await pg.goto(MC2 + '/', { waitUntil: 'networkidle' });
    const nav2 = async i => { await pg.locator('nav button').nth(i).click(); await pg.waitForTimeout(400); };
    const noCrash = async where => expect((await pg.locator('text=CONSOLE ERROR').count()) === 0, `crash banner on ${where}: ${errs.join(' | ')}`);
    await nav2(1); await noCrash('PLAY');
    // F411: a session from before PLAY/BUILD has no `game_pick` of its own, and games-presets.md §2
    // says how MC derives one on restore — mode = the restored config's own mode, when it is an MVP
    // mode (it does not recompose the rest of the config). What an old session owes is a PLAY screen
    // whose mode picker shows the restored mode as the one picked.
    const modeBtn2 = label => pg.locator('[data-testid="picker-mode"]').getByRole('button', { name: label });
    await until(async () => (await modeBtn2('TEAM DEATHMATCH').getAttribute('aria-pressed')) === 'true', 6000, 'PLAY shows the restored TEAM DEATHMATCH as picked');
    await nav2(2); await noCrash('KIT');
    await until(async () => (await pg.locator('div[role="button"]:has-text("RESTORED-A")').count()) > 0, 6000, 'restored roster row on KIT');
    expect((await pg.locator('div[role="button"]:has-text("RESTORED-A")').first().textContent()).includes('GUN-A'), 'restored row lost its gun');
    await pg.locator('div[role="button"]:has-text("RESTORED-A")').first().click(); await pg.waitForTimeout(400);
    expect((await pg.locator('text=GAME RULES').count()) > 0 && (await pg.locator('text=GAME RULES').locator('xpath=..').textContent()).includes('OPEN'), 'GAME RULES chip should read OPEN');
    await pg.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-compat-old-session.png`) });
    expect(errs.length === 0, 'errors on the old-session MC: ' + errs.join(' | '));
  } finally { await ctx.close(); try { proc2.kill(); } catch {} }
});

// ═══ F9 · UX audit rollup ═══
flow('F9 ux-audit');
await step('no JS errors on any page across all flows', async () => {
  expect(jsErrors.length === 0, `${jsErrors.length} JS errors: ` + JSON.stringify(jsErrors.slice(0, 3)));
});
await step('write report', async () => {
  const fail = results.filter(r => !r.ok);
  const seen = new Set(); const uniqFindings = findings.filter(f => { const k = f.kind + f.where + f.what; if (seen.has(k)) return false; seen.add(k); return true; });
  const report = { t: new Date().toISOString(), pass: results.length - fail.length, fail: fail.length, results, findings: uniqFindings, jsErrors };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const md = [`# E2E UI report — ${report.t}`, `**${report.pass} passed, ${report.fail} failed** · ${uniqFindings.length} UX findings`, '',
    '## Failures', ...(fail.length ? fail.map(f => `- ✖ ${f.flow} / ${f.name} — ${f.err}`) : ['(none)']), '',
    '## UX findings', ...uniqFindings.map(f => `- [${f.kind}] ${f.where}: ${f.what}`)].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
});

await browser.close(); hudSrv.close(); mcProc.kill();
const fails = results.filter(r => !r.ok).length;
console.log(`\n═══ ${results.length - fails}/${results.length} steps passed · ${findings.length} UX findings · shots+report in ${path.relative(REPO, OUT).startsWith('..') ? OUT : path.relative(REPO, OUT)} ═══`);
process.exit(fails ? 1 : 0);
