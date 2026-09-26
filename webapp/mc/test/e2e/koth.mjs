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
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=…     # move the ports (defaults: 8765, a free one, a free one)
//
// ⚠ This suite used to hardcode :8765 — the port `vite.config.ts` proxies to — which made it the ONE
// suite a parallel worker could not run without driving someone else's server, and TWO regressions
// hid behind that in a single day (2026-09-12/13: the mode tile becoming a two-tap control, and the
// LOAD reshape). `MC_PORT` now moves the server AND the proxy (`vite.config.ts` reads
// `MC_PROXY_PORT`, which `startVite` below sets), so any lane can run the whole file on its own ports.
//
// Component logic that is NOT about what a person sees stays in test/koth.test.tsx (jsdom, 2s).
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC = path.resolve(HERE, '../..');                 // webapp/mc
const REPO = path.resolve(MC, '../..');
const SHOTS = path.join(HERE, 'shots', 'koth');   // one folder per script: a parallel run must not wipe another script's shots
const ONLY = process.env.ONLY || '';
// Defaults unchanged: :8765 for MC (what `vite.config.ts` proxies to out of the box) and a free port
// for vite and for the node socket. `0` here means "pick a free one", exactly as before.
// Where the server keeps its data. A test run must NEVER write into the operator's real
// `~/.brx-mcp`: hundreds of near-empty session files from suite runs landed there, and after the
// field night Tony had to sift them by size and timestamp to find the four real games. One temp dir
// per run, removed at the end — and nothing under the real home is ever touched.
const MC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-koth-home-'));
const MC_PORT = Number(process.env.MC_PORT || 8765);
const MC_WS_PORT = Number(process.env.MC_WS_PORT || 0);
const VITE_PORT = Number(process.env.VITE_PORT || 0);

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
/** Every child this run started, so a hard exit cannot leave an MC or a vite squatting the ports.
 *
 *  `process.exit(3)` (a missing interpreter, a port already taken, a fixture that would not build)
 *  skips the runner's own cleanup at the bottom of the file — so a single early exit left :8765 and
 *  the dev server alive, and the NEXT run refused to start because "something is already serving"
 *  itself. Killing the group synchronously from an exit handler is the one thing that still works at
 *  that point (an async stop never gets its turn). Observed twice on 2026-09-13. */
const spawned = new Set();
process.on('exit', () => {
  for (const proc of spawned) { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ } }
});

/** `npm run dev` is npm -> sh -> vite: signal the GROUP, or vite survives holding our stdio pipe */
const killGroup = proc => new Promise(done => {
  spawned.delete(proc);
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

/** This worktree may carry no `.venv` of its own (it is gitignored and not duplicated per worktree) —
 *  the shared WSL venv lives on the MAIN checkout. Falling back to it borrows an INTERPRETER BINARY
 *  (read-only exec, never a write); the CODE it runs is still pinned to THIS tree by `cwd` below,
 *  which is the part that matters. Same fallback `game-edit.mjs` already has: without it this suite
 *  exits "NO PYTHON" for every lane working in a worktree, which is half of why nobody ran it. */
function findPython() {
  if (process.env.MC_PY) return process.env.MC_PY;
  const local = path.join(REPO, '.venv', 'bin', 'python');
  if (fs.existsSync(local)) return local;
  const marker = '/.claude/worktrees/';
  if (REPO.includes(marker)) {
    const main = path.join(REPO.slice(0, REPO.indexOf(marker)), '.venv/bin/python');
    if (fs.existsSync(main)) return main;
  }
  console.error(`NO PYTHON — ${local} is missing. Set MC_PY to an interpreter with starlette/uvicorn/websockets.`);
  process.exit(3);
}

async function startMC({ sessionFile = null, label = 'fresh' } = {}) {
  const py = findPython();
  const port = MC_PORT;                   // …and vite is pointed at it (startVite sets MC_PROXY_PORT)
  // If something already answers there we would silently drive THAT server and report on it —
  // which is how a run "passes" against a process it never started. Refuse instead.
  try {
    const squatter = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1500) });
    if (squatter.ok) {
      console.error(`SOMETHING IS ALREADY SERVING :${port} — that is the port this run's vite proxies to.`);
      console.error('Stop your own `python -m brx_mcp.mc` (or a leftover run), or set MC_PORT= to somewhere free.');
      process.exit(3);
    }
  } catch { /* nothing there: good */ }
  const wsPort = MC_WS_PORT || await freePort();
  const args = ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(port), '--ws-port', String(wsPort), '--demo', '--no-auth'];
  if (sessionFile) args.push('--session-file', sessionFile); else args.push('--ephemeral');
  const proc = spawn(py, args, { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { ...process.env, BRX_MCP_HOME: MC_HOME } });
  spawned.add(proc);
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
    console.error(`If something else is already on :${port} that is probably your own MC — stop it, set MC_PORT=, or run this against it by hand.`);
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
  const port = VITE_PORT || await freePort();
  // `MC_PROXY_PORT` is what makes this suite movable: `vite.config.ts` proxies /api and /ui-ws to it
  // (default :8765), so the dev server this starts talks to the MC THIS run started and to no other.
  const proc = spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'],
    { cwd: MC, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, MC_PROXY_PORT: String(MC_PORT) } });
  spawned.add(proc);
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
/** F411: the mode picker on PLAY (`Games.tsx`'s `picker-mode` Seg) is one tap, immediate — the old
 *  card-shelf UI's two-tap "this reshapes N players, confirm?" gate (T2-A) is retired along with it:
 *  `POST /api/play/pick` just applies. No confirm to wait for or assert; the F82 re-team it used to
 *  guard is still proven directly against the server (`teams-never-yellow`, `reteam-visible`). */
