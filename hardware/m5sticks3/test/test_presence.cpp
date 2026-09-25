// Host tests for presence.h, the Bluetooth-only station core. Build + run:
//   g++ -std=c++17 -I.. test_presence.cpp -o /tmp/test_presence && /tmp/test_presence
// mcp/tests/test_sticks3_core.py does exactly that when g++ exists.
//
// Every expectation here is what app/src/beacon.js Presence, app/src/control.js ControlPoint or
// app/src/utility.js tick() does with the same inputs: the Stick must give a phone the answer a phone
// station standing at the same spot would give.
#include <cstdio>
#include <string>

#include "brx_advert.h"
#include "control_point.h"
#include "presence.h"

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

static Advert player(uint16_t id, uint8_t team, bool alive = true, uint8_t game = 0) {
  Advert a;
  a.role = ROLE_PLAYER;
  a.id = id;
  a.team = team;
  a.state = alive ? PLAYER_ALIVE : 0;
  a.game = game;
  return a;
}

// A field of players standing ON the point (strong RSSI). The point tests run with no dwell, so a
// player counts from the first tick; the dwell has its own tests above them.
struct Field {
  PlayerPresence pr;
  uint32_t t = 0;
  Field() { pr.dwell_ms = 0; }
  void add(uint16_t id, uint8_t team, bool alive = true) { pr.observe(player(id, team, alive), -50, t); }
  void settle() { pr.tick(t); }
  // Re-hear everyone (as a scan would), keeping their current bits.
  void refresh() {
    for (size_t i = 0; i < pr.capacity(); i++) {
      const PlayerEntry& e = pr.slot(i);
      if (!e.used) continue;
      Advert a = player(e.id, e.team, (e.state & PLAYER_ALIVE) != 0);
      pr.observe(a, -50, t);
    }
  }
};

// Run the point every STATION_TICK_MS for `ms`, re-hearing the field each tick. Returns the OR of the
// edges seen, so a test can ask "was it captured in this stretch".
static HillUpdate run(BleControlPoint& cp, Field& f, uint32_t ms) {
  HillUpdate all;
  for (uint32_t e = 0; e < ms; e += STATION_TICK_MS) {
    f.t += STATION_TICK_MS;
    f.refresh();
    f.pr.tick(f.t);
    HillUpdate u = cp.update(f.pr, f.t);
    if (u.captured) { all.captured = true; all.captured_team = u.captured_team; all.captured_from = u.captured_from; }
    if (u.neutralised) { all.neutralised = true; all.neutralised_team = u.neutralised_team; all.neutralised_by = u.neutralised_by; }
    all.contested_edge |= u.contested_edge;
    all.uncontested_edge |= u.uncontested_edge;
    all.refused |= u.refused;
  }
  return all;
}

// ---- PlayerPresence -------------------------------------------------------------------------------

static void test_presence_dwell() {
  PlayerPresence pr;  // -74 dBm, 800 ms: utility.js DEFAULTS
  pr.observe(player(7, 0), -60, 1000);
  pr.tick(1000);
  CHECK(!pr.get(7)->present);
  pr.observe(player(7, 0), -60, 1500);
  pr.tick(1799);  // 799 ms above: not yet
  CHECK(!pr.get(7)->present);
  pr.tick(1800);  // 800 ms: present
  CHECK(pr.get(7)->present);
}

static void test_presence_dwell_restarts_when_the_ema_dips() {
  PlayerPresence pr;
  pr.alpha = 1.0;  // the EMA IS the last sample, so the test controls it exactly
  pr.observe(player(7, 0), -60, 0);
  pr.tick(0);
  pr.observe(player(7, 0), -90, 500);  // below the threshold: sinceAbove = null
  pr.tick(500);
  pr.observe(player(7, 0), -60, 600);
  pr.tick(600);
  pr.tick(1300);
  CHECK(!pr.get(7)->present);  // only 700 ms since it came back above
  pr.tick(1400);
  CHECK(pr.get(7)->present);
}

