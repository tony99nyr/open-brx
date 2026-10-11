#!/usr/bin/env node
// land.mjs: the land lane. Agents stop pushing to main; they submit a branch, and ONE lander at a time merges a
// batch of submitted branches onto main, gates the batch once, and pushes it fast-forward only.
//
//   node scripts/land.mjs submit --owner <name> [--note <text>] [--fix-main <reason>] [--remote origin]
//   node scripts/land.mjs run [--batch 4] [--dry-run] [--remote origin]
//   node scripts/land.mjs wait <id> [--timeout-min 60] [--remote origin]
//   node scripts/land.mjs status [id] [--no-drive] [--remote origin]
//   node scripts/land.mjs withdraw <id> --owner <name> [--remote origin]
//   node scripts/land.mjs prune [--older-than-days 14] [--dry-run] [--remote origin]
//
// The flow, the results, conflicts, flakes and the emergency path are in scripts/README.md (the land lane).
// Tests: mcp/tests/test_land.py drives this script against a temporary bare remote with a stubbed gate.
//
// Refs on the remote: `land/<id>` is the queue (sorted by name, so by submit time); `land-failed/<id>` holds a branch
// that went red or conflicted; `land-fix/<id>` records a fix-main reason. The lander deletes `land/<id>` only after
// the branch is on main or copied to `land-failed/<id>`, together with its fix reason ref. It never force-pushes and
// never pushes anything to main but a fast-forward.
//
// Test-only switches (the guard below enforces them):
//   LAND_TEST=1          refuses any remote whose URL is not a local path (file:// or absolute);
//   LAND_GATE_STUB=<json command prefix>   replaces `node scripts/test-all.mjs`; refused unless LAND_TEST=1;
//   LAND_GIT_TIMEOUT_MS=<ms>   the ceiling on a network git call (default 600000); LAND_GIT_DETACH=0 (only with
//     LAND_TEST=1) runs network git in the foreground group, the path a terminal run takes;
//   LAND_INSTALL_STUB=<json command prefix>   runs before `npm ci` (which it gets as arguments); same rule;
//   LAND_TEST_FETCH_RACES=<n>   the next n fetches lose the "not our ref" race (fetchRemote); same rule.
//   LAND_DOCS_HYGIENE_STUB=<test names>   test-only result for the submit docs gate.
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
import { isDocsOnly, isShotsOnly, selectJobs } from './lib/changed.mjs';
import { inputsForJob } from './lib/inputs.mjs';
import { remoteKey } from './lib/remotekey.mjs';

const argv = process.argv.slice(2);
const CMD = argv[0];
const VALUED = new Set(['--owner', '--note', '--fix-main', '--remote', '--batch', '--timeout-min', '--older-than-days']);
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
let WITHDRAWN;
// The scratch worktree the candidate is built in: one per lock entry (`wt-<entry>`), so a lander that lost the lock
// (a suspended laptop, then another lander took over) can never build in the same tree as its successor.
let WT = null;
const FLAKES = path.join(STATE, 'flakes.jsonl');
const LAND = `refs/remotes/${REMOTE}/land/`;
const FAILED = `refs/remotes/${REMOTE}/land-failed/`;
const FIX = `refs/remotes/${REMOTE}/land-fix/`;
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
const REPO_TAG = crypto.createHash('sha256').update(GIT_DIR).digest('hex').slice(0, 10);
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
  if (process.env.LAND_TEST_FETCH_RACES && !TEST) die('LAND_TEST_FETCH_RACES is test-only: it is refused unless LAND_TEST=1');
  if (process.env.LAND_DOCS_HYGIENE_STUB && !TEST) die('LAND_DOCS_HYGIENE_STUB is test-only: it is refused unless LAND_TEST=1');
  const raw = FAKE_GIT_VERSION || (await git(['--version'], { ok: true })).out;
  const m = /(\d+)\.(\d+)/.exec(raw);
  const ok = m && (Number(m[1]) > GIT_MIN[0] || (Number(m[1]) === GIT_MIN[0] && Number(m[2]) >= GIT_MIN[1]));
  if (!ok) die(`git ${GIT_MIN.join('.')} or later is needed (found "${raw.trim() || 'no git'}"). On a Mac: `
    + '`brew install git`, then check that `which git` is /opt/homebrew/bin/git (or /usr/local/bin/git).');
}
async function guard() {
  LANDER_AT_START = landerFiles().map(f => { try { return { ...f, text: fs.readFileSync(f.abs, 'utf8') }; } catch { return { ...f, text: null }; } });
  await checkGitVersion();
  if (STUB && !TEST) die('LAND_GATE_STUB is test-only: it is refused unless LAND_TEST=1');
  if (INSTALL_STUB && !TEST) die('LAND_INSTALL_STUB is test-only: it is refused unless LAND_TEST=1');
  const url = await git(['remote', 'get-url', REMOTE], { ok: true });
  if (url.code !== 0) die(`no remote named ${REMOTE}`);
  const push = await git(['remote', 'get-url', '--push', REMOTE], { ok: true });
  for (const u of [url.out, push.out]) {
    if (u && !u.includes(':') && !path.isAbsolute(u)) die(`the remote ${REMOTE} is a relative path (${u}); the lander runs git from the shared git dir, so give it an absolute path: git remote set-url ${REMOTE} <absolute path>`);
  }
  let key;
  try { key = remoteKey(url.out); }
  catch (e) {
    if (e.code === 'ENOENT') die(`the local remote ${REMOTE} does not exist (${url.out}); set its URL to an existing path`);
    throw e;
  }
  WITHDRAWN = path.join(STATE, 'withdrawn', crypto.createHash('sha256').update(key).digest('hex').slice(0, 10));
  if (!TEST) return;
  for (const u of [url.out, push.out]) {
    if (!isLocalUrl(u)) die(`LAND_TEST=1 refuses the non-local remote ${REMOTE} (${u}): tests run against a local bare repo only`);
  }
}

// ---- the remote --------------------------------------------------------------------------------------------------
/** Explicit refspecs, so the queue works whatever the clone's fetch config says. `+` updates remote-TRACKING refs
 *  (what every fetch does); nothing here writes the remote. */
