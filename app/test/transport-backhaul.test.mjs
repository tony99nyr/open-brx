// A28 backhaul (contracts.md §5d): a phone with its own data path reaches MC off the field Wi-Fi.
// The no-pub path is covered (unmodified, still green) by transport.test.mjs; this file is the A28.3
// reach policy and A28.2 pub/secret adoption, over a fake socket so it needs no network and no timers
// longer than a few ms (backhaulGiveupMs/lanGiveupMs are constructor overrides for exactly this).
//
// Time is the mocked clock of node:test, not the wall clock. The Transport reads `setTimeout` from
// `globalThis` when it arms a timer, so `advance(ms)` fires exactly the timers that are due. A loaded
// machine cannot fire a timer early or late against the assertions. Each test closes its Transport in
// `ctx.after`, so a failed assertion cannot leave a reconnect loop alive and hold the process open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/transport/envelope.js';
import { memoryStorage } from '../src/transport/ring.js';
import { Transport, BACKHAUL_GIVEUP_MS, LAN_GIVEUP_MS } from '../src/transport/transport.js';
import { flush, useClock } from './_helpers.mjs';

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

test('A28: BACKHAUL_GIVEUP_MS / LAN_GIVEUP_MS are exported with the contract values', () => {
  assert.equal(BACKHAUL_GIVEUP_MS, 8000);
  assert.equal(LAN_GIVEUP_MS, 8000);
});

test('A28.3 (F595): the LAN is dialled first; a LAN dial with no event inside LAN_GIVEUP_MS falls to pub at once, no backoff consumed', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1000, capMs: 2000, jitter: 0 }, lanGiveupMs: 15, backhaulGiveupMs: 500, welcomeTimeoutMs: 5000 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  assert.equal(sockets.length, 1); assert.equal(sockets[0].url, 'ws://lan/ws', 'LAN dialled first');
  await advance(14);
  assert.equal(sockets.length, 1, 'still waiting on the LAN dial before its giveup');
  await advance(1);    // the LAN giveup
  assert.equal(sockets.length, 2, 'fell to pub the moment the LAN gave up'); assert.equal(sockets[1].url, 'wss://pub/ws');
  assert.equal(t.reconnects, 0, 'the fallback is not a backoff-consuming reconnect');
  sockets[1].open();
  assert.equal(sockets[1].sent[0].kind, 'hello'); assert.equal(sockets[1].sent[0].body.via, 'backhaul');
  sockets[1].recv(welcome());
  await p;
  assert.equal(t.reach, 'backhaul');
  t.close();
});

test('A28.3 (F595): a LAN close before welcome (not a refusal) falls to pub right away, no backoff consumed', async ctx => {
  useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1000, capMs: 2000, jitter: 0 }, lanGiveupMs: 5000 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  assert.equal(sockets[0].url, 'ws://lan/ws');
  sockets[0].close(1006, 'no route');   // never even opened
  assert.equal(sockets.length, 2, 'falls to pub synchronously'); assert.equal(sockets[1].url, 'wss://pub/ws');
  assert.equal(t.reconnects, 0, 'the fallback is not a backoff-consuming reconnect');
  sockets[1].open();
  assert.equal(sockets[1].sent[0].body.via, 'backhaul');
  sockets[1].recv(welcome());
  await p;
  assert.equal(t.reach, 'backhaul');
  t.close();
});

test('A28.3 (F595): a LAN socket factory that throws falls to pub right away', async ctx => {
  useClock(ctx);
  const sockets = [], asked = [];
  const wsFactory = url => {
    asked.push(url);
    if (url.startsWith('ws://lan')) throw new Error('SecurityError: insecure ws from an https origin');
    const w = new FakeWS(url); sockets.push(w); return w;
  };
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1000, capMs: 2000, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  assert.deepEqual(asked, ['ws://lan/ws', 'wss://pub/ws'], 'the LAN was asked for first, and its throw went straight to pub');
  assert.equal(t.reconnects, 0);
  sockets[0].open(); sockets[0].recv(welcome());
  await p;
  assert.equal(t.reach, 'backhaul');
  t.close();
});

