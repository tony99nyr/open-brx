// A56 / S58 powerups, the claim (Tony 2026-09-24, via the brx5 lead): a player takes an item by STANDING about a
// foot from the station for 1 s, no button. The phone measures range with the median of the last three RSSI
// samples, advertises `claiming` / `claim_ready` with the station id in `value`, and the STATION picks the winner
// and names it in byte 15 (`taker`). Pure parts only: the advert codec, the median, and the station's decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, decodeUuid, Presence, PLAYER_STATE, medianOf } from '../src/beacon.js';
import { PowerupStation, CLAIM_MIN_RSSI, stationItemAdvert } from '../src/powerup.js';

const ROCKETS = { kind: 'weapon', weapon_id: 'rocket_launcher', charges: 2, spawn_every_s: 120, first_at_s: 120, name: 'ROCKETS', color: '#ff7a1a' };
const READY = PLAYER_STATE.alive | PLAYER_STATE.claiming | PLAYER_STATE.claim_ready;
const CLAIMING = PLAYER_STATE.alive | PLAYER_STATE.claiming;
const player = (id, state, value, raw = -50, ageMs = 0) => ({ role: 'player', id, kind: null, team: 1, state, value, raw, rssi: raw, ageMs });

test('byte 15 round-trips as `taker` (0 = none), and a player advert carries the two claim bits', () => {
  const u = encodeUuid({ role: 'station', id: 4, kind: 'powerup', state: 0, value: 42, taker: 19 });
  assert.equal(decodeUuid(u).taker, 19);
  assert.equal(u.replace(/-/g, '').slice(30, 32), '13', 'byte 15 is the last byte');
  assert.equal(decodeUuid(encodeUuid({ role: 'station', id: 4, kind: 'powerup' })).taker, 0, 'absent = 0, none');
  assert.equal(PLAYER_STATE.claiming, 16); assert.equal(PLAYER_STATE.claim_ready, 32);
  const p = decodeUuid(encodeUuid({ role: 'player', id: 7, state: READY, value: 4 }));
  assert.equal(p.state & PLAYER_STATE.claim_ready, 32); assert.equal(p.value, 4);
});

test('the median of the last three samples ignores one wild reading; the EMA the respawn path uses is unchanged', () => {
  assert.equal(medianOf([-50, -20, -51]), -50);
  assert.equal(medianOf([-50]), -50);
  const pr = new Presence({ alpha: 0.35 });
  const u = encodeUuid({ role: 'station', id: 4, kind: 'powerup', state: 1 });
  pr.observe([u], -50, 0); pr.observe([u], -50, 100);
  const e = pr.observe([u], -20, 200);   // one wild sample, as a body shifting in front of the phone produces
  assert.equal(e.median, -50, 'one wild sample does not move the median');
  assert.equal(e.rssi, -50 + 0.35 * (-20 - -50), 'the EMA still took the sample, exactly as before');
  pr.observe([u], -20, 300);
  assert.equal(e.median, -20, 'two in three is the new reading');
});

test('station: before MC has said anything it advertises the unknown pair (state 0, value 0, no taker)', () => {
  const s = new PowerupStation({ id: 4, item: ROCKETS });
  assert.deepEqual(s.advert(0), { state: 0, value: 0, taker: 0 });
});

test('station: station_update re-anchors the countdown, and the station self-spawns at 0, then every spawn_every_s', () => {
  const s = new PowerupStation({ id: 4, item: ROCKETS });
  s.update({ available: false, next_spawn_in_ms: 60_000 }, 1000);
  assert.deepEqual(s.advert(1000), { state: 0, value: 60, taker: 0 });
  assert.deepEqual(s.advert(31_000), { state: 0, value: 30, taker: 0 });
  const r = s.tick([], 61_000);
  assert.ok(r.events.some(e => e.type === 'spawned'));
  assert.deepEqual(s.advert(61_000), { state: 1, value: 0, taker: 0 });
  assert.equal(s.nextAt, 61_000 + 120_000, 'the next spawn instant is one interval on');
  s.update({ available: false, next_spawn_in_ms: 400_000 }, 70_000);
  assert.equal(s.advert(70_000).value, 255, 'the countdown byte caps at 255');
});

test('station: the first claim_ready advert for its own id wins while the item is there; it advertises TAKEN with the taker', () => {
  const s = new PowerupStation({ id: 4, item: ROCKETS });
  s.update({ available: true, next_spawn_in_ms: 120_000 }, 0);
  let r = s.tick([player(7, CLAIMING, 4)], 100);
  assert.equal(s.available, true, 'claiming alone takes nothing');
  r = s.tick([player(7, READY, 4)], 1200);
  assert.deepEqual(r.events.filter(e => e.type === 'taken'), [{ type: 'taken', player_num: 7 }]);
  assert.deepEqual(s.advert(1200), { state: 0, value: 119, taker: 7 });
  r = s.tick([player(19, READY, 4)], 1500);
  assert.equal(s.taker, 7, 'a later ready claim does not steal a taken item');
  s.tick([], 120_000);
  assert.deepEqual(s.advert(120_000), { state: 1, value: 0, taker: 0 }, 'the next spawn clears the taker');
});

test('station: a tie inside one batch goes to the lower player_num', () => {
  const s = new PowerupStation({ id: 4, item: ROCKETS });
  s.update({ available: true, next_spawn_in_ms: 120_000 }, 0);
  s.tick([player(19, READY, 4), player(7, READY, 4), player(12, READY, 4)], 1000);
  assert.equal(s.taker, 7);
});

