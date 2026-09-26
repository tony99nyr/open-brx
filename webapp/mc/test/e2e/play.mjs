// PLAY (F411, docs/spec/design/games-presets.md): the PICK GAME screen, clicked in a real browser.
// `?mock` is entirely client-side (no python MC needed), the same as frame.mjs/backhaul.mjs.
//
//   node test/e2e/play.mjs                    # every step
//   ONLY=<step> node test/e2e/play.mjs        # one step: fresh | extra-pieces | controls | kills |
//                                              #           lastmatch | koth | pick-fail | stale | widths
//   VITE_PORT=…   HEADED=1   KEEP_SHOTS=1
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC = path.resolve(HERE, '../..');
const SHOTS = path.join(HERE, 'shots', 'play');
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
  await until(() => pg.locator('text=PICK GAME').count().then(n => n > 0), 10000, 'the PLAY screen');
  return pg;
}
const shot = async (pg, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f });
  return f;
};
const text = pg => pg.evaluate(() => document.body.innerText);

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step('fresh', async ({ browser, base }) => {
  for (const w of [1280, 900]) {
    const pg = await open(browser, base, '?mock#build', w);
    const t = await text(pg);
    expect(/GAME MODE/.test(t), `${w}px: GAME MODE shows`);
    expect(/^LIFE|\nLIFE\n/m.test(t) || /LIFE/.test(t), `${w}px: LIFE shows`);
    expect(/SPAWN/.test(t), `${w}px: SPAWN shows`);
    expect(!/PRIMARY/.test(t), `${w}px: PRIMARY hidden (one built-in)`);
    expect(!/SECONDARY/.test(t), `${w}px: SECONDARY hidden (one built-in)`);
    expect(!/MISC LOADOUTS/.test(t), `${w}px: MISC LOADOUTS hidden (one built-in)`);
    expect(!/GAMEPLAY/.test(t), `${w}px: GAMEPLAY always hidden`);
    expect(/MATCH SETTINGS/.test(t), `${w}px: the strip shows`);
    ok(`${w}px fresh install   ${await shot(pg, `fresh-${w}`)}`);
    await pg.context().close();
  }
});

step('extra-pieces', async ({ browser, base }) => {
  for (const w of [1280, 900]) {
    const pg = await open(browser, base, '?mock#build', w);
    await pg.evaluate(async () => {
      const api = window.__MC_MOCK__;
      await api.createPiece({ kind: 'primary', name: 'SNIPERS', value: { choice: 'fixed', kinds: ['weapon'], exclude_tags: [], exclude_ids: [], only_ids: [], fixed_id: 'sniper_rifle' } });
      await api.createPiece({ kind: 'perks', name: 'CURATED', value: { choice: 'player', kinds: ['perk'], exclude_tags: [], exclude_ids: [], only_ids: ['body_armor', 'quick_switch'], fixed_id: null } });
    });
    await pg.evaluate(() => { location.hash = '#muster'; });
    await pg.evaluate(() => { location.hash = '#build'; });
    await until(() => pg.locator('text=PRIMARY').count().then(n => n > 0), 6000, 'the PRIMARY picker once BUILD has a second piece');
    const t = await text(pg);
    expect(/PRIMARY/.test(t) && /SNIPERS/.test(t), `${w}px: PRIMARY appears with SNIPERS once BUILD has a second piece`);
    expect(/PERKS/.test(t) && /CURATED/.test(t), `${w}px: PERKS appears with CURATED too`);
    ok(`${w}px with extra BUILD pieces   ${await shot(pg, `extra-pieces-${w}`)}`);
    await pg.context().close();
  }
});

step('controls', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'koth', 4000, 'the mode to reach the server');
  expect(await pg.getByRole('button', { name: 'KING OF THE HILL' }).getAttribute('aria-pressed').then(v => v === 'true'), 'KING OF THE HILL is marked selected');
  await pg.getByRole('button', { name: 'TEAM DEATHMATCH' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.mode === 'tdm', 4000, 'the mode to reach the server');
  await pg.getByRole('button', { name: 'SHIELDS' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.health.max_shield === 105, 4000, 'the life preset to reach the server');
  await pg.getByRole('button', { name: 'STATION' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).config.respawn.type === 'scanner', 4000, 'the spawn preset to reach the server');
  ok(`GAME MODE / LIFE / SPAWN each one tap, marked state follows the server   ${await shot(pg, 'controls-1280')}`);
  await pg.context().close();
});

