// The Stick's presence and hill (PlayerPresence + BleControlPoint in presence.h) against the cases it shares with the
// phone (app/src/beacon.js Presence, app/src/control.js ControlPoint) and the stage: app/test/fixtures/presence-hill-cases.json
// (architecture review 2026-10-04, item 3). app/test/presence-hill-cases.test.mjs and mcp/tests/test_presence_hill_cases.py
// read the same file. Build + run:
//   g++ -std=c++17 -I.. test_presence_cases.cpp -o /tmp/test_presence_cases [&& /tmp/test_presence_cases [fixture.json]]
// With no argument the fixture is found from this file's own path (__FILE__).
//
// Mapping: every sighting with t <= the tick time goes to PlayerPresence::observe (a player advert), then
// PlayerPresence::tick, then BleControlPoint::update, every setup.tick_ms from 0 to until_ms. Every number comes
// from the case's `setup`, so the Stick's own defaults (800 ms dwell, -74 dBm) never decide a case.
#include <algorithm>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include "json_lite.h"
#include "presence.h"

using namespace brx;
using json::Value;

static int failures = 0;
static std::string current;
// A checkpoint that does not match is RECORDED against its t. A fixture SHAPE error (unknown state, unknown player, a
// bad field) is never recorded: it is a hard failure at once, in a known_fail case too.
static std::vector<std::pair<long long, std::string>> recorded;

static void fail(long long t, const std::string& what) { recorded.push_back({t, what}); }

static void shape(const std::string& what) {
  std::printf("FAIL [%s] fixture shape: %s\n", current.c_str(), what.c_str());
  failures++;
}

struct Heard { long t; int id; int rssi; };

static uint8_t player_state(const Value& names) {
  uint8_t s = 0;
  for (const Value& n : names.arr) {
    const std::string name = n.as_string();
    if (name == "alive") s |= PLAYER_ALIVE;
    else shape("unknown player state " + name);
  }
  return s;
}

static uint8_t hill_state(const Value& names) {
  uint8_t s = 0;
  for (const Value& n : names.arr) {
    const std::string name = n.as_string();
    if (name == "held") s |= CONTROL_HELD;
    else if (name == "contested") s |= CONTROL_CONTESTED;
    else if (name == "rising") s |= CONTROL_RISING;
    else if (name == "falling") s |= CONTROL_FALLING;
    else shape("unknown hill state " + name);
  }
  return s;
}

static std::vector<Heard> expand(const Value& c) {
  std::vector<Heard> out;
  for (const Value& s : c.get("sightings").arr) out.push_back({s.get("t").as_int64(), (int)s.get("id").as_int(), (int)s.get("rssi").as_int()});
  for (const Value& s : c.get("series").arr) {
    const std::vector<Value>& r = s.get("rssi").arr;
    long every = s.get("every_ms").as_int();
    long k = 0;
    for (long t = s.get("from_ms").as_int64(); t <= s.get("to_ms").as_int64(); k++, t = s.get("from_ms").as_int64() + k * every)
      out.push_back({t, (int)s.get("id").as_int(), (int)r[k % r.size()].as_int()});
  }
  std::stable_sort(out.begin(), out.end(), [](const Heard& a, const Heard& b) { return a.t < b.t; });
  return out;
}

// Structure a runner must reject whatever the rules say: a checkpoint off the tick grid, past until_ms, repeated,
// or naming a player the case does not have. Returns false (after reporting) when the case cannot be run.
static bool validate(const Value& c) {
  const long tick = c.get("setup").get("tick_ms").as_int();
  std::vector<long long> seen;
  bool ok = true;
  const int shape_before = failures;
  for (const Value& ex : c.get("expect").arr) {
    const long long t = ex.get("t").as_int64();
    if (t > c.get("until_ms").as_int64() || t % tick != 0) { shape("checkpoint t=" + std::to_string(t) + " must be a tick time within until_ms"); ok = false; }
    if (std::find(seen.begin(), seen.end(), t) != seen.end()) { shape("duplicate checkpoint t=" + std::to_string(t)); ok = false; }
    seen.push_back(t);
    for (const char* key : {"in", "present"})
      for (const auto& kv : ex.get(key).obj)
        if (!c.get("players").has(kv.first)) { shape("checkpoint t=" + std::to_string(t) + " names player " + kv.first + ", which the case does not have"); ok = false; }
    for (const Value& id : ex.get("same_in").arr)
      if (!c.get("players").has(id.as_string())) { shape("checkpoint t=" + std::to_string(t) + " same_in names player " + id.as_string() + ", which the case does not have"); ok = false; }
    if (ex.has("hill")) hill_state(ex.get("hill").get("state"));
  }
  for (const auto& kv : c.get("players").obj) player_state(kv.second.get("state"));
  if (c.has("known_fail")) {
    const Value& k = c.get("known_fail");
    if (k.get("why").as_string().empty() || k.get("why").as_string()[0] != 'F' || k.get("at").arr.empty()) { shape("known_fail needs why (a follow-up id) and a non-empty at"); ok = false; }
    for (const Value& a : k.get("at").arr) {
      bool found = false;
      for (const Value& ex : c.get("expect").arr) if (ex.get("t").as_int64() == a.as_int64()) found = true;
      if (!found) { shape("known_fail.at names t=" + std::to_string(a.as_int64()) + ", which is not a checkpoint"); ok = false; }
    }
  }
  return ok && failures == shape_before;  // an unknown state named above is a shape error too
}

