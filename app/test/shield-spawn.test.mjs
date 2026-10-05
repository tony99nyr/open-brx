// F348: the Shields preset spawns at FULL shield (Tony, live match 2026-09-24, app 0.4.11: "after spawn and after you
// are vulnerable then they power up. you can die from a couple hits right after spawn"). Halo's rule: every life
// starts with the shield up.
//
// On hardware `$SPAWN` leaves the shield POOL at 0 ($PSET t5 is a ceiling, never a starting value; bench 2026-08-27,
// and the field read-back `$LIFE,0,0,0,*` -> `$HP,45,0,0,*`). So the node writes one additive `$LIFE,0,0,<max>,*`
// at the end of every spawn and revive burst (the T-0 spawn, a timed revive, a station revive) in a shields game,
// and the pool is full from the first frame of the life. Ending spawn PROTECTION (t8 back to 0 and the headset
// protection light off) never touches the pool.
//
// "Shield" has two meanings in this file's neighbourhood: the shield POOL (`$PSET` t5, `$HP` t3), and the station's
// spawn-protection LIGHT (`respawn_profile.shield_on/shield_off`, a headset blink). These tests are about the POOL.
//
// Mirrors: mcp/tests/test_stage_mirror.py (the stage predicts this phone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, isPoolProbe } from '../src/engine.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const SHIELDS = { max_hp: 45, max_armor: 0, max_shield: 105 };   // compile.HEALTH_PRESETS['shields']
const STANDARD = { max_hp: 45, max_armor: 70, max_shield: 0 };
const FILL = '$LIFE,0,0,105,*';

/** Every `$PSET` the bundle carries, at THIS game's pools (the node reads its ceilings off the compiled head). */
function atPools(bundle, h) {
  const fix = f => (typeof f === 'string' && f.startsWith('$PSET,')
    ? f.split(',').map((tok, i) => (i === 3 ? String(h.max_hp) : i === 4 ? String(h.max_armor) : i === 5 ? String(h.max_shield) : tok)).join(',') : f);
  return { ...bundle, head: bundle.head.map(fix), pset_pool: (bundle.pset_pool || []).map(fix) };
}

function harness({ health = SHIELDS, respawn = 'auto', fill = 'echo', head = [] } = {}) {
  const writes = [], writeGroups = [], facts = []; let scheduledGap = null; let clock = 1_000_000;
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const bundle0 = atPools(golden, health), bundle = { ...bundle0, head: [...bundle0.head, ...head] };
  const config = { config_id: bundle.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: respawn, delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: fr => { const frames = [...fr]; writes.push(...frames); writeGroups.push({ frames, gapMs: scheduledGap }); scheduledGap = null; }, emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => { scheduledGap = ms; fn(); scheduledGap = null; }, rng: () => 0 });
  // The gun's side of every pool write: a `$SPAWN` empties the shield, a `$LIFE` grant adds and clamps, and the
  // gun answers the grant with `$HP` (bench 2026-09-09). Played after each tick, so the node sees what a real gun says.
  // `fill` is what the gun does with the FIRST spawn fill: 'echo' (takes it and answers), 'silent' (takes it, and its
  // `$HP` is lost) or 'lost' (the write never reaches the pool). Every later grant is answered.
  const gun = { hp: 0, armor: 0, shield: 0, seen: 0, fill };
  const answer = () => {
    while (gun.seen < writes.length) {
      const f = writes[gun.seen++];
      if (f === '$SPAWN,,*') { gun.hp = health.max_hp; gun.armor = health.max_armor; gun.shield = 0; }
      else if (f.startsWith('$LIFE,') && !isPoolProbe(f)) {
        const t = f.split(','), first = gun.fill; gun.fill = 'echo';
        if (first === 'lost') continue;
        gun.shield = Math.max(0, Math.min(health.max_shield, gun.shield + (+t[3] || 0)));
        if (first === 'silent') continue;
        eng.feedFrame(`$HP,${gun.hp},${gun.armor},${gun.shield},*`);
      }
    }
  };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  const h = {
    eng, writes, writeGroups, gun, facts,
    hits() { return facts.filter(f => f.type === 'hit_taken'); },
    /** A foreign hit of `dmg`: the gun drains shield, then armour, then health, and reports the pools. */
    hit(dmg, shooter = 19) {
      let d = dmg; const s = Math.min(gun.shield, d); gun.shield -= s; d -= s; const a = Math.min(gun.armor, d); gun.armor -= a; d -= a; gun.hp = Math.max(0, gun.hp - d);
      h.frame(`$HIR,4,0,${shooter},2,${dmg},0,3,*`); return h.frame(`$HP,${gun.hp},${gun.armor},${gun.shield},*`);
    },
    adv(ms, step = 50) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); eng.tick(); answer(); } return h; },
    frame(f) { eng.feedFrame(f); answer(); return h; },
    mark() { return writes.length; },
    since(n) { return writes.slice(n); },
    cues(n, key) { const f = bundle.cues[key]; return h.since(n).filter(w => w === f).length; },
    grants(n) { return h.since(n).filter(w => w.startsWith('$LIFE,') && !isPoolProbe(w)); },
    die() { h.frame('$HIR,4,0,19,2,9,0,3,*'); gun.hp = 0; gun.armor = 0; gun.shield = 0; h.frame('$HP,0,0,0,*'); return h; },
  };
  h.startAt = writes.length;
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: bundle.config_id, seq: 1, countdown_s: 0 } });
  answer();
  return h;
}
const stationEntry = () => ({ role: 'station', id: 5, kind: 'respawn', team: 1, state: 1, value: 0, seq: 0, game: 0, threshold: -60, rssi: -50, raw: -50, present: true });

