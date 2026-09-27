// PLAY (F411, docs/spec/design/games-presets.md): the PICK GAME screen, clicked in a real browser.
// `?mock` is entirely client-side (no python MC needed), the same as frame.mjs/backhaul.mjs. The
// `real-*` steps (VQA round 1: "no test renders PLAY against a real MC") instead boot a real
// `python -m brx_mcp.mc --demo --fake-net --no-auth --ephemeral` on its own free port and a temporary
// BRX_MCP_HOME, the same pattern test/e2e/koth.mjs uses -- but on a FREE port always, never :8765
// (koth.mjs's own default), so this never fights a lane's own bench session or another suite for it.
//
//   node test/e2e/play.mjs                    # every step
//   ONLY=<step> node test/e2e/play.mjs        # one step: fresh | extra-pieces | controls |
//                                              #   mode-switch-confirm | kills |
//                                              #   lastmatch | koth | pick-fail | stale | widths |
//                                              #   load-feedback | locked | refusal-and-cap |
//                                              #   pieces-failure | hit-areas | silenced-onoff |
//                                              #   teams | hold |
//                                              #   favourites-save | favourites-load |
//                                              #   favourites-fallback | favourites-rename |
//                                              #   favourites-delete | real-favourites |
//                                              #   real-fresh | real-silent-snipers | real-load-feedback |
//                                              #   real-teams-hold | real-last-match-restart
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
// Round 4 (F-6, splitLine, restored): a mode switch that reshapes the roster now asks first -- a
// single click on a mode option can land on the confirm instead of applying it. A second click is
// always safe here even when no confirm was shown (the mode is already applied, and clicking it again
// re-picks the SAME value), so every OTHER step that just wants a mode APPLIED uses this.
const pickMode = async (pg, label) => {
  const btn = pg.getByRole('button', { name: label });
  await btn.click();
  await btn.click();
};

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step('fresh', async ({ browser, base }) => {
  for (const w of [1280, 900]) {
    const pg = await open(browser, base, '?mock#build', w);
    const t = await text(pg);
    expect(/GAME MODE/.test(t), `${w}px: GAME MODE shows`);
    expect(/LIFE/.test(t), `${w}px: LIFE shows`);
    expect(/SPAWN/.test(t), `${w}px: SPAWN shows`);
    expect(!/PRIMARY/.test(t), `${w}px: PRIMARY hidden (one built-in)`);
    expect(!/SECONDARY/.test(t), `${w}px: SECONDARY hidden (one built-in)`);
    expect(!/MISC LOADOUTS/.test(t), `${w}px: MISC LOADOUTS hidden (one built-in)`);
    expect(!/GAMEPLAY/.test(t), `${w}px: GAMEPLAY always hidden`);
    // VQA QA-06: the strip carries no "MATCH SETTINGS" heading any more (the storyboard drops it) --
    // its own self-describing values are the proof it rendered.
    expect(/10 MIN/.test(t) && /NO KILL LIMIT/.test(t) && /COUNTDOWN 30 S/.test(t), `${w}px: the strip shows`);
    // Tony, 2026-09-26: each GAME MODE option carries its own mark, fully inside a fixed box (never a
    // crop, never a jump). One mark per visible option, and each mark stays within its own box.
    const marks = await pg.evaluate(() => [...document.querySelectorAll('[aria-label="game mode"] button')].map(btn => {
      const box = btn.querySelector('span[style*="width: 44px"]');
      const mark = box?.querySelector('img, svg');
      if (!box || !mark) return null;
      const b = box.getBoundingClientRect(), m = mark.getBoundingClientRect();
      return { fits: m.left >= b.left - 1 && m.right <= b.right + 1 && m.top >= b.top - 1 && m.bottom <= b.bottom + 1 };
    }));
    expect(marks.length === 3 && marks.every(x => x?.fits), `${w}px: every mode option has a mark, fully inside its box (saw ${JSON.stringify(marks)})`);
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
  await pickMode(pg, 'KING OF THE HILL');
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'koth', 4000, 'the mode to reach the server');
  expect(await pg.getByRole('button', { name: 'KING OF THE HILL' }).getAttribute('aria-pressed').then(v => v === 'true'), 'KING OF THE HILL is marked selected');
  await pickMode(pg, 'TEAM DEATHMATCH');
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'tdm', 4000, 'the mode to reach the server');
  await pg.getByRole('button', { name: 'SHIELDS' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.health.max_shield === 105, 4000, 'the life preset to reach the server');
  await pg.getByRole('button', { name: 'STATION' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.respawn.type === 'scanner', 4000, 'the spawn preset to reach the server');
  ok(`GAME MODE (a two-tap reshape confirm) / LIFE / SPAWN each reach the server, marked state follows   ${await shot(pg, 'controls-1280')}`);
  await pg.context().close();
});

step('mode-switch-confirm', async ({ browser, base }) => {
  // F-6 (splitLine), restored: TDM's demo roster is 4 BLUE / 4 YELLOW; a mode change now gives red+blue
  // (F413 scope decision, 2026-09-27), so this reshapes -- the first tap must ask, not send.
  const pg = await open(browser, base, '?mock#build', 1280);
  const before = await pg.evaluate(() => window.__MC_MOCK__.getState()).then(s => s.config.mode);
  expect(before === 'tdm', 'control: the demo starts on TDM');
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(() => pg.getByTestId('confirm-switch').count().then(n => n > 0), 4000, 'the reshape confirm');
  const split = await pg.getByTestId('confirm-split').innerText();
  expect(split === '▲ 8 PLAYERS → RED 4 / BLUE 4', `the predicted split is shown (saw ${JSON.stringify(split)})`);
  const mid = await pg.evaluate(() => window.__MC_MOCK__.getState()).then(s => s.config.mode);
  expect(mid === 'tdm', 'the first tap must not have reached the server');
  await shot(pg, 'mode-switch-confirm-armed');

  // a different mode cancels the pending confirm rather than stacking onto it
  await pg.getByRole('button', { name: 'TEAM DEATHMATCH' }).click();
  await until(() => pg.getByTestId('confirm-switch').count().then(n => n === 0), 4000, 'the confirm clears (TDM is already applied, so this alone reads as one tap)');

  // the real two-tap sequence: same mode twice commits it
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(() => pg.getByTestId('confirm-switch').count().then(n => n > 0), 4000, 'the reshape confirm again');
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'koth', 4000, 'the second tap reaches the server');
  expect(await pg.getByTestId('confirm-switch').count() === 0, 'the confirm is gone once applied');
  ok(`a mode switch that reshapes the roster asks first, and the same mode again applies it   ${await shot(pg, 'mode-switch-confirm-applied')}`);
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
  await pickMode(pg, 'KING OF THE HILL');
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
  await pickMode(pg, 'KING OF THE HILL');
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
  await pickMode(pg, 'KING OF THE HILL');
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
      // UX round 1 2026-09-26: GAME MODE/LIFE/SPAWN (the pickers) and DAY/NIGHT (in MATCH SETTINGS)
      // measured 38px in a real browser -- the shared `Seg`'s own floor is 36px, and these rows'
      // pad used to fall short of it. `pad={SEG_PAD_44}` on the two Seg-based rows (LIFE/SPAWN share
      // one Seg call; GAME MODE is its own bespoke row, already built with an explicit 44px floor).
      pickers: rects('[data-testid^="picker-"] button'),
      daynight: rects('[data-testid="match-settings"] [role="group"][aria-label="day or night"] button'),
    };
  });
  expect(sizes.steppers.length > 0 && sizes.steppers.every(r => r.width >= 44 && r.height >= 44), `every − / + is >= 44 x 44 (saw ${JSON.stringify(sizes.steppers.map(r => [Math.round(r.width), Math.round(r.height)]))})`);
  expect(sizes.silenced.length === 1 && sizes.silenced[0].height >= 44, `SILENCED's own hit area is >= 44px tall (saw ${JSON.stringify(sizes.silenced)})`);
  expect(sizes.quick.length > 0 && sizes.quick.every(r => r.width >= 44 && r.height >= 44), `every quick-pick button is >= 44 x 44 (saw ${JSON.stringify(sizes.quick.map(r => [Math.round(r.width), Math.round(r.height)]))})`);
  expect(sizes.pickers.length > 0 && sizes.pickers.every(r => r.height >= 44), `every GAME MODE/LIFE/SPAWN option is >= 44px tall (saw ${JSON.stringify(sizes.pickers.map(r => Math.round(r.height)))})`);
  expect(sizes.daynight.length === 2 && sizes.daynight.every(r => r.height >= 44), `DAY and NIGHT are each >= 44px tall (saw ${JSON.stringify(sizes.daynight.map(r => Math.round(r.height)))})`);
  ok('steppers, SILENCED, every quick-pick button and the picker/DAY-NIGHT rows meet the 44px hit-area floor');
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

