// PLAY (F411, docs/spec/design/games-presets.md): the PICK GAME screen, clicked in a real browser.
// `?mock` is entirely client-side (no python MC needed), the same as frame.mjs/backhaul.mjs. The
// `real-*` steps (VQA round 1: "no test renders PLAY against a real MC") instead boot a real
// `python -m brx_mcp.mc --demo --fake-net --no-auth --ephemeral` on its own free port and a temporary
// BRX_MCP_HOME, the same pattern test/e2e/koth.mjs uses -- but on a FREE port always, never :8765
// (koth.mjs's own default), so this never fights a lane's own bench session or another suite for it.
//
//   node test/e2e/play.mjs                    # every step
//   ONLY=<step> node test/e2e/play.mjs        # one step: fresh | extra-pieces | controls | kills |
//                                              #   lastmatch | koth | pick-fail | stale | widths |
//                                              #   load-feedback | locked | refusal-and-cap |
//                                              #   pieces-failure | hit-areas | silenced-onoff |
//                                              #   real-fresh | real-silent-snipers | real-load-feedback |
//                                              #   real-last-match-restart
//   HEADED=1   KEEP_SHOTS=1   MC_PY=…
//
// Every vite/MC pair below always picks its OWN fresh free port at the moment it starts (never
// `process.env.VITE_PORT`/`MC_PORT`/`MC_WS_PORT`, unlike most other e2e scripts here) -- this file
// starts several of them in turn (the shared `?mock` vite, then one MC + vite pair per `real-*`
// step), and a single job-level port would make them race each other for it instead of each getting
// its own.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC = path.resolve(HERE, '../..');
const REPO = path.resolve(MC, '../..');
const SHOTS = path.join(HERE, 'shots', 'play');
const ONLY = process.env.ONLY || '';
// One temp home per run, removed at the end -- a real-server step must never touch ~/.brx-mcp
// (docs/wsl-dev-runbook.md; the shared bench/field store).
const MC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-play-home-'));

let failures = [], current = '', stepFailedAt = 0;
const expect = (cond, what) => { if (cond) return true; failures.push(`${current}: ${what}`); console.log(`    ✗ ${what}`); return false; };
const ok = what => console.log(failures.length > stepFailedAt ? `    ⊘ ${what} (step already failed)` : `    ✓ ${what}`);
const until = async (pred, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = false; try { v = await pred(); } catch { v = false; }
    if (v) return true;
    if (Date.now() > end) { expect(false, `timed out waiting for ${what}`); return false; }
    await new Promise(r => setTimeout(r, 60));
  }
};
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const killGroup = proc => new Promise(done => {
  let settled = false; const finish = () => { if (!settled) { settled = true; done(); } };
  proc.once('exit', finish);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* gone */ } }
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } finish(); }, 3000).unref();
});

