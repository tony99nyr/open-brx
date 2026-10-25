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

/** The code `mcp/tests/test_pyright.py` checks (`mcp/pyproject.toml` `[tool.pyright] include = ["brx_mcp"]`). */
export const inPyrightScope = p => p.startsWith('mcp/brx_mcp/') || p === 'mcp/pyproject.toml';

/** The `--no-skip` flags test-all passes the mcp runner. T7: a repo .venv has mcp's `mc` extra, so a websockets or
 *  uvicorn skip means a broken venv. F613 (2026-10-25): a worktree's partial .venv had no pyright, `test_pyright`
 *  skipped, the --changed gate read green and the lander went red on 3 type errors. So a gate on code pyright checks
 *  (a --changed run whose `changedPaths` touch it, or any lander gate) refuses a pyright skip too: install pyright
 *  (`pip install pyright`) or gate from a venv that has it. A plain run keeps the skip, since `./start.sh` installs
 *  no pyright. MC_PY and system python skip by design (CLAUDE.md), so they refuse nothing. */
export function noSkipFor({ foundVenv, landGate = false, changedPaths = null }) {
  if (!foundVenv) return [];
  const reasons = ['websockets', 'uvicorn'];
  if (landGate || (Array.isArray(changedPaths) && changedPaths.some(inPyrightScope))) reasons.push('pyright');
  return reasons.flatMap(s => ['--no-skip', s]);
}
