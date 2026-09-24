// S56 "what hit me" (2026-09-23): the phone-side half -- resolving the shooter's weapon off the wire contract's
// `RosterEntry.weapons[].hir` (the loadout) / `WeaponView.hir` (the wider catalogue, a pickup) magnitude tables
// (F315: and their `cells`, the (proto, subtype, mag) each weapon puts on the wire),
// and a per-life ledger of damage taken and dealt for the HUD. HUD information only, never a game rule: MC's
// own scoring never reads any of it, so there is nothing here for `mcp/brx_mcp/stage/stage.py` to mirror (see
// `KNOWN_UNMIRRORED` in mcp/tests/test_stage_mirror.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

// The shooter (player_num 19, team yellow/tid 2) every test fires from, unless it needs its own loadout.
const SHOOTER = { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow',
  weapons: [{ weapon_id: 'assault_rifle', hir: [9] }] };

function harness({ shooter = SHOOTER, catalog = null, dualEmitters = null } = {}) {
  const writes = []; const facts = []; let clock = 1_000_000;
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, shooter];
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn() });
  const bundle = { ...golden, player_id: 'p1' };
  if (dualEmitters) bundle.dual_emitters = dualEmitters;
  const h = {
    eng, writes, facts, now: () => clock,
    adv(ms) { clock += ms; eng.tick(); return h; },
    frame(f) { eng.feedFrame(f); return h; },
    kit() { eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); eng.onMcMessage({ kind: 'assign', body: { player, team, roster, catalog } }); return h; },
    config_() { eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } }); return h; },
    echo() { eng.feedFrame('$LCD,0,0,0,0,0,0,*'); return h; },
    start(runwayMs = 0) { eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock + runwayMs, config_id: golden.config_id, seq: 1, countdown_s: Math.round(runwayMs / 1000) } }); return h; },
    live() { h.kit().config_().echo().start(0); h.adv(10); eng.tick(); return h; },
    // `$HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<magnitude>,<crit>,<subtype>,*` -- always from SHOOTER.
    hir(sensor, proto, mag, crit, subtype) { eng.feedFrame(`$HIR,${sensor},${proto},${shooter.player_num},2,${mag},${crit},${subtype},*`); return h; },
    feedback(body) { eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', ...body } }); return h; },
  };
  return h;
}

test('unique loadout resolution: the shooter\'s own weapon matches its hir magnitude', () => {
  const h = harness(); h.live();
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,45,61,0,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.equal(hit.weapon_id, 'assault_rifle');
  assert.deepEqual(h.eng.moment.data.weapon, { id: 'assault_rifle', name: 'assault_rifle', source: 'loadout' });
  const taken = h.eng.state().life.taken;
  assert.equal(taken[0].weapons[0].weapon_id, 'assault_rifle');
});

test('ambiguity: two loadout weapons sharing a magnitude resolve to neither, and the fact carries no weapon_id', () => {
  const shooter = { ...SHOOTER, weapons: [{ weapon_id: 'assault_rifle', hir: [9] }, { weapon_id: 'smg', hir: [9] }] };
  const h = harness({ shooter }); h.live();
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,45,61,0,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.equal(hit.weapon_id, undefined, 'never guessed onto the wire');
  assert.deepEqual(h.eng.moment.data.weapon, { ambiguous: true, names: ['assault_rifle', 'smg'] });
  const taken = h.eng.state().life.taken;
  assert.equal(taken[0].weapons[0].weapon_id, null);
  assert.equal(taken[0].weapons[0].ambiguous, true);
  assert.equal(taken[0].dmg, 9, 'the damage still counts even though the weapon does not');
});

const CATALOG = [
  { weapon_id: 'assault_rifle', name: 'ASSAULT RIFLE', hir: [9] },
  { weapon_id: 'shotgun', name: 'SHOTGUN', hir: [20] },
];

