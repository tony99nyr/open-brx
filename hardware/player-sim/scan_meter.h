// scan_meter.h - SCAN <mac> <secs>: measure one advertiser's packet gaps (F353, the Stick's advert gaps).
//
// Why raw NimBLE and not the core's BLEScan: on NimBLE, BLEScan keeps ONE BLEAdvertisedDevice per address
// for the whole scan (m_maxResults defaults to 0xFF), appends every packet's payload to it and pushes every
// packet's UUID onto m_serviceUUIDs; getServiceUUID() returns front(), the FIRST UUID of the scan. A long
// scan through it would never see a republish. ble_gap_disc() hands over each packet's own bytes instead.
//
// The scan is passive and continuous (interval = window = 100 ms), duplicates reported. The host task's
// callback only stamps micros() into a buffer; loop() prints the report once the scan completes.
#pragma once
#include <Arduino.h>
#include <algorithm>

#if defined(CONFIG_NIMBLE_ENABLED)
#include <host/ble_gap.h>
#include <host/ble_hs.h>
#endif

namespace meter {

constexpr uint32_t MAX_PACKETS = 30000;  // 120 KB of stamps: 50 min of a 100 ms advertiser
constexpr uint32_t MAX_SECS = 3600;
constexpr int MAX_CHANGES = 64;

struct UuidChange { uint32_t at_us; uint8_t uuid[16]; bool none; };

uint8_t target[6];           // little-endian, as ble_addr_t.val holds it
uint32_t* stamps = nullptr;
volatile uint32_t count = 0;
volatile uint32_t overflow = 0;
volatile bool running = false;
volatile bool done = false;
uint32_t startUs = 0, endUs = 0, secsAsked = 0;
UuidChange changes[MAX_CHANGES];
volatile int nChanges = 0;
volatile uint32_t lostChanges = 0;
uint8_t lastUuid[16];
bool haveLast = false, lastNone = false;

// "aa:bb:cc:dd:ee:ff" (either case) -> val[5..0].
inline bool parseMac(const char* s, uint8_t out[6]) {
  unsigned v[6];
  if (sscanf(s, "%2x:%2x:%2x:%2x:%2x:%2x", &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]) != 6) return false;
  if (strlen(s) != 17) return false;
  for (int i = 0; i < 6; i++) out[5 - i] = (uint8_t)v[i];
  return true;
}

// The first 128-bit service UUID (AD type 0x06 or 0x07) in one packet, reversed into string order.
inline bool findUuid128(const uint8_t* d, uint8_t len, uint8_t out[16]) {
  uint8_t i = 0;
  while (i + 1 < len) {
    uint8_t l = d[i];
    if (l == 0 || i + 1 + l > len) return false;
    uint8_t type = d[i + 1];
    if ((type == 0x06 || type == 0x07) && l >= 17) {
      for (int k = 0; k < 16; k++) out[k] = d[i + 2 + 15 - k];  // on air little-endian
      return true;
    }
    i += 1 + l;
  }
  return false;
}

