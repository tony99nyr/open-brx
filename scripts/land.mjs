#!/usr/bin/env node
// land.mjs: the land lane. Agents stop pushing to main; they submit a branch, and ONE lander at a time merges a
// batch of submitted branches onto main, gates the batch once, and pushes it fast-forward only.
//
//   node scripts/land.mjs submit --owner <name> [--note <text>] [--remote origin]
//   node scripts/land.mjs run [--batch 4] [--dry-run] [--remote origin]
//   node scripts/land.mjs wait <id> [--timeout-min 60] [--remote origin]
//   node scripts/land.mjs status [id] [--no-drive] [--remote origin]
//   node scripts/land.mjs withdraw <id> --owner <name> [--remote origin]
//
// The flow, the results, conflicts, flakes and the emergency path are in scripts/README.md (the land lane).
// Tests: mcp/tests/test_land.py drives this script against a temporary bare remote with a stubbed gate.
//
// Refs on the remote: `land/<id>` is the queue (sorted by name, so by submit time); `land-failed/<id>` holds a branch
// that went red or conflicted. The lander deletes only `land/<id>` refs, and only after the branch is on main or
// has been copied to `land-failed/<id>`. It never force-pushes and never pushes anything to main but a fast-forward.
//
// Test-only switches (the guard below enforces them):
//   LAND_TEST=1          refuses any remote whose URL is not a local path (file:// or absolute);
//   LAND_GATE_STUB=<json command prefix>   replaces `node scripts/test-all.mjs`; refused unless LAND_TEST=1;
//   LAND_GIT_TIMEOUT_MS=<ms>   the ceiling on a network git call (default 600000); LAND_GIT_DETACH=0 (only with
//     LAND_TEST=1) runs network git in the foreground group, the path a terminal run takes;
//   LAND_INSTALL_STUB=<json command prefix>   runs before `npm ci` (which it gets as arguments); same rule.
// Plain overrides (safe anywhere): LAND_STATE_DIR (default /tmp/brx-land), LAND_LOCK_DIR, LAND_POLL_MS.
import { execFile, execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGate } from './lib/land-gate.mjs';
import { entryPid, isStale, pidAlive } from './lib/lock.mjs';
import { reapByEnv, reapByEnvSync } from './lib/reap.mjs';
import { isDocsOnly } from './lib/changed.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0];
const VALUED = new Set(['--owner', '--note', '--remote', '--batch', '--timeout-min']);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const flag = name => argv.includes(name);
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && VALUED.has(all[i - 1])));

const TEST = process.env.LAND_TEST === '1';
const STUB = process.env.LAND_GATE_STUB || '';
const INSTALL_STUB = process.env.LAND_INSTALL_STUB || '';
const STATE = path.resolve(process.env.LAND_STATE_DIR || '/tmp/brx-land');   // absolute: git and children run elsewhere
const LOCK = path.resolve(process.env.LAND_LOCK_DIR || path.join('/tmp', `brx-land-${os.userInfo().uid}.lock`));
const POLL_MS = Number(process.env.LAND_POLL_MS || 10_000);
const REMOTE = opt('--remote', 'origin');
// The scratch worktree the candidate is built in: one per lock entry (`wt-<entry>`), so a lander that lost the lock
// (a suspended laptop, then another lander took over) can never build in the same tree as its successor.
let WT = null;
const FLAKES = path.join(STATE, 'flakes.jsonl');
const LAND = `refs/remotes/${REMOTE}/land/`;
const FAILED = `refs/remotes/${REMOTE}/land-failed/`;
const MAIN = `refs/remotes/${REMOTE}/main`;

// Exit codes. `wait` uses 0-3 for its answer and 6 for withdrawn; everything else is 4 (refused) or 5 (error).
const EXIT = { landed: 0, red: 1, conflict: 2, timeout: 3, refused: 4, error: 5, withdrawn: 6 };

const die = (msg, code = EXIT.refused) => { console.error(`land: ${msg}`); process.exit(code); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ROOT;
try { ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
catch { die('run this inside a git checkout'); }
// The repository's shared git dir. Repository-level git (fetch, push, refs, merge-tree, worktree add/remove) runs from
// here, not from ROOT: ROOT is just the checkout this command was started in, and a lander outlives it. On 2026-10-10 a
// lander started from a worktree that was later removed lost a whole green batch, because its next git call had no
// directory to run in. Only `submit`, which reads the person's own branch, uses ROOT.
const GIT_DIR = fs.realpathSync(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim());
const HERE = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
// OP7 (2026-10-10 review): a hung NETWORK git (a stalled fetch, push or ls-remote) held the lander lock for ever. Those
// calls now have a ceiling (LAND_GIT_TIMEOUT_MS, default 600 s). Local git (merge, merge-tree, worktree) has none: it
// cannot hang on a remote, and a merge that read as a timeout would be booked as a content conflict (Codex review).
// Network git runs in its own process group, and a timeout kills the whole group: killing git alone left its ssh or
// credential-helper child holding the output pipe open, so the call still never returned.
const GIT_TIMEOUT_MS = Number(process.env.LAND_GIT_TIMEOUT_MS) || 600_000;
const NETWORK_GIT = new Set(['fetch', 'push', 'ls-remote', 'pull', 'clone']);
// Detach only without a terminal (the lander, agents): setsid() takes ssh's /dev/tty away, so a person whose key has
// a passphrase, or who meets a new host, could no longer submit (Opus review). With a terminal the call stays in the
// foreground group, where Ctrl-C reaches it anyway.
// "A terminal" is a controlling tty (what ssh opens), not stdin: a terminal run with </dev/null still has one.
const hasControllingTty = () => { try { fs.closeSync(fs.openSync('/dev/tty', 'r')); return true; } catch { return false; } };
// LAND_GIT_DETACH=0 (test-only, with LAND_TEST=1) forces the terminal path, which tests otherwise never have.
const DETACH_GIT = process.platform !== 'win32' && !hasControllingTty() && !(process.env.LAND_TEST === '1' && process.env.LAND_GIT_DETACH === '0');
const liveNetGit = new Set();   // every live network git child: killed with the lander, so none outlives it
const GIT_KILL_GRACE_MS = 5_000;
/** SIGTERM the group first, so git removes its *.lock files; SIGKILL whatever is left after the grace. */
function killGit(child) {
  const sig = s => { try { if (DETACH_GIT) process.kill(-child.pid, s); else child.kill(s); } catch { /* gone */ } };
  sig('SIGTERM');
  const t = setTimeout(() => sig('SIGKILL'), GIT_KILL_GRACE_MS);
  t.unref?.();
}
/** Synchronous, for the exit and signal handlers: every live detached network git, TERM then KILL. */
function killLiveNetGit() {
  if (!liveNetGit.size) return;
  const target = c => (DETACH_GIT ? -c.pid : c.pid);
  for (const child of liveNetGit) { try { process.kill(target(child), 'SIGTERM'); } catch { /* gone */ } }
  const tick = new Int32Array(new SharedArrayBuffer(4));
  for (let w = 0; w < 2000 && [...liveNetGit].some(c => { try { process.kill(target(c), 0); return true; } catch { return false; } }); w += 100) Atomics.wait(tick, 0, 0, 100);
  for (const child of liveNetGit) { try { process.kill(target(child), 'SIGKILL'); } catch { /* gone */ } }
}
/** git with an argument array, never a shell string. Rejects on a non-zero exit unless `ok` (then read `.code`). */
function git(args, { cwd = GIT_DIR, ok = false } = {}) {
  const network = NETWORK_GIT.has(args[0]);
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'], detached: network && DETACH_GIT });
    if (network) liveNetGit.add(child);
    let out = '', err = '', timedOut = false;
    child.stdout.setEncoding('utf8').on('data', d => { out += d; });
    child.stderr.setEncoding('utf8').on('data', d => { err += d; });
    let settled = false;
    const finish = code => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      liveNetGit.delete(child);
      const why = timedOut ? `timed out after ${GIT_TIMEOUT_MS / 1000}s (LAND_GIT_TIMEOUT_MS)` : err.trim();
      const status = timedOut ? 124 : (code ?? 1);
      if (status !== 0 && !ok) { reject(new Error(`git ${args.join(' ')}: ${why || `exit ${status}`}`)); return; }
      resolve({ code: status, out: out.trim(), err: why });
    };
    // On a timeout, stop waiting for the pipes: a surviving ssh child can hold them open, so `close` might never come.
    const timer = network ? setTimeout(() => {
      timedOut = true;
      killGit(child);
      child.stdout.destroy(); child.stderr.destroy();
      child.once('exit', () => finish(124));
    }, GIT_TIMEOUT_MS) : null;
    child.on('error', e => { err = e.message; finish(1); });
    child.on('close', code => finish(code));
  });
}
const gitOut = async (args, o) => (await git(args, o)).out;
const lines = s => s.split('\n').map(l => l.trim()).filter(Boolean);
/** A7 (2026-10-10 review): state another process reads (withdraw reads active-batch.json while a lander writes it)
 *  is written to a temp file and renamed, so a reader sees the old file or the new one, never a torn one. */
