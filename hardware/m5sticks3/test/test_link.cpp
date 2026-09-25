// Host tests for the Stick's Mission Control link core (station_link.h + json_lite.h). Build + run:
//   g++ -std=c++17 -I.. test_link.cpp -o /tmp/test_link && /tmp/test_link
// mcp/tests/test_sticks3_core.py does exactly that when g++ exists.
//
// Run with one argument (a directory) instead to skip the checks and write the golden envelope
// JSON this header builds into that directory -- mcp/tests/test_utility_esp32.py does this to drive
// MC's Session with the EXACT strings the firmware would send, not a hand-typed approximation of
// them (see that file's docstring).
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

#include "json_lite.h"
#include "station_link.h"
#include "station_persistence.h"

static int failures = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    if (!(cond)) {                                                     \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);      \
      failures++;                                                      \
    }                                                                  \
  } while (0)
#define CHECK_EQ(a, b)                                                             \
  do {                                                                             \
    auto _a = (a);                                                                \
    auto _b = (b);                                                                \
    if (!(_a == _b)) {                                                            \
      std::printf("FAIL %s:%d  %s == %s\n", __FILE__, __LINE__, #a, #b);          \
      failures++;                                                                 \
    }                                                                             \
  } while (0)

using namespace brx;

static void test_f389_every_dial_path_respects_link_stops() {
  CHECK(!mc_dial_allowed(false, true, true));
  CHECK(!mc_dial_allowed(true, false, true));
  CHECK(!mc_dial_allowed(true, true, false));
  CHECK(mc_dial_allowed(true, false, false));
}

static void test_f390_rejoin_waits_for_a_known_deadline() {
  CHECK(!muster_rejoin_due(true, false, -1, 0));
  CHECK(!muster_rejoin_due(false, true, 0, 0));
  CHECK(muster_rejoin_due(true, false, 0, 45));
  CHECK(!muster_rejoin_due(true, true, -1, 0)); // A short lock can expire during play.
  CHECK(!muster_rejoin_due(true, false, 0, 0, true)); // LINK OFF must stay off.
}

static void test_f390_timed_powerup_rejoins_at_whistle_not_short_lock_expiry() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  a.game = 1;
  a.lock_s = 2;
  a.starts_known = true;
  a.starts_in_ms = 0;
  a.ends_in_ms = 10000;
  link.apply_station_config(a, 1000);
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 30000;
  CHECK(link.apply_station_update(u, 1100));
  CHECK(link.take_muster_drop(1100));
  CHECK(!link.automatic_rejoin_due(3100));
  CHECK(link.automatic_rejoin_due(11000));
}

static void test_f390_deadline_rejoin_for_each_station_kind() {
  for (const char* kind : {"control", "powerup", "respawn", "extraction", "bomb"}) {
    StationLink link;
    StationAssignment a;
    a.present = true;
    a.kind = kind;
    a.id = 8;
    a.game = 1;
    a.starts_known = true;
    a.ends_in_ms = 4000;
    link.apply_station_config(a, 1000);
    if (a.kind == "powerup") {
      StationUpdateMsg u;
      u.present = true;
      u.id = 8;
      u.available = false;
      link.apply_station_update(u, 1100);
    }
    CHECK(link.take_muster_drop(1200));
    CHECK(!link.automatic_rejoin_due(4999));
    CHECK(link.automatic_rejoin_due(5000));
    CHECK(!link.automatic_rejoin_due(5000, true));
  }
  StationLink untimed;
  StationAssignment a;
  a.present = true;
  a.kind = "respawn";
  a.id = 8;
  a.game = 1;
  untimed.apply_station_config(a, 1000);
  CHECK(untimed.take_muster_drop(1000));
  CHECK(!untimed.automatic_rejoin_due(9000000));
}

static void test_f391_lock_snapshot_never_grows_and_saves_once_five_minutes() {
  CHECK_EQ(lock_restore_remaining_s(90), 90u);
  CHECK_EQ(lock_restore_remaining_s(8000), 120u);
  CHECK(!lock_save_due(30, 1000, 300999));
  CHECK(lock_save_due(30, 1000, 301000));
  CHECK(!lock_save_due(0, 1000, 301000));
  CHECK_EQ(lock_restore_remaining_s(7200), 120u); // No clock runs while power is off.
}

static void test_f397_typed_mc_url_storage_policy() {
  CHECK(saved_mc_url_usable("ws://192.168.1.5:8766/ws"));
  CHECK(!saved_mc_url_usable("http://192.168.1.5:8766/ws"));
  CHECK(normalise_saved_mc_url(std::string(193, 'x')).empty());
  CHECK(!saved_mc_url_usable("ws://host:70000/ws"));
  CHECK(!saved_mc_url_usable("ws://host:abc/ws"));
  CHECK(!saved_mc_url_usable("ws://host:8766/ws?token=x"));
  CHECK(!saved_mc_url_usable("ws://host:999999999999999999999999/ws"));
}

static void test_f397_typed_url_falls_back_after_failed_dials() {
  TypedMcFallback fallback;
  CHECK(fallback.prefer_typed());
  fallback.dial_started(true);
  fallback.dial_failed(1000);
  CHECK(fallback.prefer_typed());
  fallback.dial_started(true);
  fallback.dial_failed(2000);
  CHECK(fallback.prefer_typed());
  fallback.dial_started(true);
  fallback.dial_failed(3000);
  CHECK(!fallback.prefer_typed(3000));
  CHECK(!fallback.prefer_typed(62999));
  CHECK(fallback.prefer_typed(63000));
  fallback.dial_started(false);
  fallback.dial_succeeded();
  CHECK(!fallback.prefer_typed(3000));
  fallback.new_url();
  CHECK(fallback.prefer_typed());
}

// --- json_lite ------------------------------------------------------------------------------

static void test_json_round_trips_the_shapes_we_actually_send() {
  bool ok = false;
  json::Value v = json::parse(R"({"a":1,"b":"two","c":true,"d":null,"e":[1,2,3],"f":{"g":-4.5}})", &ok);
  CHECK(ok);
  CHECK_EQ(v.get("a").as_int(), 1L);
  CHECK_EQ(v.get("b").as_string(), std::string("two"));
  CHECK_EQ(v.get("c").as_bool(), true);
  CHECK(v.get("d").is_null());
  CHECK_EQ(v.get("e").arr.size(), (size_t)3);
  CHECK_EQ(v.get("e").arr[2].as_int(), 3L);
  CHECK_EQ(v.get("f").get("g").as_int(), -4L);
  CHECK(v.get("nope").is_null());  // missing key: Null, not a crash
}

static void test_json_tolerates_garbage() {
  bool ok = true;
  json::parse("{not json at all", &ok);
  CHECK(!ok);
  ok = true;
  json::parse("", &ok);
  CHECK(!ok);
  ok = true;
  json::parse("{\"a\":}", &ok);
  CHECK(!ok);
}

static void test_json_escapes_quotes_and_backslashes() {
  CHECK_EQ(json::quote("plain"), std::string("\"plain\""));
  CHECK_EQ(json::quote("a\"b\\c"), std::string("\"a\\\"b\\\\c\""));
  bool ok = false;
  json::Value v = json::parse(json::quote("round \"trip\" \\ me"), &ok);
  CHECK(ok);
  CHECK_EQ(v.as_string(), std::string("round \"trip\" \\ me"));
}

// --- message builders, pinned literal strings --------------------------------------------------

static void test_hello_body_matches_the_wire_contract() {
  StationIdentity id;
  id.node_id = "stick-7f3a";
  id.app_ver = "h8-0.1+abc1234";
  CHECK_EQ(build_hello_body(id, 0),
           std::string("{\"node_id\":\"stick-7f3a\",\"node_type\":\"utility\",\"app_ver\":\"h8-0.1+abc1234\","
                       "\"platform\":\"esp32\",\"seq_next\":0}"));
  id.node_key = "wk-99";
  CHECK_EQ(build_hello_body(id, 0),
           std::string("{\"node_id\":\"stick-7f3a\",\"node_type\":\"utility\",\"app_ver\":\"h8-0.1+abc1234\","
                       "\"platform\":\"esp32\",\"seq_next\":0,\"node_key\":\"wk-99\"}"));
}

static void test_status_body_matches_utility_js_shape() {
  StatusFields f;
  f.node_id = "stick-7f3a";
  f.app_ver = "h8-0.1+abc1234";
  f.kind = "respawn";
  f.team = 1;
  f.station_id = 3;
  f.threshold = -74;
  f.live = true;
  f.armed = true;
  f.battery_pct = 81;
  CHECK_EQ(build_status_body(f),
           std::string("{\"node_id\":\"stick-7f3a\",\"arm_state\":\"connected\",\"synced\":false,"
                       "\"role\":\"utility\",\"kind\":\"respawn\",\"team\":1,\"station_id\":3,"
                       "\"threshold\":-74,\"live\":true,\"armed\":true,\"app_ver\":\"h8-0.1+abc1234\","
                       "\"platform\":\"esp32\",\"battery\":81}"));
  f.kind = "control";
  f.team = 255;
  f.station_id = 9;
  f.battery_pct = -1;
  f.has_control = true;
  f.control_owner = 1;
  f.control_progress = 50;
  CHECK_EQ(build_status_body(f),
           std::string("{\"node_id\":\"stick-7f3a\",\"arm_state\":\"connected\",\"synced\":false,"
                       "\"role\":\"utility\",\"kind\":\"control\",\"team\":255,\"station_id\":9,"
                       "\"threshold\":-74,\"live\":true,\"armed\":true,\"app_ver\":\"h8-0.1+abc1234\","
                       "\"platform\":\"esp32\",\"control\":{\"owner\":1,\"progress\":50,\"contested\":false}}"));
}

static void test_envelope_wraps_the_body_with_v_kind_id_t() {
  std::string body = build_hello_body(StationIdentity{"n", "", "v", "esp32"}, 0);
  std::string env = make_envelope("hello", body, "abc123def456", 1700000000000LL);
  CHECK_EQ(env, std::string("{\"v\":1,\"kind\":\"hello\",\"id\":\"abc123def456\",\"t\":1700000000000,\"body\":") +
                    body + "}");
  bool ok = false;
  json::Value v = json::parse(env, &ok);
  CHECK(ok);
  CHECK_EQ(v.get("v").as_int(), 1L);
  CHECK_EQ(v.get("kind").as_string(), std::string("hello"));
  CHECK_EQ(v.get("body").get("node_id").as_string(), std::string("n"));
}

// --- parsers ------------------------------------------------------------------------------------

static void test_parse_welcome() {
  bool ok = false;
  json::Value v = json::parse(R"({"session_id":"s1","server_t":123,"seq_hi":0,"node_key":"wk-1"})", &ok);
  CHECK(ok);
  WelcomeMsg w = parse_welcome(v);
  CHECK(w.ok);
  CHECK_EQ(w.session_id, std::string("s1"));
  CHECK_EQ(w.node_key, std::string("wk-1"));
  // A malformed / non-object body is tolerated, not fatal.
  CHECK(!parse_welcome(json::Value()).ok);
}

static void test_parse_station_config_with_and_without_item() {
  bool ok = false;
  json::Value v = json::parse(
      R"({"kind":"respawn","team":1,"id":3,"threshold":-70,"game":5,"valid_ids":[3,9]})", &ok);
  CHECK(ok);
  StationAssignment a = parse_station_config(v);
  CHECK(a.present);
  CHECK_EQ(a.kind, std::string("respawn"));
  CHECK_EQ(a.team, 1);
  CHECK_EQ(a.id, 3);
  CHECK_EQ(a.threshold, -70);
  CHECK_EQ(a.game, 5);
  CHECK_EQ(a.valid_ids.size(), (size_t)2);
  CHECK_EQ(a.valid_ids[1], 9);
  CHECK(!a.item.present);  // A56 is additive: absent on an older MC or a non-powerup kind

  // A56, confirmed 2026-09-24: {kind, weapon_id?, charges?, amount?, spawn_every_s, first_at_s, name, color}.
  ok = false;
  json::Value pv = json::parse(
      R"({"kind":"powerup","team":255,"id":8,"item":{"kind":"weapon","weapon_id":"rocket","charges":2,
          "spawn_every_s":90,"first_at_s":30,"name":"ROCKETS","color":"#ff8800"}})",
      &ok);
  CHECK(ok);
  StationAssignment p = parse_station_config(pv);
  CHECK(p.present);
  CHECK(p.item.present);
  CHECK_EQ(p.item.kind, std::string("weapon"));
  CHECK_EQ(p.item.weapon_id, std::string("rocket"));
  CHECK_EQ(p.item.charges, 2L);
  CHECK_EQ(p.item.spawn_every_s, 90);
  CHECK_EQ(p.item.first_at_s, 30);
  CHECK_EQ(p.item.name, std::string("ROCKETS"));
  CHECK_EQ(p.item.color, std::string("#ff8800"));

  // Required fields missing (no `id`): not present, never a crash.
  ok = false;
  json::Value bad = json::parse(R"({"kind":"respawn","team":1})", &ok);
  CHECK(ok);  // valid JSON...
  CHECK(!parse_station_config(bad).present);  // ...but not a valid station_config
}

