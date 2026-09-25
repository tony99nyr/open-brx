// player_sim.ino - a fake player phone for the bench: it broadcasts one Open BRX PLAYER advert, so a
// station's claim scan (hardware/m5sticks3, A56 powerup pickup) can be tested unattended, with no phones.
//
// Target: an IR-rig ESP32-S3 DevKitC-1 (board "ESP32S3 Dev Module", FQBN esp32:esp32:esp32s3), driven
// over its CH343 UART port at 115200. See README.md for flashing it and restoring the rig firmware.
//
// The advert is one 128-bit service UUID, byte for byte app/src/beacon.js encodeUuid() and
// hardware/m5sticks3/brx_advert.h advert_uuid():
//   0-3 'OBRX' · 4 version 1 · 5 role 2 (player) · 6-7 id (player_num, big-endian) · 8 kind 0 ·
//   9 team · 10 state · 11 value · 12 seq · 13 game · 14 threshold (0) · 15 taker (0)
// Player state bits: 1 alive, 16 claiming, 32 claim_ready, 64 revived. For a claim, value = station id.
//
// The advert is built exactly as the Stick's own publishAdvert() builds its station advert (flags 0x04,
// the UUID as a COMPLETE 128-bit service list, non-connectable), since phones already decode that one.
// The Stick scans passively, so the UUID must ride in the advert packet itself, never a scan response.
//
// Serial commands (one per line):
//   ADV <player_num> <team> <state> <value> <game> [seq] [secs]   set and (re)start the advert
//   OFF                                                     stop advertising (also ends a SCRIPT)
//   STATUS                                                  print the current UUID and state
//   SCRIPT CLAIM <player_num> <team> <station_id> <game> [secs]   alive 1 s, claiming 1 s, then
//                                                           claim_ready (value = station_id)
//   POWER <LOW|NORMAL|HIGH>                                 TX power -12 / 0 / +9 dBm (NORMAL at boot)
//
// SAFETY: this is a bench tool. A Stick awards a claim at any signal strength, so a forgotten claim advert
// would steal real pickups on a shared field. Any advert with claiming or claim_ready (state bits 4/5)
// therefore stops by itself after [secs] (default 10, at most 60) from the command that started it,
// printing "ADV auto-off after Ns". A plain advert with no claim bits stops after 5 minutes. The TX power
// is 0 dBm unless POWER asks for more (the controller's own default on this core is +9 dBm).
//   SCAN <aa:bb:cc:dd:ee:ff> <secs>                         stop advertising, measure that address's advert
//                                                           gaps (scan_meter.h); OFF cancels it, ADV resumes
// Every change prints "ADV <uuid>" (or "OFF"). Errors print "ERR ...".

#include <BLEDevice.h>
#include <BLEAdvertising.h>
#include "scan_meter.h"

namespace {

constexpr uint8_t ROLE_PLAYER = 2;
constexpr uint8_t ST_ALIVE = 1, ST_CLAIMING = 16, ST_CLAIM_READY = 32;
constexpr uint16_t ADV_INTERVAL_UNITS = 160;  // 100 ms in BLE units of 0.625 ms
constexpr uint32_t SCRIPT_STEP_MS = 1000;
constexpr uint8_t CLAIM_BITS = ST_CLAIMING | ST_CLAIM_READY;
constexpr long CLAIM_DEFAULT_S = 10, CLAIM_MAX_S = 60;
constexpr uint32_t PLAIN_LIMIT_MS = 5UL * 60UL * 1000UL;

struct Player {
  uint16_t id = 1;
  uint8_t team = 0;
  uint8_t state = ST_ALIVE;
  uint8_t value = 0;
  uint8_t seq = 0;
  uint8_t game = 0;
};

BLEAdvertising* adv = nullptr;
Player cur;
bool advertising = false;
String currentUuid;
String line;

// SCRIPT CLAIM: 0 = idle, 1 = alive, 2 = claiming, 3 = claim_ready (held).
int scriptStep = 0;
uint32_t scriptAt = 0;
uint8_t scriptStation = 0;  // the station id a SCRIPT CLAIM puts in the value byte

// Auto-off clocks (see SAFETY above).
uint32_t claimLimitMs = CLAIM_DEFAULT_S * 1000;
uint32_t claimSince = 0;  // when the current run of claim adverts began
uint32_t plainSince = 0;  // when the current plain advert was last set

// Same layout and formatting as brx_advert.h advert_uuid(): bytes in order, lower-case, 8-4-4-4-12.
String playerUuid(const Player& p) {
  const uint8_t b[16] = {0x4f, 0x42, 0x52, 0x58, 1, ROLE_PLAYER,
                         (uint8_t)(p.id >> 8), (uint8_t)(p.id & 0xff), 0, p.team,
                         p.state, p.value, p.seq, p.game, 0, 0};
  char s[37];
  snprintf(s, sizeof s,
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12],
           b[13], b[14], b[15]);
  return String(s);
}

