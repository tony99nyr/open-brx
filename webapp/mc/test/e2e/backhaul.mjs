// A28 backhaul — the Armory REACH panel and Lobby coverage/reach readout, clicked in a real browser.
//
// `?mock` is entirely client-side (MockBackend), so this script needs only `npm run dev` — no
// python MC, per webapp/mc/README.md ("MC drives nothing"). It still runs against the REAL vite dev
// server serving the REAL source, in a REAL Chromium page: no stand-in, per the ui-build-verify
// skill and koth.mjs's own precedent (its `mode-card-host-call` step already opens `?mock#build`
// this same way).
//
//   node test/e2e/backhaul.mjs            # all steps
//   ONLY=<step> node test/e2e/backhaul.mjs
//   HEADED=1 / KEEP_SHOTS=1
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC = path.resolve(HERE, '../..');   // webapp/mc
const SHOTS = path.join(HERE, 'shots');
const ONLY = process.env.ONLY || '';

let failures = [];
let currentStep = '';
const expect = (cond, what) => {
  if (cond) return true;
  failures.push(`${currentStep}: ${what}`);
  console.log(`    ✗ ${what}`);
  return false;
};
let stepFailedAt = 0;
const ok = what => console.log(failures.length > stepFailedAt ? `    ⊘ ${what} (step already failed above)` : `    ✓ ${what}`);
const until = async (pred, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = false;
    try { v = await pred(); } catch { v = false; }
    if (v) return true;
    if (Date.now() > end) { expect(false, `timed out waiting for ${what}`); return false; }
    await new Promise(r => setTimeout(r, 60));
  }
};

const killGroup = proc => new Promise(done => {
  let settled = false;
  const finish = () => { if (!settled) { settled = true; done(); } };
  proc.once('exit', finish);
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch { /* already gone */ } }
  setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* gone */ } finish(); }, 3000).unref();
});
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});

/** `npm run dev` — the same command the owner types. No python MC: `?mock` needs no server. */
async function startVite() {
  const port = await freePort();
  const proc = spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort'], { cwd: MC, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite dev: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.error(`npm run dev DID NOT START:\n${log}`);
  proc.kill('SIGKILL'); process.exit(3);
}

async function newPage(browser, base, viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => failures.push(`${currentStep}: [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') failures.push(`${currentStep}: [console] ${m.text().slice(0, 300)}`); });
  pg.__base = base;
  return pg;
}
async function go(pg, view) {
  await pg.goto(`${pg.__base}/?mock#${view}`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header').count().then(n => n > 0), 8000, 'the command bar to render');
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 12000, 'the first snapshot');
  return pg;
}
const closePage = async pg => { await pg.context().close(); };
const shot = async (pg, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const f = path.join(SHOTS, `${name}.png`);
  await pg.evaluate(() => { window.scrollTo(0, 0); document.querySelector('main')?.scrollTo(0, 0); }).catch(() => {});
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: f, fullPage: false });
  return f;
};

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step('reach-panel-visible-off', async ({ browser, base }) => {
  const pg = await go(await newPage(browser, base), 'muster');
  const reach = pg.locator('main', { hasText: '▸ REACH' });
  await until(() => reach.count().then(n => n > 0), 8000, 'the REACH panel to render');
  expect(await reach.isVisible(), 'the REACH panel is visible on the ARMORY/muster screen');
  expect(await pg.locator('main', { hasText: 'BRX-FIELD' }).count() > 0, 'the NETWORK row names the demo SSID');
  const turnOn = pg.locator('button', { hasText: 'TURN ON' });
  await until(() => turnOn.count().then(n => n > 0), 4000, 'a TURN ON control');
  expect(await turnOn.isEnabled(), 'TURN ON is enabled — the mock tunnel is available and off');
  ok(`REACH panel renders with the tunnel OFF  ${await shot(pg, 'b01-off')}`);
  await closePage(pg);
});

step('turn-on-through-starting-to-up', async ({ browser, base }) => {
  const pg = await go(await newPage(browser, base), 'muster');
  const turnOn = pg.locator('button', { hasText: 'TURN ON' });
  await until(() => turnOn.count().then(n => n > 0), 8000, 'TURN ON to render');
  await turnOn.click();
  await until(() => pg.locator('main', { hasText: 'STARTING' }).count().then(n => n > 0), 4000, 'STARTING… to show right after the click');
  expect(await pg.locator('button', { hasText: 'TURN ON' }).count() === 0, 'the button is not offering TURN ON while starting');
  ok(`STARTING… renders immediately after TURN ON  ${await shot(pg, 'b02-starting')}`);
  await until(() => pg.locator('text=trycloudflare.com').count().then(n => n > 0), 6000, 'the tunnel to come UP');
  const upRow = await pg.locator('main', { hasText: 'trycloudflare.com' }).first().textContent();
  expect(/UP.*trycloudflare\.com/.test(upRow ?? ''), `the INTERNET row reads UP <hostname> (saw ${JSON.stringify(upRow)})`);
  const turnOff = pg.locator('button', { hasText: 'TURN OFF' });
  expect(await turnOff.count() > 0, 'the control now offers TURN OFF');
  ok(`tunnel reaches UP with a trycloudflare.com hostname  ${await shot(pg, 'b03-up')}`);
  await closePage(pg);
});

