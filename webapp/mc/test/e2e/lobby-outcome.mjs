// LOBBY outcome (visual QA round 1, 2026-09-26, QA-02/QA-03/QA-04/QA-18): clicked against `?mock`
// (entirely client-side, no python MC needed -- the same pattern as play.mjs/build.mjs).
//
//   node test/e2e/lobby-outcome.mjs
//   ONLY=<step> node test/e2e/lobby-outcome.mjs    # all-ready | one-not-ready | operator-note | koth-no-stations
//   VITE_PORT=…   HEADED=1   KEEP_SHOTS=1
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC = path.resolve(HERE, '../..');
const SHOTS = path.join(HERE, 'shots', 'lobby-outcome');
const ONLY = process.env.ONLY || '';

let failures = [], current = '', stepFailedAt = 0;
const expect = (cond, what) => { if (cond) return true; failures.push(`${current}: ${what}`); console.log(`    ✗ ${what}`); return false; };
const ok = what => console.log(failures.length > stepFailedAt ? `    ⊘ ${what} (step already failed)` : `    ✓ ${what}`);
const until = async (pred, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = false; try { v = await pred(); } catch { v = false; }
    if (v) return true;
    if (Date.now() > end) { expect(false, `timed out waiting for ${what}`); return false; }
    await new Promise(r => setTimeout(r, 60));
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

async function startVite() {
  const port = Number(process.env.VITE_PORT) || await freePort();
  const proc = spawn(process.execPath, [path.join(MC, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'],
    { cwd: MC, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite dev: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.error(`vite did not start:\n${log}`); proc.kill('SIGKILL'); process.exit(3);
}

async function open(browser, base, query, width, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => failures.push(`${current}: [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') failures.push(`${current}: [console] ${m.text().slice(0, 300)}`); });
  await pg.goto(`${base}/${query}`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.evaluate(() => !!window.__MC_MOCK__), 10000, 'the mock backend handle');
  return pg;
}
const shot = async (pg, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f });
  return f;
};
/** Waits out a `scrollIntoView({behavior:'smooth'})` animation: two consecutive reads, 100ms apart,
 *  agreeing on the element's position -- never a fixed sleep, which races the animation under load. */
async function settledBox(locator, tries = 30) {
  let prev = null;
  for (let i = 0; i < tries; i++) {
    const box = await locator.boundingBox();
    if (box && prev && Math.abs(box.y - prev.y) < 0.5) return box;
    prev = box;
    await new Promise(r => setTimeout(r, 100));
  }
  return prev;
}

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

// QA-02: LOBBY after the push shows one outcome line, never the three counts (GUNS PUSHED / Config
// pushed / GUNS CONFIRMED) that used to disagree. `?mock&allgreen=1` is the demo's own "every gun is
// fine" fixture (mock/backend.ts `demoAllGreen`): 8 players, 8 guns, none waiting.
step('all-ready', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock&allgreen=1#lobby', 1280);
  await until(() => pg.locator('text=Team Assignment').count().then(n => n > 0), 8000, 'LOBBY');
  await pg.evaluate(() => window.__MC_MOCK__.pushLobby(true));
  await until(() => pg.getByTestId('lobby-guns-ready').count().then(n => n > 0), 8000, 'the GUNS READY line');
  const line = pg.getByTestId('lobby-guns-ready');
  const t = (await line.innerText()).replace(/\s+/g, ' ').trim();
  expect(t === 'GUNS READY 8/8', `the line reads exactly GUNS READY 8/8 (saw "${t}")`);
  expect(await line.locator('[data-not-ready-gun]').count() === 0, 'no not-ready gun is listed');
  // QA-02 fold (2026-09-26): the three counts GUNS READY replaced must actually be gone, not just
  // outnumbered -- this is the regression test for the follow-up, and it fails first against the
  // pre-fold build (all three used to render alongside GUNS READY on this same page).
  const mainText = await pg.locator('main').innerText();
  expect(!/Config pushed/.test(mainText), `the rail's old "Config pushed" count is gone (saw "${mainText.match(/Config pushed[^\n]*/)?.[0] ?? ''}")`);
  expect(!/GUNS PUSHED/.test(mainText), 'PRE-ARM CHECK\'s old GUNS PUSHED count is gone');
  expect(!/GUNS CONFIRMED/.test(mainText) && !/ALL GUNS ON THIS CONFIG/.test(mainText), 'GameEditPanel\'s old standing confirmed count is gone');
  ok(`all 8 guns ready -> one line, the old disagreeing counts gone   ${await shot(pg, 'all-ready-1280')}`);
  await pg.context().close();
});

// QA-02: one gun with no phone bound (`?mock&faults=1`'s DRIFT/GUN-D) is reported as NOT READY: NO
// PHONE, never as "has not confirmed this config" -- it was never sent anything to confirm.
step('one-not-ready', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock&allgreen=1&faults=1#lobby', 1280);
  await until(() => pg.locator('text=Team Assignment').count().then(n => n > 0), 8000, 'LOBBY');
  await pg.evaluate(() => window.__MC_MOCK__.pushLobby(true));
  await until(() => pg.getByTestId('lobby-guns-ready').count().then(n => n > 0), 8000, 'the GUNS READY line');
  const line = pg.getByTestId('lobby-guns-ready');
  const t = (await line.innerText()).replace(/\s+/g, ' ').trim();
  expect(/GUNS READY 7\/8/.test(t), `the headline reads 7/8 (saw "${t}")`);
  const notReady = line.locator('[data-not-ready-gun]');
  expect(await notReady.count() === 1, 'exactly one gun is named as not ready');
  const row = (await notReady.first().innerText()).toUpperCase();
  expect(row.includes('GUN-D') && row.includes('NOT READY'), `the row names the gun (saw "${row}")`);
  expect(row.includes('NO PHONE'), `a no-phone gun is reported as NO PHONE, not "has not confirmed" (saw "${row}")`);
  expect(!row.includes('CONFIRM'), `the no-phone row never says "confirmed" (saw "${row}")`);
  ok(`7/8 ready, GUN-D named NO PHONE   ${await shot(pg, 'one-not-ready-1280')}`);
  await pg.context().close();
});

// QA-04: the same operator note PLAY shows (games-redesign.md §9) survives onto LOBBY and ARMED, as an
// SVG info icon (QA-05: the ⓘ glyph is tofu in every bundled face).
step('operator-note', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#lobby', 1280);   // default mode is TDM
  await until(() => pg.locator('text=Team Assignment').count().then(n => n > 0), 8000, 'LOBBY');
  const lobbyNote = pg.getByTestId('operator-note');
  await until(() => lobbyNote.count().then(n => n === 1), 6000, 'the operator note on LOBBY');
  expect((await lobbyNote.innerText()).toUpperCase().includes("TEAM HITS DON'T COUNT"), 'the TDM note shows on LOBBY');
  expect(await lobbyNote.locator('svg[data-icon="info"]').count() === 1, 'an SVG info icon, not the ⓘ glyph');
  expect(!(await lobbyNote.innerText()).includes('ⓘ'), 'the ⓘ glyph itself never reaches the DOM text');

  await pg.evaluate(async () => {
    const api = window.__MC_MOCK__;
    await api.pushLobby(true);
    await api.start(45, true);
  });
  await pg.evaluate(() => { location.hash = '#armed'; });
  await until(() => pg.locator('text=Match Arming').count().then(n => n > 0), 8000, 'ARMED');
  const armedNote = pg.getByTestId('operator-note');
  await until(() => armedNote.count().then(n => n === 1), 6000, 'the operator note on ARMED');
  expect((await armedNote.innerText()).toUpperCase().includes("TEAM HITS DON'T COUNT"), 'the same note shows on ARMED');
  expect(await armedNote.locator('svg[data-icon="info"]').count() === 1, 'an SVG info icon on ARMED too');
  ok(`the operator note, with an SVG icon, on LOBBY and ARMED   ${await shot(pg, 'operator-note-armed-1280')}`);
  await pg.context().close();
});

// QA-03/QA-18: ASSIGN A HILL with NO station on the net at all must not be a dead end, and BACK TO
// PLAY must be on screen once the panel scrolls into view.
/** PLAY's mode picker asks first when a switch moves rostered players (the "moves players" confirm):
 *  tap KING OF THE HILL, and tap it again if the confirm shows, until it is the picked mode. */
async function pickKoth(pg) {
  const btn = pg.getByRole('button', { name: 'KING OF THE HILL' });
  const picked = async () => (await btn.getAttribute('aria-pressed')) === 'true';
  for (let i = 0; i < 2 && !(await picked()); i++) {
    await btn.click();
    // wait for the result of THIS tap: the mode is picked, or the confirm asking for a second tap shows
    await pg.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent?.includes('KING OF THE HILL'));
      return b?.getAttribute('aria-pressed') === 'true' || /TAP AGAIN/.test(document.body.innerText);
    }, null, { timeout: 8000 });
  }
  if (!(await picked())) throw new Error('KING OF THE HILL is not the picked mode after the confirm');
}

