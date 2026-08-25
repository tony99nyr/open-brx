import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../src/transport/envelope.js';
import { Ring, memoryStorage } from '../src/transport/ring.js';
import { Clock } from '../src/transport/clock.js';
import { Transport } from '../src/transport/transport.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = path.resolve(HERE, '../../.venv/bin/python');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------- unit: envelope ----------------
test('envelope: hello/status/event validate like the Python rules', () => {
  const ok = E.makeEnvelope('hello', { node_id: 'n1', node_type: 'phone', app_ver: 'x', seq_next: 1 });
  assert.equal(E.validate(ok, 'node').kind, 'hello');
  assert.throws(() => E.validate({ ...ok, v: 2 }, 'node'), /version/);
  const st = E.makeEnvelope('status', { node_id: 'n1', arm_state: 'live', synced: true }, { seq: 3 });
  assert.throws(() => E.validate(st, 'node'), /status must not carry seq/);
  const ev = E.makeEnvelope('event', { type: 'death', t: Date.now(), node_id: 'n1', player_id: 'p1', shooter_num: 19, shooter_team: 2 }, { seq: 1 });
  assert.throws(() => E.validate(ev, 'node'), /missing match_id/);
  ev.body.match_id = null; assert.equal(E.validate(ev, 'node').seq, 1);
  ev.body.shooter_num = 64; assert.throws(() => E.validate(ev, 'node'), /out of 0..63/);
  assert.throws(() => E.encode(E.makeEnvelope('log_data', { node_id: 'n', seq: 0, chunk: 'x'.repeat(70000), last: true })), /oversize/);
  const mc = E.makeEnvelope('control', { cmd: 'end' });
  assert.equal(E.decode(JSON.stringify(mc), 'mc').body.cmd, 'end');
  assert.throws(() => E.decode(JSON.stringify(E.makeEnvelope('control', { cmd: 'pause' })), 'mc'), /control.cmd/);
});

// ---------------- unit: ring ----------------
test('ring: seq order, count/age bounds, prune, adoptSeqHi, persistence', () => {
  let now = 1_000_000;
  const store = memoryStorage();
  const r = new Ring({ storage: store, maxCount: 3, maxAgeMs: 1000, now: () => now });
  assert.deepEqual([r.push({ type: 'respawn' }), r.push({ type: 'respawn' }), r.push({ type: 'respawn' })], [1, 2, 3]);
  r.push({ type: 'respawn' });                     // 4th → drop oldest
  assert.deepEqual(r.pending().map(e => e.seq), [2, 3, 4]);
  assert.equal(r.takeDropped(), 1); assert.equal(r.takeDropped(), 0);
  now += 2000; r.push({ type: 'respawn' });         // age cap drops 2,3,4
  assert.deepEqual(r.pending().map(e => e.seq), [5]);
  r.prune(5); assert.equal(r.size, 0);
  r.adoptSeqHi(40); assert.equal(r.push({ type: 'respawn' }), 41);
  const r2 = new Ring({ storage: store, now: () => now });   // reload from storage
  assert.equal(r2.seqNext, 42); assert.deepEqual(r2.pending().map(e => e.seq), [41]);
});

// ---------------- unit: clock ----------------
test('clock: burst keeps min-rtt, then EWMA, outliers rejected, freshness', () => {
  let now = 10_000;
  const c = new Clock({ storage: memoryStorage(), now: () => now, burst: 3 });
  assert.equal(c.synced(), false);
  c.seed(60_000, now); assert.equal(c.offset, 50_000); assert.equal(c.synced(), false);
  // samples: (tNode, serverT) observed at `now`; true offset 50_000
  c.sample(now - 100, now - 50 + 50_000 + 40, now);   // rtt 100, off = 50_040
  c.sample(now - 20, now - 10 + 50_000 + 5, now);     // rtt 20 (best), off = 50_005
  c.sample(now - 60, now - 30 + 50_000 + 20, now);    // rtt 60
  assert.equal(c.offset, 50_005);
  c.sample(now - 20, now - 10 + 50_000 + 25, now);    // post-burst EWMA α .2 → 50_005 + .2*20 = 50_009
  assert.equal(c.offset, 50_009);
  assert.equal(c.sample(now - 5000, now - 2500 + 50_000 + 999, now), null);  // rtt 5000 > 3×median → rejected
  assert.equal(c.offset, 50_009);
  assert.equal(c.syncedNow(), now + 50_009);
  assert.equal(c.synced(), true);
  now += E.SYNC_FRESH_MS + 1; assert.equal(c.synced(), false);
});

