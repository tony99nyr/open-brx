// S57 (docs/ir-callouts.md): the IR callout bus's phone-engine half. Presentation only -- it never scores,
// never books a death/kill, and never writes the ledger S56 keeps, so there is nothing here for
// `mcp/brx_mcp/stage/stage.py` to mirror (see KNOWN_UNMIRRORED in mcp/tests/test_stage_mirror.py).
// Harness pattern copied from what-hit-me.test.mjs (config/assign/live) and death-once.test.mjs (the lethal
// $HIR + $HP sequence that drives a real `_death()`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, IR_CALLOUT } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

function mkStorage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

// Me: p1, player_num 7, BLUE (tid 1). VIPER: player_num 19, YELLOW (tid 2) -- the usual killer/enemy below.
// GHOST: player_num 20, BLUE (tid 1) -- a teammate.
const VIPER = { player_id: 'p2', player_num: 19, display: 'VIPER', team_id: 'yellow' };
const GHOST = { player_id: 'p3', player_num: 20, display: 'GHOST', team_id: 'blue' };

function harness({ mode = 'tdm', calloutTeam = 0, teamFlip, teams = [{ team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 }, { team_id: 'yellow', name: 'YELLOW', color: 'yellow', tid: 2 }] } = {}) {
  const writes = []; const facts = []; let clock = 1_000_000;
  const config = { config_id: golden.config_id, mode, environment: 'outdoor', night: false, time_limit_s: 600,
    respawn: { type: 'auto', delay_s: 5 }, scoring: { frag_limit: 25, win_by: 'kills' }, health: { max_hp: 45, max_armor: 70 }, teams };
  const player = { player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue', loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const roster = [{ player_id: 'p1', player_num: 7, display: 'REAPER', team_id: 'blue' }, VIPER, GHOST];
  const eng = new Engine({ writer: fr => writes.push(...fr), emit: f => facts.push(f), report: () => {}, now: () => clock,
    synced: () => true, storage: mkStorage(), log: () => {}, delay: (ms, fn) => fn(), rng: () => 0 });
  const bundle = { ...golden, player_id: 'p1', callout_team: calloutTeam, ...(teamFlip ? { team_flip: teamFlip } : {}) };
  const h = {
    eng, writes, facts, now: () => clock,
    adv(ms) { clock += ms; eng.tick(); return h; },
    // docs/announcer.md: callouts and kill lines play one at a time, so a test that counts what was SAID lets the queue drain
    drain(ms = 8000) { for (let t = 0; t < ms; t += 100) { clock += 100; eng.tick(); } return h; },
    frame(f) { eng.feedFrame(f); return h; },
    kit() { eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster } }); return h; },
    config_() { eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } }); return h; },
    echo() { eng.feedFrame('$LCD,0,0,0,0,0,0,*'); return h; },
    start(runwayMs = 0) { eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock + runwayMs, config_id: golden.config_id, seq: 1, countdown_s: Math.round(runwayMs / 1000) } }); return h; },
    // docs/announcer.md: go-live puts the klaxon and the spawn line on the gun's audio FIFO; the tests start once it is quiet
    live() { h.kit().config_().echo().start(0); h.adv(10); eng.feedFrame('$LCD,45,70,0,0,30,90,*'); for (let i = 0; i < 30; i++) h.adv(100); writes.length = 0; facts.length = 0; return h; },   // clean slate: past the arm+spawn write burst (head, $AMMO, spawn's own $SFLASH)
    // one lethal hit as the gun reports it: `$HIR` (names the killer), then `$HP` at zero.
    lethal(shooterNum, shooterTeam) { eng.feedFrame(`$HIR,4,0,${shooterNum},${shooterTeam},9,0,3,*`); eng.feedFrame('$HP,0,0,0,*'); return h; },
    // an incoming IR callout word from another gun: `$HIR,<sensor>,15,<player>,<team>,<magnitude>,0,0,*`.
    // The word's own team field is a transmit-side lever this phone never reads (see `_onIrCallout`), so it is
    // fixed at 0 here and every test drives the outcome off `player`/`magnitude` alone.
    irWord(player_, magnitude, sensor = 4) { eng.feedFrame(`$HIR,${sensor},15,${player_},0,${magnitude},0,0,*`); return h; },
    feedback(body) { eng.onMcMessage({ kind: 'feedback', body: { player_id: 'p1', ...body } }); return h; },
    cues(id) { return writes.filter(f => f.startsWith('$PLAY') && f.includes(id)); },
    sflashes() { return writes.filter(f => f === '$SFLASH,*'); },
    irtx() { return writes.filter(f => f.startsWith('$IRTX,')); },
  };
  return h;
}

