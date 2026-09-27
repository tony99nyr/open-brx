// Review 2026-09-19: android-setup.sh's IMMERSIVE patch (fullscreen status-bar fix, office test
// 2026-09-19) used to print a warning and carry on when MainActivity.java already defined `onCreate`,
// so `npm run android:setup` reported "done" over a build with no fullscreen patch at all. It must now
// fail loudly (`set -e` stops the script) instead of silently skipping.
//
// This runs the EXACT python heredoc the script ships (extracted from the source file itself, not a
// copy), against a throwaway MainActivity.java, so the test cannot drift from what actually ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('../scripts/android-setup.sh', import.meta.url);

function immersivePython() {
  const src = readFileSync(SCRIPT, 'utf8');
  const openTag = "<<'IMMERSIVE'";
  const start = src.indexOf(openTag);
  const bodyStart = src.indexOf('\n', start) + 1;
  const end = src.indexOf('\nIMMERSIVE\n', bodyStart);
  assert.ok(start > 0 && end > bodyStart, 'the IMMERSIVE heredoc must still be in android-setup.sh, byte for byte');
  return src.slice(bodyStart, end + 1);
}

function runOn(javaSrc) {
  const dir = mkdtempSync(path.join(tmpdir(), 'brx-android-setup-'));
  const file = path.join(dir, 'MainActivity.java');
  writeFileSync(file, javaSrc);
  const r = spawnSync('python3', ['-', file], { input: immersivePython(), encoding: 'utf8' });
  return { ...r, file };
}

const TEMPLATE = `package com.brx.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
}
`;

const WITH_ONCREATE = `package com.brx.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
`;

test('android-setup.sh IMMERSIVE patch: a fresh Capacitor template gets the fullscreen onCreate, and exits 0', () => {
  const { status, file } = runOn(TEMPLATE);
  assert.equal(status, 0);
  const patched = readFileSync(file, 'utf8');
  assert.match(patched, /Open BRX: fullscreen, part 2/);
  assert.match(patched, /public void onCreate\(Bundle savedInstanceState\)/);
});

test('review 2026-09-19: the IMMERSIVE patch exits non-zero when onCreate already exists, instead of silently skipping', () => {
  const { status, stderr, file } = runOn(WITH_ONCREATE);
  assert.notEqual(status, 0, 'a template that already defines onCreate must fail the setup, not silently skip it');
  assert.match(stderr, /already defines onCreate/);
  assert.equal(readFileSync(file, 'utf8'), WITH_ONCREATE, 'nothing is half-applied when the patch refuses');
});

// F395 splash transform: android-setup.sh's plain-colour splash fix (00fdff1e) only recognised the
// pristine Capacitor stock styles.xml. A tree that already ran the EARLIER F395 fix (4fb379d8, which
// pointed AppTheme.NoActionBarLaunch at @drawable/splash_background) hit the "not found" branch and
// exited 1, and `set -e` aborted the rest of android-setup.sh (the MainActivity patch and the version
// stamp never ran). This runs the EXACT bash+python the script ships for that block (extracted from the
// source file itself, both the outer `grep`-gated `if` and the python heredoc, not a copy), so the test
// exercises the same idempotency the real run relies on, not a re-implementation of it.
//
// Fixture provenance: STOCK_STYLES is a byte-for-byte copy of @capacitor/cli's
// assets/android-template.tar.gz -> app/src/main/res/values/styles.xml (confirmed 2026-09-26 against
// this repo's own app/node_modules install). INTERMEDIATE_STYLES is what 4fb379d8's transform produces
// when run against that same stock file (`git show 4fb379d8` -- the diff replaces the NoActionBarLaunch
// style's android:background from @drawable/splash to @drawable/splash_background, verbatim).
function splashBashBlock() {
  const src = readFileSync(SCRIPT, 'utf8');
  const startMarker = 'SPLASH_BG="#030407"';
  const start = src.indexOf(startMarker);
  assert.ok(start > 0, 'the SPLASH_BG block must still be in android-setup.sh');
  // The heredoc terminator line is immediately followed by this block's own closing `fi` (no
  // blank line between them) -- match both in one substring so a search for a later, unrelated
  // `fi` (the next block's) can never win on an off-by-one over the newline between them.
  const terminator = '\nSPLASH\nfi';
  const termIdx = src.indexOf(terminator, start);
  assert.ok(termIdx > start, 'the SPLASH heredoc must still close with its own `fi`, byte for byte');
  return src.slice(start, termIdx + terminator.length);
}

