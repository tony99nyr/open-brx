// The two cues the node owes the player that the gun does not play itself.
//
//   RELOAD NAG   -- the magazine is empty, the reserve is not, and the trigger keeps coming back. Tony at
//                   the bench 2026-09-18: say RELOAD on the 5th pull, then every 3rd (5, 8, 11 …). The
//                   count hangs off `_awaitShot`, one line below its stand-down table, so a gun that could
//                   not fire for ANY other reason (overheat, a swap, a reload, a stun, being down) is
//                   silent -- a nag there would name the wrong fix.
//   SHIELDS ONLINE -- bench 2026-09-17 step 7: `$LIFE` grants refill the shield (0 to 120 in ~4.1 s) and
//                   the gun plays NOTHING for it, so the node must. Fires on the edge to the `$PSET` t5
//                   ceiling, once, never on the frames that merely report a full shield, never at a spawn
//                   (a spawn shield is always 0).
//
// Mirrors: mcp/tests/test_stage_mirror.py (the stage predicts this phone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, PROBE_LIFE, isPoolProbe, SHIELD_REGEN_WRITE_BUDGET } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));
const NAG = golden.cues.reload_nag;             // $PLAY,,4,6,VX73,* -- "Reload"
const ONLINE = golden.cues.shield_online;       // $PLAY,,4,6,VA6Y,* -- "Shields Online"
const UP = golden.cues.shield_up;               // $PLAY,,4,6,VA8C,* -- "SHIELD ONLINE", the per-grant line
const GRANTS = SHIELD_REGEN_WRITE_BUDGET - 2;   // F348: a full pool in this many grants (engine.js SHIELD_REGEN_GRANTS)
const MAX_SHIELD = 70;                          // `harness()`'s own default shield ceiling (S45: a real
                                                 // `health.max_shield` field now; the golden bundle's OWN
                                                 // default is 0, Standard's shape -- see `shieldCeiling`)

const FILL = `$LIFE,0,0,${MAX_SHIELD},*`;
const STEP = Math.ceil(MAX_SHIELD / GRANTS);   // F348: one recharge grant   // F347: the spawn fill a shields life ends its burst with

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