static void test_item_spawn_every_s_is_clamped_to_the_advert_byte() {
  bool ok = false;
  json::Value v = json::parse(R"({"kind":"weapon","spawn_every_s":0,"first_at_s":0,"name":"X","color":"#fff"})", &ok);
  CHECK(ok);
  CHECK_EQ(parse_item(v).spawn_every_s, 1);
  ok = false;
  v = json::parse(R"({"kind":"weapon","spawn_every_s":9000,"first_at_s":0,"name":"X","color":"#fff"})", &ok);
  CHECK(ok);
  CHECK_EQ(parse_item(v).spawn_every_s, 255);
}

static void test_parse_station_update() {
  bool ok = false;
  json::Value v = json::parse(R"({"id":8,"available":false,"next_spawn_in_ms":45000})", &ok);
  CHECK(ok);
  StationUpdateMsg u = parse_station_update(v);
  CHECK(u.present);
  CHECK_EQ(u.id, 8);
  CHECK(!u.available);
  CHECK_EQ(u.next_spawn_in_ms, 45000L);
  // next_spawn_in_ms is optional (e.g. an "available" update needs none).
  ok = false;
  v = json::parse(R"({"id":8,"available":true})", &ok);
  CHECK(ok);
  StationUpdateMsg u2 = parse_station_update(v);
  CHECK(u2.present);
  CHECK(u2.available);
  CHECK_EQ(u2.next_spawn_in_ms, -1L);
  CHECK(!parse_station_update(json::Value()).present);
}

static void test_parse_control_cmd() {
  bool ok = false;
  json::Value v = json::parse(R"({"cmd":"release_utility"})", &ok);
  CHECK(ok);
  CHECK_EQ(parse_control_cmd(v), std::string("release_utility"));
  CHECK_EQ(parse_control_cmd(json::Value()), std::string(""));
}

// --- station_kind_byte + the threshold default -------------------------------------------------

static void test_station_kind_byte_maps_every_kind() {
  CHECK_EQ(station_kind_byte("respawn"), KIND_RESPAWN);
  CHECK_EQ(station_kind_byte("powerup"), KIND_POWERUP);
  CHECK_EQ(station_kind_byte("extraction"), KIND_EXTRACTION);
  CHECK_EQ(station_kind_byte("bomb"), KIND_BOMB);
  CHECK_EQ(station_kind_byte("control"), KIND_CONTROL);
}

// A phone uses a respawn station only when its advert state is not 0 (engine.js _respawnStation).
static void test_a_respawn_station_advertises_ready_not_disabled() {
  CHECK_EQ(station_static_state("respawn"), (uint8_t)1);
  CHECK_EQ(station_static_state("extraction"), (uint8_t)0);
  CHECK_EQ(station_static_state("bomb"), (uint8_t)0);
}

static void test_threshold_zero_or_absent_means_the_sticks_own_default() {
  bool ok = false;
  json::Value v = json::parse(R"({"kind":"respawn","team":1,"id":1,"threshold":0})", &ok);
  CHECK(ok);
  CHECK_EQ(parse_station_config(v).threshold, STICK_DEFAULT_THRESHOLD_DBM);
  ok = false;
  v = json::parse(R"({"kind":"respawn","team":1,"id":1})", &ok);  // absent entirely
  CHECK(ok);
  CHECK_EQ(parse_station_config(v).threshold, STICK_DEFAULT_THRESHOLD_DBM);
  ok = false;
  v = json::parse(R"({"kind":"respawn","team":1,"id":1,"threshold":-70})", &ok);
  CHECK(ok);
  CHECK_EQ(parse_station_config(v).threshold, -70);
}

// --- the powerup schedule (state/value/taker, self-spawn, NOT pickup mechanics) ------------------

static void test_powerup_schedule_starts_unknown_without_a_report() {
  PowerupSchedule s;
  CHECK(!s.available());
  CHECK(!s.known());
  CHECK(!s.tick(60000));
  PowerupAdvertView v = s.view(5000);
  CHECK_EQ(v.state, (uint8_t)0);
  CHECK_EQ(v.value, (uint8_t)0);
  CHECK_EQ(v.taker, (uint8_t)0);
  StationUpdateMsg u; u.present = true; u.available = true;
  s.apply_update(u, 60000);
  CHECK(s.known());
  CHECK(s.available());
}

static void test_powerup_schedule_taken_counts_down_locally_from_the_last_update() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;
  u.next_spawn_in_ms = 10000;  // 10 s, as of received_at_ms
  s.apply_update(u, 100000);
  CHECK(!s.available());
  PowerupAdvertView v0 = s.view(100000);  // just received
  CHECK_EQ(v0.state, (uint8_t)0);
  CHECK_EQ(v0.value, (uint8_t)10);
  PowerupAdvertView v1 = s.view(104001);  // 4.001 s later: 6 s left (ceiling)
  CHECK_EQ(v1.value, (uint8_t)6);
  PowerupAdvertView v2 = s.view(130000);  // long past due: never negative
  CHECK_EQ(v2.value, (uint8_t)0);
}

static void test_powerup_schedule_caps_value_at_255() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;
  u.next_spawn_in_ms = 999000;
  s.apply_update(u, 0);
  CHECK_EQ(s.view(0).value, (uint8_t)255);
}

static void test_powerup_schedule_self_spawns_when_mc_is_unreachable() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;
  u.next_spawn_in_ms = 5000;
  s.apply_update(u, 0);
  CHECK(!s.tick(4999));   // not due yet
  CHECK(!s.available());
  CHECK(s.tick(5000));    // crosses the anchor: fires exactly once
  CHECK(s.available());
  CHECK(!s.tick(6000));   // already available: no repeat firing
  CHECK_EQ(s.view(5000).state, (uint8_t)1);
}

static void test_a_claim_marks_taken_and_folds_the_next_spawn_forward() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  s.apply_update(u, 0);  // anchor at t=1000
  s.tick(1000);          // now available at t=1000
  CHECK(s.available());
  s.mark_taken(/*player_num=*/7, 1000);  // claimed the instant it spawned
  CHECK(!s.available());
  CHECK_EQ(s.taker(), (uint8_t)7);
  PowerupAdvertView v = s.view(1000);
  CHECK_EQ(v.taker, (uint8_t)7);
  // spawn_every_s defaults to 60 s: the next instant is 60 s after the ORIGINAL anchor (t=1000,
  // i.e. t=61000), not "now + 60 s" -- a fixed schedule, not a cooldown after the grant.
  CHECK_EQ(v.value, (uint8_t)60);  // 61000 - 1000 = 60000 ms = 60 s
}

static void test_mark_taken_never_double_spawns_an_instant_already_passed() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  s.apply_update(u, 0);  // anchor at t=1000, spawn_every_s defaults to 60 s (60000 ms)
  // Claimed very late (t=200000): naive "anchor + period" (61000) would already be in the past.
  s.tick(200000);
  s.mark_taken(3, 200000);
  PowerupAdvertView v = s.view(200000);
  CHECK(v.value > 0);  // the next spawn is genuinely in the future, not an instant already gone
}

static void test_mc_available_true_clears_the_taker() {
  PowerupSchedule s;
  StationUpdateMsg taken;
  taken.present = true;
  taken.available = false;
  taken.next_spawn_in_ms = 1000;
  s.apply_update(taken, 0);
  s.mark_taken(5, 500);
  CHECK_EQ(s.taker(), (uint8_t)5);
  StationUpdateMsg reset;
  reset.present = true;
  reset.available = true;
  reset.reset = true;  // polish round 2: a bare available:true for the SAME spawn is now refused;
                        // this must say it is an actual operator RESET to be honoured
  s.apply_update(reset, 600);  // MC's answer to a RESET
  CHECK(s.available());
  CHECK_EQ(s.taker(), (uint8_t)0);
}

static void test_item_configures_the_schedules_spawn_period() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  a.item.present = true;
  a.item.kind = "weapon";
  a.item.spawn_every_s = 90;
  link.apply_station_config(a);
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  link.apply_station_update(u, 0);
  link.powerup().tick(1000);
  link.powerup().mark_taken(1, 1000);
  // the next spawn is 90 s (the item's spawn_every_s) after the anchor (t=1000), i.e. t=91000
  CHECK_EQ(link.powerup().view(1000).value, (uint8_t)90);  // 91000 - 1000 = 90000 ms = 90 s
}

// --- the claim gate (award logic only; no dwell timing here per brx5's clarification) ------------

static void test_claim_gate_awards_the_first_ready_advert_for_its_own_id() {
  ClaimGate g;
  g.configure(/*station_id=*/8, /*game=*/3);
  g.observe(/*player_num=*/5, /*target_station_id=*/9, /*game=*/3, false, true, true, -50);  // wrong station
  g.observe(5, 8, 9, false, true, true, -50);   // right station, wrong game
  ClaimWinner none = g.resolve_batch();
  CHECK(!none.won);
  // No RSSI floor (Tony, 2026-09-24: pickups must work; the Stick hears phones at -75 to -91 even
  // nearby): the phone's claim_ready already proves it is at the station. A weak reading still wins.
  g.observe(5, 8, 3, false, true, true, -92);
  ClaimWinner w = g.resolve_batch();
  CHECK(w.won);
  CHECK_EQ(w.player_num, (uint8_t)5);
}

static void test_ready_claim_resolves_after_short_tie_window() {
  ClaimGate g;
  g.configure(8, 3);
  g.observe(7, 8, 3, true, true, true, -80, 1000);
  CHECK(!g.ready_due(1099));
  g.observe(4, 8, 3, true, true, true, -80, 1050);
  CHECK(g.ready_due(1100));
  ClaimWinner w = g.resolve_batch();
  CHECK(w.won);
  CHECK_EQ(w.player_num, (uint8_t)7);  // the later player cannot take the first ready claim
  CHECK(!g.ready_due(1200));
  g.observe(7, 8, 3, true, true, true, -80, 2000);
  g.observe(4, 8, 3, true, true, true, -80, 2000);
  CHECK_EQ(g.resolve_batch().player_num, (uint8_t)4);  // equal timestamp: lower player wins
}

static void test_claim_feed_pause_discards_a_pending_ready_candidate() {
  StationLink link;
  StationAssignment a;
  a.present = true; a.kind = "powerup"; a.id = 8; a.game = 2;
  link.apply_station_config(a);
  link.claims().observe(7, 8, 2, true, true, true, -80, 1000);
  link.discard_claim_batch();  // glue pauses the BLE callback before config, release or a spawn update
  CHECK(!link.claims().ready_due(1200));
  a.game = 3;
  link.apply_station_config(a);
  link.claims().observe(4, 8, 3, true, true, true, -80, 2000);
  CHECK(link.claims().ready_due(2100));
  CHECK_EQ(link.claims().resolve_batch().player_num, (uint8_t)4);
}

static void test_same_powerup_lock_config_keeps_pending_claim() {
  StationLink link;
  StationAssignment a;
  a.present = true; a.kind = "powerup"; a.id = 8; a.game = 2;
  a.item.present = true; a.item.kind = "weapon"; a.item.weapon_id = "rocket";
  a.item.spawn_every_s = 60;
  link.apply_station_config(a, 1000);
  link.claims().observe(7, 8, 2, true, true, true, -80, 1000);

  StationAssignment lock_only = a;
  lock_only.lock_s = 30;
  CHECK(same_powerup_claim_scope(link.assignment(), lock_only));
  // Glue pauses the callback but keeps this candidate for a same-scope config.
  link.apply_station_config(lock_only, 1050);
  CHECK(link.claims().ready_due(1100));
  CHECK_EQ(link.claims().resolve_batch().player_num, (uint8_t)7);

  link.claims().observe(7, 8, 2, true, true, true, -80, 2000);
  StationAssignment changed_item = lock_only;
  changed_item.item.weapon_id = "rail";
  CHECK(!same_powerup_claim_scope(link.assignment(), changed_item));
  link.discard_claim_batch();  // glue discards claims for the prior item
  link.apply_station_config(changed_item, 2050);
  CHECK(!link.claims().ready_due(2100));
  link.claims().observe(4, 8, 2, true, true, true, -80, 2200);
  CHECK(link.claims().ready_due(2300));
  CHECK_EQ(link.claims().resolve_batch().player_num, (uint8_t)4);
}

static void test_claim_award_is_visible_to_the_next_advert_decision() {
  constexpr uint32_t ready_at_ms = 1234;
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  link.apply_station_config(a);
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = true;
  link.apply_station_update(u, ready_at_ms);
  link.claims().configure(8, 0);
  link.claims().observe(7, 8, 0, true, true, true, -80);
  link.claims().observe(4, 8, 0, true, true, true, -80, 1);  // the same scan still has one winner
  ClaimWinner winner = link.claims().resolve_batch();
  CHECK(winner.won);
  CHECK(link.award_claim(winner, ready_at_ms));
  CHECK(!link.claims().resolve_batch().won);
  CHECK(!link.award_claim(ClaimWinner{true, 4}, ready_at_ms));  // this spawn cannot grant twice
  PowerupAdvertView pickup = link.powerup().view(ready_at_ms);
  CHECK_EQ(pickup.taker, (uint8_t)7);
  AdvertPolicy policy;
  AdvertView v;
  v.kind = KIND_POWERUP;
  v.id = 8;
  v.taker = pickup.taker;
  CHECK(std::string(policy.due(v, ready_at_ms)) == "first");
  policy.published(v, ready_at_ms);
  v.taker = 0;
  CHECK(std::string(policy.due(v, ready_at_ms + 1)) == "state");
}

static void test_claim_gate_ties_in_one_batch_go_to_the_lower_player_num() {
  ClaimGate g;
  g.configure(8, 0);
  g.observe(9, 8, 0, false, true, true, -50);
  g.observe(3, 8, 0, false, true, true, -50);
  g.observe(20, 8, 0, false, true, true, -50);
  ClaimWinner w = g.resolve_batch();
  CHECK(w.won);
  CHECK_EQ(w.player_num, (uint8_t)3);
}

static void test_claim_gate_a_batch_with_no_ready_advert_awards_nothing() {
  ClaimGate g;
  g.configure(8, 0);
  g.observe(5, 8, 0, /*claiming=*/true, /*claim_ready=*/false, true, -50);  // dwelling, not ready yet
  CHECK(g.any_claiming_this_batch());
  ClaimWinner w = g.resolve_batch();
  CHECK(!w.won);
  CHECK(!g.any_claiming_this_batch());  // resolve_batch clears it for the next batch
}

