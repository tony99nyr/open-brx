import jsQR from 'jsqr';
// OS-level landscape lock: the HUD is a fixed 844x390 landscape stage — in portrait it scales to a
// postage stamp (Tony, 2026-08-26: 'the label wraps on my screen'). Boxed import (thenable trap).

// BRX Combat HUD — the per-player node (docs/spec/node.md, contracts A6).
// One phone, one gun, one player. Composition of: Engine (state machine) + BrxLink (BLE) +
// Transport (M-NET wire) + Hud (Phone HUD v2). Runs in a desktop browser with `?demo`.
import { Engine, C } from './engine.js';
import { BrxLink } from './brxlink.js';
import { Transport } from './transport/transport.js';
import { Hud } from './hud/hud.js';
import { parseMcQr } from './mcurl.js';
import { Presence, encodeUuid, stationView } from './beacon.js';   // utility items (docs/spec/utility.md)

const APP_VER = 'hud-0.2';
const $ = id => document.getElementById(id);
const LOGMAX = 400;
const logLines = [];
function log(msg, cls = 'li') { const t = new Date().toISOString().substr(11, 8); logLines.push(`[${t}] ${msg}`); if (logLines.length > LOGMAX) logLines.shift(); if (cls === 'le') console.warn(msg); }

// ---------- Capacitor plugins (all guarded: the web build must run in a desktop browser) ----------
const plugins = {};
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
    tryImport('cam', () => import('@capacitor-community/camera-preview').then(m => ({ v: m.CameraPreview }))),
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
  get night() { try { return localStorage.getItem('brx.night') === '1'; } catch (_) { return false; } },
  set night(v) { try { localStorage.setItem('brx.night', v ? '1' : '0'); } catch (_) { /* ignore */ } },
  // 'hud' (default) or 'utility': the same install is either a player's HUD or a utility item on the field
  get role() { try { return localStorage.getItem('brx.role') || 'hud'; } catch (_) { return 'hud'; } },
  set role(v) { try { localStorage.setItem('brx.role', v); } catch (_) { /* ignore */ } },
};
function switchRole(role) { settings.role = role; location.replace(role === 'utility' ? 'utility.html' : 'index.html'); }

// ---------- wiring ----------
const hud = new Hud(document, {});
try { window.__hud = hud; } catch (_) { /* rig/screen-truth hook */ }
let transport = null;
const link = new BrxLink({
  log, onFrame: f => engine.feedFrame(f),
  onDrop: () => { engine.onBleDropped(); haptic('down'); },
  onUp: advert => {
    engine.onBleConnected(advert);
    if (transport) {
      transport.gun = { name: advert.name, tail: advert.tail, fw: engine.fw || undefined };
      if (transport.state === 'bound') { try { transport.bind({ player_id: engine.player && engine.player.player_id, gun: engine.gun ? { name: engine.gun.name, tail: engine.gun.tail, fw: engine.fw || undefined } : undefined }); } catch (_) { /* best-effort */ } }
    }
  },
  unbounded: () => engine.phase === 'armed' || engine.phase === 'live',
});
const engine = new Engine({
  writer: frames => link.write(frames),
  emit: fact => transport && transport.send(fact),
  report: (kind, body) => transport && transport.report(kind, body),
  now: () => transport ? transport.syncedNow() : Date.now(),
  synced: () => !!(transport && transport.synced()),
  // ?demo runs on a clean slate: no restore of a real session's match (the constructor loads storage, so this is the
  // only place that can stop it — a later clearPersisted() is too late; correctness review 2026-09-03), and nothing saved.
  storage: (() => { try { return new URLSearchParams(location.search).has('demo') ? null : localStorage; } catch (_) { return null; } })(),
  log, onChange: () => scheduleRender(),
});
engine.night = settings.night;
hud.mcUrl = settings.mcUrl;
// per-match history (bench request 2026-08-25): node-local, survives restarts, capped
try { hud.history = JSON.parse(localStorage.getItem('brx.history') || '[]'); } catch (_) { hud.history = []; }
engine.onEnd = (g) => { try { const h = hud.history || []; h.push(g); while (h.length > 50) h.shift(); hud.history = h; localStorage.setItem('brx.history', JSON.stringify(h)); } catch (_) { /* best-effort */ } };

