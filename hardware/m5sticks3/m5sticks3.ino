/*
 * m5sticks3.ino - the M5StickS3 as an Open BRX station node.
 *
 * What it does: hears BRX IR words on the Stick's own receiver (G42, RMT), tracks who owns a
 * control point (BRIDGE: mirror a stock grenade beside it; HILL: be the hill), advertises the
 * owner as the Open BRX kind-5 control-point BLE advert every HUD phone already decodes, emits
 * BRX words on the onboard IR LED (G46) or a Grove emitter (G9), and paints the owner on the
 * screen. Serial keeps the ir_capture.ino / ir_emit.ino line formats so mcp/tools/native_capture.py
 * and the ir-emit one-liners work unchanged.
 *
 * IR protocol: LaserTagMods (JEDGE/JBOX) discovery, bench-verified 2026-08-26; see
 * protocol/brx-ir-protocol.md. Advert: docs/spec/utility.md section 2.
 *
 * MC-armed stations are Bluetooth-only for the MVP (Tony, 2026-09-24): a `control` Stick is the
 * presence hill in presence.h (players standing at it, as a phone station counts them), a `respawn`
 * Stick advertises "ready" and counts revives, a `powerup` Stick awards claims. IR RECEIVE drives only
 * the bench HILL/BRIDGE (F314: the onboard receiver cannot hear BRX shots); IR TRANSMIT stays for
 * the hill beacon and the S57 capture word.
 *
 * Board: m5stack:esp32:m5stack_sticks3 (M5Stack board package) + M5Unified >= 0.2.21.
 * The pure logic is in brx_ir.h / brx_advert.h / control_point.h / presence.h (host-tested).
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEAdvertising.h>
#include <M5Unified.h>
#include <Preferences.h>
#include <cctype>

#include "brx_advert.h"
#include "brx_ir.h"
#include "control_point.h"
#include "presence.h"       // the Bluetooth hill + revive count an MC-armed station runs
#include "mc_link_glue.h"   // H8: Wi-Fi/mDNS/WebSocket to Mission Control (docs/spec/utility.md §5g)
#include "station_render.h" // the M5GFX renderer for a ScreenSpec (Arduino-only)
#include "station_screen.h" // the pure screen MODEL: state -> ScreenSpec (host-tested)

using namespace brx;

// ---- pins (docs.m5stack.com StickS3 pin map) ------------------------------------------------ //
static const int IR_RX_ONBOARD = 42;  // onboard 38 kHz receiver; RMT only, and the speaker amp must be OFF
// The receive pin in use: G42 (onboard) or a Grove pin (G9/G10) with an external receiver such as a
// VS1838B (bench 2026-09-24: the onboard receiver hears a TV remote but no BRX-style IR; F314).
int IR_RX_PIN = IR_RX_ONBOARD;
static const int IR_TX_ONBOARD = 46; // onboard IR LED
// The Grove port is G9 and G10. M5Unified maps it as SCL = G10, SDA = G9, and M5's colour code puts
// SCL on the yellow wire, which is where a Seeed Grove module's SIG (pin 1) sits: so G10 first. M5's
// StickS3 pinout (docs.m5stack.com/en/core/StickS3) puts the yellow wire on G9/SDA instead, so both are accepted
// and the bench settles it (a Grove emitter that stays dark on `TXPIN 10` wants `TXPIN 9`).
static const int IR_TX_GROVE = 10;
static const int IR_TX_GROVE_ALT = 9;
static const uint32_t RMT_TICK_HZ = 1000000;  // 1 tick = 1 us, so durations print as microseconds
static const uint16_t RX_IDLE_US = 20000;     // a frame ends after this much silence (ir_capture used 30 ms)
// The hardware glitch filter counts ticks of the 80 MHz group clock, ceiling 255 (about 3.2 us),
// and rmtSetRxMinThreshold converts our 1 us ticks to ns before IDF checks that ceiling: anything
// above 3 makes rmt_receive fail with INVALID_ARG and the receiver never arms. Real glitch
// handling is fold_glitches() in brx_ir.h (MARK_MIN_US); this only strips sub-microsecond noise.
static const uint8_t RX_FILTER_US = 3;
static const size_t RX_SYMBOLS = 128;         // a 25-bit word is 26 symbols; 128 = M5's own StickS3 IR example (mem_block_symbols)

// ---- persisted settings ---------------------------------------------------------------------- //
Preferences prefs;
struct Settings {
  uint8_t mode = (uint8_t)Mode::BRIDGE;
  uint16_t id = 1;
  uint8_t game = 0;
  uint8_t txpin = IR_TX_ONBOARD;
  uint8_t rxpin = IR_RX_ONBOARD;
} settings;

static void loadSettings() {
  prefs.begin("brx", true);
  settings.mode = prefs.getUChar("mode", settings.mode);
  settings.id = prefs.getUShort("id", settings.id);
  settings.game = prefs.getUChar("game", settings.game);
  settings.txpin = prefs.getUChar("txpin", settings.txpin);
  settings.rxpin = prefs.getUChar("rxpin", settings.rxpin);
  prefs.end();
}
static void saveSettings() {
  prefs.begin("brx", false);
  prefs.putUChar("mode", settings.mode);
  prefs.putUShort("id", settings.id);
  prefs.putUChar("game", settings.game);
  prefs.putUChar("txpin", settings.txpin);
  prefs.putUChar("rxpin", settings.rxpin);
  prefs.end();
}

// ---- state ----------------------------------------------------------------------------------- //
ControlPoint point;
AdvertPolicy policy;
BLEAdvertising* adv = nullptr;
String currentUuid;
uint32_t advertCount = 0;
uint32_t frameCount = 0;   // every RAW burst, like ir_capture.ino
uint32_t wordCount = 0;    // complete, parity-valid words
bool rawEnabled = true;
String autoBits;
uint32_t AUTO_TX_INTERVAL_MS = 400;
uint32_t lastAutoMs = 0;
uint32_t lastBeaconTxMs = 0;
uint32_t lastTxDoneMs = 0;
String lastTxBits;
Word lastWord;
uint32_t lastWordAt = 0;
uint32_t sentWordCount = 0;  // every sendFrame() call, for the DIAGNOSTICS/STATS "IR SENT" row
bool displayDirty = true;
String lastSelfTestResult = "-";  // "-" | "PASS" | "FAIL", for the DIAGNOSTICS screen

// An MC-armed `control` station runs the Bluetooth hill (StationLink::hill(), presence.h), and the IR
// point above is then bench-only: IR words no longer move it and it sends no beacon or capture word.
// Gated on the persisted assignment, like every other play path (see currentAdvertView).
static bool bleHillActive() { return brx_glue::link.has_control_assignment(); }

// The operator's point RESET (serial RESET, the bench A hold): the IR point, and the Bluetooth hill with
// its saved owner when a control station is assigned (utility.js btnPointReset). Both callers are
// already refused while the A58 lock is on (the serial allow-list; the A hold only runs unconfigured).
static void resetPoints() {
  point.reset();
  if (brx_glue::link.reset_hill()) {
    if (brx_glue::savedHill.clear()) brx_glue::mcEraseSavedHill();
    Serial.println("# Bluetooth hill reset to NEUTRAL");
  }
}

// ---- screen model/render (station_screen.h / station_render.h) ------------------------------- //
M5Canvas canvas(&M5.Display);   // one off-screen sprite, pushed once per paint: no flicker
HomeNav homeNav;                // Tony, 2026-09-24: idle timeout + A-long-press "go home"
uint8_t lastControlOwner = TEAM_ANY;  // tracks a HILL/BRIDGE owner change, to time "HELD m:ss"
uint32_t heldSinceMs = 0;
uint32_t confirmArmedAtMs = 0;  // mirrors station_ui.h's own armed_at_ms_ (no getter there; see pollButtons())
bool resetOutcomeActive = false;  // a RESET was just confirmed; show its outcome briefly, then clear
bool resetOutcomeOk = false;      // true = sent to MC; false = RESET NEEDS MISSION CONTROL
bool resetOutcomeLocked = false;  // A58: the RESET was refused by the match lock (shows LOCKED)
ForceRestart forceRestart;        // A58: A + B held 7 s restarts the Stick, locked or not
BootHeldButtons bootHeld;         // a button still down from before this boot is ignored until released
uint32_t lastRestartCountdown = 0;
uint32_t resetOutcomeAtMs = 0;
constexpr uint32_t RESET_OUTCOME_SHOW_MS = 2500;

// Screen brightness (README's "Screens" section): dim after idle, wake on a button or a real state
// change (anything that already sets `displayDirty`, e.g. a pickup or a capture) -- never on the
// routine ~4 Hz countdown repaint below, or the backlight would never dim during a live countdown.
constexpr uint8_t BACKLIGHT_BRIGHT = 120;  // matches setup()'s existing setBrightness(120)
// Never below 60: at 25 (and at 0) the backlight's PWM couples into the IR receiver as ~660 Hz pulses,
// about 20 bursts per 15 s, which buried every gun shot (bench 2026-09-24, A/B/A: 25 and 0 noisy;
// 60, 120 and 255 silent). BL <n> over serial repeats the test.
constexpr uint8_t BACKLIGHT_DIM = 60;
constexpr uint32_t BACKLIGHT_IDLE_MS = 30000;
uint32_t lastWakeMs = 0;
bool backlightDimmed = false;

// ---- IR receive (RMT) ------------------------------------------------------------------------ //
rmt_data_t rxBuf[RX_SYMBOLS];
volatile size_t rxCount = RX_SYMBOLS;  // written by the RX-done ISR
bool rxArmed = false;
uint32_t rxArmFailures = 0;

// Re-arming while a reception is still in flight is refused by the driver (the channel is not
// idle); the frame in flight still completes into rxBuf, so a failed arm is retried from pollRx
// only AFTER any completed frame has been read, never instead of reading it.
uint32_t lastRxArmMs = 0;  // STATUS prints its age: a receiver that never re-arms shows up as a growing number

static void armRx() {
  rxCount = RX_SYMBOLS;
  rxArmed = rmtReadAsync(IR_RX_PIN, rxBuf, (size_t*)&rxCount);
  if (rxArmed) lastRxArmMs = millis();
  if (!rxArmed && ++rxArmFailures == 1) Serial.println("# rx arm refused once (reception in flight); retrying");
}

static bool initRx() {
  if (!rmtInit(IR_RX_PIN, RMT_RX_MODE, RMT_MEM_NUM_BLOCKS_3, RMT_TICK_HZ)) return false;   // 3 x 48 = 144 >= RX_SYMBOLS
  rmtSetRxMinThreshold(IR_RX_PIN, RX_FILTER_US);
  rmtSetRxMaxThreshold(IR_RX_PIN, RX_IDLE_US);
  // An external receiver on a Grove pin (a VS1838B) drives its output through a weak internal pull-up;
  // hold the pin up too, so the Stick never drags a shared line low (bench 2026-09-24: on G9 the line
  // went dead for both boards). The onboard receiver on G42 drives its pin itself and needs nothing.
  if (IR_RX_PIN != IR_RX_ONBOARD) gpio_pullup_en((gpio_num_t)IR_RX_PIN);
  armRx();
  return true;
}

// The receiver idles HIGH and pulls LOW for a mark. RMT hands back (duration, level) pairs from
// the first edge; we want the alternating mark/space list ir_capture.ino printed, starting with
// the sync mark, so a leading HIGH segment (rare: a space before the first mark) is dropped.
static void symbolsToDurations(const rmt_data_t* s, size_t n, std::vector<uint32_t>& out) {
  out.clear();
  bool started = false;
  for (size_t i = 0; i < n; i++) {
    uint32_t dur[2] = {s[i].duration0, s[i].duration1};
    uint32_t lvl[2] = {s[i].level0, s[i].level1};
    for (int k = 0; k < 2; k++) {
      if (dur[k] == 0) return;  // RMT end marker
      if (!started) {
        if (lvl[k] != 0) continue;  // wait for the first LOW (mark)
        started = true;
      }
      out.push_back(dur[k]);
    }
  }
}

static void printFrame(const std::vector<uint32_t>& d, const Decoded& r, bool overflow) {
  if (rawEnabled) {
    Serial.printf("RAW %lu edges=%u%s us=[", (unsigned long)frameCount, (unsigned)(d.size() + 1),
                  overflow ? " (OVERFLOW)" : "");
    for (size_t i = 0; i < d.size(); i++) {
      if (i) Serial.print(',');
      Serial.print(d[i]);
    }
    Serial.println(']');
  }
  Serial.printf("DECODE bits=%u val=%s\n", (unsigned)r.bits.size(), r.bits.c_str());
  if (!r.sync_ok) Serial.println("# no 2ms sync (leading mark outside 1800-2200us) - not a BRX frame");
  if (r.complete) {
    const Word& w = r.word;
    // parityOK is the gun's test (Z0 != Z1); genuine is the odd/even rule real BRX frames carry.
    Serial.printf("SHOT player=%d team=%d dmg=%d proto=%d crit=%d parityOK=%d genuine=%d\n", w.player, w.team,
                  w.mag, w.proto, w.crit, r.parity_ok ? 1 : 0, r.payload_ok ? 1 : 0);
  }
}

static void pollRx() {
  if (!rmtReceiveCompleted(IR_RX_PIN)) {
    if (!rxArmed) armRx();
    return;
  }
  static std::vector<uint32_t> d;
  size_t got = rxCount;
  symbolsToDurations(rxBuf, got, d);
  bool overflow = got >= RX_SYMBOLS;  // the buffer filled: a burst longer than one word was cut
  armRx();
  if (d.size() < 4) return;
  frameCount++;  // every burst counts, as in ir_capture.ino, even one we then drop as our echo
  Decoded r = decode(d);
  // Our own emission reflects into the onboard receiver: drop anything that lands inside 150 ms
  // of a transmit and says what we just said.
  if (lastTxBits.length() && (millis() - lastTxDoneMs) < 150 && r.bits == lastTxBits.c_str()) return;
  printFrame(d, r, overflow);
  // Ownership needs the genuine parity too: a payload bit flip keeps Z0 != Z1 half the time, and
  // every stock gun and grenade emits the genuine rule (4/4 on the bench), so nothing real is lost.
  if (r.complete && r.parity_ok && r.payload_ok) {
    wordCount++;
    lastWord = r.word;
    lastWordAt = millis();
    if (!bleHillActive() && point.on_word(r.word, millis())) {
      Serial.printf("OWNER team=%d captures=%lu\n", point.owner == TEAM_ANY ? -1 : point.owner,
                    (unsigned long)point.captures);
      // S57: a HILL flip happened HERE, so this Stick sends the one capture word, once (never in BRIDGE). sendFrame()
      // calls pollRx() once before it transmits; that nesting is bounded because the receiver was re-armed above, and
      // the word it sends is protocol 15, which hill() never counts as a shot, so it cannot flip the point again.
      if (point.mode == Mode::HILL) sendFrame(String(encode(point.capture_word()).c_str()));
    }
    displayDirty = true;
  }
}

// ---- IR transmit (RMT + hardware 38 kHz carrier) ---------------------------------------------- //
int txPinActive = -1;

static bool initTx(int pin) {
  if (txPinActive == pin) return true;
  if (txPinActive >= 0) rmtDeinit(txPinActive);
  txPinActive = -1;
  if (!rmtInit(pin, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_1, RMT_TICK_HZ)) return false;
  // Third argument is polarity_active_low: FALSE puts the carrier on the HIGH half, which is where
  // sendFrame() puts every mark (level0 = 1). TRUE would modulate the spaces and invert the frame.
  rmtSetCarrier(pin, true, false, 38000, 0.33f);
  rmtSetEOT(pin, 0);
  txPinActive = pin;
  return true;
}

// One BRX word as RMT TX symbols (mark = carrier on, space = off), shared by sendFrame() and selfTest().
static size_t buildSymbols(const String& bits, rmt_data_t* sym, size_t cap) {
  std::vector<uint32_t> p = to_pulses(std::string(bits.c_str()));
  size_t n = 0;
  for (size_t i = 0; i + 1 < p.size() && n < cap; i += 2) {
    sym[n].level0 = 1; sym[n].duration0 = p[i];
    sym[n].level1 = 0; sym[n].duration1 = p[i + 1];
    n++;
  }
  return n;
}

// SELFTEST (F314 diagnostic): the current TX pin into the Stick's own receiver (G46, the onboard LED, sits a few
// millimetres from it; a Grove emitter on 9/10 needs aiming). It arms a fresh
// read, sends one word, waits for the burst, prints it RAW with its decode, and says PASS when the decode is the word
// sent. It never feeds ownership and never counts as a heard word. BENCH TO CONFIRM what a PASS means: M5 asks for
// 30 cm between sender and receiver, so a FAIL here may be overdrive, not a fault; aim a mirror or card for a bounce.
static void selfTest(const String& bits) {
  if (txPinActive < 0 && !initTx(settings.txpin)) { lastSelfTestResult = "FAIL"; Serial.println("SELFTEST FAIL tx init"); return; }
  pollRx();  // a real word that finished just before this must be read, not discarded with the rebuilt channel
  rmtDeinit(IR_RX_PIN);
  if (!initRx()) { lastSelfTestResult = "FAIL"; Serial.println("SELFTEST FAIL rx init"); return; }
  static rmt_data_t sym[64];
  size_t n = buildSymbols(bits, sym, 64);
  if (!rmtWrite(txPinActive, sym, n, 200)) {
    lastSelfTestResult = "FAIL";
    Serial.println("SELFTEST FAIL tx write");
    rmtDeinit(IR_RX_PIN);
    if (!initRx()) Serial.println("ERR rx re-init after selftest");
    return;
  }
  uint32_t t0 = millis();
  while (!rmtReceiveCompleted(IR_RX_PIN) && millis() - t0 < 150) delay(1);
  if (!rmtReceiveCompleted(IR_RX_PIN)) {
    lastSelfTestResult = "FAIL";
    Serial.printf("SELFTEST FAIL txpin=%d no burst within 150 ms of the transmit\n", txPinActive);
  } else {
    static std::vector<uint32_t> d;
    size_t got = rxCount;
    symbolsToDurations(rxBuf, got, d);
    Decoded r = decode(d);
    bool raw = rawEnabled;
    rawEnabled = true;  // the point of a self-test is to see what arrived
    printFrame(d, r, got >= RX_SYMBOLS);
    rawEnabled = raw;
    bool pass = r.complete && r.bits == bits.c_str();
    lastSelfTestResult = pass ? "PASS" : "FAIL";
    // the pin says what was tested: G46 is the onboard LED; 9/10 is a Grove emitter, where aim and distance decide
    Serial.printf("SELFTEST %s txpin=%d sent=%s got=%s\n", pass ? "PASS" : "FAIL", txPinActive, bits.c_str(), r.bits.c_str());
  }
  rmtDeinit(IR_RX_PIN);
  if (!initRx()) Serial.println("ERR rx re-init after selftest");
}

static void sendFrame(const String& bits) {
  if (txPinActive < 0 && !initTx(settings.txpin)) { Serial.println("ERR tx init"); return; }
  pollRx();  // a word that finished before this transmit must not be thrown away with our echo
  static rmt_data_t sym[64];
  size_t n = buildSymbols(bits, sym, 64);
  if (!rmtWrite(txPinActive, sym, n, 200)) Serial.println("ERR tx write");  // blocking; ~40 ms per word
  sentWordCount++;  // every attempt counts, as frameCount does for receive (DIAGNOSTICS/STATS "IR SENT")
  lastTxDoneMs = millis();
  lastTxBits = bits;
  // Whatever the receiver caught of our own word is thrown away. A bare re-arm here failed on the first bring-up
  // (2026-09-23): the driver logged `rmt_receive(401): channel not in enable state` after every transmit, because the
  // echo left a reception in flight. Rebuild the RX channel instead, so every transmit ends with a clean, armed read.
  // This is an open ESP-IDF issue on the S3 (github.com/espressif/esp-idf/issues/17811), so it is worked around here.
  delay(2);
  rmtDeinit(IR_RX_PIN);
  if (!initRx()) Serial.println("ERR rx re-init after tx");
}

// ---- BLE advert ------------------------------------------------------------------------------ //
// H8: once Mission Control has ARMED this Stick (`brx_glue::link.state() == ASSIGNED`), the advert's
// id/kind/game/threshold come from that assignment, not the serial ID/GAME/MODE bench settings --
// mirrors utility.js's own applyStationConfig(). Team/state/value/active come from whichever engine
// actually knows them: the Bluetooth hill for kind "control" (presence.h, control.js's three bytes),
// "ready" (state 1, value 0) for kind "respawn" exactly as utility.js advertises it, the powerup
// schedule for kind "powerup" (self-spawn + CLAIM, station_link.h), or a flat "nothing to report
// yet" for a kind this firmware cannot run (extraction/bomb, §5g.5: "shown and reported, not
// faked"). With no MC assignment at all this is exactly the pre-H8 standalone bench behaviour
// (control_point.h only), unchanged.
// Gated on the PERSISTED assignment, never the link state (the has_powerup_assignment() rule): a
// MUSTER drop puts the state back at JOINING WI-FI for the whole match, and a boot-time restore never
// reaches ASSIGNED until MC answers, yet both must keep advertising the assigned station.
static AdvertView currentAdvertView(uint32_t now) {
  using brx_glue::link;
  if (!link.assignment().present) return point.view(now);
  const StationAssignment& a = link.assignment();
  if (a.kind == "control") return link.hill().advert();
  if (a.kind == "powerup") {
    PowerupAdvertView p = link.powerup().view(now);
    AdvertView v;
    v.team = TEAM_ANY;
    v.state = p.state;
    v.value = p.value;
    v.taker = p.taker;
    v.active = true;
    return v;
  }
  AdvertView v;
  v.team = (uint8_t)a.team;
  v.value = 0;
  v.active = true;
  // respawn: state 1, "ready", as utility.js advertises it (phones skip a respawn advert with state 0).
  // extraction / bomb: 0, "here I am, on this team, doing nothing". station_link.h, host-tested.
  v.state = station_static_state(a.kind);
  return v;
}

bool advertising = false;
uint32_t advertRetryAt = 0;
static void publishAdvert(const AdvertView& v, uint32_t now) {
  using brx_glue::link;
  uint8_t seq = policy.published(v, now);
  const StationAssignment& a = link.assignment();
  bool assigned = a.present;  // the assignment, not the link state (see currentAdvertView)
  Advert adv_;
  adv_.role = ROLE_STATION;
  adv_.id = assigned ? (uint16_t)a.id : settings.id;
  adv_.kind = assigned ? station_kind_byte(a.kind) : KIND_CONTROL;
  adv_.team = v.team;
  adv_.state = v.state;
  adv_.value = v.value;
  adv_.seq = seq;
  adv_.game = assigned ? (uint8_t)a.game : settings.game;
  adv_.threshold = assigned ? a.threshold : 0;
  adv_.taker = v.taker;
  String uuid = advert_uuid(adv_).c_str();
  if (!adv) { policy.have_last = false; return; }
  adv->stop();
  BLEAdvertisementData data;
  data.setFlags(0x04);  // BR/EDR not supported; general discoverable is not needed for a beacon
  data.setCompleteServices(BLEUUID(uuid.c_str()));
  bool ok = adv->setAdvertisementData(data) && adv->start();
  advertising = ok;
  if (!ok) {
    // Retry, but not every loop: due() would say "first" at a few hundred Hz and bury the serial.
    policy.have_last = false;
    advertRetryAt = now + policy.min_interval_ms;
    currentUuid = "";
    Serial.printf("ERR advert start %s (retry in %lu ms)\n", uuid.c_str(), (unsigned long)policy.min_interval_ms);
    return;
  }
  currentUuid = uuid;
  advertCount++;
  Serial.printf("ADVERT %s seq=%u\n", currentUuid.c_str(), seq);
  displayDirty = true;
}

static void initBle() {
  BLEDevice::init(("BRX-CONTROL-" + String(settings.id)).c_str());
  BLEDevice::setPower(ESP_PWR_LVL_P9);  // whole-room, like the phone station's `high`
  adv = BLEDevice::getAdvertising();
#if defined(CONFIG_NIMBLE_ENABLED)
  adv->setAdvertisementType(BLE_GAP_CONN_MODE_NON);  // arduino-esp32 3.3 builds the S3 core on NimBLE
#else
  adv->setAdvertisementType(ADV_TYPE_NONCONN_IND);
#endif
  adv->setScanResponse(false);
  adv->setMinInterval(0x50);  // 50 ms, so a phone's balanced scan sees us within a second
  adv->setMaxInterval(0xA0);
}

// A BRIDGE whose grenade has gone quiet withdraws its advert rather than repeating a stale owner:
// on the phones a stale "neutral" would look exactly like a live one. Their own 4 s expiry then
// drops the point, which is the truth.
static void pollAdvert(uint32_t now) {
  AdvertView v = currentAdvertView(now);
  if (!v.active) {
    if (advertising) {
      if (adv) adv->stop();
      advertising = false;
      policy.have_last = false;  // the next live beacon republishes as "first"
      currentUuid = "";
      Serial.println("ADVERT withdrawn (no live beacon)");
      displayDirty = true;
    }
    brx_glue::mcSetLive(advertising);
    return;
  }
  if (advertRetryAt && (int32_t)(now - advertRetryAt) < 0) { brx_glue::mcSetLive(advertising); return; }
  advertRetryAt = 0;
  {  // stamp the identity publishAdvert puts on the wire, so a change of it republishes (AdvertPolicy)
    const StationAssignment& a = brx_glue::link.assignment();
    v.kind = a.present ? station_kind_byte(a.kind) : KIND_CONTROL;
    v.id = a.present ? (uint16_t)a.id : settings.id;
    v.game = a.present ? (uint8_t)a.game : settings.game;
    v.threshold = a.present ? a.threshold : 0;
  }
  if (policy.due(v, now)) publishAdvert(v, now);
  // H8 (polish round 1): status.live must say whether the advert is ACTUALLY up, not merely that MC
  // armed this station -- publishAdvert() may have just failed (ERR advert start) and left
  // `advertising` false even though a station_config was applied.
  brx_glue::mcSetLive(advertising);
}

// ---- display: station_screen.h (the model) -> station_render.h (the M5GFX draw) --------------- //
// THE DESIGN OF RECORD is mockups/render.py (Tony approved it 2026-09-24); station_screen.h and
// station_render.h are its two halves (README's "Screens" section). This replaces the old paint()/
// paintOperator() pair: one model, one renderer, for both standalone bench use (control_point.h with
// no Wi-Fi at all) and an MC-armed station.
static std::string toUpperStd(const std::string& in) {
  std::string out = in;
  for (auto& ch : out) ch = (char)toupper((unsigned char)ch);
  return out;
}

static StickState buildStickState(uint32_t now) {
  using brx_glue::link;
  StickState st;
  st.now_ms = now;
  st.link_state = link.state();
  st.ble_on = true;
  st.mc_connected = (link.state() == LinkState::WELCOMED || link.state() == LinkState::ASSIGNED);
  st.ir_active = lastWordAt != 0 && (now - lastWordAt) < 300;
  st.battery_pct = -1;  // bench to confirm: no on-device battery reading wired up yet (README)

  const StationAssignment& a = link.assignment();
  st.assignment_present = a.present;
  st.assignment_id = a.present ? a.id : -1;

  bool standalone = (link.state() == LinkState::NOT_CONFIGURED);
  st.control_present = standalone || (a.present && a.kind == "control");
  st.bridge_mode = standalone && point.mode == Mode::BRIDGE;
  st.bridge_beacon_live = st.bridge_mode && advertising;  // pollAdvert withdraws it when the grenade goes quiet
  if (st.control_present) {
    // The Bluetooth hill when MC armed a control station, else the bench IR point.
    const bool ble = bleHillActive();
    const uint8_t owner = ble ? (uint8_t)link.hill().owner : point.owner;
    st.control_owner = owner;
    if (ble) {
      const BleControlPoint& h = link.hill();
      const AdvertView hv = h.advert();
      st.control_ble = true;
      st.control_progress_pct = hv.value;
      st.control_bar_team = hv.team == TEAM_ANY ? -1 : (int)hv.team;
      st.control_contested = h.contested;
      st.control_dir = h.dir;
    } else {
      st.control_progress_pct = point.progress();
    }
    if (owner != lastControlOwner) {
      heldSinceMs = now;
      lastControlOwner = owner;
    }
    uint32_t heldMs = (owner == TEAM_ANY) ? 0 : (now - heldSinceMs);
    st.control_hold_time = format_mmss(heldMs / 1000);
  }
  if (link.has_respawn_assignment()) {
    st.respawn_present = true;
    st.respawn_team = a.team;
    st.respawn_revives = link.revives().revives;
    st.respawn_redeploy = (int32_t)(brx_glue::reviveFlashUntilMs - now) > 0;
    st.respawn_live = advertising;
  }

  if (a.present && a.kind == "powerup") {
    st.powerup_present = true;
    st.powerup_available = link.powerup().available();
    st.powerup_taker = link.powerup().taker();
    PowerupAdvertView pv = link.powerup().view(now);
    st.powerup_remaining_s = pv.value;
    st.powerup_period_s = a.item.spawn_every_s > 0 ? (uint32_t)a.item.spawn_every_s : 60;
    st.item_name = toUpperStd(a.item.name);
    st.item_color_hex = a.item.color;
    st.item_is_special = a.item.kind != "weapon";
  }

  st.ir_heard = wordCount;
  st.ir_sent = sentWordCount;
  if (lastWordAt) {
    char buf[32];
    snprintf(buf, sizeof buf, "P%d T%d M%d OK", lastWord.player, lastWord.team, lastWord.mag);
    st.last_word = buf;
  }
  st.selftest_result = std::string(lastSelfTestResult.c_str());
  st.tx_pin = settings.txpin;

  if (a.present) {
    st.stats_kind_label = (a.kind == "powerup")
        ? "PICKUP - " + (a.item.name.empty() ? std::string("?") : toUpperStd(a.item.name))
        : toUpperStd(a.kind) + " #" + std::to_string(a.id);
    st.stats_last_taken = (a.kind == "powerup" && link.powerup().taker())
        ? "P" + std::to_string(link.powerup().taker()) : std::string("-");
  } else if (standalone) {
    st.stats_kind_label = point.mode == Mode::HILL ? "HILL (BENCH)" : "BRIDGE (BENCH)";
    st.bench_mode_label = point.mode == Mode::HILL ? "HILL" : "BRIDGE";
    st.stats_last_taken = "-";
  } else {
    st.stats_kind_label = "-";
    st.stats_last_taken = "-";
  }

  st.button_phase = brx_glue::buttons.phase();
  st.confirm_armed_at_ms = confirmArmedAtMs;
  st.reset_outcome_active = resetOutcomeActive;
  st.reset_outcome_ok = resetOutcomeOk;
  st.reset_outcome_locked = resetOutcomeLocked;
  st.locked = link.lock().locked(now);
  st.lock_remaining_s = link.lock().remaining_s(now);
  st.force_restart_countdown_s = forceRestart.countdown_s();
  st.at_home = homeNav.at_home();
  return st;
}

static void paintFromModel(uint32_t now) {
  ScreenSpec spec = compute_screen(buildStickState(now));
  brx_render::renderScreen(canvas, spec);
  canvas.pushSprite(0, 0);
}

// ---- serial commands ------------------------------------------------------------------------- //
static void printStatus() {
  Serial.printf("STATUS mode=%s owner=%d charges=%lu,%lu,%lu,%lu captures=%lu seq=%u adverts=%lu words=%lu id=%u game=%u txpin=%u uuid=%s\n",
                point.mode == Mode::HILL ? "HILL" : "BRIDGE", point.owner == TEAM_ANY ? -1 : point.owner,
                (unsigned long)point.charge[0], (unsigned long)point.charge[1], (unsigned long)point.charge[2],
                (unsigned long)point.charge[3], (unsigned long)point.captures, policy.seq,
                (unsigned long)advertCount, (unsigned long)wordCount, settings.id, settings.game, settings.txpin,
                currentUuid.c_str());
  Serial.printf("RX pin=%d armed=%d arm_age_ms=%lu frames=%lu\n", IR_RX_PIN, rxArmed ? 1 : 0, (unsigned long)(millis() - lastRxArmMs),
                (unsigned long)frameCount);
  // H8: the MC link state, on its own line so a pre-H8 tool that parses STATUS's key=value pairs
  // (mcp/tools/stick.py `parse_status`) keeps working unchanged.
  const brx::StationLink& link = brx_glue::link;
  const brx::StationAssignment& a = link.assignment();
  Serial.printf("LINK state=%s mode=%s actions=%s dropped_for_match=%d node_id=%s wifi=%s kind=%s team=%d id=%d game=%d threshold=%d",
                brx::link_state_label(link.state()), link.mode() == brx::AssocMode::HELD ? "HELD" : "MUSTER",
                link.actions_enabled() ? "ON" : "OFF", link.dropped_for_match() ? 1 : 0,
                link.identity().node_id.c_str(), brx_glue::wifiSsid.c_str(), a.present ? a.kind.c_str() : "-",
                a.present ? a.team : -1, a.present ? a.id : -1, a.present ? a.game : -1,
                a.present ? a.threshold : 0);
  Serial.printf(" locked=%d lock_s=%lu boots=%lu uptime_s=%lu", link.lock().locked(millis()) ? 1 : 0,
                (unsigned long)link.lock().remaining_s(millis()), (unsigned long)brx_glue::bootCount,
                (unsigned long)(millis() / 1000));
  Serial.printf(" restored=%d", link.restored() ? 1 : 0);  // 1 = assignment from flash, MC silent since boot
  if (a.present && a.kind == "powerup") {
    Serial.printf(" powerup_available=%d taker=%u pending_actions=%u", link.powerup().available() ? 1 : 0,
                  link.powerup().taker(), (unsigned)link.pending_action_count());
  }
  Serial.println();
  // The Bluetooth stations (presence.h), on their own line for the same reason as LINK.
  if (link.has_control_assignment() || link.has_respawn_assignment()) {
    const brx::BleControlPoint& h = link.hill();
    Serial.printf("PLAY players=%u present=%u dropped=%lu seen_overflow=%lu", (unsigned)brx_glue::presence.count(),
                  (unsigned)brx_glue::presence.present_count(), (unsigned long)brx_glue::presence.dropped(),
                  (unsigned long)brx_glue::seenOverflow());
    if (link.has_control_assignment()) {
      Serial.printf(" hill_owner=%d capturing=%d progress=%ld dir=%d contested=%d net=%d captures=%lu", h.owner == TEAM_ANY ? -1 : h.owner,
                    h.capturing, brx::BleControlPoint::js_round(h.progress), h.dir, h.contested ? 1 : 0, h.net,
                    (unsigned long)h.captures);
    } else {
      Serial.printf(" revives=%lu", (unsigned long)link.revives().revives);
    }
    Serial.println();
  }
}

static void setMode(Mode m) {
  point.mode = m;
  point.reset();
  settings.mode = (uint8_t)m;
  saveSettings();
  Serial.printf("MODE %s\n", m == Mode::HILL ? "HILL" : "BRIDGE");
  displayDirty = true;
}

static void handleLine(String line) {
  line.trim();
  if (!line.length()) return;
  if (line == "PING") { Serial.println("PONG"); return; }
  // Bench diagnostic: A/B the receiver noise against the backlight (below 60 it makes IR noise).
  // BL 0 = off; the next wake or dim restores the normal levels.
  if (line.startsWith("BL ")) {
    int v = line.substring(3).toInt();
    M5.Display.setBrightness((uint8_t)constrain(v, 0, 255));
    Serial.printf("BL %d\n", v);
    return;
  }
  if (line == "STATUS") { printStatus(); return; }
  // A58: while the match lock is on, only the read-only commands run (station_ui.h's allow-list,
  // host-tested; default deny). Checked before mcHandleLine so WIFI/MC/LINK/ACTIONS are refused too.
  if (brx_glue::link.lock().locked(millis()) && !serial_command_allowed_while_locked(std::string(line.c_str()))) {
    Serial.printf("ERR locked (%lu s left)\n", (unsigned long)brx_glue::link.lock().remaining_s(millis()));
    return;
  }
  // H8: WIFI / MC / LINK MUSTER|HELD / LINK OFF / ACTIONS ON|OFF (docs/spec/utility.md §5g.3/§5g.4).
  // Checked before everything below so a typo like "WIFI" with no args still lands here, not in the
  // ERR unknown at the bottom.
  if (brx_glue::mcHandleLine(line)) return;
  if (line == "RAW ON" || line == "RAW OFF") {   // explicit, for tools: the bare `r` is a toggle whose state a caller cannot see
    rawEnabled = line == "RAW ON";
    Serial.printf("# RAW dump %s\n", rawEnabled ? "ON" : "OFF");
    return;
  }
  if (line == "SELFTEST" || line.startsWith("SELFTEST ")) {
    String bits = line.length() > 8 ? line.substring(9) : String("");
    bits.trim();
    if (!bits.length()) bits = String(encode(point.beacon_word()).c_str());   // bare SELFTEST: the beacon word
    selfTest(bits);
    return;
  }
  if (line == "RESET") { resetPoints(); Serial.println("RESET neutral"); displayDirty = true; return; }
  if (line.startsWith("TX ")) {
    String bits = line.substring(3); bits.trim();
    sendFrame(bits);
    Serial.printf("SENT bits=%u\n", bits.length());
    return;
  }
  if (line.startsWith("TXN ")) {
    int sp = line.indexOf(' ', 4);
    if (sp < 0) { Serial.println("ERR TXN"); return; }
    int n = line.substring(4, sp).toInt();
    if (n > 100) n = 100;  // each frame blocks loop() ~60 ms; the receiver and advert must get a turn
    String bits = line.substring(sp + 1); bits.trim();
    for (int i = 0; i < n; i++) { sendFrame(bits); delay(20); }
    Serial.printf("SENT n=%d bits=%u\n", n, bits.length());
    return;
  }
  if (line.startsWith("AUTO")) {
    String arg = line.substring(4); arg.trim();
    if (arg == "OFF" || !arg.length()) { autoBits = ""; Serial.println("AUTO off"); }
    else { autoBits = arg; Serial.printf("AUTO on bits=%u\n", autoBits.length()); }
    return;
  }
  if (line.startsWith("MODE ")) {
    String m = line.substring(5); m.trim();
    if (m == "HILL") setMode(Mode::HILL);
    else if (m == "BRIDGE") setMode(Mode::BRIDGE);
    else Serial.println("ERR MODE BRIDGE|HILL");
    return;
  }
  if (line.startsWith("ID ")) {
    settings.id = (uint16_t)line.substring(3).toInt();
    saveSettings(); policy.have_last = false;  // force a republish with the new id
    Serial.printf("ID %u\n", settings.id);
    return;
  }
  if (line.startsWith("GAME ")) {
    settings.game = (uint8_t)line.substring(5).toInt();
    saveSettings(); policy.have_last = false;
    Serial.printf("GAME %u\n", settings.game);
    return;
  }
  if (line.startsWith("TXPIN ")) {
    int p = line.substring(6).toInt();
    if (p != IR_TX_ONBOARD && p != IR_TX_GROVE && p != IR_TX_GROVE_ALT) { Serial.println("ERR TXPIN 46|9|10"); return; }
    if (p == IR_RX_PIN) { Serial.println("ERR TXPIN is the RX pin; RXPIN elsewhere first"); return; }
    settings.txpin = (uint8_t)p;
    saveSettings();
    Serial.printf("TXPIN %u %s\n", settings.txpin, initTx(settings.txpin) ? "ok" : "ERR");
    displayDirty = true;
    return;
  }
  if (line.startsWith("RXPIN ")) {
    int p = line.substring(6).toInt();
    if (p != IR_RX_ONBOARD && p != IR_TX_GROVE && p != IR_TX_GROVE_ALT) { Serial.println("ERR RXPIN 42|9|10"); return; }
    if (p == txPinActive) { Serial.println("ERR RXPIN is the TX pin; TXPIN elsewhere first"); return; }
    rmtDeinit(IR_RX_PIN);
    settings.rxpin = (uint8_t)p;
    IR_RX_PIN = p;
    saveSettings();
    Serial.printf("RXPIN %u %s\n", settings.rxpin, initRx() ? "ok" : "ERR");
    displayDirty = true;
    return;
  }
  Serial.println("ERR unknown");
}

String lineBuf;
static void pollSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    // ir_capture.ino's single-key commands act at once; native_capture.py sends a bare 'r'.
    if (!lineBuf.length() && (c == 'r' || c == 's' || c == 'c')) {
      if (c == 'r') { rawEnabled = !rawEnabled; Serial.printf("# RAW dump %s\n", rawEnabled ? "ON" : "OFF"); }
      else if (c == 's') { Serial.printf("# frames=%lu\n", (unsigned long)frameCount); }
      else { frameCount = 0; Serial.println("# cleared"); }
      continue;
    }
    if (c == '\n' || c == '\r') { if (lineBuf.length()) { handleLine(lineBuf); lineBuf = ""; } }
    else if (lineBuf.length() < 128) lineBuf += c;
    else lineBuf = "";
  }
}

// ---- buttons --------------------------------------------------------------------------------- //
// H8 (Tony via brx1, 2026-09-24): once Wi-Fi has ever been configured, the buttons become OPERATOR
// controls -- a short press pages away from home, a 2 s hold arms a RESET confirm, and a SECOND 2 s
// hold sends it to Mission Control (station_ui.h's StationButtons). Players never press anything on
// a station. Before any WIFI command has ever been given, the Stick is in its pre-H8 standalone
// bench mode and the buttons keep their original meaning (local point RESET / MODE toggle) exactly
// as before, since that bench workflow needs no Wi-Fi at all.
//
// HOME (Tony, 2026-09-24, added after render.py shipped): the operator must always be able to get
// back to the station's home (live gameplay) screen without a restart, and neither gesture below
// changes any station state -- only which screen HomeNav says to draw. (a) 20 s with no button press
// returns home by itself (HomeNav::poll_idle, station_screen.h, host-tested). (b) A 1 s hold of A
// goes home from anywhere and also cancels an open RESET confirm -- reusing station_ui.h's own
// short-press cancel path, since that header gains no new method here. In standalone bench mode A's
// hold is already RESET (a real, safety-critical, station-state-changing gesture: "a knock on the
// field must not flip the point"), so the new home gesture lives only in the operator branch below;
// standalone's short press is a simple home/diagnostics TOGGLE instead (it has no hold to spare), and
// the 20 s idle timeout still applies either way.
//
// A58: holding A AND B together for 7 s restarts the Stick (ForceRestart, station_ui.h), in either
// branch and whether the match lock is on or not. While both are down (and for one loop after both
// come up) every single-button click and hold below is swallowed, so the joint hold never also goes
// home, arms a RESET, resets the point or flips the mode. While the match lock is on, B's hold is
// refused with a LOCKED transient; A (stats paging, the 1 s home) still works, read-only.
static void pollButtons() {
  using brx_glue::link;
  uint32_t now = millis();
  // Bench 2026-09-24: a button still held from before this boot (the operator's hands still on A+B
  // after a force restart) is ignored until it has been released once (BootHeldButtons, station_ui.h).
  // Every read below goes through these gated copies, never M5.BtnA/BtnB directly.
  bool wasMasked = bootHeld.a_masked() || bootHeld.b_masked();
  bootHeld.update(M5.BtnA.isPressed(), M5.BtnB.isPressed());
  if (!wasMasked && (bootHeld.a_masked() || bootHeld.b_masked())) {
    Serial.println("# button held at boot: ignored until released");
  }
  const bool aOk = !bootHeld.a_masked(), bOk = !bootHeld.b_masked();
  const bool aPressed = aOk && M5.BtnA.wasPressed(), bPressed = bOk && M5.BtnB.wasPressed();
  const bool aHold = aOk && M5.BtnA.wasHold(), bHold = bOk && M5.BtnB.wasHold();
  const bool aReleased = aOk && M5.BtnA.wasReleased(), bReleased = bOk && M5.BtnB.wasReleased();
  const bool aClicked = aOk && M5.BtnA.wasClicked();
  // Bench diagnostic: the serial timestamps between DOWN and HOLD measure the real hold threshold.
  if (aPressed) Serial.printf("BTN A down thresh=%u\n", (unsigned)M5.BtnA.getHoldThresh());
  if (bPressed) Serial.printf("BTN B down thresh=%u\n", (unsigned)M5.BtnB.getHoldThresh());
  if (aHold) Serial.println("BTN A hold");
  if (bHold) Serial.println("BTN B hold");
  if (aReleased) Serial.println("BTN A up");
  if (bReleased) Serial.println("BTN B up");
  if (forceRestart.update(bootHeld.a_down(), bootHeld.b_down(), now)) {
    Serial.println("FORCE RESTART (A + B held 7 s)");
    Serial.flush();
    ESP.restart();
  }
  uint32_t countdown = forceRestart.countdown_s();
  if (countdown != lastRestartCountdown) { lastRestartCountdown = countdown; displayDirty = true; }
  if (forceRestart.suppress_single()) {
    homeNav.note_activity(now);
    if (brx_glue::buttons.poll_timeout(now)) displayDirty = true;
    return;
  }
  if (link.state() == LinkState::NOT_CONFIGURED) {
    // Long presses only: a knock on the field must not flip the point or its mode.
    if (aHold) { resetPoints(); Serial.println("RESET neutral (button)"); displayDirty = true; }
    if (aClicked) {
      if (homeNav.at_home()) homeNav.leave_home(now); else homeNav.go_home(now);
      displayDirty = true;
    }
    if (bHold) setMode(point.mode == Mode::HILL ? Mode::BRIDGE : Mode::HILL);
    if (homeNav.poll_idle(now)) displayDirty = true;
    return;
  }
  if (aClicked) {
    ButtonPhase before = brx_glue::buttons.phase();
    brx_glue::buttons.on_short_press();
    if (before == ButtonPhase::CONFIRM_ARMED) homeNav.note_activity(now);  // cancelled, not a page move
    else homeNav.leave_home(now);
    displayDirty = true;
  }
  if (aHold) {
    if (brx_glue::buttons.phase() == ButtonPhase::CONFIRM_ARMED) brx_glue::buttons.on_short_press();  // cancel it
    homeNav.go_home(now);
    displayDirty = true;
  }
  bool locked = link.lock().locked(now);
  // A58: a confirm left open when a lock arrives must not sit on screen offering a RESET it will refuse.
  if (locked && brx_glue::buttons.phase() == ButtonPhase::CONFIRM_ARMED) {
    brx_glue::buttons.on_short_press();  // the same cancel path A's short press uses
    displayDirty = true;
  }
  if (bHold && locked) {
    resetOutcomeActive = true;  // reuse the reset-outcome transient, as LOCKED
    resetOutcomeLocked = true;
    resetOutcomeOk = false;
    resetOutcomeAtMs = now;
    Serial.printf("RESET refused: station locked (%lu s left)\n", (unsigned long)link.lock().remaining_s(now));
    homeNav.note_activity(now);
    displayDirty = true;
  } else if (bHold) {
    if (brx_glue::buttons.on_long_press(now)) {
      bool sent = brx_glue::mcSendResetAction();
      resetOutcomeActive = true;
      resetOutcomeLocked = false;
      resetOutcomeOk = sent;
      resetOutcomeAtMs = now;
      Serial.println(sent ? "RESET sent to Mission Control" : "RESET NEEDS MISSION CONTROL");
    } else {
      confirmArmedAtMs = now;  // mirrors station_ui.h's own armed_at_ms_: set on a fresh arm AND a
                                // past-timeout re-arm, exactly the two cases on_long_press() returns false
    }
    homeNav.note_activity(now);
    displayDirty = true;
  }
  if (brx_glue::buttons.poll_timeout(now)) displayDirty = true;
  if (homeNav.poll_idle(now)) displayDirty = true;
}

// ---- setup / loop ---------------------------------------------------------------------------- //
void setup() {
  auto cfg = M5.config();
  cfg.internal_spk = false;  // the amp interferes with the IR receiver (M5 docs); never bring it up
  cfg.internal_mic = false;
  M5.begin(cfg);
  M5.Speaker.end();
  // The IR receiver (G42) and transmitter (G46) run off the M5PM1 EXT_5V rail, which M5Unified leaves OFF by default
  // (docs.m5stack.com/en/arduino/m5sticks3/m5pm1). Without it the receiver is unpowered: bench 2026-09-23 saw only
  // short random pulses and no gun shot at all until this line. M5's own IR example calls it the same way.
  M5.Power.setExtOutput(true, m5::ext_none);
  M5.Display.setRotation(1);  // landscape, 240 x 135
  M5.Display.setBrightness(BACKLIGHT_BRIGHT);
  // M5Unified's default hold is 500 ms. The screen model assumes these: A's hold goes home (1 s), and
  // B's hold arms and sends RESET (2 s, the knock-safety rule). Standalone bench RESET on A is 1 s too.
  M5.BtnA.setHoldThresh(HOME_LONG_PRESS_MS);
  M5.BtnB.setHoldThresh(LONG_PRESS_MS);
  canvas.setColorDepth(16);
  // One off-screen sprite for every screen, pushed once per paint (~65 KB). PSRAM keeps it out of the
  // internal DRAM that Wi-Fi and BLE share; without a sprite nothing draws, so say so on the serial port.
  canvas.setPsram(true);
  if (!canvas.createSprite(240, 135)) {
    canvas.setPsram(false);  // a build without PSRAM: fall back to internal DRAM rather than a dark screen
    if (!canvas.createSprite(240, 135)) Serial.println("ERR display sprite alloc (no screen)");
  }
  // A 4 KB TX buffer: with the zero TX timeout below, a burst (STATUS prints ~600 bytes) would
  // otherwise overflow the small default buffer and lose bytes even with a host reading (bench
  // 2026-09-24: STATUS's LINK line arrived cut short).
  Serial.setTxBufferSize(4096);
  Serial.begin(115200);
  // USB CDC with no host attached (every field station) must never stall loop(): with the default TX
  // timeout each print waits for a reader, which froze the HILL beacon (bench 2026-09-24: beacons
  // arrived only while a PC held the serial port open). A dropped diagnostic line costs nothing.
  Serial.setTxTimeoutMs(0);
  delay(300);
  loadSettings();
  point.mode = (Mode)settings.mode;
  Serial.println("# BRX StickS3 station ready (RX G42 via RMT, speaker off).");
  Serial.printf("# mode=%s id=%u game=%u txpin=%u\n", point.mode == Mode::HILL ? "HILL" : "BRIDGE", settings.id,
                settings.game, settings.txpin);
  Serial.println("# Commands: SELFTEST [bits] | RAW ON|OFF | TX <bits> | TXN <n> <bits> | AUTO <bits>|OFF | PING | STATUS | MODE BRIDGE|HILL | ID <n> | GAME <n> | TXPIN 46|9|10 | RXPIN 42|9|10 | BL <n> | RESET | r s c");
  Serial.println("# H8: WIFI <ssid> <pass> | MC <ws://host:port/path> | LINK MUSTER|HELD|OFF|RECONNECT | ACTIONS ON|OFF");
  Serial.println("# A58: while MC's match lock is on, state-changing commands answer ERR locked; A+B held 7 s restarts");
  IR_RX_PIN = (settings.rxpin == IR_TX_GROVE || settings.rxpin == IR_TX_GROVE_ALT) ? settings.rxpin : IR_RX_ONBOARD;
  if (IR_RX_PIN == settings.txpin) IR_RX_PIN = IR_RX_ONBOARD;  // never receive on the transmit pin
  if (!initRx()) Serial.println("ERR rx init (RMT)");
  if (!initTx(settings.txpin)) Serial.println("ERR tx init (RMT)");
  initBle();
  brx_glue::mcSetup();   // H8: loads Wi-Fi/node_id/node_key/LINK mode from Preferences, joins if set
  pollAdvert(millis());  // HILL advertises at once; BRIDGE waits for its first live beacon
}

void loop() {
  M5.update();
  uint32_t now = millis();
  pollRx();
  pollSerial();
  pollButtons();
  pollAdvert(now);
  brx_glue::mcLoop(now);  // H8: Wi-Fi/mDNS/WebSocket to Mission Control; never blocks
  if (brx_glue::mcScreenWake) { brx_glue::mcScreenWake = false; displayDirty = true; }
  // S57: a Bluetooth hill that just changed hands sends the grenade's capture word once (magnitude 50,
  // the new owner's team), as control_point.h's IR HILL does. Only a CAPTURE sends it: a point drained
  // to neutral has no new owner, and a stock grenade never emits a neutral capture word.
  if (brx_glue::pendingCaptureTeam >= 0) {
    int team = brx_glue::pendingCaptureTeam;
    brx_glue::pendingCaptureTeam = -1;
    if (bleHillActive()) sendFrame(String(encode(hill_capture_word(team)).c_str()));
  }
  // The periodic IR hill beacon (proto 15 mag 8, every 5 s) is a BENCH-mode feature only. An
  // MC-assigned station (hill, respawn or pickup) never sends it: the Bluetooth hill's phones follow
  // its advert, and the IR hill is post-MVP. Bench 2026-09-24: a Stick armed as a RESPAWN station kept
  // its saved bench mode HILL and beaconed team 2 / magnitude 8 into a live match every 5 s; every gun
  // near it logged the word. The S57 capture word above (once, on a capture) is the only IR an
  // assigned station sends.
  if (point.mode == Mode::HILL && !brx_glue::link.assignment().present &&
      now - lastBeaconTxMs >= BEACON_PERIOD_MS) {
    lastBeaconTxMs = now;
    sendFrame(String(encode(point.beacon_word()).c_str()));
  }
  if (autoBits.length() && now - lastAutoMs >= AUTO_TX_INTERVAL_MS) {
    lastAutoMs = now;
    sendFrame(autoBits);
  }
  if (resetOutcomeActive && now - resetOutcomeAtMs >= RESET_OUTCOME_SHOW_MS) {
    resetOutcomeActive = false;  // the transient RESET SENT / RESET NEEDS MISSION CONTROL screen expires
    displayDirty = true;
  }
  // Redraw on a real change (`displayDirty`), or at most ~4 Hz so a countdown (a pickup's NEXT SPAWN,
  // a RESET confirm's draining timeout bar, the JOINING dots) still moves -- README's "Screens"
  // section. The screen itself is always drawn into `canvas` off-screen and pushed once, so there is
  // no flicker and no contention with IR receive (RMT is hardware-buffered) or the Wi-Fi/BLE loop.
  static uint32_t lastPaintMs = 0;
  const uint32_t REPAINT_INTERVAL_MS = 250;
  if (displayDirty || now - lastPaintMs >= REPAINT_INTERVAL_MS) {
    paintFromModel(now);
    lastPaintMs = now;
    if (displayDirty) {
      // Wake the backlight on a real event only (a button, a pickup, a capture) -- never on the
      // routine ~4 Hz countdown repaint above, or it would never dim during a live countdown.
      lastWakeMs = now;
      if (backlightDimmed) { M5.Display.setBrightness(BACKLIGHT_BRIGHT); backlightDimmed = false; }
    }
    displayDirty = false;
  }
  if (!backlightDimmed && now - lastWakeMs >= BACKLIGHT_IDLE_MS) {
    M5.Display.setBrightness(BACKLIGHT_DIM);
    backlightDimmed = true;
  }
  delay(2);
}
