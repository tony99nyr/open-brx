// The Windows user folder as WSL sees it, for review galleries that Tony opens from Windows. `BRX_WIN_HOME` (a WSL path
// such as /mnt/c/Users/<you>) overrides; otherwise Windows is asked once for %USERPROFILE%. Off WSL (CI, a Mac) the home
// folder stands in. The galleries never write inside the repo.
import { execFileSync } from 'node:child_process';
import os from 'node:os';

export function winHome() {
  if (process.env.BRX_WIN_HOME) return process.env.BRX_WIN_HOME;
  try {
    const win = execFileSync('cmd.exe', ['/c', 'chcp 65001>nul & echo %USERPROFILE%'], { cwd: '/mnt/c', timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const wsl = execFileSync('wslpath', ['-u', win], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (win && wsl) return wsl;
  } catch { /* not WSL: fall through */ }
  return os.homedir();
}
