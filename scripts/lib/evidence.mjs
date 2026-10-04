// Size report and prune for the launcher's evidence root (`~/.brx-mcp/sessions`, one folder per launch).
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const KEEP_DEFAULT = 30;
export const DAYS_DEFAULT = 30;
const DAY_MS = 86_400_000;
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

function liveManifest(dir, ageMs) {
  // Another Mission Control may be running from this folder: leave it for a day after its last write.
  try {
    const status = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).status;
    return (status === 'running' || status === 'starting') && ageMs < DAY_MS;
  } catch { return false; }
}

/**
 * Remove old launch folders from `sessionsDir`. A folder is KEPT when it is the current launch, one of the
 * newest `keep`, newer than `days` days, or still marked running. Everything else is removed.
 * `keepAll` removes nothing. Returns { sizeBefore, count, removed: [{id, bytes}] }.
 */
export function pruneEvidence({ sessionsDir, currentId = '', keep = KEEP_DEFAULT, days = DAYS_DEFAULT, keepAll = false,
                                now = Date.now(), log = () => {} }) {
  if (!existsSync(sessionsDir)) return { sizeBefore: 0, count: 0, removed: [] };
  const rootReal = realpathSync(sessionsDir);
  const entries = readdirSync(sessionsDir).filter(name => LAUNCH.test(name)).sort();   // oldest first
  const sizeBefore = dirSize(rootReal);
  const removed = [];
  const newest = new Set(entries.slice(Math.max(0, entries.length - keep)));
  if (!keepAll) {
    for (const id of entries) {
      if (id === currentId || newest.has(id)) continue;
      const dir = resolve(sessionsDir, id);
      const info = lstatSync(dir);
      if (info.isSymbolicLink() || !info.isDirectory()) continue;           // never follow a link out of the root
      const real = realpathSync(dir);
      if (!real.startsWith(rootReal + sep)) continue;                        // never delete outside the root
      const ageMs = now - info.mtimeMs;
      if (ageMs < days * DAY_MS || liveManifest(real, ageMs)) continue;
      const bytes = dirSize(real);
      rmSync(real, { recursive: true, force: true });
      removed.push({ id, bytes });
      log(`Removed old session ${id} (${formatBytes(bytes)})`);
    }
  }
  return { sizeBefore, count: entries.length, removed };
}