test('catalogue fallback: a pickup magnitude outside the loadout resolves off the wider catalogue', () => {
  const h = harness({ catalog: { weapons: CATALOG } }); h.live();
  h.hir(4, 0, 20, 0, 3); h.frame('$HP,45,50,0,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.equal(hit.weapon_id, 'shotgun');
  assert.deepEqual(h.eng.moment.data.weapon, { id: 'shotgun', name: 'SHOTGUN', source: 'catalog' });
});

test('unknown magnitude: nothing in the loadout or the catalogue claims it', () => {
  const h = harness({ catalog: { weapons: CATALOG } }); h.live();
  h.hir(4, 0, 77, 0, 3); h.frame('$HP,45,60,0,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.equal(hit.weapon_id, undefined);
  assert.equal(h.eng.moment.data.weapon, null);
});

test('no weapons on the roster (an older MC): no claim at all, not even "unknown"', () => {
  const shooter = { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' };   // no `weapons` field
  const h = harness({ shooter }); h.live();
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,45,61,0,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.equal(hit.weapon_id, undefined);
  assert.equal(h.eng.moment.data.weapon, null);
  assert.equal(h.eng._resolveHitWeapon(h.eng.latch), null, 'the resolver itself returns null, not an "unknown" object');
});

test('a two-word weapon (dual-emitter pair) books as ONE hit with the summed damage', () => {
  const shooter = { ...SHOOTER, weapons: [{ weapon_id: 'smg', hir: [8, 1] }] };
  const h = harness({ shooter, dualEmitters: [{ proto: 0, subtype: 0, body: 8, headset: 1, cycle_ms: 100 }] });
  h.live();
  h.hir(4, 0, 8, 0, 0); h.frame('$HP,45,62,0,*');   // the body word: armor 70 -> 62, dmg 8
  h.adv(90);
  h.hir(0, 0, 1, 0, 0); h.frame('$HP,45,61,0,*');   // the headset word: armor 62 -> 61, dmg 1
  const hits = h.facts.filter(f => f.type === 'hit_taken');
  assert.equal(hits.length, 2, 'MC still sees both wire facts, paired by shot_group');
  assert.equal(hits[0].shot_group, hits[1].shot_group);
  assert.equal(hits[0].weapon_id, 'smg'); assert.equal(hits[1].weapon_id, 'smg');
  const taken = h.eng.state().life.taken;
  assert.equal(taken.length, 1);
  assert.equal(taken[0].hits, 1, 'one physical shot, not two');
  assert.equal(taken[0].dmg, 9, 'the two words summed');
  assert.equal(taken[0].weapons.length, 1);
  assert.equal(taken[0].weapons[0].weapon_id, 'smg');
  assert.equal(taken[0].weapons[0].dmg, 9);
});

test('Charge Rifle: both the tap (16) and the full charge (70) magnitude resolve to the same weapon', () => {
  const shooter = { ...SHOOTER, weapons: [{ weapon_id: 'charge_rifle', hir: [16, 70] }] };
  const h = harness({ shooter }); h.live();
  h.hir(4, 0, 16, 0, 5); h.frame('$HP,45,54,0,*');   // the tap: armor 70 -> 54, dmg 16
  assert.equal(h.facts.find(f => f.type === 'hit_taken').weapon_id, 'charge_rifle');
  h.adv(2000);
  h.hir(4, 0, 70, 0, 5); h.frame('$HP,45,0,0,*');    // the full charge: armor 54 -> 0, dmg 54 (never lethal here)
  const hits = h.facts.filter(f => f.type === 'hit_taken');
  assert.equal(hits[hits.length - 1].weapon_id, 'charge_rifle');
  const taken = h.eng.state().life.taken;
  assert.equal(taken[0].hits, 2);
  assert.equal(taken[0].dmg, 70);
});

test('per-life reset: the ledger empties on revive, and the finished life is snapshotted as lastLife', () => {
  const h = harness(); h.live();
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,45,61,0,*');
  assert.equal(h.eng.state().life.taken.length, 1);
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,0,0,0,*');   // the killing hit
  assert.equal(h.eng.alive, false);
  const st = h.eng.state();
  assert.equal(st.life.taken.length, 0, 'a fresh, empty ledger for the down state');
  assert.equal(st.lastLife.taken.length, 1, 'the finished life is snapshotted');
  assert.equal(st.lastLife.taken[0].num, 19);
  h.adv(8000);   // the auto respawn (config: delay_s 8)
  assert.equal(h.eng.alive, true, 'setup: revived');
  const st2 = h.eng.state();
  assert.equal(st2.life.taken.length, 0, 'the new life starts empty too');
  assert.equal(st2.lastLife.taken.length, 1, 'lastLife survives until the NEXT death');
});

test('per-life reset: an operator FORCE RESPAWN on a still-alive player resets the ledger too (no death, so `_death` never ran)', () => {
  const h = harness(); h.live();
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,45,61,0,*');
  assert.equal(h.eng.state().life.taken.length, 1, 'setup: the ledger is not empty');
  assert.equal(h.eng.alive, true, 'setup: still alive — this respawn does not go through `_death`');
  h.eng.control({ cmd: 'respawn', match_id: 'm1', player_id: 'p1' });
  assert.equal(h.eng.alive, true);
  assert.equal(h.eng.state().life.taken.length, 0, 'the forced respawn is a new life too');
});

test('dealt booking: a feedback{kind:"hit"} relay books into the running life', () => {
  const h = harness({ catalog: { weapons: CATALOG } }); h.live();
  const t = h.now();
  h.feedback({ kind: 'hit', t, victim: 'p9', victim_num: 21, victim_display: 'GHOST', dmg: 12, weapon_id: 'assault_rifle' });
  const st = h.eng.state();
  assert.equal(st.life.dealt.length, 1);
  assert.equal(st.life.dealt[0].victim, 'p9');
  assert.equal(st.life.dealt[0].name, 'GHOST');
  assert.equal(st.life.dealt[0].dmg, 12);
  assert.equal(st.life.dealt[0].weapons[0].weapon_id, 'assault_rifle');
  assert.equal(st.life.dealt[0].weapons[0].name, 'ASSAULT RIFLE');
});

test('dealt booking, older-life case: a straggling relay for the life that just ended updates lastLife, not the new one', () => {
  const h = harness(); h.live();
  const beforeDeath = h.now();
  h.adv(50);
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,0,0,0,*');   // die 50 ms after `beforeDeath` -- the new (down) life starts here
  h.adv(500);   // still inside FEEDBACK_MAX_AGE_MS of `beforeDeath`, and inside lastLife's window
  h.feedback({ kind: 'hit', t: beforeDeath, victim: 'p9', victim_num: 21, dmg: 5 });
  const st = h.eng.state();
  assert.equal(st.life.dealt.length, 0, 'nothing books into the fresh (down) life');
  assert.equal(st.lastLife.dealt.length, 1, 'the finished life gets it instead');
  assert.equal(st.lastLife.dealt[0].dmg, 5);
});

test('dealtPartial: true within the 2 s death grace, even when the MC link never dropped', () => {
  const h = harness(); h.live();
  h.eng.setWsState('bound'); h.eng._resetLifeLedger();   // a clean, bound-throughout baseline for this life
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.state().lastLife.dealtPartial, true, 'inside the 2 s grace');
  h.adv(2100);
  assert.equal(h.eng.state().lastLife.dealtPartial, false, 'grace elapsed, and the link held throughout: final');
});

test('dealtPartial: true for the rest of the life (and its snapshot) once the MC link has ever been unbound', () => {
  const h = harness(); h.live();
  h.eng.setWsState('bound'); h.eng._resetLifeLedger();
  assert.equal(h.eng.state().life.dealtPartial, false);
  h.eng.setWsState('offline'); h.eng.setWsState('bound');   // a drop and a reconnect, mid-life
  assert.equal(h.eng.state().life.dealtPartial, true, 'the running life carries the drop');
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,0,0,0,*');
  h.adv(2100);   // well past the grace
  assert.equal(h.eng.state().lastLife.dealtPartial, true, 'the drop, not the grace, is why this stays partial');
});

// Polish round 1 (2026-09-23): a victim that flushes its facts late still landed the hit, so the relay books whatever
// its age (the FEEDBACK_MAX_AGE_MS gate is for kill sounds), and a two-word shot relayed as two facts counts once.
test('dealt booking: a relay older than FEEDBACK_MAX_AGE_MS still books into its life', () => {
  const h = harness(); h.live();
  const t = h.now(); h.adv(10_000);
  h.feedback({ kind: 'hit', t, victim: 'p9', victim_num: 21, dmg: 7 });
  assert.equal(h.eng.state().life.dealtTotal, 7);
});
test('dealt booking: two relays with the same shot_group are one hit, a new shot_group is another', () => {
  const h = harness(); h.live();
  const t = h.now();
  h.feedback({ kind: 'hit', t, victim: 'p9', victim_num: 21, dmg: 8, shot_group: 'g1' });
  h.feedback({ kind: 'hit', t: t + 20, victim: 'p9', victim_num: 21, dmg: 1, shot_group: 'g1' });
  h.feedback({ kind: 'hit', t: t + 400, victim: 'p9', victim_num: 21, dmg: 8, shot_group: 'g2' });
  const d = h.eng.state().life.dealt[0];
  assert.equal(d.dmg, 17); assert.equal(d.hits, 2);
});
test('dealt booking: without a shot_group, relays inside 150 ms are separate hits unless this gun fires a two-word weapon', () => {
  const h = harness(); h.live();
  const t = h.now();
  h.feedback({ kind: 'hit', t, victim: 'p9', victim_num: 21, dmg: 8 });
  h.feedback({ kind: 'hit', t: t + 20, victim: 'p9', victim_num: 21, dmg: 8 });
  assert.equal(h.eng.state().life.dealt[0].hits, 2, 'a single-word weapon: two hits');
  const h2 = harness(); h2.live();
  const own = h2.eng.weaponRow(h2.eng._activeWeaponId()); h2.eng.weaponRow = () => ({ ...(own || {}), dual_emitter: true });
  const t2 = h2.now();
  h2.feedback({ kind: 'hit', t: t2, victim: 'p9', victim_num: 21, dmg: 8 });
  h2.feedback({ kind: 'hit', t: t2 + 20, victim: 'p9', victim_num: 21, dmg: 1 });
  assert.equal(h2.eng.state().life.dealt[0].hits, 1, 'a two-word weapon: one hit');
});

// ---- Death screen (2026-09-23): the ledger fields the full recap reads ----
test('death screen: finalHit names the killing hit, its weapon and where it landed', () => {
  const h = harness(); h.live();
  h.hir(1, 0, 9, 0, 3); h.frame('$HP,45,61,0,*');
  h.hir(4, 0, 9, 1, 3); h.frame('$HP,0,0,0,*');
  const fh = h.eng.state().lastLife.finalHit;
  assert.equal(fh.num, 19);
  assert.ok(fh.dmg > 0);
  assert.equal(fh.sensor, 4, 'the gun body took it');
  assert.equal(fh.crit, true);
  assert.equal(fh.dot, false);
  assert.deepEqual(fh.weapon, { name: 'assault_rifle', ambiguous: false, pickup: false });
});

test('death screen: a catalogue match is marked as a pickup on the row and the final hit', () => {
  const h = harness({ catalog: { weapons: CATALOG } }); h.live();
  h.hir(4, 0, 20, 0, 3); h.frame('$HP,0,0,0,*');
  const st = h.eng.state();
  assert.equal(st.lastLife.taken[0].weapons[0].pickup, true);
  assert.equal(st.lastLife.finalHit.weapon.pickup, true);
  assert.equal(st.lastLife.finalHit.weapon.name, 'SHOTGUN');
});

test('death screen: ambiguous rows keep their candidate names, one row per candidate set', () => {
  const shooter = { ...SHOOTER, weapons: [{ weapon_id: 'assault_rifle', hir: [9, 11] }, { weapon_id: 'smg', hir: [9] }, { weapon_id: 'shotgun', hir: [11] }] };
  const h = harness({ shooter }); h.live();
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,45,61,0,*');
  h.adv(400);
  h.hir(4, 0, 11, 0, 3); h.frame('$HP,45,52,0,*');
  const ws = h.eng.state().life.taken[0].weapons;
  assert.equal(ws.length, 2, 'two different ambiguities from one source stay two rows');
  assert.deepEqual(ws.map(w => w.names).sort(), [['assault_rifle', 'shotgun'], ['assault_rifle', 'smg']]);
});

test('death screen: shots, kills and time alive are counted per life', () => {
  const h = harness(); h.live();
  h.frame('$ALCD,30,100,0,90,0,*'); h.frame('$ALCD,27,100,0,90,0,*');
  h.feedback({ kind: 'kill', t: h.now(), victim: 'p9', victim_team: 2 });
  h.adv(5000);
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,0,0,0,*');
  const last = h.eng.state().lastLife;
  assert.equal(last.shots, 3);
  assert.equal(last.kills, 1);
  assert.ok(last.aliveMs >= 5000 && last.aliveMs < 6000, 'time alive: ' + last.aliveMs);
  h.adv(8000);   // respawn
  const life = h.eng.state().life;
  assert.equal(life.shots, 0); assert.equal(life.kills, 0);
});

test('death screen: a late kill relay for the life that just ended books to lastLife', () => {
  const h = harness(); h.live();
  const before = h.now();
  h.adv(50); h.hir(4, 0, 9, 0, 3); h.frame('$HP,0,0,0,*');
  h.adv(300);
  h.feedback({ kind: 'kill', t: before, victim: 'p9', victim_team: 2 });
  const st = h.eng.state();
  assert.equal(st.lastLife.kills, 1); assert.equal(st.life.kills, 0);
});

test('death screen: the final hit of a two-word shot carries both words\' damage', () => {
  const shooter = { ...SHOOTER, weapons: [{ weapon_id: 'smg', hir: [8, 1] }] };
  const h = harness({ shooter, dualEmitters: [{ proto: 0, subtype: 0, body: 8, headset: 1, cycle_ms: 100 }] });
  h.live();
  h.hir(4, 0, 8, 0, 0); h.frame('$HP,45,62,0,*');
  h.adv(90);
  h.hir(0, 0, 1, 0, 0); h.frame('$HP,45,61,0,*');
  const fh = h.eng.state().life.finalHit;
  assert.equal(fh.dmg, 9, 'the pair is one final hit: 8 + 1');
  assert.equal(fh.sensor, 4, 'the first word\'s sensor');
});

// F315: tell same-magnitude weapons apart by IR cell (proto, subtype). The Assault Rifle and the USP-S both
// send magnitude 9, on cells (0,0) and (0,3); the Energy Rifle shares the AR's (0,0) and its magnitude.
const AR = { weapon_id: 'assault_rifle', hir: [9], cells: [{ proto: 0, subtype: 0, mag: 9 }] };
const USP = { weapon_id: 'usp_s', hir: [9], cells: [{ proto: 0, subtype: 3, mag: 9 }] };
const ENERGY = { weapon_id: 'energy_rifle', hir: [9], cells: [{ proto: 0, subtype: 0, mag: 9 }] };
const resolveOn = (h, proto, mag, subtype) => { h.hir(4, proto, mag, 0, subtype); return h.eng._resolveHitWeapon(h.eng.latch); };

test('F315 tier 1: two magnitude-9 weapons on different cells each resolve by cell + magnitude', () => {
  const h = harness({ shooter: { ...SHOOTER, weapons: [AR, USP] } }); h.live();
  h.hir(4, 0, 9, 0, 0); h.frame('$HP,45,61,0,*');
  assert.equal(h.facts.find(f => f.type === 'hit_taken').weapon_id, 'assault_rifle', 'a (0,0) hit names the AR end to end');
  h.adv(2000);
  assert.equal(resolveOn(h, 0, 9, 3).weapon_id, 'usp_s', 'a (0,3) hit names the USP-S');
  assert.equal(resolveOn(h, 0, 9, 0).source, 'loadout');
});

test('F315 fallback: two weapons on the SAME cell and magnitude stay ambiguous', () => {
  const h = harness({ shooter: { ...SHOOTER, weapons: [AR, ENERGY] } }); h.live();
  const r = resolveOn(h, 0, 9, 0);
  assert.equal(r.ambiguous, true);
  assert.equal(r.weapon_id, null);
  assert.deepEqual(r.candidates, ['assault_rifle', 'energy_rifle']);
});

test('F315 tier 2: a crit (a magnitude no cell lists) on a unique cell names the weapon', () => {
  const h = harness({ shooter: { ...SHOOTER, weapons: [AR, USP] } }); h.live();
  const r = resolveOn(h, 0, 15, 3);
  assert.equal(r.weapon_id, 'usp_s');
  assert.equal(r.ambiguous, false);
});

test('F315 tier 2: an overkill-clamped killing blow (magnitude below the weapon\'s) on a unique cell names it', () => {
  const h = harness({ shooter: { ...SHOOTER, weapons: [AR, USP] } }); h.live();
  assert.equal(resolveOn(h, 0, 4, 0).weapon_id, 'assault_rifle');
});

test('F315 tier 1 beats tier 2: a cell shared at a different magnitude does not make a cell + magnitude match ambiguous', () => {
  const charge = { weapon_id: 'charge_rifle', hir: [16, 70], cells: [{ proto: 0, subtype: 0, mag: 16 }, { proto: 0, subtype: 0, mag: 70 }] };
  const h = harness({ shooter: { ...SHOOTER, weapons: [AR, charge] } }); h.live();
  assert.equal(resolveOn(h, 0, 9, 0).weapon_id, 'assault_rifle');
  assert.equal(resolveOn(h, 0, 70, 0).weapon_id, 'charge_rifle');
  assert.equal(resolveOn(h, 0, 30, 0).ambiguous, true, 'tier 2 on a shared cell is ambiguous, not a guess');
});

test('F315 tier 3: a roster with no `cells` (an older MC) resolves exactly as before, by magnitude alone', () => {
  const h = harness({ shooter: { ...SHOOTER, weapons: [{ weapon_id: 'assault_rifle', hir: [9] }, { weapon_id: 'usp_s', hir: [9] }] } }); h.live();
  assert.deepEqual(resolveOn(h, 0, 9, 3), { weapon_id: null, name: null, source: null, ambiguous: true, candidates: ['assault_rifle', 'usp_s'] });
  assert.equal(resolveOn(h, 0, 15, 3).ambiguous, false, 'a crit magnitude with no cells is unknown');
  assert.equal(resolveOn(h, 0, 15, 3).weapon_id, null);
});

test('F315: a latch with no proto or subtype (older data) skips the cell tiers', () => {
  const h = harness({ shooter: { ...SHOOTER, weapons: [AR, USP] } }); h.live();
  const r = h.eng._resolveHitWeapon({ shooter_num: SHOOTER.player_num, mag: 9, ir_proto: NaN, ir_subtype: NaN });
  assert.equal(r.ambiguous, true, 'magnitude alone cannot split them');
  assert.equal(h.eng._resolveHitWeapon({ shooter_num: SHOOTER.player_num, mag: 15, ir_proto: NaN, ir_subtype: NaN }).weapon_id, null);
});

test('F315: the catalogue fallback runs the same tiers, and still excludes the loadout\'s ids', () => {
  const catalog = { weapons: [
    { ...AR, name: 'ASSAULT RIFLE' }, { ...USP, name: 'USP-S' },
    { weapon_id: 'breacher', name: 'BREACHER', hir: [9], cells: [{ proto: 0, subtype: 1, mag: 9 }] },
  ] };
  // The loadout carries nothing at magnitude 9 or on cells (0,1)/(0,3), so those hits fall through to the catalogue.
  const shotgun = { weapon_id: 'shotgun', hir: [20], cells: [{ proto: 0, subtype: 2, mag: 20 }] };
  const h = harness({ shooter: { ...SHOOTER, weapons: [shotgun] }, catalog }); h.live();
  assert.deepEqual(resolveOn(h, 0, 9, 3), { weapon_id: 'usp_s', name: 'USP-S', source: 'catalog', ambiguous: false, candidates: [] }, 'tier 1 in the catalogue');
  assert.equal(resolveOn(h, 0, 15, 1).weapon_id, 'breacher', 'tier 2 in the catalogue');
  assert.deepEqual(resolveOn(h, 0, 9, 7).candidates, ['assault_rifle', 'usp_s', 'breacher'], 'an unlisted cell falls to tier 3 in the catalogue');
  // With the AR in the loadout, the catalogue's AR is excluded: a tier-3 fallback no longer lists it.
  const h2 = harness({ shooter: { ...SHOOTER, weapons: [shotgun, AR] }, catalog }); h2.live();
  assert.equal(resolveOn(h2, 0, 9, 0).source, 'loadout', 'the loadout AR wins its own cell');
  assert.deepEqual(resolveOn(h2, 0, 15, 1), { weapon_id: 'breacher', name: 'BREACHER', source: 'catalog', ambiguous: false, candidates: [] }, 'a catalogue cell the loadout lacks');
});

test('F315: a picked-up weapon on its own cell beats a loadout weapon that only shares its magnitude', () => {
  // The shooter carries the AR (0,0) mag 9 and picks up a USP-S (0,3) mag 9. The USP-S hit must not fall to the
  // loadout's tier-3 magnitude match: every tier tries the loadout, then the catalogue, before the next one.
  const catalog = { weapons: [{ ...AR, name: 'ASSAULT RIFLE' }, { ...USP, name: 'USP-S' }] };
  const h = harness({ shooter: { ...SHOOTER, weapons: [AR] }, catalog }); h.live();
  assert.deepEqual(resolveOn(h, 0, 9, 3), { weapon_id: 'usp_s', name: 'USP-S', source: 'catalog', ambiguous: false, candidates: [] });
  assert.equal(resolveOn(h, 0, 9, 0).weapon_id, 'assault_rifle', 'the AR still names its own cell');
});

test('F315: an older MC roster (no cells) is not out-voted by a newer cached catalogue\'s cell match', () => {
  // The roster names the AR by magnitude only; the catalogue (from a newer MC) lists the Energy Rifle on (0,0) at 9.
  // Without the guard, the catalogue's tier-1 cell match would beat the roster's tier-3 magnitude match.
  const catalog = { weapons: [{ ...ENERGY, name: 'ENERGY RIFLE' }, { ...AR, name: 'ASSAULT RIFLE' }] };
  const h = harness({ shooter: { ...SHOOTER, weapons: [{ weapon_id: 'assault_rifle', hir: [9] }] }, catalog }); h.live();
  const r = resolveOn(h, 0, 9, 0);
  assert.equal(r.weapon_id, 'assault_rifle');
  assert.equal(r.source, 'loadout');
});

test('integration 2026-09-23: a killing blow whose magnitude is the clamped remaining pool keeps the shooter\'s real weapon', () => {
  const h = harness({ catalog: { weapons: CATALOG } }); h.live();
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,20,0,0,*');   // the rifle leaves 20 in the pool
  h.adv(300);
  h.hir(4, 0, 20, 0, 3); h.frame('$HP,0,0,0,*');   // token 5 = 20 = the whole pool: the clamp, which the catalogue would call a Shotgun
  const last = h.eng.state().lastLife;
  assert.equal(last.finalHit.weapon.name, 'ASSAULT RIFLE', 'not "SHOTGUN · PICKUP"');
  assert.equal(last.finalHit.weapon.pickup, false);
  const facts = h.facts.filter(f => f.type === 'hit_taken');
  assert.equal(facts[facts.length - 1].weapon_id, 'assault_rifle', 'MC is told the real weapon too');
});

test('integration 2026-09-23: a clamped killing blow with no earlier hit names no weapon rather than guess', () => {
  const h = harness({ catalog: { weapons: CATALOG } }); h.live();
  h.frame('$HP,20,0,0,*');   // the pool already down to 20 (no hit booked)
  h.hir(4, 0, 20, 0, 3); h.frame('$HP,0,0,0,*');   // token 5 = the whole pool: a clamp, not a Shotgun
  const fh = h.eng.state().lastLife.finalHit;
  assert.equal(fh.weapon, null);
  assert.equal(h.facts.filter(f => f.type === 'hit_taken').pop().weapon_id, undefined);
});

test('polish round 1: a clamped kill after hits from two different weapons names neither', () => {
  const shooter = { ...SHOOTER, weapons: [{ weapon_id: 'assault_rifle', hir: [9] }, { weapon_id: 'shotgun', hir: [20] }] };
  const h = harness({ shooter, catalog: { weapons: CATALOG } }); h.live();
  h.hir(4, 0, 9, 0, 3); h.frame('$HP,45,61,0,*');     // the rifle
  h.adv(300);
  h.hir(4, 0, 20, 0, 3); h.frame('$HP,17,0,0,*');     // the shotgun
  h.adv(300);
  h.hir(4, 0, 17, 0, 3); h.frame('$HP,0,0,0,*');      // the clamp: 17 = the whole pool, and no loadout weapon sends 17
  assert.equal(h.eng.state().lastLife.finalHit.weapon, null, 'two weapons used: the killing one is unknowable, so none');
});
