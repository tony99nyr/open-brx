// C1 (MC visual QA, 2026-09-23): GAMES → the right rail's CUSTOMIZE → PLAY THIS NOW, clicked in a
// real browser against a real python MC.
//
// The defect: the rail opens the DESIGNER with `fromLive` (seed the draft from tonight's config), and
// PLAY treated `fromLive` as "opened from a LOADED game" and only navigated. The console jumped to
// KIT while the server stayed in BUILD with no game loaded, and no phone was told. The stock card's
// own CUSTOMIZE worked, which is why the koth.mjs `designer-play-loads` step never saw it.
//
// Every step asserts the SCREEN (the heading, the hash, the KIT and LOBBY copy) AND the server's own
// phase and `game.loaded`, never the API alone.
//
//   node test/e2e/designer-rail-play.mjs        # everything (~30 s)
//   ONLY=real|loaded|stale|fail404|mock node test/e2e/designer-rail-play.mjs
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=…          # the ports (each defaults to a free one)
//   MC_PY=…                                     # the interpreter (python-path.mjs)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython } from './python-path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC_DIR = path.resolve(HERE, '../..');
const REPO = path.resolve(MC_DIR, '../..');
const SHOTS = path.join(HERE, 'shots', 'designer-rail-play');
const ONLY = process.env.ONLY || '';

let failures = [], step = '', stepFailedAt = 0;
const expect = (cond, what) => { if (cond) return true; failures.push(`${step}: ${what}`); console.log(`    ✗ ${what}`); return false; };
const ok = what => console.log(failures.length > stepFailedAt ? `    ⊘ ${what} (step already failed)` : `    ✓ ${what}`);
const until = async (pred, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = false; try { v = await pred(); } catch { v = false; }
    if (v) return true;
    if (Date.now() > end) { expect(false, `timed out waiting for ${what}`); return false; }
    await new Promise(r => setTimeout(r, 80));
  }
};
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
// Polish round 1 (2026-09-23): every child is tracked and its process group killed on ANY exit, so a
// start helper's process.exit(3) (which skips the finally below) cannot leave an MC or vite running.
const spawned = new Set();
process.on('exit', () => { for (const p of spawned) { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } } });
const killGroup = proc => new Promise(done => {
  let settled = false; const finish = () => { if (!settled) { settled = true; done(); } };
  proc.once('exit', finish);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* gone */ } }
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } finish(); }, 3000).unref();
});

const MC_PORT = Number(process.env.MC_PORT || 0) || await freePort();
const MC_WS_PORT = Number(process.env.MC_WS_PORT || 0) || await freePort();
const VITE_PORT = Number(process.env.VITE_PORT || 0) || await freePort();

