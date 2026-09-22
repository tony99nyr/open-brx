import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Resolve the Python that carries MC's dependencies without assuming a git worktree has its own venv. */
export function findPython(repo, opts = {}) {
  const env = opts.env ?? process.env;
  const exists = opts.exists ?? fs.existsSync;
  const platform = opts.platform ?? process.platform;
  const common = opts.common ?? (() => execFileSync(
    'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: repo, encoding: 'utf8' },
  ).trim());
  if (env.MC_PY) return env.MC_PY;
  const relative = platform === 'win32' ? path.join('.venv', 'Scripts', 'python.exe') : path.join('.venv', 'bin', 'python');
  const candidates = [path.join(repo, relative)];
  try { candidates.push(path.join(path.dirname(common()), relative)); } catch { /* not a git checkout */ }
  const found = candidates.find((candidate, i) => candidates.indexOf(candidate) === i && exists(candidate));
  if (found) return found;
  throw new Error(`no Python venv found (${candidates.join(', ')}); set MC_PY to an interpreter with the MC dependencies`);
}
