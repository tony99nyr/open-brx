// F438 (bench 2026-10-02, indoors, TDM red v blue, friendly fire OFF): a sniper's own shot bounced off a wall into his
// OWN headset and killed him. The phone logged "☠ down — by <his own sticker name>" and MC's feed read "<him> went down".
// The gun's own gates (the 124 ms self-hit window, FF-off) did not stop it. Tony's rule: a player's OWN shot must never
// hurt or kill them.
//
// A self-hit is a hit whose `$HIR` token 3 (the shooter's `$PSET` id) is this player's own `player_num`, paired with
// its `$HP` by the same 1000 ms gate every hit uses. Wire id 0 is "unknown" and never self.
//   - non-lethal: one `$LIFE,<dHp>,<dArmor>,<dShield>,*` gives back exactly what the `$HP` took; no fact, no cue.
//   - lethal: the timed respawn's revive write at once, then a negative `$LIFE` back to the pre-hit pools; no death.
//   - a death that does reach `_death` with our own id never names us (`killedBy` reads as unknown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, isPoolProbe } from '../src/engine.js';
import { mkStorage } from './_helpers.mjs';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

// Same shape as engine.test.mjs `harness()`: a synchronous delay, an injected clock, facts and logs captured.
/** Every `$PSET` the bundle carries, at THIS game's pools (shield-spawn.test.mjs `atPools`). */
function atPools(bundle, h) {
  const fix = f => (typeof f === 'string' && f.startsWith('$PSET,')
    ? f.split(',').map((tok, i) => (i === 3 ? String(h.max_hp) : i === 4 ? String(h.max_armor) : i === 5 ? String(h.max_shield) : tok)).join(',') : f);
  return { ...bundle, head: bundle.head.map(fix), pset_pool: (bundle.pset_pool || []).map(fix) };
}
function harness({ health = { max_hp: 45, max_armor: 70 }, config: extra = {} } = {}) {
  const writes = [], facts = [], logs = [], groups = [];
  const bundle = health.max_shield ? atPools(golden, health) : golden;
  let clock = 1_000_000;
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health,
    teams: [team, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }], ...extra };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' }];
  const failing = new Set();   // `why` prefixes whose write the fake link refuses
  const eng = new Engine({ writer: (fr, why) => { groups.push([...fr]); const n = writes.push(...fr); return String(why).startsWith('gun liveness probe') || [...failing].some(p => String(why).startsWith(p)) ? false : n; },
    emit: f => facts.push(f), report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(),
    log: (m, cls) => logs.push({ m: String(m), cls }), delay: (ms, fn) => fn() });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team, roster } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...bundle, player_id: 'p1' }, roster } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick();
  const h = {
    eng, writes, facts, logs, groups, failing,
    adv(ms) { clock += ms; eng.tick(); return h; },
    frame(f) { eng.feedFrame(f); return h; },
    mark() { return writes.length; },
    grants(n) { return writes.slice(n).filter(w => w.startsWith('$LIFE,') && !isPoolProbe(w)); },
    kinds(type) { return facts.filter(f => f.type === type); },
  };
  return h;
}
const SELF = '$HIR,4,0,7,1,9,0,3,*';     // shooter id 7 = this player, team 1 = this player's team
const ENEMY = '$HIR,4,0,19,2,9,0,3,*';   // shooter id 19, team 2
const UNKNOWN = '$HIR,4,0,0,1,9,0,3,*';  // wire id 0: no identity (A5.1)

