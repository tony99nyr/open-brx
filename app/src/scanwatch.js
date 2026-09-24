// The beacon watch: the BLE scan a HUD phone keeps open to hear utility stations (respawn stations and
// control points, beacon.js). app.js cannot be imported in a test, so the scan policy lives here.
//
// Playtest 2026-09-13 (Pixel 5): the old loop in app.js ran 8 stops and 8 starts a second. Each 1 s tick
// that found the restart period overdue started another stop+start, because the "last restart" stamp was
// written only AFTER the slow Capacitor bridge answered. The overlapping stops also cleared BrxLink's
// "scan open" flag under a newer scan. The plugin queues every call (gun writes too) behind those scan
// calls, so the WebView starved: late redraws, a stuck kill flash, and slow gun writes.
//
// The rules here:
//  - one scan operation at a time (`busy`); a tick that finds one running does nothing;
//  - the restart stamp is written BEFORE the first await;
//  - the scan is open only while something reads it: phase armed or live AND the game has stations on
//    the field (`stationsInPlay`), and never while the gun picker owns the radio.
//
// Bench 2026-09-16/17 (Pixel 5, a TDM with timed respawn and no stations): the Capacitor BLE plugin sends
// every scan result to JS over the same native-to-JS channel as gun notifications and call replies. The
// watch delivered about 57 results a second, the main thread skipped ~600 frames every 10 s, and plugin
// replies came back seconds late. The plugin cannot filter our adverts natively: a station's whole
// identity is ONE 128-bit service UUID whose low bytes change with its state, the plugin's `services`
// filter matches a UUID exactly (no mask), and the advert has no name and no manufacturer data. So:
//  - no scan at all in a game without stations (most games);
//  - JS drops a device's adverts that arrive faster than PRESENCE_SAMPLE_MS, before any decode;
//  - a guard counts raw results a second and backs the scan off when a crowded field floods the bridge.
//
// Kept from the old loop: Android silently stalls a scan left running (hardware 2026-09-04), so the scan
// restarts on a period, fast while a scanner-respawn player is down. It uses scanMode 2 (low latency),
// because Android throttled a balanced scan so hard that presence froze on hardware (2026-09-04).

export const RESCAN_DOWN_MS = 7000;    // a DOWN scanner-respawn player needs the station now (Android caps ~5 starts/30 s)
export const RESCAN_IDLE_MS = 90000;   // otherwise a slow restart only guards against Android's silent scan stall

/**
 * True when this game has utility stations on the field, so a phone must hear station adverts (and a
 * station must hear player adverts). The engine reads stations in exactly two places: the scanner
 * respawn (`respawn.type === "scanner"`, `_respawnStation`) and the phone control point
 * (`station_source === "phone"`, `_controlStation`). `config.stations` is the allow-list MC adds when it
 * armed any station (contracts A13.1), so an armed station of another kind also counts. A grenade hill
 * (`station_source: "grenade"`) arrives over IR through the gun, not over BLE.
 */
export function stationsInPlay(config) {
  if (!config) return false;
  if (config.respawn && config.respawn.type === 'scanner') return true;
  if (config.station_source === 'phone') return true;
  return Array.isArray(config.stations) && config.stations.length > 0;
}

/** True when a match-time reader needs station adverts: phase armed or live, in a game with stations. */
export function beaconNeeded(st, config) { return !!st && (st.phase === 'armed' || st.phase === 'live') && stationsInPlay(config); }

/**
 * F342 (field 2026-09-24, Pixel 5): True when a player who is ALIVE reads station adverts: a phone control point
 * (`station_source: 'phone'`) or an armed station of any kind but `respawn` (a powerup, a control point). The respawn
 * station is read only by a DOWN scanner-respawn player (`_respawnStation`: the revive, the hint, the presence gate).
 * The field logged 60 results/s at arm time and 78 results/s at the lowest scan mode, from station and player adverts,
 * all of it crossing the bridge the gun writes answer on, during the T-3 hit table and the T-0 spawn burst. So in a
 * respawn-only station game the scan is open only while the player is down.
 */
export function aliveNeedsBeacon(config) {
  if (!config) return false;
  if (config.station_source === 'phone') return true;
  // A legacy id-only entry (no kind) could be anything, so it counts as read while alive.
  return Array.isArray(config.stations) && config.stations.some(x => !(x && typeof x === 'object' && x.kind === 'respawn'));
}

// Presence (beacon.js) is read every 250 ms (app.js presenceTick → engine.setStations), its dwell is
// 0.8 s and its expiry 4 s. One sample per device per 250 ms is 4 a second: 3 samples inside the dwell
// and 16 inside the expiry. A faster sample only moves the EMA between two reads nobody makes.
export const PRESENCE_SAMPLE_MS = 250;

