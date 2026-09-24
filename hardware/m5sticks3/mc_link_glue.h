// mc_link_glue.h - the Arduino plumbing for H8 (docs/spec/utility.md §5g): Wi-Fi, mDNS discovery,
// the WebSocket to Mission Control, BLE scanning for a powerup CLAIM, and Preferences. Everything
// that DECIDES anything lives in station_link.h / station_ui.h (host-tested); this file only drives
// real hardware from those decisions and is never built on the host.
//
// Libraries: WiFi.h + ESPmDNS.h + Preferences.h (bundled with the esp32/m5stack Arduino core) and
// "WebSockets" by Markus Sattler (github.com/Links2004/arduinoWebSockets, installed via
// `arduino-cli lib install "WebSockets"`) for the client socket -- chosen over ArduinoWebsockets
// (gilmaimon) because its `onEvent`/`loop()` shape matches this sketch's existing non-blocking
// poll-every-loop() style with no extra thread or blocking call, and it is the library M5Stack's
// own examples use most often, so the ESP32-S3 + NimBLE coexistence path is well trodden.
//
// BENCH TO CONFIRM (none of this has run on a Stick): mDNS query timing, WebSocket reconnect
// behaviour under Wi-Fi 4 + BLE 5 coexistence (utility.md §5g.4's whole point), the CLAIM scan
// window against a phone advertising every ~100-250 ms while claiming, and the ROLE_PLAYER advert
// layout this file assumes (id = player_num, value = target station id, state bits 4/5) -- FYI'd by
// brx5, never seen on our own bench.
#pragma once
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEScan.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <esp_random.h>

#include "brx_advert.h"
#include "json_lite.h"
#include "station_link.h"
#include "station_ui.h"

