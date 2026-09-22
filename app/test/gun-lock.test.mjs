import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, GUN_SILENT_MS, GUN_PROBE_GAP_MS, GUN_PROBE_REPLY_MS,
  GUN_RECOVERY_RETRY_MS, GUN_RECOVERY_MAX_WRITES, PROBE_LIFE } from '../src/engine.js';

const golden = JSON.parse(readFileSync(fileURLToPath(new URL('../../mcp/brx_mcp/mc/golden_bundle.json', import.meta.url))));

function storage() {
  const m = new Map();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

function rig(writer = null, store = storage(), { isolate = true, respawn = { type: 'auto', delay_s: 8 } } = {}) {
  let now = 1_000_000;
  const writes = [], facts = [];
  const write = writer || (frames => { writes.push(...frames); return true; });
  const eng = new Engine({ writer: write, emit: f => facts.push(f), report: () => {}, now: () => now,
    synced: () => true, storage: store, log: () => {}, delay: (_ms, fn) => fn(), rng: () => 0 });
  const team = { team_id: 'blue', name: 'BLUE', color: 'blue', tid: 1 };
  const player = { player_id: 'p1', player_num: 7, display: 'ROCCO', team_id: 'blue',
    loadout: { weapons: [{ weapon_id: 'assault_rifle' }] }, voice: 'male' };
  const config = { config_id: golden.config_id, mode: 'ffa', environment: 'outdoor', night: false,
    time_limit_s: 1800, respawn, scoring: { frag_limit: 25, win_by: 'kills' },
    health: { max_hp: 45, max_armor: 70 }, teams: [team] };
  eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  eng.onMcMessage({ kind: 'assign', body: { player, team, roster: [player] } });
  eng.onMcMessage({ kind: 'config', body: { config, frames: { ...golden, player_id: 'p1' }, roster: [player] } });
  eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: now, config_id: golden.config_id, seq: 1, countdown_s: 0 } });
  now += 1; eng.tick();
  eng.feedFrame('$LCD,45,70,0,0,30,90,*');
  if (isolate) { eng._spawnAt = null; eng._probedLife = eng._lifeSeq || 0; eng._pollAt = now; }   // most tests isolate F272 from F264's independent reads
  writes.length = 0; facts.length = 0;
  return {
    eng, writes, facts, store, clock: () => now,
    advance(ms) { now += ms; eng.tick(); },
    frame(f) { eng.feedFrame(f); },
  };
}

test('F272: 8 s silence asks twice 3 s apart and locks only after the second 1 s answer window', () => {
  const h = rig();
  h.advance(GUN_SILENT_MS - 1);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 0);
  h.advance(1);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 1);
  h.advance(GUN_PROBE_GAP_MS - 1);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 1);
  h.advance(1);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 2);
  h.advance(GUN_PROBE_REPLY_MS - 1);
  assert.equal(h.eng.state().gunLocked, false);
  h.advance(1);
  assert.equal(h.eng.state().gunLocked, true);
  assert.equal(h.eng.statusBody().gun_locked, true);
  assert.equal(h.eng.moment.kind, 'gun_locked');
  h.advance(60_000);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 2, 'a verdict is latched and never probes again');
});

test('F272: any frame cancels a pending silence probe and starts a fresh 8 s clock', () => {
  const h = rig();
  h.advance(GUN_SILENT_MS);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 1);
  h.advance(500); h.frame('$VOLTS,8101,3789,82,48,*');
  h.advance(GUN_SILENT_MS - 1);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 1);
  assert.equal(h.eng.state().gunLocked, false);
  h.advance(1);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 2, 'the new silence spell starts its own first probe');
});

test('F272: a failed or rejected async probe write cannot become evidence for a lock verdict', async () => {
  const gates = [];
  const h = rig(frames => frames.length === 1 && frames[0] === PROBE_LIFE
    ? new Promise((resolve, reject) => gates.push({ resolve, reject })) : true);
  gates.length = 0;   // discard F264's independent first-live poll from rig setup
  h.advance(GUN_SILENT_MS);
  assert.equal(gates.length, 1);
  gates.shift().resolve(false); await Promise.resolve(); await Promise.resolve();
  h.advance(GUN_PROBE_GAP_MS + GUN_PROBE_REPLY_MS + 1);
  assert.equal(h.eng.state().gunLocked, false, 'a write reported lost was never a sent probe');
  assert.equal(gates.length, 1, 'the detector retries a first probe instead of counting the failed one');
  gates.shift().reject(new Error('bridge failed')); await Promise.resolve(); await Promise.resolve();
  h.advance(GUN_PROBE_GAP_MS + GUN_PROBE_REPLY_MS + 1);
  assert.equal(h.eng.state().gunLocked, false, 'a rejected write is never counted either');
});