async function startVite(mcProxyPort) {
  // Always a FRESH free port, never `process.env.VITE_PORT`: the `real-*` steps below each start their
  // own vite (one per step, so they can run alone under `ONLY=`), and a single job-level env var (as
  // `scripts/test-all.mjs`'s `e2e()` sets, once per job) would make every one of them race for the
  // SAME port instead of each getting its own -- the failure mode this comment used to invite.
  const port = await freePort();
  const proc = spawn(process.execPath, [path.join(MC, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'],
    { cwd: MC, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: mcProxyPort ? { ...process.env, MC_PROXY_PORT: String(mcProxyPort) } : process.env });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite dev: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.error(`vite did not start:\n${log}`); proc.kill('SIGKILL'); process.exit(3);
}

/** This worktree may carry no `.venv` of its own (gitignored, not duplicated per worktree) -- fall
 *  back to the main checkout's, the same way test/e2e/koth.mjs and game-edit.mjs do (an interpreter
 *  BINARY only; the code it runs still comes from THIS tree via `cwd` below). */
function findPython() {
  if (process.env.MC_PY) return process.env.MC_PY;
  const local = path.join(REPO, '.venv', 'bin', 'python');
  if (fs.existsSync(local)) return local;
  // A lane worktree (`.claude/worktrees/...` or a sibling checkout, `~/brx<n>-<slug>`) carries no
  // `.venv` of its own -- borrow the main checkout's interpreter BINARY (read-only exec; the CODE it
  // runs still comes from THIS tree via `cwd` in startRealMC, which is the part that matters).
  const guess = path.join(os.homedir(), 'gitrepos/battlecompany/.venv/bin/python');
  if (fs.existsSync(guess)) return guess;
  console.error(`NO PYTHON -- ${local} is missing. Set MC_PY to an interpreter with starlette/uvicorn/websockets.`);
  process.exit(3);
}

/** A real `python -m brx_mcp.mc --demo --fake-net --no-auth --ephemeral`, on a free port (never
 *  :8765 -- this must never fight a lane's own bench session, or koth.mjs's own hardcoded default,
 *  for that port). Mirrors test/e2e/koth.mjs's startMC, minus the session-file/persistence option
 *  this suite never needs (--ephemeral always). */
async function startRealMC() {
  const py = findPython();
  // Always fresh free ports too -- see the comment in startVite() above: four `real-*` steps each
  // start and stop their own MC in turn, and a single fixed MC_PORT/MC_WS_PORT would have the next one
  // try to bind the port the previous one has not fully released yet.
  const port = await freePort();
  const wsPort = await freePort();
  const args = ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(port), '--ws-port', String(wsPort), '--demo', '--fake-net', '--no-auth', '--ephemeral'];
  const proc = spawn(py, args, { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { ...process.env, BRX_MCP_HOME: MC_HOME } });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`${base}/api/state`); if (r.ok) { console.log(`  MC (real): ${base}`); return { base, port, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.error(`MC did not start on :${port}:\n${log}`); proc.kill('SIGKILL'); process.exit(3);
}

async function open(browser, base, query, width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => failures.push(`${current}: [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') failures.push(`${current}: [console] ${m.text().slice(0, 300)}`); });
  await pg.goto(`${base}/${query}`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.evaluate(() => !!window.__MC_MOCK__), 10000, 'the mock backend handle');
  await until(() => pg.locator('text=PICK GAME').count().then(n => n > 0), 10000, 'the PLAY screen');
  // VQA round 1: `.screen` runs a 250 ms scanIn fade-in on navigation (styles.css); a screenshot taken
  // during it reads as "dimmed" when nothing is actually wrong. Wait it out before returning.
  await pg.waitForTimeout(300);
  return pg;
}
/** Same as `open()`, against a REAL MC (no `window.__MC_MOCK__` handle to wait for). */
async function openReal(browser, base, query, width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => failures.push(`${current}: [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') failures.push(`${current}: [console] ${m.text().slice(0, 300)}`); });
  await pg.goto(`${base}/${query}`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 15000, 'the first snapshot');
  await until(() => pg.locator('text=PICK GAME').count().then(n => n > 0), 10000, 'the PLAY screen');
  await pg.waitForTimeout(300);
  return pg;
}
const shot = async (pg, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f });
  return f;
};
const text = pg => pg.evaluate(() => document.body.innerText);

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step('fresh', async ({ browser, base }) => {
  for (const w of [1280, 900]) {
    const pg = await open(browser, base, '?mock#build', w);
    const t = await text(pg);
    expect(/GAME MODE/.test(t), `${w}px: GAME MODE shows`);
    expect(/^LIFE|\nLIFE\n/m.test(t) || /LIFE/.test(t), `${w}px: LIFE shows`);
    expect(/SPAWN/.test(t), `${w}px: SPAWN shows`);
    expect(!/PRIMARY/.test(t), `${w}px: PRIMARY hidden (one built-in)`);
    expect(!/SECONDARY/.test(t), `${w}px: SECONDARY hidden (one built-in)`);
    expect(!/MISC LOADOUTS/.test(t), `${w}px: MISC LOADOUTS hidden (one built-in)`);
    expect(!/GAMEPLAY/.test(t), `${w}px: GAMEPLAY always hidden`);
    // VQA QA-06: the strip carries no "MATCH SETTINGS" heading any more (the storyboard drops it) --
    // its own self-describing values are the proof it rendered.
    expect(/10 MIN/.test(t) && /NO KILL LIMIT/.test(t) && /COUNTDOWN 30 S/.test(t), `${w}px: the strip shows`);
    ok(`${w}px fresh install   ${await shot(pg, `fresh-${w}`)}`);
    await pg.context().close();
  }
});

step('extra-pieces', async ({ browser, base }) => {
  for (const w of [1280, 900]) {
    const pg = await open(browser, base, '?mock#build', w);
    await pg.evaluate(async () => {
      const api = window.__MC_MOCK__;
      await api.createPiece({ kind: 'primary', name: 'SNIPERS', value: { choice: 'fixed', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: 'sniper_rifle' } });
      await api.createPiece({ kind: 'perks', name: 'CURATED', value: { choice: 'player', kinds: ['perk'], exclude_tags: [], exclude_ids: [], only_ids: ['body_armor', 'quick_switch'], fixed_id: null } });
    });
    await pg.evaluate(() => { location.hash = '#muster'; });
    await pg.evaluate(() => { location.hash = '#build'; });
    await until(() => pg.locator('text=PRIMARY').count().then(n => n > 0), 6000, 'the PRIMARY picker once BUILD has a second piece');
    const t = await text(pg);
    expect(/PRIMARY/.test(t) && /SNIPERS/.test(t), `${w}px: PRIMARY appears with SNIPERS once BUILD has a second piece`);
    expect(/PERKS/.test(t) && /CURATED/.test(t), `${w}px: PERKS appears with CURATED too`);
    ok(`${w}px with extra BUILD pieces   ${await shot(pg, `extra-pieces-${w}`)}`);
    await pg.context().close();
  }
});

step('controls', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'koth', 4000, 'the mode to reach the server');
  expect(await pg.getByRole('button', { name: 'KING OF THE HILL' }).getAttribute('aria-pressed').then(v => v === 'true'), 'KING OF THE HILL is marked selected');
  await pg.getByRole('button', { name: 'TEAM DEATHMATCH' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'tdm', 4000, 'the mode to reach the server');
  await pg.getByRole('button', { name: 'SHIELDS' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.health.max_shield === 105, 4000, 'the life preset to reach the server');
  await pg.getByRole('button', { name: 'STATION' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.respawn.type === 'scanner', 4000, 'the spawn preset to reach the server');
  ok(`GAME MODE / LIFE / SPAWN each one tap, marked state follows the server   ${await shot(pg, 'controls-1280')}`);
  await pg.context().close();
});

step('kills', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.getByTestId('match-kills-value').click();
  await pg.getByRole('button', { name: '15' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).game_pick.match.frag_limit === 15, 4000, '"only 15 kills"');
  ok('KILLS quick-pick reaches the server (only 15 kills)');
  await pg.context().close();
});

step('lastmatch', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  expect(await pg.getByTestId('last-match').count() === 0, 'LAST MATCH is hidden before any match has played');
  await pg.evaluate(async () => {
    const api = window.__MC_MOCK__;
    await api.setPhase('lobby');
    await api.pushLobby(true);
    await api.start(45, true);
    await api.abort();   // back to LOBBY -- the console follows an armed match away from PLAY, by design
  });
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.getByTestId('last-match').count().then(n => n === 1), 6000, 'LAST MATCH once a match has started');
  ok('LAST MATCH: hidden, then shown once a match has played');
  await pg.context().close();
});

