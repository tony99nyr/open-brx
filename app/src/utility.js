// utility.js — the UTILITY role: this phone IS an item on the field (docs/spec/utility.md).
// It advertises its identity (kind / team / state / its own "at me" threshold) in one service UUID via
// the brx-beacon plugin, shows what it is full-screen, and watches player adverts so the operator can
// calibrate the radius by standing where "at the station" should be and pressing SET.
// No gun, no engine: the revive itself happens on the player's phone (engine.js _triggerPulled).
import { BrxLink } from './brxlink.js';
import { ScanGuard, SCAN_MODES, stationScanStep } from './scanwatch.js';   // the BLE flood guard (bench 2026-09-17)
import { Presence, encodeUuid, KIND, TEAM_ANY, PLAYER_STATE } from './beacon.js';
import { ControlPoint, ControlAdvertiser, CONTROL_STATE, NEUTRAL as CONTROL_NEUTRAL, claimable, DEFAULT_CAPTURE_S, DEFAULT_NET_CAP } from './control.js';   // kind 5: the control point (utility.md §5, K1)
import { PowerupStation } from './powerup.js';   // kind 2: the powerup station decides who took its item (A56, docs/spec/powerups.md)
import { Transport } from './transport/transport.js';   // utility.md §5b/§5c: the phone joins MC at muster to be ARMED (contracts A13.5)
import { makeEnvelope, encode } from './transport/envelope.js';   // stage harness only: a real station_config ENVELOPE, not a bare function call (review 2026-09-11 lane-4)
import { APP_VER } from './build.js';   // A29: the REAL build, baked by scripts/build.mjs
import jsQR from 'jsqr';
import { parseMcJoin } from './mcurl.js';

// A29 (2026-09-12): "utility phones report the same way" -- the same "<version>+<sha>[-dirty]" a player
// node sends, so MC's muster rollup can compare a station phone with the field. It was 'utility-0.2', a
// label MC could not parse as a version (roadmap A3/A5 had already replaced the bare string 'utility').
const UTIL_VER = APP_VER;
const PRIOR_UTILITY_KEY = 'brx.prior_utility';

const $ = id => document.getElementById(id);
const TEAM_NAMES = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'GREEN', [TEAM_ANY]: 'ANY TEAM' };
const TEAM_ABBR = { 0: 'RED', 1: 'BLU', 2: 'YEL', 3: 'GRN', [TEAM_ANY]: '—' };   // §5d.4's net line: "RED 2 · BLU 1 → +1 RED"
const TEAM_KEYS = { 0: 'red', 1: 'blue', 2: 'yellow', 3: 'green', [TEAM_ANY]: 'any' };
const KIND_LABEL = { respawn: 'RESPAWN STATION', powerup: 'POWERUP', extraction: 'EXTRACTION POINT', bomb: 'BOMB SITE', control: 'CONTROL POINT' };
const TX_LEVELS = ['ultraLow', 'low', 'medium', 'high'];
const TX_HINT = { ultraLow: '~ -21 dBm · a few metres', low: '~ -15 dBm', medium: '~ -7 dBm', high: '~ +1 dBm · whole room' };

const logLines = [];
function log(msg, cls = 'li') {
  const t = new Date().toISOString().substr(11, 8); logLines.push(`[${t}] ${msg}`); if (logLines.length > 200) logLines.shift();
  const el = $('log'); if (el) { el.textContent = logLines.slice(-12).join('\n'); el.scrollTop = el.scrollHeight; }
}

// ---------- settings (persisted; the station survives an app restart the way it was) ----------
// mcArmed: {game, at, valid_ids} once MC pushed station_config. -74 threshold + 0.8 s dwell = arm's length,
// brief pause, green (bench-tuned 2026-09-04). captureS/netCap belong to kind 5 (§5d.1): seconds ONE net
// player needs for ONE phase, and the clamp on how much a rush can stack.
const DEFAULTS = { kind: 'respawn', team: 1, id: 1, tx: 'high', threshold: -74, dwell: 800, game: 0, mcArmed: null, mc: '', mc_auto: false,
  captureS: DEFAULT_CAPTURE_S, netCap: DEFAULT_NET_CAP };
const DEMO = /[?&](stage|demo)\b/.test(typeof location !== 'undefined' ? location.search : '');   // the stage harness: no radio, fake players
const settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('brx.utility') || '{}') }; } catch (_) { return { ...DEFAULTS }; } })();
function save() { try { localStorage.setItem('brx.utility', JSON.stringify(settings)); } catch (_) { /* ignore */ } }

// ---------- plugins ----------
const plugins = {};
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
async function loadPlugins() {
  const tryImport = async (name, fn) => { try { plugins[name] = (await fn()).v; } catch (e) { log(`plugin ${name} unavailable: ${e && e.message || e}`); } };
  const jobs = [
    tryImport('beacon', () => import('brx-beacon').then(m => ({ v: m.BrxBeacon }))),
    tryImport('keepAwake', () => import('@capacitor-community/keep-awake').then(m => ({ v: m.KeepAwake }))),
    tryImport('device', () => import('@capacitor/device').then(m => ({ v: m.Device }))),   // roadmap A3: battery in the heartbeat, same plugin app.js already uses
  ];
  // capacitor-zeroconf rejects at module evaluation on the desktop/stage harness; only load it on a native
  // utility phone, where the explicit utility-mode auto-join needs it.
  if (isNative()) jobs.push(tryImport('zeroconf', () => import('capacitor-zeroconf').then(m => ({ v: m.ZeroConf }))));
  await Promise.all(jobs);
}
/** Roadmap A3: best-effort battery percent for the ITEMS panel. Capacitor's Device plugin first (app.js's own
 *  path); the web `navigator.getBattery()` on a browser build that has one; otherwise omit the field entirely
 *  rather than send a fabricated number. */
async function readBattery() {
  try { if (plugins.device) { const b = await plugins.device.getBatteryInfo(); if (b && b.batteryLevel != null) return Math.round(b.batteryLevel * 100); } } catch (_) { /* ignore */ }
  try { if (navigator.getBattery) { const b = await navigator.getBattery(); if (b && b.level != null) return Math.round(b.level * 100); } } catch (_) { /* ignore */ }
  return null;
}
let lastBattery = null;

// ---------- the station ----------
let advertising = false, advertisingPending = 0, _advertRetryAt = 0, support = { advertising: false, txPowerControl: false, platform: 'web' };
// The control point (kind 5). §5d.6 gives it its OWN localStorage key, separate from the operator's settings:
// it is match state, not configuration, and it is restored BEFORE the first advert goes out so a phone that
// was rebooted or force-closed mid-match comes back holding what it held. The station is self-authoritative
// and nothing in MC can tell it who owns its point (§5b/§5c, F92).
const CONTROL_KEY = 'brx.station.control';
const savedPoint = (() => { try { return JSON.parse(localStorage.getItem(CONTROL_KEY) || 'null'); } catch (_) { return null; } })();
const point = new ControlPoint({ captureS: settings.captureS, netCap: settings.netCap }).restore(savedPoint);
const advert = new ControlAdvertiser();     // owns `seq` (advert byte 12) and the republish rate limit
// Kind 2, the powerup station (A56). Like the control point it is match state with its own key: a station rebooted
// mid-match must come back knowing whether its item was taken and when the next one spawns.
const POWERUP_KEY = 'brx.station.powerup';
const pu = new PowerupStation({ id: settings.id, item: settings.item || null })
  .restore((() => { try { return JSON.parse(localStorage.getItem(POWERUP_KEY) || 'null'); } catch (_) { return null; } })());
