// F127 — the KIT → LOBBY gate, clicked in a real browser.
//
// The field report (2026-09-11): "if MC hits continue and goes to lobby it messes with everyone
// actively kitting. Seems fine to MC but locks everyone out." KIT's CONTINUE fired a bare
// `setPhase('lobby')`, skipping MC's own rule (`state.py` `_all_ready`), and the phone follows the
// phase — so every player still choosing a loadout lost the screen. These are the screen-truth steps
// for the fix; `test/kit-continue.test.tsx` is the same behaviour in jsdom, in 1 s.
//
//   npm run e2e:kit                  # everything (~40 s)
//   ONLY=mock npm run e2e:kit        # one run: mock | real | stale | fail400
//   MC_PORT=… VITE_PORT=… MC_PY=…    # move the ports / pick the interpreter
//
// Runs: mock (in-browser backend, a short roster), real (a real python MC on :8792, walked from
// ARMORY with the CONTINUE buttons), stale (snapshots stripped over REST *and* the WebSocket),
// fail400 (POST /api/phase forced to 400), phone (393x830) and desk (1280x800).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));      // webapp/mc/test/e2e
const MC_DIR = path.resolve(HERE, '../..');                     // webapp/mc
const REPO = path.resolve(MC_DIR, '../..');
const SHOTS = path.join(HERE, 'shots');
// Its OWN ports, and a vite config that proxies to them: `npm run e2e` (koth) owns :8765 via
// vite.config.ts, and a second suite must never drive a server it did not start.
const MC_PORT = Number(process.env.MC_PORT || 8792);
const VITE_PORT = Number(process.env.VITE_PORT || 5181);
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
    '--demo', '--fake-net', '--no-auth', '--ephemeral'], { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${MC_PORT}`;
  for (let i = 0; i < 200; i++) {
    try { const r = await fetch(`${base}/api/state`); if (r.ok) break; } catch { /* not yet */ }
    if (proc.exitCode != null) { console.error(`MC DIED:\n${log}`); process.exit(3); }
    await new Promise(r => setTimeout(r, 100));
  }
  // Prove the server answering is OURS. `--fake-net` never binds a real node socket, so `lan.ws_url`
  // is ws://0.0.0.0:0/ws and cannot identify it: use the free-port pre-check above plus a live child
  // that never failed to bind, and check the port it reports it is serving.
  const who = await (await fetch(`${base}/api/state`)).json();
  if (proc.exitCode != null || /address already in use|Errno 98/i.test(log)) {
    console.error(`OUR MC FAILED TO BIND :${MC_PORT} — something else is answering:\n${log}`); process.exit(3);
  }
  if (who?.lan?.port !== MC_PORT) { console.error(`:${MC_PORT} reports lan.port ${who?.lan?.port}`); await killGroup(proc); process.exit(3); }
  // No wait for the nodes' first STATUS here ON PURPOSE. A node that has said hello but has not yet
  // reported arrives with no `arm_state`, and `Armory.tsx` used to do `n.arm_state.toUpperCase()` and
  // take the whole console to its crash boundary. This walk opens ARMORY into that exact window and
  // asserts the cards render (fixed 2026-09-12; `test/armory-node.test.tsx` is the jsdom twin).
  console.log(`  MC: ${base} (session ${who.session_id}, demo + fake-net, ephemeral, ${who.players?.length ?? 0} players)`);
  return { base, stop: () => killGroup(proc) };
}
async function startVite() {
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
const gate = pg => pg.locator('[data-continue="kit"]');
const gateBtn = pg => gate(pg).locator('button').last();
const gateText = async pg => (await gate(pg).innerText()).replace(/\s+/g, ' ').trim();
/** every control in the gate is tappable, every word in it is readable (skill §2) */
async function auditGate(pg, where) {
  const rows = await gate(pg).evaluate(el => Array.from(el.querySelectorAll('button, span'))
    .filter(n => (n.textContent || '').trim() && !n.querySelector('button, span'))
    .map(n => ({ tag: n.tagName, t: (n.textContent || '').trim().slice(0, 28),
                 h: Math.round(n.getBoundingClientRect().height), fs: parseFloat(getComputedStyle(n).fontSize) })));
  for (const r of rows) {
    if (r.tag === 'BUTTON') expect(r.h >= 36, `tap target "${r.t}" is ${r.h}px tall (${where})`);
    expect(r.fs >= 11, `text "${r.t}" is ${r.fs}px (${where})`);
  }
  return rows.map(r => `${r.t}=${r.h}px/${r.fs}px`).join('  ');
}
const onKit = pg => pg.locator('main', { hasText: '[ A3 // KIT-OUT ]' }).count().then(n => n > 0);
const onLobby = pg => pg.locator('main', { hasText: '[ A5 // LOBBY' }).count().then(n => n > 0);

/** the operator's own path: ARMORY gate → GAMES CONTINUE → KIT.
 *  `fromArmory` is false for the ?mock demo: its fixture board has one RED gun on purpose, so A1's
 *  gate is (correctly) disabled there and the walk starts at GAMES. */
async function walkToKit(pg, url, fromArmory = true) {
  await pg.goto(url, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header').count().then(n => n > 0), 10000, 'the command bar');
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 15000, 'the first snapshot');
  if (!fromArmory) { await pg.evaluate(() => { location.hash = '#build'; }); await pg.waitForTimeout(250); }
  else {
    // A `--demo --fake-net` server boots straight into LOBBY (every fake phone readies itself), so the
    // console opens there. Step back to ARMORY with the nav — that is view-only, it moves no phase —
    // and then walk FORWARD on the real CONTINUE buttons, which is what sets the server phase.
    await pg.locator('header nav button:has-text("ARMORY")').first().click();
    if (!await until(() => pg.locator('main', { hasText: 'Readiness Board' }).count().then(n => n > 0), 10000, 'ARMORY')) {
      console.log('      FORENSICS url=', pg.url(), '\n      main:', (await pg.locator('main').innerText()).slice(0, 200).replace(/\n/g, ' | '));
      console.log('      nav:', await pg.locator('header nav button').allInnerTexts());
    }
    // This used to be `waitForTimeout(900)`, which is how the arm_state crash stayed hidden: a sleep
    // passes whether or not the screen rendered. Wait for the SCREEN instead — every phone card the
    // section says it has. A card that threw would never arrive and this hard-fails.
    await until(async () => {
      const sec = pg.locator('[data-nodes]');
      if (!await sec.count()) return false;
      const want = Number(await sec.first().getAttribute('data-nodes'));
      return want > 0 && await pg.locator('[data-node-card]').count() === want;
    }, 15000, 'every phone card on ARMORY to render');
    expect(await pg.locator('text=CONSOLE ERROR').count() === 0, 'ARMORY rendered the phone cards without crashing the console');
    ok(`ARMORY: ${await pg.locator('[data-node-card]').count()} phone cards, no crash boundary`);
    await pg.locator('main button:has-text("CONTINUE ▸")').first().click();
  }
  await until(() => pg.locator('main', { hasText: 'PLAYING GAME' }).count().then(n => n > 0), 10000, 'GAMES to open');
  await pg.locator('main button:has-text("CONTINUE ▸")').first().click();
  await until(() => onKit(pg), 10000, 'KIT to open from CONTINUE');
}

// ---------------------------------------------------------------------------- the runs
async function runMock(browser, viteBase, vp, tag) {
  step = `mock/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] the in-browser demo backend (8 players, SABLE + DRIFT not ready), ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, viteBase, vp);
  await walkToKit(pg, `${viteBase}/?mock`, false);

  expect((await gateText(pg)).includes('CONTINUE · 6/8 READY'), `the button carries the live count (saw ${JSON.stringify(await gateText(pg))})`);
  ok(`KIT: ${await gateText(pg)}   ${await shot(pg, `01-${tag}-kit-count`)}`);
  ok(`audit (resting): ${await auditGate(pg, `${tag} resting`)}`);

  // first tap: arms, moves nothing
  await gateBtn(pg).click();
  await pg.waitForTimeout(200);
  expect(await onKit(pg), 'the first tap left the operator on KIT');
  expect(!(await onLobby(pg)), 'the first tap did NOT open the lobby');
  const warn = await pg.locator('[data-continue-warn]').innerText().catch(() => '');
  const warn1 = warn.replace(/\s+/g, ' ');
  expect(/SABLE, DRIFT ARE STILL KITTING AND WILL LOSE THEIR SCREEN/.test(warn1),
    `the confirm names them AND says what the tap costs them (saw ${JSON.stringify(warn1)})`);
  expect((await gateBtn(pg).innerText()).replace(/\s+/g, ' ').includes('CONTINUE ANYWAY · 6/8 READY'),
    `the armed button keeps the ready count (saw ${JSON.stringify(await gateBtn(pg).innerText())})`);
  expect(await gate(pg).getAttribute('data-armed') === '1', 'the control reports itself armed');
  // the line has to be READ at a glance: one line on the desk, wrapped but whole on a phone. And the
  // WHOLE armed control has to stay on screen — armed, CANCEL and CONTINUE side by side were 398px,
  // which put CANCEL off the right edge of a 393px phone until the row was allowed to wrap.
  const box = await pg.locator('[data-continue-warn]').evaluate(el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { h: r.height, left: r.left, right: r.right, fs: parseFloat(cs.fontSize), lh: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45 };
  });
  const lines = Math.round(box.h / box.lh);
  if (vp.width >= 1280) expect(lines === 1, `the warning is ONE line at ${vp.width} (${lines} lines, ${Math.round(box.h)}px tall)`);
  else expect(lines <= 3, `the warning wraps to at most 3 lines at ${vp.width} (saw ${lines})`);
  expect(box.fs >= 11, `the warning is ${box.fs}px`);
  const gbox = await gate(pg).evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; });
  expect(gbox.left >= 0 && gbox.right <= vp.width + 1, `the armed control stays inside the ${vp.width}px viewport (${Math.round(gbox.left)}..${Math.round(gbox.right)})`);
  ok(`first tap armed the confirm: "${warn.replace(/\s+/g, ' ')}"   ${await shot(pg, `02-${tag}-armed`)}`);
  ok(`audit (armed): ${await auditGate(pg, `${tag} armed`)}`);

  // cancel disarms
  await gate(pg).locator('button:has-text("CANCEL")').click();
  await pg.waitForTimeout(150);
  expect(await pg.locator('[data-continue-warn]').count() === 0, 'CANCEL cleared the warning');
  expect((await gateBtn(pg).innerText()).replace(/\s+/g, ' ').trim() === 'CONTINUE · 6/8 READY ▸', `CANCEL restored the resting label (saw ${JSON.stringify(await gateBtn(pg).innerText())})`);
  ok(`CANCEL disarmed it   ${await shot(pg, `03-${tag}-cancelled`)}`);

  // two taps advance
  await gateBtn(pg).click(); await pg.waitForTimeout(150);
  await gateBtn(pg).click();
  await until(() => onLobby(pg), 8000, 'the LOBBY screen after the second tap');
  ok(`second tap opened LOBBY   ${await shot(pg, `04-${tag}-lobby`)}`);

  // the all-ready path, through the product's own controls: LOBBY's MARK READY for the two
  // stragglers, then back to KIT. No reload — a reload restarts the in-page demo backend.
  for (const name of ['SABLE', 'DRIFT']) {
    const b = pg.locator(`main button:has-text("${name} ▸")`).first();
    if (await b.count()) await b.click(); else expect(false, `no MARK READY control for ${name} in the lobby`);
    await pg.waitForTimeout(150);
  }
  await pg.evaluate(() => { location.hash = '#kit'; });
  await until(() => onKit(pg), 8000, 'KIT again');
  expect((await gateText(pg)).includes('CONTINUE · 8/8 READY'), `a full roster reads 8/8 (saw ${JSON.stringify(await gateText(pg))})`);
  ok(`every player ready: ${await gateText(pg)}   ${await shot(pg, `05-${tag}-all-ready`)}`);
  await gateBtn(pg).click();
  await until(() => onLobby(pg), 8000, 'ONE tap to advance with a full roster');
  ok('one tap advanced with every player ready');
  await pg.context().close();
}