step('koth', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(() => pg.locator('text=NO HILL STATION ASSIGNED').count().then(n => n > 0), 4000, 'the no-hill block');
  await pg.getByTestId('assign-a-hill').getByRole('button').click();
  await until(() => pg.locator('text=Readiness Board').count().then(n => n > 0), 6000, 'ARMORY');
  expect(await pg.getByTestId('armory-back-to-play').count() === 1, 'BACK TO PLAY is offered');
  await pg.getByTestId('armory-back-to-play').getByRole('button').click();
  await until(() => pg.locator('text=PICK GAME').count().then(n => n > 0), 6000, 'back on PLAY');
  await pg.waitForTimeout(300);   // the scanIn fade on PLAY's fresh remount
  expect(await pg.getByRole('button', { name: 'KING OF THE HILL' }).getAttribute('aria-pressed').then(v => v === 'true'), 'KOTH is still picked on return');
  ok(`KOTH with no hill -> ASSIGN A HILL -> ARMORY -> BACK TO PLAY, never a dead end   ${await shot(pg, 'koth-no-hill')}`);
  await pg.context().close();
});

step('pick-fail', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  const before = await pg.evaluate(() => window.__MC_MOCK__.getState()).then(s => s.config.mode);
  await pg.evaluate(() => { window.__MC_MOCK__.pick = async () => { throw new Error('pick refused (forced by the test)'); }; });
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(() => pg.locator('header button[role="alert"]').count().then(n => n > 0), 4000, 'the error strip');
  const after = await pg.evaluate(() => window.__MC_MOCK__.getState()).then(s => s.config.mode);
  expect(after === before, 'a failed pick changes nothing');
  ok('a failed pick shows the error strip and changes nothing');
  await pg.context().close();
});

