// B3 — editing the LOADED game (mode/night/health/weapon pool) inline on KIT and LOBBY, in a real
// browser, against a real server (mock AND python), with the re-push/re-ack made visible.
//
//   npm run e2e:game-edit                # everything (~40 s)
//   ONLY=mock npm run e2e:game-edit      # one run: mock | real | locked | stale | venue | faults
//   MC_PORT=… VITE_PORT=… MC_PY=…        # move the ports / pick the interpreter
//
// Runs: mock (in-browser backend — the fast, deterministic walk: edit on KIT, push, edit again on
// LOBBY once already pushed, watch the ack count clear and recover), real (a real python MC, walked
// from ARMORY like kit-continue.mjs, proving the same flow against the real server this worktree
// carries), locked (armed/live refuses an edit and says RECALL), stale (an MC with `/api/modes`
// missing and no `loadout_policy` on the wire — the shape a pre-A10 or older server would send —
// renders without crashing and shows the degraded state instead of a blank control), venue (F162:
// the "SET EACH GUN TO <VENUE> (HOLD ALT 3 S)" reminder on GAMES + KIT at desk and phone width, its
// dismissal, its re-arm on a venue change, and a config with no `environment` at all), faults
// (A36/A37: `?mock&faults=1` puts a stale ack, an echo mismatch, a pool fault and a gun that does
// not echo on four otherwise-green guns, so all four states can be looked at without hardware).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));      // webapp/mc/test/e2e
const MC_DIR = path.resolve(HERE, '../..');                     // webapp/mc
const REPO = path.resolve(MC_DIR, '../..');                     // THIS WORKTREE's root
const SHOTS = path.join(HERE, 'shots');
// Its own ports — never 8765/8766 (koth.mjs / the dev server own those), never 8792 (kit-continue.mjs).
const MC_PORT = Number(process.env.MC_PORT || 8795);
const VITE_PORT = Number(process.env.VITE_PORT || 5186);
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
const killGroup = proc => new Promise(done => {
  let settled = false; const finish = () => { if (!settled) { settled = true; done(); } };
  proc.once('exit', finish);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* gone */ } }
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } finish(); }, 3000).unref();
});

/** This worktree carries no `.venv` of its own (it is gitignored and not duplicated per worktree) --
 *  the shared WSL venv lives on the MAIN checkout. Falling back to it is just borrowing an
 *  INTERPRETER BINARY (read-only exec, never a write); the CODE it runs is still pinned to THIS
 *  worktree via `cwd` + `PYTHONPATH` below, which is the thing that actually matters here. */
function findPython() {
  if (process.env.MC_PY) return process.env.MC_PY;
  const local = path.join(REPO, '.venv/bin/python');
  if (fs.existsSync(local)) return local;
  const worktreesMarker = '/.claude/worktrees/';
  if (REPO.includes(worktreesMarker)) {
    const main = path.join(REPO.slice(0, REPO.indexOf(worktreesMarker)), '.venv/bin/python');
    if (fs.existsSync(main)) return main;
  }
  console.error(`no python venv found (looked at ${local}); set MC_PY=`); process.exit(3);
}

