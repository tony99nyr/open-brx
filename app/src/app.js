// BRX Combat HUD — the per-player node (docs/spec/node.md, contracts A6).
// One phone, one gun, one player. Composition of: Engine (state machine) + BrxLink (BLE) +
// Transport (M-NET wire) + Hud (Phone HUD v2). Runs in a desktop browser with `?demo`.
import { Engine, C } from './engine.js';
import { BrxLink } from './brxlink.js';
import { Transport } from './transport/transport.js';
import { Hud } from './hud/hud.js';

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
};

// ---------- wiring ----------
const hud = new Hud(document, {});
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
  storage: (() => { try { return localStorage; } catch (_) { return null; } })(),
  log, onChange: () => scheduleRender(),
});
engine.night = settings.night;
hud.mcUrl = settings.mcUrl;
// per-match history (bench request 2026-08-25): node-local, survives restarts, capped
try { hud.history = JSON.parse(localStorage.getItem('brx.history') || '[]'); } catch (_) { hud.history = []; }
engine.onEnd = (g) => { try { const h = hud.history || []; h.push(g); while (h.length > 50) h.shift(); hud.history = h; localStorage.setItem('brx.history', JSON.stringify(h)); } catch (_) { /* best-effort */ } };

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

function connectMc(url) {
  if (!url) return;
  settings.mcUrl = url; hud.mcUrl = url;
  if (transport) { try { transport.close(); } catch (_) { /* ignore */ } }
  const gun = engine.gun ? { name: engine.gun.name, tail: engine.gun.tail, fw: engine.fw || undefined } : null;
  transport = new Transport({ node: { app_ver: APP_VER }, gun });
  transport.setStatusProvider(() => engine.statusBody(preflight));
  transport.onHydrate(node => engine.hydrate(node));
  transport.onMessage(m => { engine.onMcMessage(m); if (m.kind === 'feedback' && m.body && m.body.kind === 'kill') haptic('kill'); });
  transport.onState(s => { engine.setWsState(s, transport.rejected); log(s === 'rejected' ? `MC REFUSED: ${transport.rejected && transport.rejected.reason} (${transport.rejected && transport.rejected.code})` : `MC link ${s}`, s === 'bound' ? 'lk' : s === 'rejected' ? 'le' : 'li'); });
  transport.connect({ url }).then(() => log('MC hydrated', 'lk')).catch(e => log('MC connect: ' + (e && e.message || e), 'le'));
}

// ---------- HUD handlers ----------
let scanning = false; const found = new Map();
Object.assign(hud.h, {
  onSetGun: async () => {
    if (scanning) { await link.stopScan(); scanning = false; }   // tap = (re)start a fresh scan, never leave the picker idle (bench 2026-08-25)
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
    try { await link.connect(deviceId, d.name); if (settings.mcUrl && !transport) connectMc(settings.mcUrl); }
    catch (e) { log('connect failed: ' + (e && e.message || e), 'le'); }
    scheduleRender();
  },
  onReady: () => { if (engine.phase === 'kitted') { engine.setReady(!engine.ready); haptic('tap'); } },
  onSetUrl: () => { const el = $('mcurl'); if (el && el.value.trim()) connectMc(el.value.trim()); },
  onToggleNight: () => { engine.night = !engine.night; settings.night = engine.night; hud.sig = null; scheduleRender(); },
  onToggleCam: async () => {
    if (!plugins.cam || !isNative()) { hud.setCam(false); log('CAM unavailable on this platform', 'li'); return; }
    try {
      if (hud.cam) { await plugins.cam.stop(); hud.setCam(false); document.documentElement.classList.remove('cam-on'); }
      else { await plugins.cam.start({ parent: 'cam', position: 'rear', toBack: true, disableAudio: true }); hud.setCam(true); document.documentElement.classList.add('cam-on'); }   // toBack puts the preview BEHIND the webview — the page must go transparent or it paints black over it
    } catch (e) { log('CAM: ' + (e && e.message || e), 'le'); hud.setCam(false); }
    hud.sig = null; scheduleRender();
  },
  onCloseDiag: () => hud.toggleDiag(),
  onReconnectGun: () => { if (link.deviceId) link._reconnect(); },
  onReconnectMc: () => connectMc(settings.mcUrl),
  onEndOk: () => { engine.ackEnd(); },
  // onPanic removed 2026-08-26: a player-side panic only safes THIS gun and knocks the player out until a
  // re-push — a mishit mid-game ruins their match. Fleet safety = MC's PANIC + the physical power switch.
  onShareLog: async () => {
    // 1. queue the log to MC over the wire (log_offer + chunked log_data — the contract's log path)
    try {
      if (transport && transport.state === 'bound') {
        const text = logLines.join('\n') + '\n' + JSON.stringify(engine.state());
        const bytes = new TextEncoder().encode(text);
        transport.report('log_offer', { bytes: bytes.length, lines: logLines.length });
        const CHUNK = 40 * 1024;
        for (let o = 0, seq = 0; o < text.length; o += CHUNK, seq++) {
          transport.report('log_data', { seq, chunk: text.slice(o, o + CHUNK), last: o + CHUNK >= text.length });
        }
        log('log sent to MC', 'lk');
      }
    } catch (e) { log('log→MC: ' + (e && e.message || e), 'le'); }
    // 2. local share/copy still works (field debugging without MC)
    const text = logLines.join('\n') + '\n' + JSON.stringify(engine.state());
    try { if (plugins.share) await plugins.share.share({ title: 'BRX node log', text }); else await navigator.clipboard.writeText(text); log('log shared/copied', 'lk'); }
    catch (e) { log('share: ' + (e && e.message || e), 'le'); }
  },
  onCloseDiag: () => hud.toggleDiag(),
  onDemo: () => { location.search = '?demo'; },
  onHaptic: k => haptic(k),
});
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
  });
}
setInterval(() => { engine.tick(); scheduleRender(); }, 250);
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
        if (!transport || transport.state !== 'bound') connectMc(url);
      } catch (e) { log('discovery: ' + (e && e.message || e), 'li'); }
    }).catch(e => log('discovery watch: ' + (e && e.message || e), 'li'));
  } catch (e) { log('discovery init: ' + (e && e.message || e), 'li'); }
}

// ---------- boot ----------
(async () => {
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
    if (!engine.gun) { try { await hud.h.onSetGun(); } catch (_) { /* permission denied etc. — button still works */ } }
    // remembered address: CONNECT now — a gunless hello is fine (late-bind), and waiting for a gun left
    // mc_reachable=false with MC right there (Tony, 2026-08-26)
    if (settings.mcUrl && !transport) { log(`MC address remembered — connecting: ${settings.mcUrl}`, 'lk'); connectMc(settings.mcUrl); }
    startDiscovery();
  }
  await refreshPreflight(); scheduleRender();
})();
window.brx = { engine, link, hud, get transport() { return transport; }, connectMc, log: logLines, C };