// A fetch can lose a race with another lander's push or ref delete on the remote: git advertised a ref that moved
// before upload-pack served it ("not our ref", CI 2026-10-10, two landers on two machines). That is retried twice;
// any other failure is final. LAND_TEST_FETCH_RACES=<n> (tests only) makes the next n fetches lose that race.
const FETCH_RACE = /not our ref|cannot lock ref|some local refs could not be updated/;
let fetchRacesLeft = TEST ? Number(process.env.LAND_TEST_FETCH_RACES || 0) : 0;
async function fetchRemote(o = {}) {
  const args = ['fetch', '-q', '--prune', REMOTE,
    `+refs/heads/main:${MAIN}`, `+refs/heads/land/*:${LAND}*`, `+refs/heads/land-failed/*:${FAILED}*`,
    `+refs/heads/land-fix/*:${FIX}*`];
  for (let attempt = 0; ; attempt++) {
    const r = fetchRacesLeft > 0
      ? (fetchRacesLeft--, { code: 128, out: '', err: 'fatal: remote error: upload-pack: not our ref 0000000000000000000000000000000000000000' })
      : await git(args, { ...o, ok: true });
    if (r.code === 0 || attempt >= 2 || !FETCH_RACE.test(r.err)) {
      if (r.code !== 0 && !o.ok) throw new Error(`git ${args.join(' ')}: ${r.err || `exit ${r.code}`}`);
      return r;
    }
    await sleep(250 * (attempt + 1));
  }
}
const refIds = async prefix => lines(await gitOut(['for-each-ref', '--format=%(refname)', prefix])).map(r => r.slice(prefix.length)).sort();
/** The shape `submit` writes: `<UTC yyyymmddHHMMSS>-<owner>-<slug>`. A land/ ref of any other shape was pushed by hand:
 *  the lander reports it and never lands it (it could not delete it afterwards either). */