test('F348: the T-0 spawn of a Shields game starts at FULL shield (105), with no recharge and no "shields online"', () => {
  const h = harness();
  const n = h.startAt;
  h.adv(100);
  const burst = h.since(n);
  const s = burst.indexOf('$SPAWN,,*');
  assert.ok(s >= 0, 'setup: the T-0 spawn went out');
  assert.ok(burst.indexOf(FILL) > s, `the spawn burst fills the shield after $SPAWN: ${JSON.stringify(burst)}`);
  assert.equal(h.eng.shield, 105, 'the pool is full from the start of the life');
  h.adv(12000);
  assert.deepEqual(h.grants(n), [FILL], 'one fill, and no recharge grants afterwards');
  assert.equal(h.cues(n, 'shield_charging'), 0, 'no charge-up sound at spawn');
  assert.equal(h.cues(n, 'shield_online'), 0, 'a spawn is not a recharge: no SHIELDS ONLINE');
  assert.equal(h.eng.shield, 105);
});

test('F348: a timed revive starts at FULL shield too', () => {
  const h = harness();
  h.adv(5000).die();
  assert.equal(h.eng.alive, false, 'setup: down');
  h.adv(7900);
  const n = h.mark();
  h.adv(300);
  assert.equal(h.eng.alive, true, 'setup: revived by the timer');
  const burst = h.since(n);
  assert.ok(burst.indexOf(FILL) > burst.indexOf('$SPAWN,,*'), `the revive burst fills the shield: ${JSON.stringify(burst)}`);
  assert.equal(h.eng.shield, 105);
  h.adv(12000);
  assert.equal(h.cues(n, 'shield_online'), 0);
  assert.equal(h.cues(n, 'shield_charging'), 0);
  assert.equal(h.eng.shield, 105);
});

test('F348: a station revive starts at FULL shield and stays there when spawn protection ends', () => {
  const h = harness({ respawn: 'scanner' });
  h.adv(5000).die();
  h.adv(9000);
  h.eng.setStations([stationEntry()]);
  const n = h.mark();
  h.frame('$BUT,0,1,*'); h.frame('$BUT,0,0,*');
  assert.equal(h.eng.alive, true, 'setup: revived at the station');
  h.adv(100);
  assert.equal(h.eng.shield, 105, 'full at the revive');
  const p = h.mark();
  h.adv(2500);   // station protection is 2 s: t8 back to 0 and the protection light off
  const end = h.since(p);
  assert.ok(end.includes('$TMP,,,,,,,,0,,,,*'), 'setup: spawn protection ended');
  assert.deepEqual(h.grants(p), [], 'ending protection writes nothing to the pool');
  assert.equal(h.eng.shield, 105, 'the pool is still full after protection ends');
  h.adv(12000);
  assert.deepEqual(h.grants(n), [FILL], 'no recharge after it either');
  assert.equal(h.cues(n, 'shield_online'), 0);
});

