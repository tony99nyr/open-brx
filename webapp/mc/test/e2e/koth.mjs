// The KING OF THE HILL setup flow, clicked in a real browser (commit d20a4ca).
//
// MC is a web app, so there is nothing to build: this starts `npm run dev` and a real
// `python -m brx_mcp.mc`, points Chromium at localhost, and clicks. Vite proxies /api and /ui-ws
// straight through to the server (vite.config.ts), so `page.route` and `page.routeWebSocket` still
// intercept everything a stale-server or failure-path run needs.
//
//   npm run e2e                            # all steps
//   ONLY=teams npm run e2e                 # one step (every step self-navigates)
//   HEADED=1 / KEEP_SHOTS=1 / MC_PY=...    # watch it / keep screenshots / pick the interpreter
//
// Component logic that is NOT about what a person sees stays in test/koth.test.tsx (jsdom, 2s).
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC = path.resolve(HERE, '../..');                 // webapp/mc
const REPO = path.resolve(MC, '../..');
const SHOTS = path.join(HERE, 'shots');
const ONLY = process.env.ONLY || '';

// ---------------------------------------------------------------- assertions
let failures = [];
let currentStep = '';
const expect = (cond, what) => {
  if (cond) return true;
  failures.push(`${currentStep}: ${what}`);
  console.log(`    ✗ ${what}`);
  return false;
};
// A ✓ printed by a step that has already recorded a failure is a lie in the transcript: the
// summary at the bottom was honest, but anyone scanning the ticks read a pass. `ok` refuses.
let stepFailedAt = 0;
const ok = what => console.log(failures.length > stepFailedAt ? `    ⊘ ${what} (step already failed above)` : `    ✓ ${what}`);
const until = async (pred, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = false;
    try { v = await pred(); } catch { v = false; }
    if (v) return true;
    if (Date.now() > end) { expect(false, `timed out waiting for ${what}`); return false; }
    await new Promise(r => setTimeout(r, 60));
  }
};

// ---------------------------------------------------------------- the two processes the owner runs
/** `npm run dev` is npm -> sh -> vite: signal the GROUP, or vite survives holding our stdio pipe */
const killGroup = proc => new Promise(done => {
  let settled = false;
  const finish = () => { if (!settled) { settled = true; done(); } };
  proc.once('exit', finish);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* already gone */ } }
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } finish(); }, 3000).unref();
});

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

async function startMC({ sessionFile = null, label = 'fresh' } = {}) {
  const py = process.env.MC_PY || path.join(REPO, '.venv', 'bin', 'python');
  if (!fs.existsSync(py) && !process.env.MC_PY) {
    console.error(`NO PYTHON — ${py} is missing. Set MC_PY to an interpreter with starlette/uvicorn/websockets.`);
    process.exit(3);
  }
  const port = 8765;                      // vite.config.ts proxies /api and /ui-ws to exactly this
  // If something already answers on 8765 we would silently drive THAT server and report on it —
  // which is how a run "passes" against a process it never started. Refuse instead.
  try {
    const squatter = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1500) });
    if (squatter.ok) {
      console.error(`SOMETHING IS ALREADY SERVING :${port} — that is the port vite.config.ts proxies to.`);
      console.error('Stop your own `python -m brx_mcp.mc` (or a leftover run) and try again.');
      process.exit(3);
    }
  } catch { /* nothing there: good */ }
  const wsPort = await freePort();
  const args = ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(port), '--ws-port', String(wsPort), '--demo', '--no-auth'];
  if (sessionFile) args.push('--session-file', sessionFile); else args.push('--ephemeral');
  const proc = spawn(py, args, { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  const up = await (async () => {
    for (let i = 0; i < 200; i++) {
      try { const r = await fetch(`${base}/api/state`); if (r.ok) return true; } catch { /* not yet */ }
      if (proc.exitCode != null) break;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  })();
  if (!up) {
    console.error(`MC (${label}) DID NOT START on :${port}:\n${log}`);
    console.error('If something else is already on 8765 that is probably your own MC — stop it, or run this against it by hand.');
    proc.kill('SIGKILL'); process.exit(3);
  }
  // The squatter check above is a PRE-check and it can lose a race (a server that came up in the
  // 100 ms between the probe and our spawn wins :8765 and ours dies quietly). So prove POSITIVELY
  // that the process answering is ours: `--ws-port` is a per-run random port and MC advertises it
  // as `lan.ws_url`, so a leftover server cannot be wearing it.
  const who = await (await fetch(`${base}/api/state`)).json();
  if (!String(who?.lan?.ws_url || '').includes(`:${wsPort}/`)) {
    console.error(`:${port} IS NOT THE MC WE LAUNCHED — it advertises ${JSON.stringify(who?.lan?.ws_url)}, we asked for ws port ${wsPort}.`);
    console.error('Something else owns that port. Stop it and re-run; driving it would report on a server this run never started.');
    await killGroup(proc); process.exit(3);
  }
  console.log(`  MC ${label} server: ${base}  (ours: ws ${wsPort}; session ${sessionFile ? path.basename(sessionFile) : 'ephemeral'})`);
  return { base, proc, log: () => log, stop: () => killGroup(proc) };
}

/** `npm run dev` — the same command the owner types. Vite serves src, so there is no bundle to stale. */
async function startVite() {
  const port = await freePort();
  const proc = spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], { cwd: MC, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite dev: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.error(`npm run dev DID NOT START:\n${log}`);
  proc.kill('SIGKILL'); process.exit(3);
}

// ---------------------------------------------------------------- page helpers
const jsErrors = [];
// a route handler whose page went away rejects on its own timeline; record it, never crash the run
process.on('unhandledRejection', e => {
  const m = String(e && e.message || e);
  if (/Target(Closed)?Error|Request context disposed|Target page, context or browser has been closed/.test(m)) return;
  failures.push(`${currentStep || 'run'}: unhandled rejection ${m.slice(0, 200)}`);
});
async function newPage(browser, base, viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => jsErrors.push(`[pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') jsErrors.push(`[console] ${m.text().slice(0, 300)}`); });
  pg.__base = base;
  return pg;
}
/** navigate to a console view by its URL hash — steps must be able to run alone under ONLY= */
async function go(pg, view) {
  await pg.goto(`${pg.__base}/#${view}`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header').count().then(n => n > 0), 8000, 'the command bar to render');
  // the first snapshot has arrived when the screen is no longer the CONNECTING placeholder
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 12000, 'the first snapshot');
  return pg;
}
/** close a page that has routes attached — an in-flight `route.fetch` after close throws globally */
const closePage = async pg => {
  try { await pg.unrouteAll({ behavior: 'ignoreErrors' }); } catch { /* no routes */ }
  await pg.context().close();
};
const shot = async (pg, name) => {
  const f = path.join(SHOTS, `${name}.png`);
  // frame from the top — a screenshot that has scrolled the command bar off is evidence of nothing —
  // and let `.screen`'s 250ms scanIn finish, or the evidence is a half-faded page
  await pg.evaluate(() => { window.scrollTo(0, 0); document.querySelector('main')?.scrollTo(0, 0); }).catch(() => {});
  await pg.waitForTimeout(320);
  await pg.screenshot({ path: f, fullPage: false });
  return f;
};
/** the value cell of a "LABEL   value" row in the GAMES / rail grids */
const railRow = (pg, label) => pg.locator(`main span:text-is("${label}") + span`).first();
const kothCard = pg => pg.locator('div[role="button"][aria-label="play KING OF THE HILL"]');
/** put the shared server back on a blue/yellow TDM so "pick KotH" is a real transition, not a no-op */
async function resetTdm(base) {
  // Every step shares ONE server, so a step that ARMS a match (setup-steps-prematch does) leaves
  // `PUT /api/config` refused with "cannot change config after the match has started" for every step
  // after it. That is not a product bug -- state.py is right to refuse -- it is this suite failing to
  // hand the next step the precondition it declares. Put the match back first.
  const phase0 = (await (await fetch(`${base}/api/state`)).json()).phase;
  if (!['muster', 'build', 'kit', 'lobby', 'recap'].includes(phase0)) {
    const ab = await fetch(`${base}/api/start/abort`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!ab.ok) throw new Error(`resetTdm: could not leave phase ${phase0} (POST /api/start/abort ${ab.status})`);
    const phase1 = (await (await fetch(`${base}/api/state`)).json()).phase;
    if (!['muster', 'build', 'kit', 'lobby'].includes(phase1)) throw new Error(`resetTdm: abort left phase ${phase1}, still not config-writable`);
  }
  const r = await fetch(`${base}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'tdm' }) });
  if (!r.ok) throw new Error(`resetTdm: PUT /api/config ${r.status} ${(await r.text()).slice(0, 160)} (phase was ${phase0})`);
  const st = await (await fetch(`${base}/api/state`)).json();
  const teams = st.config.teams.map(t => t.team_id);
  await Promise.all(st.players.map((p, i) => fetch(`${base}/api/players/${p.player_id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ team_id: teams[i % teams.length] }),
  })));
}
const errorStrip = pg => pg.locator('header button[role="alert"]');

