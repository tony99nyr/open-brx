import './polyfills.js';   // FIRST: globalThis/Object.fromEntries/Promise#finally on a Chrome 60-72 WebView
import jsQR from 'jsqr';
// OS-level landscape lock: the HUD is a fixed 844x390 landscape stage — in portrait it scales to a
// postage stamp (Tony, 2026-08-26: 'the label wraps on my screen'). Boxed import (thenable trap).

// BRX Combat HUD — the per-player node (docs/spec/node.md, contracts A6).
// One phone, one gun, one player. Composition of: Engine (state machine) + BrxLink (BLE) +
// Transport (M-NET wire) + Hud (Phone HUD v2). Runs in a desktop browser with `?demo`.
import { Engine, C } from './engine.js';
import { BrxLink } from './brxlink.js';
import { GunPicker, ScanPacer, PAINT_MS, COALESCE_MS, PICKER_SCAN_MS, isHeadset } from './gunpicker.js';   // F258: the gun picker's ranked, stable, coalesced list
import { Transport, PRIOR_UTILITY_KEY, clearConsumedPriorUtilityHandoff } from './transport/transport.js';
import { Hud } from './hud/hud.js';
import { parseMcJoin } from './mcurl.js';
import { sweepPlan, localIpFrom, sweepForMc as sweepSubnetsForMc } from './transport/discover.js';   // F139
import { makeWsFactory } from './transport/netsocket.js';
import { Presence, encodeUuid, stationView, AdvertGate } from './beacon.js';   // utility items (docs/spec/utility.md)
import { playerClaimAdvert } from './powerup.js';                     // A56: the powerup claim bits on the player advert
import { BeaconWatch, stationsInPlay } from './scanwatch.js';                        // playtest 2026-09-13: one scan operation at a time, open only in a match
import { LogSync, chunkByBytes, DEFAULT_CHUNK_BYTES } from './logsync.js';   // background log sync (contracts A25)
import { APP_VER, platformName } from './build.js';                  // the REAL build id (contracts A29)
import { applyResult, HISTORY_MAX } from './history.js';             // per-match history + the A24 result patch
import { LogRing } from './logring.js';                              // T1-B: a match's own lines must survive to the recap pull
import { installTapHoldDoor } from './tapgate.js';                   // T2-B: taps AND a hold on the last, for the hidden utility-mode door

const $ = id => document.getElementById(id);
// T1-B (field 2026-09-12): a flat 400-line ring rolled a whole failing match's early lines out
// before MC's `pull_log` ever asked for them at the whistle. `LogRing` protects every line written
// since `startMatch()` — `logLines` stays the SAME array object for the life of the page (LogRing
// mutates it in place), so `window.brx.log` (stage harness, e2e, screens.mjs) keeps working exactly
// as an array, unaware anything changed underneath it.
const logRing = new LogRing();
const logLines = logRing.lines;
let _logRingMatchId = null;
function log(msg, cls = 'li') {
  const mid = engine.matchId;
  if (mid && mid !== _logRingMatchId) { _logRingMatchId = mid; logRing.startMatch(); }
  else if (!mid) { _logRingMatchId = null; }
  const t = new Date().toISOString().substr(11, 8);
  logRing.push(`[${t}] ${msg}`);
  if (cls === 'le') console.warn(msg);
}

// ---------- Capacitor plugins (all guarded: the web build must run in a desktop browser) ----------
const plugins = {};
const wsFactory = makeWsFactory();
async function loadPlugins() {
  // Capacitor plugin objects are PROXIES that intercept every property — including `.then`. If a promise
  // resolves WITH the proxy, `await` adopts it as a thenable, calls proxy.then() (a fake native method), and
  // the await never settles: the whole boot hung here on device AND web (found 2026-08-25 via playwright —
  // keep-awake/app-listener/auto-scan/demo all dead). So every import BOXES the plugin: resolve {v: Plugin}.
  const tryImport = async (name, fn) => { try { plugins[name] = (await fn()).v; } catch (e) { log(`plugin ${name} unavailable: ${e && e.message || e}`, 'li'); } };
  await Promise.all([
    tryImport('keepAwake', () => import('@capacitor-community/keep-awake').then(m => ({ v: m.KeepAwake }))),
    tryImport('orientation', () => import('@capacitor/screen-orientation').then(m => ({ v: m.ScreenOrientation }))),
    tryImport('haptics', () => import('@capacitor/haptics').then(m => ({ v: m }))),
    tryImport('device', () => import('@capacitor/device').then(m => ({ v: m.Device }))),
    tryImport('network', () => import('@capacitor/network').then(m => ({ v: m.Network }))),
    tryImport('app', () => import('@capacitor/app').then(m => ({ v: m.App }))),
    tryImport('share', () => import('@capacitor/share').then(m => ({ v: m.Share }))),
    tryImport('fs', () => import('@capacitor/filesystem').then(m => ({ v: m }))),
    tryImport('zeroconf', () => import('capacitor-zeroconf').then(m => ({ v: m.ZeroConf }))),
    tryImport('beacon', () => import('brx-beacon').then(m => ({ v: m.BrxBeacon }))),   // our advertise plugin (app/plugins/brx-beacon)
  ]);
}
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
async function keepAwake(on) { try { if (plugins.keepAwake) await (on ? plugins.keepAwake.keepAwake() : plugins.keepAwake.allowSleep()); } catch (_) { /* ignore */ } }
async function lockLandscape() { try { if (plugins.orientation) await plugins.orientation.lock({ orientation: 'landscape' }); } catch (_) { /* ignore */ } }
async function haptic(kind) {
  try {
    if (!plugins.haptics) return;
    const { Haptics, ImpactStyle, NotificationType } = plugins.haptics;
    if (kind === 'kill') await Haptics.notification({ type: NotificationType.Success });
    else if (kind === 'down') await Haptics.impact({ style: ImpactStyle.Heavy });
    else await Haptics.impact({ style: ImpactStyle.Light });
  } catch (_) { /* ignore */ }
}

// ---------- settings ----------
const settings = {
  get mcUrl() { try { return localStorage.getItem('brx.mc_url') || ''; } catch (_) { return ''; } },
  set mcUrl(v) { try { localStorage.setItem('brx.mc_url', v); } catch (_) { /* ignore */ } },
  // 'hud' (default) or 'utility': the same install is either a player's HUD or a utility item on the field
  get role() { try { return localStorage.getItem('brx.role') || 'hud'; } catch (_) { return 'hud'; } },
  set role(v) { try { localStorage.setItem('brx.role', v); } catch (_) { /* ignore */ } },
};
function priorUtilityHandoff() {
  try {
    const v = JSON.parse(localStorage.getItem(PRIOR_UTILITY_KEY) || 'null');
    return v && typeof v.node_id === 'string' && v.node_id && typeof v.node_key === 'string' && v.node_key ? v : null;
  } catch (_) { return null; }
}
function switchRole(role) { settings.role = role; location.replace(role === 'utility' ? 'utility.html' : 'index.html'); }

