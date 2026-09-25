#pragma once
#include <cstdint>
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

inline bool saved_mc_url_usable(const std::string& url) {
  if (url.size() > 192 || url.rfind("ws://", 0) != 0) return false;
  const size_t host_end = url.find(':', 5);
  if (host_end == std::string::npos || host_end == 5) return false;
  for (size_t i = 5; i < host_end; ++i) {
    const char c = url[i];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '.' || c == '-')) return false;
  }
  const size_t path = url.find('/', host_end + 1);
  if (path == std::string::npos || path == host_end + 1) return false;
  if (path - host_end - 1 > 5) return false;
  unsigned port = 0;
  for (size_t i = host_end + 1; i < path; ++i) {
    if (url[i] < '0' || url[i] > '9') return false;
    port = port * 10 + (url[i] - '0');
    if (port > 65535) return false;
  }
  if (port == 0 || path + 1 == url.size()) return false;
  for (size_t i = path; i < url.size(); ++i) {
    if (url[i] <= ' ' || url[i] == '?' || url[i] == '#' || url[i] == '@') return false;
  }
  return true;
}

}  // namespace brx
