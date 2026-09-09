// Always build before testing, so a stale bundle is impossible (ui-build-verify §3.8).
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export default async function () {
  execFileSync('node', [path.join(SITE, 'build.mjs')], { stdio: 'inherit', cwd: SITE });
}