test('F348 control: the Standard preset (no shield) spawns and revives exactly as before, with no pool write', () => {
  const h = harness({ health: STANDARD });
  const n = h.startAt;
  h.adv(100);
  h.adv(5000).die();
  h.adv(8300);
  assert.equal(h.eng.alive, true, 'setup: revived');
  assert.deepEqual(h.grants(n), [], 'no $LIFE grant in a game without a shield');
  assert.equal(h.eng.shield, 0);
});

test('F348 control: a shield broken in play still recharges the old way (and, Tony 2026-09-24, says no SHIELDS ONLINE)', () => {
  const h = harness();
  h.adv(3000);
  h.gun.shield = 0; h.frame('$HIR,4,0,19,2,105,0,3,*'); h.frame('$HP,45,0,0,*');
  assert.equal(h.eng.shield, 0, 'setup: the shield broke');
  const n = h.mark();
  h.adv(15000);
  assert.equal(h.eng.shield, 105, 'the recharge refilled it');
  assert.equal(h.cues(n, 'shield_charging'), 1);
  assert.equal(h.cues(n, 'shield_online'), 0, 'the shields-online line is gone (docs/announcer.md)');
});

// ---------- integration review 2026-09-24 (X1, X3, X5, X6, X7): the fill against the audio model and the pool repair ----------
const REPAIRS = (h, n) => h.since(n).filter(w => /^\$LIFE,\d+,\d+,\d+,1,\*$/.test(w));

// F437 + F416 (2026-10-02): rewritten. The klaxon and the spawn line now go as ONE two-slot frame (Callsign's game-end
// form), so the queue-slot line never waits on the phone and the burst settles at once.
test('X3/F437: the klaxon and the spawn line go as one two-slot frame, before the fill, and nothing interrupts after it', () => {
  const h = harness();
  const burst = h.since(h.startAt);
  const kxId = golden.cues.klaxon.split(',')[1];
  const both = burst.findIndex(f => f.startsWith(`$PLAY,${kxId},4,6,`) && !!f.split(',')[4]);
  const fill = burst.indexOf(FILL);
  assert.ok(both >= 0 && fill >= 0, `setup: the two-slot frame and the fill went out: ${JSON.stringify(burst)}`);
  assert.ok(both < fill, `the sounds precede the fill: ${JSON.stringify(burst)}`);
  assert.ok(!burst.includes(golden.cues.klaxon), 'no separate klaxon frame');
  const sf = burst.indexOf('$SFLASH,*');   // the countdown line before the burst is not part of it
  assert.equal(burst.slice(sf).filter(f => f.startsWith('$PLAY,')).length, 1, `one $PLAY in the spawn burst: ${JSON.stringify(burst)}`);
  assert.ok(burst.slice(both + 1).every(f => !f.startsWith('$PLAY') ), 'no interrupt-slot $PLAY or $PLAYX follows the line');
  const ids = h.eng._gun.clips.map(c => c.id);
  assert.ok(ids.includes(kxId) && ids.includes(burst[both].split(',')[4]), `the model holds the klaxon and the line: ${ids}`);
  assert.ok(ids.indexOf(kxId) < ids.indexOf(burst[both].split(',')[4]), 'the klaxon plays first, the line queued behind it');
});

test('X3: a revive puts its line before the fill', () => {
  const h = harness();
  h.adv(5000).die();
  h.adv(7900);
  h.gun.seen = Infinity;   // the gun goes quiet: the fill is not answered
  const n = h.mark();
  h.adv(300);
  assert.equal(h.eng.alive, true, 'setup: revived');
  const burst = h.since(n);
  assert.ok(burst.indexOf(golden.cues.respawned) < burst.indexOf(FILL), `the line before the fill: ${JSON.stringify(burst)}`);
  assert.equal(h.eng.shield, 0, 'setup: no echo yet');
});

test('F348: after a revive, the fill echo ends the fill window before a later shield break', () => {
  const h = harness();
  h.adv(5000).die();
  h.adv(7900);
  h.adv(300);
  assert.equal(h.eng.alive, true, 'setup: revived');
  assert.equal(h.eng.shield, 105, 'setup: the fill was answered');
  assert.equal(h.eng._shieldFillAt, 0, 'the answer ended the window, even inside the redeploy moment');
  h.adv(200);
  h.gun.shield = 0; h.frame('$HIR,4,0,19,2,105,0,3,*'); h.frame('$HP,45,0,0,*');
  assert.equal(h.eng.shield, 0, 'setup: the shield broke');
});

