// Audio queue scenarios (docs/audio-queue-scenarios.md): each game situation, run through the phone's cue sending
// under (A) the app on main (app/src/engine.js: 0.4.11 plus F348's spawn at full shield and F349's four-grant
// recharge) and (B) the 0.4.12 rule (the real announcer queue and gun FIFO model in app/src/announcer.js), then through the gun
// model (gun-audio-sim.mjs). Pure and deterministic.
//
//   node app/tools/audio-scenarios.mjs            prints the per-scenario tables the doc carries
//
// The game model below (shield, regen, low health, death) mirrors engine.js's numbers; the cue ids are the golden
// bundle's (mcp/brx_mcp/mc/golden_bundle.json), first take of every pool, so a run never depends on a random pick.

import { simulateGun, GUN_RULES, CLIP_MS, PLAYX, play } from './gun-audio-sim.mjs';
import { Announcer, GunAudio, ANNOUNCE_PRIORITY, ANNOUNCE_AUDIO_LATE_MS, ANNOUNCE_AUDIO_LATE_DEFAULT_MS, ANNOUNCE_GAP_MS, MUST_HEAR, OBJECTIVE }
  from '../src/announcer.js';

// ---------- engine.js numbers (main), mirrored; audio-queue.test.mjs reads engine.js and checks each one ----------
export const STEP_MS = 10;
export const ENGINE_TICK_MS = 250;   // app.js calls engine.tick() every 250 ms: the heartbeat, the hill tick and the recharge run on it
const FLASH_TO_LINE_MS = 120;      // feedback / IR kill: $SFLASH, then the line 120 ms later
const MEDAL_GAP_MS = 2000;         // medal lines 120 + i * 2000 ms after the feedback
const CALLOUT_WINDOW_MS = 3000;    // S57: IR and MC kill confirms pair inside this
const HURT_DEBOUNCE_MS = 400;      // the low-health line waits this long; a death inside it cancels it
const PAIN_GAP_MS = 600;
const PAIN_STALE_MS = 500;         // a grunt that would start later than this after its hit is dropped (B)
const PAIN_LONG_MIN = 40;
const LOW_HEALTH_HP = 15;
const MAX_HP = 45;
const SHIELD_REGEN_DELAY_MS = 6500;
const SHIELD_REGEN_GRANTS = 4;     // F349: a full pool in 4 grants of ceil(max / 4), one a second
const SHIELD_REGEN_STEP_MS = 1000;
const SPAWN_SHIELD_FULL = true;    // F348: a Shields life starts at full shield (`$LIFE,0,0,<max>,*` in the spawn write)
const SHIELD_FILL_ECHO_MS = 5000;  // F348: a spawn fill counts as shield up until its echo, at most this long (X3)
const SHIELD_LOOP_MS = 1940;       // N74, replayed on its own length
const HILL_TICK_MS = 1000;
const SHIELD_CHARGING_MIN_MS = 1000;   // B only: `shield_charging` is said only for a refill longer than this
const KILL_CARD_MS = 1800;             // B only: brx4 engine.js, MC's kill card hold
const IR_KILL_BANNER_MS = 2000;        // B only: brx4 engine.js, the IR KILL CONFIRMED card
const MUST_HEAR_MAX_STOPS = 4;         // B only: brx4 engine.js, round 3 H1 (the loop + 3 clips)
/** The engine numbers the test checks against app/src/engine.js, by name. */
export const ENGINE_MIRROR = Object.freeze({ PAIN_GAP_MS, PAIN_STALE_MS, LOW_HEALTH_HP, HURT_DEBOUNCE_MS, SHIELD_REGEN_DELAY_MS, SHIELD_REGEN_GRANTS,
  SHIELD_REGEN_STEP_MS, SPAWN_SHIELD_FULL, SHIELD_FILL_ECHO_MS, SHIELD_LOOP_MS, HILL_TICK_MS, MEDAL_GAP_MS, CALLOUT_WINDOW_MS });

/** The cue each kind plays (golden bundle, first take). */
export const CUE = Object.freeze({
  kill: 'VAA', first_blood: 'VA7H', double_kill: 'VA7E', triple_kill: 'VA7Q', killtacular: 'V124', killing_spree: 'VA7K',
  unstoppable: 'VX0U', lead_taken: 'VA6D', lead_lost: 'VA6E', next_kill_wins: 'V115', hill_captured: 'VB0N', hill_lost: 'VB0P',
  hill_tick: 'U100', enemy_down: 'VB8', shield_down: 'N101', shield_charging: 'N102', shield_online: 'VA6Y', shield_loop: 'N74',
  low_health: 'VA86', pain_short: 'VAG', pain_long: 'VAE', spawn: 'VAI', klaxon: 'U16',
});
/** engine.js `_spawn`'s write ahead of the fill, the flash and the line: the life's `$PSET` scream take (it carries
 *  t23 = A10), then the golden bundle's `spawn` frames, which START WITH `$PLAYX,0,*` (the test checks both). */
export const SPAWN_HEAD = Object.freeze(['$PSET,7,1,45,70,0,50,,H44,JAD,VA3,,,,,VA7,H06,,H36,H22,X49,U15,W71,A10,*',
  '$PLAYX,0,*', '$SPAWN,,*', '$TMP,,,,,,,,-100,,,,*', '$TID,1,*', '$AMMO,0,32,192,1,*', '$AMMO,1,6,24,1,*', '$BMAP,0,0,,,,,*']);
/** The whole spawn write. A (the app that Tony heard): head, F348's fill (Shields only), the flash, the spawn line.
 *  B (engine.js since X3): head, the flash, the spawn line, then the fill LAST, so the line is on the FIFO ahead of the hum. */