// ---------------- unit: transport state machine over a fake socket ----------------
class FakeWS {
  constructor() { this.sent = []; this.readyState = 0; }
  send(t) { this.sent.push(JSON.parse(t)); }
  close() { this.onclose && this.onclose({}); }
  open() { this.onopen && this.onopen(); }
  recv(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
}
test('transport: hello→welcome→bind, queue offline, flush on reconnect, prune on ack', async () => {
  const sockets = [];
  const store = memoryStorage();
  const t = new Transport({ storage: store, wsFactory: () => { const w = new FakeWS(); sockets.push(w); return w; },
    gun: { name: 'GUN-A', tail: '3D4F', fw: 'v4.32' }, node: { app_ver: 't' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 } });
  const states = []; t.onState(s => states.push(s));
  const p = t.connect({ url: 'ws://x/ws' });
  const ws = sockets[0]; ws.open();
  assert.equal(ws.sent[0].kind, 'hello'); assert.equal(ws.sent[0].body.gun.name, 'GUN-A'); assert.equal(ws.sent[0].body.seq_next, 1);
  ws.recv(E.makeEnvelope('welcome', { session_id: 's', server_t: Date.now() + 5, seq_hi: 10, node: { player: { player_id: 'p1', player_num: 7 }, match_id: 'm1' } }));
  const w = await p; assert.equal(w.seq_hi, 10); assert.equal(t.playerNum, 7); assert.equal(t.matchId, 'm1');
  assert.equal(t.state, 'bound'); assert.equal(ws.sent[1].kind, 'bind'); assert.equal(ws.sent[1].body.gun_tail, '3D4F');
  assert.equal(ws.sent.filter(e => e.kind === 'time_req').length, 5);
  assert.equal(t.send({ type: 'death', shooter_num: 19, shooter_team: 2 }), 11);   // seq adopted past seq_hi
  const evEnv = ws.sent.find(e => e.kind === 'event'); assert.equal(evEnv.seq, 11); assert.equal(evEnv.body.match_id, 'm1'); assert.equal(evEnv.body.player_id, 'p1');
  E.validate(evEnv, 'node');
  ws.recv(E.makeEnvelope('ack', { seq_hi: 11 })); assert.equal(t.ring.size, 0);
  ws.close();                                                 // out of range
  assert.equal(t.state, 'offline');
  assert.equal(t.status({ arm_state: 'live' }), false);       // status dropped offline
  t.send({ type: 'hit_taken', shooter_num: 19, shooter_team: 2, dmg: 9 }); t.send({ type: 'death', shooter_num: 19, shooter_team: 2 });
  assert.equal(t.ring.size, 2);
  await sleep(10);                                            // backoff fires → new socket
  const ws2 = sockets[1]; assert.ok(ws2); ws2.open(); assert.equal(ws2.sent[0].body.seq_next, 14);
  ws2.recv(E.makeEnvelope('welcome', { session_id: 's', server_t: Date.now(), seq_hi: 11 }));
  const batch = ws2.sent.find(e => e.kind === 'event_batch'); assert.deepEqual(batch.body.events.map(e => e.seq), [12, 13]); E.validate(batch, 'node');
  ws2.recv(E.makeEnvelope('ack', { seq_hi: 13 })); assert.equal(t.ring.size, 0);
  const got = []; t.onMessage(m => got.push(m.kind));
  ws2.recv(E.makeEnvelope('start', { match_id: 'm2', go_live_t: Date.now() + 5000, config_id: 'c', seq: 1, countdown_s: 5 }));
  ws2.recv(E.makeEnvelope('apply', { frames: ['$LIFE,10,0,0,*'] }));
  assert.deepEqual(got, ['start', 'apply']); assert.equal(t.matchId, 'm2');
  assert.equal(t.status({ arm_state: 'armed', hp: 45 }), true);
  const st = ws2.sent.filter(e => e.kind === 'status').pop(); assert.equal(st.body.match_id, 'm2'); assert.equal('seq' in st, false); E.validate(st, 'node');
  t.close(); assert.deepEqual(states.slice(0, 3), ['connecting', 'open', 'bound']);
});

// ---------------- integration: the real Python NetServer ----------------
const haveServer = existsSync(PY) && spawnSync(PY, ['-c', 'import websockets, brx_mcp.mc.net'], { stdio: 'ignore' }).status === 0;
test('integration: Transport ⇄ real NetServer (hydrate, seq adoption, status, offline flush + ack, sync, pushes)', { skip: !haveServer && 'needs .venv python with websockets' }, async () => {
  const srv = spawn(PY, [path.join(HERE, 'mc_server.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = []; const waiters = [];
  let buf = '';
  srv.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; const o = JSON.parse(l); lines.push(o); waiters.splice(0).forEach(w => w()); } });
  const until = async (pred, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = lines.find(pred); if (m) return m; await new Promise(r => { waiters.push(r); setTimeout(r, 100); }); } throw new Error('timeout waiting for ' + pred); };
  const tell = o => srv.stdin.write(JSON.stringify(o) + '\n');
  try {
    const { url } = await until(o => o.port);
    const store = memoryStorage();
    const t = new Transport({ storage: store, gun: { name: 'GUN-A', tail: '3D4F', fw: 'v4.32' }, node: { app_ver: 'test' }, backoff: { baseMs: 50, capMs: 200, jitter: 0.2 } });
    t.setStatusProvider(() => ({ hp: 45, armor: 70, ammo: 36, alive: true, shots: 0, arm_state: 'kitted' }));
    const msgs = []; t.onMessage(m => msgs.push(m));
    const welcome = await t.connect({ url });
    assert.equal(welcome.node.player.player_num, 7); assert.equal(welcome.node.hello_seq_next, 1); assert.equal(t.playerId, 'p1');
    await until(o => o.ev === 'node' && o.gun_tail === '3D4F');
    await until(o => o.ev === 'status' && o.arm_state === 'kitted' && o.hp === 45);
    await sleep(300); assert.equal(t.synced(), true); assert.ok(Math.abs(t.clock.offset) < 1000, 'offset ' + t.clock.offset); assert.ok(t.clock.sampleCount >= 3);
    // live fact → ingested + acked
    const s1 = t.send({ type: 'hit_taken', shooter_num: 19, shooter_team: 2, dmg: 9 });
    await until(o => o.ev === 'event' && o.seq === s1 && o.type === 'hit_taken');
    await sleep(100); assert.equal(t.ring.size, 0);
    // walk out of range: die offline, come back → batch flush in order, acked, pruned
    t.close();
    const t2 = new Transport({ storage: store, gun: { name: 'GUN-A', tail: '3D4F' }, node: { app_ver: 'test' }, backoff: { baseMs: 50, capMs: 200, jitter: 0 } });
    const s2 = t2.send({ type: 'hit_taken', shooter_num: 19, shooter_team: 2, dmg: 9 });
    const s3 = t2.send({ type: 'death', shooter_num: 19, shooter_team: 2 });
    assert.equal(t2.ring.size, 2); assert.equal(t2.nodeId, t.nodeId, 'node_id persisted');
    const w2 = await t2.connect({ url });
    assert.equal(w2.seq_hi, s1);
    const e2 = await until(o => o.ev === 'event' && o.seq === s2); const e3 = await until(o => o.ev === 'event' && o.seq === s3 && o.type === 'death');
    assert.ok(lines.indexOf(e2) < lines.indexOf(e3), 'oldest first');
    await sleep(150); assert.equal(t2.ring.size, 0, 'pruned on ack');
    // pushes from MC reach onMessage
    const m2 = []; t2.onMessage(m => m2.push(m));
    tell({ push: { node_id: t2.nodeId, kind: 'assign', body: { player: { player_id: 'p1', player_num: 7 }, team: { tid: 1 }, roster: [] } } });
    tell({ push: { node_id: t2.nodeId, kind: 'config', body: { config: { config_id: 'c1', time_limit_s: 600 }, frames: { head: ['$CLEAR,*'], spawn: [], revive: [], end: [], panic: [], cues: {} }, roster: [] } } });
    tell({ broadcast: { kind: 'start', body: { match_id: 'm9', go_live_t: Date.now() + 60000, config_id: 'c1', seq: 1, countdown_s: 60 } } });
    await sleep(400);
    assert.deepEqual(m2.map(m => m.kind), ['assign', 'config', 'start']); assert.equal(t2.matchId, 'm9');
    assert.equal(t2.report('ack_config', { config_id: 'c1', ok: true, gun_echo: '$LCD,0,0,0,0,0,0,*' }), true);
    await until(o => o.ev === 'msg' && o.kind === 'ack_config' && o.body.gun_echo);
    t2.close();
  } finally { tell({ quit: 1 }); srv.kill(); }
});
