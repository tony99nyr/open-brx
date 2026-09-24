// BrxLink — the seed's hardware-proven BLE plumbing (node.md §7), behind a thin interface.
// Init exactly once; connect-with-retry (bounded on the first connect, then FOREVER with backoff in
// every phase, retired by a generation token); continuous
// low-latency scan picker; hardened reassembler; 20-byte chunked writes with pacing; per-device
// write queue; auto-reconnect that hands the engine a resync opportunity.
import { BleClient, BluetoothLe, textToDataView, dataViewToText, dataViewToHexString } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

export const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Bench 2026-09-17 (match 592e444eff, Pixel 5): the spawn write left the phone over 62 s, one chunk every
// 6-11 s, and the player could not shoot for a minute. Android logcat showed each native write done in
// 1-2 ms, and the JS ring stamped each chunk within 40 ms of its native call. The delay was the ANSWER:
// the plugin's reply reached JS 1 s late at T-10 and 11 s late by T+100 s, on the same native-to-JS
// channel as the low-latency beacon scan (57 results/s, the busiest scan of the day). The app skipped
// about 600 frames every 10 s until the scan restart dropped the backlog.
//  - BleClient's own queue made every call wait for the previous call's answer, so a slow answer to a
//    scan stop or an isEnabled() also held the gun write. Gun writes now call the plugin directly: the
//    bridge delivers calls in call order, and the native side runs them in that order.
//  - The write loop waits for an answer for at most WRITE_ACK_CAP_MS, then goes on at the normal pacing.
//    A healthy answer still holds the next chunk, so the GATT write permit is kept as before.
export const WRITE_ACK_CAP_MS = 50;
/** How many times one batch sends again from a frame a late chunk error hit, before it reports failure. */
export const LATE_RESENDS = 2;

/** Writes one chunk to the gun's NUS RX characteristic through the plugin itself, not BleClient's queue.
 *  Native builds take a hex string (what BleClient sends); the web build takes the DataView.
 *  `response: true` calls the plugin's `write` (with-response) instead of `writeWithoutResponse`; same
 *  deviceId/service/characteristic/value shape either way (F270, transport-hardening.md §5). */
export function directWriter(plugin = BluetoothLe, platform = () => Capacitor.getPlatform(), { response = false } = {}) {
  return (deviceId, dv) => {
    const opts = { deviceId, service: NUS, characteristic: RX, value: platform() === 'web' ? dv : dataViewToHexString(dv) };
    return response ? plugin.write(opts) : plugin.writeWithoutResponse(opts);
  };
}

// F210: docs/manual/dev.md's headset note — "the headset must be linked or the gun will connect,
// answer a quick $PING, then drop within seconds and echo nothing to config. After a gun-initiated
// $DISCONNECT,*, back off at least 5 s before reconnecting." A gun with no headset linked repeats
// this forever, and `_connectWithRetry`'s own backoff only grows on a FAILED `ble.connect()` call —
// a connect that SUCCEEDS and then drops seconds later never fails, so a single flap reconnects at
// once (as any ordinary drop should), but a REPEATING flap now backs off instead of spinning as fast
// as the hardware allows.
// Game day 2026-09-19 (p4/p5 phone logs): a gun whose headset link is bad resets its own radio about
// every 6 s ($RADSK), so the link held 4-8 s each time. With a 5 s window most of those drops did not
// count as quick, and the count was cleared 5 s after each connect, so the back-off never grew.
//  - FLAP_WINDOW_MS: a drop this soon after the connect is a flap.
//  - FLAP_HOLD_MS: the flap count clears only after the link has held this long.
//  - FLAP_BACKOFF_MS: the wait after the 2nd flap in a row.
//  - From the QUIET_AFTER-th flap in a row, the phone does not reconnect for QUIET_MS (the quiet
//    period). The HUD tells the player to power-cycle the headset. A manual connect ends it at once.
export const FLAP_WINDOW_MS = 20000;
export const FLAP_HOLD_MS = 30000;
export const FLAP_BACKOFF_MS = 5000;
export const QUIET_AFTER = 3;
export const QUIET_MS = 30000;
/** How long to wait after the `streak`th flap in a row (0 below streak 2). */
export function flapDelay(streak, backoffMs = FLAP_BACKOFF_MS, quietMs = QUIET_MS) {
  if (streak < 2) return 0;
  return streak >= QUIET_AFTER ? quietMs : backoffMs;
}

// Bench 2026-09-17 (match e6cbe0ae09): RELINK GUN in a LIVE match took the phone off the gun for 34 s. The
// phone log: the forced disconnect at once, then three plugin connects that each ran out the plugin's
// default 10 s timeout, with a growing retry backoff (443, 857, 1939 ms) between them, then a connect that
// took under a second. A relink now waits at most RELINK_DISCONNECT_CAP_MS for the disconnect, gives each
// connect RELINK_CONNECT_MS (a connect to a gun that is there took about 1 s on the bench), and waits only
// RELINK_GAP_MS between attempts. After RELINK_ATTEMPTS it ends, and the normal reconnect loop takes over.
// App 0.4.2, field 2026-09-19 (Pixel 5): the picker stopped its scan and connected at
// once. The phone log: "connecting to <gun>…" at 13:41:25, then "connect 1/5 failed after 345 ms
// (GATT_ERROR 133)", "connect 2/5 failed after 364 ms (133)", and the link at 13:41:29. Android often
// returns status 133 for a connect that starts right after a scan stops. The first connect after a
// scan stop now waits for the stop to complete, then this long. Reconnects do not wait.
export const SCAN_SETTLE_MS = 400;
const RELINK_DISCONNECT_CAP_MS = 2000;
const RELINK_CONNECT_MS = 5000;
const RELINK_GAP_MS = 250;
const RELINK_ATTEMPTS = 9;

