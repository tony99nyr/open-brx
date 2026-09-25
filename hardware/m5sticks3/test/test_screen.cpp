// Host tests for the Stick's screen MODEL (station_screen.h). Build + run:
//   g++ -std=c++17 -I.. test_screen.cpp -o /tmp/test_screen && /tmp/test_screen
// mcp/tests/test_sticks3_core.py does exactly that when g++ exists.
#include <cstdio>
#include <string>

#include "station_screen.h"

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

// ---- m:ss formatting -----------------------------------------------------------------------
static void test_format_mmss() {
  CHECK_EQ(format_mmss(100), std::string("1:40"));
  CHECK_EQ(format_mmss(5), std::string("0:05"));
  CHECK_EQ(format_mmss(0), std::string("0:00"));
  CHECK_EQ(format_mmss(3661), std::string("61:01"));  // minutes never wrap to hours
}

// ---- pickup: ready vs taken, and the P<n> fallback ------------------------------------------
static void test_pickup_ready_vs_taken() {
  StickState s;
  s.at_home = true;
  s.powerup_present = true;
  s.powerup_available = true;
  s.item_name = "ROCKETS";
  ScreenSpec ready = compute_screen(s);
  CHECK(ready.kind == ScreenKind::PICKUP_READY);
  CHECK_EQ(ready.item_name, std::string("ROCKETS"));

  s.powerup_available = false;
  s.powerup_taker = 7;
  s.powerup_remaining_s = 100;
  s.powerup_period_s = 200;
  ScreenSpec taken = compute_screen(s);  // no name lookup supplied: falls back to "P7"
  CHECK(taken.kind == ScreenKind::PICKUP_TAKEN);
  CHECK_EQ(taken.taken_by, std::string("P7"));
  CHECK_EQ(taken.next_spawn, std::string("1:40"));
  CHECK_EQ(taken.pickup_frac_pct, 50);  // half the period has elapsed

  auto lookup = [](int player_num) -> std::string { return player_num == 7 ? "VIPER" : ""; };
  ScreenSpec named = compute_screen(s, lookup);
  CHECK_EQ(named.taken_by, std::string("VIPER"));

  // MC said taken but named no taker (a Stick reboot lost it): no "TAKEN BY" with a blank name.
  s.powerup_taker = 0;
  ScreenSpec anon = compute_screen(s, lookup);
  CHECK(anon.kind == ScreenKind::PICKUP_TAKEN);
  CHECK_EQ(anon.taken_by, std::string(""));
}

// ---- reset confirm and its draining timeout -------------------------------------------------
static void test_reset_confirm_timeout_and_hint() {
  StickState s;
  s.link_state = LinkState::ASSIGNED;
  s.assignment_present = true;
  s.assignment_id = 4;
  s.button_phase = ButtonPhase::CONFIRM_ARMED;
  s.confirm_armed_at_ms = 1000;
  s.now_ms = 1000;  // just armed
  ScreenSpec fresh = compute_screen(s);
  CHECK(fresh.kind == ScreenKind::SCR_RESET_CONFIRM);
  CHECK_EQ(fresh.reset_timeout_pct, 100);
  CHECK_EQ(fresh.hint, std::string(RESET_CONFIRM_HINT));

  s.now_ms = 1000 + RESET_CONFIRM_TIMEOUT_MS / 2;
  ScreenSpec half = compute_screen(s);
  CHECK_EQ(half.reset_timeout_pct, 50);

  s.now_ms = 1000 + RESET_CONFIRM_TIMEOUT_MS;
  ScreenSpec done = compute_screen(s);
  CHECK_EQ(done.reset_timeout_pct, 0);
}

// ---- no station, nothing to reset; and never WI-FI CONNECTED before it is (gate 2026-09-24) ----
static void test_no_reset_offer_without_an_assignment() {
  StickState s;
  s.link_state = LinkState::WELCOMED;
  s.button_phase = ButtonPhase::CONFIRM_ARMED;  // even if a confirm were somehow open
  ScreenSpec spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::SCR_LINKED_WAITING);
  CHECK_EQ(spec.station_id_for_reset, -1);
  CHECK_EQ(spec.hint, std::string(NO_STATION_HINT));
  s.link_state = LinkState::LOOKING_FOR_MC;
  CHECK_EQ(compute_screen(s).hint, std::string(NO_STATION_HINT));
  s.assignment_present = true;  // a restored station still offers its reset
  s.assignment_id = 2;
  s.button_phase = ButtonPhase::NORMAL;
  CHECK_EQ(compute_screen(s).hint, std::string(DEFAULT_HINT));
}

