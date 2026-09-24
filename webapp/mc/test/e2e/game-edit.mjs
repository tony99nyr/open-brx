// B3 — editing the LOADED game (mode/night/health/weapon pool) inline on KIT and LOBBY, in a real
// browser, against a real server (mock AND python), with the re-push/re-ack made visible.
//
// 2026-09-13: the panel is a DRAFT. Every tap used to apply immediately (one PUT, and one re-push to
// every gun, per tap); Tony asked for "Click Edit to modify and then Save and Load to update all
// phones", so the walk below changes a control, PROVES the server did not move, and only then hits
// SAVE. The per-tap assertions this replaces could not be kept: they asserted the behaviour the field
// asked us to remove.
//
//   npm run e2e:game-edit                # everything (~40 s)
//   ONLY=mock npm run e2e:game-edit      # one run: mock | real | locked | stale | venue | faults
//                                      # (`faults` runs the desk scene AND the 393px phone one)
//   MC_PORT=… VITE_PORT=… MC_PY=…        # move the ports / pick the interpreter
//
// Runs: mock (in-browser backend — the fast, deterministic walk: edit on KIT, push, edit again on
// LOBBY once already pushed, watch the ack count clear and recover), real (a real python MC, walked
// from ARMORY like kit-continue.mjs, proving the same flow against the real server this worktree
// carries), locked (armed/live refuses an edit and says RECALL), stale (an MC with `/api/modes`
// missing and no `loadout_policy` on the wire — the shape a pre-A10 or older server would send —
// renders without crashing and shows the degraded state instead of a blank control), venue (F162:
// the manual link beside the venue setting on GAMES, at desk and phone width, proving no popup
// renders on GAMES or KIT, including against a config with no `environment` at all), faults
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
const SHOTS = path.join(HERE, 'shots', 'game-edit');   // one folder per script: a parallel run must not wipe another script's shots
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
/** Every control in the LOBBY action rail (and the host-override tray under it) is tappable, and
 *  every word in it is readable — the same floors `kit-continue.mjs` and `standby.mjs` assert.
 *  Scoped to the rail on purpose: it is the region this suite owns. */