// F293 (bench 2026-09-24, Pixel 5, Tactix-FE30): with the app open while the gun and headset power-cycle, the phone
// relinked 5-10 s after power-on, before the headset had joined the gun. The gun then dropped the phone every 6-10 s,
// and in one of two runs the headset never joined in over 60 s. With the app closed the headset joined in 15-16 s.
// So every connect (the first and every relink) is now a short PROBE before the link counts as up: the probe frames
// (`probeFrames()`, ending in `$VERSION,*`), then `$VERSION` token 2. `hds.N`: the link is up, with today's flap rules.
// `?` (or no reply in VERSION_REPLY_MS): the headset has not joined, so the app and engine are never told the gun is up.
//  - HEADSET_JOIN_MODE 'disconnect' (the default): release the link at once and try again after HEADSET_SETTLE_MS.
//    This is not a flap: no streak, no FLAP_BACKOFF_MS, no quiet period.
//  - 'hold' (for a bench A/B): keep the link and poll `$VERSION` every HEADSET_POLL_MS until `hds.N`. A drop while
//    it reads `?` is not a flap.
//  - HEADSET_JOIN_CAP_MS after the first `?`, the state is `not_joined` and the phone stops trying on its own. A manual
//    action (RECONNECT NOW, RELINK, picking the gun) tries at once and starts the cap again.
export const HEADSET_JOIN_MODE = 'disconnect';
export const HEADSET_SETTLE_MS = 15000;
export const HEADSET_POLL_MS = 2000;
export const HEADSET_JOIN_CAP_MS = 60000;
export const VERSION_REPLY_MS = 2000;
/** The engine's first-connect probe (engine.js PROBE_FW); the link's default when no `probeFrames` is given. */
const DEFAULT_PROBE = ['$STOP,*', '$PHONE,*', '$VERSION,*'];
/** `$VERSION` reply token 2 (docs/manual/dev.md): true for `hds.NN` (headset linked), false for `?` or empty,
 *  null when the frame is not a `$VERSION` reply (a bare echo of the query is not one). */
export function headsetLinked(frame) {
  if (!/^\$VERSION,/.test(frame || '')) return null;
  const t = String(frame).split(',');
  if (t.length < 4) return null;
  return /^hds\./i.test(t[2] || '');
}

/** Split an advert name "<sticker>-<tail>" → {name, basename, tail}. Never uses the BLE deviceId. */
export function splitAdvert(name, deviceId) {
  const m = /^(.*)-([0-9A-Fa-f]{4})$/.exec(name || '');
  if (m) return { name, basename: m[1], tail: m[2].toUpperCase() };
  const tail = String(deviceId || '').replace(/[^0-9a-fA-F]/g, '').slice(-4).toUpperCase() || '0000';
  return { name: name || 'Tactix', basename: name || 'Tactix', tail };
}

/** Hardened reassembler: splits on both '*' and '$' boundaries (merged notifies). */
export class Reassembler {
  constructor() { this.buf = ''; }
  pump(text) {
    this.buf += text; const out = [];
    for (;;) {
      const s = this.buf.indexOf('$');
      if (s < 0) { this.buf = ''; break; }
      if (s > 0) this.buf = this.buf.slice(s);
      const star = this.buf.indexOf('*', 1), nd = this.buf.indexOf('$', 1);
      let end;
      if (star >= 0 && (nd < 0 || star < nd)) end = star + 1;
      else if (nd >= 0) end = nd;
      else break;
      const f = this.buf.slice(0, end).trim(); this.buf = this.buf.slice(end);
      if (f) out.push(f);
    }
    return out;
  }
}

/** Write pacing (docs/spec/transport-hardening.md §3). The gun reads ONE serial byte per main-loop pass out of a
 *  1 KB UART buffer (V4_30/V4_31 disassembly, 2026-09-18), so a long burst can outrun it and a lost `*` corrupts
 *  the next frame. `chunkGapMs`/`frameGapMs` are the pacing the field has run on since 2026-08; the BLOCK pause
 *  is a lever for the screamers sheet A7/A8: after every `blockFrames` frames of one write, sleep `blockPauseMs`. It ships OFF
 *  (blockFrames = 0): the evidence for a value is not measured yet, and a slower arm is a real cost at the line.
 *
 *  F270 (transport-hardening.md §5): `responseForMultiPacket` ships OFF. Every write today is
 *  `writeWithoutResponse`, so a lost packet is invisible; the lever writes the chunks of a frame that
 *  spans more than one 20-byte packet WITH response instead (single-packet frames are unaffected). Worth
 *  it only if bench A8 shows frames going missing at the current pacing: a response write costs about one
 *  connection interval per packet (30-50 ms), so a 6-packet `$WEAP` goes from about 48 ms to about 250 ms
 *  and a full arm from about 1.2 s to about 2.5 s. Scoping note: the spec asks for head-and-spawn only (a
 *  revive is on a waiting player's critical path), but `write()`'s callers (engine.js, out of scope for
 *  this change) never pass an option that tells this link a burst is head/spawn versus revive -- both go
 *  through `_write(frames, why)` with no `options` at all. So today the flag, when on, applies to EVERY
 *  multi-packet frame; the head/spawn-only scoping needs an engine.js call-site change to pass that
 *  distinction through `options`, which is future work, not done here. */
export const WRITE_PACING = Object.freeze({ chunkGapMs: 8, frameGapMs: 18, blockFrames: 0, blockPauseMs: 0, responseForMultiPacket: false });