test('A28.3 (F595): a LAN socket that opens but never welcomes gives up at helloTimeoutMs and dials pub at once', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1000, capMs: 2000, jitter: 0 }, lanGiveupMs: 5000, helloTimeoutMs: 20, welcomeTimeoutMs: 5000 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].open();   // the upgrade completes, and then nothing: a captive or wedged LAN
  assert.equal(sockets[0].sent[0].body.via, 'lan');
  await advance(19);
  assert.equal(sockets.length, 1, 'still waiting on the LAN welcome');
  await advance(1);    // helloTimeoutMs
  assert.equal(sockets.length, 2, 'the missing welcome counts as a LAN failure'); assert.equal(sockets[1].url, 'wss://pub/ws');
  assert.equal(t.reconnects, 0, 'no backoff consumed');
  sockets[1].open(); sockets[1].recv(welcome());
  await p;
  assert.equal(t.reach, 'backhaul');
  t.close();
});

test('A28.3 (F595): a cold start off the Wi-Fi resolves when pub welcomes after the LAN giveup, past welcomeTimeoutMs', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  // the real values: LAN giveup 8 s, then the tunnel dial; the plain welcome window is 10 s
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1000, capMs: 2000, jitter: 0 }, lanGiveupMs: 8000, backhaulGiveupMs: 8000, welcomeTimeoutMs: 10000 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  let settled = null;
  p.then(() => { settled = 'resolved'; }, e => { settled = e.message; });
  // the LAN address has no route: no event at all
  for (let i = 0; i < 8; i++) { ctx.mock.timers.tick(1000); await flush(); }
  assert.equal(sockets.length, 2); assert.equal(sockets[1].url, 'wss://pub/ws');
  for (let i = 0; i < 4; i++) { ctx.mock.timers.tick(500); await flush(); }   // 10 s: the old deadline passes
  sockets[1].open();
  ctx.mock.timers.tick(500); await flush();                                  // the tunnel welcomes at 10.5 s
  sockets[1].recv(welcome());
  await flush();
  assert.equal(settled, 'resolved', 'the connect() deadline covers the LAN giveup plus a pub dial');
  assert.equal(t.reach, 'backhaul');
  t.close();
});

test('A28.3 (F595): a LAN socket that opens near the giveup and never welcomes still leaves pub its full giveup', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  // the real values: LAN giveup 8 s, hello timeout 5 s, tunnel giveup 8 s
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1000, capMs: 2000, jitter: 0 }, lanGiveupMs: 8000, helloTimeoutMs: 5000,
    backhaulGiveupMs: 8000, welcomeTimeoutMs: 10000 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  let settled = null;
  p.then(() => { settled = 'resolved'; }, e => { settled = e.message; });
  await advance(7900);
  sockets[0].open();                    // the LAN upgrade completes at 7.9 s, then no welcome
  await advance(5000);                  // 12.9 s: the welcome timeout drops it and pub is dialled
  assert.equal(sockets.length, 2); assert.equal(sockets[1].url, 'wss://pub/ws');
  await advance(7500);                  // 20.4 s: past the old 18 s deadline, inside pub's 8 s
  sockets[1].open(); sockets[1].recv(welcome());
  await flush();
  assert.equal(settled, 'resolved', 'the deadline covers LAN giveup + hello timeout + pub giveup');
  assert.equal(t.reach, 'backhaul');
  t.close();
});

test('A28.3 (F595): dialNow() while bound on pub does nothing; the phone stays on pub until that socket drops', async ctx => {
  useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].close(1006, 'no route');   // LAN fails -> pub
  sockets[1].open(); sockets[1].recv(welcome());
  await p;
  assert.equal(t.reach, 'backhaul');
  assert.equal(t.dialNow(), false, 'the Wi-Fi came back, but a live pub link is not dropped for it');
  assert.equal(sockets.length, 2, 'no LAN dial');
  assert.equal(t._ws, sockets[1]); assert.equal(t.state, 'bound');
  t.close();
});

