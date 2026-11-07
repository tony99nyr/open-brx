// Tony 2026-11-07 (via brx1): Domination FINAL SCORE PENDING. Domination is scored from the phones' `own_change` reports, so
// a phone out of Wi-Fi at the whistle may hold a capture MC has not heard. When the match ends on its target with a phone
// silent for 10 s, MC holds the result until every phone is in, or the operator presses END NOW.
//
//   node test/e2e/domination-pending.mjs
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…  SHOTS_DIR=…  HEADED=1
//
// A real python MC with a real node socket; two phones and three hill stations from `nodes.py`. Steps:
//   held      phone B walks out of Wi-Fi. Red takes hill A and keeps it: MC ends on the 20-point target on its own clock.
//             The open console, never reloaded, says FINAL SCORE PENDING, names phone B's player, shows no winner, no
//             team score and no FINAL IN countdown, and the button says END NOW. The server agrees.
//   end-now   phone B is dead. The first tap on END NOW arms it (TAP AGAIN: END NOW WITHOUT 1 PHONE) and releases
//             nothing; the second releases the result: MATCH COMPLETE, RED WINS, FINAL WITHOUT 1 PHONE.
import path from 'node:path';
import * as H from './lib/mc-harness.mjs';

const OUT = path.join(H.E2E_DIR, 'shots', 'domination-pending');
const SHOTS = process.env.SHOTS_DIR || OUT;
const HOME = path.join(OUT, 'home');
const c = H.checker();
const errors = [];
const P = await H.ports();
let mc = null, vite = null, browser = null, nodes = null;

const HILLS = ['hill-a', 'hill-b', 'hill-c'];
const TARGET = 20;
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
  console.log(`\n[${c.step}] Domination to ${TARGET} points, two phones, three hill stations, to LIVE`);
  let r = await put('/api/config', { mode: 'domination', time_limit_s: 1800 });
  if (r.status >= 400) throw new Error(`domination refused: ${JSON.stringify(r.body)}`);
  r = await put('/api/config', { scoring: { hold_target_s: TARGET } });
  if (r.status >= 400) throw new Error(`target refused: ${JSON.stringify(r.body)}`);
  nodes = await H.startNodes(mc.wsUrl, ['phone:GUN-A:3D4F', 'phone:GUN-B:3E60', ...HILLS.map(h => `util:${h}:android`)],
    { home: HOME, waitExit: 3000 });
  for (const h of HILLS) {
    r = await put(`/api/stations/${h}`, { kind: 'control' });
    if (r.status >= 400) throw new Error(`hill ${h} refused: ${JSON.stringify(r.body)}`);
  }
  let s = await srv.get('/api/state');
  const [RED, BLUE] = s.config.teams.map(t => t.team_id);
  const tid = Object.fromEntries(s.config.teams.map(t => [t.team_id, t.tid]));
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
  const nameB = (s.players.find(x => x.gun_id === 'GUN-B')?.display || '').toUpperCase();
  const redName = s.config.teams.find(t => t.team_id === RED).name.toUpperCase();
  c.expect(!!nameB && HILLS.every(h => Number.isInteger(sid[h])), `phone B has a player and every hill is assigned (${nameB})`);

  browser = await H.chromium.launch({ headless: !process.env.HEADED });
  const pg = await H.newPage(browser, { width: 1440, height: 900 }, errors, () => c.step);
  await pg.goto(`${vite.base}/#live`, { waitUntil: 'domcontentloaded' });
  await c.until(async () => /TIME REMAINING/.test(await H.bodyText(pg)), 15000, 'the operator LIVE board');
  await pg.evaluate(() => { window.__noReload = 1; });

  c.step = 'held';
  console.log(`\n[${c.step}] phone B walks out of Wi-Fi; red takes hill A and keeps it until MC ends on ${TARGET}`);
  await nodes.cmd('drop GUN-B');
  const go = (await srv.get('/api/state')).live.go_live_t;
  await nodes.cmd(`own GUN-A ${sid['hill-a']} 2 ${tid[RED]} ${(await srv.get('/api/state')).t}`);
  await c.until(async () => (await srv.get('/api/state')).phase === 'recap', (TARGET + 30) * 1000, 'the server in RECAP');
  s = await srv.get('/api/state');
  const sync = s.recap?.sync || {};
  c.expect(sync.pending === true && sync.score_pending === true, `the server holds the result (${JSON.stringify({ pending: sync.pending, score_pending: sync.score_pending })})`);
  c.expect(sync.release_in_s == null, `a held score has no bound (release_in_s ${sync.release_in_s})`);
  c.expect(s.recap?.winner == null, `the server names no winner (${JSON.stringify(s.recap?.winner)})`);
  c.expect(s.t - go >= TARGET * 1000, 'the match ran to its target');
  await c.until(async () => (await text(pg, '[data-testid="results-pending"]')) === 'FINAL SCORE PENDING', 15000,
    'the open console to say FINAL SCORE PENDING');
  const waiting = await text(pg, '[data-testid="waiting-for"]');
  c.expect(waiting.includes(nameB) || waiting.includes('1 PHONE'), `the console names the missing phone (${waiting})`);
  c.expect((await pg.getByTestId('release-in').count()) === 0, 'no FINAL IN countdown');
  const body = await H.bodyText(pg);
  c.expect(!/WINS|LEADS/.test(body), 'no winner on the console');
  c.expect((await pg.getByTestId('recap-headline').count()) === 0, 'no team score on the console');
  c.expect((await text(pg, '[data-testid="finalise"]')) === 'END NOW', 'the button says END NOW');
  await c.until(async () => pg.evaluate(() => [...document.querySelectorAll('.screen')].every(e => getComputedStyle(e).opacity === '1')),
    5000, 'the RECAP screen to finish fading in');
  await H.shot(pg, SHOTS, 'held');

  c.step = 'end-now';
  console.log(`\n[${c.step}] phone B is dead: END NOW, two taps`);
  await pg.getByTestId('finalise').click();
  await c.until(async () => (await text(pg, '[data-testid="finalise"]')) === 'TAP AGAIN: END NOW WITHOUT 1 PHONE', 5000,
    'the first tap to arm END NOW, naming one phone and no hill');
  c.expect((await srv.get('/api/state')).recap?.sync?.pending === true, 'the first tap releases nothing');
  await pg.getByTestId('finalise').click();
  await c.until(async () => /MATCH COMPLETE/.test(await text(pg, '[data-testid="recap-status"]')), 15000, 'the console to show the result');
  s = await srv.get('/api/state');
  c.expect(s.recap?.sync?.released_by === 'finalise' && s.recap?.winner?.team_id === RED,
    `the server released red's win by END NOW (${JSON.stringify({ by: s.recap?.sync?.released_by, winner: s.recap?.winner })})`);
  const after = await H.bodyText(pg);
  c.expect(after.includes(`${redName} WINS`), `the console says ${redName} WINS`);
  const without = await text(pg, '[data-testid="final-without"]');
  c.expect(without === `FINAL WITHOUT 1 PHONE (${nameB})`, `the console says it is final without phone B (${without})`);
  c.expect(await pg.evaluate(() => window.__noReload === 1), 'never reloaded');
  await H.shot(pg, SHOTS, 'end-now');

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