function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// ---- the guard ---------------------------------------------------------------------------------------------------
const isLocalUrl = u => u.startsWith('file://') || path.isAbsolute(u);
// `git merge-tree --write-tree` (the conflict check) needs git 2.38 or later. Apple's git on a Mac can be older.
const GIT_MIN = [2, 38];
const FAKE_GIT_VERSION = process.env.LAND_FAKE_GIT_VERSION || '';   // test-only: refused unless LAND_TEST=1
async function checkGitVersion() {
  if (FAKE_GIT_VERSION && !TEST) die('LAND_FAKE_GIT_VERSION is test-only: it is refused unless LAND_TEST=1');
  const raw = FAKE_GIT_VERSION || (await git(['--version'], { ok: true })).out;
  const m = /(\d+)\.(\d+)/.exec(raw);
  const ok = m && (Number(m[1]) > GIT_MIN[0] || (Number(m[1]) === GIT_MIN[0] && Number(m[2]) >= GIT_MIN[1]));
  if (!ok) die(`git ${GIT_MIN.join('.')} or later is needed (found "${raw.trim() || 'no git'}"). On a Mac: `
    + '`brew install git`, then check that `which git` is /opt/homebrew/bin/git (or /usr/local/bin/git).');
}
async function guard() {
  await checkGitVersion();
  if (STUB && !TEST) die('LAND_GATE_STUB is test-only: it is refused unless LAND_TEST=1');
  if (INSTALL_STUB && !TEST) die('LAND_INSTALL_STUB is test-only: it is refused unless LAND_TEST=1');
  const url = await git(['remote', 'get-url', REMOTE], { ok: true });
  if (url.code !== 0) die(`no remote named ${REMOTE}`);
  const push = await git(['remote', 'get-url', '--push', REMOTE], { ok: true });
  for (const u of [url.out, push.out]) {
    if (u && !u.includes(':') && !path.isAbsolute(u)) die(`the remote ${REMOTE} is a relative path (${u}); the lander runs git from the shared git dir, so give it an absolute path: git remote set-url ${REMOTE} <absolute path>`);
  }
  if (!TEST) return;
  for (const u of [url.out, push.out]) {
    if (!isLocalUrl(u)) die(`LAND_TEST=1 refuses the non-local remote ${REMOTE} (${u}): tests run against a local bare repo only`);
  }
}

// ---- the remote --------------------------------------------------------------------------------------------------
/** Explicit refspecs, so the queue works whatever the clone's fetch config says. `+` updates remote-TRACKING refs
 *  (what every fetch does); nothing here writes the remote. */
const fetchRemote = (o = {}) => git(['fetch', '-q', '--prune', REMOTE,
  `+refs/heads/main:${MAIN}`, `+refs/heads/land/*:${LAND}*`, `+refs/heads/land-failed/*:${FAILED}*`], o);
const refIds = async prefix => lines(await gitOut(['for-each-ref', '--format=%(refname)', prefix])).map(r => r.slice(prefix.length)).sort();
/** The shape `submit` writes: `<UTC yyyymmddHHMMSS>-<owner>-<slug>`. A land/ ref of any other shape was pushed by hand:
 *  the lander reports it and never lands it (it could not delete it afterwards either). */
const ID_RE = /^\d{14}-[a-z0-9_]+-[a-z0-9-]+$/;
const queue = async () => (await refIds(LAND)).filter(id => ID_RE.test(id));
const malformed = async () => (await refIds(LAND)).filter(id => !ID_RE.test(id));
const revParse = async ref => (await git(['rev-parse', '--verify', '-q', ref], { ok: true })).out || null;
const isAncestor = async (a, b) => (await git(['merge-base', '--is-ancestor', a, b], { ok: true })).code === 0;
/** The only refs this script ever deletes on the remote. */
function deleteLandRef(id) {
  if (!ID_RE.test(id)) throw new Error(`refusing to delete a ref with an unexpected name: land/${id}`);
  return git(['push', '-q', REMOTE, '--delete', `refs/heads/land/${id}`], { ok: true });
}

