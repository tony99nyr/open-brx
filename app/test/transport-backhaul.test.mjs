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

test('A28.3: while bound on LAN with a pub in hand, checks reachability every PUB_RETRY_MS -- the probe never sends hello, and only opening it drops LAN so the normal dial ladder can claim pub for real', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 20, pubRetryMs: 15 });
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].open();               // pub dial (initial, at connect time)
  await sleep(30);                 // giveup -> LAN
  const lan = sockets[1]; lan.open();
  lan.recv(welcome());
  await p;
  assert.equal(t.reach, 'lan');
  const seq = t.send({ type: 'death', shooter_num: 19, shooter_team: 2 });   // queued, unacked, over the LAN link
  await sleep(25);                 // PUB_RETRY_MS (15) elapses -> a reachability check, not a session
  assert.equal(sockets.length, 3); assert.equal(sockets[2].url, 'wss://pub/ws');
  assert.equal(t._ws, lan, 'the probe does not disturb the live LAN socket unless/until it proves pub reachable');
  sockets[2].open();                // pub answers the websocket upgrade
  assert.equal(sockets[2].sent.length, 0, 'the probe never sends hello -- MC would otherwise take the node over server-side before any welcome reaches us (net.py ~557-570)');
  assert.equal(t.state, 'offline', 'proving pub reachable dropped the LAN link -- the normal reconnect loop takes it from here');
  await sleep(5);                  // the LAN close -> offline -> a fresh reconnect (1 ms backoff) fires
  assert.equal(sockets.length, 4, 'the ordinary dial ladder (already pub-first) claims the node the one correct way');
  assert.equal(sockets[3].url, 'wss://pub/ws');
  sockets[3].open();
  assert.equal(sockets[3].sent[0].kind, 'hello'); assert.equal(sockets[3].sent[0].body.via, 'backhaul');
  sockets[3].recv(welcome());
  await sleep(5);
  assert.equal(t.reach, 'backhaul', 'switched over');
  const batch = sockets[3].sent.find(e => e.kind === 'event_batch');
  assert.ok(batch, 'the reconnect flushed the ring on the new socket');
  assert.deepEqual(batch.body.events.map(e => e.seq), [seq], 'queued during the switch, flushed once, not duplicated');
  t.close();
});

test('A28.3: a probe that errors/closes before ever opening leaves the LAN socket completely untouched and keeps the normal cadence', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 500, pubRetryMs: 15 });
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].close(1006, 'refused');   // initial pub dial fails immediately -> the existing giveup-less fallback to LAN
  const lan = sockets[1]; lan.open();
  lan.recv(welcome());
  await p;
  assert.equal(t.reach, 'lan');
  await sleep(20);   // PUB_RETRY_MS elapses -> a reachability probe
  assert.equal(sockets.length, 3); assert.equal(sockets[2].url, 'wss://pub/ws');
  sockets[2].close(1006, 'still unreachable');   // errors/closes before ever opening
  assert.equal(t._ws, lan, 'the LAN socket is completely untouched'); assert.equal(t.reach, 'lan', 'still on LAN');
  await sleep(20);   // the normal PUB_RETRY_MS cadence resumes -- another probe, same story
  assert.equal(sockets.length, 4); assert.equal(sockets[3].url, 'wss://pub/ws');
  t.close();
});

test('A28.3: a pub that changes while a probe is in flight is re-checked (against the NEW value) once that probe settles', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 500, pubRetryMs: 15 });
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open(); sockets[0].recv(welcome({ join: { pub: 'wss://pub-a/ws', secret: 'sek' } }));
  await p;
  await sleep(5);   // learning a pub for the first time probes it immediately (no PUB_RETRY_MS wait)
  assert.equal(sockets.length, 2); assert.equal(sockets[1].url, 'wss://pub-a/ws');
  sockets[0].recv(E.makeEnvelope('join', { pub: 'wss://pub-b/ws', secret: 'sek' }));   // MC hands us a DIFFERENT pub mid-probe
  assert.equal(t.pub, 'wss://pub-b/ws');
  assert.equal(sockets.length, 2, 'no new probe yet -- the stale (pub-a) one has not settled');
  sockets[1].close(1006, 'pub-a unreachable');   // the stale probe settles
  assert.equal(sockets.length, 3, 'settling immediately re-checks the CURRENT pub');
  assert.equal(sockets[2].url, 'wss://pub-b/ws', 'checks pub-b, not the stale pub-a');
  t.close();
});

test('A28.3: _adoptPub(null) aborts an in-flight probe outright -- nothing left to check', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 500, pubRetryMs: 15 });
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open(); sockets[0].recv(welcome({ join: { pub: 'wss://pub/ws', secret: 'sek' } }));
  await p;
  await sleep(5);
  assert.equal(sockets.length, 2); assert.equal(sockets[1].url, 'wss://pub/ws');
  sockets[0].recv(E.makeEnvelope('join', { pub: null, secret: 'sek' }));   // tunnel torn down entirely
  assert.equal(t.pub, null);
  assert.equal(sockets[1].onopen, null, 'the in-flight probe socket was aborted (its handlers nulled before close)');
  await sleep(20);   // nothing left to probe for -- no further sockets appear
  assert.equal(sockets.length, 2, 'no re-probe after an outright abort');
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

