// A28 backhaul (contracts.md §5d): a phone with its own data path reaches MC off the field Wi-Fi.
// The no-pub path is covered (unmodified, still green) by transport.test.mjs; this file is the A28.3
// reach policy and A28.2 pub/secret adoption, over a fake socket so it needs no network and no timers
// longer than a few ms (backhaulGiveupMs/pubRetryMs are constructor overrides for exactly this).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/transport/envelope.js';
import { memoryStorage } from '../src/transport/ring.js';
import { Transport, BACKHAUL_GIVEUP_MS, PUB_RETRY_MS } from '../src/transport/transport.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

class FakeWS {
  constructor(url) { this.url = url; this.sent = []; }
  send(t) { this.sent.push(JSON.parse(t)); }
  close(code, reason) { this.onclose && this.onclose({ code, reason }); }
  open() { this.onopen && this.onopen(); }
  recv(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
}
function factory() {
  const sockets = [];
  return { sockets, wsFactory: url => { const w = new FakeWS(url); sockets.push(w); return w; } };
}
const welcome = (o = {}) => E.makeEnvelope('welcome', { session_id: 's', server_t: Date.now(), seq_hi: 0, ...o });

test('A28: BACKHAUL_GIVEUP_MS / PUB_RETRY_MS are exported with the contract values', () => {
  assert.equal(BACKHAUL_GIVEUP_MS, 8000);
  assert.equal(PUB_RETRY_MS, 30000);
});

test('A28.3: pub is dialled first; no welcome within BACKHAUL_GIVEUP_MS falls back to the LAN url', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 15, welcomeTimeoutMs: 500 });
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  assert.equal(sockets.length, 1); assert.equal(sockets[0].url, 'wss://pub/ws', 'pub dialled first');
  sockets[0].open();
  assert.equal(sockets[0].sent[0].kind, 'hello'); assert.equal(sockets[0].sent[0].body.via, 'backhaul');
  await sleep(30);   // giveup fires -> falls back
  assert.equal(sockets.length, 2); assert.equal(sockets[1].url, 'ws://lan/ws', 'falls back to the LAN url');
  sockets[1].open();
  assert.equal(sockets[1].sent[0].body.via, 'lan');
  sockets[1].recv(welcome());
  await p;
  assert.equal(t.reach, 'lan');
  t.close();
});

test('A28.3: an immediate error/close on pub (before welcome) falls back to LAN right away, no backoff consumed', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1000, capMs: 2000, jitter: 0 }, backhaulGiveupMs: 5000 });
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].close(1006, 'connection refused');   // never even opened
  assert.equal(sockets.length, 2, 'falls back synchronously'); assert.equal(sockets[1].url, 'ws://lan/ws');
  assert.equal(t.reconnects, 0, 'the fallback is not a backoff-consuming reconnect');
  sockets[1].open();
  sockets[1].recv(welcome());
  await p;
  assert.equal(t.reach, 'lan');
  t.close();
});

test('A28.3: while bound on LAN with a pub in hand, re-probes pub every PUB_RETRY_MS and switches over on welcome; the ring flushes once on the new socket', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 20, pubRetryMs: 15 });
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].open();               // pub dial
  await sleep(30);                 // giveup -> LAN
  const lan = sockets[1]; lan.open();
  lan.recv(welcome());
  await p;
  assert.equal(t.reach, 'lan');
  const seq = t.send({ type: 'death', shooter_num: 19, shooter_team: 2 });   // queued, unacked, over the LAN link
  await sleep(25);                 // PUB_RETRY_MS (15) elapses -> a probe dial to pub
  assert.equal(sockets.length, 3); assert.equal(sockets[2].url, 'wss://pub/ws');
  assert.equal(t._ws, lan, 'the probe does not disturb the live LAN socket unless/until it welcomes');
  sockets[2].open();
  assert.equal(sockets[2].sent[0].body.via, 'backhaul');
  sockets[2].recv(welcome());
  await sleep(5);
  assert.equal(t.reach, 'backhaul', 'switched over');
  assert.equal(lan.onclose, null, 'the old LAN socket is silenced before being closed, not left to fire the reconnect loop');
  const batch = sockets[2].sent.find(e => e.kind === 'event_batch');
  assert.ok(batch, 'the switch flushed the ring on the new socket');
  assert.deepEqual(batch.body.events.map(e => e.seq), [seq], 'queued during the switch, flushed once, not duplicated');
  t.close();
});