// ---- results and flakes ------------------------------------------------------------------------------------------
const resultPath = id => path.join(STATE, `${id}.json`);
const ownerOf = id => id.split('-')[1] || null;
const runResults = [];   // this run's results, for the summary
function writeResult(r) {
  fs.mkdirSync(STATE, { recursive: true });
  const previous = readResult(r.id);
  if (r.status === 'withdrawn' && ['landed', 'red', 'conflict'].includes(previous?.status)) {
    throw new LandError(`${r.id} is already ${previous.status}; refusing to replace its result`);
  }
  const full = { id: r.id, owner: ownerOf(r.id), ...r, time: new Date().toISOString() };
  writeJsonAtomic(resultPath(r.id), full);
  runResults.push(full);
}
function readResult(id) {
  try { return JSON.parse(fs.readFileSync(resultPath(id), 'utf8')); } catch { return null; }
}
// The last lander run on this machine that stopped because main is red on its own. Not a `.json` (status lists
// those as results). `wait` reads it so it neither reports a stop as nothing nor starts another full gate on the same
// red main; a new main sha (the fix) makes it stale.
const MAIN_RED = path.join(STATE, 'main-red');
const ACTIVE_BATCH = path.join(STATE, 'active-batch.json');
// A `withdraw` made while a lander runs leaves `withdrawn/<id>` here. The two sides use a write-then-check handshake:
// the lander writes ACTIVE_BATCH and THEN drops any marked id; withdraw writes the marker and THEN refuses an id in a
// live ACTIVE_BATCH. One side always sees the other, so a withdrawn id is never gated. Markers stay (ids are never
// reused), so a lander that fetched before the ref was deleted still skips it.
const WITHDRAWN = path.join(STATE, 'withdrawn');
const withdrawnMarked = id => fs.existsSync(path.join(WITHDRAWN, id));
function readMainRed() {
  try { return JSON.parse(fs.readFileSync(MAIN_RED, 'utf8')); } catch { return null; }
}
const runFlakes = [];
function recordFlake(f) {
  fs.mkdirSync(STATE, { recursive: true });
  const row = { ...f, time: new Date().toISOString() };
  fs.appendFileSync(FLAKES, `${JSON.stringify(row)}\n`);
  runFlakes.push(row);
}
function flakeSummary() {
  let rows = [];
  try { rows = lines(fs.readFileSync(FLAKES, 'utf8')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { /* no flakes yet */ }
  const since = Date.now() - 7 * 86_400_000;
  // An incident row ({"incident": {"from", "to", "note"}}) marks a window when the MACHINE failed, not the tests
  // (2026-10-04: WSL's 4915-task cgroup cap; every rerun then failed too). Flakes inside it stay in the file as
  // evidence but leave the counts, so they cannot hide or fake a recurring job.
  const incidents = rows.filter(r => r.incident).map(r => ({ from: Date.parse(r.incident.from), to: Date.parse(r.incident.to), note: r.incident.note }));
  const inIncident = f => incidents.some(i => Date.parse(f.time) >= i.from && Date.parse(f.time) <= i.to);
  const recent = rows.filter(f => f.job && Date.parse(f.time) >= since);
  const excluded = recent.filter(inIncident);
  const count = list => list.reduce((m, f) => m.set(f.job, (m.get(f.job) || 0) + 1), new Map());
  const fmt = m => (m.size ? [...m].sort((a, b) => b[1] - a[1]).map(([j, n]) => `${j} x${n}`).join(', ') : 'none');
  const note = excluded.length ? `; ${excluded.length} excluded as incident noise (${[...new Set(incidents.map(i => i.note))].join('; ')})` : '';
  return `flakes this run: ${fmt(count(runFlakes))}; last 7 days: ${fmt(count(recent.filter(f => !inIncident(f))))}${note}`
    + ' (a job that keeps coming back here is a FOLLOWUPS row)';
}

// ---- the lander lock ---------------------------------------------------------------------------------------------
// Entries are named like test-all's (`<start ms>-<pid>-<rand>`) and share scripts/lib/lock.mjs's stale rules: a dead
// pid is reclaimed after 10 s, a live but silent one after 60 s without a heartbeat. The first LIVE entry by
// name holds the lock. Unlike test-all, a lander never queues: if another lander holds the lock, the queue is already
// being served. One difference: this compares an entry's mtime with the wall clock, because a one-shot check (from
// `wait` or `status`) has no earlier sighting to measure a monotonic idle time from.
let MINE = null;
let beat = null;
function liveEntries(reap) {
  let names = [];
  try { names = fs.readdirSync(LOCK).sort(); } catch { return []; }
  const now = Date.now(), live = [];
  for (const name of names) {
    if (name === MINE) { live.push(name); continue; }
    let mtime;
    try { mtime = fs.statSync(path.join(LOCK, name)).mtimeMs; } catch { continue; }
    if (isStale(name, mtime, now)) { if (reap) fs.rmSync(path.join(LOCK, name), { force: true }); continue; }
    live.push(name);
  }
  return live;
}
function holder() {
  const first = liveEntries(false)[0];
  return first ? { pid: entryPid(first), since: new Date(Number(first.split('-')[0])).toISOString() } : null;
}
/** Remove a scratch worktree. Synchronous: release() also runs from the 'exit' handler. */
function removeWorktree(dir) {
  try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: GIT_DIR, stdio: 'ignore' }); } catch { /* not registered */ }
  fs.rmSync(dir, { recursive: true, force: true });
}
function release() {
  if (beat) clearInterval(beat);
  beat = null;
  if (WT) removeWorktree(WT);
  WT = null;
  if (MINE) fs.rmSync(path.join(LOCK, MINE), { force: true });
  MINE = null;
}
/** Take the lock if it is free or stale. False if a live lander holds it. Two landers that start together: each
 *  checks twice, half a second apart, that it is first, so an entry named earlier but written later is seen. */
