// The phone's ONE announcer queue (docs/announcer.md). Every voice line the announcer speaks and every HUD
// banner or callout card that goes with it passes through here, so two never play or show at once.
// Field 2026-09-24 (Tony, app 0.4.11): "the hud alert for takes the lead and the kill confirmation both played
// on top of each other. they should not overlap". Before this, five paths wrote `$PLAY` and set a HUD field
// on their own: MC's kill feedback, MC's alerts (the lead change among them), the S57 IR callouts, the hill
// transitions and the powerup cards.
//
// Pure and time-driven: the owner passes its own `now()` (the engine's mockable clock) and calls `tick()` from
// its own tick. There is no timer in here, so a test drives it by moving the clock.

/** Priority, highest first. One kind per rank; the engine maps every MC alert that is not a lead change to
 *  `alert`. The player's OWN kill confirmation leads (Tony), then the lead change, then the medal lines of a kill
 *  already confirmed, then what the player can act on (the objective, their own pickup), then match news, then other
 *  players' deaths, then item spawns. */
export const ANNOUNCE_PRIORITY = [
  'kill_confirmed',   // my own kill: the IR KILL CONFIRMED, MC's kill feedback, and its medal / multikill lines
  'lead_taken',       // MC alert: my team (or I) took the lead
  'lead_lost',        // MC alert: my team (or I) lost it
  'medal',            // my own kill's medal lines once its kill line was said (the IR word said it): after the lead change
  'hill_captured',    // the engine's own hill transition
  'hill_lost',
  'powerup_swap',     // "<NEW> REPLACES <OLD>": my own pickup
  'alert',            // every other MC alert (next kill wins, flag, VIP, bomb), the clock warnings, victory
  'teammate_down',    // S57 IR callout: a card, no sound
  'enemy_down',       // S57 IR callout: "Target down."
  'powerup_spawn',    // "<ITEM> AVAILABLE"
  'status',           // the pool voice lines: shields online / charging, healed, armour up (no banner)
];

/** How long an item may wait in the queue before it is stale and dropped unplayed (ms since it was queued).
 *  A lead change is a statement about the score NOW: said three seconds late it can be false. */
export const ANNOUNCE_TTL_MS = {
  kill_confirmed: Infinity,   // Tony: my own kill confirm leads and is never lost, however long a medal stack ahead of it runs
  lead_taken: Infinity, lead_lost: Infinity,   // must-hear: it waits, never expires. A newer lead state REPLACES it (key 'lead')
  medal: Infinity,      // must-hear, like the kill line it follows
  hill_captured: 3000, hill_lost: 3000,
  powerup_swap: 4000,
  alert: 6000,          // match news (next kill wins, the clock) still holds a few seconds on; it waits behind a kill AND a lead line
  teammate_down: 3000, enemy_down: 3000,
  powerup_spawn: 5000,   // = PU_ANNOUNCE_LATE_MS: a spawn older than this is not announced at all
  status: 1500,          // "Shields online" said late describes a pool that may already be draining again
};

/** A line that would START later than this after its event is not said (the card still shows, if the item has one).
 *  Tony's match 2026-09-24: lines landing 10-15 s late inside the gun are worse than silence. Must-hear lines (my own
 *  kill confirm, the lead change) get longer: the kill's own TTL is Infinity, its VOICE stops mattering after 6 s. */
export const ANNOUNCE_AUDIO_LATE_MS = { kill_confirmed: 6000, medal: 6000, lead_taken: Infinity, lead_lost: Infinity };
export const ANNOUNCE_AUDIO_LATE_DEFAULT_MS = 2000;
export const MUST_HEAR = new Set(['kill_confirmed', 'medal', 'lead_taken', 'lead_lost']);
/** My own kill: its item holds its full slot, and nothing must-hear flushes over it while it still sounds. */
export const OWN_KILL = new Set(['kill_confirmed', 'medal']);
/** Objective lines: not must-hear (they wait for a silent gun, and go stale), but the shield loop never mutes them. While
 *  the loop blocks the gun, the item plays with `flush: true` and the owner says it like a must-hear line (the stops,
 *  then the line). Stopping the loop cuts nothing anyone wants to hear, and it resumes by itself. Ambient lines (the
 *  alerts, the pool lines) stay droppable. */