// ---------- wiring ----------
const hud = new Hud(document, {});
try { window.__hud = hud; } catch (_) { /* rig/screen-truth hook */ }
let transport = null;
const link = new BrxLink({
  log, onFrame: f => engine.feedFrame(f),
  onDrop: () => { engine.onBleDropped(); haptic('down'); },
  onUp: advert => {
    // F211 fix: a link that just came up (fresh connect, or the forever-reconnect loop's own success)
    // must close the picker if it is somehow still open, so the beacon scan (scanwatch.js) is free again.
    if (scanning) { scanning = false; stopPickerPaint(); hud.setScan([]); link.stopScan().catch(() => {}); }
    engine.onBleConnected(advert);
    if (transport) {
      transport.gun = { name: advert.name, tail: advert.tail, fw: engine.fw || undefined };
      if (transport.state === 'bound') { try { transport.bind({ player_id: engine.player && engine.player.player_id, gun: engine.gun ? { name: engine.gun.name, tail: engine.gun.tail, fw: engine.fw || undefined } : undefined }); } catch (_) { /* best-effort */ } }
    }
  },
  unbounded: () => engine.phase === 'armed' || engine.phase === 'live',
  onFlap: f => engine.setGunFlapping(f),
  onRelink: () => scheduleRender(),   // RELINK GUN reads RELINKING… and is disabled while a relink runs (bench 2026-09-17)
});
const engine = new Engine({
  writer: (frames, why, options) => link.write(frames, why, options),
  emit: fact => transport && transport.send(fact),
  report: (kind, body) => transport && transport.report(kind, body),
  now: () => transport ? transport.syncedNow() : Date.now(),
  synced: () => !!(transport && transport.synced()),
  // ?demo runs on a clean slate: no restore of a real session's match (the constructor loads storage, so this is the
  // only place that can stop it — a later clearPersisted() is too late; correctness review 2026-09-03), and nothing saved.
  storage: (() => { try { return new URLSearchParams(location.search).has('demo') ? null : localStorage; } catch (_) { return null; } })(),
  log, onChange: () => scheduleRender(),
});
engine.onRelink = () => (link.deviceId ? link.relink() : Promise.reject(new Error('no gun picked')));   // A47: MC's operator RELINK GUN, the HUD's own RELINK path
engine.onGunStale = () => link.noteStale();   // B4: the engine's silence watchdog forces BrxLink to actually cycle the radio
engine.sessionOf = () => (transport ? transport.sessionId : null);
engine.persistedSessionOf = () => (transport ? transport._persistedSessionId || null : null);   // pl3: before a restart's welcome lands, the last session MC gave us   // the HUD skin pick lasts one MC session (engine.setNight)
hud.mcUrl = settings.mcUrl;
// per-match history (bench request 2026-08-25): node-local, survives restarts, capped
try { hud.history = JSON.parse(localStorage.getItem('brx.history') || '[]'); } catch (_) { hud.history = []; }
engine.onEnd = (g) => { try { const h = hud.history || []; h.push({ ...g, session: transport ? transport.sessionId : null }); while (h.length > HISTORY_MAX) h.shift(); hud.history = h; localStorage.setItem('brx.history', JSON.stringify(h)); } catch (_) { /* best-effort */ } };   // `session`: the MC session the match belonged to — the result screen's tally is per session (Tony, 2026-09-04)
// A24: the result lands AFTER the whistle (often seconds, sometimes a rejoin later), so the entry written at the end
// carries `outcome:null` and is PATCHED by `match_id` — see src/history.js for which entry and what happens when
// there is none. The decision lives there because app.js cannot be imported in a test.
engine.onResult = (r) => { try {
  const { history, changed } = applyResult(hud.history || [], r, {
    ended: !!engine.ended, mode: (engine.config && engine.config.mode) || null,
    session: transport ? transport.sessionId : null,
  });
  if (!changed) return;
  hud.history = history; hud.sig = null; localStorage.setItem('brx.history', JSON.stringify(history)); scheduleRender();
} catch (_) { /* best-effort */ } };

// ---------- the diagnostic bundle + background log sync (contracts A25, node.md §3.14) ----------
// ONE builder for both routes: the manual SHARE LOG tap and MC's background `pull_log`. The BLE frame
// ring (brxlink keeps the last 60 in/out frames) is the only record of what the gun actually said, and
// without it a field fault on the phone side is undebuggable — so it rides along with the log tail.
function logSnapshot(from = 0) {
  const { tail, lost } = logRing.tail(from);             // lines the ring dropped before MC ever saw them
  let frames = [];
  try { frames = (link && link.frames || []).map(f => `${f.t} ${f.dir} ${f.f}`); } catch (_) { /* ignore */ }
  const text = [
    lost ? `--- ${lost} earlier line(s) rolled out of the ring before upload ---` : null,
    tail.join('\n'),
    '--- ble frames (last ' + frames.length + ') ---',
    frames.join('\n'),
    '--- ble beacon scan ---',
    (() => { try { return JSON.stringify(beaconWatch.stats()); } catch (_) { return '{}'; } })(),
    '--- engine state ---',
    (() => { try { return JSON.stringify(engine.state()); } catch (_) { return '{}'; } })(),
  ].filter(x => x !== null).join('\n');
  return { text, through: logRing.seq, lines: tail.length, frames: frames.length };
}
const logsync = new LogSync({
  transport: () => transport,
  snapshot: from => logSnapshot(from),
  phase: () => engine.phase,
  log,
  // F-4: the ring keeps the PREVIOUS match's lines until MC actually holds them. Only a completed
  // upload can say that, and this is the one place that knows an upload completed.
  onUploaded: through => logRing.pulled(through),
});

// ---------- utility items: watch for stations during a match, and advertise ourselves as a player ----------
// The beacon scan feeds Presence; the engine gets a snapshot every tick (utility.md §3). Nothing here blocks
// the match: with no plugin (desktop) or no stations in range the HUD behaves exactly as before. The scan
// policy (when it is open, how often it restarts, one operation at a time) lives in scanwatch.js.
const presence = new Presence({ defaultThreshold: -74, dwellMs: 800 });   // 0.8s dwell + -74 threshold: get-in-range, brief pause, green (bench-tuned 2026-09-04)
const stationWas = new Map();
// The match's game byte scopes presence to THIS game (beacon.js Presence `game` filter): a station that
// advertises a different non-zero game byte is ignored. 0 = "any game" on both sides (manual stations
// default to it), so this is best-effort until MC assigns stations — the `config.stations` allow-list is
// the primary scope. Derived from config_id so both this player and (later) an MC-assigned station agree.
function gameByte(id) { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) & 0xff; return h; }
const beaconWatch = new BeaconWatch({ link, log, native: isNative, onHit: hit => presence.observe(hit.uuids, hit.rssi, Date.now()) });
setInterval(() => {
  const st = engine.state();
  presence.game = st.config ? gameByte(st.config.config_id) : 0;   // scope presence to this game (best-effort; §utility)
  beaconWatch.tick(st, { pickerOpen: scanning || link.connecting, config: engine.config });   // no stations: no scan (bench 2026-09-17 flood); app 0.4.2: none while a connect is in flight
}, 1000);
async function stopAnyScan() {   // the picker owns the radio from here: `scanning` is already set, so the watch will not reopen
  await beaconWatch.release();
  if (link.scanning) await link.stopScan();
}
function presenceTick() {
  const now = Date.now();
  presence.tick(now);
  const list = presence.stations();
  for (const e of list) {   // log the edges, not the readings: the log is what a field fault gets debugged from
    const k = `${e.kind}:${e.id}`; const was = stationWas.get(k);
    if (was !== e.present) { stationWas.set(k, e.present); log(`${e.kind} station ${e.id} (team ${e.team === 255 ? 'any' : e.team}) ${e.present ? 'PRESENT' : 'left'} at ${Math.round(e.rssi)} dBm (threshold ${e.threshold || presence.defaultThreshold})`, e.present ? 'lk' : 'li'); }
  }
  engine.setStations(list);
}
const playerAdvertGate = new AdvertGate();   // polish H1: whole-UUID compare; a start counts only once it worked (beacon.js)
let playerAdvertBusy = false;                // one plugin call at a time: the 250 ms loop must not stack starts
async function syncPlayerAdvert() {
  if (!plugins.beacon || !isNative() || playerAdvertBusy) return;
  const st = engine.state();
  const num = st.playerNum, tid = engine.teamTid;
  // A56 (powerups): while this phone claims a station's item it adds `claiming`, then `claim_ready`, with the station id
  // in `value`, and advertises in low-latency mode so the station hears it inside the 1 s dwell.
  const claim = playerClaimAdvert(st.powerupClaim);
  // Only a utility station reads a player advert, so a game with no stations advertises nothing: every
  // other phone's scan would carry it over its own bridge for no reader (bench 2026-09-17 flood).
  const want = (num != null && tid != null && st.phase !== 'idle' && stationsInPlay(engine.config))
    ? encodeUuid({ role: 'player', id: num, team: tid, state: (st.alive ? 1 : 0) | claim.bits, value: claim.value, game: st.config ? gameByte(st.config.config_id) : 0 }) : null;
  const action = playerAdvertGate.due(want, Date.now());
  if (!action) return;
  playerAdvertBusy = true;
  try {
    if (action === 'start') {
      await plugins.beacon.start({ uuid: want, txPower: 'medium', mode: claim.mode });
      playerAdvertGate.started(want, Date.now());
      log(`advertising as player ${num} team ${tid}${st.alive ? '' : ' (down)'}${claim.bits ? ` · ${st.powerupClaim.ready ? 'CLAIM READY' : 'claiming'} station ${claim.value}` : ''}`, 'li');
    } else { await plugins.beacon.stop(); playerAdvertGate.stopped(); }
  } catch (e) {
    // ⚠ The gate records nothing for a failed call, so the next tick retries. The one that matters is the start that
    // clears the alive bit on death: a dead player whose advert still says alive=1 goes on converting a control point
    // for the whole death window, silently.
    playerAdvertGate.failed(action);
    log('player advert failed — the phone may still be broadcasting the previous one; retrying: ' + (e && e.message || e), 'le');
  } finally { playerAdvertBusy = false; }
}

