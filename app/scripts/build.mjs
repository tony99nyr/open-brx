#!/usr/bin/env node
// The app bundler (contracts A29). Replaces the two inline esbuild calls that `npm run build` used to
// be, for one reason: the bundle has to carry the tree it was cut from. `APP_VER` was a hard-coded
// 'hud-0.2', so MC could not tell an APK from a fortnight ago from today's build and the game test
// could not answer "is that phone running the code we just fixed".
//
//   __APP_VER__  ->  "<package.json version>+<git short sha>[-dirty]"     e.g. "0.1.8+28c9e76-dirty"
//
// Read by src/build.js, sent on `hello` and on every `status` heartbeat. Everything that ships the app
// goes through `npm run build` (ui:stage, ui:screens, android:apk, ios:setup, sync), so everything
// bakes it. With no git (a source tarball, a CI checkout with no .git) the stamp is `unknown` — a
// version with no sha, never a silently wrong one.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
let stamp = 'unknown';
try {
  const sha = git(['rev-parse', '--short', 'HEAD']);
  if (sha) {
    // Tracked changes only: half the repo is generated or ignored, and an untracked scratch file is
    // not a different build. Read-only — this script never touches the index.
    let dirty = '';
    try { if (git(['status', '--porcelain', '--untracked-files=no'])) dirty = '-dirty'; } catch (_) { /* keep clean */ }
    stamp = sha + dirty;
  }
} catch (_) { /* no git: `unknown` */ }

const APP_VER = `${pkg.version}+${stamp}`;
const ENTRIES = [['src/app.js', 'www/app.js'], ['src/utility.js', 'www/utility.js']];

await Promise.all(ENTRIES.map(([entry, out]) => esbuild.build({
  entryPoints: [path.join(ROOT, entry)],
  outfile: path.join(ROOT, out),
  bundle: true,
  format: 'iife',
  define: { __APP_VER__: JSON.stringify(APP_VER) },
  logLevel: 'warning',
})));

console.log(`built ${APP_VER} -> ${ENTRIES.map(([, o]) => o).join(', ')}`);
