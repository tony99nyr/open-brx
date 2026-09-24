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
    frame(f) { eng.feedFrame(f); return h; },
    kit() { eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' }); eng.onMcMessage({ kind: 'assign', body: { player, team: teams[0], roster } }); return h; },
    config_() { eng.onMcMessage({ kind: 'config', body: { config, frames: bundle, roster } }); return h; },
    echo() { eng.feedFrame('$LCD,0,0,0,0,0,0,*'); return h; },
    start(runwayMs = 0) { eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: clock + runwayMs, config_id: golden.config_id, seq: 1, countdown_s: Math.round(runwayMs / 1000) } }); return h; },
    live() { h.kit().config_().echo().start(0); h.adv(10); eng.feedFrame('$LCD,45,70,0,0,30,90,*'); writes.length = 0; facts.length = 0; return h; },   // clean slate: past the arm+spawn write burst (head, $AMMO, spawn's own $SFLASH)
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

test('S57 sender: a known killer sends DOWN_BY naming them, magnitude = 21 + my own team', () => {
  const h = harness(); h.live();
  h.lethal(19, 2);   // VIPER kills me
  assert.deepEqual(h.irtx(), [`$IRTX,100,15,19,0,${IR_CALLOUT.DOWN_BY + 1},0,0,100,1,,0,*`]);
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
  assert.deepEqual(h.irtx(), [`$IRTX,100,15,33,0,${IR_CALLOUT.DOWN_BY + 1},0,0,100,1,,0,*`]);
});

test('S57 sender: callout_team null falls back to my own team, not an unused id', () => {
  const h = harness({ calloutTeam: null }); h.live();
  h.lethal(19, 2);
  assert.deepEqual(h.irtx(), [`$IRTX,100,15,19,1,${IR_CALLOUT.DOWN_BY + 1},0,0,100,1,,0,*`]);   // team field = my own tid (1), not 0
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
  assert.equal(h.cues('V124').length, 1, 'the medal line (killtacular = V124 in the golden bundle) is never suppressed');
});

// ---------- polish round 1 (2026-09-23) ----------

test('S57 kill confirm: a double kill where only ONE IR word lands still plays MC\'s cue for the second kill', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                     // kill 1, heard over IR
  h.feedback({ kind: 'kill', victim_team: 'yellow' });     // MC confirms kill 1: pairs with the IR confirm, no second line
  h.adv(700);
  h.feedback({ kind: 'kill', victim_team: 'yellow' });     // MC confirms kill 2, whose IR word never arrived
  assert.equal(h.cues('VAA').length, 2, 'one line per kill: IR for the first, MC for the second');
});
test('S57 kill confirm: confirms pair by victim team, so another team\'s MC kill is not swallowed', () => {
  const h = harness(); h.live();
  h.irWord(7, IR_CALLOUT.DOWN_BY + 2);                     // IR: I killed someone on tid 2 (yellow)
  h.feedback({ kind: 'kill', victim_team: 'blue' });       // MC: a different kill, a victim on tid 1
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