export const OBJECTIVE = new Set(['hill_captured', 'hill_lost', 'enemy_down']);

/** The shortest slot each kind holds: its banner's hold in hud.js, so the NEXT item's banner never lands on a
 *  card still showing. The slot is the longer of this and the clip (plus ANNOUNCE_GAP_MS). */
export const ANNOUNCE_BANNER_MS = {
  kill_confirmed: 1800, medal: 1800, lead_taken: 2200, lead_lost: 2200, hill_captured: 2200, hill_lost: 2200,
  powerup_swap: 2200, alert: 2200, teammate_down: 2000, enemy_down: 2000, powerup_spawn: 2400, status: 0,
};

/** Which HUD surface a kind draws on. Two items on the SAME surface replace each other in place (hud.js
 *  `_swap`), so the next one may start once the current one's audio is over, without waiting out the card. */
export const ANNOUNCE_SURFACE = {
  kill_confirmed: 'co', medal: 'co', hill_captured: 'co', hill_lost: 'co', powerup_swap: 'co', teammate_down: 'co',
  enemy_down: 'co', powerup_spawn: 'co', lead_taken: 'alert', lead_lost: 'alert', alert: 'alert',
};

export const ANNOUNCE_GAP_MS = 150;              // silence between two lines, so the second is not heard as the tail of the first
export const ANNOUNCE_DEFAULT_CLIP_MS = 2500;    // a clip not in CLIP_MS: the announcer lines run 0.6-3.0 s

/** Real clip lengths (ms), from `mcp/brx_mcp/data/sound_catalog.json` (`duration_s`); `app/test/announcer.test.mjs`
 *  checks every row against it and that every sound id the golden bundle ships is here. Every id the phone or the gun
 *  can play in a game: each `$PLAY` cue and pool, each `$SIR` row sound (the gun's own hit sounds), each `$PSET` voice
 *  and effect slot (the death scream, the t23 shield loop), plus the S57 ENEMY DOWN and the four hill lines. */
export const CLIP_MS = {
  A10: 14952, H02: 391, H06: 435, H22: 557, H23: 1364, H36: 536, H44: 1414, H49: 1213, H50: 993, H57: 757, JAD: 3503,
  JAS: 10697, JAY: 5688, N101: 2571, N102: 2108, N74: 1940, U15: 207, U16: 426, U100: 114, V112: 2251, V113: 2094, V114: 1139,
  V115: 2851, V124: 1885, V4G: 540, VA1C: 1796, VA1G: 1201, VA1Q: 1097, VA1S: 1582, VA1U: 1340, VA23: 1631,
  VA3: 1271, VA33: 1884, VA3U: 2284, VA4: 1524, VA5: 1292, VA6D: 1943, VA6E: 2675, VA6Y: 2026, VA7: 2111, VA7E: 1787,
  VA7H: 2456, VA7K: 1924, VA7Q: 1904, VA8: 1014, VA81: 3025, VA85: 10010, VA86: 1984, VA8C: 1497, VA8X: 759,
  VA9: 1209, VAA: 636, VAC: 786, VAD: 611, VAE: 1250, VAF: 1161, VAG: 584, VAH: 449, VAI: 1786, VAK: 738, VAL: 1355,
  VAN: 758, VAO: 784, VB0C: 1282, VB0D: 1581, VB0E: 1655, VB0N: 1924, VB0O: 2078, VB0P: 2976, VB0Q: 2424, VB1M: 1640,
  VB1T: 2159, VB8: 1014, VS7: 1343, VX0U: 1175, VX73: 989, W71: 736, X13: 1548, X20: 5330, X49: 385,
};