step('koth-no-stations', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await until(() => pg.locator('text=PICK GAME').count().then(n => n > 0), 8000, 'PLAY');
  // the mock seeds two utility phones by default (mock/backend.ts), and CLEARing one only drops its
  // assignment (the phone keeps advertising, so it stays in `state.stations`) -- QA-03 is about NOTHING
  // on the net at all, so this reaches into the mock's own record the way `deleteStation` cannot.
  await pg.evaluate(() => { window.__MC_MOCK__.stations = {}; window.__MC_MOCK__.emit(); });
  await pickKoth(pg);
  await until(() => pg.locator('text=NO HILL STATION ASSIGNED').count().then(n => n > 0), 4000, 'the no-hill block');
  await pg.getByTestId('assign-a-hill').getByRole('button').click();
  await until(() => pg.locator('text=Readiness Board').count().then(n => n > 0), 6000, 'ARMORY');
  const focus = pg.getByTestId('items-hill-focus');
  await until(() => focus.count().then(n => n === 1), 6000, 'the focus callout, even with no stations');
  const t = (await focus.innerText()).toUpperCase();
  expect(t.includes('NO STATION HAS SAID HELLO'), `the callout says nothing is on the net yet (saw "${t}")`);
  expect(t.includes('SEVEN-TAP') || t.includes('STICKS3'), 'the callout says how to make one (a phone or a Stick)');
  const back = focus.getByTestId('items-back-to-play');
  await until(() => back.count().then(n => n === 1), 4000, 'BACK TO PLAY inside the callout');
  const box = await settledBox(back);
  const vh = pg.viewportSize().height;
  expect(!!box && box.y >= 0 && box.y + box.height <= vh, `BACK TO PLAY is on screen after the scroll (box=${JSON.stringify(box)}, viewport height ${vh})`);
  await back.getByRole('button').click();
  await until(() => pg.locator('text=PICK GAME').count().then(n => n > 0), 6000, 'back on PLAY');
  expect(await pg.getByRole('button', { name: 'KING OF THE HILL' }).getAttribute('aria-pressed').then(v => v === 'true'), 'KOTH is still picked on return');
  ok(`no stations at all -> a callout that says how to make one, and BACK TO PLAY on screen   ${await shot(pg, 'koth-no-stations-1280')}`);
  await pg.context().close();
});

