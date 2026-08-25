/*
 * BRX IR emit — ESP32-S3 + 940 nm IR LED (via NPN transistor).
 *
 * Phase B of hardware/ir-prototype-plan.md: replay a captured 25-bit BRX frame
 * and confirm a stock gun reacts (registers a $HIR). Once this works, the box
 * can emit any capture/respawn/perk tag — the Utility Box emit side.
 *
 * Carrier: LEDC PWM at 38 kHz, 50% duty, gated on/off for mark/space timing.
 * Timing constants below are the LaserTagMods defaults (1000/500 us) — TUNE them
 * to whatever ir_capture.ino actually recorded before expecting a gun to react.
 *
 * Wiring (ESP32-S3-DevKitC-1, N16R8):
 *   GPIO 5 ── 330 Ω ── NPN base (2N2222, ELEGOO kit)
 *   IR LED anode ── 3V3 (or +5V from the breadboard power module) ── ~100 Ω ── collector
 *   NPN emitter ── GND
 *   (drive via transistor for range; a bare GPIO→LED works at a few cm only)
 *
 * Serial (115200), line-based commands (the brx-mcp `ir_emit` tool speaks these):
 *   TX <bits>        emit one frame (bits like 1010...; up to ~40 chars)
 *   TXN <n> <bits>   emit the frame n times (burst)
 *   PING             -> "PONG"
 *
 * NOTE: arduino-esp32 v3.x LEDC API (ledcAttach/ledcWrite by PIN). If you're on
 * v2.x, swap to ledcSetup()+ledcAttachPin()+ledcWrite(channel,...).
 */

#include <Arduino.h>

static const int  IR_TX_PIN     = 5;
static const int  STATUS_LED    = 6;     // visible LED — lights while a frame is emitted
static const int  CARRIER_HZ    = 38000;
static const int  CARRIER_RES   = 8;     // 8-bit duty
static const int  CARRIER_DUTY  = 128;   // ~50%
static const uint32_t LED_HOLD_MS = 40;  // keep the visible LED on this long (so it's obvious)

// --- BRX timing (TUNE to your captured frames) ------------------------------ //
static uint32_t MARK_ONE   = 1000;  // logic 1 mark (us)
static uint32_t MARK_ZERO  = 500;   // logic 0 mark (us)
static uint32_t BIT_SPACE  = 500;   // inter-bit space (us)
static uint32_t START_MARK = 2000;  // ~2 ms sync mark — REQUIRED: a stock gun drops a
static uint32_t START_SPACE = 500;  // sync-less frame (decoders gate on pulseIn(LOW)>1500us).

inline void carrierOn()  { ledcWrite(IR_TX_PIN, CARRIER_DUTY); }
inline void carrierOff() { ledcWrite(IR_TX_PIN, 0); }

void mark(uint32_t us)  { carrierOn();  delayMicroseconds(us); carrierOff(); }
void space(uint32_t us) { delayMicroseconds(us); }

void sendFrame(const String& bits) {
  digitalWrite(STATUS_LED, HIGH);  // visible "transmitting" indicator
  // NB: no frame-long noInterrupts() — the 38 kHz carrier is hardware (LEDC) and
  // delayMicroseconds() is a cycle-count busy-wait, so both work with interrupts
  // enabled; holding them off for a whole ~37 ms frame starves the other core /
  // risks the interrupt WDT on TXN bursts. VS1838B tolerates the small jitter.
  if (START_MARK) { mark(START_MARK); if (START_SPACE) space(START_SPACE); }
  for (size_t i = 0; i < bits.length(); i++) {
    mark(bits[i] == '1' ? MARK_ONE : MARK_ZERO);
    space(BIT_SPACE);
  }
  delay(LED_HOLD_MS);              // hold the LED so a single frame is clearly visible
  digitalWrite(STATUS_LED, LOW);
}

String buf;

void handleLine(String line) {
  line.trim();
  if (line == "PING") { Serial.println("PONG"); return; }
  if (line.startsWith("TX ")) {
    String bits = line.substring(3); bits.trim();
    sendFrame(bits);
    Serial.print("SENT bits="); Serial.println(bits.length());
    return;
  }
  if (line.startsWith("TXN ")) {
    int sp = line.indexOf(' ', 4);
    if (sp < 0) { Serial.println("ERR TXN"); return; }
    int n = line.substring(4, sp).toInt();
    String bits = line.substring(sp + 1); bits.trim();
    for (int i = 0; i < n; i++) { sendFrame(bits); delay(20); }
    Serial.print("SENT n="); Serial.print(n);
    Serial.print(" bits="); Serial.println(bits.length());
    return;
  }
  if (line.length()) Serial.println("ERR unknown");
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);
  ledcAttach(IR_TX_PIN, CARRIER_HZ, CARRIER_RES);  // v3.x API
  carrierOff();
  Serial.println("# BRX IR emit ready (ESP32-S3, IR LED on GPIO5).");
  Serial.println("# Commands: TX <bits> | TXN <n> <bits> | PING");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') { if (buf.length()) { handleLine(buf); buf = ""; } }
    else if (buf.length() < 128) buf += c;   // cap: never grow unbounded on a line with no newline
    else buf = "";
  }
}
