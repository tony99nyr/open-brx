#include "check.h"
#include "button_controller.h"
#include "station_screen.h"

#include <string>

using namespace brx;

static ButtonFacts station(uint32_t now) {
  ButtonFacts f;
  f.now_ms = now;
  f.link_configured = true;
  f.assignment_present = true;
  return f;
}

static bool has(const ButtonEffects& effects, ButtonEffectKind kind, const char* text = nullptr) {
  for (const auto& e : effects) {
    if (e.kind == kind && (!text || e.text == text)) return true;
  }
  return false;
}

static int index_of(const ButtonEffects& effects, ButtonEffectKind kind) {
  for (size_t i = 0; i < effects.size(); ++i) if (effects[i].kind == kind) return (int)i;
  return -1;
}

static void check_effects(const ButtonEffects& effects,
                          std::initializer_list<std::pair<ButtonEffectKind, const char*>> expected) {
  CHECK(effects.size() == expected.size());
  size_t i = 0;
  for (const auto& item : expected) {
    if (i < effects.size()) {
      CHECK(effects[i].kind == item.first);
      CHECK(effects[i].text == item.second);
    }
    ++i;
  }
}

static ScreenKind screen(const ButtonController& c, uint32_t now, bool locked = false) {
  StickState s;
  s.now_ms = now;
  s.link_state = LinkState::ASSIGNED;
  s.assignment_present = true;
  s.assignment_id = 7;
  s.at_home = c.home().at_home();
  s.button_phase = c.buttons().phase();
  s.confirm_armed_at_ms = c.buttons().armed_at_ms();
  s.reset_outcome_active = c.reset_outcome().active;
  s.reset_outcome_ok = c.reset_outcome().ok;
  s.reset_outcome_locked = c.reset_outcome().locked;
  s.locked = locked;
  s.lock_remaining_s = locked ? 120 : 0;
  s.range_active = c.range().active();
  s.range_edit_strength = c.range().field() == RangeField::STRENGTH;
  s.force_restart_countdown_s = c.restart_countdown_s();
  return compute_screen(s).kind;
}

static void test_range_open_and_lock_refusal() {
  ButtonController c;
  auto f = station(10);
  f.a_down = true;
  c.tick(f);
  f = station(20); c.tick(f);
  CHECK(!c.home().at_home());
  f = station(30); f.a_down = true; c.tick(f);
  f = station(5030); f.a_down = true;
  auto e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTF, "RANGE opened after 5000 ms (A held on STATS)"));
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTLN, "RANGE opened (A held 5 s on STATS)"));
  {   // the two lines in the old order: the timing line first, then the RANGE line (Codex review)
    size_t timing = e.size(), range = e.size();
    for (size_t i = 0; i < e.size(); ++i) {
      if (e[i].text == "RANGE opened after 5000 ms (A held on STATS)") timing = i;
      if (e[i].text == "RANGE opened (A held 5 s on STATS)") range = i;
    }
    CHECK(timing < range && range < e.size());
  }
  CHECK(c.range().active() && screen(c, 5030) == ScreenKind::SCR_RANGE);

  ButtonController locked;
  f = station(10); f.a_down = true; locked.tick(f);
  f = station(20); locked.tick(f);
  f = station(30); f.a_down = true; f.locked = true; f.lock_remaining_s = 31; locked.tick(f);
  f = station(5030); f.a_down = true; f.locked = true; f.lock_remaining_s = 26;
  e = locked.tick(f);
  CHECK(!locked.range().active());
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTF, "RANGE refused: station locked (26 s left)"));
  CHECK(screen(locked, 5030, true) == ScreenKind::SCR_RESET_LOCKED);
  f = station(5100); f.locked = true; locked.tick(f);
  CHECK(locked.reset_outcome().locked);
}