const modeBtn = (pg, label) => pg.locator('[data-testid="picker-mode"]').getByRole('button', { name: label });
const kothBtn = pg => modeBtn(pg, 'KING OF THE HILL');
async function pickMode(pg, label, { ms = 8000 } = {}) {
  const btn = modeBtn(pg, label);
  if ((await btn.getAttribute('aria-pressed')) === 'true') return;   // already the picked mode: a re-tap is a no-op
  await btn.click();
  await until(async () => (await btn.getAttribute('aria-pressed')) === 'true', ms, `${label} picked`);
}
const pickKoth = (pg, opts = {}) => pickMode(pg, 'KING OF THE HILL', opts);
const pickTdm = (pg, opts = {}) => pickMode(pg, 'TEAM DEATHMATCH', opts);
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
  // F411: through `POST /api/play/pick`, not a raw `PUT /api/config` — PLAY's picker shows whichever
  // piece `game_pick.pieces.mode` names as selected (Games.tsx's `Seg`), so a raw config PUT here used
  // to leave the KING OF THE HILL button reading "already picked" from an EARLIER step's pick while the
  // server's own config sat on tdm underneath it: `pickKoth`'s "already pressed, nothing to do" guard
  // then no-opped for real, and every assertion downstream (F82 re-team, the koth SETUP step, …) failed
  // against a config that had silently stayed on tdm. Picking through the same route the console uses
  // keeps `game_pick` and `config` the same fact.
  const r = await fetch(`${base}/api/play/pick`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pieces: { mode: 'builtin:mode:tdm' } }) });
  if (!r.ok) throw new Error(`resetTdm: POST /api/play/pick ${r.status} ${(await r.text()).slice(0, 160)} (phase was ${phase0})`);
  await rebalance(base);
}

/** Deal the roster round-robin across whatever teams the config declares NOW.
 *
 *  A roster with every player on one side cannot register a hit, and the server refuses to push or
 *  start it (`one_team_fault`, which `force` does NOT open), so a step that wants a pushed/armed match
 *  hands itself a playable roster first. Round-3 FIELD-1 (2026-09-13) removed the thing that used to
 *  CREATE that roster — `set_config` re-teamed anyone whose team the new config lacked onto `teams[0]`,
 *  so a tdm blue/yellow -> koth blue/green pick silently emptied GREEN; it now maps by team INDEX and
 *  rebalances only if one side would be left empty. This helper is therefore a precondition against
 *  what a STEP may have done to the roster, not against what a mode pick does. `reteam-visible` still
 *  does not call it: what that step watches is exactly the mode pick's own re-teaming.
 */
// Tony 2026-09-24: KOTH's stock hill is a Bluetooth station (`station_source: "phone"`); the grenade is
// POST-MVP but still selectable, so the grenade-specific steps pick it by hand.
const PHONE_STEP = 'BLUETOOTH STATION';
async function setSource(base, station_source) {
  const r = await fetch(`${base}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ station_source }) });
  if (!r.ok) throw new Error(`setSource(${station_source}): PUT /api/config ${r.status}`);
}

async function rebalance(base) {
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
  // Round-3 FIELD-1 (2026-09-13): the SERVER now re-teams by index and rebalances on a mode pick, so
  // a pick can no longer empty a side and this is belt-and-braces rather than the precondition it was
  // (round-2 B). Kept because a step may have dragged the roster onto one side itself, and because a
  // one-side roster is a refusal `force` does not open — it would fail the push below, not this line.
  await rebalance(base);
  const push = await fetch(`${base}/api/lobby/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"force":true}' });
  if (!push.ok) throw new Error(`armMatch: POST /api/lobby/push ${push.status} ${await push.text()}`);
  const start = await fetch(`${base}/api/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"force":true}' });
  if (!start.ok) throw new Error(`armMatch: POST /api/start ${start.status} ${await start.text()}`);
  return start.json();
}

/** F402 (2026-09-25): a koth LOAD/push is now refused with nothing on the field that IS the hill
 *  (`Session._refuse_koth_hill`, `force` does not open it) -- so any step that pushes or arms a koth
 *  game needs one ASSIGNED first, the proper way: a real utility node saying hello on the node socket
 *  (`net.py`), then PUT /api/stations, the same REST call ITEMS makes. This suite drives MC WITHOUT
 *  `--fake-net`, so there is no simulated phone already sitting on that socket to reuse -- a plain
 *  `hello` on `lan.ws_url` is the smallest thing that makes one, and the assignment survives the
 *  socket going quiet afterwards (`_station_view`'s own docstring: a station's record outlives its
 *  phone dropping off, so it can be re-armed the moment it returns), so the caller need not keep this
 *  connection open once ITEMS has taken the assignment. */
async function assignHillStation(base, node_id) {
  const { lan } = await (await fetch(`${base}/api/state`)).json();
  const ws = new WebSocket(lan.ws_url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(JSON.stringify({ v: 1, kind: 'hello', id: `${node_id}-hello`, t: Date.now(),
    body: { node_id, node_type: 'utility', app_ver: 'e2e-test', seq_next: 1 } }));
  await new Promise(r => setTimeout(r, 150));   // let MC register the hello before ITEMS assigns it
  const put = await fetch(`${base}/api/stations/${node_id}`, { method: 'PUT',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'control' }) });
  if (!put.ok) throw new Error(`assignHillStation(${node_id}): PUT /api/stations/${node_id} ${put.status} ${await put.text()}`);
  return ws;
}

/** A koth RecapView built by MC'S OWN Scorer — see `recap_fixture.py` for why it is not a JSON
 *  literal in this file. Nothing on `app/src` sends a `possession` fact yet, so a browser run cannot
 *  reach a recap that has one by playing; this is the honest substitute. */
function recapFixture(args = []) {
  // `findPython()`, not the raw `.venv` path: a worktree has no venv of its own, and this used to
  // fail with `status null` and an EMPTY stderr — "recap_fixture.py failed (null): undefined" — which
  // reads as a broken fixture rather than as a missing interpreter. Same temp `BRX_MCP_HOME` as the
  // server, so nothing a test runs can write into the operator's real data directory.
  const py = findPython();
  const r = spawnSync(py, [path.join(HERE, 'recap_fixture.py'), ...args],
    { cwd: path.join(REPO, 'mcp'), encoding: 'utf8', env: { ...process.env, BRX_MCP_HOME: MC_HOME } });
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

// F411: matches on the PICK GAME heading and the PLAY nav tab, not the kicker text — another lane is
// changing PLAY's kicker from `[ A2 // PLAY ]` to `[ 02 // PLAY ]` (kit-continue.mjs does the same).
step('boot', async ({ browser, base }) => {
  const pg = await go(await newPage(browser, base), 'build');
  expect(await pg.locator('text=Pick Game').count() > 0, 'the header title reads PICK GAME');
  expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, 'no error-boundary crash on first paint');
  expect(await pg.locator('nav button:has-text("PLAY")').count() > 0, 'the PLAY nav tab is present');
  ok(`PLAY renders  ${await shot(pg, '01-play')}`);
  await closePage(pg);
});

step('koth-selectable', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  const btn = kothBtn(pg);
  expect(await btn.count() === 1, 'a KING OF THE HILL option exists in the GAME MODE picker');
  expect((await btn.getAttribute('aria-pressed')) === 'false', 'KotH is not already picked');
  // 🔴 the SEEDED-ROSTER step: `resetTdm` deals 8 demo players across blue/yellow, so this pick really
  // does move the roster off yellow — proven on the server below, and directly in `teams-never-yellow`
  // / `reteam-visible`. F411 dropped the old two-tap "this reshapes N players, confirm?" dialog: PLAY's
  // `POST /api/play/pick` just applies on one tap.
  await pickKoth(pg, { ms: 6000 });
  expect((await btn.getAttribute('aria-pressed')) === 'true', 'KotH reports itself picked');
  await until(async () => (await (await fetch(`${base}/api/state`)).json()).config.mode === 'koth', 6000, 'the server to hold the koth pick');
  ok(`KotH is selectable and becomes the picked mode  ${await shot(pg, '02-koth-playing')}`);
  await closePage(pg);
});

// The retired GAMES rail's OBJECTIVE row is gone (games-presets.md §5); the operator's field-step
// readout is now the operator note under the mode picker. Same property this step always protected:
// a station-gated mode gets an on-screen readout, a mode with nothing to place gets none.
step('objective-row', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await pickKoth(pg, { ms: 6000 });
  const note = pg.getByTestId('operator-note');
  expect(await note.count() > 0, 'the operator note shows for a station-gated mode');
  const v = (await note.textContent()).trim();
  expect(/PLACE THE HILL BEFORE START/.test(v), `the note names the field step (saw ${JSON.stringify(v)})`);
  expect(await note.isVisible(), 'the note is visible, not merely in the DOM');
  // and it must be ABSENT for a mode with nothing to place (FFA carries no note, games-redesign.md §9)
  await pickMode(pg, 'FREE-FOR-ALL', { ms: 6000 });
  await until(() => pg.getByTestId('operator-note').count().then(n => n === 0), 6000, 'the operator note to disappear for FFA');
  ok(`operator note names the field step on koth, absent on ffa  ${await shot(pg, '03-objective-row')}`);
  await closePage(pg);
});

