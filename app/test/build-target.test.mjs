// The esbuild syntax floor (scripts/build.mjs's `target`). Without it, esbuild ships esnext syntax
// untouched: a factory Android System WebView (Pixel 5, Android 11, Chrome 83) threw "Unexpected
// token '='" on `src/brxlink.js`'s `??=`-family logical assignment (needs Chrome 85) and the whole
// app was a blank screen — no console the player could ever see. This test proves the built bundle
// carries no syntax above the floor, so a future edit that drops `target` fails HERE, not on a phone.
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

// Logical assignment (`??=`/`||=`/`&&=`) is Chrome 85 syntax and the one feature this app's own
// source actually used above the chrome60 floor (src/brxlink.js's `this._init ||= ...`). Fixed
// literal substrings, not a regex: esbuild does not minify (no `format: 'iife'` + `minify`), so
// spacing is exactly as authored and there is no ternary/decimal token this could false-positive on.
const ABOVE_FLOOR = ['??=', '||=', '&&='];

test('build: www/app.js and www/utility.js carry no syntax above the chrome60 floor', () => {
  // Same staleness guard as A29's build-stamp test (test/transport.test.mjs): `test:unit` runs before
  // `npm run build` in `npm test`'s own script chain, so a stale bundle from BEFORE this floor existed
  // would pass here for the wrong reason. Rebuild whenever the builder is newer than a bundle.
  for (const bundle of BUNDLES) {
    if (!existsSync(bundle) || statSync(bundle).mtimeMs < statSync(BUILDER).mtimeMs) {
      const r = spawnSync(process.execPath, [BUILDER], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(r.status, 0, `npm run build failed, so the floor is unproven:\n${r.stdout || ''}${r.stderr || ''}`);
      break;   // one build call rebuilds every entry in ENTRIES
    }
  }
  for (const bundle of BUNDLES) {
    const js = readFileSync(bundle, 'utf8');
    for (const token of ABOVE_FLOOR) {
      assert.ok(!js.includes(token), `${path.basename(bundle)} still contains "${token}" — esbuild's \`target\` in scripts/build.mjs was removed or raised, and a WebView below Chrome 85 will blank-screen on load again`);
    }
  }
});

test('build: the esbuild target is set to the documented chrome60 floor, not left unset', () => {
  // Capacitor's own minimum (capacitorjs.com/docs/android, "Requirements": Chrome 60+) is the floor;
  // nothing in this app's own code needs more (see the comment above `TARGET` in scripts/build.mjs).
  // A missing `target` is `undefined`, not a falsy version string, so this also catches that case.
  assert.equal(TARGET, 'chrome60');
});

test('build: the index.html/utility.html startup guards agree with the esbuild floor', () => {
  // The guard (plain ES5, unbundled, runs before app.js/utility.js) gates the WebView that esbuild's
  // `target` compiled for. If the two drift apart, either a compatible phone gets turned away or an
  // incompatible one gets past the guard and hits the syntax error the guard exists to prevent.
  const floorMajor = Number(TARGET.replace('chrome', ''));
  assert.ok(Number.isInteger(floorMajor) && floorMajor > 0, `TARGET "${TARGET}" is not a plain "chrome<N>" string`);
  for (const html of ['www/index.html', 'www/utility.html']) {
    const src = readFileSync(path.join(ROOT, html), 'utf8');
    const m = src.match(/var FLOOR = (\d+);/);
    assert.ok(m, `${html} has no "var FLOOR = <N>;" startup guard`);
    assert.equal(Number(m[1]), floorMajor, `${html}'s guard FLOOR does not match scripts/build.mjs's TARGET (${TARGET})`);
  }
});
