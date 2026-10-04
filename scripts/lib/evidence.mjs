// Size report and prune for the launcher's evidence root (`~/.brx-mcp/sessions`, one folder per launch).
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

export const KEEP_DEFAULT = 30;
export const DAYS_DEFAULT = 30;
const DAY_MS = 86_400_000;
// A folder this young is never pruned, whatever the settings: a concurrent launch is still starting in it.
export const RUNNING_MAX_MS = 7 * DAY_MS;
export const MIN_AGE_MS = 10 * 60_000;
// A launch folder is `<UTC stamp>-<6 hex>` (scripts/mc.mjs). Nothing else under the root is ever touched.
const LAUNCH = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/;

/** Total bytes under `dir`, counting a symlink as its own few bytes and never following it. */
export function dirSize(dir) {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const info = lstatSync(join(dir, name));
    total += info.isDirectory() ? dirSize(join(dir, name)) : info.size;
  }
  return total;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

function readStatus(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')); } catch { return null; }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
// Only `running` is protected by the manifest's own content, never by a directory mtime (file writes do not
// refresh it). A live pid, or no pid to check, protects the folder whatever its age; a dead pid is a crash.
// The protection ends after RUNNING_MAX_MS: a crashed folder whose pid was reused would stay alive for ever, and
// no match-day Mission Control runs a week.
function running(dir, now) {
  const m = readStatus(dir);
  if (!m || m.status !== 'running') return false;
  if (now - statSync(join(dir, 'manifest.json')).mtimeMs >= RUNNING_MAX_MS) return false;
  return Number.isInteger(m.pid) ? alive(m.pid) : true;
}
// A launch that never got going: no event store, and a manifest still at `starting`.
function failedLaunch(dir) {
  if (existsSync(join(dir, 'session.sqlite'))) return false;
  const m = readStatus(dir);
  return !!m && m.status === 'starting';
}

/**
 * Remove old launch folders from `sessionsDir`. A folder is KEPT when it is the current launch, one of the
 * newest `keep` real sessions, newer than `days` days, newer than MIN_AGE_MS (a floor no setting lowers), or
 * a running session. Everything else is removed. `keepAll` removes nothing. A symlinked root is refused.
 * Returns { sizeBefore, count, removed: [{id, bytes}] }.
 */
export function pruneEvidence({ sessionsDir, currentId = '', keep = KEEP_DEFAULT, days = DAYS_DEFAULT, keepAll = false,
                                now = Date.now(), log = () => {} }) {
  if (!existsSync(sessionsDir)) return { sizeBefore: 0, count: 0, removed: [] };
  const rootReal = realpathSync(sessionsDir);
  const sizeBefore = dirSize(rootReal);
  // Real launch directories only: a launch-named symlink or file is not a session, never counts, never goes.
  const entries = readdirSync(rootReal).filter(name => {
    if (!LAUNCH.test(name)) return false;
    const info = lstatSync(join(rootReal, name));
    return info.isDirectory() && !info.isSymbolicLink();
  }).sort();                                                                  // oldest first
  const removed = [];
  if (lstatSync(sessionsDir).isSymbolicLink()) {
    if (!keepAll) log(`Not pruning: ${sessionsDir} is a symlink (remove old sessions by hand)`);
    return { sizeBefore, count: entries.length, removed };
  }
  const counted = entries.filter(name => !failedLaunch(join(rootReal, name)));
  const newest = new Set(counted.slice(Math.max(0, counted.length - keep)));
  if (!keepAll) {
    for (const id of entries) {
      if (id === currentId || newest.has(id)) continue;
      const dir = join(rootReal, id);
      const real = realpathSync(dir);
      if (!real.startsWith(rootReal + sep)) continue;                        // never delete outside the root
      const ageMs = now - lstatSync(dir).mtimeMs;
      if (ageMs < MIN_AGE_MS || ageMs < days * DAY_MS || running(real, now)) continue;
      const bytes = dirSize(real);
      rmSync(real, { recursive: true, force: true });
      removed.push({ id, bytes });
      log(`Removed old session ${id} (${formatBytes(bytes)})`);
    }
  }
  return { sizeBefore, count: entries.length, removed };
}
