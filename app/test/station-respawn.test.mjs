// station-respawn.test.mjs — a respawn station counts the revives that happen at it (F344), and reaches 3 m (F345).
// Field 2026-09-24: a phone respawn station reported revives 0 for two revives at it. The player's phone judged
// "at the station" on the station's HIGH-TX advert; the station judged the player on the player's MEDIUM-TX
// advert, about 8 dB weaker, against the same threshold, with its own 0.8 s dwell. The player was never
// `present` on the station side, so the 0 -> 1 edge was never counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeUuid, Presence, PLAYER_STATE, TEAM_ANY, countRevives, REVIVE_MARGIN_DB, RESPAWN_RSSI_DBM, STATION_THRESHOLD_DBM, phoneStationThreshold, stationThreshold, applyThreshold, migrateThreshold } from '../src/beacon.js';

const THR = -70;   // the phone respawn station's platform default (F345)
const TEAM = 1;
function station() { return new Presence({ defaultThreshold: THR, dwellMs: 800, alpha: 0.35 }); }
function hear(pres, id, alive, rssi, now, team = TEAM) {
  pres.observe([encodeUuid({ role: 'player', id, team, state: alive ? PLAYER_STATE.alive : 0 })], rssi, now);
}
/** Drive one player through `steps` ([alive, rssi, ms]) at 250 ms ticks; returns the revives counted. */
function run(steps, { team = TEAM, stationTeam = TEAM, pres = station(), mem = new Map(), t0 = 0 } = {}) {
  let n = 0, t = t0;
  for (const [alive, rssi, ms] of steps) {
    for (const end = t + ms; t < end; t += 250) {
      if (rssi != null) hear(pres, 7, alive, rssi, t, team);
      pres.tick(t); n += countRevives(pres, mem, { team: stationTeam }).length;
    }
  }
  return n;
}
const ALIVE_FAR = [true, -85, 2000];   // in play, heard across the field
const DIES_FAR = [false, -85, 2000];

test('a revive heard at 3 m on the weaker player advert (below the threshold) counts', () => {
  // The station hears the player at -72 dBm, 2 dB under -70 (field: -63..-68 forward, less ~8 dB of TX gap).
  assert.equal(run([ALIVE_FAR, DIES_FAR, [false, -72, 3000], [true, -72, 250]]), 1);
});

test('a revive the moment the player arrives counts: no dwell, no EMA lag', () => {
  assert.equal(run([ALIVE_FAR, DIES_FAR, [false, -64, 500], [true, -64, 250]]), 1);
});

test('a player who died out of earshot and walked in still counts (memory outlives Presence expiry)', () => {
  assert.equal(run([ALIVE_FAR, [false, null, 12000], [false, -70, 1000], [true, -70, 250]]), 1);
});

test('control: a player revived far from the station (timer or operator) does not count', () => {
  const far = THR - REVIVE_MARGIN_DB - 4;
  assert.equal(run([ALIVE_FAR, DIES_FAR, [false, far, 3000], [true, far, 1000]]), 0);
});

test('control: an alive player who stays alive never counts', () => {
  assert.equal(run([[true, -50, 3000]]), 0);
});

test('review M1: an enemy revived beside this station does not count; a neutral station counts anyone', () => {
  const steps = [ALIVE_FAR, DIES_FAR, [false, -60, 1000], [true, -60, 250]];
  assert.equal(run(steps, { team: 2, stationTeam: 1 }), 0);
  assert.equal(run(steps, { team: 2, stationTeam: TEAM_ANY }), 1);
});

test('review M2: the match start (dead in the lobby, alive at go) and a first 0 -> 1 never count', () => {
  assert.equal(run([[false, -55, 3000], [true, -55, 1000]]), 0, 'go-live beside the base station');
  assert.equal(run([[false, -55, 1000], [true, -55, 500], [false, -55, 250], [true, -55, 500]]), 1,
    'after the start, a real death and revive does count');
});

test('review M2: a player first heard dead (a resync, a reload) is not a revive until a death is seen', () => {
  const pres = station(), mem = new Map();
  assert.equal(run([[false, -55, 1000], [true, -55, 1000]], { pres, mem }), 0);
  assert.equal(run([[false, -55, 500], [true, -55, 500]], { pres, mem, t0: 5000 }), 1);
});

// F345 (Tony 2026-09-24): 3 m is the respawn station's maximum range. Measured at 3 m on the player phone: a phone
// station -63 to -68 dBm, a StickS3 -53 to -58. So the default is per platform, like the powerup claim's.
test('the respawn threshold default is per platform: phone -70, StickS3 -57 (Tony, 2026-09-24)', () => {
  assert.deepEqual({ ...RESPAWN_RSSI_DBM }, { phone: -70, sticks3: -57 });
  assert.ok(Object.isFrozen(RESPAWN_RSSI_DBM));
  assert.equal(phoneStationThreshold('respawn'), -70);
  for (const kind of ['control', 'extraction', 'bomb']) assert.equal(phoneStationThreshold(kind), STATION_THRESHOLD_DBM, kind);
  // S58 (doc-rot 2026-09-24): a powerup station advertises its OWN ~1 ft default (the claim range), never the 3 m -74
  assert.equal(phoneStationThreshold('powerup'), -55);
  assert.equal(stationThreshold({ threshold: 0, kind: 'powerup' }), -55);
  assert.equal(STATION_THRESHOLD_DBM, -74, 'the other kinds keep the 2026-09-04 bench value');
});

test('review M3: MC\'s threshold 0 means the platform default, never a -30 dBm bubble', () => {
  assert.equal(applyThreshold(0, -70), 0, '0 is "your own default" (0.4.11 and older clamped it to -30)');
  assert.equal(stationThreshold({ threshold: applyThreshold(0, -70), kind: 'respawn' }), -70);
  assert.equal(stationThreshold({ threshold: applyThreshold(0, -70), kind: 'control' }), -74);
  assert.equal(applyThreshold(-58, 0), -58, 'an override is kept');
  assert.equal(applyThreshold(-20, 0), -30); assert.equal(applyThreshold(-120, 0), -100);
  assert.equal(applyThreshold(-66.4, 0), -66);
  assert.equal(applyThreshold(undefined, -61), -61); assert.equal(applyThreshold('x', -61), -61);
});

test('review M3: thr() resolves the override first, then the kind\'s platform default', () => {
  assert.equal(stationThreshold({ threshold: 0, kind: 'respawn' }), RESPAWN_RSSI_DBM.phone);
  assert.equal(stationThreshold({ threshold: -71, kind: 'respawn' }), -71);
  assert.equal(stationThreshold({ threshold: 0, kind: 'extraction' }), STATION_THRESHOLD_DBM);
});

test('review M3: a pre-F345 saved -74 migrates to the default once; a chosen value and a migrated one stay', () => {
  assert.deepEqual(migrateThreshold({ kind: 'respawn', threshold: -74 }), { kind: 'respawn', threshold: 0, thrV: 2 });
  assert.deepEqual(migrateThreshold({ threshold: -70 }), { threshold: -70, thrV: 2 });
  const done = { threshold: -74, thrV: 2 };
  assert.equal(migrateThreshold(done), done, 'an operator who chose -74 after the migration keeps it');
});
