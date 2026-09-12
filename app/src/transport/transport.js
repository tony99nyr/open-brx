// Node-side Transport — the M-NET client (docs/spec/contracts.md §5/§5a/§7 (the retired net.md §6 interface, archived at docs/archive/spec-net.md)).
// A pure state machine over a WebSocket-like object. The app owns the engine, HUD, BLE and the
// §3.10 resync; this owns the wire: hello/welcome hydration, bind, live-only status, the persisted
// fact ring + batch flush + ack prune, NTP-lite sync, reconnect with backoff.
//
// A28 backhaul (contracts §5d): when MC hands us a `pub` (its tunnel URL) alongside the LAN `url`,
// backhaul is PREFERRED — dialled first on every fresh attempt, with a LAN fallback if it doesn't
// welcome inside BACKHAUL_GIVEUP_MS; while riding the LAN with a pub in hand we re-probe it every
// PUB_RETRY_MS and switch over the moment it welcomes. With no pub the loop is exactly what it was.
import * as E from './envelope.js';
import { Ring, defaultStorage } from './ring.js';
import { Clock } from './clock.js';

const DELIVERED = new Set(['assign', 'config', 'tutorial', 'start', 'feedback', 'control', 'apply', 'score', 'time_res', 'pull_log', 'loadout_ack', 'alert', 'station_config']);

export const BACKHAUL_GIVEUP_MS = 8000;   // A28.3: no welcome over pub within this -> fall back to the LAN url
export const PUB_RETRY_MS = 30000;        // A28.3: while riding the LAN with a pub in hand, re-probe it this often

export class Transport {
  /**
   * @param {object} o
   * @param {object} [o.storage]      localStorage-like; defaults to localStorage or memory
   * @param {function} [o.wsFactory]  url => WebSocket-like ({send, close, onopen/onmessage/onclose/onerror})
   * @param {{node_id?:string,node_type?:string,app_ver?:string}} [o.node]
   * @param {{name:string,tail:string,fw?:string}} [o.gun]   the advert name/tail (never the BLE deviceId)
   */
  constructor({ storage = defaultStorage(), wsFactory = url => new WebSocket(url), node = {}, gun = null,
                heartbeatMs = E.STATUS_HEARTBEAT_MS, now = () => Date.now(), timers = globalThis,
                random = Math.random, backoff = { baseMs: 500, capMs: 10000, jitter: 0.2 }, helloTimeoutMs = 5000,
                welcomeTimeoutMs = 10000, keyPrefix = 'brx', backhaulGiveupMs = BACKHAUL_GIVEUP_MS,
                pubRetryMs = PUB_RETRY_MS } = {}) {
    this.storage = storage; this.wsFactory = wsFactory; this.now = now; this.timers = timers; this.random = random;
    this.backoff = backoff; this.helloTimeoutMs = helloTimeoutMs; this.heartbeatMs = heartbeatMs; this.welcomeTimeoutMs = welcomeTimeoutMs;
    this.backhaulGiveupMs = backhaulGiveupMs; this.pubRetryMs = pubRetryMs;
    this.syncIntervalMs = Math.min(5000, Math.floor(E.SYNC_FRESH_MS / 2));   // keep synced() fresh (SYNC_FRESH_MS = 10 s)
    this.nodeId = node.node_id || this._persistedNodeId(`${keyPrefix}.node_id`);
    this._keyKey = `${keyPrefix}.node_key`;
    this.nodeKey = this._persisted(this._keyKey);        // contracts A8: takeover key issued in welcome
    this._pubKey = `${keyPrefix}.pub`; this._secretKey = `${keyPrefix}.secret`; this._sessionKey = `${keyPrefix}.session_id`;
    this.pub = this._persisted(this._pubKey) || null;               // A28.2: the tunnel URL, session-scoped
    this.secret = this._persisted(this._secretKey) || null;         // A28.2: the QR's join secret, session-scoped
    this._persistedSessionId = this._persisted(this._sessionKey) || null;
    this.reach = null;                       // A28.3: 'lan' | 'backhaul' | null (not yet welcomed)
    this.nodeType = node.node_type || 'phone'; this.appVer = node.app_ver || 'app';
    this.gun = gun; this.playerId = null; this.playerNum = 0; this.matchId = null; this.sessionId = null;
    this.context = {};                       // last welcome.node / assign / config / start
    this.ring = new Ring({ storage, key: `${keyPrefix}.outbox`, now });
    this.clock = new Clock({ storage, key: `${keyPrefix}.clock`, now });
    this.armedOrLive = false;                // app sets true in ARMED/LIVE → reconnect is unbounded
    this.preflight = {};                     // app merges via setPreflight()
    this.statusProvider = null;              // app: () => status body (hp, armor, ammo, alive, shots, arm_state, ...)
    this.state = 'offline'; this.url = null; this.closed = false; this.attempt = 0; this.reconnects = 0; this.rejected = null;
    this.stats = { sent: 0, received: 0, malformed: 0, batches: 0 };
    this._ws = null; this._hbTimer = null; this._rcTimer = null; this._helloTimer = null; this._syncTimer = null;
    this._viaCurrent = null;                 // which url `this._ws` (the live/primary socket) dialled
    this._pubRetryTimer = null; this._probeWs = null; this._probeGiveupTimer = null;
    this._onMessage = []; this._onState = []; this._onHydrate = [];
    this._firstWelcome = null;
  }