test('X1: the game_over line is written at the whistle while the shield is up', () => {
  const h = harness();
  h.adv(3000);
  assert.equal(h.eng.shield, 105, 'setup: full shield');
  const n = h.mark();
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.ok(h.since(n).includes('$CLEAR,*'), 'setup: the end frames went out');
  assert.equal(h.cues(n, 'game_over'), 1, `the whistle line went out: ${JSON.stringify(h.since(n))}`);
});

test('X6: a pool repair before the fill echo keeps the full shield', () => {
  const h = harness();
  h.adv(5000).die();
  h.adv(7900);
  h.gun.seen = Infinity;   // the fill is not answered
  h.adv(300);
  assert.equal(h.eng.alive, true, 'setup: revived');
  const n = h.mark();
  h.eng.feedFrame('$HP,90,0,0,*');   // a misread $PSET: hp above the ceiling, the fill echo not here yet
  h.adv(1500);
  const r = REPAIRS(h, n);
  assert.ok(r.length >= 1, `setup: a repair went out: ${JSON.stringify(h.since(n))}`);
  assert.equal(r[0], '$LIFE,45,0,105,1,*', 'the repair keeps the shield the fill gave');
});

test('X5: a pool repair in a no-armour game keeps the armour the gun reports', () => {
  const h = harness();
  h.adv(3000);
  h.gun.seen = Infinity;
  const n = h.mark();
  h.eng.feedFrame('$HP,90,20,105,*');   // hp over the ceiling; armour 20 in a game that arms 0 is a state, not an error
  h.adv(1500);
  const r = REPAIRS(h, n);
  assert.ok(r.length >= 1, `setup: a repair went out: ${JSON.stringify(h.since(n))}`);
  assert.equal(r[0], '$LIFE,45,20,105,1,*');
});

test('X7: a shield grant in a no-shield game is not a pool fault (no repair)', () => {
  const h = harness({ health: STANDARD });
  h.adv(3000);
  h.gun.seen = Infinity;
  const n = h.mark();
  h.eng.feedFrame('$HP,45,70,30,*');
  h.adv(1500);
  assert.deepEqual(REPAIRS(h, n), [], 'no repair write');
  assert.equal(h.eng._poolRepair, null);
});

// ---------- the fill's `$HP` lost (review 2026-10-04): the first real hit of the life must still be a hit ----------
// The gun takes the spawn fill but its answering `$HP` never arrives, so the node still holds shield 0. The first hit's
// `$HP` then reports the shield ABOVE what the node held. Measured from 0 it is a "+90 SHIELD" gain, no `hit_taken`
// reaches MC and the shooter loses the hit. The fill stays pending until a `$HP` shows the shield (no fixed window),
// and a hit while it is pending is measured from the full shield.
for (const [label, wait] of [['inside the old 5 s window', 1000], ['after the old 5 s window', 5500]]) {
  test(`fill echo lost, ${label}: the first hit off the filled shield is a hit, not a "+90 SHIELD" gain`, () => {
    const h = harness({ fill: 'silent' });
    h.adv(wait);
    assert.equal(h.gun.shield, 105, 'setup: the gun took the fill');
    assert.equal(h.eng.shield, 0, 'setup: its `$HP` never arrived');
    h.hit(15);
    const hits = h.hits();
    assert.equal(hits.length, 1, 'one hit_taken fact reaches MC');
    assert.equal(hits[0].dmg, 15, 'booked at the damage the shield took');
    assert.equal(hits[0].shooter_num, 19);
    assert.equal(h.eng.moment && h.eng.moment.kind, 'hit', `the HUD shows a hit: ${JSON.stringify(h.eng.moment)}`);
    assert.equal(h.eng.shield, 90);
    assert.equal(h.eng._shieldFillAt, 0, 'the frame that showed the shield ended the fill');
    const n = h.mark();
    h.hit(15);
    assert.equal(h.hits().length, 2, 'the next hit is ordinary');
    assert.equal(h.hits()[1].dmg, 15);
    h.adv(12000);
    assert.equal(h.eng.shield, 105, 'the recharge refills it');
    assert.ok(h.grants(n).length >= 1, 'by the ordinary recharge');
  });
}