const spawnWrite = (fill, line, fillLast = false, klaxon = null) => fillLast
  ? [...SPAWN_HEAD, '$SFLASH,*', line, ...(klaxon ? [klaxon] : []), ...(fill ? [`$LIFE,0,0,${fill},*`] : [])]
  : [...SPAWN_HEAD, ...(fill ? [`$LIFE,0,0,${fill},*`] : []), '$SFLASH,*', line];
/** The frames ahead of the fill in B's spawn write (the gun parses them one frame gap apart). */
const FILL_AT_B = SPAWN_HEAD.length + 3;   // the flash, the line, the klaxon
const MEDALS = new Set(['first_blood', 'double_kill', 'triple_kill', 'killtacular', 'killing_spree', 'unstoppable']);
const cueFrame = kind => kind === 'hill_tick' ? `$PLAY,${CUE.hill_tick},4,6,,,,,*` : play(CUE[kind]);

/** What Tony wants from each cue, for the report: `must` = must be heard, on time; `want` = worth hearing if it is
 *  still true; `filler` = repeats or body noise, fine to cut or drop. Reasoning is in the doc. */
export const WANT = Object.freeze({
  kill: 'must', first_blood: 'must', double_kill: 'must', triple_kill: 'must', killtacular: 'must', killing_spree: 'must',
  unstoppable: 'must', lead_taken: 'must', lead_lost: 'must',
  hill_captured: 'want', hill_lost: 'want', enemy_down: 'want', shield_down: 'want', low_health: 'want', next_kill_wins: 'want',
  shield_charging: 'want', shield_online: 'want', spawn: 'want', klaxon: 'want',
  shield_loop: 'filler', hill_tick: 'filler', pain_short: 'filler', pain_long: 'filler',
});

// ---------- the game model (shared by A and B: the gun's pools do not depend on the policy) ----------
class Game {
  constructor(sc, gapMs) {
    this.halo = sc.preset === 'halo';
    this.maxShield = this.halo ? (sc.maxShield != null ? sc.maxShield : 105) : 0;
    this.shield = sc.startShield != null ? sc.startShield : 0;
    this.hp = sc.startHp != null ? sc.startHp : MAX_HP;
    this.alive = true; this.shieldDown = !!sc.startShieldDown; this.quietAt = 0; this.regen = null; this.hurtFired = false;
    this.gapMs = gapMs;       // a `$LIFE` frame behind another frame of the same write reaches the gun this much later
    this.pending = [];        // [[t, value or fn]]: a `$LIFE` write the gun has not applied yet
    this.trace = [[0, this.shield]];
    this.moments = [];
  }
  _set(t, v) { if (v !== this.shield) { this.shield = v; this.trace.push([t, v]); } }
  /** A `$LIFE` shield write lands on the gun at `at` (after the frames ahead of it in its write). */
  _later(at, v) { this.pending.push([at, v]); }
  applyPending(t) {
    const due = this.pending.filter(p => p[0] <= t); if (!due.length) return;
    this.pending = this.pending.filter(p => p[0] > t);
    for (const [at, v] of due) this._set(at, typeof v === 'function' ? v(this.shield) : v);
  }
  hit(t, dmg) {
    if (!this.alive) return;
    const prev = this.shield, s = Math.min(this.shield, dmg), rest = dmg - s;
    this._set(t, this.shield - s); this.hp -= rest; this.quietAt = t; this.regen = null; this.pending = [];
    if (prev > 0 && this.shield === 0) { this.shieldDown = true; this.moments.push({ kind: 'shield_down' }); }
    if (this.hp <= 0) { this.death(t); return; }
    if (rest > 0) {
      if (!this.hurtFired && this.hp < LOW_HEALTH_HP) { this.hurtFired = true; this.moments.push({ kind: 'low_health' }); }
      else this.moments.push({ kind: 'pain', dmg });
    }
  }
  death(t) {
    if (!this.alive) return;
    this.alive = false; this.hp = 0; this._set(t, 0); this.regen = null; this.pending = [];
    this.moments.push({ kind: 'death', hurtFired: this.hurtFired });
  }
  /** engine.js `_spawn`: `$SPAWN` leaves the pool at 0; on a Shields game F348's fill (`$LIFE,0,0,<max>,*`) lands where
   *  the policy's spawn write puts it (A: right after the head; B: last, after the flash and the line). The phone learns
   *  it from the echo, after the write. */
  spawn(t) {
    this.alive = true; this.hp = MAX_HP; this._set(t, 0); this.shieldDown = false; this.quietAt = t; this.regen = null; this.hurtFired = false;
    const fill = this.halo && SPAWN_SHIELD_FULL;
    if (fill) this._later(t + (this.fillLast ? FILL_AT_B : SPAWN_HEAD.length) * this.gapMs, this.maxShield);
    this.moments.push({ kind: 'spawn', fill: fill ? this.maxShield : 0 });
  }
  /** engine.js `_shieldTick` on main (F349: four grants of ceil(max / 4), one a second), on the engine's 250 ms tick. */
  tick(t) {
    if (!this.halo || !this.alive || this.shield >= this.maxShield || this.pending.length) return;
    if (t - this.quietAt < SHIELD_REGEN_DELAY_MS) return;
    if (!this.regen) {
      // engine.js writes `shield_charging` BEFORE the first `$LIFE` grant in the same tick, as two writes, so the line
      // reaches the gun's FIFO while the shield is still 0; the grant lands one frame gap later.
      const step = Math.ceil(this.maxShield / SHIELD_REGEN_GRANTS), need = Math.max(1, Math.ceil((this.maxShield - this.shield) / step));
      this.regen = { nextAt: t, step };
      // `refillMs` is brx4's C4 reckoning (grants needed x the step period); B uses it to decide "shields charging"
      this.moments.push({ kind: 'shield_charging', refillMs: need * SHIELD_REGEN_STEP_MS });
    }
    if (t < this.regen.nextAt) return;
    this.regen.nextAt = t + SHIELD_REGEN_STEP_MS;
    const step = this.regen.step, max = this.maxShield, full = this.shield + step >= max;
    this._later(t + this.gapMs, v => Math.min(max, v + step));
    if (full) { this.regen = null; this.shieldDown = false; this.fullAt = t + this.gapMs; }
  }
  /** The `$HP` echo of the grant that filled the pool: engine.js says `shield_online` on it (`_onHp`). */
  echoes(t) { if (this.fullAt != null && t >= this.fullAt && this.shield >= this.maxShield) { this.fullAt = null; this.moments.push({ kind: 'shield_full' }); } }
  /** engine.js `_shieldTick`: the heartbeat runs while the shield is broken, empty, not refilling and not yet due. */
  heartbeatWanted(t) { return this.halo && this.alive && this.shieldDown && this.shield === 0 && !this.regen && t - this.quietAt < SHIELD_REGEN_DELAY_MS; }
}

