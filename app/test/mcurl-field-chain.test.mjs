// F659: the 2026-11-01 field chain. A typed `:8765/ws?s=` URL stuck the phone offline and looped back to :8765.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mcDialTarget } from '../src/mcurl.js';
import { sweepPlan, probeWs, probeWsOpen } from '../src/transport/discover.js';
import { discoveredUrl, HUD_POLICY } from '../src/transport/mclink.js';

test('connectMc: a ?s= secret is split into the join and the dial goes to /ws', () => {
  const t = mcDialTarget('ws://192.0.2.55:8766/ws?s=abc', {});
  assert.equal(t.url, 'ws://192.0.2.55:8766/ws');
  assert.equal(t.join.secret, 'abc');
  const c = mcDialTarget('ws://192.0.2.55:8765/ws?s=abc&pub=wss://x.trycloudflare.com/ws', { user: true });
  assert.equal(c.url, 'ws://192.0.2.55:8766/ws');
  assert.deepEqual([c.join.secret, c.join.pub, c.join.user], ['abc', 'wss://x.trycloudflare.com/ws', true]);
  const e = mcDialTarget('ws://192.0.2.55:8766/ws?s=old', { secret: 'new' });
  assert.equal(e.join.secret, 'new', 'a secret the caller passed wins');
  assert.equal(mcDialTarget('ws://h:8766/ws', {}).join.secret, undefined, 'no secret is invented (the transport keeps its own)');
  assert.equal(mcDialTarget('garbage', {}), null);
});

test('app.js routes every MC url through the normaliser', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const body = /function connectMc\([^)]*\) \{([\s\S]*?)\n\}/.exec(src)[1];
  assert.match(body, /mcDialTarget\(/, 'connectMc normalises before it dials, so window.brx.connectMc is covered too');
  assert.match(src, /remember: \(url, bound\) => \{[^}]*normaliseMcUrl|remember: \(url[^)]*\) => \{[^}]*normaliseMcUrl/, 'the stored url is normalised');
});

test('a stale :8765 join url never reaches the sweep port list', () => {
  for (const joinUrl of ['ws://192.0.2.55:8765/ws', 'ws://192.0.2.55:8765/ws?s=abc', 'http://192.0.2.55:8765/']) {
    assert.deepEqual(sweepPlan({ localIp: '192.168.0.9', joinUrl }).ports, [8766], joinUrl);
  }
  assert.deepEqual(sweepPlan({ joinUrl: 'ws://192.0.2.55:9000/ws' }).ports, [9000, 8766], 'a real node port still leads');
});

test('mDNS results go through the normaliser to a /ws node url', () => {
  const svc = (port, txt) => ({ action: 'resolved', service: { ipv4Addresses: ['192.0.2.55'], port, txtRecord: txt } });
  assert.equal(discoveredUrl(svc(8765, { ws_path: '/ws' })), 'ws://192.0.2.55:8766/ws');
  assert.equal(discoveredUrl(svc(8766, { ws_path: '/other' })), 'ws://192.0.2.55:8766/ws');
});

function fakeSocket(onDial) {
  return url => {
    const w = { onopen: null, onclose: null, onerror: null, onmessage: null, close() {} };
    setTimeout(() => onDial(w, url), 0);
    return w;
  };
}

test('a probe socket that opens and closes 4404 is not a hit', async () => {
  const wsFactory = fakeSocket(w => { w.onopen && w.onopen(); setTimeout(() => w.onclose && w.onclose({ code: 4404 }), 5); });
  assert.equal(await probeWs('ws://192.0.2.55:8765/ws', { wsFactory }), 'closed');
  assert.equal(await probeWsOpen('ws://192.0.2.55:8765/ws', { wsFactory }), false);
});

test('a probe socket that opens and stays open is a hit', async () => {
  const wsFactory = fakeSocket(w => { w.onopen && w.onopen(); });
  assert.equal(await probeWs('ws://192.0.2.55:8766/ws', { wsFactory }), 'open');
});

test('a failed dial leaves the stored address alone; only a user-named one is stored at dial', () => {
  assert.equal(HUD_POLICY.rememberAtDial({ remember: true }), false, 'window.brx.connectMc, boot and reconnect store nothing at dial');
  assert.equal(HUD_POLICY.rememberAtDial({ remember: true, user: false }), false);
  assert.equal(HUD_POLICY.rememberAtDial({ remember: true, user: true }), true, 'a typed or scanned address survives a reload before its first welcome');
  assert.equal(HUD_POLICY.rememberAtDial({ remember: false, user: true }), false);
  assert.equal(HUD_POLICY.rememberAtBound({}), true);
});

test('a probe that opens at 650 ms of a 700 ms bound still counts as open', async () => {
  let now = 0, seq = 0; const q = [];
  const timers = { setTimeout(fn, ms) { const id = ++seq; q.push({ id, at: now + ms, fn }); return id; },
    clearTimeout(id) { const i = q.findIndex(t => t.id === id); if (i >= 0) q.splice(i, 1); } };
  const advance = to => { for (;;) { q.sort((a, b) => a.at - b.at); if (!q.length || q[0].at > to) break; const t = q.shift(); now = t.at; t.fn(); } now = to; };
  const ws = { onopen: null, onclose: null, onerror: null, onmessage: null, close() {} };
  const p = probeWs('ws://192.0.2.55:8766/ws', { wsFactory: () => ws, timers, timeoutMs: 700 });
  advance(650); ws.onopen();
  advance(700);                       // the bound fires while the open is still inside its grace
  assert.equal(await p, 'open');
});