static void test_range_edits_close_and_transient() {
  ButtonController c;
  auto f = station(10); f.a_down = true; c.tick(f);
  f = station(20); c.tick(f);
  f = station(30); f.a_down = true; c.tick(f);
  f = station(5030); f.a_down = true; c.tick(f);
  f = station(5100); c.tick(f);
  f = station(5200); f.b_clicked = true;
  auto e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::EDIT_RANGE));
  CHECK(has(e, ButtonEffectKind::SAVE_RANGE_IF_EDITED));
  CHECK(has(e, ButtonEffectKind::SERIAL_RANGE_IF_EDITED));
  CHECK(index_of(e, ButtonEffectKind::EDIT_RANGE) < index_of(e, ButtonEffectKind::SAVE_RANGE_IF_EDITED));
  CHECK(index_of(e, ButtonEffectKind::SAVE_RANGE_IF_EDITED) < index_of(e, ButtonEffectKind::SERIAL_RANGE_IF_EDITED));
  f = station(5300); f.b_hold = true; e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTLN, "RANGE closed (B hold)"));
  CHECK(!has(e, ButtonEffectKind::SEND_RESET));
  CHECK(!c.range().active());

  f = station(5400); f.a_down = true; c.tick(f);
  f = station(10400); f.a_down = true; c.tick(f);
  f = station(10500); f.locked = true; f.lock_remaining_s = 90;
  e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTF, "RANGE closed: station locked (90 s left)"));
  CHECK(!c.range().active() && c.reset_outcome().locked);
}

static void test_range_field_idle_and_assignment_loss() {
  ButtonController c;
  auto f = station(10); f.a_down = true; c.tick(f);
  f = station(20); c.tick(f);
  f = station(30); f.a_down = true; c.tick(f);
  f = station(5030); f.a_down = true; c.tick(f);
  f = station(5100); c.tick(f);
  f = station(5200); f.a_down = true; c.tick(f);
  f = station(6300); auto e = c.tick(f);
  CHECK(c.range().field() == RangeField::STRENGTH);
  CHECK(screen(c, 6300) == ScreenKind::SCR_RANGE);
  f = station(6400); f.a_down = true; c.tick(f);
  f = station(6500); e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::EDIT_RANGE));
  CHECK(c.range().active());
  f = station(16499); CHECK(!has(c.tick(f), ButtonEffectKind::SERIAL_PRINTLN, "RANGE closed (10 s idle)"));
  f = station(16500); e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTLN, "RANGE closed (10 s idle)"));
  CHECK(!c.range().active());

  f = station(17000); f.a_down = true; c.tick(f);
  f = station(22000); f.a_down = true; c.tick(f);
  CHECK(c.range().active());
  f = station(22100); f.assignment_present = false; e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTLN, "RANGE closed (no station assigned)"));
  CHECK(!c.range().active());
}

static void test_rejoin_click_window_and_gates() {
  ButtonController c;
  auto click = [&](uint32_t now) {
    auto f = station(now); f.b_clicked = true; f.dropped_for_match = true;
    return c.tick(f);
  };
  CHECK(!has(click(100), ButtonEffectKind::WIFI_REJOIN));
  CHECK(!has(click(1900), ButtonEffectKind::WIFI_REJOIN));
  CHECK(has(click(3700), ButtonEffectKind::WIFI_REJOIN));
  CHECK(!has(click(3800), ButtonEffectKind::WIFI_REJOIN));
  CHECK(!has(click(5701), ButtonEffectKind::WIFI_REJOIN));
  auto f = station(5800); f.b_clicked = true; f.dropped_for_match = true;
  f.locked = true;
  auto e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTLN, "REJOIN refused: station locked"));
  CHECK(!has(e, ButtonEffectKind::WIFI_REJOIN));
  CHECK(!has(click(5900), ButtonEffectKind::WIFI_REJOIN));
  f = station(6000); f.b_clicked = true; f.dropped_for_match = true; f.link_off = true;
  CHECK(!has(c.tick(f), ButtonEffectKind::WIFI_REJOIN));
}

static void test_reset_arm_confirm_timeout_and_send_result() {
  ButtonController c;
  auto f = station(100); f.b_hold = true;
  CHECK(!has(c.tick(f), ButtonEffectKind::SEND_RESET));
  CHECK(c.buttons().armed_at_ms() == 100 && screen(c, 100) == ScreenKind::SCR_RESET_CONFIRM);
  f = station(5100); f.b_hold = true;
  auto e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SEND_RESET));
  c.complete_reset(true, 5100);
  CHECK(screen(c, 5100) == ScreenKind::SCR_RESET_SENT);
  CHECK(has(e, ButtonEffectKind::SERIAL_RESET_RESULT));
  CHECK(index_of(e, ButtonEffectKind::SEND_RESET) < index_of(e, ButtonEffectKind::SERIAL_RESET_RESULT));
  CHECK(!has(c.expire_outcome(7599), ButtonEffectKind::REDRAW));
  CHECK(has(c.expire_outcome(7600), ButtonEffectKind::REDRAW));

  f = station(8000); f.b_hold = true; c.tick(f);
  f = station(13001); f.b_hold = true; e = c.tick(f);
  CHECK(!has(e, ButtonEffectKind::SEND_RESET));
  CHECK(c.buttons().armed_at_ms() == 13001);
  f = station(18002); e = c.tick(f);
  CHECK(c.buttons().phase() == ButtonPhase::NORMAL);
  CHECK(has(e, ButtonEffectKind::REDRAW));
  f = station(19000); f.b_hold = true; c.tick(f);
  f = station(19001); f.a_down = true; c.tick(f);
  f = station(19020); c.tick(f);
  CHECK(c.buttons().phase() == ButtonPhase::NORMAL);

  f = station(20000); f.b_hold = true; c.tick(f);
  f = station(21000); f.b_hold = true; e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SEND_RESET));
  c.complete_reset(false, 21000);
  CHECK(screen(c, 21000) == ScreenKind::SCR_RESET_NEEDS_MC);
}