/** Push + arm the real server so ARMED has a schedule to render (`Armed.tsx` early-returns without
 *  one). `force` waves the readiness board — there are no phones in a browser run. */
async function armMatch(base) {
  const push = await fetch(`${base}/api/lobby/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"force":true}' });
  if (!push.ok) throw new Error(`armMatch: POST /api/lobby/push ${push.status} ${await push.text()}`);
  const start = await fetch(`${base}/api/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"force":true}' });
  if (!start.ok) throw new Error(`armMatch: POST /api/start ${start.status} ${await start.text()}`);
  return start.json();
}

/** A koth RecapView built by MC'S OWN Scorer — see `recap_fixture.py` for why it is not a JSON
 *  literal in this file. Nothing on `app/src` sends a `possession` fact yet, so a browser run cannot
 *  reach a recap that has one by playing; this is the honest substitute. */
function recapFixture(args = []) {
  const py = process.env.MC_PY || path.join(REPO, '.venv', 'bin', 'python');
  const r = spawnSync(py, [path.join(HERE, 'recap_fixture.py'), ...args], { cwd: path.join(REPO, 'mcp'), encoding: 'utf8' });
  if (r.status !== 0) { console.error(`recap_fixture.py failed (${r.status}):\n${r.stderr}`); process.exit(3); }
  return JSON.parse(r.stdout);
}

/** Rewrite every snapshot the page receives — REST *and* the WebSocket, or the patch is a lie the
 *  first time a push arrives and overwrites it. `patch(state)` mutates the snapshot in place. */
async function patchSnapshots(pg, patch) {
  const seen = { rest: 0, ws: 0 };
  // /api/state is a bare State; the WebSocket wraps it -- `{kind:'snapshot', state:{...}}` (api/client.ts).
  // This used to test `typeof o.phase === 'string'` on the frame itself, which is false for the wrapper,
  // so EVERY pushed snapshot went through unpatched and promptly overwrote the patched REST one. The store
  // takes its state from the socket, so the patch never reached the screen at all. `seen.ws` counted
  // FORWARDED frames rather than PATCHED ones, so the guard meant to catch exactly this could not fail.
  const apply = body => {
    const o = JSON.parse(body);
    if (!o || typeof o !== 'object') return body;
    const st = typeof o.phase === 'string' ? o
      : (o.kind === 'snapshot' && o.state && typeof o.state.phase === 'string') ? o.state
      : null;
    if (!st) return null;                       // not a snapshot (a feed entry, an error): forward untouched
    patch(st);
    return JSON.stringify(o);
  };
  await pg.route('**/api/state', async r => {
    const res = await r.fetch(); const orig = await res.text();
    let body = orig;
    try { const out = apply(orig); if (out !== null) { body = out; seen.rest++; } } catch { /* not json */ }
    await r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  await pg.routeWebSocket('**/ui-ws*', ws => {
    const s = ws.connectToServer();
    s.onMessage(m => {
      const raw = m.toString();
      let out = null;
      try { out = apply(raw); } catch { out = null; }
      if (out === null) { ws.send(m); return; }
      seen.ws++; ws.send(out);
    });
    ws.onMessage(m => s.send(m));
  });
  return seen;
}

// ---------------------------------------------------------------- steps
const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step('boot', async ({ browser, base }) => {
  const pg = await go(await newPage(browser, base), 'build');
  expect(await pg.locator('main', { hasText: '[ A2 // GAMES ]' }).count() > 0, 'the GAMES screen renders its A2 header');
  expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, 'no error-boundary crash on first paint');
  expect(await pg.locator('nav button:has-text("GAMES")').count() > 0, 'the GAMES nav tab is present');
  ok(`GAMES renders  ${await shot(pg, '01-games')}`);
  await closePage(pg);
});

step('koth-selectable', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  const card = kothCard(pg);
  expect(await card.count() === 1, 'a KING OF THE HILL card exists in STOCK MODES');
  expect((await card.getAttribute('aria-pressed')) === 'false', 'KotH is not already the playing game');
  expect(await card.locator('text=KOTH').count() > 0, 'the card carries the KOTH abbreviation');
  await card.click();
  await until(async () => (await card.getAttribute('aria-pressed')) === 'true', 6000, 'the KotH card to report itself PLAYING');
  expect(await card.locator('span:text-is("PLAYING")').count() > 0, 'the card shows the PLAYING tag');
  const title = pg.getByTestId('playing-title');
  await until(async () => (await title.textContent()).trim() === 'KING OF THE HILL', 6000, 'the rail title to name the game');
  expect((await title.textContent()).trim() === 'KING OF THE HILL', 'the rail title reads KING OF THE HILL');
  expect(await pg.locator('main', { hasText: 'STOCK MODE // PLAYING' }).count() > 0, 'the rail marks it a STOCK MODE (untuned defaults)');
  ok(`KotH is selectable and becomes the playing game  ${await shot(pg, '02-koth-playing')}`);
  await closePage(pg);
});

step('objective-row', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await kothCard(pg).click();
  await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 6000, 'KotH playing');
  const row = railRow(pg, 'OBJECTIVE');
  expect(await row.count() > 0, 'the rail has an OBJECTIVE row for a station-gated mode');
  const v = (await row.textContent()).trim();
  expect(v === 'GRENADE HILL · ONE POINT', `OBJECTIVE reads "GRENADE HILL · ONE POINT" (saw ${JSON.stringify(v)})`);
  expect(await row.isVisible(), 'the OBJECTIVE row is visible, not merely in the DOM');
  // and it must be ABSENT for a mode that has no station source — the row is not decoration
  await pg.locator('div[role="button"][aria-label="play TEAM DEATHMATCH"]').click();
  await until(async () => (await railRow(pg, 'OBJECTIVE').count()) === 0, 6000, 'the OBJECTIVE row to disappear for TDM');
  ok(`OBJECTIVE = GRENADE HILL · ONE POINT on koth, absent on tdm  ${await shot(pg, '03-objective-row')}`);
  await closePage(pg);
});

