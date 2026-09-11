// Control point (kind 5) tests — node --test. docs/spec/utility.md §5 row `control`, FOLLOWUPS K1.
//
// Every "nothing happened" assertion below is paired with a POSITIVE half on the same code path, because
// "no progress" is also exactly what a station with no control logic at all reports (F40,
// `guards-read-artefacts`): a guard that only checks the zero passes on a deleted feature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControlPoint, ControlAdvertiser, CONTROL_STATE, NEUTRAL, REFUSED_TID } from '../src/control.js';
import { encodeUuid, decodeUuid, PLAYER_STATE, TEAM_ANY } from '../src/beacon.js';

const RED = 0, BLUE = 1, GREEN = 3;     // the claimable tids: 2 is refused (F82), 4-7 are colours

/** A `Presence.players()` entry as utility.js sees one. */
function P(team, { id = 1, alive = true, present = true } = {}) {
  return { role: 'player', id, team, state: alive ? PLAYER_STATE.alive : 0, value: 0, present, rssi: -60 };
}
/** Run the point for `ms` in 250 ms steps, the cadence utility.js ticks at. Returns every event seen. */
function run(pt, players, ms, { step = 250, t0 = 1_000_000 } = {}) {
  const events = [];
  let now = pt.at == null ? t0 : pt.at;
  events.push(...pt.update(players, now).events);   // dt = 0, but the roster edges still fire on it
  for (let i = 0; i < Math.round(ms / step); i++) { now += step; events.push(...pt.update(players, now).events); }
  return events;
}
const held = pt => !!(pt.advert().state & CONTROL_STATE.held);

// ---------- rate = the NET difference of living, present players ----------

test('control: 1v0 converts a neutral point at the base rate', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED)], 5000);
  assert.ok(Math.abs(pt.progress - 50) < 1, `10 %/s for 5 s ≈ 50%, got ${pt.progress}`);
  assert.equal(pt.owner, NEUTRAL, 'not captured yet — no flip before 100');
  assert.equal(pt.capturing, RED, 'RED owns the bar while it builds');
  run(pt, [P(RED)], 5000);
  assert.equal(pt.owner, RED, '10 s at 10 %/s captures it');
  assert.equal(pt.progress, 100);
});

test('control: 2v0 converts at exactly TWICE the 1v0 rate', () => {
  const one = new ControlPoint({ captureS: 10 }); run(one, [P(RED, { id: 1 })], 4000);
  const two = new ControlPoint({ captureS: 10 }); run(two, [P(RED, { id: 1 }), P(RED, { id: 2 })], 4000);
  assert.ok(Math.abs(one.progress - 40) < 1, `1v0 ≈ 40%, got ${one.progress}`);
  assert.ok(Math.abs(two.progress - 80) < 1, `2v0 ≈ 80%, got ${two.progress}`);
  assert.ok(Math.abs(two.progress - 2 * one.progress) < 1, 'net 2 is exactly twice net 1');
});

test('control: 2v1 converts at the 1v0 rate — the NET difference, not a freeze', () => {
  const solo = new ControlPoint({ captureS: 10 }); run(solo, [P(RED, { id: 1 })], 4000);
  const push = new ControlPoint({ captureS: 10 });
  run(push, [P(RED, { id: 1 }), P(RED, { id: 2 }), P(BLUE, { id: 3 })], 4000);
  assert.ok(Math.abs(push.progress - solo.progress) < 1, `2v1 must move like 1v0 (${push.progress} vs ${solo.progress})`);
  assert.equal(push.net, 1, 'net is the lead, in players');
  assert.ok(push.contested, 'and it is contested the whole time — contested does NOT freeze it');
});

test('control: 1v1 nets zero and nothing moves (and the same pair minus one DOES move)', () => {
  const even = new ControlPoint({ captureS: 10 });
  run(even, [P(RED, { id: 1 }), P(BLUE, { id: 2 })], 8000);
  assert.equal(even.progress, 0, 'an even count nets zero');
  assert.equal(even.net, 0);
  assert.equal(even.dir, 0, 'and the bar is static, not rising');
  // The positive half: zero progress must not be what this code ALWAYS reports.
  const odd = new ControlPoint({ captureS: 10 });
  run(odd, [P(RED, { id: 1 })], 8000);
  assert.ok(odd.progress > 70, `the same push without the defender converts (got ${odd.progress})`);
});