function harness({ shields = false, shieldCeiling = MAX_SHIELD } = {}) {
  let clock = 1_000_000;
  const writes = [];
  const teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }];
  // `shields` is S45's preset shape: armour 0, which is what `is_shields_preset`/`shieldRegenOn` key the
  // recharge on. `shieldCeiling` (S45: `health.max_shield` is a real host field now) defaults to MAX_SHIELD
  // so every existing call site keeps the ceiling it always implicitly had -- the golden bundle's OWN
  // `$PSET` used to arm a free, fixed 70 regardless of what the config asked for; now Standard (the golden
  // bundle's default) ships 0, so a harness that wants a ceiling has to say so.
  const health = shields ? { max_hp: 30, max_armor: 0, max_shield: shieldCeiling } : { max_hp: 45, max_armor: 70, max_shield: shieldCeiling };
  // The node reads its pool CEILINGS off the compiled `$PSET`, not off `config.health` (`_headPool`), so a
  // harness that moved only the config would arm a 45/70 gun and read every shields frame as damage.
  const frames = { ...golden, player_id: 'p1' };
  frames.head = frames.head.map(f => (f.startsWith('$PSET,')
    ? f.split(',').map((tok, i) => (i === 3 ? String(health.max_hp) : i === 4 ? String(health.max_armor) : i === 5 ? String(shieldCeiling) : tok)).join(',') : f));
  const config = { config_id: golden.config_id, mode: 'ffa', environment: 'outdoor', night: false, time_limit_s: 1800,
    respawn: { type: 'auto', delay_s: 15 }, scoring: { frag_limit: 25, win_by: 'kills' }, health, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'ROCCO', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: () => {}, report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames, roster: [] } });
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  const h = {
    eng, writes,
    adv(ms, step = 250) { const end = clock + ms; while (clock < end) { clock = Math.min(end, clock + step); eng.tick(); } return h; },
    f(fr) { eng.feedFrame(fr); return h; },
    pull() { return h.f('$BUT,0,1,*').adv(200).f('$BUT,0,0,*').adv(200); },
    count(frame) { return writes.filter(w => w === frame).length; },
    // F264: the dead-gun probe is a `$LIFE` frame too, so counting the command word alone counts questions as
    // pool changes. `isPoolProbe` is the one reading of that distinction; see its comment in engine.js.
    // F347: a shields life starts with the spawn FILL (`$LIFE,0,0,<max>,*`) in its burst; that is not a recharge grant.
    grants() { return writes.filter(w => w.startsWith('$LIFE,') && !isPoolProbe(w) && w !== FILL).length; },
    fills() { return writes.filter(w => w === FILL).length; },
    /** Advance time the way a real gun would answer: every `$LIFE` the node writes comes back as the `$HP`
     *  echo it earned, clamped at the ceiling. Without this the node is granting into a void and the cap
     *  (rightly) stops it, so a test of the refill must play the gun's side. */
    run(ms, { echo = true, hp = 30, armor = 0, probes = false } = {}) {
      const end = clock + ms;
      let seen = h.grants(), asked = writes.filter(isPoolProbe).length;
      while (clock < end) {
        clock = Math.min(end, clock + 50); eng.tick();
        // `probes`: a live gun that ignores the grants still answers the liveness probe (F272), with its unchanged pool
        if (probes && writes.filter(isPoolProbe).length > asked) { asked = writes.filter(isPoolProbe).length; h.f(`$HP,${hp},${armor},${eng.shield},*`); }
        if (echo && h.grants() > seen) {
          seen = h.grants();
          h.f(`$HP,${hp},${armor},${Math.min(MAX_SHIELD, seen * STEP)},*`);
        }
      }
      return h;
    },
  };
  h.adv(10);
  h.f(shields ? '$LCD,30,0,0,0,30,90,*' : '$LCD,45,70,0,0,30,90,*').adv(3000);   // the gun's first word, at THIS game's pools
  assert.equal(eng.phase, 'live'); assert.equal(eng.alive, true);
  return h;
}

/** Live, alive, and the gun has just reported an EMPTY magazine with `reserve` still behind it. */
function dry(h, reserve = 192) {
  h.f(`$ALCD,30,100,0,${reserve},0,*`).f(`$ALCD,0,100,0,${reserve},0,*`);
  return h;
}

// ---------- the reload nag ----------

test('the 5th dry pull says RELOAD, then every 3rd', () => {
  const h = dry(harness());
  for (let i = 1; i <= 4; i++) { h.pull(); assert.equal(h.count(NAG), 0, `pull ${i} is silent`); }
  h.pull(); assert.equal(h.count(NAG), 1, 'the 5th pull speaks');
  h.pull(); h.pull(); assert.equal(h.count(NAG), 1, 'pulls 6 and 7 are silent');
  h.pull(); assert.equal(h.count(NAG), 2, 'the 8th pull speaks');
  h.pull(); h.pull(); h.pull(); assert.equal(h.count(NAG), 3, 'and the 11th');
});

test('a reload starts the count over', () => {
  const h = dry(harness());
  for (let i = 0; i < 5; i++) h.pull();
  assert.equal(h.count(NAG), 1, 'setup: one nag so far');
  h.f('$ALCD,30,70,0,162,0,*');                 // the magazine came back
  assert.equal(h.eng._dryPulls, 0, 'the dry spell ended with the reload');
  h.f('$ALCD,0,70,0,162,0,*');                  // and ran out again
  for (let i = 1; i <= 4; i++) { h.pull(); assert.equal(h.count(NAG), 1, `pull ${i} of the new spell is silent`); }
  h.pull(); assert.equal(h.count(NAG), 2, 'the 5th pull of the new spell speaks');
});

test('a dry reserve is never nagged -- there is nothing to reload to', () => {
  const h = dry(harness(), 0);
  for (let i = 0; i < 9; i++) h.pull();
  assert.equal(h.count(NAG), 0, 'no reserve, no nag');
});