static void run_case(const Value& c) {
  const Value& s = c.get("setup");
  PlayerPresence pr;
  pr.default_threshold = (int)s.get("threshold_dbm").as_int();
  pr.dwell_ms = (uint32_t)s.get("dwell_ms").as_int();
  pr.hysteresis_db = (int)s.get("exit_band_db").as_int();
  pr.exit_grace_ms = (uint32_t)s.get("exit_grace_ms").as_int();
  pr.expiry_ms = (uint32_t)s.get("expiry_ms").as_int();
  pr.sight_ms = (uint32_t)s.get("sight_ms").as_int();
  pr.alpha = s.get("alpha").num;
  BleControlPoint cp;
  cp.capture_s = (int)s.get("capture_s").as_int();
  cp.net_cap = (int)s.get("net_cap").as_int();
  const long tick = s.get("tick_ms").as_int();
  if (!validate(c)) return;
  const std::vector<Heard> sightings = expand(c);
  size_t next = 0;
  for (long t = 0; t <= c.get("until_ms").as_int64(); t += tick) {
    while (next < sightings.size() && sightings[next].t <= t) {
      const Heard& h = sightings[next++];
      const Value& p = c.get("players").get(std::to_string(h.id));
      Advert a;
      a.role = ROLE_PLAYER;
      a.id = (uint16_t)h.id;
      a.team = (uint8_t)p.get("team").as_int();
      a.state = player_state(p.get("state"));
      pr.observe(a, h.rssi, (uint32_t)h.t);
    }
    pr.tick((uint32_t)t);
    cp.update(pr, (uint32_t)t);
    for (const Value& ex : c.get("expect").arr) {
      if (ex.get("t").as_int64() != t) continue;
      const std::string at = "t=" + std::to_string(t);
      for (const auto& kv : ex.get("in").obj) {
        const PlayerEntry* e = pr.get((uint16_t)std::stoi(kv.first));
        if ((e && e->in_circle) != kv.second.as_bool()) fail(t, at + " player " + kv.first + " in the circle, expected " + (kv.second.as_bool() ? "true" : "false"));
      }
      if (ex.has("same_in")) {
        const std::vector<Value>& ids = ex.get("same_in").arr;
        auto in = [&](const Value& id) { const PlayerEntry* e = pr.get((uint16_t)std::stoi(id.as_string())); return e && e->in_circle; };
        for (const Value& id : ids) if (in(id) != in(ids[0])) fail(t, at + " players must give the same answer, but " + id.as_string() + " differs from " + ids[0].as_string());
      }
      for (const auto& kv : ex.get("present").obj) {
        const PlayerEntry* e = pr.get((uint16_t)std::stoi(kv.first));
        if ((e && e->present) != kv.second.as_bool()) fail(t, at + " player " + kv.first + " present, expected " + (kv.second.as_bool() ? "true" : "false"));
      }
      if (ex.has("hill")) {
        const Value& h = ex.get("hill");
        AdvertView v = cp.advert();
        const int want_state = hill_state(h.get("state"));
        if (v.team != h.get("team").as_int() || v.state != want_state || v.value != h.get("value").as_int()) {
          char b[160];
          std::snprintf(b, sizeof b, "%s hill advert {team %d, state %d, value %d} expected {team %ld, state %d, value %ld}", at.c_str(), v.team,
                        v.state, v.value, h.get("team").as_int(), want_state, h.get("value").as_int());
          fail(t, b);
        }
      }
    }
  }
}

int main(int argc, char** argv) {
  std::string here = __FILE__;  // .../hardware/m5sticks3/test/test_presence_cases.cpp
  here = here.substr(0, here.rfind('/') == std::string::npos ? 0 : here.rfind('/'));
  if (here.empty()) here = ".";
  std::string path = argc > 1 ? argv[1] : here + "/../../../app/test/fixtures/presence-hill-cases.json";
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
    current = c.get("name").as_string();
    recorded.clear();
    run_case(c);
    if (!c.has("known_fail")) {
      for (const auto& r : recorded) std::printf("FAIL [%s] %s\n", current.c_str(), r.second.c_str());
      failures += (int)recorded.size();
    } else {
      // The case names the checkpoints that fail today. EXACTLY those must fail and every other checkpoint must
      // pass. When a fix makes a named one pass, say so, so the label cannot outlive the bug.
      std::vector<long long> at;
      for (const Value& a : c.get("known_fail").get("at").arr) at.push_back(a.as_int64());
      for (const auto& r : recorded)
        if (std::find(at.begin(), at.end(), r.first) == at.end()) {
          std::printf("FAIL [%s] %s (known_fail.at does not name t=%lld)\n", current.c_str(), r.second.c_str(), r.first);
          failures++;
        }
      for (long long t : at) {
        bool failed = false;
        for (const auto& r : recorded) if (r.first == t) failed = true;
        if (!failed) {
          std::printf("FAIL [%s] known_fail \"%s\": checkpoint t=%lld now PASSES on the Stick: remove known_fail (or that t) from this case\n", current.c_str(), c.get("known_fail").get("why").as_string().c_str(), t);
          failures++;
        }
      }
      std::printf("known fail [%s]: %s\n", current.c_str(), c.get("known_fail").get("why").as_string().c_str());
    }
    ran++;
  }
  if (ran == 0) failures++;
  if (failures) { std::printf("%d failure(s)\n", failures); return 1; }
  std::printf("all checks passed (%d cases)\n", ran);
  return 0;
}
