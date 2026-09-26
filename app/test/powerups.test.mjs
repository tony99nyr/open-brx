// A56 / S58 powerups on the player phone (docs/spec/powerups.md). Everything is INERT unless the pushed config carries
// powerup items: the spawn schedule on the match clock, the "<ITEM> AVAILABLE" announcement, the CLAIM (stand about a
// foot from the station for 1 s, no button), the grant once the station names this player as `taker`, the end of a
// weapon item (empty magazine or death) and the overshield.
// Tony 2026-09-24: a different WEAPON pickup SWAPS the first out, while the same weapon adds charges;
// the station, not the phone, decides who took the item (no offline cooldown on the phone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as E from '../src/engine.js';

const { Engine } = E;
const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

const ROCKETS = { kind: 'weapon', weapon_id: 'rocket_launcher', charges: 2, spawn_every_s: 120, first_at_s: 120, name: 'ROCKETS', color: '#ff7a1a' };
const RAIL = { kind: 'weapon', weapon_id: 'rail_gun', charges: 2, spawn_every_s: 120, first_at_s: 120, name: 'RAIL GUN', color: '#8a5cff' };
const OVERSHIELD = { kind: 'overshield', amount: 75, spawn_every_s: 60, first_at_s: 60, name: 'OVERSHIELD', color: '#3ad6ff' };
// The pickup slots' head `$WEAP` rows (`WeaponCatalog.resolve()` output, 2026-09-24; the grant re-sends them verbatim).
const WEAP = { 2: '$WEAP,2,2,100,10,0,115,0,,,,,,35,100,1000,850,2,2,2600,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,1,75,100,*',
  3: '$WEAP,3,0,100,6,0,149,0,,,,,,,,1200,850,2,2,2400,0,2,100,100,,0,,,C03,C08,,,D36,D35,D34,A73,,,,,2,1,75,*' };
const WEAP0 = golden.head.find(f => f.startsWith("$WEAP,0,"));

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

/** A live TDM with `stations` on the config (and `powerups` slots for the weapon items), past T-0. */
function harness({ stations = [], powerups = undefined, maxShield = 0, weapons = [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], overrides = undefined, stun = undefined, psetPool = true, echo = false, profile = true } = {}) {
  const writes = []; const facts = []; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 900,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: maxShield ? { max_hp: 45, max_armor: 0, max_shield: maxShield } : { max_hp: 45, max_armor: 70, max_shield: 0 }, teams,
    ...(stations.length ? { stations } : {}), ...(powerups ? { powerups } : {}), ...(stun ? { stun } : {}) };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons, ...(overrides ? { overrides } : {}) }, voice: 'male' };
  // The fake gun answers the node's liveness probe the way the bench gun does (`$LIFE,0,0,0,*` -> `$HP` at once), so a
  // long quiet stretch on the match clock is not read as a locked-up gun (F272).
  const answers = [], store = mkStorage(), batches = [], echoQ = []; let failNext = null, failLeft = 0;
  // `echo`: the fake gun answers every `$WEAP` and `$AMMO` write with the `$ALCD` a real gun sends (F259: the `$WEAP`
  // reset at the compiled clip, then the `$AMMO` count). `failNext`: the next write carrying a matching frame resolves false.
  const writer = fr => {
    writes.push(...fr); batches.push([...fr]);
    for (const f of fr) if (f === E.PROBE_LIFE) answers.push(f);
    if (failNext && fr.some(failNext)) { if (--failLeft <= 0) failNext = null; return false; }
    if (echo) for (const f of fr) { const t = f.split(',');
      if (t[0] === '$WEAP') echoQ.push(`$ALCD,${t[17] || 0},100,${t[1]},${t[18] || 0},0,*`);
      else if (t[0] === '$AMMO') echoQ.push(`$ALCD,${t[2]},100,${t[1]},${t[3]},0,*`); }
    return undefined;
  };
  const mk = () => new Engine({ writer, emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: store, log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  let eng = mk();
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' }];
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster } });
  const frames = { ...golden, player_id: 'p1' };
  // the Shields preset (armour 0, a shield ceiling): the maxima are read back from the head's `$PSET`, so rewrite it there
  const shieldsPset = f => f.startsWith('$PSET,') ? f.replace(/^\$PSET,(\d+),(\d+),45,70,0,/, `$PSET,$1,$2,45,0,${maxShield},`) : f;
  if (maxShield) { frames.head = frames.head.map(shieldsPset); frames.pset_pool = frames.pset_pool.map(shieldsPset); }
  if (!psetPool) delete frames.pset_pool;   // an older bundle: the spawn and revive carry no $PSET of their own
  if (!profile) delete frames.respawn_profile;   // an older bundle: a protected life ends on its first shot or the cap
  // A56: compile arms each pickup weapon in its spare slot with a normal `$WEAP` in the head, and every spawn and revive
  // empties it with `$AMMO,<slot>,0,0,1` (compile.py; the respawn profile's bursts carry the same `ammo` rows).
  if (powerups) {
    frames.head = [...frames.head, ...powerups.map(p => WEAP[p.slot])];
    const empty = powerups.map(p => `$AMMO,${p.slot},0,0,1,*`);
    const withEmpty = list => { const i = list.map(f => f.startsWith('$AMMO,')).lastIndexOf(true); return i < 0 ? list : [...list.slice(0, i + 1), ...empty, ...list.slice(i + 1)]; };
    frames.spawn = withEmpty(frames.spawn); frames.revive = withEmpty(frames.revive);
    if (frames.respawn_profile) frames.respawn_profile = { ...frames.respawn_profile, spawn: withEmpty(frames.respawn_profile.spawn), revive: withEmpty(frames.respawn_profile.revive), revive_station: withEmpty(frames.respawn_profile.revive_station) };
  }
  eng.onMcMessage({ kind: 'config', body: { config, frames, roster } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, writes, facts, batches,
    flush() { while (echoQ.length) eng.feedFrame(echoQ.shift()); return h; },
    failNext(pred, n = 1) { failNext = pred; failLeft = n; return h; },
    adv(ms) { const step = 250; for (let t = 0; t < ms; t += step) { h.flush(); clock += Math.min(step, ms - t); eng.tick(); h.flush(); while (answers.length) { answers.shift(); eng.feedFrame(`$HP,${eng.hp},${eng.armor},${eng.shield},*`); } } return h; },
    at(s) { return h.adv(Math.max(0, 1_000_000 + s * 1000 - clock)); },
    mark() { return writes.length; },
    since(n) { return writes.slice(n); },
    frame(f) { eng.feedFrame(f); return h; },
    pull() { eng.feedFrame('$BUT,0,1,*'); eng.feedFrame('$BUT,0,0,*'); return h; },
    /** One powerup station's advert as beacon.js Presence reports it. `median` is the claim's range reading; the
     *  threshold byte 0 means the scanner default (-55). State 0 with value 0 = the station does not know yet. */
    near(id, { median = -50, state = 1, value = 0, taker = 0, threshold = 0 } = {}) {
      const e = { role: 'station', id, kind: 'powerup', team: 255, state, value, taker, seq: 0, game: 0, threshold, rssi: median, raw: median, median, present: median >= -74, ageMs: 0 };
      eng.setStations([e]); return h;
    },
    /** Stand at station `id` past the dwell, then the station names `taker` (this phone is player 7). */
    take(id, taker = 7) { h.near(id); h.adv(1100); h.near(id, { state: 0, value: 110, taker }); return h; },
    away() { eng.setStations([]); return h; },
    die() { eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*'); return h; },
    /** SELECT (`$BUT` id 3): a press, then its release. */
    select() { eng.feedFrame('$BUT,3,1,*'); eng.feedFrame('$BUT,3,0,*'); return h; },
    /** One round out of `slot`, as the gun reports it: the press, the `$ALCD` (token 3 = the slot), the release. */
    fire(slot, mag, res = 0) { eng.feedFrame('$BUT,0,1,*'); eng.feedFrame(`$ALCD,${mag},100,${slot},${res},0,*`); eng.feedFrame('$BUT,0,0,*'); return h; },
    /** The app process restarts mid-match: a new Engine on the same storage, the gun reconnects, the reconcile runs out. */
    restart() { eng = mk(); h.eng = eng; eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); eng.feedFrame(`$HP,${45},${70},0,*`); return h; },
    /** F400: how many times the announcer wrote `key`'s cue frame since mark `n` (shield-spawn.test.mjs's own pattern). */
    cues(n, key) { const f = golden.cues[key]; return h.since(n).filter(w => w === f).length; },
  };
  h.adv(10); h.adv(3000);   // T-0 spawn, then the live life settles
  eng.feedFrame('$HP,45,70,0,*');
  return h;
}
const bmap1 = w => w.filter(f => f.startsWith('$BMAP,1,'));
const grants = w => w.filter(f => /^\$(WEAP|AMMO|BMAP),/.test(f) || (f.startsWith('$LIFE,') && !E.isPoolProbe(f)));
/** The gun-facing weapon writes: `$WEAP`, `$AMMO` and any `$BMAP` (ALT, SELECT or trigger rows). */
const puw = w => w.filter(f => /^\$(WEAP|AMMO|BMAP),/.test(f));