test('a slot the gun has never reported a reserve for is never nagged', () => {
  // The fallback read the LAST reserve reported on any slot, so a slot with nothing behind it borrowed the
  // primary's. Melee is the live case: it is slot 4, it arrives on its own `$ALCD`, and `_onAmmo` makes
  // whatever spoke last the active slot -- so every pull after a swing was nagged against slot 0's reserve.
  const h = harness();
  h.f('$ALCD,30,100,0,192,0,*');                // slot 0 has a reserve, and it is not empty
  h.eng.activeSlot = 3;                          // a slot the gun has said nothing at all about
  for (let i = 0; i < 9; i++) h.pull();
  assert.equal(h.count(NAG), 0, 'RELOAD against another slot reserve is a guess, and the player can hear it');
});

test('an overheated gun is silent -- the magazine is not what stopped the round', () => {
  const h = harness();
  h.f('$ALCD,30,100,0,192,0,*').f('$ALCD,0,100,0,192,99,*');   // empty AND heat-locked (HEAT_LOCKOUT)
  assert.equal(h.eng._heatBlocksFire(), true, 'setup: the lockout is on');
  for (let i = 0; i < 9; i++) h.pull();
  assert.equal(h.count(NAG), 0, 'RELOAD would name the wrong fix while the gun is locked out');
});

test('a stunned gun is silent, and the stun does not carry a count into the next spell', () => {
  const h = dry(harness());
  h.eng.config.stun = { duration_s: 10 };
  h.eng._stun();
  assert.ok(h.eng.stunned, 'setup: stunned');
  for (let i = 0; i < 9; i++) h.pull();
  assert.equal(h.count(NAG), 0, 'a disarmed gun says nothing');
  assert.equal(h.eng._dryPulls, 0, 'and nothing was counted');
});

// ---------- shields online ----------

test('the grant that fills the shield says SHIELDS ONLINE, once', () => {
  const h = harness();
  assert.equal(h.eng.maxShield, MAX_SHIELD, 'setup: the head arms a shield ceiling');
  assert.equal(h.count(ONLINE), 0, 'a spawn is not a recharge: the shield starts at 0');
  h.f('$HP,45,70,0,*');
  assert.equal(h.count(ONLINE), 0, 'nor is a frame reporting that empty shield');
  h.f('$HP,45,70,40,*');
  assert.equal(h.count(UP), 1, 'a grant on the way up is the ordinary shield_up line');
  assert.equal(h.count(ONLINE), 0, 'not full yet');
  h.f(`$HP,45,70,${MAX_SHIELD},*`);
  assert.equal(h.count(ONLINE), 1, 'the grant that reached the ceiling speaks');
  assert.equal(h.count(UP), 1, 'and it did NOT also play the per-grant line (one speaker, the rarer cue wins)');
  h.f(`$HP,45,70,${MAX_SHIELD},*`).f(`$HP,45,70,${MAX_SHIELD},*`);
  assert.equal(h.count(ONLINE), 1, 'the frames that merely report a full shield are silent');
});

test('a shield broken and recharged speaks again', () => {
  const h = harness();
  h.f(`$HP,45,70,${MAX_SHIELD},*`);
  assert.equal(h.count(ONLINE), 1, 'setup: charged once');
  h.f('$HP,45,70,20,*');                          // shot: the shield takes it first
  h.f(`$HP,45,70,${MAX_SHIELD},*`);
  assert.equal(h.count(ONLINE), 2, 'the next refill is its own piece of news');
});

test('with no shield ceiling a grant is a grant, not a full charge', () => {
  // The head says this game has no shield, and the gun reports one anyway (a stale head, or a bundle with no
  // readable `$PSET`). Without the `maxShield > 0` guard, `0 >= 0` reads every such grant as "full".
  const h = harness();
  h.eng.frames.head = h.eng.frames.head.map(f => (f.startsWith('$PSET,') ? f.split(',').map((t, i) => (i === 5 ? '0' : t)).join(',') : f));
  assert.equal(h.eng.maxShield, 0, 'setup: no shield in this game');
  h.f('$HP,45,70,20,*');
  assert.equal(h.count(ONLINE), 0, 'nothing to fill, nothing to announce');
  assert.equal(h.count(UP), 1, 'it is still a shield grant');
});