function savePowerup() { try { localStorage.setItem(POWERUP_KEY, JSON.stringify(pu.snapshot())); } catch (_) { /* ignore */ } }
if (savedPoint && Number.isFinite(+savedPoint.seq)) advert.seq = (+savedPoint.seq) & 0xff;   // a scanner must not see seq go backwards across our restart
/** §5d.6: written on every change, read at startup. */
function saveControl() {
  try { localStorage.setItem(CONTROL_KEY, JSON.stringify({ ...point.snapshot(), seq: advert.seq })); } catch (_) { /* ignore */ }
}
const link = new BrxLink({ log });
// `game` is the match scope (§3): a player advert from another match, or a spare phone on a table near the
// point, must not count as a body. The player side already assigns this every second (`app.js` presenceTick);
// the station never did, so `beacon.js`'s filter was dead code here. It only bites once MC arms a non-zero
// game (v1 manual stations stay at 0 = any), which is exactly when two games share a field.
const presence = new Presence({ defaultThreshold: settings.threshold, dwellMs: settings.dwell, alpha: 0.35, game: settings.game });
const wasAlive = new Map();          // player id → alive bit, to count revives that happened here
let revives = 0, scanning = false, _lastScanRestart = 0, _scanBusy = false, _twin = 0;
const scanGuard = new ScanGuard(); let _scanModeIdx = 0, _scanModeSince = 0;   // a crowded field drops the player watch to balanced (scanwatch.js)
const SCAN_RESTART_MS = 8000;        // S6: a long scan STALLS on Android, worse while we also advertise — restart it on this cadence (8s > the ~6s floor Android's ~5-starts/30s throttle imposes)

/** The advert triple this kind publishes. A control point's is LIVE state (owner / progress / contested),
 *  so `settings.team` does not apply to it at all: ownership is decided by play, not by the operator. */
function advertFields() {
  if (settings.kind === 'control') return point.advert();
  // A56: a powerup station with an item advertises its item's state: 1 available, or 0 with the seconds to the next
  // spawn and the winner in byte 15 (`taker`); 0 with value 0 until MC's first `station_update` (unknown).
  if (settings.kind === 'powerup' && pu.item) return { team: settings.team, ...pu.advert(Date.now()) };
  return { team: settings.team, state: 1, value: 0 };
}
function stationUuid() {
  const f = advertFields();
  return encodeUuid({ role: 'station', id: settings.id, kind: settings.kind, team: f.team, state: f.state, value: f.value, seq: advert.seq, game: settings.game, threshold: settings.threshold, taker: f.taker || 0 });
}
/** `quiet` is the control point's once-a-second progress republish: it re-keys the advert but says nothing
 *  new, and logging it would bury a whole match's real events under a wall of UUIDs. */