// preflight (contracts A4.9). `bluetooth_on` (F211) is optional on the wire — an older MC that has never
// heard of it simply ignores an extra field, so this never needs a contract bump to ship.
const preflight = { ssid_ok: true, mc_reachable: false, auto_join_ok: true, cellular_off: true, dnd_on: false, phone_batt: null, screen_on: true, foreground: true, gun_linked: false, headset_ok: false, bluetooth_on: true };
async function refreshPreflight() {
  try { if (plugins.device) { const b = await plugins.device.getBatteryInfo(); if (b && b.batteryLevel != null) preflight.phone_batt = Math.round(b.batteryLevel * 100); } } catch (_) { /* ignore */ }
  // Report ssid_ok truthfully (contracts A28.3: MC itself downgrades this to a warning, not a red, for
  // a node reporting reach:"backhaul" — forcing it true here made that server-side downgrade dead code
  // and showed the board a phone that IS on the field Wi-Fi when it is not).
  try {
    if (plugins.network) {
      const s = await plugins.network.getStatus();
      preflight.ssid_ok = s.connectionType === 'wifi';
      if (transport) transport.setConnectionType(s.connectionType);   // F309: what MC counts as coverage
    }
  } catch (_) { /* ignore */ }
  preflight.mc_reachable = !!(transport && transport.state === 'bound');
  preflight.gun_linked = engine.bleUp; preflight.headset_ok = !!engine.headEcho;
  preflight.foreground = document.visibilityState !== 'hidden'; preflight.screen_on = preflight.foreground;
  await setBluetoothOn(await link.isEnabled());
  if (transport) transport.setPreflight(preflight);
}
// F211: one place both the poll (refreshPreflight, every 5 s) and the OS notification (watchEnabled,
// below) go through, so the picker screen, the diag panel and MC's ITEMS board never disagree.
function setBluetoothOn(on) {
  preflight.bluetooth_on = on; hud.bluetoothOn = on; hud.platform = platformName();
  return on;
}

/** Pending "we have been unbound for 15s" timer; see the onState handler in connectMc. It starts a
 *  sweep, which now only ever OFFERS what it finds (`suggestMc`) — so the `allowAssist` flag that used
 *  to gate auto-joining is gone with the thing it gated (review pass 2). */
let assistTimer = null;
/** The last URL we actually dialled — including a discovery-only one that `settings.mcUrl` never
 *  records. RECONNECT MC falls back to it. */
let lastMcUrl = null;
/** F139: the LAN url of THIS RUN's join — a QR scan, a typed address, an mDNS hit, or a url we actually
 *  welcomed over. Deliberately NOT `settings.mcUrl`: that survives across days, and the field sweep used
 *  it to pick a subnet, so a phone on 192.168.0.x spent its whole sweep on the iPhone-hotspot range it
 *  had joined the previous game test. A remembered address says where MC was, never where we are. */
