// Node-side Transport — the M-NET client (docs/spec/contracts.md §5/§5a/§7 (the retired net.md §6 interface, archived at docs/archive/spec-net.md)).
// A pure state machine over a WebSocket-like object. The app owns the engine, HUD, BLE and the
// §3.10 resync; this owns the wire: hello/welcome hydration, bind, live-only status, the persisted
// fact ring + batch flush + ack prune, NTP-lite sync, reconnect with backoff.
//
// F153 (field 2026-09-12): every leg of the dial ladder has a PRE-OPEN giveup (a dial that never fires
// any event is the normal failure on a phone, and the OS timeout is ~2 minutes), a new connect() aborts
// whatever is in flight rather than queueing behind it, and `dialNow()` restarts the ladder the moment
// the platform says the network came back.
//
// A28 backhaul (contracts §5d): when MC hands us a `pub` (its tunnel URL) alongside the LAN `url`,
// backhaul is PREFERRED — dialled first on every fresh attempt, with a LAN fallback if it doesn't
// welcome inside BACKHAUL_GIVEUP_MS; while riding the LAN with a pub in hand we check every
// PUB_RETRY_MS whether it is reachable and, if so, drop the LAN link so the ordinary dial ladder
// claims it over pub. With no pub the loop is exactly what it was.
//
// The pub reachability check (`_probePub`) NEVER sends a hello: MC's node registry is one-socket-
// per-node (net.py), so a hello from this node_id/node_key on a second socket makes MC hand the
// connection over and close the first one immediately — well before any client-side "wait for
// welcome, then decide" logic could run. So the probe only proves the websocket upgrade succeeds,
// then closes and lets `dropLink()` + the normal reconnect loop (which already prefers pub) claim
// the node the one correct way.
import * as E from './envelope.js';
import { Ring, defaultStorage } from './ring.js';
import { Clock } from './clock.js';
import { APP_VER, platformName } from '../build.js';
import { newChallenge, matchingKey, validTrustKey } from './mcproof.js';

/** @typedef {{getItem(key:string): string|null, setItem(key:string, value:string): void, removeItem(key:string): void}} TransportStorage */
/** @typedef {{onopen: WebSocket['onopen'], onmessage: WebSocket['onmessage'], onerror: WebSocket['onerror'], onclose: WebSocket['onclose'], send(data:string): void, close(code?:number, reason?:string): void, bufferedAmount?: number}} TransportSocket */
/** @typedef {{setTimeout(callback: (...args:any[]) => void, ms:number): unknown, clearTimeout(id:unknown): void}} TransportTimers */
/** @typedef {{node_id?:string, node_type?:string, app_ver?:string, platform?:string, connection_type?:'wifi'|'cellular'|'none'|'unknown'|null}} TransportNode */
/** @typedef {{node_id:string, node_key:string}} PriorUtility */
/** @typedef {{name:string, tail:string, fw?:string}} TransportGun */
/** @typedef {{baseMs:number, capMs:number, jitter:number}} BackoffOptions */
/** @typedef {Record<string, unknown>} TransportBody */
/** @typedef {{v:number, kind:string, id:string, t:number, body:TransportBody, seq?:number}} TransportEnvelope */
/** @typedef {{url?:string, mdns?:string, qr?:string, pub?:string|null, secret?:string|null, trusted?:boolean, verify?:boolean}} ConnectOptions */
/** @typedef {{storage?:TransportStorage, wsFactory?:(url:string) => TransportSocket, node?:TransportNode, gun?:TransportGun|null, priorUtility?:PriorUtility|null, heartbeatMs?:number, now?:() => number, timers?:TransportTimers, random?:() => number, backoff?:BackoffOptions, helloTimeoutMs?:number, welcomeTimeoutMs?:number, keyPrefix?:string, backhaulGiveupMs?:number, pubRetryMs?:number, lanGiveupMs?:number, reclaimRetryMs?:number, randomBytes?:(n:number) => Uint8Array}} TransportOptions */
/** @typedef {{type?:string, t?:number, match_id?:string|null, node_id?:string, player_id?:string|null} & Record<string, unknown>} TransportFact */
/** @typedef {Record<string, unknown> & {pending?:number, dropped?:number, preflight?:Record<string, unknown>}} StatusBody */
/** @typedef {'offline'|'connecting'|'open'|'bound'|'rejected'} TransportState */
/** @typedef {'lan'|'backhaul'} DialVia */
/** @typedef {{resolve(value:TransportBody):void, reject(reason:unknown):void}} WelcomePromise */
/** @typedef {{code?:number, reason?:string}} CloseEventLike */

/** The MC kinds handed to `onMessage` subscribers (the engine, utility.js, app.js). A kind missing HERE
 *  decodes and validates perfectly and then goes nowhere — no error, no log, the feature simply never runs.
 *  That is the F105 trap (`station_config`: "MC never arms a station") and it caught `result` (A24) too.
 *  EXPORTED so `test/transport.test.mjs` can pin DELIVERED ⊇ every `case` in the engine's `onMcMessage`. */
export const DELIVERED = new Set(['assign', 'config', 'tutorial', 'start', 'feedback', 'control', 'apply', 'score', 'time_res', 'pull_log', 'loadout_ack', 'alert',
  'result',           // A24: the match result. Without this line the whole FINAL RESULTS screen is dead on the real wire.
  'station_config',   // A13.5 (F104/F105)
  'station_update']);  // A56 (S58): a powerup station's available / taken state

/** A28.2: a cosmetic-only difference (scheme/host case, a trailing '/') must not look like "a
 *  different MC" and wipe a held pub/secret -- normalize before comparing a stored url to a given one. */
/** @param {unknown} u @returns {string} */
function normUrl(u) {
  const s = String(u || '');
  const i = s.indexOf('://');
  if (i < 0) return s;
  const scheme = s.slice(0, i).toLowerCase();
  const rest = s.slice(i + 3);
  const slash = rest.indexOf('/');
  const host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
  let path = slash < 0 ? '' : rest.slice(slash);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return `${scheme}://${host}${path}`;
}

/** @param {unknown} value @returns {TransportBody|null} */
function objectBody(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {TransportBody} */ (value)
    : null;
}

export const BACKHAUL_GIVEUP_MS = 8000;   // A28.3: no welcome over pub within this -> fall back to the LAN url
export const PUB_RETRY_MS = 30000;        // A28.3: while riding the LAN with a pub in hand, re-probe it this often
/** F153a (field 2026-09-12): the LAN leg of the ladder needs the SAME pre-open giveup the backhaul leg
 *  got. A phone that is off the field Wi-Fi dials a LAN address no route can reach; Android's connect
 *  timeout is ~2 minutes and for those two minutes the pub we are holding is never tried again. Measured
 *  cost in the field: mobile data came back and the node took ~3 minutes to reappear, missing the rest of
 *  the match. With this the ladder is pub -> lan -> pub -> lan ..., with the ordinary backoff (cap 10 s)
 *  between full passes, so a data blip costs seconds. */
export const LAN_GIVEUP_MS = 8000;
export const PRIOR_UTILITY_KEY = 'brx.prior_utility';

/** The app calls this only after `bound`; an unacknowledged proof remains available for a retry.
 * @param {{priorUtilityConsumed?:boolean}|null} transport
 * @param {TransportStorage} storage
 * @returns {boolean}
 */