export class BrxLink {
  constructor({ ble = BleClient, log = () => {}, onFrame = () => {}, onDrop = () => {}, onUp = () => {},
                unbounded = () => false, chunkGapMs = WRITE_PACING.chunkGapMs, frameGapMs = WRITE_PACING.frameGapMs,
                blockFrames = WRITE_PACING.blockFrames, blockPauseMs = WRITE_PACING.blockPauseMs,
                responseForMultiPacket = WRITE_PACING.responseForMultiPacket,
                now = () => Date.now(), flapWindowMs = FLAP_WINDOW_MS, flapHoldMs = FLAP_HOLD_MS,
                flapBackoffMs = FLAP_BACKOFF_MS, quietMs = QUIET_MS,
                onFlap = () => {}, onRelink = () => {}, relinkConnectMs = RELINK_CONNECT_MS, relinkAttempts = RELINK_ATTEMPTS,
                relinkGapMs = RELINK_GAP_MS, relinkDisconnectCapMs = RELINK_DISCONNECT_CAP_MS,
                writeChunk = null, writeChunkResponse = null, ackCapMs = WRITE_ACK_CAP_MS, scanSettleMs = SCAN_SETTLE_MS,
                headsetProbe = ble === BleClient, probeFrames = () => DEFAULT_PROBE, onHeadset = () => {},
                headsetJoinMode = HEADSET_JOIN_MODE, headsetSettleMs = HEADSET_SETTLE_MS, headsetPollMs = HEADSET_POLL_MS,
                headsetJoinCapMs = HEADSET_JOIN_CAP_MS, versionReplyMs = VERSION_REPLY_MS } = {}) {
    // F293: the real plugin probes every connect; an injected test double opts in (the older link tests have no gun reply).
    this.headsetProbe = headsetProbe; this.probeFrames = probeFrames; this.onHeadset = onHeadset;
    this.headsetJoinMode = headsetJoinMode; this.headsetSettleMs = headsetSettleMs; this.headsetPollMs = headsetPollMs;
    this.headsetJoinCapMs = headsetJoinCapMs; this.versionReplyMs = versionReplyMs;
    this._hs = null;       // F293: 'joining' | 'not_joined' | 'joined' | null (never probed)
    this._hsAt = 0;        // when `_hs` last changed
    this._hsSince = 0;     // the cap clock: the first `?` of this cycle (0 when none)
    // Polish 2026-09-24 (M1): both are tagged with the attempt's link `seq`, so a stale probe from an older `_gen`
    // can never clear them under a newer probe.
    this._probing = 0;     // the `seq` of the attempt whose probe owns the link (0: none). Frames are noted, not given to the engine
    this._versionWait = null;   // {seq, done} of the `$VERSION` read in flight
    this._atts = new Set();     // the attempts whose probe runs; a `_gen` change wakes them
    this._attemptId = null;     // the device the newest connect attempt dials
    this.scanSettleMs = scanSettleMs;
    this._scanStoppedAt = 0;   // when a scan stop last completed; the next connect() settles after it, once
    this._connecting = 0;      // native connect attempts in flight (no scan may start meanwhile)
    // The real plugin gets the direct path; an injected test double keeps its own writeWithoutResponse.
    this.writeChunk = writeChunk || (ble === BleClient ? directWriter() : (id, dv) => ble.writeWithoutResponse(id, NUS, RX, dv));
    // F270: the with-response twin, used only for a multi-packet frame's chunks while `responseForMultiPacket`
    // is on (WRITE_PACING / transport-hardening.md §5). Same injection shape as `writeChunk` above.
    this.writeChunkResponse = writeChunkResponse || (ble === BleClient ? directWriter(BluetoothLe, undefined, { response: true }) : (id, dv) => ble.write(id, NUS, RX, dv));
    this.responseForMultiPacket = responseForMultiPacket;
    this.ackCapMs = ackCapMs;
    this.lateAcks = 0;     // chunks whose answer took longer than ackCapMs (diagnostics)
    this.onRelink = onRelink;
    this.relinkConnectMs = relinkConnectMs; this.relinkAttempts = relinkAttempts; this.relinkGapMs = relinkGapMs; this.relinkDisconnectCapMs = relinkDisconnectCapMs;
    this.ble = ble; this.log = log; this.onFrame = onFrame; this.onDrop = onDrop; this.onUp = onUp; this.onFlap = onFlap;
    this.unbounded = unbounded; this.chunkGapMs = chunkGapMs; this.frameGapMs = frameGapMs;
    this.blockFrames = blockFrames; this.blockPauseMs = blockPauseMs;
    this.now = now; this.flapWindowMs = flapWindowMs; this.flapHoldMs = flapHoldMs;
    this.flapBackoffMs = flapBackoffMs; this.quietMs = quietMs;
    this.deviceId = null; this.advert = null; this.connected = false; this.retries = 0; this.lastReason = null;
    this._init = null; this._q = Promise.resolve(); this._scanning = false; this._re = new Reassembler();
    this.lateLost = 0;     // late chunk errors that landed after their batch had resolved (diagnostics)
    this.lastLateLost = null;   // pl4: {label, frame, of, text} of the last one
    this._scanOp = Promise.resolve(); this._scanTok = 0;   // scan start/stop run one at a time, in call order
    this._linkSeq = 0;     // bumps per native connect; a retired link's disconnect callback is ignored (relink)
    this._relinking = false;
    this.frames = [];      // last frames in/out (diagnostics)
    // Every connect()/disconnect() bumps the generation. A retry loop carries the generation it
    // started in and exits the moment it goes stale, so a loop chasing an abandoned gun can never
    // outlive its device — nor hold `_reconnecting` and block the next gun's reconnect.
    this._gen = 0;
    this._wake = null;     // resolves the pending backoff early (the TAP TO RECONNECT pill)
    this._upAt = 0;        // F210: when this device last connected successfully
    this._flapStreak = 0;  // F210: consecutive connect-then-quick-drop cycles for THIS device
    this._flapNextAt = 0;  // when the current flap wait ends (0 when no wait is running)
    this._stableTimer = null;   // clears the flap count once a link has stayed up for `flapHoldMs`
  }
  /** `{count, next_retry_at}` while the gun keeps dropping the link (2+ quick drops in a row), else null.
   *  `next_retry_at` is this device's clock (`now()`), or null when no wait is running. `quiet: true`
   *  while the quiet period runs (no reconnect until `next_retry_at`). */
  get flapping() {
    if (this._flapStreak < 2) return null;
    const f = { count: this._flapStreak, next_retry_at: this._flapNextAt || null };
    if (this._flapNextAt && this._flapStreak >= QUIET_AFTER) f.quiet = true;
    return f;
  }
  /** F293: `{state, since}` for the headset's join to the gun, from the last `$VERSION` probe, or null. `since` is the
   *  first `?` of this cycle while 'joining' (the cap clock), else when the state was reached. */
  get headsetJoin() { return this._hs ? { state: this._hs, since: this._hs === 'joining' ? this._hsSince : this._hsAt } : null; }
  _setHeadset(state) {
    if (state === 'joined' || state === null) this._hsSince = 0;
    if (this._hs === state && state !== 'joined') return;   // every hds.N reading is news: the app clears its warnings on it
    this._hs = state; this._hsAt = this.now();
    try { this.onHeadset(this.headsetJoin); } catch (_) { /* a listener must not break the link */ }
  }
  /** A manual action (RECONNECT NOW, RELINK, a pick) ends a `not_joined` stop and starts the 60 s cap again. */
  resetHeadset() { if (this._hs !== 'joined') this._setHeadset(null); this._hsSince = 0; }
  /** True while the quiet period runs. */
  get quiet() { return !!(this.flapping && this.flapping.quiet); }
  _setFlap(streak, nextAt = 0) {
    const was = JSON.stringify(this.flapping);
    this._flapStreak = streak; this._flapNextAt = nextAt;
    if (JSON.stringify(this.flapping) !== was) { try { this.onFlap(this.flapping); } catch (_) { /* a listener must not break the link */ } }
  }
  /** A user action (RECONNECT NOW, RELINK, picking a gun) starts the backoff again from the start. */
  resetFlap() { this._setFlap(0); }
  /** True from a RELINK press until the link is back up or the relink gives up. The HUD disables RELINK GUN meanwhile. */
  get relinking() { return this._relinking; }
  _setRelinking(v) {
    if (this._relinking === v) return;
    this._relinking = v;
    try { this.onRelink(v); } catch (_) { /* a listener must not break the link */ }
  }
  _armStable() {
    clearTimeout(this._stableTimer);
    const seq = this._linkSeq;
    const t = this._stableTimer = setTimeout(() => {
      this._stableTimer = null;
      if (this.connected && seq === this._linkSeq && this._flapStreak) { this._log('gun link held: flap count cleared', 'li'); this._setFlap(0); }
    }, this.flapHoldMs);
    if (t && typeof t.unref === 'function') t.unref();   // node tests: a held link must not keep the process open
  }
  ensureInit() { return (this._init ||= this.ble.initialize({ androidNeverForLocation: true })); }