// ---------- utility items: watch for stations while connected, and advertise ourselves as a player ----------
// The beacon scan is the same BLE scan the gun picker uses, kept open for the whole match at the balanced
// duty cycle, feeding Presence; the engine gets a snapshot every tick (utility.md §3). Nothing here blocks
// the match: with no plugin (desktop) or no stations in range the HUD behaves exactly as before.
const presence = new Presence({ defaultThreshold: -74, dwellMs: 800 });   // 0.8s dwell + -74 threshold: get-in-range, brief pause, green (bench-tuned 2026-09-04)
let beaconScanning = false;
const stationWas = new Map();
async function startBeaconScan() {
  if (beaconScanning || scanning || !isNative()) return;
  beaconScanning = true;
  try {
    // scanMode 2 (low latency): a DOWN player needs the station within a second, and Android throttles
    // a balanced-mode scan so hard that presence froze on hardware (2026-09-04). Costs battery; acceptable
    // for a match, and the restart below keeps it from being demoted to nothing over a long game.
    await link.scan(hit => { if (hit.uuids && hit.uuids.length) presence.observe(hit.uuids, hit.rssi, Date.now()); }, { scanMode: 2 });
    log('watching for utility items', 'li');
  } catch (e) { beaconScanning = false; log('beacon scan: ' + (e && e.message || e), 'li'); }
}
// Android silently STALLS a BLE scan that is left running — `scanning` stays true but callbacks stop
// arriving (hardware 2026-09-04: a down player at the station saw "find a respawn station" until a fresh
// scan was forced, whereupon the station appeared at once). The cure is a periodic stop+start. Cadence
// depends on need: while a scanner-respawn player is DOWN they need the station within a second, so
// refresh fast; otherwise slow (Android throttles an app that starts scans more than ~5×/30s, so never
// go below ~6 s). A fresh scan is also kicked the instant the player goes down, so the walk to the
// station starts against a live scan.
let _lastAlive = true, _lastRescan = 0;
async function refreshBeaconScan() {
  if (!beaconScanning || scanning) return;
  try { await link.stopScan(); beaconScanning = false; await startBeaconScan(); _lastRescan = Date.now(); } catch (_) { /* ignore */ }
}
setInterval(() => {
  const st = engine.state();
  const down = st.phase === 'live' && !st.alive && st.respawnType === 'scanner';
  if (_lastAlive && !st.alive && down) { refreshBeaconScan().catch(() => {}); }   // just died → kick immediately
  _lastAlive = st.alive;
  const period = down ? 6000 : 90000;                                             // fast while hunting a station, slow otherwise
  if (Date.now() - _lastRescan >= period) refreshBeaconScan().catch(() => {});
}, 1000);
async function stopAnyScan() {
  if (scanning || beaconScanning) { await link.stopScan(); scanning = false; beaconScanning = false; }
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
let playerAdvert = null;
async function syncPlayerAdvert() {
  if (!plugins.beacon || !isNative()) return;
  const st = engine.state();
  const num = st.playerNum, tid = engine.teamTid;
  const want = (num != null && tid != null && st.phase !== 'idle')
    ? encodeUuid({ role: 'player', id: num, team: tid, state: st.alive ? 1 : 0 }) : null;
  if (want === playerAdvert) return;
  playerAdvert = want;
  try {
    if (want) { await plugins.beacon.start({ uuid: want, txPower: 'medium', mode: 'balanced' }); log(`advertising as player ${num} team ${tid}${st.alive ? '' : ' (down)'}`, 'li'); }
    else await plugins.beacon.stop();
  } catch (e) { log('player advert: ' + (e && e.message || e), 'li'); }
}

// preflight (contracts A4.9)
const preflight = { ssid_ok: true, mc_reachable: false, auto_join_ok: true, cellular_off: true, dnd_on: false, phone_batt: null, screen_on: true, foreground: true, gun_linked: false, headset_ok: false };
async function refreshPreflight() {
  try { if (plugins.device) { const b = await plugins.device.getBatteryInfo(); if (b && b.batteryLevel != null) preflight.phone_batt = Math.round(b.batteryLevel * 100); } } catch (_) { /* ignore */ }
  try { if (plugins.network) { const s = await plugins.network.getStatus(); preflight.ssid_ok = s.connectionType === 'wifi'; } } catch (_) { /* ignore */ }
  preflight.mc_reachable = !!(transport && transport.state === 'bound');
  preflight.gun_linked = engine.bleUp; preflight.headset_ok = !!engine.headEcho;
  preflight.foreground = document.visibilityState !== 'hidden'; preflight.screen_on = preflight.foreground;
  if (transport) transport.setPreflight(preflight);
}

/** Discovery/sweep may pick an MC for us. Opened after 15 s of failing to connect, and closed again
 *  the moment we bind — declared up here because `connectMc`'s onState handler clears it. */
let allowAssist = false;
/** Pending "we have been unbound for 15s" timer; see the onState handler in connectMc. */
let assistTimer = null;
/** The last URL we actually dialled — including a discovery-only one that `settings.mcUrl` never
 *  records. RECONNECT MC falls back to it. */
let lastMcUrl = null;
function connectMc(url, remember = true) {
  if (!url) return;
  if (remember) { settings.mcUrl = url; hud.mcUrl = url; }   // discovery never overwrites the explicit target (polish-loop)
  // ...but RECONNECT MC has to have something to dial. It read `settings.mcUrl`, which a
  // discovery-only connect deliberately never writes — so after an auto-discovered join the button
  // called connectMc(undefined) and returned on line 1, doing nothing at all (deferred low).
  lastMcUrl = url;
  if (transport) { try { transport.close(); } catch (_) { /* ignore */ } }
  const gun = engine.gun ? { name: engine.gun.name, tail: engine.gun.tail, fw: engine.fw || undefined } : null;
  transport = new Transport({ node: { app_ver: APP_VER }, gun });
  transport.setStatusProvider(() => engine.statusBody(preflight));
  transport.onHydrate(node => engine.hydrate(node));
  transport.onMessage(m => { engine.onMcMessage(m); if (m.kind === 'feedback' && m.body && m.body.kind === 'kill') haptic('kill'); });
  transport.onState(s => {
    // Bound to an MC: stop letting discovery/sweep pick a different one. `allowAssist` opens that
    // door after 15 s of failing to connect and used to stay open for the rest of the session, so a
    // momentary drop mid-match could hand this phone to a second MC on the LAN (deferred low).
    if (s === 'bound') { allowAssist = false; if (assistTimer) { clearTimeout(assistTimer); assistTimer = null; } }
    // ...and re-open it if we stay unbound: its only opener used to be a one-shot 15 s boot timer,
    // so after the first successful bind discovery could never rescue us again — exactly the case
    // where MC restarts on a new IP mid-match (review 2026-09-01).
    else if (!assistTimer) assistTimer = setTimeout(() => { assistTimer = null; if (!transport || transport.state !== 'bound') { allowAssist = true; sweepForMc().catch(() => {}); } }, 15000);
    engine.setWsState(s, transport.rejected);
    log(s === 'rejected' ? `MC REFUSED: ${transport.rejected && transport.rejected.reason} (${transport.rejected && transport.rejected.code})` : `MC link ${s}`, s === 'bound' ? 'lk' : s === 'rejected' ? 'le' : 'li');
  });
  transport.connect({ url }).then(() => log('MC hydrated', 'lk')).catch(e => log('MC connect: ' + (e && e.message || e), 'le'));
}

// ---------- HUD handlers ----------
let scanning = false; const found = new Map();
Object.assign(hud.h, {
  onSetGun: async () => {
    await stopAnyScan();   // tap = (re)start a fresh scan, never leave the picker idle (bench 2026-08-25); the beacon watch yields to the picker
    try {
      found.clear(); scanning = true;
      // Stable rows: first-seen order (Map insertion), RSSI updated in place, re-render at most 2×/s —
      // sorting by RSSI on every advert made the rows jump under the finger (bench 2026-08-25).
      let lastPaint = 0;
      await link.scan(d => {
        if (!d.name) return;                       // unnamed adverts are never taggers (25 of them on the bench)
        const prev = found.get(d.deviceId);
        found.set(d.deviceId, prev ? { ...prev, ...d } : d);
        const now = Date.now();
        if (now - lastPaint < 500 && prev) return;
        lastPaint = now;
        hud.setScan([...found.values()].map(x => ({ ...x, ...splitName(x.name, x.deviceId) }))); scheduleRender();
      });
    } catch (e) { scanning = false; log('scan: ' + (e && e.message || e), 'le'); }
  },
  onPick: async deviceId => {
    const d = found.get(deviceId); if (!d) return;
    await link.stopScan(); scanning = false; hud.setScan([]);
    log(`connecting to ${d.name}…`);
    try { await link.connect(deviceId, d.name); if (settings.mcUrl && !transport) connectMc(settings.mcUrl); startBeaconScan().catch(() => {}); }
    catch (e) { log('connect failed: ' + (e && e.message || e), 'le'); }
    scheduleRender();
  },
  onUtility: () => switchRole('utility'),   // the HUD's way into utility mode (brx-hud adds the control; 7 taps on the stage also work)
  onReady: () => { if (engine.phase === 'kitted') { engine.setReady(!engine.ready); haptic('tap'); } },
  // A10 self-serve kitting (docs/spec/loadout.md §4.5): slot plates → LOADOUT browser → tap-to-equip / TRY IT / DONE
  onOpenLoadout: slot => { if (!engine.canPick(slot)) return; hud.lo.tab = slot; hud.lo.focus = null; hud.lo.filter = 'weapons'; engine.browse(true); haptic('tap'); },
  onLoTab: slot => { if (!engine.canPick(slot)) return; hud.lo.tab = slot === 'secondary' ? 'secondary' : 'primary'; hud.lo.focus = null; hud.sig = null; scheduleRender(); },
  onLoFilter: f => { hud.lo.filter = f === 'perks' ? 'perks' : 'weapons'; hud.lo.focus = null; hud.sig = null; scheduleRender(); },
  onLoNone: () => { engine.requestLoadout('secondary', 'none'); haptic('tap'); },
  onPickItem: key => { const i = String(key || '').indexOf(':'); if (i < 0) return; const kind = key.slice(0, i), id = key.slice(i + 1); hud.lo.focus = key; if (engine.requestLoadout(hud.lo.tab, kind, id, false)) haptic('tap'); else scheduleRender(); },
  onTryIt: () => { const st = engine.state(); const tab = hud.lo.tab; const rows = hud._loRows(st, tab); const eq = tab === 'primary' ? st.loadout.primary : st.loadout.secondary;
    const key = (hud.lo.focus && rows.some(r => r.key === hud.lo.focus)) ? hud.lo.focus : (eq && eq.kind === 'weapon' ? 'weapon:' + eq.weapon_id : (rows[0] && rows[0].key));
    if (!key || !key.startsWith('weapon:')) return; if (engine.requestLoadout(tab, 'weapon', key.slice(7), true)) haptic('tap'); },
  onLoDone: () => { engine.browse(false); haptic('tap'); },
  // A10 §4.6: BRIEFING → BUILD MY KIT ▸ reveals the plates; BRIEFING on the KITTED screen reopens it
  onBriefDone: () => { engine.closeBriefing(); haptic('tap'); },
  onBriefing: () => { engine.openBriefing(); haptic('tap'); },
  onTryDone: () => { engine.dismissTryout(); haptic('tap'); },
  onSetUrl: () => { const el = $('mcurl'); if (el && el.value.trim()) connectMc(el.value.trim()); },
  onToggleNight: () => { engine.night = !engine.night; settings.night = engine.night; hud.sig = null; scheduleRender(); },
  onToggleMcPill: () => { hud.mcPill = !hud.mcPill; scheduleRender(); },   // live: show/hide the out-of-range detail (review #32)
  onToggleCam: async () => {
    if (!plugins.cam || !isNative()) { hud.setCam(false); log('CAM unavailable on this platform', 'li'); return; }
    try {
      if (hud.cam) { await plugins.cam.stop(); hud.setCam(false); document.documentElement.classList.remove('cam-on'); }
      else { await plugins.cam.start({ parent: 'cam', position: 'rear', toBack: true, disableAudio: true }); hud.setCam(true); document.documentElement.classList.add('cam-on'); }   // toBack puts the preview BEHIND the webview — the page must go transparent or it paints black over it
    } catch (e) { log('CAM: ' + (e && e.message || e), 'le'); hud.setCam(false); }
    hud.sig = null; scheduleRender();
  },
  onCloseDiag: () => hud.toggleDiag(),
  onReconnectGun: () => { if (link.deviceId) link.retryNow(); },   // cuts the backoff short; _reconnect() alone was a no-op mid-loop
  onReconnectMc: () => {
    const url = settings.mcUrl || lastMcUrl;
    // with neither a remembered nor a discovered target there is nothing to dial, and a button that
    // silently does nothing reads as "the app is broken" (review 2026-09-01)
    if (!url) { log('NO MISSION CONTROL YET — SCAN THE JOIN QR ON THE MC SCREEN', 'le'); return; }
    connectMc(url, !!settings.mcUrl);
  },
  onScanQr: () => { scanQrForMc().catch(e => log('QR scan failed: ' + e.message, 'le')); },
  onEndOk: () => { engine.ackEnd(); },
  // onPanic removed 2026-08-26: a player-side panic only safes THIS gun and knocks the player out until a
  // re-push — a mishit mid-game ruins their match. Fleet safety = MC's PANIC + the physical power switch.
  onShareLog: async () => {
    // Build the diagnostic bundle ONCE: log lines + engine state + the raw BLE frame ring.
    // The frame ring (brxlink keeps the last 60 in/out frames) is the only record of what the gun
    // actually said, and without it a field fault on the phone side is undebuggable.
    let frameCount = 0;
    const bundle = () => {
      let frames = [];
      try { frames = (link && link.frames || []).map(f => `${f.t} ${f.dir} ${f.f}`); } catch (_) { /* ignore */ }
      frameCount = frames.length;
      return [
        logLines.join('\n'),
        '--- ble frames (last ' + frames.length + ') ---',
        frames.join('\n'),
        '--- engine state ---',
        JSON.stringify(engine.state()),
      ].join('\n');
    };
    // 1. queue the log to MC over the wire (log_offer + chunked log_data — the contract's log path)
    try {
      if (transport && transport.state === 'bound') {
        const text = bundle();
        const bytes = new TextEncoder().encode(text);
        // report() returns false when the socket is closing but `state` has not flipped yet, and
        // these frames do NOT go through the retry ring — so an unchecked send is a log that
        // silently never arrives while the HUD says it did (review 2026-09-01).
        let sent = transport.report('log_offer', { bytes: bytes.length, lines: logLines.length }) !== false;
        const CHUNK = 40 * 1024;
        for (let o = 0, seq = 0; o < text.length; o += CHUNK, seq++) {
          if (transport.report('log_data', { seq, chunk: text.slice(o, o + CHUNK), last: o + CHUNK >= text.length }) === false) sent = false;
        }
        if (!sent) throw new Error('the socket refused part of the log');
        log(`log sent to MC — ${bytes.length} bytes, ${frameCount} BLE frames ✓`, 'lk');
        return;                       // delivered: nothing to copy, nothing for the operator to do
      }
    } catch (e) { log('log→MC: ' + (e && e.message || e), 'le'); }
    // Fallback ONLY when MC could not take it. Tony, 2026-09-01: "get rid of the copy paste
    // fallback. just show that it successfully sent to MC" — a share sheet full of raw log after a
    // SUCCESSFUL upload reads as "it didn't work", and in the field nobody pastes it anywhere.
    log('MC unreachable — offering the log locally instead', 'le');
    const text = bundle();
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
  await link.scan(async d => {
    if (done || !d.name || d.name !== want) return;   // the remembered gun, by its advertised name
    done = true;
    try { await link.stopScan(); scanning = false; await link.connect(d.deviceId, d.name); if (settings.mcUrl && !transport) connectMc(settings.mcUrl); startBeaconScan().catch(() => {}); }
    catch (e) { log('rejoin connect: ' + (e && e.message || e), 'le'); }
    scheduleRender();
  });
  scanning = true;
  // if it never appears, the SET GUN button (picker) is still there — leave the scan open so it can
  setTimeout(() => { if (!done && !link.connected) log('remembered gun not seen yet — tap SET GUN to choose', 'li'); }, 12000);
}

function splitName(name, deviceId) { const m = /^(.*)-([0-9A-Fa-f]{4})$/.exec(name || ''); if (m) return { basename: m[1], tail: m[2].toUpperCase() }; return { basename: name, tail: String(deviceId || '').replace(/[^0-9a-f]/gi, '').slice(-4).toUpperCase() }; }

// ---------- render loop ----------
let renderQueued = false;
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; renderNow(); }); }
function renderNow() {
  const st = engine.state();
  hud.render(st);
  hud.setDiag({
    preflight, link: { deviceId: link.deviceId, connected: link.connected, retries: link.retries, mc: transport ? transport.state : 'none', mc_url: settings.mcUrl, node_id: transport ? transport.nodeId : '—' },
    engine: { phase: st.phase, alive: st.alive, hp: st.hp, armor: st.armor, ammo: st.ammo, reserve: st.reserve, shots: st.shots, deaths: st.deaths, match_id: st.matchId, player_num: st.playerNum, latch: engine.latch ? `${engine.latch.shooter_num}/${engine.latch.shooter_team}` : '—', resync: st.resync ? st.resync.step : '—' },
    timings: { offset_ms: transport ? Math.round(transport.clock.offset || 0) : 0, synced: st.synced, queue: transport ? transport.ring.pending().length : 0, t_minus_ms: st.tMinusMs, clock_ms: st.clockMs },
    frames: link.frames.slice(-14), log: logLines.slice(-30),
    stations: presence.stations().map(stationView),
  });
}
setInterval(() => { presenceTick(); engine.tick(); syncPlayerAdvert().catch(() => {}); scheduleRender(); }, 250);
setInterval(refreshPreflight, 5000);
setInterval(() => { try { hud.sync = { bound: !!transport && transport.state === 'bound', pending: transport && transport.ring ? transport.ring.pending().length : 0 }; } catch (_) { /* ignore */ } }, 1000);