export function clearConsumedPriorUtilityHandoff(transport, storage = defaultStorage()) {
  if (!transport || transport.priorUtilityConsumed !== true) return false;
  try { storage.removeItem(PRIOR_UTILITY_KEY); return true; } catch (_) { return false; }
}

/** F346 (a): at most this many MC hosts keep a pending enrol nonce; a new host evicts the oldest. */
const ENROLL_NONCE_HOSTS_MAX = 8;

/** A60: does this install hold a trust key for its own node_id? The app asks before it chooses a verify
 *  dial over a JOIN row, with no Transport built. Mirrors `Transport#trustKeys`.
 * @param {TransportStorage} [storage] @param {string} [keyPrefix] @returns {boolean} */
export function holdsTrustKey(storage = defaultStorage(), keyPrefix = 'brx') {
  try {
    const nodeId = storage.getItem(`${keyPrefix}.node_id`);
    const v = JSON.parse(storage.getItem(`${keyPrefix}.mc_trust`) || 'null');
    return !!nodeId && !!v && v.node_id === nodeId && Array.isArray(v.keys) && v.keys.some(validTrustKey);
  } catch (_) { return false; }
}

/** Review pass 2: an UNTRUSTED dial (a JOIN-row address, so we withheld our node_key) can be refused
 *  `4003 in_use` for one reason that is not an attack and not a mistake: OUR OWN previous socket at that
 *  MC has not gone stale yet. A8.2 is explicit that a stale holder is displaced WITHOUT a key, so the fix
 *  is to wait out the stale window and try once more. Derived from the contract constant so the two
 *  cannot drift apart. Only ever spent once per connect(), and only while untrusted. */
export const RECLAIM_RETRY_MS = E.STALE_AFTER_MS + 1500;
/** A60: trust keys kept per node_id, one per MC install this phone joined (a laptop swap keeps both). */
export const TRUST_KEYS_MAX = 4;

export class Transport {
  /**
   * @param {TransportOptions} [o] options
   */
  constructor({ storage = defaultStorage(), wsFactory = url => new WebSocket(url), node = {}, gun = null, priorUtility = null,
                heartbeatMs = E.STATUS_HEARTBEAT_MS, now = () => Date.now(), timers = globalThis,
                random = Math.random, backoff = { baseMs: 500, capMs: 10000, jitter: 0.2 }, helloTimeoutMs = 5000,
                welcomeTimeoutMs = 10000, keyPrefix = 'brx', backhaulGiveupMs = BACKHAUL_GIVEUP_MS,
                pubRetryMs = PUB_RETRY_MS, lanGiveupMs = LAN_GIVEUP_MS, reclaimRetryMs = RECLAIM_RETRY_MS,
                randomBytes = undefined } = {}) {
    this.storage = storage; this.wsFactory = wsFactory; this.now = now; this.timers = timers; this.random = random;
    this.backoff = backoff; this.helloTimeoutMs = helloTimeoutMs; this.heartbeatMs = heartbeatMs; this.welcomeTimeoutMs = welcomeTimeoutMs;
    this.backhaulGiveupMs = backhaulGiveupMs; this.pubRetryMs = pubRetryMs; this.lanGiveupMs = lanGiveupMs; this.reclaimRetryMs = reclaimRetryMs;
    this.syncIntervalMs = Math.min(5000, Math.floor(E.SYNC_FRESH_MS / 2));   // keep synced() fresh (SYNC_FRESH_MS = 10 s)
    this.nodeId = node.node_id || this._persistedNodeId(`${keyPrefix}.node_id`);
    this._keyKey = `${keyPrefix}.node_key`;
    this.nodeKey = this._persisted(this._keyKey);        // contracts A8: takeover key issued in welcome
    this._pubKey = `${keyPrefix}.pub`; this._secretKey = `${keyPrefix}.secret`; this._sessionKey = `${keyPrefix}.session_id`;
    this._pubUrlKey = `${keyPrefix}.pub_url`;
    this.pub = this._persisted(this._pubKey) || null;               // A28.2: the tunnel URL, session- AND url-scoped
    this.secret = this._persisted(this._secretKey) || null;         // A28.2: the QR's join secret, session- AND url-scoped
    this._persistedSessionId = this._persisted(this._sessionKey) || null;
    this._pubUrl = this._persisted(this._pubUrlKey) || null;        // A28.2: the LAN url this pub/secret pair belongs to
    // A60: the trust keys MC installs have issued to THIS node_id (`welcome.mc_trust.key`), newest first.
    this._trustKeyKey = `${keyPrefix}.mc_trust`;
    // F346 (a): the random nonce every enrolling hello carries until a trust key arrives, so MC can hand the
    // same key again to THIS phone (and nobody else) when the welcome that carried it was lost.
    this._enrollNonceKey = `${keyPrefix}.mc_enroll_nonce`;
    /** @type {((n:number) => Uint8Array)|undefined} */ this.randomBytes = randomBytes;
    /** A60: a `verify` dial (an address the player never named) withholds every secret, sends a fresh
     *  `mc_challenge`, and processes NOTHING until the welcome's `mc_proof` checks out. */
    this.verify = false; /** @type {string|null} */ this._challenge = null;
    this._enrollSent = false;   // A60: did the hello on the live socket ask for a trust key?
    /** @type {'no_proof'|'bad_proof'|'no_key'|'no_random'|null} */ this.verifyFailed = null;
    this.reach = null;                       // A28.3: 'lan' | 'backhaul' | null (not yet welcomed)
    /** @type {'wifi'|'cellular'|'none'|'unknown'|null} */
    this.connectionType = node.connection_type || null;   // F309: the phone's own connection; null = never told (web, tests)
    /** @type {'wifi'|'cellular'|'none'|'unknown'|null} */
    this._boundConnType = null;             // F309: the connection when THIS socket bound (the one it rides)
    this.nodeType = node.node_type || 'phone';
    // A29: the REAL build, baked by scripts/build.mjs — "<package version>+<sha>[-dirty]". A caller may
    // still name itself (utility.js does); nothing may fall back to a hand-written literal.
    this.appVer = node.app_ver || APP_VER;
    this.platform = node.platform || null;   // null = ask Capacitor per frame (the bridge appears late)
    this.gun = gun; this.playerId = null; this.playerNum = 0; this.matchId = null; this.sessionId = null;
    this.priorUtility = priorUtility && priorUtility.node_id && priorUtility.node_key ? priorUtility : null;
    this.priorUtilityConsumed = false;
    this._priorUtilityOffered = false;
    /** @type {TransportBody} */ this.context = {}; // last welcome.node / assign / config / start
    this.ring = new Ring({ storage, key: `${keyPrefix}.outbox`, now });
    this.clock = new Clock({ storage, key: `${keyPrefix}.clock`, now });
    // Review pass 1 (security): a url the USER never provided -- one the LAN sweep found by opening a
    // socket to it -- is an UNTRUSTED peer until it proves it is Mission Control by welcoming us. Any
    // host on the subnet can accept a websocket upgrade on the node port, and `hello` otherwise hands it
    // this node's takeover key (A8.2) and the join secret (A28.2). Both are stripped while untrusted.
    this.trusted = true; this._reclaimTried = false;
    this.armedOrLive = false;                // app sets true in ARMED/LIVE → reconnect is unbounded
    /** @type {Record<string, unknown>} */ this.preflight = {}; // app merges via setPreflight()
    /** @type {(() => StatusBody)|null} */ this.statusProvider = null; // app: () => status body (hp, armor, ammo, alive, shots, arm_state, ...)
    /** @type {TransportState} */ this.state = 'offline';
    /** @type {string|null} */ this.url = null;
    this.closed = false; this.attempt = 0; this.reconnects = 0; this.rejected = null;
    this.stats = { sent: 0, received: 0, malformed: 0, batches: 0 };
    /** @type {TransportSocket|null} */ this._ws = null;
    /** @type {unknown} */ this._hbTimer = null; /** @type {unknown} */ this._rcTimer = null;
    /** @type {unknown} */ this._helloTimer = null; /** @type {unknown} */ this._syncTimer = null;
    /** @type {unknown} */ this._connectTimer = null;
    this._viaCurrent = null;                 // which url `this._ws` (the live/primary socket) dialled
    /** @type {unknown} */ this._pubRetryTimer = null;
    /** @type {TransportSocket|null} */ this._probeWs = null;
    /** @type {unknown} */ this._probeGiveupTimer = null;
    this._pubJustLearned = false; this._probeStale = false;
    /** @type {Array<(message:TransportBody) => void>} */ this._onMessage = [];
    /** @type {Array<(state:TransportState) => void>} */ this._onState = [];
    /** @type {Array<(node:TransportBody|null, welcome:TransportBody) => void>} */ this._onHydrate = [];
    /** @type {WelcomePromise|null} */ this._firstWelcome = null;
    /** @type {number|null} */ this._welcomeDeadlineAt = null;
  }