step('qr-caption-follows-tunnel-status', async ({ browser, base }) => {
  const pg = await go(await newPage(browser, base), 'muster');
  const showQr = pg.locator('button', { hasText: 'SHOW QR CODES' });
  await until(() => showQr.count().then(n => n > 0), 8000, 'the SHOW QR CODES toggle');
  await showQr.click();
  await until(() => pg.locator('text=CARRIES THE LAN JOIN ONLY').count().then(n => n > 0), 4000, 'the LAN-only caption while the tunnel is off');
  ok('QR caption reads LAN JOIN ONLY with the tunnel off');
  await pg.locator('button', { hasText: 'TURN ON' }).click();
  await until(() => pg.locator('text=CARRIES THE LAN + INTERNET JOIN').count().then(n => n > 0), 6000, 'the caption to switch once the tunnel is up');
  ok(`QR caption switches to LAN + INTERNET once UP  ${await shot(pg, 'b04-qr-caption')}`);
  await closePage(pg);
});

// The mock's `?mock&tunnelfail=1` debug hook (backend.ts) makes the NEXT TURN ON fail instead of
// coming up — there is no real cloudflared process here to kill, so this is the only way to drive
// the ERROR state from a browser. The banner lives in CommandBar (the shared frame), so the real
// assertion is that it survives a navigation to a screen that never touches the REACH panel at all.
step('tunnel-error-banner-persists-across-screens', async ({ browser, base }) => {
  const pg = await newPage(browser, base);
  await pg.goto(`${pg.__base}/?mock&tunnelfail=1#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('header').count().then(n => n > 0), 8000, 'the command bar to render');
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 12000, 'the first snapshot');
  const bannerSel = 'header [role="alert"]:has-text("TUNNEL DOWN")';
  expect(await pg.locator(bannerSel).count() === 0, 'no banner before the tunnel has ever been touched');
  await pg.locator('button', { hasText: 'TURN ON' }).click();
  await until(() => pg.locator(bannerSel).count().then(n => n > 0), 6000, 'the persistent tunnel-down banner after the simulated failure');
  const txt = await pg.locator(bannerSel).first().textContent();
  expect(/INTERNET TUNNEL DOWN/.test(txt ?? ''), `the banner names the outage (saw ${JSON.stringify(txt)})`);
  expect(/PHONES FELL BACK TO WI-FI/.test(txt ?? ''), 'the banner explains the fallback');
  expect(/cloudflared exited/i.test(txt ?? ''), 'the banner carries the server-supplied reason, never swallowed');
  ok(`tunnel-down banner appears on ARMORY after a simulated failure  ${await shot(pg, 'b08-tunnel-error-armory')}`);
  // the whole point of putting it in the shared frame: it must ride to a screen that never renders
  // the REACH panel at all, not just the one with the TURN ON/OFF control. Click the real nav tab —
  // `go()` re-navigates with a hard-coded `?mock` query, which drops `tunnelfail=1` and forces a full
  // reload that resets the mock's in-memory state, making this assertion pass for the wrong reason.
  await pg.locator('nav button', { hasText: 'LOBBY' }).click();
  await until(() => pg.locator('main', { hasText: '[ A5 // LOBBY ]' }).count().then(n => n > 0), 8000, 'LOBBY to render');
  await until(() => pg.locator(bannerSel).count().then(n => n > 0), 6000, 'the banner to persist onto LOBBY');
  expect(await pg.locator(bannerSel).first().isVisible(), 'the banner is visible on LOBBY, not only ARMORY');
  ok(`tunnel-down banner persists onto LOBBY  ${await shot(pg, 'b09-tunnel-error-lobby')}`);
  await closePage(pg);
});

step('lobby-coverage-and-reach-tags', async ({ browser, base }) => {
  // Turn the tunnel on from ARMORY first (`?mock` shares no state across pages/tabs — same tab, new view).
  const pg = await go(await newPage(browser, base), 'muster');
  await pg.locator('button', { hasText: 'TURN ON' }).click();
  await until(() => pg.locator('text=trycloudflare.com').count().then(n => n > 0), 6000, 'the tunnel to come up before checking LOBBY');
  await go(pg, 'lobby');
  const coverage = pg.locator('main', { hasText: /COVERAGE/ });
  await until(() => coverage.count().then(n => n > 0), 8000, 'a coverage line to render');
  const covTxt = await coverage.first().textContent();
  expect(/(FULL COVERAGE|COVERAGE ZONES) — \d+ OF \d+ ON THE INTERNET PATH/.test(covTxt ?? ''), `the coverage line has the expected shape (saw ${JSON.stringify(covTxt)})`);
  // S40 (field 2026-09-12): the tag reads INTERNET now, not BACKHAUL — the old word read as "on
  // cellular" to an operator, when it is a fact about the PATH to MC.
  const internetTags = pg.locator('span', { hasText: /^INTERNET$/ });
  await until(() => internetTags.count().then(n => n > 0), 6000, 'at least one roster row tagged INTERNET');
  const lanTags = pg.locator('span', { hasText: /^LAN$/ });
  expect(await lanTags.count() > 0, 'at least one roster row still tagged LAN (the demo mixes both)');
  ok(`LOBBY shows a coverage line and per-node LAN/INTERNET tags  ${await shot(pg, 'b05-lobby-coverage')}`);
  await closePage(pg);
});

step('small-viewport-no-overflow', async ({ browser, base }) => {
  const pg = await newPage(browser, base, { width: 393, height: 830 });   // Pixel 4 — webapp/mc/README's target device
  await go(pg, 'muster');
  await until(() => pg.locator('main', { hasText: '▸ REACH' }).count().then(n => n > 0), 8000, 'the REACH panel at phone width');
  const overflow = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 1, `no horizontal page scroll at 393px (overflow ${overflow}px)`);
  await pg.locator('button', { hasText: 'TURN ON' }).click();
  await until(() => pg.locator('text=trycloudflare.com').count().then(n => n > 0), 6000, 'the tunnel to come up at phone width');
  ok(`REACH panel usable with no horizontal overflow at 393px  ${await shot(pg, 'b06-narrow-armory')}`);
  await go(pg, 'lobby');
  await until(() => pg.locator('span', { hasText: /^INTERNET$/ }).first().isVisible().catch(() => false), 8000, 'an INTERNET tag at phone width');
  const overflow2 = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow2 <= 1, `no horizontal page scroll on LOBBY at 393px (overflow ${overflow2}px)`);
  ok(`LOBBY reach tags/coverage line usable at 393px  ${await shot(pg, 'b07-narrow-lobby')}`);
  await closePage(pg);
});

// --- field 2026-09-12 additions: 27b (turn-off confirm), F144 (backhaul reads READY), F143 (no
// placeholder network name), F138 (join QR size) --- one step, since all four ride on the same
// ARMORY page and turning the tunnel on once covers them all.
step('field-2026-09-12-armory-checks', async ({ browser, base }) => {
  const pg = await go(await newPage(browser, base), 'muster');
  await pg.locator('button', { hasText: 'TURN ON' }).click();
  await until(() => pg.locator('text=trycloudflare.com').count().then(n => n > 0), 6000, 'the tunnel to come up');

  // F144: a gun card reached over the internet path still reads READY, with an INTERNET tag beside
  // it — never CHECK/amber for that alone.
  const internetCard = pg.locator('main div', { hasText: 'INTERNET' }).filter({ hasText: 'READY' });
  await until(() => internetCard.count().then(n => n > 0), 6000, 'a gun card showing both INTERNET and READY');
  expect(await internetCard.count() > 0, 'at least one card is READY (not CHECK) while on the internet path');
  ok(`a backhaul-reached gun card reads READY with an INTERNET tag  ${await shot(pg, 'b08-internet-ready')}`);

  // F138: the join QR is at least 280px on this desktop viewport, with the hold-the-phone hint.
  await pg.locator('button', { hasText: 'SHOW QR CODES' }).click();
  const qr = pg.locator('img[alt="node join QR"]');
  await until(() => qr.count().then(n => n > 0), 4000, 'the join QR image');
  const box = await qr.first().boundingBox();
  expect(!!box && box.width >= 280, `the join QR renders at least 280px wide (saw ${box && box.width})`);
  expect(await pg.locator('text=HOLD THE PHONE 20').count() > 0, 'the "hold the phone" hint is shown beside the QR');
  ok(`join QR is ≥280px with the distance hint  ${await shot(pg, 'b09-qr-size')}`);

  // 27b: turning the tunnel OFF warns once before it does anything.
  const turnOff = pg.locator('button', { hasText: 'TURN OFF' });
  await turnOff.click();
  await until(() => pg.locator('text=EVERY PHONE ON THE INTERNET PATH WILL DROP').count().then(n => n > 0), 3000, 'the drop-warning to appear on the first tap');
  expect(await pg.locator('text=trycloudflare.com').count() > 0, 'the tunnel is still UP after only one tap — nothing happened yet');
  ok(`turning the tunnel off warns before doing anything  ${await shot(pg, 'b10-turnoff-confirm')}`);
  await pg.locator('button', { hasText: 'CONFIRM' }).click();
  await until(() => pg.locator('text=trycloudflare.com').count().then(n => n === 0), 4000, 'the tunnel to actually go off after the second tap');
  ok(`the second tap actually turns the tunnel off  ${await shot(pg, 'b11-turnoff-done')}`);
  await closePage(pg);
});

step('field-2026-09-12-network-row-and-stale-reach', async ({ browser, base }) => {
  // F143: no SSID known — the NETWORK row must say "LAN", never a mode word standing in for one.
  const pg1 = await newPage(browser, base);
  await pg1.goto(`${pg1.__base}/?mock&nossid=1#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => pg1.locator('main', { hasText: '▸ REACH' }).count().then(n => n > 0), 8000, 'the REACH panel');
  expect(await pg1.locator('main', { hasText: 'LAN ·' }).count() > 0, 'the NETWORK row falls back to "LAN ·", not a placeholder mode word');
  expect(await pg1.locator('main', { hasText: 'UNKNOWN ·' }).count() === 0, 'never prints "UNKNOWN ·" as a network name');
  ok(`NETWORK row never shows a placeholder word  ${await shot(pg1, 'b12-no-ssid')}`);
  await closePage(pg1);

  // F155: a node whose last known path was the internet reads NOT REACHED FOR <age>, never WRONG WI-FI.
  const pg2 = await newPage(browser, base);
  await pg2.goto(`${pg2.__base}/?mock&laststale=1#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => pg2.locator('main', { hasText: 'READINESS BOARD' }).count().then(n => n > 0), 8000, 'the readiness board');
  await until(() => pg2.locator('text=NOT REACHED FOR').count().then(n => n > 0), 6000, 'the honest stale-reach reason');
  expect(await pg2.locator('text=WRONG WI-FI').count() === 0, 'never blames the phone\'s Wi-Fi for a dropped tunnel');
  ok(`a node last seen on the internet path reads NOT REACHED FOR, not WRONG WI-FI  ${await shot(pg2, 'b13-last-stale')}`);
  await closePage(pg2);

  // F142: a restored session shows the banner and FRESH SESSION clears it.
  const pg3 = await newPage(browser, base);
  await pg3.goto(`${pg3.__base}/?mock&restored=1#muster`, { waitUntil: 'domcontentloaded' });
  const banner = pg3.locator('[data-testid="restored-banner"]');
  await until(() => banner.count().then(n => n > 0), 8000, 'the restored-session banner');
  expect(await banner.textContent().then(t => (t ?? '').includes('RESTORED FROM')), 'the banner names when the session was restored');
  await pg3.locator('button', { hasText: 'FRESH SESSION' }).click();
  await until(() => banner.count().then(n => n === 0), 4000, 'the banner to clear after FRESH SESSION');
  ok(`restored-session banner shows and FRESH SESSION clears it  ${await shot(pg3, 'b14-restored')}`);
  await closePage(pg3);
});

async function main() {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const vite = await startVite();
  const ctx = { browser, base: vite.base };
  const toRun = ONLY ? steps.filter(s => s.name === ONLY) : steps;
  if (ONLY && toRun.length === 0) { console.error(`no step named "${ONLY}" — have: ${steps.map(s => s.name).join(', ')}`); process.exit(2); }
  if (!process.env.KEEP_SHOTS) { fs.rmSync(SHOTS, { recursive: true, force: true }); }
  for (const s of toRun) {
    currentStep = s.name;
    stepFailedAt = failures.length;
    console.log(`\n▸ ${s.name}`);
    try { await s.fn(ctx); } catch (e) { failures.push(`${s.name}: threw ${e && e.stack || e}`); console.log(`    ✗ threw: ${e && e.message || e}`); }
  }
  await browser.close();
  await vite.stop();
  console.log(`\n${failures.length === 0 ? '✓ ALL PASS' : `✗ ${failures.length} FAILURE(S)`}`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(failures.length === 0 ? 0 : 1);
}
main();