namespace brx_glue {

using namespace brx;

// ---- tunables (bench to confirm all of them) ---------------------------------------------------
constexpr uint32_t STATUS_HEARTBEAT_MS = 2000;   // utility.md §5g.2
constexpr uint32_t MDNS_RETRY_MS = 4000;         // how often to re-browse _openbrx._tcp
constexpr uint32_t CLAIM_SCAN_WINDOW_S = 1;      // BLEScan duration per window (async, non-blocking)
// Polish round 1 (2026-09-24): this MUST stay longer than CLAIM_SCAN_WINDOW_S's 1000 ms, or a new
// window is requested while the last one is still running -- `mcPollClaimScan` also guards with
// `isScanning()` below, but a period shorter than the window would still mean back-to-back windows
// with no gap, never letting `onClaimScanComplete` (and its `resolve_batch()`) run in between.
constexpr uint32_t CLAIM_SCAN_PERIOD_MS = 1200;

// ---- persisted state (Preferences, namespace "brxmc" -- separate from "brx"'s bench settings) --
Preferences mcPrefs;
String wifiSsid, wifiPass;
String stationAppVer = "h8-0.1";  // bumped by hand; no build-time git sha injection in this sketch yet
bool actionsEnabled = false;      // mirrors link.actions_enabled(); persisted so ACTIONS survives a reboot
uint32_t bootCount = 0;           // A58: incremented once per boot in mcSetup(); rides on every status

// A58: count this boot. MC reads `boot_count` (with `uptime_s`) off the status heartbeat to notice
// that a Stick restarted mid-match -- the one event that silently drops its RAM-only match lock.
static void mcCountBoot() {
  mcPrefs.begin("brxmc", false);
  bootCount = mcPrefs.getUInt("boots", 0) + 1;
  mcPrefs.putUInt("boots", bootCount);
  mcPrefs.end();
}

static void mcLoadPrefs(StationLink& link) {
  mcPrefs.begin("brxmc", true);
  wifiSsid = mcPrefs.getString("ssid", "");
  wifiPass = mcPrefs.getString("pass", "");
  String nodeId = mcPrefs.getString("node_id", "");
  String nodeKey = mcPrefs.getString("node_key", "");
  uint8_t assoc = mcPrefs.getUChar("assoc", (uint8_t)AssocMode::MUSTER);
  actionsEnabled = mcPrefs.getBool("actions", true);  // default ON since MC accepts station_action (A56, f3fe3cf6); ACTIONS OFF for an older MC
  mcPrefs.end();
  if (nodeId.length() == 0) {
    // A stable id, or MC sees a new item every power cycle (§5g.2). No node_id was ever chosen, so
    // mint one from the chip's own MAC-derived id, which is stable across reboots without needing a
    // real RNG seed this early in boot.
    char buf[24];
    snprintf(buf, sizeof buf, "stick-%012llx", (unsigned long long)ESP.getEfuseMac());
    nodeId = buf;
    mcPrefs.begin("brxmc", false);
    mcPrefs.putString("node_id", nodeId);
    mcPrefs.end();
  }
  StationIdentity id;
  id.node_id = nodeId.c_str();
  id.node_key = nodeKey.c_str();
  id.app_ver = stationAppVer.c_str();
  id.platform = "esp32";
  link.set_identity(id);
  link.set_mode(assoc == (uint8_t)AssocMode::HELD ? AssocMode::HELD : AssocMode::MUSTER);
  link.set_actions_enabled(actionsEnabled);
  if (wifiSsid.length()) link.wifi_configured();
}

static void mcSaveWifi(const String& ssid, const String& pass) {
  mcPrefs.begin("brxmc", false);
  mcPrefs.putString("ssid", ssid);
  mcPrefs.putString("pass", pass);
  // A new network means a new event: a station config saved at the last one must not come back.
  mcPrefs.remove("station_cfg");
  mcPrefs.remove("station_sid");
  mcPrefs.end();
  wifiSsid = ssid;
  wifiPass = pass;
}

static void mcSaveNodeKey(const String& key) {
  mcPrefs.begin("brxmc", false);
  mcPrefs.putString("node_key", key);
  mcPrefs.end();
}

static void mcSaveAssoc(AssocMode m) {
  mcPrefs.begin("brxmc", false);
  mcPrefs.putUChar("assoc", (uint8_t)m);
  mcPrefs.end();
}

static void mcSaveActionsEnabled(bool on) {
  mcPrefs.begin("brxmc", false);
  mcPrefs.putBool("actions", on);
  mcPrefs.end();
}

// ---- restart survival: the last applied station_config ("station_cfg", no lock_s) ---------------
// SavedStationConfig (station_link.h, host-tested) decides WHEN to write; these only touch flash. A
// same-config re-push (MC's mid-match lock carrier) serialises to the same string and writes nothing.
SavedStationConfig savedConfig;

static void mcWriteSavedConfig() {
  mcPrefs.begin("brxmc", false);
  mcPrefs.putString("station_cfg", savedConfig.stored().c_str());
  mcPrefs.putString("station_sid", savedConfig.session_id().c_str());  // the WELCOME session it came in
  mcPrefs.end();
  Serial.println("# station_config saved (restart survival)");
}

static void mcEraseSavedConfig() {
  mcPrefs.begin("brxmc", false);
  mcPrefs.remove("station_cfg");
  mcPrefs.remove("station_sid");
  mcPrefs.end();
  Serial.println("# saved station_config erased");
}

// At boot, before Wi-Fi: play the saved station at once (see restore_station_config's comment for
// why this never latches the MUSTER drop and never carries a lock).
static void mcRestoreSavedConfig(StationLink& link) {
  mcPrefs.begin("brxmc", true);
  String body = mcPrefs.getString("station_cfg", "");
  String sid = mcPrefs.getString("station_sid", "");
  mcPrefs.end();
  savedConfig.loaded(body.c_str(), sid.c_str());
  if (!savedConfig.has()) return;
  // Review round 1: bench mode (no Wi-Fi SSID set) never restores; the saved copy is left alone.
  if (wifiSsid.length() == 0) {
    Serial.println("# saved station_config kept but not restored (no Wi-Fi set: bench mode)");
    return;
  }
  StationAssignment a = savedConfig.restore();
  if (!link.restore_station_config(a)) {
    Serial.println("# saved station_config does not parse; erasing it");
    if (savedConfig.note_released()) mcEraseSavedConfig();
    return;
  }
  Serial.printf("RESTORED kind=%s team=%d id=%d game=%d (from flash; unlocked)\n", a.kind.c_str(), a.team,
                a.id, a.game);
}

// ---- A58: the PMIC side-button lock (TODO, deliberately NOT written) -------------------------------
// The StickS3's small side button is wired to the M5PM1 PMIC, not the ESP32: a single click resets
// the Stick and a double click powers it off, whatever the firmware says. The brief for A58 names
// M5PM1 register 0x49 bit0 (disable the single-click reset) and register 0x4A bit0 (disable the
// double-click power-off). What the installed M5Unified 0.2.21 source DOES confirm: the PM1 sits at
// I2C 0x6E (`M5PM1_Class::DEFAULT_ADDRESS`, utility/power/M5PM1_Class.hpp; also M5GFX.cpp's
// `m5pm1_i2c_addr`), `M5.Power.M5pm1` is public on an ESP32-S3 build, and it inherits I2C_Device's
// public read-modify-write `bitOn(reg, mask)` / `bitOff(reg, mask)` (utility/I2C_Class.hpp). What it
// does NOT confirm: its register table (utility/power/M5PM1_Class.cpp) stops at 0x45 (IRQ_MASK3);
// 0x49 and 0x4A are not named anywhere in M5Unified or M5GFX. So nothing here writes the PM1.
//
// TODO(A58, bench + M5PM1 datasheet): once 0x49/0x4A are confirmed from the datasheet, the body is
//   locked ? M5.Power.M5pm1.bitOn(0x49, 0x01) && M5.Power.M5pm1.bitOn(0x4A, 0x01)
//          : M5.Power.M5pm1.bitOff(0x49, 0x01) && M5.Power.M5pm1.bitOff(0x4A, 0x01)
// guarded by `M5.Power.getType() == m5::Power_Class::pmic_m5pm1`. NEVER touch bit7 of 0x49 (the
// download-mode lock) or any other bit or register. The call sites below (a lock starting or ending,
// and unconditionally clear at boot) are already in place, so enabling it is this one body.
// Until then a player CAN restart a locked Stick with the side button; the restart drops the lock,
// and MC sees it as a moved `boot_count`.
bool pmicSideButtonLocked = false;  // what the PMIC was last asked for (today: only what we WOULD ask)
static void pmicSetSideButtonLock(bool locked) {
  pmicSideButtonLocked = locked;
  Serial.printf("# PMIC side-button lock %s (TODO: not written, register map unconfirmed)\n",
                locked ? "ON" : "OFF");
}

// ---- the typed floor: `MC <ws-url>` (never persisted across reboots, §5g.3) ---------------------
struct WsAddress {
  bool valid = false;
  String host;
  uint16_t port = 80;
  String path = "/ws";
};

// Accepts "ws://host:port/path" or "host:port" (path defaults to /ws, port to 80). Bare enough for
// a typed console command; not a general URL parser.
static WsAddress mcParseWsUrl(String url) {
  WsAddress a;
  url.trim();
  if (url.startsWith("ws://")) url.remove(0, 5);
  int slash = url.indexOf('/');
  String hostPort = slash >= 0 ? url.substring(0, slash) : url;
  a.path = slash >= 0 ? url.substring(slash) : "/ws";
  int colon = hostPort.indexOf(':');
  if (colon < 0) return a;  // a port is mandatory: MC never lives on 80 in practice, and guessing hides a typo
  a.host = hostPort.substring(0, colon);
  a.port = (uint16_t)hostPort.substring(colon + 1).toInt();
  a.valid = a.host.length() > 0 && a.port > 0;
  return a;
}

// ---- module state --------------------------------------------------------------------------- //
StationLink link;
StationButtons buttons;
WebSocketsClient ws;
WsAddress pendingTypedMc;    // set by `MC <url>`; consumed once and then forgotten (never persisted)
bool haveTypedMc = false;
uint32_t lastMdnsTryMs = 0;
uint32_t lastHeartbeatMs = 0;
uint32_t lastClaimScanMs = 0;
bool wsWantOpen = false;     // true once we have picked an address and should be socket-connected
// Polish round 1: `status.live` must say whether the BLE advert is actually up, not merely that MC
// armed us -- an advert can fail to start (ERR advert start, m5sticks3.ino publishAdvert()) or a
// BRIDGE can withdraw it (no live beacon) while still fully ASSIGNED. The .ino calls mcSetLive()
// with its own `advertising` bool once per pollAdvert().
bool stationLive = false;
static void mcSetLive(bool live) { stationLive = live; }
uint32_t bootRandomPrefix = 0;  // set once in mcSetup(); the fixed half of every station_action id
uint32_t actionSeq = 0;         // the counter half; together they make every envelope id unique per send

// Polish round 1 (2026-09-24): a literal envelope id ("claim", "reset-btn") is the same id on every
// send, which is wrong on general principle even though MC does not check it today (station_action
// itself is not yet in NODE_KINDS -- see the ACTIONS gate below). One call site for both senders.
static String mcNextActionId() {
  char buf[16];
  snprintf(buf, sizeof buf, "%08lx%04x", (unsigned long)bootRandomPrefix, (unsigned)(actionSeq++ & 0xffff));
  return String(buf);
}

// The station's own advert-facing settings (kind/team/id/game come from `link.assignment()` once
// ASSIGNED; before that a Stick standing alone keeps whatever the existing `settings`/`point`
// bench mode already does -- see m5sticks3.ino's own ID/GAME/MODE commands, untouched by H8).

// ---- BLE claim scan (A56) -------------------------------------------------------------------- //
class ClaimScanCallbacks : public BLEAdvertisedDeviceCallbacks {
 public:
  void onResult(BLEAdvertisedDevice advertisedDevice) override {
    if (!advertisedDevice.haveServiceUUID()) return;
    Advert a;
    String uuidStr = advertisedDevice.getServiceUUID().toString();  // BLEUUID::toString() -> Arduino String
    if (!decode_advert(std::string(uuidStr.c_str()), a)) return;
    if (a.role != ROLE_PLAYER) return;
    bool claiming = (a.state & PLAYER_CLAIMING) != 0;
    bool ready = (a.state & PLAYER_CLAIM_READY) != 0;
    if (!claiming && !ready) return;
    link.claims().observe(/*player_num=*/a.id, /*target_station_id=*/a.value, a.game, claiming,
                           ready, advertisedDevice.getRSSI());
  }
};
ClaimScanCallbacks claimScanCallbacks;
bool claimScanConfigured = false;

// Set when something the operator should see changed: an MC frame, a self-spawn, a claim, a link change.
// The .ino reads and clears it, and treats it like a button press: repaint AND wake the backlight.
static volatile bool mcScreenWake = false;  // volatile: the claim-scan callback sets it too

// Polish round 2 (HIGH): this callback must NEVER touch the WebSocket -- it runs off the BLE scan's
// own completion, not mcLoop, and the library is not written to be called from there (nor does any
// other I/O belong in a callback). `award_claim` only enqueues the report (station_link.h); mcLoop is
// the sole place anything is ever sent, and it drains the queue every tick.
static void onClaimScanComplete(BLEScanResults /*results*/) {
  ClaimWinner w = link.claims().resolve_batch();
  if (link.award_claim(w, millis())) {
    mcScreenWake = true;  // the player at the station just took it: show TAKEN BY at once
    Serial.printf("CLAIM station=%d taker=%u (queued for MC)\n", link.assignment().id, w.player_num);
  }
  BLEDevice::getScan()->clearResults();
}

static void mcPollClaimScan(uint32_t now) {
  // Polish round 1 (CRITICAL): gated on the PERSISTED assignment, never link state -- see
  // `has_powerup_assignment()`'s own comment in station_link.h.
  if (!link.has_powerup_assignment()) return;
  if (!link.powerup().available()) return;  // nothing to claim while taken
  if (now - lastClaimScanMs < CLAIM_SCAN_PERIOD_MS) return;
  BLEScan* scan = BLEDevice::getScan();
  // Polish round 1: a batch already running must finish (and call resolve_batch() in
  // onClaimScanComplete) before a new one starts, or a batch can be aborted mid-window and its
  // candidates lost. `lastClaimScanMs` is only advanced once a window actually opens, so a busy
  // scanner just tries again next loop() instead of silently missing a whole period.
  if (scan->isScanning()) return;
  lastClaimScanMs = now;
  if (!claimScanConfigured) {
    scan->setAdvertisedDeviceCallbacks(&claimScanCallbacks, /*wantDuplicates=*/true);
    scan->setActiveScan(false);  // passive: we only read the advert, never need a scan response
    scan->setInterval(100);
    scan->setWindow(99);
    claimScanConfigured = true;
  }
  scan->start(CLAIM_SCAN_WINDOW_S, onClaimScanComplete, false);
}

// ---- WebSocket event handling ------------------------------------------------------------------
static void mcSendHello() {
  String body = String(build_hello_body(link.identity(), 0).c_str());
  char envId[13];
  snprintf(envId, sizeof envId, "%08lx%02x", (unsigned long)millis(), (unsigned)esp_random() & 0xff);
  String env = String(make_envelope("hello", body.c_str(), envId, (int64_t)millis()).c_str());
  ws.sendTXT(env);
  link.ws_open_hello_sent();
}

// The MUSTER drop's radio action. WHEN is station_link.h's decision (take_muster_drop, host-tested);
// this only performs it, from mcHandleFrame or mcLoop.
static void mcPerformMusterDrop() {
  Serial.println("MUSTER: dropping the Wi-Fi association for the match (LINK RECONNECT to rejoin)");
  ws.disconnect();
  WiFi.disconnect();
  wsWantOpen = false;
  link.wifi_down();
}

static void mcHandleFrame(const String& text) {
  bool ok = false;
  json::Value env = json::parse(std::string(text.c_str()), &ok);
  if (!ok || !env.is_object()) return;
  std::string kind = env.get("kind").as_string();
  const json::Value& body = env.get("body");
  if (kind == "welcome") {
    WelcomeMsg w = parse_welcome(body);
    link.apply_welcome(w);
    mcScreenWake = true;
    if (!w.node_key.empty()) mcSaveNodeKey(w.node_key.c_str());
    Serial.printf("WELCOME session=%s\n", w.session_id.c_str());
    // Review round 1 (HIGH): a saved config from another MC session is an old match's; erase it, and
    // drop the assignment too while it is still the restored one (station_link.h decides).
    bool wasRestored = link.restored();
    if (w.ok && apply_welcome_to_saved(link, savedConfig, w.session_id)) {
      mcEraseSavedConfig();
      if (wasRestored && !link.restored()) Serial.println("STALE restored config (new MC session): UNASSIGNED");
    }
  } else if (kind == "station_config") {
    StationAssignment a = parse_station_config(body);
    if (a.present) {
      // §5g.4 + polish round 2: apply_station_config() decides AND latches `dropped_for_match()`
      // (a game-byte edge under MUSTER, including the very first arm after boot) -- this is only the
      // radio action the glue owns; the decision itself is pure and tested in station_link.h.
      uint32_t rx = millis();
      link.apply_station_config(a, rx);  // A58: also REPLACES the match lock, counted from `rx`
      // Only when it differs (lock_s excluded) or the session is new.
      if (savedConfig.note_applied(a, link.session_id())) mcWriteSavedConfig();
      mcScreenWake = true;
      Serial.printf("MC-ARMED kind=%s team=%d id=%d game=%d threshold=%d lock_s=%d\n", a.kind.c_str(), a.team,
                    a.id, a.game, a.threshold, a.lock_s);
      // Due now, except the first config after a restore: that drop waits for MC's re-anchoring
      // station_update, or MUSTER_DROP_DEFER_MS (review round 1); mcLoop and the update path retry.
      if (link.take_muster_drop(rx)) mcPerformMusterDrop();
      else if (link.muster_drop_pending()) Serial.println("MUSTER: drop deferred until MC's station_update");
    }
  } else if (kind == "station_update") {
    StationUpdateMsg u = parse_station_update(body);
    if (link.apply_station_update(u, millis())) {
      mcScreenWake = true;
      Serial.printf("STATION_UPDATE id=%d available=%d next_spawn_in_ms=%ld\n", u.id, u.available,
                    u.next_spawn_in_ms);
      if (link.take_muster_drop(millis())) mcPerformMusterDrop();  // a deferred drop: the re-anchor landed
    }
  } else if (kind == "control") {
    std::string cmd = parse_control_cmd(body);
    if (cmd == "release_utility") {
      link.apply_release();
      if (savedConfig.note_released()) mcEraseSavedConfig();  // a released Stick must not come back armed
      mcScreenWake = true;
      Serial.println("RELEASED (control.release_utility): back to UNASSIGNED");
    }
  }
}

static void mcWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("WS connected; sending hello");
      mcSendHello();
      break;
    case WStype_DISCONNECTED: {
      Serial.println("WS disconnected");
      link.ws_closed();
      // Polish round 1: drive the library's own retry cadence from station_link.h's Backoff
      // (base 500 ms, x2, cap 10 s, +-20% jitter, tested in test_link.cpp) instead of leaving it at
      // the library's fixed default -- `apply_welcome()` resets the counter back to attempt 0 on a
      // successful reconnect, so a flaky link backs off and a healthy one recovers at the base rate.
      float rand01 = (float)esp_random() / 4294967295.0f;  // esp_random()'s full uint32_t range
      ws.setReconnectInterval(link.backoff().next(rand01));
      break;
    }
    case WStype_TEXT:
      mcHandleFrame(String((char*)payload, length));
      break;
    default:
      break;
  }
}

