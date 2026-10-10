// Cross-lane review 2026-10-04 #7: a player's claim carries the powerup station id in ONE byte (the advert's `value`),
// so MC refuses a powerup station id above contract::POWERUP_STATION_ID_MAX. The Stick refuses the same config too,
// with a reason the glue logs, so a station never arms with an id no claim can name. Other kinds keep their range.
// Build + run: g++ -std=c++17 -I.. test_powerup_id.cpp -o /tmp/tpi && /tmp/tpi
#include <cstdio>
#include <string>

#include "json_lite.h"
#include "station_link.h"
#include "check.h"


using namespace brx;

static StationAssignment cfg(const char* kind, int id) {
  std::string body = std::string("{\"kind\":\"") + kind + "\",\"id\":" + std::to_string(id) + ",\"team\":255}";
  return parse_station_config(json::parse(body));
}

int main() {
  StationAssignment edge = cfg("powerup", contract::POWERUP_STATION_ID_MAX);
  CHECK(edge.present);
  CHECK(edge.refused == nullptr);

  StationAssignment over = cfg("powerup", contract::POWERUP_STATION_ID_MAX + 1);
  CHECK(!over.present);
  CHECK(over.refused != nullptr);

  StationAssignment zero = cfg("powerup", 0);
  CHECK(!zero.present);
  CHECK(zero.refused != nullptr);

  // Only a powerup claim is one byte wide: a respawn station keeps MC's wider id range.
  StationAssignment respawn = cfg("respawn", 300);
  CHECK(respawn.present);
  CHECK(respawn.refused == nullptr);

  if (failures) {
    std::printf("%d failure(s)\n", failures);
    return 1;
  }
  std::printf("test_powerup_id: all checks passed\n");
  return 0;
}
