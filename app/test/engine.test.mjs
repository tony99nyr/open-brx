// Engine tests — node --test (no framework). Covers node.md §3 (A6): arm from a FrameBundle,
// echo→ack_config, start→spawn, hit/death attribution, DEATH_LATCH, respawn, shots counter,
// feedback freshness, timed end→KITTED, the §3.10 resync table, resumeSchedule across T-0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, handoverPool, PLAYX, TEAM_REPAINT_MS, ACC_WRITE_MIN_GAP_MS, ACC_VERIFY_GRACE_MS, ACC_HOLD_MS, ACC_ECHO_MS, RECOIL_SETTLE_MIN_MS, SMOKE_MS, TRIGGER_NO_FIRE_MS, OVERHEAT_SHOWN_MS, OVERHEAT_CAP_MS, HEAT_STALE_MS, STAND_DOWN_NAMES, frameCommand, deniedCommand, isPoolProbe, PROBE_LIFE } from '../src/engine.js';
import { Hud } from '../src/hud/hud.js';
import * as W from '../src/transport/envelope.js';
import { CONTROL_STATE } from '../src/control.js';   // the phone control point's advert bits (K1)
import { Presence, encodeUuid } from '../src/beacon.js';   // the REAL advert path, for the clock-mismatch guard

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

// A16 redesign: `golden.leds` no longer carries hit_taken/died/healed/armour_up/shield_up/respawned (the
// readout/role systems are the feedback for those now, per led-language.md §3.1) -- but the SHAPE of an
// event burst (several [$GLED-or-$HLED frame, hold] steps, ending on a fixed frame) is still real and
// several tests below need a stand-in burst to exercise it, deliberately decoupled from which specific
// events the compiled bundle still attaches one to.
const TEST_BURST = [['$GLED,0,0,0,0,10,,*', 0.08], ['$GLED,,,,5,,,*', 0.08], ['$GLED,1,1,1,0,10,,*', 0.0]];

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

test('F202: forgetting a tagger clears only the local gun ownership and persists the cleared blob', () => {
  const storage = mkStorage();
  const writes = [];
  const eng = new Engine({ writer: frames => writes.push(...frames), storage, now: () => 1_000_000 });
  eng.gun = { name: 'ALPHA-FE30', tail: 'FE30' };
  eng.player = { player_id: 'p1', display: 'REAPER' };
  eng.phase = 'connected';
  eng.probeSent = true; eng.fw = 'old-fw'; eng.battery = 87; eng.lastVoltsAt = 123; eng.headEcho = '$ALCD,1';
  eng.forgetGun();
  assert.equal(eng.gun, null);
  assert.equal(eng.player.player_id, 'p1', 'MC player context remains for the next assignment');
  assert.equal(eng.probeSent, false, 'the next tagger gets a fresh firmware probe');
  assert.equal(eng.fw, null, 'old tagger firmware is not shown for the next tagger');
  assert.equal(eng.battery, null); assert.equal(eng.lastVoltsAt, 0); assert.equal(eng.headEcho, null);
  assert.equal(eng.phase, 'idle', 'the replacement picker is rendered from the idle screen');
  eng.phase = 'connected'; eng._probe();
  assert.ok(writes.length > 0, 'fresh tagger probe is allowed after forgetting');
  assert.equal(JSON.parse(storage.getItem('brx.engine')).gun, null, 'the remembered gun is gone after restart');
});

function harness({ mode = 'tdm', respawn = 'auto', timeLimit = 600, synced = true, delay = null } = {}) {
  const writes = []; const facts = []; const reports = []; const delays = [];
  let clock = 1_000_000;
  const config = { config_id: golden.config_id, mode, environment: 'outdoor', night: false, time_limit_s: timeLimit,
    respawn: { type: respawn, delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' }];
  // `delay`: a test that needs to hold a scheduled write and fire it later (the F149 low-health debounce)
  // passes its own; every other test gets the old behaviour, synchronous but recorded in `delays`.
  // This broad harness has no simulated reply path for F272's independent liveness read. Report that one
  // transport write as not delivered so long-running game-rule tests cannot manufacture a locked gun from a
  // fake that is incapable of answering; gun-lock.test.mjs owns the detector and recovery behavior.
  const eng = new Engine({ writer: (fr, why) => { const n = writes.push(...fr); return String(why).startsWith('gun liveness probe') ? false : n; }, emit: f => facts.push(f), report: (k, b) => reports.push({ k, b }),
    now: () => clock, synced: () => synced, storage: mkStorage(), log: () => {}, delay: delay || ((ms, fn) => { delays.push(ms); fn(); }) });
  const bundle = { ...golden, player_id: 'p1' };
  const api = {
    eng, writes, facts, reports, delays, bundle, config, player, team, roster,
    adv: t => { clock += t; return clock; }, at: t => { clock = t; },
    kit() { eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); eng.onMcMessage({ kind: 'assign', body: { player, team, roster } }); return api; },
    config_() { eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } }); return api; },
    echo() { eng.feedFrame('$LCD,0,0,0,0,0,0,*'); return api; },
    queryConfig() { eng.feedFrame('$QUERY,7,1,45,70,0,,1,0,,0,*'); return api; },
    start(runwayMs = 0) { eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock + runwayMs, config_id: golden.config_id, seq: 1, countdown_s: Math.round(runwayMs / 1000) } }); return api; },
    frame(f) { eng.feedFrame(f); return api; },
  };
  return api;
}

test('arm: config writes head (no $SPAWN), echo → ack_config ok', () => {
  const h = harness().kit().config_();
  assert.equal(h.eng.phase, 'lobby');
  assert.ok(h.writes.includes('$START,*'), 'head has $START');
  assert.ok(h.writes.some(f => f.startsWith('$PSET,7,')), 'head has $PSET with player_num 7');
  assert.ok(!h.writes.includes('$SPAWN,,*'), 'head has NO $SPAWN');
  h.adv(1600); h.echo(); h.eng.tick(); h.queryConfig();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.ok(ack && ack.b.ok === true && ack.b.gun_echo, 'ack_config ok with gun_echo');
});

test('no echo → ack_config no_echo', () => {
  const h = harness().kit().config_();
  h.adv(1600); h.eng.tick();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.ok(ack && ack.b.ok === false && ack.b.err === 'no_echo');
});

test('start → armed, spawn at T-0 → live', () => {
  const h = harness().kit().config_().echo().start(9000);
  assert.equal(h.eng.phase, 'armed');
  h.adv(9000); h.eng.tick();
  assert.equal(h.eng.phase, 'live');
  assert.ok(h.writes.includes('$SPAWN,,*'), 'spawn frames written at T-0');
  assert.ok(h.writes.includes('$SFLASH,*'), 'green-sight flash at spawn');
  assert.equal(h.eng.alive, true);
});

test('hit_taken + death credit the fresh $HIR shooter', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();  // live, alive
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,45,61,0,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.equal(hit.shooter_num, 19); assert.equal(hit.shooter_team, 2); assert.equal(hit.dmg, 9);
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  const death = h.facts.find(f => f.type === 'death');
  assert.equal(death.shooter_num, 19); assert.equal(h.eng.alive, false); assert.equal(h.eng.deaths, 1);
});

test('dual-emitter words share a shot group while the next rapid pull does not', () => {
  const h = harness(); h.bundle.dual_emitters = [{ proto: 0, subtype: 0, body: 8, headset: 1, cycle_ms: 100 }];
  h.kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,8,0,0,*').frame('$HP,45,62,0,*');
  h.adv(90);
  h.frame('$HIR,0,0,19,2,1,0,0,*').frame('$HP,45,61,0,*');
  const pair = h.facts.filter(f => f.type === 'hit_taken');
  assert.equal(pair.length, 2);
  assert.equal(pair[0].shot_group, pair[1].shot_group, 'one physical trigger pull counts once');
  h.adv(10);
  h.frame('$HIR,4,0,19,2,8,0,0,*').frame('$HP,45,53,0,*');
  assert.notEqual(h.facts.filter(f => f.type === 'hit_taken')[2].shot_group, pair[1].shot_group,
    'the next 100 ms SMG pull must start a new group');
});

test('equal dual-emitter words group, while rapid ordinary equal hits do not', () => {
  const shotgun = harness(); shotgun.bundle.dual_emitters = [{ proto: 0, subtype: 0, body: 20, headset: 20, cycle_ms: 800 }];
  shotgun.kit().config_().echo().start(0); shotgun.adv(10); shotgun.eng.tick();
  shotgun.frame('$HIR,4,0,19,2,20,0,0,*').frame('$HP,45,50,0,*');
  shotgun.adv(40);
  shotgun.frame('$HIR,0,0,19,2,20,0,0,*').frame('$HP,45,30,0,*');
  const pair = shotgun.facts.filter(f => f.type === 'hit_taken');
  assert.equal(pair[0].shot_group, pair[1].shot_group);

  const ordinary = harness(); ordinary.kit().config_().echo().start(0); ordinary.adv(10); ordinary.eng.tick();
  ordinary.frame('$HIR,4,0,19,2,9,0,0,*').frame('$HP,45,61,0,*');
  ordinary.adv(40);
  ordinary.frame('$HIR,0,0,19,2,9,0,0,*').frame('$HP,45,52,0,*');
  const hits = ordinary.facts.filter(f => f.type === 'hit_taken');
  assert.notEqual(hits[0].shot_group, hits[1].shot_group);
});

test('dual-emitter words share one physical-shot group', () => {
  const h = harness(); h.bundle.dual_emitters = [{ proto: 0, subtype: 0, body: 8, headset: 1, cycle_ms: 100 }];
  h.kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,8,0,0,*').frame('$HP,45,62,0,*');
  h.frame('$HIR,0,0,19,2,1,0,0,*').frame('$HP,45,61,0,*');
  const hits = h.facts.filter(f => f.type === 'hit_taken');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].shot_group, hits[1].shot_group);
  h.frame('$HIR,4,0,19,2,8,0,0,*').frame('$HP,45,53,0,*');
  assert.notEqual(h.facts.filter(f => f.type === 'hit_taken')[2].shot_group, hits[1].shot_group);
});

test('F72: a proto-15 beacon does not hit-latch, does not emit hit_taken, does not touch pools, and surfaces owner+magnitude', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();  // live, alive
  const hpBefore = h.eng.hp, armorBefore = h.eng.armor;
  h.frame('$HIR,4,15,0,2,8,0,0,*');   // a neutral hill's ambient beacon: sensor 4, proto 15, ownerId 0, owner team 2, magnitude 8
  assert.equal(h.eng.latch, null, 'a beacon must never set the hit latch');
  assert.equal(h.facts.some(f => f.type === 'hit_taken'), false, 'a beacon must never emit hit_taken');
  assert.equal(h.eng.hp, hpBefore); assert.equal(h.eng.armor, armorBefore);   // no $HP followed, so no pool move either
  assert.deepEqual(h.eng.state().beacon, { owner_team: 2, magnitude: 8, sensor: 4, at: h.eng.now() });
  // a real shot right after still latches and scores normally — the beacon did not wedge anything
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,45,61,0,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.ok(hit, 'an ordinary hit after a beacon must still latch and score');
  assert.equal(hit.shooter_num, 19); assert.equal(hit.shooter_team, 2); assert.equal(hit.dmg, 9);
});

test('F85: a beacon caught by two sensors 14 ms apart (same protocol+magnitude+owner) is counted once', () => {
  // Bench 2026-09-10, captured verbatim: $HIR,4,15,0,2,8,0,0 then $HIR,0,15,0,2,8,0,0 14 ms later --
  // one physical hill transmission landing on the gun-body sensor AND a headset sensor.
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();  // live, alive
  h.at(500000);
  h.frame('$HIR,4,15,0,2,8,0,0,*');   // sensor 4, gun body
  const first = h.eng.state().beacon;
  assert.deepEqual(first, { owner_team: 2, magnitude: 8, sensor: 4, at: 500000 });
  h.adv(14);
  h.frame('$HIR,0,15,0,2,8,0,0,*');   // sensor 0, headset front -- SAME transmission
  assert.deepEqual(h.eng.state().beacon, first, 'the duplicate frame must not overwrite the beacon -- still sensor 4, still at the first timestamp');
});

test('F85: a same-millisecond capture pair (different magnitude, different owner) is NOT collapsed -- both words are counted', () => {
  // Bench 2026-09-10: $HIR,0,15,0,2,53,0,0 and $HIR,4,15,0,1,8,0,0 arrived in the SAME MILLISECOND on
  // different sensors during a real capture -- the outgoing owner's word, then the new owner's. A
  // time-only dedupe would drop one of these and could silently swallow the capture announcement.
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();  // live, alive
  h.at(600000);
  h.frame('$HIR,0,15,0,2,53,0,0,*');  // mag 53: the state being left (neutral)
  assert.deepEqual(h.eng.state().beacon, { owner_team: 2, magnitude: 53, sensor: 0, at: 600000 }, 'the outgoing word must be accepted');
  h.frame('$HIR,4,15,0,1,8,0,0,*');   // mag 8: the new owner's hill beacon, same millisecond, different sensor
  assert.deepEqual(h.eng.state().beacon, { owner_team: 1, magnitude: 8, sensor: 4, at: 600000 }, 'the new-owner word must ALSO be accepted -- a time-only dedupe would have dropped this');
});

test('F85: an identical beacon repeated at the normal ~5 s cadence is not swallowed by the dedupe window', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();  // live, alive
  h.at(700000);
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  assert.equal(h.eng.state().beacon.at, 700000);
  h.adv(5000);
  h.frame('$HIR,4,15,0,2,8,0,0,*');   // same word, 5.0 s later -- a real repeat, not a duplicate frame
  assert.equal(h.eng.state().beacon.at, 705000, 'a 5 s-later repeat must update the beacon, not be dropped as a dupe');
});

// ---------- King of the Hill audio (F70/F72/F74/F75/F82/F84/F85) ----------
// Every frame sequence below is copied from a real BLE capture in docs/experiment-log/2026-09.md,
// 2026-09-10 (evening): the neutral->blue capture that carries mag=53, and the blue->red
// enemy-to-enemy capture that does not. The harness player is BLUE (tid 1); RED (tid 0) is the enemy
// and tid 2 is NEUTRAL -- deliberately never used as a team here, which is F82's rule.
const HILL_TICK_F = '$PLAY,U100,4,6,,,,,*';       // U100, 0.114 s
const HILL_CAPTURED_F = '$PLAY,,4,6,VB0N,,,,*';   // VB0N "Hill Captured", 1.924 s
const HILL_LOST_F = '$PLAY,,4,6,VB0P,,,,*';       // VB0P "Hill Lost!", 2.976 s
const HILL_CONTESTED_F = '$PLAY,,4,6,VB0O,,,,*';  // VB0O "Hill Contested", 2.078 s
const nWrites = (h, f) => h.writes.filter(x => x === f).length;
/** Advance the clock in ~250 ms steps, ticking the engine like the app does. */
function run(h, ms, step = 250) { const n = Math.round(ms / step); for (let i = 0; i < n; i++) { h.adv(step); h.eng.tick(); } }
function koth() { const h = harness({ mode: 'koth' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick(); return h; }

test('hill: a lone mag=53 with no point already known does NOT invent a phantom', () => {
  // It used to write {owner: null, at: now, from_neutral: true}, holding a 12 s presence window open for a
  // point whose owner was never known, then logging "presence expired" for it — and leaving state().hill
  // non-null with a null owner, so every downstream reader had to test `owner` too. We simply did not see
  // this capture; the next mag=8 names the owner.
  const h = koth();
  h.frame('$HIR,0,15,0,2,53,0,0,*');            // walked in just as somebody captured it
  assert.equal(h.eng.state().hill, null, 'no point is known yet — do not invent one with a null owner');
  // the positive half: a mag=53 that FOLLOWS a known point still does its job
  h.frame('$HIR,4,15,0,1,8,0,0,*');
  h.frame('$HIR,0,15,0,2,53,0,0,*');
  assert.equal(h.eng.state().hill.owner, 1, 'the known owner survives');
  assert.equal(h.eng.state().hill.from_neutral, true, 'and mag=53 still records that it was neutral');
});

test('hill: cue_ms of 0 means "do not suppress the tick", not "use the default length"', () => {
  // `(cm && cm[kind]) || def.ms` treated a deliberate 0 as absent and silently restored 1924 ms.
  const h = harness({ mode: 'koth' }).kit().config_().echo().start(0);
  h.eng.frames.cue_ms = { hill_captured: 0 };
  h.adv(10); h.eng.tick();
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  h.adv(50);
  h.frame('$HIR,4,15,0,1,50,0,0,*');            // we capture: the callout plays
  const n = nWrites(h, HILL_TICK_F);
  run(h, 1500);
  assert.ok(nWrites(h, HILL_TICK_F) > n, 'with cue_ms 0 the tick must NOT be suppressed');
});

test('hill CONTROL: a real cue_ms length DOES suppress the tick, so the zero case is not vacuous', () => {
  const h = harness({ mode: 'koth' }).kit().config_().echo().start(0);
  h.eng.frames.cue_ms = { hill_captured: 3000 };
  h.adv(10); h.eng.tick();
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  h.adv(50);
  h.frame('$HIR,4,15,0,1,50,0,0,*');
  const n = nWrites(h, HILL_TICK_F);
  run(h, 1500);
  assert.equal(nWrites(h, HILL_TICK_F), n, 'a 3 s callout owns the announcer: no tick inside it');
});

test('hill: F82 is explained on the FIRST beacon, not only when a transition would be announced', () => {
  // The warning used to live in _hillCallout, which is only reached when a capture changes hands, so a
  // tid-2 roster that never witnessed one went silent with no reason in the log. The stage's default tdm
  // roster is blue(1) + yellow(2), so this is one selector click away at the bench.
  const h = harness({ mode: 'koth' }).kit();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, roster: h.roster,
    team: { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 } } });
  const logs = [];
  h.eng.log = (m) => logs.push(String(m));       // the harness discards logs by default
  h.config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,15,0,1,8,0,0,*');             // a plain beacon: no transition, nothing to announce
  assert.ok(logs.some(m => m.includes('F82')),
    'a tid-2 roster must be TOLD why hill audio is silent, on the FIRST beacon — not only if a capture happens');
  // the control: a decidable roster must NOT be warned
  const ok = harness({ mode: 'koth' }).kit();
  const okLogs = []; ok.eng.log = (m) => okLogs.push(String(m));
  ok.config_().echo().start(0); ok.adv(10); ok.eng.tick();
  ok.frame('$HIR,4,15,0,1,8,0,0,*');
  assert.ok(!okLogs.some(m => m.includes('F82')), 'a tid-1 roster has nothing to warn about');
});

test('hill: from_neutral is DERIVED on an owner change, never inherited from the previous owner', () => {
  // Found 2026-09-10 while porting this logic to the bench stage. `from_neutral` used to carry
  // `prev.from_neutral` through the plain-beacon path, so once a point had been taken FROM NEUTRAL every
  // later owner adopted via the "we missed the capture word" route still read `from_neutral: true` --
  // claiming they took it from nobody when they in fact stole it from a team.
  //
  // Not cosmetic: `mcp/brx_mcp/modes/hillbeacon.py` splits its callouts on this field and derives the same
  // fact independently (`from_neutral = previous == NEUTRAL`), so a leak here makes MC and the phone
  // disagree about the same capture.
  const h = koth();
  h.frame('$HIR,4,15,0,2,8,0,0,*');             // neutral holds it
  h.adv(50);
  h.frame('$HIR,4,15,0,1,50,0,0,*');            // we take it: mag 50
  h.adv(5000); h.eng.tick();
  h.frame('$HIR,4,15,0,1,53,0,0,*');            // mag 53 lands 5 s later: it WAS neutral
  assert.equal(h.eng.state().hill.from_neutral, true, 'a capture from neutral is confirmed by mag=53');

  // Now RED takes it off us, and we only ever see the plain beacon (the mag=50 never reached us).
  h.adv(5000); h.eng.tick();
  h.frame('$HIR,4,15,0,0,8,0,0,*');
  const st = h.eng.state().hill;
  assert.equal(st.owner, 0, 'red owns it now');
  assert.equal(st.from_neutral, false,
    'red STOLE it from us -- inheriting the earlier true would claim red took it from nobody');
});

test('hill CONTROL: a plain beacon that changes nothing keeps from_neutral, so the fix did not just zero it', () => {
  // The companion to the test above: "false" must not be satisfied by an engine that clears the field on
  // every beacon. A heartbeat naming the SAME owner has to preserve what we already knew.
  const h = koth();
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  h.adv(50);
  h.frame('$HIR,4,15,0,1,50,0,0,*');
  h.adv(5000); h.eng.tick();
  h.frame('$HIR,4,15,0,1,53,0,0,*');            // confirmed: from neutral
  h.adv(5000); h.eng.tick();
  h.frame('$HIR,4,15,0,1,8,0,0,*');             // a plain heartbeat, same owner, changes nothing
  assert.equal(h.eng.state().hill.from_neutral, true, 'an unchanged owner keeps what we already knew');
});

test('hill: the possession tick plays once a second while MY team holds a fresh point', () => {
  const h = koth();
  h.frame('$HIR,4,15,0,1,8,0,0,*');            // blue (us) holds it
  run(h, 3000);
  // The first poll after the beacon ticks (+250 ms), then +1250 and +2250: three ticks in three seconds,
  // on the node's clock. One beacon arrived; a per-beacon design would have played exactly one.
  assert.equal(nWrites(h, HILL_TICK_F), 3, 'one tick per second, on the node clock — not one per 5 s beacon');
  assert.equal(h.eng.state().hill.owner, 1);
});

test('hill CONTROL: no possession tick while an ENEMY holds the point (and the positive half proves the tick is alive)', () => {
  const h = koth();
  h.frame('$HIR,4,15,0,0,8,0,0,*');            // red holds it -- we are standing in it, it is beaconing at us
  run(h, 3000);
  assert.equal(nWrites(h, HILL_TICK_F), 0, 'the tick is possession, not proximity — an enemy point is silent');
  // The half that makes the above falsifiable: take the point on the same engine and the tick must start.
  // Without it "0 ticks" is also what a phone that plays no hill audio at all reports.
  h.frame('$HIR,4,15,0,1,50,0,0,*');
  run(h, 3000);
  assert.ok(nWrites(h, HILL_TICK_F) >= 1, 'the same engine DOES tick once we own it — so the 0 above is the gate, not a dead engine');
});

test('hill CONTROL: no possession tick while the point is NEUTRAL (team 2)', () => {
  const h = koth();
  h.frame('$HIR,4,15,0,2,8,0,0,*');            // neutral broadcasts team 2
  run(h, 3000);
  assert.equal(nWrites(h, HILL_TICK_F), 0);
  assert.equal(h.eng.state().hill.owner, 2, 'the neutral owner is still tracked, it just does not tick');
});

test('hill: a mag=50 capture for my team announces Hill Captured on the frame that proves it, with no tick and no second word', () => {
  // Bench 2026-09-10, verbatim: the capture word landed 50 ms after the shot; mag=53 came 5 s LATER.
  const h = koth();
  h.frame('$HIR,4,15,0,2,8,0,0,*');            // t=41770: last neutral beacon
  const before = h.writes.length;
  h.adv(50);
  h.frame('$HIR,4,15,0,1,50,0,0,*');           // t=41820: mag 50, new owner = team 1 (us)
  assert.deepEqual(h.writes.slice(before), [HILL_CAPTURED_F], 'the callout must go out inside the frame handler — no engine tick has run yet');
  assert.equal(nWrites(h, HILL_LOST_F), 0);
});

test('hill: the SAME mag=50 frame says Hill Lost to the team that just lost it', () => {
  // Bench 2026-09-10: t=291755 blue holds; t=292265 $HIR,4,15,0,0,50,0,0 -- red takes it. We are blue.
  const h = koth();
  h.frame('$HIR,4,15,0,1,8,0,0,*');
  run(h, 500);                                  // we are holding it, so it is ticking
  const before = h.writes.length;
  h.frame('$HIR,4,15,0,0,50,0,0,*');            // red captures
  assert.deepEqual(h.writes.slice(before), [HILL_LOST_F], 'one wire event, the other team\'s audio');
  assert.equal(nWrites(h, HILL_CAPTURED_F), 0);
  const ticks = nWrites(h, HILL_TICK_F);
  run(h, 3000);
  assert.equal(nWrites(h, HILL_TICK_F), ticks, 'and the tick stops dead: we no longer hold it');
});

test('hill CONTROL: a callout SUPPRESSES the possession tick for its own real length, then the tick resumes', () => {
  const h = koth();
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  run(h, 1000);
  assert.equal(nWrites(h, HILL_TICK_F), 0, 'neutral: nothing ticking yet');
  h.frame('$HIR,4,15,0,1,50,0,0,*');            // we capture it: VB0N is 1.924 s long
  assert.equal(nWrites(h, HILL_CAPTURED_F), 1);
  run(h, 1750);                                 // seven polls inside the clip
  assert.equal(nWrites(h, HILL_TICK_F), 0, 'the 0.11 s tick must not play under a 1.92 s callout');
  run(h, 500);                                  // now past 1.924 s
  assert.equal(nWrites(h, HILL_TICK_F), 1, 'the tick resumes the moment the callout has actually finished');
  run(h, 1000);
  assert.equal(nWrites(h, HILL_TICK_F), 2, 'and then keeps its 1 s cadence');
});

test('hill: two callouts never overlap — the later one preempts the line still playing', () => {
  const h = koth();
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  h.frame('$HIR,4,15,0,1,50,0,0,*');            // we take it (VB0N, 1.924 s)
  h.adv(500); h.eng.tick();
  h.frame('$HIR,4,15,0,0,50,0,0,*');            // red takes it back 0.5 s later, inside the clip
  assert.deepEqual(h.writes.slice(-2), ['$PLAYX,0,*', HILL_LOST_F],
    'the stale line is stopped in the same write — the newest word about the point is the true one');
});

test('hill CONTROL: a callout well clear of the previous one does NOT preempt', () => {
  const h = koth();
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  h.frame('$HIR,4,15,0,1,50,0,0,*');            // VB0N, 1.924 s
  run(h, 2500);
  const before = h.writes.length;
  h.frame('$HIR,4,15,0,0,50,0,0,*');
  assert.deepEqual(h.writes.slice(before), [HILL_LOST_F], 'nothing to cut off, so no $PLAYX');
});

test('hill: presence survives ONE missed beacon and expires on two (>= 12 s)', () => {
  // Rung R: the beacon is clean at desk range and goes intermittent at the edge of range, so a single
  // miss is normal reception, not "left the hill".
  const h = koth();
  h.frame('$HIR,4,15,0,1,8,0,0,*');
  run(h, 10000);                                // one beacon missed at +5 s
  assert.ok(h.eng.state().hill, 'one missed beacon must not expire the point');
  const ticks = nWrites(h, HILL_TICK_F);
  assert.ok(ticks >= 10, `the tick keeps running through a single miss (got ${ticks})`);
  run(h, 2500);                                 // now past 12 s with no beacon
  assert.equal(h.eng.state().hill, null, 'two missed beacons expires presence');
  const after = nWrites(h, HILL_TICK_F);
  run(h, 3000);
  assert.equal(nWrites(h, HILL_TICK_F), after, 'and the tick stops');
  assert.equal(nWrites(h, HILL_LOST_F), 0, 'walking out of range is not losing the point — no callout');
});

test('hill CONTROL (F84): a respawn station beaconing every 2.5 s never refreshes a hill presence window', () => {
  // magnitude 6 is a respawn station, not a point. Its period is SHORTER than the 12 s window, which is
  // exactly the shape that has now bitten three times in one day (ATTRIB_FUSE_S, regen_delay_s).
  const h = koth();
  h.frame('$HIR,4,15,0,1,8,0,0,*');             // we hold a hill
  for (let i = 0; i < 8; i++) { run(h, 2500); h.frame('$HIR,4,15,0,1,6,0,0,*'); }   // 20 s of station beacons
  assert.equal(h.eng.state().hill, null, 'a station word must not keep a dead hill alive');
});

test('hill: the late mag=53 confirmation must never overwrite the new owner', () => {
  // Bench 2026-09-10, verbatim: mag=50 (new owner, team 1) at t=41820, then mag=53 (the state LEFT --
  // neutral, team 2) at t=46780, five seconds later. Reading its team field as the owner would hand the
  // point back to nobody a whole beacon cycle after we took it, and the tick would stop.
  const h = koth();
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  h.adv(50); h.frame('$HIR,4,15,0,1,50,0,0,*');
  run(h, 4960);
  h.frame('$HIR,0,15,0,2,53,0,0,*');            // sensor 0, mag 53
  h.frame('$HIR,4,15,0,1,8,0,0,*');             // same ms, sensor 4: the first hill beacon owned by us
  assert.equal(h.eng.state().hill.owner, 1, 'still ours');
  assert.equal(h.eng.state().hill.from_neutral, true, 'and we know it was taken from neutral');
  const ticks = nWrites(h, HILL_TICK_F);
  run(h, 3000);
  assert.equal(nWrites(h, HILL_TICK_F), ticks + 3, 'the tick runs straight through the late confirmation');
  assert.equal(nWrites(h, HILL_LOST_F), 0, 'and mag=53 announces nothing at all');
});

test('hill: an owner change on a plain mag=8 beacon announces (a missed capture word), but adopting one after presence expired is silent', () => {
  const h = koth();
  h.frame('$HIR,4,15,0,0,8,0,0,*');             // red holds it, we are watching
  run(h, 5000);
  h.frame('$HIR,4,15,0,1,8,0,0,*');             // it is ours now and we never saw the mag=50
  assert.equal(nWrites(h, HILL_CAPTURED_F), 1, 'the frame that proves the change announces it');
  // now walk away long enough for presence to expire, and come back to an enemy-held point
  run(h, 13000);
  assert.equal(h.eng.state().hill, null);
  const before = h.writes.length;
  h.frame('$HIR,4,15,0,0,8,0,0,*');
  assert.deepEqual(h.writes.slice(before), [], 'walking back into range is not a capture — adopt the owner silently');
});

test('hill (F75): "Contested" is never inferred from firing near an enemy-held point', () => {
  // F75, four bench runs: a hit that does NOT capture emits nothing decodable -- only the ordinary mag=8
  // beacon. Inferring it from "I fired + an enemy point is in range" cannot tell a hit from a miss, so
  // shooting PAST the grenade would announce it falsely and suppress the tick for 2.078 s. Deliberately
  // unimplemented; this test is the record of that decision, and fails if anyone wires a naive guess.
  const h = koth();
  h.frame('$HIR,4,15,0,0,8,0,0,*');             // red holds the point, we are standing in it
  h.frame('$ALCD,32,100,0,384,0,*');
  for (let i = 31; i > 26; i--) { h.frame(`$ALCD,${i},100,0,384,0,*`); h.adv(200); h.eng.tick(); }   // five rounds, no capture follows
  run(h, 6000);
  h.frame('$HIR,4,15,0,0,8,0,0,*');             // still red: nothing changed hands
  run(h, 3000);
  assert.equal(nWrites(h, HILL_CONTESTED_F), 0, 'no contested callout may be invented from a shot');
  assert.equal(nWrites(h, HILL_TICK_F), 0);
  // The control that makes those two zeros mean something: one more round DOES take the point, and the
  // same engine announces it. So hill audio was live throughout and "no contested" is a decision.
  h.frame('$HIR,4,15,0,1,50,0,0,*');
  assert.equal(nWrites(h, HILL_CAPTURED_F), 1, 'the same engine announces a capture — the silence above was deliberate, not broken');
  assert.equal(nWrites(h, HILL_CONTESTED_F), 0, 'and still never VB0O');
});

// ---------- K1: the SAME hill audio, sourced from a phone CONTROL POINT's BLE advert ----------
// docs/spec/utility.md §5 row `control`. The station does the counting (src/control.js, its own test file);
// these tests are about the TRANSLATION: an advert in, the shared hill state and the four cues out. The
// harness player is BLUE (tid 1), RED (tid 0) is the enemy, and tid 2 is never a team (F82).
function controlEntry(o = {}) {
  return { role: 'station', id: 11, kind: 'control', team: 255, state: 0, value: 0, seq: 0, game: 0,
    threshold: -74, rssi: -50, raw: -50, present: true, ...o };
}
const HELD = CONTROL_STATE.held, CONTESTED = CONTROL_STATE.contested, RISING = CONTROL_STATE.rising;
/** One advert, pushed the way app.js's presenceTick pushes `presence.stations()`. */
function control(h, o) { h.eng.setStations([controlEntry(o)]); return h; }
/** Advance the clock while the station keeps advertising the same thing (an advert is a ~1 Hz heartbeat). */
function runControl(h, ms, o, step = 250) {
  for (let i = 0; i < Math.round(ms / step); i++) { h.adv(step); h.eng.setStations([controlEntry(o)]); h.eng.tick(); }
}

test('control point: the FIRST advert adopts the owner silently, and a real handover to us DOES announce', () => {
  const h = koth();
  control(h, { team: 0, state: HELD, value: 100 });
  assert.equal(h.eng.state().hill.owner, 0, 'RED holds it');
  assert.equal(h.eng.state().hill.source, 'station');
  assert.equal(nWrites(h, HILL_CAPTURED_F) + nWrites(h, HILL_LOST_F), 0, 'walking into range announces nothing');
  // The positive half: the same engine on the same wire DOES announce a handover, so the zero above is a
  // decision and not a control path that never speaks.
  control(h, { team: 0, state: 0, value: 0 });          // drained to neutral (not our point: still silent)
  assert.equal(nWrites(h, HILL_LOST_F), 0, 'RED losing THEIR point is not our callout');
  control(h, { team: 1, state: HELD, value: 100 });
  assert.equal(nWrites(h, HILL_CAPTURED_F), 1, 'BLUE taking it says Hill Captured, once');
});

// Mutation audit 2026-09-11: `_onControlAdvert` restated `claimable()` by hand as `e.team <= 3`, and
// flipping that literal to `<= 4` left the whole suite green -- so a station advertising tid 4 with `held`
// set would have installed a real owner and nothing would have said so. tids 4-7 are COLOUR tids, not
// teams: `$TID` is masked to 2 bits (protocol/brx-protocol.md, F35/F96), so a gun on 4+ transmits a LOWER
// team, reads friendly to that team and still takes its damage. Crediting a point to one credits a team
// that cannot coherently exist. Adverts are unauthenticated (§3), so this is the value a buggy or hostile
// station supplies for free.
test('control point: a held advert on a COLOUR tid (4-7) owns nothing, and a real tid still does', () => {
  for (const tid of [4, 5, 6, 7]) {
    const h = koth();
    control(h, { team: tid, state: HELD, value: 100 });
    assert.equal(h.eng.state().hill.owner, 2, `a held advert naming tid ${tid} is nobody, not an owner`);
    assert.equal(nWrites(h, HILL_CAPTURED_F) + nWrites(h, HILL_LOST_F), 0, `tid ${tid} announces nothing`);
  }
  // 255 is the station's own "nobody" and must land in the same place
  const none = koth();
  control(none, { team: 255, state: HELD, value: 100 });
  assert.equal(none.eng.state().hill.owner, 2, '255 held is nobody too');
  // 🔴 the control: "not the owner" must not be satisfiable by an engine that accepts nobody. Every tid a
  // hill CAN use still installs an owner off the same wire.
  for (const tid of [0, 1, 3]) {
    const h = koth();
    control(h, { team: tid, state: HELD, value: 100 });
    assert.equal(h.eng.state().hill.owner, tid, `tid ${tid} is a real point owner`);
  }
});

test('control point: a two-phase steal says Hill Lost the moment it goes neutral, not when it flips', () => {
  const h = koth();
  control(h, { team: 1, state: HELD, value: 100 });     // we hold it
  assert.equal(nWrites(h, HILL_LOST_F), 0);
  control(h, { team: 1, state: HELD | CONTROL_STATE.falling, value: 50 });
  assert.equal(h.eng.state().hill.owner, 1, 'halfway drained it is STILL ours');
  assert.equal(nWrites(h, HILL_LOST_F), 0, 'and nothing is announced yet');
  control(h, { team: 0, state: 0, value: 0 });          // zero: nobody holds it, RED is on the bar
  assert.equal(h.eng.state().hill.owner, 2, 'at zero the point is neutral (team 2 in the shared hill model)');
  assert.equal(nWrites(h, HILL_LOST_F), 1, 'THAT is the moment we lost it');
  control(h, { team: 0, state: RISING, value: 60 });
  control(h, { team: 0, state: HELD, value: 100 });     // RED completes the steal
  assert.equal(nWrites(h, HILL_LOST_F), 1, 'and we are not told twice');
  assert.equal(nWrites(h, HILL_CAPTURED_F), 0, 'nor congratulated on someone else taking it');
});

test('control point: the possession tick runs while WE hold it and stops the moment it goes neutral', () => {
  const h = koth();
  runControl(h, 3000, { team: 1, state: HELD, value: 100 });
  const mine = nWrites(h, HILL_TICK_F);
  assert.ok(mine >= 3, `the tick runs on our own point (got ${mine})`);
  runControl(h, 3000, { team: 0, state: 0, value: 0 });     // neutral now
  assert.equal(nWrites(h, HILL_TICK_F), mine, 'a neutral point does not tick');
  runControl(h, 3000, { team: 0, state: HELD, value: 100 });
  assert.equal(nWrites(h, HILL_TICK_F), mine, 'nor an enemy-held one');
  runControl(h, 3000, { team: 1, state: HELD, value: 100 });
  assert.ok(nWrites(h, HILL_TICK_F) > mine, 'and it comes back when we take it — the zeros above are real');
});

test('control point: a bar being BUILT for us at 40% is not ownership — the held bit is', () => {
  const h = koth();
  runControl(h, 3000, { team: 1, state: RISING, value: 40 });
  assert.equal(h.eng.state().hill.owner, 2, 'nobody owns a point at 40%');
  assert.equal(h.eng.state().hill.holding, 1, 'though the state DOES say whose 40% it is');
  assert.equal(h.eng.state().hill.progress, 40);
  assert.equal(nWrites(h, HILL_TICK_F), 0, 'so there is no possession tick');
  assert.equal(nWrites(h, HILL_CAPTURED_F), 0, 'and no capture callout');
  runControl(h, 6000, { team: 1, state: HELD, value: 100 });
  assert.equal(nWrites(h, HILL_CAPTURED_F), 1, 'reaching 100 is the capture');
  assert.ok(nWrites(h, HILL_TICK_F) >= 3, 'and the tick starts then (after the 1.924 s callout it waits on)');
});

test('control point: Hill Contested IS announced — it is measured here, not inferred (F75 applies to IR only)', () => {
  const h = koth();
  control(h, { team: 1, state: HELD, value: 100 });
  assert.equal(nWrites(h, HILL_CONTESTED_F), 0);
  control(h, { team: 1, state: HELD | CONTESTED, value: 96 });
  assert.equal(nWrites(h, HILL_CONTESTED_F), 1, 'two teams on OUR point is a fact the station measured');
  assert.equal(h.eng.state().hill.contested, true, 'and it is in state for the HUD');
  control(h, { team: 1, state: HELD | CONTESTED, value: 94 });
  assert.equal(nWrites(h, HILL_CONTESTED_F), 1, 'the edge, not every advert');
});

test('control point: contested reaches a defender whose point it is, and a player standing on it, and nobody else', () => {
  // A neutral point we are NOT standing on: contested there is somebody else's fight.
  const away = koth();
  control(away, { team: 0, state: 0, value: 20, present: false });
  control(away, { team: 0, state: CONTESTED, value: 20, present: false });
  assert.equal(nWrites(away, HILL_CONTESTED_F), 0, 'a contest across the map is not our callout');
  // The two positive halves on the same code path: standing on it, or owning it.
  const on = koth();
  control(on, { team: 0, state: 0, value: 20, present: true });
  control(on, { team: 0, state: CONTESTED, value: 20, present: true });
  assert.equal(nWrites(on, HILL_CONTESTED_F), 1, 'standing on it, we hear it');
  const ours = koth();
  control(ours, { team: 1, state: HELD, value: 100, present: false });
  control(ours, { team: 1, state: HELD | CONTESTED, value: 98, present: false });
  assert.equal(nWrites(ours, HILL_CONTESTED_F), 1, 'and a defender hears their own point go contested from off it');
});

test('control point: a flapping contested bit cannot repeat the 2 s callout, but a later contest does', () => {
  const h = koth();
  control(h, { team: 1, state: HELD, value: 100 });
  control(h, { team: 1, state: HELD | CONTESTED, value: 98 });
  assert.equal(nWrites(h, HILL_CONTESTED_F), 1);
  const t0 = h.eng.now();                       // when the one allowed callout played
  for (let i = 0; i < 4; i++) {                 // in and out at the edge of the bubble, twice a second
    runControl(h, 500, { team: 1, state: HELD, value: 98 });
    runControl(h, 500, { team: 1, state: HELD | CONTESTED, value: 98 });
  }
  assert.equal(nWrites(h, HILL_CONTESTED_F), 1, 'four more crossings inside the floor announce nothing');
  // §5d.5 puts the floor at 10 s, so a crossing at 9 s must still be silent and one at 11 s must not be —
  // otherwise "a floor" and "a mute" are indistinguishable, and so are 8 s and 10 s.
  const uncontestedUntil = ms => { while (h.eng.now() - t0 < ms) { h.adv(250); h.eng.setStations([controlEntry({ team: 1, state: HELD, value: 98 })]); h.eng.tick(); } };
  uncontestedUntil(9000);
  control(h, { team: 1, state: HELD | CONTESTED, value: 98 });
  assert.equal(nWrites(h, HILL_CONTESTED_F), 1, `a crossing ${h.eng.now() - t0} ms after the last one is still inside the 10 s floor`);
  uncontestedUntil(11000);
  control(h, { team: 1, state: HELD | CONTESTED, value: 98 });
  assert.equal(nWrites(h, HILL_CONTESTED_F), 2, `past the floor (${h.eng.now() - t0} ms) a genuinely later contest is announced`);
});

test('control point: a capture in the same advert wins outright over contested', () => {
  // `_hillSay` preempts rather than queues, so announcing both would cut "Hill Captured" off after a few
  // hundred ms and leave the player with the less important of the two facts.
  const h = koth();
  control(h, { team: 0, state: 0, value: 0 });                    // neutral, we are watching
  control(h, { team: 1, state: HELD | CONTESTED, value: 100 });   // we took it, and it is already contested
  assert.equal(nWrites(h, HILL_CAPTURED_F), 1, 'the capture is announced');
  assert.equal(nWrites(h, HILL_CONTESTED_F), 0, 'and does not get cut off by the contest');
  // The positive half: contested on its own, one advert later, IS announced — so the zero is the priority
  // rule and not a dead contested path.
  control(h, { team: 1, state: HELD, value: 99 });
  control(h, { team: 1, state: HELD | CONTESTED, value: 97 });
  assert.equal(nWrites(h, HILL_CONTESTED_F), 1);
});

test('control point: F82 — a tid-2 player is told why, once, and hears nothing (with a decidable control)', () => {
  const h = harness({ mode: 'koth' }).kit();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, roster: h.roster,
    team: { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 } } });
  const logs = []; h.eng.log = m => logs.push(String(m));
  h.config_().echo().start(0); h.adv(10); h.eng.tick();
  control(h, { team: 0, state: HELD, value: 100 });
  assert.ok(logs.some(m => m.includes('F82')), 'a tid-2 roster is TOLD, on the first advert');
  const n = logs.filter(m => m.includes('F82')).length;
  runControl(h, 3000, { team: 0, state: HELD, value: 100 });
  control(h, { team: 2, state: 0, value: 0 });
  control(h, { team: 1, state: HELD, value: 100 });
  runControl(h, 3000, { team: 1, state: HELD | CONTESTED, value: 90 });
  assert.equal(logs.filter(m => m.includes('F82')).length, n, 'once per game, not once per advert');
  assert.equal(nWrites(h, HILL_CAPTURED_F) + nWrites(h, HILL_LOST_F) + nWrites(h, HILL_CONTESTED_F) + nWrites(h, HILL_TICK_F), 0,
    'and a player who cannot tell "nobody holds it" from "we hold it" is told nothing at all');
  // The decidable control: the SAME advert sequence on a tid-1 roster is fully audible, so the silence
  // above is F82 and not a control path that never speaks.
  const ok = koth();
  const okLogs = []; ok.eng.log = m => okLogs.push(String(m));
  control(ok, { team: 0, state: HELD, value: 100 });
  control(ok, { team: 2, state: 0, value: 0 });
  control(ok, { team: 1, state: HELD, value: 100 });
  runControl(ok, 6000, { team: 1, state: HELD | CONTESTED, value: 90 });
  assert.ok(!okLogs.some(m => m.includes('F82')), 'a tid-1 roster has nothing to warn about');
  assert.equal(nWrites(ok, HILL_CAPTURED_F), 1, 'it hears the capture');
  assert.equal(nWrites(ok, HILL_CONTESTED_F), 1, 'and the contest');
  assert.ok(nWrites(ok, HILL_TICK_F) >= 3, 'and the possession tick');
});

test('control point: a held advert claiming team 2 is read as NEUTRAL, never as an owner', () => {
  // The station refuses to produce this (control.js), but an advert is unauthenticated: a foreign or
  // hand-rolled one must not be able to install an owner nobody can decide.
  const h = koth();
  control(h, { team: 2, state: HELD, value: 100 });
  assert.equal(h.eng.state().hill.owner, 2, 'team 2 + held still reads as nobody');
  runControl(h, 3000, { team: 2, state: HELD, value: 100 });
  assert.equal(nWrites(h, HILL_TICK_F), 0, 'so it never ticks for anyone');
  runControl(h, 6000, { team: 1, state: HELD, value: 100 });
  assert.ok(nWrites(h, HILL_TICK_F) >= 3, 'and a real owner still does (after its capture callout)');
});

test('control point: freshness is measured on the ADVERT`s clock, not the node`s — and it is the 4 s rule', () => {
  // Two bugs in one guard, and the SHAPE of this test is the point of it.
  //
  // 1. A node's `now()` is `Date.now()` PLUS the MC clock offset (`app.js:88`, `transport.syncedNow()`),
  //    while `Presence` stamps its adverts with the RAW `Date.now()` (`app.js:121`). Subtracting one from
  //    the other made EVERY control advert look stale once MC's clock led the phone by 4 s — no hill state,
  //    no callouts, no log line — or never stale at all if it lagged. F84's shape, with the clock as the
  //    wide constant.
  // 2. §5d.5: a control point's freshness is the presence rule (4 s), not the grenade's 12 s.
  //
  // The previous version of this test stamped `seenAt` with the ENGINE's own clock, so it asserted the
  // code's convention rather than the app's wiring and passed straight through bug 1
  // (`guards-read-artefacts`). This one drives the real `Presence` and deliberately runs the engine on a
  // clock nowhere near `Date.now()`, which is what the harness already does.
  const h = koth();
  const pres = new Presence({ defaultThreshold: -74, dwellMs: 800 });
  const uuid = encodeUuid({ role: 'station', id: 11, kind: 'control', team: 1, state: CONTROL_STATE.held, value: 100, seq: 1 });
  let wall = Date.now();                 // the advert clock: ~25 years ahead of the engine's 1,000,000
  const step = (advertising) => { wall += 250; h.adv(250); if (advertising) pres.observe([uuid], -50, wall); pres.tick(wall); h.eng.setStations(pres.stations()); h.eng.tick(); };

  for (let i = 0; i < 8; i++) step(true);
  assert.ok(h.eng.state().hill, 'the point is read despite the two clocks being decades apart');
  assert.equal(h.eng.state().hill.owner, 1, 'and its owner is right');
  assert.ok(nWrites(h, HILL_TICK_F) >= 1, 'and the possession tick is running');

  for (let i = 0; i < 12; i++) step(false);          // the station goes off air
  assert.ok(h.eng.state().hill, 'three seconds off air is inside the window');
  for (let i = 0; i < 24; i++) step(false);
  assert.equal(h.eng.state().hill, null, 'and it is gone well before the grenade path`s 12 s');
  const ticks = nWrites(h, HILL_TICK_F);
  for (let i = 0; i < 8; i++) step(false);
  assert.equal(nWrites(h, HILL_TICK_F), ticks, 'a dead station stops asserting possession');
  // The control that keeps the 12 s rule honest for the source it belongs to: a GRENADE point survives a
  // single missed 5 s beacon, which the 4 s window would have killed.
  const ir = koth();
  ir.frame('$HIR,4,15,0,1,8,0,0,*');
  run(ir, 8000);
  assert.ok(ir.eng.state().hill, 'a grenade point still survives one missed beacon on the 12 s rule');
});

test('control point: walking toward a DIFFERENT point never announces a change of hands (item A)', () => {
  // `site` was recorded and never compared, so `this.hill` could hold point 11's owner while the reader had
  // moved on to point 12 — and the owner difference between two unrelated objectives read as a capture. A
  // player walking from their own point toward an enemy's was told "Hill Lost!" for a point nobody took.
  const h = koth();
  control(h, { id: 11, team: 1, state: HELD, value: 100 });     // we hold point 11
  assert.equal(h.eng.state().hill.site, 11);
  h.eng.setStations([controlEntry({ id: 12, team: 0, state: HELD, value: 100, present: true, rssi: -40 })]);
  assert.equal(h.eng.state().hill.site, 12, 'we are now reading point 12');
  assert.equal(h.eng.state().hill.owner, 0, 'and its owner');
  assert.equal(nWrites(h, HILL_LOST_F), 0, 'but NOTHING was lost — point 11 is still ours, we just walked away');
  assert.equal(nWrites(h, HILL_CAPTURED_F), 0);
  // The positive half: a real change of hands ON point 12 still announces, so the silence above is the
  // site check and not a reader that stopped speaking.
  control(h, { id: 12, team: 255, state: 0, value: 0 });
  control(h, { id: 12, team: 1, state: HELD, value: 100 });
  assert.equal(nWrites(h, HILL_CAPTURED_F), 1, 'taking point 12 IS announced');
});

test('control point: the reader LATCHES its point, so RSSI order cannot flip it back and forth (item 2)', () => {
  // `stations` arrives strongest-first, so two points in range swapped places on every scan callback and each
  // swap looked like a change of hands. Stay on the latched point unless it is gone or we stand on another.
  const h = koth();
  const a = controlEntry({ id: 11, team: 1, state: HELD, value: 100, present: false, rssi: -50 });
  const b = controlEntry({ id: 12, team: 0, state: HELD, value: 100, present: false, rssi: -49 });
  h.eng.setStations([a, b]);
  const first = h.eng.state().hill.site;
  for (let i = 0; i < 6; i++) h.eng.setStations(i % 2 ? [b, a] : [a, b]);   // RSSI jitter reorders them
  assert.equal(h.eng.state().hill.site, first, 'the latched point does not move with the signal order');
  assert.equal(nWrites(h, HILL_LOST_F) + nWrites(h, HILL_CAPTURED_F), 0, 'and nothing is announced');
  // The positive half: STANDING on the other one does move the reader, because that is a real choice.
  h.eng.setStations([{ ...a, present: false }, { ...b, present: true }]);
  assert.equal(h.eng.state().hill.site, 12, 'standing on point 12 switches to it');
});

test('control point: the transition lines have a repeat floor, so a shared station id cannot machine-gun them', () => {
  // Two phones left on the DEFAULT id 1 are ONE presence entry, so their fields alternate per scan callback
  // and the decoded owner flips several times a second. The id latch cannot help — the id IS the identity.
  const h = koth();
  control(h, { id: 1, team: 255, state: 0, value: 0 });
  for (let i = 0; i < 10; i++) {                    // two phones disagreeing, 250 ms apart
    h.adv(250); h.eng.tick();
    control(h, { id: 1, team: 1, state: HELD, value: 100 });
    h.adv(250); h.eng.tick();
    control(h, { id: 1, team: 0, state: HELD, value: 100 });
  }
  const said = nWrites(h, HILL_CAPTURED_F) + nWrites(h, HILL_LOST_F);
  assert.ok(said > 0, 'it does still speak');
  assert.ok(said <= 3, `five seconds of flapping produced at most one line per 3 s, got ${said}`);
  // The positive half: two genuine handovers a clear 4 s apart are BOTH announced.
  const slow = koth();
  control(slow, { team: 255, state: 0, value: 0 });
  control(slow, { team: 1, state: HELD, value: 100 });
  runControl(slow, 4000, { team: 1, state: HELD, value: 100 });
  control(slow, { team: 255, state: 0, value: 0 });
  assert.equal(nWrites(slow, HILL_CAPTURED_F), 1);
  assert.equal(nWrites(slow, HILL_LOST_F), 1, 'a real second transition is not swallowed by the floor');
});

test('control point: a handover that happens while you are DOWN is told to you on revive, not swallowed (item C)', () => {
  // Death is deliberately silent, but a "Hill Lost!" landing then was never replayed — so a player respawned
  // and "we lost it", "out of range" and "nothing is happening" were all the same silence.
  const h = koth();
  control(h, { team: 1, state: HELD, value: 100 });          // we hold it
  runControl(h, 1000, { team: 1, state: HELD, value: 100 });
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');   // killed
  assert.equal(h.eng.alive, false, 'precondition: down');
  runControl(h, 1000, { team: 255, state: 0, value: 0 });      // it goes neutral while we are down
  assert.equal(nWrites(h, HILL_LOST_F), 0, 'the DOWN window stays silent — A16 makes it hands-off');
  h.adv(8000); h.eng.tick();                                  // revived by the auto respawn (delay_s 8), the real path
  assert.equal(h.eng.alive, true);
  control(h, { team: 255, state: 0, value: 0 });
  assert.equal(nWrites(h, HILL_LOST_F), 1, 'and the first advert after revive says what happened');
  control(h, { team: 255, state: 0, value: 0 });
  assert.equal(nWrites(h, HILL_LOST_F), 1, 'exactly once');
});

test('control point: nothing is owed on revive when the point did not change hands (item C, the other half)', () => {
  const h = koth();
  control(h, { team: 1, state: HELD, value: 100 });
  runControl(h, 1000, { team: 1, state: HELD, value: 100 });
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  runControl(h, 1000, { team: 1, state: HELD, value: 100 });   // still ours the whole time we were down
  h.frame('$HP,45,0,0,*'); h.eng.tick();
  const before = h.writes.length;
  control(h, { team: 1, state: HELD, value: 100 });
  assert.equal(nWrites(h, HILL_CAPTURED_F), 0, 'we are not congratulated on a point we never lost');
  assert.equal(nWrites(h, HILL_LOST_F), 0);
  assert.deepEqual(h.writes.slice(before).filter(f => f === HILL_CAPTURED_F || f === HILL_LOST_F), []);
});

test('control point: the possession tick DOUBLES while our own point is draining (item D)', () => {
  const h = koth();
  runControl(h, 4000, { team: 1, state: HELD, value: 100 });
  const steady = nWrites(h, HILL_TICK_F);
  assert.ok(steady >= 3 && steady <= 5, `~1 per second while it is safe, got ${steady} in 4 s`);
  runControl(h, 4000, { team: 1, state: HELD | CONTROL_STATE.falling, value: 60 });
  const losing = nWrites(h, HILL_TICK_F) - steady;
  assert.ok(losing >= 2 * steady - 2, `about twice as many while it drains: ${losing} vs ${steady}`);
  // The positive half for the other direction: it goes back to the slow cadence when the drain stops, so
  // "doubled" is a response to `falling` and not just a faster tick everywhere.
  runControl(h, 4000, { team: 1, state: HELD, value: 60 });
  const after = nWrites(h, HILL_TICK_F) - steady - losing;
  assert.ok(after <= steady + 1, `and back to ~1 per second, got ${after}`);
});

test('possession: time is counted from ELAPSED time, per point and per team, and reported to MC', () => {
  const h = koth();
  runControl(h, 6000, { id: 7, team: 1, state: HELD, value: 100 });
  const p = h.eng.state().possession;
  assert.ok(Math.abs(p.by_site['7'][1] - 6000) <= 600, `BLUE owned point 7 for ~6 s, got ${p.by_site['7'][1]}`);
  assert.ok(Math.abs(p.observed_ms['7'] - 6000) <= 600, 'and we could hear it for the same 6 s');
  assert.equal(p.source, 'station');
  // an enemy's ownership is counted too — the fact is "team X owned point P as observed by me"
  runControl(h, 4000, { id: 7, team: 0, state: HELD, value: 100 });
  const q = h.eng.state().possession;
  assert.ok(Math.abs(q.by_site['7'][0] - 4000) <= 600, `RED's 4 s is counted as well, got ${q.by_site['7'][0]}`);
  assert.ok(Math.abs(q.by_site['7'][1] - 6000) <= 600, 'and BLUE keeps its 6 s');
  assert.ok(Math.abs(q.observed_ms['7'] - 10000) <= 900, 'observed is the whole time we could hear it');
  // a SECOND point is kept apart, so Territories can use the same numbers
  runControl(h, 3000, { id: 8, team: 1, state: HELD, value: 100, present: true });
  const r = h.eng.state().possession;
  assert.ok(Math.abs(r.by_site['8'][1] - 3000) <= 600, `point 8 has its own tally, got ${JSON.stringify(r.by_site)}`);
  assert.ok(Math.abs(r.by_site['7'][1] - 6000) <= 600, 'and point 7 is untouched');
  // and it goes to MC in the shape mc/API.md defines
  const facts = h.facts.filter(f => f.type === 'possession');
  assert.ok(facts.length >= 1, 'a possession fact was sent');
  const f = facts[facts.length - 1];
  assert.equal(f.match_id, 'm1');
  assert.equal(f.source, 'station');
  assert.ok(typeof f.site === 'string', 'site is a string label: ' + JSON.stringify(f.site));
  assert.ok(Object.keys(f.hold_ms).every(k => typeof k === 'string'), 'hold_ms is keyed by tid AS A STRING');
  assert.ok(Number.isFinite(f.observed_ms), 'observed_ms is the honest lower bound');
});

test('possession: a stalled tick under-counts nothing, because it is elapsed time and not a tick count', () => {
  // The whole reason the accumulator does not count ticks: a throttled or backgrounded phone would silently
  // report less possession than was played, and possession is what the match is decided on.
  const fast = koth(); runControl(fast, 5000, { team: 1, state: HELD, value: 100 }, 250);
  const slow = koth(); runControl(slow, 5000, { team: 1, state: HELD, value: 100 }, 1000);   // a quarter of the ticks
  const a = fast.eng.state().possession.observed_ms[''] ?? fast.eng.state().possession.observed_ms['11'];
  const b = slow.eng.state().possession.observed_ms[''] ?? slow.eng.state().possession.observed_ms['11'];
  // The real invariant, and it is stronger than "they are close": possession is ELAPSED TIME, so a quarter
  // of the ticks does not mean a quarter of the possession. What it may cost is at most ONE observation
  // interval, because we credit only from the moment we first SEE the point held -- crediting time before
  // first sight would be inventing possession nobody observed. So the slow reader lags by its own step.
  assert.ok(Math.abs(a - b) <= 1000, `four times the ticks must not mean four times the possession: ${a} vs ${b}`);
  assert.ok(a >= 4000 && b >= 4000, `and both counted the real five seconds: ${a} / ${b}`);
});

test('possession: a clock STEP cannot add possession nobody played', () => {
  // `now()` is Date.now() plus an MC offset that moves as the sync converges. An unclamped delta across one
  // step would bank minutes.
  const h = koth();
  runControl(h, 1000, { team: 1, state: HELD, value: 100 });
  const before = h.eng.state().possession.observed_ms['11'];
  h.adv(600000); h.eng.setStations([controlEntry({ team: 1, state: HELD, value: 100 })]); h.eng.tick();   // the clock jumps ten minutes
  const after = h.eng.state().possession.observed_ms['11'];
  assert.ok(after - before <= 1000, `one step is capped at a tick's worth, gained ${after - before} ms`);
  // Positive half: ten real seconds of ticking DOES bank ten seconds.
  const real = koth();
  runControl(real, 10000, { team: 1, state: HELD, value: 100 });
  assert.ok(real.eng.state().possession.observed_ms['11'] >= 9000, 'real time is counted in full');
});

test('possession: the tally at the WHISTLE is sent, and a new match does not inherit it', () => {
  const h = koth();
  runControl(h, 5000, { team: 1, state: HELD, value: 100 });
  const before = h.facts.filter(f => f.type === 'possession').length;
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });   // END MATCH EARLY on MC, the real envelope
  const sent = h.facts.filter(f => f.type === 'possession');
  assert.ok(sent.length > before, 'the report that decides the match is sent at the end, not on the 10 s cadence');
  assert.ok(Math.abs(sent[sent.length - 1].hold_ms['1'] - 5000) <= 600, 'and it carries the real total');
  // A second match starts from nothing: game 2 must not inherit game 1's owner or its seconds.
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.eng.now(), config_id: golden.config_id, seq: 2, countdown_s: 0 } });
  assert.deepEqual(h.eng.state().possession.by_site, {}, 'the tally is clear');
  assert.equal(h.eng.state().hill, null, 'and so is the point');
});

test('control point: MC naming a GRENADE source refuses the phone point, and vice versa (item B)', () => {
  // One `this.hill`, two wires. A grenade left live on the field (F69) during a phone-point game would
  // alternate ownership with the point every 5 s and announce continuously.
  const g = harness({ mode: 'koth' }).kit();
  g.config.station_source = 'grenade';
  g.config_().echo().start(0); g.adv(10); g.eng.tick();
  runControl(g, 3000, { team: 1, state: HELD, value: 100 });
  assert.equal(g.eng.state().hill, null, 'a phone point is ignored when the objective is a grenade');
  g.frame('$HIR,4,15,0,1,8,0,0,*');
  assert.ok(g.eng.state().hill, 'and the grenade beacon still drives it');
  assert.equal(g.eng.state().hill.source, undefined);
  // The mirror: MC naming the PHONE source (F103's third value), the phone point drives it and a stray
  // grenade beacon is ignored.
  const s2 = harness({ mode: 'koth' }).kit();
  s2.config.station_source = 'phone';
  s2.config_().echo().start(0); s2.adv(10); s2.eng.tick();
  control(s2, { team: 1, state: HELD, value: 100 });
  assert.equal(s2.eng.state().hill.source, 'station');
  s2.frame('$HIR,4,15,0,0,8,0,0,*');
  assert.equal(s2.eng.state().hill.owner, 1, 'a stray grenade cannot take the phone point off us');
  assert.equal(s2.eng.state().hill.source, 'station');
  assert.equal(nWrites(s2, HILL_LOST_F), 0, 'and it announces nothing');
});

test('control point: an advert claiming BOTH rising and falling is read as direction UNKNOWN (§5d.3)', () => {
  // Flags are independent bits, so unlike a 2-bit phase field they CAN both be set, and adverts are
  // unauthenticated (§3): a buggy or hostile station can say it. A reader that trusts whichever bit it tests
  // first shows a defender the point moving the WRONG way, which is worse than showing no direction.
  const h = koth();
  control(h, { team: 1, state: HELD | RISING | CONTROL_STATE.falling, value: 50 });
  const bad = h.eng.state().hill;
  assert.equal(bad.rising, false, 'neither direction is claimed');
  assert.equal(bad.falling, false);
  assert.equal(bad.owner, 1, 'the rest of the advert is still read — only the direction is discarded');
  assert.equal(bad.progress, 50);
  // the two positive halves on the same code path, so "false, false" is the contradiction and not the default
  control(h, { team: 1, state: HELD | RISING, value: 60 });
  assert.equal(h.eng.state().hill.rising, true, 'rising alone IS read');
  control(h, { team: 1, state: HELD | CONTROL_STATE.falling, value: 40 });
  assert.equal(h.eng.state().hill.falling, true, 'and so is falling alone');
});

test('control point: the game`s station allow-list applies to control points too', () => {
  const h = koth();
  h.eng.config.stations = [{ id: 11, kind: 'control' }];
  control(h, { id: 99, team: 1, state: HELD, value: 100 });
  assert.equal(h.eng.state().hill, null, 'a phone from another game cannot hand anyone a point');
  control(h, { id: 11, team: 1, state: HELD, value: 100 });
  assert.ok(h.eng.state().hill, 'the id MC handed out is read');
  assert.equal(h.eng.state().hill.site, 11, 'and the point names itself');
});

test('control point: state() carries the whole reading a HUD needs, from one advert', () => {
  const h = koth();
  control(h, { id: 7, team: 0, state: CONTESTED | RISING, value: 63, present: true });
  const hl = h.eng.state().hill;
  assert.equal(hl.source, 'station'); assert.equal(hl.site, 7);
  assert.equal(hl.owner, 2, 'nobody owns it yet');
  assert.equal(hl.holding, 0, 'RED is the team building it up');
  assert.equal(hl.progress, 63);
  assert.equal(hl.contested, true); assert.equal(hl.rising, true); assert.equal(hl.falling, false);
  assert.equal(hl.onPoint, true, 'and whether this player is standing on it');
});

test('control point: a respawn station in the same list is not mistaken for a point, and vice versa', () => {
  const h = koth();
  h.eng.setStations([{ role: 'station', id: 3, kind: 'respawn', team: 1, state: 1, value: 0, seq: 0, game: 0, threshold: -74, rssi: -40, raw: -40, present: true }]);
  assert.equal(h.eng.state().hill, null, 'a respawn station is not a control point (the F84 trap, on the BLE wire)');
  assert.equal(h.eng.state().station.id, 3, 'it is still the respawn station');
  h.eng.setStations([{ role: 'station', id: 3, kind: 'respawn', team: 1, state: 1, value: 0, seq: 0, game: 0, threshold: -74, rssi: -40, raw: -40, present: true },
    controlEntry({ id: 11, team: 1, state: HELD, value: 100 })]);
  assert.equal(h.eng.state().station.id, 3, 'both kinds coexist: the respawn station is unchanged');
  assert.equal(h.eng.state().hill.site, 11, 'and the control point is read');
});

test('control point: silent in Domination, like the grenade path, because one point is modelled', () => {
  const h = harness({ mode: 'domination' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  control(h, { team: 0, state: 0, value: 0 });
  runControl(h, 3000, { team: 1, state: HELD | CONTESTED, value: 100 });
  assert.equal(nWrites(h, HILL_CAPTURED_F), 0);
  assert.equal(nWrites(h, HILL_CONTESTED_F), 0);
  assert.equal(nWrites(h, HILL_TICK_F), 0);
  assert.ok(h.eng.state().hill, 'state is still tracked — only the audio is withheld');
  assert.equal(h.eng.state().hill.owner, 1, 'and it is correct');
});

test('hill: silent in Domination — several points are indistinguishable on the wire', () => {
  const h = harness({ mode: 'domination' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,15,0,1,8,0,0,*');
  run(h, 3000);
  h.frame('$HIR,4,15,0,0,50,0,0,*');
  assert.equal(nWrites(h, HILL_TICK_F), 0);
  assert.equal(nWrites(h, HILL_LOST_F), 0);
  assert.ok(h.eng.state().hill, 'state is still tracked — only the audio is withheld');
});

test('hill: a bundle cue of "" (announcer off) mutes the callout and the tick, and the fallback must not override it', () => {
  const h = harness({ mode: 'koth' }).kit();
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, roster: h.roster,
    frames: { ...h.bundle, cues: { ...h.bundle.cues, hill_captured: '', hill_tick: '' } } } });
  h.echo(); h.start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  h.frame('$HIR,4,15,0,1,50,0,0,*');
  run(h, 3000);
  assert.equal(nWrites(h, HILL_CAPTURED_F), 0, '"" is MC\'s deliberate mute, not a missing key');
  assert.equal(nWrites(h, HILL_TICK_F), 0);
  // The mute is PER KEY, which is also what makes the two zeros above falsifiable: `hill_lost` was left
  // alone in this bundle, so losing the point must still announce on the very same engine.
  h.frame('$HIR,4,15,0,0,50,0,0,*');
  assert.equal(nWrites(h, HILL_LOST_F), 1, 'an unmuted key on the same engine still plays');
});

test('hill: nothing plays before go-live or while down', () => {
  const h = harness({ mode: 'koth' }).kit().config_().echo().start(20000);   // armed, not live
  h.frame('$HIR,4,15,0,1,8,0,0,*');
  run(h, 3000);
  assert.equal(nWrites(h, HILL_TICK_F), 0, 'armed is not live');
  h.adv(17000); h.eng.tick();                   // T-0 -> live
  h.frame('$HIR,4,15,0,1,8,0,0,*');
  run(h, 2000);
  assert.ok(nWrites(h, HILL_TICK_F) >= 2, 'live and holding: ticking');
  const live = nWrites(h, HILL_TICK_F);
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');   // killed
  assert.equal(h.eng.alive, false);
  h.frame('$HIR,4,15,0,1,8,0,0,*');
  run(h, 3000);
  assert.equal(nWrites(h, HILL_TICK_F), live, 'DOWN is hands-off: the death scream owns the announcer');
});

test('hill (F85): one transmission heard on two sensors does not double the tick or announce twice', () => {
  const h = koth();
  h.frame('$HIR,4,15,0,2,8,0,0,*');
  h.adv(50); h.frame('$HIR,4,15,0,1,50,0,0,*');   // capture, gun body
  h.adv(14); h.frame('$HIR,0,15,0,1,50,0,0,*');   // the SAME transmission on the headset sensor
  assert.equal(nWrites(h, HILL_CAPTURED_F), 1, 'one physical capture, one callout');
  run(h, 3000);
  assert.equal(nWrites(h, HILL_TICK_F), 2, 'and the tick keeps a 1 s cadence, not a doubled one');
});

test('hill (F82): a roster sitting on tid 2 never announces, because neutral IS team 2', () => {
  const h = harness({ mode: 'koth' }).kit();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, roster: h.roster,
    team: { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 } } });
  h.config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,15,0,2,8,0,0,*');             // is this OUR point or nobody's? undecidable
  run(h, 3000);
  h.frame('$HIR,4,15,0,0,50,0,0,*');
  assert.equal(nWrites(h, HILL_TICK_F), 0);
  assert.equal(nWrites(h, HILL_LOST_F), 0, 'silence beats a guess when ownership cannot be decided');
  // The control: the IDENTICAL wire sequence on a tid-1 roster is loud. Otherwise "silent" is just what
  // this suite would report for an engine with no hill audio in it at all.
  const ok = harness({ mode: 'koth' }).kit().config_().echo().start(0); ok.adv(10); ok.eng.tick();
  ok.frame('$HIR,4,15,0,1,8,0,0,*');            // tid 1 = us, unambiguously
  run(ok, 3000);
  ok.frame('$HIR,4,15,0,0,50,0,0,*');
  assert.ok(nWrites(ok, HILL_TICK_F) >= 1 && nWrites(ok, HILL_LOST_F) === 1, 'the same frames on a decidable roster tick and announce');
});

test('Q12: shield-absorbed damage still emits hit_taken (drain order shield->armor->HP)', () => {
  // Bench 2026-08-27: $HP is <hp>,<armor>,<shield> and damage drains the shield first.
  // Before the fix the engine summed only hp+armor, so a shield-absorbed hit computed
  // dmg === 0 and the `dmg > 0` guard dropped the fact entirely -- silent damage.
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HP,45,70,150,*');                       // shield granted (fn-11) up to its cap
  h.frame('$HIR,4,0,19,2,30,0,3,*'); h.frame('$HP,45,70,120,*');
  const hit = h.facts.find(f => f.type === 'hit_taken');
  assert.ok(hit, 'a hit absorbed entirely by the shield must still emit hit_taken');
  assert.equal(hit.dmg, 30);
  assert.equal(h.eng.shield, 120);
  assert.equal(h.eng.hp, 45); assert.equal(h.eng.armor, 70);
});

test('Q12: spawn and respawn zero the shield (it is a capacity, never a starting pool)', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HP,45,70,150,*');
  assert.equal(h.eng.shield, 150);
  // Kill with the SHIELD STILL UP. If the killing $HP carried shield 0, _onHp would zero it and the
  // assertion below would hold even with the respawn fix reverted -- i.e. the test could not fail.
  h.frame('$HIR,4,0,19,2,99,0,3,*'); h.frame('$HP,0,0,120,*');
  assert.equal(h.eng.alive, false);
  assert.equal(h.eng.shield, 120, 'shield must survive the killing blow, or this test proves nothing');
  h.adv(8000); h.eng.tick();                                   // auto-respawn fires
  assert.equal(h.eng.alive, true, 'respawn must actually have happened for this to test anything');
  assert.equal(h.eng.shield, 0, 'respawn must zero the shield; a stale one inflates the next damage calc');
});

test('Q12: a shield does not survive a MATCH BOUNDARY into the next spawn', () => {
  // _endLocal and control{panic} reset spawned/alive but deliberately do NOT touch the pools,
  // so _spawn's `this.shield = 0` is the only thing clearing a shield carried out of match 1.
  // Without it, match 2's first hit computes `before` inflated by the stale shield -- Q12's
  // failure mode across a match boundary. (Found by review: this path had zero coverage.)
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HP,45,70,150,*');
  assert.equal(h.eng.shield, 150);
  h.eng.control({ cmd: 'panic' });                 // ends the match, leaves pools alone
  assert.equal(h.eng.shield, 150, 'precondition: the shield really does survive the match end');
  h.kit().config_().echo().start(0); h.adv(10); h.eng.tick();   // match 2
  assert.equal(h.eng.shield, 0, 'SPAWN must zero the carried-over shield');
});

test('death with a stale latch → shooter_num 0 (DEATH_LATCH_MS)', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.adv(3000);  // latch older than 2 s
  h.frame('$HP,0,0,0,*');
  const death = h.facts.find(f => f.type === 'death');
  assert.equal(death.shooter_num, 0);
});

test('F81: a wire-0 killer (a hill\'s damage word, or a gun with no $PSET) is UNKNOWN, never the hill\'s owning team', () => {
  // Bench 2026-09-10: a hill's ambient damage word is `$HIR,0,0,0,<ownerTeam>,8,0,0`. The DOWN screen rendered
  // "KILLED BY <owner team>" -- a specific lie, since nobody shot the player. MC already refuses to credit wire 0.
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  for (let i = 0; i < 20; i++) { h.frame('$HIR,0,0,0,3,8,0,0,*'); h.frame(`$HP,${Math.max(0, 45 - 8 * i)},0,0,*`); }
  assert.equal(h.eng.alive, false, 'the hill killed us');
  const kb = h.eng.killedBy;
  assert.equal(kb.unknown, true); assert.equal(kb.name, null); assert.equal(kb.teamName, null); assert.equal(kb.teamKey, null);
  assert.equal(kb.num, 0);
  const death = h.facts.find(f => f.type === 'death');
  assert.equal(death.shooter_num, 0, 'the fact still says wire 0 so MC scores it for nobody');
  // CONTROL: a real shooter is still named, with their team chip.
  const g = harness().kit().config_().echo().start(0); g.adv(10); g.eng.tick();
  g.frame('$HIR,4,0,19,2,9,0,3,*'); g.frame('$HP,0,0,0,*');
  assert.equal(g.eng.killedBy.name, 'VIPER'); assert.equal(g.eng.killedBy.teamKey, 'yellow'); assert.equal(g.eng.killedBy.unknown, undefined);
  // CONTROL: a STALE latch is the same "nobody we can name" case, not the stale shooter's team.
  const s = harness().kit().config_().echo().start(0); s.adv(10); s.eng.tick();
  s.frame('$HIR,4,0,19,2,9,0,3,*'); s.adv(3000); s.frame('$HP,0,0,0,*');
  assert.equal(s.eng.killedBy.unknown, true); assert.equal(s.eng.killedBy.teamName, null);
});

test('F34: the node floors the respawn delay at 3 s whatever the config says (F13 relay wedge)', () => {
  // MC refuses 1-2 s at PUT, but a config that arrives another way (a preset, the demo, the stage) used to spawn
  // at exactly that -- inside the headset relay's out-blink wedge. 0 is not "no delay" on the node either.
  for (const [delay_s, wantMs] of [[1, 3000], [2, 3000], [3, 3000], [8, 8000], [0, 10000], [undefined, 10000]]) {
    const h = harness();
    if (delay_s === undefined) delete h.config.respawn.delay_s; else h.config.respawn.delay_s = delay_s;
    h.kit().config_().echo().start(0); h.adv(10); h.eng.tick();
    assert.equal(h.eng.respawnDelayMs, wantMs, `delay_s ${delay_s}`);
  }
  const h = harness(); h.config.respawn.delay_s = 1;
  h.kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.adv(1500); h.eng.tick();
  assert.equal(h.eng.alive, false, 'not back at 1.5 s');
  h.adv(1600); h.eng.tick();
  assert.equal(h.eng.alive, true, 'back once 3 s have passed');
});

test('auto respawn writes revive and emits respawn', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.adv(8000); h.eng.tick();
  assert.equal(h.eng.alive, true);
  assert.ok(h.facts.some(f => f.type === 'respawn'));
});

test('F206 (node half): a $PSET the COMPILER never saw gets a $TID behind it, and a bundle burst that already carries one gets nothing', () => {
  // bench 2026-09-16: a $PSET clears the gun's team ($HIR t4 = 0) until a $TID follows; $SPAWN and $SIR do not.
  // A gun with no team emits its hits as team 0, which put two guns on the same side at the bench.
  //
  // F206 is fixed in BOTH halves, and they cover different writes:
  //  - the COMPILER puts the $TID in the spawn/revive bursts, where it knows the team at build time. That
  //    half is pinned by 'F206: the spawn burst carries the $PSET from pset_pool BEFORE $SPAWN...' below.
  //  - `_tidAfterPset` is the node's safety net for every OTHER write carrying a $PSET, which the compiler
  //    cannot see: a mid-game pool change, an operator action, anything the node composes itself.
  // So this test asserts the node half ONLY, and its companion assertion is the more valuable one: against
  // a bundle that already carries a $TID the node adds NOTHING, so the gun is never sent two.
  const oneTid = (w, tid) => w.filter(f => f.startsWith('$TID,')).join(' ') === `$TID,${tid},*`;
  assert.ok(golden.pset_pool && golden.pset_pool.length, 'the golden bundle carries a scream pool');
  const h = harness().kit();
  h.writes.length = 0; h.config_();
  assert.ok(oneTid(h.writes, 1), `the head carries its own $TID: nothing added -- got ${h.writes.filter(f => f.startsWith('$TID,')).join(' ')}`);
  h.echo(); h.writes.length = 0; h.start(0); h.adv(10); h.eng.tick();
  assert.ok(h.writes.includes('$SPAWN,,*') && oneTid(h.writes, 1), `spawn: exactly one $TID, the bundle's -- got ${h.writes.join(' ')}`);
  assert.deepEqual(h.writes.slice(h.writes.indexOf('$SPAWN,,*') + 1, h.writes.indexOf('$SPAWN,,*') + 2), ['$TID,1,*'], 'and it is the compiler\'s, right after $SPAWN (2026-09-19: a timed spawn with protection 0 writes no t8)');
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.writes.length = 0; h.adv(8000); h.eng.tick();
  assert.ok(h.writes.includes('$SPAWN,,*') && oneTid(h.writes, 1), `revive: exactly one $TID, the bundle's -- got ${h.writes.join(' ')}`);
  // Only the node covers this one: a $PSET with no $TID behind it, in a write no bundle burst produced.
  h.writes.length = 0; h.eng._write([golden.pset_pool[0], '$AMMO,0,1,1,1,*'], 'lone pset');
  assert.deepEqual(h.writes, [golden.pset_pool[0], '$TID,1,*', '$AMMO,0,1,1,1,*'], 'a $PSET with no $SPAWN gets the team too');
  h.writes.length = 0; h.eng._write(['$SPAWN,,*', '$AMMO,0,1,1,1,*'], 'no pset');
  assert.deepEqual(h.writes, ['$SPAWN,,*', '$AMMO,0,1,1,1,*'], 'no $PSET, nothing added');
  // a $TID already after the $PSET is not doubled, and becomes the team every later $PSET restores
  h.writes.length = 0; h.eng._write([golden.pset_pool[0], '$TID,3,*'], 'flip'); h.eng._write([golden.pset_pool[0]], 'later');
  assert.deepEqual(h.writes, [golden.pset_pool[0], '$TID,3,*', golden.pset_pool[0], '$TID,3,*']);
  // after an app restart `_gunTid` is not persisted: the persisted head's $TID is the fallback
  const w0 = []; const fresh = new Engine({ writer: f => w0.push(...f), emit: () => {}, report: () => {}, now: () => 1, synced: () => true, storage: mkStorage(), log: () => {} });
  fresh.frames = golden; fresh._write([golden.pset_pool[0]], 'after restart');
  assert.deepEqual(w0, [golden.pset_pool[0], '$TID,1,*']);
  // infection: the flip's own $TID wins on the flip and on every later revive. The flip burst is built the
  // way compile.py builds it -- `[$TID,<new>] + _revive_for(<new>)`, so the revive's own $TID is the NEW
  // team's too; a hand-built burst carrying the ARMING team's $TID would test a bundle MC cannot emit.
  //
  // A FIXTURE THAT SPREADS A BUNDLE FIELD IT DOES NOT OWN SILENTLY TRACKS THAT FIELD'S SHAPE. This one
  // spread `golden.revive`, and it was byte-exact while our compiler built the flip as `[$TID] + revive`
  // from a revive that carried no $TID at all. The 2026-09-18 merge moved $TID INTO the revive burst and
  // rebuilt the flip's revive for the new team in the same change, so the spread quietly inherited a team
  // byte that had grown underneath it and described a bundle MC could not emit. Nothing was wrong before
  // the merge; the merge is what made it wrong, and no assertion could see that. So MIRROR the compiler's
  // shape here, never splice its output -- and if you spread a bundle field, own the assertion about it.
  const b = { ...golden, player_id: 'p1', team_flip: { '2': ['$TID,2,*', ...golden.revive.map(f => f.startsWith('$TID,') ? '$TID,2,*' : f)] } };
  const writes = []; let clock = 1e6;
  const eng = new Engine({ writer: f => writes.push(...f), emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn() });
  const config = { config_id: 'g', mode: 'infection', environment: 'indoor', night: false, time_limit_s: 300, respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: null, win_by: 'survival' }, health: { max_hp: 45, max_armor: 70 }, teams: [{ team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, { team_id: 'inf', tid: 2, name: 'INFECTED', color: 'red' }] };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'X', team_id: 'human', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' }, team: { team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: b, roster: [] } }); eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm', go_live_t: clock, config_id: 'g', seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick();
  eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*');
  writes.length = 0; clock += 8000; eng.tick();
  assert.ok(writes.includes('$SPAWN,,*') && writes.includes('$TID,2,*'), `a revive after the flip keeps the flipped team -- got ${writes.join(' ')}`);
  assert.ok(!writes.includes('$TID,1,*'), 'never the old team');
});

test('B5: a stale zero-HP echo right after a respawn is not a phantom death, and a fast real kill right after it still counts', () => {
  // Field evidence 2026-09-12: 0.55 s after an auto-respawn the engine emitted a death with shooter_num 0
  // ("by UNKNOWN"), then ~2 s of real hits from a shooter, and the real kill was swallowed (`alive` was
  // already false). Cause: the revive write sets `alive`/`hp` locally right away, but a stale zero-HP
  // frame the gun queued BEFORE it processed $SPAWN can still land -- it reflects the life that just
  // ended, not this one.
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$LCD,45,70,0,0,36,216,*');                     // the gun confirms the first life
  h.frame('$HIR,4,0,7,2,45,0,3,*'); h.frame('$HP,0,0,0,*');   // get the player down once, for a REAL revive below
  assert.equal(h.eng.alive, false, 'setup: player is down');
  h.adv(8000); h.eng.tick();                              // auto-respawn (delay 8 s) -> _revive; the settle window starts here
  assert.equal(h.eng.alive, true, 'setup: revived');
  const deathsAfterRevive = h.eng.deaths;

  // The stale echo: no fresh latch (the shot that killed the first life is long gone), 0.55 s after the
  // revive write. Must NOT be treated as a death.
  h.adv(550);
  h.frame('$LCD,0,0,0,0,36,216,*');
  assert.equal(h.eng.alive, true, 'phantom death must not fire on the stale echo');
  assert.equal(h.eng.deaths, deathsAfterRevive, 'no death counted for the stale echo');

  // A REAL hit lands moments later, still inside the settle window, and finishes the kill. It carries its
  // OWN fresh latch, so a spawn-camp kill must still count immediately, correctly attributed.
  h.adv(100);
  h.frame('$HIR,4,0,19,2,45,0,3,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false, 'the real kill lands');
  assert.equal(h.eng.deaths, deathsAfterRevive + 1, 'exactly one death counted (the phantom did not eat it)');
  const death = h.facts.filter(f => f.type === 'death').pop();
  assert.equal(death.shooter_num, 19, 'the real shooter is credited, not swallowed by the earlier phantom');
  assert.equal(h.eng.killedBy.unknown, undefined, 'DOWN screen names the real shooter');
});

test('shots counter: $ALCD decrements count, increases (reload) ignored', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*'); h.frame('$ALCD,31,100,0,384,0,*'); h.frame('$ALCD,30,100,0,384,0,*');
  assert.equal(h.eng.shots, 2);
  h.frame('$ALCD,32,100,0,382,0,*');  // reload — ignored
  assert.equal(h.eng.shots, 2);
  h.frame('$ALCD,31,100,0,382,0,*');
  assert.equal(h.eng.shots, 3);
});

test('weapon heat (bench 2026-09-17): $ALCD token 5 drives heat/overheating/heatEverSeen for the active slot', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  assert.equal(h.eng.state().heat, null, 'no $ALCD seen yet: heat is unknown, not zero');
  assert.equal(h.eng.state().heatEverSeen, false);
  assert.equal(h.eng.state().overheating, false);
  h.frame('$ALCD,32,100,0,384,55,*');   // heat rising, under the lockout
  assert.equal(h.eng.state().heat, 55);
  assert.equal(h.eng.state().heatEverSeen, true, 'a non-zero heat token proves this weapon heats');
  assert.equal(h.eng.state().overheating, false, 'below HEAT_LOCKOUT: building up, not locked out');
  h.frame('$ALCD,31,100,0,384,108,*');   // match 592e444eff: heat 99 -> 108, a real bench capture
  assert.equal(h.eng.state().heat, 108);
  assert.equal(h.eng.state().overheating, true, 'past HEAT_LOCKOUT: the gun will not fire');
  h.frame('$ALCD,31,100,0,384,0,*');   // the gun's own next report after cooldown/reload: heat 0
  assert.equal(h.eng.state().heat, 0);
  assert.equal(h.eng.state().overheating, false, 'heat 0 clears the lockout');
  assert.equal(h.eng.state().heatEverSeen, true, 'the bar itself stays available for the rest of this life');
});

test('review 2026-09-17: heat is recorded even while the gun is STUNNED', () => {
  // Ammo/reserve are correctly frozen while stunned (F15) -- but the heat token is a separate signal, and
  // skipping it too only made a stuck-above-lockout reading sit unrefreshed for even longer.
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,55,*');
  assert.equal(h.eng.state().heat, 55);
  h.eng.stunned = { at: h.eng.now(), until: h.eng.now() + 5000, ammo: {} };
  h.frame('$ALCD,32,0,0,0,108,*');   // the gun's own disarm echo, still carrying the real heat token
  assert.equal(h.eng.heatBySlot[0], 108, 'heat updates even though this is a stunned-window $ALCD');
  assert.equal(h.eng.ammo, 32, 'ammo is untouched while stunned (F15) -- only heat is recorded early');
});

test('review 2026-09-17: a stuck OVERHEAT reading goes stale after HEAT_STALE_MS with no new $ALCD', () => {
  // Bench 2026-09-17 (match 592e444eff): a locked-out weapon sends NO $ALCD while it cools ("10 pulls, no
  // $ALCD"), so the last reading above HEAT_LOCKOUT could otherwise sit there for the rest of the life,
  // sticking OVERHEAT on and keeping `no_fire` from ever taking over.
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,31,100,0,384,108,*');   // match 592e444eff: a real bench capture
  assert.equal(h.eng.state().overheating, true);
  h.adv(24000);
  assert.equal(h.eng.state().overheating, true, 'still inside the stale window (pool-stale.test.mjs pins ~20s of dry pulls exempt): must not clear early');
  h.adv(1500);   // 25500ms since the last $ALCD, past HEAT_STALE_MS
  assert.equal(h.eng.state().overheating, false, 'no $ALCD for HEAT_STALE_MS: the reading can no longer be trusted');
  // a fresh $ALCD below the lockout still reads normally afterwards
  h.frame('$ALCD,31,100,0,384,10,*');
  assert.equal(h.eng.state().overheating, false);
  assert.equal(h.eng.state().heat, 10);
});

test('weapon heat: a weapon that never heats (token 5 always 0) never sets heatEverSeen', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*'); h.frame('$ALCD,31,100,0,384,0,*'); h.frame('$ALCD,30,100,0,384,0,*');
  assert.equal(h.eng.state().heat, 0);
  assert.equal(h.eng.state().heatEverSeen, false, 'heat 0 every time: this weapon never heats, so the HUD must never draw a heat bar for it');
});

test('weapon heat: a fresh spawn clears heatEverSeen (a new life does not inherit the last life\'s heat)', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,108,*');
  assert.equal(h.eng.state().heatEverSeen, true);
  h.frame('$HP,0,0,0,*');   // dead
  h.eng._spawn(false);      // a new life
  assert.equal(h.eng.state().heatEverSeen, false, 'a fresh life owes no heat until the gun reports some');
  assert.equal(h.eng.state().heat, null);
});

test('feedback freshness: fresh flashes, stale ignored', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: h.eng.now(), cue: golden.cues.kill } });
  assert.ok(h.writes.includes('$SFLASH,*') && h.writes.includes(golden.cues.kill), 'fresh feedback writes flash + cue');
  assert.ok(h.writes.indexOf('$SFLASH,*') < h.writes.indexOf(golden.cues.kill) && h.delays.includes(120), 'flash first, cue after a 120 ms gap');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: h.eng.now() - 5000, cue: golden.cues.kill } });
  assert.equal(h.writes.length, 0, 'stale feedback ignored');
});

test('kill confirm names the victim by gamertag, never by player_id (field 2026-09-17)', () => {
  const h = harness({ mode: 'ffa' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  // MC's wire: `victim` is a player_id. The banner must not print it.
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: h.eng.now(), victim: 'p2', victim_team: 'ffa' } });
  assert.equal(h.eng.moment.data.victim, 'VIPER', 'resolved through the roster');
  h.adv(3000);
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: h.eng.now(), victim: 'p2', victim_display: 'VIPER-PIXEL5', victim_team: 'ffa' } });
  assert.equal(h.eng.moment.data.victim, 'VIPER-PIXEL5', "MC's victim_display wins over a roster that may be stale");
  h.adv(3000);
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: h.eng.now(), victim: 'db2f4aa5', victim_team: 'ffa' } });
  assert.equal(h.eng.moment.data.victim, null, 'an unknown id is not a name: the HUD falls back to the team label');
});

test('timed end → writes end + game_over → KITTED', () => {
  const h = harness({ timeLimit: 60 }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.adv(60_000); h.eng.tick();
  assert.equal(h.eng.phase, 'kitted');
  assert.ok(h.writes.includes('$STOP,*'), 'end sequence written');
  assert.ok(h.writes.includes(golden.cues.game_over), 'game_over cue played');
});

test('control end/recall/panic land in KITTED', () => {
  for (const cmd of ['end', 'recall', 'panic']) {
    const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
    h.eng.onMcMessage({ kind: 'control', body: { cmd } });
    assert.equal(h.eng.phase, 'kitted', cmd);
  }
});

test('S7.1 rejoin reconcile: a live gun disarms then re-arms, never a heal', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*');
  assert.equal(h.eng.alive, true);
  h.eng.onBleDropped(); h.eng.onBleConnected();
  assert.ok(h.eng.state().reconciling, 'reconcile started — no infer-death resync on a rejoin');
  assert.equal(h.eng.resync, null);
  assert.ok(h.writes.some(f => f === '$AMMO,0,0,0,1,*'), 'gun disarmed while reconciling');
  const before = h.writes.length;
  h.adv(3000); h.eng.tick();                                 // past RECONCILE_MS
  assert.equal(h.eng.state().reconciling, false, 'reconcile ended');
  assert.equal(h.eng.alive, true, 'still alive — no death inferred, no heal');
  assert.ok(!h.writes.slice(before).some(f => f.startsWith('$SPAWN')), 'never spawns on a rejoin');
});

test('node.md §3.10: resume() in LIVE RECONCILES — it never runs the retired trigger-first evidence protocol', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$LCD,29,70,0,0,10,384,*');            // alive at 29 hp — the state a resume must not touch
  assert.equal(h.eng.alive, true); assert.equal(h.eng.hp, 29);
  const before = h.writes.length;
  h.adv(30000);                                   // the webview really was frozen: 30 s with no tick and no frame
  h.eng.resume();                                 // app foregrounded, gun still linked
  const st = h.eng.state();
  assert.ok(st.reconciling, 'a live resume opens the disarmed reconcile window');
  assert.equal(st.resync, null, 'NO resync prompt — the evidence protocol mis-concluded "dead" and healed on restart');
  assert.ok(h.writes.slice(before).some(f => f === '$AMMO,0,0,0,1,*'), 'the gun is disarmed while state settles');
  assert.equal(h.eng.hp, 29, 'pools untouched');
  assert.equal(h.eng.alive, true);
  h.adv(3000); h.eng.tick();
  assert.equal(h.eng.state().reconciling, false, 'the window closes on its own — no trigger pull is asked of the player');
  assert.equal(h.eng.hp, 29, 'still no heal');
  assert.ok(!h.writes.slice(before).some(f => f.startsWith('$SPAWN')), 'a resume can never re-spawn');
});

// §3.11: `resume()` is wired to visibilitychange AND pageshow, so it fires on a notification shade, a
// lock-screen glance and a half-second app switch. Reconciling on those disarms a live player for
// RECONCILE_MS and then re-arms from frames.spawn — a full magazine on demand (review 2026-09-12).
test('§3.11: a LIVE foreground with the link up and no real gap writes NOTHING — no disarm, no reconcile, no free magazine', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$LCD,29,70,0,0,4,120,*');              // alive at 29 hp with 4 rounds left in the mag
  const before = h.writes.length;
  h.adv(200); h.eng.resume();                     // the shade came down and went back up
  const st = h.eng.state();
  assert.equal(st.reconciling, false, 'the app never stopped ticking — there is nothing to reconcile');
  assert.deepEqual(h.writes.slice(before), [], 'and so NOTHING goes to the gun: no $AMMO disarm, no re-arm');
  assert.equal(h.eng.hp, 29); assert.equal(h.eng.alive, true);
});

test('§3.11 CONTROL: the same foreground after a real 30 s freeze DOES reconcile (the gate is evidence, not a ban)', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$LCD,29,70,0,0,4,120,*');
  const before = h.writes.length;
  h.adv(30000); h.eng.resume();                   // 30 s with no tick and no frame: the webview was frozen
  assert.ok(h.eng.state().reconciling, 'a real suspension still opens the disarmed window');
  assert.ok(h.writes.slice(before).some(f => f === '$AMMO,0,0,0,1,*'), 'and still disarms while state settles');
});

test('§3.11: a tick or a gun frame is proof of life — a long gap that was actually spent RUNNING reconciles nothing', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.adv(30000);
  h.eng.tick();                                   // the app was awake the whole time; this is the latest heartbeat
  const before = h.writes.length;
  h.adv(200); h.eng.resume();
  assert.equal(h.eng.state().reconciling, false, 'the gap is measured from the last tick, not from the last resume');
  assert.deepEqual(h.writes.slice(before), []);
  const h2 = harness().kit().config_().echo().start(0); h2.adv(10); h2.eng.tick();
  h2.adv(30000); h2.frame('$LCD,29,70,0,0,4,120,*');   // a frame off the gun is proof the JS ran too
  const before2 = h2.writes.length;
  h2.adv(100); h2.eng.resume();
  assert.equal(h2.eng.state().reconciling, false, 'a frame is evidence as good as a tick');
  assert.deepEqual(h2.writes.slice(before2), []);
});

test('§3.11: visibilitychange and pageshow both firing for ONE foreground reconcile once, not twice', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.adv(30000);
  h.eng.resume();                                 // visibilitychange
  const after1 = h.writes.length;
  assert.ok(h.eng.state().reconciling);
  h.eng.resume();                                 // pageshow, same instant
  assert.equal(h.writes.length, after1, 'the second resume is not a second suspension — no second disarm');
});

test('node.md §3.10 CONTROL: the evidence protocol survives for ARMED — a relink there re-writes the head, and a LOBBY resume reconciles nothing', () => {
  const a = harness().kit().config_().echo().start(30000);   // armed, T-30
  assert.equal(a.eng.phase, 'armed');
  const beforeA = a.writes.length;
  a.eng.onBleDropped(); a.eng.onBleConnected();
  assert.equal(a.eng.state().reconciling, false, 'ARMED has no live state to reconcile');
  assert.ok(a.writes.slice(beforeA).includes('$START,*'), '_beginResync still re-writes the head here');
  const h = harness().kit().config_().echo();                // lobby, configured, link never dropped
  const before = h.writes.length;
  h.eng.resume();
  assert.equal(h.eng.state().reconciling, false, 'a lobby resume opens no reconcile window');
  assert.equal(h.eng.resync, null, 'and no evidence protocol');
  assert.ok(!h.writes.slice(before).some(f => f.startsWith('$SPAWN')), 'and never blind-spawns');
});

test('S7.1 rejoin reconcile never infers death — the force-close-at-low-HP exploit stays closed', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$LCD,25,70,0,0,10,384,*');           // alive at 25 hp — the cheat's starting point
  assert.equal(h.eng.alive, true); assert.equal(h.eng.hp, 25);
  h.eng.onBleDropped(); h.eng.onBleConnected();  // force-close → reopen → reconnect
  assert.ok(h.eng.state().reconciling);
  h.frame('$BUT,0,1,*'); h.frame('$BUT,2,1,*'); h.adv(1600); h.eng.tick();  // a silent reload: the OLD code inferred DEATH here
  h.adv(3000); h.eng.tick();                     // the reconcile window elapses
  assert.equal(h.eng.alive, true, 'still alive at 25 — no inferred death');
  assert.equal(h.eng.hp, 25, 'no free heal to full');
  assert.ok(!h.facts.some(f => f.type === 'respawn'), 'no respawn granted');
  assert.ok(!h.facts.some(f => f.type === 'death' && f.desync === true), 'no inferred death');
});

test('§3.10 resync in LMS never writes head/spawn', () => {
  const h = harness({ respawn: 'none' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,10,100,0,80,0,*');
  h.eng.onBleDropped(); h.eng.onBleConnected();
  const before = h.writes.length;
  h.frame('$BUT,0,1,*'); h.frame('$BUT,2,1,*'); h.adv(1600); h.eng.tick();  // reload silent, reserve>0 → not-live
  assert.ok(!h.writes.slice(before).includes('$SPAWN,,*'), 'LMS never spawns');
  assert.ok(!h.writes.slice(before).includes('$START,*'), 'LMS never re-writes head');
});

test('resumeSchedule across T-0: within grace spawns; long-past hot-joins', () => {
  const h = harness().kit().config_().echo().start(30000);
  h.adv(30000 + 5000);              // 5 s past T-0, within LATE_ARM_GRACE (8 s)
  const r = h.eng.resumeSchedule();
  assert.equal(h.eng.phase, 'live'); assert.equal(r.reason, 'grace');

  const h2 = harness().kit().config_().echo().start(30000);
  h2.adv(30000 + 60000);            // 60 s past → hot-join
  const r2 = h2.eng.resumeSchedule();
  assert.equal(h2.eng.phase, 'live'); assert.equal(r2.reason, 'hot_join');
});

test('F86: after an infection flip the gun is TAKEN with the new team\'s frames, on the flip and on every later revive', () => {
  const NEW_TAKE = ['$GLED,,,,5,,,*', '$GLED,2,2,2,0,1,,*'];
  const b = { ...golden, player_id: 'p1', team_flip: { '2': ['$TID,2,*', '$SPAWN,,*'] }, team_flip_take: { '2': NEW_TAKE } };
  const writes = []; const facts = []; let clock = 1e6;
  const eng = new Engine({ writer: f => writes.push(...f), emit: f => facts.push(f), report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn() });
  const config = { config_id: 'g', mode: 'infection', environment: 'indoor', night: false, time_limit_s: 300, respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: null, win_by: 'survival' }, health: { max_hp: 45, max_armor: 70 }, teams: [{ team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, { team_id: 'inf', tid: 2, name: 'INFECTED', color: 'red' }] };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'X', team_id: 'human', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' }, team: { team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: b, roster: [] } }); eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm', go_live_t: clock, config_id: 'g', seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick();
  const oldRest = golden.gun.take[golden.gun.take.length - 1];
  assert.ok(writes.includes(oldRest), 'the first life is taken with the arming team\'s rest');
  eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*');
  assert.equal(eng.teamTid, 2, 'flipped');
  writes.length = 0;
  clock += 8000; eng.tick();                       // the auto respawn -> _revive -> _gunTake
  assert.ok(writes.includes(NEW_TAKE[1]), 'the take after the flip is the NEW team\'s rest');
  assert.ok(!writes.includes(oldRest), 'and never the old colour again');
  // CONTROL: without the table (an older MC) the old take is used, as before
  const c = { ...golden, player_id: 'p1', team_flip: { '2': ['$TID,2,*', '$SPAWN,,*'] } };
  const w2 = []; let clock2 = 1e6;
  const e2 = new Engine({ writer: f => w2.push(...f), emit: () => {}, report: () => {}, now: () => clock2, synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn() });
  e2.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  e2.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'X', team_id: 'human', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' }, team: { team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, roster: [] } });
  e2.onMcMessage({ kind: 'config', body: { config, frames: c, roster: [] } }); e2.feedFrame('$LCD,0,0,0,0,0,0,*');
  e2.onMcMessage({ kind: 'start', body: { match_id: 'm', go_live_t: clock2, config_id: 'g', seq: 1, countdown_s: 0 } });
  clock2 += 10; e2.tick(); e2.feedFrame('$HIR,4,0,19,2,9,0,3,*'); e2.feedFrame('$HP,0,0,0,*'); w2.length = 0; clock2 += 8000; e2.tick();
  assert.ok(w2.includes(oldRest));
});

test('F64: a lethal host write arrives as a zeroed $LCD with no $HP, and the node books the death from it', () => {
  // The frame is the one captured on the bench 2026-09-09 (`$LIFE` to zero emitted `$LCD,0,0,0,0,32,192,*` and
  // never `$HP,0,0,0`). The correction to F64 was a CODE READ; this is the replay it asked for.
  const h = goLive(harness());
  h.frame('$LCD,0,0,0,0,32,192,*');
  assert.equal(h.eng.alive, false, 'death booked off the $LCD path');
  assert.equal(h.eng.deaths, 1);
  const death = h.facts.find(f => f.type === 'death');
  assert.ok(death && death.shooter_num === 0, 'no attribution: nobody shot us');
  assert.equal(h.eng.killedBy.unknown, true, 'the DOWN screen says UNKNOWN, not a team');
  assert.equal(h.facts.some(f => f.type === 'hit_taken'), false, 'and no hit_taken fact -- the residual S16 must decide credit for a lethal tick');
});

test('infection: death writes team_flip and emits team_change', () => {
  const b = { ...golden, player_id: 'p1', team_flip: { '2': ['$TID,2,*'] } };
  const writes = []; const facts = []; let clock = 1e6;
  const eng = new Engine({ writer: f => writes.push(...f), emit: f => facts.push(f), report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {} });
  const config = { config_id: 'g', mode: 'infection', environment: 'indoor', night: false, time_limit_s: 300, respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: null, win_by: 'survival' }, health: { max_hp: 45, max_armor: 70 }, teams: [{ team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, { team_id: 'inf', tid: 2, name: 'INFECTED', color: 'red' }] };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'X', team_id: 'human', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' }, team: { team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: b, roster: [] } }); eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm', go_live_t: clock, config_id: 'g', seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick();
  eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*');
  assert.ok(writes.includes('$TID,2,*'), 'team_flip written');
  assert.ok(facts.some(f => f.type === 'team_change' && f.tid === 2));
});

// ---------------- polish iteration 1 regressions ----------------
test('shots counter is per weapon slot: a weapon swap is not a shot', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*');
  h.frame('$ALCD,6,100,1,24,0,*');     // swap to the shotgun (slot 1) — NOT 26 shots
  assert.equal(h.eng.shots, 0);
  assert.equal(h.eng.ammo, 6); assert.equal(h.eng.mag, 6);
  h.frame('$ALCD,5,100,1,24,0,*');     // one shotgun round
  assert.equal(h.eng.shots, 1);
  h.frame('$ALCD,32,100,0,384,0,*');   // back to the rifle — not a reload, not a shot
  assert.equal(h.eng.shots, 1);
  h.frame('$ALCD,31,100,0,384,0,*');
  assert.equal(h.eng.shots, 2);
});

test('resumeSchedule without a gun linked never leaves IDLE (launch restore)', () => {
  const h = harness().kit().config_().echo().start(30000);
  // simulate a relaunch: fresh engine on the same storage, gun not linked yet
  const store = h.eng.storage;
  let clock = h.eng.now() + 40000;
  const eng2 = new Engine({ writer: () => {}, now: () => clock, synced: () => true, storage: store, log: () => {} });
  assert.equal(eng2.phase, 'idle');
  eng2.resume();
  assert.equal(eng2.phase, 'idle', 'phase untouched without a gun');
  assert.equal(eng2.resumeSchedule().reason, 'gun_not_linked');
  assert.equal(eng2.state().rejoin, true, 'HUD shows the rejoin hint');
  eng2.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.notEqual(eng2.phase, 'idle', 'phase re-derived once the gun links');
});

test('a start for an already-ended match is a no-op (no re-arm on re-hydration)', () => {
  const h = harness({ timeLimit: 60 }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.adv(60_000); h.eng.tick();
  assert.equal(h.eng.phase, 'kitted');
  const before = h.writes.length;
  const r = h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: h.eng.now() - 70_000, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  assert.equal(r.reason, 'match_ended'); assert.equal(h.eng.phase, 'kitted'); assert.equal(h.writes.length, before);
  h.eng.hydrate({ start: { match_id: 'm1', go_live_t: h.eng.now() - 70_000, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  assert.equal(h.eng.phase, 'kitted', 'hydrate with the ended match is ignored too');
});

test('config that arrives while the gun is unlinked is written on relink and acked', () => {
  const h = harness().kit();
  h.eng.onBleDropped();
  h.config_();
  assert.equal(h.eng.configPending, true);
  assert.ok(!h.writes.includes('$START,*'), 'nothing written while unlinked');
  h.eng.onBleConnected();
  assert.ok(h.writes.includes('$START,*'), 'head written on relink');
  assert.equal(h.eng.phase, 'lobby');
  h.adv(1600); h.echo(); h.eng.tick(); h.queryConfig();
  assert.ok(h.reports.some(r => r.k === 'ack_config' && r.b.ok), 'ack_config after the relink write');
});

test('timed end with the gun unlinked: teardown is owed and written on relink', () => {
  const h = harness({ timeLimit: 60 }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.onBleDropped();
  const n0 = h.writes.length;
  h.adv(60_000); h.eng.tick();
  assert.equal(h.eng.phase, 'kitted'); assert.equal(h.eng.pendingTeardown, 'end');
  assert.ok(!h.writes.slice(n0).includes(golden.cues.game_over), 'end not written while unlinked');
  const n1 = h.writes.length;
  h.eng.onBleConnected();
  assert.ok(h.writes.slice(n1).includes('$STOP,*') && h.writes.slice(n1).includes(golden.cues.game_over), 'end + game_over written on relink');
  assert.equal(h.eng.pendingTeardown, null);
});

test('a real $HP,0 during a rejoin reconcile is honored as a (desync) death', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.onBleDropped(); h.eng.onBleConnected();
  assert.ok(h.eng.state().reconciling);
  h.frame('$HP,0,0,0,*');                              // real evidence — the gun died during the gap
  const d = h.facts.find(f => f.type === 'death');
  assert.ok(d && d.desync === true, 'a real $HP,0 is honored even mid-reconcile');
});

test('infection flip resolves the new team from config.teams by tid', () => {
  const b = { ...golden, player_id: 'p1', team_flip: { '2': ['$TID,2,*'] } };
  let clock = 1e6;
  const eng = new Engine({ writer: () => {}, emit: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {} });
  const config = { config_id: 'g', mode: 'infection', environment: 'indoor', night: false, time_limit_s: 300, respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: null, win_by: 'survival' }, health: { max_hp: 45, max_armor: 70 }, teams: [{ team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, { team_id: 'inf', tid: 2, name: 'INFECTED', color: 'red' }] };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'X', team_id: 'human', loadout: { weapons: [] }, voice: 'male' }, team: config.teams[0], roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: b, roster: [] } }); eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm', go_live_t: clock, config_id: 'g', seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick();
  eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*');
  assert.equal(eng.team.team_id, 'inf'); assert.equal(eng.team.name, 'INFECTED'); assert.equal(eng.team.tid, 2);
});

test('ARMED + BLE reconnect re-writes the head and still spawns at T-0', () => {
  const h = harness().kit().config_().echo().start(9000);
  h.eng.onBleDropped(); h.adv(2000); h.eng.onBleConnected();
  assert.equal(h.eng.resync, null, 'no evidence protocol in ARMED');
  assert.ok(h.writes.filter(f => f === '$START,*').length >= 2, 'head re-written');
  h.adv(7000); h.eng.tick();
  assert.equal(h.eng.phase, 'live');
});

// ---------- polish iteration 2 regressions ----------
function goLive(h) { h.kit().config_().echo().start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*'); return h; }

test('head re-write mid-match: the $LCD,0,… echo adds 0 shots', () => {
  const h = goLive(harness());
  h.frame('$ALCD,34,100,0,216,0,*');
  assert.equal(h.eng.shots, 2);
  h.config_();                                             // MC re-pushes config on a LIVE gun → head re-write
  const headWrites = h.writes.filter(f => f === '$CLEAR,*').length;
  assert.ok(headWrites >= 2, 'head re-written');
  h.frame('$LCD,0,0,0,0,0,0,*');                            // the head echo
  assert.equal(h.eng.shots, 2, 'echo counted as a reset, not a magazine dump');
  h.adv(9000); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  assert.equal(h.eng.shots, 2, 'the refill is an increase, not shots');
  h.frame('$ALCD,35,100,0,216,0,*');
  assert.equal(h.eng.shots, 3, 'real shots still count');
});

test('B1: a LOBBY config re-push rewrites the head and the new $TID reaches the gun', () => {
  // The server-side P0 (2026-09-12): editing a loaded game (e.g. a re-team) in the lobby must put a
  // FRESH head on the gun, and the gun writes whatever head it is handed. This is the phone half of the
  // guard: a re-pushed config in LOBBY is applied verbatim, so its $TID — the gun's combat team — lands.
  const h = harness().kit().config_().echo();
  assert.equal(h.eng.phase, 'lobby');
  assert.ok(h.writes.includes('$TID,1,*'), 'the first head carried the original team $TID');
  const clearsBefore = h.writes.filter(f => f === '$CLEAR,*').length;
  // MC re-compiles after a team change: same bundle, but the head's LAST frame now names the new team.
  const reteamed = { ...h.bundle, config_id: 'cfg2', head: [...h.bundle.head.slice(0, -1), '$TID,2,*'] };
  h.eng.onMcMessage({ kind: 'config', body: { config: { ...h.config, config_id: 'cfg2' }, frames: reteamed, roster: h.roster } });
  assert.ok(h.writes.filter(f => f === '$CLEAR,*').length > clearsBefore, 'the re-push wrote a fresh head');
  assert.ok(h.writes.includes('$TID,2,*'), 'the NEW team $TID reached the gun');
  assert.equal(h.eng.phase, 'lobby', 'still in lobby after the re-push');
  // and the node will re-ack the new head, so MC can see the re-push land
  h.adv(1600); h.echo(); h.eng.tick(); h.queryConfig();
  const ack = h.reports.filter(r => r.k === 'ack_config').pop();
  assert.ok(ack && ack.b.ok === true && ack.b.config_id === 'cfg2', 'fresh ack for the re-pushed config');
});

test('B1 guard: a live assign whose team the head never followed is surfaced, a matching one is not', () => {
  // MC now refuses this, but the node is the backstop: if an `assign` ever re-teams a gun whose head
  // still holds the old $TID, the player must not silently fight for the wrong side.
  const h = goLive(harness());                                   // live, head holds $TID,1 (blue, tid 1)
  assert.equal(h.eng.phase, 'live');
  // a harmless re-assert of the SAME team raises nothing
  h.eng.onMcMessage({ kind: 'assign', body: { team: { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 } } });
  assert.ok(!h.eng.moment || h.eng.moment.kind !== 'team_tid_mismatch', 'same-team assign is silent');
  // a re-team to yellow (tid 2) with no config behind it — the head still says $TID,1 — must surface
  h.eng.onMcMessage({ kind: 'assign', body: { team: { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 } } });
  assert.equal(h.eng.moment && h.eng.moment.kind, 'team_tid_mismatch');
  assert.equal(h.eng.moment.teamTid, 2);
  assert.equal(h.eng.moment.headTid, 1);
});

test('restored ARMED past the match end: no spawn, ends cleanly', () => {
  const h = harness({ timeLimit: 60 }).kit().config_().echo().start(5000);
  assert.equal(h.eng.phase, 'armed');
  h.eng.onBleDropped();
  const before = h.writes.length;
  h.adv(5000 + 61_000);                                     // T-0 and the whole match passed while unlinked
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  const after = h.writes.slice(before);
  // frames.end also begins with $SPAWN,, (revive-then-stop), so look for the spawn TAIL ($AMMO / $BMAP,0,0) instead
  assert.ok(!after.some(f => f.startsWith('$AMMO,')), 'never spawns (loads magazines) for an expired match');
  assert.ok(after.includes('$STOP,*'), 'teardown written');
  assert.equal(h.eng.phase, 'kitted');
  assert.ok(h.eng.ended);
});

test('MC-first hydrate (welcome before the gun links) lands in LOBBY with the head written', () => {
  const h = harness();
  h.eng.hydrate({ player: h.player, team: h.team, roster: h.roster, config: h.config, frames: h.bundle });
  assert.ok(!h.writes.includes('$START,*'), 'nothing written while unlinked');
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(h.eng.phase, 'lobby');
  assert.ok(h.writes.includes('$START,*'), 'head written on link');
  h.adv(1600); h.echo(); h.eng.tick(); h.queryConfig();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.ok(ack && ack.b.ok === true, 'acked');
});

test('local panic does not retire the running match_id', () => {
  const h = goLive(harness());
  h.eng.control({ cmd: 'panic' });
  assert.ok(!h.eng.endedMatches.includes('m1'));
  assert.equal(h.eng._resyncRevive, false);
});

test('weaponName follows the active slot', () => {
  const h = goLive(harness());
  h.player.loadout.weapons.push({ weapon_id: 'shotgun' });
  h.frame('$ALCD,6,100,1,24,0,*');
  assert.equal(h.eng.weaponName, 'SHOTGUN');
});

// ---------- polish iteration 3 ----------
test('MC-first late joiner: welcome carries a running start, gun links from LOBBY → ARMED (and LIVE after T-0)', () => {
  const h = harness();
  const T = h.eng.now() + 20_000;
  h.eng.hydrate({ player: h.player, team: h.team, roster: h.roster, config: h.config, frames: h.bundle,
    start: { match_id: 'm1', go_live_t: T, config_id: golden.config_id, seq: 1, countdown_s: 20 } });
  assert.equal(h.eng.phase, 'idle', 'no gun yet → stays idle');
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(h.eng.phase, 'armed', 'schedule reconciled from LOBBY, not stuck');
  h.adv(20_000 + 100); h.eng.tick();
  assert.equal(h.eng.phase, 'live', 'spawned at T-0');
  assert.ok(h.writes.some(f => f.startsWith('$AMMO,')), 'spawn tail written');
});

test('head re-write with slot 1 active: echo + refill book 0 shots (activeSlot reset to 0)', () => {
  const h = goLive(harness());
  h.player.loadout.weapons.push({ weapon_id: 'shotgun' });
  h.frame('$ALCD,6,100,1,24,0,*'); h.frame('$ALCD,5,100,1,24,0,*');   // shotgun fired once
  assert.equal(h.eng.activeSlot, 1); assert.equal(h.eng.shots, 1);
  h.config_();                                             // MC re-pushes config on a LIVE gun → head re-write
  assert.equal(h.eng.activeSlot, 0, '$CLEAR puts the gun on slot 0');
  h.frame('$LCD,0,0,0,0,0,0,*');
  h.adv(9000); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  assert.equal(h.eng.shots, 1, 'no phantom shots from the head echo / refill');
  h.frame('$ALCD,6,100,1,24,0,*');
  assert.equal(h.eng.shots, 1, 'first slot-1 reading after the head is a baseline, not 30 shots');
});

test('local panic: the same schedule re-delivered by a welcome is refused; a newer seq re-arms', () => {
  const h = goLive(harness());
  h.eng.control({ cmd: 'panic' });
  assert.equal(h.eng.phase, 'kitted');
  const same = { match_id: 'm1', go_live_t: h.eng.now() + 5000, config_id: golden.config_id, seq: 1, countdown_s: 5 };
  h.eng.hydrate({ start: same });
  assert.notEqual(h.eng.phase, 'armed', 'not re-armed by the stale schedule');
  const r = h.eng.startAt(same); assert.equal(r.ok, false); assert.equal(r.reason, 'panicked');
  h.config_(); h.echo();                                     // MC re-pushes config after a panic → back to LOBBY
  const newer = { ...same, seq: 2 };
  assert.equal(h.eng.startAt(newer).ok, true, 'a newer schedule is accepted');
  assert.equal(h.eng.phase, 'armed');
});

test('KITTED + match over + BLE relink does not re-write the head or clear the match-over screen', () => {
  const h = goLive(harness({ timeLimit: 60 }));
  h.adv(61_000); h.eng.tick();
  assert.ok(h.eng.ended); assert.equal(h.eng.phase, 'kitted');
  const before = h.writes.length;
  h.eng.onBleDropped(); h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.ok(!h.writes.slice(before).includes('$START,*'), 'no head re-write over the match-over screen');
  assert.ok(h.eng.ended, 'still ended');
});

test('runway cues are edge-triggered: stale thresholds never fire, crossed ones fire once', () => {
  // 9 s runway: every runway threshold (30/20/10 s) is already below — NONE may fire (they stacked on the bench).
  const a = harness().kit().config_();
  a.adv(1600); a.echo(); a.eng.tick(); a.writes.length = 0;
  a.start(9000); a.eng.tick();
  a.adv(5000); a.eng.tick(); a.adv(3000); a.eng.tick();
  assert.equal(a.writes.filter(f => f.includes('VA85')).length, 0, 'no VA85 with a 9 s runway');
  assert.ok(!a.eng.cuesFired.has('runway_30') && !a.eng.cuesFired.has('runway_20') && !a.eng.cuesFired.has('runway_10'));
  // 35 s runway, crossed from above. The bundle deliberately ships runway_30 and runway_20 SILENT —
  // VA85 at 30 AND 20 AND 10 stacked the same counting track on the bench (compile.py, 2026-08-25), so
  // only the 10 s call has a frame. This asserts the AUDIO, which is the thing the bench decided;
  // `cuesFired` only records cues that actually have a frame, so it cannot speak for a silent one.
  const b = harness().kit().config_();
  b.adv(1600); b.echo(); b.eng.tick();
  const va85 = () => b.writes.filter(f => f.includes('VA85')).length;
  b.start(35000); b.eng.tick();
  assert.equal(va85(), 0, 'nothing at T-35');
  b.adv(6000); b.eng.tick();   // T-29
  assert.equal(va85(), 0, 'T-30 is deliberately silent');
  b.adv(10000); b.eng.tick();  // T-19
  assert.equal(va85(), 0, 'T-20 is deliberately silent');
  b.adv(10000); b.eng.tick();  // T-9
  assert.equal(va85(), 1, 'the 10 s call is the only runway cue that speaks');
  assert.ok(b.eng.cuesFired.has('runway_10'));
  b.adv(1000); b.eng.tick();
  assert.equal(va85(), 1, 'and it fires exactly once');
});


test('tutorial end push quiets the gun and clears the try-out state', () => {
  const h = harness().kit();
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG' }, frames: ['$CLEAR,*'] } });
  assert.equal(h.eng.tutorial, true); assert.equal(h.eng.tutorialWeapon.weapon_id, 'smg');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'tutorial', body: { end: true, frames: ['$STOP,*', '$CLEAR,*'] } });
  assert.equal(h.eng.tutorial, false); assert.equal(h.eng.tutorialWeapon, null);
  assert.ok(h.writes.includes('$STOP,*'), 'teardown written to the gun');
});


test('F147: tryoutArming clears on the gun\'s own confirming ammo report', () => {
  const h = harness().kit();
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 30 }, frames: ['$WEAP,0,*'] } });
  assert.equal(h.eng.state().tryoutArming, true, 'arming while unconfirmed');
  h.frame('$ALCD,30,100,0,50,0,*');
  assert.equal(h.eng.state().tryoutArming, false, 'the matching report confirms it');
});

// Polish-loop pass 1 (2026-09-12 LOW): the untightened version confirmed on ANY later report equal to the
// clip -- an unrelated ammo line (a stray resend, or a shot/reload landing back on that number) could pass
// for confirmation of a DIFFERENT weapon's write. Only the FIRST report after arming gets a vote.
test('F147 (tightened): a non-matching first report forecloses a later coincidental match', () => {
  const h = harness().kit();
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 30 }, frames: ['$WEAP,0,*'] } });
  h.frame('$ALCD,20,100,0,50,0,*');           // the FIRST report after arming: does not match
  assert.equal(h.eng.state().tryoutArming, true, 'still arming -- no match yet');
  h.frame('$ALCD,30,100,0,50,0,*');           // a LATER report happens to equal the clip
  assert.equal(h.eng.state().tryoutArming, true, 'a later coincidental match must not confirm once the first report missed');
});

test('F147: an unconfirmed try-out arm assumes done after the timeout', () => {
  const h = harness().kit();
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 30 }, frames: ['$WEAP,0,*'] } });
  h.adv(3100); h.eng.tick();
  assert.equal(h.eng.state().tryoutArming, false, 'the timeout resolves it with no confirming report');
});

// ── polish-loop pass 2: scope to the arming SLOT, an honest timeout, no EQUIPPED flash before the write ──
test('polish-2: the ack itself arms a placeholder -- no EQUIPPED flash before the tutorial write lands', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg', true);
  assert.equal(h.eng.state().tryoutArming, false, 'nothing armed before MC answers');
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
  assert.equal(h.eng.state().tryoutArming, true, 'the ack alone must already read as arming, before the gun write ever lands');
});
// Polish-loop pass 3 (HIGH): a try-out is written to GUN SLOT 0 always, primary or secondary rack alike
// (compile.py `resolve(wid, 0)` + `$AMMO,0,…`) -- the earlier version of this test hand-fed `$ALCD,…,1,…`
// for a secondary pick, which the real gun never sends (every secondary try-out was timing out
// UNCONFIRMED against real hardware as a result). Corrected to the real frame shape, plus a dedicated
// case proving a secondary pick still confirms -- on slot 0, same as primary.
test('polish-3: a report on a DIFFERENT gun slot never forecloses confirmation', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg', true);
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 72 }, frames: ['$WEAP,0,*', '$AMMO,0,72,0,1,*'] } });
  h.frame('$ALCD,10,100,1,50,0,*');           // slot 1 -- some OTHER weapon's traffic, irrelevant to this arm (gun slot 0)
  assert.equal(h.eng.state().tryoutArming, true, 'an other-slot report must not foreclose');
  h.frame('$ALCD,72,100,0,20,0,*');           // slot 0, the arming slot, matches the clip
  assert.equal(h.eng.state().tryoutArming, false, 'the same-slot matching report still confirms');
});
test('polish-3: a SECONDARY pick is also written to gun slot 0, and confirms there', () => {
  const h = kitA10();
  h.eng.requestLoadout('secondary', 'weapon', 'smg', true);
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'secondary', ok: true, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] } } });
  // A REAL secondary try-out's frames still target gun slot 0 -- the compiled bundle never writes slot 1
  // for a try-out no matter which rack tab picked it.
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 72 }, frames: ['$WEAP,0,*', '$AMMO,0,72,0,1,*'] } });
  assert.equal(h.eng.state().tryoutArming, true, 'still arming, waiting on the gun');
  h.frame('$ALCD,72,100,0,20,0,*');           // the gun's REAL report for a secondary try-out: slot 0
  assert.equal(h.eng.state().tryoutArming, false, 'a secondary pick must confirm on gun slot 0 -- where the gun actually reports it');
});
test('polish-2: a same-slot report equal to the OLD weapon\'s magazine (the baseline) does not confirm', () => {
  const h = kitA10();
  h.frame('$ALCD,30,100,0,50,0,*');           // the OLD weapon already sits at 30 on slot 0
  h.eng.requestLoadout('primary', 'weapon', 'smg', true);
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 30 }, frames: ['$WEAP,0,*'] } });   // same clip by coincidence
  h.frame('$ALCD,30,100,0,50,0,*');           // a routine resend of the OLD weapon's own state -- proves nothing about the NEW one
  assert.equal(h.eng.state().tryoutArming, true, 'a baseline-matching report must not pass as confirmation');
});
test('polish-2/3: an unconfirmed timeout is honest -- tryoutUnconfirmed carries {tab, kind}, never a silent ✓', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg', true);
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 30 }, frames: ['$WEAP,0,*'] } });
  h.adv(3100); h.eng.tick();
  const st = h.eng.state();
  assert.equal(st.tryoutArming, false);
  assert.deepEqual(st.tryoutUnconfirmed, { tab: 'primary', kind: 'weapon' }, 'the timeout must mark it unconfirmed (identified), not a plain confirm');
});
test('polish-2/3: a fresh successful arm clears a stale tryoutUnconfirmed from the previous one', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg', true);
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 30 }, frames: ['$WEAP,0,*'] } });
  h.adv(3100); h.eng.tick();
  assert.ok(h.eng.state().tryoutUnconfirmed);
  h.eng.requestLoadout('primary', 'weapon', 'assault_rifle', true);
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'assault_rifle' }] } } });
  assert.equal(h.eng.state().tryoutUnconfirmed, null, 'a new pick must not still say the PREVIOUS one was unconfirmed');
});
test('polish-3: an unrelated PERK pick after a timed-out weapon arm never clears or claims its identity', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg', true);
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG', clip: 30 }, frames: ['$WEAP,0,*'] } });
  h.adv(3100); h.eng.tick();
  assert.deepEqual(h.eng.state().tryoutUnconfirmed, { tab: 'primary', kind: 'weapon' });
  h.eng.requestLoadout('perk', 'perk', 'body_armor');   // perks never arm a try-out at all
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'perk', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }], perk: 'body_armor' } } });
  assert.deepEqual(h.eng.state().tryoutUnconfirmed, { tab: 'primary', kind: 'weapon' }, 'the perk pick must not touch a flag that was never about it (hud.js is what keeps it off the perk row: tab/kind mismatch)');
});

test('apply.preview plays sound-only frames at the bench; non-preview stays live-only (A9.1)', () => {
  const h = harness().kit();
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'apply', body: { frames: ['$PLAY,,4,6,VAA,,,,*'] } });
  assert.equal(h.writes.length, 0, 'non-preview apply must not write off-live');
  h.eng.onMcMessage({ kind: 'apply', body: { preview: true, frames: ['$PLAY,,4,6,VAA,,,,*'] } });
  assert.ok(h.writes.includes('$PLAY,,4,6,VAA,,,,*'), 'preview sound plays in kitted');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'apply', body: { preview: true, frames: ['$CLEAR,*'] } });
  assert.equal(h.writes.length, 0, 'a preview may never smuggle non-sound frames');
});


test('config-echo $ALCD cannot poison the mag denominator (real-gun reload/pips bug)', () => {
  const h = harness().kit().config_();
  h.frame('$ALCD,24,100,1,12,0,*');            // config-time echo: WEAP clip cap 24 on slot 1
  h.adv(1600); h.echo(); h.eng.tick();
  h.start(0); h.eng.tick();                     // spawn
  h.frame('$ALCD,6,100,1,24,0,*');              // player switches to slot 1: real mag is 6
  const st = h.eng.state();
  assert.equal(st.mag, 6, 'denominator comes from the bundle $AMMO, not the config echo (got ' + st.mag + ')');
  assert.equal(st.ammo, 6);
});


test('a fresh assign after match end leaves the MATCH COMPLETE screen (new-match flow)', () => {
  const h = harness().kit().config_();
  h.adv(1600); h.echo(); h.eng.tick();
  h.start(0); h.eng.tick();
  h.eng._endLocal('test-end');
  h.eng.ackEnd();
  assert.equal(h.eng.ended, true);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  assert.equal(h.eng.ended, false, 'assign resets the over screen');
  assert.equal(h.eng.phase, 'kitted');
});

// ---------- A10 self-serve kitting (docs/spec/loadout.md §4) ----------
const CAT = { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', role: 'assault', tags: ['assault'], clip: 32, reserve: 384 }, { weapon_id: 'smg', name: 'SMG', role: 'cqb', tags: ['cqb'], clip: 72, reserve: 288 }, { weapon_id: 'rocket_launcher', name: 'Rocket Launcher', role: 'power', tags: ['heavy'], clip: 1, reserve: 4 }],
  perks: [{ perk_id: 'body_armor', name: 'Body Armor', mechanism: 'passive', effects: { max_armor_add: 50 }, verified: true, hidden: false },
          { perk_id: 'easy_reload', name: 'Easy Reload', mechanism: 'passive', effects: { alt_reload: true }, verified: true, hidden: false }] };
// A14: three rules — the perk is its own slot
const POL = { hud_select: true, primary: { choice: 'player', allowed_ids: ['assault_rifle', 'smg'] }, secondary: { choice: 'player', kinds: ['weapon'], allowed_weapon_ids: ['smg'] }, perk: { choice: 'player', allowed_perk_ids: ['body_armor', 'easy_reload'] } };
function kitA10(policy = POL) { const h = harness(); h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, catalog: CAT, policy } }); return h; }

test('A10: assign carries catalog + policy → state; loadout view resolves names from the catalog', () => {
  const h = kitA10();
  const st = h.eng.state();
  assert.equal(st.catalog.weapons.length, 3); assert.equal(st.policy.primary.choice, 'player');
  assert.equal(st.loadout.primary.name, 'Assault Rifle'); assert.equal(st.loadout.secondary, null); assert.equal(st.loadout.perk, null);
  assert.equal(st.weapon, 'ASSAULT RIFLE'); assert.ok(st.canPickPrimary && st.canPickSecondary && st.canPickPerk);
});

test('A10/A26: requestLoadout reports loadout_request (a weapon always carries try, after the debounce) and holds an optimistic pendingPick', () => {
  const h = kitA10();
  assert.equal(h.eng.requestLoadout('primary', 'weapon', 'smg', true), true);
  assert.deepEqual(h.eng.state().pendingPick.id, 'smg', 'A26: the row shows the arming mark at once');
  assert.equal(h.reports.filter(x => x.k === 'loadout_request').length, 0, 'A26: nothing on the wire until the debounce elapses');
  h.adv(400); h.eng.tick();
  const r = h.reports.find(x => x.k === 'loadout_request');
  assert.deepEqual(r.b, { player_id: 'p1', slot: 'primary', kind: 'weapon', id: 'smg', try: true });
  assert.deepEqual(h.eng.state().pendingPick.id, 'smg');
  assert.equal(h.eng.requestLoadout('secondary', 'none'), true);
  const r2 = h.reports.filter(x => x.k === 'loadout_request')[1];
  assert.deepEqual(r2.b, { player_id: 'p1', slot: 'secondary', kind: 'none' }, 'kind none carries no id and no try');
  assert.equal(h.eng.requestLoadout('primary', 'perk', 'body_armor'), false, 'primary is weapons only');
  assert.equal(h.eng.requestLoadout('secondary', 'perk', 'body_armor'), false, 'A14: perks have their own slot');
  assert.equal(h.eng.requestLoadout('perk', 'weapon', 'smg'), false, 'A14: only a perk goes in the perk slot');
  assert.equal(h.eng.requestLoadout('primary', 'none'), false, 'primary can never be empty');
  assert.equal(h.eng.requestLoadout('perk', 'none'), true, 'the perk slot can be emptied');
  assert.deepEqual(h.reports.filter(x => x.k === 'loadout_request').at(-1).b, { player_id: 'p1', slot: 'perk', kind: 'none' });
});

test('A10: policy is the lock — host/fixed/off slots and hud_select=false refuse locally, nothing reported', () => {
  const h = kitA10({ ...POL, primary: { choice: 'fixed', allowed_ids: ['assault_rifle'] }, secondary: { ...POL.secondary, choice: 'off' }, perk: { ...POL.perk, choice: 'host' } });
  assert.equal(h.eng.requestLoadout('primary', 'weapon', 'smg'), false);
  assert.equal(h.eng.requestLoadout('secondary', 'weapon', 'smg'), false);
  assert.equal(h.eng.requestLoadout('perk', 'perk', 'body_armor'), false); assert.equal(h.eng.state().canPickPerk, false);
  assert.equal(h.reports.filter(x => x.k === 'loadout_request').length, 0);
  assert.equal(h.eng.state().canPickPrimary, false);
  const h2 = kitA10({ ...POL, hud_select: false });
  assert.equal(h2.eng.canPick('primary'), false);
});

test('A10/A14: loadout_ack ok applies the echoed loadout (perk beside the weapons); reject keeps MC\'s loadout + surfaces the reason; tick() clears it after 4 s', () => {
  const h = kitA10();
  h.eng.requestLoadout('perk', 'perk', 'body_armor');
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'perk', ok: true, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], perk: 'body_armor' } } });
  let st = h.eng.state();
  assert.equal(st.pendingPick, null); assert.equal(st.loadoutAck.ok, true);
  assert.equal(st.loadout.perk.kind, 'perk'); assert.equal(st.loadout.perk.name, 'Body Armor'); assert.equal(st.loadout.perk.effects.max_armor_add, 50);
  assert.equal(st.loadout.secondary.weapon_id, 'smg', 'A14: the perk did not displace the second weapon');
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: false, reason: 'Host locked this slot', loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: 'body_armor' } } });
  st = h.eng.state();
  assert.equal(st.loadoutAck.ok, false); assert.equal(st.loadoutAck.reason, 'Host locked this slot');
  assert.equal(st.loadout.primary.weapon_id, 'assault_rifle', 'a reject reverts the optimistic pick to MC\'s echo');
  h.adv(4100); h.eng.tick();
  assert.equal(h.eng.state().loadoutAck, null, 'ack chip expires');
});

// ---------- A26 (S20): the try-out collapsed into selection (loadout.md §4.5, contracts A26) ----------
const picks = h => h.reports.filter(x => x.k === 'loadout_request').map(x => x.b);

test('A26: three taps inside the debounce window send ONE request, carrying the LAST id', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'assault_rifle');
  h.adv(100); h.eng.tick();
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  h.adv(100); h.eng.tick();
  h.eng.requestLoadout('primary', 'weapon', 'assault_rifle');
  h.adv(100); h.eng.tick();
  assert.equal(picks(h).length, 0, 'nothing sent while the thumb is still moving (300 ms of taps)');
  h.adv(400); h.eng.tick();
  assert.equal(picks(h).length, 1, 'the three taps coalesce into one request');
  assert.deepEqual(picks(h)[0], { player_id: 'p1', slot: 'primary', kind: 'weapon', id: 'assault_rifle', try: true }, 'the last row tapped is the one sent, and it arms');
});

test('A26 CONTROL: a tap AFTER the window is its own request (the coalescing is a window, not a one-shot)', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  h.adv(500); h.eng.tick();
  assert.equal(picks(h).length, 1);
  h.eng.requestLoadout('primary', 'weapon', 'assault_rifle');
  h.adv(500); h.eng.tick();
  assert.equal(picks(h).length, 2, 'a second, separate pick');
  assert.equal(picks(h)[1].id, 'assault_rifle');
});

test('A26: the row is ⟳ (pendingPick) from the tap until MC acks, then ✓ (equipped, nothing pending)', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  assert.equal(h.eng.state().pendingPick.id, 'smg', '⟳ the instant the row is tapped — before anything is on the wire');
  h.adv(400); h.eng.tick();
  assert.equal(h.eng.state().pendingPick.id, 'smg', 'still ⟳ while the request is in flight');
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
  const st = h.eng.state();
  assert.equal(st.pendingPick, null, '✓: MC acked, nothing is arming any more');
  assert.equal(st.loadout.primary.weapon_id, 'smg');
});

test('A26: a PERK equips on tap with no try and no debounce', () => {
  const h = kitA10();
  h.eng.requestLoadout('perk', 'perk', 'body_armor');
  assert.deepEqual(picks(h), [{ player_id: 'p1', slot: 'perk', kind: 'perk', id: 'body_armor' }], 'straight out, and no `try`');
});

test('A26: closing the browser and READY UP both flush a pick still inside the debounce window', () => {
  const h = kitA10();
  h.eng.browse(true);
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  h.adv(100);
  h.eng.browse(false);                       // REVIEW KIT ▸ / CLOSE
  assert.deepEqual(picks(h).map(p => p.id), ['smg'], 'leaving the rack commits the last pick');
  h.eng.requestLoadout('primary', 'weapon', 'assault_rifle');
  h.adv(100);
  h.eng.setReady(true);
  assert.deepEqual(picks(h).map(p => p.id), ['smg', 'assault_rifle'], 'READY UP commits the kit, debounce window or not');
});

// The A26 window is ONE slot wide and `pendingPick` moves with it, so a pick in a DIFFERENT slot used to
// destroy the one still queued: nothing reached MC, nothing logged, and the row kept its ⟳ for ever.
test('A26: a PRIMARY tap then a SECONDARY tap inside the window sends BOTH, in order — the second never eats the first', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  h.adv(300);                                        // still well inside the 400 ms window
  h.eng.requestLoadout('secondary', 'weapon', 'assault_rifle');
  assert.deepEqual(picks(h).map(p => [p.slot, p.id]), [['primary', 'smg']], 'switching rack COMMITS the primary at once');
  h.adv(400); h.eng.tick();
  assert.deepEqual(picks(h).map(p => [p.slot, p.id]), [['primary', 'smg'], ['secondary', 'assault_rifle']], 'and the secondary follows on its own debounce');
  assert.equal(picks(h)[0].try, true); assert.equal(picks(h)[1].try, true);
});

test('A26: a perk NONE behind a queued weapon pick does not swallow it (NONE sends immediately and used to null the window)', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  h.adv(100);
  h.eng.requestLoadout('perk', 'none');               // the perk tab's NONE chip — straight out, no debounce
  assert.deepEqual(picks(h).map(p => [p.slot, p.kind]), [['primary', 'weapon'], ['perk', 'none']], 'the weapon went first, then the NONE');
  h.adv(400); h.eng.tick();
  assert.equal(picks(h).length, 2, 'and the flushed weapon is not sent a second time');
});

test('A26 CONTROL: two taps in the SAME slot still coalesce (the flush is on the slot switch, not on every tap)', () => {
  const h = kitA10();
  h.eng.requestLoadout('secondary', 'weapon', 'smg');
  h.adv(100);
  h.eng.requestLoadout('secondary', 'weapon', 'assault_rifle');
  assert.equal(picks(h).length, 0, 'same rack, same thumb — still one request');
  h.adv(400); h.eng.tick();
  assert.deepEqual(picks(h).map(p => p.id), ['assault_rifle']);
});

test('A26: loadout_ack only answers ITS OWN slot — a perk ack never clears a weapon still arming', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  h.adv(500); h.eng.tick();                           // on the wire, ⟳ waiting on MC
  assert.equal(h.eng.state().pendingPick.slot, 'primary');
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'perk', ok: true, loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: 'body_armor' } } });
  const st = h.eng.state();
  assert.equal(st.pendingPick && st.pendingPick.slot, 'primary', 'the weapon is still arming — the perk ack was not about it');
  assert.equal(st.loadoutAck.key, null, 'and the ack chip does not key off a row it never answered');
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: false, reason: 'Host locked this slot', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] } } });
  const st2 = h.eng.state();
  assert.equal(st2.pendingPick, null, 'the primary ack retires the primary row');
  assert.equal(st2.loadoutAck.key, 'weapon:smg', 'and the refusal marks the row the player actually tapped');
});

test('A26: a try-out arriving while the browser is open does NOT take the screen (the rack stays, the row arms)', () => {
  const h = kitA10();
  h.eng.browse(true);
  h.eng.onMcMessage({ kind: 'tutorial', body: { frames: ['$WEAP,0,1,*'], weapon: { weapon_id: 'smg', name: 'SMG' } } });
  const st = h.eng.state();
  assert.equal(st.tutorial, true, 'the gun IS armed with the try-out');
  assert.equal(st.browsing, true, 'and the player is still in the rack, not on a takeover panel');
});

// ---------- A27/A30: the host locks kits under a player who is still kitting (loadout.md §4.4) ----------
test('A30: a lobby push while this player is mid-kit raises kit_locked_by_host and latches kitLocked', () => {
  const h = kitA10();
  h.eng.browse(true);
  h.eng.requestLoadout('primary', 'weapon', 'smg');     // queued in the debounce window
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: h.bundle, roster: h.roster } });
  const st = h.eng.state();
  assert.equal(st.phase, 'lobby');
  assert.equal(st.moment && st.moment.kind, 'kit_locked_by_host', 'never a silent screen swap');
  assert.equal(st.kitLocked, true, 'the lobby screen leads with it');
  assert.equal(st.browsing, false);
  assert.equal(picks(h).length, 0, 'the queued pick is dropped, not sent into a locked kit');
});

// The latch cleared on ONE edge only: `kit_open` going false→true. An MC that never sends `kit_open:false`
// (and an older MC with no `policy` at all) never gives that edge, so it survived into every later lobby
// and the screen read "THE HOST LOCKED KITS" for ever (review 2026-09-12).
test('A27: START retires the lock notice — the countdown spends it, with no kit_open edge needed', () => {
  const h = kitA10();
  h.eng.browse(true);
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: h.bundle, roster: h.roster } });
  assert.equal(h.eng.state().kitLocked, true, 'the lock is raised (policy here never sends kit_open, so there is no edge to clear it)');
  h.echo(); h.start(9000);
  assert.equal(h.eng.phase, 'armed');
  assert.equal(h.eng.state().kitLocked, false, 'the notice belongs to the lobby it was raised in');
});

test('A27: a new match from MC retires the lock notice from the match-complete screen', () => {
  const h = kitA10();
  h.eng.browse(true);
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: h.bundle, roster: h.roster } });
  h.echo(); h.start(0); h.adv(10); h.eng.tick();
  assert.equal(h.eng.phase, 'live');
  h.adv(600000); h.eng.tick();                       // the clock runs out
  assert.equal(h.eng.state().ended, true);
  h.eng.kitLocked = true;                            // a latch that outlived its lobby by any route reaches here
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, catalog: CAT, policy: POL } });
  assert.equal(h.eng.state().ended, false, 'the new match leaves the match-complete screen');
  assert.equal(h.eng.state().kitLocked, false, 'and takes last match\'s lock notice with it');
});

// F133: a host who locks the kit, never starts, and pushes a NEW game spent none of the other retirements, so the
// next lobby still led with THE HOST LOCKED KITS. The latch now carries the config_id it was raised for.
test('F133: a push of another game retires the lock notice; the same game keeps it', () => {
  const h = kitA10();
  h.eng.browse(true);
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: h.bundle, roster: h.roster } });
  assert.equal(h.eng.state().kitLocked, true, 'control: the lock is raised for this game');
  h.eng.onMcMessage({ kind: 'config', body: { config: { ...h.config }, frames: h.bundle, roster: h.roster } });
  assert.equal(h.eng.state().kitLocked, true, 'the same config_id again (a reconnect, a repeat) keeps the notice');
  h.eng.onMcMessage({ kind: 'config', body: { config: { ...h.config, config_id: 'another-game' }, frames: h.bundle, roster: h.roster } });
  assert.equal(h.eng.state().kitLocked, false, 'a new game in the lobby does not lead with the old lock');
});

test('A30 CONTROL: a player who had already readied up gets no lock notice (they asked for the advance)', () => {
  const h = kitA10();
  h.eng.setReady(true);
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: h.bundle, roster: h.roster } });
  const st = h.eng.state();
  assert.equal(st.phase, 'lobby');
  assert.equal(st.kitLocked, false);
  assert.ok(!st.moment || st.moment.kind !== 'kit_locked_by_host');
});

// F-4 (2026-09-13). `_applyConfig` has always moved a player to 'lobby' on ANY config, ready or not —
// `setReady` used to refuse everywhere but 'kitted', so a player whose kit-out window closed before
// they ever tapped READY UP (a push or re-push that landed mid-kit) had no way left to ready for this
// match. Least-surprise fix: a re-push while `ready` was already true KEEPS it true (re-ack, never
// un-ready — mirrors mcp/tests/test_mc_polish.py's server-side proof of the same rule), and `setReady`
// now also accepts a LOBBY tap once the kit is closed (`!kitOpen()`, the same flag MC's own
// `_sync_kit_open` flips false around a push).
test('F-4: a config push keeps `ready` true — the first push and a re-push both', () => {
  const h = kitA10();
  h.eng.setReady(true);
  assert.equal(h.eng.state().ready, true);
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: h.bundle, roster: h.roster } });
  assert.equal(h.eng.phase, 'lobby');
  assert.equal(h.eng.state().ready, true, 'the first push does not un-ready a player who had already readied');
  // a re-push: a fresh config_id, same as a host edit re-pushing over an already-pushed lobby
  const cfg2 = { ...h.config, config_id: 'cfg_2' };
  h.eng.onMcMessage({ kind: 'config', body: { config: cfg2, frames: h.bundle, roster: h.roster } });
  assert.equal(h.eng.phase, 'lobby');
  assert.equal(h.eng.state().ready, true, 'a re-push keeps ready true — re-ack the config, never un-ready');
});

test('F-4: READY UP works from the lobby once the kit is closed, and still refuses while it is open', () => {
  const h = kitA10();
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: h.bundle, roster: h.roster } });
  assert.equal(h.eng.phase, 'lobby');
  // control: this harness's policy never sent kit_open:false, so the kit reads open by default
  assert.equal(h.eng.kitOpen(), true, 'control: kit_open was never sent false');
  assert.equal(h.eng.setReady(true), false, 'the lobby exception is scoped to a CLOSED kit only');
  assert.equal(h.eng.state().ready, false);
  // MC's `_sync_kit_open` re-sends `assign` with kit_open:false around a push — mirrored here
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, catalog: CAT, policy: { ...POL, kit_open: false } } });
  assert.equal(h.eng.phase, 'lobby', 'still lobby — only the policy flag changed');
  assert.equal(h.eng.setReady(true), true, 'now accepted: kitted-or-lobby, kit closed');
  assert.equal(h.eng.state().ready, true);
  assert.equal(h.eng.setReady(false), true, 'and it un-readies the same way the kitted screen does');
  assert.equal(h.eng.state().ready, false);
});

test('A30: the server refusal reason is kept verbatim for the kit screen to print', () => {
  const h = kitA10();
  h.eng.requestLoadout('primary', 'weapon', 'smg');
  h.adv(400); h.eng.tick();
  const reason = 'THE MATCH HAS STARTED — YOUR KIT IS LOCKED UNTIL THE NEXT ONE';
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: false, reason, loadout: { weapons: [{ weapon_id: 'assault_rifle' }] } } });
  const st = h.eng.state();
  assert.equal(st.loadoutAck.ok, false);
  assert.equal(st.loadoutAck.reason, reason, 'MC wrote the copy; the node does not paraphrase it');
});

test('A14: conflictFor names what an ALT-button pick would drop; the ack\'s `dropped` is kept on the verdict', () => {
  const h = kitA10();
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'secondary', ok: true, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] } } });
  assert.deepEqual(h.eng.conflictFor('perk', 'perk', 'easy_reload'), { slot: 'secondary', id: 'smg', name: 'SMG' }, 'Easy Reload over a loaded SMG drops the SMG');
  assert.equal(h.eng.conflictFor('perk', 'perk', 'body_armor'), null, 'a perk that leaves ALT alone drops nothing');
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'perk', ok: true, dropped: { slot: 'secondary', id: 'smg', name: 'SMG' }, reason: 'Easy Reload takes the ALT button — SMG dropped', loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: 'easy_reload' } } });
  let st = h.eng.state();
  assert.equal(st.loadout.secondary, null); assert.equal(st.loadout.perk.perk_id, 'easy_reload');
  assert.deepEqual(st.loadoutAck.dropped, { slot: 'secondary', id: 'smg', name: 'SMG' }); assert.equal(st.loadoutAck.ok, true);
  assert.deepEqual(h.eng.conflictFor('secondary', 'weapon', 'smg'), { slot: 'perk', id: 'easy_reload', name: 'Easy Reload' }, 'a second weapon over Easy Reload drops the perk');
  assert.equal(h.eng.conflictFor('primary', 'weapon', 'smg'), null);
  assert.equal(h.eng.conflictFor('perk', 'none', null), null);
});

test('S52: Easy Reload override reaches the HUD view and warns before a secondary pick', () => {
  const h = kitA10();
  h.player.loadout.overrides = { easy_reload: true };
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, catalog: CAT, policy: POL } });
  const st = h.eng.state();
  assert.equal(st.loadout.overrides.easy_reload, true, 'screen state carries the accessibility override');
  assert.deepEqual(h.eng.conflictFor('secondary', 'weapon', 'smg'),
    { slot: 'accessibility', id: 'easy_reload', name: 'Easy Reload' },
    'picker identifies the ALT conflict before sending the request');
});

test('S52: slot-scoped loadout ack preserves an omitted Easy Reload override', () => {
  const h = kitA10();
  h.player.loadout.overrides = { easy_reload: true };
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'primary', ok: true, loadout: { weapons: [{ weapon_id: 'smg' }] } } });
  assert.equal(h.eng.state().loadout.overrides.easy_reload, true);
});

test('S52: HUD renders the Easy Reload instruction during a non-idle phase', () => {
  const fake = { chips: { innerHTML: '' }, mcPill: false };
  Hud.prototype._chips.call(fake, { phase: 'kitted', loadout: { overrides: { easy_reload: true } }, wsState: 'bound' });
  assert.match(fake.chips.innerHTML, /ALT = RELOAD/);
});

test('A10: a secondary WEAPON shows in slot 2; weaponName never breaks with one weapon; unanswered pick expires', () => {
  const h = kitA10();
  h.eng.onMcMessage({ kind: 'loadout_ack', body: { slot: 'secondary', ok: true, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] } } });
  const st = h.eng.state();
  assert.equal(st.loadout.secondary.kind, 'weapon'); assert.equal(st.loadout.secondary.weapon_id, 'smg');
  h.eng.activeSlot = 1; assert.equal(h.eng.weaponName, 'SMG');
  h.eng.activeSlot = 3; assert.equal(h.eng.weaponName, 'ASSAULT RIFLE', 'unknown slot falls back to the primary');
  h.eng.requestLoadout('primary', 'weapon', 'smg'); h.adv(6100); h.eng.tick();
  assert.equal(h.eng.state().pendingPick, null, 'MC never answered → optimistic row dropped');
});

test('A10: browse(open) reports loadout_browse once per transition; DONE on a try-out hides the panel until the next try-out', () => {
  const h = kitA10();
  h.eng.browse(true); h.eng.browse(true); h.eng.browse(false);
  const b = h.reports.filter(x => x.k === 'loadout_browse').map(x => x.b.open);
  assert.deepEqual(b, [true, false]);
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'smg', name: 'SMG' }, frames: ['$START,*'] } });
  assert.equal(h.eng.state().tryoutSeen, null);
  h.eng.dismissTryout(); assert.equal(h.eng.state().tryoutSeen, 'smg');
  h.eng.onMcMessage({ kind: 'tutorial', body: { weapon: { weapon_id: 'shotgun', name: 'Shotgun' }, frames: ['$START,*'] } });
  assert.equal(h.eng.state().tryoutSeen, null, 'a fresh try-out shows its panel again');
});

test('A10: catalog + policy survive a persisted reload and a welcome re-hydrate', () => {
  const h = kitA10();
  const store = h.eng.storage;
  const e2 = new Engine({ writer: () => {}, now: () => 1_000_500, synced: () => true, storage: store, log: () => {} });
  assert.equal(e2.catalog.weapons.length, 3); assert.equal(e2.policy.hud_select, true);
  e2.hydrate({ player: h.player, catalog: { weapons: [], perks: [] }, policy: { ...POL, hud_select: false } });
  assert.equal(e2.policy.hud_select, false); assert.equal(e2.catalog.weapons.length, 0);
});


test('A10 §4.1/§4.6: kit_open false → setting-up (no picks); flip true → BRIEFING until BUILD MY KIT; assign.game reaches state', () => {
  const GAME = { name: 'Silenced Sniper', mode: 'ffa', abbr: 'FFA', loadout_line: 'Everyone carries the Sniper Rifle.', ruleset: 'CUSTOM RULES', hud_select: true };
  const h = kitA10({ ...POL, kit_open: false });
  let st = h.eng.state();
  assert.equal(st.kitOpen, false); assert.equal(st.canPickPrimary, false, 'no picks while MC is setting up');
  assert.equal(h.eng.requestLoadout('primary', 'weapon', 'smg'), false);
  assert.equal(h.reports.filter(x => x.k === 'loadout_request').length, 0);
  h.eng.closeBriefing();                                    // a stale "seen" from an earlier game must not skip the new briefing
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: null, roster: [], policy: { ...POL, kit_open: true }, game: GAME } });
  st = h.eng.state();
  assert.equal(st.kitOpen, true); assert.equal(st.briefSeen, false, 'kit just opened → BRIEFING shows'); assert.equal(st.game.name, 'Silenced Sniper');
  assert.ok(st.canPickPrimary, 'picks allowed once the kit is open');
  h.eng.closeBriefing(); assert.equal(h.eng.state().briefSeen, true);
  h.eng.openBriefing(); assert.equal(h.eng.state().briefSeen, false, 'BRIEFING button reopens it');
  h.eng.closeBriefing();
  // MC goes back to setting up (host returned to GAMES): browser closes, no picks; re-opening shows the briefing again
  h.eng.browse(true);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: null, roster: [], policy: { ...POL, kit_open: false }, game: GAME } });
  assert.equal(h.eng.state().browsing, false); assert.equal(h.eng.state().canPickPrimary, false);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: null, roster: [], policy: { ...POL, kit_open: true }, game: GAME } });
  assert.equal(h.eng.state().briefSeen, false);
});

test('A10 §4.1: a policy without kit_open (older MC) leaves the kit open', () => {
  const h = kitA10(POL);
  assert.equal(h.eng.state().kitOpen, true); assert.ok(h.eng.canPick('primary'));
});

// ── ALT weapon swap indicator (field 2026-08-30; hardened after review 2026-08-31) ──────────────
function twoWeapons(h) {
  h.eng.player = { ...h.eng.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'shotgun' }] } };
  return h;
}

test('ALT raises the swap indicator only with a real second weapon', () => {
  const h = goLive(harness());
  h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switching, false, 'single-weapon loadout, no easy_reload: ALT is not a swap');
  twoWeapons(h).frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switching, true);
});

test('the indicator EXPIRES without inventing a slot the gun never reported', () => {
  // $BUT,1 is "alt-fire" — it is also the native 3s indoor/outdoor toggle and easy_reload remaps it to
  // RELOAD, so a press is not proof a weapon changed. Guessing a slot showed the WRONG gun and the
  // wrong magazine until the next trigger pull (review 2026-08-31).
  const h = twoWeapons(goLive(harness()));
  h.frame('$ALCD,32,100,0,192,0,*');
  h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switching, true);
  h.adv(5000);
  const st = h.eng.state();
  assert.equal(st.switching, false, 'indicator cleared');
  assert.equal(st.activeSlot, 0, 'slot still what the GUN last reported — never guessed');
  assert.equal(st.ammo, 32, 'ammo still the slot the gun reported');
});

test('switchingMs() is pure — reading state never mutates it', () => {
  const h = twoWeapons(goLive(harness()));
  h.frame('$BUT,1,1,*');
  h.adv(9999);
  const before = h.eng.activeSlot;
  for (let i = 0; i < 5; i++) h.eng.state();
  assert.equal(h.eng.activeSlot, before, 'snapshot() must not move the slot');
});

test('an $ALCD on a new weapon slot confirms the swap; melee (slot 4) does not', () => {
  const h = twoWeapons(goLive(harness()));
  h.frame('$ALCD,32,100,0,192,0,*');
  h.frame('$BUT,1,1,*');
  h.adv(300); h.frame('$ALCD,1,100,4,0,0,*');            // melee reports on its own $ALCD
  assert.equal(h.eng.state().switching, true, 'slot 4 is melee, not the swap we awaited');
  h.adv(200); h.frame('$ALCD,6,100,1,24,0,*');           // the real secondary
  const st = h.eng.state();
  assert.equal(st.switching, false);
  assert.equal(st.activeSlot, 1);
  assert.equal(st.ammo, 6, 'ammo follows the confirmed slot');
  assert.ok(h.eng.lastSwitchMs >= 500, 'records ALT -> confirming shot (includes reaction time)');
});

test('death clears the swap indicator', () => {
  const h = twoWeapons(goLive(harness()));
  h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switching, true);
  h.frame('$HIR,4,0,19,2,24,0,0,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.state().switching, false, 'indicator must not outlive the player');
});

// ── victim-side low-health alert (capture 2026-08-23-two-tagger-combat, decoded 2026-09-01) ──────
test('A17.2 the low-health alert fires on an HP THRESHOLD, not when armour runs out', () => {
  // Tony, bench 2026-09-07: "low_health shouldn't be used there. it should be used when total hp is
  // under 20". The old condition (armour 0 AND any HP lost) fired on the FIRST health hit of a life --
  // at 44/45 HP if that is where you were -- so an alert named "low health" meant "your armour failed".
  // A17 made it impossible to ignore rather than causing it: health hits are silent from the gun now,
  // so this alert became the ONLY sound on the armour->health transition and read as the hit sound.
  const h = goLive(harness());
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,16,0,*');   // armour still up
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 0, 'armour up: no alert');
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,43,0,0,*');    // armour GONE but 43 HP: still healthy
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 0, 'armour gone at 43 HP is NOT low health');
  h.frame('$HIR,4,0,19,2,25,0,0,*'); h.frame('$HP,16,0,0,*');   // hurt, but not under 15 yet
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 0, '16 HP is not under the threshold');
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,14,0,0,*');    // under 15: NOW it fires
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 1, 'alert at 14 HP');
  assert.equal(h.writes.filter(f => f.includes('$HLED,7,4')).length, 1, 'headset lights with it');
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,8,0,0,*');
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 1, 'once per life, not per hit');
});

test('F47: an explicit max_armor of 0 is a NO-ARMOUR loadout, not 70 -- and it still gets its low-health warning', () => {
  // A17.2 dropped the old `maxArmor > 0` guard; this is the test it could not write while `get maxArmor()` was
  // `(config.health.max_armor) || 70` (an explicit 0 became 70, so the guard had been dead code all along).
  // F213: `maxArmor` now reads the head's own `$PSET` first (compile.py always derives it FROM
  // `config.health`/overrides, so the two never disagree in production) -- the bundle is updated
  // alongside `config.health` here to keep matching what a real compile would produce.
  const h = harness(); h.config.health.max_armor = 0; h.bundle.head = withPool(h.bundle.head, 45, 0);
  h.kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  assert.equal(h.eng.maxArmor, 0); assert.equal(h.eng.armor, 0, 'spawned with no armour');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,12,0,0,*');
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 1, 'under 15 HP with no armour ever: the alert fires');
  // CONTROL: no $PSET on the head at all falls back to config.health (absent -> 70 default, positive -> itself).
  const d = harness(); delete d.config.health.max_armor; d.bundle.head = d.bundle.head.filter(f => !f.startsWith('$PSET,'));
  d.kit().config_().echo().start(0);
  assert.equal(d.eng.maxArmor, 70);
  const p = harness(); p.config.health.max_armor = 30; p.bundle.head = p.bundle.head.filter(f => !f.startsWith('$PSET,'));
  p.kit().config_().echo().start(0);
  assert.equal(p.eng.maxArmor, 30);
});

test('A17.2 a ZERO-damage $HP frame under the threshold does not trip the alert', () => {
  // The mirrors had diverged: stage.py imposes `dmg > 0` structurally (its check is nested inside
  // `if dmg > 0`), engine.js did not. So a heal/regen tick or a plain frame resend that merely LEFT you
  // under 15 could fire the alert on the phone and never in the console -- and a heal is the opposite of
  // the news this alert carries. Found by review 2026-09-07; neither side tested dmg === 0 with hp < 15.
  const h = goLive(harness());
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,10,0,*');   // armour only, still healthy
  h.writes.length = 0;
  h.frame('$HP,12,0,0,*');                                       // a resend/heal landing under 15, dmg 0? no:
  // that frame DID lose pools (45+10 -> 12), so it is damage and SHOULD fire. Prove that first:
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 1, 'a damaging drop under 15 fires');
  // now a genuine zero-damage frame at the same HP on a fresh life
  const h2 = goLive(harness());
  h2.frame('$HIR,4,0,19,2,9,0,0,*'); h2.frame('$HP,45,10,0,*');
  h2.frame('$HP,12,0,0,*');                                      // fires here
  h2.eng._spawn(false);                                          // new life re-arms the latch
  h2.writes.length = 0;
  h2.frame('$HP,12,0,0,*');                                      // pools UNCHANGED from spawn? they dropped -> damage
  h2.writes.length = 0;
  h2.frame('$HP,12,0,0,*');                                      // identical resend: dmg === 0
  assert.equal(h2.writes.filter(f => f === golden.cues.hurt).length, 0, 'a zero-damage resend must not fire');
});

test('a respawn re-arms the low-health alert', () => {
  const h = goLive(harness());
  h.frame('$HP,12,0,0,*');
  h.writes.length = 0;
  h.frame('$HP,0,0,0,*');                                        // dead
  h.eng._spawn(false);                                           // back on your feet
  h.frame('$HP,12,0,0,*');
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 1, 'a new life gets a new alert');
});

// ── F149 (field 2026-09-12): a death must stop a still-playing low-health loop ────────────────────
test('F149: a death that follows a low-health alert stops the loop with $PLAYX,0,*', () => {
  // The realistic field shape: one hit crosses under 15 HP (fires `cues.hurt`, a several-second voice
  // sample), a SEPARATE later hit finishes the kill. `cues.died` is never populated (A15.3: the scream
  // stays native), so nothing else would ever interrupt the sample -- the loop played on past the death.
  const h = goLive(harness());
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,12,0,0,*');       // under 15: the alert fires
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 1, 'sanity: the loop did start');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,0,0,0,*');        // a later, separate hit finishes the kill
  assert.equal(h.writes.filter(f => f === PLAYX).length, 1, 'death sends the stop-playback frame');
});

test('F149: an ordinary death (never under 15 HP) sends no extra stop frame', () => {
  // The guard is scoped to hurtFired, not to every death -- a death with no alert this life must not
  // grow a new BLE write on every single kill.
  const h = goLive(harness());
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,0,0,0,*');        // straight to zero, one hit, alert never armed
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 0, 'control: the alert never fired');
  assert.equal(h.writes.filter(f => f === PLAYX).length, 0, 'so death sends nothing extra');
});

// ── office test 2026-09-19 (Pixel 4/5): the killing hit landed inside the debounce window ─────────
test('office test 2026-09-19: a death that lands inside HURT_DEBOUNCE_MS cancels the alert outright -- it never reaches the gun', () => {
  const pending = [];   // {ms, fn}, run by hand instead of firing at once
  const h = goLive(harness({ delay: (ms, fn) => pending.push({ ms, fn }) }));
  h.writes.length = 0; pending.length = 0;   // goLive's own spawn/flash steps use `delay` too -- only the alert's matters here
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,12,0,0,*');        // under 15: the alert is scheduled, not sent
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 0, 'still debounced -- nothing on the wire yet');
  const alert = pending.find(p => p.ms === 400); assert.ok(alert, 'the alert was scheduled at HURT_DEBOUNCE_MS');
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,0,0,0,*');          // the killing hit lands within the window
  assert.equal(h.writes.filter(f => f === PLAYX).length, 0, 'nothing was ever sent, so there is nothing to stop');
  alert.fn();   // the debounce timer finally fires, after the death
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 0, 'cancelled -- the queued alert must not play after death');
});

test('office test 2026-09-19: a death that lands AFTER the debounce has already fired still gets the $PLAYX stop', () => {
  const pending = [];
  const h = goLive(harness({ delay: (ms, fn) => pending.push({ ms, fn }) }));
  h.writes.length = 0; pending.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,12,0,0,*');
  const alert = pending.find(p => p.ms === 400); assert.ok(alert);
  alert.fn();   // the debounce elapses first -- the alert really did reach the gun
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 1, 'sanity: it played');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.writes.filter(f => f === PLAYX).length, 1, 'past the window, the existing F149 stop still fires');
});

// ── review 2026-09-19: a queued low-health alert must not survive match end/teardown/panic ────────
test('a match end inside the debounce window cancels the queued low-health alert', () => {
  const pending = [];
  const h = goLive(harness({ delay: (ms, fn) => pending.push({ ms, fn }) }));
  h.writes.length = 0; pending.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,12,0,0,*');        // under 15: the alert is scheduled, not sent
  const alert = pending.find(p => p.ms === 400); assert.ok(alert, 'the alert was scheduled at HURT_DEBOUNCE_MS');
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });     // the match ends while the alert is still queued
  h.writes.length = 0;                                              // ignore the end/teardown writes themselves
  alert.fn();                                                       // the debounce timer finally fires, after the end
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 0, 'a stray low-health write must not land on an ended match');
});

test('a panic inside the debounce window cancels the queued low-health alert', () => {
  const pending = [];
  const h = goLive(harness({ delay: (ms, fn) => pending.push({ ms, fn }) }));
  h.writes.length = 0; pending.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,12,0,0,*');
  const alert = pending.find(p => p.ms === 400); assert.ok(alert, 'the alert was scheduled at HURT_DEBOUNCE_MS');
  h.eng.control({ cmd: 'panic' });                                  // the operator panics while the alert is still queued
  h.writes.length = 0;
  alert.fn();
  assert.equal(h.writes.filter(f => f === golden.cues.hurt).length, 0, 'a stray low-health write must not land after panic teardown');
});

// ── empty-mag state, replayed at the REAL cadence (capture 2026-08-26-weapons-smg-plus-amr) ──────
test('emptying a mag leaves ammo 0 and the low-mag prompt armed', () => {
  // The gun sends one $ALCD per shot all the way down to 0 and then nothing on a dry trigger — proven
  // in the SMG capture (9,8,7…1,0 at ~350ms, then $BUT with no $ALCD). Field 2026-08-30 showed no
  // reload prompt and no empty state on the phone, so this pins the two layers we control.
  const h = goLive(harness());
  h.frame('$LCD,45,70,0,0,32,192,*');
  for (let mag = 31; mag >= 0; mag--) {
    h.adv(140); h.frame('$BUT,0,1,*'); h.frame(`$ALCD,${mag},100,0,192,0,*`); h.frame('$BUT,0,0,*');
  }
  const st = h.eng.state();
  assert.equal(st.ammo, 0, 'the engine sees the empty magazine');
  assert.equal(st.mag, 32, 'and keeps the right denominator');
  // the two values hud.js derives the RELOAD prompt and the solid/red empty state from
  assert.ok(st.alive && st.mag && st.ammo < st.mag && st.ammo / st.mag <= 0.15, 'lowMag is armed');
  // a dry trigger after empty must not move anything
  h.adv(140); h.frame('$BUT,0,1,*'); h.frame('$BUT,0,0,*');
  assert.equal(h.eng.state().ammo, 0);
});

test('a hit forwards WHICH sensor caught it', () => {
  // $HIR tok1: 0 = headset FRONT dome, 1 = headset BACK, 4 = gun body. Answering "do the headset
  // domes ever register?" needed the phone's raw frame ring because this field was dropped here.
  const h = goLive(harness());
  h.frame('$HIR,0,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,52,0,*');
  const hits = h.facts.filter(f => f.type === 'hit_taken');
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map(f => f.sensor), [0, 4], 'headset dome then gun body');
});

// ── headset team colour survives hits (bench 2026-09-03: a registered hit WIPES the headset) ─────
test('A11.6 headset: white flash at the whistle then dark; hit flash then dark; respawn flash; carrier blink on the flag alert', () => {
  const h = goLive(harness());
  // default hit is NATIVE (hit: []) since the 2026-09-04 ladder; this test opts into a red flash to exercise the path
  h.eng.frames.headset = { ...golden.headset, hit: [['$HLED,0,2,100,100,10,2,*', 0.5], [golden.headset.rest, 0.0]] };
  const hs = h.eng.frames.headset;
  assert.equal(hs.in_play, 'dark');
  // the spawn wrote the start flash and then the rest (dark) frame — harness delays run inline
  const startFrames = hs.start.map(x => x[0]);
  for (const f of startFrames) assert.ok(h.writes.includes(f), 'start frame missing: ' + f);
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');          // a hit: flash then rest
  assert.deepEqual(h.writes.filter(f => f.startsWith('$HLED')), hs.hit.map(x => x[0]));
  h.writes.length = 0;
  h.frame('$HP,45,61,0,*');                                              // no damage: nothing
  assert.equal(h.writes.filter(f => f.startsWith('$HLED')).length, 0);
  // A17.2: the alert now needs HP UNDER 15, not merely "armour gone" -- 43 HP with no armour is not low.
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,14,0,0,*');           // low-health alert wins over the hit flash
  assert.equal(h.writes.filter(f => f.includes('$HLED,7,4')).length, 1);
  assert.ok(!h.writes.includes(hs.hit[0][0]), 'no hit flash on the alert hit');
  // carrier: MC says this player took the flag of team 2 -> a WHITE blink (headset.role.carrier is flat now
  // -- team colours are identity, §3.3; the flag's own tid no longer picks the colour); a hit keeps it; scoring ends it
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'objective_taken', text: 'FLAG TAKEN', player_id: 'p1', carrier: 'p1', flag_tid: 2, t: h.eng.now() }, t: h.eng.now() });
  assert.ok(h.writes.includes(hs.role.carrier[0][0]), 'carrier blink, white (identity stays with the team colour elsewhere)');
  h.writes.length = 0;
  h.adv(1100);   // A16 §C: the role re-assert shares the 1 s headset flash gate with the hit flash above
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,10,0,0,*');   // A17.2: HP is 14 here, so this must go DOWN to be a hit
  assert.ok(h.writes.includes(hs.role.carrier[0][0]) && !h.writes.includes(hs.hit[0][0]), 'the flag blink survives a hit');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'objective_scored', text: 'FLAG CAPTURED', player_id: 'p1', carrier: 'p1', t: h.eng.now() }, t: h.eng.now() });
  assert.deepEqual(h.writes.filter(f => f.startsWith('$HLED')), [hs.rest], 'scored -> back to rest');
  // death: paint the out-blink the bundle carries (default is now the green slow-blink — A11.6, presentation.py);
  // respawn: white flash then rest
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  assert.deepEqual(h.writes.filter(f => f.startsWith('$HLED')), hs.death.map(x => x[0]), 'death paints the headset out-blink');
  h.adv(9000); h.writes.length = 0; h.eng.tick();                      // the auto respawn (delay 8 s) fires in this tick
  for (const f of hs.respawn.map(x => x[0])) assert.ok(h.writes.includes(f), 'respawn frame missing: ' + f);
});

test('A11.6 headset in_play=team: the rest frame is the team colour and a hit restores it after the flash', () => {
  const h = harness();
  const teamRest = '$HLED,1,0,,,10,,*';
  const bundle = { ...h.bundle, headset: { ...golden.headset, in_play: 'team', rest: teamRest,
    start: [[golden.headset.start[0][0], 0.6], [teamRest, 0]], hit: [['$HLED,0,2,100,100,10,2,*', 0.5], [teamRest, 0]], respawn: [[golden.headset.respawn[0][0], 0.6], [teamRest, 0]] } };
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: bundle, roster: h.roster } });
  h.eng.feedFrame('$LCD,0,0,0,0,0,0,*'); h.start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  assert.equal(h.writes.filter(f => f === teamRest).length >= 1, true, 'start ends on the team colour');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  const hled = h.writes.filter(f => f.startsWith('$HLED'));
  assert.equal(hled[hled.length - 1], teamRest, 'after the hit flash the headset returns to the team colour');
});

test('F68: a life with NO hits at all still gets its team colour repainted, on a throttled interval', () => {
  // S42 bench 2026-09-17: an accuracy-model miss sends no $HIR and no $HP -- the hit-driven repaint in
  // `_onHp` has nothing to react to, so this proves the periodic repaint is what survives it, simulating
  // exactly that: a whole life with zero incoming $HIR/$HP frames.
  const h = harness();
  const teamRest = '$HLED,1,0,,,10,,*';
  const bundle = { ...h.bundle, headset: { ...golden.headset, in_play: 'team', rest: teamRest,
    start: [[golden.headset.start[0][0], 0.6], [teamRest, 0]] } };
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: bundle, roster: h.roster } });
  h.eng.feedFrame('$LCD,0,0,0,0,0,0,*'); h.start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.writes.length = 0;
  // Just under one interval, ticked repeatedly (never a single tick() call): nothing repaints yet.
  // F68 × A11.6 (merge 2026-09-17): the strip has ONE owner, and the spawn flash was this life's first
  // paint -- so the backstop clock runs from the SPAWN, not from the first tick after it. Re-stamp it here
  // so the interval below is measured from a point this test names, not from the harness's spawn timing.
  h.eng._lastTeamRepaintAt = h.eng.now();
  h.adv(TEAM_REPAINT_MS - 1); h.eng.tick(); h.eng.tick(); h.eng.tick();
  assert.equal(h.writes.filter(f => f === teamRest).length, 0, 'too early for the first repaint');
  // Crossing the interval: exactly one repaint, not one per tick() call in between.
  h.adv(1); h.eng.tick(); h.eng.tick(); h.eng.tick();
  assert.equal(h.writes.filter(f => f === teamRest).length, 1, 'one repaint at the interval, not three for three ticks');
  h.writes.length = 0;
  // A second interval: another repaint, still with zero $HIR/$HP frames anywhere in this life.
  h.adv(TEAM_REPAINT_MS); h.eng.tick();
  assert.equal(h.writes.filter(f => f === teamRest).length, 1, 'the repaint keeps firing every interval with no hits at all');
});

// ---------- S42/F259/S54: node-driven recoil (the accuracy ceiling/floor is ours, not the gun's) ----------
// `armRecoil` mirrors `goLive`: a fresh life on a single-weapon catalog carrying the `recoil` block the
// test wants, ending on the same $LCD baseline `goLive` uses (establishes `_prevAmmo[0]` at mag 36 with
// nothing counted as a shot yet -- the first $ALCD of a life is a baseline, never a decrement).
// S54: the derivation also needs the row's `dmg` (rounds per trigger pull, scaled by calibre), so every
// weapon here carries the reference damage (8, `RECOIL_REF_DMG`) unless a test asks for a different one --
// that is the same `dmg` the shipping Assault Rifle/SMG/Energy Rifle carry, so `RECOIL_PROFILE` below
// degrades and goes heavy at exactly the round counts those weapons do.
function armRecoil(recoil, { recoilConfig, dmg = 8 } = {}) {
  const h = harness();
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster,
    catalog: { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', clip: 32, reserve: 384, reload_s: 1.4, dmg, recoil }], perks: [] } } });
  if (recoilConfig !== undefined) h.config.recoil = recoilConfig;   // same object `config_()` sends -- mutate in place
  h.config_().echo().start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  // Merge 2026-09-17: the SPAWN write owns `$AMMO` for ACC_HOLD_MS (`_holdAccuracyWrites`), so the accuracy
  // writer is deliberately silent at the very start of a life. Step past that window, and re-stamp the F68
  // backstop clock, so every test below measures the writer itself and not the hold. The hold has its own
  // tests ("S42 x A44/A47/F15" further down).
  h.adv(ACC_HOLD_MS + 10); h.eng.tick(); h.eng._lastTeamRepaintAt = h.eng.now();
  h.mag = 36;   // the magazine the FAKE gun below is holding, kept in step with the $ALCD frames the tests feed
  return h;
}
// F259: the ladder block the catalogue still ships, and the state shape `_recoilProfile` derives from it
// -- crisp 100 (the ceiling), heavy 20 (the floor), degraded 60 (halfway). S54: at `armRecoil`'s default
// dmg 8 (`RECOIL_REF_DMG`, the same calibre as the shipping Assault Rifle/SMG/Energy Rifle), the first
// rung lands on round 6 and the second on round 9 -- the exact numbers those three weapons ship with,
// settle RECOIL_SETTLE_MIN_MS (`recover_ms` 150 is far below that floor).
const RECOIL_PROFILE = { ceiling: 100, floor: 20, per_shot: 40, recover_ms: 150 };
const DEGRADE_AFTER = 6, HEAVY_AFTER = 9, SETTLE_MS = RECOIL_SETTLE_MIN_MS;
// F259 step 2 (Tony, bench 2026-09-18): "normal degraded and very degraded". The SHIPPING assault rifle
// as the catalogue owner declares it, outright rather than derived -- the same row `_recoilProfile`
// derives from that weapon's old ladder, so the two paths are checked against each other below.
const TWO_STEP = { crisp: 100, degraded: 85, heavy: 70, after_shots: 3, after_heavy: 6, settle_ms: RECOIL_SETTLE_MIN_MS };
const TWO_STEP_AFTER = 3, TWO_STEP_HEAVY_AFTER = 6;

const rawWeaps = h => h.writes.filter(f => f.startsWith('$WEAP,0,'));
const ammos = h => h.writes.filter(f => f.startsWith('$AMMO,0,'));
const accuracyTmps = h => h.writes.filter(f => f.startsWith('$TMP,') && f.split(',')[4] !== '');
// Compatibility projection for the older ladder assertions: expose each real t4 target at the indices
// those value-only tests already inspect. Dedicated S55 tests above/below assert the actual frame and prove
// no `$WEAP` or `$AMMO` escaped; this helper is never wire truth.
const weaps = h => accuracyTmps(h).map(f => {
  const value = 100 + Number(f.split(',')[4]);
  const p = Array(24).fill(''); p[0] = '$TMP'; p[22] = String(value); p[23] = String(value);
  return p.join(',');
});

test('S55 red: recoil has one t4 owner and never rewrites the weapon or its ammunition', () => {
  const h = armRecoil(RECOIL_PROFILE);
  h.writes.length = 0;
  fire(h, DEGRADE_AFTER);
  assert.deepEqual(accuracyTmps(h), ['$TMP,,,,-40,,,,,,,,*'],
    '100 -> 60 is the absolute t4 modifier -40 in a complete 12-comma frame');
  assert.equal(rawWeaps(h).length, 0, 'accuracy must not reset the weapon frame');
  assert.equal(ammos(h).length, 0, 'a t4 write needs no magazine repair');
  assert.equal(accuracyTmps(h)[0].split(',')[8], '', 't8 spawn protection stays owned by its own writer');
});

test('S55: fn-23 smoke owns t4, repeated Haze extends it, then the latest recoil target returns once', () => {
  const h = armRecoil(TWO_STEP);
  h.writes.length = 0;
  fire(h, TWO_STEP_AFTER); ack(h);
  assert.equal(h.eng.state().aim.reason, 'recoil', 'the one pill exposes the current recoil cause');
  h.writes.length = 0;

  // HIR-first pairing, then a repeat while the gun is already at zero (there is no second accuracy drop).
  h.frame('$HIR,0,7,19,2,6,0,0,*'); h.frame(`$ALCD,${h.mag},0,0,215,0,*`);
  assert.equal(h.eng.state().aim.reason, 'smoke', 'smoke has presentation priority over recoil');
  const firstUntil = h.eng.smoke.until;
  h.adv(SMOKE_MS - 500); h.eng.tick();
  assert.equal(accuracyTmps(h).length, 0, 'no accuracy write may cancel native smoke');
  h.frame('$HIR,0,7,19,2,6,0,0,*');
  assert.ok(h.eng.smoke.until > firstUntil, 'a repeated Haze refreshes the native window even while accuracy is already zero');
  h.adv(1000); h.eng.tick();
  assert.equal(accuracyTmps(h).length, 0, 'the original expiry cannot beat the refreshed smoke');
  h.adv(SMOKE_MS); h.eng.tick();
  assert.equal(h.eng.state().aim, null, 'the settled recoil model needs no pill after smoke');
  assert.deepEqual(accuracyTmps(h), ['$TMP,,,,0,,,,,,,,*'], 'the owner reasserts its latest crisp target exactly once');
});

test('S55: an accuracy-zero report arriving before its Haze HIR pauses the writer during the pairing window', () => {
  const h = armRecoil(TWO_STEP);
  fire(h, TWO_STEP_AFTER); ack(h); h.writes.length = 0;
  h.frame(`$ALCD,${h.mag},0,0,215,0,*`);   // the two halves may arrive in either order
  h.eng._recoil.dirty = true; h.eng.tick();
  assert.equal(accuracyTmps(h).length, 0, 'the owner waits rather than cancelling a possible native fn-23 effect');
  h.adv(100); h.frame('$HIR,0,7,19,2,6,0,0,*');
  h.adv(ACC_VERIFY_GRACE_MS + 10); h.eng.tick();
  assert.equal(accuracyTmps(h).length, 0, 'the paired smoke suppresses retries too');
});

test('S55: a short EMP keeps native t4 ownership for the full recovery window without claiming SMOKED', () => {
  const h = armRecoil(TWO_STEP);
  h.eng.config.stun = { duration_s: 1 };
  fire(h, TWO_STEP_AFTER); ack(h); h.writes.length = 0;
  h.frame('$HIR,0,8,19,2,6,0,0,*');
  assert.notEqual(h.eng.state().aim?.reason, 'smoke', 'EMP has its own STUNNED presentation');
  h.adv(1100); h.eng.tick();
  assert.equal(h.eng.stunned, null, 'the configured one-second stun has ended');
  assert.equal(accuracyTmps(h).length, 0, 'native fn-23 still owns t4 after the shorter stun ends');
  h.adv(SMOKE_MS); h.eng.tick();
  assert.deepEqual(accuracyTmps(h), ['$TMP,,,,0,,,,,,,,*'], 'the latest settled target returns after native recovery');
});

test('S55: a later EMP outlives an earlier smoke instead of the smoke expiry releasing t4', () => {
  const h = armRecoil(TWO_STEP);
  h.eng.config.stun = { duration_s: 1 };
  fire(h, TWO_STEP_AFTER); ack(h); h.writes.length = 0;
  h.frame('$HIR,0,7,19,2,6,0,0,*'); h.frame(`$ALCD,${h.mag},0,0,215,0,*`);
  h.adv(SMOKE_MS - 1000); h.frame('$HIR,0,8,19,2,6,0,0,*');
  h.adv(1100); h.eng.tick();
  assert.equal(h.eng.smoke, null, 'the earlier smoke tell has expired');
  assert.equal(accuracyTmps(h).length, 0, 'its expiry cannot release the later EMP owner');
  h.adv(SMOKE_MS); h.eng.tick();
  assert.deepEqual(accuracyTmps(h), ['$TMP,,,,0,,,,,,,,*'], 'recoil returns only after the later native deadline');
});

test('S55: swapping from a degraded weapon to a flat slot clears the global t4 modifier', () => {
  const h = armRecoil(TWO_STEP);
  fire(h, TWO_STEP_AFTER); ack(h);
  assert.equal(h.eng._accuracyOffset, -15, 'pre-condition: recoil left a global t4 modifier');
  h.writes.length = 0;
  h.eng.player.loadout.weapons.push({ weapon_id: 'shotgun' });
  h.eng.catalog.weapons.push({ weapon_id: 'shotgun', name: 'Shotgun', clip: 6, reserve: 24 });
  h.eng.activeSlot = 1;
  h.eng._recoilArm('flat swap');
  assert.equal(h.eng._recoil.model, false, 'the secondary really is flat; this is not the slot-0 fallback');
  h.eng.tick();
  assert.deepEqual(accuracyTmps(h), ['$TMP,,,,0,,,,,,,,*'], '`$WEAP` cannot clear t4, so the owner must');
});

test('S55: a quiet t4 recovery accepts its delayed self-echo and recoil works on the next burst', () => {
  const h = armRecoil(TWO_STEP);
  fire(h, TWO_STEP_AFTER); ack(h); h.writes.length = 0;
  h.adv(RECOIL_SETTLE_MIN_MS + 10); h.eng.tick();
  assert.deepEqual(accuracyTmps(h), ['$TMP,,,,0,,,,,,,,*'], 'release writes crisp once');
  h.adv(40); h.frame(`$ALCD,${h.mag},100,0,215,0,*`);       // bench: t4 self-emits after one BLE round trip
  h.writes.length = 0;
  h.adv(ACC_VERIFY_GRACE_MS * 3); h.eng.tick();
  assert.equal(h.eng._recoil.disabled, false, 'the self-echo confirms the recovery');
  assert.equal(accuracyTmps(h).length, 0, 'a confirmed recovery neither retries nor gives up');
  fire(h, TWO_STEP_AFTER);
  assert.deepEqual(accuracyTmps(h), ['$TMP,,,,-15,,,,,,,,*'], 'the next ordinary burst still degrades');
});

test('S55: reconcile reasserts crisp t4 when a fresh app cannot know the gun retained degradation', () => {
  const h = armRecoil(TWO_STEP);
  h.writes.length = 0;
  h.eng._accuracyOffset = 0;             // fresh-process memory, while hardware may still hold t4 < 0
  h.eng._recoilArm('reconcile');
  h.eng.tick();
  assert.deepEqual(accuracyTmps(h), ['$TMP,,,,0,,,,,,,,*'], 'reconcile repairs durable gun state');
});
/** Fire `n` rounds from slot 0, one $ALCD each, `gap` ms apart -- well inside `settleMs`, so the rounds
 *  are ONE burst. Each frame reports the accuracy the gun was last told to hold, which is what a gun that
 *  honoured the write would say. */
function fire(h, n = DEGRADE_AFTER, { gap = 60, slot = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    if (gap) h.adv(gap);
    const r = h.eng._recoil;
    const acc = r && r.lastWriteValue != null ? r.lastWriteValue : 100;
    h.frame(`$ALCD,${--h.mag},${acc},${slot},215,0,*`);
  }
}
/** The gun's own report that it took the accuracy write: the same magazine, at the written value.
 *  `_recoilObserve` confirms a pending write off any $ALCD that names the slot, so this closes the verify
 *  window and leaves the model idle -- which is what a guard test needs before it puts its guard on. */
function ack(h, slot = 0) {
  const r = h.eng._recoil;
  if (r && r.lastWriteValue != null) h.frame(`$ALCD,${h.mag},${r.lastWriteValue},${slot},215,0,*`);
}

// ---------- F259: the gun resets its own magazine, and the magazine must still empty ----------

/** The gun as the bench measured it, driven round by round on the test clock:
 *   - a `$WEAP` re-push RESETS the magazine to the frame's clip (bench 2026-09-17);
 *   - an `$AMMO` sets the magazine to whatever the node sent;
 *   - a round leaves the moment the trigger cadence comes round, and its `$ALCD` reaches the node
 *     `latency` ms LATER. That gap is the whole of F259: the node can write inside it, and a write that
 *     restores the last count it RECEIVED hands the round back.
 *  `press` drives the `$BUT,0,1` a semi-automatic weapon sends before each round; `press: false` is the
 *  full-auto case, where the node has only the `$ALCD` stream to go on. `honours: false` is the F230 gun:
 *  it APPLIES the write (magazine reset and all) but never reports the new live accuracy, so the node's
 *  verify fails and a RETRY fires from the clock, mid-burst, rather than off an `$ALCD`.
 *  Returns the gun. */
function sustainedFire(h, { slot = 0, clip = 36, reserve = 215, rounds = 60, cadence = 100, latency = 40, step = 10, press = true, honours = true, writeLatency = 40, onSample = null } = {}) {
  const gun = { mag: clip, reserve, resets: 0, fired: 0 };
  let cursor = h.writes.length, inFlight = null, nextAt = h.eng.now();   // the head is already written; only what follows reaches this gun
  // ⚠ F259: a write does not land instantly and the gun ANSWERS it. Each frame reaches the gun
  // `writeLatency` ms later (the bench measured 30-90 ms) and sends its own `$ALCD` back, exactly as the
  // hardware did on 2026-09-18: a `$WEAP` reset reports the clip, and the `$AMMO` beside it reports the
  // restored count. The node sees the second as a decrement of `clip - n`. A simulator that applied the
  // writes instantly AND silently -- as this one did until the bench caught it -- models a gun that does not
  // exist, and passes while the real one oscillates.
  // ⚠ The HUD re-renders on every frame off the gun (`_changed`), so the sampler must too. Sampling once a
  // tick hid the leak entirely: the reset echo and the restore echo arrive together, so a raw value on
  // screen was overwritten before the next tick ever looked at it -- and Tony saw it on the phone anyway.
  const feed = (f) => { h.frame(f); if (onSample) onSample(); };
  const queued = [];
  const collect = () => {
    for (; cursor < h.writes.length; cursor++) {
      const f = h.writes[cursor];
      if (f.startsWith('$TMP,') && f.split(',')[4] !== '') queued.push({ at: h.eng.now() + writeLatency, frame: f });
    }
  };
  const apply = () => {
    while (queued.length && h.eng.now() >= queued[0].at) {
      const f = queued.shift().frame;
      const target = 100 + Number(f.split(',')[4]);
      const r = h.eng._recoil;
      feed(`$ALCD,${gun.mag},${honours ? target : 100},${slot},${gun.reserve},0,*`);
      collect();
    }
  };
  const drainEchoes = () => {};   // folded into `apply` now that a write has a landing time
  if (onSample) onSample();   // the starting magazine, before a single round has left
  for (let guard = 0; gun.fired < rounds && guard < rounds * (cadence / step) * 4; guard++) {
    h.adv(step); collect(); apply();
    if (inFlight && h.eng.now() >= inFlight.at) { feed(inFlight.frame); inFlight = null; collect(); apply(); }
    if (!inFlight && h.eng.now() >= nextAt && gun.mag > 0) {
      if (press) h.frame('$BUT,0,1,*');                  // the trigger press, which the node sees BEFORE the round leaves
      gun.mag--; gun.fired++;
      const r = h.eng._recoil;
      const acc = honours && r && r.lastWriteValue != null ? r.lastWriteValue : 100;
      inFlight = { at: h.eng.now() + latency, frame: `$ALCD,${gun.mag},${acc},${slot},${gun.reserve},0,*` };
      nextAt = h.eng.now() + cadence;
    }
    h.eng.tick(); collect(); apply();
    if (gun.mag <= 0 && !inFlight) break;
  }
  // Let everything still in the air arrive before the counts are read: the last round's own `$ALCD`, then
  // any write it triggered, then that write's echoes. Ending the loop the instant the last round leaves was
  // dropping a frame and made the engine look one round short.
  for (let i = 0; i < 20; i++) {
    h.adv(step);
    if (inFlight && h.eng.now() >= inFlight.at) { feed(inFlight.frame); inFlight = null; }
    collect(); apply(); h.eng.tick(); collect(); apply();
  }
  if (onSample) onSample();
  return gun;
}

test('S55/F259: t4 recoil never resets the magazine -- a 36-round magazine runs dry exactly', () => {
  // THE defect, and the shape nothing modelled before: `_recoilWrite` used to restore `_prevAmmo`, the last
  // count the node happened to have RECEIVED. A round leaving inside that gap was handed straight back, so
  // with a writer firing every 250-500 ms the magazine never emptied and the HUD's ammo meant nothing
  // (Tony, bench 2026-09-18: "it was rendering 31/32 back and forth").
  const h = armRecoil(RECOIL_PROFILE);
  const gun = sustainedFire(h);
  assert.ok(accuracyTmps(h).length > 0, 'pre-condition: the accuracy writer must actually have changed t4');
  assert.equal(gun.resets, 0, 'a t4 write must never reset the magazine');
  assert.equal(gun.mag, 0, 'the magazine did not empty -- a write restored a round that had already left the gun');
  assert.equal(gun.fired, 36, `the player must get exactly the magazine they were given: ${gun.fired} rounds left the gun`);
  assert.equal(h.eng._acctLive(0), 0, 'and the node must agree the magazine is spent, or the HUD lies about it');
});

test('S55/F259: a gun that never confirms t4 still gets exactly one magazine', () => {
  // The dangerous write is the one the gun's own shot stream did NOT trigger. A verify retry fires
  // ACC_VERIFY_GRACE_MS after the write it is judging, which is an arbitrary clock moment mid-burst.
  //
  // ⚠ THIS ONE CANNOT BE MADE PERFECT, and the number below is a measurement, not a target. A write takes
  // 30-90 ms to reach the gun (bench 2026-09-17) and an assault rifle fires every 100 ms, so a write composed
  // in an inter-round gap can still land AFTER the next round has left, and its `$AMMO` puts that round back.
  // No ordering inside the node fixes that; only the node knowing the link's flight time would, and it does
  // not. What IS bounded is how often it can happen: the degrade write is triggered by the `$ALCD` that
  // crossed the threshold (nothing outstanding, a full fire interval of headroom), the `shotInFlight` guard
  // keeps clock-driven writes off a round the trigger has already asked for, and the verify gives up for the
  // life after two failures. So an F230 gun costs a handful of rounds a life, against a magazine that used to
  // never empty at all.
  const h = armRecoil(RECOIL_PROFILE);
  const gun = sustainedFire(h, { honours: false, latency: 70 });
  assert.ok(accuracyTmps(h).length > 1, 'pre-condition: the unconfirmed t4 write must have been retried');
  assert.equal(gun.resets, 0, 'even retries are t4-only');
  assert.equal(gun.mag, 0, 'the magazine must still run dry -- that is the F259 defect, and it must not come back');
  assert.equal(gun.fired, 36, `verification traffic must neither return nor cost a round: ${gun.fired}`);
  // CONTROL: the ordinary gun, which answers its writes, spends exactly the magazine (the test above).
});

test('S55/F259: the same exact magazine holds on FULL AUTO', () => {
  const h = armRecoil(RECOIL_PROFILE);
  const gun = sustainedFire(h, { press: false });
  assert.ok(accuracyTmps(h).length > 0, 'pre-condition: the writer changed t4');
  assert.equal(gun.resets, 0);
  assert.equal(gun.mag, 0, 'the magazine did not empty under full auto');
});

test('F259: FIVE PRESSES ON A RESETTING GUN -- one degrade, one recovery, and then SILENCE (the bench oscillation)', () => {
  // Hardware, 2026-09-18. Tony fired five shots and the phone flapped for nine seconds afterwards, a
  // crisp/degraded pair about every 1.25 s, with the magazine jumping "11 to 32 and back" on the HUD:
  //     35031 crisp · 35326 degraded · 38780 crisp · 39050 degraded · 40027 crisp · 40300 degraded · ...
  // The loop was ours. A `$WEAP` resets the gun to the compiled clip, the gun reports it, our `$AMMO`
  // restore puts it back, and the gun reports THAT -- a decrement of `clip - n`, which the burst counter
  // read as fire, so it crossed the threshold, wrote, reset, and round again. Nothing in this file modelled
  // the gun ANSWERING a write, so every test passed while the real thing oscillated.
  // S54: the shipping AR's own dmg (8) degrades only on round 6, too slow to reach in five presses at
  // all, so this profile keeps the same crisp 100 / degraded 70 ladder but carries the Force Rifle's real
  // dmg (9) instead, which reaches DEGRADED on round 5 and stays clear of HEAVY (round 8) for exactly the
  // five presses Tony fired at the bench.
  const h = armRecoil({ ceiling: 100, floor: 70, per_shot: 10, recover_ms: 150 }, { dmg: 9 });
  assert.equal(h.eng._recoil.afterShots, 5, 'pre-condition: this profile degrades on the fifth round');
  assert.equal(h.eng._recoil.heavyAfter, 8, 'and five presses must stay clear of its SECOND rung, or this test is measuring two degrades');
  const CLIP = 32, WRITE_MS = 40;               // the bench measured a write landing in 30-90 ms
  const gun = { mag: 11, reserve: 215 };
  let cursor = h.writes.length;
  // ⚠ The HUD re-renders on every frame off the gun (`_changed`), so the sampler must too. Sampling once a
  // tick hid the leak entirely: the reset echo and the restore echo arrive together, so a raw value on
  // screen was overwritten before the next tick ever looked at it -- and Tony saw it on the phone anyway.
  const feed = (f) => { h.frame(f); if (onSample) onSample(); };
  const queued = [];
  const collect = () => {                       // a write leaves the phone now and reaches the gun WRITE_MS later
    for (; cursor < h.writes.length; cursor++) {
      const f = h.writes[cursor];
      if (f.startsWith('$TMP,') && f.split(',')[4] !== '') queued.push({ at: h.eng.now() + WRITE_MS, frame: f });
    }
  };
  const pump = () => {                          // the gun applies each write that has landed, and ANSWERS it
    collect();
    while (queued.length && h.eng.now() >= queued[0].at) {
      const f = queued.shift().frame;
      const target = 100 + Number(f.split(',')[4]);
      h.frame(`$ALCD,${gun.mag},${target},0,${gun.reserve},0,*`);
      collect();
    }
  };
  const step = (ms) => { for (let t = 0; t < ms; t += 10) { h.adv(10); pump(); h.eng.tick(); pump(); } };
  h.frame(`$ALCD,${gun.mag},100,0,${gun.reserve},0,*`); pump();   // the gun's opening word: 11 rounds
  // That opening word is a 25-round drop from the harness's spawn magazine, which is a real burst as far as
  // the node can tell (a run of lost frames looks the same). Re-arm so the five presses below are measured
  // on their own, the way they would be at the start of a life.
  h.eng._accuracyOffset = 0;   // a fresh `$SPAWN` clears t4 before the model is armed
  h.eng._recoilArm('test: a fresh burst at 11 rounds');
  h.writes.length = 0; cursor = 0;
  for (let i = 0; i < 5; i++) {                 // five trigger pulls, 300 ms apart
    step(300);
    h.frame('$BUT,0,1,*'); pump();              // the press the node sees first
    step(40);
    gun.mag = Math.max(0, gun.mag - 1);         // the round leaves, and the gun reports it
    const r = h.eng._recoil;
    h.frame(`$ALCD,${gun.mag},${r && r.lastWriteValue != null ? r.lastWriteValue : 100},0,${gun.reserve},0,*`);
    pump(); h.eng.tick(); pump();
  }
  assert.equal(weaps(h).length, 1, `five rounds must cost ONE degrade write: ${weaps(h).join(' | ')}`);
  assert.equal(weaps(h)[0].split(',')[22], '85');
  // Now the nine seconds Tony watched it flap in. Nothing is firing.
  step(9000);
  assert.equal(weaps(h).length, 2,
    `the writer FLAPPED with the trigger idle -- exactly the bench trace: ${weaps(h).join(' | ')}`);
  assert.equal(weaps(h)[1].split(',')[22], '100', 'the second write is the recovery, and there is no third');
  assert.equal(gun.mag, 6, `the gun must hold the five rounds it actually fired, not a reset clip: ${gun.mag}`);
  assert.equal(h.eng._acctLive(0), 6, 'and the node must agree -- Tony saw the HUD jump 11 to 32 and back');
});

test('F259: state().ammo NEVER RISES while the trigger is down -- the echo must not reach the screen', () => {
  // Tony, bench 2026-09-18, with the account already correct: "it shoots up to 32 while shooting and it
  // shoots up again once, it syncs on trigger release." While a write is in flight the gun briefly reports
  // the magazine its own `$WEAP` reset gave it, and the HUD rendered that raw number. The node knew the true
  // count the whole time -- `_shotAcct` read {mag: 26} while the screen flashed 32.
  // This is the PLAYER-VISIBLE property, and none of the tests above assert it: they all read the value
  // after everything has settled, which is exactly when the bug is invisible.
  const h = armRecoil(RECOIL_PROFILE);
  const seen = [];
  const gun = sustainedFire(h, { rounds: 30, onSample: () => seen.push(h.eng.state().ammo) });
  assert.ok(accuracyTmps(h).length > 0, 'pre-condition: the writer must have changed t4');
  assert.ok(seen.length > 30, `the sampler must actually have run: ${seen.length} samples`);
  const rose = seen.map((v, i) => (i && v > seen[i - 1] ? `${seen[i - 1]} -> ${v} (sample ${i})` : null)).filter(Boolean);
  assert.deepEqual(rose, [], `the ammo on screen went UP while the player was shooting: ${rose.join(', ')}`);
  assert.equal(seen[seen.length - 1], 36 - gun.fired, 'and it must end on the number the gun actually holds');
  assert.equal(seen[0] - seen[seen.length - 1], gun.fired, 'having fallen by exactly the rounds that were fired');
});

test('F259: the echo is not evidence of anything else either -- no phantom shots, no try-out confirmation', () => {
  // The same frame that flashed 32 on the screen was a 26-round decrement to everything else in `_onAmmo`.
  // `this.shots` feeds the recap's accuracy, and a try-out arming confirms on "a fresh magazine at the new
  // weapon's full clip" -- which is exactly what a `$WEAP` reset looks like.
  const h = armRecoil(RECOIL_PROFILE);
  const gun = sustainedFire(h, { rounds: 30 });
  assert.ok(accuracyTmps(h).length > 0, 'pre-condition: the writer must have changed t4');
  assert.equal(h.eng.shots, gun.fired,
    `the shot counter disagrees with the gun: ${h.eng.shots} booked, ${gun.fired} rounds actually left`);
  assert.equal(gun.mag, 36 - gun.fired, 'and the gun holds what it should');
});

// ---------- F259 (polish review 2026-09-18): the account must never charge for a round that never left ----------
// `_acctPress` books a round the instant the trigger comes down, and only a CONFIRMED magazine drop ever
// gives it back (`_acctAmmo`). Nothing else in a life clears it. That matters because `_liveAmmo` -- the
// stun snapshot and the operator's RESYNC GUN -- restores `mag - fired` straight to the gun, and neither
// consults the `shotInFlight` guard that protects the accuracy writer. So a press the gun cannot answer is
// a round the player loses the next time they are stunned, and enough of them write `$AMMO,<slot>,0` at a
// gun that is holding rounds. Five shipping weapons carry a 2-round magazine, so "enough" is two.

test('F259: a pull inside the weapon own fire interval books nothing -- the gun is still cycling', () => {
  const h = armRecoil(RECOIL_PROFILE);
  const iv = h.eng._fireIntervalMs(0);
  assert.ok(iv > 0, `setup: the golden $WEAP,0 declares a fire interval (got ${iv})`);
  h.frame('$ALCD,32,100,0,192,0,*');                  // the account re-seats on the gun's own number
  assert.equal(h.eng._acctLive(0), 32, 'setup: a full magazine with nothing outstanding');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng._acctLive(0), 31, 'the first pull books the round it is about to fire');
  h.adv(Math.floor(iv / 2)); h.frame('$BUT,0,1,*');   // the player mashes, inside the same cycle
  assert.equal(h.eng._acctLive(0), 31,
    'a pull the gun cannot answer yet must not spend a round the player still has');
  h.adv(iv + 10); h.frame('$BUT,0,1,*');
  assert.equal(h.eng._acctLive(0), 30, 'a pull a full cycle later is a real round again');
});

test('F259: an expired press is CLEARED, not merely ignored, so a stun cannot disarm a loaded gun', () => {
  // `_acctLive` only IGNORES a press past TRIGGER_NO_FIRE_MS; `a.fired` keeps the count. So the next pull
  // that gets through adds to it, and on a 2-round magazine (rocket launcher, rail gun, ion sniper, laser
  // cannon, energy launcher) two unanswered pulls take the account to zero while the gun is full.
  const h = armRecoil(RECOIL_PROFILE);
  h.frame('$ALCD,2,100,0,2,0,*');
  assert.equal(h.eng._acctLive(0), 2, 'setup: two rounds, both still in the gun');
  h.frame('$BUT,0,1,*');                              // a pull the gun never answers: no $ALCD ever follows
  h.adv(TRIGGER_NO_FIRE_MS + 100);
  assert.equal(h.eng._acctLive(0), 2, 'the unanswered press expires and the account reads the gun again');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng._acctLive(0), 1,
    'the new pull must cost ONE round: an expired press must be cleared, never re-armed beside it');
  // ...and the consequence the player feels, on the wire.
  h.eng.config.stun = { duration_s: 10 };
  h.eng._stun();
  const n = h.writes.length;
  h.eng._stunRestore('expired');
  const restored = h.writes.slice(n).filter(f => f.startsWith('$AMMO,0,'));
  assert.equal(restored.length, 1, `the stun restore writes one $AMMO for slot 0: ${h.writes.slice(n).join(' | ')}`);
  assert.equal(restored[0].split(',')[2], '1',
    `the stun must hand back the round the gun is holding, never disarm it: ${restored[0]}`);
});

test('F259: the echo window closes on the VALUE, not the clock -- a slow reset is still not a reload', () => {
  // ACC_ECHO_MS is a deadline. On a link slower than it, the `$WEAP` reset frame arrives AFTER the window
  // has lapsed and lands on the ordinary path as a magazine RISE: the HUD jumps to the clip, the reload
  // takeover is fed, and the restore frame behind it books the whole synthetic drop as a burst. That is the
  // entire 2026-09-18 oscillation, back again, on the one link condition nobody can bench.
  const h = armRecoil(RECOIL_PROFILE);
  h.frame('$ALCD,11,100,0,192,0,*');
  h.writes.length = 0;
  h.eng._acctWrote(0, 11, 192);                       // the node writes $WEAP + $AMMO,0,11 and waits
  h.adv(600);                                         // ...and the gun is slower than one round trip (the F266 regime)
  const shots = h.eng.shots, burst = h.eng._recoil.burst;
  h.frame('$ALCD,32,100,0,192,0,*');                  // the $WEAP reset, late
  assert.equal(h.eng.state().ammo, 11,
    'the reset is the node own write coming back: the screen must keep the account, never jump to the clip');
  assert.equal(h.eng.reloading, null, 'and it is not a reload the player performed');
  h.frame('$ALCD,11,100,0,192,0,*');                  // the $AMMO restore, behind it
  assert.equal(h.eng.shots, shots, 'the pair must book no shots at all');
  assert.equal(h.eng._recoil.burst, burst, 'and must not feed the burst counter that writes again');
});

test('F259: a melee swing does not buy the player a free round of recoil', () => {
  // `_acctSpent` asks `slot === this.activeSlot`, and `this.activeSlot` is whatever slot spoke LAST: melee
  // is slot 4 and arrives on its own `$ALCD`, so after a swing `activeSlot` is 4 while `_recoil` is still
  // the primary's model. The next real round on slot 0 is then judged against the wrong slot and dropped
  // from the burst. The model is armed for a SLOT, so that is what the guard has to name.
  const h = armRecoil(RECOIL_PROFILE);
  h.frame('$ALCD,36,100,0,216,0,*');                  // the baseline `armRecoil` left, restated as an $ALCD
  assert.equal(h.eng._recoil.burst, 0, 'setup: no rounds behind us');
  h.frame('$ALCD,35,100,0,216,0,*');
  assert.equal(h.eng._recoil.burst, 1, 'setup: an ordinary round counts');
  h.frame('$ALCD,1,100,4,0,0,*');                     // a melee swing reports on slot 4
  assert.equal(h.eng._recoil.burst, 1, 'the swing itself is not a round out of the primary');
  h.frame('$ALCD,34,100,0,216,0,*');                  // the next round out of the primary
  assert.equal(h.eng._recoil.burst, 2,
    'a round out of the weapon the model is armed for must count, whatever spoke last');
});

test('F259: a confirmed swap arms the NEW slot, and the new weapon rounds count against it', () => {
  // `_recoilArm` reads `this.activeSlot` for the weapon it looks up AND for the slot it files the model
  // under, and the assignment used to sit BELOW the block that calls it -- so the swap armed the old
  // weapon's profile under the old slot, which is the opposite of what its own comment claims.
  const h = armRecoil(RECOIL_PROFILE);
  h.frame('$ALCD,36,100,0,216,0,*');
  h.eng.switching = { from: 0, at: h.eng.now(), to: 1 };
  h.frame('$ALCD,6,100,1,24,0,*');                    // the swap lands on slot 1
  assert.equal(h.eng.switching, null, 'setup: the swap is confirmed');
  assert.equal(h.eng._recoil.slot, 1, 'the model must be armed for the slot the player is now holding');
  h.frame('$ALCD,5,100,1,24,0,*');                    // its first round
  assert.equal(h.eng._recoil.burst, 1, 'and that slot rounds must reach it');
});

// ---------- F259: one step, not a walk ----------

test('S55/F259: a sustained burst costs THREE t4 writes -- two down, one back -- not one per round', () => {
  const h = armRecoil(RECOIL_PROFILE);
  h.writes.length = 0;
  fire(h, 20, { gap: 100 });   // 20 rounds over 2 s, every one of which the old ladder would have stepped
  assert.deepEqual(weaps(h).map(f => f.split(',')[22]), ['60', '20'],
    `a burst must cost one write PER RUNG on the way down, not one a round: ${weaps(h).join(' | ')}`);
  assert.deepEqual(weaps(h).map(f => f.split(',')[23]), ['60', '20'], 'the compatibility view preserves each target value');
  assert.equal(h.eng._recoil.state, 'heavy');
  h.adv(SETTLE_MS + 10); h.eng.tick();
  assert.equal(weaps(h).length, 3, 'the trigger going quiet must cost exactly one more write');
  assert.equal(weaps(h)[2].split(',')[22], '100', 'and that write puts the weapon back to CRISP');
  assert.equal(h.eng._recoil.state, 'crisp');
  ack(h);                       // the gun confirms it, so the verify/retry loop is not what the next line measures
  h.adv(SETTLE_MS * 3); h.eng.tick();
  assert.equal(weaps(h).length, 3, 'a weapon already crisp and already quiet must never write again');
});

test('F259: the step lands DURING the burst -- recoil is not deferred until the trigger goes quiet', () => {
  const h = armRecoil(RECOIL_PROFILE);
  h.writes.length = 0;
  fire(h, DEGRADE_AFTER - 1);
  assert.equal(weaps(h).length, 0, `the first ${DEGRADE_AFTER - 1} round(s) of a burst must not cost a write`);
  assert.equal(h.eng._recoil.state, 'crisp');
  fire(h, 1);
  assert.equal(weaps(h).length, 1, 'the threshold round must degrade the weapon there and then, with the trigger still down');
  assert.equal(h.eng._recoil.value, 60);
});

test('F259: a burst that never reaches the threshold is forgotten -- two taps a minute apart are not one burst', () => {
  const h = armRecoil(RECOIL_PROFILE);
  h.writes.length = 0;
  fire(h, DEGRADE_AFTER - 1);
  h.adv(SETTLE_MS + 10); h.eng.tick();
  assert.equal(h.eng._recoil.burst, 0, 'the settle clock must clear a burst that never crossed the threshold');
  fire(h, DEGRADE_AFTER - 1);
  assert.equal(weaps(h).length, 0, 'two short bursts, a settle apart, must not add up to one long one');
});

// ---------- S54: the trigger's own release ($BUT,0,0) resets a still-crisp burst, at no cost in writes ----------
// Bench-provisional (2026-09-23): the gun streams a release edge every time the trigger comes up in app
// mode. While the weapon is still CRISP that is direct, immediate evidence the burst has stopped, so the
// round count clears there and then rather than waiting out `settleMs`. A DEGRADED or HEAVY weapon still
// only recovers on the settle clock -- see the dedicated recovery tests above and in step 2 below.

test('S54: a trigger release while crisp clears the round count, so a five-and-five split never adds up to a degrade', () => {
  const h = armRecoil(RECOIL_PROFILE);   // default dmg 8: crisp until round DEGRADE_AFTER (6)
  h.writes.length = 0;
  fire(h, DEGRADE_AFTER - 1);            // five rounds -- one short of the sixth, threshold round
  assert.equal(h.eng._recoil.state, 'crisp', 'pre-condition: five rounds must not yet have degraded the weapon');
  assert.equal(h.eng._recoil.burst, DEGRADE_AFTER - 1);
  h.frame('$BUT,0,0,*');                 // the trigger comes up
  assert.equal(h.eng._recoil.burst, 0, 'a release while still crisp must clear the round count, at no cost in writes');
  assert.equal(weaps(h).length, 0, 'clearing a crisp burst is not a state change and must not write');
  fire(h, DEGRADE_AFTER - 1);            // a fresh pull, five more rounds
  assert.equal(h.eng._recoil.state, 'crisp', 'ten rounds split by a release must not add up to one continuous burst');
  assert.equal(weaps(h).length, 0, 'and still no write, because the weapon never left crisp');
});

test('S54: a trigger release while degraded does NOT restore the weapon -- recovery still waits for settleMs', () => {
  const h = armRecoil(RECOIL_PROFILE);
  fire(h, DEGRADE_AFTER); ack(h);        // degrade written and confirmed
  assert.equal(h.eng._recoil.state, 'degraded', 'pre-condition: the burst must have degraded the weapon');
  h.writes.length = 0;
  h.frame('$BUT,0,0,*');                 // the trigger comes up
  assert.equal(h.eng._recoil.state, 'degraded', 'a release must not restore a degraded weapon by itself');
  assert.equal(weaps(h).length, 0, 'and it must cost no write either way');
  h.adv(SETTLE_MS + 10); h.eng.tick();
  assert.equal(h.eng._recoil.state, 'crisp', 'the settle clock still recovers it, exactly as before the release edge existed');
  assert.equal(weaps(h).length, 1, 'and that recovery is still the one write it always was');
});

test('S54: full auto with no release edge still degrades exactly on the threshold round', () => {
  // The release reset is an OPTIMISATION for a burst that stops short, never a requirement for the
  // ordinary case: a trigger nobody lets go of must degrade on schedule regardless.
  const h = armRecoil(RECOIL_PROFILE);
  h.writes.length = 0;
  fire(h, DEGRADE_AFTER - 1);
  assert.equal(h.eng._recoil.state, 'crisp', `the first ${DEGRADE_AFTER - 1} round(s) must not degrade the weapon`);
  fire(h, 1);
  assert.equal(h.eng._recoil.state, 'degraded', 'the threshold round must degrade the weapon with no release in between');
  assert.equal(weaps(h).length, 1);
});

// ---------- F259 step 2: crisp, degraded, heavily degraded, and still ONE recovery ----------
// Tony, at the bench 2026-09-18, after the one-step writer ran on hardware: "maybe we can update it to do
// 2 steps instead of 1? normal degraded and very degraded."

test('F259 step 2: the writes follow the STATE CHANGES, never the rounds -- a 30-round burst costs exactly three, at any magazine size', () => {
  // THE property the whole design exists to protect. Every `$WEAP` resets the gun's magazine, so every
  // write is a chance to lose a round (F259): the old ladder wrote twenty-odd times a burst and that is
  // what erased the shots. A second rung may cost ONE more write a burst and no more, and the count must
  // never track the rounds fired or the magazine they came out of.
  for (const clip of [36, 120]) {
    const h = armRecoil(TWO_STEP);
    // The gun comes up to ITS OWN clip before a round is fired, the way a reload leaves it. Without this
    // the first `$ALCD` of the run is a RISE, so the press behind it is never answered and stays booked
    // against the account for the whole burst -- which parks the writer behind its `shotInFlight` guard.
    if (clip !== 36) { h.frame(`$ALCD,${clip},100,0,215,0,*`); h.eng.tick(); }
    h.writes.length = 0;
    const gun = sustainedFire(h, { clip, rounds: 30 });
    assert.equal(gun.fired, 30, `pre-condition: the gun must actually have fired 30 rounds at clip ${clip}`);
    assert.deepEqual(weaps(h).map(f => f.split(',')[22]), ['85', '70'],
      `30 rounds must cost TWO writes on the way down at clip ${clip}: ${weaps(h).join(' | ')}`);
    h.adv(SETTLE_MS + 10); h.eng.tick();
    assert.deepEqual(weaps(h).map(f => f.split(',')[22]), ['85', '70', '100'],
      `and exactly one more on the way back at clip ${clip}: ${weaps(h).join(' | ')}`);
    assert.deepEqual(weaps(h).map(f => f.split(',')[23]), ['85', '70', '100'], 'both tokens on every write, never one');
  }
});

test('F259 step 2: the heavy step fires at ITS OWN threshold, not one round before and not again after', () => {
  const h = armRecoil(TWO_STEP);
  h.writes.length = 0;
  fire(h, TWO_STEP_HEAVY_AFTER - 1);
  assert.equal(h.eng._recoil.state, 'degraded', `${TWO_STEP_HEAVY_AFTER - 1} rounds must leave the weapon on the FIRST rung`);
  assert.equal(h.eng._recoil.value, 85);
  assert.equal(weaps(h).length, 1, `only the first threshold may have written: ${weaps(h).join(' | ')}`);
  fire(h, 1);
  assert.equal(h.eng._recoil.state, 'heavy', 'the threshold round must degrade it again, there and then, with the trigger still down');
  assert.equal(h.eng._recoil.value, 70);
  assert.equal(weaps(h).length, 2);
  assert.equal(weaps(h)[1].split(',')[22], '70');
  assert.equal(weaps(h)[1].split(',')[23], '70');
  fire(h, 15);
  assert.equal(weaps(h).length, 2, `there is no third rung -- 15 more rounds must cost nothing: ${weaps(h).join(' | ')}`);
});

test('F259 step 2: the recovery is ONE write from EITHER degraded state -- the player releases once', () => {
  for (const [rounds, state, value] of [[TWO_STEP_AFTER, 'degraded', 85], [TWO_STEP_HEAVY_AFTER, 'heavy', 70]]) {
    const h = armRecoil(TWO_STEP);
    h.writes.length = 0;
    fire(h, rounds);
    assert.equal(h.eng._recoil.state, state, `pre-condition: ${rounds} rounds must leave the weapon ${state}`);
    assert.equal(h.eng._recoil.value, value);
    const down = weaps(h).length;
    h.adv(SETTLE_MS + 10); h.eng.tick();
    assert.equal(weaps(h).length, down + 1, `a release from ${state} must cost exactly one write: ${weaps(h).join(' | ')}`);
    assert.equal(weaps(h)[down].split(',')[22], '100', `and it must go straight back to CRISP from ${state}, not climb a rung`);
    assert.equal(h.eng._recoil.state, 'crisp');
    ack(h);   // the gun confirms it, so the verify/retry loop is not what the next line measures
    h.adv(SETTLE_MS * 3); h.eng.tick();
    assert.equal(weaps(h).length, down + 1, 'a weapon already crisp and already quiet must never write again');
  }
});

test('F259 step 2: the minimum write gap throttles a RE-SEND, never a state change', () => {
  // The assault rifle's two rungs are three rounds apart, which is INSIDE ACC_WRITE_MIN_GAP_MS on any
  // weapon firing faster than about 80 ms a round. Throttling the second rung would defer it to a tick,
  // and a clock-driven write is composed in an inter-round gap and lands after the next round has left,
  // so its `$AMMO` hands that round back -- the F259 defect, through the back door. The state machine
  // already bounds a burst to three writes, so it is what limits the write rate now, not this gap.
  const h = armRecoil(TWO_STEP);
  h.writes.length = 0;
  const at = h.eng.now();
  fire(h, TWO_STEP_HEAVY_AFTER, { gap: 40 });   // six rounds inside 250 ms
  assert.ok(h.eng.now() - at < ACC_WRITE_MIN_GAP_MS, 'pre-condition: the whole burst must fit inside one minimum gap');
  assert.deepEqual(weaps(h).map(f => f.split(',')[22]), ['85', '70'],
    `both rungs must be written DURING the burst, never deferred to a tick: ${weaps(h).join(' | ')}`);
  // CONTROL: a write that re-sends the value the gun is already holding DOES wait out the gap. This is the
  // shape `_holdAccuracyWrites` leaves behind -- same value, re-asserted once the hold lifts.
  ack(h);
  const n = weaps(h).length;
  h.eng._recoil.dirty = true;
  h.adv(10); h.eng.tick();
  assert.equal(weaps(h).length, n, 'a re-send inside the minimum gap must wait');
  h.adv(ACC_WRITE_MIN_GAP_MS); h.eng.tick();
  assert.equal(weaps(h).length, n + 1, 'and go out once the gap has passed');
  assert.equal(weaps(h)[n].split(',')[22], '70', 'carrying the state the model holds, which has not moved');
});

test('polish review: a BLE drop stands the recoil writer down -- no write to a gun the link just lost', () => {
  const h = armRecoil(TWO_STEP);
  fire(h, TWO_STEP_AFTER);
  ack(h);   // clears the write-in-flight so the next dirty mark is not caught by the verify window instead
  const n = weaps(h).length;
  h.eng._recoil.dirty = true;   // the shape a hold leaves behind: same value, re-asserted once it lifts
  h.eng.onBleDropped();
  h.adv(ACC_WRITE_MIN_GAP_MS + SETTLE_MS); h.eng.tick();
  assert.equal(weaps(h).length, n, 'the drop must suppress the write, not just delay it');
  assert.equal(h.eng._recoil.dirty, true, 'the mark itself must survive the drop, for the reconcile that follows');
});

test('polish review: _holdAccuracyWrites does not mark dirty when the live value has not moved', () => {
  const h = armRecoil(TWO_STEP);
  fire(h, TWO_STEP_AFTER); ack(h);            // degrade written and acked: value === lastWriteValue
  assert.equal(h.eng._recoil.dirty, false, 'setup: nothing pending once the write is acked');
  h.eng._holdAccuracyWrites('operator resync');
  assert.equal(h.eng._recoil.dirty, false,
    'the value has not moved -- none of the writes this stands down for carries a $WEAP, so no re-assertion is owed');
});

test('F259 step 2: a frame that reports a whole burst at once lands on the rung those rounds earned, in ONE write', () => {
  // A run of lost `$ALCD` frames reaches `_recoilStep` as a single multi-round decrement. The burst
  // decides the state, so it must land on the rung it earned rather than walk down one write at a time --
  // walking is the cost F259 took out, and it would come back here first.
  const h = armRecoil(TWO_STEP);
  h.writes.length = 0;
  h.mag -= TWO_STEP_HEAVY_AFTER;
  h.frame(`$ALCD,${h.mag},100,0,215,0,*`);
  assert.equal(h.eng._recoil.state, 'heavy', 'six rounds in one frame are still six rounds');
  assert.equal(h.eng._recoil.value, 70);
  assert.equal(weaps(h).length, 1, `one frame, one write -- not one per rung: ${weaps(h).join(' | ')}`);
  assert.equal(weaps(h)[0].split(',')[22], '70');
});

test('S55/F259 step 2: two t4 state changes never touch the magazine account', () => {
  // The bug that started all this: a `$WEAP` resets the gun's magazine and the `$AMMO` beside it decides
  // what the player is left holding, so a stale restore hands back a round that has already left. Two
  // degrade writes in one burst are two chances to do it.
  const h = armRecoil(TWO_STEP);
  const gun = sustainedFire(h);
  assert.equal(accuracyTmps(h).length >= 2, true, 'pre-condition: both degrade t4 writes landed');
  assert.equal(gun.resets, 0, 'neither state change resets the magazine');
  assert.equal(gun.mag, 0, 'the magazine did not empty -- a write restored a round that had already left the gun');
  assert.equal(gun.fired, 36, `the player must get exactly the magazine they were given: ${gun.fired} rounds left the gun`);
  assert.equal(h.eng._acctLive(0), 0, 'and the node must agree the magazine is spent, or the HUD lies about it');
  assert.equal(h.eng.shots, gun.fired, `the shot counter must still agree with the gun: ${h.eng.shots} booked, ${gun.fired} fired`);
});

test('F259: a weapon with NO recoil block at all arms nothing -- absent means "never degrades", not "use a default"', () => {
  // The catalogue is dropping the block entirely from the 17 of 25 weapons that do not degrade, rather than
  // declaring a 100/100 ladder that says nothing. An absent block must read the same as a flat one.
  const h = armRecoil(undefined);
  assert.equal(h.eng._recoil, null, 'a weapon with no recoil block must not arm the accuracy model');
  h.writes.length = 0;
  fire(h, 20, { gap: 100 });
  h.adv(SETTLE_MS + 10); h.eng.tick();
  assert.equal(weaps(h).length, 0, 'and it must never write $WEAP for the whole life');
  assert.equal(h.eng.shots, 20, 'the ordinary shot counter still works -- only the accuracy model is idle');
});

test('F259: a weapon whose accuracy cannot degrade arms nothing at all -- no state, no write, ever', () => {
  // Most of the catalogue is flat (floor == ceiling). There is no second state for those, so there is
  // nothing to write, and the model should not be standing by holding a profile it can never use.
  const h = armRecoil({ ceiling: 100, floor: 100, per_shot: 0, recover_ms: 150 });
  assert.equal(h.eng._recoil, null, 'a flat weapon must not arm the accuracy model');
  h.writes.length = 0;
  fire(h, 20, { gap: 100 });
  h.adv(SETTLE_MS + 10); h.eng.tick();
  assert.equal(weaps(h).length, 0, 'and it must never write $WEAP for the whole life');
  assert.equal(h.eng.shots, 20, 'the ordinary shot counter still works -- only the accuracy model is idle');
});

test('F259: arming ASSERTS the crisp value when the compiled $WEAP does not already hold it', () => {
  // compile.py never writes t21/t22: every captured frame ships 100/100 (native walk off, F230), so a
  // catalogue that declares `crisp: 100` needs no write at arm time and gets none. The day the catalogue
  // declares a different crisp value, the gun and this model would disagree for a whole burst before
  // anything corrected it. Arming compares the two and writes only when they differ.
  // `armRecoil` already ticks past the spawn hold, so the assertion write (if any) has gone out by the time
  // it returns. The head itself carries one `$WEAP,0,`, so a silent arm leaves exactly that one on the wire.
  const q = armRecoil(RECOIL_PROFILE);   // CONTROL: crisp 100, which IS what the compiled frame holds
  assert.equal(weaps(q).length, 0,
    `a weapon already at its crisp value must not spend a write saying so: ${weaps(q).join(' | ')}`);
  const h = armRecoil({ ...RECOIL_PROFILE, crisp: 90, degraded: 20, after_shots: 2 });
  assert.equal(h.eng._headAccuracy(0), 100, 'pre-condition: the compiled frame still holds 100');
  assert.equal(h.eng._recoil.crisp, 90);
  assert.equal(weaps(h).length, 1, 'a crisp value the gun is not holding must be asserted, with no shot needed');
  assert.equal(weaps(h)[0].split(',')[22], '90');
  assert.equal(weaps(h)[0].split(',')[23], '90', 'the t4 owner reaches the declared live value');
  assert.equal(h.eng._recoil.state, 'crisp', 'and the weapon is CRISP while it says so -- this is not a degrade');
});

test('S54: the round counts are derived from the row\'s dmg -- rounds per trigger pull, scaled by calibre, pinned against the shipped table', () => {
  // Tony, 2026-09-23: a reference weapon at dmg 8 (the Assault Rifle/SMG/Energy Rifle) fires 5 clean
  // rounds and degrades on the 6th, then 3 more clean rounds and goes heavy on the 9th. A different `dmg`
  // scales both counts by `8 / dmg`. These are the real `weapons.json` rows (`recoil` blocks) after the
  // S54/F268 floor raise, so this pins the shipped table, not an abstract example.
  const h = armRecoil(RECOIL_PROFILE);
  const from = (dmg, recoil) => h.eng._recoilProfile({ dmg, recoil });
  const row = (crisp, degraded, heavy, afterShots, heavyAfter) =>
    ({ crisp, degraded, heavy, afterShots, heavyAfter, settleMs: RECOIL_SETTLE_MIN_MS });
  assert.deepEqual(from(8, { ceiling: 100, floor: 70, per_shot: 10, recover_ms: 150 }), row(100, 85, 70, 6, 9),
    'energy_rifle: reference calibre, its own (derived) depths');
  assert.deepEqual(from(8, { ceiling: 100, floor: 60, per_shot: 15, recover_ms: 150 }), row(100, 80, 60, 6, 9),
    'smg: reference calibre, the raised F268 floor');
  assert.deepEqual(from(9, { ceiling: 100, floor: 60, per_shot: 10, recover_ms: 150 }), row(100, 80, 60, 5, 8),
    'force_rifle: a heavier round reaches degraded sooner');
  assert.deepEqual(from(13, { ceiling: 100, floor: 60, per_shot: 8, recover_ms: 120 }), row(100, 80, 60, 4, 6),
    'stinger: the heaviest calibre here, the shortest ladder');
  assert.deepEqual(from(7, { ceiling: 100, floor: 60, per_shot: 15, recover_ms: 150 }), row(100, 80, 60, 7, 10),
    'suppressor: the lightest calibre, the longest ladder');
  assert.deepEqual(from(7, { ceiling: 100, floor: 65, per_shot: 10, recover_ms: 150 }), row(100, 82, 65, 7, 10),
    'toxin_rifle: an odd midpoint rounds DOWN');
  // Tony, 2026-09-23 (F291, later the same day): deepened again off the recoil duel sim
  // (mcp/tools/balance_sim.py --scenario recoil-duel) -- degraded 70, heavy 40, and `after_heavy`
  // DECLARED (not derived) so heavy only starts once a burst holds past a set number of rounds,
  // punishing full auto without touching a controlled 3-5 round burst (`after_shots` still derives
  // to 6). Tightened again the same day (R7, F308): 8 -> 7, so heavy starts on round 7, one round
  // sooner -- degraded is still round 6 alone -- so a full-auto AR earns its own penalty sooner,
  // making room for the Burst Rifle to beat it (R7). Eased 40 -> 45 the same day, polish round 2
  // (F308, "full auto point blank ... too harsh"): `after_shots`/`after_heavy` unchanged, only the
  // heavy floor itself is shallower.
  assert.deepEqual(from(8, { crisp: 100, degraded: 70, heavy: 45, after_heavy: 7, ceiling: 100, floor: 70, per_shot: 10, recover_ms: 150 }),
    row(100, 70, 45, 6, 7), 'assault_rifle: the 2026-09-24 depths (70/45), heavy declared at round 7 (R7, F308)');
  // The Suppressor's own exception the OTHER way (Tony, 2026-09-23, R10, F308, docs/weapon-design.md's
  // Balance rules table row 3): "it should be weaker since its silent but not too weak." An explicit
  // `heavy: 70` (not the derived 60 floor every other reference-calibre weapon ships), declared
  // alongside the captured `floor: 60` so `_recoilProfile` reads `heavy` over `floor`; `degraded`
  // derives between `crisp` and the NEW `heavy` (85, not the un-fixed 80 two lines above).
  // `afterShots`/`heavyAfter` are unaffected -- they derive off `dmg` (7), not `heavy` -- so they stay
  // 7/10, the same as the un-fixed suppressor case above. Mirrors
  // mcp/tests/test_balance_sim.py::test_recoil_profile_pins_the_shipped_suppressor_row.
  assert.deepEqual(from(7, { ceiling: 100, floor: 60, heavy: 70, per_shot: 15, recover_ms: 150 }),
    row(100, 85, 70, 7, 10), 'suppressor: the explicit 2026-09-23 heavy (70), degraded derives to 85 (R10, F308)');
  assert.equal(h.eng._recoilProfile(null), null);
  assert.equal(h.eng._recoilProfile({ dmg: 9, recoil: { ceiling: 100, floor: 100, per_shot: 0, recover_ms: 0 } }), null,
    'burst_rifle: a one-press trigger cannot be held in full auto, so it carries no recoil at all');
});

test('F259 step 2: the DECLARED fields win outright, because the catalogue owner sets the real numbers', () => {
  // Three of the eight shipping floors came UP when the fields were adopted (the SMG and the Suppressor
  // from 55, the Stinger from 45, all to 60), because the accuracy bench measured only 7 of 18 shots
  // landing at 50 to 60: a weapon that lands 39% of its rounds is removed from the fight rather than
  // penalised. That is a judgement the derivation above cannot see, so those weapons DECLARE `heavy` and
  // the declared numbers must reach the model untouched.
  const h = armRecoil(RECOIL_PROFILE);
  assert.deepEqual(h.eng._recoilProfile({ dmg: 8, recoil: { crisp: 100, degraded: 78, heavy: 60, after_shots: 3, after_heavy: 6, settle_ms: 600 } }),
    { crisp: 100, degraded: 78, heavy: 60, afterShots: 3, heavyAfter: 6, settleMs: 600 }, 'the SMG as the catalogue declares it');
  // A half-adopted row works too: a declared `heavy` IS the ladder's floor, and everything absent derives
  // from it (including the round counts, off `dmg`) rather than from the old one.
  assert.deepEqual(h.eng._recoilProfile({ dmg: 8, recoil: { ceiling: 100, floor: 45, per_shot: 8, recover_ms: 120, heavy: 60 } }),
    { crisp: 100, degraded: 80, heavy: 60, afterShots: 6, heavyAfter: 9, settleMs: RECOIL_SETTLE_MIN_MS });
});

test('F259: a ladder too short to split in two collapses back to ONE step, rather than writing the same number twice', () => {
  // A second write that sends the gun the value it is already holding spends a magazine reset for nothing.
  const h = armRecoil(RECOIL_PROFILE);
  assert.deepEqual(h.eng._recoilProfile({ dmg: 8, recoil: { ceiling: 100, floor: 99, per_shot: 1, recover_ms: 150 } }),
    { crisp: 100, degraded: 99, heavy: null, afterShots: 6, heavyAfter: 0, settleMs: RECOIL_SETTLE_MIN_MS });
  assert.deepEqual(h.eng._recoilProfile({ dmg: 8, recoil: { crisp: 100, degraded: 70, heavy: 70, after_shots: 3 } }),
    { crisp: 100, degraded: 70, heavy: null, afterShots: 3, heavyAfter: 0, settleMs: RECOIL_SETTLE_MIN_MS },
    'two rungs declared at the same accuracy are one rung');
  assert.equal(h.eng._recoilProfile({ dmg: 8, recoil: { ceiling: 100, floor: 100, per_shot: 0, recover_ms: 0 } }), null, 'and a flat weapon has no profile at all');
});

test('S55: the accuracy write fills only $TMP t4 and leaves every other modifier blank', () => {
  // Bench 2026-09-18: `$WEAP` t1 is `WeaponIRSource`, and on the Shotgun, the Plasma Sniper and the Rocket
  // Launcher it is 2 -- every trigger pull ALSO fires a second word out of the shooter's own headset,
  // configured by t12, t13 and t42. A writer that rebuilt the frame from the catalogue rather than mutating
  // the one MC compiled would disarm that word silently: the weapon keeps firing, the player notices
  // nothing, and three weapons quietly lose half their output.
  // This diffs the WHOLE token vector rather than checking those three numbers, so the guard also covers
  // whatever field is added to `$WEAP` next -- a field a list of token numbers would let slip straight past.
  const h = armRecoil(RECOIL_PROFILE);
  const frameFor = (slot) => {
    h.eng.activeSlot = slot;
    h.writes.length = 0;
    h.eng._recoil.value = 20; h.eng._recoil.dirty = true;
    h.eng._recoilWrite(h.eng.now());
    const out = accuracyTmps(h)[0];
    assert.ok(out, `the writer sent no t4 frame for slot ${slot}`);
    assert.equal(out.split(',').length, 13, out);
    assert.deepEqual(out.split(',').slice(1, -1).map((v, i) => v === '' ? null : i + 1),
      [null, null, null, 4, null, null, null, null, null, null, null], 'only t4 may be populated');
    assert.equal(rawWeaps(h).length, 0, 'no weapon frame is rewritten');
    assert.equal(ammos(h).length, 0, 'no ammunition repair is needed');
    return out;
  };
  assert.equal(frameFor(0), '$TMP,,,,-80,,,,,,,,*');
  assert.equal(frameFor(1), '$TMP,,,,-80,,,,,,,,*', 't4 is global and independent of weapon-frame shape');
});

// ---------- F259: the magazine account ----------

test('F259: a CLOCK-DRIVEN write stands down while the trigger has asked for a round the gun has not reported', () => {
  // A write takes 30-90 ms to reach the gun. One sent while a round is on its way out would land after that
  // round had left, and its `$AMMO` would put it back. The degrade write is never affected -- it fires from
  // the `$ALCD` that just answered the press -- so this only holds back the writes that pick their own moment.
  const h = degraded();
  h.frame('$BUT,0,1,*');                              // a round is leaving; the gun has not said so yet
  assert.equal(h.eng._acctOutstanding(0), true);
  h.adv(SETTLE_MS + 10); h.eng.tick();                // the recovery write is due
  assert.equal(weaps(h).length, 0, 'a write went out with a round in flight -- its $AMMO would hand the round back');
  h.frame(`$ALCD,${--h.mag},20,0,215,0,*`);           // the gun reports the round
  assert.equal(h.eng._acctOutstanding(0), false);
  h.eng.tick();
  assert.equal(weaps(h).length, 1, 'and it goes out the moment the gun has caught up -- held, not lost');
  assert.equal(ammos(h).length, 0, 't4 recovery leaves the magazine alone');
});

test('F259: the restore VALUE nets a press the gun has not answered -- the stun and resync writers read it too', () => {
  // `_acctLive` is what `_liveAmmo` hands the stun snapshot and the operator resync, and neither of those
  // consults the `shotInFlight` guard: they write when the game says to. So the value itself has to be right.
  const h = armRecoil(RECOIL_PROFILE);
  fire(h, 2); ack(h);                  // two ordinary rounds, nothing to do with the recoil threshold -- the gun and the node both say 34
  assert.equal(h.eng._acctLive(0), 34, 'pre-condition: the account tracks the gun');
  h.frame('$BUT,0,1,*');               // the next round's trigger press -- the gun has not answered yet
  assert.equal(h.eng._acctLive(0), 33, 'the press must book the round straight away: it is the earliest evidence one is leaving');
  assert.deepEqual(h.eng._liveAmmo()[0], [33, 215], 'and every writer that restores a magazine must see that number');
  h.frame('$ALCD,33,20,0,215,0,*');    // the gun catches up: the same round, not a second one
  assert.equal(h.eng._acctLive(0), 33, 'the $ALCD must ANSWER the press, never be counted on top of it');
});

test('F259: the gun always wins -- an $ALCD with no write in flight re-seats the account on the gun\'s number', () => {
  const h = armRecoil(RECOIL_PROFILE);
  h.eng._shotAcct[0] = { mag: 12, fired: 0, at: 0 };   // a badly drifted account
  h.frame('$ALCD,35,100,0,210,0,*');                              // the gun's own word, nothing in flight
  assert.equal(h.eng._shotAcct[0].mag, 35, 'the account must take the gun\'s number, never argue with it');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng._acctLive(0), 34, 'pre-condition: the press books a round');
  h.adv(TRIGGER_NO_FIRE_MS); h.eng.tick();
  assert.equal(h.eng._acctLive(0), 35, 'a press the gun never answered must expire, not hold the account down for the life');
  // CONTROL: inside the ECHO WINDOW the same frame is refused, because the node has just told the gun what
  // to hold and every `$ALCD` until it confirms is the node's own write coming back.
  h.eng._acctWrote(0, 35);
  h.frame('$ALCD,36,100,0,215,0,*');
  assert.equal(h.eng._shotAcct[0].mag, 35, 'a magazine that moved inside the echo window is the node\'s own write, not news');
});

test('F259: the echo window covers BOTH answers to a write -- the $WEAP reset AND the $AMMO restore', () => {
  // The bench oscillation in one test. The node writes `$AMMO,0,6`; the gun answers `$ALCD 32` (its `$WEAP`
  // reset) and then `$ALCD 6` (the restore landing). Judging those one at a time -- refusing the rise, then
  // taking the fall as a 26-round decrement -- is exactly what fed the burst counter and made the writer
  // flap. Neither frame may move the account, and neither may cost a round.
  const h = armRecoil(RECOIL_PROFILE);
  h.frame('$ALCD,6,100,0,215,0,*');           // the gun is down to 6; the account agrees
  assert.equal(h.eng._acctLive(0), 6);
  const burstBefore = h.eng._recoil.burst;
  // The 30-round drop above already degraded the weapon and wrote for it, so a window is open with that
  // write's own reset and restore still in the air. This test is about ONE write, so start its count from
  // one: the window now counts unanswered writes, not just the clock (polish review 2026-09-18).
  h.eng._shotAcct[0].echoPending = 0;
  h.eng._acctWrote(0, 6);                     // the node writes $WEAP + $AMMO,0,6
  h.frame('$ALCD,32,100,0,215,0,*');          // answer 1: the $WEAP reset, back up to the compiled clip
  assert.equal(h.eng._acctLive(0), 6, 'the reset echo must not move the account');
  h.frame('$ALCD,6,100,0,215,0,*');           // answer 2: our own restore landing
  assert.equal(h.eng._acctLive(0), 6, 'the restore echo must not move the account either');
  assert.equal(h.eng._recoil.burst, burstBefore,
    'the node read its OWN write back as 26 rounds fired -- that is the bench oscillation (F259, 2026-09-18)');
  // the confirming frame closes the window early, so the gun is back in charge within one round trip
  assert.equal(h.eng._acctEchoing(0), false, 'the gun reporting the written number must close the window');
  h.frame('$ALCD,5,100,0,215,0,*');           // a REAL round now
  assert.equal(h.eng._acctLive(0), 5);
  assert.equal(h.eng._recoil.burst, burstBefore + 1, 'and a real round must still cost the burst counter one');
});

test('F259: the echo window is not open for ever -- a write the gun never answers hands the slot back', () => {
  const h = armRecoil(RECOIL_PROFILE);
  h.frame('$ALCD,6,100,0,215,0,*');
  h.eng._acctWrote(0, 6);
  h.adv(ACC_ECHO_MS + 10);
  assert.equal(h.eng._acctEchoing(0), false, 'the backstop deadline must expire');
  h.frame('$ALCD,30,100,0,215,0,*');
  assert.equal(h.eng._acctLive(0), 30, 'and the gun wins again');
});

test('F259: a press the model says cannot fire is never booked -- an empty magazine, a stun, a swap', () => {
  const h = armRecoil(RECOIL_PROFILE);
  h.eng._shotAcct[0] = { mag: 0, fired: 0, at: 0 };
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng._shotAcct[0].fired, 0, 'a dry trigger on an empty magazine must not book a round');
  h.eng._shotAcct[0] = { mag: 10, fired: 0, at: 0 };
  h.eng.switching = { at: h.eng.now(), from: 0 };
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng._shotAcct[0].fired, 0, 'a press mid-swap produces no round, so it must not book one');
  h.eng.switching = null;
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng._shotAcct[0].fired, 1, 'CONTROL: the same press with nothing in the way IS booked');
});

// ---------- S42: the writer's guards, unchanged by F259 ----------
// Each one arms, fires a burst to DEGRADED, closes the verify window, then puts the guard on and lets the
// trigger go quiet -- so the write under test is the recovery write, which is due and held.

/** Arm, degrade, confirm, and clear the write log: the model is now idle at DEGRADED with a recovery write
 *  one settle away. */
function degraded(profile = RECOIL_PROFILE) {
  const h = armRecoil(profile);
  fire(h); ack(h);
  assert.equal(h.eng._recoil.state, 'degraded', 'pre-condition: the burst must have degraded the weapon');
  assert.equal(h.eng._recoil.pendingWriteAt, 0, 'pre-condition: the gun must have confirmed the write');
  h.writes.length = 0;
  return h;
}
/** Let the trigger go quiet so the recovery write is due, and tick. */
function settle(h) { h.adv(SETTLE_MS + 10); h.eng.tick(); }

test('S42: never between a reload-lever pull and the magazine refill', () => {
  const h = degraded();
  h.eng.reloading = { at: h.eng.now(), ms: 1400, slot: 0, from: 34, cap: 32, mag: 34 };   // simulate the lever pull directly -- isolates the guard from the reload takeover's own state machine
  settle(h);
  assert.equal(weaps(h).length, 0, 'a write landed WHILE RELOADING -- the guard did not hold');
  h.eng.reloading = null;                                    // the refill lands
  h.eng.tick();
  assert.equal(weaps(h).length, 1, 'the write must go out once the reload is over -- the value was not lost, only held');
});

test('S42: never mid weapon-swap', () => {
  const h = degraded();
  h.eng.switching = { at: h.eng.now(), from: 0 };
  settle(h);
  assert.equal(weaps(h).length, 0, 'a write landed WHILE SWAPPING -- the guard did not hold');
  h.eng.switching = null;
  h.eng.tick();
  assert.equal(weaps(h).length, 1, 'the write must go out once the swap is over');
});

test('S42/F229: never during an overheat lockout -- the guard reads the gun\'s own heat from $ALCD token 5, not a flag of ours', () => {
  // The guard used to read `this.overheatLocked`, which NOTHING in the engine ever set, so it was dead
  // code and the writer was free to write through a lockout. This test drives a real heat frame instead
  // of setting a flag, which is the only shape that can catch that mistake. Bench 2026-09-17 (F229): the
  // Energy Rifle stops firing at heat 99, does not cool on its own, and vents about 35 per lever pull.
  const h = degraded();
  h.frame(`$ALCD,${h.mag},20,0,215,99,*`);                   // the gun reports itself locked out
  assert.equal(h.eng._heatBlocksFire(), true, 'heat 99 must read as an overheat lockout');
  settle(h);
  assert.equal(weaps(h).length, 0, 'a write landed WHILE OVERHEATED -- the guard did not hold');
  h.frame(`$ALCD,${h.mag},20,0,215,64,*`);                   // one lever pull vents about 35: 99 -> 64
  assert.equal(h.eng._heatBlocksFire(), false);
  h.eng.tick();
  assert.equal(weaps(h).length, 1, 'the write must go out once the gun has vented -- the value was held, not lost');
});

test('S42: verify and retry -- a first mismatch retries once; a second gives up, restores the crisp value with the accounted ammo, and stops driving this life', () => {
  // `settle_ms` is huge here: this test waits out TWO full verify-grace windows, and a settle landing
  // inside them would restore the crisp value for its own, unrelated reason.
  const h = armRecoil({ ...RECOIL_PROFILE, settle_ms: 999999 });
  h.writes.length = 0;
  fire(h);                                                    // degraded: written 20
  assert.equal(weaps(h).length, 1);
  // the gun never answers with 20 -- every $ALCD in the grace window still reports the crisp value
  h.frame(`$ALCD,${h.mag},100,0,215,0,*`);                    // stale answer, no decrement -- lastSeenAcc stays 100
  h.adv(ACC_VERIFY_GRACE_MS + 10); h.eng.tick();              // grace expires unconfirmed -> retry (re-sends 20)
  assert.equal(weaps(h).length, 2, 'the first mismatch must retry exactly once');
  assert.equal(weaps(h)[1].split(',')[22], '60', 'the retry re-sends the SAME value, not a fresh one');
  h.frame(`$ALCD,${h.mag},100,0,215,0,*`);                    // the retry also gets fresh contrary evidence
  h.adv(ACC_VERIFY_GRACE_MS + 10); h.eng.tick();              // the retry also goes unconfirmed
  assert.equal(weaps(h).length, 3, 'a second failure must write once more: the crisp restore');
  const restore = weaps(h)[2].split(',');
  assert.equal(restore[22], '100', 'the give-up write must restore the CRISP value, not leave the gun on the failed one');
  assert.equal(restore[23], '100');
  assert.equal(h.eng._recoil.state, 'crisp');
  assert.ok(h.eng._recoil.disabled, 'the model must stop driving accuracy for the rest of this life');
  h.writes.length = 0;
  fire(h, 10);                                                // more shots after giving up
  h.adv(ACC_WRITE_MIN_GAP_MS + 10); h.eng.tick();
  assert.equal(weaps(h).length, 0, 'a disabled model must never write again this life');
});

test('S42/F259: a respawn resets the weapon to CRISP', () => {
  // `settle_ms` is enormous on purpose: the 9 s wait for the auto-respawn must not be long enough for the
  // SETTLE clock alone to put the weapon back to crisp -- that would pass even if `_recoilArm('revive')`
  // never ran. Settling has its own dedicated test above.
  const h = armRecoil({ ...RECOIL_PROFILE, settle_ms: 999999999 });
  fire(h);
  assert.equal(h.eng._recoil.state, 'degraded', 'the burst did not degrade the weapon');
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');   // death (immediate, via _onHp)
  h.adv(9000); h.eng.tick();                                    // auto respawn (8 s delay in the harness config)
  assert.equal(h.eng.alive, true, 'the respawn must have actually happened for this test to mean anything');
  assert.equal(h.eng._recoil.state, 'crisp');
  assert.equal(h.eng._recoil.value, RECOIL_PROFILE.ceiling, 'a fresh life must start back at the crisp value, not wherever the last life left it');
  assert.equal(h.eng._recoil.burst, 0, 'and with no burst carried over from the life that ended');
});

test('S42: config.recoil === false turns the whole model off -- no arm, no write, shots still count normally', () => {
  const h = armRecoil(RECOIL_PROFILE, { recoilConfig: false });
  assert.equal(h.eng._recoil, null, 'recoil must not arm at all when the host has switched it off');
  h.writes.length = 0;
  fire(h, 10);
  h.adv(SETTLE_MS + 10); h.eng.tick();
  assert.equal(weaps(h).length, 0, 'no accuracy write must ever appear while config.recoil is false');
  assert.equal(h.eng.shots, 10, 'the ordinary shot counter must still work -- only the accuracy model is off');
});

// ---------- S42 x A44/A47/F15: t4 ordering around multi-frame gun transitions ----------
// Spawn, revive, operator RESYNC GUN and stun own `$AMMO` transitions and their replies. The t4 writer carries
// no ammo, but `_holdAccuracyWrites` still keeps its verification out of those reply windows.

test('S42 x A44: the SPAWN write owns $AMMO -- no accuracy write lands inside the hold, and the held state is not lost', () => {
  const h = harness();
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster,
    catalog: { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', clip: 32, reserve: 384, reload_s: 1.4, dmg: 8, recoil: { ...RECOIL_PROFILE, settle_ms: 999999 } }], perks: [] } } });
  h.config_().echo().start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.mag = 36; h.writes.length = 0;
  // A burst in the first moments of a life: the model degrades, but the spawn write still owns `$AMMO`.
  // `settle_ms` is enormous so the weapon cannot go crisp again on its own while the hold runs.
  fire(h);
  h.adv(ACC_WRITE_MIN_GAP_MS + 10); h.eng.tick();
  assert.equal(weaps(h).length, 0,
    'an accuracy write landed inside the spawn hold -- its $AMMO would put the previous counts back over the spawn write');
  assert.equal(h.eng._recoil.state, 'degraded', 'the hold must delay the WRITE, never the model');
  h.adv(ACC_HOLD_MS); h.eng.tick();
  assert.equal(weaps(h).length, 1, 'once the hold lifts the held state must go out exactly once');
  assert.equal(weaps(h)[0].split(',')[22], '60', 'and it must carry the degraded value, not the crisp one');
});

test('S42 x A47: an operator RESYNC GUN holds the accuracy writer, then the live value is re-asserted', () => {
  const h = armRecoil({ ...RECOIL_PROFILE, settle_ms: 999999 });
  fire(h);                                               // degraded: written and pending
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'resync', player_id: 'p1', match_id: 'm1' } });
  h.frame(`$HP,${h.eng.hp},${h.eng.armor},${h.eng.shield},*`);
  assert.ok(h.facts.some(f => f.type === 'operator_result' && f.cmd === 'resync' && f.ok === true),
    'pre-condition: the operator resync must be accepted');
  assert.ok(h.writes.some(f => f.startsWith(`$AMMO,0,${36 - DEGRADE_AFTER},`)), 'pre-condition: the resync re-sends the accounted counts');
  h.writes.length = 0;
  h.adv(ACC_WRITE_MIN_GAP_MS + 10); h.eng.tick();
  assert.equal(weaps(h).length, 0,
    'an accuracy write landed while the resync owned $AMMO -- the two would race on the same counts');
  h.adv(ACC_HOLD_MS); h.eng.tick();
  assert.equal(weaps(h).length, 1, 'the writer must re-assert the live value once the resync hold lifts');
  assert.equal(weaps(h)[0].split(',')[22], '60', 'and re-assert the state the model holds, not the crisp value');
});

test('S42 x F15: a stun disarms the gun, and no accuracy write may re-arm it', () => {
  const h = armRecoil(RECOIL_PROFILE);
  fire(h);
  h.eng.config.stun = { duration_s: 4 };   // `stunEnabled`/`stunMs` are getters off the config -- F15
  h.writes.length = 0;
  h.eng._stun();
  assert.ok(h.writes.some(f => f === '$AMMO,0,0,0,1,*'), 'pre-condition: the stun disarms slot 0');
  h.writes.length = 0;
  h.frame('$ALCD,33,100,0,215,0,*');                       // even a frame arriving mid-stun must not open a write
  for (let i = 0; i < 6; i++) { h.adv(500); h.eng.tick(); }
  assert.equal(weaps(h).length, 0,
    'an accuracy write landed DURING a stun -- its $AMMO restore would hand the player their magazine back');
});

test('S42 x pl4: no accuracy write during an overheat lockout, and the writer resumes once the gun cools', () => {
  const h = armRecoil(RECOIL_PROFILE);
  h.writes.length = 0;
  for (let i = 0; i < DEGRADE_AFTER - 1; i++) { h.adv(60); h.frame(`$ALCD,${--h.mag},100,0,215,0,*`); }
  h.adv(60); h.frame(`$ALCD,${--h.mag},100,0,215,120,*`);   // the threshold round, with the gun already locked out (heat past the lockout line)
  assert.equal(h.eng._heatBlocksFire(), true, 'pre-condition: the node must read the lockout');
  h.adv(ACC_HOLD_MS + ACC_WRITE_MIN_GAP_MS + 10); h.eng.tick();
  assert.equal(weaps(h).length, 0,
    'an accuracy write landed during an overheat lockout -- a locked gun cannot fire, so the write is a $WEAP re-push for nothing');
  h.frame(`$ALCD,${h.mag},100,0,215,4,*`);                 // vented/cooled: heat back under the line
  assert.equal(h.eng._heatBlocksFire(), false);
  h.adv(ACC_WRITE_MIN_GAP_MS + 10); h.eng.tick();
  assert.equal(weaps(h).length, 1, 'the held value must go out once the lockout clears');
});

test('F68 x A11.6: a deliberate headset paint owns the strip, and the periodic repaint is only a backstop', () => {
  const h = harness();
  const teamRest = '$HLED,1,0,,,10,,*';
  const bundle = { ...h.bundle, headset: { ...golden.headset, in_play: 'team', rest: teamRest,
    start: [[golden.headset.start[0][0], 0.6], [teamRest, 0]], hit: [['$HLED,0,2,100,100,10,2,*', 0.5], [teamRest, 0]] } };
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: bundle, roster: h.roster } });
  h.eng.feedFrame('$LCD,0,0,0,0,0,0,*'); h.start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.eng._lastTeamRepaintAt = h.eng.now();
  // Most of an interval passes, then a HIT paints the strip. That paint is the strip's owner now, so the
  // backstop clock restarts from it: the repaint must NOT fire a moment later on the old schedule.
  h.adv(TEAM_REPAINT_MS - 500); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  h.writes.length = 0;
  h.adv(600); h.eng.tick();
  assert.equal(h.writes.filter(f => f === teamRest).length, 0,
    'the periodic repaint fired right behind a deliberate paint -- the two would fight on a 5 s beat');
  h.adv(TEAM_REPAINT_MS); h.eng.tick();
  assert.equal(h.writes.filter(f => f === teamRest).length, 1, 'a full interval after the last real paint, the backstop repaints once');
});

// ---------- A48 (merge 2026-09-17): the catalogue names the weapon class and the cost of a full charge ----------

test('A48: state() carries weaponClass and roundsPerCharge straight off the catalogue row', () => {
  const h = harness();
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  h.player.loadout.weapons = [{ weapon_id: 'charge_rifle' }];
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster,
    catalog: { weapons: [{ weapon_id: 'charge_rifle', name: 'Charge Rifle', weapon_class: 'energy', rounds_per_charge: 10, clip: 40, reserve: 80 }], perks: [] } } });
  const st = h.eng.state();
  assert.equal(st.weaponClass, 'energy', 'the HUD reads the CLASS, never the weapon id, to decide an energy gauge');
  assert.equal(st.roundsPerCharge, 10, 'the HUD reads the charge cost, never a hard-coded constant');
});

test('A48: a weapon with no class or charge cost reports null, so the HUD falls back instead of guessing', () => {
  const h = harness();
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster,
    catalog: { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', clip: 32, reserve: 384 }], perks: [] } } });
  const st = h.eng.state();
  assert.equal(st.weaponClass, null);
  assert.equal(st.roundsPerCharge, null);
});

// ---------- F229 (merge 2026-09-17): the Energy Rifle really overheats, and it does NOT cool on its own ----------
// t38 = 150 switches its overheat on: heat climbs about +3 a shot, locks at 99, and stays there until the
// reload lever vents it (about 35 a pull). Two rules have to survive a weapon that stays hot: OVERHEAT must
// not sit on the HUD for the whole life when the player simply stops firing, and a vent must clear it at once.

test('F229: OVERHEAT does not stick for the life -- the word clears OVERHEAT_SHOWN_MS after the last evidence', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,270,100,0,600,96,*');                     // Energy Rifle heat climbing, still under the line
  assert.equal(h.eng.state().overheatShown, false, 'below 99 is build-up, not a lockout');
  h.frame('$ALCD,269,100,0,600,99,*');                     // the shot that locks it: AT 99, never above 100
  assert.equal(h.eng.state().overheatShown, true, 'the lockout reading must raise OVERHEAT');
  // The player gives up and stops pulling. The gun sends nothing at all while it is locked, and an Energy
  // Rifle does not cool on its own -- so the ONLY thing that can take the word down is this window.
  h.adv(OVERHEAT_SHOWN_MS + 10);
  assert.equal(h.eng.state().overheatShown, false, 'OVERHEAT stuck with no fresh evidence -- it would sit there for the whole life');
  assert.equal(h.eng.state().heat, 99, 'the heat BAR still reads hot: the gauge is the standing fact, the word is the alert');
});

test('F229: a trigger press keeps OVERHEAT up while the player is still trying, and a lever vent clears it at once', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,269,100,0,600,99,*');
  assert.equal(h.eng.state().overheatShown, true);
  // Still trying: each unanswered pull is fresh evidence the lockout is on (the gun sends no $ALCD).
  for (let i = 0; i < 4; i++) { h.adv(OVERHEAT_SHOWN_MS - 500); h.frame('$BUT,0,1,*'); h.frame('$BUT,0,0,*'); }
  assert.equal(h.eng.state().overheatShown, true, 'a player still pulling the trigger must keep the word up');
  // The lever vents about 35 heat: the gun answers with a reading under the line, and OVERHEAT goes at once.
  h.frame('$ALCD,269,100,0,600,64,*');
  assert.equal(h.eng.state().overheatShown, false, 'a vent must clear OVERHEAT immediately, not OVERHEAT_SHOWN_MS later');
  assert.equal(h.eng._heatBlocksFire(), false, 'and the lockout itself is over: 64 is under the line');
  assert.equal(h.eng.state().heat, 64, 'the bar follows the vent down');
});

test('reload handle pull opens a reload for the weapon\'s reload_s; the mag coming back closes it', () => {
  const h = harness().kit().config_().echo().start(0);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, catalog: { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', clip: 32, reserve: 384, reload_s: 1.4 }], perks: [] } } });
  h.eng.tick();
  assert.equal(h.eng.phase, 'live');
  h.frame('$ALCD,20,100,0,384,0,*');                       // 12 rounds gone
  h.frame('$BUT,2,1,*');
  let s = h.eng.state();
  assert.equal(s.reloading, true, 'reloading after the handle pull');
  assert.equal(s.reloadTotalMs, 1400, 'the catalog reload_s drives the takeover length');
  h.adv(700); s = h.eng.state(); assert.equal(s.reloadMs, 700);
  h.frame('$ALCD,32,100,0,372,0,*');                       // the gun refilled the mag
  assert.equal(h.eng.state().reloading, false, 'the mag coming back ends the reload');
});
test('a reload the gun never echoes still clears after reload_s plus grace; no reload while dead or with a full mag', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*'); h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, false, 'a full mag has nothing to reload');
  h.frame('$ALCD,10,100,0,384,0,*'); h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, true);
  assert.equal(h.eng.state().reloadTotalMs, 1500, 'unknown weapon → 1.5 s default');
  h.adv(1500 + 600 + 1);
  // F27: hardware takes ~1.25x the catalog reload_ms to put the mag back (charge rifle 3220 vs 2500), so
  // the ceiling is `ms + max(600, ms/2)` — at 1.5 s nominal that is 2250 ms, and 2101 is still inside it.
  assert.equal(h.eng.state().reloading, true, 'still waiting for the gun inside the overrun allowance');
  assert.equal(h.eng.state().reloadOverrun, true, 'past nominal, magazine not back yet');
  h.adv(200); h.eng.tick();
  assert.equal(h.eng.state().reloading, false, 'expired without an echo');
  const out = h.eng.state().reloadOutcome;
  // F123: the whole point — a reload the gun never performed must NOT read as a success
  assert.ok(out && out.ok === false && out.gained === 0 && out.why === 'timeout', 'booked as a FAILED reload: ' + JSON.stringify(out));
  h.frame('$HP,0,0,0,*');
  h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, false, 'dead: no reload');
});
// ── F123: $BUT releases, held buttons, and a reload takeover reconciled against REAL ammo ────────
// Field 2026-09-11: "easy reload does not work with the shotgun… holding alt fire doesnt work", then
// "the hud animates reloading, but the gun doesnt actually reload". Three stacked faults; these cover
// the two that live here (the third, the easy_reload + chain-reload pairing, is excluded by MC policy).

/** A live gun on slot 1 (golden `$AMMO,1,6,24` = a 6-round tube) with a shell-by-shell reload time. */
function shellHarness() {
  const h = goLive(harness());
  h.eng.catalog = { weapons: [{ weapon_id: 'assault_rifle', name: 'AR', reload_s: 1.4 },
                              { weapon_id: 'shotgun', name: 'Shotgun', reload_s: 0.4 }], perks: [] };
  h.eng.player = { ...h.eng.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'shotgun' }] } };
  h.frame('$ALCD,1,100,1,24,0,*');    // on the shotgun, one shell left
  return h;
}

test('F123: a $BUT release is recorded — held buttons are observable, and the hold is measured', () => {
  // brx-protocol.md §$BUT: "state 1 press / 0 release". The release was on the wire all along and the node
  // discarded it, which is why a HELD button (the shotgun's per-shell reload chain) could not be seen.
  const h = goLive(harness());
  h.frame('$BUT,2,1,*');
  assert.deepEqual(h.eng.state().held, { 2: 0 }, 'the reload handle is down');
  h.adv(700);
  assert.deepEqual(h.eng.state().held, { 2: 700 }, 'and has been down 700 ms');
  h.frame('$BUT,2,0,*');
  assert.deepEqual(h.eng.state().held, {}, 'released');
  assert.deepEqual(h.eng.state().lastButton, { id: 2, state: 0, at: h.eng.now(), heldMs: 700 });
  // a repeat press with no release between keeps the FIRST edge, so a hold is not reset by key repeat
  h.frame('$BUT,0,1,*'); h.adv(100); h.frame('$BUT,0,1,*'); h.adv(100);
  assert.equal(h.eng.state().held[0], 200, 'the hold is measured from the first press');
});

test('F123: a release NEVER cancels a reload — a magazine weapon is let go instantly and still loads', () => {
  const h = shellHarness();
  h.frame('$ALCD,10,100,0,192,0,*');            // back on the rifle, part-empty
  h.frame('$BUT,2,1,*'); h.frame('$BUT,2,0,*'); // tap the handle and let go, as you do on a magazine weapon
  assert.equal(h.eng.state().reloading, true, 'the takeover survives the release');
  h.adv(1450); h.eng.tick();
  assert.equal(h.eng.state().reloading, true, 'and is still waiting for the gun past nominal');
  h.frame('$ALCD,32,100,0,160,0,*');            // the gun puts the mag back
  const st = h.eng.state();
  assert.equal(st.reloading, false);
  assert.ok(st.reloadOutcome.ok && st.reloadOutcome.filled, 'a real reload reads as a success');
  assert.equal(st.reloadOutcome.why, 'filled');
});

test('F123: a shell-by-shell chain runs to the end — shell #1 no longer ends the animation', () => {
  const h = shellHarness();
  h.frame('$BUT,2,1,*');                        // the handle goes down and STAYS down
  assert.equal(h.eng.state().reloading, true);
  assert.equal(h.eng.state().reloadTotalMs, 400, 'nominal is the PER-SHELL time on a chain weapon');
  for (const [ms, mag] of [[420, 2], [423, 3], [390, 4]]) {
    h.adv(ms); h.eng.tick(); h.frame(`$ALCD,${mag},100,1,${24 - (mag - 1)},0,*`);
    assert.equal(h.eng.state().reloading, true, `still reloading after shell ${mag} — the chain is not over`);
  }
  assert.equal(h.eng.state().reloadGained, 3, 'three shells in so far');
  h.adv(420); h.frame('$ALCD,5,100,1,19,0,*');
  h.adv(420); h.frame('$ALCD,6,100,1,18,0,*');  // the tube is full: cap from the spawn $AMMO,1,6,24
  const st = h.eng.state();
  assert.equal(st.reloading, false, 'the tube is full — the takeover ends on the AMMO, not on a timer');
  assert.deepEqual({ ok: st.reloadOutcome.ok, filled: st.reloadOutcome.filled, gained: st.reloadOutcome.gained, why: st.reloadOutcome.why },
                   { ok: true, filled: true, gained: 5, why: 'filled' });
});

test('F123: a chain the player breaks off part-way is booked as PARTIAL, not as a success', () => {
  const h = shellHarness();
  h.frame('$BUT,2,1,*');
  h.adv(420); h.frame('$ALCD,2,100,1,23,0,*');
  h.adv(420); h.frame('$ALCD,3,100,1,22,0,*');
  h.frame('$BUT,2,0,*');                        // let go: the gun stops feeding shells
  h.adv(1200); h.eng.tick();
  const out = h.eng.state().reloadOutcome;
  assert.equal(h.eng.state().reloading, false);
  assert.deepEqual({ ok: out.ok, filled: out.filled, gained: out.gained, to: out.to, cap: out.cap },
                   { ok: true, filled: false, gained: 2, to: 3, cap: 6 }, 'two shells in, four short');
});

test('F123: the reload the GUN NEVER DID does not animate as a success (the easy_reload symptom)', () => {
  // easy_reload compiles to `$BMAP,1,97` — a MOMENTARY alt-fire remap. On a chain-reload weapon one tap
  // emits one reload event and the mag never comes back. The old `reloadingMs()` was a pure timer, so this
  // looked identical to a completed reload. It must not.
  const h = shellHarness();
  h.eng.catalog = { ...h.eng.catalog, perks: [{ perk_id: 'easy_reload', name: 'Easy Reload', effects: { alt_reload: true } }] };
  h.eng.player = { ...h.eng.player, loadout: { weapons: [{ weapon_id: 'shotgun' }], perk: 'easy_reload' } };   // one slot + easy_reload: ALT falls back to reload
  h.frame('$BUT,1,1,*'); h.frame('$BUT,1,0,*');
  assert.equal(h.eng.state().reloading, true, 'the takeover starts');
  h.adv(2000); h.eng.tick();                     // nothing arrives from the gun
  const st = h.eng.state();
  assert.equal(st.reloading, false);
  assert.equal(st.reloadOutcome.ok, false, 'booked as a FAILED reload');
  assert.equal(st.reloadOutcome.gained, 0);
  assert.equal(st.reloadOutcome.why, 'timeout');
});

test('F27: hardware takes ~1.25x the catalog reload time and the takeover still waits for it', () => {
  // Measured handle-to-refill (HANDOFF): AR 1701 vs a 1400 catalog, burst 2160 vs 1700, charge 3220 vs 2500.
  // A flat 600 ms grace clears the first two and misses the charge rifle, ending the takeover one frame
  // before the gun's own echo — i.e. booking a real reload as a failure.
  for (const [nominal, real] of [[1.4, 1701], [1.7, 2160], [2.5, 3220]]) {
    const h = goLive(harness());
    h.eng.catalog = { weapons: [{ weapon_id: 'assault_rifle', name: 'AR', reload_s: nominal }], perks: [] };
    h.frame('$ALCD,10,100,0,192,0,*');
    h.frame('$BUT,2,1,*'); h.frame('$BUT,2,0,*');
    h.adv(real); h.eng.tick();
    assert.equal(h.eng.state().reloading, true, `${nominal}s nominal: still waiting at ${real} ms`);
    h.frame('$ALCD,32,100,0,170,0,*');
    assert.equal(h.eng.state().reloadOutcome.ok, true, `${nominal}s nominal: the late refill is a success`);
  }
});

test('pl4: an Energy Rifle recharge that lands 3.5-3.9 s after the pull is a success, not "reload did NOT take"', () => {
  // Bench 2026-09-17 (brx-weapons): a hold of 0.7 s or more refilled the whole cell in one step, 3.5-3.9 s after
  // the pull started. The catalogue says 2400 ms, so the old ceiling (2400 + 1200) ran out at 3600 ms.
  for (const real of [3500, 3900]) {
    const logs = [];
    const h = goLive(harness());
    h.eng.log = (l, c) => logs.push([l, c]);
    h.eng.player.loadout.weapons[0] = { weapon_id: 'energy_rifle' };
    h.eng.catalog = { weapons: [{ weapon_id: 'energy_rifle', name: 'Energy Rifle', reload_s: 2.4 }], perks: [] };
    h.frame('$ALCD,10,100,0,600,0,*');
    h.frame('$BUT,2,1,*');
    h.adv(real - 1); h.eng.tick();
    assert.equal(h.eng.state().reloading, true, `still waiting at ${real - 1} ms`);
    h.adv(1); h.frame('$BUT,2,0,*');
    h.frame('$ALCD,300,100,0,310,0,*');
    assert.equal(h.eng.state().reloadOutcome.ok, true, `a refill at ${real} ms is a success`);
    assert.ok(!logs.some(([l]) => /did NOT take/.test(l)), JSON.stringify(logs));
  }
  const h = goLive(harness());   // control: a tap that refills nothing still times out, just later
  h.eng.player.loadout.weapons[0] = { weapon_id: 'energy_rifle' };
  h.eng.catalog = { weapons: [{ weapon_id: 'energy_rifle', name: 'Energy Rifle', reload_s: 2.4 }], perks: [] };
  h.frame('$ALCD,10,100,0,600,0,*'); h.frame('$BUT,2,1,*'); h.frame('$BUT,2,0,*');
  h.adv(3900 + 600 + 1); h.eng.tick();
  assert.equal(h.eng.state().reloadOutcome && h.eng.state().reloadOutcome.why, 'timeout');
});

test('F123: firing during a reload ends the takeover, and reloadingMs() stays pure', () => {
  const h = shellHarness();
  h.frame('$BUT,2,1,*');
  h.adv(420); h.frame('$ALCD,2,100,1,23,0,*');
  h.adv(300); h.frame('$ALCD,1,100,1,23,0,*');   // a shot: the player stopped loading and started shooting
  const st = h.eng.state();
  assert.equal(st.reloading, false);
  assert.equal(st.reloadOutcome.why, 'fired');
  // PURE: state() is called on every render and must not move anything
  const before = JSON.stringify([h.eng.ammo, h.eng.activeSlot, h.eng.reloading]);
  for (let i = 0; i < 5; i++) h.eng.state();
  assert.equal(JSON.stringify([h.eng.ammo, h.eng.activeSlot, h.eng.reloading]), before);
});

test('F123: death and a lost link clear the takeover and do not leave a stale verdict', () => {
  const h = shellHarness();
  h.frame('$BUT,2,1,*');
  h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.state().reloading, false);
  assert.equal(h.eng.state().reloadOutcome, null, 'a death is not a reload verdict');
  assert.deepEqual(h.eng.state().held, {}, 'no button survives a death');
  const g = shellHarness();
  g.frame('$BUT,2,1,*');
  g.eng.onBleDropped();
  assert.equal(g.eng.state().reloading, false);
  assert.equal(g.eng.state().reloadOutcome.why, 'dropped', 'the link went away, not the reload');
});

test('score push exposes hits and the board; lives derive from config.respawn.lives minus deaths', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.eng.onMcMessage({ kind: 'score', body: { kills: 4, deaths: 1, assists: 0, accuracy: 40, hits: 8, shots_total: 20, board: { teams: [{ team_id: 'blue', name: 'BLUE', score: 18 }, { team_id: 'yellow', name: 'YELLOW', score: 21 }], cap: 25 } } });
  const s = h.eng.state();
  assert.equal(s.hits, 8); assert.equal(s.board.cap, 25); assert.equal(s.board.teams[1].score, 21);
  assert.equal(s.fragLimit, 25); assert.equal(s.lives, null, 'no lives cap in this config');
  h.eng.config.scoring = { frag_limit: 10, win_by: 'objective' };
  assert.equal(h.eng.state().fragLimit, null);
  assert.equal(h.eng.state().board.cap, null, 'objective scoring hides an ignored legacy kill cap');
  h.eng.config.scoring = { frag_limit: 10 };
  assert.equal(h.eng.state().fragLimit, 10, 'legacy kill configs without win_by retain their cap');
  h.eng.config.respawn.lives = 3; h.eng.deaths = 2;
  assert.equal(h.eng.state().lives, 1);
});
test('a new match_id drops the previous match\'s score row; a dry reserve never opens a reload', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.eng.onMcMessage({ kind: 'score', body: { kills: 4, deaths: 1, assists: 0, board: { teams: [], cap: 25 } } });
  assert.equal(h.eng.state().kills, 4);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  h.config_().echo();
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.eng.now(), config_id: golden.config_id, seq: 2, countdown_s: 0 } }); h.eng.tick();
  assert.equal(h.eng.state().kills, null, 'match 2 starts with no score row');
  h.frame('$ALCD,0,100,0,0,0,*'); h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, false, 'nothing to reload from an empty reserve');
});
test('with one weapon loaded and no easy_reload, ALT does nothing (compile.py maps it to fn 98, inert)', () => {
  // Bench 2026-09-17 (match 592e444eff): "the alt button is reloading the charge rifle" -- with an empty
  // slot 1 and no easy_reload, the gun's ALT is now fn 98 (inert), so a RELOADING takeover here would
  // never be answered by any $ALCD. Falling back to reload for every one-weapon loadout was the bug.
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,10,100,0,384,0,*'); h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().reloading, false, 'ALT with an empty slot 1 and no easy_reload opens nothing');
  assert.equal(h.eng.state().switching, false, 'and not a weapon swap either');
});
test('with one weapon loaded AND easy_reload, ALT falls back to reload and opens the same takeover', () => {
  // easy_reload keeps ALT -> fn 97 (RELOAD) on purpose (loadout.md §2 `alt_reload`; compile.py).
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.eng.catalog = { weapons: [], perks: [{ perk_id: 'easy_reload', name: 'Easy Reload', effects: { alt_reload: true } }] };
  h.eng.player = { ...h.eng.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: 'easy_reload' } };
  h.frame('$ALCD,10,100,0,384,0,*'); h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().reloading, true, 'ALT with an empty slot 1 and easy_reload is a reload');
  assert.equal(h.eng.state().switching, false, 'and not a weapon swap');
});
test('no reload opens during a rejoin reconcile; a match end clears one in flight', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,10,100,0,384,0,*');
  h.eng.onBleDropped(); h.eng.onBleConnected();
  assert.ok(h.eng.state().reconciling, 'reconcile running');
  h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, false, 'reconcile: the gun is disarmed, no takeover');
  h.adv(3000); h.eng.tick();                                // the reconcile window ends
  assert.equal(h.eng.state().reconciling, false);
  h.frame('$BUT,2,1,*'); assert.equal(h.eng.state().reloading, true);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(h.eng.reloading, null, 'end clears the reload');
});
test('ALT with two weapons: switching exposes from/to; the next shot on the new slot confirms with a switched moment', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] };
  h.frame('$ALCD,30,100,0,384,0,*'); h.frame('$BUT,1,1,*');
  let s = h.eng.state(); assert.equal(s.switching, true); assert.equal(s.switchFrom, 0); assert.equal(s.switchTo, 1); assert.equal(s.reloading, false);
  h.adv(400); h.frame('$ALCD,71,100,1,288,0,*');
  s = h.eng.state(); assert.equal(s.switching, false); assert.equal(s.activeSlot, 1); assert.equal(s.moment.kind, 'switched'); assert.equal(s.moment.data.slot, 1);
});
test('a swap the gun never confirms is assumed done at the window; a link drop cancels one', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] };
  h.frame('$ALCD,30,100,0,384,0,*'); h.frame('$BUT,1,1,*');
  h.adv(1201); h.eng.tick();
  let s = h.eng.state(); assert.equal(s.switching, false); assert.equal(s.activeSlot, 1); assert.equal(s.moment.data.assumed, true);
  h.frame('$BUT,1,1,*'); assert.equal(h.eng.state().switching, true);
  h.eng.onBleDropped(); assert.equal(h.eng.state().switching, false);
});

// ── A16 (led-language.md §3.1): a hit paints the readout, not a burst; death/revive gun bursts are ──
// gone by design (the killing hit's native flash + the hands-off window own death; the readout paint IS
// the hit feedback; a respawn burst fought the breathing window, §3.1 "Dropped from today's defaults"). ─
test('a hit paints the gun readout (not a multi-step burst); death BLANKS the gun (F113); a revive re-takes it, no burst', () => {
  const h = goLive(harness());
  const readout = golden.gun.readout;
  assert.ok(readout && Array.isArray(readout.pools) && readout.pools.length, 'golden bundle carries a gun.readout table');
  const armorEntry = readout.pools.find(p => p.pool === 'armor');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');             // armour-only hit: 61/70 -> the top armour band
  // A16.3 (2026-09-07): a hit now ANIMATES rather than painting once -- this is the life's FIRST armour
  // change, so it drops from full. What must still hold is that the readout is doing it, with frames the
  // bundle compiled for THIS pool, and not the old three-flash event burst (which no longer exists here).
  const gled = h.writes.filter(f => f.startsWith('$GLED'));
  const armourFrames = new Set(armorEntry.levels.flat().filter(Boolean));
  assert.ok(gled.length >= 1, 'the hit paints the readout');
  assert.ok(gled.every(f => armourFrames.has(f)), 'every write is a compiled ARMOUR level frame -- the readout, not an event burst');
  assert.ok(!gled.some((f, i) => i > 0 && f === gled[i - 1]), 'no frame written twice in a row');
  h.writes.length = 0;
  h.adv(1500);
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');              // death
  // F113 (2026-09-11, amends A16 §5): ONE frame at death -- the blank. There is still no "died" burst and
  // still nothing written to the HEADSET (the firmware's own out-flash is the down signal), but the strip
  // is no longer left frozen at whatever partial level the killing hit's animation had reached.
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [golden.gun.blank], 'death blanks the gun, and writes nothing else');
  assert.equal(h.writes.filter(f => f.startsWith('$HLED')).length, 0, 'and still writes NOTHING to the headset at death');
  h.writes.length = 0;
  h.adv(9000); h.eng.tick();                                              // auto respawn (delay 8 s) -- the take fires inline in this tick
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), golden.gun.take, 'the revive re-takes the gun (blank then rest) -- no separate "respawned" burst');
});

test('a silenced bundle (no leds, empty announcer cues, no gun readout) plays nothing extra on a hit', () => {
  const h = harness();
  // A real silenced bundle mutes the ANNOUNCER groups: the compiler emits "" for those cues and ships no
  // kill pool at all (verified against Compiler().compile with preset "silenced"), so mirror both here.
  // led-language.md §3.5: "silenced | bursts off, readout off, hit null" -- readout.pools: [] is spelled
  // spelled out here explicitly. (The gap this note used to flag -- presentation.py's "silenced" preset not
  // emptying `gun.readout.pools` -- was FIXED on 2026-09-07; the preset now ships no readout at all.)
  const silenced = { ...h.bundle, leds: {}, cues: { ...h.bundle.cues, kill: '', multi: '', medal: '' },
    cue_pools: { ...h.bundle.cue_pools, kill: undefined },
    gun: { ...h.bundle.gun, readout: { ...h.bundle.gun.readout, pools: [] } } };
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: silenced, roster: h.roster } });
  h.eng.feedFrame('$LCD,0,0,0,0,0,0,*'); h.start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0);
  // A17 (Tony 2026-09-07): ARMOUR took this one (70 -> 61, HP untouched), so the character does not grunt —
  // the firmware's own hitArrmor material sound is the feedback. See the dedicated A17 test below.
  assert.equal(h.writes.filter(f => f.startsWith('$PLAY')).length, 0, 'an armour-absorbed hit does not grunt');
  // A15.3: a hit that reaches HEALTH still grunts under a silenced bundle. `announcer: false` mutes the
  // ANNOUNCER and OBJECTIVE groups, never the player's own body sounds (the same rule that keeps low_health)
  // — and before A15.3 the FIRMWARE played this grunt from the $PSET under a silenced preset too, so muting
  // it here would be a regression.
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,44,0,0,*');   // strips the armour and trips the once-per-life alert
  h.writes.length = 0; h.adv(700);                              // past PAIN_GAP_MS, so the next grunt is not rate-dropped
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,36,0,0,*');
  const painTakes = golden.cue_pools.pain_short;
  assert.equal(h.writes.filter(f => f.startsWith('$PLAY')).length, 1, 'the hit grunts');
  assert.ok(painTakes.includes(h.writes.find(f => f.startsWith('$PLAY'))), 'and it is a short-pain take');
  h.writes.length = 0;
  h.eng.feedback({ kind: 'kill', player_id: 'p1', t: h.eng.now() }, h.eng.now());
  assert.ok(h.writes.includes('$SFLASH,*'), 'the sight flash still fires');
  assert.equal(h.writes.filter(f => f.startsWith('$PLAY')).length, 0, 'no kill line when the announcer is off');
});

// ── A17 hit audio: the character only grunts when real health went down ──────────────────────
test('A17: armour and shield absorb in silence; the grunt belongs to HEALTH, still short/long by damage', () => {
  const h = goLive(harness());
  const plays = () => h.writes.filter(f => f.startsWith('$PLAY'));
  const shortTakes = golden.cue_pools.pain_short, longTakes = golden.cue_pools.pain_long;

  // Tony 2026-09-07: "metal/armor hitting sounds when the players have armor and only use the character hit
  // sounds when real health is taken down." An armour-absorbed hit is a hit on EQUIPMENT — the firmware plays
  // its own hitArrmor material clip and the character says nothing.
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  assert.equal(plays().length, 0, 'armour took it: no character grunt');

  // Same for a shield-absorbed hit (shield drains first of all three).
  h.frame('$LCD,45,70,0,0,36,216,*'); h.eng._prevShield = 20; h.eng.shield = 20;
  h.adv(700); h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,70,11,*');
  assert.equal(plays().length, 0, 'shield took it: no character grunt');

  // A hit that SPILLS through the last of the armour into HP is a health hit (`changed_pool` reports the
  // innermost pool that moved), so it grunts.
  h.adv(700); h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,45,0,0,*'); h.frame('$HP,40,0,0,*');
  assert.equal(plays().filter(f => shortTakes.includes(f) || longTakes.includes(f)).length, 1, 'the spill into health grunts');

  // ... and the short/long choice is still made by DAMAGE, from the same pain pools (Tony: "it should use the
  // pain pool for short or pain pool for long"). 45 >= voice.pain_long_min (40) → a long-pain take.
  assert.ok(plays().some(f => longTakes.includes(f)), 'a 45-damage hit takes a LONG pain');
  h.adv(700); h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,31,0,0,*');
  assert.ok(plays().some(f => shortTakes.includes(f)), 'a 9-damage hit takes a SHORT pain');

  // A bundle from an older MC passes no pool at all: `_pain` must behave exactly as it did before A17.
  h.adv(700); h.writes.length = 0;
  h.eng._pain(9, 0);
  assert.equal(plays().length, 1, 'no pool given (pre-A17 caller): grunts as before');
});

// ── A11.4 alerts, medal stacks, clock callouts ───────────────────────────────────────────────
test('a kill feedback with medals plays each medal cue instead of the plain kill line', () => {
  const h = goLive(harness());
  h.writes.length = 0;
  h.eng.feedback({ kind: 'kill', player_id: 'p1', t: h.eng.now(), medals: ['killtacular', 'killing_spree'] }, h.eng.now());
  const plays = h.writes.filter(f => f.startsWith('$PLAY'));
  assert.deepEqual(plays, [golden.cues.killtacular, golden.cues.killing_spree], 'medals in order (harness delays run inline)');
  assert.ok(!plays.includes(golden.cues.kill), 'no plain kill line under a medal');
  assert.deepEqual(h.eng.state().moment.data.medals, ['killtacular', 'killing_spree']);
  h.writes.length = 0;
  h.eng.feedback({ kind: 'kill', player_id: 'p1', t: h.eng.now(), medals: [] }, h.eng.now());
  const plain = h.writes.filter(f => f.startsWith('$PLAY'));
  const pool = (golden.cue_pools && golden.cue_pools.kill) || [golden.cues.kill];   // A15: one random take of the kill pool (kill confirms + taunts)
  assert.ok(plain.length === 1 && pool.includes(plain[0]), 'no medals: one take of the kill pool, got ' + plain.join());
});

test('an MC alert plays this node\'s cue + burst for the event and raises a HUD alert moment', () => {
  const h = goLive(harness());
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'next_kill_wins', text: 'NEXT KILL WINS', player_id: 'p1', t: h.eng.now() }, t: h.eng.now() });
  assert.ok(h.writes.includes(golden.cues.next_kill_wins), 'the announcer line from the bundle');
  const m = h.eng.state().moment;
  assert.equal(m.kind, 'alert'); assert.equal(m.data.kind, 'next_kill_wins'); assert.equal(m.data.text, 'NEXT KILL WINS');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'lead_taken', text: 'LEAD', player_id: 'p1', t: h.eng.now() - 60000 }, t: h.eng.now() - 60000 });
  assert.equal(h.writes.length, 0, 'a stale alert is dropped');
});

test('clock callouts fire once each from the node\'s own end time', () => {
  const h = harness({ timeLimit: 70 }).kit().config_().echo().start(0);
  h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.writes.length = 0;
  h.adv(11000); h.eng.tick();                          // 59 s left -> time_60
  assert.ok(h.writes.includes(golden.cues.time_60), 'one minute left');
  h.adv(1000); h.eng.tick();
  assert.equal(h.writes.filter(f => f === golden.cues.time_60).length, 1, 'edge-triggered, once');
  h.adv(29000); h.eng.tick();                          // 29 s left
  assert.ok(h.writes.includes(golden.cues.time_30));
  h.adv(20000); h.eng.tick();                          // 9 s left
  assert.ok(h.writes.includes(golden.cues.time_10));
});

test('an infection survivor plays survivors_win itself at time-expiry; a turned player plays game_over', () => {
  const h = harness({ mode: 'infection', timeLimit: 20 }).kit().config_().echo().start(0);
  h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.adv(21000); h.writes.length = 0; h.eng.tick();
  assert.ok(h.writes.includes(golden.cues.survivors_win), 'never turned -> survivors line');
  assert.ok(!h.writes.includes(golden.cues.game_over));
  const t = harness({ mode: 'infection', timeLimit: 20 }).kit().config_().echo().start(0);
  t.adv(10); t.eng.tick(); t.frame('$LCD,45,70,0,0,36,216,*');
  t.eng._turned = true;                                   // what a team_flip sets
  t.adv(21000); t.writes.length = 0; t.eng.tick();
  assert.ok(t.writes.includes(golden.cues.game_over) && !t.writes.includes(golden.cues.survivors_win));
});
test('a reload-speed perk shortens the RELOADING takeover to match the gun', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.eng.onMcMessage({ kind: 'assign', body: { player: { ...h.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }], perk: 'quick_hands' } }, team: h.team, roster: h.roster,
    catalog: { weapons: [{ weapon_id: 'assault_rifle', name: 'Assault Rifle', clip: 32, reserve: 384, reload_s: 1.4 }], perks: [{ perk_id: 'quick_hands', name: 'Quick Hands', effects: { reload_mult: 0.5 } }] } } });
  h.frame('$ALCD,20,100,0,384,0,*'); h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloadTotalMs, 700, '1.4 s × 0.5');
});
test('the Quick Switch perk halves the swap window: the assumed swap lands at 425 ms', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.eng.onMcMessage({ kind: 'assign', body: { player: { ...h.player, loadout: { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }], perk: 'quick_switch' } }, team: h.team, roster: h.roster,
    catalog: { weapons: [], perks: [{ perk_id: 'quick_switch', name: 'Quick Switch', effects: { switch_mult: 0.5 } }] } } });
  delete h.eng.frames.swap_ms;                       // an older MC: no enforced value in the bundle → the node applies the perk itself
  h.frame('$ALCD,30,100,0,384,0,*'); h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switchWindowMs, 425);   // 850 stock × 0.5
  h.adv(426); h.eng.tick();
  const s = h.eng.state(); assert.equal(s.switching, false); assert.equal(s.activeSlot, 1); assert.equal(s.moment.data.assumed, true);
});
test('the bundle\'s swap_ms is the SWITCHING window; without it the node assumes the stock 850 × perk', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }, { weapon_id: 'smg' }] };
  assert.equal(h.eng.state().switchWindowMs, 850, 'no swap_ms in the golden bundle → stock 850');
  h.eng.frames = { ...h.eng.frames, swap_ms: 425 };
  assert.equal(h.eng.state().switchWindowMs, 425, 'MC said 425');
  h.frame('$ALCD,30,100,0,384,0,*'); h.frame('$BUT,1,1,*'); h.adv(426); h.eng.tick();
  assert.equal(h.eng.state().activeSlot, 1, 'assumed done right after the real delay');
});

// ---------- utility items: scanner respawn at a station (docs/spec/utility.md §4) ----------
function stationEntry(o = {}) { return { role: 'station', id: 5, kind: 'respawn', team: 1, state: 1, value: 0, seq: 0, game: 0, threshold: -60, rssi: -50, raw: -50, present: true, ...o }; }
function scannerHarness(gate, autoTeams = []) {
  const h = harness({ respawn: 'scanner' });
  if (gate) h.config.respawn.gate = gate;
  h.config.respawn_auto_teams = autoTeams;
  h.kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false, 'precondition: dead');
  return h;
}

test('scanner: a team without a station uses timed respawn state and behavior', () => {
  const h = scannerHarness(null, [1]);
  assert.equal(h.eng.state().respawnAuto, true);
  assert.equal(h.eng.state().respawnHint, 'timer');
  assert.ok(h.eng.state().respawnIn > 0);
  h.adv(8000); h.eng.tick();
  assert.equal(h.eng.alive, true);
});

test('scanner + trigger gate: dead past the delay, at own-team station, trigger pull → revive with the station id', () => {
  const h = scannerHarness();
  h.adv(9000); h.eng.tick();
  assert.equal(h.eng.alive, false, 'scanner never auto-revives on the timer alone');
  assert.equal(h.eng.state().respawnHint, 'find_station');
  h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, 'pull_trigger');
  assert.equal(h.eng.state().station.id, 5);
  h.eng.tick(); assert.equal(h.eng.alive, false, 'presence alone is not the trigger gate');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true);
  const r = h.facts.filter(f => f.type === 'respawn').pop();
  assert.equal(r.station, 5);
  assert.ok(h.writes.includes('$SPAWN,,*'));
});

test('scanner: the trigger does nothing before the delay, away from the station, or at the wrong team\'s station', () => {
  const h = scannerHarness();
  h.eng.setStations([stationEntry()]);
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'delay not elapsed');
  assert.equal(h.eng.state().respawnHint, 'hold', 'at the station but the delay is not up yet → HOLD');
  h.eng.setStations([]);
  assert.equal(h.eng.state().respawnHint, 'find_station', 'no station in range → guidance shows immediately, during the delay');
  h.adv(9000); h.eng.setStations([stationEntry({ present: false, rssi: -80 })]);
  assert.equal(h.eng.state().respawnHint, 'approach');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'not present');
  h.eng.setStations([stationEntry({ team: 2 })]);
  assert.equal(h.eng.state().station, null, 'a team-2 station is not mine');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'wrong team');
  h.eng.setStations([stationEntry({ team: 255 })]);
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true, 'a neutral station admits every team');
});

test('scanner: config.stations is an allow-list; a disabled station (state 0) does not count', () => {
  const h = scannerHarness();
  h.config.stations = [{ id: 9, kind: 'respawn' }];
  h.adv(9000);
  h.eng.setStations([stationEntry({ id: 5 })]);
  assert.equal(h.eng.state().station, null, 'id 5 is not in this game');
  h.eng.setStations([stationEntry({ id: 9, state: 0 })]);
  assert.equal(h.eng.state().station, null, 'a disabled station is invisible');
  h.eng.setStations([stationEntry({ id: 9 })]);
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true);
});

test('scanner + presence gate: dwelling at the station past the delay revives on the tick, no trigger needed', () => {
  const h = scannerHarness('presence');
  h.eng.setStations([stationEntry()]);
  h.eng.tick(); assert.equal(h.eng.alive, false, 'delay first');
  h.adv(9000); h.eng.tick();
  assert.equal(h.eng.alive, true);
  assert.equal(h.facts.filter(f => f.type === 'respawn').pop().station, 5);
});

test('auto respawn ignores stations entirely; a live gun\'s trigger is not a revive', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, null);
  h.frame('$BUT,0,1,*');
  assert.equal(h.facts.filter(f => f.type === 'respawn').length, 0);
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.state().respawnHint, 'timer');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'auto mode: the trigger does not revive');
  h.adv(8000); h.eng.tick();
  assert.equal(h.eng.alive, true, 'the timer does');
  assert.equal(h.facts.filter(f => f.type === 'respawn').pop().station, undefined);
});

test('setStations re-renders only when the shown station changes', () => {
  const h = scannerHarness();
  let changes = 0; h.eng.onChange = () => changes++;
  h.eng.setStations([stationEntry({ rssi: -50 })]); const a = changes;
  h.eng.setStations([stationEntry({ rssi: -50.3 })]);
  assert.equal(changes, a, 'same rounded RSSI, same id, same presence: no re-render');
  h.eng.setStations([stationEntry({ rssi: -58 })]);
  assert.equal(changes, a + 1);
});

test('recovery: down after a cold boot with no death time stamps deadAt so scanner respawn works', () => {
  // Simulate the resync outcome: live match, gun observed dead, but deadAt lost across the reload.
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.alive = false; h.eng.deadAt = 0;                 // the stuck state seen on hardware 2026-09-04
  assert.equal(h.eng.state().respawnHint, null, 'precondition: no death time → no hint (the bug)');
  h.eng.tick();
  assert.ok(h.eng.deadAt > 0, 'the tick stamps a death time');
  assert.equal(h.eng.state().respawnHint, 'find_station', 'now the respawn logic runs — station guidance immediately');
  h.adv(9000); h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, 'pull_trigger', 'delay elapsed at the station');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true, 'and the station revive works after recovery');
});

test('scanner: at the station during the delay shows HOLD, then PULL TRIGGER once the delay is up', () => {
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, 'hold', 'present but delay not elapsed → hold, not pull_trigger');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, false, 'the trigger does nothing during the delay');
  h.adv(9000); h.eng.setStations([stationEntry()]);
  assert.equal(h.eng.state().respawnHint, 'pull_trigger');
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true);
});

// ---------- A11.6: the headset out-blink re-asserts through a long DOWN (utility.md §7, respawn LEDs) ----------
const OUTBLINK = '$HLED,3,2,400,400,10,200,*';   // green slow-blink, ~160 s; what presentation.py emits for death

test('death paints the headset out-blink, and it re-asserts while the player stays down', () => {
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.frames.headset = { ...(h.eng.frames.headset || {}), death: [[OUTBLINK, 0.0]] };
  const count = () => h.writes.filter(f => f === OUTBLINK).length;
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  assert.equal(count(), 1, 'the out-blink is painted once on death');
  h.adv(4000); h.eng.tick();
  assert.equal(count(), 1, 'no re-assert inside the 5 s F13 settle window');
  h.adv(2000); h.eng.tick();
  assert.equal(count(), 1, 'still down 6 s in — the ~160 s blink has not run out, no re-assert yet');
  h.adv(120000); h.eng.tick();
  assert.equal(count(), 2, 'past the re-blink interval, the out-blink is re-painted so a long walk stays lit');
  h.adv(120000); h.eng.tick();
  assert.equal(count(), 3, 'and again');
});

test('the out-blink is a no-op when the game opted out (death: [] = "native")', () => {
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.frames.headset = { ...(h.eng.frames.headset || {}), death: [] };
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.adv(200000); h.eng.tick();
  assert.equal(h.writes.filter(f => f === OUTBLINK).length, 0, 'nothing painted, no re-assert — the firmware/native path');
});

test('a revive stops the out-blink re-assert (no longer down)', () => {
  const h = harness({ respawn: 'scanner' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.eng.frames.headset = { ...(h.eng.frames.headset || {}), death: [[OUTBLINK, 0.0]] };
  h.frame('$HIR,4,0,19,2,9,0,3,*'); h.frame('$HP,0,0,0,*');
  h.adv(9000); h.eng.setStations([stationEntry()]); h.frame('$BUT,0,1,*');
  assert.equal(h.eng.alive, true, 'revived at the station');
  const after = h.writes.filter(f => f === OUTBLINK).length;
  h.adv(200000); h.eng.tick();
  assert.equal(h.writes.filter(f => f === OUTBLINK).length, after, 'alive again → no more out-blink writes');
});


// --- polish 2026-09-04 (review findings) ---

test('polish: a rejoin reconcile on a HEALTHY gun stays alive — no bogus auto-revive after an app reload', () => {
  const h = goLive(harness());
  assert.equal(h.eng.alive, true);                    // persistence restores alive at the real hp on reopen
  h.eng.onBleDropped(); h.eng.onBleConnected();
  assert.ok(h.eng.state().reconciling, 'reconcile started');
  h.frame('$LCD,45,70,0,0,36,216,*');                 // hp 45: the gun is up
  h.adv(3000); h.eng.tick();                           // reconcile ends → re-arm (never $SPAWN)
  h.writes.length = 0;
  h.adv(9000); h.eng.tick();                           // well past any respawn delay
  assert.equal(h.eng.alive, true, 'still alive');
  assert.ok(!h.writes.some(f => f.startsWith('$SPAWN')), 'no revive written to a live gun');
  assert.ok(!h.facts.some(f => f.type === 'respawn'), 'no respawn fact');
});

test('polish: an event\'s static headset paint is dropped while down — the out-blink owns the headset', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  const RED = '$HLED,0,0,,,10,,*';
  h.eng.frames.leds = { ...h.eng.frames.leds, died: [...TEST_BURST, [RED, 0.0]] };   // a "last stand" style died event with a headset colour (died carries no default burst any more, so this is a deliberate opt-in)
  h.eng.frames.headset = { ...(h.eng.frames.headset || {}), death: [[OUTBLINK, 0.0]] };
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  assert.deepEqual(h.writes.filter(f => f.startsWith('$HLED')), [OUTBLINK], 'only the out-blink reached the headset');
  assert.ok(h.writes.includes(TEST_BURST[0][0]), 'the gun burst still played');
});

test('polish: the player who turned ignores MC\'s infected alert naming themself; everyone else plays it', () => {
  const h = harness({ mode: 'infection' }).kit().config_().echo().start(0); h.adv(10); h.eng.tick(); h.frame('$LCD,45,70,0,0,36,216,*');
  h.eng._turned = true;
  h.writes.length = 0; h.eng.moment = null;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'infected', text: 'INFECTED', player_id: 'p1', player_id_subject: 'p1', t: h.eng.now() }, t: h.eng.now() });
  assert.ok(!h.writes.includes(golden.cues.infected) && h.eng.moment === null, 'no second play for the one who turned');
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'infected', text: 'INFECTED', player_id: 'p1', player_id_subject: 'p2', t: h.eng.now() }, t: h.eng.now() });
  assert.ok(h.writes.includes(golden.cues.infected) && h.eng.moment && h.eng.moment.kind === 'alert', 'someone else turning still plays');
});

test('polish: an event headset paint survives an app reload (the generation counter is seeded, not undefined)', () => {
  const h = goLive(harness());
  const TEAL = '$HLED,5,0,,,10,,*';
  h.eng.frames.leds = { ...h.eng.frames.leds, lead_taken: [...TEST_BURST, [TEAL, 0.0]] };
  h.eng._hsGen = undefined;                                   // what a reload leaves: not persisted, not in the ctor
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'lead_taken', text: 'LEAD', player_id: 'p1', t: h.eng.now() }, t: h.eng.now() });
  assert.ok(h.writes.includes(TEAL), 'the delayed static paint reached the headset');
});

test('polish: _turned is reset by a new start, so last match\'s flip does not score this one', () => {
  const h = harness({ mode: 'infection', timeLimit: 20 }).kit().config_().echo().start(0);
  h.eng._turned = true;                                      // carried over from a previous match
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.eng.now(), config_id: golden.config_id, seq: 2, countdown_s: 0 } });
  assert.equal(h.eng._turned, false);
});


// --- A11.7 / S4: the gun body LED as a host-owned display (bench 2026-09-04) ---
// Bursts are switched off in these harnesses (frames.leds = {}) so a hit_taken burst's RED flash is not
// mistaken for the red health band; the burst-tail test re-enables exactly one event.

test('A11.7 gun health: no writes when the bundle has no gun table (native breathing); band repaints once per band change', () => {
  const G = '$GLED,3,3,3,0,10,,*', Y = '$GLED,2,2,2,0,10,,*', R = '$GLED,0,0,0,0,10,,*';
  const h = goLive(harness()); h.eng.frames.leds = {};
  // A16: MC now ships a gun table (dark rest + readout) by DEFAULT (golden bundle), so "no gun table" must
  // be simulated explicitly -- `gun_frames()` returns `{}` for `in_play: native` / LEDs off (presentation.py).
  h.eng.frames.gun = {};
  h.eng._gunTake();   // a native/absent table leaves `_gunTaken` false -- confirms _gunPoolPaint's own guard too
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,0,0,*');
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'native: nothing painted');
  const t = goLive(harness()); t.eng.frames.leds = {};
  t.eng.frames.gun = { in_play: 'health', blank: '$GLED,,,,5,,,*', rest: G, bands: [[0.66, G], [0.33, Y], [0.0, R]], after_spawn_s: 2.5, take: ['$GLED,,,,5,,,*', G] };
  t.eng._gunTake(); t.eng._gunBand = G;                        // the take fired (harness delays run inline)
  t.writes.length = 0;
  t.frame('$HIR,4,0,19,2,9,0,0,*'); t.frame('$HP,45,61,0,*');  // armour only: still the green band
  assert.equal(t.writes.filter(f => f.startsWith('$GLED')).length, 0, 'same band -> no repaint');
  t.frame('$HIR,4,0,19,2,9,0,0,*'); t.frame('$HP,25,0,0,*');   // 25/45 = 0.55 -> yellow
  assert.deepEqual(t.writes.filter(f => f.startsWith('$GLED')), [Y]);
  t.writes.length = 0;
  t.frame('$HIR,4,0,19,2,9,0,0,*'); t.frame('$HP,20,0,0,*');   // 0.44 -> still yellow
  assert.equal(t.writes.filter(f => f.startsWith('$GLED')).length, 0);
  t.frame('$HIR,4,0,19,2,9,0,0,*'); t.frame('$HP,10,0,0,*');   // 0.22 -> red
  assert.deepEqual(t.writes.filter(f => f.startsWith('$GLED')), [R]);
});

test('A11.7 gun health: an event burst ends on the CURRENT band, and a revive resets the band to the painted rest', () => {
  const G = '$GLED,3,3,3,0,10,,*', Y = '$GLED,2,2,2,0,10,,*', R = '$GLED,0,0,0,0,10,,*';
  const h = goLive(harness());
  h.eng.frames.leds = { lead_taken: TEST_BURST };        // one burst only (red flashes ending on a fixed frame)
  h.eng.frames.gun = { in_play: 'health', blank: '$GLED,,,,5,,,*', rest: G, bands: [[0.66, G], [0.33, Y], [0.0, R]], after_spawn_s: 2.5, take: ['$GLED,,,,5,,,*', G] };
  h.eng._gunTake();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,20,0,0,*');   // yellow band
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'lead_taken', text: 'LEAD', player_id: 'p1', t: h.eng.now() }, t: h.eng.now() });
  const gleds = h.writes.filter(f => f.startsWith('$GLED'));
  assert.ok(gleds.length > 1, 'the burst played');
  assert.equal(gleds[gleds.length - 1], Y, 'the burst is followed by the real health hue');
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');   // down
  h.adv(9000); h.writes.length = 0; h.eng.tick();               // auto respawn
  assert.ok(h.writes.includes('$GLED,,,,5,,,*') && h.writes.includes(G), 'the take (blank + full health) follows the revive');
  assert.ok(h.delays.includes(2500), 'scheduled 2.5 s after the revive, not inside the burst');
  assert.equal(h.eng._gunBand, G);
});

test('S5: a NEW match started while a rejoin reconcile is in flight clears it and spawns clean', () => {
  // live in match m1, then a BLE drop+reconnect opens the disarmed reconcile window
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*');
  h.eng.onBleDropped(); h.eng.onBleConnected();
  assert.ok(h.eng.state().reconciling, 'reconcile in flight after the reconnect');
  // MC starts a NEW match (m2) while the reconcile is unresolved — leaving it set would keep the gun
  // disarmed and block the T-0 spawn, so startAt must clear it.
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.eng.now(), config_id: golden.config_id, seq: 2, countdown_s: 0 } });
  assert.equal(h.eng.state().reconciling, false, 'the new match cleared the stale reconcile');
  h.adv(10); h.eng.tick();
  assert.equal(h.eng.alive, true, 'the new match spawns the gun alive');
  assert.equal(h.eng.hp, 45, 'at full health, not 0');
  assert.equal(h.eng.matchId, 'm2');
});

test('S7: a new match started while the node is LIVE (rejoin) re-arms and spawns clean', () => {
  // live in m1
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  assert.equal(h.eng.phase, 'live'); assert.equal(h.eng.alive, true);
  // the rejoin limbo the hardware showed: still 'live' but the spawn state is stale (alive with no hp)
  h.eng.hp = 0; h.eng.spawned = false; h.eng.alive = true;
  // MC starts a NEW match m2 while the node is LIVE — the old code left phase 'live', resumeSchedule
  // returned early, the T-0 spawn never ran, and hp stayed 0.
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: h.eng.now(), config_id: golden.config_id, seq: 2, countdown_s: 0 } });
  h.adv(10); h.eng.tick();
  assert.equal(h.eng.matchId, 'm2');
  assert.equal(h.eng.spawned, true, 'the new match actually ran the spawn');
  assert.equal(h.eng.alive, true);
  assert.equal(h.eng.hp, 45, 'at full health, not the stale 0');
});

test('ANTI-CHEAT: force-close alive at low HP → reopen restores that HP, no false down, no free respawn', () => {
  // Shared storage across the two app processes (force-close = a new Engine on the same localStorage).
  const store = mkStorage();
  let clock = 2_000_000;
  const cfg = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const team = { team_id: 'blue', tid: 1, name: 'BLUE', color: 'blue' };
  const bundle = { ...golden, player_id: 'p1' };
  const mk = () => new Engine({ writer: () => {}, emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: store, log: () => {}, delay: (ms, fn) => fn() });

  // process 1: live, then take damage down to 10 hp (armour gone), still alive
  const a = mk();
  a.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  a.onMcMessage({ kind: 'assign', body: { player, team, roster: [player] } });
  a.onMcMessage({ kind: 'config', body: { config: cfg, frames: bundle, roster: [player] } });
  a.feedFrame('$LCD,0,0,0,0,0,0,*');
  a.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  clock += 10; a.tick();
  a.feedFrame('$HIR,4,0,19,2,60,0,0,*'); a.feedFrame('$HP,10,0,0,*');
  assert.equal(a.alive, true); assert.equal(a.hp, 10);

  // process 2: force-close → reopen on the same storage, gun relinks (SAME match)
  const b = mk();
  assert.equal(b.hp, 10, '_load restored the real HP, not 0');
  assert.equal(b.alive, true, '_load restored alive, not a default down');
  b.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  // the cheat was: the recovery guard stamped a death here and auto-respawn healed to full. Advance well
  // past the respawn delay and tick — a LIVE player must NOT be respawned.
  clock += 20000; b.tick();
  assert.equal(b.alive, true, 'still alive — no false down');
  assert.equal(b.hp, 10, 'still 10 hp — NOT healed to 45 by a bogus respawn');
  assert.equal(b.deadAt, 0, 'no death was stamped on the rejoin');
});

test('S7.1 reconcile: a rejoin disarms then re-arms to the real pools — never infers death or heals', () => {
  const store = mkStorage();
  let clock = 3_000_000;
  const cfg = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', tid: 1, name: 'BLUE', color: 'blue' }, { team_id: 'yellow', tid: 2, name: 'YELLOW', color: 'yellow' }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const bundle = { ...golden, player_id: 'p1' };
  const writes = [];
  const mk = () => new Engine({ writer: fr => writes.push(...fr), emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: store, log: () => {}, delay: (ms, fn) => fn() });
  // process 1: live at 25 hp
  const a = mk();
  a.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  a.onMcMessage({ kind: 'assign', body: { player, team: cfg.teams[0], roster: [player] } });
  a.onMcMessage({ kind: 'config', body: { config: cfg, frames: bundle, roster: [player] } });
  a.feedFrame('$LCD,0,0,0,0,0,0,*');
  a.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  clock += 10; a.tick();
  a.feedFrame('$HIR,4,0,19,2,60,0,0,*'); a.feedFrame('$HP,25,0,0,*');
  assert.equal(a.alive, true); assert.equal(a.hp, 25);
  // process 2: reopen + relink → RECONCILING (disarmed), not down, not healed
  writes.length = 0;
  const b = mk();
  b.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(b.state().reconciling, true, 'a rejoin enters the reconcile window');
  assert.ok(writes.includes('$AMMO,0,0,0,1,*'), 'the gun is disarmed during reconcile');
  assert.equal(b.deadAt, 0, 'no death inferred'); assert.equal(b.alive, true); assert.equal(b.hp, 25);
  // wait out the reconcile window → re-armed to the real pools, still 25, no $SPAWN
  clock += 3100; b.tick();
  assert.equal(b.state().reconciling, false, 'reconcile ends');
  assert.equal(b.alive, true, 'still alive'); assert.equal(b.hp, 25, 'still 25 — not healed');
  assert.ok(!writes.includes('$SPAWN,,*'), 'reconcile NEVER writes $SPAWN — no heal');
  // and no auto-respawn ever fires on the live player
  clock += 20000; b.tick();
  assert.equal(b.hp, 25, 'no bogus respawn heal after the delay');
});


test('A11.7 gun take: 2.5 s after spawn the node blanks and paints; a death before the timer cancels it', () => {
  const h = harness().kit().config_().echo();
  h.eng.frames.gun = { in_play: 'team', blank: '$GLED,,,,5,,,*', rest: '$GLED,1,1,1,0,10,,*', after_spawn_s: 2.5, take: ['$GLED,,,,5,,,*', '$GLED,1,1,1,0,10,,*'] };
  h.start(0); h.adv(10); h.eng.tick();
  const i = h.writes.indexOf('$SPAWN,,*');
  assert.ok(i >= 0 && !h.writes.slice(i, i + 6).includes('$GLED,,,,5,,,*'), 'no blank inside the spawn burst');
  assert.ok(h.writes.includes('$GLED,,,,5,,,*') && h.writes.includes('$GLED,1,1,1,0,10,,*'), 'the take was written (delay runs inline in the harness)');
  assert.ok(h.delays.includes(2500));
  // a timer that fires after a death writes nothing
  const t = harness().kit().config_().echo();
  const pending = [];
  t.eng.delay = (ms, fn) => pending.push(fn);
  t.eng.frames.gun = h.eng.frames.gun;
  t.start(0); t.adv(10); t.eng.tick();
  t.frame('$HIR,4,0,19,2,60,0,0,*'); t.frame('$HP,0,0,0,*');
  t.writes.length = 0; pending.forEach(fn => fn());
  assert.ok(!t.writes.includes('$GLED,,,,5,,,*'), 'dead: the take is skipped');
});


test('A11.6 default: a hit paints NOTHING on the headset (the native flash is far brighter than any BLE frame)', () => {
  const h = goLive(harness());
  assert.deepEqual(golden.headset.hit, []);
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');
  assert.equal(h.writes.filter(f => f.startsWith('$HLED')).length, 0, 'native hit flash left alone');
});


test('A11.8 small-LED flash: kill feedback fires the top medal\'s lights (flash) without re-playing the line; a $LED step also plays while down', () => {
  const h = goLive(harness());
  h.eng.frames.leds = { ...h.eng.frames.leds, kill: [['$LED,9,1,1,1,*', 0]], first_blood: [['$LED,9,1,1,1,*', 0]], died: [['$LED,9,1,1,1,*', 0], ...TEST_BURST] };   // died carries no default burst any more; given one here only to prove $LED is not skipped while down
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', medals: ['first_blood'], t: h.eng.now() }, t: h.eng.now() });
  assert.equal(h.writes.filter(f => f === '$LED,9,1,1,1,*').length, 1, 'one green flash for the kill');
  assert.equal(h.writes.filter(f => f === golden.cues.first_blood).length, 1, 'the medal line plays once');
  h.adv(1500); h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  assert.ok(h.writes.includes('$LED,9,1,1,1,*'), 'a $LED step is not skipped while down, unlike a static $HLED');
});


// ---------- §3.2 (led-language.md, bench 2026-09-07): the native death flash runs by itself; we write
// nothing to the headset at death any more, and the old node-driven pulse ($LED,9,1,1,1,* every 750 ms,
// A11.8 death_flash) is deleted. `frames.headset.down = {rearm, stop, rearm_after_ms}` is belt-and-braces
// only: one $HLOOP rearm after the hands-off window, and a stop before every $SPAWN. ----------
const DOWN = { rearm: '$HLOOP,1,2500,*', stop: '$HLOOP,0,0,*', rearm_after_ms: 2500 };

test('§3.2 down: nothing is written to the headset for the hands-off window — the native flash is already running', () => {
  const h = goLive(harness());
  h.eng.frames.headset = { ...h.eng.frames.headset, death: [], down: DOWN };
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  h.writes.length = 0;
  for (let i = 0; i < 9; i++) { h.adv(250); h.eng.tick(); }   // 2.25 s down — inside the 2.5 s window
  assert.equal(h.writes.filter(f => f.startsWith('$HLED') || f.startsWith('$HLOOP')).length, 0, 'no headset write while inside the hands-off window');
});

test('§3.2 down: past the hands-off window ONE $HLOOP rearm is written, then nothing more while still down', () => {
  const h = goLive(harness());
  h.eng.frames.headset = { ...h.eng.frames.headset, death: [], down: DOWN };
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  h.writes.length = 0;
  for (let i = 0; i < 10; i++) { h.adv(250); h.eng.tick(); }   // 2.5 s — the window has just elapsed
  assert.deepEqual(h.writes.filter(f => f === DOWN.rearm), [DOWN.rearm], 'exactly one rearm write');
  h.writes.length = 0;
  for (let i = 0; i < 20; i++) { h.adv(250); h.eng.tick(); }   // stays down well past the window (auto respawn is 8 s; total elapsed so far is under it)
  assert.equal(h.writes.filter(f => f === DOWN.rearm).length, 0, 'one write per death, never a repeating pulse');
});

test('§3.2 down: the rearm is suppressed during a resync (the gun is disarmed/unverified there)', () => {
  const h = goLive(harness());
  h.eng.frames.headset = { ...h.eng.frames.headset, death: [], down: DOWN };
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  h.eng.resync = { step: 1, since: h.eng.now(), prompt: 'x', reserve: null, probes: 0 };   // an in-flight resync, same shape _beginResync builds
  h.writes.length = 0;
  for (let i = 0; i < 12; i++) { h.adv(250); h.eng.tick(); }   // 3 s down, well past the window, but resyncing throughout
  assert.equal(h.writes.filter(f => f === DOWN.rearm).length, 0, 'no rearm while resync is open');
  h.eng.resync = null;
  h.adv(250); h.eng.tick();
  assert.deepEqual(h.writes.filter(f => f === DOWN.rearm), [DOWN.rearm], 'the rearm fires once resync clears');
});

test('§3.2 down: a revive writes the stop BEFORE $SPAWN, and resets the rearm gate for the next life', () => {
  const h = goLive(harness());   // harness() respawn defaults to auto, delay_s 8
  h.eng.frames.headset = { ...h.eng.frames.headset, death: [], down: DOWN };
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  h.writes.length = 0;
  h.adv(8000); h.eng.tick();   // auto respawn delay elapses → revive
  assert.equal(h.eng.alive, true, 'revived');
  const stopI = h.writes.indexOf(DOWN.stop), spawnI = h.writes.indexOf('$SPAWN,,*');
  assert.ok(stopI >= 0 && spawnI >= 0 && stopI < spawnI, 'the stop lands before $SPAWN, got stop@' + stopI + ' spawn@' + spawnI);
  // die again: the rearm gate was reset by the revive, so the SAME one-write-per-death behaviour holds next life
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  for (let i = 0; i < 10; i++) { h.adv(250); h.eng.tick(); }
  assert.deepEqual(h.writes.filter(f => f === DOWN.rearm), [DOWN.rearm], 'the second death gets its own rearm write');
});

test('§3.2 down: nothing is sent when the game has no down table (an older/absent bundle)', () => {
  const h = goLive(harness());
  h.eng.frames.headset = { ...h.eng.frames.headset, death: [], down: undefined };   // no `down` key at all (the golden fixture now ships a real one — explicitly override it away)
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  h.writes.length = 0;
  for (let i = 0; i < 40; i++) { h.adv(250); h.eng.tick(); }   // well past any rearm window
  assert.equal(h.writes.filter(f => f.startsWith('$HLOOP')).length, 0, 'no rearm write is fabricated when the bundle carries no down table');
});

test('§3.2 teardown: a pending delayed light step from an event burst cannot land after _endLocal', () => {
  const h = harness().kit().config_().echo();
  const pending = [];
  h.eng.delay = (ms, fn) => pending.push(fn);   // capture instead of firing inline, so we can invoke it AFTER teardown
  h.start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');   // died (no gun burst of its own any more, but `_gunTake`'s own 2.5 s blank+paint from the T-0 spawn above is still pending)
  assert.ok(pending.length > 0, 'a delayed light step is queued (the gun take)');
  h.eng._endLocal('test-teardown');
  h.writes.length = 0;
  pending.forEach(fn => fn());
  assert.equal(h.writes.filter(f => f.startsWith('$GLED') || f.startsWith('$HLED')).length, 0, 'no delayed light step reached the gun/headset after teardown');
});

test('§3.2 teardown: a panic cuts off a pending delayed light step the same way as _endLocal', () => {
  const h = harness().kit().config_().echo();
  const pending = [];
  h.eng.delay = (ms, fn) => pending.push(fn);
  h.start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  assert.ok(pending.length > 0, 'a delayed light step is queued');
  h.eng.control({ cmd: 'panic' });
  h.writes.length = 0;
  pending.forEach(fn => fn());
  assert.equal(h.writes.filter(f => f.startsWith('$GLED') || f.startsWith('$HLED')).length, 0, 'no delayed light step reached the gun/headset after a panic');
});

test('§3.2 teardown: a queued gun-take blank+paint (_gunTake) writes nothing after a BLE drop', () => {
  // NOTE: _endLocal and panic both already zero `alive` synchronously, and _gunTake's own `!this.alive`
  // guard already blocked a stale write in that case (a death before the timer already had its own test,
  // "A11.7 gun take ... a death before the timer cancels it") — a _lightGen check there is redundant with
  // that guard and does not change behaviour. The one path _gunTake had NO guard against is a BLE drop:
  // `onBleDropped()` bumps `_lightGen` but touches neither `alive` nor `_gunLife`, so a queued blank+paint
  // used to still land on a relinked gun. That is the gap this test (and the _lightGen check) closes.
  const h = harness().kit().config_().echo();
  h.eng.frames.gun = { in_play: 'team', blank: '$GLED,,,,5,,,*', rest: '$GLED,1,1,1,0,10,,*', after_spawn_s: 2.5, take: ['$GLED,,,,5,,,*', '$GLED,1,1,1,0,10,,*'] };
  const pending = [];
  h.eng.delay = (ms, fn) => pending.push(fn);   // capture instead of firing inline (harness normally runs delays synchronously)
  h.start(0); h.adv(10); h.eng.tick();   // T-0 spawn calls _gunTake, which queues the blank+paint 2.5 s out
  assert.ok(pending.length > 0, 'the gun take queued its delayed blank+paint');
  assert.equal(h.eng.alive, true, 'still alive — the pre-existing !this.alive guard alone would not block this write');
  h.eng.onBleDropped();
  h.writes.length = 0;
  pending.forEach(fn => fn());
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'no gun-take write reached the gun after the BLE drop');
});

// ---- A15: cue pools -- a random take per event (Tony 2026-09-06: "the kill confirm sound and taunts should be
// selected on single kill at random") -----------------------------------------------------------------------
test('cue pools: a seeded rng picks the expected take, no pool falls back to cues[kind], a kill plays one OF the pool', () => {
  const POOL = ['$PLAY,,4,6,VAA,,,,*', '$PLAY,,4,6,VA8,,,,*', '$PLAY,,4,6,VA9,,,,*', '$PLAY,,4,6,VAK,,,,*', '$PLAY,,4,6,VAL,,,,*'];
  const mk = (r) => {
    const writes = [], logs = [];
    const eng = new Engine({ writer: fr => writes.push(...fr), emit: () => {}, report: () => {}, now: () => 1_000_000, synced: () => true,
      storage: mkStorage(), log: l => logs.push(l), delay: (ms, fn) => fn(), rng: () => r });
    const config = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
      respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
      teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
    const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
    const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
    const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }];
    const bundle = { ...golden, player_id: 'p1', cues: { ...golden.cues, kill: POOL[0] }, cue_pools: { kill: POOL } };
    eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
    eng.onMcMessage({ kind: 'assign', body: { player, team, roster } });
    eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } });
    eng.feedFrame('$LCD,0,0,0,0,0,0,*');
    return { eng, writes, logs, bundle };
  };
  // rng 0.5 -> index floor(0.5 * 5) = 2 -> VA9; the write reason names the take
  const a = mk(0.5); a.writes.length = 0;
  a.eng._event('kill');
  assert.deepEqual(a.writes.filter(w => w.startsWith('$PLAY')), [POOL[2]], 'seeded pick is pool[2]');
  assert.ok(a.logs.some(l => l.includes('event cue kill (3/5)')), 'the log says which take: ' + a.logs.slice(-3).join(' | '));
  // rng just under 1 -> the last take; never out of range
  const z = mk(0.999999); z.writes.length = 0; z.eng._event('kill');
  assert.deepEqual(z.writes.filter(w => w.startsWith('$PLAY')), [POOL[4]]);
  // no pool for this kind -> cues[kind] exactly as before
  a.writes.length = 0; a.eng._event('game_over');
  assert.deepEqual(a.writes.filter(w => w.startsWith('$PLAY')), [golden.cues.game_over], 'no pool: the single cue');
  // an old bundle (no cue_pools at all) plays cues.kill
  const old = mk(0.5); old.eng.frames = { ...old.bundle, cue_pools: undefined }; old.writes.length = 0; old.eng._event('kill');
  assert.deepEqual(old.writes.filter(w => w.startsWith('$PLAY')), [POOL[0]], 'pre-A15 bundle: cues.kill');
  // a plain-kill feedback: $SFLASH first, then ONE frame of the pool (not always cues.kill)
  const k = mk(0.7); k.eng.onMcMessage({ kind: 'start', body: { t0: k.eng.now(), config_id: golden.config_id } }); k.writes.length = 0;
  k.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: k.eng.now() } });
  const plays = k.writes.filter(w => w.startsWith('$PLAY'));
  assert.ok(k.writes.includes('$SFLASH,*') && plays.length === 1 && POOL.includes(plays[0]) && k.writes.indexOf('$SFLASH,*') < k.writes.indexOf(plays[0]), 'flash, then a pool take: ' + k.writes.join(' '));
  assert.equal(plays[0], POOL[3], 'rng 0.7 -> pool[3]');
  // MC's explicit `cue` on the body still wins (older MC / a specific line), and medal stacks are untouched
  k.writes.length = 0; k.eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', kind: 'kill', t: k.eng.now(), cue: golden.cues.kill } });
  assert.deepEqual(k.writes.filter(w => w.startsWith('$PLAY')), [golden.cues.kill]);
});

// ---- A15.2: the spawn line is OURS (Tony 2026-09-06, bench: an empty $PSET cry field silences the firmware; $SPAWN then
// $PLAY in the SAME write plays clean; "what if we dont rely on the firmware to make the sound on spawn and we just control it")
test('spawn writes one take of the spawn pool right after $SFLASH in the same write; revive carries one too; no pool = cues.spawn; pre-A15.2 = nothing', () => {
  const POOL = ['$PLAY,,4,6,VAI,,,,*', '$PLAY,,4,6,VAN,,,,*', '$PLAY,,4,6,VAO,,,,*'];
  const mk = (r, frames) => {
    const h = harness();
    h.eng.rng = () => r;
    h.kit().config_();
    h.eng.frames = { ...h.eng.frames, ...frames };
    h.echo(); h.writes.length = 0;
    h.start(0); h.adv(10); h.eng.tick();
    return h;
  };
  const plays = ws => ws.filter(w => w.startsWith('$PLAY,,4,6,'));
  // a pool: rng 0.5 -> pool[1] (VAN), written in the spawn write right after $SFLASH
  const a = mk(0.5, { cues: { ...golden.cues, spawn: POOL[0], respawned: POOL[0] }, cue_pools: { ...(golden.cue_pools || {}), spawn: POOL, respawned: POOL } });
  const i = a.writes.indexOf('$SFLASH,*');
  assert.ok(i > 0 && a.writes[i + 1] === POOL[1], 'rng 0.5 -> VAN right after $SFLASH: ' + a.writes.slice(i - 1, i + 3).join(' '));
  assert.equal(plays(a.writes).length, 1, 'exactly one voice line at spawn: ' + plays(a.writes).join(' '));
  // revive: the take rides in the revive write, once (the respawned event is lights only)
  a.frame('$HIR,4,0,19,2,45,0,0,*'); a.frame('$HP,0,0,0,*'); a.writes.length = 0;
  a.adv(9000); a.eng.tick();
  assert.ok(a.eng.alive, 'auto-respawned');
  const rv = a.writes.indexOf('$SPAWN,,*');
  assert.ok(rv >= 0, 'revive wrote $SPAWN');
  assert.deepEqual(plays(a.writes), [POOL[1]], 'one spawn line on revive, from the respawned pool: ' + a.writes.join(' '));
  assert.ok(a.writes.indexOf(POOL[1]) > rv, 'after the revive frames');
  // no pool, one take: cues.spawn plays
  const b = mk(0.9, { cues: { ...golden.cues, spawn: '$PLAY,,4,6,V3I,,,,*' }, cue_pools: { ...(golden.cue_pools || {}), spawn: undefined } });
  const j = b.writes.indexOf('$SFLASH,*');
  assert.equal(b.writes[j + 1], '$PLAY,,4,6,V3I,,,,*', 'the single take');
  // a pre-A15.2 bundle (no cues.spawn at all): the spawn write ends on $SFLASH, nothing appended
  const { spawn: _s, respawned: _r, ...cuesOld } = golden.cues;
  const c = mk(0.5, { cues: cuesOld, cue_pools: {} });
  const k = c.writes.indexOf('$SFLASH,*');
  assert.ok(k === c.writes.length - 1 || !c.writes[k + 1].startsWith('$PLAY,,4,6,'), 'pre-A15.2: nothing after $SFLASH: ' + c.writes.slice(k).join(' '));
});

// ==================================================================================================
// A16 (led-language.md): the transient gun-body pool readout (§3.1/§5), held headset role states that
// survive hits (§3.3), the shared 1 s headset flash gate (§C), and the +1.0 s start/respawn flash (§D).
// All of these keys are OPTIONAL on the bundle -- an older MC (the golden fixture, and every test above
// this section) carries none of them, and every legacy code path (`gun.bands`, `headset.carrier`) must
// keep behaving exactly as it did before this section was added (proven by the whole suite staying green).
// ==================================================================================================
const RO_REST = '$GLED,,,,5,,,*';
const RO_H3 = '$GLED,0,3,0,0,10,,*', RO_H2 = '$GLED,0,2,0,0,10,,*', RO_H1 = '$GLED,0,1,0,0,10,,*';
const RO_A3 = '$GLED,3,0,3,0,10,,*', RO_A2 = '$GLED,2,0,2,0,10,,*', RO_A1 = '$GLED,1,0,1,0,10,,*';
const RO_S3 = '$GLED,3,3,3,0,10,,*', RO_S2 = '$GLED,2,2,2,0,10,,*', RO_S1 = '$GLED,1,1,1,0,10,,*';
const READOUT = {
  hold_s: 4, reload_glance_s: 2,
  pools: [
    { pool: 'shield', max: 30, bands: [[0.66, RO_S3], [0.33, RO_S2], [0.0, RO_S1]] },
    { pool: 'armor', max: 70, bands: [[0.66, RO_A3], [0.33, RO_A2], [0.0, RO_A1]] },
    { pool: 'health', max: 45, bands: [[0.66, RO_H3], [0.33, RO_H2], [0.0, RO_H1]] },
  ],
};
function readoutHarness() {
  const h = goLive(harness()); h.eng.frames.leds = {};
  h.eng.frames.gun = { rest: RO_REST, blank: RO_REST, after_spawn_s: 2.5, take: [RO_REST], readout: READOUT };
  h.eng._gunTake();   // fires inline (harness delays run inline): _gunTaken=true, strip at rest
  h.eng._armLife('harness');   // F209: end spawn protection now, so its table write does not land inside a timed readout check
  return h;
}

test('A16 readout: the innermost pool that moved gets a fresh band (health beats armor beats shield), written once', () => {
  const h = readoutHarness();
  h.writes.length = 0;
  // armour-only drop (health unchanged): paints the ARMOR band
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,20,0,*');   // 20/70 = 0.286 -> RO_A1
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [RO_A1], 'armour is the pool that moved');
  h.writes.length = 0;
  h.adv(1100);   // outside the 300 ms coalesce window, so this write is not dropped
  // a hit that drops health too: health is innermost, wins even though armour also moved this same frame
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,15,0,*');   // 25/45 = 0.555 -> RO_H2
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [RO_H2], 'health wins over armor when both moved');
  h.writes.length = 0;
  // same band again: no repaint
  h.adv(1100);
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,20,10,0,*');   // 20/45 = 0.444 -> still RO_H2
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'same band -> no repaint');
});

test('A16 readout: a change within 300 ms of the last WRITE is coalesced (dropped, never queued) but still restarts the hold', () => {
  const h = readoutHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,0,0,*');   // -> RO_H2, written, hold_s=4 armed
  h.writes.length = 0;
  h.adv(100);   // inside READOUT_COALESCE_MS (300 ms)
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,10,0,0,*');   // -> RO_H1, a real band change, too soon after the last write
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'coalesced: dropped, not queued');
  // the hold was restarted at the COALESCED event's time (+100 ms), not the original write's — past the
  // original write's hold_s (4000 ms from t=0) but still inside the restarted one must not revert yet
  h.adv(3999); h.eng.tick();   // now +4099 ms since the original write, +3999 ms since the restart
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'still held — the coalesced change restarted the timer');
  h.adv(2); h.eng.tick();      // +4101 ms since the restart
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [RO_REST], 'expires to rest once the RESTARTED hold elapses');
});

test('A16 readout: the hold expires to rest after hold_s with no further pool changes, then never repeats', () => {
  const h = readoutHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,0,0,*');   // -> RO_H2
  h.writes.length = 0;
  h.adv(3999); h.eng.tick();
  // F264: filtered to the strip, like the neighbouring A16 tests. The divergence poll writes `$QUERY,*` on its
  // own 20 s cadence now, and it is not the readout's business.
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'still held just before hold_s');
  h.adv(2); h.eng.tick();
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [RO_REST], 'reverts to rest once the hold elapses');
  h.writes.length = 0;
  h.adv(5000); h.eng.tick();
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'one rest write, never a repeating pulse');
});

test('F86 (polish 2026-09-11): after an infection flip the readout reverts to the NEW team\'s rest, on hold expiry and after an event burst', () => {
  const NEW_REST = '$GLED,2,2,2,0,1,,*';
  const h = readoutHarness();
  h.eng.frames.team_flip_take = { '2': [RO_REST, NEW_REST] };
  h.eng.team = { ...h.eng.team, tid: 2 };   // the flip has happened (the take-after-flip is covered above)
  h.eng._gunTake();
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,0,0,*');   // -> RO_H2, hold_s=4 armed
  h.adv(4001); h.eng.tick();
  const gled = h.writes.filter(f => f.startsWith('$GLED'));
  assert.deepEqual(gled, [RO_H2, NEW_REST], 'the hold expires to the flipped team\'s rest');
  assert.ok(!h.writes.includes(RO_REST), 'never the arming team\'s rest again');
  // and the end of an event burst lands on the same rest, not `gun.rest`
  h.eng.frames.leds = { kill: TEST_BURST }; h.writes.length = 0;
  h.eng._event('kill');
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).pop(), NEW_REST, 'a burst ends on the flipped rest');
  // CONTROL: with no flip table the same expiry paints `gun.rest` (the arming team), as the test above proves
  const c = readoutHarness(); c.writes.length = 0;
  c.frame('$HIR,4,0,19,2,9,0,0,*'); c.frame('$HP,25,0,0,*'); c.adv(4001); c.eng.tick();
  assert.deepEqual(c.writes.filter(f => f.startsWith('$GLED')), [RO_H2, RO_REST]);
});

test('A16 readout: a reload paints the CURRENT readout for reload_glance_s, even after the ordinary hold already went dark', () => {
  const h = readoutHarness();
  h.player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }] };
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,0,0,*');   // -> RO_H2 (25/45 = 0.555)
  h.adv(4000); h.eng.tick(); h.writes.length = 0;              // the ordinary hold already expired to rest
  h.frame('$ALCD,10,100,0,384,0,*'); h.frame('$BUT,2,1,*');    // reload handle pull
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [RO_H2], 'the reload glances the real current band, not the stale "rest" it had faded to');
  h.writes.length = 0;
  h.adv(1999); h.eng.tick();
  assert.equal(h.writes.length, 0, 'still glancing, just before reload_glance_s');
  h.adv(2); h.eng.tick();
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [RO_REST], 'the glance ends on rest');
  // nothing has moved yet this life (still at spawn's full health/armour) -> nothing to glance. Deliberately
  // NOT "is any pool below its configured max": shield spawns at 0 by hardware default and would always
  // read as "damaged" against a configured shield max, even for a loadout that never grants any.
  const g = readoutHarness(); g.player.loadout = { weapons: [{ weapon_id: 'assault_rifle' }] };
  g.writes.length = 0;
  g.frame('$ALCD,10,100,0,384,0,*'); g.frame('$BUT,2,1,*');
  assert.equal(g.writes.filter(f => f.startsWith('$GLED')).length, 0, 'nothing has moved yet -> nothing to glance');
});

test('F113: death BLANKS the strip and nothing else reaches the gun for the rest of the death', () => {
  // Was "death writes nothing and the strip is left as-is" (A16 §5). The field killed that: a fast kill
  // lands death mid-animation, A16.3 cancels the animation, and the strip froze at a partial pool level
  // for the whole death -- "it took down to 1 led of purple and then dead. while dead it stayed at 1 purple."
  const h = readoutHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,0,0,*');   // -> RO_H2, hold running
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');   // death
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [golden.gun.blank], 'death blanks the strip -- exactly one frame');
  h.writes.length = 0;
  for (let i = 0; i < 12; i++) { h.adv(250); h.eng.tick(); }   // 3 s down — past the old hold_s and a typical hands-off window
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'no stray readout write reaches the gun while down');
});

test('F113: a death mid-drop-animation still ends dark, and the blank is a bare gate-5 $GLED, never an $HLED', () => {
  // The exact shape of the field report: a hit starts the drop animation, the next hit kills before it lands.
  const h = readoutHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,40,0,0,*');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');   // killed mid-animation
  const last = h.writes.filter(f => f.startsWith('$GLED')).pop();
  assert.equal(last, '$GLED,,,,5,,,*', 'the LAST thing the strip is told is the blank');
  // A16 hard rule, unchanged: $HLED,,6 disables the firmware death flash for the life and is NEVER sent in play
  assert.ok(!h.writes.some(f => f.startsWith('$HLED') && f.split(',')[2] === '6'), 'no $HLED effect 6 in play');
});

test('F113: a bundle whose gun is native (no frames) is NOT blanked at death', () => {
  const h = readoutHarness();
  h.eng.frames = { ...h.eng.frames, gun: null };   // in_play: 'native' -- the strip was never ours
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'a game that never took the strip does not turn it off');
});

test('A16 readout: an event burst ends on the LIVE readout frame while its hold is running, and on rest once the hold has expired', () => {
  const h = readoutHarness();
  h.eng.frames.leds = { lead_taken: TEST_BURST };   // a stand-in burst shape (real gun steps with holds)
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,0,0,*');   // -> RO_H2, hold_s=4 running
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'lead_taken', text: 'LEAD', player_id: 'p1', t: h.eng.now() }, t: h.eng.now() });
  const gleds = h.writes.filter(f => f.startsWith('$GLED'));
  assert.ok(gleds.length > 1, 'the burst played');
  assert.equal(gleds[gleds.length - 1], RO_H2, 'ends on the live readout frame, not the top band or rest');
  // let the hold actually expire, then fire the same burst again -- it must end on rest this time
  h.adv(4001); h.eng.tick(); h.writes.length = 0; h.eng._lastEventLed = null;   // EVENT_MIN_GAP_MS would otherwise swallow a second burst in this test
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'lead_taken', text: 'LEAD', player_id: 'p1', t: h.eng.now() }, t: h.eng.now() });
  const gleds2 = h.writes.filter(f => f.startsWith('$GLED'));
  assert.equal(gleds2[gleds2.length - 1], RO_REST, 'ends on rest once the hold has already expired');
});

test('A16 graceful degradation: gun.bands and headset.carrier keep working exactly as before when readout/role are absent', () => {
  const G = '$GLED,3,3,3,0,10,,*', Y = '$GLED,2,2,2,0,10,,*';
  const h = goLive(harness()); h.eng.frames.leds = {};
  h.eng.frames.gun = { in_play: 'health', blank: '$GLED,,,,5,,,*', rest: G, bands: [[0.66, G], [0.33, Y], [0.0, '$GLED,0,0,0,0,10,,*']], after_spawn_s: 2.5, take: ['$GLED,,,,5,,,*', G] };
  h.eng._gunTake();
  // golden ships `headset.role` by default now -- an older MC never would, so strip it explicitly to
  // exercise the true legacy path (headset.carrier, tid-keyed team colour).
  h.eng.frames.headset = { ...golden.headset, role: undefined };
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,0,0,*');   // no `readout` key at all -> legacy health-band path
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [Y], 'legacy gun.bands still paints on a band change');
  h.writes.length = 0;
  h.eng.onMcMessage({ kind: 'alert', body: { kind: 'objective_taken', text: 'FLAG', player_id: 'p1', carrier: 'p1', flag_tid: 2, t: h.eng.now() }, t: h.eng.now() });
  assert.ok(h.writes.includes(golden.headset.carrier['2'][0][0]), 'legacy headset.carrier (team colour, tid-keyed) still works when headset.role is absent');
});

// ── A16 §3.3: headset role states ────────────────────────────────────────────────────────────────
test('A16 role: a role assigned via headset.role survives a hit and is cleared on death', () => {
  const h = goLive(harness());
  const VIP = '$HLED,5,0,,,10,,*';   // distinct from rest/hit/carrier
  h.eng.frames.headset = { ...h.eng.frames.headset, hit: [], role: { vip: [[VIP, 0]] } };
  h.eng._setRole('vip', true);
  assert.equal(h.eng._activeRole && h.eng._activeRole.name, 'vip', 'role assigned');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');   // a registered hit wipes the headset natively
  assert.ok(h.writes.includes(VIP), 'the vip role is re-asserted after the hit');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');   // death
  assert.equal(h.eng._activeRole, null, 'the role is cleared on death');
});

test('A16 role: infection turning assigns the infected role through headset.role at the moment of the flip', () => {
  const b = { ...golden, player_id: 'p1', team_flip: { '2': ['$TID,2,*'] }, headset: { ...golden.headset, role: { infected: [['$HLED,3,0,,,10,,*', 0]] } } };
  const writes = []; const facts = []; let clock = 1e6;
  const eng = new Engine({ writer: f => writes.push(...f), emit: f => facts.push(f), report: () => {}, now: () => clock, synced: () => true, storage: mkStorage(), log: () => {} });
  const config = { config_id: 'g', mode: 'infection', environment: 'indoor', night: false, time_limit_s: 300, respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: null, win_by: 'survival' }, health: { max_hp: 45, max_armor: 70 }, teams: [{ team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, { team_id: 'inf', tid: 2, name: 'INFECTED', color: 'red' }] };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'X', team_id: 'human', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' }, team: { team_id: 'human', tid: 1, name: 'HUMAN', color: 'blue' }, roster: [] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: b, roster: [] } }); eng.feedFrame('$LCD,0,0,0,0,0,0,*');
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm', go_live_t: clock, config_id: 'g', seq: 1, countdown_s: 0 } });
  clock += 10; eng.tick();
  eng.feedFrame('$HIR,4,0,19,2,9,0,3,*'); eng.feedFrame('$HP,0,0,0,*');
  assert.ok(writes.includes('$HLED,3,0,,,10,,*'), 'the infected colour is painted through the role mechanism at the turn');
  assert.equal(eng._activeRole && eng._activeRole.name, 'infected');
});

// ── A16 §C: node-initiated headset flashes share a 1 s minimum; down rearm and low-health bypass it ─
test('A16 §C: hit flash + role re-assert share a 1 s minimum; the down rearm is unaffected by it', () => {
  const h = goLive(harness());
  h.eng.frames.headset = { ...h.eng.frames.headset, hit: [['$HLED,0,2,100,100,10,2,*', 0.5], [golden.headset.rest, 0.0]], down: DOWN };
  const hs = h.eng.frames.headset;
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,61,0,*');   // hit #1: flashes
  assert.ok(h.writes.includes(hs.hit[0][0]), 'first hit flashes');
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,52,0,*');   // hit #2, 0 ms later: gated
  assert.equal(h.writes.filter(f => f.startsWith('$HLED')).length, 0, 'gated: no second flash inside 1 s');
  h.writes.length = 0;
  h.adv(1001);
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,43,0,*');   // past the gap: flashes again
  assert.ok(h.writes.includes(hs.hit[0][0]), 'flashes again once the gap has elapsed');
  // die immediately after: the down rearm fires on its OWN schedule, unaffected by the flash gate above
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  for (let i = 0; i < 10; i++) { h.adv(250); h.eng.tick(); }   // 2.5 s -- the hands-off window elapses
  assert.deepEqual(h.writes.filter(f => f === DOWN.rearm), [DOWN.rearm], 'the down rearm is written on schedule, never gated by the headset flash minimum');
});

// ── A16 §D: the start/respawn flash is scheduled +1.0 s after $SPAWN ────────────────────────────────
test('A16 §D: the start and respawn headset flash are scheduled 1.0 s after $SPAWN, not written inline', () => {
  const h = harness().kit().config_().echo();
  h.writes.length = 0; h.delays.length = 0;
  h.start(0); h.adv(10); h.eng.tick();   // T-0 spawn
  assert.ok(h.writes.includes('$SPAWN,,*'), 'spawn wrote $SPAWN');
  assert.ok(h.delays.includes(1000), 'the start flash is scheduled at +1.0 s, not written inline off $SPAWN');
  for (const f of h.bundle.headset.start.map(x => x[0])) assert.ok(h.writes.includes(f), 'start frame missing: ' + f);
  // revive: the same +1.0 s scheduling
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');
  h.delays.length = 0; h.writes.length = 0;
  h.adv(9000); h.eng.tick();             // auto respawn (delay 8 s)
  assert.ok(h.writes.includes('$SPAWN,,*'), 'revive wrote $SPAWN');
  assert.ok(h.delays.includes(1000), 'the respawn flash is scheduled at +1.0 s too');
  for (const f of h.bundle.headset.respawn.map(x => x[0])) assert.ok(h.writes.includes(f), 'respawn frame missing: ' + f);
});

// ── A16.3 (bar-spec 2026-09-07): the seven-level pool bar + drop/gain animation ──────────────────────
// A `gun.readout.pools[]` entry with a `levels` table (exactly 7, index 0..6, `[solid, blink|null]`)
// drives this path instead of the plain `bands` path above -- entirely separate, so every `bands` test
// above this section is the "graceful fallback" proof: it never once exercises this code.
const LV = i => `$GLED,H${i},*`;
const LVB = i => `$GLED,H${i}B,*`;
const LEVELS_H = [0, 1, 2, 3, 4, 5, 6].map(i => [LV(i), [1, 3, 5].includes(i) ? LVB(i) : null]);
const READOUT_LV = {
  hold_s: 4, reload_glance_s: 2, lead_ms: 180, blink_gap_ms: 80, step_ms: 120, blink_ms: 400,
  pools: [
    { pool: 'shield', max: 30, levels: [0, 1, 2, 3, 4, 5, 6].map(i => [`$GLED,S${i},*`, [1, 3, 5].includes(i) ? `$GLED,S${i}B,*` : null]) },
    { pool: 'armor', max: 70, levels: [0, 1, 2, 3, 4, 5, 6].map(i => [`$GLED,A${i},*`, [1, 3, 5].includes(i) ? `$GLED,A${i}B,*` : null]) },
    { pool: 'health', max: 45, levels: LEVELS_H },
  ],
};
function levelHarness() {
  const h = goLive(harness()); h.eng.frames.leds = {};
  h.eng.frames.gun = { rest: RO_REST, blank: RO_REST, after_spawn_s: 2.5, take: [RO_REST], readout: READOUT_LV };
  h.eng._gunTake();   // fires inline: _gunTaken=true, strip at rest, _roLevel still null (nothing painted this life)
  h.eng._armLife('harness');   // F209: end spawn protection now, so its table write does not land inside a timed readout check
  return h;
}

test('A16.3 levels: level maths -- round(fraction*6) clamped to 0..6, floored to 1 while the pool has anything left', () => {
  const h = levelHarness();
  const entry = { pool: 'health', max: 45 };
  const at = hp => { h.eng.hp = hp; return h.eng._readoutLevel(entry); };
  assert.equal(at(45), 6, 'full -> 6');
  assert.equal(at(0), 0, 'empty -> 0 (the only way to see "dark")');
  assert.equal(at(1), 1, '1 hp rounds to 0 but must never render as empty -- floored to 1');
  assert.equal(at(2), 1, '2/45 also rounds to 0 -- same floor');
  assert.equal(at(15), 2, '15/45 = 1/3 exactly -> round(2.0) = 2');
  assert.equal(at(23), 3, '23/45 -> round(3.07) = 3');
  assert.equal(at(30), 4, '30/45 = 2/3 exactly -> round(4.0) = 4');
});

test('A56 overshield: the gun shows shield + overshield as ONE teal pool, max = preset max + overshield (Tony 2026-09-24)', () => {
  const h = levelHarness();
  const entry = { pool: 'shield', max: 30 };
  h.eng.shield = 30; h.eng._prevShield = 30;
  h.eng._puGrantShield('os1', { name: 'OVERSHIELD', amount: 75 }, h.eng.now());   // shield 30 -> 105, past the max
  assert.equal(h.eng.shield, 105);
  assert.equal(h.eng._readoutLevel(entry), 6, 'fresh overshield: 105 of 30+75 -> full');
  h.eng.shield = 60;   // a hit drains the overshield first: 60 of 105
  assert.equal(h.eng._readoutLevel(entry), 3, 'the drain is visible while the overshield holds: round(60/105*6) = 3');
  h.eng._overshield = null; h.eng.shield = 30;   // overshield gone: the max falls back to the preset's
  assert.equal(h.eng._readoutLevel(entry), 6, 'no overshield: 30 of 30 -> full again');
  // the 3-band path reads the same maximum
  const bands = { pool: 'shield', max: 30, bands: [[0.66, 'HI'], [0.33, 'MID'], [0, 'LO']] };
  h.eng._overshield = { base: 30, amount: 75 }; h.eng.shield = 60;
  assert.equal(h.eng._readoutBand(bands)[1], 'MID', '60 of 105 is the middle band, not full');
});

test('A56 overshield on a no-shield preset (Standard, shield entry max 0): the overshield alone is the teal pool', () => {
  const h = levelHarness();
  const entry = { pool: 'shield', max: 0 };
  h.eng.shield = 0; h.eng._prevShield = 0;
  h.eng._puGrantShield('os1', { name: 'OVERSHIELD', amount: 75 }, h.eng.now());
  assert.equal(h.eng._readoutLevel(entry), 6, '75 of 0+75 -> full (was floored to 1 against a max of 0)');
  h.eng.shield = 40;
  assert.equal(h.eng._readoutLevel(entry), 3, 'round(40/75*6) = 3');
});

test('A16.3 levels: a drop animates lead(solid) -> blink-gap(all off) -> step down one level per step_ms -> settles', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,23,0,0,*');   // establishes level 3
  h.eng.hurtFired = true;   // office test 2026-09-19: level 1 is under LOW_HEALTH_HP too -- in a real decline
                             // the once-per-life alert would already have fired well before this; isolate the
                             // LED animation under test from that separate, now-debounced write
  h.writes.length = 0; h.delays.length = 0;
  h.adv(1000);                                                 // past the rapid-fire window: this is a SEPARATE hit,
                                                               // so it gets the full lead + all-off blink (a second hit
                                                               // inside the window deliberately skips both -- see the
                                                               // rapid-retrigger test below)
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,3,0,0,*');    // 3/45 -> level 1: a drop from 3 to 1
  const gleds = h.writes.filter(f => f.startsWith('$GLED'));
  assert.deepEqual(gleds, [LEVELS_H[3][0], LEVELS_H[0][0], LEVELS_H[2][0], LEVELS_H[1][0]],
    'from(3) solid, one all-off blink, step to 2, step to 1 (settle) -- in that order, no re-lighting');
  assert.deepEqual(h.delays, [180, 80, 120], 'lead_ms, then blink_gap_ms, then one step_ms (2 -> 1 is the only intermediate step)');
  assert.equal(h.eng._roLevel, 1, 'settled on the new level');
});

test('A16.3 levels: a change arriving mid-animation cancels it and restarts from the level currently displayed -- never queued, never two at once', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,23,0,0,*');   // level 3
  h.eng.hurtFired = true;   // office test 2026-09-19: isolate this animation from the separate, now-debounced low-health write (see the test above)
  h.adv(1000);                                                 // separate hit, so the full lead+blink sequence runs
  const pending = [];
  h.eng.delay = (ms, fn) => pending.push(fn);   // manual control from here so we can interrupt mid-sequence
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,3,0,0,*');    // starts dropping toward level 1
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [LEVELS_H[3][0]], 'the from-level freeze is written immediately');
  assert.equal(pending.length, 1, 'only the lead_ms step is queued so far');
  pending.shift()();   // fire lead_ms: writes the all-off blink, queues the blink_gap_ms step
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')).slice(-1), [LEVELS_H[0][0]]);
  assert.equal(pending.length, 1, 'the gap step is queued; still displaying "3" conceptually (blanked, not yet stepped)');
  const staleGapStep = pending.shift();
  // a SECOND hit lands now, mid-animation, targeting a different level (2, not the original target of 1)
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,15,0,0,*');   // 15/45 -> level 2
  // This second change lands INSIDE the rapid-retrigger window, so by design it skips the lead freeze and
  // the all-off blink and steps straight from where the strip is -- replaying those on every hit of a burst
  // is what would breach the 3-light-ups-per-second ceiling. What must still hold is that it restarted from
  // the CURRENTLY DISPLAYED level (3), not from 1, the old target: the first step down from 3 is 2.
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [LEVELS_H[2][0]],
    'stepped from the level currently displayed (3 -> 2), not from 1, the old target');
  h.writes.length = 0;
  staleGapStep();   // the OLD (now-stale) gap step, fired late: must be a pure no-op
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'a step from the cancelled animation writes nothing');
  // 3 -> 2 is a single step, so the retrigger reached its target immediately and settled. The old target
  // (1) is never shown, and the old chain never resumes.
  assert.equal(pending.length, 0, 'no further steps queued -- the old chain never resumed, and none were queued alongside it');
  assert.equal(h.eng._roLevel, 2, 'settled on the NEW target (2), never on the old target (1)');
});

test('A16.3 levels: a SECOND life animates from FULL again -- the per-pool map does not survive a revive', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,23,0,0,*');      // life 1: health down to level 3
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');      // die
  h.adv(9000); h.eng.tick();                                      // auto respawn -> _gunTake() fires inline
  h.writes.length = 0; h.adv(2000);
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,10,0,0,*');      // life 2, FIRST health hit: 10/45 -> level 1
  const gleds = h.writes.filter(f => f.startsWith('$GLED'));
  // It must animate from FULL (6), not from 3 -- the level this pool happened to end the PREVIOUS life on.
  // The regression this pins: `_gunTake()` cleared `_roLevel` but not the per-pool `_roLevels` map, so from
  // life 2 onward any pool touched in the prior life resumed from its stale value. stage.py always cleared
  // and reseeded at spawn, so the bench looked right while the phone did not.
  assert.equal(gleds[0], LEVELS_H[6][0], 'the freeze frame is FULL, not last life\'s level');
  assert.ok(gleds.includes(LEVELS_H[0][0]), 'and the all-off blink still plays for a fresh life');
  assert.equal(h.eng._roLevels.health, 1, 'settled, and the per-pool map now tracks THIS life');
});

test('A16.3 levels: rapid hits do NOT replay the lead+all-off blink -- the 3-light-ups-per-second ceiling', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,40,0,0,*');    // first change of the life
  h.writes.length = 0;
  // four more hits inside one second, i.e. automatic fire. Each is a real level change.
  for (const hp of [30, 22, 14, 6]) { h.adv(150); h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame(`$HP,${hp},0,0,*`); }
  const gleds = h.writes.filter(f => f.startsWith('$GLED'));
  const blanks = gleds.filter(f => f === LEVELS_H[0][0]).length;
  // The all-off frame is the dark->lit transition that costs a "light-up". poolgauge's own warning is
  // explicit that flicker in this band is the photosensitivity risk, so a burst must not replay it per hit.
  assert.equal(blanks, 0, 'no all-off blink is replayed for hits inside the rapid window');
  assert.ok(gleds.length > 0, 'the bar still tracks the damage -- the steps carry the information');
  assert.ok(!gleds.some((f, i) => i > 0 && f === gleds[i - 1]), 'and it never writes the same frame twice in a row');
});

test('A16.3 levels: a gain animates upward with the same steps and no initial blink', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,10,0,0,*');   // 10/45 -> level 1
  h.writes.length = 0; h.delays.length = 0;
  h.frame('$ALCD,10,100,0,384,0,*');                            // a heal: HP goes UP (armor/shield untouched)
  h.frame('$HP,30,0,0,*');                                      // 30/45 -> level 4: a gain from 1 to 4
  const gleds = h.writes.filter(f => f.startsWith('$GLED'));
  assert.deepEqual(gleds, [LEVELS_H[2][0], LEVELS_H[3][0], LEVELS_H[4][0]], 'straight into stepping up -- no from-freeze, no all-off blink');
  assert.deepEqual(h.delays, [120, 120], 'only step_ms delays -- no lead_ms, no blink_gap_ms');
  assert.ok(!gleds.includes(LEVELS_H[0][0]), 'never blanks on the way up');
  assert.equal(h.eng._roLevel, 4);
});

test('A16.3 levels: settling on a PARTIAL level blinks its top segment at blink_ms; a WHOLE level never blinks; the blink stops on hold expiry', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,23,0,0,*');   // level 3 -- ODD, partial
  h.writes.length = 0;
  h.adv(399); h.eng.tick();
  assert.equal(h.writes.length, 0, 'not yet -- just before blink_ms');
  h.adv(1); h.eng.tick();
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [LEVELS_H[3][1]], 'flips to the top-segment-off half at blink_ms');
  h.writes.length = 0;
  h.adv(400); h.eng.tick();
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [LEVELS_H[3][0]], 'flips back to solid 400 ms later');
  h.writes.length = 0;
  h.adv(3201); h.eng.tick();   // total since settle: 180(lead)+80(gap)+120(step)... no -- since settle at t0, hold_s=4000 from settle; we're now at 400+400+3201=4001ms since settle
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [RO_REST], 'hold_s elapsed -- reverts to rest, blink stops');
  h.writes.length = 0;
  h.adv(2000); h.eng.tick();
  assert.equal(h.writes.length, 0, 'no further blink writes once the hold (and the blink with it) has ended');

  // a WHOLE level (even) settles solid and never blinks, however long it sits there
  const w = levelHarness();
  w.frame('$HIR,4,0,19,2,9,0,0,*'); w.frame('$HP,30,0,0,*');   // level 4 -- EVEN, whole
  w.writes.length = 0;
  for (let i = 0; i < 8; i++) { w.adv(400); w.eng.tick(); }    // 3.2 s of blink_ms ticks, still inside hold_s
  assert.equal(w.writes.filter(f => f.startsWith('$GLED')).length, 0, 'a whole level is rock solid -- no blink writes at all before the hold expires');   // F264: filtered to the strip; the divergence poll has its own cadence
});

test('A16.3 levels: death cancels an in-flight animation outright; a stale queued step writes nothing to the gun', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,23,0,0,*');   // level 3
  const pending = [];
  h.eng.delay = (ms, fn) => pending.push(fn);
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,3,0,0,*');    // starts dropping toward level 1
  assert.ok(pending.length > 0, 'a step is queued');
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');   // a lethal hit -- death
  h.writes.length = 0;
  pending.forEach(fn => fn());   // every step queued before death, fired late
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'no stale animation step reaches the gun after death');
  assert.equal(h.eng._roLevel, null, 'animation state cleared on death');
  assert.equal(h.eng._roAnimating, false);
});

test('A16.3 levels: a revive starts the next life with nothing displayed -- no stale level, no stale blink', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,23,0,0,*');   // level 3, settled (odd -- blink armed)
  assert.equal(h.eng._roLevel, 3);
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');   // death
  h.adv(9000); h.eng.tick();                                    // auto respawn (delay 8 s) -> _revive -> _gunTake
  assert.equal(h.eng._roLevel, null, 'nothing painted yet in the new life');
  assert.equal(h.eng._roPool, null);
  assert.equal(h.eng._roAnimating, false);
  h.writes.length = 0;
  h.adv(1000); h.eng.tick();   // well past any old blink_ms/hold_s -- proves nothing is still ticking from the old life
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'no stray write from the previous life\'s animation');
});

test('A16.3 graceful fallback: a `bands`-only readout (no `levels` key at all) is untouched by any of the animation machinery', () => {
  const h = readoutHarness();   // the pre-existing A16 fixture -- `bands`, no `levels`, on every pool
  h.writes.length = 0; h.delays.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,25,0,0,*');   // -> RO_H2, same as the legacy test above
  assert.deepEqual(h.writes.filter(f => f.startsWith('$GLED')), [RO_H2], 'one immediate write, no animation steps');
  assert.deepEqual(h.delays, [], 'no lead/gap/step delays -- the bands path never touches `this.delay`');
  assert.equal(h.eng._roAnimating, false, 'the animation flag is never set on the bands path');
  assert.equal(h.eng._roLevel, null, 'the levels-mode state is never touched on the bands path');
});

// ── A16.5 (2026-09-09, found on the gun): the emptied-pool handover ────────────────────────────────────
// A shot took armour 35 -> 0 while health sat untouched at 45/45. The strip animated armour all the way
// down to the all-dark level-0 frame and HELD it for the whole hold_s -- reading "nothing left" at the
// exact moment the player was at full health. `handoverPool` (mirrors `poolgauge.handover_pool`) and the
// `settle` wiring in `_readoutAnimStart` fix that: an emptied pool hands over inward (shield -> armour ->
// health) to whichever pool still has something, instead of holding the dark frame.
test('A16.5: armour drains to 0 while health is FULL -> hands over to HEALTH instead of holding a dark strip', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,0,0,*');   // armour 70 -> 0, health untouched at 45/45
  const gleds = h.writes.filter(f => f.startsWith('$GLED'));
  assert.ok(gleds.includes('$GLED,A0,*'), 'the drain must still reach armour level 0 first -- losing it is never hidden');
  assert.equal(gleds[gleds.length - 1], LEVELS_H[6][0], 'after the drain it hands over and paints HEALTH at its own level (full), not a dark hold');
  assert.equal(h.eng._roPool, 'health', 'the readout now tracks health, not the emptied armour');
  assert.equal(h.eng._roLevel, 6);
  assert.equal(h.eng._readoutLastPool, 'health',
    'a reload glance must re-show what is actually on the strip -- re-deriving armour (now 0) would repaint the very dark frame this feature exists to avoid');
});

test('A16.5: shield empties while armour still has value -> hands over to ARMOUR', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,70,20,*');   // grant: shield 0 -> 20 (armour/health untouched)
  h.adv(1000); h.writes.length = 0; h.delays.length = 0;         // past the rapid window: a separate, later hit
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,70,0,*');    // shield drained back to 0, armour untouched at 70/70
  const gleds = h.writes.filter(f => f.startsWith('$GLED'));
  assert.ok(gleds.includes('$GLED,S0,*'), 'the drain must still reach shield level 0');
  assert.equal(gleds[gleds.length - 1], '$GLED,A6,*', 'hands over to ARMOUR at its own (full) level, not a dark hold');
  assert.equal(h.eng._roPool, 'armor');
  assert.equal(h.eng._roLevel, 6);
});

test('A16.5: health emptying too hands over to NOTHING -- death is deliberately hands-off (A16)', () => {
  // Structurally unreachable through the live engine: `_onHp` only ever calls `_gunPoolPaint` `if (hp > 0)`
  // (mirrors stage.py's own `if hp > 0` guard) -- a hit that empties health never reaches the readout/
  // handover machinery at all, because death's hands-off rule is enforced one level up, before this
  // function is ever consulted. Exercised directly here instead, the same shape `poolgauge.handover_pool`
  // documents: once nothing inward has anything left, the readout stays on the pool that emptied.
  assert.equal(handoverPool('armor', { shield: 0, armor: 0, health: 0 }, ['shield', 'armor', 'health']), 'armor');
  assert.equal(handoverPool('health', { shield: 0, armor: 0, health: 0 }, ['shield', 'armor', 'health']), 'health');
});

test('A16.5: a pool that still has something left settles normally -- no handover', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,20,0,*');   // armour 70 -> 20 (well above zero) -> level 2
  const gleds = h.writes.filter(f => f.startsWith('$GLED'));
  assert.equal(gleds[gleds.length - 1], '$GLED,A2,*', "settles on armour's own level, never hands over");
  assert.equal(h.eng._roPool, 'armor');
  assert.equal(h.eng._roLevel, 2);
});

test('A16.5: a death mid-handover-pause cancels it -- no stale write, no stale pool/level state', () => {
  const h = levelHarness();
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,70,0,*');   // baseline: health/armour full, shield 0
  const pending = [];
  h.eng.delay = (ms, fn) => pending.push(fn);   // manual control so we can catch the handover's own pause queued
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,9,0,0,*'); h.frame('$HP,45,0,0,*');    // armour drains 70 -> 0, health untouched: drop begins
  // Drive the drop by hand until it has settled at level 0 and queued the handover's one-`step_ms` pause.
  // Armour 6 -> 0 writes exactly 8 $GLED frames (the from-freeze, the all-off blink, then one step per
  // level 5..0) before the settle -- the one delay queued after that is the handover pause, not another
  // drop step.
  while (h.writes.filter(f => f.startsWith('$GLED')).length < 8) pending.shift()();
  assert.equal(pending.length, 1, 'only the handover pause is queued once the drop itself has settled at 0');
  assert.equal(h.eng._roPool, 'armor', 'still tracking armour -- the handover has not painted yet');
  const staleHandover = pending.shift();
  h.frame('$HIR,4,0,19,2,60,0,0,*'); h.frame('$HP,0,0,0,*');    // a lethal hit lands during the pause -- death
  h.writes.length = 0;
  staleHandover();                                              // the stale handover paint, fired late
  assert.equal(h.writes.filter(f => f.startsWith('$GLED')).length, 0, 'no stale handover write reaches the gun after death');
  assert.equal(h.eng._roPool, null, 'death cleared the readout state outright -- the handover never got to set it');
  assert.equal(h.eng._roLevel, null);
});

// ── F57: the low-health warning and the pain grunt must not fire in the same millisecond ────────
test('F57: the hit that crosses the low-health threshold plays the warning and NOT the pain grunt; past the gap the grunt is back', () => {
  // Bench 2026-09-09 (Tony: "the critical sounds are a bit bugged when it was at 1 red"): `rx $HP,8,0,0` -> `$PLAY VA6`
  // (low health) AND `$PLAY VAG` (pain short) at the same timestamp; the gun plays one clip at a time.
  const h = goLive(harness());
  const plays = () => h.writes.filter(f => f.startsWith('$PLAY'));
  const hurt = () => plays().filter(f => f === golden.cues.hurt);
  const pains = () => plays().filter(f => golden.cue_pools.pain_short.includes(f) || golden.cue_pools.pain_long.includes(f));
  assert.ok(!golden.cue_pools.pain_short.includes(golden.cues.hurt) && !golden.cue_pools.pain_long.includes(golden.cues.hurt), 'the warning is not one of the pain takes (or these counts would be confounded)');

  h.frame('$HIR,4,0,19,2,70,0,0,*'); h.frame('$HP,45,0,0,*');   // armour gone, silently (equipment, A17)
  // CONTROL: a health hit ABOVE the threshold grunts as before, and no warning yet
  h.adv(700); h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,29,0,0,*'); h.frame('$HP,16,0,0,*');
  assert.equal(pains().length, 1, 'CONTROL: 16 HP is above the threshold -- the grunt plays');
  assert.equal(hurt().length, 0, 'and the warning does not');

  // THE CROSSING HIT: warning yes, grunt no
  h.adv(700); h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,8,0,0,*'); h.frame('$HP,8,0,0,*');
  assert.equal(hurt().length, 1, 'the crossing hit plays low_health');
  assert.equal(pains().length, 0, 'and NOT the grunt -- one speaker, one clip');

  // a follow-up inside PAIN_GAP_MS cannot cut the warning short either (the gate is stamped by the warning)
  h.adv(300); h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,2,0,0,*'); h.frame('$HP,6,0,0,*');
  assert.equal(pains().length, 0, 'inside the pain gap of the warning: no grunt');

  // CONTROL: the next hit under the threshold, past the gap, grunts again -- and the warning stays once per life
  h.adv(700); h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,2,0,0,*'); h.frame('$HP,4,0,0,*');
  assert.equal(pains().length, 1, 'CONTROL: the next hit below the threshold grunts again');
  assert.equal(hurt().length, 0, 'the warning fired once this life');
});

// ── F15: the host-driven stun (EMP) ─────────────────────────────────────────────────────────────
function stunHarness() { const h = harness(); h.config.stun = { duration_s: 10 }; return goLive(h); }
const ammoWrites = h => h.writes.filter(f => f.startsWith('$AMMO'));

test('F15: a proto-8 $HIR under config.stun disarms every live slot, extends on a second word, and restores the LIVE counts on expiry', () => {
  const h = stunHarness();
  h.frame('$ALCD,20,100,0,150,0,*');   // slot 0 has fired: live 20/150, not the frame's 32/192
  h.writes.length = 0;
  h.frame('$HIR,4,8,19,2,15,0,0,*');   // the EMP word: proto 8, no $HP follows (fn 24 is a status row)
  assert.deepEqual(ammoWrites(h), ['$AMMO,0,0,0,1,*', '$AMMO,1,0,0,1,*'], 'both live slots disarmed (the F15 chain)');
  assert.equal(h.eng.moment.kind, 'stunned');
  assert.equal(h.eng.state().stunned.leftMs, 10000, 'the default 10 s window, exposed for the HUD');
  assert.equal(h.eng.hp, 45, 'a stun is not damage');
  assert.equal(h.facts.filter(f => f.type === 'hit_taken').length, 0, 'no hit_taken: no $HP moved');

  // an echo of our own disarm must neither count shots nor become the count we restore
  const shots = h.eng.shots;
  h.frame('$ALCD,0,100,0,0,0,*');
  assert.equal(h.eng.shots, shots, 'a $ALCD while stunned books no shots');

  // EXTEND, not double-restore: a second EMP 4 s in writes nothing and pushes the window out
  h.adv(4000); h.writes.length = 0;
  h.frame('$HIR,4,8,19,2,15,0,0,*');
  assert.equal(ammoWrites(h).length, 0, 'no second disarm write');
  assert.equal(h.eng.stunned.until, h.eng.now() + 10000, 'a full window from the second word');
  h.adv(6500); h.eng.tick();
  assert.ok(h.eng.stunned, 'the first window has passed; the extension still holds');
  assert.equal(ammoWrites(h).length, 0, 'and nothing restored yet');

  // expiry: ONE restore, with the LIVE counts (slot 0) and the frame's counts for a slot that never fired (slot 1)
  h.adv(3600); h.eng.tick();
  assert.equal(h.eng.stunned, null);
  assert.deepEqual(ammoWrites(h), ['$AMMO,0,20,150,1,*', '$AMMO,1,6,24,1,*'], 'restore = live counts, never the frame\'s for a slot that fired');
  assert.equal(h.eng.moment.kind, 'stun_over');
  h.writes.length = 0; h.adv(1000); h.eng.tick();
  assert.equal(ammoWrites(h).length, 0, 'restored once');
  // the gun fires again and the counter picks up from the live count
  h.frame('$ALCD,19,100,0,150,0,*');
  assert.equal(h.eng.shots, shots + 1, 'one shot after the restore, counted from the restored magazine');
});

test('F15 (Tony, 2026-09-18): a stun plays the concussion cue once, in the same write as the disarm, and an extend plays nothing again', () => {
  const h = stunHarness();
  h.writes.length = 0;
  h.frame('$HIR,4,8,19,2,15,0,0,*');   // the EMP word starts the stun
  const plays = h.writes.filter(f => f.startsWith('$PLAY'));
  assert.deepEqual(plays, ['$PLAY,X17,4,6,,,,,*'], 'one $PLAY,X17 cue, beside the $AMMO disarm');

  // EXTEND: a second EMP inside the window must not repeat the cue (F274: one write per hit, not per tick)
  h.adv(2000); h.writes.length = 0;
  h.frame('$HIR,4,8,19,2,15,0,0,*');
  assert.equal(h.writes.filter(f => f.startsWith('$PLAY')).length, 0, 'no second cue on an extend');

  // expiry: the restore is a plain $AMMO write, no cue on the way out
  h.writes.length = 0; h.adv(10100); h.eng.tick();
  assert.equal(h.eng.stunned, null, 'restored');
  assert.equal(h.writes.filter(f => f.startsWith('$PLAY')).length, 0, 'no cue on restore');
});

test('F15: death cancels the stun -- no restore write; the revive\'s own $AMMO re-arms the next life', () => {
  const h = stunHarness();
  h.frame('$HIR,4,8,19,2,15,0,0,*');
  assert.ok(h.eng.stunned);
  h.writes.length = 0;
  h.frame('$HIR,4,0,19,2,45,0,0,*'); h.frame('$HP,0,0,0,*');   // killed while stunned
  assert.equal(h.eng.stunned, null, 'death cancels');
  h.adv(11000); h.eng.tick();                                     // past the stun window AND the 8 s respawn delay
  assert.ok(h.eng.alive, 'respawned');
  assert.deepEqual(ammoWrites(h), golden.revive.filter(f => f.startsWith('$AMMO')), 'only the revive frames re-armed the gun -- no stun restore after death');
  assert.equal(h.eng.moment.kind, 'redeploy', 'no stun_over moment after a death');
});

test('F15 (polish 2026-09-11): a stun before the first shot of a NEW life restores THIS life\'s reserve, not the last life\'s', () => {
  const h = stunHarness();
  h.frame('$ALCD,20,100,0,150,0,*');                              // life 1 fired: live 20/150
  h.frame('$HIR,4,0,19,2,45,0,0,*'); h.frame('$HP,0,0,0,*');       // killed
  h.adv(9000); h.eng.tick(); assert.ok(h.eng.alive, 'life 2');    // the revive re-armed the frame's 32/192
  h.writes.length = 0;
  h.frame('$HIR,4,8,19,2,15,0,0,*');                              // stunned before any $ALCD of life 2
  assert.deepEqual(ammoWrites(h), ['$AMMO,0,0,0,1,*', '$AMMO,1,0,0,1,*']);
  h.adv(10100); h.eng.tick();
  const frameSlot0 = golden.revive.find(f => f.startsWith('$AMMO,0,'));
  assert.deepEqual(ammoWrites(h).slice(-2), [frameSlot0, golden.revive.find(f => f.startsWith('$AMMO,1,'))],
    'the restore is the revive frame\'s pair; life 1\'s 150 reserve must not leak into life 2 (both $ALCD maps reset on spawn)');
  assert.ok(!ammoWrites(h).some(f => f.includes(',150,')), 'the stale reserve never reaches the gun');
  // CONTROL: a shot in life 2 before the stun makes the LIVE pair the restore, as the main test proves
  h.writes.length = 0;
  h.frame('$ALCD,31,100,0,192,0,*');
  h.frame('$HIR,4,8,19,2,15,0,0,*'); h.adv(10100); h.eng.tick();
  assert.ok(ammoWrites(h).includes('$AMMO,0,31,192,1,*'));
});

test('F15 CONTROLS: without config.stun a proto-8 word is an ordinary hit (the stock <8,0> row is the charge rifle); a proto-0 hit never stuns; a stun before spawn is ignored', () => {
  const h = goLive(harness());                                  // no config.stun
  h.writes.length = 0;
  h.frame('$HIR,4,8,19,2,15,0,0,*'); h.frame('$HP,45,55,0,*');   // a charge-rifle hit lands as damage today
  assert.equal(ammoWrites(h).length, 0, 'CONTROL: no disarm without the config');
  assert.equal(h.eng.stunned, null);
  assert.equal(h.facts.filter(f => f.type === 'hit_taken').length, 1, 'and it is booked as the hit it is');

  const s = stunHarness(); s.writes.length = 0;
  s.frame('$HIR,4,0,19,2,9,0,0,*'); s.frame('$HP,45,61,0,*');
  assert.equal(ammoWrites(s).length, 0, 'CONTROL: a plain proto-0 hit under config.stun disarms nothing');
  assert.equal(s.eng.stunned, null);

  const l = harness(); l.config.stun = { duration_s: 5 }; l.kit().config_().echo();   // lobby, not live
  l.writes.length = 0; l.frame('$HIR,4,8,19,2,15,0,0,*');
  assert.equal(l.eng.stunned, null, 'CONTROL: not live -- no stun');
  assert.equal(ammoWrites(l).length, 0);
});

test('F15: config.stun.duration_s sizes the window; an absent duration is the 10 s default; a rejoin reconcile takes the stun over', () => {
  const h = harness(); h.config.stun = { duration_s: 3 }; goLive(h);
  h.frame('$HIR,4,8,19,2,15,0,0,*');
  assert.equal(h.eng.state().stunned.leftMs, 3000);
  h.adv(3000); h.eng.tick();
  assert.equal(h.eng.stunned, null, 'restored at 3 s');
  const d = harness(); d.config.stun = {}; goLive(d);
  d.frame('$HIR,4,8,19,2,15,0,0,*');
  assert.equal(d.eng.state().stunned.leftMs, 10000, 'default 10 s');
  // a BLE drop + relink while stunned: the reconcile owns the disarm/re-arm from here
  d.writes.length = 0;
  d.eng.onBleDropped(); d.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(d.eng.stunned, null, 'the reconcile cancels the stun timer');
  assert.ok(d.eng.reconciling, 'and holds the gun disarmed itself');
});

// ── 2026-09-12 review of the F123/A20 diff (docs/archive/game-test-2026-09-11.md, Blocks A/C2) ───────────

test('A20: a handle pull while the gun is STUNNED starts no takeover — it could never be reconciled', () => {
  // `_onAmmo` drops every $ALCD for the whole stun window (F15), so a takeover opened here has nothing that
  // can end it: it runs to its deadline over a DISARMED gun and books `ok:false` on a reload nobody did.
  const h = stunHarness();
  h.frame('$ALCD,10,100,0,150,0,*');            // a part-empty magazine: a pull would otherwise take
  h.frame('$HIR,4,8,19,2,15,0,0,*');            // the EMP word — every live slot disarmed
  assert.ok(h.eng.stunned, 'stunned');
  h.frame('$BUT,2,1,*');                        // the player yanks the handle at a gun that cannot fire
  assert.equal(h.eng.state().reloading, false, 'no RELOADING takeover over a disarmed gun');
  assert.equal(h.eng.reloading, null);
  assert.equal(h.eng.state().reloadOutcome, null, 'and nothing is booked as a failed reload either');
  // CONTROL: the same pull once the stun is over does take
  h.adv(10100); h.eng.tick();
  assert.equal(h.eng.stunned, null, 'stun over');
  h.frame('$BUT,2,1,*');
  assert.equal(h.eng.state().reloading, true, 'CONTROL: the pull takes again once the gun is re-armed');
});

test('F123: a chain that fed shells and then FIRED books what the RELOAD gained, not the post-shot magazine', () => {
  // The shot that ends a chain is not part of what the reload achieved. Booking from the post-shot count
  // made "two shells in, then fire" read as `gained:0, ok:false` — the exact false verdict F123 exists to stop.
  const h = shellHarness();                     // slot 1, one shell in a 6-round tube
  h.frame('$BUT,2,1,*');
  h.adv(420); h.frame('$ALCD,2,100,1,23,0,*');
  h.adv(420); h.frame('$ALCD,3,100,1,22,0,*');  // two shells in
  assert.equal(h.eng.state().reloadGained, 2);
  h.adv(300); h.frame('$ALCD,2,100,1,22,0,*');  // the player shoots — the chain is over
  const out = h.eng.state().reloadOutcome;
  assert.equal(h.eng.state().reloading, false);
  assert.deepEqual({ ok: out.ok, gained: out.gained, from: out.from, to: out.to, why: out.why },
                   { ok: true, gained: 2, from: 1, to: 3, why: 'fired' });
});

test('F123: an ALT swap during a reload ENDS the takeover — SWITCHING is never hidden behind a stale RELOADING', () => {
  // `reloadUp` outranks `switchUp` in the HUD, so a takeover left running to its deadline swallows the
  // SWITCHING screen; and the swapped-away slot can never send the $ALCD that would have reconciled it.
  const h = shellHarness();
  h.frame('$ALCD,10,100,0,192,0,*');            // back on the rifle, part-empty
  h.frame('$BUT,2,1,*'); h.frame('$BUT,2,0,*');
  assert.equal(h.eng.state().reloading, true);
  h.adv(300); h.frame('$BUT,1,1,*');            // ALT with two weapons loaded = a swap
  const st = h.eng.state();
  assert.equal(st.reloading, false, 'the reload is over — the gun is drawing another weapon');
  assert.equal(st.switching, true, 'and SWITCHING is what the player sees');
  assert.equal(st.reloadOutcome.why, 'swapped');
});

test('F123: a BLE drop clears the held-button map — a press whose release never arrived cannot read as held forever', () => {
  const h = goLive(harness());
  h.frame('$BUT,0,1,*');                        // the trigger goes down
  h.adv(500);
  assert.equal(h.eng.state().held[0], 500, 'down for half a second');
  h.eng.onBleDropped();                         // …and the link dies before the release
  assert.deepEqual(h.eng.state().held, {}, 'the drop clears it — no release can ever arrive now');
  h.adv(60000);
  assert.deepEqual(h.eng.state().held, {}, 'and it does not come back as a minute-long hold');
});

test('review: reloading / reloadTotalMs / reloadGained / reloadOverrun are always read together', () => {
  const h = goLive(harness());
  h.frame('$ALCD,10,100,0,192,0,*');
  h.frame('$BUT,2,1,*');
  let s = h.eng.state();
  assert.ok(s.reloading && s.reloadTotalMs != null && s.reloadGained != null, 'live: all three set');
  h.adv(5000);                                  // past the deadline, BEFORE the tick that books the timeout
  s = h.eng.state();
  assert.deepEqual([s.reloading, s.reloadMs, s.reloadTotalMs, s.reloadGained, s.reloadOverrun],
                   [false, null, null, null, false],
                   'a render between the deadline and the next tick must not report a live total/gain beside reloading:false');
  assert.ok(h.eng.reloading, 'the takeover object is still there — the tick is what books it');
});

// ── 2026-09-12 round-2 review of the same diff ───────────────────────────────────────────────────

test('A20: an ALT press while the gun is STUNNED raises no swap — nothing could ever confirm one', () => {
  // `_reloadPulled` refused a stunned gun; `_altPressed` did not, and it is the same hole. `_onAmmo` drops
  // every $ALCD in the window, so a SWITCHING takeover opened here runs to `switchWindowMs()` and then books
  // an ASSUMED swap — leaving `activeSlot` on a weapon the player never drew for the rest of the life.
  const h = twoWeapons(stunHarness());
  h.frame('$ALCD,10,100,0,150,0,*');
  h.frame('$HIR,4,8,19,2,15,0,0,*');            // the EMP word — every live slot disarmed
  assert.ok(h.eng.stunned, 'stunned');
  h.frame('$BUT,1,1,*');                        // the player thumbs ALT at a gun that cannot fire
  assert.equal(h.eng.state().switching, false, 'no SWITCHING takeover over a disarmed gun');
  assert.equal(h.eng.switching, null);
  h.adv(h.eng.switchWindowMs() + 100); h.eng.tick();
  assert.equal(h.eng.state().activeSlot, 0, 'and no assumed swap books a weapon the player is not holding');
  // CONTROL: the same press, once the stun is over, switches
  h.adv(10100); h.eng.tick();
  assert.equal(h.eng.stunned, null, 'stun over');
  h.frame('$BUT,1,1,*');
  assert.equal(h.eng.state().switching, true, 'CONTROL: the same press switches once the gun is re-armed');
});

test('a BLE drop also forgets the LAST button edge — no link, no completing it', () => {
  // `held` was cleared on a drop and `lastButton` was not, so the diag panel kept showing a press whose
  // release can never arrive as the newest thing the gun said, for as long as the link stayed down.
  const h = goLive(harness());
  h.frame('$BUT,0,1,*');
  assert.equal(h.eng.state().lastButton.id, 0, 'the press is on record');
  h.eng.onBleDropped();
  assert.equal(h.eng.state().lastButton, null, 'the drop clears it, exactly as it clears `held`');
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(h.eng.state().lastButton, null, 'and the relink does not invent an edge either');
});

test('firing mid-reload reads as the player CANCELLING it, not as a reload that did not take', () => {
  // `reload did NOT take (fired)` put a failure in the log for the one outcome that is not one: the player
  // chose to shoot. Every chain weapon fired out of mid-reload logged it.
  const h = shellHarness();
  const logs = []; h.eng.log = m => logs.push(String(m));
  h.frame('$BUT,2,1,*');
  h.adv(420); h.frame('$ALCD,2,100,1,23,0,*');  // one shell in…
  h.adv(300); h.frame('$ALCD,1,100,1,23,0,*');  // …and the player shoots
  assert.equal(h.eng.state().reloading, false);
  assert.equal(h.eng.state().reloadOutcome.why, 'fired');
  assert.ok(logs.some(m => /reload cancelled by a shot: 2 of 6 loaded/.test(m)), 'the log says who stopped it: ' + JSON.stringify(logs));
  assert.ok(!logs.some(m => /did NOT take/.test(m)), 'and never calls the player\'s own choice a failure: ' + JSON.stringify(logs));
  // CONTROL: a reload the GUN never fed, ended by the deadline, is still a failure in plain words
  const c = shellHarness();
  const cl = []; c.eng.log = m => cl.push(String(m));
  c.frame('$BUT,2,1,*'); c.adv(5000); c.eng.tick();
  assert.equal(c.eng.state().reloadOutcome.why, 'timeout');
  assert.ok(cl.some(m => /reload did NOT take \(timeout\)/.test(m)), 'CONTROL: a gun that fed nothing still reads as a failure: ' + JSON.stringify(cl));
});

test('state() names WHICH takeover is running, so a second reload is never read as the first', () => {
  // The HUD latches `reloadOverrun` for the life of ONE reload. A $ALCD (fired) and a $BUT,2,1 in one BLE
  // batch end and re-open the takeover between two renders, and with no identity on it the new reload opened
  // on the old one's latch — already pulsing, its countdown already gone.
  const h = shellHarness();
  h.frame('$BUT,2,1,*');
  const first = h.eng.state().reloadAt;
  assert.ok(first > 0, 'a running takeover carries its start time');
  h.adv(300); h.frame('$ALCD,0,100,1,23,0,*'); h.frame('$BUT,2,1,*');   // fired + pulled again, ONE batch
  const s = h.eng.state();
  assert.equal(s.reloading, true, 'the second pull took');
  assert.ok(s.reloadAt > first, `a NEW takeover, not the old one: ${first} -> ${s.reloadAt}`);
  h.adv(5000); h.eng.tick();
  assert.equal(h.eng.state().reloadAt, null, 'and it goes null with the rest of the takeover');
});

// ---------- A24 / node.md §3.13: the match result is PUSHED, never inferred ----------
const RESULT = (over = 'win', match = 'm1') => ({
  match_id: match, outcome: over, winner: { team_id: 'blue' }, mode: 'tdm', win_by: 'kills',
  team_scores: [{ team_id: 'blue', name: 'BLUE', score: 25 }, { team_id: 'yellow', name: 'YELLOW', score: 19 }],
  rows: [{ player_id: 'p1', display: 'REAPER', team_id: 'blue', kills: 11, deaths: 4, assists: 2, kd: 2.8, accuracy: 34, best_streak: 5, medals: ['double_kill'] },
         { player_id: 'p2', display: 'VIPER', team_id: 'yellow', kills: 9, deaths: 7, assists: 1, kd: 1.3, accuracy: 28, best_streak: 3, medals: [] }],
  my: { player_id: 'p1', display: 'REAPER', team_id: 'blue', kills: 11, deaths: 4, assists: 2, kd: 2.8, accuracy: 34, best_streak: 5, medals: ['double_kill'] },
  honors: [{ medal: 'first_blood', player_id: 'p2', display: 'VIPER' }], provisional: false, t: 1,
});

test('A24 result: accepted for the CURRENT match, exposed in state(), and fires onResult', () => {
  const h = harness().kit().config_(); h.echo(); h.start(0); h.adv(100);
  let hook = null; h.eng.onResult = r => { hook = r; };
  h.eng.onMcMessage({ kind: 'result', body: RESULT('win') });
  assert.equal(h.eng.state().result.outcome, 'win');
  assert.equal(h.eng.state().resultWait, 'in');
  assert.equal(hook && hook.match_id, 'm1');
});

test('A24 result: a STALE match_id is dropped, not rendered over this match', () => {
  const h = harness().kit().config_(); h.echo(); h.start(0); h.adv(100);
  const r = h.eng.onMcMessage({ kind: 'result', body: RESULT('lose', 'm0') });
  assert.equal(r.ok, false); assert.equal(r.reason, 'stale');
  assert.equal(h.eng.state().result, null);
});

test('A24 result: no match_id, and no current match, are both dropped', () => {
  const h = harness().kit().config_(); h.echo();
  assert.equal(h.eng.onMcMessage({ kind: 'result', body: { outcome: 'win' } }).reason, 'no_match_id');
  assert.equal(h.eng.onMcMessage({ kind: 'result', body: RESULT('win') }).reason, 'no_match');   // never started
});

test('A24: the node NEVER infers win or lose — no message, no outcome, ever', () => {
  const h = harness().kit().config_(); h.echo(); h.start(0); h.adv(100);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  // in coverage, right after the whistle
  h.eng.setWsState('bound');
  assert.equal(h.eng.state().result, null);
  assert.equal(h.eng.state().resultWait, 'pending');
  // out of coverage, long past the settle window — still not a loss
  h.eng.setWsState('closed'); h.adv(31000);
  assert.equal(h.eng.state().resultWait, 'unreached');
  assert.equal(h.eng.state().result, null);
  // and there is no third state that reads as an outcome
  assert.ok(!['win', 'lose', 'draw', 'undecided'].includes(h.eng.state().resultWait));
});

test('A24: a relaunch during recap restores endedAt/result — without them the screen is pinned on PENDING for ever', () => {
  const h = harness().kit().config_(); h.echo(); h.start(0); h.adv(100);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  h.eng.setWsState('closed');
  assert.equal(h.eng.state().resultWait, 'pending');
  // relaunch: a fresh engine on the same storage, 31 s later, MC still unreachable
  const store = h.eng.storage;
  let clock = h.eng.now() + 31000;
  const eng2 = new Engine({ writer: () => {}, now: () => clock, synced: () => true, storage: store, log: () => {} });
  assert.equal(eng2.ended, true);
  assert.ok(eng2.endedAt > 0, 'endedAt must survive the restart — `resultWait` measures the settle window from it');
  assert.equal(eng2.state().resultWait, 'unreached', 'a restart during recap must still reach MC NOT REACHED, not sit on PENDING');
  assert.equal(eng2.state().result, null, 'and it still never invents an outcome');
});

test('A24: a result already pushed survives the restart too (the screen comes back with the outcome, not PENDING)', () => {
  const h = harness().kit().config_(); h.echo(); h.start(0); h.adv(100);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  h.eng.onMcMessage({ kind: 'result', body: { match_id: h.eng.matchId, outcome: 'win', mode: 'tdm', rows: [], team_scores: [] } });
  assert.equal(h.eng.state().resultWait, 'in');
  const store = h.eng.storage;
  let clock = h.eng.now() + 5000;
  const eng2 = new Engine({ writer: () => {}, now: () => clock, synced: () => true, storage: store, log: () => {} });
  assert.equal(eng2.state().resultWait, 'in');
  assert.equal(eng2.state().result.outcome, 'win', 'the pushed outcome is not thrown away by a relaunch');
  assert.ok(eng2.state().resultAt > 0);
});

test('A24: a result that lands after the whistle is still stored (the screen updates in place)', () => {
  const h = harness().kit().config_(); h.echo(); h.start(0); h.adv(100);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  h.adv(4000);
  assert.equal(h.eng.onMcMessage({ kind: 'result', body: RESULT('lose') }).ok, true);
  assert.equal(h.eng.state().result.outcome, 'lose');
  assert.equal(h.eng.state().resultWait, 'in');
});

test('A24: welcome.node.result hydrates a phone that rejoins during recap', () => {
  const h = harness().kit().config_(); h.echo();
  h.eng.hydrate({ player: h.player, team: h.team, roster: h.roster, match_id: 'm1', result: RESULT('draw') });
  assert.equal(h.eng.state().result.outcome, 'draw');
});

test('A24 history: the entry written at the whistle carries outcome:null, and the fields MC owns are null too', () => {
  const h = harness().kit().config_(); h.echo(); h.start(0); h.adv(100);
  let entry = null; h.eng.onEnd = g => { entry = g; };
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(entry.match_id, 'm1');
  assert.equal(entry.outcome, null);          // MISSING, never wrong
  assert.equal(entry.team_scores, null);
  assert.equal(entry.best_streak, null);
  assert.equal(entry.medals, null);
  assert.equal(entry.win_by, 'kills');        // this one the node knows from its own config
});

test('A24 history: a result that beat the whistle is folded straight into the entry, hill hold included', () => {
  const h = harness().kit().config_(); h.echo(); h.start(0); h.adv(100);
  h.eng.hold = { hill: { blue: 214000, yellow: 137000 } };
  h.eng.onMcMessage({ kind: 'result', body: RESULT('win') });
  let entry = null; h.eng.onEnd = g => { entry = g; };
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(entry.outcome, 'win');
  assert.equal(entry.kills, 11);
  assert.equal(entry.best_streak, 5);
  assert.deepEqual(entry.medals, ['double_kill']);
  assert.equal(entry.team_scores.length, 2);
  assert.equal(entry.possession.hill.blue, 214000);
  h.eng.hold = {};   // a deep copy, not the live map
  assert.equal(entry.possession.hill.blue, 214000);
});

test('A24: a NEW match retires the previous result before anyone can see it on a fresh DOWN screen', () => {
  const h = harness().kit().config_(); h.echo(); h.start(0); h.adv(100);
  h.eng.onMcMessage({ kind: 'result', body: RESULT('win') });
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  assert.equal(h.eng.state().result, null);
  assert.equal(h.eng.state().resultWait, 'pending');
});

// ---------- A34: an END that names a match only ends THAT match ----------
test('A34: control end for a foreign match_id is ignored — the match being played goes on', () => {
  const h = goLive(harness());
  assert.equal(h.eng.phase, 'live');
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'm0-old' } });
  assert.equal(h.eng.phase, 'live', 'an end for m0-old cannot stop m1');
  assert.equal(h.eng.ended, false);
});

test('A34: control end naming THIS match ends it', () => {
  const h = goLive(harness());
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'm1' } });
  assert.equal(h.eng.ended, true);
  assert.notEqual(h.eng.phase, 'live');
});

test('A34: control end with no match_id behaves as before (the operator END/RECALL)', () => {
  const h = goLive(harness());
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'recall' } });
  assert.equal(h.eng.ended, true);
  assert.notEqual(h.eng.phase, 'live');
});

// ── B4 (field session 2026-09-12): the gun link watchdog ────────────────────────────────────────────
// All four guns that night ended a session `bleUp:false` while the phone stayed MC-connected — a link
// the native BLE stack never told us had dropped, so it never recovered and hits stopped registering
// mid-match. `bleUp` used to depend ENTIRELY on the native disconnect callback; these pin the fix: a
// silence timeout forces a reconnect (engine.js `lastGunFrameAt`/`tick()`/`onGunStale`,
// brxlink.js `noteStale()`), the drop is surfaced immediately (HUD pill + MC's status body), and a
// relink resyncs the gun exactly like a real disconnect does, so a hit after recovery is never
// silently swallowed. Mirrors engine.js's (unexported, like RECONCILE_MS above) LINK_STALE_MS.
const LINK_STALE_MS = 150000;

// Round-2 fix pass I (2026-09-12): the watchdog SHIPS DISABLED (`linkWatchdog`, default
// `LINK_WATCHDOG_ENABLED = false`) until the bench gives it a real number -- FOLLOWUPS F163. 150 s is
// a desk guess at "five $VOLTS cadences", `$VOLTS` is the only idle traffic and is unreliable at
// marginal RSSI, and what a false trip costs is not nothing: `_beginReconcile` disarms both slots for
// RECONCILE_MS and `_endReconcile` re-arms from `frames.spawn`'s $AMMO -- a mid-firefight disarm plus
// a free full magazine, which is exactly the cheat RESUME_GAP_MS exists to deny. A defender at the
// edge of range who neither fires nor is hit is the player it would hit. Every B4 test below turns it
// ON explicitly, because the MECHANISM still has to be correct for the day the bench says 90 or 300.
const armWatchdog = h => { h.eng.linkWatchdog = true; return h; };

test('I: with the watchdog OFF (the shipped default) ten minutes of total silence trips NOTHING', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*');
  assert.equal(h.eng.linkWatchdog, false, 'it ships disabled — F163 is the bench gate');
  let staleFired = 0; h.eng.onGunStale = () => { staleFired++; };
  for (let i = 0; i < 4; i++) { h.adv(LINK_STALE_MS); h.eng.tick(); }   // 10 minutes, four times over the threshold
  assert.equal(staleFired, 0, 'no forced reconnect');
  assert.equal(h.eng.bleUp, true, 'and no local drop either — the link is left alone');
  assert.equal(h.eng.reconciling ?? h.eng.state().reconciling, false, 'nothing disarmed, so no free magazine on the way back');
});

test('B4: total silence from the gun for LINK_STALE_MS trips the watchdog, even though bleUp never went false on its own', () => {
  const h = armWatchdog(harness().kit().config_().echo().start(0)); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*');
  assert.equal(h.eng.alive, true);
  let staleFired = 0; h.eng.onGunStale = () => { staleFired++; };
  h.adv(LINK_STALE_MS - 1000); h.eng.tick();
  assert.equal(staleFired, 0, 'not yet — still inside the window');
  assert.equal(h.eng.bleUp, true, 'the native link never told us it dropped');
  h.adv(2000); h.eng.tick();
  assert.equal(staleFired, 1, 'the watchdog fires once silence clears the threshold');
});

test('B4: any frame off the gun — not just $VOLTS — resets the watchdog clock', () => {
  const h = armWatchdog(harness().kit().config_().echo().start(0)); h.adv(10); h.eng.tick();
  let staleFired = 0; h.eng.onGunStale = () => { staleFired++; };
  h.adv(LINK_STALE_MS - 5000); h.eng.tick();
  h.frame('$VOLTS,7662,3921,55,70,*');            // a heartbeat, nothing more — but proof of life
  h.adv(LINK_STALE_MS - 5000); h.eng.tick();      // would have tripped measured from the ORIGINAL mark
  assert.equal(staleFired, 0, 'the VOLTS frame proved the link alive and restarted the clock');
});

test('B4: with no link to cycle (demo/tests — onGunStale unset) the watchdog still surfaces the drop locally', () => {
  const h = armWatchdog(harness().kit().config_().echo().start(0)); h.adv(10); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*');
  assert.equal(h.eng.onGunStale, null);
  h.adv(LINK_STALE_MS + 1000); h.eng.tick();
  assert.equal(h.eng.bleUp, false, 'falls back to onBleDropped() so the HUD pill and MC status still see it');
});

test('B4: a watchdog-forced reconnect reconciles like any relink — no spurious death, and a real hit lands afterward', () => {
  const h = armWatchdog(harness().kit().config_().echo().start(0)); h.adv(10); h.eng.tick();
  h.frame('$LCD,29,70,0,0,10,384,*');             // alive at 29 hp
  assert.equal(h.eng.alive, true); assert.equal(h.eng.hp, 29);
  h.eng.onGunStale = () => h.eng.onBleDropped();   // stand-in for BrxLink.noteStale(): drop now, relink lands a beat later
  h.adv(LINK_STALE_MS + 1000); h.eng.tick();
  assert.equal(h.eng.bleUp, false, 'the drop is surfaced immediately, not just eventually');
  assert.equal(h.eng.ended, false, 'a transient drop is not a teardown');
  assert.equal(h.eng.deaths, 0, 'no spurious death from the watchdog itself');
  h.adv(1500);
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });   // the forced reconnect lands
  assert.ok(h.eng.state().reconciling, 'the relink reconciles exactly like a real disconnect would');
  assert.equal(h.eng.alive, true, 'pools carried across — no heal, no inferred death');
  assert.equal(h.eng.hp, 29);
  h.adv(3000); h.eng.tick();                       // past RECONCILE_MS
  assert.equal(h.eng.state().reconciling, false);
  const deathsBefore = h.eng.deaths;
  h.frame('$HP,0,0,0,*');                          // a REAL hit after recovery
  assert.equal(h.eng.deaths, deathsBefore + 1, 'a real hit after recovery registers — link resilience must not leave it stuck');
});

test('B4: the drop is reflected in the status body MC sees (preflight.gun_linked)', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  assert.equal(h.eng.statusBody().preflight.gun_linked, true);
  h.eng.onBleDropped();
  assert.equal(h.eng.statusBody().preflight.gun_linked, false, 'MC must see the link down, not just the phone HUD');
});

// Bench 2026-09-17: a gun with its headset off keeps dropping the link. The phone tells MC once, steadily.
test('flapping: BrxLink\'s flap state reaches the HUD state and the status body (preflight.gun_flapping)', () => {
  const h = harness().kit();
  assert.equal(h.eng.state().gunFlapping, null);
  assert.equal(h.eng.statusBody().preflight.gun_flapping, false, 'always sent, so a false clears it on MC');
  h.eng.setGunFlapping({ count: 1, next_retry_at: null });
  assert.equal(h.eng.state().gunFlapping, null, 'one quick drop is not flapping');
  h.eng.onBleDropped(); h.eng.setGunFlapping({ count: 3, next_retry_at: 12345 });
  assert.deepEqual(h.eng.state().gunFlapping, { count: 3, next_retry_at: 12345 });
  assert.equal(h.eng.statusBody().preflight.gun_flapping, true);
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(h.eng.statusBody().preflight.gun_flapping, true, 'a momentary link does not clear it: only BrxLink does');
  h.eng.setGunFlapping({ count: 3, next_retry_at: 12345, quiet: true });   // game day 2026-09-19: the quiet period
  assert.equal(h.eng.state().gunFlapping.quiet, true, 'the HUD hears the quiet period');
  assert.equal(h.eng.statusBody().preflight.gun_flapping, true, 'MC keeps gun_flapping during the quiet period');
  h.eng.setGunFlapping(null);
  assert.equal(h.eng.statusBody().preflight.gun_flapping, false);
});

test('B4: a relink after the first probe re-opens the event tap with a bare $PHONE, never $STOP mid-match', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  assert.ok(h.eng.probeSent, 'the very first connect already ran the full probe ritual');
  const before = h.writes.length;
  h.eng.onBleDropped();
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  const after = h.writes.slice(before);
  assert.ok(after.includes('$PHONE,*'), 'the relink defensively re-opens the event tap ($VOLTS/$BUT depend on it)');
  assert.ok(!after.includes('$STOP,*'), 'never $STOP mid-match — that frame is only for the first-ever connect ritual');
});

test('B4/T2-B-1: probeSent survives an app restart mid-match, so the relink resend still fires', () => {
  // Same shape as the ANTI-CHEAT force-close test: shared storage stands in for two app processes.
  const store = mkStorage();
  let clock = 2_500_000;
  const cfg = { config_id: golden.config_id, mode: 'tdm', environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 8 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 },
    teams: [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const team = { team_id: 'blue', tid: 1, name: 'BLUE', color: 'blue' };
  const bundle = { ...golden, player_id: 'p1' };
  const mk = writer => new Engine({ writer, emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: store, log: () => {}, delay: (ms, fn) => fn() });

  // process 1: kit → config → echo → start → live. The first connect runs the full probe ritual.
  const a = mk(() => {});
  a.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  a.onMcMessage({ kind: 'assign', body: { player, team, roster: [player] } });
  a.onMcMessage({ kind: 'config', body: { config: cfg, frames: bundle, roster: [player] } });
  a.feedFrame('$LCD,0,0,0,0,0,0,*');
  assert.ok(a.probeSent, 'the very first connect ran the probe');
  a.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  clock += 10; a.tick();
  assert.equal(a.phase, 'live');

  // process 2: force-close mid-match → reopen on the same storage → relink.
  const b = mk(() => {});
  assert.ok(b.probeSent, 'probeSent must be restored from storage, not reset to false by the restart');
  const writes = [];
  b.writer = fr => writes.push(...fr);
  b.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.ok(writes.includes('$PHONE,*'), 'a relink after a restart mid-match must still resend $PHONE,* — this is the exact case the resend was added for');
  const secondRelinkWrites = [];
  b.writer = fr => secondRelinkWrites.push(...fr);
  b.onBleDropped();
  b.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(secondRelinkWrites.filter(f => f === '$PHONE,*').length, 1, 'exactly one resend per relink, not zero and not repeated');
});

// ── T2-B item 2: STANDBY (benched) ──────────────────────────────────────────────────────────────
test('STANDBY: an assign with standby:true drops a kitted node to sitting-out, no frames written', () => {
  const h = harness().kit();
  assert.equal(h.eng.phase, 'kitted');
  const before = h.writes.length;
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  assert.equal(h.eng.standby, true);
  assert.equal(h.eng.phase, 'kitted', 'STANDBY is a KITTED-shaped state, not a new phase');
  assert.equal(h.eng.state().standby, true, 'the HUD reads this to show SITTING OUT');
  assert.equal(h.writes.length, before, 'no frame was written by benching this player');
});

test('STANDBY: benching a player who already holds a pushed config (LOBBY) drops back to KITTED and writes nothing more', () => {
  const h = harness().kit().config_();     // config pushed, head written, phase -> lobby
  assert.equal(h.eng.phase, 'lobby');
  const before = h.writes.length;
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  assert.equal(h.eng.standby, true);
  assert.equal(h.eng.phase, 'kitted', 'no longer LOBBY -- there is no game this node is arming for any more');
  assert.equal(h.writes.length, before, 'benching writes no frame, even though this node already held a head');
});

test('STANDBY: a config message that somehow still arrives while benched is refused -- no head write', () => {
  const h = harness().kit();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  const before = h.writes.length;
  h.eng.onMcMessage({ kind: 'config', body: { config: h.config, frames: h.bundle, roster: h.roster } });
  assert.equal(h.writes.length, before, 'the standby guard in _applyConfig refuses it -- belt and braces');
  assert.equal(h.eng.phase, 'kitted');
});

test('STANDBY: PLAY (a normal assign, no standby field) clears it and the kit works again', () => {
  const h = harness().kit();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  assert.equal(h.eng.standby, true);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });   // PLAY: no `standby` key at all
  assert.equal(h.eng.standby, false);
  assert.equal(h.eng.state().standby, false);
  // and the kit is live again: config_() (the config push PLAY's reinstate would trigger) now arms normally
  h.config_();
  assert.equal(h.eng.phase, 'lobby');
  assert.ok(h.writes.includes('$START,*'), 'the head is written -- PLAY actually re-arms the gun');
});

test('STANDBY: force-close while benched comes back SITTING OUT, not to a normal kit screen', () => {
  const store = mkStorage();
  let clock = 4_000_000;
  const mk = () => new Engine({ writer: () => {}, emit: () => {}, report: () => {}, now: () => clock, synced: () => true, storage: store, log: () => {} });
  const a = mk();
  a.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  a.onMcMessage({ kind: 'assign', body: { player: { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' }, team: { team_id: 'blue', tid: 1, name: 'BLUE', color: 'blue' }, roster: [], standby: true } });
  assert.equal(a.standby, true);
  const b = mk();   // force-close -> reopen on the same storage, no relink yet
  assert.equal(b.standby, true, 'standby must survive the restart -- otherwise the benched player is briefly re-kitted');
});

// -- T2 INTEGRATION (A38 x A39): where the two Tier 2 lanes meet --------------------------------
// T2-B benched a phone into a KITTED-SHAPED state; T2-A (F-4) opened READY UP to the phones that are
// in exactly those states. Neither lane could see the other, and the join is the one thing no lane
// test covers: a player MC has taken OFF the roster must not be able to put themselves back on it.

test('T2 INT: a benched phone cannot READY UP, even though STANDBY is KITTED-shaped', () => {
  const h = harness().kit();
  assert.equal(h.eng.setReady(true), true, 'control: an ordinary kitted phone CAN ready up');
  h.eng.setReady(false);
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  assert.equal(h.eng.phase, 'kitted', 'the phase F-4 opened setReady on is exactly the one A38 parks in');
  const reportsBefore = h.reports.length;
  assert.equal(h.eng.setReady(true), false, 'refused: this player is not on the roster any more');
  assert.equal(h.eng.state().ready, false, 'and nothing was recorded -- a refusal that still sets the flag is not a refusal');
  assert.equal(h.reports.length, reportsBefore, 'the refused tap told MC nothing -- no `ready` report for an unrostered node');
});

test('T2 INT: benched out of a pushed LOBBY, the kit-closed lobby READY UP door is shut too', () => {
  // F-4's second door is `phase === lobby && !kitOpen()`. A38 benches out of LOBBY by pulling the
  // phase back to 'kitted' -- so the FIRST door is the one that opens, and it has to be shut as well.
  const h = harness().kit().config_();
  assert.equal(h.eng.phase, 'lobby');
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  assert.equal(h.eng.setReady(true), false);
  assert.equal(h.eng.state().ready, false);
  // PLAY puts them back and the door works again -- the refusal is about STANDBY, not a phase it broke
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster } });
  assert.equal(h.eng.standby, false);
  assert.equal(h.eng.setReady(true), true, 'reinstated: READY UP works again');
});

test('T2 INT: a relink while benched does not re-push the held head or leave LOBBY', () => {
  // The one path that could have carried a benched phone into phase 'lobby' (where F-4 draws its
  // READY UP): `onBleConnected` re-applies a head it holds but never wrote. A38's `_applyConfig`
  // standby guard is what stops it -- pinned here, because if it ever went the lobby screen would
  // offer the benched player the control.
  const h = harness().kit().config_();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  h.eng.onBleDropped();
  const before = h.writes.length;
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(h.eng.phase, 'kitted', 'the relink must not re-derive a benched phone into LOBBY');
  assert.equal(h.eng.standby, true);
  // B4's `$PHONE,*` event-tap resend is the ONE frame a relink owes any phone and is not a head write;
  // nothing else may go to the gun of a player who is sitting out.
  const after = h.writes.slice(before);
  assert.deepEqual(after.filter(f => f !== '$PHONE,*'), [], 'a benched relink wrote more than the event tap: ' + after.join(' '));
  assert.equal(h.eng.setReady(true), false);
});

test('T2 INT: READY survives a re-push -- a fresh config_id does not un-ready the phone', () => {
  // A37(24): a re-push MINTS a fresh `config_id` and resets the server acks. F-4 opened READY UP for
  // the player whose kit window closed before they tapped; that tap is worthless if the very next
  // operator edit (which re-pushes) silently clears it. The server never clears `ready`; neither does
  // the node.
  const h = harness().kit();
  assert.equal(h.eng.setReady(true), true);
  assert.equal(h.eng.ready, true);
  h.config_();                                     // first push
  assert.equal(h.eng.phase, 'lobby');
  assert.equal(h.eng.ready, true, 'the push itself does not un-ready');
  // the re-push: same bundle, a NEW config_id, exactly what `_repush_lobby_config` sends after an edit
  const repushed = { ...h.config, config_id: 'cfg-repush-1' };
  h.eng.onMcMessage({ kind: 'config', body: { config: repushed, frames: h.bundle, roster: h.roster } });
  assert.equal(h.eng.config.config_id, 'cfg-repush-1', 'the node took the new head');
  assert.equal(h.eng.ready, true, 'READY survives the re-push -- it is a fact about the player, not about a head');
});

// ── Round-1 polish review 2026-09-12 ────────────────────────────────────────────────────────────
test('B5: a death suppressed by the spawn-settle window is RE-EXAMINED once the window expires', () => {
  // The B5 gate drops an unattributed zero-HP frame inside the settle window as a stale echo of the
  // life that just ended. A REAL death in that window with NO latch — grenade or station damage (which
  // carry no $HIR the phone can latch), or an $HIR simply lost — was then dropped FOREVER: `_onHp` had
  // already written hp 0 while `alive` stayed true and `deadAt` stayed 0, the respawn clock requires
  // `!alive`, and a dead gun sends no further zero-HP frames. The player spent the rest of the life as
  // a zombie at 0 HP: no DOWN screen, no respawn, no death fact for MC to score.
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$LCD,45,70,0,0,36,216,*');                     // the gun confirms the first life
  h.frame('$HIR,4,0,7,2,45,0,3,*'); h.frame('$HP,0,0,0,*');
  assert.equal(h.eng.alive, false, 'setup: down once');
  h.adv(8000); h.eng.tick();                              // auto-respawn — the settle window starts here
  assert.equal(h.eng.alive, true, 'setup: revived');
  const deaths = h.eng.deaths;

  h.adv(400);
  h.frame('$HP,0,0,0,*');                                 // a real death, inside the window, with no latch
  assert.equal(h.eng.alive, true, 'B5 still holds it at the time — nothing yet proves the gun caught up');
  assert.equal(h.eng.hp, 0, 'but the zero IS written: this is the zombie state');

  h.adv(2000); h.eng.tick();                              // past the settle window
  assert.equal(h.eng.alive, false, 'the held death is re-examined and taken');
  assert.equal(h.eng.deaths, deaths + 1, 'exactly one death');
  assert.ok(h.eng.deadAt > 0, 'and the respawn clock is running');
  assert.equal(h.eng.killedBy.unknown, true, 'no latch to name a shooter — attribution loss, not a lost death');
  const death = h.facts.filter(f => f.type === 'death').pop();
  assert.equal(death.shooter_num, 0, 'MC is told, with wire id 0 for "nobody we can name"');
});

test('B4: a marginal link that gaps two or three $VOLTS cadences is NOT force-dropped', () => {
  // The watchdog shipped at 75 s — only ~2.5 $VOLTS cadences, and the protocol says $VOLTS is "only
  // reliably returned at good RSSI". A healthy-but-marginal link whose player took no hits and fired no
  // shots for 75 s was force-disconnected mid-firefight: `_beginReconcile` disarms both slots for
  // RECONCILE_MS and `_endReconcile` re-arms from `frames.spawn`'s $AMMO — a free full magazine, the
  // exact cheat RESUME_GAP_MS exists to close. The real number is bench-gated (FOLLOWUPS F136).
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  let staleFired = 0; h.eng.onGunStale = () => { staleFired++; };
  h.adv(90000); h.eng.tick();
  assert.equal(staleFired, 0, 'three missed $VOLTS at the edge of range is not a dead link');
});

// --------------------------------------------------------------------------------------------
// A36 — MC has to be able to PROVE that the head it pushed is the head this gun is running.
// Field night 2026-09-12: guns ran a previous push in nearly every match and every signal MC had
// still read "ok". The node-side echo and query proofs are written from here.
// --------------------------------------------------------------------------------------------
test('A36: the ack carries the SLOT-0 $ALCD echo, not just the $START $LCD that arrives first', () => {
  // A real tagger answers the head with `$START`'s `$LCD,0,0,0,0,0,0,*` FIRST and the $WEAP echoes
  // behind it. Reporting "the first frame back" therefore reports the one frame that says nothing
  // about the weapon, which is why the old echo check could only ever test for truthiness.
  const h = harness().kit().config_();
  h.frame('$LCD,0,0,0,0,0,0,*');            // $START's answer, first, exactly as the gun sends it
  h.frame('$ALCD,32,100,0,192,0,*');        // the primary's echo: mag 32 / reserve 192
  h.frame('$ALCD,24,100,1,12,0,*');         // the secondary's -- a different slot, must NOT be taken
  h.adv(1600); h.eng.tick(); h.queryConfig();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.equal(ack.b.gun_echo, '$ALCD,32,100,0,192,0,*', 'the slot-0 ammo echo is what MC gets');
  assert.equal(ack.b.config_id, h.config.config_id);
  // ...and the headset proof is untouched: a gun that answered at all answered.
  assert.equal(h.eng.statusBody().preflight.headset_ok, true);
});

test('A36: a gun that only answers $LCD still acks -- with the $LCD (no evidence is not a fault)', () => {
  const h = harness().kit().config_().echo();
  h.adv(1600); h.eng.tick(); h.queryConfig();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.equal(ack.b.ok, true);
  assert.equal(ack.b.gun_echo, '$LCD,0,0,0,0,0,0,*');
});

test('F271: a head echo starts $QUERY readback and defers ack_config', () => {
  const h = harness().kit().config_().echo();
  h.adv(1600); h.eng.tick();
  assert.equal(h.writes.at(-1), '$QUERY,*', 'the echo window is followed by an authoritative gun-status query');
  assert.equal(h.reports.find(r => r.k === 'ack_config'), undefined, 'success is not reported before the query reply');
});

test('F271: a valid $QUERY body reports player, team, and pool maxima in ack_config.gun_config', () => {
  const h = harness().kit().config_().echo();
  h.adv(1600); h.eng.tick();
  h.frame('$QUERY,7,1,45,70,0,,1,0,,0,*');
  h.eng.tick();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.deepEqual(ack && ack.b.gun_config, { player_id: 7, team: 1, hp: 45, armor: 70, shield: 0 });
  assert.equal(ack.b.ok, true);
  assert.equal(ack.b.gun_echo, '$LCD,0,0,0,0,0,0,*', 'the existing echo proof remains in the ack');
});

test('F271: malformed or missing $QUERY bodies time out to the backward-compatible ack shape', () => {
  for (const malformed of [true, false]) {
    const h = harness().kit().config_().echo();
    h.adv(1600); h.eng.tick();
    if (malformed) h.frame('$QUERY,7,1,45,70,0,,1,0,,0,'); // missing terminator: the known dead-gun signature
    assert.equal(h.reports.find(r => r.k === 'ack_config'), undefined, 'the query window remains open');
    h.adv(2601); h.eng.tick();
    const ack = h.reports.find(r => r.k === 'ack_config');
    assert.equal(ack && ack.b.ok, true, 'query readback is optional when the gun does not provide it');
    assert.equal(ack.b.gun_echo, '$LCD,0,0,0,0,0,0,*');
    assert.equal(Object.hasOwn(ack.b, 'gun_config'), false, 'older/malformed replies do not invent readback data');
  }
});

test('F271: the reply window starts when the asynchronous $QUERY write settles, not when queued', async () => {
  const h = harness().kit().config_().echo();
  let finish;
  h.eng.writer = frames => { h.writes.push(...frames); return new Promise(resolve => { finish = resolve; }); };
  h.adv(1600); h.eng.tick();
  h.adv(3000); h.eng.tick();
  assert.equal(h.reports.find(r => r.k === 'ack_config'), undefined, 'a queued BLE write cannot consume its own reply window');
  finish(true); await new Promise(resolve => setImmediate(resolve));
  h.queryConfig();
  assert.deepEqual(h.reports.find(r => r.k === 'ack_config')?.b.gun_config,
    { player_id: 7, team: 1, hp: 45, armor: 70, shield: 0 });
});

test('F271: a BLE drop during readback re-runs the head proof on relink', () => {
  const h = harness().kit().config_().echo();
  h.adv(1600); h.eng.tick();
  const heads = h.writes.filter(f => f === '$CLEAR,*').length;
  h.eng.onBleDropped();
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.ok(h.writes.filter(f => f === '$CLEAR,*').length > heads, 'relink rewrites the head whose readback was interrupted');
  h.echo(); h.adv(1600); h.eng.tick(); h.queryConfig();
  assert.deepEqual(h.reports.find(r => r.k === 'ack_config')?.b.gun_config,
    { player_id: 7, team: 1, hp: 45, armor: 70, shield: 0 });
});

test('A36: a NEW head clears the previous ammo echo before the new one is collected', () => {
  const h = harness().kit().config_();
  h.frame('$ALCD,32,100,0,192,0,*');
  h.adv(1600); h.eng.tick();
  assert.equal(h.eng.ammoEcho, '$ALCD,32,100,0,192,0,*');
  h.config_();                                  // a re-push: the old echo describes a head that is gone
  assert.equal(h.eng.ammoEcho, null);
});

test('A37: an $ALCD that follows a TRIGGER inside the echo window is not the config echo', () => {
  // F-3 (polish loop, 2026-09-13). `$ALCD` streams on AMMO EVENTS (protocol §"$ALCD"), so anything
  // captured in the 1500 ms window after a head write carries the LIVE magazine -- and a round fired
  // or a reload started in that window puts a mag one BELOW the compiled one on the wire. MC compares
  // it to `$WEAP,0` and turns a perfectly good push red. A `$BUT` is the gun saying a control was
  // touched: after one, the ammo stream is the player's, not the head's.
  const h = harness().kit().config_();
  h.frame('$LCD,0,0,0,0,0,0,*');            // $START's answer: the gun DID answer
  h.frame('$BUT,0,1,*');                    // trigger pressed inside the window
  h.frame('$ALCD,31,100,0,192,0,*');        // ...so this is a shot, not the head's echo
  h.adv(1600); h.eng.tick(); h.queryConfig();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.equal(ack.b.ok, true, 'the gun answered, so the ack is still ok');
  assert.equal(ack.b.gun_echo, '$LCD,0,0,0,0,0,0,*', 'MC gets NO weapon claim rather than a wrong one');
  assert.equal(h.eng.ammoEcho, null);
});

test('A37: an $ALCD BEFORE any button is still the config echo', () => {
  const h = harness().kit().config_();
  h.frame('$LCD,0,0,0,0,0,0,*');
  h.frame('$ALCD,32,100,0,192,0,*');
  h.frame('$BUT,0,1,*');                    // the player pulls the trigger AFTER the echo landed
  h.frame('$ALCD,31,100,0,192,0,*');
  h.adv(1600); h.eng.tick(); h.queryConfig();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.equal(ack.b.gun_echo, '$ALCD,32,100,0,192,0,*', 'the full magazine the head wrote');
});

// Playtest 2026-09-13: the head is ~51 chunked BLE writes. The echo window ran 1.5 s from the QUEUE time, so the
// gun's $ALCD arrived ~3 s after the node had acked `no_echo`, and the operator pressed RE-PUSH CONFIG four times.
test('echo window: opens when the LAST head frame is written, not when the head is queued', async () => {
  const h = harness().kit();
  let finish; h.eng.writer = fr => { h.writes.push(...fr); return new Promise(r => { finish = r; }); };
  h.config_();
  h.adv(3000); h.eng.tick();                         // the chunked write is still going out
  assert.equal(h.reports.find(r => r.k === 'ack_config'), undefined, 'no verdict while the head is still being written');
  finish(true); await new Promise(r => setImmediate(r));
  h.adv(500); h.frame('$ALCD,32,100,0,192,0,*');     // the gun answers half a second after the last frame
  h.adv(1100); h.eng.tick(); h.queryConfig();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.equal(ack && ack.b.ok, true, 'the late echo is inside the window');
  assert.equal(ack.b.gun_echo, '$ALCD,32,100,0,192,0,*');
});

test('echo window: a head write that never settles still acks no_echo in the end', () => {
  const h = harness().kit();
  h.eng.writer = fr => { h.writes.push(...fr); return new Promise(() => {}); };
  h.config_();
  h.adv(5000); h.eng.tick();
  assert.equal(h.reports.find(r => r.k === 'ack_config'), undefined);
  h.adv(20000); h.eng.tick();
  const ack = h.reports.find(r => r.k === 'ack_config');
  assert.equal(ack && ack.b.err, 'no_echo');
});

test('echo window: an $ALCD for slot 4 (melee) is never taken as the primary echo', () => {
  const h = harness().kit().config_();
  h.frame('$ALCD,1,100,4,0,0,*');                   // the playtest's only echo: slot 4
  h.adv(1600); h.eng.tick();
  assert.equal(h.eng.ammoEcho, null, 'only a slot-0 $ALCD is the primary echo');
  h.config_();
  h.frame('$ALCD,1,100,4,0,0,*'); h.frame('$ALCD,32,100,0,192,0,*');
  h.adv(1600); h.eng.tick(); h.queryConfig();
  assert.equal(h.reports.filter(r => r.k === 'ack_config').pop().b.gun_echo, '$ALCD,32,100,0,192,0,*');
});

test('A37: a NEW head re-opens the echo window that a button had closed', () => {
  const h = harness().kit().config_();
  h.frame('$BUT,0,1,*');
  h.adv(1600); h.eng.tick();
  h.config_();                              // re-push: this head has had no button yet
  h.frame('$ALCD,32,100,0,192,0,*');
  h.adv(1600); h.eng.tick(); h.queryConfig();
  const ack = h.reports.filter(r => r.k === 'ack_config').pop();
  assert.equal(ack.b.gun_echo, '$ALCD,32,100,0,192,0,*');
});

// F212: `respawn.gate` is a SCANNER-ONLY knob (contracts.md §3, "gate: A13.1 (scanner only)"). The
// getter used to default to 'trigger' for EVERY respawn type, so a live field session ended two
// matches with `respawnType:"auto"` reporting `respawnGate:"trigger"` against a config that never
// asked for one -- a mislabel, not a real gate (the `auto` respawn branch only ever checks the
// timer). Fixed: the field is only meaningful, and only present, under `respawn.type === 'scanner'`.
test('F212: an auto respawn never claims a trigger gate', () => {
  const h = harness({ respawn: 'auto' }).kit().config_();
  assert.equal(h.eng.respawnGate, null, 'auto respawn reports no gate at all');
  assert.equal(h.eng.state().respawnGate, null);
});

test('F212: a "none" respawn (LMS) never claims a trigger gate either', () => {
  const h = harness({ respawn: 'none' }).kit().config_();
  assert.equal(h.eng.state().respawnGate, null);
});

test('F212: scanner respawn still reports its real gate (trigger default, or presence when set)', () => {
  const h = harness({ respawn: 'scanner' }).kit();
  h.config_();
  assert.equal(h.eng.state().respawnGate, 'trigger', 'scanner defaults to trigger, unchanged');
  const h2 = harness({ respawn: 'scanner' });
  h2.config.respawn.gate = 'presence';
  h2.kit().config_();
  assert.equal(h2.eng.state().respawnGate, 'presence');
});

// F213: `compile.py` bakes per-player `loadout.overrides.max_hp/max_armor` and the `body_armor`
// perk's `max_armor_add` into the pushed `$PSET` -- the field 2026-09-13 session ended two matches
// with `armor:120, maxArmor:70` because the node modelled its ceiling from `config.health` alone,
// never from the head it was actually running. Fixed: `maxHp`/`maxArmor` read the compiled `$PSET`
// back off `frames.head`, the one number that cannot drift from a second copy of the rules.
function withPool(head, hp, armor) {
  return head.map(f => {
    if (typeof f !== 'string' || !f.startsWith('$PSET,')) return f;
    const p = f.split(','); p[3] = String(hp); p[4] = String(armor); return p.join(',');
  });
}
test('F213: a plain player keeps maxArmor at the config ceiling', () => {
  const h = harness().kit().config_();
  assert.equal(h.eng.maxHp, 45);
  assert.equal(h.eng.maxArmor, 70);
  assert.equal(h.eng.state().maxArmor, 70);
});
test('F213: a body_armor carrier\'s maxArmor follows the perk baked into the head\'s own $PSET', () => {
  const h = harness();
  h.bundle.head = withPool(h.bundle.head, 45, 120);   // body_armor: max_armor_add 50 on a 70 base
  h.kit().config_();
  assert.equal(h.eng.maxArmor, 120, 'the pool the head actually arms, not config.health.max_armor (70)');
  assert.equal(h.eng.state().maxArmor, 120);
  h.echo().start(0); h.adv(10); h.eng.tick();          // T-0 spawn: fills the pool from maxHp/maxArmor
  assert.equal(h.eng.armor, 120, 'spawn fills the pool from the same ceiling');
});
test('F213: a per-player max_hp/max_armor override baked into the head still wins', () => {
  const h = harness();
  h.bundle.head = withPool(h.bundle.head, 30, 40);
  h.kit().config_();
  assert.equal(h.eng.maxHp, 30);
  assert.equal(h.eng.maxArmor, 40);
});

test('A36: every status heartbeat names the config this phone is holding', () => {
  const h = harness().kit();
  assert.equal(h.eng.statusBody().config_id, undefined, 'nothing held yet, nothing claimed');
  h.config_();
  assert.equal(h.eng.statusBody().config_id, h.config.config_id);
});

// R2-3 (polish loop iteration 2, 2026-09-13) — WHERE THE POOL IN A HEARTBEAT CAME FROM.
//
// `_spawn` fills hp/armor from `config.health` (the phone's MODEL of the pool) and the gun's own
// numbers arrive afterwards on `$LCD`/`$HP`. MC's A36 pool check compares the heartbeat against the
// `$PSET` it pushed, which bakes `loadout.overrides.max_hp/max_armor` and the body_armor perk — so a
// player overridden DOWN reported the model's bigger number until the first gun frame landed, and MC
// read that as "this gun is on an older head". The heartbeat now says which of the two it is holding,
// and MC judges only the gun's.
test('R2-3: the status body says whether its pool came from the GUN or from this phone\'s model', () => {
  const h = harness().kit().config_().echo().start(0);
  h.adv(10); h.eng.tick();                       // T-0: spawn writes hp/armor from config.health
  assert.equal(h.eng.phase, 'live');
  assert.equal(h.eng.statusBody().pool_src, 'model', 'nothing off the gun has been applied this life');
  h.frame('$LCD,30,0,0,0,0,0,*');                // the gun's own pool, smaller than the model's 45/70
  assert.equal(h.eng.statusBody().pool_src, 'gun');
  assert.equal(h.eng.hp, 30);
});

test('R2-3: $HP is the gun speaking too, and a NEW life goes back to the model', () => {
  const h = harness().kit().config_().echo().start(0);
  h.adv(10); h.eng.tick();
  h.frame('$HP,40,70,0,*');
  assert.equal(h.eng.statusBody().pool_src, 'gun');
  h.frame('$HP,0,0,0,*');                        // down
  h.adv(9000); h.eng.tick();                     // auto-respawn
  assert.equal(h.eng.alive, true, 'control: a new life started');
  assert.equal(h.eng.statusBody().pool_src, 'model', 'the claim is per LIFE, not per match');
});


// ── T2 review (2026-09-13): the field-safety set ────────────────────────────────────────────────
// `standby` is PERSISTED on this phone, and until now exactly one thing could clear it: an `assign`
// whose `standby` was falsy. A welcome carried no such key, so a phone that was away when the operator
// tapped PLAY came back still locally benched -- SITTING OUT, no frames, no ready, with the console
// showing it rostered. The rule these pin: the server STATES the fact on every welcome, and `hydrate`
// applies it, in both directions.

test('S1: hydrate applies the welcome\'s standby fact -- true keeps the bench, false clears it', () => {
  const h = harness().kit();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  assert.equal(h.eng.standby, true);
  // a welcome that still says benched leaves it benched
  h.eng.hydrate({ player: h.player, team: h.team, roster: h.roster, standby: true });
  assert.equal(h.eng.standby, true, 'a welcome restating the bench must not clear it');
  // ...and the one that says otherwise clears it
  h.eng.hydrate({ player: h.player, team: h.team, roster: h.roster, standby: false });
  assert.equal(h.eng.standby, false, 'the authority said playing -- the persisted flag must go');
});

test('S1 SCENARIO: bench, drop the link, PLAY while away, reconnect -> the phone is playable', () => {
  // The whole failure, end to end, in the order the field produces it.
  const h = harness().kit().config_();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  assert.equal(h.eng.standby, true);
  h.eng.onBleDropped();                       // the phone locks / walks out of range
  // PLAY happens at MC with nothing on the other end. The phone comes back and hears ONE thing: the welcome.
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  h.eng.hydrate({ player: h.player, team: h.team, roster: h.roster, standby: false,
                  config: h.config, frames: h.bundle });
  assert.equal(h.eng.standby, false, 'STRANDED: the phone is still locally benched after PLAY');
  // ...and it is genuinely playable again, which for a laser-tag night means two things: the head
  // actually reached the gun, and the start will actually be taken. (Not `setReady`: this phone is in
  // LOBBY with the kit still open -- `kitOpen()` is `!policy || kit_open !== false` and the harness
  // sends no policy -- so that door is shut for ordinary reasons that have nothing to do with standby.)
  assert.ok(h.writes.includes('$START,*'), 'the welcome\'s head was actually written to the gun');
  assert.equal(h.eng.phase, 'lobby');
  const r = h.eng.startAt({ match_id: 'm1', go_live_t: h.eng.now() + 1000, config_id: h.config.config_id, seq: 1, countdown_s: 1 });
  assert.equal(r.ok, true, 'the reinstated phone takes the start -- it will spawn at T-0');
  assert.equal(h.eng.phase, 'armed');
});

test('S1: a welcome to a phone that is STILL benched arms nothing', () => {
  const h = harness().kit();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  const before = h.writes.length;
  h.eng.hydrate({ player: h.player, team: h.team, roster: h.roster, standby: true,
                  config: h.config, frames: h.bundle, start: { match_id: 'm9', go_live_t: 1, config_id: h.config.config_id, seq: 1 } });
  assert.equal(h.eng.standby, true);
  assert.equal(h.writes.length, before, 'no frame may reach the gun of a player who is sitting out');
  assert.equal(h.eng.phase, 'kitted', 'and it never leaves the KITTED-shaped bench');
});

test('S2: the broadcast start is refused while benched -- the gun must not spawn at T-0', () => {
  // The benched phone still HOLDS the frames it took before the bench, so `config_id` matches and
  // nothing else in startAt would have stopped it going armed -> live.
  const h = harness().kit().config_();
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  const before = h.writes.length;
  const r = h.eng.startAt({ match_id: 'm1', go_live_t: h.eng.now() + 1000, config_id: h.config.config_id, seq: 1, countdown_s: 1 });
  assert.equal(r.ok, false, 'a benched node must refuse the start');
  assert.equal(h.eng.phase, 'kitted', 'it must not go ARMED');
  assert.equal(h.eng.start, null, 'and must not hold a schedule it will spawn on');
  assert.equal(h.writes.length, before, 'nothing reached the gun');
});

test('S7: benching clears the local READY, so the phone and the board agree after PLAY', () => {
  // MC parks with `ready: False` and reinstates with `ready: False`, and the phone only ever reports
  // its ready state from `setReady`. A phone that kept a stale `ready: true` showed READY on the HUD
  // while MC counted it as WAIT and blocked the start, with no reason on either screen.
  const h = harness().kit();
  assert.equal(h.eng.setReady(true), true);
  assert.equal(h.eng.state().ready, true, 'control: readied up before the bench');
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: true } });
  assert.equal(h.eng.state().ready, false, 'the bench clears READY -- MC parked them as not-ready');
  // PLAY: still not ready, on both sides, and the player can ready up again themselves
  h.eng.onMcMessage({ kind: 'assign', body: { player: h.player, team: h.team, roster: h.roster, standby: false } });
  assert.equal(h.eng.state().ready, false, 'reinstated as NOT ready, exactly as MC has them');
  assert.equal(h.eng.setReady(true), true);
});

// ---------- A42: the phone's half of the END delivery proof ----------
// The whole of A42 rests on one claim: the receipt MC needs is ALREADY sent, twice a second, by the build
// in players' hands today — no new message kind, no app update. These pin that claim from this side, so it
// cannot be broken without a red test. They pass on the pre-A42 engine, which is exactly the point.
test('A42: after the end the heartbeat says kitted and still NAMES the match — that is the ack', () => {
  const h = goLive(harness());
  assert.equal(h.eng.statusBody().arm_state, 'live');
  assert.equal(h.eng.statusBody().match_id, 'm1');
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'm1' } });
  const b = h.eng.statusBody();
  assert.equal(b.arm_state, 'kitted', 'a phone that TOOK the end reports kitted...');
  assert.equal(b.match_id, 'm1', '...for the match it just left — MC needs both halves to tell it from a phone that missed the end');
});

test('A42: a phone that MISSED the end goes on reporting live for that match (the other half of the signal)', () => {
  const h = goLive(harness());
  h.adv(30000);
  const b = h.eng.statusBody();
  assert.equal(b.arm_state, 'live', 'nothing about a missed end changes what it says');
  assert.equal(b.match_id, 'm1');
});

test('A42: a re-delivered END is idempotent — no second teardown, no second history entry', () => {
  const h = goLive(harness());
  let entries = 0; h.eng.onEnd = () => { entries += 1; };
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'm1' } });
  const writes = h.writes.length, facts = h.facts.length;
  h.adv(3000);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end', match_id: 'm1' } });
  assert.equal(entries, 1, 'the history entry is written once');
  assert.equal(h.eng.phase, 'kitted');
  assert.equal(h.writes.length, writes, 'the gun is not torn down a second time');
  assert.equal(h.facts.length, facts, 'and no second end-of-match fact goes out');
});

// ---------- shot-ready cue (bench 2026-09-17): `$WEAP` token 14 from the head, timed from the gun's own `$ALCD` ----------
test('shot cue: a slow weapon (golden slot 1 shotgun, t14 700) reports a cooldown from the shot, then 0 left', () => {
  // t14 700 (was 800 pre-2026-09-23, R8/F308: the pump gap tightened for the Shotgun-vs-SMG close-range
  // rule -- see docs/weapon-design.md's Balance rules table), read from the regenerated golden bundle.
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  assert.equal(h.eng.phase, 'live');
  h.frame('$ALCD,8,100,1,40,0,*');
  assert.equal(h.eng.state().shotCooldown, null, 'no shot yet: the first report is a baseline, not a round');
  const at = h.adv(10); h.frame('$ALCD,7,100,1,40,0,*');
  let c = h.eng.state().shotCooldown;
  assert.deepEqual(c, { at, ms: 700, leftMs: 700 }, 'the cooldown starts at the frame that reported the round');
  h.adv(500); c = h.eng.state().shotCooldown;
  assert.equal(c.leftMs, 200);
  h.adv(400); c = h.eng.state().shotCooldown;
  assert.equal(c.leftMs, 0, 'past the interval the trigger is hot again');
});

test('shot cue CONTROL: an automatic weapon (golden slot 0 AR, t14 100) gets no cue at all', () => {
  // A48 (merge 2026-09-17): the AR is back to Battle Company's native 100 ms cycle (was 140). Either number
  // is far under SHOT_CUE_MIN_MS, so the rule this test pins is unchanged -- only the head's value moved.
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,32,100,0,384,0,*'); h.adv(10); h.frame('$ALCD,31,100,0,384,0,*');
  assert.equal(h.eng.lastShot.ms, 100, 'the interval is read from the head');
  assert.equal(h.eng.state().shotCooldown, null);
});

test('shot cue: a stub $WEAP with no tokens, another slot, or death gives no cue', () => {
  const h = harness().kit().config_().echo().start(0); h.eng.tick();
  h.frame('$ALCD,8,100,1,40,0,*'); h.adv(10); h.frame('$ALCD,7,100,1,40,0,*');
  assert.ok(h.eng.state().shotCooldown, 'pre-condition: the shotgun cue is up');
  h.frame('$ALCD,32,100,0,384,0,*');   // the gun reports slot 0 active: the shotgun cue is not this gauge's
  assert.equal(h.eng.state().shotCooldown, null, 'a cue for a slot that is not active must not show');
  h.eng.frames.head = h.eng.frames.head.map(f => f.startsWith('$WEAP,1,') ? '$WEAP,1,shotgun,*' : f);
  assert.equal(h.eng._fireIntervalMs(1), null, 'a stub frame has no interval');
  h.frame('$ALCD,7,100,1,40,0,*'); h.adv(10); h.frame('$ALCD,6,100,1,40,0,*');
  assert.equal(h.eng.state().shotCooldown, null, 'a round from a slot with no known interval gives no cue');
  h.eng.frames.head = h.eng.frames.head.map(f => f.startsWith('$WEAP,1,') ? '$WEAP,1,' + Array(41).fill('0').map((x, i) => i === 13 ? '800' : x).join(',') + ',*' : f);
  h.adv(10); h.frame('$ALCD,5,100,1,40,0,*');
  assert.ok(h.eng.state().shotCooldown, 'pre-condition: a full frame brings the cue back');
  h.eng.alive = false;
  assert.equal(h.eng.state().shotCooldown, null, 'a dead player has no trigger to wait for');
});

// ======================================================================================================
// Maint review 2026-09-17: constants that must move together, and the one stand-down table
// ======================================================================================================

test('the two accuracy windows keep their order: the hold outlasts the verify grace', () => {
  // Each rule lived only in a comment. A hold SHORTER than the verify grace would let the writer judge
  // (and retry) its own write while a spawn/revive/resync/stun `$AMMO` is still in flight -- the exact
  // race the hold exists to stop. Nobody changing ACC_VERIFY_GRACE_MS would think to check ACC_HOLD_MS.
  assert.ok(ACC_HOLD_MS > ACC_VERIFY_GRACE_MS,
    `ACC_HOLD_MS (${ACC_HOLD_MS}) must outlast ACC_VERIFY_GRACE_MS (${ACC_VERIFY_GRACE_MS})`);
});

test('the three heat windows keep their order: display < mechanic trust < cap', () => {
  // OVERHEAT_SHOWN_MS is what the HUD draws; HEAT_STALE_MS is how long the reading is trusted to mean
  // "this gun cannot fire"; OVERHEAT_CAP_MS is the hard ceiling on the display. The word must clear
  // before the mechanic's trust lapses (the lockout ends long before a player stops pulling), and the
  // cap must sit above both or it would cut the display short of the lockout it is there to cover.
  assert.ok(OVERHEAT_SHOWN_MS < HEAT_STALE_MS,
    `OVERHEAT_SHOWN_MS (${OVERHEAT_SHOWN_MS}) must clear before HEAT_STALE_MS (${HEAT_STALE_MS})`);
  assert.ok(HEAT_STALE_MS < OVERHEAT_CAP_MS,
    `HEAT_STALE_MS (${HEAT_STALE_MS}) must sit under OVERHEAT_CAP_MS (${OVERHEAT_CAP_MS})`);
});

test('every `_standDown` call site names a guard the table declares', () => {
  // `_standDown` IGNORES a name it does not know -- throwing at a player mid-match would be worse than
  // the missing guard -- so a typo would silently drop that guard and no runtime test would notice.
  // It is caught here instead, by reading this file's own call sites. (The stage side of the same guard
  // is mcp/tests/test_stage_mirror.py.)
  const src = readFileSync(fileURLToPath(new URL('../src/engine.js', import.meta.url)), 'utf8');
  const calls = [...src.matchAll(/_standDown\(\[([^\]]*)\]/gs)].map(m => m[1]);
  assert.ok(calls.length >= 7, `only ${calls.length} _standDown call sites found -- the scan is wrong, not the file`);
  const used = new Set(calls.flatMap(c => [...c.matchAll(/['"](\w+)['"]/g)].map(m => m[1])));   // both quote styles: a double-quoted site must not be invisible here
  assert.ok(used.size >= 10, `only ${used.size} distinct guard names used across the call sites`);
  for (const name of used) assert.ok(STAND_DOWN_NAMES.includes(name),
    `_standDown names \`${name}\`, which the STAND_DOWN table does not declare: ${STAND_DOWN_NAMES.join(', ')}`);
  // CONTROL: the table is not a superset nobody reads -- every name it declares is used somewhere.
  for (const name of STAND_DOWN_NAMES) assert.ok(used.has(name), `STAND_DOWN declares \`${name}\` and no call site asks for it`);
});

test('F264: nothing counts `$LIFE` frames without asking whether it is a probe', () => {
  // THE HAZARD. `PROBE_LIFE` and every shield-regen grant are both `$LIFE`, so a reader that filters on the
  // command word alone counts questions as pool changes. Five S29 tests went red exactly that way the hour the
  // probe shipped, and the next reader will not have five red tests pointing at it. A filter in one helper is
  // not the fix; this scan is, because it fails on a NEW `$LIFE` filter that does not go through `isPoolProbe`.
  const dirs = [new URL('../src/', import.meta.url), new URL('./', import.meta.url)];
  const files = dirs.flatMap(d => readdirSync(d).filter(f => f.endsWith('.js') || f.endsWith('.mjs')).map(f => [f, new URL(f, d)]));
  assert.ok(files.length >= 10, `only ${files.length} files scanned -- the scan is wrong, not the tree`);
  const offenders = [];
  for (const [name, url] of files) {
    const src = readFileSync(url, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!/(startsWith|startswith)\(\s*['"`]\$LIFE/.test(line)) return;
      if (/isPoolProbe|PROBE_LIFE/.test(line)) return;
      if (name === 'engine.js' && /export function isPoolProbe/.test(src)) {   // the predicate's own body must test the word: that is its job
        const body = src.slice(src.indexOf('export function isPoolProbe'));
        if (body.split('\n').slice(0, 8).some(l => l.trim() === line.trim())) return;
      }
      offenders.push(`${name}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'these count `$LIFE` frames without excluding the probe: ' + offenders.join(' | '));
  // CONTROL: the predicate itself says what it claims, so the guard is not pointing at a no-op.
  assert.equal(isPoolProbe(PROBE_LIFE), true, 'the probe is a probe');
  assert.equal(isPoolProbe('$LIFE,*'), true, 'and so is the bare poll form the 2018 app used');
  assert.equal(isPoolProbe('$LIFE,0,0,10,*'), false, 'a shield grant is not');
  assert.equal(isPoolProbe('$LIFE,30,0,0,1,*'), false, 'and neither is the revive form, which is the same word again');
});

test('S42 x A44/A47/F15: `state().accHold` says the writer is standing down, and which write took the gun', () => {
  // The hold was invisible: a bench operator watching the accuracy writer go quiet had no way to tell a
  // hold from a broken model. `{until, why}` while it holds, null once it lifts.
  const h = armRecoil(RECOIL_PROFILE);
  assert.equal(h.eng.state().accHold, null, 'the spawn hold is long over by the time armRecoil returns');
  h.eng._holdAccuracyWrites('operator resync');
  const hold = h.eng.state().accHold;
  assert.deepEqual(hold, { until: h.eng.now() + ACC_HOLD_MS, why: 'operator resync' });
  h.adv(ACC_HOLD_MS - 10);
  assert.ok(h.eng.state().accHold, 'still held just before it lifts');
  h.adv(20);
  assert.equal(h.eng.state().accHold, null, 'and null once the hold has lapsed');
});

// ---------- transport-hardening.md §4: the node's gun-command deny list ----------
// The V4_30/V4_31 firmware (LaserTagMods' drive, 2026-09-18) has commands that write persistent state,
// re-pair or re-flash a radio, switch the IR word format, or BLOCK the main loop with the serial port unread
// (`$DPLAY`: the likely screamer mechanism). `protocol.DENIED_COMMANDS` reaches the phone as the generated
// `NODE_DENIED_COMMANDS`, and `_write` is the one choke point every gun write passes through.
test('deny list: _write drops a denied frame, writes the rest, logs it loudly, and counts it', () => {
  const h = harness().kit().config_();
  const logs = []; h.eng.log = m => logs.push(String(m));
  const before = h.writes.length;
  h.eng._write(['$PLAY,U37,3,10,,,,,*', '$DPLAY,A10,4,*', '$FACTORY,*', '$!FSFORMAT,*', '$HLED,1,0,,,10,,*'], 'test');
  const wrote = h.writes.slice(before);
  assert.deepEqual(wrote, ['$PLAY,U37,3,10,,,,,*', '$HLED,1,0,,,10,,*'], 'only the allowed frames reach the gun');
  assert.equal(h.eng.refused, 3);
  assert.ok(logs.some(m => m.includes('REFUSED 3') && m.includes('$DPLAY') && m.includes('$FACTORY') && m.includes('$!FSFORMAT')), logs);
  // a burst that is ALL denied writes nothing at all
  h.eng._write(['$CDFU,*'], 'test');
  assert.equal(h.writes.length, before + 2);
  assert.equal(h.eng.refused, 4);
});

test('deny list: the generated set is the source, and the helpers read the command word only', () => {
  assert.ok(W.NODE_DENIED_COMMANDS.has('DPLAY') && W.NODE_DENIED_COMMANDS.has('FACTORY') && W.NODE_DENIED_COMMANDS.has('CDFU'));
  assert.equal(frameCommand('$DPLAY,A10,4,*'), 'DPLAY');
  assert.equal(frameCommand('$dplay,A10,4,*'), 'DPLAY');
  assert.equal(frameCommand('not a frame'), '');
  assert.equal(deniedCommand('$PLAY,U37,3,10,,,,,*'), false, 'PLAY is not DPLAY: the match is on the whole word');
  assert.equal(deniedCommand('$DPLAY,A10,4,*'), true);
  for (const f of ['$DPLAY*', '$ DPLAY,*', '$DPLAY\t,*', '$FACTORY*']) assert.equal(deniedCommand(f), true, `${JSON.stringify(f)} is still denied`);
  assert.equal(deniedCommand('$^RESET,*'), true, 'gun<->radio control frames are never ours');
  assert.equal(deniedCommand(''), false);
  assert.equal(deniedCommand(null), false);
});

test('deny list: nothing a real bundle writes is denied (head, spawn, revive, end all go through untouched)', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  h.frame('$HIR,4,0,19,2,45,0,0,*'); h.frame('$HP,0,0,0,*');   // die
  h.adv(9000); h.eng.tick();                                     // auto respawn
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'end' } });
  assert.equal(h.eng.refused || 0, 0, 'no compiled frame may trip the deny list');
  assert.ok(h.writes.includes('$SPAWN,,*') && h.writes.includes('$CLEAR,*'));
});

test('F206: the spawn burst carries the $PSET from pset_pool BEFORE $SPAWN, and $TID right after it', () => {
  const h = harness().kit().config_().echo().start(0); h.adv(10); h.eng.tick();
  const i = h.writes.indexOf('$SPAWN,,*');
  assert.ok(i > 0, 'spawned');
  assert.deepEqual(h.writes.slice(i + 1, i + 2), ['$TID,1,*'], 'the team is re-asserted right after $SPAWN (one team byte, last writer wins; 2026-09-19: the default timed spawn carries no t8)');
  const pset = h.writes.slice(0, i).filter(f => f.startsWith('$PSET,'));
  assert.ok(pset.length >= 1 && pset.every(f => f.split(',')[2] === '1'), 'every $PSET written carries the $TID team: ' + pset);
});