// ---------- app lifecycle (§3.11) ----------
function onForeground(fg) {
  preflight.foreground = fg; preflight.screen_on = fg;
  if (transport) { transport.setPreflight(preflight); if (!fg) transport.status(engine.statusBody(preflight)); }   // one immediate status on background (§3.11)
  if (fg) { engine.resume(); keepAwake(true); }
}
document.addEventListener('visibilitychange', () => onForeground(document.visibilityState !== 'hidden'));
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
        log(`Mission Control discovered: ${url}`, 'lk');
        // Assist only when we have NO target of our own (nothing remembered AND nothing already
        // dialled), or when assist has been explicitly re-opened by a spell of not being bound.
        // The old `!settings.mcUrl` disjunct was true for exactly the phones a discovery-only join
        // had connected — `remember=false` never writes it — so those phones could be re-bound to a
        // second MC on any momentary drop, which is the hijack `allowAssist` exists to stop
        // (review 2026-09-01).
        if ((allowAssist || !(settings.mcUrl || lastMcUrl)) && (!transport || transport.state !== 'bound')) connectMc(url, false);
      } catch (e) { log('discovery: ' + (e && e.message || e), 'li'); }
    }).catch(e => log('discovery watch: ' + (e && e.message || e), 'li'));
  } catch (e) { log('discovery init: ' + (e && e.message || e), 'li'); }
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
      const url = code && code.data ? parseMcQr(code.data) : null;
      if (url) { stop(); log('QR scanned — connecting: ' + url, 'lk'); connectMc(url); return; }
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
// MC's HTTP port (8765) and let /api/state hand us the exact ws_url (CORS is open server-side for this).
async function sweepForMc() {
  if (transport && transport.state === 'bound') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;   // no network, no sweep
  const urlAtStart = settings.mcUrl;
  const subnets = [];
  const m = /ws:\/\/(\d+\.\d+\.\d+)\.(\d+):/.exec(settings.mcUrl || '');
  if (m) subnets.push(m[1]);
  for (const sn of ['192.168.0', '192.168.1', '192.168.86', '10.0.0', '172.20.10']) if (!subnets.includes(sn)) subnets.push(sn);
  log('sweeping for Mission Control on :8765…', 'li');
  for (const sn of subnets) {
    if (transport && transport.state === 'bound') return;
    const hosts = []; for (let i = 1; i <= 254; i++) hosts.push(`${sn}.${i}`);
    const POOL = 32;
    let found = null;
    const probe = async ip => {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 500);
      try {
        const r = await fetch(`http://${ip}:8765/api/state`, { signal: ac.signal });
        const j = await r.json();
        if (j && j.lan && j.lan.ws_url) found = j.lan.ws_url;
      } catch (_) { /* not MC */ } finally { clearTimeout(t); }
    };
    for (let i = 0; i < hosts.length && !found; i += POOL) await Promise.all(hosts.slice(i, i + POOL).map(probe));
    if (found) {
      log(`Mission Control found by port sweep: ${found}`, 'lk');
      if (settings.mcUrl && settings.mcUrl !== urlAtStart) return;   // the user typed/scanned mid-sweep — their target wins (polish-loop)
      if (!transport || transport.state !== 'bound') connectMc(found, false);
      return;
    }
  }
  log('sweep found no Mission Control — QR/manual join', 'li');
}

