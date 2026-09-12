// F153 (field test 2026-09-12): the three ways the phone's dial ladder wasted MINUTES on a real field.
//
//   a) The LAN leg had no pre-open giveup. Off the field Wi-Fi the pub dial fails at once, the ladder
//      falls to the LAN url, and from a phone that address has no route — so the dial fired NO event at
//      all and sat there for Android's ~2 minute connect timeout with a working tunnel one hop away.
//      Measured: mobile data came back mid-match and the node did not reappear for ~3 minutes.
//   b) A new connect() (a QR rescan after the tunnel restarted, a typed address, RECONNECT MC) queued
//      behind whatever was already hanging. Neither phone rejoined for 4+ minutes after a tunnel restart.
//   c) Nothing reacted to the platform saying the network came back.
//
// Everything here runs on a fake socket with millisecond giveups (`lanGiveupMs`/`backhaulGiveupMs` are
// constructor overrides for exactly this), so there is no network and no real waiting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/transport/envelope.js';
import { memoryStorage } from '../src/transport/ring.js';
import { Transport, LAN_GIVEUP_MS, BACKHAUL_GIVEUP_MS, RECLAIM_RETRY_MS } from '../src/transport/transport.js';
import { STALE_AFTER_MS } from '../src/transport/envelope.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Records closure, unlike the backhaul suite's fake — "the hanging socket was actually closed" is the
 *  whole point of F153b, and a fake that cannot be asked would make that assertion unfalsifiable. */
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.closed = null; }
  send(t) { this.sent.push(JSON.parse(t)); }
  close(code, reason) { if (!this.closed) this.closed = { code, reason }; if (this.onclose) this.onclose({ code, reason }); }
  open() { this.onopen && this.onopen(); }
  recv(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
}
function factory() {
  const sockets = [];
  return { sockets, wsFactory: url => { const w = new FakeWS(url); sockets.push(w); return w; } };
}
const welcome = (o = {}) => E.makeEnvelope('welcome', { session_id: 's', server_t: Date.now(), seq_hi: 0, ...o });

test('F153: LAN_GIVEUP_MS is exported and matches the backhaul giveup — one bound, both legs', () => {
  assert.equal(LAN_GIVEUP_MS, 8000);
  assert.equal(LAN_GIVEUP_MS, BACKHAUL_GIVEUP_MS);
});

test('F153a: a LAN dial that never fires any event gives up at LAN_GIVEUP_MS and the next dial is pub, not the OS timeout', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 500, lanGiveupMs: 20, welcomeTimeoutMs: 5000 });
  const p = t.connect({ url: 'ws://192.168.28.167:8766/ws', pub: 'wss://pub/ws' });
  p.catch(() => { /* never welcomes in this test */ });
  assert.equal(sockets[0].url, 'wss://pub/ws', 'pub first');
  sockets[0].close(1006, 'no data');                 // data is off: pub fails at once
  assert.equal(sockets.length, 2); assert.equal(sockets[1].url, 'ws://192.168.28.167:8766/ws', 'falls to LAN');
  // ...and that LAN address has no route from this phone: no onopen, no onerror, no onclose. Ever.
  await sleep(10);
  assert.equal(sockets.length, 2, 'still waiting on the LAN dial before the giveup');
  await sleep(25);                                    // LAN giveup + the 1 ms backoff
  assert.ok(sockets[1].closed, 'the hung LAN socket was closed by us, not left to the OS');
  assert.equal(sockets.length, 3, 'a new pass started');
  assert.equal(sockets[2].url, 'wss://pub/ws', 'and it dials pub again — pub -> lan -> pub');
  sockets[2].open(); sockets[2].recv(welcome());
  await p;
  assert.equal(t.reach, 'backhaul');
  t.close();
});

test('F153a: the LAN giveup does not consume a live LAN link — a socket that opens gets the ordinary welcome timeout', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, lanGiveupMs: 15, helloTimeoutMs: 5000 });
  const p = t.connect({ url: 'ws://lan/ws' });        // no pub at all
  sockets[0].open();
  await sleep(30);                                    // past the pre-open giveup, but the socket IS open
  assert.equal(sockets.length, 1, 'an opened socket is never closed by the pre-open giveup');
  assert.equal(sockets[0].closed, null);
  sockets[0].recv(welcome());
  await p;
  assert.equal(t.state, 'bound'); assert.equal(t.reach, 'lan');
  t.close();
});

