// F411 BUILD e2e — drives the preset editor in a real browser against `?mock`.
//
// It runs against the real `?mock` backend (`src/mock/backend.ts`), the same piece routes PLAY uses, and
// reaches BUILD the way an operator does: PLAY's `BUILD ▸` link. Only the save-error step swaps one route.
//
//   node test/e2e/build.mjs
//   ONLY=<step> node test/e2e/build.mjs   # tabs | life | spawn | type-toggle | delete | save-error | leave-confirm
//   HEADED=1 / KEEP_SHOTS=1 / VITE_PORT=…
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));       // webapp/mc/test/e2e
const MC = path.resolve(HERE, '../..');                          // webapp/mc
const SHOTS = path.join(HERE, 'shots', 'build');
const ONLY = process.env.ONLY || '';
const WIDTHS = [1280, 900];

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

async function open(browser, base, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => failures.push(`${current}: [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') failures.push(`${current}: [console] ${m.text().slice(0, 300)}`); });
  await pg.goto(`${base}/?mock#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header nav').count().then(n => n > 0), 10000, 'the command bar');
  await until(() => pg.evaluate(() => !!window.__MC_MOCK__), 10000, 'the mock backend handle');
  await pg.evaluate(() => { location.hash = '#build'; });   // the PLAY step (its phase is named `build`)
  await until(() => pg.locator('main button', { hasText: 'BUILD ▸' }).count().then(n => n > 0), 10000, 'PLAY and its BUILD link');
  await pg.locator('main button', { hasText: 'BUILD ▸' }).first().click();
  await until(() => pg.locator('text=BUILD CREATES PRESETS').count().then(n => n > 0), 10000, 'the BUILD screen');
  return pg;
}
const shot = async (pg, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f });
  return f;
};
const tab = (pg, k) => pg.locator(`[data-testid="build-tab-${k}"]`);

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step('tabs', async ({ browser, base }) => {
  for (const w of WIDTHS) {
    const pg = await open(browser, base, w);
    for (const [k, label] of [['mode', 'GAME MODE'], ['life', 'LIFE'], ['spawn', 'SPAWN'], ['primary', 'PRIMARY'],
      ['secondary', 'SECONDARY'], ['perks', 'PERKS'], ['misc_loadouts', 'MISC LOADOUTS'], ['gameplay', 'GAMEPLAY']]) {
      expect(await tab(pg, k).innerText().then(t => t.trim() === label), `${w}px: the ${k} tab reads ${label}`);
    }
    await tab(pg, 'life').click();
    await until(() => pg.locator('[data-testid^="piece-card-"]').count().then(n => n >= 3), 4000, 'the LIFE cards');
    expect(!(await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), `${w}px: no sideways page scroll`);
    ok(`${w}px: every tab renders   ${await shot(pg, `tabs-${w}`)}`);
    await pg.context().close();
  }
});

step('life', async ({ browser, base }) => {
  const pg = await open(browser, base, 1280);
  await tab(pg, 'life').click();
  await until(() => pg.locator('[data-testid="piece-card-builtin:life:standard"]').count().then(n => n === 1), 4000, 'the STANDARD card');
  await pg.locator('[data-testid="piece-card-builtin:life:standard"]').click();   // select it as the NEW template
  await pg.getByRole('button', { name: 'NEW ▸' }).click();
  await until(() => pg.locator('input[aria-label="preset name"]').count().then(n => n === 1), 4000, 'the editor');
  const name = pg.locator('input[aria-label="preset name"]');
  await name.fill('MY LIFE PRESET');
  await pg.getByLabel('max hp').fill('60');
  await pg.getByLabel('max hp').blur();
  await pg.getByRole('button', { name: 'SAVE ▸' }).click();
  await until(() => pg.locator('[data-testid^="piece-card-"]:not([data-testid^="piece-card-builtin:"])').count().then(n => n >= 1), 4000, 'the saved piece back on the shelf');
  const created = pg.locator('[data-testid^="piece-card-"]:not([data-testid^="piece-card-builtin:"])').first();
  expect((await created.innerText()).includes('MY LIFE PRESET'), 'the new LIFE preset shows its name on the shelf');
  // rename it
  await created.click();
  await until(() => pg.locator('input[aria-label="preset name"]').count().then(n => n === 1), 4000, 'the editor, reopened for the custom piece');
  await pg.locator('input[aria-label="preset name"]').fill('RENAMED PRESET');
  await pg.getByRole('button', { name: 'SAVE ▸' }).click();
  await until(() => pg.locator('[data-testid^="piece-card-"]:not([data-testid^="piece-card-builtin:"])', { hasText: 'RENAMED PRESET' }).count().then(n => n === 1), 4000, 'the rename to land');
  ok(`create + rename a LIFE preset   ${await shot(pg, 'life-renamed')}`);
  await pg.context().close();
});