// M2 (polish 2026-09-24): a DOWN claimant's claim_ready is ignored, as on the phone station
// (powerup.js), and player 0 ("nobody" on the wire) never wins.
static void test_claim_gate_ignores_a_dead_claimant_and_player_zero() {
  ClaimGate g;
  g.configure(8, 0);
  g.observe(/*player_num=*/4, 8, 0, true, /*claim_ready=*/true, /*alive=*/false, -50);  // dead: ignored
  g.observe(0, 8, 0, true, true, true, -50);                                          // player 0: ignored
  CHECK(!g.resolve_batch().won);
  g.observe(4, 8, 0, true, true, /*alive=*/true, -50);
  ClaimWinner w = g.resolve_batch();
  CHECK(w.won);
  CHECK_EQ((int)w.player_num, 4);
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  link.apply_station_config(a, 0);
  StationUpdateMsg u;  // F374: a fresh arm starts unknown; feed MC's first update so this test still
  u.present = true;    // checks what it was written for (a no-player win is not an award).
  u.id = 8;
  u.available = true;
  link.apply_station_update(u, 50);
  ClaimWinner zero;
  zero.won = true;  // a winner with no player is not an award
  CHECK(!link.award_claim(zero, 100));
  CHECK(link.powerup().available());
}

static void test_claim_gate_unscoped_game_zero_matches_anything() {
  ClaimGate g;
  g.configure(8, 0);  // this station's own game byte is 0 (unscoped)
  g.observe(5, 8, 7, false, true, true, -50);  // the claimant's game is scoped; still matches
  CHECK(g.resolve_batch().won);
}

// --- the link state machine ----------------------------------------------------------------------

static void test_link_walks_through_every_state_in_order() {
  StationLink link;
  CHECK(link.state() == LinkState::NOT_CONFIGURED);
  link.wifi_configured();
  CHECK(link.state() == LinkState::JOINING_WIFI);
  link.wifi_up();
  CHECK(link.state() == LinkState::LOOKING_FOR_MC);
  link.mc_address_known();
  CHECK(link.state() == LinkState::CONNECTING);
  link.ws_open_hello_sent();
  CHECK(link.state() == LinkState::HELLO_SENT);
  link.apply_welcome({true, "sess", "wk-1"});
  CHECK(link.state() == LinkState::WELCOMED);
  CHECK_EQ(link.identity().node_key, std::string("wk-1"));
  StationAssignment a;
  a.present = true;
  a.kind = "respawn";
  a.team = 1;
  a.id = 3;
  CHECK(link.apply_station_config(a));  // first assignment: reports "changed"
  CHECK(link.state() == LinkState::ASSIGNED);
  CHECK(!link.apply_station_config(a));  // the exact same assignment again: nothing changed
}

static void test_ws_closed_never_discards_identity_or_assignment() {
  StationLink link;
  link.wifi_configured();
  link.wifi_up();
  link.mc_address_known();
  link.ws_open_hello_sent();
  link.apply_welcome({true, "sess", "wk-1"});
  StationAssignment a;
  a.present = true;
  a.kind = "control";
  a.id = 9;
  link.apply_station_config(a);
  CHECK(link.state() == LinkState::ASSIGNED);
  link.ws_closed();
  CHECK(link.state() == LinkState::LOOKING_FOR_MC);
  CHECK_EQ(link.identity().node_key, std::string("wk-1"));  // §5g.4: never discarded on a drop
  CHECK(link.assignment().present && link.assignment().id == 9);  // ...nor is the assignment
}

static void test_wifi_down_from_not_configured_stays_not_configured() {
  StationLink link;
  link.wifi_down();  // never configured in the first place: nothing to "join" again
  CHECK(link.state() == LinkState::NOT_CONFIGURED);
}

static void test_release_drops_to_unassigned_but_keeps_the_link() {
  StationLink link;
  link.wifi_configured();
  link.wifi_up();
  link.mc_address_known();
  link.ws_open_hello_sent();
  link.apply_welcome({true, "sess", "wk-1"});
  StationAssignment a;
  a.present = true;
  a.kind = "respawn";
  a.id = 1;
  link.apply_station_config(a);
  link.apply_release();
  CHECK(link.state() == LinkState::WELCOMED);   // §5g.7: the nearest equivalent of BACK TO HUD
  CHECK(!link.assignment().present);
  CHECK_EQ(link.identity().node_key, std::string("wk-1"));  // the MC LINK survives a release
}

static void test_station_update_applies_only_to_the_currently_assigned_id() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  link.apply_station_config(a);
  StationUpdateMsg u;
  u.present = true;
  u.id = 9;  // a stray update for a DIFFERENT id (this Stick was reassigned away from it)
  u.available = false;
  CHECK(!link.apply_station_update(u, 1000));
  CHECK(!link.last_update().present);
  u.id = 8;
  CHECK(link.apply_station_update(u, 1000));
  CHECK(link.last_update().present);
}

// Polish round 1 (2026-09-24): powerup -> control -> powerup must start CLEAN. Before the fix,
// `apply_station_config` only reset the schedule when the NEW kind was "powerup", so switching away
// and back left the first powerup's taken/taker state sitting there for the second one to inherit.
static void test_switching_away_and_back_to_powerup_resets_the_schedule() {
  StationLink link;
  StationAssignment p1;
  p1.present = true;
  p1.kind = "powerup";
  p1.id = 8;
  link.apply_station_config(p1);
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  link.apply_station_update(u, 0);
  link.powerup().tick(1000);
  link.powerup().mark_taken(5, 1000);
  CHECK(!link.powerup().available());
  CHECK_EQ(link.powerup().taker(), (uint8_t)5);

  StationAssignment c;
  c.present = true;
  c.kind = "control";
  c.id = 8;  // same id, different kind
  link.apply_station_config(c);

  StationAssignment p2;
  p2.present = true;
  p2.kind = "powerup";
  p2.id = 8;
  link.apply_station_config(p2);
  StationUpdateMsg u2;  // F374: the re-arm starts unknown; MC's first update since the switch back
  u2.present = true;    // proves the reset, not the first powerup's leftover state.
  u2.id = 8;
  u2.available = true;
  link.apply_station_update(u2, 2000);
  CHECK(link.powerup().available());
  CHECK_EQ(link.powerup().taker(), (uint8_t)0);
}

// The same rule for an ID change with the kind held constant (a re-id, not a re-kind).
static void test_reassigning_a_powerup_to_a_new_id_resets_the_schedule() {
  StationLink link;
  StationAssignment p1;
  p1.present = true;
  p1.kind = "powerup";
  p1.id = 8;
  link.apply_station_config(p1);
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  link.apply_station_update(u, 0);
  link.powerup().tick(1000);
  link.powerup().mark_taken(3, 1000);
  CHECK_EQ(link.powerup().taker(), (uint8_t)3);

  StationAssignment p2;
  p2.present = true;
  p2.kind = "powerup";
  p2.id = 9;  // same kind, different id
  link.apply_station_config(p2);
  StationUpdateMsg u2;  // F374: the re-arm starts unknown; MC's first update for the new id proves the reset.
  u2.present = true;
  u2.id = 9;
  u2.available = true;
  link.apply_station_update(u2, 2000);
  CHECK(link.powerup().available());
  CHECK_EQ(link.powerup().taker(), (uint8_t)0);
}

// CONTROL: a re-arm that changes neither kind nor id (team/game only) must NOT reset an in-progress
// schedule -- an operator bumping the game byte at muster must not un-claim a live item.
static void test_a_new_game_resets_the_schedule_but_a_same_game_repush_does_not() {
  StationLink link;
  StationAssignment p1;
  p1.present = true;
  p1.kind = "powerup";
  p1.id = 8;
  p1.game = 1;
  link.apply_station_config(p1);
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  link.apply_station_update(u, 0);
  link.powerup().tick(1000);
  link.powerup().mark_taken(3, 1000);

  // the same config pushed again (same game): the schedule and its taker survive
  CHECK(!link.apply_station_config(p1));
  CHECK_EQ(link.powerup().taker(), (uint8_t)3);
  // a new game is a new match: the last match's taker and anchor must not carry over (round 3)
  StationAssignment p2 = p1;
  p2.game = 2;
  CHECK(link.apply_station_config(p2));
  CHECK_EQ(link.powerup().taker(), (uint8_t)0);
}

static void test_switching_to_held_clears_a_muster_drop() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "control";
  a.id = 2;
  a.game = 1;
  link.apply_station_config(a);   // muster (the default): the first arm latches the drop
  CHECK(link.dropped_for_match());
  link.set_mode(AssocMode::HELD);
  CHECK(!link.dropped_for_match());
}

static void test_muster_drops_the_link_at_match_start_held_does_not() {
  StationLink muster;  // the default
  CHECK(muster.mode() == AssocMode::MUSTER);
  CHECK(muster.should_drop_link_at_match_start());
  StationLink held;
  held.set_mode(AssocMode::HELD);
  CHECK(!held.should_drop_link_at_match_start());
}

// --- polish round 2, item 1 (CRITICAL): survives a link drop ------------------------------------

static void test_has_powerup_assignment_survives_a_link_drop() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  link.apply_station_config(a);
  CHECK(link.has_powerup_assignment());
  link.ws_closed();  // simulate the link dropping (state -> LOOKING_FOR_MC)
  CHECK(link.state() != LinkState::ASSIGNED);
  CHECK(link.has_powerup_assignment());  // the assignment itself is untouched
}

static void test_self_spawn_still_ticks_after_a_link_drop() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  link.apply_station_config(a);
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  link.apply_station_update(u, 0);
  link.ws_closed();
  CHECK(link.state() != LinkState::ASSIGNED);
  CHECK(!link.powerup().available());
  CHECK(link.tick_powerup(1000));  // fires even though the link is down
  CHECK(link.powerup().available());
}

static void test_claim_still_awards_after_a_link_drop() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  link.apply_station_config(a);
  StationUpdateMsg u;  // F374: a fresh arm starts unknown; MC's first update makes it available to claim.
  u.present = true;
  u.id = 8;
  u.available = true;
  link.apply_station_update(u, 500);
  link.ws_closed();
  CHECK(link.state() != LinkState::ASSIGNED);
  ClaimWinner w{true, 5};
  CHECK(link.award_claim(w, 1000));  // still awards -- the advert's `taker` must not depend on the link
  CHECK_EQ(link.powerup().taker(), (uint8_t)5);
  CHECK(link.has_pending_actions());  // the report is queued for whenever the socket comes back
}

static void test_a_non_powerup_assignment_never_reports_a_powerup_assignment() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "control";
  a.id = 8;
  link.apply_station_config(a);
  CHECK(!link.has_powerup_assignment());
}

// --- polish round 2, item 2 (CRITICAL): the muster edge and the reconnect latch ------------------

static void test_the_first_ever_arm_sets_dropped_for_match_under_muster() {
  StationLink link;  // MUSTER is the default
  CHECK(!link.dropped_for_match());
  StationAssignment a;
  a.present = true;
  a.kind = "respawn";
  a.id = 3;
  a.game = 1;  // MC's game byte is never 0 -- this IS the first real arm
  link.apply_station_config(a);
  CHECK(link.dropped_for_match());  // 0 -> 1 counts as a new match, not just N -> M
}

static void test_held_never_sets_dropped_for_match() {
  StationLink link;
  link.set_mode(AssocMode::HELD);
  StationAssignment a;
  a.present = true;
  a.kind = "respawn";
  a.id = 3;
  a.game = 1;
  link.apply_station_config(a);
  CHECK(!link.dropped_for_match());
}

static void test_a_same_game_repush_does_not_set_dropped_for_match() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "respawn";
  a.id = 3;
  a.game = 1;
  link.apply_station_config(a);
  link.clear_dropped_for_match();  // as if the operator already reconnected it after match 1's muster
  StationAssignment edit = a;
  edit.threshold = -60;  // an edit at muster, SAME match: game is unchanged
  link.apply_station_config(edit);
  CHECK(!link.dropped_for_match());
}

static void test_dropped_for_match_latches_until_explicitly_cleared() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "respawn";
  a.id = 3;
  a.game = 1;
  link.apply_station_config(a);
  CHECK(link.dropped_for_match());
  link.clear_dropped_for_match();
  CHECK(!link.dropped_for_match());
}

static void test_a_new_game_number_sets_dropped_for_match_again_after_a_reconnect() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "respawn";
  a.id = 3;
  a.game = 1;
  link.apply_station_config(a);    // match 1's muster
  link.clear_dropped_for_match();  // the operator's explicit LINK RECONNECT, back at the table
  StationAssignment a2 = a;
  a2.game = 2;  // match 2's muster push
  link.apply_station_config(a2);
  CHECK(link.dropped_for_match());
}

// --- polish round 2, item 3 (HIGH): the pending station_action queue ----------------------------

static void test_pending_action_queue_is_fifo_and_drops_the_oldest_when_full() {
  PendingActionQueue q;
  for (int i = 0; i < 10; i++) q.push(9, i + 1, (uint32_t)(1000 * i), 1000 + i);
  CHECK_EQ(q.size(), PendingActionQueue::CAPACITY);
  PendingTakenReport out;
  CHECK(q.pop_front(out));
  CHECK_EQ(out.player_num, 3);  // the two oldest (i=0,1) were evicted to make room
}

static void test_pending_action_queue_newest_per_spawn_instant_wins() {
  PendingActionQueue q;
  q.push(9, 5, 1000, 100);
  q.push(9, 7, 1000, 200);  // same station + spawn instant: replaces, does not append
  CHECK_EQ(q.size(), (size_t)1);
  PendingTakenReport out;
  CHECK(q.pop_front(out));
  CHECK_EQ(out.player_num, 7);
  CHECK_EQ(out.t_ms, (int64_t)200);
}

static void test_pending_action_queue_pop_front_on_empty_queue_fails() {
  PendingActionQueue q;
  PendingTakenReport out;
  CHECK(!q.pop_front(out));
}

static void test_award_claim_enqueues_with_the_station_id_captured_at_award_time() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  link.apply_station_config(a);
  StationUpdateMsg u;  // F374: a fresh arm starts unknown; MC's first update makes it available to claim.
  u.present = true;
  u.id = 8;
  u.available = true;
  link.apply_station_update(u, 500);
  ClaimWinner w{true, 5};
  CHECK(link.award_claim(w, 1000));
  PendingTakenReport out;
  CHECK(link.pop_pending_action(out));
  CHECK_EQ(out.station_id, 8);
  CHECK_EQ(out.player_num, 5);
  CHECK(!link.has_pending_actions());  // drained
}