test('F438 (a): a non-lethal self-hit writes the restoring $LIFE, and MC and the HUD never hear of it', () => {
  const h = harness();
  assert.equal(h.eng.phase, 'live'); assert.equal(h.eng.alive, true);
  const n = h.mark(), facts0 = h.facts.length, hitAt0 = h.eng.lastHitAt;
  h.frame(SELF).frame('$HP,45,61,0,*');
  assert.deepEqual(h.grants(n), ['$LIFE,0,9,0,*'], 'one $LIFE gives back exactly the 9 armour the shot took');
  assert.equal(h.kinds('hit_taken').length, 0, 'no hit_taken fact to MC');
  assert.equal(h.facts.length, facts0, 'no fact of any kind');
  assert.ok(!h.eng.moment || h.eng.moment.kind !== 'hit', 'no hit moment on the HUD');
  assert.equal(h.eng.lastHitAt, hitAt0, 'no "under fire"');
  assert.deepEqual([h.eng.hp, h.eng.armor, h.eng.shield], [45, 70, 0], 'the model is back at the pre-hit pools at once');
  assert.equal(h.eng._life.taken.size, 0, 'no "what hit me" ledger entry');
  assert.ok(h.logs.some(l => l.cls === 'li' && /^self-hit: own shot \(.+\) took 9, restored$/.test(l.m)), 'one li line names the restore');
  // The gun's own echo of the restore is not a heal.
  h.frame('$HP,45,70,0,*');
  assert.ok(!h.eng.moment || h.eng.moment.kind !== 'gain', 'the echo is no "+9 ARMOUR" gain');
  assert.equal(h.facts.length, facts0, 'and still no fact');
});

test('F438 (b): a lethal self-hit revives at once, books no death, and drains back to the pre-hit pools', () => {
  const h = harness();
  h.frame(ENEMY).frame('$HP,45,61,0,*');   // an enemy hit first, so the pre-hit pools are not full
  assert.equal(h.kinds('hit_taken').length, 1);
  h.adv(1500);   // past the 1000 ms pairing window: inside it the drop could be the enemy's (polish r1)
  const n = h.mark(), facts0 = h.facts.length, m0 = h.eng.moment;   // m0: the enemy hit's own moment, still on screen
  h.frame(SELF).frame('$HP,0,0,0,*').frame('$LCD,0,0,0,1,1,1,*');   // a lethal hit sends `$HP,0` then `$LCD,0` (dev.md)
  assert.equal(h.kinds('death').length, 0, 'no death fact');
  assert.equal(h.kinds('respawn').length, 0, 'no respawn fact either: to MC nothing happened');
  assert.equal(h.facts.length, facts0, 'no fact of any kind');
  assert.equal(h.eng.deaths, 0, 'deaths stays 0');
  assert.equal(h.eng.alive, true, 'still alive');
  assert.equal(h.eng.moment, m0, 'no DOWN screen and no REDEPLOYED: the HUD moment is untouched');
  const out = h.writes.slice(n), spawnAt = out.indexOf('$SPAWN,,*');
  assert.ok(spawnAt >= 0, 'the revive write went out');
  const drain = out.indexOf('$LIFE,0,-9,0,*');
  assert.ok(drain > spawnAt, 'the drain follows the revive, so a self-kill never heals');
  assert.deepEqual([h.eng.hp, h.eng.armor, h.eng.shield], [45, 61, 0], 'the model holds the pre-hit pools');
  assert.ok(h.logs.some(l => l.cls === 'le' && l.m === 'self-hit: own shot was lethal, revived at 45/61/0'));
  // The revive's full echo and the drain's echo are neither a heal nor a hit.
  h.frame('$HP,45,70,0,*').frame('$HP,45,61,0,*');
  assert.equal(h.facts.length, facts0, 'the echoes book nothing');
  assert.equal(h.eng.moment, m0, 'no gain, hit or down moment from the echoes');
  // A real kill after the echo window still counts, with the real shooter.
  h.adv(3000);
  h.frame(ENEMY).frame('$HP,0,0,0,*');
  const d = h.kinds('death');
  assert.equal(d.length, 1); assert.equal(d[0].shooter_num, 19); assert.equal(h.eng.deaths, 1);
});

// polish 2026-10-03: a self-kill costs nothing, so it must not refill the magazine either (the revive's `$SPAWN` does)
test('polish 2026-10-03: a lethal self-hit keeps the magazine and reserve the player had', () => {
  const h = harness();
  h.frame('$ALCD,29,100,0,192,0,*');
  assert.deepEqual(h.eng.am.liveAmmo()[0], [29, 192], 'setup: three rounds fired');
  h.adv(1500);
  const n = h.mark();
  h.frame(SELF).frame('$HP,0,0,0,*').frame('$LCD,0,0,0,1,1,1,*');
  assert.equal(h.eng.alive, true, 'setup: revived');
  const out = h.writes.slice(n), spawnAt = out.indexOf('$SPAWN,,*'), keep = out.lastIndexOf('$AMMO,0,29,192,1,*');
  assert.ok(spawnAt >= 0 && keep > spawnAt, `the live count goes out after the revive: ${out.join(' ')}`);
  assert.ok(!out.includes('$AMMO,0,32,192,1,*'), 'and no full magazine goes out at all');
  assert.deepEqual(h.eng.am.liveAmmo()[0], [29, 192], 'the account still holds the pre-hit count');
});