step('setup-warning', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  // it must NOT be on screen before a hill mode is picked
  expect(await pg.locator('text=POWER-CYCLE THE GRENADE').count() === 0, 'no grenade setup step is shown for the default mode');
  await pickKoth(pg);
  await setSource(base, 'grenade');           // post-MVP, picked by hand: its field step is still the operator's
  await until(async () => (await pg.locator('text=POWER-CYCLE THE GRENADE').count()) > 0, 8000, 'the SETUP warning to arrive with the snapshot');
  const warn = pg.locator('main div[role="status"] div', { hasText: 'POWER-CYCLE THE GRENADE' }).first();
  expect(await warn.isVisible(), 'the SETUP warning is visible on screen');
  const txt = (await warn.textContent()).toUpperCase();
  for (const frag of ['POWER-CYCLE THE GRENADE', 'STARTS NEUTRAL', 'HILL MODE', 'PLACE IT']) {
    expect(txt.includes(frag), `the SETUP warning says ${JSON.stringify(frag)}`);
  }
  expect(txt.includes('ONE POINT ONLY'), 'the SETUP warning carries F88 one-point-only');
  // it is an operator-visible warning, not a swallowed technical advisory: the $SIR/frag-limit
  // warnings the server also sends must NOT be on PLAY (mc/API.md)
  const screenText = await pg.locator('main').textContent();
  expect(!/MULTIPLIER ROW|htk\/ttk_ms/i.test(screenText), 'technical $SIR advisories stay off PLAY');
  const box = await warn.boundingBox();
  expect(box && box.height >= 14, 'the warning has real height on screen');
  ok(`SETUP warning renders on PLAY  ${await shot(pg, '04-setup-warning')}`);
  await closePage(pg);
});