// ---------- sender ----------

test('S57 sender: a known killer sends DOWN_BY naming them, then DOWN naming me (Tony 2026-09-24: the victim\'s name)', () => {
  const h = harness(); h.live();
  h.lethal(19, 2);   // VIPER kills me
  assert.deepEqual(h.irtx(), [`$IRTX,100,15,19,0,${IR_CALLOUT.DOWN_BY + 1},0,0,100,1,,0,*`, `$IRTX,100,15,7,0,${IR_CALLOUT.DOWN + 1},0,0,100,1,,0,*`]);
});

test('S57 sender: the victim\'s DOWN word waits 300 ms (the headset\'s single-shot guard is 199 ms)', () => {
  const h = harness(); const waits = []; h.eng.delay = (ms, fn) => { waits.push(ms); fn(); }; h.live();
  h.lethal(19, 2);
  assert.ok(waits.includes(300), 'the second word is delayed 300 ms: ' + JSON.stringify(waits));
});

test('S57 sender: an unknown killer sends DOWN naming ME, magnitude = 25 + my own team', () => {
  const h = harness(); h.live();
  h.frame('$HP,0,0,0,*');   // a zero-HP frame with no fresh $HIR latch behind it -- shooter unknown
  assert.deepEqual(h.irtx(), [`$IRTX,100,15,7,0,${IR_CALLOUT.DOWN + 1},0,0,100,1,,0,*`]);
});

test('S57 sender: a DOT death (S16) sends DOWN_BY for the poisoner, same as any other known killer', () => {
  const h = harness(); h.live();
  // Shortcut past the poison tick machinery (fully covered by poison.test.mjs): drive `_death` the way a
  // lethal tick does, straight off `_dotKill`, and read back what the sender did with it.
  h.eng._dotKill = { at: h.now(), num: 33, team: 2 };
  h.eng._death(false);
  assert.equal(h.eng.killedBy.dot, true, 'setup: this really is a DOT death');
  assert.deepEqual(h.irtx(), [`$IRTX,100,15,33,0,${IR_CALLOUT.DOWN_BY + 1},0,0,100,1,,0,*`, `$IRTX,100,15,7,0,${IR_CALLOUT.DOWN + 1},0,0,100,1,,0,*`]);
});

test('S57 sender: callout_team null falls back to my own team, not an unused id', () => {
  const h = harness({ calloutTeam: null }); h.live();
  h.lethal(19, 2);
  assert.deepEqual(h.irtx(), [`$IRTX,100,15,19,1,${IR_CALLOUT.DOWN_BY + 1},0,0,100,1,,0,*`, `$IRTX,100,15,7,1,${IR_CALLOUT.DOWN + 1},0,0,100,1,,0,*`]);   // team field = my own tid (1), not 0, on both words
});

test('S57 sender: nothing is sent with the link down', () => {
  const h = harness(); h.live();
  h.eng.bleUp = false;
  h.lethal(19, 2);
  assert.equal(h.irtx().length, 0);
});