static void test_presence_ema_is_beacon_js() {
  PlayerPresence pr;
  pr.observe(player(7, 0), -60, 0);
  CHECK(pr.get(7)->rssi == -60.0);  // a new entry starts AT its first sample
  pr.observe(player(7, 0), -80, 100);
  CHECK(pr.get(7)->rssi == -60.0 + 0.35 * (-80.0 - -60.0));  // -67
  CHECK_EQ(pr.get(7)->raw, -80);
}

static void test_presence_six_db_hysteresis() {
  PlayerPresence pr;
  pr.alpha = 1.0;
  pr.observe(player(7, 0), -70, 0);
  pr.tick(0);
  pr.tick(800);
  CHECK(pr.get(7)->present);
  pr.observe(player(7, 0), -80, 900);  // exactly thr - 6: `<` is strict, still present
  pr.tick(900);
  CHECK(pr.get(7)->present);
  pr.observe(player(7, 0), -79, 1000);  // inside the band: still present, no dwell needed
  pr.tick(1000);
  CHECK(pr.get(7)->present);
  pr.observe(player(7, 0), -81, 1100);  // 7 dB below: off
  pr.tick(1100);
  CHECK(!pr.get(7)->present);
  pr.observe(player(7, 0), -75, 1200);  // back inside the band but below the threshold: stays off
  pr.tick(1200);
  pr.tick(3000);
  CHECK(!pr.get(7)->present);
}

static void test_presence_four_second_expiry() {
  PlayerPresence pr;
  pr.observe(player(7, 0), -50, 0);
  pr.tick(0);
  pr.tick(800);
  CHECK(pr.get(7)->present);
  pr.tick(4000);  // exactly 4 s: `>` is strict, still present
  CHECK(pr.get(7)->present);
  pr.tick(4001);
  CHECK(!pr.get(7)->present);
  CHECK(pr.get(7) != nullptr);  // kept until twice the expiry
  pr.tick(8000);
  CHECK(pr.get(7) != nullptr);
  pr.tick(8001);
  CHECK(pr.get(7) == nullptr);
  CHECK_EQ(pr.count(), (size_t)0);
}

static void test_presence_game_byte_and_roles() {
  PlayerPresence pr;
  pr.game = 42;
  CHECK(pr.observe(player(1, 0, true, 42), -50, 0) != nullptr);
  CHECK(pr.observe(player(2, 0, true, 0), -50, 0) != nullptr);   // 0 = any game
  CHECK(pr.observe(player(3, 0, true, 43), -50, 0) == nullptr);  // another match's player
  Advert st = player(4, 0);
  st.role = ROLE_STATION;
  CHECK(pr.observe(st, -50, 0) == nullptr);  // a Stick counts players, never other stations
  CHECK_EQ(pr.count(), (size_t)2);
  // A player advert's own threshold byte, when set, is used (beacon.js thresholdFor).
  Advert a = player(5, 0);
  a.threshold = -60;
  pr.observe(a, -65, 0);
  CHECK_EQ(pr.threshold_for(*pr.get(5)), -60);
  CHECK_EQ(pr.threshold_for(*pr.get(1)), PRESENCE_DEFAULT_THRESHOLD_DBM);
}

static void test_presence_drops_a_65th_player_and_counts_it() {
  PlayerPresence pr;
  for (uint16_t i = 1; i <= PRESENCE_MAX_PLAYERS; i++) CHECK(pr.observe(player(i, 0), -50, 0) != nullptr);
  CHECK(pr.observe(player(500, 0), -50, 0) == nullptr);
  CHECK_EQ(pr.dropped(), 1u);
  CHECK(pr.get(1) != nullptr);
}

// ---- BleControlPoint ------------------------------------------------------------------------------

