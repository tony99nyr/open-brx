// F178 — the LOBBY "· N UPDATING" tag, in a real browser against a real demo MC.
//
// READY stays the player's intent, and `lobby.updating` (state.py `_updating`) counts the READY
// players whose gun has not answered the head MC pushed. The header names them in amber beside the
// READY count. Until this script, only jsdom covered the tag (`test/lobby-updating.test.tsx`), and
// jsdom cannot see a colour or a layout. The visual QA of 2026-09-23 listed it as uncovered.
//
//   node test/e2e/lobby-updating.mjs             # everything (~20 s)
//   ONLY=real|stale|kit node test/e2e/lobby-updating.mjs
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…   # the ports (free ones when unset) and the interpreter
//
// How the state is reached. The demo driver acks a pushed head on its next tick, which is 2 s at
// the default speed: too short a window to assert against. This MC runs at `--demo-speed 0.02`, so a
// tick is 100 s. The demo phones hello, bind and send READY at once, then say nothing more inside
// this run. So every gun reads CLOCK NOT SYNCED, the push goes through the HOST OVERRIDE, and every
// READY player's gun stays un-acked for the whole run. That is the state the tag exists for.
//
// Runs:
//   real   the tag is absent before the push, reads "· 8 UPDATING" in amber after it, and follows the
//          server when one player drops their READY ("· 7 UPDATING"; that row is NOT READY and first).
//   stale  the same server, with `lobby.updating` stripped from REST and the WebSocket (an older MC):
//          no tag, no crash, the READY count intact.
//   kit    KIT at 900 px: the roster strip overflows, and the ScrollX hint says so (M18).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython } from './python-path.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));      // webapp/mc/test/e2e
const MC_DIR = path.resolve(HERE, '../..');                     // webapp/mc
const REPO = path.resolve(MC_DIR, '../..');
const SHOTS = path.join(HERE, 'shots', 'lobby-updating');       // this script's own folder
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
// Node skips 'exit' handlers on a signal, and test-all SIGTERMs a job that times out: turn it into an exit.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(1));
const killGroup = proc => new Promise(done => {
  let settled = false; const finish = () => { if (!settled) { settled = true; done(); } };
  if (proc.exitCode != null) return finish();
  proc.once('exit', finish);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* gone */ } }
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } finish(); }, 3000).unref();
});
/** The console's amber, read from the token file, so a retuned palette does not break this test. */
const WARN_HEX = /warn:\s*'(#[0-9a-f]{6})'/i.exec(fs.readFileSync(path.join(MC_DIR, 'src/tokens.ts'), 'utf8'))?.[1];
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

async function startMC(port, wsPort) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) { console.error(`SOMETHING ALREADY SERVES :${port}. Refusing to drive a server this run did not start.`); process.exit(3); }
  } catch { /* free: good */ }
  const proc = spawn(findPython(REPO), ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(port), '--ws-port', String(wsPort),
    '--demo', '--fake-net', '--no-auth', '--ephemeral', '--demo-speed', '0.02', '--advertise', '127.0.0.1'], {
    cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { ...process.env, PYTHONPATH: [path.join(REPO, 'mcp'), process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter) },
  });
  spawned.add(proc);
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`${base}/api/state`); if (r.ok) break; } catch { /* not yet */ }
    if (proc.exitCode != null) { console.error(`MC DIED:\n${log}`); process.exit(3); }
    await new Promise(r => setTimeout(r, 100));
  }
  const who = await (await fetch(`${base}/api/state`)).json();
  if (proc.exitCode != null || /address already in use|Errno 98/i.test(log)) { console.error(`OUR MC FAILED TO BIND :${port}:\n${log}`); process.exit(3); }
  if (who?.lan?.port !== port) { console.error(`:${port} reports lan.port ${who?.lan?.port}`); await killGroup(proc); process.exit(3); }
  if (!('updating' in (who.lobby ?? {}))) { console.error('the MC that answered has no `lobby.updating`: not this tree\'s server?'); await killGroup(proc); process.exit(3); }
  console.log(`  MC: ${base} (demo + fake-net at speed 0.02, ephemeral, ${who.players?.length ?? 0} players)`);
  return { base, stop: () => killGroup(proc) };
}
async function startVite(port, mcPort) {
  const proc = spawn(process.execPath, [path.join(MC_DIR, 'node_modules/vite/bin/vite.js'), '--config', path.join(HERE, 'vite.proxy.config.mjs'), '--port', String(port), '--strictPort'],
    { cwd: MC_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, MC_PROXY_PORT: String(mcPort) } });
  spawned.add(proc);
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.error(`vite did not start:\n${log}`); await killGroup(proc); throw new Error('vite did not start');
}

