// F635: the post-match end-to-end gate. A real Mission Control (demo, private home), four phone HUDs (REAPER, VIPER,
// NOMAD, GHOST), a utility hill station and MC's own console, in one Chromium. A WebSocket tap records every frame MC
// sends each phone; a snapshot reads every field a player can see. It found F628, F630, F632 and F633 as an ad-hoc
// harness before it became this job.
//
// Cases (ONLY=<case> runs one, with the steps it needs; each case sets itself up):
//   2   one phone (GHOST) offline at the whistle: MC releases without it at the bound, no early result
//   6   debrief edits (re-team, rename): every assign carries recap:true, no phone loses its result; then a late fact
//   3   the late phone comes back and its facts flip the winner: RESULT UPDATED once on the others, never on GHOST
//   3b  a synced phone drops and rejoins with an empty queue: the result is in the welcome (body.node.result), no reopen
//   5   KOTH: presence stops, the hill goes offline before the whistle, MC releases at the bound, the hill comes back with
//       the same tally: no second result frame, nothing on any screen changes
//   7   NEXT MATCH on the console leaves the result: every phone shows the setting-up screen, no recap flag
//
// The release bound: MC's SYNC_STUCK_S is 120 s. tools/postmatch_mc.py starts MC with a short bound (STUCK_S below), and
// the checks assert against it. The console's "FINAL AFTER N MIN" lead is the console's own build constant
// (contract.gen.ts SYNC_STUCK_S), so that line still reads 2 MIN under the override; the gate checks it against that
// constant, and checks the countdown and the release time against the override.
//
// Parallel safety (CONTRIBUTING.md, Running things): ports from the job's block or the OS, output only under POSTMATCH_OUT
// (default app/shots/postmatch-e2e, git-ignored), condition waits only, and MC, the static server and the browser are
// stopped in `finally`. Run: cd app && node tools/postmatch-e2e.mjs   (ONLY=5 for one case)
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../../scripts/lib/static-server.mjs';
import { freePort } from '../../scripts/lib/ports.mjs';
import { HONOR_HOLDERS_SHOWN } from '../src/hud/result.js';
import { compareFrames, welcomeResult, keepsResult, expectedHonours, mmssToS, sameJson, fieldDiff } from './lib/postmatch-checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');                 // app/
const REPO = path.resolve(ROOT, '..');
const OUT = path.resolve(process.env.POSTMATCH_OUT || path.join(ROOT, 'shots', 'postmatch-e2e'));
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const HOME = path.join(OUT, 'home'); fs.mkdirSync(HOME, { recursive: true });

const CASES = ['2', '6', '3', '3b', '5', '7'];
const ONLY = process.env.ONLY || '';
if (ONLY && !CASES.includes(ONLY)) { console.error(`FATAL: ONLY=${ONLY} is not a case (${CASES.join(', ')})`); process.exit(3); }
const want = (c) => !ONLY || ONLY === c;
const STUCK_S = 12;                       // the test bound (postmatch_mc.py); MC's real one is 120 s
const CONSOLE_STUCK_S = Number(/export const SYNC_STUCK_S = (\d+);/.exec(fs.readFileSync(path.join(REPO, 'webapp/mc/src/api/contract.gen.ts'), 'utf8'))?.[1]);
if (!Number.isFinite(CONSOLE_STUCK_S)) { console.error('FATAL: no SYNC_STUCK_S in webapp/mc/src/api/contract.gen.ts'); process.exit(3); }
const TL_TDM = 30, TL_KOTH = 45;          // match lengths: room for the scripted kills, and for the hill to go quiet first