test('control: net is the LARGEST SINGLE rival, never the sum — so 2v1v1 converts slowly (spec §5d.1)', () => {
  // In a TWO-team game "largest single rival" and "the sum of the others" are indistinguishable, which is
  // why this needs its own test: with three teams on the point the two readings disagree, and only the
  // largest-single reading lets a pair convert against two opponents split across two teams.
  const three = new ControlPoint({ captureS: 10 });
  run(three, [P(RED, { id: 1 }), P(RED, { id: 2 }), P(BLUE, { id: 3 }), P(GREEN, { id: 4 })], 4000);
  assert.equal(three.net, 1, '2 v 1 v 1 nets 1 (2 - 1), not 0 (2 - 2)');
  assert.ok(three.progress > 30, `so the pair converts, slowly (got ${three.progress})`);
  // and one rival team of EQUAL size does stall it, which is the other half of the same rule
  const even = new ControlPoint({ captureS: 10 });
  run(even, [P(RED, { id: 1 }), P(RED, { id: 2 }), P(BLUE, { id: 3 }), P(BLUE, { id: 4 }), P(GREEN, { id: 5 })], 4000);
  assert.equal(even.net, 0, '2 v 2 v 1 stalls');
  assert.equal(even.progress, 0);
  const three2 = new ControlPoint({ captureS: 10 });
  run(three2, [P(RED, { id: 1 }), P(RED, { id: 2 }), P(RED, { id: 3 }), P(BLUE, { id: 4 }), P(BLUE, { id: 5 }), P(GREEN, { id: 6 })], 2000);
  assert.equal(three2.net, 1, '3 v 2 v 1 converts');
});

test('control: a tie for the lead nets zero and net is never negative (spec §5d.1)', () => {
  const tie = new ControlPoint({ captureS: 10 });
  run(tie, [P(RED, { id: 1 }), P(BLUE, { id: 2 }), P(GREEN, { id: 3 })], 6000);
  assert.equal(tie.net, 0, 'three teams one each: nobody leads');
  assert.equal(tie.progress, 0);
  // A lone HOLDER facing two separate rivals stalls rather than being drained (the FFA case in §5d.1).
  const ffa = new ControlPoint({ captureS: 10 });
  run(ffa, [P(RED)], 10000);
  assert.equal(ffa.owner, RED);
  run(ffa, [P(RED, { id: 1 }), P(BLUE, { id: 2 }), P(GREEN, { id: 3 })], 6000);
  assert.equal(ffa.progress, 100, 'RED nets 1-1=0, so its point stalls at full rather than draining');
  assert.ok(ffa.net >= 0, 'net is never negative');
  // Positive half: one of the rivals brings a friend and the point DOES start to drain.
  run(ffa, [P(RED, { id: 1 }), P(BLUE, { id: 2 }), P(BLUE, { id: 4 }), P(GREEN, { id: 3 })], 3000);
  assert.ok(ffa.progress < 100, `2 BLUE against 1 RED and 1 GREEN drains it (got ${ffa.progress})`);
});

test('control: net is clamped to netCap, so a rush is fast and not instant (spec §5d.1)', () => {
  const many = [1, 2, 3, 4, 5, 6].map(id => P(RED, { id }));
  const capped = new ControlPoint({ captureS: 10, netCap: 3 });
  run(capped, [...many], 2000);
  assert.equal(capped.net, 3, 'six attackers count as three');
  assert.ok(Math.abs(capped.progress - 60) < 2, `so 2 s moves 60%, not 120 (got ${capped.progress})`);
  // The positive half: raise the cap and the SAME six players do move faster, so the clamp is a clamp and
  // not a hard-coded ceiling on the rate.
  const loose = new ControlPoint({ captureS: 10, netCap: 6 });
  run(loose, [...many], 1000);
  assert.equal(loose.net, 6);
  assert.ok(Math.abs(loose.progress - 60) < 2, `six uncapped move 60% in 1 s (got ${loose.progress})`);
});

