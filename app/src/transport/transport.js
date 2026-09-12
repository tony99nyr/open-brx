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

/** The MC kinds handed to `onMessage` subscribers (the engine, utility.js, app.js). A kind missing HERE
 *  decodes and validates perfectly and then goes nowhere — no error, no log, the feature simply never runs.
 *  That is the F105 trap (`station_config`: "MC never arms a station") and it caught `result` (A24) too.
 *  EXPORTED so `test/transport.test.mjs` can pin DELIVERED ⊇ every `case` in the engine's `onMcMessage`. */
export const DELIVERED = new Set(['assign', 'config', 'tutorial', 'start', 'feedback', 'control', 'apply', 'score', 'time_res', 'pull_log', 'loadout_ack', 'alert',
  'result',           // A24: the match result. Without this line the whole FINAL RESULTS screen is dead on the real wire.
  'station_config']); // A13.5 (F104/F105)

/** A28.2: a cosmetic-only difference (scheme/host case, a trailing '/') must not look like "a
 *  different MC" and wipe a held pub/secret -- normalize before comparing a stored url to a given one. */
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

export const BACKHAUL_GIVEUP_MS = 8000;   // A28.3: no welcome over pub within this -> fall back to the LAN url
export const PUB_RETRY_MS = 30000;        // A28.3: while riding the LAN with a pub in hand, re-probe it this often
/** F153a (field 2026-09-12): the LAN leg of the ladder needs the SAME pre-open giveup the backhaul leg
 *  got. A phone that is off the field Wi-Fi dials a LAN address no route can reach; Android's connect
 *  timeout is ~2 minutes and for those two minutes the pub we are holding is never tried again. Measured
 *  cost in the field: mobile data came back and the node took ~3 minutes to reappear, missing the rest of
 *  the match. With this the ladder is pub -> lan -> pub -> lan ..., with the ordinary backoff (cap 10 s)
 *  between full passes, so a data blip costs seconds. */
export const LAN_GIVEUP_MS = 8000;
/** Review pass 2: an UNTRUSTED dial (a JOIN-row address, so we withheld our node_key) can be refused
 *  `4003 in_use` for one reason that is not an attack and not a mistake: OUR OWN previous socket at that
 *  MC has not gone stale yet. A8.2 is explicit that a stale holder is displaced WITHOUT a key, so the fix
 *  is to wait out the stale window and try once more. Derived from the contract constant so the two
 *  cannot drift apart. Only ever spent once per connect(), and only while untrusted. */
export const RECLAIM_RETRY_MS = E.STALE_AFTER_MS + 1500;

export class Transport {
  /**
   * @param {object} o
   * @param {object} [o.storage]      localStorage-like; defaults to localStorage or memory
   * @param {function} [o.wsFactory]  url => WebSocket-like ({send, close, onopen/onmessage/onclose/onerror})
   * @param {{node_id?:string,node_type?:string,app_ver?:string,platform?:string}} [o.node]
   * @param {{name:string,tail:string,fw?:string}} [o.gun]   the advert name/tail (never the BLE deviceId)
   */
  constructor({ storage = defaultStorage(), wsFactory = url => new WebSocket(url), node = {}, gun = null,
                heartbeatMs = E.STATUS_HEARTBEAT_MS, now = () => Date.now(), timers = globalThis,
                random = Math.random, backoff = { baseMs: 500, capMs: 10000, jitter: 0.2 }, helloTimeoutMs = 5000,
                welcomeTimeoutMs = 10000, keyPrefix = 'brx', backhaulGiveupMs = BACKHAUL_GIVEUP_MS,
                pubRetryMs = PUB_RETRY_MS, lanGiveupMs = LAN_GIVEUP_MS, reclaimRetryMs = RECLAIM_RETRY_MS } = {}) {
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
    this.reach = null;                       // A28.3: 'lan' | 'backhaul' | null (not yet welcomed)
    this.nodeType = node.node_type || 'phone';
    // A29: the REAL build, baked by scripts/build.mjs — "<package version>+<sha>[-dirty]". A caller may
    // still name itself (utility.js does); nothing may fall back to a hand-written literal.
    this.appVer = node.app_ver || APP_VER;
    this.platform = node.platform || null;   // null = ask Capacitor per frame (the bridge appears late)
    this.gun = gun; this.playerId = null; this.playerNum = 0; this.matchId = null; this.sessionId = null;
    this.context = {};                       // last welcome.node / assign / config / start
    this.ring = new Ring({ storage, key: `${keyPrefix}.outbox`, now });
    this.clock = new Clock({ storage, key: `${keyPrefix}.clock`, now });
    // Review pass 1 (security): a url the USER never provided -- one the LAN sweep found by opening a
    // socket to it -- is an UNTRUSTED peer until it proves it is Mission Control by welcoming us. Any
    // host on the subnet can accept a websocket upgrade on the node port, and `hello` otherwise hands it
    // this node's takeover key (A8.2) and the join secret (A28.2). Both are stripped while untrusted.
    this.trusted = true; this._reclaimTried = false;
    this.armedOrLive = false;                // app sets true in ARMED/LIVE → reconnect is unbounded
    this.preflight = {};                     // app merges via setPreflight()
    this.statusProvider = null;              // app: () => status body (hp, armor, ammo, alive, shots, arm_state, ...)
    this.state = 'offline'; this.url = null; this.closed = false; this.attempt = 0; this.reconnects = 0; this.rejected = null;
    this.stats = { sent: 0, received: 0, malformed: 0, batches: 0 };
    this._ws = null; this._hbTimer = null; this._rcTimer = null; this._helloTimer = null; this._syncTimer = null;
    this._viaCurrent = null;                 // which url `this._ws` (the live/primary socket) dialled
    this._pubRetryTimer = null; this._probeWs = null; this._probeGiveupTimer = null;
    this._pubJustLearned = false; this._probeStale = false;
    this._onMessage = []; this._onState = []; this._onHydrate = [];
    this._firstWelcome = null;
  }

