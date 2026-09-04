// utility.js — the UTILITY role: this phone IS an item on the field (docs/spec/utility.md).
// It advertises its identity (kind / team / state / its own "at me" threshold) in one service UUID via
// the brx-beacon plugin, shows what it is full-screen, and watches player adverts so the operator can
// calibrate the radius by standing where "at the station" should be and pressing SET.
// No gun, no engine: the revive itself happens on the player's phone (engine.js _triggerPulled).
import { BrxLink } from './brxlink.js';
import { Presence, encodeUuid, KIND, TEAM_ANY, PLAYER_STATE } from './beacon.js';
import { Transport } from './transport/transport.js';   // utility.md §5b/§5c: the phone joins MC at muster to be ARMED (contracts A13.5)

const $ = id => document.getElementById(id);
const TEAM_NAMES = { 0: 'RED', 1: 'BLUE', 2: 'YELLOW', 3: 'GREEN', [TEAM_ANY]: 'ANY TEAM' };
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
const DEFAULTS = { kind: 'respawn', team: 1, id: 1, tx: 'high', threshold: -74, dwell: 800, game: 0, mcArmed: null, mc: '' };   // mcArmed: {game, at, valid_ids} once MC pushed station_config   // -74 threshold + 0.8s dwell = arm's length, brief pause, green (bench-tuned 2026-09-04)
const DEMO = /[?&](stage|demo)\b/.test(typeof location !== 'undefined' ? location.search : '');   // the stage harness: no radio, fake players
const settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('brx.utility') || '{}') }; } catch (_) { return { ...DEFAULTS }; } })();
function save() { try { localStorage.setItem('brx.utility', JSON.stringify(settings)); } catch (_) { /* ignore */ } }

// ---------- plugins ----------
const plugins = {};
const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
async function loadPlugins() {
  const tryImport = async (name, fn) => { try { plugins[name] = (await fn()).v; } catch (e) { log(`plugin ${name} unavailable: ${e && e.message || e}`); } };
  await Promise.all([
    tryImport('beacon', () => import('brx-beacon').then(m => ({ v: m.BrxBeacon }))),
    tryImport('keepAwake', () => import('@capacitor-community/keep-awake').then(m => ({ v: m.KeepAwake }))),
  ]);
}

// ---------- the station ----------
let seq = 0, advertising = false, support = { advertising: false, txPowerControl: false, platform: 'web' };
const link = new BrxLink({ log });
const presence = new Presence({ defaultThreshold: settings.threshold, dwellMs: settings.dwell, alpha: 0.35 });
const wasAlive = new Map();          // player id → alive bit, to count revives that happened here
let revives = 0, scanning = false;