const jsErrors = [];
async function newPage(browser, vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => jsErrors.push(`[${step}] [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') jsErrors.push(`[${step}] [console] ${m.text().slice(0, 300)}`); });
  return pg;
}
const shot = async (pg, name) => {
  await pg.evaluate(() => { window.scrollTo(0, 0); document.querySelector('main')?.scrollTo(0, 0); }).catch(() => {});
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f, fullPage: false });
  return f;
};
const server = async base => (await fetch(`${base}/api/state`)).json();
const post = (base, p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const onLobby = pg => pg.locator('main', { hasText: '[ A5 // LOBBY' }).count().then(n => n > 0);
const tag = pg => pg.locator('header [data-updating="1"], main [data-updating="1"]');
const noCrash = async (pg, where) => expect(await pg.locator('text=CONSOLE ERROR').count() === 0, `no crash boundary (${where})`);
async function open(pg, url, isThere, where) {
  await pg.goto(url, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 15000, 'the first snapshot');
  await until(() => isThere(pg), 10000, where);
}
/** Rewrite every pushed snapshot on its way to the page (REST alone would be a lie: skill §3.3). */
async function stripSnapshots(pg, fn, onWs = () => {}) {
  await pg.route('**/api/state', async route => {
    const r = await route.fetch(); const s = await r.json();
    await route.fulfill({ response: r, json: fn(s) });
  });
  await pg.routeWebSocket(/\/ui-ws/, ws => {
    const srv = ws.connectToServer();
    ws.onMessage(m => srv.send(m));
    srv.onMessage(m => {
      try {
        const msg = JSON.parse(String(m));
        if (msg.kind === 'snapshot' && msg.state) { msg.state = fn(msg.state); onWs(); ws.send(JSON.stringify(msg)); return; }
      } catch { /* not JSON: pass it through */ }
      ws.send(m);
    });
  });
}

async function runReal(browser, viteBase, mcBase) {
  step = 'real'; stepFailedAt = failures.length;
  console.log(`\n[${step}] push over the unsynced guns, then read the UPDATING tag, 1280x800`);
  const pg = await newPage(browser, { width: 1280, height: 800 });
  await open(pg, `${viteBase}/#lobby`, onLobby, 'the LOBBY');
  await until(async () => (await server(mcBase)).players.every(p => p.ready), 10000, 'every demo player READY');
  let st = await server(mcBase);
  const n = st.players.length;
  expect(!st.lobby.pushed && (st.lobby.updating ?? 0) === 0, `control: nothing pushed, nobody updating (saw pushed=${st.lobby.pushed} updating=${st.lobby.updating})`);
  expect(await tag(pg).count() === 0, 'no UPDATING tag before the push');
  // The primary is disabled over CLOCK NOT SYNCED; the HOST OVERRIDE is the push a host would use here.
  const override = pg.locator('main [data-override="1"] button');
  await until(() => override.isEnabled(), 8000, 'the HOST OVERRIDE push');
  await override.click();
  await until(async () => (await server(mcBase)).lobby.pushed === true, 10000, 'the push to land on the server');
  st = await server(mcBase);
  expect(st.lobby.updating === n, `control: the server counts all ${n} READY players as updating (saw ${st.lobby.updating})`);
  await until(() => tag(pg).isVisible(), 8000, 'the UPDATING tag');
  const text = (await tag(pg).innerText()).replace(/\s+/g, ' ').trim();
  expect(text === `· ${n} UPDATING`, `the tag reads "· ${n} UPDATING" (saw ${JSON.stringify(text)})`);
  const color = await tag(pg).evaluate(el => getComputedStyle(el).color);
  expect(color === rgb(WARN_HEX), `the tag is amber ${rgb(WARN_HEX)} (saw ${color})`);
  const fontPx = await tag(pg).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(fontPx >= 11, `the tag is readable (${fontPx}px)`);
  const header = (await pg.locator('main').first().innerText()).replace(/\s+/g, ' ');
  expect(header.includes(`${n}/${n} READY`), `the READY count keeps the intent (${n}/${n} READY)`);
  ok(`"${text}" in ${color} beside ${n}/${n} READY   ${await shot(pg, '10-updating-all')}`);

  // One player drops READY: the tag follows the server, and that row leads its column in amber.
  const drop = st.players[st.players.length - 1];
  await post(mcBase, `/api/players/${drop.player_id}/ready`, { ready: false });
  await until(async () => (await tag(pg).innerText()).includes(`${n - 1} UPDATING`), 8000, `the tag to read ${n - 1} UPDATING`);
  expect((await tag(pg).innerText()).replace(/\s+/g, ' ').trim() === `· ${n - 1} UPDATING`, `the tag follows the server to ${n - 1}`);
  const notReady = pg.locator('main [data-ready-tag="not-ready"]');
  expect(await notReady.count() === 1, `exactly one NOT READY row (saw ${await notReady.count()})`);
  const nrColor = await notReady.first().locator('span').first().evaluate(el => getComputedStyle(el).color);
  expect(nrColor === rgb(WARN_HEX), `NOT READY is amber (saw ${nrColor})`);
  const leads = await notReady.first().evaluate(el => {
    const col = el.closest('[draggable]')?.parentElement;
    return col?.querySelector('[data-ready-tag]') === el;
  });
  expect(leads, `${drop.display}'s NOT READY row is first in its column`);
  ok(`"· ${n - 1} UPDATING", ${drop.display} NOT READY and first   ${await shot(pg, '11-updating-one-dropped')}`);
  await noCrash(pg, 'real');
  await pg.context().close();
}

async function runStale(browser, viteBase, mcBase) {
  step = 'stale'; stepFailedAt = failures.length;
  console.log(`\n[${step}] the same pushed lobby with \`lobby.updating\` stripped from REST and the WebSocket`);
  // ONLY=stale starts from a fresh server: push the same way the real run does, over the API
  if (!(await server(mcBase)).lobby.pushed) await post(mcBase, '/api/lobby/push', { force: true });
  await until(async () => (await server(mcBase)).lobby.pushed === true, 10000, 'a pushed lobby');
  const st = await server(mcBase);
  expect((st.lobby.updating ?? 0) > 0, `control: the real server still says ${st.lobby.updating} updating`);
  const pg = await newPage(browser, { width: 1280, height: 800 });
  let seen = 0;
  await stripSnapshots(pg, s => { const { updating: _drop, ...lobby } = s.lobby ?? {}; return { ...s, lobby }; }, () => { seen++; });
  await open(pg, `${viteBase}/#lobby`, onLobby, 'the LOBBY on an older server');
  // this slow demo only pushes a snapshot on a change: make one, so the WebSocket strip is exercised too
  for (const p of st.players.filter(x => !x.ready)) await post(mcBase, `/api/players/${p.player_id}/ready`, { ready: true });
  await until(async () => seen > 0, 8000, 'a stripped WebSocket snapshot');
  const after = await server(mcBase);
  expect((after.lobby.updating ?? 0) > 0, `control: the real server says ${after.lobby.updating} updating`);
  const nReady = after.players.filter(p => p.ready).length;
  await until(async () => (await pg.locator('main').first().innerText()).replace(/\s+/g, ' ').includes(`${nReady}/${after.players.length} READY`), 8000, 'the new READY count');
  expect(await tag(pg).count() === 0, 'no UPDATING tag when the server sends no `updating`');
  const body = (await pg.locator('main').first().innerText()).replace(/\s+/g, ' ');
  expect(body.includes(`${nReady}/${after.players.length} READY`), `the READY count is intact (${nReady}/${after.players.length})`);
  await noCrash(pg, 'stale');
  ok(`no tag, ${nReady}/${after.players.length} READY, ${seen} stripped WebSocket snapshots   ${await shot(pg, '20-stale')}`);
  await pg.context().close();
}

async function runKit(browser, viteBase) {
  step = 'kit'; stepFailedAt = failures.length;
  console.log(`\n[${step}] KIT at 900x900: the roster strip says it scrolls (M18)`);
  const pg = await newPage(browser, { width: 900, height: 900 });
  await open(pg, `${viteBase}/#kit`, p => p.locator('main', { hasText: '[ A3 // KIT-OUT ]' }).count().then(n => n > 0), 'KIT');
  await until(() => pg.locator('main .kit-roster-rows .kit-row').count().then(n => n > 4), 8000, 'the roster rows');
  const m = await pg.locator('main .kit-roster-rows').evaluate(el => {
    const box = el.parentElement; const hint = box.previousElementSibling;
    const vis = r => r.right > box.getBoundingClientRect().left && r.left < box.getBoundingClientRect().right;
    return { over: box.scrollWidth > box.clientWidth, shown: Array.from(el.querySelectorAll('.kit-row')).filter(r => vis(r.getBoundingClientRect())).length,
             total: el.querySelectorAll('.kit-row').length, hint: hint?.getAttribute('data-scroll-hint'), hidden: hint?.hidden, text: hint?.textContent,
             pageOver: document.documentElement.scrollWidth > window.innerWidth };
  });
  expect(m.over, 'control: at 900 px the strip really overflows');
  expect(m.hint === '1' && m.hidden === false, `the scroll hint is visible (hint=${m.hint} hidden=${m.hidden})`);
  expect(m.text === `▸ SCROLL FOR ALL ${m.total} PLAYERS`, `the hint names the roster (saw ${JSON.stringify(m.text)})`);
  expect(!m.pageOver, 'the page itself does not scroll sideways');
  ok(`${m.shown} of ${m.total} rows in view, hint "${m.text}"   ${await shot(pg, '30-kit-900')}`);
  await pg.context().close();
}

// ---------------------------------------------------------------------------- main
fs.mkdirSync(SHOTS, { recursive: true });
if (!WARN_HEX) { console.error('could not read T.warn from src/tokens.ts'); process.exit(3); }
const MC_PORT = Number(process.env.MC_PORT || await freePort());
const MC_WS_PORT = Number(process.env.MC_WS_PORT || await freePort());
const VITE_PORT = Number(process.env.VITE_PORT || await freePort());
const mc = await startMC(MC_PORT, MC_WS_PORT);
let vite = null, browser = null;
try {
  vite = await startVite(VITE_PORT, MC_PORT);
  browser = await chromium.launch();
  if (!ONLY || ONLY === 'real') await runReal(browser, vite.base, mc.base);
  if (!ONLY || ONLY === 'stale') await runStale(browser, vite.base, mc.base);
  if (!ONLY || ONLY === 'kit') await runKit(browser, vite.base);
} catch (e) {
  failures.push(`${step}: threw ${e?.stack ?? e}`);
} finally {
  await browser?.close().catch(() => {});
  await vite?.stop();
  await mc.stop();
}
console.log('\n---------------------------------------------');
if (jsErrors.length) { console.log('JS ERRORS:'); jsErrors.forEach(e => console.log('  ' + e)); }
if (failures.length || jsErrors.length) { console.log(`FAILURES (${failures.length}):`); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('all steps passed');