let currentJoinUrl = null;
function noteJoinUrl(url) { if (url && /^wss?:\/\//i.test(url)) currentJoinUrl = url; }
/**
 * @param {string} url the LAN join url
 * @param {boolean} [remember] this address came FROM THE USER — a scanned QR, a typed address, or one
 *   already remembered. It is shown as the HUD's target and persisted at the dial, so a QR scanned while
 *   MC is down still works on the next launch. `false` is for an address the user did not name (a JOIN-row
 *   suggestion out of the sweep or an mDNS advert): it is persisted only if that MC actually welcomes and
 *   binds us, from the `bound` branch below. A suggestion written at dial time would overwrite the
 *   operator's scanned target, suppress the boot sweep, and come back next boot as a url nothing ever
 *   vouched for — dialled trusted, since trust lives on the Transport and does not survive a restart.
 *   Both things that CAN persist are therefore trusted: the user named it, or it bound us.
 * @param {{pub?:string|null, secret?:string|null, trusted?:boolean}} [join] A28.2: from a QR scan or a typed full join
 *   code — when given, replaces whatever backhaul target/secret Transport is holding. When omitted
 *   (every discovery/sweep/remembered-address reconnect) neither is passed at all: Transport's OWN
 *   persisted, url-scoped pub/secret stand as-is (it clears them itself if `url` differs from the one
 *   they were learned for) — passing a stale app-level copy here used to force-clear whatever Transport
 *   had just learned from welcome.join on every single reconnect, so a phone that learned its pub in
 *   the field lost it again immediately, or a cold boot out of Wi-Fi had no other path to MC (review
 *   fix). Transport's own persistence is the single store now — there is no app-level mirror to keep.
 */
function connectMc(url, remember = true, join = {}) {
  if (!url) return;
  if (remember) { settings.mcUrl = url; hud.mcUrl = url; }   // the user named this one; a suggestion waits for the bind
  // ...but RECONNECT MC has to have something to dial. It read `settings.mcUrl`, which a
  // discovery-only connect deliberately never writes — so after an auto-discovered join the button
  // called connectMc(undefined) and returned on line 1, doing nothing at all (deferred low).
  lastMcUrl = url;
  if (transport) { try { transport.close(); } catch (_) { /* ignore */ } }
  const gun = engine.gun ? { name: engine.gun.name, tail: engine.gun.tail, fw: engine.fw || undefined } : null;
  // F309: carry the last known connection into the new Transport, so a redial is not a 5 s gap in the claim.
  transport = new Transport({ node: { app_ver: APP_VER, connection_type: transport ? transport.connectionType : null }, gun, priorUtility: priorUtilityHandoff(), wsFactory });
  const candidate = transport;
  // `log` is this node's own view of the sync (A25: MC shows none|offered|pulling|held per node);
  // app_ver/platform are added by the transport itself so every node type reports them (A29).
  transport.setStatusProvider(() => ({ ...engine.statusBody(preflight), log: logsync.state() }));
  transport.onHydrate(node => engine.hydrate(node));
  transport.onMessage(m => {
    engine.onMcMessage(m);
    if (m.kind === 'feedback' && m.body && m.body.kind === 'kill') haptic('kill');
    // A25: MC asks at recap, on an offer, from the LOGS button and on the reconnect of a node whose
    // log never arrived. We answer only when it is safe; the request is parked otherwise, never dropped.
    if (m.kind === 'pull_log') logsync.request((m.body && m.body.reason) || 'pull');
  });
  transport.onState(s => {
    // Bound to an MC: no suggestion row, no sweep.
    if (s === 'bound') { if (assistTimer) { clearTimeout(assistTimer); assistTimer = null; } logsync.onBound();
      // The server validates the old utility takeover key and explicitly confirms consumption in welcome.
      // Keep the handoff across failed/untrusted dials; clear it only after that acknowledgement.
      clearConsumedPriorUtilityHandoff(transport);
      if (transport && transport.reach === 'lan') noteJoinUrl(transport.url);
      // A SUGGESTED address (sweep hit, mDNS advert) is remembered only now, having welcomed us, issued
      // a node_key and bound this node. A user-provided one was written at the dial. So everything in
      // `settings.mcUrl` was either named by the user or proved itself, and the boot dial can present the
      // key and the join secret without having to ask which.
      if (transport && transport.url) { settings.mcUrl = transport.url; hud.mcUrl = transport.url; }
      hud.discovered = null; }   // F139: a url we actually welcomed over IS the current join
    // ...and sweep again if we stay unbound: the boot sweep used to be a one-shot, so after the first
    // successful bind nothing could rescue us again — exactly the case where MC restarts on a new IP
    // mid-match (review 2026-09-01).
    else if (!assistTimer) assistTimer = setTimeout(() => { assistTimer = null; if (!transport || transport.state !== 'bound') sweepForMc().catch(() => {}); }, 15000);
    engine.setWsState(s, transport.rejected);
    log(s === 'rejected' ? `MC REFUSED: ${transport.rejected && transport.rejected.reason} (${transport.rejected && transport.rejected.code})` : `MC link ${s}`, s === 'bound' ? 'lk' : s === 'rejected' ? 'le' : 'li');
  });
  // `trusted:false` (a LAN-sweep address — nobody typed or scanned it) keeps this node's takeover key
  // and the join secret off the hello until that peer proves it is MC by welcoming us.
  transport.connect({ url, pub: join.pub, secret: join.secret, trusted: join.trusted !== false })
    .then(() => log('MC hydrated', 'lk')).catch(e => {
      const message = e && e.message || e;
      log('MC connect: ' + message, 'le');
      // F203: an unreachable remembered MC must not pin the phone to two stale keys forever.
      // Only clear a target that never welcomed, and only if this is still the active attempt;
      // a refusal or a newer QR/discovery connect remains actionable.
      if (transport === candidate && settings.mcUrl === url && /no welcome within/.test(String(message))) {
        settings.mcUrl = ''; hud.mcUrl = '';
        candidate.clearJoinTarget(); candidate.close();
        if (!assistTimer) sweepForMc().catch(() => {});
      }
    });
}

// ---------- HUD handlers ----------
// Bench 2026-09-17 (Pixel 5): `picking` is true from a row tap until its connect settles. The plugin runs
// every native call in one queue, so a connect holds the radio for up to 10 s per attempt, and the rows
// used to stay on screen for all of it. A second row tap then ran a second connect beside the first (a
// false drop, then onUp from the connect that lost), and SET MY GUN opened a scan AFTER onUp had already
// closed the picker, so it stayed open in the lobby. Both taps are now ignored while a pick connects.
let scanning = false, picking = false, pickerScanSeq = 0;
// F258 (bench 2026-09-18): the picker's list lives in `gunpicker.js` — ranking, first-seen order and
// the "has anything visible changed" flag. Nothing in this file sorts or paints from a scan hit.
const pacer = new ScanPacer();   // app 0.4.2: picker scan starts are debounced; automatic ones back off
const picker = new GunPicker({ coalesceMs: COALESCE_MS });   // game day 2026-09-19: a flood of repeat hits is coalesced
let paintTimer = null;
/** Paints the picker at PAINT_MS, and only when something a player would see actually changed. A scan
 *  hit itself never paints: on the bench the list churned so fast that no tap and no scroll landed. */
function startPickerPaint() {
  stopPickerPaint();
  paintTimer = setInterval(() => {
    picker.setAssigned(assignedGun());   // MC can bind while the picker is open: adopt its gun_id when it lands
    if (!picker.dirty) return;
    hud.setScan(picker.list()); scheduleRender();
  }, PAINT_MS);
}
function stopPickerPaint() { if (paintTimer) clearInterval(paintTimer); paintTimer = null; }
/** The gun this phone is meant to carry: MC's own `player.gun_id` first, then the gun this phone last
 *  linked. Both are persisted with the session, so a rejoin knows the answer before the scan opens; a
 *  phone that has never been kitted has neither, and the list falls back to ranking by service UUID. */
function assignedGun() {
  return (engine.player && engine.player.gun_id) || (engine.gun && engine.gun.name) || null;
}
/** Opens the gun picker's scan. `auto`: nothing on screen was tapped (boot, Bluetooth back on, the
 *  rejoin fallback), so the start is paced by `pacer`'s back-off. A tap resets that back-off. */
async function openPicker({ auto = false } = {}) {
    if (picking) return;
    if (!pacer.allow({ auto, open: scanning && link.scanning })) { log(auto ? 'gun scan: automatic reopen held back (back-off)' : 'gun scan already running', 'li'); return; }
    if (hud.connecting) { hud.setConnecting(null); scheduleRender(); }   // SCAN AGAIN after a failed connect
    // F211: check the adapter BEFORE opening the radio — starting a scan with Bluetooth off just sits
    // there silently (docs/archive/game-test-2026-09-13.md C2). `watchEnabled` (boot, below) re-runs this the moment
    // Bluetooth comes back on, so the operator never has to tap SET MY GUN a second time.
    if (!setBluetoothOn(await link.isEnabled())) { hud.setScan([]); scheduleRender(); return; }
    if (picking || link.connected) return;   // re-check: isEnabled() waited in the plugin queue behind a connect
    // Review 2026-09-19: a background reconnect loop (a remembered gun that is off) also holds the radio --
    // `link.scan()` throws "a gun connect is in flight" and the picker showed "No guns found" with no scan
    // ever having run. End that loop first, the smallest safe option: SET MY GUN is meant to override it.
    if (link.connecting) { log('gun scan: ending the background reconnect so the picker can use the radio', 'li'); await link.disconnect(); }
    scanning = true;       // claim the radio first, so no beacon tick reopens its scan while this one stops it
    try {
      await stopAnyScan();   // tap = (re)start a fresh scan, never leave the picker idle (bench 2026-08-25); the beacon watch yields to the picker
      if (picking || link.connected) { scanning = false; return; }
      pacer.started({ auto });
      picker.clear(); picker.setAssigned(assignedGun());
      hud.setScan([]); hud.setScanOther(false); scheduleRender();
      startPickerPaint();
      // The scan callback RECORDS ONLY. `picker.observe` sorts nothing, and the timer above paints.
      // Nameless adverts are kept: on Android a tagger's name and its service UUID ride in different
      // packets, so a nameless hit that carries the Nordic UART service is still a gun.
      await link.scan(d => picker.observe(d));
      // Game day 2026-09-19: the scan is bounded. With nothing picked it stops after PICKER_SCAN_MS; the
      // list keeps its rows, says no scan is running, and SCAN AGAIN (this same handler) starts a new one.
      const seq = ++pickerScanSeq;
      setTimeout(() => {
        if (seq !== pickerScanSeq || !scanning || picking || link.connected) return;
        scanning = false; stopPickerPaint(); hud.setScan(picker.list()); scheduleRender();
        link.stopScan().catch(() => {});
        log('gun scan stopped after ' + PICKER_SCAN_MS / 1000 + ' s; tap SCAN AGAIN to look again', 'li');
      }, PICKER_SCAN_MS);
    } catch (e) { scanning = false; stopPickerPaint(); log('scan: ' + (e && e.message || e), 'le'); }
}
Object.assign(hud.h, {
  onSetGun: () => openPicker(),
  // F202: SET MY GUN is also available from the diagnostic panel while no match is running. Clear the
  // remembered engine gun before scanning, otherwise the old saved blob keeps winning the picker ranking.
  onChangeGun: async () => {
    if (picking || !['idle', 'connected'].includes(engine.phase)) {
      log(`change tagger ignored — phase is ${engine.phase}`, 'li');
      return;
    }
    try {
      if (hud.diag.classList.contains('open')) hud.toggleDiag(); else hud.sig = null;
      await link.disconnect();
      engine.forgetGun();
      await openPicker();
    } catch (e) {
      log('change tagger: ' + (e && e.message || e), 'le');
      if (!hud.diag.classList.contains('open')) hud.toggleDiag();
      scheduleRender();
    }
  },
  onScanAgain: () => hud.h.onSetGun(),   // game day 2026-09-19: SCAN AGAIN on an empty gun list
  // F258: the fold over everything the picker could not rank as a tagger.
  onScanOther: () => { hud.setScanOther(!hud.scanOther); scheduleRender(); },
  // F211: Android only (the plugin has no iOS equivalent — Apple gives apps no Bluetooth toggle).
  // `watchEnabled` (boot, below) notices the change and re-opens the picker; no need to poll here.
  onEnableBluetooth: async () => { const ok = await link.requestEnable(); if (!ok) log('this phone/build has no Bluetooth enable prompt — use BLUETOOTH SETTINGS', 'li'); },
  onOpenBluetoothSettings: async () => { const ok = await link.openBluetoothSettings(); if (!ok) log('this phone/build has no Bluetooth settings shortcut', 'li'); },
  // F258 (bench 2026-09-18): picking a gun froze the screen for about three seconds before the tagger
  // said "phone connected" — the scan was still running across the connect and contending with it on
  // the plugin's one native queue. The order is now explicit and every step is awaited: stop painting,
  // stop the scan, THEN connect. `scanning` stays true for the whole connect, so the 1 Hz beacon tick
  // (scanwatch.js) cannot open its own scan underneath it; the `finally` hands the radio back.
  onPick: async deviceId => {
    const d = picker.get(deviceId); if (!d || picking) return;
    picking = true; const name = d.name || deviceId;
    // App 0.4.2 (field 2026-09-19): the rows go now, and a "Connecting to <gun>" block takes their place
    // until the link is up or the connect gives up. The screen is never an empty list during a connect.
    hud.setScan([]); hud.setConnecting({ name, attempt: 1, of: 5, failed: false }); scheduleRender();
    stopPickerPaint();
    log(`connecting to ${name}…`);
    let failed = false;
    try {
      await link.stopScan();
      // `connect` waits for the stop to complete plus SCAN_SETTLE_MS before its first attempt (brxlink.js)
      // `of: null` once unbounded() -- never a stale "Retrying (7 of 5)…" (review 2026-09-19)
      const up = await link.connect(deviceId, d.name, { onAttempt: (i, of) => { hud.setConnecting({ name, attempt: i, of: link.unbounded() ? null : of, failed: false }); scheduleRender(); } });
      if (up !== false && settings.mcUrl && !transport) connectMc(settings.mcUrl);
    }
    catch (e) { failed = true; log('connect failed: ' + (e && e.message || e), 'le'); }
    finally { picking = false; scanning = false; }
    // a failed connect keeps the gun's name on screen with a plain message and SCAN AGAIN (onScanAgain)
    hud.setConnecting(failed ? { name, attempt: 5, of: 5, failed: true } : null);
    scheduleRender();
  },
  onUtility: () => switchRole('utility'),   // the HUD's way into utility mode (brx-hud adds the control; 7 taps on the stage also work)
  // F-4 (2026-09-13): `engine.setReady` is the one place that knows when a ready tap is legal (kitted,
  // or lobby once the kit has closed) — this used to re-type "kitted only" here too, which is exactly
  // what left a lobby READY UP tap doing nothing once the button existed to tap.
  onReady: () => { if (engine.setReady(!engine.ready)) haptic('tap'); },
  // A10 self-serve kitting (docs/spec/loadout.md §4.5): slot plates → LOADOUT browser → tap-to-equip / TRY IT / DONE
  onOpenLoadout: slot => { if (!engine.canPick(slot)) return; hud.lo.tab = slot; hud.lo.focus = null; hud.lo.filter = 'weapons'; hud.lo.confirm = null; engine.browse(true); haptic('tap'); },
  // A26: leaving a rack COMMITS the pick sitting in its debounce window — the same rule as CLOSE and READY UP.
  // Without this, tapping a weapon and switching tab inside 400 ms dropped the pick on the floor (review 2026-09-12).
  onLoTab: slot => { if (!engine.canPick(slot)) return; engine.commitPick('tab switch'); hud.lo.tab = slot === 'secondary' ? 'secondary' : slot === 'perk' ? 'perk' : 'primary'; hud.lo.focus = null; hud.lo.confirm = null; hud.sig = null; scheduleRender(); },
  onLoFilter: f => { hud.lo.filter = f === 'perks' ? 'perks' : 'weapons'; hud.lo.focus = null; hud.sig = null; scheduleRender(); },
  onLoNone: slot => { hud.lo.confirm = null; engine.requestLoadout(slot === 'perk' ? 'perk' : 'secondary', 'none'); haptic('tap'); },
  // A14: a pick that would knock the other slot out (Easy Reload vs a second weapon) needs a second tap on the same row
  onPickItem: key => { const i = String(key || '').indexOf(':'); if (i < 0) return; const kind = key.slice(0, i), id = key.slice(i + 1); hud.lo.focus = key;
    const drop = engine.conflictFor(hud.lo.tab, kind, id);
    if (drop) {
      const hostOnly = drop.slot === 'accessibility';
      const confirmed = hud.lo.confirm && hud.lo.confirm.key === key && hud.lo.confirm.tab === hud.lo.tab;
      if (confirmed && hostOnly) {
        // Easy Reload is a host-set override; sending the same request again is
        // guaranteed to be rejected until the host changes the kit.
        scheduleRender(); haptic('tap'); return;
      }
      if (!confirmed) {
        const row = kind === 'perk' ? engine.perkRow(id) : engine.weaponRow(id); const nm = (row && row.name) || id;
        hud.lo.confirm = { tab: hud.lo.tab, key, drop, text: hostOnly
          ? `${nm} needs the ALT button — ask the host to remove ${drop.name} first`
          : kind === 'perk' ? `${nm} takes the ALT button — drops your ${drop.name}` : `${nm} needs the ALT button to switch — drops ${drop.name}` };
        hud.sig = null; scheduleRender(); haptic('tap'); return;
      }
    }
    hud.lo.confirm = null;
    if (engine.requestLoadout(hud.lo.tab, kind, id, false)) haptic('tap'); else scheduleRender(); },
  onTryIt: () => { const st = engine.state(); const tab = hud.lo.tab; if (tab === 'perk') return; const rows = hud._loRows(st, tab); const eq = st.loadout[tab];
    const key = (hud.lo.focus && rows.some(r => r.key === hud.lo.focus)) ? hud.lo.focus : (eq && eq.kind === 'weapon' ? 'weapon:' + eq.weapon_id : (rows[0] && rows[0].key));
    if (!key || !key.startsWith('weapon:')) return; hud.lo.confirm = null; if (engine.requestLoadout(tab, 'weapon', key.slice(7), true)) haptic('tap'); },
  onLoDone: () => { hud.lo.confirm = null; engine.browse(false); haptic('tap'); },
  // A26: REVIEW KIT ▸ is the rack's PRIMARY way out — the same close as CLOSE (the plates + READY UP are the review),
  // under its own action so a locator can name the primary control (the site gate's step 12j tripped on two `onLoDone`).
  onLoReview: () => { hud.lo.confirm = null; engine.browse(false); haptic('tap'); },
  // A10 §4.6: BRIEFING → BUILD MY KIT ▸ reveals the plates; BRIEFING on the KITTED screen reopens it
  onBriefDone: () => { engine.closeBriefing(); haptic('tap'); },
  onBriefing: () => { engine.openBriefing(); haptic('tap'); },
  onTryDone: () => { engine.dismissTryout(); haptic('tap'); },
  onSetUrl: () => {
    const el = $('mcurl'); const v = el && el.value.trim(); if (!v) return;
    const j = parseMcJoin(v);
    noteJoinUrl(j ? j.url : v);
    if (j) connectMc(j.url, true, { pub: j.pub, secret: j.secret });
    else connectMc(v);   // not a recognised join code — let it through as a bare address (the mandatory floor, §5)
  },
  onToggleNight: () => { engine.setNight(!engine.night); hud.sig = null; scheduleRender(); },   // the header ☾/☀ and the diag NIGHT button
  onToggleMcPill: () => { hud.mcPill = !hud.mcPill; scheduleRender(); },   // live: show/hide the out-of-range detail (review #32)
  onCloseDiag: () => hud.toggleDiag(),
  // A link that is down: cut the backoff short. A link the app believes is up: really cycle it (playtest
  // 2026-09-13, RELINK GUN did nothing there). The relink path re-writes the head only where that is safe.
  // HEADSET OFF? RECONNECT NOW: start the flap backoff again and dial at once (a link that is up is left alone).
  onReconnectNow: () => { link.resetFlap(); engine.setGunFlapping(null); if (link.deviceId && !link.connected) link.retryNow(); },
  onReconnectGun: () => { if (link.deviceId) link.relink().catch(e => log('relink: ' + (e && e.message || e), 'le')); },
  onReconnectMc: () => {
    const url = settings.mcUrl || lastMcUrl;
    // with neither a remembered nor a discovered target there is nothing to dial, and a button that
    // silently does nothing reads as "the app is broken" (review 2026-09-01)
    if (!url) { log('NO MISSION CONTROL YET — SCAN THE JOIN QR ON THE MC SCREEN', 'le'); return; }
    connectMc(url, !!settings.mcUrl);
  },
  onScanQr: () => { scanQrForMc().catch(e => log('QR scan failed: ' + e.message, 'le')); },
  // The LAN sweep's hit is a SUGGESTION, never a join (review pass 1, security): any host on the subnet
  // can accept a websocket upgrade on the node port, and a phone that dials one on its own has handed a
  // squatter its hello. The player taps this; the address is still treated as untrusted on the wire.
  onJoinDiscovered: () => {
    const d = hud.discovered; if (!d || !d.url) return;
    hud.discovered = null; haptic('tap');
    log(`joining the Mission Control ${d.source === 'mdns' ? 'advertised on' : 'found on'} the LAN: ${d.url}`, 'lk');
    noteJoinUrl(d.url);
    // `false`: not shown as the explicit target and never written to settings by this call — if it IS
    // Mission Control it will welcome us, and the `bound` branch remembers it then. `trusted:false`
    // keeps the node_key and the join secret off the hello until that happens.
    connectMc(d.url, false, { trusted: false });
  },
  onEndOk: () => { engine.ackEnd(); },
  // onPanic removed 2026-08-26: a player-side panic only safes THIS gun and knocks the player out until a
  // re-push — a mishit mid-game ruins their match. Fleet safety = MC's PANIC + the physical power switch.
  onShareLog: async () => {
    // The MANUAL route (A25: background sync never replaces it). It sends the WHOLE ring, not the
    // tail — the operator tapped it because they want this phone's log now — and it ignores the
    // ARMED/LIVE gate for the same reason. `logSnapshot` is the one shared builder.
    const snap = logSnapshot(0);
    // 1. queue the log to MC over the wire (log_offer + chunked log_data — the contract's log path)
    try {
      if (transport && transport.state === 'bound') {
        // The SAME cut the background sync uses. It was a bare `46 * 1024` here and
        // `MAX_LOG_CHUNK_BYTES - 2048` there: two numbers that have to agree, with nothing making them.
        const chunks = chunkByBytes(snap.text, DEFAULT_CHUNK_BYTES);
        const bytes = new TextEncoder().encode(snap.text).length;
        // report() returns false when the socket is closing but `state` has not flipped yet, and
        // these frames do NOT go through the retry ring — so an unchecked send is a log that
        // silently never arrives while the HUD says it did (review 2026-09-01).
        let sent = transport.report('log_offer', { bytes, lines: snap.lines, from: 0, reason: 'manual' }) !== false;
        for (let i = 0; i < chunks.length; i++) {
          if (transport.report('log_data', { seq: i, chunk: chunks[i], last: i === chunks.length - 1 }) === false) sent = false;
        }
        if (!sent) throw new Error('the socket refused part of the log');
        logsync.markUploaded(snap.through);   // the background pull now has nothing to re-send
        log(`log sent to MC — ${bytes} bytes, ${snap.frames} BLE frames ✓`, 'lk');
        return;                       // delivered: nothing to copy, nothing for the operator to do
      }
    } catch (e) { log('log→MC: ' + (e && e.message || e), 'le'); }
    // Fallback ONLY when MC could not take it. Tony, 2026-09-01: "get rid of the copy paste
    // fallback. just show that it successfully sent to MC" — a share sheet full of raw log after a
    // SUCCESSFUL upload reads as "it didn't work", and in the field nobody pastes it anywhere.
    log('MC unreachable — offering the log locally instead', 'le');
    const text = snap.text;
    try { if (plugins.share) await plugins.share.share({ title: 'BRX node log', text }); else await navigator.clipboard.writeText(text); log('log shared/copied', 'lk'); }
    catch (e) { log('share: ' + (e && e.message || e), 'le'); }
  },
  onDemo: () => { location.search = '?demo'; },
  onHaptic: k => haptic(k),
});
async function rejoinGun() {
  const want = engine.gun && engine.gun.name; if (!want) return;
  log(`match in progress — reconnecting to ${want}…`, 'lk');
  let done = false;
  scanning = true;   // claim the radio before the first await (the beacon watch yields to it)
  await stopAnyScan();
  await link.scan(async d => {
    if (done || !d.name || d.name !== want || isHeadset(d.name)) return;   // the remembered gun, by its advertised name; never the IR headset
    done = true;
    // F258: the same order the picker keeps — stop the scan, THEN connect, and hold the radio claim
    // (`scanning`) until the connect settles, so the beacon watch cannot open a scan across it.
    try {
      await link.stopScan();
      await link.connect(d.deviceId, d.name);
      if (settings.mcUrl && !transport) connectMc(settings.mcUrl);
    }
    catch (e) { log('rejoin connect: ' + (e && e.message || e), 'le'); }
    finally { scanning = false; }
    scheduleRender();
  }).catch(e => { scanning = false; throw e; });
  // If the remembered gun never appears, don't leave this scan running forever (battery + it blocks the
  // beacon watch): fall back to the normal picker, which restarts a fresh scan the operator can choose from.
  setTimeout(() => { if (!done && !link.connected) { done = true; log('remembered gun not seen — opening the picker', 'li'); openPicker({ auto: true }).catch(() => {}); } }, 12000);
}

// ---------- render loop ----------
let renderQueued = false;
const DEMO = new URLSearchParams(location.search).has('demo');
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderNow(); }); }
function renderNow() {
  const st = engine.state();
  if (!DEMO) hud.scanActive = scanning && !picking;   // game day 2026-09-19: the picker says whether a scan really runs (the stage sets its own)
  hud.render(st);
  hud.setDiag({
    preflight, link: { app: APP_VER, platform: platformName(), log: logsync.state(), deviceId: link.deviceId, connected: link.connected, relinking: link.relinking, retries: link.retries, mc: transport ? transport.state : 'none', mc_url: settings.mcUrl, node_id: transport ? transport.nodeId : '—', reach: transport ? transport.reach : null, pub: transport ? transport.pub : null },
    engine: { phase: st.phase, alive: st.alive, hp: st.hp, armor: st.armor, ammo: st.ammo, reserve: st.reserve, shots: st.shots, deaths: st.deaths, match_id: st.matchId, player_num: st.playerNum, latch: engine.latch ? `${engine.latch.shooter_num}/${engine.latch.shooter_team}` : '—', resync: st.resync ? st.resync.step : '—' },
    timings: { offset_ms: transport ? Math.round(transport.clock.offset || 0) : 0, synced: st.synced, queue: transport ? transport.ring.pending().length : 0, t_minus_ms: st.tMinusMs, clock_ms: st.clockMs },
    frames: link.frames.slice(-14), log: logLines.slice(-30),
    stations: presence.stations().map(stationView),
  });
}
setInterval(() => { presenceTick(); engine.tick(); syncPlayerAdvert().catch(() => {}); scheduleRender(); }, 250);
setInterval(refreshPreflight, 5000);
// QA-15 (2026-09-23): the stage has no transport, so this read "never bound" and every stage result said OUT OF RANGE
// under a result MC had just delivered. On a phone a result only arrives over a bound transport, and the engine's
// wsState follows transport.onState, so the stage reads the engine's link instead: it predicts the phone again.
setInterval(() => { try { hud.sync = (DEMO && !transport) ? { bound: engine.state().wsState === 'bound', pending: 0 } : { bound: !!transport && transport.state === 'bound', pending: transport && transport.ring ? transport.ring.pending().length : 0 }; if (transport) hud.sessionId = transport.sessionId || null; } catch (_) { /* ignore */ } }, 1000);   // never joined → stays null (OVERALL); the harness may set it