async function startAdvert(quiet = false) {
  // Record the intent FIRST, whatever happens next: `seq` (byte 12) bumps on every change, and the
  // republish check in tick() is driven off what we last decided to publish. Doing this inside the try
  // below left the stage (no radio) asking to republish on every 250 ms tick, forever.
  advert.published(advertFields(), Date.now());
  if (DEMO) { advertising = true; settings.live = true; save(); if (!quiet) log('stage: pretending to advertise', 'lk'); render(); return; }   // the harness has no radio (the plugin's web stub answers "no")
  if (!plugins.beacon) { log('no beacon plugin: this build cannot advertise (desktop?)', 'le'); render(); return; }
  // START is a deployment boundary before the native promise settles. Hide/cancel the recovery exit now,
  // not after iOS/Android finishes powering the advertiser on.
  advertisingPending++;
  render();
  try {
    const uuid = stationUuid();
    const name = `BRX-${settings.kind.toUpperCase()}-${settings.id}`;
    const r = await plugins.beacon.start({ uuid, name, txPower: settings.tx, mode: 'lowLatency', includeTxPower: true });
    advertising = !!(r && r.advertising);
    settings.live = advertising; save();   // a reload mid-game comes back advertising (the settings stay behind the ⓘ gate)
    if (!quiet) log(`advertising ${name} as ${TEAM_NAMES[settings.team]} · tx ${r && r.txPowerControl ? settings.tx : 'platform default'} · threshold ${settings.threshold} dBm · ${uuid}`, 'lk');
  } catch (e) { advertising = false; settings.live = false; save(); log('advertise failed: ' + (e && e.message || e), 'le'); }
  finally { advertisingPending = Math.max(0, advertisingPending - 1); }
  render();
}
// ---------- Mission Control: hello as a utility node, take `station_config` (A13.5) ----------
let transport = null, mcState = 'offline';
const TEAM_ID_TO_TID = { blue: 1, yellow: 2, red: 0, green: 3, any: TEAM_ANY, ffa: TEAM_ANY };
function mcUrl() { const q = new URLSearchParams(location.search).get('mc'); if (q) return q; if (settings.mc) return settings.mc; try { return localStorage.getItem('brx.mc_url') || ''; } catch (_) { return ''; } }
/** Apply MC's arming message: kind / team / id / threshold / game / valid_ids → the advert; mark MC-ARMED; come up live. */
async function applyStationConfig(body) {
  if (!body || typeof body !== 'object') return;
  if (body.kind && KIND_LABEL[body.kind]) settings.kind = body.kind;
  if (body.team != null) settings.team = typeof body.team === 'number' ? body.team : (TEAM_ID_TO_TID[String(body.team).toLowerCase()] ?? settings.team);
  if (Number.isFinite(+body.id) && +body.id >= 1) settings.id = Math.min(65535, Math.round(+body.id));
  if (Number.isFinite(+body.threshold)) settings.threshold = Math.max(-100, Math.min(-30, Math.round(+body.threshold)));
  const wasGame = settings.game;
  settings.game = Number.isFinite(+body.game) ? (+body.game & 0xff) : 0;   // absent = 0 (any game), v1
  // A NEW game must not resume the last one's owner with the last one's possession seconds in the tally.
  // Arming is the only signal a station gets that a match changed (it is deliberately offline for the rest of
  // one), so this is where the point resets. The manual button behind the seven-tap gate is the field
  // fallback, not the mechanism.
  if (settings.game !== wasGame) resetPoint(`MC armed game ${settings.game}`);
  // A56: the item this powerup station grants, locked for the match (Tony: one item per station, never random).
  settings.item = settings.kind === 'powerup' && body.item && typeof body.item === 'object' ? body.item : null;
  pu.id = settings.id; pu.item = settings.item;
  if (settings.game !== wasGame) { pu.available = null; pu.nextAt = null; pu.taker = 0; pu.ringAt = null; savePowerup(); }
  settings.mcArmed = { game: settings.game, at: Date.now(), valid_ids: Array.isArray(body.valid_ids) ? body.valid_ids.slice(0, 32) : null };
  save();
  log(`MC armed this phone: ${KIND_LABEL[settings.kind]} · ${TEAM_NAMES[settings.team] || settings.team} · station ${settings.id} · threshold ${settings.threshold} dBm · game ${settings.game}`, 'lk');
  if (window.brxUtilityGate) window.brxUtilityGate.close();   // the operator armed it: the drawer has no business being open
  await startAdvert();
}
function utilityStatusBody() {
  return { role: 'utility', kind: settings.kind, team: settings.team, station_id: settings.id, threshold: settings.threshold, live: advertising, revives, armed: !!settings.mcArmed,
    app_ver: UTIL_VER, ...(lastBattery != null ? { battery: lastBattery } : {}),   // roadmap A3: the heartbeat, not just the hello, so MC's ITEMS panel stays current without a reconnect
    // §5c: the station is self-authoritative and reports at recap. For a control point that report is the
    // owner, the conversion progress and who held it for how long — MC is not live mid-match and cannot
    // have watched any of it (F92).
    ...(settings.kind === 'control' ? { control: { owner: point.owner, progress: Math.round(point.progress), contested: point.contested,
      hold_ms: point.holdMs, capture_log: point.log.slice(-32), capture_s: settings.captureS, net_cap: settings.netCap } } : {}) };
}
function connectMc(url, { wsFactory, trusted = true, pub, secret } = {}) {
  if (!url) return;
  if (trusted) { settings.mc = url; settings.mc_auto = false; save(); }
  if (transport) { try { transport.close(); } catch (_) { /* ignore */ } }
  transport = new Transport({ node: { node_type: 'utility', app_ver: UTIL_VER }, gun: null, keyPrefix: 'brxu', ...(wsFactory ? { wsFactory } : {}) });   // its own node id: never the HUD's
  transport.armedOrLive = true;                            // keep dialling — at muster the operator is waiting on this
  transport.setStatusProvider(utilityStatusBody);
  // A41: the operator's MC-side release for a phone stuck in utility mode -- makes the ⓘ gesture's own
  // BACK TO HUD a real, reachable fix instead of folklore ("something pushed from MC"). Any phase, any
  // arm state: this is the one message that gets a phone unstuck, so it is never conditioned on anything.
  transport.onMessage(m => {
    if (!m) return;
    if (m.kind === 'station_config') applyStationConfig(m.body);
    else if (m.kind === 'station_update') applyStationUpdate(m.body);
    else if (m.kind === 'control' && m.body && m.body.cmd === 'release_utility') { log('Mission Control released this phone back to HUD', 'lk'); exitToHud(); }
  });
  transport.onState(s => { mcState = s; if (s === 'bound' && flushTaken()) savePowerup(); log(`MC ${s}${transport.rejected ? ' — ' + transport.rejected.reason : ''}`, s === 'bound' ? 'lk' : 'li'); render(); });
  transport.connect({ url, trusted, pub, secret }).then(() => {
    // An automatically discovered endpoint becomes the remembered fallback only after MC proves itself
    // with a welcome. Until then another mDNS result may replace a stale or non-MC websocket.
    if (!trusted && transport && transport.state === 'bound') { settings.mc = url; settings.mc_auto = true; save(); }
  }).catch(e => log('MC connect: ' + (e && e.message || e), 'le'));
}
// Utility mode is an explicit operator choice, so it may auto-join the MC service on this LAN. A utility
// phone has no player takeover key and cannot silently change a player's binding; discovery therefore skips
// the player's tap-to-join rule. A typed `?mc=`/remembered URL still wins and remains the offline fallback.
function startUtilityDiscovery() {
  if (!plugins.zeroconf || !isNative() || (mcUrl() && !settings.mc_auto)) return;
  try {
    plugins.zeroconf.watch({ type: '_openbrx._tcp.', domain: 'local.' }, res => {
      if (mcState === 'bound' || !res || (res.action !== 'resolved' && res.action !== 'added')) return;
      const svc = res.service || {};
      const ip = svc.ipv4Addresses && svc.ipv4Addresses[0];
      if (!ip || !svc.port) return;
      const path = svc.txtRecord && svc.txtRecord.ws_path || '/ws';
      const url = `ws://${ip}:${svc.port}${path}`;
      log(`MISSION CONTROL FOUND — CONNECTING ${url}`, 'lk');
      if (!transport || transport.url !== url) connectMc(url, { trusted: false });
    }).catch(e => log('MC discovery: ' + (e && e.message || e)));
  } catch (e) { log('MC discovery: ' + (e && e.message || e)); }
}
async function scanUtilityQr() {
  if (!navigator.mediaDevices?.getUserMedia) { log('QR scan unavailable — enter the MC address below', 'le'); return; }
  const panel = $('qrPanel');
  const video = $('qrVideo') || document.createElement('video'); video.setAttribute('playsinline', ''); video.muted = true;
  if (!video.parentNode && panel) panel.prepend(video);
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const cancel = $('btnQrCancel'); if (panel) panel.hidden = false;
  let stream = null, done = false;
  const stop = () => { done = true; if (stream) stream.getTracks().forEach(t => t.stop()); if (panel) panel.hidden = true; };
  if (cancel) cancel.onclick = stop;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); video.srcObject = stream; await video.play(); }
  catch (e) { stop(); log('QR camera unavailable: ' + e.message, 'le'); return; }
  const tick = () => {
    if (done) return;
    if (video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.drawImage(video, 0, 0); const img = ctx.getImageData(0, 0, canvas.width, canvas.height); const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' }); const join = code && parseMcJoin(code.data); if (join) { stop(); connectMc(join.url, { trusted: true, pub: join.pub, secret: join.secret }); return; } }
    requestAnimationFrame(tick);
  };
  tick();
}
// ---------- stage harness: a station_config through the REAL wire, not a bare function call ----------
// screens.mjs #49 used to call `applyStationConfig()` directly, which never touched the Transport at all --
// no envelope, no `_onFrame`, no `DELIVERED` check. `?stage` never calls `connectMc` (setup needs Wi-Fi, play
// does not), so there was no socket to drive; this fakes ONE (hello -> welcome, same as a real MC) so the
// harness can hand it a real `station_config` frame and exercise the exact path a live socket runs
// (review 2026-09-11 lane-4, F106-adjacent S5(c)).
let _stageWs = null;
function stageWsFactory() {
  const ws = { close() {} };
  ws.send = raw => {
    let env; try { env = JSON.parse(raw); } catch (_) { return; }
    if (env.kind === 'hello') setTimeout(() => { if (ws.onmessage) ws.onmessage({ data: encode(makeEnvelope('welcome', { session_id: 'stage', server_t: Date.now(), seq_hi: 0, node_key: 'stage-utility-key' })) }); }, 0);
  };
  _stageWs = ws;
  setTimeout(() => { if (ws.onopen) ws.onopen(); }, 0);
  return ws;
}
/** Deliver a real MC->node envelope through the fake stage socket (e.g. `mcMessage('station_config', {...})`). */
function stageMcMessage(kind, body) {
  if (!_stageWs || !_stageWs.onmessage) return;
  _stageWs.onmessage({ data: encode(makeEnvelope(kind, body)) });
}

