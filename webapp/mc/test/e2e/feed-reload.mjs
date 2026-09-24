// The LIVE event feed on a tab opened or reloaded mid-match, in a real browser against a real demo MC
// (MC visual QA 2026-09-23, H4: a reloaded console and the spectator board said "WAITING FOR THE FIRST
// SYNC POINT…" mid-match, because the store ignored the snapshot's `feed`).
//
//   node test/e2e/feed-reload.mjs
//   ONLY=operator|spectator|stale  MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…  SHOTS_DIR=…
//
// Steps:
//   operator   the console at #live, then RELOADED: the feed shows the match's events both times.
//   spectator  a fresh #spectate tab, then reloaded: the LATEST list shows them too.
//   stale      the snapshot's `feed` stripped over REST AND the WebSocket (an MC that predates it): the
//              board still renders, nothing crashes, and live feed pushes still arrive.
import path from 'node:path';
import * as H from './lib/mc-harness.mjs';

const OUT = path.join(H.E2E_DIR, 'shots', 'feed-reload');
const SHOTS = process.env.SHOTS_DIR || OUT;
const ONLY = process.env.ONLY || '';
const c = H.checker();
const errors = [];
const P = await H.ports();
let mc = null, vite = null, browser = null;

/** Some text from the server's feed, as the page upper-cases it. The newest few are the ones every
 *  view shows (the spectator board clips to the height it has). */
const serverTexts = async srv => ((await srv.get('/api/state')).feed ?? []).slice(0, 4).map(e => String(e.text).toUpperCase());
const showsServerFeed = async (pg, srv) => {
  const [txt, want] = [await H.bodyText(pg), await serverTexts(srv)];
  return want.length > 0 && want.some(w => txt.includes(w));
};

try {
  mc = await H.startMC({ port: P.mc, wsPort: P.ws, home: path.join(OUT, 'home') });
  vite = await H.startVite({ port: P.vite, mcPort: P.mc });
  const srv = H.api(mc.base);
  browser = await H.chromium.launch({ headless: !process.env.HEADED });
  const live = await H.startAMatch(mc.base);
  c.expect(live.phase === 'live', 'the real MC is LIVE');
  await c.until(async () => ((await srv.get('/api/state')).feed ?? []).length >= 2, 20000, 'the server feed to hold events');

  if (!ONLY || ONLY === 'operator') {
    c.step = 'operator';
    console.log(`\n[${c.step}] the console at #live, opened mid-match and then reloaded`);
    const pg = await H.newPage(browser, { width: 1440, height: 900 }, errors, () => c.step);
    await pg.goto(`${vite.base}/#live`, { waitUntil: 'domcontentloaded' });
    await c.until(async () => /EVENT FEED/.test(await H.bodyText(pg)), 15000, 'the LIVE board');
    await c.until(async () => /TIME REMAINING/.test(await H.bodyText(pg)), 5000, 'the first snapshot');
    c.expect(!/WAITING FOR THE FIRST SYNC POINT/.test(await H.bodyText(pg)), 'a tab opened mid-match does not say WAITING FOR THE FIRST SYNC POINT');
    c.expect(await showsServerFeed(pg, srv), 'a tab opened mid-match shows the events so far');
    await pg.reload({ waitUntil: 'domcontentloaded' });
    await c.until(async () => /EVENT FEED/.test(await H.bodyText(pg)), 15000, 'the LIVE board after the reload');
    // Checked BEFORE the next demo event could arrive as a push: the reload must fill it from the snapshot.
    await c.until(async () => /TIME REMAINING/.test(await H.bodyText(pg)), 5000, 'the first snapshot');
    const t = await H.bodyText(pg);
    c.expect(!/WAITING FOR THE FIRST SYNC POINT/.test(t), 'the reloaded tab does not say WAITING FOR THE FIRST SYNC POINT');
    c.expect(await showsServerFeed(pg, srv), "the reloaded tab shows the server's events");
    await H.shot(pg, SHOTS, 'operator-reloaded-1440');
    await pg.context().close();
  }

  if (!ONLY || ONLY === 'spectator') {
    c.step = 'spectator';
    console.log(`\n[${c.step}] the spectator board, opened mid-match and then reloaded`);
    const pg = await H.newPage(browser, { width: 1440, height: 900 }, errors, () => c.step);
    for (const how of ['opened', 'reloaded']) {
      if (how === 'opened') await pg.goto(`${vite.base}/#spectate`, { waitUntil: 'domcontentloaded' });
      else await pg.reload({ waitUntil: 'domcontentloaded' });
      await c.until(async () => /LATEST/.test(await H.bodyText(pg)) && /TIME REMAINING/.test(await H.bodyText(pg)), 15000, `the board (${how})`);
      const t = await H.bodyText(pg);
      c.expect(!/NOTHING YET\./.test(t), `the ${how} board does not say NOTHING YET.`);
      c.expect(await showsServerFeed(pg, srv), `the ${how} board shows the server's events`);
    }
    await H.shot(pg, SHOTS, 'spectator-reloaded-1440');
    await pg.context().close();
  }

  if (!ONLY || ONLY === 'stale') {
    c.step = 'stale';
    console.log(`\n[${c.step}] an MC that sends no snapshot feed`);
    const pg = await H.newPage(browser, { width: 1280, height: 800 }, errors, () => c.step);
    await pg.route('**/api/state', async route => {
      const r = await route.fetch(); const j = await r.json(); delete j.feed;
      await route.fulfill({ response: r, json: j });
    });
    await pg.routeWebSocket(/\/ui-ws/, ws => {
      const server = ws.connectToServer();
      server.onMessage(m => {
        try { const j = JSON.parse(String(m)); if (j.kind === 'snapshot' && j.state) delete j.state.feed; ws.send(JSON.stringify(j)); }
        catch { ws.send(m); }
      });
      ws.onMessage(m => server.send(m));
    });
    await pg.goto(`${vite.base}/#live`, { waitUntil: 'domcontentloaded' });
    await c.until(async () => /TIME REMAINING/.test(await H.bodyText(pg)), 15000, 'the LIVE board against a stale server');
    c.expect(await pg.getByRole('button', { name: 'END MATCH EARLY' }).count() === 1, 'the board and its END control render');
    // a live `feed` push still lands (the demo produces one every few seconds)
    c.expect(!!await c.until(async () => !/WAITING FOR THE FIRST SYNC POINT/.test(await H.bodyText(pg)), 45000, 'a live feed push'),
      'live feed pushes still fill the feed');
    await pg.context().close();
  }

  c.step = 'errors';
  const real = errors.filter(e => !/WebSocket connection .* failed|502 \(Bad Gateway\)/.test(e));
  c.expect(real.length === 0, `no console or page errors (${real.length})`);
  if (real.length) console.log(real.slice(0, 10).join('\n'));
} catch (e) {
  c.failures.push(`${c.step}: threw ${e && e.stack || e}`);
  console.log(`    ✗ threw: ${e && e.message}`);
} finally {
  if (browser) await browser.close();
  if (vite) await vite.stop();
  if (mc) await mc.stop();
}
process.exit(c.done());