test('S57 sender: nothing is sent outside a live match', () => {
  const h = harness(); h.live();
  h.eng.phase = 'lobby';   // the real call sites all gate on 'live' already; this proves the sender's own belt-and-braces check
  h.eng._death(false);
  assert.equal(h.irtx().length, 0);
});

test('S57 sender: an infection flip is not a death for this purpose -- no callout', () => {
  const flip = { 1: ['$TID,1,*'], 2: ['$TID,2,*'] };
  const h = harness({ mode: 'infection', teamFlip: flip }); h.live();
  h.lethal(19, 2);
  assert.equal(h.eng._turned, true, 'setup: the flip really happened');
  assert.equal(h.irtx().length, 0);
});

// ---------- receiver ----------

test('S57 receiver: DOWN_BY naming me is KILL CONFIRMED -- cue + $SFLASH, no victim name, score untouched', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);   // I killed a member of team 2 (yellow)
  assert.deepEqual(h.eng.state().callout, { kind: 'kill_confirmed', name: null, team: 'yellow', at: h.now() });
  assert.equal(h.cues('VAA').length, 1, 'the kill cue played (golden bundle cue_pools.kill[0])');
  assert.equal(h.sflashes().length, 1);
  assert.equal(h.eng.score, null, 'the IR word never moves the score');
  assert.notEqual(h.eng.moment && h.eng.moment.kind, 'kill', 'no fabricated MC-attributed banner (hud.js hard-wires "CONFIRMED BY MISSION CONTROL")');
});

test('S57 receiver: ENEMY DOWN plays VB8 and sets the HUD chip with the victim\'s name', () => {
  const h = harness(); h.live();
  h.irWord(19, IR_CALLOUT.DOWN + 2);   // DOWN naming VIPER (team 2, yellow) -- an enemy to me (team 1)
  assert.deepEqual(h.eng.state().callout, { kind: 'enemy_down', name: 'VIPER', team: 'yellow', at: h.now() });
  assert.equal(h.cues('VB8').length, 1);
});

test('S57 receiver: TEAMMATE DOWN sets the chip with no sound', () => {
  const h = harness(); h.live();
  h.irWord(20, IR_CALLOUT.DOWN + 1);   // DOWN naming GHOST (team 1, blue) -- my own team
  assert.deepEqual(h.eng.state().callout, { kind: 'teammate_down', name: 'GHOST', team: 'blue', at: h.now() });
  assert.equal(h.cues('VB8').length, 0, 'no sound for a teammate');
  assert.equal(h.writes.length, 0, 'nothing written at all');
});

test('S57 receiver: my own DOWN is ignored -- I already know', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN + 1);   // DOWN naming ME, my own team
  assert.equal(h.eng.state().callout, null);
  assert.equal(h.writes.length, 0);
});

test('S57 receiver: FFA treats every DOWN as an enemy, even a same-team-id victim', () => {
  const h = harness({ mode: 'ffa' }); h.live();
  h.irWord(20, IR_CALLOUT.DOWN + 1);   // GHOST is nominally "my" team id in the roster, but FFA never means friendly
  assert.equal(h.eng.state().callout.kind, 'enemy_down');
  assert.equal(h.cues('VB8').length, 1);
});

test('S57 receiver: a 14 ms duplicate (two sensors, one word) is deduped', () => {
  const h = harness(); h.live();
  h.irWord(19, IR_CALLOUT.DOWN + 2, 4);
  h.adv(14);
  h.irWord(19, IR_CALLOUT.DOWN + 2, 0);   // same key, different sensor, 14 ms later
  assert.equal(h.cues('VB8').length, 1, 'one physical word, one callout');
});

test('S57 receiver: the SAME key 1.2 s later is a real double kill, not a dupe', () => {
  const h = harness(); h.live();
  h.irWord(19, IR_CALLOUT.DOWN + 2);
  h.adv(1200);
  h.irWord(19, IR_CALLOUT.DOWN + 2);
  assert.equal(h.cues('VB8').length, 2, 'both count');
});