test('polish 2026-10-03: a restore write the link refuses is logged as an error, not passed over', async () => {
  const h = harness();
  h.failing.add('F438 self-hit restore');
  h.frame(SELF).frame('$HP,45,61,0,*');
  await new Promise(r => setImmediate(r));
  assert.ok(h.logs.some(l => l.cls === 'le' && /self-hit: the restore write failed/.test(l.m)), h.logs.map(l => l.m).join(' | '));
});

test('F438 (c): the same frames from ANOTHER player still hurt and kill (the control)', () => {
  const h = harness();
  const n = h.mark();
  h.frame(ENEMY).frame('$HP,45,61,0,*');
  assert.equal(h.grants(n).length, 0, 'no restore for an enemy hit');
  assert.equal(h.kinds('hit_taken').length, 1);
  assert.equal(h.eng.moment && h.eng.moment.kind, 'hit');
  h.adv(500);
  h.frame(ENEMY).frame('$HP,0,0,0,*');
  const d = h.kinds('death');
  assert.equal(d.length, 1); assert.equal(d[0].shooter_num, 19);
  assert.equal(h.eng.alive, false); assert.equal(h.eng.deaths, 1);
  assert.equal(h.eng.killedBy.name, 'VIPER');
});

test('F438 (d): shooter id 0 (unknown) is never treated as a self-hit', () => {
  const h = harness();
  const n = h.mark();
  h.frame(UNKNOWN).frame('$HP,45,61,0,*');
  assert.equal(h.grants(n).length, 0, 'no restore for an unknown shooter');
  assert.equal(h.kinds('hit_taken').length, 1);
  h.adv(500);
  h.frame(UNKNOWN).frame('$HP,0,0,0,*');
  assert.equal(h.kinds('death').length, 1, 'an unknown shooter still kills');
  assert.equal(h.eng.alive, false);
  assert.equal(h.eng.killedBy.unknown, true);
});

test('F438 (e): a death that reaches `_death` with our own id never names us', () => {
  // Outside the 1000 ms pairing gate, so not a self-hit by F438's rule, but still inside DEATH_LATCH_MS.
  const h = harness();
  h.frame(SELF).adv(1500).frame('$HP,0,0,0,*');
  assert.equal(h.kinds('death').length, 1);
  assert.equal(h.eng.killedBy.unknown, true, 'self reads as unknown');
  assert.notEqual(h.eng.killedBy.name, 'REAPER');
  assert.ok(!h.logs.some(l => /down — by REAPER/.test(l.m)), 'the down line never names the player');
});

test('F438 (e2): a lethal self-hit that cannot revive (link down) falls back to a death that names nobody', () => {
  const h = harness();
  h.eng.bleUp = false;
  h.frame(SELF).frame('$HP,0,0,0,*');
  assert.equal(h.kinds('death').length, 1);
  assert.equal(h.eng.killedBy.unknown, true);
  assert.ok(h.logs.some(l => /^self-hit: own shot was lethal, no revive \(.+\)/.test(l.m)), 'the log says why');
});

// ---- polish round 1 ----

test('F438 polish H1: a second $HP,0 inside a lethal self-hit echo window books no death, even after a tick', () => {
  const h = harness();
  h.frame(SELF).frame('$HP,0,0,0,*');
  h.adv(30).frame('$HP,0,0,0,*');   // the gun repeats its zero before it has processed the revive
  h.adv(50).frame('$HP,45,70,0,*');  // then the revive's own echo
  h.adv(50);
  assert.equal(h.kinds('death').length, 0, 'no death fact');
  assert.equal(h.eng.deaths, 0);
  assert.equal(h.eng.alive, true);
  assert.ok(!h.eng.deadAt, 'no respawn clock');
});