// ---------- boot ----------
(async () => {
  const params0 = new URLSearchParams(location.search);
  if (settings.role === 'utility' && !params0.has('demo') && !params0.has('gun') && !params0.has('hud')) { location.replace('utility.html'); return; }
  // 7 taps on the stage within 3 s while nothing is connected → utility mode (a hidden door until the HUD grows a button)
  try {
    let taps = []; const stage = document.getElementById('frame') || document.body;
    stage.addEventListener('pointerdown', () => { const now = Date.now(); taps = taps.filter(t => now - t < 3000); taps.push(now); if (taps.length >= 7 && engine.phase === 'idle' && !link.connected) { taps = []; switchRole('utility'); } }, { passive: true });
  } catch (_) { /* ignore */ }
  await loadPlugins();
  await lockLandscape(); await keepAwake(true);
  try { if (plugins.app) plugins.app.addListener('appStateChange', ({ isActive }) => onForeground(!!isActive)); } catch (_) { /* ignore */ }
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
      if (!transport || transport.state !== 'bound') { allowAssist = true; sweepForMc().catch(() => {}); }
    }, 15000);
  }
  await refreshPreflight(); scheduleRender();
})();
window.brx = { engine, link, hud, get transport() { return transport; }, connectMc, log: logLines, C, presence, switchRole };