// ---------- S29: the recharge mechanic, and the four cues hung off it ----------

const DOWN = golden.cues.shield_down;           // $PLAY,,4,6,N101,* -- the break
const CHARGING = golden.cues.shield_charging;   // $PLAY,,4,6,N102,* -- the first grant of a refill
const LOOP = golden.cues.shield_loop;           // $PLAY,,4,6,N74,*  -- the heartbeat while it is gone
const DELAY = 6500;

/** A shields game, live, with the shield full and the player about to lose it. */
function shielded() {
  const h = harness({ shields: true });
  assert.equal(h.eng.shieldRegenOn, true, 'setup: this game recharges shields');
  assert.equal(h.fills(), 1, 'setup: the spawn filled the shield (F347)');
  h.f(`$HP,30,0,${MAX_SHIELD},*`);                // the gun's answer to that fill
  assert.equal(h.eng.shield, MAX_SHIELD, 'setup: full');
  assert.equal(h.count(ONLINE), 0, 'setup: a spawn fill is not a recharge, so it is silent');
  return h;
}

test('S29: break, heartbeat, refill, online -- the whole cycle', () => {
  const h = shielded();
  h.f('$HP,30,0,0,*');                            // the shield takes a hit all the way through
  assert.equal(h.count(DOWN), 1, 'the break speaks');
  assert.equal(h.count(LOOP), 0, 'the heartbeat does not land under the break cue');
  h.run(2100, { echo: false });
  assert.equal(h.count(LOOP), 1, 'one heartbeat, a clip-length after the break');
  h.run(2000, { echo: false });
  assert.equal(h.count(LOOP), 2, 'and it keeps time');
  assert.equal(h.grants(), 0, 'nothing granted before the delay is up');
  h.run(DELAY);                                   // past the quiet window: the refill runs
  assert.equal(h.count(CHARGING), 1, 'the refill announces itself once');
  // Not "no more heartbeats after this point in the test" -- the heartbeat is SUPPOSED to keep time right up
  // to the refill. The claim is that it stops when the refill STARTS, so it is asked of the write stream:
  // nothing after the `shield_charging` frame may be a heartbeat.
  const after = h.writes.slice(h.writes.indexOf(CHARGING));
  assert.equal(after.includes(LOOP), false, 'the heartbeat stops the moment the recharge starts');
  // EXACTLY the beats the timing predicts, not 'at least': `>=` would let a heartbeat written in the SAME
  // tick as `shield_charging` pass, because it lands just before it in the stream and the slice cannot see it.
  assert.equal(h.count(LOOP), Math.floor(DELAY / 1940), 'and it kept time all the way to it, and no further');
  assert.equal(h.eng.shield, MAX_SHIELD, 'the pool came back');
  assert.equal(h.count(ONLINE), 1, 'and says so, once');
  assert.equal(h.count(UP), 0, 'never the per-grant line: twelve of those would cut each other off');
  assert.equal(h.grants(), GRANTS, 'exactly the grants a full pool needs');
  h.run(4000);
  assert.equal(h.grants(), GRANTS, 'and it stops granting once the gun says full');
  assert.equal(h.count(ONLINE), 1, 'no second announcement');
});

test('S29: damage restarts the clock -- the shield comes back only when you break contact', () => {
  const h = shielded();
  h.f('$HP,30,0,0,*');
  h.run(DELAY - 1000, { echo: false });
  assert.equal(h.grants(), 0, 'setup: nearly there');
  h.f('$HP,25,0,0,*');                            // hit again
  h.run(DELAY - 1000, { echo: false });
  assert.equal(h.grants(), 0, 'the hit put the whole delay back');
  h.run(1500);
  assert.ok(h.grants() > 0, 'and it starts once the new quiet window is served');
});

