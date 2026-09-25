// A60: join Mission Control with no tap where it is safe (Tony 2026-09-24: "lets auto connect when we can").
//
//   * mcproof.js: the phone's HMAC matches node:crypto and the ONE vector the python suite also checks
//     (fixtures/mc-proof-vector.json), so the two formulas cannot drift apart.
//   * transport.js `verify`: a proof dial withholds every secret, and on a wrong or missing proof it
//     closes having processed, stored and sent nothing.
//   * the F203 regression (field 2026-09-24): a remembered url dialled while MC is down for longer than
//     the first welcome window keeps redialling and binds when MC comes back with a new session_id.
//   * autojoin.js: one candidate + a trust key joins; two candidates, no key or a failed proof ask.
//   * F346 (d): a never-joined phone that sees ONE MC joins it untrusted and enrols; several still ask.
//
// Fake sockets and the mocked clock of node:test only: no network, no real waiting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/transport/envelope.js';
import { memoryStorage } from '../src/transport/ring.js';
import { Transport, holdsTrustKey } from '../src/transport/transport.js';
import { sha256, hmacSha256, b64url, b64urlDecode, mcProof, proofMatches, ctEqual, newChallenge } from '../src/transport/mcproof.js';
import { McAutoJoin, offerText, VERIFY_COOLDOWN_MS, FIRST_CONTACT_SETTLE_MS, namedDialPending } from '../src/transport/autojoin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VECTOR = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'mc-proof-vector.json'), 'utf8'));
const APP_JS = path.resolve(HERE, '../src/app.js');

const flush = () => new Promise(r => setImmediate(r));
const settledOr = p => Promise.race([p.then(v => ({ ok: v }), e => ({ err: e })), flush().then(() => 'pending')]);
function useClock(ctx) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_700_000_000_000 });
  return async ms => { for (let i = 0; i < ms; i++) { ctx.mock.timers.tick(1); await flush(); } };
}
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

/** A fake Mission Control install: the SAME formula as mcp/brx_mcp/mc/mcid.py (the vector test pins it). */
class FakeMc {
  constructor(secret = randomBytes(32)) { this.secret = new Uint8Array(secret); this.session = 'sess' + Math.random().toString(16).slice(2, 8); }
  restart() { this.session = 'sess' + Math.random().toString(16).slice(2, 8); return this; }   // same install, new session_id
  keyFor(nodeId) { return b64url(hmacSha256(this.secret, new TextEncoder().encode('open-brx node trust v1:' + nodeId))); }
  /** The welcome MC sends for `hello` (enrol=true: this node has never had its key). */
  welcome(hello, { enrol = true, node = null, proof } = {}) {
    const body = { session_id: this.session, server_t: Date.now(), seq_hi: 0, node_key: 'nk-' + this.session,
                   join: { pub: null, secret: 'sec-' + this.session } };
    if (hello.mc_challenge) body.mc_proof = proof !== undefined ? proof : mcProof(this.keyFor(hello.node_id), hello.mc_challenge, this.session);
    if (hello.mc_enroll && enrol) body.mc_trust = { key: this.keyFor(hello.node_id) };
    if (node) body.node = node;
    return E.makeEnvelope('welcome', body);
  }
}
const helloOf = ws => (ws.sent.find(e => e.kind === 'hello') || {}).body;
const NODE = { player: { player_id: 'p1', player_num: 3 }, team: { team_id: 'blue', tid: 1 }, roster: [],
               config: { config_id: 'c1', time_limit_s: 600 } };
const CONFIG = E.makeEnvelope('config', { config: { config_id: 'c2', time_limit_s: 300 }, frames: { head: ['$CLEAR,*'] }, roster: [] });

/** A phone that already joined `mc` once (by a tap): it holds a trust key for its node_id. */
function enrolledPhone(ctx, mc, { url = 'ws://192.168.1.10:8766/ws' } = {}) {
  const storage = memoryStorage();
  const f = factory();
  const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9 });
  ctx.after(() => t.close());
  t.connect({ url, trusted: false }).catch(() => {});
  f.sockets[0].open(); f.sockets[0].recv(mc.welcome(helloOf(f.sockets[0])));
  assert.equal(t.state, 'bound');
  t.close();
  return { storage, nodeId: t.nodeId };
}

// ---------------------------------------------------------------- mcproof.js
test('A60 mcproof: sha256 and HMAC match node:crypto on random inputs of every block-edge length', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 200, 1000]) {
    const d = randomBytes(n);
    assert.equal(Buffer.from(sha256(new Uint8Array(d))).toString('hex'), createHash('sha256').update(d).digest('hex'), `sha256 len ${n}`);
    for (const kl of [0, 16, 32, 64, 65, 100]) {
      const k = randomBytes(kl);
      assert.equal(Buffer.from(hmacSha256(new Uint8Array(k), new Uint8Array(d))).toString('hex'),
        createHmac('sha256', k).update(d).digest('hex'), `hmac key ${kl} msg ${n}`);
    }
  }
  for (const n of [0, 1, 2, 3, 16, 31, 32, 33]) {
    const d = new Uint8Array(randomBytes(n));
    assert.equal(b64url(d), Buffer.from(d).toString('base64url'));
    assert.deepEqual(b64urlDecode(b64url(d)), d);
  }
  assert.equal(b64urlDecode('not base64!'), null);
});

