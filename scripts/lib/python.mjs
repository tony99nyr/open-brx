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

/** What decides `mcp/tests/test_pyright.py`'s result: the code it checks (`mcp/pyproject.toml` `[tool.pyright] include =
 *  ["brx_mcp"]`), its config, the test itself and the pinned dependencies (review). */
const PYRIGHT_FILES = new Set(['mcp/pyproject.toml', 'mcp/tests/test_pyright.py', 'mcp/constraints.txt']);
export const inPyrightScope = p => p.startsWith('mcp/brx_mcp/') || PYRIGHT_FILES.has(p);

/** The `--no-skip` flags test-all passes the mcp runner. T7: a repo .venv has mcp's `mc` extra, so a websockets or
 *  uvicorn skip means a broken venv. F613 (2026-10-25): a worktree's partial .venv had no pyright, `test_pyright`
 *  skipped, the --changed gate read green and the lander went red on 3 type errors. So a gate on code pyright checks
 *  (a --changed run whose `changedPaths` touch it, or any lander gate) refuses a pyright skip too: install pyright
 *  (`pip install pyright`) or gate from a venv that has it. A plain run keeps the skip, since `./start.sh` installs
 *  no pyright. MC_PY and system python skip the extras by design (CLAUDE.md), but a lander gate refuses a pyright skip
 *  whatever python it runs: the lander stands in for CI's pyright pass (Codex review). */
export function noSkipFor({ foundVenv, landGate = false, changedPaths = null }) {
  const reasons = foundVenv ? ['websockets', 'uvicorn'] : [];
  if (landGate || (foundVenv && Array.isArray(changedPaths) && changedPaths.some(inPyrightScope))) reasons.push('pyright');
  return reasons.flatMap(s => ['--no-skip', s]);
}