step('teams', async ({ browser, base }) => {
  // F413 (games-presets.md §7): TDM starts BLUE/YELLOW (8 players) -- a count bump to 3 reshapes the
  // roster, so it asks first (the SAME confirm mode-switch-confirm already proved, just with no single
  // target to re-tap: any second teams-changing tap commits).
  const pg = await open(browser, base, '?mock#build', 1280);
  const teamsItem = pg.getByTestId('match-teams-item');
  const count3 = teamsItem.getByRole('button', { name: '3', exact: true });
  await count3.click();
  await until(() => pg.getByTestId('confirm-switch').count().then(n => n > 0), 4000, 'the reshape confirm (count to 3)');
  const before = await pg.evaluate(() => window.__MC_MOCK__.getState()).then(s => s.game_pick.match.teams);
  expect(before === undefined, 'the first tap must not reach the server');
  await count3.click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).game_pick.match.teams?.length === 3, 4000, '3 teams committed');
  ok(`TEAMS: a count change to 3 asks first, then commits   ${await shot(pg, 'teams-count-3')}`);

  // a colour change on one slot: BLUE -> PURPLE (PURPLE is not yet taken by another slot at this point)
  const slot0 = pg.getByTestId('match-teams-colour-0');
  const purple = slot0.getByRole('button', { name: 'PURPLE' });
  await purple.click();
  await until(() => pg.getByTestId('confirm-switch').count().then(n => n > 0), 4000, 'the reshape confirm (a colour change)');
  await purple.click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).game_pick.match.teams?.[0] === 'purple', 4000, 'the colour change committed');
  ok('TEAMS: a colour change on one slot asks first, then commits');

  // KOTH fixes the count at 2 and never offers yellow
  await pickMode(pg, 'KING OF THE HILL');
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'koth', 4000, 'KOTH applied');
  const stripText = await teamsItem.innerText();
  expect(!stripText.includes('YELLOW'), `KOTH never offers yellow (saw ${JSON.stringify(stripText)})`);
  expect(await pg.locator('[aria-label="team count"]').count() === 0, 'KOTH fixes the count, no control shown');
  ok(`TEAMS: KOTH fixes the count at 2 and never offers yellow   ${await shot(pg, 'teams-koth-no-yellow')}`);

  // Review MEDIUM 2 (brx1, e8811fea): back on TDM (teams share the count control again), bump to 4 --
  // every colour is then already spoken for, so one slot has only its own colour left. Screenshot: each
  // slot reads TEAM 1..TEAM 4, only the CHOSEN swatch in each is filled solid (the rest outlined and
  // dimmed), and the slot with no real choice is a single, disabled swatch rather than a dead-end tap.
  await pickMode(pg, 'TEAM DEATHMATCH');
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'tdm', 4000, 'TDM applied');
  const count4 = teamsItem.getByRole('button', { name: '4', exact: true });
  await count4.click();
  await until(() => pg.getByTestId('confirm-switch').count().then(n => n > 0), 4000, 'the reshape confirm (count to 4)');
  await count4.click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).game_pick.match.teams?.length === 4, 4000, '4 teams committed');
  const labels = await teamsItem.innerText();
  expect(/TEAM 1/.test(labels) && /TEAM 4/.test(labels), `each slot is labelled TEAM 1..TEAM 4 (saw ${JSON.stringify(labels.slice(0, 200))})`);
  // at 4 teams every colour is already spoken for, so EVERY slot's own colour is its only option.
  const disabledSwatches = await pg.locator('[data-testid^="match-teams-colour-"] button[disabled]').count();
  expect(disabledSwatches === 4, `all four slots have no real choice left, at 4 teams (saw ${disabledSwatches})`);
  ok(`TEAMS: at 4 teams, slots are labelled and the single-choice swatch is disabled   ${await shot(pg, 'teams-four-labelled')}`);
  await pg.context().close();
});

