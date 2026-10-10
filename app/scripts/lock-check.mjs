#!/usr/bin/env node
// OP4 (maintainability review 2026-10-10): refuse a release build whose app/node_modules is not what package-lock.json
// names. A local `npm install` can move a caret-ranged plugin (`@capacitor-community/bluetooth-le`, `@capacitor/*`)
// and `git status` never sees node_modules, so without this a release could ship a BLE plugin nobody tested.
// It reads each installed package.json; it never installs or deletes anything (a release worktree's node_modules is
// often a symlink to the main checkout's, so `npm ci` here would rewrite another checkout).
//
//   node scripts/lock-check.mjs [appDir]     exit 0 = matches, 1 = mismatches listed on stderr
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every way the tree differs from the lockfile, as one line each. A missing OPTIONAL entry is another platform's
 *  binary (esbuild's) and is fine. A `link` entry (plugins/brx-*) must resolve to THIS checkout's target, which has
 *  its own entry: a worktree that links another checkout's node_modules would otherwise bundle that checkout's
 *  plugin code. A top-level package the lockfile does not name is refused too, since an import could bundle it. */
export function lockMismatches(appDir) {
  const lock = JSON.parse(readFileSync(join(appDir, 'package-lock.json'), 'utf8'));
  const packages = lock.packages || {};
  const out = [];
  for (const [path, entry] of Object.entries(packages)) {
    if (!path) continue;
    const pkg = join(appDir, path, 'package.json');
    if (!existsSync(pkg)) { if (!entry.optional && !entry.devOptional) out.push(`${path}: missing (the lockfile names ${entry.version || entry.resolved})`); continue; }
    if (entry.link) {
      const want = join(appDir, entry.resolved || '');
      const got = realpathSync(join(appDir, path));
      if (!existsSync(want) || got !== realpathSync(want)) out.push(`${path}: resolves to ${got}, the lockfile names ${want}`);
      continue;
    }
    if (!entry.version) continue;
    const have = JSON.parse(readFileSync(pkg, 'utf8')).version;
    if (have !== entry.version) out.push(`${path}: installed ${have}, the lockfile names ${entry.version}`);
  }
  const top = join(appDir, 'node_modules');
  if (existsSync(top)) {
    const dirs = d => readdirSync(d, { withFileTypes: true }).filter(e => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink())).map(e => e.name);
    for (const name of dirs(top)) {   // a dotfile or a plain file (macOS .DS_Store) is not a package
      const names = name.startsWith('@') ? dirs(join(top, name)).map(s => `${name}/${s}`) : [name];
      for (const n of names) if (!(`node_modules/${n}` in packages)) out.push(`node_modules/${n}: installed, but the lockfile does not name it`);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] || join(fileURLToPath(import.meta.url), '..', '..'));
  const bad = lockMismatches(dir);
  if (bad.length) {
    console.error(`error: app/node_modules does not match package-lock.json (${bad.length}):`);
    for (const line of bad.slice(0, 20)) console.error(`  ${line}`);
    console.error('       Run `npm ci` in this app/. A release tree needs its own node_modules: a linked one bundles another checkout\'s plugins.');
    process.exit(1);
  }
  console.log('==> app/node_modules matches package-lock.json');
}
