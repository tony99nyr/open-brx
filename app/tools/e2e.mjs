// Full end-to-end UI suite: Mission Control web UI + two phone HUDs through every flow, driven through
// the REAL widgets (typed inputs, taps, confirm steps). Spawns its own isolated MC (--demo --no-auth on
// free ports). Asserts both UIs + server state at each step, audits UX (console errors, animations,
// tap targets, aria), and writes shots + a report to app/shots/e2e/. Run: npm run ui:e2e
// Parallel runs: every port is free by default. Set E2E_MC_PORT, E2E_MC_WS_PORT, E2E_OLD_MC_PORT,
// E2E_OLD_MC_WS_PORT or E2E_HUD_PORT to pin one. Set E2E_OUT to write shots + report to another directory.
import { chromium } from 'playwright';
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
const browser = await chromium.launch();
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
/** Show the GAMES shelves (the cards, CREATE A GAME, CUSTOMIZE, EDIT, COPY, DELETE). Once a game is LOADED the
 *  tab shows the loaded game and folds the shelves behind PLAY A DIFFERENT GAME (47a87830, Games.tsx): open them. */
const shelves = async (pg = mc) => {
  const create = pg.locator('button[aria-label="create a game"]'), more = pg.locator('button[data-testid="pick-another"]');
  await until(async () => (await create.count()) > 0 || (await more.count()) > 0, 6000, 'GAMES shelves or PLAY A DIFFERENT GAME');
  if ((await create.count()) === 0 && (await more.getAttribute('aria-expanded')) === 'false') await more.click();
  await until(async () => (await create.count()) > 0, 6000, 'GAMES shelves open');
};
/** Tap a GAMES card. While the draft is TUNED — NOT SAVED the card asks "TAP AGAIN" (review #16): confirm it. */
const playCard = async (label) => {
  const card = mc.locator(`div[role="button"][aria-label="play ${label}"]`).first();
  await shelves();
  await card.click();
  await sleep(250);
  if ((await mc.locator('text=TAP AGAIN').count()) > 0) await card.click();
};
/** DESIGNER → GAMES. With unsaved edits the button asks "TAP AGAIN TO LEAVE" (review #16): confirm it. */
const backToGames = async (pg = mc) => {
  await pg.click('button:has-text("◂ BACK TO GAMES")');
  await sleep(250);
  if ((await pg.locator('text=TAP AGAIN TO LEAVE').count()) > 0) await pg.click('button:has-text("◂ BACK TO GAMES")');
  await shelves(pg);   // back on GAMES, with the shelves showing
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

let guns = [], pA, pB;
const watchdog = setTimeout(() => { console.log('WATCHDOG: 7 min — aborting'); try { fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ aborted: true, results, findings, jsErrors }, null, 1)); } catch {} process.exit(2); }, 420000);
watchdog.unref && watchdog.unref();

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
await step('the ARMORY gate (HARDWARE READY ▸, or what it waits for) advances to GAMES — the GAMES screen renders (dead GO chip regression)', async () => {
  await mc.click('[data-testid="armory-gate"]');
  await until(async () => (await st()).phase === 'build', 6000, 'server phase build');
  await until(async () => (await mc.locator('button[aria-label="create a game"]').count()) > 0, 6000, 'GAMES screen rendered (CREATE A GAME card)');
  expect((await mc.locator('text=PICK THE GAME').count()) > 0, 'GAMES header missing');
});
await step('GAMES: stock mode cards switch the game — PLAYING tag, rail title and LOADOUT row follow (screen truth)', async () => {
  await playCard('FREE-FOR-ALL');
  await until(async () => (await st()).config.mode === 'ffa', 5000, 'ffa applied');
  // the UI snapshot is coalesced (≤4/s): wait until the card itself shows PLAYING before the next click — a card that
  // still believes it is active ignores the tap (`if (!on)`), which is correct app behaviour and a race in a test
  await until(async () => (await mc.locator('div[role="button"][aria-label="play FREE-FOR-ALL"][aria-pressed="true"]').count()) > 0, 6000, 'FFA card shows PLAYING');
  expect((await mc.locator('div[role="button"][aria-label="play FREE-FOR-ALL"]').first().textContent()).includes('PLAYING'), 'FFA card has no PLAYING tag');
  await playCard('TEAM DEATHMATCH');
  await until(async () => (await st()).config.mode === 'tdm', 5000, 'tdm back');
  await until(async () => (await mc.locator('div[role="button"][aria-label="play TEAM DEATHMATCH"][aria-pressed="true"]').count()) > 0, 6000, 'TDM card shows PLAYING');
  const rail = await mc.locator('text=STOCK MODE // PLAYING').locator('xpath=..').textContent();
  expect(/TEAM DEATHMATCH/.test(rail), 'rail title is not TEAM DEATHMATCH: ' + rail.slice(0, 80));
  const load = await mc.locator('text=LOADOUT').locator('xpath=..').first().textContent();
  expect(/OPEN/.test(load) && /PRIMARY: PLAYER PICKS/.test(load) && /SLOT 2:.*WEAPON.*PERK/.test(load), 'LOADOUT row wrong: ' + load);
  await shot(mc, 'games-modes'); await textAudit(mc, 'games');
});
await step('GAMES: every primary control is ≥ 36 px tall (tap audit is a failure here, not a finding)', async () => { await tapAudit(mc, 'games', true); });
await step('GAMES: VENUE seg + NIGHT OPS change the venue → summary VENUE row + server config; venue survives a game switch', async () => {
  const venue = mc.locator('[role="group"][aria-label="venue"]');
  await venue.locator('button:has-text("INDOOR")').click();
  await until(async () => (await st()).config.environment === 'indoor', 5000, 'indoor on the server');
  await venue.locator('button[aria-label="night ops"]').click();
  await until(async () => (await st()).config.night === true, 5000, 'night on the server');
  const row = () => mc.locator('text=VENUE').locator('xpath=..').last().textContent();
  await until(async () => /INDOOR · NIGHT OPS/.test(await row()), 5000, 'summary VENUE row reads INDOOR · NIGHT OPS');
  await playCard('FREE-FOR-ALL');      // venue is tonight's, not the game's
  await until(async () => (await st()).config.mode === 'ffa', 5000, 'ffa');
  await until(async () => (await mc.locator('div[role="button"][aria-label="play FREE-FOR-ALL"][aria-pressed="true"]').count()) > 0, 6000, 'FFA playing');
  const c = (await st()).config; expect(c.environment === 'indoor' && c.night === true, 'venue was reset by playing a game: ' + c.environment + '/' + c.night);
  await playCard('TEAM DEATHMATCH');
  await until(async () => (await mc.locator('div[role="button"][aria-label="play TEAM DEATHMATCH"][aria-pressed="true"]').count()) > 0, 6000, 'TDM playing');
  await venue.locator('button:has-text("OUTDOOR")').click(); await venue.locator('button[aria-label="night ops"]').click();
  await until(async () => { const c = (await st()).config; return c.environment === 'outdoor' && c.night === false; }, 5000, 'venue restored');
});
await step('config: fast respawn + short match for the run', async () => {
  const r = await api('PUT', '/api/config', { time_limit_s: 120, respawn: { type: 'auto', delay_s: 4 } });
  expect(r.ok, 'config PUT failed: ' + JSON.stringify(r.errors));
});
await step('LOAD ▸ on GAMES shows the LOADED GAME state; CONTINUE TO KIT ▸ advances to KIT — the KIT screen renders', async () => {
  // GAMES has two states since 47a87830 / f7b29c9f (Games.tsx header): LOAD ▸ announces the game to the phones and
  // stays on GAMES, then CONTINUE TO KIT ▸ is the way on. ARMORY's gate is HARDWARE READY ▸.
  await mc.click('[data-testid="game-load"] button:has-text("LOAD ▸")');
  await until(async () => (await st()).game?.loaded === true, 6000, 'server game.loaded');
  await until(async () => (await mc.locator('[data-testid="active-game-config"]').count()) > 0, 6000, 'GAMES shows the LOADED GAME state');
  expect((await st()).phase === 'build', 'LOAD must not advance the phase');
  await mc.click('[data-testid="game-continue-kit"] button:has-text("CONTINUE TO KIT ▸")');
  await until(async () => (await st()).phase === 'kit', 6000, 'server phase kit');
  await until(async () => (await mc.locator('text=KIT EACH PLAYER').count()) > 0 && (await mc.locator('input[aria-label="new operator callsign"]').count()) > 0, 6000, 'KIT screen rendered (header + roster input)');
});
await step('guard: PUSH CONFIG & ARM exists AND is disabled with an empty roster', async () => {
  await nav(3);
  const btn = mc.locator('button:has-text("PUSH CONFIG & ARM")').first();
  await until(async () => (await btn.count()) > 0, 6000, 'PUSH button rendered');
  expect((await btn.isDisabled()) === true, 'push button clickable with no players');
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
await step('bind guns through the Kit gun picker; BRAVO to YELLOW via the team chip — rows leave NO GUN', async () => {
  const s = await st(); pA = s.players.find(p => p.display === 'ALPHA'); pB = s.players.find(p => p.display === 'BRAVO');
  const row = nm => mc.locator('div[role="button"]:has-text("' + nm + '")').first();
  await row('ALPHA').click();
  const sel = mc.locator('select[aria-label="gun for ALPHA"]');
  const opts = await sel.locator('option').allTextContents();
  expect(guns.every(g => opts.some(o => o.includes(g.gun_id))), 'gun picker does not list every scanned gun: ' + opts.join(','));
  await sel.selectOption(guns[0].gun_id);
  await until(async () => { const t = await row('ALPHA').textContent(); return t.includes(guns[0].gun_id) && !t.includes('NO GUN'); }, 6000, 'ALPHA row shows its gun');
  await row('BRAVO').click();
  await mc.locator('select[aria-label="gun for BRAVO"]').selectOption(guns[1].gun_id);
  await mc.locator('[role="group"][aria-label="team"] button:has-text("YELLOW")').click();
  await until(async () => { const p = (await st()).players.find(p => p.player_id === pB.player_id); return p.gun_id === guns[1].gun_id && p.team_id === 'yellow'; }, 6000, 'BRAVO gun + team on the server');
  expect((await mc.locator('[role="group"][aria-label="team"] button[aria-pressed="true"]').textContent()).includes('YELLOW'), 'YELLOW chip not pressed');
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
  expect((await hudA.locator('.tryout .ln').textContent()).includes('MAG 72'), 'panel missing MAG 72');
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
await step('A10 §4.1: host back on GAMES (phase build) → phones show SETTING UP THE GAME, no plates, no READY UP; back to KIT → BRIEFING again', async () => {
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
await step(`(a) GAMES: play FREE-FOR-ALL (its default ruleset is NO HEAVIES) → Kit arsenal "${BASE_POOL}", Rocket tile disabled`, async () => {
  // pickup_only (rocket_launcher/rail_gun) is never in any pool, so NO HEAVIES and OPEN both land on
  // the same derived BASE_POOL — see the derivation at the top of this file.
  cfgBeforeRules = (await st()).config;
  await nav(1);
  await playCard('FREE-FOR-ALL');            // the run config is TUNED (fast respawn) → the card asks TAP AGAIN
  await until(async () => (await st()).config.loadout_policy.preset === 'no_heavies', 6000, 'preset no_heavies');
  await nav(2);
  await mc.locator('div[role="button"]:has-text("ALPHA")').first().click();
  await until(async () => (await mc.locator(`text=${BASE_POOL}`).count()) > 0, 6000, `arsenal header ${BASE_POOL}`);
  const dis = await mc.locator('div[role="button"][aria-label*="Rocket"]').first().getAttribute('aria-disabled');
  expect(dis === 'true', 'Rocket Launcher tile is not aria-disabled under NO HEAVIES');
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
await step('(g) GAMES: play the saved "Silenced Sniper" → both phones padlocked "FIXED BY THE HOST"; MC shows the LOADOUTS RESET notice', async () => {
  await nav(1);
  await playCard('Silenced Sniper');
  await until(async () => { const c = (await st()).config; return c.mode === 'ffa' && c.loadout_policy.primary.choice === 'fixed' && c.loadout_policy.primary.fixed_id === 'sniper_rifle'; }, 6000, 'silenced sniper applied');
  for (const [pg, nm] of [[hudA, 'hudA'], [hudB, 'hudB']]) {
    await until(async () => (await pg.locator('.plate.slot.locked').count()) === 3, 8000, nm + ' locked plates');
    expect((await pg.locator('text=FIXED BY THE HOST').count()) > 0, nm + ' missing FIXED BY THE HOST');
  }
  // The "N LOADOUTS RESET BY <game name>" notice must survive the venue re-assert PUT (server keeps _policy_notice
  // across venue-only PUTs; the label is the PLAYING game's name) — a hard assertion, not a finding (review #10)
  await until(async () => (await mc.locator('text=/LOADOUTS? RESET BY SILENCED SNIPER/i').count()) > 0, 6000, 'the amber "N LOADOUTS RESET BY SILENCED SNIPER" notice on GAMES');
  expect((await mc.locator('div[role="button"][aria-label="play Silenced Sniper"][aria-pressed="true"]').count()) > 0, 'Silenced Sniper card not marked PLAYING');
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
await step('(h) DESIGNER: create a game → name + notes → SAVE GAME "e2e test" → BACK TO GAMES shows the card', async () => {
  await nav(1);
  await shelves(); await mc.click('button[aria-label="create a game"]');
  await until(async () => (await mc.locator('input[aria-label="game name"]').count()) > 0, 6000, 'designer open');
  await mc.fill('input[aria-label="game name"]', 'e2e test');
  await mc.fill('textarea[aria-label="game notes"]', 'notes written by the e2e suite');
  await mc.click('button:has-text("SAVE GAME")');
  await until(async () => (await (await fetch(MC + '/api/presets')).json()).some(g => g.name.toLowerCase() === 'e2e test'), 6000, 'preset saved server-side');
  await until(async () => (await mc.locator('text=SAVED "E2E TEST"').count()) > 0, 6000, 'SAVED status in the rail');
  await backToGames();
  await until(async () => (await mc.locator('div[role="button"][aria-label="play e2e test"]').count()) > 0, 6000, 'saved card on GAMES');
  await shot(mc, 'games-saved');
});
await step('(h2) EDIT pre-fills the designer with the saved name + notes', async () => {
  await shelves(); await mc.click('button[aria-label="edit e2e test"]');
  await until(async () => (await mc.locator('input[aria-label="game name"]').count()) > 0, 6000, 'designer open');
  expect((await mc.inputValue('input[aria-label="game name"]')) === 'e2e test', 'name not pre-filled');
  expect((await mc.inputValue('textarea[aria-label="game notes"]')) === 'notes written by the e2e suite', 'notes not pre-filled');
  expect((await mc.locator('text=EDIT E2E TEST').count()) > 0, 'designer header is not EDIT E2E TEST');
  await backToGames();
});
await step('(h3) copy "e2e test" → play the COPY → the copy\'s card is PLAYING and the rail title is the copy (identity by applied id, not content)', async () => {
  await shelves();
  const copyBtn = mc.locator('button[aria-label^="duplicate e2e test"], button[aria-label^="copy e2e test"]').first();
  expect((await copyBtn.count()) > 0, 'no DUPLICATE / COPY button on the e2e test card');
  await copyBtn.click();
  // the copy either opens the designer as a draft or lands on the shelf: wait for whichever happens
  await until(async () => (await mc.locator('input[aria-label="game name"]').count()) > 0 || (await (await fetch(MC + '/api/presets')).json()).some(g => /^e2e test copy/i.test(g.name)), 6000, 'the copy opened in the designer or saved');
  if ((await mc.locator('input[aria-label="game name"]').count()) > 0) {           // the copy may open in the designer as a draft: save it there
    if (!/copy/i.test(await mc.inputValue('input[aria-label="game name"]'))) await mc.fill('input[aria-label="game name"]', 'e2e test copy');
    if ((await mc.locator('button:has-text("SAVE GAME")').count()) > 0) await mc.click('button:has-text("SAVE GAME")'); else await mc.click('button:has-text("SAVE")');
    await until(async () => (await (await fetch(MC + '/api/presets')).json()).some(g => /^e2e test copy/i.test(g.name)), 6000, 'copy saved');
    await backToGames();
  }
  const copy = (await (await fetch(MC + '/api/presets')).json()).find(g => /^e2e test copy/i.test(g.name));
  expect(copy, 'no saved copy of e2e test on the server');
  const card = mc.locator(`div[role="button"][aria-label="play ${copy.name}"]`).first();
  await until(async () => (await card.count()) > 0, 6000, 'copy card on GAMES');
  await playCard(copy.name);
  await until(async () => (await st()).active_preset_id === copy.preset_id, 6000, 'server applied the COPY (active_preset_id)');
  await until(async () => (await card.getAttribute('aria-pressed')) === 'true', 6000, 'the COPY card is marked PLAYING');
  expect((await mc.locator('div[role="button"][aria-label="play e2e test"]').first().getAttribute('aria-pressed')) !== 'true', 'the ORIGINAL is still marked PLAYING');
  // A LOADED game (47a87830) heads the tab as SAVED GAME // LOADED; the picker rail reads // PLAYING before a LOAD.
  const rail = await mc.locator('text=/SAVED GAME \\/\\/ (PLAYING|LOADED)/').first().locator('xpath=..').textContent();
  expect(new RegExp(rxLit(copy.name), 'i').test(rail), 'rail title is not the copy: ' + rail.slice(0, 80));
  await shot(mc, 'games-play-copy');
  for (const nm of [copy.name, 'e2e test']) {
    await mc.click(`button[aria-label="delete ${nm}"]`); await mc.click('button:has-text("CONFIRM DELETE")');
    await until(async () => (await mc.locator(`div[role="button"][aria-label="play ${nm}"]`).count()) === 0, 6000, nm + ' removed');
  }
});
await step('(i) KIT host-side slot 2: pick a secondary weapon → card + roster line; PERK card → Extended Mags → card (A14: the weapon stays)', async () => {
  await nav(1);
  await playCard('FREE-FOR-ALL');          // back to NO HEAVIES rules (player picks)
  await until(async () => (await st()).config.loadout_policy.preset === 'no_heavies', 6000, 'no_heavies');
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
await step('(k) DESIGNER: PLAY THIS NOW ▸ saves + applies the draft and lands on KIT', async () => {
  await nav(1);
  await shelves(); await mc.click('button[aria-label="customize TEAM DEATHMATCH"]');
  await until(async () => (await mc.locator('input[aria-label="game name"]').count()) > 0, 6000, 'designer open');
  const time = mc.locator('input[aria-label="time limit minutes"]');
  await time.fill('7'); await time.press('Enter');
  await mc.fill('input[aria-label="game name"]', 'play now test');
  await mc.click('button:has-text("PLAY THIS NOW")');
  await until(async () => { const s = await st(); return s.phase === 'kit' && s.config.time_limit_s === 420 && s.config.mode === 'tdm'; }, 8000, 'server: phase kit, TDM, 7 min');
  await until(async () => (await mc.locator('text=KIT EACH PLAYER').count()) > 0, 6000, 'landed on KIT');
  const saved = (await (await fetch(MC + '/api/presets')).json()).find(g => g.name === 'play now test');
  expect(saved, 'PLAY THIS NOW did not save the named game');
  expect((await st()).active_preset_id === saved.preset_id, 'active_preset_id is not the played game');
  await fetch(MC + '/api/presets/' + encodeURIComponent(saved.preset_id), { method: 'DELETE' });
});
await step('restore OPEN rules + the run config so the match flow continues unchanged', async () => {
  const c = cfgBeforeRules;
  await api('PUT', '/api/config', { mode: c.mode, environment: c.environment, night: c.night, time_limit_s: c.time_limit_s, respawn: c.respawn, scoring: c.scoring, health: c.health, teams: c.teams, loadout_policy: { preset: 'open' } });
  await api('PATCH', `/api/players/${pB.player_id}`, { team_id: 'yellow', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] } });
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
await step('PUSH CONFIG & ARM from the Lobby UI → 2/2 acked', async () => {
  // all-ready AUTO-advances kit→lobby (the view follows) — only click Kit's CONTINUE if that didn't happen
  if ((await st()).phase !== 'lobby') { await mc.click('button:has-text("CONTINUE ▸")'); }
  await until(async () => (await st()).phase === 'lobby', 6000, 'server phase lobby');
  await until(async () => (await mc.locator('button:has-text("PUSH CONFIG & ARM")').count()) > 0, 6000, 'lobby rail visible');
  // Bench 2026-09-17: the countdown picker appears only once the push is in sync, beside ARM COUNTDOWN.
  expect((await mc.locator('select[aria-label="countdown length"]').count()) === 0, 'no countdown picker before the push');
  await mc.click('button:has-text("PUSH CONFIG & ARM")');
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
  await hudA.evaluate(n => window.fakeGun.hit(6, n, 2), pB.player_num);
  let sawFire = false;
  await until(async () => { if ((await hudA.locator('.takingfire').count()) > 0) sawFire = true; const s1 = await hudState(hudA); return (s1.hp || 0) + (s1.armor || 0) < pool0; }, 3000, 'HP/armor dropped after the hit');
  for (let i = 0; i < 6 && !sawFire; i++) { await sleep(250); if ((await hudA.locator('.takingfire').count()) > 0) sawFire = true; }
  expect(sawFire, 'TAKING FIRE state never appeared after a hit');
  await shot(hudA, 'hudA-taking-fire');
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
  await hudA.evaluate(n => window.fakeGun.kill(n, 2), pB.player_num);
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
await step('MC recap: rows + yellow wins + CSV exports', async () => {
  await until(async () => (await mc.locator('text=EXPORT CSV').count()) > 0, 8000, 'recap screen');
  const s = await st();
  expect(s.recap.winner && s.recap.winner.team_id === 'yellow', 'yellow should win 1-0: ' + JSON.stringify(s.recap.winner));
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

// ═══ F8a · DESIGNER controls — every control changes what the host SEES (Tony: "you can't click these toggles") ═══
// One step per control; each asserts VISIBLE state (tile art opacity/filter, chip fill, summary text), not aria alone.
flow('F8a designer-controls');
const D = {
  prim: () => mc.locator('[aria-label="primary slot rules"]'), sec: () => mc.locator('[aria-label="secondary slot rules"]'),
  pSum: () => mc.getByTestId('primary-summary').textContent(), sSum: () => mc.getByTestId('secondary-summary').textContent(),
  rail: () => mc.locator('aside').textContent(),
  /** the art strip is the tile's first span: dimmed = opacity ≤ .3 + a grayscale filter */
  // The weapon grid became an alphabetical TABLE (2026-09-02) — no images to dim and no filled
  // chips, so allowed/off is read from aria-pressed, which is what a screen reader gets too.
  art: async (name) => mc.locator(`[aria-label="primary slot rules"] button[aria-label^="${name}"]`).first().getAttribute('aria-pressed'),
  chip: (label) => mc.locator(`[aria-label="primary slot rules"] button:has-text("${label}")`).first(),
};
const dimmed = a => a === 'false';
const lit = a => a === 'true';
await step(`designer-controls 0: CUSTOMIZE FREE-FOR-ALL opens the designer at NO HEAVIES (${BASE_POOL}), heavies dimmed, HEAVY chip unfilled`, async () => {
  // rocket_launcher/rail_gun are the only visible `heavy`-tagged rows left (laser_cannon/ion_sniper/
  // energy_launcher are hidden too), and both are `pickup_only`: NO HEAVIES and OPEN land on the
  // SAME derived BASE_POOL, since pickup_only already excludes them before the chip's own rule applies.
  await ensureMc();
  await mc.locator('nav button').nth(1).click();
  await shelves(); await mc.click('button[aria-label="customize FREE-FOR-ALL"]');
  await until(async () => new RegExp(rxLit(BASE_POOL)).test(await D.pSum()), 6000, `FFA base starts at NO HEAVIES (${BASE_POOL})`);
  expect(dimmed(await D.art('Rocket Launcher')) && dimmed(await D.art('Rail Gun')), 'heavy tiles are not dimmed under NO HEAVIES');
  // The DESIGNER offers only weapons a player can be issued (1c83b745): the Energy Launcher
  // (UNPLAYABLE_IDS) is ALSO `hidden` now (2026-09-17), so it has no row for a stronger reason too.
  expect((await D.prim().locator('button[aria-label^="Energy Launcher"]').count()) === 0, 'the unplayable Energy Launcher has a chip');
  expect(lit(await D.art('Assault Rifle')), 'assault rifle tile should be lit');
  expect((await D.chip('HEAVY').getAttribute('aria-pressed')) === 'false', 'HEAVY chip should read off');
  expect((await D.chip('HEAVY').getAttribute('aria-pressed')) !== 'true', 'HEAVY chip should be unfilled when off');
  await shot(mc, 'designer-open'); await textAudit(mc, 'designer');
});
await step('DESIGNER: every primary control is ≥ 36 px tall (tap audit is a failure here, not a finding)', async () => { await tapAudit(mc, 'designer', true); });
await step(`designer-controls 1: template OPEN → ${BASE_POOL}; heavies stay dimmed and the HEAVY chip reads PARTIAL (pickup_only overrides the tag rule)`, async () => {
  // rocket_launcher/rail_gun can never be "in the pool" (pickup_only), so under OPEN (no exclude_tags
  // at all) the HEAVY chip's own members read 0/2 allowed — "mixed", not fully on — and the tiles
  // stay dimmed even though nothing is explicitly excluding them by rule.
  await mc.click('button[title="Everything, players pick all three slots"]');
  await until(async () => new RegExp(rxLit(BASE_POOL)).test(await D.pSum()), 4000, `OPEN → ${BASE_POOL}`);
  expect(dimmed(await D.art('Rocket Launcher')), 'rocket launcher should stay dimmed under OPEN (pickup_only)');
  expect((await D.chip('HEAVY').getAttribute('aria-pressed')) === 'mixed', 'HEAVY chip should read PARTIAL (mixed) under OPEN, not on');
  expect((await mc.locator('button[title="Everything, players pick all three slots"][aria-pressed="true"]').count()) === 1, 'OPEN template not shown as selected');
  await shot(mc, 'designer-open-template');
});
await step('designer-controls 2: template SNIPERS → PRIMARY "EVERYONE GETS SNIPER RIFLE", only the sniper tile lit, slot 2 OFF, rail follows', async () => {
  await mc.click('button[title="Everyone gets the sniper rifle, no secondary, no perks, no picking"]');
  await until(async () => /EVERYONE GETS SNIPER RIFLE/.test(await D.pSum()) && /OFF/.test(await D.sSum()), 4000, 'SNIPERS → fixed primary + slot 2 off');
  expect((await D.prim().locator('button[aria-label="Sniper Rifle, allowed"]').count()) === 1, 'sniper rifle tile not shown as the fixed pick');
  expect((await D.prim().locator('button[aria-label$=", allowed"]').count()) === 1, 'more than one tile lit under FIXED');
  expect((await D.prim().locator('button[aria-pressed="true"]:has-text("FIXED")').count()) === 1, 'WHO PICKS does not read FIXED');
  expect((await D.sec().locator('button[aria-pressed="true"]:has-text("OFF")').count()) === 1, 'slot 2 WHO PICKS does not read OFF');
  await until(async () => /SNIPER RIFLE FOR EVERYONE/.test(await D.rail()) && /NO SLOT 2/.test(await D.rail()), 4000, 'rail follows the template');
  await shot(mc, 'designer-snipers');
});
await step(`designer-controls 3: HEAVY chip off (from OPEN) → still ${BASE_POOL}, chip flips PARTIAL → OFF (pickup_only already excluded both heavies)`, async () => {
  // tapping the HEAVY chip from its OPEN "mixed" (0/2) reading flips it to an EXPLICIT off (any state
  // but fully off taps to off) — but the pool count does not move, because rocket_launcher/rail_gun
  // were already out of it via pickup_only, not the tag rule.
  await mc.click('button[title="Everything, players pick all three slots"]');
  await until(async () => new RegExp(rxLit(BASE_POOL)).test(await D.pSum()), 4000, 'OPEN again');
  expect((await D.chip('HEAVY').getAttribute('aria-pressed')) === 'mixed', 'HEAVY chip should start PARTIAL under OPEN');
  await D.chip('HEAVY').click();
  await until(async () => (await D.chip('HEAVY').getAttribute('aria-pressed')) === 'false', 4000, 'HEAVY chip → off');
  expect(new RegExp(rxLit(BASE_POOL)).test(await D.pSum()), 'pool count should not move — pickup_only already excluded both heavies: ' + await D.pSum());
  expect(dimmed(await D.art('Rocket Launcher')) && dimmed(await D.art('Rail Gun')), 'heavy tiles not dimmed after HEAVY off');
  expect(lit(await D.art('Sniper Rifle')) && lit(await D.art('SMG')), 'a non-heavy tile went dim');
  await shot(mc, 'designer-heavy-off');
});
await step(`designer-controls 4: tap the Assault Rifle tile → ${AR_OFF_POOL}, that tile dimmed and labelled off`, async () => {
  await D.prim().locator('button[aria-label^="Assault Rifle"]').click();
  await until(async () => new RegExp(rxLit(AR_OFF_POOL)).test(await D.pSum()), 4000, `tile off → ${AR_OFF_POOL}`);
  expect((await D.prim().locator('button[aria-label="Assault Rifle, off"]').count()) === 1, 'assault rifle tile not labelled off');
  expect(dimmed(await D.art('Assault Rifle')), 'assault rifle tile not dimmed');
  await shot(mc, 'designer-tile-off');
});
await step('designer-controls 5: tapping a pickup_only heavy tile ("allow through the chip") does NOT bring it into the pool — it stays dimmed, count unchanged', async () => {
  // this used to prove the per-weapon "allow just this one" override beats the class chip. It no
  // longer can for a `pickup_only` weapon: the pool excludes rocket_launcher/rail_gun UNCONDITIONALLY
  // (policy.py, mirrored in computePool/gameSummary.ts), so the tap changes the RULE (the tile is no
  // longer excluded "by tag") but the pool — and the tile's own lit/dim state, which reads off the
  // pool — does not change. Worth a second look product-side: a control that can never visibly do
  // anything may read as broken rather than as "this weapon is pickup-only".
  await D.prim().locator('button[aria-label="Rail Gun, off"]').click();
  await new Promise(r => setTimeout(r, 400));
  expect(new RegExp(rxLit(AR_OFF_POOL)).test(await D.pSum()), `pool count must not move (still ${AR_OFF_POOL}, assault rifle stays off from step 4) — pickup_only overrides the per-id override: ` + await D.pSum());
  expect(dimmed(await D.art('Rail Gun')), 'rail gun tile should still read off (dimmed) — pickup_only, not the chip, excludes it');
  expect(dimmed(await D.art('Rocket Launcher')), 'the other heavy should stay dimmed too');
  await shot(mc, 'designer-allow-through-chip-is-a-no-op-for-pickup-only');
});
await step('designer-controls 6: WHO PICKS → FIXED then tap SMG → "EVERYONE GETS SMG", only the SMG tile lit', async () => {
  await D.prim().locator('button:has-text("FIXED")').click();
  await D.prim().locator('button[aria-label^="SMG"]').click();
  await until(async () => /EVERYONE GETS SMG/.test(await D.pSum()), 4000, 'FIXED + tap SMG → everyone gets SMG');
  expect((await D.prim().locator('button[aria-label="SMG, allowed"]').count()) === 1 && (await D.prim().locator('button[aria-label$=", allowed"]').count()) === 1, 'only the SMG should be lit under FIXED');
  await shot(mc, 'designer-fixed-smg');
});
await step('designer-controls 7: slot 2 OFF → "OFF — ALT-FIRE DOES NOTHING", weapon grid gone, rail reads NO SLOT 2', async () => {
  await D.sec().locator('button:has-text("OFF")').click();
  await until(async () => /OFF — ALT-FIRE/.test(await D.sSum()), 4000, 'secondary OFF');
  expect((await D.sec().locator('button[aria-label$=", allowed"], button[aria-label$=", off"]').count()) === 0, 'slot-2 tiles still shown when OFF');
  await until(async () => /SMG FOR EVERYONE · NO SLOT 2/.test(await D.rail()), 4000, 'summary rail follows');
  await shot(mc, 'designer-slot2-off');
});
await step(`designer-controls 7b (A12/A14): slot 2 PLAYER → SIDEARMS chip → "${SIDEARM_POOL}", only the pickable pistols allowed, WEAPONS chip off; SIDEARMS again is a no-op (slot 2 always admits one kind); WEAPONS → ${SECONDARY_WEAPONS_POOL}`, async () => {
  // The pistol counts are derived (SIDEARM_POOL, top of this file): a hidden weapon has no row at all,
  // so unhiding the glock moves this step instead of breaking it. Secondary has no `lethal` filter
  // (computePool never checks it for the secondary slot), so its pool is bigger than the primary's —
  // SECONDARY_WEAPONS_POOL, not BASE_POOL.
  await D.sec().locator('button:has-text("PLAYER")').click();
  await until(async () => new RegExp(rxLit(SECONDARY_WEAPONS_POOL)).test(await D.sSum()), 4000, `slot 2 back to PLAYER (${SECONDARY_WEAPONS_POOL})`);
  const kind = (label) => D.sec().locator(`button:has-text("${label}")`).first();
  await kind('SIDEARMS').click();
  await until(async () => new RegExp(rxLit(SIDEARM_POOL)).test(await D.sSum()), 4000, `SIDEARMS chip → ${SIDEARM_POOL}, got: ` + await D.sSum());
  expect((await kind('SIDEARMS').getAttribute('aria-pressed')) === 'true' && (await kind('WEAPONS').getAttribute('aria-pressed')) === 'false', 'SIDEARMS should be on and WEAPONS off (they are exclusive)');
  const allowed = (await D.sec().locator('button[aria-label$=", allowed"]').evaluateAll(bs => bs.map(b => b.getAttribute('aria-label')))).filter(l => !/ perk, allowed$/.test(l));   // perk tiles are allowed too — the check is about WEAPONS
  const wantPistols = [...SIDEARM_NAMES].sort().join(' | ');
  expect(allowed.map(l => l.replace(/, allowed$/, '')).sort().join(' | ') === wantPistols, `only the pickable pistols should be allowed, want ${wantPistols}, got: ` + allowed.join(' | '));
  expect((await D.sec().locator('button[aria-label="SMG, off"]').count()) === 1, 'the SMG should read off under SIDEARMS');
  expect(/SLOT 2.*SIDEARM|SIDEARM/.test(await D.rail()), 'the rail should mention sidearms');
  await shot(mc, 'designer-sidearms-only');
  await kind('SIDEARMS').click();                     // A14: perks left slot 2, so the last kind cannot be switched off
  await sleep(400);
  expect(new RegExp(rxLit(SIDEARM_POOL)).test(await D.sSum()) && (await kind('SIDEARMS').getAttribute('aria-pressed')) === 'true', 'the last kind must stay on, got: ' + await D.sSum());
  await kind('WEAPONS').click();
  await until(async () => new RegExp(rxLit(SECONDARY_WEAPONS_POOL)).test(await D.sSum()), 4000, `WEAPONS on → ${SECONDARY_WEAPONS_POOL}`);
  expect((await D.sec().locator('button[aria-label="USP-S, allowed"]').count()) === 1, 'the pistols are ordinary weapons under WEAPONS');
});
await step(`designer-controls 8: base switch to TEAM DEATHMATCH resets the rules (${BASE_POOL}, rail BASE TDM) and SAVE lands the card`, async () => {
  await mc.click('button[aria-pressed="false"]:has-text("TEAM DEATHMATCH")');
  await until(async () => /TEAM DEATHMATCH/.test(await D.rail()) && new RegExp(rxLit(BASE_POOL)).test(await D.pSum()), 4000, 'base → TDM, rules reset');
  // rocket_launcher is `pickup_only` — it stays dimmed on every reset, whatever the base mode's rules
  // are, so "rules reset" is proven by the count/rail above instead, and by a non-heavy tile that a
  // previous step's exclusion (assault_rifle, step 4) also un-dims here.
  expect(lit(await D.art('Assault Rifle')), 'rules did not reset (assault rifle still dimmed from an earlier step)');
  expect(dimmed(await D.art('Rocket Launcher')), 'rocket launcher should still read off — pickup_only, unaffected by the base reset');
  await mc.fill('input[aria-label="game name"]', 'controls test');
  await mc.click('button:has-text("SAVE GAME")');
  await until(async () => (await mc.locator('text=SAVED "CONTROLS TEST"').count()) > 0, 6000, 'SAVED status');
  await shot(mc, 'designer-controls-saved');
  await backToGames();
  await until(async () => (await mc.locator('div[role="button"][aria-label="play controls test"]').count()) > 0, 6000, 'card on GAMES');
  await mc.click('button[aria-label="delete controls test"]'); await mc.click('button:has-text("CONFIRM DELETE")');
  await until(async () => (await mc.locator('div[role="button"][aria-label="play controls test"]').count()) === 0, 6000, 'card gone');
});

// ═══ F8b · compat: NEW UI against an OLDER / pre-A10 server ═══
// Tony hit "cannot read properties of undefined (reading 'preset')" with today's bundle on an MC process started
// before the loadout code landed. Every other step runs UI + server from the same tree, so that mismatch had no
// coverage. Here the same UI gets stale responses: loadout fields stripped, the A10 routes 404, no live socket.
await step('designer-controls A11: ADVANCED opens a read-only sounds & lights table with sources, words and MC confidence', async () => {
  await ensureMc();
  await mc.locator('nav button').nth(1).click();
  await shelves(); await mc.click('button[aria-label="customize FREE-FOR-ALL"]');
  await until(async () => (await mc.locator('input[aria-label="game name"]').count()) > 0, 6000, 'designer open');
  const adv = mc.locator('[data-testid="advanced-presentation"] button[aria-expanded]');
  expect((await adv.getAttribute('aria-expanded')) === 'false', 'ADVANCED should start collapsed');
  expect((await mc.locator('[data-testid="pres-row-hit_taken"]').count()) === 0, 'table visible before ADVANCED was opened');
  await adv.click();
  await until(async () => (await mc.locator('[data-testid="pres-row-hit_taken"]').count()) === 1, 6000, 'hit_taken row after opening ADVANCED');
  expect((await adv.getAttribute('aria-expanded')) === 'true', 'ADVANCED not marked expanded');
  const src = async id => (await mc.locator(`[data-testid="pres-row-${id}"] td`).nth(1).textContent()).trim();   // the SOURCE cell
  expect((await src('hit_taken')) === 'HUD', 'hit_taken must be a HUD-sourced row, got ' + await src('hit_taken'));
  expect((await src('lead_taken')) === 'MC', 'lead_taken must be an MC-sourced row, got ' + await src('lead_taken'));
  const lead = await mc.locator('[data-testid="pres-row-lead_taken"]').textContent();
  expect(/VA6D/.test(lead) && /takes the lead/i.test(lead), 'lead_taken row lacks VA6D / the words: ' + lead);
  const conf = await mc.getByTestId('mc-confidence').textContent();
  expect(/MC (NOT )?CONFIDENT|MC CONFIDENCE GATE ARMED/.test(conf), 'confidence line missing: ' + conf);   // pre-match the line is the neutral GATE ARMED wording (polish 2026-09-04)
  expect(/standard|silenced|counter.strike|vip|infection|last.stand|extraction|custom/i.test(await mc.getByTestId('presentation-preset').textContent()), 'preset not shown');   // uppercase is CSS, textContent is not
  expect((await mc.locator('[data-testid="advanced-presentation"] input, [data-testid="advanced-presentation"] select').count()) === 0, 'ADVANCED is read-only: no inputs');
  await shot(mc, 'designer-advanced'); await textAudit(mc, 'designer-advanced');
  await adv.click();
  await until(async () => (await mc.locator('[data-testid="pres-row-hit_taken"]').count()) === 0, 4000, 'ADVANCED collapses again');
});

flow('F8b compat-older-server');
await step('compat-older-server: new UI renders GAMES / DESIGNER / KIT against a server with no loadout fields and no A10 routes', async () => {
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
  await nav(1); await noCrash('GAMES');
  await until(async () => (await pg.locator('text=PREDATES THIS UI').count()) > 0, 6000, 'the "server predates this UI" banner');
  await shelves(pg);   // GAMES rendered, shelves showing
  const loadRow = await pg.locator('text=LOADOUT').locator('xpath=..').first().textContent();
  expect(/—/.test(loadRow), 'GAMES LOADOUT row should read — with no policy: ' + loadRow);
  await pg.click('button[aria-label="create a game"]'); await pg.waitForTimeout(500); await noCrash('DESIGNER (create)');
  await until(async () => (await pg.locator('text=RULES PREVIEW LOCALLY').count()) > 0, 6000, 'designer says the server cannot preview');
  // A11 ADVANCED against a server with no /api/presentation: the section still renders, opens, and SAYS why it is empty
  await pg.locator('[data-testid="advanced-presentation"] button[aria-expanded]').click();
  await until(async () => (await pg.locator('[data-testid="advanced-presentation"] [role="alert"]:has-text("PREDATES THIS UI")').count()) > 0, 6000, 'ADVANCED shows the predates-this-UI line on a 404');
  expect((await pg.locator('[data-testid="pres-row-hit_taken"]').count()) === 0, 'ADVANCED rendered rows from nowhere against a stale server');
  await noCrash('DESIGNER (advanced, stale)');
  await pg.click('button[title="Everyone gets the sniper rifle, no secondary, no perks, no picking"]');   // templates are client-side: must work here too
  await until(async () => /EVERYONE GETS SNIPER RIFLE/.test(await pg.getByTestId('primary-summary').textContent()), 4000, 'template applies against a stale server');
  await pg.click('button[title="Everything, players pick all three slots"]');
  // rocket_launcher/rail_gun are `pickup_only`, so OPEN already excludes them before the HEAVY chip's
  // own rule applies — see the BASE_POOL derivation at the top of this file.
  await until(async () => new RegExp(rxLit(BASE_POOL)).test(await pg.getByTestId('primary-summary').textContent()), 4000, `OPEN → ${BASE_POOL} (pool computed locally)`);
  // the rules must be LIVE with no server help: a chip dims its class, a tile tap switches one weapon (Tony, round 8)
  const prim = pg.locator('[aria-label="primary slot rules"]');
  await prim.locator('button:has-text("HEAVY")').first().click();
  // pickup_only already excluded rocket_launcher/rail_gun, so the count does not move — only the
  // chip's own state flips from PARTIAL (mixed) to explicit OFF.
  await until(async () => (await prim.locator('button:has-text("HEAVY")').first().getAttribute('aria-pressed')) === 'false', 4000, 'HEAVY chip → off against a stale server');
  expect(new RegExp(rxLit(BASE_POOL)).test(await pg.getByTestId('primary-summary').textContent()), 'pool count should not move: ' + await pg.getByTestId('primary-summary').textContent());
  expect((await prim.locator('button[aria-label="Rocket Launcher, off"]').count()) === 1, 'rocket launcher tile not shown as off');
  await prim.locator('button[aria-label^="Assault Rifle"]').click();
  await until(async () => new RegExp(rxLit(AR_OFF_POOL)).test(await pg.getByTestId('primary-summary').textContent()), 4000, `tile tap → ${AR_OFF_POOL} against a stale server`);
  // tapping a pickup_only heavy's own tile ("allow just this one") cannot bring it into the pool —
  // pickup_only overrides the per-id override the same way it overrides the tag rule.
  await prim.locator('button[aria-label="Rocket Launcher, off"]').click();
  await new Promise(r => setTimeout(r, 400));
  expect(new RegExp(rxLit(AR_OFF_POOL)).test(await pg.getByTestId('primary-summary').textContent()), 'pickup_only heavy must not enter the pool via a tile tap: ' + await pg.getByTestId('primary-summary').textContent());
  expect((await prim.locator('button[aria-label="Rocket Launcher, off"]').count()) === 1, 'rocket launcher tile should still read off');
  expect((await prim.locator('button[disabled]').count()) === 0, 'tiles disabled against a stale server');
  await backToGames(pg); await shelves(pg); await pg.click('button[aria-label="customize FREE-FOR-ALL"]'); await pg.waitForTimeout(500); await noCrash('DESIGNER (customize)');
  await nav(2); await noCrash('KIT');
  await until(async () => (await pg.locator('text=KIT EACH PLAYER').count()) > 0, 6000, 'KIT rendered');
  expect((await pg.locator('text=GAME RULES').count()) === 0, 'KIT shows a GAME RULES chip with no policy');
  if ((await pg.locator('div[role="button"]:has-text("ALPHA")').count()) > 0) { await pg.locator('div[role="button"]:has-text("ALPHA")').first().click(); await pg.waitForTimeout(400); await noCrash('KIT (player selected)'); expect((await pg.locator('div[role="button"]:has-text("PRIMARY")').count()) > 0, 'KIT slot cards missing for a selected player'); }
  await nav(3); await noCrash('LOBBY'); await until(async () => (await pg.locator('button:has-text("PUSH CONFIG & ARM")').count()) > 0, 6000, 'LOBBY rendered');
  await nav(0); await noCrash('ARMORY');
  await pg.screenshot({ path: path.join(OUT, `${String(++shotN).padStart(2, '0')}-compat-older-server.png`) });
  expect(errs.length === 0, 'errors against the stale server: ' + errs.join(' | '));
  await ctx.close();
});

// ═══ F8c · compat: a session persisted BEFORE A10 restores and every page renders (review #12) ═══
flow('F8c compat-old-session');
await step('compat-old-session: MC booted from a pre-A10 session.json → GAMES STOCK MODE // PLAYING, KIT shows the restored players, GAME RULES = OPEN, no crash', async () => {
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
    await nav2(1); await noCrash('GAMES');
    await until(async () => (await pg.locator('text=STOCK MODE // PLAYING').count()) > 0, 6000, 'GAMES rail STOCK MODE // PLAYING');
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