// The step is only useful where it is ACTIONABLE. The operator reads "place the grenade" on PLAY,
// then walks out to place it from LOBBY (and during the runway, from ARMED) — and until 10437d6 it was
// gone from both. `SetupSteps` is deliberately narrowed to /^SETUP:/, so this also asserts the
// NEGATIVE: the $SIR multiplier rows and other technical advisories must NOT be on
// the last screen before the horn, or the operator learns to ignore the strip that matters.
step('setup-steps-prematch', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await pickKoth(pg, { ms: 6000 });
  // CONTROL: the server really is sending advisories alongside the SETUP step, or "they are not on
  // screen" would pass on an empty list. A stale frag limit on an objective game is deliberately
  // ignored by the scorer and must not invent a coverage warning either.
  const put = await fetch(`${base}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scoring: { frag_limit: 10, win_by: 'objective' } }) });
  expect(put.ok, `PUT a frag_limit onto the koth config (${put.status})`);
  const warns = (await (await fetch(`${base}/api/state`)).json()).config_warnings ?? [];
  const setup = warns.filter(w => /^SETUP:/i.test(w));
  const advisories = warns.filter(w => !/^SETUP:/i.test(w));
  expect(setup.length >= 1, `the server sends a SETUP step (saw ${JSON.stringify(warns.slice(0, 2))})`);
  expect(advisories.some(w => /\$SIR/.test(w)), 'CONTROL: the server also sends $SIR advisories');
  expect(!advisories.some(w => /frag_limit/i.test(w)), 'an ignored objective cap sends no frag-limit advisory');

  await assignHillStation(base, 'e2e-hill-prematch');   // F402: armMatch's push refuses koth without one
  await armMatch(base);                       // ARMED renders nothing without a schedule
  for (const view of ['lobby', 'armed']) {
    await go(pg, view);
    const steps_ = pg.getByTestId('setup-steps');
    await until(() => steps_.count().then(n => n > 0), 8000, `the SETUP steps on ${view}`);
    expect(await steps_.isVisible(), `the SETUP step is VISIBLE on ${view.toUpperCase()}, where it is actionable`);
    const txt = (await steps_.textContent()).toUpperCase();
    expect(txt.includes('CONTROL POINT IS A BLUETOOTH STATION'), `${view}: the step names the station hill`);
    expect(txt.includes('MC-ARMED'), `${view}: the step says to check it is MC-armed`);
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
  // F411: PLAY has no draft/discard concept — every pick composes and applies immediately
  // (games-presets.md §3), so the old "this discards your tuned, unsaved draft" two-tap confirm this
  // block used to walk is retired along with the card-shelf UI it belonged to. Switching mode here is
  // now a plain one-tap pick, same as every other step in this file.
  await pickTdm(pg, { ms: 8000 });
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
  await pickKoth(pg, { ms: 6000, what: 'KotH playing' });

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

// The hill's team split used to be silent AND destructive: everyone on yellow landed on teams[0], so
// the operator walked onto the field with 8 v 0 and no idea the server had moved anyone. Round-3
// FIELD-1 (2026-09-13) re-teams by INDEX and rebalances, so the split SURVIVES the pick — and this
// step now watches for that, plus the console's readout of whatever split results.
step('reteam-visible', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await pickKoth(pg, { ms: 6000, what: 'KotH playing' });
  await go(pg, 'lobby');
  const st = await (await fetch(`${base}/api/state`)).json();
  const counts = {};
  for (const p of st.players) counts[p.team_id] = (counts[p.team_id] ?? 0) + 1;
  const empty = st.config.teams.filter(t => !counts[t.team_id]);
  // Switching to koth moves everyone who was on YELLOW onto GREEN — the same INDEX, not `teams[0]`
  // (state.py `_reteam_for_config`). F82 is still satisfied (nobody on $TID 2) and the operator's own
  // split is intact, so the match the roster describes is the match they set up.
  expect(empty.length === 0,
    `the koth pick keeps both sides populated (counts ${JSON.stringify(counts)})`);
  expect(!st.players.some(p => p.team_id === 'yellow'), '🔴 F82: nobody is left on YELLOW ($TID 2)');
  const cols = await pg.locator('main span:text-is("GREEN TEAM")').count();
  expect(cols > 0, 'the LOBBY renders the GREEN column the re-team filled');
  // ...and because nothing is stranded, the one-side fault banner must NOT be on screen.
  const fault = await pg.locator('[data-testid="roster-fault"]').count();
  expect(fault === 0, 'a rebalanced roster is not a fault — the banner must stay off');
  ok(`the mode pick re-teams by index and both sides are live  ${await shot(pg, '06-reteam')}`);
  await closePage(pg);
});

// `station-source-control` (the DESIGNER's OBJECTIVE SOURCE chip: grenade/ir_station/phone) is
// DELETED here: that control lived in the retired GAME DESIGNER, and its F411 replacement is BUILD's
// per-mode editor, which is a stub on this branch (`data-testid="build-screen"`, no controls at all —
// the BUILD lane is finishing the real editor per its own brief). There is nothing in this worktree's
// console to click through for OBJECTIVE SOURCE, so this coverage is deferred to the BUILD lane;
// `station_source` itself is still exercised directly against the server (`setSource`, `vqa2.mjs`).

// A refusal is only useful if the operator can READ it. The server's 400 names the whole vocabulary;
// the strip that shows it used to be one nowrap line clipped at 420px, so the valid values were gone.
// F411: the client that can 400 this way is `POST /api/play/pick` (PLAY's mode picker), not
// `PUT /api/config` — the route intercepted below follows the wire the console actually calls.
step('station-source-refused', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  const VOCAB = "mode must be one of the pickable pieces: builtin:mode:tdm (TEAM DEATHMATCH), builtin:mode:ffa (FREE-FOR-ALL), builtin:mode:koth (KING OF THE HILL) — infection, lms and extraction are post_mvp and cannot be picked yet";
  await pg.route('**/api/play/pick', r => r.request().method() === 'POST'
    ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: VOCAB }) })
    : r.continue());
  await kothBtn(pg).click();   // one tap: PLAY applies immediately, so this alone fires the refused POST
  const strip = errorStrip(pg);
  await until(() => strip.count().then(n => n > 0), 8000, 'the refusal to reach the error strip');
  expect(await strip.isVisible(), 'the refusal is VISIBLE, not swallowed');
  const txt = await strip.textContent();
  expect(txt.includes('ffa') && txt.includes('extraction'), `the strip carries the whole vocabulary (saw ${JSON.stringify(txt.slice(0, 120))}…)`);
  // clipped text is not a message: the rendered box must actually fit what it holds
  const fit = await strip.evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, title: el.getAttribute('title') }));
  expect(fit.sw <= fit.cw + 1 && fit.sh <= fit.ch + 1,
    `the refusal is not clipped (scroll ${fit.sw}x${fit.sh} vs client ${fit.cw}x${fit.ch}) — an ellipsised vocabulary names nothing`);
  expect((fit.title || '').includes('extraction'), 'the strip also carries the full text as its title attribute');
  // a refused pick must not leave the button claiming it is picked
  expect((await kothBtn(pg).getAttribute('aria-pressed')) === 'false', 'a refused mode pick does not show as picked');
  ok(`a refused pick is readable on screen  ${await shot(pg, '08-refusal')}`);
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
  expect(/F88/.test(shown), 'the F88 refusal is rendered on PLAY, not swallowed');
  expect(/NOT BUILDABLE/i.test(shown), 'the refusal keeps its reason (not buildable)');
  expect(/ONE POINT/i.test(shown), 'the refusal keeps its remedy (run ONE point)');
  const fs_ = await pg.locator('main div', { hasText: 'F88' }).last().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
  expect(fs_ >= 11, `the refusal is legible (${fs_}px, must be >= 11px)`);
  void el;
  ok(`an F88 config error is visible on screen  ${await shot(pg, '09-f88')}`);
  await closePage(pg);
});

// `designer-play-loads` (the GAME DESIGNER's "PLAY THIS NOW", which applied a draft and jumped
// straight to KIT) is DELETED: games-presets.md §1's rule is "BUILD never starts a game", so that
// transition has no home any more. PLAY's own LOAD ▸ is the one load path left, and `load-path` below
// covers it end to end. `designer-play-stale-server` (LOAD refused by a stale server) is rewritten
// below as `load-refused`, against PLAY's own LOAD ▸ instead of the retired DESIGNER's PLAY THIS NOW.
step('load-refused', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await pg.route('**/api/games/load', r => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'THIS MC SERVER CANNOT LOAD A GAME — RESTART IT' }) }));
  await pg.locator('[data-testid="game-load"] button').click();
  const strip = errorStrip(pg);
  await until(() => strip.count().then(n => n > 0), 8000, 'the LOAD refusal to reach the error strip');
  expect((await strip.textContent()).includes('RESTART IT'), 'the refusal names the remedy');
  const st = await (await fetch(`${base}/api/state`)).json();
  expect(st.game?.loaded === false, 'a failed LOAD never claims the game is loaded');
  expect(new URL(pg.url()).hash === '#build', `the operator stays on PLAY (saw ${JSON.stringify(new URL(pg.url()).hash)})`);
  ok(`a refused LOAD is readable and does not navigate  ${await shot(pg, '09c-load-refused')}`);
  await closePage(pg);
});

// The operator's own walk: pick, LOAD (which announces the game to the PHONES and writes no gun), an
// edit that re-announces at once (PLAY has no draft/SAVE step — every pick applies immediately,
// games-presets.md §3, unlike the retired GAMES tab's own inline editor), the LOBBY push that actually
// configures the guns, and only then KIT.
//
// "Weapons have to go with the arm" (Tony). The first cut of LOAD called the real config push, which
// compiles a weapon head per player -- and nobody has kitted at that point, so it wrote policy-DEFAULT
// loadouts to every gun and then re-pushed on every kit pick. The assertions below pin both halves:
// that LOAD reaches the phones, and that it reaches nothing else.
step('load-path', async ({ browser, base }) => {
  // Every step shares ONE server, and a step that pushed (`setup-steps-prematch` arms a match) leaves
  // the session LOADED — which is the other state of this tab. The un-loaded half of this walk needs a
  // session nothing has been loaded into, and NEW SESSION keeping the roster is the operator's own way
  // to get one (`state.py new_session`: phase muster, `lobby_pushed` false, acks dropped, roster kept).
  const fresh = await fetch(`${base}/api/session/new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"keep_roster":true}' });
  if (!fresh.ok) throw new Error(`load-path: POST /api/session/new ${fresh.status} ${(await fresh.text()).slice(0, 160)}`);
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await pickKoth(pg, { ms: 6000 });
  await assignHillStation(base, 'e2e-hill-load');   // F402: the LOBBY push below refuses koth without one
  const before = await (await fetch(`${base}/api/state`)).json();
  expect(before.lobby.pushed === false, `CONTROL: nothing is loaded yet (saw pushed=${before.lobby.pushed})`);

  // --- LOAD: it announces to the phones, and it does not navigate away -------------------------
  const load = pg.locator('[data-testid="game-load"] button');
  expect(await load.count() === 1, 'the LOAD control is on PLAY');
  expect((await load.innerText()).includes('LOAD'), `it says LOAD (saw ${JSON.stringify(await load.innerText())})`);
  await load.click();
  await until(async () => (await (await fetch(`${base}/api/state`)).json()).game?.loaded === true, 10000, 'the server to report the game loaded');
  const loaded = await (await fetch(`${base}/api/state`)).json();
  // 🔴 THE REVISION, asserted on the server's own state: the phones were told, the guns were not.
  expect(loaded.lobby.pushed === false, `LOAD must NOT push config to the guns (saw pushed=${loaded.lobby.pushed})`);
  expect((loaded.sync?.totals?.gun_sent ?? 0) === 0, `no gun has been sent a head (saw ${loaded.sync?.totals?.gun_sent})`);
  // DELIVERY, and delivery is allowed to be zero. This suite drives MC WITHOUT `--fake-net`, so no
  // phone is bound at all and the honest answer is 0 of 8 — asserting "> 0" here would have demanded
  // the count lie about a field that is not there. What must hold is that it counts the phones that
  // ARE connected, against the whole roster.
  const boundNow = (loaded.players || []).filter(p => p.node_id).length;
  expect((loaded.game?.sent ?? -1) === boundNow,
    `the phone count is the phones actually connected (saw ${loaded.game?.sent}, bound ${boundNow})`);
  expect((loaded.game?.total ?? -1) === loaded.players.length,
    `…stated against the whole roster (saw ${loaded.game?.total}/${loaded.players.length})`);
  // ...and the TAB stays: LOAD's own success does not navigate the console anywhere.
  expect(new URL(pg.url()).hash === '#build', `LOAD left the console on PLAY (saw ${JSON.stringify(new URL(pg.url()).hash)})`);
  expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, 'LOAD renders without a console error');
  ok(`LOAD told the phones and left the guns alone  ${await shot(pg, '10-loaded')}`);

  // --- EDIT: PLAY has no draft — a pick re-announces to the phones immediately ------------------
  const nightBtn = pg.locator('[data-testid="match-settings"]').getByRole('button', { name: 'NIGHT' });
  await nightBtn.click();
  await until(async () => (await (await fetch(`${base}/api/state`)).json()).config.night === true, 8000, 'the server to take the NIGHT pick');
  const afterEdit = await (await fetch(`${base}/api/state`)).json();
  expect(afterEdit.config.config_id !== loaded.config.config_id, 'a fresh config_id');
  expect(afterEdit.game?.config_id === afterEdit.config.config_id, 'the phones were re-told about the edited game');
  expect(afterEdit.lobby.pushed === false, 'and the edit still writes no gun before the lobby push');
  ok(`match settings edit re-announced, guns still untouched  ${await shot(pg, '10b-saved')}`);

  // --- the LOBBY push is what configures a gun, and only then is the field in sync ---------------
  await pg.locator('header nav button:has-text("LOBBY")').first().click();
  await until(() => pg.locator('main', { hasText: '[ A5 // LOBBY' }).count().then(n => n > 0), 8000, 'the LOBBY');
  const pushBtn = pg.locator('main [data-lobby-primary="push"] button');
  if (await pushBtn.isEnabled().catch(() => false)) await pushBtn.click();
  else await pg.locator('main [data-override="1"] button').first().click();
  await until(async () => (await (await fetch(`${base}/api/state`)).json()).lobby.pushed === true, 10000, 'the LOBBY push to configure the guns');
  const pushed = await (await fetch(`${base}/api/state`)).json();
  expect((pushed.sync?.totals?.gun_sent ?? 0) > 0, `the guns have a head NOW (saw ${pushed.sync?.totals?.gun_sent})`);
  // F411: the push itself moves the phase straight to lobby — there is no separate build-to-kit phase
  // step any more (that was the retired GAMES tab's own CONTINUE TO KIT button; PLAY has no equivalent,
  // and KIT is reachable from the nav at any point regardless of phase, proven next).
  expect(pushed.phase === 'lobby', `the push advances the phase to lobby (saw ${pushed.phase})`);
  ok(`the LOBBY push is what wrote the guns and advanced the phase  ${await shot(pg, '10c-pushed')}`);

  // --- and KIT, reachable from the nav like every other tab --------------------------------------
  await pg.locator('header nav button:has-text("KIT")').first().click();
  await until(() => pg.locator('main', { hasText: '[ A3 // KIT-OUT ]' }).count().then(n => n > 0), 8000, 'KIT to open from the nav');
  expect(await pg.locator('main', { hasText: 'Kit Each Player' }).count() > 0, 'the KIT screen title is on screen');
  expect(new URL(pg.url()).hash === '#kit', `the KIT tab moved the URL to #kit (saw ${JSON.stringify(new URL(pg.url()).hash)})`);
  expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, 'KIT does not crash for a koth game');
  ok(`PLAY → LOAD ▸ → NIGHT (re-announced) → LOBBY push (guns configured) → KIT  ${await shot(pg, '10-continue-kit')}`);
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
  await pickKoth(pg);
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
  const bars = await poss.locator('[data-poss-bar]').evaluateAll(els => els.map(el => ({
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
    await pickKoth(pg);
    await go(pg, 'recap');
    const line = pg.getByTestId('possession').locator('div', { hasText: 'BEST COVERAGE' }).last();
    await until(() => line.count().then(n => n > 0), 10000, `the coverage line (${coverage})`);
    return { pg, line };
  };
  const thin = await open('thin');            // 441 of 600 s = 73.5%
  const tTxt = await thin.line.textContent();
  expect(/BEST COVERAGE 7:21 OF 10:00/.test(tTxt), `the coverage line reads "BEST COVERAGE 7:21 OF 10:00" (saw ${JSON.stringify(tTxt.trim().slice(0, 140))})`);
  expect(/THIS IS A FLOOR, NOT A FULL ACCOUNT/i.test(tTxt), 'it says the number is a FLOOR');
  // F221 (approved audit): a coverage caveat is about the MEASUREMENT, not a fault in the match, so
  // it is NEUTRAL whatever the number says: no ▲, no colour change under 75%.
  expect(!/^▲/.test(tTxt.trim()), 'a thin coverage run is NEUTRAL, not flagged with ▲');
  const tStyle = await thin.line.evaluate(e => ({ c: getComputedStyle(e).color, px: parseFloat(getComputedStyle(e).fontSize) }));
  expect(tStyle.px >= 10, `the coverage line is legible (${tStyle.px}px)`);
  await shot(thin.pg, '18-coverage-thin');
  await closePage(thin.pg);

  const full = await open('full');            // 560 of 600 s = 93%
  const fTxt = await full.line.textContent();
  expect(/BEST COVERAGE 9:20 OF 10:00/.test(fTxt), `a well-watched match reads 9:20 OF 10:00 (saw ${JSON.stringify(fTxt.trim().slice(0, 140))})`);
  expect(!/^▲/.test(fTxt.trim()), 'CONTROL: a well-covered run is not flagged either');
  const fStyle = await full.line.evaluate(e => getComputedStyle(e).color);
  expect(fStyle === tStyle.c, `the coverage caveat is NEUTRAL regardless of coverage: same colour thin vs full (${tStyle.c} vs ${fStyle})`);
  ok(`the coverage floor is stated as a neutral measurement caveat, never flagged  ${await shot(full.pg, '18-coverage-full')}`);
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
  await pickKoth(pg);
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
  await pickKoth(pg2);
  await go(pg2, 'recap');
  await until(() => pg2.getByTestId('possession').count().then(n => n > 0), 10000, 'the settled recap to render');
  expect(await pg2.getByTestId('settling').count() === 0, 'a settled recap renders NO settling banner');
  expect(!/STILL SETTLING/.test(await pg2.locator('main').textContent()), 'and no STILL SETTLING text anywhere on it');
  ok(`STILL SETTLING on a moving recap, nothing on a settled one  ${await shot(pg2, '19-settled')}`);
  await closePage(pg2);
});

// `mode-card-host-call` is DELETED: it proved the retired mode CARD's WIN row against `win_text` ("the
// winner is a HOST CALL until a phone sends a possession fact"). PLAY has no WIN row or any other
// on-screen readout of `win_text` (games-presets.md §5 lists PLAY's whole surface: pickers, PICKUPS,
// MATCH SETTINGS, LAST MATCH, LOAD — nothing about the win condition). The server fact itself
// (`/api/modes`'s `win_text`) is unrelated to this file's job and is not this suite's concern; there is
// nothing left in the browser to click through for it.

// F272: a gun whose MCU has stopped can keep the BLE radio and the phone heartbeat alive. The phone's
// durable `gun_locked` verdict therefore has to reach the LIVE board, but only while that node itself is
// current. A last-known snapshot must not keep shouting POWER-CYCLE after the phone has gone offline, and
// an older node that omits the optional field must remain an ordinary row. Patch BOTH snapshot transports:
// a REST-only fixture is overwritten by the first WebSocket push and proves nothing.
step('f272-gun-lock-board', async ({ browser, base }) => {
  await resetTdm(base);
  for (const [name, viewport] of [['desk', { width: 1280, height: 800 }], ['phone', { width: 393, height: 830 }]]) {
    const pg = await newPage(browser, base, viewport);
    const seen = await patchSnapshots(pg, st => {
      const players = (st.players || []).slice(0, 3);
      while (players.length < 3) players.push({ player_id: `f272-${players.length}`, display: `PLAYER ${players.length + 1}`, team_id: players.length % 2 ? 'yellow' : 'blue' });
      const row = (p, i) => ({ player_id: p.player_id, display: p.display, team_id: p.team_id,
        kills: 0, deaths: 0, assists: 0, shots: 0, hits: 0, accuracy: 0, kd: 0, streak: 0, medals: [],
        status: i === 1 ? 'stale' : 'alive', sync_age_ms: i === 1 ? 18_000 : 900, respawn_in_s: null,
        ...(i < 2 ? { gun_locked: true } : {}) });
      const rows = players.map(row), now = Number(st.t) || Date.now();
      st.phase = 'live';
      st.live = { match_id: 'f272-browser', go_live_t: now - 60_000, time_limit_s: 600,
        ends_t: now + 540_000, score: { blue: 0, yellow: 0 }, rows };
    });
    await go(pg, 'live');
    await until(() => pg.locator('[data-gun-locked]').count().then(n => n === 1), 8000, 'one current gun-lock warning');
    const warning = pg.locator('[data-gun-locked]').first();
    const copy = (await warning.textContent()).replace(/\s+/g, ' ').trim();
    expect(/GUN STOPPED/i.test(copy) && /POWER-CYCLE/i.test(copy), `the current row names the failure and cure (saw ${JSON.stringify(copy)})`);
    expect(await warning.getAttribute('role') === 'alert', 'the current lock warning is exposed as an urgent alert');
    expect(await warning.evaluate(el => el.closest('button, [role="button"]') === null), 'the urgent alert is not flattened inside button semantics');
    const ids = await pg.locator('[data-gun-locked]').evaluateAll(els => els.map(e => e.getAttribute('data-gun-locked')));
    const firstId = await pg.locator('[data-live-row]').nth(0).getAttribute('data-live-row');
    expect(ids[0] === firstId, `the warning belongs to the current row (saw warning ${JSON.stringify(ids[0])}, row ${JSON.stringify(firstId)})`);
    expect(await pg.getByRole('button', { name: `${(await pg.locator('[data-live-row]').nth(0).locator('[data-live-row-toggle]').textContent()).replace(/^▸/, '').trim()} operator actions` }).count() === 1,
      'the row action keeps an accessible name beside the separate alert');
    const stale = pg.locator('[data-live-row]').nth(1);
    expect(/LAST KNOWN/.test(await stale.textContent()), 'the stale control row says LAST KNOWN');
    expect(await stale.locator('[data-gun-locked]').count() === 0, 'a stale/offline row suppresses its last gun-lock verdict');
    const old = pg.locator('[data-live-row]').nth(2);
    expect(await old.locator('[data-gun-locked]').count() === 0, 'a node with the optional field missing gets no invented warning');
    expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, 'missing gun_locked does not crash the LIVE board');
    await warning.scrollIntoViewIfNeeded();
    const fit = await warning.evaluate(e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, doc: document.documentElement.scrollWidth }; });
    expect(fit.left >= -1 && fit.right <= fit.width + 1 && fit.top >= -1 && fit.bottom <= fit.height + 1 && fit.doc <= fit.width + 1,
      `${name}: the warning and LIVE board fit the ${fit.width}x${fit.height} viewport (${JSON.stringify(fit)})`);
    // This console normally receives its first state over the socket, so REST may legitimately stay at zero.
    // The route is still installed for a fallback fetch; the non-zero WS count proves the rendered state was
    // actually patched rather than merely leaving an unused interceptor behind.
    expect(seen.ws > 0, `${name}: a WebSocket snapshot was actually patched (${JSON.stringify(seen)})`);
    const evidence = path.join(SHOTS, `f272-gun-lock-${name}.png`);
    await pg.screenshot({ path: evidence, fullPage: false });
    ok(`${name}: current lock warns; stale and old-node rows stay quiet  ${evidence}`);
    await closePage(pg);
  }
});