test('F272: a queued probe starts its solicitation and 3 s clocks only when the BLE writer actually starts it', async () => {
  const h = rig();
  let onStart = null, resolveWrite = null;
  h.eng.writer = (frames, _why, options) => {
    if (frames.length !== 1 || frames[0] !== PROBE_LIFE) return true;
    return new Promise(resolve => { onStart = options && options.onStart; resolveWrite = resolve; });
  };
  h.advance(GUN_SILENT_MS);
  const queuedAt = h.clock();
  assert.equal(h.eng._queryAt < queuedAt, true, 'queue time did not open a reply window');
  h.advance(5000);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 0, 'the replacement writer owns this delayed batch');
  onStart();
  assert.equal(h.eng._queryAt, h.clock(), 'solicitation begins at the serialized writer start');
  resolveWrite(true); await Promise.resolve(); await Promise.resolve();
  h.advance(GUN_PROBE_GAP_MS - 1);
  assert.equal(h.eng._gunProbe.n, 1, 'probe gap is measured from completed delivery, not queue time');
  h.advance(1);
  assert.equal(h.eng._gunProbe.n, 2);
});

test('F272: its LIFE read is solicited, so an HP answer does not erase independent no-fire evidence', () => {
  const h = rig();
  h.advance(GUN_SILENT_MS);
  h.eng._noFirePulls = 3;
  h.frame('$HP,45,70,0,*');
  assert.equal(h.eng._noFirePulls, 3, 'a reply to the node\'s own LIFE read is not a trigger answer');
  assert.equal(h.eng.state().gunLocked, false);
});

test('F272: normal F264 poll and spawn-readback paths do not add probes inside the 8/3/1 sequence', () => {
  const h = rig(null, storage(), { isolate: false });
  h.advance(GUN_SILENT_MS);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 1, 'only F272 probe 1 goes out at the silence edge');
  h.advance(GUN_PROBE_GAP_MS);
  assert.equal(h.writes.filter(f => f === PROBE_LIFE).length, 2, 'only F272 probe 2 follows');
  h.advance(GUN_PROBE_REPLY_MS);
  assert.equal(h.eng.state().gunLocked, true);
});

test('F272: locked verdict survives the drop; relink writes the full head, books one desync down, and normal respawn revives', () => {
  const h = rig();
  h.advance(GUN_SILENT_MS); h.advance(GUN_PROBE_GAP_MS); h.advance(GUN_PROBE_REPLY_MS);
  assert.equal(h.eng.state().gunLocked, true);
  h.eng.onBleDropped();
  assert.equal(h.eng.state().gunLocked, true, 'the reason for the expected power-cycle survives its link drop');
  const before = h.writes.length;
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  const recovery = h.writes.slice(before);
  assert.ok(recovery.includes('$CLEAR,*') && recovery.includes('$START,*'), 'a power-cycled gun gets the full head, not an ordinary reconcile');
  assert.equal(h.eng.alive, false);
  assert.equal(h.eng.state().reconciling, false);
  assert.equal(h.eng.state().gunLocked, false);
  assert.equal(h.eng.state().downReason, 'gun_recovery');
  const deaths = h.facts.filter(f => f.type === 'death');
  assert.equal(deaths.length, 1); assert.equal(deaths[0].desync, true);
  h.advance(7999); assert.equal(h.eng.alive, false);
  h.advance(1); assert.equal(h.eng.alive, true);
  assert.ok(h.writes.includes('$SPAWN,,*'), 'the configured respawn path brings the player back');
});

test('F272: a zero-pool head echo before async success cannot pre-empt the one desync recovery death', async () => {
  const h = rig();
  h.advance(GUN_SILENT_MS); h.advance(GUN_PROBE_GAP_MS); h.advance(GUN_PROBE_REPLY_MS);
  h.eng.onBleDropped();
  let land = null;
  h.eng.writer = frames => frames.includes('$CLEAR,*') ? new Promise(resolve => { land = resolve; }) : true;
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(h.eng.state().gunRecovery, 'rearming');
  h.frame('$LCD,0,0,0,0,0,0,*'); h.advance(250);
  assert.equal(h.eng.alive, true, 'the recovery head echo is not a combat death');
  assert.equal(h.facts.filter(f => f.type === 'death').length, 0);
  land(true); await Promise.resolve(); await Promise.resolve();
  const deaths = h.facts.filter(f => f.type === 'death');
  assert.equal(h.eng.alive, false);
  assert.equal(h.eng.state().downReason, 'gun_recovery');
  assert.equal(deaths.length, 1); assert.equal(deaths[0].desync, true);
});