async function acquire() {
  fs.mkdirSync(LOCK, { recursive: true });
  if (liveEntries(true).length) return false;
  MINE = `${String(Date.now()).padStart(15, '0')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(path.join(LOCK, MINE), '');
  for (let i = 0; i < 2; i++) {
    await sleep(500);
    if (liveEntries(true)[0] !== MINE) { release(); return false; }
  }
  beat = setInterval(() => { try { const t = new Date(); fs.utimesSync(path.join(LOCK, MINE), t, t); } catch { /* gone */ } }, 5000);
  // A crashed lander's worktree: its entry is no longer live, so nobody else can be using it.
  const live = new Set(liveEntries(false));
  let dirs = [];
  try { dirs = fs.readdirSync(STATE).filter(d => d.startsWith('wt-') && !live.has(d.slice(3))); } catch { /* no state yet */ }
  for (const d of dirs) removeWorktree(path.join(STATE, d));
  WT = path.join(STATE, `wt-${MINE}`);
  return true;
}
const stillHolder = () => MINE !== null && liveEntries(false)[0] === MINE;

// ---- the gate ----------------------------------------------------------------------------------------------------
let gateChild = null;
// Everything a gate starts carries this token (lib/reap.mjs): if test-all itself is killed hard, its jobs' detached
// MCs, vite servers and browsers are still found and stopped, here or after the gate returns.
const GATE_KEY = 'BRX_LAND_GATE';
const GATE_TOKEN = `${process.pid}-${Date.now()}`;
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.on(sig, () => {
    if (gateChild) { try { process.kill(-gateChild.pid, 'SIGTERM'); } catch { /* gone */ } }
    killLiveNetGit();   // a detached fetch or push must not outlive the lander (a push could land after the lock goes)
    reapByEnvSync(GATE_KEY, GATE_TOKEN, { waitMs: 3000 });   // test-all's own handler gets these 3 s first
    release();
    process.exit(code);
  });
}
process.on('exit', () => { killLiveNetGit(); release(); });

let gateRuns = 0;
const LOG_KEEP = 200;   // the newest logs kept in <state>/logs; older ones are deleted at each new run
/** One command in the candidate worktree. Its whole output goes to a log file; the lander prints a summary. */
function runLogged(cmd, cwd = WT) {
  const logDir = path.join(STATE, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  if (gateRuns === 0) {
    try { for (const f of fs.readdirSync(logDir).sort().slice(0, -LOG_KEEP)) fs.rmSync(path.join(logDir, f), { force: true }); }
    catch { /* nothing to prune */ }
  }
  const log = path.join(logDir, `${new Date().toISOString().replace(/[-:.]/g, '')}-${process.pid}-${++gateRuns}.log`);
  return new Promise(resolve => {
    let out = '';
    const child = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, [GATE_KEY]: GATE_TOKEN }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    gateChild = child;
    const take = d => { out += d; };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', e => { out += `\nspawn failed: ${e.message}\n`; });
    child.on('close', async code => {
      gateChild = null;
      const left = await reapByEnv(GATE_KEY, GATE_TOKEN);
      if (left.length) out += `\nland: the gate left ${left.length} process(es) behind; reaped: ${left.map(p => `${p.comm} ${p.pid}`).join(', ')}\n`;
      fs.writeFileSync(log, `$ ${cmd.join(' ')}\n${out}`);
      resolve({ code, out, log });
    });
  });
}
const runGate = args => runLogged(STUB ? [...JSON.parse(STUB), ...args] : ['node', 'scripts/test-all.mjs', ...args]);
const listJobs = out => lines(out).filter(l => /^[a-z][a-z0-9-]*$/.test(l));
/** The first failing test named in a job's log, when the log says (run_tests.py's `FAIL file::test`). A browser
 *  gate's log never says that -- it throws instead -- so falls back to the first line naming the actual error
 *  (an "Error:" line, or Playwright's own "closed" wording, e.g. "Target page, context or browser has been
 *  closed"), so flakes.jsonl still records SOMETHING to look at instead of `step: null` (2026-09-27, F429/F430:
 *  two OOM-killed browser jobs both logged a `step: null` flake). */
function stepOf(log) {
  let text;
  try { text = fs.readFileSync(log, 'utf8'); } catch { return null; }
  const fail = /^FAIL (\S+)/m.exec(text);
  if (fail) return fail[1];
  const line = /^.*(?:Error:|closed).*$/m.exec(text);
  return line ? line[0].trim() : null;
}

class LandError extends Error {
  constructor(msg, extra = {}) { super(msg); Object.assign(this, extra); }
}

/** Gate the candidate at WT once. Returns { green, failed: [{name, log}], log }. A failed job is rerun alone once:
 *  green on the rerun is a flake (recorded, and the gate counts as green). Throws LandError when the gate cannot be
 *  trusted either way (it ran a different number of jobs than --list named). */
async function gate(ids, useCache = true, base = null) {
  const sel = [useCache ? '--cache' : '--no-cache', '--ui'];
  let narrow = [];   // the same job selection for the gate, its --list and a build retry
  // E3 (2026-10-10): 21% of lands changed only docs, yet each paid for every job. A candidate whose diff from `base`
  // is docs only runs test-all's own --changed selection instead: the jobs that READ docs (mcp's docs hygiene and
  // guards, site's build and spec, app-test's announcer check), as scripts/lib/changed.mjs maps them. Anything else
  // in the diff keeps the full gate.
  if (base) {
    const paths = lines(await gitOut(['diff', '--no-renames', '--name-only', base, 'HEAD'], { cwd: WT }));
    if (isDocsOnly(paths)) {
      narrow = ['--changed', base];
      sel.push(...narrow);
      console.log(`land:   docs-only candidate (${paths.length} path(s)): gating the jobs that read docs`);
    }
  }
  const list = await runGate([...sel, '--list']);
  if (list.code !== 0) throw new LandError(`the gate's --list failed (exit ${list.code}); see ${list.log}`);
  const expected = listJobs(list.out).length;
  const g = await runGate(sel);
  const p = parseGate(g.out);
  let failed;
  if (p.build) failed = [{ name: p.build.name, log: p.build.log, kind: 'build' }];
  else {
    if (!p.rows.length) throw new LandError(`the gate printed no result table (exit ${g.code}); see ${g.log}`);
    if (p.rows.length !== expected) throw new LandError(`the gate ran ${p.rows.length} job(s), but --list named ${expected}; see ${g.log}`);
    failed = p.rows.filter(r => !r.ok).map(r => ({ name: r.name, log: p.logs[r.name] || g.log, kind: 'job' }));
    if (!failed.length) {
      if (g.code !== 0) throw new LandError(`every job passed but the gate exited ${g.code}; see ${g.log}`);
      return { green: true, failed: [], log: g.log };
    }
  }
  const still = [];
  for (const f of failed) {
    // A failed shared build has no job of its own to rerun: rerun the whole gate.
    const isBuild = p.build !== null;
    const r = await runGate(isBuild ? ['--no-cache', '--ui', ...narrow] : [f.name, '--no-cache', '--ui']);
    const rp = parseGate(r.out);
    const green = isBuild
      ? r.code === 0 && !rp.build && rp.rows.length === expected && rp.rows.every(x => x.ok)
      : r.code === 0 && rp.rows.length === 1 && rp.rows[0].name === f.name && rp.rows[0].ok;
    if (green) {
      recordFlake({ job: f.name, step: stepOf(f.log), branches: ids, log: f.log });
      console.log(`land:   ${f.name} failed, then passed alone: a flake (recorded in ${FLAKES})`);
    } else still.push(f);
  }
  return { green: still.length === 0, failed: still, log: g.log };
}

// ---- the candidate -----------------------------------------------------------------------------------------------
// The npm-locked packages (CLAUDE.md: npm, never pnpm, inside these). The repo root has no dependencies.
const NPM_DIRS = ['app', 'site', 'webapp/mc'];
const readOrNull = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const lstatOrNull = f => { try { return fs.lstatSync(f); } catch { return null; } };
/** Give each npm package in the candidate its dependencies. When its package.json and package-lock.json match the
 *  main checkout's, link the main checkout's node_modules (fast; the root .gitignore ignores a node_modules symlink, so
 *  --changed does not see it). When they differ, the batch changes dependencies: `npm ci` into a REAL node_modules in
 *  the scratch tree (the link is removed first, so the install can never write the main checkout's node_modules).
 *  A failed install fails the gate as a job named `install <dir>`, so the bisect finds the branch that broke it. */