// The flood guard. The bench flood was ~57 results/s. A station game that needs the scan carries, near
// the stations, up to ~10/s per station advertising at low latency plus ~4/s per player phone
// advertising at balanced: two stations and a few players is ~25/s. Above that the extra results are
// other devices, and the gun link matters more than hearing them. The rate is judged over a 2 s window
// so one burst does not trip it.
export const SCAN_BUDGET_PER_S = 25;
export const GUARD_WINDOW_MS = 2000;
export const GUARD_PAUSE_MS = 5000;    // closed this long before the reopen (also keeps us under Android's ~5 starts/30 s)
export const GUARD_HOLD_MS = 60000;    // stay in the lower mode this long, then try one mode higher
// Android scan modes, highest duty cycle first: 2 low latency (always on), 1 balanced (~25 %),
// 0 low power (~10 %). A DOWN scanner-respawn player never drops below balanced: a low-power scan
// hears a station about every 5 s, past the 4 s expiry, so the station would flicker off.
export const SCAN_MODES = [2, 1, 0];

/**
 * The utility station's scan (utility.js) under the same guard. A station must hear player adverts to
 * count who stands on it, so it drops only to balanced, never to low power, and it restarts no more
 * often than its own S6 refresh already does: the lower mode takes effect by forcing that refresh now.
 * Returns the mode index for the next start and whether to restart now.
 */
export function stationScanStep({ over, idx, since, now }) {
  if (over && idx < 1) return { idx: 1, since: now, restart: true, tripped: true };
  if (!over && idx > 0 && now - since >= GUARD_HOLD_MS) return { idx: 0, since: now, restart: true, tripped: false };
  return { idx, since, restart: false, tripped: false };
}

/**
 * Counts raw scan results against a budget. `hit(now)` for every result that crosses the bridge;
 * `check(now)` once a tick returns the rate over the last full window, and `over` when it broke the
 * budget. Pure, so the rate logic is tested without a radio.
 */
export class ScanGuard {
  constructor({ budget = SCAN_BUDGET_PER_S, windowMs = GUARD_WINDOW_MS } = {}) {
    this.budget = budget; this.windowMs = windowMs;
    this.count = 0; this.total = 0; this.windowStart = null; this.rate = 0; this.peak = 0;
  }
  reset(now) { this.count = 0; this.windowStart = now; }
  hit(now) { this.count++; this.total++; if (this.windowStart == null) this.windowStart = now; }
  check(now) {
    if (this.windowStart == null) { this.windowStart = now; return { rate: this.rate, over: false }; }
    const span = now - this.windowStart;
    if (span < this.windowMs * 0.9) return { rate: this.rate, over: false };   // a 1 s setInterval jitters: accept a window a tick short
    this.rate = Math.round(this.count * 1000 / span);
    this.peak = Math.max(this.peak, this.rate);
    this.reset(now);
    return { rate: this.rate, over: this.rate > this.budget };
  }
}

export class BeaconWatch {
  constructor({ link, onHit = () => {}, log = () => {}, now = () => Date.now(), native = () => true, guard = new ScanGuard() } = {}) {
    this.link = link; this.onHit = onHit; this.log = log; this.now = now; this.native = native;
    this.open = false;        // our scan is open (as far as the last completed operation knows)
    this.busy = false;        // a start/stop/restart is in flight
    this.lastRestart = 0;     // stamped BEFORE any await, so a slow bridge can never make the next tick overdue
    this.lastAlive = true;
    this.hits = 0;            // adverts seen: a cheap debug count, never logged per advert
    this.passed = 0;          // adverts handed to onHit after the per-device sample gate
    this.guard = guard;
    this.modeIdx = 0;         // index into SCAN_MODES for the next start
    this.pausedUntil = 0;     // the guard closed the scan; do not reopen before this
    this.modeSince = 0;       // when the guard last lowered the mode
    this.backoffs = 0;        // guard trips since the app started
    this._floorWarned = false;
    this._lastSample = new Map();   // deviceId → when its last sample reached onHit
    this._chain = Promise.resolve();
  }

  /** For the diagnostic bundle: cheap, no per-advert work. */
  stats() {
    return { open: this.open, scanMode: SCAN_MODES[this.modeIdx], rate: this.guard.rate, peak: this.guard.peak,
      budget: this.guard.budget, results: this.guard.total, passed: this.passed, backoffs: this.backoffs,
      paused: this.pausedUntil > this.now() };
  }

  /** Every scan result BrxLink hands us. Counted first; then at most one sample per device per PRESENCE_SAMPLE_MS. */
  _onResult(hit) {
    const now = this.now();
    this.hits++;   // the raw count (the guard's) is taken in BrxLink, before its name/UUID filter
    if (!hit.uuids || !hit.uuids.length) return;
    const last = this._lastSample.get(hit.deviceId);
    if (last != null && now - last < PRESENCE_SAMPLE_MS) return;
    this._lastSample.set(hit.deviceId, now);
    this.passed++;
    this.onHit(hit);
  }