test('A60 mcproof: the shared vector (the python suite checks the same file)', () => {
  const secret = b64urlDecode(VECTOR.install_secret_b64url);
  const key = b64url(hmacSha256(secret, new TextEncoder().encode('open-brx node trust v1:' + VECTOR.node_id)));
  assert.equal(key, VECTOR.trust_key);
  assert.equal(mcProof(VECTOR.trust_key, VECTOR.mc_challenge, VECTOR.session_id), VECTOR.mc_proof);
  assert.ok(proofMatches(['x'.repeat(43), VECTOR.trust_key], VECTOR.mc_proof, VECTOR.mc_challenge, VECTOR.session_id));
  assert.ok(!proofMatches([VECTOR.trust_key], VECTOR.mc_proof, VECTOR.mc_challenge, 'another-session'));
  assert.ok(!ctEqual(VECTOR.mc_proof, VECTOR.mc_proof.slice(0, -1) + 'A'));
  assert.equal(newChallenge().length, 22);
  assert.throws(() => newChallenge(() => new Uint8Array(4)));
});

// ---------------------------------------------------------------- transport.js verify
test('A60 transport: a dial the player named asks for its trust key, keeps it, and the key is per node_id', ctx => {
  const mc = new FakeMc();
  const { storage, nodeId } = enrolledPhone(ctx, mc);
  assert.ok(holdsTrustKey(storage));
  const held = JSON.parse(storage.getItem('brx.mc_trust'));
  assert.deepEqual(held, { node_id: nodeId, keys: [mc.keyFor(nodeId)], proven_at: {} });
  // a store written for another node_id counts for nothing
  storage.setItem('brx.node_id', 'node-someoneelse');
  assert.equal(holdsTrustKey(storage), false);
});

test('A60 transport: a verify dial with the right proof binds, applies config, and sent no secret', ctx => {
  const mc = new FakeMc();
  const { storage } = enrolledPhone(ctx, mc);
  storage.setItem('brx.pub', 'wss://old-tunnel.example/ws'); storage.setItem('brx.pub_url', 'ws://192.168.1.10:8766/ws');
  const f = factory();
  const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9, gun: { name: 'Tactix-AB12', tail: 'AB12' } });
  ctx.after(() => t.close());
  const hydrated = [], delivered = [];
  t.onHydrate(n => hydrated.push(n)); t.onMessage(m => delivered.push(m.kind));
  const p = t.connect({ url: 'ws://192.168.7.20:8766/ws', verify: true });
  assert.equal(f.sockets.length, 1);
  assert.equal(f.sockets[0].url, 'ws://192.168.7.20:8766/ws', 'straight to the hit, never the trusted MC\'s tunnel');
  f.sockets[0].open();
  const hello = helloOf(f.sockets[0]);
  assert.ok(hello.mc_challenge && hello.mc_challenge.length >= 22);
  for (const k of ['node_key', 'secret', 'prior_utility', 'mc_enroll', 'mc_enroll_nonce']) assert.ok(!(k in hello), `hello carried ${k}`);
  mc.restart();   // MC restarted and moved: new session_id, same install secret
  f.sockets[0].recv(mc.welcome(hello, { enrol: false, node: NODE }));
  assert.equal(t.state, 'bound');
  assert.equal(hydrated.length, 1);
  assert.equal(t.playerId, 'p1');
  assert.equal(t.pub, null, 'the old tunnel (another address) was dropped once the proof passed');
  assert.equal(storage.getItem('brx.pub_url'), 'ws://192.168.7.20:8766/ws');
  assert.equal(t.secret, 'sec-' + mc.session, 'the verified MC\'s own join secret was adopted');
  f.sockets[0].recv(CONFIG);
  assert.deepEqual(delivered, ['config']);
  assert.ok(f.sockets[0].sent.some(e => e.kind === 'bind'));
  return settledOr(p).then(r => assert.ok(r.ok, 'connect() resolved'));
});

for (const [label, proof] of [['a wrong proof', 'A'.repeat(43)], ['no proof (an older MC)', null], ['a proof for another session', 'other']]) {
  test(`A60 transport: ${label} closes at once, applies nothing, stores nothing, sends nothing`, async ctx => {
    const mc = new FakeMc();
    const { storage } = enrolledPhone(ctx, mc);
    storage.setItem('brx.pub', 'wss://real-tunnel.example/ws'); storage.setItem('brx.pub_url', 'ws://192.168.1.10:8766/ws');
    storage.setItem('brx.secret', 'real-secret');
    const snapshot = () => JSON.stringify(['brx.node_key', 'brx.pub', 'brx.secret', 'brx.pub_url', 'brx.session_id', 'brx.mc_trust', 'brx.outbox', 'brx.clock'].map(k => storage.getItem(k)));
    const snap0 = snapshot();
    const f = factory();
    const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9, gun: { name: 'Tactix-AB12', tail: 'AB12' } });
    ctx.after(() => t.close());
    const hydrated = [], delivered = [], states = [];
    t.onHydrate(n => hydrated.push(n)); t.onMessage(m => delivered.push(m.kind)); t.onState(s => states.push(s));
    const p = t.connect({ url: 'ws://192.168.7.66:8766/ws', verify: true });
    const ws = f.sockets[0];
    ws.open();
    const hello = helloOf(ws);
    ws.recv(CONFIG);                                       // a rogue pushing config BEFORE its welcome
    ws.recv(E.makeEnvelope('join', { pub: 'wss://rogue.example/ws', secret: 'rogue' }));
    const w = proof === 'other'
      ? mc.welcome(hello, { enrol: false, proof: mcProof(mc.keyFor(hello.node_id), hello.mc_challenge, 'another-session') })
      : mc.welcome(hello, { enrol: false, node: NODE, proof });
    w.body.mc_trust = { key: 'B'.repeat(43) };             // and a key it would like us to trust next time
    ws.recv(w);
    ws.recv(CONFIG);                                       // and after it
    assert.ok(ws.closed, 'the socket was closed');
    assert.equal(t.closed, true);
    assert.notEqual(t.state, 'bound'); assert.ok(!states.includes('bound') && !states.includes('open'));
    assert.deepEqual(hydrated, []); assert.deepEqual(delivered, []);
    assert.equal(t.playerId, null);
    assert.equal(snapshot(), snap0, 'nothing held was changed');
    assert.equal(t.pub, 'wss://real-tunnel.example/ws'); assert.equal(t.secret, 'real-secret');
    assert.deepEqual(ws.sent.map(e => e.kind), ['hello'], 'no bind, no time_req, no event_batch, no status');
    for (const k of ['node_key', 'secret', 'prior_utility']) assert.ok(!(k in hello));
    assert.equal(t.verifyFailed, proof === null ? 'no_proof' : 'bad_proof');
    const r = await settledOr(p);
    assert.equal(r.err && r.err.code, 'mc_unproven');
  });
}