async function startMC() {
  const py = findPython(REPO);
  try {
    const r = await fetch(`http://127.0.0.1:${MC_PORT}/api/state`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) { console.error(`SOMETHING ALREADY SERVES :${MC_PORT}, refusing to drive a server this run did not start.`); process.exit(3); }
  } catch { /* free: good */ }
  const proc = spawn(py, ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(MC_PORT), '--ws-port', String(MC_WS_PORT),
    '--demo', '--fake-net', '--no-auth', '--ephemeral', '--advertise', '127.0.0.1'], {
    cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { ...process.env, PYTHONPATH: path.join(REPO, 'mcp') },
  });
  spawned.add(proc);
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${MC_PORT}`;
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`${base}/api/state`); if (r.ok) break; } catch { /* not yet */ }
    if (proc.exitCode != null) { console.error(`MC DIED:\n${log}`); process.exit(3); }
    await new Promise(r => setTimeout(r, 100));
  }
  const who = await (await fetch(`${base}/api/state`)).json();
  if (proc.exitCode != null || /address already in use|Errno 98/i.test(log)) { console.error(`OUR MC FAILED TO BIND :${MC_PORT}:\n${log}`); process.exit(3); }
  if (who?.lan?.port !== MC_PORT) { console.error(`:${MC_PORT} reports lan.port ${who?.lan?.port}`); await killGroup(proc); process.exit(3); }
  console.log(`  MC: ${base} (session ${who.session_id}, demo + fake-net, ephemeral)`);
  return { base, stop: () => killGroup(proc) };
}
async function startVite() {
  const proc = spawn(process.execPath, [path.join(MC_DIR, 'node_modules/vite/bin/vite.js'), '--config', path.join(HERE, 'vite.proxy.config.mjs'), '--port', String(VITE_PORT), '--strictPort'],
    { cwd: MC_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, MC_PROXY_PORT: String(MC_PORT) } });
  spawned.add(proc);
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${VITE_PORT}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.error(`vite did not start:\n${log}`); await killGroup(proc); process.exit(3);
}

const jsErrors = [];
async function newPage(browser, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => jsErrors.push(`[${step}] [pageerror] ${e.message}`));
  return pg;
}
const shot = async (pg, name) => {
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f, fullPage: false });
  return f;
};
const serverState = async base => (await fetch(`${base}/api/state`)).json();
const onScreen = (pg, text) => pg.locator('main', { hasText: text }).count().then(n => n > 0);
const errorStrip = pg => pg.locator('header button[role="alert"]');

/** A session nothing has been loaded into, on stock TDM: the state the GAMES rail exists in. */
async function freshUnloaded(base) {
  const phase0 = (await serverState(base)).phase;
  if (!['muster', 'build', 'kit', 'lobby', 'recap'].includes(phase0)) {
    await fetch(`${base}/api/start/abort`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  }
  const fresh = await fetch(`${base}/api/session/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"keep_roster":true}' });
  if (!fresh.ok) throw new Error(`POST /api/session/new ${fresh.status}`);
  const r = await fetch(`${base}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'tdm' }) });
  if (!r.ok) throw new Error(`PUT /api/config ${r.status}`);
  const s = await serverState(base);
  if (s.game?.loaded || s.lobby?.pushed) throw new Error('precondition: the fresh session already has a game loaded');
}

/** GAMES, unloaded, then the RAIL's own CUSTOMIZE (never the stock card's), then PLAY THIS NOW. */
async function railToDesignerAndPlay(pg, url) {
  await pg.goto(url, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 15000, 'the first snapshot');
  await until(() => onScreen(pg, '[ A2 // GAMES ]'), 10000, 'the GAMES screen');
  await until(() => onScreen(pg, 'Pick the Game'), 8000, 'the un-loaded GAMES state (Pick the Game)');
  const rail = pg.locator('main [data-testid="rail-designer"] button');
  expect(await rail.count() === 1, 'the rail carries one designer button');
  const label = (await rail.innerText()).trim();
  expect(/CUSTOMIZE|SAVE THIS AS A GAME|MAKE MY OWN/.test(label), `the rail button reads as the designer door (saw ${JSON.stringify(label)})`);
  await rail.click();
  await until(() => onScreen(pg, '[ A2b // GAME DESIGNER ]'), 8000, 'the DESIGNER to open from the rail');
  await pg.locator('main button:has-text("PLAY THIS NOW")').click();
  return label;
}

async function expectLoadedKit(pg, base, what) {
  await until(async () => { const s = await serverState(base); return s.phase === 'kit' && s.game?.loaded === true; }, 10000,
    `${what}: the server to reach phase kit with the game loaded`);
  await until(() => onScreen(pg, '[ A3 // KIT-OUT ]'), 8000, `${what}: the KIT screen`);
  const s = await serverState(base);
  expect(s.phase === 'kit', `${what}: server phase is kit (saw ${s.phase})`);
  expect(s.game?.loaded === true, `${what}: server says the game is loaded`);
  expect(s.lobby?.pushed === false, `${what}: PLAY wrote no gun head before the LOBBY push`);
  expect(new URL(pg.url()).hash === '#kit', `${what}: the URL is #kit (saw ${new URL(pg.url()).hash})`);
  expect(await pg.locator('text=NOT LOADED YET').count() === 0, `${what}: KIT never shows NOT LOADED YET`);
  expect(await pg.locator('text=CONSOLE ERROR').count() === 0, `${what}: no crash boundary`);
}

