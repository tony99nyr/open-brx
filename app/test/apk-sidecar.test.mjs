// The download sidecar (webapp/download/build.json) is written by ONE script for both the debug and the
// release build (scripts/apk-sidecar.mjs). The site's download page and mcp/tests/test_published_build.py
// read it, so a release cut that hand-writes its eight fields, or a second copy of the writer, is how a
// release goes wrong.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { apkName, releaseAssetUrl, setUrl, writeSidecar } from '../scripts/apk-sidecar.mjs';

const GRADLE = 'ext {\n    minSdkVersion = 24\n    compileSdkVersion = 36\n    targetSdkVersion = 36\n}\n';

function sandbox(ctx) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-sidecar-'));
  ctx.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const apk = path.join(dir, 'app-release.apk');
  fs.writeFileSync(apk, 'signed apk bytes');
  const gradle = path.join(dir, 'variables.gradle');
  fs.writeFileSync(gradle, GRADLE);
  const out = path.join(dir, 'download');
  return { dir, apk, gradle, out };
}

test('a release build writes the sidecar the site and the published-build test read', ctx => {
  const { apk, gradle, out } = sandbox(ctx);
  const url = releaseAssetUrl('tony99nyr/open-brx', 'app-v0.4.6', apkName('0.4.6', 'release'));
  const { file, sidecar } = writeSidecar({ apk, out, version: '0.4.6', variant: 'release', git: '1b08556c',
    dirty: false, gradle, url, release: 'app-v0.4.6', now: () => new Date('2026-09-23T20:00:00Z') });
  assert.equal(file, 'brx-companion-0.4.6-android-release.apk');
  const onDisk = JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8'));
  assert.deepEqual(onDisk, sidecar);
  const bytes = fs.readFileSync(apk);
  assert.deepEqual(onDisk, {
    file, version: '0.4.6', variant: 'release', minSdk: 24, targetSdk: 36, built: '2026-09-23T20:00:00.000Z',
    bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), git: '1b08556c', dirty: false,
    url: 'https://github.com/tony99nyr/open-brx/releases/download/app-v0.4.6/brx-companion-0.4.6-android-release.apk',
    release: 'app-v0.4.6',
  });
  assert.ok(fs.existsSync(path.join(out, file)), 'the renamed APK sits beside the sidecar');
});

test('exactly one APK is left, and an identical rebuild keeps its built date', ctx => {
  const { apk, gradle, out } = sandbox(ctx);
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'brx-companion-0.4.5-android-debug.apk'), 'old');
  fs.writeFileSync(path.join(out, 'stray.APK'), 'old');
  const o = { apk, out, version: '0.4.6', variant: /** @type {const} */ ('release'), git: 'a', dirty: false, gradle };
  writeSidecar({ ...o, now: () => new Date('2026-09-23T20:00:00Z') });
  writeSidecar({ ...o, now: () => new Date('2026-09-24T08:00:00Z') });
  assert.deepEqual(fs.readdirSync(out).filter(n => n.toLowerCase().endsWith('.apk')), ['brx-companion-0.4.6-android-release.apk']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')).built, '2026-09-23T20:00:00.000Z');
});

test('a debug build learns its URL only after publishing (set-url), as before', ctx => {
  const { apk, gradle, out } = sandbox(ctx);
  const { sidecar } = writeSidecar({ apk, out, version: '0.4.6', variant: 'debug', git: 'a', dirty: true, gradle });
  assert.equal(sidecar.variant, 'debug');
  assert.equal('url' in sidecar, false, 'nothing claims a release that has not been published');
  setUrl({ out, url: 'https://example/x.apk', release: 'app-v0.4.6' });
  const d = JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8'));
  assert.equal(d.url, 'https://example/x.apk');
  assert.equal(d.dirty, true);
});

test('an unknown variant is refused', ctx => {
  const { apk, gradle, out } = sandbox(ctx);
  assert.throws(() => writeSidecar({ apk, out, version: '1', variant: /** @type {any} */ ('beta'), git: 'a', dirty: false, gradle }), /unknown variant/);
});

test('both build scripts use the one writer, and neither keeps a copy of it', () => {
  for (const script of ['android-apk.sh', 'android-release.sh']) {
    const src = fs.readFileSync(new URL(`../scripts/${script}`, import.meta.url), 'utf8');
    assert.match(src, /scripts\/apk-sidecar\.mjs write /, `${script} writes the sidecar through apk-sidecar.mjs`);
    assert.doesNotMatch(src, /build\.json["']?,\s*JSON\.stringify|writeFileSync\([^)]*build\.json/, `${script} has its own sidecar writer`);
  }
  const release = fs.readFileSync(new URL('../scripts/android-release.sh', import.meta.url), 'utf8');
  assert.match(release, /--variant release/);
  assert.doesNotMatch(release, /gh release (create|upload)/, 'the release build never publishes');
});

test('the CLI runs from a path with a space in it and prints only the file name', async ctx => {
  const { spawnSync } = await import('node:child_process');
  const { apk, gradle, dir } = sandbox(ctx);
  const spaced = path.join(dir, 'a b');
  fs.mkdirSync(spaced);
  const cli = path.join(spaced, 'apk-sidecar.mjs');
  fs.copyFileSync(new URL('../scripts/apk-sidecar.mjs', import.meta.url), cli);
  const out = path.join(dir, 'dl');
  const r = spawnSync(process.execPath, [cli, 'write', '--apk', apk, '--out', out, '--version', '0.4.6',
    '--variant', 'release', '--git', 'a', '--dirty', '0', '--gradle', gradle, '--slug', 'o/r', '--release', 'app-v0.4.6'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'brx-companion-0.4.6-android-release.apk\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'build.json'), 'utf8')).url,
    'https://github.com/o/r/releases/download/app-v0.4.6/brx-companion-0.4.6-android-release.apk');
});
