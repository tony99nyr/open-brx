// S16 (spec/node.md §3.17): the poison tick clock the node runs, and S53: the smoke tell. Tony's decisions
// (2026-09-18/19): every Toxin Rifle hit poisons; a second hit REFRESHES to full duration and never stacks; the kill
// from a lethal tick goes to the most recent applier; death and respawn clear it; the HUD counts it down.
// Every timer here runs on the engine's own clock (`now`), advanced by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, SMOKE_MS, isPoolProbe } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const DOT = { 11: { weapon_id: 'toxin_rifle', per_tick: 4, tick_ms: 1000, duration_ms: 5000 } };
const DELAY = 5000;

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

/** A live match with a fake gun that answers our `$LIFE` ticks the way the bench measured: per pool, no spill, floor
 *  at 0, `$HP` for a non-lethal write and `$LCD` (never `$HP`) for a lethal one. */
function harness({ dot = DOT, stun } = {}) {
  const writes = []; const facts = []; let clock = 1_000_000;
  const gun = { hp: 45, armor: 70, shield: 0, auto: true };
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }];
  const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: DELAY / 1000 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams,
    ...(stun ? { stun } : {}) };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  let eng;
  const answer = fr => {
    for (const f of fr) {
      const m = /^\$LIFE,(-?\d+),(-?\d+),(-?\d+),\*$/.exec(f);
      if (!m || isPoolProbe(f) || !gun.auto) continue;
      const [dh, da, ds] = m.slice(1).map(Number);
      gun.hp = Math.max(0, gun.hp + dh); gun.armor = Math.max(0, gun.armor + da); gun.shield = Math.max(0, gun.shield + ds);
      queueFrame(gun.hp === 0 ? `$LCD,0,0,0,0,30,90,*` : `$HP,${gun.hp},${gun.armor},${gun.shield},*`);
    }
  };
  const pending = [];
  const queueFrame = f => pending.push(f);
  eng = new Engine({ writer: fr => { writes.push(...fr); answer(fr); }, emit: f => facts.push({ ...f, at: clock }), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1', ...(dot ? { dot } : {}) }, roster: [] } });
  eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const flush = () => { while (pending.length) eng.feedFrame(pending.shift()); };
  const h = {
    eng, facts, writes, gun,
    adv(ms, step = 250) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); eng.tick(); flush(); } return h; },
    kind(k) { return facts.filter(f => f.type === k); },
    /** a Toxin Rifle hit as the gun reports it: `$HIR` on protocol 11, then the direct damage off the outer pool */
    toxin(shooter = 3, team = 2, dmg = 8) {
      eng.feedFrame(`$HIR,0,11,${shooter},${team},${dmg},0,0,*`);
      if (gun.shield > 0) gun.shield = Math.max(0, gun.shield - dmg); else if (gun.armor > 0) gun.armor = Math.max(0, gun.armor - dmg); else gun.hp = Math.max(0, gun.hp - dmg);
      eng.feedFrame(gun.hp === 0 ? '$LCD,0,0,0,0,30,90,*' : `$HP,${gun.hp},${gun.armor},${gun.shield},*`);
      return h;
    },
    setPools(hp, armor, shield) { gun.hp = hp; gun.armor = armor; gun.shield = shield; eng.feedFrame(`$HP,${hp},${armor},${shield},*`); return h; },
    ticks() { return writes.filter(f => /^\$LIFE,/.test(f) && !isPoolProbe(f) && f.includes('-')); },
    cues(id) { return writes.filter(f => f.startsWith('$PLAY') && f.includes(id)); },
    get clock() { return clock; },
  };
  h.adv(10); eng.feedFrame('$LCD,45,70,0,0,30,90,*');
  assert.equal(eng.phase, 'live'); assert.equal(eng.alive, true);
  return h;
}

test('S16: a toxin hit starts the stack, plays `poisoned` once, and the HUD sees a full countdown', () => {
  const h = harness();
  h.toxin();
  const st = h.eng.state();
  assert.ok(st.poison, 'the stack is on');
  assert.equal(st.poison.leftMs, 5000);
  assert.equal(st.poison.perTick, 4);
  assert.equal(st.poison.by.num, 3, 'the applier is named');
  assert.equal(h.cues('H23').length, 1, 'the start cue played once');
  assert.equal(h.ticks().length, 0, 'no tick before the first interval');
  h.adv(1000);
  assert.deepEqual(h.ticks(), ['$LIFE,0,-4,0,*'], 'one tick at +1 s, off the armour');
  assert.equal(h.eng.state().poison.leftMs, 4000);
});

test('S16: a hit on another protocol, or a bundle with no dot table, never poisons', () => {
  const h = harness();
  h.eng.feedFrame('$HIR,0,0,3,2,8,0,0,*'); h.eng.feedFrame('$HP,45,62,0,*');
  assert.equal(h.eng.state().poison, null);
  const old = harness({ dot: null });
  old.toxin(); old.adv(6000);
  assert.equal(old.eng.state().poison, null, 'a pre-S16 bundle: no table, no poison');
  assert.equal(old.ticks().length, 0);
});