test('F438 polish H1 control: a REAL enemy kill inside the echo window still dies', () => {
  const h = harness();
  h.frame(SELF).frame('$HP,0,0,0,*');
  h.adv(300).frame(ENEMY).frame('$HP,0,0,0,*');
  h.adv(50);
  const d = h.kinds('death');
  assert.equal(d.length, 1); assert.equal(d[0].shooter_num, 19);
  assert.equal(h.eng.alive, false);
});

test('F438 polish H2: an enemy word and our own word before one $HP: the drop is a real hit, never given back', () => {
  const h = harness();
  const n = h.mark();
  h.frame(ENEMY).frame(SELF).frame('$HP,45,61,0,*');
  assert.equal(h.grants(n).length, 0, 'no restore: the enemy may have done this damage');
  assert.equal(h.kinds('hit_taken').length, 1, 'the hit reaches MC');
  h.adv(200).frame(ENEMY).frame(SELF).frame('$HP,0,0,0,*');
  assert.equal(h.kinds('death').length, 1, 'and the kill is a death');
  assert.equal(h.eng.deaths, 1); assert.equal(h.eng.alive, false);
});

test('F438 polish M1: a self-hit revive carries no spawn voice line', () => {
  const h = harness();
  const g0 = h.groups.length;   // past the T-0 spawn, which carries its own line
  h.frame(SELF).frame('$HP,0,0,0,*');
  const g = h.groups.slice(g0).find(fr => fr.includes('$SPAWN,,*'));
  assert.ok(g, 'the revive went out');
  assert.ok(!g.some(f => golden.cue_pools.respawned.includes(f)), g.join(' '));
});

test('F438 polish LOW a: on a Shields preset the drain is the LAST frame of the burst, after the shield fill', () => {
  const h = harness({ health: { max_hp: 45, max_armor: 0, max_shield: 105 } });
  h.frame('$HP,45,0,105,*');                            // the spawn fill's answer: full shield
  h.adv(200).frame(ENEMY).frame('$HP,45,0,96,*');       // an enemy takes 9 shield
  h.adv(1500).frame(SELF).frame('$HP,0,0,0,*');         // our own round, lethal, past the enemy's pairing window
  const g = h.groups.find(fr => fr.includes('$SPAWN,,*') && !isPoolProbe(fr.at(-1)) && fr.at(-1).startsWith('$LIFE,0,0,-'));
  assert.ok(g, h.groups.filter(fr => fr.includes('$SPAWN,,*')).map(fr => fr.join(' ')).join(' | '));
  assert.equal(g.at(-1), '$LIFE,0,0,-9,*', 'the drain is last');
  assert.equal(g.at(-2), '$LIFE,0,0,105,*', 'right after the fill');
});

// ---- polish round 2 ----

test('F438 polish r2: only ONE zero `$LCD` is dropped; a later lethal `$LCD` with no `$HIR` (grenade, poison) still kills', () => {
  const h = harness();
  h.frame(SELF).frame('$HP,0,0,0,*').frame('$LCD,0,0,0,1,1,1,*');
  assert.equal(h.eng.alive, true); assert.equal(h.kinds('death').length, 0);
  h.adv(300).frame('$LCD,0,0,0,1,1,1,*');
  assert.equal(h.kinds('death').length, 1, 'the second zero is real');
  assert.equal(h.eng.alive, false);
});

test('F438 polish r2: once the gun reports a live pool after the revive, a zero `$HP` with no `$HIR` is a real death', () => {
  const h = harness();
  h.frame(ENEMY).frame('$HP,45,61,0,*'); h.adv(1500);   // pre-hit pools not full, so the revive's full echo leaves the window open
  h.frame(SELF).frame('$HP,0,0,0,*');
  h.adv(50).frame('$HP,45,70,0,*');   // the revive landed (the drain's echo has not come back yet)
  h.adv(200).frame('$HP,0,0,0,*');   // a grenade with no `$HIR`
  h.adv(50);
  assert.equal(h.kinds('death').length, 1);
  assert.equal(h.eng.alive, false);
  assert.equal(h.eng.killedBy.unknown, true, 'never named after ourselves');
});