// ---- mDNS discovery -------------------------------------------------------------------------- //
static bool mcTryMdns(WsAddress& out) {
  int n = MDNS.queryService("openbrx", "tcp");
  if (n <= 0) return false;
  out.host = MDNS.address(0).toString();
  out.port = MDNS.port(0);
  String path = MDNS.txt(0, "ws_path");
  out.path = path.length() ? path : "/ws";
  out.valid = true;
  return true;
}

// ---- the main poll, called every loop() with the current millis() ------------------------------
static void mcLoop(uint32_t now) {
  // The station's own play runs FIRST, before any Wi-Fi or WebSocket handling, because MUSTER keeps Wi-Fi down for
  // the whole match: SELF-SPAWN and the CLAIM scan are gated on the PERSISTED assignment
  // (`has_powerup_assignment()`), never on link state. (Polish round 3: they used to sit after the `!wifiUp` early
  // return below, so a muster station never spawned or awarded during play.)
  if (link.has_powerup_assignment()) {
    if (link.tick_powerup(now)) mcScreenWake = true;  // a SELF-SPAWN: the item is back
    mcPollClaimScan(now);
  }
  // A58: the match lock counts down on millis() whatever the link is doing (MUSTER is off Wi-Fi for
  // the whole match) and auto-unlocks at zero. The PMIC follows the lock on every edge: a start, a
  // replacement by a later config, lock_s 0, a release, or the countdown running out.
  if (link.poll_lock(now)) {
    mcScreenWake = true;
    Serial.println("UNLOCKED (match lock ran out)");
  }
  // A deferred MUSTER drop whose 2 s ran out with no station_update (review round 1).
  if (link.take_muster_drop(now)) mcPerformMusterDrop();
  bool wantPmicLock = link.lock().locked(now);
  if (wantPmicLock != pmicSideButtonLocked) pmicSetSideButtonLock(wantPmicLock);
  // Wi-Fi association.
  bool wifiUp = WiFi.status() == WL_CONNECTED;
  if (wifiUp && link.state() == LinkState::JOINING_WIFI) link.wifi_up();
  if (!wifiUp && link.state() != LinkState::NOT_CONFIGURED && link.state() != LinkState::JOINING_WIFI) {
    link.wifi_down();
  }
  // Any link state change (Wi-Fi lost, MC found, joined, closed) is an event the operator should see.
  static LinkState lastLinkState = link.state();
  if (link.state() != lastLinkState) { lastLinkState = link.state(); mcScreenWake = true; }
  if (!wifiUp) {
    // Polish round 2 (CRITICAL): a deliberate MUSTER drop must STAY dropped. Without this guard the
    // very next tick's kick re-associated Wi-Fi immediately, undoing the drop `mcHandleFrame` just
    // performed -- the whole point of MUSTER. `LINK RECONNECT` (below) is the only way past it.
    if (!link.dropped_for_match() && link.state() == LinkState::JOINING_WIFI && wifiSsid.length() &&
        WiFi.status() != WL_IDLE_STATUS) {
      WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());  // (re)kick the association; cheap if already trying
    }
    return;
  }

  // Address discovery: a typed `MC <url>` wins immediately; otherwise browse mDNS periodically.
  if (link.state() == LinkState::LOOKING_FOR_MC) {
    if (haveTypedMc) {
      link.mc_address_known();
      ws.begin(pendingTypedMc.host.c_str(), pendingTypedMc.port, pendingTypedMc.path.c_str());
      wsWantOpen = true;
      haveTypedMc = false;
    } else if (now - lastMdnsTryMs >= MDNS_RETRY_MS) {
      lastMdnsTryMs = now;
      WsAddress found;
      if (mcTryMdns(found)) {
        link.mc_address_known();
        ws.begin(found.host.c_str(), found.port, found.path.c_str());
        wsWantOpen = true;
      }
    }
  }

  if (wsWantOpen) ws.loop();

  // A `held` reconnect after a drop needs nothing extra here: `ws_closed()` already put the link
  // back at LOOKING_FOR_MC, and the discovery block above re-dials as soon as an address is found
  // again, mDNS or a fresh `MC <url>`, never a cached one (§5g.3).

  // Heartbeat while connected (welcomed or armed).
  bool connected = (link.state() == LinkState::WELCOMED || link.state() == LinkState::ASSIGNED) &&
                   ws.isConnected();
  if (connected && now - lastHeartbeatMs >= STATUS_HEARTBEAT_MS) {
    lastHeartbeatMs = now;
    StatusFields f;
    f.node_id = link.identity().node_id;
    f.app_ver = link.identity().app_ver;
    const StationAssignment& a = link.assignment();
    f.kind = a.present ? a.kind : "respawn";
    f.team = a.present ? a.team : 255;
    f.station_id = a.present ? a.id : 0;
    f.threshold = a.present ? a.threshold : STICK_DEFAULT_THRESHOLD_DBM;
    f.live = stationLive;  // the real BLE advert state, not merely "MC armed us" (polish round 1)
    f.armed = link.state() == LinkState::ASSIGNED;
    f.has_health = true;  // A58
    f.uptime_s = now / 1000;
    f.boot_count = bootCount;
    f.assoc = link.mode() == AssocMode::HELD ? "held" : "muster";
    f.lock_s = (long)link.lock().remaining_s(now);
    String body = String(build_status_body(f).c_str());
    char envId[13];
    snprintf(envId, sizeof envId, "%08lx%02x", (unsigned long)now, (unsigned)esp_random() & 0xff);
    String env = String(make_envelope("status", body.c_str(), envId, (int64_t)now).c_str());
    ws.sendTXT(env);
  }

  // Polish round 2 (HIGH): the ONLY place a queued CLAIM report is ever sent -- never from the BLE
  // scan callback that enqueued it. Best-effort, like every other send here: drained while a socket
  // is live, left queued otherwise (bounded, station_link.h's PendingActionQueue). `ACTIONS` gates
  // `maybe_build_taken_action` itself, so a report is simply dropped, never built, while it is off.
  if (ws.isConnected()) {
    PendingTakenReport rep;
    while (link.pop_pending_action(rep)) {
      std::string body = maybe_build_taken_action(link, rep, now);   // age_ms computed now, at send time
      if (!body.empty()) {
        std::string env = make_envelope("station_action", body, mcNextActionId().c_str(), rep.t_ms);
        String envArduino(env.c_str());
        ws.sendTXT(envArduino);
      }
    }
  }

}

