// The console frame (command bar, WSL note, PANIC, Report a problem), clicked in a real browser.
//
// Visual QA 2026-09-23 found these by eye (M9, M10, M21, M22). `test/frame-qa.test.tsx` pins the
// copy and the roles in jsdom; this proves the parts jsdom cannot see: layout (one row from 900 px,
// errors in a strip of their own), the computed colour of the WSL note, the drawn info mark, and
// where the browser actually leaves keyboard focus.
//
// `?mock` is entirely client-side, so this needs only the vite dev server (no python MC), the same
// as backhaul.mjs.
//
//   node test/e2e/frame.mjs               # every step
//   ONLY=<step> node test/e2e/frame.mjs   # one step: bar | note | panic | report
//   VITE_PORT=…                           # pin the dev server port (default: a free one)
//   HEADED=1 / KEEP_SHOTS=1
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC = path.resolve(HERE, '../..');                 // webapp/mc
const SHOTS = path.join(HERE, 'shots', 'frame');        // this script's own folder
const ONLY = process.env.ONLY || '';
const WIDTHS = [1440, 1280, 900];

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

async function open(browser, base, query, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => failures.push(`${current}: [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') failures.push(`${current}: [console] ${m.text().slice(0, 300)}`); });
  await pg.goto(`${base}/${query}`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header nav').count().then(n => n > 0), 10000, 'the command bar');
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 12000, 'the first snapshot');
  await until(() => pg.evaluate(() => !!window.__MC_MOCK__), 10000, 'the mock backend handle');
  return pg;
}
const shot = async (pg, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f });
  return f;
};
/** Where the bar's parts sit: every tab's top, the ☰ button's box, the first error's top. */
const layout = pg => pg.evaluate(() => {
  const r = el => el && el.getBoundingClientRect();
  const tabs = [...document.querySelectorAll('header nav button')].map(r);
  const menu = r(document.querySelector('header button[aria-haspopup="menu"]'));
  const err = r(document.querySelector('header button[role="alert"]'));
  return {
    tabRows: new Set(tabs.map(t => Math.round(t.top))).size,
    tabTop: Math.round(Math.min(...tabs.map(t => t.top))), tabBottom: Math.round(Math.max(...tabs.map(t => t.bottom))),
    menuMid: menu ? Math.round(menu.top + menu.height / 2) : null,
    errTop: err ? Math.round(err.top) : null,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  };
});
const LONG = 'station_source must be null or one of: grenade, medic, ammo, flag, hill, respawn, base, bomb, vip, supply, relay, beacon, and the rest of the legal vocabulary';

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step('bar', async ({ browser, base }) => {
  for (const w of WIDTHS) {
    for (const view of ['muster', 'build']) {
      const pg = await open(browser, base, `?mock&lanwarn=1#${view}`, w);
      const l = await layout(pg);
      expect(l.tabRows === 1, `${w}px ${view}: the five tabs sit on one row (saw ${l.tabRows} rows)`);
      expect(l.menuMid != null && l.menuMid >= l.tabTop && l.menuMid <= l.tabBottom, `${w}px ${view}: the ☰ button is on the tabs' row (mid ${l.menuMid}, tabs ${l.tabTop}-${l.tabBottom})`);
      expect(!l.overflow, `${w}px ${view}: no sideways page scroll`);
      await pg.context().close();
    }
    // a long server refusal, forced through the console's real run() path
    const pg = await open(browser, base, '?mock#muster', w);
    await pg.evaluate(msg => { window.__MC_MOCK__.control = async () => { throw new Error(msg); }; }, LONG);
    await pg.click('header button[aria-haspopup="menu"]');
    await pg.locator('header [role="menu"] button', { hasText: 'Panic' }).click();
    await pg.locator('header [role="menu"] button', { hasText: 'CONFIRM' }).click();
    await until(() => pg.locator('header button[role="alert"]').count().then(n => n > 0), 4000, 'the error strip');
    const l = await layout(pg);
    expect(l.tabRows === 1, `${w}px with an error: the tabs stay on one row (saw ${l.tabRows})`);
    expect(l.errTop != null && l.errTop >= l.tabBottom, `${w}px: the error sits in its own strip under the bar (error top ${l.errTop}, tabs end ${l.tabBottom})`);
    expect(l.menuMid >= l.tabTop && l.menuMid <= l.tabBottom, `${w}px with an error: the ☰ button stays on the tabs' row`);
    ok(`${w}px: one row, and the error below it   ${await shot(pg, `bar-error-${w}`)}`);
    await pg.context().close();
  }
});

