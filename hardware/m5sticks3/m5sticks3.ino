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
#include "button_controller.h" // host-tested button decisions and ordered effects
#include "stick_state.h"    // the pure mapping: the Stick's real state -> StickState (host-tested, sim/)
#include "led_strip.h"      // the LED strip's patterns, power cap and wire bytes (host-tested)
#include "strip_roles.h"    // the strip's role patterns, from the screen's StickState (host-tested)

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
  uint8_t strippin = 0;  // 0 = no strip; 9 or 10 = the SK6812 strip's data pin (STRIPPIN)
  uint16_t stripn = STRIP_DEFAULT_LEDS;
  uint8_t strippower = (uint8_t)StripPower::GROVE;  // GROVE (300 mA cap) or EXT (the strip on its own 5 V)
} settings;

static void loadSettings() {
  prefs.begin("brx", true);
  settings.mode = prefs.getUChar("mode", settings.mode);
  settings.id = prefs.getUShort("id", settings.id);
  settings.game = prefs.getUChar("game", settings.game);
  settings.txpin = prefs.getUChar("txpin", settings.txpin);
  settings.rxpin = prefs.getUChar("rxpin", settings.rxpin);
  settings.strippin = prefs.getUChar("strippin", settings.strippin);
  settings.stripn = prefs.getUShort("stripn", settings.stripn);
  settings.strippower = prefs.getUChar("strippower", settings.strippower) == (uint8_t)StripPower::EXT ? (uint8_t)StripPower::EXT : (uint8_t)StripPower::GROVE;
  if (settings.stripn < 1 || settings.stripn > STRIP_MAX_LEDS) settings.stripn = STRIP_DEFAULT_LEDS;
  prefs.end();
}
static void saveSettings() {
  prefs.begin("brx", false);
  prefs.putUChar("mode", settings.mode);
  prefs.putUShort("id", settings.id);
  prefs.putUChar("game", settings.game);
  prefs.putUChar("txpin", settings.txpin);
  prefs.putUChar("rxpin", settings.rxpin);
  prefs.putUChar("strippin", settings.strippin);
  prefs.putUShort("stripn", settings.stripn);
  prefs.putUChar("strippower", settings.strippower);
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
ButtonController buttonController; // operator gestures, navigation and transient outcomes
BootHeldButtons bootHeld;         // a button still down from before this boot is ignored until released

// Screen brightness (README's "Screens" section): dim after idle, wake on a button or a real state
// change (anything that already sets `displayDirty`, e.g. a pickup or a capture) -- never on the
// routine ~4 Hz countdown repaint below, or the backlight would never dim during a live countdown.
constexpr uint8_t BACKLIGHT_BRIGHT = 120;  // matches setup()'s existing setBrightness(120)
// Never below 60: at 25 (and at 0) the backlight's PWM couples into the IR receiver as ~660 Hz pulses,
// about 20 bursts per 15 s, which buried every gun shot (bench 2026-09-24, A/B/A: 25 and 0 noisy;
// 60, 120 and 255 silent). BL <n> over serial repeats the test.
constexpr uint8_t BACKLIGHT_DIM = 60;

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
      Serial.printf("OWNER team=%d captures=%lu\n", point.owner == contract::STATION_TEAM_ANY ? -1 : point.owner,
                    (unsigned long)point.captures);
      // S57: a HILL flip happened HERE, so this Stick sends the one capture word, once (never in BRIDGE). sendFrame()
      // calls pollRx() once before it transmits; that nesting is bounded because the receiver was re-armed above, and
      // the word it sends is protocol 15, which hill() never counts as a shot, so it cannot flip the point again.
      if (point.mode == Mode::HILL) sendFrame(String(encode(point.capture_word()).c_str()));
    }
    displayDirty = true;
  }
}

// ---- LED strip (SK6812 on a Grove pin; led_strip.h holds the patterns and the power cap) ------------ //
// RMT at 10 MHz (100 ns a tick). SK6812: a 0 bit is 0.3 us high + 0.9 us low, a 1 bit 0.6 + 0.6, and a
// low of at least 80 us latches the frame. 60 LEDs are 1440 bits, about 1.8 ms; rmtWrite blocks for it.
// Every frame passes strip_cap() first: see led_strip.h for the budget (300 mA of the 0.38 A EXT_5V rail, or
// 2000 mA with STRIPPOWER EXT).
static uint32_t stripBudgetMa() { return strip_budget_ma((StripPower)settings.strippower); }
static const uint32_t STRIP_TICK_HZ = 10000000;
int stripPinActive = -1;
StripPattern stripPattern = StripPattern::AUTO;  // the station role; STRIP <pattern> overrides it for the bench
StripRole stripRoleLast = StripRole::OFF;
uint32_t stripLastFrameMs = 0;
static StickState buildStickState(uint32_t now);  // the display section below
int stripTeam = 0;
uint32_t stripStartMs = 0;
long stripWalkLast = -1;
bool stripDirty = false;
bool stripGrb = true;
uint32_t stripLastMa = 0;
std::vector<Rgb> stripPx;
std::vector<uint8_t> stripWire;
std::vector<rmt_data_t> stripSym;

