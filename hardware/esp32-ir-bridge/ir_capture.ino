/*
 * BRX IR capture — ESP32-S3 + VS1838B receiver.
 *
 * Phase A of hardware/ir-prototype-plan.md: decode the 25-bit BRX IR frames a
 * stock gun / grenade emits (followup B13 — the Utility Box's gating unknown).
 *
 * Approach: the VS1838B demodulates the 38 kHz carrier and drives its OUT pin
 * LOW while a burst is present (active-low, idles HIGH). We interrupt on every
 * edge, timestamp with micros(), and after an idle gap dump the pulse train +
 * a decode attempt over USB serial. Raw edges (not a library) so we see the
 * exact waveform and can match it to the known BRX timing.
 *
 * Known BRX encoding (LaserTagMods, docs/reference/lasertagmods.md):
 *   25-bit, 38 kHz carrier; logic-1 ≈ 1000 us mark, logic-0 ≈ 500 us mark,
 *   ~500 us inter-bit space; a start bit opens the frame.
 *
 * Wiring (ESP32-S3-DevKitC-1, N16R8 — avoids the octal-PSRAM pins 33–37 and
 * the SPI-flash pins 26–32):
 *   VS1838B  OUT -> GPIO 4      VCC -> 3V3      GND -> GND
 *   (a 0.1 uF cap across VCC/GND is recommended — the Elegoo kit has them)
 *
 * Serial: 115200 baud. Output is line-based so the brx-mcp `ir_capture` tool can
 * parse it. Send 's' to print stats, 'c' to clear.
 */

#include <Arduino.h>

static const int IR_RX_PIN = 4;          // VS1838B OUT
static const int STATUS_LED = 6;          // visible LED — blinks when a frame is RECEIVED
static const uint32_t IDLE_GAP_US = 8000; // frame ends after this much silence
                                          // (shots closer than this fuse into one
                                          //  capture — fine for single shots; watch
                                          //  on burst-fire, lower it if two merge)
static const size_t MAX_EDGES = 256;      // plenty for a 25-bit frame (~51 edges)

// ---- edge capture (ISR-filled ring) ---------------------------------------- //
volatile uint32_t edges[MAX_EDGES];       // micros() timestamps of each edge
volatile size_t edgeCount = 0;
volatile uint32_t lastEdgeUs = 0;
volatile bool overflow = false;

void IRAM_ATTR onEdge() {
  uint32_t now = micros();
  lastEdgeUs = now;
  if (edgeCount < MAX_EDGES) {
    edges[edgeCount++] = now;
  } else {
    overflow = true;
  }
}

// ---- decode: durations -> bits --------------------------------------------- //
// A "mark" is the LOW burst (VS1838B active-low). We measure LOW-duration =
// carrier-present. long(~1000us)=1, short(~500us)=0. Tunable thresholds.
static const uint32_t MARK_THRESH_US = 750;   // > this = logic 1
static const uint32_t MARK_MIN_US    = 200;   // ignore glitches below this
static const uint32_t SYNC_MIN_US    = 1500;  // a mark >= this is the ~2ms frame sync — strip it

uint32_t frameCount = 0;
uint32_t ledOffAtMs = 0;                 // non-blocking status-LED hold
static const uint32_t LED_HOLD_MS = 40;  // visible blink length per received frame

// slice a big-endian bit range out of the decoded string (per brx-ir-protocol.md)
static int bitsVal(const String& s, int lo, int hi) {
  int v = 0;
  for (int i = lo; i < hi && i < (int)s.length(); i++) v = (v << 1) | (s[i] == '1' ? 1 : 0);
  return v;
}

void printFrame() {
  size_t n;
  uint32_t buf[MAX_EDGES];
  noInterrupts();
  n = edgeCount;
  for (size_t i = 0; i < n; i++) buf[i] = edges[i];
  bool ov = overflow;
  edgeCount = 0;
  overflow = false;
  interrupts();

  if (n < 4) return;  // noise, not a frame

  digitalWrite(STATUS_LED, HIGH);  // visible "got a frame" blink
  ledOffAtMs = millis() + LED_HOLD_MS;
  frameCount++;
  // durations between edges
  Serial.print("RAW ");
  Serial.print(frameCount);
  Serial.print(" edges=");
  Serial.print(n);
  if (ov) Serial.print(" (OVERFLOW)");
  Serial.print(" us=[");
  // The pin idles HIGH; first edge is HIGH->LOW (mark begins). So durations
  // alternate LOW(mark), HIGH(space), LOW(mark)... starting with a mark.
  for (size_t i = 1; i < n; i++) {
    uint32_t d = buf[i] - buf[i - 1];
    if (i > 1) Serial.print(",");
    Serial.print(d);
  }
  Serial.println("]");

  // decode: marks are the 1st,3rd,5th... gaps. The FIRST mark is the ~2 ms sync —
  // strip it (>= SYNC_MIN_US), then long(>750)=1 / short=0 for the 25 payload bits.
  String bits = "";
  int nbits = 0;
  for (size_t i = 1; i < n; i += 2) {
    uint32_t mark = buf[i] - buf[i - 1];
    if (mark >= SYNC_MIN_US) continue;          // sync or stray long pulse — not a bit
    if (mark < MARK_MIN_US) continue;           // glitch
    bits += (mark > MARK_THRESH_US) ? '1' : '0';
    nbits++;
  }
  Serial.print("DECODE bits=");
  Serial.print(nbits);
  Serial.print(" val=");
  Serial.println(bits);
  // field decode per protocol/brx-ir-protocol.md: B4 P6 T2 D8 C1 U2 Z2 (25 bits)
  if (nbits >= 25) {
    char z0 = bits[23], z1 = bits[24];
    Serial.print("SHOT player="); Serial.print(bitsVal(bits, 4, 10));
    Serial.print(" team=");       Serial.print(bitsVal(bits, 10, 12));
    Serial.print(" dmg=");        Serial.print(bitsVal(bits, 12, 20));
    Serial.print(" bullet=");     Serial.print(bitsVal(bits, 0, 4));
    Serial.print(" crit=");       Serial.print(bitsVal(bits, 20, 21));
    Serial.print(" parityOK=");   Serial.println(z0 != z1 ? 1 : 0);
  }
  // LED is turned off by the non-blocking timer in loop() (LED_HOLD_MS later)
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(IR_RX_PIN, INPUT);
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);
  attachInterrupt(digitalPinToInterrupt(IR_RX_PIN), onEdge, CHANGE);
  Serial.println("# BRX IR capture ready (ESP32-S3, VS1838B on GPIO4).");
  Serial.println("# Fire a gun / trigger a grenade at the receiver. Frames stream below.");
}

void loop() {
  // frame complete when the line has been idle for IDLE_GAP_US with edges buffered
  if (edgeCount > 0 && (micros() - lastEdgeUs) > IDLE_GAP_US) {
    printFrame();
  }
  // non-blocking status-LED off
  if (ledOffAtMs && millis() >= ledOffAtMs) {
    digitalWrite(STATUS_LED, LOW);
    ledOffAtMs = 0;
  }
  // simple serial commands
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 's') { Serial.print("# frames="); Serial.println(frameCount); }
    else if (c == 'c') { frameCount = 0; Serial.println("# cleared"); }
  }
}