async function stopAdvert() {
  try { if (plugins.beacon) await plugins.beacon.stop(); } catch (_) { /* ignore */ }
  advertising = false; settings.live = false; save(); log('advertising stopped'); render();
}
async function restartIfLive() { if (advertising) await startAdvert(); else render(); }

/** Field 2026-09-12: the ONLY exit from utility mode was this same code, reachable only through the
 *  seven-tap-in-3s gate on ⓘ that opens the settings drawer BACK TO HUD lives inside -- one gesture with
 *  zero feedback on a single tap, and an Android needed its app storage wiped, an iPhone needed someone
 *  walked through the gesture over chat. Now called from THREE places, all converging here: the drawer's
 *  own BACK TO HUD button (unchanged), the plain `#exitHud` hold-to-confirm control on the main screen
 *  (visible only while this phone is NOT MC-armed -- `render()`), and an operator's MC release
 *  (`control{cmd:"release_utility"}`, A41, `state.py release_station`). */
async function exitToHud() {
  // Flush the latest self-authoritative tally while the old utility socket is still bound and before
  // stopAdvert() changes `live`. The periodic heartbeat can otherwise be almost two seconds old.
  if (transport) transport.status(utilityStatusBody());
  await stopAdvert();
  try {
    // F184: utility and HUD deliberately own different node ids (`brxu` / `brx`). Hand the old id and
    // its takeover key to the HUD so MC can authenticate the physical role transition, consume the old
    // ITEMS row, then acknowledge that consumption. A node that was never welcomed has no proof to hand on.
    if (transport && transport.nodeId && transport.nodeKey) {
      localStorage.setItem(PRIOR_UTILITY_KEY, JSON.stringify({ node_id: transport.nodeId, node_key: transport.nodeKey }));
    }
    localStorage.setItem('brx.role', 'hud');
  } catch (_) { /* ignore */ }
  location.replace('index.html?hud');
}

async function startScan() {
  if (scanning || !isNative()) return;
  scanning = true;
  // scanMode 2 (low latency), not 1 (balanced): Android throttles a balanced scan so hard that presence
  // froze on the player side (app.js, hardware 2026-09-04), and the station reads player adverts through
  // the same starved radio (S6). A station is usually stationary/plugged, so the battery cost is fine.
  scanGuard.reset(Date.now());
  try { await link.scan(hit => { if (hit.uuids && hit.uuids.length) presence.observe(hit.uuids, hit.rssi, Date.now()); }, { scanMode: SCAN_MODES[_scanModeIdx], onRaw: () => scanGuard.hit(Date.now()) }); _lastScanRestart = Date.now(); log('watching for players'); }
  catch (e) { scanning = false; log('scan: ' + (e && e.message || e), 'le'); }
}
// S6: stop+start to recover a scan whose callbacks Android silently paused (advertise+scan on one radio
// starves it; the station then reads ZERO player adverts though everyone is advertising, hardware 2026-09-04).
async function refreshScan() {
  if (!isNative() || _scanBusy) return;   // one restart at a time: the stop→start gap must not race a concurrent tick
  _scanBusy = true;
  try { if (scanning) { await link.stopScan(); scanning = false; } await startScan(); }
  catch (_) { /* ignore */ }
  finally { _scanBusy = false; }
}

let _lastBatteryPoll = 0;
const BATTERY_POLL_MS = 30000;   // roadmap A3: battery does not need 250 ms resolution, and Device.getBatteryInfo is async
function tick() {
  const now = Date.now();
  if (now - _lastBatteryPoll >= BATTERY_POLL_MS) { _lastBatteryPoll = now; readBattery().then(b => { lastBattery = b; }); }
  // S6: keep the player-watch scan alive. Recover one stuck OFF (a startScan() throw left scanning=false),
  // and restart a possibly-stalled one on a period so the station keeps hearing planting/defusing/reviving
  // players. Mirrors the player-side beacon-scan refresh in app.js.
  if (isNative() && !_scanBusy) {
    if (!scanning) { startScan().catch(() => {}); }
    else {
      const { rate, over } = scanGuard.check(now);
      const step = stationScanStep({ over, idx: _scanModeIdx, since: _scanModeSince, now });
      if (step.tripped) log(`ble scan flood: ${rate} results/s (budget ${scanGuard.budget}); player watch drops to scanMode ${SCAN_MODES[step.idx]}`, 'le');
      _scanModeIdx = step.idx; _scanModeSince = step.since;
      if (step.restart || now - _lastScanRestart >= SCAN_RESTART_MS) refreshScan().catch(() => {});
    }
  }
  presence.defaultThreshold = settings.threshold;
  presence.game = settings.game;
  presence.tick(now);
  const seen = new Set();
  for (const p of presence.players()) {
    seen.add(p.id);
    const alive = !!(p.state & PLAYER_STATE.alive); const was = wasAlive.get(p.id);
    if (was === false && alive && p.present && settings.kind === 'respawn') { revives++; log(`player ${p.id} (${TEAM_NAMES[p.team] || p.team}) revived here`, 'lk'); }
    wasAlive.set(p.id, alive);
  }
  for (const id of wasAlive.keys()) if (!seen.has(id)) wasAlive.delete(id);   // don't grow unbounded over a long session
  if (settings.kind === 'control') controlTick(now);
  if (settings.kind === 'powerup') powerupTick(now);
  // Two control points on the same station id are ONE presence entry on every player phone (`beacon.js` keys
  // `station:<id>`), so their adverts alternate and every reader sees the owner flip several times a second.
  // Nothing on the reader side can separate them -- the id IS the identity -- so the only real fix is the
  // operator seeing it, and the default id is 1 on every fresh install.
  _twin = presence.stations().some(e => e.id === settings.id && e.kind === settings.kind) ? settings.id : 0;
  render();
}

// ---------- kind 2: the powerup station (A56, docs/spec/powerups.md) ----------
/** MC's `station_update {id, available, next_spawn_in_ms}`: the time REMAINING, re-anchored on arrival. */
function applyStationUpdate(body) {
  if (!body || typeof body !== 'object') return;
  if (body.id != null && +body.id !== settings.id) return;
  pu.update(body, Date.now()); savePowerup();
  log(`MC: item ${body.available ? 'AVAILABLE' : 'TAKEN'}${Number.isFinite(+body.next_spawn_in_ms) ? ` · next spawn in ${Math.round(+body.next_spawn_in_ms / 1000)} s` : ''}`, 'li');
  if (settings.live) startAdvert();
  render();
}
/** Polish M1: send every queued `taken` report MC has not had (`station_action`, the MC lane's kind). A report stays
 *  queued until the socket takes it, so MC cannot re-open an item it never heard was given away. `t` is re-based from
 *  this phone's clock onto the synced one. True when something left the queue. */
