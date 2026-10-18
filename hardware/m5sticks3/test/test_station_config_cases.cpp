// The Stick's station_config rule (parse_station_config in station_link.h) against the cases it shares with the
// phone (app/src/stationconfig.js): app/test/fixtures/station-config-cases.json (A4, review 2026-10-10).
// app/test/station-config-cases.test.mjs reads the same file. Build + run:
//   g++ -std=c++17 -I.. test_station_config_cases.cpp -o /tmp/test_station_config_cases [&& /tmp/test_station_config_cases [fixture.json]]
// With no argument the fixture is found from this file's own path (__FILE__).
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "json_lite.h"
#include "station_link.h"

using namespace brx;
using json::Value;

static int failures = 0;

static std::string ids_str(const std::vector<int>& v) {
  std::string s = "[";
  for (size_t i = 0; i < v.size(); i++) s += (i ? "," : "") + std::to_string(v[i]);
  return s + "]";
}

static void run_case(const Value& c) {
  const std::string name = c.get("name").as_string();
  const Value& e = c.get("expect");
  StationAssignment a = parse_station_config(c.get("body"));
  if (e.get("refused").as_bool(false)) {
    if (a.present || a.refused == nullptr) { std::printf("FAIL [%s] expected a refusal\n", name.c_str()); failures++; }
    return;
  }
  if (!a.present) { std::printf("FAIL [%s] refused: %s\n", name.c_str(), a.refused ? a.refused : "(no reason)"); failures++; return; }
  std::vector<int> want_ids;
  const bool ids_null = e.get("valid_ids").is_null();
  if (!ids_null) for (const Value& x : e.get("valid_ids").arr) want_ids.push_back((int)x.as_int());
  // the Stick keeps no "absent" marker for valid_ids: an absent list and an empty one are both empty
  const bool same = a.kind == e.get("kind").as_string() && a.team == (int)e.get("team").as_int() &&
                    a.id == (int)e.get("id").as_int() && a.game == (int)e.get("game").as_int() &&
                    a.valid_ids == want_ids && a.lock_s == (int)e.get("lock_s").as_int() &&
                    a.item.present == e.get("has_item").as_bool(false) &&
                    a.capture_s == (e.has("capture_s") ? (int)e.get("capture_s").as_int() : 0) &&   // F559: 0 = absent
                    a.net_cap == (e.has("net_cap") ? (int)e.get("net_cap").as_int() : 0);
  if (!same) {
    std::printf("FAIL [%s] got kind %s team %d id %d game %d valid_ids %s lock_s %d item %d capture_s %d net_cap %d\n", name.c_str(),
                a.kind.c_str(), a.team, a.id, a.game, ids_str(a.valid_ids).c_str(), a.lock_s, (int)a.item.present, a.capture_s, a.net_cap);
    failures++;
  }
}

int main(int argc, char** argv) {
  std::string here = __FILE__;  // .../hardware/m5sticks3/test/test_station_config_cases.cpp
  here = here.substr(0, here.rfind('/') == std::string::npos ? 0 : here.rfind('/'));
  if (here.empty()) here = ".";
  std::string path = argc > 1 ? argv[1] : here + "/../../../app/test/fixtures/station-config-cases.json";
  std::ifstream f(path);
  if (!f) { std::printf("FAIL cannot open %s\n", path.c_str()); return 1; }
  std::stringstream ss;
  ss << f.rdbuf();
  bool ok = false;
  Value doc = json::parse(ss.str(), &ok);
  if (!ok || !doc.get("cases").is_array()) { std::printf("FAIL fixture does not parse\n"); return 1; }
  int ran = 0;
  for (const Value& c : doc.get("cases").arr) { run_case(c); ran++; }
  if (ran < 25) { std::printf("FAIL only %d cases\n", ran); return 1; }
  if (failures) { std::printf("%d failure(s)\n", failures); return 1; }
  std::printf("all checks passed (%d station_config cases)\n", ran);
  return 0;
}