test('F153a: with no pub held, a dead LAN address still ends its pass and retries on the ordinary backoff', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, lanGiveupMs: 15, welcomeTimeoutMs: 5000 });
  const p = t.connect({ url: 'ws://192.168.28.167:8766/ws' });
  p.catch(() => { /* never welcomes */ });
  await sleep(30);
  assert.equal(sockets.length, 2, 'the silent dial was given up on and retried');
  assert.equal(sockets[1].url, 'ws://192.168.28.167:8766/ws');
  assert.ok(t.reconnects >= 1, 'a LAN failure IS a backoff-consuming reconnect (unlike the backhaul fallback)');
  t.close();
});

test('F153b: a new connect() closes the dial already in flight and dials the NEW pub at once', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 5000, lanGiveupMs: 5000, welcomeTimeoutMs: 5000 });
  const first = t.connect({ url: 'ws://192.168.28.167:8766/ws', pub: 'wss://old-tunnel/ws' });
  const firstErr = first.then(() => null, e => e);
  sockets[0].close(1006, 'tunnel restarted — the old hostname is gone');
  assert.equal(sockets.length, 2); assert.equal(sockets[1].url, 'ws://192.168.28.167:8766/ws');
  const hung = sockets[1];                            // hanging on an unroutable LAN address, fires nothing
  // the player rescans the QR MC is showing now: same MC, new tunnel hostname
  const second = t.connect({ url: 'ws://192.168.28.167:8766/ws', pub: 'wss://new-tunnel/ws', secret: 'sek' });
  assert.ok(hung.closed, 'the hanging socket was closed, not left holding the slot');
  assert.equal(hung.onopen, null, 'and its handlers were detached first, so it cannot schedule anything');
  assert.equal(sockets.length, 3, 'the new target is dialled immediately, not after the OS timeout');
  assert.equal(sockets[2].url, 'wss://new-tunnel/ws', 'and pub-first, with the freshly scanned hostname');
  assert.equal((await firstErr).message, 'connect: superseded by a new connect()', 'the old promise settles');
  sockets[2].open();
  assert.equal(sockets[2].sent[0].body.secret, 'sek');
  sockets[2].recv(welcome());
  await second;
  assert.equal(t.reach, 'backhaul');
  t.close();
});

test('F153b: the superseded dial cannot resurrect itself — a late event on the abandoned socket does nothing', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, lanGiveupMs: 5000, welcomeTimeoutMs: 5000 });
  const first = t.connect({ url: 'ws://lan-a/ws' });
  first.catch(() => { /* superseded */ });
  const abandoned = sockets[0];
  const second = t.connect({ url: 'ws://lan-b/ws' });
  second.catch(() => { /* closed at the end */ });
  assert.equal(sockets.length, 2); assert.equal(sockets[1].url, 'ws://lan-b/ws');
  abandoned.open(); abandoned.recv(welcome());        // the old dial finally answers, far too late
  assert.equal(t.state, 'connecting', 'the abandoned socket cannot bind us');
  assert.equal(sockets.length, 2, 'and it starts no new dial');
  t.close();
});

test('F153c: dialNow() resets the backoff and restarts the ladder from pub, keeping the pending connect()', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 10000, capMs: 10000, jitter: 0 }, backhaulGiveupMs: 5000, lanGiveupMs: 5000, welcomeTimeoutMs: 5000 });
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].close(1006, 'no data');                  // pub fails
  const lanDial = sockets[1];                         // LAN hangs (no route while the radio was down)
  assert.equal(lanDial.url, 'ws://lan/ws');
  // the OS says the network is back
  assert.equal(t.dialNow(), true);
  assert.ok(lanDial.closed, 'the dial started with no network was dropped');
  assert.equal(sockets.length, 3); assert.equal(sockets[2].url, 'wss://pub/ws', 'restarted from the top of the ladder');
  assert.equal(t.attempt, 0, 'backoff reset');
  sockets[2].open(); sockets[2].recv(welcome());
  await p;                                            // the original connect() promise still resolves
  assert.equal(t.state, 'bound');
  t.close();
});