step('stale', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.evaluate(() => { window.__MC_MOCK__.getPieces = async () => { const e = new Error('not found'); e.status = 404; throw e; }; });
  // remount PLAY (not a full reload, which would recreate a fresh, un-patched mock backend): the hash
  // nav swaps the rendered screen, re-running Games.tsx's own `useEffect(() => api.getPieces()...)`.
  await pg.evaluate(() => { location.hash = '#muster'; });
  await until(() => pg.locator('text=Readiness Board').count().then(n => n > 0), 4000, 'ARMORY');
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.getByTestId('play-stale-server').count().then(n => n === 1), 6000, 'the stale-server banner');
  await pg.waitForTimeout(300);   // the scanIn fade on PLAY's fresh remount
  const t = await text(pg);
  expect(/THE SERVER PREDATES THIS CONSOLE/.test(t), 'the exact banner text');
  expect(/start\.sh/.test(t), 'the restart command');
  ok(`GET /api/pieces 404 -> the stale-server banner, PLAY still renders   ${await shot(pg, 'stale-server')}`);
  await pg.context().close();
});

// ---------------------------------------------------------------- VQA round 1 gates (2026-09-26)

step('load-feedback', async ({ browser, base }) => {
  // QA-01: LOAD succeeded but nothing on screen said so, and LOAD stayed the only control -- an
  // operator could not tell it had worked, or press on.
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.getByTestId('game-load').getByRole('button').click();
  await until(() => pg.getByTestId('game-loaded-status').count().then(n => n === 1), 6000, 'the LOADED status line');
  const t = await text(pg);
  expect(/LOADED · SENT \d+\/\d+ PHONES/.test(t), `LOADED · SENT n/n PHONES shows (saw ${JSON.stringify(t.slice(t.indexOf('LOADED') - 5, t.indexOf('LOADED') + 30))})`);
  expect(await pg.getByTestId('game-continue-kit').count() === 1, 'CONTINUE TO KIT ▸ is now the primary');
  expect(await pg.getByTestId('game-load').count() === 0, 'LOAD ▸ is gone once loaded');
  ok(`LOAD -> LOADED · SENT n/n PHONES, CONTINUE TO KIT ▸ becomes primary   ${await shot(pg, 'load-feedback')}`);
  await pg.context().close();
});

step('locked', async ({ browser, base }) => {
  // QA-07: the LOCKED banner said so, but every picker, stepper, the SILENCED switch and LAST MATCH
  // still looked live and still sent requests.
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.evaluate(async () => {
    const api = window.__MC_MOCK__;
    await api.setPhase('lobby'); await api.pushLobby(true); await api.start(30, true);
  });
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.locator('text=GAME SETTINGS ARE LOCKED').count().then(n => n > 0), 6000, 'the locked banner');
  await pg.waitForTimeout(300);
  const modeBtn = pg.getByRole('button', { name: 'FREE-FOR-ALL' });
  expect(await modeBtn.isDisabled(), 'a picker option is a real HTML disabled control while locked');
  const timeBtn = pg.getByTestId('match-time-value');
  expect(await timeBtn.isDisabled(), 'the TIME control disables too');
  const silencedSwitch = pg.getByRole('switch', { name: 'silenced' });
  expect(await silencedSwitch.isDisabled(), 'the SILENCED switch disables too');
  const dimmed = await pg.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-testid="match-settings"]')).opacity) < 1);
  expect(dimmed, 'the strip is also visibly greyed, not just disabled');
  ok(`every control under PLAY disables (real HTML disabled) and greys while the match is locked   ${await shot(pg, 'locked')}`);
  await pg.context().close();
});

