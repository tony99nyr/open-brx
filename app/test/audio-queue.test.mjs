// The gun-audio simulator and the audio queue scenarios (docs/audio-queue-scenarios.md).
//
// Three layers:
//   1. the simulator reproduces the bench facts (2026-09-24: FIFO, $PLAYX, the shield hum; 2026-09-11: the token-1
//      interrupt slot), and every ASSUMPTION in GUN_RULES is a live lever (changing it changes an outcome);
//   2. under (A), the app on main, the scenarios reproduce what Tony heard, frame for frame with engine.js;
//   3. under (B), the 0.4.12 rule, the scenarios assert the outcomes we want. B runs the REAL announcer queue and gun
//      model (app/src/announcer.js). An outcome B does NOT yet deliver is a `todo` test: it runs and reports, and it
//      does not fail the suite. Turn it into a plain test once B delivers it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulateGun, GUN_RULES, CLIP_MS, PLAYX, play, playNow } from '../tools/gun-audio-sim.mjs';
import { SCENARIOS, runScenario, WANT, MUST_HEAR, ANNOUNCE_AUDIO_LATE_DEFAULT_MS, ANNOUNCE_PRIORITY, ENGINE_MIRROR, ENGINE_TICK_MS,
  SPAWN_HEAD, OBJECTIVE } from '../tools/audio-scenarios.mjs';
import * as announcer from '../src/announcer.js';

const sc = id => SCENARIOS.find(s => s.id === id);
const clipsOf = (run, cue) => run.gun.clips.filter(c => c.cue === cue);
const one = (run, cue) => { const c = clipsOf(run, cue); assert.equal(c.length, 1, `${run.scenario}/${run.policy}: expected one ${cue} clip, got ${c.length}`); return c[0]; };
const heardInFull = c => c.status === 'full';
const MUST_LATENCY_MS = 300;
const FLASH_GAP_MS = 120;   // the kill item's flash-to-line gap: the item is on air from the flash
const rules = patch => ({ ...GUN_RULES, ...patch });
/** Body sounds are exempt from the announcer queue in B (docs/announcer.md). The pain grunts are held out of the
 *  invariants and asserted by their own test (finding B4: a grunt stale by more than 500 ms is dropped). */
const BODY = new Set(['pain_short', 'pain_long']);
/** The body sounds B writes outside the announcer queue (docs/announcer.md, "Exempt"): the one-outstanding rule is the
 *  queue's, so it is asserted for the queue's lines only. */
const EXEMPT = new Set([...BODY, 'shield_down', 'low_health', 'spawn']);
const A10_MS = CLIP_MS.A10;
/** A shield armed at 0 ms (the hum starts), then one VAA at `sentAt`. */
const humTrial = (sentAt, r = GUN_RULES, horizonMs = sentAt + 61000) =>
  simulateGun({ writes: [{ t: sentAt, frames: [play('VAA')] }], shield: [[0, 105]], humClip: 'A10', horizonMs }, r).clips[0];

// ---------- 1. the simulator against the bench ----------
test('rule 1 FIFO (2026-09-24): VA6Y then VAA during it: VAA starts as VA6Y ends, no cut-in', () => {
  const g = simulateGun({ writes: [{ t: 0, frames: [play('VA6Y')] }, { t: 500, frames: [play('VAA')] }], horizonMs: 10000 });
  assert.equal(g.clips[0].status, 'full');
  assert.equal(g.clips[1].start, CLIP_MS.VA6Y);
  const old = simulateGun({ writes: [{ t: 0, frames: [play('VA6Y')] }, { t: 500, frames: [play('VAA')] }], horizonMs: 10000 }, rules({ fifo: false }));
  assert.equal(old.clips[0].status, 'cut', 'the old belief, for contrast: a newer clip interrupts');
});