// A stale server: the new fields are gone from REST *and* from the pushed snapshots, the A10 routes
// 404, and (F411) `game_pick` is stripped too with `/api/pieces` 404'd — the shape of a server old
// enough to predate PLAY/BUILD entirely. Every page must still render and BOTH staleness banners must
// be explained on screen.
step('stale-server', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await newPage(browser, base);
  const strip = o => {
    if (o && typeof o === 'object') {
      delete o.station_source;
      delete o.gun_locked;                 // F272: an older node/server omits the optional verdict
      delete o.game_pick;                  // F411: a pre-PLAY/BUILD server never sent a pick at all
      if (Array.isArray(o.config_warnings)) o.config_warnings = o.config_warnings.filter(w => !/^SETUP:/i.test(String(w)));
      for (const k of Object.keys(o)) strip(o[k]);
    }
    return o;
  };
  let stripped = 0, wsStripped = 0;
  await pg.route('**/api/**', async r => {
    const u = r.request().url();
    if (/\/api\/(perks|presets|pieces)/.test(u)) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
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
  await until(() => pg.locator('header [role="alert"]:has-text("MC SERVER IS OLDER THAN THIS CONSOLE")').count().then(n => n > 0), 8000, 'the version-skew banner');
  const banner = await pg.locator('header [role="alert"]:has-text("MC SERVER IS OLDER THAN THIS CONSOLE")').first().textContent();
  expect(/\.\/start\.sh/.test(banner), 'the banner gives the restart command');
  // F411's OWN staleness banner: no game_pick, no /api/pieces — PLAY has nothing pickable to show, but
  // it renders that fact rather than a blank screen or a crash (games-presets.md §5, "stale server").
  await until(() => pg.getByTestId('play-stale-server').count().then(n => n === 1), 8000, 'the PLAY stale-server banner');
  expect(/THE SERVER PREDATES THIS CONSOLE/.test(await pg.getByTestId('play-stale-server').textContent()), 'the PLAY banner names the fix');
  expect(await pg.locator('text=POWER-CYCLE THE GRENADE').count() === 0, 'no SETUP warning is invented when there is nothing to pick');
  expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, 'PLAY survives a missing station_source and game_pick (no undefined.something)');
  for (const v of ['muster', 'kit', 'lobby', 'live', 'recap', 'catalog', 'debug', 'designer']) {
    await go(pg, v);
    expect(await pg.locator('text=▲ CONSOLE ERROR').count() === 0, `${v} renders against a stale server`);
  }
  expect(wsStripped > 0, 'the WebSocket was stripped too — a REST-only "stale" run is a lie');
  ok(`stale server: every page renders, both skew banners shown, ${wsStripped} snapshots stripped  ${await shot(pg, '11-stale')}`);
  await closePage(pg);
});

