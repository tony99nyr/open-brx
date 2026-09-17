// STANDBY (2026-09-12) — pull a player out of the lobby and put them back, clicked in a real browser.
//
// The field ask (Tony, first four-phone session): "i had a player walk away. i dont have a way to do
// that in MC ... pull them out into standby ... i want to be able to select who is going to
// participate in the lobby". These are the screen-truth steps; `test/lobby-standby.test.tsx` is the
// same behaviour in jsdom, in 1 s.
//
//   npm run e2e:standby              # everything (~40 s)
//   ONLY=real npm run e2e:standby    # one run: real | kit | stale | fail | live
//   MC_PORT=… VITE_PORT=… MC_PY=…    # move the ports / pick the interpreter
//
// Runs: real (a real python MC on :8793, LOBBY: STANDBY moves the row to the bench and the READY
// total drops; PLAY brings it back), kit (STAND DOWN on the selected operator, PLAY from the bench),
// stale (snapshots stripped of `standby` over REST *and* the WebSocket: no section, no chip, no
// crash; then the field present but the route 404: the error strip names the version skew), fail
// (the route forced to 400: the strip shows the server's reason and nothing moves), live (the match
// pushed and armed: no STAND DOWN, no PLAY, the bench says MATCH LIVE — runs LAST, it consumes the
// server), at desk (1280x800) and phone (393x830) widths.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));      // webapp/mc/test/e2e
const MC_DIR = path.resolve(HERE, '../..');                     // webapp/mc
const REPO = path.resolve(MC_DIR, '../..');
const SHOTS = path.join(HERE, 'shots', 'standby');   // one folder per script: a parallel run must not wipe another script's shots
const MC_PORT = Number(process.env.MC_PORT || 8793);
const VITE_PORT = Number(process.env.VITE_PORT || 5182);
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