test('rule 2 $PLAYX (2026-09-24): four queued and one stop: the first is cut, the other three play back to back', () => {
  const g = simulateGun({ writes: [{ t: 0, frames: [play('VA6D'), play('VA6E'), play('VB0P'), play('VAA')] }, { t: 1000, frames: [PLAYX] }], horizonMs: 20000 });
  assert.deepEqual(g.clips.map(c => c.status), ['cut', 'full', 'full', 'full']);
  assert.equal(g.clips[1].start, 1000);
  assert.equal(g.clips[2].start, g.clips[1].end);
  assert.equal(g.clips[3].start, g.clips[2].end);
});

test('rule 2 $PLAYX (2026-09-24): four stops 150 ms apart leave audible fragments, then the last clip plays', () => {
  const writes = [{ t: 0, frames: [play('VA6D'), play('VA6E'), play('VB0P'), play('VAA')] },
    { t: 1000, frames: [PLAYX] }, { t: 1150, frames: [PLAYX] }, { t: 1300, frames: [PLAYX] }];
  const g = simulateGun({ writes, horizonMs: 10000 });
  assert.deepEqual(g.clips.map(c => c.status), ['cut', 'cut', 'cut', 'full']);
  assert.ok(g.clips[1].fragment && g.clips[2].fragment, 'a 150 ms piece of a clip is heard');
  assert.equal(g.clips[3].start, 1300);
});

test('rule 3 (2026-09-24): shield 0 = no hum, VAA at once; the shield breaking releases a queue the hum held', () => {
  const noShield = simulateGun({ writes: [{ t: 1000, frames: [play('VAA')] }], shield: [[0, 0]], humClip: 'A10', horizonMs: 5000 });
  assert.equal(noShield.clips[0].start, 1000);
  assert.equal(noShield.hum.length, 0);
  const broke = simulateGun({ writes: [{ t: 1000, frames: [play('VAA')] }], shield: [[0, 105], [4000, 0]], humClip: 'A10', horizonMs: 8000 });
  assert.equal(broke.clips[0].start, 4000);
});

test('rule 3 (2026-09-24): a VAA stuck behind the hum, then $PLAYX and a new VAA 100 ms later: both play, then the hum resumes', () => {
  const g = simulateGun({ writes: [{ t: 20000, frames: [play('VAA')] }, { t: 30000, frames: [PLAYX] }, { t: 30100, frames: [play('VAA')] }],
    shield: [[0, 105]], humClip: 'A10', horizonMs: 40000 });
  assert.deepEqual(g.clips.map(c => [c.status, c.start]), [['full', 30000], ['full', 30000 + CLIP_MS.VAA]]);
  const back = g.hum.find(h => h.start > 30000);
  assert.ok(back && back.start >= g.clips[1].end, 'the hum resumes by itself, the shield still up');
});

test('rule 3, the two trials (9 s late once, never in 60+ s once): only humYield firstLoopEnd reproduces both', () => {
  // Trial timing is not in the notes. The reading this model makes: the 9 s trial's VAA went in during the hum's FIRST
  // play (6 s in: 14.95 - 6 = about 9 s to wait), the 60+ s trial's after the hum had looped.
  const early = 6000, late = 30000;
  const fits = r => { const a = humTrial(early, r), b = humTrial(late, r); return { nine: a.start != null && Math.abs(a.start - early - 9000) < 1000, never: b.status === 'never' }; };
  assert.deepEqual(fits(GUN_RULES), { nine: true, never: true }, 'the default fits both trials');
  assert.deepEqual(fits(rules({ humYield: 'everyLoopEnd' })), { nine: true, never: false }, 'yield at every loop end: never "never"');
  assert.deepEqual(fits(rules({ humYield: 'never' })), { nine: false, never: true }, 'never yield: never "9 s"');
  assert.equal(humTrial(early).start, A10_MS, 'the queued clip starts where the first A10 play ends');
});