step('spawn', async ({ browser, base }) => {
  const pg = await open(browser, base, 1280);
  await tab(pg, 'spawn').click();
  await until(() => pg.locator('[data-testid="piece-card-builtin:spawn:auto"]').count().then(n => n === 1), 4000, 'the AUTO card');
  await pg.locator('[data-testid="piece-card-builtin:spawn:auto"]').click();
  await pg.getByRole('button', { name: 'NEW ▸' }).click();
  await until(() => pg.getByLabel('respawn delay seconds').count().then(n => n === 1), 4000, 'the SPAWN editor');
  expect((await pg.getByLabel('respawn delay seconds').inputValue()) === '15', 'AUTO starts at the 15s delay');
  await pg.getByRole('group', { name: 'respawn type' }).getByRole('button', { name: 'STATION' }).click();
  // ValueBox's draft state syncs from the new `value` prop on the NEXT render after the click's own
  // state update (its own useEffect, src/ui/index.tsx) — a bare read races that tick under load, so
  // poll rather than assert immediately (CLAUDE.md "wait for a condition, not a fixed sleep").
  await until(() => pg.getByLabel('respawn delay seconds').inputValue().then(v => v === '10'), 3000, 'the 10s delay from the STATION builtin');
  ok('switching to STATION shows the 10s delay from its own builtin');
  // the 1-2s wedge guard: stepping the delay to 1 must snap away, never save as 1
  const delay = pg.getByLabel('respawn delay seconds');
  await delay.fill('1'); await delay.blur();
  await until(() => delay.inputValue().then(v => v === '0' || v === '3'), 3000, 'the delay to snap away from 1-2s');
  ok(`a 1s delay is refused by the guard (now ${await delay.inputValue()})`);
  ok(`AUTO→STATION delay + the 1-2s guard   ${await shot(pg, 'spawn-guard')}`);
  await pg.context().close();
});

