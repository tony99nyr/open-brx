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
template <class P> bool nvs_put_str(P& p, NvsFailures& f, const char* key, const char* v) {
  return f.note(key, p.putString(key, v), strlen(v));  // an empty string writes 0 bytes and is fine
}

// O12: the hill's save as ONE value, so a power cut cannot leave the owner of one save with the hold
// tally of another. "v1|owner|game|id|hold0|hold1|hold2|hold3|session" (the session id is last).
inline std::string encode_saved_hill(int owner, int game, int id, const uint32_t* hold, const std::string& sid) {
  char b[96];
  snprintf(b, sizeof b, "v1|%d|%d|%d|%lu|%lu|%lu|%lu|", owner, game, id, (unsigned long)hold[0],
           (unsigned long)hold[1], (unsigned long)hold[2], (unsigned long)hold[3]);
  return std::string(b) + sid;
}

inline bool decode_saved_hill(const std::string& s, int& owner, int& game, int& id, uint32_t* hold, std::string& sid) {
  if (s.rfind("v1|", 0) != 0) return false;
  size_t pos = 3;
  unsigned long v[7];
  for (int i = 0; i < 7; i++) {
    const size_t bar = s.find('|', pos);
    if (bar == std::string::npos || bar == pos) return false;
    for (size_t k = pos; k < bar; k++) if (s[k] < '0' || s[k] > '9') return false;
    v[i] = strtoul(s.substr(pos, bar - pos).c_str(), nullptr, 10);
    pos = bar + 1;
  }
  owner = (int)v[0];
  game = (int)v[1];
  id = (int)v[2];
  for (int t = 0; t < 4; t++) hold[t] = (uint32_t)v[3 + t];
  sid = s.substr(pos);
  return true;
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
