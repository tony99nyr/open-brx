// BRX node engine — docs/spec/node.md (contracts A6). DOM-free, BLE-free, transport-free.
//
// Inputs:  BRX frames (feedFrame), MC messages (onMcMessage), hydration (hydrate), clock ticks (tick),
//          BLE link events (onBleConnected / onBleDropped), app-lifecycle (resume).
// Outputs: frames to write (writer(frames[])), persisted facts (emit(fact)), non-fact reports
//          (report(kind, body)), and a render-able snapshot (state()) with a change callback.
//
// Every write to the gun goes through `writer`; the engine never composes a frame except the two
// literal templates (`$SFLASH,*`, `$PLAYX,0,*`), the pre-config probe set (contracts §3/§8), and the
// `HILL_CUES` literals below (which the bundle overrides the moment it carries those cue keys).

import * as W from './transport/envelope.js';   // single source for the contracts §9 constants
import { stationView, TEAM_ANY } from './beacon.js';   // utility-item presence (docs/spec/utility.md)
import { CONTROL_STATE, claimable } from './control.js';   // the phone control point's advert bits + who may own a point (utility.md §5 `control`, K1)
export const C = {
  STATUS_HEARTBEAT_MS: W.STATUS_HEARTBEAT_MS, SYNC_FRESH_MS: W.SYNC_FRESH_MS, FEEDBACK_MAX_AGE_MS: W.FEEDBACK_MAX_AGE_MS,
  LATE_ARM_GRACE_MS: W.LATE_ARM_GRACE_MS, DEATH_LATCH_MS: W.DEATH_LATCH_MS, RESYNC_PROBE_S: W.RESYNC_PROBE_S,
  CONFIG_TTL_MS: 1_800_000,
};
export const SFLASH = '$SFLASH,*';
export const PLAYX = '$PLAYX,0,*';
export const PROBE_VOLTS = ['$PHONE,*'];
export const PROBE_FW = ['$STOP,*', '$PHONE,*', '$VERSION,*'];

const PHASES = ['idle', 'connected', 'kitted', 'lobby', 'armed', 'live'];
const TEAM_NAME = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'GREEN' };
// How long the HUD shows the ALT indicator before giving up on a confirmation.
// The gun only volunteers $ALCD on a SHOT, so a swap is confirmed by the next trigger pull and this
// window is a display timeout, nothing more. On expiry the indicator simply clears — the HUD keeps
// showing the slot the GUN last reported. It deliberately does NOT guess a new slot: $BUT,1 is
// "alt-fire", which is also the native 3s indoor/outdoor toggle and is remapped to RELOAD by the
// easy_reload perk, so a press is not proof a weapon changed (review 2026-08-31).
const RECONCILE_MS = 3000;           // rejoin: hold the gun disarmed this long while we reconcile state (anti-cheat: a restart is slow + gains nothing; a real crash costs 3 s, which is rare and fine — Tony 2026-09-04)
const HEADSET_REBLINK_MS = 120000;   // re-paint the DOWN out-blink every 2 min (< the ~160 s blink count) so a long scanner walk stays lit
const SWITCH_MAX_MS = 850;       // the stock $WEAP tok15 (bench 2026-09-04: 850 ms, linear, no floor) — a fallback; the bundle carries the real value in frames.swap_ms
const EVENT_MIN_GAP_MS = 1000;
const READOUT_COALESCE_MS = 300;    // A16 §3.1/§5: a change within this of the last READOUT WRITE only restarts the hold, it does not write again
const PAIN_GAP_MS = 600;            // A15.3: at most one pain grunt per 600 ms (drop, never queue)
// A17.2: HP below which the once-per-life low-health alert fires (Tony, bench 2026-09-07). ABSOLUTE, not
// a fraction of maxHp. Set to 15 rather than the first-cut 20 precisely BECAUSE it is absolute: 20 is a
// third of the 45 HP default but well over half a 35 HP scout, so the smallest pool would have been warned
// almost as soon as it started taking damage. 15 keeps the warning late on every stock pool. If a loadout
// ever needs its own value this wants plumbing through the bundle the way `voice.pain_long_min` is.
const LOW_HEALTH_HP = 15;
/** F13: a `$SPAWN` within ~2 s of death wedges the headset in its green out-blink (threshold 2.0-2.5 s; use >= 3). Same
 *  value as `gameconfig.MIN_RESPAWN_S` on the CLI path. */
const MIN_RESPAWN_S = 3;
const MEDAL_GAP_MS = 2000;       // A11.4: medal lines are 1.5-2.5 s; play them back to back, not on top of each other   // A11: no two LED bursts inside a second (three flashes per second is the ceiling)
const RELOAD_GRACE_MS = 600;     // a reload the gun never echoed still clears the takeover this long after reload_s
const TEAM_KEY = { 0: 'red', 1: 'blue', 2: 'yellow', 3: 'green' };
// A16.5 (2026-09-09): outermost -> innermost, the order BRX depletes -- shield goes, then armour, then
// health. Mirrors `poolgauge.py`'s `READOUT_POOL_INWARD`; kept as its own constant here too rather than
// shipped through the bundle, so the phone and the bench stage can never silently disagree on it.
const READOUT_POOL_INWARD = ['shield', 'armor', 'health'];

// ---------- King of the Hill audio (F70/F72/F74/F85, docs/utility-roadmap.md "Where the hill audio has to live")
// The gun CANNOT speak for itself on a beacon: `$SIR` is keyed on <irProtocol, subtype> alone, every hill
// beacon decodes as the same cell <15,0>, and fn 28 ignores the row's <soundID> outright (measured
// 2026-09-10, rung Y). So all four hill states are the NODE's job, played over BLE from here.
const HILL_MAG = 8;                 // $HIR magnitude 8 = a control point / hill (6 = respawn station — never a hill)
const HILL_CAPTURE_MAG = 50;        // the capture word, carrying the NEW owner in the team field; lands ~50 ms after the shot
const HILL_WAS_NEUTRAL_MAG = 53;    // "the state being LEFT was neutral" — arrives ~5 s LATER, and only when it was neutral (n=2)
const HILL_NEUTRAL_TEAM = 2;        // a NEUTRAL point broadcasts team 2 (bench 2026-09-10; F82: a hill roster must not use tid 2)
const HILL_TICK_MS = 1000;          // the possession tick's cadence — the node's own clock, never the beacon's
// Presence expires on >= 2 MISSED beacons, not one: the beacon is clean at desk range (20+ consecutive at a
// flat 5.0 s) but goes intermittent at the edge of range (rung R), so a single miss is normal reception, not
// "left the hill". Only a magnitude-8 hill beacon refreshes this — F84: a respawn station's ~2.5 s period
// would otherwise keep a 12 s window permanently fresh and a hill nobody holds would tick forever.
const HILL_PRESENCE_MS = 12000;
// K1: the same hill state, sourced from a phone CONTROL POINT's BLE advert instead of a grenade's IR word
// (utility.md §5d). ⚠ A control point's freshness is the §3 PRESENCE rule (`Presence.expiryMs` 4 s), NOT the
// grenade's 12 s / two-missed-beacons rule (§5d.5): that 12 s exists only because a grenade beacons once per
// ~5 s, and a BLE station advertises continuously. So 4 s covers both halves — an advert older than this
// stops refreshing the point, and `_hillTick` expires a station-sourced point on the same window.
// (`Presence` itself keeps an entry for up to 8 s after the last advert, so without this a point nobody was
// hearing would go on owning the field.)
const CONTROL_STALE_MS = 4000;
// §5d.5: "a floor between repeats of the same line (proposed 10 s for contested, which can otherwise
// oscillate at net 0)". Unlike the IR path (F75) this is a MEASURED state, so it may play at all -- but a
// station at 2 v 2 crosses the line repeatedly and the clip is 2.078 s.
const HILL_CONTESTED_MIN_MS = 10000;
// The same rule for the transition lines, which had no floor at all. Two control-point phones left on the
// DEFAULT station id 1 are ONE presence entry (`beacon.js` keys `station:<id>`), so their fields alternate
// per scan callback and the decoded owner flips several times a second -- each callout preempting the last.
// The id latch in `_controlStation` fixes the distinct-id case; nothing on the reader side can separate two
// phones that claim the same id, so the floor is what bounds the damage to one line per 3 s.
const HILL_CALLOUT_MIN_MS = 3000;
// D: while OUR point is draining, the possession tick doubles. That is the "you are losing this, get help"
// signal, delivered by audio rather than by a screen the defender is not looking at -- and it is the only
// audible warning before "Hill Lost!", which arrives when it is already too late to matter.
const HILL_TICK_LOSING_MS = 500;
// A duration must never be measured across a clock STEP: `now()` is `Date.now()` plus an MC offset that
// updates as the sync converges, so one delta can jump. Clamp each accrual to a tick's worth of time.
const HOLD_STEP_MAX_MS = 1000;
// How often a growing tally goes to MC. `hold_ms` is cumulative and every report is idempotent
// (`mc/API.md` "Objective scoring"), so this is purely a wire-traffic choice; the tally at the whistle is
// sent unconditionally, because that is the report that decides the match.
const POSSESSION_REPORT_MS = 10000;
// Ids are the operator's picks, every one CONFIRMED BY EAR on hardware 2026-09-10 (rung S) — one female
// objectives announcer with a music bed, chosen over the male "Control Point" set (VA23/VA22/VA21, also
// confirmed). `ms` is the clip's real length from `mcp/brx_mcp/data/sound_catalog.json`, which is what the
// scheduler below uses to keep the 0.11 s tick out from under a 1.9-3.0 s callout; a bundle may override a
// duration through `frames.cue_ms`. Picked BY ID and never by category: `V8Q` is catalogued "Hill Confirmed"
// and actually says "KILL Confirmed" (rung S), so a by-category pick would announce a kill line on a capture.
export const HILL_CUES = {
  hill_captured:  { frame: '$PLAY,,4,6,VB0N,,,,*', ms: 1924 },   // VB0N "Hill Captured"  1.924 s
  hill_lost:      { frame: '$PLAY,,4,6,VB0P,,,,*', ms: 2976 },   // VB0P "Hill Lost!"     2.976 s
  hill_contested: { frame: '$PLAY,,4,6,VB0O,,,,*', ms: 2078 },   // VB0O "Hill Contested" 2.078 s — NOT WIRED, see `_hillCallout` (F75)
  hill_moved:     { frame: '$PLAY,,4,6,VB0Q,,,,*', ms: 2424 },   // VB0Q "Hill Moved"     2.424 s — rotating-hill modes only (F83), no caller yet
  hill_tick:      { frame: '$PLAY,U100,4,6,,,,,*', ms: 114 },    // U100 possession tick  0.114 s
};
// A hill beacon carries NO point identifier, so several points in play are indistinguishable on the wire:
// in Domination two grenades held by different teams would read as one point changing hands every few
// seconds and announce continuously. Excluded until K1 supplies a discriminator, rather than shipped noisy.
const HILL_AUDIO_EXCLUDED_MODES = new Set(['domination']);

/** A16.5: which pool the readout should actually SHOW, given that `pool` is the one that just moved and
 *  settled at level 0. Mirrors `poolgauge.handover_pool` exactly -- see its docstring for the full
 *  reasoning: a shot that took armour 35 -> 0 while health sat untouched at 45/45 left the gun body dark
 *  for the whole hold, which read as "nothing left" at the exact moment the player was at full health.
 *  Pure: takes the current pool values and which pools the bundle actually configured a readout for, and
 *  returns `pool` unchanged when nothing inward has anything left (in particular: health emptying hands
 *  over to nothing, because that is death, and death is deliberately hands-off, A16). */
export function handoverPool(pool, values, configured) {
  const vals = {}; for (const k of READOUT_POOL_INWARD) vals[k] = values[k] || 0;
  if (vals[pool] > 0) return pool;
  const start = READOUT_POOL_INWARD.indexOf(pool);
  if (start < 0) return pool;
  const allowed = configured ? new Set(configured) : null;
  for (let i = start + 1; i < READOUT_POOL_INWARD.length; i++) {
    const inner = READOUT_POOL_INWARD[i];
    if (vals[inner] > 0 && (!allowed || allowed.has(inner))) return inner;
  }
  return pool;
}

export function toks(f) {
  let s = String(f).trim();
  if (s[0] === '$') s = s.slice(1);
  if (s.endsWith('*')) s = s.slice(0, -1);
  if (s.endsWith(',')) s = s.slice(0, -1);
  return s.split(',');
}

/** Persisted context keys (localStorage-like `storage`). */
const KEY = 'brx.engine';

export class Engine {
  /**
   * @param {object} o
   * @param {(frames:string[]) => (void|Promise<void>)} o.writer   write frames verbatim to the gun
   * @param {(fact:object) => void} [o.emit]                        persisted fact sink (Transport.send)
   * @param {(kind:string, body:object) => void} [o.report]         non-fact uplink (Transport.report)
   * @param {() => number} [o.now]                                  synced clock (Transport.syncedNow)
   * @param {() => boolean} [o.synced]
   * @param {object} [o.storage]                                    localStorage-like
   * @param {(line:string, cls?:string) => void} [o.log]
   */
  constructor({ writer, emit = () => {}, report = () => {}, now = () => Date.now(), synced = () => false,
                storage = null, log = () => {}, onChange = () => {}, delay = (ms, fn) => setTimeout(fn, ms), rng = Math.random } = {}) {
    this.writer = writer; this.emitFact = emit; this.report = report; this.now = now; this.isSynced = synced;
    this.storage = storage; this.log = log; this.onChange = onChange; this.delay = delay; this.rng = rng;   // rng: the A15 cue-pool pick (tests seed it)
    this.reset();
    this._load();
  }

  reset() {
    this.phase = 'idle';            // idle|connected|kitted|lobby|armed|live
    this.gun = null;                // {name, tail, fw?}
    this.bleUp = false; this.wsState = 'offline';
    this.player = null; this.team = null; this.roster = []; this.config = null; this.frames = null;
    this.start = null;              // {match_id, go_live_t, seq, countdown_s}
    this.matchId = null;
    this.hp = 0; this.armor = 0; this.shield = 0; this.ammo = 0; this.reserve = null; this.mag = null;
    this.alive = false; this.deaths = 0; this.shots = 0; this.battery = null; this.fw = null;
    this.carrying = null;   // A11.6: flag team whose colour the headset is blinking while this player carries it (kept for back-compat reads; the source of truth is `_activeRole` once `headset.role` exists)
    this._activeRole = null;        // A16 §3.3: {name, tid} — the ONE headset role currently held (carrier|infected|vip|beacon|extracted), re-asserted after every hit, cleared on death
    this._lastHeadsetFlashAt = null; // A16 §C: node-initiated headset FLASH sequences (hit flash, role re-assert) share the gun burst's 1 s minimum — never the down rearm or the low-health alert
    this.latch = null;              // {shooter_num, shooter_team, at, ir_proto}
    this.beacon = null;             // F72: {owner_team, magnitude, sensor, at} — last grenade/station beacon (proto-15 $HIR)
    this._lastBeaconKey = null;     // F85: `${owner_team}:${magnitude}` of the last beacon ACCEPTED (not merely seen), for dedupe below
    this._lastBeaconAt = 0;         // F85: this.now() of that acceptance
    this.hill = null;               // {owner, at, from_neutral} — the control point's OWNER and when its last beacon landed. State from the wire; the cadence below is ours
    this._hillBusyUntil = 0;        // the announcer is occupied by a hill callout until this (now + the clip's real length) — the tick waits, it never overlaps
    this._hillTickAt = 0;           // when the possession tick last played (0 = not ticking)
    this._hillTeam2Warned = false;  // F82 is logged once per game, not once per beacon
    this._hillContestedAt = 0;      // K1: when "Hill Contested" last played, so a flapping bit cannot repeat it
    this._hillWasContested = false; // the contested bit we last read off a control point's advert (edge-triggered)
    this._controlSig = '';          // the control-point advert fields that are worth a re-render
    this._controlSite = null;       // the point we are latched to, so walking between two does not read as a capture
    this._hillSaidAt = 0;           // when a captured/lost line last played, for HILL_CALLOUT_MIN_MS
    this._hillOwnerWhenSilenced = undefined;  // C: the owner as we last heard it while audio was ON (undefined = never)
    this._hillSourceWarned = '';    // B: the refused objective source, logged once per game
    this.hold = {};                 // possession: site -> {tid -> cumulative ms} owned, as THIS node observed it
    this.observed = {};             // site -> cumulative ms this node could hear the point at all (the honest lower bound)
    this._holdAt = 0;               // when the accrual last ran
    this._possessionSentAt = 0; this._possessionSig = '';
    this.deadAt = 0; this.killedBy = null; this.lastHitAt = 0;
    this._deathBlinkAt = 0;         // when the headset out-blink was last (re)painted, so a long DOWN doesn't outlast the count
    this._downRearmSent = false;    // §3.2: `down.rearm` sent for THIS death — one write per death, reset on death and revive
    // A16 §3.1/§5: the transient gun-body pool readout (frames.gun.readout). `_readoutFrame` is whatever
    // frame is PHYSICALLY on the strip right now because of this system (a band, or `gun.rest` once the
    // hold has expired) — null before the gun has been taken. `_readoutHoldActive` + the pair below drive
    // a tick()-polled expiry (the same pattern as `_downRearm`/`_reassertDeathBlink`), never `this.delay`,
    // because a hold must be repeatedly RESTARTABLE by later pool changes, not a one-shot timer.
    this._readoutFrame = null;
    this._readoutHoldActive = false;
    this._readoutHoldStartAt = 0;
    this._readoutHoldMs = 0;
    this._readoutLastWriteAt = null; // last time a readout band was actually WRITTEN (for the 300 ms coalesce window)
    this._readoutLastPool = null;    // which pool most recently moved this life (what a reload glances)
    // A16.3 (bar-spec 2026-09-07): the seven-level pool bar + drop/gain animation, active only for a
    // `gun.readout.pools[]` entry that carries `levels` (a `bands` entry is untouched, see `_gunReadoutPaint`).
    this._roLevel = null;   // level (0-6) CURRENTLY on the strip; null = nothing painted yet this life (no "from" to animate out of)
    this._roPool = null;    // which pool's `levels` table `_roLevel` belongs to
    this._roGen = 0;        // bumped on every new/cancelled animation (death/revive/a later change) -- same pattern as `_hsGen`;
                             // teardown (end/panic/BLE drop) is still `_lightGen`, checked alongside it, not a second teardown flag
    this._roAnimating = false; // true while the drop/gain animation owns the strip -- suppresses `_gunReadoutTick`'s hold-expiry
                                // revert until `_readoutSettle` arms the real hold (an in-flight animation must not be cut off mid-step)
    this._roBlinkAt = 0;       // A16.3: last time the partial-level top-segment blink toggled (0 = not blinking); tick()-polled,
                                // same reasoning as the hold itself -- a self-rescheduling `this.delay` chain cannot be restarted
    this._roBlinkOn = false;   // which half of the blink pair (`levels[l][1]` vs `[0]`) is currently on the strip
    this._lightGen = 0;             // bumped on teardown (end/panic/BLE drop) so a stray delayed $GLED/$HLED/cue write can't land after it
    this.score = null;              // ScoreRow from MC (kills/assists/accuracy) — null until synced
    this.scoreAt = 0;
    this.headEcho = null; this.headWrittenAt = 0; this.awaitingEcho = false;
    this.spawned = false; this.ended = false;
    this.cuesFired = new Set();
    this.tutorial = false; this.tutorialWeapon = null;
    // A10 — self-serve kitting (docs/spec/loadout.md §4)
    this.catalog = null;            // {weapons: WeaponView[], perks: PerkView[]} — arrives in `assign`
    this.policy = null;             // {hud_select, primary:{choice, allowed_ids}, secondary:{choice, kinds, allowed_weapon_ids}, perk:{choice, allowed_perk_ids}} (A14)
    this.browsing = false;          // the HUD's LOADOUT browser is open (reported to MC as loadout_browse)
    this.game = null;               // A10 §4.6: assign.game — what the BRIEFING screen shows
    this.briefSeen = false;         // the player tapped BUILD MY KIT ▸ on the briefing (reset when kit_open flips true)
    this.loadoutAck = null;         // MC's verdict on the last pick: {slot, ok, reason, t} — tick() clears it after ~4 s
    this.pendingPick = null;        // optimistic highlight until the ack lands: {slot, kind, id, at}
    this.tryoutSeen = null;         // weapon_id of a try-out panel the player dismissed with DONE (panel hides, gun stays armed)
    this.resync = null;             // §3.10 state machine: {step, since, lastAmmo, lastReserve}
    this.reconciling = null;        // {since} — a rejoin's disarmed reconcile window (S7.1); no death is inferred here
    this.rewriteHeadAtT10 = false;  // start-sequence §3 fallback (bench-gated)
    this._headRewritten = false;
    this.moment = null;             // transient HUD moment: {kind, at, data}
    this.probeSent = false;
    this.night = false;
    this.lastVoltsAt = 0;
    this.hurtFired = false;         // low-health alert already sent this life
    this.switching = null;          // {at, from} while an ALT weapon swap is in flight (field 2026-08-30)
    this.reloading = null;          // {at, ms, slot} from the reload-handle pull ($BUT,2) until the mag comes back ($ALCD up) — HUD takeover (review 2026-09-03 #15)
    this.lastSwitchMs = null;       // measured duration of the last completed swap
    this._prevAmmo = {};            // per weapon slot ($ALCD token 3): last mag seen
    this.activeSlot = 0;
    this.magBySlot = {};
    this.endedMatches = [];         // match_ids already ended locally — a re-hydrated `start` for them is a no-op
    this.endAck = false;            // result screen shown until the player taps OK (then the 'over' screen)
    this.onEnd = null;              // app hook: called once per ended match with a stats summary (history)
    this.configPending = false;     // config arrived while the gun was unlinked → write head on relink
    this.pendingTeardown = null;    // 'end' | 'panic' owed to the gun once it relinks
    this.stations = [];             // utility items in radio range (beacon.js Presence entries), newest snapshot from the app
    this._stationSig = '';
  }

