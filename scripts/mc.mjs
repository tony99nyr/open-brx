#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
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
function commandOk(command, args) {
  return spawnSync(command, args, { cwd: root, stdio: 'ignore' }).status === 0;
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
function openBrowser(url) {
  if (platform() !== 'darwin') {
    console.log(`Open this URL in a browser: ${url}`);
    return;
  }
  const result = spawnSync('open', [url], { stdio: 'ignore' });
  if (result.status !== 0) console.log(`Open this URL in a browser: ${url}`);
}

if (!existsSync(join(root, '.venv', 'bin', 'python'))) {
  fail('missing .venv/bin/python. Run the one-time Mac setup from docs/mac-dev-runbook.md.');
}
function newestMtime(directory) {
  let newest = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}
const uiIndex = join(root, 'webapp', 'mc', 'dist', 'index.html');
const uiInputs = ['src', 'public', 'vite.config.ts', 'package.json'].map(name => join(root, 'webapp', 'mc', name));
const newestInput = Math.max(...uiInputs.filter(path => existsSync(path)).map(path => statSync(path).isDirectory() ? newestMtime(path) : statSync(path).mtimeMs));
if (!existsSync(uiIndex) || newestInput > statSync(uiIndex).mtimeMs) {
  if (!existsSync(join(root, 'webapp', 'mc', 'node_modules'))) {
    fail('Mission Control UI is not built and webapp/mc/node_modules is missing. Run `cd webapp/mc && npm install && npm run build` once at home.');
  }
  const build = spawnSync('npm', ['run', 'build'], { cwd: join(root, 'webapp', 'mc'), stdio: 'inherit' });
  if (build.status !== 0) fail('Mission Control UI build failed.');
}
for (const [name, port] of [['HTTP', 8765], ['nodes', 8766]]) {
  if (!(await portFree(port))) fail(`${name} port ${port} is already in use. Close the old MC or pass it a different port while investigating.`);
}

writeFileSync(manifestPath, JSON.stringify({
  format: 1, launch_id: launchId, started_at: new Date().toISOString(),
  repo: root, platform: process.platform, node: process.version,
  evidence_dir: evidence, mc_log: logPath, status: 'starting'
}, null, 2) + '\n');
chmodSync(manifestPath, 0o600);
const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 });
child = spawn(join(root, '.venv', 'bin', 'python'), ['-m', 'brx_mcp.mc', '--evidence-dir', evidence, '-v'], {
  cwd: root, env: { ...process.env, PYTHONPATH: join(root, 'mcp'), BRX_MC_LAUNCH_ID: launchId }, stdio: ['inherit', 'pipe', 'pipe']
});
let output = '';
const capture = chunk => { const text = chunk.toString(); output += text; log.write(text.replace(/#tok=[^\s)]+/g, '#tok=[REDACTED]').replace(/operator token:\s+\S+/g, 'operator token: [REDACTED]')); process.stdout.write(text); };
child.stdout.on('data', capture);
child.stderr.on('data', capture);
child.on('error', error => fail(error.message));
await waitFor('http://127.0.0.1:8765/', child);
const urlMatch = output.match(/Mission Control\s+(http:\/\/[^\s]+)/);
if (!urlMatch || !/#tok=[^\s#]+/.test(urlMatch[1])) fail(`MC did not print an authenticated URL; see ${logPath}`);
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