test('A60 transport: the challenge is fresh on every dial, redials included', async ctx => {
  const advance = useClock(ctx);
  const mc = new FakeMc();
  const { storage } = enrolledPhone(ctx, mc);
  const f = factory();
  const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9, backoff: { baseMs: 5, capMs: 5, jitter: 0 } });
  ctx.after(() => t.close());
  t.connect({ url: 'ws://192.168.7.20:8766/ws', verify: true }).catch(() => {});
  f.sockets[0].open(); f.sockets[0].close(1006, 'drop');   // no welcome: the transport redials
  await advance(20);
  f.sockets[1].open();
  t.connect({ url: 'ws://192.168.7.20:8766/ws', verify: true }).catch(() => {});
  f.sockets[2].open();
  const ch = f.sockets.slice(0, 3).map(w => helloOf(w).mc_challenge);
  assert.equal(new Set(ch).size, 3, `three dials, three challenges: ${ch}`);
  // ...and a proof for an OLD challenge does not pass on the new socket
  f.sockets[2].recv(mc.welcome({ ...helloOf(f.sockets[2]), mc_challenge: ch[0] }, { enrol: false, proof: mcProof(mc.keyFor(t.nodeId), ch[0], mc.session) }));
  assert.equal(t.verifyFailed, 'bad_proof');
});

test('A60 transport: a verify dial with no trust key is refused before any socket', async ctx => {
  const f = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory: f.wsFactory });
  ctx.after(() => t.close());
  await assert.rejects(t.connect({ url: 'ws://192.168.7.20:8766/ws', verify: true }), e => e.code === 'mc_unproven');
  assert.equal(f.sockets.length, 0);
});

// ---------------------------------------------------------------- rejoin with no tap
test('A60/F203: a remembered url dialled while MC is down past the first welcome window keeps redialling and binds when MC is back', async ctx => {
  const advance = useClock(ctx);
  const mc = new FakeMc();
  const { storage } = enrolledPhone(ctx, mc);   // joined yesterday; settings.mcUrl is this url
  const url = 'ws://192.168.1.10:8766/ws';
  const f = factory();
  // the app's boot dial: a new Transport over the SAME storage (app restart; an app update is the same
  // storage under a new build id)
  const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9, welcomeTimeoutMs: 10000,
                            node: { app_ver: '0.4.12+update' }, backoff: { baseMs: 500, capMs: 2000, jitter: 0 } });
  ctx.after(() => t.close());
  const outcome = t.connect({ url }).then(v => ({ ok: v }), e => ({ err: e }));
  // MC is restarting: every dial is refused for 25 s
  let refused = 0;
  const refuse = () => { for (const w of f.sockets) if (!w.closed && !w.refused) { w.refused = true; refused++; w.close(1006, 'refused'); } };
  for (let s = 0; s < 25; s++) { refuse(); await advance(1000); }
  const r = await Promise.race([outcome, flush().then(() => 'pending')]);
  assert.match(String(r.err && r.err.message), /no welcome within 10000/, 'the first welcome window was missed');
  assert.ok(refused >= 5, `it kept redialling (${refused} dials)`);
  assert.equal(t.closed, false, 'the transport was not closed');
  // MC is back: a new session_id, and it does not know this node
  mc.restart();
  refuse(); await advance(3000);
  const ws = f.sockets[f.sockets.length - 1];
  assert.equal(ws.url, url);
  ws.open();
  const hello = helloOf(ws);
  assert.ok(hello.node_key, 'a remembered url is a trusted dial: it presents the node_key');
  assert.equal(hello.app_ver, '0.4.12+update');
  ws.recv(mc.welcome(hello, { enrol: false, node: NODE }));
  assert.equal(t.state, 'bound', 'joined with no tap');
  assert.equal(t.url, url);
});

test('A60: rejoin with no tap after an MC restart at a NEW address (unknown node, same install): the proof verifies', ctx => {
  const mc = new FakeMc();
  const { storage } = enrolledPhone(ctx, mc);
  mc.restart();
  const aj = new McAutoJoin();
  const d = aj.onFound('ws://192.168.1.77:8766/ws', 'mdns', { bound: false, dialling: 'ws://192.168.1.10:8766/ws', verifying: false, hasTrustKey: holdsTrustKey(storage) });
  assert.deepEqual(d, { do: 'verify' });
  const f = factory();
  const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9 });
  ctx.after(() => t.close());
  t.connect({ url: 'ws://192.168.1.77:8766/ws', verify: true }).catch(() => {});
  f.sockets[0].open();
  f.sockets[0].recv(mc.welcome(helloOf(f.sockets[0]), { enrol: false, node: NODE }));
  assert.equal(t.state, 'bound');
});

