// brx_advert.h - the Open BRX station advert: one 128-bit service UUID.
//
// Exact port of app/src/beacon.js encodeUuid() (docs/spec/utility.md section 2) so a phone HUD
// decodes a Stick the same way it decodes a phone station. Pure C++17, header-only. The three
// expected strings in test/test_core.cpp were produced by running the JS encoder.
#pragma once
#include <cstdint>
#include <cstdio>
#include <string>

namespace brx {

constexpr uint8_t ADVERT_VERSION = 1;
constexpr uint8_t ROLE_STATION = 1;
constexpr uint8_t ROLE_PLAYER = 2;
constexpr uint8_t KIND_RESPAWN = 1, KIND_POWERUP = 2, KIND_EXTRACTION = 3, KIND_BOMB = 4, KIND_CONTROL = 5;
constexpr uint8_t TEAM_ANY = 255;  // neutral / any team
// CONTROL_STATE bits (app/src/control.js).
constexpr uint8_t CONTROL_HELD = 1, CONTROL_CONTESTED = 2, CONTROL_RISING = 4, CONTROL_FALLING = 8;

struct Advert {
  uint8_t role = ROLE_STATION;
  uint16_t id = 0;
  uint8_t kind = 0;
  uint8_t team = TEAM_ANY;
  uint8_t state = 0;
  uint8_t value = 0;
  uint8_t seq = 0;
  uint8_t game = 0;
  int threshold = 0;  // dBm, int8 on the wire, 0 = scanner default
};

inline void advert_bytes(const Advert& a, uint8_t out[16]) {
  int thr = 0;
  if (a.threshold) thr = a.threshold < 0 ? 256 + (a.threshold < -128 ? -128 : a.threshold)
                                         : (a.threshold > 127 ? 127 : a.threshold);
  const uint8_t b[16] = {0x4f, 0x42, 0x52, 0x58, ADVERT_VERSION, a.role,
                         (uint8_t)(a.id >> 8), (uint8_t)(a.id & 0xff), a.kind, a.team,
                         a.state, a.value, a.seq, a.game, (uint8_t)(thr & 0xff), 0};
  for (int i = 0; i < 16; i++) out[i] = b[i];
}

// "4f425258-0101-0001-0500-01280307b600": bytes in order, lower-case hex, 8-4-4-4-12.
inline std::string advert_uuid(const Advert& a) {
  uint8_t b[16];
  advert_bytes(a, b);
  char s[37];
  std::snprintf(s, sizeof s,
                "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
                b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12],
                b[13], b[14], b[15]);
  return s;
}

// What the advert says about the point; the republish policy compares these three.
struct AdvertView {
  uint8_t team = TEAM_ANY;
  uint8_t state = 0;
  uint8_t value = 0;
  bool active = true;  // false: say nothing (a BRIDGE with no live grenade has no owner to report)
};

// Port of control.js ControlAdvertiser: owner/state changes republish at once, a value-only
// change waits out `min_interval_ms`, and `seq` bumps on every publish so a scanner tells
// fresh from stale.
struct AdvertPolicy {
  uint32_t min_interval_ms = 1000;
  uint8_t seq = 0;
  bool have_last = false;
  AdvertView last;
  uint32_t last_at = 0;

  // "first" | "state" | "progress" | nullptr (keep the current advert).
  const char* due(const AdvertView& v, uint32_t now) const {
    if (!have_last) return "first";
    if (last.team != v.team || last.state != v.state) return "state";
    if (last.value != v.value && (now - last_at) >= min_interval_ms) return "progress";
    return nullptr;
  }
  uint8_t published(const AdvertView& v, uint32_t now) {
    seq = (uint8_t)(seq + 1);
    last = v;
    have_last = true;
    last_at = now;
    return seq;
  }
};

}  // namespace brx