// ---------- app lifecycle (§3.11) ----------
function onForeground(fg) {
  preflight.foreground = fg; preflight.screen_on = fg;
  if (transport) { transport.setPreflight(preflight); if (!fg) transport.status(engine.statusBody(preflight)); }   // one immediate status on background (§3.11)
  if (fg) { engine.resume(); keepAwake(true); }
}
document.addEventListener('visibilitychange', () => onForeground(document.visibilityState !== 'hidden'));
/** F153c: the network came back. Android fires the Capacitor `networkStatusChange` AND the webview's
 *  `online` for the same transition, and two kicks abort each other's dial and reset the backoff twice —
 *  a flapping radio would then never back off at all. One entry point, coalesced to 1 s (review pass 1). */
let lastKickAt = 0;
function kickDial(why) {
  const now = Date.now();
  if (now - lastKickAt < 1000) return false;   // the same transition reaching us twice
  lastKickAt = now;
  if (transport) { if (transport.dialNow()) log(`network back (${why}) — dialling Mission Control now`, 'li'); return true; }
  if (settings.mcUrl) { log(`network back (${why}) — connecting: ${settings.mcUrl}`, 'lk'); connectMc(settings.mcUrl); return true; }
  return false;
}
window.addEventListener('online', () => kickDial('online'));
window.addEventListener('pageshow', () => engine.resume());