test('A28.2/A28.3: hello carries via + secret only when held; status carries reach; welcome.join adopts pub/secret', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://lan/ws' });   // no pub/secret at all yet
  sockets[0].open();
  assert.equal(sockets[0].sent[0].body.via, 'lan');
  assert.equal('secret' in sockets[0].sent[0].body, false, 'no secret held -> no secret field on hello');
  sockets[0].recv(welcome({ join: { pub: 'wss://pub/ws', secret: 'sek' } }));
  await p;
  assert.equal(t.reach, 'lan'); assert.equal(t.pub, 'wss://pub/ws'); assert.equal(t.secret, 'sek');
  assert.equal(t.status({ arm_state: 'kitted' }), true);
  const st = sockets[0].sent.filter(e => e.kind === 'status').pop();
  assert.equal(st.body.reach, 'lan');
  t.close();
});

test('A28.2: a re-hello (after any reconnect) carries the held secret', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://lan/ws', secret: 'sek0' });
  sockets[0].open();
  assert.equal(sockets[0].sent[0].body.secret, 'sek0');
  sockets[0].recv(welcome());
  await p;
  sockets[0].close(4002, 'drop');
  await sleep(10);
  sockets[1].open();
  assert.equal(sockets[1].sent[0].body.secret, 'sek0', 'still carried on the reconnect hello');
  t.close();
});

test('A28.2: MC push join {pub:null} while on backhaul drops pub and falls back to LAN via the normal loop', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws', secret: 'sek' });
  sockets[0].open();               // pub welcomes right away this time
  sockets[0].recv(welcome());
  await p;
  assert.equal(t.reach, 'backhaul');
  sockets[0].recv(E.makeEnvelope('join', { pub: null, secret: 'sek' }));
  assert.equal(t.pub, null, 'tunnel-down push drops pub immediately');
  await sleep(10);
  assert.equal(sockets.length, 2, 'the drop triggered the normal reconnect loop');
  assert.equal(sockets[1].url, 'ws://lan/ws', 'and since pub is now null, it dials LAN');
  sockets[1].open();
  sockets[1].recv(welcome());
  await sleep(5);
  assert.equal(t.reach, 'lan');
  t.close();
});

test('A28.2: pub/secret are session-scoped -- a session change (new session_id) clears them; unchanged across a same-session reconnect', async () => {
  const { sockets, wsFactory } = factory();
  const store = memoryStorage();
  const t = new Transport({ storage: store, wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open();
  sockets[0].recv(welcome({ session_id: 's1', join: { pub: 'wss://pub/ws', secret: 'sek' } }));
  await p;
  assert.equal(t.pub, 'wss://pub/ws'); assert.equal(t.secret, 'sek');
  // same session reconnects (server restart did NOT mint a new session) -> pub/secret survive
  sockets[0].close(4002, 'drop');
  await sleep(10);
  sockets[1].open();
  sockets[1].recv(welcome({ session_id: 's1' }));   // same session id, no join this time
  await sleep(5);
  assert.equal(t.pub, 'wss://pub/ws', 'unchanged across a same-session reconnect');
  t.close();
  // a fresh Transport instance sharing storage picks up the persisted pub/secret
  const sockets2 = [];
  const t2 = new Transport({ storage: store, wsFactory: url => { const w = new FakeWS(url); sockets2.push(w); return w; },
    gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  assert.equal(t2.pub, 'wss://pub/ws', 'persisted across a fresh Transport instance');
  const p2 = t2.connect({ url: 'ws://lan/ws' });
  assert.equal(sockets2[0].url, 'wss://pub/ws', 'dials pub first since it is still held');
  sockets2[0].open();
  sockets2[0].recv(welcome({ session_id: 's2' }));   // MC restarted -> a NEW session, no join
  await p2;
  assert.equal(t2.pub, null, 'a session change cleared the old pub'); assert.equal(t2.secret, null);
  t2.close();
});

test('A28.3: a hard refusal (4003 in use / 4001 version) over the backhaul dial is terminal, not a LAN fallback', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].open();
  sockets[0].close(4003, 'gun in use');
  await assert.rejects(p, /refused.*gun in use.*4003/);
  await sleep(10);
  assert.equal(sockets.length, 1, 'no LAN fallback attempted -- the refusal is authoritative regardless of path');
  assert.equal(t.state, 'rejected');
  t.close();
});