let _takenFailAt = 0;
function flushTaken() {
  if (!pu.unsent.length || !transport || transport.state !== 'bound' || Date.now() - _takenFailAt < 5000) return false;
  const n = pu.drain(b => {
    try { if (transport.report('station_action', { ...b, t: transport.syncedNow() - (Date.now() - b.t) })) return true; }
    catch (err) { log('station_action refused: ' + (err && err.message || err), 'le'); }
    _takenFailAt = Date.now(); return false;   // retried in 5 s, not every tick
  });
  if (n) log(`MC told: ${n} item${n === 1 ? '' : 's'} taken`, 'li');
  return n > 0;
}
/** One step: the self-spawn, then the claims. The station, not the phones, decides who took the item. */
function powerupTick(now) {
  if (!pu.item) return;
  let { changed, events } = pu.tick(presence.players(), now);
  for (const e of events) {
    if (e.type === 'spawned') { log(`${pu.item.name} SPAWNED`, 'lk'); flash(`${String(pu.item.name).toUpperCase()} AVAILABLE`, 'any'); }
    else if (e.type === 'taken') {
      log(`${pu.item.name} TAKEN by player ${e.player_num}`, 'lk'); flash(`TAKEN · P${e.player_num}`, 'any');
    }
  }
  if (flushTaken()) changed = true;   // polish M1: queued, so a report lost to a dead link goes out on re-bind
  if (changed || events.length) savePowerup();
  if (!settings.live) return;
  if (!advertising) { if (now - _advertRetryAt >= 1000) { _advertRetryAt = now; startAdvert(); } return; }
  const why = advert.due(advertFields(), now);
  if (why) startAdvert(why === 'progress');   // the countdown ticking down is a quiet re-key; taken / available is logged
}

// ---------- kind 5: the control point ----------
/** One step of the point (control.js does the arithmetic), then its log lines, its save and its advert.
 *  Nothing here needs MC: the station counts the bodies in its own bubble and publishes the answer. */
function controlTick(now) {
  point.captureS = settings.captureS; point.netCap = settings.netCap;
  const { changed, events } = point.update(presence.players(), now);
  for (const e of events) {
    if (e.type === 'captured') { log(`${TEAM_NAMES[e.team]} CAPTURED the point${e.from != null ? ` from ${TEAM_NAMES[e.from]}` : ''}`, 'lk'); flash(`CAPTURED BY ${TEAM_NAMES[e.team]}`, TEAM_KEYS[e.team]); }
    else if (e.type === 'neutralised') { log(`${TEAM_NAMES[e.team]} LOST the point — ${TEAM_NAMES[e.by]} drained it to neutral`, 'lk'); flash('NEUTRAL', 'any'); }
    else if (e.type === 'contested') log(`CONTESTED: ${netLine()}`, 'li');
    else if (e.type === 'uncontested') log('no longer contested', 'li');
    else if (e.type === 'refused') log('F82: a player on tid 2 is standing here. Team 2 is what a NEUTRAL point broadcasts, so it can never hold one — reassign that team in Mission Control (use red/blue/green).', 'le');
  }
  // §5d.6: written on EVERY change, read at startup. A 1 Hz throttle was tried and left the saved value up
  // to a second of conversion behind the screen, so a reload visibly went backwards (tools/screens.mjs #56
  // caught 38% coming back as 33%). A small JSON four times a second on a propped-up station is not a cost
  // worth that.
  if (changed || events.length) saveControl();
  // Republish when the advert would say something new. `due()` sends owner/held/contested/direction changes
  // at once and rate-limits a progress-only change, so the Android advertiser is not stopped and started
  // four times a second.
  //
  // ⚠ Gated on `settings.live` (what the operator asked for), NOT on `advertising` (whether the last start
  // worked). A single throw inside `startAdvert` clears `advertising`, and gating the republish on it meant
  // one failed restart silenced the point for the rest of the match with the screen still reading LIVE.
  // Backed off so a broken radio is retried once a second, not four times.
  if (!settings.live) return;
  if (!advertising) {
    if (now - _advertRetryAt >= 1000) { _advertRetryAt = now; log('the advert is down — retrying', 'le'); startAdvert(); }
    return;
  }
  const why = advert.due(point.advert(), now);
  if (why) startAdvert(why === 'progress');   // a progress-only re-key is silent in the log; a change of owner/contest is not
}
/** Hand the point back to nobody: between games (a `station_config` naming a new game) or from the button. */
function resetPoint(why) {
  point.owner = CONTROL_NEUTRAL; point.capturing = null; point.progress = 0; point.lastOwner = null;
  point.holdMs = {}; point.log = []; point.contested = false; point.dir = 0; point.net = 0; point.refusedSeen = false;
  saveControl();
  log(`control point reset to NEUTRAL (${why})`, 'lk');
}
/** §5d.4: a one-shot full-width flash and a large word at each crossing — "the moment must be unmistakable
 *  from across a room". It is the transition the GUN cannot show (a callout is one 2 s clip); the screen can. */