// ---------- MC auto-discovery (mDNS _openbrx._tcp — MC advertises, we watch) ----------
function startDiscovery() {
  if (!plugins.zeroconf || !isNative()) return;
  try {
    plugins.zeroconf.watch({ type: '_openbrx._tcp.', domain: 'local.' }, res => {
      try {
        const svc = res && res.service;
        if (!svc || (res.action !== 'resolved' && res.action !== 'added')) return;
        const ip = (svc.ipv4Addresses && svc.ipv4Addresses[0]) || '';
        if (!ip || !svc.port) return;
        const path = (svc.txtRecord && svc.txtRecord.ws_path) || '/ws';
        const url = `ws://${ip}:${svc.port}${path}`;
        noteJoinUrl(url);
        // OFFERED, never dialled (review pass 2): anything on the field Wi-Fi can advertise
        // `_openbrx._tcp`, and the phone used to hand the first answer its takeover key and the join
        // secret with no one having chosen it. One tap is the whole difference.
        suggestMc(url, 'mdns');
      } catch (e) { log('discovery: ' + (e && e.message || e), 'li'); }
    }).catch(e => log('discovery watch: ' + (e && e.message || e), 'li'));
  } catch (e) { log('discovery init: ' + (e && e.message || e), 'li'); }
}

/** Offer an address the PLAYER never named — a sweep hit or an mDNS advert — as a one-tap JOIN row
 *  (`hud.discovered`; `hud.h.onJoinDiscovered` dials it). Never dials anything itself.
 *  Review pass 2: mDNS used to auto-join, and advertising `_openbrx._tcp` on the field Wi-Fi is easier
 *  than answering a port sweep — the phone handed its A8.2 takeover key and the A28.2 join secret to
 *  whoever answered first. The 2026-09-11 game test leaned on that auto-join (no QR was scanned all
 *  night); this row is the replacement, and the log line says so. */
