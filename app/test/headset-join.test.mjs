// F293 (bench 2026-09-24): with the app open while the gun and headset power-cycle, the phone relinked before the
// headset had joined the gun, and the gun then dropped the phone every 6-10 s in a loop. The app sent only `$PHONE`
// after a relink, so it never learned the headset state, and it cleared the headset warnings on a 30 s timer.
// Now every connect is a short probe (`$STOP` first only where the engine's own first-connect probe would send it,
// then `$PHONE`, `$VERSION`) and `$VERSION` token 2 decides: `hds.N` links as before; `?` (or no reply) waits for
// the headset. These tests run on the mocked clock with a fake plugin, as brxlink.test.mjs does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textToDataView, dataViewToText } from '@capacitor-community/bluetooth-le';
// A namespace import, so each test fails on its own line before the change (a missing named export fails the file).
import * as L from '../src/brxlink.js';
const { BrxLink } = L;
const HEADSET_SETTLE_MS = L.HEADSET_SETTLE_MS ?? 15000, HEADSET_JOIN_CAP_MS = L.HEADSET_JOIN_CAP_MS ?? 60000, VERSION_REPLY_MS = L.VERSION_REPLY_MS ?? 2000;
import { Engine, PROBE_FW } from '../src/engine.js';
import { Hud, connectingText } from '../src/hud/hud.js';
import { readFileSync } from 'node:fs';

function useClock(ctx) {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_700_000_000_000 });
  return async (ms = 1300, step = 1) => {
    for (let i = 0; i < ms; i += step) { ctx.mock.timers.tick(step); await new Promise(r => setImmediate(r)); }
  };
}

/** A gun whose `$VERSION` reply carries `r.headset` as token 2 (`?` or `hds.59`), or no reply when `r.reply` is false. */
function hsRig(ctx, opts = {}) {
  const r = { attempts: 0, cb: null, notify: null, writes: [], disconnects: 0, ups: [], drops: 0, flaps: [], heads: [], log: [], headset: 'hds.59', reply: true, queue: [], frames: [] };
  const ble = {
    initialize: async () => {},
    connect: async (id, c) => { r.attempts++; r.cb = c; },
    disconnect: async () => { r.disconnects++; const c = r.cb; if (c) c(); },   // the real plugin fires the drop callback too
    startNotifications: async (id, s, ch, cb) => { r.notify = cb; },
    writeWithoutResponse: async (id, s, ch, dv) => {
      const f = dataViewToText(dv); r.writes.push(f);
      if (f === '$VERSION,*' && r.reply) { const hs = r.queue.length ? r.queue.shift() : r.headset, n = r.notify; setTimeout(() => n && n(textToDataView(`$VERSION,v4.32,${hs},4,,devhost.03,*`)), 30); }
    },
  };
  r.link = new BrxLink({ ble, headsetProbe: true, log: m => r.log.push(m), onFrame: f => r.frames.push(f), onUp: (a, p) => r.ups.push(p), onDrop: () => r.drops++,
    onFlap: f => r.flaps.push(f), onHeadset: h => r.heads.push(h), ...opts });
  ctx.after(() => r.link.disconnect());
  return r;
}
/** Steps the clock until the attempt count moves; returns how many ms that took (-1 at the cap). */
async function msUntilAttempt(r, settle, cap = 40000, step = 10) {
  const before = r.attempts;
  for (let ms = step; ms <= cap; ms += step) { await settle(step, step); if (r.attempts > before) return ms; }
  return -1;
}

test('F293 constants: disconnect mode by default, 15 s settle, 2 s poll, 60 s cap, a named $VERSION timeout', () => {
  assert.equal(L.HEADSET_JOIN_MODE, 'disconnect');
  assert.equal(L.HEADSET_SETTLE_MS, 15000);
  assert.equal(L.HEADSET_POLL_MS, 2000);
  assert.equal(L.HEADSET_JOIN_CAP_MS, 60000);
  assert.ok(L.VERSION_REPLY_MS > 0 && L.VERSION_REPLY_MS <= 3000);
  const { headsetLinked } = L;
  assert.equal(headsetLinked('$VERSION,v4.32,hds.59,4,,devhost.03,*'), true);
  assert.equal(headsetLinked('$VERSION,v4.32,?,4,,devhost.03,*'), false);
  assert.equal(headsetLinked('$VERSION,*'), null, 'an echo of the query is not a reply');
  assert.equal(headsetLinked('$PONG,*'), null);
});