test('S57 receiver: a dead phone ignores every callout word', () => {
  const h = harness(); h.live();
  h.lethal(19, 2);   // I die
  assert.equal(h.eng.alive, false, 'setup: I am down');
  const irtxAtDeath = h.writes.length;
  h.irWord(19, IR_CALLOUT.DOWN + 2);   // an enemy-down word arrives while I am down
  assert.equal(h.eng.state().callout, null);
  assert.equal(h.writes.length, irtxAtDeath, 'nothing new written');
});

test('S57 receiver: a callout word never touches state().beacon', () => {
  const h = harness(); h.live();
  h.frame('$HIR,4,15,0,2,8,0,0,*');   // a real hill beacon first
  const beaconBefore = h.eng.state().beacon;
  assert.ok(beaconBefore);
  h.irWord(19, IR_CALLOUT.DOWN + 2);
  assert.deepEqual(h.eng.state().beacon, beaconBefore);
});

test('S57 receiver: reserved FLAG_TAKEN/FLAG_CAPTURED magnitudes (29-36) are ignored outright, never a beacon', () => {
  const h = harness(); h.live();
  h.frame('$HIR,4,15,0,2,8,0,0,*');   // a real hill beacon, so there is something to prove is untouched
  const beaconBefore = h.eng.state().beacon;
  h.irWord(5, IR_CALLOUT.FLAG_TAKEN);           // 29: reserved, lowest edge
  h.irWord(5, IR_CALLOUT.FLAG_CAPTURED + 3);    // 36: reserved, highest edge
  assert.deepEqual(h.eng.state().beacon, beaconBefore, 'not read as a beacon');
  assert.equal(h.eng.state().callout, null, 'not read as a callout either');
  assert.equal(h.writes.length, 0);
});

// ---------- kill confirm: first to arrive, once (Tony) ----------

test('S57 kill confirm: IR arrives first -- MC\'s plain cue is skipped, medals and score still land', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);
  assert.equal(h.cues('VAA').length, 1, 'setup: IR played the confirm');
  h.feedback({ kind: 'kill', victim_team: 'yellow' });
  assert.equal(h.cues('VAA').length, 1, 'MC\'s plain kill line was skipped, not a second one');
  assert.equal(h.sflashes().length, 2, 'both channels flash -- only the voice line is deduped');
  assert.equal(h.eng.score.kills, 1, 'score still moves -- only MC touches it');
  assert.equal(h.eng.moment.kind, 'kill', 'MC still sets its own moment');
});

test('S57 kill confirm: MC arrives first -- the IR confirm plays no cue or flash of its own', () => {
  const h = harness(); h.live();
  h.feedback({ kind: 'kill', victim_team: 'yellow' });
  assert.equal(h.cues('VAA').length, 1, 'setup: MC played the confirm');
  assert.equal(h.sflashes().length, 1);
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);
  assert.deepEqual(h.eng.state().callout, { kind: 'kill_confirmed', name: null, team: 'yellow', at: h.now() }, 'the HUD chip still reflects the IR word');
  assert.equal(h.cues('VAA').length, 1, 'no second voice line');
  assert.equal(h.sflashes().length, 1, 'no second flash either -- the whole IR write is suppressed');
});

test('S57 kill confirm: MC\'s medal cues play even when IR already confirmed the plain kill', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);
  h.feedback({ kind: 'kill', victim_team: 'yellow', medals: ['killtacular'] });
  h.drain();   // the medal line follows the IR kill line; it never plays on top of it
  assert.equal(h.cues('VA7M').length, 1, 'the medal line (killtacular = VA7M in the golden bundle) is never suppressed');
});

// ---------- polish round 1 (2026-09-23) ----------