test('S16: each tick takes the OUTERMOST non-empty pool, shield then armour then health, with no spill', () => {
  const h = harness();
  h.setPools(45, 5, 6);
  h.toxin(3, 2, 0);                                  // a zero-damage word keeps the pools exact for the arithmetic
  h.adv(5000);
  assert.deepEqual(h.ticks(), ['$LIFE,0,0,-4,*', '$LIFE,0,0,-4,*', '$LIFE,0,-4,0,*', '$LIFE,0,-4,0,*', '$LIFE,-4,0,0,*'],
    'shield 6 -> 2 -> 0 (the remainder is lost, no spill), armour 5 -> 1 -> 0, then health');
  assert.deepEqual([h.gun.hp, h.gun.armor, h.gun.shield], [41, 0, 0]);
  h.adv(3000);
  assert.equal(h.ticks().length, 5, 'five ticks in five seconds, then the stack is over');
  assert.equal(h.eng.state().poison, null);
});

test('S16: the tick\'s own $HP is not a hit: no hit_taken fact, no hit moment', () => {
  const h = harness();
  h.toxin();
  assert.equal(h.kind('hit_taken').length, 1, 'the direct hit is a hit');
  h.adv(1000);
  assert.equal(h.ticks().length, 1);
  assert.equal(h.kind('hit_taken').length, 1, 'the tick at +1 s booked no second hit');
  assert.notEqual(h.eng.state().moment && h.eng.state().moment.kind === 'hit' && h.eng.state().moment.at === h.clock, true);
  h.eng.feedFrame('$HIR,0,0,5,2,9,0,0,*'); h.eng.feedFrame('$HP,45,53,0,*');
  assert.equal(h.kind('hit_taken').length, 2, 'a real hit inside the same second still counts');
});

test('S16: a second hit REFRESHES to full duration, keeps the cadence, never stacks, and names the new applier', () => {
  const h = harness();
  h.toxin(3, 2);
  h.adv(2500);
  assert.equal(h.ticks().length, 2);
  h.toxin(5, 2);                                      // another shooter, 2.5 s in
  assert.equal(h.eng.state().poison.leftMs, 5000, 'refreshed to the full duration');
  assert.equal(h.eng.state().poison.by.num, 5, 'the most recent applier');
  assert.equal(h.cues('H23').length, 1, 'a refresh does not replay the start cue');
  h.adv(1000);
  assert.equal(h.ticks().length, 3, 'still one tick a second: two applications did not add a second clock');
  h.adv(10000);
  assert.equal(h.ticks().length, 7, 'ticks at +1..+7 s: the refresh ran the stack to +7.5 s');
});

test('S16: sustained fire keeps the stack alive and it still ticks every second', () => {
  const h = harness();
  h.setPools(45, 70, 0);
  for (let i = 0; i < 30; i++) { h.toxin(3, 2, 0); h.adv(110, 110); }   // a Toxin Rifle mag at its 110 ms cycle
  assert.equal(h.ticks().length, 3, 'three ticks in 3.3 s of fire: refreshing never pushes the next tick out');
});

test('S16: a LETHAL tick books the death to the applier, flagged dot:true, and plays no tick cue over the scream', () => {
  const h = harness();
  h.setPools(4, 0, 0);
  h.toxin(3, 2, 0);
  const cuesBefore = h.cues('V4G').length;
  h.adv(1000);
  assert.deepEqual(h.ticks(), ['$LIFE,-4,0,0,*']);
  const d = h.kind('death');
  assert.equal(d.length, 1, 'the $LCD answer books the death');
  assert.equal(d[0].shooter_num, 3, 'credit to the player who applied the poison');
  assert.equal(d[0].shooter_team, 2);
  assert.equal(d[0].dot, true);
  assert.equal(h.cues('V4G').length, cuesBefore, 'no poison_tick cue on the lethal tick');
  assert.equal(h.eng.killedBy.dot, true, 'the DOWN screen can say POISONED BY');
  assert.equal(h.eng.state().poison, null, 'death clears the stack');
  h.adv(3000);
  assert.equal(h.ticks().length, 1, 'no ticks on a dead gun');
});

test('S16: a lethal tick credits the MOST RECENT applier', () => {
  const h = harness();
  h.setPools(8, 0, 0);
  h.toxin(3, 2, 0); h.adv(500); h.toxin(5, 2, 0);
  h.adv(2000);
  const d = h.kind('death');
  assert.equal(d.length, 1);
  assert.equal(d[0].shooter_num, 5);
  assert.equal(d[0].dot, true);
});

test('S16: a real hit that kills a poisoned player is that hit\'s kill, not the poison\'s', () => {
  const h = harness();
  h.toxin(3, 2);
  h.adv(1000);
  h.eng.feedFrame('$HIR,0,0,9,2,60,0,0,*'); h.eng.feedFrame('$HP,0,0,0,*');
  const d = h.kind('death');
  assert.equal(d.length, 1);
  assert.equal(d[0].shooter_num, 9);
  assert.equal(d[0].dot, undefined);
});