async function prepareDeps() {
  const main = path.dirname(await gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir']));
  for (const d of NPM_DIRS) {
    const dir = path.join(WT, d);
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    const from = path.join(main, d, 'node_modules'), to = path.join(dir, 'node_modules');
    const mine = ['package.json', 'package-lock.json'].map(f => readOrNull(path.join(dir, f)) ?? '').join('\0');
    const same = mine === ['package.json', 'package-lock.json'].map(f => readOrNull(path.join(main, d, f)) ?? '').join('\0');
    const cur = lstatOrNull(to);
    const drop = () => { if (cur?.isSymbolicLink()) fs.unlinkSync(to); else if (cur) fs.rmSync(to, { recursive: true, force: true }); };
    if (same) {
      if (cur?.isSymbolicLink() || !fs.existsSync(from)) continue;
      drop();   // a real install from an earlier candidate in this run
      fs.symlinkSync(from, to);
      continue;
    }
    const marker = path.join(to, '.land-deps');
    if (cur && !cur.isSymbolicLink() && readOrNull(marker) === mine) continue;   // already installed for this lock
    drop();
    console.log(`land:   ${d}/ dependencies differ from the main checkout's: npm ci in the scratch tree`);
    const npm = ['npm', 'ci', '--no-audit', '--no-fund'];
    const r = await runLogged(INSTALL_STUB ? [...JSON.parse(INSTALL_STUB), ...npm] : npm, dir);
    if (r.code !== 0) return { ok: false, failed: [{ name: `install ${d}`, log: r.log, kind: 'install' }] };
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(marker, mine);
  }
  return { ok: true };
}
/** The scratch worktree at `base`, clean. Reused between batches of one run (it keeps its dependencies); recreated if
 *  it is missing or belongs to another repository. Not `git clean -x`: that would delete the dependencies too. */
async function resetWorktree(base) {
  const mine = await gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (fs.existsSync(WT)) {
    const theirs = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: WT, ok: true });
    if (theirs.code !== 0 || theirs.out !== mine) fs.rmSync(WT, { recursive: true, force: true });
  }
  if (!fs.existsSync(WT)) {
    fs.mkdirSync(STATE, { recursive: true });
    await git(['worktree', 'add', '-f', '-q', '--detach', WT, base]);
  } else {
    await git(['merge', '--abort'], { cwd: WT, ok: true });
    await git(['reset', '-q', '--hard'], { cwd: WT });
    await git(['checkout', '-q', '--detach', '-f', base], { cwd: WT });
    await git(['clean', '-fdq'], { cwd: WT });   // not -x: keep the ignored node_modules
  }
}
/** base + each branch in order, as --no-ff merge commits. A conflicting branch is aborted and left out. */
async function buildCandidate(base, ids, tips) {
  await resetWorktree(base);
  const merged = [], conflicts = [];
  for (const id of ids) {
    const r = await git(['merge', '--no-ff', '--no-edit', '-q', '-m', `Land ${id}`, tips[id]], { cwd: WT, ok: true });
    if (r.code === 0) { merged.push(id); continue; }
    const files = lines(await gitOut(['diff', '--name-only', '--diff-filter=U'], { cwd: WT }));
    await git(['merge', '--abort'], { cwd: WT, ok: true });
    conflicts.push({ id, files });
  }
  return { sha: await gitOut(['rev-parse', 'HEAD'], { cwd: WT }), merged, conflicts };
}

/** True if merging `b` into `a` conflicts (a merge in memory: no worktree, no ref). */
const mergeConflicts = async (a, b) => (await git(['merge-tree', '--write-tree', '--name-only', a, b], { ok: true })).code === 1;
/** What a conflicting branch conflicts with: `main`, else the first landed batch member it cannot merge with. */
async function conflictsWith(base, tip, accepted, tips) {
  if (await mergeConflicts(base, tip)) return 'main';
  for (const id of accepted) if (await mergeConflicts(tips[id], tip)) return id;
  return accepted.length ? 'the landed batch' : 'main';
}

/** Gate `ids` on `base`; on red, bisect. Each half is gated on top of what has already proven green, so a branch that
 *  breaks only in combination is still caught, and `acceptedSha` is always a candidate that passed a gate. */
async function settle(base, ids, tips) {
  let accepted = [], acceptedSha = null;
  const mainAlone = new Map();   // failed job names -> is main green for them on its own
  const red = [];
  let conflicts = [];
  /** Is main itself red for these jobs? Asked before a single branch is blamed while nothing has proven green yet, so
   *  a broken main is not blamed on every branch in turn. Runs only the failed jobs, not the whole suite. */
  const mainIsRed = async failed => {
    if (failed.some(f => f.kind === 'install')) return false;   // main's own dependencies are the linked ones
    const names = failed.map(f => f.name).sort();
    const key = names.join(' ');
    if (!mainAlone.has(key)) {
      await resetWorktree(base);
      await prepareDeps();
      let green;
      if (failed.some(f => f.kind === 'build')) green = (await gate([], false)).green;   // a build is not a job
      else {
        const r = await runGate([...names, '--no-cache', '--ui']);
        const p = parseGate(r.out);
        green = r.code === 0 && p.rows.length === names.length && p.rows.every(x => x.ok);
      }
      mainAlone.set(key, green);
    }
    return !mainAlone.get(key);
  };
  const attempt = async cands => {
    const c = await buildCandidate(base, [...accepted, ...cands], tips);
    for (const x of c.conflicts) {
      if (accepted.includes(x.id)) throw new LandError(`${x.id} merged before but conflicts on a rebuild`);
      conflicts.push(x);
    }
    const ok = cands.filter(id => c.merged.includes(id));
    if (!ok.length) return;
    console.log(`land: gating ${ok.join(', ')}${accepted.length ? ` on top of ${accepted.join(', ')}` : ''}`);
    const deps = await prepareDeps();
    const g = deps.ok ? await gate(ok, true, base) : { green: false, failed: deps.failed };
    if (g.green) { accepted = c.merged; acceptedSha = c.sha; return; }
    if (ok.length === 1) {
      if (!accepted.length && (await mainIsRed(g.failed))) {
        throw new LandError(`main (${base.slice(0, 10)}) is red on its own for ${g.failed.map(f => f.name).join(', ')}; fix main first (the emergency path)`, { mainRed: base });
      }
      red.push({ id: ok[0], failed: g.failed });
      return;
    }
    const mid = Math.ceil(ok.length / 2);
    await attempt(ok.slice(0, mid));
    await attempt(ok.slice(mid));
  };
  await attempt(ids);
  // A branch may have conflicted only with a batch member that then went red: retry each conflict once, on top of what
  // passed. What still conflicts is final, and the result says what it conflicts with.
  if (conflicts.length) {
    const retry = conflicts.map(x => x.id);
    conflicts = [];
    console.log(`land: retrying ${retry.join(', ')} on top of what passed`);
    await attempt(retry);
    for (const x of conflicts) x.with = await conflictsWith(base, tips[x.id], accepted, tips);
  }
  return { accepted, acceptedSha, red, conflicts };
}

async function markLanded(ids, sha, tips) {
  for (const id of ids) {
    if (!(await isAncestor(tips[id], sha))) throw new LandError(`${id} is not on the pushed main; not deleting it`);
    const d = await deleteLandRef(id);
    if (d.code !== 0) console.log(`land:   could not delete land/${id} (already gone?): ${d.err}`);
    writeResult({ id, status: 'landed', main_sha: sha });
    console.log(`land: landed ${id}`);
  }
}
async function markFailed(id, tip, result) {
  await fetchRemote();
  const mainNow = await revParse(MAIN);
  if (mainNow && (await isAncestor(tip, mainNow))) {
    console.log(`land: ${id} is already on main (another lander, or a direct push)`);
    await markLanded([id], mainNow, { [id]: tip });
    return;
  }
  const p = await git(['push', '-q', REMOTE, `${tip}:refs/heads/land-failed/${id}`], { ok: true });
  if (p.code === 0) {
    const d = await deleteLandRef(id);
    if (d.code !== 0) console.log(`land:   could not delete land/${id}: ${d.err}`);
  } else console.log(`land:   could not create land-failed/${id}, so land/${id} stays: ${p.err}`);
  writeResult({ id, ...result });
  console.log(`land: ${result.status} ${id}${result.conflict_files ? ` (${result.conflict_files.join(', ')})` : ''}${result.failed_jobs ? ` (${result.failed_jobs.join(', ')})` : ''}`);
}