test('S57 kill confirm: a double kill where only ONE IR word lands still plays MC\'s cue for the second kill', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                     // kill 1, heard over IR
  h.feedback({ kind: 'kill', victim_team: 'yellow' });     // MC confirms kill 1: pairs with the IR confirm, no second line
  h.adv(700);
  h.feedback({ kind: 'kill', victim_team: 'yellow' });     // MC confirms kill 2, whose IR word never arrived
  h.drain();
  assert.equal(h.cues('VAA').length, 2, 'one line per kill: IR for the first, MC for the second');
});
test('S57 kill confirm: confirms pair by victim team, so another team\'s MC kill is not swallowed', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                     // IR: I killed someone on tid 2 (yellow)
  h.feedback({ kind: 'kill', victim_team: 'blue' });       // MC: a different kill, a victim on tid 1
  h.drain();
  assert.equal(h.cues('VAA').length, 2, 'different victims, two lines');
});
test('S57 sender: a gun-recovery DOWN (a power-cycle, not a kill) sends no callout', () => {
  const h = harness(); h.live();
  h.eng._death(true, 'gun_recovery');
  assert.deepEqual(h.irtx(), []);
});
test('S57 receiver: unassigned magnitudes 37-39 stay on the bus, ignored, never a beacon', () => {
  const h = harness(); h.live();
  h.irWord(5, 37); h.irWord(5, 39);
  assert.equal(h.eng.state().beacon, null);
  assert.equal(h.eng.state().callout, null);
});
test('S57 kill confirm: pairing resolves MC\'s team_id through the match\'s teams, not a colour name', () => {
  // team ids are free config strings; a roster whose ids are not the colour keys must still pair (round 2)
  const teams = [{ team_id: 'alpha', name: 'ALPHA', color: 'blue', tid: 1 }, { team_id: 'bravo', name: 'BRAVO', color: 'yellow', tid: 2 }];
  const h = harness({ teams }); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                     // IR: my kill, victim on tid 2
  h.feedback({ kind: 'kill', victim_team: 'bravo' });      // MC: the same kill, team_id 'bravo' = tid 2
  assert.equal(h.cues('VAA').length, 1, 'the same kill plays once');
});

// ---------- QA-05 (2026-09-23): read-only presentation fields for the HUD's callout card ----------

test('QA-05: a DOWN_BY word from another killer carries the killer as `by`, and still no victim name', () => {
  const h = harness(); h.live();
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2);   // GHOST (my team) killed a member of team 2 (yellow)
  assert.deepEqual(h.eng.state().callout, { kind: 'enemy_down', name: null, team: 'yellow', at: h.now(), by: 'GHOST' });
  assert.equal(h.eng.score, null, 'presentation only: the score never moves');
});

test('QA-05: a hill changing hands sets state().hillCallout on the same decision that speaks the line', () => {
  const h = harness(); h.live();
  assert.equal(h.eng.state().hillCallout, null);
  h.frame('$HIR,4,15,0,2,8,0,0,*');                 // a neutral point in range
  h.adv(400); h.frame('$HIR,4,15,0,1,50,0,0,*');    // we (tid 1) take it
  assert.deepEqual(h.eng.state().hillCallout, { kind: 'hill_captured', at: h.now() });
  assert.equal(h.cues('VB0N').length, 1, 'the control: the audio line played on the same transition');
  h.adv(400); h.frame('$HIR,4,15,0,0,50,0,0,*');    // red (tid 0) takes it off us
  assert.deepEqual(h.eng.state().hillCallout, { kind: 'hill_lost', at: h.now() });
  h.adv(3100);
  assert.equal(h.eng.state().hillCallout, null, 'cleared after the callout window, like state().callout');
  assert.equal(h.eng.score, null, 'no score, no rule: the hill tally is untouched by this field');
});

// ---------- S57 names (Tony 2026-09-24): DOWN_BY then DOWN from the victim, paired by victim team ----------

