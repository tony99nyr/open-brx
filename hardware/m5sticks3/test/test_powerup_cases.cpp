// The Stick's powerup station (PowerupSchedule + ClaimGate in station_link.h) against the cases it shares
// with the phone (app/src/powerup.js): app/test/fixtures/powerup-station-cases.json (A2, maintainability
// review 2026-10-03). app/test/powerup-cases.test.mjs reads the same file. Build + run:
//   g++ -std=c++17 -I.. test_powerup_cases.cpp -o /tmp/test_powerup_cases [&& /tmp/test_powerup_cases [fixture.json]]
// With no argument the fixture is found from this file's own path (__FILE__).
//
// Mapping, as the firmware glue does it: `update` -> apply_update; `tick` -> schedule.tick, then every
// advert -> ClaimGate::observe_advert (the A86 scope; a player's scope defaults to one naming this station), then
// resolve_batch and, when the item is there, mark_taken. F658: a `follow` case first feeds the adverts to a
// PlayerPresence and steps the PowerupFollower (StationLink::tick_players), and `update` asks accepts_mc; `restart`
// is a software reset through encode_powerup_follow / decode_powerup_follow. A tick resolves
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
  PowerupFollower follower;
  PlayerPresence presence;
  int id = 0, armed = 0, first_at_s = 0;
  bool follow = false;
  std::vector<std::string> events;  // since the last step
  long last_key = -1;               // the spawn instant mark_taken returned for this step's claim

  // One case player as the scan decodes it. The scope defaults to one naming this station (A86).
  Advert advert_of(const Value& p) {
    Advert a;
    a.role = contract::ADVERT_ROLE_PLAYER;
    a.id = (uint16_t)p.get("id").as_int();
    a.value = (uint8_t)p.get("value").as_int();
    a.game = (uint8_t)p.get("game").as_int(0);
    for (const Value& n : p.get("state").arr) {
      std::string s = n.as_string();
      if (s == "claiming") a.state |= contract::ADVERT_PLAYER_STATE_CLAIMING;
      else if (s == "claim_ready") a.state |= contract::ADVERT_PLAYER_STATE_CLAIM_READY;
      else if (s == "alive") a.state |= contract::ADVERT_PLAYER_STATE_ALIVE;
      else if (s == "live") a.state |= contract::ADVERT_PLAYER_STATE_LIVE;
      else fail("unknown player state " + s);
    }
    a.scope_kinds = contract::ADVERT_SCOPE_KIND_POWERUP;
    a.scope = (uint16_t)(1u << (id % contract::ADVERT_SCOPE_ID_BITS));
    if (p.has("scope_kinds")) {
      a.scope_kinds = 0;
      for (const Value& n : p.get("scope_kinds").arr) {
        std::string k = n.as_string();
        if (k == "control") a.scope_kinds |= contract::ADVERT_SCOPE_KIND_CONTROL;
        else if (k == "respawn") a.scope_kinds |= contract::ADVERT_SCOPE_KIND_RESPAWN;
        else if (k == "powerup") a.scope_kinds |= contract::ADVERT_SCOPE_KIND_POWERUP;
        else fail("unknown scope kind " + k);
      }
    }
    if (p.has("scope_stations")) {
      a.scope = 0;
      for (const Value& n : p.get("scope_stations").arr) a.scope |= (uint16_t)(1u << (n.as_int() % contract::ADVERT_SCOPE_ID_BITS));
    }
    return a;
  }
  void observe_all(const Value& players, uint32_t t) {
    for (const Value& p : players.arr) {
      if (p.get("age_ms").as_int(0) > 1500) continue;  // aged: the Stick never hears it
      gate.observe_advert(advert_of(p), (int)p.get("rssi").as_int(-60), t);
    }
  }
  // F658: StationLink::tick_players for a powerup: the adverts into presence, then the follower.
  void follow_step(const Value& players, uint32_t t) {
    for (const Value& p : players.arr) presence.observe(advert_of(p), (int)p.get("rssi").as_int(-60), t - (uint32_t)p.get("age_ms").as_int(0));
    presence.tick(t);
    follower.step(sched, gate, presence, t, (uint8_t)armed, id, first_at_s);
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
  if (ex.has("follows") && r.follower.follows != ex.get("follows").as_bool())
    fail("t=" + std::to_string(t) + " follows " + std::to_string(r.follower.follows));
  if (ex.has("game") && r.follower.game((uint8_t)r.armed) != ex.get("game").as_int())
    fail("t=" + std::to_string(t) + " game " + std::to_string(r.follower.game((uint8_t)r.armed)) + " expected " + std::to_string(ex.get("game").as_int()));
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
  const Value& setup = c.get("setup");
  r.id = (int)setup.get("id").as_int();
  r.armed = (int)setup.get("armed_game").as_int(0);
  r.first_at_s = (int)setup.get("first_at_s").as_int(0);
  r.follow = setup.get("follow").as_bool();
  r.presence.key_by_game = true;   // F658: a powerup hears every game, as a hill does (TickController::begin_players)
  r.gate.configure(r.id, r.armed);
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
      if (!r.follow || r.follower.accepts_mc((uint8_t)r.armed)) r.sched.apply_update(u, t);   // StationLink::apply_station_update
    } else if (what == "tick") {
      if (r.follow) r.follow_step(step.get("players"), t);
      if (r.sched.tick(t)) r.events.push_back("spawned");
      r.observe_all(step.get("players"), t);
      r.resolve(t);
    } else if (what == "observe") {
      r.observe_all(step.get("players"), t);
    } else if (what == "settle") {
      if (!r.gate.ready_due(t)) fail("settle before the tie window closed");
      r.resolve(t);
    } else if (what == "restart") {   // F658: a software reset, through the NVS string the glue writes
      const std::string saved = encode_powerup_follow(r.id, r.follower, r.sched, t);
      PowerupSchedule fresh;
      StationItem it;
      it.present = true;
      it.spawn_every_s = (int)setup.get("spawn_every_s").as_int(0);
      fresh.apply_item(it);
      r.sched = fresh;
      r.follower = PowerupFollower();
      r.gate = ClaimGate();
      r.gate.configure(r.id, r.armed);
      r.presence = PlayerPresence();
      r.presence.key_by_game = true;
      if (!decode_powerup_follow(saved, r.id, r.follower, r.sched, t)) fail("restart: the saved follower does not decode: " + saved);
      r.gate.set_follow(r.follower.current, true);   // mcLoadSavedPuFollow
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