step('type-toggle', async ({ browser, base }) => {
  // F411 type toggles (games-presets.md, docs/spec/design/games-presets.md §5): building a PRIMARY
  // preset from RIFLES + LONG RANGE must select exactly the union of both types, save, and land the
  // new preset on the BUILD shelf — screen-truth, not internal state (ui-build-verify §4).
  const pg = await open(browser, base, 1280);
  await tab(pg, 'primary').click();
  await until(() => pg.locator('[data-testid="piece-card-builtin:primary:all"]').count().then(n => n === 1), 4000, 'the ALL card');
  await pg.locator('[data-testid="piece-card-builtin:primary:all"]').click();
  await pg.getByRole('button', { name: 'NEW ▸' }).click();
  await until(() => pg.locator('[data-testid="slot-type-row"]').count().then(n => n === 1), 4000, 'the TYPE row');
  await pg.locator('input[aria-label="preset name"]').fill('RIFLES PRESET');

  const typeRow = pg.locator('[data-testid="slot-type-row"]');
  const onlyRow = pg.locator('[data-testid="slot-only-row"]');
  // strip the locked chip's "🔒 " prefix (games-presets.md's own note: a weapon covered by an active
  // type toggle cannot be un-picked by its own chip) so a name still compares exactly
  const selectedNames = () => onlyRow.locator('button[aria-pressed="true"]').allInnerTexts()
    .then(texts => texts.map(t => t.replace(/^🔒\s*/, '')));

  expect((await selectedNames()).length === 0, 'ALL starts with no weapon chip selected (empty = any of the above)');
  await typeRow.getByRole('button', { name: 'RIFLES', exact: true }).click();
  await until(() => selectedNames().then(n => n.length === 7), 3000, 'RIFLES alone to select 7 weapons');
  ok('RIFLES alone selects its 7 weapons');
  // LONG RANGE now reads PARTIAL (2 of its 3 ids already selected via RIFLES: SNIPER RIFLE and CHARGE
  // RIFLE are both `rifle` and `long`) -- its label is `◐ LONG RANGE 2/3`, so match loosely rather
  // than by the exact OFF-state text.
  await typeRow.getByRole('button', { name: /LONG RANGE/ }).click();
  await until(() => selectedNames().then(n => n.length === 8), 3000, 'RIFLES + LONG RANGE to union to 8 weapons');
  const names = await selectedNames();
  expect(names.includes('AMR'), `AMR (long-only) joins the union (saw ${JSON.stringify(names)})`);
  expect(names.includes('ASSAULT RIFLE'), 'ASSAULT RIFLE (rifle) stays selected');
  expect(!names.includes('SMG'), 'SMG (neither type) is never selected');
  expect((await typeRow.getByRole('button', { name: 'RIFLES', exact: true }).getAttribute('aria-pressed')) === 'true', 'RIFLES toggle itself reads ON');
  expect((await typeRow.getByRole('button', { name: /LONG RANGE/ }).getAttribute('aria-pressed')) === 'true', 'LONG RANGE toggle itself reads ON');
  ok(`RIFLES + LONG RANGE unions to 8 weapons on screen   ${await shot(pg, 'type-toggle-union')}`);

  // turning RIFLES back off must drop the rifle-only weapons but keep the ones LONG RANGE still covers
  await typeRow.getByRole('button', { name: 'RIFLES', exact: true }).click();
  await until(() => selectedNames().then(n => n.length === 3), 3000, 'RIFLES off to drop to LONG RANGE\'s own 3');
  const afterOff = await selectedNames();
  expect(afterOff.includes('AMR') && afterOff.includes('SNIPER RIFLE') && afterOff.includes('CHARGE RIFLE'),
    `LONG RANGE still covers AMR/SNIPER RIFLE/CHARGE RIFLE (saw ${JSON.stringify(afterOff)})`);
  expect(!afterOff.includes('ASSAULT RIFLE'), 'ASSAULT RIFLE (rifle-only) is dropped once RIFLES is off');
  ok('toggling RIFLES off keeps only the weapons LONG RANGE still covers');

  await pg.getByRole('button', { name: 'SAVE ▸' }).click();
  await until(() => pg.locator('[data-testid^="piece-card-"]:not([data-testid^="piece-card-builtin:"])', { hasText: 'RIFLES PRESET' }).count().then(n => n === 1), 4000, 'the saved preset back on the BUILD shelf');
  ok(`RIFLES PRESET lands on the PRIMARY shelf   ${await shot(pg, 'type-toggle-saved')}`);
  await pg.context().close();
});

step('type-toggle-narrow', async ({ browser, base }) => {
  // The same editor at 900px — the toggle row must still lay out with no page scroll (checklist §6).
  const pg = await open(browser, base, 900);
  await tab(pg, 'primary').click();
  await pg.locator('[data-testid="piece-card-builtin:primary:all"]').click();
  await pg.getByRole('button', { name: 'NEW ▸' }).click();
  await until(() => pg.locator('[data-testid="slot-type-row"]').count().then(n => n === 1), 4000, 'the TYPE row at 900px');
  expect(!(await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), '900px: no sideways page scroll with the TYPE row shown');
  ok(`the TYPE row at 900px   ${await shot(pg, 'type-toggle-900')}`);
  await pg.context().close();
});