test('S57 names: on the killer\'s phone the paired DOWN adds the victim\'s name, with no ENEMY DOWN and one kill confirm', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);          // I killed someone on team 2
  const at = h.now(); h.adv(250);
  h.irWord(19, IR_CALLOUT.DOWN + 2);            // ...and it was VIPER
  const co = h.eng.state().callout;
  assert.equal(co.kind, 'kill_confirmed'); assert.equal(co.victim, 'VIPER'); assert.equal(co.at, at, 'the same callout, named in place');
  assert.equal(h.cues('VAA').length, 1, 'one kill cue'); assert.equal(h.cues('VB8').length, 0, 'no ENEMY DOWN on top');
  assert.equal(h.eng._irKillOpen.length, 1, 'exactly one IR kill confirm waits for MC\'s twin');
});

test('S57 names: a bystander gets one ENEMY DOWN naming the victim and the killer', () => {
  const h = harness(); h.live();
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2);         // GHOST killed someone on team 2
  h.adv(250); h.irWord(19, IR_CALLOUT.DOWN + 2); // VIPER
  const co = h.eng.state().callout;
  assert.equal(co.kind, 'enemy_down'); assert.equal(co.victim, 'VIPER'); assert.equal(co.by, 'GHOST');
  assert.equal(h.cues('VB8').length, 1, 'one ENEMY DOWN, not two');
});

test('S57 names: two victims of one team within a second pair oldest first', () => {
  const h = harness(); h.live();
  // docs/announcer.md: the second death's callout waits for the first's "Target down." to finish, then plays named.
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2); const first = h.now(); h.adv(100);
  h.irWord(33, IR_CALLOUT.DOWN_BY + 2); h.adv(150);
  h.irWord(19, IR_CALLOUT.DOWN + 2);            // pairs with the first DOWN_BY, the callout on air: named in place
  assert.equal(h.eng.state().callout.at, first); assert.equal(h.eng.state().callout.victim, 'VIPER');
  h.adv(100); h.irWord(21, IR_CALLOUT.DOWN + 2);   // pairs with the second, still queued
  assert.equal(h.eng.state().callout.victim, 'VIPER', 'the callout on air is not renamed by the newer death');
  h.drain(1500);
  assert.ok(h.eng.state().callout.at > first); assert.equal(h.eng.state().callout.victim, h.eng.nameOf(21), 'the second callout plays named');
  assert.equal(h.cues('VB8').length, 2, 'two deaths, two ENEMY DOWNs, no extra for the DOWN words');
});

test('S57 names: a lone DOWN (its DOWN_BY lost) is still a named callout; a DOWN after the window is too', () => {
  const h = harness(); h.live();
  h.irWord(19, IR_CALLOUT.DOWN + 2);
  assert.equal(h.eng.state().callout.name, 'VIPER'); assert.equal(h.cues('VB8').length, 1);
  h.adv(3500);
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2); h.adv(1200);   // past CALLOUT_PAIR_MS: the DOWN_BY is dropped unpaired
  h.irWord(21, IR_CALLOUT.DOWN + 2);
  assert.equal(h.eng.state().callout.kind, 'enemy_down'); assert.equal(h.eng.state().callout.name, h.eng.nameOf(21));
  assert.equal(h.cues('VB8').length, 3, 'the late DOWN is its own event');
});

test('S57 names: an unknown killer sends one word (DOWN, already naming me); a gun recovery sends none', () => {
  const h = harness(); h.live();
  h.frame('$HP,0,0,0,*');                       // unknown killer: DOWN only
  assert.equal(h.irtx().length, 1);
  const g = harness(); g.live();
  g.eng.latch = { shooter_num: 19, shooter_team: 2, at: g.now(), ir_proto: 0, ir_subtype: 3, crit: 0, sensor: 4, mag: 9 };
  g.eng._death(false, 'gun_recovery');
  assert.equal(g.irtx().length, 0, 'a power-cycle is not a kill');
});