test('F272: failed locked-relink head writes stay alive and latched, retry at a bounded pace, then stop', async () => {
  const h = rig();
  h.advance(GUN_SILENT_MS); h.advance(GUN_PROBE_GAP_MS); h.advance(GUN_PROBE_REPLY_MS);
  h.eng.onBleDropped();
  let attempts = 0, rejectHead = null, settleHead = null;
  h.eng.writer = frames => {
    if (!frames.includes('$CLEAR,*')) return true;
    attempts++;
    return new Promise((resolve, reject) => { settleHead = resolve; rejectHead = reject; });
  };
  h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(h.eng.statusBody().gun_locked, undefined, 'MC must not say POWER-CYCLE while the phone says KEEP POWER ON');
  h.frame('$LCD,0,0,0,0,0,0,*'); h.advance(250);
  assert.equal(h.eng.alive, true); assert.equal(h.facts.filter(f => f.type === 'death').length, 0);
  rejectHead(new Error('bridge rejected'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.eng.alive, true, 'no respawn clock starts before the replacement head lands');
  assert.equal(h.eng.state().gunLocked, true, 'the instruction remains until a head actually lands');
  h.advance(GUN_RECOVERY_RETRY_MS - 1); assert.equal(attempts, 1, 'no tight tick-loop retry');
  h.advance(1); assert.equal(attempts, 2);
  h.frame('$LCD,0,0,0,0,0,0,*'); h.advance(250);
  settleHead(false); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.eng.alive, true, 'a zero echo before false settlement still cannot start respawn');
  h.advance(GUN_RECOVERY_RETRY_MS);
  settleHead(false); await Promise.resolve(); await Promise.resolve();
  assert.equal(attempts, GUN_RECOVERY_MAX_WRITES);
  h.advance(GUN_RECOVERY_RETRY_MS * 10); await Promise.resolve();
  assert.equal(attempts, GUN_RECOVERY_MAX_WRITES, 'the retry budget is bounded');
  assert.equal(h.eng.state().gunLocked, true);
  assert.equal(h.eng.state().gunRecovery, 'retry_exhausted');
  assert.equal(h.eng.statusBody().gun_locked, true, 'exhaustion makes another power-cycle actionable again');
  assert.equal(h.facts.filter(f => f.type === 'death').length, 0);
});

test('F272: only literal true confirms a recovery head; nullish writer results keep the latch and life', () => {
  for (const result of [undefined, null]) {
    const h = rig();
    h.advance(GUN_SILENT_MS); h.advance(GUN_PROBE_GAP_MS); h.advance(GUN_PROBE_REPLY_MS);
    h.eng.onBleDropped();
    h.eng.writer = frames => frames.includes('$CLEAR,*') ? result : true;
    h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
    assert.equal(h.eng.alive, true, `${String(result)} did not confirm the head`);
    assert.equal(h.eng.state().gunLocked, true);
    assert.equal(h.facts.filter(f => f.type === 'death').length, 0);
  }
});

test('F272: a successful retry clears the latch and leaves scanner/none recovery on their configured down path', async () => {
  for (const type of ['scanner', 'none']) {
    const h = rig(null, storage(), { respawn: { type, delay_s: 1 } });
    h.advance(GUN_SILENT_MS); h.advance(GUN_PROBE_GAP_MS); h.advance(GUN_PROBE_REPLY_MS);
    h.eng.onBleDropped();
    let heads = 0;
    h.eng.writer = frames => frames.includes('$CLEAR,*') ? (++heads === 1 ? false : true) : true;
    h.eng.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
    assert.equal(h.eng.state().gunLocked, true, `${type}: first failed head keeps the latch`);
    assert.equal(h.eng.alive, true, `${type}: failed head has not booked the recovery death`);
    h.advance(GUN_RECOVERY_RETRY_MS);
    assert.equal(h.eng.state().gunLocked, false, `${type}: successful retry clears the latch`);
    h.advance(10_000);
    assert.equal(h.eng.alive, false, `${type}: no automatic timed revive`);
  }
});

