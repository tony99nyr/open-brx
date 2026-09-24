// The gun-audio simulator and the audio queue scenarios (docs/audio-queue-scenarios.md).
//
// Three layers:
//   1. the simulator reproduces the bench facts of 2026-09-24 (FIFO, $PLAYX, the shield hum);
//   2. under (A), the app as it is, the scenarios reproduce what Tony heard (the first kill had no cue at all);
//   3. under (B), the 0.4.12 rule, the scenarios assert the outcomes we want. This is the acceptance harness for
//      brx4's announcer queue. An outcome B does NOT yet deliver is a `todo` test: it runs and reports, and it does
//      not fail the suite. Turn it into a plain test once B delivers it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulateGun, GUN_RULES, CLIP_MS, PLAYX, play } from '../tools/gun-audio-sim.mjs';
import { SCENARIOS, runScenario, WANT, MUST_HEAR, ANNOUNCE_AUDIO_LATE_DEFAULT_MS, ANNOUNCE_PRIORITY } from '../tools/audio-scenarios.mjs';

const sc = id => SCENARIOS.find(s => s.id === id);
const clipsOf = (run, cue) => run.gun.clips.filter(c => c.cue === cue);
const one = (run, cue) => { const c = clipsOf(run, cue); assert.equal(c.length, 1, `${run.scenario}/${run.policy}: expected one ${cue} clip, got ${c.length}`); return c[0]; };
const heardInFull = c => c.status === 'full';
const MUST_LATENCY_MS = 300;
/** Body sounds are exempt from the announcer queue in B (docs/announcer.md). The pain grunt is the one that still
 *  queues: it goes in behind the shield-break line of the same hit. Held out of the invariants and asserted by its own
 *  `todo` test (finding B4). */
const BODY = new Set(['pain_short', 'pain_long']);
/** The body sounds B writes outside the announcer queue (docs/announcer.md, "Exempt"): the one-outstanding rule is the
 *  queue's, so it is asserted for the queue's lines only. */
const EXEMPT = new Set([...BODY, 'shield_down', 'low_health', 'spawn']);   // a must-hear line with nothing ahead of it: the 120 ms flash gap plus the flush

// ---------- 1. the simulator against the bench ----------
test('rule 1 FIFO: a second clip does not cut in, it starts when the first ends', () => {
  const g = simulateGun({ writes: [{ t: 0, frames: [play('VA6D')] }, { t: 500, frames: [play('VAA')] }], horizonMs: 10000 });
  assert.equal(g.clips[0].status, 'full');
  assert.equal(g.clips[1].start, CLIP_MS.VA6D);
  // the old belief, for contrast: a newer clip interrupts
  const old = simulateGun({ writes: [{ t: 0, frames: [play('VA6D')] }, { t: 500, frames: [play('VAA')] }], horizonMs: 10000 }, { ...GUN_RULES, fifo: false });
  assert.equal(old.clips[0].status, 'cut');
});

test('rule 2 $PLAYX: stops only the clip playing; N stops 150 ms apart flush N clips and leave audible fragments', () => {
  const writes = [{ t: 0, frames: [play('VA6D'), play('VA6E'), play('VB0P'), play('VAA')] },
    { t: 1000, frames: [PLAYX] }, { t: 1150, frames: [PLAYX] }, { t: 1300, frames: [PLAYX] }];
  const g = simulateGun({ writes, horizonMs: 10000 });
  assert.deepEqual(g.clips.map(c => c.status), ['cut', 'cut', 'cut', 'full']);
  assert.ok(g.clips[1].fragment && g.clips[2].fragment, 'a 150 ms piece of a clip is heard');
  assert.equal(g.clips[3].start, 1300);
});

