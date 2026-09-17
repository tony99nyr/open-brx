// A42 — the END delivery readout, in a real browser against a real MC.
//
// Field 2026-09-12, TWICE: the operator ended the match and a player's tagger played on. The server's
// half is pinned by `mcp/tests/test_mc_end_delivery.py`; the jsdom half by `test/end-delivery.test.tsx`.
// This is the half neither can see: a real python MC, a real END pressed over its own REST API, and the
// real console rendering what came back — at desk width and at 393 px, with every console error counted.
//
//   npm run e2e:end
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…    # move the ports / pick the interpreter
//
// Its OWN ports (8797/8798/5197), and the shared `vite.proxy.config.mjs` pointed at them: `npm run e2e`
// (koth) owns :8765 and a suite must never drive a server it did not start.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC_DIR = path.resolve(HERE, '../..');
const REPO = path.resolve(MC_DIR, '../..');
const SHOTS = path.join(HERE, 'shots');
const MC_PORT = Number(process.env.MC_PORT || 8797);
const MC_WS_PORT = Number(process.env.MC_WS_PORT || 8798);
const VITE_PORT = Number(process.env.VITE_PORT || 5197);

let failures = [], step = '';
const expect = (cond, what) => { if (cond) { console.log(`    ✓ ${what}`); return true; } failures.push(`${step}: ${what}`); console.log(`    ✗ ${what}`); return false; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const killGroup = proc => new Promise(done => {
  let settled = false; const finish = () => { if (!settled) { settled = true; done(); } };
  proc.once('exit', finish);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* gone */ } }
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } finish(); }, 3000).unref();
});

/** The dev venv, from wherever this checkout is. `REPO/.venv` is right in the main checkout and MISSING in
 *  a git worktree — where every parallel lane works — so a worktree follows its `.git` FILE
 *  (`gitdir: <main>/.git/worktrees/<name>`) back to the main checkout's venv rather than dying on ENOENT. */
function devPython() {
  if (process.env.MC_PY) return process.env.MC_PY;
  const here = path.join(REPO, '.venv/bin/python');
  if (fs.existsSync(here)) return here;
  try {
    const dotgit = path.join(REPO, '.git');
    if (fs.statSync(dotgit).isFile()) {
      const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(dotgit, 'utf8'));
      const main = m && m[1].trim().split('/.git/')[0];
      const py = main && path.join(main, '.venv/bin/python');
      if (py && fs.existsSync(py)) return py;
    }
  } catch { /* fall through to the plain interpreter */ }
  return 'python3';      // no venv found: MC will say what it is missing, which beats a bare ENOENT
}

async function startMC() {
  const py = devPython();
  console.log(`  python: ${py}`);
  try {
    const r = await fetch(`http://127.0.0.1:${MC_PORT}/api/state`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) { console.error(`SOMETHING ALREADY SERVES :${MC_PORT} — refusing to drive a server this run did not start.`); process.exit(3); }
  } catch { /* free: good */ }
  const proc = spawn(py, ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(MC_PORT), '--ws-port', String(MC_WS_PORT),
    '--demo', '--fake-net', '--no-auth', '--ephemeral'], { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${MC_PORT}`;
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`${base}/api/state`); if (r.ok) { console.log(`  mc: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) { console.error(`MC DIED:\n${log}`); process.exit(3); }
    await sleep(100);
  }
  console.error(`MC did not start:\n${log}`); await killGroup(proc); process.exit(3);
}

async function startVite() {
  const proc = spawn('npx', ['vite', '--config', path.join(HERE, 'vite.proxy.config.mjs'), '--port', String(VITE_PORT), '--strictPort'],
    { cwd: MC_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, MC_PROXY_PORT: String(MC_PORT) } });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${VITE_PORT}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await sleep(100);
  }
  console.error(`vite did not start:\n${log}`); proc.kill('SIGKILL'); process.exit(3);
}

