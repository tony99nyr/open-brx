// The LIVE board and the spectator board, in a real browser against a real MC with real node sockets.
//
// Visual QA 2026-09-23 (lane B1) found the board untested on the paths an operator actually hits:
//   koth      the KOTH headline was the KILL score ("BLUE -1") and LIVE had no hill panel (H2)
//   stale     a node that goes quiet and comes back, and rows MC has never heard, which read
//             "LAST KNOWN · 11d13h AGO" (H3)
//   order     rows re-sorted under the pointer on every update (M6)
//   names     a 24-character name ran under K and D (M8); the row toggle was 18 px tall (M5)
//   offline   MC offline: rows read ALIVE, END and RECALL stayed enabled (M7)
//   old-server  the same board with `live.possession` stripped from REST AND the socket
//
// The server is `python -m brx_mcp.mc --demo` WITHOUT `--fake-net`, so the node socket is real, and two
// `MockNode`s (test/e2e/live_nodes.py) stand in for two phones. The other six demo players have no phone
// at all, which is exactly what an MC restart mid-match looks like to the board.
//
//   node test/e2e/live-board.mjs
//   ONLY=stale node test/e2e/live-board.mjs        # one step (every step self-navigates)
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…     # move the ports / pick the interpreter
//
// Ports come from the env (`scripts/test-all.mjs` passes free ones), else free ones of its own.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { findPython } from './python-path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC_DIR = path.resolve(HERE, '../..');
const REPO = path.resolve(MC_DIR, '../..');
const SHOTS = path.join(HERE, 'shots', 'live-board');   // one folder per script
// test-all passes free ports; a manual run picks its own, never a literal (polish round 1)
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer(); srv.unref(); srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
const MC_PORT = Number(process.env.MC_PORT || await freePort());
const MC_WS_PORT = Number(process.env.MC_WS_PORT || await freePort());
const VITE_PORT = Number(process.env.VITE_PORT || await freePort());
const ONLY = process.env.ONLY || '';
// A test run never writes into the operator's real `~/.brx-mcp`: one temp home per run, removed at the end.
const MC_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-live-board-home-'));
const LONG = 'CAPTAINTHUNDERSTRIKE9000';   // 24 characters (the most the server allows) and no break point

let failures = [], step = '';
const expect = (cond, what) => { if (cond) { console.log(`    ✓ ${what}`); return true; } failures.push(`${step}: ${what}`); console.log(`    ✗ ${what}`); return false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** wait for a condition, never a fixed sleep: under a parallel run a sleep races */
const until = async (pred, ms) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = false;
    try { v = await pred(); } catch { v = false; }
    if (v) return true;
    if (Date.now() > end) return false;
    await sleep(100);
  }
};

const spawned = new Set();
process.on('exit', () => {
  for (const p of spawned) { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } }
  try { fs.rmSync(MC_HOME, { recursive: true, force: true }); } catch { /* best effort */ }
});
const killGroup = proc => new Promise(done => {
  spawned.delete(proc);
  let settled = false; const finish = () => { if (!settled) { settled = true; done(); } };
  if (proc.exitCode != null) return finish();
  proc.once('exit', finish);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* gone */ } }
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } finish(); }, 3000).unref();
});