test('rule 3 the hum: a clip queued behind it waits 60+ s; $PLAYX stops it; it resumes once the queue drains', () => {
  const shield = [[0, 105]];
  const stuck = simulateGun({ writes: [{ t: 1000, frames: [play('VAA')] }], shield, humClip: 'A10', horizonMs: 70000 });
  assert.equal(stuck.clips[0].status, 'never');
  const g = simulateGun({ writes: [{ t: 1000, frames: [play('VAA'), play('VA6D')] }, { t: 5000, frames: [PLAYX] }], shield, humClip: 'A10', horizonMs: 20000 });
  assert.equal(g.clips[0].start, 5000);
  assert.equal(g.clips[1].start, 5000 + CLIP_MS.VAA);
  const back = g.hum.find(h => h.start > 5000);
  assert.ok(back && back.start >= g.clips[1].end, 'the hum resumes after the queue drains');
  // shield 0: no hum, the clip plays at once
  const noShield = simulateGun({ writes: [{ t: 1000, frames: [play('VAA')] }], shield: [[0, 0]], humClip: 'A10', horizonMs: 5000 });
  assert.equal(noShield.clips[0].start, 1000);
  // the shield breaking releases a queue the hum held
  const broke = simulateGun({ writes: [{ t: 1000, frames: [play('VAA')] }], shield: [[0, 105], [4000, 0]], humClip: 'A10', horizonMs: 8000 });
  assert.equal(broke.clips[0].start, 4000);
});

test('rule 4: $LIFE grants and $HLOOP are silent', () => {
  const g = simulateGun({ writes: [{ t: 0, frames: ['$LIFE,0,0,10,*', '$HLOOP,1,*', play('VAA')] }], horizonMs: 3000 });
  assert.equal(g.clips.length, 1);
  assert.equal(g.clips[0].start, 2 * GUN_RULES.writeFrameGapMs);
});

test('every clip length matches the sound catalogue', () => {
  const cat = JSON.parse(readFileSync(new URL('../../mcp/brx_mcp/data/sound_catalog.json', import.meta.url), 'utf8'));
  const byId = Object.fromEntries(cat.sounds.map(s => [s.id, s]));
  for (const [id, ms] of Object.entries(CLIP_MS)) {
    assert.ok(byId[id], `${id} is in the catalogue`);
    assert.equal(ms, Math.round(byId[id].duration_s * 1000), `${id}`);
  }
});

test('the harness mirrors brx4\'s priority order (TODO: import it once brx4/announcer-queue lands)', () => {
  assert.deepEqual(ANNOUNCE_PRIORITY, ['kill_confirmed', 'lead_taken', 'lead_lost', 'hill_captured', 'hill_lost', 'powerup_swap',
    'alert', 'teammate_down', 'enemy_down', 'powerup_spawn', 'status']);
  assert.deepEqual([...MUST_HEAR].sort(), ['kill_confirmed', 'lead_lost', 'lead_taken']);
});

// ---------- 2. (A) the app today reproduces the field ----------
test('A: with the shield up, every kill confirm and medal is stuck behind the hum (tonight: the first kill had no cue)', () => {
  const a = runScenario(sc('halo-hum-kills'), 'A');
  const must = a.gun.clips.filter(c => WANT[c.cue] === 'must');
  assert.equal(must.length, 7);
  assert.ok(must.every(c => c.status === 'never'));
  const fb = runScenario(sc('first-blood-lead'), 'A');
  for (const cue of ['kill', 'first_blood', 'lead_taken']) assert.equal(one(fb, cue).status, 'never', cue);
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
    for (const c of B[s.id].gun.clips.filter(x => !x.must && x.start != null && x.cue !== 'shield_loop' && x.cue !== 'hill_tick' && !BODY.has(x.cue))) {
      assert.ok(c.latency <= ANNOUNCE_AUDIO_LATE_DEFAULT_MS + 100, `${c.cue} started ${c.latency} ms late`);
    }
    for (const c of B[s.id].gun.clips.filter(x => !x.must)) assert.notEqual(c.status, 'never', `${c.cue} stuck on the gun`);
  });
  test(`B ${s.id}: a line that is not must-hear goes only to a silent gun (at most one outstanding)`, () => {
    const clips = B[s.id].gun.clips;   // in arrival order
    for (const c of clips.filter(x => !x.must && !EXEMPT.has(x.cue))) {
      const ahead = clips.slice(0, clips.indexOf(c)).filter(o => o.status === 'never' || o.end > c.sentAt);
      assert.equal(ahead.length, 0, `${c.cue} at ${c.sentAt} went in behind ${ahead.map(o => o.cue).join(', ')}`);
    }
  });
  test(`B ${s.id}: no shield-down heartbeat while a must-hear line waits; no "shields online" line`, () => {
    assert.equal(B[s.id].mustPendingHeartbeats, 0);
    assert.equal(clipsOf(B[s.id], 'shield_online').length, 0);
  });
}