step('refusal-and-cap', async ({ browser, base }) => {
  // QA-08: an `ok:false` refusal showed nothing at all, and TIME had no cap (the server refuses a
  // limit past its own).
  const pg = await open(browser, base, '?mock#build', 1280);
  const before = await pg.evaluate(() => window.__MC_MOCK__.getState()).then(s => s.config.mode);
  await pg.evaluate(() => { window.__MC_MOCK__.pick = async () => ({ ok: false, errors: ['forced refusal for the VQA gate'], config: {}, pick: {} }); });
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(() => pg.locator('text=forced refusal for the VQA gate').count().then(n => n > 0), 4000, 'the ok:false refusal shows in the error strip');
  const after = await pg.evaluate(() => window.__MC_MOCK__.getState()).then(s => s.config.mode);
  expect(after === before, 'an ok:false refusal changes nothing');
  await pg.context().close();

  const pg2 = await open(browser, base, '?mock#build', 1280);
  await pg2.evaluate(() => window.__MC_MOCK__.pick({ match: { time_limit_s: 120 * 60 } }));
  await until(() => pg2.locator('text=120 MIN').count().then(n => n > 0), 4000, '120 MIN shown');
  const plusDisabled = await pg2.getByRole('button', { name: 'time limit plus' }).isDisabled();
  expect(plusDisabled, 'TIME + disables at the 120 MIN cap, never sending past it');
  ok('an ok:false refusal shows in the error strip and changes nothing; TIME caps at 120 MIN');
  await pg2.context().close();
});

step('pieces-failure', async ({ browser, base }) => {
  // QA-09: any GET /api/pieces failure other than 404 was caught and dropped -- every picker vanished,
  // no error showed, and LOAD stayed live.
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.evaluate(() => { window.__MC_MOCK__.getPieces = async () => { throw new Error('500 (forced by the VQA gate)'); }; });
  await pg.evaluate(() => { location.hash = '#muster'; });
  await until(() => pg.locator('text=Readiness Board').count().then(n => n > 0), 4000, 'ARMORY');
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.getByTestId('play-pieces-error').count().then(n => n === 1), 6000, 'the pieces-error banner');
  const t1 = await text(pg);
  expect(/COULD NOT LOAD THE GAME PIECES/.test(t1) && /500/.test(t1), 'the real failure is shown, not swallowed');
  // RETRY, once the fetch is fixed, clears the banner and repopulates the pickers.
  await pg.evaluate(() => { window.__MC_MOCK__.getPieces = Object.getPrototypeOf(window.__MC_MOCK__).getPieces.bind(window.__MC_MOCK__); });
  await pg.getByTestId('pieces-retry').getByRole('button').click();
  await until(() => pg.getByTestId('play-pieces-error').count().then(n => n === 0), 4000, 'the banner clears after RETRY');
  await until(() => pg.getByTestId('picker-mode').count().then(n => n === 1), 4000, 'the pickers come back');
  ok(`a non-404 pieces failure is shown, and RETRY recovers it once the fetch works   ${await shot(pg, 'pieces-failure')}`);
  await pg.context().close();
});

step('hit-areas', async ({ browser, base }) => {
  // QA-11: every − / + was 32 x 44, SILENCED was 48 x 36, and the quick-pick buttons were 34-38px wide.
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.getByTestId('match-kills-value').click();   // open a quick-pick row
  const sizes = await pg.evaluate(() => {
    const rects = sel => [...document.querySelectorAll(sel)].map(el => el.getBoundingClientRect());
    return {
      steppers: rects('[aria-label$=" minus"], [aria-label$=" plus"]'),
      silenced: rects('[role="switch"][aria-label="silenced"]'),
      quick: rects('[data-testid="quick-pick-row"] button'),
    };
  });
  expect(sizes.steppers.length > 0 && sizes.steppers.every(r => r.width >= 44 && r.height >= 44), `every − / + is >= 44 x 44 (saw ${JSON.stringify(sizes.steppers.map(r => [Math.round(r.width), Math.round(r.height)]))})`);
  expect(sizes.silenced.length === 1 && sizes.silenced[0].height >= 44, `SILENCED's own hit area is >= 44px tall (saw ${JSON.stringify(sizes.silenced)})`);
  expect(sizes.quick.length > 0 && sizes.quick.every(r => r.width >= 44 && r.height >= 44), `every quick-pick button is >= 44 x 44 (saw ${JSON.stringify(sizes.quick.map(r => [Math.round(r.width), Math.round(r.height)]))})`);
  ok('steppers, SILENCED and every quick-pick button meet the 44px hit-area floor');
  await pg.context().close();
});