function stationUuid() {
  return encodeUuid({ role: 'station', id: settings.id, kind: settings.kind, team: settings.team, state: 1, value: 0, seq, game: settings.game, threshold: settings.threshold });
}
async function startAdvert() {
  if (DEMO) { advertising = true; settings.live = true; save(); log('stage: pretending to advertise', 'lk'); render(); return; }   // the harness has no radio (the plugin's web stub answers "no")
  if (!plugins.beacon) { log('no beacon plugin: this build cannot advertise (desktop?)', 'le'); render(); return; }
  try {
    seq = (seq + 1) & 0xff;
    const uuid = stationUuid();
    const name = `BRX-${settings.kind.toUpperCase()}-${settings.id}`;
    const r = await plugins.beacon.start({ uuid, name, txPower: settings.tx, mode: 'lowLatency', includeTxPower: true });
    advertising = !!(r && r.advertising);
    settings.live = advertising; save();   // a reload mid-game comes back advertising (the settings stay behind the ⓘ gate)
    log(`advertising ${name} as ${TEAM_NAMES[settings.team]} · tx ${r && r.txPowerControl ? settings.tx : 'platform default'} · threshold ${settings.threshold} dBm · ${uuid}`, 'lk');
  } catch (e) { advertising = false; log('advertise failed: ' + (e && e.message || e), 'le'); }
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
  settings.game = Number.isFinite(+body.game) ? (+body.game & 0xff) : 0;   // absent = 0 (any game), v1
  settings.mcArmed = { game: settings.game, at: Date.now(), valid_ids: Array.isArray(body.valid_ids) ? body.valid_ids.slice(0, 32) : null };
  save();
  log(`MC armed this phone: ${KIND_LABEL[settings.kind]} · ${TEAM_NAMES[settings.team] || settings.team} · station ${settings.id} · threshold ${settings.threshold} dBm · game ${settings.game}`, 'lk');
  if (window.brxUtilityGate) window.brxUtilityGate.close();   // the operator armed it: the drawer has no business being open
  await startAdvert();
}
function connectMc(url) {
  if (!url) return;
  settings.mc = url; save();
  if (transport) { try { transport.close(); } catch (_) { /* ignore */ } }
  transport = new Transport({ node: { node_type: 'utility', app_ver: 'utility' }, gun: null, keyPrefix: 'brxu' });   // its own node id: never the HUD's
  transport.armedOrLive = true;                            // keep dialling — at muster the operator is waiting on this
  transport.setStatusProvider(() => ({ role: 'utility', kind: settings.kind, team: settings.team, station_id: settings.id, threshold: settings.threshold, live: advertising, revives, armed: !!settings.mcArmed }));
  transport.onMessage(m => { if (m && m.kind === 'station_config') applyStationConfig(m.body); });
  transport.onState(s => { mcState = s; log(`MC ${s}${transport.rejected ? ' — ' + transport.rejected.reason : ''}`, s === 'bound' ? 'lk' : 'li'); render(); });
  transport.connect({ url }).catch(e => log('MC connect: ' + (e && e.message || e), 'le'));
}

async function stopAdvert() {
  try { if (plugins.beacon) await plugins.beacon.stop(); } catch (_) { /* ignore */ }
  advertising = false; settings.live = false; save(); log('advertising stopped'); render();
}
async function restartIfLive() { if (advertising) await startAdvert(); else render(); }

async function startScan() {
  if (scanning || !isNative()) return;
  scanning = true;
  try { await link.scan(hit => { if (hit.uuids && hit.uuids.length) presence.observe(hit.uuids, hit.rssi, Date.now()); }, { scanMode: 1 }); log('watching for players'); }
  catch (e) { scanning = false; log('scan: ' + (e && e.message || e), 'le'); }
}

function tick() {
  const now = Date.now();
  presence.defaultThreshold = settings.threshold;
  presence.tick(now);
  const seen = new Set();
  for (const p of presence.players()) {
    seen.add(p.id);
    const alive = !!(p.state & PLAYER_STATE.alive); const was = wasAlive.get(p.id);
    if (was === false && alive && p.present && settings.kind === 'respawn') { revives++; log(`player ${p.id} (${TEAM_NAMES[p.team] || p.team}) revived here`, 'lk'); }
    wasAlive.set(p.id, alive);
  }
  for (const id of wasAlive.keys()) if (!seen.has(id)) wasAlive.delete(id);   // don't grow unbounded over a long session
  render();
}

// ---------- screen ----------
function render() {
  const t = TEAM_KEYS[settings.team] || 'any';
  document.documentElement.dataset.team = t;
  $('kind').textContent = KIND_LABEL[settings.kind] || settings.kind.toUpperCase();
  $('team').textContent = TEAM_NAMES[settings.team] || `TEAM ${settings.team}`;
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
  $('mcstate').textContent = mcState === 'bound' ? 'MISSION CONTROL ✓ LINKED' : mcState === 'offline' ? (settings.mc ? 'MISSION CONTROL · OFFLINE' : 'MISSION CONTROL · NO ADDRESS') : `MISSION CONTROL · ${mcState.toUpperCase()}…`;
  if (document.activeElement !== $('mcUrl')) $('mcUrl').value = settings.mc || mcUrl() || '';
  const rows = presence.players().map(p => {
    const alive = !!(p.state & PLAYER_STATE.alive);
    return `<div class="row ${p.present ? 'near' : ''}"><span class="pid">P${p.id}</span><span class="pteam ${TEAM_KEYS[p.team] || 'any'}">${TEAM_NAMES[p.team] || p.team}</span><span class="rssi">${Math.round(p.rssi)}<small>/${Math.round(p.raw)} dBm</small></span><span class="state ${alive ? 'alive' : 'down'}">${alive ? 'ALIVE' : 'DOWN'}</span><span class="pres">${p.present ? 'AT STATION' : ''}</span></div>`;
  });
  $('players').innerHTML = rows.join('') || '<div class="row empty">no player phones in range</div>';
  for (const b of document.querySelectorAll('[data-tx]')) b.classList.toggle('sel', b.dataset.tx === settings.tx);
  for (const b of document.querySelectorAll('[data-kind]')) b.classList.toggle('sel', b.dataset.kind === settings.kind);
  for (const b of document.querySelectorAll('[data-team]')) b.classList.toggle('sel', +b.dataset.team === settings.team);
}