/** The `$PSET` t23 shield loop a scenario's gun carries: Halo ships Callsign's A10 unless the scenario clears it. */
const humOf = sc => sc.preset !== 'halo' ? null : sc.humClip === undefined ? 'A10' : (sc.humClip || null);

// ---------- the runner ----------
function makeCtx(sc, rules) {
  const ctx = { t: 0, writes: [], dropped: [], timers: [], game: new Game(sc, rules.writeFrameGapMs), sc, notes: [] };
  ctx.write = (frames, why) => { ctx.writes.push({ t: ctx.t, frames, why }); };
  ctx.delay = (ms, fn) => { ctx.timers.push({ at: ctx.t + ms, fn }); };
  ctx.drop = (cue, eventT, why) => { ctx.dropped.push({ cue, eventT, t: ctx.t, why }); };
  ctx.line = (kind, eventT, must = WANT[kind] === 'must') => ({ f: cueFrame(kind), cue: kind, eventT, must });
  return ctx;
}

/** Run one scenario under one policy ('A' or 'B'), then through the gun. */
export function runScenario(sc, policyName, rules = GUN_RULES) {
  const ctx = makeCtx(sc, rules);
  const policy = policyName === 'A' ? new PolicyA(ctx) : new PolicyB(ctx);
  ctx.game.fillLast = policyName !== 'A';   // X3: B writes the spawn fill last
  const events = sc.events.slice().sort((a, b) => a.t - b.t);
  let ei = 0;
  for (let t = 0; t <= sc.horizonMs; t += STEP_MS) {
    ctx.t = t;
    ctx.game.applyPending(t);
    ctx.game.echoes(t);
    policy.onMoments(ctx.game.moments.splice(0));
    for (;;) {   // timers due now, in the order they were set
      const due = ctx.timers.filter(x => x.at <= t);
      if (!due.length) break;
      ctx.timers = ctx.timers.filter(x => x.at > t);
      due.sort((a, b) => a.at - b.at).forEach(x => x.fn());
    }
    while (ei < events.length && events[ei].t <= t) {
      const ev = events[ei++];
      const g = ctx.game;
      if (ev.type === 'hit') g.hit(t, ev.dmg);
      else if (ev.type === 'death') g.death(t);
      else if (ev.type === 'spawn') g.spawn(t);
      else if (ev.type === 'hill_hold_end') policy.hillMine = false;
      else policy.onEvent(ev);
      policy.onMoments(g.moments.splice(0));
    }
    if (t % ENGINE_TICK_MS === 0) {   // engine.tick(): the recharge, the heartbeat, the hill tick and brx4's `_ann.tick`
      ctx.game.tick(t);
      policy.onMoments(ctx.game.moments.splice(0));
      policy.tick(t);
    }
  }
  const gun = simulateGun({ writes: ctx.writes, shield: ctx.game.trace, humClip: humOf(sc), horizonMs: sc.horizonMs }, rules);
  return { scenario: sc.id, policy: policyName, gun, dropped: ctx.dropped, writes: ctx.writes, notes: ctx.notes, mustPendingHeartbeats: policy.mustPendingHeartbeats || 0 };
}