// F411: the client that can 500 this way is `POST /api/play/pick`, not `PUT /api/config` — same wire
// change as `station-source-refused` above.
step('failure-path', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  const posts = [];
  await pg.route('**/api/play/pick', r => {
    if (r.request().method() !== 'POST') return r.continue();
    posts.push(JSON.parse(r.request().postData() || '{}'));
    return r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"compiler exploded"}' });
  });
  await kothBtn(pg).click();   // one tap: PLAY applies immediately, so this alone fires the refused POST
  await until(() => errorStrip(pg).count().then(n => n > 0), 8000, 'the 500 to surface in the strip');
  expect(/COMPILER EXPLODED|compiler exploded/.test(await errorStrip(pg).textContent()), 'the server message is shown verbatim, not "something went wrong"');
  await new Promise(r => setTimeout(r, 700));
  expect(posts.length === 1, `no follow-on pick fired after the failure (saw ${posts.length})`);
  expect((await kothBtn(pg).getAttribute('aria-pressed')) === 'false', 'the button does not claim picked after a 500');
  ok(`a 500 on POST /api/play/pick is visible and stops the flow  ${await shot(pg, '12-failure')}`);
  await closePage(pg);
});

// The owner's phone is a Pixel 4 (393x830); MC is also opened on a tablet and on short laptop screens.
for (const [name, vp] of [['pixel4', { width: 393, height: 830 }], ['tablet', { width: 820, height: 1180 }], ['landscape-short', { width: 1024, height: 500 }]]) {
  step(`viewport-${name}`, async ({ browser, base }) => {
    await resetTdm(base);
    const pg = await go(await newPage(browser, base, vp), 'build');
    await pickKoth(pg, { ms: 8000 });
    for (const view of ['build', 'kit']) {
      await go(pg, view);
      const over = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth,
        wide: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > window.innerWidth + 2)
          .slice(0, 4).map(e => `${e.tagName}.${(e.className || '').toString().slice(0, 18)}`) }));
      expect(over.doc <= over.win + 1, `${view} at ${vp.width}x${vp.height} does not scroll sideways (${over.doc} > ${over.win}; ${JSON.stringify(over.wide)})`);
    }
    await go(pg, 'build');
    // the thing this flow exists to say must survive the narrow layout: still rendered, still
    // unclipped. (`isVisible()` is not "in the viewport" — the width check is what proves nothing is
    // cut off, and this warning sits below the fold at 393px by design.)
    const warn = pg.locator('main div[role="status"] div', { hasText: PHONE_STEP }).first();
    expect(await warn.isVisible(), `the SETUP warning is still rendered at ${vp.width}px`);
    const wb = await warn.boundingBox();
    expect(wb && wb.x >= -1 && wb.x + wb.width <= vp.width + 1, `the SETUP warning fits the ${vp.width}px width (${JSON.stringify(wb)})`);
    ok(`${vp.width}x${vp.height} clean  ${await shot(pg, `13-${name}`)}`);
    await closePage(pg);
  });
}