  // ---------- public API (net.md §6) ----------
  /** @param {ConnectOptions} [options] @returns {Promise<TransportBody>} */
  connect({ url, mdns, qr, pub, secret, trusted = true, verify = false } = {}) {
    // F153b (field 2026-09-12): a new connect() SUPERSEDES whatever dial is already in flight. A QR
    // rescan after the tunnel restarted, a typed address, RECONNECT MC -- each hands us a new triple,
    // and the socket already connecting was aimed at the old one. Left alone it holds the slot until the
    // OS connect timeout (~2 min on Android), so the phone ignores the address the player just scanned.
    // Kill it (handlers detached first, so its onclose cannot schedule a reconnect behind us), settle the
    // old connect() promise, and dial the new target from the top of the ladder below.
    this._abortInFlight('superseded by a new connect()', 'reconnect');
    this.attempt = 0;
    this.verify = verify === true; this._challenge = null; this.verifyFailed = null;
    this.trusted = trusted !== false && !this.verify;   // stays false until this peer welcomes us (see `trusted` above)
    this._reclaimTried = false;
    const nextUrl = url || qr || this.url;
    if (this.verify) {
      // A60: nothing held for the MC we trust (pub, secret, the url they belong to) is touched until this
      // host proves it IS that MC. A failed proof must leave the phone exactly as it was.
      if (!this.hasTrustKey()) { this.verifyFailed = 'no_key'; return Promise.reject(Object.assign(new Error('connect: no trust key to verify with'), { code: 'mc_unproven' })); }
      if (!nextUrl) return Promise.reject(new Error('connect: no url'));
      this.url = nextUrl; this.closed = false; this.rejected = null;
      return new Promise((resolve, reject) => {
        this._firstWelcome = { resolve, reject };
        this._armConnectTimeout(this.welcomeTimeoutMs);
        this._open();
      });
    }
    // A28.2 security: pub/secret are only ever valid for the MC that issued them. A different LAN
    // target (a phone told to join a different MC) means the tunnel/secret held for the OLD one must
    // not be dialled or offered — drop both before adopting whatever THIS call gives us.
    if (nextUrl && this._pubUrl && normUrl(nextUrl) !== normUrl(this._pubUrl)) { this._setPub(null); this._setSecret(null); }
    this.url = nextUrl;
    if (pub !== undefined) this._setPub(pub);
    if (secret !== undefined) this._setSecret(secret);
    if (this.url) { this._pubUrl = this.url; this._store(this._pubUrlKey, this.url); }
    if (!this.url) return Promise.reject(new Error('connect: no url (mdns is not implemented on the phone yet — scan the QR or type the address)'));
    this.closed = false; this.rejected = null;
    return new Promise((resolve, reject) => {
      this._firstWelcome = { resolve, reject };
      // Armed BEFORE the dial: `_open()` can reach a close handler synchronously, and a handler that
      // re-arms this timeout (the reclaim retry below) would otherwise have its timer overwritten here.
      this._armConnectTimeout(this.welcomeTimeoutMs);
      this._open();
    });
  }
  /** Arm (or re-arm, from `ms` NOW) the deadline that rejects the pending connect() when no welcome ever
   *  arrives. The reconnect loop keeps running either way — this only settles the promise the caller is
   *  holding. No pending promise, no timer. */
  /** @param {number} ms */
  _armConnectTimeout(ms) {
    if (this._connectTimer) { this.timers.clearTimeout(this._connectTimer); this._connectTimer = null; }
    if (!this._firstWelcome) return;
    this._welcomeDeadlineAt = this.now() + ms;
    this._connectTimer = this.timers.setTimeout(() => {
      this._connectTimer = null;
      if (this._firstWelcome) { const p = this._firstWelcome; this._firstWelcome = null; p.reject(new Error('connect: no welcome within ' + ms + ' ms')); }
    }, ms);
  }
  /** F346 (c): true while the pending connect() is inside the deadline actually armed for it: the
   *  welcome window, or the 4003 reclaim wait plus a full welcome window. The app's user-dial guard reads
   *  this instead of assuming `welcomeTimeoutMs`. */
  /** @returns {boolean} */
  welcomeWindowOpen() {
    return !!this._firstWelcome && this._welcomeDeadlineAt != null && this.now() < this._welcomeDeadlineAt;
  }
  /** @param {{player_id?:string|null, gun?:TransportGun|null}} [options] */
  bind({ player_id, gun } = {}) {
    if (gun && gun.name) this.gun = gun;      // gun linked AFTER connect (MC-first join order) — without this the bind never carried the gun (rig find, 2026-08-26)
    if (!this.gun) return;
    if (player_id) this.playerId = player_id;
    this._sendKind('bind', { node_id: this.nodeId, player_id: this.playerId, gun_name: this.gun.name, gun_tail: this.gun.tail });
  }
  /** Persist + (if bound) send a node-observed fact. NEVER blocks, NEVER throws when offline. */
  /** @param {TransportFact} fact @returns {number} */
  send(fact) {
    try {
      const ev = { ...fact };
      if (ev.t == null) ev.t = this.syncedNow();
      if (!('match_id' in ev)) ev.match_id = this.matchId;
      if (ev.node_id == null) ev.node_id = this.nodeId;
      if (ev.player_id == null) ev.player_id = this.playerId;
      const seq = this.ring.push(ev);
      if (this.state === 'bound') this._sendRaw(E.makeEnvelope('event', ev, { seq, t: this.syncedNow() }));
      return seq;
    } catch (e) { this._log('send failed', e); return -1; }
  }
  /** Live-only heartbeat: sent iff bound, else dropped (no seq, no queue). */
  /** @param {StatusBody} [body] @returns {boolean} */
  status(body = {}) {
    body.pending = this.ring.pending().length;   // lets MC know 'nothing left to flush' (recap finality, 2026-08-26)
    if (this.state !== 'bound') return false;
    // app_ver/platform ride EVERY heartbeat, not just the hello (A29): a phone that was updated and
    // relaunched mid-session keeps the same node_id, and MC's muster rollup must see the new build.
    /** @type {StatusBody} */ const full = { node_id: this.nodeId, player_id: this.playerId, match_id: this.matchId, synced: this.synced(),
                   app_ver: this.appVer, platform: this.platformName(),
                   arm_state: 'connected', ...body, reach: this.reach,   // A28.3: the live socket's path, always ours to say
                   ...(this._claimedTransport() ? { transport: this._claimedTransport() } : {}),   // F309: restated every beat
                   preflight: { ...this.preflight, ...(body.preflight || {}) } };
    const dropped = this.ring.takeDropped(); if (dropped) full.dropped = (full.dropped || 0) + dropped;
    return this._sendKind('status', full);
  }
  /** F309: the phone's own connection (Capacitor Network `connectionType`). MC counts a phone as covered
   *  only when it reached MC through the tunnel AND reports `cellular`; anything unrecognised is 'unknown'.
   *  @param {unknown} t */
  setConnectionType(t) {
    this.connectionType = t === 'wifi' || t === 'cellular' || t === 'none' ? t : 'unknown';
    // First word after a bind with no value: nothing has changed since the socket opened, so it names it.
    if (this.state === 'bound' && this._boundConnType === null) this._boundConnType = this.connectionType;
  }
  /** F309: what this node may claim. The plugin reports the phone's CURRENT default network, but a bound
   *  socket keeps riding the network it opened on (Android's "switch to mobile data" moves the default and
   *  leaves the socket on the field Wi-Fi). So it claims `cellular` only while the bind-time value AND the
   *  current one both say so; otherwise it returns the CURRENT value -- except when the current value is
   *  itself `cellular` but the bind-time one is not, where it falls back to the bind-time value (or
   *  `'unknown'` if there is none).
   *  @returns {'wifi'|'cellular'|'none'|'unknown'|null} */
  _claimedTransport() {
    const now = this.connectionType, bound = this._boundConnType;
    if (!now) return null;
    if (now === 'cellular') return bound === 'cellular' ? 'cellular' : (bound || 'unknown');
    return now;
  }
  /** Non-fact uplink: ready | ack_config | log_offer | log_data | loadout_request | loadout_browse. Sent iff bound. */
  /** @param {string} kind @param {TransportBody} [body] @returns {boolean} */
  report(kind, body = {}) {
    if (this.state !== 'bound') return false;
    return this._sendKind(kind, { node_id: this.nodeId, ...body });
  }
  /** `android` | `ios` | `web` (A29). */
  platformName() { return this.platform || platformName(); }
  /** Bytes still queued in the socket — the log uploader's backpressure gate (A25: one chunk in flight). */
  bufferedAmount() { const ws = this._ws; try { return ws && Number.isFinite(ws.bufferedAmount) ? ws.bufferedAmount : 0; } catch (_) { return 0; } }
  syncedNow() { return this.clock.syncedNow(this.now()); }
  synced() { return this.clock.synced(this.now()); }
  /** @param {(message:TransportBody) => void} cb @returns {() => void} */
  onMessage(cb) { this._onMessage.push(cb); return () => { this._onMessage = this._onMessage.filter(f => f !== cb); }; }
  /** @param {(state:TransportState) => void} cb @returns {() => void} */
  onState(cb) { this._onState.push(cb); return () => { this._onState = this._onState.filter(f => f !== cb); }; }
  /** Fires on every welcome (first connect AND reconnects) with welcome.node — the re-hydration hook. */
  /** @param {(node:TransportBody|null, welcome:TransportBody) => void} cb @returns {() => void} */
  onHydrate(cb) { this._onHydrate.push(cb); return () => { this._onHydrate = this._onHydrate.filter(f => f !== cb); }; }
  /** @param {Record<string, unknown>} p */
  setPreflight(p) { Object.assign(this.preflight, p || {}); }
  /** @param {(() => StatusBody)|null} fn */
  setStatusProvider(fn) { this.statusProvider = fn; }
  close() {
    this.closed = true;
    this._abortInFlight('transport closed', 'closed');
    this._setState('offline');
  }
  /** F153c: "the network just came back" -- the platform told the app connectivity changed (app.js wires
   *  Capacitor's Network plugin to this), or the player asked for it by hand. Whatever we are sitting on
   *  is worthless now: a backoff timer counting down, or a dial hanging on an address that had no route
   *  while the radio was down. Drop it, reset the backoff, and dial from the TOP of the ladder (pub
   *  first) this instant. A pending connect() promise is kept -- this IS that dial, restarted.
   *  No-op while there is a live link (open/bound), or once MC refused us / we were closed.
   *  @returns {boolean} whether a dial was actually kicked */
  dialNow() {
    if (this.closed || this.state === 'bound' || this.state === 'open' || this.state === 'rejected') return false;
    if (!this.url && !this.pub) return false;
    this._abortInFlight();
    this.attempt = 0;
    this._log('dial now (network change / manual)');
    this._open();
    return true;
  }
  /** Alias: app.js's network listener reads better as `kick()`. */
  kick() { return this.dialNow(); }
  /** Test/diagnostic hook: drop the link as if we walked out of range (reconnect loop continues). */
  dropLink() { const ws = this._ws; if (ws) { try { ws.close(4002, 'drop'); } catch (_) { /* ignore */ } } }

