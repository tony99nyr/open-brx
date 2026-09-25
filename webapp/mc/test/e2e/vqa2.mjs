// MC visual QA round 2 (2026-09-24): the host paths the report listed as having "no e2e gate", in a real
// browser against a real demo MC, with a phone station stand-in and two phone stand-ins on its real node
// socket (test/e2e/vqa2_nodes.py). Each step asserts what a person sees, and each failed before its fix:
//
//   items        ITEMS: ASSIGN + ARM leaves the BUBBLE at the station's default (H1: it sent -74), the
//                header counts ARMED apart from NEED ATTENTION (M2), the name is not cut (M3)
//   station-ids  F364: every card shows the station id read-only (no id input), MC assigns 1 and 2 across two
//                stations, and a cleared station gets its own id back on the next ASSIGN + ARM
//   koth-source  KOTH on a grenade objective with a CONTROL station assigned: an amber conflict on LOBBY
//                and the same line on the CONTROL card on ITEMS (H2)
//   unlock       LOBBY after the push: the lock runs, UNLOCK STATIONS is there, two taps clear it (M4)
//   pools        LIVE: a phone that says GUN POOLS WRONG reads POOLS WRONG in amber, first on the board (M6)
//   menu-fold    LIVE at 1440×900 with a station alert: the board starts high, and the operator menu of
//                the LAST row opens in view (M7); BATTERY LOW reaches the strip with its step (M5)
//   long-names   a 16-character name (F366 MAX_TAG_LEN): the feed's medal tag stays inside the panel (M8), and on RECAP at
//                900 px the name stops before K and inside its honours card (M8)
//
//   node test/e2e/vqa2.mjs
//   ONLY=unlock node test/e2e/vqa2.mjs          # one step (every step sets up its own state)
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…  # test-all passes free ports; else it picks its own
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { E2E_DIR, REPO, chromium, checker, devPython, killGroup, ports, shot as shotIn, startMC, startVite } from './lib/mc-harness.mjs';

const SHOTS = path.join(E2E_DIR, 'shots', 'vqa2');
const ONLY = process.env.ONLY || '';
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-vqa2-home-'));
const LONG = 'W'.repeat(16);   // 16 characters (F366 MAX_TAG_LEN, the most the server allows), the widest glyph, no break point
const STATION = 'util-e2e-vqa2';
const STATION2 = 'util-e2e-vqa2-pu';   // a second station, for the powerup strip on LIVE
const AMBER = 'rgb(255, 176, 32)', GREEN = 'rgb(46, 204, 113)';
const c = checker();
const { expect, until } = c;
const shot = (pg, name) => shotIn(pg, SHOTS, name);

/** The stand-ins, one command per line (vqa2_nodes.py). */
async function startNodes(wsUrl, specs) {
  const proc = spawn(devPython(), [path.join(E2E_DIR, 'vqa2_nodes.py'), wsUrl, ...specs],
    { cwd: path.join(REPO, 'mcp'), stdio: ['pipe', 'pipe', 'pipe'], detached: true, env: { ...process.env, BRX_MCP_HOME: HOME } });
  let err = ''; proc.stderr.on('data', d => { err += d; });
  const lines = []; let wake = null;
  readline.createInterface({ input: proc.stdout }).on('line', l => { lines.push(l); if (wake) wake(); });
  const next = async (re, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
      const i = lines.findIndex(l => re.test(l));
      if (i >= 0) return lines.splice(i, 1)[0];
      const bad = lines.find(l => l.startsWith('err '));
      if (bad) throw new Error(`vqa2_nodes: ${bad}`);
      if (Date.now() > end || proc.exitCode != null) throw new Error(`vqa2_nodes: no ${re} (stderr: ${err.slice(-600)})`);
      await new Promise(r => { wake = r; setTimeout(r, 200); });
    }
  };
  for (const s of specs) await next(new RegExp(`^ready ${s.split(':')[1]} `));
  return {
    cmd: async line => { proc.stdin.write(`${line}\n`); return next(new RegExp(`^ok ${line.split(' ')[0]} ${line.split(' ')[1]}`)); },
    stop: async () => { try { proc.stdin.write('quit\n'); } catch { /* gone */ } await until(() => proc.exitCode != null, 3000, 'the stand-ins to quit'); await killGroup(proc); },
  };
}

