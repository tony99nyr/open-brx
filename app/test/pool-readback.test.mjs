// F341 (field 2026-09-24, app 0.4.11, a Pixel 5, Tactix-FE30): after a status-201 chunk error on the spawn burst's
// `$PSET` and a re-send, the gun reported `$HP,4545,7070,0` on every read for the rest of the match. The player was
// unkillable. The spawn read-back ("did the gun take the burst?") only checked that an answer came, so it did not
// flag it, and the reconcile after a drop adopted "live at hp 4545".
//
// The read-back now COMPARES the gun's pools with the ones the compiled `$PSET` arms, and repairs a mismatch with
// `$*`, the life's `$PSET` and a clamped `$LIFE` set, then reads back again. Every test here breaks one of those
// rules; the CONTROLs pin the neighbouring path that must not move. Mirrors: mcp/tests/test_stage_pool_repair.py.
//
// `gunModel` is a byte-level model of the gun's parser (transport-hardening.md §1.3: a new `$` resets token 0 and
// the index, tokens 1..59 keep their text until a handler finishes) plus the handful of commands these tests need.
// It is not the fake gun of the demo: it exists to reproduce 4545/7070 from bytes, not to be told the answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, PROBE_LIFE, POOL_REPAIR_TRIES, POOL_REPAIR_READ_MS } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const PSET = golden.head.find(f => f.startsWith('$PSET,'));

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

/** The gun: a token-append parser feeding a pool model. `ignoreRepairs` (read by the harness writer) drops every
 *  repair frame: a gun that never takes one. */
export function gunModel() {
  let tok = new Array(60).fill(''), idx = 0;
  const g = { max: { hp: 45, armor: 70, shield: 0 }, hp: 0, armor: 0, shield: 0, out: [], psets: [], ignoreRepairs: false };
  const num = v => (v === '' || v == null ? 0 : parseInt(v, 10) || 0);
  const run = t => {
    const cmd = t[0];
    if (cmd === 'PSET') { g.psets.push(t.slice(0, 6).join(',')); g.max = { hp: num(t[3]), armor: num(t[4]), shield: num(t[5]) }; }
    else if (cmd === 'SPAWN') { g.hp = g.max.hp; g.armor = g.max.armor; g.shield = 0; g.out.push(`$LCD,${g.hp},${g.armor},0,0,32,192,*`); }
    else if (cmd === 'LIFE') {
      const mode = num(t[4]);
      if (mode === 1) { g.hp = Math.min(num(t[1]), g.max.hp); g.armor = Math.min(num(t[2]), g.max.armor); g.shield = Math.min(num(t[3]), g.max.shield); }
      else { g.hp = Math.max(0, Math.min(g.max.hp, g.hp + num(t[1]))); g.armor = Math.max(0, Math.min(g.max.armor, g.armor + num(t[2]))); }
      g.out.push(`$HP,${g.hp},${g.armor},${g.shield},*`);
    }
  };
  g.feed = text => {
    for (const c of text) {
      if (c === '$') { tok[0] = ''; idx = 0; }
      else if (c === ',') idx = idx >= 59 ? 1 : idx + 1;
      else if (c === '*') { run(tok); tok = new Array(60).fill(''); idx = 0; }
      else tok[idx] += c;
    }
  };
  return g;
}

/** A node that has just gone live, with the gun model on the other end of the writer. `garble`: a partial copy of
 *  the `$PSET` (its `*` chunk lost) sits in the gun's parser when the spawn burst arrives, which is the incident. */
function harness({ garble = false } = {}) {
  let clock = 1_000_000;
  const gun = gunModel();
  let garbleNext = false;
  const writes = [], logs = [], answers = [];
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }];
  const config = { config_id: golden.config_id, mode: 'ffa', environment: 'outdoor', night: false, time_limit_s: 1800,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'ROCCO', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({
    writer: fr => {
      for (const f of fr) {
        writes.push(f);
        const repair = f === '$*' || f.startsWith('$PSET,') || /^\$LIFE,\d+,\d+,\d+,1,\*$/.test(f);   // every repair frame
        if (gun.ignoreRepairs && repair) continue;
        if (garbleNext && f.startsWith('$PSET,')) { garbleNext = false; gun.feed(f.slice(0, 60)); }   // the copy whose `*` chunk was lost
        gun.feed(f);
      }
      answers.push(...gun.out.splice(0));
      if (gun.mute) answers.length = 0;
    },
    emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: l => logs.push(l),
    delay: (ms, fn) => fn(), rng: () => 0 });
  const h = {
    eng, gun, writes, logs,
    flush() { while (answers.length) eng.feedFrame(answers.shift()); return h; },
    adv(ms, step = 250) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); eng.tick(); h.flush(); } return h; },
    f(fr) { eng.feedFrame(fr); h.flush(); return h; },
    log(re) { return logs.filter(l => re.test(l)); },
    repairs() { return writes.filter(f => /^\$LIFE,\d+,\d+,\d+,1,\*$/.test(f)).length; },
  };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1' }, roster: [] } });
  for (const f of golden.head) gun.feed(f);   // the lobby head landed cleanly: the gun holds the right ceilings
  gun.out.length = 0;
  garbleNext = garble;   // the spawn burst's `$PSET` goes twice, the first copy without its `*` chunk (the incident)
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  h.adv(10);
  assert.equal(eng.phase, 'live'); assert.equal(eng.alive, true);
  return h;
}

