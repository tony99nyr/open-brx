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
