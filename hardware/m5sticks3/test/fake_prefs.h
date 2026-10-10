// fake_prefs.h - a host stand-in for the ESP32 Preferences class, shared by test_nvs.cpp and
// test_controller.cpp. Plain C++ with no brx dependency.
#pragma once
#include <cstdint>
#include <cstring>
#include <map>
#include <set>
#include <string>

// A fake Preferences: stores values, returns the byte counts the real one returns, and fails (0 / false)
// for every key in `bad`, or for all keys while `full`.
struct FakePrefs {
  bool full = false;
  std::set<std::string> bad;
  std::map<std::string, std::string> str;
  std::map<std::string, uint32_t> num;
  std::map<std::string, std::string> blob;
  bool fails(const char* k) const { return full || bad.count(k); }
  size_t putUChar(const char* k, uint8_t v) { if (fails(k)) return 0; num[k] = v; return 1; }
  size_t putUShort(const char* k, uint16_t v) { if (fails(k)) return 0; num[k] = v; return 2; }
  size_t putUInt(const char* k, uint32_t v) { if (fails(k)) return 0; num[k] = v; return 4; }
  size_t putInt(const char* k, int32_t v) { if (fails(k)) return 0; num[k] = (uint32_t)v; return 4; }
  size_t putBool(const char* k, bool v) { if (fails(k)) return 0; num[k] = v; return 1; }
  size_t putString(const char* k, const char* v) { if (fails(k)) return 0; str[k] = v; return strlen(v); }
  size_t putBytes(const char* k, const void* v, size_t n) {
    if (fails(k)) return 0;
    blob[k] = std::string((const char*)v, n);
    return n;
  }
  std::set<std::string> bad_remove;  // keys whose clear fails (a failed WRITE does not imply a failed remove)
  bool remove(const char* k) {
    if (full || bad_remove.count(k)) return false;
    return str.erase(k) + num.erase(k) + blob.erase(k) > 0;
  }
  bool isKey(const char* k) { return str.count(k) || num.count(k) || blob.count(k); }
  std::string getString(const char* k, const char* d) { return str.count(k) ? str[k] : d; }
  uint8_t getUChar(const char* k, uint8_t d) { return num.count(k) ? (uint8_t)num[k] : d; }
  uint16_t getUShort(const char* k, uint16_t d) { return num.count(k) ? (uint16_t)num[k] : d; }
  size_t getBytes(const char* k, void* out, size_t n) {
    if (!blob.count(k) || blob[k].size() != n) return 0;
    memcpy(out, blob[k].data(), n);
    return n;
  }
};