test('CONTROL: a clean spawn reads back 45/70 and nothing is repaired', () => {
  const h = harness();
  h.adv(4000);
  assert.ok(h.writes.includes(PROBE_LIFE), 'the spawn read-back went out');
  assert.equal(h.gun.hp, 45); assert.equal(h.gun.armor, 70);
  assert.equal(h.repairs(), 0);
  assert.equal(h.eng.poolStale(), null);
});

test('the incident: a partial $PSET in the parser makes the spawn arm 4545/7070', () => {
  const h = harness({ garble: true });
  assert.equal(h.gun.hp, 4545, 'the gun model reproduces the field reading');
  assert.equal(h.gun.armor, 7070);
});

test('F341: the spawn read-back catches 4545/7070, repairs it with $*, the $PSET and a clamped $LIFE set, and reads back 45/70', () => {
  const h = harness({ garble: true });
  const n = h.writes.length;
  h.adv(2600 + POOL_REPAIR_READ_MS + 1000);
  const after = h.writes.slice(n);
  const at = after.indexOf('$*');
  assert.ok(at >= 0, 'the repair starts with the parser reset');
  assert.match(after[at + 1], /^\$PSET,7,1,45,70,0,/, 'then the life\'s own $PSET, verbatim');
  assert.ok(after.slice(at + 1).some(f => f === '$LIFE,45,70,0,1,*'), 'then the clamped absolute set, at the armed pools');
  assert.equal(h.gun.hp, 45); assert.equal(h.gun.armor, 70);
  assert.deepEqual([h.gun.max.hp, h.gun.max.armor], [45, 70], 'the gun holds the right ceilings again');
  assert.equal(h.log(/pool repair held/).length, 1, 'the second read-back confirmed it');
  assert.equal(h.eng.poolStale(), null);
  assert.equal(h.eng.hp, 45);
});

test('F341: the repair is logged loudly with the numbers the gun reported', () => {
  const h = harness({ garble: true });
  h.adv(3000);
  assert.equal(h.log(/gun pools 4545\/7070\/0 are above the armed ceiling 45\/70\/0/).length, 1);
});