step('setup-warning', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  // it must NOT be on screen before a hill mode is picked
  expect(await pg.locator('text=POWER-CYCLE THE GRENADE').count() === 0, 'no grenade setup step is shown for the default mode');
  await kothCard(pg).click();
  await until(async () => (await pg.locator('text=POWER-CYCLE THE GRENADE').count()) > 0, 8000, 'the SETUP warning to arrive with the snapshot');
  const warn = pg.locator('main div[role="status"] div', { hasText: 'POWER-CYCLE THE GRENADE' }).first();
  expect(await warn.isVisible(), 'the SETUP warning is visible in the rail');
  const txt = (await warn.textContent()).toUpperCase();
  for (const frag of ['POWER-CYCLE THE GRENADE', 'STARTS NEUTRAL', 'HILL MODE', 'PLACE IT']) {
    expect(txt.includes(frag), `the SETUP warning says ${JSON.stringify(frag)}`);
  }
  expect(txt.includes('ONE POINT ONLY'), 'the SETUP warning carries F88 one-point-only');
  // it is an operator-visible warning, not a swallowed technical advisory: the $SIR/frag-limit
  // warnings the server also sends must NOT be in this rail (mc/API.md)
  const railText = await pg.locator('main').textContent();
  expect(!/MULTIPLIER ROW|htk\/ttk_ms/i.test(railText), 'technical $SIR advisories stay out of the players-get rail');
  const box = await warn.boundingBox();
  expect(box && box.height >= 14, 'the warning has real height on screen');
  ok(`SETUP warning renders in the rail  ${await shot(pg, '04-setup-warning')}`);
  await closePage(pg);
});