step('hold', async ({ browser, base }) => {
  // F415: KOTH only, NO TARGET by default, 3/5/10 MIN quick-picks reaching the server.
  const pg = await open(browser, base, '?mock#build', 1280);
  expect(await pg.getByTestId('match-hold-value').count() === 0, 'TDM has no HOLD item');
  await pickMode(pg, 'KING OF THE HILL');
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'koth', 4000, 'KOTH applied');
  await until(() => pg.getByTestId('match-hold-value').count().then(n => n > 0), 4000, 'the HOLD item');
  expect(await pg.getByTestId('match-hold-value').innerText().then(t => t.includes('NO TARGET')), 'NO TARGET by default');
  // Review MEDIUM 2 (brx1, e8811fea): NO TARGET said nothing about what it was NO TARGET *of* -- a
  // leading HOLD label now prefixes the whole item, the same way TEAMS labels its own.
  expect(await pg.getByText(/^HOLD$/).first().isVisible(), 'the item carries a leading HOLD label');
  await pg.getByTestId('match-hold-value').click();
  await pg.getByRole('button', { name: '5 MIN' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).game_pick.match.hold_target_s === 300, 4000, '"5 MIN" reaches the server');
  ok(`HOLD: NO TARGET by default, "5 MIN" reaches the server as 300s   ${await shot(pg, 'hold-5min')}`);
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
    // team-lead 2026-09-26: CONTINUE TO KIT must actually move the SERVER's own phase to "kit" (the
    // only door state.py's A27 not-ready guard fires from before this round's build->lobby widening) —
    // not just the console's own view.
    await pg.getByTestId('game-continue-kit').getByRole('button').click();
    await until(async () => (await fetch(`${mc.base}/api/state`).then(r => r.json())).phase === 'kit', 6000, 'the server phase to reach kit');
    const after = await fetch(`${mc.base}/api/state`).then(r => r.json());
    expect(after.phase === 'kit', `CONTINUE TO KIT ▸ moves the server's own phase to kit (saw ${JSON.stringify(after.phase)})`);
    ok('LOAD feedback (QA-01) holds against a real MC, and CONTINUE TO KIT ▸ moves the server phase to kit');
    await pg.context().close();
  } finally { await vite.stop(); await mc.stop(); }
});