static void test_reset_refusals_and_lock_arrival() {
  ButtonController c;
  auto f = station(100); f.b_hold = true; f.assignment_present = false;
  auto e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTLN, "RESET: no station assigned, nothing to reset"));
  CHECK(c.buttons().phase() == ButtonPhase::NORMAL);
  f = station(200); f.b_hold = true; f.locked = true; f.lock_remaining_s = 41;
  e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTF, "RESET refused: station locked (41 s left)"));
  CHECK(screen(c, 200, true) == ScreenKind::SCR_RESET_LOCKED);
  f = station(300); f.b_hold = true; c.tick(f);
  CHECK(c.buttons().phase() == ButtonPhase::CONFIRM_ARMED);
  f = station(301); f.locked = true;
  e = c.tick(f);
  CHECK(c.buttons().phase() == ButtonPhase::NORMAL);
  CHECK(has(e, ButtonEffectKind::REDRAW));
  CHECK(!has(e, ButtonEffectKind::SEND_RESET));
}

static void test_navigation_and_confirm_cancel() {
  ButtonController c;
  auto f = station(100); f.a_down = true; c.tick(f);
  f = station(200); c.tick(f);
  CHECK(!c.home().at_home());
  f = station(300); f.b_hold = true; c.tick(f);
  CHECK(c.buttons().phase() == ButtonPhase::CONFIRM_ARMED);
  f = station(400); f.a_down = true; c.tick(f);
  f = station(1500); c.tick(f);
  CHECK(c.home().at_home());
  CHECK(c.buttons().phase() == ButtonPhase::NORMAL);
  f = station(1600); f.a_down = true; c.tick(f);
  f = station(1700); c.tick(f);
  CHECK(!c.home().at_home());
  f = station(21700); auto e = c.tick(f);
  CHECK(c.home().at_home());
  CHECK(has(e, ButtonEffectKind::REDRAW));
}

static void test_bench_and_joint_hold() {
  ButtonController c;
  ButtonFacts f;
  f.now_ms = 10; f.a_hold = true;
  auto e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::RESET_POINTS));
  CHECK(has(e, ButtonEffectKind::SERIAL_PRINTLN, "RESET neutral (button)"));
  f = {}; f.now_ms = 20; f.b_hold = true; f.point_hill = true;
  CHECK(has(c.tick(f), ButtonEffectKind::SET_MODE_BRIDGE));
  f = {}; f.now_ms = 100; f.a_down = true; f.b_down = true;
  c.tick(f);
  f.now_ms = 2100; e = c.tick(f);
  CHECK(c.restart_countdown_s() == 5);
  f.now_ms = 7100; e = c.tick(f);
  CHECK(has(e, ButtonEffectKind::FORCE_RESTART));
  CHECK(!has(e, ButtonEffectKind::RESET_POINTS));
}

static void test_bench_click_and_mode_effect_lists() {
  ButtonController c;
  ButtonFacts f;
  f.now_ms = 10; f.a_clicked = true;
  auto e = c.tick(f);
  check_effects(e, {{ButtonEffectKind::REDRAW, ""}});
  CHECK(!c.home().at_home());
  f = {}; f.now_ms = 20; f.a_clicked = true;
  e = c.tick(f);
  check_effects(e, {{ButtonEffectKind::REDRAW, ""}});
  CHECK(c.home().at_home());

  f = {}; f.now_ms = 30; f.b_hold = true; f.point_hill = true;
  e = c.tick(f);
  check_effects(e, {{ButtonEffectKind::SERIAL_PRINTLN, "BTN B hold"},
                    {ButtonEffectKind::SET_MODE_BRIDGE, ""}});
  f = {}; f.now_ms = 40; f.b_hold = true;
  e = c.tick(f);
  check_effects(e, {{ButtonEffectKind::SERIAL_PRINTLN, "BTN B hold"},
                    {ButtonEffectKind::SET_MODE_HILL, ""}});
}