  // ---------- public API (net.md §6) ----------
  connect({ url, mdns, qr, pub, secret } = {}) {
    this.url = url || qr || this.url;
    if (pub !== undefined) this._setPub(pub);
    if (secret !== undefined) this._setSecret(secret);
    if (!this.url) return Promise.reject(new Error('connect: no url (mdns is not implemented on the phone yet — scan the QR or type the address)'));
    this.closed = false; this.rejected = null;
    return new Promise((resolve, reject) => {
      this._firstWelcome = { resolve, reject };
      this._open();
      // Reject the connect() promise if no welcome ever arrives; the reconnect loop keeps running regardless.
      this._connectTimer = this.timers.setTimeout(() => { this._connectTimer = null; if (this._firstWelcome) { const p = this._firstWelcome; this._firstWelcome = null; p.reject(new Error('connect: no welcome within ' + this.welcomeTimeoutMs + ' ms')); } }, this.welcomeTimeoutMs);
    });
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
    const full = { node_id: this.nodeId, player_id: this.playerId, match_id: this.matchId, synced: this.synced(),
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
  syncedNow() { return this.clock.syncedNow(this.now()); }
  synced() { return this.clock.synced(this.now()); }
  onMessage(cb) { this._onMessage.push(cb); return () => { this._onMessage = this._onMessage.filter(f => f !== cb); }; }
  onState(cb) { this._onState.push(cb); return () => { this._onState = this._onState.filter(f => f !== cb); }; }
  /** Fires on every welcome (first connect AND reconnects) with welcome.node — the re-hydration hook. */
  onHydrate(cb) { this._onHydrate.push(cb); return () => { this._onHydrate = this._onHydrate.filter(f => f !== cb); }; }
  setPreflight(p) { Object.assign(this.preflight, p || {}); }
  setStatusProvider(fn) { this.statusProvider = fn; }
  close() {
    this.closed = true; this._clearTimers(); this._clearPubRetry();
    if (this._probeWs) { const p = this._probeWs; this._probeWs = null; try { p.onopen = p.onmessage = p.onerror = p.onclose = null; p.close(); } catch (_) { /* ignore */ } }
    if (this._firstWelcome) { const p = this._firstWelcome; this._firstWelcome = null; p.reject(new Error('connect: transport closed')); }
    const ws = this._ws; this._ws = null;
    if (ws) { try { ws.close(1000, 'closed'); } catch (_) { /* ignore */ } }
    this._setState('offline');
  }
  /** Test/diagnostic hook: drop the link as if we walked out of range (reconnect loop continues). */
  dropLink() { const ws = this._ws; if (ws) { try { ws.close(4002, 'drop'); } catch (_) { /* ignore */ } } }

  // ---------- internals ----------
  _persisted(key) { try { return this.storage.getItem(key) || null; } catch (_) { return null; } }
  _store(key, v) { try { this.storage.setItem(key, v); } catch (_) { /* ignore */ } }
  _remove(key) { try { this.storage.removeItem(key); } catch (_) { /* ignore */ } }
  _persistedNodeId(key) {
    try { const v = this.storage.getItem(key); if (v) return v; const id = `node-${E.uid(10)}`; this.storage.setItem(key, id); return id; }
    catch (_) { return `node-${E.uid(10)}`; }
  }
  _setPub(pub) { this.pub = pub || null; if (this.pub) this._store(this._pubKey, this.pub); else this._remove(this._pubKey); }
  _setSecret(secret) { this.secret = secret || null; if (this.secret) this._store(this._secretKey, this.secret); else this._remove(this._secretKey); }
  /** A28.3: MC handed us a (possibly changed, possibly null) pub. `null` = the tunnel went down. */
  _adoptPub(pub) {
    this._setPub(pub);
    if (!this.pub && this.reach === 'backhaul') {
      // the tunnel we're riding just went away — fall back to the LAN via the normal reconnect loop
      this._log('backhaul tunnel down — falling back to LAN');
      this.dropLink();
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
      node_id: this.nodeId, node_type: this.nodeType, app_ver: this.appVer, via,
      ...(this.secret ? { secret: this.secret } : {}),
      gun: this.gun ? { name: this.gun.name, tail: this.gun.tail, ...(this.gun.fw ? { fw: this.gun.fw } : {}) } : undefined,
      seq_next: this.ring.seqNext, ...(this.nodeKey ? { node_key: this.nodeKey } : {}),
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
    ws.onopen = () => {
      if (ws !== this._ws) return;
      this.attempt = 0;
      this._sendRaw(E.makeEnvelope('hello', this._helloBody(via)), ws);
      const timeoutMs = via === 'backhaul' ? this.backhaulGiveupMs : this.helloTimeoutMs;
      this._helloTimer = this.timers.setTimeout(() => { if (this._ws === ws && this.state === 'connecting') { this._log(via === 'backhaul' ? 'backhaul giveup, falling back to LAN' : 'welcome timeout'); this.dropLink(); } }, timeoutMs);
    };
    ws.onmessage = evt => { if (ws === this._ws) this._onFrame(typeof evt.data === 'string' ? evt.data : String(evt.data)); };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = evt => {
      if (ws !== this._ws) return; this._ws = null;
      const code = evt && evt.code;
      if (code === 4001 || code === 4003) { this._onOngoingClose(evt); return; }
      if (via === 'backhaul' && this.state === 'connecting') {
        // never welcomed over pub (giveup, immediate error/refusal-that-isn't-4001/4003) -> LAN, now
        if (this._helloTimer) { this.timers.clearTimeout(this._helloTimer); this._helloTimer = null; }
        this._dialVia('lan', this.url); return;
      }
      this._onOngoingClose(evt);
    };
  }
  /** The server REFUSED us (version mismatch / node or gun already in use — contracts A8), or an
   *  ordinary drop of an already-welcomed link. Shared by every socket this Transport ever owns. */
  _onOngoingClose(evt) {
    const code = evt && evt.code;
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
  /** A28.3: while riding the LAN with a pub in hand, re-try pub every PUB_RETRY_MS and switch over the
   *  moment it welcomes. A side-channel probe — the LAN socket (`this._ws`) stays primary and untouched
   *  unless/until the probe actually welcomes. */
  _schedulePubRetry() {
    this._clearPubRetry();
    if (this.state !== 'bound' || this.reach !== 'lan' || !this.pub) return;
    this._pubRetryTimer = this.timers.setTimeout(() => this._probePub(), this.pubRetryMs);
  }
  _probePub() {
    this._pubRetryTimer = null;
    if (this.state !== 'bound' || this.reach !== 'lan' || !this.pub || this._probeWs) return;
    let ws;
    try { ws = this.wsFactory(this.pub); } catch (e) { this._log('pub probe ws factory', e); this._schedulePubRetry(); return; }
    this._probeWs = ws;
    let done = false;
    const giveUp = () => {
      if (done) return; done = true;
      this._probeGiveupTimer = null; this._probeWs = null;
      try { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; ws.close(); } catch (_) { /* ignore */ }
      this._schedulePubRetry();
    };
    this._probeGiveupTimer = this.timers.setTimeout(giveUp, this.backhaulGiveupMs);
    ws.onopen = () => { this._sendRaw(E.makeEnvelope('hello', this._helloBody('backhaul')), ws); };
    ws.onerror = () => { /* onclose follows */ };
    ws.onclose = giveUp;
    ws.onmessage = evt => {
      if (done) return;
      const text = typeof evt.data === 'string' ? evt.data : String(evt.data);
      let env;
      try { env = E.decode(text, 'mc'); } catch (_) { return; }   // not a welcome yet (or malformed) — keep waiting for the giveup
      if (env.kind !== 'welcome') return;
      done = true;
      if (this._probeGiveupTimer) { this.timers.clearTimeout(this._probeGiveupTimer); this._probeGiveupTimer = null; }
      this._probeWs = null;
      this._switchTo(ws, env);
    };
  }
  /** The pub probe welcomed: adopt it as the primary socket, drop the LAN one (the ring covers the gap —
   *  anything not yet acked is in `this.ring` and `_onWelcome`'s `_flush()` re-sends it on the new link). */
  _switchTo(ws, welcomeEnv) {
    this._log('backhaul reachable — switching from LAN');
    const old = this._ws;
    this._clearTimers();                       // the LAN socket's heartbeat/sync/hello timers no longer apply
    this._viaCurrent = 'backhaul';
    this._ws = ws;
    ws.onopen = null;
    ws.onerror = () => { /* onclose follows */ };
    ws.onmessage = evt => { if (ws === this._ws) this._onFrame(typeof evt.data === 'string' ? evt.data : String(evt.data)); };
    ws.onclose = evt => { if (ws !== this._ws) return; this._ws = null; this._onOngoingClose(evt); };
    if (old) { try { old.onopen = old.onmessage = old.onerror = old.onclose = null; old.close(); } catch (_) { /* ignore */ } }
    this._onWelcome(welcomeEnv.body);
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
    if (kind === 'join') { this._adoptSecret(body.secret); this._adoptPub(body.pub); this._schedulePubRetry(); }
    if (DELIVERED.has(kind)) for (const cb of this._onMessage) { try { cb({ kind, body, t: env.t, id: env.id }); } catch (e) { this._log('onMessage cb', e); } }
  }
  _onWelcome(body) {
    if (this._helloTimer) { this.timers.clearTimeout(this._helloTimer); this._helloTimer = null; }
    if (this._connectTimer) { this.timers.clearTimeout(this._connectTimer); this._connectTimer = null; }
    // A28.2: pub/secret are session-scoped — a session change (MC restarted) invalidates whatever this node held.
    if (body.session_id && this._persistedSessionId && body.session_id !== this._persistedSessionId) {
      this._setPub(null); this._setSecret(null);
    }
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
    this._schedulePubRetry();
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