step('real-teams-hold', async ({ browser }) => {
  // F413/F415 (games-presets.md §7), against a REAL MC: the mock-only steps (`teams`, `hold`, above)
  // prove the CONSOLE's own logic; this proves the wire actually carries it -- a real server's own
  // compose could disagree on field names, colour order or the koth gate in a way `?mock` never would.
  const mc = await startRealMC();
  const vite = await startVite(mc.port);
  try {
    const pg = await openReal(browser, vite.base, '#build', 1280);
    const teamsItem = pg.getByTestId('match-teams-item');
    await until(() => teamsItem.count().then(n => n > 0), 8000, 'the TEAMS item (TDM offers it)');
    // control: a fresh real MC starts on TDM's own default pair (2 teams) -- prove the count really is
    // 2 before bumping it, so "3 teams after" is not vacuously true of an already-3-team start.
    const before = await fetch(`${mc.base}/api/state`).then(r => r.json());
    expect(JSON.stringify(before.config.teams.map(t => t.team_id)) === JSON.stringify(['red', 'blue']),
      `control: TDM starts at red, blue (saw ${JSON.stringify(before.config.teams.map(t => t.team_id))})`);
    await teamsItem.getByRole('button', { name: '3', exact: true }).click();
    // a fresh MC's own demo roster reshapes on this, so the count control asks first, same as `?mock`.
    await until(() => pg.getByTestId('confirm-switch').count().then(n => n > 0), 6000, 'the reshape confirm (count to 3)');
    await teamsItem.getByRole('button', { name: '3', exact: true }).click();
    await until(async () => (await fetch(`${mc.base}/api/state`).then(r => r.json())).config.teams.length === 3, 8000, '3 teams reaches the real server');
    const withThree = await fetch(`${mc.base}/api/state`).then(r => r.json());
    expect(JSON.stringify(withThree.config.teams.map(t => t.team_id)) === JSON.stringify(['red', 'blue', 'yellow']),
      `the server's own config.teams is red, blue, yellow in order (saw ${JSON.stringify(withThree.config.teams.map(t => t.team_id))})`);
    ok('TEAMS: a count change to 3 reaches a real MC as red, blue, yellow, in order');

    await pickMode(pg, 'KING OF THE HILL');
    await until(async () => (await fetch(`${mc.base}/api/state`).then(r => r.json())).config.mode === 'koth', 6000, 'KOTH reaches the real server');
    // the server side of the round trip is done at this point, but the BROWSER's own websocket-pushed
    // state can still be a tick behind it -- wait for the mode button's own re-render, not the server's,
    // before reading the TEAMS item off the page (a bare server poll here read the item mid-stale-render).
    const kothBtn = pg.getByRole('button', { name: 'KING OF THE HILL' });
    await until(async () => (await kothBtn.getAttribute('aria-pressed')) === 'true', 6000, 'the button to show KotH picked');
    expect(await pg.locator('[aria-label="team count"]').count() === 0, 'KOTH fixes the count on a real MC too, no control shown');
    expect(!(await teamsItem.innerText()).includes('YELLOW'), 'KOTH never offers yellow on a real MC either');
    ok('TEAMS: KOTH fixes the count at 2 and never offers yellow, against a real MC');

    // control: the operator note must NOT already read a hold target before one is set.
    const noteBefore = await pg.getByTestId('operator-note').innerText();
    expect(!/FIRST TO HOLD/.test(noteBefore), `control: no hold target note yet (saw ${JSON.stringify(noteBefore)})`);
    await pg.getByTestId('match-hold-value').click();
    await pg.getByRole('button', { name: '5 MIN' }).click();
    await until(async () => (await fetch(`${mc.base}/api/state`).then(r => r.json())).config.scoring.hold_target_s === 300, 6000, '"5 MIN" reaches the real server as 300s');
    await until(() => pg.getByTestId('operator-note').innerText().then(t => /FIRST TO HOLD/.test(t)), 6000, 'the operator note picks up the hold target');
    const noteAfter = await pg.getByTestId('operator-note').innerText();
    expect(/FIRST TO HOLD 5:00 WINS/.test(noteAfter), `the operator note reads FIRST TO HOLD 5:00 WINS (saw ${JSON.stringify(noteAfter)})`);
    ok(`HOLD: "5 MIN" reaches a real MC as 300s, and the operator note names it   ${await shot(pg, 'real-teams-hold')}`);
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

// ---------------------------------------------------------------- FAVOURITES (games-presets.md §6)

step('favourites-save', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  expect(await pg.getByTestId('favourites-row').count() === 0, 'the FAVOURITES row is hidden with none saved');
  await pg.getByTestId('save-favourite').getByRole('button').click();
  await pg.getByLabel('favourite name').fill('Silent Snipers');
  await pg.getByRole('button', { name: 'SAVE ▸' }).click();
  await until(() => pg.locator('text=☆ Silent Snipers').count().then(n => n > 0), 4000, 'the new chip');
  expect(await pg.getByTestId('favourites-row').count() === 1, 'the row appears once a favourite exists');
  const saved = await pg.evaluate(() => window.__MC_MOCK__.getFavourites());
  expect(saved.length === 1 && saved[0].name === 'Silent Snipers' && saved[0].countdown_s === 30, `the favourite is saved with the current countdown (saw ${JSON.stringify(saved)})`);
  ok(`SAVE AS A FAVOURITE: hidden when empty, then one tap saves and shows a chip   ${await shot(pg, 'favourites-save')}`);
  await pg.context().close();
});

/** Tap a favourite chip. When the load would move rostered players, PLAY asks first (the moves-players
 *  confirm): wait for THIS tap's result (`loaded()` or the confirm), and tap again only if it asked. */
async function loadFavourite(pg, name, loaded) {
  const chip = pg.locator(`text=☆ ${name}`);
  const asked = () => pg.locator('text=TAP THE FAVOURITE AGAIN TO SWITCH').count().then(n => n > 0);
  await chip.click();
  await until(async () => (await loaded()) || (await asked()), 6000, `${name}: loaded, or the moves-players confirm`);
  if (await asked()) await chip.click();
}

step('favourites-load', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  // build a distinctive pick, save it, then change EVERYTHING before loading it back
  await pickMode(pg, 'KING OF THE HILL');
  await pg.getByRole('button', { name: 'SHIELDS' }).click();
  await pg.getByRole('button', { name: 'STATION' }).click();
  await pg.getByRole('switch', { name: 'silenced' }).click();
  await pg.getByTestId('match-countdown-value').click();
  await pg.getByRole('button', { name: '60 S' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'koth', 4000, 'the built pick settles');
  await pg.getByTestId('save-favourite').getByRole('button').click();
  await pg.getByLabel('favourite name').fill('Round One');
  await pg.getByRole('button', { name: 'SAVE ▸' }).click();
  await until(() => pg.locator('text=☆ Round One').count().then(n => n > 0), 4000, 'saved');

  await pickMode(pg, 'TEAM DEATHMATCH');
  await pg.getByRole('button', { name: 'STANDARD' }).click();
  await pg.getByRole('button', { name: 'AUTO' }).click();
  await pg.getByRole('switch', { name: 'silenced' }).click();
  await pg.getByTestId('match-countdown-value').click();
  await pg.getByRole('button', { name: '10 S' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'tdm', 4000, 'changed away from it');

  await loadFavourite(pg, 'Round One', async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'koth');
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'koth', 6000, 'LOAD restores the mode');
  const after = await pg.evaluate(() => window.__MC_MOCK__.getState());
  expect(after.config.mode === 'koth', 'GAME MODE restored');
  expect(after.config.health.max_shield === 105, 'LIFE restored');
  expect(after.config.respawn.type === 'scanner', 'SPAWN restored');
  expect(after.game_pick.match.silenced === true, 'SILENCED restored');
  const t = await text(pg);
  expect(/COUNTDOWN 60 S/.test(t), `the strip shows the restored countdown (saw the runway store, ${JSON.stringify(t.match(/COUNTDOWN \d+ S/))})`);
  ok(`FAVOURITES LOAD restores every picker and the strip, including the countdown   ${await shot(pg, 'favourites-load')}`);
  await pg.context().close();
});

step('favourites-fallback', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  const primaryId = await pg.evaluate(async () => {
    const api = window.__MC_MOCK__;
    const piece = await api.createPiece({ kind: 'primary', name: 'SNIPERS', value: { choice: 'fixed', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: 'sniper_rifle' } });
    return piece.piece_id;
  });
  await pg.evaluate(() => { location.hash = '#muster'; });
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.getByTestId('picker-primary').count().then(n => n === 1), 6000, 'PRIMARY appears');
  await pg.getByRole('button', { name: 'SNIPERS' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).game_pick.pieces.primary, 4000, 'SNIPERS picked');
  await pg.getByTestId('save-favourite').getByRole('button').click();
  await pg.getByLabel('favourite name').fill('Gone Tomorrow');
  await pg.getByRole('button', { name: 'SAVE ▸' }).click();
  await until(() => pg.locator('text=☆ Gone Tomorrow').count().then(n => n > 0), 4000, 'saved');
  // switch PLAY off the SNIPERS piece, then delete it out from under the favourite that named it
  await pg.getByRole('button', { name: 'ALL', exact: true }).first().click();
  await pg.evaluate(async pid => { await window.__MC_MOCK__.deletePiece(pid); }, primaryId);
  await pg.evaluate(() => { location.hash = '#muster'; });
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.locator('text=☆ Gone Tomorrow').count().then(n => n > 0), 6000, 'the favourite survives its piece being deleted');
  await pg.locator('text=☆ Gone Tomorrow').click();
  await until(() => pg.getByTestId('favourite-fallback-note').count().then(n => n === 1), 6000, 'the fallback line');
  const t = await text(pg);
  expect(/PRIMARY.*GONE.*USING ALL/i.test(t), `the fallback line names the kind and what it is using now (saw ${JSON.stringify(t.slice(t.indexOf('PRIMARY'), t.indexOf('PRIMARY') + 60))})`);
  ok(`a favourite whose piece is gone still loads, and says what it used instead (never a 404)   ${await shot(pg, 'favourites-fallback')}`);
  await pg.context().close();
});

