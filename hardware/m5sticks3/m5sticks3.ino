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
 * Board: m5stack:esp32:m5stack_sticks3 (M5Stack board package) + M5Unified >= 0.2.21.
 * The pure logic is in brx_ir.h / brx_advert.h / control_point.h (host-tested).
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEAdvertising.h>
#include <M5Unified.h>
#include <Preferences.h>

#include "brx_advert.h"
#include "brx_ir.h"
#include "control_point.h"

using namespace brx;

// ---- pins (docs.m5stack.com StickS3 pin map) ------------------------------------------------ //
static const int IR_RX_PIN = 42;     // onboard 38 kHz receiver; RMT only, and the speaker amp must be OFF
static const int IR_TX_ONBOARD = 46; // onboard IR LED
// The Grove port is G9 and G10. M5Unified maps it as SCL = G10, SDA = G9, and M5's colour code puts
// SCL on the yellow wire, which is where a Seeed Grove module's SIG (pin 1) sits: so G10 first. M5's
// StickS3 web page reads the other way, hence both are accepted and the bench settles it.
static const int IR_TX_GROVE = 10;
static const int IR_TX_GROVE_ALT = 9;
static const uint32_t RMT_TICK_HZ = 1000000;  // 1 tick = 1 us, so durations print as microseconds
static const uint16_t RX_IDLE_US = 20000;     // a frame ends after this much silence (ir_capture used 30 ms)
// The hardware glitch filter counts ticks of the 80 MHz group clock, ceiling 255 (about 3.2 us),
// and rmtSetRxMinThreshold converts our 1 us ticks to ns before IDF checks that ceiling: anything
// above 3 makes rmt_receive fail with INVALID_ARG and the receiver never arms. Real glitch
// handling is fold_glitches() in brx_ir.h (MARK_MIN_US); this only strips sub-microsecond noise.
static const uint8_t RX_FILTER_US = 3;
static const size_t RX_SYMBOLS = 96;          // a 25-bit word is 26 symbols

// ---- persisted settings ---------------------------------------------------------------------- //
Preferences prefs;
struct Settings {
  uint8_t mode = (uint8_t)Mode::BRIDGE;
  uint16_t id = 1;
  uint8_t game = 0;
  uint8_t txpin = IR_TX_ONBOARD;
} settings;