static void stripResize() {
  stripPx.assign(settings.stripn, Rgb{});
  stripWire.assign(settings.stripn * 3u, 0);
  stripSym.assign(settings.stripn * 24u + 1u, rmt_data_t{});
}

static bool initStrip(int pin) {
  if (stripPinActive == pin) return true;
  if (stripPinActive >= 0) rmtDeinit(stripPinActive);
  stripPinActive = -1;
  if (pin <= 0) return true;
  // Two memory blocks halve the refills during a frame; fall back to one if the IR channels hold the rest.
  if (!rmtInit(pin, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_2, STRIP_TICK_HZ) &&
      !rmtInit(pin, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_1, STRIP_TICK_HZ)) return false;
  rmtSetEOT(pin, 0);
  stripPinActive = pin;
  stripResize();
  stripDirty = true;
  return true;
}

// A failed write keeps the frame unsent and is tried again STRIP_RETRY_MS after the failed try returned, in AUTO and in
// a bench pattern alike: each try can block for 50 ms, so a strip that keeps failing must not eat the loop that runs
// the advert and the MC link (polish review 2026-11-15, rounds 1 and 2).
constexpr uint32_t STRIP_RETRY_MS = 1000;
bool stripFailed = false;
uint32_t stripFailedMs = 0;
static bool stripSend() {
  if (stripPinActive < 0) return true;
  static std::vector<Rgb> sent;
  if (!stripDirty && sent == stripPx) return true;  // an unchanged role frame costs no RMT time
  const size_t n = stripPx.size();
  stripLastMa = strip_estimate_ma(stripPx.data(), n);
  strip_bytes(stripPx.data(), n, stripGrb, stripWire.data());
  size_t k = 0;
  for (size_t i = 0; i < n * 3; i++) {
    for (int bit = 7; bit >= 0; bit--) {
      const bool one = (stripWire[i] >> bit) & 1;
      stripSym[k].level0 = 1; stripSym[k].duration0 = one ? 6 : 3;
      stripSym[k].level1 = 0; stripSym[k].duration1 = one ? 6 : 9;
      k++;
    }
  }
  stripSym[k].level0 = 0; stripSym[k].duration0 = 500;  // the latch: 100 us low
  stripSym[k].level1 = 0; stripSym[k].duration1 = 500;
  k++;
  if (!rmtWrite(stripPinActive, stripSym.data(), k, 50)) {
    Serial.println("ERR strip write");
    sent.clear(); stripFailed = true; stripFailedMs = millis();
    return false;
  }
  sent = stripPx; stripFailed = false;
  return true;
}

static bool stripBlank() {
  if (stripPinActive < 0) return true;
  for (Rgb& p : stripPx) p = Rgb{};
  stripDirty = true;   // send the dark frame even if the last one sent was dark too
  return stripSend();
}

static void printStrip() {
  Serial.printf("STRIP pin=%d n=%u pattern=%s", stripPinActive, settings.stripn, strip_pattern_name(stripPattern));
  if (stripPattern == StripPattern::TEAM) Serial.printf(" team=%d", stripTeam);
  if (stripPattern == StripPattern::AUTO) Serial.printf(" role=%s", strip_role_name(stripRoleLast));
  Serial.printf(" order=%s power=%s est_ma=%lu budget_ma=%lu\n", stripGrb ? "GRB" : "RGB",
                strip_power_name((StripPower)settings.strippower), (unsigned long)stripLastMa, (unsigned long)stripBudgetMa());
}