  /* Every scan the app runs (app 0.4.2 review, fleet scale: 10 guns and 10 phones in one room):
   *
   *  | Scan                        | Trigger                                   | Mode       | Duration                          | Interval / back-off                                        |
   *  |-----------------------------|-------------------------------------------|------------|-----------------------------------|------------------------------------------------------------|
   *  | Gun picker (app.js)         | SET MY GUN / SCAN AGAIN tap; boot with no | 2 (low     | PICKER_SCAN_MS (15 s), or until   | PICKER_MIN_GAP_MS (2 s) debounce; an automatic open backs  |
   *  |                             | gun; Bluetooth back on; rejoin fallback   | latency)   | a gun is picked                   | off 2 s, 4 s, ... 60 s with jitter, reset by a tap         |
   *  | Rejoin (app.js rejoinGun)   | boot mid-match with a remembered gun      | 2          | 12 s, then the picker (once)      | one shot                                                   |
   *  | Beacon watch (scanwatch.js) | armed/live AND stations in play; never    | 2, flood   | open while the match needs it     | restart 90 s (7 s while down in scanner respawn); a failed |
   *  |                             | while the picker or a connect owns radio  | guard 1, 0 |                                   | start retries every 7 s; flood guard pauses 5 s            |
   *  | Station (utility.js)        | utility role, always                      | 2, guard 1 | open while the station runs       | restart every 8 s (Android scan-stall guard)               |
   *
   *  No scan starts while a gun connect attempt is in flight: `scan()` refuses, and the beacon watch is
   *  held closed by app.js. The first connect after a scan stop waits SCAN_SETTLE_MS. */
  /** Continuous scan; calls onHit({deviceId, name, rssi, uuids}) for every advert until stop().
   *  scanMode 2 = low latency (the gun picker and the match-time beacon watch, scanwatch.js), 1 = balanced.
   *  Nameless adverts pass only when they carry a service UUID: utility items advertise no name on Android
   *  (the device name is not settable per app), their whole identity is the UUID (beacon.js).
   *  `onRaw()` runs for EVERY result the plugin delivers, before any filter: each one crossed the
   *  native-to-JS bridge that gun notifications share, so a flood guard must count them all (scanwatch.js). */
  async scan(onHit, { scanMode = 2, onRaw = null } = {}) {
    if (this._scanning) throw new Error('a scan is already open');
    if (this._connecting) throw new Error('a gun connect is in flight');   // app 0.4.2: never scan across a connect attempt
    this._scanning = true; const tok = ++this._scanTok;   // claim the radio before the first await
    return this._scanSerial(async () => {
      try {
        await this.ensureInit();
        await this.ble.requestLEScan({ allowDuplicates: true, scanMode }, res => {   // no service filter: Android misses taggers whose UUID rides in the scan response (bench 2026-08-25); the app filters by name instead
          if (onRaw) onRaw();
          const d = res.device || {}; if (!d.deviceId) return;
          const name = d.name || res.localName || '';
          const uuids = Array.isArray(res.uuids) ? res.uuids : [];
          if (!name && !uuids.length) return;
          onHit({ deviceId: d.deviceId, name, rssi: res.rssi, uuids, txPower: res.txPower });
        });
      } catch (e) { if (tok === this._scanTok) this._scanning = false; throw e; }   // a refused start is not an open scan
    });
  }
  /** Playtest 2026-09-13: `_scanning` was cleared when a stop RESOLVED, so a slow stop that overlapped a
   *  newer scan cleared the flag under it and the "already open" guard let a third scan in. Now the flag
   *  is the latest intent, set synchronously, and the native calls run strictly in call order. */
  stopScan() {
    this._scanning = false; this._scanTok++;
    return this._scanSerial(async () => { try { await this.ble.stopLEScan(); } catch (_) { /* ignore */ } this._scanStoppedAt = this.now(); });
  }
  get scanning() { return this._scanning; }
  /** True while a native connect attempt runs. */
  get connecting() { return this._connecting > 0; }
  _scanSerial(fn) { const p = this._scanOp.then(fn, fn); this._scanOp = p.catch(() => {}); return p; }

  // F211: adapter-off detection. `@capacitor-community/bluetooth-le` reports `true` on web, so the demo
  // and the desktop rig see an always-on adapter and behave exactly as before.
  /** Reports whether Bluetooth is on right now. */
  async isEnabled() { try { return !!(await this.ble.isEnabled()); } catch (_) { return true; } }
  /** Calls `cb(on)` whenever the adapter turns on or off; returns a stop function. A plugin build too
   *  old to carry the notification (or the web shim) yields a no-op stop, so a call site never has to
   *  branch on plugin version. */
  async watchEnabled(cb) {
    if (typeof this.ble.startEnabledNotifications !== 'function') return () => {};
    await this.ble.startEnabledNotifications(v => cb(!!v));
    return () => { try { this.ble.stopEnabledNotifications(); } catch (_) { /* ignore */ } };
  }
  /** Android only: show the system "turn on Bluetooth?" prompt. Resolves false where the plugin has no
   *  such call (iOS, web) so the HUD can decide whether to show the button at all. */
  async requestEnable() {
    if (typeof this.ble.requestEnable !== 'function') return false;
    try { await this.ble.requestEnable(); return true; } catch (e) { this._log('bluetooth enable request: ' + (e && e.message || e), 'le'); return false; }
  }
  /** Android only: open the OS Bluetooth settings page. */
  async openBluetoothSettings() {
    if (typeof this.ble.openBluetoothSettings !== 'function') return false;
    try { await this.ble.openBluetoothSettings(); return true; } catch (e) { this._log('open bluetooth settings: ' + (e && e.message || e), 'le'); return false; }
  }

  _log(m, cls) { this.log(m, cls); }
  _note(dir, f) { this.frames.push({ t: Date.now(), dir, f }); if (this.frames.length > 60) this.frames.shift(); }