static void loadSettings() {
  prefs.begin("brx", true);
  settings.mode = prefs.getUChar("mode", settings.mode);
  settings.id = prefs.getUShort("id", settings.id);
  settings.game = prefs.getUChar("game", settings.game);
  settings.txpin = prefs.getUChar("txpin", settings.txpin);
  prefs.end();
}
static void saveSettings() {
  prefs.begin("brx", false);
  prefs.putUChar("mode", settings.mode);
  prefs.putUShort("id", settings.id);
  prefs.putUChar("game", settings.game);
  prefs.putUChar("txpin", settings.txpin);
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
bool displayDirty = true;

// ---- IR receive (RMT) ------------------------------------------------------------------------ //
rmt_data_t rxBuf[RX_SYMBOLS];
volatile size_t rxCount = RX_SYMBOLS;  // written by the RX-done ISR
bool rxArmed = false;
uint32_t rxArmFailures = 0;

// Re-arming while a reception is still in flight is refused by the driver (the channel is not
// idle); the frame in flight still completes into rxBuf, so a failed arm is retried from pollRx
// only AFTER any completed frame has been read, never instead of reading it.
static void armRx() {
  rxCount = RX_SYMBOLS;
  rxArmed = rmtReadAsync(IR_RX_PIN, rxBuf, (size_t*)&rxCount);
  if (!rxArmed && ++rxArmFailures == 1) Serial.println("# rx arm refused once (reception in flight); retrying");
}

static bool initRx() {
  if (!rmtInit(IR_RX_PIN, RMT_RX_MODE, RMT_MEM_NUM_BLOCKS_2, RMT_TICK_HZ)) return false;
  rmtSetRxMinThreshold(IR_RX_PIN, RX_FILTER_US);
  rmtSetRxMaxThreshold(IR_RX_PIN, RX_IDLE_US);
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
    if (point.on_word(r.word, millis())) {
      Serial.printf("OWNER team=%d captures=%lu\n", point.owner == TEAM_ANY ? -1 : point.owner,
                    (unsigned long)point.captures);
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

static void sendFrame(const String& bits) {
  if (txPinActive < 0 && !initTx(settings.txpin)) { Serial.println("ERR tx init"); return; }
  pollRx();  // a word that finished before this transmit must not be thrown away with our echo
  std::vector<uint32_t> p = to_pulses(std::string(bits.c_str()));
  static rmt_data_t sym[64];
  size_t n = 0;
  for (size_t i = 0; i + 1 < p.size() && n < 64; i += 2) {
    sym[n].level0 = 1; sym[n].duration0 = p[i];
    sym[n].level1 = 0; sym[n].duration1 = p[i + 1];
    n++;
  }
  if (!rmtWrite(txPinActive, sym, n, 200)) Serial.println("ERR tx write");  // blocking; ~40 ms per word
  lastTxDoneMs = millis();
  lastTxBits = bits;
  // Whatever the receiver caught of our own word is thrown away by re-arming the read.
  delay(2);
  armRx();
}

// ---- BLE advert ------------------------------------------------------------------------------ //
bool advertising = false;
uint32_t advertRetryAt = 0;
static void publishAdvert(const AdvertView& v, uint32_t now) {
  uint8_t seq = policy.published(v, now);
  Advert a;
  a.role = ROLE_STATION;
  a.id = settings.id;
  a.kind = KIND_CONTROL;
  a.team = v.team;
  a.state = v.state;
  a.value = v.value;
  a.seq = seq;
  a.game = settings.game;
  a.threshold = 0;
  String uuid = advert_uuid(a).c_str();
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
  AdvertView v = point.view(now);
  if (!v.active) {
    if (advertising) {
      if (adv) adv->stop();
      advertising = false;
      policy.have_last = false;  // the next live beacon republishes as "first"
      currentUuid = "";
      Serial.println("ADVERT withdrawn (no live beacon)");
      displayDirty = true;
    }
    return;
  }
  if (advertRetryAt && (int32_t)(now - advertRetryAt) < 0) return;
  advertRetryAt = 0;
  if (policy.due(v, now)) publishAdvert(v, now);
}

// ---- display --------------------------------------------------------------------------------- //
static const char* TEAM_NAMES[] = {"RED", "BLUE", "YELLOW", "GREEN"};
static uint16_t teamColor(uint8_t team) {
  switch (team) {
    case 0: return M5.Display.color565(200, 20, 20);
    case 1: return M5.Display.color565(20, 60, 220);
    case 2: return M5.Display.color565(220, 190, 0);
    case 3: return M5.Display.color565(20, 160, 40);
    default: return M5.Display.color565(90, 90, 90);
  }
}

static void paint(uint32_t now) {
  AdvertView v = point.view(now);
  M5.Display.startWrite();
  M5.Display.fillScreen(teamColor(v.team));
  M5.Display.setTextColor(TFT_WHITE, teamColor(v.team));
  M5.Display.setTextDatum(top_left);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(4, 4);
  M5.Display.print(point.mode == Mode::HILL ? "HILL " : "BRIDGE ");
  M5.Display.print(settings.id);
  M5.Display.setTextSize(3);
  M5.Display.setCursor(4, 34);
  M5.Display.print(v.team == TEAM_ANY ? "NEUTRAL" : TEAM_NAMES[v.team & 3]);
  M5.Display.setTextSize(2);
  M5.Display.setCursor(4, 70);
  if (point.mode == Mode::HILL) {
    M5.Display.printf("%u%%", v.value);
  } else {
    M5.Display.print(v.active ? "beacon ok" : (point.heard_beacon ? "beacon LOST, advert off" : "no beacon yet"));
  }
  M5.Display.setTextSize(1);
  M5.Display.setCursor(4, 100);
  M5.Display.printf("words %lu  adv %lu", (unsigned long)wordCount, (unsigned long)advertCount);
  M5.Display.setCursor(4, 112);
  if (lastWordAt) M5.Display.printf("last p%d t%d m%d %lus", lastWord.proto, lastWord.team, lastWord.mag,
                                    (unsigned long)((now - lastWordAt) / 1000));
  M5.Display.setCursor(4, 124);
  M5.Display.printf("tx G%u  %s", settings.txpin,
                    currentUuid.length() >= 20 ? currentUuid.c_str() + 20 : "no advert");
  M5.Display.endWrite();
}

// ---- serial commands ------------------------------------------------------------------------- //
static void printStatus() {
  Serial.printf("STATUS mode=%s owner=%d charges=%lu,%lu,%lu,%lu captures=%lu seq=%u adverts=%lu words=%lu id=%u game=%u txpin=%u uuid=%s\n",
                point.mode == Mode::HILL ? "HILL" : "BRIDGE", point.owner == TEAM_ANY ? -1 : point.owner,
                (unsigned long)point.charge[0], (unsigned long)point.charge[1], (unsigned long)point.charge[2],
                (unsigned long)point.charge[3], (unsigned long)point.captures, policy.seq,
                (unsigned long)advertCount, (unsigned long)wordCount, settings.id, settings.game, settings.txpin,
                currentUuid.c_str());
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
  if (line == "STATUS") { printStatus(); return; }
  if (line == "RESET") { point.reset(); Serial.println("RESET neutral"); displayDirty = true; return; }
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
    settings.txpin = (uint8_t)p;
    saveSettings();
    Serial.printf("TXPIN %u %s\n", settings.txpin, initTx(settings.txpin) ? "ok" : "ERR");
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
static void pollButtons() {
  // Long presses only: a knock on the field must not flip the point or its mode.
  if (M5.BtnA.wasHold()) { point.reset(); Serial.println("RESET neutral (button)"); displayDirty = true; }
  if (M5.BtnB.wasHold()) setMode(point.mode == Mode::HILL ? Mode::BRIDGE : Mode::HILL);
}

// ---- setup / loop ---------------------------------------------------------------------------- //
void setup() {
  auto cfg = M5.config();
  cfg.internal_spk = false;  // the amp interferes with the IR receiver (M5 docs); never bring it up
  cfg.internal_mic = false;
  M5.begin(cfg);
  M5.Speaker.end();
  M5.Display.setRotation(1);  // landscape, 240 x 135
  M5.Display.setBrightness(120);
  Serial.begin(115200);
  delay(300);
  loadSettings();
  point.mode = (Mode)settings.mode;
  Serial.println("# BRX StickS3 station ready (RX G42 via RMT, speaker off).");
  Serial.printf("# mode=%s id=%u game=%u txpin=%u\n", point.mode == Mode::HILL ? "HILL" : "BRIDGE", settings.id,
                settings.game, settings.txpin);
  Serial.println("# Commands: TX <bits> | TXN <n> <bits> | AUTO <bits>|OFF | PING | STATUS | MODE BRIDGE|HILL | ID <n> | GAME <n> | TXPIN 46|9|10 | RESET | r s c");
  if (!initRx()) Serial.println("ERR rx init (RMT)");
  if (!initTx(settings.txpin)) Serial.println("ERR tx init (RMT)");
  initBle();
  pollAdvert(millis());  // HILL advertises at once; BRIDGE waits for its first live beacon
}

void loop() {
  M5.update();
  uint32_t now = millis();
  pollRx();
  pollSerial();
  pollButtons();
  pollAdvert(now);
  if (point.mode == Mode::HILL && now - lastBeaconTxMs >= BEACON_PERIOD_MS) {
    lastBeaconTxMs = now;
    sendFrame(String(encode(point.beacon_word()).c_str()));
  }
  if (autoBits.length() && now - lastAutoMs >= AUTO_TX_INTERVAL_MS) {
    lastAutoMs = now;
    sendFrame(autoBits);
  }
  static uint32_t lastPaint = 0;
  if (displayDirty || now - lastPaint > 1000) {
    paint(now);
    lastPaint = now;
    displayDirty = false;
  }
  delay(2);
}