test('inert: a config with no powerup items announces nothing, claims nothing, grants nothing', () => {
  const h = harness();
  h.at(125); h.near(4); h.adv(1500); const n = h.mark(); h.near(4, { state: 0, value: 110, taker: 7 }); h.adv(500);
  const s = h.eng.state();
  assert.equal(s.powerup, null); assert.equal(s.powerupSpawn, null); assert.equal(s.powerupClaim, null);
  assert.deepEqual(grants(h.since(n)), [], 'no grant writes at a powerup station without items');
  assert.equal(h.facts.filter(f => f.type === 'pickup').length, 0);
});

test('schedule: the first spawn is at first_at_s on the match clock, then every spawn_every_s', () => {
  assert.equal(E.puSpawnIndex(OVERSHIELD, 59_999), -1);
  assert.equal(E.puSpawnIndex(OVERSHIELD, 60_000), 0);
  assert.equal(E.puSpawnIndex(OVERSHIELD, 119_999), 0);
  assert.equal(E.puSpawnIndex(OVERSHIELD, 120_000), 1);
  assert.equal(E.puSpawnAt(ROCKETS, 2), 360_000);
});

test('announcement: <ITEM> AVAILABLE at each spawn time, skipped when the station advert said the item is still there', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: OVERSHIELD }] });
  h.at(59);
  assert.equal(h.eng.state().powerupSpawn, null, 'nothing before the first spawn');
  h.at(60.5);
  const a = h.eng.state().powerupSpawn;
  assert.ok(a, 'the first spawn announces');
  assert.equal(a.name, 'OVERSHIELD'); assert.equal(a.color, '#3ad6ff');
  h.near(4, { median: -85, state: 1 });   // heard across the field: available, nobody took it
  h.at(120.5);
  const sp = h.eng.state().powerupSpawn;
  assert.ok(!sp || sp.at === a.at, 'skipped: the item never left');
  h.near(4, { median: -85, state: 0, value: 50 });   // taken: the 3:00 spawn is news again
  h.at(180.5);
  assert.ok(h.eng.state().powerupSpawn.at > a.at, 'announced again once the station said it was taken');
});

test('the claim: in range is the median at or above the threshold (0 = the default -55), out is 3 dB below it', () => {
  assert.equal(E.POWERUP_THRESHOLD_DEFAULT, -55); assert.equal(E.POWERUP_EXIT_DB, 3); assert.equal(E.POWERUP_DWELL_MS, 1000);
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121);
  h.near(4, { median: -56 });
  assert.equal(h.eng.state().powerupClaim, null, 'one dB short of the threshold: not in range');
  h.near(4, { median: -55 });
  let c = h.eng.state().powerupClaim;
  assert.equal(c.station, 4); assert.equal(c.claiming, true); assert.equal(c.ready, false);
  h.adv(500); h.near(4, { median: -57 });   // inside the 3 dB band: still in range, the dwell keeps running
  assert.ok(h.eng.state().powerupClaim.progress >= 0.5);
  h.adv(500); h.near(4, { median: -57 });
  c = h.eng.state().powerupClaim;
  assert.equal(c.ready, true, '1 s continuously in range: claim_ready');
  assert.equal(h.eng.state().powerup.hint.kind, 'claiming', 'the HUD still says HOLD STILL while the station decides');
  h.near(4, { median: -59 });   // more than 3 dB below: out
  assert.equal(h.eng.state().powerupClaim, null, 'leaving range drops the claim');
  h.near(4, { median: -50 }); h.adv(500); h.near(4, { median: -50 });
  assert.equal(h.eng.state().powerupClaim.ready, false, 'leaving range RESET the dwell: half a second back in is not ready');
  h.near(4, { median: -60, threshold: -70 });
  assert.ok(h.eng.state().powerupClaim, "the station's own threshold byte wins over the default");
});

test('F380: a 13 second Stick confirmation is still claiming, while 15 seconds without an answer expires', () => {
  assert.equal(E.POWERUP_NO_ANSWER_MS, 15_000);
  assert.ok(E.POWERUP_READY_LATCH_MS >= 15_000);
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); h.near(4); h.adv(1100);
  h.adv(13_000);
  assert.equal(h.eng.state().powerupClaim.ready, true);
  assert.equal(h.eng.state().powerup.hint.kind, 'claiming');
  assert.notEqual(h.eng.state().powerup.hint.kind, 'no_answer');
  h.near(4, { state: 0, value: 108, taker: 7 });
  assert.ok(h.eng.state().powerup.held, 'the late grant lands');
  const x = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  x.at(121); x.near(4); x.adv(1100); x.adv(15_000);
  assert.equal(x.eng.state().powerup.hint.kind, 'no_answer');
});

test('F374: an advert that says available before the first spawn is not claimable (a Stick carried out before START)', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(30);
  h.near(4, { median: -50, state: 1 }); h.adv(1100); h.near(4, { median: -50, state: 1 });
  assert.equal(h.eng.state().powerupClaim, null, 'first_at_s is 120: the station cannot have the item at 0:30');
  h.at(121);
  h.near(4, { median: -50, state: 1 });
  assert.ok(h.eng.state().powerupClaim, 'CONTROL: the same advert after the first spawn starts the claim');
});

test('no grant without taker == me: the station named another player, so the HUD says who', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); const n = h.mark(); h.take(4, 19);
  assert.deepEqual(grants(h.since(n)), []);
  assert.equal(h.facts.filter(f => f.type === 'pickup').length, 0);
  const hint = h.eng.state().powerup.hint;
  assert.equal(hint.kind, 'taken_by'); assert.equal(hint.by, 'VIPER');
});

test('no grant when the station names me but this phone was never claim_ready for it', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); h.near(4); h.adv(400); const n = h.mark(); h.near(4, { state: 0, value: 110, taker: 7 }); h.adv(300);
  assert.deepEqual(grants(h.since(n)), []);
});

test('STATION NOT ANSWERING: claim_ready for 15 s and the advert still says available', () => {
  assert.equal(E.POWERUP_NO_ANSWER_MS, 15_000);
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); h.near(4); h.adv(1100); h.near(4);
  assert.equal(h.eng.state().powerup.hint.kind, 'claiming');
  h.adv(15_100); h.near(4);
  assert.equal(h.eng.state().powerup.hint.kind, 'no_answer');
  h.near(4, { state: 0, value: 108, taker: 7 });
  assert.equal(h.eng.state().powerup.hint.kind, 'granted');
  assert.ok(h.eng.state().powerup.held);
  h.away();
  assert.equal(h.eng.state().powerupClaim, null, 'walking away ends the claim');
});

test('not there to take: the advert says taken, so the phone does not claim and the hint counts down to the next spawn', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(130); h.near(4, { state: 0, value: 110 }); h.adv(1500); h.near(4, { state: 0, value: 108 });
  assert.equal(h.eng.state().powerupClaim, null);
  const hint = h.eng.state().powerup.hint;
  assert.equal(hint.kind, 'taken'); assert.ok(hint.nextInMs > 100_000 && hint.nextInMs <= 110_000, JSON.stringify(hint));
  const h2 = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h2.at(100); h2.near(4, { state: 0, value: 0 });
  assert.equal(h2.eng.state().powerupClaim, null, 'before the first spawn, a station that does not know yet is not claimable either');
  assert.equal(h2.eng.state().powerup.hint.kind, 'taken');
});

