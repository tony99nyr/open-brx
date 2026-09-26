// utility.js — the UTILITY role: this phone IS an item on the field (docs/spec/utility.md).
// It advertises its identity (kind / team / state / its own "at me" threshold) in one service UUID via
// the brx-beacon plugin, shows what it is full-screen, and watches player adverts so the operator can
// calibrate the radius by standing where "at the station" should be and pressing SET.
// No gun, no engine: the revive itself happens on the player's phone (engine.js _triggerPulled).
import { BrxLink } from './brxlink.js';
import { ScanGuard, SCAN_MODES, stationScanStep } from './scanwatch.js';   // the BLE flood guard (bench 2026-09-17)
import { Presence, encodeUuid, KIND, TEAM_ANY, PLAYER_STATE, countRevives, stationThreshold, applyThreshold, migrateThreshold } from './beacon.js';
import { ControlPoint, ControlAdvertiser, CONTROL_STATE, NEUTRAL as CONTROL_NEUTRAL, claimable, DEFAULT_CAPTURE_S, DEFAULT_NET_CAP } from './control.js';   // kind 5: the control point (utility.md §5, K1)
import { PowerupStation } from './powerup.js';   // kind 2: the powerup station decides who took its item (A56, docs/spec/powerups.md)
import { Transport } from './transport/transport.js';   // utility.md §5b/§5c: the phone joins MC at muster to be ARMED (contracts A13.5)
import { makeEnvelope, encode } from './transport/envelope.js';   // stage harness only: a real station_config ENVELOPE, not a bare function call (review 2026-09-11 lane-4)
import { APP_VER } from './build.js';   // A29: the REAL build, baked by scripts/build.mjs
import jsQR from 'jsqr';
import { parseMcJoin } from './mcurl.js';
import { startUtilitySweep, resolveTypedMc } from './transport/utility-join.js';   // bench 2026-09-24: the LAN sweep fallback + typed-address parsing
import { makeWsFactory } from './transport/netsocket.js';   // the sweep probes the way app.js does (F311: the Wi-Fi network on Android)
import { RangeEdits, RANGE_KEY, TX_TO_WIRE, txFromWire, rangeHoldMs, RANGE_IDLE_MS } from './rangeedit.js';   // F365 / A67: the on-station range edit, synced to MC
import { createTapHoldGate } from './tapgate.js';   // F365: the RANGE hold reuses the hidden door's knock-safe hold

// A29 (2026-09-12): "utility phones report the same way" -- the same "<version>+<sha>[-dirty]" a player
// node sends, so MC's muster rollup can compare a station phone with the field. It was 'utility-0.2', a
// label MC could not parse as a version (roadmap A3/A5 had already replaced the bare string 'utility').
const UTIL_VER = APP_VER;
const PRIOR_UTILITY_KEY = 'brx.prior_utility';

const $ = id => document.getElementById(id);
// F423: tid 3 paints purple, not green (the gun/headset paint, `poolgauge.TEAM_DISPLAY_COLOURS`) --
// MC's own roster names it team_id "purple" now (state.py TEAM_DEFS), and these three maps must track
// that (`test_team_color_consistency.py`), even though the WIRE identity stays green (F35).
const TEAM_NAMES = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'PURPLE', [TEAM_ANY]: 'ANY TEAM' };
const TEAM_ABBR = { 0: 'RED', 1: 'BLU', 2: 'YEL', 3: 'PUR', [TEAM_ANY]: '—' };   // §5d.4's net line: "RED 2 · BLU 1 → +1 RED"
const TEAM_KEYS = { 0: 'red', 1: 'blue', 2: 'yellow', 3: 'purple', [TEAM_ANY]: 'any' };
const KIND_LABEL = { respawn: 'RESPAWN STATION', powerup: 'POWERUP', extraction: 'EXTRACTION POINT', bomb: 'BOMB SITE', control: 'CONTROL POINT' };
const TX_LEVELS = ['ultraLow', 'low', 'medium', 'high'];
const TX_HINT = { ultraLow: '~ -21 dBm · a few metres', low: '~ -15 dBm', medium: '~ -7 dBm', high: '~ +1 dBm · whole room' };

const logLines = [];
function log(msg, cls = 'li') {
  const t = new Date().toISOString().substr(11, 8); logLines.push(`[${t}] ${msg}`); if (logLines.length > 200) logLines.shift();
  const el = $('log'); if (el) { el.textContent = logLines.slice(-12).join('\n'); el.scrollTop = el.scrollHeight; }
}

// ---------- settings (persisted; the station survives an app restart the way it was) ----------
// mcArmed: {game, at, valid_ids} once MC pushed station_config. threshold 0 = this platform's own default for the
// kind (beacon.js phoneStationThreshold: a respawn station -70, about 3-5 m, F345; a powerup station -55, the ~1 ft claim range, S58; every other kind -74); anything
// else is the operator's or MC's override. 0.8 s dwell = get in range, brief pause, green (bench-tuned 2026-09-04). captureS/netCap belong to kind 5 (§5d.1): seconds ONE net
// player needs for ONE phase, and the clamp on how much a rush can stack.
const DEFAULTS = { kind: 'respawn', team: 1, id: 1, tx: 'high', threshold: 0, thrV: 2, dwell: 800, game: 0, mcArmed: null, mc: '', mc_auto: false,
  captureS: DEFAULT_CAPTURE_S, netCap: DEFAULT_NET_CAP };