// F411: the DESIGNER's per-mode "customize" screen is retired; the tap-target scan now covers PLAY,
// KIT and BUILD (`openBuild` — the `BUILD ▸` header link) instead. BUILD is a stub on this branch
// (`data-testid="build-screen"`, no controls), so its scan is trivially clean today and starts
// protecting for real the moment the BUILD lane lands its editor.
step('audit-taps', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await pickKoth(pg, { ms: 6000 });
  // `.hit44` (styles.css) grows a control's real tap area to 44px with an invisible `::before`
  // without changing its visual box — PLAY's own `−`/`+` steppers are drawn at 32px and rely on
  // exactly this (`StepBtn`), the same convention `game-edit.mjs`'s `auditRail` already accounts for.
  // Measuring the visual box alone would fail a control that is actually a full 44px to the thumb.
  const scan = async where => pg.evaluate(() => [...document.querySelectorAll('main button, main [role="button"], main [role="switch"], main [role="radio"]')]
    .filter(el => el.offsetParent !== null)
    .map(el => { const r = el.getBoundingClientRect(); return { t: (el.getAttribute('aria-label') || el.textContent || '?').trim().slice(0, 34), h: el.classList.contains('hit44') ? 44 : Math.round(r.height), w: Math.round(r.width) }; })
    .filter(x => x.h > 0)).then(rows => ({ where, rows }));
  const pages = [];
  pages.push(await scan('play'));
  await go(pg, 'kit'); pages.push(await scan('kit'));
  await go(pg, 'build');
  await pg.getByRole('button', { name: 'BUILD ▸' }).click();
  await until(() => pg.getByTestId('build-screen').count().then(n => n > 0), 8000, 'BUILD');
  pages.push(await scan('build'));
  for (const { where, rows } of pages) {
    const small = rows.filter(r => r.h < 36);
    // every one of these is a control an operator taps to set up the match — no decorative buttons
    // live in `main` on these three pages, so an undersized one FAILS rather than printing a finding.
    expect(small.length === 0, `${where}: undersized tap targets ${JSON.stringify(small)}`);
    console.log(`      ${where}: ${rows.length} controls, smallest ${rows.length ? Math.min(...rows.map(r => r.h)) : 'n/a'}px`);
  }
  ok('tap targets >= 36px on PLAY, KIT and BUILD');
  await closePage(pg);
});

