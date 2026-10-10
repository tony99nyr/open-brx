#!/usr/bin/env node
// OP4 (maintainability review 2026-10-10): refuse a release build whose app/node_modules is not what package-lock.json
// names. A local `npm install` can move a caret-ranged plugin (`@capacitor-community/bluetooth-le`, `@capacitor/*`)
// and `git status` never sees node_modules, so without this a release could ship a BLE plugin nobody tested.
// It reads each installed package.json; it never installs or deletes anything (a release worktree's node_modules is
// often a symlink to the main checkout's, so `npm ci` here would rewrite another checkout).
//
//   node scripts/lock-check.mjs [appDir]     exit 0 = matches, 1 = mismatches listed on stderr
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every lockfile entry the tree does not match, as one line each. A missing OPTIONAL entry is another platform's
 *  binary (esbuild's) and is fine; a `link` entry (plugins/brx-*) is checked by its target, which has its own entry. */
export function lockMismatches(appDir) {
  const lock = JSON.parse(readFileSync(join(appDir, 'package-lock.json'), 'utf8'));
  const out = [];
  for (const [path, entry] of Object.entries(lock.packages || {})) {
    if (!path) continue;
    const pkg = join(appDir, path, 'package.json');
    if (!existsSync(pkg)) { if (!entry.optional) out.push(`${path}: missing (the lockfile names ${entry.version || entry.resolved})`); continue; }
    if (entry.link || !entry.version) continue;
    const have = JSON.parse(readFileSync(pkg, 'utf8')).version;
    if (have !== entry.version) out.push(`${path}: installed ${have}, the lockfile names ${entry.version}`);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] || join(fileURLToPath(import.meta.url), '..', '..'));
  const bad = lockMismatches(dir);
  if (bad.length) {
    console.error(`error: app/node_modules does not match package-lock.json (${bad.length}):`);
    for (const line of bad.slice(0, 20)) console.error(`  ${line}`);
    console.error('       Run `npm ci` in app/ (in the main checkout, if this one links its node_modules), then build again.');
    process.exit(1);
  }
  console.log('==> app/node_modules matches package-lock.json');
}