function runOnStyles(stylesXml) {
  const dir = mkdtempSync(path.join(tmpdir(), 'brx-android-splash-'));
  const file = path.join(dir, 'styles.xml');
  writeFileSync(file, stylesXml);
  const scriptFile = path.join(dir, 'run.sh');
  writeFileSync(scriptFile, `set -euo pipefail\nSTYLES="${file}"\n${splashBashBlock()}\n`);
  const r = spawnSync('bash', [scriptFile], { encoding: 'utf8' });
  return { ...r, file };
}

const STOCK_STYLES = `<?xml version="1.0" encoding="utf-8"?>
<resources>

    <!-- Base application theme. -->
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <!-- Customize your theme here. -->
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
    </style>


    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
    </style>
</resources>
`;

const INTERMEDIATE_STYLES = STOCK_STYLES.replace(
  '<item name="android:background">@drawable/splash</item>',
  '<item name="android:background">@drawable/splash_background</item>',
);

test('android-setup.sh SPLASH patch: a fresh Capacitor stock styles.xml upgrades to the current plain-colour shape, and exits 0', () => {
  const { status, file } = runOnStyles(STOCK_STYLES);
  assert.equal(status, 0);
  const patched = readFileSync(file, 'utf8');
  assert.match(patched, /windowSplashScreenBackground">#030407</);
  assert.match(patched, /windowSplashScreenAnimatedIcon">@android:color\/transparent</);
  assert.match(patched, /statusBarColor">#030407</);
  assert.match(patched, /navigationBarColor">#030407</);
  assert.match(patched, /windowBackground">#030407</);
  assert.doesNotMatch(patched, /@drawable\/splash/, 'the drawable reference must be gone, not just recoloured');
});

test('android-setup.sh SPLASH patch: the intermediate 4fb379d8 shape (@drawable/splash_background) also upgrades to current, and exits 0', () => {
  const { status, file } = runOnStyles(INTERMEDIATE_STYLES);
  assert.equal(status, 0, 'a tree that already ran the earlier F395 fix must still upgrade, not abort android-setup.sh');
  const patched = readFileSync(file, 'utf8');
  assert.match(patched, /windowSplashScreenBackground">#030407</);
  assert.match(patched, /windowSplashScreenAnimatedIcon">@android:color\/transparent</);
  assert.doesNotMatch(patched, /@drawable\/splash_background/, 'the intermediate drawable reference must be gone');
});

test('android-setup.sh SPLASH patch: re-running on the already-current shape changes nothing and still exits 0', () => {
  const first = runOnStyles(STOCK_STYLES);
  assert.equal(first.status, 0);
  const current = readFileSync(first.file, 'utf8');

  const second = runOnStyles(current);
  assert.equal(second.status, 0);
  assert.equal(readFileSync(second.file, 'utf8'), current, 'an already-current styles.xml must be a no-op');
});

test('android-setup.sh SPLASH patch: refuses cleanly (non-zero exit, unchanged file) when NoActionBarLaunch is not in a known shape', () => {
  const unknownShape = STOCK_STYLES.replace(
    '<item name="android:background">@drawable/splash</item>',
    '<item name="android:background">@drawable/something_else</item>',
  );
  const { status, stderr, file } = runOnStyles(unknownShape);
  assert.notEqual(status, 0);
  assert.match(stderr, /AppTheme\.NoActionBarLaunch not found in a known shape/);
  assert.equal(readFileSync(file, 'utf8'), unknownShape, 'nothing is half-applied when the patch refuses');
});
