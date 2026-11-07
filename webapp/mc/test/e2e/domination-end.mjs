// Review push 2026-11-06 (brx4): a Domination match on three real hill stations ends on its 1000-point target, and
// the console that watched it LIVE shows every field of the result WITHOUT a reload (game 2026-11-01 issue 3, F644).
//
//   node test/e2e/domination-end.mjs
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…  SHOTS_DIR=…  HEADED=1
//
// Domination is scored from the phones (Tony 2026-11-07): each phone near a hill sends `own_change` when the owner in
// its advert changes, and MC sums each owner's time. The suite sets a 30-point target (a real match takes 1000 points
// over minutes). A real python MC with a real node socket; two phones (`own` sends a phone's fact) and three hill
// stations from `nodes.py` (`control` sends a hill's own clock on its heartbeat: the cross-check on its STATIONS row,
// never the score). Steps:
//   live      the operator board shows each team's hill points and kills, read from the server, as the phones report.
//   dead-path a second tab's socket stops delivering with no close (a sleeping laptop, the Windows port proxy) while
//             the phones keep MC busy. The tab must say MC is offline and redial by itself: F644's watchdog starts at
//             MC's first heartbeat, and MC sent none while any phone was online (review 2026-11-06).
//   end       red takes hill A and keeps it with nobody near: MC ends the match on the target on its own clock, with no
//             new report. Both tabs, never reloaded, show RECAP:
//             the phase, the status, the winner, the HILL POINTS headline per team with its kills, the possession
//             rows, and one STATIONS row per hill with its owner and its points, all equal to the server's recap.
import path from 'node:path';
import * as H from './lib/mc-harness.mjs';

const OUT = path.join(H.E2E_DIR, 'shots', 'domination-end');
const SHOTS = process.env.SHOTS_DIR || OUT;
const HOME = path.join(OUT, 'home');
const c = H.checker();
const errors = [];
const P = await H.ports();
let mc = null, vite = null, browser = null, nodes = null;

const HILLS = ['hill-a', 'hill-b', 'hill-c'];
const TARGET = 30;
const TID_NAME = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'PURPLE' };   // contract.gen STATION_TID_NAME   // points: one owned-hill second each
/** Wait until the match has been live `secs` seconds, by the server's own clock. */
const playedAtLeast = (srv, secs) => c.until(async () => { const st = await srv.get('/api/state');
  return st.live?.go_live_t != null && st.t - st.live.go_live_t >= secs * 1000; }, (secs + 20) * 1000, `${secs} s of play`);