test('F153c: dialNow() is a no-op while bound, once rejected, and after close() — it never disturbs a live link', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open(); sockets[0].recv(welcome());
  await p;
  assert.equal(t.dialNow(), false, 'bound: nothing to do');
  assert.equal(sockets.length, 1, 'the live socket is untouched');
  t.close();
  assert.equal(t.dialNow(), false, 'closed: stays closed');
  assert.equal(sockets.length, 1);
  // and a refusal is authoritative — re-dialling would just get refused again
  const { sockets: s2, wsFactory: f2 } = factory();
  const t2 = new Transport({ storage: memoryStorage(), wsFactory: f2, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p2 = t2.connect({ url: 'ws://lan/ws' });
  s2[0].open(); s2[0].close(4003, 'gun in use');
  await assert.rejects(p2, /refused/);
  assert.equal(t2.dialNow(), false, 'rejected: never re-dial');
  assert.equal(s2.length, 1);
  t2.close();
});

test('F153c: kick() is dialNow(), and neither dials with no target at all', () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' } });
  assert.equal(t.kick(), false, 'never scanned a QR, nothing remembered — nothing to dial');
  assert.equal(sockets.length, 0);
  t.close();
});

test('F153b/c: an in-flight pub REACHABILITY PROBE is torn down by a new connect() too (it belongs to the old target)', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 5000, pubRetryMs: 5 });
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open(); sockets[0].recv(welcome({ join: { pub: 'wss://pub/ws', secret: 'sek' } }));
  await p;
  await sleep(5);
  assert.equal(sockets[1].url, 'wss://pub/ws', 'a probe is in flight');
  const probe = sockets[1];
  const p2 = t.connect({ url: 'ws://other-mc/ws' });   // told to join a different MC entirely
  p2.catch(() => { /* closed below */ });
  assert.ok(probe.closed, 'the probe for the OLD mc was closed');
  assert.equal(probe.onopen, null, 'and detached, so it cannot drop the new link when it settles');
  t.close();
});

// ---------------- review pass 1 ----------------

test('F153c: dialNow() keeps the connect() timeout RUNNING — a kept promise must still settle', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 10000, capMs: 10000, jitter: 0 }, lanGiveupMs: 5000, welcomeTimeoutMs: 300 });
  const p = t.connect({ url: 'ws://lan/ws' });
  const settled = p.then(() => 'resolved', e => e.message);
  await sleep(50);
  assert.equal(t.dialNow(), true);
  // _clearTimers() CANCELS the connect timer; restoring the saved handle afterwards does not un-cancel
  // it, so this promise used to hang forever instead of telling the app the join failed.
  assert.match(await settled, /no welcome within 300 ms/);
  t.close();
});