static void test_joining_says_wifi_connected_only_once_it_is() {
  StickState s;
  s.link_state = LinkState::JOINING_WIFI;
  ScreenSpec joining = compute_screen(s);
  CHECK(joining.kind == ScreenKind::SCR_JOINING);
  CHECK(!joining.wifi_joined);
  s.link_state = LinkState::LOOKING_FOR_MC;
  CHECK(compute_screen(s).wifi_joined);
  s.link_state = LinkState::HELLO_SENT;
  CHECK(compute_screen(s).wifi_joined);
}

// ---- RESET NEEDS MISSION CONTROL when offline, RESET SENT when not -------------------------
static void test_reset_outcome_offline_vs_sent() {
  StickState s;
  s.reset_outcome_active = true;
  s.reset_outcome_ok = false;
  ScreenSpec needs_mc = compute_screen(s);
  CHECK(needs_mc.kind == ScreenKind::SCR_RESET_NEEDS_MC);

  s.reset_outcome_ok = true;
  ScreenSpec sent = compute_screen(s);
  CHECK(sent.kind == ScreenKind::SCR_RESET_SENT);
}

// ---- low battery takes priority over everything, including an open confirm -----------------
static void test_low_battery_takes_priority() {
  StickState s;
  s.battery_pct = 8;  // <= LOW_BATTERY_PCT
  s.button_phase = ButtonPhase::CONFIRM_ARMED;  // would otherwise be SCR_RESET_CONFIRM
  ScreenSpec spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::SCR_LOW_BATTERY);

  s.button_phase = ButtonPhase::NORMAL;
  s.reset_outcome_active = true;  // would otherwise be a reset outcome screen
  spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::SCR_LOW_BATTERY);

  s.reset_outcome_active = false;
  s.at_home = true;
  s.control_present = true;
  s.control_owner = 1;  // would otherwise be HILL_HELD
  spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::SCR_LOW_BATTERY);

  // Just above the threshold: battery no longer overrides.
  s.battery_pct = LOW_BATTERY_PCT + 1;
  spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::HILL_HELD);
}

// ---- home vs away, and the default hint bar --------------------------------------------------
static void test_home_vs_stats_and_default_hint() {
  StickState s;
  s.at_home = true;
  s.link_state = LinkState::ASSIGNED;
  s.assignment_present = true;
  s.control_present = true;
  s.control_owner = TEAM_ANY;
  ScreenSpec home = compute_screen(s);
  CHECK(home.kind == ScreenKind::HILL_NEUTRAL);
  CHECK_EQ(home.hint, std::string(DEFAULT_HINT));

  s.at_home = false;
  ScreenSpec away = compute_screen(s);
  CHECK(away.kind == ScreenKind::SCR_STATS);
  CHECK_EQ(away.hint, std::string(DEFAULT_HINT));
  CHECK_EQ(away.stats_battery, std::string("-"));  // no reading wired yet
  s.battery_pct = 64;
  CHECK_EQ(compute_screen(s).stats_battery, std::string("64%"));
  s.battery_pct = -1;

  // Standalone bench mode (Wi-Fi never configured) shows diagnostics instead of the stats table.
  StickState bench;
  bench.at_home = false;
  bench.link_state = LinkState::NOT_CONFIGURED;
  ScreenSpec diag = compute_screen(bench);
  CHECK(diag.kind == ScreenKind::SCR_DIAGNOSTICS);
  // The bench hint names the bench gestures and the current mode, never the operator's HOLD B: RESET.
  bench.bench_mode_label = "HILL";
  {
    StickState home = bench;
    home.at_home = true;
    home.control_present = true;  // the bench IR hill must not claim "shoot to capture" (post-MVP)
    CHECK(compute_screen(home).kind == ScreenKind::SCR_NO_WIFI);
  }
  CHECK_EQ(compute_screen(bench).hint, std::string("HILL   A: DIAG   HOLD B: MODE"));

  // Bench BRIDGE is not a hill: with no grenade beacon it says so, and a live one shows under BRIDGE.
  StickState br;
  br.at_home = true;
  br.control_present = true;
  br.control_owner = TEAM_ANY;
  br.bridge_mode = true;
  CHECK(compute_screen(br).kind == ScreenKind::BRIDGE_WAITING);
  br.bridge_beacon_live = true;
  ScreenSpec live = compute_screen(br);
  CHECK(live.kind == ScreenKind::HILL_NEUTRAL);
  CHECK_EQ(live.hill_kicker, std::string("BRIDGE"));
  br.bridge_mode = false;
  CHECK_EQ(compute_screen(br).hill_kicker, std::string("HILL POINT"));
}