test('a dead player does not claim', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); h.die(); h.near(4); h.adv(1500); h.near(4);
  assert.equal(h.eng.state().powerupClaim, null);
  const n = h.mark(); h.near(4, { state: 0, value: 110, taker: 7 });
  assert.deepEqual(h.since(n).filter(f => /^\$(WEAP,2|AMMO,2,[1-9])/.test(f)), []);
});

test('overshield: current shield + amount with $LIFE token 4 = 2 (set past max), at the current health and armour', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.frame('$HP,40,55,0,*'); const n = h.mark(); h.take(6);
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f)), ['$LIFE,40,55,75,2,*']);
  assert.equal(h.facts.filter(f => f.type === 'pickup')[0].item_kind, 'overshield');
  h.frame('$HP,40,55,75,*');
  assert.equal(h.eng.state().powerup.overshield.left, 75);
  assert.equal(E.OVERSHIELD_DECAY_PER_S, 0); assert.equal(E.OVERSHIELD_AMOUNT, 75);
  h.adv(2000); h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,40,55,30,*');
  assert.equal(h.eng.state().powerup.overshield.left, 30, 'hits take it first');
  h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,40,50,0,*');
  assert.equal(h.eng.state().powerup.overshield, null, 'gone once the shield is back where it started');
});

test('overshield stacks beside a held weapon pickup', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }, { id: 6, kind: 'powerup', item: OVERSHIELD }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); h.take(4); const n = h.mark(); h.take(6);
  assert.equal(h.since(n).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f)).length, 1);
  assert.ok(h.eng.state().powerup.held, 'the rockets are still held');
  assert.ok(h.eng.state().powerup.overshield);
});

test('overshield on a Shields preset: the S29 recharge never writes while the shield is above the preset max', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], maxShield: 70 });
  assert.equal(h.eng.maxShield, 70, 'setup: the Shields preset');
  h.frame('$HP,45,0,70,*');
  h.at(61); let n = h.mark(); h.take(6);
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f)), ['$LIFE,45,0,145,2,*']);
  h.frame('$HP,45,0,145,*'); h.away();
  h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,45,0,100,*');
  n = h.mark(); h.adv(30_000);
  assert.deepEqual(h.since(n).filter(f => /^\$LIFE,0,0,[1-9]\d*,\*$/.test(f)), [], 'no regen grant above the preset max');
  h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,45,0,60,*');
  assert.equal(h.eng.state().powerup.overshield, null, 'below the start, the overshield is gone');
  n = h.mark(); h.adv(30_000);
  assert.ok(h.since(n).some(f => /^\$LIFE,0,0,[1-9]\d*,\*$/.test(f)), 'CONTROL: the ordinary recharge refills the preset shield once the overshield is gone');
});

test('overshield taken over a half-empty preset shield: below the max but still up, the S29 recharge stays off', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], maxShield: 70 });
  h.frame('$HP,45,0,30,*');
  h.at(61); h.take(6); h.frame('$HP,45,0,105,*'); h.away();
  h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,45,0,60,*');
  assert.equal(h.eng.state().powerup.overshield.left, 30, 'setup: 30 of the overshield left, the shield under the preset max');
  const n = h.mark(); h.adv(30_000);
  assert.deepEqual(h.since(n).filter(f => /^\$LIFE,0,0,[1-9]\d*,\*$/.test(f)), [], 'a refill here would top the overshield back up');
});

test('overshield is gone at death', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.take(6); h.frame('$HP,45,70,75,*');
  h.die();
  assert.equal(h.eng.state().powerup.overshield, null);
});

test('M2: no grant while STUNNED (the stun restore would erase it); the ready claim waits and is granted once the stun ends', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }], stun: { duration_s: 3 } });
  h.at(121); h.near(4); h.adv(1100); h.near(4);
  h.frame('$HIR,4,8,19,2,8,0,0,*');   // an EMP word: the gun is disarmed for 3 s
  assert.ok(h.eng.stunned, 'setup: stunned');
  const n = h.mark(); h.near(4, { state: 0, value: 110, taker: 7 }); h.adv(500); h.near(4, { state: 0, value: 110, taker: 7 });
  assert.deepEqual(grants(h.since(n)).filter(f => /^\$(WEAP,2|AMMO,2,[1-9])/.test(f)), [], 'nothing granted inside the stun');
  h.adv(3000); h.near(4, { state: 0, value: 106, taker: 7 });
  assert.equal(h.eng.stunned, null, 'setup: the stun is over');
  assert.ok(h.since(n).includes('$AMMO,2,2,0,1,*'), 'granted once the stun ended');
});

test('F331: a STUNNED player who walks out of range drops the claim (no claim_ready advertised, no grant after the stun)', () => {
  for (const leave of [h => h.near(4, { median: -70 }), h => h.away()]) {
    const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }], stun: { duration_s: 3 } });
    h.at(121); h.near(4); h.adv(1100); h.near(4);
    h.frame('$HIR,4,8,19,2,8,0,0,*');
    assert.ok(h.eng.stunned && h.eng.state().powerupClaim.ready, 'setup: stunned while claim_ready');
    h.adv(250); h.near(4);
    assert.ok(h.eng.state().powerupClaim && h.eng.state().powerupClaim.ready, 'CONTROL: still in range, the ready latch is kept through the stun');
    leave(h); h.adv(250);
    assert.equal(h.eng.state().powerupClaim, null, 'out of range during the stun: the claim is dropped');
    const n = h.mark(); h.adv(3000); h.near(4, { median: -70, state: 0, value: 106, taker: 7 });
    assert.equal(h.eng.stunned, null, 'setup: the stun is over');
    assert.deepEqual(grants(h.since(n)).filter(f => /^\$(WEAP,2|AMMO,2,[1-9])/.test(f)), [], 'no grant for a claim dropped out of range');
  }
});

// ---- Tony, 2026-09-24: "straight to trigger. id prefer trigger fires it" + "select should equip it if possible". ----
// Bench (Tactix-FE30, powerups.md "Sitting A 3.3"): a mid-life `$WEAP,<slot>,…` makes that slot the trigger's weapon at
// once; `$AMMO` alone never switches; the switch-back is the saved weapon's `$WEAP` then its saved `$AMMO`.
const ROCKET_GAME = { stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] };
const TWO_HEAVIES = { stations: [{ id: 4, kind: 'powerup', item: ROCKETS }, { id: 5, kind: 'powerup', item: RAIL }],
  powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }, { weapon_id: 'rail_gun', slot: 3 }] };
/** A rocket game where the player has fired two AR rounds (slot 0 holds 30 / 190) before reaching the station. */
function armed(opts = {}) {
  const h = harness({ ...ROCKET_GAME, ...opts });
  h.at(115); h.fire(0, 31, 190); h.adv(300); h.fire(0, 30, 190);
  h.at(121);
  return h;
}

test('trigger grant: save the trigger slot and its counts, re-send the pickup slot\'s head $WEAP, then $AMMO with the charges, and a pickup fact, once', () => {
  const h = armed(); const n = h.mark(); h.take(4);
  assert.deepEqual(puw(h.since(n)), [WEAP[2], '$AMMO,2,2,0,1,*'], 'the $WEAP puts it on the trigger, the $AMMO gives it the charges');
  const f = h.facts.filter(x => x.type === 'pickup');
  assert.equal(f.length, 1); assert.deepEqual({ ...f[0] }, { type: 'pickup', match_id: 'm1', station_id: 4, item_kind: 'weapon', weapon_id: 'rocket_launcher' });
  const s = h.eng.state();
  assert.equal(s.activeSlot, 2, 'the gun equipped it at once, so the node knows the trigger slot');
  assert.equal(s.weapon, 'ROCKETS');
  assert.equal(s.ammo, 2, 'the ammo block shows the heavy\'s charges at once, not the AR\'s magazine');
  assert.equal(s.powerup.held.name, 'ROCKETS'); assert.equal(s.powerup.held.left, 2); assert.equal(s.powerup.held.active, true);
  assert.deepEqual(s.powerup.held.back, { slot: 0, mag: 30, res: 190 }, 'the switch-back target: the AR with its live counts');
  assert.equal(s.powerup.hint.kind, 'granted');
  const m = h.mark(); h.adv(1000); h.near(4, { state: 0, value: 108, taker: 7 }); h.adv(1000);
  assert.deepEqual(puw(h.since(m)), [], 'the same taker advert heard again grants nothing more');
  assert.equal(h.facts.filter(x => x.type === 'pickup').length, 1);
});