// A56 (brx5): unsent taken reports belong to their game; a new game drops them, a same-game re-push keeps them.
static void test_a_new_game_clears_unsent_taken_reports() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  a.game = 1;
  link.apply_station_config(a);
  StationUpdateMsg u;  // F374: a fresh arm starts unknown; MC's first update makes it available to claim.
  u.present = true;
  u.id = 8;
  u.available = true;
  link.apply_station_update(u, 500);
  ClaimWinner w{true, 5};
  CHECK(link.award_claim(w, 1000));
  link.apply_station_config(a);            // same game, pushed again
  CHECK(link.has_pending_actions());
  StationAssignment b = a;
  b.game = 2;
  link.apply_station_config(b);            // a new game
  CHECK(!link.has_pending_actions());
}

// --- polish round 2, item 4 (brx5, A56): refuse a stale available:true for the awarded spawn -----

static void test_a_bare_available_true_for_the_awarded_spawn_is_refused() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  s.apply_update(u, 0);   // anchor at t=1000
  s.mark_taken(5, 1000);  // awarded instant = 1000
  StationUpdateMsg stale;
  stale.present = true;
  stale.available = true;  // no reset, no next_spawn: an ambiguous, unproven "available" echo
  s.apply_update(stale, 1100);
  CHECK(!s.available());  // refused: still taken
  CHECK_EQ(s.taker(), (uint8_t)5);
}

static void test_an_available_true_too_soon_after_the_awarded_instant_is_refused() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  s.apply_update(u, 0);
  s.mark_taken(5, 1000);  // awarded instant = 1000; spawn_every_s defaults to 60 (half interval 30000 ms)
  StationUpdateMsg tooSoon;
  tooSoon.present = true;
  tooSoon.available = true;
  tooSoon.next_spawn_in_ms = 5000;  // implies the next spawn is at 1100 + 5000 = 6100 (5100 ms past 1000)
  s.apply_update(tooSoon, 1100);
  CHECK(!s.available());  // 5100 ms < half of 60 s: still refused
  CHECK_EQ(s.taker(), (uint8_t)5);
}

static void test_an_available_true_far_enough_past_the_awarded_instant_is_accepted() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  s.apply_update(u, 0);
  s.mark_taken(5, 1000);  // awarded instant = 1000; half interval = 30000 ms
  StationUpdateMsg later;
  later.present = true;
  later.available = true;
  later.next_spawn_in_ms = 30000;  // implies the next spawn is at 1000 + 30000 = 31000 (30000 ms past)
  s.apply_update(later, 1000);
  CHECK(s.available());  // at the half-interval boundary: accepted
  CHECK_EQ(s.taker(), (uint8_t)0);
}

static void test_reset_true_is_always_accepted_regardless_of_timing() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  s.apply_update(u, 0);
  s.mark_taken(5, 1000);
  StationUpdateMsg reset;
  reset.present = true;
  reset.available = true;
  reset.reset = true;
  reset.next_spawn_in_ms = 5000;  // "a reset keeps the fixed next spawn": MC's own value is trusted as-is
  s.apply_update(reset, 1100);
  CHECK(s.available());
  CHECK_EQ(s.taker(), (uint8_t)0);
}

static void test_should_accept_available_with_nothing_awarded_always_accepts() {
  PowerupSchedule s;  // fresh: nothing has ever been locally claimed
  CHECK(s.should_accept_available(false, -1, 0));
  CHECK(s.should_accept_available(false, 100, 12345));
}

static void test_backoff_doubles_and_caps_and_resets_on_welcome() {
  StationLink link;
  Backoff& b = link.backoff();
  CHECK_EQ(b.next(0.5f), 500u);   // rand01 = 0.5 -> no jitter offset
  CHECK_EQ(b.next(0.5f), 1000u);
  CHECK_EQ(b.next(0.5f), 2000u);
  CHECK_EQ(b.next(0.5f), 4000u);
  CHECK_EQ(b.next(0.5f), 8000u);
  CHECK_EQ(b.next(0.5f), 10000u);   // 16000 would exceed the 10 s cap
  CHECK_EQ(b.next(0.5f), 10000u);   // stays capped
  // jitter is +-20%: rand01=0 -> -20%, rand01=1 -> +20%, at the base interval (attempt 0)
  Backoff fresh;
  CHECK_EQ(fresh.next(0.0f), 400u);
  fresh.reset();
  CHECK_EQ(fresh.next(1.0f), 600u);
  link.apply_welcome({true, "sess", "wk-1"});
  CHECK_EQ(link.backoff().attempt, 0u);  // A28.3 / transport.js: resets on welcome
}

// --- A58: the match lock ---------------------------------------------------------------------------

static void test_parse_station_config_lock_s_is_clamped_and_absent_means_zero() {
  bool ok = false;
  json::Value v = json::parse("{\"kind\":\"powerup\",\"team\":255,\"id\":8}", &ok);
  CHECK(ok);
  CHECK_EQ(parse_station_config(v).lock_s, 0);
  v = json::parse("{\"kind\":\"powerup\",\"team\":255,\"id\":8,\"lock_s\":600}", &ok);
  CHECK_EQ(parse_station_config(v).lock_s, 600);
  v = json::parse("{\"kind\":\"powerup\",\"team\":255,\"id\":8,\"lock_s\":99999}", &ok);
  CHECK_EQ(parse_station_config(v).lock_s, MATCH_LOCK_MAX_S);
  v = json::parse("{\"kind\":\"powerup\",\"team\":255,\"id\":8,\"lock_s\":-5}", &ok);
  CHECK_EQ(parse_station_config(v).lock_s, 0);
  // Far out of a 32-bit long's range: must lock for the cap, never wrap to an unlock.
  v = json::parse("{\"kind\":\"powerup\",\"team\":255,\"id\":8,\"lock_s\":3e12}", &ok);
  CHECK_EQ(parse_station_config(v).lock_s, MATCH_LOCK_MAX_S);
}

static void test_match_lock_counts_down_and_auto_unlocks_once() {
  MatchLock l;
  CHECK(!l.locked(0));  // a boot starts unlocked
  l.start(10, 1000);
  CHECK(l.locked(1000));
  CHECK_EQ(l.remaining_s(1000), 10u);
  CHECK_EQ(l.remaining_s(10999), 1u);  // rounded up: never reads 0 while still locked
  CHECK(!l.poll(10999));
  CHECK(l.locked(10999));
  CHECK(l.poll(11000));   // the unlock edge, exactly once
  CHECK(!l.poll(11001));
  CHECK(!l.locked(11001));
  CHECK_EQ(l.remaining_s(11001), 0u);
}

static void test_match_lock_is_wrap_safe() {
  MatchLock l;
  uint32_t near_wrap = 0xFFFFFFFFu - 2000u;
  l.start(5, near_wrap);  // ends ~3000 ms after millis() wraps
  CHECK(l.locked(near_wrap + 4000u));  // wrapped, still locked
  CHECK(!l.poll(near_wrap + 4000u));
  CHECK(l.poll(near_wrap + 5000u));
}

static void test_match_lock_is_replaced_not_extended_and_zero_unlocks() {
  MatchLock l;
  l.start(600, 0);
  l.start(5, 1000);  // a later config REPLACES the running lock, even with a shorter one
  CHECK_EQ(l.remaining_s(1000), 5u);
  CHECK(!l.locked(6000));
  l.start(600, 7000);
  l.start(0, 8000);  // lock_s 0 unlocks at once
  CHECK(!l.locked(8000));
  CHECK(!l.poll(8000));  // an explicit unlock is not a countdown edge
}

// A same-game re-push is MC's mid-match lock carrier: it must replace the lock and keep the schedule,
// the claim batch in flight and the muster latch exactly as they were.
static void test_a_same_game_repush_replaces_the_lock_and_keeps_everything_else() {
  StationLink link;  // MUSTER, the default
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  a.game = 3;
  a.lock_s = 0;
  link.apply_station_config(a, 0);
  CHECK(link.dropped_for_match());
  CHECK(!link.lock().locked(0));
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 1000;
  link.apply_station_update(u, 0);
  link.powerup().tick(1000);
  link.powerup().mark_taken(3, 1000);
  uint32_t anchor_before = link.powerup().anchor_ms();
  link.claims().observe(/*player_num=*/4, /*target=*/8, /*game=*/3, true, true, true, -60);  // a batch in flight

  StationAssignment again = a;
  again.lock_s = 900;
  CHECK(!link.apply_station_config(again, 2000));   // no advert field moved
  CHECK(link.lock().locked(2000));                  // the lock was replaced ...
  CHECK_EQ(link.lock().remaining_s(2000), 900u);
  CHECK_EQ(link.powerup().taker(), (uint8_t)3);     // ... and the schedule kept
  CHECK(!link.powerup().available());
  CHECK_EQ(link.powerup().anchor_ms(), anchor_before);
  CHECK(link.dropped_for_match());                  // the muster latch kept
  ClaimWinner w = link.claims().resolve_batch();    // the claim batch kept
  CHECK(w.won);
  CHECK_EQ(w.player_num, (uint8_t)4);

  StationAssignment unlock = a;
  unlock.lock_s = 0;
  link.apply_station_config(unlock, 3000);
  CHECK(!link.lock().locked(3000));
  CHECK_EQ(link.powerup().taker(), (uint8_t)3);
}

static void test_release_lifts_the_lock() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "control";
  a.id = 2;
  a.lock_s = 600;
  link.apply_station_config(a, 0);
  CHECK(link.lock().locked(1000));
  link.apply_release();
  CHECK(!link.lock().locked(1000));
}

static void test_status_body_carries_health_fields_only_when_set() {
  StatusFields f;
  f.node_id = "s";
  f.app_ver = "v";
  f.has_health = true;
  f.uptime_s = 1234;
  f.boot_count = 7;
  f.assoc = "held";
  f.lock_s = 42;
  CHECK_EQ(build_status_body(f),
           std::string("{\"node_id\":\"s\",\"arm_state\":\"connected\",\"synced\":false,"
                       "\"role\":\"utility\",\"kind\":\"respawn\",\"team\":255,\"station_id\":0,"
                       "\"threshold\":-57,\"live\":false,\"armed\":false,\"app_ver\":\"v\","
                       "\"platform\":\"esp32\",\"uptime_s\":1234,\"boot_count\":7,\"assoc\":\"held\",\"lock_s\":42}"));
  StatusFields plain;
  plain.node_id = "s";
  plain.app_ver = "v";
  std::string b = build_status_body(plain);
  CHECK(b.find("uptime_s") == std::string::npos && b.find("lock_s") == std::string::npos);
}

// --- restart survival: the saved station_config (Tony, 2026-09-24) ---------------------------------

static StationAssignment powerup_config(int game, int lock_s) {
  bool ok = false;
  std::string body = R"({"kind":"powerup","team":255,"id":8,"threshold":-61,"game":)" + std::to_string(game) +
                     R"(,"valid_ids":[3,4],"lock_s":)" + std::to_string(lock_s) +
                     R"(,"item":{"kind":"weapon","weapon_id":"rail","charges":3,"spawn_every_s":45,"first_at_s":30,"name":"RAIL \"X\"","color":"#ff8800"}})";
  StationAssignment a = parse_station_config(json::parse(body, &ok));
  CHECK(ok);
  return a;
}

static void test_saved_config_round_trips_without_lock_s() {
  SavedStationConfig saved;
  StationAssignment a = powerup_config(7, 900);
  CHECK(saved.note_applied(a, "s1"));
  CHECK(saved.stored().find("lock_s") == std::string::npos);
  StationAssignment r = saved.restore();
  CHECK(r.present);
  CHECK_EQ(r.kind, std::string("powerup"));
  CHECK_EQ(r.team, 255);
  CHECK_EQ(r.id, 8);
  CHECK_EQ(r.threshold, -61);
  CHECK_EQ(r.game, 7);
  CHECK_EQ(r.valid_ids.size(), (size_t)2);
  CHECK_EQ(r.lock_s, 0);
  CHECK(r.item.present);
  CHECK_EQ(r.item.weapon_id, std::string("rail"));
  CHECK_EQ(r.item.charges, 3L);
  CHECK_EQ(r.item.spawn_every_s, 45);
  CHECK_EQ(r.item.first_at_s, 30);
  CHECK_EQ(r.item.name, std::string("RAIL \"X\""));
  CHECK_EQ(r.item.color, std::string("#ff8800"));
  // What flash would hold survives a reboot: a fresh mirror loaded with the stored body restores the same.
  SavedStationConfig boot;
  boot.loaded(saved.stored());
  CHECK_EQ(station_config_storage_body(boot.restore()), saved.stored());
}

static void test_a_same_config_repush_with_a_new_lock_does_not_rewrite_storage() {
  SavedStationConfig saved;
  int writes = 0;
  if (saved.note_applied(powerup_config(7, 900), "s1")) writes++;
  if (saved.note_applied(powerup_config(7, 600), "s1")) writes++;  // MC's lock carrier: same config, new lock
  if (saved.note_applied(powerup_config(7, 0), "s1")) writes++;    // and the unlock
  CHECK_EQ(writes, 1);
  if (saved.note_applied(powerup_config(8, 0), "s1")) writes++;    // a new game IS a new config
  CHECK_EQ(writes, 2);
}

static void test_a_restored_assignment_applies_unlocked_and_never_latches_the_muster_drop() {
  SavedStationConfig saved;
  saved.note_applied(powerup_config(7, 900), "s1");
  StationLink link;  // MUSTER, the default
  CHECK(link.restore_station_config(saved.restore()));
  CHECK(link.restored());
  CHECK(link.assignment().present);
  CHECK(link.has_powerup_assignment());
  CHECK(!link.lock().locked(0));
  CHECK(!link.dropped_for_match());
  CHECK(link.powerup().available());
  CHECK(link.state() != LinkState::ASSIGNED);  // MC has not armed it this boot
  // Even a body that somehow carried a lock restores unlocked.
  StationAssignment locked = powerup_config(7, 900);
  StationLink link2;
  link2.restore_station_config(locked);
  CHECK(!link2.lock().locked(0));
}