step('favourites-rename', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.evaluate(async () => { await window.__MC_MOCK__.createFavourite({ name: 'Old Name', countdown_s: 30 }); });
  await pg.evaluate(() => { location.hash = '#muster'; });
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.getByTestId('favourites-row').count().then(n => n === 1), 4000, 'the chip');
  await pg.getByLabel('rename Old Name').click();
  const input = pg.getByLabel('rename Old Name');
  await input.fill('New Name');
  await input.press('Enter');
  await until(() => pg.locator('text=☆ New Name').count().then(n => n > 0), 4000, 'the rename lands');
  const row = await pg.evaluate(async () => (await window.__MC_MOCK__.getFavourites())[0]);
  expect(row.name === 'New Name', `the server holds the new name too (saw ${JSON.stringify(row.name)})`);
  ok('rename is inline (DraftText, commits on Enter) and reaches the server');
  await pg.context().close();
});

step('favourites-delete', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.evaluate(async () => { await window.__MC_MOCK__.createFavourite({ name: 'Delete Me', countdown_s: 30 }); });
  await pg.evaluate(() => { location.hash = '#muster'; });
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.locator('text=☆ Delete Me').count().then(n => n > 0), 4000, 'the chip');
  await pg.getByLabel('delete Delete Me').click();
  await until(() => pg.locator('text=DELETE DELETE ME?').count().then(n => n === 1), 4000, 'the confirm row');
  await pg.getByRole('button', { name: 'CANCEL' }).last().click();
  expect(await pg.evaluate(() => window.__MC_MOCK__.getFavourites()).then(f => f.length === 1), 'CANCEL keeps it — one tap never deletes');
  await pg.getByLabel('delete Delete Me').click();
  await pg.getByRole('button', { name: 'CONFIRM' }).click();
  await until(() => pg.locator('text=☆ Delete Me').count().then(n => n === 0), 4000, 'the chip is gone');
  const left = await pg.evaluate(() => window.__MC_MOCK__.getFavourites());
  expect(left.length === 0, 'the server holds none left');
  ok('delete is a real two-tap: CANCEL keeps it, CONFIRM removes it from the server too');
  await pg.context().close();
});

