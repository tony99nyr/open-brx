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
  CHECK_EQ(build_station_action_taken_body(9, 5, 1700000000000LL),
           std::string("{\"id\":9,\"action\":\"taken\",\"player_num\":5,\"t\":1700000000000}"));
}

// Polish round 1 (2026-09-24): MC does not accept `station_action` yet, so nothing may be BUILT,
// let alone sent, while ACTIONS is off (the default).
static void test_actions_disabled_by_default_builds_nothing() {
  StationLink link;
  StationAssignment a;
  a.present = true;
  a.kind = "powerup";
  a.id = 9;
  link.apply_station_config(a);
  CHECK(!link.actions_enabled());
  CHECK(maybe_build_reset_action(link, 1000).empty());
  CHECK(maybe_build_taken_action(link, 5, 1000).empty());
  link.set_actions_enabled(true);
  CHECK_EQ(maybe_build_reset_action(link, 1000),
           std::string("{\"id\":9,\"action\":\"reset\",\"t\":1000}"));
  CHECK_EQ(maybe_build_taken_action(link, 5, 1000),
           std::string("{\"id\":9,\"action\":\"taken\",\"player_num\":5,\"t\":1000}"));
  link.set_actions_enabled(false);
  CHECK(maybe_build_reset_action(link, 1000).empty());  // flipping back off builds nothing again
}

static void test_actions_gate_with_no_assignment_builds_nothing_even_when_enabled() {
  StationLink link;
  link.set_actions_enabled(true);
  CHECK(maybe_build_reset_action(link, 1000).empty());
  CHECK(maybe_build_taken_action(link, 5, 1000).empty());
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

int main() {
  test_station_action_body_is_pinned();
  test_actions_disabled_by_default_builds_nothing();
  test_actions_gate_with_no_assignment_builds_nothing_even_when_enabled();
  test_short_press_pages_through_every_page_and_wraps();
  test_one_long_press_arms_a_second_confirms();
  test_a_second_long_press_past_the_timeout_re_arms_instead_of_confirming();
  test_a_short_press_while_armed_cancels_not_confirms();
  test_poll_timeout_cancels_an_abandoned_confirm_exactly_once();
  test_link_state_label_covers_every_state();
  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("sticks3 ui: all checks passed\n");
  return 0;
}