test('F379: after ALT to the secondary and a rocket switch-back, the next ALT follows the gun pointer', () => {
  const h = armed();
  h.eng.switchWindowMs = () => 10_000;
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*');
  assert.equal(h.eng.activeSlot, 0, 'setup: the phone waits for an assumed swap');
  assert.equal(h.eng._altPtr, 1, 'the accepted ALT press moves the gun pointer');
  assert.equal(h.eng.state().switchTo, 1, 'SWITCHING shows the pointer target');
  h.take(4); h.away(); h.eng._puHeld.left = 1; h.fire(2, 0);
  assert.equal(h.eng.activeSlot, 0, 'the empty rocket switched the trigger back to the primary');
  h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switchTo, 0, 'BMAP advanced from slot 1 to slot 0 despite the trigger switch-back');
});

test('F381: a repeat pickup of the same weapon adds charges without a replacement card', () => {
  assert.equal(E.PU_STACK_CAP_X, 2);
  const h = armed(); h.take(4); h.eng._puHeld.left = 1;
  const n = h.mark();
  h.eng._puGrantWeapon(4, { ...ROCKETS, charges: 2 }, h.eng.now());
  assert.equal(h.eng.state().powerup.held.left, 3);
  assert.equal(h.eng.state().powerupGrant.replaced, undefined);
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$AMMO,2,')), ['$AMMO,2,3,0,1,*']);
});

test('F381: a same-weapon stack is capped at twice the item charges (Tony: Rockets at most 4)', () => {
  const h = armed(); h.take(4); h.eng._puHeld.left = 3;
  const n = h.mark();
  h.eng._puGrantWeapon(4, { ...ROCKETS, charges: 2 }, h.eng.now());
  assert.equal(h.eng.state().powerup.held.left, 4, '3 + 2 caps at 4');
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$AMMO,2,')), ['$AMMO,2,4,0,1,*']);
  h.eng._puGrantWeapon(4, { ...ROCKETS, charges: 2 }, h.eng.now());
  assert.equal(h.eng.state().powerup.held.left, 4, 'a full stack stays at 4');
  assert.equal(h.eng.state().powerup.held.charges, 4, 'the HUD denominator is the stacked count');
});

test('F379: a delayed old-slot report cannot settle ALT evidence, and reconcile keeps the pointer', () => {
  const h = armed();
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*');
  h.frame('$ALCD,30,190,0,0,0,*');
  assert.equal(h.eng._altPtr, 1);
  assert.notEqual(h.eng._altEvidencePending, null);
  h.eng._endReconcile();
  assert.equal(h.eng._altPtr, 1);
});

test('F379: ALT pointer persists across an app restart', () => {
  const h = armed(); h.eng._altPtr = 1; h.eng._save(); h.restart();
  assert.equal(h.eng._altPtr, 1);
});

test('head rewrite resets ALT pointer and pending evidence', () => {
  const h = armed(); h.eng._altPtr = 1; h.eng._altEvidencePending = 1;
  h.eng._writeHead('test head');
  assert.equal(h.eng._altPtr, 0);
  assert.equal(h.eng._altEvidencePending, null);
});

test('a weapon grant clears a pending switch-back retry', () => {
  const h = armed(); h.take(4); h.away(); h.eng._puEnd('empty');
  assert.ok(h.eng._puBackPending);
  h.eng._puGrantWeapon(4, ROCKETS, h.eng.now());
  assert.equal(h.eng._puBackPending, null);
});

test('F379: a switch-back resend reads the current magazine and reserve', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800); h.fire(2, 1); h.fire(2, 0);
  h.eng._acctWrote(0, 29, 189); h.eng._prevReserve[0] = 189;
  const n = h.mark(); h.adv(E.PU_BACK_RETRY_MS + 100);
  assert.deepEqual(puw(h.since(n)), [WEAP0, '$AMMO,0,29,189,1,*']);
});

test('trigger grant: no SELECT write and no ALT cycle write, ever (no $BMAP at all)', () => {
  for (const weapons of [undefined, [{ weapon_id: 'assault_rifle' }]]) {
    const h = armed(weapons ? { weapons } : {}); const n = h.mark();
    h.take(4); h.adv(800); h.fire(2, 1); h.adv(300); h.fire(2, 0); h.adv(500);
    assert.deepEqual(h.since(n).filter(f => f.startsWith('$BMAP,')), [], `grant to switch-back: no $BMAP (${weapons ? 'one weapon' : 'two weapons'})`);
  }
});

test('Easy Reload is granted: the pickup never touches ALT, so an Easy Reload player takes a weapon item like anyone', () => {
  const h = armed({ overrides: { easy_reload: true } });
  const n = h.mark(); h.take(4);
  assert.deepEqual(puw(h.since(n)), [WEAP[2], '$AMMO,2,2,0,1,*']);
  assert.equal(h.facts.filter(f => f.type === 'pickup' && f.item_kind === 'weapon').length, 1);
  assert.equal(h.eng.state().powerup.held.name, 'ROCKETS');
});

test('the empty magazine switches back: the saved weapon\'s head $WEAP, then $AMMO with the SAVED counts', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800);   // past the grant's own echo window
  h.fire(2, 1);
  assert.equal(h.eng.state().powerup.held.left, 1);
  const n = h.mark(); h.adv(300); h.fire(2, 0);
  assert.deepEqual(puw(h.since(n)), [WEAP0, '$AMMO,0,30,190,1,*']);
  const s = h.eng.state();
  assert.equal(s.powerup.held, null); assert.equal(s.activeSlot, 0);
  assert.equal(s.powerup.hint.kind, 'switched_back'); assert.equal(s.powerup.hint.name, 'ROCKETS');
  assert.equal(s.weapon, 'ASSAULT RIFLE', 'the ammo block names the AR again');
  assert.equal(s.ammo, 30, 'and shows its saved magazine');
});

test('a second heavy swaps: zero the old slot, the new slot\'s $WEAP and $AMMO; the switch-back target stays the loadout weapon', () => {
  const h = armed(TWO_HEAVIES); h.take(4);
  const n = h.mark(); h.take(5);
  assert.deepEqual(puw(h.since(n)), ['$AMMO,2,0,0,1,*', WEAP[3], '$AMMO,3,2,0,1,*']);
  const s = h.eng.state();
  assert.equal(s.powerup.held.name, 'RAIL GUN'); assert.equal(s.activeSlot, 3);
  assert.deepEqual(s.powerup.held.back, { slot: 0, mag: 30, res: 190 });
  assert.equal(s.powerupGrant.replaced, 'ROCKETS', 'the HUD can say RAIL GUN replaces ROCKETS');
  assert.equal(h.facts.filter(f => f.type === 'pickup').length, 2);
  h.away(); h.adv(800); h.fire(3, 1); h.adv(300); const m = h.mark(); h.fire(3, 0);
  assert.deepEqual(puw(h.since(m)), [WEAP0, '$AMMO,0,30,190,1,*'], 'the rail runs dry back to the AR, not to the rockets');
});

// ---- F400 (docs/spec/powerups.md "The switch card"): a pickup-driven equip shows the SAME full weapon-switch card
// an ALT press shows, with ALT's own timing -- it sets `this.switching` verbatim, so the gun's own echo confirms it
// through the same code ALT's own confirm-by-shot uses, or the same assumed-timeout does when nothing echoes. ----
test('F400: the trigger grant sets the switch card (SWITCHING, ALT\'s own from/to shape), assumed after ALT\'s own window with no echo', () => {
  const h = armed(); const n = h.mark(); h.take(4);
  assert.deepEqual(puw(h.since(n)), [WEAP[2], '$AMMO,2,2,0,1,*'], 'setup: the grant itself is unchanged');
  assert.ok(h.eng.switching, 'the grant opens the same card an ALT press would');
  assert.equal(h.eng.switching.from, 0); assert.equal(h.eng.switching.to, 2);
  assert.equal(h.eng.state().switchingMs, 0);
  h.adv(h.eng.switchWindowMs() + 50);
  assert.equal(h.eng.switching, null, 'ALT\'s own window has passed with no echo');
  assert.equal(h.eng.moment && h.eng.moment.kind, 'switched');
  assert.deepEqual(h.eng.moment.data, { slot: 2, assumed: true });
  assert.equal(h.eng.activeSlot, 2, 'the equip itself was never in doubt -- only the CARD waited');
  assert.equal(h.eng._altPtr, 0, 'F400: a pickup slot (2) never becomes the gun\'s own ALT cycle pointer');
});