test('S57 names: a panic inside the 300 ms gap stops the second word', () => {
  const h = harness(); const queued = []; h.eng.delay = (ms, fn) => { if (ms === 300) queued.push(fn); else fn(); }; h.live();
  h.lethal(19, 2);
  assert.equal(h.irtx().length, 1, 'DOWN_BY went out at once');
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'panic' } });
  queued.forEach(fn => fn());
  assert.equal(h.irtx().length, 1, 'no DOWN after the panic');
});

test('S57 names: a DOWN too soon after a DOWN_BY (an earlier death, its DOWN_BY lost) does not claim it', () => {
  const h = harness(); h.live();
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2); h.adv(50);   // B's DOWN_BY
  h.irWord(19, IR_CALLOUT.DOWN + 2);                  // A's DOWN, 50 ms later: A's own DOWN_BY was lost
  h.adv(250); h.irWord(33, IR_CALLOUT.DOWN + 2);     // B's DOWN pairs with B's DOWN_BY
  assert.equal(h.eng.state().callout.victim, h.eng.nameOf(33), 'B\'s callout (on air) takes B\'s name');
  h.drain(1500);                                      // docs/announcer.md: A's callout waited its turn
  assert.equal(h.eng.state().callout.kind, 'enemy_down'); assert.equal(h.eng.state().callout.name, 'VIPER', 'A is its own callout');
  assert.equal(h.cues('VB8').length, 2, 'two deaths, two cues, no third');
});

test('S57 names: a same-killer double kill inside the dedupe gives the killer no ENEMY DOWN', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2); h.adv(250); h.irWord(19, IR_CALLOUT.DOWN + 2);   // kill 1, named
  h.adv(150); h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                                        // kill 2, 400 ms later: deduped as a callout
  h.adv(250); h.irWord(33, IR_CALLOUT.DOWN + 2);                                          // its victim's DOWN
  assert.equal(h.cues('VB8').length, 0, 'no ENEMY DOWN on the killer\'s phone');
});


test('S57 sender: the name word goes out >= 300 ms after the kill word was WRITTEN, however late that write lands', async () => {
  // Bench 2026-09-24: the two $IRTX writes were 186 ms apart on the wire, inside the headset's 199 ms one-shot guard.
  // Here the link holds the first word back 400 ms (the death burst ahead of it); the gap must run from its write.
  const h = harness(); h.live();
  const wire = []; let release = null; const timers = [];
  h.eng.writer = frames => {
    if (frames.some(f => f.startsWith('$IRTX,')) && !release) return new Promise(r => { release = () => { wire.push({ f: frames[0], t: h.now() }); r(true); }; });
    frames.filter(f => f.startsWith('$IRTX,')).forEach(f => wire.push({ f, t: h.now() }));
    return Promise.resolve(true);
  };
  h.eng.delay = (ms, fn) => timers.push({ at: h.now() + ms, fn });
  const step = async ms => { for (let t = 0; t < ms; t += 10) { h.adv(10); for (const x of timers.filter(x => x.at <= h.now())) { timers.splice(timers.indexOf(x), 1); x.fn(); } await Promise.resolve(); } };
  h.lethal(19, 2);                          // VIPER kills me: DOWN_BY is queued on the link
  await step(400); release(); await Promise.resolve(); await Promise.resolve();   // ...and reaches the wire 400 ms later
  await step(600);
  assert.equal(wire.length, 2, 'both words went out: ' + JSON.stringify(wire));
  assert.ok(wire[1].t - wire[0].t >= 300, `the name word is >= 300 ms behind the kill word on the wire (${wire[1].t - wire[0].t} ms)`);
});

test('S57 receiver: a name word 750 ms after its kill word still pairs (the window is 150-800 ms)', () => {
  const h = harness(); h.live();
  h.irWord(20, IR_CALLOUT.DOWN_BY + 2); h.adv(750);
  h.irWord(19, IR_CALLOUT.DOWN + 2);
  assert.equal(h.eng.state().callout.victim, 'VIPER'); assert.equal(h.cues('VB8').length, 1, 'one death, one ENEMY DOWN');
});