static void test_mc_config_after_a_restore_replaces_it_without_a_second_schedule_reset() {
  SavedStationConfig saved;
  saved.note_applied(powerup_config(7, 0), "s1");
  StationLink link;
  link.restore_station_config(saved.restore());
  // The restored station awards a claim while MC is unreachable.
  ClaimWinner w;
  w.won = true;
  w.player_num = 5;
  CHECK(link.award_claim(w, 1000));
  CHECK_EQ(link.powerup().taker(), (uint8_t)5);
  // MC answers with the SAME game and the remaining lock: the schedule is kept, the lock is taken, and
  // (first arm this boot, under MUSTER) the drop is latched.
  link.apply_station_config(powerup_config(7, 300), 2000);
  CHECK(!link.restored());
  CHECK_EQ(link.powerup().taker(), (uint8_t)5);
  CHECK(link.lock().locked(2000));
  CHECK(link.dropped_for_match());
  // A different game after a restore does reset the schedule (the existing rule).
  StationLink link2;
  link2.restore_station_config(saved.restore());
  link2.award_claim(w, 1000);
  link2.apply_station_config(powerup_config(9, 0), 2000);
  CHECK_EQ(link2.powerup().taker(), (uint8_t)0);
  // HELD never latches the drop, restore or not.
  StationLink held;
  held.set_mode(AssocMode::HELD);
  held.restore_station_config(saved.restore());
  held.apply_station_config(powerup_config(7, 0), 2000);
  CHECK(!held.dropped_for_match());
}

static void test_release_clears_the_saved_config_and_the_restored_flag() {
  SavedStationConfig saved;
  saved.note_applied(powerup_config(7, 0), "s1");
  StationLink link;
  link.restore_station_config(saved.restore());
  link.apply_release();
  CHECK(!link.restored());
  CHECK(!link.assignment().present);
  CHECK(saved.note_released());   // the glue erases the key
  CHECK(!saved.has());
  CHECK(!saved.restore().present);
  CHECK(!saved.note_released());  // nothing left: no second erase
  // A body that no longer parses restores nothing (the glue then erases it).
  SavedStationConfig bad;
  bad.loaded("{garbage");
  CHECK(!bad.restore().present);
}

static WelcomeMsg welcome(const std::string& sid) {
  WelcomeMsg w;
  w.ok = true;
  w.session_id = sid;
  return w;
}

static void test_a_welcome_from_another_session_erases_the_saved_config_and_drops_the_restore() {
  SavedStationConfig saved;
  saved.note_applied(powerup_config(7, 0), "old");
  StationLink link;
  link.restore_station_config(saved.restore());
  link.apply_welcome(welcome("new"));
  CHECK(apply_welcome_to_saved(link, saved, "new"));  // the glue erases both keys
  CHECK(!saved.has());
  CHECK(!link.assignment().present);
  CHECK(!link.restored());
  // The same session keeps both.
  SavedStationConfig same;
  same.note_applied(powerup_config(7, 0), "s1");
  StationLink l2;
  l2.restore_station_config(same.restore());
  l2.apply_welcome(welcome("s1"));
  CHECK(!apply_welcome_to_saved(l2, same, "s1"));
  CHECK(same.has());
  CHECK(l2.restored());
  // A copy with no stored session id is stale on the first WELCOME.
  SavedStationConfig legacy;
  legacy.loaded(station_config_storage_body(powerup_config(7, 0)));
  StationLink l3;
  l3.restore_station_config(legacy.restore());
  CHECK(apply_welcome_to_saved(l3, legacy, "s1"));
  CHECK(!l3.assignment().present);

  // A WELCOME with no session id never erases (it would churn NVS on every reconnect).
  SavedStationConfig kept;
  kept.loaded(station_config_storage_body(powerup_config(7, 0)), "s1");
  StationLink l4;
  l4.restore_station_config(kept.restore());
  CHECK(!apply_welcome_to_saved(l4, kept, ""));
  CHECK(l4.assignment().present);
}

static void test_a_new_session_never_touches_a_config_mc_sent_this_boot() {
  SavedStationConfig saved;
  StationLink link;
  link.set_mode(AssocMode::HELD);
  link.apply_welcome(welcome("s1"));
  StationAssignment a = powerup_config(7, 0);
  link.apply_station_config(a, 0);
  saved.note_applied(a, link.session_id());
  CHECK_EQ(saved.session_id(), std::string("s1"));
  // MC restarts; the held Stick re-hellos into a new session.
  link.apply_welcome(welcome("s2"));
  CHECK(apply_welcome_to_saved(link, saved, "s2"));  // the old copy goes
  CHECK(link.assignment().present);                  // the live assignment stays
  // The same config re-sent in the new session is saved again, with the new session id.
  CHECK(saved.note_applied(a, "s2"));
  CHECK(!saved.note_applied(a, "s2"));
}

static void test_the_muster_drop_after_a_restore_waits_for_the_re_anchor_or_2_s() {
  SavedStationConfig saved;
  saved.note_applied(powerup_config(7, 0), "s1");
  StationLink link;  // MUSTER
  link.restore_station_config(saved.restore());
  uint32_t t0 = 0xFFFFF000u;  // straddles the millis() wrap
  link.apply_station_config(powerup_config(7, 0), t0);
  CHECK(link.dropped_for_match());
  CHECK(!link.take_muster_drop(t0));
  CHECK(!link.take_muster_drop(t0 + 1999));
  CHECK(link.muster_drop_pending());
  // The station_update lands: the drop is due at once, and only once.
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 20000;
  CHECK(link.apply_station_update(u, t0 + 500));
  CHECK(link.take_muster_drop(t0 + 500));
  CHECK(!link.take_muster_drop(t0 + 600));
  // No update at all (a reboot in LOBBY, F374 round 1): a powerup keeps waiting while MC is live, since START's
  // update is still to come; it drops only once MC has been out of reach for MUSTER_WAIT_OFFLINE_MS.
  StationLink l2;
  l2.restore_station_config(saved.restore());
  l2.apply_station_config(powerup_config(7, 0), t0);
  CHECK(!l2.take_muster_drop(t0 + 2000));
  CHECK(!l2.take_muster_drop(t0 + 120000));
  l2.wifi_down();
  CHECK(!l2.take_muster_drop(t0 + 120000));
  CHECK(l2.take_muster_drop(t0 + 120000 + MUSTER_WAIT_OFFLINE_MS));
  // A restored respawn (no schedule to anchor) keeps the 2 s rule.
  StationLink l4;
  StationAssignment r = powerup_config(7, 0);
  r.kind = "respawn";
  SavedStationConfig saved_r;
  saved_r.note_applied(r, "s1");
  l4.restore_station_config(saved_r.restore());
  l4.apply_station_config(r, t0);
  CHECK(!l4.take_muster_drop(t0 + 1999));
  CHECK(l4.take_muster_drop(t0 + 2000));
  // A drop with no restore, FRESH powerup arm (F374): it waits for MC's first station_update, with no
  // timeout -- there is no re-anchor to lose, but there is a go-live to wait for.
  StationLink l3;
  l3.apply_station_config(powerup_config(7, 0), 100);
  CHECK(!l3.take_muster_drop(100));
  CHECK(!l3.take_muster_drop(60100));  // no timeout: still waiting, however long, for MC's answer
  StationUpdateMsg u3;
  u3.present = true;
  u3.id = 8;
  u3.available = true;
  CHECK(l3.apply_station_update(u3, 60200));
  CHECK(l3.take_muster_drop(60200));
  CHECK(!l3.take_muster_drop(60300));
}

// --- F374: the fresh-arm-starts-unknown behaviour, tested end to end -----------------------------

static void test_unknown_schedule_awards_nothing_and_never_self_spawns() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  link.apply_station_config(a, 0);  // a fresh arm: no station_update has ever landed
  CHECK(!link.powerup().known());
  ClaimWinner w{true, 5};
  CHECK(!link.award_claim(w, 1000));  // nothing to win: the station is not known to be available
  CHECK_EQ(link.powerup().taker(), (uint8_t)0);
  PowerupAdvertView v = link.powerup().view(1000);
  CHECK_EQ(v.state, (uint8_t)0);
  CHECK_EQ(v.value, (uint8_t)0);
  CHECK_EQ(v.taker, (uint8_t)0);
  CHECK(!link.tick_powerup(1000000));  // no anchor was ever set: SELF-SPAWN never fires on its own
  CHECK(!link.powerup().available());
}

static void test_taken_with_no_anchor_shows_state_zero_not_available() {
  PowerupSchedule s;
  StationUpdateMsg u;
  u.present = true;
  u.available = false;  // MC gave no next_spawn_in_ms: there is nothing to count down to
  s.apply_update(u, 5000);
  CHECK(s.known());
  CHECK(!s.available());
  PowerupAdvertView v = s.view(9000);
  CHECK_EQ(v.state, (uint8_t)0);  // not state 1 ("available"): must not look ready with no anchor
  CHECK_EQ(v.value, (uint8_t)0);
  CHECK_EQ(v.taker, s.taker());  // the view faithfully reports the taker, whatever it holds
}

static void test_muster_fresh_powerup_arm_waits_for_the_first_update_with_no_timeout() {
  StationLink link;  // MUSTER is the default
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  a.game = 1;
  link.apply_station_config(a, 0);
  CHECK(!link.take_muster_drop(100));    // +100 ms: still waiting for MC
  CHECK(!link.take_muster_drop(60000));  // +60 s: no timeout, still waiting
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = true;
  CHECK(link.apply_station_update(u, 60050));
  CHECK(link.take_muster_drop(60050));   // due the instant the update lands
  CHECK(!link.take_muster_drop(60100));  // and only once
}

static void test_a_latched_drop_still_rejoins_wi_fi_until_the_radio_actually_drops() {
  // F374: a powerup Stick waiting for START has latched its drop but is still on Wi-Fi. A Wi-Fi blip then must
  // not strand it: the glue's rejoin guard reads radio_down_for_match(), which turns true only once the drop is taken.
  StationLink link;  // MUSTER
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 8;
  a.game = 1;
  link.apply_station_config(a, 0);
  CHECK(link.dropped_for_match());
  CHECK(!link.radio_down_for_match());
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 30000;
  CHECK(link.apply_station_update(u, 1000));
  CHECK(link.take_muster_drop(1000));
  CHECK(link.radio_down_for_match());
}

static void test_a_waiting_powerup_that_loses_mc_falls_back_to_available_then_drops() {
  // F374 round 1 (CRITICAL): the spec's flow carries a station out of Wi-Fi BEFORE START. A Stick still waiting
  // for START's update must not stay unknown (no phone could ever claim it): the moment MC is out of reach it
  // falls back to available (the pre-F374 behaviour, the documented limit), keeps rejoining for
  // MUSTER_WAIT_OFFLINE_MS in case it was a blip, then takes the drop.
  StationLink link;  // MUSTER
  link.apply_station_config(powerup_config(7, 0), 1000);
  CHECK(!link.powerup().known());
  CHECK(!link.take_muster_drop(5000));
  link.wifi_down();
  CHECK(!link.take_muster_drop(6000));
  CHECK(link.powerup().known());
  CHECK(link.powerup().available());
  CHECK_EQ(link.powerup().view(6000).state, (uint8_t)1);
  CHECK(!link.radio_down_for_match());
  CHECK(!link.take_muster_drop(6000 + MUSTER_WAIT_OFFLINE_MS - 1));
  CHECK(link.take_muster_drop(6000 + MUSTER_WAIT_OFFLINE_MS));
  CHECK(link.radio_down_for_match());
  CHECK(!link.take_muster_drop(6000 + MUSTER_WAIT_OFFLINE_MS + 1));
}

static void test_a_blip_while_waiting_rejoins_and_start_still_anchors_the_schedule() {
  StationLink link;  // MUSTER
  link.apply_station_config(powerup_config(7, 0), 1000);
  link.wifi_down();
  CHECK(!link.take_muster_drop(2000));  // offline: the fallback, and the 60 s clock starts
  // Back: Wi-Fi, MC, welcome, and MC's config again (same game: the schedule is not reset).
  link.wifi_up();
  link.mc_address_known();
  link.ws_open_hello_sent();
  WelcomeMsg w;
  w.ok = true;
  w.session_id = "s1";
  link.apply_welcome(w);
  link.apply_station_config(powerup_config(7, 0), 30000);
  CHECK(!link.take_muster_drop(2000 + MUSTER_WAIT_OFFLINE_MS + 5000));  // live again: still waiting for START
  StationUpdateMsg u;
  u.present = true;
  u.id = 8;
  u.available = false;
  u.next_spawn_in_ms = 30000;
  CHECK(link.apply_station_update(u, 100000));
  CHECK(!link.powerup().available());  // START's anchor beats the fallback
  CHECK(link.take_muster_drop(100000));
}

static void test_a_release_while_waiting_for_start_cancels_the_pending_drop() {
  // F374 round 2: a powerup released before START's update must not keep a pending MUSTER drop that a later loss
  // of MC would take on an unassigned Stick.
  StationLink link;  // MUSTER
  link.apply_station_config(powerup_config(7, 0), 1000);
  CHECK(link.muster_drop_pending());
  link.apply_release();
  CHECK(!link.muster_drop_pending());
  CHECK(!link.dropped_for_match());
  link.wifi_down();
  CHECK(!link.take_muster_drop(2000));
  CHECK(!link.take_muster_drop(2000 + MUSTER_WAIT_OFFLINE_MS));
  CHECK(!link.radio_down_for_match());
}