// The step is only useful where it is ACTIONABLE. The operator reads "place the grenade" on GAMES,
// then walks out to place it from LOBBY (and during the runway, from ARMED) — and until 10437d6 it was
// gone from both. `SetupSteps` is deliberately narrowed to /^SETUP:/, so this also asserts the
// NEGATIVE: the $SIR multiplier rows and the frag-limit advisory the same server sends must NOT be on
// the last screen before the horn, or the operator learns to ignore the strip that matters.
step('setup-steps-prematch', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await kothCard(pg).click();
  await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 6000, 'KotH playing');
  // CONTROL: the server really is sending advisories alongside the SETUP step, or "they are not on
  // screen" would pass on an empty list. A frag limit on a venue with no coverage model adds a second
  // kind (compile.py) — set it so the negative covers more than the $SIR rows.
  const put = await fetch(`${base}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scoring: { frag_limit: 10, win_by: 'objective' } }) });
  expect(put.ok, `PUT a frag_limit onto the koth config (${put.status})`);
  const warns = (await (await fetch(`${base}/api/state`)).json()).config_warnings ?? [];
  const setup = warns.filter(w => /^SETUP:/i.test(w));
  const advisories = warns.filter(w => !/^SETUP:/i.test(w));
  expect(setup.length >= 1, `the server sends a SETUP step (saw ${JSON.stringify(warns.slice(0, 2))})`);
  expect(advisories.some(w => /\$SIR/.test(w)), 'CONTROL: the server also sends $SIR advisories');
  expect(advisories.some(w => /frag_limit/i.test(w)), 'CONTROL: the server also sends the frag-limit advisory');

  await armMatch(base);                       // ARMED renders nothing without a schedule
  for (const view of ['lobby', 'armed']) {
    await go(pg, view);
    const steps_ = pg.getByTestId('setup-steps');
    await until(() => steps_.count().then(n => n > 0), 8000, `the SETUP steps on ${view}`);
    expect(await steps_.isVisible(), `the SETUP step is VISIBLE on ${view.toUpperCase()}, where it is actionable`);
    const txt = (await steps_.textContent()).toUpperCase();
    expect(txt.includes('POWER-CYCLE THE GRENADE'), `${view}: the step names the power cycle`);
    expect(txt.includes('PLACE IT'), `${view}: the step says to place it`);
    // the narrowing, asserted on the screen the operator reads last
    const screen = (await pg.locator('main').textContent());
    expect(!/\$SIR/.test(screen), `${view}: no $SIR multiplier advisory on a pre-match screen`);
    expect(!/frag_limit/i.test(screen), `${view}: no frag-limit advisory on a pre-match screen`);
    const box = await steps_.boundingBox();
    expect(box && box.height >= 14, `${view}: the step has real height on screen`);
    const fsz = await steps_.locator('div').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    expect(fsz >= 11, `${view}: the step is legible (${fsz}px)`);
    ok(`${view.toUpperCase()} carries the field step, and only that  ${await shot(pg, `16-setup-${view}`)}`);
  }
  // and it is not invented: a mode with no grenade has no step on those screens either.
  // `armMatch` above put the server in `armed`, where state.py refuses every config change -- so the
  // mode pick below (and every step after this one) needs the match put back first.
  const ab = await fetch(`${base}/api/start/abort`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(ab.ok, `the armed match can be aborted back to a config-writable phase (${ab.status})`);
  const backTo = (await (await fetch(`${base}/api/state`)).json()).phase;
  expect(['muster', 'build', 'kit', 'lobby'].includes(backTo), `abort returns a config-writable phase (saw ${backTo})`);
  await go(pg, 'build');
  // The frag_limit PUT above made this config a TUNED, UNSAVED draft, so Games.tsx `guarded` asks
  // once before discarding it. That is the product working (skill: "confirm discards"), and it is
  // worth an assertion of its own -- nothing else in this file covers the two-tap confirm.
  const tdm = pg.locator('div[role="button"][aria-label="play TEAM DEATHMATCH"]');
  await tdm.click();
  const confirm = tdm.locator('div[role="status"]', { hasText: 'TAP AGAIN' });
  await until(() => confirm.count().then(n => n > 0), 6000, 'the discard confirm on the first tap');
  expect(await confirm.isVisible(), 'switching away from a tuned draft warns BEFORE it discards it');
  expect(/THIS DROPS YOUR UNSAVED TUNED GAME/i.test(await confirm.textContent()), 'and the warning says what is lost');
  expect((await tdm.getAttribute('aria-pressed')) === 'false', 'and the first tap has NOT switched the game');
  await tdm.click();
  await until(async () => (await tdm.getAttribute('aria-pressed')) === 'true', 8000, 'TDM playing');
  await go(pg, 'lobby');
  await until(() => pg.getByTestId('setup-steps').count().then(n => n === 0), 6000, 'the SETUP step to disappear for TDM');
  ok('no SETUP step on a LOBBY for a mode with nothing to place');
  await closePage(pg);
});

// 🔴 the highest-value step in the file. Yellow is $TID 2, which is what a NEUTRAL hill broadcasts:
// a tid-2 roster reads every uncaptured point as its own and cannot be hit by the hill's damage word
// (F82). So: blue+green in the config, no yellow chip offered, and nobody left standing on yellow.
step('teams-never-yellow', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  // the demo roster starts half BLUE half YELLOW on tdm — prove that, so the koth assertion is not vacuous
  const preTeams = await (await fetch(`${base}/api/state`)).json();
  expect(preTeams.players.some(p => p.team_id === 'yellow'), 'the roster really does start with yellow players (control)');
  await kothCard(pg).click();
  await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 6000, 'KotH playing');

  await go(pg, 'kit');
  const group = pg.locator('span[role="group"][aria-label="team"]');
  await until(() => group.count().then(n => n > 0), 8000, 'the KIT team chip group');
  const chips = await group.locator('button').allTextContents();
  expect(JSON.stringify(chips.map(c => c.trim())) === JSON.stringify(['BLUE', 'GREEN']),
    `KIT offers exactly BLUE and GREEN (saw ${JSON.stringify(chips)})`);
  expect(!chips.some(c => /YELLOW/i.test(c)), '🔴 F82: YELLOW is never offered as a koth team');
  const pressed = await group.locator('button[aria-pressed="true"]').allTextContents();
  expect(pressed.length === 1 && /BLUE|GREEN/.test(pressed[0]), `the selected player sits on a legal koth team (saw ${JSON.stringify(pressed)})`);

  // no row in the roster rail is painted yellow — the stripe is the operator's only team readout there
  const YELLOW = ['rgb(255, 210, 63)', 'rgb(255, 211, 63)'];
  const stripes = await pg.locator('.kit-row > span:first-child').evaluateAll(els =>
    els.map(el => getComputedStyle(el).backgroundColor));
  expect(stripes.length > 0, 'the roster rail rendered team stripes');
  expect(!stripes.some(c => YELLOW.includes(c)), `🔴 F82: no roster row is painted yellow (saw ${JSON.stringify([...new Set(stripes)])})`);

  // and the server agrees: nobody is on tid 2
  const st = await (await fetch(`${base}/api/state`)).json();
  const tidOf = Object.fromEntries(st.config.teams.map(t => [t.team_id, t.tid]));
  expect(JSON.stringify(st.config.teams.map(t => t.tid)) === JSON.stringify([1, 3]), `config teams are tids 1 and 3 (saw ${JSON.stringify(st.config.teams.map(t => t.tid))})`);
  expect(!st.players.some(p => tidOf[p.team_id] === 2), '🔴 F82: no player is rostered on $TID 2');
  expect(st.config_errors.length === 0, `the server does not refuse the push (saw ${JSON.stringify(st.config_errors)})`);
  ok(`blue+green only, no yellow chip, no yellow roster row  ${await shot(pg, '05-teams-no-yellow')}`);
  await closePage(pg);
});

// The hill's team split is silent: everyone who was on yellow lands on teams[0]. If the console does
// not say so, the operator walks onto the field with 8 v 0 and no idea the server moved anyone.
step('reteam-visible', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await kothCard(pg).click();
  await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 6000, 'KotH playing');
  await go(pg, 'lobby');
  const st = await (await fetch(`${base}/api/state`)).json();
  const counts = {};
  for (const p of st.players) counts[p.team_id] = (counts[p.team_id] ?? 0) + 1;
  const empty = st.config.teams.filter(t => !counts[t.team_id]);
  // Switching to koth moves everyone who was on YELLOW onto teams[0] (state.py set_config). That is the
  // right call for F82, but it is SILENT — so the console has to make the resulting split legible. The
  // only place it currently shows is the LOBBY column headcount, which is what this asserts. Anything
  // stronger (a "the hill needs two sides" warning) is a product decision, reported not invented.
  expect(empty.length === 1 && empty[0].team_id === 'green',
    `the re-team really does empty one koth side (counts ${JSON.stringify(counts)}) — control for the readout below`);
  const cols = await pg.locator('main span:text-is("GREEN TEAM")').count();
  expect(cols > 0, 'the LOBBY renders a column for the empty GREEN side rather than hiding it');
  const zero = await pg.locator('main', { hasText: '0 OPERATORS' }).count();
  expect(zero > 0, `the LOBBY shows the empty side as "0 OPERATORS" (counts ${JSON.stringify(counts)})`);
  ok(`the silent re-team is at least legible as 0 OPERATORS  ${await shot(pg, '06-reteam')}`);
  await closePage(pg);
});

step('station-source-control', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await kothCard(pg).click();
  await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 6000, 'KotH playing');
  // the operator opens the game in the designer — that is where every other rule is edited
  await pg.locator('button[aria-label="customize KING OF THE HILL"]').click();
  await until(() => pg.locator('main', { hasText: '[ A2b // GAME DESIGNER ]' }).count().then(n => n > 0), 8000, 'the designer');
  const grp = pg.locator('span[role="group"][aria-label="objective source"]');
  expect(await grp.count() === 1, 'the DESIGNER has an OBJECTIVE SOURCE control for a station-gated mode');
  if (await grp.count() !== 1) { await shot(pg, '07-station-source-MISSING'); await closePage(pg); return; }
  const labels = (await grp.locator('button').allTextContents()).map(s => s.trim());
  expect(JSON.stringify(labels) === JSON.stringify(['GRENADE', 'IR STATION', 'PHONE']), `it offers exactly the server vocabulary (saw ${JSON.stringify(labels)})`);
  const on = await grp.locator('button[aria-pressed="true"]').textContent();
  expect(on.trim() === 'GRENADE', `koth defaults to GRENADE (saw ${JSON.stringify(on.trim())})`);
  // clicking the other value must visibly change the rail, not just the draft object
  await grp.locator('button:text-is("IR STATION")').click();
  await until(async () => /IR STATION/.test(await pg.locator('aside.designer-rail').textContent()), 4000, 'the designer rail to follow the pick');
  expect((await grp.locator('button[aria-pressed="true"]').textContent()).trim() === 'IR STATION', 'the chip reports itself pressed');
  const hint = await pg.locator('main').textContent();
  expect(/UNPROVEN|NEVER HAD ONE|NOT CONFIRMED/i.test(hint), 'IR STATION is marked as never bench-proven');
  await grp.locator('button:text-is("GRENADE")').click();
  await until(async () => /GRENADE/.test(await railRow(pg, 'OBJECTIVE').textContent()), 4000, 'the rail back to GRENADE');
  ok(`OBJECTIVE SOURCE is reachable and both values respond  ${await shot(pg, '07-station-source')}`);
  await closePage(pg);
});

// A refusal is only useful if the operator can READ it. The server's 400 names the whole vocabulary;
// the strip that shows it used to be one nowrap line clipped at 420px, so the valid values were gone.
step('station-source-refused', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  const VOCAB = "station_source must be null or one of: grenade (a BRX Smart Grenade in hill mode (protocol-15 beacons; bench-proven 2026-09-10)), ir_station (a BRX station / Utility Box emitting $CAPTURE objective events (unproven on our bench))";
  await pg.route('**/api/config', r => r.request().method() === 'PUT'
    ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: VOCAB }) })
    : r.continue());
  await kothCard(pg).click();
  const strip = errorStrip(pg);
  await until(() => strip.count().then(n => n > 0), 8000, 'the refusal to reach the error strip');
  expect(await strip.isVisible(), 'the refusal is VISIBLE, not swallowed');
  const txt = await strip.textContent();
  expect(txt.includes('grenade') && txt.includes('ir_station'), `the strip carries both valid values (saw ${JSON.stringify(txt.slice(0, 120))}…)`);
  // clipped text is not a message: the rendered box must actually fit what it holds
  const fit = await strip.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, title: el.getAttribute('title') }));
  expect(fit.sw <= fit.cw + 1 && fit.sh <= fit.ch + 1,
    `the refusal is not clipped (scroll ${fit.sw}x${fit.sh} vs client ${fit.cw}x${fit.ch}) — an ellipsised vocabulary names nothing`);
  expect((fit.title || '').includes('ir_station'), 'the strip also carries the full text as its title attribute');
  // a refused config must not leave the card claiming it is playing
  expect((await kothCard(pg).getAttribute('aria-pressed')) === 'false', 'a refused mode pick does not show as PLAYING');
  ok(`a refused station_source is readable on screen  ${await shot(pg, '08-refusal')}`);
  await closePage(pg);
});

// F88: >1 control point on a grenade source is not buildable. `control_points` is not a PUT-able
// config key (state.py `_CONFIG_KEYS`), so the error can only arrive in a snapshot — which is exactly
// what this asserts: a config_errors entry must reach the screen, not be swallowed.
step('f88-multipoint-refused', async ({ browser, base }) => {
  const pg = await newPage(browser, base);
  const F88 = 'F88: 3 control points on a grenade source is not buildable — a hill beacon carries no station id, so two grenades in range are indistinguishable on the wire and would fight over the same point. Run ONE point (koth), or supply a station source that names its point';
  const inject = o => { if (o && typeof o === 'object') { if (Array.isArray(o.config_errors)) o.config_errors = [...o.config_errors, F88]; for (const k of Object.keys(o)) inject(o[k]); } return o; };
  await pg.route('**/api/state', async r => {
    const res = await r.fetch(); let body = await res.text();
    try { body = JSON.stringify(inject(JSON.parse(body))); } catch { /* not json */ }
    await r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  await pg.routeWebSocket('**/ui-ws*', ws => {
    const s = ws.connectToServer();
    s.onMessage(m => { try { ws.send(JSON.stringify(inject(JSON.parse(m.toString())))); } catch { ws.send(m); } });
    ws.onMessage(m => s.send(m));
  });
  await go(pg, 'build');
  await until(async () => (await pg.locator('text=F88').count()) > 0, 10000, 'the F88 refusal to reach the screen');
  const el = pg.locator('main', { hasText: 'F88' }).locator('text=/F88/').first();
  const shown = (await pg.locator('main').textContent());
  expect(/F88/.test(shown), 'the F88 refusal is rendered in the GAMES rail, not swallowed');
  expect(/NOT BUILDABLE/i.test(shown), 'the refusal keeps its reason (not buildable)');
  expect(/ONE POINT/i.test(shown), 'the refusal keeps its remedy (run ONE point)');
  const fs_ = await pg.locator('main div', { hasText: 'F88' }).last().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
  expect(fs_ >= 11, `the refusal is legible (${fs_}px, must be >= 11px)`);
  void el;
  ok(`an F88 config error is visible on screen  ${await shot(pg, '09-f88')}`);
  await closePage(pg);
});

step('continue-path', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await kothCard(pg).click();
  await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 6000, 'KotH playing');
  // the user's real path: the CONTINUE button, not the nav tab
  await pg.locator('main button:has-text("CONTINUE ▸")').first().click();
  await until(() => pg.locator('main', { hasText: '[ A3 // KIT-OUT ]' }).count().then(n => n > 0), 8000, 'KIT to open from CONTINUE');
  expect(await pg.locator('main', { hasText: 'Kit Each Player' }).count() > 0, 'the KIT screen title is on screen');
  expect(new URL(pg.url()).hash === '#kit', `CONTINUE moved the URL to #kit (saw ${JSON.stringify(new URL(pg.url()).hash)})`);
  expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, 'KIT does not crash for a koth game');
  const st = await (await fetch(`${base}/api/state`)).json();
  expect(st.phase === 'kit', `CONTINUE advanced the server phase to kit (saw ${st.phase})`);
  ok(`GAMES → CONTINUE ▸ → KIT  ${await shot(pg, '10-continue-kit')}`);
  await closePage(pg);
});