// ---------- log and checks ----------
const logf = fs.openSync(path.join(OUT, 'postmatch.log'), 'w');
const T0 = Date.now();
const log = (...a) => { const s = `[${((Date.now() - T0) / 1000).toFixed(1)}] ` + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); console.log(s); fs.writeSync(logf, s + '\n'); };
const checks = [];
const check = (cse, ok, what, extra) => {
  if (!want(cse)) return;
  checks.push({ cse, ok: !!ok, what, extra });
  log(`${ok ? 'OK  ' : 'FAIL'} [${cse}] ${what}${!ok && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 1500) : ''}`);
};
const pause = ms => new Promise(r => setTimeout(r, ms));   // the poll interval of `until`, never a wait on its own
const until = async (fn, ms, what) => {
  const end = Date.now() + ms;
  for (;;) { let v; try { v = await fn(); } catch { v = false; } if (v) return v; if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`); await pause(150); }
};

// ---------- servers ----------
const python = () => {
  const cands = [process.env.MC_PY, path.join(REPO, '.venv/bin/python')];
  try { cands.push(path.join(path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPO, encoding: 'utf8' }).trim()), '.venv/bin/python')); } catch { /* not a git checkout */ }
  const py = cands.find(c => c && fs.existsSync(c));
  if (!py) { console.error(`FATAL: no Python venv (${cands.filter(Boolean).join(', ')}); set MC_PY`); process.exit(3); }
  return py;
};
const HTTP = await freePort(), NODE = await freePort();
const MC = `http://127.0.0.1:${HTTP}`;
const api = async (m, p, b) => {
  const r = await fetch(MC + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  if (r.status >= 400) log(`HTTP ${r.status} ${m} ${p}`, j);
  return j;
};
const st = () => api('GET', '/api/state');

let mcProc = null, hud = null, browser = null; const phones = {};
let mcLogText = '';
async function stopAll() {
  try { fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(checks, null, 1)); } catch { /* best effort */ }
  try { fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(Object.fromEntries(Object.entries(phones).map(([k, v]) => [k, v.frames])), null, 1)); } catch { /* best effort */ }
  try { await browser?.close(); } catch { /* gone */ }
  if (mcProc && mcProc.exitCode == null) {
    const gone = new Promise(r => mcProc.once('exit', r));
    try { process.kill(-mcProc.pid, 'SIGTERM'); } catch { try { mcProc.kill('SIGTERM'); } catch { /* gone */ } }
    await Promise.race([gone, pause(3000)]);
    try { process.kill(-mcProc.pid, 'SIGKILL'); } catch { /* gone */ }
  }
  try { await hud?.close(); } catch { /* gone */ }
}

let failed = false;
try {
  if (!fs.existsSync(path.join(ROOT, 'www', 'app.js'))) throw new Error('no app/www/app.js: run `npm run build` in app/ first');
  if (!fs.existsSync(path.join(REPO, 'webapp/mc/dist/index.html'))) throw new Error('no webapp/mc/dist: run `npx vite build` in webapp/mc first');
  const mcLog = fs.openSync(path.join(OUT, 'mc.log'), 'w');
  mcProc = spawn(python(), [path.join(HERE, 'postmatch_mc.py'), String(STUCK_S), '--demo', '--no-auth', '--host', '127.0.0.1',
    '--session-file', path.join(HOME, 'session.json'), '--port', String(HTTP), '--ws-port', String(NODE), '-v'],
  { cwd: path.join(REPO, 'mcp'), detached: true, stdio: ['ignore', mcLog, mcLog],
    env: { ...process.env, BRX_MCP_HOME: HOME, PYTHONPATH: [path.join(REPO, 'mcp'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) } });
  await until(async () => { if (mcProc.exitCode != null) throw new Error('MC exited'); return (await fetch(MC + '/api/state')).ok; }, 30000, 'MC up')
    .catch(e => { throw new Error(`${e.message}\n${fs.readFileSync(path.join(OUT, 'mc.log'), 'utf8').slice(-2000)}`); });
  mcLogText = fs.readFileSync(path.join(OUT, 'mc.log'), 'utf8');
  if (!mcLogText.includes(`SYNC_STUCK_S=${STUCK_S}`)) throw new Error('MC did not start through postmatch_mc.py with the test bound');
  hud = await startStaticServer(path.join(ROOT, 'www'), { port: 0, host: '127.0.0.1' });
  const HUD = `http://127.0.0.1:${hud.port}`;
  let S = await st();
  const QR = S.lan.ws_url;
  if (!QR.includes(`:${NODE}/`)) throw new Error(`MC's node URL ${QR} is not this run's port ${NODE}`);
  log('MC up', { http: HTTP, node: QR, stuck_s: STUCK_S, only: ONLY || 'all' });

  // ---------- roster ----------
  const KEEP = ['REAPER', 'VIPER', 'NOMAD', 'GHOST'];
  for (const p of S.players) if (!KEEP.includes(p.display)) await api('DELETE', `/api/players/${p.player_id}`);
  await api('PUT', '/api/config', { time_limit_s: TL_TDM, respawn: { type: 'auto', delay_s: 3 } });
  S = await st();
  const P = Object.fromEntries(S.players.map(p => [p.display, p]));
  if (!KEEP.every(n => P[n])) throw new Error(`the demo roster lacks ${KEEP.filter(n => !P[n])}`);
  const TID = Object.fromEntries(S.config.teams.map(t => [t.team_id, t.tid]));
  const team0 = Object.fromEntries(KEEP.map(n => [n, P[n].team_id]));   // REAPER, NOMAD red; VIPER, GHOST blue
  const armory = await api('GET', '/api/armory');

  // ---------- browser: four phones and the console ----------
  browser = await chromium.launch();
  const wsTap = (rec, pg) => pg.on('websocket', ws => {
    if (!ws.url().includes(`:${NODE}/`)) return;
    ws.on('framereceived', f => { try { const j = JSON.parse(f.payload); rec.frames.push({ at: Date.now(), dir: 'in', kind: j.kind, body: j.body }); } catch { /* not JSON */ } });
    ws.on('framesent', f => { try { const j = JSON.parse(f.payload); if (j.kind !== 'time_req') rec.frames.push({ at: Date.now(), dir: 'out', kind: j.kind, body: j.body }); } catch { /* not JSON */ } });
  });
  const mkPage = async (vp) => { const ctx = await browser.newContext({ viewport: vp }); const pg = await ctx.newPage(); pg.setDefaultTimeout(10000); return pg; };
  for (const nm of KEEP) {
    const pg = await mkPage({ width: 891, height: 411 }); phones[nm] = { pg, frames: [] }; wsTap(phones[nm], pg);
    pg.on('pageerror', e => log(`pageerror ${nm}`, String(e.message).slice(0, 200)));
    const g = armory.find(a => a.gun_id === P[nm].gun_id);
    await pg.goto(`${HUD}/?mc=${encodeURIComponent(QR)}&gun=${encodeURIComponent(g.gun_id + '-' + g.ble.tail)}`);
  }
  const con = await mkPage({ width: 1280, height: 900 });
  await con.goto(MC + '/');

  // ---------- reading the screens ----------
  const engOf = (nm) => phones[nm].pg.evaluate(() => { const s = window.brx.engine.state(); return { phase: s.phase, ended: s.ended, endAck: s.endAck, wsState: s.wsState, deaths: s.deaths, matchId: s.matchId, winner: s.result?.winner ?? null }; });
  const snapPhone = (nm) => phones[nm].pg.evaluate(() => {
    const q = (s, r = document) => r.querySelector(s); const tx = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    const s = window.brx.engine.state(); const r = s.result; const res = q('.result.rv');
    const sy = res && q('.rfoot .sy', res);
    return {
      screen: res ? 'result' : q('.lobby .setup') ? 'setup' : 'other',
      resultVisible: !!res && !!q('.rh1.w', res),
      headline: tx(res && q('.rh1', res)), meta: tx(res && q('.rmeta', res)),
      teams: res ? [...res.querySelectorAll('.rteam')].map(t => ({ name: tx(q('.tm .unskew', t))?.replace(/\s*\S+$/, '') ?? null, score: tx(q('.tm b', t)),
        held: tx(q('.thold b', t)), rows: [...t.querySelectorAll('.tp')].map(p => [tx(q('.pn', p)), ...[...p.querySelectorAll('.kda i')].map(tx)]) })) : [],
      tiles: res && q('.rstats', res) && !q('.rstats', res).hidden ? [...res.querySelectorAll('.rstats .cell')].map(c => [tx(q('span', c)), tx(q('b', c))]) : null,
      honours: res && q('.rstrip.hon', res) ? { chips: [...res.querySelectorAll('.rstrip.hon .ch:not(.more)')].map(tx), more: tx(q('.rstrip.hon .ch.more', res)), go: !!q('.rstrip.hon .go', res) } : null,
      track: sy ? { stage: sy.getAttribute('data-sync'), nodes: [...sy.querySelectorAll('.trk .nd')].map(n => `${tx(n)}:${n.classList.contains('done') ? 'done' : n.classList.contains('cur') ? 'cur' : ''}`),
        why: tx(q('.why', sy)) } : null,
      mcv: tx(res && q('.mcvline', res)), sess: tx(res && q('.sess', res)),
      setupText: tx(q('.lobby .setup .t')),
      engine: { phase: s.phase, ended: s.ended, endAck: s.endAck, matchId: s.matchId, outcome: r?.outcome ?? null, winner: r?.winner ?? null, provisional: r?.provisional ?? null, _updated: r?._updated ?? null },
    };
  });
  const snapCon = () => con.evaluate(() => {
    const el = id => document.querySelector(`[data-testid="${id}"]`); const tx = e => e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
    const fw = el('final-without');
    return { status: tx(el('recap-status')), pending: tx(el('results-pending')), waiting: tx(el('waiting-for')), releaseIn: tx(el('release-in')),
      finalWithout: tx(fw), releasedBy: fw ? fw.getAttribute('data-released-by') : null, resultChanged: tx(el('result-changed')),
      names: (document.body.innerText.match(/REAPERX?|NOMAD|VIPER|GHOST/g) || []) };
  });
  let shotN = 0;
  const checkpoint = async (tag) => {
    const o = { tag, console: await snapCon() }; for (const nm of KEEP) o[nm] = await snapPhone(nm);
    fs.appendFileSync(path.join(OUT, 'snapshots.jsonl'), JSON.stringify(o) + '\n');
    const pre = String(++shotN).padStart(2, '0');
    for (const nm of KEEP) await phones[nm].pg.screenshot({ path: path.join(OUT, `${pre}-${tag}-${nm}.png`) }).catch(() => { });
    await con.screenshot({ path: path.join(OUT, `${pre}-${tag}-console.png`), fullPage: true }).catch(() => { });
    log('checkpoint', tag, o.console);
    return o;
  };
  const results = (nm, since = 0) => phones[nm].frames.filter(f => f.dir === 'in' && f.kind === 'result' && f.at >= since);
  const fr = (f) => f ? { at: f.at, body: f.body } : null;
  const identical = (cse, frames, label, late = []) => {
    for (const r of compareFrames(frames, late)) {
      const A = frames[r.a].body, B = frames[r.b].body;
      check(cse, r.differ.length === 0, `${label}: ${r.a} vs ${r.b} full body identical except outcome, my${r.late ? ', t (sent later)' : ''}`,
        { differ: r.differ, a: r.differ.map(k => A[k]), b: r.differ.map(k => B[k]) });
    }
  };
  const goOffline = async (nm) => { const pg = phones[nm].pg; await pg.context().setOffline(true); await pg.evaluate(() => window.brx.transport?.dropLink()); await until(async () => (await engOf(nm)).wsState !== 'bound', 15000, `${nm} link down`); };
  const goOnline = async (nm) => { await phones[nm].pg.context().setOffline(false); };
  // Settle: MC has seen two more status beats from each linked phone since `since`, and answered after the last one.
  // A stale or second result (F630) came from MC's handling of a later beat, so it is in the tap before this returns.
  const settle = async (names, since, what) => until(() => names.every(nm => {
    const out = phones[nm].frames.filter(f => f.dir === 'out' && f.kind === 'status' && f.at >= since);
    return out.length >= 2 && phones[nm].frames.some(f => f.dir === 'in' && f.at > out[1].at);
  }), 30000, `beats settle (${what})`);

  // ---------- what each phone must show ----------
  const TEAM_NAME = { red: 'RED TEAM', blue: 'BLUE TEAM' };
  const SYNCED = { stage: 'received', nodes: ['LINKED:done', 'SENDING:done', 'RECEIVED:cur'], why: 'Mission Control has all your scores' };
  const UNLINKED = { stage: 'unlinked', nodes: ['NOT LINKED:cur', 'SENDING:', 'RECEIVED:'], why: 'No Wi-Fi to Mission Control · ▸ Walk back towards Mission Control' };
  /** MC's own sync board (GET /api/state recap.sync): true once exactly `missing` (names) are the rows not received. */
  const syncMissing = async (missing) => { const rows = (await st()).recap?.sync?.rows || []; const left = rows.filter(r => r.stage !== 'received').map(r => r.name);
    return rows.length > 0 && sameJson([...left].sort(), [...missing].sort()); };
  /** The console's waiting line matches MC's sync board: the board first, then the console's copy of it. */
  const consoleWaitsFor = async (missing, who) => { await until(() => syncMissing(missing), STUCK_S * 1000, `MC's sync board missing only ${missing}`);
    await until(async () => (await snapCon()).waiting === `WAITING FOR ${who}`, 5000, `the console waiting line for ${who}`).catch(() => { /* the checkpoint says what it showed */ }); };
  const tilesPending = (l) => [['KILLS', String(l.k)], ['DEATHS', String(l.d)], ['ASSISTS', '0'], ['ACCURACY', '—'], ['SHOTS', '0']];
  const tilesFinal = (l, held) => [['KILLS', String(l.k)], ['DEATHS', String(l.d)], ['ASSISTS', '0'], ['ACCURACY', '—'], ['BEST STREAK', String(l.best)],
    ...(held != null ? [['YOUR TEAM HELD', held]] : [['SHOTS', '0']])];
  const sessLine = (nm, hist) => { const g = hist[nm]; return g.length > 1 ? `THIS SESSION · ${g.length} GAMES · ${g.reduce((a, x) => a + x.k, 0)} KILLS · ${g.reduce((a, x) => a + x.d, 0)} DEATHS` : null; };
  const closedPhone = (eng) => ({ screen: 'other', resultVisible: false, headline: null, meta: null, teams: [], tiles: null, honours: null, track: null, mcv: null, sess: null, engine: eng });
  /** A phone on the waiting screen. */
  const pendingPhone = ({ mode, own, track, matchId, unreached, mcv, sess }) => ({
    screen: 'result', resultVisible: false, headline: unreached ? 'MC NOT REACHED · SEE MISSION CONTROL' : 'RESULT PENDING', meta: mode.toUpperCase(), teams: [],
    tiles: tilesPending(own), honours: null, track, mcv: mcv ?? null, sess: sess ?? null,
    engine: { phase: 'kitted', ended: true, endAck: false, matchId, outcome: null, winner: null, provisional: null, _updated: null } });
  /** A phone showing the final result. `teams`: [{ id, score, held, members: [[name, k, d, a]] }]. */
  const finalPhone = ({ nm, mode, winBy, winner, myTeam, updated, own, teams, body, held, track, sess, matchId, endAck = false }) => ({
    screen: 'result', resultVisible: true, headline: myTeam === winner ? 'WIN' : 'LOSE',
    meta: [updated ? 'RESULT UPDATED' : null, mode.toUpperCase(), `WIN BY ${winBy}`].filter(Boolean).join(' · '),
    teams: teams.map(t => ({ name: TEAM_NAME[t.id], score: String(t.score), held: t.held ?? null, rows: t.members.map(r => r.map(String)) })),
    tiles: tilesFinal(own, held), honours: expectedHonours(body, HONOR_HOLDERS_SHOWN), track, mcv: null, sess: sess ?? null,
    engine: { phase: 'kitted', ended: true, endAck, matchId, outcome: myTeam === winner ? 'win' : 'lose', winner: { team_id: winner }, provisional: false, _updated: updated ? true : null } });
  // Rows are compared as a set (the HUD orders by score; ties are MC's order), and their order is checked apart.
  const normRows = (p) => ({ ...p, teams: (p.teams || []).map(t => ({ ...t, rows: [...t.rows].sort((a, b) => String(a).localeCompare(String(b))) })) });
  const expectPhone = (cse, tag, nm, snap, exp) => {
    const d = fieldDiff(normRows(snap), normRows(exp));
    check(cse, Object.keys(d).length === 0, `${tag}: ${nm} every visible field and the engine as expected`, d);
    for (const t of snap.teams || []) {
      const ks = t.rows.map(r => Number(r[1]));
      check(cse, ks.every((k, i) => i === 0 || ks[i - 1] >= k), `${tag}: ${nm} ${t.name} rows by most kills first`, t.rows);
    }
  };
  const expectConsole = (cse, tag, c, exp) => { const d = fieldDiff(c, exp); check(cse, Object.keys(d).length === 0, `${tag}: console status lines as expected`, d); };
  const CON_WAIT = (who) => ({ status: 'MATCH OVER · WAITING FOR RESULTS', pending: 'RESULTS PENDING', waiting: `WAITING FOR ${who}`, finalWithout: null, resultChanged: null });
  const finalLead = `FINAL AFTER ${Math.round(CONSOLE_STUCK_S / 60)} MIN`;   // the console's constant (see the header)
  const releaseInS = (c) => { const m = /^FINAL IN (\d+:\d\d)$/.exec(c.releaseIn || ''); return m ? mmssToS(m[1]) : null; };

  // ---------- match setup ----------
  async function setupMatch(label) {
    S = await st(); log(label, 'from phase', S.phase);
    if (S.phase === 'build' || S.phase === 'muster') await api('POST', '/api/phase', { phase: 'kit', force: true });
    for (const nm of KEEP) await until(async () => ['kitted', 'lobby'].includes((await engOf(nm)).phase), 20000, nm + ' kitted');
    for (const nm of KEEP) { const b = phones[nm].pg.locator('[data-act="onBriefDone"]'); if (await b.count()) await b.first().dispatchEvent('click').catch(() => { }); }
    if ((await st()).phase !== 'lobby') await api('POST', '/api/phase', { phase: 'lobby', force: true });
    await until(async () => (await st()).phase === 'lobby', 10000, 'lobby');
    const push = await api('POST', '/api/lobby/push', { force: true }); if (!push.ok) throw new Error(`push refused: ${JSON.stringify(push)}`);
    await until(async () => Object.values((await st()).lobby.acks || {}).filter(a => a.ok).length >= KEEP.length, 30000, 'every phone acked');
    const start = await api('POST', '/api/start', { runway_s: 5, force: true }); if (!start.match_id) throw new Error(`start refused: ${JSON.stringify(start)}`);
    await until(async () => { for (const nm of KEEP) if ((await engOf(nm)).phase !== 'live') return false; return true; }, 25000, 'all live');
    for (const nm of KEEP) await until(() => phones[nm].pg.evaluate(() => window.fakeGun.state().spawned), 15000, nm + ' spawned');
    log(label, 'LIVE', start.match_id); return start;
  }
  /** `victim` takes a lethal hit from `shooter`; returns once the victim's engine counted the death. */
  const kill = async (victim, shooter) => {
    const pg = phones[victim].pg;
    await until(() => pg.evaluate(() => window.fakeGun.state().spawned), 15000, victim + ' spawned');
    const before = (await engOf(victim)).deaths;
    await pg.evaluate(([n, t]) => window.fakeGun.kill(n, t), [P[shooter].player_num, TID[team0[shooter]]]);
    await until(async () => (await engOf(victim)).deaths === before + 1, 10000, `${victim} death ${before + 1}`);
  };
  const waitRecap = async (ms) => { await until(async () => (await st()).phase === 'recap', ms, 'recap phase'); return Date.now(); };

  // The scripted facts, and so the truth every screen must show. `best` is the best streak.
  const L = { REAPER: { k: 1, d: 2, best: 1 }, VIPER: { k: 2, d: 1, best: 2 }, NOMAD: { k: 0, d: 0, best: 0 }, GHOST: { k: 0, d: 3, best: 0 } };
  const LF = { ...L, NOMAD: { k: 3, d: 0, best: 3 } };             // after GHOST's facts arrive (NOMAD's three kills)
  const L0 = Object.fromEntries(KEEP.map(n => [n, { k: 0, d: 0, best: 0 }]));
  const hist = Object.fromEntries(KEEP.map(n => [n, []]));          // each phone's own match history, for the session line
  const world = { renamed: false, reteamed: false };
  const disp = (nm) => nm === 'REAPER' && world.renamed ? 'REAPERX' : nm;
  const tdmTeams = (led, teamOf) => ['red', 'blue'].map(id => ({ id, score: KEEP.filter(n => teamOf[n] === id).reduce((a, n) => a + led[n].k, 0),
    members: KEEP.filter(n => teamOf[n] === id).map(n => [disp(n), led[n].k, led[n].d, 0]) }));

  const needM1 = ['2', '6', '3', '3b', '7'].some(want);
  let m1 = null, w1 = null, flipped = null, t6 = 0;

  if (needM1) {
    // ================= MATCH 1 · TDM: cases 2, 6, 3, 3b =================
    m1 = await setupMatch('M1 TDM');
    await kill('REAPER', 'VIPER'); await kill('REAPER', 'VIPER'); await kill('VIPER', 'REAPER');
    await goOffline('GHOST'); log('GHOST offline');
    for (let i = 0; i < 3; i++) await kill('GHOST', 'NOMAD');   // GHOST's queue now holds red's three kills
    const whistle = await waitRecap(TL_TDM * 1000 + 30000); log('M1 recap phase at', ((whistle - m1.go_live_t) / 1000).toFixed(1), 's after go-live');
    await con.goto(MC + '/');
    const ONLINE = ['REAPER', 'VIPER', 'NOMAD'];
    await until(async () => (await snapCon()).releaseIn && (await Promise.all(ONLINE.map(snapPhone))).every(s => s.track?.stage === 'received'), STUCK_S * 1000, 'console countdown and the online phones synced');
    await consoleWaitsFor(['GHOST'], 'GHOST');
    const c2a = await checkpoint('m1-waiting');
    const rel1s = releaseInS(c2a.console);
    expectConsole('2', 'm1-waiting', c2a.console, CON_WAIT('GHOST'));
    check('2', rel1s != null && rel1s >= 1 && rel1s <= STUCK_S, `m1-waiting: FINAL IN counts from the test bound (${STUCK_S} s)`, c2a.console.releaseIn);
    for (const nm of ONLINE) expectPhone('2', 'm1-waiting', nm, c2a[nm], pendingPhone({ mode: 'tdm', own: L[nm], track: SYNCED, matchId: m1.match_id }));
    // GHOST is offline: its own count, and RESULT PENDING until RESULT_SETTLE_MS, MC NOT REACHED after it
    const gExp = pendingPhone({ mode: 'tdm', own: L.GHOST, track: UNLINKED, matchId: m1.match_id, unreached: c2a.GHOST.headline !== 'RESULT PENDING' });
    expectPhone('2', 'm1-waiting', 'GHOST', c2a.GHOST, gExp);
    for (const nm of KEEP) check('2', results(nm, m1.go_live_t).length === 0, `m1-waiting: ${nm} has no result frame yet`, results(nm, m1.go_live_t).length);
    await until(async () => { const s = releaseInS(await snapCon()); return s != null && s < rel1s; }, STUCK_S * 1000, 'the countdown to move');
    check('2', true, 'FINAL IN counts down');
    // the release
    await until(() => results('REAPER', whistle).length > 0, (STUCK_S + 20) * 1000, 'the bounded release');
    const relAt = Date.now(); const relAfter = (relAt - whistle) / 1000;
    log('M1 release', relAfter.toFixed(1), 's after the recap phase');
    check('2', relAfter >= STUCK_S - 1.5 && relAfter <= STUCK_S + 8, `the release comes ${STUCK_S} s (the test bound) after the whistle`, relAfter.toFixed(1));
    await until(async () => (await snapCon()).finalWithout && (await Promise.all(ONLINE.map(snapPhone))).every(s => s.resultVisible), 15000, 'release on the console and the phones');
    await settle(ONLINE, relAt, 'release');
    const c2c = await checkpoint('m1-released');
    expectConsole('2', 'm1-released', c2c.console, { status: 'MATCH COMPLETE', pending: null, waiting: null, releaseIn: null,
      finalWithout: `${finalLead} WITHOUT 1 PHONE (GHOST)`, releasedBy: 'timeout', resultChanged: null });
    const relF1 = Object.fromEntries(ONLINE.map(n => [n, fr(results(n, whistle)[0])]));
    w1 = relF1.REAPER?.body?.winner;
    check('2', sameJson(w1, { team_id: 'blue' }), 'released without GHOST: blue wins on kills (2 to 1)', w1);
    for (const nm of ONLINE) {
      check('2', results(nm, whistle).length === 1, `m1-released: ${nm} exactly one result frame`, results(nm, whistle).length);
      expectPhone('2', 'm1-released', nm, c2c[nm], finalPhone({ nm, mode: 'tdm', winBy: 'KILLS', winner: 'blue', myTeam: team0[nm], updated: false, own: L[nm],
        teams: tdmTeams({ ...L, GHOST: L0.GHOST }, team0), body: relF1[nm].body, track: SYNCED, matchId: m1.match_id }));
    }
    expectPhone('2', 'm1-released', 'GHOST', c2c.GHOST, { ...gExp, headline: c2c.GHOST.headline === 'RESULT PENDING' ? 'RESULT PENDING' : 'MC NOT REACHED · SEE MISSION CONTROL' });
    check('2', results('GHOST').length === 0, 'm1-released: GHOST (offline) got no result frame', results('GHOST').length);
    identical('2', relF1, 'released result');
    for (const nm of ONLINE) hist[nm].push({ ...L[nm] });

    if (['6', '3', '3b'].some(want)) {
      // REAPER and VIPER tap OK; NOMAD leaves its screen up
      for (const nm of ['REAPER', 'VIPER']) { await phones[nm].pg.evaluate(() => window.brx.engine.ackEnd()); await until(async () => (await engOf(nm)).endAck === true, 5000, `${nm} acked`); }
    }
    if (want('6')) {
      // ---------- case 6, part 1: debrief edits ----------
      t6 = Date.now();
      const r6a = await api('PATCH', `/api/players/${P.NOMAD.player_id}`, { team_id: 'blue' });
      const r6b = await api('PATCH', `/api/players/${P.REAPER.player_id}`, { display: 'REAPERX' });
      check('6', r6a.team_id === 'blue' && r6b.display === 'REAPERX', 'the debrief edits are accepted', { team: r6a.team_id, name: r6b.display });
      world.renamed = true; world.reteamed = true;
      await until(async () => ONLINE.every(n => results(n, t6).some(f => JSON.stringify(f.body?.rows || []).includes('REAPERX')))
        && ['NOMAD', 'REAPER'].every(n => phones[n].frames.some(f => f.dir === 'in' && f.kind === 'assign' && f.at >= t6))
        && (await snapCon()).names.includes('REAPERX') && (await snapPhone('NOMAD')).teams.some(t => t.rows.some(r => r[0] === 'REAPERX')), 20000, 'the edits reach the phones and the console');
      await settle(ONLINE, t6, 'edits');
      const c6 = await checkpoint('m1-after-edits');
      expectConsole('6', 'm1-after-edits', c6.console, { status: 'MATCH COMPLETE', pending: null, waiting: null, releaseIn: null,
        finalWithout: `${finalLead} WITHOUT 1 PHONE (GHOST)`, releasedBy: 'timeout', resultChanged: null });
      check('6', c6.console.names.includes('REAPERX'), 'm1-after-edits: the console shows the rename', c6.console.names);
      for (const nm of ['NOMAD', 'REAPER']) {
        const a = phones[nm].frames.filter(f => f.dir === 'in' && f.kind === 'assign' && f.at >= t6);
        check('6', a.length > 0 && a.every(f => f.body?.recap === true), `m1-after-edits: ${nm} every assign after the edit carries recap:true`, a.map(f => f.body?.recap));
        check('6', keepsResult(c6[nm].engine, m1.match_id), `m1-after-edits: ${nm} keeps its result (kitted is fine in the debrief)`, c6[nm].engine);
      }
      for (const nm of ONLINE) {
        const rs = results(nm, t6); const b = rs.at(-1)?.body;
        check('6', rs.length === 1, `m1-after-edits: ${nm} one result frame for the rename`, rs.length);
        check('6', b?.rows?.find(r => r.player_id === P.NOMAD.player_id)?.team_id === 'red' && sameJson(b?.winner, w1),
          `m1-after-edits: ${nm} the re-team does not move this match (NOMAD still red, the same winner)`, { winner: b?.winner });
      }
      // REAPER and VIPER acked: closed, and an edit must not reopen them; NOMAD never acked
      for (const nm of ['REAPER', 'VIPER']) expectPhone('6', 'm1-after-edits', nm, c6[nm], closedPhone({ phase: 'kitted', ended: true, endAck: true, matchId: m1.match_id,
        outcome: team0[nm] === 'blue' ? 'win' : 'lose', winner: { team_id: 'blue' }, provisional: false, _updated: null }));
      expectPhone('6', 'm1-after-edits', 'NOMAD', c6.NOMAD, finalPhone({ nm: 'NOMAD', mode: 'tdm', winBy: 'KILLS', winner: 'blue', myTeam: 'red', updated: false, own: L.NOMAD,
        teams: tdmTeams({ ...L, GHOST: L0.GHOST }, team0), body: results('NOMAD').at(-1).body, track: SYNCED, matchId: m1.match_id }));
    }

    if (['6', '3', '3b'].some(want)) {
      // ---------- case 3: GHOST reconnects; its facts flip the winner (and are case 6's late fact) ----------
      await phones.GHOST.pg.evaluate(() => {
        window.__samples = [];
        const take = () => { const r = window.brx.engine.state().result; const m = document.querySelector('.result .rmeta');
          window.__samples.push({ t: Date.now(), w: r?.winner ?? null, u: r?._updated ?? null, meta: m ? m.textContent : null }); };
        window.__obs = new MutationObserver(take); window.__obs.observe(document.body, { subtree: true, childList: true, characterData: true });
        window.__iv = setInterval(take, 100); take();
      });
      const t3 = Date.now();
      await goOnline('GHOST'); log('GHOST back online');
      await until(async () => (await engOf('GHOST')).winner && ONLINE.every(n => results(n, t3).length > 0), 30000, 'GHOST result and the flipped result on the others');
      await until(async () => (await snapCon()).resultChanged && (await snapPhone('GHOST')).track?.stage === 'received', 15000, 'RESULT CHANGED and GHOST synced');
      await settle(KEEP, Date.now(), 'late fact');
      const samples = await phones.GHOST.pg.evaluate(() => { window.__obs.disconnect(); clearInterval(window.__iv); return window.__samples; });
      const c3 = await checkpoint('m1-late-fact');
      flipped = results('GHOST', t3).at(-1)?.body ?? welcomeResult(phones.GHOST.frames.filter(f => f.dir === 'in' && f.kind === 'welcome' && f.at >= t3).at(-1));
      check('3', sameJson(flipped?.winner, { team_id: 'red' }), "GHOST's facts flip the winner to red (4 to 2)", { before: w1, after: flipped?.winner });
      expectConsole('3', 'm1-late-fact', c3.console, { status: 'MATCH COMPLETE', pending: null, waiting: null, releaseIn: null, finalWithout: null, resultChanged: 'RESULT CHANGED' });
      const g3 = results('GHOST', t3); const welcomeR = phones.GHOST.frames.filter(f => f.dir === 'in' && f.kind === 'welcome' && f.at >= t3 && welcomeResult(f));
      check('3', g3.length + welcomeR.length >= 1 && g3.length <= 1, 'm1-late-fact: GHOST got exactly one result', { results: g3.length, welcomeWithResult: welcomeR.length });
      const badG = samples.filter(s => (s.w && sameJson(s.w, w1)) || s.u === true || /RESULT UPDATED/.test(s.meta || ''));
      const gaps = samples.slice(1).map((s, i) => s.t - samples[i].t);
      check('3', samples.length > 0 && badG.length === 0, `GHOST never showed the old winner or RESULT UPDATED (${samples.length} in-page samples)`, badG.slice(0, 3));
      check('3', Math.max(0, ...gaps) <= 1000, 'GHOST sampled at least every second', Math.max(0, ...gaps));
      const teamsF = tdmTeams(LF, team0);
      for (const nm of ONLINE) {
        const after = results(nm, t3);
        check('3', after.length === 1, `m1-late-fact: ${nm} exactly one result frame after the reconnect`, after.map(f => f.body?.winner));
        check('3', after.every(f => sameJson(f.body.winner, flipped?.winner)), `m1-late-fact: ${nm} that frame carries the flipped winner`);
        expectPhone('3', 'm1-late-fact', nm, c3[nm], finalPhone({ nm, mode: 'tdm', winBy: 'KILLS', winner: 'red', myTeam: team0[nm], updated: true, own: LF[nm],
          teams: teamsF, body: after.at(-1)?.body, track: SYNCED, matchId: m1.match_id }));
      }
      expectPhone('3', 'm1-late-fact', 'GHOST', c3.GHOST, finalPhone({ nm: 'GHOST', mode: 'tdm', winBy: 'KILLS', winner: 'red', myTeam: 'blue', updated: false, own: LF.GHOST,
        teams: teamsF, body: flipped, track: SYNCED, matchId: m1.match_id }));
      identical('3', Object.fromEntries(KEEP.map(n => [n, fr(results(n, t3).at(-1))]).filter(([, f]) => f)), 'flipped result', ['GHOST']);
      if (want('6')) {
        check('6', flipped?.rows?.find(r => r.player_id === P.NOMAD.player_id)?.team_id === 'red' && sameJson(flipped?.winner, { team_id: 'red' }),
          'the late fact counts for the original teams (red, with NOMAD)', { winner: flipped?.winner });
        check('6', KEEP.every(nm => c3[nm].teams.some(t => t.rows.some(r => r[0] === 'REAPERX'))), 'the rename shows on every phone after the late fact');
        check('6', ['REAPER', 'NOMAD'].every(nm => phones[nm].frames.filter(f => f.dir === 'in' && f.kind === 'assign' && f.at >= t6).every(f => f.body?.recap === true)),
          'every assign to the edited phones since the edit, the late fact included, carries recap:true');
        check('6', ['REAPER', 'NOMAD'].every(nm => c3[nm].engine.ended === true && c3[nm].engine.matchId === m1.match_id), 'the edited phones still hold this match after the late fact');
      }
      for (const nm of ONLINE) hist[nm][hist[nm].length - 1] = { ...LF[nm] };
      hist.GHOST.push({ ...LF.GHOST });

      if (want('3b')) {
        // ---------- case 3b: synced VIPER drops and rejoins with an empty queue ----------
        await phones.VIPER.pg.evaluate(() => window.brx.engine.ackEnd()); await until(async () => (await engOf('VIPER')).endAck === true, 5000, 'VIPER acked');
        const t3b = Date.now();
        await goOffline('VIPER'); await goOnline('VIPER');
        await until(() => phones.VIPER.frames.some(f => f.dir === 'in' && f.kind === 'welcome' && f.at >= t3b), 30000, 'VIPER welcome');
        await settle(KEEP, Date.now(), 'rejoin');
        const c3b = await checkpoint('m1-rejoin');
        const wv = phones.VIPER.frames.filter(f => f.dir === 'in' && f.kind === 'welcome' && f.at >= t3b);
        check('3b', wv.some(f => welcomeResult(f)), 'm1-rejoin: the result is in the rejoin welcome (body.node.result)', wv.map(f => Object.keys(f.body?.node || {})));
        check('3b', wv.filter(f => welcomeResult(f)).every(f => welcomeResult(f).provisional === false && sameJson(welcomeResult(f).winner, { team_id: 'red' }) && welcomeResult(f).match_id === m1.match_id),
          'm1-rejoin: the welcome result is final, red, this match', wv.map(f => [welcomeResult(f)?.winner, welcomeResult(f)?.match_id, welcomeResult(f)?.provisional]));
        for (const nm of KEEP) check('3b', results(nm, t3b).length === 0, `m1-rejoin: ${nm} no result frame`, results(nm, t3b).length);
        expectPhone('3b', 'm1-rejoin', 'VIPER', c3b.VIPER, closedPhone({ phase: 'kitted', ended: true, endAck: true, matchId: m1.match_id, outcome: 'lose', winner: { team_id: 'red' }, provisional: false, _updated: true }));
        for (const nm of ['REAPER', 'NOMAD']) expectPhone('3b', 'm1-rejoin', nm, c3b[nm], finalPhone({ nm, mode: 'tdm', winBy: 'KILLS', winner: 'red', myTeam: 'red', updated: true, own: LF[nm],
          teams: teamsF, body: results(nm).at(-1).body, track: SYNCED, matchId: m1.match_id }));
        expectPhone('3b', 'm1-rejoin', 'GHOST', c3b.GHOST, finalPhone({ nm: 'GHOST', mode: 'tdm', winBy: 'KILLS', winner: 'red', myTeam: 'blue', updated: false, own: LF.GHOST,
          teams: teamsF, body: flipped, track: SYNCED, matchId: m1.match_id }));
        expectConsole('3b', 'm1-rejoin', c3b.console, { status: 'MATCH COMPLETE', pending: null, waiting: null, releaseIn: null, finalWithout: null, resultChanged: 'RESULT CHANGED' });
      }
    } else {
      hist.GHOST.push({ ...L.GHOST });
    }
  }

  // ================= case 7: NEXT MATCH on the console leaves the result =================
  async function nextMatchFromConsole(cse, tag, matchId) {
    if ((await st()).recap?.sync?.pending) await api('POST', '/api/recap/finalise', {});
    if ((await engOf('GHOST')).wsState !== 'bound') {   // ONLY=7: GHOST is still offline from case 2; let it deliver first
      const tg = Date.now(); await goOnline('GHOST');
      await until(async () => (await engOf('GHOST')).winner, 30000, 'GHOST result');
      await settle(KEEP, tg, 'GHOST back before NEXT MATCH');
    }
    const t7 = Date.now();
    await con.goto(MC + '/');
    const nb = con.locator('[data-testid="recap-next-match"] button, button[data-testid="recap-next-match"]').first();
    await nb.click();
    const conf = con.locator('button:has-text("CONFIRM")');
    await until(async () => (await st()).phase !== 'recap' || (await conf.count()) > 0, 10000, 'NEXT MATCH confirm or phase change');
    if ((await st()).phase === 'recap' && await conf.count()) await conf.first().click();
    await until(async () => (await st()).phase !== 'recap', 10000, 'MC left the recap');
    await until(async () => (await Promise.all(KEEP.map(snapPhone))).every(s => s.screen === 'setup'), 20000, 'every phone on the setting-up screen');
    await settle(KEEP, Date.now(), 'next match');
    const c7 = await checkpoint(tag);
    check(cse, c7.console.status === null && c7.console.pending === null && c7.console.finalWithout === null, `${tag}: the console left the recap`, c7.console);
    for (const nm of KEEP) {
      const a = phones[nm].frames.filter(f => f.dir === 'in' && f.kind === 'assign' && f.at >= t7);
      check(cse, a.length > 0 && a.every(f => !('recap' in (f.body || {}))), `${tag}: ${nm} every re-assign carries no recap flag`, a.map(f => f.body?.recap));
      check(cse, results(nm, t7).length === 0, `${tag}: ${nm} no result frame`, results(nm, t7).length);
      const d = fieldDiff(c7[nm], { screen: 'setup', resultVisible: false, headline: null, meta: null, teams: [], tiles: null, honours: null, track: null, setupText: 'HOST IS SETTING UP THE GAME',
        engine: { phase: 'kitted', ended: false, endAck: false, matchId: null, outcome: null, winner: null, provisional: null, _updated: null } });
      check(cse, Object.keys(d).length === 0, `${tag}: ${nm} left the result (${matchId}) and shows HOST IS SETTING UP THE GAME`, d);
    }
  }
  if (ONLY === '7') await nextMatchFromConsole('7', 'next-match', m1.match_id);

  // ================= MATCH 2 · KOTH, the hill offline at the whistle: case 5 =================
  if (want('5')) {
    if (!ONLY) {
      // between the matches: NEXT over the API (case 7 drives the console button after this match)
      if ((await engOf('GHOST')).wsState !== 'bound') await goOnline('GHOST');
      await api('POST', '/api/match/next', {});
      await until(async () => (await Promise.all(KEEP.map(snapPhone))).every(s => s.screen === 'setup'), 20000, 'every phone on the setting-up screen');
    }
    const hill = await mkPage({ width: 411, height: 891 });
    hill.on('pageerror', e => log('pageerror hill', String(e.message).slice(0, 200)));
    const hillRec = { frames: [] }; wsTap(hillRec, hill);
    await hill.goto(`${HUD}/utility.html?mc=${encodeURIComponent(QR)}`);
    const stn = await until(async () => (await api('GET', '/api/stations')).stations?.[0], 20000, 'station hello');
    const ps = await api('PUT', `/api/stations/${stn.node_id}`, { kind: 'control' }); log('station put', ps.assigned || ps.error || ps);
    let cfg = await api('PUT', '/api/config', { mode: 'koth', time_limit_s: TL_KOTH, respawn: { type: 'auto', delay_s: 3 } });
    if (!cfg.ok || cfg.config?.mode !== 'koth') { await api('POST', '/api/play/pick', { pieces: { mode: 'builtin:mode:koth' } }); cfg = await api('PUT', '/api/config', { time_limit_s: TL_KOTH }); }
    if (cfg.config?.mode !== 'koth') throw new Error(`KOTH config refused: ${JSON.stringify(cfg).slice(0, 400)}`);
    S = await st();
    const team2 = Object.fromEntries(S.players.map(p => [p.display === 'REAPERX' ? 'REAPER' : p.display, p.team_id]));
    const m2 = await setupMatch('M2 KOTH');
    const m2end = m2.go_live_t + TL_KOTH * 1000;
    const hsnap = async (tag) => {
      const p = await hill.evaluate(() => { const d = window.brx.diag().point; const s = window.brx.settings; return { counts: d.counts, holdMs: d.holdMs, startsAt: s.hillStartsAt, game: s.game }; });
      return { tag, at: Date.now(), toWhistle_s: +((m2end - Date.now()) / 1000).toFixed(1), ...p };
    };
    const red = (e) => (e?.holdMs || {})[TID.red] ?? (e?.holdMs || {})[String(TID.red)] ?? 0;
    await until(async () => { const h = await hsnap('start'); return h.startsAt != null && Date.now() >= h.startsAt; }, 20000, 'the hill counting');
    await hill.evaluate(([num, tid]) => { const b = window.brx; window.__pres = setInterval(() => b.onSighting([b.encodeUuid({ role: 'player', id: num, kind: 0, team: tid, state: 1, value: 0, seq: 0, game: b.settings.game })], -45), 250); }, [P.REAPER.player_num, TID.red]);
    await until(async () => red(await hsnap('holding')) >= 3000, 40000, 'red holding the hill for 3 s');
    await hill.evaluate(() => clearInterval(window.__pres));
    const tStop = Date.now();
    // quiet: no one in the circle, and two status beats in a row carry the same final tally
    const quietBeats = () => hillRec.frames.filter(f => f.dir === 'out' && f.kind === 'status' && f.at >= tStop && f.body?.control && Object.keys(f.body.control.counts || {}).length === 0);
    await until(() => { const b = quietBeats(); return b.length >= 2 && sameJson(b.at(-1).body.control.hold_ms, b.at(-2).body.control.hold_ms); }, 30000, 'the hill quiet, its tally reported twice');
    const hOff = await hsnap('pre-offline');
    check('5', red(hOff) > 0 && sameJson(quietBeats().at(-1).body.control.hold_ms, hOff.holdMs) && Object.keys(hOff.counts || {}).length === 0,
      'presence gone and the hold frozen and reported before the hill goes offline', { hill: hOff.holdMs, beat: quietBeats().at(-1).body.control.hold_ms });
    check('5', hOff.toWhistle_s > 10, 'the hill goes offline well before the whistle', hOff.toWhistle_s);
    await hill.context().setOffline(true); await hill.evaluate(() => window.brx.transport?.dropLink?.());
    const tOff = Date.now(); log('hill offline', { red_ms: red(hOff), toWhistle_s: hOff.toWhistle_s });
    const wh2 = await waitRecap(TL_KOTH * 1000 + 30000); log('M2 recap phase');
    await con.goto(MC + '/');
    await until(async () => (await snapCon()).releaseIn && (await Promise.all(KEEP.map(snapPhone))).every(s => s.track?.stage === 'received'), STUCK_S * 1000, 'console countdown and every phone synced');
    await consoleWaitsFor(['CONTROL POINT 1'], 'CONTROL POINT 1');
    const c5a = await checkpoint('m2-waiting'); const hW = await hsnap('waiting');
    const rel2s = releaseInS(c5a.console);
    expectConsole('5', 'm2-waiting', c5a.console, CON_WAIT('CONTROL POINT 1'));
    check('5', rel2s != null && rel2s >= 1 && rel2s <= STUCK_S, `m2-waiting: FINAL IN counts from the test bound (${STUCK_S} s)`, c5a.console.releaseIn);
    const KOTH_MCV = 'A WIN IS CONFIRMED AT MISSION CONTROL · RETURN AFTER THE WHISTLE';
    for (const nm of KEEP) {
      check('5', results(nm, wh2).length === 0, `m2-waiting: ${nm} no result while MC waits for the hill`, results(nm, wh2).length);
      expectPhone('5', 'm2-waiting', nm, c5a[nm], pendingPhone({ mode: 'koth', own: L0[nm], track: SYNCED, matchId: m2.match_id, mcv: KOTH_MCV,
        sess: sessLine(nm, { [nm]: [...hist[nm], L0[nm]] }) }));
    }
    await until(() => results('REAPER', wh2).length > 0, (STUCK_S + 20) * 1000, 'the bounded release (KOTH)');
    const rel2 = Date.now(); const rel2After = (rel2 - wh2) / 1000;
    check('5', rel2After >= STUCK_S - 1.5 && rel2After <= STUCK_S + 8, `the KOTH release comes ${STUCK_S} s (the test bound) after the whistle`, rel2After.toFixed(1));
    await until(async () => (await snapCon()).finalWithout && (await Promise.all(KEEP.map(snapPhone))).every(s => s.resultVisible), 15000, 'release on the console and the phones');
    await settle(KEEP, rel2, 'koth release');
    const c5b = await checkpoint('m2-released'); const hRel = await hsnap('released');
    expectConsole('5', 'm2-released', c5b.console, { status: 'MATCH COMPLETE', pending: null, waiting: null, releaseIn: null,
      finalWithout: `${finalLead} WITHOUT 1 HILL (CONTROL POINT 1)`, releasedBy: 'timeout', resultChanged: null });
    const f5 = Object.fromEntries(KEEP.map(n => [n, fr(results(n, wh2)[0])]));
    identical('5', f5, 'koth released result');
    const relRed = f5.REAPER?.body?.possession?.by_team?.red;
    check('5', relRed != null && Math.abs(relRed - red(hOff) / 1000) <= 1, 'the released red hold matches the hill tally before it went offline', { released_s: relRed, hill_ms: red(hOff) });
    const heldTxt = (id) => c5b.REAPER.teams.find(t => t.name === TEAM_NAME[id])?.held;
    check('5', mmssToS(heldTxt('red')) != null && Math.abs(mmssToS(heldTxt('red')) - red(hOff) / 1000) <= 1 && heldTxt('blue') === '00:00', 'the HELD times show the hill tally', { red: heldTxt('red'), blue: heldTxt('blue') });
    const kothTeams = ['red', 'blue'].map(id => ({ id, score: 0, held: id === 'red' ? heldTxt('red') : '00:00', members: KEEP.filter(n => team2[n] === id).map(n => [disp(n), 0, 0, 0]) }));
    for (const nm of KEEP) {
      check('5', results(nm, wh2).length === 1, `m2-released: ${nm} exactly one result frame`, results(nm, wh2).length);
      expectPhone('5', 'm2-released', nm, c5b[nm], finalPhone({ nm, mode: 'koth', winBy: 'OBJECTIVE', winner: 'red', myTeam: team2[nm], updated: false, own: L0[nm],
        held: team2[nm] === 'red' ? heldTxt('red') : '00:00', teams: kothTeams, body: f5[nm].body, track: SYNCED, matchId: m2.match_id, sess: sessLine(nm, { [nm]: [...hist[nm], L0[nm]] }) }));
    }
    const t5 = Date.now(); await hill.context().setOffline(false); log('hill back online');
    await until(() => hillRec.frames.some(f => f.dir === 'in' && f.kind === 'welcome' && f.at >= t5), 30000, 'the hill welcome');
    await until(() => hillRec.frames.filter(f => f.dir === 'out' && f.kind === 'status' && f.at >= t5).length >= 2, 15000, 'two hill beats after it returns');
    await settle(KEEP, Date.now(), 'hill back');
    const c5c = await checkpoint('m2-hill-back'); const hBack = await hsnap('hill-back');
    check('5', [hW, hRel, hBack].every(h => sameJson(h.holdMs, hOff.holdMs)), 'no hold accrued on the hill after it went offline, across the whistle and its return',
      [hOff, hW, hRel, hBack].map(h => [h.tag, h.holdMs]));
    const st5 = hillRec.frames.filter(f => f.dir === 'out' && f.kind === 'status' && f.at >= t5);
    check('5', st5.every(f => sameJson(f.body?.control?.hold_ms, hOff.holdMs)), 'the returning hill reports the same tally', st5.map(f => f.body?.control?.hold_ms));
    expectConsole('5', 'm2-hill-back', c5c.console, { status: 'MATCH COMPLETE', pending: null, waiting: null, releaseIn: null, resultChanged: null });
    for (const nm of KEEP) {
      check('5', results(nm, t5).length === 0, `m2-hill-back: ${nm} no second result frame when the hill returns`, results(nm, t5).map(f => f.body?.possession?.by_team));
      for (const k of ['screen', 'resultVisible', 'headline', 'meta', 'teams', 'tiles', 'honours', 'track', 'mcv', 'sess', 'engine'])
        check('5', sameJson(c5c[nm][k], c5b[nm][k]), `m2-hill-back: ${nm} ${k} unchanged`, { released: c5b[nm][k], after: c5c[nm][k] });
    }
    log('hill', { tOff, wh2, t5, red_ms: red(hOff) });
    if (!ONLY) await nextMatchFromConsole('7', 'next-match', m2.match_id);
  }
} catch (e) {
  failed = true;
  log('ABORT', String(e?.stack || e));
} finally {
  await stopAll();
}
const bad = checks.filter(c => !c.ok);
const byCase = {}; for (const c of checks) byCase[c.cse] = (byCase[c.cse] || 'PASS') === 'FAIL' || !c.ok ? 'FAIL' : 'PASS';
for (const c of CASES.filter(want)) if (!byCase[c]) { byCase[c] = 'NOT RUN'; failed = true; }
log('VERDICTS', byCase, `${checks.length - bad.length}/${checks.length} checks`, `output ${OUT}`);
if (bad.length) { console.log('\nFAILED:'); for (const c of bad) console.log(`  [${c.cse}] ${c.what} :: ${JSON.stringify(c.extra).slice(0, 600)}`); }
process.exit(failed || bad.length ? 1 : 0);
