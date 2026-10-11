// The Stick's button policy. Hardware supplies edges and link facts; the caller applies effects in order.
#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "station_screen.h"

namespace brx {

struct ButtonFacts {
  uint32_t now_ms = 0;
  bool a_down = false, b_down = false;
  bool a_pressed = false, b_pressed = false;
  bool a_hold = false, b_hold = false;
  bool a_released = false, b_released = false;
  bool a_clicked = false, b_clicked = false;
  uint32_t a_hold_threshold_ms = 0, b_hold_threshold_ms = 0;
  bool held_at_boot_newly_masked = false;
  bool link_configured = false;
  bool assignment_present = false;
  bool locked = false;
  uint32_t lock_remaining_s = 0;
  bool dropped_for_match = false;
  bool link_off = false;
  bool point_hill = false;
  int battery_pct = -1;
};

enum class ButtonEffectKind : uint8_t {
  SERIAL_PRINTLN, SERIAL_PRINTF, SERIAL_RANGE_IF_EDITED, SERIAL_RESET_RESULT,
  REDRAW, RESET_POINTS, SET_MODE_BRIDGE, SET_MODE_HILL, EDIT_RANGE,
  SAVE_RANGE_IF_EDITED, WIFI_REJOIN, SEND_RESET, FORCE_RESTART,
};

struct ButtonEffect {
  ButtonEffectKind kind;
  std::string text;
  int step = 0;
  bool strength = false;
};
using ButtonEffects = std::vector<ButtonEffect>;

struct ResetOutcome {
  bool active = false;
  bool ok = false;
  bool locked = false;
  uint32_t at_ms = 0;
};

class ButtonController {
 public:
  const HomeNav& home() const { return home_; }
  const StationButtons& buttons() const { return buttons_; }
  const RangeEditor& range() const { return range_; }
  const ResetOutcome& reset_outcome() const { return outcome_; }
  uint32_t restart_countdown_s() const { return restart_.countdown_s(); }
  int range_cue_pct() const { return a_hold_.range_cue_pct(); }

  void complete_reset(bool sent, uint32_t now_ms) {
    outcome_ = {true, sent, false, now_ms};
  }

  ButtonEffects expire_outcome(uint32_t now_ms) {
    ButtonEffects out;
    if (outcome_.active && now_ms - outcome_.at_ms >= RESET_OUTCOME_SHOW_MS) {
      outcome_.active = false;
      add(out, ButtonEffectKind::REDRAW);
    }
    return out;
  }

