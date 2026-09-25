// Shared plumbing for the session-lifecycle browser suites (recap-next.mjs, mc-restart.mjs, feed-reload.mjs).
//
// Every suite that uses this starts its OWN MC and its OWN vite on free ports (or the ports in MC_PORT,
// MC_WS_PORT and VITE_PORT), writes only under its own output folder, and stops every process it started
// in a `finally`. `BRX_MCP_HOME` points into that folder, so nothing is read from or written to the
// operator's real ~/.brx-mcp, and a restarted MC finds the same session store the first one wrote.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython } from '../python-path.mjs';

export { chromium };
const HERE = path.dirname(fileURLToPath(import.meta.url));      // webapp/mc/test/e2e/lib
export const E2E_DIR = path.resolve(HERE, '..');
export const MC_DIR = path.resolve(E2E_DIR, '../..');
export const REPO = path.resolve(MC_DIR, '../..');

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const freePort = () => new Promise((res, rej) => {
  const s = net.createServer(); s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
export const killGroup = proc => new Promise(done => {
  if (!proc || proc.exitCode != null || proc.signalCode != null) { done(); return; }
  let settled = false; const finish = () => { if (!settled) { settled = true; done(); } };
  proc.once('exit', finish);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* gone */ } }
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } finish(); }, 3000).unref();
});

/** A step-scoped checker: `expect` records a failure against the current step and prints it. */
export function checker() {
  const c = { failures: [], step: '' };
  c.expect = (cond, what) => {
    if (cond) { console.log(`    ✓ ${what}`); return true; }
    c.failures.push(`${c.step}: ${what}`); console.log(`    ✗ ${what}`); return false;
  };
  /** Poll until `pred` is truthy. Never a fixed sleep: under `test:all` load a sleep races. */
  c.until = async (pred, ms, what) => {
    const end = Date.now() + ms;
    for (;;) {
      let v = false; try { v = await pred(); } catch { v = false; }
      if (v) return v;
      if (Date.now() > end) { c.expect(false, `timed out after ${ms} ms waiting for ${what}`); return false; }
      await sleep(100);
    }
  };
  c.done = () => {
    console.log(c.failures.length ? `\nFAILED:\n  ${c.failures.join('\n  ')}` : '\nALL GOOD');
    return c.failures.length ? 1 : 0;
  };
  return c;
}

/** The dev venv (MC_PY, this checkout's, or a worktree's main checkout's): the shared resolver. */
export const devPython = () => findPython(REPO);

/** The ports for one suite run: the env's, else free ones. */
export async function ports() {
  return {
    mc: Number(process.env.MC_PORT) || await freePort(),
    ws: Number(process.env.MC_WS_PORT) || await freePort(),
    vite: Number(process.env.VITE_PORT) || await freePort(),
  };
}

/** Start a demo MC. `sessionFile` makes it persist to (and resume from) that file, which is what a
 *  restart test needs; without one it is `--ephemeral`. `fakeNet: false` gives it a REAL node socket, for a
 *  suite that drives phone or station stand-ins over the wire (`out.wsUrl`). Returns `{ base, proc, stop, log, wsUrl }`. */
export async function startMC({ port, wsPort, home, sessionFile, fakeNet = true, extraArgs = [] }) {
  const base = `http://127.0.0.1:${port}`;
  try {
    const r = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) throw new Error(`SOMETHING ALREADY SERVES :${port}; refusing to drive a server this run did not start`);
  } catch (e) { if (/ALREADY SERVES/.test(String(e))) throw e; }
  fs.mkdirSync(home, { recursive: true });
  const args = ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(port), '--ws-port', String(wsPort),
    '--demo', ...(fakeNet ? ['--fake-net'] : []), '--no-auth', ...(sessionFile ? ['--session-file', sessionFile] : ['--ephemeral']), ...extraArgs];
  const proc = spawn(devPython(), args, { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { ...process.env, BRX_MCP_HOME: home } });
  const out = { base, proc, log: '' };
  proc.stdout.on('data', d => { out.log += d; }); proc.stderr.on('data', d => { out.log += d; });
  out.stop = () => killGroup(proc);
  for (let i = 0; i < 300; i++) {
    try {
      const r = await fetch(`${base}/api/state`);
      if (r.ok) {
        // a real node socket: prove the process answering is OURS, it advertises this run's ws port
        const ws = fakeNet ? null : String((await r.json())?.lan?.ws_url || '');
        if (ws !== null && !ws.includes(`:${wsPort}/`)) { await killGroup(proc); throw new Error(`:${port} is not the MC this run launched (${ws})`); }
        out.wsUrl = ws;
        console.log(`  mc: ${base} (pid ${proc.pid})`); return out;
      }
    } catch (e) { if (/not the MC this run/.test(String(e))) throw e; /* not yet */ }
    if (proc.exitCode != null) throw new Error(`MC DIED:\n${out.log}`);
    await sleep(100);
  }
  await killGroup(proc);
  throw new Error(`MC did not start:\n${out.log}`);
}

/** A vite dev server proxying /api and /ui-ws to the given MC port. It serves `src` directly, so there
 *  is no built bundle that could be stale. */
export async function startVite({ port, mcPort }) {
  const proc = spawn(process.execPath, [path.join(MC_DIR, 'node_modules/vite/bin/vite.js'), '--config',
    path.join(E2E_DIR, 'vite.proxy.config.mjs'), '--port', String(port), '--strictPort'],
    { cwd: MC_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, MC_PROXY_PORT: String(mcPort) } });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite: ${base} (pid ${proc.pid})`); return { base, proc, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await sleep(100);
  }
  await killGroup(proc);
  throw new Error(`vite did not start:\n${log}`);
}

export const api = base => ({
  get: async p => (await fetch(`${base}${p}`)).json(),
  post: async (p, body) => {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  },
});

/** Walk a fresh demo session to LIVE over MC's own REST API (see end-delivery.mjs for why each step is
 *  the way it is: a `--fake-net` node never echoes a gun ack, so the push and the whistle need the host
 *  override). THROWS on a refusal so the caller's `finally` stops the servers. */
export async function startAMatch(base) {
  const { get, post } = api(base);
  let s = await get('/api/state');
  if (['armed', 'live'].includes(s.phase)) { await post('/api/control', { cmd: 'recall' }); s = await get('/api/state'); }
  if (s.phase !== 'lobby') { await post('/api/phase', { phase: 'lobby', force: true }); s = await get('/api/state'); }
  if (!s.lobby.pushed) {
    const p = await post('/api/lobby/push', { force: true });
    if (p.status >= 400) throw new Error(`push refused: ${JSON.stringify(p.body)}`);
  }
  let st = await post('/api/start', { runway_s: 0 });
  if (st.status >= 400) st = await post('/api/start', { runway_s: 0, force: true });
  if (st.status >= 400) throw new Error(`start refused: ${JSON.stringify(st.body)}`);
  for (let i = 0; i < 100; i++) { if ((await get('/api/state')).phase === 'live') break; await sleep(200); }
  return get('/api/state');
}

/** A browser context whose console errors and page errors are collected into `errors`. */
export async function newPage(browser, viewport, errors, tag = () => '') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(`[${tag()}] [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') errors.push(`[${tag()}] [console] ${m.text().slice(0, 300)}`); });
  return pg;
}

export async function shot(pg, dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${name}.png`);
  await pg.screenshot({ path: f, fullPage: false });
  console.log(`      shot ${f}`);
}

/** The whole visible text, whitespace-normalised and upper-cased. */
export const bodyText = async pg => ((await pg.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').toUpperCase();
