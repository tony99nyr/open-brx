// A47: the LIVE board's operator menu, in a real browser against a real MC.
//
// Bench 2026-09-17 (Tony): a player in a bad state (a gun that cannot fire) had no cure MC could send. The server
// half is `mcp/tests/test_mc_operator_actions.py`, the phone half `app/test/operator.test.mjs`, the jsdom half
// `test/operator-menu.test.tsx`. This is what none of them can see: a real `--demo --fake-net` MC walked to LIVE,
// the console tapping a real row at desk width and at 393 px, the second tap sending, the notice and the feed line
// coming back from the server, a refusal reaching the error strip, and an OLD server (no route) named as one.
//
//   node test/e2e/operator-menu.mjs
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…    # move the ports / pick the interpreter
//
// Its OWN default ports (8799/8800/5199); `scripts/test-all.mjs` passes free ones.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC_DIR = path.resolve(HERE, '../..');
const REPO = path.resolve(MC_DIR, '../..');
const SHOTS = path.join(HERE, 'shots', 'operator-menu');   // one folder per script: a parallel run must not wipe another script's shots
const MC_PORT = Number(process.env.MC_PORT || 8799);
const MC_WS_PORT = Number(process.env.MC_WS_PORT || 8800);
const VITE_PORT = Number(process.env.VITE_PORT || 5199);

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
  const proc = spawn(process.execPath, [path.join(MC_DIR, 'node_modules/vite/bin/vite.js'), '--config', path.join(HERE, 'vite.proxy.config.mjs'), '--port', String(VITE_PORT), '--strictPort'],
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


/** Walk a fresh demo session to LIVE over the operator's own REST API (PUSH, HOST OVERRIDE, START). */
async function goLive(base) {
  const get = async p => (await fetch(`${base}${p}`)).json();
  const post = async (p, body) => {
    const r = await fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  let s = await get('/api/state');
  if (s.phase !== 'lobby') { await post('/api/phase', { phase: 'lobby', force: true }); s = await get('/api/state'); }
  if (!s.lobby.pushed) {
    const p = await post('/api/lobby/push', { force: true });
    if (p.status >= 400) throw new Error(`push refused: ${JSON.stringify(p.body)}`);
  }
  let st = await post('/api/start', { runway_s: 0 });
  if (st.status >= 400) st = await post('/api/start', { runway_s: 0, force: true });
  if (st.status >= 400) throw new Error(`start refused: ${JSON.stringify(st.body)}`);
  for (let i = 0; i < 80; i++) { s = await get('/api/state'); if (s.phase === 'live') break; await sleep(250); }
  if (s.phase !== 'live') throw new Error(`never went live (phase ${s.phase})`);
  return s;
}

const IGNORED = /Failed to load resource: the server responded with a status of (404|409)/;   // the two steps below fake these on purpose
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
try {
  const state = await goLive(mc.base);
  const target = state.live.rows.find(r => r.status === 'alive') || state.live.rows[0];
  const who = target.display.toUpperCase();
  console.log(`  live: ${state.live.match_id}, target ${who} (${target.player_id})`);
  browser = await chromium.launch();

  for (const vp of [{ width: 1280, height: 800, tag: 'desk' }, { width: 393, height: 830, tag: 'phone' }]) {
    step = `menu/${vp.tag}`;
    console.log(`\n[${step}] tap a row, confirm FORCE RESPAWN, ${vp.width}x${vp.height}`);
    const pg = await newPage(browser, { width: vp.width, height: vp.height });
    await pg.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1200);
    await goTo(pg, /^\d+ MATCH$/);
    const row = pg.locator(`[data-live-row="${target.player_id}"]`);
    if (!expect(await row.count() === 1, `the LIVE board shows ${who}'s row`)) { await shot(pg, `no-row-${vp.tag}`); await pg.context().close(); continue; }
    await row.click();
    const menu = pg.locator(`[data-operator-menu="${target.player_id}"]`);
    expect(await menu.isVisible(), 'tapping the row opens the operator menu');
    // inside what the operator can SEE: the board scrolls sideways in its own box, so clip to that box, not the page
    const fit = await menu.evaluate(el => {
      let clip = el.parentElement;
      while (clip && !/(auto|scroll|hidden)/.test(getComputedStyle(clip).overflowX)) clip = clip.parentElement;
      const m = el.getBoundingClientRect(), c = (clip || document.documentElement).getBoundingClientRect();
      return { left: Math.round(m.left), right: Math.round(m.right), clipL: Math.round(c.left), clipR: Math.round(Math.min(c.right, window.innerWidth)) };
    });
    expect(fit.left >= fit.clipL - 1 && fit.right <= fit.clipR + 1, `the whole menu is visible (${fit.left}-${fit.right} inside ${fit.clipL}-${fit.clipR})`);
    const respawn = menu.locator('[data-op="respawn"]');
    await respawn.click();
    expect((await respawn.innerText()).trim() === 'CONFIRM FORCE RESPAWN', 'the first tap arms FORCE RESPAWN');
    await shot(pg, `a47-armed-${vp.tag}`);
    await respawn.click();
    await pg.waitForTimeout(800);
    const text = (await pg.locator('body').innerText()).toUpperCase();
    expect(text.includes(`RESPAWN SENT TO ${who}'S PHONE`), 'the second tap sends and the notice says so');
    expect(await menu.count() === 0, 'the menu closes after a send');
    const feed = (await (await fetch(`${mc.base}/api/state`)).json()).feed.map(f => f.text);
    expect(feed.includes(`OPERATOR RESPAWNED ${who}`), 'the server wrote the feed line');
    expect(text.includes(`OPERATOR RESPAWNED ${who}`), 'and the console shows it in the event feed');
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(!overflow, 'no sideways page scroll at this width');
    await shot(pg, `a47-sent-${vp.tag}`);
    await pg.context().close();
  }

  step = 'refusal';
  console.log(`\n[${step}] a 409 from MC reaches the error strip`);
  {
    const pg = await newPage(browser, { width: 1280, height: 800 });
    await pg.route('**/api/players/*/operator', r => r.fulfill({ status: 409, contentType: 'application/json',
      body: JSON.stringify({ error: `${who}'S PHONE IS OUT OF REACH: nothing was sent` }) }));
    await pg.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1200);
    await goTo(pg, /^\d+ MATCH$/);
    await pg.locator(`[data-live-row="${target.player_id}"]`).click();
    const b = pg.locator('[data-op="resync"]');
    await b.click(); await b.click(); await pg.waitForTimeout(600);
    const strip = (await pg.locator('header [role="alert"]').allInnerTexts()).join(' ');
    expect(strip.includes('OUT OF REACH'), `the refusal is in the error strip ("${strip.slice(0, 80)}")`);
    expect(!(await pg.locator('body').innerText()).toUpperCase().includes('RESYNC SENT'), 'and nothing claims it was sent');
    await pg.context().close();
  }

  step = 'old-server';
  console.log(`\n[${step}] an MC that predates the route is named as one`);
  {
    const pg = await newPage(browser, { width: 1280, height: 800 });
    await pg.route('**/api/players/*/operator', r => r.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }));
    await pg.goto(`http://localhost:${VITE_PORT}/`, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1200);
    await goTo(pg, /^\d+ MATCH$/);
    await pg.locator(`[data-live-row="${target.player_id}"]`).click();
    const b = pg.locator('[data-op="relink"]');
    await b.click(); await b.click(); await pg.waitForTimeout(600);
    const strip = (await pg.locator('header [role="alert"]').allInnerTexts()).join(' ');
    expect(strip.includes('PREDATES THIS UI'), `the error strip says the server is too old ("${strip.slice(0, 80)}")`);
    await pg.context().close();
  }

  step = 'servers';
  expect(await fetch(`${mc.base}/api/state`).then(r => r.ok).catch(() => false), 'the MC this run started is still up at the end');

  step = 'errors';
  const real = jsErrors.filter(e => !IGNORED.test(e));
  expect(real.length === 0, `no console/page errors (${real.length})`);
  if (real.length) console.log(real.slice(0, 10).join('\n'));
} finally {
  if (browser) await browser.close();
  await vite.stop();
  await mc.stop();
}
console.log(failures.length ? `\nFAILED:\n  ${failures.join('\n  ')}` : '\nALL GOOD');
process.exit(failures.length ? 1 : 0);