const p = await ports();
let mc = null, vite = null;   // started inside the try, so a failed start still reaches the finally
const req = async (method, route, body) => {
  const r = await fetch(`${mc.base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = { status: r.status, body: await r.json().catch(() => null) };
  return out;
};
const get = async route => (await req('GET', route)).body;
const must = async (method, route, body) => {
  const r = await req(method, route, body);
  if (r.status >= 400) throw new Error(`${method} ${route} ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
};

/** Back to a clean pre-match: no match in play, TDM, no station assigned, MUSTER. */
async function reset() {
  let s = await get('/api/state');
  if (['armed', 'live'].includes(s.phase)) await must('POST', '/api/control', { cmd: 'end' });
  s = await get('/api/state');
  if (s.phase !== 'muster') await must('POST', '/api/phase', { phase: 'muster', force: true });
  for (const st of (await get('/api/stations')).stations) if (st.assigned) await must('DELETE', `/api/stations/${st.node_id}`);
  if ((await get('/api/state')).config.mode !== 'tdm') await must('PUT', '/api/config', { mode: 'tdm' });
}
const assign = (kind, id, team = 'any') => must('PUT', `/api/stations/${STATION}`, { kind, team, id });
/** Walk to LIVE with the operator's own REST calls (a real node never echoes a gun ack here: force). */
async function toLive() {
  await must('POST', '/api/phase', { phase: 'lobby', force: true });
  await must('POST', '/api/lobby/push', { force: true });
  let r = await req('POST', '/api/start', { runway_s: 0 });
  if (r.status >= 400) r = await req('POST', '/api/start', { runway_s: 0, force: true });
  if (r.status >= 400) throw new Error(`start refused: ${JSON.stringify(r.body)}`);
  if (!(await until(async () => (await get('/api/state')).phase === 'live', 20000, 'LIVE'))) throw new Error('never went live');
  return get('/api/state');
}

const jsErrors = [];
const IGNORED = /Failed to load resource|WebSocket connection to .* failed/;
async function page(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(5000);
  const pg = await ctx.newPage();
  pg.on('pageerror', e => jsErrors.push(`[${c.step}] [pageerror] ${e.message}`));
  pg.on('console', m => { if (m.type() === 'error') jsErrors.push(`[${c.step}] [console] ${m.text().slice(0, 300)}`); });
  await pg.goto(vite.base, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('nav.cb-nav button').count().then(n => n > 0), 10000, 'the console nav');
  return pg;
}
const go = async (pg, label) => { await pg.locator('nav.cb-nav button', { hasText: label }).first().click(); };
const box = async loc => loc.boundingBox().catch(() => null);
/** Where the text of `loc` is visibly painted to: its own glyphs' right edge, clipped by its box only when it
 *  clips (overflow hidden). A grid cell's box is the cell, so the box alone cannot see text running out of it. */
const paintedRight = loc => loc.evaluate(el => {
  const range = document.createRange(); range.selectNodeContents(el);
  const text = range.getBoundingClientRect().right, own = el.getBoundingClientRect().right;
  return getComputedStyle(el).overflowX === 'hidden' ? Math.min(text, own) : text;
}).catch(() => null);
const styleOf = (loc, prop) => loc.evaluate((el, pr) => getComputedStyle(el)[pr], prop).catch(() => '');

let browser = null, nodes = null;
async function runStep(name, what, fn) {
  if (ONLY && ONLY !== name) return;
  c.step = name;
  console.log(`\n[${name}] ${what}`);
  try { await fn(); } catch (e) { c.expect(false, `threw ${e?.message || e}`); }
}

try {
  mc = await startMC({ port: p.mc, wsPort: p.ws, home: HOME, fakeNet: false, extraArgs: ['--powerups'] });
  vite = await startVite({ port: p.vite, mcPort: p.mc });
  nodes = await startNodes(mc.wsUrl, [`util:${STATION}:android`, `util:${STATION2}:android`, 'phone:GUN-A:3D4F', 'phone:GUN-B:3E60']);
  if (!(await until(async () => (await get('/api/state')).nodes.filter(n => n.player_id).length >= 2, 10000, 'the two phones to bind'))) throw new Error('phones never bound');
  browser = await chromium.launch();

  await runStep('items', 'ITEMS: the station default, the header count, the card name', async () => {
    await reset();
    await nodes.cmd(`set ${STATION} battery=80`);
    const pg = await page(browser, { width: 1440, height: 900 });
    await go(pg, 'ARMORY');
    const card = pg.locator(`[data-station-card="${STATION}"]`);
    expect(await until(() => card.isVisible(), 8000, 'the station card'), 'the station stand-in has a card on ITEMS');
    const cardText = async () => (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
    expect((await cardText()).includes('DEFAULT (-70, phone)'), 'the BUBBLE reads the phone respawn default before any edit');
    await card.getByRole('button', { name: 'ASSIGN + ARM' }).click();
    const armed = await until(async () => (await get('/api/stations')).stations.find(s => s.node_id === STATION)?.armed, 8000, 'the arming');
    const st = (await get('/api/stations')).stations.find(s => s.node_id === STATION);
    expect(armed && st.assigned?.threshold === 0, `ASSIGN + ARM stored threshold 0, the station's own (stored ${st?.assigned?.threshold})`);
    expect(await until(async () => /MC-ARMED/.test(await cardText()), 6000, 'MC-ARMED'), 'the card reads MC-ARMED');
    const hint = pg.getByTestId('items-panel');
    expect(await until(async () => /1\/2 ARMED/.test(await hint.innerText()), 6000, '1/2 ARMED'), 'the header reads 1/2 ARMED (two stations, one assigned)');
    await nodes.cmd(`set ${STATION} battery=20`);
    expect(await until(async () => /1\/2 ARMED · 1 NEED ATTENTION/.test((await hint.innerText()).replace(/\s+/g, ' ')), 8000, 'NEED ATTENTION'),
      'BATTERY LOW keeps it counted ARMED, with 1 NEED ATTENTION beside it');
    const title = pg.locator(`[data-station-title="${STATION}"]`);
    const cut = await title.evaluate(el => el.scrollWidth > el.clientWidth + 1).catch(() => true);
    expect(!cut && (await title.innerText()).trim() === 'RESPAWN 1', `the name "RESPAWN 1" is whole (cut: ${cut})`);
    await shot(pg, 'items-1440');
    // an edited bubble is sent as a number, and DEFAULT puts it back to 0
    await card.locator('[data-bubble-edit]').click();
    const input = card.locator(`input[aria-label="threshold for ${STATION}"]`);
    await input.fill('-66'); await input.press('Enter');
    await card.getByRole('button', { name: 'ARM WITH CHANGES' }).click();
    expect(await until(async () => (await get('/api/stations')).stations.find(s => s.node_id === STATION)?.assigned?.threshold === -66, 6000, '-66'),
      'an edited BUBBLE is sent as the number the host typed');
    // the new assignment remounts the card (its key is the assignment); wait for the settled one
    expect(await until(() => card.getByRole('button', { name: 'ARMED', exact: true }).isVisible(), 6000, 'the re-armed card'), 'the card settles on ARMED at -66');
    await card.locator('[data-bubble-default]').click();
    await card.getByRole('button', { name: 'ARM WITH CHANGES' }).click();
    expect(await until(async () => (await get('/api/stations')).stations.find(s => s.node_id === STATION)?.assigned?.threshold === 0, 6000, 'back to 0'),
      'DEFAULT puts the station back on its own bubble');
    await pg.setViewportSize({ width: 900, height: 900 });
    const cut900 = await title.evaluate(el => el.scrollWidth > el.clientWidth + 1).catch(() => true);
    expect(!cut900, 'at 900 px the name is still whole');
    await pg.context().close();
  });

  await runStep('station-ids', 'ITEMS: MC assigns the station id and the card shows it read-only (F364)', async () => {
    await reset();
    const pg = await page(browser, { width: 1440, height: 900 });
    await go(pg, 'ARMORY');
    const card = n => pg.locator(`[data-station-card="${n}"]`);
    const idOf = n => pg.locator(`[data-station-id="${n}"]`);
    const apiId = async n => (await get('/api/stations')).stations.find(s => s.node_id === n)?.assigned?.id;
    expect(await until(() => card(STATION2).isVisible(), 8000, 'the second card'), 'both station stand-ins have a card');
    expect(await pg.locator('input[aria-label^="station id for"]').count() === 0, 'no card has a station id input');
    expect((await idOf(STATION2).innerText()).trim() === 'SET BY MC AT ARM', 'an unassigned card says MC sets the id');
    const arm = async n => {
      await card(n).getByRole('button', { name: 'ASSIGN + ARM' }).click();
      return until(async () => (await get('/api/stations')).stations.find(s => s.node_id === n)?.armed, 8000, `${n} armed`);
    };
    expect(await arm(STATION), 'the first station arms');
    expect(await arm(STATION2), 'the second station arms');
    const [a, b] = [await apiId(STATION), await apiId(STATION2)];
    expect(a >= 1 && b >= 1 && a !== b, `MC gave the two stations distinct ids (${a}, ${b})`);
    expect(await until(async () => (await idOf(STATION2).innerText()).trim() === String(b), 6000, 'the id on the card'),
      `the card shows the MC-assigned id ${b} read-only`);
    expect(await pg.locator('input[aria-label^="station id for"]').count() === 0, 'still no id input once assigned');
    await shot(pg, 'station-ids-1440');
    await must('DELETE', `/api/stations/${STATION}`);
    expect(await until(() => card(STATION).getByRole('button', { name: 'ASSIGN + ARM' }).isVisible(), 6000, 'the cleared card'), 'the cleared card offers ASSIGN + ARM');
    expect(await arm(STATION), 'the cleared station arms again');
    expect(await apiId(STATION) === a, `a cleared station gets its own id ${a} back (got ${await apiId(STATION)})`);
    expect(await until(async () => (await idOf(STATION).innerText()).trim() === String(a), 6000, 'the kept id'), 'and its card shows it');
    await pg.context().close();
  });

  await runStep('armory-setup', 'ARMORY header SETUP line at 900 and 393 px: under the gate, nothing sideways', async () => {
    await reset();
    await must('PUT', '/api/config', { mode: 'koth' });   // phone source, no CONTROL assigned: NO CONTROL STATION
    const pg = await page(browser, { width: 900, height: 900 });
    await go(pg, 'ARMORY');
    const line = pg.getByTestId('armory-setup');
    const gate = pg.getByTestId('armory-gate');
    expect(await until(() => line.isVisible(), 6000, 'the SETUP line'), 'control: the ARMORY header carries the SETUP line');
    for (const w of [900, 393]) {
      await pg.setViewportSize({ width: w, height: 900 });
      await until(async () => { const b = await box(gate); return !!b && b.x + b.width <= w + 0.5; }, 3000, `the header to reflow at ${w}`);
      const lb = await box(line), gb = await box(gate);
      expect(gb && gb.x >= 0 && gb.x + gb.width <= w + 0.5, `at ${w} px HARDWARE READY is fully on screen (${gb && Math.round(gb.x)}..${gb && Math.round(gb.x + gb.width)})`);
      expect(lb && gb && lb.y >= gb.y + gb.height - 0.5, `at ${w} px the SETUP line sits under the gate button (line top ${lb && Math.round(lb.y)}, gate bottom ${gb && Math.round(gb.y + gb.height)})`);
      expect(lb && lb.x >= 0 && lb.x + lb.width <= w + 0.5, `at ${w} px the SETUP line is inside the screen (${lb && Math.round(lb.x)}..${lb && Math.round(lb.x + lb.width)})`);
      const sideways = await pg.evaluate(() => [document.scrollingElement, document.querySelector('main')].filter(Boolean)
        .map(el => ({ tag: el.tagName, over: el.scrollWidth - el.clientWidth })).filter(x => x.over > 1));
      expect(sideways.length === 0, `at ${w} px nothing scrolls sideways (${JSON.stringify(sideways)})`);
      await shot(pg, `armory-setup-${w}`);
    }
    await pg.context().close();
  });

  await runStep('koth-source', 'KOTH, OBJECTIVE SOURCE GRENADE, a CONTROL station: LOBBY and ITEMS say so', async () => {
    await reset();
    await nodes.cmd(`set ${STATION} battery=80`);
    await must('PUT', '/api/config', { mode: 'koth' });
    await must('PUT', '/api/config', { station_source: 'grenade' });
    await assign('control', 9);
    const pg = await page(browser, { width: 1440, height: 900 });
    await go(pg, 'LOBBY');
    const block = pg.getByTestId('setup-conflict');
    expect(await until(() => block.isVisible(), 6000, 'the conflict block'), 'LOBBY shows a SETUP CONFLICT block');
    expect(/every phone ignores its hill/.test(await block.innerText().catch(() => '')), 'it says every phone ignores the station\'s hill');
    expect(await styleOf(block, 'borderLeftColor') === AMBER, `it is amber (${await styleOf(block, 'borderLeftColor')})`);
    await shot(pg, 'koth-lobby-1440');
    await go(pg, 'ARMORY');
    const card = pg.locator(`[data-station-card="${STATION}"]`);
    const line = card.getByTestId('station-setup-conflict');
    expect(await until(() => line.isVisible(), 6000, 'the card line'), 'the CONTROL card carries the same line');
    const rim = await styleOf(card, 'borderLeftColor');
    expect(rim !== GREEN, `the CONTROL card is not green (${rim})`);
    await card.scrollIntoViewIfNeeded();
    await shot(pg, 'koth-items-1440');
    await pg.context().close();
    await must('PUT', '/api/config', { station_source: 'phone' });
  });

  await runStep('unlock', 'LOBBY after the push: UNLOCK STATIONS, two taps', async () => {
    await reset();
    await assign('respawn', 1);
    await must('POST', '/api/phase', { phase: 'lobby', force: true });
    await must('POST', '/api/lobby/push', { force: true });
    const locked = async () => { const s = (await get('/api/stations')).stations.find(x => x.node_id === STATION); return !!s?.lock_until_ms && s.lock_until_ms > Date.now(); };
    expect(await until(locked, 6000, 'the lobby lock'), 'control: the push locked the station (A58 LOAD lock)');
    const pg = await page(browser, { width: 1440, height: 900 });
    await go(pg, 'LOBBY');
    const btn = pg.getByTestId('station-unlock').getByRole('button', { name: 'UNLOCK STATIONS' });
    expect(await until(() => btn.isVisible(), 6000, 'UNLOCK STATIONS'), 'LOBBY offers UNLOCK STATIONS while the lock runs');
    await btn.click();
    expect(await until(async () => /TAP UNLOCK STATIONS AGAIN/.test(await pg.getByTestId('station-unlock').innerText()), 3000, 'the confirm'), 'the first tap asks again');
    expect(await locked(), 'the first tap sent nothing');
    await btn.click();
    expect(await until(async () => !(await locked()), 6000, 'the unlock'), 'the second tap clears the lock on MC');
    expect(await until(async () => (await pg.getByTestId('station-unlock').count()) === 0, 6000, 'the button to go'), 'and UNLOCK STATIONS leaves the screen');
    await shot(pg, 'unlock-lobby-1440');
    await pg.context().close();
  });

  await runStep('pools', 'LIVE: GUN POOLS WRONG reads POOLS WRONG, amber, first', async () => {
    await reset();
    await nodes.cmd('set GUN-B pool_stale=pool_wrong');
    const s = await toLive();
    const b = s.players.find(x => x.gun_id === 'GUN-B');
    const pg = await page(browser, { width: 1440, height: 900 });
    await go(pg, 'MATCH');
    const status = pg.locator(`[data-live-row="${b.player_id}"] [data-cell="status"]`);
    expect(await until(async () => (await status.innerText().catch(() => '')).trim() === 'POOLS WRONG', 10000, 'POOLS WRONG'),
      `${b.display}'s status reads POOLS WRONG (saw "${(await status.innerText().catch(() => '')).trim()}")`);
    expect(await styleOf(status, 'color') === AMBER, `in amber (${await styleOf(status, 'color')})`);
    const first = await pg.locator('[data-live-row]').first().getAttribute('data-live-row');
    expect(first === b.player_id, `the faulted row is first on the board (first is ${first})`);
    const bg = await styleOf(pg.locator(`[data-live-row="${b.player_id}"]`), 'backgroundColor');
    expect(/rgba\(255, 176, 32/.test(bg), `the row is tinted (${bg})`);
    await shot(pg, 'pools-live-1440');
    await pg.context().close();
    await nodes.cmd('set GUN-B pool_stale=none');
  });

  await runStep('menu-fold', 'LIVE at 1440×900, KOTH with a hill, station alerts and a powerup: the board is high, the last menu opens in view', async () => {
    // the finding's own screen (24-live-operator-menu): a KOTH hill panel, a station alert and a powerup strip
    await reset();
    await nodes.cmd(`set ${STATION} battery=80`);
    await must('PUT', '/api/config', { mode: 'koth' });
    await assign('control', 1);
    const preset = (await get('/api/powerups')).presets[0].preset;
    await must('PUT', `/api/stations/${STATION2}`, { kind: 'powerup', team: 'any', id: 3, item_preset: preset });
    await toLive();
    // a restart inside the lock window, and a low battery: two attention lines on the one station
    await nodes.cmd(`set ${STATION} boot_count=2 uptime_s=1 battery=20`);
    const pg = await page(browser, { width: 1440, height: 900 });
    await go(pg, 'MATCH');
    const alerts = pg.getByTestId('station-alerts');
    expect(await until(() => alerts.isVisible(), 8000, 'the station alerts'), 'the BATTERY LOW station alert reaches LIVE');
    expect(await until(async () => /RESTARTED/.test(await alerts.innerText().catch(() => '')), 6000, 'RESTARTED'), 'the restart is on the strip');
    const at = await alerts.innerText().catch(() => '');
    expect(/BATTERY LOW/.test(at) && /swap or charge before the whistle/.test(at), 'BATTERY LOW reaches LIVE, with its next step (M5)');
    expect(/check the station; it restarted during the lock/.test(at), 'RESTARTED has its next step (M5)');
    expect(await pg.getByTestId('hill-panel').isVisible().catch(() => false) && await pg.getByTestId('powerup-strip').isVisible().catch(() => false),
      'control: the hill panel and the powerup strip are on the board too');
    const rows = pg.locator('[data-live-rows]');
    const top = (await box(rows))?.y ?? 9999;
    expect(top < 600, `the board's first row starts at y=${Math.round(top)} (< 600 at 1440×900; the finding measured 716)`);
    // the host scrolls until the last row sits at the bottom edge, then taps it. A mouse click at the row,
    // not locator.click(): that scrolls the target into view itself and would hide the bug.
    const last = pg.locator('[data-live-row-toggle]').last();
    const pid = await last.getAttribute('data-live-row-toggle');
    await last.evaluate(el => el.scrollIntoView({ block: 'end' }));
    const lb = await box(last);
    expect(lb && lb.y + lb.height <= 901 && lb.y + lb.height > 820, `control: the last row sits at the bottom edge (bottom ${lb && Math.round(lb.y + lb.height)})`);
    await pg.mouse.click(lb.x + 20, lb.y + lb.height / 2);
    const menu = pg.locator(`[data-operator-menu="${pid}"]`);
    const inView = async () => { const bb = await box(menu); return !!bb && bb.y >= 0 && bb.y + bb.height <= 900; };
    expect(await until(inView, 4000, 'the menu in view'), `the last row's operator menu is fully on screen (${JSON.stringify(await box(menu))})`);
    await shot(pg, 'menu-fold-1440');
    // polish r1: the compact strips must not scroll sideways at phone width
    await pg.setViewportSize({ width: 393, height: 852 });
    const strip = pg.getByTestId('powerup-strip');
    await until(async () => ((await box(strip))?.width ?? 999) <= 393, 3000, 'the strip to reflow');
    const sideways = await pg.evaluate(() => [document.scrollingElement, document.querySelector('main')].filter(Boolean)
      .map(el => ({ tag: el.tagName, over: el.scrollWidth - el.clientWidth })).filter(x => x.over > 1));
    const sb = await box(strip);
    expect(sideways.length === 0 && sb && sb.x + sb.width <= 393 + 0.5,
      `at 393 px nothing scrolls sideways (${JSON.stringify(sideways)}; strip right ${sb && Math.round(sb.x + sb.width)})`);
    await shot(pg, 'menu-fold-393');
    await pg.context().close();
  });

  await runStep('long-names', 'a 16-character name in the feed and on RECAP', async () => {
    await reset();
    let s = await get('/api/state');
    const a = s.players.find(x => x.gun_id === 'GUN-A'), b = s.players.find(x => x.gun_id === 'GUN-B');
    await must('PATCH', `/api/players/${a.player_id}`, { display: LONG });
    // opposite teams, so the kill is not a team kill
    const teams = s.config.teams.map(t => t.team_id);
    await must('PATCH', `/api/players/${a.player_id}`, { team_id: teams[0] });
    await must('PATCH', `/api/players/${b.player_id}`, { team_id: teams[1] });
    s = await toLive();
    const tidA = s.config.teams.find(t => t.team_id === teams[0]).tid;
    await nodes.cmd(`die GUN-B ${a.player_num} ${tidA}`);
    const pg = await page(browser, { width: 1440, height: 900 });
    await go(pg, 'MATCH');
    // structural, not a new data attribute: the medal tag is the last child of a feed row that carries a tag
    const medal = pg.locator('[data-feed-tag]:not([data-feed-tag=""]) > :last-child').first();
    expect(await until(() => medal.isVisible(), 10000, 'a medal tag in the feed'), 'the kill reaches the feed with a medal tag');
    const item = medal.locator('xpath=..');
    const panel = item.locator('xpath=..');
    const mb = await box(medal), pb = await box(panel);
    expect(mb && pb && mb.x + mb.width <= pb.x + pb.width + 0.5, `the medal tag ends inside the feed (${mb && Math.round(mb.x + mb.width)} ≤ ${pb && Math.round(pb.x + pb.width)})`);
    await shot(pg, 'long-feed-1440');
    await must('POST', '/api/control', { cmd: 'end' });
    await pg.setViewportSize({ width: 900, height: 900 });
    await until(async () => (await get('/api/state')).phase === 'recap', 8000, 'RECAP');
    await go(pg, 'MATCH');
    // the table row is the grid with a K cell; its first span is the name (the same on every build)
    const name = pg.locator(`xpath=//div[span[@data-cell="k"]]/span[1][normalize-space(.)="${LONG}"]`).first();
    expect(await until(() => name.isVisible(), 8000, 'the recap row'), 'RECAP lists the long name');
    const nr = await paintedRight(name);
    const kText = name.locator('xpath=following-sibling::*[@data-cell="k"][1]');
    const kLeft = await kText.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().left; }).catch(() => null);
    expect(nr != null && kLeft != null && nr <= kLeft + 0.5, `at 900 px the name's text stops before the K number (${nr && Math.round(nr)} ≤ ${kLeft && Math.round(kLeft)})`);
    // structural: an honours card is a chamfered card whose second span is the name
    const honor = pg.locator(`xpath=//div[contains(@style,"clip-path")]/span[2][normalize-space(.)="${LONG}"]`).first();
    if (await honor.count()) {
      const hr = await paintedRight(honor), cb = await box(honor.locator('xpath=..'));
      expect(hr != null && cb && hr <= cb.x + cb.width + 0.5, `the honours card name stays inside its card (${hr && Math.round(hr)} ≤ ${cb && Math.round(cb.x + cb.width)})`);
    } else console.log('    · no honour for the long name this match (the honours data is another lane\'s)');
    await shot(pg, 'long-recap-900');
    await pg.context().close();
  });

  c.step = 'errors';
  const real = jsErrors.filter(e => !IGNORED.test(e));
  expect(real.length === 0, `no console/page errors (${real.length})`);
  if (real.length) console.log(real.slice(0, 10).join('\n'));
} catch (e) {
  expect(false, `threw ${e?.stack || e}`);
} finally {
  // each stop guarded, so one that throws cannot leave the rest running
  for (const stop of [() => browser?.close(), () => nodes?.stop(), () => vite?.stop(), () => mc?.stop()]) {
    try { await stop(); } catch (e) { console.log(`    · a stop threw: ${e?.message || e}`); }
  }
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best effort */ }
}
process.exit(c.done());