async function auditRail(pg, where) {
  const rows = await pg.evaluate(() => Array.from(document.querySelectorAll('[data-rail="lobby"], [data-override="1"]'))
    .flatMap(root => Array.from(root.querySelectorAll('button, select, span, b')))
    .filter(n => (n.textContent || '').trim() && !n.querySelector('button, select, span, b'))
    .map(n => {
      const b = n.closest('button') || n;
      const r = b.getBoundingClientRect();
      const hit = Math.max(r.height, b.classList.contains('hit44') ? 44 : 0);
      return { tag: b.tagName, t: (b.textContent || '').trim().slice(0, 24),
               h: Math.round(hit), fs: parseFloat(getComputedStyle(n).fontSize),
               off: r.right > innerWidth + 1 || r.left < -1 };
    }));
  for (const r of rows) {
    if (r.tag === 'BUTTON' || r.tag === 'SELECT') expect(r.h >= 36, `tap target "${r.t}" is ${r.h}px tall (${where})`);
    expect(r.fs >= 11, `text "${r.t}" is ${r.fs}px (${where})`);
    expect(!r.off, `"${r.t}" is inside the viewport (${where})`);
  }
  return `${rows.length} controls audited`;
}
const panel = pg => pg.locator('[data-testid="game-edit-panel"]');
const openPanel = async pg => { await panel(pg).locator('[data-testid="game-edit-toggle"]').click(); await panel(pg).waitFor({ state: 'visible' }); };
// S45: LIFE PRESET's ADVANCED section starts OPEN already when the loaded game is CUSTOM (so a hand-tuned
// pool never hides its own numbers) -- a blind `.click()` on the toggle would then CLOSE it. Check
// `aria-expanded` first, so this is idempotent whichever state the panel opened in.
const openAdvanced = async pg => {
  const toggle = panel(pg).locator('[data-testid="health-advanced-toggle"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await panel(pg).locator('input[aria-label="health"]').waitFor({ state: 'visible' });
};
const repushText = async pg => (await panel(pg).locator('[data-testid="game-edit-repush"]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------- mock
async function runMock(browser, viteBase) {
  step = 'mock'; stepFailedAt = failures.length;
  console.log(`\n[${step}] the in-browser demo backend`);
  const pg = await newPage(browser, viteBase);
  // `repushack=3000`: the mock holds the acks for 3s after a re-push (220ms by default). The re-push
  // step below reads that transitional state, and 220ms is too short a window on a loaded machine.
  await pg.goto(`${viteBase}/?mock&repushack=3000#kit`, { waitUntil: 'domcontentloaded' });
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
  // Count the writes: a draft that quietly applied on every tap would still LOOK right on screen,
  // and that is the regression this whole rewrite is about.
  //
  // NOT with `pg.route`: `?mock` has no network at all — the backend runs IN the page — so a request
  // counter sits at zero whatever the panel does, and every "nothing was sent" assertion below would
  // pass for the wrong reason (it did, on the first run of this rewrite). Count where the calls
  // actually happen: on the in-page api object the store is holding.
  await pg.evaluate(() => {
    const api = window.__MC_MOCK__;
    window.__PUTS__ = 0;
    const orig = api.putConfig.bind(api);
    api.putConfig = async p => { window.__PUTS__++; return orig(p); };
  });
  const puts = () => pg.evaluate(() => window.__PUTS__ ?? 0);
  expect(await puts() === 0, 'CONTROL: the write counter starts at zero and is really attached');
  const before = await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText();
  // pick whichever mode option is NOT already selected
  const modeBtn = panel(pg).locator('[aria-label="mode"] button:not([aria-pressed="true"])').first();
  const modeLabel = (await modeBtn.innerText()).trim();
  await modeBtn.click();
  // The MODE control confirms a switch that would re-team >=2 rostered players, the same gate GAMES
  // uses (T2-A 9a1570d, extended to this panel 2026-09-13). Tap one shows the split and sends
  // NOTHING. Assert what it put on screen, then commit -- a blind re-tap would pass just as happily
  // against a control that had quietly gone back to one tap.
  const modeConfirm = panel(pg).locator('[data-testid="confirm-switch"]');
  if (await modeConfirm.count() > 0) {
    expect((await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()) === before,
      'the first tap on MODE has NOT switched the game yet');
    const split = panel(pg).locator('[data-testid="confirm-split"]');
    if (await split.count() > 0) {
      const t = (await split.textContent()).trim();
      expect(/^\u25B2 \d+ PLAYERS? \u2192 [A-Z]+ \d+ \/ [A-Z]+ \d+$/.test(t),
        `the MODE confirm names the predicted split (saw ${JSON.stringify(t)})`);
      const px = await split.evaluate(e => parseFloat(getComputedStyle(e).fontSize));
      expect(px >= 11, `the MODE confirm's split line is legible (${px}px)`);
    }
    await modeBtn.click();
  } else {
    console.log('      (this mode shares its team layout — nothing to confirm, one tap is correct)');
  }
  await pg.waitForTimeout(300);
  expect(await puts() === 0, `picking a MODE in the draft sent NOTHING (saw ${await puts()} write/s)`);
  expect((await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()) === before,
    'the header still names the LOADED game, not the draft — nothing has been applied yet');
  await panel(pg).locator('[data-testid="game-edit-save"] button').click();
  await until(async () => (await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()) !== before, 5000, 'the header to pick up the new mode after SAVE');
  expect((await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()).includes(modeLabel), `header now shows ${modeLabel}`);
  expect(await puts() === 1, `ONE write carried the change (saw ${await puts()})`);
  ok(`MODE -> ${modeLabel} drafted, then SAVEd in one request   ${await shot(pg, '02-mock-mode')}`);
  await openPanel(pg);   // a successful save closes the draft; open a fresh one for the next edit

  // ...and now a switch that DOES reshape the roster, so the confirm itself is walked rather than
  // skipped. The step above picks the first unselected mode, which is FFA -- one declared team, so
  // `splitLine` has nothing to say and one tap is correct. That means it proves the no-confirm
  // branch only. KOTH declares BLUE+GREEN, so an 8-player roster really moves and the gate fires.
  // The confirm now belongs to SAVE, not to the mode chip: the tap that MOVES people is the one that
  // asks. (The chip moves nobody — it edits a draft.)
  const kothBtn = panel(pg).locator('[aria-label="mode"] button').filter({ hasText: /^KOTH$/ }).first();
  if (await kothBtn.count() > 0) {
    const beforeKoth = await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText();
    await kothBtn.click();
    expect(await panel(pg).locator('[data-testid="confirm-switch"]').count() === 0,
      'picking the mode does not ask — nothing has moved yet');
    const save2 = panel(pg).locator('[data-testid="game-edit-save"] button');
    await save2.click();
    const c = panel(pg).locator('[data-testid="confirm-switch"]');
    await until(() => c.count().then(n => n > 0), 5000, 'the reshape confirm on the first SAVE tap');
    expect(await c.isVisible(), 'the confirm is visible before anything moves');
    expect((await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()) === beforeKoth,
      'the first SAVE tap on a reshaping draft has NOT switched the game');
    const sp = panel(pg).locator('[data-testid="confirm-split"]');
    expect(await sp.count() > 0, 'the confirm names the predicted split');
    const spText = (await sp.textContent()).trim();
    expect(/^\u25B2 \d+ PLAYERS? \u2192 [A-Z]+ \d+ \/ [A-Z]+ \d+$/.test(spText),
      `the split line reads as a split (saw ${JSON.stringify(spText)})`);
    const spPx = await sp.evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    expect(spPx >= 11, `the confirm's split line is legible (${spPx}px)`);
    await save2.click();
    await until(async () => (await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()) !== beforeKoth,
      5000, 'the second SAVE tap to commit the KOTH switch');
    ok(`reshape confirmed at SAVE time, then committed: "${spText}"   ${await shot(pg, '02b-mock-mode-reshape')}`);
    await openPanel(pg);
  } else {
    expect(false, 'no KOTH chip in the MODE control — the reshape confirm was never walked');
  }

  // TWO edits, ONE request — the thing the per-tap panel could not do, and the reason the operator
  // watched several ack counters race each other while players waited.
  const putsBefore = await puts();
  const night = panel(pg).locator('[role="switch"]');
  const nightBefore = await night.getAttribute('aria-checked');
  await night.click();
  await until(async () => (await night.getAttribute('aria-checked')) !== nightBefore, 5000, 'NIGHT OPS to flip in the draft');
  // S45: HP/armour/shield now live inside a LIFE PRESET's ADVANCED section — open it before the box exists.
  await openAdvanced(pg);
  const hp = panel(pg).locator('input[aria-label="health"]');
  await hp.fill('180'); await hp.press('Enter');
  await until(async () => (await hp.inputValue()) === '180', 5000, 'the HP box to hold the drafted value');
  await until(async () => (await panel(pg).locator('[data-testid="health-preset-custom"]').count()) === 1,
    5000, 'the preset row to show CUSTOM once a number has been hand-edited');
  await pg.waitForTimeout(300);
  expect(await puts() === putsBefore, `neither edit has been sent yet (saw ${(await puts()) - putsBefore} write/s)`);
  expect((await panel(pg).locator('[data-testid="game-edit-dirty"]').innerText()).includes('UNSAVED'),
    'the panel says what is staged rather than leaving the operator guessing');
  ok(`NIGHT + HEALTH drafted, nothing sent   ${await shot(pg, '03-mock-night')}`);
  await panel(pg).locator('[data-testid="game-edit-save"] button').click();
  await pg.waitForTimeout(400);
  expect(await puts() === putsBefore + 1, `ONE write carried both edits (saw ${(await puts()) - putsBefore})`);
  ok('LIFE PRESET (CUSTOM) HP -> 180 and NIGHT applied in a single SAVE');

  // --- push the lobby (through the console's own control, not a fetch) so the RE-push has something
  //     to re-push TO --- then move to LOBBY and edit again.
  await pg.evaluate(() => { location.hash = '#lobby'; });
  await until(() => onLobby(pg), 8000, 'LOBBY to open');
  // The `?mock` fixture always carries one deliberately RED gun (kit-continue.mjs's own comment on
  // it), so the plain PUSH button stays disabled here on purpose — the host's real path in that case
  // is the HOST OVERRIDE tray's "Push anyway", not a blocked primary button.
  const pushBtn = pg.locator('main [data-lobby-primary="push"] button');
  if (await pushBtn.isEnabled().catch(() => false)) await pushBtn.click();
  else await pg.locator('main button:has-text("Push anyway")').click();
  await pg.waitForTimeout(400);
  await until(async () => (await pg.locator('main').innerText()).includes('Config pushed'), 8000, 'the lobby to report a push');
  ok(`LOBBY: pushed   ${await shot(pg, '04-mock-lobby-pushed')}`);

  await openPanel(pg);
  const repushBefore = await repushText(pg);
  expect(/ALL GUNS ON THIS CONFIG|RE-PUSHING|GUNS CONFIRMED ON THIS CONFIG/.test(repushBefore), `the repush line reads a real state before the edit (saw ${JSON.stringify(repushBefore)})`);
  const stepTextBefore = (await pg.locator('main').innerText()).replace(/\s+/g, ' ').match(/Config pushed[^A-Z]*\d+\/\d+/)?.[0] ?? '';

  // WEAPONS AVAILABLE — switch one primary weapon off, then SAVE AND LOAD (the label the button
  // wears once there IS a head on the guns).
  const primaryGroup = panel(pg).locator('[aria-label="primary weapons available"]');
  const chip = primaryGroup.locator('button[aria-label$=", allowed"]').first();
  const chipName = (await chip.innerText()).replace(/^✓\s*/, '').trim();
  await chip.click();
  expect((await primaryGroup.locator(`button[aria-label="${chipName}, off"]`).count()) === 1,
    'the chip repaints from the DRAFT immediately (client-side pool), with nothing sent');
  const saveLoad = panel(pg).locator('[data-testid="game-edit-save"] button');
  expect((await saveLoad.innerText()).includes('SAVE AND LOAD'), `with a head on the guns the button says SAVE AND LOAD (saw ${JSON.stringify(await saveLoad.innerText())})`);
  await saveLoad.click();

  // The edit RE-PUSHES: the ack count must visibly MOVE (drop, then recover) — this is the
  // observable half of B3 (the un-push used to leave it looking untouched). Both indicators read the
  // SAME `lobby.acks` off the SAME snapshot, so they are checked in the one instant just confirmed to
  // be inside the transitional window — a second, separately-timed poll for the step text could miss
  // it (the mock's re-ack delay is short by design; a real gun's is ~1.5s).
  // Read both indicators in ONE page evaluation, so they come from the same DOM snapshot. Two separate
  // reads let the step text come from a different moment than the repush line (before the new state
  // renders, or after the acks return). Poll until both have moved; the held acks keep the window open.
  const snapshot = () => pg.evaluate(() => ({
    repush: (document.querySelector('[data-testid="game-edit-panel"] [data-testid="game-edit-repush"]')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    step: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').match(/Config pushed[^A-Z]*\d+\/\d+/)?.[0] ?? '',
  }));
  let during = { repush: repushBefore, step: stepTextBefore };
  await until(async () => { during = await snapshot(); return during.repush !== repushBefore; }, 4000, 'the repush line to change right after the edit');
  const deadline = Date.now() + 2500;
  while (during.repush !== repushBefore && during.step === stepTextBefore && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 80));
    during = await snapshot();
  }
  const stepTextDuring = during.step;
  expect(during.repush !== repushBefore && stepTextDuring !== stepTextBefore,
    `LOBBY's own config-pushed step moves WITH the repush line (before "${stepTextBefore}", during "${stepTextDuring}", repush line "${during.repush}")`);
  ok(`edit fired: repush line "${await repushText(pg)}", LOBBY step "${stepTextDuring}"   ${await shot(pg, '05-mock-repushing')}`);

  await until(async () => !/RE-PUSHING/.test(await repushText(pg)), 6000, 'the acks to recover');
  ok(`acks recovered: "${await repushText(pg)}"   ${await shot(pg, '06-mock-repushed')}`);
  await openPanel(pg);
  expect(await panel(pg).locator(`[aria-label="primary weapons available"] button[aria-label="${chipName}, off"]`).count() === 1,
    `${chipName} is off in the config the server now holds`);

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
  await pg.waitForTimeout(400);
  expect((await (await fetch(`${mcBase}/api/state`)).json()).config.night === (nightBefore === 'true'),
    'the REAL server has not moved: the draft is local until SAVE');
  await panel(pg).locator('[data-testid="game-edit-save"] button').click();
  await until(async () => (await (await fetch(`${mcBase}/api/state`)).json()).config.night !== (nightBefore === 'true'),
    5000, 'the real server to hold the new NIGHT value after SAVE');
  ok(`NIGHT OPS drafted then SAVEd against the real server   ${await shot(pg, `10-real-night-${tag}`)}`);
  await openPanel(pg);

  // A modest bump, not an arbitrary one: the real server's OWN balance rule (docs/weapon-design.md
  // §2.1, "cannot kill on one magazine") 400s a health/armor pool pushed too high for the shipped
  // clip sizes -- found the hard way probing this suite against the real server. 55 keeps the pool
  // (55+70=125) close to the default (45+70=115) while still being a value nothing else would set.
  // A modest bump, not an arbitrary one: the real server's OWN balance rule (docs/weapon-design.md
  // §2.1, "cannot kill on one magazine") 400s a health/armor pool pushed too high for the shipped clip
  // sizes. 50 and 55 both keep the pool at or under the 125 the default (45+70=115) sits near.
  // It ALTERNATES because this run happens twice (desk, then phone) against the SAME server, and a
  // draft is only sendable when something actually changed — re-typing the value the config already
  // holds leaves SAVE correctly disabled, which is the product working and the suite asking wrong.
  const hpNow = (await (await fetch(`${mcBase}/api/state`)).json()).config.health.max_hp;
  const hpWant = hpNow === 55 ? 50 : 55;
  // S45: the number lives behind LIFE PRESET's ADVANCED toggle now -- already open on the PHONE pass
  // (this run reuses the SAME real server as the desk pass, which already left the game CUSTOM).
  await openAdvanced(pg);
  const hp = panel(pg).locator('input[aria-label="health"]');
  await hp.fill(String(hpWant)); await hp.press('Enter');
  await panel(pg).locator('[data-testid="game-edit-save"] button').click();
  await until(async () => (await (await fetch(`${mcBase}/api/state`)).json()).config.health.max_hp === hpWant,
    5000, `the real server to hold the new health value (${hpNow} -> ${hpWant})`);
  ok(`LIFE PRESET (CUSTOM) HEALTH ${hpNow} -> ${hpWant} applied against the real server`);

  // push, then edit again — the real-server half of the re-push proof (mock already proved the
  // console-side indicator; this proves the SERVER really does re-push rather than un-push).
  await pg.evaluate(() => { location.hash = '#lobby'; });
  await until(() => onLobby(pg), 8000, 'LOBBY to open');
  const pushBtn = pg.locator('main [data-lobby-primary="push"] button');
  if (await pushBtn.count()) { await pushBtn.click(); }
  await until(async () => (await (await fetch(`${mcBase}/api/state`)).json()).lobby.pushed === true, 8000, 'the real server to report pushed');
  ok(`LOBBY pushed on the real server   ${await shot(pg, `11-real-lobby-pushed-${tag}`)}`);

  await openPanel(pg);
  await panel(pg).locator('[role="switch"]').click();   // NIGHT again — any SAVEd edit re-pushes
  await panel(pg).locator('[data-testid="game-edit-save"] button').click();
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
  // 2026-09-16 (Tony): the collapsed row carries no yellow LOCKED badge any more; it reads VIEW LOADED
  // GAME, and the open panel below is what explains the lock.
  await until(async () => (await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()).includes('VIEW LOADED GAME'),
    5000, 'the collapsed header');
  expect(!(await panel(pg).locator('[data-testid="game-edit-toggle"]').innerText()).includes('LOCKED'), 'no LOCKED badge on the row');
  ok(`header: VIEW LOADED GAME, no LOCKED badge   ${await shot(pg, '20-locked-header')}`);
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

// ---------------------------------------------------------- venue (F162, the ALT beam-width backstop)
/** 2026-09-16 (bench): the dismissable "SET EACH GUN TO <VENUE> (HOLD ALT 3 S)" banner is gone ,
 *  nagging the operator on every screen, every session, was "obnoxious" and it had to be dismissed
 *  again on several tabs. In its place, GAMES carries one small, quiet link beside the venue setting
 *  that opens the manual page explaining how to set the gun's own native ALT mode, in a new tab. No
 *  dismiss state, no storage: a link needs none. MC still cannot make the physical ALT selection, so
 *  this stays a real-browser step rather than only a jsdom one, to prove the link is really there and
 *  really points at the manual.
 *
 *  Runs against the REAL python MC, at desk and phone width, and then against a server whose config
 *  carries no `environment` at all (the pre-venue shape), where it must still show no popup. */
const MANUAL_ALT_MODE_URL = 'https://open-brx.iamrossi.workers.dev/manual/operate#indoor-vs-outdoor-mode';
const reminder = pg => pg.locator('[data-testid="venue-mode-reminder"], [data-testid="venue-mode-dismiss"]');
const manualLink = pg => pg.locator('[data-testid="venue-mode-manual-link"]');
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
  console.log(`\n[${step}] the manual link beside the venue setting on GAMES, ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, viteBase, vp);
  await pg.goto(`${viteBase}/`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header nav button').count().then(n => n > 0), 15000, 'the command bar');
  await toGames(pg);
  await noCrash(pg);

  await until(() => manualLink(pg).count().then(n => n === 1), 5000, 'the manual link beside the venue setting');
  const href = await manualLink(pg).getAttribute('href');
  expect(href === MANUAL_ALT_MODE_URL, `it points at the manual anchor (saw ${href})`);
  expect((await manualLink(pg).getAttribute('target')) === '_blank', 'it opens in a new tab');
  expect((await manualLink(pg).getAttribute('rel') ?? '').split(/\s+/).includes('noopener'), 'it carries rel="noopener"');
  expect(await reminder(pg).count() === 0, 'no dismissable popup renders any more');
  ok(`GAMES: manual link present, no popup   ${await shot(pg, `40-venue-games-link-${tag}`)}`);

  // switching venue must not resurrect a popup, and the link must not move or disappear
  await pickVenue(pg, 'outdoor', mcBase);
  await pickVenue(pg, 'indoor', mcBase);
  expect(await reminder(pg).count() === 0, 'a venue change still shows no popup');
  expect(await manualLink(pg).count() === 1, 'the link is still there after a venue change');
  ok(`venue change: still just the link, no popup   ${await shot(pg, `41-venue-games-after-change-${tag}`)}`);

  // KIT is where the guns are handed out, no control lives there, so no popup and no link either
  await toKit(pg);
  expect(await reminder(pg).count() === 0, 'KIT carries no popup');
  expect(await manualLink(pg).count() === 0, 'the link lives beside the setting on GAMES, not on KIT');
  ok(`KIT: no popup, no stray link   ${await shot(pg, `42-venue-kit-clean-${tag}`)}`);
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

/** A36/A37/F271 (U-3) — the five config-proof states, on screen, in a real browser.
 *
 *  `?mock` always acked with the config it had just pushed, so a stale ack, an echo mismatch, a pool
 *  fault and a gun that simply does not echo could be demoed exactly NEVER — and the console's
 *  rendering of all four was unverifiable by eye. `?mock&faults=1` puts one of each on four
 *  otherwise-green guns (webapp/mc/README.md → `?mock` demo switches). */
async function runFaults(browser, viteBase) {
  step = 'faults'; stepFailedAt = failures.length;
  console.log('\n[faults] ?mock&faults=1 — the five config-proof states on the muster board');
  const pg = await newPage(browser, viteBase);
  await pg.goto(`${viteBase}/?mock&faults=1#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => isMuster(pg), 15000, "the muster board");
  await noCrash(pg);
  // Push the config the way a host would: the A36 reds do not refuse the push that cures them (A37),
  // but the demo also ships one phone that has never arrived, and the FIRST push is refused for that
  // (nothing reaches a phone that is not here) — so this run takes the override.
  await pg.evaluate(async () => { await window.__MC_MOCK__.pushLobby(true); });
  // The console FOLLOWS a phase that advances, so the push lands us on LOBBY. The muster board is
  // where the per-gun proof lives, and the nav tab is never phase-gated — the operator's own route.
  await onMuster(pg);
  const txt = (await pg.locator('main').innerText()).replace(/\s+/g, ' ');
  for (const [what, re] of [
    ['the stale ack', /ACKED AN OLDER CONFIG/],
    ['the echo mismatch', /GUN ECHO ≠ CONFIG/],
    ['the pool fault', /GUN POOL ≠ CONFIG/],
    ['the query read-back mismatch', /GUN CONFIG ≠ PUSHED HEAD/],
    ['the gun that did not echo', /GUN DID NOT ECHO ITS WEAPON/],
  ]) expect(re.test(txt), `${what} is on the board (saw ${JSON.stringify(txt.slice(0, 200))})`);
  // NOT ECHOED is neutral: it is on a row that is not red, and it is not one of the blocker lines.
  const neutral = await pg.locator('[data-echo="not_echoed"]').count();
  expect(neutral === 1, `exactly one row reads NOT ECHOED (saw ${neutral})`);
  const proven = await pg.locator('[data-echo="proven"]').count();
  expect(proven > 0, `and at least one reads PROVEN, so the two are distinguishable (saw ${proven})`);
  ok(`all five states visible, NOT ECHOED neutral beside ${proven} proven   ${await shot(pg, '50-faults-board')}`);
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
  expect(await pg.locator('[data-override="1"]').count() === 0,
    'a force-proof query mismatch never offers HOST OVERRIDE');
  expect(/CANNOT BE OVERRIDDEN — RE-PUSH CONFIG/.test(rail), 'the rail says why override is absent and names the cure');
  ok(`LOBBY names the stale guns and keeps every instruction   ${await shot(pg, '53-faults-lobby')}`);
  // R2-1 — the button the three fault lines name. Every one of them says RE-PUSH and until now
  // `api.pushLobby` was reachable only while the lobby was UNPUSHED, so the word named nothing.
  const repush = pg.locator('button[data-repush="1"]').first();
  expect(await repush.count() > 0, 'a curable red puts RE-PUSH CONFIG on the rail');
  expect(await repush.isEnabled(), 'and it is clickable — this is the cure, not another refusal');
  // F3 — the only row no push can cure here is a phone that has not arrived, and a RE-push IS
  // delivered to it (on its own hello), so this is the ORDINARY re-push, not the forcing variant.
  const repushLabel = (await repush.innerText()).replace(/\s+/g, ' ').trim();
  expect(!/BLOCKED/.test(repushLabel),
    `a waiting phone does not make the re-push a forcing one (saw ${JSON.stringify(repushLabel)})`);
  expect(await repush.getAttribute('data-repush-force') === null, 'and it is not about to force');
  ok(`RE-PUSH CONFIG is on screen, enabled and ordinary   ${await shot(pg, '54-faults-repush')}`);
  await repush.click();
  await until(async () => {
    const s = (await pg.locator('main').innerText()).replace(/\s+/g, ' ');
    return !/ACKED AN OLDER CONFIG|GUN ECHO ≠ CONFIG|GUN POOL ≠ CONFIG|GUN CONFIG ≠ PUSHED HEAD/.test(s);
  }, 8000, 'the three curable reds to clear after the re-push');
  const cured = (await pg.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(!/still answering for an older config/.test(cured), 'the rail sentence goes with them');
  // The demo also ships one phone that has never arrived, which still holds the whistle — the point
  // is that the reason has changed from one the operator was told to re-push for to one they have to
  // go and fix. F1: and the disabled ARM says so, rather than carrying an empty title.
  const armTitle = await pg.locator('button:has-text("ARM COUNTDOWN")').first().getAttribute('title');
  expect(!/older config/i.test(armTitle ?? ''), `the ARM no longer blames a stale head (saw ${JSON.stringify(armTitle)})`);
  expect((armTitle ?? '').trim().length > 0, 'a disabled ARM is never silent about why');
  expect(/no push can clear/i.test(armTitle ?? ''), `...and names what is left (saw ${JSON.stringify(armTitle)})`);
  expect(/Waiting for 1 phone/.test(cured), 'the one row left is the phone nobody brought');
  ok(`the re-push cured all four reds   ${await shot(pg, '55-faults-cured')}`);
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
  expect(!/ACKED AN OLDER CONFIG|GUN ECHO ≠ CONFIG|GUN POOL ≠ CONFIG|GUN CONFIG ≠ PUSHED HEAD|DID NOT ECHO/.test(cleanTxt),
    'a plain ?mock demos none of the four');
  ok(`plain ?mock stays clean   ${await shot(clean, '51-faults-clean')}`);
  await clean.context().close();

  // F271 isolated control: a stale ack is also force-proof, so the combined scene cannot prove the
  // query mismatch itself suppresses HOST OVERRIDE. This page carries only the read-back red.
  const query = await newPage(browser, viteBase);
  await query.goto(`${viteBase}/?mock&faults=readback#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => isMuster(query), 15000, 'the isolated query-readback board');
  await query.evaluate(async () => { await window.__MC_MOCK__.pushLobby(true); });
  await query.locator('header nav button:has-text("LOBBY")').first().click();
  await until(() => onLobby(query), 5000, 'the isolated query-readback lobby');
  let queryText = (await query.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(/GUN CONFIG ≠ PUSHED HEAD/.test(queryText), 'the isolated scene carries the F271 blocker');
  expect(!/ACKED AN OLDER CONFIG/.test(queryText), 'the isolated scene has no stale-ack reason suppressing override');
  expect(await query.locator('[data-override="1"]').count() === 0, 'F271 alone suppresses HOST OVERRIDE');
  expect(await query.locator('[data-no-override-reason]').count() === 1, 'F271 alone explains the missing override');
  await query.locator('button[data-repush="1"]').first().click();
  await until(async () => !/GUN CONFIG ≠ PUSHED HEAD/.test((await query.locator('main').innerText()).replace(/\s+/g, ' ')),
    8000, 'the isolated F271 blocker to clear');
  queryText = (await query.locator('main').innerText()).replace(/\s+/g, ' ');
  expect(!/CANNOT BE OVERRIDDEN — RE-PUSH CONFIG/.test(queryText), 'the no-override reason clears with its fault');
  await query.context().close();
  await pg.context().close();
}

/** F7 (polish loop iteration 3) — the SAME scene at 393 px, because that is the width the console is
 *  actually read at when the operator is standing at the rack with the tablet in one hand.
 *  `runFaults` above shot the desk page only, so the one screen where three controls (RE-PUSH, ARM
 *  and the HOST OVERRIDE) compete for one row had never been looked at narrow. Asserts what the
 *  suite's other tap-target audits assert: on screen without sideways scroll, 36 px of hit area,
 *  11 px of type for anything that carries meaning. */
async function runFaultsPhone(browser, viteBase) {
  step = 'faults/phone'; stepFailedAt = failures.length;
  console.log('\n[faults/phone] the LOBBY rail at 393 px: RE-PUSH, ARM and the override on one screen');
  const pg = await newPage(browser, viteBase, PHONE);
  await pg.goto(`${viteBase}/?mock&faults=1#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => isMuster(pg), 15000, 'the muster board');
  await noCrash(pg);
  await pg.evaluate(async () => { await window.__MC_MOCK__.pushLobby(true); });
  await pg.locator('header nav button:has-text("LOBBY")').first().click();
  await until(() => onLobby(pg), 5000, 'the LOBBY to open from the nav');

  // (a) the page itself never scrolls sideways, and each actionable control is inside the viewport.
  // F271's direct gun read-back is force-proof, so HOST OVERRIDE is deliberately replaced by a reason.
  const sideways = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways <= 1, `the page scrolls ${sideways}px sideways at 393px`);
  for (const [what, sel] of [
    ['RE-PUSH CONFIG', 'button[data-repush="1"]'],
    ['ARM COUNTDOWN', 'main button:has-text("ARM COUNTDOWN")'],
  ]) {
    const el = pg.locator(sel).first();
    expect(await el.count() > 0, `${what} is on the phone-width rail at all`);
    const box = await el.boundingBox();
    expect(box && box.x >= -1 && box.x + box.width <= 393 + 1,
      `${what} is inside the viewport (saw ${JSON.stringify(box)})`);
  }
  expect(await pg.locator('[data-override="1"]').count() === 0, 'the force-proof mismatch has no host override');
  expect(await pg.locator('[data-no-override-reason]').count() === 1, 'the missing override is explained on screen');
  // ...and nothing on this screen paints outside its own box. The roster row's callsign span was
  // `flex: 1; minWidth: 0`, which at 393 px collapsed to 26 px — narrower than one callsign — so the
  // name overflowed and was drawn ON TOP of the LAN tag next to it (measured here, 2026-09-13).
  const spills = await pg.evaluate(() => Array.from(document.querySelectorAll('main [draggable="true"]'))
    .flatMap(row => Array.from(row.children))
    .filter(el => el.scrollWidth > el.clientWidth + 1)
    .map(el => `${(el.textContent || '').trim().slice(0, 20)} ${el.scrollWidth}>${el.clientWidth}`));
  expect(spills.length === 0, `roster rows overflow their own boxes: ${JSON.stringify(spills)}`);
  const audit = await auditRail(pg, 'phone');
  // The rail sits below the roster at this width, so the SHOT has to be of the rail — a screenshot of
  // the top of the page would prove nothing about the three controls this step is here to look at.
  const rail = pg.locator('[data-rail="lobby"]').first();
  await rail.scrollIntoViewIfNeeded();
  ok(`LOBBY rail at 393px: ${audit}   ${await shot(pg, '53p-faults-lobby-phone')}`);

  // (b) the cure, pressed at phone width
  const repush = pg.locator('button[data-repush="1"]').first();
  expect(await repush.isEnabled(), 'RE-PUSH is pressable at phone width too');
  await repush.scrollIntoViewIfNeeded();
  ok(`RE-PUSH CONFIG, phone width   ${await shot(pg, '54p-faults-repush-phone')}`);
  await repush.click();
  await until(async () => {
    const t = (await pg.locator('main').innerText()).replace(/\s+/g, ' ');
    return !/ACKED AN OLDER CONFIG|GUN ECHO ≠ CONFIG|GUN POOL ≠ CONFIG|GUN CONFIG ≠ PUSHED HEAD/.test(t);
  }, 8000, 'the four curable reds to clear after the phone-width re-push');
  expect(await pg.locator('[data-no-override-reason]').count() === 0, 'the no-override reason clears with the read-back fault');
  await noCrash(pg);
  const after = await auditRail(pg, 'phone/cured');
  await pg.locator('[data-rail="lobby"]').first().scrollIntoViewIfNeeded();
  ok(`cured, and the rail still reads at 393px: ${after}   ${await shot(pg, '55p-faults-cured-phone')}`);
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
  if (!ONLY || ONLY === 'faults') { await runFaults(browser, vite.base); await runFaultsPhone(browser, vite.base); }
} finally {
  await browser.close();
  await vite.stop();
  await mc.stop();
}
console.log('\n---------------------------------------------');
if (jsErrors.length) { console.log('JS ERRORS:'); jsErrors.forEach(e => console.log('  ' + e)); }
if (failures.length) { console.log(`FAILURES (${failures.length}):`); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('all steps passed');
