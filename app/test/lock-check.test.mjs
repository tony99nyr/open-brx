// OP4 (maintainability review 2026-10-10): a release APK must ship the packages package-lock.json names, not whatever
// app/node_modules holds after a local `npm install`. scripts/lock-check.mjs is the check android-release.sh runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockMismatches } from '../scripts/lock-check.mjs';

function tree(lockPackages, installed) {
  const dir = mkdtempSync(join(tmpdir(), 'lock-check-'));
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...lockPackages } }));
  for (const [path, version] of Object.entries(installed)) {
    mkdirSync(join(dir, path), { recursive: true });
    writeFileSync(join(dir, path, 'package.json'), JSON.stringify({ version }));
  }
  return dir;
}
const BLE = 'node_modules/@capacitor-community/bluetooth-le';

test('OP4: a tree that matches the lockfile passes', () => {
  const dir = tree({ [BLE]: { version: '7.1.0' } }, { [BLE]: '7.1.0' });
  try { assert.deepEqual(lockMismatches(dir), []); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('OP4: a moved BLE plugin is refused, naming both versions', () => {
  const dir = tree({ [BLE]: { version: '7.1.0' } }, { [BLE]: '7.2.0' });
  try {
    const bad = lockMismatches(dir);
    assert.equal(bad.length, 1);
    assert.match(bad[0], /bluetooth-le/); assert.match(bad[0], /7\.2\.0/); assert.match(bad[0], /7\.1\.0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('OP4: a missing required package is refused; a missing optional one (another platform) is not', () => {
  const dir = tree({ [BLE]: { version: '7.1.0' }, 'node_modules/@esbuild/darwin-arm64': { version: '0.25.0', optional: true } }, {});
  try {
    const bad = lockMismatches(dir);
    assert.equal(bad.length, 1);
    assert.match(bad[0], /bluetooth-le.*missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('OP4: a local link (plugins/brx-beacon) is checked by its target, not by a version', () => {
  const dir = tree({ 'node_modules/brx-beacon': { resolved: 'plugins/brx-beacon', link: true }, 'plugins/brx-beacon': { version: '0.1.0' } },
    { 'plugins/brx-beacon': '0.1.0' });
  try {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    symlinkSync('../plugins/brx-beacon', join(dir, 'node_modules/brx-beacon'));   // what npm makes for a `link` entry
    assert.deepEqual(lockMismatches(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('OP4 r1: a linked plugin that resolves to ANOTHER checkout is refused (a worktree linking the main node_modules)', () => {
  const other = tree({}, { 'plugins/brx-beacon': '0.1.0' });
  const dir = tree({ 'node_modules/brx-beacon': { resolved: 'plugins/brx-beacon', link: true }, 'plugins/brx-beacon': { version: '0.1.0' } },
    { 'plugins/brx-beacon': '0.1.0' });
  try {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    symlinkSync(join(other, 'plugins/brx-beacon'), join(dir, 'node_modules/brx-beacon'));
    const bad = lockMismatches(dir);
    assert.equal(bad.length, 1, JSON.stringify(bad));
    assert.match(bad[0], /brx-beacon.*resolves to/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});

test('OP4 r1: a package in node_modules that the lockfile does not name is refused (it could enter the bundle)', () => {
  const dir = tree({ [BLE]: { version: '7.1.0' } }, { [BLE]: '7.1.0', 'node_modules/left-pad': '1.3.0', 'node_modules/@scope/extra': '1.0.0' });
  try {
    const bad = lockMismatches(dir);
    assert.deepEqual(bad.map(b => b.split(':')[0]).sort(), ['node_modules/@scope/extra', 'node_modules/left-pad']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
