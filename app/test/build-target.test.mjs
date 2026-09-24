// The Android WebView floor. This used to be enforced by a hand-rolled inline guard in www/index.html
// (2026-09-24 commit e01b26c3): plain ES5, read the Chrome major version off the UA, only load app.js
// above the floor. It fixed the "Unexpected token" PARSE crash (logical assignment needs Chrome 85,
// no esbuild `target` at all) but the very next bench pass showed the CSS still "totally busted" —
// `inset` shorthand (position:absolute;inset:0, every full-bleed HUD layer) needs Chrome 87, and a
// hand guard checking the wrong number is just a different way to ship a broken screen. Capacitor
// already has this exact mechanism built in (Bridge.isMinimumWebViewInstalled(), redirects to
// `server.errorPath` before index.html loads at all — see app/README.md's "Supported phones"), so the
// guard is gone and the floor now lives in TWO places that must agree: `capacitor.config.json`'s
// `android.minWebViewVersion` (what Capacitor enforces) and `scripts/build.mjs`'s esbuild `target`
// (what the bundle is compiled for). This test is what makes them agree instead of assuming it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TARGET } from '../scripts/build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BUILDER = path.join(ROOT, 'scripts/build.mjs');
const BUNDLES = [path.join(ROOT, 'www/app.js'), path.join(ROOT, 'www/utility.js')];
const CONFIG = JSON.parse(readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));

test('build: capacitor.config.json minWebViewVersion matches the esbuild target', () => {
  const m = TARGET.match(/^chrome(\d+)$/);
  assert.ok(m, `TARGET "${TARGET}" is not a plain "chrome<N>" string`);
  const floor = Number(m[1]);
  assert.equal(
    CONFIG.android && CONFIG.android.minWebViewVersion,
    floor,
    `capacitor.config.json's android.minWebViewVersion does not match scripts/build.mjs's TARGET (${TARGET}) — ` +
    'Capacitor would let a WebView through that the bundle was never compiled for (or turn away one that would have worked)',
  );
});

test('build: capacitor.config.json points server.errorPath at a real file in www/', () => {
  const errorPath = CONFIG.server && CONFIG.server.errorPath;
  assert.ok(errorPath, 'capacitor.config.json has no server.errorPath — a WebView below the floor gets no page at all, just Bridge\'s log line');
  const full = path.join(ROOT, 'www', errorPath);
  assert.ok(existsSync(full), `server.errorPath "${errorPath}" does not exist at www/${errorPath} — Bridge.getErrorUrl() would 404`);
});

test('build: the errorPath page does not itself use the CSS that set the floor', () => {
  // It is what a WebView BELOW the floor sees instead of index.html — it cannot lean on `inset`
  // (Chrome 87), flexbox `gap` (Chrome 84) or `color-mix()` (Chrome 111, the feature that raised the
  // floor to 111) without reproducing the exact bug it exists to report: a missing/misplaced layer or
  // a background that silently never rendered.
  const errorPath = CONFIG.server && CONFIG.server.errorPath;
  const src = readFileSync(path.join(ROOT, 'www', errorPath), 'utf8');
  assert.doesNotMatch(src, /[;"']\s*inset\s*:/, 'the errorPath page uses the `inset` shorthand — it needs the same WebView it is meant to catch');
  assert.doesNotMatch(src, /color-mix\(/, 'the errorPath page uses color-mix() — it needs the same WebView it is meant to catch');
});

test('build: index.html and utility.html load the bundle with a plain <script src>, not a hand-rolled guard', () => {
  // Capacitor's own gate runs before either file is ever fetched, so a second, JS-side version check
  // here would just be two floors to keep in sync instead of one.
  for (const [html, entry] of [['www/index.html', 'app.js'], ['www/utility.html', 'utility.js']]) {
    const src = readFileSync(path.join(ROOT, html), 'utf8');
    assert.match(src, new RegExp(`<script src="${entry}"></script>`), `${html} does not load ${entry} with a plain <script src>`);
    assert.doesNotMatch(src, /navigator\.userAgent/, `${html} still carries a UA-sniffing guard`);
  }
});

test('build: www/app.js and www/utility.js build cleanly at the current target', () => {
  // Rebuild whenever the builder is newer than a bundle — same staleness guard as A29's build-stamp
  // test (test/transport.test.mjs): `npm test` runs `test:unit` (this file) BEFORE `npm run build`.
  for (const bundle of BUNDLES) {
    if (!existsSync(bundle) || statSync(bundle).mtimeMs < statSync(BUILDER).mtimeMs) {
      const r = spawnSync(process.execPath, [BUILDER], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, `npm run build failed at target ${TARGET}:\n${r.stdout || ''}${r.stderr || ''}`);
      break;   // one build call rebuilds every entry in ENTRIES
    }
  }
  for (const bundle of BUNDLES) assert.ok(statSync(bundle).size > 0, `${path.basename(bundle)} is empty`);
});