  /** `onAttempt(i, of)` runs before each native connect attempt (the picker shows "Retrying (2 of 5)…"). */
  async connect(deviceId, advertName, { onAttempt = null } = {}) {
    await this.ensureInit();
    await this._settleAfterScan();
    this._gen++;                       // retires any loop still chasing the previous gun
    this._setFlap(0);                  // a manual connect ends any flap wait or quiet period at once
    this.resetHeadset();               // F293: ...and any headset wait, with a fresh 60 s cap
    this._wakeProbes();                // polish (M1): a probe of the old generation stops now, not at its timeout
    if (this._wake) this._wake();      // ...and WAKE it, or it sleeps out its backoff still holding
                                       // `_reconnecting`, which blocks the new gun's reconnect entirely
    this.advert = splitAdvert(advertName, deviceId);
    const gen = this._gen;
    const got = await this._connectWithRetry(deviceId, 5, false, gen, false, onAttempt);
    // F293: the headset never joined inside the cap. Keep the gun as this phone's gun, so RECONNECT NOW can try again.
    if (got === 'parked') { if (gen === this._gen) { this.deviceId = deviceId; this.connected = false; } return false; }
    if (got !== true) return false;   // a newer connect won (bench 2026-09-17): claiming the link here ran onUp with the gun down
    this.deviceId = deviceId; this.connected = true; this.retries = 0;
    this._upAt = this.now(); this._setFlap(0);   // F210: a freshly picked gun starts with a clean flap count
    this._armStable();
    this._up();
  }
  /** `relink` (a user RELINK): a bounded plugin connect timeout, a short fixed gap instead of the growing
   *  backoff, and `attempts` is a hard limit even when `unbounded()` (armed/live) would retry forever. */
  /** SCAN_SETTLE_MS: waits for any scan stop in flight, then the rest of the settle gap after it. The
   *  stamp is used once, so only the first connect after a scan waits, and an old stop costs nothing. */
  async _settleAfterScan() {
    await this._scanOp;
    const at = this._scanStoppedAt; this._scanStoppedAt = 0;
    const wait = at ? at + this.scanSettleMs - this.now() : 0;
    if (wait > 0) { this._log(`scan stopped: waiting ${wait} ms before the connect`, 'li'); await new Promise(r => setTimeout(r, wait)); }
  }
  async _connectWithRetry(id, attempts, forever = false, gen = this._gen, relink = false, onAttempt = null) {
    let last;
    for (let i = 1; ; i++) {
      // Game day 2026-09-19: a flap wait now holds THIS loop. It used to run beside the loop, so a loop
      // already running reconnected in the middle of the wait. A manual action clears `_flapNextAt` and wakes us.
      if (!relink) {
        while (gen === this._gen && this._flapNextAt && this._flapNextAt > this.now()) await this._waitOrWake(this._flapNextAt - this.now());
        if (this._flapNextAt && gen === this._gen) this._setFlap(this._flapStreak);   // the wait is over: no retry time to show
      }
      if (gen !== this._gen) { this._log('reconnect abandoned — a different gun was selected', 'li'); return false; }
      if (onAttempt) { try { onAttempt(i, attempts); } catch (_) { /* a listener must not break the link */ } }
      const t0 = this.now();
      let seq = 0;
      try {
        seq = ++this._linkSeq; this._attemptId = id;
        const att = { dropped: false, wake: null };
        // Only a link that was up runs the drop path. A failed connect also fires this callback, and it
        // used to log a second "gun disconnected" and tell the engine about a drop that never happened.
        // F293: a drop during the headset probe is not a drop of a link the app had either.
        this._connecting++;
        try {
          await this.ble.connect(id, () => {
            if (seq !== this._linkSeq) return;
            if (this.connected) this._dropped(); else { att.dropped = true; if (att.wake) att.wake(); }
          }, relink ? { timeout: this.relinkConnectMs } : undefined);
        } finally { this._connecting--; }
        if (gen !== this._gen) {                       // the gun came back AFTER we moved on: let it go,
          try { await this.ble.disconnect(id); } catch (_) { /* ignore */ }   // or two devices feed the engine
          return false;
        }
        if (this.headsetProbe) this._probing = seq;    // set before the notifications start: no frame reaches the engine early
        await this.ble.startNotifications(id, NUS, TX, v => this._notify(v));
        if (att.dropped) throw new Error('the gun dropped the link while it was connecting');
        if (!this.headsetProbe) return true;
        const out = await this._probeHeadset(id, att, gen, seq);
        if (out === 'retry') { i--; continue; }         // a headset wait is not a failed connect attempt
        // polish (low): the gun dropped the link as the hds.N reply landed. Never claim a link that is already gone.
        if (out === 'up' && att.dropped) throw new Error('the gun dropped the link as the headset probe answered');
        return out === 'up' ? true : out;             // 'parked' at the cap, false when a newer connect won
      } catch (e) {
        if (this._probing === seq) this._probing = 0;
        last = e; this.retries = i;
        const keep = relink ? i < attempts : forever || this.unbounded() || i < attempts;
        if (!keep) throw last;
        const delay = relink ? this.relinkGapMs : Math.min(10000, 500 * 2 ** Math.min(i - 1, 5)) * (0.8 + 0.4 * Math.random());
        // the time the attempt took and the plugin's reason: a 10 s "Connection timeout." and a fast GATT error need different fixes
        this._log(`connect ${i}${!relink && (forever || this.unbounded()) ? '' : '/' + attempts} failed after ${this.now() - t0} ms (${e && e.message || e}) — retrying in ${Math.round(delay)} ms`, 'le');
        await this._waitOrWake(delay);
      }
    }
  }