test('rule 3, the t23 clip decides the block: a 44 ms silent id (N1A) frees the queue only if the hum yields at every loop end', () => {
  const trial = r => simulateGun({ writes: [{ t: 30000, frames: [play('VAA')] }], shield: [[0, 105]], humClip: 'N1A', horizonMs: 90000 }, r).clips[0];
  assert.ok(trial(rules({ humYield: 'everyLoopEnd' })).start - 30000 <= CLIP_MS.N1A, 'everyLoopEnd: at most one 44 ms play late');
  assert.equal(trial(rules({ humYield: 'firstLoopEnd' })).status, 'never', 'firstLoopEnd: a silent block, forever');
  assert.equal(trial(rules({ humYield: 'never' })).status, 'never', 'never: a silent block, forever');
  const empty = simulateGun({ writes: [{ t: 30000, frames: [play('VAA')] }], shield: [[0, 105]], humClip: null, horizonMs: 40000 }).clips[0];
  assert.equal(empty.start, 30000, 't23 EMPTY: no hum, no block (model; bench step 2 checks it)');
});

test('rule 4 (2026-09-24): $LIFE grants and $HLOOP are silent; an unknown frame is reported, not guessed', () => {
  const g = simulateGun({ writes: [{ t: 0, frames: ['$LIFE,0,0,10,*', '$HLOOP,1,*', play('VAA'), '$FOO,1,*'] }], horizonMs: 3000 });
  assert.equal(g.clips.length, 1);
  assert.equal(g.clips[0].start, 2 * GUN_RULES.writeFrameGapMs);
  assert.deepEqual(g.unknown.map(u => u.f), ['$FOO,1,*']);
});

test('the interrupt slot (2026-09-11, trials 1-3 and 5): token 1 cuts a clip, token 4 waits behind token 1', () => {
  const t2 = simulateGun({ writes: [{ t: 0, frames: [play('VA6D')] }, { t: 300, frames: [playNow('U100')] }], horizonMs: 5000 });
  assert.equal(t2.clips[0].status, 'cut', 'trial 2: slot 1 cuts slot 4 ("Gam.. HIT")');
  assert.equal(t2.clips[1].start, 300);
  const t3 = simulateGun({ writes: [{ t: 0, frames: [playNow('VB0P')] }, { t: 1000, frames: [play('VAA')] }], horizonMs: 8000 });
  assert.equal(t3.clips[0].status, 'full');
  assert.equal(t3.clips[1].start, CLIP_MS.VB0P, 'trial 3: slot 4 waits behind slot 1');
  const t5 = simulateGun({ writes: [{ t: 0, frames: [playNow('VB0P')] }, { t: 1000, frames: [playNow('U100')] }], horizonMs: 8000 });
  assert.equal(t5.clips[0].status, 'cut', 'trial 5: slot 1 cuts slot 1');
  const t1 = simulateGun({ writes: [{ t: 0, frames: ['$PLAY,U100,4,6,VAA,,,,*'] }], horizonMs: 3000 });
  assert.deepEqual(t1.clips.map(c => [c.id, c.start]), [['U100', 0], ['VAA', CLIP_MS.U100]], 'trial 1: one frame, both slots, in sequence');
  const fifo = simulateGun({ writes: [{ t: 0, frames: [play('VA6D')] }, { t: 300, frames: [playNow('U100')] }], horizonMs: 5000 }, rules({ interruptSlot: false }));
  assert.equal(fifo.clips[0].status, 'full', 'interruptSlot false: token 1 queues');
});