step('note', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock&lanwarn=1#muster', 1280);
  const note = pg.locator('[data-testid="lan-warning"]');
  await until(() => note.count().then(n => n === 1), 6000, 'the WSL note');
  const m = await note.evaluate(el => {
    const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const icon = el.querySelector('svg[data-icon="info"]'), ib = icon && icon.getBoundingClientRect();
    const reds = [el, ...el.querySelectorAll('*')].filter(e => /rgb\(255, 82, 82\)/.test(getComputedStyle(e).color) || /rgba?\(255, 82, 82/.test(getComputedStyle(e).backgroundColor)).length;
    return { h: Math.round(b.height), role: el.getAttribute('role'), color: cs.color, reds, icon: ib ? Math.round(ib.width) : 0 };
  });
  expect(m.h <= 44, `the note is one compact line (${m.h}px tall)`);
  expect(m.role === 'status', `the note is a status, not an alert (role ${m.role})`);
  expect(m.reds === 0, `nothing in the note is alarm red (${m.reds} red elements)`);
  expect(m.icon >= 10, `the info mark is drawn (${m.icon}px wide)`);
  expect(!(await note.innerText()).includes('--advertise'), 'the how-to is folded until asked');
  await note.locator('button', { hasText: 'HOW TO FIX' }).click();
  expect((await note.innerText()).includes('--advertise'), 'HOW TO FIX shows the how-to');
  ok(`the WSL note: ${m.h}px, ${m.role}, not red   ${await shot(pg, 'note-expanded')}`);
  await pg.locator('header nav button', { hasText: 'LOBBY' }).click();
  await until(() => note.isVisible(), 4000, 'the note on LOBBY too');
  ok('the note stays visible on another screen');
  await pg.context().close();
});

step('panic', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#muster', 1440);
  await pg.click('header button[aria-haspopup="menu"]');
  await pg.locator('header [role="menu"] button', { hasText: 'Panic' }).click();
  const warn = await pg.locator('[data-testid="panic-warning"]').innerText().catch(() => '');
  expect(/no gun can be hit until you re-arm it/i.test(warn), `the confirm warns about the re-arm (saw ${JSON.stringify(warn)})`);
  await pg.locator('header [role="menu"] button', { hasText: 'CONFIRM' }).click();
  await until(() => pg.locator('header', { hasText: 'FLEET SAFED' }).count().then(n => n > 0), 4000, 'the PANIC receipt');
  const t = await pg.locator('[data-testid="cb-notices"]').innerText().catch(() => '');
  expect(/\d+ OF \d+ NODES/.test(t), `the receipt counts the nodes (saw ${JSON.stringify(t)})`);
  expect(/\(\d\d:\d\d:\d\d\)/.test(t) && !/[AP]M/.test(t), `the receipt uses a 24-hour clock (saw ${JSON.stringify(t)})`);
  ok(`PANIC confirm and receipt   ${await shot(pg, 'panic-receipt')}`);
  await pg.context().close();
});

step('report', async ({ browser, base }) => {
  const pg = await open(browser, base, '?mock#muster', 1280);
  const inside = () => pg.evaluate(() => !!document.querySelector('[data-testid="report-panel"]')?.contains(document.activeElement));
  await pg.click('header button[aria-haspopup="menu"]');
  await pg.locator('header [role="menu"] button', { hasText: 'Report a problem' }).click();
  await until(() => pg.locator('[data-testid="report-panel"]').count().then(n => n > 0), 4000, 'the dialog');
  expect(await inside(), 'focus is inside the dialog when it opens');
  await pg.locator('[data-testid="report-panel"] button', { hasText: 'MAKE REPORT' }).click();
  await until(() => pg.locator('[data-report-phase="done"]').count().then(n => n > 0), 8000, 'the report to be made');
  expect(await inside(), 'focus is still inside the dialog once the report is made (MAKE REPORT is gone)');
  const priv = await pg.locator('[data-testid="report-privacy"]').innerText().catch(() => '');
  expect(/GitHub issues are public/.test(priv), 'the privacy warning is still on screen beside the download');
  ok(`focus held, warning kept   ${await shot(pg, 'report-done')}`);
  await pg.keyboard.press('Escape');
  expect(await pg.evaluate(() => document.activeElement?.getAttribute('aria-haspopup') === 'menu'), 'Escape returns focus to the ☰ button');
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