static void test_lone_player_takes_a_neutral_point_in_ten_seconds() {
  Field f;
  f.add(1, 0);
  f.settle();
  BleControlPoint cp;
  cp.update(f.pr, f.t);  // the first update measures no time
  CHECK_EQ(cp.advert().team, (uint8_t)TEAM_ANY);
  CHECK_EQ(cp.advert().state, (uint8_t)0);
  HillUpdate u = run(cp, f, 9750);
  CHECK(!u.captured);
  CHECK_EQ(cp.owner, HILL_NEUTRAL);
  CHECK_EQ(cp.capturing, 0);
  // Rising for red, not held, 97.5 -> Math.round = 98.
  CHECK_EQ(cp.advert().team, (uint8_t)0);
  CHECK_EQ(cp.advert().state, (uint8_t)CONTROL_RISING);
  CHECK_EQ(cp.advert().value, (uint8_t)98);
  u = run(cp, f, 250);
  CHECK(u.captured);
  CHECK_EQ(u.captured_team, 0);
  CHECK_EQ(u.captured_from, -1);
  CHECK_EQ(cp.owner, 0);
  CHECK_EQ(cp.advert().state, (uint8_t)CONTROL_HELD);  // at 100: held, no direction
  CHECK_EQ(cp.advert().value, (uint8_t)100);
  CHECK_EQ(cp.captures, 1u);
}

static void test_team_two_is_refused_and_dead_players_count_for_nothing() {
  Field f;
  f.add(1, 2);          // F82: tid 2
  f.add(2, 1, false);   // blue, DOWN
  f.add(3, 5);          // a colour tid: no claim
  f.settle();
  BleControlPoint cp;
  cp.update(f.pr, f.t);
  HillUpdate u = run(cp, f, 5000);
  CHECK_EQ(cp.progress, 0.0);
  CHECK_EQ(cp.capturing, -1);
  CHECK_EQ(cp.lead, -1);
  CHECK(!cp.contested);
  CHECK_EQ(cp.advert().team, (uint8_t)TEAM_ANY);
  // The refused banner rose once (on the first update), not every tick.
  BleControlPoint cp2;
  CHECK(cp2.update(f.pr, f.t).refused);
  CHECK(!cp2.update(f.pr, f.t + 250).refused);
  (void)u;
}

static void test_net_is_the_leader_minus_the_largest_other_team_capped_at_three() {
  Field f;
  for (uint16_t i = 1; i <= 5; i++) f.add(i, 0);  // five red
  f.settle();
  BleControlPoint cp;
  cp.update(f.pr, f.t);
  run(cp, f, 1000);
  CHECK_EQ(cp.net, 3);  // capped
  CHECK(cp.progress > 29.99 && cp.progress < 30.01);
  // 2v1v1 converts slowly rather than stalling: net = 2 - 1.
  Field g;
  g.add(1, 0); g.add(2, 0); g.add(3, 1); g.add(4, 3);
  g.settle();
  BleControlPoint cp2;
  cp2.update(g.pr, g.t);
  run(cp2, g, 1000);
  CHECK_EQ(cp2.lead, 0);
  CHECK_EQ(cp2.net, 1);
  CHECK(cp2.contested);
  CHECK(cp2.progress > 9.99 && cp2.progress < 10.01);
  CHECK_EQ(cp2.advert().state, (uint8_t)(CONTROL_CONTESTED | CONTROL_RISING));
}

static void test_an_even_fight_stalls_and_is_contested() {
  Field f;
  f.add(1, 0);
  f.add(2, 1);
  f.settle();
  BleControlPoint cp;
  HillUpdate first = cp.update(f.pr, f.t);
  CHECK(first.contested_edge);
  run(cp, f, 3000);
  CHECK_EQ(cp.net, 0);
  CHECK_EQ(cp.dir, 0);
  CHECK_EQ(cp.progress, 0.0);
  // A tie for the lead goes to the lower tid (control.js `|| a - b`), but nets zero.
  CHECK_EQ(cp.lead, 0);
  CHECK_EQ(cp.advert().state, (uint8_t)CONTROL_CONTESTED);
  CHECK_EQ(cp.advert().team, (uint8_t)TEAM_ANY);
}