test('every ASSUMPTION lever changes an outcome (no dead constants)', () => {
  const base = { writes: [{ t: 0, frames: [PLAYX] }, { t: 100, frames: [play('VAA')] }], horizonMs: 3000 };
  assert.equal(simulateGun(base).clips[0].status, 'full');
  assert.equal(simulateGun(base, rules({ playxOnIdle: 'stopsNext' })).clips[0].status, 'cut', 'playxOnIdle');
  const rising = { writes: [{ t: 0, frames: [play('VA6D')] }], shield: [[0, 0], [500, 105]], humClip: 'A10', horizonMs: 5000 };
  assert.equal(simulateGun(rising).clips[0].status, 'full');
  assert.equal(simulateGun(rising, rules({ humWaitsForQueue: false })).clips[0].status, 'cut', 'humWaitsForQueue');
  const overHum = { writes: [{ t: 20000, frames: [playNow('U100')] }], shield: [[0, 105]], humClip: 'A10', horizonMs: 25000 };
  assert.equal(simulateGun(overHum).clips[0].mixed, true, "interruptOverHum 'mix'");
  assert.equal(simulateGun(overHum, rules({ interruptOverHum: 'queue' })).clips[0].status, 'never', "interruptOverHum 'queue'");
  assert.equal(simulateGun(overHum, rules({ interruptOverHum: 'cut' })).hum[0].end, 20000, "interruptOverHum 'cut'");
  const fill = { writes: [{ t: 0, frames: ['$LIFE,0,0,105,*', '$SFLASH,*', play('VAI')] }], shield: [[0, 0], [0, 105]], humClip: 'A10', horizonMs: 5000 };
  assert.equal(simulateGun(fill).clips[0].status, 'never');
  assert.equal(simulateGun(fill, rules({ humStartMs: 50 })).clips[0].start, 20, 'humStartMs');
});

test('every clip length matches the sound catalogue', () => {
  const cat = JSON.parse(readFileSync(new URL('../../mcp/brx_mcp/data/sound_catalog.json', import.meta.url), 'utf8'));
  const byId = Object.fromEntries(cat.sounds.map(s => [s.id, s]));
  for (const [id, ms] of Object.entries(CLIP_MS)) {
    assert.ok(byId[id], `${id} is in the catalogue`);
    assert.equal(ms, Math.round(byId[id].duration_s * 1000), `${id}`);
  }
});

test('the scenarios mirror engine.js and app.js on main (numbers, tick, spawn write)', () => {
  const src = readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8');
  for (const [name, v] of Object.entries(ENGINE_MIRROR)) {
    const m = src.match(new RegExp(`^(?:export )?const ${name} = ([^;]+);`, 'm'));
    assert.ok(m, `${name} is in engine.js`);
    assert.equal(String(m[1]).trim(), String(v), name);
  }
  assert.match(readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'), new RegExp(`engine\\.tick\\(\\);[^\\n]*\\}, ${ENGINE_TICK_MS}\\)`));
  const golden = JSON.parse(readFileSync(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url), 'utf8'));
  const find = (o, k) => { if (!o || typeof o !== 'object') return null; if (k in o) return o[k]; for (const v of Object.values(o)) { const r = find(v, k); if (r) return r; } return null; };
  assert.deepEqual(SPAWN_HEAD.slice(1), find(golden, 'spawn'), 'the golden spawn frames, `$PLAYX,0,*` first');
  assert.equal(SPAWN_HEAD[0], find(golden, 'pset_pool')[0], 'the life\'s $PSET take (t23 = A10)');
});

test('the harness runs announcer.js\'s own tables, not a copy; a lead change outranks the medal lines', () => {
  assert.equal(ANNOUNCE_PRIORITY, announcer.ANNOUNCE_PRIORITY, 'the same array, imported');
  assert.equal(MUST_HEAR, announcer.MUST_HEAR);
  assert.equal(OBJECTIVE, announcer.OBJECTIVE);
  assert.deepEqual(ANNOUNCE_PRIORITY.slice(0, 4), ['kill_confirmed', 'lead_taken', 'lead_lost', 'medal']);
  assert.deepEqual([...MUST_HEAR].sort(), ['kill_confirmed', 'lead_lost', 'lead_taken', 'medal']);
  assert.deepEqual([...OBJECTIVE].sort(), ['enemy_down', 'hill_captured', 'hill_lost']);
});

for (const s of SCENARIOS) for (const p of ['A', 'B']) {
  test(`${p} ${s.id}: every frame written is one the gun model knows`, () => {
    assert.deepEqual(runScenario(s, p).gun.unknown, []);
  });
}

