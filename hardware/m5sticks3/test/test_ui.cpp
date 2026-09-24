// Host tests for the Stick's on-device operator UI (station_ui.h). Build + run:
//   g++ -std=c++17 -I.. test_ui.cpp -o /tmp/test_ui && /tmp/test_ui
// mcp/tests/test_sticks3_core.py does exactly that when g++ exists.
#include <cstdio>
#include <string>

#include "station_ui.h"

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

static void test_station_action_body_is_pinned() {
  CHECK_EQ(build_station_action_body(9, "reset", 1700000000000LL),
           std::string("{\"id\":9,\"action\":\"reset\",\"t\":1700000000000}"));
  CHECK_EQ(build_station_action_taken_body(9, 5, 1700000000000LL, 250),
           std::string("{\"id\":9,\"action\":\"taken\",\"player_num\":5,\"age_ms\":250,\"t\":1700000000000}"));
}

// ACTIONS is ON by default since MC accepts station_action (A56, f3fe3cf6). `ACTIONS OFF` (for an older MC, which
// would count the kind toward its malformed-frame quarantine) must still build nothing.
static void test_actions_on_by_default_and_off_builds_nothing() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 9;
  link.apply_station_config(a);
  PendingTakenReport rep{9, 5, 0, 1000};
  CHECK(link.actions_enabled());
  link.set_actions_enabled(false);
  CHECK(maybe_build_reset_action(link, 1000).empty());
  CHECK(maybe_build_taken_action(link, rep, 1400).empty());
  link.set_actions_enabled(true);
  CHECK_EQ(maybe_build_reset_action(link, 1000),
           std::string("{\"id\":9,\"action\":\"reset\",\"t\":1000}"));
  CHECK_EQ(maybe_build_taken_action(link, rep, 1400),
           std::string("{\"id\":9,\"action\":\"taken\",\"player_num\":5,\"age_ms\":400,\"t\":1000}"));
  link.set_actions_enabled(false);
  CHECK(maybe_build_reset_action(link, 1000).empty());  // flipping back off builds nothing again
  CHECK(maybe_build_taken_action(link, rep, 1400).empty());
}

static void test_actions_gate_with_no_assignment_builds_nothing_even_when_enabled() {
  StationLink link;
  link.set_actions_enabled(true);
  CHECK(maybe_build_reset_action(link, 1000).empty());  // no assignment: RESET has no id to name
  // A queued CLAIM report already carries its own station_id (captured at award time), so it can
  // still be built even with no CURRENT assignment (e.g. the station was since reassigned).
  PendingTakenReport rep{9, 5, 0, 1000};
  CHECK_EQ(maybe_build_taken_action(link, rep, 1400),
           std::string("{\"id\":9,\"action\":\"taken\",\"player_num\":5,\"age_ms\":400,\"t\":1000}"));
}

// A56: age_ms is computed at SEND time, and survives a millis() wrap.
static void test_taken_age_is_computed_at_send_time_and_wrap_safe() {
  StationLink link;
  link.set_actions_enabled(true);
  PendingTakenReport rep{9, 5, 0, 1000};
  CHECK(maybe_build_taken_action(link, rep, 6000).find("\"age_ms\":5000") != std::string::npos);
  PendingTakenReport late{9, 5, 0, (int64_t)0xFFFFFF00u};   // awarded 256 ms before the counter wrapped
  CHECK(maybe_build_taken_action(link, late, 100).find("\"age_ms\":356") != std::string::npos);
}

static void test_short_press_pages_through_every_page_and_wraps() {
  StationButtons b;
  CHECK(b.page() == StatsPage::KIND);
  b.on_short_press();
  CHECK(b.page() == StatsPage::LAST_ITEM);
  b.on_short_press();
  CHECK(b.page() == StatsPage::NEXT_SPAWN);
  b.on_short_press();
  CHECK(b.page() == StatsPage::LINK);
  b.on_short_press();
  CHECK(b.page() == StatsPage::BATTERY);
  b.on_short_press();
  CHECK(b.page() == StatsPage::KIND);  // wraps
}

static void test_one_long_press_arms_a_second_confirms() {
  StationButtons b;
  CHECK(b.phase() == ButtonPhase::NORMAL);
  CHECK(!b.on_long_press(1000));  // first hold: arms, does not confirm
  CHECK(b.phase() == ButtonPhase::CONFIRM_ARMED);
  CHECK(b.on_long_press(2000));  // second hold, inside the timeout: confirms
  CHECK(b.phase() == ButtonPhase::NORMAL);
}

static void test_a_second_long_press_past_the_timeout_re_arms_instead_of_confirming() {
  StationButtons b;
  CHECK(!b.on_long_press(0));
  CHECK(b.phase() == ButtonPhase::CONFIRM_ARMED);
  CHECK(!b.on_long_press(0 + RESET_CONFIRM_TIMEOUT_MS + 1));  // stale: does not confirm...
  CHECK(b.phase() == ButtonPhase::CONFIRM_ARMED);              // ...but opens a fresh prompt
  CHECK(b.on_long_press(0 + RESET_CONFIRM_TIMEOUT_MS + 1 + 10));  // now a real second press confirms
  CHECK(b.phase() == ButtonPhase::NORMAL);
}

static void test_a_short_press_while_armed_cancels_not_confirms() {
  StationButtons b;
  b.on_long_press(0);
  CHECK(b.phase() == ButtonPhase::CONFIRM_ARMED);
  b.on_short_press();
  CHECK(b.phase() == ButtonPhase::NORMAL);
  CHECK(b.page() == StatsPage::KIND);  // the cancelling short press does not also page
}

