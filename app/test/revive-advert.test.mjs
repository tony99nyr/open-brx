// revive-advert.test.mjs — the station-revive signal on the player advert (utility.md §2, Tony 2026-09-24).
// A STATION revive sets player state bit6 `revived` with `value` = that station's id for REVIVE_ADVERT_MS, so a
// station counts the revive from the bit, not from RSSI, and with no MC relay (MC may be out of Wi-Fi range).
// A timed or an operator revive never sets it. A revive wins the shared `value` byte over a powerup claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodeUuid, decodeUuid, Presence, PLAYER_STATE, TEAM_ANY, AdvertGate, countRevives, REVIVE_ADVERT_MS, playerAdvertFields } from '../src/beacon.js';
import { playerClaimAdvert } from '../src/powerup.js';
import { Engine } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

// ---------- the bit and the codec ----------

test('bit6 `revived` is 0x40 and round-trips with the station id in value', () => {
  assert.equal(PLAYER_STATE.revived, 0x40);
  const u = encodeUuid({ role: 'player', id: 7, team: 1, state: PLAYER_STATE.alive | PLAYER_STATE.revived, value: 5 });
  assert.equal(u.replace(/-/g, '').slice(20, 24), '4105', 'state byte 10 = 0x41, value byte 11 = the station id');
  const d = decodeUuid(u);
  assert.equal(d.state & PLAYER_STATE.revived, 0x40); assert.equal(d.value, 5);
});

// ---------- the advert fields: hold, clear, and the claim rule ----------

const NO_CLAIM = playerClaimAdvert(null);
test('playerAdvertFields: a revive sets bit6 with the station id; none leaves the advert as before', () => {
  assert.deepEqual(playerAdvertFields({ alive: true, claim: NO_CLAIM, revive: 5 }), { state: 0x41, value: 5, mode: 'lowLatency' });
  assert.deepEqual(playerAdvertFields({ alive: true, claim: NO_CLAIM, revive: null }), { state: 1, value: 0, mode: 'balanced' });
  assert.deepEqual(playerAdvertFields({ alive: false, claim: NO_CLAIM, revive: null }), { state: 0, value: 0, mode: 'balanced' });
  assert.equal(playerAdvertFields({ alive: true, claim: NO_CLAIM, revive: 300 }).value, 300 & 0xff, 'the value byte carries the low byte, as a claim does');
});

test('a revive wins over a claim: bits 4/5 cleared, value = the revive station; the claim resumes after', () => {
  const claim = playerClaimAdvert({ station: 9, ready: true });
  const during = playerAdvertFields({ alive: true, claim, revive: 5 });
  assert.equal(during.state & (PLAYER_STATE.claiming | PLAYER_STATE.claim_ready), 0, 'no claim bits during the hold');
  assert.equal(during.state & PLAYER_STATE.revived, PLAYER_STATE.revived);
  assert.equal(during.value, 5, 'value = the revive station, not the claimed one');
  const after = playerAdvertFields({ alive: true, claim, revive: null });
  assert.deepEqual(after, { state: 1 | PLAYER_STATE.claiming | PLAYER_STATE.claim_ready, value: 9, mode: 'lowLatency' }, 'control: the claim as before');
});

// ---------- the engine: only a station revive, a 5 s hold, a restart ----------

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }
function harness(respawn = 'scanner') {
  let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: respawn, delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: () => {}, emit: () => {}, report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng,
    adv(ms) { clock += ms; eng.tick(); return h; },
    die() { eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*'); return h; },
    at(id) { eng.setStations([{ role: 'station', id, kind: 'respawn', team: 1, state: 1, value: 0, seq: 0, game: 0, threshold: -60, rssi: -50, raw: -50, present: true }]); return h; },
    pull() { eng.feedFrame('$BUT,0,1,*'); eng.feedFrame('$BUT,0,0,*'); return h; },
  };
  h.adv(10); h.adv(5000);
  return h;
}

test('a STATION revive holds reviveAdvert = the station id for REVIVE_ADVERT_MS, then clears it', () => {
  assert.equal(REVIVE_ADVERT_MS, 5000);
  const h = harness();
  assert.equal(h.eng.state().reviveAdvert, null, 'control: nothing before any revive');
  h.die().adv(9000).at(5).pull();
  assert.equal(h.eng.alive, true, 'setup: revived at the station');
  assert.equal(h.eng.state().reviveAdvert, 5);
  h.adv(REVIVE_ADVERT_MS - 250);
  assert.equal(h.eng.state().reviveAdvert, 5, 'still held just inside 5 s');
  h.adv(250);
  assert.equal(h.eng.state().reviveAdvert, null, 'cleared at 5 s');
});

test('a second station revive inside the hold restarts it with the new id', () => {
  const h = harness();
  h.die().adv(9000).at(5).pull();
  h.adv(1000).die().adv(9000);
  assert.equal(h.eng.state().reviveAdvert, null, 'a death ends the hold (the next revive is a fresh rising edge)');
  h.at(6).pull();
  assert.equal(h.eng.state().reviveAdvert, 6, 'the new station id');
  h.adv(REVIVE_ADVERT_MS - 250);
  assert.equal(h.eng.state().reviveAdvert, 6, 'the hold restarted at the second revive');
});