step('audit-text', async ({ browser, base }) => {
  await resetTdm(base);
  const pg = await go(await newPage(browser, base), 'build');
  await pickKoth(pg);
  await until(async () => (await pg.locator(`text=${PHONE_STEP}`).count()) > 0, 8000, 'the SETUP warning');
  // meaning-carrying text only: the nav's 01..05 digits and the mode-picker abbreviations are decorative
  const tiny = await pg.evaluate(() => [...document.querySelectorAll('main *')]
    .filter(el => el.children.length === 0 && (el.textContent || '').trim().length > 3)
    .map(el => ({ t: el.textContent.trim().slice(0, 42), px: Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10 }))
    .filter(x => x.px < 11));
  const hard = tiny.filter(x => /GRENADE|SETUP|POWER-CYCLE|OBJECTIVE|F8\d|ERROR|▲/.test(x.t));
  expect(hard.length === 0, `text carrying the KotH setup meaning is >= 11px ${JSON.stringify(hard)}`);
  if (tiny.length) console.log(`      ${tiny.length} sub-11px string(s) on PLAY (non-blocking): ${JSON.stringify(tiny.slice(0, 6))}`);
  ok('the KotH setup copy is legible (>= 11px)');
  await closePage(pg);
});

// `?mock` is how the console is iterated on without a server (CLAUDE.md), so the demo has to predict the
// real server — including the F82 re-team. Same served bundle, no MC process involved.
step('mock-demo', async ({ browser, base }) => {
  const pg = await newPage(browser, base);
  await pg.goto(`${base}/?mock#build`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('text=Pick Game').count().then(n => n > 0), 10000, 'the mock PLAY screen');
  await pickKoth(pg, { ms: 6000 });
  expect(await pg.locator(`text=${PHONE_STEP}`).first().isVisible(), 'the demo shows the same SETUP step');
  // The demo backend lives in the page, so a reload restarts it: `go()` is out, and the walk has to
  // be a real click. The nav tab is the right one here — this step is about the KIT team chips, not
  // about pushing, and the demo's deliberately RED gun would make LOAD the forcing variant.
  await pg.locator('header nav button:has-text("KIT")').first().click();
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
    await pickKoth(pg, { ms: 8000, what: 'KotH playing on an old session' });
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
  // only the directory THIS run created, and only under the OS temp dir
  if (MC_HOME.startsWith(os.tmpdir())) fs.rmSync(MC_HOME, { recursive: true, force: true });
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
