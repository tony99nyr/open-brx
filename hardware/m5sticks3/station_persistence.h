#pragma once
#include <string>

namespace brx {

// Pure storage policy shared by the host gates and Preferences glue.
inline unsigned long lock_snapshot_seconds(unsigned long remaining_s) { return remaining_s; }

inline std::string normalise_saved_mc_url(const std::string& url) {
  return url.size() <= 192 ? url : std::string();
}

inline bool saved_mc_url_usable(const std::string& url) {
  return !url.empty() && url.size() <= 192 && url.rfind("ws://", 0) == 0;
}

}  // namespace brx
