// Architecture round 2, item 8: the player advert director (src/advert-director.js), pure, so every decision runs here.
// The scripted sequence at the end pins the plugin calls and log lines that app.js's syncPlayerAdvert made BEFORE the move
// (derived by running a verbatim copy of that function on the same script), so the refactor changes no behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdvertGate, ADVERT_FAIL_BACKOFF_MS, ADVERT_START_MIN_MS, encodeUuid } from '../src/beacon.js';
import { directAdvert, settleAdvert, advertFailLog, advertSnapshotNeeded, newAdvertDirector } from '../src/advert-director.js';

const CONFIG = { stations: [{ id: 4 }], game_byte: 9 };
const live = (o = {}) => ({ phase: 'live', playerNum: 7, alive: true, powerupClaim: null, ...o });
const uuid = (o = {}) => encodeUuid({ role: 'player', id: 7, team: 1, state: 1, value: 0, game: 9, ...o });

/** What app.js does around the director: one tick, with `fail` making the plugin call throw. */
function makeApp() {
  const gate = new AdvertGate(); let dir = newAdvertDirector(); let busy = false;
  const calls = [], logs = [], stats = { starts: 0, stops: 0, fails: 0, reasserts: 0, lastReason: null };
  async function tick({ st, now, opens = 0, config = CONFIG, tid = 1, fail = false, hold = null }) {
    if (busy) return null;
    if (!advertSnapshotNeeded(config, gate)) return null;
    const d = directAdvert({ st, config, tid, scanOpens: opens, dir, gate, now });
    dir = d.dir; if (d.refreshGate) gate.refresh();
    if (!d.action) return d;
    busy = true; stats.lastReason = d.reason;
    let ok = true;
    try {
      if (d.action === 'start') { calls.push(['start', d.uuid, d.mode]); if (hold) await hold; if (fail) throw new Error('boom'); }
      else { calls.push(['stop']); if (hold) await hold; }
      logs.push([d.okLog, 'li']);
    } catch (e) { ok = false; logs.push([advertFailLog(e), 'le']); }
    const s = settleAdvert(d, ok); dir = s.dir;
    if (s.gate === 'started') gate.started(d.uuid, now); else if (s.gate === 'stopped') gate.stopped(); else gate.failed(d.action, now);
    for (const k of Object.keys(s.stats)) stats[k] += s.stats[k];
    busy = false; return d;
  }
  return { tick, gate, calls, logs, stats, get dir() { return dir; }, get busy() { return busy; } };
}

test('(a) dead-player race: the failed start backs off, retries after ADVERT_FAIL_BACKOFF_MS, never re-asserts alive=1', async () => {
  const app = makeApp();
  await app.tick({ st: live(), now: 0 });                                   // alive advert on air
  const t0 = 1000;
  const d = await app.tick({ st: live({ alive: false }), now: t0, fail: true });   // the death clears the alive bit; the start throws
  assert.equal(d.action, 'start');
  assert.match(d.reason, /state alive -> down/);
  assert.equal(app.stats.fails, 1);
  for (let t = t0 + 250; t < t0 + ADVERT_FAIL_BACKOFF_MS; t += 250) {
    const r = await app.tick({ st: live({ alive: false }), now: t });
    assert.equal(r.action, null, `no retry at +${t - t0} ms`);
  }
  assert.equal(app.calls.length, 2, 'the first start and the failed one, nothing in between');
  const r = await app.tick({ st: live({ alive: false }), now: t0 + ADVERT_FAIL_BACKOFF_MS });
  assert.equal(r.action, 'start');
  assert.equal(r.uuid, uuid({ state: 0 }), 'the retry carries the down advert');
  for (const c of app.calls.slice(1)) assert.notEqual(c[1], uuid({ state: 1 }), 'the old alive=1 advert is never sent again');
  assert.equal(app.gate.last, uuid({ state: 0 }));
});

