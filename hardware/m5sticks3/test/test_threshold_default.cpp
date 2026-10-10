// D5: a defaulted Stick threshold must be STORED, REPORTED and APPLIED as one value, the per-kind default
// (stick_default_threshold_dbm). Before the fix a defaulted hill stored -57 (the generic default) while it
// measured by -75. An explicit MC threshold must pass through all three unchanged. Byte 14 is NOT checked
// here: a defaulted hill keeps -57 there on purpose (threshold_advertised_dbm, test_range.cpp).
// Build + run: g++ -std=c++17 -I.. test_threshold_default.cpp -o /tmp/ttd && /tmp/ttd
#include <cstdio>
#include <string>

#include "json_lite.h"
#include "station_link.h"
#include "check.h"

// Differs from check.h's CHECK_EQ on purpose: it casts to int and prints both values.
#define CHECK_EQ_INT(a, b)                                                                           \
  do {                                                                                           \
    int _a = (int)(a);                                                                           \
    int _b = (int)(b);                                                                           \
    if (_a != _b) {                                                                              \
      std::printf("FAIL %s:%d  %s == %s (%d vs %d)\n", __FILE__, __LINE__, #a, #b, _a, _b);      \
      failures++;                                                                                \
    }                                                                                            \
  } while (0)

using namespace brx;

static int stored_in_saved_copy(const StationAssignment& a) {
  return (int)json::parse(station_config_storage_body(a)).get("threshold").as_int();
}

static int reported_in_heartbeat(const StationLink& link) {
  StatusFields f;
  fill_range_status(link, f, 0);
  return (int)json::parse(build_status_body(f)).get("threshold").as_int();
}

static void check_kind(const char* kind, const char* threshold_json, int expect) {
  const std::string body = std::string("{\"kind\":\"") + kind + "\",\"team\":1,\"id\":2" + threshold_json + "}";
  StationAssignment a = parse_station_config(json::parse(body));
  StationLink link;
  link.apply_station_config(a, 0);
  std::printf("  %s %s -> expect %d\n", kind, threshold_json, expect);
  CHECK_EQ_INT(a.threshold, expect);                  // stored on the assignment
  CHECK_EQ_INT(stored_in_saved_copy(a), expect);      // stored in the NVS copy
  CHECK_EQ_INT(reported_in_heartbeat(link), expect);  // reported to MC
  CHECK_EQ_INT(link.threshold_dbm(), expect);         // applied now
  CHECK_EQ_INT(presence_threshold_dbm(a), expect);    // applied by the presence rule
  // A restart restores the saved copy: the three still agree.
  StationAssignment r = parse_station_config(json::parse(station_config_storage_body(a)));
  StationLink restored;
  restored.restore_station_config(r);
  CHECK_EQ_INT(restored.threshold_dbm(), expect);
  CHECK_EQ_INT(reported_in_heartbeat(restored), expect);
}

int main() {
  const char* kinds[] = {"respawn", "control", "powerup", "extraction", "bomb"};
  for (const char* k : kinds) {
    check_kind(k, "", stick_default_threshold_dbm(k));                  // absent
    check_kind(k, ",\"threshold\":0", stick_default_threshold_dbm(k));  // explicit 0
    check_kind(k, ",\"threshold\":-66", -66);                           // MC's value, unchanged
  }
  CHECK_EQ_INT(stick_default_threshold_dbm("control"), STICK_HILL_DEFAULT_THRESHOLD_DBM);
  return report("sticks3 threshold default: all checks passed");
}