const MAX_RETRIES = 2;
/** One batch: build, gate (bisect on red), push fast-forward only, then move the refs. */
async function landBatch(ids, dry) {
  const origBase = await revParse(MAIN);
  const tips = {};
  for (const id of ids) tips[id] = await revParse(`${LAND}${id}`);
  ids = ids.filter(id => tips[id]);   // deleted since the fetch (another lander took it)
  if (!ids.length) return;
  if (!dry) {
    fs.mkdirSync(STATE, { recursive: true });
    writeJsonAtomic(ACTIVE_BATCH, { ids, holder: MINE, time: new Date().toISOString() });
    const marked = ids.filter(withdrawnMarked);
    for (const id of marked) console.log(`land: ${id} was withdrawn; leaving it out`);
    ids = ids.filter(id => !marked.includes(id));
    if (!ids.length) return;
    if (marked.length) writeJsonAtomic(ACTIVE_BATCH, { ids, holder: MINE, time: new Date().toISOString() });
  }
  console.log(`land: batch of ${ids.length} on main ${origBase.slice(0, 10)}: ${ids.join(', ')}`);
  if (dry) {
    const c = await buildCandidate(origBase, ids, tips);
    for (const id of ids) {
      const x = c.conflicts.find(k => k.id === id);
      console.log(`land:   ${id}: ${x ? `conflict (${x.files.join(', ') || 'no file list'})` : 'merges cleanly'}`);
    }
    const l = await runGate(['--cache', '--ui', '--list']);
    console.log(`land: the gate would run (test-all --cache --ui):\n${l.out.trimEnd()}`);
    console.log('land: --dry-run: no gate, no push, no ref changed');
    return;
  }
  let base = origBase, pending = ids;
  for (let attempt = 0; ; attempt++) {
    // Another lander (another machine), an emergency direct push, or a crash between the main push and the ref
    // cleanup may have put some of these on main already: never merge them twice, and finish their landing here.
    const fresh = [];
    for (const id of pending) {
      if (await isAncestor(tips[id], base)) {
        console.log(`land: ${id} is already on main`);
        await markLanded([id], base, tips);
      } else fresh.push(id);
    }
    if (!fresh.length) return;
    let candidates = fresh;
    let s;
    for (;;) {
      writeJsonAtomic(ACTIVE_BATCH, { ids: candidates, holder: MINE, time: new Date().toISOString() });
      s = await settle(base, candidates, tips);
      for (const x of s.conflicts) await markFailed(x.id, tips[x.id], { status: 'conflict', conflict_files: x.files, conflicts_with: x.with });
      for (const x of s.red) {
        await markFailed(x.id, tips[x.id], { status: 'red', failed_jobs: x.failed.map(f => f.name), log: x.failed[0]?.log || null });
      }
      if (!s.accepted.length) return;
      // A suspended laptop can lose its lock during the gate. Check again after the remote fetch below.
      if (!stillHolder()) throw new LandError('lost the lander lock during the gate (another lander took it over); not pushing, the batch stays queued');
      await fetchRemote();
      const kept = [];
      for (const id of s.accepted) {
        if (await revParse(`${LAND}${id}`) === tips[id]) kept.push(id);
        else console.log(`land: land/${id} was removed or changed during the gate; dropping it from the candidate`);
      }
      if (kept.length === s.accepted.length) break;
      if (!kept.length) return;
      candidates = kept;   // rebuild from base and gate again without the removed branch
    }
    if (!stillHolder()) throw new LandError('lost the lander lock during the gate (another lander took it over); not pushing, the batch stays queued');
    const push = await git(['push', '-q', REMOTE, `${s.acceptedSha}:refs/heads/main`], { ok: true });
    // The push is in: a refresh that fails or times out now must not stop the landing being recorded (Opus review).
    if (push.code === 0) { await fetchRemote({ ok: true }); await markLanded(s.accepted, s.acceptedSha, tips); return; }
    await fetchRemote();
    const now = await revParse(MAIN);
    if (now === base) throw new LandError(`the push to main failed and main did not move: ${push.err}`);
    if (attempt >= MAX_RETRIES) {
      for (const id of s.accepted) writeResult({ id, status: 'queued', note: 'main keeps moving; still queued' });
      throw new LandError(`main keeps moving (${MAX_RETRIES + 1} pushes rejected); the batch stays queued`);
    }
    console.log(`land: main moved to ${now.slice(0, 10)} during the gate; remerging and gating again (retry ${attempt + 1} of ${MAX_RETRIES})`);
    base = now;
    pending = s.accepted;
  }
}

/** Serve the queue until it is empty. False if another lander holds the lock. */
async function drive({ batch = 4, dry = false } = {}) {
  if (!(await acquire())) return false;
  let error = null;
  try {
    const handled = new Set();
    for (;;) {
      if (!stillHolder()) { console.log('land: lost the lander lock; stopping'); break; }
      await fetchRemote();
      const q = (await queue()).filter(id => !handled.has(id));
      for (const bad of await malformed()) {
        if (!handled.has(bad)) console.log(`land: ignoring land/${bad}: not an id that submit writes; it was pushed by hand, so delete it by hand`);
        handled.add(bad);
      }
      if (!q.length) break;
      const ids = q.slice(0, batch);
      ids.forEach(id => handled.add(id));
      await landBatch(ids, dry);
      if (dry) break;
    }
  } catch (e) {
    if (!(e instanceof LandError)) throw e;
    error = e;
    if (e.mainRed) {
      fs.mkdirSync(STATE, { recursive: true });
      writeJsonAtomic(MAIN_RED, { main_sha: e.mainRed, message: e.message, time: new Date().toISOString() });
    }
  } finally { try { fs.rmSync(ACTIVE_BATCH, { force: true }); } catch { /* cleanup */ } release(); }
  if (runResults.length) {
    console.log('\nland: this run');
    for (const r of runResults) console.log(`  ${String(r.status).padEnd(9)}${r.id}${r.main_sha ? `  main ${r.main_sha.slice(0, 10)}` : ''}`);
  }
  if (!dry) console.log(`land: ${flakeSummary()}`);
  if (error) die(error.message, EXIT.error);
  return true;
}
/** `wait` and `status` serve a queue nobody is serving (a crashed lander leaves a stale lock and a queue behind). */
async function driveIfIdle() {
  if (holder()) return false;
  await fetchRemote();
  if (!(await queue()).length) return false;
  if (readMainRed()?.main_sha === await revParse(MAIN)) return false;   // the same red main: a rerun would only repeat it
  // A lander started by `wait` or `status` must run main's lander code, not a branch's (2026-10-10: one ran a
  // branch's copy from a worktree its owner then removed). Same code: drive here. Otherwise start one from a
  // dedicated worktree at origin/main; if main has no lander, refuse with the fix.
  const same = await sameLanderAsMain();
  if (same === true || (same === null && TEST)) {   // a test repository has no lander of its own on main
    console.log('land: the queue has branches and no lander is running; running the lander here');
    return drive();
  }
  if (same === null) {
    console.log("land: the queue is idle, but origin/main has no scripts/land.mjs to run; start one from a checkout of main: node scripts/land.mjs run");
    return false;
  }
  return startMainLander();
}