test('F400 r1: the gun\'s echo of the equip does not cut the pickup card short: it runs ALT\'s full window', () => {
  const h = armed({ echo: true }); h.take(4);
  assert.ok(h.eng.switching, 'setup: the card opened');
  h.flush();   // the fake gun echoes the $WEAP/$AMMO write with an $ALCD for slot 2 at once
  assert.ok(h.eng.switching, 'the echo is our own write, not a swap finishing');
  h.adv(h.eng.switchWindowMs() + 100);
  assert.equal(h.eng.switching, null);
  assert.equal(h.eng.moment.kind, 'switched'); assert.equal(h.eng.moment.data.slot, 2);
});

test('F400 r1: the ON TRIGGER hint gets its full time after the switch card, even with a slow swap perk', () => {
  const h = armed(); h.eng.switchWindowMs = () => 1105; h.take(4);
  h.adv(1105 + E.PU_ACTIVE_CARD_MS + 1000);   // the card has left; the hint's own 2.5 s is still running
  assert.equal(h.eng.state().powerup.hint && h.eng.state().powerup.hint.kind, 'granted');
});

test('F400 r1: SELECT acts while a pickup card is up (the gun can already fire)', () => {
  const h = armed(); h.take(4);
  assert.ok(h.eng.switching && h.eng.switching.pu, 'setup: the pickup card is up');
  const n = h.mark(); h.adv(500); h.select();
  assert.ok(h.since(n).some(f => f === WEAP0), 'SELECT put the player\'s own weapon back');
});

test('F400 r1: a pickup card closing never moves the gun\'s ALT pointer', () => {
  const h = armed(); h.eng._altPtr = 1; h.take(4); h.adv(500); h.select();
  h.adv(h.eng.switchWindowMs() + 100);
  assert.equal(h.eng.activeSlot, 0, 'setup: SELECT went back to slot 0');
  assert.equal(h.eng._altPtr, 1, 'a phone equip moves the trigger, not ALT');
});
test('F400: a same-weapon stack re-equip shows the card too, from and to the same slot', () => {
  const h = armed(); h.take(4); h.eng._puHeld.left = 1;
  h.eng._puGrantWeapon(4, { ...ROCKETS, charges: 2 }, h.eng.now());
  assert.equal(h.eng.switching.from, 2); assert.equal(h.eng.switching.to, 2);
});

test('F400: SELECT toggles the card both ways -- naming the heavy off the trigger, then the player\'s own weapon', () => {
  const h = armed(); h.take(4); h.adv(h.eng.switchWindowMs() + 50);   // past the grant's own card
  h.select();
  assert.equal(h.eng.switching.from, 2, 'off the heavy'); assert.equal(h.eng.switching.to, 0);
  h.adv(h.eng.switchWindowMs() + 50);
  assert.equal(h.eng.moment.data.slot, 0);
  h.select();
  assert.equal(h.eng.switching.from, 0, 'back onto the heavy'); assert.equal(h.eng.switching.to, 2);
});

test('F400: the empty switch-back shows the card too, naming the player\'s own weapon on the ACTIVE tile', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800); h.fire(2, 1); h.adv(300); h.fire(2, 0);
  assert.equal(h.eng.state().powerup.held, null, 'setup: the item is over');
  assert.ok(h.eng.switching, 'the empty switch-back opens the same card');
  assert.equal(h.eng.switching.from, 2); assert.equal(h.eng.switching.to, 0);
  const going = h.eng.state().powerup.going;
  assert.equal(going && going.slot, 2, '`going` keeps the heavy\'s identity for the STOWING tile past `_puHeld` going null');
  assert.equal(going.name, 'ROCKETS'); assert.equal(going.charges, 0);
});

test('F400: the Overshield is not a weapon -- no switch card, ever; it plays the SAME cue the S29 recharge plays', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); const n = h.mark(); h.take(6);
  assert.equal(h.eng.switching, null, 'no card for an overshield grant');
  assert.ok(!(h.eng.moment && h.eng.moment.kind === 'switched'), 'no switch card moment for an overshield grant either');
  h.adv(3000);   // the item's own "OVERSHIELD AVAILABLE" spawn card (t=60s) outranks the status line and plays first
  assert.ok(h.cues(n, 'shield_charging') >= 1, 'F349: N102, the same clip the ordinary recharge plays on its first grant');
  assert.equal(h.cues(n, 'shield_online'), 0, 'F349: no separate "Shields Online" voice');
});

test('a death with the heavy held: the item is lost, and after the revive burst slot 0\'s head $WEAP and spawn $AMMO re-equip it', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800);
  const n = h.mark(); h.die();
  assert.deepEqual(puw(h.since(n)), [], 'nothing at the death: compile\'s revive re-empties the pickup slot');
  assert.equal(h.eng.state().powerup.held, null);
  assert.equal(E.PU_LOST_AT_DEATH, true);
  h.adv(9000);
  assert.equal(h.eng.alive, true, 'setup: revived');
  const w = puw(h.since(n)), sp = h.since(n).indexOf('$SPAWN,,*');
  const i = w.indexOf(WEAP0);
  assert.ok(sp >= 0 && i >= 0 && h.since(n).indexOf(WEAP0) > sp, `slot 0's $WEAP follows the $SPAWN: ${JSON.stringify(w)}`);
  assert.equal(w[i + 1], '$AMMO,0,32,192,1,*', 'then the spawn $AMMO for slot 0');
  assert.equal(h.eng.state().activeSlot, 0);
  const m = h.mark(); h.adv(9000); h.die(); h.adv(9000);
  assert.ok(!h.since(m).includes(WEAP0), 'CONTROL: a later death with no heavy held re-equips nothing');
});

test('melee (slot 4) does not count as leaving the heavy: the item stays on the trigger and SELECT still switches BACK', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800);
  h.frame('$BUT,4,1,*').frame('$ALCD,1,100,4,0,0,*').frame('$ALCD,0,100,4,0,0,*').frame('$BUT,4,0,*');
  const s = h.eng.state();
  assert.ok(s.powerup.held, 'a melee $ALCD with 0 is not the heavy running dry');
  assert.equal(s.powerup.held.active, true, 'still on the trigger');
  assert.equal(s.weapon, 'ROCKETS');
  const n = h.mark(); h.adv(500); h.select();
  assert.deepEqual(puw(h.since(n)), [WEAP0, '$AMMO,0,30,190,1,*'], 'SELECT switches back to the AR, never "re-equips" from slot 4');
});

test('an app restart mid-item still switches back with the saved counts', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800); h.fire(2, 1);
  h.restart(); h.adv(6000);
  assert.ok(h.eng.state().powerup && h.eng.state().powerup.held, 'the held item survived the restart');
  assert.deepEqual(h.eng.state().powerup.held.back, { slot: 0, mag: 30, res: 190 });
  const n = h.mark(); h.fire(2, 0);
  assert.deepEqual(puw(h.since(n)), [WEAP0, '$AMMO,0,30,190,1,*']);
  assert.equal(h.eng.state().powerup.held, null);
});

test('SELECT toggles: heavy -> the saved weapon with its counts, then the saved weapon -> the heavy with its charges left', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800); h.fire(2, 1);
  let n = h.mark(); h.adv(500); h.select();
  assert.deepEqual(puw(h.since(n)), [WEAP0, '$AMMO,0,30,190,1,*'], 'off the heavy: the AR back with its saved counts');
  let s = h.eng.state();
  assert.equal(s.activeSlot, 0); assert.equal(s.powerup.held.active, false); assert.equal(s.powerup.held.left, 1, 'the heavy keeps its charge');
  h.adv(800); h.fire(0, 29, 190);
  n = h.mark(); h.adv(500); h.select();
  assert.deepEqual(puw(h.since(n)), [WEAP[2], '$AMMO,2,1,0,1,*'], 'back on the heavy: its $WEAP, then the one charge left');
  s = h.eng.state();
  assert.equal(s.activeSlot, 2); assert.equal(s.powerup.held.active, true);
  assert.deepEqual(s.powerup.held.back, { slot: 0, mag: 29, res: 190 }, 'the AR round fired since is saved');
});

