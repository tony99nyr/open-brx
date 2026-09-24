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

/** Read-only git, in the app tree. Throws on any non-zero exit. This script never touches the index. */
export const gitIn = (cwd = ROOT) => args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** `<short sha>[-dirty|-unknown-dirty]`, or `unknown` where there is no git at all.
 *  `run` is injected so the failure modes below are testable without a repo in a given state. */
export function gitStamp(run = gitIn()) {
  let sha = '';
  try { sha = run(['rev-parse', '--short', 'HEAD']); } catch (_) { return 'unknown'; }   // no git: `unknown`
  if (!sha) return 'unknown';
  // Tracked changes only: half the repo is generated or ignored, and an untracked scratch file is
  // not a different build.
  //
  // A FAILED probe is not a clean tree. `git status` can fail for reasons that say nothing about the
  // working copy — an index.lock held by a concurrent session is the one that bites here — and the old
  // `catch` fell through to the empty string, stamping a dirty tree CLEAN. That is the single outcome
  // this stamp exists to prevent: "is that phone running the code we just fixed" must never be answered
  // with a confident lie. An unreadable tree stamps `-unknown-dirty` — visibly not a clean build.
  let dirty = '';
  try { if (run(['status', '--porcelain', '--untracked-files=no'])) dirty = '-dirty'; }
  catch (e) { dirty = '-unknown-dirty'; console.warn(`build: could not read the working tree (${e && e.message || e}) — stamping ${sha}-unknown-dirty`); }
  return sha + dirty;
}

/** The string baked into the bundle as `__APP_VER__`. */
export function appVer(run = gitIn()) { return `${pkg.version}+${gitStamp(run)}`; }

const ENTRIES = [['src/app.js', 'www/app.js'], ['src/utility.js', 'www/utility.js']];

// The syntax floor — chrome87, NOT Capacitor's own documented minimum (Chrome 60). A chrome60 build
// (2026-09-24) fixed the "Unexpected token" parse crash on a factory Pixel 5 (Android 11, WebView
// 83) but left the CSS "totally busted": `www/index.html`/`www/utility.html` lean on the `inset`
// shorthand (`position:absolute;inset:0`, dozens of rules) for every full-bleed overlay layer, and
// `inset` is Chrome 87/Safari 14.1 — below it the rule is invalid and dropped, so the layer keeps its
// static position and collapses to the top-left instead of covering the frame. Flexbox `gap` (Chrome
// 84, ~116 rules) is the same class of bug at a lower version; 87 covers both. Nothing else in the
// CSS or this app's own JS needs more than 87 (`:has()` 105 and `color-mix()` 111 are used, but only
// in presentational rules/values — see the app README's "Supported phones" section for the full
// audit). `android.minWebViewVersion` in capacitor.config.json is the actual enforcement now (Bridge.
// isMinimumWebViewInstalled() redirects to `server.errorPath` BEFORE index.html ever loads); this
// `target` only has to keep esbuild from shipping syntax the resulting WebView floor cannot parse.
// Keep this in step with capacitor.config.json's `minWebViewVersion` and with
// `test/build-target.test.mjs`, which fails if either drifts from the other.
export const TARGET = 'chrome87';

export async function build() {
  const APP_VER = appVer();
  await Promise.all(ENTRIES.map(([entry, out]) => esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    outfile: path.join(ROOT, out),
    bundle: true,
    format: 'iife',
    target: TARGET,
    define: { __APP_VER__: JSON.stringify(APP_VER) },
    logLevel: 'warning',
  })));
  console.log(`built ${APP_VER} -> ${ENTRIES.map(([, o]) => o).join(', ')}`);
}

// Importing this file (the stamp tests do) must NOT cut a build.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
