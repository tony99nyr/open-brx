import test from 'node:test';
import assert from 'node:assert/strict';
import { NetSocket, makeWsFactory } from '../src/transport/netsocket.js';
import { isLanWsUrl } from '../plugins/brx-net/src/index.js';

class FakePlugin {
  constructor() { this.events = new Map(); this.opened = []; this.sent = []; this.closed = []; }
  async addListener(name, callback) {
    const listeners = this.events.get(name) || new Set();
    listeners.add(callback);
    this.events.set(name, listeners);
    return { remove: async () => { listeners.delete(callback); } };
  }
  emit(name, event) { for (const callback of this.events.get(name) || []) callback(event); }
  async open({ url }) {
    const id = String(this.opened.length + 1);
    this.opened.push({ id, url });
    this.emit('open', { id }); // Deliberately before the Promise supplies the id.
    return { id, network: 'wifi' };
  }
  async send(frame) { this.sent.push(frame); }
  async close(frame) { this.closed.push(frame); this.emit('close', { id: frame.id, code: frame.code, reason: frame.reason }); }
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('native events map to one socket and close fires once', async () => {
  const plugin = new FakePlugin();
  const socket = new NetSocket('ws://192.168.1.5/ws', plugin);
  const events = [];
  socket.onopen = () => events.push('open');
  socket.onmessage = event => events.push(event.data);
  socket.onerror = () => events.push('error');
  socket.onclose = event => events.push(`close:${event.code}:${event.reason}`);
  assert.throws(() => socket.send('too early'), { name: 'InvalidStateError' });
  await tick();
  assert.equal(socket.readyState, 1);
  socket.send('hello');
  plugin.emit('message', { id: socket.id, data: 'reply' });
  plugin.emit('error', { id: socket.id, message: 'test failure' });
  socket.close(1000, 'done');
  await tick();
  plugin.emit('close', { id: socket.id, code: 1000, reason: 'duplicate' });
  assert.deepEqual(events, ['open', 'reply', 'error', 'close:1000:done']);
  assert.deepEqual(plugin.sent, [{ id: socket.id, data: 'hello' }]);
  assert.equal(socket.readyState, 3);
});

test('simultaneous sockets never receive each other’s events', async () => {
  const plugin = new FakePlugin();
  const first = new NetSocket('ws://192.168.1.5/ws', plugin);
  const second = new NetSocket('wss://test.trycloudflare.com/ws', plugin);
  const seen = [[], []];
  first.onopen = () => seen[0].push('open');
  second.onopen = () => seen[1].push('open');
  first.onmessage = event => seen[0].push(event.data);
  second.onmessage = event => seen[1].push(event.data);
  first.onerror = () => seen[0].push('error');
  second.onerror = () => seen[1].push('error');
  first.onclose = () => seen[0].push('close');
  second.onclose = () => seen[1].push('close');
  await tick();
  plugin.emit('message', { id: first.id, data: 'LAN' });
  plugin.emit('error', { id: second.id });
  plugin.emit('close', { id: first.id, code: 1000, reason: '' });
  plugin.emit('message', { id: second.id, data: 'tunnel' });
  assert.deepEqual(seen, [['open', 'LAN', 'close'], ['open', 'error', 'tunnel']]);
  second.close();
});

test('non-Android factory calls the browser WebSocket constructor', () => {
  const calls = [];
  class BrowserSocket { constructor(url) { calls.push(url); } }
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = BrowserSocket;
  try {
    const factory = makeWsFactory({ capacitor: { getPlatform: () => 'ios', isPluginAvailable: () => true }, plugin: new FakePlugin() });
    assert.ok(factory('wss://example.com/ws') instanceof BrowserSocket);
    assert.deepEqual(calls, ['wss://example.com/ws']);
  } finally { globalThis.WebSocket = previous; }
});

test('LAN URL classification matches private, link-local and .local hosts', () => {
  for (const host of ['192.168.1.5', '10.4.5.6', '172.16.0.1', '172.31.255.254',
    '169.254.1.2', 'mc.local', '[fd00::1]', '[fe80::1]']) {
    assert.equal(isLanWsUrl(`ws://${host}/ws`), true, host);
  }
  for (const host of ['172.15.0.1', '172.32.0.1', 'test.trycloudflare.com', '8.8.8.8']) {
    assert.equal(isLanWsUrl(`wss://${host}/ws`), false, host);
  }
});

test('an open() the native side rejects ends in one error and one 1006 close, with no listener left', async () => {
  const plugin = new FakePlugin();
  plugin.open = async () => { throw new Error('no route'); };
  const socket = new NetSocket('ws://192.168.1.5/ws', plugin);
  const events = [];
  socket.onerror = () => events.push('error');
  socket.onclose = event => events.push(`close:${event.code}`);
  await tick(); await tick();
  assert.deepEqual(events, ['error', 'close:1006']);
  assert.equal([...plugin.events.values()].reduce((n, set) => n + set.size, 0), 0, 'every listener removed');
});

test('a socket closed before it dialled never asks native to open', async () => {
  const plugin = new FakePlugin();
  const socket = new NetSocket('ws://192.168.1.5/ws', plugin);
  const events = [];
  socket.onclose = event => events.push(`close:${event.code}`);
  socket.close(1000, '');
  await tick(); await tick();
  assert.equal(plugin.opened.length, 0);
  assert.deepEqual(events, ['close:1000']);
});

test('bufferedAmount follows the queue size native reports, for the log upload backpressure', async () => {
  const plugin = new FakePlugin();
  plugin.send = async frame => { plugin.sent.push(frame); return { queued: 42 }; };
  const socket = new NetSocket('ws://192.168.1.5/ws', plugin);
  await tick();
  socket.send('abcdef');
  assert.equal(socket.bufferedAmount, 6, 'counted at once, before native answers');
  await tick();
  assert.equal(socket.bufferedAmount, 42);
});

test('bufferedAmount keeps asking native while bytes are queued, so a drain sees it empty', async ctx => {
  ctx.mock.timers.enable({ apis: ['setTimeout'] });
  const plugin = new FakePlugin();
  let left = 3;
  plugin.send = async frame => { plugin.sent.push(frame); return { queued: 30 }; };
  plugin.queued = async () => ({ queued: --left > 0 ? 10 : 0 });
  const socket = new NetSocket('ws://192.168.1.5/ws', plugin);
  await tick();
  socket.send('x');
  await tick();
  assert.equal(socket.bufferedAmount, 30);
  for (let i = 0; i < 3; i++) { ctx.mock.timers.tick(100); await tick(); await tick(); }
  assert.equal(socket.bufferedAmount, 0, 'polled down to empty without another send');
  socket.close();
});

test('a late queue-size answer never overwrites a newer one', async () => {
  const plugin = new FakePlugin();
  const socket = new NetSocket('ws://192.168.1.5/ws', plugin);
  await tick();
  socket.noteQueued({ queued: 5 }, 2);
  socket.noteQueued({ queued: 900 }, 1);   // the first send's answer arrives after the second's
  assert.equal(socket.bufferedAmount, 5);
  socket.close();
});
