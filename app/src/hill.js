// The KOTH hill listener: one model for grenade beacons and phone control points.
import { OBJECTIVE_MODES, HILL_REFUSED_TID, HILL_MAG, HILL_CAPTURE_MAG, HILL_WAS_NEUTRAL_MAG, GRENADE_STALE_MS,
  ADVERT_CONTROL_STATE, HILL_TICK_MS, CONTROL_STALE_MS, CONTROL_RECONNECT_MS,
  HILL_CALLOUT_MIN_MS, HILL_TICK_LOSING_MS } from './transport/contract.gen.js';
import { clipMs } from './announcer.js';
import { LANE_HILL_CLEAR_MS } from './lanes.js';
import { claimable } from './control.js';

// Beacons update state; a node timer sets the cadence. F74 measured a gun replaying a latched IR event every 5.07 s.
// The possession tick runs on the node's clock while it holds a fresh point. Only a transition plays from a beacon.

// The floor for the capture-BEGINS cards (`_hillBegins`), per kind: two stations on one id flip their fields per scan.
const HILL_BEGINS_MIN_MS = 10000;
// A duration must never be measured across a clock STEP: `now()` is `Date.now()` plus an MC offset that
// updates as the sync converges, so one delta can jump. Clamp each accrual to a tick's worth of time.
const HOLD_STEP_MAX_MS = 1000;
// How often a growing tally goes to MC. `hold_ms` is cumulative and every report is idempotent
// (`mc/API.md` "Objective scoring"), so this is purely a wire-traffic choice; the tally at the whistle is
// sent unconditionally, because that is the report that decides the match.
const POSSESSION_REPORT_MS = 10000;
// Ids are the operator's picks, every one CONFIRMED BY EAR on hardware 2026-09-10 (rung S) — one female
// objectives announcer with a music bed, chosen over the male "Control Point" set (VA23/VA22/VA21, also
// confirmed). A8: MC ships all five from `presentation.EVENTS` (`mcp/brx_mcp/mc/presentation.py`), the one source;
// these frames are only the fallback for a bundle compiled before those rows existed. `ms` is the clip's real length
// from the generated `CLIP_MS` (the sound catalogue), which is what the scheduler below uses to keep the 0.11 s tick
// out from under a 1.9-3.0 s callout; a bundle may override a duration through `frames.cue_ms`. Picked BY ID and never
// by category: `V8Q` is catalogued "Hill Confirmed" and actually says "KILL Confirmed" (rung S), so a by-category pick
// would announce a kill line on a capture.
const hillCue = frame => ({ frame, ms: clipMs(frame) });
export const HILL_CUES = {
  hill_captured:  hillCue('$PLAY,,4,6,VB0N,,,,*'),   // VB0N "Hill Captured"  1.924 s
  hill_lost:      hillCue('$PLAY,,4,6,VB0P,,,,*'),   // VB0P "Hill Lost!"     2.976 s
  hill_contested: hillCue('$PLAY,,4,6,VB0O,,,,*'),   // VB0O "Hill Contested" 2.078 s: the holder's stall line, station path only (`_onControlAdvert`); never IR (F75)
  hill_moved:     hillCue('$PLAY,,4,6,VB0Q,,,,*'),   // VB0Q "Hill Moved"     2.424 s: rotating-hill modes only (F83), no caller yet
  hill_tick:      hillCue('$PLAY,U100,4,6,,,,,*'),   // U100 possession tick  0.114 s
};
// A hill beacon carries NO point identifier, so several points in play are indistinguishable on the wire:
// in Domination two grenades held by different teams would read as one point changing hands every few
// seconds and announce continuously. Excluded until K1 supplies a discriminator, rather than shipped noisy.
const HILL_AUDIO_EXCLUDED_MODES = new Set(['domination']);


/** Every HillListener field and why a restart may lose it (engine-persist.test.mjs checks the list against the source, both
 *  ways). The possession tally the listener reports (hold, observed, _holdSource, _holdMatch) stays on Engine and persists
 *  there (PERSIST_AS); these are the listener's own working fields, carried over from the engine's PERSIST_TRANSIENT. */
export const HILL_TRANSIENT = Object.freeze({
  _hill: 'rebuilt from the next advert', _hillTickAt: 'tick cadence', _hillTeam2Warned: 'log once per game',
  _hillWasContested: 'edge detector', _controlSig: 'render cache', _controlLastOwner: 'the next advert says the owner',
  _controlSpokenOwner: 'announcer edge', _hillPendingCallout: 'announcer edge', _hillSaidAt: 'announcer spacing',
  _hillOwnerWhenSilenced: 'announcer edge', _hillSourceWarned: 'log once per game', _hillModeWarned: 'log once per game', _hillContestedAt: 'announcer edge',
  _hillContestOwed: 'announcer edge', _hillEp: 'reconnect episode window', _hillBeginsAt: 'announcer edge',
  _holdAt: 'accrual anchor: the next advert re-anchors', _siteHold: 'F556: the per-point accrual anchors, re-anchored by the next advert', _possessionSentAt: 'report cadence',
  _possessionSig: 'report change test: starts empty, so the first tally after a restart always goes out (a restarted MC whose replay failed starts at zero)',
  _possessionSaved: 'DERIVED: the tally `_save` writes; `_load` rebuilds it from the restored hold/observed through the Engine accessor',
});