step('kills', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.getByTestId('match-kills-value').click();
  await pg.getByRole('button', { name: '15' }).click();
  await until(async () => (await pg.evaluate(() => window.__MC_MOCK__.getState())).game_pick.match.frag_limit === 15, 4000, '"only 15 kills"');
  ok('KILLS quick-pick reaches the server (only 15 kills)');
  await pg.context().close();
});

step('lastmatch', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  expect(await pg.getByTestId('last-match').count() === 0, 'LAST MATCH is hidden before any match has played');
  await pg.evaluate(async () => {
    const api = window.__MC_MOCK__;
    await api.setPhase('lobby');
    await api.pushLobby(true);
    await api.start(45, true);
    await api.abort();   // back to LOBBY -- the console follows an armed match away from PLAY, by design
  });
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.getByTestId('last-match').count().then(n => n === 1), 6000, 'LAST MATCH once a match has started');
  ok('LAST MATCH: hidden, then shown once a match has played');
  await pg.context().close();
});

step('koth', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(() => pg.locator('text=NO HILL STATION ASSIGNED').count().then(n => n > 0), 4000, 'the no-hill block');
  await pg.getByTestId('assign-a-hill').getByRole('button').click();
  await until(() => pg.locator('text=Readiness Board').count().then(n => n > 0), 6000, 'ARMORY');
  expect(await pg.getByTestId('armory-back-to-play').count() === 1, 'BACK TO PLAY is offered');
  await pg.getByTestId('armory-back-to-play').getByRole('button').click();
  await until(() => pg.locator('text=PICK GAME').count().then(n => n > 0), 6000, 'back on PLAY');
  expect(await pg.getByRole('button', { name: 'KING OF THE HILL' }).getAttribute('aria-pressed').then(v => v === 'true'), 'KOTH is still picked on return');
  ok(`KOTH with no hill -> ASSIGN A HILL -> ARMORY -> BACK TO PLAY, never a dead end   ${await shot(pg, 'koth-no-hill')}`);
  await pg.context().close();
});

step('pick-fail', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  const before = await pg.evaluate(() => window.__MC_MOCK__.getState()).then(s => s.config.mode);
  await pg.evaluate(() => { window.__MC_MOCK__.pick = async () => { throw new Error('pick refused (forced by the test)'); }; });
  await pg.getByRole('button', { name: 'KING OF THE HILL' }).click();
  await until(() => pg.locator('header button[role="alert"]').count().then(n => n > 0), 4000, 'the error strip');
  const after = await pg.evaluate(() => window.__MC_MOCK__.getState()).then(s => s.config.mode);
  expect(after === before, 'a failed pick changes nothing');
  ok('a failed pick shows the error strip and changes nothing');
  await pg.context().close();
});

step('stale', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#build', 1280);
  await pg.evaluate(() => { window.__MC_MOCK__.getPieces = async () => { const e = new Error('not found'); e.status = 404; throw e; }; });
  // remount PLAY (not a full reload, which would recreate a fresh, un-patched mock backend): the hash
  // nav swaps the rendered screen, re-running Games.tsx's own `useEffect(() => api.getPieces()...)`.
  await pg.evaluate(() => { location.hash = '#muster'; });
  await until(() => pg.locator('text=Readiness Board').count().then(n => n > 0), 4000, 'ARMORY');
  await pg.evaluate(() => { location.hash = '#build'; });
  await until(() => pg.getByTestId('play-stale-server').count().then(n => n === 1), 6000, 'the stale-server banner');
  const t = await text(pg);
  expect(/THE SERVER PREDATES THIS CONSOLE/.test(t), 'the exact banner text');
  expect(/start\.sh/.test(t), 'the restart command');
  ok(`GET /api/pieces 404 -> the stale-server banner, PLAY still renders   ${await shot(pg, 'stale-server')}`);
  await pg.context().close();
});

step('widths', async ({ browser, base }) => {
  for (const w of [1280, 900]) {
    const pg = await open(browser, base, '?mock#build', w);
    const overflow = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(!overflow, `${w}px: no sideways page scroll`);
    const sizes = await pg.evaluate(() => [...document.querySelectorAll(
      '[data-testid^="match-"], [data-testid="game-load"] button, [data-testid="last-match"] button')]
      .map(el => el.getBoundingClientRect().height));
    expect(sizes.length > 0 && sizes.every(h => h >= 32), `${w}px: every new strip control is at least a real tap target (saw ${JSON.stringify(sizes)})`);
    await pg.context().close();
  }
  ok('900px and 1280px: no overflow, real tap targets');
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
