// Helpers shared by the two laptop launchers: `start.mjs` (set up, then run) and `mc.mjs` (run only).
// Everything here must work on macOS, Windows and Linux, and must not need any npm package.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { bundleStale } from './bundles.mjs';

export const root = resolve(import.meta.dirname, '..', '..');
export const isWindows = process.platform === 'win32';
// The lowest Node both builds accept: vite (webapp/mc) needs ^20.19 or >=22.12, the Capacitor CLI (app) >=22.0.
export const NODE_FLOOR = '22.12';

/** The Mission Control virtualenv's interpreter. Windows venvs put it under Scripts\, not bin/. */
export function venvPython() {
  return isWindows ? join(root, '.venv', 'Scripts', 'python.exe') : join(root, '.venv', 'bin', 'python');
}

/** The first `name` on PATH (with the Windows executable extensions), or null. No shell involved. */
export function which(name) {
  const exts = isWindows ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').concat(['']) : [''];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const path = join(dir, name + ext);
      try {
        if (statSync(path).isFile()) return path;
      } catch (error) {
        // Windows app aliases (winget.exe in WindowsApps\) exist but refuse stat with EACCES.
        if (isWindows && error.code === 'EACCES') return path;
      }
    }
  }
  return null;
}

/** Run npm. On Windows npm is a .cmd file, which Node only starts through a shell. */
export function npm(args, cwd, stdio = 'inherit') {
  return spawnSync('npm', args, { cwd, stdio, shell: isWindows });
}

/** True when webapp/mc/dist is missing or older than any of its sources. */
export function uiStale() {
  return bundleStale(root, 'mc') !== null;
}

/** The value of `--flag N` or `--flag=N` in an argument list, as a number, or the fallback. */
export function numericFlag(args, flag, fallback) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1] !== undefined) return Number(args[i + 1]);
    if (args[i].startsWith(`${flag}=`)) return Number(args[i].slice(flag.length + 1));
  }
  return fallback;
}

/** The app version MC is compatible with, read from the text of `mcp/brx_mcp/mc/types.py`. */
export function appVersion(typesText) {
  const major = /^APP_MAJOR\s*=\s*(\d+)/m.exec(typesText || '');
  const minor = /^APP_MINOR\s*=\s*(\d+)/m.exec(typesText || '');
  return major && minor ? { major: Number(major[1]), minor: Number(minor[1]) } : null;
}

/** The loud warning when an update changes the app version, else null. While the app is on 0.x the
 *  MINOR tier is the breaking one (types.py, A29); from 1.0 on only MAJOR counts. */
export function phonesWarning(oldText, newText) {
  const from = appVersion(oldText);
  const to = appVersion(newText);
  if (!from || !to) return null;
  const breaking = from.major !== to.major || ((from.major === 0 || to.major === 0) && from.minor !== to.minor);
  if (!breaking) return null;
  return [
    '!!! PHONES MUST UPDATE TOO !!!',
    `This update changes the app version from ${from.major}.${from.minor} to ${to.major}.${to.minor}.`,
    'Phones on the old app will not work with the new Mission Control. Install the new app on every phone.',
  ].join('\n');
}

/** Hash of what the Python install depends on: the dependency list and the pinned versions. */
export function installStamp(repoRoot = root) {
  const hash = createHash('sha256');
  for (const name of ['pyproject.toml', 'constraints.txt']) {
    const path = join(repoRoot, 'mcp', name);
    hash.update(existsSync(path) ? readFileSync(path) : '');
  }
  return hash.digest('hex').slice(0, 16);
}

/** Fingerprints the declared npm inputs and the installed npm lock marker for one package directory. */
export function npmInstallState(dir) {
  const hash = createHash('sha256');
  for (const name of ['package-lock.json', 'package.json']) {
    const file = join(dir, name);
    const data = existsSync(file) ? readFileSync(file) : '';
    hash.update(data);
  }
  let installed = null;
  try {
    const modules = realpathSync(join(dir, 'node_modules'));
    installed = createHash('sha256').update(readFileSync(join(modules, '.package-lock.json'))).digest('hex');
  } catch { /* not installed */ }
  const packageJson = existsSync(join(dir, 'package.json')) ? readFileSync(join(dir, 'package.json'), 'utf8') : '';
  const lock = existsSync(join(dir, 'package-lock.json')) ? readFileSync(join(dir, 'package-lock.json'), 'utf8') : '';
  return { declared: hash.digest('hex').slice(0, 16), land: `${packageJson}\0${lock}`, installed };
}

// ---- macOS reachability preflight (F643) -------------------------------------------------------
/** Non-internal IPv4 addresses of this machine, from `os.networkInterfaces()` output. */
export function lanAddresses(interfaces) {
  const found = [];
  for (const list of Object.values(interfaces || {})) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) found.push(a.address);
  }
  return found;
}

/** Parse `socketfilterfw` text. `apps` (from --listapps) becomes { path: allowed }. Empty text gives null. */
export function parseFirewall({ globalState = '', stealth = '', apps = '' } = {}) {
  const apps2 = {};
  let path = null;
  for (const line of String(apps).split('\n')) {
    const entry = /^\s*\d+\s*:\s*(\/.+?)\s*$/.exec(line);
    if (entry) { path = entry[1]; continue; }
    if (path && /Allow incoming/i.test(line)) { apps2[path] = true; path = null; }
    else if (path && /Block incoming/i.test(line)) { apps2[path] = false; path = null; }
  }
  const firewallOn = globalState.trim() ? !/is disabled|State = 0/i.test(globalState) : null;
  const stealthOn = stealth.trim() ? /enabled/i.test(stealth) && !/disabled/i.test(stealth) : null;
  return { firewallOn, stealthOn, apps: apps2 };
}

/** Warning lines for a parsed firewall state and the real python path. Empty when all is well. */
export function firewallWarnings(state, pythonPath) {
  const out = [];
  if (state.stealthOn) out.push('Stealth mode is ON: this Mac ignores ping, so phones may seem unable to reach it.');
  if (state.firewallOn && state.apps[pythonPath] !== true) {
    out.push(`The firewall is ON and ${pythonPath} is not set to allow incoming connections. Phones may not reach Mission Control.`);
  }
  if (out.length) out.push('Fix: see docs/mac-dev-runbook.md, "Phones cannot reach MC on the Mac".');
  return out;
}

/** macOS only, read-only, fail-soft: print the phone address(es) and any firewall warnings. */
export function macPreflight(print, { interfaces, run, pythonPath }) {
  if (process.platform !== 'darwin') return;
  try {
    const addrs = lanAddresses(interfaces);
    print(addrs.length
      ? `Phones join at: ${addrs.map(a => `http://${a}:8765`).join('  or  ')}`
      : 'No LAN address found: connect the Mac to the same Wi-Fi as the phones.');
    const fw = '/usr/libexec/ApplicationFirewall/socketfilterfw';
    const ask = flag => { const r = run(fw, [flag]); return r.status === 0 ? String(r.stdout) : ''; };
    const state = parseFirewall({ globalState: ask('--getglobalstate'), stealth: ask('--getstealthmode'), apps: ask('--listapps') });
    for (const line of firewallWarnings(state, pythonPath)) print(`WARNING: ${line}`);
  } catch (error) {
    print(`(network check skipped: ${error.message})`);
  }
}