static void test_poll_timeout_cancels_an_abandoned_confirm_exactly_once() {
  StationButtons b;
  b.on_long_press(0);
  CHECK(!b.poll_timeout(RESET_CONFIRM_TIMEOUT_MS));  // exactly at the boundary: not yet
  CHECK(b.phase() == ButtonPhase::CONFIRM_ARMED);
  CHECK(b.poll_timeout(RESET_CONFIRM_TIMEOUT_MS + 1));
  CHECK(b.phase() == ButtonPhase::NORMAL);
  CHECK(!b.poll_timeout(RESET_CONFIRM_TIMEOUT_MS + 2));  // nothing left to time out
}

static void test_link_state_label_covers_every_state() {
  CHECK_EQ(std::string(link_state_label(LinkState::NOT_CONFIGURED)), std::string("NO WI-FI SET"));
  CHECK_EQ(std::string(link_state_label(LinkState::ASSIGNED)), std::string("MC-ARMED"));
  // every enumerator has a real label, not the "?" fallback
  for (auto s : {LinkState::NOT_CONFIGURED, LinkState::JOINING_WIFI, LinkState::LOOKING_FOR_MC,
                 LinkState::CONNECTING, LinkState::HELLO_SENT, LinkState::WELCOMED, LinkState::ASSIGNED}) {
    CHECK(std::string(link_state_label(s)) != "?");
  }
}

// --- A58: the A + B force restart ------------------------------------------------------------------

static void test_force_restart_fires_once_at_7_s() {
  ForceRestart f;
  CHECK(!f.update(true, true, 1000));
  CHECK(!f.update(true, true, 1000 + FORCE_RESTART_HOLD_MS - 1));
  CHECK(f.update(true, true, 1000 + FORCE_RESTART_HOLD_MS));   // fires
  CHECK(!f.update(true, true, 1000 + FORCE_RESTART_HOLD_MS + 500));  // never twice for one hold
}

static void test_force_restart_release_at_6_9_s_cancels() {
  ForceRestart f;
  f.update(true, true, 0);
  CHECK(!f.update(true, true, 6900));
  CHECK(!f.update(true, false, 6901));  // B up: cancelled
  CHECK(!f.joint_active());
  CHECK_EQ(f.countdown_s(), 0u);
  CHECK(!f.update(true, true, 7000));   // pressed again: the 7 s starts over
  CHECK(!f.update(true, true, 13999));
  CHECK(f.update(true, true, 14000));
}

static void test_force_restart_countdown_shows_only_after_2_s() {
  ForceRestart f;
  f.update(true, true, 0);
  CHECK_EQ(f.countdown_s(), 0u);
  f.update(true, true, FORCE_RESTART_SHOW_MS - 1);
  CHECK_EQ(f.countdown_s(), 0u);
  f.update(true, true, FORCE_RESTART_SHOW_MS);
  CHECK_EQ(f.countdown_s(), 5u);  // "RESTART IN 5"
  f.update(true, true, 6500);
  CHECK_EQ(f.countdown_s(), 1u);
  f.update(false, true, 6600);
  CHECK_EQ(f.countdown_s(), 0u);  // released: the countdown leaves the screen
}

static void test_force_restart_suppresses_single_button_holds() {
  ForceRestart f;
  CHECK(!f.update(true, false, 0));
  CHECK(!f.suppress_single());          // A alone: its own click/hold handlers run
  f.update(true, true, 300);
  CHECK(f.suppress_single());           // both down: A's 1 s home and B's 2 s arm are swallowed
  f.update(true, true, 2500);
  CHECK(f.suppress_single());
  f.update(true, false, 2600);
  CHECK(f.suppress_single());           // one still down
  f.update(false, false, 2700);
  CHECK(f.suppress_single());           // the release loop swallows the release-edge click too
  f.update(false, false, 2702);
  CHECK(!f.suppress_single());          // one loop later, single presses work again
  f.update(false, true, 3000);
  CHECK(!f.suppress_single());
}

static void test_serial_allow_list_while_locked_is_default_deny() {
  for (const char* ok : {"PING", "STATUS", "RAW ON", "RAW OFF", "AUTO", "AUTO OFF"}) {
    CHECK(serial_command_allowed_while_locked(ok));
  }
  for (const char* no : {"RESET", "MODE HILL", "ID 3", "GAME 2", "TXPIN 9", "WIFI a b", "MC ws://h:1/ws",
                         "LINK HELD", "LINK RECONNECT", "LINK OFF", "ACTIONS OFF", "SELFTEST", "TX 0101",
                         "TXN 3 0101", "AUTO 0101", "SOMETHING NEW"}) {
    CHECK(!serial_command_allowed_while_locked(no));
  }
}

int main() {
  test_station_action_body_is_pinned();
  test_actions_on_by_default_and_off_builds_nothing();
  test_actions_gate_with_no_assignment_builds_nothing_even_when_enabled();
  test_taken_age_is_computed_at_send_time_and_wrap_safe();
  test_short_press_pages_through_every_page_and_wraps();
  test_one_long_press_arms_a_second_confirms();
  test_a_second_long_press_past_the_timeout_re_arms_instead_of_confirming();
  test_a_short_press_while_armed_cancels_not_confirms();
  test_poll_timeout_cancels_an_abandoned_confirm_exactly_once();
  test_link_state_label_covers_every_state();
  test_force_restart_fires_once_at_7_s();
  test_force_restart_release_at_6_9_s_cancels();
  test_force_restart_countdown_shows_only_after_2_s();
  test_force_restart_suppresses_single_button_holds();
  test_serial_allow_list_while_locked_is_default_deny();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("sticks3 ui: all checks passed\n");
  return 0;
}
