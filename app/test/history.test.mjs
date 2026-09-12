// Per-match history + the A24 result patch (src/history.js, wired in app.js's engine.onResult).
// The logic lives in its own module precisely so these can exist: app.js touches `document` and the
// Capacitor bridge at module scope and cannot be imported here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyResult, findEntry, HISTORY_MAX } from '../src/history.js';

const entry = (match_id, extra = {}) => ({ t: 1, match_id, mode: 'tdm', kills: null, outcome: null, ...extra });

test('history: the result patches the NEWEST entry sharing a match_id, not the oldest', () => {
  // MC restarted onto the same id, or a match was replayed. `findIndex` patched the FIRST match — a game
  // from an earlier session took this one's outcome, and this one kept its nulls forever.
  const h = [entry('m1', { kills: 3 }), entry('m2'), entry('m1', { kills: 9 })];
  const { history, appended } = applyResult(h, { match_id: 'm1', outcome: 'win', my: { kills: 9, medals: ['ace'] } }, { ended: true });
  assert.equal(appended, false);
  assert.equal(history[0].outcome, null, 'the older game with the same id was overwritten');
  assert.equal(history[0].kills, 3);
  assert.equal(history[2].outcome, 'win');
  assert.deepEqual(history[2].medals, ['ace']);
  assert.equal(findEntry(history, 'm1'), 2);
  assert.equal(findEntry(history, 'nope'), -1);
});

test('history: a result with no entry left is APPENDED after the whistle, and ignored before it', () => {
  // Before the whistle the engine's own `historyEntry()` folds the result in a moment later. Appending
  // here would leave two entries for one match — a second game in the session tally.
  const early = applyResult([], { match_id: 'm9', outcome: 'win' }, { ended: false });
  assert.equal(early.changed, false);
  assert.equal(early.history.length, 0);

  // After the whistle nothing else will ever write this match down: the entry rolled out of the 50-cap,
  // or its write failed. The old code returned and MC's only word on the match was lost in silence.
  const late = applyResult([entry('other')], { match_id: 'm9', outcome: 'lose', win_by: 'time', my: { kills: 4, accuracy: 0.31 } },
                           { ended: true, mode: 'ctf', session: 's7', now: () => 1234 });
  assert.equal(late.appended, true);
  assert.equal(late.history.length, 2);
  const e = late.history[1];
  assert.equal(e.match_id, 'm9');
  assert.equal(e.t, 1234);
  assert.equal(e.mode, 'ctf');
  assert.equal(e.session, 's7');
  assert.equal(e.outcome, 'lose');
  assert.equal(e.win_by, 'time');
  assert.equal(e.kills, 4);
  assert.equal(e.accuracy, 0.31);
  assert.equal(e.best_streak, null, 'a field MC did not send is missing, never invented');
});

test('history: an appended entry still respects the 50-match cap', () => {
  const h = Array.from({ length: HISTORY_MAX }, (_, i) => entry('m' + i));
  const { history } = applyResult(h, { match_id: 'gone', outcome: 'win' }, { ended: true });
  assert.equal(history.length, HISTORY_MAX);
  assert.equal(history[0].match_id, 'm1', 'the oldest shifted out');
  assert.equal(history[HISTORY_MAX - 1].match_id, 'gone');
});

test('history: a result with no match_id, or a junk history, changes nothing', () => {
  assert.equal(applyResult([entry('m1')], { outcome: 'win' }, { ended: true }).changed, false);
  assert.equal(applyResult([entry('m1')], null, { ended: true }).changed, false);
  assert.deepEqual(applyResult(null, { match_id: 'm1', outcome: 'win' }, { ended: false }).history, []);
});

test('history: MC keeps what it sent and the entry keeps the rest (nulls never clobber)', () => {
  const h = [entry('m1', { kills: 7, assists: 2, medals: ['sharpshooter'], team_scores: [3, 1] })];
  const { history } = applyResult(h, { match_id: 'm1', outcome: 'win', my: { kills: null, medals: [] } }, { ended: true });
  assert.equal(history[0].kills, 7, 'a null from MC must not erase what the node counted');
  assert.equal(history[0].assists, 2);
  assert.deepEqual(history[0].medals, ['sharpshooter'], 'an empty medal list is "not computed", not "none"');
  assert.deepEqual(history[0].team_scores, [3, 1]);
});

test('history: app.js actually routes engine.onResult through this module', () => {
  // Guards read artefacts: without this the module above could be perfect and dead.
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /engine\.onResult = [^]*?applyResult\(hud\.history \|\| \[\], r, \{/, 'engine.onResult no longer calls applyResult');
  assert.match(app, /ended: !!engine\.ended/, 'the whistle flag is what decides append-vs-wait — app.js must pass it');
  assert.doesNotMatch(app, /h\.findIndex\(g => g && g\.match_id/, 'the old oldest-match-wins patch is back in app.js');
});