// ---- an unassigned, unarmed link shows JOINING while at home ---------------------------------
static void test_respawn_redeploy_flash() {
  StickState s;
  s.at_home = true;
  s.link_state = LinkState::ASSIGNED;
  s.assignment_present = true;
  s.respawn_present = true;
  s.respawn_live = true;
  s.respawn_revives = 3;
  CHECK(compute_screen(s).kind == ScreenKind::RESPAWN_OWNED);
  s.respawn_redeploy = true;  // a revive just happened: the green flash, carrying the new count
  ScreenSpec f = compute_screen(s);
  if (REVIVE_FEEDBACK_ENABLED) {
    CHECK(f.kind == ScreenKind::RESPAWN_REDEPLOY);
    CHECK_EQ(f.revives, 3);
  } else {  // post-MVP (presence.h): no flash and no count, whatever the state says
    CHECK(f.kind == ScreenKind::RESPAWN_OWNED);
    CHECK_EQ(f.revives, 0);
  }
}

static void test_welcomed_unassigned_shows_linked_waiting() {
  StickState s;
  s.at_home = true;
  s.link_state = LinkState::WELCOMED;
  CHECK(compute_screen(s).kind == ScreenKind::SCR_LINKED_WAITING);
  s.link_state = LinkState::LOOKING_FOR_MC;
  CHECK(compute_screen(s).kind == ScreenKind::SCR_JOINING);
}

static void test_unassigned_link_shows_joining() {
  StickState s;
  s.at_home = true;
  s.link_state = LinkState::LOOKING_FOR_MC;
  ScreenSpec spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::SCR_JOINING);
}

// ---- an extraction/bomb assignment is shown and reported, not faked --------------------------
static void test_unrun_kind_shows_assigned_not_fake_gameplay() {
  StickState s;
  s.at_home = true;
  s.assignment_present = true;
  s.stats_kind_label = "EXTRACTION #1";
  ScreenSpec spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::SCR_ASSIGNED);
  CHECK_EQ(spec.assigned_role, std::string("EXTRACTION #1"));
}

// ---- the Bluetooth hill (presence.h): every state the advert can carry has its own screen ------
static StickState ble_hill() {
  StickState s;
  s.link_state = LinkState::ASSIGNED;
  s.at_home = true;
  s.assignment_present = true;
  s.control_present = true;
  s.control_ble = true;
  return s;
}