  ButtonEffects tick(const ButtonFacts& f) {
    ButtonEffects out;
    if (f.held_at_boot_newly_masked) println(out, "# button held at boot: ignored until released");
    if (f.a_pressed) printf_line(out, "BTN A down thresh=" + std::to_string(f.a_hold_threshold_ms));
    if (f.b_pressed) printf_line(out, "BTN B down thresh=" + std::to_string(f.b_hold_threshold_ms));
    if (f.a_hold) println(out, "BTN A hold");
    if (f.b_hold) println(out, "BTN B hold");
    if (f.a_released) println(out, "BTN A up");
    if (f.b_released) println(out, "BTN B up");

    if (restart_.update(f.a_down, f.b_down, f.now_ms)) add(out, ButtonEffectKind::FORCE_RESTART);
    uint32_t countdown = restart_.countdown_s();
    if (countdown != last_restart_countdown_) {
      last_restart_countdown_ = countdown;
      add(out, ButtonEffectKind::REDRAW);
    }
    const bool range_allowed = f.link_configured && !home_.at_home() && f.assignment_present &&
                               !range_.active() && buttons_.phase() == ButtonPhase::NORMAL;
    const AHoldEvent a_event = a_hold_.update(f.a_down, f.now_ms, range_allowed, f.locked);
    if (a_event == AHoldEvent::RANGE)
      printf_line(out, "RANGE opened after " + std::to_string(a_hold_.held_ms()) + " ms (A held on STATS)");
    int cue = a_hold_.range_cue_pct();
    if (cue != last_range_cue_) {
      last_range_cue_ = cue;
      add(out, ButtonEffectKind::REDRAW);
    }
    if (restart_.suppress_single()) {
      rejoin_.cancel();
      a_hold_.cancel();
      home_.note_activity(f.now_ms);
      if (buttons_.poll_timeout(f.now_ms)) add(out, ButtonEffectKind::REDRAW);
      return out;
    }
    if (!f.link_configured) {
      if (range_.active()) range_.close();
      if (f.a_hold) {
        add(out, ButtonEffectKind::RESET_POINTS);
        println(out, "RESET neutral (button)");
        add(out, ButtonEffectKind::REDRAW);
      }
      if (f.a_clicked) {
        if (home_.at_home()) home_.leave_home(f.now_ms); else home_.go_home(f.now_ms);
        add(out, ButtonEffectKind::REDRAW);
      }
      if (f.b_hold) add(out, f.point_hill ? ButtonEffectKind::SET_MODE_BRIDGE : ButtonEffectKind::SET_MODE_HILL);
      if (home_.poll_idle(f.now_ms, f.a_down || f.b_down)) add(out, ButtonEffectKind::REDRAW);
      return out;
    }

    if (range_.active() && range_must_close(f.assignment_present, f.battery_pct)) {
      range_.close();
      println(out, "RANGE closed (no station assigned)");
      add(out, ButtonEffectKind::REDRAW);
    }
    if (range_.active() && f.locked) {
      range_.close();
      locked_outcome(f.now_ms);
      printf_line(out, "RANGE closed: station locked (" + std::to_string(f.lock_remaining_s) + " s left)");
      add(out, ButtonEffectKind::REDRAW);
    }
    if (range_.active()) {
      rejoin_.cancel();
      bool editing = false;
      if (a_event == AHoldEvent::CLICK || f.b_clicked) {
        const bool strength = range_.field() == RangeField::STRENGTH;
        add(out, ButtonEffectKind::EDIT_RANGE, "", RangeEditor::step_for(range_.field(), a_event == AHoldEvent::CLICK), strength);
        editing = true;
        range_.touch(f.now_ms);
      } else if (a_event == AHoldEvent::HOME) {
        range_.switch_field(f.now_ms);
      }
      if (f.b_hold) {
        range_.close();
        println(out, "RANGE closed (B hold)");
      }
      if (editing) {
        add(out, ButtonEffectKind::SAVE_RANGE_IF_EDITED);
        add(out, ButtonEffectKind::SERIAL_RANGE_IF_EDITED);
      }
      if (range_.poll_idle(f.now_ms, f.a_down || f.b_down)) println(out, "RANGE closed (10 s idle)");
      if (a_event != AHoldEvent::NONE || f.b_clicked || f.b_hold || editing) home_.note_activity(f.now_ms);
      if (buttons_.poll_timeout(f.now_ms)) add(out, ButtonEffectKind::REDRAW);
      if (home_.poll_idle(f.now_ms, f.a_down || f.b_down)) add(out, ButtonEffectKind::REDRAW);
      add(out, ButtonEffectKind::REDRAW);
      return out;
    }

    if (f.locked || !f.dropped_for_match || f.link_off || buttons_.phase() == ButtonPhase::CONFIRM_ARMED)
      rejoin_.cancel();
    if (f.b_clicked && f.locked && f.dropped_for_match) println(out, "REJOIN refused: station locked");
    if (f.b_clicked && !f.link_off && buttons_.phase() == ButtonPhase::NORMAL &&
        rejoin_.click(f.now_ms, f.locked) && f.dropped_for_match) add(out, ButtonEffectKind::WIFI_REJOIN);

    if (a_event == AHoldEvent::RANGE) {
      if (f.locked) {
        locked_outcome(f.now_ms);
        printf_line(out, "RANGE refused: station locked (" + std::to_string(f.lock_remaining_s) + " s left)");
      } else {
        if (buttons_.phase() == ButtonPhase::CONFIRM_ARMED) buttons_.on_short_press();
        range_.open(f.now_ms);
        println(out, "RANGE opened (A held 5 s on STATS)");
      }
      home_.note_activity(f.now_ms);
      add(out, ButtonEffectKind::REDRAW);
    } else if (a_event == AHoldEvent::CLICK) {
      ButtonPhase before = buttons_.phase();
      buttons_.on_short_press();
      if (before == ButtonPhase::CONFIRM_ARMED) home_.note_activity(f.now_ms);
      else home_.leave_home(f.now_ms);
      add(out, ButtonEffectKind::REDRAW);
    } else if (a_event == AHoldEvent::HOME) {
      if (buttons_.phase() == ButtonPhase::CONFIRM_ARMED) buttons_.on_short_press();
      home_.go_home(f.now_ms);
      add(out, ButtonEffectKind::REDRAW);
    }
    if (f.locked && buttons_.phase() == ButtonPhase::CONFIRM_ARMED) {
      buttons_.on_short_press();
      add(out, ButtonEffectKind::REDRAW);
    }
    if (f.b_hold && f.locked) {
      locked_outcome(f.now_ms);
      printf_line(out, "RESET refused: station locked (" + std::to_string(f.lock_remaining_s) + " s left)");
      home_.note_activity(f.now_ms);
      add(out, ButtonEffectKind::REDRAW);
    } else if (f.b_hold && !f.assignment_present) {
      println(out, "RESET: no station assigned, nothing to reset");
      home_.note_activity(f.now_ms);
    } else if (f.b_hold) {
      if (buttons_.on_long_press(f.now_ms)) {
        add(out, ButtonEffectKind::SEND_RESET);
        add(out, ButtonEffectKind::SERIAL_RESET_RESULT);
      }
      home_.note_activity(f.now_ms);
      add(out, ButtonEffectKind::REDRAW);
    }
    if (buttons_.poll_timeout(f.now_ms)) add(out, ButtonEffectKind::REDRAW);
    if (home_.poll_idle(f.now_ms, f.a_down || f.b_down)) add(out, ButtonEffectKind::REDRAW);
    return out;
  }

 private:
  static constexpr uint32_t RESET_OUTCOME_SHOW_MS = 2500;
  static void add(ButtonEffects& out, ButtonEffectKind kind, std::string text = "", int step = 0, bool strength = false) {
    out.push_back({kind, std::move(text), step, strength});
  }
  static void println(ButtonEffects& out, std::string text) { add(out, ButtonEffectKind::SERIAL_PRINTLN, std::move(text)); }
  static void printf_line(ButtonEffects& out, std::string text) { add(out, ButtonEffectKind::SERIAL_PRINTF, std::move(text)); }
  void locked_outcome(uint32_t now_ms) { outcome_ = {true, false, true, now_ms}; }

  HomeNav home_;
  AHoldGesture a_hold_;
  RangeEditor range_;
  StationButtons buttons_;
  ForceRestart restart_;
  RejoinGesture rejoin_;
  ResetOutcome outcome_;
  int last_range_cue_ = -1;
  uint32_t last_restart_countdown_ = 0;
};

}  // namespace brx