/** The clip id of a `$PLAY` frame: token 4 (the queue slot), else token 1 (the interrupt slot). */
export function clipId(frame) {
  if (!frame || typeof frame !== 'string') return '';
  const t = frame.split(',');
  return ((t[4] || t[1] || '')).trim();
}
/** A frame's length in ms: the bundle's `cue_ms[kind]` when it carries one, else CLIP_MS, else the default. */
export function clipMs(frame, override) {
  if (Number.isFinite(override)) return override;
  if (!frame) return 0;
  const ms = CLIP_MS[clipId(frame)];
  return Number.isFinite(ms) ? ms : ANNOUNCE_DEFAULT_CLIP_MS;
}

const rank = kind => { const i = ANNOUNCE_PRIORITY.indexOf(kind); return i < 0 ? ANNOUNCE_PRIORITY.length : i; };

/**
 * An item: `{kind, key?, audioMs, bannerMs?, play(ctx), ok?(), data?}`.
 * - `play({preempted, waited, muted, flush}, item)`: `muted` = say nothing (the line would start too late, ANNOUNCE_AUDIO_LATE_MS);
 *   `flush` = an OBJECTIVE line while the shield loop blocks the gun: say it like a must-hear line (the stops, then the line).
 *   It does the write(s) and sets the HUD field; it runs once, when the item starts.
 *   `item` is the queue's own copy, so a caller can keep a reference to it (and `push` returns the same object).
 * - `audioMs` is how long its sound runs (0 = silent). The slot is max(audioMs + gap, bannerMs).
 * - `key` collapses duplicates: the same key and kind already queued or playing drops the new one; the same
 *   key with a different kind still queued is REPLACED (the newest state is the true one: lead taken, then
 *   lost). `preemptKey: true` lets a new item take over a PLAYING item of the same key (the hill rule).
 * - `ok()` is checked again at play time (a hill line is not said to a player who died while it waited).
 * - `onDrop()` runs when the item leaves the queue WITHOUT playing (expired, refused, replaced, cleared), so a caller can
 *   undo what it booked for it (the kill-confirm pairing must never pair with a confirm nobody heard).
 */
export class Announcer {
  constructor(now, log = () => {}) { this.now = now; this.log = log; this.current = null; this.queue = []; this.seq = 0; this.gun = null; this.sync = null; }

  clear() { const q = this.queue; this.current = null; this.queue = []; q.forEach(x => this._dropped(x)); }


  /** True while the item on air is still sounding (the gun as a whole: `gun.outstanding`, the GunAudio model). */
  audioBusy(now = this.now()) { return !!this.current && now < this.current.audioUntil; }

  /** The current item or a queued one that matches. */
  find(pred) { if (this.current && pred(this.current)) return this.current; return this.queue.find(pred) || null; }

  /** Drop a queued item (not the playing one). */
  remove(item) { const i = this.queue.indexOf(item); if (i >= 0) this.queue.splice(i, 1); return i >= 0; }
  _dropped(item) { try { if (item.onDrop) item.onDrop(); } catch (_) { /* a caller's undo must not break the queue */ } }
  /** True when a must-hear line (my kill confirm, a lead change) is waiting. */
  mustHearQueued() { return this.queue.some(q => MUST_HEAR.has(q.kind)); }
  /** Change a WAITING item's sound length (a line added to it before it plays). */
  retime(item, audioMs) {
    if (!item || item === this.current) return;
    item.audioMs = Math.max(0, audioMs);
    item.slotMs = Math.max(item.audioMs ? item.audioMs + ANNOUNCE_GAP_MS : 0, item.bannerMs != null ? item.bannerMs : (ANNOUNCE_BANNER_MS[item.kind] || 0));
  }
  /** True when an item of higher priority than `r` is waiting. */
  _higherQueued(r) { return this.queue.some(q => q.rank < r); }

