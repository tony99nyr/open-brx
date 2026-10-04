#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace brx {

// Keep a typed address first, then let LAN discovery recover from a moved MC.
class TypedMcFallback {
 public:
  bool prefer_typed(uint32_t now_ms = 0) const {
    return failures_ < 3 || (uint32_t)(now_ms - fallback_since_ms_) >= 60000;
  }
  void new_url() { failures_ = 0; dialling_typed_ = false; }
  void dial_started(bool typed) { dialling_typed_ = typed; }
  void dial_failed(uint32_t now_ms = 0) {
    if (dialling_typed_) {
      if (failures_ < 3) ++failures_;
      if (failures_ == 3) fallback_since_ms_ = now_ms;
    }
    dialling_typed_ = false;
  }
  void dial_succeeded() {
    if (dialling_typed_) failures_ = 0;
    dialling_typed_ = false;
  }

 private:
  unsigned failures_ = 0;
  bool dialling_typed_ = false;
  uint32_t fallback_since_ms_ = 0;
};

// Pure storage policy shared by the host gates and Preferences glue.
inline unsigned long lock_snapshot_seconds(unsigned long remaining_s) { return remaining_s; }

inline std::string normalise_saved_mc_url(const std::string& url) {
  return url.size() <= 192 ? url : std::string();
}

// Why a typed MC URL cannot be saved, or nullptr when it can (O12: the Stick prints the reason).
inline const char* saved_mc_url_refusal(const std::string& url) {
  if (url.size() > 192) return "longer than 192 characters";
  if (url.rfind("ws://", 0) != 0) return "must start with ws://";
  const size_t host_end = url.find(':', 5);
  if (host_end == std::string::npos || host_end == 5) return "needs a host and a :port";
  for (size_t i = 5; i < host_end; ++i) {
    const char c = url[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '.' || c == '-')) return "the host has a bad character";
  }
  const size_t path = url.find('/', host_end + 1);
  if (path == std::string::npos || path == host_end + 1) return "needs a /path after the port";
  if (path - host_end - 1 > 5) return "the port is too long";
  unsigned port = 0;
  for (size_t i = host_end + 1; i < path; ++i) {
    if (url[i] < '0' || url[i] > '9') return "the port is not a number";
    port = port * 10 + (url[i] - '0');
    if (port > 65535) return "the port is above 65535";
  }
  if (port == 0) return "the port is 0";
  if (path + 1 == url.size()) return "the path is empty";
  for (size_t i = path; i < url.size(); ++i) {
    if (url[i] <= ' ' || url[i] == '?' || url[i] == '#' || url[i] == '@') return "the path has a bad character";
  }
  return nullptr;
}

inline bool saved_mc_url_usable(const std::string& url) { return saved_mc_url_refusal(url) == nullptr; }

// O12: Preferences `put*` returns the bytes written, and 0 when the write failed (a full or broken NVS).
// These wrappers count each failure and keep one serial line naming the key. `P` is Preferences on the
// Stick and a fake in the host tests.
struct NvsFailures {
  uint32_t count = 0;        // failed writes since boot; rides on the status heartbeat as `nvs_fail`
  char last_line[96] = {0};  // the serial line for the latest failure
  bool note(const char* key, size_t wrote, size_t wanted) {
    if (wrote == wanted) return true;
    ++count;
    snprintf(last_line, sizeof last_line, "ERR NVS %s write failed (%u of %u bytes)", key, (unsigned)wrote, (unsigned)wanted);
    return false;
  }
};

// Each returns true when the write landed. On a failure the caller prints `f.last_line`.
template <class P> bool nvs_put_u8(P& p, NvsFailures& f, const char* key, uint8_t v) { return f.note(key, p.putUChar(key, v), sizeof v); }
template <class P> bool nvs_put_u16(P& p, NvsFailures& f, const char* key, uint16_t v) { return f.note(key, p.putUShort(key, v), sizeof v); }
template <class P> bool nvs_put_u32(P& p, NvsFailures& f, const char* key, uint32_t v) { return f.note(key, p.putUInt(key, v), sizeof v); }
template <class P> bool nvs_put_i32(P& p, NvsFailures& f, const char* key, int32_t v) { return f.note(key, p.putInt(key, v), sizeof v); }
template <class P> bool nvs_put_bool(P& p, NvsFailures& f, const char* key, bool v) { return f.note(key, p.putBool(key, v), sizeof(uint8_t)); }
// An empty string is a clear: putString("") returns 0, the same as a failed write, so it is removed instead
// and `remove`'s result is checked (a key that was never there is already clear).
template <class P> bool nvs_put_str(P& p, NvsFailures& f, const char* key, const char* v) {
  const size_t n = strlen(v);
  if (n == 0) return f.note(key, (p.remove(key) || !p.isKey(key)) ? 1 : 0, 1);
  return f.note(key, p.putString(key, v), n);
}