test('B halo-hum-kills: every kill line and medal is heard in full; kill lines inside 300 ms', () => {
  const b = B['halo-hum-kills'];
  const must = b.gun.clips.filter(c => c.must);
  assert.equal(must.length, 7);
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

test('B koth-capture-kill-lead: the kill confirm first, then the lead change, both in full', () => {
  const b = B['koth-capture-kill-lead'];
  const k = one(b, 'kill'), l = one(b, 'lead_taken');
  assert.ok(heardInFull(k) && heardInFull(l) && k.start < l.start);
  assert.ok(k.latency <= MUST_LATENCY_MS && l.latency <= 2500, `kill ${k.latency} ms, lead ${l.latency} ms`);
});
test('B koth-capture-kill-lead: "Hill Captured" is heard', { todo: 'B drops every non-must line while the hum blocks (docs/audio-queue-scenarios.md, finding B2)' }, () => {
  assert.ok(heardInFull(one(B['koth-capture-kill-lead'], 'hill_captured')));
});

test('B first-blood-lead: the kill line and the first-blood medal are heard in full', () => {
  const b = B['first-blood-lead'];
  assert.ok(heardInFull(one(b, 'kill')) && one(b, 'kill').latency <= MUST_LATENCY_MS);
  assert.ok(heardInFull(one(b, 'first_blood')));
});
test('B first-blood-lead: "Your team takes the lead" is heard', { todo: 'the lead item expires (4 s TTL) behind the kill and medal slots (finding B1)' }, () => {
  assert.ok(heardInFull(one(B['first-blood-lead'], 'lead_taken')));
});

test('B death-with-kill-queued: the low-health line never plays after the death', () => {
  for (const c of clipsOf(B['death-with-kill-queued'], 'low_health')) assert.ok(c.end <= 2000);
});
test('B death-with-kill-queued: my kill confirm is not cut by my own death', { todo: 'the F149 death $PLAYX stops whatever plays, here the kill line (finding B3)' }, () => {
  assert.ok(heardInFull(one(B['death-with-kill-queued'], 'kill')));
});

test('B koth-flap-standard: the kill line is heard in full, the stale "Hill Captured" is never said, "Hill Lost" is', () => {
  const b = B['koth-flap-standard'];
  assert.ok(heardInFull(one(b, 'kill')));
  assert.equal(clipsOf(b, 'hill_captured').length, 0);
  assert.ok(heardInFull(one(b, 'hill_lost')));
});

test('B standard-control: kill, first blood, double kill and the hill capture are all heard in full', () => {
  const b = B['standard-control'];
  for (const cue of ['kill', 'first_blood', 'double_kill', 'hill_captured']) for (const c of clipsOf(b, cue)) assert.ok(heardInFull(c), cue);
  assert.equal(clipsOf(b, 'kill').length, 1, 'the second kill is confirmed by its double-kill line, which replaces the plain line');
});
test('B standard-control: "Your team takes the lead" is heard', { todo: 'expires behind two kill items (finding B1)' }, () => {
  assert.ok(heardInFull(one(B['standard-control'], 'lead_taken')));
});

test('B: a pain grunt in the same hit as the shield break is not queued behind it', { todo: 'body sounds skip the one-outstanding rule; the grunt starts 2.6 s late (finding B4)' }, () => {
  for (const id of ['halo-heartbeat-kill', 'teammate-down-firefight', 'death-with-kill-queued']) {
    for (const c of B[id].gun.clips.filter(x => BODY.has(x.cue) && x.start != null)) assert.ok(c.latency <= ANNOUNCE_AUDIO_LATE_DEFAULT_MS, `${id}: ${c.cue} ${c.latency} ms`);
  }
});

// ---------- sensitivity: what B depends on that the bench has not measured ----------
test('B depends on Q1: if the hum restarts inside the gap between the last stop and the line, every must-hear line under the hum sticks until the NEXT flush', () => {
  const b = runScenario(sc('halo-hum-kills'), 'B', { ...GUN_RULES, humRestartMs: 0 });
  for (const c of b.gun.clips.filter(x => x.must)) assert.ok(c.status === 'never' || c.start - c.sentAt >= 500, `${c.cue}: waited ${c.start - c.sentAt} ms`);
  // the same run with the line written FIRST and the stops after it would not depend on Q1, but over-counting a stop
  // would then cut the line itself (docs/audio-queue-scenarios.md, Q1).
});