// F70 — the recap of a hill match. `win_text` promises POSSESSION TIME, and until 11e3ca8 the screen
// answered with a kills table: the fact was ingested, scored, served, and rendered nowhere.
step('recap-possession', async ({ browser, base }) => {
  await resetTdm(base);
  const rc = recapFixture(['--coverage', 'thin']);
  expect(rc.possession?.by_team?.blue === 214 && rc.possession?.by_team?.green === 131,
    `the fixture MC's own scorer produced is the one we expect (${JSON.stringify(rc.possession)})`);
  const pg = await newPage(browser, base);
  const seen = await patchSnapshots(pg, st => { st.recap = rc; });
  await go(pg, 'build');
  await kothCard(pg).click();
  await go(pg, 'recap');
  const poss = pg.getByTestId('possession');
  await until(() => poss.count().then(n => n > 0), 10000, 'the POSSESSION panel to render');
  expect(await poss.isVisible(), 'the possession panel is visible on the recap');
  const txt = await poss.textContent();
  // mm:ss, not raw seconds: 214 s is 3:34 and 131 s is 2:11
  expect(/3:34/.test(txt), `BLUE's 214 s reads as 3:34 (saw ${JSON.stringify(txt.slice(0, 160))})`);
  expect(/2:11/.test(txt), "GREEN's 131 s reads as 2:11");
  expect(/BLUE/.test(txt) && /GREEN/.test(txt), 'both sides are named');
  // the bars are the at-a-glance readout: the leader's must be full and the trailer's proportional
  const bars = await poss.locator('span > span[style*="width"]').evaluateAll(els => els.map(el => ({
    pct: el.style.width, w: Math.round(el.getBoundingClientRect().width), bg: getComputedStyle(el).backgroundColor })));
  expect(bars.length === 2, `one bar per team (saw ${bars.length})`);
  expect(bars[0]?.pct === '100%', `the leader's bar is full (saw ${JSON.stringify(bars[0])})`);
  expect(bars[1] && bars[1].w > 0 && bars[1].w < bars[0].w, `the trailing bar is shorter and not zero (${JSON.stringify(bars)})`);
  expect(bars[0].bg !== bars[1].bg, `the two bars are painted their own team colours (${JSON.stringify(bars.map(b => b.bg))})`);
  // neutral time is nobody's, and the screen has to say so or 96 s went missing
  expect(/NEUTRAL 1:36/.test(txt), `the 96 s the hill sat unowned is shown as NEUTRAL 1:36 (saw ${JSON.stringify(txt.slice(0, 240))})`);
  expect(/NOBODY HELD THE POINT/i.test(txt), 'the neutral line says nobody held it');
  // 🔴 the whole reason the panel exists: the WINNER comes off possession, not the kills table
  const winner = await pg.locator('main').textContent();
  // the block names the TEAM as the live config names it ("BLUE TEAM"), not the raw team_id
  expect(/BLUE(\s+TEAM)?\s+WINS/.test(winner), `BLUE (214 s) is named the winner, from possession (saw ${JSON.stringify(winner.slice(0, 80))})`);
  expect(!/UNDECIDED/.test(winner), 'a match with a tally is no longer UNDECIDED · HOST DECIDES');
  expect(seen.ws > 0, 'the WebSocket snapshots were patched too, not only REST');
  ok(`the possession bar renders mm:ss per team  ${await shot(pg, '17-possession')}`);
  await closePage(pg);
});