static void test_an_mc_restart_in_lobby_keeps_waiting_while_wi_fi_is_up() {
  // F374 round 2: a closed socket with Wi-Fi up (MC restarting, a laptop asleep) is not the field: the Stick falls
  // back to available, but the offline clock runs only while Wi-Fi itself is down, so START can still anchor it.
  StationLink link;  // MUSTER
  link.apply_station_config(powerup_config(7, 0), 1000);
  link.ws_closed();
  CHECK(!link.take_muster_drop(2000));
  CHECK(link.powerup().available());
  CHECK(!link.take_muster_drop(2000 + 10 * MUSTER_WAIT_OFFLINE_MS));
  link.wifi_down();  // now Wi-Fi goes too: the clock starts here
  CHECK(!link.take_muster_drop(700000));
  CHECK(link.take_muster_drop(700000 + MUSTER_WAIT_OFFLINE_MS));
}

static void test_a_held_powerup_that_cannot_reach_mc_falls_back_to_available() {
  // F374 round 3: HELD never drops, but an unknown schedule with MC out of reach must not stay dead either.
  StationLink link;
  link.set_mode(AssocMode::HELD);
  link.apply_station_config(powerup_config(7, 0), 1000);
  link.tick_powerup(2000);
  CHECK(!link.powerup().known());  // MC live: wait for START
  link.ws_closed();
  link.tick_powerup(3000);
  CHECK(link.powerup().known());
  CHECK(link.powerup().available());
}

static void test_muster_fresh_non_powerup_arm_drops_at_once() {
  StationLink link;  // MUSTER is the default
  StationAssignment a;
  a.present = true;
  a.kind = "respawn";
  a.id = 3;
  a.game = 1;
  link.apply_station_config(a, 100);
  CHECK(link.take_muster_drop(100));  // no schedule to wait on: due at once, as any non-powerup arm
}

static void test_muster_hill_waits_for_start_config_or_offline_timeout() {
  StationLink link;
  StationAssignment c;
  c.present = true; c.kind = "control"; c.id = 9; c.game = 7;
  link.set_mode(AssocMode::MUSTER);
  link.apply_station_config(c, 1000);
  CHECK(link.muster_drop_pending());
  CHECK(!link.take_muster_drop(1001));
  c.starts_known = true; c.starts_in_ms = 3000; c.ends_in_ms = 30000;
  link.apply_station_config(c, 30000);
  CHECK(link.take_muster_drop(30000));

  StationLink offline;
  offline.set_mode(AssocMode::MUSTER);
  c.game = 8;
  c.ends_in_ms = -1;
  c.starts_known = false;
  offline.apply_station_config(c, 0);
  CHECK(!offline.take_muster_drop(0));
  offline.wifi_down();
  CHECK(!offline.take_muster_drop(0));
  CHECK(!offline.take_muster_drop(MUSTER_WAIT_OFFLINE_MS - 1));
  CHECK(offline.take_muster_drop(MUSTER_WAIT_OFFLINE_MS));
}

static void test_untimed_hill_start_config_releases_muster_without_changing_hill() {
  StationLink link;
  StationAssignment c;
  c.present = true; c.kind = "control"; c.id = 9; c.game = 7;
  link.apply_station_config(c, 100);
  link.hill().owner = 1;
  link.hill().progress = 100;
  StationUpdateMsg stray;
  stray.present = true; stray.id = 9; stray.available = false;
  CHECK(!link.apply_station_update(stray, 200));
  CHECK(!link.take_muster_drop(200));
  c.starts_known = true; c.starts_in_ms = 1000;
  link.apply_station_config(c, 201);
  CHECK(link.take_muster_drop(201));
  CHECK_EQ(link.hill().owner, 1);
  CHECK_EQ(link.hill().progress, 100);
  CHECK(!link.hill_ended());
  CHECK(!link.powerup().known());
}

static void test_hill_waits_for_go_live_before_capture_or_tally() {
  StationLink link;
  StationAssignment c;
  c.present = true; c.kind = "control"; c.id = 9; c.game = 7; c.ends_in_ms = 60000;
  c.starts_known = true; c.starts_in_ms = 20000;
  link.apply_station_config(c, 100);
  CHECK(link.take_muster_drop(100));
  PlayerPresence p;
  link.hill().owner = 1;
  link.hill().progress = 100;
  link.tick_players(p, 10100);  // armed, go_live_t is still in the future
  CHECK_EQ(link.hill().hold_ms[1], 0u);
  link.tick_players(p, 20100);
  link.tick_players(p, 21100);
  CHECK_EQ(link.hill().hold_ms[1], 1000u);
}

static void test_held_hill_starts_after_sixty_seconds_offline_without_start() {
  StationLink link;
  link.set_mode(AssocMode::HELD);
  StationAssignment c;
  c.present = true; c.kind = "control"; c.id = 9; c.game = 7;
  link.apply_station_config(c, 100);
  link.hill().owner = 1;
  link.hill().progress = 100;
  PlayerPresence p;
  link.wifi_down();
  link.tick_players(p, 1000);
  link.tick_players(p, 1000 + MUSTER_WAIT_OFFLINE_MS - 1);
  CHECK_EQ(link.hill().hold_ms[1], 0u);
  link.tick_players(p, 1000 + MUSTER_WAIT_OFFLINE_MS);
  link.tick_players(p, 1000 + MUSTER_WAIT_OFFLINE_MS + 1000);
  CHECK_EQ(link.hill().hold_ms[1], 1000u);
}

static void test_muster_powerup_rearmed_as_respawn_before_the_update_drops_at_once() {
  StationLink link;  // MUSTER is the default
  StationAssignment p;
  p.present = true;
  p.kind = "powerup";
  p.id = 8;
  p.game = 1;
  link.apply_station_config(p, 100);
  CHECK(!link.take_muster_drop(100));  // waiting for MC's first update
  StationAssignment r;
  r.present = true;
  r.kind = "respawn";
  r.id = 8;
  r.game = 1;  // the SAME game: re-armed as a different kind before any update ever landed
  link.apply_station_config(r, 150);
  CHECK(link.dropped_for_match());
  CHECK(link.take_muster_drop(150));  // a respawn station has no schedule left to wait for
}

static void test_restore_of_a_saved_powerup_config_is_known_and_available_at_once() {
  SavedStationConfig saved;
  saved.note_applied(powerup_config(7, 900), "s1");
  StationLink link;
  CHECK(link.restore_station_config(saved.restore()));
  CHECK(link.powerup().known());
  CHECK(link.powerup().available());
}

// ---- the Bluetooth stations (presence.h), carried by StationLink --------------------------------
static PlayerPresence red_on_the_point(uint32_t t) {
  PlayerPresence pr;
  pr.dwell_ms = 0;
  Advert a;
  a.role = ROLE_PLAYER;
  a.id = 4;
  a.team = 0;
  a.state = PLAYER_ALIVE;
  pr.observe(a, -50, t);
  pr.tick(t);
  return pr;
}

static StationAssignment control_config(int game) {
  StationAssignment c;
  c.present = true;
  c.kind = "control";
  c.id = 9;
  c.team = 255;
  c.game = game;
  return c;
}

// A new game byte resets the point; a same-game re-push (MC's lock carrier) keeps it, as it keeps a
// powerup's schedule.
static void test_a_new_game_resets_the_hill_and_a_same_game_repush_keeps_it() {
  StationLink link;
  link.apply_station_config(control_config(7), 0);
  CHECK(link.has_control_assignment());
  StationAssignment started = control_config(7);
  started.starts_known = true;
  link.apply_station_config(started, 0);
  PlayerPresence pr = red_on_the_point(0);
  link.tick_players(pr, 0);
  HillUpdate u;
  for (uint32_t t = 250; t <= 10000; t += 250) {
    pr = red_on_the_point(t);
    HillUpdate step = link.tick_players(pr, t);
    if (step.captured) u = step;
  }
  CHECK(u.captured);
  CHECK_EQ(link.hill().owner, 0);
  StationAssignment again = control_config(7);
  again.lock_s = 60;  // the lock carrier: same config, a lock added
  again.starts_known = true; again.starts_in_ms = -10000;
  link.apply_station_config(again, 10000);
  CHECK_EQ(link.hill().owner, 0);
  CHECK(link.hill().progress > 99.99);
  link.apply_station_config(control_config(8), 11000);
  CHECK_EQ(link.hill().owner, (int)HILL_NEUTRAL);
  CHECK_EQ(link.hill().progress, 0.0);
  // A release drops the point too.
  link.apply_station_config(control_config(8), 12000);
  link.hill().owner = 1;
  link.apply_release();
  CHECK_EQ(link.hill().owner, (int)HILL_NEUTRAL);
}

static void test_a_respawn_assignment_counts_revives_and_a_new_game_zeroes_them() {
  StationLink link;
  StationAssignment r;
  r.present = true;
  r.kind = "respawn";
  r.id = 3;
  r.team = 1;
  r.game = 5;
  link.apply_station_config(r, 0);
  CHECK(link.has_respawn_assignment());
  CHECK(!link.has_control_assignment());
  PlayerPresence pr;
  pr.dwell_ms = 0;
  Advert a;
  a.role = ROLE_PLAYER;
  a.id = 2;
  a.team = 1;
  a.state = 0;  // down
  pr.observe(a, -50, 0);
  pr.tick(0);
  link.tick_players(pr, 0);
  a.state = PLAYER_ALIVE;
  pr.observe(a, -50, 250);
  pr.tick(250);
  HillUpdate u = link.tick_players(pr, 250);
  CHECK(!u.changed);  // a respawn station runs no hill
  // Revive feedback is post-MVP (presence.h): off, a respawn station counts nothing.
  const uint32_t one = REVIVE_FEEDBACK_ENABLED ? 1u : 0u;
  CHECK_EQ(link.revives().revives, one);
  link.apply_station_config(r, 500);  // same game: kept
  CHECK_EQ(link.revives().revives, one);
  r.game = 6;
  link.apply_station_config(r, 600);
  CHECK_EQ(link.revives().revives, 0u);
}

static void test_status_carries_revives_and_hold_ms_additively() {
  StatusFields f;
  f.node_id = "n";
  f.app_ver = "v";
  f.kind = "respawn";
  f.has_revives = true;
  f.revives = 4;
  CHECK(build_status_body(f).find(",\"revives\":4}") != std::string::npos);
  StatusFields c;
  c.node_id = "n";
  c.app_ver = "v";
  c.kind = "control";
  c.has_control = true;
  c.control_owner = 3;
  c.control_progress = 100;
  c.control_has_hold = true;
  c.control_hold_ms[0] = 1200;
  c.control_hold_ms[3] = 34000;
  CHECK(build_status_body(c).find(
            "\"control\":{\"owner\":3,\"progress\":100,\"contested\":false,\"hold_ms\":{\"0\":1200,\"3\":34000}}") !=
        std::string::npos);
  c.control_hold_ms[0] = 0;
  c.control_hold_ms[3] = 0;
  CHECK(build_status_body(c).find("\"hold_ms\":{}") != std::string::npos);  // nobody has held it yet
}

static void test_hill_stops_accruing_when_deadline_freezes_it() {
  BleControlPoint h;
  h.owner = 1;
  h.progress = 100;
  PlayerPresence p;
  h.update(p, 1000);
  h.update(p, 2000);
  const uint32_t whistle_tally = h.hold_ms[1];
  h.freeze();
  h.update(p, 12000);
  CHECK_EQ(h.owner, 1);
  CHECK_EQ(h.hold_ms[1], whistle_tally);
  CHECK_EQ(h.progress, 100);
}

static void test_hill_starts_only_at_config_go_live_and_stops_at_deadline() {
  StationLink link;
  StationAssignment a = control_config(7);
  a.starts_known = true; a.starts_in_ms = 2000; a.ends_in_ms = 4000;
  link.apply_station_config(a, 100);
  link.hill().owner = 1; link.hill().progress = 100;
  PlayerPresence p;
  link.tick_players(p, 2099);
  CHECK(link.hill_waiting(2099));
  CHECK_EQ(link.hill().hold_ms[1], 0u);
  link.tick_players(p, 2100);
  link.tick_players(p, 3100);
  CHECK_EQ(link.hill().hold_ms[1], 1000u);
  link.tick_players(p, 5100);
  CHECK(link.hill_ended());
  CHECK_EQ(link.hill().hold_ms[1], 2000u);
}

static void test_timed_hill_anchors_on_first_alive_same_game_advert_without_rssi_gate() {
  StationLink link;
  StationAssignment a = control_config(7);
  a.duration_ms = 120000;
  link.apply_station_config(a, 100);
  SavedStationConfig saved;
  CHECK(saved.note_applied(a, "s1"));
  CHECK(saved.stored().find("\"duration_ms\":120000") != std::string::npos);
  CHECK(link.hill_waiting(100));
  Advert down; down.role = ROLE_PLAYER; down.game = 7; down.state = 0;
  CHECK(!link.anchor_hill_on_advert(down, 1000));
  Advert wrong_game = down; wrong_game.state = PLAYER_ALIVE; wrong_game.game = 8;
  CHECK(!link.anchor_hill_on_advert(wrong_game, 1000));
  Advert unscoped = down; unscoped.state = PLAYER_ALIVE; unscoped.game = 0;
  CHECK(!link.anchor_hill_on_advert(unscoped, 1000));
  Advert alive = down; alive.state = PLAYER_ALIVE;
  CHECK(link.anchor_hill_on_advert(alive, 5000));
  PlayerPresence p;
  link.hill().owner = 1; link.hill().progress = 100;
  CHECK(!link.hill_waiting(5000));
  link.tick_players(p, 5000);
  link.tick_players(p, 6000);
  CHECK_EQ(link.hill().hold_ms[1], 1000u);
  link.tick_players(p, 125000);
  CHECK(link.hill_ended());
  CHECK_EQ(link.hill().hold_ms[1], 120000u);

  StationLink rebooted;
  CHECK(rebooted.restore_station_config(saved.restore()));
  CHECK(!rebooted.hill_ended());  // saved timed tally stays frozen while the hill shows WAITING
  CHECK(rebooted.hill_waiting(10));
  CHECK(rebooted.anchor_hill_on_advert(alive, 20));
  CHECK(!rebooted.hill_ended());

  StationLink corrected;
  corrected.apply_station_config(a, 0);
  CHECK(corrected.anchor_hill_on_advert(alive, 1000));
  a.starts_known = true; a.starts_in_ms = 2000; a.ends_in_ms = 4000;
  corrected.apply_station_config(a, 1100);  // MC's START clock replaces the advert fallback
  corrected.hill().owner = 1; corrected.hill().progress = 100;
  CHECK(corrected.hill_waiting(3099));
  corrected.tick_players(p, 3100);
  corrected.tick_players(p, 4100);
  corrected.tick_players(p, 5100);
  CHECK(corrected.hill_ended());
  CHECK_EQ(corrected.hill().hold_ms[1], 2000u);

  StationLink next_game;
  StationAssignment current = control_config(7);
  current.duration_ms = 120000;
  next_game.apply_station_config(current, 0);
  CHECK(next_game.anchor_hill_on_advert(alive, 1000));
  StationAssignment next = control_config(8);
  next.duration_ms = 60000;
  next_game.apply_station_config(next, 2000);
  CHECK(next_game.hill_waiting(2000));
  CHECK(!next_game.anchor_hill_on_advert(alive, 3000));  // old game advert cannot anchor the new game
  Advert next_alive = alive; next_alive.game = 8;
  CHECK(next_game.anchor_hill_on_advert(next_alive, 4000));
}