test('(b) reopen race: a reopen with an unchanged advert re-asserts; a reopen during an in-flight start is not lost', async () => {
  const app = makeApp();
  await app.tick({ st: live(), now: 0, opens: 0 });
  const quiet = await app.tick({ st: live(), now: 1000, opens: 0 });
  assert.equal(quiet.action, null, 'nothing changed, nothing to do');
  const d = await app.tick({ st: live(), now: 2000, opens: 1 });
  assert.equal(d.action, 'start');
  assert.equal(d.reason, 're-assert after the scan reopened');
  assert.equal(d.reassert, true);
  assert.equal(app.stats.reasserts, 1);
  assert.equal(app.dir.reassertPending, null, 'a start that worked clears the pending re-assert');

  // A reopen that lands while a start is in flight: the tick is skipped (busy), so the count is not consumed.
  const app2 = makeApp();
  await app2.tick({ st: live(), now: 0, opens: 0 });
  let release; const hold = new Promise(r => { release = r; });
  const inflight = app2.tick({ st: live({ alive: false }), now: 1000, opens: 0, hold });   // a start is in flight
  assert.equal(app2.busy, true);
  assert.equal(await app2.tick({ st: live({ alive: false }), now: 1250, opens: 1 }), null, 'busy: the tick is skipped');
  assert.equal(app2.dir.scanOpens, 0, 'the reopen was not consumed');
  release(); await inflight;
  assert.equal(app2.dir.scanOpens, 0);
  const next = await app2.tick({ st: live({ alive: false }), now: 1500, opens: 1 });
  assert.equal(next.action, 'start', 'the re-assert still happens on the next tick');
  assert.equal(next.reason, 're-assert after the scan reopened');
  // the director also treats busy as a no-op by itself
  const noop = directAdvert({ st: live(), config: CONFIG, tid: 1, scanOpens: 5, dir: newAdvertDirector(), gate: new AdvertGate(), now: 0, busy: true });
  assert.deepEqual([noop.action, noop.dir.scanOpens, noop.refreshGate], [null, 0, false]);
});

test('(b2) a re-assert deferred by minStartMs keeps its reason until a start runs (P-L3)', async () => {
  const app = makeApp();
  await app.tick({ st: live(), now: 0, opens: 0 });
  const early = await app.tick({ st: live(), now: ADVERT_START_MIN_MS - 100, opens: 1 });
  assert.equal(early.action, null, 'inside minStartMs');
  assert.equal(early.refreshGate, true);
  assert.equal(early.dir.reassertPending, uuid());
  const later = await app.tick({ st: live(), now: ADVERT_START_MIN_MS, opens: 1 });
  assert.equal(later.reason, 're-assert after the scan reopened');
});

test('(c) no stations: no advert and no snapshot (EFF-2); a claim adds the claim bits, value and mode (A56)', () => {
  const gate = new AdvertGate();
  assert.equal(advertSnapshotNeeded({ stations: [] }, gate), false);
  assert.equal(advertSnapshotNeeded(null, gate), false);
  assert.equal(advertSnapshotNeeded(CONFIG, gate), true);
  const d0 = directAdvert({ st: live(), config: { stations: [] }, tid: 1, scanOpens: 0, dir: newAdvertDirector(), gate, now: 0 });
  assert.equal(d0.action, null);
  gate.started(uuid(), 0);
  assert.equal(advertSnapshotNeeded({ stations: [] }, gate), true, 'something on air: a stop is still due');
  const d1 = directAdvert({ st: live(), config: { stations: [] }, tid: 1, scanOpens: 0, dir: newAdvertDirector(), gate, now: 5000 });
  assert.deepEqual([d1.action, d1.reason], ['stop', 'stop: no stations in this game']);

  const claiming = directAdvert({ st: live({ powerupClaim: { station: 4, ready: false } }), config: CONFIG, tid: 1, scanOpens: 0, dir: newAdvertDirector(), gate: new AdvertGate(), now: 0 });
  assert.equal(claiming.uuid, uuid({ state: 1 | 0x10, value: 4 }));
  assert.equal(claiming.mode, 'lowLatency');
  const ready = directAdvert({ st: live({ powerupClaim: { station: 4, ready: true } }), config: CONFIG, tid: 1, scanOpens: 0, dir: newAdvertDirector(), gate: new AdvertGate(), now: 0 });
  assert.equal(ready.uuid, uuid({ state: 1 | 0x10 | 0x20, value: 4 }));
  assert.match(ready.okLog, /CLAIM READY station 4 · lowLatency/);
  const plain = directAdvert({ st: live(), config: CONFIG, tid: 1, scanOpens: 0, dir: newAdvertDirector(), gate: new AdvertGate(), now: 0 });
  assert.equal(plain.mode, 'balanced');
});