test('S29: a hit MID-refill abandons it, and the next one announces itself again', () => {
  const h = shielded();
  h.f('$HP,30,0,0,*');
  h.run(DELAY + 600);
  assert.equal(h.count(CHARGING), 1, 'setup: a refill is running');
  const mid = h.grants();
  assert.ok(mid > 0 && h.eng.shield < MAX_SHIELD, 'setup: part way up');
  h.f(`$HP,20,0,${Math.max(0, h.eng.shield - 20)},*`);   // shot again
  h.run(2000, { echo: false });
  assert.equal(h.grants(), mid, 'the refill stopped');
  h.run(DELAY + 3000, { hp: 20 });
  assert.equal(h.count(CHARGING), 2, 'the next refill is its own piece of news');
  assert.equal(h.eng.shield, MAX_SHIELD);
});

test('S29: an ordinary game never grants -- the preset is the opt-in, not the ceiling', () => {
  const h = harness();                            // 45 HP + 70 armour + a shield ceiling: still not a shields game
  assert.equal(h.eng.maxShield, MAX_SHIELD, 'setup: a non-zero shield beside armour does not opt in on its own');
  assert.equal(h.eng.shieldRegenOn, false);
  h.f('$HP,45,70,0,*');
  h.run(DELAY * 3, { echo: false, hp: 45, armor: 70 });
  assert.equal(h.grants(), 0, 'no $LIFE in a game that never asked for shields');
  assert.equal(h.count(CHARGING), 0);
});

test('S29: a dead gun is not refilled, and a fresh life does not heartbeat', () => {
  const h = shielded();
  h.f('$HP,30,0,0,*');
  assert.equal(h.count(DOWN), 1, 'setup: the shield broke');
  h.f('$HP,0,0,0,*');                             // down
  assert.equal(h.eng.alive, false, 'setup: dead');
  const loops = h.count(LOOP);
  h.run(DELAY * 2, { echo: false });
  assert.equal(h.grants(), 0, 'nothing is granted to a dead gun');
  assert.equal(h.count(LOOP), loops, 'and the heartbeat stopped with the life');
  // ...and a STUNNED gun is not granted to either: it is disarmed, and a write there fights the restore
  h.eng._revive(false);
  h.f('$HP,30,0,0,*');
  h.eng.config.stun = { duration_s: 60 };
  h.eng._stun();
  assert.ok(h.eng.stunned, 'setup: stunned');
  h.run(DELAY * 2, { echo: false });
  assert.equal(h.grants(), 0, 'nothing is granted to a disarmed gun');
  h.eng._stunRestore('test');
  h.eng._revive(false);
  const downs = h.count(DOWN);
  h.f('$HP,30,0,0,*');                            // the new life reports its empty shield
  assert.equal(h.count(DOWN), downs, 'a shield that starts at 0 never CROSSED 0: that is not a break');
  h.run(2500, { echo: false });
  assert.equal(h.count(LOOP), loops, 'a fresh life starts at shield 0 WITHOUT having broken: no heartbeat');
  assert.equal(h.grants(), 0, 'and no recharge grant: the life is filled by its spawn write instead (F347)');
  assert.equal(h.fills(), 3, 'one fill per life: the go-live spawn and the two revives');
});

test('S29: a gun that never reports full is granted at a capped number of times, not forever', () => {
  const h = shielded();
  h.f('$HP,30,0,0,*');
  h.run(DELAY + 30000, { echo: false, probes: true });   // the gun never answers a grant (F348: 7 s of grants outlast F272's probe pair, so it answers those)
  assert.equal(h.grants(), GRANTS + 3, 'a full pool of grants plus the slack, then it gives up');
  h.run(30000, { echo: false, probes: true });
  assert.equal(h.grants(), GRANTS + 3, 'and it does not start again on its own');
});