let _flashAt = 0;
function flash(word, teamKey) {
  const el = $('cflash'); if (!el) return;
  $('cflashw').textContent = word; el.dataset.fteam = teamKey || 'any'; el.hidden = false;
  el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');   // restart the animation on a second crossing
  _flashAt = Date.now();
}
/** "RED 2 · BLU 1 → +1 RED" (§5d.4). */
function netLine() {
  const parts = Object.keys(point.counts).map(Number).sort((a, b) => point.counts[b] - point.counts[a] || a - b)
    .map(t => `${TEAM_ABBR[t] || t} ${point.counts[t]}`);
  if (!parts.length) return 'NOBODY ON THE POINT';
  return parts.join(' · ') + (point.net > 0 ? ` → +${point.net} ${TEAM_ABBR[point.lead]}` : ' → STALLED');
}
/** §5d.4: possession seconds per team, so the screen IS the recap sheet if nobody ever collects it. */
function tallyLine() {
  const ids = Object.keys(point.holdMs).map(Number).filter(t => point.holdMs[t] >= 1000).sort((a, b) => point.holdMs[b] - point.holdMs[a]);
  if (!ids.length) return '';
  return 'HELD · ' + ids.map(t => `${TEAM_ABBR[t] || t} ${mmss(point.holdMs[t])}`).join(' · ');
}
const mmss = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// ---------- screen ----------
function render() {
  const isControl = settings.kind === 'control';
  const v = point.advert();
  const heldBy = (v.state & CONTROL_STATE.held) ? v.team : null;    // who OWNS it (null = nobody)
  // A control point paints the whole screen the OWNER's colour, so a glance from across the field reads
  // ownership before anything else; every other kind paints its assigned team, as before.
  const t = TEAM_KEYS[isControl ? (heldBy == null ? TEAM_ANY : heldBy) : settings.team] || 'any';
  document.documentElement.dataset.team = t;
  document.documentElement.dataset.cstate = !isControl ? 'off'
    : point.contested ? 'contested' : point.dir > 0 ? 'rising' : point.dir < 0 ? 'falling' : (heldBy != null ? 'held' : 'idle');
  $('kind').textContent = KIND_LABEL[settings.kind] || settings.kind.toUpperCase();
  $('team').textContent = isControl ? (heldBy == null ? 'NEUTRAL' : (TEAM_NAMES[heldBy] || `TEAM ${heldBy}`))
    : (TEAM_NAMES[settings.team] || `TEAM ${settings.team}`);
  renderControl(isControl, v, heldBy);
  renderPowerup();
  $('sid').textContent = `STATION ${settings.id}`; $('sidn').textContent = settings.id;
  $('status').textContent = advertising ? 'LIVE' : (plugins.beacon && support.advertising ? 'READY' : 'CANNOT ADVERTISE');
  $('status').className = 'status ' + (advertising ? 'on' : 'off');
  $('revives').textContent = settings.kind === 'respawn' ? `${revives} REVIVED HERE` : '';
  $('txhint').textContent = support.txPowerControl ? (TX_HINT[settings.tx] || '') : 'no transmit-power control on this platform · radius = threshold only';
  $('thr').textContent = `${settings.threshold} dBm`; $('thrRange').value = settings.threshold;
  $('dwell').textContent = `${(settings.dwell / 1000).toFixed(1)} s`;
  $('btnStart').textContent = advertising ? 'STOP' : 'START';
  const armed = settings.mcArmed;
  $('armed').textContent = armed ? `MC-ARMED · GAME ${armed.game || 0}` : 'NOT ARMED BY MISSION CONTROL';
  $('armed').className = 'armed ' + (armed ? 'on' : '');
  // A41 / field-safety fix (2026-09-13): the plain exit is for a phone NOBODY has claimed as a field
  // item yet. MC-arming is not the only way that happens -- the seven-tap gate's own drawer has a
  // START button (`btnStart`), and the station warnings promise exactly that: a station can be armed
  // BY HAND, behind the seven-tap gate, with no Mission Control involved at all. `!!armed` alone missed
  // that path entirely, so a hand-armed station -- a live control point, respawn station, whatever kind
  // -- kept a one-second-hold exit sitting in the open on its main screen. `wireExit()`'s hold handler
  // checks nothing but this element's `hidden`, so that hold was the ONLY guard standing between a
  // stray press and pulling a live objective off the field mid-match. `advertising` is true exactly
  // when this phone is actually broadcasting itself as a field item, by either arming path (MC or
  // hand), so gate on that instead of re-deriving "hand-armed" separately. A phone that is merely
  // configured but not yet started (drawer open, START not pressed) is inert -- nothing is on the air
  // for a player to have found -- so it correctly keeps the quick exit. The deliberate way back out for
  // a genuinely live station stays: the seven-tap gate -> drawer -> BACK TO HUD (`btnHud`, unconditional
  // once you're behind the gate) for the operator standing at the phone, and MC's
  // `control{cmd:"release_utility"}` (`exitToHud` via `onMessage`, above) for one that isn't reachable.
  if ($('exitHud')) $('exitHud').hidden = !!armed || settings.live || advertising || advertisingPending > 0;
  // S5(d): the allow-list this phone was armed with -- the operator's own confirmation that MC's ITEMS
  // panel and this phone's advert agree on which ids are live in this game.
  const idsEl = $('ids');
  if (idsEl) idsEl.textContent = (armed && Array.isArray(armed.valid_ids) && armed.valid_ids.length) ? `VALID IDS: ${armed.valid_ids.join(', ')}` : '';
  const mcText = mcState === 'bound' ? 'MISSION CONTROL ✓ LINKED' : mcState === 'offline' ? (settings.mc ? 'MISSION CONTROL · OFFLINE' : 'MISSION CONTROL · SEARCHING THIS WI-FI') : `MISSION CONTROL · ${mcState.toUpperCase()}…`;
  $('mcstate').textContent = mcText;
  const mainState = $('mcstateMain'); if (mainState) mainState.textContent = mcText;
  const mainInput = $('mcUrlMain'); if (mainInput && document.activeElement !== mainInput) mainInput.value = settings.mc || mcUrl() || '';
  if (document.activeElement !== $('mcUrl')) $('mcUrl').value = settings.mc || mcUrl() || '';
  const rows = presence.players().map(p => {
    const alive = !!(p.state & PLAYER_STATE.alive);
    // On a control point the row IS the contribution readout (§5d.4): `claim` is a body actually converting
    // the point (present + alive + a team that may hold one), DOWN is struck through, and in range but off
    // the point is dimmed. The three COMPOSE rather than ranking: a body that is both down and out of range
    // is both, and ranking them silently dropped one of the two facts the operator reads the row for.
    const claim = isControl && p.present && alive && claimable(p.team);
    // F82: a tid-2 body standing here converts nothing, and the row has to say so. Left unmarked it read
    // exactly like a contributor -- highlighted, green ON POINT -- two lines under a net line saying
    // NOBODY ON THE POINT. A down body is struck through; a refused one gets its own word and colour.
    const refused = isControl && p.present && alive && !claimable(p.team);
    const label = isControl ? (refused ? "CAN'T HOLD" : p.present ? 'ON POINT' : '') : (p.present ? 'AT STATION' : '');
    const mark = !isControl ? '' : `${alive ? '' : ' dead'}${p.present ? '' : ' far'}${claim ? ' claim' : ''}${refused ? ' refused' : ''}`;
    return `<div class="row ${p.present ? 'near' : ''}${mark}" style="--rowteam:var(--team-${TEAM_KEYS[p.team] || 'any'})"><span class="pid">P${p.id}</span><span class="pteam ${TEAM_KEYS[p.team] || 'any'}">${TEAM_NAMES[p.team] || p.team}</span><span class="rssi">${Math.round(p.rssi)}<small>/${Math.round(p.raw)} dBm</small></span><span class="state ${alive ? 'alive' : 'down'}">${alive ? 'ALIVE' : 'DOWN'}</span><span class="pres${refused ? ' no' : ''}">${label}</span></div>`;
  });
  $('players').innerHTML = rows.join('') || '<div class="row empty">no player phones in range</div>';
  $('ptitle').textContent = isControl ? 'WHO IS ON THE POINT' : 'PLAYER PHONES IN RANGE';
  $('capS').textContent = `${settings.captureS} S`;
  $('netCap').textContent = `${settings.netCap}`;
  $('teamnote').hidden = !isControl;
  for (const b of document.querySelectorAll('[data-tx]')) b.classList.toggle('sel', b.dataset.tx === settings.tx);
  for (const b of document.querySelectorAll('[data-kind]')) b.classList.toggle('sel', b.dataset.kind === settings.kind);
  for (const b of document.querySelectorAll('[data-team]')) b.classList.toggle('sel', +b.dataset.team === settings.team);
}

/** A56: the powerup station's screen. The item's name in its own colour, AVAILABLE or TAKEN with the countdown, and
 *  a 1 s ring from the first `claiming` advert it hears. */
