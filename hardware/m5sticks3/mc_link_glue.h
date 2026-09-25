// mc_link_glue.h - the Arduino plumbing for H8 (docs/spec/utility.md §5g): Wi-Fi, mDNS discovery,
// the WebSocket to Mission Control, the one shared BLE player scan (a powerup CLAIM, and the player
// presence a Bluetooth hill or respawn station runs on), and Preferences. Everything that DECIDES
// anything lives in station_link.h / station_ui.h / presence.h (host-tested); this file only drives
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
#include <mdns.h>  // the ESP-IDF component under ESPmDNS: its async query (mcPollMdns)
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <esp_random.h>
#include <esp_task_wdt.h>  // the loop watchdog while the match lock is on (pmicWatchLoop)

#include "brx_advert.h"
#include "json_lite.h"
#include "presence.h"
#include "station_link.h"
#include "station_ui.h"

namespace brx_glue {

using namespace brx;

// ---- tunables (bench to confirm all of them) ---------------------------------------------------
constexpr uint32_t STATUS_HEARTBEAT_MS = 2000;   // utility.md §5g.2
constexpr uint32_t MDNS_RETRY_MS = 4000;         // how often to re-browse _openbrx._tcp
constexpr uint32_t SCAN_WINDOW_S = 1;      // BLEScan duration per window (async, non-blocking)
// Polish round 1 (2026-09-24): this MUST stay longer than SCAN_WINDOW_S's 1000 ms, or a new window
// is requested while the last one is still running -- `mcPollPlayerScan` also guards with
// `isScanning()` below, but a period shorter than the window would still mean back-to-back windows
// with no gap, never letting `onPlayerScanComplete` (and its `resolve_batch()`) run in between.
// The same 1 s every 1.2 s serves presence: the 200 ms gap is far inside beacon.js's 4 s expiry.
constexpr uint32_t SCAN_PERIOD_MS = 1200;
// Scan duty inside a window, in BLE units of 0.625 ms (BLEScan::setInterval/setWindow). Polish round 1
// (MEDIUM): the claim scan used 99 of 100, and nothing in the code shows the full window is safe once it
// runs all match beside the advert and (HELD) Wi-Fi on one radio, so it is 50 of 100. BENCH TO CONFIRM
// (README): a phone's advert every ~100-250 ms still lands several times per 1 s window at 50%.
constexpr uint16_t SCAN_INTERVAL_UNITS = 100;
// Tony (2026-09-24): a revive at a respawn Stick flashes the screen green, REDEPLOY, and counts up.
static const uint32_t REVIVE_FLASH_MS = 1500;
static uint32_t reviveFlashUntilMs = 0;

constexpr uint16_t SCAN_WINDOW_UNITS = 50;

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
  mcPrefs.remove("hill_owner");
  mcPrefs.remove("hill_game");
  mcPrefs.remove("hill_id");
  mcPrefs.remove("hill_sid");
  mcPrefs.remove("hill_hold");
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

// ---- restart survival: the Bluetooth hill's owner ("hill_owner"/"hill_game"/"hill_id"/"hill_sid"/"hill_hold")
// SavedHill (station_link.h, host-tested) decides WHEN: only on an owner change, never a progress tick.
SavedHill savedHill;

static void mcLoadSavedHill() {
  mcPrefs.begin("brxmc", true);
  bool has = mcPrefs.isKey("hill_owner");
  int owner = mcPrefs.getUChar("hill_owner", 255);
  int game = mcPrefs.getUChar("hill_game", 0);
  int id = mcPrefs.getUShort("hill_id", 0);
  String sid = mcPrefs.getString("hill_sid", "");
  uint32_t hold[4] = {0, 0, 0, 0};
  bool haveHold = mcPrefs.getBytes("hill_hold", hold, sizeof hold) == sizeof hold;
  mcPrefs.end();
  savedHill.loaded(has, owner, game, id, sid.c_str(), haveHold ? hold : nullptr);
}

static void mcWriteSavedHill() {
  mcPrefs.begin("brxmc", false);
  mcPrefs.putUChar("hill_owner", (uint8_t)savedHill.owner());
  mcPrefs.putUChar("hill_game", (uint8_t)savedHill.game());
  mcPrefs.putUShort("hill_id", (uint16_t)savedHill.id());
  mcPrefs.putString("hill_sid", savedHill.session_id().c_str());
  mcPrefs.putBytes("hill_hold", savedHill.hold_ms(), 4 * sizeof(uint32_t));
  mcPrefs.end();
  Serial.printf("# hill owner saved: %d (game %d, id %d)\n", savedHill.owner(), savedHill.game(), savedHill.id());
}

static void mcEraseSavedHill() {
  mcPrefs.begin("brxmc", false);
  mcPrefs.remove("hill_owner");
  mcPrefs.remove("hill_game");
  mcPrefs.remove("hill_id");
  mcPrefs.remove("hill_sid");
  mcPrefs.remove("hill_hold");
  mcPrefs.end();
  Serial.println("# saved hill owner erased");
}

// At boot, before Wi-Fi: play the saved station at once (see restore_station_config's comment for
// why this never latches the MUSTER drop and never carries a lock).
static void mcRestoreSavedConfig(StationLink& link) {
  mcPrefs.begin("brxmc", true);
  String body = mcPrefs.getString("station_cfg", "");
  String sid = mcPrefs.getString("station_sid", "");
  mcPrefs.end();
  savedConfig.loaded(body.c_str(), sid.c_str());
  if (!savedConfig.has()) {
    if (savedHill.clear()) mcEraseSavedHill();  // a hill save with no station to restore is an orphan
    return;
  }
  // Review round 1: bench mode (no Wi-Fi SSID set) never restores; the saved copy is left alone.
  if (wifiSsid.length() == 0) {
    Serial.println("# saved station_config kept but not restored (no Wi-Fi set: bench mode)");
    return;
  }
  StationAssignment a = savedConfig.restore();
  if (!link.restore_station_config(a)) {
    Serial.println("# saved station_config does not parse; erasing it");
    if (savedConfig.note_released()) mcEraseSavedConfig();
    if (savedHill.clear()) mcEraseSavedHill();
    return;
  }
  Serial.printf("RESTORED kind=%s team=%d id=%d game=%d (from flash; unlocked)\n", a.kind.c_str(), a.team,
                a.id, a.game);
  // F332: a restarted hill comes back held by the owner it had, when the save is this config's.
  // The tag must match this config AND the session it was saved in (a new MC session restarts game numbers).
  if (savedHill.note_config(a, savedConfig.session_id())) mcEraseSavedHill();
  if (savedHill.restore_into(a, savedConfig.session_id(), link.hill())) {
    Serial.printf("RESTORED hill owner=%d (held at 100 if a team)\n", link.hill().owner == HILL_NEUTRAL ? -1 : link.hill().owner);
  }
}

// ---- A58 / F332: the PMIC side-button lock ---------------------------------------------------------
// The StickS3's small side button is wired to the M5PM1 PMIC, not the ESP32: a single click resets
// the Stick and a double click powers it off, whatever the firmware says. While MC's match lock is on,
// both are disabled here; the rest of the time they are enabled.
//
// CONFIRMED 2026-09-24 from the M5PM1 Chip User Manual v1.9 (pp. 23-24,
// m5stack-doc.oss-cn-shenzhen.aliyuncs.com/1207/M5PM1_Datasheet_EN.pdf) and m5stack/M5PM1's driver:
// the PM1 sits at I2C 0x6E; BTN_CFG_1 0x49 (default 0x2A) bit0 SINGLE_RESET_DIS; BTN_CFG_2 0x4A
// (default 0x00) bit0 DOUBLE_POWEROFF_DIS. M5Unified's own register table stops at 0x45, so these are
// raw I2C. Neither register is cleared by a reset or a power-off, so a lock left set survives a crash:
// setup() clears both FIRST, right after M5.begin(), before anything that could crash-loop.
// 0x49 bit7 is DL_LOCK (download-mode lock, no documented way back): NEVER written. Each write is a
// manual read-modify-write that refuses to write at all when the read shows bit7 set
// (station_ui.h pm1_bit0_write_value, host-tested).
//
// Robustness (polish 2026-09-24): both registers are always attempted, and only a read-back of both
// bit0s matching the wanted state counts as done (SideButtonLockSync, host-tested); anything else is
// retried every PMIC_RETRY_MS from mcLoop (every PMIC_BACKOFF_MS after PMIC_BACKOFF_AFTER failures in a
// row). While locked, the loop task watchdog is on, at 20 s (pmicWatchLoop):
// a hang in loop() would otherwise leave the button disabled forever, since the RAM lock countdown
// and the A+B restart both need loop() to run. The watchdog resets the chip instead, and the boot
// clear gives the button back.
constexpr uint8_t PM1_ADDR = 0x6E;
constexpr uint8_t PM1_BTN_CFG_1 = 0x49;  // bit0 SINGLE_RESET_DIS (bit7 DL_LOCK: never)
constexpr uint8_t PM1_BTN_CFG_2 = 0x4A;  // bit0 DOUBLE_POWEROFF_DIS
constexpr uint32_t PM1_I2C_HZ = 100000;
SideButtonLockSync pmicLock;

static bool pm1ReadReg(uint8_t reg, uint8_t& v) { return M5.In_I2C.readRegister(PM1_ADDR, reg, &v, 1, PM1_I2C_HZ); }

static bool pm1WriteBit0(uint8_t reg, bool on) {
  uint8_t v = 0;
  if (!pm1ReadReg(reg, v)) {
    Serial.printf("ERR PMIC read 0x%02x failed\n", reg);
    return false;
  }
  uint8_t out = 0;
  if (!pm1_bit0_write_value(v, on, out)) {
    Serial.printf("ERR PMIC 0x%02x reads %02x (bit7 set): refusing to write\n", reg, v);
    return false;
  }
  return out == v || M5.In_I2C.writeRegister8(PM1_ADDR, reg, out, PM1_I2C_HZ);
}

// Call every loop() (and once first thing in setup()) with the wanted lock state.
static void pmicSync(bool locked, uint32_t now) {
  if (!pmicLock.due(locked, now)) return;
  if (M5.getBoard() != m5::board_t::board_M5StickS3) {
    pmicLock.attempted(true, now);  // nothing to lock on this board: settled, so this never repeats
    Serial.println("# PMIC side-button lock skipped: not a StickS3");
    return;
  }
  const bool w1 = pm1WriteBit0(PM1_BTN_CFG_1, locked);  // both attempted, whatever the first did
  const bool w2 = pm1WriteBit0(PM1_BTN_CFG_2, locked);
  uint8_t r1 = 0, r2 = 0;
  const bool rd1 = pm1ReadReg(PM1_BTN_CFG_1, r1);
  const bool rd2 = pm1ReadReg(PM1_BTN_CFG_2, r2);
  const bool ok = rd1 && rd2 && pm1_bit0s_match(r1, r2, locked);
  pmicLock.attempted(ok, now);
  // One line per attempt: every second at first, then (backing off) once per PMIC_BACKOFF_MS.
  Serial.printf("# PMIC side-button lock %s %s (0x49=%02x 0x4A=%02x writes=%d%d)%s\n", locked ? "ON" : "OFF",
                ok ? "confirmed" : "NOT confirmed", r1, r2, w1 ? 1 : 0, w2 ? 1 : 0,
                ok ? "" : (pmicLock.backing_off() ? ", backing off: retrying every 30 s" : ", retrying in 1 s"));
}

// The loop watchdog follows the match lock (see above): on while locked, off otherwise. loop() is NOT
// free of blocking calls: WebSockets 2.7.2's ws.loop() can block for up to WEBSOCKETS_TCP_TIMEOUT
// (5000 ms) on a connect or a stalled read, exactly when MC has gone away mid-match. The core's task
// watchdog is also 5 s (CONFIG_ESP_TASK_WDT_TIMEOUT_S), which would reset a healthy locked Stick. So on
// lock the task watchdog is reconfigured to LOCKED_LOOP_WDT_MS (four times the socket's worst case)
// before the loop task subscribes, and on unlock the loop task leaves and the startup config comes back.
// The IDF has no getter for the running config and nothing in this sketch or the core changes it after
// startup, so "the existing config" is the sdkconfig's: the same idle-core mask and panic setting.
constexpr uint32_t LOCKED_LOOP_WDT_MS = 20000;
static esp_task_wdt_config_t taskWdtConfig(uint32_t timeout_ms) {
  esp_task_wdt_config_t c = {};
  c.timeout_ms = timeout_ms;
  c.idle_core_mask = 0;
#if defined(CONFIG_ESP_TASK_WDT_CHECK_IDLE_TASK_CPU0) && CONFIG_ESP_TASK_WDT_CHECK_IDLE_TASK_CPU0
  c.idle_core_mask |= 1u << 0;
#endif
#if defined(CONFIG_ESP_TASK_WDT_CHECK_IDLE_TASK_CPU1) && CONFIG_ESP_TASK_WDT_CHECK_IDLE_TASK_CPU1
  c.idle_core_mask |= 1u << 1;
#endif
#if defined(CONFIG_ESP_TASK_WDT_PANIC) && CONFIG_ESP_TASK_WDT_PANIC
  c.trigger_panic = true;
#else
  c.trigger_panic = false;
#endif
  return c;
}
bool loopWatchdogOn = false;
static void pmicWatchLoop(bool locked) {
  if (locked == loopWatchdogOn) return;
  if (locked) {
    esp_task_wdt_config_t c = taskWdtConfig(LOCKED_LOOP_WDT_MS);
    esp_err_t err = esp_task_wdt_reconfigure(&c);
    if (err != ESP_OK) Serial.printf("ERR task watchdog reconfigure to %lu ms: %d\n", (unsigned long)LOCKED_LOOP_WDT_MS, (int)err);
    enableLoopWDT();
  } else {
    disableLoopWDT();
    esp_task_wdt_config_t c = taskWdtConfig((uint32_t)CONFIG_ESP_TASK_WDT_TIMEOUT_S * 1000u);
    esp_err_t err = esp_task_wdt_reconfigure(&c);
    if (err != ESP_OK) Serial.printf("ERR task watchdog restore: %d\n", (int)err);
  }
  loopWatchdogOn = locked;
  Serial.printf("# loop watchdog %s\n", locked ? "ON, 20 s (match lock)" : "OFF (task watchdog back to its default)");
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
uint32_t lastScanMs = 0;
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
// send, which is wrong on general principle even though MC does not check it today. One call site
// for both senders.
static String mcNextActionId() {
  char buf[16];
  snprintf(buf, sizeof buf, "%08lx%04x", (unsigned long)bootRandomPrefix, (unsigned)(actionSeq++ & 0xffff));
  return String(buf);
}

// The station's own advert-facing settings (kind/team/id/game come from `link.assignment()` once
// ASSIGNED; before that a Stick standing alone keeps whatever the existing `settings`/`point`
// bench mode already does -- see m5sticks3.ino's own ID/GAME/MODE commands, untouched by H8).

// ---- the shared BLE player scan (A56 claims + presence.h) ------------------------------------ //
// ONE passive scanner for every assigned kind that reads players (presence.h
// station_needs_player_scan): `control` and `respawn` all the time, `powerup` only while its item is
// available (exactly the old claim scan, so a pickup's radio behaviour and its awards are unchanged).
// It runs in 1 s windows every SCAN_PERIOD_MS. The BLE stack is NimBLE: the m5stack esp32 3.3.9 core's
// esp32s3 sdkconfig sets CONFIG_BT_NIMBLE_ENABLED=y (Bluedroid is not built), and the Arduino BLE
// library's BLEScan/BLEAdvertising sit on it. There a scan (GAP discovery) and the advert are separate
// procedures: publishAdvert() stops and starts only the advertiser, and a window starts and ends only
// the scanner. Their sharing of the one radio is the controller's; BENCH TO CONFIRM under Wi-Fi.
//
// The scan callback runs on the BLE host task, not loop(). It therefore never reads the assignment
// (std::string) or touches the hill: the two `scanFeeds*` flags are set by loop() when a window
// opens, a claim goes to ClaimGate exactly as before, and a presence sighting is copied into a small
// ring that loop() drains on its own 250 ms tick (mcTickPlayers).
SightingRing<128> seenRing;  // presence.h; ~5 s of adverts from a dozen phones. Guarded by seenMux
portMUX_TYPE seenMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool scanFeedsClaims = false;
volatile bool scanFeedsPresence = false;

static void seenPush(const Advert& a, int rssi) {
  portENTER_CRITICAL(&seenMux);
  seenRing.push(a, rssi);
  portEXIT_CRITICAL(&seenMux);
}

static bool seenPop(Sighting& out) {
  portENTER_CRITICAL(&seenMux);
  bool got = seenRing.pop(out);
  portEXIT_CRITICAL(&seenMux);
  return got;
}

static void seenClear() {
  portENTER_CRITICAL(&seenMux);
  seenRing.clear();
  portEXIT_CRITICAL(&seenMux);
}

static uint32_t seenOverflow() {
  portENTER_CRITICAL(&seenMux);
  uint32_t n = seenRing.overflow();
  portEXIT_CRITICAL(&seenMux);
  return n;
}

class PlayerScanCallbacks : public BLEAdvertisedDeviceCallbacks {
 public:
  void onResult(BLEAdvertisedDevice advertisedDevice) override {
    if (!advertisedDevice.haveServiceUUID()) return;
    Advert a;
    String uuidStr = advertisedDevice.getServiceUUID().toString();  // BLEUUID::toString() -> Arduino String
    if (!decode_advert(std::string(uuidStr.c_str()), a)) return;
    if (a.role != ROLE_PLAYER) return;
    const int rssi = advertisedDevice.getRSSI();
    if (scanFeedsPresence) seenPush(a, rssi);
    if (!scanFeedsClaims) return;
    bool claiming = (a.state & PLAYER_CLAIMING) != 0;
    bool ready = (a.state & PLAYER_CLAIM_READY) != 0;
    if (!claiming && !ready) return;
    link.claims().observe(/*player_num=*/a.id, /*target_station_id=*/a.value, a.game, claiming,
                           ready, /*alive=*/(a.state & PLAYER_ALIVE) != 0, rssi);
  }
};
PlayerScanCallbacks playerScanCallbacks;
bool playerScanConfigured = false;

// Set when something the operator should see changed: an MC frame, a self-spawn, a claim, a link change,
// a hill capture or a revive. The .ino reads and clears it, and treats it like a button press: repaint
// AND wake the backlight.
static volatile bool mcScreenWake = false;  // volatile: the scan callback sets it too

// Polish round 2 (HIGH): this callback must NEVER touch the WebSocket -- it runs off the BLE scan's
// own completion, not mcLoop, and the library is not written to be called from there (nor does any
// other I/O belong in a callback). `award_claim` only enqueues the report (station_link.h); mcLoop is
// the sole place anything is ever sent, and it drains the queue every tick.
static void onPlayerScanComplete(BLEScanResults /*results*/) {
  if (scanFeedsClaims) {
    ClaimWinner w = link.claims().resolve_batch();
    if (link.award_claim(w, millis())) {
      mcScreenWake = true;  // the player at the station just took it: show TAKEN BY at once
      Serial.printf("CLAIM station=%d taker=%u (queued for MC)\n", link.assignment().id, w.player_num);
    }
  }
  BLEDevice::getScan()->clearResults();
}

static void mcPollPlayerScan(uint32_t now) {
  // Polish round 1 (CRITICAL): gated on the PERSISTED assignment, never link state -- see
  // `has_powerup_assignment()`'s own comment in station_link.h. A MUSTER station scans with Wi-Fi down.
  const StationAssignment& a = link.assignment();
  if (!a.present) return;
  const bool powerupAvailable = link.has_powerup_assignment() && link.powerup().available();
  if (!station_needs_player_scan(a.kind, powerupAvailable)) return;
  if (now - lastScanMs < SCAN_PERIOD_MS) return;
  BLEScan* scan = BLEDevice::getScan();
  // Polish round 1: a batch already running must finish (and call resolve_batch() in
  // onPlayerScanComplete) before a new one starts, or a batch can be aborted mid-window and its
  // candidates lost. `lastScanMs` is only advanced once a window actually opens, so a busy
  // scanner just tries again next loop() instead of silently missing a whole period.
  if (scan->isScanning()) return;
  lastScanMs = now;
  if (!playerScanConfigured) {
    scan->setAdvertisedDeviceCallbacks(&playerScanCallbacks, /*wantDuplicates=*/true);
    scan->setActiveScan(false);  // passive: we only read the advert, never need a scan response
    scan->setInterval(SCAN_INTERVAL_UNITS);
    playerScanConfigured = true;
  }
  scan->setWindow(scan_window_units(link.assignment().kind));  // per kind: heavy for a hill only
  scanFeedsClaims = link.has_powerup_assignment();
  scanFeedsPresence = link.has_control_assignment() || (REVIVE_FEEDBACK_ENABLED && link.has_respawn_assignment());
  scan->start(SCAN_WINDOW_S, onPlayerScanComplete, false);
}

// ---- the Bluetooth hill and the respawn count (presence.h), one STATION_TICK_MS step ------------- //
// utility.js tick() on a phone station, on the Stick: drain the sightings into Presence, tick it,
// then run the assigned kind's rule (StationLink::tick_players). Gated on the persisted assignment
// like the scan, so a MUSTER hill keeps converting with Wi-Fi down.
PlayerPresence presence;
uint32_t lastPlayTickMs = 0;
// An S57 capture word the .ino owes the field (it owns the IR transmitter): the new owner's tid, or -1.
int pendingCaptureTeam = -1;

static void mcTickPlayers(uint32_t now) {
  // A respawn station ticks players only for the post-MVP revive feedback (presence.h); by default it only advertises.
  if (!link.has_control_assignment() && !(REVIVE_FEEDBACK_ENABLED && link.has_respawn_assignment())) return;
  if (now - lastPlayTickMs < STATION_TICK_MS) return;
  lastPlayTickMs = now;
  const StationAssignment& a = link.assignment();
  // utility.js: `presence.defaultThreshold = settings.threshold; presence.game = settings.game`, every
  // tick. The threshold is MC's, or the Stick's own -57 default (STICK_DEFAULT_THRESHOLD_DBM) when MC sent none.
  presence.default_threshold = presence_threshold_dbm(a);  // -57 when MC sent 0: the Stick's platform default
  presence.game = (uint8_t)a.game;
  // A different station now (new kind/id/game, a restore, a release): the old station's sightings and
  // presence belong to it, not to this one.
  static uint32_t lastEpoch = link.assignment_epoch();
  if (link.assignment_epoch() != lastEpoch) {
    lastEpoch = link.assignment_epoch();
    seenClear();
    presence.clear();
  }
  Sighting sp;
  while (seenPop(sp)) presence.observe(sp.advert, sp.rssi, now);
  presence.tick(now);
  const uint32_t revivesBefore = link.revives().revives;
  HillUpdate u = link.tick_players(presence, now);
  if (link.has_control_assignment() && savedHill.note_owner(a, savedConfig.session_id(), link.hill())) mcWriteSavedHill();
  if (u.captured) {
    pendingCaptureTeam = u.captured_team;
    mcScreenWake = true;
    Serial.printf("HILL CAPTURED team=%d from=%d\n", u.captured_team, u.captured_from);
  }
  if (u.neutralised) {
    mcScreenWake = true;
    Serial.printf("HILL NEUTRAL (team %d lost it to team %d)\n", u.neutralised_team, u.neutralised_by);
  }
  if (u.contested_edge || u.uncontested_edge) {
    mcScreenWake = true;
    Serial.println(u.contested_edge ? "HILL CONTESTED" : "HILL no longer contested");
  }
  if (u.refused) {
    Serial.println("# F82: a player on tid 2 is on the point; tid 2 can never hold a hill (use 0, 1, 3)");
  }
  if (link.revives().revives != revivesBefore) {
    mcScreenWake = true;
    reviveFlashUntilMs = millis() + REVIVE_FLASH_MS;  // Tony: flash green for REDEPLOY, and count up
    Serial.printf("REVIVE count=%lu\n", (unsigned long)link.revives().revives);
  }
}

// ---- WebSocket event handling ------------------------------------------------------------------
McClock mcClock;  // wall-clock `t` for every frame this Stick sends (station_link.h)
static const uint32_t WIFI_KICK_MS = 10000;  // at most one WiFi.begin retry per 10 s while joining
static uint32_t lastWifiKickMs = 0;

static void mcSendHello() {
  String body = String(build_hello_body(link.identity(), 0).c_str());
  char envId[13];
  snprintf(envId, sizeof envId, "%08lx%02x", (unsigned long)millis(), (unsigned)esp_random() & 0xff);
  String env = String(make_envelope("hello", body.c_str(), envId, mcClock.epoch(millis())).c_str());
  ws.sendTXT(env);
  link.ws_open_hello_sent();
}

// The MUSTER drop's radio action. WHEN is station_link.h's decision (take_muster_drop, host-tested);
// this only performs it, from mcHandleFrame or mcLoop.
static void mcStopMdns();  // below, beside the mDNS search
static void mcPerformMusterDrop() {
  Serial.println("MUSTER: dropping the Wi-Fi association for the match (LINK RECONNECT to rejoin)");
  ws.disconnect();
  WiFi.disconnect();
  wsWantOpen = false;
  link.wifi_down();
  mcStopMdns();
}

static void mcHandleFrame(const String& text) {
  bool ok = false;
  json::Value env = json::parse(std::string(text.c_str()), &ok);
  if (!ok || !env.is_object()) return;
  mcClock.observe(env.get("t").as_int64(0), millis());  // borrow MC's wall clock for our own `t`
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
    if (w.ok && savedHill.note_welcome(w.session_id)) mcEraseSavedHill();  // another session's hold
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
      if (savedHill.note_config(link.assignment(), savedConfig.session_id())) mcEraseSavedHill();  // new game/id/session
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
      if (savedHill.clear()) mcEraseSavedHill();
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

// ---- mDNS discovery (non-blocking) ------------------------------------------------------------ //
// Polish round 1 (HIGH): `MDNS.queryService` blocks loop() for its whole 3 s query, every retry, which
// stalled the hill's 250 ms tick (its conversion clamps to 1 s a step, so the point ran slow) and could
// overflow the sighting ring. The ESP-IDF mdns component in this core (m5stack esp32 3.3.9) has an async
// query: start it, poll it with a 0 ms timeout each loop(), read the result when it is done. Same PTR
// query and the same result reading as ESPmDNS's queryService/address/port/txt, so discovery for a fresh
// Stick is unchanged. mdns_init() (via MDNS.begin) was never called before, and a query needs it.
bool mdnsStarted = false;
mdns_search_once_t* mdnsSearch = nullptr;

static bool mcReadMdnsResult(mdns_result_t* r, WsAddress& out) {
  for (; r; r = r->next) {
    if (!r->port) continue;
    for (mdns_ip_addr_t* ip = r->addr; ip; ip = ip->next) {
      if (ip->addr.type != MDNS_IP_PROTOCOL_V4) continue;
      out.host = IPAddress(ip->addr.u_addr.ip4.addr).toString();
      out.port = r->port;
      out.path = "/ws";
      for (size_t i = 0; i < r->txt_count; i++) {
        if (r->txt[i].key && r->txt[i].value && strcmp(r->txt[i].key, "ws_path") == 0 && r->txt[i].value[0]) {
          out.path = r->txt[i].value;
        }
      }
      out.valid = true;
      return true;
    }
  }
  return false;
}

// A search left running when the link leaves LOOKING_FOR_MC (a typed address, a Wi-Fi drop) must not
// answer the NEXT search with an old address (§5g.3: a reconnect never dials a cached address).
static void mcCancelMdns() {
  if (mdnsSearch) { mdns_query_async_delete(mdnsSearch); mdnsSearch = nullptr; }
}
// Wi-Fi went down: stop mDNS as well, so the next association re-begins it on the new interface
// (LINK OFF turns the station interface off in core 3.x).
static void mcStopMdns() {
  mcCancelMdns();
  if (mdnsStarted) { MDNS.end(); mdnsStarted = false; }
}

// Call every loop() while LOOKING_FOR_MC. Never waits: true once a query has answered with an address.
static bool mcPollMdns(uint32_t now, WsAddress& out) {
  if (!mdnsSearch) {
    if (now - lastMdnsTryMs < MDNS_RETRY_MS) return false;
    lastMdnsTryMs = now;
    if (!mdnsStarted) mdnsStarted = MDNS.begin(link.identity().node_id.c_str());
    if (!mdnsStarted) return false;
    mdnsSearch = mdns_query_async_new(nullptr, "_openbrx", "_tcp", MDNS_TYPE_PTR, 3000, 4, nullptr);
    return false;
  }
  mdns_result_t* results = nullptr;
  if (!mdns_query_async_get_results(mdnsSearch, 0, &results, nullptr)) return false;  // still asking
  mdns_query_async_delete(mdnsSearch);
  mdnsSearch = nullptr;
  bool found = mcReadMdnsResult(results, out);
  if (results) mdns_query_results_free(results);
  return found;
}

// ---- the main poll, called every loop() with the current millis() ------------------------------
static void mcLoop(uint32_t now) {
  // The station's own play runs FIRST, before any Wi-Fi or WebSocket handling, because MUSTER keeps Wi-Fi down for
  // the whole match: SELF-SPAWN, the player scan and the hill/revive tick are gated on the PERSISTED
  // assignment (`has_*_assignment()`), never on link state. (Polish round 3: they used to sit after the `!wifiUp` early
  // return below, so a muster station never spawned or awarded during play.)
  if (link.has_powerup_assignment()) {
    if (link.tick_powerup(now)) mcScreenWake = true;  // a SELF-SPAWN: the item is back
  }
  mcPollPlayerScan(now);  // every kind that reads players; itself gated on the persisted assignment
  mcTickPlayers(now);
  // A58: the match lock counts down on millis() whatever the link is doing (MUSTER is off Wi-Fi for
  // the whole match) and auto-unlocks at zero. The PMIC follows the lock on every edge: a start, a
  // replacement by a later config, lock_s 0, a release, or the countdown running out.
  if (link.poll_lock(now)) {
    mcScreenWake = true;
    Serial.println("UNLOCKED (match lock ran out)");
  }
  // A deferred MUSTER drop whose 2 s ran out with no station_update (review round 1).
  if (link.take_muster_drop(now)) mcPerformMusterDrop();
  const bool wantPmicLock = link.lock().locked(now);
  pmicSync(wantPmicLock, now);  // retries every second until the PMIC reads back what we want
  pmicWatchLoop(wantPmicLock);
  // Wi-Fi association.
  bool wifiUp = WiFi.status() == WL_CONNECTED;
  if (wifiUp && link.state() == LinkState::JOINING_WIFI) link.wifi_up();
  if (!wifiUp && link.state() != LinkState::NOT_CONFIGURED && link.state() != LinkState::JOINING_WIFI) {
    link.wifi_down();
    mcStopMdns();
  }
  // Any link state change (Wi-Fi lost, MC found, joined, closed) is an event the operator should see.
  static LinkState lastLinkState = link.state();
  if (link.state() != lastLinkState) { lastLinkState = link.state(); mcScreenWake = true; }
  if (link.state() != LinkState::LOOKING_FOR_MC) mcCancelMdns();  // no stale answer for the next search
  if (!wifiUp) {
    // Polish round 2 (CRITICAL): a deliberate MUSTER drop must STAY dropped. Without this guard the
    // very next tick's kick re-associated Wi-Fi immediately, undoing the drop `mcHandleFrame` just
    // performed -- the whole point of MUSTER. `LINK RECONNECT` (below) is the only way past it.
    if (!link.dropped_for_match() && link.state() == LinkState::JOINING_WIFI && wifiSsid.length() &&
        WiFi.status() != WL_IDLE_STATUS && now - lastWifiKickMs >= WIFI_KICK_MS) {
      // Not cheap: while the driver is still connecting, each call is refused ("sta is connecting,
      // cannot set config") and logged, hundreds of times a second (bench 2026-09-24). Kick at most
      // once per WIFI_KICK_MS.
      lastWifiKickMs = now;
      WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
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
    } else {
      WsAddress found;
      if (mcPollMdns(now, found)) {
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
    if (link.has_control_assignment()) {
      // §5c: the station is self-authoritative, so it reports the point, as utility.js's status does.
      const BleControlPoint& h = link.hill();
      f.has_control = true;
      f.control_owner = h.owner;
      f.control_progress = (int)BleControlPoint::js_round(h.progress);
      f.control_contested = h.contested;
      f.control_has_hold = true;
      for (int t = 0; t < 4; t++) f.control_hold_ms[t] = h.hold_ms[t];
    }
    if (REVIVE_FEEDBACK_ENABLED && link.has_respawn_assignment()) {  // post-MVP (presence.h): off by default
      f.has_revives = true;
      f.revives = link.revives().revives;
    }
    String body = String(build_status_body(f).c_str());
    char envId[13];
    snprintf(envId, sizeof envId, "%08lx%02x", (unsigned long)now, (unsigned)esp_random() & 0xff);
    String env = String(make_envelope("status", body.c_str(), envId, mcClock.epoch(now)).c_str());
    ws.sendTXT(env);
  }

  // Polish round 2 (HIGH): the ONLY place a queued CLAIM report is ever sent -- never from the BLE
  // scan callback that enqueued it. Best-effort, like every other send here: drained while MC has
  // welcomed this socket and the clock is synced (action_flush_allowed, station_ui.h), left queued otherwise (bounded, station_link.h's PendingActionQueue). `ACTIONS` gates
  // `maybe_build_taken_action` itself, so a report is simply dropped, never built, while it is off.
  if (action_flush_allowed(ws.isConnected(), link.state(), mcClock.synced)) {  // welcomed, clock synced (M3)
    PendingTakenReport rep;
    while (link.pop_pending_action(rep)) {
      std::string body = maybe_build_taken_action(link, rep, now, mcClock.offset_ms);   // age_ms computed now, at send time
      if (!body.empty()) {
        std::string env = make_envelope("station_action", body, mcNextActionId().c_str(), mcClock.epoch(now));
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
  std::string body = maybe_build_reset_action(link, mcClock.epoch(millis()));
  if (body.empty() || !ws.isConnected()) return false;
  std::string env = make_envelope("station_action", body, mcNextActionId().c_str(), mcClock.epoch(millis()));
  String envArduino(env.c_str());
  return ws.sendTXT(envArduino);
}

// ---- setup ------------------------------------------------------------------------------------- //
static void mcSetup() {
  mcLoadPrefs(link);
  mcCountBoot();                   // A58
  mcLoadSavedHill();               // before the restore, which may bring the hill back held
  mcRestoreSavedConfig(link);      // restart survival: before WiFi.begin, so the station plays at once
  // A58: every boot starts unlocked, the PMIC included: setup() already cleared it, first thing (F332).
  bootRandomPrefix = esp_random();  // the fixed half of every station_action envelope id this boot
  WiFi.mode(WIFI_STA);
  if (wifiSsid.length()) WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
  ws.onEvent(mcWebSocketEvent);
  // The library's own reconnect timer is driven from station_link.h's Backoff on every
  // WStype_DISCONNECTED (polish round 1); nothing to set here before the first connect attempt.
}

}  // namespace brx_glue