// ---------------------------------------------------------------------------- the runs
async function runReal(browser, vite, mc, vp) {
  step = `real/${vp.width}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] rail CUSTOMIZE → PLAY THIS NOW against a real MC`);
  await freshUnloaded(mc.base);
  const pg = await newPage(browser, vp);
  const label = await railToDesignerAndPlay(pg, `${vite.base}/#build`);
  await expectLoadedKit(pg, mc.base, 'rail PLAY');
  const kitShot = await shot(pg, `01-real-kit-${vp.width}`);
  // LOBBY must agree with the server: the finding's second symptom was "VIEW LOADED GAME" beside
  // "NO GAME LOADED". The nav is view-only, it moves no phase.
  await pg.locator('header nav button:has-text("LOBBY")').first().click();
  await until(() => onScreen(pg, '[ A5 // LOBBY'), 8000, 'the LOBBY screen');
  const tl = Date.now();
  await until(() => pg.locator('main', { hasText: 'NO GAME LOADED' }).count().then(n => n === 0), 8000, 'LOBBY to stop saying NO GAME LOADED');
  console.log(`      (LOBBY agreed after ${Date.now() - tl} ms)`);
  if (!expect(await pg.locator('main', { hasText: 'NO GAME LOADED' }).count() === 0, 'LOBBY does not say NO GAME LOADED')) {
    const s = await serverState(mc.base);
    console.log('      FORENSICS hash', new URL(pg.url()).hash, 'phase', s.phase, 'loaded', s.game?.loaded, 'pushed', s.lobby?.pushed);
    console.log('      main:', (await pg.locator('main').innerText()).slice(0, 600).replace(/\n/g, ' | '));
  }
  ok(`"${label}" → PLAY: server kit + loaded, KIT on screen, LOBBY agrees  ${kitShot}`);
  await pg.context().close();
}

/** A game already LOADED and the phase still BUILD: EDIT ▸ → OPEN GAME DESIGNER ▸ → PLAY. This path
 *  used to navigate to KIT with the server left in BUILD, the same shape as C1. */
async function runLoaded(browser, vite, mc, vp) {
  step = `loaded/${vp.width}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] a LOADED game in BUILD: EDIT → designer → PLAY THIS NOW`);
  await freshUnloaded(mc.base);
  await fetch(`${mc.base}/api/phase`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phase: 'build' }) });
  const pg = await newPage(browser, vp);
  await pg.goto(`${vite.base}/#build`, { waitUntil: 'domcontentloaded' });
  await until(() => onScreen(pg, 'Pick the Game'), 15000, 'the un-loaded GAMES state');
  await pg.locator('main [data-testid="game-load"] button').click();
  await until(() => onScreen(pg, 'Loaded Game'), 8000, 'the LOADED GAME state after LOAD');
  const s0 = await serverState(mc.base);
  expect(s0.phase === 'build' && s0.game?.loaded === true, `precondition: loaded in build (saw ${s0.phase}, loaded ${s0.game?.loaded})`);
  await pg.locator('main [data-testid="game-edit-open"] button').click();
  await pg.locator('main button:has-text("OPEN GAME DESIGNER")').click();
  await until(() => onScreen(pg, '[ A2b // GAME DESIGNER ]'), 8000, 'the DESIGNER');
  await pg.locator('main button:has-text("PLAY THIS NOW")').click();
  await expectLoadedKit(pg, mc.base, 'loaded PLAY');
  ok(`loaded game in BUILD → PLAY: server kit + loaded  ${await shot(pg, `02-loaded-${vp.width}`)}`);
  await pg.context().close();
}