// ---------------------------------------------------------------- autojoin.js policy
test('A60 autojoin: a key proof-dials (the proof breaks ties); no key asks; a failed proof asks and is not redialled', () => {
  let now = 1_000_000;
  const aj = new McAutoJoin({ now: () => now });
  const ctxOf = (o = {}) => ({ bound: false, dialling: null, verifying: false, hasTrustKey: true, remembered: null, userDialPending: false, ...o });
  assert.deepEqual(aj.onFound('ws://10.0.0.5:8766/ws', 'mdns', ctxOf()), { do: 'verify' });
  assert.deepEqual(aj.onFound('ws://10.0.0.5:8766/ws', 'mdns', ctxOf({ dialling: 'ws://10.0.0.5:8766/ws', verifying: true })), { do: 'ignore' }, 'the proof dial in flight is left alone');
  assert.deepEqual(aj.onFound('ws://10.0.0.6:8766/ws', 'mdns', ctxOf({ dialling: 'ws://10.0.0.5:8766/ws', verifying: true })), { do: 'ignore' }, 'one proof dial at a time');
  assert.deepEqual(aj.onFound('ws://10.0.0.6:8766/ws', 'mdns', ctxOf()), { do: 'verify' }, 'two hosts and a key: the proof decides');
  assert.deepEqual(aj.onFound('ws://10.0.0.6:8766/ws', 'mdns', ctxOf({ hasTrustKey: false })), { do: 'offer', reason: 'several' }, 'two hosts, no key: ask');
  now += 3 * 60000;   // both forgotten
  assert.deepEqual(aj.onFound('ws://10.0.0.6:8766/ws', 'sweep', ctxOf({ hasTrustKey: false, remembered: 'ws://10.0.0.1:8766/ws' })), { do: 'offer', reason: 'new' },
    'no key but a remembered address: not a first contact, so ask (F346 d)');
  assert.deepEqual(aj.onFound('ws://10.0.0.6:8766/ws', 'sweep', ctxOf({ bound: true })), { do: 'ignore' });
  assert.deepEqual(aj.onFound('ws://10.0.0.6:8766/ws/', 'sweep', ctxOf({ dialling: 'WS://10.0.0.6:8766/ws' })), { do: 'kick' }, 'the remembered MC is kicked, not proof-dialled');
  assert.equal(aj.onVerifyFailed('ws://10.0.0.6:8766/ws', true), 'unproven');
  assert.deepEqual(aj.onFound('ws://10.0.0.6:8766/ws', 'mdns', ctxOf()), { do: 'offer', reason: 'unproven' });
  now += VERIFY_COOLDOWN_MS + 1;
  assert.deepEqual(aj.onFound('ws://10.0.0.6:8766/ws', 'mdns', ctxOf()), { do: 'verify' });
  aj.onBound();
  assert.equal(aj.live().length, 0);
});

test('A60 polish #8/#9: a silent proof dial gets the full 10 min cool-down and no row at failure time', () => {
  let now = 5_000_000;
  const aj = new McAutoJoin({ now: () => now });
  const ctxOf = (o = {}) => ({ bound: false, dialling: null, verifying: false, hasTrustKey: true, ...o });
  assert.deepEqual(aj.onFound('ws://10.0.0.9:8766/ws', 'mdns', ctxOf()), { do: 'verify' });
  assert.equal(aj.onVerifyFailed('ws://10.0.0.9:8766/ws', false), null, 'nothing to show for a host that never answered');
  now += 31000;
  assert.notEqual(aj.onFound('ws://10.0.0.9:8766/ws', 'mdns', ctxOf()).do, 'verify', 'not re-dialled after 30 s');
  now += VERIFY_COOLDOWN_MS;
  assert.deepEqual(aj.onFound('ws://10.0.0.9:8766/ws', 'mdns', ctxOf()), { do: 'verify' });
  const src = readFileSync(APP_JS, 'utf8');
  const j = src.indexOf('function onVerifyFailed(');
  assert.match(src.slice(j, src.indexOf('\n}\n', j)), /if \(reason\) offerMc\(url, source, reason\)/, 'a null reason puts up no row');
});

test('A60 polish #5: the remembered and the dialling url are not candidates; only other hosts count', () => {
  const aj = new McAutoJoin();
  const R = 'ws://192.168.1.10:8766/ws', X = 'ws://192.168.1.77:8766/ws';
  const base = { bound: false, dialling: R, verifying: false, hasTrustKey: false, remembered: R };
  assert.deepEqual(aj.onFound(R, 'mdns', base), { do: 'kick' });
  assert.deepEqual(aj.onFound(X, 'mdns', base), { do: 'offer', reason: 'new' }, 'the remembered MC does not make it "several"');
  assert.deepEqual(aj.onFound(R, 'mdns', { ...base, dialling: null }), { do: 'kick' }, 'the remembered url with nothing dialling is redialled, not proof-dialled');
  assert.deepEqual(aj.onFound(X, 'mdns', { ...base, hasTrustKey: true }), { do: 'verify' });
});

test('A60 polish #3: a dial the player named is never overridden inside its welcome window', () => {
  const aj = new McAutoJoin();
  const d = aj.onFound('ws://192.168.1.77:8766/ws', 'mdns', { bound: false, dialling: 'ws://192.168.9.9:8766/ws', verifying: false, hasTrustKey: true, userDialPending: true });
  assert.deepEqual(d, { do: 'ignore' });
  const src = readFileSync(APP_JS, 'utf8');
  assert.match(src, /userDial = join\.user === true \? \{ t: candidate \} : null;/);
  assert.match(src, /function userDialPending\(\) \{ return namedDialPending\(userDial, transport\); \}/, 'F346 (c): the window is the transport deadline');
  assert.match(src, /userDialPending: userDialPending\(\)/);
  for (const caller of ["connectMc(j.url, true, { pub: j.pub, secret: j.secret, user: true })", "connectMc(v, true, { user: true })",
                        "connectMc(join.url, true, { pub: join.pub, secret: join.secret, user: true })", "connectMc(d.url, false, { trusted: false, user: true })"]) {
    assert.ok(src.includes(caller), `the user-named caller is marked: ${caller}`);
  }
});

test('A60 polish #4: a proof dial never becomes RECONNECT MC\'s target', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('function connectMc(');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  const writes = [...body.matchAll(/lastMcUrl = [^\n]*/g)].map(m => m[0]);
  assert.deepEqual(writes, ['lastMcUrl = url;']);
  assert.match(body, /if \(join\.verify !== true && join\.firstContact !== true\) lastMcUrl = url;/, 'nor does a first-contact dial (F346 d)');
  assert.equal([...src.matchAll(/(?<!let )lastMcUrl = /g)].length, 1, 'no other writer');
});