async function startMC() {
  const py = findPython(REPO);
  try {
    const r = await fetch(`http://127.0.0.1:${MC_PORT}/api/state`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) { console.error(`SOMETHING ALREADY SERVES :${MC_PORT} — refusing to drive a server this run did not start.`); process.exit(3); }
  } catch { /* free: good */ }
  const proc = spawn(py, ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(MC_PORT), '--ws-port', String(MC_WS_PORT),
    '--demo', '--no-auth', '--ephemeral'], { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { ...process.env, BRX_MCP_HOME: MC_HOME } });
  spawned.add(proc);
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${MC_PORT}`;
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`${base}/api/state`);
      if (r.ok) {
        // prove the process answering is OURS: it advertises the per-run node socket port
        const s = await r.json();
        if (!String(s?.lan?.ws_url || '').includes(`:${MC_WS_PORT}/`)) { console.error(`:${MC_PORT} is not the MC we launched`); await killGroup(proc); process.exit(3); }
        console.log(`  mc: ${base} (node socket ${s.lan.ws_url})`);
        return { base, wsUrl: s.lan.ws_url, stop: () => killGroup(proc), log: () => log };
      }
    } catch { /* not yet */ }
    if (proc.exitCode != null) { console.error(`MC DIED:\n${log}`); process.exit(3); }
    await sleep(100);
  }
  console.error(`MC did not start:\n${log}`); await killGroup(proc); process.exit(3);
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
    await sleep(100);
  }
  console.error(`vite did not start:\n${log}`); await killGroup(proc); process.exit(3);
}

/** Two phone stand-ins on MC's real node socket, driven one line at a time (live_nodes.py). */
async function startNodes(wsUrl, guns) {
  const proc = spawn(findPython(REPO), [path.join(HERE, 'live_nodes.py'), wsUrl, ...guns],
    { cwd: path.join(REPO, 'mcp'), stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { ...process.env, BRX_MCP_HOME: MC_HOME } });
  spawned.add(proc);
  let err = ''; proc.stderr.on('data', d => { err += d; });
  const lines = [];
  let wake = null;
  readline.createInterface({ input: proc.stdout }).on('line', l => { lines.push(l); if (wake) wake(); });
  const next = async (re, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = lines.findIndex(l => re.test(l));
      if (i >= 0) return lines.splice(i, 1)[0];
      if (lines.some(l => l.startsWith('err '))) throw new Error(`live_nodes: ${lines.find(l => l.startsWith('err '))}`);
      if (Date.now() > end || proc.exitCode != null) throw new Error(`live_nodes: no ${re} (stderr: ${err.slice(-400)})`);
      await new Promise(r => { wake = r; setTimeout(r, 200); });
    }
  };
  for (const g of guns) await next(new RegExp(`^ready ${g.split(':')[0]} `));
  const cmd = async line => { proc.stdin.write(`${line}\n`); return next(new RegExp(`^ok ${line.split(' ')[0]} `)); };
  return { cmd, stop: async () => { try { proc.stdin.write('quit\n'); } catch { /* gone */ } await until(() => proc.exitCode != null, 3000); await killGroup(proc); } };
}

const api = base => ({
  get: async p => (await fetch(`${base}${p}`)).json(),
  send: async (method, p, body) => {
    const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  },
});

/** A koth game with a long name on the roster, walked to LIVE over the operator's own REST API. */
async function setUpMatch(mc) {
  const a = api(mc.base);
  let r = await a.send('PUT', '/api/config', { mode: 'koth', time_limit_s: 600 });
  if (r.status >= 400) throw new Error(`koth refused: ${JSON.stringify(r.body)}`);
  let s = await a.get('/api/state');
  const teams = s.config.teams.map(t => t.team_id);
  for (const [i, p] of s.players.entries()) await a.send('PATCH', `/api/players/${p.player_id}`, { team_id: teams[i % teams.length] });
  const longP = s.players.find(p => p.gun_id === 'GUN-H');
  r = await a.send('PATCH', `/api/players/${longP.player_id}`, { display: LONG });
  if (r.status >= 400) throw new Error(`rename refused: ${JSON.stringify(r.body)}`);
  const nodes = await startNodes(mc.wsUrl, ['GUN-A:3D4F', 'GUN-B:3E60']);
  if (!(await until(async () => (await a.get('/api/state')).nodes.filter(n => n.player_id).length >= 2, 10000))) throw new Error('the two nodes never bound');
  s = await a.get('/api/state');
  if (s.phase !== 'lobby') await a.send('POST', '/api/phase', { phase: 'lobby', force: true });
  r = await a.send('POST', '/api/lobby/push', { force: true });
  if (r.status >= 400) throw new Error(`push refused: ${JSON.stringify(r.body)}`);
  r = await a.send('POST', '/api/start', { runway_s: 0, force: true });
  if (r.status >= 400) throw new Error(`start refused: ${JSON.stringify(r.body)}`);
  if (!(await until(async () => (s = await a.get('/api/state')).phase === 'live', 20000))) throw new Error(`never went live (${s.phase})`);
  const byGun = g => s.players.find(p => p.gun_id === g);
  return { nodes, s, reaper: byGun('GUN-A'), viper: byGun('GUN-B'), longP: byGun('GUN-H') };
}

const IGNORED = /Failed to load resource|WebSocket connection to .* failed/;   // the offline step closes the socket on purpose
const jsErrors = [];
async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(5000);     // a missing element fails its step in seconds, not after 30 s
  const pg = await ctx.newPage();
  pg.on('pageerror', e => jsErrors.push(`[${step}] [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') jsErrors.push(`[${step}] [console] ${m.text().slice(0, 300)}`); });
  return pg;
}
const shot = async (pg, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f, fullPage: false });
  console.log(`      shot ${f}`);
};
async function openLive(pg) {
  await pg.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('[data-live-row]').count().then(n => n > 0), 10000);
  // the console follows the phase to LIVE on its own; if it did not, the nav entry is "<n> MATCH"
  if (await pg.locator('[data-live-row]').count() === 0) {
    const nav = pg.locator('button', { hasText: /^\d+ MATCH$/ });
    if (await nav.count()) await nav.first().click();
  }
  return until(() => pg.locator('[data-live-row]').count().then(n => n > 0), 10000);
}
const cellText = (pg, pid, cell) => pg.locator(`[data-live-row="${pid}"] [data-cell="${cell}"]`).innerText().then(t => t.replace(/\s+/g, ' ').trim()).catch(() => '');