test('F341: a gun that never takes the repair is surfaced as pool_wrong after POOL_REPAIR_TRIES, and never repaired again', () => {
  const h = harness({ garble: true });
  h.gun.ignoreRepairs = true;
  h.adv(2600 + (POOL_REPAIR_READ_MS + 600) * (POOL_REPAIR_TRIES + 1));
  assert.equal(h.repairs(), POOL_REPAIR_TRIES);
  assert.deepEqual(h.eng.poolStale() && h.eng.poolStale().why, 'pool_wrong');
  assert.equal(h.eng.statusBody().pool_stale, 'pool_wrong', 'the operator board reads it from the heartbeat');
  assert.equal(h.log(/still wrong \(2 repairs did not hold/).length, 1);
  h.adv(30000);
  assert.equal(h.repairs(), POOL_REPAIR_TRIES, 'bounded: no repair loop');
});

test('F341: a pool above its ceiling is wrong on ANY $HP, not only the read-back (the reconcile adopted 4545)', () => {
  const h = harness();
  h.adv(4000);                        // past the read-back, clean
  h.gun.hp = 4545; h.gun.armor = 7070; h.gun.max = { hp: 4545, armor: 7070, shield: 0 };
  h.f('$HP,4545,7070,0,*');           // the gun reports it unasked (a hit, a divergence poll, a reconcile)
  h.adv(POOL_REPAIR_READ_MS + 1000);
  assert.equal(h.gun.hp, 45); assert.equal(h.gun.armor, 70);
  assert.equal(h.log(/pool repair held/).length, 1);
});

test('CONTROL: a real hit before the read-back leaves lower pools alone', () => {
  const h = harness();
  h.adv(1000);
  h.gun.armor = 55;
  h.f('$HIR,0,0,19,2,15,0,0,*').f('$HP,45,55,0,*');
  h.adv(4000);
  assert.equal(h.repairs(), 0, 'a hit is the one proven way below the spawn pools');
});

test('F341 polish: lower pools at the read-back with no $HIR are LOGGED, never written (grenade and station damage carry no $HIR)', () => {
  const h = harness();
  h.gun.hp = 30;                                   // damage the node saw no `$HIR` for
  h.adv(2600 + POOL_REPAIR_READ_MS + 1000);
  assert.equal(h.repairs(), 0, 'a write here could heal real damage');
  assert.equal(h.gun.hp, 30);
  assert.equal(h.log(/spawn read-back: the gun reads 30\/70\/0, not the spawn pools 45\/70/).length, 1);
  assert.equal(h.eng.poolStale(), null);
});

test('F341 polish: a repair read-back that goes unanswered is the verdict, never a second mode-1 $LIFE (it would revive a dead gun)', () => {
  const h = harness({ garble: true });
  for (let i = 0; i < 40 && h.repairs() === 0; i++) h.adv(100);   // the first read of 4545 starts a repair
  assert.equal(h.repairs(), 1);
  h.gun.mute = true;                               // from here the gun answers nothing (it may have died unseen)
  h.adv(POOL_REPAIR_READ_MS * 4);
  assert.equal(h.repairs(), 1, 'no second write on no evidence');
  assert.equal(h.eng.poolStale() && h.eng.poolStale().why, 'pool_wrong');
  assert.equal(h.log(/read-back after repair 1 went unanswered/).length, 1);
});

test('F341: the repair waits out a reconcile (the node never writes there) and goes after it', () => {
  const h = harness({ garble: true });
  h.eng.reconciling = { since: Number.MAX_SAFE_INTEGER / 2 };   // held open for the test
  h.adv(4000);
  assert.equal(h.repairs(), 0, 'nothing written inside the reconcile');
  h.eng.reconciling = null;
  h.adv(POOL_REPAIR_READ_MS + 1000);
  assert.equal(h.gun.hp, 45);
});

test('F341 polish: a reconcile inside the repair read-back window asks again afterwards, never a false pool_wrong', () => {
  const h = harness({ garble: true });
  for (let i = 0; i < 40 && h.repairs() === 0; i++) h.adv(100);
  h.gun.mute = true;                               // the read-back goes out and gets no answer...
  h.adv(POOL_REPAIR_READ_MS + 300);
  h.eng.reconciling = { since: Number.MAX_SAFE_INTEGER / 2 };   // ...because a reconcile started inside its window
  h.adv(3000);
  assert.equal(h.eng.poolStale(), null, 'no verdict on an ask the gun could not answer');
  h.gun.mute = false; h.eng.reconciling = null;
  h.adv(POOL_REPAIR_READ_MS + 1000);
  assert.equal(h.log(/pool repair held/).length, 1, 'asked again after the reconcile, and it held');
});

test('HUD QA R2-02: a rise ABOVE the armed ceiling is never a gain moment and never voiced; CONTROL: a rise to the ceiling is', () => {
  const h = harness();
  h.adv(4000);                        // past the read-back, clean
  const said = []; const say = h.eng._announceStatus.bind(h.eng);
  h.eng._announceStatus = k => { said.push(k); return say(k); };
  h.gun.armor = 40; h.f('$HIR,0,0,19,2,30,0,0,*').f('$HP,45,40,0,*');   // a 30 armour hit
  h.adv(1000);
  h.eng.moment = null;
  h.gun.hp = 4545; h.gun.armor = 7070; h.gun.max = { hp: 4545, armor: 7070, shield: 0 };
  h.f('$HP,4545,7070,0,*');           // the misread `$PSET`, reported unasked
  assert.ok(!(h.eng.moment && h.eng.moment.kind === 'gain'), `no "+7000 ARMOUR" float: ${JSON.stringify(h.eng.moment)}`);
  assert.deepEqual(said, [], 'no "armour up" line for a pool the gun cannot hold');
  h.adv(POOL_REPAIR_READ_MS + 1000);  // the repair puts 45/70 back
  h.gun.armor = 40; h.f('$HIR,0,0,19,2,30,0,0,*').f('$HP,45,40,0,*');
  h.adv(1000); said.length = 0; h.eng.moment = null;
  h.gun.armor = 70; h.f('$HP,45,70,0,*');   // CONTROL: back up TO the ceiling is a real pickup
  assert.equal(h.eng.moment && h.eng.moment.kind, 'gain');
  assert.deepEqual(said, ['armour_up']);
});