// ---------- 2. (A) the app on main reproduces the field ----------
test('A: with the shield up, no kill confirm or medal is heard within 4 s (tonight: the first kill had no cue)', () => {
  const a = runScenario(sc('halo-hum-kills'), 'A');
  const must = a.gun.clips.filter(c => WANT[c.cue] === 'must');
  assert.equal(must.length, 7);
  for (const c of must) assert.ok(c.status === 'never' || c.latency >= 4000, `${c.cue} at ${c.eventT}: ${c.latency} ms`);
  const never = runScenario(sc('halo-hum-kills'), 'A', rules({ humYield: 'never' }));
  assert.ok(never.gun.clips.filter(c => WANT[c.cue] === 'must').every(c => c.status === 'never'), 'humYield never: all seven stuck');
  const fb = runScenario(sc('first-blood-lead'), 'A');
  for (const cue of ['kill', 'first_blood', 'lead_taken']) { const c = one(fb, cue); assert.ok(c.status === 'never' || c.latency >= 4000, cue); }
});

test('A (F348 on main): the spawn line rides the write that fills the shield, and waits out the first hum play', () => {
  const a = runScenario(sc('first-blood-lead'), 'A');
  const sp = one(a, 'spawn');
  assert.ok(sp.latency >= A10_MS - 1000, `the spawn line started ${sp.latency} ms late`);
  assert.equal(one(runScenario(sc('first-blood-lead'), 'A', rules({ humStartMs: 50 })), 'spawn').latency, (SPAWN_HEAD.length + 2) * GUN_RULES.writeFrameGapMs,
    'if the hum takes more than 20 ms to start, the line beats it');
});

test('A: the death $PLAYX (F149) stops the wrong clip, and the low-health line plays after the death', () => {
  const a = runScenario(sc('death-with-kill-queued'), 'A');
  const low = one(a, 'low_health');
  assert.ok(low.start >= 2000 && low.status === 'full', 'Health critical plays after the player died');
  assert.equal(one(a, 'shield_down').status, 'cut');
});

test('A: the hill preempt $PLAYX cuts my kill confirm, and the stale "Hill Captured" then plays in full', () => {
  const a = runScenario(sc('koth-flap-standard'), 'A');
  assert.equal(one(a, 'kill').status, 'cut');
  assert.equal(one(a, 'hill_captured').status, 'full');
});

test('A: the possession tick is a token-1 clip, and it cuts a medal line that the hill line pushed back', () => {
  const a = runScenario(sc('standard-control'), 'A');
  const dk = one(a, 'double_kill');
  assert.equal(dk.status, 'cut');
  assert.match(dk.cutBy, /U100/);
});

// ---------- 3. (B) the 0.4.12 rule: the acceptance spec ----------
const B = Object.fromEntries(SCENARIOS.map(s => [s.id, runScenario(s, 'B')]));

