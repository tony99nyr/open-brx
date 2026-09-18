#!/usr/bin/env node
// One command from a fresh clone to a running Mission Control, on macOS, Windows or Linux.
// Run it through ./start.sh (macOS, Linux) or start.cmd (Windows): they make sure Node.js exists first.
//
//   1. Offer to update the clone when GitHub has newer commits.
//   2. Find Python 3.11 or later, make .venv, and install the Mission Control package into it.
//   3. Install the console's npm packages and build the console.
//   4. Ask once about the optional cloudflared (phones on mobile data).
//   5. Start Mission Control (scripts/mc.mjs) and open it in the browser.
//
// Every step checks before it acts, so the second run skips straight to step 5.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { isWindows, npm, root, uiStale, venvPython, which } from './lib/launcher.mjs';

const USAGE = `Usage: ./start.sh [options] [-- Mission Control options]     (Windows: start.cmd)

  --demo           run a demo: 8 pretend players and phones, no taggers, nothing saved
  --setup-only     set everything up, then stop instead of starting Mission Control
  --no-update      do not check GitHub for a newer version
  --yes            accept the default answer to every question (it never deletes a broken .venv)
  --cloudflared    ask about cloudflared again, even if you said no before
  --help           show this help

Anything after -- goes to Mission Control unchanged (for example: -- --port 9000).`;

const args = process.argv.slice(2);
const dash = args.indexOf('--');
const own = dash === -1 ? args : args.slice(0, dash);
const passthrough = dash === -1 ? [] : args.slice(dash + 1);
const known = new Set(['--demo', '--setup-only', '--no-update', '--yes', '--cloudflared', '--help', '-h']);
for (const arg of own) {
  if (!known.has(arg)) { console.error(`Unknown option: ${arg}\n\n${USAGE}`); process.exit(2); }
}
if (own.includes('--help') || own.includes('-h')) { console.log(USAGE); process.exit(0); }
const opt = name => own.includes(name);
const interactive = process.stdin.isTTY && !opt('--yes');

const home = process.env.BRX_MCP_HOME || join(homedir(), '.brx-mcp');
const prefsPath = join(home, 'start.json');
const brew = process.platform === 'darwin' ? which('brew') : null;
const winget = isWindows ? which('winget') : null;

// ---- output ---------------------------------------------------------------------------------------
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
let stepNo = 0;
const step = title => console.log(`\n${paint('1', `[${++stepNo}/5] ${title}`)}`);
const ok = text => console.log(`  ${paint('32', 'ok')}  ${text}`);
const note = text => console.log(`  ${paint('33', '--')}  ${text}`);
function stop(message, ...fix) {
  console.error(`\n${paint('31', 'Setup stopped:')} ${message}`);
  if (fix.length) console.error(`\nTo fix it:\n${fix.map(line => `  ${line}`).join('\n')}`);
  console.error('\nThen run the start script again.');
  process.exit(1);
}

// ---- questions ------------------------------------------------------------------------------------
async function ask(question, defaultYes) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  if (!interactive) {
    console.log(`  ?   ${question} ${hint} ${defaultYes ? 'yes' : 'no'} (default)`);
    return defaultYes;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // null means Ctrl+C (readline's SIGINT) or Ctrl+D (the input closed) at the question.
  const answer = await new Promise(resolveAnswer => {
    rl.question(`  ?   ${question} ${hint} `).then(resolveAnswer, () => resolveAnswer(null));
    rl.on('SIGINT', () => resolveAnswer(null));
    rl.on('close', () => resolveAnswer(null));
  });
  rl.close();
  if (answer === null) {
    console.log('\nStopped. Nothing else was changed.');
    process.exit(130);
  }
  const text = answer.trim().toLowerCase();
  return text === '' ? defaultYes : text.startsWith('y');
}
function readPrefs() {
  try { return JSON.parse(readFileSync(prefsPath, 'utf8')); } catch (_) { return {}; }
}
function writePrefs(prefs) {
  mkdirSync(home, { recursive: true });
  writeFileSync(prefsPath, JSON.stringify(prefs, null, 2) + '\n');
}