// ============================================================================================================
// (A) THE APP ON MAIN (engine.js: 0.4.11 plus F348/F349). Every path writes its `$PLAY` the moment its event lands.
// The `$PLAYX` uses: the hill preempt (it assumes the hill line is what is playing), F149's stop at death, and the
// `$PLAYX,0,*` that opens every spawn write (golden bundle `spawn`). The possession tick is a token-1 (interrupt) clip.
// ============================================================================================================
class PolicyA {
  constructor(ctx) { this.ctx = ctx; this.irOpen = []; this.mcOpen = []; this.hillBusyUntil = 0; this.hillMine = false; this.hillTickAt = 0; this.loopAt = 0; this.lastPainAt = null; this.pendingHurt = false; }
  onEvent(ev) {
    const c = this.ctx, t = c.t, g = c.game;
    if (ev.type === 'ir_kill') {   // `_irKillConfirmed`: only while alive
      if (!g.alive) return;
      if (take(this.mcOpen, t)) return;   // MC already played it
      this.irOpen.push({ at: t });
      c.write(['$SFLASH,*'], 'S57 IR kill confirmed');
      c.delay(FLASH_TO_LINE_MS, () => c.write([c.line('kill', t)], 'S57 IR kill confirmed cue'));
    } else if (ev.type === 'mc_kill') {   // `feedback`: plays dead or alive
      const irAlready = take(this.irOpen, t);
      c.write(['$SFLASH,*'], 'feedback kill');
      const medals = (ev.medals || []).filter(m => MEDALS.has(m));
      if (medals.length) medals.forEach((m, i) => c.delay(FLASH_TO_LINE_MS + i * MEDAL_GAP_MS, () => c.write([c.line(m, t)], `medal ${m}`)));
      else if (!irAlready) c.delay(FLASH_TO_LINE_MS, () => c.write([c.line('kill', t)], 'feedback cue kill'));
      if (!irAlready) this.mcOpen.push({ at: t });
    } else if (ev.type === 'mc_alert') {   // `alert` -> `_event`: at once
      c.write([c.line(ev.kind, t)], `event cue ${ev.kind}`);
    } else if (ev.type === 'hill') {   // `_hillSay`: the later callout preempts, with a $PLAYX, if "our" line is still busy
      if (!g.alive) return;
      const preempt = t < this.hillBusyUntil;
      this.hillBusyUntil = t + CLIP_MS[CUE[ev.kind]];
      this.hillMine = ev.kind === 'hill_captured';
      c.write(preempt ? [PLAYX, c.line(ev.kind, t)] : [c.line(ev.kind, t)], `hill ${ev.kind}${preempt ? ' (preempt)' : ''}`);
    } else if (ev.type === 'enemy_down') {
      if (g.alive) c.write([c.line('enemy_down', t)], 'S57 ENEMY DOWN');
    } else if (ev.type === 'teammate_down') {
      // row 3: a teammate gets the HUD chip only, no sound
    }
  }
  onMoments(ms) {
    const c = this.ctx, t = c.t;
    for (const m of ms) {
      if (m.kind === 'shield_down') { this.loopAt = t; c.write([c.line('shield_down', t)], 'event cue shield_down'); }
      else if (m.kind === 'pain') {
        if (this.lastPainAt != null && t - this.lastPainAt < PAIN_GAP_MS) continue;
        this.lastPainAt = t; const k = m.dmg >= PAIN_LONG_MIN ? 'pain_long' : 'pain_short';
        c.write([c.line(k, t)], k);
      } else if (m.kind === 'low_health') {
        this.pendingHurt = true; this.lastPainAt = t;
        c.delay(HURT_DEBOUNCE_MS, () => { if (!this.pendingHurt) return; this.pendingHurt = false; if (c.game.alive) c.write([c.line('low_health', t), '$HLED,7,4,90,90,10,15,*'], 'low health'); });
      } else if (m.kind === 'death') {
        this.hillMine = false;
        if (this.pendingHurt) this.pendingHurt = false;
        else if (m.hurtFired) c.write([PLAYX], 'death: stop the low-health loop (F149)');
        c.notes.push(`${t} ms: death, the gun's native scream plays (outside this model)`);
      } else if (m.kind === 'spawn') { c.write(spawnWrite(m.fill, c.line('spawn', t)), 'spawn'); this.loopAt = 0; }
      else if (m.kind === 'shield_charging') { c.write([c.line('shield_charging', t)], 'event cue shield_charging'); }
      else if (m.kind === 'shield_full') { c.write([c.line('shield_online', t)], 'event cue shield_online'); }
    }
    // the regen grants themselves (`$LIFE`, silent, rule 4) are the game model's; they write no sound
  }
  tick(t) {
    const c = this.ctx, g = c.game;
    if (g.heartbeatWanted(t) && (!this.loopAt || t - this.loopAt >= SHIELD_LOOP_MS)) { this.loopAt = t; c.write([c.line('shield_loop', t)], 'shield down heartbeat'); }
    if (this.hillMine && g.alive && t >= this.hillBusyUntil && (!this.hillTickAt || t - this.hillTickAt >= HILL_TICK_MS)) {
      this.hillTickAt = t; c.write([c.line('hill_tick', t)], 'hill possession tick');
    }
  }
}
function take(open, t) {
  for (let i = open.length - 1; i >= 0; i--) if (t - open[i].at > CALLOUT_WINDOW_MS) open.splice(i, 1);
  if (!open.length) return false;
  open.shift(); return true;
}