async function startMC() {
  const py = findPython();
  try {
    const r = await fetch(`http://127.0.0.1:${MC_PORT}/api/state`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) { console.error(`SOMETHING ALREADY SERVES :${MC_PORT} — refusing to drive a server this run did not start.`); process.exit(3); }
  } catch { /* free: good */ }
  const wsPort = await freePort();
  const mcpDir = path.join(REPO, 'mcp');
  // PYTHONPATH pinned to THIS WORKTREE's `mcp/` — a stray env var from the shell (or another
  // worktree's checkout on the same box) must never make this run exercise someone else's code.
  const proc = spawn(py, ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(MC_PORT), '--ws-port', String(wsPort),
    '--demo', '--fake-net', '--no-auth', '--ephemeral'],
    { cwd: mcpDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, PYTHONPATH: mcpDir } });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${MC_PORT}`;
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`${base}/api/state`); if (r.ok) break; } catch { /* not yet */ }
    if (proc.exitCode != null) { console.error(`MC DIED:\n${log}`); process.exit(3); }
    await new Promise(r => setTimeout(r, 100));
  }
  const who = await (await fetch(`${base}/api/state`)).json();
  if (proc.exitCode != null || /address already in use|Errno 98/i.test(log)) {
    console.error(`OUR MC FAILED TO BIND :${MC_PORT} — something else is answering:\n${log}`); process.exit(3);
  }
  if (who?.lan?.port !== MC_PORT) { console.error(`:${MC_PORT} reports lan.port ${who?.lan?.port}`); await killGroup(proc); process.exit(3); }
  console.log(`  MC: ${base} (session ${who.session_id}, demo + fake-net, ephemeral, PYTHONPATH=${mcpDir})`);
  return { base, stop: () => killGroup(proc) };
}
async function startVite() {
  // Reuses kit-continue.mjs's proxy config (it just points `MC_PROXY_PORT` at whichever MC this run
  // started) rather than a third copy of the same three lines.
  const proc = spawn('npx', ['vite', '--config', path.join(HERE, 'vite.proxy.config.mjs'), '--port', String(VITE_PORT), '--strictPort'],
    { cwd: MC_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, MC_PROXY_PORT: String(MC_PORT) } });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${VITE_PORT}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.error(`vite did not start:\n${log}`); proc.kill('SIGKILL'); process.exit(3);
}

const jsErrors = [];
async function newPage(browser, base, viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => jsErrors.push(`[${step}] [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') jsErrors.push(`[${step}] [console] ${m.text().slice(0, 300)}`); });
  return pg;
}
const shot = async (pg, name) => {
  await pg.waitForTimeout(200);
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f, fullPage: false });
  console.log(`      shot ${f}`);
  return f;
};
const onKit = pg => pg.locator('main', { hasText: '[ A3 // KIT-OUT ]' }).count().then(n => n > 0);
const isMuster = pg => pg.locator('main', { hasText: '[ A1 // GEAR CHECK ]' }).count().then(n => n > 0);
/** Open the muster board through the nav the way the operator does (it is never phase-gated). */
const onMuster = async pg => {
  if (await isMuster(pg)) return true;
  await until(() => pg.locator('header nav button:has-text("ARMORY")').count().then(n => n > 0), 5000, 'the ARMORY nav tab');
  await pg.locator('header nav button:has-text("ARMORY")').first().click();
  return until(() => isMuster(pg), 5000, 'the muster board to open from the nav');
};
const onLobby = pg => pg.locator('main', { hasText: '[ A5 // LOBBY' }).count().then(n => n > 0);
const noCrash = async pg => expect(await pg.locator('text=CONSOLE ERROR').count() === 0, 'no crash boundary');
const panel = pg => pg.locator('[data-testid="game-edit-panel"]');
const openPanel = async pg => { await panel(pg).locator('[data-testid="game-edit-toggle"]').click(); await panel(pg).waitFor({ state: 'visible' }); };
const repushText = async pg => (await panel(pg).locator('[data-testid="game-edit-repush"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------- mock
async function runMock(browser, viteBase) {
  step = 'mock'; stepFailedAt = failures.length;
  console.log(`\n[${step}] the in-browser demo backend`);
  const pg = await newPage(browser, viteBase);
  await pg.goto(`${viteBase}/?mock#kit`, { waitUntil: 'domcontentloaded' });
  await until(() => onKit(pg), 15000, 'KIT to open (?mock)');
  await noCrash(pg);
  // The mock backend BOOTS at 'muster' regardless of which screen the hash opens (view and phase are
  // independent, same as the real server) -- advance it the way a host actually would, through the
  // console's own hook for driving the in-page demo from outside (store.tsx `window.__MC_MOCK__`),
  // so the panel is unlocked for the edits below.
  await pg.evaluate(async () => { await window.__MC_MOCK__.setPhase('kit', true); });

  // --- KIT: open, and edit MODE + NIGHT + HEALTH right there ---
  await openPanel(pg);
  ok(`KIT: game-edit panel open   ${await shot(pg, '01-mock-kit-open')}`);
  const before = await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText();
  // pick whichever mode option is NOT already selected
  const modeBtn = panel(pg).locator('[aria-label="mode"] button:not([aria-pressed="true"])').first();
  const modeLabel = (await modeBtn.innerText()).trim();
  await modeBtn.click();
  await until(async () => (await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()) !== before, 5000, 'the header to pick up the new mode');
  expect((await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()).includes(modeLabel), `header now shows ${modeLabel}`);
  ok(`MODE -> ${modeLabel} applied   ${await shot(pg, '02-mock-mode')}`);

  const night = panel(pg).locator('[role="switch"]');
  const nightBefore = await night.getAttribute('aria-checked');
  await night.click();
  await until(async () => (await night.getAttribute('aria-checked')) !== nightBefore, 5000, 'NIGHT OPS to flip');
  ok(`NIGHT OPS -> ${await night.getAttribute('aria-checked')}   ${await shot(pg, '03-mock-night')}`);

  const hp = panel(pg).locator('input[aria-label="default health"]');
  await hp.fill('180'); await hp.press('Enter');
  await until(async () => (await hp.inputValue()) === '180', 5000, 'the HP box to hold the applied value');
  ok('DEFAULT HEALTH -> 180 applied');

  // --- push the lobby (through the console's own control, not a fetch) so the RE-push has something
  //     to re-push TO --- then move to LOBBY and edit again.
  await pg.evaluate(() => { location.hash = '#lobby'; });
  await until(() => onLobby(pg), 8000, 'LOBBY to open');
  // The `?mock` fixture always carries one deliberately RED gun (kit-continue.mjs's own comment on
  // it), so the plain PUSH button stays disabled here on purpose — the host's real path in that case
  // is the HOST OVERRIDE tray's "Push anyway", not a blocked primary button.
  const pushBtn = pg.locator('main button:has-text("PUSH CONFIG & ARM")');
  if (await pushBtn.isEnabled().catch(() => false)) await pushBtn.click();
  else await pg.locator('main button:has-text("Push anyway")').click();
  await pg.waitForTimeout(400);
  await until(async () => (await pg.locator('main').innerText()).includes('Config pushed'), 8000, 'the lobby to report a push');
  ok(`LOBBY: pushed   ${await shot(pg, '04-mock-lobby-pushed')}`);

  await openPanel(pg);
  const repushBefore = await repushText(pg);
  expect(/ALL GUNS ON THIS CONFIG|RE-PUSHING|GUNS CONFIRMED ON THIS CONFIG/.test(repushBefore), `the repush line reads a real state before the edit (saw ${JSON.stringify(repushBefore)})`);
  const stepTextBefore = (await pg.locator('main').innerText()).replace(/\s+/g, ' ').match(/Config pushed[^A-Z]*\d+\/\d+/)?.[0] ?? '';

  // WEAPONS AVAILABLE — switch one primary weapon off
  const primaryGroup = panel(pg).locator('[aria-label="primary weapons available"]');
  const chip = primaryGroup.locator('button[aria-label$=", allowed"]').first();
  const chipName = (await chip.innerText()).replace(/^✓\s*/, '').trim();
  await chip.click();

  // The edit RE-PUSHES: the ack count must visibly MOVE (drop, then recover) — this is the
  // observable half of B3 (the un-push used to leave it looking untouched). Both indicators read the
  // SAME `lobby.acks` off the SAME snapshot, so they are checked in the one instant just confirmed to
  // be inside the transitional window — a second, separately-timed poll for the step text could miss
  // it (the mock's re-ack delay is short by design; a real gun's is ~1.5s).
  await until(async () => (await repushText(pg)) !== repushBefore, 4000, 'the repush line to change right after the edit');
  const stepTextDuring = (await pg.locator('main').innerText()).replace(/\s+/g, ' ').match(/Config pushed[^A-Z]*\d+\/\d+/)?.[0] ?? '';
  expect(stepTextDuring !== stepTextBefore, `LOBBY's own config-pushed step moves WITH the repush line (before "${stepTextBefore}", during "${stepTextDuring}")`);
  ok(`edit fired: repush line "${await repushText(pg)}", LOBBY step "${stepTextDuring}"   ${await shot(pg, '05-mock-repushing')}`);

  await until(async () => !/RE-PUSHING/.test(await repushText(pg)), 6000, 'the acks to recover');
  ok(`acks recovered: "${await repushText(pg)}"   ${await shot(pg, '06-mock-repushed')}`);
  expect(await primaryGroup.locator(`button[aria-label="${chipName}, off"]`).count() === 1, `${chipName} now reads off`);

  await pg.context().close();
}

// ---------------------------------------------------------------------------- real (python MC)
async function runReal(browser, viteBase, mcBase, vp = { width: 1280, height: 800 }, tag = 'desk') {
  step = `real/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] a real python MC on :${MC_PORT}, ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, viteBase, vp);
  await pg.goto(`${viteBase}/#kit`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header').count().then(n => n > 0), 10000, 'the command bar');
  await until(() => onKit(pg), 15000, 'KIT (a --demo --fake-net server seeds a ready roster)');
  await noCrash(pg);

  await openPanel(pg);
  const nightBefore = await panel(pg).locator('[role="switch"]').getAttribute('aria-checked');
  await panel(pg).locator('[role="switch"]').click();
  await until(async () => (await (await fetch(`${mcBase}/api/state`)).json()).config.night !== (nightBefore === 'true'),
    5000, 'the real server to hold the new NIGHT value');
  ok(`NIGHT OPS applied against the real server   ${await shot(pg, `10-real-night-${tag}`)}`);

  // A modest bump, not an arbitrary one: the real server's OWN balance rule (docs/weapon-design.md
  // §2.1, "cannot kill on one magazine") 400s a health/armor pool pushed too high for the shipped
  // clip sizes -- found the hard way probing this suite against the real server. 55 keeps the pool
  // (55+70=125) close to the default (45+70=115) while still being a value nothing else would set.
  const hp = panel(pg).locator('input[aria-label="default health"]');
  await hp.fill('55'); await hp.press('Enter');
  await until(async () => (await (await fetch(`${mcBase}/api/state`)).json()).config.health.max_hp === 55,
    5000, 'the real server to hold the new health value');
  ok('DEFAULT HEALTH applied against the real server');

  // push, then edit again — the real-server half of the re-push proof (mock already proved the
  // console-side indicator; this proves the SERVER really does re-push rather than un-push).
  await pg.evaluate(() => { location.hash = '#lobby'; });
  await until(() => onLobby(pg), 8000, 'LOBBY to open');
  const pushBtn = pg.locator('main button:has-text("PUSH CONFIG & ARM")');
  if (await pushBtn.count()) { await pushBtn.click(); }
  await until(async () => (await (await fetch(`${mcBase}/api/state`)).json()).lobby.pushed === true, 8000, 'the real server to report pushed');
  ok(`LOBBY pushed on the real server   ${await shot(pg, `11-real-lobby-pushed-${tag}`)}`);

  await openPanel(pg);
  await panel(pg).locator('[role="switch"]').click();   // NIGHT again — any edit re-pushes
  await pg.waitForTimeout(400);
  const afterEdit = await (await fetch(`${mcBase}/api/state`)).json();
  // The SERVER-SIDE half of B3 is a coordinated change owned by another lane (lane-teams,
  // `_repush_lobby_config` in worktree agent-a8915fe2899980fdf per its 2026-09-12 report) and had not
  // been merged into THIS worktree's `mcp/` at the time this suite was written -- this checks which
  // behaviour is actually live here and says so, rather than asserting a server fact this worktree
  // does not own and cannot itself guarantee. The console-side contract (re-use `lobby.pushed`/`acks`,
  // no new field) is proven against the mock above, which encodes the CONFIRMED target shape; jsdom's
  // `test/game-edit-panel.test.tsx` proves the same. Once the server lane's fix lands here, flip this
  // to a hard `expect`.
  if (afterEdit.lobby.pushed) ok('the real server RE-PUSHED (stayed pushed) across the edit — the B3 server fix is present in this worktree');
  else console.log(`    i the real server UN-PUSHED across the edit (lobby.pushed=false) — this worktree predates the B3 server fix (lane-teams, not yet merged); the console side is proven via the mock + jsdom suite instead`);

  // ---- A36: and the re-push has to be PROVABLE, not merely announced -----------------------
  // Field 2026-09-12: guns ran a previous push in nearly every match and every signal MC had still
  // read "ok", because an `ack_config` was only ever tested for truthiness. An ack now carries the
  // `config_id` it answered for, the whistle is refused on a stale one (force included), and the
  // board says which older config the gun answered. This walks the recovery: the counter empties at
  // the edit, refills as the nodes re-ack, and every ack names the config the server is holding NOW.
  const cfgNow = afterEdit.config.config_id;
  const acksFresh = async () => {
    const s = await (await fetch(`${mcBase}/api/state`)).json();
    const a = Object.values(s.lobby.acks);
    return a.length >= s.players.filter(p => p.node_id).length && a.every(x => x.ok && x.config_id === cfgNow);
  };
  await until(acksFresh, 8000, 'every gun to RE-ACK the new config_id');
  const settled = await (await fetch(`${mcBase}/api/state`)).json();
  expect(Object.values(settled.lobby.acks).every(a => a.config_id === cfgNow),
         'every ack names the config the server is holding now (A36)');
  expect(settled.lobby.all_acked === true, 'the server counts them as acked');
  const staleLines = settled.readiness.board.flatMap(r => (r.blockers ?? []).filter(b => /ACKED AN OLDER CONFIG|GUN ECHO|GUN POOL/.test(b)));
  expect(staleLines.length === 0, `no A36 fault stands once every gun has re-acked (saw ${JSON.stringify(staleLines)})`);
  // The gun echo really is checked against the pushed weapon: the fake node answers with the head's
  // own `$WEAP,0` magazine, so a green board here is the check PASSING, not the check being absent.
  const echoes = Object.values(settled.lobby.acks).map(a => a.gun_echo ?? '');
  expect(echoes.every(e => e.startsWith('$ALCD,')), `the nodes echo an $ALCD the weapon check can read (saw ${JSON.stringify(echoes)})`);
  ok(`re-pushed, re-acked on the new config_id, board clean   ${await shot(pg, `12-real-reacked-${tag}`)}`);
  await pg.context().close();
}

// ---------------------------------------------------------------------------- locked (armed/live)
async function runLocked(browser, viteBase) {
  step = 'locked'; stepFailedAt = failures.length;
  console.log(`\n[${step}] the console free-browses to KIT while the match is already armed/live`);
  const pg = await newPage(browser, viteBase);
  await pg.goto(`${viteBase}/?mock#kit`, { waitUntil: 'domcontentloaded' });
  await until(() => onKit(pg), 15000, 'KIT (?mock)');
  await pg.evaluate(async () => { await window.__MC_MOCK__.setPhase('live', true); });
  // The console FOLLOWS a phase that advances (store.tsx) -- exactly as it should when a real match
  // goes live -- so this lands on the LIVE screen, not KIT. The free-browse case this step is proving
  // is what happens next: the operator taps KIT in the nav anyway (it is never phase-gated) to check
  // something mid-match. That tap is the thing that must not find a control quietly doing nothing.
  await until(() => pg.locator('header nav button:has-text("KIT")').count().then(n => n > 0), 5000, 'the KIT nav tab');
  await pg.locator('header nav button:has-text("KIT")').first().click();
  await until(() => onKit(pg), 5000, 'KIT to open from the nav while the match is live');
  await until(async () => (await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()).includes('LOCKED — LIVE'),
    5000, 'the collapsed header to name the lock');
  ok(`header: LOCKED — LIVE, without even opening the panel   ${await shot(pg, '20-locked-header')}`);
  await openPanel(pg);
  const txt = await panel(pg).innerText();
  expect(/RECALL/.test(txt), `opening it explains RECALL is the way out (saw ${JSON.stringify(txt.slice(0, 160))})`);
  const disabledCount = await panel(pg).locator('fieldset[disabled] input, fieldset[disabled] button, fieldset[disabled] select').count();
  expect(disabledCount > 0, `every control under the fieldset is a real HTML disabled (saw ${disabledCount})`);
  ok(`opened while locked: names RECALL, ${disabledCount} controls really disabled   ${await shot(pg, '21-locked-open')}`);
  await pg.context().close();
}

// ---------------------------------------------------------------------------- stale (older server)
/** strip `loadout_policy` from every config over REST *and* the WebSocket — a pre-A10 session, or an
 *  MC that predates the policy at all. `kit-continue.mjs` established the pattern for stripping a
 *  field over both transports; this is the same shape for a different field. */
async function stripPolicy(pg) {
  const strip = s => ({ ...s, config: { ...s.config, loadout_policy: undefined } });
  await pg.route('**/api/state', async route => {
    const res = await route.fetch();
    let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    await route.fulfill({ response: res, body: JSON.stringify(strip(body)), headers: { ...res.headers(), 'content-type': 'application/json' } });
  });
  await pg.routeWebSocket(/\/ui-ws/, ws => {
    const server = ws.connectToServer();
    ws.onMessage(m => server.send(m));
    server.onMessage(m => {
      try {
        const msg = JSON.parse(String(m));
        if (msg.kind === 'snapshot' && msg.state) { msg.state = strip(msg.state); ws.send(JSON.stringify(msg)); return; }
        ws.send(m);
      } catch { ws.send(m); }
    });
  });
}
async function runStale(browser, viteBase, mcBase) {
  step = 'stale'; stepFailedAt = failures.length;
  console.log(`\n[${step}] /api/modes 404'd + no loadout_policy on the wire (over REST AND the WebSocket)`);
  const pg = await newPage(browser, viteBase);
  await pg.route('**/api/modes', route => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' }));
  await stripPolicy(pg);
  await pg.goto(`${viteBase}/#kit`, { waitUntil: 'domcontentloaded' });
  await until(() => onKit(pg), 15000, 'KIT to render with modes 404 + no loadout_policy');
  await noCrash(pg);
  await openPanel(pg);
  const txt = (await panel(pg).innerText()).replace(/\s+/g, ' ');
  expect(/mode list unavailable/i.test(txt), `MODE degrades to a plain label instead of a dead control (saw ${JSON.stringify(txt.slice(0, 200))})`);
  expect(await panel(pg).locator('button[aria-label$=", allowed"], button[aria-label$=", off"]').count() > 0,
    'WEAPONS AVAILABLE still renders (falls back to the OPEN policy client-side rather than going blank)');
  ok(`degraded but alive: "${txt.slice(0, 160)}"   ${await shot(pg, '30-stale')}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();
  void mcBase;
}

// ------------------------------------------------------------------- venue (F162, the ALT backstop)
/** The indoor/outdoor reminder, driven the way the operator drives it: pick the venue on GAMES, walk
 *  to KIT, dismiss it, change the venue, watch it come back. MC cannot set the gun's own indoor/
 *  outdoor mode (compile.py `DRIVE_IO_MODE` is "off" and every candidate is unverified), so this
 *  reminder is the ONLY thing that puts a rack of guns into the venue the operator just picked —
 *  which is why it gets a real-browser step rather than only a jsdom one.
 *
 *  Runs against the REAL python MC, at desk and phone width, and then against a server whose config
 *  carries no `environment` at all (the pre-venue shape) — where it must say nothing rather than
 *  name a venue nobody picked. */
const reminder = pg => pg.locator('[data-testid="venue-mode-reminder"]');
/** GAMES is the `build` view; reach it the way the operator does, through the nav tab. */
async function toGames(pg) {
  await pg.locator('header nav button:has-text("GAMES")').first().click();
  await until(() => pg.locator('main [role="group"][aria-label="venue"]').count().then(n => n > 0), 10000, 'GAMES and its VENUE control');
}
async function toKit(pg) {
  await pg.locator('header nav button:has-text("KIT")').first().click();
  await until(() => onKit(pg), 10000, 'KIT to open');
}
async function pickVenue(pg, want, mcBase) {
  await pg.locator(`main [role="group"][aria-label="venue"] button:has-text("${want.toUpperCase()}")`).click();
  await until(async () => (await (await fetch(`${mcBase}/api/state`)).json()).config.environment === want,
    5000, `the real server to hold environment=${want}`);
}
async function runVenue(browser, viteBase, mcBase, vp = { width: 1280, height: 800 }, tag = 'desk') {
  step = `venue/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] the ALT-hold reminder on GAMES + KIT, ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, viteBase, vp);
  await pg.goto(`${viteBase}/`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header nav button').count().then(n => n > 0), 15000, 'the command bar');
  await toGames(pg);
  await noCrash(pg);

  // Start from INDOOR so the OUTDOOR pick below is always a real change (the desk run leaves the
  // shared server wherever it finished, and a no-op click proves nothing).
  await pickVenue(pg, 'indoor', mcBase);
  await pickVenue(pg, 'outdoor', mcBase);
  // The reminder may already be on screen naming the OLD venue, so waiting for `count() === 1` would
  // pass against the previous render. Wait for the TEXT that changes.
  await until(async () => /SET EACH GUN TO OUTDOOR/.test(await reminder(pg).innerText().catch(() => '')),
    5000, 'the reminder on GAMES to name OUTDOOR');
  const txt = (await reminder(pg).innerText()).replace(/\s+/g, ' ');
  expect(/SET EACH GUN TO OUTDOOR/.test(txt), `it names the venue that was just picked (saw ${JSON.stringify(txt.slice(0, 120))})`);
  expect(/ALT 3 S/.test(txt), 'it says HOW (hold ALT 3 s)');
  expect(/PERSISTS ACROSS POWER CYCLES/.test(txt), 'it says WHY it matters even at the venue you played last');
  // it must be readable, not a 9px footnote, and it must fit the viewport it is in
  const box = await reminder(pg).boundingBox();
  expect(box && box.width <= vp.width, `it fits the ${vp.width}px viewport (width ${box && Math.round(box.width)})`);
  ok(`GAMES: "${txt.slice(0, 90)}"   ${await shot(pg, `40-venue-games-outdoor-${tag}`)}`);

  // the step is actionable on KIT too — that is where the guns are handed out
  await toKit(pg);
  await until(() => reminder(pg).count().then(n => n === 1), 5000, 'the reminder to be on KIT as well');
  ok(`KIT carries the same reminder   ${await shot(pg, `41-venue-kit-outdoor-${tag}`)}`);

  // DISMISS is a real control: it removes it, here AND on the screen it was raised from
  const btn = pg.locator('[data-testid="venue-mode-dismiss"]');
  const bb = await btn.boundingBox();
  expect(bb && bb.height >= 36 && bb.width >= 36, `DISMISS is a real tap target (${bb && Math.round(bb.width)}x${bb && Math.round(bb.height)})`);
  await btn.click();
  await until(() => reminder(pg).count().then(n => n === 0), 4000, 'the reminder to go away on KIT');
  // …and it stays dismissed on KIT, but NOT on GAMES (polish loop 2026-09-13). GAMES is where the
  // venue is PICKED and KIT is where the rack is actually walked, so acknowledging the instruction
  // on one screen is not doing it on the other: the dismissal is keyed by (screen, venue).
  await toGames(pg);
  expect(await reminder(pg).count() === 1, 'GAMES keeps its own reminder — dismissing on KIT is not walking the rack');
  await pg.locator('[data-testid="venue-mode-dismiss"]').click();   // …and answer it here too
  await until(() => reminder(pg).count().then(n => n === 0), 4000, 'the reminder to go away on GAMES as well');
  await toKit(pg);
  expect(await reminder(pg).count() === 0, 'KIT stays dismissed: an operator who walked the rack is not nagged again');
  await toGames(pg);
  ok(`dismissed per screen, both answered   ${await shot(pg, `42-venue-dismissed-${tag}`)}`);

  // ...but changing the venue is a NEW physical step on every gun, so it must come back
  await pickVenue(pg, 'indoor', mcBase);
  await until(async () => /SET EACH GUN TO INDOOR/.test(await reminder(pg).innerText().catch(() => '')),
    5000, 'the reminder to re-arm after a venue change, naming the NEW venue');
  expect(await reminder(pg).count() === 1, 'exactly one reminder is back');
  ok(`venue change re-armed it, naming INDOOR   ${await shot(pg, `43-venue-rearmed-${tag}`)}`);
  await pg.context().close();
}

/** An MC whose config has no `environment` key at all (the shape before the venue existed), stripped
 *  over REST *and* the WebSocket. A reminder that guessed a venue here would send the operator to
 *  change a persisted hardware setting on every gun for no reason. */
async function runVenueStale(browser, viteBase) {
  step = 'venue/stale'; stepFailedAt = failures.length;
  console.log('\n[venue/stale] no `environment` on the config, over REST AND the WebSocket');
  const pg = await newPage(browser, viteBase);
  const strip = s => { const c = { ...s.config }; delete c.environment; return { ...s, config: c }; };
  await pg.route('**/api/state', async route => {
    const res = await route.fetch();
    let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    await route.fulfill({ response: res, body: JSON.stringify(strip(body)), headers: { ...res.headers(), 'content-type': 'application/json' } });
  });
  await pg.routeWebSocket(/\/ui-ws/, ws => {
    const server = ws.connectToServer();
    ws.onMessage(m => server.send(m));
    server.onMessage(m => {
      try {
        const msg = JSON.parse(String(m));
        if (msg.kind === 'snapshot' && msg.state) { msg.state = strip(msg.state); ws.send(JSON.stringify(msg)); return; }
        ws.send(m);
      } catch { ws.send(m); }
    });
  });
  await pg.goto(`${viteBase}/#kit`, { waitUntil: 'domcontentloaded' });
  await until(() => onKit(pg), 15000, 'KIT to render with no environment on the wire');
  await noCrash(pg);
  expect(await reminder(pg).count() === 0, 'no reminder is shown when no venue is known');
  ok(`stale server: KIT alive, no invented venue   ${await shot(pg, '44-venue-stale')}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();
}

/** A36/A37 (U-3) — the four config-proof states, on screen, in a real browser.
 *
 *  `?mock` always acked with the config it had just pushed, so a stale ack, an echo mismatch, a pool
 *  fault and a gun that simply does not echo could be demoed exactly NEVER — and the console's
 *  rendering of all four was unverifiable by eye. `?mock&faults=1` puts one of each on four
 *  otherwise-green guns (webapp/mc/README.md → `?mock` demo switches). */
async function runFaults(browser, viteBase) {
  step = 'faults'; stepFailedAt = failures.length;
  console.log('\n[faults] ?mock&faults=1 — the four config-proof states on the muster board');
  const pg = await newPage(browser, viteBase);
  await pg.goto(`${viteBase}/?mock&faults=1#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => isMuster(pg), 15000, "the muster board");
  await noCrash(pg);
  // Push the config the way a host would: the A36 reds do not refuse the push that cures them (A37),
  // but the demo also ships one gun that is simply not powered, so this run takes the override.
  await pg.evaluate(async () => { await window.__MC_MOCK__.pushLobby(true); });
  // The console FOLLOWS a phase that advances, so the push lands us on LOBBY. The muster board is
  // where the per-gun proof lives, and the nav tab is never phase-gated — the operator's own route.
  await onMuster(pg);
  const txt = (await pg.locator('main').innerText()).replace(/\s+/g, ' ');
  for (const [what, re] of [
    ['the stale ack', /ACKED AN OLDER CONFIG/],
    ['the echo mismatch', /GUN ECHO ≠ CONFIG/],
    ['the pool fault', /GUN POOL ≠ CONFIG/],
    ['the gun that did not echo', /GUN DID NOT ECHO ITS WEAPON/],
  ]) expect(re.test(txt), `${what} is on the board (saw ${JSON.stringify(txt.slice(0, 200))})`);
  // NOT ECHOED is neutral: it is on a row that is not red, and it is not one of the blocker lines.
  const neutral = await pg.locator('[data-echo="not_echoed"]').count();
  expect(neutral === 1, `exactly one row reads NOT ECHOED (saw ${neutral})`);
  const proven = await pg.locator('[data-echo="proven"]').count();
  expect(proven > 0, `and at least one reads PROVEN, so the two are distinguishable (saw ${proven})`);
  ok(`all four states visible, NOT ECHOED neutral beside ${proven} proven   ${await shot(pg, '50-faults-board')}`);
  // The unproven row is the one a human has to be able to READ as unproven, so put it on screen.
  await pg.locator('[data-echo="not_echoed"]').first().scrollIntoViewIfNeeded();
  const unprovenRow = await pg.locator('[data-echo="not_echoed"]').first().innerText();
  expect(/UNPROVEN ON THIS FIRMWARE/.test(unprovenRow), `the unproven row says why (saw ${JSON.stringify(unprovenRow)})`);
  ok(`the NOT ECHOED row, on screen   ${await shot(pg, '52-faults-not-echoed')}`);
  // U-1/U-2/U-4 — the LOBBY side of the same state: the rail has to NAME the guns answering for an
  // older config (a count is not an instruction), every fault line has to keep its "what to do" half,
  // and the disabled ARM button has to say which of the two problems it is.
  await pg.locator('header nav button:has-text("LOBBY")').first().click();
  await until(() => onLobby(pg), 5000, 'the LOBBY to open from the nav');
  const rail = (await pg.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(/still answering for an older config/.test(rail),
    `the rail names the stale guns, not just a count (saw ${JSON.stringify(rail.slice(0, 200))})`);
  expect(/Re-push/i.test(rail), 'the fault list keeps the RE-PUSH half of each A36 line');
  const arm = pg.locator('button:has-text("ARM COUNTDOWN")').first();
  const title = await arm.getAttribute('title');
  expect(/older config/i.test(title ?? ''), `the disabled ARM says WHY (saw ${JSON.stringify(title)})`);
  expect(/RE-PUSH CONFIG on LOBBY/.test(title ?? ''), `...and names the button that fixes it (saw ${JSON.stringify(title)})`);
  ok(`LOBBY names the stale guns and keeps every instruction   ${await shot(pg, '53-faults-lobby')}`);
  // R2-1 — the button the three fault lines name. Every one of them says RE-PUSH and until now
  // `api.pushLobby` was reachable only while the lobby was UNPUSHED, so the word named nothing.
  const repush = pg.locator('button[data-repush="1"]').first();
  expect(await repush.count() > 0, 'a curable red puts RE-PUSH CONFIG on the rail');
  expect(await repush.isEnabled(), 'and it is clickable — this is the cure, not another refusal');
  ok(`RE-PUSH CONFIG is on screen and enabled   ${await shot(pg, '54-faults-repush')}`);
  await repush.click();
  await until(async () => {
    const s = (await pg.locator('main').innerText()).replace(/\s+/g, ' ');
    return !/ACKED AN OLDER CONFIG|GUN ECHO ≠ CONFIG|GUN POOL ≠ CONFIG/.test(s);
  }, 8000, 'the three curable reds to clear after the re-push');
  const cured = (await pg.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(!/still answering for an older config/.test(cured), 'the rail sentence goes with them');
  // The demo also ships one gun that is simply NOT POWERED, which still reds the board and still
  // holds the whistle — the point is that the reason has changed from one the operator was told to
  // re-push for to one they have to go and fix.
  const armTitle = await pg.locator('button:has-text("ARM COUNTDOWN")').first().getAttribute('title');
  expect(!/older config/i.test(armTitle ?? ''), `the ARM no longer blames a stale head (saw ${JSON.stringify(armTitle)})`);
  expect(/NOT POWERED/.test(cured), 'the one red left is the gun nobody switched on');
  ok(`the re-push cured all three   ${await shot(pg, '55-faults-cured')}`);
  // …and NOT ECHOED survives it: that row is the v4.32 firmware, not a stale head.
  await onMuster(pg);
  const stillUnproven = await pg.locator('[data-echo="not_echoed"]').count();
  expect(stillUnproven === 1, `NOT ECHOED is not curable by a push (saw ${stillUnproven})`);
  ok(`NOT ECHOED survives the cure   ${await shot(pg, '56-faults-not-echoed-after')}`);
  // …and a clean ?mock shows none of them: the switch is opt-in, not the demo's new normal.
  const clean = await newPage(browser, viteBase);
  await clean.goto(`${viteBase}/?mock#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => clean.locator('main', { hasText: '[ A1 // GEAR CHECK ]' }).count().then(n => n > 0), 15000, 'the clean board');
  await clean.evaluate(async () => { await window.__MC_MOCK__.pushLobby(true); });
  await onMuster(clean);
  const cleanTxt = (await clean.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(!/ACKED AN OLDER CONFIG|GUN ECHO ≠ CONFIG|GUN POOL ≠ CONFIG|DID NOT ECHO/.test(cleanTxt),
    'a plain ?mock demos none of the four');
  ok(`plain ?mock stays clean   ${await shot(clean, '51-faults-clean')}`);
  await clean.context().close();
  await pg.context().close();
}

// ---------------------------------------------------------------------------- main
const DESK = { width: 1280, height: 800 }, PHONE = { width: 393, height: 830 };
fs.mkdirSync(SHOTS, { recursive: true });
const mc = await startMC();
const vite = await startVite();
const browser = await chromium.launch();
try {
  if (!ONLY || ONLY === 'mock') await runMock(browser, vite.base);
  if (!ONLY || ONLY === 'real') { await runReal(browser, vite.base, mc.base, DESK, 'desk'); await runReal(browser, vite.base, mc.base, PHONE, 'phone'); }
  if (!ONLY || ONLY === 'locked') await runLocked(browser, vite.base);
  if (!ONLY || ONLY === 'stale') await runStale(browser, vite.base, mc.base);
  if (!ONLY || ONLY === 'venue') { await runVenue(browser, vite.base, mc.base, DESK, 'desk'); await runVenue(browser, vite.base, mc.base, PHONE, 'phone'); await runVenueStale(browser, vite.base); }
  if (!ONLY || ONLY === 'faults') await runFaults(browser, vite.base);
} finally {
  await browser.close();
  await vite.stop();
  await mc.stop();
}
console.log('\n---------------------------------------------');
if (jsErrors.length) { console.log('JS ERRORS:'); jsErrors.forEach(e => console.log('  ' + e)); }
if (failures.length) { console.log(`FAILURES (${failures.length}):`); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('all steps passed');