static void test_an_enemy_held_point_drains_to_neutral_before_it_builds() {
  Field f;
  f.add(1, 0);
  f.settle();
  BleControlPoint cp;
  cp.update(f.pr, f.t);
  run(cp, f, 10000);
  CHECK_EQ(cp.owner, 0);
  // Red leaves, blue arrives alone.
  Field g;
  g.t = f.t;
  g.add(9, 1);
  g.settle();
  cp.update(g.pr, g.t);  // no time has passed: no drain yet
  CHECK_EQ(cp.owner, 0);
  CHECK(cp.progress > 99.99);
  HillUpdate u = run(cp, g, 5000);
  CHECK(!u.neutralised);
  CHECK_EQ(cp.owner, 0);  // still RED's, half drained
  CHECK_EQ(cp.advert().team, (uint8_t)0);
  CHECK_EQ(cp.advert().state, (uint8_t)(CONTROL_HELD | CONTROL_FALLING));
  CHECK_EQ(cp.advert().value, (uint8_t)50);
  u = run(cp, g, 5000);
  CHECK(u.neutralised);
  CHECK_EQ(u.neutralised_team, 0);
  CHECK_EQ(u.neutralised_by, 1);
  CHECK_EQ(cp.owner, HILL_NEUTRAL);
  CHECK_EQ(cp.capturing, 1);
  CHECK_EQ(cp.last_owner, 0);
  u = run(cp, g, 10000);
  CHECK(u.captured);
  CHECK_EQ(u.captured_team, 1);
  CHECK_EQ(u.captured_from, 0);  // who was robbed
  CHECK_EQ(cp.owner, 1);
}

static void test_a_zero_crossing_carries_the_remaining_work_into_the_build() {
  Field f;
  f.add(1, 0);
  f.settle();
  BleControlPoint cp;
  cp.capturing = 1;  // blue had built 1% and left
  cp.progress = 1;
  cp.update(f.pr, f.t);
  run(cp, f, 250);  // 2.5 points of work: 1 drains blue's bar, 1.5 builds red's
  CHECK_EQ(cp.capturing, 0);
  CHECK(cp.progress > 1.49 && cp.progress < 1.51);
  CHECK_EQ(cp.dir, 1);
  CHECK_EQ(cp.advert().state, (uint8_t)CONTROL_RISING);
}

static void test_a_part_built_bar_with_nobody_on_it_stalls() {
  Field f;
  f.add(1, 0);
  f.settle();
  BleControlPoint cp;
  cp.update(f.pr, f.t);
  run(cp, f, 1000);
  CHECK_EQ(cp.capturing, 0);
  Field empty;
  empty.t = f.t;
  cp.update(empty.pr, empty.t + 250);
  CHECK_EQ(cp.capturing, 0);  // 10% built and nobody here: it STALLS for red, it is not cleared
  CHECK_EQ(cp.dir, 0);
  CHECK_EQ(cp.advert().team, (uint8_t)0);
  CHECK_EQ(cp.advert().state, (uint8_t)0);
  CHECK_EQ(cp.advert().value, (uint8_t)10);
}

static void test_a_long_gap_is_clamped_for_conversion_but_not_for_possession() {
  Field f;
  f.add(1, 0);
  f.settle();
  BleControlPoint cp;
  cp.update(f.pr, f.t);
  run(cp, f, 10000);
  CHECK_EQ(cp.owner, 0);
  const uint32_t held = cp.hold_ms[0];
  f.t += 5000;  // a 5 s stall between ticks
  f.refresh();
  f.pr.tick(f.t);
  cp.update(f.pr, f.t);
  CHECK_EQ(cp.hold_ms[0], held + 5000);  // F103: possession is real time
  // Conversion: a blue alone after a 5 s gap drains 10 points, not 50.
  Field g;
  g.t = f.t;
  g.add(9, 1);
  g.settle();
  cp.update(g.pr, g.t);
  g.t += 5000;
  g.refresh();
  g.pr.tick(g.t);
  cp.update(g.pr, g.t);
  CHECK(cp.progress > 89.99 && cp.progress < 90.01);
}