test('A60 polish #6: the HUD row texts, exactly, with JOIN once', () => {
  assert.equal(offerText('new', 'ws://10.0.0.6:8766/ws'), 'NEW MISSION CONTROL · 10.0.0.6:8766 · TAP JOIN');
  assert.equal(offerText('several', 'ws://10.0.0.6:8766/ws'), 'SEVERAL MISSION CONTROLS · TAP YOURS');
  assert.equal(offerText('unproven', 'ws://10.0.0.6:8766/ws'), 'UNVERIFIED MISSION CONTROL · 10.0.0.6:8766 · TAP JOIN IF YOURS');
  for (const r of ['new', 'several', 'unproven']) assert.doesNotMatch(offerText(r, 'ws://1.2.3.4:1/ws'), /—/);
  const hud = readFileSync(path.resolve(HERE, '../src/hud/hud.js'), 'utf8');
  assert.match(hud, /const text = d\.text \? esc\(d\.text\) : /, 'the reason text is rendered verbatim');
  assert.match(hud, /<span class="unskew">\$\{text\}<\/span>/, 'with no second JOIN appended');
});

test('A60 polish #7: a key is kept only when this hello asked, and a proven key is never evicted', ctx => {
  const mc = new FakeMc();
  const { storage, nodeId } = enrolledPhone(ctx, mc);
  // (a) a verify dial (no mc_enroll) whose welcome also carries a key: the key is ignored
  const f = factory();
  const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9 });
  ctx.after(() => t.close());
  t.connect({ url: 'ws://192.168.7.20:8766/ws', verify: true }).catch(() => {});
  f.sockets[0].open();
  const w = mc.welcome(helloOf(f.sockets[0]), { enrol: false });
  w.body.mc_trust = { key: 'C'.repeat(43) };
  f.sockets[0].recv(w);
  assert.equal(t.state, 'bound');
  let held = JSON.parse(storage.getItem('brx.mc_trust'));
  assert.deepEqual(held.keys, [mc.keyFor(nodeId)], 'a key nobody asked for is not kept');
  assert.deepEqual(Object.keys(held.proven_at), [mc.keyFor(nodeId)], 'the key that proved an MC is recorded as proven');
  // (b) four more installs hand keys to user-named dials: the proven key survives, the oldest unproven goes
  const others = [new FakeMc(), new FakeMc(), new FakeMc(), new FakeMc()];
  for (const o of others) {
    const g = factory();
    const u = new Transport({ storage, wsFactory: g.wsFactory, heartbeatMs: 1e9 });
    u.connect({ url: 'ws://192.168.3.3:8766/ws', trusted: false }).catch(() => {});
    g.sockets[0].open(); g.sockets[0].recv(o.welcome(helloOf(g.sockets[0])));
    u.close();
  }
  held = JSON.parse(storage.getItem('brx.mc_trust'));
  assert.equal(held.keys.length, 4);
  assert.ok(held.keys.includes(mc.keyFor(nodeId)), 'the proven key was not evicted');
  assert.ok(!held.keys.includes(others[0].keyFor(nodeId)), 'the oldest unproven key went');
  assert.equal(held.keys[0], others[3].keyFor(nodeId), 'newest first');
});

test('A60 guard: app.js routes every discovery hit through autojoin.js and a failed proof back to the trusted MC', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('function suggestMc(');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.match(body, /autoJoin\.onFound\(url, source,/);
  const j = src.indexOf('function onVerifyFailed(');
  const fail = src.slice(j, src.indexOf('\n}\n', j));
  assert.match(fail, /if \(transport !== candidate\) return;/, 'a superseded proof dial changes nothing');
  assert.match(fail, /candidate\.close\(\)/);
  assert.match(fail, /if \(settings\.mcUrl\) connectMc\(settings\.mcUrl\)/, 'back to the MC we trust');
  assert.match(fail, /offerMc\(url, source, reason\)/, 'and the row says why');
  assert.doesNotMatch(fail, /settings\.mcUrl\s*=[^=]/, 'a failed proof never rewrites the remembered url');
});

test('A60 final #3: four proven keys and a new one: the key proven least recently goes, the newcomer stays', ctx => {
  const storage = memoryStorage();
  storage.setItem('brx.node_id', 'node-abc123');
  const keys = [0, 1, 2, 3].map(i => b64url(new Uint8Array(32).fill(i + 1)));
  // newest first; key[2] is the stalest proof, key[3] (the oldest held) proved most recently
  storage.setItem('brx.mc_trust', JSON.stringify({ node_id: 'node-abc123', keys,
    proven_at: { [keys[0]]: 4000, [keys[1]]: 3000, [keys[2]]: 1000, [keys[3]]: 5000 } }));
  const t = new Transport({ storage, wsFactory: () => new FakeWS('x') });
  ctx.after(() => t.close());
  const fresh = b64url(new Uint8Array(32).fill(9));
  t._storeTrustKey(fresh);
  const held = JSON.parse(storage.getItem('brx.mc_trust'));
  assert.deepEqual(held.keys, [fresh, keys[0], keys[1], keys[3]]);
  assert.ok(!(keys[2] in held.proven_at));
  // an unproven key goes before any proven one, oldest unproven first
  storage.setItem('brx.mc_trust', JSON.stringify({ node_id: 'node-abc123', keys, proven_at: { [keys[0]]: 1, [keys[3]]: 2 } }));
  t._storeTrustKey(fresh);
  assert.deepEqual(JSON.parse(storage.getItem('brx.mc_trust')).keys, [fresh, keys[0], keys[1], keys[3]], 'keys[2], the oldest unproven, went');
});