test('station: a claim heard below -80 dBm, a claim for another station and a stale advert are all ignored', () => {
  assert.equal(CLAIM_MIN_RSSI, -80);
  const s = new PowerupStation({ id: 4, item: ROCKETS });
  s.update({ available: true, next_spawn_in_ms: 120_000 }, 0);
  s.tick([player(7, READY, 4, -81)], 1000);
  assert.equal(s.available, true, 'below -80: ignored');
  s.tick([player(7, READY, 5)], 1100);
  assert.equal(s.available, true, 'another station id: ignored');
  s.tick([player(7, READY, 4, -50, 5000)], 1200);
  assert.equal(s.available, true, 'a stale advert: ignored');
  s.tick([player(7, READY, 4, -80)], 1300);
  assert.equal(s.taker, 7, 'CONTROL: at -80 it counts');
});

test('station: nothing is taken while the item is not there, and the screen ring starts at the first claiming advert', () => {
  const s = new PowerupStation({ id: 4, item: ROCKETS });
  s.update({ available: false, next_spawn_in_ms: 50_000 }, 0);
  s.tick([player(7, READY, 4)], 1000);
  assert.equal(s.taker, 0);
  assert.equal(s.view(1000).ringAt, null, 'no ring for an item that is not there');
  s.update({ available: true, next_spawn_in_ms: 120_000 }, 2000);
  s.tick([player(7, CLAIMING, 4)], 2100);
  assert.equal(s.view(2100).ringAt, 2100);
  s.tick([player(7, CLAIMING, 4)], 2600);
  assert.equal(s.view(2600).ringAt, 2100, 'the ring runs from the FIRST claiming advert');
  s.tick([], 2700);
  assert.equal(s.view(2700).ringAt, null, 'nobody claiming: the ring goes');
});

test('stationItemAdvert: the advert triple a powerup station publishes', () => {
  assert.deepEqual(stationItemAdvert({ available: null }, 0), { state: 0, value: 0, taker: 0 });
});

test('the player advert while claiming: the claim bits, the station id in value, and the low-latency mode', async () => {
  const { playerClaimAdvert } = await import('../src/powerup.js');
  assert.deepEqual(playerClaimAdvert(null), { bits: 0, value: 0, mode: 'balanced' });
  assert.deepEqual(playerClaimAdvert({ station: 4, claiming: true, ready: false }), { bits: 16, value: 4, mode: 'lowLatency' });
  assert.deepEqual(playerClaimAdvert({ station: 4, claiming: true, ready: true }), { bits: 48, value: 4, mode: 'lowLatency' });
});

test('M1: MC cannot re-open the spawn the station already gave away (its taken report was lost)', () => {
  const s = new PowerupStation({ id: 4, item: ROCKETS });
  s.update({ available: true, next_spawn_in_ms: 100_000 }, 0);   // next spawn instant: 100 000
  s.tick([player(7, READY, 4)], 1000);
  assert.equal(s.taker, 7);
  // MC never heard `taken`: a reconnect re-send says available, with the SAME next spawn instant
  s.update({ available: true, next_spawn_in_ms: 89_000 }, 11_000);
  assert.equal(s.available, false, 'refused: that spawn was awarded');
  assert.equal(s.taker, 7);
  // a LATER spawn instant (about one interval on) is a new item: accepted
  s.update({ available: true, next_spawn_in_ms: 119_000 }, 101_000);
  assert.equal(s.available, true); assert.equal(s.taker, 0);
});

test('an operator reset (`reset: true`) re-opens the awarded spawn at once; the fixed next spawn stays', () => {
  const s = new PowerupStation({ id: 4, item: ROCKETS });
  s.update({ available: true, next_spawn_in_ms: 100_000 }, 0);
  s.tick([player(7, READY, 4)], 1000);
  s.update({ available: true, next_spawn_in_ms: 89_000, reset: true }, 11_000);
  assert.equal(s.available, true, 'a reset is accepted for the awarded spawn');
  assert.equal(s.taker, 0);
  assert.equal(s.nextAt, 100_000, 'the fixed spawn time does not move');
});

test('M1: an unsent `taken` report waits in the queue and goes out on re-bind', () => {
  const s = new PowerupStation({ id: 4, item: ROCKETS });
  s.update({ available: true, next_spawn_in_ms: 100_000 }, 0);
  s.tick([player(7, READY, 4)], 1000);
  assert.deepEqual(s.unsent, [{ id: 4, action: 'taken', player_num: 7, t: 1000 }]);
  let sent = [];
  assert.equal(s.drain(() => false), 0, 'MC not bound: nothing leaves the queue');
  assert.equal(s.unsent.length, 1);
  assert.equal(s.drain(b => { sent.push(b); return true; }, 31_000), 1);
  // age_ms (polish r2): how long ago the award was, so MC can date it without a synced clock
  assert.deepEqual(sent, [{ id: 4, action: 'taken', player_num: 7, t: 1000, age_ms: 30_000 }]);
  assert.deepEqual(s.unsent, []);
  assert.deepEqual(new PowerupStation({ id: 4, item: ROCKETS }).restore({ ...s.snapshot(), unsent: [{ id: 4, action: 'taken', player_num: 7, t: 1 }] }).unsent.length, 1, 'the queue survives a station restart');
});