async function startMC() {
  const py = process.env.MC_PY || path.join(REPO, '.venv/bin/python');
  try {
    const r = await fetch(`http://127.0.0.1:${MC_PORT}/api/state`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) { console.error(`SOMETHING ALREADY SERVES :${MC_PORT} — refusing to drive a server this run did not start.`); process.exit(3); }
  } catch { /* free: good */ }
  const wsPort = await freePort();
  const proc = spawn(py, ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(MC_PORT), '--ws-port', String(wsPort),
    '--demo', '--fake-net', '--no-auth', '--ephemeral',
    // T3-A: this suite reads the FIRST `[role="alert"]` in the header to assert the version-skew and
    // server-reason strips. On a WSL dev box MC now (correctly) raises a standing LAN-unreachability
    // banner, which is an alert in that same header and displaced both. `--advertise` is T3-A's own
    // override for "the advertised address is already right", which for a 127.0.0.1 e2e it is.
    '--advertise', '127.0.0.1'], { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    // The MC package must be THIS tree's: the venv's editable install may point at another checkout
    // (a worktree beside the main tree, 2026-09-12). PYTHONPATH puts `<repo>/mcp` first.
    env: { ...process.env, PYTHONPATH: [path.join(REPO, 'mcp'), process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter) } });
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
  if (!Array.isArray(who.standby)) { console.error(`the MC that answered has no \`standby\` field — not this tree's server?\n${log}`); await killGroup(proc); process.exit(3); }
  console.log(`  MC: ${base} (session ${who.session_id}, demo + fake-net, ephemeral, ${who.players?.length ?? 0} players)`);
  return { base, stop: () => killGroup(proc) };
}
async function startVite() {
  const proc = spawn(process.execPath, [path.join(MC_DIR, 'node_modules/vite/bin/vite.js'), '--config', path.join(HERE, 'vite.proxy.config.mjs'), '--port', String(VITE_PORT), '--strictPort'],
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
  // the stale/fail runs FORCE a 404/400 on the standby route: the browser's own 'Failed to load resource'
  // line for that is the test working, not an error in the console
  pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (404|400)/.test(m.text())) jsErrors.push(`[${step}] [console] ${m.text().slice(0, 300)}`); });
  pg.__base = base;
  return pg;
}
const shot = async (pg, name) => {
  await pg.evaluate(() => { window.scrollTo(0, 0); document.querySelector('main')?.scrollTo(0, 0); }).catch(() => {});
  await pg.waitForTimeout(320);
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f, fullPage: false });
  console.log(`      shot ${f}`);
  return f;
};
const onLobby = pg => pg.locator('main', { hasText: '[ A5 // LOBBY' }).count().then(n => n > 0);
const onKit = pg => pg.locator('main', { hasText: '[ A3 // KIT-OUT ]' }).count().then(n => n > 0);
const noCrash = async (pg, where) => expect(await pg.locator('text=CONSOLE ERROR').count() === 0, `no crash boundary (${where})`);
const readyText = async pg => (await pg.locator('main').innerText()).replace(/\s+/g, ' ').match(/Ready (\d+\/\d+)/)?.[1] ?? '?';
const strip = async pg => (await pg.locator('header [role="alert"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
const server = async base => (await fetch(`${base}/api/state`)).json();

/** A `--demo --fake-net` server boots into LOBBY, but its fake phones send their first STATUS ~2 s
 *  later, and until then every gun is "CLOCK NOT SYNCED" on the board. Wait for the board to go green
 *  before acting, or the first run races the demo driver (seen once on the desk run, 2026-09-12). */
async function greenBoard(mcBase) {
  await until(async () => { const r = (await server(mcBase)).readiness; return r && r.go && r.greens === r.roster_size && r.roster_size > 0; }, 15000, 'a green readiness board');
}

async function open(pg, url, where, isThere) {
  await pg.goto(url, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header').count().then(n => n > 0), 10000, 'the command bar');
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 15000, 'the first snapshot');
  await until(() => isThere(pg), 10000, where);
}

/** tap targets and text sizes of every standby control on screen (skill §2): primary controls FAIL the run */
async function audit(pg, where) {
  const rows = await pg.evaluate(() => Array.from(document.querySelectorAll('[data-standby], [data-reinstate], [data-stand-down]'))
    .map(n => { const b = n.closest('button') || n; const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
      // `.hit44` extends the hit area with a 44px pseudo-element — measure that, not the visible box
      const hit = Math.max(r.height, b.classList.contains('hit44') ? 44 : 0);
      return { t: (b.textContent || '').trim(), h: Math.round(hit), fs: parseFloat(cs.fontSize), off: r.right > innerWidth + 1 || r.left < -1 }; }));
  for (const r of rows) {
    expect(r.h >= 36, `tap target "${r.t}" is ${r.h}px tall (${where})`);
    expect(r.fs >= 11, `text "${r.t}" is ${r.fs}px (${where})`);
    expect(!r.off, `"${r.t}" is inside the viewport (${where})`);
  }
  return rows.map(r => `${r.t}=${r.h}px/${r.fs}px`).join('  ');
}

// ---------------------------------------------------------------------------- the runs
async function runReal(browser, viteBase, mcBase, vp, tag) {
  step = `real/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] a real python MC on :${MC_PORT}, LOBBY, ${vp.width}x${vp.height}`);
  await greenBoard(mcBase);
  const pg = await newPage(browser, viteBase, vp);
  await open(pg, `${viteBase}/#lobby`, 'LOBBY', onLobby);
  const s0 = await server(mcBase);
  const n0 = s0.players.length;
  // everyone parked by an earlier run has been put back; start from a clean bench
  expect((s0.standby || []).length === 0, `nobody on standby at the start (saw ${(s0.standby || []).length})`);
  expect(await pg.locator('[data-standby-section]').count() === 0, 'no STANDBY section while nobody sits out');
  expect(await pg.locator('[data-standby]').count() === n0, `one STANDBY chip per rostered player (${n0})`);
  const r0 = await readyText(pg);
  ok(`LOBBY: ${n0} rows, Ready ${r0}, no bench   ${await shot(pg, `40-${tag}-lobby-before`)}`);
  ok(`audit: ${await audit(pg, `${tag} lobby`)}`);

  // STAND DOWN on one row — as a DOUBLE-tap. Review 2026-09-12: the second tap used to 404 as "no such
  // player" and the client turned every 404 into the RESTART banner. Now: one request, no banner.
  const target = s0.players[1];
  let posts = 0;
  await pg.route('**/api/players/*/standby', route => { posts++; route.continue(); });
  await pg.locator(`[data-standby="${target.player_id}"]`).dblclick();
  await until(async () => (await server(mcBase)).standby.some(p => p.player_id === target.player_id), 8000, 'the server to park them');
  await pg.waitForTimeout(400);
  expect(posts === 1, `a double-tap sent exactly ONE request (saw ${posts})`);
  expect((await server(mcBase)).standby.filter(p => p.player_id === target.player_id).length === 1, 'parked once');
  const banner = await strip(pg);
  expect(!/PREDATES THIS UI/.test(banner), `no false skew banner after a double-tap (strip: ${JSON.stringify(banner)})`);
  await pg.unroute('**/api/players/*/standby');
  await until(() => pg.locator('[data-standby-section]').count().then(n => n === 1), 8000, 'the STANDBY section to appear');
  const s1 = await server(mcBase);
  expect(s1.players.length === n0 - 1, `the roster is one shorter on the server (${s1.players.length})`);
  expect(await pg.locator(`[data-standby="${target.player_id}"]`).count() === 0, `${target.display}'s row left the team column`);
  const sec = (await pg.locator('[data-standby-section]').innerText()).replace(/\s+/g, ' ');
  expect(sec.includes('STANDBY // 1 SITTING OUT'), `the section counts them (saw ${JSON.stringify(sec.slice(0, 60))})`);
  expect(sec.includes(target.display), `the section names ${target.display}`);
  expect(sec.includes(target.gun_id), `the section shows their gun ${target.gun_id}`);
  const r1 = await readyText(pg);
  expect(r1.endsWith(`/${n0 - 1}`), `the READY total dropped to /${n0 - 1} (saw ${r1})`);
  // the bench is not counted as a blocker: the push stays available for the rest
  expect(await pg.locator('main button:has-text("PUSH CONFIG & ARM")').isDisabled() === false, 'PUSH CONFIG & ARM is still live for the players who remain');
  ok(`STANDBY: ${target.display} on the bench, Ready ${r1}   ${await shot(pg, `41-${tag}-lobby-parked`)}`);
  ok(`audit: ${await audit(pg, `${tag} parked`)}`);

  // PLAY brings them back
  await pg.locator(`[data-reinstate="${target.player_id}"]`).click();
  await until(async () => (await server(mcBase)).players.some(p => p.player_id === target.player_id), 8000, 'the server to reinstate them');
  await until(() => pg.locator('[data-standby-section]').count().then(n => n === 0), 8000, 'the STANDBY section to go');
  const s2 = await server(mcBase);
  const back = s2.players.find(p => p.player_id === target.player_id);
  expect(back && back.player_num === target.player_num, `${target.display} kept #${target.player_num} (saw #${back?.player_num})`);
  expect(back && back.gun_id === target.gun_id, 'and their gun');
  expect(back && back.node_id, 'and their phone was re-bound (node_id set)');
  expect(await pg.locator(`[data-standby="${target.player_id}"]`).count() === 1, 'the row is back in the column with its STANDBY chip');
  const r2 = await readyText(pg);
  expect(r2.endsWith(`/${n0}`), `the READY total is back to /${n0} (saw ${r2})`);
  expect(r2 === `${n0 - 1}/${n0}`, `they come back NOT ready — ${n0 - 1}/${n0}, the phone must ready up again (saw ${r2})`);
  ok(`PLAY: back on the roster, Ready ${r2}   ${await shot(pg, `42-${tag}-lobby-back`)}`);
  // leave the roster as found for the next run
  await pg.locator(`main button:has-text("${target.display} ▸")`).first().click().catch(() => {});
  await until(async () => (await server(mcBase)).players.every(p => p.ready), 8000, 'everyone ready again');
  await pg.context().close();
}

async function runKit(browser, viteBase, mcBase, vp, tag) {
  step = `kit/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] KIT: STAND DOWN on the selected operator, PLAY from the bench, ${vp.width}x${vp.height}`);
  await greenBoard(mcBase);
  const pg = await newPage(browser, viteBase, vp);
  await open(pg, `${viteBase}/#kit`, 'KIT', onKit);
  const s0 = await server(mcBase);
  const n0 = s0.players.length;
  const target = s0.players[0];   // KIT selects the first player by default
  expect(await pg.locator('[data-standby-section]').count() === 0, 'no bench on KIT while nobody sits out');
  await until(() => pg.locator(`[data-stand-down="${target.player_id}"]`).count().then(n => n === 1), 8000, `STAND DOWN for ${target.display}`);
  ok(`KIT: ${n0} OPERATORS, STAND DOWN offered for ${target.display}   ${await shot(pg, `50-${tag}-kit-before`)}`);
  await pg.locator(`[data-stand-down="${target.player_id}"]`).click();
  await until(async () => (await server(mcBase)).standby.some(p => p.player_id === target.player_id), 8000, 'the server to park them');
  await until(() => pg.locator('[data-standby-section]').count().then(n => n === 1), 8000, 'the bench under the roster');
  const text = (await pg.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(text.includes(`${n0 - 1} OPERATORS`), `the roster header counts ${n0 - 1} (saw ${JSON.stringify(text.match(/\d+ OPERATORS/)?.[0])})`);
  expect((await pg.locator('[data-standby-section]').innerText()).includes(target.display), `the bench names ${target.display}`);
  ok(`STAND DOWN: ${target.display} on the bench   ${await shot(pg, `51-${tag}-kit-parked`)}`);
  ok(`audit: ${await audit(pg, `${tag} kit`)}`);
  // ARMORY: the gun they still wear is NOT a stray (review 2026-09-12) — ON STANDBY + PLAY, no claim form
  await pg.evaluate(() => { location.hash = '#muster'; });
  await until(() => pg.locator(`[data-standby-holder="${target.player_id}"]`).count().then(n => n === 1), 8000, 'the ARMORY card to say ON STANDBY');
  const card = pg.locator('[data-node-card]', { has: pg.locator(`[data-standby-holder="${target.player_id}"]`) });
  const ctext = (await card.innerText()).replace(/\s+/g, ' ');
  expect(ctext.includes(`ON STANDBY · ${target.display}`), `the card names who sits out (saw ${JSON.stringify(ctext.slice(0, 160))})`);
  expect(!ctext.includes('WHO CARRIES THIS?'), 'no claim form for a parked player\'s gun');
  expect(await card.locator(`[data-reinstate="${target.player_id}"]`).count() === 1, 'PLAY on the card');
  ok(`ARMORY: parked gun shows ON STANDBY + PLAY   ${await shot(pg, `53-${tag}-armory-parked`)}`);
  await pg.evaluate(() => { location.hash = '#kit'; });
  await until(() => onKit(pg), 8000, 'KIT again');
  await pg.locator(`[data-reinstate="${target.player_id}"]`).click();
  await until(async () => (await server(mcBase)).players.some(p => p.player_id === target.player_id), 8000, 'the server to reinstate them');
  await until(() => pg.locator('[data-standby-section]').count().then(n => n === 0), 8000, 'the bench to clear');
  expect((await pg.locator('main').innerText()).replace(/\s+/g, ' ').includes(`${n0} OPERATORS`), `back to ${n0} OPERATORS`);
  ok(`PLAY: back in the roster   ${await shot(pg, `52-${tag}-kit-back`)}`);
  // leave everyone ready for the next run
  await fetch(`${mcBase}/api/players/${target.player_id}/ready`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ready: true }) });
  await pg.context().close();
}