test('A60 final #4: expired cool-downs are pruned on every decision', () => {
  let now = 1_000;
  const aj = new McAutoJoin({ now: () => now });
  for (let i = 0; i < 50; i++) aj.onVerifyFailed(`ws://10.1.0.${i}:8766/ws`, i % 2 === 0);
  assert.equal(aj.cooldown.size, 50);
  now += VERIFY_COOLDOWN_MS + 1;
  aj.onFound('ws://10.9.9.9:8766/ws', 'mdns', { bound: true, dialling: null, verifying: false, hasTrustKey: true });
  assert.equal(aj.cooldown.size, 0, 'even a decision that ignores the hit prunes');
});

test('F346 (c): a named dial stays protected through a 4003 reclaim wait, until the armed deadline', async ctx => {
  const advance = useClock(ctx);
  const sockets = [];
  const t = new Transport({ storage: memoryStorage(), wsFactory: url => { const w = new FakeWS(url); sockets.push(w); return w; },
    gun: { name: 'Tactix-XXXX', tail: '3D4F' }, backoff: { baseMs: 1, capMs: 2, jitter: 0 }, reclaimRetryMs: 40, welcomeTimeoutMs: 30 });
  ctx.after(() => t.close());
  const dial = { t };
  assert.equal(namedDialPending(dial, t), false, 'no connect() yet, no window');
  t.connect({ url: 'ws://192.168.0.77:8766/ws', trusted: false }).catch(() => {});
  assert.equal(namedDialPending(dial, t), true);
  sockets[0].open(); sockets[0].close(4003, 'in use');       // the reclaim wait re-arms the deadline to 40 + 30
  await advance(35);
  assert.equal(namedDialPending(dial, t), true, 'past the 30 ms welcome timeout, still inside the reclaim wait');
  await advance(34);
  assert.equal(namedDialPending(dial, t), true, '1 ms before the armed deadline');
  await advance(1);
  assert.equal(namedDialPending(dial, t), false, 'the armed deadline passed');
  assert.equal(namedDialPending({ t: {} }, t), false, 'another transport is not this dial');
});

test('F346 (a): an enrolling hello carries one persisted nonce until the trust key arrives, then a fresh one', ctx => {
  const mc = new FakeMc();
  const storage = memoryStorage();
  const f = factory();
  const dial = (url = 'ws://192.168.1.10:8766/ws') => {
    const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9 });
    ctx.after(() => t.close());
    t.connect({ url, trusted: false }).catch(() => {});
    const ws = f.sockets[f.sockets.length - 1];
    ws.open();
    return { t, ws, hello: helloOf(ws) };
  };
  const a = dial();
  assert.ok(a.hello.mc_enroll === true && /^[A-Za-z0-9_-]{22,}$/.test(a.hello.mc_enroll_nonce), JSON.stringify(a.hello));
  a.t.close();                                           // the welcome was lost: no key arrived
  const rogue = dial('ws://192.168.1.66:8766/ws');       // inside the window the player names another host
  assert.ok(rogue.hello.mc_enroll_nonce && rogue.hello.mc_enroll_nonce !== a.hello.mc_enroll_nonce,
    'another host never receives the real MC\'s nonce: it gets one of its own');
  rogue.t.close();
  const b = dial();
  assert.equal(b.hello.mc_enroll_nonce, a.hello.mc_enroll_nonce, 'the SAME nonce, across a new Transport (persisted)');
  b.ws.recv(mc.welcome(b.hello));
  assert.ok(holdsTrustKey(storage));
  b.t.close();
  const c = dial();
  assert.ok(c.hello.mc_enroll_nonce && c.hello.mc_enroll_nonce !== a.hello.mc_enroll_nonce, 'a key arrived: the next enrol mints a new nonce');
  c.t.close();
  const u = new Transport({ storage: memoryStorage(), wsFactory: f.wsFactory, heartbeatMs: 1e9, node: { node_type: 'utility' }, keyPrefix: 'brxu' });
  ctx.after(() => u.close());
  u.connect({ url: 'ws://192.168.1.10:8766/ws', trusted: false }).catch(() => {});
  f.sockets[f.sockets.length - 1].open();
  const uh = helloOf(f.sockets[f.sockets.length - 1]);
  assert.ok(!('mc_enroll' in uh) && !('mc_enroll_nonce' in uh), 'a utility neither enrols nor sends a nonce');
});

// ---------------------------------------------------------------- F346 (d): auto-join on first contact
const FRESH = { bound: false, dialling: null, verifying: false, hasTrustKey: false, remembered: null, userDialPending: false };

test('F346 (d): a keyless phone with one MC in view waits out the discovery window, then joins; mDNS + sweep of one host is one MC', () => {
  let now = 9_000_000;
  const aj = new McAutoJoin({ now: () => now });
  const d0 = aj.onFound('ws://192.168.1.20:8766/ws', 'mdns', FRESH);
  assert.deepEqual(d0, { do: 'wait', ms: FIRST_CONTACT_SETTLE_MS }, 'the first packet never joins by itself');
  now += 1000;
  assert.deepEqual(aj.onFound('ws://192.168.1.20:8766/ws/', 'sweep', FRESH), { do: 'wait', ms: FIRST_CONTACT_SETTLE_MS - 1000 }, 'the window runs from the FIRST sighting');
  now += FIRST_CONTACT_SETTLE_MS;
  assert.deepEqual(aj.onFound('ws://192.168.1.20:8766/ws', 'mdns', FRESH), { do: 'join' });
  assert.deepEqual(aj.onFound('WS://192.168.1.20:8766/other', 'sweep', FRESH), { do: 'join' }, 'another path on the same host:port is the same MC');
  // an automatic dial in flight is never replaced
  assert.deepEqual(aj.onFound('ws://192.168.1.20:8766/ws', 'mdns', { ...FRESH, dialling: 'ws://192.168.1.20:8766/ws', verifying: true }), { do: 'ignore' });
  assert.deepEqual(aj.onFound('ws://192.168.1.21:8766/ws', 'mdns', { ...FRESH, dialling: 'ws://192.168.1.20:8766/ws', verifying: true }), { do: 'ignore' });
  // a dial the player named still wins
  assert.deepEqual(aj.onFound('ws://192.168.1.20:8766/ws', 'mdns', { ...FRESH, userDialPending: true }), { do: 'ignore' });
});