static void test_contested_hill_pauses_owner_tally() {
  Field f;
  f.add(1, 0);
  f.settle();
  BleControlPoint cp;
  cp.update(f.pr, f.t);
  run(cp, f, 10000);
  CHECK_EQ(cp.owner, 0);
  const uint32_t before = cp.hold_ms[0];
  f.add(2, 1);
  f.settle();
  run(cp, f, 3000);
  CHECK(cp.contested);
  CHECK_EQ(cp.hold_ms[0], before);
}

static void test_progress_republishes_at_most_once_a_second_and_state_at_once() {
  Field f;
  f.add(1, 0);
  f.settle();
  BleControlPoint cp;
  AdvertPolicy pol;  // control.js ControlAdvertiser, already a port (brx_advert.h)
  cp.update(f.pr, f.t);
  uint32_t t0 = f.t;
  CHECK_EQ(std::string(pol.due(cp.advert(), t0)), std::string("first"));
  pol.published(cp.advert(), t0);
  int state_pubs = 0, progress_pubs = 0;
  uint32_t last_progress_at = 0;
  bool gap_ok = true;
  for (int i = 0; i < 20; i++) {  // 5 s of 250 ms ticks
    f.t += STATION_TICK_MS;
    f.refresh();
    f.pr.tick(f.t);
    cp.update(f.pr, f.t);
    const char* why = pol.due(cp.advert(), f.t);
    if (!why) continue;
    if (std::string(why) == "state") state_pubs++;
    if (std::string(why) == "progress") {
      if (progress_pubs && f.t - last_progress_at < 1000) gap_ok = false;
      progress_pubs++;
      last_progress_at = f.t;
    }
    pol.published(cp.advert(), f.t);
  }
  CHECK_EQ(state_pubs, 1);       // neutral -> red rising, at once, on the first tick with work
  CHECK_EQ(progress_pubs, 4);    // then 1250, 2250, 3250, 4250 ms after it
  CHECK(gap_ok);
}

static void test_reset_keeps_the_tuning() {
  BleControlPoint cp;
  cp.capture_s = 20;
  cp.owner = 1;
  cp.progress = 100;
  cp.hold_ms[1] = 5;
  cp.reset();
  CHECK_EQ(cp.owner, HILL_NEUTRAL);
  CHECK_EQ(cp.progress, 0.0);
  CHECK_EQ(cp.hold_ms[1], 0u);
  CHECK_EQ(cp.capture_s, 20);
}

// ---- ReviveCounter --------------------------------------------------------------------------------

// F344 (brx5, beacon.js countRevives): a revive counts when the player is NEAR (median of the last 3 raw
// readings >= threshold - 10 dB), with NO dwell: a walk-in revive never reached `present`.
// Tony (2026-09-24): the explicit signal. A player advert with PLAYER_REVIVED (bit6) and value == this
// station's id counts once per rising edge, with NO RSSI (the Stick hears phones weakly and sparsely).
static void test_revive_counts_on_the_advert_bit_without_rssi() {
  PlayerPresence pr;
  pr.default_threshold = -57;
  ReviveCounter rc;
  auto adv = [](uint8_t state, uint8_t value) { Advert d; d.role = 2; d.id = 2; d.team = 2; d.state = state; d.value = value; return d; };
  pr.observe(adv(0, 0), -88, 0);  // dead, far below any near floor
  pr.tick(0);
  CHECK_EQ(rc.update(pr, 1), 0u);
  pr.observe(adv(PLAYER_ALIVE | PLAYER_REVIVED, 1), -86, 300);  // revived at station 1, still "far" by RSSI
  pr.tick(300);
  CHECK_EQ(rc.update(pr, 1), 1u);
  pr.observe(adv(PLAYER_ALIVE | PLAYER_REVIVED, 1), -85, 1300);  // the 5 s hold: the same edge, not a second revive
  pr.tick(1300);
  CHECK_EQ(rc.update(pr, 1), 0u);
  pr.observe(adv(PLAYER_ALIVE | PLAYER_REVIVED, 3), -85, 1600);  // revived at ANOTHER station: not ours
  pr.tick(1600);
  CHECK_EQ(rc.update(pr, 1), 0u);
  pr.observe(adv(PLAYER_ALIVE, 0), -60, 6000);  // bit cleared; an alive edge near by RSSI must NOT double count
  pr.tick(6000);
  CHECK_EQ(rc.update(pr, 1), 0u);
  pr.observe(adv(0, 0), -60, 7000);
  pr.tick(7000);
  rc.update(pr, 1);
  pr.observe(adv(PLAYER_ALIVE | PLAYER_REVIVED, 1), -90, 7500);  // a second revive here
  pr.tick(7500);
  CHECK_EQ(rc.update(pr, 1), 1u);
  CHECK_EQ(rc.revives, 2u);
}

