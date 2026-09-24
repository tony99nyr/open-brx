// Audio queue scenarios (docs/audio-queue-scenarios.md): each game situation, run through the phone's cue sending
// under (A) the app on main (app/src/engine.js: 0.4.11 plus F348's spawn at full shield and F349's four-grant
// recharge) and (B) the planned 0.4.12 rule (brx4's announcer queue plus the gun FIFO model), then through the gun
// model (gun-audio-sim.mjs). Pure and deterministic.
//
//   node app/tools/audio-scenarios.mjs            prints the per-scenario tables the doc carries
//
// The game model below (shield, regen, low health, death) mirrors engine.js's numbers; the cue ids are the golden
// bundle's (mcp/brx_mcp/mc/golden_bundle.json), first take of every pool, so a run never depends on a random pick.

import { simulateGun, GUN_RULES, CLIP_MS, PLAYX, play } from './gun-audio-sim.mjs';

// ---------- engine.js numbers (main), mirrored; audio-queue.test.mjs reads engine.js and checks each one ----------
export const STEP_MS = 10;
export const ENGINE_TICK_MS = 250;   // app.js calls engine.tick() every 250 ms: the heartbeat, the hill tick and the recharge run on it
const FLASH_TO_LINE_MS = 120;      // feedback / IR kill: $SFLASH, then the line 120 ms later
const MEDAL_GAP_MS = 2000;         // medal lines 120 + i * 2000 ms after the feedback
const CALLOUT_WINDOW_MS = 3000;    // S57: IR and MC kill confirms pair inside this
const HURT_DEBOUNCE_MS = 400;      // the low-health line waits this long; a death inside it cancels it
const PAIN_GAP_MS = 600;
const PAIN_LONG_MIN = 40;
const LOW_HEALTH_HP = 15;
const MAX_HP = 45;
const SHIELD_REGEN_DELAY_MS = 6500;
const SHIELD_REGEN_GRANTS = 4;     // F349: a full pool in 4 grants of ceil(max / 4), one a second
const SHIELD_REGEN_STEP_MS = 1000;
const SPAWN_SHIELD_FULL = true;    // F348: a Shields life starts at full shield (`$LIFE,0,0,<max>,*` in the spawn write)
const SHIELD_LOOP_MS = 1940;       // N74, replayed on its own length
const HILL_TICK_MS = 1000;
const SHIELD_CHARGING_MIN_MS = 1000;   // B only: `shield_charging` is said only for a refill longer than this
const KILL_CARD_MS = 1800;             // B only: brx4 engine.js, MC's kill card hold
const IR_KILL_BANNER_MS = 2000;        // B only: brx4 engine.js, the IR KILL CONFIRMED card
const MUST_HEAR_MAX_STOPS = 4;         // B only: brx4 engine.js, round 3 H1 (the loop + 3 clips)
/** The engine numbers the test checks against app/src/engine.js, by name. */
export const ENGINE_MIRROR = Object.freeze({ PAIN_GAP_MS, LOW_HEALTH_HP, HURT_DEBOUNCE_MS, SHIELD_REGEN_DELAY_MS, SHIELD_REGEN_GRANTS,
  SHIELD_REGEN_STEP_MS, SPAWN_SHIELD_FULL, SHIELD_LOOP_MS, HILL_TICK_MS, MEDAL_GAP_MS, CALLOUT_WINDOW_MS });

/** The cue each kind plays (golden bundle, first take). */
export const CUE = Object.freeze({
  kill: 'VAA', first_blood: 'VA7H', double_kill: 'VA7E', triple_kill: 'VA7Q', killtacular: 'V124', killing_spree: 'VA7K',
  unstoppable: 'VX0U', lead_taken: 'VA6D', lead_lost: 'VA6E', next_kill_wins: 'V115', hill_captured: 'VB0N', hill_lost: 'VB0P',
  hill_tick: 'U100', enemy_down: 'VB8', shield_down: 'N101', shield_charging: 'N102', shield_online: 'VA6Y', shield_loop: 'N74',
  low_health: 'VA86', pain_short: 'VAG', pain_long: 'VAE', spawn: 'VAI',
});
/** engine.js `_spawn`'s write ahead of the fill, the flash and the line: the life's `$PSET` scream take (it carries
 *  t23 = A10), then the golden bundle's `spawn` frames, which START WITH `$PLAYX,0,*` (the test checks both). */