test('F346 (d): two MCs in the discovery window give the several row, never a join', () => {
  let now = 9_000_000;
  const aj = new McAutoJoin({ now: () => now });
  assert.equal(aj.onFound('ws://192.168.1.20:8766/ws', 'mdns', FRESH).do, 'wait');
  now += 500;
  assert.deepEqual(aj.onFound('ws://192.168.1.30:8766/ws', 'mdns', FRESH), { do: 'offer', reason: 'several' });
  now += FIRST_CONTACT_SETTLE_MS;
  assert.deepEqual(aj.onFound('ws://192.168.1.20:8766/ws', 'mdns', FRESH), { do: 'offer', reason: 'several' }, 'the settle re-check sees both');
  assert.equal(offerText('several', 'ws://192.168.1.20:8766/ws'), 'SEVERAL MISSION CONTROLS · TAP YOURS');
});

test('F346 (d): a first contact that got no welcome cools the host and asks with the NEW row', () => {
  let now = 9_000_000;
  const aj = new McAutoJoin({ now: () => now });
  aj.onFound('ws://192.168.1.20:8766/ws', 'sweep', FRESH);
  now += FIRST_CONTACT_SETTLE_MS;
  assert.equal(aj.onFound('ws://192.168.1.20:8766/ws', 'sweep', FRESH).do, 'join');
  assert.equal(aj.onFirstContactFailed('ws://192.168.1.20:8766/ws'), 'new');
  now += 60000;
  assert.deepEqual(aj.onFound('ws://192.168.1.20:8766/ws', 'sweep', FRESH), { do: 'offer', reason: 'new' }, 'not redialled inside the cool-down');
  now += VERIFY_COOLDOWN_MS;
  assert.equal(aj.onFound('ws://192.168.1.20:8766/ws', 'sweep', FRESH).do, 'wait', 'cool-down over and the old sighting expired: a new window');
  now += FIRST_CONTACT_SETTLE_MS;
  assert.equal(aj.onFound('ws://192.168.1.20:8766/ws', 'sweep', FRESH).do, 'join');
});

test('F346 (d): the first-contact hello is untrusted and enrols: no node_key, no secret, no prior_utility; the welcome binds and stores the key', ctx => {
  const mc = new FakeMc();
  const storage = memoryStorage();
  storage.setItem('brx.node_key', 'nk-old'); storage.setItem('brx.secret', 'sec-old');   // left over from an older MC
  const f = factory();
  const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9, gun: { name: 'Tactix-AB12', tail: 'AB12' },
                            priorUtility: { node_id: 'node-util1', node_key: 'uk-secret' } });
  ctx.after(() => t.close());
  assert.equal(holdsTrustKey(storage), false, 'a never-joined phone');
  const p = t.connect({ url: 'ws://192.168.1.20:8766/ws', trusted: false });
  f.sockets[0].open();
  const hello = helloOf(f.sockets[0]);
  for (const k of ['node_key', 'secret', 'prior_utility', 'mc_challenge']) assert.ok(!(k in hello), `the first-contact hello carried ${k}`);
  assert.equal(hello.mc_enroll, true);
  assert.match(hello.mc_enroll_nonce, /^[A-Za-z0-9_-]{22,}$/);
  f.sockets[0].recv(mc.welcome(hello, { node: NODE }));
  assert.equal(t.state, 'bound');
  assert.ok(f.sockets[0].sent.some(e => e.kind === 'bind'));
  assert.deepEqual(JSON.parse(storage.getItem('brx.mc_trust')).keys, [mc.keyFor(t.nodeId)], 'that MC is now the known MC');
  return settledOr(p).then(r => assert.ok(r.ok, 'connect() resolved'));
});

test('F346 (d): a phone keyed by one MC that first-contacts ANOTHER MC proof-dials it and shows UNVERIFIED', async ctx => {
  const mcA = new FakeMc(), mcB = new FakeMc();
  const { storage } = enrolledPhone(ctx, mcA);
  assert.ok(holdsTrustKey(storage));
  const aj = new McAutoJoin();
  const d = aj.onFound('ws://192.168.1.99:8766/ws', 'mdns', { ...FRESH, hasTrustKey: holdsTrustKey(storage), remembered: null });
  assert.deepEqual(d, { do: 'verify' }, 'a known phone never first-contacts: the other MC must prove itself');
  const f = factory();
  const t = new Transport({ storage, wsFactory: f.wsFactory, heartbeatMs: 1e9 });
  ctx.after(() => t.close());
  const p = t.connect({ url: 'ws://192.168.1.99:8766/ws', verify: true });
  f.sockets[0].open();
  const hello = helloOf(f.sockets[0]);
  for (const k of ['node_key', 'secret', 'prior_utility', 'mc_enroll', 'mc_enroll_nonce']) assert.ok(!(k in hello), `the proof hello carried ${k}`);
  f.sockets[0].recv(mcB.welcome(hello, { enrol: false, node: NODE }));   // B signs with its own install secret
  assert.notEqual(t.state, 'bound');
  assert.equal(t.verifyFailed, 'bad_proof');
  const r = await settledOr(p);
  assert.equal(r.err && r.err.code, 'mc_unproven');
  const reason = aj.onVerifyFailed('ws://192.168.1.99:8766/ws', true);
  assert.equal(offerText(reason, 'ws://192.168.1.99:8766/ws'), 'UNVERIFIED MISSION CONTROL · 192.168.1.99:8766 · TAP JOIN IF YOURS');
});

