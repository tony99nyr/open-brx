// Keeping cloudflared at Cloudflare's minimum version: every outside effect is faked, nothing touches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, ensureCloudflared, latestRelease, minVersionFromText, parseCloudflaredVersion, replaceBinary, upgradePlan } from '../lib/cloudflared.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIN = '2026.10.2';
const out = v => `cloudflared version ${v} (built 2026-10-20-1200 UTC)\n`;

/** Fake dependencies. `state.version` is what `cloudflared --version` prints; an upgrade command can change it. */
function make({ platform = 'darwin', arch = 'x64', version = '2026.9.0', latest = '2026.10.3', tools = ['cloudflared', 'brew', 'winget', 'dpkg'], owned = true, upgrade = {}, cache = null, writable = false, kind = 'file', dpkgOwns = false } = {}) {
  const state = { version, calls: [], fetches: 0, cache, clock: 1_000_000, files: [], downloads: [] };
  const deps = {
    platform, arch, fs: {
      isWritable: () => writable,
      kind: () => kind,
      download: async (url, dest) => { state.downloads.push([url, dest]); if (upgrade.downloadFails) throw new Error('HTTP 404'); state.files.push(dest); },
      chmod: (path, mode) => state.calls.push(['chmod', path, mode]),
      rename: (from, to) => { state.calls.push(['rename', from, to]); state.version = upgrade.to ?? state.version; },
      remove: path => state.calls.push(['remove', path]),
    },
    which: name => (tools.includes(name) ? `/usr/local/bin/${name}` : null),
    now: () => state.clock,
    readCache: () => { if (!state.cache) throw new Error('none'); return state.cache; },
    writeCache: data => { state.cache = data; },
    fetchLatest: async () => { state.fetches++; if (latest === 'throw') throw new Error('offline'); return latest; },
    run(cmd, args) {
      state.calls.push([cmd, ...args]);
      if (cmd === 'cloudflared') return { status: 0, stdout: out(state.version), stderr: '' };
      if (cmd === 'dpkg') return { status: dpkgOwns ? 0 : 1, stdout: '', stderr: '' };
      if (cmd.endsWith('.download')) return { status: 0, stdout: upgrade.downloadOutput ?? out(upgrade.to ?? state.version), stderr: '' };
      if (args[0] === 'list') {
        if (owned === 'timeout') return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }) };
        return owned ? { status: 0, stdout: cmd === 'brew' ? 'cloudflared 2026.9.0\n' : 'Cloudflare.cloudflared\n', stderr: '' } : { status: 1, stdout: '', stderr: '' };
      }
      if (upgrade.error) return { status: null, stdout: '', stderr: '', error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }) };
      if (upgrade.status) return { status: upgrade.status, stdout: '', stderr: '' };
      state.version = upgrade.to ?? state.version;
      return { status: 0, stdout: '', stderr: '' };
    },
  };
  return { deps, state };
}
const upgrades = state => state.calls.filter(call => !['cloudflared', 'dpkg'].includes(call[0]) && call[1] !== 'list' && !call[0].endsWith('.download'));
const text = result => result.lines.map(line => `${line.level}: ${line.text}`).join('\n');

test('parseCloudflaredVersion reads real output and rejects garbage', () => {
  assert.equal(parseCloudflaredVersion('cloudflared version 2026.10.2 (built 2026-10-20-1200 UTC)'), '2026.10.2');
  assert.equal(parseCloudflaredVersion('cloudflared version 2024.6.1 (built 2024-06-20-1200 UTC)\n'), '2024.6.1');
  assert.equal(parseCloudflaredVersion('command not found'), null);
  assert.equal(parseCloudflaredVersion(''), null);
  assert.equal(parseCloudflaredVersion(undefined), null);
});

test('compareVersions compares dotted numbers, not text', () => {
  assert.equal(compareVersions('2026.10.2', '2026.10.2'), 0);
  assert.equal(compareVersions('2026.9.0', '2026.10.2'), -1);
  assert.equal(compareVersions('2026.10.10', '2026.10.9'), 1);
  assert.equal(compareVersions('2026.10', '2026.10.0'), 0);
  assert.equal(compareVersions('2027.1.0', '2026.12.9'), 1);
});

test('the minimum parsed from the real tunnel.py is 2026.10.2', () => {
  const tunnel = readFileSync(join(here, '..', '..', 'mcp', 'brx_mcp', 'mc', 'tunnel.py'), 'utf8');
  assert.equal(minVersionFromText(tunnel), '2026.10.2');
  assert.equal(minVersionFromText('nothing here'), null);
  assert.equal(minVersionFromText(undefined), null);
});