inline void uuidString(const uint8_t b[16], char s[37]) {
  snprintf(s, 37, "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
}

#if defined(CONFIG_NIMBLE_ENABLED)
inline int onGap(struct ble_gap_event* ev, void*) {
  if (ev->type == BLE_GAP_EVENT_DISC_COMPLETE) {
    endUs = micros();
    running = false;
    done = true;
    return 0;
  }
  if (ev->type != BLE_GAP_EVENT_DISC) return 0;
  if (memcmp(ev->disc.addr.val, target, 6) != 0) return 0;
  uint32_t now = micros();
  if (count < MAX_PACKETS) stamps[count++] = now; else overflow++;
  uint8_t u[16];
  bool has = findUuid128(ev->disc.data, ev->disc.length_data, u);
  bool changed = !haveLast || has == lastNone || (has && memcmp(u, lastUuid, 16) != 0);
  if (changed) {
    haveLast = true;
    lastNone = !has;
    if (has) memcpy(lastUuid, u, 16);
    if (nChanges < MAX_CHANGES) {
      UuidChange& c = changes[nChanges];
      c.at_us = now; c.none = !has;
      if (has) memcpy(c.uuid, u, 16);
      nChanges++;
    } else {
      lostChanges++;
    }
  }
  return 0;
}
#endif

// Start a scan. The caller has already stopped advertising.
inline bool start(const char* mac, long secs) {
#if defined(CONFIG_NIMBLE_ENABLED)
  if (running) { Serial.println("ERR scan already running"); return false; }
  if (!parseMac(mac, target) || secs < 1 || secs > (long)MAX_SECS) {
    Serial.printf("ERR usage: SCAN <aa:bb:cc:dd:ee:ff> <secs 1-%lu>\n", (unsigned long)MAX_SECS);
    return false;
  }
  if (!stamps) stamps = (uint32_t*)malloc(MAX_PACKETS * sizeof(uint32_t));
  if (!stamps) { Serial.println("ERR no memory for the scan buffer"); return false; }
  count = 0; overflow = 0; nChanges = 0; lostChanges = 0; haveLast = false; done = false;
  secsAsked = (uint32_t)secs;
  struct ble_gap_disc_params p = {};
  p.itvl = 160;    // 100 ms in 0.625 ms units
  p.window = 160;  // window = interval: continuous
  p.filter_policy = 0;
  p.limited = 0;
  p.passive = 1;
  p.filter_duplicates = 0;
  running = true;
  startUs = micros();
  int rc = ble_gap_disc(BLE_OWN_ADDR_PUBLIC, (int32_t)(secs * 1000), &p, onGap, nullptr);
  if (rc != 0) {
    running = false;
    Serial.printf("ERR scan start rc=%d\n", rc);
    return false;
  }
  Serial.printf("SCAN start mac=%s secs=%ld t=%lu\n", mac, secs, (unsigned long)millis());
  return true;
#else
  (void)mac; (void)secs;
  Serial.println("ERR SCAN needs the NimBLE stack");
  return false;
#endif
}

inline void cancel() {
#if defined(CONFIG_NIMBLE_ENABLED)
  if (!running) return;
  ble_gap_disc_cancel();  // no DISC_COMPLETE event follows a cancel
  endUs = micros();
  running = false;
  done = true;
  Serial.println("SCAN cancelled");
#endif
}

inline float ms(uint32_t us) { return us / 1000.0f; }

// Print the report once, after the scan completes or is cancelled.
inline void report() {
  if (!done) return;
  done = false;
  uint32_t n = count;
  Serial.printf("SCAN done packets=%lu overflow=%lu secs=%.1f\n", (unsigned long)n, (unsigned long)overflow,
                ms(endUs - startUs) / 1000.0f);
  if (n > 0) {
    Serial.printf("SCAN first_after_ms=%.1f last_before_end_ms=%.1f\n", ms(stamps[0] - startUs),
                  ms(endUs - stamps[n - 1]));
  }
  if (n >= 2) {
    const uint32_t m = n - 1;
    uint32_t topGap[5] = {0}, topAt[5] = {0};
    uint32_t over250 = 0, over1s = 0, over4s = 0;
    for (uint32_t i = 0; i < m; i++) {
      uint32_t g = stamps[i + 1] - stamps[i];
      if (g > 250000) over250++;
      if (g > 1000000) over1s++;
      if (g > 4000000) over4s++;
      for (int k = 0; k < 5; k++) {
        if (g > topGap[k]) {
          for (int j = 4; j > k; j--) { topGap[j] = topGap[j - 1]; topAt[j] = topAt[j - 1]; }
          topGap[k] = g; topAt[k] = stamps[i] - startUs;
          break;
        }
      }
      stamps[i] = g;  // in place: stamps[i + 1] is still read before it is overwritten
    }
    std::sort(stamps, stamps + m);
    auto pct = [&](float p) { uint32_t i = (uint32_t)ceilf(p * m); return stamps[i ? i - 1 : 0]; };
    Serial.printf("SCAN gap_ms median=%.1f p90=%.1f p99=%.1f max=%.1f\n", ms(pct(0.5f)), ms(pct(0.9f)),
                  ms(pct(0.99f)), ms(stamps[m - 1]));
    Serial.printf("SCAN gaps_over_250ms=%lu over_1s=%lu over_4s=%lu\n", (unsigned long)over250,
                  (unsigned long)over1s, (unsigned long)over4s);
    for (int k = 0; k < 5 && topGap[k]; k++) {
      Serial.printf("SCAN top%d gap_ms=%.1f starts_at_ms=%.1f\n", k + 1, ms(topGap[k]), ms(topAt[k]));
    }
  }
  int c = nChanges;
  for (int i = 0; i < c; i++) {
    char s[37];
    if (changes[i].none) strcpy(s, "none");
    else uuidString(changes[i].uuid, s);
    Serial.printf("SCAN uuid at_ms=%.1f %s\n", ms(changes[i].at_us - startUs), s);
  }
  if (lostChanges) Serial.printf("SCAN uuid_changes_not_listed=%lu\n", (unsigned long)lostChanges);
  Serial.println("SCAN end");
}

}  // namespace meter