bool startAdvert(const Player& p) {
  if (!adv) return false;
  if (advertising) adv->stop();
  String uuid = playerUuid(p);
  BLEAdvertisementData data;
  data.setFlags(0x04);  // BR/EDR not supported, as on the Stick
  data.setCompleteServices(BLEUUID(uuid.c_str()));
  bool ok = adv->setAdvertisementData(data) && adv->start();
  advertising = ok;
  currentUuid = uuid;
  if (ok) Serial.printf("ADV %s t=%lu\n", uuid.c_str(), (unsigned long)millis());
  else Serial.printf("ERR advert start %s\n", uuid.c_str());
  return ok;
}

void stopAdvert() {
  scriptStep = 0;
  if (adv && advertising) adv->stop();
  advertising = false;
  Serial.printf("OFF t=%lu\n", (unsigned long)millis());
}

// Apply a new player view. The seq bumps on every change (as a phone does) unless the ADV line pinned it.
// `fromCommand` restarts the auto-off clock; a SCRIPT step into claiming starts it on the claim bits.
void publish(Player p, bool pinSeq, bool fromCommand) {
  if (!pinSeq) p.seq = (uint8_t)(cur.seq + 1);
  bool wasClaim = advertising && (cur.state & CLAIM_BITS);
  cur = p;
  uint32_t now = millis();
  if (cur.state & CLAIM_BITS) { if (fromCommand || !wasClaim) claimSince = now; }
  else plainSince = now;
  startAdvert(cur);
}

void checkAutoOff() {
  if (!advertising) return;
  uint32_t now = millis();
  bool claim = cur.state & CLAIM_BITS;
  uint32_t limit = claim ? claimLimitMs : PLAIN_LIMIT_MS;
  if (now - (claim ? claimSince : plainSince) < limit) return;
  Serial.printf("ADV auto-off after %lus\n", (unsigned long)(limit / 1000));
  stopAdvert();
}

// Parse up to `max` unsigned integers from `s`; returns how many it read, or -1 on a stray word.
int parseInts(const String& s, long* out, int max) {
  int n = 0;
  const char* c = s.c_str();
  while (*c && n < max) {
    while (*c == ' ' || *c == '\t') c++;
    if (!*c) break;
    char* end = nullptr;
    long v = strtol(c, &end, 0);
    if (end == c) return -1;
    out[n++] = v;
    c = end;
  }
  while (*c == ' ' || *c == '\t') c++;
  return *c ? -1 : n;
}

bool inRange(long v, long lo, long hi) { return v >= lo && v <= hi; }

void scriptEnter(int step) {
  scriptStep = step;
  scriptAt = millis();
  Player p = cur;
  const char* name = "";
  if (step == 1) { p.state = ST_ALIVE; p.value = 0; name = "alive"; }
  if (step == 2) { p.state = ST_ALIVE | ST_CLAIMING; name = "claiming"; }
  if (step == 3) { p.state = ST_ALIVE | ST_CLAIMING | ST_CLAIM_READY; name = "claim_ready"; }
  if (step >= 2) p.value = scriptStation;
  Serial.printf("SCRIPT step=%d %s t=%lu\n", step, name, (unsigned long)millis());
  publish(p, false, step == 1);
}

