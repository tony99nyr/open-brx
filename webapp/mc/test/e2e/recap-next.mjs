// RECAP, clicked in a real browser against a real demo MC (MC visual QA 2026-09-23: M1, M23, and the
// NEXT MATCH ▸ path, which the older suites reached only by calling `/api/session/new` directly).
//
//   node test/e2e/recap-next.mjs
//   ONLY=real|stale  MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…   SHOTS_DIR=…   HEADED=1
//
// Steps:
//   real   the operator ENDS the match early from LIVE, and RECAP must then say
//          - one honest thing about the END: no "NEVER" while MC is still re-delivering, and REACHED
//            kept apart from CONFIRMED (M1),
//          - the match's real length, which the server's own clock gives, not the 10:00 limit (M23);
//          then NEXT MATCH ▸ is CLICKED: the console lands on GAMES with the same game loaded, and the
//          server has left RECAP.
//   stale  the same RECAP with `since_end_ms` and `end_delivery` stripped over REST AND the WebSocket
//          (an MC that predates them): the header says LIMIT, not a length, and nothing crashes.
import path from 'node:path';
import * as H from './lib/mc-harness.mjs';

const OUT = path.join(H.E2E_DIR, 'shots', 'recap-next');
const SHOTS = process.env.SHOTS_DIR || OUT;
const ONLY = process.env.ONLY || '';
const c = H.checker();
const errors = [];
const P = await H.ports();
let mc = null, vite = null, browser = null;

/** The length the RECAP header must show, from the server's own snapshot (state.py `settling()`). */
const serverLength = s => {
  const since = s.recap?.since_end_ms, go = s.live?.go_live_t;
  if (typeof since !== 'number' || typeof go !== 'number') return null;
  const secs = Math.max(0, Math.round((s.t - since - go) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
};

/** The length part of "[ A8 // MATCH COMPLETE · TDM · 2:13 OF 10:00 ]", as "· 2:13 OF 10:00". */
const headerLength = body => {
  const m = /MATCH COMPLETE · [A-Z]+( · [^\]]*?)? \]/.exec(body);
  return m ? (m[1] || '').trim() : null;
};

async function endFromLive(pg) {
  await pg.goto(`${vite.base}/#live`, { waitUntil: 'domcontentloaded' });
  const end = pg.getByRole('button', { name: 'END MATCH EARLY' });
  await end.waitFor({ state: 'visible', timeout: 15000 });
  await end.click();
  await pg.getByRole('button', { name: 'CONFIRM END' }).click();
  await pg.locator('[data-testid="end-delivery-recap"]').waitFor({ state: 'visible', timeout: 15000 });
}