test('(d) reason strings, word for word', () => {
  const run = (st, o = {}) => directAdvert({ st, config: o.config || CONFIG, tid: 'tid' in o ? o.tid : 1, scanOpens: o.opens || 0, dir: newAdvertDirector(), gate: o.gate || new AdvertGate(), now: o.now ?? 5000 });
  const onAir = (u) => { const g = new AdvertGate(); g.started(u, 0); return g; };
  assert.equal(run(live()).reason, 'first start');
  assert.equal(run(live({ phase: 'idle' }), { gate: onAir(uuid()) }).reason, 'stop: phase idle');
  assert.equal(run(live(), { config: { stations: [] }, gate: onAir(uuid()) }).reason, 'stop: no stations in this game');
  assert.equal(run(live({ playerNum: null }), { gate: onAir(uuid()) }).reason, 'stop: no player number');
  assert.equal(run(live(), { tid: null, gate: onAir(uuid()) }).reason, 'stop: no team');
  assert.equal(run(live({ alive: false }), { gate: onAir(uuid()) }).reason, 'state alive -> down');
  assert.equal(run(live({ powerupClaim: { station: 4, ready: false } }), { gate: onAir(uuid()) }).reason, 'state bits 1 -> 17, value 0 -> 4');
  assert.equal(run(live(), { tid: 2, gate: onAir(uuid()) }).reason, 'team 1 -> 2');
  assert.equal(run(live(), { config: { stations: [{ id: 4 }], game_byte: 3 }, gate: onAir(uuid()) }).reason, 'game 9 -> 3');
  assert.equal(run(live({ playerNum: 8 }), { gate: onAir(uuid()) }).reason, 'id 7 -> 8');
  assert.equal(run(live(), { gate: onAir(uuid()), opens: 1 }).reason, 're-assert after the scan reopened');
  assert.equal(advertFailLog(new Error('boom')), 'player advert failed — the phone may still be broadcasting the previous one; retrying: boom');
  assert.equal(advertFailLog('x'), 'player advert failed — the phone may still be broadcasting the previous one; retrying: x');
});

test('settleAdvert: counters and gate ops for start, reassert, stop and failure', () => {
  const dir = { scanOpens: 1, reassertPending: 'u' };
  assert.deepEqual(settleAdvert({ action: 'start', dir, reassert: true }, true), { gate: 'started', dir: { scanOpens: 1, reassertPending: null }, stats: { starts: 1, stops: 0, fails: 0, reasserts: 1 } });
  assert.deepEqual(settleAdvert({ action: 'stop', dir, reassert: false }, true).stats, { starts: 0, stops: 1, fails: 0, reasserts: 0 });
  const f = settleAdvert({ action: 'start', dir, reassert: true }, false);
  assert.deepEqual([f.gate, f.dir.reassertPending, f.stats.fails], ['failed', 'u', 1]);
});

test('no behaviour change: the scripted sequence makes the plugin calls and log lines syncPlayerAdvert made before the move', async () => {
  const app = makeApp();
  // [now, state patch, scan opens, plugin throws]
  const script = [
    [0, { phase: 'idle' }, 0], [250, { phase: 'live', alive: true }, 0], [500, { powerupClaim: { station: 4, ready: false } }, 0],
    [750, {}, 0], [1000, { alive: false, powerupClaim: null }, 0], [1250, {}, 0, true], [1500, {}, 0], [2000, {}, 0],
    [2250, {}, 0], [2500, {}, 1], [2750, {}, 1], [3000, { phase: 'idle' }, 1], [3250, {}, 1],
  ];
  let st = { phase: 'idle', playerNum: 7, alive: true, powerupClaim: null };
  const perTick = [];
  for (const [now, patch, opens, fail] of script) {
    st = { ...st, ...patch }; const n = app.calls.length;
    await app.tick({ st, now, opens, fail: !!fail });
    perTick.push([now, app.calls.slice(n).map(c => c[0])]);
  }
  assert.deepEqual(perTick.filter(([, c]) => c.length), [[250, ['start']], [750, ['start']], [1250, ['start']], [2250, ['start']], [2750, ['start']], [3000, ['stop']]]);
  assert.deepEqual(app.calls, [
    ['start', '4f425258-0102-0007-0001-010000090000', 'balanced'],
    ['start', '4f425258-0102-0007-0001-110400090000', 'lowLatency'],
    ['start', '4f425258-0102-0007-0001-000000090000', 'balanced'],
    ['start', '4f425258-0102-0007-0001-000000090000', 'balanced'],
    ['start', '4f425258-0102-0007-0001-000000090000', 'balanced'],
    ['stop'],
  ]);
  assert.deepEqual(app.logs, [
    ['advertising as player 7 team 1 · balanced · first start', 'li'],
    ['advertising as player 7 team 1 · claiming station 4 · lowLatency · state bits 1 -> 17, value 0 -> 4', 'li'],
    ['player advert failed — the phone may still be broadcasting the previous one; retrying: boom', 'le'],
    ['advertising as player 7 team 1 (down) · balanced · first start', 'li'],
    ['advertising as player 7 team 1 (down) · balanced · re-assert after the scan reopened', 'li'],
    ['player advert stopped (stop: phase idle)', 'li'],
  ]);
  assert.deepEqual(app.stats, { starts: 4, stops: 1, fails: 1, reasserts: 1, lastReason: 'stop: phase idle' });
});