test('F293: a relink whose $VERSION reads ? disconnects, counts no flap, and waits 15 s (not 5 s or 30 s)', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  assert.equal(r.ups.length, 1, 'the first connect with the headset joined links');
  r.headset = '?';
  r.cb(); await settle(400);                         // the gun drops the phone (power-cycle); the relink reads `?`
  assert.equal(r.disconnects, 1, 'a ? probe releases the link at once');
  assert.equal(r.ups.length, 1, 'a ? probe never tells the app the gun is up');
  assert.equal(r.link.flapping, null, 'a ? probe is not a flap');
  assert.equal(r.link._flapStreak, 0, 'the flap streak is not counted');
  assert.equal(r.link.headsetJoin.state, 'joining');
  const ms = await msUntilAttempt(r, settle);
  assert.ok(ms >= HEADSET_SETTLE_MS - 500 && ms <= HEADSET_SETTLE_MS + 100, `the next try came after ${ms} ms, want about ${HEADSET_SETTLE_MS}`);
});

test('F293: hds.N keeps today\'s behaviour: the probe links, and quick drops still count as flaps', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  assert.deepEqual(r.writes, ['$STOP,*', '$PHONE,*', '$VERSION,*'], 'the first connect keeps the probe order');
  assert.equal(r.ups.length, 1);
  assert.equal(r.ups[0].probed, true); assert.equal(r.ups[0].headset, 'hds.59'); assert.equal(r.ups[0].fw, 'v4.32');
  assert.equal(r.link.headsetJoin.state, 'joined');
  r.cb(); await settle(400);                         // flap 1: reconnect at once, probe hds, up again
  assert.equal(r.ups.length, 2);
  r.cb(); await settle(50);                          // flap 2: today's 5 s back-off
  assert.equal(r.link.flapping.count, 2, 'a drop with the headset joined is a flap, as today');
  assert.equal(r.disconnects, 0);
});

test('F293: the engine is never told "connected" on a ? probe', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  r.headset = '?';
  const up = r.link.connect('A', 'GUN-A-3D4F');
  await settle(40000, 10);
  assert.equal(r.ups.length, 0, 'onUp ran on a link the gun was about to drop');
  assert.equal(r.link.connected, false);
  assert.ok(r.attempts >= 3, 'the phone keeps trying every settle period');
  r.headset = 'hds.59';
  await settle(16000, 10); await up;
  assert.equal(r.ups.length, 1, 'the first hds.N reading links');
});

test('F293: the headset warnings clear on the first hds.N reading, not on the 30 s hold timer', async ctx => {
  const settle = useClock(ctx);
  const eng = new Engine({ writer: () => true, emit: () => {}, report: () => {}, now: () => Date.now(), synced: () => true, storage: null, log: () => {} });
  const r = hsRig(ctx, { onFlap: f => eng.setGunFlapping(f), onHeadset: h => eng.setHeadsetJoin(h), onUp: (a, p) => eng.onBleConnected(a, p) });
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  r.cb(); await settle(400); r.cb(); await settle(50);   // two quick drops: HEADSET OFF? shows
  assert.equal(eng.state().gunFlapping.count, 2);
  await settle(5500, 10);                             // the back-off runs out, the relink reads hds.N
  assert.equal(r.link.connected, true);
  assert.equal(eng.state().gunFlapping, null, 'the warning must clear on the hds.N reading, not 30 s later');
  assert.equal(eng.state().headsetJoin.state, 'joined');
});

test('F293: the 60 s cap reaches not_joined and makes no further automatic tries', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  r.headset = '?';
  const up = r.link.connect('A', 'GUN-A-3D4F');
  await settle(HEADSET_JOIN_CAP_MS + 2000, 10);
  assert.equal(await up, false, 'the picker connect ends when the cap is reached');
  assert.equal(r.link.headsetJoin.state, 'not_joined');
  assert.equal(r.heads.at(-1).state, 'not_joined', 'the app hears it');
  const n = r.attempts;
  await settle(120000, 50);
  assert.equal(r.attempts, n, 'no automatic try after not_joined');
  assert.equal(r.ups.length, 0);
});