test('SELECT: the release alone does nothing, a double press toggles once, and no item means no write', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800);
  let n = h.mark(); h.frame('$BUT,3,0,*');
  assert.deepEqual(puw(h.since(n)), [], 'a release ($PHONE sends one too) never acts');
  n = h.mark(); h.select(); h.adv(100); h.select();
  assert.deepEqual(puw(h.since(n)), [WEAP0, '$AMMO,0,30,190,1,*'], 'a double press inside the debounce toggles once');
  const h2 = armed(); n = h2.mark(); h2.adv(500); h2.select();
  assert.deepEqual(puw(h2.since(n)), [], 'no heavy held: SELECT writes nothing');
});

test('SELECT is ignored while stunned, dead, or while an ALT swap is pending', () => {
  const h = armed({ stun: { duration_s: 3 } }); h.take(4); h.away(); h.adv(800);
  h.frame('$HIR,4,8,19,2,8,0,0,*');
  assert.ok(h.eng.stunned, 'setup: stunned');
  let n = h.mark(); h.select();
  assert.deepEqual(puw(h.since(n)).filter(f => f.startsWith('$WEAP,')), [], 'stunned: no equip');
  h.adv(3500);
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*');
  assert.ok(h.eng.switching, 'setup: an ALT swap is pending');
  n = h.mark(); h.adv(100); h.select();
  assert.deepEqual(puw(h.since(n)).filter(f => f.startsWith('$WEAP,')), [], 'a swap already pending: no equip');
  h.adv(2000); n = h.mark(); h.select();
  assert.equal(puw(h.since(n)).filter(f => f.startsWith('$WEAP,')).length, 1, 'CONTROL: once the swap is over, SELECT acts');
  const d = harness(ROCKET_GAME); d.at(121); d.take(4); d.away(); d.adv(800); d.die();
  n = d.mark(); d.adv(500); d.select();
  assert.deepEqual(puw(d.since(n)).filter(f => f.startsWith('$WEAP,')), [], 'dead: no equip');
});

test('ALT off the heavy keeps its charges, and SELECT brings it back with them', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800); h.fire(2, 1);
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*');
  h.adv(300); h.fire(1, 5, 24);
  let s = h.eng.state();
  assert.ok(s.powerup.held, 'ALT does not end the item'); assert.equal(s.powerup.held.left, 1); assert.equal(s.powerup.held.active, false);
  assert.equal(s.activeSlot, 1);
  const n = h.mark(); h.adv(500); h.select();
  assert.deepEqual(puw(h.since(n)), [WEAP[2], '$AMMO,2,1,0,1,*']);
  s = h.eng.state();
  assert.deepEqual(s.powerup.held.back, { slot: 1, mag: 5, res: 24 }, 'the switch-back target is now the secondary the trigger was on');
});

// ---- Tony, 2026-09-24, the overshield: "in halo if you get hit while you are getting overshield the damage is ignored". ----
// Bench: a shield set past the `$PSET` max clamps back within 0.75 s; a mid-life `$PSET` raising ONLY the shield max then
// holds the `$LIFE` set. So the grant is one burst: spawn protection on, the raised `$PSET`, the absolute `$LIFE`; then,
// OVERSHIELD_GRANT_MS later, protection off. The `$PSET` goes back to the preset max when the overshield is gone.
const PROTECT_ON = '$TMP,,,,,,,,-100,,,,*';
const psetT5 = f => +f.split(',')[5];
const osw = w => w.filter(f => /^\$(TMP|PSET|LIFE),/.test(f) && !E.isPoolProbe(f));

test('overshield grant burst: protection on, the $PSET with shield max raised by the amount, the absolute $LIFE; protection off 1 s later', () => {
  assert.equal(E.OVERSHIELD_GRANT_MS, 1000);
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.frame('$HP,40,55,0,*'); const n = h.mark(); h.take(6);
  const w = osw(h.since(n));
  assert.equal(w.length, 3, JSON.stringify(w));
  assert.equal(w[0], PROTECT_ON, 'spawn protection first: a hit during the grant does no damage');
  assert.ok(w[1].startsWith('$PSET,'), JSON.stringify(w));
  assert.equal(psetT5(w[1]), 75, 'the Standard preset (shield max 0) gets max 75');
  assert.deepEqual(w[1].split(',').filter((_, i) => i !== 5), golden.pset_pool[0].split(',').filter((_, i) => i !== 5), 'only the shield max changes');
  assert.equal(w[2], '$LIFE,40,55,75,2,*');
  const m = h.mark(); h.adv(900);
  assert.deepEqual(osw(h.since(m)), [], 'protection holds for the whole grant window');
  h.adv(200);
  assert.deepEqual(osw(h.since(m)), [golden.spawn_protect_off], 'then spawn protection off');
});

test('overshield on the Shields preset: the $PSET max is the preset max plus the amount', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], maxShield: 70 });
  h.frame('$HP,45,0,70,*'); h.at(61); const n = h.mark(); h.take(6);
  const w = osw(h.since(n));
  assert.equal(psetT5(w.find(f => f.startsWith('$PSET,'))), 145);
  assert.ok(w.includes('$LIFE,45,0,145,2,*'));
});

test('a hit during the grant is ignored: no deferral, the $LIFE carries the pools as they stood, and a stale lower $HP does not end it', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], maxShield: 70 });
  h.frame('$HP,45,0,70,*'); h.at(61); h.near(6); h.adv(1100);
  h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,45,0,61,*');   // a hit lands in the same breath as the station's answer
  const n = h.mark(); h.near(6, { state: 0, value: 58, taker: 7 });
  assert.deepEqual(osw(h.since(n)).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f)), ['$LIFE,45,0,136,2,*'], 'granted at once, on the pools the gun last reported');
  h.adv(200); h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,45,0,52,*');   // a hit from before protection, reported late
  assert.ok(h.eng.state().powerup.overshield, 'inside the grant window a lower $HP is the gun catching up, not the overshield breaking');
  h.frame('$HP,45,0,136,*');
  assert.equal(h.eng.state().powerup.overshield.left, 75);
});

test('no overshield grant to a dead gun', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.near(6); h.adv(1100);
  h.eng.hp = 0;   // the gun reported 0 health and the death is still being processed
  const n = h.mark(); h.near(6, { state: 0, value: 58, taker: 7 });
  assert.deepEqual(osw(h.since(n)), []);
  h.eng.hp = 45; h.adv(250); h.near(6, { state: 0, value: 57, taker: 7 });
  assert.ok(osw(h.since(n)).includes('$LIFE,45,70,75,2,*'), 'CONTROL: granted once the gun is alive again, the latch still warm');
});

test('the $PSET goes back to the preset max once the overshield has drained', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], maxShield: 70 });
  h.frame('$HP,45,0,70,*'); h.at(61); h.take(6); h.frame('$HP,45,0,145,*'); h.away(); h.adv(1500);
  let n = h.mark(); h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,45,0,100,*');
  assert.deepEqual(osw(h.since(n)).filter(f => f.startsWith('$PSET,')), [], 'still up: the raised max stays');
  n = h.mark(); h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,45,0,60,*');
  assert.equal(h.eng.state().powerup.overshield, null);
  const ps = osw(h.since(n)).filter(f => f.startsWith('$PSET,'));
  assert.equal(ps.length, 1, 'one $PSET restore'); assert.equal(psetT5(ps[0]), 70, 'the preset shield max');
});