test('S29: a stand-down mid-refill re-earns the delay, and never announces the refill twice', () => {
  // The stand-down abandons a running refill, and the comment beside it says it "re-earns its delay once the
  // player is back". It did not: `_shieldQuietAt` was left where it was, so the very next tick found the
  // delay long since served, started again, and said `shield_charging` a second time for one refill. A stun,
  // a resync, a reconcile or a BLE blip are all ordinary mid-match events, so this is reachable every game.
  const h = shielded();
  h.f('$HP,30,0,0,*');
  h.run(DELAY + 600);
  assert.equal(h.count(CHARGING), 1, 'setup: a refill is running');
  const mid = h.grants();
  assert.ok(mid > 0 && h.eng.shield < MAX_SHIELD, 'setup: part way up');
  h.eng.config.stun = { duration_s: 1 };
  h.eng._stun();
  h.run(500, { echo: false });
  assert.equal(h.grants(), mid, 'setup: a disarmed gun is not granted to');
  h.eng._stunRestore('expired');
  h.run(1500, { echo: false });
  assert.equal(h.grants(), mid, 'the refill must serve a fresh quiet window, not resume on the next tick');
  assert.equal(h.count(CHARGING), 1, 'one refill is one piece of news, however many stand-downs interrupt it');
  h.run(DELAY + 3000);
  assert.equal(h.count(CHARGING), 2, 'and the refill after the new quiet window is its own news');
});

test('S29: a gun that never answers stops the heartbeat too, not just the grants', () => {
  const h = shielded();
  h.f('$HP,30,0,0,*');
  h.run(DELAY + 30000, { echo: false, probes: true });
  assert.equal(h.eng._shieldGaveUp, true, 'setup: the cap gave up on a gun that never reports full');
  const loops = h.count(LOOP);
  h.run(20000, { echo: false, probes: true });
  assert.equal(h.count(LOOP), loops,
    'N74 must not replay every 1.94 s for the rest of the life on a gun nothing can fix');
});

test('S29: the heartbeat follows the POOL, not the break -- a shield part way back is not a shield gone', () => {
  // `_shieldDown` means "it broke this life", which is the right latch for the BREAK cue and the wrong one
  // for the heartbeat. A hit that abandons a refill half way up leaves 40 of 70 on the pool, and the gun
  // went on saying the shield was gone.
  const h = shielded();
  h.f('$HP,30,0,0,*');
  h.run(DELAY + 900);
  assert.ok(h.eng.shield > 0 && h.eng.shield < MAX_SHIELD, `setup: part way up (${h.eng.shield})`);
  h.f(`$HP,20,0,${h.eng.shield},*`);            // a hit on health: the refill is abandoned, the shield stays up
  const loops = h.count(LOOP);
  h.run(6000, { echo: false, hp: 20 });
  assert.equal(h.count(LOOP), loops, 'the shield is not GONE, so nothing may say it is');
});

test('S29: a relink does not announce a break that happened while the node was away', () => {
  const h = shielded();
  h.eng.reconciling = { at: h.eng.now() };      // §3.10: the node infers nothing in this window
  h.f('$HP,30,0,0,*');                          // the gun's first word back, reporting a shield long gone
  assert.equal(h.count(DOWN), 0, 'a reconcile frame is the gun catching us up, not a break happening now');
});

test('S29: no heartbeat is written in the same tick the recharge starts', () => {
  // The ordering inside `_shieldTick`, pinned on its own and deterministically: BOTH the heartbeat and the
  // refill are made due at the same instant, and one tick is run at it. The refill wins that tick. Driving
  // this through the clock cannot pin it -- with the default period a beat is never due at the refill
  // instant, and at any period the two land on adjacent tick steps rather than the same one.
  const h = shielded();
  h.f('$HP,30,0,0,*');                            // the shield breaks
  assert.equal(h.eng._shieldDown, true, 'setup: the shield is down');
  const now = h.eng.now();
  h.eng._shieldQuietAt = now - DELAY;             // the refill is due NOW
  h.eng._shieldLoopAt = now - 1940;               // ...and so is a heartbeat
  const n = h.writes.length;
  h.eng._shieldTick(now);
  const wrote = h.writes.slice(n);
  assert.ok(wrote.includes(CHARGING), 'the refill starts');
  assert.equal(wrote.includes(LOOP), false, `and the heartbeat does NOT go out under it: ${wrote}`);
  // CONTROL: with the refill NOT due, the same moment does write a heartbeat
  const g = shielded();
  g.f('$HP,30,0,0,*');
  const now2 = g.eng.now();
  g.eng._shieldLoopAt = now2 - 1940;
  const m = g.writes.length;
  g.eng._shieldTick(now2);
  assert.ok(g.writes.slice(m).includes(LOOP), 'control: a heartbeat alone is written');
});