// ---- serial commands: WIFI / MC / LINK ---------------------------------------------------------
// Returns true when `line` was one of ours (the .ino falls through to its own handleLine otherwise).
static bool mcHandleLine(const String& lineIn) {
  String line = lineIn;
  line.trim();
  if (line.startsWith("WIFI ")) {
    int sp = line.indexOf(' ', 5);
    String ssid = sp > 0 ? line.substring(5, sp) : line.substring(5);
    String pass = sp > 0 ? line.substring(sp + 1) : "";
    mcSaveWifi(ssid, pass);
    link.wifi_configured();
    WiFi.begin(ssid.c_str(), pass.c_str());
    Serial.printf("WIFI %s (joining)\n", ssid.c_str());
    return true;
  }
  if (line.startsWith("MC ")) {
    WsAddress a = mcParseWsUrl(line.substring(3));
    if (!a.valid) { Serial.println("ERR MC ws://host:port/path"); return true; }
    pendingTypedMc = a;
    haveTypedMc = true;
    Serial.printf("MC %s:%u%s (typed; not persisted)\n", a.host.c_str(), a.port, a.path.c_str());
    return true;
  }
  if (line == "LINK MUSTER" || line == "LINK HELD") {
    AssocMode m = line == "LINK HELD" ? AssocMode::HELD : AssocMode::MUSTER;
    link.set_mode(m);
    mcSaveAssoc(m);
    Serial.printf("LINK %s\n", m == AssocMode::HELD ? "HELD" : "MUSTER");
    return true;
  }
  if (line == "LINK OFF") {
    ws.disconnect();
    WiFi.disconnect(true);
    wsWantOpen = false;
    haveTypedMc = false;
    Serial.println("LINK OFF");
    return true;
  }
  if (line == "LINK RECONNECT") {
    // Polish round 2: the documented operator action that clears a MUSTER drop's latch (§5g.4) --
    // "bring the Stick back to the table between matches". Without this the station can never
    // receive the NEXT muster's station_config at all: it has no other way back onto Wi-Fi.
    link.clear_dropped_for_match();
    Serial.println("LINK RECONNECT (will rejoin Wi-Fi)");
    return true;
  }
  if (line == "ACTIONS ON" || line == "ACTIONS OFF") {
    bool on = line == "ACTIONS ON";
    actionsEnabled = on;
    link.set_actions_enabled(on);
    mcSaveActionsEnabled(on);
    Serial.printf("ACTIONS %s\n", on ? "ON" : "OFF");
    return true;
  }
  return false;
}