test('F346 (d) guard: app.js makes the first-contact dial untrusted, enrolling, and never RECONNECT MC\'s target', () => {
  const src = readFileSync(APP_JS, 'utf8');
  const i = src.indexOf('function suggestMc(');
  const body = src.slice(i, src.indexOf('\n}\n', i));
  assert.match(body, /hasTrustKey: holdsTrustKey\(\)/);
  assert.match(body, /remembered: settings\.mcUrl \|\| null/, 'a remembered address is never a first contact');
  assert.match(body, /if \(d\.do === 'join'\) \{[\s\S]*?connectMc\(url, false, \{ trusted: false, firstContact: true, source \}\);/);
  assert.match(body, /if \(d\.do === 'wait'\) \{[\s\S]*?setTimeout\(/, 'the window re-check');
  const c = src.indexOf('function connectMc(');
  const connect = src.slice(c, src.indexOf('\n}\n', c));
  assert.match(connect, /if \(join\.verify !== true && join\.firstContact !== true\) lastMcUrl = url;/);
  assert.match(connect, /if \(join\.firstContact === true\) \{ onFirstContactFailed\(/);
  const j = src.indexOf('function onFirstContactFailed(');
  const fail = src.slice(j, src.indexOf('\n}\n', j));
  assert.match(fail, /if \(transport !== candidate\) return;/);
  assert.match(fail, /offerMc\(url, source, autoJoin\.onFirstContactFailed\(url\)\)/);
  assert.doesNotMatch(fail, /settings\.mcUrl\s*=[^=]|lastMcUrl\s*=/);
});

// ---------------------------------------------------------------- F346 (d) polish r1: the utility proof is url-bound
const UTIL = { node_id: 'brxu-old', node_key: 'utility-key', mc_url: 'ws://192.168.1.10:8766/ws' };
const puOf = (f, i) => (helloOf(f.sockets[i]) || {}).prior_utility;
test('F346 (d) r1: prior_utility goes only to the MC url it came from, as {node_id,node_key}', ctx => {
  const f = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory: f.wsFactory, heartbeatMs: 1e9, priorUtility: UTIL });
  ctx.after(() => t.close());
  t.connect({ url: 'WS://192.168.1.10:8766/ws/' }).catch(() => {}); f.sockets[0].open();
  assert.deepEqual(puOf(f, 0), { node_id: 'brxu-old', node_key: 'utility-key' }, 'the same MC (cosmetic url difference), and no mc_url on the wire');
  t.connect({ url: 'ws://192.168.1.77:8766/ws' }).catch(() => {}); f.sockets[1].open();
  assert.equal(puOf(f, 1), undefined, 'a trusted dial to ANOTHER MC never gets it');
  const old = new Transport({ storage: memoryStorage(), wsFactory: f.wsFactory, heartbeatMs: 1e9, priorUtility: { node_id: 'brxu-old', node_key: 'utility-key' } });
  ctx.after(() => old.close());
  old.connect({ url: 'ws://192.168.1.10:8766/ws' }).catch(() => {}); f.sockets[2].open();
  assert.equal(puOf(f, 2), undefined, 'a handoff with no url goes nowhere');
});

test('F346 (d) r1: a first-contact host never gets prior_utility, not even after its welcome at the same url', ctx => {
  const mc = new FakeMc();
  const f = factory();
  const t = new Transport({ storage: memoryStorage(), wsFactory: f.wsFactory, heartbeatMs: 1e9, priorUtility: UTIL, backoff: { baseMs: 1, capMs: 1, jitter: 0 } });
  ctx.after(() => t.close());
  t.connect({ url: UTIL.mc_url, trusted: false, firstContact: true }).catch(() => {}); f.sockets[0].open();
  assert.equal(puOf(f, 0), undefined);
  f.sockets[0].recv(mc.welcome(helloOf(f.sockets[0])));
  assert.equal(t.state, 'bound');
  assert.equal(t.trusted, true);
  assert.equal(t._priorUtilityHello(), undefined, 'trusted now, but a first-contact session still withholds it');
});

test('F346 (d) r1 guard: BACK TO HUD stores the MC url with the utility proof; app.js tells the transport about first contact', () => {
  const u = readFileSync(path.resolve(HERE, '../src/utility.js'), 'utf8');
  assert.match(u, /JSON\.stringify\(\{ node_id: transport\.nodeId, node_key: transport\.nodeKey, mc_url: transport\.url \}\)/);
  const src = readFileSync(APP_JS, 'utf8');
  assert.match(src, /transport\.connect\(\{ url, pub: join\.pub, secret: join\.secret, trusted: join\.trusted !== false, verify, firstContact: join\.firstContact === true \}\)/);
});

test('F346 (d) r1: a first contact that fails after discovery saw a second host gives SEVERAL, not NEW', () => {
  let now = 9_000_000;
  const aj = new McAutoJoin({ now: () => now });
  aj.onFound('ws://192.168.1.20:8766/ws', 'mdns', FRESH);
  now += FIRST_CONTACT_SETTLE_MS;
  assert.equal(aj.onFound('ws://192.168.1.20:8766/ws', 'mdns', FRESH).do, 'join');
  const dialling = { ...FRESH, dialling: 'ws://192.168.1.20:8766/ws', verifying: true };
  assert.deepEqual(aj.onFound('ws://192.168.1.30:8766/ws', 'mdns', dialling), { do: 'ignore' }, 'seen during the dial');
  assert.equal(aj.onFirstContactFailed('ws://192.168.1.20:8766/ws'), 'several');
  const src = readFileSync(APP_JS, 'utf8');
  assert.match(src, /offerMc\(url, source, autoJoin\.onFirstContactFailed\(url\)\)/, 'app.js shows the row the policy returns');
});