  /** F293: one probe of a fresh link. Sends the probe frames, reads `$VERSION` token 2, and returns 'up' (hds.N),
   *  'retry' (the headset has not joined: the link is released, or it dropped, and the wait is done), 'parked' (the
   *  cap ran out: not_joined), or false (a newer connect won). Throws when the gun drops the link before any reply
   *  in a cycle with no `?` yet, so that drop runs the ordinary connect-failure retry. */
  async _probeHeadset(id, att, gen, seq) {
    let r;
    this._atts.add(att);
    try {
      let frames;
      try { frames = this.probeFrames(); } catch (_) { frames = DEFAULT_PROBE; }
      if (!Array.isArray(frames) || !frames.length) frames = DEFAULT_PROBE;
      if (!frames.includes('$VERSION,*')) frames = [...frames, '$VERSION,*'];
      this._probeSent = frames;
      r = await this._readVersion(id, att, seq, frames, 'headset probe');
      let reread = false;
      for (;;) {
        if (gen !== this._gen) break;
        if (r === 'dropped') {
          if (!this._hsSince) throw new Error('the gun dropped the link during the headset probe');
          break;
        }
        if (r === true) { this._setHeadset('joined'); return 'up'; }
        // Polish (M2): in armed or live one `?` or timeout would cost at least 15 s with the gun down, so read once more.
        if (!reread && this.unbounded()) { reread = true; r = await this._readVersion(id, att, seq, ['$VERSION,*'], 'headset re-read'); continue; }
        this._noteUnjoined(r === 'timeout');
        if (this.headsetJoinMode !== 'hold' || this.now() >= this._hsSince + this.headsetJoinCapMs) break;
        await new Promise(res => { const t = setTimeout(res, this.headsetPollMs); att.wake = () => { clearTimeout(t); res(); }; });
        att.wake = null;
        if (att.dropped) { r = 'dropped'; continue; }
        if (gen !== this._gen) break;
        r = await this._readVersion(id, att, seq, ['$VERSION,*'], 'headset poll');
      }
    } finally { if (this._probing === seq) this._probing = 0; att.wake = null; this._atts.delete(att); }
    // Release the link (a dropped one needs no release). Its own disconnect callback must not run. Polish (M1): when a
    // newer attempt has already dialled this same gun, the link is ITS link now: leave it alone.
    const mine = seq === this._linkSeq;
    if (mine) this._linkSeq++;
    const claimed = !mine && this._attemptId === id;
    if (!att.dropped && !claimed) { try { await this.ble.disconnect(id); } catch (_) { /* best-effort */ } }
    if (gen !== this._gen) return false;
    const capped = this.now() >= this._hsSince + this.headsetJoinCapMs;
    if (capped) {
      const was = this._hs;
      this._setHeadset('not_joined');
      // Polish (M2): only kitted, lobby and idle stop at the cap. A gun stranded mid-match must come back by itself,
      // so armed and live keep the disconnect-and-wait cycle (it is not the harmful loop) at the settle pace.
      if (!this.unbounded()) {
        this._log(`headset not joined after ${Math.round(this.headsetJoinCapMs / 1000)} s: no more automatic tries. Power-cycle the headset, then tap RECONNECT NOW`, 'le');
        return 'parked';
      }
      if (was !== 'not_joined') this._log(`headset not joined after ${Math.round(this.headsetJoinCapMs / 1000)} s: a match runs, so the phone keeps trying every ${this.headsetSettleMs} ms`, 'le');
    }
    const hold = this.headsetJoinMode === 'hold';
    const left = this._hsSince + this.headsetJoinCapMs - this.now();
    const wait = capped ? this.headsetSettleMs : Math.max(0, Math.min(hold ? this.headsetPollMs : this.headsetSettleMs, left));
    this._log(att.dropped ? `the gun dropped the link while the headset joins: next try in ${wait} ms (not a flap)`
      : `headset not joined yet: link released, next try in ${wait} ms (not a flap)`, 'li');
    await this._waitOrWake(wait);
    return 'retry';
  }
  /** Sends `frames` on the probing link and waits for a `$VERSION` reply: true (hds.N), false (`?`), 'timeout'
   *  (none in `versionReplyMs`, which counts as `?`) or 'dropped'. Polish (M2): the reply timer starts when the
   *  write leaves the queue (`onStart`), not before it, so a long write ahead of the probe cannot fake a `?`. A
   *  backstop of `versionReplyMs` + 10 s ends the read if the write never starts, so no path hangs. */
  _readVersion(id, att, seq, frames, label) {
    return new Promise(res => {
      let t = null, over = false;
      const w = { seq, done: null };
      const done = v => {
        if (over) return; over = true;
        clearTimeout(t); clearTimeout(back);
        if (this._versionWait === w) this._versionWait = null;
        att.wake = null; res(v);
      };
      w.done = done;
      this._versionWait = w;
      att.wake = () => done('dropped');
      const back = setTimeout(() => done('timeout'), this.versionReplyMs + 10000);
      this.write(frames, label, { deviceId: id, onStart: () => { if (!over) t = setTimeout(() => done('timeout'), this.versionReplyMs); } });
    });
  }
  /** A `?` (or a timeout) reading: the headset is joining. Starts the cap clock and clears any flap streak: the
   *  headset explains the drops, so they are not flaps. Past the cap (a match keeps trying) it stays `not_joined`. */
  _noteUnjoined(timeout) {
    if (!this._hsSince) this._hsSince = this.now();
    this._setHeadset(this.now() >= this._hsSince + this.headsetJoinCapMs ? 'not_joined' : 'joining');
    if (this._flapStreak || this._flapNextAt) this._setFlap(0);
    this._log(timeout ? `headset probe: no $VERSION reply in ${this.versionReplyMs} ms, counted as not joined` : 'headset probe: $VERSION reads ? (headset not joined)', 'li');
  }
  _wakeProbes() { for (const a of this._atts) { if (a.wake) a.wake(); } }
  /** Tells the app the link is up, with what the probe learned (engine.onBleConnected's second argument). */
  _up() {
    let probe;
    if (this.headsetProbe) {
      const v = this._lastVersion ? this._lastVersion.split(',') : [];
      probe = { probed: true, frames: this._probeSent || DEFAULT_PROBE, fw: v[1] || null, headset: v[2] || null };
    }
    this.onUp(this.advert, probe);
  }

  /** Backoff that a TAP can cut short — otherwise the reconnect button just waits out the sleep. */
  _waitOrWake(ms) {
    return new Promise(res => {
      const t = setTimeout(() => { this._wake = null; res(); }, ms);
      this._wake = () => { clearTimeout(t); this._wake = null; res(); };
    });
  }