function renderPowerup() {
  const el = $('pup'); if (!el) return;
  const on = settings.kind === 'powerup' && !!pu.item;
  el.hidden = !on;
  if (!on) { delete document.documentElement.dataset.kindItem; return; }
  const now = Date.now(), v = pu.view(now), item = pu.item;
  document.documentElement.dataset.kindItem = '';
  document.documentElement.style.setProperty('--item', /^#[0-9a-f]{6}$/i.test(item.color || '') ? item.color : 'var(--glow)');
  $('team').textContent = String(item.name || 'POWERUP').toUpperCase();
  el.dataset.pstate = v.available === true ? (v.ringAt != null ? 'claiming' : 'available') : v.available === false ? 'taken' : 'unknown';
  $('pstate').textContent = v.available === true ? (v.ringAt != null ? 'HOLD STILL' : 'AVAILABLE') : v.available === false ? 'TAKEN' : 'WAITING FOR MISSION CONTROL';
  $('pnext').textContent = v.available === false && v.nextInMs != null ? `NEXT ${mmss(v.nextInMs + 999)}` : '';
  $('ptaker').textContent = v.available === false && v.taker ? `BY PLAYER ${v.taker}` : '';
  const ring = $('pring'); const p = v.ringAt != null ? Math.min(1, (now - v.ringAt) / 1000) : 0;
  ring.hidden = v.ringAt == null;
  ring.style.setProperty('--p', p.toFixed(3));
  ring.setAttribute('aria-valuenow', String(Math.round(p * 100)));
}

/** The animated part: owner, a progress bar with the DIRECTION and speed of change, the net push, and the
 *  one line a defender reads to decide whether to run ("LOST IN 6 S"). CSS does the motion off
 *  `data-cstate` on <html> plus `--cspd`; this only feeds it numbers. */
function renderControl(isControl, v, heldBy) {
  const el = $('control'); el.hidden = !isControl;
  if (!isControl) { $('cflash').hidden = true; return; }
  const holder = v.team;                          // whose progress the bar is (255 = nobody)
  const held = heldBy != null;
  const hname = holder === CONTROL_NEUTRAL ? null : (TEAM_NAMES[holder] || `TEAM ${holder}`);
  $('cfill').style.width = `${v.value}%`;
  // §5d.4: two-toned across the phases — the fill is the OWNER's colour while it drains and the CLAIMANT's
  // while it builds, which falls out of colouring it by whoever byte 9 names.
  $('cfill').style.setProperty('--bar', `var(--team-${TEAM_KEYS[holder] || 'any'})`);
  $('cpct').textContent = `${v.value}%`;
  $('cbar').setAttribute('aria-valuenow', String(v.value));
  $('cbar').setAttribute('aria-valuetext', `${v.value}% ${hname == null ? 'neutral' : `for ${hname}`}`);
  // Speed of change, not just direction: more net players = the stripes move faster. 1.2 s per cycle at
  // net 1, floored so a six-player stack does not strobe.
  $('cbar').style.setProperty('--cspd', `${Math.max(0.3, 1.2 / Math.max(1, point.net)).toFixed(2)}s`);
  // §5d.4: an arrow ON THE MOVING EDGE pointing the way the point is going.
  const arrow = $('carrow');
  arrow.hidden = !point.dir;
  arrow.textContent = point.dir > 0 ? '▶' : '◀';
  arrow.style.left = `${v.value}%`;
  $('cowner').textContent = held
    ? (point.dir < 0 ? 'LOSING IT' : point.dir > 0 ? 'PUSHING BACK' : 'HELD')
    : hname == null ? 'NOBODY HOLDS IT'
    : point.dir > 0 ? `${hname} IS TAKING IT`
    : point.dir < 0 ? `${hname} IS BEING PUSHED OFF`
    : `${hname} STALLED AT ${v.value}%`;
  // §5d.4: the rate as a multiplier from the station's OWN net (not the byte it emits), and STALLED in place
  // of the arrow at net 0.
  $('crate').textContent = point.net > 0 && point.lead != null
    ? `${point.dir < 0 ? '◀' : '▶'} ${TEAM_NAMES[point.lead]} ×${point.net}` : 'STALLED';
  $('cnet').textContent = netLine();
  const secs = point.timeToChange();
  // What the number MEANS depends on which way it is going and whose it is. These four are the whole story.
  $('ceta').textContent = secs == null ? '' : point.dir > 0
    ? (held ? `SECURE IN ${Math.ceil(secs)} S` : `${hname} TAKES IT IN ${Math.ceil(secs)} S`)
    : (held ? `LOST IN ${Math.ceil(secs)} S` : `${hname} PUSHED OFF IN ${Math.ceil(secs)} S`);
  $('cbanner').textContent = point.contested ? 'CONTESTED' : '';
  $('ctally').textContent = tallyLine();
  $('cwarn').textContent = _twin ? `ANOTHER STATION IS ALSO ON ID ${_twin} — TWO POINTS SHARING AN ID LOOK LIKE ONE POINT TO EVERY PLAYER PHONE. GIVE THEM DIFFERENT IDS.`
    : point.refusedSeen ? 'A PLAYER ON TEAM 2 IS HERE — TEAM 2 CAN NEVER HOLD A POINT (F82). REASSIGN IN MISSION CONTROL.' : '';
  if (_flashAt && Date.now() - _flashAt > 2600) { _flashAt = 0; $('cflash').hidden = true; }
}

function wire() {
  $('btnStart').onclick = () => (advertising ? stopAdvert() : startAdvert());
  $('btnMc').onclick = () => connectMc($('mcUrl').value.trim());
  if ($('btnMcMain')) $('btnMcMain').onclick = () => connectMc($('mcUrlMain').value.trim());
  if ($('btnQrMain')) $('btnQrMain').onclick = () => scanUtilityQr();
  $('btnHud').onclick = exitToHud;
  for (const b of document.querySelectorAll('[data-kind]')) b.onclick = () => { settings.kind = b.dataset.kind; save(); restartIfLive(); };
  for (const b of document.querySelectorAll('[data-team]')) b.onclick = () => { settings.team = +b.dataset.team; save(); restartIfLive(); };
  for (const b of document.querySelectorAll('[data-tx]')) b.onclick = () => { settings.tx = b.dataset.tx; save(); restartIfLive(); };
  $('idMinus').onclick = () => { settings.id = Math.max(1, settings.id - 1); save(); restartIfLive(); };
  $('idPlus').onclick = () => { settings.id = Math.min(65535, settings.id + 1); save(); restartIfLive(); };
  $('thrRange').oninput = e => { settings.threshold = +e.target.value; save(); render(); };
  $('thrRange').onchange = () => restartIfLive();
  $('capMinus').onclick = () => { settings.captureS = Math.max(2, settings.captureS - 1); point.captureS = settings.captureS; save(); render(); };
  $('capPlus').onclick = () => { settings.captureS = Math.min(120, settings.captureS + 1); point.captureS = settings.captureS; save(); render(); };
  $('capMinus2').onclick = () => { settings.netCap = Math.max(1, settings.netCap - 1); point.netCap = settings.netCap; save(); render(); };
  $('capPlus2').onclick = () => { settings.netCap = Math.min(12, settings.netCap + 1); point.netCap = settings.netCap; save(); render(); };
  // Between games: hand the point back to nobody without wiping the operator's radius calibration.
  $('btnPointReset').onclick = () => { resetPoint('operator'); restartIfLive(); };
  $('dwellMinus').onclick = () => { settings.dwell = Math.max(0, settings.dwell - 500); presence.dwellMs = settings.dwell; save(); render(); };
  $('dwellPlus').onclick = () => { settings.dwell = Math.min(10000, settings.dwell + 500); presence.dwellMs = settings.dwell; save(); render(); };
  // Calibration: stand where "at the station" should be, holding a player phone, press SET. The threshold
  // becomes that phone's smoothed reading minus 3 dB of slack, and goes out in the advert for every player.
  $('btnSet').onclick = () => {
    const p = presence.players()[0];
    if (!p) { log('SET: no player phone in range to read', 'le'); return; }
    settings.threshold = Math.max(-100, Math.min(-30, Math.round(p.rssi) - 3)); save();
    log(`threshold set from player ${p.id}: ${Math.round(p.rssi)} dBm → ${settings.threshold} dBm`, 'lk');
    restartIfLive();
  };
  wireExit();
}

// A41 / field 2026-09-12: a SECOND, DISCOVERABLE exit that needs no drawer -- the judgement call the
// undiscoverable ⓘ gate forced. Getting back to your own HUD is not the anti-cheat concern (the drawer
// still guards KIND/TEAM/ID/THRESHOLD, untouched); the real risk this button opens is a DEPLOYED station
// propped up on the field where any passerby, teammate or opponent could reach it. So it is HELD to
// confirm (a phone jostled in a bag cannot cross it by itself, matching the entry gesture's own hold),
// and `render()` hides it the moment MC has armed this phone as a real field item (`settings.mcArmed`) --
// only a phone nobody has claimed as a station yet (exactly the "stuck by accident" case) shows it. A
// station already in play stays behind the seven-tap gate, same as today.
const EXIT_HOLD_MS = 1200;
function wireExit() {
  const btn = $('exitHud'), fill = $('exitFill');
  if (!btn) return;
  let t0 = 0, raf = 0, deadline = 0, activePointer = null, activeKey = '', firing = false;
  // State is authoritative; `hidden` can lag while native advertising starts after an MC assignment.
  const deployed = () => !!settings.mcArmed || settings.live || advertising || advertisingPending > 0 || btn.hidden;
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    if (deadline) clearTimeout(deadline);
    raf = 0; deadline = 0; t0 = 0; activePointer = null; activeKey = '';
    if (fill) fill.style.width = '0%';
  };
  const fire = () => {
    if (!t0 || firing) return;
    // `render()` hides this control as soon as the station becomes deployed. A hold begun while the
    // phone was idle must not cross that field-safety boundary and pull a newly live station away.
    if (deployed()) { stop(); return; }
    firing = true;
    stop();
    exitToHud();
  };
  const tick = () => {
    if (!t0) return;
    const p = Math.min(1, (Date.now() - t0) / EXIT_HOLD_MS);
    if (fill) fill.style.width = `${Math.round(p * 100)}%`;
    if (p >= 1) { fire(); return; }
    raf = requestAnimationFrame(tick);
  };
  const start = () => {
    // One physical hold owns the deadline. Ignore a second finger / repeated keydown instead of
    // orphaning the first timer and allowing a later hold to inherit an early exit.
    if (firing || deployed() || t0) return false;
    t0 = Date.now();
    deadline = setTimeout(fire, EXIT_HOLD_MS);
    tick();
    return true;
  };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (start()) activePointer = e.pointerId;
  });
  btn.addEventListener('pointermove', e => {
    if (activePointer !== e.pointerId) return;
    const r = btn.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) stop();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture']) {
    btn.addEventListener(ev, e => { if (activePointer === e.pointerId) stop(); });
  }
  btn.addEventListener('keydown', e => {
    if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat) return;
    e.preventDefault();
    if (start()) activeKey = e.key;
  });
  btn.addEventListener('keyup', e => {
    if (e.key !== activeKey) return;
    e.preventDefault();
    stop();
  });
  btn.addEventListener('blur', stop);
  // Assistive technologies activate a native button with a synthesized click (`detail === 0`) and
  // cannot express a pointer/key hold. That activation is already deliberate confirmation; pointer
  // clicks keep the physical hold requirement and therefore do nothing here.
  btn.addEventListener('click', e => {
    if (e.detail !== 0 || deployed() || firing) return;
    e.preventDefault();
    firing = true;
    stop();
    exitToHud();
  });
}