// QA-18 alone: with the mock's default two stations present, ARMORY still scrolls ITEMS into view, and
// BACK TO PLAY has to be repeated inside the callout there too -- this is the shape the audit shot
// (koth-mock-2-armory-focus.png) actually showed, at a shorter viewport where the header button scrolls
// well off the top.
step('koth-with-stations', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280, 700);
  await until(() => pg.locator('text=PICK GAME').count().then(n => n > 0), 8000, 'PLAY');
  await pickKoth(pg);
  await until(() => pg.locator('text=NO HILL STATION ASSIGNED').count().then(n => n > 0), 4000, 'the no-hill block');
  await pg.getByTestId('assign-a-hill').getByRole('button').click();
  await until(() => pg.locator('text=Readiness Board').count().then(n => n > 0), 6000, 'ARMORY');
  const focus = pg.getByTestId('items-hill-focus');
  await until(() => focus.count().then(n => n === 1), 6000, 'the focus callout, with the default stations present');
  const back = focus.getByTestId('items-back-to-play');
  await until(() => back.count().then(n => n === 1), 4000, 'BACK TO PLAY inside the callout');
  const box = await settledBox(back);
  const vh = pg.viewportSize().height;
  expect(!!box && box.y >= 0 && box.y + box.height <= vh, `BACK TO PLAY is on screen after the scroll at a short viewport (box=${JSON.stringify(box)}, viewport height ${vh})`);
  ok(`with stations present, BACK TO PLAY is still on screen after the scroll   ${await shot(pg, 'koth-with-stations-1280x700')}`);
  await pg.context().close();
});

async function main() {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const vite = await startVite();
  const toRun = ONLY ? steps.filter(s => s.name === ONLY) : steps;
  if (ONLY && toRun.length === 0) { console.error(`no step "${ONLY}"; have: ${steps.map(s => s.name).join(', ')}`); process.exit(2); }
  if (!process.env.KEEP_SHOTS) fs.rmSync(SHOTS, { recursive: true, force: true });
  try {
    for (const s of toRun) {
      current = s.name; stepFailedAt = failures.length;
      console.log(`\n▸ ${s.name}`);
      try { await s.fn({ browser, base: vite.base }); } catch (e) { failures.push(`${s.name}: threw ${e && e.stack || e}`); console.log(`    ✗ threw: ${e && e.message || e}`); }
    }
  } finally {
    await browser.close();
    await vite.stop();
  }
  console.log(`\n${failures.length === 0 ? '✓ ALL PASS' : `✗ ${failures.length} FAILURE(S)`}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}
await main();
