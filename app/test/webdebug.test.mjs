import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebDebug } from '../src/webdebug.js';

const cap = (platform, available = true) => ({ getPlatform: () => platform, isPluginAvailable: n => available && n === 'BrxDebug' });
class FakePlugin {
  constructor(on) { this.on = on; this.sets = []; }
  async get() { return { enabled: this.on }; }
  async set({ enabled }) { this.sets.push(enabled); this.on = enabled; return { enabled }; }
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

test('B21: no switch on iOS, in the browser, or before the value is read', async () => {
  for (const c of [cap('ios'), cap('web'), cap('android', false)]) {
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

test('B21: the native default is ON and the plugin is a declared dependency', () => {
  const java = readFileSync(new URL('../plugins/brx-debug/android/src/main/java/com/openbrx/debug/BrxDebugPlugin.java', import.meta.url), 'utf8');
  assert.match(java, /static final boolean DEFAULT_ON = true;/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies['brx-debug'], 'file:plugins/brx-debug', 'cap sync installs only a declared plugin');
});
