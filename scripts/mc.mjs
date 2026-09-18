#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
// Run Mission Control from an environment that is already set up. `start.mjs` (./start.sh, start.cmd)
// sets it up first and then runs this. Arguments after the script name go to `python -m brx_mcp.mc`.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { isWindows, npm, numericFlag, root, uiStale, venvPython, which } from './lib/launcher.mjs';

const mcArgs = process.argv.slice(2);
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
let child = null;

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
    if (child.exitCode !== null) fail(`server exited with code ${child.exitCode}; see ${logPath}`);
    try {
      const response = await fetch(url);
      if (response.ok) {
        await new Promise(resolveWait => setTimeout(resolveWait, 250));
        if (child.exitCode === null) return;
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
const capture = chunk => { const text = chunk.toString(); if (output.length < 1_000_000) output += text; log.write(text.replace(/#tok=[^\s)]+/g, '#tok=[REDACTED]').replace(/operator token:\s+\S+/g, 'operator token: [REDACTED]')); process.stdout.write(text); };
child.stdout.on('data', capture);
child.stderr.on('data', capture);
child.on('error', error => fail(error.message));
await waitFor(`http://127.0.0.1:${httpPort}/`, child);
const urlMatch = output.match(/Mission Control\s+(http:\/\/[^\s]+)/);
if (!urlMatch || (!noAuth && !/#tok=[^\s#]+/.test(urlMatch[1]))) fail(`MC did not print an authenticated URL; see ${logPath}`);
const url = urlMatch[1];
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.status = 'running'; manifest.url = url.replace(/#tok=.*$/, ''); manifest.pid = child.pid;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Session evidence: ${evidence}`);
openBrowser(url);
const stop = signal => { if (child.exitCode === null) child.kill(signal); };
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
await new Promise(resolveExit => child.once('exit', (code, signal) => {
  manifest.status = code === 0 || signal === 'SIGINT' || signal === 'SIGTERM' ? 'stopped' : 'crashed';
  manifest.ended_at = new Date().toISOString(); manifest.exit_code = code; manifest.exit_signal = signal;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  resolveExit();
}));
log.end();
process.exitCode = manifest.status === 'stopped' ? 0 : 1;