export class HillListener {
  constructor(host) {
    this.host = host;
    this.hill = null;               // {owner, at, from_neutral} — the control point's OWNER and when its last beacon landed. State from the wire; the cadence below is ours
    this._hillTickAt = 0;           // when the possession tick last played (0 = not ticking)
    this._hillTeam2Warned = false;  // F82 is logged once per game, not once per beacon
    this._hillWasContested = false; // our point was held AND contested at the last advert: the holder's stall episode (edge-triggered)
    this._controlSig = '';          // the control-point advert fields that are worth a re-render
    this._controlLastOwner = null;  // keep the last owner across presence expiry, for a returning point
    this._controlSpokenOwner = null; // owner represented by the last spoken station hill line
    this._hillPendingCallout = null; // a transition inside the 3 s floor, replaced by each newer owner edge
    this._hillSaidAt = 0;           // when a captured/lost line last played, for HILL_CALLOUT_MIN_MS
    this._hillOwnerWhenSilenced = undefined;  // C: the owner as we last heard it while audio was ON (undefined = never)
    this._hillSourceWarned = '';    // B: the refused objective source, logged once per game
    this._hillModeWarned = '';      // F535: a mode with no hill, logged once per game
    this._holdAt = 0;               // when the accrual last ran
    this._siteHold = {};            // F556: per control point (site), its own accrual anchor {_holdAt}
    this._possessionSentAt = 0; this._possessionSig = ''; this._possessionSaved = '';   // restore r1 #5: the report's and the save's change tests, kept apart
  }
  get hill() { return this._hill; }
  set hill(value) { this._hill = value; }

