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

static void test_powerup_schedule_defaults_to_available_with_no_report_yet() {
  PowerupSchedule s;
  CHECK(s.available());
  PowerupAdvertView v = s.view(5000);
  CHECK_EQ(v.state, (uint8_t)1);
  CHECK_EQ(v.value, (uint8_t)0);
  CHECK_EQ(v.taker, (uint8_t)0);
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
  g.observe(/*player_num=*/5, /*target_station_id=*/9, /*game=*/3, false, true, -50);  // wrong station
  g.observe(5, 8, 3, false, true, -90);   // right station, too weak (below -80 dBm floor)
  g.observe(5, 8, 9, false, true, -50);   // right station, wrong game
  ClaimWinner none = g.resolve_batch();
  CHECK(!none.won);
  g.observe(5, 8, 3, false, true, -80);   // exactly at the floor: strong enough
  ClaimWinner w = g.resolve_batch();
  CHECK(w.won);
  CHECK_EQ(w.player_num, (uint8_t)5);
}

static void test_claim_gate_ties_in_one_batch_go_to_the_lower_player_num() {
  ClaimGate g;
  g.configure(8, 0);
  g.observe(9, 8, 0, false, true, -50);
  g.observe(3, 8, 0, false, true, -50);
  g.observe(20, 8, 0, false, true, -50);
  ClaimWinner w = g.resolve_batch();
  CHECK(w.won);
  CHECK_EQ(w.player_num, (uint8_t)3);
}

static void test_claim_gate_a_batch_with_no_ready_advert_awards_nothing() {
  ClaimGate g;
  g.configure(8, 0);
  g.observe(5, 8, 0, /*claiming=*/true, /*claim_ready=*/false, -50);  // dwelling, not ready yet
  CHECK(g.any_claiming_this_batch());
  ClaimWinner w = g.resolve_batch();
  CHECK(!w.won);
  CHECK(!g.any_claiming_this_batch());  // resolve_batch clears it for the next batch
}

static void test_claim_gate_unscoped_game_zero_matches_anything() {
  ClaimGate g;
  g.configure(8, 0);  // this station's own game byte is 0 (unscoped)
  g.observe(5, 8, 7, false, true, -50);  // the claimant's game is scoped; still matches
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
  ClaimWinner w{true, 5};
  CHECK(link.award_claim(w, 1000));
  PendingTakenReport out;
  CHECK(link.pop_pending_action(out));
  CHECK_EQ(out.station_id, 8);
  CHECK_EQ(out.player_num, 5);
  CHECK(!link.has_pending_actions());  // drained
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

int main(int argc, char** argv) {
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
  test_threshold_zero_or_absent_means_the_sticks_own_default();
  test_powerup_schedule_defaults_to_available_with_no_report_yet();
  test_powerup_schedule_taken_counts_down_locally_from_the_last_update();
  test_powerup_schedule_caps_value_at_255();
  test_powerup_schedule_self_spawns_when_mc_is_unreachable();
  test_a_claim_marks_taken_and_folds_the_next_spawn_forward();
  test_mark_taken_never_double_spawns_an_instant_already_passed();
  test_mc_available_true_clears_the_taker();
  test_item_configures_the_schedules_spawn_period();
  test_claim_gate_awards_the_first_ready_advert_for_its_own_id();
  test_claim_gate_ties_in_one_batch_go_to_the_lower_player_num();
  test_claim_gate_a_batch_with_no_ready_advert_awards_nothing();
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
  test_a_bare_available_true_for_the_awarded_spawn_is_refused();
  test_an_available_true_too_soon_after_the_awarded_instant_is_refused();
  test_an_available_true_far_enough_past_the_awarded_instant_is_accepted();
  test_reset_true_is_always_accepted_regardless_of_timing();
  test_should_accept_available_with_nothing_awarded_always_accepts();
  test_backoff_doubles_and_caps_and_resets_on_welcome();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("sticks3 link: all checks passed\n");
  return 0;
}
