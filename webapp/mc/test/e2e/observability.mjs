// O6 / O7 / O8 / O10: the failures MC and the nodes used to swallow, shown on the console, in a real browser.
//
//   node test/e2e/observability.mjs                 # every step
//   ONLY=<step> node test/e2e/observability.mjs     # one step: mock | real | join
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… SHOTS_DIR=… HEADED=1
//
// `mock`: `?mock&obs=<failure>` shows every chip from the in-browser backend (src/mock/backend.ts).
// `real`: a real demo MC on its own free ports, with real node sockets (live_nodes.py stand-ins for a phone
// and a Stick). The failures are MC's own code paths: a read-only session directory makes the real snapshot
// write fail; `fixtures/obs_patch/sitecustomize.py` makes `Store.log` and `Session.tick` raise on demand
// (a full disk and a bad tick cannot be had any other way). Each chip must appear AND clear again.
// `join`: a second MC whose `join_info()` raises at start-up.
//
// Every chip is also checked for its catalogue severity (data-sev) and its "WHAT IS WRONG: WHAT TO DO" words.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import * as H from './lib/mc-harness.mjs';

const OUT = path.join(H.E2E_DIR, 'shots', 'observability');
const SHOTS = process.env.SHOTS_DIR || OUT;
const ONLY = process.env.ONLY || '';
const c = H.checker();
const errors = [];
const P = await H.ports();
const sh = (pg, name) => H.shot(pg, SHOTS, name);
let mc = null, vite = null, browser = null, nodes = null;

/** Phone and Stick stand-ins on MC's real node socket (live_nodes.py), driven one line at a time. */
async function startNodes(wsUrl, specs) {
  const proc = spawn(H.devPython(), [path.join(H.E2E_DIR, 'live_nodes.py'), wsUrl, ...specs],
    { cwd: path.join(H.REPO, 'mcp'), stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { ...process.env, BRX_MCP_HOME: path.join(OUT, 'home') } });
  const lines = []; let err = '';
  proc.stderr.on('data', d => { err += d; });
  readline.createInterface({ input: proc.stdout }).on('line', l => lines.push(l));
  const next = async (re, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = lines.findIndex(l => re.test(l));
      if (i >= 0) return lines.splice(i, 1)[0];
      if (lines.some(l => l.startsWith('err '))) throw new Error(`live_nodes: ${lines.find(l => l.startsWith('err '))}`);
      if (Date.now() > end || proc.exitCode != null) throw new Error(`live_nodes: no ${re} (stderr: ${err.slice(-400)})`);
      await H.sleep(100);
    }
  };
  for (const s of specs) await next(new RegExp(`^ready ${s.split(':')[0]} `));
  const cmd = async line => { proc.stdin.write(`${line}\n`); return next(new RegExp(`^ok ${line.split(' ')[0]} `)); };
  return { cmd, stop: async () => { try { proc.stdin.write('quit\n'); } catch { /* gone */ } await H.killGroup(proc); } };
}

const chip = (pg, testid) => pg.locator(testid.startsWith('[') ? testid : `[data-testid="${testid}"]`);
/** The number on the AMBER tile of the ARMORY board. */
const amberTile = pg => pg.evaluate(() => {
  const l = [...document.querySelectorAll('span')].find(e => e.children.length === 0 && e.textContent === 'AMBER');
  return l ? Number(l.previousElementSibling?.textContent) : null;
});
const present = async (pg, testid) => (await chip(pg, testid).count()) > 0;
/** The chip's catalogue severity and its words must read `WHAT IS WRONG: WHAT TO DO` with one colon. */
async function checkChip(pg, testid, sev, headWords) {
  const el = chip(pg, testid).first();
  const s = await el.getAttribute('data-sev');
  const t = ((await el.innerText()) || '').replace(/\s+/g, ' ').trim();
  c.expect(s === sev, `${testid} is ${sev} (data-sev=${s})`);
  c.expect(t.startsWith(`▲ ${headWords}`) || t.startsWith(headWords), `${testid} reads "${headWords}…" (saw "${t.slice(0, 90)}")`);
  c.expect(/: [A-Z]/.test(t) && !/\)\s*$/.test(t), `${testid} ends with what to do (saw "${t.slice(-60)}")`);
  const colour = await el.evaluate(e => getComputedStyle(e).color);
  c.expect(colour !== 'rgb(0, 0, 0)', `${testid} is drawn in a catalogue colour (${colour})`);
}
const open = async (url, width = 1440) => {
  const pg = await H.newPage(browser, { width, height: 900 }, errors, () => c.step);
  await pg.goto(url, { waitUntil: 'domcontentloaded' });
  await c.until(async () => (await pg.locator('header nav').count()) > 0 && !/CONNECTING TO MISSION CONTROL/.test(await H.bodyText(pg)), 30000, 'the first snapshot');
  return pg;
};