test('A28.3 (F595): a pub attempt that fails before welcome ends the pass, and the next pass is LAN first', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 10, capMs: 20, jitter: 0 }, lanGiveupMs: 5000, backhaulGiveupMs: 5000, welcomeTimeoutMs: 5000 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  p.catch(() => { /* never welcomes in this test */ });
  sockets[0].close(1006, 'no route');            // LAN fails -> pub
  sockets[1].close(1006, 'tunnel unreachable');   // pub fails too
  assert.equal(t.state, 'offline', 'the pass is over');
  assert.equal(t.reconnects, 1, 'and the normal reconnect backoff is consumed');
  assert.equal(sockets.length, 2, 'no third dial inside the same pass');
  await advance(10);   // the backoff
  assert.equal(sockets.length, 3); assert.equal(sockets[2].url, 'ws://lan/ws', 'the next pass starts on the LAN again');
  t.close();
});

test('F595 review (Codex): a socket that opens but never welcomes does not reset the backoff, so repeated failed passes slow down', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 10, capMs: 1000, jitter: 0 }, lanGiveupMs: 5000, backhaulGiveupMs: 5000, welcomeTimeoutMs: 5000 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  p.catch(() => { /* never welcomes in this test */ });
  const pass = () => { const lan = sockets.at(-1); lan.open(); lan.close(1006, 'reset'); const pub = sockets.at(-1); pub.open(); pub.close(1006, 'reset'); };
  pass();                                          // pass 1: both open, neither welcomes
  await advance(10); assert.equal(sockets.length, 3, 'the first retry waits the base delay');
  pass();                                          // pass 2
  await advance(10); assert.equal(sockets.length, 4, 'the second retry waits longer than the base');
  await advance(10); assert.equal(sockets.length, 5);
  t.close();
});

test('A28.3 (F595): a pub dial that never fires ANY event (a dead or blackholed tunnel) gives up at BACKHAUL_GIVEUP_MS and ends the pass', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, lanGiveupMs: 5000, backhaulGiveupMs: 15, welcomeTimeoutMs: 5000 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].close(1006, 'no route');   // LAN fails -> pub
  // sockets[1] never calls .open()/.recv()/.close(): a true blackhole, neither onopen nor onclose ever fires
  await advance(15);
  assert.equal(t.state, 'offline', 'gave up on the silent pub dial on its own');
  await advance(1);    // the 1 ms backoff
  assert.equal(sockets.length, 3); assert.equal(sockets[2].url, 'ws://lan/ws', 'and the next pass is LAN first');
  sockets[2].open(); sockets[2].recv(welcome());
  await p;
  assert.equal(t.reach, 'lan');
  t.close();
});

test('A28.3 (F595): a join push handing us a pub while bound on LAN changes nothing visible: no extra socket, no drop', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws' });   // no pub at all yet
  sockets[0].open();
  sockets[0].recv(welcome());                    // plain LAN welcome, no join
  await p;
  assert.equal(t.reach, 'lan'); assert.equal(t.pub, null);
  sockets[0].recv(E.makeEnvelope('join', { pub: 'wss://pub/ws', secret: 'sek' }));   // MC started its tunnel during kit
  assert.equal(t.pub, 'wss://pub/ws', 'the pub is held for later');
  assert.equal(t.secret, 'sek');
  await advance(50);
  assert.equal(sockets.length, 1, 'no socket opened to pub');
  assert.equal(t._ws, sockets[0], 'the LAN socket stays the live one');
  assert.equal(t.state, 'bound'); assert.equal(t.reach, 'lan');
  t.close();
});

test('A28.3 (F595): bound on LAN with a pub held, the phone never probes pub, over several of the old 30 s retry periods', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  // `pubRetryMs` was the old probe period. The option no longer exists; it is passed so this test fails
  // on the old probe-and-drop code, which would have opened a pub socket at 15 ms and dropped the LAN.
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, backhaulGiveupMs: 20, pubRetryMs: 15 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open();
  sockets[0].recv(welcome({ join: { pub: 'wss://pub/ws', secret: 'sek' } }));   // the first welcome hands us a pub
  await p;
  assert.equal(t.reach, 'lan'); assert.equal(t.pub, 'wss://pub/ws');
  await advance(100);
  assert.equal(sockets.length, 1, 'no reachability probe, ever, while the LAN works');
  assert.equal(t._ws, sockets[0]); assert.equal(t.state, 'bound'); assert.equal(t.reach, 'lan');
  t.close();
});

