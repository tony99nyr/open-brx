#!/usr/bin/env node
// The download sidecar (`webapp/download/build.json`) for a built APK, shared by `android-apk.sh` (debug)
// and `android-release.sh` (release). One writer, so the two paths cannot drift: the site's download page
// and `mcp/tests/test_published_build.py` both read this file.
//
//   node scripts/apk-sidecar.mjs write --apk <built.apk> --out <dir> --version <v> --variant debug|release
//                                      --git <sha> --dirty 0|1 --gradle <variables.gradle> [--slug <owner/repo> --release <tag>]
//   node scripts/apk-sidecar.mjs set-url --out <dir> --url <u> --release <tag>
//
// `write` copies the APK to `<out>/brx-companion-<version>-android-<variant>.apk`, prunes every other APK
// there (the site build refuses to guess between two), and writes the sidecar. It never publishes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** @param {string} version @param {string} variant */
export const apkName = (version, variant) => `brx-companion-${version}-android-${variant}.apk`;

/** The asset URL a GitHub release `tag` will serve `file` at. The release itself is published separately.
 *  @param {string} slug `owner/repo` @param {string} tag @param {string} file */
export const releaseAssetUrl = (slug, tag, file) => `https://github.com/${slug}/releases/download/${tag}/${file}`;

/** @param {string} gradle @param {string} name */
function sdk(gradle, name) {
  const m = gradle.match(new RegExp(name + 'Version\\s*[=:]\\s*(?:rootProject\\.ext\\.[^:]+\\s*[=:]\\s*)?(\\d+)'));
  if (!m) throw new Error(`apk-sidecar: could not read ${name} from the gradle variables`);
  return Number(m[1]);
}

/**
 * @param {{apk:string, out:string, version:string, variant:'debug'|'release', git:string, dirty:boolean,
 *          gradle:string, url?:string, release?:string, now?:() => Date}} o
 * @returns {{file:string, sidecar:Record<string, unknown>}}
 */
export function writeSidecar(o) {
  if (o.variant !== 'debug' && o.variant !== 'release') throw new Error(`apk-sidecar: unknown variant ${o.variant}`);
  const file = apkName(o.version, o.variant);
  fs.mkdirSync(o.out, { recursive: true });
  const dest = path.join(o.out, file);
  fs.copyFileSync(o.apk, dest);
  // Prune AFTER the copy, so a failure never leaves the folder empty; case-insensitively, so a stray .APK
  // cannot survive to hard-fail the site build. Compare by inode, not name (macOS is case-insensitive).
  const keep = fs.statSync(dest);
  for (const n of fs.readdirSync(o.out)) {
    if (!n.toLowerCase().endsWith('.apk')) continue;
    const s = fs.statSync(path.join(o.out, n));
    if (s.ino !== keep.ino || s.dev !== keep.dev) {
      fs.rmSync(path.join(o.out, n));
      process.stderr.write(`apk-sidecar: removed ${path.join(o.out, n)}\n`);   // stderr: stdout is the file name
    }
  }
  const buf = fs.readFileSync(dest);
  const gradle = fs.readFileSync(o.gradle, 'utf8');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  // "built" describes the BYTES, not this run: an identical rebuild keeps the original date.
  let built = (o.now ? o.now() : new Date()).toISOString();
  /** @type {Record<string, unknown>} */ let prev = {};
  try { prev = JSON.parse(fs.readFileSync(path.join(o.out, 'build.json'), 'utf8')); } catch { /* first build */ }
  if (prev.sha256 === sha256 && typeof prev.built === 'string') built = prev.built;
  /** @type {Record<string, unknown>} */
  const sidecar = {
    file, version: o.version, variant: o.variant, minSdk: sdk(gradle, 'minSdk'), targetSdk: sdk(gradle, 'targetSdk'),
    built, bytes: buf.length, sha256, git: o.git, dirty: o.dirty,
  };
  // A release names its asset URL up front; a debug build learns it after `gh` publishes (set-url).
  if (o.url) { sidecar.url = o.url; sidecar.release = o.release; }
  fs.writeFileSync(path.join(o.out, 'build.json'), JSON.stringify(sidecar, null, 1) + '\n');
  return { file, sidecar };
}

/** @param {{out:string, url:string, release:string}} o */
export function setUrl(o) {
  const p = path.join(o.out, 'build.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.url = o.url; d.release = o.release;
  fs.writeFileSync(p, JSON.stringify(d, null, 1) + '\n');
}

/** @param {string[]} argv */
function args(argv) {
  /** @type {Record<string, string>} */ const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`apk-sidecar: bad argument ${argv[i]}`);
    a[argv[i].slice(2)] = argv[i + 1];
  }
  return a;
}

// Run as a script? Compare real paths: a URL comparison misses a path with spaces (%20) or a symlinked
// checkout, and then the CLI would silently do nothing and exit 0.
const isMain = (() => {
  try { return !!process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); }
  catch { return false; }
})();
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  if (cmd === 'write') {
    const variant = a.variant === 'release' ? 'release' : a.variant === 'debug' ? 'debug' : (() => { throw new Error(`apk-sidecar: unknown variant ${a.variant}`); })();
    const file0 = apkName(a.version, variant);
    const url = a.slug && a.release ? releaseAssetUrl(a.slug, a.release, file0) : undefined;
    const { file } = writeSidecar({ apk: a.apk, out: a.out, version: a.version, variant, git: a.git,
      dirty: a.dirty === '1', gradle: a.gradle, url, release: a.release });
    process.stdout.write(file + '\n');
  } else if (cmd === 'set-url') {
    setUrl({ out: a.out, url: a.url, release: a.release });
  } else {
    throw new Error(`apk-sidecar: unknown command ${cmd}`);
  }
}