  /** The bundle's cue for a hill sound, else the literal fallback above, plus its real length in ms.
   *  The bundle WINS whenever it carries the key at all -- `''` is MC's deliberate mute (`cue_frames()`
   *  writes `''` for an objective cue when the profile's announcer is off), and a fallback that overrode
   *  that would turn the announcer switch into a lie. `{frame: null}` = play nothing. */
  cue(kind) {
    const def = HILL_CUES[kind]; if (!def) return { frame: null, ms: 0 };
    const cues = this.host.frames && this.host.frames.cues;
    const fromBundle = cues && Object.prototype.hasOwnProperty.call(cues, kind) ? cues[kind] : undefined;
    const frame = fromBundle !== undefined ? fromBundle : def.frame;
    if (!frame) return { frame: null, ms: 0 };
    // `hasOwnProperty`, not `||`: a bundle deliberately setting `cue_ms[kind] = 0` means "this cue must not
    // suppress the tick", and `||` silently replaced that zero with the default length instead.
    // A8: with no `cue_ms`, the length is the PLAYED frame's (`clipMs`), so a host's own hill sound is timed by its clip.
    const cm = this.host.frames && this.host.frames.cue_ms;
    const ms = cm && Object.prototype.hasOwnProperty.call(cm, kind) ? cm[kind] : clipMs(frame);
    return { frame, ms };
  }
  /** True while hill audio should be audible at all: live, on our feet, and not a mode whose points we
   *  cannot tell apart. Death is deliberately silent — A16 makes the DOWN window hands-off and the death
   *  scream owns the announcer; a player who respawns learns the current owner on the 3 s tick cadence. */
  audioOn(evenDead = false) {
    return this.host.phase === 'live' && (this.host.alive || evenDead)
      && !(this.host.config && HILL_AUDIO_EXCLUDED_MODES.has(this.host.config.mode));
  }
  /** B/F70: MC names ONE objective source per game (`config.station_source`), and the phone accepts BOTH
   *  wires. Without this gate a grenade left live on the field (F69) during a phone-point game alternates
   *  ownership with the point every 5 s and announces continuously — two sources, one `this.hill`.
   *  The vocabulary (`STATION_SOURCES`, `mcp/brx_mcp/mc/types.py`): `grenade` = the IR beacon, `phone` = the
   *  BLE control point (F103 added it 2026-09-11), `ir_station` = a `$CAPTURE`-speaking box that reaches MC,
   *  not us. Absent = no source named (a try-out, a config with no mode), so what we hear is it; a mode with no hill is refused first (F535). */
  sourceAllowed(source) {
    // F535 (bench 2026-10-16): a hill station left assigned from KOTH ran live in an FFA game, and every phone said HILL
    // CAPTURED. Only a mode whose objective IS a point (types.py OBJECTIVE_MODES) hears one; MC also stands it down.
    const mode = this.host.config && this.host.config.mode;
    if (!this.modeHasHill()) {
      if (this._hillModeWarned !== mode) { this._hillModeWarned = mode; this.host.log(`ignoring the ${source === 'station' ? 'phone control point' : 'grenade hill beacon'}: ${mode} has no hill`, 'li'); }
      return false;
    }
    const src = this.host.config && this.host.config.station_source;
    if (!src) return true;                                  // no source named (a try-out, no mode yet): what we hear is it
    const ok = source === 'station' ? src === 'phone' : src === 'grenade';
    if (!ok && this._hillSourceWarned !== source) {
      this._hillSourceWarned = source;
      this.host.log(`ignoring the ${source === 'station' ? 'phone control point' : 'grenade hill beacon'}: this game's station_source is ${src}`, 'li');
    }
    return ok;
  }
  /** F535: does this game have a hill at all? A config with no mode (a try-out, before the config) still does. PURE. */
  modeHasHill() { const mode = this.host.config && this.host.config.mode; return !mode || OBJECTIVE_MODES.includes(mode); }
  /** Do WE hold the point right now? `null`/neutral/an enemy all read false. */
  mine() {
    const mine = this.host.teamTid;
    return mine != null && mine !== HILL_REFUSED_TID && !!this.hill && this.hill.owner === mine;
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
  callout(prevOwner, owner) {
    const mine = this.host.teamTid;
    if (mine == null) return null;
    if (mine === HILL_REFUSED_TID) {   // F82: a NEUTRAL point broadcasts team 2, so a tid-2 roster cannot tell "nobody holds it" from "we hold it"
      if (!this._hillTeam2Warned) { this._hillTeam2Warned = true; this.host.log('F82: we are on tid 2, which is what a NEUTRAL hill broadcasts — hill ownership is undecidable, so no hill audio will play', 'le'); }
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
  say(kind, why) {
    // docs/announcer.md: one announcer item, keyed 'hill'. The later hill word still wins outright over a hill line on
    // air (`preemptKey`), and `preempted` is true only while THAT line is still sounding, so the `$PLAYX` only ever
    // cuts our own hill callout. Behind any other item (a kill confirm, a lead change) it waits like everything else.
    const cue = this.cue(kind);
    const card = kind === 'hill_captured' || kind === 'hill_lost';
    if (card) this.host._laneObj('hill', { kind, src: /control point/.test(why) ? 'BLE' : 'IR' });   // `show` drops it while I am down; the line still queues (announcer.md, "My death wins" rule 8)
    if (!cue.frame && !card) return;
    this.host._ann.push({ kind: card ? kind : 'alert', key: 'hill', preemptKey: true, stopsOwn: true, audioMs: cue.frame ? cue.ms : 0, ...(card ? {} : { bannerMs: 0 }),
      ok: () => this.audioOn(true),   // Tony 2026-09-25: a hill line already queued is still said while I am dead
      play: ({ preempted, muted }, self) => {
        // QA-05: the HUD's HILL CAPTURED / HILL LOST card reads this, set when the line starts (a muted line still shows).
        if (card) this.host.show('hillCallout', { kind, at: this.host.now() });
        if (cue.frame && !muted && preempted && this.host._ann.dead()) this.host._sayMust(cue.frame, `hill ${kind} (preempting, while dead: no stop) — ${why}`);   // X4
        else if (cue.frame && !muted) this.host._write(preempted ? [this.host.PLAYX, cue.frame] : [cue.frame], `hill ${kind}${preempted ? ' (preempting the line still playing)' : ''} — ${why}`);
        if (cue.frame && !muted) this.host._gun.tagLast(cue.frame, self);   // whose line: see `_death`
        this.host._changed();
      } });
  }
  /** A deduped protocol-15 beacon: update hill state and, if this frame PROVES a change of hands, announce
   *  it in this same handler. Nothing here starts a sequence, and nothing here waits for a second word. */
  onBeacon(ownerTeam, magnitude, now) {
    if (magnitude !== HILL_MAG && magnitude !== HILL_CAPTURE_MAG && magnitude !== HILL_WAS_NEUTRAL_MAG) return;   // magnitude 6 is a respawn station, not a point (F84)
    if (!this.sourceAllowed('beacon')) return;   // B: this game's objective is not a grenade
    // F82 is explained HERE, on the first beacon, not from `callout` — that is only reached when a
    // transition would be announced, so a tid-2 roster that never witnessed a capture went silent with no
    // reason in the log. The behaviour was always right (the tick is gated by `mine`); the diagnostic
    // was missing, and the stage's default roster is blue(1) + yellow(2), so this is one click away.
    if (this.host.teamTid === HILL_REFUSED_TID && !this._hillTeam2Warned) {
      this._hillTeam2Warned = true;
      this.host.log('F82: we are on tid 2, which is what a NEUTRAL hill broadcasts — hill ownership is undecidable, so no hill audio will play', 'le');
    }
    const prev = this.hill;
    const prevOwner = prev ? prev.owner : null;
    const fresh = !!prev && (now - prev.at) < GRENADE_STALE_MS;

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
      this.host._changed();
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
                  : prevOwner === HILL_REFUSED_TID };
    if (announce) {
      const kind = this.callout(prevOwner, ownerTeam);
      if (kind && this.audioOn(true)) this.say(kind, magnitude === HILL_CAPTURE_MAG
        ? `capture word (mag 50): team ${prevOwner == null ? '?' : prevOwner} -> ${ownerTeam}`
        : `owner changed on a plain beacon (the mag-50 word never reached us): team ${prevOwner} -> ${ownerTeam}`);
    }
    this.host._changed();
  }
  /** K1 — the SAME hill state and the SAME four cues, sourced from a phone CONTROL POINT's BLE advert
   *  instead of a grenade's IR word (utility.md §5 row `control`). Called from `setStations` at ~4 Hz.
   *
   *  The station has already done the counting: its advert carries the owner (byte 9 + the `held` bit), the
   *  0-100 conversion progress (byte 11) and whether two teams are on it (byte 10 bit 1). So this is a
   *  TRANSLATOR, not a second audio system -- it writes `this.hill` in the shape `mine` / `tick` /
   *  `state().hill` already read, and announces through `callout` / `say`, which keeps the
   *  preempt-not-queue rule, the real clip lengths and the tick suppression identical on both sources.
   *
   *  Two things it does differently from the IR path, both because the station measures what the grenade
   *  cannot:
   *   - **Ownership changes only through neutral.** The station drains an enemy-held point to 0 (its owners
   *     have LOST it) and only then builds it to 100 for its new owner, so "Hill Lost!" lands on the team
   *     that was robbed at the moment they actually stop holding it, and "Hill Captured" lands on the new
   *     owner up to a conversion later. `callout` already resolves both from one owner change.
   *   - **"Hill Contested" (VB0O) IS wired here.** F75 forbids it on the IR path because a non-capturing hit
   *     emits nothing and the state could only be INFERRED from a miss. A station COUNTS living bodies of
   *     each team inside its own bubble, so the contested bit is a measurement. It is the HOLDER's line, once
   *     each time a contest stops their scoring (Tony, 2026-10-02); see the block that says it below.
   *
   *  ⚠ ONE point. A station advert does name its own id, so unlike F88's grenades several points ARE
   *  distinguishable on this wire -- but `this.hill` models a single point, so the nearest/occupied one wins
   *  and multi-point Domination stays out of scope (`HILL_AUDIO_EXCLUDED_MODES` already mutes it). That is the HUD and the
   *  audio only: since F556 the possession clock accrues every point heard (`accrueStations`). */
  onAdvert(now) {
    const e = this.host._controlStation();
    if (!e) return;
    if (e.paused) return;   // F537 review r3: a frozen entry is not a fresh advert; it must not keep the point alive or scoring
    if (!this.sourceAllowed('station')) return;   // B: this game's objective is a grenade, not a phone point
    if (this.host.teamTid === HILL_REFUSED_TID && !this._hillTeam2Warned) {   // F82, the same warning as the IR path
      this._hillTeam2Warned = true;
      this.host.log('F82: we are on tid 2, which is what a NEUTRAL point broadcasts — control-point ownership is undecidable, so no hill audio will play', 'le');
    }
    // The station says 255 for "nobody holds it"; the hill model (and `modes/hillbeacon.py`) says team 2,
    // because that is what a NEUTRAL grenade broadcasts. Map once, HERE, so everything downstream is shared.
    const held = !!(e.state & ADVERT_CONTROL_STATE.held);
    // Not held, a colour tid, or 255 all mean the same thing to this model: nobody. A `held` advert naming
    // tid 2 needs no special case — 2 IS the neutral sentinel, so an unauthenticated advert cannot use it to
    // install an owner nobody could decide (F82), it just says "nobody" the long way round.
    // `claimable` rather than a restated `e.team <= 3`: the station side already decides who may hold a point
    // with it (control.js), and a hand-copy of that boundary is one edit away from disagreeing with it. A
    // mutation audit (2026-09-11) moved the old literal to `<= 4` and the whole suite stayed green, which
    // would have made a COLOUR tid a point owner — tids 4-7 are not teams ($TID is masked to 2 bits, F35/F96).
    const owner = (held && claimable(e.team)) ? e.team : HILL_REFUSED_TID;
    const contested = !!(e.state & ADVERT_CONTROL_STATE.contested);
    // §5d.3: `rising && falling` is INVALID and direction falls back to UNKNOWN. Flags are independent bits,
    // so unlike a 2-bit phase field they CAN both be set -- and adverts are unauthenticated (§3), so a buggy
    // or hostile station can say it. A reader that trusts whichever bit it tests first shows a defender the
    // point moving the wrong way, which is worse than showing no direction at all.
    const bothWays = (e.state & ADVERT_CONTROL_STATE.rising) && (e.state & ADVERT_CONTROL_STATE.falling);
    const rising = !bothWays && !!(e.state & ADVERT_CONTROL_STATE.rising);
    const falling = !bothWays && !!(e.state & ADVERT_CONTROL_STATE.falling);
    const prev = this.hill;
    // A: two points are two different objectives, and `site` was recorded and never compared. A point we
    // were not reading before tells us NOTHING about a change of hands — walking from our own point toward
    // an enemy's used to fire "Hill Lost!" for a point nobody had taken. A different site (or the other
    // source's state) is adopted SILENTLY, exactly as walking back into range is (`onBeacon`).
    const sameSite = !!prev && prev.source === 'station' && prev.site === e.id;
    const remembered = this._controlLastOwner;
    const rememberedFresh = remembered?.site === e.id && now - remembered.at <= CONTROL_RECONNECT_MS;
    if (sameSite && !rememberedFresh) {
      if (this._controlSpokenOwner?.site === e.id) this._controlSpokenOwner = null;
      if (this._hillPendingCallout?.site === e.id) this._hillPendingCallout = null;
      this._hillOwnerWhenSilenced = undefined;
    }
    const prevOwner = sameSite ? (rememberedFresh ? prev.owner : null) : rememberedFresh ? remembered.owner : null;
    if (!sameSite && prev && prev.site !== e.id) {
      this.host.log(`control point ${e.id} is a different point from ${prev.source === 'station' ? prev.site : 'the grenade hill'} — adopting its owner silently`, 'li');
      this._hillWasContested = false; this._hillOwnerWhenSilenced = undefined;
    }
    if (this._hillPendingCallout && this._hillPendingCallout.site !== e.id) this._hillPendingCallout = null;
    this.host._controlSite = e.id;
    this.hill = {
      owner, at: now,
      // A station capture ALWAYS passes through neutral (that is the two-phase rule), so this is true for
      // every handover it reports -- which is the literal truth, not a leak of the IR path's meaning.
      from_neutral: prevOwner === HILL_REFUSED_TID,
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
    // one (the same rule `say` enforces by preempting).
    const audio = this.audioOn(true);   // Tony 2026-09-25: a hill change while I am dead queues too ("game alerts")
    let said = false;
    const announceFrom = audio && this._hillOwnerWhenSilenced !== undefined && this._hillOwnerWhenSilenced !== prevOwner
      ? this._hillOwnerWhenSilenced : prevOwner;
    const spokenOwner = this._controlSpokenOwner?.site === e.id ? this._controlSpokenOwner.owner : prevOwner;
    const calloutFrom = spokenOwner ?? announceFrom;
    const ownerChanged = prevOwner != null && prevOwner !== owner;
    const netChange = spokenOwner != null && spokenOwner !== owner;
    const owedChange = audio && this._hillOwnerWhenSilenced != null && this._hillOwnerWhenSilenced !== owner;
    if ((ownerChanged || owedChange) && netChange) {
      const kind = audio ? this.callout(calloutFrom, owner) : null;
      if (audio && kind) {
        // A transition inside the floor stays pending. A later owner edge replaces or cancels it, so the
        // tick never announces a state that the latest advert has already disproved.
        if (now - this._hillSaidAt >= HILL_CALLOUT_MIN_MS) {
          this._hillPendingCallout = null;
          this._hillSaidAt = now;
          this.say(kind, calloutFrom === prevOwner ? `control point ${e.id}: team ${prevOwner} -> ${owner}`
            : `control point ${e.id}: it changed hands while we were down (team ${calloutFrom} -> ${owner})`);
          this._controlSpokenOwner = { site: e.id, owner };
          said = true;
        } else {
          this._hillPendingCallout = { site: e.id, from: calloutFrom, to: owner, kind };
        }
      } else if (this._hillPendingCallout?.site === e.id) {
        this._hillPendingCallout = null;
      }
    } else if (!netChange && this._hillPendingCallout?.site === e.id) {
      this._hillPendingCallout = null;
    }
    const advertAge = Number.isFinite(e.ageMs) ? Math.max(0, e.ageMs) : 0;
    this._controlLastOwner = { site: e.id, owner, at: now - advertAge };
    // Track the owner we last heard with audio ON, so the line above can be owed across a death window.
    this._hillOwnerWhenSilenced = audio ? undefined : (this._hillOwnerWhenSilenced === undefined ? prevOwner : this._hillOwnerWhenSilenced);
    // Tony, 2026-10-02: "Hill contested should play whenever you stop scoring points because of the other team's
    // presence." Scoring pauses exactly while a point is HELD and contested (`accrue`, `tick`, and the
    // station's own tally in control.js), and contested is the station's count of two teams in the circle. So the
    // line is the HOLDER's, wherever they stand, once per stall: on the edge into "our point held and contested",
    // and again only after scoring has resumed (the bit cleared, or the point left our hands) and stopped again.
    // Nobody else hears it: an attacker's presence stops the holder's scoring, not theirs, and a contest on a point
    // nobody holds stops nobody's. An episode is the rate limit, plus a 3 s floor (polish r1) against two stations on one id flapping
    // the bit; F440's debounced presence keeps it steady at the edge of the circle. A capture callout in the same advert wins
    // outright (`say` preempts; the episode still counts as started, so it is not said late).
    const mine = this.host.teamTid;
    const stalled = contested && held && mine != null && mine !== HILL_REFUSED_TID && owner === mine;
    // Polish r1: two stations on one id alternate their fields every scan, so the bit can flap where F440's debounce
    // cannot reach; HILL_CALLOUT_MIN_MS (3 s, the floor the transition lines already have) bounds that. A stall inside
    // the floor is owed, and said when the floor passes only if the point is still held and contested.
    // H-L (review 2026-10-03): an edge the floor blocks is OWED, and said once the floor passes if it is still a stall.
    const floorOk = now - (this._hillContestedAt || 0) >= HILL_CALLOUT_MIN_MS;
    if (stalled && (!this._hillWasContested || this._hillContestOwed) && !said && audio && floorOk) {
      this._hillContestedAt = now; this._hillContestOwed = false;
      this.say('hill_contested', `control point ${e.id}: our scoring stopped, the other team is in the circle (${e.value}%)`);
    } else if (!stalled || said || !audio) this._hillContestOwed = false;
    else if (!this._hillWasContested && !floorOk) this._hillContestOwed = true;
    this.begins(e.id, now, audio && !said && !this.host._alertsMissed(), said && !this.host._alertsMissed());   // down: the episode is marked, its badge missed (and its 10 s floor not spent)
    this._hillWasContested = stalled;
    // 4 Hz: only a fact the screen shows is worth a render (progress to the whole percent, like the RSSI
    // rounding in `setStations`).
    const sig = `${e.id}:${owner}:${held}:${contested}:${this.hill.progress}:${this.hill.holding}:${rising}:${falling}:${e.present}`;
    if (sig !== this._controlSig) { this._controlSig = sig; this.host._changed(); }
  }
  /** Tony, 2026-10-02: HILL CAPTURE STARTED. One badge on the hill lane (the same OBJECTIVE item as HILL CAPTURED /
   *  HILL LOST, so the same queue and clash rules), a NEUTRAL badge whose marker names the CAPTURING team, shown to EVERYONE,
   *  whenever any team's capture progress starts rising: a team building a point nobody holds, or draining a point
   *  another team holds or is building (`falling`). The defenders and the attackers see the same badge.
   *
   *  Once per EPISODE per capturing team, never per advert. A team's episode lasts while it builds a neutral point
   *  (its bar above 0), or while the point it drains is still another team's and between 0 and 100. So a capture
   *  that stalls and resumes is one episode, and so is a steal (the drain to 0, then the thief's build); it ends
   *  when that team's progress is gone, the point is whole again, or the team owns it. Station adverts only: a
   *  grenade beacon carries no progress. The first advert of a point (or one heard again after
   *  `CONTROL_RECONNECT_MS`) is adopted silently, as the owner is: we did not see that capture begin.
   *  `HILL_BEGINS_MIN_MS` bounds a flapping advert (two stations on one id alternate their fields per scan) to one
   *  badge per team per 10 s. No voice line: the catalogue has no "capturing" clip, and the badge's own tap is the buzz.
   *
   *  ⚠ The advert names the point's team (owner while held, else the builder), never the DRAINER. With two teams in
   *  the game the drainer is the other one; with three or more it is unknown, so a drain shows nothing and the badge
   *  waits for the thief's own build, which the advert does name. */
  begins(site, now, on, deferNew = false) {
    const h = this.hill;
    if (!h || h.source !== 'station') { this._hillEp = null; return; }
    const neutral = h.owner === HILL_REFUSED_TID, x = neutral ? h.holding : h.owner, p = h.progress;
    const prev = this._hillEp && this._hillEp.site === site && now - this._hillEp.at <= CONTROL_RECONNECT_MS ? this._hillEp : null;
    const eps = {};
    if (neutral && x != null && (p > 0 || h.rising)) eps[x] = 'build';   // polish r1: the zero crossing reads {thief, rising, 0}; it is still their capture
    const drainer = x != null && h.falling ? this.rival(x) : null;
    if (drainer != null) eps[drainer] = 'drain';
    for (const t of Object.keys(prev ? prev.eps : {}).map(Number)) {   // a drain that stalls is still that team's capture
      if (eps[t] == null && prev.eps[t] === 'drain' && x != null && x !== t && p > 0 && p < 100) eps[t] = 'drain';
    }
    this._hillEp = { site, at: now, eps };
    // H-M1 (review 2026-10-03): a callout in this advert (`deferNew`) wins it, so a team whose episode starts here is
    // left unmarked and badged on the next advert. A three-team steal's zero crossing says HILL LOST to the holder.
    if (prev && deferNew) for (const t of Object.keys(eps)) if (prev.eps[t] == null) delete eps[t];
    if (!prev || !on) return;
    const at = this._hillBeginsAt || (this._hillBeginsAt = {});
    for (const t of Object.keys(eps).map(Number)) {
      if (prev.eps[t] != null) continue;
      const key = this.host.TEAM_KEY[t] || String(t);
      if (at[t] != null && now - at[t] < HILL_BEGINS_MIN_MS) { this.host.log(`hill capture started not shown: team ${key} inside the ${HILL_BEGINS_MIN_MS / 1000} s floor (control point ${site})`, 'li'); continue; }
      at[t] = now;
      this.host.log(`hill capture started: team ${key} ${eps[t] === 'build' ? 'started to build' : 'started to drain'} control point ${site} (${p}%)`, 'li');
      this.host._laneObj('hill', { kind: 'hill_capture_started', team: key, tid: t, src: 'BLE' });
    }
  }
  /** The one team that can be draining a point team `x` holds or is building: the only OTHER claimable team in this
   *  game, or null when there are none or several (the advert does not name the drainer). */
  rival(x) {
    const tids = [...new Set(((this.host.config && this.host.config.teams) || []).map(t => t && t.tid).filter(t => Number.isInteger(t) && claimable(t) && t !== x))];
    return tids.length === 1 ? tids[0] : null;
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
  accrue(h, now, slot = this) {
    if (this.host.phase !== 'live') { slot._holdAt = 0; return; }   // a point heard in the lobby is not possession
    this.holdTally();
    // Anchor the FIRST interval on when the point was last SEEN, not on when our tick happened to run.
    // Seeding from `now` instead lost one tick's worth on every fresh hold -- 250 ms at our normal cadence
    // but a full second on a throttled phone, which made possession depend on tick rate, the exact thing
    // this accumulator exists to avoid.
    if (!slot._holdAt) slot._holdAt = (h.at != null && h.at <= now) ? h.at : now;
    const goLive = this.host.goLiveT;   // F556 review: a point last heard before go-live banks nothing from before it
    if (Number.isFinite(goLive) && goLive <= now && slot._holdAt < goLive) slot._holdAt = goLive;   // a go-live still ahead (a clock step) clamps nothing
    const dt = Math.max(0, Math.min(HOLD_STEP_MAX_MS, now - slot._holdAt));
    slot._holdAt = now;
    if (!dt) return;
    // A grenade beacon carries NO point id (F88), so its site is unnamed; a station advert names itself.
    const site = h.site != null ? String(h.site) : '';
    this.host._holdSource = h.source === 'station' ? 'station' : 'beacon';
    this.host.observed[site] = (this.host.observed[site] || 0) + dt;
    // F382 (Tony, 2026-09-25): the hill scores continuous hold time and PAUSES while contested, as the Stick does.
    if (h.owner != null && !h.contested) {
      const by = this.host.hold[site] || (this.host.hold[site] = {});
      by[h.owner] = (by[h.owner] || 0) + dt;   // tid 2 included: MC credits it to nobody as `neutral_s`
    }
  }
  /** F556: accrue every control point heard now, each on its own clock (`_siteHold`), with the advert-path decode: held
   *  and a claimable tid is the owner, else nobody (tid 2, which MC credits to no team). A point that falls silent drops. */
  accrueStations(now) {
    const heard = (this.host._controlStations && this.host._controlStations()) || [];
    const keep = {};
    for (const e of heard) {
      const site = String(e.id);
      const slot = keep[site] = this._siteHold[site] || { _holdAt: 0 };
      const held = !!(e.state & ADVERT_CONTROL_STATE.held);
      this.accrue({ owner: (held && claimable(e.team)) ? e.team : HILL_REFUSED_TID, contested: !!(e.state & ADVERT_CONTROL_STATE.contested),
        at: Number.isFinite(e.ageMs) ? now - e.ageMs : now, site: e.id, source: 'station' }, now, slot);
    }
    this._siteHold = keep;
  }
  /** Send the tally to MC. `hold_ms` is CUMULATIVE and every report is idempotent, so this is
   *  resend-as-it-grows on a slow cadence, plus one unconditional report at the whistle. */
  report(now, force = false) {
    if (!this.host.matchId) return;
    this.holdTally();
    const sites = Object.keys(this.host.observed);
    if (!sites.length) return;
    const sig = JSON.stringify([this.host.hold, this.host.observed]);
    if (!force && (sig === this._possessionSig || now - this._possessionSentAt < POSSESSION_REPORT_MS)) return;
    this._possessionSig = sig; this._possessionSaved = sig; this._possessionSentAt = now;
    for (const site of sites) {
      const hold = this.host.hold[site] || {};
      this.host.emitFact({ type: 'possession', match_id: this.host.matchId, ...(site ? { site } : {}),
        hold_ms: Object.fromEntries(Object.entries(hold).map(([tid, ms]) => [String(tid), Math.round(ms)])),
        observed_ms: Math.round(this.host.observed[site]), source: this.host._holdSource || 'station' });
    }
  }
  /** T2 r1: the tally belongs to ONE match. `startAt` resets it on a new match, but a welcome that names the next match
   *  sets `matchId` before its `start` runs, so `startAt` sees no change. Any other match id starts a fresh tally here, at
   *  its first use, wherever the id changed. A null `_holdMatch` is a tally not yet tied to a match: it takes this one. */
  holdTally() {
    if (this.host._holdMatch === this.host.matchId) return;
    if (this.host._holdMatch == null) { this.host._holdMatch = this.host.matchId; return; }
    this.host.hold = {}; this.host.observed = {}; this._holdAt = 0; this._siteHold = {}; this.host._holdSource = null; this._possessionSig = ''; this._possessionSaved = ''; this._possessionSentAt = 0;
    this.host._holdMatch = this.host.matchId;
  }
  /** A new match must not inherit the last one's point, its tally, or its once-per-game warnings. */
  reset() {
    this.hill = null; this.host.hillCallout = null; this._hillTickAt = 0;
    this.host._controlSite = null; this._controlLastOwner = null; this._controlSpokenOwner = null; this._hillPendingCallout = null; this._controlSig = ''; this._hillSaidAt = 0;
    this._hillWasContested = false; this._hillContestedAt = 0; this._hillContestOwed = false; this._hillOwnerWhenSilenced = undefined;
    this._hillTeam2Warned = false; this._hillSourceWarned = ''; this._hillModeWarned = '';
    this._hillEp = null; this._hillBeginsAt = {};
    this.host.hold = {}; this.host.observed = {}; this._holdAt = 0; this._siteHold = {}; this.host._holdSource = null;
    this._possessionSig = ''; this._possessionSaved = ''; this._possessionSentAt = 0;
  }
  /** Called from tick() (~250 ms): expire a stale point, then play the possession tick on OUR clock while
   *  we hold a fresh one. This is the only place the tick fires from — a beacon arrives once per ~5 s and
   *  could never carry a 1 s cadence, and driving audio per beacon is exactly what F74 forbids. */
  tick(now) {
    const hillBadge = this.host._lanes?.obj?.hill;
    if (hillBadge && this.host._laneAge(hillBadge.at, now) >= LANE_HILL_CLEAR_MS) {
      const { hill: _hill, ...obj } = this.host._lanes.obj;
      this.host._lanes.obj = obj;
      this.host._changed();
    }
    const h = this.hill;
    if (!h) { this._holdAt = 0; this._siteHold = {}; return; }   // nothing to hear: the next accrual must not count the gap
    // F535 (Codex review): a hill still in memory from a KOTH game is dropped in a mode with no hill: no tick, no hold.
    if (!this.modeHasHill()) {
      this.hill = null; this._hillTickAt = 0; this._holdAt = 0; this._siteHold = {}; this._hillPendingCallout = null; this._controlSig = ''; this._hillWasContested = false;
      this.host.log(`hill dropped: ${this.host.config.mode} has no hill`, 'li'); this.host._changed();
      return;
    }
    // F537 review r3: our own scan is closed. The point neither expires (that was the flap) nor scores (MC takes the
    // largest tally, so a phone that pauses more would score more); the next fresh advert re-anchors the clock.
    if (h.source === 'station' && this.host._controlStation()?.paused) { this._holdAt = 0; this._siteHold = {}; return; }
    // A grenade point expires on two missed 5 s beacons; a phone control point expires on the §3 presence
    // rule, because its advert is continuous (§5d.5). Same code, the window is the source's.
    const window = h.source === 'station' ? CONTROL_STALE_MS : GRENADE_STALE_MS;
    if (now - h.at >= window) {   // out of range or off the point. NOT a "lost" — nobody took it from us
      this.hill = null; this._hillTickAt = 0; this._holdAt = 0; this._siteHold = {};
      if (this._hillPendingCallout?.site === h.site) this._hillPendingCallout = null;
      this._controlSig = ''; this._hillWasContested = false;   // K1: walking back into range must be able to re-announce
      this.host.log(`hill presence expired (${Math.round((now - h.at) / 1000)}s since its last beacon)`, 'li');
      this.host._changed();
      return;
    }
    // the CLOCK runs whatever the audio does: possession is a fact about the point. F556: a station hill counts EVERY point
    // heard, each on its own anchor; the latched one (`h`) is only what the HUD and the audio read.
    if (h.source === 'station') this.accrueStations(now); else this.accrue(h, now);
    const pending = this._hillPendingCallout;
    if (pending) {
      if (h.source !== 'station' || h.site !== pending.site || h.owner !== pending.to) this._hillPendingCallout = null;
      else if (now - this._hillSaidAt >= HILL_CALLOUT_MIN_MS && this.audioOn(true)) {
        this._hillPendingCallout = null;
        this._hillSaidAt = now;
        this.say(pending.kind, `control point ${pending.site}: team ${pending.from} -> ${pending.to} (deferred by callout floor)`);
        this._controlSpokenOwner = { site: pending.site, owner: pending.to };
      }
    }
    if (h.contested) { this._hillTickAt = now; return; } // contested ownership earns no audible score tick
    if (!this.audioOn() || !this.mine()) return;
    // docs/announcer.md: the tick never queues behind a clip on the gun, nor jumps a waiting line, nor sounds while the item on
    // air still has audio due (the gaps inside a kill item: the 120 ms flash-to-line gap, the gap between medal lines). It is
    // a token-1 clip, the gun's interrupt slot: written there, it cuts whatever plays.
    if (this.host._gun.outstanding(now) > 0 || this.host._ann.queue.length || this.host._ann.audioBusy(now)) return;
    // D: OUR point draining doubles the cadence. Nothing else is audible before "Hill Lost!", which arrives
    // when it is already too late — the defender hears an unchanged 3 s tick right up to the moment they
    // have lost it. `falling` comes off the advert, so this costs a comparison.
    const period = h.falling ? HILL_TICK_LOSING_MS : HILL_TICK_MS;
    if (this._hillTickAt && now - this._hillTickAt < period) return;
    const cue = this.cue('hill_tick');
    if (!cue.frame) return;
    this._hillTickAt = now;
    this.host._write([cue.frame], 'hill possession tick');   // recorded in the gun's audio FIFO by `_audioWrite`
  }

}