// ---- the RESET button's report (station_action; proposed, not final -- see station_ui.h) ---------
// Sends best-effort, applies nothing locally: the station only changes once MC answers (a
// `station_update` for a powerup). Returns false when there is nowhere to send it (no MC link, or
// ACTIONS is off), which the caller turns into "RESET NEEDS MISSION CONTROL" on the screen -- with
// ACTIONS off that is the honest answer too: this Stick is not telling MC anything either way.
static bool mcSendResetAction() {
  std::string body = maybe_build_reset_action(link, (int64_t)millis());
  if (body.empty() || !ws.isConnected()) return false;
  std::string env = make_envelope("station_action", body, mcNextActionId().c_str(), (int64_t)millis());
  String envArduino(env.c_str());
  return ws.sendTXT(envArduino);
}

// ---- setup ------------------------------------------------------------------------------------- //
static void mcSetup() {
  mcLoadPrefs(link);
  mcCountBoot();                   // A58
  mcRestoreSavedConfig(link);      // restart survival: before WiFi.begin, so the station plays at once
  pmicSetSideButtonLock(false);    // A58: every boot starts unlocked, the PMIC included
  bootRandomPrefix = esp_random();  // the fixed half of every station_action envelope id this boot
  WiFi.mode(WIFI_STA);
  if (wifiSsid.length()) WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  ws.onEvent(mcWebSocketEvent);
  // The library's own reconnect timer is driven from station_link.h's Backoff on every
  // WStype_DISCONNECTED (polish round 1); nothing to set here before the first connect attempt.
}

}  // namespace brx_glue
