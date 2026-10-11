// The dev Python, shared by scripts/test-all.mjs and scripts/regen.mjs: MC_PY, else this checkout's .venv, else the
// main checkout's .venv (a worktree, wherever it lives, has no .venv of its own: git's common dir names the main
// checkout), else system python3, which skips the tests that need the MC extras.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** `{ python, foundVenv }`. `foundVenv` is true only when a repo .venv was picked (not MC_PY, not system python):
 *  test-all holds only a repo venv to the extras (T7). */
export function findPython(root) {
  if (process.env.MC_PY) return { python: process.env.MC_PY, foundVenv: false };
  const candidates = [path.join(root, '.venv/bin/python')];
  try {
    const git = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
    if (git.status !== 0) throw new Error(git.stderr || git.error?.message);
    const common = git.stdout.trim();
    candidates.push(path.join(path.dirname(common), '.venv/bin/python'));
  } catch { /* not a git checkout */ }
  const found = candidates.find(p => fs.existsSync(p));
  return { python: found || 'python3', foundVenv: Boolean(found) };
}
