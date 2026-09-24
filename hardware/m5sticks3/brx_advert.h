// brx_advert.h - the Open BRX station advert: one 128-bit service UUID.
//
// Exact port of app/src/beacon.js encodeUuid() (docs/spec/utility.md section 2) so a phone HUD
// decodes a Stick the same way it decodes a phone station. Pure C++17, header-only. The three
// expected strings in test/test_core.cpp were produced by running the JS encoder.
#pragma once
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace brx {

constexpr uint8_t ADVERT_VERSION = 1;
constexpr uint8_t ROLE_STATION = 1;
constexpr uint8_t ROLE_PLAYER = 2;
constexpr uint8_t KIND_RESPAWN = 1, KIND_POWERUP = 2, KIND_EXTRACTION = 3, KIND_BOMB = 4, KIND_CONTROL = 5;
constexpr uint8_t TEAM_ANY = 255;  // neutral / any team
// CONTROL_STATE bits (app/src/control.js).
constexpr uint8_t CONTROL_HELD = 1, CONTROL_CONTESTED = 2, CONTROL_RISING = 4, CONTROL_FALLING = 8;
// A56 powerup CLAIM (confirmed 2026-09-24): bits a PLAYER'S OWN advert sets in its `state` byte
// while claiming a powerup station. `value` on that same advert is the target station id (1..255);
// `id` is the player's own number (1..63). The Stick only ever SCANS for these; it never sets them.
constexpr uint8_t PLAYER_CLAIMING = 16, PLAYER_CLAIM_READY = 32;

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
  uint8_t taker = 0;  // A56: a powerup's current holder, player_num 1..63, 0 = none
};

inline void advert_bytes(const Advert& a, uint8_t out[16]) {
  int thr = 0;
  if (a.threshold) thr = a.threshold < 0 ? 256 + (a.threshold < -128 ? -128 : a.threshold)
                                         : (a.threshold > 127 ? 127 : a.threshold);
  const uint8_t b[16] = {0x4f, 0x42, 0x52, 0x58, ADVERT_VERSION, a.role,
                         (uint8_t)(a.id >> 8), (uint8_t)(a.id & 0xff), a.kind, a.team,
                         a.state, a.value, a.seq, a.game, (uint8_t)(thr & 0xff), a.taker};
  for (int i = 0; i < 16; i++) out[i] = b[i];
}

// The reverse of advert_uuid(): decode a 128-bit service UUID string (lower-case, dashed, exactly
// what a BLE scan hands back from `BLEUUID::toString()`) into an Advert. False on anything that is
// not one of ours (wrong length, wrong magic) -- a scan hears every BLE device in range, not just
// BRX ones, and this must never crash or misparse a stranger's UUID into a false claim.
inline bool decode_advert(const std::string& uuid, Advert& out) {
  if (uuid.size() != 36) return false;
  uint8_t b[16];
  int pos = 0;
  for (size_t i = 0; i < uuid.size();) {
    if (uuid[i] == '-') { i++; continue; }
    if (i + 1 >= uuid.size() || pos >= 16) return false;
    if (!isxdigit((unsigned char)uuid[i]) || !isxdigit((unsigned char)uuid[i + 1])) return false;
    char hex[3] = {uuid[i], uuid[i + 1], 0};
    b[pos++] = (uint8_t)strtol(hex, nullptr, 16);
    i += 2;
  }
  if (pos != 16) return false;
  if (b[0] != 0x4f || b[1] != 0x42 || b[2] != 0x52 || b[3] != 0x58) return false;  // "OBRX"
  out = Advert();
  out.role = b[5];
  out.id = (uint16_t)((b[6] << 8) | b[7]);
  out.kind = b[8];
  out.team = b[9];
  out.state = b[10];
  out.value = b[11];
  out.seq = b[12];
  out.game = b[13];
  out.threshold = (b[14] >= 128) ? (int)b[14] - 256 : (int)b[14];
  out.taker = b[15];
  return true;
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
  uint8_t taker = 0;   // A56: a powerup's current holder; 0 on every other kind
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
