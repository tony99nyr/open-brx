// Keeps cloudflared at Cloudflare's minimum version or later (step 4 of start.mjs).
// The decision logic takes every outside effect through a `deps` object, so the tests fake all of it.
// Nothing here may throw into the start script or block a game start for long.
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { root, which } from './launcher.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000; // a failed check is tried again after an hour
const RELEASES_API = 'https://api.github.com/repos/cloudflare/cloudflared/releases/latest';
const RELEASES = 'https://github.com/cloudflare/cloudflared/releases';
export const DOWNLOADS_PAGE = 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/';
const UPGRADE_CAP_MS = 300000; // the longest an upgrade may run before it is stopped
// Why the last upgrade did not install the release, and how long to wait before trying that release again.
const RETRY_AFTER = { lag: DAY_MS, failed: DAY_MS, stopped: DAY_MS, download: RETRY_MS };
const VERSION_RE = /^\d+(\.\d+)+$/;
const LINUX_ARCH = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' };

/** The minimum version, read from the text of `mcp/brx_mcp/mc/tunnel.py` (like appVersion). Null when it does not parse. */
export function minVersionFromText(tunnelText) {
  const found = /^CLOUDFLARED_MIN_VERSION\s*=\s*["'](\d+(?:\.\d+)*)["']/m.exec(tunnelText || '');
  return found ? found[1] : null;
}

/** "2026.10.2" from `cloudflared --version` output, or null. */
export function parseCloudflaredVersion(text) {
  const found = /\bversion\s+v?(\d+(?:\.\d+)+)/i.exec(text || '');
  return found ? found[1] : null;
}

/** Numeric dotted compare: -1 when a is older than b, 0 when equal, 1 when newer. */
export function compareVersions(a, b) {
  const left = String(a).split('.').map(part => Number(part) || 0);
  const right = String(b).split('.').map(part => Number(part) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The cache, checked on read. A `latest` that is not a version means no cache. A time in the future (the clock
 * stepped back) counts as expired: the version stays usable as a fallback, but it is never fresh.
 */
function loadCache(deps) {
  let raw = null;
  try { raw = deps.readCache(); } catch (_) { return null; }
  if (!raw || typeof raw !== 'object') return null;
  if (raw.latest != null && !(typeof raw.latest === 'string' && VERSION_RE.test(raw.latest))) return null;
  const now = deps.now();
  const past = value => (Number.isFinite(value) && value <= now ? value : null);
  const attempted = typeof raw.attempted === 'string' && VERSION_RE.test(raw.attempted) ? raw.attempted : null;
  return {
    checked_at: past(raw.checked_at), latest: raw.latest ?? null, failed: Boolean(raw.failed),
    attempted, attempted_at: attempted ? past(raw.attempted_at) : null,
    reason: Object.hasOwn(RETRY_AFTER, raw.reason) ? raw.reason : 'failed',
  };
}

/**
 * The newest released version. Asks the network at most once a day after a success and once an hour after a
 * failure (the attempt time is stored either way). A failure keeps the cached version, or gives null.
 */
export async function latestRelease(deps) {
  const cache = loadCache(deps);
  const window = cache?.failed ? RETRY_MS : DAY_MS;
  if (cache && cache.checked_at !== null && deps.now() - cache.checked_at < window) return cache.latest;
  let latest = null;
  try { latest = await deps.fetchLatest(); } catch (_) { /* offline */ }
  if (latest && !VERSION_RE.test(latest)) latest = null;
  const tried = cache?.attempted_at != null ? { attempted: cache.attempted, attempted_at: cache.attempted_at, reason: cache.reason } : {};
  const record = latest ? { ...tried, checked_at: deps.now(), latest } : { ...tried, checked_at: deps.now(), latest: cache?.latest ?? null, failed: true };
  try { deps.writeCache(record); } catch (_) { /* a missing cache only costs one more request */ }
  return record.latest;
}

/** Remember that an upgrade to `latest` did not install it, and why, so the same release is not tried again at once. */
function recordAttempt(deps, latest, reason) {
  try {
    const cache = loadCache(deps) || {};
    const { checked_at = deps.now(), latest: known = latest, failed } = cache;
    deps.writeCache({ checked_at, latest: known, ...(failed ? { failed: true } : {}), attempted: latest, attempted_at: deps.now(), reason });
  } catch (_) { /* the next start tries again */ }
}

/** What to run by hand on this platform. Used in the loud message and when an upgrade cannot run itself. */
export function manualInstruction({ platform, arch, latest, binPath, owned, lag }) {
  // brew's file is a symlink into the Cellar: never tell anyone to replace it.
  if (platform === 'darwin' && lag) return { command: null, text: `Wait for brew to publish it, or download it from ${DOWNLOADS_PAGE} and put it earlier on PATH` };
  if (platform === 'darwin' && owned) return { command: 'brew upgrade cloudflared', text: 'Run: brew upgrade cloudflared' };
  if (platform === 'win32' && owned) return { command: 'winget upgrade -e --id Cloudflare.cloudflared', text: 'Run: winget upgrade -e --id Cloudflare.cloudflared' };
  if (platform === 'darwin' || platform === 'win32') {
    return { command: null, text: `Download the newest cloudflared from ${DOWNLOADS_PAGE}${binPath ? ` and replace ${binPath}` : ''}` };
  }
  const debArch = LINUX_ARCH[arch];
  if (platform === 'linux' && debArch) {
    const url = `${RELEASES}/${latest ? `download/${latest}` : 'latest/download'}/cloudflared-linux-${debArch}.deb`;
    const command = `curl -fLO ${url} && sudo dpkg -i cloudflared-linux-${debArch}.deb`;
    return { command, text: `On Debian or Ubuntu, run: ${command}. On other distributions, download it from ${DOWNLOADS_PAGE}` };
  }
  return { command: null, text: `Download the newest cloudflared from ${DOWNLOADS_PAGE}` };
}

/**
 * How to upgrade, as data: {kind:'command', cmd, args} | {kind:'download', url, binPath} | {kind:'manual', text, command}.
 * `writable` says whether the folder of the binary is writable by this user (Linux only).
 */
export function upgradePlan({ platform, brew, winget, binPath, arch, latest, writable, owned }) {
  if (platform === 'darwin' && brew && owned) return { kind: 'command', cmd: 'brew', args: ['upgrade', 'cloudflared'] };
  if (platform === 'win32' && winget && owned) {
    return { kind: 'command', cmd: 'winget', args: ['upgrade', '-e', '--id', 'Cloudflare.cloudflared', '--accept-source-agreements', '--accept-package-agreements'] };
  }
  if (platform === 'linux') {
    const debArch = LINUX_ARCH[arch];
    if (debArch && binPath && writable && latest) {
      return { kind: 'download', url: `${RELEASES}/download/${latest}/cloudflared-linux-${debArch}`, binPath };
    }
    if (debArch) return { kind: 'manual', ...manualInstruction({ platform, arch, latest }) };
  }
  return { kind: 'manual', ...manualInstruction({ platform, arch, latest, binPath }) };
}

/**
 * Download the release binary next to the old one, check that it runs and is newer than `installed`, then
 * rename it over the old one. Throws on any failure and removes the temp file.
 */
export async function replaceBinary(plan, deps, installed) {
  const temp = `${plan.binPath}.download`;
  try {
    await deps.fs.download(plan.url, temp);
    deps.fs.chmod(temp, 0o755);
    const check = deps.run(temp, ['--version'], { timeout: 10000 });
    const version = check.error || check.status !== 0 ? null : parseCloudflaredVersion(`${check.stdout || ''}\n${check.stderr || ''}`);
    if (!version || (installed && compareVersions(version, installed) <= 0)) throw new Error('the file did not run as a newer cloudflared');
    deps.fs.rename(temp, plan.binPath);
  } catch (error) {
    try { deps.fs.remove(temp); } catch (_) { /* nothing to clean */ }
    throw error;
  }
}

/** Why a command did not succeed, in a few words, or null when it did. */
function failure(result) {
  if (killed(result)) return 'it took too long';
  if (result.error) return `it could not run (${result.error.code || result.error.message})`;
  if (result.status !== 0) return `it exited with code ${result.status}`;
  return null;
}

/** True when the time cap stopped the command. */
function killed(result) {
  return Boolean(result.signal) || result.error?.code === 'ETIMEDOUT';
}

/** True when the package manager said there is no newer build to install (winget exits 0x8A15002B for this). */
function noNewerBuild(result) {
  const said = `${result.stdout || ''}\n${result.stderr || ''}`;
  return result.status === 0 || result.status === 0x8A15002B || result.status === (0x8A15002B | 0) || /no (applicable|newer)/i.test(said);
}

/** True when brew (macOS) or winget (Windows) owns the cloudflared install. A failed or slow check means no. */
function ownedByManager(deps) {
  let result;
  if (deps.platform === 'darwin' && deps.which('brew')) result = deps.run('brew', ['list', '--versions', 'cloudflared'], { timeout: 30000 });
  else if (deps.platform === 'win32' && deps.which('winget')) result = deps.run('winget', ['list', '-e', '--id', 'Cloudflare.cloudflared', '--accept-source-agreements', '--disable-interactivity'], { timeout: 30000 });
  else return false;
  if (result.error || result.status !== 0) return false;
  return deps.platform === 'win32' || /cloudflared/i.test(result.stdout || '');
}

function readVersion(deps) {
  const result = deps.run('cloudflared', ['--version'], { timeout: 10000 });
  return result.error || result.status !== 0 ? null : parseCloudflaredVersion(`${result.stdout || ''}\n${result.stderr || ''}`);
}

/**
 * The whole step. Never throws. Returns {missing:true} when cloudflared is not installed (the caller keeps its
 * install offer), else {installed, latest, upgraded, belowMin, lines}. A line is {level:'ok'|'note'|'loud', text}.
 */
export async function ensureCloudflared(deps, opts = {}) {
  const lines = [];
  const say = (level, text) => lines.push({ level, text });
  try {
    const binPath = deps.which('cloudflared');
    if (!binPath) return { missing: true, installed: null, latest: null, upgraded: false, belowMin: false, lines };
    let installed = readVersion(deps);
    const min = opts.minVersion || null;
    const latest = opts.noUpdate ? null : await latestRelease(deps);
    let upgraded = false;
    // 'lag' means the package manager has no newer build yet; 'quiet' means the message already says what to do.
    let outcome = null;
    // Ask the package manager only when the answer is needed: an up-to-date start runs no extra command.
    let owned = null;
    const isOwned = () => (owned ??= ownedByManager(deps));
    const manager = deps.platform === 'darwin' ? 'brew' : 'winget';
    if (installed && latest && compareVersions(installed, latest) < 0) {
      const cache = loadCache(deps);
      if (cache?.attempted === latest && cache.attempted_at !== null && deps.now() - cache.attempted_at < RETRY_AFTER[cache.reason]) {
        outcome = cache.reason === 'lag' ? 'lag' : 'skipped';
        const why = {
          lag: `${manager} has no newer build yet (cloudflared ${latest} is out). Not trying again for a day.`,
          stopped: 'the last cloudflared update was stopped after 5 minutes. Trying again tomorrow.',
          download: 'the last cloudflared download did not work. Trying again in an hour.',
          failed: 'the last cloudflared update failed. Trying again tomorrow.',
        };
        say('note', why[cache.reason]);
      } else {
        let problem = null;
        let result = null;
        let reason = null;
        const dir = dirname(binPath);
        // The Linux swap needs a plain file in a writable folder that dpkg does not own.
        const swappable = deps.platform === 'linux' && deps.fs.isWritable(dir) && deps.fs.kind(binPath) === 'file'
          && !(deps.which('dpkg') && deps.run('dpkg', ['-S', binPath], { timeout: 10000 }).status === 0);
        const plan = upgradePlan({
          platform: deps.platform, brew: deps.which('brew'), winget: deps.which('winget'), binPath, arch: deps.arch, latest,
          writable: swappable, owned: isOwned(),
        });
        if (plan.kind === 'manual') {
          problem = 'it cannot update itself here';
        } else {
          if (plan.kind === 'download') {
            try { await replaceBinary(plan, deps, installed); } catch (error) { problem = `the download failed (${error.message || error})`; reason = 'download'; }
          } else {
            result = deps.run(plan.cmd, plan.args, {
              timeout: UPGRADE_CAP_MS, show: true, ...(plan.cmd === 'brew' ? { env: { HOMEBREW_NO_ENV_HINTS: '1' } } : {}),
            });
            problem = failure(result);
            reason = killed(result) ? 'stopped' : noNewerBuild(result) ? 'lag' : 'failed';
          }
        }
        const after = readVersion(deps);
        if (after) {
          upgraded = compareVersions(after, installed) > 0;
          if (upgraded) problem = null;
          const before = installed;
          installed = after;
          if (upgraded) say('ok', `updated cloudflared from ${before} to ${installed}`);
        }
        if (!upgraded && reason) recordAttempt(deps, latest, reason);
        if (!upgraded) {
          if (result && killed(result)) {
            outcome = 'quiet';
            say('note', manager === 'brew'
              ? 'the cloudflared update took too long and was stopped. Run `brew upgrade cloudflared` yourself.'
              : 'the cloudflared update took too long and was stopped. Run the winget upgrade again: winget upgrade -e --id Cloudflare.cloudflared');
          } else if (result && noNewerBuild(result)) {
            outcome = 'lag';
            say('note', `${manager} has no newer build yet (cloudflared ${latest} is out). Mission Control works without the update.`);
          } else {
            problem = problem || 'the version did not change';
            say('note', `could not update cloudflared ${installed} to ${latest}: ${problem}. Mission Control works without it.`);
          }
        }
      }
    } else if (installed) {
      say('ok', `cloudflared ${installed} is installed${latest ? ' and up to date' : ''}. Turn it on from the console when you need it.`);
      if (!opts.noUpdate && !latest) say('note', 'could not check for a newer cloudflared (no internet?)');
    } else {
      say('ok', 'cloudflared is installed. Turn it on from the console when you need it.');
      say('note', 'could not read the cloudflared version');
    }
    const belowMin = Boolean(installed && min && compareVersions(installed, min) < 0);
    // When the package manager is behind, its command cannot help: point at the download instead.
    const manual = () => manualInstruction({ platform: deps.platform, arch: deps.arch, latest, binPath, owned: outcome === 'lag' ? false : isOwned(), lag: outcome === 'lag' });
    if (belowMin) {
      say('loud', `cloudflared ${installed} is older than ${min}, the minimum Cloudflare asks for.`);
      say('loud', 'The internet tunnel may stop working until you update it.');
      say('loud', manual().text);
    } else if (!outcome && lines.some(line => line.level === 'note' && line.text.startsWith('could not update'))) {
      say('note', manual().text);
    }
    return { missing: false, installed, latest, upgraded, belowMin, lines };
  } catch (error) {
    say('note', `could not check cloudflared (${error.message || error}). Mission Control works without it.`);
    return { missing: false, installed: null, latest: null, upgraded: false, belowMin: false, lines };
  }
}

/** The real dependencies for start.mjs. `home` is the Open BRX home folder (BRX_MCP_HOME or ~/.brx-mcp). */
export function realDeps(home) {
  const cachePath = join(home, 'cloudflared.json');
  return {
    platform: process.platform,
    arch: process.arch,
    which,
    now: () => Date.now(),
    run(cmd, cmdArgs, { timeout, show = false, env } = {}) {
      const result = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', timeout, stdio: show ? 'inherit' : ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env });
      return { status: result.status, signal: result.signal, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
    },
    async fetchLatest() {
      // OPEN_BRX_CLOUDFLARED_API is set only by tests, so that they cannot reach GitHub.
      const api = process.env.OPEN_BRX_CLOUDFLARED_API || RELEASES_API;
      const response = await fetch(api, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'open-brx-start' }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      const tag = (await response.json()).tag_name;
      return typeof tag === 'string' && /^v?\d+(\.\d+)+$/.test(tag) ? tag.replace(/^v/, '') : null;
    },
    readCache() { return JSON.parse(readFileSync(cachePath, 'utf8')); },
    writeCache(data) {
      mkdirSync(home, { recursive: true });
      writeFileSync(cachePath, JSON.stringify(data) + '\n');
    },
    fs: {
      kind(path) { try { const st = lstatSync(path); return st.isSymbolicLink() ? 'symlink' : st.isFile() ? 'file' : 'other'; } catch (_) { return 'other'; } },
      isWritable(dir) { try { accessSync(dir, constants.W_OK); return true; } catch (_) { return false; } },
      async download(url, dest) {
        const response = await fetch(url, { signal: AbortSignal.timeout(110000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
      },
      chmod: chmodSync,
      rename: renameSync,
      remove: path => rmSync(path, { force: true }),
    },
  };
}
