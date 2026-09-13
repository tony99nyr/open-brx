// T1-B (2026-09-13 field evidence): the diagnostic log was a flat N-line ring (app.js `LOGMAX`, 400),
// and a long or chatty match rolled its OWN early lines out before MC's `pull_log` ever asked for
// them at the whistle — "the phone's log ring rolled a whole failing match out before it could be
// pulled". A `LogRing` never drops a line written since `startMatch()`, so a match's own lines
// survive to the recap ask no matter how long it runs or how much it logs before that; only lines
// from BEFORE the current match are trimmed, and only once they exceed `historyCap`. `hardCap` is
// the one absolute ceiling — a runaway per-tick logger must not grow the ring forever — and is far
// above anything a real match should ever write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LogRing } from '../src/logring.js';

test('a long match writing well past the old 400-line cap keeps every one of its own lines', () => {
  const ring = new LogRing({ historyCap: 400 });
  for (let i = 0; i < 50; i++) ring.push(`pre-match line ${i}`);   // lobby chatter before go-live
  ring.startMatch();
  // a 10-minute match logging roughly one line/second — 600 lines, well past the old 400 cap
  for (let i = 0; i < 600; i++) ring.push(`match line ${i}`);
  const { tail } = ring.tail(0);
  // the 50 lobby lines may be sacrificed once the ring's total size passes historyCap — that is the
  // trade the cap exists to make — but every one of the 600 MATCH lines must still be there
  const matchLines = tail.filter(l => l.startsWith('match line'));
  assert.equal(matchLines.length, 600, 'every line written since startMatch() must survive');
  assert.equal(matchLines[0], 'match line 0', 'the FIRST line of the match — the one a failing match needs most — must not have rolled out');
});

test('history before the current match still trims once it is stale, so the ring does not grow unbounded across a whole session', () => {
  const ring = new LogRing({ historyCap: 100 });
  for (let i = 0; i < 500; i++) ring.push(`old session line ${i}`);   // several finished matches' worth
  ring.startMatch();
  ring.push('new match line 0');
  const { tail } = ring.tail(0);
  const old = tail.filter(l => l.startsWith('old session line'));
  assert.ok(old.length <= 100, `stale pre-match history should be trimmed toward historyCap, got ${old.length}`);
  assert.ok(tail.includes('new match line 0'), 'the current match line must still be present');
});

test('a runaway logger inside the CURRENT match is still bounded by hardCap', () => {
  const ring = new LogRing({ historyCap: 400, hardCap: 1000 });
  ring.startMatch();
  for (let i = 0; i < 5000; i++) ring.push(`spam ${i}`);
  assert.ok(ring.lines.length <= 1000, 'hardCap is the one absolute ceiling, even mid-match');
  // it keeps the NEWEST lines, not the oldest, once the hard ceiling is the thing trimming
  assert.equal(ring.lines[ring.lines.length - 1], 'spam 4999');
});

test('tail(from) reports how many earlier lines were dropped, same contract as the old logSnapshot', () => {
  const ring = new LogRing({ historyCap: 5, hardCap: 5 });
  for (let i = 0; i < 5; i++) ring.push(`l${i}`);   // fills the ring; no startMatch() called, so it can still trim
  ring.push('l5');   // evicts l0
  const { tail, lost, through } = ring.tail(0);
  assert.equal(lost, 1);
  assert.equal(tail[0], 'l1');
  assert.equal(through, 6);
});