test('F293: a manual RECONNECT NOW overrides the wait, clears the cap and starts the cycle again', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  r.headset = '?';
  r.link.connect('A', 'GUN-A-3D4F');
  await settle(1000, 10);                             // first ? read: now in the 15 s settle wait
  let n = r.attempts;
  r.link.retryNow(); await settle(200, 10);
  assert.equal(r.attempts, n + 1, 'the tap tries at once, not after the settle wait');
  await settle(HEADSET_JOIN_CAP_MS + 2000, 10);
  assert.equal(r.link.headsetJoin.state, 'not_joined');
  n = r.attempts;
  r.headset = 'hds.59';
  r.link.retryNow(); await settle(300, 10);
  assert.equal(r.attempts, n + 1, 'the tap tries again after not_joined');
  assert.equal(r.ups.length, 1);
  assert.equal(r.link.headsetJoin.state, 'joined');
});

test('F293: RECONNECT NOW after not_joined restarts the 60 s cap from the tap', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  r.headset = '?';
  r.link.connect('A', 'GUN-A-3D4F');
  await settle(HEADSET_JOIN_CAP_MS + 2000, 10);
  assert.equal(r.link.headsetJoin.state, 'not_joined');
  r.link.retryNow(); await settle(1000, 10);
  assert.equal(r.link.headsetJoin.state, 'joining', 'a fresh cycle, not straight back to not_joined');
  await settle(HEADSET_JOIN_CAP_MS - 5000, 10);
  assert.equal(r.link.headsetJoin.state, 'joining', 'the cap counts from the tap');
});

test('F293 hold mode: keeps the link, polls $VERSION every 2 s, counts no flap, links on hds.N', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx, { headsetJoinMode: 'hold' });
  r.headset = '?';
  r.link.connect('A', 'GUN-A-3D4F');
  await settle(500, 10);
  const v0 = r.writes.filter(f => f === '$VERSION,*').length;
  await settle(6000, 10);
  const polls = r.writes.filter(f => f === '$VERSION,*').length - v0;
  assert.ok(polls >= 2 && polls <= 4, `${polls} polls in 6 s, want about 3`);
  assert.equal(r.disconnects, 0, 'hold mode keeps the link');
  assert.equal(r.ups.length, 0, 'the engine is not told while the headset reads ?');
  r.cb(); await settle(3000, 10);                     // the gun drops the phone while the headset joins
  assert.equal(r.link.flapping, null, 'a drop while ? is not a flap');
  assert.equal(r.drops, 0, 'no drop path for a link the app never had');
  r.headset = 'hds.59';
  await settle(3000, 10);
  assert.equal(r.ups.length, 1);
  assert.equal(r.link.headsetJoin.state, 'joined');
});

test('F293 hold mode: the 60 s cap releases the link and stops', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx, { headsetJoinMode: 'hold' });
  r.headset = '?';
  const up = r.link.connect('A', 'GUN-A-3D4F');
  await settle(HEADSET_JOIN_CAP_MS + 3000, 10);
  assert.equal(await up, false);
  assert.equal(r.link.headsetJoin.state, 'not_joined');
  assert.equal(r.disconnects, 1, 'the held link is released at the cap');
});

test('F293: a missing $VERSION reply times out and counts as ?', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  r.reply = false;
  r.link.connect('A', 'GUN-A-3D4F');
  await settle(VERSION_REPLY_MS + 500, 10);
  assert.equal(r.ups.length, 0);
  assert.equal(r.disconnects, 1, 'no reply: the link is released, not held forever');
  assert.equal(r.link.headsetJoin.state, 'joining');
  r.reply = true;
  await settle(HEADSET_SETTLE_MS + 1000, 10);
  assert.equal(r.ups.length, 1, 'the next try reads hds.N and links');
});

test('F293 engine: a probed link sends no duplicate probe and takes the firmware from it', () => {
  const writes = [];
  const eng = new Engine({ writer: fr => { writes.push(...fr); return true; }, emit: () => {}, report: () => {}, now: () => 1e6, synced: () => true, storage: null, log: () => {} });
  assert.deepEqual(eng.linkProbeFrames(), PROBE_FW, 'a first connect keeps the engine\'s probe order');
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }, { probed: true, frames: [...PROBE_FW], fw: 'v4.32', headset: 'hds.59' });
  assert.deepEqual(writes, [], 'the link already sent the probe');
  assert.equal(eng.fw, 'v4.32');
  assert.deepEqual(eng.linkProbeFrames(), ['$PHONE,*', '$VERSION,*'], 'a relink never sends $STOP (it disarms IR reception)');
  eng.onBleDropped();
  eng.onBleConnected(undefined, { probed: true, frames: ['$PHONE,*', '$VERSION,*'] });
  assert.ok(!writes.includes('$PHONE,*'), 'no second $PHONE on a probed relink');
});