void handle(String cmd) {
  cmd.trim();
  if (!cmd.length()) return;
  String upper = cmd;
  upper.toUpperCase();

  if (upper == "OFF") { meter::cancel(); stopAdvert(); return; }

  if (upper.startsWith("SCAN ")) {
    char mac[24] = {0};
    long secs = 0;
    char extra[2] = {0};
    if (sscanf(cmd.c_str() + 5, "%23s %ld %1s", mac, &secs, extra) != 2) {
      Serial.println("ERR usage: SCAN <aa:bb:cc:dd:ee:ff> <secs>");
      return;
    }
    if (advertising || scriptStep) stopAdvert();  // SCAN never advertises meanwhile
    meter::start(mac, secs);
    return;
  }

  if (meter::running && (upper.startsWith("ADV ") || upper.startsWith("SCRIPT "))) {
    Serial.println("ERR a SCAN is running; send OFF to cancel it first");
    return;
  }

  if (upper == "STATUS") {
    Serial.printf("STATUS scanning=%d advertising=%d id=%u team=%u state=%u value=%u seq=%u game=%u script=%d uuid=%s\n",
                  meter::running ? 1 : 0, advertising ? 1 : 0, cur.id, cur.team, cur.state, cur.value, cur.seq, cur.game, scriptStep,
                  currentUuid.length() ? currentUuid.c_str() : "-");
    return;
  }

  if (upper.startsWith("ADV ")) {
    long v[7];
    int n = parseInts(cmd.substring(4), v, 7);
    if (n < 5 || !inRange(v[0], 1, 65535) || !inRange(v[1], 0, 255) || !inRange(v[2], 0, 255) ||
        !inRange(v[3], 0, 255) || !inRange(v[4], 0, 255) || (n >= 6 && !inRange(v[5], 0, 255)) ||
        (n == 7 && !inRange(v[6], 1, CLAIM_MAX_S))) {
      Serial.println("ERR usage: ADV <player_num 1-65535> <team 0-255> <state> <value> <game> [seq] [secs 1-60]");
      return;
    }
    claimLimitMs = (uint32_t)(n == 7 ? v[6] : CLAIM_DEFAULT_S) * 1000;
    scriptStep = 0;
    Player p;
    p.id = (uint16_t)v[0]; p.team = (uint8_t)v[1]; p.state = (uint8_t)v[2];
    p.value = (uint8_t)v[3]; p.game = (uint8_t)v[4];
    if (n >= 6) p.seq = (uint8_t)v[5];
    publish(p, n >= 6, true);
    return;
  }

  if (upper.startsWith("SCRIPT CLAIM ")) {
    long v[5];
    int n = parseInts(cmd.substring(13), v, 5);
    if (n < 4 || !inRange(v[0], 1, 65535) || !inRange(v[1], 0, 255) || !inRange(v[2], 1, 255) ||
        !inRange(v[3], 0, 255) || (n == 5 && !inRange(v[4], 1, CLAIM_MAX_S))) {
      Serial.println("ERR usage: SCRIPT CLAIM <player_num> <team> <station_id 1-255> <game> [secs 1-60]");
      return;
    }
    claimLimitMs = (uint32_t)(n == 5 ? v[4] : CLAIM_DEFAULT_S) * 1000;
    cur.id = (uint16_t)v[0]; cur.team = (uint8_t)v[1]; cur.game = (uint8_t)v[3];
    scriptStation = (uint8_t)v[2];
    scriptEnter(1);
    return;
  }

  if (upper.startsWith("POWER ")) {
    String lvl = upper.substring(6);
    lvl.trim();
    esp_power_level_t p;
    if (lvl == "LOW") p = ESP_PWR_LVL_N12;
    else if (lvl == "NORMAL") p = ESP_PWR_LVL_N0;
    else if (lvl == "HIGH") p = ESP_PWR_LVL_P9;
    else { Serial.println("ERR usage: POWER <LOW|NORMAL|HIGH>"); return; }
    BLEDevice::setPower(p);
    Serial.printf("POWER %s\n", lvl.c_str());
    if (advertising) startAdvert(cur);  // re-apply on a running advert; the auto-off clocks carry on
    return;
  }

  Serial.printf("ERR unknown command: %s\n", cmd.c_str());
}

}  // namespace

void setup() {
  Serial.begin(115200);
  BLEDevice::init("BRX-PLAYER-SIM");
  BLEDevice::setPower(ESP_PWR_LVL_N0);  // 0 dBm: a bench tool, not whole-room (POWER HIGH for +9)
  adv = BLEDevice::getAdvertising();
#if defined(CONFIG_NIMBLE_ENABLED)
  adv->setAdvertisementType(BLE_GAP_CONN_MODE_NON);  // arduino-esp32 3.3 builds the S3 core on NimBLE
#else
  adv->setAdvertisementType(ADV_TYPE_NONCONN_IND);
#endif
  adv->setMinInterval(ADV_INTERVAL_UNITS);
  adv->setMaxInterval(ADV_INTERVAL_UNITS + 16);
  adv->setScanResponse(false);  // the Stick scans passively; nothing belongs in a scan response
  Serial.println("# BRX player-sim ready (ADV / OFF / STATUS / SCRIPT CLAIM / POWER / SCAN)");
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') { handle(line); line = ""; }
    else if (line.length() < 120) line += c;
  }
  meter::report();
  checkAutoOff();
  if (scriptStep == 1 || scriptStep == 2) {
    if (millis() - scriptAt >= SCRIPT_STEP_MS) scriptEnter(scriptStep + 1);
  }
  delay(2);
}