test('a death with the overshield up: the revive burst\'s own $PSET restores the max; an older bundle without one gets it at the death', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.take(6); h.frame('$HP,45,70,75,*'); h.adv(1500);
  let n = h.mark(); h.die();
  assert.deepEqual(osw(h.since(n)).filter(f => f.startsWith('$PSET,')), [], 'the revive writes the pool $PSET before its $SPAWN');
  h.adv(9000);
  const w = h.since(n), p = w.findIndex(f => f.startsWith('$PSET,')), sp = w.indexOf('$SPAWN,,*');
  assert.ok(p >= 0 && p < sp && psetT5(w[p]) === 0, `the preset $PSET lands before the $SPAWN refills: ${JSON.stringify(w.slice(0, 6))}`);
  const o = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], psetPool: false });
  o.at(61); o.take(6); o.frame('$HP,45,70,75,*'); o.adv(1500);
  n = o.mark(); o.die();
  const ps = osw(o.since(n)).filter(f => f.startsWith('$PSET,'));
  assert.equal(ps.length, 1, 'no pool $PSET in the revive: restored at the death'); assert.equal(psetT5(ps[0]), 0);
});

// ---- polish round 1 on pu-trigger (brx5 lead, 2026-09-24) ----
const settle = () => new Promise(r => setImmediate(r));   // a false write resolve reaches its `.then` a microtask later

test('H1: a reconcile keeps a held heavy: the disarm zeroes its slot, and the re-arm writes its charges in the SAME write (a real gun echoes)', () => {
  const h = armed({ echo: true }); h.take(4); h.away(); h.adv(800); h.fire(2, 1); h.adv(300);
  assert.equal(h.eng.state().powerup.held.left, 1, 'setup: one rocket left');
  const b0 = h.batches.length;
  h.eng.onBleDropped(); h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.adv(6000);
  const bs = h.batches.slice(b0);
  const disarm = bs.find(b => b.includes('$AMMO,0,0,0,1,*'));
  assert.ok(disarm && disarm.includes('$AMMO,2,0,0,1,*'), `the disarm zeroes the heavy too, or it fires while disarmed: ${JSON.stringify(disarm)}`);
  const rearm = bs.find(b => b.includes('$AMMO,0,30,190,1,*'));   // F164: slot 0's LIVE count (two rounds spent before the take), not the spawn 32/192
  assert.ok(rearm && rearm.includes('$AMMO,2,1,0,1,*') && !rearm.includes('$AMMO,2,0,0,1,*'), `one re-arm write, the heavy's charge in it: ${JSON.stringify(bs)}`);
  const s = h.eng.state().powerup;
  assert.ok(s.held, 'the item survived the reconcile and its echoes'); assert.equal(s.held.left, 1); assert.equal(s.held.active, true);
});

test('H2: a lost overshield protection-off is retried, and the window counts as protection owed (F289)', async () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.take(6);
  assert.equal(h.eng.statusBody().protected, true, 'MC must know the player is protected during the grant');
  h.failNext(f => f === golden.spawn_protect_off);
  const n = h.mark(); h.adv(1100); await settle();
  assert.equal(h.since(n).filter(f => f === golden.spawn_protect_off).length, 1, 'setup: the first off write, lost');
  h.adv(500);
  assert.equal(h.since(n).filter(f => f === golden.spawn_protect_off).length, 2, 'retried, or the player is unhittable for the life');
  assert.ok(!h.eng.statusBody().protected, 'owed nothing once it landed');
});

test('M1: a $HIR with no $HP after it holds the overshield grant; a lethal one is never revived by the absolute $LIFE', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.near(6); h.adv(1100);
  h.frame('$HIR,4,0,19,2,9,0,3,*');   // the hit is in; its $HP is still in flight
  const n = h.mark(); h.near(6, { state: 0, value: 58, taker: 7 });
  assert.deepEqual(osw(h.since(n)).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f)), [], 'held: the pools are moving');
  h.frame('$HP,45,61,0,*'); h.adv(250); h.near(6, { state: 0, value: 58, taker: 7 });
  assert.ok(osw(h.since(n)).includes('$LIFE,45,61,75,2,*'), 'granted on the pools the $HP brought, the latch still warm');
  const d = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  d.at(61); d.near(6); d.adv(1100);
  d.frame('$HIR,4,0,19,2,9,0,3,*');
  const m = d.mark(); d.near(6, { state: 0, value: 58, taker: 7 }); d.frame('$HP,0,0,0,*'); d.adv(500); d.near(6, { state: 0, value: 58, taker: 7 });
  assert.deepEqual(osw(d.since(m)).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f) && f.endsWith(',2,*')), [], 'the lethal hit stands');
  assert.equal(d.eng.alive, false);
});

test('M2: a lost $PSET restore is retried once, in the same life', async () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], maxShield: 70 });
  h.frame('$HP,45,0,70,*'); h.at(61); h.take(6); h.frame('$HP,45,0,145,*'); h.away(); h.adv(1500);
  h.failNext(f => f.startsWith('$PSET,'));
  const n = h.mark(); h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,45,0,60,*');
  h.fire(0, 29, 190);   // a round leaves before the retry settles: a `$PSET` carries no counts, so it is still safe to repeat
  await settle(); await settle();
  assert.equal(h.since(n).filter(f => f.startsWith('$PSET,')).length, 2, 'the restore, then its retry');
});

test('M3: a lost switch-back write is re-sent until back-slot evidence or a player SELECT press', () => {
  const h = armed(); h.take(4); h.away(); h.adv(800); h.fire(2, 1); h.adv(300);
  let n = h.mark(); h.fire(2, 0);   // the switch-back goes out, and the (fake) gun never answers it
  assert.deepEqual(puw(h.since(n)), [WEAP0, '$AMMO,0,30,190,1,*']);
  h.adv(2000);
  assert.equal(h.since(n).filter(f => f === WEAP0).length, 2, 're-sent: the trigger must not stay on an empty heavy');
  n = h.mark(); h.adv(100); h.select();
  assert.deepEqual(puw(h.since(n)), [], 'SELECT cancels the stale retry without another write');
  h.adv(2000);
  assert.equal(h.eng._puBackPending, null, 'the player choice cleared the retry');
  h.frame('$ALCD,30,100,0,190,0,*');
  n = h.mark(); h.adv(5000); h.select();
  assert.deepEqual(puw(h.since(n)), [], 'the gun answered for slot 0: nothing pending');
});

test('low: an operator respawn of a live player with the overshield up restores the $PSET before the $SPAWN and ends it', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], psetPool: false });
  h.at(61); h.take(6); h.frame('$HP,45,70,75,*'); h.adv(1500);
  const n = h.mark(); h.eng._revive(false, null, true);
  const w = h.since(n), p = w.findIndex(f => f.startsWith('$PSET,')), sp = w.indexOf('$SPAWN,,*');
  assert.ok(p >= 0 && p < sp && psetT5(w[p]) === 0, `the preset $PSET before the $SPAWN refills: ${JSON.stringify(w.slice(0, 5))}`);
  assert.equal(h.eng.state().powerup.overshield, null);
});

test('X10: an operator respawn whose overshield restore is lost retries it for the new life', async () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], psetPool: false });
  h.at(61); h.take(6); h.frame('$HP,45,70,75,*'); h.adv(1500);
  const n = h.mark();
  h.failNext(f => f.startsWith('$PSET,') && psetT5(f) === 0);
  h.eng._revive(false, null, true);
  await settle();
  const restores = h.since(n).filter(f => f.startsWith('$PSET,') && psetT5(f) === 0);
  assert.equal(restores.length, 2, `the lost restore is sent once more: ${JSON.stringify(h.since(n).slice(0, 8))}`);
});

test('low: a new match clears the $PSET the overshield copies, and the T-0 spawn sets it again', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  assert.equal(h.eng._psetNow, golden.pset_pool[0], 'the T-0 spawn\'s pool take, set after the match reset');
});

test('low: the raised max is the new shield, never below the preset max (a half-empty Shields preset gets 105, not 145)', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }], maxShield: 70 });
  h.frame('$HP,45,0,30,*'); h.at(61); const n = h.mark(); h.take(6);
  const w = osw(h.since(n));
  assert.equal(psetT5(w.find(f => f.startsWith('$PSET,'))), 105);
  assert.ok(w.includes('$LIFE,45,0,105,2,*'));
});

