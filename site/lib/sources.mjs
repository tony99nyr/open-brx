// The complete list of files the build depends on — shared by build.mjs (stamps the manifest) and the
// test guard (refuses to run when any of them is newer than the build).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SITE_DIR = path.resolve(HERE, '..');
export const REPO_DIR = path.resolve(SITE_DIR, '..');

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else out.push(p);
  }
  return out;
}

/** Every input file for a build of `manualDir`. */
export function sourceFiles(manualDir) {
  return [
    path.join(SITE_DIR, 'build.mjs'),
    ...walk(path.join(SITE_DIR, 'lib')),
    ...walk(path.join(SITE_DIR, 'assets')),
    ...walk(manualDir),
    path.join(REPO_DIR, 'mcp/brx_mcp/mc/weapons.json'),
    path.join(REPO_DIR, 'docs/reference/weapons.md'),
    path.join(REPO_DIR, 'protocol/callsign-extract/Sounds.json'),
  ].filter(p => fs.existsSync(p) && fs.statSync(p).isFile());
}

export function sourceStamp(manualDir) {
  return Math.max(...sourceFiles(manualDir).map(p => fs.statSync(p).mtimeMs));
}