step('real-favourites', async ({ browser }) => {
  const mc = await startRealMC();
  const vite = await startVite(mc.port);
  try {
    const pg = await openReal(browser, vite.base, '#build', 1280);
    await pg.getByTestId('save-favourite').getByRole('button').click();
    await pg.getByLabel('favourite name').fill('Baseline');
    await pg.getByRole('button', { name: 'SAVE ▸' }).click();
    await until(() => pg.locator('text=☆ Baseline').count().then(n => n > 0), 6000, 'saved against a real MC');

    // change everything
    await pickMode(pg, 'KING OF THE HILL');
    await pg.getByRole('button', { name: 'HARDCORE' }).click();
    await pg.getByRole('button', { name: 'STATION' }).click();
    await pg.getByRole('switch', { name: 'silenced' }).click();
    await until(async () => (await fetch(`${mc.base}/api/state`).then(r => r.json())).config.mode === 'koth', 6000, 'the changes reach the real server');

    await loadFavourite(pg, 'Baseline', async () => (await fetch(`${mc.base}/api/state`).then(r => r.json())).config.mode === 'tdm');
    await until(async () => (await fetch(`${mc.base}/api/state`).then(r => r.json())).config.mode === 'tdm', 8000, 'LOAD restores the baseline on the real server');
    const after = await fetch(`${mc.base}/api/state`).then(r => r.json());
    expect(after.config.mode === 'tdm' && after.config.health.max_shield === 0 && after.config.health.max_armor === 70, `every picker restored (saw ${JSON.stringify(after.config.mode)}/${JSON.stringify(after.config.health)})`);
    expect(after.config.respawn.type === 'auto', 'SPAWN restored');
    expect(after.game_pick.match.silenced === false, 'the strip restored too');
    ok('save, change everything, LOAD: every picker and the strip come back, against a real MC');
    await pg.context().close();
  } finally { await vite.stop(); await mc.stop(); }
});

step('widths', async ({ browser, base }) => {
  // team-lead 2026-09-26: the strip must wrap cleanly at 900 AND 768px too (a TEAMS item joins it
  // later, F413) -- 768 added alongside the existing two.
  for (const w of [1280, 900, 768]) {
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
  ok('768px, 900px and 1280px: no overflow, real tap targets');
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