static void test_revive_counts_a_walk_in_without_dwell() {
  PlayerPresence pr;
  pr.default_threshold = -60;  // the Stick's platform default (Tony: 3 m)
  ReviveCounter rc;
  pr.observe(player(1, 0, false), -68, 0);  // down, 8 dB under the threshold: near, never present
  pr.observe(player(2, 0, false), -75, 0);  // down, beyond the margin
  pr.tick(0);
  CHECK_EQ(rc.update(pr), 0u);
  pr.observe(player(1, 0, true), -67, 200);  // up 200 ms later: no dwell needed
  pr.observe(player(2, 0, true), -74, 200);
  pr.tick(200);
  CHECK(!pr.get(1)->present);
  CHECK_EQ(rc.update(pr), 1u);  // only player 1
}

static void test_revives_count_a_present_players_alive_edge_only() {
  PlayerPresence pr;
  ReviveCounter rc;
  pr.observe(player(1, 0, false), -50, 0);  // down, at the station
  pr.observe(player(2, 0, false), -95, 0);  // down, far away
  pr.observe(player(3, 0, true), -50, 0);   // alive from the first sighting
  pr.tick(0);
  pr.tick(800);
  CHECK_EQ(rc.update(pr), 0u);
  pr.observe(player(1, 0, true), -50, 900);
  pr.observe(player(2, 0, true), -95, 900);  // came up, but not present: not a revive here
  pr.observe(player(3, 0, true), -50, 900);
  pr.tick(900);
  CHECK_EQ(rc.update(pr), 1u);
  CHECK_EQ(rc.revives, 1u);
  CHECK_EQ(rc.update(pr), 0u);  // an edge counts once
  // Down again, then up again: a second revive.
  pr.observe(player(1, 0, false), -50, 1000);
  pr.tick(1000);
  rc.update(pr);
  pr.observe(player(1, 0, true), -50, 1100);
  pr.tick(1100);
  rc.update(pr);
  CHECK_EQ(rc.revives, 2u);
  // Forgotten by Presence (2 x expiry), then heard alive again: a first sighting, no revive.
  pr.observe(player(1, 0, false), -50, 1200);
  pr.tick(1200);
  rc.update(pr);
  pr.tick(1200 + 2 * PRESENCE_EXPIRY_MS + 1);
  rc.update(pr);
  pr.observe(player(1, 0, true), -50, 20000);
  pr.tick(20000);
  rc.update(pr);
  CHECK_EQ(rc.revives, 2u);
  rc.reset();
  CHECK_EQ(rc.revives, 0u);
}

// ---- SightingRing -----------------------------------------------------------------------------------