test('fill echo lost: a hit that breaks the whole filled shield is a hit of 105, and the shield-break cue plays', () => {
  const h = harness({ fill: 'silent' });
  h.adv(1000);
  h.hit(105);
  assert.equal(h.gun.shield, 0, 'setup: the shield broke on the gun');
  assert.deepEqual(h.hits().map(f => f.dmg), [105], 'the `$HIR` magnitude says the shield was there to break');
  assert.equal(h.eng._shieldDown, true, 'the break is the `>0 -> 0` edge');
  assert.equal(h.eng._shieldFillAt, 0);
});

test('fill write lost (the gun never filled): a hit on the empty shield is booked at what it took, and the recharge is no hit', () => {
  const h = harness({ fill: 'lost' });
  h.adv(1000);
  assert.equal(h.gun.shield, 0, 'setup: no fill on the gun');
  h.hit(15);
  assert.deepEqual(h.hits().map(f => f.dmg), [15], 'measured from the pools the node held, not the full shield');
  assert.equal(h.eng.hp, 30);
  assert.ok(h.eng._shieldFillAt > 0, 'the fill is still unanswered');
  const facts = h.facts.length;
  h.adv(12000);
  assert.equal(h.eng.shield, 105, 'the recharge fills the pool');
  assert.equal(h.facts.slice(facts).filter(f => f.type === 'hit_taken').length, 0, 'a recharge grant is never a hit');
  assert.notEqual(h.eng.moment && h.eng.moment.kind, 'hit');
  assert.equal(h.eng._shieldFillAt, 0, 'the first grant that showed a shield ended the fill');
});

test('control: the fill echo arrives, then a hit: one hit of 15, and the echo is no gain', () => {
  const h = harness();
  h.adv(1000);
  assert.equal(h.eng.shield, 105, 'setup: echo arrived');
  h.hit(15);
  assert.deepEqual(h.hits().map(f => f.dmg), [15]);
});

test('fill echo lost: our own shot off the filled shield is given back, never a hit', () => {
  const h = harness({ fill: 'silent' });
  h.adv(1000);
  const n = h.mark();
  h.hit(15, 7);   // shooter 7 is this player
  assert.equal(h.hits().length, 0, 'a self-hit never reaches MC');
  assert.deepEqual(h.grants(n), ['$LIFE,0,0,15,*'], `the 15 it took is given back: ${JSON.stringify(h.since(n))}`);
  assert.equal(h.gun.shield, 105, 'the gun is full again');
});

// ---------- polish r1 (H1): only a damaging word that no `$HP` has paired yet says a hit landed off the filled shield ----------
const GRANT_ROW = '$SIR,7,0,,11,0,0,1,,*';   // a shield-grant cell (fn 11 is in SIR_GRANT_FNS)

test('R2: fill write lost, a hit of 9, then the first recharge grant\'s echo within 1 s: no phantom hit, and the recharge runs on', () => {
  const h = harness({ fill: 'lost' });
  h.adv(1000);
  h.hit(9);
  assert.deepEqual(h.hits().map(f => f.dmg), [9], 'setup: the hit');
  const m = h.eng.moment;
  h.gun.shield = 27; h.frame(`$HP,${h.gun.hp},0,27,*`);   // the grant's echo, 300 ms later on a real gun
  assert.deepEqual(h.hits().map(f => f.dmg), [9], 'the grant echo is no hit: its word was already paired');
  assert.equal(h.eng.moment, m, 'no new hit moment');
  assert.equal(h.eng.shield, 27);
});

test('R3: fill write lost, a hit of 40, then a heal of 40 within 1 s: no phantom hit', () => {
  const h = harness({ fill: 'lost' });
  h.adv(1000);
  h.hit(40);
  h.gun.hp += 40; h.frame(`$HP,${h.gun.hp},0,0,*`);
  assert.deepEqual(h.hits().map(f => f.dmg), [40]);
  assert.equal(h.eng.hp, 45);
  assert.ok(h.eng._shieldFillAt > 0, 'the fill is still pending');
});

test('fill write lost: a shield GRANT word is no damage, so its 20 is not read as an 85-point hit', () => {
  const h = harness({ fill: 'lost', head: [GRANT_ROW] });
  h.adv(1000);
  h.frame('$HIR,4,7,19,2,20,0,0,*'); h.gun.shield = 20; h.frame('$HP,45,0,20,*');
  assert.deepEqual(h.hits(), [], 'no hit_taken');
  assert.notEqual(h.eng.moment && h.eng.moment.kind, 'hit');
  assert.equal(h.eng.shield, 20);
});