// Possession from a grenade is a LOWER BOUND (F92: the beacon is IR, only a gun in range hears it).
// A number presented as the result when a third of the match went unwatched is a wrong answer stated
// confidently, so the coverage line goes AMBER under 75%.
step('recap-coverage-floor', async ({ browser, base }) => {
  await resetTdm(base);
  const open = async coverage => {
    const pg = await newPage(browser, base);
    await patchSnapshots(pg, st => { st.recap = recapFixture(['--coverage', coverage]); });
    await go(pg, 'build');
    await kothCard(pg).click();
    await go(pg, 'recap');
    const line = pg.getByTestId('possession').locator('div', { hasText: 'BEST COVERAGE' }).last();
    await until(() => line.count().then(n => n > 0), 10000, `the coverage line (${coverage})`);
    return { pg, line };
  };
  const thin = await open('thin');            // 441 of 600 s = 73.5%
  const tTxt = await thin.line.textContent();
  expect(/BEST COVERAGE 7:21 OF 10:00/.test(tTxt), `the coverage line reads "BEST COVERAGE 7:21 OF 10:00" (saw ${JSON.stringify(tTxt.trim().slice(0, 140))})`);
  expect(/THIS IS A FLOOR, NOT A FULL ACCOUNT/i.test(tTxt), 'it says the number is a FLOOR');
  expect(/^▲/.test(tTxt.trim()), 'under 75% coverage it is flagged with ▲');
  const tStyle = await thin.line.evaluate(e => ({ c: getComputedStyle(e).color, px: parseFloat(getComputedStyle(e).fontSize) }));
  expect(tStyle.px >= 10, `the coverage line is legible (${tStyle.px}px)`);
  await shot(thin.pg, '18-coverage-thin');
  await closePage(thin.pg);

  const full = await open('full');            // 560 of 600 s = 93%
  const fTxt = await full.line.textContent();
  expect(/BEST COVERAGE 9:20 OF 10:00/.test(fTxt), `a well-watched match reads 9:20 OF 10:00 (saw ${JSON.stringify(fTxt.trim().slice(0, 140))})`);
  expect(!/^▲/.test(fTxt.trim()), 'CONTROL: over 75% coverage is NOT flagged — the amber means something');
  const fStyle = await full.line.evaluate(e => getComputedStyle(e).color);
  expect(fStyle !== tStyle.c, `the thin run is painted a different colour from the covered one (${tStyle.c} vs ${fStyle})`);
  ok(`the coverage floor is stated, and amber only under 75%  ${await shot(full.pg, '18-coverage-full')}`);
  await closePage(full.pg);
});

// A8, field 2026-08-30: "it kinda was showing the final results as if it was final and then it finally
// popped up and the totals changed". The server has served `settling` since A8 and nothing rendered it.
step('recap-settling', async ({ browser, base }) => {
  await resetTdm(base);
  const rc = recapFixture(['--coverage', 'full', '--settling']);
  expect(rc.settling === true && (rc.awaiting || []).length === 2, `the fixture is a SETTLING recap (${JSON.stringify({ s: rc.settling, a: rc.awaiting })})`);
  expect(rc.provisional === false, 'and NOT provisional — this banner is the one `provisional` cannot cover');
  const pg = await newPage(browser, base);
  await patchSnapshots(pg, st => { st.recap = rc; });
  await go(pg, 'build');
  await kothCard(pg).click();
  await go(pg, 'recap');
  const band = pg.getByTestId('settling');
  await until(() => band.count().then(n => n > 0), 10000, 'the STILL SETTLING banner');
  expect(await band.isVisible(), 'the STILL SETTLING banner is visible');
  const txt = await band.textContent();
  expect(/STILL SETTLING/.test(txt), 'it says STILL SETTLING');
  expect(/2 NODES HAVE NOT REPORTED SINCE THE WHISTLE/.test(txt), `it counts the silent nodes (saw ${JSON.stringify(txt.trim().slice(0, 160))})`);
  expect(/THESE TOTALS CAN STILL CHANGE/.test(txt), 'it says the totals can still change — the whole point');
  // Case matters here: nothing uppercases this band, so a `4s` in the source renders as a lowercase
  // "4s" in an otherwise all-caps strip. Asserted exactly, not case-insensitively.
  expect(/4S AGO/.test(txt), `it says how long ago the whistle was, in the band's own case (saw ${JSON.stringify(txt.trim().slice(0, 200))})`);
  expect(!/\ds AGO/.test(txt), 'and not as a lowercase "4s" in a caps strip');
  expect(!/PROVISIONAL/.test(txt), 'it is its own banner, not the provisional one');
  const px = await band.evaluate(e => parseFloat(getComputedStyle(e).fontSize));
  expect(px >= 10, `the banner is legible (${px}px)`);
  await shot(pg, '19-settling');
  await closePage(pg);

  // 🔴 the control. A banner that is always there says nothing: a SETTLED recap must render NOTHING.
  const pg2 = await newPage(browser, base);
  await patchSnapshots(pg2, st => { st.recap = recapFixture(['--coverage', 'full']); });
  await go(pg2, 'build');
  await kothCard(pg2).click();
  await go(pg2, 'recap');
  await until(() => pg2.getByTestId('possession').count().then(n => n > 0), 10000, 'the settled recap to render');
  expect(await pg2.getByTestId('settling').count() === 0, 'a settled recap renders NO settling banner');
  expect(!/STILL SETTLING/.test(await pg2.locator('main').textContent()), 'and no STILL SETTLING text anywhere on it');
  ok(`STILL SETTLING on a moving recap, nothing on a settled one  ${await shot(pg2, '19-settled')}`);
  await closePage(pg2);
});

// The card is a PROMISE about the result screen. MC scores possession the moment a node reports one,
// but nothing on `app/src` sends the fact yet (state.py), so a card reading plain "POSSESSION TIME"
// promises a number that does not exist and hands the operator a kills table. `?mock` has to say the
// same thing, or the demo the console is iterated on predicts a console that does not exist.
step('mode-card-host-call', async ({ browser, base }) => {
  await resetTdm(base);
  const WIN = 'POSSESSION TIME · HOST CALL';
  const server = (await (await fetch(`${base}/api/modes`)).json()).find(m => m.mode === 'koth');
  expect(server?.win_text === WIN, `the server's koth win_text is ${JSON.stringify(WIN)} (saw ${JSON.stringify(server?.win_text)})`);
  for (const url of [`${base}/#build`, `${base}/?mock#build`]) {
    const pg = await newPage(browser, base);
    await pg.goto(url, { waitUntil: 'domcontentloaded' });
    await until(() => pg.locator('main', { hasText: '[ A2 // GAMES ]' }).count().then(n => n > 0), 12000, `the GAMES screen (${url})`);
    await kothCard(pg).click();
    await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 8000, `KotH playing (${url})`);
    const win = (await railRow(pg, 'WIN').textContent()).trim();
    expect(win === WIN, `${url.includes('mock') ? '?mock' : 'server'}: the WIN row reads ${JSON.stringify(WIN)} (saw ${JSON.stringify(win)})`);
    await shot(pg, `20-win-text-${url.includes('mock') ? 'mock' : 'server'}`);
    await closePage(pg);
  }
  ok('the koth card says the winner is the HOST CALL until a phone sends a possession fact');
});