static void test_parse_signed_go_live_offset() {
  bool ok = false;
  StationAssignment a = parse_station_config(json::parse(
      R"({"kind":"control","id":9,"game":7,"starts_in_ms":-1500,"ends_in_ms":5000})", &ok));
  CHECK(ok);
  CHECK(a.starts_known);
  CHECK_EQ(a.starts_in_ms, -1500);
  CHECK_EQ(a.ends_in_ms, 5000);
  StationAssignment lobby = parse_station_config(json::parse(R"({"kind":"control","id":9})", &ok));
  CHECK(!lobby.starts_known);
}

static void test_same_game_config_without_times_cancels_a_pending_start() {
  StationLink link;
  StationAssignment a = control_config(7);
  a.starts_known = true; a.starts_in_ms = 1000; a.ends_in_ms = 2000;
  link.apply_station_config(a, 100);
  a.starts_known = false; a.ends_in_ms = -1;
  link.apply_station_config(a, 200);
  CHECK(link.hill_waiting(200));
  PlayerPresence p;
  link.hill().owner = 1; link.hill().progress = 100;
  link.tick_players(p, 3100);
  CHECK_EQ(link.hill().hold_ms[1], 0u);
  CHECK(!link.hill_ended());
}

static void test_late_start_discards_offline_fallback_capture() {
  StationLink link;
  link.set_mode(AssocMode::HELD);
  StationAssignment a = control_config(7);
  link.apply_station_config(a, 0);
  link.wifi_down();
  PlayerPresence p;
  link.tick_players(p, 1000);
  link.tick_players(p, 1000 + MUSTER_WAIT_OFFLINE_MS);
  link.hill().owner = 1; link.hill().progress = 100;
  link.tick_players(p, 62000);
  CHECK(link.hill().hold_ms[1] > 0u);
  a.starts_known = true; a.starts_in_ms = 5000;
  link.apply_station_config(a, 63000);
  CHECK(link.hill_waiting(63000));
  CHECK_EQ(link.hill().advert().state, (uint8_t)0);
  CHECK_EQ(link.hill().hold_ms[1], 0u);
  link.tick_players(p, 67999);
  CHECK_EQ(link.hill().hold_ms[1], 0u);
  link.tick_players(p, 68000);
  CHECK_EQ(link.hill().hold_ms[1], 0u);
}

static void test_hill_reset_after_whistle_stays_frozen() {
  StationLink link;
  StationAssignment a;
  a.present = true; a.kind = "control"; a.id = 9; a.game = 2; a.ends_in_ms = 1000; a.starts_known = true;
  link.apply_station_config(a, 100);
  PlayerPresence p;
  link.hill().owner = 1;
  link.hill().progress = 100;
  link.tick_players(p, 100);
  link.tick_players(p, 1100);
  CHECK(link.hill_ended());
  const uint32_t recap_tally = link.hill().hold_ms[1];
  CHECK(!link.reset_hill());
  CHECK(link.hill_ended());
  link.tick_players(p, 5100);
  CHECK_EQ(link.hill().hold_ms[1], recap_tally);
  CHECK_EQ(link.hill().owner, 1);
}

static void test_same_game_config_without_times_waits_again() {
  StationLink link;
  StationAssignment a;
  a.present = true; a.kind = "control"; a.id = 9; a.game = 2; a.ends_in_ms = 1000; a.starts_known = true;
  link.apply_station_config(a, 100);
  PlayerPresence p;
  link.hill().owner = 1;
  link.hill().progress = 100;
  link.tick_players(p, 100);
  a.ends_in_ms = -1;
  a.starts_known = false;
  link.apply_station_config(a, 500);  // abort sends the same game without either clock
  link.tick_players(p, 1100);
  CHECK(link.hill_waiting(1100));
  CHECK(!link.hill_ended());
}

static void test_saved_config_restore_discards_an_old_local_deadline() {
  StationLink link;
  StationAssignment a;
  a.present = true; a.kind = "control"; a.id = 9; a.game = 2; a.ends_in_ms = 1000;
  link.apply_station_config(a, 100);
  a.game = 3;
  a.ends_in_ms = -1;
  CHECK(link.restore_station_config(a));
  PlayerPresence p;
  link.tick_players(p, 1100);
  CHECK(!link.hill_ended());
}

static void test_abort_explicitly_clears_same_game_deadline() {
  StationLink link;
  StationAssignment running;
  running.present = true; running.kind = "control"; running.id = 9; running.game = 2;
  running.ends_in_ms = 1000;
  link.apply_station_config(running, 100);
  StationAssignment aborted = running;
  aborted.ends_in_ms = -1;
  link.apply_station_config(aborted, 500);
  CHECK(station_config_storage_body(link.assignment()).find("timed_hill") == std::string::npos);
  PlayerPresence p;
  link.tick_players(p, 1100);
  CHECK(!link.hill_ended());
}

static void test_restored_timed_hill_waits_for_a_fresh_clock() {
  StationLink original;
  StationAssignment a;
  a.present = true; a.kind = "control"; a.id = 9; a.game = 2; a.ends_in_ms = 1000;
  original.apply_station_config(a, 100);
  SavedStationConfig saved;
  CHECK(saved.note_applied(a, "s1"));
  StationLink rebooted;
  CHECK(rebooted.restore_station_config(saved.restore()));
  CHECK(rebooted.hill_ended());
  uint32_t saved_hold[4] = {0, 1000, 0, 0};
  rebooted.hill().restore_held(1, saved_hold);  // SavedHill runs after config restore on boot
  rebooted.enforce_restored_hill_freeze();
  CHECK(rebooted.hill_ended());
  a.ends_in_ms = 500;
  a.starts_known = true;
  rebooted.apply_station_config(a, 200);
  CHECK(!rebooted.hill_ended());
}

static void test_restored_timed_hill_accepts_untimed_start_config() {
  StationLink link;
  StationAssignment saved;
  saved.present = true; saved.kind = "control"; saved.id = 9; saved.game = 2;
  saved.timed_hill = true;
  CHECK(link.restore_station_config(saved));
  CHECK(link.hill_ended());
  StationAssignment fresh = saved;
  fresh.timed_hill = false;
  CHECK(!link.apply_station_config(fresh, 100));
  CHECK(link.hill_ended());  // a config before go-live cannot clear the safety guard
  fresh.starts_known = true;
  fresh.starts_in_ms = -100;
  link.apply_station_config(fresh, 200);
  CHECK(!link.hill_ended());
}

// ---- the presence threshold default and the saved hill owner (F332) ------------------------------
static void test_presence_threshold_is_the_phone_default_when_mc_sends_none() {
  bool ok = false;
  json::Value v = json::parse(R"({"kind":"control","team":255,"id":9,"threshold":0})", &ok);
  StationAssignment a = parse_station_config(v);
  CHECK(a.threshold_defaulted);
  CHECK_EQ(a.threshold, STICK_DEFAULT_THRESHOLD_DBM);  // the advertised byte keeps the Stick's own
  CHECK_EQ(presence_threshold_dbm(a), -75);            // hill radius default
  v = json::parse(R"({"kind":"control","team":255,"id":9})", &ok);
  CHECK_EQ(presence_threshold_dbm(parse_station_config(v)), -75);
  v = json::parse(R"({"kind":"control","team":255,"id":9,"threshold":-66})", &ok);
  StationAssignment m = parse_station_config(v);
  CHECK(!m.threshold_defaulted);
  CHECK_EQ(presence_threshold_dbm(m), -66);
  // A restored copy still knows MC asked for the default.
  SavedStationConfig saved;
  CHECK(saved.note_applied(a, "s1"));
  StationAssignment r = saved.restore();
  CHECK(r.threshold_defaulted);
  CHECK_EQ(presence_threshold_dbm(r), -75);
  SavedStationConfig saved2;
  saved2.note_applied(m, "s1");
  CHECK_EQ(presence_threshold_dbm(saved2.restore()), -66);
  CHECK(saved2.stored().find("threshold_default") == std::string::npos);  // additive: absent unless defaulted
}

static void test_hill_default_threshold_separates_measurement_from_phone_advert() {
  StationLink hill;
  bool ok = false;
  StationAssignment a = parse_station_config(json::parse(R"({"kind":"control","team":255,"id":9})", &ok));
  hill.apply_station_config(a);
  CHECK_EQ(hill.threshold_dbm(), STICK_HILL_DEFAULT_THRESHOLD_DBM);
  CHECK_EQ(hill.threshold_advertised_dbm(), STICK_DEFAULT_THRESHOLD_DBM);
  StationLink respawn;
  StationAssignment r = parse_station_config(json::parse(R"({"kind":"respawn","team":1,"id":2})", &ok));
  respawn.apply_station_config(r);
  CHECK_EQ(respawn.threshold_dbm(), STICK_DEFAULT_THRESHOLD_DBM);
  CHECK_EQ(respawn.threshold_advertised_dbm(), STICK_DEFAULT_THRESHOLD_DBM);
  StationAssignment explicit_hill = parse_station_config(json::parse(
      R"({"kind":"control","team":255,"id":9,"threshold":-75})", &ok));
  hill.apply_station_config(explicit_hill);
  CHECK_EQ(hill.threshold_dbm(), -75);
  CHECK_EQ(hill.threshold_advertised_dbm(), -75);
}

static BleControlPoint held_by(int owner, uint32_t hold0 = 0, uint32_t hold3 = 0) {
  BleControlPoint h;
  h.owner = owner;
  h.progress = owner == HILL_NEUTRAL ? 0 : 100;
  h.hold_ms[0] = hold0;
  h.hold_ms[3] = hold3;
  return h;
}

static void test_saved_hill_round_trips_owner_and_tally_and_restores_the_hold() {
  StationAssignment a = control_config(7);
  SavedHill mem;
  CHECK(!mem.note_owner(a, "s1", held_by(HILL_NEUTRAL)));  // nothing held, nothing saved
  CHECK(mem.note_owner(a, "s1", held_by(1, 4000, 9000)));   // blue captured it: write, with the tally
  // "Flash" -> a new boot.
  SavedHill boot;
  boot.loaded(mem.has(), mem.owner(), mem.game(), mem.id(), mem.session_id(), mem.hold_ms());
  CHECK(!boot.note_config(a, "s1"));  // same game + id + session: kept
  CHECK_EQ(boot.restore_owner(a, "s1"), 1);
  StationLink link;
  link.restore_station_config(a);
  CHECK(boot.restore_into(a, "s1", link.hill()));
  CHECK_EQ(link.hill().owner, 1);
  CHECK_EQ(link.hill().hold_ms[0], 4000u);  // MC's possession tally survives the restart
  CHECK_EQ(link.hill().hold_ms[3], 9000u);
  CHECK_EQ(link.hill().advert().state, (uint8_t)CONTROL_HELD);
  CHECK_EQ(link.hill().advert().value, (uint8_t)100);
  link.apply_station_config(a, 0);  // MC answers with the same config after the restart: kept
  CHECK_EQ(link.hill().owner, 1);
  BleControlPoint cp;  // tid 2 or a colour can never come back as an owner
  cp.restore_held(2);
  CHECK_EQ(cp.owner, (int)HILL_NEUTRAL);
}

static void test_saved_hill_writes_only_on_an_owner_change() {
  StationLink link;
  StationAssignment a = control_config(7);
  a.starts_known = true;
  link.apply_station_config(a, 0);
  SavedHill saved;
  int writes = 0;
  for (uint32_t t = 0; t <= 15000; t += 250) {  // red builds, captures, then holds: 60 ticks
    PlayerPresence pr = red_on_the_point(t);
    link.tick_players(pr, t);
    if (saved.note_owner(a, "s1", link.hill())) writes++;
  }
  CHECK_EQ(link.hill().owner, 0);
  CHECK(link.hill().hold_ms[0] > 0u);  // the tally grew on every held tick...
  CHECK_EQ(writes, 1);                 // ...and none of those ticks wrote: the capture only
  // An untagged save (no session yet) must not look changed on every tick either.
  SavedHill untagged;
  CHECK(untagged.note_owner(a, "", link.hill()));
  CHECK(!untagged.note_owner(a, "", link.hill()));
  CHECK_EQ(untagged.restore_owner(a, ""), (int)HILL_NEUTRAL);  // and it never restores
  CHECK(saved.note_owner(a, "s1", held_by(HILL_NEUTRAL)));  // drained to neutral: written
  CHECK_EQ(saved.restore_owner(a, "s1"), (int)HILL_NEUTRAL);
}

static void test_saved_hill_flushes_final_tally_once_at_whistle() {
  StationAssignment a = control_config(7);
  SavedHill saved;
  BleControlPoint h = held_by(1);
  h.hold_ms[1] = 1000;
  CHECK(saved.note_owner(a, "s1", h));
  h.hold_ms[1] = 9000;
  h.freeze();
  CHECK(saved.note_owner(a, "s1", h));
  CHECK_EQ(saved.hold_ms()[1], 9000u);
  CHECK(!saved.note_owner(a, "s1", h));
}

