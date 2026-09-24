// station-respawn.test.mjs — a respawn station counts the revives that happen at it (F344), and reaches 3 m (F345).
// Field 2026-09-24: a phone respawn station reported revives 0 for two revives at it. The player's phone judged
// "at the station" on the station's HIGH-TX advert; the station judged the player on the player's MEDIUM-TX
// advert, about 8 dB weaker, against the same threshold, with its own 0.8 s dwell. The player was never
// `present` on the station side, so the 0 -> 1 edge was never counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, Presence, PLAYER_STATE, countRevives, REVIVE_MARGIN_DB, RESPAWN_RSSI_DBM, STATION_THRESHOLD_DBM, phoneStationThreshold } from '../src/beacon.js';

const THR = -66;   // the phone respawn station's platform default (F345)
function station() { return new Presence({ defaultThreshold: THR, dwellMs: 800, alpha: 0.35 }); }
function hear(pres, id, alive, rssi, now) {
  pres.observe([encodeUuid({ role: 'player', id, team: 1, state: alive ? PLAYER_STATE.alive : 0 })], rssi, now);
}

test('a revive heard at 3 m on the weaker player advert (below the threshold) counts', () => {
  const pres = station(), was = new Map(); let n = 0, t = 0;
  // Dead, walking in: the station hears the player at -72 dBm, 6 dB under -66 (field: -63..-68 forward, less ~8 dB).
  for (; t < 3000; t += 250) { hear(pres, 7, false, -72, t); pres.tick(t); n += countRevives(pres, was).length; }
  hear(pres, 7, true, -72, t); pres.tick(t); n += countRevives(pres, was).length;
  assert.equal(n, 1, 'the player came up alive within reach of this station');
});

test('a revive the moment the player arrives counts: no dwell, no EMA lag', () => {
  const pres = station(), was = new Map(); let n = 0, t = 0;
  for (; t < 3000; t += 250) { hear(pres, 7, false, -90, t); pres.tick(t); n += countRevives(pres, was).length; }   // far, dead
  for (let i = 0; i < 2; i++, t += 250) { hear(pres, 7, false, -64, t); pres.tick(t); n += countRevives(pres, was).length; }
  hear(pres, 7, true, -64, t); pres.tick(t); n += countRevives(pres, was).length;
  assert.equal(n, 1);
});

test('control: a player revived far from the station (timer or operator) does not count', () => {
  const pres = station(), was = new Map(); let n = 0, t = 0;
  const far = THR - REVIVE_MARGIN_DB - 4;
  for (; t < 3000; t += 250) { hear(pres, 7, false, far, t); pres.tick(t); n += countRevives(pres, was).length; }
  for (let i = 0; i < 4; i++, t += 250) { hear(pres, 7, true, far, t); pres.tick(t); n += countRevives(pres, was).length; }
  assert.equal(n, 0);
});

test('control: an alive player first heard alive, and one who stays alive, never count', () => {
  const pres = station(), was = new Map(); let n = 0;
  for (let t = 0; t < 3000; t += 250) { hear(pres, 8, true, -50, t); pres.tick(t); n += countRevives(pres, was).length; }
  assert.equal(n, 0);
});

// F345 (Tony 2026-09-24): 3 m is the respawn station's maximum range. Measured at 3 m on the player phone: a phone
// station -63 to -68 dBm, a StickS3 -53 to -58. So the default is per platform, like the powerup claim's.
test('the respawn threshold default is per platform: phone -66, StickS3 -60', () => {
  assert.deepEqual({ ...RESPAWN_RSSI_DBM }, { phone: -66, sticks3: -60 });
  assert.ok(Object.isFrozen(RESPAWN_RSSI_DBM));
  assert.equal(phoneStationThreshold('respawn'), -66);
  for (const kind of ['control', 'extraction', 'bomb']) assert.equal(phoneStationThreshold(kind), STATION_THRESHOLD_DBM, kind);
  assert.equal(STATION_THRESHOLD_DBM, -74, 'the other kinds keep the 2026-09-04 bench value');
});