test('A28.3 (F595, field 2026-10-17): bound on LAN with pub held, the LAN drops and its redial blackholes; after LAN_GIVEUP_MS the phone binds over pub', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' },
    backoff: { baseMs: 1, capMs: 2, jitter: 0 }, lanGiveupMs: 20, backhaulGiveupMs: 500, welcomeTimeoutMs: 5000 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open();
  sockets[0].recv(welcome({ join: { pub: 'wss://pub/ws', secret: 'sek' } }));
  await p;
  assert.equal(t.reach, 'lan');
  const seq = t.send({ type: 'death', shooter_num: 19, shooter_team: 2 });   // queued, unacked, over the LAN link
  sockets[0].close(1006, 'walked off the field Wi-Fi');
  await advance(1);    // the normal reconnect backoff
  assert.equal(sockets.length, 2); assert.equal(sockets[1].url, 'ws://lan/ws', 'the redial is LAN first');
  // ...and from off the Wi-Fi the LAN address has no route: no onopen, no onerror, no onclose
  await advance(19);
  assert.equal(sockets.length, 2, 'still on the LAN dial before its giveup');
  await advance(1);    // LAN_GIVEUP_MS
  assert.equal(sockets.length, 3); assert.equal(sockets[2].url, 'wss://pub/ws', 'the giveup falls to pub at once');
  sockets[2].open();
  const hello = sockets[2].sent[0];
  assert.equal(hello.kind, 'hello'); assert.equal(hello.body.via, 'backhaul');
  assert.equal(hello.body.secret, 'sek', 'the held secret rides the pub hello');
  sockets[2].recv(welcome());
  await advance(1);
  assert.equal(t.state, 'bound'); assert.equal(t.reach, 'backhaul');
  const batch = sockets[2].sent.find(e => e.kind === 'event_batch');
  assert.deepEqual(batch.body.events.map(e => e.seq), [seq], 'the queued fact flushed once on the pub socket');
  // a phone riding pub stays there until that socket drops; then the next pass is LAN first again
  await advance(100);
  assert.equal(sockets.length, 3, 'no move back to the LAN while pub works');
  sockets[2].close(1006, 'tunnel blip');
  await advance(2);
  assert.equal(sockets.length, 4); assert.equal(sockets[3].url, 'ws://lan/ws', 'after a pub drop the ladder starts on the LAN');
  t.close();
});

test('A28.2/A28.3: hello carries via + secret only when held; status carries reach; welcome.join adopts pub/secret', async ctx => {
  useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
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
  assert.equal(st.body.has_pub, true, 'F595: the phone says it holds a fallback');
  t.close();
});

test('F595: status says has_pub false when no pub is held', async ctx => {
  useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open(); sockets[0].recv(welcome());
  await p;
  t.status({});
  const st = sockets[0].sent.filter(e => e.kind === 'status').pop();
  assert.equal(st.body.has_pub, false, 'always sent, so MC can tell "none" from an older app');
  t.close();
});

test('A28.2: a re-hello (after any reconnect) carries the held secret', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', secret: 'sek0' });
  sockets[0].open();
  assert.equal(sockets[0].sent[0].body.secret, 'sek0');
  sockets[0].recv(welcome());
  await p;
  sockets[0].close(4002, 'drop');
  await advance(10);
  sockets[1].open();
  assert.equal(sockets[1].sent[0].body.secret, 'sek0', 'still carried on the reconnect hello');
  t.close();
});

