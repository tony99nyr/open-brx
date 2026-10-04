// Content-addressed test results shared by worktrees through their common Git directory.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const sha256 = data => createHash('sha256').update(data).digest('hex');
const git = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr?.trim() || r.error?.message}`);
  return r.stdout.trim();
};

export function cacheDir(root) {
  const common = git(root, ['rev-parse', '--git-common-dir']);
  return path.join(path.resolve(root, common), 'brx-test-cache');
}

export function headOf(root) { return git(root, ['rev-parse', 'HEAD']); }

// These variables select the executable, temporary homes, shell, terminal, or host display.
// They do not select test inputs or change test assertions. Keep result-affecting settings out.
const BENIGN_ENV = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'PWD', 'OLDPWD', 'SHLVL',
  'COLORTERM', 'DISPLAY', 'WAYLAND_DISPLAY', 'TMPDIR', 'XDG_RUNTIME_DIR',
  'WSL_DISTRO_NAME', 'WSL_INTEROP', 'WSLENV', 'WSL2_GUI_APPS_ENABLED',
  'SSH_AUTH_SOCK', 'SSH_AGENT_PID', 'MC_PY', 'BRX_MCP_HOME',
  'AI_AGENT', 'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_EFFORT', 'CLAUDE_PID', 'CLAUDE_PLUGIN_DATA',
  'CODEX_CI', 'CODEX_COMPANION_SESSION_ID', 'CODEX_COMPANION_TRANSCRIPT_PATH',
  'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_VERSION',
  'ANDROID_HOME', 'BUN_INSTALL', 'COREPACK_ENABLE_AUTO_PIN', 'DBUS_SESSION_BUS_ADDRESS', 'FPATH', 'GH_PAGER',
  'HOMEBREW_CELLAR', 'HOMEBREW_PREFIX', 'HOMEBREW_REPOSITORY', 'INFOPATH', 'LESS', 'MANPAGER',
  'MANROFFOPT', 'NAME', 'NO_COLOR', 'OLLAMA_KEEP_ALIVE', 'OLLAMA_MODELS', 'PAGER',
  'NVM_BIN', 'NVM_CD_FLAGS', 'NVM_DIR', 'NVM_INC', 'PNPM_HOME', 'PULSE_SERVER',
  'YSU_VERSION', 'ZSH', '_',
]);
const BENIGN_PREFIXES = ['WSL_', 'XDG_', 'SSH_'];

export function cacheBypassReason(env) {
  const set = Object.keys(env).sort().find(name => !BENIGN_ENV.has(name)
    && !BENIGN_PREFIXES.some(prefix => name.startsWith(prefix)));
  return set ? `environment variable affects test results: ${set}` : null;
}

export function installedNpmState(root, pkg) {
  try {
    const modules = fs.realpathSync(path.join(root, pkg, 'node_modules'));
    return sha256(fs.readFileSync(path.join(modules, '.package-lock.json')));
  } catch { return null; }
}

export function jobContext(root, job, now = new Date()) {
  if (job !== 'mcp') return null;
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
  return { head: headOf(root), date };
}

/** Stage only declared paths in a private index, then hash their index entries. */
export function inputTreeHash(root, inputs) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'brx-test-index-'));
  const index = path.join(temp, 'index');
  const objects = path.join(temp, 'objects');
  fs.mkdirSync(objects);
  const common = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
  const alternates = [path.join(common, 'objects'), process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES].filter(Boolean).join(path.delimiter);
  const env = { ...process.env, GIT_INDEX_FILE: index, GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: alternates };
  const run = args => {
    const r = spawnSync('git', ['-c', 'core.splitIndex=false', '-c', 'core.fsmonitor=false', ...args],
      { cwd: root, env, maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr?.toString().trim() || r.error?.message}`);
    return r.stdout;
  };
  try {
    const realIndex = path.resolve(root, git(root, ['rev-parse', '--git-path', 'index']));
    if (fs.existsSync(realIndex)) {
      const stat = fs.statSync(realIndex);
      fs.copyFileSync(realIndex, index);
      fs.utimesSync(index, stat.atime, stat.mtime);
    }
    else run(['read-tree', 'HEAD']);
    const flags = run(['ls-files', '-v']).toString().split('\n');
    if (flags.some(line => /^[a-z]/.test(line) || /^S /.test(line)))
      throw new Error('cache unavailable: assume-unchanged or skip-worktree index entry');
    const paths = run(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...inputs])
      .toString().split('\0').filter(Boolean);
    for (let i = 0; i < paths.length; i += 200)
      run(['add', '-A', '--', ...paths.slice(i, i + 200).map(p => `:(literal)${p}`)]);
    const entries = run(['ls-files', '--stage', '-z', '--', ...inputs]);
    return sha256(entries);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