/** Rewrite every snapshot the page receives, REST and the socket (koth.mjs `patchSnapshots`). */
async function patchSnapshots(pg, patch) {
  const apply = body => {
    const o = JSON.parse(body);
    const st = typeof o?.phase === 'string' ? o : (o?.kind === 'snapshot' && typeof o.state?.phase === 'string') ? o.state : null;
    if (!st) return null;
    patch(st);
    return JSON.stringify(o);
  };
  const seen = { rest: 0, ws: 0 };
  await pg.route('**/api/state', async r => {
    const res = await r.fetch(); let body = await res.text();
    try { const out = apply(body); if (out !== null) { body = out; seen.rest++; } } catch { /* not json */ }
    await r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-length': String(Buffer.byteLength(body)) } });
  });
  await pg.routeWebSocket('**/ui-ws*', ws => {
    const s = ws.connectToServer();
    s.onMessage(m => { let out = null; try { out = apply(m.toString()); } catch { out = null; } if (out === null) ws.send(m); else { seen.ws++; ws.send(out); } });
    ws.onMessage(m => s.send(m));
  });
  return seen;
}

const mc = await startMC();
const vite = await startVite();
let browser = null, nodes = null;
/** One step: skipped unless ONLY names it, and a throw fails THIS step only, so the next still runs. */
async function runStep(name, fn) {
  if (ONLY && ONLY !== name) return;
  step = name;
  try { await fn(); } catch (e) { failures.push(`${name}: threw ${e?.message || e}`); console.log(`    ✗ threw ${e?.message || e}`); }
}
try {
  const m = await setUpMatch(mc);
  nodes = m.nodes;
  const { reaper, viper, longP } = m;
  const tid = Object.fromEntries(m.s.config.teams.map(t => [t.team_id, t.tid]));
  const [T1, T2] = m.s.config.teams.map(t => t.team_id);
  console.log(`  live: ${m.s.live.match_id}; phones on ${reaper.display} (${T1}) and ${viper.display} (${T2})`);
  browser = await chromium.launch();

  await runStep('koth', async () => {
    console.log(`\n[${step}] the KOTH headline is possession, and LIVE has a hill panel`);
    const pg = await newPage(browser, { width: 1280, height: 800 });
    expect(await openLive(pg), 'the LIVE board renders');
    const score = id => pg.locator(`[data-team-score="${id}"]`).innerText().then(t => t.replace(/\s+/g, '')).catch(() => '');
    expect(await score(T1) === '—', `before any report, ${T1.toUpperCase()}'s headline is a dash, not a kill score (saw "${await score(T1)}")`);
    const panel = pg.getByTestId('hill-panel');
    expect(await panel.isVisible().catch(() => false), 'the hill panel is on the LIVE board');
    expect((await panel.innerText().catch(() => '')).includes('NO PHONE HAS REPORTED POSSESSION YET'), 'and it says no phone has reported possession');
    await nodes.cmd(`possession GUN-A ${tid[T1]}=214000,${tid[T2]}=131000 441000`);
    const moved = await until(async () => (await score(T1)) === '3:34' && (await score(T2)) === '2:11', 8000);
    expect(moved, `a real possession fact makes the headline ${T1.toUpperCase()} 3:34 · ${T2.toUpperCase()} 2:11 (saw "${await score(T1)}" / "${await score(T2)}")`);
    const ptext = await panel.innerText().catch(() => '');
    expect(/HILL \/\/ POSSESSION/.test(ptext) && ptext.includes('3:34') && ptext.includes('2:11'), 'the hill panel shows each team\'s held time');
    expect(ptext.includes('OWNER NOT REPORTED LIVE'), 'a grenade hill\'s owner is said to be unknown, not guessed');
    expect(ptext.includes('BEST COVERAGE 7:21 OF 10:00'), 'and the coverage floor is on it');
    const subs = await pg.locator('[data-team-sub]').allInnerTexts();
    expect(subs.length === 2 && subs.every(t => /^KILLS -?\d+$/.test(t.trim())), `the kill score is still there as a sub-line (${subs.join(' | ')})`);
    await shot(pg, 'koth-live-1280');

    const sp = await newPage(browser, { width: 1280, height: 800 });
    await sp.goto(`http://localhost:${VITE_PORT}/#spectate`, { waitUntil: 'domcontentloaded' });
    await until(() => sp.locator('[data-spectate="score"]').count().then(n => n === 2), 10000);
    const big = (await sp.locator('[data-spectate="score"]').allInnerTexts()).map(t => t.replace(/\s+/g, ''));
    expect(big[0] === '3:34' && big[1] === '2:11', `SPECTATE headlines held time too (saw ${JSON.stringify(big)})`);
    const hill = await sp.locator('[data-spectate="hill"]').innerText().catch(() => '');
    expect(hill.includes('HILL') && hill.includes('BEST COVERAGE 7:21'), `SPECTATE has the hill line ("${hill}")`);
    await shot(sp, 'koth-spectate-1280');
    await sp.context().close();
    await pg.context().close();
  });

  await runStep('stale', async () => {
    console.log(`\n[${step}] rows never heard, and a real node that goes quiet and comes back`);
    const pg = await newPage(browser, { width: 1280, height: 800 });
    expect(await openLive(pg), 'the LIVE board renders');
    const body = await pg.locator('.screen').innerText();
    expect(!/\d+d\d{2}h/.test(body), `no row prints the never-heard sentinel as an age (${(body.match(/\d+d\d{2}h[^\n]*/) || ['none'])[0]})`);
    expect(await cellText(pg, longP.player_id, 'status') === 'NOT HEARD', `a player with no phone reads NOT HEARD (saw "${await cellText(pg, longP.player_id, 'status')}")`);
    expect(await cellText(pg, longP.player_id, 'sync') === '—', 'and prints no age');
    expect(await until(async () => (await cellText(pg, reaper.player_id, 'status')) === 'ALIVE', 6000), `${reaper.display}'s phone is talking: ALIVE`);
    await nodes.cmd('drop GUN-A');
    const quiet = await until(async () => (await cellText(pg, reaper.player_id, 'status')) === 'LAST KNOWN', 20000);
    const age = await cellText(pg, reaper.player_id, 'sync');
    expect(quiet && /^\d+s AGO$/.test(age), `after the phone drops, the row reads LAST KNOWN with a real age (saw "${await cellText(pg, reaper.player_id, 'status')}" "${age}")`);
    await shot(pg, 'stale-dropped-1280');
    await nodes.cmd('up GUN-A');
    expect(await until(async () => (await cellText(pg, reaper.player_id, 'status')) === 'ALIVE', 10000), 'when it comes back, the row reads ALIVE again');
    await pg.context().close();
  });

  await runStep('order', async () => {
    console.log(`\n[${step}] the rows hold still under the pointer`);
    const pg = await newPage(browser, { width: 1280, height: 800 });
    expect(await openLive(pg), 'the LIVE board renders');
    const order = () => pg.locator('[data-live-row]').evaluateAll(els => els.map(e => e.getAttribute('data-live-row')));
    const before = await order();
    // the pointer rests on the LAST row, the one the kill below will lift to the top
    const target = before[before.length - 1];
    const who = m.s.players.find(p => p.player_id === target);
    await pg.locator(`[data-live-row="${target}"] [data-cell="acc"]`).hover();
    const kBefore = await pg.locator(`[data-live-row="${target}"] [data-cell="k"]`).textContent();
    // the player on the last row gets a kill: a phone on the OTHER team reports dying to them (a
    // same-team death would be a team kill, which costs a kill instead)
    const victim = who.team_id === reaper.team_id ? 'GUN-B' : 'GUN-A';
    await nodes.cmd(`die ${victim} ${who.player_num} ${tid[who.team_id]}`);
    const scored = await until(async () => (await api(mc.base).get('/api/state')).live.rows[0].player_id === target, 8000);
    expect(scored, `control: MC now ranks ${who.display} first`);
    // wait for the PAGE to have the new snapshot (the target's own K moved on screen), not a fixed time
    expect(await until(async () => (await pg.locator(`[data-live-row="${target}"] [data-cell="k"]`).textContent()) !== kBefore, 8000),
      'control: the board received the kill');
    expect(JSON.stringify(await order()) === JSON.stringify(before), 'with the pointer on the board, the rows did not move');
    expect(await pg.getByTestId('order-held').isVisible().catch(() => false), 'and the board says the order is held');
    await shot(pg, 'order-held-1280');
    await pg.mouse.move(5, 790);
    expect(await until(async () => (await order())[0] === target, 4000), 'moving the pointer off the board re-sorts it');
    await pg.context().close();
  });

  await runStep('names', async () => {
    console.log(`\n[${step}] a 24-character name stays in its column; every toggle is a 36 px target`);
    for (const width of [1440, 1280, 900]) {
      const pg = await newPage(browser, { width, height: 800 });
      expect(await openLive(pg), `the LIVE board renders at ${width}`);
      const g = await pg.locator(`[data-live-row="${longP.player_id}"]`).evaluate(row => {
        const nm = row.querySelector('[data-row-name]') || row.querySelector('[data-live-row-toggle]');
        const k = row.querySelector('[data-cell="k"]');
        const btn = row.querySelector('[data-live-row-toggle]');
        const n = nm.getBoundingClientRect(), kr = k.getBoundingClientRect();
        return { nameRight: Math.round(n.right), kLeft: Math.round(kr.left), clipped: nm.scrollWidth > nm.clientWidth + 1,
                 title: btn.getAttribute('title') || '', text: nm.textContent };
      });
      expect(g.nameRight <= g.kLeft, `at ${width}: the name ends before K (name right ${g.nameRight}, K left ${g.kLeft})`);
      expect(g.text.includes(LONG) && g.title.includes(LONG), `at ${width}: the full name is in the DOM and on the title`);
      if (width === 900) expect(g.clipped, 'at 900: the name is visibly cut (an ellipsis), not squeezed under K');
      const heights = await pg.locator('[data-live-row-toggle]').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
      expect(heights.length > 0 && heights.every(h => h >= 36), `at ${width}: every operator-menu toggle is at least 36 px tall (${[...new Set(heights)].join(', ')} px)`);
      expect(!(await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `at ${width}: no sideways page scroll`);
      await shot(pg, `names-${width}`);
      await pg.context().close();
    }
  });

  await runStep('offline', async () => {
    console.log(`\n[${step}] MC goes offline under an open board`);
    const pg = await newPage(browser, { width: 1280, height: 800 });
    let cut = false;
    const sockets = [];
    await pg.routeWebSocket('**/ui-ws*', ws => {
      if (cut) { ws.close(); return; }
      const s = ws.connectToServer();
      sockets.push({ ws, s });
      s.onMessage(msg => ws.send(msg)); ws.onMessage(msg => s.send(msg));
    });
    expect(await openLive(pg), 'the LIVE board renders');
    const end = pg.locator('button', { hasText: /^END MATCH EARLY$/ });
    expect(await end.isEnabled(), 'control: online, END MATCH EARLY is enabled');
    cut = true;
    await pg.route('**/api/**', r => r.abort());
    for (const { ws, s } of sockets) { try { s.close(); } catch { /* */ } try { ws.close(); } catch { /* */ } }
    expect(await until(() => pg.getByTestId('live-offline').isVisible(), 8000), 'the board says MC is offline');
    const st = await cellText(pg, reaper.player_id, 'status');
    expect(st === 'UNKNOWN', `a row MC was hearing now reads UNKNOWN, not ALIVE (saw "${st}")`);
    expect(await cellText(pg, reaper.player_id, 'sync') === '—', 'and shows no sync age');
    expect(await end.isDisabled(), 'END MATCH EARLY is disabled');
    expect(await pg.locator('button', { hasText: /^RECALL$/ }).isDisabled(), 'RECALL is disabled');
    expect((await pg.getByTestId('controls-offline').innerText()).includes('MC IS OFFLINE'), 'and the reason is on screen');
    await shot(pg, 'offline-1280');
    await pg.context().close();
  });

  await runStep('old-server', async () => {
    console.log(`\n[${step}] a server that sends no live.possession: REST and the socket both stripped`);
    const pg = await newPage(browser, { width: 1280, height: 800 });
    const seen = await patchSnapshots(pg, st => { if (st.live) delete st.live.possession; });
    expect(await openLive(pg), 'the LIVE board renders');
    expect(await until(() => seen.ws > 0, 5000), `the socket snapshots were stripped too (rest ${seen.rest}, ws ${seen.ws})`);
    const t1 = (await pg.locator(`[data-team-score="${T1}"]`).innerText().catch(() => '')).trim();
    expect(t1 === '—', `with no possession field the headline is a dash, never a kill score (saw "${t1}")`);
    expect((await pg.getByTestId('hill-panel').innerText().catch(() => '')).includes('NO PHONE HAS REPORTED'), 'and the hill panel says nothing has been reported');
    await shot(pg, 'old-server-1280');
    await pg.context().close();
  });

  step = 'servers';
  expect(await fetch(`${mc.base}/api/state`).then(r => r.ok).catch(() => false), 'the MC this run started is still up at the end');
  step = 'errors';
  const real = jsErrors.filter(e => !IGNORED.test(e));
  expect(real.length === 0, `no console/page errors (${real.length})`);
  if (real.length) console.log(real.slice(0, 10).join('\n'));
} catch (e) {
  failures.push(`${step}: threw ${e?.stack || e}`);
  console.log(`    ✗ threw ${e?.message || e}`);
} finally {
  if (browser) await browser.close();
  if (nodes) await nodes.stop();
  await vite.stop();
  await mc.stop();
}
console.log(failures.length ? `\nFAILED:\n  ${failures.join('\n  ')}` : '\nALL GOOD');
process.exit(failures.length ? 1 : 0);