static void test_confirm_cancel_rejoin_and_suppressed_timeout() {
  ButtonController c;
  auto f = station(100); f.b_clicked = true; f.dropped_for_match = true; c.tick(f);
  f = station(500); f.b_clicked = true; f.dropped_for_match = true; c.tick(f);
  f = station(600); f.b_hold = true; f.dropped_for_match = true;
  auto e = c.tick(f);
  check_effects(e, {{ButtonEffectKind::SERIAL_PRINTLN, "BTN B hold"},
                    {ButtonEffectKind::REDRAW, ""}});
  CHECK(c.buttons().phase() == ButtonPhase::CONFIRM_ARMED);
  f = station(601); f.a_down = true; f.dropped_for_match = true; c.tick(f);
  f = station(700); f.dropped_for_match = true; e = c.tick(f);
  CHECK(c.buttons().phase() == ButtonPhase::NORMAL);
  check_effects(e, {{ButtonEffectKind::REDRAW, ""}});
  f = station(800); f.b_clicked = true; f.dropped_for_match = true;
  e = c.tick(f);
  check_effects(e, {});
  f = station(1000); f.b_clicked = true; f.dropped_for_match = true;
  e = c.tick(f);
  check_effects(e, {});
  f = station(1200); f.b_clicked = true; f.dropped_for_match = true;
  e = c.tick(f);
  check_effects(e, {{ButtonEffectKind::WIFI_REJOIN, ""}});

  ButtonController suppressed;
  f = station(100); f.b_hold = true; suppressed.tick(f);
  f = station(200); f.a_down = true; f.b_down = true; suppressed.tick(f);
  f = station(5201); f.a_down = true; f.b_down = true;
  e = suppressed.tick(f);
  CHECK(suppressed.buttons().phase() == ButtonPhase::NORMAL);
  check_effects(e, {{ButtonEffectKind::REDRAW, ""}, {ButtonEffectKind::REDRAW, ""}});
}

static void test_range_activity_and_boot_feedback_effects() {
  ButtonController c;
  auto f = station(10); f.a_down = true; c.tick(f);
  f = station(20); c.tick(f);
  f = station(30); f.a_down = true; c.tick(f);
  f = station(5030); f.a_down = true; c.tick(f);
  f = station(5100); c.tick(f);
  f = station(19000); f.b_clicked = true; auto e = c.tick(f);
  check_effects(e, {{ButtonEffectKind::EDIT_RANGE, ""},
                    {ButtonEffectKind::SAVE_RANGE_IF_EDITED, ""},
                    {ButtonEffectKind::SERIAL_RANGE_IF_EDITED, ""},
                    {ButtonEffectKind::REDRAW, ""}});
  f = station(25030); e = c.tick(f);
  check_effects(e, {{ButtonEffectKind::REDRAW, ""}});
  CHECK(!c.home().at_home());

  ButtonController boot;
  ButtonFacts boot_f; boot_f.now_ms = 1; boot_f.held_at_boot_newly_masked = true;
  e = boot.tick(boot_f);
  check_effects(e, {{ButtonEffectKind::SERIAL_PRINTLN, "# button held at boot: ignored until released"}});
}

static void test_range_cue_redraw_effect_list() {
  ButtonController c;
  auto f = station(10); f.a_down = true; c.tick(f);
  f = station(20); c.tick(f);
  f = station(30); f.a_down = true; c.tick(f);
  f = station(1060); f.a_down = true;
  auto e = c.tick(f);
  CHECK(c.range_cue_pct() == 0);
  check_effects(e, {{ButtonEffectKind::REDRAW, ""}});
}

int main() {
  test_range_open_and_lock_refusal();
  test_range_edits_close_and_transient();
  test_range_field_idle_and_assignment_loss();
  test_rejoin_click_window_and_gates();
  test_reset_arm_confirm_timeout_and_send_result();
  test_reset_refusals_and_lock_arrival();
  test_navigation_and_confirm_cancel();
  test_bench_and_joint_hold();
  test_bench_click_and_mode_effect_lists();
  test_confirm_cancel_rejoin_and_suppressed_timeout();
  test_range_activity_and_boot_feedback_effects();
  test_range_cue_redraw_effect_list();
  return report("sticks3 buttons: all checks passed");
}