for (const s of SCENARIOS) {
  test(`B ${s.id}: every must-hear line that is sent starts at once (never behind the hum or a queue)`, () => {
    for (const c of B[s.id].gun.clips.filter(x => x.must)) {
      assert.notEqual(c.status, 'never', `${c.cue} sent at ${c.sentAt} never played`);
      assert.ok(c.start - c.sentAt <= 50, `${c.cue} waited ${c.start - c.sentAt} ms on the gun`);
    }
  });
  test(`B ${s.id}: no line that is not must-hear starts more than ${ANNOUNCE_AUDIO_LATE_DEFAULT_MS} ms after its event`, () => {
    // the spawn line is held out: a Shields spawn buries it under the fill's hum (its own todo test, finding B8)
    for (const c of B[s.id].gun.clips.filter(x => !x.must && x.start != null && x.cue !== 'shield_loop' && x.cue !== 'hill_tick' && !BODY.has(x.cue) && x.cue !== 'spawn')) {
      assert.ok(c.latency <= ANNOUNCE_AUDIO_LATE_DEFAULT_MS + 100, `${c.cue} started ${c.latency} ms late`);
    }
    for (const c of B[s.id].gun.clips.filter(x => !x.must && x.cue !== 'spawn')) assert.notEqual(c.status, 'never', `${c.cue} stuck on the gun`);
  });
  test(`B ${s.id}: a line that is not must-hear goes only to a silent gun (at most one outstanding)`, () => {
    const clips = B[s.id].gun.clips;   // in arrival order
    for (const c of clips.filter(x => !x.must && !EXEMPT.has(x.cue))) {
      const ahead = clips.slice(0, clips.indexOf(c)).filter(o => !o.mixed && (o.status === 'never' || o.end > c.sentAt));
      assert.equal(ahead.length, 0, `${c.cue} at ${c.sentAt} went in behind ${ahead.map(o => o.cue).join(', ')}`);
    }
  });
  test(`B ${s.id}: no heartbeat or possession tick while a must-hear line is due; no "shields online" line`, () => {
    assert.equal(B[s.id].mustPendingHeartbeats, 0);
    assert.equal(clipsOf(B[s.id], 'shield_online').length, 0);
  });
}

test('B halo-hum-kills: every kill line and medal is heard in full; kill lines inside 300 ms', () => {
  const b = B['halo-hum-kills'];
  const must = b.gun.clips.filter(c => c.must);
  assert.ok(must.length >= 6);
  assert.ok(must.every(heardInFull));
  for (const c of clipsOf(b, 'kill')) assert.ok(c.latency <= MUST_LATENCY_MS, `kill at ${c.eventT}: ${c.latency} ms`);
  for (const c of must.filter(x => x.cue !== 'kill')) assert.ok(c.latency <= 2500, `${c.cue}: ${c.latency} ms`);
});

test('B halo-heartbeat-kill: the kill confirm cuts the heartbeat, not the other way round', () => {
  const b = B['halo-heartbeat-kill'];
  const k = one(b, 'kill');
  assert.ok(heardInFull(k) && k.latency <= MUST_LATENCY_MS);
  assert.ok(clipsOf(b, 'shield_loop').every(c => c.end <= k.start || c.start >= k.end), 'no heartbeat under the kill line');
});

test('B teammate-down-firefight: the shield break is heard; the teammate card is silent; "Target down" is heard on time or not at all', () => {
  const b = B['teammate-down-firefight'];
  assert.ok(heardInFull(one(b, 'shield_down')));
  const ed = clipsOf(b, 'enemy_down');
  assert.ok(ed.length === 0 ? b.dropped.some(d => d.cue === 'enemy_down') : ed[0].latency <= ANNOUNCE_AUDIO_LATE_DEFAULT_MS);
});