function suggestMc(url, source) {
  if (!url) return;
  if (transport && transport.state === 'bound') return;                 // already home
  if (hud.discovered && hud.discovered.url === url) return;             // mDNS re-resolves constantly
  hud.discovered = { url, at: Date.now(), source };
  const host = (url.match(/\/\/([^/]+)/) || [])[1] || url;
  log(`MISSION CONTROL FOUND AT ${host} — tap JOIN (it is no longer joined automatically)`, 'lk');
  scheduleRender();
}

// In-app QR scanner: camera → jsQR → connect. No copy/paste, no native plugin (webview getUserMedia,
// same camera permission CAM mode already holds). Accepts ws:// text or any URL carrying ?ws=/#ws=.
async function scanQrForMc() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#04060a;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:20px';
  const hint = document.createElement('div');
  hint.textContent = 'AIM AT THE QR ON THE MISSION CONTROL SCREEN';
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');
  hint.style.cssText = 'color:#8fa3bd;font:600 11px ui-monospace,monospace;letter-spacing:.22em;text-align:center';
  const frame = document.createElement('div');
  frame.style.cssText = 'position:relative;width:min(78vw,340px);aspect-ratio:1;border:1px solid #2c3a4e;overflow:hidden';
  const video = document.createElement('video');
  video.setAttribute('playsinline', ''); video.muted = true;
  video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
  const reticle = document.createElement('div');
  reticle.style.cssText = 'position:absolute;inset:14%;border:2px solid rgba(255,201,71,.85);clip-path:polygon(0 0,22% 0,22% 6%,6% 6%,6% 22%,0 22%,0 0,100% 0,100% 22%,94% 22%,94% 6%,78% 6%,78% 0,100% 0,100% 100%,78% 100%,78% 94%,94% 94%,94% 78%,100% 78%,100% 100%,0 100%,0 78%,6% 78%,6% 94%,22% 94%,22% 100%,0 100%)';
  frame.append(video, reticle);
  const cancel = document.createElement('button');
  cancel.textContent = 'CANCEL';
  cancel.style.cssText = 'min-height:48px;padding:14px 40px;background:#131b26;color:#e8eef5;border:1px solid #2c3a4e;font:700 12px ui-monospace,monospace;letter-spacing:.24em';
  ov.append(hint, frame, cancel); document.body.appendChild(ov);
  let stream = null, raf = 0, done = false;
  let stop = () => { done = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach(t => t.stop()); ov.remove(); };
  const onHide = () => { if (document.hidden) stop(); };
  document.addEventListener('visibilitychange', onHide);
  const _stop = stop; stop = () => { document.removeEventListener('visibilitychange', onHide); _stop(); };
  cancel.onclick = () => stop();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream; await video.play();
  } catch (e) { stop(); log('camera unavailable: ' + e.message, 'le'); return; }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let lastRejected = null;
  const tick = () => {
    if (done) return;
    if (video.videoWidth) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      const join = code && code.data ? parseMcJoin(code.data) : null;
      if (join) { stop(); log('QR scanned — connecting: ' + join.url, 'lk'); noteJoinUrl(join.url); connectMc(join.url, true, { pub: join.pub, secret: join.secret }); return; }
      // A code the camera READ but that is not an MC join code used to look identical to reading
      // nothing at all — the operator kept aiming at a Wi-Fi or URL QR wondering why (deferred low).
      if (code && code.data && code.data !== lastRejected) {
        lastRejected = code.data;
        hint.textContent = 'THAT IS NOT A MISSION CONTROL CODE — SCAN THE ONE ON THE MC SCREEN';
        hint.style.color = '#ff5252';
      }
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
}