static void test_ble_hill_picks_neutral_capturing_losing_stalled_contested_and_held() {
  StickState s = ble_hill();
  ScreenSpec n = compute_screen(s);
  CHECK(n.kind == ScreenKind::HILL_NEUTRAL);
  CHECK_EQ(n.hill_note, std::string("STAND HERE TO CAPTURE"));

  s.control_bar_team = 1;  // blue building a neutral point
  s.control_dir = 1;
  s.control_progress_pct = 40;
  ScreenSpec cap = compute_screen(s);
  CHECK(cap.kind == ScreenKind::HILL_CAPTURING);
  CHECK_EQ(cap.hill_team, 1);
  CHECK_EQ(cap.hill_pct, 40);
  CHECK_EQ(cap.hill_verb, std::string("CAPTURING"));

  s.control_dir = 0;  // blue walked off at 40%
  CHECK_EQ(compute_screen(s).hill_verb, std::string("STALLED"));
  s.control_dir = -1;  // red is draining blue's bar
  CHECK_EQ(compute_screen(s).hill_verb, std::string("LOSING"));

  s.control_contested = true;
  ScreenSpec con = compute_screen(s);
  CHECK(con.kind == ScreenKind::HILL_CONTESTED);
  CHECK_EQ(con.hill_note, std::string("TEAMS ON THE POINT"));
  s.control_contested = false;

  s.control_owner = 0;  // red holds it
  s.control_bar_team = 0;
  s.control_dir = 0;
  s.control_progress_pct = 100;
  s.control_hold_time = "0:42";
  ScreenSpec held = compute_screen(s);
  CHECK(held.kind == ScreenKind::HILL_HELD);
  CHECK_EQ(held.hill_team, 0);
  CHECK_EQ(held.hold_time, std::string("0:42"));
  s.control_dir = 1;  // red topping its own bar back up: still HELD
  CHECK(compute_screen(s).kind == ScreenKind::HILL_HELD);
  s.control_dir = -1;  // blue draining red's point: red is LOSING it, bar in red
  s.control_progress_pct = 60;
  ScreenSpec losing = compute_screen(s);
  CHECK(losing.kind == ScreenKind::HILL_CAPTURING);
  CHECK_EQ(losing.hill_team, 0);
  CHECK_EQ(losing.hill_verb, std::string("LOSING"));
  CHECK_EQ(losing.hill_pct, 60);
}

static void test_bench_hill_is_unchanged_by_the_bluetooth_hill() {
  StickState s;
  s.link_state = LinkState::NOT_CONFIGURED;
  s.at_home = true;
  s.control_present = true;  // bench HILL (control_point.h), control_ble false
  s.control_dir = -1;        // ignored: the IR hill has no direction
  s.control_contested = true;
  ScreenSpec n = compute_screen(s);
  CHECK(n.kind == ScreenKind::HILL_NEUTRAL);
  CHECK_EQ(n.hill_note, std::string(""));  // the renderer keeps "SHOOT TO CAPTURE"
  s.control_owner = 3;
  CHECK(compute_screen(s).kind == ScreenKind::HILL_HELD);
  s.bridge_mode = true;
  s.bridge_beacon_live = false;
  CHECK(compute_screen(s).kind == ScreenKind::BRIDGE_WAITING);
}

static void test_respawn_shows_owned_with_revives_or_idle_when_the_advert_is_down() {
  StickState s;
  s.link_state = LinkState::ASSIGNED;
  s.at_home = true;
  s.assignment_present = true;
  s.respawn_present = true;
  s.respawn_team = 1;
  s.respawn_revives = 7;
  s.respawn_live = true;
  ScreenSpec owned = compute_screen(s);
  CHECK(owned.kind == ScreenKind::RESPAWN_OWNED);
  CHECK_EQ(owned.respawn_team, 1);
  CHECK_EQ(owned.revives, REVIVE_FEEDBACK_ENABLED ? 7 : 0);
  s.respawn_team = 255;  // a station for any team: no team named
  CHECK_EQ(compute_screen(s).respawn_team, -1);
  s.respawn_live = false;
  ScreenSpec idle = compute_screen(s);
  CHECK(idle.kind == ScreenKind::RESPAWN_IDLE);
  CHECK_EQ(idle.respawn_note, std::string("ADVERT DOWN"));
}

// ---- HomeNav: idle timeout, explicit go_home, and note_activity -----------------------------
static void test_home_nav_idle_timeout_returns_home_after_20s() {
  HomeNav nav;
  CHECK(nav.at_home());
  nav.leave_home(0);
  CHECK(!nav.at_home());
  CHECK(!nav.poll_idle(HOME_IDLE_TIMEOUT_MS - 1));
  CHECK(!nav.at_home());
  CHECK(nav.poll_idle(HOME_IDLE_TIMEOUT_MS));
  CHECK(nav.at_home());
}