// O12: the hill's save as ONE value, so a power cut cannot leave the owner of one save with the hold
// tally of another. "v1|owner|game|id|hold0|hold1|hold2|hold3|session" (the session id is last).
inline std::string encode_saved_hill(int owner, int game, int id, const uint32_t* hold, const std::string& sid) {
  char b[96];
  snprintf(b, sizeof b, "v1|%d|%d|%d|%lu|%lu|%lu|%lu|", owner, game, id, (unsigned long)hold[0],
           (unsigned long)hold[1], (unsigned long)hold[2], (unsigned long)hold[3]);
  return std::string(b) + sid;
}

// Every field is range-checked: out of range means invalid (the read then falls back to the legacy keys).
inline bool decode_saved_hill(const std::string& s, int& owner, int& game, int& id, uint32_t* hold, std::string& sid) {
  if (s.rfind("v1|", 0) != 0) return false;
  size_t pos = 3;
  unsigned long long v[7];
  static const unsigned long long MAX[7] = {255, 255, 65535, 4294967295ull, 4294967295ull, 4294967295ull, 4294967295ull};
  for (int i = 0; i < 7; i++) {
    const size_t bar = s.find('|', pos);
    if (bar == std::string::npos || bar == pos || bar - pos > 10) return false;  // empty, or too many digits
    unsigned long long n = 0;
    for (size_t k = pos; k < bar; k++) {
      if (s[k] < '0' || s[k] > '9') return false;
      n = n * 10 + (unsigned)(s[k] - '0');
    }
    if (n > MAX[i]) return false;
    v[i] = n;
    pos = bar + 1;
  }
  owner = (int)v[0];
  game = (int)v[1];
  id = (int)v[2];
  for (int t = 0; t < 4; t++) hold[t] = (uint32_t)v[3 + t];
  sid = s.substr(pos);
  return true;
}

// The hill's saved state as read at boot, and which key set it came from.
struct HillLoad {
  bool has = false;
  int owner = 255, game = 0, id = 0;
  uint32_t hold[4] = {0, 0, 0, 0};
  bool have_hold = false;
  std::string sid;
  const char* source = "none";  // "v1" | "legacy" | "none"
};

// `hill_v1` wins when it decodes; a missing or invalid one falls back to the five legacy keys. `P` is
// Preferences (opened read-only by the caller) or a fake.
template <class P> HillLoad load_saved_hill(P& p, int team_any) {
  HillLoad h;
  if (decode_saved_hill(std::string(p.getString("hill_v1", "").c_str()), h.owner, h.game, h.id, h.hold, h.sid)) {
    h.has = true;
    h.have_hold = true;
    h.source = "v1";
    return h;
  }
  if (!p.isKey("hill_owner")) return h;
  h.has = true;
  h.source = "legacy";
  h.owner = p.getUChar("hill_owner", (uint8_t)team_any);
  h.game = p.getUChar("hill_game", 0);
  h.id = p.getUShort("hill_id", 0);
  h.sid = p.getString("hill_sid", "").c_str();
  h.have_hold = p.getBytes("hill_hold", h.hold, sizeof h.hold) == sizeof h.hold;
  if (!h.have_hold) for (int t = 0; t < 4; t++) h.hold[t] = 0;
  return h;
}

// DUAL-WRITE, legacy keys FIRST and `hill_v1` LAST. If the `hill_v1` write fails it is removed, so the next boot
// falls back to the legacy keys, which are current. If a legacy write fails, `hill_v1` is still written and wins
// at boot; the stale legacy keys matter only after a downgrade. Returns true when every write landed.
template <class P> bool save_hill(P& p, NvsFailures& f, int owner, int game, int id, const uint32_t* hold, const std::string& sid) {
  bool ok = nvs_put_u8(p, f, "hill_owner", (uint8_t)owner);
  ok = nvs_put_u8(p, f, "hill_game", (uint8_t)game) && ok;
  ok = nvs_put_u16(p, f, "hill_id", (uint16_t)id) && ok;
  ok = nvs_put_str(p, f, "hill_sid", sid.c_str()) && ok;
  ok = f.note("hill_hold", p.putBytes("hill_hold", hold, 4 * sizeof(uint32_t)), 4 * sizeof(uint32_t)) && ok;
  if (!nvs_put_str(p, f, "hill_v1", encode_saved_hill(owner, game, id, hold, sid).c_str())) {
    p.remove("hill_v1");  // never leave an older v1 that would outrank the newer legacy keys
    return false;
  }
  return ok;
}

// O13: the firmware version the Stick reports: "<sketch version>+<short sha>". The build passes the sha
// (tools/stick.py, -DBRX_FW_SHA=<sha>, "_dirty" appended for an unclean tree); any build without one, or with an odd one, reports "+unknown".
inline std::string station_version(const char* base, const char* sha) {
  std::string s = sha ? sha : "";
  bool ok = !s.empty() && s.size() <= 24;
  for (char c : s) ok = ok && ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-' || c == '_');
  return std::string(base) + "+" + (ok ? s : std::string("unknown"));
}

}  // namespace brx