test('control: capture_s is the knob, and the rate it implies is 100/capture_s per net player (spec §5d.1)', () => {
  const fast = new ControlPoint({ captureS: 4 });
  assert.equal(fast.rate, 25);
  run(fast, [P(RED)], 4000);
  assert.equal(fast.owner, RED, 'capture_s 4 means one phase takes 4 s at net 1');
  const slow = new ControlPoint({ captureS: 20 });
  run(slow, [P(RED)], 4000);
  assert.ok(Math.abs(slow.progress - 20) < 1, `capture_s 20 is a fifth as fast (got ${slow.progress})`);
  assert.equal(slow.owner, NEUTRAL);
});

test('control: the capture log records every crossing, both ways, and survives a restart (spec §5d.6)', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED)], 10000);
  assert.deepEqual(pt.log.map(e => [e.from, e.to]), [[null, RED]], 'a neutral point taken from nobody');
  run(pt, [P(BLUE)], 10000);
  assert.deepEqual(pt.log.map(e => [e.from, e.to]), [[null, RED], [RED, null]], 'then RED losing it to neutral');
  run(pt, [P(BLUE)], 10000);
  assert.deepEqual(pt.log.map(e => [e.from, e.to]), [[null, RED], [RED, null], [RED, BLUE]], 'then BLUE completing the steal');
  assert.ok(pt.log.every(e => Number.isFinite(e.t)), 'every entry is stamped');
  assert.deepEqual(new ControlPoint().restore(pt.snapshot()).log.map(e => [e.from, e.to]),
    [[null, RED], [RED, null], [RED, BLUE]], 'and the whole log comes back after a restart');
  assert.deepEqual(new ControlPoint().log, [], 'a fresh point has no log');
});

test('control: a DOWN player on the point contributes nothing — and the same player alive does', () => {
  const down = new ControlPoint({ captureS: 10 });
  run(down, [P(RED, { id: 1, alive: false })], 6000);
  assert.equal(down.progress, 0, 'a body on the point is not a capture');
  assert.equal(down.counts[RED], undefined, 'and it is not counted at all');
  const up = new ControlPoint({ captureS: 10 });
  run(up, [P(RED, { id: 1, alive: true })], 6000);
  assert.ok(up.progress > 50, `the SAME player alive converts (got ${up.progress})`);
  assert.equal(up.counts[RED], 1);
  // And a down defender cannot hold a point either: 1 alive vs 1 down is 1v0, not 1v1.
  const mixed = new ControlPoint({ captureS: 10 });
  run(mixed, [P(RED, { id: 1 }), P(BLUE, { id: 2, alive: false })], 6000);
  assert.ok(mixed.progress > 50, 'a DOWN defender does not contest');
  assert.equal(mixed.contested, false);
});

test('control: a player outside the bubble contributes nothing — and the same player present does', () => {
  const far = new ControlPoint({ captureS: 10 });
  run(far, [P(RED, { id: 1, present: false })], 6000);
  assert.equal(far.progress, 0, 'in radio range is not on the point');
  const near = new ControlPoint({ captureS: 10 });
  run(near, [P(RED, { id: 1, present: true })], 6000);
  assert.ok(near.progress > 50, `the SAME player present converts (got ${near.progress})`);
});

// ---------- two phases: drain to neutral, THEN build. Never a flip ----------

test('control: an enemy-held point DRAINS to neutral first and only then builds — no instant flip', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED)], 10000);
  assert.equal(pt.owner, RED, 'precondition: RED holds it');

  const seen = run(pt, [P(BLUE)], 5000);
  assert.equal(pt.owner, RED, 'halfway through the drain RED STILL holds it — this is the no-flip rule');
  assert.ok(Math.abs(pt.progress - 50) < 1, `draining, not flipping (got ${pt.progress})`);
  assert.equal(pt.dir, -1, 'and the bar is visibly falling');
  assert.equal(seen.length, 0, 'nothing has changed hands yet');

  const toNeutral = run(pt, [P(BLUE)], 5000);
  assert.equal(pt.owner, NEUTRAL, 'at 0 the point is NOBODY’s');
  assert.equal(held(pt), false);
  const n = toNeutral.find(e => e.type === 'neutralised');
  assert.ok(n && n.team === RED && n.by === BLUE, 'RED lost it to BLUE at zero');
  assert.ok(!toNeutral.some(e => e.type === 'captured'), 'and BLUE has NOT captured it at the same instant');

  const toBlue = run(pt, [P(BLUE)], 10000);
  assert.equal(pt.owner, BLUE, 'a further 10 s of building hands it over');
  const c = toBlue.find(e => e.type === 'captured');
  assert.ok(c && c.team === BLUE && c.from === RED, 'and the capture names who was robbed');
});