  // ---------- public API (net.md §6) ----------
  connect({ url, mdns, qr, pub, secret, trusted = true } = {}) {
    // F153b (field 2026-09-12): a new connect() SUPERSEDES whatever dial is already in flight. A QR
    // rescan after the tunnel restarted, a typed address, RECONNECT MC -- each hands us a new triple,
    // and the socket already connecting was aimed at the old one. Left alone it holds the slot until the
    // OS connect timeout (~2 min on Android), so the phone ignores the address the player just scanned.
    // Kill it (handlers detached first, so its onclose cannot schedule a reconnect behind us), settle the
    // old connect() promise, and dial the new target from the top of the ladder below.
    this._abortInFlight('superseded by a new connect()', 'reconnect');
    this.attempt = 0;
    this.trusted = trusted !== false;   // stays false until this peer welcomes us (see `trusted` above)
    this._reclaimTried = false;
    const nextUrl = url || qr || this.url;
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
  _armConnectTimeout(ms) {
    if (this._connectTimer) { this.timers.clearTimeout(this._connectTimer); this._connectTimer = null; }
    if (!this._firstWelcome) return;
    this._connectTimer = this.timers.setTimeout(() => {
      this._connectTimer = null;
      if (this._firstWelcome) { const p = this._firstWelcome; this._firstWelcome = null; p.reject(new Error('connect: no welcome within ' + ms + ' ms')); }
    }, ms);
  }
  bind({ player_id, gun } = {}) {
    if (gun && gun.name) this.gun = gun;      // gun linked AFTER connect (MC-first join order) — without this the bind never carried the gun (rig find, 2026-08-26)
    if (!this.gun) return;
    if (player_id) this.playerId = player_id;
    this._sendKind('bind', { node_id: this.nodeId, player_id: this.playerId, gun_name: this.gun.name, gun_tail: this.gun.tail });
  }
  /** Persist + (if bound) send a node-observed fact. NEVER blocks, NEVER throws when offline. */
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
  status(body = {}) {
    body.pending = this.ring.pending().length;   // lets MC know 'nothing left to flush' (recap finality, 2026-08-26)
    if (this.state !== 'bound') return false;
    // app_ver/platform ride EVERY heartbeat, not just the hello (A29): a phone that was updated and
    // relaunched mid-session keeps the same node_id, and MC's muster rollup must see the new build.
    const full = { node_id: this.nodeId, player_id: this.playerId, match_id: this.matchId, synced: this.synced(),
                   app_ver: this.appVer, platform: this.platformName(),
                   arm_state: 'connected', ...body, reach: this.reach,   // A28.3: the live socket's path, always ours to say
                   preflight: { ...this.preflight, ...(body.preflight || {}) } };
    const dropped = this.ring.takeDropped(); if (dropped) full.dropped = (full.dropped || 0) + dropped;
    return this._sendKind('status', full);
  }
  /** Non-fact uplink: ready | ack_config | log_offer | log_data | loadout_request | loadout_browse. Sent iff bound. */
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
  onMessage(cb) { this._onMessage.push(cb); return () => { this._onMessage = this._onMessage.filter(f => f !== cb); }; }
  onState(cb) { this._onState.push(cb); return () => { this._onState = this._onState.filter(f => f !== cb); }; }
  /** Fires on every welcome (first connect AND reconnects) with welcome.node — the re-hydration hook. */
  onHydrate(cb) { this._onHydrate.push(cb); return () => { this._onHydrate = this._onHydrate.filter(f => f !== cb); }; }
  setPreflight(p) { Object.assign(this.preflight, p || {}); }
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
  _persisted(key) { try { return this.storage.getItem(key) || null; } catch (_) { return null; } }
  _store(key, v) { try { this.storage.setItem(key, v); } catch (_) { /* ignore */ } }
  _remove(key) { try { this.storage.removeItem(key); } catch (_) { /* ignore */ } }
  _persistedNodeId(key) {
    try { const v = this.storage.getItem(key); if (v) return v; const id = `node-${E.uid(10)}`; this.storage.setItem(key, id); return id; }
    catch (_) { return `node-${E.uid(10)}`; }
  }
  /** @returns {boolean} whether the held pub actually changed (including null <-> a url) */
  _setPub(pub) {
    const next = pub || null; const changed = next !== this.pub; this.pub = next;
    if (this.pub) this._store(this._pubKey, this.pub); else this._remove(this._pubKey);
    return changed;
  }
  _setSecret(secret) { this.secret = secret || null; if (this.secret) this._store(this._secretKey, this.secret); else this._remove(this._secretKey); }
  /** A28.3: MC handed us a (possibly changed, possibly null) pub. `null` = the tunnel went down. A
   *  newly (or differently) learned pub is probed on the very next chance (`_kickPubRetry`), not left
   *  to wait out a stale PUB_RETRY_MS countdown — "prefer backhaul when offered" means offered NOW.
   *  A pub that changes WHILE a probe is already in flight (that probe is now checking a value we no
   *  longer want) is re-checked the moment it settles (`_probeStale`); `pub:null` aborts it outright —
   *  there is nothing left to probe for. */
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
  _adoptSecret(secret) { if (secret !== undefined) this._setSecret(secret); }
  _log(...a) { if (globalThis.__BRX_TRANSPORT_DEBUG) console.log('[transport]', ...a); }
  _setState(s) { if (this.state === s) return; this.state = s; for (const cb of this._onState) { try { cb(s); } catch (e) { this._log('onState cb', e); } } }
  _clearTimers() {
    for (const k of ['_hbTimer', '_rcTimer', '_helloTimer', '_syncTimer', '_connectTimer']) { if (this[k]) { this.timers.clearTimeout(this[k]); this[k] = null; } }
  }
  _clearPubRetry() { if (this._pubRetryTimer) { this.timers.clearTimeout(this._pubRetryTimer); this._pubRetryTimer = null; } }
  _helloBody(via) {
    return {
      node_id: this.nodeId, node_type: this.nodeType, app_ver: this.appVer, platform: this.platformName(), via,   // A29 + A28.3
      ...(this.secret && this.trusted ? { secret: this.secret } : {}),
      gun: this.gun ? { name: this.gun.name, tail: this.gun.tail, ...(this.gun.fw ? { fw: this.gun.fw } : {}) } : undefined,
      seq_next: this.ring.seqNext, ...(this.nodeKey && this.trusted ? { node_key: this.nodeKey } : {}),
    };
  }
  _open() {
    if (this.closed) return;
    this._setState('connecting');
    if (this.pub) this._dialVia('backhaul', this.pub);
    else this._dialVia('lan', this.url);
  }
  /** Dial one URL as the primary/live socket. `via` is 'lan' or 'backhaul' — A28.3 policy: a 'backhaul'
   *  attempt that fails before welcoming (giveup timeout, immediate error/close, any close code other
   *  than an outright refusal) falls straight to the LAN url with no backoff consumed; a 'lan' attempt
   *  (or a post-welcome drop of either) goes through the normal offline/reconnect loop. */
  _dialVia(via, url) {
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
      this._sendRaw(E.makeEnvelope('hello', this._helloBody(via)), ws);
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
  _sendRaw(env, ws = this._ws) {
    if (!ws) return false;
    try { ws.send(E.encode(env)); this.stats.sent++; return true; } catch (e) { this._log('send', e); return false; }
  }
  _sendKind(kind, body) { return this._sendRaw(E.makeEnvelope(kind, body, { t: this.syncedNow() })); }
  _onFrame(text) {
    let env;
    try { env = E.decode(text, 'mc'); } catch (e) { this.stats.malformed++; this._log('bad MC frame', e.message); return; }
    this.stats.received++;
    const { kind, body } = env;
    if (kind === 'welcome') return this._onWelcome(body);
    if (kind === 'ack') { this.ring.prune(Number(body.seq_hi)); return; }
    if (kind === 'time_res') { this.clock.sample(Number(body.t_node), Number(body.server_t), this.now()); }
    if (kind === 'assign') { this._absorb({ player: body.player, team: body.team, roster: body.roster }); }
    if (kind === 'config') { this._absorb({ config: body.config, frames: body.frames, roster: body.roster }); }
    if (kind === 'start') { this._absorb({ start: body, match_id: body.match_id }); }
    if (kind === 'join') { this._adoptSecret(body.secret); this._adoptPub(body.pub); this._kickPubRetry(); }
    if (DELIVERED.has(kind)) for (const cb of this._onMessage) { try { cb({ kind, body, t: env.t, id: env.id }); } catch (e) { this._log('onMessage cb', e); } }
  }
  _onWelcome(body) {
    if (this._helloTimer) { this.timers.clearTimeout(this._helloTimer); this._helloTimer = null; }
    if (this._connectTimer) { this.timers.clearTimeout(this._connectTimer); this._connectTimer = null; }
    // A28.2: pub/secret are session-scoped — a session change (MC restarted) invalidates whatever this node held.
    if (body.session_id && this._persistedSessionId && body.session_id !== this._persistedSessionId) {
      this._setPub(null); this._setSecret(null);
    }
    // It welcomed us, so it speaks the M-NET protocol and is the MC we dialled: the next hello may carry
    // the key (a keyless hello cannot take a still-live node_id back, A8.2) and the secret.
    this.trusted = true; this._reclaimTried = false;
    if (body.session_id) { this._persistedSessionId = body.session_id; this._store(this._sessionKey, body.session_id); }
    this.sessionId = body.session_id;
    if (typeof body.node_key === 'string' && body.node_key) { this.nodeKey = body.node_key; this._store(this._keyKey, body.node_key); }
    this.ring.adoptSeqHi(Number(body.seq_hi));
    this.clock.newBurst(); this.clock.seed(Number(body.server_t), this.now());
    this.reach = this._viaCurrent === 'backhaul' ? 'backhaul' : 'lan';   // A28.3: the live socket's path
    if (body.join && typeof body.join === 'object') { this._adoptSecret(body.join.secret); this._adoptPub(body.join.pub); }
    if (body.node && typeof body.node === 'object') this._absorb(body.node);
    this._setState('open');
    this.bind();
    this._setState('bound');
    for (let i = 0; i < 5; i++) this._sendKind('time_req', { t_node: this.now() });
    this._flush();
    this._startHeartbeat();
    this._syncTimer = this.timers.setTimeout(() => this._periodicSync(), this.syncIntervalMs);
    this._kickPubRetry();
    for (const cb of this._onHydrate) { try { cb(body.node || null, body); } catch (e) { this._log('onHydrate cb', e); } }
    if (this._firstWelcome) { const p = this._firstWelcome; this._firstWelcome = null; p.resolve(body); }
  }
  _absorb(node) {
    Object.assign(this.context, node);
    if (node.player && typeof node.player === 'object') {
      if (node.player.player_id) this.playerId = node.player.player_id;
      if (Number.isInteger(node.player.player_num)) this.playerNum = node.player.player_num;
    }
    if (node.match_id) this.matchId = node.match_id;
    if (node.start && typeof node.start === 'object' && node.start.match_id) this.matchId = node.start.match_id;
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
      if (this.statusProvider) { let b = {}; try { b = this.statusProvider() || {}; } catch (e) { this._log('statusProvider', e); } this.status(b); }
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
