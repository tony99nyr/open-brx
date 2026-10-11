// One answer to "is this build stale?" for the two bundles the gates and the launcher serve (DRY review #7). The
// inputs are what each build reads: vite for the console, app/scripts/build.mjs (esbuild) for the phone HUD.
import fs from 'node:fs';
import path from 'node:path';

const MC = 'webapp/mc';
const BUNDLES = {
  mc: {
    output: `${MC}/dist/index.html`,
    // vite's production build also reads these env files (the UI reads VITE_MOCK); .env.example is not one.
    inputs: root => [`${MC}/src`, `${MC}/public`, `${MC}/index.html`, `${MC}/vite.config.ts`, `${MC}/package.json`,
      `${MC}/package-lock.json`, `${MC}/tsconfig.json`, `${MC}/tsconfig.app.json`, `${MC}/tsconfig.node.json`,
      ...['.env', '.env.local', '.env.production', '.env.production.local'].map(f => `${MC}/${f}`)],
    // The page is not enough: an index.html whose script asset is gone serves a blank console.
    required: root => assetsOf(root, `${MC}/dist`),
    hint: 'cd webapp/mc && npm run build',
  },
  app: {
    output: 'app/www/app.js',
    // esbuild reads each plugin's src/ and package.json only: gradle and Xcode write build trees beside them.
    inputs: root => ['app/src', 'app/scripts/build.mjs', 'mcp/brx_mcp/mc/golden_bundle.json', 'app/package.json',
      'app/package-lock.json',
      ...listDir(root, 'app/plugins').flatMap(p => [`app/plugins/${p}/src`, `app/plugins/${p}/package.json`])],
    required: () => ['app/www/index.html'],
    hint: 'cd app && npm run build',
  },
};

function listDir(root, rel) {
  try { return fs.readdirSync(path.join(root, rel)); } catch { return []; }
}

/** The script assets dist/index.html references, as repo-relative paths. */
function assetsOf(root, dist) {
  let html = '';
  try { html = fs.readFileSync(path.join(root, dist, 'index.html'), 'utf8'); } catch { return []; }
  return [...html.matchAll(/<script[^>]*\ssrc="\/?([^"]+\.js)"/g)].map(m => `${dist}/${m[1]}`);
}

/** Newest FILE mtime under `file`, 0 when it is gone. A directory's own mtime does not count: a job that writes and
 *  removes a temporary file there (the contract generator in webapp/mc/src/api) would make a fresh build look stale
 *  mid-gate. A valid link is followed; a dangling one (an editor's lock link) counts as itself and must not throw. */
function newestMtime(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { try { stat = fs.lstatSync(file); } catch { return 0; } }
  if (!stat.isDirectory()) return stat.mtimeMs;
  let names = [];
  try { names = fs.readdirSync(file); } catch { return 0; }
  return names.reduce((newest, name) => Math.max(newest, newestMtime(path.join(file, name))), 0);
}

/** null when the bundle is fresh, else one line saying why it is stale and how to rebuild it. */
export function bundleStale(root, name) {
  const bundle = BUNDLES[name];
  if (!bundle) throw new Error(`unknown bundle: ${name}`);
  const output = path.join(root, bundle.output);
  if (!fs.existsSync(output)) return `${bundle.output} is missing; ${bundle.hint}`;
  for (const required of bundle.required(root)) {
    if (!fs.existsSync(path.join(root, required))) return `${required} is missing; ${bundle.hint}`;
  }
  const outputTime = fs.statSync(output).mtimeMs;
  for (const input of bundle.inputs(root)) {
    if (newestMtime(path.join(root, input)) > outputTime) return `${input} is newer than ${bundle.output}; ${bundle.hint}`;
  }
  return null;
}