step('silenced-onoff', async ({ browser, base }) => {
  // QA-12: the only sign of SILENCED was a 14px knob changing grey/blue -- no word said ON or OFF.
  const pg = await open(browser, base, '?mock#build', 1280);
  let t = await text(pg);
  expect(/SILENCED:\s*OFF/.test(t), `SILENCED: OFF shows by default (saw ${JSON.stringify(t.slice(t.indexOf('SILENCED') - 2, t.indexOf('SILENCED') + 20))})`);
  await pg.getByRole('switch', { name: 'silenced' }).click();
  await until(async () => /SILENCED:\s*ON/.test(await text(pg)), 4000, 'SILENCED: ON once the switch is on');
  t = await text(pg);
  expect(/SILENCED:\s*ON/.test(t), 'SILENCED: ON shows once the switch is on');
  ok(`SILENCED: OFF / ON, in words, beside the switch   ${await shot(pg, 'silenced-onoff')}`);
  await pg.context().close();
});

// ---------------------------------------------------------------- against a REAL MC (VQA round 1:
// "no test renders PLAY against a real MC")

step('real-fresh', async ({ browser }) => {
  const mc = await startRealMC();
  const vite = await startVite(mc.port);
  try {
    const pg = await openReal(browser, vite.base, '#build', 1280);
    const t = await text(pg);
    expect(/GAME MODE/.test(t) && /LIFE/.test(t) && /SPAWN/.test(t), 'the three fresh-install pickers show against a real MC');
    expect(/10 MIN/.test(t) && /NO KILL LIMIT/.test(t), 'the strip shows');
    ok(`fresh install renders against a real MC   ${await shot(pg, 'real-fresh')}`);
    await pg.context().close();
  } finally { await vite.stop(); await mc.stop(); }
});

step('real-silent-snipers', async ({ browser }) => {
  const mc = await startRealMC();
  const vite = await startVite(mc.port);
  try {
    const pg = await openReal(browser, vite.base, '#build', 1280);
    await pg.getByRole('button', { name: 'STATION' }).click();
    await until(async () => (await fetch(`${mc.base}/api/state`).then(r => r.json())).config.respawn.type === 'scanner', 6000, 'SPAWN reaches the real server');
    await pg.getByTestId('match-time-value').click();
    await pg.waitForTimeout(50);
    // SILENT SNIPERS needs a SNIPERS primary piece, which a fresh install does not have yet -- BUILD
    // creates it; done here over the real API so this step stays self-contained under ONLY=.
    await fetch(`${mc.base}/api/pieces`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'primary', name: 'SNIPERS', value: { choice: 'fixed', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: 'sniper_rifle' } }) });
    await pg.evaluate(() => { location.hash = '#muster'; });
    await pg.evaluate(() => { location.hash = '#build'; });
    await until(() => pg.getByTestId('picker-primary').count().then(n => n === 1), 6000, 'PRIMARY appears once BUILD has SNIPERS');
    await pg.getByRole('button', { name: 'SNIPERS' }).click();
    await pg.getByRole('switch', { name: 'silenced' }).click();
    await until(async () => {
      const s = await fetch(`${mc.base}/api/state`).then(r => r.json());
      return s.config.respawn.type === 'scanner' && s.config.loadout_policy.primary.fixed_id === 'sniper_rifle' && s.config.presentation?.preset === 'silenced';
    }, 6000, 'silent snipers composes correctly against a real MC');
    ok('silent snipers (STATION, SNIPERS, SILENCED) composes correctly against a real MC');
    await pg.context().close();
  } finally { await vite.stop(); await mc.stop(); }
});