test('F438 polish r2: two self-hits before the gun applies the first `$LIFE` never heal', () => {
  const h = harness();
  h.frame(ENEMY).frame('$HP,45,30,0,*'); h.adv(1500);
  const n = h.mark();
  h.frame(SELF).frame('$HP,45,21,0,*'); h.adv(60);
  h.frame(SELF).frame('$HP,45,12,0,*'); h.adv(30);   // the first `$LIFE` has not landed yet
  assert.deepEqual(h.grants(n), ['$LIFE,0,9,0,*', '$LIFE,0,9,0,*'], 'each gives back only its own 9');
  h.frame('$HP,45,21,0,*'); h.adv(30); h.frame('$HP,45,30,0,*'); h.adv(3000);
  assert.deepEqual([h.eng.hp, h.eng.armor], [45, 30], 'back at 30, never above');
  assert.equal(h.kinds('hit_taken').length, 1, 'only the enemy hit');
});

test('F438 polish r2: a poison tick inside the restore echo window is the tick, not an echo', () => {
  const h = harness();
  h.frame(SELF).frame('$HP,45,61,0,*');            // restore in flight
  h.eng._dotEcho = { at: h.eng.now(), pool: 'health', n: 5 };   // our poison tick's `$LIFE,-5,0,0` just went out
  h.frame('$HP,40,61,0,*');                         // the gun answers the tick before the restore
  assert.equal(h.eng._dotEcho, null, 'the tick was matched, so `_dotEcho` is spent');
  assert.equal(h.kinds('hit_taken').length, 0, 'and it is no hit');
});

// ---- polish round 3: frames handled in the same millisecond ----

test('F438 polish r3: an enemy hit in the SAME ms as our restore is a real hit, never taken as our echo', () => {
  const h = harness();
  h.frame(SELF).frame('$HP,45,61,0,*');
  h.frame(ENEMY).frame('$HP,45,52,0,*');   // no clock step: the same millisecond
  const hits = h.kinds('hit_taken');
  assert.equal(hits.length, 1, 'the enemy hit reaches MC');
  assert.equal(hits[0].shooter_num, 19); assert.equal(hits[0].dmg, 9);
});

test('F438 polish r3: two self-hits in the SAME ms each get their own `$LIFE`', () => {
  const h = harness();
  const n = h.mark();
  h.frame(SELF).frame('$HP,45,61,0,*');
  h.frame(SELF).frame('$HP,45,52,0,*');
  assert.deepEqual(h.grants(n), ['$LIFE,0,9,0,*', '$LIFE,0,9,0,*']);
});

// ---- cross-lane review 2026-10-04 #5: a lethal self-hit inside a stun ----

test('cross-lane #5: a lethal self-hit revive inside a stun keeps the stun, and the gun stays disarmed until its expiry', () => {
  const h = harness({ config: { stun: { duration_s: 5 } } });
  h.frame('$ALCD,30,100,0,192,0,*');   // two rounds fired: the account holds 30
  h.frame('$HIR,4,8,19,2,15,0,0,*');   // the enemy EMP
  assert.ok(h.eng.stunned, 'setup: stunned');
  h.adv(1500);
  const n = h.mark();
  h.frame(SELF).frame('$HP,0,0,0,*').frame('$LCD,0,0,0,0,30,192,*');
  assert.equal(h.eng.alive, true, 'setup: revived');
  assert.ok(h.eng.stunned, 'F438: the self-kill never happened, so the stun it interrupted goes on');
  const out = h.writes.slice(n), ammo = out.filter(f => f.startsWith('$AMMO,'));
  assert.ok(out.includes('$SPAWN,,*'), 'setup: the revive burst went out');
  assert.ok(ammo.length > 0 && ammo.every(f => /^\$AMMO,\d+,0,0,/.test(f)), `the revive burst re-arms nothing while stunned: ${ammo.join(' ')}`);
  assert.deepEqual(h.eng.am.liveAmmo()[0], [30, 192], 'the account still holds the live count for the restore');
  const m = h.mark();
  h.adv(4000);
  assert.equal(h.eng.stunned, null, 'the stun ends on its own clock');
  assert.ok(h.writes.slice(m).includes('$AMMO,0,30,192,1,*'), `the expiry restore gives back the live count: ${h.writes.slice(m).join(' ')}`);
});