test('control: stealing a held point costs twice a neutral one (the 200-vs-100 unit rule)', () => {
  const fresh = new ControlPoint({ captureS: 10 });
  run(fresh, [P(RED)], 10000);
  assert.equal(fresh.owner, RED, 'a neutral point falls in 10 s');
  const steal = new ControlPoint({ captureS: 10 });
  run(steal, [P(RED)], 10000);
  run(steal, [P(BLUE)], 10000);
  assert.notEqual(steal.owner, BLUE, 'ten seconds only got BLUE to neutral');
  run(steal, [P(BLUE)], 10000);
  assert.equal(steal.owner, BLUE, 'twenty takes it');
});

test('control: a step that crosses zero carries its work into the new phase and never reads as stalled', () => {
  // Caught on the real screen (tools/screens.mjs #54): the tick on which a point crossed zero used to
  // report dir 0, so a defender watched "RED STALLED AT 0%" with RED standing on the point, and the step's
  // remaining work was thrown away at the boundary.
  const pt = new ControlPoint({ captureS: 10 }).restore({ owner: RED, progress: 1 });   // RED holds it, barely
  pt.update([P(BLUE)], 1_000_000);
  const r = pt.update([P(BLUE)], 1_000_250);       // 2.5 units: 1 drains it to neutral, 1.5 builds BLUE
  assert.ok(r.events.some(e => e.type === 'neutralised'), 'RED lost it');
  assert.equal(pt.owner, NEUTRAL);
  assert.equal(pt.capturing, BLUE, 'BLUE now owns the bar');
  assert.ok(Math.abs(pt.progress - 1.5) < 0.01, `the overshoot became BLUE's progress (got ${pt.progress})`);
  assert.equal(pt.dir, 1, 'and it reads as RISING for BLUE on that very tick, not stalled');
  assert.ok(!!(pt.advert().state & CONTROL_STATE.rising), 'which is what goes out on the wire');
  // The positive half for the other boundary: a step that hits 100 stops there and reads as HELD, not rising.
  const cap = new ControlPoint({ captureS: 10 }).restore({ owner: NEUTRAL, capturing: BLUE, progress: 99 });
  cap.update([P(BLUE)], 1_000_000); cap.update([P(BLUE)], 1_000_250);
  assert.equal(cap.owner, BLUE); assert.equal(cap.progress, 100);
  assert.equal(cap.dir, 0, 'a point pinned at 100 for its owner is held, not rising');
});

test('control: a contender pushed back off a half-built bar loses the build, and the defender rebuilds', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED)], 10000);            // RED holds it
  run(pt, [P(BLUE)], 10000);           // drained to neutral, BLUE holds the bar at 0
  run(pt, [P(BLUE)], 5000);            // BLUE builds to 50
  assert.equal(pt.capturing, BLUE); assert.ok(Math.abs(pt.progress - 50) < 1);
  run(pt, [P(RED, { id: 9 })], 3000);  // RED pushes BLUE's build back down
  assert.ok(Math.abs(pt.progress - 20) < 1, `BLUE's build drains (got ${pt.progress})`);
  assert.equal(pt.owner, NEUTRAL, 'still nobody’s');
  run(pt, [P(RED, { id: 9 })], 12000);
  assert.equal(pt.owner, RED, 'and RED takes it back through zero');
});

// ---------- contested ----------

test('control: contested is a measured edge with both halves, and it appears in the advert', () => {
  const pt = new ControlPoint({ captureS: 10 });
  const a = run(pt, [P(RED, { id: 1 })], 1000);
  assert.equal(pt.contested, false, 'one team alone is not contested');
  assert.equal(!!(pt.advert().state & CONTROL_STATE.contested), false);
  assert.ok(!a.some(e => e.type === 'contested'));

  const b = run(pt, [P(RED, { id: 1 }), P(BLUE, { id: 2 })], 1000);
  assert.equal(pt.contested, true, 'two teams on it IS contested');
  assert.ok(!!(pt.advert().state & CONTROL_STATE.contested), 'and it goes out on the wire (byte 10 bit 1)');
  assert.equal(b.filter(e => e.type === 'contested').length, 1, 'the edge fires exactly once, not every tick');

  const c = run(pt, [P(RED, { id: 1 })], 1000);
  assert.equal(pt.contested, false, 'the defender leaving clears it');
  assert.equal(c.filter(e => e.type === 'uncontested').length, 1);
});

