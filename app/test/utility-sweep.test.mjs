// Bench 2026-09-24 (app 0.4.10, Pixel 5): the utility screen's own search never found Mission Control.
// MC ran in WSL behind a Windows portproxy, so its mDNS never reached the LAN, and the utility search was
// mDNS-only. The player screen's LAN sweep on the same Wi-Fi found it at 192.168.0.55:8766.
// Also: the utility typed-address buttons dialled the raw text, so a pasted console address
// (http://<host>:8765/) became the remembered MC url.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startUtilitySweep, resolveTypedMc, UTILITY_SWEEP_FIRST_MS, UTILITY_SWEEP_EVERY_MS } from '../src/transport/utility-join.js';
import { MC_WS_PORT } from '../src/transport/discover.js';

const MC = `ws://192.168.0.55:${MC_WS_PORT}/ws`;

/** Manual clock: nothing fires until `advance` says so. */
function fakeTimers() {
  let now = 0, seq = 0;
  /** @type {Map<number, {at:number, fn:Function}>} */ const due = new Map();
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
  return {
    setTimeout(fn, ms) { const id = ++seq; due.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { due.delete(id); },
    get pending() { return due.size; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        due.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end; await flush();
    },
  };
}

/** A fake LAN: `live` urls complete the upgrade; every other address refuses at once. Records each dial. */
function fakeLan(live = []) {
  const dialled = [];
  /** @type {null | ((url:string) => void)} */ let onDial = null;
  const wsFactory = url => {
    dialled.push(url);
    const ws = { onopen: null, onclose: null, onerror: null, onmessage: null, close() {} };
    queueMicrotask(() => {
      if (onDial) onDial(url);
      if (live.includes(url)) ws.onopen && ws.onopen(); else ws.onclose && ws.onclose();
    });
    return ws;
  };
  return { wsFactory, dialled, set onDial(f) { onDial = f; } };
}

// Small subnets keep a sweep to a few dozen fake dials; the real code sweeps 254 hosts.
const SMALL = { hosts: 60, pacingMs: 0, pool: 8 };

function harness({ live = [MC], operator = false } = {}) {
  const timers = fakeTimers(); const lan = fakeLan(live);
  const state = { bound: false, operator, connects: [], logs: [] };
  const sweeper = startUtilitySweep({
    isBound: () => state.bound, operatorUrl: () => state.operator,
    connect: (url, opts) => state.connects.push({ url, opts }),
    log: m => state.logs.push(m), wsFactory: lan.wsFactory, timers, sweepOptions: SMALL,
  });
  return { timers, lan, state, sweeper };
}

test('no mDNS result: the utility path sweeps after ~4 s and joins the hit with trusted:false', async () => {
  const { timers, lan, state, sweeper } = harness();
  await timers.advance(UTILITY_SWEEP_FIRST_MS - 1);
  assert.equal(lan.dialled.length, 0, 'no sweep before the first delay: mDNS gets its chance');
  await timers.advance(1);
  assert.ok(lan.dialled.length > 0, 'the sweep ran');
  assert.deepEqual(state.connects, [{ url: MC, opts: { trusted: false } }], 'joined the found url, untrusted, like an mDNS hit');
  assert.ok(state.logs.some(l => l.startsWith('sweeping for Mission Control on 192.168.0.x')), 'logs the plan the way app.js does');
  assert.ok(state.logs.some(l => l.includes(`CONNECTING ${MC}`)));
  // The join binds: the next round never starts.
  state.bound = true;
  const before = lan.dialled.length;
  await timers.advance(UTILITY_SWEEP_EVERY_MS * 3);
  assert.equal(lan.dialled.length, before, 'bound: no further sweep');
  assert.equal(sweeper.stopped, true);
  assert.equal(timers.pending, 0, 'no timer left behind');
});

test('still unbound: the sweep repeats every 30 s', async () => {
  const { timers, state, sweeper } = harness({ live: [] });
  await timers.advance(UTILITY_SWEEP_FIRST_MS);
  assert.equal(sweeper.rounds, 1);
  assert.equal(state.connects.length, 0);
  assert.ok(state.logs.includes('sweep found no Mission Control — QR/manual join'));
  await timers.advance(UTILITY_SWEEP_EVERY_MS - 1);
  assert.equal(sweeper.rounds, 1);
  await timers.advance(1);
  assert.equal(sweeper.rounds, 2, 'second round 30 s after the first ended');
  sweeper.stop();
  assert.equal(timers.pending, 0);
});

test('already bound (mDNS won): the sweep never dials', async () => {
  const { timers, lan, state, sweeper } = harness();
  state.bound = true;
  await timers.advance(UTILITY_SWEEP_FIRST_MS + UTILITY_SWEEP_EVERY_MS * 2);
  assert.equal(lan.dialled.length, 0);
  assert.equal(state.connects.length, 0);
  assert.equal(sweeper.stopped, true);
});

test('an operator URL (typed or remembered) means no sweep at all', async () => {
  const { timers, lan, state } = harness({ operator: true });
  await timers.advance(UTILITY_SWEEP_FIRST_MS + UTILITY_SWEEP_EVERY_MS * 2);
  assert.equal(lan.dialled.length, 0);
  assert.equal(state.connects.length, 0);
});

test('bound mid-sweep: the sweep stops at the next batch and does not connect', async () => {
  // MC is only on the LAST subnet, so the sweep has many batches to go when the bind lands.
  const { timers, lan, state, sweeper } = harness({ live: [`ws://172.20.10.5:${MC_WS_PORT}/ws`] });
  lan.onDial = url => { if (url === `ws://192.168.0.20:${MC_WS_PORT}/ws`) state.bound = true; };
  await timers.advance(UTILITY_SWEEP_FIRST_MS);
  assert.ok(lan.dialled.length < 40, `stopped early (dialled ${lan.dialled.length})`);
  assert.ok(!lan.dialled.some(u => u.startsWith('ws://192.168.1.')), 'never reached the next subnet');
  assert.equal(state.connects.length, 0, 'bound elsewhere: the sweep must not replace that link');
  assert.equal(sweeper.stopped, true);
  assert.equal(timers.pending, 0);
});

test('operator types a URL mid-sweep: the sweep stops and does not connect', async () => {
  const { timers, lan, state, sweeper } = harness({ live: [`ws://172.20.10.5:${MC_WS_PORT}/ws`] });
  lan.onDial = url => { if (url === `ws://192.168.0.20:${MC_WS_PORT}/ws`) state.operator = true; };
  await timers.advance(UTILITY_SWEEP_FIRST_MS);
  assert.ok(lan.dialled.length < 40);
  assert.equal(state.connects.length, 0);
  assert.equal(sweeper.stopped, true);
});

test('typed http console address dials the node port, not the console', () => {
  const r = resolveTypedMc('http://192.168.0.55:8765/');
  assert.equal(r.url, `ws://192.168.0.55:${MC_WS_PORT}/ws`);
  assert.equal(r.join, false, 'no pub/secret to replace');
  assert.equal(r.note, `that is the console address; connecting to the default node port ws://192.168.0.55:${MC_WS_PORT}/ws`);
  assert.equal(resolveTypedMc('HTTP://mc.local').url, `ws://mc.local:${MC_WS_PORT}/ws`);
});

test('typed ws join code still parses into url + pub + secret', () => {
  const r = resolveTypedMc(`  ws://192.168.0.55:8766/ws?s=abc123&pub=wss://x.trycloudflare.com/ws  `);
  assert.deepEqual(r, { url: 'ws://192.168.0.55:8766/ws', join: true, pub: 'wss://x.trycloudflare.com/ws', secret: 'abc123', note: null });
  // the console join LINK (http with ?ws=) is a join code, not a console address
  const link = resolveTypedMc(`http://192.168.0.55:8765/join?ws=${encodeURIComponent('ws://192.168.0.55:8766/ws?s=k')}`);
  assert.equal(link.url, 'ws://192.168.0.55:8766/ws');
  assert.equal(link.secret, 'k');
  assert.equal(link.note, null);
  assert.equal(resolveTypedMc('   '), null);
  assert.equal(resolveTypedMc('192.168.0.55').url, '192.168.0.55', 'a bare address passes through as before');
});

test('a typed https address (the tunnel) passes through unchanged', () => {
  const r = resolveTypedMc('https://mc.example.trycloudflare.com/');
  assert.equal(r.url, 'https://mc.example.trycloudflare.com/');
  assert.equal(r.note, null);
});