/** The files the running lander is made of: land.mjs and the ./lib modules it imports (one level is all it uses). */
function landerFiles() {
  const src = fs.readFileSync(path.join(HERE, 'land.mjs'), 'utf8');
  const libs = [...src.matchAll(/from '\.\/(lib\/[\w.-]+\.mjs)'/g)].map(m => m[1]);
  return ['land.mjs', ...libs].map(rel => ({ rel: `scripts/${rel}`, abs: path.join(HERE, rel) }));
}
/** true when every lander file is byte-identical to origin/main's copy; false when one differs; null when main has
 *  no scripts/land.mjs at all (a repository the lander is being tested in). */
async function sameLanderAsMain() {
  for (const f of landerFiles()) {
    const r = await git(['show', `${MAIN}:${f.rel}`], { ok: true });
    if (r.code !== 0) return f.rel === 'scripts/land.mjs' ? null : false;
    let mine;
    try { mine = fs.readFileSync(f.abs, 'utf8'); } catch { return false; }
    if (r.out !== mine.trim()) return false;
  }
  return true;
}
/** Refresh STATE/lander-main to origin/main and start its lander, detached, logging to STATE/logs. Returns true when
 *  one was started (or another waiter is starting one), false to retry later. A lander started here that died within
 *  two minutes with no lander holding the lock is a failure, not a reason to start another every poll: it dies with
 *  that lander's last log line (Opus review). */
async function startMainLander() {
  // Per repository: STATE is shared by every clone on the box, so each gets its own worktree and record (Codex r3:
  // one clone must never replace another clone's lander-main).
  const tag = crypto.createHash('sha256').update(GIT_DIR).digest('hex').slice(0, 10);
  const dir = path.join(STATE, `lander-main-${tag}`);
  const logs = path.join(STATE, 'logs');
  const lastFile = path.join(STATE, `lander-main-${tag}.last`);
  fs.mkdirSync(logs, { recursive: true });
  let last = null;
  try { last = JSON.parse(fs.readFileSync(lastFile, 'utf8')); } catch { /* none yet */ }
  // A failure only if it wrote no result since it started: a lander that landed everything and exited is not one.
  const newestResult = () => {
    let newest = 0;
    try { for (const f of fs.readdirSync(STATE).filter(f => f.endsWith('.json'))) newest = Math.max(newest, fs.statSync(path.join(STATE, f)).mtimeMs); }
    catch { /* none */ }
    return newest;
  };
  if (last && Date.now() - last.time < 120_000 && !pidAlive(last.pid) && !holder() && newestResult() < last.time) {
    let tail = '';
    try { tail = lines(fs.readFileSync(last.log, 'utf8')).slice(-1)[0] || ''; } catch { /* no log */ }
    die(`the lander started from origin/main (pid ${last.pid}) exited without landing: ${tail || 'no output'}; see ${last.log}`, EXIT.error);
  }
  // One starter at a time: an atomic mkdir is the claim; a claim older than 60 s is a crashed starter's.
  const claim = path.join(STATE, 'lander-main.starting');
  try { fs.mkdirSync(claim); }
  catch {
    let age = Infinity;
    try { age = Date.now() - fs.statSync(claim).mtimeMs; } catch { /* gone */ }
    if (age < 60_000) return true;   // another waiter is starting one now
    fs.rmSync(claim, { recursive: true, force: true });
    try { fs.mkdirSync(claim); } catch { return true; }
  }
  try {
    if (holder()) return true;   // re-checked under the claim: a lander took the lock since the idle check
    // lander-main must belong to THIS repository (STATE is shared by every clone on the box).
    if (fs.existsSync(path.join(dir, '.git'))) await git(['checkout', '-q', '--detach', '-f', MAIN], { cwd: dir });
    else await git(['worktree', 'add', '-f', '-q', '--detach', dir, MAIN]);
    for (const f of fs.readdirSync(logs).filter(f => f.startsWith('lander-main-')).sort().slice(0, -20)) {
      fs.rmSync(path.join(logs, f), { force: true });   // keep the newest 20
    }
    const log = path.join(logs, `lander-main-${Date.now()}.log`);
    const out = fs.openSync(log, 'a');
    // Absolute state and lock dirs: the child runs in lander-main, where a relative one would be somewhere else.
    const child = spawn(process.execPath, [path.join(dir, 'scripts', 'land.mjs'), 'run', '--remote', REMOTE],
      { cwd: dir, env: { ...process.env, LAND_STATE_DIR: STATE, LAND_LOCK_DIR: LOCK }, stdio: ['ignore', out, out], detached: true });
    fs.closeSync(out);
    child.unref();
    writeJsonAtomic(lastFile, { pid: child.pid, log, time: Date.now() });
    console.log(`land: the queue is idle and this lander code is not origin/main's: started a lander from origin/main (pid ${child.pid}; log ${log})`);
    // Hold the claim until the child holds the lock (or 15 s), so no other waiter refreshes lander-main under it.
    for (let w = 0; w < 15_000 && !holder() && pidAlive(child.pid); w += 250) await sleep(250);
    return true;
  } catch (e) {
    console.log(`land: could not start a lander from origin/main (${e.message.split('\n')[0]}); will try again`);
    return false;
  } finally { fs.rmSync(claim, { recursive: true, force: true }); }
}

