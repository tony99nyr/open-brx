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
//  - the scan is open only while something reads it: phase armed or live (the respawn hint and the
//    control point are both match-time readers), and never while the gun picker owns the radio.
//
// Kept from the old loop: Android silently stalls a scan left running (hardware 2026-09-04), so the scan
// restarts on a period, fast while a scanner-respawn player is down. It uses scanMode 2 (low latency),
// because Android throttled a balanced scan so hard that presence froze on hardware (2026-09-04).

export const RESCAN_DOWN_MS = 7000;    // a DOWN scanner-respawn player needs the station now (Android caps ~5 starts/30 s)
export const RESCAN_IDLE_MS = 90000;   // otherwise a slow restart only guards against Android's silent scan stall

/** True when a match-time reader needs station adverts: the respawn station hint and the control point. */
export function beaconNeeded(st) { return !!st && (st.phase === 'armed' || st.phase === 'live'); }

export class BeaconWatch {
  constructor({ link, onHit = () => {}, log = () => {}, now = () => Date.now(), native = () => true } = {}) {
    this.link = link; this.onHit = onHit; this.log = log; this.now = now; this.native = native;
    this.open = false;        // our scan is open (as far as the last completed operation knows)
    this.busy = false;        // a start/stop/restart is in flight
    this.lastRestart = 0;     // stamped BEFORE any await, so a slow bridge can never make the next tick overdue
    this.lastAlive = true;
    this.hits = 0;            // adverts seen: a cheap debug count, never logged per advert
    this._chain = Promise.resolve();
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
      await this.link.scan(hit => { this.hits++; if (hit.uuids && hit.uuids.length) this.onHit(hit); }, { scanMode: 2 });
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
   * the radio. Returns the operation it started, or null.
   */
  tick(st, { pickerOpen = false } = {}) {
    const wanted = beaconNeeded(st) && !pickerOpen && this.native();
    const down = !!st && st.phase === 'live' && !st.alive && st.respawnType === 'scanner';
    const justDied = this.lastAlive && down;
    if (this.busy) return null;   // before the alive edge is consumed, so a death during a restart still kicks one
    this.lastAlive = !st || st.alive !== false;
    const now = this.now();
    if (!wanted) {
      if (this.open && !pickerOpen) return this._serial(() => this._stop());
      return null;
    }
    if (!this.open) {
      // A start that failed (Android refuses an app that starts scans too often) retries on the down
      // cadence, not every tick: a retry per second is exactly what keeps the app throttled.
      if (this.lastRestart && now - this.lastRestart < RESCAN_DOWN_MS) return null;
      return this._serial(() => this._start());
    }
    const period = down ? RESCAN_DOWN_MS : RESCAN_IDLE_MS;
    if (justDied || now - this.lastRestart >= period) {
      this.lastRestart = now;   // stamp now, not when the bridge answers
      return this._serial(async () => { await this._stop(); await this._start(); });
    }
    return null;
  }
}