test('A28.2: MC push join {pub:null} while on backhaul drops pub and falls back to LAN via the normal loop', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws', secret: 'sek' });
  sockets[0].close(1006, 'no route');   // LAN fails -> pub
  sockets[1].open();                     // pub welcomes
  sockets[1].recv(welcome());
  await p;
  assert.equal(t.reach, 'backhaul');
  sockets[1].recv(E.makeEnvelope('join', { pub: null, secret: 'sek' }));
  assert.equal(t.pub, null, 'tunnel-down push drops pub immediately');
  await advance(10);
  assert.equal(sockets.length, 3, 'the drop triggered the normal reconnect loop');
  assert.equal(sockets[2].url, 'ws://lan/ws', 'and it dials LAN');
  sockets[2].open();
  sockets[2].recv(welcome());
  await advance(5);
  assert.equal(t.reach, 'lan');
  t.close();
});

test('A28.2: pub/secret are session-scoped -- a session change (new session_id) clears them; unchanged across a same-session reconnect', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const store = memoryStorage();
  const t = new Transport({ storage: store, wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open();
  sockets[0].recv(welcome({ session_id: 's1', join: { pub: 'wss://pub/ws', secret: 'sek' } }));
  await p;
  assert.equal(t.pub, 'wss://pub/ws'); assert.equal(t.secret, 'sek');
  // same session reconnects (server restart did NOT mint a new session) -> pub/secret survive
  sockets[0].close(4002, 'drop');
  await advance(10);
  sockets[1].open();
  sockets[1].recv(welcome({ session_id: 's1' }));   // same session id, no join this time
  await advance(5);
  assert.equal(t.pub, 'wss://pub/ws', 'unchanged across a same-session reconnect');
  t.close();
  // a fresh Transport instance sharing storage picks up the persisted pub/secret
  const sockets2 = [];
  const t2 = new Transport({ storage: store, wsFactory: url => { const w = new FakeWS(url); sockets2.push(w); return w; },
    gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t2.close());
  assert.equal(t2.pub, 'wss://pub/ws', 'persisted across a fresh Transport instance');
  const p2 = t2.connect({ url: 'ws://lan/ws' });
  assert.equal(sockets2[0].url, 'ws://lan/ws', 'dials the LAN first, with the pub still held for a fallback');
  sockets2[0].open();
  sockets2[0].recv(welcome({ session_id: 's2' }));   // MC restarted -> a NEW session, no join
  await p2;
  assert.equal(t2.pub, null, 'a session change cleared the old pub'); assert.equal(t2.secret, null);
  t2.close();
});

test('F203: clearing a failed MC target removes the persisted pub URL scope too', () => {
  const store = memoryStorage();
  store.setItem('brx.pub', 'wss://stale.example/ws');
  store.setItem('brx.secret', 'stale-secret');
  store.setItem('brx.pub_url', 'ws://192.168.0.55:8766/ws');
  const t = new Transport({ storage: store, wsFactory: () => { throw new Error('unused'); } });
  assert.equal(t.pub, 'wss://stale.example/ws');
  t.clearJoinTarget();
  assert.equal(t.pub, null);
  assert.equal(t.secret, null);
  assert.equal(store.getItem('brx.pub_url'), null);
  assert.equal(store.getItem('brx.pub'), null);
  assert.equal(store.getItem('brx.secret'), null);
  t.close();
});

test('A28.3: a hard refusal (4003 in use / 4001 version) over the backhaul dial is terminal, not a LAN retry', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  sockets[0].close(1006, 'no route');   // LAN fails -> pub
  assert.equal(sockets[1].url, 'wss://pub/ws');
  sockets[1].open();
  sockets[1].close(4003, 'gun in use');
  await assert.rejects(p, /refused.*gun in use.*4003/);
  await advance(10);
  assert.equal(sockets.length, 2, 'no further dial -- the refusal is authoritative regardless of path');
  assert.equal(t.state, 'rejected');
  t.close();
});

test('A28.3 (F595): a hard refusal over the LAN dial is terminal too, not a pub fallback', async ctx => {
  const advance = useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws', pub: 'wss://pub/ws' });
  assert.equal(sockets[0].url, 'ws://lan/ws');
  sockets[0].open();
  sockets[0].close(4001, 'protocol version');
  await assert.rejects(p, /refused.*4001/);
  await advance(10);
  assert.equal(sockets.length, 1, 'pub is never tried after a refusal');
  assert.equal(t.state, 'rejected');
  t.close();
});

test('A28.2: pub/secret are bound to the LAN url that issued them -- connecting to a DIFFERENT url drops them first', async ctx => {
  useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const pA = t.connect({ url: 'ws://lan-a/ws', pub: 'wss://pub-a/ws', secret: 'sek-a' });
  sockets[0].open(); sockets[0].recv(welcome());
  await pA;
  assert.equal(t.reach, 'lan'); assert.equal(t.pub, 'wss://pub-a/ws');
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

test('A28.2: reconnecting to the SAME url the pub/secret were learned for keeps them (no false url-change clear)', async ctx => {
  useClock(ctx);
  const { sockets, wsFactory } = factory();
  const store = memoryStorage();
  const t = new Transport({ storage: store, wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open(); sockets[0].recv(welcome({ join: { pub: 'wss://pub/ws', secret: 'sek' } }));
  await p;
  assert.equal(t.pub, 'wss://pub/ws');
  t.close();
  const t2 = new Transport({ storage: store, wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t2.close());
  assert.equal(t2.pub, 'wss://pub/ws', 'persisted');
  t2.connect({ url: 'ws://lan/ws' }).catch(() => { /* closed before it ever welcomed -- not the point of this test */ });   // the SAME url this pub was learned for
  assert.equal(t2.pub, 'wss://pub/ws', 'not cleared -- same target');
  t2.close();
});

test('A28.2: a cosmetically different but equivalent url (case, a trailing slash) is NOT "a different MC" -- pub/secret survive', async ctx => {
  useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://192.168.1.20:8765/ws', pub: 'wss://pub/ws', secret: 'sek' });
  sockets[0].open(); sockets[0].recv(welcome());
  await p;
  t.close();
  // a discovery/sweep reconnect can hand back a cosmetically different (but equivalent) string
  const p2 = t.connect({ url: 'WS://192.168.1.20:8765/ws/' });
  assert.equal(t.pub, 'wss://pub/ws', 'same MC, differently-cased/trailing-slashed -- not wiped');
  assert.equal(t.secret, 'sek');
  assert.equal(sockets[1].url, 'WS://192.168.1.20:8765/ws/', 'dials the LAN first, as given');
  sockets[1].open(); sockets[1].recv(welcome());
  await p2;
  t.close();
});

test('F309: status carries the phone\'s own connection once the app sets it, and never guesses one', async ctx => {
  useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open();
  sockets[0].recv(welcome());
  await p;
  const last = () => sockets[0].sent.filter(e => e.kind === 'status').pop().body;
  t.status({ arm_state: 'kitted' });
  assert.equal('transport' in last(), false, 'never told -> no claim (web, older plugin)');
  t.setConnectionType('cellular');
  t.status({ arm_state: 'kitted' });
  assert.equal(last().transport, 'cellular');
  t.setConnectionType('wifi');
  t.status({ arm_state: 'kitted' });
  assert.equal(last().transport, 'wifi', 'a switch is restated on the next beat');
  t.setConnectionType('5g-ultra');
  t.status({ arm_state: 'kitted' });
  assert.equal(last().transport, 'unknown', 'an unrecognised value is unknown, never cellular');
  t.close();
});

test('F309: a socket keeps the network it opened on, so a later switch to cellular is not claimed', async ctx => {
  useClock(ctx);
  const { sockets, wsFactory } = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory, gun: { name: 'GUN-A', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 },
    node: { connection_type: 'wifi' } });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://lan/ws' });
  sockets[0].open();
  sockets[0].recv(welcome());
  await p;
  const last = () => sockets[0].sent.filter(e => e.kind === 'status').pop().body;
  t.status({});
  assert.equal(last().transport, 'wifi', 'the seeded value is claimed from the first beat');
  t.setConnectionType('cellular');          // Android "switch to mobile data": the default moved, the socket did not
  t.status({});
  assert.equal(last().transport, 'wifi', 'the socket opened on Wi-Fi is still on Wi-Fi');
});