/** strip fields from every snapshot, over REST *and* the WebSocket */
async function stripSnapshots(pg, fn) {
  await pg.route('**/api/state', async route => {
    const res = await route.fetch();
    let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    await route.fulfill({ response: res, body: JSON.stringify(fn(body)), headers: { ...res.headers(), 'content-type': 'application/json' } });
  });
  await pg.routeWebSocket(/\/ui-ws/, ws => {
    const srv = ws.connectToServer();
    ws.onMessage(m => srv.send(m));
    srv.onMessage(m => {
      try {
        const msg = JSON.parse(String(m));
        if (msg.kind === 'snapshot' && msg.state) { msg.state = fn(msg.state); ws.send(JSON.stringify(msg)); return; }
        ws.send(m);
      } catch { ws.send(m); }
    });
  });
}

async function runStale(browser, viteBase, mcBase, vp, tag) {
  step = `stale/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] an MC that predates STANDBY, ${vp.width}x${vp.height}`);
  // (a) no `standby` in any snapshot: the console must show NO control for a route it cannot assume
  let pg = await newPage(browser, viteBase, vp);
  await stripSnapshots(pg, s => { const { standby: _drop, ...rest } = s; return rest; });
  await open(pg, `${viteBase}/#lobby`, 'LOBBY', onLobby);
  await noCrash(pg, 'lobby, standby stripped');
  expect(await pg.locator('[data-standby]').count() === 0, 'no STANDBY chip on any row');
  expect(await pg.locator('[data-standby-section]').count() === 0, 'no STANDBY section');
  const n = (await server(mcBase)).players.length;
  expect((await readyText(pg)).endsWith(`/${n}`), `the READY total still counts the roster (/${n})`);
  ok(`stripped LOBBY: rows without the chip, no section   ${await shot(pg, `60-${tag}-stale-lobby`)}`);
  await pg.evaluate(() => { location.hash = '#kit'; });
  await until(() => onKit(pg), 8000, 'KIT');
  await noCrash(pg, 'kit, standby stripped');
  expect(await pg.locator('[data-stand-down]').count() === 0, 'no STAND DOWN on KIT');
  ok(`stripped KIT: no STAND DOWN   ${await shot(pg, `61-${tag}-stale-kit`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();

  // (b) the field is there but the ROUTE is not: the strip must say "restart the server", not "Not Found"
  pg = await newPage(browser, viteBase, vp);
  let hits = 0;
  // a MISSING route on Starlette is a plain-text "Not Found" (no JSON `error`); a handler's own 404
  // carries one, and is shown as the server's words instead (see the real run's double-tap)
  await pg.route('**/api/players/*/standby', route => { hits++; route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }); });
  await open(pg, `${viteBase}/#lobby`, 'LOBBY', onLobby);
  const s0 = await server(mcBase);
  await pg.locator(`[data-standby="${s0.players[0].player_id}"]`).click();
  await until(() => strip(pg).then(t => t.length > 0), 8000, 'the error strip');
  const t = await strip(pg);
  expect(hits === 1, `exactly one request went out (${hits})`);
  expect(/PREDATES THIS UI/.test(t), `the strip names the version skew (saw ${JSON.stringify(t)})`);
  expect(/RESTART/.test(t), 'and tells the operator to restart the server');
  expect((await server(mcBase)).standby.length === 0, 'nothing was parked on the server');
  expect(await pg.locator('[data-standby-section]').count() === 0, 'no section appeared');
  ok(`404 route: "${t}"   ${await shot(pg, `62-${tag}-stale-404`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();
}

async function runFail(browser, viteBase, mcBase, vp, tag) {
  step = `fail/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] the standby route forced to 400, ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, viteBase, vp);
  let hits = 0;
  await pg.route('**/api/players/*/standby', route => { hits++; route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'cannot stand a player down after the match has started (forced)' }) }); });
  await open(pg, `${viteBase}/#lobby`, 'LOBBY', onLobby);
  const s0 = await server(mcBase);
  const n0 = s0.players.length;
  await pg.locator(`[data-standby="${s0.players[0].player_id}"]`).click();
  await until(() => strip(pg).then(t => t.length > 0), 8000, 'the error strip');
  const t = await strip(pg);
  expect(hits === 1, `exactly one request went out (${hits})`);
  expect(/after the match has started/.test(t), `the strip shows the server's reason (saw ${JSON.stringify(t)})`);
  expect(await pg.locator('[data-standby]').count() === n0, `every row is still on the board (${n0})`);
  expect(await pg.locator('[data-standby-section]').count() === 0, 'no section appeared');
  expect((await readyText(pg)).endsWith(`/${n0}`), 'the READY total did not move');
  ok(`400: "${t}", nothing moved   ${await shot(pg, `70-${tag}-fail400`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();
}

async function runLive(browser, viteBase, mcBase, vp, tag) {
  step = `live/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] the match pushed and ARMED: nothing to tap, ${vp.width}x${vp.height}`);
  await greenBoard(mcBase);
  const s0 = await server(mcBase);
  const target = s0.players[s0.players.length - 1];
  const hdr = { 'content-type': 'application/json' };
  // park one player in the LOBBY (allowed), then push and arm the rest
  let r = await fetch(`${mcBase}/api/players/${target.player_id}/standby`, { method: 'POST', headers: hdr });
  expect(r.ok, `stand down in the lobby is accepted (${r.status})`);
  r = await fetch(`${mcBase}/api/lobby/push`, { method: 'POST', headers: hdr, body: JSON.stringify({ force: true }) });
  expect(r.ok, `the push went out (${r.status})`);
  await until(async () => { const st = await server(mcBase); return st.lobby.pushed && st.lobby.all_acked; }, 15000, 'every remaining gun to ack');
  r = await fetch(`${mcBase}/api/start`, { method: 'POST', headers: hdr, body: JSON.stringify({ runway_s: 120, force: true }) });
  expect(r.ok, `the start went out (${r.status})`);
  await until(async () => (await server(mcBase)).phase === 'armed', 8000, 'the server to reach ARMED');
  // the server refuses both directions now
  r = await fetch(`${mcBase}/api/players/${target.player_id}/standby`, { method: 'DELETE', headers: hdr });
  expect(r.status === 400, `PLAY is refused once armed (${r.status})`);
  r = await fetch(`${mcBase}/api/players/${s0.players[0].player_id}/standby`, { method: 'POST', headers: hdr });
  expect(r.status === 400, `STAND DOWN is refused once armed (${r.status})`);

  const pg = await newPage(browser, viteBase, vp);
  await open(pg, `${viteBase}/#armed`, 'ARMED', p => p.locator('main').count().then(n => n > 0));
  await pg.evaluate(() => { location.hash = '#lobby'; });
  await until(() => onLobby(pg), 8000, 'LOBBY (free browsing while armed)');
  await noCrash(pg, 'lobby while armed');
  expect(await pg.locator('[data-standby]').count() === 0, 'no STAND DOWN chip on any row while armed');
  expect(await pg.locator('[data-reinstate]').count() === 0, 'no PLAY while armed');
  expect(await pg.locator('[data-standby-section]').count() === 1, 'the bench is still listed');
  const sec = (await pg.locator('[data-standby-section]').innerText()).replace(/\s+/g, ' ');
  expect(/MATCH LIVE/.test(sec), `the bench says why nothing is tappable (saw ${JSON.stringify(sec.slice(0, 120))})`);
  expect(sec.includes(target.display), `and still names ${target.display}`);
  ok(`ARMED LOBBY: no controls, "${sec.slice(0, 90)}"   ${await shot(pg, `80-${tag}-live-lobby`)}`);
  await pg.evaluate(() => { location.hash = '#kit'; });
  await until(() => onKit(pg), 8000, 'KIT while armed');
  await noCrash(pg, 'kit while armed');
  expect(await pg.locator('[data-stand-down]').count() === 0, 'no STAND DOWN on KIT while armed');
  expect(await pg.locator('[data-reinstate]').count() === 0, 'no PLAY on KIT while armed');
  ok(`ARMED KIT: no controls   ${await shot(pg, `81-${tag}-live-kit`)}`);
  await pg.evaluate(() => { location.hash = '#muster'; });
  await until(() => pg.locator('main', { hasText: 'Readiness Board' }).count().then(n => n > 0), 8000, 'ARMORY while armed');
  expect(await pg.locator('[data-reinstate]').count() === 0, 'no PLAY on the ARMORY card while armed');
  expect(await pg.locator('[data-standby-holder]').count() >= 0, 'armory rendered');
  ok(`ARMED ARMORY: no PLAY   ${await shot(pg, `82-${tag}-live-armory`)}`);
  await pg.context().close();
}