static void pollStrip(uint32_t now) {
  if (stripPinActive < 0) return;
  const uint32_t elapsed = now - stripStartMs;
  if (stripPattern == StripPattern::WALK) {
    long idx = (long)strip_walk_index(elapsed, stripPx.size());
    if (idx != stripWalkLast) {
      stripWalkLast = idx;
      stripDirty = true;
      Serial.printf("STRIP walk %ld\n", idx);  // LED 0 is the one nearest the plug
    }
  }
  if (stripFailed && millis() - stripFailedMs < STRIP_RETRY_MS) return;   // a failing strip waits, whatever the pattern
  if (stripPattern == StripPattern::AUTO) {
    if (!stripDirty && now - stripLastFrameMs < STRIP_FRAME_MS) return;
    stripLastFrameMs = now;
    StripRole role = strip_render_role(buildStickState(now), now, stripPx.data(), stripPx.size(), stripBudgetMa());
    if (role != stripRoleLast) { stripRoleLast = role; Serial.printf("STRIP role %s\n", strip_role_name(role)); }
    stripSend();   // a failure clears its sent copy, so the next frame tick sends again
    stripDirty = false;
    return;
  }
  if (!stripDirty && !stripFailed) return;   // past the cooldown above, a failed frame is sent again
  strip_render(stripPattern, stripTeam, elapsed, stripPx.data(), stripPx.size(), stripBudgetMa());
  stripSend();
  stripDirty = false;
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
  if (a.kind == "control") {
    AdvertView v = link.hill().advert();
    // A88: a following hill advertises its Domination tally beside the UUID, alternating with its last ended game
    TallyView t[2];
    const int n = link.follower().tallies(link.hill(), now, t);
    if (n) {
      encode_tally(t[n > 1 ? (now / (uint32_t)contract::HILL_TALLY_ROTATE_MS) % 2 : 0], v.tally);
      v.has_tally = true;
    }
    return v;
  }
  if (a.kind == "powerup") {
    // Review round 2 (LOW): gated on powerup_ended() (via powerup_advert_view), not the raw schedule
    // -- after MATCH OVER the schedule can still say "available", and no phone must see an item it
    // can never get.
    PowerupAdvertView p = link.powerup_advert_view(now);
    AdvertView v;
    v.team = contract::STATION_TEAM_ANY;
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
// A67 addendum 1: the advertising TX power follows the station's tx_power (MC's, or an on-station edit):
// ultra_low -18 dBm, low -9, medium 0, high +9 (the default, what the Stick always used). Applied on
// every (re)start of the advert, so a change takes effect at the next publish.
static esp_power_level_t advertPowerLevel(int level) {
  switch (level) {
    case TX_POWER_ULTRA_LOW: return ESP_PWR_LVL_N18;
    case TX_POWER_LOW: return ESP_PWR_LVL_N9;
    case TX_POWER_MEDIUM: return ESP_PWR_LVL_N0;
    default: return ESP_PWR_LVL_P9;
  }
}
int appliedTxLevel = -1;
static void applyAdvertTxPower() {
  const int level = brx_glue::link.assignment().present ? brx_glue::link.tx_power_level() : TX_POWER_DEFAULT;
  BLEDevice::setPower(advertPowerLevel(level), ESP_BLE_PWR_TYPE_ADV);
  if (level != appliedTxLevel) {
    appliedTxLevel = level;
    Serial.printf("# advert TX power %s (%d dBm)\n", tx_power_name(level), tx_power_dbm(level));
  }
}

static void publishAdvert(const AdvertView& v, uint32_t now) {
  using brx_glue::link;
  uint8_t seq = policy.published(v, now);
  const StationAssignment& a = link.assignment();
  bool assigned = a.present;  // the assignment, not the link state (see currentAdvertView)
  Advert adv_;
  adv_.role = contract::ADVERT_ROLE_STATION;
  adv_.id = assigned ? (uint16_t)a.id : settings.id;
  adv_.kind = assigned ? station_kind_byte(a.kind) : KIND_CONTROL;
  adv_.team = v.team;
  adv_.state = v.state;
  adv_.value = v.value;
  adv_.seq = seq;
  adv_.game = assigned ? link.advert_game() : settings.game;   // F658: a following hill or powerup advertises the followed game
  adv_.threshold = assigned ? link.threshold_advertised_dbm() : 0;  // hill default keeps phone range at the prior value
  adv_.taker = v.taker;
  String uuid = advert_uuid(adv_).c_str();
  if (!adv) { policy.have_last = false; return; }
  adv->stop();
  BLEAdvertisementData data;
  data.setFlags(0x04);  // BR/EDR not supported; general discoverable is not needed for a beacon
  data.setCompleteServices(BLEUUID(uuid.c_str()));
  if (v.has_tally) {  // A88: flags 3 + UUID 18 + this 10 = 31, the legacy limit exactly
    char md[8];  // the company id, little-endian, then the payload; String(ptr, len) keeps the zero bytes
    md[0] = (char)(contract::ADVERT_TALLY_COMPANY & 0xff);
    md[1] = (char)((contract::ADVERT_TALLY_COMPANY >> 8) & 0xff);
    for (int i = 0; i < 6; i++) md[2 + i] = (char)v.tally[i];
    data.setManufacturerData(String(md, sizeof md));
  }
  applyAdvertTxPower();  // A67: the advertising power, re-applied on every restart of the advert
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
    v.game = a.present ? brx_glue::link.advert_game() : settings.game;   // F658
    v.threshold = a.present ? brx_glue::link.threshold_advertised_dbm() : 0;
  }
  {  // A67: a new TX power restarts the advert at once (publishAdvert applies it before adv->start())
    const int wantTx = brx_glue::link.assignment().present ? brx_glue::link.tx_power_level() : TX_POWER_DEFAULT;
    if (advertising && wantTx != appliedTxLevel) policy.have_last = false;
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
// The mapping itself is pure and lives in stick_state.h, so the screen simulator (sim/) runs the
// exact same code on the host; this only gathers the globals it reads.
HeldClock heldClock;  // times "HELD m:ss" across paints

static StickState buildStickState(uint32_t now) {
  StickInputs in;
  in.now_ms = now;
  in.link = &brx_glue::link;
  in.point = &point;
  in.advertising = advertising;
  in.revive_flash_until_ms = brx_glue::reviveFlashUntilMs;
  in.last_word_at_ms = lastWordAt;
  in.last_word = lastWord;
  in.word_count = wordCount;
  in.sent_word_count = sentWordCount;
  in.selftest_result = std::string(lastSelfTestResult.c_str());
  in.tx_pin = settings.txpin;
  in.button_phase = buttonController.buttons().phase();
  in.confirm_armed_at_ms = buttonController.buttons().armed_at_ms();
  in.reset_outcome_active = buttonController.reset_outcome().active;
  in.reset_outcome_ok = buttonController.reset_outcome().ok;
  in.reset_outcome_locked = buttonController.reset_outcome().locked;
  in.force_restart_countdown_s = buttonController.restart_countdown_s();
  in.at_home = buttonController.home().at_home();
  in.range_active = buttonController.range().active();
  in.ext_power = settings.strippower == (uint8_t)StripPower::EXT;
  in.range_edit_strength = buttonController.range().field() == RangeField::STRENGTH;
  in.range_cue_pct = buttonController.range_cue_pct();
  return build_stick_state(in, heldClock);
}

// EFF-8: the last spec on the glass. A repaint renders the whole canvas and pushes 64,800 B over SPI, so an
// unchanged spec (equal on EVERY field, station_screen.h; a countdown second turning over changes a field)
// skips both.
static void paintFromModel(uint32_t now) {
  static ScreenSpec lastSpec;
  static bool havePainted = false;
  ScreenSpec spec = compute_screen(buildStickState(now));
  if (havePainted && spec == lastSpec) return;
  brx_render::renderScreen(canvas, spec);
  canvas.pushSprite(0, 0);
  lastSpec = spec;
  havePainted = true;
}

// ---- serial commands ------------------------------------------------------------------------- //
static void printStatus() {
  Serial.printf("STATUS mode=%s owner=%d charges=%lu,%lu,%lu,%lu captures=%lu seq=%u adverts=%lu words=%lu id=%u game=%u txpin=%u uuid=%s strippower=%s\n",
                point.mode == Mode::HILL ? "HILL" : "BRIDGE", point.owner == contract::STATION_TEAM_ANY ? -1 : point.owner,
                (unsigned long)point.charge[0], (unsigned long)point.charge[1], (unsigned long)point.charge[2],
                (unsigned long)point.charge[3], (unsigned long)point.captures, policy.seq,
                (unsigned long)advertCount, (unsigned long)wordCount, settings.id, settings.game, settings.txpin,
                currentUuid.c_str(), strip_power_name((StripPower)settings.strippower));
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
                a.present ? link.threshold_dbm() : 0);
  // threshold_src/tx_src are the local diagnostic labels (station/mc/default), one step finer than the
  // wire's own src ("station"/"mc" only, contracts.md) -- a RANGE CLEAR reads here as "default" or "mc"
  // depending on whether MC ever actually sent a value.
  Serial.printf(" threshold_src=%s tx_power=%s tx_src=%s range_edits=%u", link.threshold_src_label(),
                tx_power_name(link.tx_power_level()), link.tx_power_src_label(),
                (unsigned)link.range_edits().edits().size());  // F365 / A67
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
      Serial.printf(" hill_owner=%d capturing=%d progress=%ld dir=%d contested=%d net=%d captures=%lu", h.owner == contract::STATION_TEAM_ANY ? -1 : h.owner,
                    h.capturing, brx::BleControlPoint::js_round(h.progress), h.dir, h.contested ? 1 : 0, h.net,
                    (unsigned long)h.captures);
    } else if (brx::REVIVE_FEEDBACK_ENABLED) {  // post-MVP (presence.h)
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

uint32_t playersStreamUntilMs = 0;
static void printPlayers() {
  const brx::PlayerPresence& pr = brx_glue::presence;
  for (size_t i = 0; i < pr.capacity(); i++) {
    const brx::PlayerEntry& e = pr.slot(i);
    if (!e.used) continue;
    const int med = brx::PlayerPresence::median_of(e);
    const int t = pr.threshold_for(e);
    Serial.printf("PLAYER id=%u team=%u alive=%u raw=%d median=%d ema=%.1f thr=%d near_floor=%d near=%d present=%d age_ms=%lu game=%u\n",
                  (unsigned)e.id, (unsigned)e.team, (unsigned)(e.state & contract::ADVERT_PLAYER_STATE_ALIVE), e.raw, med, e.rssi, t,
                  (int)(t - contract::REVIVE_MARGIN_DB), med >= t - contract::REVIVE_MARGIN_DB ? 1 : 0, e.present ? 1 : 0,
                  (unsigned long)e.age_ms, (unsigned)e.game);
  }
  Serial.printf("PLAYERS default_threshold=%d revives=%lu\n", pr.default_threshold,
                (unsigned long)brx_glue::link.revives().revives);
}

static void handleLine(String line) {
  line.trim();
  if (!line.length()) return;
  if (line == "PING") { Serial.println("PONG"); return; }
  // Bench diagnostic: every player the station hears, with what presence and the revive rule judge.
  // `PLAYERS STREAM <s>` repeats it every 250 ms for <s> seconds (max 120) from loop(), non-blocking,
  // so a controlled 1 m / 3 m / beside measurement gets dense data (bench 2026-09-24: a polled dump
  // saw each phone only every 1-7 s and could not separate range from sampling).
  if (line == "PMIC") {  // read-only: the side-button lock bits (M5PM1 0x49/0x4A bit0; bit7 of 0x49 is never written)
    uint8_t c1 = M5.In_I2C.readRegister8(brx_glue::PM1_ADDR, brx_glue::PM1_BTN_CFG_1, brx_glue::PM1_I2C_HZ);
    uint8_t c2 = M5.In_I2C.readRegister8(brx_glue::PM1_ADDR, brx_glue::PM1_BTN_CFG_2, brx_glue::PM1_I2C_HZ);
    Serial.printf("PMIC 0x49=%02x 0x4A=%02x single_reset_disabled=%u double_off_disabled=%u dl_lock=%u want_lock=%u confirmed=%u\n",
                  c1, c2, c1 & 1, c2 & 1, (c1 >> 7) & 1, brx_glue::pmicLock.want() ? 1 : 0,
                  brx_glue::pmicLock.confirmed() ? 1 : 0);
    return;
  }
  if (brx::REVIVE_FEEDBACK_ENABLED && line == "REDEPLOY") {  // bench: show the revive flash now (post-MVP, presence.h)
    brx_glue::reviveFlashUntilMs = millis() + brx_glue::REVIVE_FLASH_MS;
    displayDirty = true;
    Serial.println("REDEPLOY flash (test)");
    return;
  }
  if (line == "PLAYERS") { printPlayers(); return; }
  if (line.startsWith("PLAYERS STREAM")) {
    long secs = line.length() > 15 ? line.substring(15).toInt() : 30;
    if (secs < 1) secs = 1;
    if (secs > 120) secs = 120;
    playersStreamUntilMs = millis() + (uint32_t)secs * 1000u;
    Serial.printf("PLAYERS STREAM %ld s\n", secs);
    return;
  }
  // Bench diagnostic: A/B the receiver noise against the backlight (below 60 it makes IR noise).
  // BL 0 = off; the next wake or dim restores the normal levels.
  if (line.startsWith("BL ")) {
    int v = line.substring(3).toInt();
    M5.Display.setBrightness((uint8_t)constrain(v, 0, 255));
    Serial.printf("BL %d\n", v);
    return;
  }
  if (line == "STATUS") { printStatus(); return; }
  if (line == "STRIP") { printStrip(); return; }  // read-only
  // A58: while the match lock is on, only the read-only commands run (station_ui.h's allow-list,
  // host-tested; default deny). Checked before mcHandleLine so WIFI/MC/LINK/ACTIONS are refused too.
  if (brx_glue::link.lock().locked(millis()) && !serial_command_allowed_while_locked(std::string(line.c_str()))) {
    Serial.printf("ERR locked (%lu s left)\n", (unsigned long)brx_glue::link.lock().remaining_s(millis()));
    return;
  }
  // F365 (bench diagnostic): give the on-Stick RANGE edit back to the platform default, or MC's last
  // explicit value if it sent one -- the lock check above already refuses this while a match lock is
  // on (it is not in station_ui.h's allow-list), same as RESET or MODE. Local only: no MC round trip.
  if (line == "RANGE CLEAR") {
    brx_glue::mcClearRangeEdit(brx_glue::link);
    Serial.printf("RANGE cleared threshold=%d src=%s tx=%s\n", brx_glue::link.threshold_dbm(),
                  brx_glue::link.threshold_src_label(), tx_power_name(brx_glue::link.tx_power_level()));
    displayDirty = true;
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
    if (p == settings.strippin) { Serial.println("ERR TXPIN is the strip pin; STRIPPIN elsewhere first"); return; }
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
    if (p == settings.strippin) { Serial.println("ERR RXPIN is the strip pin; STRIPPIN elsewhere first"); return; }
    rmtDeinit(IR_RX_PIN);
    settings.rxpin = (uint8_t)p;
    IR_RX_PIN = p;
    saveSettings();
    Serial.printf("RXPIN %u %s\n", settings.rxpin, initRx() ? "ok" : "ERR");
    displayDirty = true;
    return;
  }
  if (line.startsWith("STRIPPIN ")) {
    String a = line.substring(9); a.trim();
    int p = (a == "OFF") ? 0 : a.toInt();
    if (p != 0 && p != IR_TX_GROVE && p != IR_TX_GROVE_ALT) { Serial.println("ERR STRIPPIN 9|10|OFF"); return; }
    if (p != 0 && p == txPinActive) { Serial.printf("ERR STRIPPIN %d is the IR TX pin; TXPIN elsewhere first\n", p); return; }
    if (p != 0 && p == IR_RX_PIN) { Serial.printf("ERR STRIPPIN %d is the IR RX pin; RXPIN elsewhere first\n", p); return; }
    if (p != stripPinActive) stripBlank();  // dark the strip on its old pin before it is let go (polish review 2026-11-15)
    settings.strippin = (uint8_t)p;
    saveSettings();
    bool ok = initStrip(p);
    Serial.printf("STRIPPIN %u %s\n", settings.strippin, p == 0 ? "off" : ok ? "ok" : "ERR rmt init");
    return;
  }
  if (line.startsWith("STRIPN ")) {
    int n = line.substring(7).toInt();
    if (n < 1 || n > STRIP_MAX_LEDS) { Serial.printf("ERR STRIPN 1-%u\n", STRIP_MAX_LEDS); return; }
    // dark the old length first, so LEDs past a shorter count do not stay lit. If that write fails, keep the old
    // length: a shorter one would leave the tail lit outside the budget (polish review 2026-11-15)
    if (!stripBlank()) { Serial.println("ERR STRIPN: the strip did not take the dark frame; length not changed"); return; }
    settings.stripn = (uint16_t)n;
    saveSettings();
    stripResize();
    stripDirty = true;
    Serial.printf("STRIPN %u\n", settings.stripn);
    return;
  }
  if (line.startsWith("STRIPPOWER ")) {
    String m = line.substring(11); m.trim(); m.toUpperCase();
    if (m == "GROVE") settings.strippower = (uint8_t)StripPower::GROVE;
    else if (m == "EXT") settings.strippower = (uint8_t)StripPower::EXT;
    else { Serial.println("ERR STRIPPOWER GROVE|EXT"); return; }
    saveSettings();
    stripDirty = true;
    Serial.printf("STRIPPOWER %s budget_ma=%lu%s\n", strip_power_name((StripPower)settings.strippower),
                  (unsigned long)stripBudgetMa(),
                  settings.strippower == (uint8_t)StripPower::EXT ? " (the strip must have its own 5 V; see README)" : "");
    return;
  }
  if (line.startsWith("STRIPORDER ")) {
    String o = line.substring(11); o.trim();
    if (o == "GRB") stripGrb = true;
    else if (o == "RGB") stripGrb = false;
    else { Serial.println("ERR STRIPORDER GRB|RGB"); return; }
    stripDirty = true;
    Serial.printf("STRIPORDER %s (not saved)\n", stripGrb ? "GRB" : "RGB");
    return;
  }
  if (line.startsWith("STRIP ")) {
    String a = line.substring(6); a.trim(); a.toLowerCase();
    StripPattern pat; int team = stripTeam;
    if (!parse_strip_pattern(std::string(a.c_str()), pat, team)) {
      Serial.println("ERR STRIP auto|off|red|green|blue|white|walk|teams|team <0-3>");
      return;
    }
    stripPattern = pat; stripTeam = team; stripStartMs = millis(); stripWalkLast = -1; stripDirty = true;
    if (stripPinActive < 0) Serial.println("# STRIP: no strip pin; set STRIPPIN 9 or 10 first");
    printStrip();
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
static void applyButtonEffects(const ButtonEffects& effects, uint32_t now) {
  using brx_glue::link;
  bool edited = false, resetSent = false;
  for (const ButtonEffect& effect : effects) {
    switch (effect.kind) {
      case ButtonEffectKind::SERIAL_PRINTLN: Serial.println(effect.text.c_str()); break;
      case ButtonEffectKind::SERIAL_PRINTF: Serial.printf("%s\n", effect.text.c_str()); break;
      case ButtonEffectKind::REDRAW: displayDirty = true; break;
      case ButtonEffectKind::RESET_POINTS: resetPoints(); break;
      case ButtonEffectKind::SET_MODE_BRIDGE: setMode(Mode::BRIDGE); break;
      case ButtonEffectKind::SET_MODE_HILL: setMode(Mode::HILL); break;
      case ButtonEffectKind::EDIT_RANGE:
        edited = effect.strength ? link.edit_tx_power(effect.step, now) : link.edit_threshold(effect.step, now);
        break;
      case ButtonEffectKind::SAVE_RANGE_IF_EDITED:
        if (edited) brx_glue::mcSaveRangeIfChanged(link);
        break;
      case ButtonEffectKind::SERIAL_RANGE_IF_EDITED:
        if (edited) Serial.printf("RANGE threshold=%d tx=%s (on-station edit, seq %lu)\n", link.threshold_dbm(),
                                  tx_power_name(link.tx_power_level()), (unsigned long)(link.range_edits().next_seq() - 1));
        break;
      case ButtonEffectKind::WIFI_REJOIN:
        link.clear_dropped_for_match();
        brx_glue::linkOff = false;
        Serial.println("REJOIN: operator gesture (B clicked three times)");
        WiFi.begin(brx_glue::wifiSsid.c_str(), brx_glue::wifiPass.c_str());
        break;
      case ButtonEffectKind::SEND_RESET:
        resetSent = brx_glue::mcSendResetAction();
        buttonController.complete_reset(resetSent, now);
        break;
      case ButtonEffectKind::SERIAL_RESET_RESULT:
        Serial.println(resetSent ? "RESET sent to Mission Control" : "RESET NEEDS MISSION CONTROL");
        break;
      case ButtonEffectKind::FORCE_RESTART:
        Serial.println("FORCE RESTART (A + B held 7 s)");
        if (brx_glue::mcClearSavedLock()) {
          Serial.flush();
          ESP.restart();
        } else Serial.println("ERR force restart needs NVS lock clear; release and retry");
        break;
    }
  }
}

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
  const bool aOk = !bootHeld.a_masked(), bOk = !bootHeld.b_masked();
  ButtonFacts facts;
  facts.now_ms = now;
  facts.held_at_boot_newly_masked = !wasMasked && (bootHeld.a_masked() || bootHeld.b_masked());
  facts.a_down = bootHeld.a_down();
  facts.b_down = bootHeld.b_down();
  facts.a_pressed = aOk && M5.BtnA.wasPressed();
  facts.b_pressed = bOk && M5.BtnB.wasPressed();
  facts.a_hold = aOk && M5.BtnA.wasHold();
  facts.b_hold = bOk && M5.BtnB.wasHold();
  facts.a_released = aOk && M5.BtnA.wasReleased();
  facts.b_released = bOk && M5.BtnB.wasReleased();
  facts.a_clicked = aOk && M5.BtnA.wasClicked();
  facts.b_clicked = bOk && M5.BtnB.wasClicked();
  // Bench diagnostic: the serial timestamps between DOWN and HOLD measure the real hold threshold.
  facts.a_hold_threshold_ms = M5.BtnA.getHoldThresh();
  facts.b_hold_threshold_ms = M5.BtnB.getHoldThresh();
  facts.link_configured = link.state() != LinkState::NOT_CONFIGURED;
  facts.assignment_present = link.assignment().present;
  facts.locked = link.lock().locked(now);
  facts.lock_remaining_s = link.lock().remaining_s(now);
  facts.dropped_for_match = link.dropped_for_match();
  facts.link_off = brx_glue::linkOff;
  facts.point_hill = point.mode == Mode::HILL;
  applyButtonEffects(buttonController.tick(facts), now);
}

// ---- setup / loop ---------------------------------------------------------------------------- //
void setup() {
  auto cfg = M5.config();
  cfg.internal_spk = false;  // the amp interferes with the IR receiver (M5 docs); never bring it up
  cfg.internal_mic = false;
  M5.begin(cfg);
  // F332: give the side button back FIRST. A lock left set by a crashed boot survives the reset (the
  // PMIC keeps it), so this runs before anything else that could crash-loop (mc_link_glue.h).
  brx_glue::pmicSync(false, millis());
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
  // polish review 2026-11-15: EXT is saved in NVS, so every boot says which budget the strip runs on
  Serial.printf("# strip pin=%u n=%u power=%s budget_ma=%lu%s\n", settings.strippin, settings.stripn,
                strip_power_name((StripPower)settings.strippower), (unsigned long)stripBudgetMa(),
                settings.strippower == (uint8_t)StripPower::EXT ? " (EXT PWR: the strip must have its own 5 V)" : "");
  Serial.println("# Strip: STRIPPIN 9|10|OFF | STRIPN <n> | STRIP [auto|off|red|green|blue|white|walk|teams|team <0-3>] | STRIPPOWER GROVE|EXT | STRIPORDER GRB|RGB");
  Serial.println("# H8: WIFI <ssid> <pass> | MC <ws://host:port/path> | LINK HELD(default)|MUSTER|OFF|RECONNECT | ACTIONS ON|OFF");
  Serial.println("# A58: while MC's match lock is on, state-changing commands answer ERR locked; A+B held 7 s restarts");
  IR_RX_PIN = (settings.rxpin == IR_TX_GROVE || settings.rxpin == IR_TX_GROVE_ALT) ? settings.rxpin : IR_RX_ONBOARD;
  if (IR_RX_PIN == settings.txpin) IR_RX_PIN = IR_RX_ONBOARD;  // never receive on the transmit pin
  if (!initRx()) Serial.println("ERR rx init (RMT)");
  if (!initTx(settings.txpin)) Serial.println("ERR tx init (RMT)");
  stripResize();
  if (settings.strippin && (settings.strippin == settings.txpin || settings.strippin == IR_RX_PIN))
    Serial.printf("ERR strip pin %u is an IR pin; strip off (STRIPPIN to move it)\n", settings.strippin);
  else if (settings.strippin && !initStrip(settings.strippin)) Serial.println("ERR strip init (RMT)");
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
  pollStrip(now);
  brx_glue::mcLoop(now);  // H8: Wi-Fi/mDNS/WebSocket to Mission Control; never blocks
  {  // PLAYERS STREAM (bench diagnostic): the player view every 250 ms while it runs
    static uint32_t lastPlayersMs = 0;
    if ((int32_t)(playersStreamUntilMs - now) > 0 && now - lastPlayersMs >= 250) { lastPlayersMs = now; printPlayers(); }
  }
  if (brx_glue::mcScreenWake) { brx_glue::mcScreenWake = false; displayDirty = true; }
  TickRadioFacts radio;
  radio.now_ms = now;
  radio.capture_team = brx_glue::pendingCaptureTeam;
  radio.ble_hill = bleHillActive();
  radio.bench_hill = point.mode == Mode::HILL;
  radio.assignment_present = brx_glue::link.assignment().present;
  radio.auto_active = autoBits.length() != 0;
  radio.auto_interval_ms = AUTO_TX_INTERVAL_MS;
  for (const TickIntent& intent : brx_glue::tickController.radio(radio)) {
    switch (intent.kind) {
      case TickIntentKind::CLEAR_PENDING_CAPTURE: brx_glue::pendingCaptureTeam = -1; break;
      case TickIntentKind::SEND_CAPTURE: sendFrame(String(encode(hill_capture_word(intent.value)).c_str())); break;
      case TickIntentKind::SEND_BEACON: sendFrame(String(encode(point.beacon_word()).c_str())); break;
      case TickIntentKind::SEND_AUTO: sendFrame(autoBits); break;
      default: break;
    }
  }
  applyButtonEffects(buttonController.expire_outcome(now), now);
  // Redraw on a real change (`displayDirty`), or at most ~4 Hz so a countdown (a pickup's NEXT SPAWN,
  // a RESET confirm's draining timeout bar, the JOINING dots) still moves -- README's "Screens"
  // section. The screen itself is always drawn into `canvas` off-screen and pushed once, so there is
  // no flicker and no contention with IR receive (RMT is hardware-buffered) or the Wi-Fi/BLE loop.
  for (const TickIntent& intent : brx_glue::tickController.display({now, displayDirty})) {
    switch (intent.kind) {
      case TickIntentKind::PAINT: paintFromModel(now); break;
      case TickIntentKind::BRIGHTEN: M5.Display.setBrightness(BACKLIGHT_BRIGHT); break;
      case TickIntentKind::CLEAR_DIRTY: displayDirty = false; break;
      case TickIntentKind::DIM: M5.Display.setBrightness(BACKLIGHT_DIM); break;
      default: break;
    }
  }
  delay(2);
}