test('A28.3: a join push handing us a brand-new pub while bound on LAN checks reachability right away, no PUB_RETRY_MS wait', async () => {
  const { sockets, wsFactory } = factory();
  // a large pubRetryMs -- if the check waited for the normal cadence this test would time out first
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, pubRetryMs: 30000 });
  const p = t.connect({ url: 'ws://lan/ws' });   // no pub at all yet
  sockets[0].open();
  sockets[0].recv(welcome());                    // plain LAN welcome, no join
  await p;
  assert.equal(t.reach, 'lan'); assert.equal(t.pub, null);
  sockets[0].recv(E.makeEnvelope('join', { pub: 'wss://pub/ws', secret: 'sek' }));
  assert.equal(t.pub, 'wss://pub/ws');
  await sleep(5);   // no 30s advance -- the reachability check is immediate, not on the next PUB_RETRY_MS tick
  assert.equal(sockets.length, 2, 'the newly learned pub was checked right away');
  assert.equal(sockets[1].url, 'wss://pub/ws');
  assert.equal(sockets[1].sent.length, 0, 'still just a reachability probe -- no hello');
  sockets[1].open();   // pub answers -- the probe closes itself and drops LAN
  assert.equal(sockets[1].sent.length, 0, 'even having opened, the probe itself never sends hello');
  await sleep(5);      // dropLink -> offline -> reconnect backoff -> the REAL pub dial
  assert.equal(sockets.length, 3, 'the normal dial ladder claims it with a real hello this time');
  assert.equal(sockets[2].url, 'wss://pub/ws');
  sockets[2].open();
  assert.equal(sockets[2].sent[0].body.via, 'backhaul');
  sockets[2].recv(welcome());
  await sleep(5);
  assert.equal(t.reach, 'backhaul', 'and switched over');
  t.close();
});

test('A28.3: welcome.join handing us a brand-new pub on the very first connect (dialled over LAN) also checks reachability right away', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, pubRetryMs: 30000 });
  const p = t.connect({ url: 'ws://lan/ws' });   // no pub known at connect time -> dials LAN
  sockets[0].open();
  sockets[0].recv(welcome({ join: { pub: 'wss://pub/ws', secret: 'sek' } }));   // the FIRST welcome hands us a pub
  await p;
  assert.equal(t.reach, 'lan'); assert.equal(t.pub, 'wss://pub/ws');
  await sleep(5);
  assert.equal(sockets.length, 2, 'checked immediately rather than waiting out PUB_RETRY_MS');
  assert.equal(sockets[1].url, 'wss://pub/ws');
  assert.equal(sockets[1].sent.length, 0, 'a reachability probe, not a session');
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

test('A28.2: pub/secret are bound to the LAN url that issued them -- connecting to a DIFFERENT url drops them first', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const pA = t.connect({ url: 'ws://lan-a/ws', pub: 'wss://pub-a/ws', secret: 'sek-a' });
  sockets[0].open(); sockets[0].recv(welcome());
  await pA;
  assert.equal(t.reach, 'backhaul'); assert.equal(t.pub, 'wss://pub-a/ws');
  t.close();
  // told to join a DIFFERENT MC (a different LAN url), with no fresh join info of its own
  const pB = t.connect({ url: 'ws://lan-b/ws' });
  assert.equal(t.pub, null, 'the old MC-A tunnel/secret must not carry over to MC-B');
  assert.equal(t.secret, null);
  assert.equal(sockets[1].url, 'ws://lan-b/ws', 'first (and only) dial is the new LAN url -- no pub to try');
  sockets[1].open(); sockets[1].recv(welcome());
  await pB;
  t.close();
});

test('A28.2: reconnecting to the SAME url the pub/secret were learned for keeps them (no false url-change clear)', async () => {
  const { sockets, wsFactory } = factory();
  const store = memoryStorage();
  const t = new Transport({ storage: store, wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open(); sockets[0].recv(welcome({ join: { pub: 'wss://pub/ws', secret: 'sek' } }));
  await p;
  assert.equal(t.pub, 'wss://pub/ws');
  t.close();
  const t2 = new Transport({ storage: store, wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  assert.equal(t2.pub, 'wss://pub/ws', 'persisted');
  t2.connect({ url: 'ws://lan/ws' }).catch(() => { /* closed before it ever welcomed -- not the point of this test */ });   // the SAME url this pub was learned for
  assert.equal(t2.pub, 'wss://pub/ws', 'not cleared -- same target');
  t2.close();
});

test('A28.2: onJoin surfaces every wire-driven pub/secret change (welcome.join and an MC->node join push)', async () => {
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const heard = [];
  t.onJoin(j => heard.push(j));
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open();
  sockets[0].recv(welcome({ join: { pub: 'wss://pub/ws', secret: 'sek' } }));
  await p;
  assert.deepEqual(heard, [{ pub: 'wss://pub/ws', secret: 'sek' }]);
  sockets[0].recv(E.makeEnvelope('join', { pub: null, secret: 'sek' }));
  assert.deepEqual(heard[1], { pub: null, secret: 'sek' });
  t.close();
});
