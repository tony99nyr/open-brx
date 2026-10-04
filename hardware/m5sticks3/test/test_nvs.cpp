// O12 + O13: NVS write checks, the one-value hill save, the typed-URL refusal reason, and the
// build-injected version string. A fake Preferences stands in for the ESP32 one.
// Build + run: g++ -std=c++17 -I.. test_nvs.cpp -o /tmp/tnvs && /tmp/tnvs
#include <cstdio>
#include <cstring>
#include <map>
#include <set>
#include <string>

#include "json_lite.h"
#include "station_link.h"
#include "station_persistence.h"

static int failures = 0;
#define CHECK(c)                                                  \
  do {                                                            \
    if (!(c)) {                                                   \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c);    \
      failures++;                                                 \
    }                                                             \
  } while (0)

using namespace brx;

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
  bool remove(const char* k) {
    if (fails(k)) return false;
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

int main() {
  FakePrefs p;
  NvsFailures f;
  CHECK(nvs_put_u8(p, f, "hill_owner", 1) && nvs_put_str(p, f, "ssid", "") && f.count == 0);  // clearing a key that is absent is fine
  p.full = true;
  CHECK(!nvs_put_u8(p, f, "hill_owner", 1));
  CHECK(std::string(f.last_line) == "ERR NVS hill_owner write failed (0 of 1 bytes)");
  CHECK(!nvs_put_str(p, f, "mc_url", "ws://a:1/ws"));
  CHECK(std::string(f.last_line) == "ERR NVS mc_url write failed (0 of 11 bytes)");
  p.full = false;
  p.str["pass"] = "secret";
  p.bad.insert("pass");  // a clear that fails must be counted (putString("") returns 0 either way)
  const uint32_t before = f.count;
  CHECK(!nvs_put_str(p, f, "pass", "") && f.count == before + 1 && p.isKey("pass"));
  p.bad.clear();
  CHECK(nvs_put_str(p, f, "pass", "") && !p.isKey("pass") && f.count == before + 1);
  p.full = true;
  f.count = before;
  CHECK(!nvs_put_u16(p, f, "hill_id", 3) && !nvs_put_i32(p, f, "hclk_rem", 5) && !nvs_put_bool(p, f, "actions", true));
  CHECK(f.count == before + 3);
  p.full = false;
  CHECK(nvs_put_u32(p, f, "boots", 9) && f.count == before + 3);  // a good write does not move the count

  // the failure count rides on the status only when non-zero (older goldens stay byte-identical)
  StatusFields s;
  CHECK(build_status_body(s).find("nvs_fail") == std::string::npos);
  s.nvs_fail = 5;
  CHECK(json::parse(build_status_body(s)).get("nvs_fail").as_int() == 5);

  // the hill is one value: it round-trips, and junk does not decode
  const uint32_t hold[4] = {0, 120000, 5, 4000000000u};
  const std::string blob = encode_saved_hill(1, 7, 3, hold, "sess|id");
  int owner = -1, game = -1, id = -1;
  uint32_t out[4] = {9, 9, 9, 9};
  std::string sid;
  CHECK(decode_saved_hill(blob, owner, game, id, out, sid));
  CHECK(owner == 1 && game == 7 && id == 3 && sid == "sess|id");
  CHECK(out[0] == 0 && out[1] == 120000 && out[2] == 5 && out[3] == 4000000000u);
  CHECK(!decode_saved_hill("", owner, game, id, out, sid));
  CHECK(!decode_saved_hill("v1|1|2", owner, game, id, out, sid));
  CHECK(!decode_saved_hill("v1|x|2|3|0|0|0|0|s", owner, game, id, out, sid));
  CHECK(!decode_saved_hill("v1|256|2|3|0|0|0|0|s", owner, game, id, out, sid));       // owner and game are bytes
  CHECK(!decode_saved_hill("v1|1|256|3|0|0|0|0|s", owner, game, id, out, sid));
  CHECK(!decode_saved_hill("v1|1|2|65536|0|0|0|0|s", owner, game, id, out, sid));      // id is 16 bits
  CHECK(!decode_saved_hill("v1|1|2|3|4294967296|0|0|0|s", owner, game, id, out, sid)); // must not wrap to 0
  CHECK(!decode_saved_hill("v1|1|2|3|0|00000000000|0|0|s", owner, game, id, out, sid));
  CHECK(!decode_saved_hill("v1|1|2|3|99999999999999999999999|0|0|0|s", owner, game, id, out, sid));
  CHECK(decode_saved_hill("v1|255|255|65535|4294967295|0|0|0|", owner, game, id, out, sid) && out[0] == 4294967295u);
  CHECK(!decode_saved_hill("v2|1|2|3|0|0|0|0|s", owner, game, id, out, sid));

  // which source wins at boot: v1, else the legacy keys; save_hill dual-writes both
  {
    const uint32_t h1[4] = {10, 20, 30, 40};
    FakePrefs q;
    CHECK(std::string(load_saved_hill(q, 3).source) == "none" && !load_saved_hill(q, 3).has);  // neither
    NvsFailures g;
    CHECK(save_hill(q, g, 2, 5, 9, h1, "sess"));
    CHECK(q.isKey("hill_v1") && q.isKey("hill_owner") && q.isKey("hill_hold"));  // both key sets written
    HillLoad both = load_saved_hill(q, 3);
    CHECK(std::string(both.source) == "v1" && both.owner == 2 && both.game == 5 && both.id == 9 && both.hold[3] == 40 && both.sid == "sess");
    FakePrefs legacy;  // an old firmware's save: legacy only
    legacy.num["hill_owner"] = 1; legacy.num["hill_game"] = 4; legacy.num["hill_id"] = 8; legacy.str["hill_sid"] = "old";
    legacy.blob["hill_hold"] = std::string((const char*)h1, sizeof h1);
    HillLoad lo = load_saved_hill(legacy, 3);
    CHECK(std::string(lo.source) == "legacy" && lo.owner == 1 && lo.id == 8 && lo.sid == "old" && lo.have_hold && lo.hold[1] == 20);
    FakePrefs v1only;  // legacy keys gone (never written), v1 present
    v1only.str["hill_v1"] = encode_saved_hill(0, 1, 2, h1, "s");
    CHECK(std::string(load_saved_hill(v1only, 3).source) == "v1");
    for (const char* bad : {"v1|1|2", "v1|1|2|3|4294967296|0|0|0|s", "garbage", "v1|999|1|1|0|0|0|0|"}) {
      FakePrefs c = q;  // corrupt or short v1: the dual-written legacy keys answer
      c.str["hill_v1"] = bad;
      HillLoad r = load_saved_hill(c, 3);
      CHECK(std::string(r.source) == "legacy" && r.owner == 2 && r.id == 9 && r.hold[0] == 10);
      FakePrefs d = v1only;  // corrupt v1 and no legacy keys: nothing to restore
      d.str["hill_v1"] = bad;
      CHECK(!load_saved_hill(d, 3).has);
    }
    FakePrefs w;  // a failed legacy write is counted but v1 still landed
    w.bad.insert("hill_id");
    NvsFailures wf;
    CHECK(!save_hill(w, wf, 1, 1, 1, h1, "s") && wf.count == 1 && w.isKey("hill_v1"));
  }

  // an unusable typed MC URL has a reason; a good one has none
  CHECK(saved_mc_url_refusal("ws://192.168.1.5:8766/ws") == nullptr);
  CHECK(std::string(saved_mc_url_refusal("http://192.168.1.5:8766/ws")) == "must start with ws://");
  CHECK(std::string(saved_mc_url_refusal("ws://host:70000/ws")) == "the port is above 65535");
  CHECK(std::string(saved_mc_url_refusal("ws://host/ws")) == "needs a host and a :port");
  CHECK(std::string(saved_mc_url_refusal("ws://h:1/" + std::string(200, 'a'))) == "longer than 192 characters");
  CHECK(!saved_mc_url_usable("ws://host:abc/ws"));

  // the firmware version: <base>+<sha>, "+unknown" with no usable sha
  CHECK(station_version("h8-0.2", "a1b2c3d") == "h8-0.2+a1b2c3d");
  CHECK(station_version("h8-0.2", "a1b2c3d_dirty") == "h8-0.2+a1b2c3d_dirty");
  CHECK(station_version("h8-0.2", "unknown") == "h8-0.2+unknown");
  CHECK(station_version("h8-0.2", "") == "h8-0.2+unknown");
  CHECK(station_version("h8-0.2", nullptr) == "h8-0.2+unknown");
  CHECK(station_version("h8-0.2", "bad sha;") == "h8-0.2+unknown");

  if (failures) return 1;
  std::printf("all checks passed\n");
  return 0;
}