async function runReal(browser, viteBase, mcBase, vp, tag) {
  step = `real/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] a real python MC on :${MC_PORT}, ${vp.width}x${vp.height}`);
  const phaseNow = async () => (await (await fetch(`${mcBase}/api/state`)).json()).phase;
  const pg = await newPage(browser, viteBase, vp);
  await walkToKit(pg, viteBase);

  // every fake node readies itself, so the seeded roster is green: one tap
  expect((await gateText(pg)).includes('CONTINUE · 8/8 READY'), `the seeded roster reads 8/8 (saw ${JSON.stringify(await gateText(pg))})`);
  ok(`KIT against the real server: ${await gateText(pg)}   ${await shot(pg, `10-${tag}-real-kit`)}`);

  // add a ninth operator with no phone — the real "someone is still kitting" case
  await pg.locator('main input[aria-label="new operator callsign"]').fill('ROCCO');
  await pg.locator('main input[aria-label="new operator callsign"]').press('Enter');
  await until(async () => (await gateText(pg)).includes('8/9'), 8000, 'the roster count to reach 8/9');
  expect((await gateText(pg)).includes('CONTINUE · 8/9 READY'), `the new player drops the count (saw ${JSON.stringify(await gateText(pg))})`);
  ok(`added ROCCO (no phone): ${await gateText(pg)}   ${await shot(pg, `11-${tag}-real-short`)}`);

  await gateBtn(pg).click();
  await pg.waitForTimeout(400);
  expect(await phaseNow() === 'kit', `THE F127 REGRESSION: the first tap must not move the SERVER phase (saw ${await phaseNow()})`);
  const warn = (await pg.locator('[data-continue-warn]').innerText().catch(() => '')).replace(/\s+/g, ' ');
  expect(/ROCCO IS STILL KITTING AND WILL LOSE THEIR SCREEN/.test(warn), `the confirm names ROCCO and the cost (saw ${JSON.stringify(warn)})`);
  expect((await gateBtn(pg).innerText()).replace(/\s+/g, ' ').includes('CONTINUE ANYWAY · 8/9 READY'),
    `the armed button keeps the count (saw ${JSON.stringify(await gateBtn(pg).innerText())})`);
  ok(`first tap: server still in kit, "${warn}"   ${await shot(pg, `12-${tag}-real-armed`)}`);

  await gateBtn(pg).click();
  await until(async () => (await phaseNow()) === 'lobby', 8000, 'the server phase to reach lobby on the second tap');
  await until(() => onLobby(pg), 8000, 'the LOBBY screen');
  ok(`second tap moved the server to lobby   ${await shot(pg, `13-${tag}-real-lobby`)}`);
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
    const server = ws.connectToServer();
    ws.onMessage(m => server.send(m));
    server.onMessage(m => {
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
  console.log(`\n[${step}] snapshots with no \`readiness\` and no \`ready\` field, ${vp.width}x${vp.height}`);
  // (a) readiness stripped only — the count comes from the roster's own ready flags, so it survives
  let pg = await newPage(browser, viteBase, vp);
  await stripSnapshots(pg, s => { const { readiness: _drop, ...rest } = s; return { ...rest, readiness: undefined }; });
  await pg.goto(`${viteBase}/#kit`, { waitUntil: 'domcontentloaded' });
  await until(() => onKit(pg), 15000, 'KIT to render with no readiness snapshot');
  expect(await pg.locator('text=CONSOLE ERROR').count() === 0, 'no crash boundary with readiness stripped');
  // `readiness` is the SERVER's tally; the gate counts the roster's own `ready` flags, so stripping
  // it must change nothing. Logging the text here and asserting nothing is how that would have gone
  // unnoticed — check it against what the server actually holds (review 2026-09-12). The roster is
  // whatever the earlier runs left (runReal adds ROCCO), so the expected count is computed, not fixed.
  const roster = (await (await fetch(`${mcBase}/api/state`)).json()).players || [];
  const want = `CONTINUE · ${roster.filter(p => p.ready).length}/${roster.length} READY`;
  const t0 = await gateText(pg);
  expect(t0.includes(want), `the gate still counts from the roster with readiness gone (want ${JSON.stringify(want)}, saw ${JSON.stringify(t0)})`);
  expect(!t0.includes('READINESS UNKNOWN'), 'a roster with ready flags is NOT "readiness unknown"');
  ok(`readiness stripped: ${t0}   ${await shot(pg, `20-${tag}-stale-readiness`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();

  // (b) the `ready` field stripped too — nothing left to count: plain CONTINUE + the hint
  pg = await newPage(browser, viteBase, vp);
  await stripSnapshots(pg, s => ({ ...s, readiness: undefined, players: (s.players || []).map(p => { const { ready: _d, ...r } = p; return r; }) }));
  await pg.goto(`${viteBase}/#kit`, { waitUntil: 'domcontentloaded' });
  await until(() => onKit(pg), 15000, 'KIT to render with no ready flags');
  const t = await gateText(pg);
  expect(t.includes('CONTINUE ▸'), `a plain CONTINUE (saw ${JSON.stringify(t)})`);
  expect(t.includes('READINESS UNKNOWN'), `the readiness-unknown hint (saw ${JSON.stringify(t)})`);
  expect(await pg.locator('text=CONSOLE ERROR').count() === 0, 'no crash boundary with ready stripped');
  ok(`ready stripped: ${t}   ${await shot(pg, `21-${tag}-stale-ready`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();
}

async function runFail400(browser, viteBase, vp, tag) {
  step = `fail400/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] POST /api/phase forced to 400, ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, viteBase, vp);
  let posts = 0;
  await pg.route('**/api/phase', route => {
    posts++;
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'PHASE REFUSED BY THE SERVER (forced)' }) });
  });
  await pg.goto(`${viteBase}/#kit`, { waitUntil: 'domcontentloaded' });
  await until(() => onKit(pg), 15000, 'KIT');
  // The earlier runs share this server, so the roster here may be short (ROCCO) or full: tap once,
  // and again if that tap only armed the confirm. Either way exactly ONE request may go out.
  await gateBtn(pg).click();
  await pg.waitForTimeout(250);
  if (await gate(pg).getAttribute('data-armed') === '1') { await gateBtn(pg).click(); await pg.waitForTimeout(250); }
  await pg.waitForTimeout(300);
  expect(posts === 1, `exactly one POST /api/phase went out (saw ${posts})`);
  const strip = await pg.locator('header [role="alert"]').innerText().catch(() => '');
  expect(/PHASE REFUSED/.test(strip), `the error strip shows the server's reason (saw ${JSON.stringify(strip)})`);
  expect(await onKit(pg), 'the console stayed on KIT after the 400');
  expect(!(await onLobby(pg)), 'the 400 did not open the lobby');
  ok(`400: "${strip.replace(/\s+/g, ' ')}", still on KIT   ${await shot(pg, `30-${tag}-fail400`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' }); await pg.context().close();
}

// ---------------------------------------------------------------------------- main
const DESK = { width: 1280, height: 800 }, PHONE = { width: 393, height: 830 };
fs.mkdirSync(SHOTS, { recursive: true });
const mc = await startMC();
const vite = await startVite();
const browser = await chromium.launch();
try {
  if (!ONLY || ONLY === 'mock') { await runMock(browser, vite.base, DESK, 'desk'); await runMock(browser, vite.base, PHONE, 'phone'); }
  if (!ONLY || ONLY === 'real') { await runReal(browser, vite.base, mc.base, DESK, 'desk'); }
  if (!ONLY || ONLY === 'stale') { await runStale(browser, vite.base, mc.base, DESK, 'desk'); await runStale(browser, vite.base, mc.base, PHONE, 'phone'); }
  if (!ONLY || ONLY === 'fail400') { await runFail400(browser, vite.base, DESK, 'desk'); }
} finally {
  await browser.close();
  await vite.stop();
  await mc.stop();
}
console.log('\n---------------------------------------------');
if (jsErrors.length) { console.log('JS ERRORS:'); jsErrors.forEach(e => console.log('  ' + e)); }
if (failures.length) { console.log(`FAILURES (${failures.length}):`); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('all steps passed');
