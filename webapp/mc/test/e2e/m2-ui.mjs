// M2 U — the LIVE board's legibility (S24), the spectator route (S25), the A29 version chips and the
// A27 CONTINUE guard, clicked in a REAL browser.
//
// `test/live-legibility.test.tsx`, `test/spectate.test.tsx` and `test/server-guards.test.tsx` are the
// same behaviour in jsdom, in 2 s. This is the half jsdom cannot do: real fonts (the whole tabular-
// figures question is a FONT question), real layout at two viewports, a real python MC, and a stale
// server faked over REST *and* the WebSocket.
//
//   npm run e2e:m2                    # everything
//   ONLY=mock npm run e2e:m2          # one run: measure | mock | phone | real | refusal | stale | offline
//   MC_PORT=… VITE_PORT=… MC_PY=…     # move the ports / pick the interpreter
//   SHOT_DIR=…                        # where the screenshots go (default ~/brx-scratch/m2ui)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MC_DIR = path.resolve(HERE, '../..');
const REPO = path.resolve(MC_DIR, '../..');
const SHOTS = process.env.SHOT_DIR || path.join(os.homedir(), 'brx-scratch/m2ui');
const MC_PORT = Number(process.env.MC_PORT || 8796);
const VITE_PORT = Number(process.env.VITE_PORT || 5183);
const ONLY = process.env.ONLY || '';
const DESK = { width: 1280, height: 800 };
const PHONE = { width: 393, height: 830 };

fs.mkdirSync(SHOTS, { recursive: true });