// ---------- F82: tid 2 ----------

test('control: F82 — a tid-2 team can never take or hold a point, and tid 0/1/3 can', () => {
  const two = new ControlPoint({ captureS: 10 });
  const ev = run(two, [P(REFUSED_TID, { id: 1 }), P(REFUSED_TID, { id: 2 })], 20000);
  assert.equal(two.owner, NEUTRAL, 'a tid-2 push converts nothing');
  assert.equal(two.progress, 0);
  assert.equal(two.advert().team, NEUTRAL, 'and the advert never NAMES team 2 as the owner');
  assert.equal(ev.filter(e => e.type === 'refused').length, 1, 'the operator is told once, not per tick');
  assert.equal(two.refusedSeen, true);
  // The decidable-roster control: the SAME push on a claimable tid converts, so "nothing happened" above
  // is the refusal and not a dead state machine.
  for (const tid of [RED, BLUE, GREEN]) {
    const ok = new ControlPoint({ captureS: 10 });
    run(ok, [P(tid, { id: 1 }), P(tid, { id: 2 })], 20000);
    assert.equal(ok.owner, tid, `tid ${tid} takes the same point`);
    assert.equal(ok.advert().team, tid);
  }
});

test('control: F82 — a tid-2 player cannot CONTEST a point either (they are not on the wire at all)', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED, { id: 1 }), P(REFUSED_TID, { id: 2 })], 6000);
  assert.equal(pt.contested, false, 'a refused team cannot deny a point it could never hold');
  assert.ok(pt.progress > 50, `RED converts through them (got ${pt.progress})`);
  // Positive half: a CLAIMABLE second team on the same roster does contest and does slow it down.
  const real = new ControlPoint({ captureS: 10 });
  run(real, [P(RED, { id: 1 }), P(BLUE, { id: 2 })], 6000);
  assert.equal(real.contested, true);
  assert.equal(real.progress, 0);
});

test('control: a colour tid (4-7) has no claim, but tid 3 does', () => {
  const colour = new ControlPoint({ captureS: 10 });
  run(colour, [P(6)], 6000);
  assert.equal(colour.progress, 0, 'tids 4-7 are colours, not teams');
  const green = new ControlPoint({ captureS: 10 });
  run(green, [P(GREEN)], 6000);
  assert.ok(green.progress > 50, 'tid 3 is a real team');
});

// ---------- the advert bytes ----------

test('control: byte 9 + the held bit make "RED owns it" and "RED is taking it" different states', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED)], 4000);
  let v = pt.advert();
  assert.equal(v.team, RED, 'byte 9 names whose progress the bar is');
  assert.equal(v.state & CONTROL_STATE.held, 0, 'but NOT held: nobody owns it at 40%');
  assert.ok(v.state & CONTROL_STATE.rising);
  assert.ok(Math.abs(v.value - 40) <= 1, 'byte 11 is the progress percent');
  run(pt, [P(RED)], 6000);
  v = pt.advert();
  assert.equal(v.team, RED);
  assert.ok(v.state & CONTROL_STATE.held, 'at 100 it is held');
  assert.equal(v.value, 100);
  assert.equal(v.state & CONTROL_STATE.rising, 0, 'a point pinned at 100 is held, not still rising');
});

test('control: the advert triple survives the 16-byte codec round trip', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(BLUE, { id: 1 }), P(BLUE, { id: 2 }), P(RED, { id: 3 })], 3000);
  const v = pt.advert();
  const d = decodeUuid(encodeUuid({ role: 'station', id: 42, kind: 'control', ...v, seq: 7, game: 0, threshold: -74 }));
  assert.equal(d.kind, 'control');
  assert.equal(d.team, v.team); assert.equal(d.state, v.state); assert.equal(d.value, v.value);
  assert.ok(d.state & CONTROL_STATE.contested, 'contested rides through the wire');
  assert.ok(d.state & CONTROL_STATE.rising, 'so does the direction');
});