  /** Hold the playing item's slot at least until `until` (a banner updated in place, e.g. MC naming an IR kill). */
  extend(item, until) { if (item && item === this.current) item.until = Math.max(item.until, until); }

  /** Release the playing item as soon as its audio is over (its banner is about to be replaced in place). */
  release(item) { if (item && item === this.current) item.until = Math.max(this.now(), item.audioUntil); }

  push(item) {
    const now = this.now();
    if (this.sync) this.sync(now);   // the gun model's state as it stands now (the shield loop may have just started)
    const it = { ...item, at: now, n: ++this.seq, rank: rank(item.kind), audioMs: Math.max(0, item.audioMs || 0) };
    it.slotMs = Math.max(it.audioMs ? it.audioMs + ANNOUNCE_GAP_MS : 0, item.bannerMs != null ? item.bannerMs : (ANNOUNCE_BANNER_MS[item.kind] || 0));
    if (it.key != null) {
      const cur = this.current;
      if (cur && cur.key === it.key && now < cur.until) {
        if (cur.kind === it.kind && !it.preemptKey) {
          // The state on air is true again, so any other state of this key still waiting is false: drop it too (a queued
          // `lead_lost` behind a `lead_taken` that is true again would otherwise wait forever, TTL Infinity).
          this.queue = this.queue.filter(q => { if (q.key !== it.key) return true; this._dropped(q); this.log(`announcer: ${q.kind} dropped: ${it.kind} is true again`); return false; });
          this.log(`announcer: ${it.kind} is already playing, duplicate dropped`); return null;
        }
        // The hill rule: the newest word about the point takes over the hill line on air, but never jumps a
        // higher-priority item that is waiting (a flapping hill must not starve a kill confirm or a lead change).
        // A preempt that does not stop the line it replaces (the pool lines) may only start on a silent gun (P1).
        if (it.preemptKey && !this._higherQueued(it.rank) && !(this.gun && this.gun.blocked)
          && (it.stopsOwn || !this.gun || this.gun.outstanding(now) === 0)) {
          this.queue = this.queue.filter(q => { if (q.key !== it.key) return true; this._dropped(q); return false; });
          this._start(it, now, now < cur.audioUntil); return it;
        }
      }
      const i = this.queue.findIndex(q => q.key === it.key);
      if (i >= 0) {
        if (this.queue[i].kind === it.kind) { this.log(`announcer: ${it.kind} already queued, duplicate dropped`); return null; }
        this.log(`announcer: ${this.queue[i].kind} replaced by the newer ${it.kind} before it played`);
        this._dropped(this.queue.splice(i, 1)[0]);
      }
    }
    // The one pre-emption: my own kill confirm takes over a SILENT lower item at once (its card only; there is no
    // sound to stop, so no `$PLAYX`). The card it displaces goes back in the queue and shows again after the kill
    // (a swap card must not be lost). A lower item that is still sounding is never cut: the kill waits for it.
    const cur = this.current;
    if (cur && now < cur.until && it.kind === 'kill_confirmed' && it.rank < cur.rank && !cur.audioMs) {
      this.log(`announcer: kill confirm takes over the silent ${cur.kind} card; the card shows again after it`);
      this.queue.push(cur);
      this._start(it, now, false);
      return it;
    }
    this.queue.push(it);
    this.tick(now);
    return it;
  }