test('security: a hello to an address nobody typed or scanned carries no node_key and no join secret', async () => {
  const { sockets, wsFactory } = factory();
  const store = memoryStorage();
  const t = new Transport({ storage: store, wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://lan/ws', secret: 'sek' });
  sockets[0].open();
  sockets[0].recv(welcome({ node_key: 'KEY-1' }));
  await p;
  assert.equal(t.nodeKey, 'KEY-1');
  t.close();
  // ...now the LAN sweep suggests some other host and the player taps JOIN: same node, untrusted peer
  const p2 = t.connect({ url: 'ws://192.168.0.77:8766/ws', trusted: false });
  p2.catch(() => { /* closed below */ });
  sockets[1].open();
  const hello = sockets[1].sent[0];
  assert.equal(hello.kind, 'hello');
  assert.equal('node_key' in hello.body, false, 'the A8.2 takeover key is not handed to a host that has proved nothing');
  assert.equal('secret' in hello.body, false, 'nor is the A28.2 join secret');
  assert.equal(hello.body.node_id, t.nodeId, 'it is still us — only the credentials are withheld');
  t.close();
});

test('security: an untrusted peer that WELCOMES us has proved itself — the next hello carries the key again', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://192.168.0.77:8766/ws', trusted: false, secret: 'sek' });
  assert.equal(t.trusted, false);
  sockets[0].open();
  assert.equal('secret' in sockets[0].sent[0].body, false);
  sockets[0].recv(welcome({ node_key: 'KEY-2', join: { pub: null, secret: 'sek2' } }));
  await p;
  assert.equal(t.trusted, true, 'a welcome is the proof');
  sockets[0].close(4002, 'drop');
  await sleep(10);
  sockets[1].open();
  assert.equal(sockets[1].sent[0].body.node_key, 'KEY-2', 'without the key a reconnect cannot take its own node_id back (A8.2)');
  assert.equal(sockets[1].sent[0].body.secret, 'sek2');
  t.close();
});

test('security: a plain connect() is trusted — the ordinary QR/typed/remembered join is unchanged', async () => {
  const { sockets, wsFactory } = factory();
  const store = memoryStorage();
  store.setItem('brx.node_key', 'KEY-0');
  const t = new Transport({ storage: store, wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://lan/ws', secret: 'sek' });
  p.catch(() => { /* closed below */ });
  sockets[0].open();
  assert.equal(sockets[0].sent[0].body.node_key, 'KEY-0');
  assert.equal(sockets[0].sent[0].body.secret, 'sek');
  t.close();
});

test('security: a 4003 on an UNTRUSTED dial waits out the stale window and tries once more (A8.2)', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, reclaimRetryMs: 30, welcomeTimeoutMs: 5000 });
  const p = t.connect({ url: 'ws://192.168.0.77:8766/ws', trusted: false });
  sockets[0].open();
  sockets[0].close(4003, 'gun or node in use');
  // Not terminal: the holder MC is refusing us over is very likely OUR OWN socket, and a stale holder is
  // displaced with no key at all. A dead end here means clearing app data in the middle of a match.
  assert.equal(t.state, 'offline'); assert.equal(t.rejected, null);
  assert.equal(sockets.length, 1, 'it waits — an instant retry would be refused for the same reason');
  await sleep(45);
  assert.equal(sockets.length, 2, 'one more try after the stale window');
  sockets[1].open();
  assert.equal('node_key' in sockets[1].sent[0].body, false, 'still untrusted, still keyless — that is what makes the displacement legal');
  sockets[1].recv(welcome({ node_key: 'KEY-3' }));
  await p;
  assert.equal(t.state, 'bound'); assert.equal(t.trusted, true);
  t.close();
});

test('security: the untrusted reclaim is spent ONCE — a second 4003 is authoritative', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, reclaimRetryMs: 20, welcomeTimeoutMs: 5000 });
  const p = t.connect({ url: 'ws://192.168.0.77:8766/ws', trusted: false });
  sockets[0].open(); sockets[0].close(4003, 'in use');
  await sleep(35);
  sockets[1].open(); sockets[1].close(4003, 'in use');
  await assert.rejects(p, /refused.*4003/);
  assert.equal(t.state, 'rejected');
  await sleep(35);
  assert.equal(sockets.length, 2, 'no third dial — someone else really does hold this gun');
  t.close();
});

test('security: a TRUSTED dial keeps the old contract — 4003 and 4001 are terminal at once', async () => {
  for (const code of [4003, 4001]) {
    const { sockets, wsFactory } = factory();
    const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'Tactix-XXXX', tail: '3D4F' },
      backoff: { baseMs: 1, capMs: 2, jitter: 0 }, reclaimRetryMs: 20 });
    const p = t.connect({ url: 'ws://lan/ws' });
    sockets[0].open(); sockets[0].close(code, 'refused');
    await assert.rejects(p, /refused/);
    assert.equal(t.state, 'rejected');
    await sleep(35);
    assert.equal(sockets.length, 1, `no retry after ${code} on a trusted dial`);
    t.close();
  }
});

test('security: RECLAIM_RETRY_MS clears the contract stale window it is derived from', () => {
  assert.ok(RECLAIM_RETRY_MS > STALE_AFTER_MS, 'retrying inside the window would just be refused again');
  assert.ok(RECLAIM_RETRY_MS < STALE_AFTER_MS + 5000, 'and the player is standing there waiting');
});