const ID_RE = /^\d{14}-[a-z0-9_]+-[a-z0-9-]+$/;
const queue = async () => (await refIds(LAND)).filter(id => ID_RE.test(id));
const malformed = async () => (await refIds(LAND)).filter(id => !ID_RE.test(id));
const queuedFixes = async q => (await refIds(FIX)).filter(id => q.includes(id));
async function fixReason(id) {
  if (!(await revParse(`${FIX}${id}`))) return null;
  const message = await gitOut(['show', '-s', '--format=%B', `${FIX}${id}`]);
  return message.startsWith('fix-main: ') ? message.slice('fix-main: '.length).trim() : null;
}
const revParse = async ref => (await git(['rev-parse', '--verify', '-q', ref], { ok: true })).out || null;
const isAncestor = async (a, b) => (await git(['merge-base', '--is-ancestor', a, b], { ok: true })).code === 0;
/** Delete an entry's queue refs in one push when it has a fix reason ref. */
async function deleteQueueRefs(id) {
  if (!ID_RE.test(id)) throw new Error(`refusing to delete a ref with an unexpected name: land/${id}`);
  const hasFix = Boolean(await revParse(`${FIX}${id}`));
  return git(['push', '-q', ...(hasFix ? ['--atomic'] : []), REMOTE, '--delete',
    `refs/heads/land/${id}`, ...(hasFix ? [`refs/heads/land-fix/${id}`] : [])], { ok: true });
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
// red main; a new main sha makes it stale. A queued fix-main entry can also run against the red main.
const MAIN_RED = path.join(STATE, 'main-red');
const ACTIVE_BATCH = path.join(STATE, 'active-batch.json');
// `stop` names the lock entry it is for, so a request outlives neither its lander nor stops the next one.
const STOP_REQUEST = path.join(STATE, 'stop-request.json');
// Written when a lander honours a stop: a fresh .json here, so a waiter does not read the exit as a failed start.
const STOPPED_FILE = path.join(STATE, 'stopped.json');
let STOPPED = false;   // this process honoured a stop: it never hosts a lander again
const stopAsked = () => readOrNull(STOP_REQUEST)?.includes(`"${MINE}"`);
function honourStop() {
  STOPPED = true;
  writeJsonAtomic(STOPPED_FILE, { entry: MINE, time: new Date().toISOString() });
  console.log('land: stopping after this batch, as asked (land.mjs stop)');
}
// A `withdraw` made while a lander runs leaves `withdrawn/<id>` here. The two sides use a write-then-check handshake:
// the lander writes ACTIVE_BATCH and THEN drops any marked id; withdraw writes the marker and THEN refuses an id in a
// live ACTIVE_BATCH. One side always sees the other, so a withdrawn id is never gated. Markers stay (ids are never
// reused), so a lander that fetched before the ref was deleted still skips it. New markers are scoped by remote;
// old unscoped markers remain readable and prune removes them by age while it holds the lock.
const withdrawnMarked = id => fs.existsSync(path.join(WITHDRAWN, id)) || fs.existsSync(path.join(STATE, 'withdrawn', id));
/** Record that main is red, keeping the fix-main ids already tried on this main (each gets one lander start). */
function recordMainRed(sha, message, tried = []) {
  const prev = readMainRed();
  const fixTried = [...new Set([...(prev?.main_sha === sha ? prev.fix_tried || [] : []), ...tried])];
  fs.mkdirSync(STATE, { recursive: true });
  writeJsonAtomic(MAIN_RED, { main_sha: sha, message, time: new Date().toISOString(), fix_tried: fixTried });
}
/** Queued fix-main ids not yet tried on the main MAIN_RED names: only these may start a lander on a red main. */
async function untriedFixes(q) {
  const tried = readMainRed()?.fix_tried || [];
  return (await queuedFixes(q)).filter(id => !tried.includes(id));
}
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
// T1 (2026-10-10 review): a job that keeps flaking is a problem, not noise. Over budget (FLAKE_BUDGET flakes of that job
// in 24 h, incident windows and box-load gates excluded), gate() reports the flake, and settle() makes a branch red
// whose OWN diff touches the job's inputs (it may be the cause); every other branch lands with a warning.
// LAND_FLAKE_BUDGET=off for an incident.
const FLAKE_BUDGET = 3;
const FLAKE_WINDOW_MS = 24 * 3_600_000;
/** Incident windows from flakes.jsonl rows; one with no (or no valid) `to` is still open. */
const incidentWindows = rows => rows.filter(r => r.incident)
  .map(r => ({ from: Date.parse(r.incident.from), to: Date.parse(r.incident.to) || Infinity, note: r.incident.note }));
function flakeRows() {
  try { return lines(fs.readFileSync(FLAKES, 'utf8')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
/** This job's flakes in the last 24 h that count: not in an incident window, not from a job that waited on outside
 *  load, and not dated in the future (WSL steps its clock back under load). null when `now` is itself inside an incident:
 *  the flake being counted happened in it, so it does not count either. */
function countedFlakes(job, now = Date.now()) {
  const rows = flakeRows();
  const incidents = incidentWindows(rows);
  const inIncident = ms => incidents.some(i => ms >= i.from && ms <= i.to);
  if (inIncident(now)) return null;
  return rows.filter(f => {
    const ms = Date.parse(f.time), age = now - ms;
    return f.job === job && !f.outside_load && !inIncident(ms) && age >= 0 && age <= FLAKE_WINDOW_MS;
  }).length;
}
function flakeSummary() {
  const rows = flakeRows();
  const since = Date.now() - 7 * 86_400_000;
  // An incident row ({"incident": {"from", "to", "note"}}) marks a window when the MACHINE failed, not the tests
  // (2026-10-04: WSL's 4915-task cgroup cap; every rerun then failed too). Flakes inside it stay in the file as
  // evidence but leave the counts, so they cannot hide or fake a recurring job.
  const incidents = incidentWindows(rows);
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
    // BRX_LAND_PRIORITY: the gate's test-all gets pool priority over local runs (it removes the variable from its jobs).
    const child = spawn(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, [GATE_KEY]: GATE_TOKEN, BRX_LAND_PRIORITY: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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

/** Gate the candidate at WT once. Returns { green, failed: [{name, log}], overBudget, log }. A failed job is rerun alone
 *  once: green on the rerun is a flake (recorded, and the gate counts as green). A flake that takes its job over the
 *  flake budget is also returned in `overBudget`, for settle() to blame. Throws LandError when the gate cannot be
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
      return { green: true, failed: [], overBudget: [], log: g.log };
    }
  }
  const still = [], overBudget = [];
  for (const f of failed) {
    // A failed shared build has no job of its own to rerun: rerun the whole gate.
    const isBuild = p.build !== null;
    const r = await runGate(isBuild ? ['--no-cache', '--ui', ...narrow] : [f.name, '--no-cache', '--ui']);
    const rp = parseGate(r.out);
    const green = isBuild
      ? r.code === 0 && !rp.build && rp.rows.length === expected && rp.rows.every(x => x.ok)
      : r.code === 0 && rp.rows.length === 1 && rp.rows[0].name === f.name && rp.rows[0].ok;
    if (green) {
      // The pool names the waiting job. Another job's wait does not exempt this flake.
      const outsideLoad = g.out.includes(`waiting on outside load for ${f.name}:`);
      const step = stepOf(f.log);
      // This flake plus the earlier ones that count. A build flake has no job to blame, and LAND_FLAKE_BUDGET=off
      // turns the budget off for an incident.
      const earlier = isBuild || outsideLoad || process.env.LAND_FLAKE_BUDGET === 'off' ? null : countedFlakes(f.name);
      const n = earlier === null ? 0 : earlier + 1;
      const row = n >= FLAKE_BUDGET ? `${f.name} flaked ${n} times in 24 h (last step: ${step}; log ${f.log}): find the cause.` : null;
      recordFlake({ job: f.name, step, branches: ids, log: f.log, ...(outsideLoad ? { outside_load: true } : {}),
        ...(row ? { over_budget: n, row } : {}) });
      console.log(`land:   ${f.name} failed, then passed alone: a flake (recorded in ${FLAKES})`);
      // Printed here, not only in settle(): a bisect after a real failure may never reach settle()'s warning.
      if (row) console.log(`land:   ${f.name} is over its flake budget (${n} in 24 h). Row text: ${row}`);
      if (row) overBudget.push({ name: f.name, log: f.log, kind: 'flake-budget', n, row });
    } else still.push(f);
  }
  return { green: still.length === 0, failed: still, overBudget, log: g.log };
}

/** Does the branch's OWN diff (base...tip, from their merge base) select `job` under scripts/lib/changed.mjs's mapping?
 *  Its own diff, not the candidate's: a bisected half sits on top of branches already accepted. */
async function branchTouchesJob(base, tip, job) {
  const paths = lines(await gitOut(['diff', '--no-renames', '--name-only', `${base}...${tip}`], { cwd: WT }));
  if (!paths.length) return false;   // an empty diff touches nothing
  // The job's declared inputs (the cache key), not selectJobs: --changed may narrow a selection (changed.mjs
  // NARROWED), and blame must not inherit that (DRY review #2). A job with no declared inputs is always touched.
  let inputs;
  try { inputs = inputsForJob(job); } catch { return true; }
  return paths.some(p => inputs.some(i => i === '.' || (i.endsWith('/') ? p.startsWith(i) : p === i)));
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
  const budgetHits = [];   // {f: an over-budget flake, ids: the branches in its gate}
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
    const g = deps.ok ? await gate(ok, true, base) : { green: false, failed: deps.failed, overBudget: [] };
    // An over-budget flake blames each branch that was in its gate and touches the job's inputs, whenever that branch
    // would otherwise be accepted: on this gate, or after the bisect of a gate that also had a real failure. No bisect
    // and no main check on this path, so a clean re-gate cannot hide the budget and main is not suspected. A branch
    // accepted BEFORE the flake passed a clean gate of its own, so it lands.
    budgetHits.push(...g.overBudget.map(f => ({ f, ids: ok })));
    if (g.green && budgetHits.length) {
      const blamed = [];
      for (const id of ok) {
        const jobs = [];
        for (const h of budgetHits) {
          if (h.ids.includes(id) && !jobs.some(j => j.name === h.f.name) && (await branchTouchesJob(base, tips[id], h.f.name))) jobs.push(h.f);
        }
        if (jobs.length) blamed.push({ id, failed: jobs });
      }
      for (const b of blamed) for (const f of b.failed) {
        console.log(`land:   ${f.name} is over its flake budget (${f.n} in 24 h): red for ${b.id}, which touches its inputs`);
      }
      for (const f of g.overBudget) if (!blamed.some(b => b.failed.some(j => j.name === f.name))) {
        console.log(`land:   WARNING ${f.name} is over its flake budget (${f.n} in 24 h); no branch here touches its inputs, so they land. File this row: ${f.row}`);
      }
      if (blamed.length) {
        red.push(...blamed);
        const rest = ok.filter(id => !blamed.some(b => b.id === id));
        if (rest.length) await attempt(rest);
        return;
      }
    }
    if (g.green) { accepted = c.merged; acceptedSha = c.sha; return; }
    if (ok.length === 1) {
      if (!accepted.length && (await mainIsRed(g.failed))) {
        const fixRed = (await fixReason(ok[0])) === null ? null : { id: ok[0], failed: g.failed };
        throw new LandError(`main (${base.slice(0, 10)}) is red on its own for ${g.failed.map(f => f.name).join(', ')}; fix main first (the emergency path)`, { mainRed: base, fixRed });
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
    const reason = await fixReason(id);
    // The result first: a `wait` that sees the ref gone reads "landed" from the refs, and its caller may read the
    // result file next (Opus review 2026-10-10). A crash in between leaves a ref the next lander finds already on main.
    writeResult({ id, status: 'landed', main_sha: sha, ...(reason === null ? {} : { fix_main: reason }) });
    const d = await deleteQueueRefs(id);
    if (d.code !== 0) console.log(`land:   could not delete land/${id} (already gone?): ${d.err}`);
    console.log(`land: landed ${id}`);
  }
}
async function markFailed(id, tip, result) {
  await fetchRemote();
  const reason = await fixReason(id);
  const mainNow = await revParse(MAIN);
  if (mainNow && (await isAncestor(tip, mainNow))) {
    console.log(`land: ${id} is already on main (another lander, or a direct push)`);
    await markLanded([id], mainNow, { [id]: tip });
    return;
  }
  const p = await git(['push', '-q', REMOTE, `${tip}:refs/heads/land-failed/${id}`], { ok: true });
  writeResult({ id, ...result, ...(reason === null ? {} : { fix_main: reason }) });
  if (p.code === 0) {
    const d = await deleteQueueRefs(id);
    if (d.code !== 0) console.log(`land:   could not delete land/${id}: ${d.err}`);
  } else console.log(`land:   could not create land-failed/${id}, so land/${id} stays: ${p.err}`);
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
  let base = origBase, pending = ids, retries = 0;
  for (;;) {
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
      try { s = await settle(base, candidates, tips); }
      catch (e) {
        if (e instanceof LandError && e.mainRed) {
          // First the record (a failing cleanup below must not lose it), with the fix-main ids this batch tried.
          recordMainRed(e.mainRed, e.message, await queuedFixes(candidates));
          if (e.fixRed) {
            try {
              await markFailed(e.fixRed.id, tips[e.fixRed.id], { status: 'red',
                failed_jobs: e.fixRed.failed.map(f => f.name), log: e.fixRed.failed[0]?.log || null,
                note: 'main is red too; this fix-main entry did not clear the failing job' });
            } catch (err) { console.log(`land: could not mark ${e.fixRed.id} red: ${err.message.split('\n')[0]}`); }
          }
        }
        throw e;
      }
      for (const x of s.conflicts) await markFailed(x.id, tips[x.id], { status: 'conflict', conflict_files: x.files, conflicts_with: x.with });
      for (const x of s.red) {
        await markFailed(x.id, tips[x.id], { status: 'red', failed_jobs: x.failed.map(f => f.name), log: x.failed[0]?.log || null,
          ...(x.failed.some(f => f.kind === 'flake-budget') ? { note: `over the flake budget, and this branch touches the job: ${x.failed.filter(f => f.kind === 'flake-budget').map(f => f.row).join(' ')}` } : {}) });
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
    let candidateSha = s.acceptedSha;
    for (;;) {
      if (!stillHolder()) throw new LandError('lost the lander lock during the gate (another lander took it over); not pushing, the batch stays queued');
      const push = await git(['push', '-q', REMOTE, `${candidateSha}:refs/heads/main`], { ok: true });
      // The push is in: a refresh that fails or times out now must not stop the landing being recorded (Opus review).
      if (push.code === 0) { await fetchRemote({ ok: true }); await markLanded(s.accepted, candidateSha, tips); return; }
      await fetchRemote();
      const now = await revParse(MAIN);
      if (now === base) throw new LandError(`the push to main failed and main did not move: ${push.err}`);
      if (retries >= MAX_RETRIES) {
        for (const id of s.accepted) writeResult({ id, status: 'queued', note: 'main keeps moving; still queued' });
        throw new LandError(`main keeps moving (${MAX_RETRIES + 1} pushes rejected); the batch stays queued`);
      }
      retries++;
      const paths = lines(await gitOut(['diff', '--no-renames', '--name-only', base, now]));
      if (await isAncestor(base, now) && isShotsOnly(paths)) {
        await resetWorktree(now);
        const merge = await git(['merge', '--no-ff', '--no-edit', '-q', '-m',
          `Land onto ${now.slice(0, 10)} (shots-only main advance)`, candidateSha], { cwd: WT, ok: true });
        if (merge.code === 0) {
          const names = selectJobs(paths).filters;
          console.log(`land: shots-only main advance to ${now.slice(0, 10)}; gating ${names.join(', ')} on the merged candidate`);
          const narrow = await runGate([...names, '--no-cache', '--ui']);
          const result = parseGate(narrow.out);
          if (narrow.code === 0 && !result.build && result.rows.length === names.length
            && names.every(name => result.rows.some(row => row.name === name && row.ok))) {
            candidateSha = await gitOut(['rev-parse', 'HEAD'], { cwd: WT });
            base = now;
            continue;
          }
          console.log('land: shots-only site gate failed; remerging and gating again');
        } else {
          await git(['merge', '--abort'], { cwd: WT, ok: true });
          console.log('land: shots-only merge conflicted; remerging and gating again');
        }
      } else console.log('land: main advance includes other paths; remerging and gating again');
      console.log(`land: main moved to ${now.slice(0, 10)} during the gate; retry ${retries} of ${MAX_RETRIES}`);
      base = now;
      pending = s.accepted;
      break;
    }
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
      if (stopAsked()) { honourStop(); break; }
      await fetchRemote();
      const q = (await queue()).filter(id => !handled.has(id));
      for (const bad of await malformed()) {
        if (!handled.has(bad)) console.log(`land: ignoring land/${bad}: not an id that submit writes; it was pushed by hand, so delete it by hand`);
        handled.add(bad);
      }
      if (!q.length) break;
      const fixes = await queuedFixes(q);
      const ids = fixes.length
        ? [fixes[0], ...q.filter(id => id !== fixes[0] && !fixes.includes(id))].slice(0, batch)
        : q.slice(0, batch);
      if (stopAsked()) { honourStop(); break; }   // again: a request may arrive during the fetch
      ids.forEach(id => handled.add(id));
      await landBatch(ids, dry);
      if (dry) break;
    }
  } catch (e) {
    if (!(e instanceof LandError)) throw e;
    error = e;
    if (e.mainRed) {
      fs.mkdirSync(STATE, { recursive: true });
      recordMainRed(e.mainRed, e.message);
    }
  } finally {
    try { fs.rmSync(ACTIVE_BATCH, { force: true }); } catch { /* cleanup */ }
    try { if (stopAsked()) fs.rmSync(STOP_REQUEST, { force: true }); } catch { /* cleanup */ }
    release();
  }
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
  if (readMainRed()?.main_sha === await revParse(MAIN) && !(await untriedFixes(await queue())).length) return false;
  // A lander started by `wait` or `status` must run main's lander code, not a branch's (2026-10-10: one ran a
  // branch's copy from a worktree its owner then removed). Same code: drive here. Otherwise start one from a
  // dedicated worktree at origin/main; if main has no lander, refuse with the fix.
  const same = await sameLanderAsMain();
  if (STOPPED) return same === true ? startMainLander() : false;   // never host again: that is what stop is for
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
/** The code this process loaded, read once at start: a checkout pulled to the new main later must not make an old
 *  in-memory lander look current. */
let LANDER_AT_START = [];
function landerFiles() {
  const src = fs.readFileSync(path.join(HERE, 'land.mjs'), 'utf8');
  const libs = [...src.matchAll(/from '\.\/(lib\/[\w.-]+\.mjs)'/g)].map(m => m[1]);
  return ['land.mjs', ...libs].map(rel => ({ rel: `scripts/${rel}`, abs: path.join(HERE, rel) }));
}
/** true when every lander file is byte-identical to origin/main's copy; false when one differs; null when main has
 *  no scripts/land.mjs at all (a repository the lander is being tested in). */
async function sameLanderAsMain() {
  for (const f of LANDER_AT_START) {
    const r = await git(['show', `${MAIN}:${f.rel}`], { ok: true });
    if (r.code !== 0) return f.rel === 'scripts/land.mjs' ? null : false;
    if (f.text === null || r.out !== f.text.trim()) return false;
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
  const tag = REPO_TAG;
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
  // One starter per repository. Populate the temporary directory before it becomes the claim.
  const claim = path.join(STATE, `lander-main-${tag}.starting`);
  const claimOwner = path.join(claim, 'owner');
  const retiredPath = identity => `${claim}.retired-${identity.dev}-${identity.ino}`;
  const claimIsCurrent = () => {
    let age = Infinity;
    try { age = Date.now() - fs.statSync(claim).mtimeMs; } catch { /* gone */ }
    let owner = null;
    try { owner = Number(fs.readFileSync(claimOwner, 'utf8')); } catch { /* an old claim */ }
    if (!Number.isInteger(owner) || owner <= 0) return age < 60_000;   // an unreadable owner gets one minute
    return age < 600_000 && pidAlive(owner);
  };
  // A retired claim is only a rename target for a waiter that is mid-check; after the claim's own 10 min cap none is.
  // Rename before removing: an emptied retired dir would accept a racing waiter's rename. Also sweep the temp dirs of
  // a starter that was killed before its finally.
  let names = [];
  try { names = fs.readdirSync(STATE); } catch { /* no state yet */ }
  for (const f of names) {
    if (!f.startsWith(`${path.basename(claim)}.retired-`) && !f.startsWith(`.${path.basename(claim)}-`)) continue;
    try {
      const p = path.join(STATE, f);
      if (Date.now() - fs.statSync(p).mtimeMs <= 600_000) continue;
      const trash = path.join(STATE, `.trash-${crypto.randomUUID()}`);
      fs.renameSync(p, trash);
      fs.rmSync(trash, { recursive: true, force: true });
    } catch { /* another waiter swept it */ }
  }
  let claimed = null;
  for (let attempt = 0; attempt < 2 && !claimed; attempt++) {
    const temp = fs.mkdtempSync(path.join(STATE, `.${path.basename(claim)}-`));
    try {
      fs.writeFileSync(path.join(temp, 'owner'), String(process.pid));
      try {
        if (fs.existsSync(claim)) {
          const error = new Error('the start claim exists');
          error.code = 'EEXIST';
          throw error;
        }
        fs.renameSync(temp, claim);
        claimed = fs.statSync(claim);
      }
      catch (e) {
        if (e.code !== 'EEXIST' && e.code !== 'ENOTEMPTY') throw e;
        if (claimIsCurrent()) return true;
        let stale;
        try { stale = fs.statSync(claim); } catch { return true; }
        if (claimIsCurrent()) return true;
        // Keep the retired directory as a non-empty target. Another waiter that saw the same stale claim cannot
        // rename a newly published claim over it, even if its stale check finished before ours.
        try { fs.mkdirSync(path.join(claim, '.retired')); }
        catch (err) { if (err.code === 'ENOENT') return true; if (err.code !== 'EEXIST') throw err; }
        try { fs.renameSync(claim, retiredPath(stale)); }
        catch (err) { if (['EEXIST', 'ENOTEMPTY', 'ENOENT'].includes(err.code)) return true; throw err; }
      }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
  if (!claimed) return true;
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
  } finally {
    // The retired path stays populated. A waiter that inspected this claim earlier cannot remove its successor.
    try { fs.renameSync(claim, retiredPath(claimed)); } catch { /* another waiter retired it */ }
  }
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
  if (r.fix_main) console.log(`land: fix-main: ${r.fix_main}`);
  if (r.status === 'landed') {
    const ci = r.ci_url || ciUrl(r.main_sha);
    console.log(`land: ${r.id} landed; main ${r.main_sha}${ci ? `\nland: CI ${ci}` : ''}`);
  } else if (r.status === 'conflict') {
    console.log(`land: ${r.id} conflicts with ${r.conflicts_with || 'main'} in: ${(r.conflict_files || []).join(', ') || '(no file list)'}; the branch is now land-failed/${r.id}`);
  } else if (r.status === 'withdrawn') {
    console.log(`land: ${r.id} withdrawn; it was removed from the queue`);
  } else {
    console.log(`land: ${r.id} is red: ${[(r.failed_jobs || []).join(', '), r.note].filter(Boolean).join('; ')}${r.log ? `\nland: log ${r.log}` : ''}; the branch is now land-failed/${r.id}`);
  }
  return EXIT[r.status] ?? EXIT.red;
}

// ---- commands ----------------------------------------------------------------------------------------------------
const slugify = (s, max) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');

async function submit() {
  const rawReason = flag('--fix-main') ? opt('--fix-main', '') : null;
  if (rawReason !== null && /[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(rawReason)) die('--fix-main reason must not contain control characters or line separators');
  const reason = rawReason === null ? null : rawReason.trim();
  if (flag('--fix-main') && (!reason || reason.startsWith('--'))) die('submit needs a non-empty --fix-main <reason>');
  if (reason !== null && [...reason].length > 300) die('--fix-main reason must be 300 characters or fewer');
  const owner = slugify(opt('--owner', ''), 24).replace(/-/g, '_');
  if (!owner) die('submit needs --owner <name>');
  await guard();
  if ((await gitOut(['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT })).length) die('the working tree has uncommitted changes; commit or stash them first');
  const untracked = await gitOut(['status', '--porcelain', '--untracked-files=normal'], { cwd: ROOT });
  if (untracked) console.log('land: note: untracked files are not submitted');
  await fetchRemote();
  const changed = lines(await gitOut(['diff', '--name-only', `${MAIN}...HEAD`], { cwd: ROOT }));
  // E2: a docs change is checked before it queues, so a hygiene red costs seconds here, not a lander gate. Only in a
  // checkout that has the runner (a test repository has none).
  if (changed.some(file => file.startsWith('docs/')) && fs.existsSync(path.join(ROOT, 'mcp', 'run_tests.py'))) {
    const python = [path.join(ROOT, '.venv', 'bin', 'python'), 'python3'].find(bin => {
      try { execFileSync(bin, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
    });
    if (!python) console.log('land: note: Python is unavailable; skipping docs hygiene');
    else {
      let output = '';
      let failed = false;
      if (TEST && process.env.LAND_DOCS_HYGIENE_STUB) {
        output = process.env.LAND_DOCS_HYGIENE_STUB;
        failed = true;
      } else {
        try { output = execFileSync(python, ['mcp/run_tests.py', 'docs_hygiene'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (error) { output = `${error.stdout || ''}\n${error.stderr || ''}`; failed = true; }
      }
      if (failed) {
        const names = TEST && process.env.LAND_DOCS_HYGIENE_STUB
          ? [...new Set(process.env.LAND_DOCS_HYGIENE_STUB.split(/[\s,]+/).filter(Boolean))]
          : [...new Set(output.match(/^\s+test_[\w:]+/gm) || [])].map(name => name.trim());
        die(`docs hygiene failed${names.length ? `: ${names.join(', ')}` : ''}; fix it before you submit`);
      }
    }
  }
  if (reason !== null) {
    const existing = await queuedFixes(await queue());
    if (existing.length) die(`fix-main ${existing[0]} is already queued; only one fix-main entry may be queued`);
    if (readMainRed()?.main_sha !== await revParse(MAIN)) {
      console.log('land: warning: --fix-main is for a red main; the reason is recorded');
    }
  }
  if (Number(await gitOut(['rev-list', '--count', `${MAIN}..HEAD`], { cwd: ROOT })) === 0) die(`HEAD has no commit that ${REMOTE}/main lacks; nothing to land`);
  const branch = await gitOut(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT });
  const slug = slugify(opt('--note', '') || (branch === 'HEAD' ? 'detached' : branch), 40) || 'change';
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const id = `${stamp}-${owner}-${slug}`;
  const refs = [`HEAD:refs/heads/land/${id}`];
  if (reason !== null) {
    const tip = await gitOut(['rev-parse', 'HEAD'], { cwd: ROOT });
    const metadata = await gitOut(['commit-tree', `${tip}^{tree}`, '-p', tip, '-m', `fix-main: ${reason}`], { cwd: ROOT });
    refs.push(`${metadata}:refs/heads/land-fix/${id}`);
  }
  // Publish both refs together. A lander must never fetch the queue before it can see its fix-main marker.
  const p = await git(['push', '-q', ...(reason === null ? [] : ['--atomic']), REMOTE, ...refs], { ok: true, cwd: ROOT });
  if (p.code !== 0) die(`the push of land/${id}${reason === null ? '' : ` and land-fix/${id}`} failed: ${p.err}`, EXIT.error);
  await fetchRemote();
  const pos = (await queue()).indexOf(id) + 1;
  console.log(`land: submitted ${id} (queue position ${pos})`);
  if (reason !== null) console.log('land: fix-main will go into the next batch');
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
    // A lander stopped on this red main. Only a queued fix-main entry can make another run useful.
    const red = readMainRed();
    if (red && red.main_sha === await revParse(MAIN) && !holder() && !(await untriedFixes(await queue())).length) {
      die(`${id} is still queued: ${red.message}`, EXIT.error);
    }
    if (await driveIfIdle()) {
      const after = await resolve(id);
      if (after) process.exit(report(after));
    }
    // Every iteration: a queue the lander cannot empty must not turn this into an endless fetch loop.
    if (Date.now() >= deadline) { console.log(`land: ${id} has no result yet; timed out`); process.exit(EXIT.timeout); }
    await sleep(POLL_MS);
  }
}

/** Ask the running lander to exit after its current batch (between gates, never mid-push). The next `wait` or
 *  `status` then starts a lander on the current code. */
async function stop() {
  await guard();
  const entry = liveEntries(false)[0];
  if (!entry) { console.log('land: no lander is running'); return; }
  fs.mkdirSync(STATE, { recursive: true });
  writeJsonAtomic(STOP_REQUEST, { entry, time: new Date().toISOString() });
  console.log(`land: the lander (pid ${entryPid(entry)}) will stop after its current batch`);
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
  // Also the old unscoped marker: a lander still running code from before the per-remote markers reads only that one.
  const markers = [path.join(WITHDRAWN, id), path.join(STATE, 'withdrawn', id)];
  let done = false;
  if (!locked) {
    for (const m of markers) {
      fs.mkdirSync(path.dirname(m), { recursive: true });
      writeJsonAtomic(m, { owner, time: new Date().toISOString() });
    }
  }
  const unmark = () => { if (!locked && !done) for (const m of markers) fs.rmSync(m, { force: true }); };
  process.on('exit', unmark);
  try {
    if (!locked && inLiveBatch()) die(busy);
    await fetchRemote();
    const tip = await revParse(`${LAND}${id}`);
    const reason = await fixReason(id);
    const result = await resolve(id);
    if (result?.status === 'landed' || result?.status === 'red' || result?.status === 'conflict' || result?.status === 'withdrawn') {
      die(`${id} is already ${result.status}`);
    }
    if (!tip) die(`unknown id ${id}`);
    const mainNow = await revParse(MAIN);
    const previous = readResult(id);
    const preliminary = mainNow && await isAncestor(tip, mainNow)
      ? { id, status: 'landed', main_sha: mainNow, ...(reason === null ? {} : { fix_main: reason }) }
      : { id, status: 'withdrawn', ...(reason === null ? {} : { fix_main: reason }) };
    writeResult(preliminary);
    const del = await deleteQueueRefs(id);
    if (del.code !== 0) {
      if (previous) writeJsonAtomic(resultPath(id), previous);
      else fs.rmSync(resultPath(id), { force: true });
      die(`could not delete land/${id}: ${del.err}`, EXIT.error);
    }
    done = true;   // the ref is gone: the marker must stay, whatever the result below
    await fetchRemote();
    const latestMain = await revParse(MAIN);
    if (latestMain && await isAncestor(tip, latestMain)) {
      if (preliminary.status !== 'landed' || preliminary.main_sha !== latestMain) {
        writeResult({ id, status: 'landed', main_sha: latestMain, ...(reason === null ? {} : { fix_main: reason }) });
      }
      report({ id, status: 'landed', main_sha: latestMain, fix_main: reason });
      return;
    }
    if (await revParse(`${FAILED}${id}`)) {
      // A lander failed it meanwhile (red or conflict): drop the guess, and let status read the result from the refs.
      fs.rmSync(resultPath(id), { force: true });
      die(`${id} was failed by a lander meanwhile; see land-failed/${id}`);
    }
    console.log(`land: ${id} withdrawn by ${owner}${locked ? '' : ' (a lander is running; it will skip it)'}`);
  } finally { unmark(); if (locked) release(); }
}

async function status() {
  await guard();
  await fetchRemote();
  const q = await queue();
  console.log(`land: queue (${q.length})`);
  for (const [i, id] of q.entries()) {
    const reason = await fixReason(id);
    console.log(`  ${i + 1}. ${id}${reason === null ? '' : `  fix-main: ${reason}`}`);
  }
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
    for (const r of recent) console.log(`  ${r.status.padEnd(9)}${r.id}${r.fix_main ? `  fix-main: ${r.fix_main}` : ''}`);
  }
  console.log(`land: ${flakeSummary()}`);
  const id = positional[0];
  if (id) {
    const r = await resolve(id);
    if (r) report(r);
    else if (q.includes(id)) {
      const reason = await fixReason(id);
      console.log(`land: ${id}: queued (position ${q.indexOf(id) + 1})${reason === null ? '' : `; fix-main: ${reason}`}`);
    }
    else console.log(`land: ${id}: unknown`);
  }
  if (!flag('--no-drive')) await driveIfIdle();
}

/** The time an id was submitted, from its UTC stamp (submit()), or NaN. */
function idTime(id) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/.exec(id);
  if (!m) return NaN;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  // Date.UTC rolls an impossible stamp over (month 13, day 32): such a name was not made by submit().
  return new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14) === id.slice(0, 14) ? ms : NaN;
}

/** OP8 (2026-10-10 review): nothing removed old land-failed/<id> refs (every poll fetches them all) or the lander's
 *  local results, withdrawn markers and flake rows. Prune what was submitted more than --older-than-days ago. Only
 *  names this lane makes (ID_RE) are touched, never an id still queued or in a batch. The flake log is rewritten only
 *  while prune holds the lander lock, since a running lander appends to it; a line that does not parse is kept. */
async function prune() {
  await guard();
  const days = Number(flag('--older-than-days') ? opt('--older-than-days', '') : '14');
  if (!Number.isFinite(days) || days < 1) die('--older-than-days needs a number of days, 1 or more');
  const dry = flag('--dry-run');
  const cutoff = Date.now() - days * 86_400_000;
  const verb = dry ? 'would delete' : 'deleted';
  // Holding the lock, no lander starts while prune runs; without it, a lander is running, and prune leaves the flake
  // log and the in-flight ids alone.
  const locked = dry ? false : await acquire();
  const running = dry ? Boolean(holder()) : !locked;
  await fetchRemote();
  const live = new Set(await queue());
  // A running lander's batch is in flight. With no lander, active-batch.json is a crashed one's leftover.
  if (running) try { for (const id of JSON.parse(fs.readFileSync(ACTIVE_BATCH, 'utf8')).ids || []) live.add(id); } catch { /* no batch */ }
  const old = id => ID_RE.test(id) && idTime(id) < cutoff && !live.has(id);
  const refs = lines(await gitOut(['for-each-ref', '--format=%(refname)', FAILED])).map(r => r.slice(FAILED.length)).filter(old);
  const orphanFixes = (await refIds(FIX)).filter(id => ID_RE.test(id) && !live.has(id));
  let failedPush = null;
  if (!dry && refs.length) {
    let err = '';
    for (let i = 0; i < refs.length; i += 50) {
      const d = await git(['push', '-q', REMOTE, '--delete', ...refs.slice(i, i + 50).map(id => `refs/heads/land-failed/${id}`)], { ok: true });
      if (d.code !== 0) err = d.err || `exit ${d.code}`;
    }
    // Git's exit code mixes a ref another prune already deleted with a real failure (and a timeout prints no
    // "error"), so ask the remote what is left.
    if (err) {
      await fetchRemote();
      const left = new Set(lines(await gitOut(['for-each-ref', '--format=%(refname)', FAILED])).map(r => r.slice(FAILED.length)));
      const stuck = refs.filter(id => left.has(id));
      if (stuck.length) failedPush = `${stuck.length} ref(s) still there (${err.split('\n')[0]})`;
    }
  }
  console.log(`land: ${verb} ${refs.length} land-failed ref(s) submitted more than ${days} days ago`);
  let failedFixPush = null;
  if (!dry && orphanFixes.length) {
    for (let i = 0; i < orphanFixes.length; i += 50) {
      const d = await git(['push', '-q', REMOTE, '--delete', ...orphanFixes.slice(i, i + 50).map(id => `refs/heads/land-fix/${id}`)], { ok: true });
      if (d.code !== 0) failedFixPush = d.err || `exit ${d.code}`;
    }
    if (failedFixPush) {
      await fetchRemote();
      const left = new Set(await refIds(FIX));
      const stuck = orphanFixes.filter(id => left.has(id));
      failedFixPush = stuck.length ? `${stuck.length} ref(s) still there (${failedFixPush.split('\n')[0]})` : null;
    }
  }
  console.log(`land: ${verb} ${orphanFixes.length} orphan land-fix ref(s)`);
  const files = [];
  try { for (const f of fs.readdirSync(STATE)) if (f.endsWith('.json') && old(f.slice(0, -5))) files.push(path.join(STATE, f)); } catch { /* no state */ }
  // A marker is the withdraw handshake with a running lander: only while prune holds the lock is none in use.
  if (!running) {
    for (const dir of [WITHDRAWN, path.join(STATE, 'withdrawn')]) {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
          if (entry.isFile() && old(entry.name)) files.push(path.join(dir, entry.name));
      } catch { /* none */ }
    }
  }
  if (!dry) for (const f of files) fs.rmSync(f, { force: true });
  console.log(`land: ${verb} ${files.length} local result(s) and withdrawn marker(s)`);
  let raw = [];
  try { raw = fs.readFileSync(FLAKES, 'utf8').split('\n').filter(l => l.trim()); } catch { /* no flakes */ }
  const keepLine = l => {
    let r;
    try { r = JSON.parse(l); } catch { return true; }   // a hand-typed line with a typo stays for a person to fix
    if (r?.incident) return (Date.parse(r.incident.to) || Infinity) >= cutoff;   // recent or still open
    return !(Date.parse(r?.time) < cutoff);   // an unparsable time is kept, never guessed away
  };
  const keep = raw.filter(keepLine);
  if (keep.length < raw.length) {
    if (running) console.log('land: a lander is running, so the flake log is left as it is; prune again later');
    else {
      if (!dry) {
        const tmp = `${FLAKES}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, keep.map(l => `${l}\n`).join(''));
        fs.renameSync(tmp, FLAKES);
      }
      console.log(`land: ${verb} ${raw.length - keep.length} flake row(s) older than ${days} days`);
    }
  }
  if (locked) release();
  if (failedPush) die(`could not delete some land-failed refs: ${failedPush}`, EXIT.error);
  if (failedFixPush) die(`could not delete some land-fix refs: ${failedFixPush}`, EXIT.error);
}

const COMMANDS = { submit, run, wait, status, withdraw, prune, stop };
const USAGE = 'usage: node scripts/land.mjs submit --owner <name> [--note <text>] [--fix-main <reason>] | run [--batch N] [--dry-run] | wait <id> [--timeout-min N] | status [id] [--no-drive] | withdraw <id> --owner <name> | prune [--older-than-days N] [--dry-run] | stop   (all take [--remote origin])';
if (!COMMANDS[CMD]) {
  console.log(USAGE);
  process.exit(CMD ? EXIT.refused : 0);
}
// brx1, 2026-10-10: `wait <id> --timeout 21600` ran to the 60 min default, because an unknown flag was ignored.
const FLAGS = {
  submit: ['--owner', '--note', '--fix-main'], run: ['--batch', '--dry-run'], wait: ['--timeout-min'], status: ['--no-drive'],
  withdraw: ['--owner'], prune: ['--older-than-days', '--dry-run'], stop: [],
};
const editDistance = (a, b) => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
};
const TEXT_VALUED = new Set(['--owner', '--note', '--fix-main', '--remote']);   // `run --batch --dryrun` must not hide the typo
const POSITIONALS = { submit: 0, run: 0, wait: 1, status: 1, withdraw: 1, prune: 0, stop: 0 };
const refuse = msg => { console.error(`land: ${msg}\n${USAGE}`); process.exit(EXIT.refused); };
for (const [i, a] of argv.entries()) {
  if (i === 0 || TEXT_VALUED.has(argv[i - 1])) continue;   // a free-text value may start with --; a number may not
  if (!/^(-|\u2013|\u2014)/.test(a)) continue;   // also a single dash, or a dash a keyboard autocorrected
  const mine = [...FLAGS[CMD], '--remote'];
  if (mine.includes(a)) continue;
  const name = `--${a.replace(/^(-+|\u2013|\u2014)/, '').split('=')[0]}`;
  if (Object.values(FLAGS).flat().includes(name) && !mine.includes(name)) refuse(`${CMD} does not take ${name}`);
  const near = mine.map(f => [f.startsWith(name) || name.startsWith(f) ? 0 : editDistance(name, f), f]).sort((x, y) => x[0] - y[0])[0][1];
  refuse(`unknown flag ${a}; did you mean ${near}?`);
}
if (positional.length > POSITIONALS[CMD]) refuse(`${CMD} takes ${POSITIONALS[CMD] || 'no'} id; unexpected ${positional.slice(POSITIONALS[CMD]).join(' ')}`);
try { await COMMANDS[CMD](); }
catch (e) {
  // Exit 1 means "red" to `wait`'s caller: an unexpected error (a failed fetch, say) must not read as one.
  console.error(`land: ${e instanceof LandError ? '' : 'unexpected error: '}${e.message}`);
  process.exit(EXIT.error);
}
