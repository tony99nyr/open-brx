// Refuse to test a stale or failed bundle (ui-build-verify §3.8), then build the stale-content fixture.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceFiles, REPO_DIR, SITE_DIR } from '../lib/sources.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export default async function () {
  const manifestPath = path.join(REPO_DIR, 'webapp/.site-manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('webapp/.site-manifest.json missing — run `npm run build` first');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (m.ok === false) throw new Error(`FAILED BUILD: the last build did not pass its own gate (${(m.problems || []).length} problems) — fix and rebuild before testing`);
  const manual = path.join(REPO_DIR, 'docs/manual');
  const now = sourceFiles(manual);
  const known = new Set(m.sources || []);
  const added = now.map(p => path.relative(REPO_DIR, p)).filter(r => !known.has(r));
  const changed = now.filter(p => fs.statSync(p).mtimeMs > m.sourceStamp + 1).map(p => path.relative(REPO_DIR, p));
  if (added.length || changed.length) throw new Error(`STALE BUNDLE: source newer than webapp/ output — rebuild first (npm run build). Changed: ${changed.join(', ') || '—'}; new: ${added.join(', ') || '—'}`);
  execFileSync('node', [path.join(SITE_DIR, 'build.mjs'), '--manual', path.join(HERE, 'fixtures/manual-stale'), '--out', path.join(HERE, 'out-stale')], { stdio: 'inherit' });
}