function wire() {
  $('btnStart').onclick = () => (advertising ? stopAdvert() : startAdvert());
  $('btnMc').onclick = () => connectMc($('mcUrl').value.trim());
  $('btnHud').onclick = async () => { await stopAdvert(); try { localStorage.setItem('brx.role', 'hud'); } catch (_) { /* ignore */ } location.replace('index.html?hud'); };
  for (const b of document.querySelectorAll('[data-kind]')) b.onclick = () => { settings.kind = b.dataset.kind; save(); restartIfLive(); };
  for (const b of document.querySelectorAll('[data-team]')) b.onclick = () => { settings.team = +b.dataset.team; save(); restartIfLive(); };
  for (const b of document.querySelectorAll('[data-tx]')) b.onclick = () => { settings.tx = b.dataset.tx; save(); restartIfLive(); };
  $('idMinus').onclick = () => { settings.id = Math.max(1, settings.id - 1); save(); restartIfLive(); };
  $('idPlus').onclick = () => { settings.id = Math.min(65535, settings.id + 1); save(); restartIfLive(); };
  $('thrRange').oninput = e => { settings.threshold = +e.target.value; save(); render(); };
  $('thrRange').onchange = () => restartIfLive();
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
}

(async () => {
  wire(); render();
  await loadPlugins();
  try { if (plugins.keepAwake) await plugins.keepAwake.keepAwake(); } catch (_) { /* ignore */ }
  try { if (plugins.beacon) support = await plugins.beacon.isSupported(); } catch (e) { log('isSupported: ' + (e && e.message || e)); }
  if (DEMO) support = { advertising: true, txPowerControl: true, platform: 'stage' };
  log(`utility mode · ${support.platform} · advertise ${support.advertising ? 'yes' : 'NO'} · tx control ${support.txPowerControl ? 'yes' : 'no'}`);
  if (settings.live) await startAdvert();   // it was live when the phone last ran: come straight back up
  render();
  const url = mcUrl(); if (url && !DEMO) connectMc(url);   // setup needs WiFi (A13.5); once armed, play does not
  if (!plugins.beacon || !support.advertising) log('this phone cannot advertise; check Bluetooth is on', 'le');
  await startScan();
  setInterval(tick, 250);
  if (DEMO) seedDemo();
  window.brxUtility = { settings, presence, startAdvert, stopAdvert, render, log: logLines, stationUuid, applyStationConfig, connectMc, get transport() { return transport; } };
  window.brxUtil = window.brxUtility;
})();

/** The stage harness: three fake player phones on a 250 ms timer — one close, one far, one drifting across the threshold. */
function seedDemo() {
  const t0 = Date.now();
  const fake = [{ id: 7, team: 1, alive: true, rssi: () => -58 }, { id: 19, team: 2, alive: false, rssi: () => -80 },
                { id: 23, team: 1, alive: true, rssi: () => -74 + 9 * Math.sin((Date.now() - t0) / 4000) }];
  setInterval(() => {
    const now = Date.now();
    for (const f of fake) presence.observe([encodeUuid({ role: 'player', id: f.id, kind: 0, team: f.team, state: f.alive ? PLAYER_STATE.alive : 0, seq: 0, game: settings.game })], f.rssi() + (Math.random() - .5) * 2, now);
  }, 250);
  window.brxUtilityFake = fake;
}
