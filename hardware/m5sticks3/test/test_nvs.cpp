// O12 + O13: NVS write checks, the one-value hill save, the typed-URL refusal reason, and the
// build-injected version string. A fake Preferences stands in for the ESP32 one.
// Build + run: g++ -std=c++17 -I.. test_nvs.cpp -o /tmp/tnvs && /tmp/tnvs
#include <cstdio>
#include <cstring>
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

// Returns the byte count the real Preferences returns, or 0 when `full` (a full or failed NVS).
struct FakePrefs {
  bool full = false;
  size_t putUChar(const char*, uint8_t) { return full ? 0 : 1; }
  size_t putUShort(const char*, uint16_t) { return full ? 0 : 2; }
  size_t putUInt(const char*, uint32_t) { return full ? 0 : 4; }
  size_t putInt(const char*, int32_t) { return full ? 0 : 4; }
  size_t putBool(const char*, bool) { return full ? 0 : 1; }
  size_t putString(const char*, const char* v) { return full ? 0 : strlen(v); }
};

int main() {
  FakePrefs p;
  NvsFailures f;
  CHECK(nvs_put_u8(p, f, "hill_owner", 1) && nvs_put_str(p, f, "ssid", "") && f.count == 0);
  p.full = true;
  CHECK(!nvs_put_u8(p, f, "hill_owner", 1));
  CHECK(std::string(f.last_line) == "ERR NVS hill_owner write failed (0 of 1 bytes)");
  CHECK(!nvs_put_str(p, f, "mc_url", "ws://a:1/ws"));
  CHECK(std::string(f.last_line) == "ERR NVS mc_url write failed (0 of 11 bytes)");
  CHECK(!nvs_put_u16(p, f, "hill_id", 3) && !nvs_put_i32(p, f, "hclk_rem", 5) && !nvs_put_bool(p, f, "actions", true));
  CHECK(f.count == 5);
  p.full = false;
  CHECK(nvs_put_u32(p, f, "boots", 9) && f.count == 5);  // a good write does not move the count

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
  CHECK(!decode_saved_hill("v2|1|2|3|0|0|0|0|s", owner, game, id, out, sid));

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