// ============================================================================================================
// (B) THE 0.4.12 RULE, AS SHIPPED: app/src/announcer.js + engine.js. The queue and the phone's model of the gun are the
// REAL `Announcer` and `GunAudio` (imported above), so the spec cannot drift from the code. What is mirrored here is
// only the engine's glue around them (which write each item makes, and when): `_audioWrite`, `_sayMust`, `feedback`,
// `_irKillConfirmed`, `_hillSay`, `_pain`, `_shieldTick` and `_hillTick`.
//
// The rule:
//  1. The phone models the gun's FIFO with clip lengths (`GunAudio`).
//  2. At most one non-must-hear clip outstanding: a non-must-hear line waits while the model holds any clip.
//  3. A non-must-hear line is dropped (its card still shows) when it is more than ~2 s stale, or while the shield loop
//     blocks the gun. Every non-must `$PLAY` written while the loop blocks is dropped, body sounds included. The
//     exception: an OBJECTIVE line (hill captured / lost, "Target down") cuts the loop like a must-hear line.
//  4. Before a must-hear line: one `$PLAYX,0` per outstanding clip, PLUS one for the hum loop when shield > 0 and
//     `$PSET` t23 is non-empty, sent tightly in the same write, then the line.
//  5. The shield-online line is removed. The heartbeat (N74) never starts while the model holds a clip or any item
//     waits; `shield_charging` only for a refill longer than 1 s. The possession tick also waits while the item on air
//     still has audio due.
//  6. A pain grunt that would start more than PAIN_STALE_MS after its hit is dropped.
// Also mirrored: at most MUST_HEAR_MAX_STOPS stops; a kill item's lines go back to back (ANNOUNCE_GAP_MS after the
// previous one ENDS); MC's kill card holds max(1800 ms, its audio), the IR card 2000 ms; the native death scream joins
// the phone's model; the hill item stops only its own line (`stopsOwn`); the pool line is key 'status' with
// `preemptKey`; the medal lines of a kill whose IR line was already said are a `medal` item.
// Also the spree fold: older MC kills still waiting fold into the newest (the newest medal line only).
// NOT mirrored: the `$SIR` hit sounds the engine adds to its model on every `$HIR`, the bundle's `cue_ms` overrides, and the `phase === 'live'` gate on the loop.
// ============================================================================================================
export { ANNOUNCE_PRIORITY, ANNOUNCE_AUDIO_LATE_DEFAULT_MS, MUST_HEAR, OBJECTIVE };
const lateOf = kind => ANNOUNCE_AUDIO_LATE_MS[kind] != null ? ANNOUNCE_AUDIO_LATE_MS[kind] : ANNOUNCE_AUDIO_LATE_DEFAULT_MS;
const idOf = f => { const t = f.split(','); return (t[4] || t[1] || '').trim(); };