const DEMO = /[?&](stage|demo)\b/.test(typeof location !== 'undefined' ? location.search : '');   // the stage harness: no radio, fake players
// F345: settings saved before thrV 2 hold the old -74 default as if chosen; migrateThreshold reads it as 0 once.
const settings = (() => { try { return migrateThreshold({ ...DEFAULTS, ...JSON.parse(localStorage.getItem('brx.utility') || '{}') }); } catch (_) { return { ...DEFAULTS }; } })();
/** The threshold this station advertises (byte 14) and measures players by: the override, else the platform default. */
const thr = () => stationThreshold(settings);
function save() { try { localStorage.setItem('brx.utility', JSON.stringify(settings)); } catch (_) { /* ignore */ } }
// F365 / A67: who set the radius and the strength last (this station or MC), when, and the edit log MC is told about.
// Its own key: RESET TO DEFAULTS forgets `brx.utility`, but the edit `seq` must keep rising or MC would drop new edits.
const range = new RangeEdits({
  load: () => { try { return JSON.parse(localStorage.getItem(RANGE_KEY) || 'null'); } catch (_) { return null; } },
  save: st => { try { localStorage.setItem(RANGE_KEY, JSON.stringify(st)); } catch (_) { /* ignore */ } },
});
/** A58: an MC tamper lock is running (`station_config.lock_s`, from receipt). A phone station keeps working either way;
 *  the lock only makes the on-station RANGE override need the stronger hold (F365) and marks the edit `locked`. */
const a58Locked = () => Number.isFinite(+settings.lockUntil) && +settings.lockUntil > Date.now();

// ---------- plugins ----------
const plugins = {};
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

/** F420 (bench 2026-09-26, green Pixel 5 on 0.4.13): Android 15's edge-to-edge WebView reports
 *  `env(safe-area-inset-top)` as 0 (hud.js's `fit()` hit the identical bug first, on the HUD's own ⓘ),
 *  so the ⓘ that opens the exit drawer sat under the status bar with no way to tap it — with this phone
 *  MC-armed, that made an MC release the ONLY way out of utility mode. A native build gets the same
 *  fixed floor the HUD uses (28px); the browser / `?stage` harness keeps the plain CSS `env()` value,
 *  which already renders correctly there. */
