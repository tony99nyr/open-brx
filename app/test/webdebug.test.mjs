import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebDebug } from '../src/webdebug.js';

// Real Capacitor never has a native plugin bridged on the web platform, whatever a plugin declares.
const cap = (platform, available = true) => ({ getPlatform: () => platform, isPluginAvailable: n => platform !== 'web' && available && n === 'BrxDebug' });
class FakePlugin {
  constructor(on, extra = {}) { this.on = on; this.sets = []; this.extra = extra; }
  async get() { return { enabled: this.on, ...this.extra }; }
  async set({ enabled }) { this.sets.push(enabled); this.on = enabled; return { enabled, ...this.extra }; }
}

test('B21: android reads the stored value and a toggle flips it through the plugin', async () => {
  const plugin = new FakePlugin(true);
  const wd = new WebDebug({ capacitor: cap('android'), plugin });
  assert.equal(wd.state, null);
  assert.equal(await wd.load(), true);
  assert.equal(await wd.toggle(), false);
  assert.equal(await wd.toggle(), true);
  assert.deepEqual(plugin.sets, [false, true]);
});

test('B21: iOS 16.4+ reads the stored value and a toggle flips it through the plugin, same as Android', async () => {
  const plugin = new FakePlugin(true, { supported: true });
  const wd = new WebDebug({ capacitor: cap('ios'), plugin });
  assert.equal(await wd.load(), true);
  assert.equal(await wd.toggle(), false);
  assert.deepEqual(plugin.sets, [false]);
});

test('B21: an iOS build below 16.4 reports the switch unsupported and never writes', async () => {
  const plugin = new FakePlugin(false, { supported: false });
  const wd = new WebDebug({ capacitor: cap('ios'), plugin });
  assert.equal(await wd.load(), 'unsupported');
  assert.equal(await wd.toggle(), 'unsupported');
  assert.deepEqual(plugin.sets, []);
});

test('B21: a native call that throws is reported unsupported, not an error', async () => {
  const plugin = { get: async () => { throw new Error('no such method'); }, set: async () => { throw new Error('no such method'); } };
  const wd = new WebDebug({ capacitor: cap('ios'), plugin });
  assert.equal(await wd.load(), 'unsupported');
  assert.equal(await wd.toggle(), 'unsupported');
});

test('B21: no switch in the browser, with no plugin, or before the value is read', async () => {
  for (const c of [cap('web'), cap('android', false), cap('ios', false)]) {
    const plugin = new FakePlugin(true);
    const wd = new WebDebug({ capacitor: c, plugin });
    assert.equal(await wd.load(), null);
    assert.equal(await wd.toggle(), null);
    assert.deepEqual(plugin.sets, []);
  }
  const plugin = new FakePlugin(true);
  const unread = new WebDebug({ capacitor: cap('android'), plugin });
  assert.equal(await unread.toggle(), null, 'a toggle before load() must not guess the current value');
  assert.deepEqual(plugin.sets, []);
});

test('B21: a second tap while the first is in flight sends one write', async () => {
  const pending = [];
  const plugin = { get: async () => ({ enabled: true }), set() { return new Promise(r => pending.push(() => r({ enabled: false }))); } };
  const wd = new WebDebug({ capacitor: cap('android'), plugin });
  await wd.load();
  const first = wd.toggle(), second = wd.toggle();
  await new Promise(r => setImmediate(r));
  const writes = pending.length;
  pending.forEach(release => release());   // settle every write, so a failed guard fails here instead of hanging
  assert.equal(writes, 1, `${writes} writes for two quick taps`);
  assert.equal(await second, true, 'the second tap reports the value still held');
  assert.equal(await first, false);
});

test('B21: a debuggable APK reports forced ON and the switch writes nothing', async () => {
  const plugin = { sets: [], get: async () => ({ enabled: true, forced: true }), async set(o) { this.sets.push(o.enabled); return { enabled: true, forced: true }; } };
  const wd = new WebDebug({ capacitor: cap('android'), plugin });
  assert.equal(await wd.load(), true);
  assert.equal(wd.forced, true);
  assert.equal(await wd.toggle(), true);
  assert.deepEqual(plugin.sets, []);
});

test('B21: the native default is ON and the plugin is a declared dependency for both platforms', () => {
  const java = readFileSync(new URL('../plugins/brx-debug/android/src/main/java/com/openbrx/debug/BrxDebugPlugin.java', import.meta.url), 'utf8');
  assert.match(java, /static final boolean DEFAULT_ON = true;/);
  const swift = readFileSync(new URL('../plugins/brx-debug/ios/Sources/BrxDebugPlugin/BrxDebugPlugin.swift', import.meta.url), 'utf8');
  assert.match(swift, /defaultOn = true/);
  assert.match(swift, /iOS 16\.4/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['brx-debug'], 'file:plugins/brx-debug', 'cap sync installs only a declared plugin');
  const pluginPkg = JSON.parse(readFileSync(new URL('../plugins/brx-debug/package.json', import.meta.url), 'utf8'));
  assert.equal(pluginPkg.capacitor.ios.src, 'ios', 'cap sync needs the iOS src declared to add the SPM plugin');
});