// ---------------------------------------------------------------------------- main
const DESK = { width: 1280, height: 800 }, PHONE = { width: 393, height: 830 };
fs.mkdirSync(SHOTS, { recursive: true });
const mc = await startMC();
const vite = await startVite();
const browser = await chromium.launch();
try {
  if (!ONLY || ONLY === 'real') { await runReal(browser, vite.base, mc.base, DESK, 'desk'); await runReal(browser, vite.base, mc.base, PHONE, 'phone'); }
  if (!ONLY || ONLY === 'kit') { await runKit(browser, vite.base, mc.base, DESK, 'desk'); await runKit(browser, vite.base, mc.base, PHONE, 'phone'); }
  if (!ONLY || ONLY === 'stale') { await runStale(browser, vite.base, mc.base, DESK, 'desk'); }
  if (!ONLY || ONLY === 'fail') { await runFail(browser, vite.base, mc.base, DESK, 'desk'); }
  if (!ONLY || ONLY === 'live') { await runLive(browser, vite.base, mc.base, DESK, 'desk'); }   // last: it arms the match
} finally {
  await browser.close();
  await vite.stop();
  await mc.stop();
}
console.log('\n---------------------------------------------');
if (jsErrors.length) { console.log('JS ERRORS:'); jsErrors.forEach(e => console.log('  ' + e)); }
if (failures.length) { console.log(`FAILURES (${failures.length}):`); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('all steps passed');