  // ---------- internals ----------
  /** Tear down the dial/probe in flight WITHOUT touching the held {url, pub, secret}, the ring or the
   *  clock. Handlers are detached before close so a dying socket's onclose cannot schedule a reconnect
   *  behind the caller's back. `rejectReason` also settles a pending connect() promise (F153b: a new
   *  connect() supersedes the old one) -- pass null when the caller is about to re-dial for that same
   *  promise (dialNow), and the connect() timeout is then left running. */
  /** @param {string|null} [rejectReason] @param {string} [wsReason] */
  _abortInFlight(rejectReason = null, wsReason = 'redial') {
    // `_clearTimers()` CANCELS `_connectTimer`, and putting the handle back afterwards does not un-cancel
    // it -- a kept promise would then never settle either way (review pass 1: dialNow() at 50 ms left a
    // welcomeTimeoutMs=300 connect() still pending at 800 ms). Hide it from the clear, exactly as
    // `_onOngoingClose` does, so the timeout the caller is keeping keeps running.
    let keepConnectTimer = null;
    if (!rejectReason) { keepConnectTimer = this._connectTimer; this._connectTimer = null; }
    this._clearTimers(); this._clearPubRetry();
    this._connectTimer = keepConnectTimer;
    this._probeStale = false;
    if (this._probeGiveupTimer) { this.timers.clearTimeout(this._probeGiveupTimer); this._probeGiveupTimer = null; }
    if (this._probeWs) { const p = this._probeWs; this._probeWs = null; try { p.onopen = p.onmessage = p.onerror = p.onclose = null; p.close(); } catch (_) { /* ignore */ } }
    const ws = this._ws; this._ws = null; this._viaCurrent = null;
    if (ws) { try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(1000, wsReason); } catch (_) { /* ignore */ } }
    if (rejectReason && this._firstWelcome) { const p = this._firstWelcome; this._firstWelcome = null; p.reject(new Error('connect: ' + rejectReason)); }
  }
  /** @param {string} key @returns {string|null} */
  _persisted(key) { try { return this.storage.getItem(key) || null; } catch (_) { return null; } }
  /** @param {string} key @param {string} v */
  _store(key, v) { try { this.storage.setItem(key, v); } catch (_) { /* ignore */ } }
  /** @param {string} key */
  _remove(key) { try { this.storage.removeItem(key); } catch (_) { /* ignore */ } }
  /** @param {string} key @returns {string} */
  _persistedNodeId(key) {
    try { const v = this.storage.getItem(key); if (v) return v; const id = `node-${E.uid(10)}`; this.storage.setItem(key, id); return id; }
    catch (_) { return `node-${E.uid(10)}`; }
  }
  /** @returns {boolean} whether the held pub actually changed (including null <-> a url) */
  /** @param {string|null|undefined} pub @returns {boolean} */
  _setPub(pub) {
    const next = pub || null; const changed = next !== this.pub; this.pub = next;
    if (this.pub) this._store(this._pubKey, this.pub); else this._remove(this._pubKey);
    return changed;
  }
  /** @param {string|null|undefined} secret */
  _setSecret(secret) { this.secret = secret || null; if (this.secret) this._store(this._secretKey, this.secret); else this._remove(this._secretKey); }
  /** Forget a failed MC target. The LAN target is owned by app.js; this clears the transport's
   * persisted backhaul pair and its URL scope so a stale pub_url cannot resurrect on the next boot. */
  clearJoinTarget() {
    this._setPub(null); this._setSecret(null);
    this._pubUrl = null; this._remove(this._pubUrlKey);
  }
  /** A60: the trust keys held for this node_id, newest first (at most TRUST_KEYS_MAX: one per MC install
   *  this phone has joined). A store written for another node_id counts as empty.
   *  @returns {string[]} */
  trustKeys() { return this._trustStore().keys; }
  /** `proven_at[key]` = when that key last proved an MC (ms). @returns {{keys:string[], provenAt:Record<string, number>}} */
  _trustStore() {
    try {
      const v = JSON.parse(this._persisted(this._trustKeyKey) || 'null');
      if (!v || v.node_id !== this.nodeId || !Array.isArray(v.keys)) return { keys: [], provenAt: {} };
      const keys = v.keys.filter(validTrustKey).slice(0, TRUST_KEYS_MAX);
      /** @type {Record<string, number>} */ const provenAt = {};
      const raw = v.proven_at && typeof v.proven_at === 'object' ? v.proven_at : {};
      for (const k of keys) if (Number.isFinite(raw[k])) provenAt[k] = Number(raw[k]);
      return { keys, provenAt };
    } catch (_) { return { keys: [], provenAt: {} }; }
  }
  /** @param {string[]} keys @param {Record<string, number>} provenAt */
  _saveTrust(keys, provenAt) { this._store(this._trustKeyKey, JSON.stringify({ node_id: this.nodeId, keys, proven_at: provenAt })); }
  hasTrustKey() { return this.trustKeys().length > 0; }
  /** A new key goes first and is always kept. Over TRUST_KEYS_MAX one older key goes: an unproven one
   *  first (the oldest), else the one that proved an MC least recently.
   *  @param {unknown} key */
  _storeTrustKey(key) {
    if (!validTrustKey(key)) return;
    const k = /** @type {string} */ (key);
    const { keys, provenAt } = this._trustStore();
    if (keys.includes(k)) return;
    const next = [k, ...keys];
    while (next.length > TRUST_KEYS_MAX) {
      const older = next.slice(1);
      const unproven = older.filter(x => !(x in provenAt));
      const victim = unproven.length ? unproven[unproven.length - 1]
        : older.reduce((a, b) => (provenAt[b] < provenAt[a] ? b : a));
      next.splice(next.indexOf(victim), 1);
      delete provenAt[victim];
    }
    this._saveTrust(next, provenAt);
  }
  /** F346 (a): the host this Transport dials (its LAN url's host:port), which keys the enrol nonce.
   *  @returns {string} */
  _enrollHost() { return String(((this.url || '').match(/\/\/([^/?#]+)/) || [])[1] || '').toLowerCase(); }
  /** @returns {{node_id:string, hosts:Record<string, string>}} */
  _enrollNonces() {
    try {
      const v = JSON.parse(this._persisted(this._enrollNonceKey) || 'null');
      if (v && v.node_id === this.nodeId && v.hosts && typeof v.hosts === 'object') return { node_id: this.nodeId, hosts: { ...v.hosts } };
    } catch (_) { /* start clean */ }
    return { node_id: this.nodeId, hosts: {} };
  }
  /** F346 (a): this node's enrol nonce FOR THIS MC HOST, minted once per host and kept until that host's
   *  trust key arrives. Per host, so a hostile host the player names never receives the nonce another
   *  MC holds, and cannot use it to collect that MC's key. Null when there is no randomness or no host
   *  (the hello then asks the A60 way, and a lost welcome costs one tap).
   *  @returns {string|null} */
  _enrollNonce() {
    const host = this._enrollHost();
    if (!host) return null;
    const v = this._enrollNonces();
    const have = v.hosts[host];
    if (typeof have === 'string' && have) return have;
    let nonce;
    try { nonce = newChallenge(this.randomBytes); } catch (_) { return null; }
    const hosts = Object.keys(v.hosts);
    if (hosts.length >= ENROLL_NONCE_HOSTS_MAX) delete v.hosts[hosts[0]];   // oldest host first
    v.hosts[host] = nonce;
    this._store(this._enrollNonceKey, JSON.stringify(v));
    return nonce;
  }
  _clearEnrollNonce() {
    const v = this._enrollNonces();
    delete v.hosts[this._enrollHost()];
    this._store(this._enrollNonceKey, JSON.stringify(v));
  }
  /** @param {string} key */
  _markProven(key) {
    const { keys, provenAt } = this._trustStore();
    if (keys.includes(key)) this._saveTrust(keys, { ...provenAt, [key]: this.now() });
  }
  /** A60: the welcome on a verify dial did not prove this is the MC we trust. Close at once, process
   *  nothing, store nothing, and settle connect() with `code: 'mc_unproven'` so the app can say why.
   *  @param {'no_proof'|'bad_proof'|'no_random'} why */
  _failVerify(why) {
    this.verifyFailed = why; this.closed = true;
    const p = this._firstWelcome; this._firstWelcome = null;
    this._abortInFlight(null, 'unproven');
    if (this._connectTimer) { this.timers.clearTimeout(this._connectTimer); this._connectTimer = null; }
    this._setState('offline');
    if (p) p.reject(Object.assign(new Error(`connect: mission control not proven (${why})`), { code: 'mc_unproven' }));
  }
  /** A60: the proof checked out. From here this is a trusted dial, and the url-scope rule every other
   *  connect() applies at the dial (A28.2) applies now: a pub/secret held for another address goes. */
  _onVerified() {
    this.verify = false; this._challenge = null; this.trusted = true;
    if (this.url && this._pubUrl && normUrl(this.url) !== normUrl(this._pubUrl)) { this._setPub(null); this._setSecret(null); }
    if (this.url) { this._pubUrl = this.url; this._store(this._pubUrlKey, this.url); }
  }
  /** A28.3: MC handed us a (possibly changed, possibly null) pub. `null` = the tunnel went down. A
   *  newly (or differently) learned pub is probed on the very next chance (`_kickPubRetry`), not left
   *  to wait out a stale PUB_RETRY_MS countdown — "prefer backhaul when offered" means offered NOW.
   *  A pub that changes WHILE a probe is already in flight (that probe is now checking a value we no
   *  longer want) is re-checked the moment it settles (`_probeStale`); `pub:null` aborts it outright —
   *  there is nothing left to probe for. */
  /** @param {string|null|undefined} pub */
  _adoptPub(pub) {
    const changed = this._setPub(pub);
    if (!this.pub) {
      this._clearPubRetry();
      if (this._probeWs) {
        const ws = this._probeWs; this._probeWs = null; this._probeStale = false;
        if (this._probeGiveupTimer) { this.timers.clearTimeout(this._probeGiveupTimer); this._probeGiveupTimer = null; }
        try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); } catch (_) { /* ignore */ }
      }
      if (this.reach === 'backhaul') {
        // the tunnel we're riding just went away — fall back to the LAN via the normal reconnect loop
        this._log('backhaul tunnel down — falling back to LAN');
        this.dropLink();
      }
      return;
    }
    if (changed) {
      this._pubJustLearned = true;
      if (this._probeWs) this._probeStale = true;   // an in-flight probe is checking the OLD value — recheck the new one once it settles
    }
  }
  /** @param {string|undefined} secret */
  _adoptSecret(secret) { if (secret !== undefined) this._setSecret(secret); }
  /** @param {...unknown} a */
  _log(...a) {
    const runtime = /** @type {typeof globalThis & {__BRX_TRANSPORT_DEBUG?: unknown}} */ (globalThis);
    if (runtime.__BRX_TRANSPORT_DEBUG) console.log('[transport]', ...a);
  }
  /** @param {TransportState} s */
  _setState(s) { if (this.state === s) return; this.state = s; for (const cb of this._onState) { try { cb(s); } catch (e) { this._log('onState cb', e); } } }
  _clearTimers() {
    /** @type {Array<'_hbTimer'|'_rcTimer'|'_helloTimer'|'_syncTimer'|'_connectTimer'>} */
    const keys = ['_hbTimer', '_rcTimer', '_helloTimer', '_syncTimer', '_connectTimer'];
    for (const k of keys) { if (this[k]) { this.timers.clearTimeout(this[k]); this[k] = null; } }
  }
  _clearPubRetry() { if (this._pubRetryTimer) { this.timers.clearTimeout(this._pubRetryTimer); this._pubRetryTimer = null; } }
  /** @param {DialVia} via @returns {TransportBody} */
  _helloBody(via) {
    return {
      node_id: this.nodeId, node_type: this.nodeType, app_ver: this.appVer, platform: this.platformName(), via,   // A29 + A28.3
      // A60: a verify dial asks MC to prove itself; every other phone dial asks for its trust key (MC
      // issues one per node_id, once).
      ...(this.verify && this._challenge ? { mc_challenge: this._challenge } : {}),
      ...(!this.verify && this.nodeType === 'phone' ? { mc_enroll: true, ...((n => n ? { mc_enroll_nonce: n } : {})(this._enrollNonce())) } : {}),
      ...(this.secret && this.trusted ? { secret: this.secret } : {}),
      gun: this.gun ? { name: this.gun.name, tail: this.gun.tail, ...(this.gun.fw ? { fw: this.gun.fw } : {}) } : undefined,
      seq_next: this.ring.seqNext, ...(this.nodeKey && this.trusted ? { node_key: this.nodeKey } : {}),
      ...(this.priorUtility && this.trusted ? { prior_utility: this.priorUtility } : {}),
    };
  }
  _open() {
    if (this.closed) return;
    this._setState('connecting');
    // A60: a verify dial goes to the address it was given, never to the tunnel of the MC we trust.
    if (this.pub && !this.verify) this._dialVia('backhaul', this.pub);
    else this._dialVia('lan', this.url);
  }
  /** Dial one URL as the primary/live socket. `via` is 'lan' or 'backhaul' — A28.3 policy: a 'backhaul'
   *  attempt that fails before welcoming (giveup timeout, immediate error/close, any close code other
   *  than an outright refusal) falls straight to the LAN url with no backoff consumed; a 'lan' attempt
   *  (or a post-welcome drop of either) goes through the normal offline/reconnect loop. */
  /** @param {DialVia} via @param {string|null} url */
  _dialVia(via, url) {
    if (!url) { this._log('dial skipped: no url'); this._setState('offline'); this._scheduleReconnect(); return; }
    let ws;
    try { ws = this.wsFactory(url); } catch (e) {
      this._log('ws factory', e);
      if (via === 'backhaul') { this._dialVia('lan', this.url); return; }
      this._scheduleReconnect(); return;
    }
    this._ws = ws; this._viaCurrent = via;
    // Arm the giveup the INSTANT we start dialling, not just after onopen: a dial that accepts the TCP
    // connection but never completes the websocket upgrade, or blackholes entirely (a dead tunnel
    // hostname still in DNS, cellular dropping packets to the edge, a LAN address with no route from
    // this phone), fires neither onopen NOR onclose -- an onopen-armed timer would never even get armed,
    // and the phone would sit offline for the OS connect timeout (~2 min on Android) with a working path
    // one hop away. On expiry with the socket never opened we don't wait on `dropLink()` (which depends
    // on an onclose that, for exactly this kind of dial, may never come) -- close it ourselves.
    // F153a: BOTH legs get this. backhaul -> fall straight to the LAN url (no backoff consumed);
    // lan -> end the pass and let the reconnect loop start the next one, which dials pub first whenever
    // one is held. So the ladder really is pub -> lan -> pub, bounded by LAN_GIVEUP_MS, not by Android.
    this._helloTimer = this.timers.setTimeout(() => {
      if (this._ws !== ws || this.state !== 'connecting') return;
      this._helloTimer = null; this._ws = null;
      try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); } catch (_) { /* ignore */ }
      if (via === 'backhaul') { this._log('backhaul giveup, falling back to LAN'); this._dialVia('lan', this.url); return; }
      this._log(this.pub ? 'lan giveup — the next pass dials pub' : 'lan giveup');
      this._setState('offline'); this._scheduleReconnect();
    }, via === 'backhaul' ? this.backhaulGiveupMs : this.lanGiveupMs);
    ws.onopen = () => {
      if (ws !== this._ws) return;
      this.attempt = 0;
      if (this.verify) {   // A60: a fresh challenge per socket, so a recorded proof can never be replayed
        try { this._challenge = newChallenge(this.randomBytes); } catch (_) { this._failVerify('no_random'); return; }
      }
      const hello = this._helloBody(via);
      this._priorUtilityOffered = !!hello.prior_utility;
      this._enrollSent = hello.mc_enroll === true;
      this._sendRaw(E.makeEnvelope('hello', hello), ws);
      // 'backhaul': the giveup timer armed above already covers "no welcome in time" -- nothing to re-arm.
      // 'lan': the socket is open, so the pre-open giveup has done its job -- clear it (leaving it armed
      // would close a perfectly good socket mid-hydration) and swap in the shorter welcome timeout.
      if (via === 'lan') {
        if (this._helloTimer) { this.timers.clearTimeout(this._helloTimer); this._helloTimer = null; }
        this._helloTimer = this.timers.setTimeout(() => { if (this._ws === ws && this.state === 'connecting') { this._log('welcome timeout'); this.dropLink(); } }, this.helloTimeoutMs);
      }
    };
    ws.onmessage = evt => { if (ws === this._ws) this._onFrame(typeof evt.data === 'string' ? evt.data : String(evt.data)); };
    ws.onerror = () => { /* onclose follows, or (a true blackhole) the giveup above fires */ };
    ws.onclose = evt => {
      if (ws !== this._ws) return; this._ws = null;
      if (this._helloTimer) { this.timers.clearTimeout(this._helloTimer); this._helloTimer = null; }
      const code = evt && evt.code;
      if (code === 4001 || code === 4003) { this._onOngoingClose(evt); return; }
      if (via === 'backhaul' && this.state === 'connecting') {
        // never welcomed over pub (giveup, immediate error/refusal-that-isn't-4001/4003) -> LAN, now
        this._dialVia('lan', this.url); return;
      }
      this._onOngoingClose(evt);
    };
  }
  /** The server REFUSED us (version mismatch / node or gun already in use — contracts A8), or an
   *  ordinary drop of an already-welcomed link. Shared by every socket this Transport ever owns. */
  /** @param {CloseEventLike} evt */
  _onOngoingClose(evt) {
    const code = evt && evt.code;
    // A 4003 on an UNTRUSTED dial is very often us: the hello was keyless by design, and MC still holds
    // a live record for this node_id from the socket we just lost. That holder goes stale in
    // STALE_AFTER_MS and is then displaced with no key at all (A8.2) — so one patient retry turns a
    // dead end ("MC REFUSED: gun or node in use", with no way forward but clearing app data) into a
    // join that lands ~10 s later. A trusted dial keeps the old behaviour: refusal is authoritative.
    if (code === 4003 && !this.trusted && !this._reclaimTried && !this.closed) {
      this._reclaimTried = true;
      this._log(`4003 while untrusted — waiting out the stale window (${this.reclaimRetryMs} ms), then one more try`);
      this._clearTimers();
      // ...and the pending connect() must not reject part-way through a wait WE scheduled: the stale
      // window (9.5 s) sits just under the default welcome timeout (10 s), so the HUD used to log "no
      // welcome within 10000 ms" over a join that then landed a second later. Give it the wait plus a
      // full welcome window, measured from now.
      this._armConnectTimeout(this.reclaimRetryMs + this.welcomeTimeoutMs);
      this._setState('offline');
      if (!this._rcTimer) this._rcTimer = this.timers.setTimeout(() => { this._rcTimer = null; this._open(); }, this.reclaimRetryMs);
      return;
    }
    if (code === 4001 || code === 4003) {
      this.rejected = { code, reason: (evt && evt.reason) || (code === 4003 ? 'gun or node in use' : 'protocol version') };
      this.closed = true; this._clearTimers();
      if (this._firstWelcome) { const p = this._firstWelcome; this._firstWelcome = null; p.reject(new Error(`MC refused: ${this.rejected.reason} (${code})`)); }
      this._log('refused by MC', this.rejected); this._setState('rejected'); return;
    }
    const ct = this._connectTimer; this._connectTimer = null; this._clearTimers(); this._connectTimer = ct; this._setState('offline'); this._scheduleReconnect();
  }
  _scheduleReconnect() {
    if (this.closed || this._rcTimer) return;
    this.attempt++; this.reconnects++;
    const { baseMs, capMs, jitter } = this.backoff;
    const raw = Math.min(capMs, baseMs * 2 ** Math.min(this.attempt - 1, 16));
    const delay = raw * (1 - jitter + 2 * jitter * this.random());
    this._rcTimer = this.timers.setTimeout(() => { this._rcTimer = null; this._open(); }, delay);
  }
  /** A28.3: while riding the LAN with a pub in hand, re-check every PUB_RETRY_MS whether pub is
   *  reachable. A side-channel probe — the LAN socket (`this._ws`) stays primary and untouched unless/
   *  until the probe actually proves pub is up, at which point it drops LAN and lets the normal dial
   *  ladder (which already prefers pub) take it from there. */
  _schedulePubRetry() {
    this._clearPubRetry();
    if (this.state !== 'bound' || this.reach !== 'lan' || !this.pub) return;
    this._pubRetryTimer = this.timers.setTimeout(() => this._probePub(), this.pubRetryMs);
  }
  /** Call after adopting a pub (welcome.join or an MC->node `join` push): a newly/differently learned
   *  pub is probed right now — "prefer backhaul when offered" means offered NOW, not on the next
   *  PUB_RETRY_MS tick — while an unchanged pub (an ordinary re-welcome) just keeps the normal cadence. */
  _kickPubRetry() {
    const immediate = this._pubJustLearned; this._pubJustLearned = false;
    if (!immediate) { this._schedulePubRetry(); return; }
    this._clearPubRetry();
    if (this.state !== 'bound' || this.reach !== 'lan' || !this.pub) return;
    this._probePub();
  }
  /** A28.3: is pub reachable at all — a REACHABILITY CHECK ONLY. Deliberately never sends hello: MC's
   *  node registry is one-socket-per-node, so a hello from this node_id/node_key here would make MC
   *  hand the connection over and close the LAN socket server-side, immediately, before any client-side
   *  "wait for welcome, then switch" logic could run — dropping a perfectly good LAN link (including
   *  mid-match) on nothing more than the probe finding pub alive. Instead: open the socket, and on
   *  `onopen` (the websocket upgrade succeeded — pub answers) close it right back with 1000 'probe' and
   *  drop the LAN link so the ORDINARY dial ladder (already pub-first) claims the node the one correct
   *  way. If it errors or closes before ever opening, do nothing and let the normal PUB_RETRY_MS cadence
   *  continue — that giveup window also covers a socket that opens but never even completes the upgrade
   *  in time. */
  _probePub() {
    this._pubRetryTimer = null;
    if (this.state !== 'bound' || this.reach !== 'lan' || !this.pub || this._probeWs) return;
    let ws;
    try { ws = this.wsFactory(this.pub); } catch (e) { this._log('pub probe ws factory', e); this._schedulePubRetry(); return; }
    this._probeWs = ws;
    let done = false;
    /** @param {boolean} reachable */
    const finish = reachable => {
      if (done) return; done = true;
      if (this._probeGiveupTimer) { this.timers.clearTimeout(this._probeGiveupTimer); this._probeGiveupTimer = null; }
      this._probeWs = null;
      const stale = this._probeStale; this._probeStale = false;
      if (stale) { this._probePub(); return; }   // pub changed mid-flight — this result is about the OLD value; check the current one now
      if (reachable) { this._log('pub reachable — dropping LAN so the dial ladder claims it over pub'); this.dropLink(); }
      else this._schedulePubRetry();
    };
    this._probeGiveupTimer = this.timers.setTimeout(() => {
      try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); } catch (_) { /* ignore */ }
      finish(false);
    }, this.backhaulGiveupMs);
    ws.onopen = () => {
      // reachable — prove it and stop. No hello: this is not a session, just a probe.
      try { ws.onmessage = ws.onerror = ws.onclose = null; ws.close(1000, 'probe'); } catch (_) { /* ignore */ }
      finish(true);
    };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = () => finish(false);
    ws.onmessage = () => { /* no hello was ever sent — nothing meaningful can arrive here */ };
  }
  /** @param {TransportEnvelope} env @param {TransportSocket|null} [ws] @returns {boolean} */
  _sendRaw(env, ws = this._ws) {
    if (!ws) return false;
    try { ws.send(E.encode(env)); this.stats.sent++; return true; } catch (e) { this._log('send', e); return false; }
  }
  /** @param {string} kind @param {TransportBody} body @returns {boolean} */
  _sendKind(kind, body) { return this._sendRaw(E.makeEnvelope(kind, body, { t: this.syncedNow() })); }
  /** @param {string} text */
  _onFrame(text) {
    let env;
    try { env = E.decode(text, 'mc'); } catch (e) { this.stats.malformed++; this._log('bad MC frame', e instanceof Error ? e.message : String(e)); return; }
    this.stats.received++;
    const { kind, body } = env;
    if (kind === 'welcome') return this._onWelcome(body);
    if (this.verify) return;   // A60: an unproven host gets nothing processed, not even an ack
    if (kind === 'ack') { this.ring.prune(Number(body.seq_hi)); return; }
    if (kind === 'time_res') { this.clock.sample(Number(body.t_node), Number(body.server_t), this.now()); }
    if (kind === 'assign') { this._absorb({ player: body.player, team: body.team, roster: body.roster }); }
    if (kind === 'config') { this._absorb({ config: body.config, frames: body.frames, roster: body.roster }); }
    if (kind === 'start') { this._absorb({ start: body, match_id: body.match_id }); }
    if (kind === 'join') {
      this._adoptSecret(typeof body.secret === 'string' ? body.secret : undefined);
      this._adoptPub(typeof body.pub === 'string' || body.pub === null ? body.pub : undefined);
      this._kickPubRetry();
    }
    if (DELIVERED.has(kind)) for (const cb of this._onMessage) { try { cb({ kind, body, t: env.t, id: env.id }); } catch (e) { this._log('onMessage cb', e); } }
  }
  /** @param {TransportBody} body */
  _onWelcome(body) {
    // A60: FIRST, before any timer, key, secret, join target, hydrate, bind or delivery: on a verify
    // dial the welcome must prove it came from the MC install whose trust key we hold.
    if (this.verify) {
      if (typeof body.mc_proof !== 'string' || !body.mc_proof) { this._failVerify('no_proof'); return; }
      const proven = this._challenge ? matchingKey(this.trustKeys(), body.mc_proof, this._challenge, body.session_id) : null;
      if (!proven) { this._failVerify('bad_proof'); return; }
      this._onVerified(); this._markProven(proven);
    }
    if (this._helloTimer) { this.timers.clearTimeout(this._helloTimer); this._helloTimer = null; }
    if (this._connectTimer) { this.timers.clearTimeout(this._connectTimer); this._connectTimer = null; }
    // A28.2: pub/secret are session-scoped — a session change (MC restarted) invalidates whatever this node held.
    const sessionId = typeof body.session_id === 'string' && body.session_id ? body.session_id : null;
    if (sessionId && this._persistedSessionId && sessionId !== this._persistedSessionId) {
      this._setPub(null); this._setSecret(null);
    }
    // It welcomed us, so it speaks the M-NET protocol and is the MC we dialled: the next hello may carry
    // the key (a keyless hello cannot take a still-live node_id back, A8.2) and the secret.
    this.trusted = true; this._reclaimTried = false;
    // A60: MC's trust key for this node (issued once per node_id). Only a user-named, remembered or
    // proof-verified dial ever reaches this line, so the key comes from a host the phone had reason to trust.
    // ...and only when THIS socket's hello asked for it (`mc_enroll`): a key nobody asked for is ignored.
    const trust = objectBody(body.mc_trust);
    if (trust && this._enrollSent && validTrustKey(trust.key)) {
      this._storeTrustKey(trust.key);
      this._clearEnrollNonce();   // F346 (a): this host's key arrived; its next enrol mints a fresh nonce
    }
    if (sessionId) { this._persistedSessionId = sessionId; this._store(this._sessionKey, sessionId); }
    this.sessionId = sessionId;
    this.priorUtilityConsumed = this._priorUtilityOffered && body.prior_utility_consumed === true;
    if (this.priorUtilityConsumed) this.priorUtility = null;   // one-shot proof: never replay it on a later reconnect
    if (typeof body.node_key === 'string' && body.node_key) { this.nodeKey = body.node_key; this._store(this._keyKey, body.node_key); }
    this.ring.adoptSeqHi(Number(body.seq_hi));
    this.clock.newBurst(); this.clock.seed(Number(body.server_t), this.now());
    this.reach = this._viaCurrent === 'backhaul' ? 'backhaul' : 'lan';   // A28.3: the live socket's path
    const join = objectBody(body.join);
    if (join) {
      this._adoptSecret(typeof join.secret === 'string' ? join.secret : undefined);
      this._adoptPub(typeof join.pub === 'string' || join.pub === null ? join.pub : undefined);
    }
    const node = objectBody(body.node);
    if (node) this._absorb(node);
    this._setState('open');
    this.bind();
    this._boundConnType = this.connectionType;   // F309: a socket stays on the network it was opened on
    this._setState('bound');
    for (let i = 0; i < 5; i++) this._sendKind('time_req', { t_node: this.now() });
    this._flush();
    this._startHeartbeat();
    this._syncTimer = this.timers.setTimeout(() => this._periodicSync(), this.syncIntervalMs);
    this._kickPubRetry();
    for (const cb of this._onHydrate) { try { cb(node, body); } catch (e) { this._log('onHydrate cb', e); } }
    if (this._firstWelcome) { const p = this._firstWelcome; this._firstWelcome = null; p.resolve(body); }
  }
  /** @param {TransportBody} node */
  _absorb(node) {
    Object.assign(this.context, node);
    const player = objectBody(node.player);
    if (player) {
      if (typeof player.player_id === 'string' && player.player_id) this.playerId = player.player_id;
      if (typeof player.player_num === 'number' && Number.isInteger(player.player_num)) this.playerNum = player.player_num;
    }
    if (typeof node.match_id === 'string' && node.match_id) this.matchId = node.match_id;
    const start = objectBody(node.start);
    if (start && typeof start.match_id === 'string' && start.match_id) this.matchId = start.match_id;
  }
  _flush() {
    const pending = this.ring.pending();
    for (let i = 0; i < pending.length; i += 200) {
      this.stats.batches++;
      this._sendKind('event_batch', { events: pending.slice(i, i + 200) });
    }
  }
  _startHeartbeat() {
    if (this._hbTimer) this.timers.clearTimeout(this._hbTimer);
    const tick = () => {
      this._hbTimer = null;
      if (this.state !== 'bound') return;
      if (this.statusProvider) {
        /** @type {StatusBody} */
        let b = {};
        try { b = this.statusProvider() || {}; } catch (e) { this._log('statusProvider', e); }
        this.status(b);
      }
      this._hbTimer = this.timers.setTimeout(tick, this.heartbeatMs);
    };
    this._hbTimer = this.timers.setTimeout(tick, 0);
  }
  _periodicSync() {
    this._syncTimer = null;
    if (this.state !== 'bound') return;
    this._sendKind('time_req', { t_node: this.now() });
    this._syncTimer = this.timers.setTimeout(() => this._periodicSync(), this.syncIntervalMs);
  }
}