test('B koth-capture-kill-lead: the kill confirm, then the lead change, both in full; the kill waits only for the hill line on air', () => {
  // The hill line cuts the hum and is on air when the kill lands 300 ms later. A lower item that still sounds is never
  // cut (docs/announcer.md, Pre-emption 1): the kill follows it at once, then the lead change.
  const b = B['koth-capture-kill-lead'];
  const hc = one(b, 'hill_captured'), k = one(b, 'kill'), l = one(b, 'lead_taken');
  assert.ok(heardInFull(k) && heardInFull(l) && k.start < l.start);
  assert.ok(k.start >= hc.end && k.start - hc.end <= MUST_LATENCY_MS, `the kill ${k.start - hc.end} ms after the hill line`);
  assert.ok(k.latency <= hc.ms + MUST_LATENCY_MS, `kill ${k.latency} ms: at most the hill line on air, plus ${MUST_LATENCY_MS} ms`);
  assert.ok(l.latency <= hc.ms + 2000 + 2 * MUST_LATENCY_MS, `lead ${l.latency} ms: the hill line, then the IR kill card's 2 s`);
});
test('B koth-capture-kill-lead: "Hill Captured" is heard at once, through the hum (finding B2)', () => {
  const hc = one(B['koth-capture-kill-lead'], 'hill_captured');
  assert.ok(heardInFull(hc) && hc.latency <= 50, `${hc.status}, ${hc.latency} ms`);
});
test('B: an objective line\'s flush never lands inside my own kill or medal clip', () => {
  for (const s of SCENARIOS) {
    const b = B[s.id], own = b.gun.clips.filter(c => c.must && c.start != null);
    for (const w of b.writes.filter(x => x.frames.includes(PLAYX) && /^(hill_captured|hill_lost|enemy_down)\b/.test(x.why))) {
      const hit = own.filter(c => c.start <= w.t && w.t < c.end);
      assert.deepEqual(hit.map(c => c.cue), [], `${s.id}: ${w.why} at ${w.t}`);
    }
  }
  assert.ok(B['koth-hum-objectives'].writes.some(x => x.frames.includes(PLAYX) && /^hill_captured/.test(x.why)), 'not vacuous: an objective flush happened');
});
test('B koth-hum-objectives: under the hum, both hill lines and "Target down" are heard; the ambient alert is not', () => {
  const b = B['koth-hum-objectives'];
  for (const cue of ['hill_captured', 'hill_lost', 'enemy_down']) assert.ok(heardInFull(one(b, cue)), cue);
  assert.equal(clipsOf(b, 'next_kill_wins').length, 0, 'an ambient line stays droppable while the hum blocks');
  assert.ok(b.dropped.some(d => d.cue === 'next_kill_wins'));
});

test('B first-blood-lead: the kill line, the first-blood medal and the lead change are heard in full', () => {
  const b = B['first-blood-lead'];
  assert.ok(heardInFull(one(b, 'kill')) && one(b, 'kill').latency <= MUST_LATENCY_MS);
  assert.ok(heardInFull(one(b, 'first_blood')));
  assert.ok(heardInFull(one(b, 'lead_taken')), 'with the lines back to back the lead fits inside its 4 s TTL here');
});
// Left `todo`: it waits on the bench (bench-2026-09-24.md Block 10 step 1, audio steps 1 and 4.3): how soon the hum starts
// after the fill, and restarts after a stop, decides whether moving the line ahead of the fill is enough.
test('B first-blood-lead: the spawn line on a Shields spawn is heard', { todo: 'F348 fills the shield 20 ms ahead of the spawn line in one write; the hum buries it (finding B8)' }, () => {
  const sp = one(B['first-blood-lead'], 'spawn');
  assert.ok(heardInFull(sp) && sp.latency <= ANNOUNCE_AUDIO_LATE_DEFAULT_MS, `${sp.status}, ${sp.latency} ms`);
});

test('B death-with-kill-queued: the low-health line never plays after the death', () => {
  for (const c of clipsOf(B['death-with-kill-queued'], 'low_health')) assert.ok(c.end <= 2000);
});
// Left `todo` for Tony's choice (F149, finding B3). Option 1: the kill line finishes, and the death stop waits for it (up to
// about 1 s), then goes out only if the low-health line is still on the gun. Option 2: the death is instant, the stop goes
// out at once, and my kill line is dropped (this test then asserts the kill clip is dropped, not heard).
test('B death-with-kill-queued: my kill confirm is not cut by my own death', { todo: 'the F149 death $PLAYX stops whatever plays, here the kill line (finding B3)' }, () => {
  assert.ok(heardInFull(one(B['death-with-kill-queued'], 'kill')));
});

test('B koth-flap-standard: the kill line is heard in full, the stale "Hill Captured" is never said, "Hill Lost" is', () => {
  const b = B['koth-flap-standard'];
  assert.ok(heardInFull(one(b, 'kill')));
  assert.equal(clipsOf(b, 'hill_captured').length, 0);
  assert.ok(heardInFull(one(b, 'hill_lost')));
});