  /** The user asked to reconnect NOW: skip the remaining backoff, or start a loop if none is running. */
  retryNow() {
    this.resetFlap();
    this.resetHeadset();
    if (this._wake) { this._log('reconnect: retrying now', 'li'); this._wake(); return; }
    if (this.deviceId && !this.connected) this._reconnect();
  }
  /** RELINK GUN (playtest 2026-09-13): on a link the app believed was up, `retryNow()` did nothing, so the
   *  button was inert exactly when the operator needed it. Now a live link is really cycled: release the
   *  GATT link, then take the normal drop path, so the forever-reconnect loop reconnects and `onUp` runs
   *  the engine's relink (it re-writes the head only in the phases where that is safe, never mid-match). */
  /*  Bench 2026-09-17: the relink now runs its OWN reconnect, at once and bounded (see RELINK_CONNECT_MS), not
   *  the drop path's retry and flap backoff. It resolves true when the link is back, false when it gave up. A
   *  press while a relink runs is ignored (`relinking`), and a press on a link that is already down stays
   *  `retryNow()`. */
  async relink() {
    const id = this.deviceId; if (!id) return false;
    if (this._relinking) { this._log('relink: already relinking, press ignored', 'li'); return false; }
    this.resetFlap(); this.resetHeadset();
    if (!this.connected) { this.retryNow(); return true; }
    const gen = this._gen;
    this._setRelinking(true);
    try {
      this._log('relink: forcing a disconnect and a fresh connect', 'li');
      this._linkSeq++;                   // this link's own disconnect callback must not run the drop path a second time
      const t0 = this.now();
      let cap = null;
      const released = await Promise.race([
        this.ble.disconnect(id).then(() => true, () => true),   // best-effort
        new Promise(res => { cap = setTimeout(() => res(false), this.relinkDisconnectCapMs); }),
      ]);
      clearTimeout(cap);
      this._log(released ? `relink: gun released in ${this.now() - t0} ms` : `relink: no disconnect confirm in ${this.relinkDisconnectCapMs} ms, connecting anyway`, 'li');
      if (this.deviceId !== id || gen !== this._gen || !this.connected) return false;   // a new gun was picked, or it already dropped
      this._markDown();
      this._reconnecting = true; this._reconnectGen = gen;   // one loop per gun: a RECONNECT tap now cannot start a second one
      let ok = false;
      try { ok = await this._connectWithRetry(id, this.relinkAttempts, false, gen, true); }
      catch (e) { this._log(`relink: no link after ${this.relinkAttempts} attempts (${e && e.message || e}), back to the normal reconnect loop`, 'le'); }
      finally { if (this._reconnectGen === gen) this._reconnecting = false; }
      if (gen !== this._gen || this.deviceId !== id) return false;
      if (ok === true) { this.connected = true; this._upAt = this.now(); this._armStable(); this._log(`reconnected (relink, ${this.now() - t0} ms)`, 'lk'); this._up(); return true; }
      if (ok === 'parked') return false;   // F293: not_joined waits for a manual action
      this._reconnect();
      return false;
    } finally { this._setRelinking(false); }
  }
  _markDown() {
    this.connected = false; this._log(`*** gun disconnected ***`, 'le'); this.onDrop();
    clearTimeout(this._stableTimer); this._stableTimer = null;
  }
  _dropped() {
    this._markDown();
    if (!this.deviceId) return;
    // F210: a quick drop right after connecting is normal ONCE (a manual relink, a genuine radio blip)
    // and retries at once, same as always. A REPEATING quick drop (headset not linked: the gun connects,
    // answers a $PING, then drops itself within seconds — forever) now backs off instead of reconnecting
    // as fast as the hardware allows, which used to spin the radio and re-run onUp()'s relink side effects
    // every cycle with no way out short of linking the headset.
    // A drop inside FLAP_WINDOW_MS is a flap. A drop between the window and FLAP_HOLD_MS keeps the count
    // as it is; only a link held FLAP_HOLD_MS clears it (the hold timer).
    const held = this._upAt ? this.now() - this._upAt : Infinity;
    const streak = held < this.flapWindowMs ? this._flapStreak + 1 : held >= this.flapHoldMs ? 0 : this._flapStreak;
    const wait = held < this.flapWindowMs ? flapDelay(streak, this.flapBackoffMs, this.quietMs) : 0;
    if (wait) {
      this._setFlap(streak, this.now() + wait);
      if (streak >= QUIET_AFTER) this._log(`gun keeps dropping (${streak} in a row). Quiet period: no reconnect for ${wait} ms. Power-cycle the headset`, 'le');
      else this._log(`gun keeps dropping seconds after connecting (${streak} in a row). Is the headset on? Backing off ${wait} ms`, 'li');
    } else this._setFlap(streak);
    this._reconnect();   // the one retry loop waits out the flap wait itself
  }
  /** B4: the engine's link watchdog calls this when the gun has gone silent for too long while we still
   *  read as `connected` — the native disconnect callback this whole file otherwise depends on may never
   *  fire for a link that is merely bad rather than actually gone (marginal RF, a supervision timeout
   *  that hasn't tripped yet). Best-effort `disconnect()` first so the OS actually releases the stale
   *  GATT handle — some stacks reuse it silently on the very next `connect()` otherwise — then run the
   *  exact same path a real disconnect takes, so the engine, the HUD pill and MC's status all learn about
   *  it exactly once, and the forever-reconnect loop takes over from here. */
  noteStale() {
    if (!this.connected || !this.deviceId) return;
    const id = this.deviceId;
    this._log('*** gun link silent — forcing a reconnect ***', 'le');
    this.ble.disconnect(id).catch(() => { /* best-effort: let the OS release the stale GATT link */ });
    this._dropped();
  }
  async _reconnect() {
    if (this._reconnecting && this._reconnectGen === this._gen) return;   // one loop per gun; a second
    this._reconnectGen = this._gen;                  // would double-subscribe notifications
    this._reconnecting = true;
    // FOREVER, in every phase. It used to stop after 6 tries (~25 s) outside armed/live, which is
    // exactly how long a gun that is simply switched OFF takes to burn them — so a gun powered on a
    // minute later was never retried, the HUD blinked GUN DISCONNECTED indefinitely and the MC board
    // stayed blocked until someone found RECONNECT GUN in the debug panel (field 2026-09-01).
    // A gun that is off fails cheaply and the backoff caps at 10 s, so this costs ~6 attempts/min.
    const gen = this._gen;
    try {
      if (await this._connectWithRetry(this.deviceId, 0, true, gen) === true && gen === this._gen) {
        this.connected = true; this._upAt = this.now(); this._armStable(); this._log('reconnected', 'lk'); this._up();
      }
    }
    catch (e) { this._log('reconnect stopped: ' + (e && e.message || e), 'le'); }
    finally { this._reconnecting = false; }
  }
  async disconnect() {
    this._gen++;                       // stop any forever-loop before it re-adopts this gun
    this._wakeProbes();
    if (this._wake) this._wake();
    clearTimeout(this._stableTimer); this._stableTimer = null; this._setFlap(0);
    this._hsSince = 0; this._setHeadset(null);
    const id = this.deviceId; this.deviceId = null; this.connected = false;
    if (id) { try { await this.ble.disconnect(id); } catch (_) { /* ignore */ } }
  }
  _notify(value) {
    for (const f of this._re.pump(dataViewToText(value))) {
      this._note('rx', f);
      const w = this._versionWait;
      if (w) { const h = headsetLinked(f); if (h != null) { this._lastVersion = f; w.done(h); } }
      // F293: the engine hears nothing from a link it has not been told about. Frames in the probe window (a `$BUT`
      // press, an `$ALCD` shot) are noted in `frames` for the log and DROPPED, not replayed after the link is up.
      if (!this._probing) this.onFrame(f);
    }
  }

