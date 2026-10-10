#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
// Run Mission Control from an environment that is already set up. `start.mjs` (./start.sh, start.cmd)
// sets it up first and then runs this. Arguments after the script name go to `python -m brx_mcp.mc`.
import { createWriteStream, existsSync, mkdirSync, renameSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { DAYS_DEFAULT, KEEP_DEFAULT, formatBytes, pruneEvidence } from './lib/evidence.mjs';
import { lineRedactor } from './lib/redact.mjs';
import { isWindows, npm, numericFlag, root, uiStale, venvPython, which } from './lib/launcher.mjs';

// `--keep-all` is ours (no pruning of old sessions): it must not reach Mission Control, whose parser would refuse it.
const keepAll = process.argv.slice(2).includes('--keep-all');
const mcArgs = process.argv.slice(2).filter(arg => arg !== '--keep-all');
const httpPort = numericFlag(mcArgs, '--port', 8765);
const wsPort = numericFlag(mcArgs, '--ws-port', 8766);
const noAuth = mcArgs.includes('--no-auth');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const home = process.env.BRX_MCP_HOME || join(homedir(), '.brx-mcp');
const launchId = `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
const evidence = join(home, 'sessions', launchId);
const logPath = join(evidence, 'mc.log');
const manifestPath = join(evidence, 'manifest.json');
mkdirSync(evidence, { recursive: true, mode: 0o700 });
chmodSync(evidence, 0o700);
// The manifest (status `starting`) goes in at once and atomically, so a concurrent launch's prune finds a
// folder it can read. (The pruner also never removes a folder younger than ten minutes.)
{
  const early = `${manifestPath}.tmp`;
  writeFileSync(early, JSON.stringify({ format: 1, launch_id: launchId, started_at: new Date().toISOString(), evidence_dir: evidence, status: 'starting' }, null, 2) + '\n', { mode: 0o600 });
  renameSync(early, manifestPath);
}
// Old evidence: print the size, then remove launch folders that are BOTH outside the newest N and older than D days
// (BRX_MC_KEEP_SESSIONS / BRX_MC_KEEP_DAYS, default 30 / 30). This launch is never touched. `--keep-all` skips it.
{
  const sessionsDir = join(home, 'sessions');
  const positive = (name, fallback) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 && process.env[name] ? n : fallback; };
  try {
    const result = pruneEvidence({ sessionsDir, currentId: launchId, keepAll, keep: positive('BRX_MC_KEEP_SESSIONS', KEEP_DEFAULT),
      days: positive('BRX_MC_KEEP_DAYS', DAYS_DEFAULT), log: line => console.log(line) });
    const freed = result.removed.reduce((sum, r) => sum + r.bytes, 0);
    console.log(`Evidence: ${result.count} sessions, ${formatBytes(result.sizeBefore)} under ${sessionsDir}` +
      (keepAll ? ' (--keep-all: nothing removed)' : result.removed.length ? `; removed ${result.removed.length}, freed ${formatBytes(freed)}` : ''));
  } catch (error) { console.error(`Evidence prune skipped: ${error.message}`); }
}
let child = null;

/** MC exited 0 during start-up because the launcher asked it to (a stop before it answered its health check). */
function stoppedDuringStartup() {
  for (const redactor of redactors) redactor.end();   // the tail of mc.log for this stop
  log.end();
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    Object.assign(m, { status: 'stopped', ended_at: new Date().toISOString(), exit_code: 0, exit_signal: null });
    writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
  } catch { /* the manifest is evidence, not a reason to fail the stop */ }
  console.log('Mission Control stopped during start-up.');
  log.on('finish', () => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
  return new Promise(() => {});   // never settles: the start-up flow must not carry on into fail()
}
function fail(message) {
  console.error(`MC startup failed: ${message}`);
  if (child && child.exitCode === null) child.kill('SIGTERM');
  console.error(`Evidence directory: ${evidence}`);
  process.exit(1);
}
function portFree(port, host = '127.0.0.1') {
  return new Promise(resolvePort => {
    const server = net.createServer();
    server.once('error', () => resolvePort(false));
    server.once('listening', () => server.close(() => resolvePort(true)));
    server.listen(port, host);
  });
}
async function waitFor(url, child, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // We asked it to stop: an exit 0 (the graceful path) or a death by our own fallback signal is a clean stop.
    if (stopping && (child.exitCode === 0 || child.signalCode)) return stoppedDuringStartup();
    if (child.exitCode !== null) fail(`server exited with code ${child.exitCode}; see ${logPath}`);
    try {
      const response = await fetch(url);
      if (response.ok) {
        await new Promise(resolveWait => setTimeout(resolveWait, 250));
        if (child.exitCode === null && !child.signalCode) return;
        if (stopping) return stoppedDuringStartup();
        fail(`server exited after answering health check; see ${logPath}`);
      }
    } catch (_) { /* still starting */ }
    await new Promise(resolveWait => setTimeout(resolveWait, 150));
  }
  fail(`MC did not answer ${url}; see ${logPath}`);
}
// Open the URL in the default browser. The URL always prints too, so a failure here costs nothing.
function openBrowser(url) {
  let result = null;
  if (process.platform === 'darwin') result = spawnSync('open', [url], { stdio: 'ignore' });
  // `start` is a cmd built-in; its first quoted argument is a window title, hence the empty "".
  else if (isWindows) result = spawnSync('cmd', ['/c', 'start', '""', `"${url}"`], { stdio: 'ignore', windowsVerbatimArguments: true });
  else if (which('xdg-open') && !process.env.WSL_DISTRO_NAME) result = spawnSync('xdg-open', [url], { stdio: 'ignore' });
  if (!result || result.status !== 0) console.log(`Open this URL in a browser: ${url}`);
}

const python = venvPython();
if (!existsSync(python)) {
  fail(`missing ${python}. Run the start script first (./start.sh, or start.cmd on Windows).`);
}
if (uiStale()) {
  if (!existsSync(join(root, 'webapp', 'mc', 'node_modules'))) {
    fail('Mission Control UI is not built and webapp/mc/node_modules is missing. Run the start script first (./start.sh, or start.cmd on Windows).');
  }
  const build = npm(['run', 'build'], join(root, 'webapp', 'mc'));
  if (build.status !== 0) fail('Mission Control UI build failed.');
}
for (const [name, port] of [['HTTP', httpPort], ['nodes', wsPort]]) {
  if (!(await portFree(port))) fail(`${name} port ${port} is already in use. Another Mission Control is probably still running: close it first.`);
}

writeFileSync(manifestPath, JSON.stringify({
  format: 1, launch_id: launchId, started_at: new Date().toISOString(),
  repo: root, platform: process.platform, node: process.version,
  evidence_dir: evidence, mc_log: logPath, status: 'starting'
}, null, 2) + '\n');
chmodSync(manifestPath, 0o600);
const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
child = spawn(python, ['-m', 'brx_mcp.mc', '--evidence-dir', evidence, '-v', ...mcArgs], {
  cwd: root, env: { ...process.env, PYTHONPATH: join(root, 'mcp'), PYTHONIOENCODING: 'utf-8', BRX_MC_LAUNCH_ID: launchId }, stdio: ['inherit', 'pipe', 'pipe']
});
let output = '';
// Keep only the start-up output: it holds the URL. After that, a long -v match would grow it without limit.
// The log gets whole lines, redacted (scripts/lib/redact.mjs): a token split across two chunks is whole again by then.
// One redactor per stream, so stdout and stderr lines never join. The console still gets each chunk at once.
const redactors = [child.stdout, child.stderr].map(stream => {
  const redactor = lineRedactor(text => log.write(text));
  stream.on('data', chunk => {
    const text = chunk.toString();
    if (output.length < 1_000_000) output += text;
    if (!token) token = (output.match(/Mission Control\s+http:\/\/\S*#tok=([^\s#]+)\s/) || [])[1] || '';   // a stop during start-up needs it too
    redactor.push(text); process.stdout.write(text);
  });
  return redactor;
});
child.on('error', error => fail(error.message));
// Registered as soon as MC runs: a stop during start-up must not kill the launcher before it can stop MC.
// Stop MC gracefully first: POST /api/shutdown (brx3, a23d8b2f) lets uvicorn stop and the lifespan write the session
// snapshot, then MC exits 0. Only if that fails or MC is still up 5 s later does the launcher kill it. On Windows
// child.kill() is a hard TerminateProcess that skips every Python handler, so without this a Stop lost up to 2 s of
// edits (the debounced snapshot). The token is the one in MC's own printed URL; with --no-auth MC accepts loopback.
let token = '';   // set once MC prints its URL; a stop before then falls back to the kill
let stopping = false;
async function stop() {
  if (stopping || child.exitCode !== null) return;
  stopping = true;
  try {
    await fetch(`http://127.0.0.1:${httpPort}/api/shutdown`, {
      method: 'POST', signal: AbortSignal.timeout(3000),
      headers: { 'X-BRX-Shutdown': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch { /* MC did not answer: the kill below still stops it */ }
  // 10 s: MC's lifespan stops a backhaul tunnel (up to about 6 s) before it writes the snapshot.
  for (let w = 0; w < 10_000 && child.exitCode === null && child.signalCode === null; w += 100) {
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
}
// Ctrl+C in a terminal reaches Mission Control directly: it is in the same process group. Forwarding it
// again made a second interrupt, and uvicorn printed a traceback on every normal stop. So wait, and stop
// it only if Mission Control is still running (a SIGINT sent to this process alone, e.g. `kill -INT`).
process.on('SIGINT', () => { setTimeout(() => { void stop(); }, 5000).unref(); });
process.on('SIGTERM', () => { void stop(); });
// SIGHUP (a closed terminal or Windows console) and Windows Ctrl+Break also take the graceful path. Honestly, a closed
// terminal usually kills MC directly first (POSIX sends SIGHUP to the whole group; Windows ends python.exe on
// CTRL_CLOSE), so the snapshot flush there depends on MC; the launcher still records the stop and does not crash on
// the dead terminal.
for (const stream of [process.stdout, process.stderr]) stream.on('error', () => { /* a hung-up terminal: keep going */ });
process.on('SIGHUP', () => { void stop(); });
if (isWindows) process.on('SIGBREAK', () => { void stop(); });
await waitFor(`http://127.0.0.1:${httpPort}/`, child);
const urlMatch = output.match(/Mission Control\s+(http:\/\/[^\s]+)/);
if (!urlMatch || (!noAuth && !/#tok=[^\s#]+/.test(urlMatch[1]))) fail(`MC did not print an authenticated URL; see ${logPath}`);
const url = urlMatch[1];
token = (url.match(/#tok=([^\s#]+)/) || [])[1] || token;
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.status = 'running'; manifest.url = url.replace(/#tok=.*$/, ''); manifest.pid = child.pid;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Session evidence: ${evidence}`);
openBrowser(url);

await new Promise(resolveExit => child.once('exit', (code, signal) => {
  manifest.status = code === 0 || signal === 'SIGINT' || signal === 'SIGTERM' || signal === 'SIGHUP' ? 'stopped' : 'crashed';
  manifest.ended_at = new Date().toISOString(); manifest.exit_code = code; manifest.exit_signal = signal;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  resolveExit();
}));
// `exit` can come before the last pipe data: wait for both pipes to close, then write each trailing partial line.
await Promise.all([child.stdout, child.stderr].map(stream => stream.readableEnded || stream.destroyed ? null : new Promise(done => { stream.once('close', done); stream.once('end', done); })));
for (const redactor of redactors) redactor.end();
log.end();
process.exitCode = manifest.status === 'stopped' ? 0 : 1;
// A demo (--ephemeral) keeps no session store here, so there is nothing to report: say nothing then.
if (existsSync(join(evidence, 'session.sqlite'))) {
  const reportCmd = `${isWindows ? 'start.cmd' : './start.sh'} --report ${launchId}`;
  console.log(manifest.status === 'crashed'
    ? `Mission Control stopped with an error. To report it, run ${reportCmd}`
    : `Found a problem? ${reportCmd} makes a bug report for this session.`);
}