/** An older server: no `game` block and no `active_preset_id`, stripped over REST AND the WebSocket. */
async function runStale(browser, vite, mc, vp) {
  step = `stale/${vp.width}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] snapshots with no \`game\` block, over REST and /ui-ws`);
  await freshUnloaded(mc.base);
  const pg = await newPage(browser, vp);
  const strip = s => { const { game: _g, active_preset_id: _a, ...rest } = s; return rest; };
  let stripped = 0;
  await pg.route('**/api/state', async route => {
    const res = await route.fetch();
    let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    stripped++;
    await route.fulfill({ response: res, body: JSON.stringify(strip(body)), headers: { ...res.headers(), 'content-type': 'application/json' } });
  });
  await pg.routeWebSocket(/\/ui-ws/, ws => {
    const server = ws.connectToServer();
    ws.onMessage(m => server.send(m));
    server.onMessage(m => {
      try {
        const msg = JSON.parse(String(m));
        if (msg.kind === 'snapshot' && msg.state) { msg.state = strip(msg.state); stripped++; ws.send(JSON.stringify(msg)); return; }
        ws.send(m);
      } catch { ws.send(m); }
    });
  });
  await railToDesignerAndPlay(pg, `${vite.base}/#build`);
  await expectLoadedKit(pg, mc.base, 'stale PLAY');
  expect(stripped > 0, `the strip actually ran (${stripped} snapshots)`);
  ok(`stale snapshots (${stripped} stripped): rail PLAY still loads and reaches KIT  ${await shot(pg, `03-stale-${vp.width}`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();
}

/** LOAD refused (an MC with no /api/games/load): the operator stays on the draft and sees why. */
async function runFail404(browser, vite, mc, vp) {
  step = `fail404/${vp.width}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] POST /api/games/load answers 404`);
  await freshUnloaded(mc.base);
  const pg = await newPage(browser, vp);
  let loads = 0;
  await pg.route('**/api/games/load', r => { loads++; return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'THIS MC SERVER CANNOT LOAD A GAME, RESTART IT' }) }); });
  await railToDesignerAndPlay(pg, `${vite.base}/#build`);
  await until(() => errorStrip(pg).count().then(n => n > 0), 8000, 'the refusal in the error strip');
  const s = await serverState(mc.base);
  expect(loads === 1, `exactly one LOAD went out (saw ${loads})`);
  expect(s.phase !== 'kit', `a failed LOAD never moves the phase to kit (saw ${s.phase})`);
  expect(s.game?.loaded === false, 'a failed LOAD never claims the game is loaded');
  expect(new URL(pg.url()).hash === '#designer', `the operator stays on the DESIGNER (saw ${new URL(pg.url()).hash})`);
  expect((await errorStrip(pg).innerText({ timeout: 2000 }).catch(() => '')).includes('RESTART IT'), 'the strip names the remedy');
  ok(`404: stays on the draft, strip says why  ${await shot(pg, `04-fail404-${vp.width}`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();
}

/** ?mock: the in-browser backend. No server to ask, so the command bar's phase is the witness. */
async function runMock(browser, vite, vp) {
  step = `mock/${vp.width}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] ?mock`);
  const pg = await newPage(browser, vp);
  await pg.goto(`${vite.base}/?mock`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header').count().then(n => n > 0), 10000, 'the command bar');
  await pg.evaluate(() => { location.hash = '#build'; });
  if (await onScreen(pg, 'Loaded Game')) { console.log('    (the mock boots LOADED: no rail to test here)'); await pg.context().close(); return; }
  await railToDesignerAndPlay(pg, pg.url());
  await until(() => onScreen(pg, '[ A3 // KIT-OUT ]'), 8000, 'the KIT screen');
  expect(await pg.locator('text=NOT LOADED YET').count() === 0, 'KIT never shows NOT LOADED YET');
  await pg.locator('header nav button:has-text("GAMES")').first().click();
  await until(() => onScreen(pg, '[ A2 // GAMES ]'), 8000, 'GAMES again');
  expect(await onScreen(pg, 'Loaded Game'), 'GAMES now reads Loaded Game: the mock backend was told to LOAD');
  ok(`?mock: rail PLAY loads  ${await shot(pg, `05-mock-${vp.width}`)}`);
  await pg.context().close();
}

// ---------------------------------------------------------------------------- main
const t0 = Date.now();
fs.mkdirSync(SHOTS, { recursive: true });
const mc = await startMC();
const vite = await startVite();
const browser = await chromium.launch();
const DESK = { width: 1440, height: 900 }, SMALL = { width: 900, height: 800 };
try {
  if (!ONLY || ONLY === 'real') { await runReal(browser, vite, mc, DESK); await runReal(browser, vite, mc, SMALL); }
  if (!ONLY || ONLY === 'loaded') await runLoaded(browser, vite, mc, DESK);
  if (!ONLY || ONLY === 'stale') await runStale(browser, vite, mc, DESK);
  if (!ONLY || ONLY === 'fail404') await runFail404(browser, vite, mc, DESK);
  if (!ONLY || ONLY === 'mock') await runMock(browser, vite, DESK);
} catch (e) {
  failures.push(`${step}: threw ${e?.stack ?? e}`);
} finally {
  await browser.close();
  await vite.stop();
  await mc.stop();
}
console.log(`\n--------------------------------------------- ${Math.round((Date.now() - t0) / 1000)} s`);
if (jsErrors.length) { console.log('JS ERRORS:'); jsErrors.forEach(e => console.log('  ' + e)); }
if (failures.length) { console.log(`FAILURES (${failures.length}):`); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('all steps passed');
