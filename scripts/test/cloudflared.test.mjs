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
function make({ platform = 'darwin', arch = 'x64', version = '2026.9.0', latest = '2026.10.3', tools = ['cloudflared', 'brew', 'winget'], owned = true, upgrade = {}, cache = null, writable = false } = {}) {
  const state = { version, calls: [], fetches: 0, cache, clock: 1_000_000, files: [], downloads: [] };
  const deps = {
    platform, arch, fs: {
      isWritable: () => writable,
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
const upgrades = state => state.calls.filter(call => call[0] !== 'cloudflared' && call[1] !== 'list');
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
  assert.match(text(result), /could not update cloudflared 2026.10.2 to 2026.10.3: it took too long/);
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
  await assert.rejects(replaceBinary({ url: 'u', binPath: '/b/cloudflared' }, deps), /HTTP 404/);
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
  ['win32', 'winget', ['list', '-e', '--id', 'Cloudflare.cloudflared'], 'winget upgrade -e --id Cloudflare.cloudflared'],
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