test('F272: the verdict survives an app restart for the same live match, but match end and a new match clear it', () => {
  const store = storage(), h = rig(null, store);
  h.advance(GUN_SILENT_MS); h.advance(GUN_PROBE_GAP_MS); h.advance(GUN_PROBE_REPLY_MS);
  const restored = new Engine({ writer: () => true, emit: () => {}, report: () => {}, now: h.clock,
    synced: () => true, storage: store, log: () => {}, delay: (_ms, fn) => fn() });
  assert.equal(restored.state().gunLocked, true, 'the takeover cannot vanish because the phone process restarted');

  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'recall' } });
  assert.equal(h.eng.state().gunLocked, false, 'match end retires the verdict');

  const n = rig();
  n.advance(GUN_SILENT_MS); n.advance(GUN_PROBE_GAP_MS); n.advance(GUN_PROBE_REPLY_MS);
  n.eng.onMcMessage({ kind: 'start', body: { match_id: 'm2', go_live_t: n.clock() + 5000,
    config_id: golden.config_id, seq: 2, countdown_s: 5 } });
  assert.equal(n.eng.state().gunLocked, false, 'a different match never inherits the old gun verdict');
});

test('F272: panic clears both a pending probe and a durable verdict before a same-match newer start', () => {
  const pending = rig();
  pending.advance(GUN_SILENT_MS);
  assert.ok(pending.eng._gunProbe);
  pending.eng.onMcMessage({ kind: 'control', body: { cmd: 'panic' } });
  assert.equal(pending.eng._gunProbe, null);

  const h = rig();
  h.advance(GUN_SILENT_MS); h.advance(GUN_PROBE_GAP_MS); h.advance(GUN_PROBE_REPLY_MS);
  h.eng.onMcMessage({ kind: 'control', body: { cmd: 'panic' } });
  assert.equal(h.eng.state().gunLocked, false);
  h.eng.onMcMessage({ kind: 'start', body: { match_id: 'm1', go_live_t: h.clock() + 1000,
    config_id: golden.config_id, seq: 2, countdown_s: 1 } });
  assert.equal(h.eng.state().gunLocked, false, 'same match ID with a newer schedule cannot inherit panic\'s verdict');
});

test('F272: panic from an idle persisted-lock restore notifies, persists, and cannot resurrect the latch', () => {
  const store = storage(), h = rig(null, store);
  h.advance(GUN_SILENT_MS); h.advance(GUN_PROBE_GAP_MS); h.advance(GUN_PROBE_REPLY_MS);
  let changes = 0;
  const restored = new Engine({ writer: () => true, emit: () => {}, report: () => {}, now: h.clock,
    synced: () => true, storage: store, log: () => {}, delay: (_ms, fn) => fn(), onChange: () => changes++ });
  assert.equal(restored.phase, 'idle'); assert.equal(restored.state().gunLocked, true);
  restored.onMcMessage({ kind: 'control', body: { cmd: 'panic' } });
  assert.equal(restored.state().gunLocked, false); assert.ok(changes > 0, 'idle HUD is notified immediately');
  restored.onBleConnected({ name: 'GUN-A-3D4F', basename: 'GUN-A', tail: '3D4F' });
  assert.equal(restored.phase, 'kitted', 'panic retires the pending LIVE restore before a same-process relink');
  assert.equal(restored.state().reconciling, false);
  const again = new Engine({ writer: () => true, emit: () => {}, report: () => {}, now: h.clock,
    synced: () => true, storage: store, log: () => {}, delay: (_ms, fn) => fn() });
  assert.equal(again.state().gunLocked, false, 'the cleared latch stays cleared after another restart');
});

test('F272: END/RECALL retires an idle persisted-live lock before relink and stays retired', () => {
  for (const cmd of ['end', 'recall']) {
    const store = storage(), h = rig(null, store);
    h.advance(GUN_SILENT_MS); h.advance(GUN_PROBE_GAP_MS); h.advance(GUN_PROBE_REPLY_MS);
    const restored = new Engine({ writer: () => true, emit: () => {}, report: () => {}, now: h.clock,
      synced: () => true, storage: store, log: () => {}, delay: (_ms, fn) => fn() });
    assert.equal(restored.phase, 'idle'); assert.equal(restored.state().gunLocked, true);
    restored.onMcMessage({ kind: 'control', body: { cmd, match_id: 'm1' } });
    assert.equal(restored.phase, 'kitted'); assert.equal(restored.state().gunLocked, false);
    const again = new Engine({ writer: () => true, emit: () => {}, report: () => {}, now: h.clock,
      synced: () => true, storage: store, log: () => {}, delay: (_ms, fn) => fn() });
    assert.equal(again.state().gunLocked, false, `${cmd} persisted the retired verdict`);
  }
});