// ---- results from refs (so wait/status work from another machine) -----------------------------------------------
async function resolve(id) {
  const r = readResult(id);
  if (r && r.status !== 'queued') return r;
  if (await revParse(`${FAILED}${id}`)) return { id, status: 'red', note: `see land-failed/${id}` };
  if (await revParse(`${LAND}${id}`)) return null;
  const merge = await gitOut(['log', '-1', '--format=%H', '--fixed-strings', `--grep=Land ${id}`, MAIN]);
  if (merge) return { id, status: 'landed', main_sha: await revParse(MAIN) };
  return null;
}
function ciUrl(sha) {
  if (TEST) return null;   // never reach GitHub from a test
  try {
    const out = execFileSync('gh', ['run', 'list', '--commit', sha, '--limit', '1', '--json', 'url'], { cwd: path.dirname(GIT_DIR), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out)[0]?.url || null;
  } catch { return null; }
}
function report(r) {
  if (r.status === 'landed') {
    const ci = r.ci_url || ciUrl(r.main_sha);
    console.log(`land: ${r.id} landed; main ${r.main_sha}${ci ? `\nland: CI ${ci}` : ''}`);
  } else if (r.status === 'conflict') {
    console.log(`land: ${r.id} conflicts with ${r.conflicts_with || 'main'} in: ${(r.conflict_files || []).join(', ') || '(no file list)'}; the branch is now land-failed/${r.id}`);
  } else if (r.status === 'withdrawn') {
    console.log(`land: ${r.id} withdrawn; it was removed from the queue`);
  } else {
    console.log(`land: ${r.id} is red: ${(r.failed_jobs || []).join(', ') || r.note || ''}${r.log ? `\nland: log ${r.log}` : ''}; the branch is now land-failed/${r.id}`);
  }
  return EXIT[r.status] ?? EXIT.red;
}

// ---- commands ----------------------------------------------------------------------------------------------------
const slugify = (s, max) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

async function submit() {
  const owner = slugify(opt('--owner', ''), 24).replace(/-/g, '_');
  if (!owner) die('submit needs --owner <name>');
  await guard();
  if ((await gitOut(['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT })).length) die('the working tree has uncommitted changes; commit or stash them first');
  const untracked = await gitOut(['status', '--porcelain', '--untracked-files=normal'], { cwd: ROOT });
  if (untracked) console.log('land: note: untracked files are not submitted');
  await fetchRemote();
  if (Number(await gitOut(['rev-list', '--count', `${MAIN}..HEAD`], { cwd: ROOT })) === 0) die(`HEAD has no commit that ${REMOTE}/main lacks; nothing to land`);
  const branch = await gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT });
  const slug = slugify(opt('--note', '') || (branch === 'HEAD' ? 'detached' : branch), 40) || 'change';
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const id = `${stamp}-${owner}-${slug}`;
  const p = await git(['push', '-q', REMOTE, `HEAD:refs/heads/land/${id}`], { ok: true, cwd: ROOT });
  if (p.code !== 0) die(`the push of land/${id} failed: ${p.err}`, EXIT.error);
  await fetchRemote();
  const pos = (await queue()).indexOf(id) + 1;
  console.log(`land: submitted ${id} (queue position ${pos})`);
  console.log(`land: next: node scripts/land.mjs wait ${id}`);
}

async function run() {
  await guard();
  const batch = Math.max(1, Number(opt('--batch', '4')) || 4);
  if (!(await drive({ batch, dry: flag('--dry-run') }))) {
    const h = holder();
    console.log(`land: a lander is running (pid ${h?.pid}, since ${h?.since}); your branch is queued`);
  }
}

async function wait() {
  const id = positional[0];
  if (!id) die('wait needs an id (submit prints it)');
  await guard();
  const deadline = Date.now() + Number(opt('--timeout-min', '60')) * 60_000;
  for (;;) {
    await fetchRemote();
    const r = await resolve(id);
    if (r) process.exit(report(r));
    // A lander stopped on this main because main is red on its own: the branch stays queued, and waiting cannot help.
    const red = readMainRed();
    if (red && red.main_sha === await revParse(MAIN) && !holder()) die(`${id} is still queued: ${red.message}`, EXIT.error);
    if (await driveIfIdle()) {
      const after = await resolve(id);
      if (after) process.exit(report(after));
    }
    // Every iteration: a queue the lander cannot empty must not turn this into an endless fetch loop.
    if (Date.now() >= deadline) { console.log(`land: ${id} has no result yet; timed out`); process.exit(EXIT.timeout); }
    await sleep(POLL_MS);
  }
}

async function withdraw() {
  const id = positional[0];
  if (!id) die('withdraw needs an id');
  const owner = slugify(opt('--owner', ''), 24).replace(/-/g, '_');
  if (!owner) die('withdraw needs --owner <name>');
  await guard();
  if (!ID_RE.test(id)) die(`unknown id ${id}`);
  const actualOwner = ownerOf(id);
  if (owner !== actualOwner) die(`${id} is owned by ${actualOwner}; ${owner} cannot withdraw it`);
  const inLiveBatch = () => {
    let active = null;
    try { active = JSON.parse(fs.readFileSync(ACTIVE_BATCH, 'utf8')); } catch { /* no active batch */ }
    return Boolean(active?.ids?.includes(id) && active.holder && liveEntries(false).includes(active.holder));
  };
  const busy = `${id} is in the active lander batch and cannot be withdrawn while it is being built or gated`;
  if (inLiveBatch()) die(busy);
  // No lander: hold the lock so none starts. A lander running: mark the id, then check its batch again (the
  // handshake at WITHDRAWN). Any refusal below removes the marker, so a branch that was not withdrawn still lands.
  const locked = await acquire();
  const marker = path.join(WITHDRAWN, id);
  let done = false;
  if (!locked) {
    fs.mkdirSync(WITHDRAWN, { recursive: true });
    writeJsonAtomic(marker, { owner, time: new Date().toISOString() });
  }
  const unmark = () => { if (!locked && !done) fs.rmSync(marker, { force: true }); };
  process.on('exit', unmark);
  try {
    if (!locked && inLiveBatch()) die(busy);
    await fetchRemote();
    const tip = await revParse(`${LAND}${id}`);
    const result = await resolve(id);
    if (result?.status === 'landed' || result?.status === 'red' || result?.status === 'conflict' || result?.status === 'withdrawn') {
      die(`${id} is already ${result.status}`);
    }
    if (!tip) die(`unknown id ${id}`);
    const del = await deleteLandRef(id);
    if (del.code !== 0) die(`could not delete land/${id}: ${del.err}`, EXIT.error);
    done = true;   // the ref is gone: the marker must stay, whatever the result below
    await fetchRemote();
    const mainNow = await revParse(MAIN);
    if (mainNow && await isAncestor(tip, mainNow)) {
      writeResult({ id, status: 'landed', main_sha: mainNow });
      report({ id, status: 'landed', main_sha: mainNow });
      return;
    }
    const after = await resolve(id);
    if (['landed', 'red', 'conflict'].includes(after?.status)) die(`${id} is already ${after.status}`);
    writeResult({ id, status: 'withdrawn' });
    console.log(`land: ${id} withdrawn by ${owner}${locked ? '' : ' (a lander is running; it will skip it)'}`);
  } finally { unmark(); if (locked) release(); }
}

async function status() {
  await guard();
  await fetchRemote();
  const q = await queue();
  console.log(`land: queue (${q.length})`);
  q.forEach((id, i) => console.log(`  ${i + 1}. ${id}`));
  const h = holder();
  console.log(h ? `land: lander running: pid ${h.pid}, since ${h.since}` : 'land: no lander running');
  let recent = [];
  try {
    recent = fs.readdirSync(STATE).filter(f => f.endsWith('.json'))
      .map(f => ({ f, t: fs.statSync(path.join(STATE, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, 10)
      .map(({ f }) => readResult(f.slice(0, -5))).filter(r => typeof r?.status === 'string' && typeof r.id === 'string');
      // ^ results only: active-batch.json sits in the same dir while a batch runs, with no `status` (2026-10-05)
  } catch { /* no results yet */ }
  if (recent.length) {
    console.log('land: recent results');
    for (const r of recent) console.log(`  ${r.status.padEnd(9)}${r.id}`);
  }
  console.log(`land: ${flakeSummary()}`);
  const id = positional[0];
  if (id) {
    const r = await resolve(id);
    if (r) report(r); else console.log(`land: ${id}: ${q.includes(id) ? `queued (position ${q.indexOf(id) + 1})` : 'unknown'}`);
  }
  if (!flag('--no-drive')) await driveIfIdle();
}

const COMMANDS = { submit, run, wait, status, withdraw };
if (!COMMANDS[CMD]) {
  console.log('usage: node scripts/land.mjs submit --owner <name> [--note <text>] | run [--batch N] [--dry-run] | wait <id> [--timeout-min N] | status [id] [--no-drive] | withdraw <id> --owner <name>   (all take [--remote origin])');
  process.exit(CMD ? EXIT.refused : 0);
}
try { await COMMANDS[CMD](); }
catch (e) {
  // Exit 1 means "red" to `wait`'s caller: an unexpected error (a failed fetch, say) must not read as one.
  console.error(`land: ${e instanceof LandError ? '' : 'unexpected error: '}${e.message}`);
  process.exit(EXIT.error);
}