static void test_home_nav_activity_resets_the_idle_clock() {
  HomeNav nav;
  nav.leave_home(0);
  nav.note_activity(10000);  // a page-cycling press part-way through the window
  CHECK(!nav.poll_idle(10000 + HOME_IDLE_TIMEOUT_MS - 1));
  CHECK(nav.poll_idle(10000 + HOME_IDLE_TIMEOUT_MS));
}

static void test_home_nav_go_home_is_immediate() {
  HomeNav nav;
  nav.leave_home(0);
  nav.go_home(1);  // long press A: home at once, no need to wait out the idle clock
  CHECK(nav.at_home());
}

// ---- A's long press also cancels an open confirm (station_ui.h's own cancel path, composed with
// HomeNav; this is the exact composition m5sticks3.ino's button handler performs) -------------
static void test_long_press_a_cancels_an_open_confirm_and_goes_home() {
  StationButtons buttons;
  HomeNav nav;
  nav.leave_home(0);
  buttons.on_long_press(0);  // B's first hold arms the confirm
  CHECK(buttons.phase() == ButtonPhase::CONFIRM_ARMED);

  // The .ino's A-long-press handler: cancel an armed confirm (station_ui.h's own short-press
  // cancel path), then go home. Neither call changes any station state.
  if (buttons.phase() == ButtonPhase::CONFIRM_ARMED) buttons.on_short_press();
  nav.go_home(500);

  CHECK(buttons.phase() == ButtonPhase::NORMAL);
  CHECK(nav.at_home());
}

// ---- A58: the match lock and the force restart ------------------------------------------------
static void test_a_locked_reset_shows_locked_and_the_strip_shows_the_padlock() {
  StickState s;
  s.locked = true;
  s.lock_remaining_s = 125;
  ScreenSpec home = compute_screen(s);
  CHECK(home.strip.locked);
  CHECK_EQ(home.hint, std::string(LOCKED_HINT));
  s.reset_outcome_active = true;
  s.reset_outcome_locked = true;
  ScreenSpec refused = compute_screen(s);
  CHECK(refused.kind == ScreenKind::SCR_RESET_LOCKED);
  CHECK_EQ(refused.lock_remaining, std::string("2:05"));
  s.locked = false;
  s.reset_outcome_active = false;
  CHECK(!compute_screen(s).strip.locked);
}

static void test_force_restart_countdown_beats_everything() {
  StickState s;
  s.battery_pct = 5;  // would be LOW BATTERY
  s.button_phase = ButtonPhase::CONFIRM_ARMED;
  s.force_restart_countdown_s = 4;
  ScreenSpec spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::SCR_FORCE_RESTART);
  CHECK_EQ(spec.restart_in_s, 4u);
  s.force_restart_countdown_s = 0;
  CHECK(compute_screen(s).kind == ScreenKind::SCR_LOW_BATTERY);
}

int main() {
  test_format_mmss();
  test_pickup_ready_vs_taken();
  test_reset_confirm_timeout_and_hint();
  test_no_reset_offer_without_an_assignment();
  test_joining_says_wifi_connected_only_once_it_is();
  test_reset_outcome_offline_vs_sent();
  test_a_locked_reset_shows_locked_and_the_strip_shows_the_padlock();
  test_force_restart_countdown_beats_everything();
  test_low_battery_takes_priority();
  test_home_vs_stats_and_default_hint();
  test_unassigned_link_shows_joining();
  test_welcomed_unassigned_shows_linked_waiting();
  test_respawn_redeploy_flash();
  test_unrun_kind_shows_assigned_not_fake_gameplay();
  test_ble_hill_picks_neutral_capturing_losing_stalled_contested_and_held();
  test_bench_hill_is_unchanged_by_the_bluetooth_hill();
  test_respawn_shows_owned_with_revives_or_idle_when_the_advert_is_down();
  test_home_nav_idle_timeout_returns_home_after_20s();
  test_home_nav_activity_resets_the_idle_clock();
  test_home_nav_go_home_is_immediate();
  test_long_press_a_cancels_an_open_confirm_and_goes_home();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("sticks3 screen: all checks passed\n");
  return 0;
}