test('control: a timed revive and an operator respawn never set the bit', () => {
  const t = harness('auto');
  t.die().adv(7990).adv(10);
  assert.equal(t.eng.alive, true, 'setup: the timed revive happened');
  assert.equal(t.eng.state().reviveAdvert, null, 'a timed revive');
  const o = harness();
  o.die().adv(9000);
  o.eng._revive(false, null, true);
  assert.equal(o.eng.alive, true, 'setup: the operator revive happened');
  assert.equal(o.eng.state().reviveAdvert, null, 'an operator respawn');
});

// ---------- the restart gate sends the set and the clear at once ----------

test('AdvertGate: bit6 set and bit6 clear each go out at once, even right after a value-only change', () => {
  const g = new AdvertGate();
  const uuid = f => encodeUuid({ role: 'player', id: 7, team: 1, state: f.state, value: f.value });
  const claim = playerClaimAdvert({ station: 9, ready: false });
  const down = uuid(playerAdvertFields({ alive: false, claim: NO_CLAIM, revive: null }));
  g.started(down, 0);
  const set = uuid(playerAdvertFields({ alive: true, claim: NO_CLAIM, revive: 5 }));
  assert.equal(g.due(set, 400), 'start', 'the set goes out on the next tick'); g.started(set, 400);
  const clear = uuid(playerAdvertFields({ alive: true, claim: NO_CLAIM, revive: null }));
  assert.equal(g.due(clear, 5400), 'start', 'the clear goes out at once'); g.started(clear, 5400);
  // A claim started 400 ms ago (value 9), then a revive with value 5: a state change, never the 1 s value throttle.
  const claiming = uuid(playerAdvertFields({ alive: true, claim, revive: null }));
  assert.equal(g.due(claiming, 6000), 'start'); g.started(claiming, 6000);
  const revived = uuid(playerAdvertFields({ alive: true, claim, revive: 5 }));
  assert.equal(g.due(revived, 6400), 'start', 'the revive is not throttled as a value-only change');
});

// ---------- the phone station's count: bit6 first, RSSI only for a player never seen with it ----------

const STATION_ID = 5, TEAM = 1, THR = -70;
function station() { return new Presence({ defaultThreshold: THR, dwellMs: 800, alpha: 0.35 }); }
/** Drive player 7 through `steps` ([alive, revivedAt | null, rssi, ms]) at 250 ms ticks; returns the revives counted. */
function run(steps, opts) { return runSteps(steps, opts).reduce((a, b) => a + b, 0); }
/** The same, returning the revives counted in each step. */
function runSteps(steps, { team = TEAM, stationTeam = TEAM, id = STATION_ID } = {}) {
  const pres = station(), mem = new Map(), out = []; let t = 0;
  for (const [alive, rev, rssi, ms] of steps) {
    let n = 0; out.push(0);
    for (const end = t + ms; t < end; t += 250) {
      const state = (alive ? PLAYER_STATE.alive : 0) | (rev != null ? PLAYER_STATE.revived : 0);
      pres.observe([encodeUuid({ role: 'player', id: 7, team, state, value: rev != null ? rev : 0 })], rssi, t);
      pres.tick(t); n += countRevives(pres, mem, { team: stationTeam, id }).length;
    }
    out[out.length - 1] = n;
  }
  return out;
}
const ALIVE_FAR = [true, null, -85, 2000], DIES_FAR = [false, null, -85, 2000];

test('the station counts bit6 once per rising edge, with no RSSI needed', () => {
  // Heard far below any RSSI margin the whole time: only the bit can count it, and it is held 5 s (20 ticks).
  assert.equal(run([ALIVE_FAR, DIES_FAR, [true, STATION_ID, -95, 5000], [true, null, -95, 1000]]), 1);
  // Two revives at this station: two rising edges, two counts.
  assert.equal(run([ALIVE_FAR, DIES_FAR, [true, STATION_ID, -95, 5000], [true, null, -95, 500], DIES_FAR, [true, STATION_ID, -95, 2000]]), 2);
});

test('bit6 with another station\'s id is not counted here; nor is an enemy\'s revive', () => {
  assert.equal(run([ALIVE_FAR, DIES_FAR, [true, 6, -50, 5000]]), 0, 'revived at station 6, standing by station 5');
  assert.equal(run([ALIVE_FAR, DIES_FAR, [true, STATION_ID, -50, 5000]], { team: 2, stationTeam: 1 }), 0, 'an enemy with our id in value');
  assert.equal(run([ALIVE_FAR, DIES_FAR, [true, STATION_ID, -50, 5000]], { team: 2, stationTeam: TEAM_ANY }), 1, 'control: a neutral station counts anyone');
});

test('no double count: a bit6 revive heard close counts once, and the RSSI rule stays off for that player', () => {
  assert.equal(run([ALIVE_FAR, DIES_FAR, [false, null, -60, 1000], [true, STATION_ID, -60, 5000]]), 1, 'both rules would fire: one count');
  // Once seen with bit6, a later timed revive beside the station (alive 0 -> 1 heard close, no bit) is not counted.
  assert.deepEqual(runSteps([ALIVE_FAR, DIES_FAR, [true, STATION_ID, -95, 5000], [false, null, -60, 2000], [true, null, -60, 1000]]), [0, 0, 1, 0, 0]);
});

test('control: the RSSI fallback still counts a player never seen with bit6 (an older phone)', () => {
  assert.equal(run([ALIVE_FAR, DIES_FAR, [false, null, -64, 500], [true, null, -64, 250]]), 1);
});