let failures = [], step = '', stepFailedAt = 0;
const expect = (cond, what) => { if (cond) return true; failures.push(`${step}: ${what}`); console.log(`    ✗ ${what}`); return false; };
const ok = what => console.log(failures.length > stepFailedAt ? `    ⊘ ${what} (step already failed)` : `    ✓ ${what}`);
const until = async (pred, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = false; try { v = await pred(); } catch { v = false; }
    if (v) return true;
    if (Date.now() > end) { expect(false, `timed out waiting for ${what}`); return false; }
    await new Promise(r => setTimeout(r, 80));
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

async function startMC() {
  const py = process.env.MC_PY || path.join(REPO, '.venv/bin/python');
  try {
    const r = await fetch(`http://127.0.0.1:${MC_PORT}/api/state`, { signal: AbortSignal.timeout(1200) });
    if (r.ok) { console.error(`SOMETHING ALREADY SERVES :${MC_PORT} — refusing to drive a server this run did not start.`); process.exit(3); }
  } catch { /* free: good */ }
  const wsPort = await freePort();
  const proc = spawn(py, ['-m', 'brx_mcp.mc', '--host', '127.0.0.1', '--port', String(MC_PORT), '--ws-port', String(wsPort),
    '--demo', '--fake-net', '--no-auth', '--ephemeral'], { cwd: path.join(REPO, 'mcp'), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${MC_PORT}`;
  for (let i = 0; i < 250; i++) {
    try { const r = await fetch(`${base}/api/state`); if (r.ok) break; } catch { /* not yet */ }
    if (proc.exitCode != null) { console.error(`MC DIED:\n${log}`); process.exit(3); }
    await new Promise(r => setTimeout(r, 100));
  }
  const who = await (await fetch(`${base}/api/state`)).json();
  if (proc.exitCode != null || /address already in use|Errno 98/i.test(log)) {
    console.error(`OUR MC FAILED TO BIND :${MC_PORT}:\n${log}`); process.exit(3);
  }
  if (who?.lan?.port !== MC_PORT) { console.error(`:${MC_PORT} reports lan.port ${who?.lan?.port}`); await killGroup(proc); process.exit(3); }
  console.log(`  MC: ${base} (session ${who.session_id}, ${who.players?.length ?? 0} players, phase ${who.phase})`);
  return { base, stop: () => killGroup(proc) };
}
async function startVite() {
  const proc = spawn('npx', ['vite', '--config', path.join(HERE, 'vite.m2.config.mjs'), '--port', String(VITE_PORT), '--strictPort'],
    { cwd: MC_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, MC_PROXY_PORT: String(MC_PORT) } });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${VITE_PORT}`;
  for (let i = 0; i < 300; i++) {
    try { const r = await fetch(base); if (r.ok) { console.log(`  vite: ${base}`); return { base, stop: () => killGroup(proc) }; } } catch { /* not yet */ }
    if (proc.exitCode != null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.error(`vite did not start:\n${log}`); proc.kill('SIGKILL'); process.exit(3);
}

const jsErrors = [];
async function newPage(browser, viewport = DESK) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => jsErrors.push(`[${step}] [pageerror] ${e.message}`));
  pg.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // A 409 from `POST /api/phase` is the A27 guard doing its job — the browser logs every non-2xx as
    // a console error, and counting that as a page fault would fail the run for a REFUSAL the walk is
    // deliberately provoking. Nothing else is excused.
    if (/Failed to load resource.*\b409\b/.test(t)) return;
    jsErrors.push(`[${step}] [console] ${t.slice(0, 300)}`);
  });
  return pg;
}
const shot = async (pg, name) => {
  await pg.evaluate(() => { window.scrollTo(0, 0); }).catch(() => {});
  await pg.waitForTimeout(300);
  const f = path.join(SHOTS, `${name}.png`);
  await pg.screenshot({ path: f, fullPage: false });
  console.log(`      shot ${f}`);
  return f;
};
const boot = async (pg, url) => {
  await pg.goto(url, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('text=CONNECTING TO MISSION CONTROL').count().then(n => n === 0), 20000, 'the first snapshot');
};

/** Drive the `?mock` demo into a LIVE match. The in-browser backend has no server to poke from
 *  outside, and its shortest runway on screen is 60 s — far too long for a walk — so this uses the
 *  demo-only `window.__MC_MOCK__` handle (attached by `store.tsx` in mock mode and nowhere else) and
 *  a 1 s runway. Everything AFTER this point is the real UI rendering real snapshots. */
async function mockGoLive(pg) {
  await until(() => pg.evaluate(() => !!window.__MC_MOCK__), 15000, 'the mock backend handle');
  await pg.evaluate(async () => {
    const a = window.__MC_MOCK__;
    const s = await a.getState();
    for (const p of s.players) if (!p.ready) await a.setReady(p.player_id, true);
    await a.setPhase('lobby');
    await a.pushLobby(true);
    await a.start(1, true);
  });
  await until(() => pg.locator('[data-cell="stk"]').count().then(n => n > 0), 20000, 'the match to go live');
  // let a few kills land so the board has something to be legible ABOUT
  await pg.waitForTimeout(3500);
}

/** Every row on the LIVE board, read off the SCREEN. */
const boardRows = pg => pg.evaluate(() => [...document.querySelectorAll('[data-cell="k"]')].map(k => {
  const row = k.parentElement;
  const acc = row.querySelector('[data-cell="acc"]');
  return {
    k: Number(k.textContent.trim()),
    stk: (row.querySelector('[data-cell="stk"]').textContent || '').trim(),
    acc: (acc.textContent || '').trim(),
    prov: acc.dataset.provisional,
  };
}));

/** Drive the demo match until somebody has actually SCORED.
 *
 *  The walk used to assert STK and the ACC settling mark seconds after the horn, when every row on
 *  the board reads 0 and every ACC reads "—": "STK renders numbers" passed on a column of zeros and
 *  "a provisional ACC NUMBER carries the mark" passed over an empty set. Both would have passed with
 *  the columns wired to the wrong fields, which is the bug they exist to catch (review 2026-09-12).
 *
 *  The mock kills on a 12%-per-second coin flip, so waiting alone is slow and flaky; `simKill` is
 *  driven directly when it is reachable, and the walk falls back to waiting when it is not. Either
 *  way it HARD-FAILS if no row ever scores. */
async function mockUntilScored(pg, ms = 60000) {
  const forced = await pg.evaluate(() => {
    const a = window.__MC_MOCK__;
    if (!a || typeof a.simKill !== 'function') return false;
    a.simKill(); if (typeof a.emit === 'function') a.emit();
    return true;
  }).catch(() => false);
  const got = await until(async () => (await boardRows(pg)).some(r => r.k > 0 && /\d/.test(r.acc)),
    forced ? 8000 : ms, 'a row with kills on the board (the zeros board makes the checks below vacuous)');
  return { forced, got };
}

const post = (mcBase, path, body = {}) => fetch(`${mcBase}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const stateOf = async mcBase => (await (await fetch(`${mcBase}/api/state`)).json());

/** Put the real MC back in `kit`. `--demo --fake-net` readies every fake phone, so the server boots
 *  straight into LOBBY and a walk that starts at KIT finds the gate already spent. Test SETUP, done
 *  over REST on purpose — the UI walk that follows is the thing being tested. */
async function realToKit(mcBase) {
  const s = await stateOf(mcBase);
  if (s.phase === 'armed' || s.phase === 'live') await post(mcBase, '/api/start/abort');
  if (s.phase === 'recap') await post(mcBase, '/api/session/new', { keep_roster: true });
  await post(mcBase, '/api/phase', { phase: 'kit' });
  return (await stateOf(mcBase)).phase;
}

/** Drive the REAL MC into a live match, over REST, so the stale run has a live board to strip. */
async function realGoLive(mcBase) {
  const s0 = await stateOf(mcBase);
  if (s0.phase === 'live') return true;
  if (s0.phase === 'armed') await post(mcBase, '/api/start/abort');
  if (s0.phase === 'recap') await post(mcBase, '/api/session/new', { keep_roster: true });
  await post(mcBase, '/api/phase', { phase: 'lobby' });
  await post(mcBase, '/api/lobby/push', { force: true });
  let r = await post(mcBase, '/api/start', { runway_s: 1, force: true });
  if (!r.ok) r = await post(mcBase, '/api/start', { runway_s: 5, force: true });
  if (!r.ok) { console.log(`      POST /api/start refused: ${r.status} ${(await r.text()).slice(0, 160)}`); return false; }
  for (let i = 0; i < 250; i++) {
    if ((await stateOf(mcBase)).phase === 'live') return true;
    await new Promise(res => setTimeout(res, 200));
  }
  return false;
}

/** Tiny-text + tap-target sweep over a region. Decorative runs (the nav's 0N digits) are excluded by
 *  the caller's selector, never by "it printed a finding and nobody read it". */
async function audit(pg, sel, where, { minText = 11, minTap = 36 } = {}) {
  const rows = await pg.locator(sel).evaluate(el => Array.from(el.querySelectorAll('*'))
    .filter(n => (n.textContent || '').trim() && n.children.length === 0)
    .map(n => ({ tag: n.tagName, t: (n.textContent || '').trim().slice(0, 30),
                 h: Math.round(n.getBoundingClientRect().height),
                 w: Math.round(n.getBoundingClientRect().width),
                 fs: parseFloat(getComputedStyle(n).fontSize) })));
  const tiny = rows.filter(r => r.fs < minText);
  const small = rows.filter(r => (r.tag === 'BUTTON' || r.tag === 'A') && r.h > 0 && r.h < minTap);
  expect(tiny.length === 0, `${where}: text under ${minText}px — ${tiny.map(r => `"${r.t}"@${r.fs}px`).join(', ')}`);
  expect(small.length === 0, `${where}: tap target under ${minTap}px — ${small.map(r => `"${r.t}"@${r.h}px`).join(', ')}`);
  return `${rows.length} leaf nodes, smallest ${Math.min(...rows.map(r => r.fs))}px`;
}

// ---------------------------------------------------------------------------- runs

/** THE measurement D4 asked for and nobody had made: does Oswald have tabular figures? */
async function runMeasure(browser, viteBase) {
  step = 'measure'; stepFailedAt = failures.length;
  console.log('\n[measure] Oswald tabular-nums vs the fixed digit cell');
  const pg = await newPage(browser);
  await boot(pg, `${viteBase}/?mock#live`);       // any page: it is the loaded WEBFONT we are measuring
  const loaded = await pg.evaluate(async () => {
    try { await document.fonts.ready; } catch { /* no font loading api */ }
    return { oswald: document.fonts.check("40px 'Oswald'"), faces: [...document.fonts].map(f => `${f.family} ${f.weight} ${f.status}`).slice(0, 8) };
  });
  console.log(`      webfont: Oswald ${loaded.oswald ? 'LOADED' : 'NOT LOADED (measuring the fallback)'} — ${loaded.faces.join(' | ') || 'no faces registered'}`);
  const r = await pg.evaluate(() => {
    const mk = (text, tab) => {
      const s = document.createElement('span');
      s.textContent = text;
      s.style.cssText = `position:absolute;left:-9999px;font:500 40px 'Oswald','Arial Narrow',Impact,sans-serif;${tab ? 'font-variant-numeric:tabular-nums;' : ''}`;
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    const pairs = ['00', '11', '88', '47'];
    const tab = pairs.map(p => +mk(p, true).toFixed(2));
    const plain = pairs.map(p => +mk(p, false).toFixed(2));
    return { pairs, tab, plain, spread: +(Math.max(...tab) - Math.min(...tab)).toFixed(2) };
  });
  console.log(`      Oswald 500 @40px, font-variant-numeric:tabular-nums — ${r.pairs.map((p, i) => `"${p}" ${r.tab[i]}px`).join(' · ')}`);
  expect(r.spread > 2, `tabular-nums does NOT equalise Oswald's digits (spread ${r.spread}px over two digits) — the premise of the fix`);
  ok(`measured: tabular-nums leaves a ${r.spread}px spread across two digits, so TAB is a lie and <Num> is needed`);

  // and the fix, on the REAL board: within one font size every digit cell is the same width, whatever
  // digit is in it. Grouped BY font size — the page renders digits at 17 px in the table and 64 px in
  // the score, so one flat spread across all of them measures nothing (suite bug, caught 2026-09-12).
  await mockGoLive(pg);
  const groups = await pg.locator('[data-digit]').evaluateAll(els => {
    const by = {};
    for (const e of els) {
      const fs = getComputedStyle(e).fontSize;
      (by[fs] ||= []).push({ d: e.textContent, w: +e.getBoundingClientRect().width.toFixed(2) });
    }
    return Object.entries(by).map(([fs, cells]) => ({
      fs, n: cells.length, digits: [...new Set(cells.map(c => c.d))].sort().join(''),
      spread: +(Math.max(...cells.map(c => c.w)) - Math.min(...cells.map(c => c.w))).toFixed(2),
    }));
  });
  expect(groups.length > 0, 'there are <Num> digit cells on the live board to measure');
  for (const g of groups) {
    expect(g.spread < 0.5, `at ${g.fs} every digit cell is the same width (spread ${g.spread}px across ${g.n} cells, digits "${g.digits}")`);
  }
  ok(`digit cells: ${groups.map(g => `${g.n}@${g.fs} spread ${g.spread}px`).join(' · ')}`);
  await pg.context().close();
}

async function runMock(browser, viteBase, vp, tag) {
  step = `mock/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] the in-browser demo backend, ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, vp);
  await boot(pg, `${viteBase}/?mock#live`);
  await mockGoLive(pg);
  await until(() => pg.locator('[data-col-head]').count().then(n => n >= 9), 15000, 'the live board');

  // S24 (a) headers
  const heads = await pg.locator('[data-col-head]').evaluateAll(els =>
    els.map(e => ({ t: e.textContent, fs: parseFloat(getComputedStyle(e).fontSize), g: e.dataset.group })));
  expect(heads.every(h => h.fs >= 11), `every header ≥11px (saw ${heads.map(h => `${h.t}@${h.fs}`).join(' ')})`);
  expect(new Set(heads.map(h => h.g)).size >= 4, `the columns are grouped (${[...new Set(heads.map(h => h.g))].join('/')})`);
  ok(`headers: ${heads.map(h => `${h.t}@${h.fs}px/${h.g}`).join('  ')}`);

  // S24 (b) the group rules are actually drawn
  const ruled = await pg.locator('[data-col-head]').evaluateAll(els =>
    els.filter(e => parseFloat(getComputedStyle(e).borderLeftWidth) > 0).map(e => e.textContent));
  expect(ruled.length >= 3, `a rule opens each numeric group (saw before ${ruled.join(', ')})`);
  ok(`group rules before ${ruled.join(', ')}`);

  // S24 (c) STK is the BEST streak — asserted on rows that have SCORED, never on a board of zeros
  const drive = await mockUntilScored(pg);
  const rows = await boardRows(pg);
  const scored = rows.filter(r => r.k > 0);
  expect(drive.got && scored.length > 0, `somebody has scored, so there is something to check (${rows.map(r => r.k).join(',')})`);
  expect(scored.length > 0 && scored.every(r => /^\d+$/.test(r.stk) && Number(r.stk) >= 1),
    `every row with a kill shows a streak of at least 1 (${scored.map(r => `${r.k}K/stk ${r.stk}`).join(' · ') || 'no scoring row'})`);
  ok(`STK on ${scored.length} scoring row(s): ${scored.map(r => `${r.k}K→${r.stk}`).join(', ')}${drive.forced ? ' (kills driven)' : ''}`);

  // S24 (d) ACC settling — and at least one row must actually BE settling, or the mark is unasserted
  expect(rows.every(r => r.prov === '0' || r.prov === '1'), 'every ACC cell declares whether it has settled');
  const numericProv = rows.filter(r => r.prov === '1' && /\d/.test(r.acc));
  expect(numericProv.length > 0, `at least one ACC number is still settling, so the mark is on screen (${rows.map(r => `${r.acc}/${r.prov}`).join(' ')})`);
  expect(numericProv.every(r => /^~\d/.test(r.acc)), `a provisional ACC NUMBER leads with the settling mark (${numericProv.map(r => r.acc).join(',') || 'none on screen'})`);
  expect(rows.filter(r => r.prov === '0' && /\d/.test(r.acc)).every(r => !r.acc.includes('~')), 'a settled ACC carries no mark');
  ok(`ACC cells: ${rows.map(r => `${r.acc}${r.prov === '1' ? '(settling)' : ''}`).join(', ')}   ${await shot(pg, `01-${tag}-live-board`)}`);

  await audit(pg, 'main', `${tag} LIVE`);
  // the page itself must never scroll sideways; only the table's own container may (skill §3.6)
  const scroll = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(scroll.doc <= scroll.win + 1, `the page does not scroll sideways at ${vp.width} (${scroll.doc}px of content)`);
  const tbl = await pg.locator('[data-col-head]').first().evaluate(el => {
    const box = el.closest('[style*="overflow"]') || el.parentElement;
    return { sw: box.scrollWidth, cw: box.clientWidth, scrollable: box.scrollWidth > box.clientWidth };
  });
  expect(vp.width >= 1280 ? !tbl.scrollable : tbl.scrollable || tbl.sw <= tbl.cw,
    `the board fits at ${vp.width} or scrolls in its own container (${tbl.sw}/${tbl.cw})`);
  ok(`layout at ${vp.width}: page ${scroll.doc}px, table ${tbl.sw}px in ${tbl.cw}px`);

  // F129: a board that is CUT has to say so. 783px of columns in a 345px box ended at K/D with no
  // edge, no scrollbar and nothing on screen suggesting there was more (393px walk, 2026-09-12).
  // Asserted in BOTH directions — the hint must be gone on a desk, or it is just furniture.
  const hintOf = sel => pg.evaluate(root => {
    const h = document.querySelector(`${root} [data-scroll-hint]`);
    if (!h) return null;
    const box = h.nextElementSibling;
    const r = h.getBoundingClientRect();
    return { flag: h.dataset.scrollHint, shown: r.width > 0 && r.height > 0, text: (h.textContent || '').trim(),
             fs: parseFloat(getComputedStyle(h).fontSize), mask: getComputedStyle(box).maskImage || getComputedStyle(box).webkitMaskImage,
             sw: box.scrollWidth, cw: box.clientWidth };
  }, sel);
  // and nothing on this screen may hang off the LEFT either: the coverage tag is right-aligned and
  // was `nowrap`, so a full line read "…GE ZONES — 0 OF 7 ON BACKHAUL" on a 393px phone
  const cov = await pg.evaluate(() => {
    const el = document.querySelector('[data-coverage]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { t: (el.textContent || '').trim(), left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth };
  });
  if (cov) {
    expect(cov.left >= 0 && cov.right <= cov.vw + 1,
      `the coverage tag fits the screen at ${vp.width} ("${cov.t}" spans ${cov.left}–${cov.right} of ${cov.vw})`);
    ok(`coverage tag: "${cov.t}" ${cov.left}–${cov.right}px of ${cov.vw}px`);
  }

  const liveHint = await hintOf('main');
  expect(liveHint != null, 'the LIVE board carries a scroll hint element at all');
  if (liveHint) {
    const cut = liveHint.sw > liveHint.cw + 2;
    expect(cut === (liveHint.flag === '1' && liveHint.shown),
      `the hint is on screen exactly while the table is cut (cut ${cut}, hint ${liveHint.flag}/${liveHint.shown}, ${liveHint.sw}px in ${liveHint.cw}px)`);
    if (cut) {
      expect(/SCROLL/.test(liveHint.text.toUpperCase()), `and says which way to go (${JSON.stringify(liveHint.text)})`);
      expect((liveHint.mask || 'none') !== 'none', 'the cut edge fades, so the table does not just stop mid-column');
    }
    ok(`scroll affordance at ${vp.width}: table ${liveHint.sw}px in ${liveHint.cw}px → hint ${liveHint.shown ? `"${liveHint.text}"` : 'hidden (it fits)'}`);
  }

  // RECAP: the same columns, plus A6.1's "after the whistle" block. END the demo match through the
  // control the operator actually presses, not by poking the backend.
  await pg.evaluate(async () => { await window.__MC_MOCK__.control('end'); });
  await until(() => pg.locator('text=MATCH COMPLETE').count().then(n => n > 0), 15000, 'the RECAP screen');
  const rStk = await pg.locator('[data-cell="stk"]').evaluateAll(els => els.map(e => e.textContent.trim()));
  expect(rStk.length > 0 && rStk.every(v => /^\d+$/.test(v)), `RECAP's STK column renders (${rStk.join(',')})`);
  const after = await pg.locator('[data-testid="after-end"]').count();
  expect(after === 1, 'the after-the-whistle block is on the recap (the demo records two late facts)');
  const afterTxt = after ? (await pg.locator('[data-testid="after-end"]').innerText()).replace(/\s+/g, ' ') : '';
  expect(/RECORDED, NOT COUNTED/i.test(afterTxt), `it says the facts do not count (saw ${JSON.stringify(afterTxt.slice(0, 120))})`);
  await audit(pg, 'main', `${tag} RECAP`);
  ok(`RECAP: STK ${rStk.join(',')} · "${afterTxt.slice(0, 90)}"   ${await shot(pg, `04-${tag}-recap`)}`);

  // Back to a live match for the spectator walk — with a FULL roster. Eight rows already ran off the
  // bottom of a 1280x800 projector, and the demo session is eight players, so a walk that never grows
  // the roster can never see it (review 2026-09-12).
  await pg.evaluate(async () => {
    const a = window.__MC_MOCK__;
    await a.newSession(true);
    let s = await a.getState();
    const teams = (s.config.teams || []).map(t => t.team_id);
    for (let i = s.players.length; i < 12; i++) {
      await a.addPlayer({ display: `EXTRA ${i - 7}`, team_id: teams[i % Math.max(teams.length, 1)] });
    }
    s = await a.getState();
    for (const p of s.players) if (!p.ready) await a.setReady(p.player_id, true);
    await a.setPhase('lobby'); await a.pushLobby(true); await a.start(1, true);
  });
  await until(() => pg.locator('[data-cell="stk"]').count().then(n => n > 0), 25000, 'a second live match');
  await pg.evaluate(() => { location.hash = '#live'; });

  // the SPECTATE link opens the board, and the board has no controls
  const href = await pg.locator('[data-spectate-link]').getAttribute('href');
  expect((href || '').includes('#spectate'), `the SPECTATE link points at the board (${href})`);
  // a hash hop, NOT a goto: reloading `?mock` restarts the in-page demo backend and throws away the
  // live match this walk just drove it into, which is how the spectator score measured 0px (2026-09-12)
  await pg.evaluate(() => { location.hash = '#spectate'; });
  await until(() => pg.locator('[data-spectate="board"]').count().then(n => n > 0), 15000, 'the spectator board');
  const controls = await pg.locator('button, a[href], input, [role="button"]').count();
  expect(controls === 0, `the spectator board holds NO control (found ${controls})`);
  const header = await pg.locator('header').count();
  expect(header === 0, 'the command bar (PANIC, the phase nav) is NOT on the spectator board');
  const scoreFs = await pg.locator('[data-spectate="score"]').first().evaluate(e => parseFloat(getComputedStyle(e).fontSize)).catch(() => 0);
  expect(scoreFs >= 56, `the score is ${scoreFs}px — readable across a room`);
  await audit(pg, '[data-spectate="board"]', `${tag} SPECTATE`, { minText: 16 });
  // THE FIT RULE. A projector cannot be scrolled: a row below the fold is a row nobody in the room
  // will ever see. So with a full roster on a 1280x800 screen, nothing may overflow and nothing may
  // scroll — measured, because this is a LAYOUT claim and jsdom lays nothing out (review 2026-09-12).
  const fitm = await pg.evaluate(() => {
    const frame = document.querySelector('[data-spectate="board"]');
    const rowsBox = document.querySelector('[data-spectate="rows"]');
    const rows = [...document.querySelectorAll('[data-spectate="row"]')];
    const last = rows[rows.length - 1]?.getBoundingClientRect();
    return {
      n: rows.length, vh: window.innerHeight,
      frameSH: frame?.scrollHeight ?? 0, frameCH: frame?.clientHeight ?? 0,
      rowsSH: rowsBox?.scrollHeight ?? 0, rowsCH: rowsBox?.clientHeight ?? 0,
      lastBottom: last ? Math.round(last.bottom) : null,
      rowFs: rows[0] ? parseFloat(getComputedStyle(rows[0].firstElementChild).fontSize) : 0,
      docSH: document.documentElement.scrollHeight,
    };
  });
  if (vp.height <= 900 && vp.width >= 1280) {
    expect(fitm.n >= 12, `the projector walk has a full roster to fit (${fitm.n} rows)`);
    expect(fitm.rowsSH <= fitm.rowsCH + 1, `the rows fit the space they are given (${fitm.rowsSH}px of rows in ${fitm.rowsCH}px)`);
    expect(fitm.lastBottom != null && fitm.lastBottom <= fitm.vh,
      `the LAST row ends above the bottom of the screen (${fitm.lastBottom}px of ${fitm.vh}px)`);
    expect(fitm.frameSH <= fitm.frameCH + 1, `nothing overflows the board at all (${fitm.frameSH}px in ${fitm.frameCH}px)`);
    expect(fitm.rowFs >= 16, `and the rows are still readable across a room (${fitm.rowFs}px)`);
    ok(`fit: ${fitm.n} rows at ${fitm.rowFs}px, last row ends at ${fitm.lastBottom}px of ${fitm.vh}px`);
  } else {
    ok(`fit: ${fitm.n} rows at ${fitm.rowFs}px — ${vp.width}x${vp.height} is a phone, so the page is allowed to scroll (${fitm.docSH}px)`);
  }
  const specHint = await hintOf('[data-spectate="board"]');
  expect(specHint != null, 'the spectator board carries a scroll hint element');
  if (specHint) {
    const cut = specHint.sw > specHint.cw + 2;
    expect(cut === (specHint.flag === '1' && specHint.shown),
      `the spectator hint is on screen exactly while the board is cut (cut ${cut}, hint ${specHint.flag}/${specHint.shown}, ${specHint.sw}px in ${specHint.cw}px)`);
    // this board is read across a room: even the hint obeys the 16px floor
    if (cut) expect(specHint.fs >= 16, `and is legible at ${specHint.fs}px`);
    ok(`spectator scroll affordance at ${vp.width}: ${specHint.sw}px in ${specHint.cw}px → ${specHint.shown ? `"${specHint.text}" at ${specHint.fs}px` : 'hidden (it fits)'}`);
  }
  const sideways = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  expect(sideways.doc <= sideways.win + 1, `the spectator board does not scroll the PAGE sideways at ${vp.width} (${sideways.doc}px)`);
  ok(`spectator board: no controls, no command bar, score ${scoreFs}px   ${await shot(pg, `02-${tag}-spectate`)}`);

  // the board does NOT follow the host's phase away from the projector
  await pg.evaluate(() => { location.hash = '#spectate'; });
  await pg.waitForTimeout(1500);
  expect(await pg.locator('[data-spectate="board"]').count() > 0, 'the board stayed put through a snapshot');

  // The OTHER branch of the board: after the whistle the projector shows the final card and the same
  // table, and it has to fit for the same reason. Ended through the control, not by poking the rows.
  await pg.evaluate(async () => { await window.__MC_MOCK__.control('end'); });
  // Wait for the thing that CHANGES. "12 rows on the board" is already true of the live board, so
  // waiting on it measured the live board and called it the final card (caught in this run's own
  // screenshot, 2026-09-12): the result card is the only proof the whistle has blown.
  await until(() => pg.locator('[data-spectate="final"]').count().then(n => n > 0), 20000, 'the final result card');
  expect(await pg.locator('[data-spectate="row"]').count() >= 12, 'the result keeps the whole roster');
  const finalFit = await pg.evaluate(() => {
    const frame = document.querySelector('[data-spectate="board"]');
    const rows = [...document.querySelectorAll('[data-spectate="row"]')];
    const last = rows[rows.length - 1]?.getBoundingClientRect();
    return { n: rows.length, vh: window.innerHeight, sh: frame?.scrollHeight ?? 0, ch: frame?.clientHeight ?? 0,
             lastBottom: last ? Math.round(last.bottom) : null,
             headline: (document.querySelector('[data-spectate="final"]')?.textContent || '').replace(/\s+/g, ' ').slice(0, 60) };
  });
  if (vp.height <= 900 && vp.width >= 1280) {
    expect(finalFit.sh <= finalFit.ch + 1, `the final board fits the screen too (${finalFit.sh}px in ${finalFit.ch}px, ${finalFit.n} rows)`);
    expect(finalFit.lastBottom != null && finalFit.lastBottom <= finalFit.vh,
      `the last row of the RESULT is on screen (${finalFit.lastBottom}px of ${finalFit.vh}px)`);
  }
  ok(`final card "${finalFit.headline}": ${finalFit.n} rows, last ends at ${finalFit.lastBottom}px of ${finalFit.vh}px   ${await shot(pg, `06-${tag}-spectate-final`)}`);

  // ARMORY: the A29 chips
  await pg.evaluate(() => { location.hash = '#muster'; });
  await until(() => pg.locator('[data-app-ver-summary]').count().then(n => n > 0), 15000, 'the muster version summary');
  const sum = (await pg.locator('[data-app-ver-summary]').innerText()).replace(/\s+/g, ' ');
  expect(/PHONES · \d+ × \d/.test(sum), `the muster header tallies the field (saw ${JSON.stringify(sum)})`);
  const chips = await pg.locator('[data-app-ver]').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  expect(chips.length > 0 && chips.every(c => c.length > 0), `every phone card carries a build (${chips.length} chips)`);
  ok(`A29: "${sum}" · chips ${chips.slice(0, 3).join(' | ')}   ${await shot(pg, `03-${tag}-armory-versions`)}`);

  // A32 copy (F129): both proofs mean the headset is ON, and they have to READ that way —
  // `PROVEN BY LINK` beside a bare `CONNECTED` read as two different states.
  const headsets = await pg.locator('[data-headset]').evaluateAll(els =>
    els.map(e => `${e.dataset.headset}=${e.textContent.replace(/\s+/g, ' ').trim()}`));
  expect(headsets.length > 0, 'the readiness cards carry a headset row');
  expect(headsets.filter(h => h.startsWith('link=')).every(h => h === 'link=CONNECTED (LINK)'),
    `a link-proven headset reads CONNECTED (LINK) (${[...new Set(headsets)].join(' | ')})`);
  expect(headsets.filter(h => h.startsWith('echo=')).every(h => h === 'echo=CONNECTED (ECHO)'),
    `an echo-proven headset reads CONNECTED (ECHO) (${[...new Set(headsets)].join(' | ')})`);
  expect(!headsets.some(h => /PROVEN BY LINK/.test(h)), 'the old non-parallel copy is gone');
  ok(`A32 headset copy: ${[...new Set(headsets)].join(' | ')}`);

  // A25: the LOG SYNC switch and the per-node LOGS button
  const modeNow = () => pg.locator('[data-logsync]').getAttribute('data-logsync');
  expect(await pg.locator('[data-logsync]').count() === 1, 'the LOG SYNC switch is on the muster header');
  const before = await modeNow();
  await pg.locator('[data-logsync] button', { hasText: before === 'auto' ? 'MANUAL' : 'AUTO' }).click();
  await until(async () => (await modeNow()) !== before, 8000, 'the LOG SYNC switch to move');
  ok(`A25: LOG SYNC ${before} → ${await modeNow()} (the switch writes and the snapshot comes back)`);
  // F129: what AUTO does, and that LOGS ignores the switch, lived only in a `title` — unhoverable on
  // a touch console. It is a visible legend now, and it follows the switch.
  const legend = await pg.locator('[data-logsync-legend]').evaluate(el =>
    ({ t: (el.textContent || '').replace(/\s+/g, ' ').trim(), fs: parseFloat(getComputedStyle(el).fontSize) }));
  expect(/NEVER GATED/.test(legend.t.toUpperCase()), `the legend says the LOGS button is never gated (saw ${JSON.stringify(legend.t)})`);
  expect(new RegExp(`^${await modeNow()}`, 'i').test(legend.t), `and it describes the mode the switch is in (${legend.t.slice(0, 24)}…)`);
  expect(legend.fs >= 11, `at ${legend.fs}px`);
  ok(`A25 legend: "${legend.t}"`);
  const states = await pg.locator('[data-node-card] [data-log-state]').evaluateAll(els =>
    els.map(e => `${e.dataset.logState}:${e.textContent.replace(/\s+/g, ' ').trim()}`));
  expect(states.length > 0, 'every node card carries a log row');
  expect(new Set(states.map(x => x.split(':')[0])).size > 1,
    `the demo field shows MORE THAN ONE log state, so the states can be told apart (${states.join(' | ')})`);
  ok(`A25 log states: ${states.slice(0, 4).join('  ')}`);
  // the button must visibly answer — the notice lives in the command bar, not on this screen
  const pull = pg.locator('[data-pull-log]').first();
  expect(await pull.evaluate(el => Math.round(el.getBoundingClientRect().height)) >= 36, 'the LOGS button is a real tap target');
  await pull.click();
  await until(() => pg.locator('header', { hasText: 'ASKED FOR THE LOG' }).count().then(n => n > 0), 8000,
    'the LOGS tap to be answered on screen');
  ok(`A25: LOGS asked and said so   ${await shot(pg, `05-${tag}-logsync`)}`);
  await audit(pg, 'main', `${tag} ARMORY`);

  // F129, and only on a phone: the LOGS tap above left a toast in the command bar, and the match is
  // over, so NEW MATCH is beside it. They used to share one nowrap row and the toast took the width:
  // "NEW MATCH ▸" wrapped onto three lines, a 72px button (measured 2026-09-12). The toast has its
  // own row under the bar now. Measured with a toast ON SCREEN — that is the whole condition.
  if (vp.width < 500) {
    const cb = await pg.evaluate(() => {
      const group = document.querySelector('header .cb-notices');
      const toast = group && (group.textContent || '').trim() ? group : null;   // the group is always there; a TOAST is not
      const btn = [...document.querySelectorAll('header button')].find(b => /NEW MATCH/.test(b.textContent || ''));
      if (!toast || !btn) return { toast: !!toast, btn: !!btn };
      const t = toast.getBoundingClientRect(), b = btn.getBoundingClientRect();
      return { toast: true, btn: true, h: Math.round(b.height), w: Math.round(b.width),
               ownRow: Math.round(t.bottom) <= Math.round(b.top) + 2 || Math.round(b.bottom) <= Math.round(t.top) + 2,
               text: (toast.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
    });
    expect(cb.toast && cb.btn, `the walk has both a toast and NEW MATCH on screen (toast ${cb.toast}, button ${cb.btn})`);
    if (cb.toast && cb.btn) {
      expect(cb.h <= 56, `NEW MATCH stays one line beside a toast (${cb.h}px tall, ${cb.w}px wide)`);
      expect(cb.ownRow, 'and the toast is on a row of its own, not squeezing it');
      ok(`F129 toast row: NEW MATCH ${cb.h}px with "${cb.text}…" above it   ${await shot(pg, `07-${tag}-toast-row`)}`);
    }

    // the KIT roster becomes a horizontal strip on a phone, and its status tag used to be pushed
    // past the row and off the screen (x=407 on a 393px viewport)
    await pg.evaluate(() => { location.hash = '#kit'; });
    await until(() => pg.locator('.kit-row').count().then(n => n > 0), 15000, 'the KIT roster strip');
    const tags = await pg.locator('.kit-row').evaluateAll(rows => rows.map(r => {
      const tag = r.lastElementChild;
      const tb = tag.getBoundingClientRect(), rb = r.getBoundingClientRect();
      return { t: (tag.textContent || '').trim(), right: Math.round(tb.right), rowRight: Math.round(rb.right), vw: window.innerWidth };
    }));
    expect(tags.length > 0, 'the roster rendered rows to measure');
    const spill = tags.filter(x => x.right > x.rowRight + 1);
    expect(spill.length === 0, `no status tag hangs out of its row (${spill.map(x => `"${x.t}" ${x.right}>${x.rowRight}`).join(', ')})`);
    const first = tags[0];
    expect(first.right <= first.vw, `the FIRST row's "${first.t}" is on the screen (ends at ${first.right}px of ${first.vw}px)`);
    ok(`F129 roster tags: first "${first.t}" ends at ${first.right}px of ${first.vw}px   ${await shot(pg, `08-${tag}-kit-roster`)}`);
  }
  await pg.context().close();
}

async function runReal(browser, viteBase, mcBase, vp, tag) {
  step = `real/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] a real python MC on :${MC_PORT}, ${vp.width}x${vp.height}`);
  const pg = await newPage(browser, vp);
  await boot(pg, `${viteBase}/#muster`);

  // A29 against the real server: the fake nodes report `app_ver: "fake"` today and the field may say
  // UNKNOWN once the server lane lands — either way the console must RENDER something, never crash
  // and never leave the row out.
  await until(() => pg.locator('[data-app-ver]').count().then(n => n > 0), 20000, 'a version chip against the real server');
  const chip = (await pg.locator('[data-app-ver]').first().innerText()).replace(/\s+/g, ' ').trim();
  expect(chip.length > 0, `the card names a build or says UNKNOWN (saw ${JSON.stringify(chip)})`);
  expect(await pg.locator('text=CONSOLE ERROR').count() === 0, 'no crash boundary on ARMORY');
  ok(`real server: first chip "${chip}"   ${await shot(pg, `10-${tag}-real-armory`)}`);

  // A27: walk to KIT and make the SERVER refuse. `--demo --fake-net` readies every fake node, so a
  // ninth operator with no phone is the real "someone is still kitting" case.
  const phaseNow = async () => (await stateOf(mcBase)).phase;
  expect(await realToKit(mcBase) === 'kit', 'the server was put back in kit for this walk');
  await pg.evaluate(() => { location.hash = '#kit'; });
  await until(() => pg.locator('[data-continue="kit"]').count().then(n => n > 0), 15000, 'KIT');
  await until(async () => (await phaseNow()) === 'kit', 8000, 'the console to see phase kit');
  const nameBox = pg.locator('main input[aria-label="new operator callsign"]');
  await nameBox.fill('ROCCO');
  await nameBox.press('Enter');
  await until(async () => (await pg.locator('[data-continue="kit"]').innerText()).includes('/9'), 10000, 'the roster to reach 9');

  const gateBtn = pg.locator('[data-continue="kit"] button').last();
  await gateBtn.click();                     // first tap: the console's own gate arms, nothing sent
  await pg.waitForTimeout(400);
  expect(await phaseNow() === 'kit', `the first tap moved no phase (server is ${await phaseNow()})`);
  ok(`first tap armed the local confirm   ${await shot(pg, `11-${tag}-kit-armed`)}`);
  // Asserted BEFORE the second tap (KIT is still mounted): the console's own warning is the only one shown —
  // no server refusal line — so the second tap is the FORCE, not a third tap. (Round-2 review: the old
  // placement ran after the phase reached lobby, where KIT had unmounted and the count was 0 on any code.)
  expect(await pg.locator('[data-continue-refusal]').count() === 0,
    'the console did not also have to be refused — one warning, two taps');
  expect(await pg.locator('[data-continue="kit"]').count() > 0, 'KIT is still mounted before the second tap (so the count above meant something)');

  // second tap: the operator has answered the console's own question, so it carries `force` and the
  // server's guard is satisfied by the same decision. TWO taps, not three (the regression `e2e:kit`
  // caught on 2026-09-12).
  await gateBtn.click();
  await until(async () => (await phaseNow()) === 'lobby', 8000, 'the second tap to reach lobby');
  // The console follows the phase, so by the time this is shot KIT is gone and the LOBBY is on
  // screen — `12-desk-kit-advanced.png` was byte-identical to `13-desk-lobby.png` and the only
  // evidence of the kit gate was the shot before it (round-2 review 2026-09-12). Named for what it
  // shows, and asserted so the name cannot drift from the screen again.
  await until(() => pg.locator('[data-continue="kit"]').count().then(n => n === 0), 8000, 'KIT to give way');
  expect(await pg.locator('main', { hasText: 'Team Assignment' }).count() > 0,
    'the console followed the advance and is showing the LOBBY');
  ok(`A27: two taps, server now in lobby   ${await shot(pg, `12-${tag}-advanced-to-lobby`)}`);
  await pg.context().close();
}

/** A27 proper: the case the SERVER guard exists for — the console's roster looks green and the server
 *  knows better. Faked by patching the snapshot the BROWSER sees (every player `ready`) while the
 *  server still holds ROCCO unready, which is exactly the skew the guard is there to catch. */
async function runRefusal(browser, viteBase, mcBase, vp, tag) {
  step = `refusal/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] the console thinks everyone is ready; the server does not, ${vp.width}x${vp.height}`);
  const phaseNow = async () => (await stateOf(mcBase)).phase;
  expect(await realToKit(mcBase) === 'kit', 'the server is in kit');
  const roster = (await stateOf(mcBase)).players;
  if (!roster.some(p => !p.ready)) {
    // the earlier walk left ROCCO on the roster; if it did not, make one
    await post(mcBase, '/api/players', { display: 'ROCCO', team_id: 'blue' });
  }
  const notReady = (await stateOf(mcBase)).players.filter(p => !p.ready).map(p => p.display);
  expect(notReady.length > 0, `the server holds someone unready (${notReady.join(',') || 'nobody'})`);

  const pg = await newPage(browser, vp);
  await stripSnapshots(pg, s => ({ ...s, players: (s.players || []).map(p => ({ ...p, ready: true })) }));
  await boot(pg, `${viteBase}/#kit`);
  await until(() => pg.locator('[data-continue="kit"]').count().then(n => n > 0), 15000, 'KIT');
  const gate = pg.locator('[data-continue="kit"]');
  expect((await gate.innerText()).includes('READY'), 'the console reads its (patched) roster as ready');
  expect(!(await gate.innerText()).includes('CONTINUE ANYWAY'), 'the console itself is NOT gating');

  await gate.locator('button').last().click();
  await until(() => pg.locator('[data-continue-refusal]').count().then(n => n > 0), 8000, "the server's refusal");
  const txt = (await pg.locator('[data-continue-refusal]').innerText()).replace(/\s+/g, ' ');
  expect(notReady.some(n => txt.toUpperCase().includes(n.toUpperCase())),
    `the refusal names who the SERVER says is not ready (want ${notReady.join(',')}, saw ${JSON.stringify(txt)})`);
  expect(/CONTINUE ANYWAY\?/.test(txt), 'it says what the next tap does');
  expect(await phaseNow() === 'kit', 'a refused CONTINUE moved no phase');
  expect(await pg.locator('[data-continue-warn]').count() === 0, 'only ONE warning is on screen');
  ok(`A27: refused and named them — "${txt}"   ${await shot(pg, `14-${tag}-kit-refused`)}`);

  await gate.locator('button').last().click();
  await until(async () => (await phaseNow()) === 'lobby', 8000, 'the forced tap to reach lobby');
  ok('A27: the next tap forced it through');
  await pg.unrouteAll({ behavior: 'ignoreErrors' });
  await pg.context().close();
}

async function runRealTail(browser, viteBase, mcBase, vp, tag) {
  step = `real/${tag}`; stepFailedAt = failures.length;
  const pg = await newPage(browser, vp);
  await boot(pg, `${viteBase}/#lobby`);

  // A31 on LOBBY: the notice renders only when the server sends it. Assert the ABSENT case honestly.
  const st = await stateOf(mcBase);
  await until(() => pg.locator('main').count().then(n => n > 0), 8000, 'LOBBY');
  await pg.waitForTimeout(600);
  const shown = await pg.locator('[data-testid="mc-verify"]').count();
  if (st.notices?.mc_verify) expect(shown === 1, 'the server sent notices.mc_verify and LOBBY renders it');
  else expect(shown === 0, 'this server sends no notices.mc_verify, so LOBBY shows no host line (correct)');
  ok(`A31: server ${st.notices?.mc_verify ? 'sends' : 'does NOT send'} notices.mc_verify; LOBBY shows ${shown}   ${await shot(pg, `13-${tag}-lobby`)}`);
  await pg.context().close();
}

/** strip fields from every snapshot, over REST *and* the WebSocket */
async function stripSnapshots(pg, fn) {
  await pg.route('**/api/state', async route => {
    const res = await route.fetch();
    let body; try { body = await res.json(); } catch { return route.fulfill({ response: res }); }
    await route.fulfill({ response: res, body: JSON.stringify(fn(body)), headers: { ...res.headers(), 'content-type': 'application/json' } });
  });
  await pg.routeWebSocket(/\/ui-ws/, ws => {
    const server = ws.connectToServer();
    ws.onMessage(m => server.send(m));
    server.onMessage(m => {
      try {
        const msg = JSON.parse(String(m));
        if (msg.kind === 'snapshot' && msg.state) { msg.state = fn(msg.state); ws.send(JSON.stringify(msg)); return; }
        ws.send(m);
      } catch { ws.send(m); }
    });
  });
}

/** Every field this milestone added, stripped — an MC that predates the server lane. */
const stale = s => ({
  ...s,
  notices: undefined,
  options: undefined,           // A25: no option table — the LOG SYNC switch must not render at all
  versions: undefined,          // A29: the server's own tally — an older MC has none and the console counts nodes
  readiness: s.readiness ? { ...s.readiness, app_vers: undefined, board: (s.readiness.board || []).map(b => { const { app_ver, platform, ...r } = b; void app_ver; void platform; return r; }) } : s.readiness,
  nodes: (s.nodes || []).map(n => { const { app_ver, platform, log, ...r } = n; void app_ver; void platform; void log; return r; }),
  live: s.live ? { ...s.live, rows: (s.live.rows || []).map(r => { const { best_streak, multi_best, first_blood, acc_provisional, shots_total, ...rest } = r; void best_streak; void multi_best; void first_blood; void acc_provisional; void shots_total; return rest; }) } : s.live,
  recap: s.recap ? { ...s.recap, after_end: undefined, rows: (s.recap.rows || []).map(r => { const { best_streak, multi_best, first_blood, acc_provisional, shots_total, ...rest } = r; void best_streak; void multi_best; void first_blood; void acc_provisional; void shots_total; return rest; }) } : s.recap,
});

async function runStale(browser, viteBase, mcBase, vp, tag) {
  step = `stale/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] every A24/A29/A31 field stripped over REST *and* the WebSocket, ${vp.width}x${vp.height}`);
  // Against the REAL server, never `?mock`: the in-browser demo backend runs IN the page, so there is
  // no REST call and no WebSocket frame to intercept and a "stale" run against it is a lie (the exact
  // false pass the skill warns about — caught here on the first run, 2026-09-12).
  expect(await realGoLive(mcBase), 'the real MC reached a live match for the stale walk');
  const pg = await newPage(browser, vp);
  await stripSnapshots(pg, stale);
  await boot(pg, `${viteBase}/#live`);
  await until(() => pg.locator('[data-col-head]').count().then(n => n >= 9), 20000, 'the live board on a stale server');
  expect(await pg.locator('text=CONSOLE ERROR').count() === 0, 'the live board renders with every new field gone');
  const accs = await pg.locator('[data-cell="acc"]').evaluateAll(els => els.map(e => ({ t: e.textContent.trim(), p: e.dataset.provisional })));
  expect(accs.every(a => a.p === '0'), 'with no acc_provisional, ACC is shown plainly rather than as settling');
  const stk = await pg.locator('[data-cell="stk"]').evaluateAll(els => els.map(e => e.textContent.trim()));
  expect(stk.every(v => /^\d+$/.test(v)), `STK falls back to the current streak (${stk.join(',')})`);
  ok(`stale LIVE: ACC ${accs.map(a => a.t).join(',')} · STK ${stk.join(',')}   ${await shot(pg, `20-${tag}-stale-live`)}`);

  await pg.goto(`${viteBase}/#muster`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('[data-app-ver]').count().then(n => n > 0), 20000, 'ARMORY on a stale server');
  const chips = await pg.locator('[data-app-ver]').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  expect(chips.every(c => /UNKNOWN/.test(c)), `a phone with no reported build reads UNKNOWN, never a guess (${chips[0]})`);
  const sum = (await pg.locator('[data-app-ver-summary]').innerText()).replace(/\s+/g, ' ');
  expect(/UNKNOWN/.test(sum), `the summary says UNKNOWN rather than inventing a version (${sum})`);
  // A25: no option table means no switch — a control that PUTs to a route that is not there is worse
  // than no control, and a node with no `log` reads as "the phone has not said", never as "fine"
  expect(await pg.locator('[data-logsync]').count() === 0, 'no LOG SYNC switch without an option table');
  const logStates = await pg.locator('[data-node-card] [data-log-state]').evaluateAll(els => els.map(e => e.dataset.logState));
  expect(logStates.length > 0 && logStates.every(v => v === 'none'), `a node with no log field reads as none (${[...new Set(logStates)].join(',')})`);
  expect(await pg.locator('text=CONSOLE ERROR').count() === 0, 'no crash boundary on ARMORY');
  ok(`stale ARMORY: "${sum}"   ${await shot(pg, `21-${tag}-stale-armory`)}`);

  await pg.goto(`${viteBase}/#lobby`, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(700);
  expect(await pg.locator('[data-testid="mc-verify"]').count() === 0, 'no notices.mc_verify means no host line, and nothing broken');
  expect(await pg.locator('text=CONSOLE ERROR').count() === 0, 'no crash boundary on LOBBY');
  ok(`stale LOBBY: no host line   ${await shot(pg, `22-${tag}-stale-lobby`)}`);

  await pg.goto(`${viteBase}/#spectate`, { waitUntil: 'domcontentloaded' });
  await until(() => pg.locator('[data-spectate="board"]').count().then(n => n > 0), 15000, 'the spectator board on a stale server');
  expect(await pg.locator('button, a[href], input').count() === 0, 'still no controls');
  ok(`stale SPECTATE   ${await shot(pg, `23-${tag}-stale-spectate`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' });
  await pg.context().close();
}

/** MC DROPS MID-MATCH — the one the projector has to survive.
 *
 *  The clock used to be the only thing that changed: one dimmed cell beside a full-strength table of
 *  numbers that had stopped being true, on a screen a room is reading from the back (review
 *  2026-09-12). This is the only way to see it in a browser — `?mock` hardwires `connected: true`,
 *  and simply refusing the WebSocket leaves the console with no snapshot at all, which is the
 *  CONNECTING screen, not a frozen board. So: forward the socket until the board has a match on it,
 *  then drop it and refuse to reconnect. */
async function runOffline(browser, viteBase, mcBase, vp, tag) {
  step = `offline/${tag}`; stepFailedAt = failures.length;
  console.log(`\n[${step}] the board keeps the last snapshot after MC goes away, ${vp.width}x${vp.height}`);
  expect(await realGoLive(mcBase), 'the real MC is live for the offline walk');
  const pg = await newPage(browser, vp);
  let dropped = false;
  await pg.routeWebSocket(/\/ui-ws/, ws => {
    if (dropped) { ws.close(); return; }                 // no reconnect: MC is "gone"
    const server = ws.connectToServer();
    let snaps = 0;
    ws.onMessage(m => server.send(m));
    server.onMessage(m => {
      ws.send(m);
      try { if (JSON.parse(String(m)).kind === 'snapshot' && ++snaps >= 2) { dropped = true; ws.close(); } } catch { /* not json */ }
    });
  });
  await boot(pg, `${viteBase}/#spectate`);
  await until(() => pg.locator('[data-spectate="frozen"]').count().then(n => n > 0), 20000, 'the FROZEN tag once MC is gone');
  const frozen = await pg.evaluate(() => {
    const tag2 = document.querySelector('[data-spectate="frozen"]');
    const content = document.querySelector('[data-spectate="content"]');
    return {
      says: (tag2?.textContent || '').replace(/\s+/g, ' ').trim(),
      tagFs: tag2 ? parseFloat(getComputedStyle(tag2).fontSize) : 0,
      tagOpacity: tag2 ? parseFloat(getComputedStyle(tag2).opacity) : 0,
      boardOpacity: content ? parseFloat(getComputedStyle(content).opacity) : 1,
      rows: document.querySelectorAll('[data-spectate="row"]').length,
    };
  });
  expect(/FROZEN . MC OFFLINE/.test(frozen.says), `the board says why it has stopped (saw ${JSON.stringify(frozen.says)})`);
  expect(frozen.tagFs >= 16, `and says it large enough to read across a room (${frozen.tagFs}px)`);
  expect(frozen.boardOpacity < 0.75, `the WHOLE board is dimmed, not just the clock (opacity ${frozen.boardOpacity})`);
  expect(frozen.tagOpacity > 0.9, `the explanation itself is NOT dimmed (opacity ${frozen.tagOpacity})`);
  expect(frozen.rows > 0, 'the last known scores are still shown — a projector must never go blank');
  ok(`offline: "${frozen.says}" over ${frozen.rows} rows at opacity ${frozen.boardOpacity}   ${await shot(pg, `24-${tag}-offline-spectate`)}`);
  await pg.unrouteAll({ behavior: 'ignoreErrors' });
  await pg.context().close();
}

// ---------------------------------------------------------------------------- main
(async () => {
  const run = name => !ONLY || ONLY === name;
  // every run that needs a python MC has to be named here, or `ONLY=<that run>` silently starts no
  // server, skips the run and prints ALL GREEN (caught 2026-09-12)
  const mc = (run('real') || run('stale') || run('offline')) ? await startMC() : null;
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    if (run('measure')) await runMeasure(browser, vite.base);
    if (run('mock')) await runMock(browser, vite.base, DESK, 'desk');
    if (run('phone')) await runMock(browser, vite.base, PHONE, 'phone');
    // `real` also needs the MC for `refusal` and the A31 tail
    if (run('real') && mc) {
      await runReal(browser, vite.base, mc.base, DESK, 'desk');
      await runRefusal(browser, vite.base, mc.base, DESK, 'desk');
      await runRealTail(browser, vite.base, mc.base, DESK, 'desk');
    }
    // only as its own run: the `real` block above already walks it in sequence (it needs that walk's
    // ROCCO on the roster), so `run('refusal')` would repeat it on a full pass
    if (ONLY === 'refusal' && mc) await runRefusal(browser, vite.base, mc.base, DESK, 'desk');
    if (run('stale') && mc) await runStale(browser, vite.base, mc.base, DESK, 'desk');
    if (run('offline') && mc) await runOffline(browser, vite.base, mc.base, DESK, 'desk');
  } finally {
    await browser.close();
    await vite.stop();
    if (mc) await mc.stop();
  }
  if (jsErrors.length) {
    console.log(`\n${jsErrors.length} page error(s):`);
    for (const e of jsErrors.slice(0, 20)) console.log(`  ${e}`);
    failures.push(...jsErrors.map(e => `page error: ${e}`));
  }
  console.log(failures.length ? `\n${failures.length} FAILURE(S):\n  ${failures.join('\n  ')}` : '\nALL GREEN');
  process.exit(failures.length ? 1 : 0);
})();