test('low: a shot from the heavy ends spawn protection on a bundle whose protection ends on the first shot', () => {
  const h = harness({ ...ROCKET_GAME, profile: false });
  h.at(112); h.die(); h.adv(8300);
  assert.ok(h.eng.alive && h.eng._armPending && h.eng._armPending.shotEnds, 'setup: revived, protected until the first shot');
  h.take(4);
  assert.ok(h.eng.state().powerup.held, 'setup: rockets on the trigger');
  const n = h.mark(); h.fire(2, 1);
  assert.ok(h.since(n).includes(golden.spawn_protect_off), 'the heavy\'s shot is the gun\'s proof it can fire');
});

test('low: the stun restore writes the held heavy\'s count as it is at the restore, not the snapshot\'s', () => {
  const h = armed({ stun: { duration_s: 3 } }); h.take(4); h.away(); h.adv(800);
  h.frame('$HIR,4,8,19,2,8,0,0,*');
  assert.ok(h.eng.stunned, 'setup: stunned');
  h.eng._puHeld.left = 1;   // the node's count moved after the snapshot
  const n = h.mark(); h.adv(3500);
  assert.ok(h.since(n).includes('$AMMO,2,1,0,1,*'), JSON.stringify(h.since(n).filter(f => f.startsWith('$AMMO,'))));
});

// ---- polish round 2 on pu-trigger (brx5 lead, 2026-09-24) ----
test('r2 M1: a reconcile keeps a pending switch-back (the disarm echo is not its answer) and re-sends it at the end', () => {
  const h = armed({ echo: true }); h.take(4); h.away(); h.adv(800); h.fire(2, 1); h.adv(300);
  h.failNext(f => f === WEAP0);
  h.fire(2, 0);   // the switch-back write is lost
  assert.ok(h.eng._puBackPending, 'setup: a switch-back pending');
  const b0 = h.batches.length;
  h.eng.onBleDropped(); h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.adv(6000);
  const bs = h.batches.slice(b0), ri = bs.findIndex(b => b.includes('$AMMO,1,6,24,1,*'));   // the re-arm (F164: slot 0 at its live 30/190)
  assert.ok(ri >= 0 && bs.slice(ri).some(b => b.includes(WEAP0) && b.includes('$AMMO,0,30,190,1,*')), `re-sent after the re-arm: ${JSON.stringify(bs)}`);
  assert.equal(h.eng._puBackPending, null, 'answered by the real echo afterwards');
});

test('r2 M2: ALT off the heavy then a reload $ALCD (no shot) moves the trigger: the HUD and SELECT stop naming the heavy', () => {
  const h = harness(ROCKET_GAME);
  h.at(110); h.frame('$BUT,1,1,*').frame('$BUT,1,0,*'); h.adv(300); h.fire(1, 5, 24); h.adv(1200);
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*'); h.adv(300); h.fire(0, 31, 192);
  h.at(121); h.take(4); h.away(); h.adv(800); h.fire(2, 1);
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*'); h.adv(300);
  h.frame('$ALCD,6,100,1,24,0,*');   // a reload tops the secondary up: a rise, not a round leaving
  const s = h.eng.state();
  assert.equal(s.activeSlot, 1, 'setup: the ALT swap is confirmed on slot 1');
  assert.equal(s.powerup.held.active, false, 'the trigger is on the secondary now');
  assert.notEqual(s.weapon, 'ROCKETS');
  const n = h.mark(); h.adv(500); h.select();
  assert.deepEqual(puw(h.since(n)), [WEAP[2], '$AMMO,2,1,0,1,*'], 'SELECT equips the heavy, it does not "switch back"');
});

test('r2 low: a protection-off that keeps failing is retried 3 times, then left to RESYNC GUN', async () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.take(6); h.failNext(f => f === golden.spawn_protect_off, 99);
  const n = h.mark();
  for (let i = 0; i < 12; i++) { h.adv(250); await settle(); }
  assert.equal(h.since(n).filter(f => f === golden.spawn_protect_off).length, 4, 'the write, then 3 retries');
});

// ---- final review (round 3) on pu-trigger (brx5 lead, 2026-09-24) ----
/** A rocket game where slot 1 has reported once (so its next rise or drop has a baseline), the rockets taken and
 *  fired dry, and the (fake) gun never answering the switch-back: a switch-back pending. */
function pendingBack() {
  const h = harness(ROCKET_GAME);
  h.at(110); h.frame('$BUT,1,1,*').frame('$BUT,1,0,*'); h.adv(300); h.fire(1, 5, 24); h.adv(1200);
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*'); h.adv(300); h.fire(0, 31, 192);
  h.at(121); h.take(4); h.away(); h.adv(800); h.fire(2, 1); h.adv(300);
  const n = h.mark(); h.fire(2, 0);
  assert.ok(h.eng._puBackPending, 'setup: a switch-back pending');
  return { h, n, backs: () => h.since(n).filter(f => f === WEAP0).length };
}

test('F379: a player ALT press cancels the pending switch-back re-send', () => {
  const { h, backs } = pendingBack();
  h.adv(1400); h.frame('$BUT,1,1,*').frame('$BUT,1,0,*'); h.adv(300);
  assert.equal(backs(), 1, 'no re-send while the ALT swap is in flight');
  h.adv(700); const c = backs(); h.select();
  assert.equal(backs(), c, 'the player chose ALT, so no stale switch-back is sent later');
});

test('r3 M1: a CONFIRMED ALT swap clears the pending switch-back', () => {
  const { h, backs } = pendingBack();
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*'); h.adv(300);
  h.frame('$ALCD,6,100,1,24,0,*');   // the swap confirmed on slot 1 by a rise (a reload), not a round leaving
  assert.equal(h.eng.state().activeSlot, 1, 'setup: confirmed');
  h.adv(5000);
  assert.equal(backs(), 1, 'the player chose the secondary: nothing re-sent');
});

test('r3 low: a round from slot 1 clears a pending switch-back', () => {
  const { h, backs } = pendingBack();
  h.fire(1, 4, 24); h.adv(5000);
  assert.equal(backs(), 1);
  assert.equal(h.eng._puBackPending, null);
});

test('F379 r2 M: an ALT target of slot 0 is settled by the gun (0 is a real slot, not "nothing pending")', () => {
  const h = armed(); h.eng._altPtr = 1;
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*');
  assert.equal(h.eng._altEvidencePending, 0, 'setup: the pointer went 1 -> 0');
  h.frame('$ALCD,30,190,0,0,0,*');
  assert.equal(h.eng._altEvidencePending, null);
  assert.equal(h.eng._altPtr, 0);
});

test('F379 r2 M: a phone equip ends the ALT evidence window', () => {
  const h = armed();
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*');
  assert.equal(h.eng._altEvidencePending, 1, 'setup: ALT pressed');
  h.take(4);
  assert.equal(h.eng._altEvidencePending, null, 'the heavy on the trigger is no ALT answer');
});

test('r3 M2: a protection-off that failed every retry books the life as write-lost, so MC offers RESYNC GUN', async () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.take(6); h.failNext(f => f === golden.spawn_protect_off, 99);
  for (let i = 0; i < 12; i++) { h.adv(250); await settle(); }
  assert.equal(h.eng._writeLost, h.eng._lifeSeq);
});

// HUD QA R2-21: the overshield grant floated "+55 HEALTH" on the stage (its demo gun held other pools than the node). The
// grant's echo carries the pools the grant wrote: a rise TO those pools is never a pickup; any other rise still floats.
test('R2-21: an echo equal to the grant pools is no gain moment; CONTROL: a real heal inside the echo window floats', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.frame('$HP,30,55,0,*');
  h.eng.hp = 35;                  // the node's own number moved ahead of the gun's last report (the stage's case)
  const n = h.mark(); h.take(6);
  assert.ok(h.since(n).includes('$LIFE,35,55,75,2,*'), 'setup: the grant wrote 35/55');
  h.eng.moment = null;
  h.frame('$HP,35,55,75,*');      // the echo: exactly the grant's pools
  assert.ok(!(h.eng.moment && h.eng.moment.kind === 'gain' && h.eng.moment.data.pool !== 'shield'), `no HEALTH float for the grant echo: ${JSON.stringify(h.eng.moment)}`);
  h.eng.moment = null;
  h.frame('$HP,40,55,75,*');      // CONTROL: a real heal, still inside OVERSHIELD_ECHO_MS
  assert.equal(h.eng.moment && h.eng.moment.kind, 'gain');
  assert.equal(h.eng.moment.data.pool, 'health');
});