try {
  mc = await H.startMC({ port: P.mc, wsPort: P.ws, home: path.join(OUT, 'home') });
  vite = await H.startVite({ port: P.vite, mcPort: P.mc });
  const srv = H.api(mc.base);
  browser = await H.chromium.launch({ headless: !process.env.HEADED });

  const live = await H.startAMatch(mc.base);
  c.expect(live.phase === 'live', 'the real MC is LIVE before the browser ends the match');
  // let the demo play a few seconds, so an early END is visibly shorter than the limit
  await c.until(async () => { const s = await srv.get('/api/state'); return (s.feed ?? []).length >= 2 && s.t - s.live.go_live_t >= 6000; },
    30000, 'the demo match to play six seconds and produce feed events');

  if (!ONLY || ONLY === 'real') {
    c.step = 'real/end';
    console.log(`\n[${c.step}] END MATCH EARLY, clicked`);
    const pg = await H.newPage(browser, { width: 1440, height: 900 }, errors, () => c.step);
    await endFromLive(pg);
    c.expect(new URL(pg.url()).hash === '#recap', 'the whistle moved the LIVE board to #recap');

    c.step = 'real/m1';
    console.log(`\n[${c.step}] one honest statement about the END`);
    const s = await srv.get('/api/state');
    const ed = s.end_delivery;
    console.log(`      end_delivery: retrying=${ed?.retrying} unconfirmed=${ed?.unconfirmed?.length} of ${ed?.total}`);
    const block = pg.locator('[data-testid="end-delivery-recap"]');
    const t = ((await block.innerText()) || '').replace(/\s+/g, ' ').toUpperCase();
    console.log(`      "${t.slice(0, 200)}"`);
    if (c.expect(ed && ed.retrying, 'the server is still re-delivering the END (the case the QA saw)')) {
      c.expect(!/NEVER/.test(t), 'RECAP does not say NEVER while MC is still re-delivering');
      c.expect(/NOT CONFIRMED THE END YET/.test(t), 'it says the END is not confirmed YET');
      c.expect(/STILL RE-DELIVERING/.test(t), 'it says MC is still re-delivering');
      c.expect(await block.getAttribute('data-end-state') === 'retrying', 'the block is in its retrying (amber) state');
    }
    c.expect(/REACHING A NODE IS NOT A CONFIRMATION/.test(t), 'it keeps REACHED apart from CONFIRMED');
    const unconfirmed = new Set((ed?.unconfirmed ?? []).map(u => u.player_id));
    const chips = await pg.locator('[data-sync-chip]').evaluateAll(els => els.map(e => [e.getAttribute('data-sync-chip'), (e.textContent || '').toUpperCase()]));
    c.expect(chips.length > 0, `the DATA SYNC chips render (${chips.length})`);
    const bare = chips.filter(([pid, txt]) => unconfirmed.has(pid) && /SYNCED/.test(txt) && !/END NOT CONFIRMED/.test(txt));
    c.expect(bare.length === 0, `no chip calls an unconfirmed HUD bare "SYNCED" (${bare.length} did)`);

    c.step = 'real/m23';
    console.log(`\n[${c.step}] the header shows the real length`);
    const want = serverLength(await srv.get('/api/state'));
    // read off the rendered header, not a test id, so this step says the same thing about any build
    const head = headerLength(await H.bodyText(pg));
    console.log(`      header "${head}", server length ${want}`);
    c.expect(want != null, 'the server snapshot carries what the length is measured from');
    c.expect(want != null && head.startsWith(`· ${want} OF `), `the header reads the real length (${want}), out of the limit`);
    c.expect(head !== '· 10:00', 'the header is not the bare 10:00 limit');

    for (const [w, h] of [[1440, 900], [1280, 800], [900, 900]]) {
      await pg.setViewportSize({ width: w, height: h });
      await pg.waitForTimeout(250);
      await H.shot(pg, SHOTS, `recap-${w}`);
      const over = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      c.expect(!over, `no sideways scroll at ${w} px`);
    }
    await pg.setViewportSize({ width: 1440, height: 900 });

    c.step = 'real/next-match';
    console.log(`\n[${c.step}] NEXT MATCH ▸, clicked`);
    const before = await srv.get('/api/state');
    const btn = pg.getByRole('button', { name: 'NEXT MATCH ▸' });
    c.expect(await btn.count() === 1, 'RECAP shows one NEXT MATCH ▸ button');
    await btn.click();
    await c.until(async () => new URL(pg.url()).hash === '#build', 10000, 'the console to land on GAMES (#build)');
    await c.until(async () => /LOADED GAME/.test(await H.bodyText(pg)), 10000, 'GAMES to show the LOADED GAME');
    const after = await srv.get('/api/state');
    console.log(`      server: ${before.phase} -> ${after.phase}, game.loaded=${after.game?.loaded}, mode=${after.config?.mode}`);
    c.expect(after.phase === 'build', `the server left RECAP for BUILD (it is ${after.phase})`);
    c.expect(after.game?.loaded === true, 'the server has the game loaded again');
    c.expect(after.config?.mode === before.config?.mode, 'it is the same game');
    c.expect(!after.live, 'no live match is left over');
    const games = await H.bodyText(pg);
    c.expect(/CONTINUE TO KIT/.test(games), 'GAMES offers CONTINUE TO KIT');
    c.expect(!/MATCH COMPLETE/.test(games), 'the RECAP is gone from the screen');
    await H.shot(pg, SHOTS, 'games-after-next-1440');
    await pg.context().close();
  }

  if (!ONLY || ONLY === 'stale') {
    c.step = 'stale';
    console.log(`\n[${c.step}] RECAP against an MC that predates since_end_ms and end_delivery`);
    let s = await srv.get('/api/state');
    if (s.phase !== 'recap') {
      if (s.phase !== 'live') s = await H.startAMatch(mc.base);
      const r = await srv.post('/api/control', { cmd: 'end' });
      c.expect(r.status < 400, `the MC ended the match for the stale step (${r.status})`);
      await c.until(async () => (await srv.get('/api/state')).phase === 'recap', 10000, 'RECAP');
    }
    const strip = st => {
      if (st && typeof st === 'object') {
        delete st.end_delivery;
        if (st.recap) { delete st.recap.since_end_ms; delete st.recap.settling; delete st.recap.awaiting; }
      }
      return st;
    };
    const pg = await H.newPage(browser, { width: 1280, height: 800 }, errors, () => c.step);
    await pg.route('**/api/state', async route => {
      const r = await route.fetch(); const body = strip(await r.json());
      await route.fulfill({ response: r, json: body });
    });
    await pg.routeWebSocket(/\/ui-ws/, ws => {
      const server = ws.connectToServer();
      server.onMessage(m => {
        try { const j = JSON.parse(String(m)); if (j.kind === 'snapshot') strip(j.state); ws.send(JSON.stringify(j)); }
        catch { ws.send(m); }
      });
      ws.onMessage(m => server.send(m));
    });
    await pg.goto(`${vite.base}/#recap`, { waitUntil: 'domcontentloaded' });
    await c.until(async () => /MATCH COMPLETE/.test(await H.bodyText(pg)), 15000, 'the RECAP header');
    const head = headerLength(await H.bodyText(pg));
    console.log(`      header "${head}"`);
    c.expect(/^· LIMIT \d+:\d\d$/.test(head), 'with nothing to measure from, the header says LIMIT, not a length');
    c.expect(await pg.locator('[data-testid="end-delivery-recap"]').count() === 0, 'no END block is invented for a server that sends none');
    c.expect(await pg.getByRole('button', { name: 'NEXT MATCH ▸' }).count() === 1, 'NEXT MATCH ▸ is still there');
    await H.shot(pg, SHOTS, 'recap-stale-1280');
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
