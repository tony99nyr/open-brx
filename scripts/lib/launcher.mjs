// Helpers shared by the two laptop launchers: `start.mjs` (set up, then run) and `mc.mjs` (run only).
// Everything here must work on macOS, Windows and Linux, and must not need any npm package.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '..', '..');
export const isWindows = process.platform === 'win32';

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

function newestMtime(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, entry)));
  return newest;
}

/** True when webapp/mc/dist is missing or older than any of its sources. */
export function uiStale() {
  const mc = join(root, 'webapp', 'mc');
  const index = join(mc, 'dist', 'index.html');
  if (!existsSync(index)) return true;
  const inputs = ['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'package-lock.json',
    'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']
    .map(name => join(mc, name)).filter(path => existsSync(path));
  return Math.max(...inputs.map(newestMtime)) > statSync(index).mtimeMs;
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