test('S16: death clears the stack and the next life starts clean after the respawn', () => {
  const h = harness();
  h.toxin(3, 2);
  h.adv(1000);
  h.eng.feedFrame('$HIR,0,0,9,2,60,0,0,*'); h.eng.feedFrame('$HP,0,0,0,*');
  assert.equal(h.eng.state().poison, null);
  const n = h.ticks().length;
  h.adv(DELAY + 500);
  assert.equal(h.eng.alive, true, 'revived');
  h.eng.feedFrame('$LCD,45,70,0,0,30,90,*'); h.gun.hp = 45; h.gun.armor = 70;
  h.adv(6000);
  assert.equal(h.ticks().length, n, 'no tick in the new life');
  assert.equal(h.eng.state().poison, null);
});

test('S16: an operator respawn of a live, poisoned player clears the stack too', () => {
  const h = harness();
  h.toxin(3, 2);
  h.eng._revive(false, null, true);
  assert.equal(h.eng.state().poison, null, 'a respawn is a new life');
});

test('S16: no ticks after the match ends', () => {
  const h = harness();
  h.toxin(3, 2);
  h.adv(1000);
  h.eng.control({ cmd: 'end', match_id: 'm1' });
  assert.notEqual(h.eng.phase, 'live');
  assert.equal(h.eng.poison, null);
  const n = h.ticks().length;
  h.adv(6000);
  assert.equal(h.ticks().length, n);
});

test('S16: a tick due while the gun link is down is skipped, not queued', () => {
  const h = harness();
  h.toxin(3, 2);
  h.eng.bleUp = false;
  h.adv(2000);
  assert.equal(h.ticks().length, 0, 'nothing written to a gun we cannot reach');
  h.eng.bleUp = true;
  h.adv(1000);
  assert.equal(h.ticks().length, 1, 'one tick when it is back, not a burst of the missed ones');
});

// ---------- S53: the smoke tell ----------

test('S53: a $HIR with the gun\'s accuracy dropping to 0 in the same moment is a smoke, counted down from 6 s', () => {
  const h = harness();
  h.eng.feedFrame('$ALCD,29,100,0,90,0,*');          // a shot at full accuracy
  h.eng.feedFrame('$HIR,0,7,4,2,6,0,0,*');           // the Haze word: no pool moves, no $HP
  h.eng.feedFrame('$ALCD,29,0,0,90,0,*');            // ...and accuracy 0 in the same millisecond
  const a = h.eng.state().aim;
  assert.ok(a, 'the smoke tell is on');
  assert.equal(a.reason, 'smoke');
  assert.equal(a.acc, 0);
  assert.equal(a.leftMs, SMOKE_MS);
  h.adv(SMOKE_MS - 250);
  assert.ok(h.eng.state().aim, 'still smoked just before the gun\'s own timer');
  h.adv(500);
  assert.equal(h.eng.state().aim, null, 'over when the ~6 s timer has run');
});

test('S53: the gun reporting accuracy above 0 ends the tell early; a drop with no $HIR is not a smoke', () => {
  const h = harness();
  h.eng.feedFrame('$HIR,0,7,4,2,6,0,0,*'); h.eng.feedFrame('$ALCD,29,0,0,90,0,*');
  assert.ok(h.eng.state().aim);
  h.adv(1000);
  h.eng.feedFrame('$ALCD,28,100,0,90,0,*');
  assert.equal(h.eng.state().aim, null, 'the gun gave accuracy back');
  const h2 = harness();
  h2.eng.feedFrame('$ALCD,29,0,0,90,0,*');
  assert.equal(h2.eng.state().aim, null, 'accuracy 0 alone is not a smoke');
  h2.adv(1000); h2.eng.feedFrame('$HIR,0,7,4,2,6,0,0,*');
  assert.equal(h2.eng.state().aim, null, 'a $HIR a second later does not pair with it');
});

test('S53: the EMP is fn 23 as well, but it has its own STUNNED takeover and is not a smoke', () => {
  const h = harness({ stun: { duration_s: 5 } });
  h.eng.feedFrame('$HIR,0,8,4,2,6,0,0,*'); h.eng.feedFrame('$ALCD,29,0,0,90,0,*');
  assert.ok(h.eng.stunned, 'setup: stunned');
  assert.equal(h.eng.state().aim, null);
});

test('S53: death clears the smoke tell', () => {
  const h = harness();
  h.eng.feedFrame('$HIR,0,7,4,2,6,0,0,*'); h.eng.feedFrame('$ALCD,29,0,0,90,0,*');
  h.eng.feedFrame('$HIR,0,0,9,2,60,0,0,*'); h.eng.feedFrame('$HP,0,0,0,*');
  assert.equal(h.eng.state().aim, null);
});

test('S16: a webview that stalled drops the ticks it missed rather than firing them in a burst', () => {
  const h = harness();
  h.toxin(3, 2);
  h.adv(3200, 3200);                                  // one tick() call, 3.2 s late
  assert.equal(h.ticks().length, 1, 'one tick for the one call');
  h.adv(250);
  assert.equal(h.ticks().length, 1, 'and the next is a full interval away, not due at once');
});