step('delete', async ({ browser, base }) => {
  const pg = await open(browser, base, 1280);
  await tab(pg, 'misc_loadouts').click();
  await until(() => pg.locator('[data-testid="piece-card-builtin:misc_loadouts:standard"]').count().then(n => n === 1), 4000, 'the STANDARD card');
  await pg.locator('[data-testid="piece-card-builtin:misc_loadouts:standard"]').click();
  await pg.getByRole('button', { name: 'NEW ▸' }).click();
  await pg.locator('input[aria-label="preset name"]').fill('TO DELETE');
  await pg.getByRole('button', { name: 'SAVE ▸' }).click();
  await until(() => pg.locator('[data-testid^="piece-card-"]:not([data-testid^="piece-card-builtin:"])', { hasText: 'TO DELETE' }).count().then(n => n === 1), 4000, 'the piece to delete');
  await pg.locator('[data-testid^="piece-card-"]:not([data-testid^="piece-card-builtin:"])', { hasText: 'TO DELETE' }).click();
  await until(() => pg.getByRole('button', { name: 'DELETE' }).count().then(n => n === 1), 4000, 'the editor');
  await pg.getByRole('button', { name: 'DELETE' }).click();
  await until(() => pg.getByRole('button', { name: 'CONFIRM DELETE' }).count().then(n => n === 1), 2000, 'the two-tap confirm');
  await pg.getByRole('button', { name: 'CONFIRM DELETE' }).click();
  await until(() => pg.locator('[data-testid^="piece-card-"]:not([data-testid^="piece-card-builtin:"])', { hasText: 'TO DELETE' }).count().then(n => n === 0), 4000, 'the piece to be gone');
  ok(`two-tap delete   ${await shot(pg, 'delete-two-tap')}`);
  await pg.context().close();
});

step('save-error', async ({ browser, base }) => {
  const pg = await open(browser, base, 1280);
  await pg.evaluate(() => { window.__MC_MOCK__.createPiece = async () => { const e = new Error('DELAY MUST BE 0 OR AT LEAST 3 SECONDS'); e.status = 400; throw e; }; });
  await tab(pg, 'life').click();
  await pg.locator('[data-testid="piece-card-builtin:life:standard"]').click();
  await pg.getByRole('button', { name: 'NEW ▸' }).click();
  await pg.locator('input[aria-label="preset name"]').fill('WILL FAIL');
  await pg.getByRole('button', { name: 'SAVE ▸' }).click();
  await until(() => pg.locator('header button[role="alert"]').count().then(n => n > 0), 4000, 'the error strip');
  const t = await pg.locator('header button[role="alert"]').innerText();
  expect(/DELAY MUST BE 0 OR AT LEAST 3 SECONDS/.test(t), `the error strip shows the server's own words (saw ${JSON.stringify(t)})`);
  ok(`a server refusal on SAVE shows in the error strip   ${await shot(pg, 'save-error')}`);
  await pg.context().close();
});

step('leave-confirm', async ({ browser, base }) => {
  const pg = await open(browser, base, 1280);
  await tab(pg, 'life').click();
  await pg.locator('[data-testid="piece-card-builtin:life:standard"]').click();
  await pg.getByRole('button', { name: 'NEW ▸' }).click();
  await pg.locator('input[aria-label="preset name"]').fill('DIRTY DRAFT');
  await pg.getByRole('button', { name: '◂ BACK TO LIFE' }).click();
  await until(() => pg.locator('[data-testid="build-confirm-leave"]').count().then(n => n === 1), 2000, 'the unsaved-leave confirm');
  expect((await pg.locator('input[aria-label="preset name"]').count()) === 1, 'the editor is still open after the first BACK tap');
  await pg.getByRole('button', { name: '◂ BACK TO LIFE' }).click();
  await until(() => pg.locator('input[aria-label="preset name"]').count().then(n => n === 0), 2000, 'the editor to close on the second tap');
  ok(`leave-with-unsaved-edits asks once   ${await shot(pg, 'leave-confirm')}`);
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
main();