  /** Start the next item when the slot is free. Returns the item started, or null. */
  tick(now = this.now()) {
    if (this.sync) this.sync(now);
    const cur = this.current;
    // Round 3 M4: never flush over my own kill. A must-hear item waits while the kill on air still has a clip on the gun.
    if (cur && OWN_KILL.has(cur.kind) && this.gun && this.gun.playingUntil(now) > now) {
      const nx = this._peek(now);
      if (nx && MUST_HEAR.has(nx.kind)) return null;
    }
    if (cur) {
      // Same-surface handover: once a line has finished, an item of EQUAL or higher priority may replace its card in
      // place. Never a kill confirm's card (it holds its full slot, and `extend` lengthens it), never a silent card.
      const next = this._peek(now);
      const handover = next && cur.audioMs > 0 && now >= cur.audioUntil && !OWN_KILL.has(cur.kind) && next.rank <= cur.rank
        && ANNOUNCE_SURFACE[next.kind] && ANNOUNCE_SURFACE[next.kind] === ANNOUNCE_SURFACE[cur.kind];
      if (now < cur.until && !handover) return null;
      this.current = null;
    }
    const next = this._peek(now);
    if (!next) return null;
    // P1: a line that is not must-hear never goes to a gun that still holds a clip (one outstanding at most): it waits,
    // and once it is past ANNOUNCE_AUDIO_LATE_MS (or the shield loop blocks the gun) it shows its card without its line.
    // An OBJECTIVE line is the exception to the loop: it cuts the loop instead (`flush`), so a hill word or "Target down"
    // is still heard with the shield up.
    if (next.audioMs > 0 && !MUST_HEAR.has(next.kind) && this.gun && this.gun.outstanding(now) > 0) {
      const late = ANNOUNCE_AUDIO_LATE_MS[next.kind] != null ? ANNOUNCE_AUDIO_LATE_MS[next.kind] : ANNOUNCE_AUDIO_LATE_DEFAULT_MS;
      if (this.gun.blocked && OBJECTIVE.has(next.kind) && now - next.at <= late) next.flush = true;
      else {
        if (!this.gun.blocked && now - next.at <= late) return null;
        next.forceMute = true;
      }
    }
    this.remove(next);
    this._start(next, now, false);
    return next;
  }

  /** The best live item, with every stale or refused item dropped on the way. */
  _peek(now) {
    for (;;) {
      if (!this.queue.length) return null;
      let best = null;
      for (const q of this.queue) if (!best || q.rank < best.rank || (q.rank === best.rank && q.n < best.n)) best = q;
      const ttl = ANNOUNCE_TTL_MS[best.kind] != null ? ANNOUNCE_TTL_MS[best.kind] : 4000;
      if (now - best.at > ttl) { this.remove(best); this._dropped(best); this.log(`announcer: ${best.kind} expired after ${now - best.at} ms in the queue, dropped`); continue; }
      if (best.ok && !best.ok()) { this.remove(best); this._dropped(best); this.log(`announcer: ${best.kind} no longer applies, dropped`); continue; }
      return best;
    }
  }

  _start(it, now, preempted) {
    const waited = now - it.at;
    const late = ANNOUNCE_AUDIO_LATE_MS[it.kind] != null ? ANNOUNCE_AUDIO_LATE_MS[it.kind] : ANNOUNCE_AUDIO_LATE_DEFAULT_MS;
    const muted = it.audioMs > 0 && (waited > late || !!it.forceMute);
    if (muted) {   // too late to be worth hearing: the card (if any) still shows, silently, for its own hold
      this.log(it.forceMute && waited <= late ? `announcer: ${it.kind}: the gun's audio is blocked (the shield loop), shown without its line`
        : `announcer: ${it.kind} would start ${waited} ms after its event, past ${late} ms: shown without its line`);
      it.audioMs = 0;
      it.slotMs = it.bannerMs != null ? it.bannerMs : (ANNOUNCE_BANNER_MS[it.kind] || 0);
    }
    it.startedAt = now; it.audioUntil = now + it.audioMs; it.until = now + it.slotMs; it.muted = muted;
    this.current = it;
    it.play({ preempted, waited, muted, flush: !muted && !!it.flush }, it);
  }