class PolicyB {
  constructor(ctx) {
    this.ctx = ctx; this.model = new GunAudio();
    this.logs = [];
    this.ann = new Announcer(() => this.ctx.t, m => { this.logs.push(String(m).replace(/^announcer: /, '')); });
    this.ann.gun = this.model; this.ann.sync = () => this._sync();
    this.loopAt = 0; this.lastPainAt = null; this.pendingHurt = false; this.hillMine = false; this.hillTickAt = 0;
    this.irOpen = []; this.mcOpen = [];
    this.mustPendingHeartbeats = 0;   // heartbeats and ticks written while a must-hear line was queued or due within its gaps
    this.mustDue = 0;                  // must-hear lines scheduled (`delay`) and not yet written
  }
  // ----- the gun model's inputs -----
  /** engine.js `_audioSync`: the loop blocks while `$PSET` t23 names a sound and the shield is above 0, or a spawn fill
   *  went out less than SHIELD_FILL_ECHO_MS ago and its echo has not filled the pool yet (X3). */
  _sync() {
    const c = this.ctx, g = c.game;
    if (this.fillAt && (g.shield >= g.maxShield || !g.alive || c.t - this.fillAt > SHIELD_FILL_ECHO_MS)) this.fillAt = 0;
    this.model.setBlocked(humOf(c.sc) != null && (g.shield > 0 || !!this.fillAt), c.t);
  }
  /** engine.js `_audioWrite` for every write that is not a must-hear line. */
  _write(frames, why) {
    const c = this.ctx; this._sync();
    const stops = frames.filter(f => f === PLAYX).length;
    if (stops) { this.model._prune(c.t); this.model.clips.splice(0, this.model.blocked ? stops - 1 : stops); }
    // in write order (engine.js X3): `$SPAWN` stops the loop, a line goes on the FIFO unless the loop blocks, and the
    // spawn fill starts the loop BEHIND the lines already queued
    const out = [];
    for (const f of frames) {
      if (typeof f === 'object') {
        if (this.model.blocked) { c.drop(f.cue, f.eventT, 'the shield loop blocks the gun'); continue; }
        this.model.add(CLIP_MS[idOf(f.f)] || 2500, why, c.t, idOf(f.f));
      } else if (f === '$SPAWN,,*') this.model.setBlocked(false, c.t);
      else if (typeof f === 'string' && f.startsWith('$LIFE,0,0,') && why === 'spawn') {
        this.fillAt = c.t;
        if (humOf(c.sc) != null) this.model.setBlocked(true, c.t, true);
      }
      out.push(f);
    }
    if (out.length) c.write(out, why);
  }
  /** engine.js `_sayMust`: k stops (the hum counts as one while it blocks; at most MUST_HEAR_MAX_STOPS), then the
   *  line, in one write. */
  _sayMust(line, why) {
    const c = this.ctx; this._sync();
    const k = Math.min(this.model.outstanding(c.t), MUST_HEAR_MAX_STOPS);
    c.write([...Array(k).fill(PLAYX), line], k ? `${why} (after ${k} x $PLAYX)` : why);
    this.model.flushed(c.t, { ms: CLIP_MS[CUE[line.cue]], why });
  }
  /** A must-hear line said `ms` from now (the kill item's flash-to-line gap, the next medal line). */
  _mustLater(ms, line, why) { this.mustDue++; this.ctx.delay(ms, () => { this.mustDue--; this._sayMust(line, why); }); }
  // ----- the announcer queue: the real one -----
  push(item) {
    const why = k => [...this.logs].reverse().find(l => l.startsWith(k + ' ') || l.startsWith(k + ':')) || 'dropped by the queue';
    const it = this.ann.push({ ...item, onDrop: () => this._dropItem(it || item, why(item.kind)) });
    return it;
  }
  _dropItem(it, why) { if (!it || it.droppedOnce) return; it.droppedOnce = true; (it.lines || []).forEach(l => this.ctx.drop(l.cue, l.eventT, why)); }
  /** A muted start: the queue shows the card and says nothing. */
  _muted(it, waited) {
    this._dropItem(it, it.streakSilent ? 'silent: kill streak on air (card only)' : it.forceMute && waited <= lateOf(it.kind) ? 'the shield loop blocks the gun (card only)' : `would start ${waited} ms late (card only)`);
  }
  /** engine.js `feedback` / `_irKillConfirmed`: the flash, then the lines back to back (each starts ANNOUNCE_GAP_MS after
   *  the one before it ENDS, round 3 M4), each a must-hear line. `bannerMs` null = MC's card, max(KILL_CARD_MS, audio). */
  _killItem(lines, bannerMs, why, kind = 'kill_confirmed', src = null) {
    const at = []; const lens = lines.map(l => CLIP_MS[CUE[l.cue]]);
    lens.reduce((t, ms, i) => { at[i] = t; return t + ms + ANNOUNCE_GAP_MS; }, FLASH_TO_LINE_MS);
    const audioMs = lines.length ? at[lines.length - 1] + lens[lines.length - 1] : 0;
    return this.push({ kind, src, medals: lines.filter(l => MEDALS.has(l.cue)).map(l => l.cue), lines, audioMs, bannerMs: bannerMs != null ? bannerMs : Math.max(KILL_CARD_MS, audioMs),
      play: ({ muted, waited }, self) => {
        if (muted) { this._muted(self, waited); return; }
        this._write(['$SFLASH,*'], why);
        lines.forEach((l, i) => this._mustLater(at[i], l, `${why}: ${l.cue}`));
      } });
  }
  _line(kind, eventT, extra = {}) {
    const c = this.ctx, l = c.line(kind, eventT);
    const itemKind = extra.itemKind || kind;
    return this.push({ kind: itemKind, key: extra.key, preemptKey: extra.preemptKey, stopsOwn: extra.stopsOwn, ok: extra.ok, lines: [l],
      audioMs: CLIP_MS[CUE[kind]], bannerMs: extra.bannerMs,
      play: ({ preempted, muted, waited, flush }, self) => {
        if (muted) { this._muted(self, waited); return; }
        if (MUST_HEAR.has(itemKind) || flush) this._sayMust(l, kind);
        else this._write(preempted ? [PLAYX, l] : [l], kind);
      } });
  }
  onEvent(ev) {
    const c = this.ctx, t = c.t, g = c.game;
    if (ev.type === 'ir_kill') {
      if (!g.alive) return;
      const mc = this.mcOpen.find(x => t - x.at <= CALLOUT_WINDOW_MS);
      if (mc) {   // MC first: add a line only when MC's item said a medal, never its own kill line
        this.mcOpen.splice(this.mcOpen.indexOf(mc), 1);
        if (mc.saidKill) return;
        this._killItem([c.line('kill', t)], 0, 'S57 IR kill (voice only)');
        return;
      }
      const item = this._killItem([c.line('kill', t)], IR_KILL_BANNER_MS, 'S57 IR kill confirmed');
      this.irOpen.push({ at: t, item });
    } else if (ev.type === 'mc_kill') {
      let medals = (ev.medals || []).filter(m => MEDALS.has(m));
      const ir = this.irOpen.find(x => t - x.at <= CALLOUT_WINDOW_MS);
      if (ir) this.irOpen.splice(this.irOpen.indexOf(ir), 1);
      if (ir && ir.item && !this.ann.queue.includes(ir.item) && !medals.length) {   // IR on air or done: the named card, in place
        this.ann.extend(ir.item, t + KILL_CARD_MS);
        return;
      }
      // engine.js round 2 M1, the spree fold: older MC kills still WAITING fold into this one: first blood (never folded),
      // then the newest medal tier
      const waiting = this.ann.queue.filter(q => q.src === 'mc' && (q.kind === 'kill_confirmed' || q.kind === 'medal'));
      if (waiting.length) {
        const folded = waiting.flatMap(q => q.medals || []);
        const fb = [...folded, ...medals].find(m => m === 'first_blood');
        const tier = medals.find(m => m !== 'first_blood') || folded.filter(m => m !== 'first_blood').pop();
        const keep = [fb, tier].filter(Boolean);
        waiting.forEach(q => { this.ann.remove(q); q.lines = (q.lines || []).filter(l => !keep.includes(l.cue)); this._dropItem(q, 'folded into the newer kill (spree)'); });
        medals = keep;
      }
      if (ir) {
        if (ir.item && this.ann.queue.includes(ir.item)) {   // IR still waiting: MC's item replaces it and speaks the kill once
          this.ann.remove(ir.item);
          this._killItem(medals.length ? medals.map(m => c.line(m, t)) : [c.line('kill', ir.item.at)], null, 'feedback kill', 'kill_confirmed', 'mc');
        } else {   // IR on air or done: its line was said, so what is left is a `medal` item
          if (ir.item) this.ann.release(ir.item);
          this._killItem(medals.map(m => c.line(m, t)), null, 'feedback medals', ir.item && ir.item.muted ? 'kill_confirmed' : 'medal', 'mc');
        }
        return;
      }
      const lines = medals.length ? medals.map(m => c.line(m, t)) : [c.line('kill', t)];
      this._killItem(lines, null, 'feedback kill', 'kill_confirmed', 'mc');
      this.mcOpen.push({ at: t, saidKill: !medals.length });
    } else if (ev.type === 'mc_alert') {
      const lead = ev.kind === 'lead_taken' || ev.kind === 'lead_lost';
      this._line(ev.kind, t, { itemKind: lead ? ev.kind : 'alert', key: lead ? 'lead' : `alert:${ev.kind}` });
    } else if (ev.type === 'hill') {
      if (!g.alive) return;
      this.hillMine = ev.kind === 'hill_captured';
      this._line(ev.kind, t, { key: 'hill', preemptKey: true, stopsOwn: true, ok: () => this.ctx.game.alive });
    } else if (ev.type === 'enemy_down') {
      if (g.alive) this._line('enemy_down', t, { ok: () => this.ctx.game.alive });
    } else if (ev.type === 'teammate_down') {
      if (g.alive) this.push({ kind: 'teammate_down', audioMs: 0, lines: [], play: () => {} });   // the card, no sound
    }
  }
  onMoments(ms) {
    const c = this.ctx, t = c.t;
    for (const m of ms) {
      this._sync();
      if (m.kind === 'shield_down') { this.loopAt = t; this._write([c.line('shield_down', t)], 'shield_down (exempt)'); }
      else if (m.kind === 'pain') {
        if (this.lastPainAt != null && t - this.lastPainAt < PAIN_GAP_MS) continue;
        const k = m.dmg >= PAIN_LONG_MIN ? 'pain_long' : 'pain_short';
        if (this.model.freeAt(t) - t > PAIN_STALE_MS) { c.drop(k, t, `stale: the gun is busy for ${this.model.freeAt(t) - t} ms`); continue; }
        this.lastPainAt = t;
        this._write([c.line(k, t)], k);
      } else if (m.kind === 'low_health') {
        this.pendingHurt = true; this.lastPainAt = t;
        c.delay(HURT_DEBOUNCE_MS, () => { if (!this.pendingHurt) return; this.pendingHurt = false; if (c.game.alive) this._write([c.line('low_health', t), '$HLED,7,4,90,90,10,15,*'], 'low health'); });
      } else if (m.kind === 'death') {
        this.hillMine = false;
        // engine.js `_death`: the native scream ($PSET t10, VA3 in SPAWN_HEAD's take) joins the phone's model first
        this.model.add(CLIP_MS.VA3, 'death scream', t, 'VA3');
        if (this.pendingHurt) this.pendingHurt = false;
        // F149 (gap B3, waiting on Tony): this stop cuts whatever plays, my own kill line included. See the todo test.
        else if (m.hurtFired) this._write([PLAYX], 'death: stop the low-health loop (F149)');
      } else if (m.kind === 'spawn') {   // engine.js `_spawn`: the T-0 klaxon rides the spawn write, before the fill (X3)
        this._write(spawnWrite(m.fill, c.line('spawn', t), true, this.klaxonSaid ? null : c.line('klaxon', t)), 'spawn'); this.klaxonSaid = true; this.loopAt = 0;
      }
      else if (m.kind === 'shield_charging') {
        if (m.refillMs > SHIELD_CHARGING_MIN_MS) this._line('shield_charging', t, { itemKind: 'status', key: 'status', preemptKey: true });
      }
      // shield_full: no line (rule 5; the engine keeps its LED burst only)
    }
  }
  tick(t) {
    const c = this.ctx, g = c.game;
    this._sync();
    this.ann.tick(t);
    // engine.js `_shieldTick`: no heartbeat that would still be playing when the refill is due
    if (g.heartbeatWanted(t) && (!this.loopAt || t - this.loopAt >= SHIELD_LOOP_MS) && !(t + SHIELD_LOOP_MS > g.quietAt + SHIELD_REGEN_DELAY_MS)) {
      if (this.model.outstanding(t) === 0 && !this.ann.queue.length) {
        if (this.mustDue > 0) this.mustPendingHeartbeats++;
        this.loopAt = t; this._write([c.line('shield_loop', t)], 'shield down heartbeat');
      }
    }
    // engine.js `_hillTick`: a token-1 clip, so never while the gun holds a clip, an item waits, or the item on air still
    // has audio due (the flash-to-line gap, the gaps between medal lines)
    if (this.hillMine && g.alive && this.model.outstanding(t) === 0 && !this.ann.queue.length && !this.ann.audioBusy(t)
      && (!this.hillTickAt || t - this.hillTickAt >= HILL_TICK_MS)) {
      if (this.mustDue > 0) this.mustPendingHeartbeats++;
      this.hillTickAt = t; this._write([c.line('hill_tick', t)], 'hill possession tick');
    }
  }
}