static void test_sighting_ring_is_fifo_drops_the_newest_when_full_and_clears() {
  SightingRing<4> ring;  // holds 3 (one slot tells full from empty)
  CHECK(ring.push(player(1, 0), -50));
  CHECK(ring.push(player(2, 0), -51));
  CHECK(ring.push(player(3, 0), -52));
  CHECK(!ring.push(player(4, 0), -53));  // full: the newest is dropped and counted
  CHECK_EQ(ring.overflow(), 1u);
  Sighting s;
  CHECK(ring.pop(s));
  CHECK_EQ(s.advert.id, (uint16_t)1);
  CHECK_EQ(s.rssi, -50);
  CHECK(ring.push(player(5, 0), -54));  // wraps
  CHECK_EQ(ring.size(), (size_t)3);
  ring.clear();  // the assignment changed: an old station's sightings go
  CHECK_EQ(ring.size(), (size_t)0);
  CHECK(!ring.pop(s));
}

// ---- scan gating and the IR words -----------------------------------------------------------------

static void test_which_kinds_scan_for_players() {
  CHECK(station_needs_player_scan("control", false));
  // Post-MVP (presence.h): by default a respawn station only advertises, it never scans.
  CHECK_EQ(station_needs_player_scan("respawn", false), REVIVE_FEEDBACK_ENABLED);
  CHECK_EQ((int)scan_window_units("respawn"), 15);  // Block 9 S7: light, so it cannot starve the advert
  CHECK_EQ((int)scan_window_units("control"), 50);
  CHECK_EQ((int)scan_window_units("powerup"), 50);  // ready claim must reach the next 1 s scan batch
  CHECK(station_needs_player_scan("powerup", true));
  CHECK(!station_needs_player_scan("powerup", false));  // unchanged: no claim scan while taken
  CHECK(!station_needs_player_scan("extraction", true));
  CHECK(!station_needs_player_scan("bomb", true));
  CHECK(!station_needs_player_scan("", true));
}

static void test_hill_words_match_control_point_h() {
  for (int owner : {0, 1, 3, (int)TEAM_ANY}) {
    ControlPoint ir;
    ir.mode = Mode::HILL;
    ir.owner = (uint8_t)owner;
    CHECK_EQ(encode(hill_beacon_word(owner)), encode(ir.beacon_word()));
    CHECK_EQ(encode(hill_capture_word(owner)), encode(ir.capture_word()));
  }
  CHECK_EQ(hill_capture_word(1).mag, BEACON_CAPTURED);
  CHECK_EQ(hill_capture_word(HILL_NEUTRAL).team, GRENADE_NEUTRAL_TEAM);
}

int main() {
  test_presence_dwell();
  test_presence_dwell_restarts_when_the_ema_dips();
  test_presence_ema_is_beacon_js();
  test_presence_six_db_hysteresis();
  test_presence_four_second_expiry();
  test_presence_game_byte_and_roles();
  test_presence_drops_a_65th_player_and_counts_it();
  test_lone_player_takes_a_neutral_point_in_ten_seconds();
  test_team_two_is_refused_and_dead_players_count_for_nothing();
  test_net_is_the_leader_minus_the_largest_other_team_capped_at_three();
  test_an_even_fight_stalls_and_is_contested();
  test_an_enemy_held_point_drains_to_neutral_before_it_builds();
  test_a_zero_crossing_carries_the_remaining_work_into_the_build();
  test_a_part_built_bar_with_nobody_on_it_stalls();
  test_a_long_gap_is_clamped_for_conversion_but_not_for_possession();
  test_contested_hill_pauses_owner_tally();
  test_progress_republishes_at_most_once_a_second_and_state_at_once();
  test_reset_keeps_the_tuning();
  test_revive_counts_on_the_advert_bit_without_rssi();
  test_revive_counts_a_walk_in_without_dwell();
  test_revives_count_a_present_players_alive_edge_only();
  test_sighting_ring_is_fifo_drops_the_newest_when_full_and_clears();
  test_which_kinds_scan_for_players();
  test_hill_words_match_control_point_h();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("sticks3 presence: all checks passed\n");
  return 0;
}