  /** For `state()`: what is on air, and how many wait behind it. */
  view(now = this.now()) {
    const c = this.current && now < this.current.until ? this.current : null;
    return c || this.queue.length ? { kind: c ? c.kind : null, at: c ? c.startedAt : null, ms: c ? c.slotMs : 0, queued: this.queue.map(q => q.kind) } : null;
  }
}

/**
 * The phone's ONE model of the gun's audio (docs/announcer.md, "The gun's audio FIFO"). Bench 2026-09-24 (brx2,
 * Tactix-FE30): the gun QUEUES clips first in, first out; `$PLAYX,0,*` stops only the clip playing, so N stops flush N
 * clips; and a `$PSET` t23 `energyShieldLoop` plays for as long as the shield is above 0, blocking the FIFO
 * indefinitely (a queued line never plays until the loop stops), and it RESUMES on its own after a `$PLAYX,0`.
 *
 * Every sound-bearing write the phone makes (and every sound the gun makes on its own that the phone can see: a hit's
 * `$SIR` row sound, the native death scream) goes in with its length, so "the gun's FIFO holds these clips until T"
 * is one question with one answer. It over-counts rather than under-counts: an extra stop is harmless, a missing one
 * leaves a must-hear line late.
 */
export class GunAudio {
  constructor(log = () => {}) { this.log = log; this.clips = []; this.blocked = false; this.blockedAt = 0; }
  clear() { this.clips = []; }
  /** One clip entered the FIFO at `now`. While the loop blocks, it is stuck (it never ends by itself). */
  add(ms, why, now, id = null) {
    if (!(ms > 0)) return;
    this._prune(now);
    // Round 3 H1: while the loop blocks, one pending clip per sound id. Twenty hits under a shield are one hit sound
    // waiting, not twenty (the gun's own FIFO behaviour there is unmeasured; this keeps the stops and the replay bounded).
    if (this.blocked && id && this.clips.some(c => c.id === id && c.start === Infinity)) return;
    const tail = this.clips.length ? this.clips[this.clips.length - 1].end : now;
    const start = this.blocked ? Infinity : Math.max(now, tail);
    this.clips.push({ ms, why, start, end: start + ms, id });
  }
  /** When the last clip the gun can actually play ends (clips stuck behind the loop do not count). */
  playingUntil(now) { this._prune(now); return this.clips.reduce((t, c) => (Number.isFinite(c.end) ? Math.max(t, c.end) : t), now); }
  /** The shield loop started (shield rose above 0 with a loop armed) or stopped (shield back at 0). */
  setBlocked(on, now) {
    if (on === this.blocked) return;
    this._prune(now);
    if (on) {   // everything not finished by now is stuck behind the loop, with what is left of it
      for (const c of this.clips) { c.left = c.end - Math.max(c.start, now); c.start = c.end = Infinity; }
    } else {    // the FIFO runs again from now, in order
      let t = now;
      for (const c of this.clips) { const ms = c.left != null ? c.left : c.ms; c.start = t; c.end = t + ms; t = c.end; delete c.left; }
    }
    this.blocked = on; this.blockedAt = now;
  }
  /** Clips playing or waiting on the gun, plus the loop itself while it blocks. */
  outstanding(now) { this._prune(now); return this.clips.length + (this.blocked ? 1 : 0); }
  /** When the gun would next be silent (Infinity while the loop blocks). */
  freeAt(now) { this._prune(now); return this.blocked ? Infinity : (this.clips.length ? this.clips[this.clips.length - 1].end : now); }
  /** `k` stops went out: every clip is gone. A loop that blocked resumes by itself (bench 2026-09-24), after the line
   *  written right behind the stops: that line plays, and anything after it is stuck again. */
  flushed(now, line) {
    this.clips = [];
    if (line) this.clips.push({ ms: line.ms, why: line.why, start: now, end: now + line.ms });
  }
  _prune(now) { this.clips = this.clips.filter(c => c.end > now); }
}