// A stale server: the new fields are gone from REST *and* from the pushed snapshots, and the A10
// routes 404. Every page must still render and the skew must be explained on screen.
step('stale-server', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await newPage(browser, base);
  const strip = o => {
    if (o && typeof o === 'object') {
      delete o.station_source;
      if (Array.isArray(o.config_warnings)) o.config_warnings = o.config_warnings.filter(w => !/^SETUP:/i.test(String(w)));
      for (const k of Object.keys(o)) strip(o[k]);
    }
    return o;
  };
  let stripped = 0, wsStripped = 0;
  await pg.route('**/api/**', async r => {
    const u = r.request().url();
    if (/\/api\/(perks|presets)/.test(u)) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
    const res = await r.fetch(); let body = await res.text();
    try { body = JSON.stringify(strip(JSON.parse(body))); stripped++; } catch { /* not json */ }
    await r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  await pg.routeWebSocket('**/ui-ws*', ws => {
    const s = ws.connectToServer();
    s.onMessage(m => { try { ws.send(JSON.stringify(strip(JSON.parse(m.toString())))); wsStripped++; } catch { ws.send(m); } });
    ws.onMessage(m => s.send(m));
  });
  await go(pg, 'build');
  expect(stripped > 0, 'REST bodies were actually stripped (the interception is live)');
  // the skew banner is the whole point of a stale run
  await until(() => pg.locator('header [role="alert"]:has-text("PREDATES THIS UI")').count().then(n => n > 0), 8000, 'the version-skew banner');
  const banner = await pg.locator('header [role="alert"]:has-text("PREDATES THIS UI")').first().textContent();
  expect(/python -m brx_mcp\.mc/.test(banner), 'the banner gives the restart command');
  // picking KotH must still work locally, and the missing field must simply not render
  await kothCard(pg).click();
  await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 8000, 'KotH selectable against a stale server');
  expect(await railRow(pg, 'OBJECTIVE').count() === 0, 'no OBJECTIVE row is invented when the server sends no station_source');
  expect(await pg.locator('text=POWER-CYCLE THE GRENADE').count() === 0, 'no SETUP warning is invented when the server sends none');
  expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, 'GAMES survives a missing station_source (no undefined.something)');
  for (const v of ['muster', 'kit', 'lobby', 'live', 'recap', 'catalog', 'debug', 'designer']) {
    await go(pg, v);
    expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, `${v} renders against a stale server`);
  }
  expect(wsStripped > 0, 'the WebSocket was stripped too — a REST-only "stale" run is a lie');
  ok(`stale server: every page renders, skew banner shown, ${wsStripped} snapshots stripped  ${await shot(pg, '11-stale')}`);
  await closePage(pg);
});

step('failure-path', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  const puts = [];
  await pg.route('**/api/config', r => {
    if (r.request().method() !== 'PUT') return r.continue();
    puts.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"compiler exploded"}' });
  });
  await kothCard(pg).click();
  await until(() => errorStrip(pg).count().then(n => n > 0), 8000, 'the 500 to surface in the strip');
  expect(/COMPILER EXPLODED|compiler exploded/.test(await errorStrip(pg).textContent()), 'the server message is shown verbatim, not "something went wrong"');
  await new Promise(r => setTimeout(r, 700));
  expect(puts.length === 1, `no follow-on config PUT fired after the failure (saw ${puts.length}: ${JSON.stringify(puts.map(p => Object.keys(p)))})`);
  expect((await kothCard(pg).getAttribute('aria-pressed')) === 'false', 'the card does not claim PLAYING after a 500');
  expect(await railRow(pg, 'OBJECTIVE').count() === 0, 'the rail does not show a hill objective for a config the server rejected');
  ok(`a 500 on PUT /api/config is visible and stops the flow  ${await shot(pg, '12-failure')}`);
  await closePage(pg);
});

// The owner's phone is a Pixel 4 (393x830); MC is also opened on a tablet and on short laptop screens.
for (const [name, vp] of [['pixel4', { width: 393, height: 830 }], ['tablet', { width: 820, height: 1180 }], ['landscape-short', { width: 1024, height: 500 }]]) {
  step(`viewport-${name}`, async ({ browser, base }) => {
    await resetTdm(base);
    const pg = await go(await newPage(browser, base, vp), 'build');
    await kothCard(pg).click();
    await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 8000, 'KotH playing');
    for (const view of ['build', 'kit']) {
      await go(pg, view);
      const over = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth,
        wide: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 2)
          .slice(0, 4).map(e => `${e.tagName}.${(e.className || '').toString().slice(0, 18)}`) }));
      expect(over.doc <= over.win + 1, `${view} at ${vp.width}x${vp.height} does not scroll sideways (${over.doc} > ${over.win}; ${JSON.stringify(over.wide)})`);
    }
    await go(pg, 'build');
    // the two things this flow exists to say must survive the narrow layout: still rendered, still
    // unclipped. (`isVisible()` is not "in the viewport" — the width check is what proves nothing is
    // cut off, and the rail is below the fold at 393px by design.)
    const warn = pg.locator('main div[role="status"] div', { hasText: 'POWER-CYCLE THE GRENADE' }).first();
    expect(await warn.isVisible(), `the SETUP warning is still rendered at ${vp.width}px`);
    const wb = await warn.boundingBox();
    expect(wb && wb.x >= -1 && wb.x + wb.width <= vp.width + 1, `the SETUP warning fits the ${vp.width}px width (${JSON.stringify(wb)})`);
    expect((await railRow(pg, 'OBJECTIVE').textContent()).includes('GRENADE HILL'), `the OBJECTIVE row survives at ${vp.width}px`);
    ok(`${vp.width}x${vp.height} clean  ${await shot(pg, `13-${name}`)}`);
    await closePage(pg);
  });
}

step('audit-taps', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await kothCard(pg).click();
  await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 6000, 'KotH playing');
  const scan = async where => pg.evaluate(() => [...document.querySelectorAll('main button, main [role="button"], main [role="switch"], main [role="radio"]')]
    .filter(el => el.offsetParent !== null)
    .map(el => { const r = el.getBoundingClientRect(); return { t: (el.getAttribute('aria-label') || el.textContent || '?').trim().slice(0, 34), h: Math.round(r.height), w: Math.round(r.width) }; })
    .filter(x => x.h > 0)).then(rows => ({ where, rows }));
  const pages = [];
  pages.push(await scan('games'));
  await go(pg, 'kit'); pages.push(await scan('kit'));
  await pg.locator('button[aria-label="customize KING OF THE HILL"]').count();   // keep designer reachable from games
  await go(pg, 'build');
  await pg.locator('button[aria-label="customize KING OF THE HILL"]').click();
  await until(() => pg.locator('main', { hasText: '[ A2b // GAME DESIGNER ]' }).count().then(n => n > 0), 8000, 'the designer');
  pages.push(await scan('designer'));
  for (const { where, rows } of pages) {
    const small = rows.filter(r => r.h < 36);
    // every one of these is a control an operator taps to set up the match — no decorative buttons
    // live in `main` on these three pages, so an undersized one FAILS rather than printing a finding.
    expect(small.length === 0, `${where}: undersized tap targets ${JSON.stringify(small)}`);
    console.log(`      ${where}: ${rows.length} controls, smallest ${Math.min(...rows.map(r => r.h))}px`);
  }
  ok('tap targets >= 36px on GAMES, KIT and the DESIGNER');
  await closePage(pg);
});

step('audit-text', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await kothCard(pg).click();
  await until(async () => (await pg.locator('text=POWER-CYCLE THE GRENADE').count()) > 0, 8000, 'the SETUP warning');
  // meaning-carrying text only: the nav's 01..05 digits and the mode-card abbreviations are decorative
  const tiny = await pg.evaluate(() => [...document.querySelectorAll('main *')]
    .filter(el => el.children.length === 0 && (el.textContent || '').trim().length > 3)
    .map(el => ({ t: el.textContent.trim().slice(0, 42), px: Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 }))
    .filter(x => x.px < 11));
  const hard = tiny.filter(x => /GRENADE|SETUP|POWER-CYCLE|OBJECTIVE|F8\d|ERROR|▲/.test(x.t));
  expect(hard.length === 0, `text carrying the KotH setup meaning is >= 11px ${JSON.stringify(hard)}`);
  if (tiny.length) console.log(`      ${tiny.length} sub-11px string(s) on GAMES (non-blocking): ${JSON.stringify(tiny.slice(0, 6))}`);
  ok('the KotH setup copy is legible (>= 11px)');
  await closePage(pg);
});