  /** Run one scan operation after any in-flight one. Tick-driven callers skip when busy instead. */
  _serial(fn) {
    const run = async () => { this.busy = true; try { return await fn(); } finally { this.busy = false; } };
    const p = this._chain.then(run, run);
    this._chain = p.catch(() => {});
    return p;
  }

  async _start() {
    if (this.open || !this.native()) return;
    this.lastRestart = this.now();
    try {
      this.guard.reset(this.now()); this._lastSample.clear();
      await this.link.scan(hit => this._onResult(hit), { scanMode: SCAN_MODES[this.modeIdx], onRaw: () => this.guard.hit(this.now()) });
      this.open = true;
    } catch (e) { this.open = false; this.log('beacon scan: ' + (e && e.message || e), 'li'); }
  }
  async _stop() {
    if (!this.open) return;
    this.open = false;
    await this.link.stopScan();
  }

  /** The gun picker takes the radio: close the beacon scan, after any operation already in flight. */
  release() { return this._serial(() => this._stop()); }

  /**
   * One policy step, called about once a second. `pickerOpen`: the gun picker or the rejoin scan owns
   * the radio. `config`: the game config (engine.config), which says whether stations are in play.
   * Returns the operation it started, or null.
   */
  tick(st, { pickerOpen = false, config = null } = {}) {
    const down = !!st && st.phase === 'live' && !st.alive && st.respawnType === 'scanner';
    const wanted = beaconNeeded(st, config) && (down || aliveNeedsBeacon(config)) && !pickerOpen && this.native();
    const justDied = this.lastAlive && down;
    if (this.busy) return null;   // before the alive edge is consumed, so a death during a restart still kicks one
    this.lastAlive = !st || st.alive !== false;
    const now = this.now();
    if (!wanted) {
      // The next GAME starts at full rate. A gun picker or a reconnect inside the same match does not: F342 (field
      // 2026-09-24, Pixel 5) reset the mode on every gun reconnect, so the scan reopened at low latency and flooded
      // again (26 results/s) while the reconcile re-armed the gun. The field the guard measured is still the same.
      if (!beaconNeeded(st, config)) { this.modeIdx = 0; this.pausedUntil = 0; this._floorWarned = false; }
      if (this.open && !pickerOpen) return this._serial(() => this._stop());
      return null;
    }
    if (justDied && !aliveNeedsBeacon(config)) this.modeIdx = 0;   // F342: a respawn-only game scans per death; each opens at full rate
    const floor = down ? 1 : SCAN_MODES.length - 1;   // a down player hunting a station never drops to low power
    if (this.modeIdx > floor) this.modeIdx = floor;   // takes effect on the death kick below
    if (!this.open) {
      if (now < this.pausedUntil && !justDied) return null;
      // A start that failed (Android refuses an app that starts scans too often) retries on the down
      // cadence, not every tick: a retry per second is exactly what keeps the app throttled.
      if (this.lastRestart && now - this.lastRestart < RESCAN_DOWN_MS && !justDied && !(this.pausedUntil && now >= this.pausedUntil)) return null;
      this.pausedUntil = 0;
      return this._serial(() => this._start());
    }
    const { rate, over } = this.guard.check(now);
    if (over && this.modeIdx < floor) {
      // A crowded field: close, wait, reopen one mode lower. Logged per trip, and a trip is at most one
      // per GUARD_WINDOW_MS + GUARD_PAUSE_MS, so the log cannot flood either.
      this.backoffs++;
      const next = this.modeIdx + 1;
      this.log(`ble scan flood: ${rate} results/s (budget ${this.guard.budget}); scan closed ${GUARD_PAUSE_MS / 1000} s, reopening at scanMode ${SCAN_MODES[next]}`, 'le');
      this.modeIdx = next; this.modeSince = now;
      this.pausedUntil = now + (down ? 0 : GUARD_PAUSE_MS);
      this.lastRestart = now;
      return this._serial(() => this._stop());
    }
    if (over && !this._floorWarned) {
      this._floorWarned = true;
      this.log(`ble scan flood: ${rate} results/s at the lowest scan mode allowed now (scanMode ${SCAN_MODES[this.modeIdx]}); the bridge still carries them`, 'le');
    }
    if (this.modeIdx > 0 && !over && now - this.modeSince >= GUARD_HOLD_MS) {
      // Quiet for a while at a lower mode: try one mode higher on the next restart.
      this.modeIdx--; this.modeSince = now; this._floorWarned = false;
      this.lastRestart = now;
      return this._serial(async () => { await this._stop(); await this._start(); });
    }
    const period = down ? RESCAN_DOWN_MS : RESCAN_IDLE_MS;
    if (justDied || now - this.lastRestart >= period) {
      this.lastRestart = now;   // stamp now, not when the bridge answers
      return this._serial(async () => { await this._stop(); await this._start(); });
    }
    return null;
  }
}