/** Walk a fresh demo session to a LIVE match and press END over the API — the operator's own action. */
async function endAMatch(base) {
  const get = async p => (await fetch(`${base}${p}`)).json();
  const post = async (p, body) => {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  let s = await get('/api/state');
  if (['armed', 'live'].includes(s.phase)) { await post('/api/control', { cmd: 'recall' }); s = await get('/api/state'); }
  if (s.phase !== 'lobby') { await post('/api/phase', { phase: 'lobby', force: true }); s = await get('/api/state'); }
  // ⚠ Never RE-push a lobby that is already pushed: a re-push mints a fresh `config_id` (A37/24) and
  // drops every ack, and a `--fake-net` node never echoes a new one — so START would refuse for ever
  // with "not every node has acked the config with a gun echo". (Measured, 2026-09-13.)
  // `--demo` seeds a READY lobby that has never been pushed (measured: pushed=false, acks=0, go=true, and
  // it never self-advances), and the first push is refused unforced on the demo's reds — so this is the
  // operator pressing PUSH CONFIG and then HOST OVERRIDE, which is a first push, not a re-push.
  if (!s.lobby.pushed) {
    const p = await post('/api/lobby/push', { force: true });
    if (p.status >= 400) throw new Error(`push refused: ${JSON.stringify(p.body)}`);
    s = await get('/api/state');
  }
  // A `--fake-net` node never echoes a gun ack, so the whistle needs the operator's HOST OVERRIDE here.
  // Plain first, so this suite never forces a start a real server would have taken on its own.
  let st = await post('/api/start', { runway_s: 0 });
  if (st.status >= 400) st = await post('/api/start', { runway_s: 0, force: true });
  // THROW, never exit: the servers this run started are stopped in the `finally` below, and an early
  // `process.exit` here leaked an MC on its port and a vite beside it (measured, 2026-09-13) — which the
  // NEXT run then refuses to start over, by its own rule.
  if (st.status >= 400) throw new Error(`start refused: ${JSON.stringify(st.body)}`);
  for (let i = 0; i < 60; i++) { if ((await get('/api/state')).phase === 'live') break; await sleep(250); }
  const end = await post('/api/control', { cmd: 'end' });
  console.log(`  END: ${JSON.stringify(end.body)}`);
  return get('/api/state');
}

const jsErrors = [];
async function newPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => jsErrors.push(`[${step}] [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') jsErrors.push(`[${step}] [console] ${m.text().slice(0, 300)}`); });
  return pg;
}
const shot = async (pg, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await pg.waitForTimeout(300);
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f, fullPage: false });
  console.log(`      shot ${f}`);
};
/** Click the nav entry whose text matches, dumping what IS on screen when it is not there. */
async function goTo(pg, re) {
  const items = pg.locator('nav button, nav a, header button, [role="tab"], button');
  const n = await items.count();
  const label = async i => ((await items.nth(i).innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < n; i++) {
    if (re.test(await label(i))) { await items.nth(i).click(); await pg.waitForTimeout(400); return true; }
  }
  const seen = [];
  for (let i = 0; i < Math.min(n, 30); i++) seen.push((await label(i)).slice(0, 20));
  expect(false, `no nav entry matching ${re} — saw: ${seen.join(' | ')}`);
  return false;
}

const mc = await startMC();
const vite = await startVite();
let browser = null;
// EVERYTHING that can throw lives inside this try: the two servers above were started by this run, and
// the `finally` is the only thing that stops them.
try {
  const state = await endAMatch(mc.base);
  const ed = state.end_delivery;
  console.log(`  end_delivery: ${JSON.stringify(ed)}`);
  browser = await chromium.launch();
  step = 'server';
  expect(!!ed, 'the server puts end_delivery on the snapshot once a match has ended');
  expect(ed && ed.total > 0, `it covers the bound HUDs (total ${ed && ed.total})`);

  for (const vp of [{ width: 1280, height: 800, tag: 'desk' }, { width: 393, height: 830, tag: 'phone' }]) {
    step = `recap/${vp.tag}`;
    console.log(`\n[${step}] the console against a REAL MC, ${vp.width}x${vp.height}`);
    const pg = await newPage(browser, { width: vp.width, height: vp.height });
    await pg.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1200);

    // The console has FIVE tabs — 01 ARMORY … 05 MATCH — and NO recap tab: MATCH is where the live board
    // and the recap both live, chosen by `state.phase` (measured here, 2026-09-13). The nav button's text
    // is the number AND the label ("05 MATCH"), and "NEW SESSION ▸" sits right beside it, so the matcher has
    // to be the whole normalised label rather than a loose /MATCH/.
    await goTo(pg, /^\d+ MATCH$/);
    const rec = pg.locator('[data-testid="end-delivery-recap"]');
    if (expect(await rec.count() === 1, 'the MATCH tab shows the recap, carrying the end-delivery block')) {
      const t = (await rec.innerText()).replace(/\s+/g, ' ').toUpperCase();
      console.log(`      "${t.slice(0, 160)}"`);
      expect(/CONFIRMED THE END/.test(t), 'it says whether the HUDs confirmed the end');
      expect(!/KILL|ACCURACY|MEDAL/.test(t), 'and says nothing about how anyone played');
    }
    await shot(pg, `a41-recap-${vp.tag}`);

    // The LIVE board carries the SAME sentence above the END buttons, but after the whistle this tab
    // renders the recap, so the live variant is pinned in jsdom (`test/end-delivery.test.tsx`) instead of
    // being raced for here.
    // The board must still fit: a notice that pushes the screen sideways on a phone is a new defect.
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(!overflow, 'no sideways scroll at this width');
    await pg.context().close();
  }

  // Diagnose before judging: a refused socket in the log below is either the UI talking to a server that
  // went away (a harness fact) or the app itself (a defect), and the two must not be read as one.
  step = 'servers';
  const mcUp = await fetch(`${mc.base}/api/state`).then(r => r.ok).catch(() => false);
  const viteUp = await fetch(`http://localhost:${VITE_PORT}/`).then(r => r.ok).catch(() => false);
  expect(mcUp, 'the MC this run started is still up at the end');
  expect(viteUp, 'and so is vite');

  step = 'errors';
  expect(jsErrors.length === 0, `no console/page errors (${jsErrors.length})`);
  if (jsErrors.length) console.log(jsErrors.slice(0, 10).join('\n'));
} finally {
  if (browser) await browser.close();
  await vite.stop();
  await mc.stop();
}
console.log(failures.length ? `\nFAILED:\n  ${failures.join('\n  ')}` : '\nALL GOOD');
process.exit(failures.length ? 1 : 0);