function applyNativeInset() {
  if (!isNative()) return;
  const top = 'max(env(safe-area-inset-top, 0px), 28px)';
  document.body.style.paddingTop = top;
  const cfg = $('cfg'); if (cfg) cfg.style.paddingTop = top;
}
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
const presence = new Presence({ defaultThreshold: thr(), dwellMs: settings.dwell, alpha: 0.35, game: settings.game });
const wasAlive = new Map();          // player id → { alive, died } for THIS game, to count revives that happened here (beacon.js countRevives)
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
  return encodeUuid({ role: 'station', id: settings.id, kind: settings.kind, team: f.team, state: f.state, value: f.value, seq: advert.seq, game: settings.game, threshold: thr(), taker: f.taker || 0 });
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
    if (!quiet) log(`advertising ${name} as ${TEAM_NAMES[settings.team]} · tx ${r && r.txPowerControl ? settings.tx : 'platform default'} · threshold ${thr()} dBm · ${uuid}`, 'lk');
  } catch (e) { advertising = false; settings.live = false; save(); log('advertise failed: ' + (e && e.message || e), 'le'); }
  finally { advertisingPending = Math.max(0, advertisingPending - 1); }
  render();
}
// ---------- Mission Control: hello as a utility node, take `station_config` (A13.5) ----------
let transport = null, mcState = 'offline', mcFormOpen = false, _wasLinked = false;   // mcFormOpen: CHANGE unfolded the linked MC panel
const TEAM_ID_TO_TID = { blue: 1, yellow: 2, red: 0, green: 3, any: TEAM_ANY, ffa: TEAM_ANY };
function mcUrl() { const q = new URLSearchParams(location.search).get('mc'); if (q) return q; if (settings.mc) return settings.mc; try { return localStorage.getItem('brx.mc_url') || ''; } catch (_) { return ''; } }
/** Apply MC's arming message: kind / team / id / threshold / game / valid_ids → the advert; mark MC-ARMED; come up live. */
async function applyStationConfig(body) {
  if (!body || typeof body !== 'object') return;
  // F337 (b): MC re-sends a same-game station_config at START, END and RECALL to move the A58 lock, which a
  // phone ignores. An arming that changes nothing a phone uses must not restart the advert or close the
  // seven-tap drawer; a real change (another game, kind, team, id, threshold, item or allow-list) re-arms.
  const armKey = () => JSON.stringify([settings.kind, settings.team, settings.id, settings.threshold, settings.tx, settings.game,
    settings.item, settings.mcArmed && settings.mcArmed.valid_ids]);
  const wasArmed = !!settings.mcArmed, before = armKey();
  if (body.kind && KIND_LABEL[body.kind]) settings.kind = body.kind;
  if (body.team != null) settings.team = typeof body.team === 'number' ? body.team : (TEAM_ID_TO_TID[String(body.team).toLowerCase()] ?? settings.team);
  if (Number.isFinite(+body.id) && +body.id >= 1) settings.id = Math.min(65535, Math.round(+body.id));
  // F365 / A67: the last edit wins, per field. An on-station edit younger than MC's value (`*_age_ms`) is kept; an
  // older one, or any value from an MC that sends no age, is replaced by MC's. MC sends `tx_power` only once it holds
  // one: absent keeps the station's own. A threshold of 0 = this platform's own default (F345).
  if (body.threshold != null && body.threshold !== '' && Number.isFinite(+body.threshold)) {
    const mcThr = applyThreshold(body.threshold, settings.threshold);
    if (range.mcDecides('threshold', mcThr, body.threshold_age_ms)) settings.threshold = mcThr;
  }
  // A phone that cannot set its advert power (iOS) ignores MC's tx_power and reports what it really sends (below).
  const mcTx = txFromWire(body.tx_power);
  if (mcTx && support.txPowerControl && range.mcDecides('tx_power', body.tx_power, body.tx_power_age_ms)) settings.tx = mcTx;
  // A58: the tamper lock, seconds from receipt (0-7200); absent or 0 = unlocked, and every station_config replaces it.
  const lockS = Number.isFinite(+body.lock_s) ? Math.max(0, Math.min(7200, +body.lock_s)) : 0;
  settings.lockUntil = lockS > 0 ? Date.now() + lockS * 1000 : 0;
  const wasGame = settings.game;
  settings.game = Number.isFinite(+body.game) ? (+body.game & 0xff) : 0;   // absent = 0 (any game), v1
  // A NEW game must not resume the last one's owner with the last one's possession seconds in the tally.
  // Arming is the only signal a station gets that a match changed (it is deliberately offline for the rest of
  // one), so this is where the point resets. The manual button behind the seven-tap gate is the field
  // fallback, not the mechanism.
  if (settings.game !== wasGame) { resetPoint(`MC armed game ${settings.game}`); wasAlive.clear(); revives = 0; }   // F344 review M2: a death seen last game is not one this game
  // A56: the item this powerup station grants, locked for the match (Tony: one item per station, never random).
  settings.item = settings.kind === 'powerup' && body.item && typeof body.item === 'object' ? body.item : null;
  pu.id = settings.id; pu.item = settings.item;
  if (settings.game !== wasGame) { pu.available = null; pu.nextAt = null; pu.taker = 0; pu.ringAt = null; pu.unsent = []; pu.awardedNext = null; savePowerup(); }
  settings.mcArmed = { game: settings.game, at: Date.now(), valid_ids: Array.isArray(body.valid_ids) ? body.valid_ids.slice(0, 32) : null };
  save();
  if (wasArmed && armKey() === before) {
    log(`MC re-sent the same arming (game ${settings.game}): advert and drawer left as they are`, 'li');
    if (!advertising) await startAdvert();   // not a restart: nothing was on air
    else render();   // the lock may have moved: the RANGE hold's cue follows it
    return;
  }
  log(`MC armed this phone: ${KIND_LABEL[settings.kind]} · ${TEAM_NAMES[settings.team] || settings.team} · station ${settings.id} · threshold ${thr()} dBm · game ${settings.game}`, 'lk');
  if (window.brxUtilityGate) window.brxUtilityGate.close();   // the operator armed it: the drawer has no business being open
  await startAdvert();
}
function utilityStatusBody() {
  // F365 / A67: the applied radius and strength, who set each and how long ago, and the last on-station edits,
  // restated on every beat. The transport only asks while bound, so this beat carries any edit made offline.
  const edits = range.status();
  if (transport && transport.state === 'bound') range.markSent();
  // A67: `threshold` is the dBm applied (thr(): the platform default when the stored value is 0, never 0). No TX power
  // control (iOS): NO strength at all, not a guessed value (brx3: MC's console hides STRENGTH until a station reports
  // one, and its validator refuses anything outside the enum), and no tx_power entry in the edit list.
  const txCtl = !!support.txPowerControl;
  if (!txCtl) {
    delete edits.tx_power_src; delete edits.tx_power_edit_age_ms;
    if (edits.range_edits) { edits.range_edits = edits.range_edits.filter(e => e.field !== 'tx_power'); if (!edits.range_edits.length) delete edits.range_edits; }
  }
  return { role: 'utility', kind: settings.kind, team: settings.team, station_id: settings.id, threshold: thr(), live: advertising, revives, armed: !!settings.mcArmed,
    ...(txCtl ? { tx_power: TX_TO_WIRE[settings.tx] || 'high' } : {}), ...edits,
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
  // Block 9: the same Wi-Fi-bound socket the HUD dials with (F311, BrxNet on Android), so a no-internet game
  // Wi-Fi the sweep just found MC on is the network the connect uses too. The stage passes its own factory.
  let ws = wsFactory;
  if (!ws) { try { ws = makeWsFactory(); } catch (_) { ws = undefined; } }
  transport = new Transport({ node: { node_type: 'utility', app_ver: UTIL_VER }, gun: null, keyPrefix: 'brxu', ...(ws ? { wsFactory: ws } : {}) });   // its own node id: never the HUD's
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
  transport.onState(s => { const was = mcState; mcState = s; if (s === 'bound') _wasLinked = true; if (s === 'bound' && flushTaken()) savePowerup();
    // a discovered MC that drops (a restart on a new IP) is searched for again, not left to mDNS alone
    if (was === 'bound' && s !== 'bound' && settings.mc_auto && isNative()) setTimeout(startUtilityLanSweep, 0); log(`MC ${s}${transport.rejected ? ' — ' + transport.rejected.reason : ''}`, s === 'bound' ? 'lk' : 'li'); render(); });
  transport.connect({ url, trusted, pub, secret }).then(() => {
    // An automatically discovered endpoint becomes the remembered fallback only after MC proves itself
    // with a welcome. Until then another mDNS result may replace a stale or non-MC websocket.
    if (!trusted && transport && transport.state === 'bound') { settings.mc = url; settings.mc_auto = true; save(); }
  }).catch(e => log('MC connect: ' + (e && e.message || e), 'le'));
}
// Utility mode is an explicit operator choice, so it may auto-join the MC service on this LAN. A utility
// phone has no player takeover key and cannot silently change a player's binding; discovery therefore skips
// the player's tap-to-join rule. A typed `?mc=`/remembered URL still wins and remains the offline fallback.
let _sweeper = null;
function startUtilityDiscovery() {
  if (!isNative() || (mcUrl() && !settings.mc_auto)) return;
  startUtilityLanSweep();
  if (!plugins.zeroconf) return;
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
// Bench 2026-09-24: mDNS alone never found an MC in WSL behind a Windows portproxy (its mDNS never reaches
// the LAN); the player screen's sweep did. Same sweep here (transport/utility-join.js), same guard as above:
// only while unbound and with no operator-named URL. A hit auto-joins untrusted, exactly like an mDNS hit.
function startUtilityLanSweep(over = {}) {   // `over`: the node test's sweep/timer seam (app/test/utility-join-wiring)
  if (_sweeper && !_sweeper.stopped) return;
  let wsFactory; try { wsFactory = makeWsFactory(); } catch (e) { log('MC sweep: ' + (e && e.message || e)); return; }
  _sweeper = startUtilitySweep({
    isBound: () => mcState === 'bound',
    operatorUrl: () => !!(mcUrl() && !settings.mc_auto),
    // the mDNS path's own rule, and never over a connect already in flight (an mDNS hit on another address)
    connect: (url, opts) => { if (mcState === 'connecting' || mcState === 'open') return; if (!transport || transport.url !== url) connectMc(url, opts); },
    log, wsFactory,
    isOnline: () => !(typeof navigator !== 'undefined' && navigator.onLine === false),
    ...over,
  });
}
/** The typed-address buttons: the HUD's parse (join code → url + pub + secret), and a pasted console address
 *  (`http://<host>:8765/`) dials MC's node port rather than being saved and redialled as typed. */
function connectTypedMc(text) {
  const r = resolveTypedMc(text);
  if (!r) return;
  if (r.note) log(r.note, 'li');
  connectMc(r.url, r.join ? { trusted: true, pub: r.pub, secret: r.secret } : { trusted: true });   // a bare address keeps the held pub/secret, as before
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
      localStorage.setItem(PRIOR_UTILITY_KEY, JSON.stringify({ node_id: transport.nodeId, node_key: transport.nodeKey, mc_url: transport.url }));
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
  presence.defaultThreshold = thr();
  presence.game = settings.game;
  presence.tick(now);
  // F344: a revive counts on the player being NEAR, not `present` (beacon.js countRevives says why).
  for (const p of countRevives(presence, wasAlive, { team: settings.team })) {
    if (settings.kind !== 'respawn') continue;
    revives++; ping(); log(`player ${p.id} (${TEAM_NAMES[p.team] || p.team}) revived here at ${Math.round(Number.isFinite(p.median) ? p.median : p.rssi)} dBm`, 'lk');
  }
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
    // a burst with no word: the ring, AVAILABLE / TAKEN and BY PLAYER n already say what changed
    if (e.type === 'spawned') { log(`${pu.item.name} SPAWNED`, 'lk'); flash(null, 'item'); }
    else if (e.type === 'taken') {
      log(`${pu.item.name} TAKEN by player ${e.player_num}`, 'lk'); flash(null, 'item');
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
    if (e.type === 'captured') { log(`${TEAM_NAMES[e.team]} CAPTURED the point${e.from != null ? ` from ${TEAM_NAMES[e.from]}` : ''}`, 'lk'); flash('CAPTURED', TEAM_KEYS[e.team]); }   // the big word already names the team
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
  for (const e of [el, $('cburst'), $('aura')]) if (e) e.dataset.fteam = teamKey || 'any';
  restart($('cburst')); restart($('aburst'));
  if (!word) return;   // a burst with no word (a powerup's own screen already names the change)
  $('cflashw').textContent = word; el.hidden = false;
  // the word sits inside the ring in place of the % line (nothing else is there), and the burst lights the whole screen
  restart(el);
  if ($('cpct')) $('cpct').hidden = true;
  _flashAt = Date.now();
}
/** Restart a one-shot CSS animation (.go) on an element, for a second crossing inside the first one's 2.6 s. */
function restart(e) { if (!e || !e.classList) return; e.classList.remove('go'); void e.offsetWidth; e.classList.add('go'); }
/** A revive at a respawn station: one soft burst of the ring in the station's colour. */
function ping() { const a = $('aura'); if (a && a.dataset) delete a.dataset.fteam; restart($('aburst')); }
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
  // control: the word is whose the ring IS (byte 9: the claimant while it builds, the owner while it drains), so the
  // word and the % always agree; NEUTRAL only when nobody has any of it
  const holderT = isControl && v.team !== CONTROL_NEUTRAL && v.value > 0 ? v.team : heldBy;
  $('team').textContent = isControl ? (holderT == null ? 'NEUTRAL' : (TEAM_NAMES[holderT] || `TEAM ${holderT}`))
    : (TEAM_NAMES[settings.team] || `TEAM ${settings.team}`);
  renderControl(isControl, v, heldBy);
  fitWord();
  if ($('team').style) $('team').style.setProperty('--wordc', isControl && holderT != null ? `var(--team-${TEAM_KEYS[holderT] || 'any'})` : '');
  renderPowerup();
  fitWord();
  if (_flashAt && Date.now() - _flashAt > 2600) { _flashAt = 0; $('cflash').hidden = true; }
  if ($('cpct')) $('cpct').hidden = !$('cflash').hidden;
  const pupEl = $('pup');
  document.documentElement.dataset.onair = advertising ? '1' : '0';   // off the air, every ring is grey and still (H2)
  document.documentElement.dataset.aura = isControl ? 'control'
    : (pupEl && !pupEl.hidden && pupEl.dataset.pstate) ? pupEl.dataset.pstate : (advertising ? 'live' : 'ready');
  renderPlayersToggle();
  renderRange();
  $('sid').textContent = `STATION ${settings.id}`; $('sidn').textContent = settings.id;
  $('status').textContent = advertising ? 'LIVE' : (plugins.beacon && support.advertising ? 'NOT LIVE' : 'CANNOT ADVERTISE');
  $('status').className = 'status ' + (advertising ? 'on' : 'off');
  $('revives').textContent = settings.kind === 'respawn' ? `${revives} REVIVED HERE` : '';   // in the drawer (round 3: not for players)
  $('txhint').textContent = support.txPowerControl ? (TX_HINT[settings.tx] || '') : 'no transmit-power control on this platform · radius = threshold only';
  $('thr').textContent = `${thr()} dBm${settings.threshold ? '' : ' · default'}`; $('thrRange').value = thr();
  $('dwell').textContent = `${(settings.dwell / 1000).toFixed(1)} s`;
  { const bs = $('btnStart'); ((bs.querySelector && bs.querySelector('.unskew')) || bs).textContent = advertising ? 'STOP' : 'START'; }   // into the .unskew span: replacing it slanted the word with its button
  const armed = settings.mcArmed;
  // Round 3 (Tony, 2026-09-24): quiet when all is well, loud only when it matters. Armed: a small "MC ✓ GAME n". Linked to an
  // MC but on the air WITHOUT its arming: player phones check the game byte MC's arming sets, so they may ignore this station,
  // and the operator must see that. Linked, not armed, not on the air yet: it is simply waiting. No MC at all: a hand-set
  // station on its own is valid, so nothing to say.
  const onAir = advertising || !!settings.live;
  $('armed').textContent = armed ? `MC ✓ GAME ${armed.game || 0}`
    : mcState !== 'bound' ? (_wasLinked ? 'MC OFFLINE' : '') : onAir ? 'SET BY HAND · PLAYERS MAY IGNORE IT' : 'WAITING FOR MC TO ARM IT';
  $('armed').className = 'armed ' + (armed ? 'on' : mcState === 'bound' && onAir ? 'warn' : '');
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
  // Linked: fold the main-screen MC panel to its status line plus CHANGE (Tony 2026-09-24); any other state unfolds it
  // and forgets a CHANGE, so the next link folds it again.
  const mcj = $('mcjoin');
  if (mcj) {
    const linked = mcState === 'bound'; if (!linked) mcFormOpen = false;
    mcj.classList.toggle('linked', linked && !mcFormOpen);
    const chg = $('btnMcChange'); if (chg) { chg.hidden = !linked; chg.setAttribute('aria-expanded', String(mcFormOpen)); (chg.firstElementChild || chg).textContent = mcFormOpen ? 'HIDE' : 'CHANGE'; }
  }
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
  if (!isControl) $('ctally').textContent = '';
  $('capS').textContent = `${settings.captureS} S`;
  $('netCap').textContent = `${settings.netCap}`;
  $('teamnote').hidden = !isControl;
  for (const b of document.querySelectorAll('[data-tx]')) b.classList.toggle('sel', b.dataset.tx === settings.tx);
  // F405 (2026-09-25): Tony -- "so mvp for utility is respawn station, pickup, hill". `extraction` and
  // `bomb` are hidden from this picker (`hidden` in utility.html) so a host cannot pick a new one; an
  // OLD assignment of either (from MC, or from before this change) keeps its own button visible and
  // selected here instead of reading as unset.
  for (const b of document.querySelectorAll('[data-kind]')) {
    if (b.dataset.kind === 'extraction' || b.dataset.kind === 'bomb') b.hidden = b.dataset.kind !== settings.kind;
    b.classList.toggle('sel', b.dataset.kind === settings.kind);
  }
  for (const b of document.querySelectorAll('[data-team]')) b.classList.toggle('sel', +b.dataset.team === settings.team);
}

// ---------- the main screen's optional roster and its RANGE controls (round 3, 2026-09-24) ----------
const PLAYERS_KEY = 'brx.utility.players';
let showPlayers = (() => { try { return localStorage.getItem(PLAYERS_KEY) === '1'; } catch (_) { return false; } })();
function renderPlayersToggle() {
  const panel = $('playersPanel'), btn = $('btnPlayers'); if (!panel || !btn) return;
  panel.hidden = !showPlayers;
  btn.textContent = showPlayers ? 'HIDE PLAYERS' : 'SHOW PLAYERS';
  if (btn.setAttribute) btn.setAttribute('aria-expanded', String(showPlayers));
}
/** The `-NN dBm` edge as the operator types it: digits only, no minus (Tony: "drop the - ... it just makes it harder to
 *  input the number"). 70 means -70 dBm. Returns the negative threshold, or null when it is not a number in range. */
function parseEdge(text) {
  const t = String(text == null ? '' : text).trim().replace(/^[-−]/, '');
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = -Number(t);
  return n >= THR_MIN && n <= THR_MAX ? n : null;
}
const THR_MIN = -95, THR_MAX = -35;   // the same range the drawer's slider allows
/** On the field: MC-armed, or on the air. The RANGE panel is then a readout until the operator holds to edit it (F365). */
function playLocked() { return !!settings.mcArmed || !!settings.live || advertising || advertisingPending > 0; }
// F365 (Tony 2026-09-25): "if operator notices the range is too wide during gameplay, to long hold and be able to edit it".
// Setting up, the panel is editable as before. On the field it is locked until a knock-safe hold opens it (1.5 s, or the
// stronger 5 s while an MC tamper lock runs, A58), then it locks itself again after 10 s idle or on DONE.
let _editOpen = false, _editIdleAt = 0, _rangeIdleMs = RANGE_IDLE_MS;
function rangeLocked() { return playLocked() && !_editOpen; }
function rangeTouched() { if (_editOpen) _editIdleAt = Date.now(); }
function closeRangeEdit(why) {
  if (!_editOpen) return;
  _editOpen = false; _edgeBad = false;
  const inp = $('thrNum'); if (inp && document.activeElement === inp && inp.blur) inp.blur();
  log(`range editing locked again (${why})`, 'li');
  render();
}
/** "MC", "SET HERE", or "SET HERE · WILL SYNC" while no heartbeat has carried the edit to MC yet. */
function rangeSrcLabel(field) {
  const src = range.src(field);
  if (field === 'tx_power' && !support.txPowerControl) return "THIS PHONE CAN'T SET IT";
  if (src === 'mc') return 'MC';
  if (src === 'station') return range.pending(field) ? 'SET HERE · WILL SYNC' : 'SET HERE';
  // nobody has set it yet: the station's own default (0 = the platform radius, HIGH strength), else a pre-A67 value
  return (field === 'threshold' ? !settings.threshold : settings.tx === 'high') ? 'DEFAULT' : '';
}
/** One on-station change of radius (`threshold`, a stored value; 0 = the default) or strength (`tx_power`, a settings.tx
 *  name). It applies at once (restartIfLive re-keys the advert: byte 14, and the TX power) and is logged for MC. */
function stationEdit(field, next) {
  if (field === 'tx_power' && !support.txPowerControl) return;   // a phone that cannot set its power records no strength edit
  const view = () => (field === 'threshold' ? thr() : (TX_TO_WIRE[settings.tx] || 'high'));
  const before = view();
  if (field === 'threshold') settings.threshold = next; else settings.tx = next;
  save();
  const after = view();
  if (after !== before) {
    const e = range.edit(field, before, after, { locked: a58Locked() });
    log(`${field === 'threshold' ? 'radius' : 'strength'} set here: ${before} → ${after}${e.locked ? ' (while MC-locked)' : ''} · edit #${e.seq}`, 'lk');
  }
  restartIfLive();
}
function renderRange() {
  const box = $('range'); if (!box) return;
  if (_editOpen && (!playLocked() || Date.now() - _editIdleAt > _rangeIdleMs)) {
    const idle = playLocked();
    _editOpen = false; _edgeBad = false;
    const i0 = $('thrNum'); if (i0 && i0.blur && document.activeElement === i0) i0.blur();
    if (idle) log('range editing locked again (10 s idle)', 'li');
  }
  const locked = rangeLocked(), onField = playLocked(), mcLock = a58Locked();
  if (locked && _edgeBad) _edgeBad = false;   // a lock ends any half-typed entry
  const inp = $('thrNum');
  if (inp && document.activeElement !== inp && !_edgeBad) inp.value = String(-thr());
  if (inp && inp.setAttribute) inp.setAttribute('aria-invalid', String(_edgeBad));
  const hint = $('rhint'); if (hint) { hint.textContent = _edgeBad ? `TYPE ${-THR_MAX} TO ${-THR_MIN}` : `${-THR_MAX} = TIGHT · ${-THR_MIN} = WIDE`; if (hint.classList) hint.classList.toggle('bad', _edgeBad); }
  if (inp) inp.disabled = locked;
  for (const b of (box.querySelectorAll ? box.querySelectorAll('[data-tx]') : [])) b.disabled = locked || !support.txPowerControl;
  if (box.classList) { box.classList.toggle('locked', locked); box.classList.toggle('editing', onField && !locked); }
  if ($('rangeLock')) $('rangeLock').textContent = !onField ? '' : !locked ? ' · EDITING' : mcLock ? ' · LOCKED BY MC' : ' · LOCKED';
  for (const [id, field] of [['thrSrc', 'threshold'], ['txSrc', 'tx_power']]) {
    const el = $(id); if (!el) continue;
    el.textContent = rangeSrcLabel(field);
    if (el.classList) { el.classList.toggle('here', range.src(field) === 'station'); el.classList.toggle('wait', range.pending(field)); }
  }
  const hold = $('rangeHold');
  if (hold) {
    hold.hidden = !locked;
    if (hold.classList) hold.classList.toggle('a58', mcLock);
    const lbl = $('rangeHoldLbl'); if (lbl) lbl.textContent = mcLock ? 'LOCKED BY MC · HOLD 5 S TO OVERRIDE' : 'HOLD TO EDIT RANGE';
    if (hold.setAttribute) hold.setAttribute('aria-label', mcLock ? 'locked by Mission Control: hold five seconds to override and edit the range' : 'hold about one and a half seconds to edit the range');
  }
  const done = $('rangeDone'); if (done) done.hidden = !(onField && !locked);
}
let _edgeBad = false;   // the last entry was refused: the field keeps the stored value, the hint says the range
function commitEdge() {
  const inp = $('thrNum'); if (!inp || rangeLocked()) return false;
  rangeTouched();
  const n = parseEdge(inp.value);
  if (n == null) { _edgeBad = true; log(`radius: type a number from ${-THR_MAX} to ${-THR_MIN}`, 'le'); render(); return false; }
  _edgeBad = false;
  if (n !== settings.threshold) stationEdit('threshold', n); else render();
  return true;
}
/** F365: the RANGE hold. The same knock-safe hold as the hidden door (tapgate.js: one contact held, cancelled by a lift,
 *  a slide off the button or a lost pointer), with a visible fill. 1.5 s opens editing; under an A58 lock only the 5 s
 *  hold does, and the need is read live, so a lock arriving mid-hold cannot be crossed by the shorter one. */
function wireRangeHold() {
  const btn = $('rangeHold'), fill = $('rangeHoldFill');
  if (!btn) return;
  /** @type {any} */ let gate = null;
  let t0 = 0, raf = 0, timer = 0, activePointer = null, activeKey = '';
  const need = () => rangeHoldMs(a58Locked());
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    raf = 0; timer = 0; t0 = 0; activePointer = null; activeKey = ''; if (gate) gate.cancel(); gate = null;
    if (fill) fill.style.width = '0%';
    if (btn.classList) btn.classList.remove('holding');
  };
  const check = () => {
    if (!t0 || !gate) return false;
    const now = Date.now();
    if (now - t0 < need() || !gate.held(now)) return false;
    stop();
    if (!rangeLocked()) return true;   // already open, or no longer on the field: nothing to unlock
    _editOpen = true; _editIdleAt = Date.now();
    log(`range editing unlocked on the station${a58Locked() ? ' (MC lock overridden)' : ''}`, 'lk');
    render();
    return true;
  };
  const tick = () => {
    raf = 0;
    if (!t0) return;
    const p = Math.min(1, (Date.now() - t0) / need());
    if (fill) fill.style.width = `${Math.round(p * 100)}%`;
    if (check()) return;
    raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (t0 || !rangeLocked()) return false;
    t0 = Date.now(); gate = createTapHoldGate({ taps: 1, holdMs: need() }); gate.down(t0);
    if (btn.classList) btn.classList.add('holding');
    // a timer as well as the frames: rAF pauses in a background tab, and the hold must still resolve
    const arm = () => { timer = setTimeout(() => { timer = 0; if (t0 && !check()) arm(); }, Math.max(50, need() - (Date.now() - t0))); };
    arm();
    tick();
    return true;
  };
  btn.addEventListener('pointerdown', e => { e.preventDefault(); if (start()) activePointer = e.pointerId; });
  btn.addEventListener('pointermove', e => {
    if (activePointer !== e.pointerId) return;
    const r = btn.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) stop();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, e => { if (activePointer === e.pointerId) stop(); });
  btn.addEventListener('keydown', e => {
    if ((e.key !== ' ' && e.key !== 'Enter') || e.repeat) return;
    e.preventDefault();
    if (start()) activeKey = e.key;
  });
  btn.addEventListener('keyup', e => { if (e.key !== activeKey) return; e.preventDefault(); stop(); });
  btn.addEventListener('blur', stop);
  // No click path, on purpose: a click (a tap, a knock, a synthesised activation) never opens the range. Unlike the
  // exit hold, this unlocks a live station's settings, so the only way in is a held contact or a held key. A screen
  // reader user still has a click-only path: the seven-tap drawer's RADIUS controls, which record the same edit.
}

/** C1 (critical review 2026-09-24): "ROCKET LAUNCHER" ran out of the ring and off the screen. The word may take two balanced
 *  lines, and --len (the longest line it needs, in characters) steps its size down so it stays inside the ring. */
function fitWord() {
  const el = $('team'); if (!el || !el.style) return;
  const words = String(el.textContent || '').trim().split(/\s+/);
  const total = words.join(' ').length, longest = Math.max(1, ...words.map(w => w.length));
  const len = Math.max(longest, words.length > 1 ? Math.ceil(total / 2) : total, 4);
  el.style.setProperty('--len', String(len));
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
  const firstAt = Number(item.first_at_s);
  $('pstate').textContent = v.available === true ? (v.ringAt != null ? 'HOLD STILL' : 'AVAILABLE') : v.available === false ? 'TAKEN'
    : Number.isFinite(firstAt) && firstAt > 0 ? `FIRST DROP AT ${mmss(firstAt * 1000)}` : 'NOT SPAWNED YET';
  $('pnext').textContent = v.available === false && v.nextInMs != null ? `NEXT ${mmss(v.nextInMs + 999)}` : '';
  $('ptaker').textContent = v.available === false && v.taker ? `BY PLAYER ${v.taker}` : '';
  const ring = $('pring'); const p = v.ringAt != null ? Math.min(1, (now - v.ringAt) / 1000) : 0;
  ring.hidden = v.ringAt == null;
  ring.style.setProperty('--p', p.toFixed(3));
  ring.setAttribute('aria-valuenow', String(Math.round(p * 100)));
}

/** Kind 5 on screen (round 3, 2026-09-24: "the animation should explain what's happening, less labels and icons"). The ring
 *  carries it: the HOLDER's colour fills it to the progress (the claimant while it builds, the owner while it drains, which
 *  is whoever byte 9 names), the RIVAL's colour creeps into the rest, and CSS runs the sweep, the pulse and the standoff off
 *  `data-cstate` on <html>. Words: the owner (in #team, by render()) and the % line. This only feeds numbers. */
function renderControl(isControl, v, heldBy) {
  const el = $('control'); el.hidden = !isControl;
  const aura = $('aura'), core = $('core');
  if (!isControl) {
    for (const k of ['--hold', '--rival', '--p', '--cspd']) if (aura && aura.style.removeProperty) aura.style.removeProperty(k);
    if (core && core.removeAttribute) { core.removeAttribute('role'); core.removeAttribute('aria-valuenow'); core.removeAttribute('aria-valuetext'); }
    if (_flashAt === 0) $('cpct').textContent = '';
    return;
  }
  const holder = v.team;                          // whose progress the ring is (255 = nobody)
  const hname = holder === CONTROL_NEUTRAL ? null : (TEAM_NAMES[holder] || `TEAM ${holder}`);
  const key = t => TEAM_KEYS[t] || 'any';
  // the rival: the leading team when it is not the holder, else the strongest other team standing there
  const others = Object.keys(point.counts || {}).map(Number).filter(t => t !== holder && claimable(t)).sort((a, b) => point.counts[b] - point.counts[a]);
  const rival = point.lead != null && point.lead !== holder ? point.lead : (others.length ? others[0] : null);
  aura.style.setProperty('--hold', holder === CONTROL_NEUTRAL ? 'var(--team-any)' : `var(--team-${key(holder)})`);
  aura.style.setProperty('--rival', rival == null ? 'transparent' : `var(--team-${key(rival)})`);
  aura.style.setProperty('--p', (v.value / 100).toFixed(3));
  // speed is information: more net players, a faster sweep (1.6 s a turn at net 1, floored so a stack does not strobe)
  aura.style.setProperty('--cspd', `${Math.max(0.5, 1.6 / Math.max(1, point.net)).toFixed(2)}s`);
  $('afront').style.transform = `rotate(${(v.value * 3.6).toFixed(1)}deg)`;   // the standoff dots sit where the fill stopped
  $('cpct').textContent = v.value === 0 || (heldBy != null && v.value >= 100 && !point.dir) ? '' : `${v.value}%`;   // 0% and a held 100% say nothing the ring does not
  if (core && core.setAttribute) {
    core.setAttribute('role', 'progressbar'); core.setAttribute('aria-label', 'capture progress');
    core.setAttribute('aria-valuemin', '0'); core.setAttribute('aria-valuemax', '100'); core.setAttribute('aria-valuenow', String(v.value));
    core.setAttribute('aria-valuetext', `${v.value}% ${hname == null ? 'neutral' : `for ${hname}`}${point.contested ? ', contested' : ''}`);
  }
  $('ctally').textContent = tallyLine();
  // short on purpose: two points on one id read as ONE point to every player phone; team 2 is what a neutral point broadcasts (F82)
  $('cwarn').textContent = _twin ? `ID ${_twin} USED TWICE · CHANGE ONE IN MC`
    : point.refusedSeen ? 'TEAM 2 CAN NEVER HOLD A POINT · REASSIGN IN MC' : '';
}

function wire() {
  $('btnStart').onclick = () => (advertising ? stopAdvert() : startAdvert());
  $('btnMc').onclick = () => connectTypedMc($('mcUrl').value);
  if ($('btnMcMain')) $('btnMcMain').onclick = () => connectTypedMc($('mcUrlMain').value);
  if ($('btnQrMain')) $('btnQrMain').onclick = () => scanUtilityQr();
  if ($('btnMcChange')) $('btnMcChange').onclick = () => { mcFormOpen = !mcFormOpen; render(); };
  if ($('btnPlayers')) $('btnPlayers').onclick = () => { showPlayers = !showPlayers; try { localStorage.setItem(PLAYERS_KEY, showPlayers ? '1' : '0'); } catch (_) { /* ignore */ } render(); };
  if ($('thrNum')) {
    const inp = $('thrNum');
    inp.oninput = () => { rangeTouched(); const v = String(inp.value).replace(/[^0-9]/g, '').slice(0, 2); if (v !== inp.value) inp.value = v; };
    inp.onchange = commitEdge;
    inp.onkeydown = e => { if (e.key === 'Enter' && commitEdge() && inp.blur) inp.blur(); };
  }
  $('btnHud').onclick = exitToHud;
  for (const b of document.querySelectorAll('[data-kind]')) b.onclick = () => { settings.kind = b.dataset.kind; save(); restartIfLive(); };
  for (const b of document.querySelectorAll('[data-team]')) b.onclick = () => { settings.team = +b.dataset.team; save(); restartIfLive(); };
  // the main screen's chips obey the RANGE lock (F365); the drawer's sit behind the seven-tap gate. Both count as edits.
  for (const b of document.querySelectorAll('[data-tx]')) b.onclick = () => {
    if (b.closest && b.closest('#range') && rangeLocked()) return;
    rangeTouched();
    if (!support.txPowerControl) { log('this phone cannot set its transmit power: strength is fixed', 'le'); return; }
    if (TX_TO_WIRE[b.dataset.tx]) stationEdit('tx_power', b.dataset.tx);
  };
  if ($('range') && $('range').addEventListener) $('range').addEventListener('pointerdown', rangeTouched);
  if ($('rangeDone')) $('rangeDone').onclick = () => closeRangeEdit('DONE');
  wireRangeHold();
  $('idMinus').onclick = () => { settings.id = Math.max(1, settings.id - 1); save(); restartIfLive(); };
  $('idPlus').onclick = () => { settings.id = Math.min(65535, settings.id + 1); save(); restartIfLive(); };
  // the slider previews while it moves and records ONE edit on release, from where the drag began
  let sliderFrom = null;
  $('thrRange').oninput = e => { if (sliderFrom == null) sliderFrom = settings.threshold; settings.threshold = +e.target.value; save(); render(); };
  $('thrRange').onchange = e => { const to = +e.target.value; if (sliderFrom != null) settings.threshold = sliderFrom; sliderFrom = null; stationEdit('threshold', to); };
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
    const to = Math.max(-100, Math.min(-30, Math.round(p.rssi) - 3));
    log(`threshold set from player ${p.id}: ${Math.round(p.rssi)} dBm → ${to} dBm`, 'lk');
    stationEdit('threshold', to);
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
    if (btn.classList) btn.classList.remove('holding');
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
    if (btn.classList) btn.classList.add('holding');
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
  applyNativeInset(); wire(); render();
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
  window.brxUtility = { settings, presence, point, pu, advert, startAdvert, stopAdvert, render, log: logLines, stationUuid, advertFields, encodeUuid, applyStationConfig, connectMc, mcMessage: stageMcMessage, exitToHud, get transport() { return transport; },
    // test seam (app/test/utility-join-wiring): `startLanSweep(over)` spreads `over` into the sweep options unchecked
    startLanSweep: startUtilityLanSweep, get sweeper() { return _sweeper; },
    // F365 / A67 test seams: the edit model, one on-station edit, the status body a heartbeat sends, the hold's need
    range, stationEdit, statusBody: utilityStatusBody, a58Locked, holdMs: () => rangeHoldMs(a58Locked()),
    get rangeEditing() { return _editOpen; }, setRangeIdleMs: ms => { _rangeIdleMs = ms; },
    get support() { return support; }, setSupport: s => { support = { ...support, ...s }; render(); },
    applyNativeInset };   // F420 test seam: screens.mjs fakes window.Capacitor.isNativePlatform, then re-runs this
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
