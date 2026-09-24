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
}

// ---- reset confirm and its draining timeout -------------------------------------------------
static void test_reset_confirm_timeout_and_hint() {
  StickState s;
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

  // Standalone bench mode (Wi-Fi never configured) shows diagnostics instead of the stats table.
  StickState bench;
  bench.at_home = false;
  bench.link_state = LinkState::NOT_CONFIGURED;
  ScreenSpec diag = compute_screen(bench);
  CHECK(diag.kind == ScreenKind::SCR_DIAGNOSTICS);
}

// ---- an unassigned, unarmed link shows JOINING while at home ---------------------------------
static void test_unassigned_link_shows_joining() {
  StickState s;
  s.at_home = true;
  s.link_state = LinkState::LOOKING_FOR_MC;
  ScreenSpec spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::SCR_JOINING);
}

// ---- a respawn/extraction/bomb assignment is shown and reported, not faked ------------------
static void test_unrun_kind_shows_assigned_not_fake_gameplay() {
  StickState s;
  s.at_home = true;
  s.assignment_present = true;
  s.stats_kind_label = "RESPAWN #1";
  ScreenSpec spec = compute_screen(s);
  CHECK(spec.kind == ScreenKind::SCR_ASSIGNED);
  CHECK_EQ(spec.assigned_role, std::string("RESPAWN #1"));
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

int main() {
  test_format_mmss();
  test_pickup_ready_vs_taken();
  test_reset_confirm_timeout_and_hint();
  test_reset_outcome_offline_vs_sent();
  test_low_battery_takes_priority();
  test_home_vs_stats_and_default_hint();
  test_unassigned_link_shows_joining();
  test_unrun_kind_shows_assigned_not_fake_gameplay();
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