test('F293 engine: headsetJoin is on the state, and joined clears the flap warning', () => {
  const eng = new Engine({ writer: () => true, emit: () => {}, report: () => {}, now: () => 1e6, synced: () => true, storage: null, log: () => {} });
  assert.equal(eng.state().headsetJoin, null);
  eng.setGunFlapping({ count: 3, next_retry_at: 5, quiet: true });
  eng.setHeadsetJoin({ state: 'joining', since: 10 });
  assert.deepEqual(eng.state().headsetJoin, { state: 'joining', since: 10 });
  eng.setHeadsetJoin({ state: 'joined', since: 20 });
  assert.equal(eng.state().gunFlapping, null);
});

// ---- polish round 1 (2026-09-24) ----

test('F293 H1: a link that comes up starts the MC link when none runs (a first pick can end at the cap)', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const i = src.search(/onUp: \(advert, probe\) =>/); assert.ok(i > 0, 'the onUp wiring moved -- fix this guard');
  assert.match(src.slice(i, i + 1400), /if \(settings\.mcUrl && !transport\) connectMc\(settings\.mcUrl\)/, 'onUp must start the MC link');
  const j = src.indexOf('const up = await link.connect(deviceId'); assert.ok(j > 0);
  assert.match(src.slice(j, j + 500), /link\.deviceId === deviceId/, 'a pick parked at the cap still counts as the gun chosen');
});

test('F293 M1: a picker pick during a reconnect probe is not undone by the stale probe', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  r.reply = false;                                   // the reconnect probe waits for a reply that never comes
  r.cb(); await settle(200);
  assert.equal(r.link.connected, false);
  r.reply = true;
  const pick = r.link.connect('A', 'GUN-A-3D4F'); await settle(400); await pick;
  assert.equal(r.link.connected, true, 'the pick links');
  const d = r.disconnects;
  await settle(4000, 10);                            // the stale probe's timer runs out
  assert.equal(r.disconnects, d, 'the stale probe released the new link to the same gun');
  assert.equal(r.link.connected, true);
  assert.equal(r.link._probing, 0, 'no probe owns the link');
  r.notify(textToDataView('$BUT,0,1,*')); await settle(5);
  assert.ok(r.frames.includes('$BUT,0,1,*'), 'frames reach the engine after the link is up');
});

test('F293 M2: a relink in live reads $VERSION once more before it releases the link', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx, { unbounded: () => true });
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  r.queue = ['?', 'hds.59'];                          // a false ? on the first read
  r.cb(); await settle(600);
  assert.equal(r.ups.length, 2, 'the second read saw hds.N and linked');
  assert.equal(r.disconnects, 0, 'one false ? must not cost 15 s with the gun down mid-match');
});

test('F293 M2: in live the 60 s cap shows not_joined but keeps trying, and the gun comes back by itself', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx, { unbounded: () => true });
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  r.headset = '?';
  r.cb();
  await settle(HEADSET_JOIN_CAP_MS + 2000, 10);
  assert.equal(r.link.headsetJoin.state, 'not_joined');
  const n = r.attempts;
  await settle(HEADSET_SETTLE_MS + 1000, 10);
  assert.ok(r.attempts > n, 'mid-match the phone keeps trying after the cap');
  assert.ok(r.attempts < n + 3, 'at the settle pace, not a tight loop');
  assert.equal(r.link.headsetJoin.state, 'not_joined', 'the line does not flip back to joining');
  r.headset = 'hds.59';
  await settle(HEADSET_SETTLE_MS + 1000, 10);
  assert.equal(r.link.connected, true);
});

test('F293 M2: the $VERSION reply timer starts when the probe write starts, not before the queue', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  r.link.write(Array.from({ length: 120 }, () => '$VOL,65,0,*'), 'a long engine write');   // about 2.2 s of queue
  r.cb(); await settle(4000, 10);
  assert.equal(r.link.connected, true, 'a queued probe timed out before it was sent');
  assert.equal(r.disconnects, 0);
});

test('F293 lows: engine writes are refused while a probe owns the link', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  r.reply = false; r.cb(); await settle(100);
  const w = r.link.write(['$HLED,1,*'], 'engine'); await settle(200);
  assert.equal(await w, false);
  assert.ok(!r.writes.includes('$HLED,1,*'));
});