test('B standard-control: kill, lead, first blood and double kill are all heard in full, in that order', () => {
  const b = B['standard-control'];
  const order = ['kill', 'lead_taken', 'first_blood', 'double_kill'].map(cue => one(b, cue));
  // The hill capture at 6 s lands behind 4.2 s of medal voice: it would start 3 s late, past its 2 s limit, so its card
  // shows without its line (docs/announcer.md, Late lines).
  assert.ok(b.dropped.some(d => d.cue === 'hill_captured' && /card only/.test(d.why)));
  order.forEach(c => assert.ok(heardInFull(c), c.cue));
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1].start < order[i].start, `${order[i - 1].cue} before ${order[i].cue}`);
  // The first-blood line waits behind the lead change (the `medal` rank), and the second kill's MC item folds it: the
  // spree fold never drops first blood (review H1), it says it and then the newest tier.
  assert.equal(clipsOf(b, 'kill').length, 1, 'the second kill is confirmed by its double-kill line, which replaces the plain line');
});
test('B standard-control: "Your team takes the lead" is heard (finding B1: it expired behind two kill items)', () => {
  const l = one(B['standard-control'], 'lead_taken');
  assert.ok(heardInFull(l), `${l.status}`);
});
test('B first-blood-lead: the lead change plays before the medal line of the kill it came with (the `medal` rank)', () => {
  const b = B['first-blood-lead'];
  assert.ok(one(b, 'kill').start < one(b, 'lead_taken').start && one(b, 'lead_taken').start < one(b, 'first_blood').start);
});
test('B koth-hold-medals: no possession tick while my kill or its medal lines are on air (it is a token-1 clip)', () => {
  const b = B['koth-hold-medals'];
  assert.equal(b.mustPendingHeartbeats, 0);
  const ticks = clipsOf(b, 'hill_tick');
  assert.ok(ticks.length >= 2, 'the tick runs while we hold the point');
  const own = b.gun.clips.filter(c => c.must);
  const first = Math.min(...own.map(c => c.sentAt)) - FLASH_GAP_MS, last = Math.max(...own.map(c => c.end));
  const inside = ticks.filter(c => c.sentAt >= first && c.sentAt < last);
  assert.deepEqual(inside.map(c => c.sentAt), [], 'a tick inside the kill\'s audio');
});

test('B: a pain grunt in the same hit as the shield break is not queued behind it (finding B4)', () => {
  for (const id of ['halo-heartbeat-kill', 'teammate-down-firefight', 'death-with-kill-queued']) {
    for (const c of B[id].gun.clips.filter(x => BODY.has(x.cue) && x.start != null)) assert.ok(c.latency <= 550, `${id}: ${c.cue} ${c.latency} ms`);
  }
  assert.ok(['halo-heartbeat-kill', 'teammate-down-firefight', 'death-with-kill-queued'].some(id => B[id].dropped.some(d => BODY.has(d.cue))),
    'at least one grunt was stale and dropped (the check above is not vacuous)');
});

// ---------- sensitivity: what B depends on that the bench has not measured ----------
test('B depends on Q1: if the hum restarts inside the gap between the last stop and the line, every must-hear line under the hum sticks', () => {
  const b = runScenario(sc('halo-hum-kills'), 'B', rules({ humRestartMs: 0 }));
  for (const c of b.gun.clips.filter(x => x.must)) assert.ok(c.status === 'never' || c.start - c.sentAt >= 500, `${c.cue}: waited ${c.start - c.sentAt} ms`);
});
test('B does not depend on humYield: every must-hear line is heard at once under all three', () => {
  for (const humYield of ['everyLoopEnd', 'firstLoopEnd', 'never']) {
    const b = runScenario(sc('halo-hum-kills'), 'B', rules({ humYield }));
    for (const c of b.gun.clips.filter(x => x.must)) assert.ok(c.status === 'full' && c.start - c.sentAt <= 50, `${humYield}: ${c.cue}`);
  }
});