  /** Write frames verbatim, in order, chunked at 20 bytes with pacing; serialized per device. Each chunk
   *  waits for the plugin's answer for at most `ackCapMs` (see WRITE_ACK_CAP_MS).
   *
   *  A block pause (`blockFrames` > 0) sleeps `blockPauseMs` after every `blockFrames` frames of ONE write,
   *  so the gun's one-byte-per-loop parser can drain its buffer mid-arm (transport-hardening.md §3; off by
   *  default).
   *
   *  `responseForMultiPacket` (off by default, §5) sends the chunks of any frame over 20 bytes with response
   *  instead of without; a single-packet frame is never affected. Applies to every multi-packet frame in this
   *  write, not only head/spawn (see the note on `WRITE_PACING`).
   *
   *  A LATE chunk error (past the cap) belongs to the batch that sent the chunk, never to the link (pl3
   *  review 2026-09-17). The old link-wide flag let a late error from batch N cut batch N+1 partway, which
   *  dropped `$SPAWN`/`$AMMO`/`$BMAP` with no retry while batch N still reported true. Now:
   *  - A late error that lands while its own batch is still sending marks that batch. At the next frame
   *    boundary the batch sends again from the start of the earliest failed frame, so every frame stays
   *    whole and in order. The frames between that one and the boundary go twice.
   *  - After LATE_RESENDS re-sends the batch finishes its frames anyway and resolves false, so the caller's
   *    retry runs. It never stops partway.
   *  - A late error that lands after its batch resolved is logged at `le` with the batch label and the frame
   *    (pl4: a lost trigger row must be visible in the phone log), counted (`lateLost`) and kept as
   *    `lastLateLost`. It cannot touch any other batch.
   *  `label`: what the batch is, for that log line (the engine passes its `why`). */
  write(frames, label = '', options = undefined) {
    const id = (options && options.deviceId) || this.deviceId; if (!id) return Promise.resolve(false);   // F293: the probe writes before the link is claimed
    if (this._probing && !(options && options.deviceId)) { this._log(`write refused while the headset probe owns the link: ${label || 'unlabelled'}`, 'li'); return Promise.resolve(false); }
    const list = Array.isArray(frames) ? frames : [frames];
    const batch = { failed: null, open: true, label, list };   // `failed`: the earliest frame index a late error hit
    this._q = this._q.then(async () => {
      if (options && typeof options.onStart === 'function') options.onStart();
      let late = 0, chunks = 0, resends = 0, lost = false, sentFrames = 0;
      try {
        for (let i = 0; i < list.length;) {
          const frame = list[i];
          this._note('tx', frame);
          const useResponse = this.responseForMultiPacket && frame.length > 20;
          for (let o = 0; o < frame.length; o += 20) {
            chunks++;
            if (!await this._sendChunk(id, textToDataView(frame.substr(o, 20)), batch, i, useResponse)) late++;
            if (frame.length > 20) await sleep(this.chunkGapMs);
          }
          await sleep(this.frameGapMs);
          i++;
          if (batch.failed != null) {
            const from = batch.failed; batch.failed = null;
            if (resends < LATE_RESENDS) {
              resends++; i = from;
              this._log(`write: a chunk of frame ${from + 1} of ${list.length} was lost -- sending again from that frame`, 'le');
            } else lost = true;   // finish the batch, then report the loss
          }
          sentFrames++;
          if (this.blockFrames > 0 && this.blockPauseMs > 0 && sentFrames % this.blockFrames === 0 && i < list.length) await sleep(this.blockPauseMs);
        }
      } finally { batch.open = false; }
      if (late) { this.lateAcks += late; this._log(`write answers slow: ${late} of ${chunks} chunk(s) past ${this.ackCapMs} ms, sent on without them`, 'le'); }
      if (lost) { this._log(`write: chunks still lost after ${LATE_RESENDS} re-send(s) -- the batch is sent but reports failure`, 'le'); return false; }
      return true;
    }).catch(e => { batch.open = false; this._log('write err: ' + (e && e.message || e), 'le'); return false; });
    return this._q;
  }
  /** Sends one chunk of frame `frameIdx` in `batch`. Resolves true when the plugin answered within `ackCapMs`,
   *  false when the cap ran out first. An error inside the cap rejects (the batch stops, as before). A LATER
   *  error marks only `batch` (see `write`).
   *
   *  `useResponse` picks `writeChunkResponse` over `writeChunk` (F270) and waits for the answer with NO cap.
   *  A with-response write answers in one or two connection intervals (30-100 ms), past `ackCapMs`, and the
   *  plugin keeps ONE write callback per device: moving on early fails the next chunk as busy on Android and
   *  lets it overwrite the pending callback on iOS, which drops the first chunk's error. Waiting is the point
   *  of the lever: an error rejects, and the batch stops as it does for an error inside the cap. */
  _sendChunk(id, dv, batch = null, frameIdx = 0, useResponse = false) {
    let sent;
    try { sent = Promise.resolve((useResponse ? this.writeChunkResponse : this.writeChunk)(id, dv)); } catch (e) { return Promise.reject(e); }
    if (useResponse) return sent.then(() => true);
    return new Promise((resolve, reject) => {
      let done = false;
      const t = setTimeout(() => { done = true; resolve(false); }, this.ackCapMs);
      sent.then(() => { if (done) return; done = true; clearTimeout(t); resolve(true); },
        e => {
          if (!done) { done = true; clearTimeout(t); reject(e); return; }
          const msg = e && e.message || e;
          if (batch && batch.open) {
            batch.failed = batch.failed == null ? frameIdx : Math.min(batch.failed, frameIdx);
            this._log('write err (after the answer cap): ' + msg, 'le');
          } else {
            this.lateLost++;
            const b = batch || { label: '', list: [] };
            const frame = String(b.list[frameIdx] || '');
            this.lastLateLost = { label: b.label, frame: frameIdx, of: b.list.length, text: frame };
            this._log('write err (after the answer cap): ' + msg + ' -- its batch had already been sent'
              + ` (batch ${b.label ? `"${b.label}"` : 'unlabelled'}, frame ${frameIdx + 1} of ${b.list.length}: ${frame.slice(0, 32)}), LOST`, 'le');
          }
        });
    });
  }
}
