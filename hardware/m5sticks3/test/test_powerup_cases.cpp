// The Stick's powerup station (PowerupSchedule + ClaimGate in station_link.h) against the cases it shares
// with the phone (app/src/powerup.js): app/test/fixtures/powerup-station-cases.json (A2, maintainability
// review 2026-10-03). app/test/powerup-cases.test.mjs reads the same file. Build + run:
//   g++ -std=c++17 -I.. test_powerup_cases.cpp -o /tmp/test_powerup_cases [&& /tmp/test_powerup_cases [fixture.json]]
// With no argument the fixture is found from this file's own path (__FILE__).
//
// Mapping, as the firmware glue does it: `update` -> apply_update; `tick` -> schedule.tick, then every
// advert -> ClaimGate::observe, then resolve_batch and, when the item is there, mark_taken. A tick resolves
// at once: the 100 ms tie window is a documented difference from the phone (docs/spec/powerups.md), and the
// stick-only `observe` + `settle` steps cover it. An advert with age_ms over 1500 is not delivered: the phone
// drops it by age, the Stick never hears an aged one.
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "json_lite.h"
#include "station_link.h"

using namespace brx;
using json::Value;

static int failures = 0;
static std::string current;

static void fail(const std::string& what) {
  std::printf("FAIL [%s] %s\n", current.c_str(), what.c_str());
  failures++;
}

static std::string advert_str(uint8_t state, uint8_t value, uint8_t taker) {
  char b[64];
  std::snprintf(b, sizeof b, "{state %d, value %d, taker %d}", state, value, taker);
  return b;
}

struct Rig {
  PowerupSchedule sched;
  ClaimGate gate;
  std::vector<std::string> events;  // since the last step
  long last_key = -1;               // the spawn instant mark_taken returned for this step's claim

  void observe_all(const Value& players, uint32_t t) {
    for (const Value& p : players.arr) {
      if (p.get("age_ms").as_int(0) > 1500) continue;  // aged: the Stick never hears it
      bool claiming = false, ready = false, alive = false;
      for (const Value& n : p.get("state").arr) {
        std::string s = n.as_string();
        if (s == "claiming") claiming = true;
        if (s == "claim_ready") ready = true;
        if (s == "alive") alive = true;
        if (s != "alive" && s != "claiming" && s != "claim_ready") fail("unknown player state " + s);
      }
      gate.observe((int)p.get("id").as_int(), (int)p.get("value").as_int(), 0, claiming, ready, alive,
                   (int)p.get("rssi").as_int(-60), t);
    }
  }
  void resolve(uint32_t t) {
    ClaimWinner w = gate.resolve_batch();
    if (w.won && sched.available()) {
      last_key = (long)sched.mark_taken(w.player_num, t);
      events.push_back("taken:" + std::to_string((int)w.player_num));
    }
  }
};

static void check_expect(Rig& r, const Value& step, uint32_t t) {
  const Value& ex = step.get("expect");
  if (ex.has("claim_key") && r.last_key != ex.get("claim_key").as_int())
    fail("t=" + std::to_string(t) + " claim key " + std::to_string(r.last_key) + " expected " + std::to_string(ex.get("claim_key").as_int()));
  if (ex.has("advert")) {
    PowerupAdvertView v = r.sched.view(t);
    const Value& a = ex.get("advert");
    if (v.state != a.get("state").as_int() || v.value != a.get("value").as_int() || v.taker != a.get("taker").as_int())
      fail("t=" + std::to_string(t) + " advert " + advert_str(v.state, v.value, v.taker) + " expected " +
           advert_str((uint8_t)a.get("state").as_int(), (uint8_t)a.get("value").as_int(), (uint8_t)a.get("taker").as_int()));
  }
  if (ex.has("events")) {
    std::vector<std::string> want;
    for (const Value& e : ex.get("events").arr)
      want.push_back(e.type == Value::Type::String ? e.str : e.get("type").as_string() + ":" + std::to_string(e.get("player_num").as_int()));
    if (want != r.events) {
      std::string got, exp;
      for (auto& s : r.events) got += s + " ";
      for (auto& s : want) exp += s + " ";
      fail("t=" + std::to_string(t) + " events [" + got + "] expected [" + exp + "]");
    }
  }
}

static void run_case(const Value& c) {
  current = c.get("name").as_string();
  Rig r;
  r.gate.configure((int)c.get("setup").get("id").as_int(), 0);
  if (c.get("setup").has("spawn_every_s")) {
    StationItem it;
    it.present = true;
    it.spawn_every_s = (int)c.get("setup").get("spawn_every_s").as_int();
    r.sched.apply_item(it);
  }
  for (const Value& step : c.get("steps").arr) {
    uint32_t t = (uint32_t)step.get("t").as_int64();
    std::string what = step.get("do").as_string();
    r.events.clear();
    r.last_key = -1;
    if (what == "update") {
      StationUpdateMsg u;
      u.present = true;
      u.available = step.get("body").get("available").as_bool();
      u.next_spawn_in_ms = step.get("body").has("next_spawn_in_ms") ? step.get("body").get("next_spawn_in_ms").as_int() : -1;
      u.reset = step.get("body").get("reset").as_bool();
      r.sched.apply_update(u, t);
    } else if (what == "tick") {
      if (r.sched.tick(t)) r.events.push_back("spawned");
      r.observe_all(step.get("players"), t);
      r.resolve(t);
    } else if (what == "observe") {
      r.observe_all(step.get("players"), t);
    } else if (what == "settle") {
      if (!r.gate.ready_due(t)) fail("settle before the tie window closed");
      r.resolve(t);
    } else if (what != "advance") {
      fail("unknown step " + what);
    }
    check_expect(r, step, t);
  }
}

int main(int argc, char** argv) {
  std::string here = __FILE__;  // .../hardware/m5sticks3/test/test_powerup_cases.cpp
  here = here.substr(0, here.rfind('/') == std::string::npos ? 0 : here.rfind('/'));
  if (here.empty()) here = ".";
  std::string path = argc > 1 ? argv[1] : here + "/../../../app/test/fixtures/powerup-station-cases.json";
  std::ifstream f(path);
  if (!f) { std::printf("FAIL cannot open %s\n", path.c_str()); return 1; }
  std::stringstream ss;
  ss << f.rdbuf();
  std::string text = ss.str();
  bool ok = false;
  Value doc = json::parse(text, &ok);
  if (!ok || !doc.get("cases").is_array()) { std::printf("FAIL fixture does not parse\n"); return 1; }
  int ran = 0;
  for (const Value& c : doc.get("cases").arr) {
    bool stick = true;
    if (c.has("only")) {
      stick = false;
      for (const Value& o : c.get("only").arr) if (o.as_string() == "stick") stick = true;
    }
    if (!stick) continue;
    run_case(c);
    ran++;
  }
  if (ran == 0) failures++;
  if (failures) { std::printf("%d failure(s)\n", failures); return 1; }
  std::printf("all checks passed (%d cases)\n", ran);
  return 0;
}