  // ---------- persistence (§3.7) ----------
  _save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify({
        phase: this.phase, gun: this.gun, player: this.player, team: this.team, roster: this.roster,
        config: this.config, frames: this.frames, start: this.start, matchId: this.matchId,
        deaths: this.deaths, shots: this.shots, spawned: this.spawned, ended: this.ended, savedAt: this.now(),
        // combat state — WITHOUT this a rejoin defaults alive:false/hp:0, the recovery guard stamps a
        // death, and auto-respawn HEALS you to full: force-close at 1 hp, reopen, get a free respawn
        // (bench 2026-09-04, Tony — a real cheat). Restoring the real pools closes it; the resync still
        // corrects anything that changed while the link was down.
        alive: this.alive, hp: this.hp, armor: this.armor, shield: this.shield, deadAt: this.deadAt, killedBy: this.killedBy,
        endedMatches: this.endedMatches.slice(-8), configPending: this.configPending, pendingTeardown: this.pendingTeardown,
        catalog: this.catalog, policy: this.policy, game: this.game, briefSeen: this.briefSeen,
      }));
    } catch (_) { /* ignore */ }
  }
  _load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(KEY); if (!raw) return;
      const s = JSON.parse(raw);
      if (s.savedAt && this.now() - s.savedAt > C.CONFIG_TTL_MS) { this.log('persisted context expired', 'li'); return; }
      Object.assign(this, { gun: s.gun, player: s.player, team: s.team, roster: s.roster || [], config: s.config,
        frames: s.frames, start: s.start, matchId: s.matchId, deaths: s.deaths || 0, shots: s.shots || 0,
        spawned: !!s.spawned, ended: !!s.ended, endedMatches: s.endedMatches || [], configPending: !!s.configPending, pendingTeardown: s.pendingTeardown || null,
        alive: !!s.alive, hp: s.hp || 0, armor: s.armor || 0, shield: s.shield || 0, deadAt: s.deadAt || 0, killedBy: s.killedBy || null,
        catalog: s.catalog || null, policy: s.policy || null, game: s.game || null, briefSeen: !!s.briefSeen });
      // Phase is re-derived when the gun reconnects (resumeSchedule); until then we are idle.
      this._pendingPhase = s.phase;
    } catch (_) { /* ignore */ }
  }
  clearPersisted() { try { this.storage && this.storage.removeItem(KEY); } catch (_) { /* ignore */ } }

  // ---------- helpers ----------
  _set(phase) {
    if (this.phase === phase) return;
    this.log(`phase ${this.phase} → ${phase}`, 'lk');
    this.phase = phase; this._changed();
  }
  _changed() { this._save(); try { this.onChange(this); } catch (_) { /* ignore */ } }
  _write(frames, why) {
    if (!frames || !frames.length) return;
    this.log(`write ${why}: ${frames.length} frame(s)`, 'li');
    try { return this.writer(frames); } catch (e) { this.log(`write ${why} failed: ${e && e.message || e}`, 'le'); }
  }
  teamOf(num) { const r = this.roster.find(x => x.player_num === num); return r ? r.team_id : null; }
  nameOf(num) { const r = this.roster.find(x => x.player_num === num); return r ? r.display : null; }
  get teamTid() { return this.team ? this.team.tid : null; }
  get teamKey() { return this.team ? (TEAM_KEY[this.team.tid] || String(this.team.color || 'blue')) : 'blue'; }
  get maxHp() { return (this.config && this.config.health && this.config.health.max_hp) || 45; }
  /** F47: `??`, not `||` -- MC may ship `max_armor: 0` ("one-shot with a sniper", and a per-player handicap can
   *  strip armour); `||` turned that explicit 0 into 70, so a no-armour class silently had armour. */
  get maxArmor() { const v = this.config && this.config.health && this.config.health.max_armor; return (v === 0 || v > 0) ? v : 70; }
  /** F34/F13: floored at MIN_RESPAWN_S on the node too. MC refuses 1-2 s at PUT, but a config that arrives another
   *  way (a stored preset, the demo, the stage) spawned at exactly that, inside the headset relay's out-blink wedge. */
  get respawnDelayMs() { const s = this.config && this.config.respawn && this.config.respawn.delay_s; return Math.max(MIN_RESPAWN_S, s > 0 ? s : 10) * 1000; }
  get respawnType() { return (this.config && this.config.respawn && this.config.respawn.type) || 'auto'; }
  /** scanner respawn: 'trigger' = at the station AND pull the trigger (default); 'presence' = being at the station is enough */
  get respawnGate() { return (this.config && this.config.respawn && this.config.respawn.gate) || 'trigger'; }
  get timeLimitMs() { const s = this.config && this.config.time_limit_s; return s ? s * 1000 : null; }
  get goLiveT() { return this.start ? this.start.go_live_t : null; }
  get endT() { return (this.goLiveT && this.timeLimitMs) ? this.goLiveT + this.timeLimitMs : null; }
  get weaponName() {
    const ws = this.player && this.player.loadout && this.player.loadout.weapons;
    const w = ws && (ws[this.activeSlot] || ws[0]);
    if (!w) return 'PRIMARY';
    const row = this.weaponRow(w.weapon_id);
    return (row && row.name ? row.name : String(w.weapon_id).replace(/_/g, ' ')).toUpperCase();
  }
  weaponRow(id) { const c = this.catalog; return (c && c.weapons && c.weapons.find(w => w.weapon_id === id)) || null; }
  perkRow(id) { const c = this.catalog; return (c && c.perks && c.perks.find(w => w.perk_id === id)) || null; }
  armState() { return this.phase; }

  // ---------- BLE link ----------
  onBleConnected(gun) {
    const first = !this.bleUp && !this.gun;
    this.gun = gun || this.gun; this.bleUp = true;
    if (this.phase === 'idle') {
      // Re-derive the phase from persisted context (§3.7 / §3.11).
      const p = this._pendingPhase; this._pendingPhase = null;
      if (p && p !== 'idle' && this.player) { this.phase = p; this.log(`restored phase ${p} from storage`, 'li'); }
      else this.phase = this.player ? 'kitted' : 'connected';   // MC-first hydrate: player known → KITTED, not CONNECTED
    }
    let justPanicked = false;
    if (this.pendingTeardown) { justPanicked = this.pendingTeardown === 'panic'; this._writeTeardown(this.pendingTeardown, 'relink'); this.pendingTeardown = null; }
    if (this.phase === 'connected' || this.phase === 'kitted') this._probe();
    // A head we hold but never wrote (config/hydrate arrived with the gun unlinked) is written now —
    // never over a match-over screen (`ended`) and never right after a panic we just delivered.
    if (!justPanicked && !this.ended && this.frames && this.frames.head && (this.phase === 'kitted' || (this.phase === 'lobby' && !this.headEcho))) {
      this.configPending = false; this._applyConfig({ config: this.config, frames: this.frames, roster: this.roster }, 'relink');
    } else if (this.phase === 'live') this._beginReconcile();   // S7.1: a rejoin RECONCILES (disarm, keep real pools) — never the infer-death resync that healed on restart
    else if (this.phase === 'lobby' || this.phase === 'armed') this._beginResync('ble-reconnect');
    if (first) this.log(`gun ${this.gun ? this.gun.name : '?'} linked`, 'lk');
    // A restored/held schedule is reconciled against the clock now (E5: grace / hot-join / already over).
    // MC-first late joiner: the running `start` arrived while idle and the relink landed in LOBBY — reconcile from there too.
    if (this.start && (this.phase === 'lobby' || this.phase === 'armed')) this.resumeSchedule();
    this._changed();
  }
  onBleDropped() { this.bleUp = false; this.reloading = null; this.switching = null; this._lightGen = (this._lightGen || 0) + 1; this.log('gun link lost', 'le'); this._changed(); }   // no link, no reload echo: the takeover would be fiction (pass-2 UX review 2026-09-03); the gen bump means a stray delayed write can't reach a gun that relinks mid-flight either
  setWsState(s, info) { this.wsState = s; this.wsReason = s === 'rejected' && info ? `${info.reason || 'refused'} (${info.code})` : null; this._changed(); }

  /** Pre-config probe set: only in CONNECTED/KITTED, never after a head is written (contracts §3). */
  _probe() {
    if (this.probeSent || !(this.phase === 'connected' || this.phase === 'kitted')) return;
    this.probeSent = true;
    this._write([...PROBE_FW], 'probe');
  }

  // ---------- MC context ----------
  hydrate(node) {
    if (!node) return;
    if (node.player) this.player = node.player;
    if (node.team) this.team = node.team;
    if (node.roster) this.roster = node.roster;
    if (node.config) this.config = node.config;
    if (node.frames) this.frames = node.frames;
    if (node.catalog) this.catalog = node.catalog;   // A10: a welcome may re-hydrate the catalog/policy too
    if (node.policy) this.policy = node.policy;
    if (node.game) this.game = node.game;
    if (node.score) { this.score = node.score; this.scoreAt = this.now(); }
    if (node.match_id) this.matchId = node.match_id;
    if (node.config && node.config.night != null) this.night = !!node.config.night;
    if (this.player && this.phase === 'connected') this._set('kitted');
    if (node.frames && node.config && (this.phase === 'kitted')) {
      // A rejoining node that missed the push: apply the head like a fresh `config`.
      this._applyConfig({ config: node.config, frames: node.frames, roster: node.roster || this.roster }, 'hydrate');
    }
    if (node.start && !(node.start.match_id && this.endedMatches.includes(node.start.match_id))) this.startAt(node.start);
    this._changed();
  }

  onMcMessage({ kind, body, t }) {
    switch (kind) {
      case 'assign': return this._assign(body);
      case 'config': return this._applyConfig(body, 'config');
      case 'tutorial': return this._tutorial(body);
      case 'loadout_ack': return this._loadoutAck(body);
      case 'start': return this.startAt(body);
      case 'feedback': return this.feedback(body, t);
      case 'alert': return this.alert(body, t);
      case 'control': return this.control(body);
      case 'apply': {
        const fr = body.frames || [];
        if (this.phase === 'live') return this._write(fr, 'apply');
        // A9.1 preview: sound-only applies may play OFF-live (voice/gamertag preview at the bench) —
        // restricted to $PLAY/$SFLASH so A6.4's no-state-writes-off-live safety holds.
        if (body.preview && ['connected', 'kitted', 'lobby'].includes(this.phase) && fr.length && fr.every(f => f.startsWith('$PLAY') || f.startsWith('$SFLASH'))) return this._write(fr, 'apply preview');
        return undefined;
      }
      case 'score': if (body && typeof body === 'object') { this.score = body; this.scoreAt = this.now(); this._changed(); } return;   // may carry `board` {teams:[{team_id,name,score}], cap} for the DOWN recap
      default: return;
    }
  }

  _assign({ player, team, roster, catalog, policy, game }) {
    const wasOpen = this.kitOpen();
    if (catalog) this.catalog = catalog;
    if (policy) this.policy = policy;
    if (game) this.game = game;
    if (!wasOpen && this.kitOpen()) this.briefSeen = false;   // §4.6: the kit just opened — show the BRIEFING, the player taps through
    if (!this.kitOpen()) this.browse(false);                   // MC went back to setting up: no browser while the kit is closed
    if (this.ended) { this.ended = false; this.endAck = false; this.matchId = null; this.start = null; this.log('new match from MC — leaving the match-complete screen', 'lk'); }
    this.player = player || this.player; this.team = team || this.team; if (roster) this.roster = roster;
    if (this.phase === 'connected' || this.phase === 'idle') { if (this.bleUp) this._set('kitted'); }
    this._changed();
    if (this.browsing && !this.canPick('primary') && !this.canPick('secondary') && !this.canPick('perk')) this.browse(false);   // A10: rules locked every slot while the browser was open
  }

  _applyConfig({ config, frames, roster }, why) {
    this.config = config || this.config;
    this.browse(false);   // the LOADOUT browser is a KITTED-phase screen; a config push ends kit-out
    this.frames = frames || this.frames; if (roster) this.roster = roster;
    if (config && config.night != null) this.night = !!config.night;
    this.tutorial = false; this.tutorialWeapon = null;
    if (!this.frames || !this.frames.head) { this.log('config without frames — ignored', 'le'); return; }
    if (!this.bleUp) { this.configPending = true; this.log('config stored; gun not linked yet — head will be written on relink', 'li'); this._changed(); return; }
    this.configPending = false; this._panicked = null;
    this.headEcho = null; this.awaitingEcho = true; this.headWrittenAt = this.now();
    this._writeHead(why === 'hydrate' ? 'head (rehydrate)' : 'head');
    this.spawned = false; this.ended = false;
    if (this.phase !== 'armed' && this.phase !== 'live') this._set('lobby');
    this._changed();
  }
  /** Called by tick(): 1.5 s after the head write, report the echo (or its absence). */
  _checkEcho() {
    if (!this.awaitingEcho || this.now() - this.headWrittenAt < 1500) return;
    this.awaitingEcho = false;
    const cid = this.config && this.config.config_id;
    if (this.headEcho) this.report('ack_config', { config_id: cid, ok: true, gun_echo: this.headEcho });
    else this.report('ack_config', { config_id: cid, ok: false, err: 'no_echo' });
  }

  _tutorial({ frames, weapon, end }) {
    if (this.phase !== 'kitted' || !frames) return;
    if (end) {                               // host ended the try-out: quiet the gun, drop the panel
      this.tutorial = false; this.tutorialWeapon = null;
      this._write(frames, 'tutorial end');
      this._changed();
      return;
    }
    this.tutorial = true;
    this.tutorialWeapon = weapon || null;    // shown on the HUD: image + details of what's being tried
    this.tryoutSeen = null;                  // a fresh try-out always shows its panel
    this._write(frames, 'tutorial');
    this._changed();
  }

  // ---------- A10 self-serve kitting (docs/spec/loadout.md §4) ----------
  /** §4.1: MC opens the kit only while the host is on KIT before the push. No flag (older MC) = open. */
  kitOpen() { const p = this.policy; return !p || p.kit_open !== false; }
  /** §4.6: BUILD MY KIT ▸ / BRIEFING */
  closeBriefing() { if (!this.briefSeen) { this.briefSeen = true; this._changed(); } }
  openBriefing() { if (this.briefSeen) { this.briefSeen = false; this.browse(false); this._changed(); } }
  /** The player's rights on a slot, from MC's per-player policy (never computed locally). */
  slotRule(slot) {
    const p = this.policy; if (!p) return null;
    return (slot === 'primary' || slot === 'secondary' || slot === 'perk') ? (p[slot] || null) : null;   // A14: three rules
  }
  canPick(slot) {
    const p = this.policy, r = this.slotRule(slot);
    return !!(p && p.hud_select && r && r.choice === 'player' && this.phase === 'kitted' && !this.ended && this.kitOpen());
  }
  /** A14: what a pick would knock out of the OTHER slot, or null. Easy Reload (any perk with `effects.alt_reload`) takes the
   *  ALT button, so it cannot ride with a second weapon: picking it drops the secondary; picking a secondary drops it.
   *  The HUD asks for a second tap before sending (Tony 2026-09-04: "we should warn on that"). */
  conflictFor(slot, kind, id) {
    const lo = this.loadoutView();
    const alt = row => !!(row && row.effects && row.effects.alt_reload);
    if (slot === 'perk' && kind === 'perk' && lo.secondary && alt(this.perkRow(id))) return { slot: 'secondary', id: lo.secondary.weapon_id, name: lo.secondary.name };
    if (slot === 'secondary' && kind === 'weapon' && lo.perk && alt(lo.perk)) return { slot: 'perk', id: lo.perk.perk_id, name: lo.perk.name };
    return null;
  }
  /** Tap a row = equip. `tryIt` (weapons only) also asks MC for the try-out. Returns false if the slot isn't ours. */
  requestLoadout(slot, kind, id = null, tryIt = false) {
    if (!this.canPick(slot)) { this.log(`pick refused locally: ${slot} is not player-choice`, 'le'); return false; }
    if (slot === 'primary' && kind !== 'weapon') return false;
    if (slot === 'secondary' && kind !== 'weapon' && kind !== 'none') return false;   // A14: perks have their own slot
    if (slot === 'perk' && kind !== 'perk' && kind !== 'none') return false;
    if (kind === 'none' && slot === 'primary') return false;
    const body = { player_id: this.player && this.player.player_id, slot, kind };
    if (kind !== 'none') body.id = id;
    if (tryIt && kind === 'weapon') body.try = true;
    this.pendingPick = { slot, kind, id: kind === 'none' ? null : id, at: this.now() };
    this.loadoutAck = null;
    this.report('loadout_request', body);
    this._changed(); return true;
  }
  browse(open) {
    open = !!open;
    if (this.browsing === open) return;
    this.browsing = open;
    this.report('loadout_browse', { player_id: this.player && this.player.player_id, open });
    this._changed();
  }
  _loadoutAck({ slot, ok, reason, dropped, loadout }) {
    if (loadout && this.player) this.player.loadout = loadout;   // MC's echo is the truth (applies on ok AND on a reject → reverts the optimistic row)
    const pk = this.pendingPick;
    this.loadoutAck = { slot, ok: !!ok, reason: reason || null, dropped: dropped || null, t: this.now(), key: pk ? (pk.kind === 'none' ? 'none' : `${pk.kind}:${pk.id}`) : null };   // A14: `dropped` = the other slot this pick knocked out
    if (dropped) this.log(`pick ${slot} dropped ${dropped.slot} ${dropped.id}: ${reason || ''}`, 'lk');
    this.pendingPick = null;
    this._changed();
  }
  /** DONE on the try-out panel: hide it (the gun stays armed until MC ends the try-out or the player readies). */
  dismissTryout() { if (this.tutorial && this.tutorialWeapon) { this.tryoutSeen = this.tutorialWeapon.weapon_id; this._changed(); } }
  /** Structured loadout for the HUD: catalog rows (or id-only stubs when the catalog hasn't arrived). */
  loadoutView() {
    const lo = (this.player && this.player.loadout) || {};
    const ws = lo.weapons || [];
    const stub = id => ({ weapon_id: id, name: String(id).replace(/_/g, ' ') });
    const wrow = id => ({ kind: 'weapon', ...(this.weaponRow(id) || stub(id)) });
    const primary = ws[0] ? wrow(ws[0].weapon_id) : null;
    const secondary = ws[1] ? wrow(ws[1].weapon_id) : null;
    // A14: the perk is its own slot beside the weapons
    const perk = lo.perk ? { kind: 'perk', ...(this.perkRow(lo.perk) || { perk_id: lo.perk, name: String(lo.perk).replace(/_/g, ' '), effects: {} }) } : null;
    return { primary, secondary, perk };
  }

  setReady(ready) {
    if (this.phase !== 'kitted') return false;
    if (ready && !this.isSynced()) { this.log('cannot ready: clock not synced', 'le'); return false; }
    this.ready = !!ready;
    if (this.ready) this.browse(false);   // READY UP commits the kit — the browser closes (loadout.md §4.5)
    this.report('ready', { player_id: this.player && this.player.player_id, ready: this.ready });
    this._changed(); return true;
  }

  // ---------- start (M-START) ----------
  startAt(body) {
    this.browse(false);
    if (!body || !body.go_live_t) return { ok: false, reason: 'bad_start' };
    if (body.match_id && this.endedMatches.includes(body.match_id)) { this.log('start for an already-ended match — ignored', 'li'); return { ok: false, reason: 'match_ended' }; }
    if (this.start && body.seq != null && this.start.seq != null && body.seq < this.start.seq) return { ok: false, reason: 'stale_seq' };
    if (this.start && body.seq === this.start.seq && body.match_id === this.start.match_id) return { ok: true, state: this.phase, reason: 'noop' };
    if (this._panicked && body.match_id === this._panicked.match_id && (body.seq == null || this._panicked.seq == null || body.seq <= this._panicked.seq)) { this.log('start for a schedule I panicked out of — ignored (needs a newer seq)', 'li'); return { ok: false, reason: 'panicked' }; }
    this._panicked = null;
    if (this.config && body.config_id && body.config_id !== this.config.config_id) { this.log('start for a config I do not hold', 'le'); return { ok: false, reason: 'stale_config' }; }
    this.start = { match_id: body.match_id, go_live_t: body.go_live_t, config_id: body.config_id, seq: body.seq, countdown_s: body.countdown_s };
    this._prevRem = null;               // fresh schedule: runway cue edges re-arm
    const newMatch = body.match_id !== this.matchId;
    if (newMatch) { this.score = null; this.scoreAt = null; }   // a new match: last match's K/A/board must not show on the first DOWN
    this.matchId = body.match_id; this.cuesFired = new Set(); this.shots = 0; this.deaths = 0; this.ended = false; this._resyncRevive = false;
    // A NEW match supersedes any in-flight reconnect resync of the OLD one. Without this the resync
    // stays set, the T-0 spawn (guarded on `!this.resync`) never runs, and the gun sits alive-with-0-hp
    // until the player pulls the trigger (bench 2026-09-04, S7). Clear it so the new match spawns clean.
    if (this.resync) { this.log('new match — clearing the old resync so it spawns clean', 'li'); this.resync = null; }
    if (this.reconciling) { this.log('new match — clearing the in-flight rejoin reconcile', 'li'); this.reconciling = null; }
    // A new match must SPAWN even if the node is already `live` from a rejoin of the OLD match. Without
    // this reset, startAt skipped re-arming from `live` and resumeSchedule returned `live` early — the
    // T-0 spawn never ran and the gun sat alive-with-0-hp (bench 2026-09-04, S7, on hardware). Drop the
    // stale live/down state so the new match re-arms → spawns.
    if (newMatch) { this.spawned = false; this.alive = false; this.deadAt = 0; this.killedBy = null; this._resetHill(); }   // game 2 must not inherit game 1's owner, tally or warnings
    this._turned = false;               // last match's infection flip must not score this one as "turned" (polish 2026-09-04)
    if (this.phase === 'lobby' || this.phase === 'kitted' || this.phase === 'armed' || (newMatch && this.phase === 'live')) this._set('armed');
    this._save();
    return this.resumeSchedule();
  }

  /** E1/E5/E9: reconcile the persisted schedule against synced time (never spawn a possibly-live gun blindly). */
  resumeSchedule() {
    if (!this.start) return { ok: false, reason: 'no_schedule' };
    // No gun linked: leave the phase alone (IDLE keeps its SET MY GUN screen); onBleConnected re-derives it.
    if (!this.bleUp) return { ok: false, reason: 'gun_not_linked' };
    const now = this.now(), T = this.goLiveT;
    if (this.phase === 'live') return { ok: true, state: 'live' };
    if (now < T) { if (this.phase !== 'armed') this._set('armed'); return { ok: true, state: 'armed' }; }
    if (this.endT && now >= this.endT) { this.log('match already over on resume', 'li'); this._endLocal('expired-on-resume'); return { ok: false, reason: 'match_over' }; }
    if (this.spawned) { this._set('live'); return { ok: true, state: 'live' }; }
    // T-0 passed and we never spawned: grace / hot-join (E5).
    const late = now - T;
    this.log(late <= C.LATE_ARM_GRACE_MS ? `late spawn (+${late} ms, grace)` : `hot-join (+${Math.round(late / 1000)} s)`, 'lk');
    this._spawn(late <= C.LATE_ARM_GRACE_MS);
    return { ok: true, state: 'live', reason: late <= C.LATE_ARM_GRACE_MS ? 'grace' : 'hot_join' };
  }

  /** A11.6 headset: write a [frame, hold_s] sequence to the headset (frames.headset.*), each step after
   *  the previous one's hold. A newer sequence supersedes an older one: a hit flash that lands while the
   *  start flash is still running simply takes over (the last frame written wins on the hardware). */
  _headset(seq, why) {
    if (!seq || !seq.length) return;
    const gen = (this._hsGen = (this._hsGen || 0) + 1);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: a delayed step checks this too, alongside `gen`'s supersession check
    let t = 0;
    for (const step of seq) {
      const frame = step[0], hold = Math.max(0, Math.round((step[1] || 0) * 1000));
      if (t === 0) this._write([frame], `headset ${why}`);
      else this.delay(t, () => { if (this._hsGen === gen && this._lightGen === lg) this._write([frame], `headset ${why}`); });
      t += hold;
    }
  }
  /** A11.7: take the gun body `after_spawn_s` after a spawn/revive: blank (stops the firmware breathing), then the
   *  rest frame. Inside the spawn burst the blank does not take -- the spawn animation re-enables the breathing
   *  (bench ladder 2026-09-04: +1.0 s and +1.5 s breathing, +2.0 s solid; 2.5 s shipped). Cancelled by a death or
   *  another spawn before it fires. */
  _gunTake() {
    const g = this.frames && this.frames.gun;
    this._gunTaken = false; this._gunBand = null;
    // A16: a fresh life starts with no readout — any hold from the last life is dead the moment `_gunTaken`
    // drops false (the tick-poll below is gated on it), but null the frame too so a reload glance before
    // the take completes has nothing stale to show.
    this._readoutFrame = null; this._readoutHoldActive = false; this._readoutLastWriteAt = null; this._readoutLastPool = null;
    // A16.3: a revive cancels any drop/gain animation from the last life outright (bar-spec: "Cancel
    // everything ... on revive") -- bump `_roGen` so a stray scheduled step from the old life cannot land.
    this._roGen = (this._roGen || 0) + 1; this._roLevel = null; this._roPool = null; this._roAnimating = false; this._roBlinkAt = 0; this._roBlinkOn = false;
    // ⚠ The PER-POOL map must be cleared too, not just `_roLevel`. Missing this made the "a life's first
    // paint animates from FULL" rule silently apply to the first life only: from life 2 on, any pool hit in
    // the PREVIOUS life still had an entry here, so its next drop animated from wherever it ended last life.
    // `stage.py` clears and reseeds at spawn, so the bench would have looked right while the phone did not --
    // the exact failure this map was added to fix, reintroduced in the other direction. Caught in the polish
    // loop's final pass, 2026-09-07, by replaying a second life rather than by reading the code.
    this._roLevels = {}; this._roLastStartAt = null;
    if (!g || !Array.isArray(g.take) || !g.take.length) return;
    // F86: `gun.take` was compiled for the ARMING team. After an infection flip this gun is on another
    // team, and taking it with the old frames painted the old colour back over a body the firmware had
    // just moved -- so the take is looked up by the team we are on NOW when MC shipped one for it.
    const flipTake = this.frames.team_flip_take && this.teamTid != null && this.frames.team_flip_take[String(this.teamTid)];
    const take = (Array.isArray(flipTake) && flipTake.length) ? flipTake : g.take;
    const rest = take === g.take ? g.rest : take[take.length - 1];
    const life = (this._gunLife = (this._gunLife || 0) + 1);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: a blank+paint must not land after _endLocal/panic writes $CLEAR/$SP,99
    this.delay(Math.round((g.after_spawn_s || 2.5) * 1000), () => {
      if (life !== this._gunLife || this._lightGen !== lg || !this.alive) return;
      this._write(take, 'gun take'); this._gunTaken = true; this._gunBand = rest; this._readoutFrame = rest;   // A16: the strip now shows `rest` — dark until a pool change paints a band
    });
  }
  /** A11.7: the gun body's resting frame when the game owns it (frames.gun; absent = firmware breathing).
   *  team/dark: a fixed frame; health: the band for the current hp (bands highest-first, [fraction, frame]). */
  _gunRest() {
    const g = this.frames && this.frames.gun; if (!g || !g.rest) return null;
    if (g.in_play !== 'health' || !Array.isArray(g.bands) || !g.bands.length) return g.rest;
    const frac = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    const band = g.bands.find(b => frac > b[0]) || g.bands[g.bands.length - 1];
    return band[1];
  }
  /** A16 §3.1/§5: on every `$HP`, repaint the transient pool readout for the innermost pool that moved
   *  (or, when the bundle has no `gun.readout`, fall back unchanged to the pre-A16 `gun.bands` health-only
   *  paint). Replaces `_gunHealthPaint` as the one entry point `_onHp` calls. */
  _gunPoolPaint(movedPool) {
    const g = this.frames && this.frames.gun; if (!g) return;
    if (g.readout && Array.isArray(g.readout.pools) && g.readout.pools.length) { if (movedPool) this._gunReadoutPaint(movedPool); return; }
    // legacy path (readout absent): unchanged health-band behaviour, keyed off health only
    if (g.in_play !== 'health' || !Array.isArray(g.bands) || !g.bands.length || !this._gunTaken) return;
    if (this.phase !== 'live' || !this.alive || !this.spawned) return;
    const f = this._gunRest(); if (!f || f === this._gunBand) return;
    this._gunBand = f; this._write([f], 'gun health hp');
  }
  /** A16 §5: the current band for one `gun.readout.pools[]` entry — highest band whose fraction the
   *  pool's level/max exceeds (bands ordered highest-first, same `frac > threshold` rule as `_gunRest`). */
  _readoutBand(entry) {
    const level = entry.pool === 'health' ? this.hp : entry.pool === 'armor' ? this.armor : this.shield;
    const frac = entry.max > 0 ? level / entry.max : 0;
    const bands = entry.bands || [];
    return bands.find(b => frac > b[0]) || bands[bands.length - 1] || null;
  }
  /** A16.3 (bar-spec 2026-09-07): the 7-level (0-6) reading for one `gun.readout.pools[]` entry that
   *  carries `levels` — `round(fraction * 6)` clamped to [0,6], floor-clamped to 1 while the pool has
   *  anything left so "1 HP" and "dead" never render the same (poolgauge._segments' rule, extended). */
  _readoutLevel(entry) {
    const value = entry.pool === 'health' ? this.hp : entry.pool === 'armor' ? this.armor : this.shield;
    const frac = entry.max > 0 ? value / entry.max : 0;
    let level = Math.max(0, Math.min(6, Math.round(frac * 6)));
    if (level === 0 && value > 0) level = 1;
    return level;
  }
  /** A16.5: the node's own view of its pools, keyed the way `handoverPool` expects. Mirrors
   *  `stage.py`'s `_pool_values`. */
  _poolValues() { return { shield: this.shield, armor: this.armor, health: this.hp }; }
  /** A16.5: names of every pool the bundle configured a readout for (`bands` or `levels`, either shape) --
   *  `handoverPool` only hands over to a pool the current loadout actually has. Mirrors `stage.py`'s
   *  `_readout_configured`. */
  _readoutConfiguredPools() {
    const readout = this.frames && this.frames.gun && this.frames.gun.readout;
    return (readout && Array.isArray(readout.pools) ? readout.pools : []).map(p => p.pool);
  }
  /** A16 §3.1: write the moved pool's band ONLY if it differs from the frame currently on the strip.
   *  Restarts the hold on every real change; a change that would repaint within READOUT_COALESCE_MS of the
   *  last WRITE is dropped (never queued, same shape as `_pain`'s PAIN_GAP_MS) but still restarts the hold,
   *  so a flurry of hits holds the last-shown band rather than flickering through several. The hold itself
   *  is tick()-polled (`_gunReadoutTick`), not `this.delay`, because later changes must be able to restart
   *  it — a one-shot delayed callback cannot be un-scheduled. */
  _gunReadoutPaint(pool) {
    if (this.phase !== 'live' || !this.alive || !this.spawned || !this._gunTaken) return;
    const g = this.frames.gun, readout = g.readout;
    const entry = readout.pools.find(p => p.pool === pool); if (!entry) return;
    // A16.3: a `levels` entry (the 7-level bar + drop/gain animation) is a completely separate path; a
    // `bands` entry (below) is untouched by any of this — the graceful-degradation contract in full.
    if (Array.isArray(entry.levels) && entry.levels.length === 7) { this._gunReadoutPaintLevels(readout, entry, pool); return; }
    if (!Array.isArray(entry.bands) || !entry.bands.length) return;
    const band = this._readoutBand(entry); if (!band) return;
    this._readoutLastPool = pool;   // A16: which pool a reload should glance -- the one that most recently actually moved, not a fresh "is it below max" guess (shield defaults to 0 and would always look "damaged")
    const frame = band[1];
    if (frame === this._readoutFrame) return;   // no visible change — nothing to write, hold left alone
    const now = this.now(), holdMs = Math.max(0, Math.round((readout.hold_s != null ? readout.hold_s : 4) * 1000));
    if (this._readoutLastWriteAt != null && now - this._readoutLastWriteAt < READOUT_COALESCE_MS) {
      this._readoutHoldStartAt = now; this._readoutHoldMs = holdMs; this._readoutHoldActive = true;   // coalesced: restart the hold, drop the write
      return;
    }
    this._write([frame], `readout ${pool}`);
    this._readoutFrame = frame; this._readoutLastWriteAt = now;
    this._readoutHoldStartAt = now; this._readoutHoldMs = holdMs; this._readoutHoldActive = true;
  }
  /** A16.3 (bar-spec 2026-09-07): entry point for a `levels`-table pool. Skips a true no-op (same pool,
   *  same level, already displayed — covers a partial level mid-blink too, since `_roLevel` names the
   *  level, not the current half of its blink); otherwise (re)starts the drop/gain animation from whatever
   *  level is CURRENTLY on the strip. A change mid-animation lands here again and restarts it from there —
   *  never queued, never a second one running (bar-spec: "cancels it and restarts from the currently
   *  displayed level"). First paint of a life (`_roLevel` still null) has no "from" to drop out of, so it
   *  settles straight onto the target level with no animation. */
  _gunReadoutPaintLevels(readout, entry, pool) {
    const level = this._readoutLevel(entry);
    this._readoutLastPool = pool;
    // A16.3 polish (2026-09-07): the "from" level is tracked PER POOL. It used to be one shared
    // `_roLevel`, so if the strip had last shown a different pool (shield at 4, say) and a later hit
    // finally broke into health, health animated from SHIELD's level -- a wrong-sized drop, or none at
    // all when the numbers happened to match. `stage.py` already kept a per-pool map, so the bench would
    // have looked right while the phone players actually use did not.
    this._roLevels = this._roLevels || {};
    const shown = this._roPool === pool ? this._roLevel : this._roLevels[pool];
    if (this._roPool === pool && this._roLevel === level) return;
    // Photosensitivity: every retrigger replays a dark->lit transition, and the ceiling is 3 light-ups in
    // any one second (poolgauge's own "looks like it's having a seizure" warning). Under automatic fire a
    // level can change several times a second, so coalesce: inside the window, retarget WITHOUT replaying
    // the lead + all-off blink -- step straight to the new level from where the strip already is.
    const now = this.now();
    const rapid = this._roLastStartAt != null && (now - this._roLastStartAt) < (readout.min_gap_ms != null ? readout.min_gap_ms : 400);
    this._roLastStartAt = now;
    // A16.3 (polish 2026-09-07): on a life's FIRST paint for a pool there is no `_roLevel` yet. Settling
    // straight in would mean the first hit of EVERY life has no drop animation -- health and armour start
    // full, so that is the commonest case there is, and it is exactly the moment the animation is for
    // ("show current health in one blink then show it dropping" -- Tony). It also made the bench stage lie:
    // stage.py seeds its own per-pool state at spawn and DID animate here, so the operator would have been
    // shown a sequence the phone never plays. Animate from the pool's FULL level instead (the level it was
    // sitting at, undisplayed, before this change), which is what the stage does.
    const from = shown != null ? shown : this._readoutFullLevel(entry, pool);
    this._readoutAnimStart(readout, entry, pool, from, level, rapid);
  }
  /** A16.3: the level a pool sits at when a life starts, used as the "from" for its first animation.
   *  Health and armour spawn FULL (top level); shield spawns EMPTY on real hardware (it is IR-granted
   *  only, P16 -- and F41: the fake tagger wrongly reports 70 there, so do not infer this from telemetry). */
  _readoutFullLevel(entry, pool) {
    const top = Array.isArray(entry.levels) ? entry.levels.length - 1 : 0;
    return pool === 'shield' ? 0 : top;
  }
  /** A16.3: drive the lead/blink-gap/step-down/settle sequence (or, for a GAIN, straight into stepping
   *  with no lead/gap) from `from` to `to` on `entry`. Every scheduled step is gated on a fresh `_roGen`
   *  (bumped here, exactly the `_hsGen` pattern) so a later change, a death or a revive invalidates it —
   *  see the explicit bumps in `_death`/`_gunTake` — plus `_lightGen`, shared with every other delayed
   *  light write, for the teardown case (end/panic/BLE drop). Writes only frames the bundle supplied
   *  (`entry.levels[l][0/1]`); it never composes a `$GLED` itself (A4.2). */
  _readoutAnimStart(readout, entry, pool, from, to, rapid) {
    const gen = (this._roGen = (this._roGen || 0) + 1);
    const lg = (this._lightGen = this._lightGen || 0);
    this._roPool = pool; this._roAnimating = true;
    const leadMs = Math.max(0, Math.round(readout.lead_ms != null ? readout.lead_ms : 180));
    const gapMs = Math.max(0, Math.round(readout.blink_gap_ms != null ? readout.blink_gap_ms : 80));
    const stepMs = Math.max(0, Math.round(readout.step_ms != null ? readout.step_ms : 120));
    const ok = () => this._roGen === gen && this._lightGen === lg && this.alive;
    const paint = (lvl, why) => {
      const f = entry.levels[lvl] && entry.levels[lvl][0];
      this._roLevel = lvl;
      (this._roLevels = this._roLevels || {})[pool] = lvl;   // per-pool memory: what THIS pool last showed
      if (f) { this._readoutFrame = f; this._write([f], `readout ${pool} anim ${why}`); }
    };
    // A16.5 (2026-09-09, found on the gun): the drain has reached its target. If that target is level 0
    // and something inward still has value, hand over and show THAT pool's own level instead of settling
    // into (and holding, for the full `hold_s`) an all-dark strip -- mirrors `stage.py` `_level_animate`'s
    // post-loop handover exactly, including the one-`step_ms`-beat pause first (so "it is gone" registers
    // before the handover paints) and painting the inner pool SOLID -- it did not change, so it gets no
    // drop animation of its own. Anything above zero settles normally, unchanged from before A16.5.
    const settle = lvl => {
      if (!ok()) return;
      if (lvl === 0) {
        const nxt = handoverPool(pool, this._poolValues(), this._readoutConfiguredPools());
        const inner = nxt !== pool && readout.pools.find(p => p.pool === nxt);
        if (inner && Array.isArray(inner.levels) && inner.levels.length === 7) {
          this.delay(stepMs, () => {
            if (!ok()) return;
            const target = this._readoutLevel(inner);
            const f = inner.levels[target] && inner.levels[target][0];
            this._roPool = nxt; this._roLevel = target;
            (this._roLevels = this._roLevels || {})[nxt] = target;
            // The strip now shows the HANDED-OVER pool, not the one that emptied -- a reload glance must
            // re-show what is actually on the strip (health), not re-derive the emptied pool (armor at 0),
            // which would repaint the very dark frame this feature exists to avoid. `stage.py` has no
            // reload path to expose this gap; the phone does, so this line is a deliberate addition on top
            // of the mirror, not a divergence from it.
            this._readoutLastPool = nxt;
            if (f) { this._readoutFrame = f; this._write([f], `readout ${nxt} handover from ${pool}`); }
            this._readoutSettle(gen, lg, readout, inner, nxt, target);
          });
          return;
        }
      }
      this._readoutSettle(gen, lg, readout, entry, pool, lvl);
    };
    const step = cur => {
      if (!ok()) return;
      const next = cur < to ? cur + 1 : cur > to ? cur - 1 : cur;
      paint(next, `step ${next}`);
      if (next === to) { settle(to); return; }
      this.delay(stepMs, () => step(next));
    };
    if (to === from) { paint(to, 'settle'); settle(to); return; }
    if (to > from) { step(from); return; }   // gain: same steps, no initial lead/blink-gap
    // `rapid` = another change inside the min gap. Step straight down from where the strip already is,
    // skipping the lead freeze and the all-off blink: replaying those under automatic fire is what would
    // put more than three light-ups in a second (the photosensitivity ceiling), and the information --
    // the bar getting shorter -- is carried by the steps, not by the blink.
    if (rapid) { step(from); return; }
    // drop: freeze the level we were AT solid for lead_ms (this is Tony's "show current health in one
    // blink" -- it also stops a running blink outright, since the from-level may have been blinking), one
    // all-off blink for blink_gap_ms, then step down.
    paint(from, 'from');
    this.delay(leadMs, () => {
      if (!ok()) return;
      const off = entry.levels[0] && entry.levels[0][0];
      if (off) { this._readoutFrame = off; this._write([off], `readout ${pool} anim blank`); }
      this.delay(gapMs, () => step(from));
    });
  }
  /** A16.3: settle on `level` -- arms the ordinary `hold_s` timer (`_gunReadoutTick` takes over from here,
   *  exactly as it does for a `bands` paint) and, at a PARTIAL level (`entry.levels[level][1]` present),
   *  arms the alternating top-segment blink. The blink itself is tick()-polled (`_gunReadoutTick`), NOT a
   *  self-rescheduling `this.delay` chain -- same reasoning as the hold: it must be repeatedly restartable
   *  by a later settle, and (proven the hard way) a `this.delay` that re-schedules itself recurses forever
   *  under a test harness whose `delay` runs its callback inline. */
  _readoutSettle(gen, lg, readout, entry, pool, level) {
    if (!(this._roGen === gen && this._lightGen === lg && this.alive)) return;
    this._roAnimating = false;
    const now = this.now(), holdMs = Math.max(0, Math.round((readout.hold_s != null ? readout.hold_s : 4) * 1000));
    this._readoutLastWriteAt = now; this._readoutHoldStartAt = now; this._readoutHoldMs = holdMs; this._readoutHoldActive = true;
    const pair = entry.levels[level];
    if (pair && pair[1]) { this._roBlinkOn = false; this._roBlinkAt = now; }   // the solid half is already on the strip from the settling step
    else this._roBlinkAt = 0;   // whole level (6/4/2/0): no blink
  }
  /** A16 §3.1 reload: paint the CURRENT readout for `reload_glance_s` — recomputed fresh (in case the pool
   *  has since changed further) for whichever pool most recently actually moved this life, NOT the
   *  last-shown frame, so a reload glances the real state even after the ordinary hold already reverted to
   *  rest. Deliberately NOT "whatever pool is below its max": shield spawns at 0 by hardware default
   *  (bench 2026-08-27) and would always look "damaged" against a configured max, even for a loadout that
   *  never grants any. A no-op when nothing has moved this life (nothing to glance) or the bundle has no
   *  readout. */
  _gunReadoutReloadGlance() {
    const g = this.frames && this.frames.gun, readout = g && g.readout;
    if (!readout || !this._gunTaken) return;
    if (this.phase !== 'live' || !this.alive || !this.spawned) return;
    const poolName = this._readoutLastPool; if (!poolName) return;
    const entry = readout.pools.find(p => p.pool === poolName); if (!entry) return;
    let frame;
    // A16.3: a `levels` pool glances its current level SOLID -- the glance is a plain peek, not another
    // animation, so it also cancels any drop/gain/blink in flight (`_roGen` bump) exactly as it already
    // overrides the ordinary `bands` hold below.
    if (Array.isArray(entry.levels) && entry.levels.length === 7) {
      const level = this._readoutLevel(entry); const pair = entry.levels[level]; frame = pair && pair[0];
      if (!frame) return;
      this._roGen = (this._roGen || 0) + 1; this._roAnimating = false; this._roPool = poolName; this._roLevel = level; this._roBlinkAt = 0; this._roBlinkOn = false;
      // the glance is what is now DISPLAYED for this pool, so record it per pool too -- otherwise a glance
      // that cuts an animation short leaves the map holding an intermediate step, and the next drop on this
      // pool (after some other pool has been shown) animates from a level that was never on the strip.
      (this._roLevels = this._roLevels || {})[poolName] = level;
    } else {
      const band = this._readoutBand(entry); if (!band) return; frame = band[1];
    }
    this._write([frame], 'readout reload glance');
    const now = this.now();
    this._readoutFrame = frame; this._readoutLastWriteAt = now;
    this._readoutHoldStartAt = now; this._readoutHoldMs = Math.max(0, Math.round((readout.reload_glance_s != null ? readout.reload_glance_s : 2) * 1000)); this._readoutHoldActive = true;
  }
  /** A16 §5: reverts the strip to `gun.rest` once the current readout/glance hold has run out. Called from
   *  tick() (the same pattern as `_downRearm`/`_reassertDeathBlink`) so a later pool change or reload can
   *  restart the hold before it fires. Gated on alive/spawned/taken/live exactly as the paint call is.
   *  A16.3: also skipped outright while `_roAnimating` -- the drop/gain animation owns the strip until
   *  `_readoutSettle` arms the real hold, and an in-flight step must never be cut off by this poll. */
  _gunReadoutTick(now) {
    const g = this.frames && this.frames.gun, readout = g && g.readout;
    if (!readout || !this._readoutHoldActive || !this._gunTaken || this._roAnimating) return;
    if (!this.alive || !this.spawned || this.phase !== 'live') return;
    // A16.3: the hold-expiry check runs FIRST -- an expiry must win outright over a blink toggle due in
    // the very same tick (otherwise a blink write and the revert-to-rest write would both land here).
    if (now - this._readoutHoldStartAt >= this._readoutHoldMs) {
      this._readoutHoldActive = false; this._roBlinkAt = 0;
      if (g.rest && this._readoutFrame !== g.rest) { this._readoutFrame = g.rest; this._write([g.rest], 'readout rest'); }
      return;
    }
    // The partial-level blink, tick()-polled (see `_readoutSettle`) -- runs only while `_roBlinkAt` is
    // armed, and stops on its own the instant the hold above expires.
    if (this._roBlinkAt && this._roPool != null) {
      const entry = readout.pools.find(p => p.pool === this._roPool);
      const pair = entry && Array.isArray(entry.levels) ? entry.levels[this._roLevel] : null;
      if (pair && pair[1]) {
        const blinkMs = Math.max(0, Math.round(readout.blink_ms != null ? readout.blink_ms : 400));
        if (now - this._roBlinkAt >= blinkMs) {
          this._roBlinkOn = !this._roBlinkOn;
          const f = this._roBlinkOn ? pair[1] : pair[0];
          if (f) { this._readoutFrame = f; this._write([f], `readout ${this._roPool} blink`); }
          this._roBlinkAt = now;
        }
      } else this._roBlinkAt = 0;
    }
  }
  /** The headset's resting frame between events (dark by default, or the team colour). */
  _headsetRest() { const h = this.frames && this.frames.headset; return h && h.rest ? [[h.rest, 0]] : null; }
  /** A16 §3.3: the sequence for one held role. `carrier` is tid-keyed (whose flag/objective); the rest
   *  (infected/vip/beacon/extracted) are flat. Falls back to the pre-A16 `headset.carrier` table for
   *  `carrier` when `headset.role` is absent — the only role that ever existed before it. */
  _roleSeq(name, tid) {
    const h = this.frames && this.frames.headset; if (!h) return null;
    if (h.role) {
      const entry = h.role[name];
      // A role sequence is either FLAT (carrier is white now — team colours are identity, §3.3 — as are
      // vip/beacon/extracted) or tid-keyed (infected: solid in the turned-into team's colour, one entry
      // per possible team). Branch on the actual shape rather than hard-coding it per role name, so a
      // later bundle reshuffling which roles are flat vs keyed does not silently break the lookup.
      if (Array.isArray(entry)) return entry;
      if (entry && typeof entry === 'object') return entry[String(tid)] || null;
      return null;
    }
    // legacy path (headset.role absent): only `carrier` ever existed, and it WAS tid-keyed (the flag's colour)
    return name === 'carrier' ? ((h.carrier && h.carrier[String(tid)]) || null) : null;
  }
  /** A16 §3.3: the headset holds AT MOST ONE role at a time. `on` assigns it (superseding whatever role
   *  was active — a new one simply overwrites `_activeRole`); `off` ends it and returns to `headset.rest`,
   *  but only if THAT role is the one currently active (a stale "off" for a role that already ended, e.g.
   *  a race with a hit re-assert, must not clobber a newer one). The re-assert-after-a-hit call is
   *  `_roleSeq` + `_headsetFlash` from `_onHp`, not this method — a role is not re-WRITTEN every tick,
   *  only when something (assignment, end, or a hit) actually changes what should be on the lamp. */
  _setRole(name, on, tid) {
    const h = this.frames && this.frames.headset; if (!h) return;
    if (on) {
      const seq = this._roleSeq(name, tid); if (!seq) return;
      this._activeRole = { name, tid: tid != null ? tid : null };
      if (name === 'carrier') this.carrying = tid;   // keeps the pre-A16 `carrying` field (read by state()/other callers) in sync
      this._headset(seq, `role ${name}${tid != null ? ' ' + tid : ''}`);
    } else if (this._activeRole && this._activeRole.name === name) {
      this._activeRole = null;
      if (name === 'carrier') this.carrying = null;
      this._headset(this._headsetRest(), `role ${name} off`);
    }
  }
  /** Back-compat entry point: flag/objective carrier blink, now routed through the general role mechanism
   *  (§3.3). Every existing caller (`alert()`'s objective_taken/objective_scored/flag_returned) is unchanged. */
  _carrier(on, tid) { this._setRole('carrier', on, tid); }
  /** A16 §C: node-initiated headset FLASH sequences (the hit flash, a role re-assert after a hit) share the
   *  gun burst's 1 s minimum — a burst weapon plus the firmware's own hit flash could otherwise exceed 3
   *  flashes/s on one lamp. Dropped, never queued (the `_pain`/PAIN_GAP_MS shape). The down rearm and the
   *  low-health alert bypass this entirely (they call `_headset`/`_write` directly) and must NEVER be gated. */
  _headsetFlash(seq, why) {
    const now = this.now();
    if (this._lastHeadsetFlashAt != null && now - this._lastHeadsetFlashAt < EVENT_MIN_GAP_MS) return;
    this._lastHeadsetFlashAt = now;
    this._headset(seq, why);
  }
  /** A16 §D: the white "you're live" flash is scheduled a full second after `$SPAWN` — never inline —
   *  because `$SPAWN` itself clears the headset and can swallow a flash written any sooner (the old ~50 ms
   *  offset; +1.0 s is the only measured-good one, led-language.md §3.2 D). Used for `start` and `respawn`. */
  _headsetDelayed(seq, why, delayMs = 1000) {
    if (!seq || !seq.length) return;
    const lg = (this._lightGen = this._lightGen || 0);
    this.delay(delayMs, () => { if (this._lightGen === lg && this.alive) this._headset(seq, why); });
  }

  /** A11 presentation event: the bundle's `leds[kind]` burst (frames with holds) + `cues[kind]` sound.
   *  The burst is the hardware-tuned three-flash pattern (2026-09-03) and MUST NOT be repainted or
   *  extended -- a fourth flash in a second is the epilepsy line; so events closer than
   *  EVENT_MIN_GAP_MS apart drop their lights (the sound still plays). */
  _event(kind) {
    const f = this.frames; if (!f) return;
    const pick = this._pickCue(kind);
    if (pick.frame) this._write([pick.frame], `event cue ${kind}${pick.tag}`);
    this._eventLeds(kind);
  }
  /** A15 (Tony 2026-09-06: "the kill confirm sound and taunts should be selected on single kill at random"):
   *  an event whose sound is a `voice:<role>` with several takes ships them all in `cue_pools[kind]`;
   *  pick one at random per event so the gun does not say the same line every time. `cues[kind]` (one
   *  frame) is the pre-A15 shape and the fallback, so an older bundle plays exactly as before. */
  _pickCue(kind) {
    const f = this.frames; if (!f) return { frame: null, tag: '' };
    const single = f.cues && f.cues[kind];
    if (single === '') return { frame: null, tag: '' };   // deliberately mute (announcer off): the pool does not override the profile
    const pool = f.cue_pools && f.cue_pools[kind];
    if (Array.isArray(pool) && pool.length > 1) {
      const i = Math.min(pool.length - 1, Math.max(0, Math.floor(this.rng() * pool.length)));
      return { frame: pool[i], tag: ` (${i + 1}/${pool.length})` };
    }
    return { frame: (f.cues && f.cues[kind]) || null, tag: '' };
  }
  /** `' + spawn line (VAN 2/3)'` for a write reason: the take's id (token 4 of the $PLAY) and its place in the pool. */
  _lineTag(pick) {
    if (!pick || !pick.frame) return '';
    const id = (pick.frame.split(',')[4] || pick.frame.split(',')[1] || '').trim();
    return ` + spawn line (${id}${pick.tag ? ' ' + pick.tag.trim().slice(1, -1) : ''})`;
  }
  /** A15.3: one random frame of `frames[kind]` (a LIST of full frames -- `pset_pool`: one $PSET per death-scream
   *  take). `{frame: null}` when the bundle has no such pool (pre-A15.3), so nothing extra is written. */
  _pickFrame(kind) {
    const pool = this.frames && this.frames[kind];
    if (!Array.isArray(pool) || !pool.length) return { frame: null, tag: '', id: '' };
    const i = pool.length > 1 ? Math.min(pool.length - 1, Math.max(0, Math.floor(this.rng() * pool.length))) : 0;
    const frame = pool[i];
    const id = kind === 'pset_pool' ? (frame.split(',')[10] || '').trim() : '';   // $PSET token 10 = deathScream
    return { frame, tag: pool.length > 1 ? ` ${i + 1}/${pool.length}` : '', id };
  }
  /** A17: one random take of `frames.sir_pool` -- a LIST of frames (a whole `$SIR` table), not one frame.
   *  `[]` when the bundle has no pool (pre-A17), so nothing extra is written. Never returns the take we
   *  wrote last: the point is that the same weapon does not land the same clip twice running. */
  _pickTable(kind) {
    const pool = this.frames && this.frames[kind];
    if (!Array.isArray(pool) || !pool.length) return [];
    let i = pool.length > 1 ? Math.min(pool.length - 1, Math.max(0, Math.floor(this.rng() * pool.length))) : 0;
    if (pool.length > 1 && i === this._lastSirTake) i = (i + 1) % pool.length;
    this._lastSirTake = i;
    return Array.isArray(pool[i]) ? pool[i] : [];
  }
  /** A15.3 (Tony 2026-09-06: "The long vs short pain should be used depending on the amount of damage. A big sniper
   *  shot -> long pain. A normal round -> short pain."): the $PSET pain fields ship EMPTY and WE play the grunt on
   *  each registered hit -- `pain_melee` on a melee word (proto 13), `pain_long` when the hit took at least
   *  `voice.pain_long_min` (40: shotgun / snipers / power weapons), else `pain_short`; one random take of that pool.
   *  Gated to one grunt per PAIN_GAP_MS (a burst of rifle hits must not queue six grunts in the gun); never on a
   *  lethal hit (the native death scream plays). `dmg` is what the pools actually lost (crit included).
   *
   *  A17 (Tony 2026-09-07: "only use the character hit sounds when real health is taken down"): the grunt is the
   *  CHARACTER being hurt, so it only plays when the hit reached HEALTH. `pool` is the innermost pool that moved
   *  (`_onHp`, mirroring `poolgauge.changed_pool`): a hit absorbed entirely by armour or shield is a hit on
   *  EQUIPMENT and the player hears the firmware's material sound for that pool ($PSET hitArrmor / hitShield,
   *  `hitaudio.MATERIAL_POOLS`) instead -- metal, not a voice. Short vs long is still chosen by damage exactly as
   *  above, from the same pain pools. This matches what `low_health` already does: the hurt loop fires only once
   *  armour is gone and HP is actually dropping. A bundle from an older MC passes no pool and grunts as before. */
  _pain(dmg, proto, pool) {
    const f = this.frames; if (!f) return;
    if (pool && pool !== 'health') return;   // A17: armour/shield took it -- equipment, not the character
    // A17.3 (Tony, bench 2026-09-07, asked explicitly and answered "total"): `dmg` is the TOTAL pools lost,
    // armour and shield included -- NOT the HP portion. A big hit sounds big regardless of what stopped it.
    // The consequence is deliberate and looks like a bug: the hit that breaks THROUGH armour sums the armour
    // absorbed plus the HP taken, so armour 30->0 with HP 45->35 is dmg 40 and trips the long pain for a hit
    // that cost 10 HP. That is the intended reading -- a round that strips your plating and reaches you IS a
    // heavy hit -- and it is the one place where the A17 gate ("armour absorbing is equipment, not the
    // character") and the pain SIZING deliberately disagree. Do not "fix" this to `prevHp - hp`.
    const kind = proto === 13 ? 'pain_melee' : dmg >= ((f.voice && f.voice.pain_long_min) || 40) ? 'pain_long' : 'pain_short';
    if (!((f.cues && f.cues[kind]) || (f.cue_pools && f.cue_pools[kind]))) return;   // pre-A15.3 bundle: the firmware's own pains
    const now = this.now();
    if (this._lastPainAt != null && now - this._lastPainAt < PAIN_GAP_MS) return;   // drop, never queue
    this._lastPainAt = now;
    const pick = this._pickCue(kind);
    if (pick.frame) this._write([pick.frame], `pain ${kind.slice(5)} (${(pick.frame.split(',')[4] || '').trim()}${pick.tag}) ${dmg} dmg into ${pool || 'pools'}`);
  }
  /** The lights of an event without its sound (feedback plays the medal lines itself). */
  _eventLeds(kind) {
    const f = this.frames; if (!f) return;
    const seq = f.leds && f.leds[kind];
    if (!seq || !seq.length) return;
    const now = this.now();
    if (this._lastEventLed != null && now - this._lastEventLed < EVENT_MIN_GAP_MS) return;
    this._lastEventLed = now;
    let t = 0;
    const gen = (this._hsGen = this._hsGen || 0);   // an event's static $HLED must not land over a later headset sequence (death blink, hit flash); seed the counter so the check is not undefined === 0 after a reload
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: every delayed step below (headset AND gun) checks this
    for (const step of seq) {
      const frame = step[0], hold = Math.max(0, Math.round((step[1] || 0) * 1000));
      if (frame.startsWith('$HLED')) {
        if (!this.alive) { t += hold; continue; }   // down: the out-blink owns the headset (polish 2026-09-04)
        if (t === 0) this._write([frame], `event led ${kind}`); else this.delay(t, () => { if (this._hsGen === gen && this._lightGen === lg && this.alive) this._write([frame], `event led ${kind}`); });
      } else if (t === 0) this._write([frame], `event led ${kind}`); else this.delay(t, () => { if (this._lightGen === lg) this._write([frame], `event led ${kind}`); });
      t += hold;
    }
    const g = f.gun;
    // A16 §3.1: generalises the old health-band tail restore below — the burst must end on whatever the
    // readout is CURRENTLY showing (the live band, if its hold is still running) and never on the top band.
    // A16.3: `_roAnimating` counts alongside the hold here too -- a burst landing mid drop/gain animation
    // must restore the frame the animation actually left on the strip, not jump to rest underneath it.
    if (g && g.readout && this._gunTaken) {
      this.delay(t, () => {
        if (this._lightGen !== lg || !this.alive) return;
        if ((this._readoutHoldActive || this._roAnimating) && this._readoutFrame && this._readoutFrame !== g.rest) { this._write([this._readoutFrame], `readout after ${kind}`); }
        else if (g.rest) { this._readoutFrame = g.rest; this._readoutHoldActive = false; this._write([g.rest], `readout rest after ${kind}`); }
      });
    } else if (g && g.in_play === 'health' && this._gunTaken) this.delay(t, () => { if (this._lightGen !== lg) return; const r = this._gunRest(); if (r && this.alive) { this._gunBand = r; this._write([r], `gun health after ${kind}`); } });   // A11.7: the burst ended on the full-health frame; restore the real band
  }
  _cue(key) {
    const f = this.frames && this.frames.cues && this.frames.cues[key];
    if (f && !this.cuesFired.has(key)) { this.cuesFired.add(key); this._write([f], `cue ${key}`); }
  }
  _spawn(withCountdown) {
    if (!this.frames) return;
    if (withCountdown && !this.cuesFired.has('countdown')) this._cue('countdown');
    // A15.2 (Tony 2026-09-06, bench-verified): the $PSET cry field ships EMPTY so the firmware says nothing at $SPAWN,
    // and WE play one take of the spawn pool in the SAME write ($SPAWN then $PLAY plays clean; a $PLAYX between
    // them clipped the firmware's line). A pre-A15.2 bundle has no cues.spawn: nothing is appended.
    const sp = this._pickCue('spawn');
    // A15.3: the death scream stays NATIVE but is rolled per LIFE -- one of the bundle's pre-composed $PSET frames
    // (one per scream take) goes out first, in the same write (bench 2026-09-06: a $PSET re-sent in play keeps $SIR,
    // does not heal, the gun fires). No pset_pool (pre-A15.3): nothing prepended, the head's $PSET stands.
    const ps = this._pickFrame('pset_pool');
    this._write([...(ps.frame ? [ps.frame] : []), ...this.frames.spawn, SFLASH, ...(sp.frame ? [sp.frame] : [])], 'spawn' + this._lineTag(sp) + (ps.frame ? ` + scream ${ps.id}${ps.tag}` : ''));
    this.hurtFired = false;        // the low-health alert is once per LIFE
    this._prevAmmo = {}; this.activeSlot = 0; this.magBySlot = {};   // config echoes carry WEAP clip caps, not spawn mags — never let them set the denominator   // assumption (hardware-UNVERIFIED): a fresh spawn puts the gun on slot 0
    this._cue('klaxon');
    // Spawn shield is ALWAYS 0 on hardware -- $PSET t5 is a capacity filled by an fn-11
    // grant, never a starting pool (bench 2026-08-27).
    this.spawned = true; this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.killedBy = null; this.deadAt = 0; this.reloading = null;
    this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield;
    this._gunTake();   // A11.7
    if (this.frames.headset) this._headsetDelayed(this.frames.headset.start, 'start');   // A16 §D: scheduled +1.0 s after $SPAWN, not inline (A11.6: white flash marks the start, then dark/team)
    this.moment = { kind: 'go', at: this.now() };
    this._set('live');
  }

  // ---------- King of the Hill audio ----------
  // The architecture, and it is the whole point of this block: **beacons update STATE, a node timer sets the
  // CADENCE.** F74 measured a gun replaying a latched IR event every 5.07 s forever, so a multi-second
  // sequence launched per beacon stacks three deep and drifts; the possession tick is therefore a 0.11 s
  // clip fired by `_hillTick` off our own ~1 s clock while state says we hold a fresh point, and NOTHING
  // in this file plays audio directly from a beacon except a one-shot transition callout.

  /** The bundle's cue for a hill sound, else the literal fallback above, plus its real length in ms.
   *  The bundle WINS whenever it carries the key at all -- `''` is MC's deliberate mute (`cue_frames()`
   *  writes `''` for an objective cue when the profile's announcer is off), and a fallback that overrode
   *  that would turn the announcer switch into a lie. `{frame: null}` = play nothing. */
  _hillCue(kind) {
    const def = HILL_CUES[kind]; if (!def) return { frame: null, ms: 0 };
    const cues = this.frames && this.frames.cues;
    const fromBundle = cues && Object.prototype.hasOwnProperty.call(cues, kind) ? cues[kind] : undefined;
    const frame = fromBundle !== undefined ? fromBundle : def.frame;
    if (!frame) return { frame: null, ms: 0 };
    // `hasOwnProperty`, not `||`: a bundle deliberately setting `cue_ms[kind] = 0` means "this cue must not
    // suppress the tick", and `||` silently replaced that zero with the default length instead.
    const cm = this.frames && this.frames.cue_ms;
    const ms = cm && Object.prototype.hasOwnProperty.call(cm, kind) ? cm[kind] : def.ms;
    return { frame, ms };
  }
  /** True while hill audio should be audible at all: live, on our feet, and not a mode whose points we
   *  cannot tell apart. Death is deliberately silent — A16 makes the DOWN window hands-off and the death
   *  scream owns the announcer; a player who respawns learns the current owner from the tick within 1 s. */
  _hillAudioOn() {
    return this.phase === 'live' && this.alive
      && !(this.config && HILL_AUDIO_EXCLUDED_MODES.has(this.config.mode));
  }
  /** B/F70: MC names ONE objective source per game (`config.station_source`), and the phone accepts BOTH
   *  wires. Without this gate a grenade left live on the field (F69) during a phone-point game alternates
   *  ownership with the point every 5 s and announces continuously — two sources, one `this.hill`.
   *  The vocabulary (`STATION_SOURCES`, `mcp/brx_mcp/mc/types.py`): `grenade` = the IR beacon, `phone` = the
   *  BLE control point (F103 added it 2026-09-11), `ir_station` = a `$CAPTURE`-speaking box that reaches MC,
   *  not us. Absent = no objective in this game, so what we hear is it (a try-out, the stage). */
  _hillSourceAllowed(source) {
    const src = this.config && this.config.station_source;
    if (!src) return true;                                  // no game, or a mode with no objective: what we hear is it
    const ok = source === 'station' ? src === 'phone' : src === 'grenade';
    if (!ok && this._hillSourceWarned !== source) {
      this._hillSourceWarned = source;
      this.log(`ignoring the ${source === 'station' ? 'phone control point' : 'grenade hill beacon'}: this game's station_source is ${src}`, 'li');
    }
    return ok;
  }
  /** Do WE hold the point right now? `null`/neutral/an enemy all read false. */
  _hillMine() {
    const mine = this.teamTid;
    return mine != null && mine !== HILL_NEUTRAL_TEAM && !!this.hill && this.hill.owner === mine;
  }
  /** Which callout ONE wire event deserves for THIS listener: the same `mag=50` frame is "Hill Captured"
   *  to the incoming team and "Hill Lost" to the team that just lost it. A capture between two other teams
   *  (or from neutral to an enemy) is deliberately silent — it is not this player's event.
   *
   *  ⚠ "Hill Contested" (`VB0O`) is DELIBERATELY NOT WIRED. F75 checked four bench runs where a hill was
   *  shot and did NOT change hands: the only protocol-15 traffic is the ordinary `mag=8` beacon, so a
   *  non-capturing hit emits nothing we can decode. The only way to produce it is to INFER it from "I
   *  fired" + "an enemy hill is in range" + "no capture word followed" — which cannot tell a hit from a
   *  miss, so firing PAST the grenade while standing in an enemy point would announce it falsely. That
   *  false positive is not merely noise: at 2.078 s it would suppress the possession tick for two seconds
   *  and tell the player something untrue about the objective. Silence is the honest answer until F75's
   *  probe (deliberately miss a grenade in a NATIVE game and see whether native still says "contested")
   *  settles whether native infers it too or there is a word we have not captured. */
  _hillCallout(prevOwner, owner) {
    const mine = this.teamTid;
    if (mine == null) return null;
    if (mine === HILL_NEUTRAL_TEAM) {   // F82: a NEUTRAL point broadcasts team 2, so a tid-2 roster cannot tell "nobody holds it" from "we hold it"
      if (!this._hillTeam2Warned) { this._hillTeam2Warned = true; this.log('F82: we are on tid 2, which is what a NEUTRAL hill broadcasts — hill ownership is undecidable, so no hill audio will play', 'le'); }
      return null;
    }
    if (owner === mine) return 'hill_captured';
    if (prevOwner === mine) return 'hill_lost';
    return null;
  }
  /** Play one callout NOW. Priority rule: **the later callout wins outright — it preempts, it never
   *  queues.** These are 1.9-3.0 s announcements of a state that has just changed AGAIN, so a queued
   *  "Hill Captured" finishing three seconds after the point was already lost would state something
   *  false; the newest word is always the true one. A preempt sends `$PLAYX,0,*` in the SAME write, so
   *  the stale line is actually stopped on the gun rather than left to mix — and only when we are cutting
   *  off our OWN in-flight hill callout, so nothing else's audio is ever clipped by this path. */
  _hillSay(kind, why) {
    const cue = this._hillCue(kind);
    if (!cue.frame) return;
    const now = this.now();
    const preempt = now < this._hillBusyUntil;
    this._hillBusyUntil = now + cue.ms;
    this._write(preempt ? [PLAYX, cue.frame] : [cue.frame], `hill ${kind}${preempt ? ' (preempting the line still playing)' : ''} — ${why}`);
  }
  /** A deduped protocol-15 beacon: update hill state and, if this frame PROVES a change of hands, announce
   *  it in this same handler. Nothing here starts a sequence, and nothing here waits for a second word. */
  _onHillBeacon(ownerTeam, magnitude, now) {
    if (magnitude !== HILL_MAG && magnitude !== HILL_CAPTURE_MAG && magnitude !== HILL_WAS_NEUTRAL_MAG) return;   // magnitude 6 is a respawn station, not a point (F84)
    if (!this._hillSourceAllowed('beacon')) return;   // B: this game's objective is not a grenade
    // F82 is explained HERE, on the first beacon, not from `_hillCallout` — that is only reached when a
    // transition would be announced, so a tid-2 roster that never witnessed a capture went silent with no
    // reason in the log. The behaviour was always right (the tick is gated by `_hillMine`); the diagnostic
    // was missing, and the stage's default roster is blue(1) + yellow(2), so this is one click away.
    if (this.teamTid === HILL_NEUTRAL_TEAM && !this._hillTeam2Warned) {
      this._hillTeam2Warned = true;
      this.log('F82: we are on tid 2, which is what a NEUTRAL hill broadcasts — hill ownership is undecidable, so no hill audio will play', 'le');
    }
    const prev = this.hill;
    const prevOwner = prev ? prev.owner : null;
    const fresh = !!prev && (now - prev.at) < HILL_PRESENCE_MS;

    if (magnitude === HILL_WAS_NEUTRAL_MAG) {
      // `mag=53` is the state being LEFT, and bench 2026-09-10 measured it arriving ~5 s AFTER the `mag=50`
      // that already named the new owner (t=41820 vs t=46780). Its team field is therefore the OLD owner:
      // writing it into `owner` would hand the point back to nobody a full beacon cycle after we took it.
      // It refreshes presence and records that the capture started from neutral; it announces nothing, and
      // nothing ever waits for it — on an enemy-to-enemy capture it never arrives at all (n=2).
      // ⚠ Only when we already knew the point. With no prior hill this used to write `{owner: null}`, which
      // held a 12 s presence window open for a point whose owner was never known and then logged "presence
      // expired" for it — and left `state().hill` non-null with a null owner, so every downstream reader had
      // to test `owner` as well. We simply did not see this capture; the next `mag=8` names the owner.
      if (!prev) return;
      this.hill = { owner: prevOwner, at: now, from_neutral: true };
      this._changed();
      return;
    }

    // `mag=50` is an explicit capture word: it proves a change of hands by itself, whether or not we were
    // watching the point beforehand. A plain `mag=8` whose owner differs from the one we knew is the SAME
    // event seen late (we missed the capture word), so it announces too — but only while presence was
    // still fresh. Once presence has expired we were not watching, and adopting an owner on walking back
    // into range is not a capture: it is silent.
    const announce = magnitude === HILL_CAPTURE_MAG ? prevOwner !== ownerTeam : (fresh && prevOwner != null && prevOwner !== ownerTeam);
    // `from_neutral` is DERIVED on an owner change, never inherited. It used to carry `prev.from_neutral`
    // through the plain-beacon path, so once a point had been taken from neutral, every LATER owner adopted
    // via "we missed the capture word" still read `from_neutral: true` — claiming they took it from nobody
    // when they stole it from a team. Found 2026-09-10 porting this to the bench stage, and it is not
    // cosmetic: `modes/hillbeacon.py` splits its callouts on this field, and it computes the same fact
    // independently (`from_neutral = previous == NEUTRAL`), so a leak here makes MC and the phone disagree
    // about the same capture. A `mag=50` stays false until its `mag=53` confirms otherwise (that word
    // arrives ~5 s later, or never on an enemy-to-enemy capture); a heartbeat that changes nothing keeps
    // what we had; an owner CHANGE reads the previous owner, which is the only honest source.
    const sameOwner = prevOwner === ownerTeam;
    this.hill = { owner: ownerTeam, at: now,
      from_neutral: magnitude === HILL_CAPTURE_MAG ? false
                  : sameOwner ? (prev ? !!prev.from_neutral : false)
                  : prevOwner === HILL_NEUTRAL_TEAM };
    if (announce) {
      const kind = this._hillCallout(prevOwner, ownerTeam);
      if (kind && this._hillAudioOn()) this._hillSay(kind, magnitude === HILL_CAPTURE_MAG
        ? `capture word (mag 50): team ${prevOwner == null ? '?' : prevOwner} -> ${ownerTeam}`
        : `owner changed on a plain beacon (the mag-50 word never reached us): team ${prevOwner} -> ${ownerTeam}`);
    }
    this._changed();
  }
  /** K1 — the SAME hill state and the SAME four cues, sourced from a phone CONTROL POINT's BLE advert
   *  instead of a grenade's IR word (utility.md §5 row `control`). Called from `setStations` at ~4 Hz.
   *
   *  The station has already done the counting: its advert carries the owner (byte 9 + the `held` bit), the
   *  0-100 conversion progress (byte 11) and whether two teams are on it (byte 10 bit 1). So this is a
   *  TRANSLATOR, not a second audio system -- it writes `this.hill` in the shape `_hillMine` / `_hillTick` /
   *  `state().hill` already read, and announces through `_hillCallout` / `_hillSay`, which keeps the
   *  preempt-not-queue rule, the real clip lengths and the tick suppression identical on both sources.
   *
   *  Two things it does differently from the IR path, both because the station measures what the grenade
   *  cannot:
   *   - **Ownership changes only through neutral.** The station drains an enemy-held point to 0 (its owners
   *     have LOST it) and only then builds it to 100 for its new owner, so "Hill Lost!" lands on the team
   *     that was robbed at the moment they actually stop holding it, and "Hill Captured" lands on the new
   *     owner up to a conversion later. `_hillCallout` already resolves both from one owner change.
   *   - **"Hill Contested" (VB0O) IS wired here.** F75 forbids it on the IR path because a non-capturing hit
   *     emits nothing and the state could only be INFERRED from a miss. A station COUNTS living bodies of
   *     each team inside its own bubble, so the contested bit is a measurement. It is announced only to
   *     players the fight belongs to: someone standing on the point, or the team that owns it (a defender
   *     hearing their own point go contested is the whole reason the cue exists).
   *
   *  ⚠ ONE point. A station advert does name its own id, so unlike F88's grenades several points ARE
   *  distinguishable on this wire -- but `this.hill` models a single point, so the nearest/occupied one wins
   *  and multi-point Domination stays out of scope (`HILL_AUDIO_EXCLUDED_MODES` already mutes it). */
  _onControlAdvert(now) {
    const e = this._controlStation();
    if (!e) return;
    if (!this._hillSourceAllowed('station')) return;   // B: this game's objective is a grenade, not a phone point
    if (this.teamTid === HILL_NEUTRAL_TEAM && !this._hillTeam2Warned) {   // F82, the same warning as the IR path
      this._hillTeam2Warned = true;
      this.log('F82: we are on tid 2, which is what a NEUTRAL point broadcasts — control-point ownership is undecidable, so no hill audio will play', 'le');
    }
    // The station says 255 for "nobody holds it"; the hill model (and `modes/hillbeacon.py`) says team 2,
    // because that is what a NEUTRAL grenade broadcasts. Map once, HERE, so everything downstream is shared.
    const held = !!(e.state & CONTROL_STATE.held);
    // Not held, a colour tid, or 255 all mean the same thing to this model: nobody. A `held` advert naming
    // tid 2 needs no special case — 2 IS the neutral sentinel, so an unauthenticated advert cannot use it to
    // install an owner nobody could decide (F82), it just says "nobody" the long way round.
    // `claimable` rather than a restated `e.team <= 3`: the station side already decides who may hold a point
    // with it (control.js), and a hand-copy of that boundary is one edit away from disagreeing with it. A
    // mutation audit (2026-09-11) moved the old literal to `<= 4` and the whole suite stayed green, which
    // would have made a COLOUR tid a point owner — tids 4-7 are not teams ($TID is masked to 2 bits, F35/F96).
    const owner = (held && claimable(e.team)) ? e.team : HILL_NEUTRAL_TEAM;
    const contested = !!(e.state & CONTROL_STATE.contested);
    // §5d.3: `rising && falling` is INVALID and direction falls back to UNKNOWN. Flags are independent bits,
    // so unlike a 2-bit phase field they CAN both be set -- and adverts are unauthenticated (§3), so a buggy
    // or hostile station can say it. A reader that trusts whichever bit it tests first shows a defender the
    // point moving the wrong way, which is worse than showing no direction at all.
    const bothWays = (e.state & CONTROL_STATE.rising) && (e.state & CONTROL_STATE.falling);
    const rising = !bothWays && !!(e.state & CONTROL_STATE.rising);
    const falling = !bothWays && !!(e.state & CONTROL_STATE.falling);
    const prev = this.hill;
    // A: two points are two different objectives, and `site` was recorded and never compared. A point we
    // were not reading before tells us NOTHING about a change of hands — walking from our own point toward
    // an enemy's used to fire "Hill Lost!" for a point nobody had taken. A different site (or the other
    // source's state) is adopted SILENTLY, exactly as walking back into range is (`_onHillBeacon`).
    const sameSite = !!prev && prev.source === 'station' && prev.site === e.id;
    const prevOwner = sameSite ? prev.owner : null;
    if (!sameSite && prev && prev.site !== e.id) {
      this.log(`control point ${e.id} is a different point from ${prev.source === 'station' ? prev.site : 'the grenade hill'} — adopting its owner silently`, 'li');
      this._hillWasContested = false; this._hillOwnerWhenSilenced = undefined;
    }
    this._controlSite = e.id;
    this.hill = {
      owner, at: now,
      // A station capture ALWAYS passes through neutral (that is the two-phase rule), so this is true for
      // every handover it reports -- which is the literal truth, not a leak of the IR path's meaning.
      from_neutral: prevOwner === HILL_NEUTRAL_TEAM,
      source: 'station', site: e.id,
      progress: Math.max(0, Math.min(100, e.value | 0)),
      // Whose progress the bar is: the owner while held, else the team building it up, else null.
      holding: e.team <= 3 ? e.team : null,
      contested, rising, falling,
      onPoint: !!e.present,
    };
    // C: a transition that lands while we are DOWN used to be swallowed, not deferred — so a player
    // respawned and "we lost it", "out of range" and "nothing is happening" were all the same silence, and
    // only OWNING the point ever spoke. We remember the owner as we last heard it WITH audio on, and on the
    // first advert after revive we say the one line that describes the net change across the death window.
    // The net change, not a replay: the point may have changed hands twice, and the newest word is the true
    // one (the same rule `_hillSay` enforces by preempting).
    const audio = this._hillAudioOn();
    let said = false;
    const announceFrom = audio && this._hillOwnerWhenSilenced !== undefined && this._hillOwnerWhenSilenced !== prevOwner
      ? this._hillOwnerWhenSilenced : prevOwner;
    if (audio && announceFrom != null && announceFrom !== owner) {
      const kind = this._hillCallout(announceFrom, owner);
      // 2: a floor on the transition lines too. Two phones sharing the default station id 1 are ONE presence
      // entry, so the decoded owner can flip several times a second and each line preempted the last.
      if (kind && now - this._hillSaidAt >= HILL_CALLOUT_MIN_MS) {
        this._hillSaidAt = now;
        this._hillSay(kind, announceFrom === prevOwner ? `control point ${e.id}: team ${prevOwner} -> ${owner}`
          : `control point ${e.id}: it changed hands while we were down (team ${announceFrom} -> ${owner})`);
        said = true;
      }
    }
    // Track the owner we last heard with audio ON, so the line above can be owed across a death window.
    this._hillOwnerWhenSilenced = audio ? undefined : (this._hillOwnerWhenSilenced === undefined ? prevOwner : this._hillOwnerWhenSilenced);
    // Contested, on the rising edge only. A capture callout in the same advert wins outright: `_hillSay`
    // preempts, so announcing both would cut "Hill Captured" off with "Hill Contested" and leave the player
    // with the less important of the two facts.
    const mine = this.teamTid;
    if (contested && !this._hillWasContested && !said && audio
        && mine != null && mine !== HILL_NEUTRAL_TEAM && (e.present || owner === mine)
        && now - this._hillContestedAt >= HILL_CONTESTED_MIN_MS) {
      this._hillContestedAt = now;
      this._hillSay('hill_contested', `control point ${e.id} is contested (${e.value}% for team ${e.team})`);
    }
    this._hillWasContested = contested;
    // 4 Hz: only a fact the screen shows is worth a render (progress to the whole percent, like the RSSI
    // rounding in `setStations`).
    const sig = `${e.id}:${owner}:${held}:${contested}:${this.hill.progress}:${this.hill.holding}:${rising}:${falling}:${e.present}`;
    if (sig !== this._controlSig) { this._controlSig = sig; this._changed(); }
  }
  /**
   * POSSESSION, the thing an objective mode is actually scored on. Nothing anywhere counted it: the hill
   * tick ticks a SOUND, not a clock. This accrues, per point and per team, how long that team OWNED it as
   * THIS node observed it, plus how long this node could hear the point at all -- which is what makes the
   * number an honest lower bound rather than a guess (`mc/API.md`, the `possession` fact).
   *
   * ⚠ From ELAPSED TIME, never from a count of ticks: a stalled or throttled tick would silently under-count,
   * and that is the number the match is decided on. Each delta is clamped to one tick's worth because `now()`
   * is `Date.now()` plus an MC offset that MOVES as the sync converges -- an unclamped delta across one clock
   * step would add minutes of possession nobody played.
   *
   * ⚠ It accrues for WHOEVER owns it, not only for us, and it is never summed with a teammate's: MC merges by
   * MAX per (site, team) precisely because four players on one hill all observe the same ownership. The fact
   * says "team X owned point P for N ms as observed by me", which is why that merge is the obvious one.
   */
  _accrueHold(h, now) {
    if (this.phase !== 'live') { this._holdAt = 0; return; }   // a point heard in the lobby is not possession
    // Anchor the FIRST interval on when the point was last SEEN, not on when our tick happened to run.
    // Seeding from `now` instead lost one tick's worth on every fresh hold -- 250 ms at our normal cadence
    // but a full second on a throttled phone, which made possession depend on tick rate, the exact thing
    // this accumulator exists to avoid.
    if (!this._holdAt) this._holdAt = (h.at != null && h.at <= now) ? h.at : now;
    const dt = Math.max(0, Math.min(HOLD_STEP_MAX_MS, now - this._holdAt));
    this._holdAt = now;
    if (!dt) return;
    // A grenade beacon carries NO point id (F88), so its site is unnamed; a station advert names itself.
    const site = h.site != null ? String(h.site) : '';
    this._holdSource = h.source === 'station' ? 'station' : 'beacon';
    this.observed[site] = (this.observed[site] || 0) + dt;
    if (h.owner != null) {
      const by = this.hold[site] || (this.hold[site] = {});
      by[h.owner] = (by[h.owner] || 0) + dt;   // tid 2 included: MC credits it to nobody as `neutral_s`
    }
  }
  /** Send the tally to MC. `hold_ms` is CUMULATIVE and every report is idempotent, so this is
   *  resend-as-it-grows on a slow cadence, plus one unconditional report at the whistle. */
  _reportPossession(now, force = false) {
    if (!this.matchId) return;
    const sites = Object.keys(this.observed);
    if (!sites.length) return;
    const sig = JSON.stringify([this.hold, this.observed]);
    if (!force && (sig === this._possessionSig || now - this._possessionSentAt < POSSESSION_REPORT_MS)) return;
    this._possessionSig = sig; this._possessionSentAt = now;
    for (const site of sites) {
      const hold = this.hold[site] || {};
      this.emitFact({ type: 'possession', match_id: this.matchId, ...(site ? { site } : {}),
        hold_ms: Object.fromEntries(Object.entries(hold).map(([tid, ms]) => [String(tid), Math.round(ms)])),
        observed_ms: Math.round(this.observed[site]), source: this._holdSource || 'station' });
    }
  }
  /** A new match must not inherit the last one's point, its tally, or its once-per-game warnings. */
  _resetHill() {
    this.hill = null; this._hillTickAt = 0; this._hillBusyUntil = 0;
    this._controlSite = null; this._controlSig = ''; this._hillSaidAt = 0;
    this._hillWasContested = false; this._hillContestedAt = 0; this._hillOwnerWhenSilenced = undefined;
    this._hillTeam2Warned = false; this._hillSourceWarned = '';
    this.hold = {}; this.observed = {}; this._holdAt = 0; this._holdSource = null;
    this._possessionSig = ''; this._possessionSentAt = 0;
  }
  /** Called from tick() (~250 ms): expire a stale point, then play the possession tick on OUR clock while
   *  we hold a fresh one. This is the only place the tick fires from — a beacon arrives once per ~5 s and
   *  could never carry a 1 s cadence, and driving audio per beacon is exactly what F74 forbids. */
  _hillTick(now) {
    const h = this.hill;
    if (!h) { this._holdAt = 0; return; }   // nothing to hear: the next accrual must not count the gap
    // A grenade point expires on two missed 5 s beacons; a phone control point expires on the §3 presence
    // rule, because its advert is continuous (§5d.5). Same code, the window is the source's.
    const window = h.source === 'station' ? CONTROL_STALE_MS : HILL_PRESENCE_MS;
    if (now - h.at >= window) {   // out of range or off the point. NOT a "lost" — nobody took it from us
      this.hill = null; this._hillTickAt = 0; this._holdAt = 0;
      this._controlSig = ''; this._hillWasContested = false;   // K1: walking back into range must be able to re-announce
      this.log(`hill presence expired (${Math.round((now - h.at) / 1000)}s since its last beacon)`, 'li');
      this._changed();
      return;
    }
    this._accrueHold(h, now);   // the CLOCK runs whatever the audio does: possession is a fact about the point
    if (!this._hillAudioOn() || !this._hillMine()) return;
    if (now < this._hillBusyUntil) return;   // a callout owns the announcer for its own real length: the tick waits rather than playing under it
    // D: OUR point draining doubles the cadence. Nothing else is audible before "Hill Lost!", which arrives
    // when it is already too late — the defender hears an unchanged 1 s tick right up to the moment they
    // have lost it. `falling` comes off the advert, so this costs a comparison.
    const period = h.falling ? HILL_TICK_LOSING_MS : HILL_TICK_MS;
    if (this._hillTickAt && now - this._hillTickAt < period) return;
    const cue = this._hillCue('hill_tick');
    if (!cue.frame) return;
    this._hillTickAt = now;
    this._write([cue.frame], 'hill possession tick');
  }

  // ---------- clock tick (call every ~250 ms) ----------
  tick() {
    const now = this.now();
    this._checkEcho();
    if (this.loadoutAck && now - this.loadoutAck.t > 4000) { this.loadoutAck = null; this._changed(); }
    if (this.pendingPick && now - this.pendingPick.at > 6000) { this.pendingPick = null; this._changed(); }   // MC never answered — drop the optimistic row
    if (this.phase === 'armed' && this.start) {
      const rem = this.goLiveT - now;
      // Runway cues are EDGE-triggered: fire only when crossing the threshold from above. With a runway shorter
      // than a threshold the stale cue is skipped — firing them all at arm time stacked three copies of the
      // counting track on the gun ("10, 9, 8, 10, …", bench 2026-08-25).
      const prevRem = this._prevRem != null ? this._prevRem : rem;
      this._prevRem = rem;
      const edge = (ms) => prevRem > ms && rem <= ms;
      if (edge(30000)) this._cue('runway_30');
      if (edge(20000)) this._cue('runway_20');
      if (edge(10000)) this._cue('runway_10');
      if (rem <= 9000 && rem > 3000) { const s = Math.ceil(rem / 1000); const k = `tick${s}`; if (!this.cuesFired.has(k) && this.frames && this.frames.cues && this.frames.cues.tick) { this.cuesFired.add(k); this._write([this.frames.cues.tick], 'tick'); } }
      if (rem <= 3000) this._cue('countdown');
      // Hold-across-disperse is bench-UNVERIFIED (start-sequence §3 / checklist NEXT #1): if the gun drops its
      // config while parked unspawned, enable rewriteHeadAtT10 to re-write frames.head at T-10 s.
      if (this.rewriteHeadAtT10 && rem <= 10000 && !this._headRewritten && this.frames && this.bleUp) { this._headRewritten = true; this._writeHead('T-10 head re-write'); }
      if (rem <= 0 && this.bleUp && !this.resync) this._spawn(false);
      this._changed();
    }
    if (this.phase === 'live') {
      if (this.endT && now >= this.endT) { this._endLocal('time-expiry'); return; }
      // Recovery: a cold boot / resync can land us DOWN (alive false) with no death time — deadAt is not
      // persisted, and resync observes a dead gun without stamping one. Without a deadAt the respawn logic
      // (timer, scanner hint, revive gate) all bail, so a recovered player is stuck with no way back
      // (bench 2026-09-04: "it isn't sensing the respawn station"). Stamp it: they are down as of now.
      if (this.reconciling && now - this.reconciling.since >= RECONCILE_MS) this._endReconcile();
      if (!this.alive && !this.deadAt && !this.resync && !this.reconciling) { this.deadAt = now; this.log('recovered while down — respawn clock started', 'li'); }
      if (this.endT) {   // A11.4 clock callouts from the node's own synced end time: edge-triggered, once each
        const left = this.endT - now, prev = this._prevLeft != null ? this._prevLeft : left; this._prevLeft = left;
        for (const [ms, k] of [[60000, 'time_60'], [30000, 'time_30'], [10000, 'time_10']]) {
          if (prev > ms && left <= ms && !this.cuesFired.has(k)) { this.cuesFired.add(k); this._event(k); this.moment = { kind: 'alert', at: now, data: { kind: k, text: k === 'time_60' ? 'ONE MINUTE LEFT' : k === 'time_30' ? '30 SECONDS' : '10 SECONDS' } }; }
        }
      }
      if (!this.alive && this.deadAt && this.respawnType === 'auto' && now - this.deadAt >= this.respawnDelayMs && this.bleUp && !this.resync && !this.reconciling) {
        const rs = !!this._resyncRevive; this._resyncRevive = false; this._revive(rs);   // §3.10: a resync re-arm is flagged respawn{resync:true}
      }
      // utility.md §4: a scanner respawn with the presence gate revives the moment the player has dwelt at
      // their team's respawn station past the delay. The trigger gate (default) waits for $BUT,0,1 instead.
      if (this.respawnType === 'scanner' && this.respawnGate === 'presence') {
        const st = this._stationRevivable(now); if (st) { this._resyncRevive = false; this._revive(false, st.id); }
      }
      this._reassertDeathBlink(now);   // A11.6: keep the headset out-blink lit through a long DOWN (colour opt-in only)
      this._downRearm(now);            // §3.2: one $HLOOP rearm after the hands-off window (belt-and-braces; the native flash is already running)
      this._gunReadoutTick(now);       // A16 §3.1: revert the gun-body readout to rest once its hold has run out
      this._hillTick(now);             // the possession tick on OUR ~1 s clock, and the >= 2-missed-beacon presence expiry
      this._reportPossession(now);     // and the possession CLOCK, which is what the mode is scored on
      if (this.moment && now - this.moment.at > 4000) { this.moment = null; }
      // A swap the gun never confirmed with a shot: past the assumed window we TAKE the swap as done (the real
      // duration has never been timed — FOLLOWUPS F4; the next $ALCD corrects activeSlot if the gun disagrees).
      if (this.switching && now - this.switching.at > this.switchWindowMs()) {
        const to = this.switching.from === 0 ? 1 : 0; this.switching = null; this.activeSlot = to;
        this.moment = { kind: 'switched', at: now, data: { slot: to, assumed: true } };
        this.log(`swap to slot ${to} assumed after ${this.switchWindowMs()}ms (no shot yet)`, 'li');
      }
      this._changed();
    }
    if (this.resync) this._resyncTick();
  }

  _revive(resync, stationId = null) {
    this.reloading = null;                          // a reload that started in the last life does not follow you into this one
    if (!this.frames) return;
    const down = this.frames.headset && this.frames.headset.down;
    if (down && down.stop) this._write([down.stop], 'down stop');   // §3.2: `$HLOOP,0,0,*` before $SPAWN — belt-and-braces, $SPAWN clears the loop on its own
    this._downRearmSent = false;   // §3.2: fresh rearm gate for the next life
    const sp = this._pickCue('respawned');   // A15.2: the spawn line rides in the revive write (one line, never two)
    const ps = this._pickFrame('pset_pool');   // A15.3: a fresh death scream for this life, written before $SPAWN
    // A17: a fresh $SIR table too, so the sound a given WEAPON makes on us changes between lives. It rides the
    // REVIVE write and not the first spawn deliberately -- the player is already down and waiting here, whereas the
    // spawn write is on the critical path and the headset needs its settling gap (F13). Re-sending $SIR rows is the
    // F11 REPAIR path, so this cannot cost us the table; the rows differ only in their sound tokens.
    const sir = this._pickTable('sir_pool');
    this._write([...(ps.frame ? [ps.frame] : []), ...sir, ...this.frames.revive, ...(sp.frame ? [sp.frame] : [])], 'revive' + this._lineTag(sp) + (ps.frame ? ` + scream ${ps.id}${ps.tag}` : '') + (sir.length ? ` + hit audio ${sir.length}r` : ''));
    this.hurtFired = false;
    this._prevAmmo = {}; this.activeSlot = 0;   // assumption (hardware-UNVERIFIED): a revive puts the gun back on slot 0
    this.alive = true; this.hp = this.maxHp; this.armor = this.maxArmor; this.shield = 0; this.deadAt = 0; this.killedBy = null;
    this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield;
    this._gunTake();   // A11.7
    this.emitFact({ type: 'respawn', match_id: this.matchId, ...(resync ? { resync: true } : {}), ...(stationId != null ? { station: stationId } : {}) });
    this.moment = { kind: 'redeploy', at: this.now() };
    this.log(resync ? 'resync respawn' : stationId != null ? `respawned at station ${stationId}` : 'respawned', 'lk');
    this._eventLeds('respawned');   // A11 lights only (after the revive frames, so the burst ends on the fresh team colour); the sound went out with the revive write above
    if (this.frames.headset) { this.carrying = null; this._activeRole = null; this._headsetDelayed(this.frames.headset.respawn, 'respawn'); }   // A16 §D: +1.0 s after $SPAWN; A11.6: white flash then dark/team
    this._changed();
  }

  _endLocal(why) {
    if (this.ended) return;
    this.ended = true; this._panicked = null; this.endAck = false;
    this._lightGen = (this._lightGen || 0) + 1;   // no delayed $GLED/$HLED/cue step from before teardown may land after it
    try { if (this.onEnd) this.onEnd({ t: this.now(), match_id: this.matchId, kills: this.score ? this.score.kills : null,
      deaths: this.deaths, assists: this.score ? this.score.assists : null,
      accuracy: this.score ? this.score.accuracy : null, shots: this.shots, mode: this.config ? this.config.mode : null }); } catch (_) { /* history is best-effort */ }
    // The tally that decides the match is the one sent AT the whistle: it is exempt from the A6.1 end freeze
    // and clamped on MC's side instead (`mc/API.md`), so send it before the phase leaves `live`.
    this._reportPossession(this.now(), true);
    if (this.matchId && !this.endedMatches.includes(this.matchId)) this.endedMatches.push(this.matchId);
    if (this.bleUp) this._writeTeardown('end', why); else { this.pendingTeardown = 'end'; this.log(`end (${why}) owed to the gun — link down`, 'le'); }
    this.spawned = false; this.alive = false; this.resync = null; this.reconciling = null; this.start = null; this._resyncRevive = false; this.reloading = null;
    this.ready = false;
    this.moment = { kind: 'match_over', at: this.now() };
    this._set('kitted');
    this.log(`match ended: ${why}`, 'lk');
  }

  /** True per-slot mags from the bundle's spawn $AMMO frames — the display/warn denominator. */
  _ammoBySlot() {
    const out = {};
    for (const f of (this.frames && this.frames.spawn) || []) {
      if (f.startsWith('$AMMO,')) { const t = f.split(','); out[+t[1]] = +t[2] || null; }
    }
    return out;
  }

  /** Loadout ammo for slot 0 straight from the bundle's spawn frames (display truth for the lobby plate). */
  _loadAmmo() {
    const f = this.frames && this.frames.spawn && this.frames.spawn.find(x => x.startsWith('$AMMO,0,'));
    if (!f) return [null, null];
    const t = f.split(',');
    return [+t[2] || null, +t[3] || null];
  }

  /** Player tapped OK on the result screen → fall through to the 'MATCH COMPLETE' over screen. */
  ackEnd() { if (this.ended) { this.endAck = true; this._changed(); } }

  _writeTeardown(kind, why) {
    if (kind === 'panic') { if (this.frames && this.frames.panic) this._write(this.frames.panic, `panic (${why})`); else this._write(['$CLEAR,*', '$SP,99,*'], `panic (${why})`); return; }
    if (this.frames) {
      this._write(this.frames.end, `end (${why})`);
      // A11.4 HUD-driven ending: in infection a survivor whose clock ran out KNOWS it survived -- it never
      // turned -- so it plays "the survivors have held their ground" itself; everyone else gets game_over.
      const c = this.frames.cues || {};
      const survived = why === 'time-expiry' && this.config && this.config.mode === 'infection' && !this._turned && c.survivors_win;
      const f = survived ? c.survivors_win : c.game_over;
      if (f) this._write([f], survived ? 'cue survivors_win' : 'cue game_over');
    }
  }

  // ---------- control ----------
  control({ cmd, seq }) {
    switch (cmd) {
      case 'end': case 'recall':
        if (this.phase === 'live' || this.phase === 'armed' || this.phase === 'lobby') this._endLocal(cmd);
        // Silently ignoring it is why "END MATCH EARLY did not reach the HUDs" was undiagnosable:
        // both phones were already in `kitted`, where this is a no-op, and nothing said so anywhere.
        else this.log(`control ${cmd} ignored — phase is ${this.phase}`, 'li');   // correct on an unkitted phone: info, not error
        return;
      case 'abort_start':
        if (this.phase === 'armed' && (seq == null || (this.start && this.start.seq === seq))) { this.start = null; this.cuesFired = new Set(); this._write([PLAYX], 'abort'); this._set('lobby'); }
        else if (this.phase === 'live' && this.start && this.start.seq === seq) this._endLocal('abort_start(live)=recall');
        return;
      case 'panic':
        this._lightGen = (this._lightGen || 0) + 1;   // same as _endLocal: cut off any pending delayed light/cue step immediately, not just once delivered
        if (this.bleUp) this._writeTeardown('panic', 'control'); else { this.pendingTeardown = 'panic'; this.log('panic owed to the gun — link down', 'le'); }
        this._resyncRevive = false;   // a panic does NOT retire the match_id — a NEWER start (higher seq) is still accepted later
        // …but a WS welcome re-delivering the SAME schedule must not re-arm a gun the operator just cleared.
        this._panicked = this.start ? { match_id: this.start.match_id, seq: this.start.seq } : null;
        this.spawned = false; this.alive = false; this.start = null; this.resync = null; this.reconciling = null;
        if (this.phase !== 'idle' && this.phase !== 'connected') this._set('kitted');
        this.ready = false;
        return;
      default: return;
    }
  }

  // ---------- feedback (§3.6) ----------
  feedback(body, envT) {
    const t = body.t != null ? body.t : envT;
    if (t != null && this.now() - t > C.FEEDBACK_MAX_AGE_MS) { this.log('feedback too old — ignored', 'li'); return; }
    const pick = body.cue ? { frame: body.cue, tag: '' } : this._pickCue(body.kind);   // A15: a random take from the pool (kill confirms + taunts)
    const cue = pick.frame;
    this._write([SFLASH], `feedback ${body.kind}`);
    // A11.4 Halo-style medals: a kill can carry several ("killtacular" + "killing_spree"); each plays
    // its cue from THIS node's bundle, back to back, and replaces the plain kill line. A cue that is
    // "" is deliberately mute (announcer off) and is skipped; a missing one is skipped too.
    const medalCues = (Array.isArray(body.medals) ? body.medals : [])
      .map(m => ({ m, f: this.frames && this.frames.cues && this.frames.cues[m] })).filter(x => x.f);
    const lg = (this._lightGen = this._lightGen || 0);   // teardown snapshot: neither a medal line nor the feedback cue may land after the match ended
    if (medalCues.length) {
      medalCues.forEach((x, i) => this.delay(120 + i * MEDAL_GAP_MS, () => { if (this._lightGen === lg) this._write([x.f], `medal ${x.m}`); }));
      this.medals = body.medals.slice();
    } else if (cue) this.delay(120, () => { if (this._lightGen === lg) this._write([cue], `feedback cue ${body.kind}${pick.tag}`); });   // hardware-proven gap (seed): flash, then the line
    this._eventLeds(medalCues.length ? medalCues[0].m : body.kind);   // A11.8: the headset's small LED flash (+ any burst) for the top medal
    if (body.kind === 'kill') {
      if (this.score) this.score = { ...this.score, kills: (this.score.kills || 0) + 1 };
      else this.score = { kills: 1 };
      this.scoreAt = this.now();
      this.moment = { kind: 'kill', at: this.now(), data: { victim_team: body.victim_team, victim: body.victim, medals: Array.isArray(body.medals) ? body.medals.slice() : [] } };
    }
    this._changed();
  }

  /** A11.4 named game event from MC (lead change, next kill wins, flag captured, bomb planted, VIP down…):
   *  play this node's own cue + LED burst for it and show the text as a HUD alert. Stale ones are dropped
   *  like feedback. `hud: false` on the body suppresses the banner (sound/lights still play). */
  alert(body, envT) {
    if (!body || !body.kind) return;
    const t = body.t != null ? body.t : envT;
    if (t != null && this.now() - t > C.FEEDBACK_MAX_AGE_MS) { this.log(`alert ${body.kind} too old — ignored`, 'li'); return; }
    if (this.phase !== 'live' && this.phase !== 'armed') return;
    const me = this.player && this.player.player_id;
    if (body.kind === 'infected' && this._turned && body.player_id_subject && body.player_id_subject === me) return;   // already played on the flip (HUD-driven); MC's copy is for the others
    this._event(body.kind);
    // A11.6 carrier blink: MC names who holds it (`carrier`) and whose flag it is (`flag_tid`)
    if (body.kind === 'objective_taken' && me && body.carrier === me) this._carrier(true, body.flag_tid != null ? body.flag_tid : (this.team ? this.team.tid : 0));
    if ((body.kind === 'objective_scored' || body.kind === 'flag_returned') && this.carrying != null && (!body.carrier || body.carrier === me)) this._carrier(false);
    if (body.hud !== false) this.moment = { kind: 'alert', at: this.now(), data: { kind: body.kind, text: body.text || body.kind, player_id: body.player_id_subject || null } };
    this.log(`alert ${body.kind}`, 'lk');
    this._changed();
  }

  // ---------- BRX frames (§3.2) ----------
  feedFrame(f) {
    const t = toks(f), cmd = t[0];
    switch (cmd) {
      case 'HP': this._onHp(+t[1] || 0, +t[2] || 0, t[3] !== undefined && t[3] !== '' ? (+t[3] || 0) : this.shield); break;
      case 'LCD': {
        this.hp = +t[1] || 0; this.armor = +t[2] || 0;
        // NOTE: do NOT write this.shield from $LCD token 3. Unlike $HP, $LCD's tokens 3-4 are
        // UNDOCUMENTED (docs/manual/dev.md, protocol/brx-protocol.md "semantics TBD") and
        // read 0 in every observed frame -- so writing it can only ZERO a live shield, never set one,
        // which silently recreates the Q12 bug this file just fixed. Re-add only once t3 is
        // bench-confirmed as the shield.
        if (t[5] !== undefined) this._onAmmo(+t[5] || 0, t[6] !== undefined ? +t[6] : null, this.activeSlot);
        if (this.awaitingEcho && !this.headEcho) this.headEcho = f;
        const wasResync = !!this.resync;
        if (this.resync) this._resyncEvidence('lcd');
        if (this.phase === 'live' && this.hp === 0 && this.alive) this._death(wasResync);
        break;
      }
      case 'ALCD': {
        if (this.awaitingEcho && !this.headEcho) this.headEcho = f;
        this._onAmmo(+t[1] || 0, t[4] !== undefined ? +t[4] : null, t[3] !== undefined && t[3] !== '' ? +t[3] : 0);
        break;
      }
      case 'HIR': {
        if (t[2] === '15') {
          // A grenade/station BEACON (F70/F72), not a shot: $HIR,<sensor>,15,<ownerId=0>,<ownerTeam>,<magnitude>,0,<sub>.
          // It rides the same $HIR command as a hit, but registers through the silent $SIR fn-28 row
          // (F73) specifically so the player feels nothing — no latch, no hit_taken, no pool change.
          // It repeats every ~5 s for as long as anyone stands on the point, so this is a STANDING
          // snapshot (read from state(), like `stations`), not a one-shot moment/event: re-deriving
          // it on every beacon must not re-trigger anything downstream.
          //
          // F85: the gun has multiple IR sensors (0-3 headset, 4 body) and ONE physical transmission
          // can land on more than one of them, each reported as its own $HIR ~14 ms apart. Dedupe on
          // IDENTITY (protocol 15 is implicit here + owner team + magnitude), never on time alone: a
          // real capture bench-measured two DIFFERENT beacon words (the outgoing owner's word, then the
          // new owner's) arriving in the SAME MILLISECOND on different sensors, and a time-only window
          // would drop one of those — silently swallowing the capture. Sensor is deliberately NOT part
          // of the key: a differing sensor is exactly what a duplicate looks like. The window (150 ms)
          // sits comfortably above the 14 ms observed spread and well clear of the ~5 s beacon period,
          // so a normal repeat of the same word is never mistaken for a duplicate of itself.
          const ownerTeam = parseInt(t[4], 10), magnitude = parseInt(t[5], 10);
          if (!Number.isNaN(ownerTeam)) {
            const now = this.now(), key = `${ownerTeam}:${Number.isNaN(magnitude) ? 'null' : magnitude}`;
            const isDupe = key === this._lastBeaconKey && (now - this._lastBeaconAt) < 150;
            if (!isDupe) {
              this.beacon = { owner_team: ownerTeam, magnitude: Number.isNaN(magnitude) ? null : magnitude, sensor: parseInt(t[1], 10), at: now };
              this._lastBeaconKey = key; this._lastBeaconAt = now;
              // Hill state + its callouts run HERE, on the frame that proves the change and in the same
              // handler — never on a timer poll, and never waiting for a second word (see `_onHillBeacon`).
              // Inside the dedupe so one transmission heard on two sensors cannot announce or tick twice.
              this._onHillBeacon(ownerTeam, magnitude, now);
            }
          }
          break;
        }
        const num = parseInt(t[3], 10), team = parseInt(t[4], 10);
        // $HIR,<sensor>,<irProto>,<shooterId>,<shooterTeam>,<damage>,,<subtype> — with t[0] the command
        // word, sensor is t[1] and irProto is t[2]. `ir_proto` read t[1], so it had been reporting
        // the SENSOR all along; every hit_taken fact ever recorded carries that mix-up.
        if (!Number.isNaN(team)) { this.latch = { shooter_num: Number.isNaN(num) ? 0 : num, shooter_team: team, at: this.now(), ir_proto: parseInt(t[2], 10), sensor: parseInt(t[1], 10) }; this.lastHitAt = this.now(); }
        break;
      }
      case 'VOLTS': { const b = parseInt(t[3], 10); if (!Number.isNaN(b)) this.battery = b; this.lastVoltsAt = this.now(); break; }
      case 'VERSION': { if (t[1]) this.fw = t[1]; break; }
      case 'BUT': {
        if (this.resync) this._resyncButton(+t[1], +t[2]);
        // $BUT id 1 = ALT (protocol §$BUT: 0=trigger 1=alt-fire 2=reload 3=select 4/5=left/right).
        // Field 2026-08-30: the HUD only ever learned the live slot from $ALCD, which the gun sends on a
        // SHOT -- so after an ALT swap it kept showing the old weapon "until you press trigger". The
        // button event is the earliest evidence a swap started; $ALCD's slot still gets the last word.
        if (+t[1] === 1 && +t[2] === 1) this._altPressed();
        if (+t[1] === 2 && +t[2] === 1) this._reloadPulled();
        if (+t[1] === 0 && +t[2] === 1) this._triggerPulled();   // a DEAD gun still reports the pull (bench 2026-09-04): the station-revive gate
        break;
      }
      default: break;
    }
    this._changed();
  }

  // ---------- utility items: station presence (docs/spec/utility.md) ----------
  /** The app's latest presence snapshot (beacon.js Presence entries, strongest first). Re-renders only when the
   *  respawn station the HUD shows actually changed (id / present / rounded RSSI), not on every advert. */
  setStations(list) {
    this.stations = Array.isArray(list) ? list : [];
    this._onControlAdvert(this.now());          // K1: a kind-5 advert is the hill's other source (utility.md §5)
    const v = stationView(this._respawnStation()); const sig = v ? `${v.id}:${v.present}:${v.rssi}:${v.team}` : '';
    if (sig !== this._stationSig) { this._stationSig = sig; this._changed(); }
  }
  /** `config.stations`, when the bundle carries it, is the allow-list of station ids valid in this game --
   *  a stray phone from another game can neither revive anyone nor claim to be a control point. */
  _stationAllowed(e) {
    const allow = this.config && Array.isArray(this.config.stations) && this.config.stations.length
      ? new Set(this.config.stations.map(x => (x && typeof x === 'object') ? x.id : x)) : null;
    return !allow || allow.has(e.id);
  }
  /** My team's respawn station: a present one first, else the strongest (the HUD shows how close you are).
   *  A station admits me when it is neutral or on my gun's $TID team. */
  _respawnStation() {
    const tid = this.team ? this.team.tid : null;
    const mine = this.stations.filter(e => e && e.kind === 'respawn' && e.state !== 0 && (e.team === TEAM_ANY || e.team === tid) && this._stationAllowed(e));
    return mine.find(e => e.present) || mine[0] || null;
  }
  /** The control point this player reads: one we are standing on first, else the strongest in range.
   *  Unlike a respawn station a control point is NOT team-filtered -- an enemy-held point is exactly the
   *  one you need to hear about. A stale advert is ignored (see CONTROL_STALE_MS). */
  _controlStation() {
    // ⚠ `ageMs`, never `this.now() - e.seenAt`. `Presence` stamps `seenAt` (and now `ageMs`) with the RAW
    // `Date.now()`; a node's `now()` is that plus the MC clock offset, so subtracting one from the other
    // made every advert look stale — or none of them ever — depending on which way MC's clock leaned, with
    // no log line to explain it. The age is computed on one clock where the stamp was made.
    const live = this.stations.filter(e => e && e.kind === 'control' && this._stationAllowed(e)
      && !(Number.isFinite(e.ageMs) && e.ageMs > CONTROL_STALE_MS));
    // Latch the point we are already reading (item 2): `stations` arrives in RSSI order, so picking by
    // signal alone flips between two points as a player walks between them, and each flip looked like a
    // change of hands. Stay on the latched point while it is live; move only when it is gone, or when we
    // are actually STANDING on a different one.
    const latched = this._controlSite != null ? live.find(e => e.id === this._controlSite) : null;
    const present = live.find(e => e.present);
    if (latched && (latched.present || !present)) return latched;
    return present || live[0] || null;
  }
  /** The station a scanner revive may use RIGHT NOW, or null: dead, past the delay, link up, not resyncing, present. */
  _stationRevivable(now) {
    if (this.alive || !this.deadAt || this.respawnType !== 'scanner' || !this.bleUp || this.resync || this.reconciling || this.phase !== 'live') return null;
    if (now - this.deadAt < this.respawnDelayMs) return null;
    const st = this._respawnStation();
    return st && st.present ? st : null;
  }
  /** Trigger pulled: on a DEAD gun in scanner mode with the trigger gate, this is the revive request. */
  _triggerPulled() {
    if (this.respawnType !== 'scanner' || this.respawnGate !== 'trigger') return;
    const st = this._stationRevivable(this.now());
    if (!st) { if (!this.alive && this.phase === 'live') this.log('trigger while down: not at a respawn station', 'li'); return; }
    this._resyncRevive = false; this._revive(false, st.id);
  }
  /** The headset out-blink frame list from the bundle (A11.6), or [] when the game opted out ('native'). */
  _headsetDeath() { const h = this.frames && this.frames.headset; return (h && h.death) || []; }
  /** Re-assert the out-blink while a player stays DOWN, so a count-limited blink (~160 s) can't die before
   *  they reach a station (scanner respawn can be a long walk). No-op when the game has no death frame, and
   *  never within a few seconds of the death/revive writes (F13: the headset is a relay, back-to-back writes
   *  to it stick). Called from tick(). */
  /** §3.2 (led-language.md, bench 2026-09-07): the firmware runs its OWN bright out-flash on the headset's
   *  small LED for the whole life, for free — UNLESS an `$HLED,,6` blank was sent during it, which disables
   *  the loop. We write NOTHING to the headset at death any more (the old node-driven pulse was ≥2x dimmer
   *  and cost ~80 writes/min). This is belt-and-braces only: `down.rearm` (`$HLOOP,2,750,*`) restores the
   *  flash at native drive or better for any life where a blank slipped through (an older node, a teardown
   *  race, a mode that still paints effect 6). One write per death, past the hands-off window, never during
   *  resync — same gate as the deleted `_deathFlash`. */
  _downRearm(now) {
    const down = this.frames && this.frames.headset && this.frames.headset.down;
    if (!down || !down.rearm || this.alive || !this.deadAt || this.resync || this._downRearmSent) return;
    if (now - this.deadAt < (down.rearm_after_ms != null ? down.rearm_after_ms : 2500)) return;
    this._downRearmSent = true;
    this._write([down.rearm], 'down rearm');
  }
  /** The `death: <colour>` opt-in ONLY (a big-LED blink held alongside the native flash) re-asserts through
   *  a long DOWN so a count-limited blink (~160 s) can't die before a scanner-mode walk reaches a station.
   *  Never during resync (the gun is disarmed/unverified there), and a no-op when the game didn't opt in. */
  _reassertDeathBlink(now) {
    if (this.alive || !this.deadAt || this.resync || !this._headsetDeath().length) return;
    if (now - this.deadAt < 5000) return;                          // the _die write is still fresh
    if (now - this._deathBlinkAt < HEADSET_REBLINK_MS) return;     // not due yet
    this._headset(this._headsetDeath(), 'death (re-assert)');
    this._deathBlinkAt = now;
  }

  /** What the DOWN screen should tell a scanner-mode player (utility.md §4.3). */
  respawnHint(now) {
    if (this.alive || !this.deadAt || this.phase !== 'live') return null;
    if (this.respawnType === 'auto') return 'timer';
    if (this.respawnType === 'none') return 'out';
    // Scanner: guide to a station from the instant of death (Tony 2026-09-04: a blank STAND BY for the
    // whole respawn delay leaves a first-timer with no idea what to do). The delay only gates the actual
    // revive (_stationRevivable), never the instructions. 'hold' = at your station, revive arms in a beat.
    const st = this._respawnStation();
    if (!st) return 'find_station';
    if (!st.present) return 'approach';
    if (now - this.deadAt < this.respawnDelayMs) return 'hold';
    return this.respawnGate === 'trigger' ? 'pull_trigger' : 'reviving';
  }

  /** ALT pressed: a weapon swap has begun. Shooting is disabled until the gun finishes it. */
  _altPressed() {
    if (this.phase !== 'live' || !this.alive || this.tutorial) return;
    if (this._slotCount() < 2) { this._reloadPulled(); return; }   // empty slot 1: ALT falls back to reload (loadout.md §2) — same takeover as the handle
    this.switching = { at: this.now(), from: this.activeSlot };
    this._changed();
  }

  /** Reload handle pulled: the gun refuses fire for the weapon's reload time (catalog reload_s; 1.5 s when unknown). */
  _reloadPulled() {
    if (this.phase !== 'live' || !this.alive || this.tutorial || this.resync || this.reconciling) return;   // resync/reconcile: the gun is disarmed and unverified, no takeover
    const cap = this._ammoBySlot()[this.activeSlot] ?? this.mag;                 // the spawn $AMMO cap, not the biggest count seen so far
    if (cap && this.ammo >= cap && (this.reserve || 0) > 0) return;             // nothing to reload — the gun ignores the pull
    if (!(this.reserve > 0)) return;                                           // dry reserve: no reload happens (whatever is in the mag)
    const ws = this.player && this.player.loadout && this.player.loadout.weapons; const w = ws && (ws[this.activeSlot] || ws[0]);
    const row = w && this.weaponRow(w.weapon_id); let secs = row && row.reload_s != null ? +row.reload_s : 1.5;
    // The perk's reload multiplier is applied to the gun's $WEAP reload token by MC (compile.py apply_perks), so the
    // takeover must shrink with it too — quick_hands halves the reload (Tony, 2026-09-04).
    const pk = this.player && this.player.loadout && this.player.loadout.perk ? this.perkRow(this.player.loadout.perk) : null;
    const rm = pk && pk.effects && pk.effects.reload_mult ? +pk.effects.reload_mult : 1;
    if (rm > 0 && rm !== 1 && this.activeSlot === 0) secs *= rm;   // compile applies reload_mult to slot 0 only (slot 1 gets swap_mods)
    this.reloading = { at: this.now(), ms: Math.max(300, Math.round(secs * 1000)), slot: this.activeSlot };
    this._gunReadoutReloadGlance();   // A16 §3.1: reload gets a glance at the current readout
    this._changed();
  }
  /** Milliseconds into the current reload, or null when none is running (PURE, read by state()). */
  reloadingMs() {
    if (!this.reloading) return null;
    const ms = this.now() - this.reloading.at;
    return ms > this.reloading.ms + RELOAD_GRACE_MS ? null : ms;
  }

  _slotCount() {
    const ws = this.player && this.player.loadout && this.player.loadout.weapons;
    return ws ? ws.length : 0;
  }

  /** How long the ALT indicator has been up, or null once it has expired.
   *  PURE — it is read from state() on every render and must never mutate engine state. */
  switchingMs() {
    if (!this.switching) return null;
    const ms = this.now() - this.switching.at;
    return ms > this.switchWindowMs() ? null : ms;
  }
  /** The swap window: MC's `frames.swap_ms` (the tok15 the gun was actually given, perks applied — bench 2026-09-04);
   *  an older MC without it falls back to the stock 850 scaled by an equipped `switch_mult` perk. */
  switchWindowMs() {
    if (this.frames && Number(this.frames.swap_ms) > 0) return Number(this.frames.swap_ms);
    const pk = this.player && this.player.loadout && this.player.loadout.perk ? this.perkRow(this.player.loadout.perk) : null;
    const sm = pk && pk.effects && pk.effects.switch_mult ? +pk.effects.switch_mult : 1;
    return Math.round(SWITCH_MAX_MS * (sm > 0 ? sm : 1));
  }

  /** $ALCD,<mag>,100,<slot>,<reserve>,0 — counts are per weapon SLOT; a weapon swap is never a shot. */
  _onAmmo(mag, reserve, slot = 0) {
    slot = Number.isFinite(slot) ? slot : 0;
    const prev = this._prevAmmo[slot];
    if (prev != null && mag < prev && this.phase === 'live') this.shots += (prev - mag);
    if (this.resync && prev != null && mag < prev) this._resyncEvidence('alcd-dec');
    if (this.resync && prev != null && mag > prev) this._resyncEvidence('alcd-inc');
    if (this.reloading && prev != null && mag > prev && slot === this.reloading.slot) { this.reloading = null; }   // the mag is back: the gun fires again
    if (this.switching && slot !== this.switching.from && slot < 2) {
      // slot 4 is MELEE and arrives on its own $ALCD — it is not the weapon swap we were waiting for.
      // NB this interval is ALT-press -> next SHOT, so it includes the player's reaction time. It is a
      // lower bound on "the swap had finished by", NOT a measurement of the swap itself (FOLLOWUPS F4).
      this.lastSwitchMs = this.now() - this.switching.at;
      this.log(`slot ${this.switching.from}->${slot} confirmed ${this.lastSwitchMs}ms after ALT (incl. reaction)`, 'li');
      this.switching = null;
      this.moment = { kind: 'switched', at: this.now(), data: { slot } };   // the HUD flips SWITCHING → ACTIVE
    }
    this._prevAmmo[slot] = mag; this.activeSlot = slot;
    this.magBySlot[slot] = Math.max(this.magBySlot[slot] || 0, mag);
    this.ammo = mag; this.mag = this.magBySlot[slot];
    if (reserve != null && !Number.isNaN(reserve)) this.reserve = reserve;
  }

  _onHp(hp, armor, shield) {
    // Damage drains shield -> armor -> HP (bench 2026-08-27). Omitting shield from the
    // total made every shield-absorbed hit compute dmg === 0, which the guard below then
    // dropped entirely -- no hit_taken fact, no HUD feedback, no score. See FOLLOWUPS Q12.
    if (shield === undefined) shield = this.shield;
    const before = this.hp + this.armor + this.shield;
    if (this._prevHp === undefined) { this._prevHp = this.hp; this._prevArmor = this.armor; this._prevShield = this.shield; }
    // A16 §3.1/§5: which pool actually moved -- health, then armour, then shield (mirrors poolgauge.changed_pool:
    // BRX depletes shield -> armour -> health, so when a hit spills across two pools the INNER one is the
    // news). Computed here, BEFORE `_prevHp` etc are overwritten below, and read by `_gunPoolPaint`.
    const movedPool = hp !== this._prevHp ? 'health' : armor !== this._prevArmor ? 'armor' : shield !== this._prevShield ? 'shield' : null;
    this.hp = hp; this.armor = armor; this.shield = shield;
    const dmg = Math.max(0, before - (hp + armor + shield));
    // Victim-side low-health alert, once per life. Callsign sends $PLAY,VA8B + $HLED,7,4,90,90,10,15
    // shortly after ARMOUR reaches 0 and HP starts dropping (capture 2026-08-23-two-tagger-combat:
    // 2 deaths, 2 alerts, both at $HP,34,0,0). We sent neither, which is why our headsets stayed dark.
    //
    // A17.2 (Tony, bench 2026-09-07: "low_health shouldn't be used there. it should be used when total
    // hp is under 20"): it now fires on an ACTUAL HEALTH THRESHOLD, not on armour running out. The old
    // condition (armour 0 AND any HP lost) fired on the FIRST health hit of a life -- at 44/45 HP if
    // that is where you were -- so an alert named "low health" meant "your armour just failed". A17 made
    // that impossible to ignore rather than causing it: health hits are now silent from the gun, so this
    // alert became the ONLY sound on the armour->health transition and read as the hit sound itself.
    // The `maxArmor > 0` guard is gone with it: a HP threshold is meaningful whether or not the loadout
    // ever had armour, which is what that guard was working around.
    let hurtNow = false;
    if (this.phase === 'live' && this.spawned && this.alive && !this.tutorial
        // `dmg > 0` mirrors stage.py, which imposes it structurally (its check is nested inside
        // `if dmg > 0`). Without it a ZERO-damage $HP frame -- a heal or regen tick, or a plain resend --
        // could trip the alert while merely LEAVING you under the threshold, and a heal is the opposite
        // of the news this alert exists to carry. A genuinely damaging drop always has dmg > 0, so
        // nothing real is lost. Found by review 2026-09-07: the two mirrors had diverged here.
        && !this.hurtFired && dmg > 0 && this.hp > 0 && this.hp < LOW_HEALTH_HP) {
      this.hurtFired = true; hurtNow = true;
      const c = this.frames && this.frames.cues;
      const fr = c ? [c.hurt, c.hurt_led].filter(Boolean) : [];
      // logged explicitly: after the last field session we could not tell whether the alert had
      // fired at all, because the frame ring only holds 60 frames and had rolled past it.
      this.log(`low-health alert: hp ${this.hp} < ${LOW_HEALTH_HP} — ${fr.length} frame(s)`, 'lk');
      if (fr.length) { this._hsGen = (this._hsGen || 0) + 1; this._write(fr, 'low health'); }   // cancels a pending hit-flash rest step (polish 2026-09-04)
    }
    if (this.phase === 'live' && this.spawned && this.alive && this.hp > 0 && dmg > 0 && !this.tutorial) {
      // A registered hit WIPES the headset: the native flash runs, then it goes dark and our team
      // colour never comes back (bench 2026-09-03, hled_spawned.py). Re-send it so other players
      // keep seeing the team for the rest of the life. Skipped on the hit that fired the low-health
      // alert -- that alert IS the headset for the next ~3 s and a repaint would cut it short. A
      // static frame, one write per hit, never hammered. Empty cue = LEDs off or unknown colour.
      const hs = this.frames && this.frames.headset;
      if (hs && !hurtNow) {
        // A16 §3.3: whatever role is held (carrier/infected/vip/beacon/extracted) survives the hit — the
        // rate gate (§C) applies to this re-assert and to the plain hit flash, never to the alert/team-flip
        // writes that first turned the role on.
        const role = this._activeRole, roleSeq = role && this._roleSeq(role.name, role.tid);
        if (roleSeq) this._headsetFlash(roleSeq, `role ${role.name} after hit`);                            // the role blink survives a hit
        else if (hs.hit && hs.hit.length) this._headsetFlash(hs.hit, 'hit');                                // A11.6: flash, then back to rest
        else if (hs.rest && hs.in_play === 'team') this._write([hs.rest], 'team led');                     // no flash configured: just restore
      } else {
        const tl = this.frames && this.frames.cues && this.frames.cues.team_led;   // pre-A11.6 bundle
        if (tl && !hurtNow) this._write([tl], 'team led');
      }
    }
    if (this.phase === 'live' && this.spawned && this.latch && this.now() - this.latch.at <= 1000 && dmg > 0 && !this.tutorial) {
      // `sensor` is $HIR tok1: 0-3 are ALL HEADSET sensors (it has four; 0 = front and 1 = back are
      // bench-mapped, 2 and 3 are not), 4 = gun body. It was parsed
      // and dropped, so MC could not see WHICH sensor caught a hit — answering that took the phone's
      // raw frame ring (field 2026-09-01). One field, and the question becomes readable live.
      this.emitFact({ type: 'hit_taken', match_id: this.matchId, shooter_num: this.latch.shooter_num,
        shooter_team: this.latch.shooter_team, dmg, ir_proto: this.latch.ir_proto, sensor: this.latch.sensor });
      this.lastHitAt = this.now();
      if (this.alive && hp > 0) { this._event('hit_taken'); this._pain(dmg, this.latch.ir_proto, movedPool); }   // A11: a death is its own event; A15.3: our pain grunt by damage; A17: only when it reached HEALTH
    }
    // HUD moments. The gun's own LED strip cannot hold a steady colour in game (the firmware
    // animates it, and winning that fight needs ~30Hz repaints which STROBE), so the phone carries
    // the detailed feedback — it is the one surface we fully control. See experiment-log 2026-09-02.
    if (this.phase === 'live' && this.spawned && this.alive && !this.tutorial) {
      // A hit must not overwrite a rarer, more important moment that is still on screen. There is
      // ONE moment slot and `hit` is by far the most frequent producer, so without this a kill
      // confirm landing in the same tick as a hit is silently lost -- verified, it rendered only the
      // hit. Kill/redeploy/down own the screen for their own duration.
      // ONE RENDER TICK, not the overlay's display duration. The race is only that a rarer moment
      // set in the same tick is overwritten before the HUD has rendered it -- once rendered, the
      // kill/redeploy overlay is its own DOM node and a later hit does not disturb it.
      // Guarding for the full display duration was worse than the bug: a player shot while a kill
      // banner was up would never be told they were hit, and being hit is the one thing they cannot
      // afford to miss.
      const RARE_GUARD_MS = 250;
      const m = this.moment;
      const busy = m && ['kill', 'redeploy', 'down', 'match_over'].includes(m.kind)
        && (this.now() - m.at) < RARE_GUARD_MS;
      if (busy) { /* let the rarer moment survive long enough to be rendered */ }
      else if (dmg > 0 && hp > 0) {
        // A death sets its own 'down' moment; a hit that kills must not flash "hit" first.
        this.moment = { kind: 'hit', at: this.now(),
          data: { dmg, shooter_team: this.latch ? this.latch.shooter_team : 0,
                  // the KEY, not the tid: the engine already owns tid->key (TEAM_KEY), and a second
                  // copy of that mapping in the HUD is a divergence waiting to happen
                  shooter_key: TEAM_KEY[this.latch ? this.latch.shooter_team : 0] || 'red',
                  sensor: this.latch ? this.latch.sensor : null, hp, armor, shield } };
      } else if (before > 0) {
        // Pools went UP: a heal, an armour pickup, or a shield grant. `before > 0` keeps the
        // spawn/respawn refill out of it — that has its own 'redeploy' moment.
        const gains = [['health', hp - this._prevHp], ['armor', armor - this._prevArmor],
                       ['shield', shield - this._prevShield]].filter(g => g[1] > 0);
        if (gains.length) {
          gains.sort((a, b) => b[1] - a[1]);
          this.moment = { kind: 'gain', at: this.now(),
            data: { pool: gains[0][0], amount: gains[0][1], hp, armor, shield } };
          this._event(gains[0][0] === 'health' ? 'healed' : gains[0][0] === 'armor' ? 'armour_up' : 'shield_up');   // A11
        }
      }
    }
    this._prevHp = hp; this._prevArmor = armor; this._prevShield = shield;
    if (hp > 0) this._gunPoolPaint(movedPool);   // A16 §3.1 (readout) / A11.7 legacy (a hit does not clear a held paint, bench 2026-09-04; only the band change is written)
    const wasResync = !!this.resync || !!this.reconciling;
    if (this.resync) this._resyncEvidence('hp');
    if (hp === 0 && this.alive && this.phase === 'live') this._death(wasResync);   // a death learned during resync/reconcile is a desync death
  }

  _death(desync) {
    this.reloading = null; this.switching = null;   // the gun stops the reload/swap when you drop; so does the HUD
    const fresh = this.latch && this.now() - this.latch.at <= C.DEATH_LATCH_MS;
    const shooter_num = fresh ? this.latch.shooter_num : 0;
    const shooter_team = fresh ? this.latch.shooter_team : (this.latch ? this.latch.shooter_team : 0);
    // F81: wire id 0 is "no identity" (A5.1) -- a grenade hill's ambient damage word (F69) or a gun whose `$PSET`
    // never landed (F80). Its team field is the hill's OWNER, so naming that team as the killer told the player a
    // specific lie ("KILLED BY GREEN" when nobody shot them). MC already refuses to credit wire 0; the phone now
    // says the killer is unknown. A stale latch (older than DEATH_LATCH_MS) is the same case: nobody we can name.
    const unknown = !fresh || shooter_num === 0;
    this.alive = false; this.deaths++; this.deadAt = this.now(); this._downRearmSent = false;   // §3.2: fresh rearm gate for this life
    // A16 §5: death clears the readout — NO gun write here, the strip simply sits wherever the native hit
    // flash left it until the next `_gunTake` blanks it; a pending hold from this life must not fire later.
    this._readoutFrame = null; this._readoutHoldActive = false; this._readoutLastWriteAt = null; this._readoutLastPool = null;
    // A16.3: death cancels any drop/gain animation outright (bar-spec: "Cancel everything ... on death") --
    // the killing hit itself never reaches here (`_gunPoolPaint` is only called `if (hp > 0)`), but a hit
    // just before it can still be mid-animation when death registers.
    this._roGen = (this._roGen || 0) + 1; this._roLevel = null; this._roPool = null; this._roAnimating = false; this._roBlinkAt = 0; this._roBlinkOn = false;
    this._activeRole = null;   // A16 §3.3: cleared BEFORE the infection check below, which may assign a fresh 'infected' role in the same call
    this.killedBy = unknown
      ? { num: 0, team: null, name: null, teamName: null, teamKey: null, unknown: true }
      : { num: shooter_num, team: shooter_team, name: this.nameOf(shooter_num), teamName: TEAM_NAME[shooter_team] || `TEAM ${shooter_team}`, teamKey: TEAM_KEY[shooter_team] || 'red' };
    this.emitFact({ type: 'death', match_id: this.matchId, shooter_num, shooter_team, ...(desync ? { desync: true } : {}) });
    if (this.config && this.config.mode === 'infection' && this.frames && this.frames.team_flip) {
      const tids = Object.keys(this.frames.team_flip).filter(k => Number(k) !== this.teamTid);
      // Whether a mid-match $TID write changes the gun's own friendly-fire resolution is UNTESTED (modes §9); MC scores via team_change regardless.
      if (tids.length) {
        const tid = Number(tids[0]); this._write(this.frames.team_flip[tids[0]], 'team_flip'); this.emitFact({ type: 'team_change', match_id: this.matchId, tid });
        this._turned = true;
        this._event('infected');   // A11.4: HUD-driven -- this gun just turned; MC's broadcast only tells the OTHERS
        // A16 §3.3/finding #4: infection is not a real death (the player "re-takes the body" immediately),
        // so the turned player's held headset colour is assigned right here, through the role mechanism,
        // instead of the one-shot events table that a hit later wipes with nothing to restore it.
        this._setRole('infected', true, tid);
        const tm = ((this.config && this.config.teams) || []).find(x => Number(x.tid) === tid);
        this.team = tm ? { ...tm } : { ...(this.team || {}), tid, team_id: `tid-${tid}`, name: TEAM_NAME[tid] || `TEAM ${tid}` };
      }
    }
    this.switching = null;          // a swap indicator must not outlive the player
    this.moment = { kind: 'down', at: this.now() };
    this._event('died');   // A11
    if (this._headsetDeath().length) { this._headset(this._headsetDeath(), 'death'); this._deathBlinkAt = this.now(); }   // A11.6 out-blink (empty = the 'native' opt-out; nothing to paint)
    this.carrying = null;
    this.log(`☠ down — by ${this.killedBy.name || this.killedBy.teamName || 'UNKNOWN'}`, 'le');
    this._changed();
  }

  // ---------- §3.10 resync: trigger first, then reload, then trigger ----------
  // ---------- S7.1 reconnect reconcile: disarm, keep the real pools, re-arm — never infer death ----------
  /** A rejoin into a LIVE match. The gun keeps its config + pools across a BLE drop, and `_load` restored
   *  the real alive/hp — so we DON'T guess. Hold a disarmed window (anti-cheat: a restart is slow and
   *  gains nothing), then re-arm to the restored pools with NO $SPAWN/$PSET (so HP is never reset to full).
   *  This replaces the old trigger-first resync, which mis-concluded "dead" on reconnect and let the
   *  auto-respawn HEAL the player — a free respawn on restart (bench 2026-09-04, Tony). */
  _beginReconcile() {
    if (this.reconciling) return;
    this.reconciling = { since: this.now() };
    this.resync = null;                                   // never run the infer-death machine on a rejoin
    this._write(['$AMMO,0,0,0,1,*', '$AMMO,1,0,0,1,*'], 'reconcile: disarm');   // no shots count while we reconcile
    this.log('reconnect — reconciling (gun held ' + RECONCILE_MS + ' ms)', 'li');
    this._changed();
  }
  /** End the reconcile: re-arm to the RESTORED pools. Alive → restore the loadout mags so the gun fires
   *  again at its real HP. Down → leave it disarmed (it is out, awaiting a real respawn). Never writes
   *  $SPAWN or $PSET, so a rejoin can never heal. */
  _endReconcile() {
    this.reconciling = null;
    if (this.alive) {
      const ammo = ((this.frames && this.frames.spawn) || []).filter(f => f.startsWith('$AMMO,'));
      if (ammo.length) this._write(ammo, 'reconcile: re-arm');
    }
    this.log(`reconcile done — ${this.alive ? 'live' : 'down'} at hp ${this.hp}`, 'lk');
    this._changed();
  }

  _beginResync(why) {
    if (!(this.phase === 'lobby' || this.phase === 'armed' || this.phase === 'live')) return;
    if (this.phase === 'lobby') { this.log(`resync (${why}): LOBBY → re-write head`, 'li'); this._applyConfig({ config: this.config, frames: this.frames, roster: this.roster }, 'hydrate'); return; }
    if (this.phase === 'armed') { this.log(`resync (${why}): ARMED → re-write head, T-0 spawns as scheduled`, 'li'); if (this.frames) this._writeHead('resync head (armed)'); return; }
    this.resync = { step: 1, since: this.now(), prompt: 'pull the trigger', reserve: this.reserve, probes: 0 };
    this.log(`resync (${why}): evidence protocol started`, 'li');
    this._changed();
  }
  _resyncEvidence(kind) {
    const r = this.resync; if (!r) return;
    if (kind === 'hp' || kind === 'lcd') {
      // Polish 2026-09-04: `alive` is not persisted and a reload mid-match restores it false. A state line
      // with hp > 0 IS the evidence the gun is up; without this, tick() stamped deadAt on a healthy gun and
      // auto-revive wrote $SPAWN + $AMMO (full heal, refill, a bogus respawn fact) 10 s later.
      if (this.hp > 0 && !this.alive) this.alive = true;
      this._resyncDone('state line'); return;
    }
    if (kind === 'alcd-dec') { this._resyncDone('alive (shot went out)'); if (!this.alive) { this.alive = true; } return; }
    if (kind === 'alcd-inc' && r.step === 2) { r.step = 3; r.since = this.now(); r.prompt = 'pull the trigger'; this._changed(); }
  }
  _resyncButton(id, state) {
    const r = this.resync; if (!r || state !== 1) return;
    if (id === 0 && r.step === 1) { r.step = 2; r.since = this.now(); r.prompt = 'now the reload handle'; r.trigNoAlcd = true; this._changed(); return; }
    if (id === 2 && r.step === 2) { r.reloadAt = this.now(); return; }
    if (id === 0 && r.step === 3) { r.trig3At = this.now(); return; }
  }
  _resyncTick() {
    const r = this.resync, now = this.now();
    // step 2: a reload pull happened but no $ALCD followed within 1.5 s
    if (r.step === 2 && r.reloadAt && now - r.reloadAt > 1500) {
      const reserveKnown = r.reserve != null ? r.reserve : (this.reserve != null ? this.reserve : 1);
      if (reserveKnown > 0 || r.probes >= 1) return this._resyncNotLive('reload silent');
      // reserve == 0: ambiguous (out of ammo vs unconfigured) — wait one more probe window, then escalate (non-LMS)
      r.probes++; r.reloadAt = null; r.since = now; r.escalateAt = now + C.RESYNC_PROBE_S * 1000; r.prompt = 'out of reserve? wait…'; this._changed(); return;
    }
    if (r.step === 2 && r.escalateAt && now >= r.escalateAt) {
      if (this.respawnType === 'none') { r.escalateAt = null; r.prompt = 'out of reserve — stay put'; this._changed(); return; }   // LMS: stay last-known
      return this._resyncNotLive('reserve 0 timeout');
    }
    // step 3: trigger pulled after a good reload, no $ALCD within 1.5 s → dead
    if (r.step === 3 && r.trig3At && now - r.trig3At > 1500) {
      this.resync = null;
      if (this.alive) { this.log('resync: dead (trigger after reload, no fire)', 'le'); this._death(true); }
      this._changed(); return;
    }
    if (now - r.since > C.RESYNC_PROBE_S * 1000) { r.since = now; /* keep prompting; never write */ this._changed(); }
  }
  _resyncNotLive(why) {
    const lms = this.respawnType === 'none';
    this.log(`resync: not a live configured gun (${why})${lms ? ' — LMS: marked dead, nothing written' : ''}`, 'le');
    this.resync = null;
    if (lms) { if (this.alive) this._death(true); this._changed(); return; }
    if (this.phase === 'live') {
      if (this.alive) this._death(true);
      if (this.frames) this._writeHead('resync head');
      // normal respawn timer then revive (flagged resync)
      this._resyncRevive = true;
      this._changed(); return;
    }
    if (this.phase === 'armed' && this.frames) this._writeHead('resync head (armed)');
    this._changed();
  }
  /** Every head write goes through here: the head starts with $CLEAR, so its $LCD,0,0,… echo must read as a
   *  reset (prev=0 per slot), never as a magazine dump into `shots`. */
  /** Every head write starts with $CLEAR → the gun is back on weapon slot 0 (so $LCD, which carries no slot, books to slot 0). */
  _writeHead(label) { this._prevAmmo = {}; this.activeSlot = 0; this._write(this.frames.head, label); }
  _resyncDone(why) { this.log(`resync: ${why}`, 'lk'); this.resync = null; this._changed(); }

  // ---------- app lifecycle (§3.11) ----------
  resume() {
    this.log('app resumed — reconciling', 'li');
    if (this.phase === 'live') {
      if (this.endT && this.now() >= this.endT) { this._endLocal('expired-while-suspended'); return; }
      if (this.bleUp) this._beginResync('resume');   // §3.10/§3.11: observe BEFORE any schedule-driven write
    }
    if (this.start) this.resumeSchedule();
    this._changed();
  }

  // ---------- status body (contracts §4) ----------
  statusBody(preflight = {}) {
    const now = this.now();
    return {
      hp: this.hp, armor: this.armor, shield: this.shield, ammo: this.ammo, alive: this.alive, shots: this.shots,
      ...(this.phase === 'live' && !this.alive && this.deadAt ? { deadline_s: Math.max(0, Math.ceil((this.respawnDelayMs - (now - this.deadAt)) / 1000)) } : {}),
      ...(this.battery != null ? { battery: this.battery } : {}), ...(this.fw ? { fw: this.fw } : {}),
      arm_state: this.phase, ...(this.phase === 'armed' && this.goLiveT ? { t_minus_ms: Math.max(0, this.goLiveT - now) } : {}),
      synced: this.isSynced(), wsReason: this.wsReason || null, ...(this.matchId ? { match_id: this.matchId } : {}),
      preflight: { gun_linked: this.bleUp, headset_ok: !!this.headEcho, ...preflight },
    };
  }

  // ---------- render snapshot ----------
  state() {
    const now = this.now();
    const r = this.respawnDelayMs;
    return {
      phase: this.phase, bleUp: this.bleUp, wsState: this.wsState, gun: this.gun, night: this.night,
      player: this.player, team: this.team, teamKey: this.teamKey, teamName: this.team ? (this.team.name || TEAM_NAME[this.team.tid] || '').toUpperCase() : '',
      callsign: this.player ? this.player.display : '', playerNum: this.player ? this.player.player_num : null,
      mode: this.config ? String(this.config.mode || '').toUpperCase() : '', weapon: this.weaponName,
      hp: this.hp, armor: this.armor, shield: this.shield, maxHp: this.maxHp, maxArmor: this.maxArmor, ammo: this.ammo, reserve: this.reserve, mag: (this._ammoBySlot()[this.activeSlot] ?? this.mag),
      loadMag: this._loadAmmo()[0], loadReserve: this._loadAmmo()[1],
      alive: this.alive, deaths: this.deaths, shots: this.shots, battery: this.battery,
      kills: this.score ? this.score.kills : null, assists: this.score ? this.score.assists : null, accuracy: this.score ? this.score.accuracy : null, scoreAt: this.scoreAt,
      respawnType: this.respawnType, killedBy: this.killedBy, underFire: this.alive && this.lastHitAt > 0 && (now - this.lastHitAt) < 2000, respawnIn: (!this.alive && this.deadAt && this.respawnType === 'auto') ? Math.max(0, Math.ceil((r - (now - this.deadAt)) / 1000)) : 0,   // scanner/none modes have no countdown
      // utility.md: the respawn station this player would use, how close it reads, and what the DOWN screen should say
      station: stationView(this._respawnStation()), respawnGate: this.respawnGate, respawnHint: this.respawnHint(now),
      // F72: the most recent grenade/station beacon (proto-15 $HIR) — owner team + magnitude (8 hill, 6 respawn),
      // null once nobody has reported one this life. Not `station` above: that is BLE advert presence, this is IR.
      beacon: this.beacon || null,
      // The control point as the hill logic reads it: {owner (2 = neutral), at, from_neutral}, null once
      // presence has expired (>= 2 missed beacons). Two sources write it, never both in one game: a
      // grenade's IR beacon (derived from `beacon` above), or a phone CONTROL POINT's BLE advert, which adds
      // `source: 'station'`, `site`, `progress` 0-100, `holding`, `contested`, `rising`/`falling` and
      // `onPoint` (K1, utility.md §5). A reader that only knows `owner` behaves identically on both.
      hill: this.hill || null,
      // The possession CLOCK (`mc/API.md`'s `possession` fact): per point, per team, cumulative ms owned as
      // THIS node observed it, plus how long it could hear the point at all. Worth having in `state()` even
      // before the wire carries it — a person can read the number off a phone at the end of a match.
      possession: { by_site: this.hold, observed_ms: this.observed, source: this._holdSource || null },
      tMinusMs: this.phase === 'armed' && this.goLiveT ? Math.max(0, this.goLiveT - now) : null,
      clockMs: this.endT ? Math.max(0, this.endT - now) : (this.timeLimitMs || 0),
      ready: !!this.ready, tutorial: this.tutorial, tutorialWeapon: this.tutorialWeapon,
      // follows the LIVE slot, not always the primary (field 2026-08-30)
      weaponId: (() => { const ws = this.player && this.player.loadout && this.player.loadout.weapons; const w = ws && (ws[this.activeSlot] || ws[0]); return w ? w.weapon_id : null; })(),
      resync: this.resync ? { step: this.resync.step, prompt: this.resync.prompt } : null,
      reconciling: !!this.reconciling,
      // read ONCE: two calls could straddle the expiry and disagree (switching:true, switchingMs:null)
      ...(ms => ({ switching: ms != null, switchingMs: ms }))(this.switchingMs()),
      switchWindowMs: this.switchWindowMs(), lastSwitchMs: this.lastSwitchMs, activeSlot: this.activeSlot,
      switchFrom: this.switching ? this.switching.from : null, switchTo: this.switching ? (this.switching.from === 0 ? 1 : 0) : null,
      ...(ms => ({ reloading: ms != null, reloadMs: ms, reloadTotalMs: this.reloading ? this.reloading.ms : null }))(this.reloadingMs()),
      hits: this.score ? this.score.hits : null, board: this.score ? this.score.board : null,
      fragLimit: this.config && this.config.scoring ? this.config.scoring.frag_limit : null,
      lives: (this.config && this.config.respawn && this.config.respawn.lives != null) ? Math.max(0, this.config.respawn.lives - this.deaths) : null,
      moment: this.moment, ended: this.ended, endAck: this.endAck, matchId: this.matchId, synced: this.isSynced(), headEcho: this.headEcho,
      rejoin: !!(this.start && !this.bleUp && this.phase === 'idle'), pendingTeardown: this.pendingTeardown,
      // A10 self-serve kitting
      catalog: this.catalog, policy: this.policy, loadout: this.loadoutView(), browsing: this.browsing, loadoutAck: this.loadoutAck, pendingPick: this.pendingPick,
      canPickPrimary: this.canPick('primary'), canPickSecondary: this.canPick('secondary'), canPickPerk: this.canPick('perk'), tryoutSeen: this.tryoutSeen,
      game: this.game, kitOpen: this.kitOpen(), briefSeen: this.briefSeen,
    };
  }
}