const steps = {
  async mock() {
    const MOCK = `${vite.base}/?mock`;
    // healthy: nothing
    let pg = await open(`${MOCK}#muster`);
    for (const id of ['not-saving-store', 'not-saving-archive', 'not-saving-snapshot', 'ticker-failing', 'join-info-failed', 'outbox-lost'])
      c.expect(!(await present(pg, id)), `a healthy mock shows no ${id} chip`);
    await pg.context().close();
    const cases = [
      ['store', 'not-saving-store', 'red', 'NOT SAVING GAME DATA'],
      ['archive', 'not-saving-archive', 'red', "NOT SAVING THIS MATCH'S RESULT"],
      ['snapshot', 'not-saving-snapshot', 'amber', 'NOT SAVING THE SESSION'],
      ['tick', 'ticker-failing', 'red', 'MATCH CLOCK FAILING'],
      ['join', 'join-info-failed', 'amber', 'JOIN QR HAS NO ADDRESS'],
    ];
    for (const [obs, id, sev, head] of cases) {
      pg = await open(`${MOCK}&obs=${obs}#muster`);
      await c.until(() => present(pg, id), 6000, `the ${id} chip`);
      await checkChip(pg, id, sev, head);
      await sh(pg, `mock-${obs}`);
      await pg.context().close();
    }
    pg = await open(`${MOCK}#muster`);
    const amberBefore = await amberTile(pg);
    await pg.context().close();
    pg = await open(`${MOCK}&obs=outbox#muster`);
    const OUTBOX = '[data-alert="armory-nodecard-outbox-lost"]';
    await c.until(() => present(pg, OUTBOX), 6000, 'the outbox-lost line on a gun card');
    await checkChip(pg, OUTBOX, 'amber', '12 FACTS LOST FROM THE PHONE OUTBOX');
    const amberAfter = await amberTile(pg);
    c.expect(amberBefore != null && amberAfter === amberBefore + 1, `the card with lost facts counts in the AMBER tile (${amberBefore} -> ${amberAfter})`);
    const card = pg.locator('[data-alert="armory-nodecard-outbox-lost"]').first().locator('xpath=ancestor::div[contains(., "GUN-A")][1]');
    c.expect(!/READY/.test(await card.innerText()) && /CHECK/.test(await card.innerText()), 'that card reads CHECK, not READY');
    await chip(pg, OUTBOX).first().scrollIntoViewIfNeeded();
    await sh(pg, 'mock-outbox');
    await pg.context().close();
    pg = await open(`${MOCK}&obs=claims#muster`);
    const claims = pg.locator('[data-alert="station-attention-claims-dropped"]');
    await c.until(async () => (await claims.count()) > 0, 6000, 'the dropped-claims line on a Stick card');
    c.expect(await claims.first().getAttribute('data-sev') === 'amber', 'the dropped-claims line is amber');
    c.expect(/3 CLAIM REPORTS DROPPED BY THE STICK: CHECK THE RECAP'S PICKUPS FOR STATION #4/.test((await claims.first().innerText()).toUpperCase()), 'it reads WHAT IS WRONG: WHAT TO DO');
    await claims.first().scrollIntoViewIfNeeded();
    await sh(pg, 'mock-claims');
    await pg.context().close();
    // red and amber together: the red one is the one that must read as an alarm
    pg = await open(`${MOCK}&obs=store,snapshot,tick#muster`);
    await c.until(() => present(pg, 'ticker-failing'), 6000, 'all three chips');
    c.expect((await present(pg, 'not-saving-store')) && (await present(pg, 'not-saving-snapshot')), 'store and snapshot are two chips, not one');
    await sh(pg, 'mock-all');
    await pg.context().close();
  },

  async real() {
    const flags = path.join(OUT, 'flags'); fs.mkdirSync(flags, { recursive: true });
    const sessionDir = path.join(OUT, 'session'); fs.mkdirSync(sessionDir, { recursive: true });
    const env = { PYTHONPATH: path.join(H.E2E_DIR, 'fixtures', 'obs_patch'), OBS_FLAG_DIR: flags, OBS_MCP_DIR: path.join(H.REPO, 'mcp') };
    Object.assign(process.env, env);
    mc = await H.startMC({ port: P.mc, wsPort: P.ws, home: path.join(OUT, 'home'), sessionFile: path.join(sessionDir, 'session.json'), fakeNet: false });
    vite = await H.startVite({ port: P.vite, mcPort: P.mc });
    nodes = await startNodes(mc.wsUrl, ['GUN-A:3D4F', 'STICK-1:AAAA:utility']);
    await nodes.cmd('status STICK-1 station_id=4,platform=esp32');   // platform esp32: the card says STICKS3, as a real Stick's does
    const srv = H.api(mc.base);
    const state = () => srv.get('/api/state');
    // a harmless roster edit marks the session dirty, so the 2 s-debounced snapshot write runs again
    const touch = async () => { const p0 = (await state()).players[0]; await fetch(`${mc.base}/api/players/${p0.player_id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice: ['female', 'male'][(touch.n = (touch.n || 0) + 1) % 2] }) }); };
    const pg = await open(`${vite.base}/#muster`);
    for (const k of ['not_saving', 'ticker_failing', 'join_error']) c.expect(!(k in await state()), `a healthy MC omits ${k}`);
    c.expect((await state()).nodes.every(n => !('outbox_lost' in n) && !('claims_dropped' in n)), 'a healthy MC reports no loss counts');
    await sh(pg, 'real-healthy');

    // O8: a tick that raises
    fs.writeFileSync(path.join(flags, 'tick-fail'), '');
    await c.until(async () => (await state()).ticker_failing?.count >= 3, 8000, 'ticker_failing on the snapshot');
    await c.until(() => present(pg, 'ticker-failing'), 6000, 'the MATCH CLOCK FAILING chip');
    await checkChip(pg, 'ticker-failing', 'red', 'MATCH CLOCK FAILING');
    await sh(pg, 'real-tick');
    const tickLines = () => (mc.log.match(/match tick failed/g) || []).length;
    c.expect(tickLines() === 1, `one traceback for the repeating tick failure, not one per 0.5 s (saw ${tickLines()})`);
    fs.rmSync(path.join(flags, 'tick-fail'));
    await c.until(async () => !(await present(pg, 'ticker-failing')), 8000, 'the chip clears on the next good tick');

    // O7: the store that raises (red), then the snapshot that cannot be written (amber)
    fs.writeFileSync(path.join(flags, 'store-fail'), '');
    await c.until(async () => (await state()).not_saving?.store?.count >= 2, 10000, 'not_saving.store on the snapshot');
    await c.until(() => present(pg, 'not-saving-store'), 6000, 'the NOT SAVING chip (store)');
    await checkChip(pg, 'not-saving-store', 'red', 'NOT SAVING GAME DATA');
    await sh(pg, 'real-store');
    const storeErrors = () => (mc.log.match(/store\.log failed/g) || []).length;
    c.expect(storeErrors() === 1, `one traceback for the repeating store failure, not one per envelope (saw ${storeErrors()})`);
    fs.rmSync(path.join(flags, 'store-fail'));
    await c.until(async () => !(await present(pg, 'not-saving-store')), 10000, 'the store chip clears on the next good write');

    fs.chmodSync(sessionDir, 0o555);                       // the real snapshot write now fails with a real EACCES
    try {
      await c.until(async () => { await touch(); return (await state()).not_saving?.snapshot; }, 12000, 'not_saving.snapshot on the snapshot');
      await c.until(() => present(pg, 'not-saving-snapshot'), 6000, 'the NOT SAVING chip (snapshot)');
      await checkChip(pg, 'not-saving-snapshot', 'amber', 'NOT SAVING THE SESSION');
      c.expect(!(await present(pg, 'not-saving-store')), 'a snapshot failure alone is not the red store chip');
      await sh(pg, 'real-snapshot');
    } finally { fs.chmodSync(sessionDir, 0o755); }
    await c.until(async () => { await touch(); return !(await state()).not_saving; }, 12000, 'not_saving clears after a good snapshot');
    await c.until(async () => !(await present(pg, 'not-saving-snapshot')), 6000, 'the snapshot chip clears');

    // O6: the phone's per-match drop count, as a line on the rostered player's card. A match must be in play: MC shows
    // a count only against the current match, so a hot-joiner's old losses, or the last match's, never show.
    const gunA = async () => (await state()).nodes.find(n => n.gun_name?.startsWith('GUN-A'));
    await H.startAMatch(mc.base);
    await c.until(async () => (await state()).phase === 'live', 15000, 'a live match');
    const OUTBOX = '[data-alert="armory-nodecard-outbox-lost"]';
    await nodes.cmd('lost GUN-A 7');
    await c.until(async () => (await gunA())?.outbox_lost === 7, 8000, 'outbox_lost=7 for the current match');
    // a hot-joiner / the last match: 30 drops that belong to ANOTHER match. The 7 vanishing PROVES the beat carrying the other
    // match's report arrived (a positive wait: no timing guess), and 30 must not show in its place.
    await nodes.cmd('lost GUN-A 30 some-other-match');
    await c.until(async () => (await gunA())?.outbox_lost === undefined, 8000, 'the other match\'s report replacing the 7 (nothing shows)');
    await nodes.cmd('lost GUN-A 3');                          // back on this match after a storage reset: no high-water mark hides it
    await c.until(async () => (await gunA())?.outbox_lost === 3, 8000, 'a reset phone shows its new losses (3, not the old 7)');
    await pg.goto(`${vite.base}/#muster`);
    if (process.env.DBG) console.log(JSON.stringify((await state()).readiness.board.filter(r => r.node === 'linked')));
    await c.until(() => present(pg, OUTBOX), 8000, 'the outbox-lost line on the player card');
    await checkChip(pg, OUTBOX, 'amber', '3 FACTS LOST FROM THE PHONE OUTBOX');
    c.expect((await state()).readiness.board.some(r => r.status === 'amber' && r.ambers.some(a => /OUTBOX/.test(a))), 'MC marks that board row amber');
    await chip(pg, OUTBOX).first().scrollIntoViewIfNeeded();
    await sh(pg, 'real-outbox');

    // O10: a Stick's dropped CLAIM count, as a station attention line
    await nodes.cmd(`status STICK-1 actions_dropped=3,actions_dropped_game=${(await state()).game_byte}`);   // the game byte the Stick was armed with
    await c.until(async () => (await state()).nodes.some(n => n.claims_dropped === 3), 8000, 'claims_dropped=3 on the Stick node');
    const claims = pg.locator('[data-alert="station-attention-claims-dropped"]');
    await c.until(async () => (await claims.count()) > 0, 8000, 'the dropped-claims line on the Stick card');
    c.expect(await claims.first().getAttribute('data-sev') === 'amber', 'the dropped-claims line is amber');
    await claims.first().scrollIntoViewIfNeeded();
    await sh(pg, 'real-claims');
    await pg.context().close();
  },

  async join() {
    const flags = path.join(OUT, 'flags-join'); fs.mkdirSync(flags, { recursive: true });
    Object.assign(process.env, { PYTHONPATH: path.join(H.E2E_DIR, 'fixtures', 'obs_patch'), OBS_FLAG_DIR: flags, OBS_MCP_DIR: path.join(H.REPO, 'mcp'), OBS_JOIN_FAIL: '1' });
    const p2 = { mc: await H.freePort(), ws: await H.freePort(), vite: await H.freePort() };
    let mc2 = null, vite2 = null;
    try {
      mc2 = await H.startMC({ port: p2.mc, wsPort: p2.ws, home: path.join(OUT, 'home-join') });
      vite2 = await H.startVite({ port: p2.vite, mcPort: p2.mc });
      const s = await H.api(mc2.base).get('/api/state');
      c.expect(!!s.join_error && /no network interface/.test(s.join_error.error), `join_error is on the snapshot (${JSON.stringify(s.join_error)})`);
      c.expect(/join_info failed/.test(mc2.log), 'MC logged the join_info failure, naming the URL it kept');
      const pg = await open(`${vite2.base}/#muster`);
      await c.until(() => present(pg, 'join-info-failed'), 8000, 'the JOIN QR chip');
      await checkChip(pg, 'join-info-failed', 'amber', 'JOIN ADDRESS NOT REFRESHED');   // the QR still holds the address read at construction
      await sh(pg, 'real-join');
      await pg.context().close();
    } finally { if (vite2) await vite2.stop(); if (mc2) await mc2.stop(); }
  },
};

try {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  browser = await H.chromium.launch({ headless: !process.env.HEADED });
  if (!vite && (!ONLY || ONLY === 'mock')) {
    // the mock needs only a vite dev server; the proxy config's target is unused by `?mock`
    vite = await H.startVite({ port: P.vite, mcPort: P.mc });
  }
  for (const [name, fn] of Object.entries(steps)) {
    if (ONLY && ONLY !== name) continue;
    c.step = name; console.log(`\n[${name}]`);
    if (name === 'real' && vite) { await vite.stop(); vite = null; }
    await fn();
  }
  c.step = 'errors';
  const real = errors.filter(e => !/WebSocket connection .* failed|502 \(Bad Gateway\)|Failed to load resource/.test(e));
  c.expect(real.length === 0, `no console or page errors (${real.length})`);
  if (real.length) console.log(real.slice(0, 10).join('\n'));
} catch (e) {
  c.failures.push(`${c.step}: threw ${e && e.stack || e}`);
  console.log(`    ✗ threw: ${e && e.message}`);
} finally {
  if (browser) await browser.close();
  if (nodes) await nodes.stop();
  if (vite) await vite.stop();
  if (mc) await mc.stop();
}
process.exit(c.done());
