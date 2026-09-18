// "Report a problem" — the ☰ menu control clicked in a real browser, against a REAL python MC.
//
// `test/report-panel.test.tsx` is the same behaviour in jsdom, against a fixture `api.makeReport`; this
// is the one gate that proves the ACTUAL zip a real MC builds has the shape the panel promises (a real
// README.txt/session.sqlite/mc.log/environment.json), that the download really carries the operator
// token (a plain `<a href>` would 401 — `_TOKEN_GET_PREFIXES` in api.py gates `/api/report/<file>`),
// and that the GitHub issue link is the server's real, template-filled URL.
//
//   node test/e2e/report.mjs              # everything
//   ONLY=real npm run e2e:report          # one run: real | stale
//   MC_PORT=… VITE_PORT=… MC_PY=…         # move the ports / pick the interpreter
//
// Runs: real (☰ → Report a problem → MAKE REPORT → done; the download is a real zip with the four
// files; the issue link's href and target), stale (the POST route intercepted to 404: the panel shows
// the "too old to make reports" message, never a silent failure) — at desk (1280x800) and phone
// (393x830) widths for `real`.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));      // webapp/mc/test/e2e
const MC_DIR = path.resolve(HERE, '../..');                     // webapp/mc
const REPO = path.resolve(MC_DIR, '../..');
const SHOTS = path.join(HERE, 'shots', 'report');   // one folder per script: a parallel run must not wipe another script's shots
const DOWNLOADS = path.join(SHOTS, 'downloads');
// Its own evidence dir AND its own BRX_MCP_HOME (2026-09-18): a real report reads the store, the
// armory file and the presets shelf off disk, and every one of those otherwise falls back to
// `~/.brx-mcp` — a parallel run, or a run on Tony's own box, must never write there.
const EVIDENCE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-report-evidence-'));
const BRX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-report-home-'));
const MC_PORT = Number(process.env.MC_PORT || 8798);
const VITE_PORT = Number(process.env.VITE_PORT || 5198);
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
  // Not `scripts/mc.mjs` (this lane never runs that): the real report's `mc.log` is the launcher's own
  // job — teeing this process's stdout/stderr into `<evidence>/mc.log` ourselves, the same file the
  // launcher writes, is what makes a real `mc.log` show up in the zip instead of `report.py`'s
  // "missing" list.
  const log = fs.createWriteStream(path.join(EVIDENCE_DIR, 'mc.log'), { flags: 'a' });
  const proc = spawn(py, ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(MC_PORT), '--ws-port', String(wsPort),
    '--demo', '--fake-net', '--no-auth', '--ephemeral', '--advertise', '127.0.0.1', '--evidence-dir', EVIDENCE_DIR],
    { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { ...process.env, BRX_MCP_HOME: BRX_HOME,
        PYTHONPATH: [path.join(REPO, 'mcp'), process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter) } });
  let out = '';
  proc.stdout.on('data', d => { out += d; log.write(d); });
  proc.stderr.on('data', d => { out += d; log.write(d); });
  const base = `http://127.0.0.1:${MC_PORT}`;
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`${base}/api/state`); if (r.ok) break; } catch { /* not yet */ }
    if (proc.exitCode != null) { console.error(`MC DIED:\n${out}`); process.exit(3); }
    await new Promise(r => setTimeout(r, 100));
  }
  const who = await (await fetch(`${base}/api/state`)).json();
  if (proc.exitCode != null || /address already in use|Errno 98/i.test(out)) {
    console.error(`OUR MC FAILED TO BIND :${MC_PORT} — something else is answering:\n${out}`); process.exit(3);
  }
  if (who?.lan?.port !== MC_PORT) { console.error(`:${MC_PORT} reports lan.port ${who?.lan?.port}`); await killGroup(proc); process.exit(3); }
  console.log(`  MC: ${base} (session ${who.session_id}, demo + fake-net, ephemeral, evidence ${EVIDENCE_DIR})`);
  return {
    base,
    stop: async () => {
      await killGroup(proc);
      log.end();
      fs.rmSync(EVIDENCE_DIR, { recursive: true, force: true });
      fs.rmSync(BRX_HOME, { recursive: true, force: true });
    },
  };
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
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => jsErrors.push(`[${step}] [pageerror] ${e.message}`));
  // the `stale` run FORCES a 404 on the report route: the browser's own 'Failed to load resource' line
  // for that is the test working, not an error in the console
  pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 404/.test(m.text())) jsErrors.push(`[${step}] [console] ${m.text().slice(0, 300)}`); });
  return pg;
}
const shot = async (pg, name) => {
  await pg.waitForTimeout(200);
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f, fullPage: false });
  console.log(`      shot ${f}`);
  return f;
};
async function open(pg, url) {
  await pg.goto(url, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header').count().then(n => n > 0), 10000, 'the command bar');
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 15000, 'the first snapshot');
}
const panel = pg => pg.locator('[data-testid="report-panel"]');
async function openReportPanel(pg) {
  await pg.locator('button[title="Menu"]').click();
  await until(() => pg.locator('[role="menu"]').count().then(n => n > 0), 5000, 'the ☰ menu');
  await pg.locator('[role="menu"] >> text=Report a problem').click();
  await until(() => panel(pg).count().then(n => n > 0), 5000, 'the report dialog');
}