// Fallback discovery: mDNS can die on AP-isolated/multicast-filtered routers — sweep the likely /24s for
// MC's NODE SOCKET and, if one answers the websocket upgrade, join it.
//
// F139 (field 2026-09-12): this used to fetch `http://<ip>:8765/api/state`, which Android blocks as Mixed
// Content from the app's https origin — every request, every time, so the sweep had never worked on a
// phone. It also took its subnet from the REMEMBERED address. Both live in transport/discover.js now,
// where they are testable; this is the app's half: where the inputs come from, and what to do with a hit.
async function sweepForMc() {
  if (transport && transport.state === 'bound') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;   // no network, no sweep
  let localIp = null;
  try { if (plugins.network) localIp = localIpFrom(await plugins.network.getStatus()); } catch (_) { /* ignore */ }
  const plan = sweepPlan({ localIp, joinUrl: currentJoinUrl });
  const urlAtStart = settings.mcUrl;
  // the user typing/scanning mid-sweep wins (polish-loop), and a join landing ends it early
  const shouldStop = () => !!(transport && transport.state === 'bound') || settings.mcUrl !== urlAtStart;
  log(`sweeping for Mission Control on ${plan.subnets.map(sn => sn + '.x').join(', ')} :${plan.ports.join('/')}…`, 'li');
  // Office test 2026-09-19 (Pixel 4/5): the sweep running ON TOP of a gun connect was the likely cause of
  // the 1-2 s freeze before "Connecting to <gun>…" appeared -- `picking` is true from the tap (onPick,
  // above) until the connect is up or gives up, so the sweep waits out the connect and resumes after.
  const found = await sweepSubnetsForMc({ ...plan, wsFactory, shouldStop,
    isPaused: () => picking, onSubnet: sn => log(`sweep: ${sn}.0/24`, 'li') });
  if (!found) { log('sweep found no Mission Control — QR/manual join', 'li'); return; }
  if (shouldStop()) return;
  // A SUGGESTION, not a join (review pass 1, security): this address was never typed, scanned or
  // advertised — a websocket upgrade is all it answered, which any squatter on the node port can do, and
  // the hello that followed used to carry this node's takeover key. The player taps JOIN.
  suggestMc(found, 'sweep');
}

// ---------- boot ----------
(async () => {
  const params0 = new URLSearchParams(location.search);
  if (settings.role === 'utility' && !params0.has('demo') && !params0.has('gun') && !params0.has('hud')) { location.replace('utility.html'); return; }
  // 7 taps on the stage within 3 s, the LAST one HELD 1.5 s, while nothing is connected → utility mode
  // (a hidden door until the HUD grows a button). T2-B item 3: taps alone used to fire on an idle-stage
  // jostle (phone face-down in a bag/pocket can deliver several brief contacts); requiring a deliberate
  // hold on the final contact — see tapgate.js — means an accidental burst can no longer cross by itself.
  try {
    const stage = document.getElementById('frame') || document.body;
    installTapHoldDoor({ stage,
      // T2 review S6: re-test this at FIRE TIME too. A BLE link that completes during the hold must
      // not be torn down by entering utility mode; the installer calls `eligible` at both edges.
      eligible: () => engine.phase === 'idle' && !link.connected,
      activate: () => switchRole('utility'),
    });
  } catch (_) { /* ignore */ }
  await loadPlugins();
  await lockLandscape(); await keepAwake(true);
  try { if (plugins.app) plugins.app.addListener('appStateChange', ({ isActive }) => onForeground(!!isActive)); } catch (_) { /* ignore */ }
  // F153c: the radio came back (mobile data restored, Wi-Fi rejoined, the hotspot came up). Whatever the
  // transport is sitting on was started while there was no route: a backoff counting down, or a dial
  // hanging on an address nothing could reach. Dial from the top of the ladder NOW. Field cost of not
  // doing this: mobile data came back mid-match and the node took ~3 minutes to reappear.
  try {
    if (plugins.network && plugins.network.addListener) {
      plugins.network.addListener('networkStatusChange', st => {
        const up = !!(st && st.connected);
        log(`network ${up ? 'up' : 'down'} (${(st && st.connectionType) || '—'})`, 'li');
        if (transport) transport.setConnectionType(st && st.connectionType);   // F309: a switch is news at once
        if (!up) return;
        kickDial((st && st.connectionType) || 'network');
        refreshPreflight().catch(() => { /* ignore */ });
      });
    }
  } catch (e) { log('network listener: ' + (e && e.message || e), 'li'); }
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) {
    const { startDemo } = await import('./demo.js');
    window.brxDemo = startDemo({ engine, log });
  } else if (params.get('gun')) {
    // browser test rig: FAKE gun + REAL Mission Control (tooling, 2026-08-26) — see src/fakegun.js.
    // With ?mc= it auto-joins; with ?gun= alone the user types the MC URL (the real join UX, e2e-tested).
    const { installFakeGun } = await import('./fakegun.js');
    engine.now = () => Date.now(); engine.isSynced = () => true;
    window.fakeGun = installFakeGun({ engine, log, name: params.get('gun') });
    if (params.get('mc')) connectMc(params.get('mc'));
  } else {
    try { await link.ensureInit(); log('BLE ready — Set my gun', 'lk'); } catch (e) { log('BLE init: ' + (e && e.message || e), 'le'); }
    // F211: the OS-level notification — flips the picker's message the moment Bluetooth is toggled, and
    // re-opens the picker on its own once it is back on, so the operator never has to tap SET MY GUN twice.
    link.watchEnabled(on => {
      log(`bluetooth ${on ? 'back on' : 'turned off'}`, on ? 'lk' : 'le');
      setBluetoothOn(on); scheduleRender();
      // F211 fix (playtest review 2026-09-13): a remembered gun (`link.deviceId` set) already runs its
      // own forever-reconnect loop. Opening the picker on top of it steals the radio, and `scanning`
      // then stays true after the loop reconnects (nothing here clears it), which keeps the beacon
      // scan closed for the rest of the match. Only open the picker when there is NO remembered gun.
      if (on) { if (!link.connected && !link.deviceId && !scanning) openPicker({ auto: true }).catch(() => {}); }
      else if (scanning) { scanning = false; stopPickerPaint(); hud.setScan([]); link.stopScan().catch(() => {}); }
    }).catch(e => log('bluetooth watch: ' + (e && e.message || e), 'li'));
    // IDLE screen says SCANNING FOR TAGGERS — so scan (the button toggles it off/on). Bench 2026-08-25.
    // Fresh boot with no gun → open the picker. REJOIN (a match in progress, gun remembered by name but the
    // deviceId is not persisted) → scan and auto-connect to that gun when it appears, so a recovered player
    // is not left tapping SET GUN by hand (bench 2026-09-04). Fall back to the picker if it never shows.
    if (!engine.gun) {
      try { await hud.h.onSetGun(); } catch (_) { /* permission denied etc. — button still works */ }
    } else if (!link.connected) {
      rejoinGun().catch(e => log('rejoin scan: ' + (e && e.message || e), 'le'));
    }
    // remembered address: CONNECT now — a gunless hello is fine (late-bind), and waiting for a gun left
    // mc_reachable=false with MC right there (Tony, 2026-08-26)
    if (settings.mcUrl && !transport) { log(`MC address remembered — connecting: ${settings.mcUrl}`, 'lk'); connectMc(settings.mcUrl); }
    lockLandscape();
    startDiscovery();
    if (!settings.mcUrl) setTimeout(() => { sweepForMc().catch(() => {}); }, 5000);   // fallback only when NO explicit target (typed/QR wins)
    setTimeout(() => {   // a REMEMBERED url that keeps failing must not disable discovery forever (polish-loop)
      if (!transport || transport.state !== 'bound') sweepForMc().catch(() => {});
    }, 15000);
  }
  await refreshPreflight(); scheduleRender();
})();
window.brx = { engine, link, hud, get transport() { return transport; }, connectMc, log: logLines, C, presence, beaconWatch, switchRole, logsync, logSnapshot, APP_VER };
