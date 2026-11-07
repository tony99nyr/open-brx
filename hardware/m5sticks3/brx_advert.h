// brx_advert.h - the Open BRX station advert: one 128-bit service UUID.
//
// Exact port of app/src/beacon.js encodeUuid() (docs/spec/utility.md section 2) so a phone HUD
// decodes a Stick the same way it decodes a phone station. Pure C++17, header-only. The three
// expected strings in test/test_core.cpp were produced by running the JS encoder.
#pragma once
#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>

#include "contract.gen.h"

namespace brx {

constexpr uint8_t station_kind_code(size_t index) {
  return index < contract::STATION_KINDS_COUNT ? (uint8_t)(index + 1) : 0;
}
constexpr uint8_t KIND_RESPAWN = station_kind_code(0), KIND_POWERUP = station_kind_code(1),
                  KIND_EXTRACTION = station_kind_code(2), KIND_BOMB = station_kind_code(3),
                  KIND_CONTROL = station_kind_code(4);
// The advert kind byte is a wire value the phone reads by its own KIND table (beacon.js): a reordered STATION_KINDS
// must fail the build, so each name is checked at the index its byte comes from.
constexpr bool kind_name_is(size_t index, const char* want) {
  const char* got = contract::STATION_KINDS[index];
  size_t i = 0;
  for (; got[i] && want[i]; ++i) if (got[i] != want[i]) return false;
  return got[i] == want[i];
}
static_assert(kind_name_is(KIND_RESPAWN - 1, "respawn") && kind_name_is(KIND_POWERUP - 1, "powerup") &&
              kind_name_is(KIND_EXTRACTION - 1, "extraction") && kind_name_is(KIND_BOMB - 1, "bomb") &&
              kind_name_is(KIND_CONTROL - 1, "control"),
              "advert kind bytes moved: STATION_KINDS order is wire-visible");
// A56 powerup CLAIM (confirmed 2026-09-24): bits a PLAYER'S OWN advert sets in its `state` byte
// while claiming a powerup station. `value` on that same advert is the target station id (1..255);
// `id` is the player's own number (1..63). The Stick only ever SCANS for these; it never sets them.
// A player advert's state bit6 (Tony, 2026-09-24; reserved by brx5): "I was just revived at the station whose id
// is in the value byte", held ~5 s by the phone after a station revive. A station counts a revive on its rising
// edge with value == its own id: no RSSI, and it works off Wi-Fi (MUSTER).

struct Advert {
  uint8_t role = contract::ADVERT_ROLE_STATION;
  uint16_t id = 0;
  uint8_t kind = 0;
  uint8_t team = contract::STATION_TEAM_ANY;
  uint8_t state = 0;
  uint8_t value = 0;
  uint8_t seq = 0;
  uint8_t game = 0;
  int threshold = 0;  // dBm, int8 on the wire, 0 = scanner default
  uint8_t taker = 0;  // A56: a powerup's current holder, player_num 1..63, 0 = none
  // F658 (A86): a PLAYER's scope. Byte 8 is the kind mask (ADVERT_SCOPE_KIND_*), bytes 6 (high) and 15 (low) the
  // 16-bit map of the station ids in the player's match, bit (id % 16). A player's id is byte 7 alone. 0 on a station.
  uint8_t scope_kinds = 0;
  uint16_t scope = 0;
};

// A86: may the station of scope kind `kind_bit` (ADVERT_SCOPE_KIND_*) and id `station_id` count this player? Only with
// its own kind bit and its own id bit set (beacon.js inScope). A zero scope (an older APK) or station id 0 never counts.
inline bool in_scope(uint8_t scope_kinds, uint16_t scope, int kind_bit, int station_id) {
  if (station_id < 1 || !(scope_kinds & kind_bit)) return false;
  return (scope >> (station_id % contract::ADVERT_SCOPE_ID_BITS)) & 1;
}

inline void advert_bytes(const Advert& a, uint8_t out[16]) {
  int thr = 0;
  if (a.threshold) thr = a.threshold < 0 ? 256 + (a.threshold < -128 ? -128 : a.threshold)
                                         : (a.threshold > 127 ? 127 : a.threshold);
  // A86: a player's bytes 6, 8 and 15 carry its scope
  const bool player = a.role == contract::ADVERT_ROLE_PLAYER;
  const uint8_t b[16] = {contract::ADVERT_MAGIC[0], contract::ADVERT_MAGIC[1], contract::ADVERT_MAGIC[2], contract::ADVERT_MAGIC[3],
                         contract::ADVERT_VERSION, a.role,
                         (uint8_t)(player ? a.scope >> 8 : a.id >> 8), (uint8_t)(a.id & 0xff), player ? a.scope_kinds : a.kind, a.team,
                         a.state, a.value, a.seq, a.game, (uint8_t)(thr & 0xff), player ? (uint8_t)(a.scope & 0xff) : a.taker};
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
  for (size_t i = 0; i < contract::ADVERT_MAGIC_COUNT; i++)
    if (b[i] != contract::ADVERT_MAGIC[i]) return false;  // "OBRX"
  if (b[4] != contract::ADVERT_VERSION) return false;  // beacon.js decodeUuid: a wrong version is not ours
  if (b[5] != contract::ADVERT_ROLE_STATION && b[5] != contract::ADVERT_ROLE_PLAYER) return false;  // ... nor is an unknown role
  out = Advert();
  out.role = b[5];
  out.id = (uint16_t)((b[6] << 8) | b[7]);
  out.kind = b[8];
  if (out.role == contract::ADVERT_ROLE_PLAYER) {  // A86: the player id is byte 7 alone; bytes 6, 8 and 15 are its scope
    out.id = b[7];
    out.kind = 0;
    out.scope_kinds = b[8];
    out.scope = (uint16_t)((b[6] << 8) | b[15]);
  }
  out.team = b[9];
  out.state = b[10];
  out.value = b[11];
  out.seq = b[12];
  out.game = b[13];
  out.threshold = (b[14] >= 128) ? (int)b[14] - 256 : (int)b[14];
  out.taker = out.role == contract::ADVERT_ROLE_PLAYER ? 0 : b[15];
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

// ---- A88 (Tony 2026-11-07): the hill's Domination tally and the player's end info (beacon.js encodeTally/endAgeCode) ----
// The tally is the 6-byte payload of a manufacturer-data field (company ADVERT_TALLY_COMPANY) beside the UUID: the game
// byte; flags (bit 0 final, bit 1 partial, high nibble ADVERT_TALLY_FORMAT); two big-endian u16 slots `tid << 14 | s`,
// the two tids with the most own_ms whole seconds (then the lower tid), capped at ADVERT_TALLY_SECS_MAX. An empty slot is 0.
struct TallyView {
  uint8_t game = 0;
  bool final = false;
  uint32_t own_ms[4] = {0, 0, 0, 0};
};
inline void encode_tally(const TallyView& t, uint8_t out[6]) {
  int tid[4], secs[4], n = 0;
  for (int k = 0; k < 4; k++) {
    const uint32_t s = std::min<uint32_t>((uint32_t)contract::ADVERT_TALLY_SECS_MAX, t.own_ms[k] / 1000);
    if (s > 0) { tid[n] = k; secs[n] = (int)s; n++; }
  }
  for (int i = 1; i < n; i++) {  // insertion sort: seconds descending, stable on the ascending tid order above
    const int a = tid[i], b = secs[i];
    int j = i - 1;
    while (j >= 0 && secs[j] < b) { tid[j + 1] = tid[j]; secs[j + 1] = secs[j]; j--; }
    tid[j + 1] = a; secs[j + 1] = b;
  }
  out[0] = t.game;
  out[1] = (uint8_t)((contract::ADVERT_TALLY_FORMAT << 4) | (t.final ? 1 : 0) | (n > 2 ? 2 : 0));
  for (int i = 0; i < 2; i++) {
    const uint16_t v = i < n ? (uint16_t)((tid[i] << 14) | secs[i]) : 0;
    out[2 + 2 * i] = (uint8_t)(v >> 8);
    out[3 + 2 * i] = (uint8_t)(v & 0xff);
  }
}
// The reverse (beacon.js decodeTally), for the tests: false when it is not a format-1 tally. `own_s` per tid, 0 = none.
inline bool decode_tally(const uint8_t b[6], uint8_t& game, bool& final, bool& partial, uint32_t own_s[4]) {
  if ((b[1] >> 4) != contract::ADVERT_TALLY_FORMAT) return false;
  game = b[0];
  final = b[1] & 1;
  partial = (b[1] & 2) != 0;
  for (int k = 0; k < 4; k++) own_s[k] = 0;
  for (int i = 2; i <= 4; i += 2) {
    const uint16_t v = (uint16_t)((b[i] << 8) | b[i + 1]);
    const uint32_t sec = v & contract::ADVERT_TALLY_SECS_MAX;
    if (sec > 0) own_s[v >> 14] = sec;
  }
  return true;
}
// A player advert's end info (beacon.js playerEndCode): byte 11 when neither the live nor a claim bit is set, else 0.
inline uint8_t player_end_code(uint8_t state, uint8_t value) {
  const uint8_t busy = contract::ADVERT_PLAYER_STATE_LIVE | contract::ADVERT_PLAYER_STATE_CLAIMING | contract::ADVERT_PLAYER_STATE_CLAIM_READY;
  return (state & busy) ? 0 : value;
}
// beacon.js endAgeMs: the ms since the end the code says, the midpoint of its ADVERT_END_AGE_STEP_S step. 0 for code 0.
inline uint32_t end_age_ms(uint8_t code) {
  if (!code) return 0;
  return ((uint32_t)(code - 1) * contract::ADVERT_END_AGE_STEP_S * 1000) + contract::ADVERT_END_AGE_STEP_S * 500;
}

// What the advert says about the point; the republish policy compares these three.
struct AdvertView {
  uint8_t team = contract::STATION_TEAM_ANY;
  uint8_t state = 0;
  uint8_t value = 0;
  bool active = true;  // false: say nothing (a BRIDGE with no live grenade has no owner to report)
  uint8_t taker = 0;   // A56: a powerup's current holder; 0 on every other kind
  // The station's identity on the wire. Any change republishes at once: bench 2026-09-24, MC re-armed
  // a Stick for game 33, but only team/state/value were compared, so it kept advertising game 32 and
  // every phone dropped it as another match's station.
  uint8_t kind = 0;
  uint16_t id = 0;
  uint8_t game = 0;
  int threshold = 0;
  // A88: a following hill's tally payload (encode_tally), sent as manufacturer data beside the UUID
  bool has_tally = false;
  uint8_t tally[6] = {0, 0, 0, 0, 0, 0};
};

// Port of control.js ControlAdvertiser: owner/state changes republish at once, a value-only
// change waits out `min_interval_ms`, and `seq` bumps on every publish so a scanner tells
// fresh from stale.
struct AdvertPolicy {
  uint32_t min_interval_ms = 1000;
  uint32_t tally_refresh_ms = (uint32_t)contract::HILL_TALLY_REFRESH_MS;  // A88: control.js ControlAdvertiser `tallyRefreshMs`
  uint8_t seq = 0;
  bool have_last = false;
  AdvertView last;
  uint32_t last_at = 0;

  // "first" | "state" | "progress" | nullptr (keep the current advert).
  const char* due(const AdvertView& v, uint32_t now) const {
    if (!have_last) return "first";
    if (last.kind != v.kind || last.id != v.id || last.game != v.game || last.threshold != v.threshold)
      return "identity";
    // taker: a pickup's holder changes the advert even when state and value do not (a new claim of the
    // same spawn after an MC correction), so it republishes like a state change.
    if (last.team != v.team || last.state != v.state || last.taker != v.taker) return "state";
    if (last.value != v.value && (now - last_at) >= min_interval_ms) return "progress";
    // A88 (control.js): a new tally game or flags byte goes out at once; changed seconds alone at most every tally_refresh_ms
    if (last.has_tally != v.has_tally || (v.has_tally && (last.tally[0] != v.tally[0] || last.tally[1] != v.tally[1]))) return "tally";
    if (v.has_tally && (now - last_at) >= tally_refresh_ms)
      for (int i = 2; i < 6; i++) if (last.tally[i] != v.tally[i]) return "tally";
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
