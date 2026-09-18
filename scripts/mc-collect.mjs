#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, realpathSync, lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, venvPython } from './lib/launcher.mjs';

const home = process.env.BRX_MCP_HOME || join(homedir(), '.brx-mcp');
const requested = process.argv[2];
const sessionsDir = join(home, 'sessions');
if (!existsSync(sessionsDir)) { console.error(`No session evidence under ${sessionsDir}`); process.exit(1); }
const ids = readdirSync(sessionsDir).filter(name => existsSync(join(sessionsDir, name, 'manifest.json'))).sort();
const id = requested || ids.at(-1);
if (!id || !ids.includes(id)) { console.error(`Usage: pnpm mc:collect [session-id]\nAvailable: ${ids.join(', ') || '(none)'}`); process.exit(1); }
const dir = resolve(sessionsDir, id);
const rootReal = realpathSync(sessionsDir);
const dirReal = realpathSync(dir);
if (!dirReal.startsWith(rootReal + sep) || !lstatSync(dir).isDirectory()) { console.error('Selected session is not a regular directory inside the sessions root.'); process.exit(1); }
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const sqlite = join(dir, 'session.sqlite');
if (!existsSync(sqlite)) { console.error(`Evidence store is missing: ${sqlite}`); process.exit(1); }
if (!lstatSync(sqlite).isFile() || !realpathSync(sqlite).startsWith(dirReal + sep)) { console.error('Evidence store is not a regular file inside the selected session.'); process.exit(1); }
const rawLog = join(dir, 'mc.log');
if (existsSync(rawLog)) {
  mkdirSync(join(dir, 'diagnostics'), { recursive: true });
  const redacted = readFileSync(rawLog, 'utf8')
    .replace(/#tok=[^\s)]+/g, '#tok=[REDACTED]')
    .replace(/operator token:\s+\S+/g, 'operator token: [REDACTED]')
    .replace(/\b(?:token|authorization)=?\s*[^\s]+/gi, 'token=[REDACTED]');
  writeFileSync(join(dir, 'diagnostics', 'mc.redacted.log'), redacted);
}
{
  const diag = spawnSync(venvPython(), ['-m', 'brx_mcp.mc.diag', sqlite, '--json'], { env: { ...process.env, PYTHONPATH: join(root, 'mcp') }, encoding: 'utf8' });
  if (diag.status === 0) {
    const diagnostics = join(dir, 'diagnostics');
    mkdirSync(diagnostics, { recursive: true });
    copyFileSync(join(dir, 'manifest.json'), join(diagnostics, 'manifest.json'));
    writeFileSync(join(diagnostics, 'matches.json'), diag.stdout);
  } else {
    console.error(`Diagnostic failed (exit ${diag.status ?? 'unknown'}).`);
    if (diag.stderr) console.error(diag.stderr.trim());
    process.exit(1);
  }
}
console.log(`Evidence ready: ${dir}`);
console.log(`Manifest: ${JSON.stringify(manifest)}`);