test('control: timeToChange() is the seconds a defender has, and it halves when the push doubles', () => {
  const one = new ControlPoint({ captureS: 10 }); run(one, [P(RED, { id: 1 })], 2000);
  const two = new ControlPoint({ captureS: 10 }); run(two, [P(RED, { id: 1 }), P(RED, { id: 2 })], 1000);
  assert.ok(Math.abs(one.progress - two.progress) < 1, 'same progress, different push');
  assert.ok(Math.abs(one.timeToChange() - 2 * two.timeToChange()) < 0.2, `twice the players, half the time (${one.timeToChange()} vs ${two.timeToChange()})`);
  const idle = new ControlPoint({ captureS: 10 }); run(idle, [], 2000);
  assert.equal(idle.timeToChange(), null, 'nothing moving has no eta');
});

// ---------- persistence ----------

test('control: progress AND owner survive a restart, and a fresh point does not inherit them', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED)], 10000);          // RED holds it
  run(pt, [P(BLUE)], 4000);          // drained to 60
  const saved = JSON.parse(JSON.stringify(pt.snapshot()));

  const back = new ControlPoint({ captureS: 10 }).restore(saved);
  assert.equal(back.owner, RED, 'the owner came back');
  assert.ok(Math.abs(back.progress - 60) < 1, `the progress came back (got ${back.progress})`);
  assert.ok(back.advert().state & CONTROL_STATE.held, 'and it still reads as held');
  // And it keeps going from there rather than restarting the drain.
  run(back, [P(BLUE)], 6000);
  assert.equal(back.owner, NEUTRAL, 'six more seconds of draining finishes the job it was part-way through');

  // The positive half: a point that was NOT restored starts blank, so the check above is not reading a
  // default that happens to look right.
  const blank = new ControlPoint({ captureS: 10 });
  assert.equal(blank.owner, NEUTRAL); assert.equal(blank.progress, 0);
  assert.equal(new ControlPoint({ captureS: 10 }).restore(null).progress, 0, 'a junk restore is blank, not a throw');
});

test('control: a restore can never bring back a tid-2 owner (F82 survives the round trip)', () => {
  const back = new ControlPoint().restore({ owner: REFUSED_TID, progress: 100, capturing: REFUSED_TID });
  assert.equal(back.owner, NEUTRAL, 'a hand-edited or stale save cannot install team 2 as the owner');
  assert.equal(back.capturing, null);
  const ok = new ControlPoint().restore({ owner: BLUE, progress: 100 });
  assert.equal(ok.owner, BLUE, 'a real owner does come back');
});

test('control: a backgrounded station does not hand over the point on its first tick back', () => {
  const pt = new ControlPoint({ captureS: 10 });
  pt.update([P(RED)], 1_000_000);
  pt.update([P(RED)], 1_000_000 + 600_000);   // ten minutes asleep
  assert.ok(pt.progress <= 10 + 0.01, `one step is capped at 1 s of play, got ${pt.progress}`);
  // Positive half: ten real seconds of ticking DOES capture it.
  const awake = new ControlPoint({ captureS: 10 });
  run(awake, [P(RED)], 10000);
  assert.equal(awake.owner, RED);
});

// ---------- seq / republish policy ----------

test('control: seq bumps on every published change, and a progress-only change is rate-limited', () => {
  const ad = new ControlAdvertiser({ minIntervalMs: 1000 });
  const v = (team, state, value) => ({ team, state, value });
  let now = 1000;
  assert.equal(ad.due(v(NEUTRAL, 0, 0), now), 'first', 'the first advert always goes out');
  assert.equal(ad.published(v(NEUTRAL, 0, 0), now), 1, 'seq starts at 1');
  assert.equal(ad.due(v(NEUTRAL, 0, 0), now), null, 'nothing changed: no republish, no seq bump');
  assert.equal(ad.seq, 1);

  now += 100;
  assert.equal(ad.due(v(RED, CONTROL_STATE.rising, 3), now), 'state', 'a team/state change is urgent, not rate-limited');
  assert.equal(ad.published(v(RED, CONTROL_STATE.rising, 3), now), 2, 'and it bumps seq');

  now += 250;
  assert.equal(ad.due(v(RED, CONTROL_STATE.rising, 6), now), null, 'progress alone, too soon: hold the advert');
  now += 800;
  assert.equal(ad.due(v(RED, CONTROL_STATE.rising, 6), now), 'progress', 'past the interval it goes out');
  assert.equal(ad.published(v(RED, CONTROL_STATE.rising, 6), now), 3);

  // contested is a state, so it must NOT wait for the rate limit — that is the whole point of the split.
  now += 10;
  assert.equal(ad.due(v(RED, CONTROL_STATE.rising | CONTROL_STATE.contested, 6), now), 'state');
});