// ---- commands -------------------------------------------------------------------------------------
const run = (cmd, cmdArgs, opts = {}) => spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...opts });
const capture = (cmd, cmdArgs, opts = {}) => {
  const result = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', ...opts });
  return result.status === 0 ? result.stdout.trim() : null;
};
const hashFiles = (...paths) => {
  const hash = createHash('sha256');
  for (const path of paths) hash.update(existsSync(path) ? readFileSync(path) : '');
  return hash.digest('hex').slice(0, 16);
};
// winget changes PATH in the registry, not in this process. Read it back so a fresh install is found.
function refreshWindowsPath() {
  const path = capture('powershell', ['-NoProfile', '-Command',
    "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"]);
  if (path) process.env.PATH = path;
}

// ---- 1. update ------------------------------------------------------------------------------------
async function update() {
  step('Checking for a newer version');
  if (process.env.OPEN_BRX_JUST_UPDATED) return ok('updated to the newest version');
  if (opt('--no-update')) return note('skipped (--no-update)');
  if (!which('git') || !existsSync(join(root, '.git'))) return note('skipped: this folder is not a git clone. To update it, download it again from GitHub.');
  const upstream = capture('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { stdio: ['ignore', 'pipe', 'ignore'] });
  if (!upstream) return note('skipped: this branch does not track a branch on GitHub');
  const fetched = spawnSync('git', ['fetch', '--quiet'], {
    cwd: root, stdio: 'ignore', timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' },
  });
  if (fetched.status !== 0) return note('skipped: could not reach GitHub (no internet?). Using the version you have.');
  const behind = Number(capture('git', ['rev-list', '--count', 'HEAD..@{u}']) || 0);
  const ahead = Number(capture('git', ['rev-list', '--count', '@{u}..HEAD']) || 0);
  if (behind === 0) return ok('you have the newest version');
  const dirty = capture('git', ['status', '--porcelain', '--untracked-files=no']);
  if (dirty || ahead > 0) {
    return note(`a newer version is on GitHub (${upstream}), but this folder has its own changes. Not updating: run \`git pull\` yourself.`);
  }
  if (!(await ask(`A newer version is on GitHub (${behind} change${behind === 1 ? '' : 's'}). Update now?`, true))) return note('kept the current version');
  // Merge what the fetch above counted, not a second fetch's worth.
  if (run('git', ['merge', '--ff-only', '--quiet', '@{u}']).status !== 0) {
    return note('the update failed. Continuing with the current version; run `git pull` to see why.');
  }
  // This script may itself have changed in the pull. Run the new copy for the remaining steps.
  // Ctrl+C reaches that copy directly: stay alive until it has shut down Mission Control.
  process.on('SIGINT', () => {});
  const again = spawnSync(process.execPath, [join(root, 'scripts', 'start.mjs'), '--no-update', ...args], {
    cwd: root, stdio: 'inherit', env: { ...process.env, OPEN_BRX_JUST_UPDATED: '1' },
  });
  process.exit(again.status ?? 1);
}

// ---- 2. Python ------------------------------------------------------------------------------------
function pythonVersion(cmd, pre = []) {
  const out = capture(cmd, [...pre, '-c', 'import sys; print(sys.version_info[0], sys.version_info[1])'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });
  if (!out) return null;
  const [major, minor] = out.split(' ').map(Number);
  return { major, minor, ok: major === 3 && minor >= 11, text: `${major}.${minor}` };
}
function findPython() {
  // `py -3` first on Windows: a bare `python` there can be the Microsoft Store placeholder.
  const candidates = isWindows
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python3.13', []], ['python3.12', []], ['python3.11', []], ['python', []]];
  let tooOld = null;
  for (const [cmd, pre] of candidates) {
    if (!which(cmd)) continue;
    const version = pythonVersion(cmd, pre);
    if (version?.ok) return { cmd, pre, version };
    if (version) tooOld = version;
  }
  return tooOld ? { tooOld } : null;
}
async function installPython(found) {
  const why = found?.tooOld ? `Python ${found.tooOld.text} is too old; Mission Control needs 3.11 or later.` : 'Python 3.11 or later is not installed.';
  if (brew && (await ask(`${why} Install Python 3.13 with Homebrew?`, true))) {
    if (run('brew', ['install', 'python@3.13']).status === 0) return findPython();
  } else if (winget && (await ask(`${why} Install Python 3.13 with winget?`, true))) {
    if (run('winget', ['install', '-e', '--id', 'Python.Python.3.13', '--accept-source-agreements', '--accept-package-agreements']).status === 0) {
      refreshWindowsPath();
      return findPython();
    }
  }
  const fix = process.platform === 'linux'
    ? ['Install Python 3.11 or later with your package manager, e.g.:', '  sudo apt install python3 python3-venv     (Debian 12, Ubuntu 24.04)',
      '  sudo apt install python3.11 python3.11-venv   (Ubuntu 22.04)', '  sudo dnf install python3                  (Fedora)']
    : ['Install Python 3.11 or later from https://www.python.org/downloads/', ...(isWindows ? ['Tick "Add python.exe to PATH" in the installer, then open a new terminal.'] : [])];
  stop(why, ...fix);
}
async function python() {
  step('Python and the Mission Control package');
  const venv = venvPython();
  let venvVersion = existsSync(venv) ? pythonVersion(venv) : null;
  if (existsSync(join(root, '.venv')) && !venvVersion?.ok) {
    // A venv that cannot run (copied from another machine, made by the other OS in a shared folder, or its
    // Python was removed) or is too old. It may be someone's working venv, so ask before deleting it.
    const why = venvVersion ? `.venv uses Python ${venvVersion.text}, which is too old` : '.venv does not work on this computer';
    if (!(await ask(`${why}. Delete it and make a new one?`, interactive))) {
      stop(`${why}.`, 'Delete the .venv folder, or run the start script without --yes and answer yes.');
    }
    rmSync(join(root, '.venv'), { recursive: true, force: true });
    venvVersion = null;
  }
  if (!venvVersion) {
    let found = findPython();
    if (!found?.cmd) found = await installPython(found);
    if (!found?.cmd) stop('Python 3.11 or later was installed, but this terminal cannot see it yet.', 'Close this terminal and open a new one.');
    ok(`found Python ${found.version.text}`);
    if (run(found.cmd, [...found.pre, '-m', 'venv', '.venv']).status !== 0 || !existsSync(venv)) {
      rmSync(join(root, '.venv'), { recursive: true, force: true });
      stop('could not create the Python environment (.venv).',
        ...(process.platform === 'linux' ? ['On Debian or Ubuntu: sudo apt install python3-venv'] : ['Reinstall Python from https://www.python.org/downloads/']));
    }
    ok('created .venv');
  } else {
    ok(`.venv uses Python ${venvVersion.text}`);
  }
  // Reinstall only when the package's dependency list changed or an import fails.
  const stampPath = join(root, '.venv', '.open-brx-stamp');
  const stamp = hashFiles(join(root, 'mcp', 'pyproject.toml'));
  const current = existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === stamp;
  const imports = current && spawnSync(venv, ['-c', 'import brx_mcp.mc, bleak, websockets, starlette, uvicorn, zeroconf'], { cwd: join(root, 'mcp'), stdio: 'ignore' }).status === 0;
  if (imports) return ok('Mission Control package is installed');
  console.log('  ..  installing the Mission Control package (the first time takes a minute)');
  const pip = run(venv, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', '-e', './mcp[mc]']);
  if (pip.status !== 0) stop('pip could not install the Mission Control package (see the messages above).', 'Check the internet connection.');
  writeFileSync(stampPath, stamp + '\n');
  ok('Mission Control package is installed');
}

// ---- 3. console -----------------------------------------------------------------------------------
function consoleUi() {
  step('The Mission Control console (web page)');
  const npmVersion = capture('npm', ['--version'], { shell: isWindows });
  if (!npmVersion) stop('npm is missing. It comes with Node.js.', 'Reinstall Node.js 20 or later from https://nodejs.org/');
  const mc = join(root, 'webapp', 'mc');
  const stampPath = join(mc, 'node_modules', '.open-brx-stamp');
  const stamp = hashFiles(join(mc, 'package-lock.json'), join(mc, 'package.json'));
  if (!existsSync(stampPath) || readFileSync(stampPath, 'utf8').trim() !== stamp) {
    console.log('  ..  installing the console\'s packages (the first time takes a minute)');
    // `npm ci` installs exactly the locked versions. The repository is npm-locked here, not pnpm.
    if (npm(['ci', '--no-audit', '--no-fund', '--loglevel=error', '--update-notifier=false'], mc).status !== 0) {
      stop('npm could not install the console\'s packages (see the messages above).', 'Check the internet connection.');
    }
    writeFileSync(stampPath, stamp + '\n');
  }
  ok('console packages are installed');
  if (!uiStale()) return ok('console is built');
  console.log('  ..  building the console');
  const build = npm(['run', 'build'], mc, 'pipe');
  if (build.status !== 0) {
    process.stdout.write(build.stdout ?? '');
    process.stderr.write(build.stderr ?? '');
    stop('the console build failed (see the messages above).');
  }
  ok('console is built');
}

// ---- 4. cloudflared -------------------------------------------------------------------------------
async function cloudflared() {
  step('Optional: cloudflared, for phones on mobile data');
  if (which('cloudflared')) return ok('cloudflared is installed. Turn it on from the console when you need it.');
  const prefs = readPrefs();
  if (prefs.cloudflared === 'declined' && !opt('--cloudflared')) {
    return note('not installed (you said no before; run with --cloudflared to be asked again)');
  }
  console.log('  cloudflared lets phones reach Mission Control over the internet, through Cloudflare, when they');
  console.log('  are not on the field Wi-Fi. It needs no account. A game on one Wi-Fi network does not need it.');
  const installer = brew ? ['brew', ['install', 'cloudflared']]
    : winget ? ['winget', ['install', '-e', '--id', 'Cloudflare.cloudflared', '--accept-source-agreements', '--accept-package-agreements']]
      : null;
  if (!(await ask('Install cloudflared?', false))) {
    // Remember a no only when someone typed it, not when --yes or a non-interactive run took the default.
    if (interactive) writePrefs({ ...prefs, cloudflared: 'declined' });
    return note('skipped');
  }
  if (!installer) {
    note('install it by hand: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    return note('then restart the start script');
  }
  if (run(installer[0], installer[1]).status !== 0) return note('the cloudflared install failed. Mission Control works without it.');
  if (isWindows) refreshWindowsPath();
  delete prefs.cloudflared;
  writePrefs(prefs);
  ok('cloudflared is installed');
}

// ---- 5. start -------------------------------------------------------------------------------------
function start() {
  step(opt('--demo') ? 'Starting the Mission Control demo' : 'Starting Mission Control');
  if (opt('--setup-only')) {
    ok('setup is complete. Run the start script again to start Mission Control.');
    return;
  }
  console.log('  Mission Control opens in your browser. Keep this window open while you play. Press Ctrl+C to stop it.\n');
  const mcArgs = [...(opt('--demo') ? ['--demo', '--fake-net', '--ephemeral'] : []), ...passthrough];
  const child = spawn(process.execPath, [join(root, 'scripts', 'mc.mjs'), ...mcArgs], { cwd: root, stdio: 'inherit' });
  // Ctrl+C reaches Mission Control directly (same console). Stay alive until it has shut down.
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('exit', code => process.exit(code ?? 1));
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 11)) {
  stop(`Node.js ${process.versions.node} is too old; Open BRX needs 20.11 or later.`, 'Install the current LTS from https://nodejs.org/');
}
if (!process.env.OPEN_BRX_JUST_UPDATED) console.log(paint('1', 'Open BRX Mission Control: setup and start'));
await update();
await python();
consoleUi();
await cloudflared();
start();