// `?mock` is how the console is iterated on without a server (CLAUDE.md), so the demo has to predict the
// real server — including the F82 re-team. Same served bundle, no MC process involved.
step('mock-demo', async ({ browser, base }) => {
  const pg = await newPage(browser, base);
  await pg.goto(`${base}/?mock#build`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('main', { hasText: '[ A2 // GAMES ]' }).count().then(n => n > 0), 10000, 'the mock GAMES screen');
  await kothCard(pg).click();
  await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 6000, 'KotH playing in the demo');
  expect((await railRow(pg, 'OBJECTIVE').textContent()).trim() === 'GRENADE HILL · ONE POINT', 'the demo shows the same OBJECTIVE row');
  expect(await pg.locator('text=POWER-CYCLE THE GRENADE').first().isVisible(), 'the demo shows the same SETUP step');
  // the demo backend lives in the page, so a reload restarts it — walk to KIT with the CONTINUE button
  await pg.locator('main button:has-text("CONTINUE ▸")').first().click();
  await until(() => pg.locator('span[role="group"][aria-label="team"]').count().then(n => n > 0), 10000, 'the demo KIT team chips');
  const chips = (await pg.locator('span[role="group"][aria-label="team"] button').allTextContents()).map(x => x.trim());
  expect(JSON.stringify(chips) === JSON.stringify(['BLUE', 'GREEN']), `the demo offers BLUE+GREEN only (saw ${JSON.stringify(chips)})`);
  const YELLOW = ['rgb(255, 210, 63)', 'rgb(255, 211, 63)'];
  const stripes = await pg.locator('.kit-row > span:first-child').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
  expect(stripes.length > 0 && !stripes.some(c => YELLOW.includes(c)), `🔴 F82: the DEMO re-teams its yellow half too (saw ${JSON.stringify([...new Set(stripes)])})`);
  ok(`?mock predicts the real server  ${await shot(pg, '15-mock')}`);
  await closePage(pg);
});

// A session persisted long before this change, with a YELLOW roster, booted into the new UI.
step('old-data-boot', async ({ browser, base, swapMC }) => {
  const tmp = path.join(SHOTS, `session-old-${Date.now()}.json`);
  fs.copyFileSync(path.join(HERE, 'fixtures', 'session-prekoth.json'), tmp);
  // only one MC can hold :8765 (the port vite proxies to), so the fresh one steps aside
  await swapMC({ sessionFile: tmp, label: 'old-session' });
  try {
    const pre = await (await fetch(`${base}/api/state`)).json();
    expect(pre.players.length > 0, `the old session actually restored (${pre.players.length} player(s))`);
    expect(pre.players.some(p => p.team_id === 'yellow'), 'the restored roster is on YELLOW (control for F82)');
    const pg = await go(await newPage(browser, base), 'build');
    expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, 'the console opens a pre-koth session without crashing');
    await kothCard(pg).click();
    await until(async () => (await kothCard(pg).getAttribute('aria-pressed')) === 'true', 8000, 'KotH playing on an old session');
    const post = await (await fetch(`${base}/api/state`)).json();
    const tidOf = Object.fromEntries(post.config.teams.map(t => [t.team_id, t.tid]));
    expect(!post.players.some(p => tidOf[p.team_id] === 2), '🔴 F82: a restored YELLOW roster is moved off $TID 2 by the koth pick');
    await go(pg, 'kit');
    const chips = (await pg.locator('span[role="group"][aria-label="team"] button').allTextContents()).map(s => s.trim());
    expect(!chips.some(c => /YELLOW/i.test(c)), `no YELLOW chip on an old-session KIT page (saw ${JSON.stringify(chips)})`);
    const YELLOW = ['rgb(255, 210, 63)', 'rgb(255, 211, 63)'];
    const stripes = await pg.locator('.kit-row > span:first-child').evaluateAll(els => els.map(el => getComputedStyle(el).backgroundColor));
    expect(!stripes.some(c => YELLOW.includes(c)), `no yellow roster stripe on an old session (saw ${JSON.stringify([...new Set(stripes)])})`);
    ok(`pre-koth session boots and is normalised  ${await shot(pg, '14-old-session')}`);
    await closePage(pg);
  } finally { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
});

// ---------------------------------------------------------------- runner
(async () => {
  if (!ONLY) fs.rmSync(SHOTS, { recursive: true, force: true });   // an ONLY= run must not wipe the full run's evidence
  fs.mkdirSync(SHOTS, { recursive: true });
  const chosen = steps.filter(s => !ONLY || s.name === ONLY || s.name.includes(ONLY));
  if (!chosen.length) { console.error(`no step matches ONLY=${ONLY}. Steps: ${steps.map(s => s.name).join(', ')}`); process.exit(2); }
  if (ONLY && chosen.length > 1 && chosen.some(s => s.name === ONLY)) chosen.splice(0, chosen.length, chosen.find(s => s.name === ONLY));
  console.log(`MC KotH — ${chosen.length}/${steps.length} step(s) in a real browser`);
  let mc = await startMC();
  const vite = await startVite();
  const swapMC = async opts => { await mc.stop(); mc = await startMC(opts); };
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  for (const s of chosen) {
    currentStep = s.name;
    console.log(`\n[${s.name}]`);
    const before = failures.length;
    stepFailedAt = before;
    try { await s.fn({ browser, base: vite.base, swapMC }); } catch (e) { failures.push(`${s.name}: THREW ${e.message}`); console.log(`    ✗ THREW ${e.message}`); }
    if (failures.length > before) {
      // forensics: what WAS on the page when it failed
      try {
        const pgs = browser.contexts().flatMap(c => c.pages());
        if (pgs.length) {
          const p = pgs[pgs.length - 1];
          await p.screenshot({ path: path.join(SHOTS, `FAIL-${s.name}.png`) });
          const btns = await p.evaluate(() => [...document.querySelectorAll('main button,main [role="button"]')].slice(0, 30)
            .map(e => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)));
          console.log(`    … controls on screen: ${JSON.stringify(btns)}`);
          console.log(`    … screenshot: ${path.join(SHOTS, `FAIL-${s.name}.png`)}`);
        }
      } catch { /* forensics are best-effort */ }
    }
  }
  await browser.close();
  await vite.stop();
  await mc.stop();
  currentStep = 'js-errors';
  const noisy = jsErrors.filter(e => !/favicon|ERR_CONNECTION|Failed to load resource/i.test(e));
  expect(noisy.length === 0, `no uncaught JS / console errors in the whole run (${noisy.length}): ${JSON.stringify(noisy.slice(0, 6))}`);
  console.log(`\n${'='.repeat(72)}`);
  if (failures.length) {
    console.log(`FAILED — ${failures.length} assertion(s):`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    console.log(`screenshots: ${SHOTS}`);
    process.exit(1);
  }
  console.log(`PASSED — ${chosen.length} step(s), 0 failures.  screenshots: ${SHOTS}`);
  if (!process.env.KEEP_SHOTS) console.log('(KEEP_SHOTS=1 keeps the passing screenshots for the next run too)');
  process.exit(0);   // the verdict is printed; do not hang waiting on a pooled keep-alive socket
})();