(async () => {
  wire(); render();
  await loadPlugins();
  try { if (plugins.keepAwake) await plugins.keepAwake.keepAwake(); } catch (_) { /* ignore */ }
  try { if (plugins.beacon) support = await plugins.beacon.isSupported(); } catch (e) { log('isSupported: ' + (e && e.message || e)); }
  if (DEMO) support = { advertising: true, txPowerControl: true, platform: 'stage' };
  log(`utility mode · ${support.platform} · advertise ${support.advertising ? 'yes' : 'NO'} · tx control ${support.txPowerControl ? 'yes' : 'no'}`);
  if (settings.live) await startAdvert();   // it was live when the phone last ran: come straight back up
  readBattery().then(b => { lastBattery = b; });
  render();
  const url = mcUrl();
  // Stage/screens.mjs: no real Wi-Fi to a real MC, but `station_config` must still arrive through the REAL
  // wire (`stageMcMessage`, above), not a bare `applyStationConfig()` call -- so the harness gets a fake but
  // otherwise real transport instead of none at all.
  if (DEMO) connectMc(url || 'stage://mc', { wsFactory: stageWsFactory });
  else if (url) { connectMc(url, { trusted: !settings.mc_auto }); if (settings.mc_auto) startUtilityDiscovery(); }   // setup needs WiFi (A13.5); once armed, play does not
  else startUtilityDiscovery();   // utility mode is an explicit choice: auto-join MC when it advertises on this LAN
  if (!plugins.beacon || !support.advertising) log('this phone cannot advertise; check Bluetooth is on', 'le');
  await startScan();
  setInterval(tick, 250);
  if (DEMO) seedDemo();
  window.brxUtility = { settings, presence, point, pu, advert, startAdvert, stopAdvert, render, log: logLines, stationUuid, advertFields, encodeUuid, applyStationConfig, connectMc, mcMessage: stageMcMessage, exitToHud, get transport() { return transport; } };
  window.brxUtil = window.brxUtility;
})();

/** The stage harness: three fake player phones on a 250 ms timer — one close, one far, one drifting across the threshold. */
function seedDemo() {
  const t0 = Date.now();
  // 19 stays tid 2 and DOWN (the respawn demo); 31 is the opposing CLAIMABLE team a control point needs —
  // tid 2 can never hold a point (F82), so without it the contest could not be demonstrated at all.
  const fake = [{ id: 7, team: 1, alive: true, rssi: () => -58 }, { id: 19, team: 2, alive: false, rssi: () => -80 },
                { id: 23, team: 1, alive: true, rssi: () => -74 + 9 * Math.sin((Date.now() - t0) / 4000) },
                { id: 31, team: 0, alive: true, rssi: () => -70 + 14 * Math.sin((Date.now() - t0) / 11000) }];
  setInterval(() => {
    const now = Date.now();
    // A56: `bits`/`value` let a stage step make a fake phone CLAIM a powerup station (`claiming`/`claim_ready`, station id)
    for (const f of fake) presence.observe([encodeUuid({ role: 'player', id: f.id, kind: 0, team: f.team, state: (f.alive ? PLAYER_STATE.alive : 0) | (f.bits || 0), value: f.value || 0, seq: 0, game: settings.game })], f.rssi() + (Math.random() - .5) * 2, now);
  }, 250);
  window.brxUtilityFake = fake;
}