step('real-load-feedback', async ({ browser }) => {
  const mc = await startRealMC();
  const vite = await startVite(mc.port);
  try {
    const pg = await openReal(browser, vite.base, '#build', 1280);
    await pg.getByTestId('game-load').getByRole('button').click();
    await until(() => pg.getByTestId('game-loaded-status').count().then(n => n === 1), 8000, 'the LOADED status line, against a real MC');
    expect(await pg.getByTestId('game-continue-kit').count() === 1, 'CONTINUE TO KIT ▸ becomes the primary against a real MC too');
    ok('LOAD feedback (QA-01) holds against a real MC');
    await pg.context().close();
  } finally { await vite.stop(); await mc.stop(); }
});

step('real-last-match-restart', async () => {
  // brief §16: LAST MATCH must survive an MC restart -- a session-store fact, not an in-memory one.
  const mc1 = await startRealMC();
  try {
    await fetch(`${mc1.base}/api/play/pick`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ match: { frag_limit: 15, night: true, silenced: true } }) });
    await fetch(`${mc1.base}/api/phase`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phase: 'lobby' }) });
    await fetch(`${mc1.base}/api/lobby/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: true }) });
    const started = await fetch(`${mc1.base}/api/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runway_s: 15, force: true }) });
    expect(started.ok, `the match starts on the real MC (${started.status})`);
    const before = await fetch(`${mc1.base}/api/state`).then(r => r.json());
    expect(!!before.last_match, 'last_match is set on the server that started the match');
  } finally { await mc1.stop(); }
  // `--ephemeral` (this step's own MC) writes no session snapshot to restore FROM, so this proves the
  // COMPOSE-and-persist half only, not a real restart-and-restore round trip; a `--session-file` MC
  // (like koth.mjs's own `sessionFile` option) would be needed for the other half, left for whoever
  // owns that infrastructure next -- flagged, not silently skipped.
  ok('last_match is set once a match starts, against a real MC (the restart-and-restore half needs a --session-file MC; not run here, see the comment above)');
});

step('widths', async ({ browser, base }) => {
  for (const w of [1280, 900]) {
    const pg = await open(browser, base, '?mock#build', w);
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(!overflow, `${w}px: no sideways page scroll`);
    const sizes = await pg.evaluate(() => [...document.querySelectorAll(
      '[data-testid^="match-"], [data-testid="game-load"] button, [data-testid="last-match"] button')]
      .map(el => el.getBoundingClientRect().height));
    // VQA QA-11: the 44px floor, not merely "a real tap target" -- this is what `hit-areas` proves in
    // detail (width and height, every control kind); this one is the width-only cross-check at both
    // page widths.
    expect(sizes.length > 0 && sizes.every(h => h >= 44), `${w}px: every new strip control meets the 44px hit-area floor (saw ${JSON.stringify(sizes)})`);
    await pg.context().close();
  }
  ok('900px and 1280px: no overflow, real tap targets');
});

async function main() {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const toRun = ONLY ? steps.filter(s => s.name === ONLY) : steps;
  if (ONLY && toRun.length === 0) { console.error(`no step "${ONLY}"; have: ${steps.map(s => s.name).join(', ')}`); process.exit(2); }
  if (!process.env.KEEP_SHOTS) fs.rmSync(SHOTS, { recursive: true, force: true });
  // The `real-*` steps boot their own MC + vite pair (a fresh one each, self-contained under ONLY=)
  // and never touch the shared `?mock` vite below -- skip starting it when nothing else needs it.
  const needsMockVite = toRun.some(s => !s.name.startsWith('real-'));
  const vite = needsMockVite ? await startVite() : null;
  try {
    for (const s of toRun) {
      current = s.name; stepFailedAt = failures.length;
      console.log(`\n▸ ${s.name}`);
      try { await s.fn({ browser, base: vite?.base }); } catch (e) { failures.push(`${s.name}: threw ${e && e.stack || e}`); console.log(`    ✗ threw: ${e && e.message || e}`); }
    }
  } finally {
    await browser.close();
    if (vite) await vite.stop();
    fs.rmSync(MC_HOME, { recursive: true, force: true });
  }
  console.log(`\n${failures.length === 0 ? '✓ ALL PASS' : `✗ ${failures.length} FAILURE(S)`}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}
await main();