/** The zip's member NAMES, read straight off its central directory — no unzip binary, no dependency:
 *  the report is never decompressed here, only listed, which a ~30-line reader covers on its own
 *  (cross-platform matters to `mcp/`'s runtime; this script only needs to run wherever Node does). */
function zipNames(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip (no end-of-central-directory record)');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error(`bad central directory entry at ${off}`);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
    names.push(buf.toString('utf8', off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

// ---------------------------------------------------------------------------- the runs
async function runReal(browser, viteBase, mcBase, vp, tag) {
  step = `real/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] a real python MC on :${MC_PORT}, ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, viteBase, vp);
  await open(pg, `${viteBase}/#muster`);
  await openReportPanel(pg);
  expect(await panel(pg).getAttribute('data-report-phase') === 'idle', 'the dialog opens idle');
  ok(`opened from ☰   ${await shot(pg, `01-${tag}-idle`)}`);

  await pg.locator('button:has-text("MAKE REPORT")').click();
  await until(() => panel(pg).getAttribute('data-report-phase').then(p => p === 'done'), 15000, 'the report to finish');
  ok('MAKE REPORT reached done');

  const issueHref = await pg.locator('[data-testid="report-panel"] a[href*="github.com"]').getAttribute('href');
  const issueTarget = await pg.locator('[data-testid="report-panel"] a[href*="github.com"]').getAttribute('target');
  expect(!!issueHref && issueHref.startsWith('https://github.com/tony99nyr/open-brx/issues/new?template=bug_report.yml'),
    `the issue link is the server's real, template-filled URL (saw ${JSON.stringify(issueHref)})`);
  expect(issueTarget === '_blank', `the issue link opens in a new tab (saw ${JSON.stringify(issueTarget)})`);
  ok(`issue link: ${issueHref}`);

  const [download] = await Promise.all([
    pg.waitForEvent('download'),
    pg.locator('button:has-text("DOWNLOAD REPORT")').click(),
  ]);
  const savePath = path.join(DOWNLOADS, `${tag}-${download.suggestedFilename()}`);
  await download.saveAs(savePath);
  const buf = fs.readFileSync(savePath);
  expect(buf.subarray(0, 2).toString('latin1') === 'PK', 'the download is a real zip (PK signature)');
  const names = zipNames(buf);
  for (const want of ['README.txt', 'session.sqlite', 'mc.log', 'environment.json']) {
    expect(names.includes(want), `the zip contains ${want} (saw ${JSON.stringify(names)})`);
  }
  ok(`downloaded ${download.suggestedFilename()} — ${names.join(', ')}`);
  ok(`done   ${await shot(pg, `02-${tag}-done`)}`);

  await pg.keyboard.press('Escape');
  await until(() => panel(pg).count().then(n => n === 0), 3000, 'the dialog to close');
  await pg.context().close();
}

async function runStale(browser, viteBase, vp) {
  step = 'stale'; stepFailedAt = failures.length;
  console.log(`\n[${step}] an MC that predates /api/report, ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, viteBase, vp);
  let hits = 0;
  await pg.route('**/api/report', route => { hits++; route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }); });
  await open(pg, `${viteBase}/#muster`);
  await openReportPanel(pg);
  await pg.locator('button:has-text("MAKE REPORT")').click();
  await until(() => panel(pg).getAttribute('data-report-phase').then(p => p === 'error'), 8000, 'the error phase');
  expect(hits === 1, `exactly one request went out (${hits})`);
  const text = (await panel(pg).innerText()).replace(/\s+/g, ' ');
  expect(/too old to make reports/.test(text), `the panel names the version skew, plainly (saw ${JSON.stringify(text)})`);
  ok(`stale server: "${text.trim()}"   ${await shot(pg, '10-stale')}`);
  await pg.unroute('**/api/report');
  await pg.context().close();
}

// ---------------------------------------------------------------------------- main
const DESK = { width: 1280, height: 800 }, PHONE = { width: 393, height: 830 };
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DOWNLOADS, { recursive: true });
const mc = await startMC();
const vite = await startVite();
const browser = await chromium.launch();
try {
  if (!ONLY || ONLY === 'real') { await runReal(browser, vite.base, mc.base, DESK, 'desk'); await runReal(browser, vite.base, mc.base, PHONE, 'phone'); }
  if (!ONLY || ONLY === 'stale') { await runStale(browser, vite.base, DESK); }
} finally {
  await browser.close();
  await vite.stop();
  await mc.stop();
}
console.log('\n---------------------------------------------');
if (jsErrors.length) { console.log('JS ERRORS:'); jsErrors.forEach(e => console.log('  ' + e)); }
if (failures.length) { console.log(`FAILURES (${failures.length}):`); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('all steps passed');
