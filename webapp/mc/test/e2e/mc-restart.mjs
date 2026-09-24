// A real MC restarted mid-match, with a browser tab left open across it (MC visual QA 2026-09-23: H3,
// and two paths no suite covered: a real restart, and a tab that outlives its server).
//
//   node test/e2e/mc-restart.mjs
//   MC_PORT=… MC_WS_PORT=… VITE_PORT=… MC_PY=…  SHOTS_DIR=…  HEADED=1
//
// The MC persists to a session file in this suite's own folder. The suite starts a match, opens the
// operator console and the spectator board, STOPS the MC process, and starts it again on the same file
// and ports, so it resumes the match. Then:
//   - the open tabs reconnect on their own and render the RESUMED state, not the dead process's
//     snapshot: the same match, the server's clock, and the new process's "MC RESTARTED" feed line;
//   - no age on the board is the never-seen sentinel (`sync_age_ms: 1000000000`, "11d13h"). This one
//     assertion is H3 and depends on lane B1's fix; it is labelled [H3/B1] in the output;
//   - a tab opened after the restart shows the same thing as the one that stayed open.
import fs from 'node:fs';
import path from 'node:path';
import * as H from './lib/mc-harness.mjs';

const OUT = path.join(H.E2E_DIR, 'shots', 'mc-restart');
const SHOTS = process.env.SHOTS_DIR || OUT;
const c = H.checker();
const errors = [];
const P = await H.ports();
const home = path.join(OUT, 'home');
const sessionFile = path.join(OUT, 'session.json');
let mc = null, vite = null, browser = null;

/** "TIME REMAINING 09:33" on the page, in seconds. */
const shownRemaining = async pg => {
  const m = /TIME REMAINING (\d+):(\d\d)/.exec(await H.bodyText(pg));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** Every age a person would read as "days": the sentinel rendered as a real age. */
const DAYS_AGE = /\b\d+D\d*H? AGO\b|\b\d+D\d+H\b/;

try {
  fs.rmSync(OUT, { recursive: true, force: true });           // this suite's own folder only
  mc = await H.startMC({ port: P.mc, wsPort: P.ws, home, sessionFile });
  vite = await H.startVite({ port: P.vite, mcPort: P.mc });
  const srv = H.api(mc.base);
  browser = await H.chromium.launch({ headless: !process.env.HEADED });

  c.step = 'before';
  const live = await H.startAMatch(mc.base);
  const mid = live.live?.match_id;
  c.expect(live.phase === 'live' && !!mid, `the real MC is LIVE (match ${mid})`);
  await c.until(async () => { const s = await srv.get('/api/state'); return (s.feed ?? []).length >= 2 && s.t - s.live.go_live_t >= 4000; },
    30000, 'the demo match to play a few seconds');
  const op = await H.newPage(browser, { width: 1440, height: 900 }, errors, () => c.step);
  await op.goto(`${vite.base}/#live`, { waitUntil: 'domcontentloaded' });
  await c.until(async () => /TIME REMAINING/.test(await H.bodyText(op)), 15000, 'the operator LIVE board');
  const sp = await H.newPage(browser, { width: 1280, height: 800 }, errors, () => c.step);
  await sp.goto(`${vite.base}/#spectate`, { waitUntil: 'domcontentloaded' });
  await c.until(async () => /LATEST/.test(await H.bodyText(sp)), 15000, 'the spectator board');
  await H.shot(op, SHOTS, 'live-before-restart-1440');
  // the session file must be on disk before the process goes, or there is nothing to resume
  await c.until(async () => fs.existsSync(sessionFile), 10000, 'MC to persist the session file');

  c.step = 'down';
  console.log(`\n[${c.step}] the MC process is stopped (pid ${mc.proc.pid})`);
  await mc.stop(); mc = null;
  c.expect(!!await c.until(async () => /MC OFFLINE/.test(await H.bodyText(op)), 15000, 'the MC OFFLINE banner'),
    'the open console says MC is offline');

  c.step = 'resume';
  console.log(`\n[${c.step}] the MC is started again on the same session file`);
  mc = await H.startMC({ port: P.mc, wsPort: P.ws, home, sessionFile });
  c.expect(/match resumed/i.test(mc.log), 'the new MC says it resumed the match');
  const s = await srv.get('/api/state');
  c.expect(s.phase === 'live', `the server is LIVE again (${s.phase})`);
  c.expect(s.live?.match_id === mid, 'it is the same match');
  const restartLine = (s.feed ?? []).find(e => /MC RESTARTED/.test(e.text));
  c.expect(!!restartLine, 'the new process has an MC RESTARTED feed line');

  for (const [name, pg] of [['operator', op], ['spectator', sp]]) {
    c.step = `open-tab/${name}`;
    console.log(`\n[${c.step}] the tab left open across the restart`);
    c.expect(!!await c.until(async () => !/MC OFFLINE/.test(await H.bodyText(pg)), 20000, 'the tab to reconnect'),
      'the tab reconnected on its own (no MC OFFLINE banner)');
    c.expect(!!await c.until(async () => /MC RESTARTED/.test(await H.bodyText(pg)), 10000, "the new process's feed line"),
      'the tab shows the new process feed, not the dead one (no stale snapshot)');
    const st = await srv.get('/api/state');
    const want = Math.round((st.live.ends_t - st.t) / 1000), got = await shownRemaining(pg);
    c.expect(got != null && Math.abs(got - want) <= 3, `the clock follows the resumed match (shows ${got} s, server ${want} s)`);
  }

  c.step = 'open-tab/ages';
  console.log(`\n[${c.step}] honest ages on the resumed board`);
  const t = await H.bodyText(op);
  const days = DAYS_AGE.exec(t);
  c.expect(!days, `[H3/B1] no row shows the never-seen sentinel as an age (found "${days?.[0] ?? ''}")`);
  c.expect(!/1000000000|1E\+?9/.test(t), '[H3/B1] no raw sentinel number reaches the screen');
  for (const [w, h] of [[1440, 900], [1280, 800], [900, 900]]) {
    await op.setViewportSize({ width: w, height: h });
    await op.waitForTimeout(250);
    await H.shot(op, SHOTS, `live-after-restart-${w}`);
  }
  await H.shot(sp, SHOTS, 'spectate-after-restart-1280');

  c.step = 'fresh-tab';
  console.log(`\n[${c.step}] a tab opened after the restart`);
  const fresh = await H.newPage(browser, { width: 1440, height: 900 }, errors, () => c.step);
  await fresh.goto(`${vite.base}/#live`, { waitUntil: 'domcontentloaded' });
  await c.until(async () => /TIME REMAINING/.test(await H.bodyText(fresh)), 15000, 'the LIVE board');
  c.expect(/MC RESTARTED/.test(await H.bodyText(fresh)), 'it shows the MC RESTARTED line');
  const a = (await H.bodyText(op)).match(/EVENT FEED \/\/ LIVE (.*)$/)?.[1]?.slice(0, 120);
  const b = (await H.bodyText(fresh)).match(/EVENT FEED \/\/ LIVE (.*)$/)?.[1]?.slice(0, 120);
  c.expect(!!a && a === b, 'the tab that stayed open shows the same feed as the fresh one');

  c.step = 'errors';
  const real = errors.filter(e => !/WebSocket connection .* failed|502 \(Bad Gateway\)|Failed to load resource/.test(e));
  c.expect(real.length === 0, `no console or page errors beyond the expected offline ones (${real.length})`);
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
