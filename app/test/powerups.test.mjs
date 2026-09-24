// A56 / S58 powerups on the player phone (docs/spec/powerups.md). Everything is INERT unless the pushed config carries
// powerup items: the spawn schedule on the match clock, the "<ITEM> AVAILABLE" announcement, the CLAIM (stand about a
// foot from the station for 1 s, no button), the grant once the station names this player as `taker`, the end of a
// weapon item (empty magazine or death) and the overshield.
// Tony 2026-09-24 (via the lead): a second WEAPON pickup SWAPS the first out; an overshield stacks beside a weapon;
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

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

/** A live TDM with `stations` on the config (and `powerups` slots for the weapon items), past T-0. */
function harness({ stations = [], powerups = undefined, maxShield = 0, weapons = [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], overrides = undefined, stun = undefined } = {}) {
  const writes = []; const facts = []; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 900,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: maxShield ? { max_hp: 45, max_armor: 0, max_shield: maxShield } : { max_hp: 45, max_armor: 70, max_shield: 0 }, teams,
    ...(stations.length ? { stations } : {}), ...(powerups ? { powerups } : {}), ...(stun ? { stun } : {}) };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons, ...(overrides ? { overrides } : {}) }, voice: 'male' };
  // The fake gun answers the node's liveness probe the way the bench gun does (`$LIFE,0,0,0,*` -> `$HP` at once), so a
  // long quiet stretch on the match clock is not read as a locked-up gun (F272).
  const answers = [];
  const eng = new Engine({ writer: fr => { writes.push(...fr); for (const f of fr) if (f === E.PROBE_LIFE) answers.push(f); }, emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' }];
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster } });
  const frames = { ...golden, player_id: 'p1' };
  // the Shields preset (armour 0, a shield ceiling): the maxima are read back from the head's `$PSET`, so rewrite it there
  if (maxShield) frames.head = frames.head.map(f => f.startsWith('$PSET,') ? f.replace(/^\$PSET,(\d+),(\d+),45,70,0,/, `$PSET,$1,$2,45,0,${maxShield},`) : f);
  eng.onMcMessage({ kind: 'config', body: { config, frames, roster } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, writes, facts,
    adv(ms) { const step = 250; for (let t = 0; t < ms; t += step) { clock += Math.min(step, ms - t); eng.tick(); while (answers.length) { answers.shift(); eng.feedFrame(`$HP,${eng.hp},${eng.armor},${eng.shield},*`); } } return h; },
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
  };
  h.adv(10); h.adv(3000);   // T-0 spawn, then the live life settles
  eng.feedFrame('$HP,45,70,0,*');
  return h;
}
const bmap1 = w => w.filter(f => f.startsWith('$BMAP,1,'));
const grants = w => w.filter(f => /^\$(AMMO|BMAP),/.test(f) || (f.startsWith('$LIFE,') && !E.isPoolProbe(f)));

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

test('the grant: claim_ready, then taker == me: $AMMO for the pickup slot, then the ALT cycle, and a pickup fact, once', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); const n = h.mark(); h.take(4);
  assert.deepEqual(grants(h.since(n)), ['$AMMO,2,2,0,1,*', '$BMAP,1,100,0,1,2,99,*']);
  const f = h.facts.filter(x => x.type === 'pickup');
  assert.equal(f.length, 1); assert.deepEqual({ ...f[0] }, { type: 'pickup', match_id: 'm1', station_id: 4, item_kind: 'weapon', weapon_id: 'rocket_launcher' });
  const s = h.eng.state().powerup;
  assert.equal(s.held.name, 'ROCKETS'); assert.equal(s.held.left, 2); assert.equal(s.hint.kind, 'granted');
  const m = h.mark(); h.adv(1000); h.near(4, { state: 0, value: 108, taker: 7 }); h.adv(1000);
  assert.deepEqual(grants(h.since(m)), [], 'the same taker advert heard again grants nothing more');
  assert.equal(h.facts.filter(x => x.type === 'pickup').length, 1);
});

test('STATION NOT ANSWERING: claim_ready for 3 s and the advert still says available', () => {
  assert.equal(E.POWERUP_NO_ANSWER_MS, 3000);
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); h.near(4); h.adv(1100); h.near(4);
  assert.equal(h.eng.state().powerup.hint.kind, 'claiming');
  h.adv(3100); h.near(4);
  assert.equal(h.eng.state().powerup.hint.kind, 'no_answer');
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

test('weapon grant with ONE loadout weapon skips the empty slot 1 in the ALT cycle', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }], weapons: [{ weapon_id: 'assault_rifle' }] });
  h.at(121); const n = h.mark(); h.take(4);
  assert.deepEqual(bmap1(h.since(n)), ['$BMAP,1,100,0,2,99,99,*']);
});

test('the end of a weapon item: its magazine reaching 0 writes the old ALT cycle back', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); h.take(4); h.away();
  h.adv(800);   // past the grant's own echo window
  h.frame('$BUT,1,1,*').frame('$BUT,1,0,*');
  h.frame('$BUT,0,1,*').frame('$ALCD,1,100,2,0,0,*').frame('$BUT,0,0,*');
  assert.equal(h.eng.state().powerup.held.left, 1);
  assert.equal(h.eng.state().activeSlot, 2);
  assert.equal(h.eng.state().weapon, 'ROCKETS', 'the ammo block names the item while its slot is active');
  const n = h.mark();
  h.frame('$BUT,0,1,*').frame('$ALCD,0,100,2,0,0,*').frame('$BUT,0,0,*');
  assert.deepEqual(bmap1(h.since(n)), [golden.head.find(f => f.startsWith('$BMAP,1,'))]);
  assert.equal(h.eng.state().powerup.held, null);
  assert.equal(h.eng.state().powerup.hint.kind, 'switch', 'the empty pickup slot is still in hand: tell the player to switch');
});