// ============================================================================================================
// THE SCENARIOS. Delivery lags are ESTIMATES: the victim's phone sends its S57 DOWN_BY word about 200 ms after its
// death, and MC's feedback (and any alert from the same scoring pass) reaches the killer about 500 ms after it.
// ============================================================================================================
export const IR_LAG_MS = 200;
export const MC_LAG_MS = 500;
/** One kill of mine: the victim dies at `t`; the IR confirm and MC's feedback (with `medals`) follow. */
const kill = (t, medals = [], alerts = []) => [
  { t: t + IR_LAG_MS, type: 'ir_kill' },
  { t: t + MC_LAG_MS, type: 'mc_kill', medals },
  ...alerts.map(k => ({ t: t + MC_LAG_MS, type: 'mc_alert', kind: k })),
];

export const SCENARIOS = [
  {
    id: 'halo-hum-kills',
    title: 'Halo, shield up (hum): a kill, a double kill, then a killing spree',
    preset: 'halo', startShield: 105, horizonMs: 30000,
    events: [...kill(1000), ...kill(3000, ['double_kill']), ...kill(9000), ...kill(14000), ...kill(20000, ['killing_spree'])],
  },
  {
    id: 'halo-heartbeat-kill',
    title: 'Halo, shield broken: a kill confirm lands mid-heartbeat, then the recharge',
    preset: 'halo', startShield: 105, horizonMs: 20000,
    events: [{ t: 500, type: 'hit', dmg: 60 }, { t: 900, type: 'hit', dmg: 60 }, ...kill(4800)],
  },
  {
    id: 'teammate-down-firefight',
    title: 'A teammate down during a firefight (hits break the shield)',
    preset: 'halo', startShield: 105, horizonMs: 15000,
    events: [{ t: 1000, type: 'hit', dmg: 40 }, { t: 1400, type: 'hit', dmg: 40 }, { t: 1800, type: 'hit', dmg: 40 },
      { t: 2000, type: 'teammate_down' }, { t: 2300, type: 'hit', dmg: 10 }, { t: 2600, type: 'enemy_down' }],
  },
  {
    id: 'koth-capture-kill-lead',
    title: 'KOTH, shield up: hill captured, a kill confirm and a lead change inside 1 s',
    preset: 'halo', startShield: 105, horizonMs: 15000,
    events: [{ t: 1000, type: 'hill', kind: 'hill_captured' }, ...kill(1100, [], ['lead_taken']), { t: 8000, type: 'hill_hold_end' }],
  },
  {
    id: 'first-blood-lead',
    title: 'Match start (a Shields spawn at full shield, F348): first blood, lead taken and the kill confirm at once',
    preset: 'halo', startShield: 0, horizonMs: 25000,
    events: [{ t: 0, type: 'spawn' }, ...kill(12000, ['first_blood'], ['lead_taken'])],
  },
  {
    id: 'spawn-kill-early',
    title: 'X3: a kill confirm 800 ms into a Shields spawn, while the spawn line and the klaxon still play',
    preset: 'halo', startShield: 0, horizonMs: 12000,
    events: [{ t: 0, type: 'spawn' }, ...kill(800)],
  },
  {
    id: 'death-with-kill-queued',
    title: 'I die while my own kill confirm is queued (low health fired)',
    preset: 'halo', startShield: 105, horizonMs: 12000,
    events: [{ t: 500, type: 'hit', dmg: 110 }, { t: 1100, type: 'hit', dmg: 30 }, ...kill(1300), { t: 2000, type: 'death' }],
  },
  {
    id: 'koth-flap-standard',
    title: 'Standard (no shield): a kill confirm, then the hill captured and lost 300 ms apart',
    preset: 'standard', horizonMs: 12000,
    events: [...kill(600), { t: 1000, type: 'hill', kind: 'hill_captured' }, { t: 1300, type: 'hill', kind: 'hill_lost' }],
  },
  {
    id: 'standard-control',
    title: 'Standard preset (no shield, no hum), control: first blood + lead, a double kill, a hill capture',
    preset: 'standard', horizonMs: 20000,
    events: [...kill(1000, ['first_blood'], ['lead_taken']), ...kill(3000, ['double_kill']), { t: 6000, type: 'hill', kind: 'hill_captured' }, { t: 9000, type: 'hill_hold_end' }],
  },
  {
    id: 'koth-hum-objectives',
    title: 'KOTH, shield up (hum): hill captured, "Target down", an ambient alert, then hill lost',
    preset: 'halo', startShield: 105, horizonMs: 15000,
    events: [{ t: 1000, type: 'hill', kind: 'hill_captured' }, { t: 4000, type: 'enemy_down' },
      { t: 6500, type: 'mc_alert', kind: 'next_kill_wins' }, { t: 8000, type: 'hill', kind: 'hill_lost' }],
  },
  {
    id: 'koth-hold-medals',
    title: 'Standard, holding the hill (the possession tick runs): a kill with two medal lines',
    preset: 'standard', horizonMs: 14000,
    events: [{ t: 500, type: 'hill', kind: 'hill_captured' }, ...kill(3000, ['double_kill', 'killing_spree']), { t: 12000, type: 'hill_hold_end' }],
  },
];