test('F293 lows: a drop that lands as the probe reads hds.N is not claimed as up', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  r.link.connect('A', 'GUN-A-3D4F');
  for (let i = 0; i < 400 && !r.link._versionWait; i++) await settle(1);
  const c = r.cb, n = r.notify;
  n(textToDataView('$VERSION,v4.32,hds.59,4,,devhost.03,*')); c();   // the reply and the drop in one delivery
  await settle(5);
  assert.equal(r.ups.length, 0, 'onUp ran for a link that had already dropped');
});

test('F293 M3: the picker says the headset is joining, then not joined', () => {
  assert.deepEqual(connectingText({ name: 'GUN-A-3D4F', attempt: 1, of: 5, headset: 'joining' }),
    { head: 'Connecting to GUN-A-3D4F…', line: 'Headset joining the gun, about 15 s' });
  assert.deepEqual(connectingText({ name: 'GUN-A-3D4F', failed: true, headset: 'not_joined' }),
    { head: 'Headset not joined to GUN-A-3D4F', line: 'Power-cycle the headset, then tap Scan again.' });
});

test('F293 lows: the down screen has a short not-joined line; the joining pill has RECONNECT NOW', () => {
  const chips = st => { const fake = { chips: { innerHTML: '' }, mcPill: false, _atCapMinusOne: () => false }; Hud.prototype._chips.call(fake, { wsState: 'bound', ...st }); return fake.chips.innerHTML; };
  const down = chips({ phase: 'live', alive: false, bleUp: false, headsetJoin: { state: 'not_joined' } });
  assert.match(down, />HEADSET NOT JOINED</); assert.doesNotMatch(down, /· POWER-CYCLE/);
  const joining = chips({ phase: 'kitted', alive: true, bleUp: false, headsetJoin: { state: 'joining' } });
  assert.match(joining, /HEADSET JOINING/); assert.match(joining, /onReconnectNow/);
});

// ---- polish round 2 (2026-09-24) ----

test('F293 round 2: a stalled write queue is logged as stalled, not counted as a ? reading', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx);
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  r.link._q = new Promise(() => {});                 // a write ahead of the probe never finishes
  r.cb(); await settle(VERSION_REPLY_MS + 10500, 10);
  assert.ok(r.log.some(m => /stalled write queue/.test(m)), 'the log must name a stalled write queue');
  assert.ok(!r.log.some(m => /no \$VERSION reply/.test(m)), 'a stall is not a missing reply');
  assert.equal(r.link._hsSince, 0, 'a stall starts no headset cap');
  assert.notEqual(r.link.headsetJoin.state, 'joining');
});

test('F293 round 2: openPicker ends a background reconnect loop that is between dials', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const i = src.indexOf('async function openPicker'); assert.ok(i > 0);
  assert.match(src.slice(i, i + 1600), /if \(link\.connecting \|\| link\._reconnecting\)/);
});

test('F293 round 2: a RELINK in live hands over to the reconnect loop once the cap has passed', async ctx => {
  const settle = useClock(ctx);
  const r = hsRig(ctx, { unbounded: () => true });
  const up = r.link.connect('A', 'GUN-A-3D4F'); await settle(300); await up;
  r.headset = '?';
  const rl = r.link.relink();
  await settle(HEADSET_JOIN_CAP_MS + HEADSET_SETTLE_MS + 2000, 10);
  assert.equal(r.link.relinking, false, 'RELINK GUN stays disabled for the whole outage');
  assert.equal(await rl, false);
  const n = r.attempts;
  await settle(HEADSET_SETTLE_MS + 1000, 10);
  assert.ok(r.attempts > n, 'the reconnect loop keeps trying');
});

test('F293 round 2: the settle wait is never shorter than the poll interval at the cap edge', async ctx => {
  const settle = useClock(ctx);
  const at = [];
  const r = hsRig(ctx, { headsetJoinCapMs: 15500 });
  const conn = r.link.ble.connect; r.link.ble.connect = async (...a) => { at.push(Date.now()); return conn(...a); };
  r.headset = '?';
  r.link.connect('A', 'GUN-A-3D4F');
  await settle(20000, 10);
  const gaps = at.slice(1).map((t, k) => t - at[k]);
  assert.ok(gaps.length >= 2, JSON.stringify(gaps));
  assert.ok(gaps.every(g => g >= 2000), 'a redial at once at the cap edge: ' + JSON.stringify(gaps));
});