test('the end of a weapon item: a death zeroes the slot and writes the old ALT cycle back (charges are lost at death)', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); h.take(4); h.away();
  const n = h.mark(); h.die();
  const w = h.since(n);
  assert.ok(w.includes('$AMMO,2,0,0,1,*'), 'the pickup slot is zeroed');
  assert.deepEqual(bmap1(w), [golden.head.find(f => f.startsWith('$BMAP,1,'))]);
  assert.equal(E.PU_LOST_AT_DEATH, true);
  assert.equal(h.eng.state().powerup.held, null);
});

test('a second WEAPON pickup swaps the first out: zero the old slot, the ALT cycle with the new slot, then the new charges', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }, { id: 5, kind: 'powerup', item: RAIL }],
    powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }, { weapon_id: 'rail_gun', slot: 3 }] });
  h.at(121); h.take(4);
  const n = h.mark(); h.take(5);
  assert.deepEqual(grants(h.since(n)), ['$AMMO,2,0,0,1,*', '$BMAP,1,100,0,1,3,99,*', '$AMMO,3,2,0,1,*']);
  const s = h.eng.state();
  assert.equal(s.powerup.held.name, 'RAIL GUN');
  assert.equal(s.powerupGrant.replaced, 'ROCKETS', 'the HUD can say RAIL GUN replaces ROCKETS');
  assert.equal(E.PU_WEAPON_SWAPS, true);
  assert.equal(h.facts.filter(f => f.type === 'pickup').length, 2);
});

test('a dead player does not claim', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }] });
  h.at(121); h.die(); h.near(4); h.adv(1500); h.near(4);
  assert.equal(h.eng.state().powerupClaim, null);
  const n = h.mark(); h.near(4, { state: 0, value: 110, taker: 7 });
  assert.deepEqual(h.since(n).filter(f => /^\$(AMMO,2|BMAP,1)/.test(f)), []);
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

test('Easy Reload keeps ALT: an Easy Reload player does not claim a WEAPON item (its grant rewrites ALT), and the HUD says why', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }, { id: 6, kind: 'powerup', item: OVERSHIELD }],
    powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }], overrides: { easy_reload: true } });
  h.at(121); const n = h.mark(); h.near(4); h.adv(1100); h.near(4);
  assert.equal(h.eng.state().powerupClaim, null, 'no claim bits go out for a weapon item');
  assert.equal(h.eng.state().powerup.hint.kind, 'easy_reload');
  h.near(4, { state: 0, value: 110, taker: 7 }); h.adv(300);
  assert.deepEqual(bmap1(h.since(n)), [], 'ALT is never rewritten');
  h.take(6);
  assert.equal(h.facts.filter(f => f.type === 'pickup' && f.item_kind === 'overshield').length, 1, 'an overshield touches no button, so it is still taken');
});

test('M2: no grant while STUNNED (the stun restore would erase it); the ready claim waits and is granted once the stun ends', () => {
  const h = harness({ stations: [{ id: 4, kind: 'powerup', item: ROCKETS }], powerups: [{ weapon_id: 'rocket_launcher', slot: 2 }], stun: { duration_s: 3 } });
  h.at(121); h.near(4); h.adv(1100); h.near(4);
  h.frame('$HIR,4,8,19,2,8,0,0,*');   // an EMP word: the gun is disarmed for 3 s
  assert.ok(h.eng.stunned, 'setup: stunned');
  const n = h.mark(); h.near(4, { state: 0, value: 110, taker: 7 }); h.adv(500); h.near(4, { state: 0, value: 110, taker: 7 });
  assert.deepEqual(grants(h.since(n)).filter(f => /^\$(AMMO,2|BMAP,1)/.test(f)), [], 'nothing granted inside the stun');
  h.adv(3000); h.near(4, { state: 0, value: 106, taker: 7 });
  assert.equal(h.eng.stunned, null, 'setup: the stun is over');
  assert.ok(h.since(n).includes('$AMMO,2,2,0,1,*'), 'granted once the stun ended');
});

test('M3: the overshield waits while a $HP arrived in the last 300 ms, then writes the FRESH pools', () => {
  assert.equal(E.OVERSHIELD_POOL_QUIET_MS, 300);
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.near(6); h.adv(1100);
  h.frame('$HIR,4,0,19,2,9,0,3,*').frame('$HP,45,61,0,*');   // a hit lands in the same breath as the station's answer
  const n = h.mark(); h.near(6, { state: 0, value: 58, taker: 7 });
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f)), [], 'deferred: the pools just moved');
  h.adv(400); h.near(6, { state: 0, value: 58, taker: 7 });
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f)), ['$LIFE,45,61,75,2,*'], 'then granted on the pools the gun reported');
});

test('M3: the overshield waits while a poison tick is unechoed (an absolute set would undo it)', () => {
  const h = harness({ stations: [{ id: 6, kind: 'powerup', item: OVERSHIELD }] });
  h.at(61); h.near(6); h.adv(1100);
  h.eng._dotEcho = { at: h.eng.now(), pool: 'health', n: 4 };   // the node's own tick write, its `$HP` echo not back yet
  const n = h.mark(); h.near(6, { state: 0, value: 58, taker: 7 });
  assert.deepEqual(h.since(n).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f)), []);
  h.eng._dotEcho = null; h.adv(250); h.near(6, { state: 0, value: 58, taker: 7 });
  assert.equal(h.since(n).filter(f => f.startsWith('$LIFE,') && !E.isPoolProbe(f)).length, 1, 'granted once the echo is in');
});