export const SPAWN_HEAD = Object.freeze(['$PSET,7,1,45,70,0,50,,H44,JAD,VA3,,,,,VA7,H06,,H36,H22,X49,U15,W71,A10,*',
  '$PLAYX,0,*', '$SPAWN,,*', '$TMP,,,,,,,,-100,,,,*', '$TID,1,*', '$AMMO,0,32,192,1,*', '$AMMO,1,6,24,1,*', '$BMAP,0,0,,,,,*']);
/** The whole spawn write: head, F348's fill (Shields only), the flash, the spawn line. */
const spawnWrite = (fill, line) => [...SPAWN_HEAD, ...(fill ? [`$LIFE,0,0,${fill},*`] : []), '$SFLASH,*', line];
const MEDALS = new Set(['first_blood', 'double_kill', 'triple_kill', 'killtacular', 'killing_spree', 'unstoppable']);
const cueFrame = kind => kind === 'hill_tick' ? `$PLAY,${CUE.hill_tick},4,6,,,,,*` : play(CUE[kind]);

/** What Tony wants from each cue, for the report: `must` = must be heard, on time; `want` = worth hearing if it is
 *  still true; `filler` = repeats or body noise, fine to cut or drop. Reasoning is in the doc. */
export const WANT = Object.freeze({
  kill: 'must', first_blood: 'must', double_kill: 'must', triple_kill: 'must', killtacular: 'must', killing_spree: 'must',
  unstoppable: 'must', lead_taken: 'must', lead_lost: 'must',
  hill_captured: 'want', hill_lost: 'want', enemy_down: 'want', shield_down: 'want', low_health: 'want', next_kill_wins: 'want',
  shield_charging: 'want', shield_online: 'want', spawn: 'want',
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
  /** engine.js `_spawn`: `$SPAWN` leaves the pool at 0; on a Shields game F348's fill (`$LIFE,0,0,<max>,*`, the second
   *  frame of the spawn write) lands one frame gap later. The phone learns it from the echo, after the write. */
  spawn(t) {
    this.alive = true; this.hp = MAX_HP; this._set(t, 0); this.shieldDown = false; this.quietAt = t; this.regen = null; this.hurtFired = false;
    const fill = this.halo && SPAWN_SHIELD_FULL;
    if (fill) this._later(t + SPAWN_HEAD.length * this.gapMs, this.maxShield);
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
// (B) THE 0.4.12 RULE: THE SPEC. brx4 implements it in app/src/announcer.js + engine.js (branch
// brx4/announcer-queue). The tables and the two classes below MIRROR that branch; they are the acceptance spec.
// TODO(brx4/announcer-queue): once that branch lands, import ANNOUNCE_PRIORITY, ANNOUNCE_TTL_MS,
// ANNOUNCE_AUDIO_LATE_MS, MUST_HEAR, ANNOUNCE_BANNER_MS, ANNOUNCE_SURFACE, ANNOUNCE_GAP_MS and GunAudio from
// app/src/announcer.js instead of repeating them here, so the spec cannot drift from the code.
//
// The rule, as brx4 stated it (2026-09-24):
//  1. The phone models the gun's FIFO with clip lengths (PhoneGunModel = brx4's GunAudio).
//  2. At most one non-must-hear clip outstanding: a non-must-hear line waits while the model holds any clip.
//  3. A non-must-hear line is dropped (its card still shows) when it is more than ~2 s stale, or while the shield loop
//     blocks the gun. Every non-must `$PLAY` written while the loop blocks is dropped, body sounds included.
//  4. Before a must-hear line: one `$PLAYX,0` per outstanding clip, PLUS one for the hum loop when shield > 0 and
//     `$PSET` t23 is non-empty, sent tightly in the same write, then the line.
//  5. The shield-online line is removed. The heartbeat (N74) never starts while the model holds a clip or any item
//     waits; `shield_charging` only for a refill longer than 1 s.
// Also mirrored from brx4's working tree (read 2026-09-24): at most MUST_HEAR_MAX_STOPS stops; a kill item's lines go
// back to back (ANNOUNCE_GAP_MS after the previous one ENDS, not on the 2 s medal grid); MC's kill card holds
// max(1800 ms, its audio), the IR card 2000 ms; a must-hear item waits while my kill on air still sounds (round 3
// M4); no heartbeat that would outlast the refill delay; the native death scream joins the phone's model; the hill
// item stops only its own line (`stopsOwn`); the pool line is key 'status' with `preemptKey`.
// NOT mirrored: the spree fold (older waiting MC kills fold into the newest), the `$SIR` hit sounds brx4 adds to its
// model on every `$HIR`, the bundle's `cue_ms` overrides, and the `phase === 'live'` gate on the loop.
// ============================================================================================================
export const ANNOUNCE_PRIORITY = ['kill_confirmed', 'lead_taken', 'lead_lost', 'hill_captured', 'hill_lost', 'powerup_swap',
  'alert', 'teammate_down', 'enemy_down', 'powerup_spawn', 'status'];
export const ANNOUNCE_TTL_MS = { kill_confirmed: Infinity, lead_taken: 4000, lead_lost: 4000, hill_captured: 3000, hill_lost: 3000,
  powerup_swap: 4000, alert: 6000, teammate_down: 3000, enemy_down: 3000, powerup_spawn: 5000, status: 1500 };
export const ANNOUNCE_AUDIO_LATE_MS = { kill_confirmed: 6000, lead_taken: Infinity, lead_lost: Infinity };
export const ANNOUNCE_AUDIO_LATE_DEFAULT_MS = 2000;
export const MUST_HEAR = new Set(['kill_confirmed', 'lead_taken', 'lead_lost']);
export const ANNOUNCE_BANNER_MS = { kill_confirmed: 1800, lead_taken: 2200, lead_lost: 2200, hill_captured: 2200, hill_lost: 2200,
  powerup_swap: 2200, alert: 2200, teammate_down: 2000, enemy_down: 2000, powerup_spawn: 2400, status: 0 };
export const ANNOUNCE_SURFACE = { kill_confirmed: 'co', hill_captured: 'co', hill_lost: 'co', powerup_swap: 'co', teammate_down: 'co',
  enemy_down: 'co', powerup_spawn: 'co', lead_taken: 'alert', lead_lost: 'alert', alert: 'alert' };
export const ANNOUNCE_GAP_MS = 150;
const lateOf = kind => ANNOUNCE_AUDIO_LATE_MS[kind] != null ? ANNOUNCE_AUDIO_LATE_MS[kind] : ANNOUNCE_AUDIO_LATE_DEFAULT_MS;
const rankOf = kind => { const i = ANNOUNCE_PRIORITY.indexOf(kind); return i < 0 ? ANNOUNCE_PRIORITY.length : i; };

/** brx4's GunAudio: what the PHONE believes the gun holds. It is not the gun: the gun is gun-audio-sim.mjs. */
export class PhoneGunModel {
  constructor() { this.clips = []; this.blocked = false; }
  add(ms, now, id = null) {
    if (!(ms > 0)) return;
    this._prune(now);
    // brx4 round 3 H1: while the loop blocks, one pending clip per sound id
    if (this.blocked && id && this.clips.some(c => c.id === id && c.start === Infinity)) return;
    const tail = this.clips.length ? this.clips[this.clips.length - 1].end : now;
    const start = this.blocked ? Infinity : Math.max(now, tail);
    this.clips.push({ ms, start, end: start + ms, id });
  }
  setBlocked(on, now) {
    if (on === this.blocked) return;
    this._prune(now);
    if (on) for (const c of this.clips) { c.left = c.end - Math.max(c.start, now); c.start = c.end = Infinity; }
    else { let t = now; for (const c of this.clips) { const ms = c.left != null ? c.left : c.ms; c.start = t; c.end = t + ms; t = c.end; delete c.left; } }
    this.blocked = on;
  }
  outstanding(now) { this._prune(now); return this.clips.length + (this.blocked ? 1 : 0); }
  playingUntil(now) { this._prune(now); return this.clips.reduce((t, c) => (Number.isFinite(c.end) ? Math.max(t, c.end) : t), now); }
  flushed(now, ms) { this.clips = [{ ms, start: now, end: now + ms }]; }
  _prune(now) { this.clips = this.clips.filter(c => c.end > now); }
}
const idOf = f => { const t = f.split(','); return (t[4] || t[1] || '').trim(); };

class PolicyB {
  constructor(ctx) {
    this.ctx = ctx; this.model = new PhoneGunModel();
    this.queue = []; this.cur = null; this.seq = 0;
    this.loopAt = 0; this.lastPainAt = null; this.pendingHurt = false; this.hillMine = false; this.hillTickAt = 0;
    this.irOpen = []; this.mcOpen = [];
    this.mustPendingHeartbeats = 0;   // heartbeats written while a must-hear line was queued or due within its 120 ms flash gap
    this.mustDue = 0;                  // must-hear lines scheduled (`delay`) and not yet written
  }
  // ----- the gun model's inputs -----
  /** engine.js `_audioSync`: the loop blocks while `$PSET` t23 names a sound and the shield is above 0. */
  _sync() { const c = this.ctx; this.model.setBlocked(humOf(c.sc) != null && c.game.shield > 0, c.t); }
  /** engine.js `_audioWrite` for every write that is not a must-hear line. */
  _write(frames, why) {
    const c = this.ctx; this._sync();
    const stops = frames.filter(f => f === PLAYX).length;
    if (stops) { this.model._prune(c.t); this.model.clips.splice(0, this.model.blocked ? stops - 1 : stops); }
    const plays = frames.filter(f => typeof f === 'object');
    if (plays.length && this.model.blocked) {
      plays.forEach(p => c.drop(p.cue, p.eventT, 'the shield loop blocks the gun'));
      const rest = frames.filter(f => typeof f !== 'object');
      if (rest.length) c.write(rest, why);
      return;
    }
    for (const p of plays) this.model.add(CLIP_MS[idOf(p.f)] || 2500, c.t, idOf(p.f));
    c.write(frames, why);
  }
  /** engine.js `_sayMust`: k stops (the hum counts as one while it blocks; at most MUST_HEAR_MAX_STOPS), then the
   *  line, in one write. */
  _sayMust(line, why) {
    const c = this.ctx; this._sync();
    const k = Math.min(this.model.outstanding(c.t), MUST_HEAR_MAX_STOPS);
    c.write([...Array(k).fill(PLAYX), line], k ? `${why} (after ${k} x $PLAYX)` : why);
    this.model.flushed(c.t, CLIP_MS[CUE[line.cue]]);
  }
  /** A must-hear line said `ms` from now (the kill item's flash-to-line gap, the next medal line). */
  _mustLater(ms, line, why) { this.mustDue++; this.ctx.delay(ms, () => { this.mustDue--; this._sayMust(line, why); }); }
  // ----- the announcer queue (brx4 Announcer, condensed) -----
  push(item) {
    const t = this.ctx.t;
    this._sync();
    const it = { ...item, at: t, n: ++this.seq, rank: rankOf(item.kind) };
    it.audioMs = it.audioMs || 0;
    it.slotMs = Math.max(it.audioMs ? it.audioMs + ANNOUNCE_GAP_MS : 0, it.bannerMs != null ? it.bannerMs : ANNOUNCE_BANNER_MS[it.kind] || 0);
    if (it.key != null) {
      const cur = this.cur;
      if (cur && cur.key === it.key && t < cur.until) {
        if (cur.kind === it.kind && !it.preemptKey) return null;
        if (it.preemptKey && !this.queue.some(q => q.rank < it.rank) && !this.model.blocked
          && (it.stopsOwn || this.model.outstanding(t) === 0)) {
          this.queue = this.queue.filter(q => { if (q.key !== it.key) return true; this._dropItem(q, `replaced by the newer ${it.kind}`); return false; });
          this._start(it, t, t < cur.audioUntil); return it;
        }
      }
      const i = this.queue.findIndex(q => q.key === it.key);
      if (i >= 0) {
        if (this.queue[i].kind === it.kind) return null;
        const old = this.queue.splice(i, 1)[0]; this._dropItem(old, `replaced by the newer ${it.kind}`);
      }
    }
    const cur = this.cur;
    if (cur && t < cur.until && it.kind === 'kill_confirmed' && it.rank < cur.rank && !cur.audioMs) {
      this.queue.push(cur); this._start(it, t, false); return it;
    }
    this.queue.push(it);
    this._tickQueue(t);
    return it;
  }
  _dropItem(it, why) { if (it.droppedOnce) return; it.droppedOnce = true; (it.lines || []).forEach(l => this.ctx.drop(l.cue, l.eventT, why)); }
  _peek(t) {
    for (;;) {
      if (!this.queue.length) return null;
      let best = null;
      for (const q of this.queue) if (!best || q.rank < best.rank || (q.rank === best.rank && q.n < best.n)) best = q;
      const ttl = ANNOUNCE_TTL_MS[best.kind] != null ? ANNOUNCE_TTL_MS[best.kind] : 4000;
      if (t - best.at > ttl) { this.queue.splice(this.queue.indexOf(best), 1); this._dropItem(best, `expired after ${t - best.at} ms in the queue`); continue; }
      if (best.ok && !best.ok()) { this.queue.splice(this.queue.indexOf(best), 1); this._dropItem(best, 'no longer applies'); continue; }
      return best;
    }
  }
  _tickQueue(t) {
    this._sync();
    const cur = this.cur;
    // brx4 round 3 M4: a must-hear item waits while the kill on air still has a clip on the gun
    if (cur && cur.kind === 'kill_confirmed' && this.model.playingUntil(t) > t) {
      const nx = this._peek(t);
      if (nx && MUST_HEAR.has(nx.kind)) return;
    }
    if (cur) {
      const next = this._peek(t);
      const handover = next && cur.audioMs > 0 && t >= cur.audioUntil && cur.kind !== 'kill_confirmed' && next.rank <= cur.rank
        && ANNOUNCE_SURFACE[next.kind] && ANNOUNCE_SURFACE[next.kind] === ANNOUNCE_SURFACE[cur.kind];
      if (t < cur.until && !handover) return;
      this.cur = null;
    }
    const next = this._peek(t);
    if (!next) return;
    if (next.audioMs > 0 && !MUST_HEAR.has(next.kind) && this.model.outstanding(t) > 0) {
      if (!this.model.blocked && t - next.at <= lateOf(next.kind)) return;
      next.forceMute = true;
    }
    this.queue.splice(this.queue.indexOf(next), 1);
    this._start(next, t, false);
  }
  _start(it, t, preempted) {
    const waited = t - it.at;
    const muted = it.audioMs > 0 && (waited > lateOf(it.kind) || !!it.forceMute);
    if (muted) {
      this._dropItem(it, it.forceMute && waited <= lateOf(it.kind) ? 'the shield loop blocks the gun (card only)' : `would start ${waited} ms late (card only)`);
      it.audioMs = 0; it.slotMs = it.bannerMs != null ? it.bannerMs : ANNOUNCE_BANNER_MS[it.kind] || 0;
    }
    it.startedAt = t; it.audioUntil = t + it.audioMs; it.until = t + it.slotMs;
    this.cur = it;
    if (!muted) it.play(preempted);
  }
  /** brx4 `feedback` / `_irKillConfirmed`: the flash, then the lines back to back (each starts ANNOUNCE_GAP_MS after the
   *  one before it ENDS, round 3 M4), each a must-hear line. `bannerMs` null = MC's card, max(KILL_CARD_MS, audio). */
  _killItem(lines, bannerMs, why) {
    const at = []; const lens = lines.map(l => CLIP_MS[CUE[l.cue]]);
    lens.reduce((t, ms, i) => { at[i] = t; return t + ms + ANNOUNCE_GAP_MS; }, FLASH_TO_LINE_MS);
    const audioMs = lines.length ? at[lines.length - 1] + lens[lines.length - 1] : 0;
    const item = { kind: 'kill_confirmed', lines, audioMs, bannerMs: bannerMs != null ? bannerMs : Math.max(KILL_CARD_MS, audioMs), play: () => {
      this._write(['$SFLASH,*'], why);
      lines.forEach((l, i) => this._mustLater(at[i], l, `${why}: ${l.cue}`));
    } };
    return this.push(item);
  }
  _line(kind, eventT, extra = {}) {
    const c = this.ctx, l = c.line(kind, eventT);
    const must = MUST_HEAR.has(extra.itemKind || kind);
    return this.push({ kind: extra.itemKind || kind, key: extra.key, preemptKey: extra.preemptKey, stopsOwn: extra.stopsOwn, ok: extra.ok, lines: [l],
      audioMs: CLIP_MS[CUE[kind]], bannerMs: extra.bannerMs,
      play: preempted => must ? this._sayMust(l, kind) : this._write(preempted ? [PLAYX, l] : [l], kind) });
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
      const medals = (ev.medals || []).filter(m => MEDALS.has(m));
      const ir = this.irOpen.find(x => t - x.at <= CALLOUT_WINDOW_MS);
      if (ir) {
        this.irOpen.splice(this.irOpen.indexOf(ir), 1);
        const waiting = this.queue.includes(ir.item);
        if (waiting) {   // IR still waiting: MC's item replaces it and speaks the kill once
          this.queue.splice(this.queue.indexOf(ir.item), 1);
          this._killItem(medals.length ? medals.map(m => c.line(m, t)) : [c.line('kill', ir.item.at)], null, 'feedback kill');
        } else if (medals.length) {   // IR on air: release its card once its line ends; the medal lines follow it
          if (this.cur === ir.item) this.cur.until = Math.max(t, this.cur.audioUntil);
          this._killItem(medals.map(m => c.line(m, t)), null, 'feedback medals');
        } else if (this.cur === ir.item) this.cur.until = Math.max(this.cur.until, t + KILL_CARD_MS);   // the named card, in place
        return;
      }
      const lines = medals.length ? medals.map(m => c.line(m, t)) : [c.line('kill', t)];
      this._killItem(lines, null, 'feedback kill');
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
        this.lastPainAt = t; const k = m.dmg >= PAIN_LONG_MIN ? 'pain_long' : 'pain_short';
        this._write([c.line(k, t)], k);
      } else if (m.kind === 'low_health') {
        this.pendingHurt = true; this.lastPainAt = t;
        c.delay(HURT_DEBOUNCE_MS, () => { if (!this.pendingHurt) return; this.pendingHurt = false; if (c.game.alive) this._write([c.line('low_health', t), '$HLED,7,4,90,90,10,15,*'], 'low health'); });
      } else if (m.kind === 'death') {
        this.hillMine = false;
        // brx4 `_death`: the native scream ($PSET t10, VA3 in SPAWN_HEAD's take) joins the phone's model first
        this.model.add(1271, t, 'VA3');
        if (this.pendingHurt) this.pendingHurt = false;
        else if (m.hurtFired) this._write([PLAYX], 'death: stop the low-health loop (F149)');
      } else if (m.kind === 'spawn') { this._write(spawnWrite(m.fill, c.line('spawn', t)), 'spawn'); this.loopAt = 0; }
      else if (m.kind === 'shield_charging') {
        if (m.refillMs > SHIELD_CHARGING_MIN_MS) this._line('shield_charging', t, { itemKind: 'status', key: 'status', preemptKey: true });
      }
      // shield_full: no line (rule 5; brx4 keeps its LED burst only)
    }
  }
  tick(t) {
    const c = this.ctx, g = c.game;
    this._sync();
    this._tickQueue(t);
    // brx4 `_shieldTick`: no heartbeat that would still be playing when the refill is due
    if (g.heartbeatWanted(t) && (!this.loopAt || t - this.loopAt >= SHIELD_LOOP_MS) && !(t + SHIELD_LOOP_MS > g.quietAt + SHIELD_REGEN_DELAY_MS)) {
      if (this.model.outstanding(t) === 0 && !this.queue.length) {
        if (this.mustDue > 0) this.mustPendingHeartbeats++;
        this.loopAt = t; this._write([c.line('shield_loop', t)], 'shield down heartbeat');
      }
    }
    if (this.hillMine && g.alive && this.model.outstanding(t) === 0 && !this.queue.length
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