test('control: seq wraps at a byte rather than escaping byte 12', () => {
  const ad = new ControlAdvertiser();
  for (let i = 0; i < 300; i++) ad.published({ team: i & 3, state: 0, value: i & 0x7f }, i * 2000);
  assert.ok(ad.seq >= 0 && ad.seq <= 255, `seq stayed inside a byte (got ${ad.seq})`);
  assert.equal(ad.seq, 300 & 0xff);
});

// ---------- the reading the screen animates ----------

test('control: the station knows who is contributing and who is down, per team', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED, { id: 1 }), P(RED, { id: 2 }), P(RED, { id: 3, alive: false }), P(BLUE, { id: 4 }), P(BLUE, { id: 5, present: false })], 1000);
  assert.deepEqual(pt.counts, { [RED]: 2, [BLUE]: 1 }, 'the down RED and the far BLUE are not counted');
  assert.equal(pt.lead, RED);
  assert.equal(pt.net, 1);
  assert.equal(pt.contested, true);
  assert.equal(pt.dir, 1, 'and the bar is rising for RED');
});

test('control: possession time is tallied per team for the station’s own recap', () => {
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED)], 10000);
  const atCapture = pt.holdMs[RED] || 0;
  run(pt, [P(RED)], 5000);
  assert.ok((pt.holdMs[RED] || 0) - atCapture >= 4500, `RED accrued its hold time (got ${pt.holdMs[RED] - atCapture} ms)`);
  assert.equal(pt.holdMs[BLUE], undefined, 'a team that never held it has no tally');
  assert.ok((new ControlPoint().restore(pt.snapshot()).holdMs[RED] || 0) > 0, 'and the tally survives a restart');
});

// ---------- F103: possession is elapsed time; the F82 banner follows the player ----------

test('control: F103 — possession is credited in ELAPSED time, while conversion stays clamped per tick', () => {
  // `holdMs` used to add the same 1 s-clamped `dtMs` that bounds capture work, so a throttled or backgrounded
  // station that held the point for a minute credited its owner ONE SECOND -- a plausible wrong number in the
  // one figure the match is scored on. The two clocks are separate now.
  const pt = new ControlPoint({ captureS: 10 });
  run(pt, [P(RED)], 10000);
  assert.equal(pt.owner, RED);
  const t0 = pt.at, before = pt.holdMs[RED] || 0;   // captured on the last tick: nothing accrued yet
  pt.update([P(RED)], t0 + 60_000);                      // one tick, a minute later: the phone was throttled
  assert.ok(pt.holdMs[RED] - before >= 60_000 - 1, `a minute held is a minute credited (got ${pt.holdMs[RED] - before})`);
  // CONTROL: conversion over the same gap is still clamped -- the sleeping-station guard is intact.
  const blue = new ControlPoint({ captureS: 10 });
  blue.update([P(BLUE)], 1_000_000);
  blue.update([P(BLUE)], 1_000_000 + 60_000);
  assert.ok(blue.progress <= 10 + 0.01, `one step is still capped at 1 s of capture work (got ${blue.progress})`);
  assert.equal(blue.holdMs[BLUE], undefined, 'and nobody is credited for a point nobody owns');
});

test('control: F103 — reassigning the tid-2 player off team 2 takes the F82 banner down within the match', () => {
  const pt = new ControlPoint({ captureS: 10 });
  const ev = run(pt, [P(REFUSED_TID, { id: 1 })], 2000);
  assert.equal(ev.filter(e => e.type === 'refused').length, 1);
  assert.equal(pt.refusedSeen, true, 'banner up while they stand here on tid 2');
  run(pt, [P(BLUE, { id: 1 })], 500);                    // the operator moved them to blue in Mission Control
  assert.equal(pt.refusedSeen, false, 'banner down: nobody on tid 2 is here any more');
  // told again if a refused player comes BACK -- the hazard is present again, not a stale latch
  const again = run(pt, [P(REFUSED_TID, { id: 1 })], 500);
  assert.equal(again.filter(e => e.type === 'refused').length, 1);
  assert.equal(pt.refusedSeen, true);
});