test('older than latest on a Mac: brew upgrade runs and the new version is reported', async () => {
  const { deps, state } = make({ upgrade: { to: '2026.10.3' } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(upgrades(state), [['brew', 'upgrade', 'cloudflared']]);
  assert.equal(result.upgraded, true);
  assert.equal(result.installed, '2026.10.3');
  assert.equal(result.belowMin, false);
  assert.match(text(result), /ok: updated cloudflared from 2026.9.0 to 2026.10.3/);
});

test('older than latest on Windows: winget upgrade runs', async () => {
  const { deps, state } = make({ platform: 'win32', upgrade: { to: '2026.10.3' } });
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(upgrades(state), [['winget', 'upgrade', '-e', '--id', 'Cloudflare.cloudflared', '--accept-source-agreements', '--accept-package-agreements']]);
});

test('equal to latest: no upgrade and no package manager call', async () => {
  const { deps, state } = make({ version: '2026.10.3' });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(upgrades(state), []);
  assert.equal(result.upgraded, false);
  assert.match(text(result), /up to date/);
});

test('installed newer than latest: no upgrade', async () => {
  const { deps, state } = make({ version: '2026.11.0' });
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(upgrades(state), []);
});

test('missing: the caller keeps its install offer and nothing runs', async () => {
  const { deps, state } = make({ tools: ['brew'] });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(result.missing, true);
  assert.deepEqual(state.calls, []);
  assert.equal(state.fetches, 0);
});

test('a failed upgrade gives one clear line and does not throw', async () => {
  const { deps } = make({ version: '2026.10.2', upgrade: { status: 1 } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(result.upgraded, false);
  assert.equal(result.belowMin, false);
  const notes = result.lines.filter(line => line.level === 'note' && /could not update/.test(line.text));
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /exited with code 1/);
  assert.ok(!result.lines.some(line => line.level === 'loud'));
});

test('an upgrade that times out gives a clear line and does not throw', async () => {
  const { deps } = make({ version: '2026.10.2', upgrade: { error: true } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.match(text(result), /the cloudflared update took too long and was stopped. Run `brew upgrade cloudflared` yourself/);
  assert.ok(!/brew link/.test(text(result)));
  assert.ok(!/could not update|To update by hand/.test(text(result)));
});

test('below the minimum after a failed upgrade: a loud message with the exact command', async () => {
  const { deps } = make({ version: '2026.9.0', upgrade: { status: 1 } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(result.belowMin, true);
  const loud = result.lines.filter(line => line.level === 'loud').map(line => line.text).join('\n');
  assert.match(loud, /2026.9.0 is older than 2026.10.2/);
  assert.match(loud, /tunnel may stop working/);
  assert.match(loud, /Run: brew upgrade cloudflared/);
});

test('below the minimum on Windows names the winget command', async () => {
  const { deps } = make({ platform: 'win32', version: '2026.9.0', upgrade: { status: 1 } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.match(text(result), /loud: Run: winget upgrade -e --id Cloudflare.cloudflared/);
});

test('no network: the cached latest is used', async () => {
  const { deps, state } = make({ latest: 'throw', upgrade: { to: '2026.10.3' }, cache: { checked_at: 1_000_000 - 3 * 86400_000, latest: '2026.10.3' } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(state.fetches, 1);
  assert.equal(result.latest, '2026.10.3');
  assert.equal(result.upgraded, true);
});

test('no network and no cache: no upgrade, but below-minimum is still reported', async () => {
  const { deps, state } = make({ latest: 'throw', version: '2026.9.0' });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(upgrades(state), []);
  assert.equal(result.latest, null);
  assert.equal(result.belowMin, true);
  assert.match(text(result), /loud: Run: brew upgrade cloudflared/);
});

test('--no-update: no fetch and no upgrade, but below-minimum is reported', async () => {
  const { deps, state } = make({ version: '2026.9.0' });
  const result = await ensureCloudflared(deps, { minVersion: MIN, noUpdate: true });
  assert.equal(state.fetches, 0);
  assert.deepEqual(upgrades(state), []);
  assert.equal(result.belowMin, true);
});

test('an unreadable version does not throw and does not upgrade', async () => {
  const { deps, state } = make();
  state.version = 'garbage';
  deps.run = () => ({ status: 0, stdout: 'garbage', stderr: '' });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(result.installed, null);
  assert.equal(result.belowMin, false);
});

test('a dependency that throws is caught', async () => {
  const { deps } = make();
  deps.which = () => { throw new Error('boom'); };
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.match(text(result), /could not check cloudflared \(boom\)/);
});

test('the daily cache: no fetch within 24 h, a fetch after 24 h', async () => {
  const { deps, state } = make();
  assert.equal(await latestRelease(deps), '2026.10.3');
  assert.equal(state.fetches, 1);
  assert.deepEqual(state.cache, { checked_at: 1_000_000, latest: '2026.10.3' });
  state.clock += 23 * 3600_000;
  assert.equal(await latestRelease(deps), '2026.10.3');
  assert.equal(state.fetches, 1);
  state.clock += 2 * 3600_000;
  assert.equal(await latestRelease(deps), '2026.10.3');
  assert.equal(state.fetches, 2);
});

test('Linux with a writable folder: download, chmod 755, rename over the old binary', async () => {
  const { deps, state } = make({ platform: 'linux', arch: 'x64', writable: true, upgrade: { to: '2026.10.3' } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(state.downloads, [['https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-linux-amd64', '/usr/local/bin/cloudflared.download']]);
  assert.deepEqual(state.calls.filter(call => ['chmod', 'rename'].includes(call[0])), [
    ['chmod', '/usr/local/bin/cloudflared.download', 0o755],
    ['rename', '/usr/local/bin/cloudflared.download', '/usr/local/bin/cloudflared'],
  ]);
  assert.equal(result.upgraded, true);
});

test('Linux arm64 downloads the arm64 binary', () => {
  const plan = upgradePlan({ platform: 'linux', brew: null, winget: null, binPath: '/home/a/bin/cloudflared', arch: 'arm64', latest: '2026.10.3', writable: true });
  assert.match(plan.url, /cloudflared-linux-arm64$/);
});

test('a failed download removes the temp file and the old binary stays', async () => {
  const { deps, state } = make({ platform: 'linux', writable: true, upgrade: { downloadFails: true } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(state.calls.filter(call => call[0] === 'remove'), [['remove', '/usr/local/bin/cloudflared.download']]);
  assert.ok(!state.calls.some(call => call[0] === 'rename'));
  assert.match(text(result), /the download failed \(HTTP 404\)/);
});

test('replaceBinary rethrows after cleaning up', async () => {
  const { deps } = make({ upgrade: { downloadFails: true } });
  await assert.rejects(replaceBinary({ url: 'u', binPath: '/b/cloudflared' }, deps, '2026.9.0'), /HTTP 404/);
});

test('Linux without write access: no sudo, a manual dpkg instruction', async () => {
  const { deps, state } = make({ platform: 'linux', arch: 'x64', writable: false, version: '2026.9.0' });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(state.downloads, []);
  assert.deepEqual(upgrades(state), []);
  const loud = result.lines.filter(line => line.level === 'loud').map(line => line.text).join('\n');
  assert.match(loud, /curl -fLO https:\/\/github.com\/cloudflare\/cloudflared\/releases\/download\/2026.10.3\/cloudflared-linux-amd64.deb && sudo dpkg -i cloudflared-linux-amd64.deb/);
});

test('no package manager: a manual instruction pointing at the downloads page', () => {
  const plan = upgradePlan({ platform: 'darwin', brew: null, winget: null, binPath: '/x', arch: 'arm64', latest: '2026.10.3', writable: false });
  assert.equal(plan.kind, 'manual');
  assert.match(plan.text, /developers\.cloudflare\.com\/cloudflare-one\/connections\/connect-networks\/downloads\//);
});

for (const [platform, manager, listArgs, upgradeCmd] of [
  ['darwin', 'brew', ['list', '--versions', 'cloudflared'], 'brew upgrade cloudflared'],
  ['win32', 'winget', ['list', '-e', '--id', 'Cloudflare.cloudflared', '--accept-source-agreements', '--disable-interactivity'], 'winget upgrade -e --id Cloudflare.cloudflared'],
]) {
  test(`${manager} owns cloudflared: the ownership check is bounded and the upgrade runs`, async () => {
    const { deps, state } = make({ platform, upgrade: { to: '2026.10.3' } });
    const timeouts = [];
    const run = deps.run;
    deps.run = (cmd, args, opts) => { if (args[0] === 'list') timeouts.push(opts.timeout); return run(cmd, args, opts); };
    const result = await ensureCloudflared(deps, { minVersion: MIN });
    assert.deepEqual(state.calls.find(call => call[1] === 'list'), [manager, ...listArgs]);
    assert.deepEqual(timeouts, [30000]);
    assert.equal(result.upgraded, true);
    assert.ok(upgrades(state)[0].join(' ').startsWith(upgradeCmd.split(' -e')[0]));
  });

  test(`${manager} does not own cloudflared: nothing runs, the manual line names the page and the binary`, async () => {
    const { deps, state } = make({ platform, owned: false, version: '2026.9.0' });
    const result = await ensureCloudflared(deps, { minVersion: MIN });
    assert.deepEqual(upgrades(state), []);
    assert.equal(result.upgraded, false);
    assert.match(text(result), /loud: Download the newest cloudflared from https:\/\/developers\.cloudflare\.com\/.* and replace \/usr\/local\/bin\/cloudflared/);
    assert.ok(!text(result).includes(upgradeCmd));
  });

  test(`${manager} ownership check times out: nothing runs and the start continues`, async () => {
    const { deps, state } = make({ platform, owned: 'timeout', version: '2026.10.2' });
    const result = await ensureCloudflared(deps, { minVersion: MIN });
    assert.deepEqual(upgrades(state), []);
    assert.equal(result.belowMin, false);
    assert.match(text(result), /note: could not update cloudflared 2026.10.2 to 2026.10.3/);
    assert.match(text(result), /note: Download the newest cloudflared from/);
  });
}

test('an up-to-date start runs no ownership check', async () => {
  const { deps, state } = make({ version: '2026.10.3' });
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.ok(!state.calls.some(call => call[1] === 'list'));
});

test('a failed check is remembered: no fetch within 1 h, a fetch after 1 h, the cached version kept', async () => {
  const { deps, state } = make({ latest: 'throw', cache: { checked_at: 1_000_000 - 3 * 86400_000, latest: '2026.10.1' } });
  assert.equal(await latestRelease(deps), '2026.10.1');
  assert.equal(state.fetches, 1);
  assert.deepEqual(state.cache, { checked_at: 1_000_000, latest: '2026.10.1', failed: true });
  state.clock += 50 * 60_000;
  assert.equal(await latestRelease(deps), '2026.10.1');
  assert.equal(state.fetches, 1);
  state.clock += 20 * 60_000;
  assert.equal(await latestRelease(deps), '2026.10.1');
  assert.equal(state.fetches, 2);
});

test('a failed check with no cache is remembered too', async () => {
  const { deps, state } = make({ latest: 'throw' });
  assert.equal(await latestRelease(deps), null);
  assert.equal(await latestRelease(deps), null);
  assert.equal(state.fetches, 1);
  assert.deepEqual(state.cache, { checked_at: 1_000_000, latest: null, failed: true });
});

test('a brew upgrade that exits 0 with no change is a calm note, and the next start inside 24 h runs nothing', async () => {
  const { deps, state } = make({ version: '2026.10.2' });
  const first = await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(upgrades(state).length, 1);
  assert.match(text(first), /note: brew has no newer build yet/);
  assert.ok(!/could not update|To update by hand/.test(text(first)));
  assert.equal(state.cache.attempted, '2026.10.3');
  state.clock += 3600_000;
  state.calls.length = 0;
  const second = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(upgrades(state), []);
  assert.match(text(second), /Not trying again for a day/);
  state.clock += 24 * 3600_000;
  state.calls.length = 0;
  state.cache.checked_at = state.clock;
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(upgrades(state).length, 1);
});

test('winget says there is no applicable update: a calm note', async () => {
  const { deps } = make({ platform: 'win32', version: '2026.10.2', upgrade: { status: 0x8A15002B } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.match(text(result), /note: winget has no newer build yet/);
});

test('below the minimum while brew lags: the loud line points at the download, not at brew', async () => {
  const { deps } = make({ version: '2026.9.0' });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.match(text(result), /loud: Wait for brew to publish it, or download it from/);
  assert.ok(!/loud: Run: brew/.test(text(result)));
});

test('brew keeps its own refresh, so it can see a new formula, and hides env hints', async () => {
  const { deps } = make({ upgrade: { to: '2026.10.3' } });
  let seen = null;
  const run = deps.run;
  deps.run = (cmd, args, opts) => { if (cmd === 'brew' && args[0] === 'upgrade') seen = opts; return run(cmd, args, opts); };
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(seen.env, { HOMEBREW_NO_ENV_HINTS: '1' });
  assert.equal(seen.timeout, 300000);
});

test('an upgrade stopped by a signal gets the winget line on Windows and no generic line', async () => {
  const { deps } = make({ platform: 'win32', version: '2026.10.2' });
  const run = deps.run;
  deps.run = (cmd, args, opts) => (cmd === 'winget' && args[0] === 'upgrade' ? { status: null, signal: 'SIGTERM', stdout: '', stderr: '' } : run(cmd, args, opts));
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.match(text(result), /Run the winget upgrade again: winget upgrade -e --id Cloudflare.cloudflared/);
  assert.ok(!/could not update/.test(text(result)));
});

test('a garbage download keeps the old binary and says so once', async () => {
  const { deps, state } = make({ platform: 'linux', writable: true, upgrade: { downloadOutput: '<html>Not Found</html>' } });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.ok(!state.calls.some(call => call[0] === 'rename'));
  assert.deepEqual(state.calls.filter(call => call[0] === 'remove'), [['remove', '/usr/local/bin/cloudflared.download']]);
  assert.match(text(result), /the file did not run as a newer cloudflared/);
});

test('a download that is not newer than the installed version is not swapped in', async () => {
  const { deps, state } = make({ platform: 'linux', writable: true, upgrade: { to: '2026.9.0' } });
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.ok(!state.calls.some(call => call[0] === 'rename'));
});

test('a symlinked Linux binary gets the manual line and no download', async () => {
  const { deps, state } = make({ platform: 'linux', writable: true, kind: 'symlink' });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(state.downloads, []);
  assert.match(text(result), /On Debian or Ubuntu, run: curl/);
});

test('a dpkg-owned Linux binary gets the manual line and no download', async () => {
  const { deps, state } = make({ platform: 'linux', writable: true, dpkgOwns: true });
  const result = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(state.downloads, []);
  assert.ok(state.calls.some(call => call[0] === 'dpkg' && call[1] === '-S'));
  assert.match(text(result), /On other distributions, download it from https:\/\/developers\.cloudflare\.com/);
});

test('a cache with a bad latest counts as no cache', async () => {
  const { deps, state } = make({ cache: { checked_at: 1_000_000, latest: 'banana' } });
  assert.equal(await latestRelease(deps), '2026.10.3');
  assert.equal(state.fetches, 1);
});

test('a checked_at in the future counts as expired but the version is still the fallback', async () => {
  const { deps, state } = make({ latest: 'throw', cache: { checked_at: 1_000_000 + 5 * 86400_000, latest: '2026.10.1' } });
  assert.equal(await latestRelease(deps), '2026.10.1');
  assert.equal(state.fetches, 1);
});

test('an attempted_at in the future does not block an upgrade', async () => {
  const { deps, state } = make({ version: '2026.9.0', upgrade: { to: '2026.10.3' }, cache: { checked_at: 1_000_000, latest: '2026.10.3', attempted: '2026.10.3', attempted_at: 1_000_000 + 86400_000 } });
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(upgrades(state).length, 1);
});

test('a killed upgrade is remembered with its own wording, and does not retry on the next start', async () => {
  const { deps, state } = make({ version: '2026.10.2', upgrade: { error: true } });
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(state.cache.reason, 'stopped');
  state.clock += 3600_000;
  state.calls.length = 0;
  const second = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(upgrades(state), []);
  assert.match(text(second), /the last cloudflared update was stopped after 5 minutes. Trying again tomorrow/);
  assert.ok(!/no newer build/.test(text(second)));
});

test('a lag skip says so in its own words', async () => {
  const { deps, state } = make({ version: '2026.10.2' });
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(state.cache.reason, 'lag');
  state.clock += 3600_000;
  const second = await ensureCloudflared(deps, { minVersion: MIN });
  assert.match(text(second), /brew has no newer build yet \(cloudflared 2026.10.3 is out\). Not trying again for a day/);
  assert.ok(!/stopped/.test(text(second)));
});

test('a failed Linux download is not blamed on the package manager and is retried after an hour', async () => {
  const { deps, state } = make({ platform: 'linux', writable: true, upgrade: { downloadFails: true } });
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(state.cache.reason, 'download');
  state.clock += 1800_000;
  state.downloads.length = 0;
  const soon = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(state.downloads, []);
  assert.match(text(soon), /the last cloudflared download did not work. Trying again in an hour/);
  state.clock += 1800_000;
  await ensureCloudflared(deps, { minVersion: MIN });
  assert.equal(state.downloads.length, 1);
});

test('after a lag skip, a below-minimum start routes to the download text with no brew call', async () => {
  const { deps, state } = make({ version: '2026.9.0' });
  await ensureCloudflared(deps, { minVersion: MIN });
  state.clock += 3600_000;
  state.calls.length = 0;
  const second = await ensureCloudflared(deps, { minVersion: MIN });
  assert.deepEqual(state.calls.filter(call => call[0] === 'brew'), []);
  assert.ok(!/Run: brew upgrade/.test(text(second)));
  assert.match(text(second), /loud: Wait for brew to publish it, or download it from https:\/\/developers\.cloudflare\.com\/.* and put it earlier on PATH/);
  assert.ok(!/replace \/usr\/local\/bin/.test(text(second)));
});