static void test_saved_hill_tag_mismatch_is_neutral_and_new_game_session_or_release_clears() {
  StationAssignment a = control_config(7);
  SavedHill saved;
  saved.note_owner(a, "s1", held_by(3));
  CHECK_EQ(saved.restore_owner(control_config(8), "s1"), (int)HILL_NEUTRAL);  // another game
  StationAssignment other_id = control_config(7);
  other_id.id = 10;
  CHECK_EQ(saved.restore_owner(other_id, "s1"), (int)HILL_NEUTRAL);  // another station
  StationAssignment pu = control_config(7);
  pu.kind = "powerup";
  CHECK_EQ(saved.restore_owner(pu, "s1"), (int)HILL_NEUTRAL);  // no longer a hill
  // A new MC session numbers its games from 1 again: game 7 of session s2 is not s1's game 7.
  CHECK_EQ(saved.restore_owner(a, "s2"), (int)HILL_NEUTRAL);
  BleControlPoint untouched = held_by(HILL_NEUTRAL);
  CHECK(!saved.restore_into(a, "s2", untouched));
  CHECK_EQ(untouched.owner, (int)HILL_NEUTRAL);
  CHECK_EQ(saved.restore_owner(a, "s1"), 3);
  CHECK(!saved.note_config(a, "s1"));             // same tag: keep
  CHECK(!saved.note_welcome("s1"));               // a WELCOME from the same session: keep
  CHECK(!saved.note_welcome(""));                 // a WELCOME with no session says nothing
  CHECK(saved.note_welcome("s2"));                // another session: erase
  CHECK(!saved.has());
  saved.note_owner(a, "s1", held_by(3));
  CHECK(saved.note_config(control_config(8), "s1"));  // a new game: erase
  CHECK(!saved.note_config(control_config(8), "s1"));  // nothing left to erase
  saved.note_owner(a, "s1", held_by(3));
  CHECK(saved.note_config(a, "s2"));  // the same config re-pushed in a new session: erase
  saved.note_owner(a, "s1", held_by(3));
  CHECK(saved.clear());  // release_utility / the operator RESET
  CHECK_EQ(saved.restore_owner(a, "s1"), (int)HILL_NEUTRAL);
  CHECK(!saved.clear());
}

// The operator's point RESET (utility.js btnPointReset) reaches the Bluetooth hill only on a control station.
static void test_reset_hill_neutralises_only_an_assigned_control_point() {
  StationLink link;
  CHECK(!link.reset_hill());  // nothing assigned
  link.apply_station_config(control_config(7), 0);
  link.hill().restore_held(0);
  CHECK(link.reset_hill());
  CHECK_EQ(link.hill().owner, (int)HILL_NEUTRAL);
  CHECK_EQ(link.hill().progress, 0.0);
  StationAssignment r = control_config(7);
  r.kind = "respawn";
  link.apply_station_config(r, 0);
  CHECK(!link.reset_hill());
}

// The glue empties its sighting ring when the epoch moves: a different station, never a re-push.
static void test_assignment_epoch_moves_on_a_new_station_only() {
  StationLink link;
  uint32_t e = link.assignment_epoch();
  link.apply_station_config(control_config(7), 0);
  CHECK(link.assignment_epoch() != e);
  e = link.assignment_epoch();
  StationAssignment again = control_config(7);
  again.lock_s = 30;
  link.apply_station_config(again, 0);  // same game re-push (the lock carrier)
  CHECK_EQ(link.assignment_epoch(), e);
  link.apply_station_config(control_config(8), 0);  // a new game
  CHECK(link.assignment_epoch() != e);
  e = link.assignment_epoch();
  link.apply_release();
  CHECK(link.assignment_epoch() != e);
  e = link.assignment_epoch();
  link.restore_station_config(control_config(8));
  CHECK(link.assignment_epoch() != e);
}

int main(int argc, char** argv) {
  test_f390_timed_powerup_rejoins_at_whistle_not_short_lock_expiry();
  test_f390_deadline_rejoin_for_each_station_kind();
  test_f389_every_dial_path_respects_link_stops();
  test_f390_rejoin_waits_for_a_known_deadline();
  test_f391_lock_snapshot_never_grows_and_saves_once_five_minutes();
  test_f397_typed_mc_url_storage_policy();
  test_f397_typed_url_falls_back_after_failed_dials();
  if (argc > 1) {
    // Golden-dump mode for mcp/tests/test_utility_esp32.py: write the exact envelope strings this
    // header builds, so the MC-side test drives Session with what the firmware would actually send.
    std::string dir = argv[1];
    auto write = [&](const char* name, const std::string& contents) {
      std::ofstream f(dir + "/" + name);
      f << contents;
    };
    StationIdentity id;
    id.node_id = "stick-h8-demo";
    id.app_ver = "h8-0.1+abc1234";
    write("hello.json", make_envelope("hello", build_hello_body(id, 0), "hello0000001", 1700000000000LL));
    id.node_key = "wk-h8-demo-1";
    write("hello_rekeyed.json",
          make_envelope("hello", build_hello_body(id, 0), "hello0000002", 1700000010000LL));
    StatusFields resp;
    resp.node_id = "stick-h8-demo";
    resp.app_ver = "h8-0.1+abc1234";
    resp.kind = "respawn";
    resp.team = 1;
    resp.station_id = 3;
    resp.threshold = -74;
    resp.live = true;
    resp.armed = true;
    resp.battery_pct = 81;
    write("status_respawn.json",
          make_envelope("status", build_status_body(resp), "status000001", 1700000020000LL));
    StatusFields ctrl;
    ctrl.node_id = "stick-h8-demo";
    ctrl.app_ver = "h8-0.1+abc1234";
    ctrl.kind = "control";
    ctrl.team = 255;
    ctrl.station_id = 9;
    ctrl.live = true;
    ctrl.armed = true;
    ctrl.has_control = true;
    ctrl.control_owner = 1;
    ctrl.control_progress = 50;
    write("status_control.json",
          make_envelope("status", build_status_body(ctrl), "status000002", 1700000030000LL));
    std::printf("wrote goldens to %s\n", dir.c_str());
    return 0;
  }
  test_json_round_trips_the_shapes_we_actually_send();
  test_json_tolerates_garbage();
  test_json_escapes_quotes_and_backslashes();
  test_hello_body_matches_the_wire_contract();
  test_status_body_matches_utility_js_shape();
  test_envelope_wraps_the_body_with_v_kind_id_t();
  test_parse_welcome();
  test_parse_station_config_with_and_without_item();
  test_item_spawn_every_s_is_clamped_to_the_advert_byte();
  test_parse_station_update();
  test_parse_control_cmd();
  test_station_kind_byte_maps_every_kind();
  test_a_respawn_station_advertises_ready_not_disabled();
  test_threshold_zero_or_absent_means_the_sticks_own_default();
  test_powerup_schedule_starts_unknown_without_a_report();
  test_powerup_schedule_taken_counts_down_locally_from_the_last_update();
  test_powerup_schedule_caps_value_at_255();
  test_powerup_schedule_self_spawns_when_mc_is_unreachable();
  test_a_claim_marks_taken_and_folds_the_next_spawn_forward();
  test_mark_taken_never_double_spawns_an_instant_already_passed();
  test_mc_available_true_clears_the_taker();
  test_item_configures_the_schedules_spawn_period();
  test_claim_gate_awards_the_first_ready_advert_for_its_own_id();
  test_ready_claim_resolves_after_short_tie_window();
  test_claim_feed_pause_discards_a_pending_ready_candidate();
  test_same_powerup_lock_config_keeps_pending_claim();
  test_claim_award_is_visible_to_the_next_advert_decision();
  test_claim_gate_ties_in_one_batch_go_to_the_lower_player_num();
  test_claim_gate_a_batch_with_no_ready_advert_awards_nothing();
  test_claim_gate_ignores_a_dead_claimant_and_player_zero();
  test_claim_gate_unscoped_game_zero_matches_anything();
  test_switching_away_and_back_to_powerup_resets_the_schedule();
  test_reassigning_a_powerup_to_a_new_id_resets_the_schedule();
  test_a_new_game_resets_the_schedule_but_a_same_game_repush_does_not();
  test_switching_to_held_clears_a_muster_drop();
  test_link_walks_through_every_state_in_order();
  test_ws_closed_never_discards_identity_or_assignment();
  test_wifi_down_from_not_configured_stays_not_configured();
  test_release_drops_to_unassigned_but_keeps_the_link();
  test_station_update_applies_only_to_the_currently_assigned_id();
  test_muster_drops_the_link_at_match_start_held_does_not();
  test_has_powerup_assignment_survives_a_link_drop();
  test_self_spawn_still_ticks_after_a_link_drop();
  test_claim_still_awards_after_a_link_drop();
  test_a_non_powerup_assignment_never_reports_a_powerup_assignment();
  test_the_first_ever_arm_sets_dropped_for_match_under_muster();
  test_held_never_sets_dropped_for_match();
  test_a_same_game_repush_does_not_set_dropped_for_match();
  test_dropped_for_match_latches_until_explicitly_cleared();
  test_a_new_game_number_sets_dropped_for_match_again_after_a_reconnect();
  test_pending_action_queue_is_fifo_and_drops_the_oldest_when_full();
  test_pending_action_queue_newest_per_spawn_instant_wins();
  test_pending_action_queue_pop_front_on_empty_queue_fails();
  test_award_claim_enqueues_with_the_station_id_captured_at_award_time();
  test_a_new_game_clears_unsent_taken_reports();
  test_a_bare_available_true_for_the_awarded_spawn_is_refused();
  test_an_available_true_too_soon_after_the_awarded_instant_is_refused();
  test_an_available_true_far_enough_past_the_awarded_instant_is_accepted();
  test_reset_true_is_always_accepted_regardless_of_timing();
  test_should_accept_available_with_nothing_awarded_always_accepts();
  test_backoff_doubles_and_caps_and_resets_on_welcome();
  test_parse_station_config_lock_s_is_clamped_and_absent_means_zero();
  test_match_lock_counts_down_and_auto_unlocks_once();
  test_match_lock_is_wrap_safe();
  test_match_lock_is_replaced_not_extended_and_zero_unlocks();
  test_a_same_game_repush_replaces_the_lock_and_keeps_everything_else();
  test_release_lifts_the_lock();
  test_status_body_carries_health_fields_only_when_set();
  test_saved_config_round_trips_without_lock_s();
  test_a_same_config_repush_with_a_new_lock_does_not_rewrite_storage();
  test_a_restored_assignment_applies_unlocked_and_never_latches_the_muster_drop();
  test_mc_config_after_a_restore_replaces_it_without_a_second_schedule_reset();
  test_release_clears_the_saved_config_and_the_restored_flag();
  test_a_welcome_from_another_session_erases_the_saved_config_and_drops_the_restore();
  test_a_new_session_never_touches_a_config_mc_sent_this_boot();
  test_the_muster_drop_after_a_restore_waits_for_the_re_anchor_or_2_s();
  test_unknown_schedule_awards_nothing_and_never_self_spawns();
  test_taken_with_no_anchor_shows_state_zero_not_available();
  test_muster_fresh_powerup_arm_waits_for_the_first_update_with_no_timeout();
  test_a_latched_drop_still_rejoins_wi_fi_until_the_radio_actually_drops();
  test_a_waiting_powerup_that_loses_mc_falls_back_to_available_then_drops();
  test_a_blip_while_waiting_rejoins_and_start_still_anchors_the_schedule();
  test_a_release_while_waiting_for_start_cancels_the_pending_drop();
  test_an_mc_restart_in_lobby_keeps_waiting_while_wi_fi_is_up();
  test_a_held_powerup_that_cannot_reach_mc_falls_back_to_available();
  test_muster_fresh_non_powerup_arm_drops_at_once();
  test_muster_hill_waits_for_start_config_or_offline_timeout();
  test_untimed_hill_start_config_releases_muster_without_changing_hill();
  test_hill_waits_for_go_live_before_capture_or_tally();
  test_held_hill_starts_after_sixty_seconds_offline_without_start();
  test_muster_powerup_rearmed_as_respawn_before_the_update_drops_at_once();
  test_restore_of_a_saved_powerup_config_is_known_and_available_at_once();
  test_a_new_game_resets_the_hill_and_a_same_game_repush_keeps_it();
  test_a_respawn_assignment_counts_revives_and_a_new_game_zeroes_them();
    test_status_carries_revives_and_hold_ms_additively();
  test_hill_stops_accruing_when_deadline_freezes_it();
  test_hill_starts_only_at_config_go_live_and_stops_at_deadline();
  test_timed_hill_anchors_on_first_alive_same_game_advert_without_rssi_gate();
  test_parse_signed_go_live_offset();
  test_same_game_config_without_times_cancels_a_pending_start();
  test_late_start_discards_offline_fallback_capture();
  test_hill_reset_after_whistle_stays_frozen();
  test_same_game_config_without_times_waits_again();
  test_saved_config_restore_discards_an_old_local_deadline();
  test_abort_explicitly_clears_same_game_deadline();
  test_restored_timed_hill_waits_for_a_fresh_clock();
  test_restored_timed_hill_accepts_untimed_start_config();
  test_presence_threshold_is_the_phone_default_when_mc_sends_none();
  test_hill_default_threshold_separates_measurement_from_phone_advert();
  test_saved_hill_round_trips_owner_and_tally_and_restores_the_hold();
  test_saved_hill_writes_only_on_an_owner_change();
  test_saved_hill_flushes_final_tally_once_at_whistle();
  test_saved_hill_tag_mismatch_is_neutral_and_new_game_session_or_release_clears();
  test_reset_hill_neutralises_only_an_assigned_control_point();
  test_assignment_epoch_moves_on_a_new_station_only();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("sticks3 link: all checks passed\n");
  return 0;
}