const text = async (pg, sel) => ((await pg.locator(sel).first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().toUpperCase();

try {
  mc = await H.startMC({ port: P.mc, wsPort: P.ws, home: HOME, fakeNet: false });
  vite = await H.startVite({ port: P.vite, mcPort: P.mc });
  const srv = H.api(mc.base);
  const put = async (p, body) => {
    const r = await fetch(`${mc.base}${p}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const patch = async (p, body) => (await fetch(`${mc.base}${p}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status;

  c.step = 'setup';
  console.log(`\n[${c.step}] Domination, two phones, three hill stations, to LIVE`);
  let r = await put('/api/config', { mode: 'domination', time_limit_s: 1800 });
  if (r.status >= 400) throw new Error(`domination refused: ${JSON.stringify(r.body)}`);
  const firstTarget = r.body?.scoring?.hold_target_s ?? (await srv.get('/api/state')).config.scoring.hold_target_s;
  r = await put('/api/config', { scoring: { hold_target_s: TARGET } });
  if (r.status >= 400) throw new Error(`domination refused: ${JSON.stringify(r.body)}`);
  nodes = await H.startNodes(mc.wsUrl, ['phone:GUN-A:3D4F', 'phone:GUN-B:3E60', ...HILLS.map(h => `util:${h}:android`)],
    { home: HOME, waitExit: 3000 });
  for (const h of HILLS) {
    r = await put(`/api/stations/${h}`, { kind: 'control' });
    if (r.status >= 400) throw new Error(`hill ${h} refused: ${JSON.stringify(r.body)}`);
  }
  let s = await srv.get('/api/state');
  const [RED, BLUE] = s.config.teams.map(t => t.team_id);
  const tid = Object.fromEntries(s.config.teams.map(t => [t.team_id, t.tid]));
  c.expect(firstTarget === 1000, `Domination's default target is first to 1000 (${firstTarget})`);
  c.expect(s.config.scoring.hold_target_s === TARGET, `the suite's target is ${TARGET} (${s.config.scoring.hold_target_s})`);
  for (const [gun, team] of [['GUN-A', RED], ['GUN-B', BLUE]]) {
    const p = s.players.find(x => x.gun_id === gun);
    if (p) await patch(`/api/players/${p.player_id}`, { team_id: team });
  }
  await c.until(async () => (await srv.get('/api/state')).nodes.filter(n => n.player_id).length >= 2, 15000, 'both phones bound');
  s = await srv.get('/api/state');
  if (s.phase !== 'lobby') await srv.post('/api/phase', { phase: 'lobby', force: true });
  r = await srv.post('/api/lobby/push', { force: true });
  if (r.status >= 400) throw new Error(`push refused: ${JSON.stringify(r.body)}`);
  r = await srv.post('/api/start', { runway_s: 0, force: true });
  if (r.status >= 400) throw new Error(`start refused: ${JSON.stringify(r.body)}`);
  await c.until(async () => (await srv.get('/api/state')).phase === 'live', 15000, 'the server LIVE');
  s = await srv.get('/api/state');
  const sid = Object.fromEntries(s.stations.filter(x => HILLS.includes(x.node_id)).map(x => [x.node_id, x.assigned?.id]));
  c.expect(HILLS.every(h => Number.isInteger(sid[h])), `every hill is assigned (${JSON.stringify(sid)})`);

  browser = await H.chromium.launch({ headless: !process.env.HEADED });
  const pg = await H.newPage(browser, { width: 1440, height: 900 }, errors, () => c.step);
  await pg.goto(`${vite.base}/#live`, { waitUntil: 'domcontentloaded' });
  await c.until(async () => /TIME REMAINING/.test(await H.bodyText(pg)), 15000, 'the operator LIVE board');
  await pg.evaluate(() => { window.__noReload = 1; });

  // a second tab whose first socket can be turned into a dead path; every redial after it passes through
  const pgB = await H.newPage(browser, { width: 1280, height: 800 }, errors, () => `${c.step}/B`);
  // a dev build mounts twice, so the socket to kill is the newest one at the moment the path dies
  let dead = 0, sockets = 0;
  await pgB.routeWebSocket(/\/ui-ws/, ws => {
    const mine = ++sockets;
    const server = ws.connectToServer();
    server.onMessage(m => { if (mine !== dead) ws.send(m); });
    ws.onMessage(m => server.send(m));
  });
  await pgB.goto(`${vite.base}/#live`, { waitUntil: 'domcontentloaded' });
  await c.until(async () => /TIME REMAINING/.test(await H.bodyText(pgB)), 15000, 'the second tab on LIVE');
  await pgB.evaluate(() => { window.__noReload = 1; });

  c.step = 'live';
  console.log(`\n[${c.step}] the phones report: red held A for 8 s and B for 4 s, blue held C for 6 s, then each drained`);
  await playedAtLeast(srv, 12);
  const go = (await srv.get('/api/state')).live.go_live_t;
  const own = (gun, hill, from, to, at) => nodes.cmd(`own ${gun} ${sid[hill]} ${from} ${to} ${go + at}`);
  await own('GUN-A', 'hill-a', 2, tid[RED], 1000);
  await own('GUN-B', 'hill-a', 2, tid[RED], 1100);          // a second phone, the same step: counted once
  await own('GUN-A', 'hill-a', tid[RED], 2, 9000);
  await own('GUN-A', 'hill-b', 2, tid[RED], 2000);
  await own('GUN-A', 'hill-b', tid[RED], 2, 6000);
  await own('GUN-B', 'hill-c', 2, tid[BLUE], 3000);
  await own('GUN-B', 'hill-c', tid[BLUE], 2, 9000);
  await nodes.cmd(`control hill-a 2 ${tid[RED]}=8000`);     // the Sticks' own clocks: their rows, not the score
  await nodes.cmd(`control hill-b 2 ${tid[RED]}=4000`);
  await nodes.cmd(`control hill-c 2 ${tid[BLUE]}=6000`);
  const live = await c.until(async () => {
    const st = await srv.get('/api/state'), by = st.live?.possession?.by_team;
    return by && by[RED] === 12 && by[BLUE] === 6 ? st : null;
  }, 15000, 'the server to score red 12, blue 6');
  if (live) {
    for (const team of [RED, BLUE]) {
      await c.until(async () => (await text(pg, `[data-team-score="${team}"]`)) === String(live.live.possession.by_team[team]), 10000,
        `the board to show ${team} ${live.live.possession.by_team[team]} points`);
      c.expect((await text(pg, `[data-team-sub="${team}"]`)) === `KILLS ${live.live.score[team] ?? 0}`, `${team}'s kills under its points`);
    }
    c.expect((await H.bodyText(pg)).includes('MOST HILL POINTS WINS'), 'the board header says points, not time');
  }
  await H.shot(pg, SHOTS, 'live');

  c.step = 'dead-path';
  console.log(`\n[${c.step}] the second tab's socket stops delivering, with no close, while the phones keep MC busy`);
  dead = sockets;
  // the link-down signal is the console's own `onLink(false)`; the pill it raises lasts only until the redial lands,
  // so the suite counts the redial and then checks the tab is current again
  const t0 = Date.now();
  const redialled = await c.until(async () => sockets > dead, 30000, 'the second tab to give the dead socket up and redial by itself');
  if (redialled) console.log(`      redialled after ${Date.now() - t0} ms (socket ${dead} -> ${sockets})`);
  await c.until(async () => (await pgB.getByTestId('frame-mc-offline').count()) === 0
    && /TIME REMAINING/.test(await H.bodyText(pgB)), 15000, 'the second tab back on a live board');
  c.expect(await pgB.evaluate(() => window.__noReload === 1), 'the second tab was never reloaded');

  c.step = 'end';
  console.log(`\n[${c.step}] red takes hill A again and keeps it with nobody near: MC ends on ${TARGET} on its own clock`);
  const back = (await srv.get('/api/state')).t - go;
  await own('GUN-A', 'hill-a', 2, tid[RED], back);
  await nodes.cmd(`control hill-a ${tid[RED]} ${tid[RED]}=${8000 + 18000}`);
  await c.until(async () => (await srv.get('/api/state')).phase === 'recap', (TARGET - 12 + 20) * 1000, 'the server in RECAP');
  s = await srv.get('/api/state');
  c.expect((s.feed || []).some(e => /SCORE TARGET 30 POINTS REACHED/.test(e.text || '')), 'the feed says MC ended on the points target');
  if (s.recap?.sync && !s.recap.sync.finalised && /WAITING FOR RESULTS/.test(await H.bodyText(pg))) {
    await srv.post('/api/recap/finalise', {});    // the operator's FINALISE; the result must still arrive without a reload
  }
  await c.until(async () => /MATCH COMPLETE/.test(await text(pg, '[data-testid="recap-status"]')), 15000, 'the open console to show the result');
  const rc = (await srv.get('/api/state')).recap;
  const by = rc?.possession?.by_team || {};
  // the tick that crosses the target runs about once a second, so red ends at the target or a point past it
  c.expect((by[RED] === TARGET || by[RED] === TARGET + 1) && by[BLUE] === 6, `the server's recap: red ${TARGET}, blue 6 (${JSON.stringify(by)})`);
  c.expect(rc?.winner?.team_id === RED, `the server's winner is red (${JSON.stringify(rc?.winner)})`);
  for (const [tab, page] of [['A', pg], ['B', pgB]]) {
    await c.until(async () => /MATCH COMPLETE/.test(await text(page, '[data-testid="recap-status"]')), 15000, `tab ${tab}: RECAP without a reload`);
    c.expect((await page.getByTestId('phase-chip').innerText()).includes('■ MATCH OVER'), `tab ${tab}: the header says MATCH OVER`);
    const body = await H.bodyText(page);
    c.expect(body.includes('MATCH COMPLETE · DOMINATION'), `tab ${tab}: the status names the mode`);
    const redName = s.config.teams.find(t => t.team_id === RED).name.toUpperCase();
    c.expect(body.includes(`${redName} WINS`), `tab ${tab}: ${redName} WINS`);
    const head = await text(page, '[data-testid="recap-headline"]');
    c.expect(head.startsWith('HILL POINTS'), `tab ${tab}: the headline says HILL POINTS (${head.slice(0, 40)})`);
    for (const team of [RED, BLUE]) {
      const cell = await text(page, `[data-headline-team="${team}"]`);
      c.expect(cell === `${by[team]} KILLS ${rc.score[team] ?? 0}`, `tab ${tab}: ${team}'s headline is ${by[team]} points and its kills (${cell})`);
    }
    const poss = await text(page, '[data-testid="possession"]');
    for (const team of [RED, BLUE]) c.expect(poss.includes(String(by[team])), `tab ${tab}: the possession row for ${team} says ${by[team]}`);
    const stations = await text(page, '[data-testid="recap-stations"]');
    c.expect(stations.includes('3 ASSIGNED'), `tab ${tab}: three hills in STATIONS`);
    c.expect(!stations.includes('NEVER HEARD FROM'), `tab ${tab}: every hill was heard`);
    for (const row of rc.stations || []) {
      const owner = row.owner === 2 ? null : TID_NAME[row.owner];   // tid 2 on a hill is neutral (brx1 2026-11-06)
      c.expect(owner ? stations.includes(`HELD BY ${owner}`) : stations.includes('NOBODY HOLDS IT'),
        `tab ${tab}: hill ${row.id} ${owner ? `held by ${owner}` : 'held by nobody'}`);
      for (const [t, ms] of Object.entries(row.hold_ms || {})) {
        const pts = `${TID_NAME[t]} ${Math.round(ms / 1000)}`;   // Domination: points, so no "s" (brx1 2026-11-06)
        c.expect(new RegExp(`${pts}(?!\\d|S)`).test(stations), `tab ${tab}: hill ${row.id} shows ${pts} points, not seconds`);
      }
    }
    c.expect(await page.evaluate(() => window.__noReload === 1), `tab ${tab}: never reloaded`);
    await H.shot(page, SHOTS, `recap-${tab}`);
  }

  c.step = 'errors';
  const real = errors.filter(e => !/WebSocket connection .* failed|502 \(Bad Gateway\)/.test(e));
  c.expect(real.length === 0, `no console or page errors (${real.length})`);
  if (real.length) console.log(real.slice(0, 10).join('\n'));
} catch (e) {
  c.failures.push(`${c.step}: threw ${e && e.stack || e}`);
  console.log(`    ✗ threw: ${e && e.message}`);
} finally {
  if (nodes) await nodes.stop();
  if (browser) await browser.close();
  if (vite) await vite.stop();
  if (mc) await mc.stop();
}
process.exit(c.done());