/** Run every scenario under both policies. */
export function runAll(rules = GUN_RULES) {
  return SCENARIOS.map(sc => ({ sc, A: runScenario(sc, 'A', rules), B: runScenario(sc, 'B', rules) }));
}

/** One row per cue that mattered: what happened to it. Filler that played in full is folded into a count. */
export function summarise(run) {
  const rows = [];
  let filler = 0;
  for (const c of run.gun.clips) {
    const want = WANT[c.cue] || 'want';
    const fate = c.status === 'never' ? `never (by ${run.gun.horizonMs / 1000} s)`
      : c.status === 'cut' ? `cut after ${c.playedMs} ms of ${c.ms}${c.fragment ? ' (audible fragment)' : ''}` : 'full';
    if (want === 'filler' && c.status !== 'never') { filler++; continue; }
    rows.push({ cue: c.cue, want, eventT: c.eventT, latency: c.latency, fate });
  }
  for (const d of run.dropped) rows.push({ cue: d.cue, want: WANT[d.cue] || 'want', eventT: d.eventT, latency: null, fate: `dropped by the phone: ${d.why}` });
  return { rows, filler, humMs: run.gun.hum.reduce((s, h) => s + (h.end - h.start), 0) };
}

function fmtRun(run) {
  const s = summarise(run);
  const lines = ['| Cue | Want | Event (s) | Latency (ms) | Fate |', '|---|---|---|---|---|'];
  for (const r of s.rows) lines.push(`| ${r.cue} | ${r.want} | ${(r.eventT / 1000).toFixed(2)} | ${r.latency == null ? 'n/a' : r.latency} | ${r.fate} |`);
  lines.push(`\nFiller clips played or cut: ${s.filler}. Hum on for ${(s.humMs / 1000).toFixed(1)} s.`);
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const { sc, A, B } of runAll()) {
    console.log(`\n### ${sc.id}: ${sc.title}\n\n**A (main)**\n\n${fmtRun(A)}\n\n**B (0.4.12 rule)**\n\n${fmtRun(B)}`);
  }
}