export function toolFingerprint(root, python) {
  const command = (exe, args) => {
    const r = spawnSync(exe, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return r.status === 0 ? (r.stdout || r.stderr).trim() : `unavailable:${r.error?.code || r.status}`;
  };
  const fileHash = p => fs.existsSync(p) ? sha256(fs.readFileSync(p)) : 'missing';
  const locks = ['app/package-lock.json', 'webapp/mc/package-lock.json', 'site/package-lock.json'];
  const packages = ['app', 'webapp/mc', 'site'];
  const browserFiles = [
    'app/node_modules/playwright-core/browsers.json',
    'webapp/mc/node_modules/playwright-core/browsers.json',
    'site/node_modules/playwright-core/browsers.json',
  ];
  const chromium = browserFiles.map(p => {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
      return [p, json.browsers?.find(b => b.name === 'chromium')?.revision || 'missing'];
    } catch { return [p, 'missing']; }
  });
  const freeze = command(python, ['-m', 'pip', 'freeze']).split('\n').filter(line => !/^-e\s/.test(line)).join('\n');
  const fonts = command('fc-list', []);
  return sha256(JSON.stringify({
    git: command('git', ['--version']), node: command('node', ['--version']), python: command(python, ['--version']),
    pipFreeze: sha256(freeze), locks: locks.map(p => [p, fileHash(path.join(root, p))]),
    installed: packages.map(p => [p, installedNpmState(root, p)]),
    chromium, fonts: fonts.startsWith('unavailable:') ? 'absent' : sha256(fonts.split('\n').sort().join('\n')),
  }));
}

export function cacheKey({ job, cmd, env, fingerprint, inputHash, context = null }) {
  const command = cmd.filter((arg, i) => !(
    (arg === '-j' || arg === '--maxWorkers' || arg === '--workers' || arg === '--shards')
    || (i > 0 && ['-j', '--maxWorkers', '--workers', '--shards'].includes(cmd[i - 1]))
    || /^(--maxWorkers|--workers|--shards)=/.test(arg)
    || arg === '--ui'
  ));
  const environment = Object.fromEntries(Object.entries(env).filter(([name]) => name !== 'SCREENS_SHARDS'));
  return sha256(JSON.stringify({ job, cmd: command, env: environment, fingerprint, inputHash, context }));
}

export function pruneCache(root, now = Date.now()) {
  const dir = cacheDir(root);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') && name.endsWith('.tmp')) {
      const file = path.join(dir, name);
      try { if (now - fs.statSync(file).mtimeMs > 86400000) fs.rmSync(file, { force: true }); }
      catch { /* already removed */ }
      continue;
    }
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Number.isFinite(entry.t) || now - entry.t > MAX_AGE_MS) fs.rmSync(file, { force: true });
    } catch { fs.rmSync(file, { force: true }); }
  }
}

export function readCache(root, key, now = Date.now()) {
  const file = path.join(cacheDir(root), `${key}.json`);
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (entry.key === key && entry.exit === 0 && Number.isFinite(entry.t) && now - entry.t <= MAX_AGE_MS) return entry;
    if (now - entry.t > MAX_AGE_MS) fs.rmSync(file, { force: true });
  } catch { /* no valid entry */ }
  return null;
}

export function writeCache(root, entry) {
  if (entry.exit !== 0) return false;
  const dir = cacheDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${entry.key}.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(entry));
    fs.renameSync(temp, path.join(dir, `${entry.key}.json`));
  } finally { fs.rmSync(temp, { force: true }); }
  return true;
}

export function storePass(root, { job, key, exit, secs, head, before, after, flake = false, stopping = false }) {
  if (exit !== 0 || before !== after || flake || stopping) return false;
  return writeCache(root, { job, key, exit: 0, secs, t: Date.now(), head });
}

export function allCached(jobs, hits) { return jobs.every(j => hits.has(j.name)); }

export function canExitAllCached(jobs, hits) {
  return allCached(jobs, hits) && jobs.every(j => !j.www && !j.dist);
}

function newestFile(dir) {
  let newest = 0;
  if (!fs.existsSync(dir)) return newest;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestFile(file));
    else if (entry.isFile()) newest = Math.max(newest, fs.statSync(file).mtimeMs);
  }
  return newest;
}

export function outputsFresh(root, job) {
  // Freshness only protects cached test results; it must never be used to skip a build.
  if (job.www) {
    const bundle = path.join(root, 'app/www/app.js');
    if (!fs.existsSync(path.join(root, 'app/www/index.html')) || !fs.existsSync(bundle)
      || fs.statSync(bundle).mtimeMs < newestFile(path.join(root, 'app/src'))) return false;
  }
  if (job.dist) {
    const dist = path.join(root, 'webapp/mc/dist');
    if (!fs.existsSync(path.join(dist, 'index.html'))
      || newestFile(path.join(dist, 'assets')) < newestFile(path.join(root, 'webapp/mc/src'))) return false;
  }
  return true;
}
