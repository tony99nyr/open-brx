// station_ui.h - the Stick's on-device OPERATOR controls (Tony via brx1, 2026-09-24): players never
// press anything on a station. A short press pages through LOCAL stats (nothing here is sent
// anywhere); a long press (>= LONG_PRESS_MS, the existing knock-safety rule: only a hold changes
// state) opens a RESET confirm, and a SECOND long press within the timeout confirms it. Confirming
// sends `station_action` and applies NOTHING locally -- the station only changes once MC answers
// (for a powerup, a `station_update`; other kinds have no answer defined yet and simply see no
// effect, which is the honest state until they do).
//
// Pure C++17, header-only, no Arduino: `test/test_ui.cpp` runs this on the host.
#pragma once
#include <cstdint>
#include <string>

#include "json_lite.h"
#include "station_link.h"

namespace brx {

constexpr uint32_t LONG_PRESS_MS = 2000;              // the knock-safety rule: 2 s, never a tap
constexpr uint32_t RESET_CONFIRM_TIMEOUT_MS = 5000;   // an open confirm prompt cancels itself

// `station_action` (proposed to brx5, NOT a final contract -- kept in these two small functions so
// a rename is a one-line change). MC has no reply kind for it yet; for a powerup, the Stick reads
// the effect off the `station_update` that follows, same as it would from anywhere else.
// Best-effort, like every other MC->node message this firmware never queues.
inline std::string build_station_action_body(int station_id, const std::string& action, int64_t t_ms) {
  std::string j = "{";
  j += "\"id\":" + std::to_string(station_id) + ",";
  j += "\"action\":" + json::quote(action) + ",";
  j += "\"t\":" + std::to_string(t_ms);
  j += "}";
  return j;
}

// A CLAIM's report is its own shape, not the generic {id, action, t} above: it needs `player_num`
// too. Kept obviously separate so either shape can be renamed independently once brx5 settles it.
// A56 (brx5, 2026-09-24): `age_ms` is how long ago the award happened, computed when the report is SENT. It is
// clock-free (the Stick has no synced clock, so `t` means nothing to MC); MC dates the take t_recv - age_ms and ignores
// a report older than the current spawn, so a report queued while the link was down never takes a later spawn.
inline std::string build_station_action_taken_body(int station_id, int player_num, int64_t t_ms, uint32_t age_ms) {
  std::string j = "{";
  j += "\"id\":" + std::to_string(station_id) + ",";
  j += "\"action\":\"taken\",";
  j += "\"player_num\":" + std::to_string(player_num) + ",";
  j += "\"age_ms\":" + std::to_string(age_ms) + ",";
  j += "\"t\":" + std::to_string(t_ms);
  j += "}";
  return j;
}

// MC accepts `station_action` since A56 (f3fe3cf6); `ACTIONS OFF` is for an older MC, which would count
// each one as a malformed frame toward its per-socket quarantine. These two gates are the ONLY place
// either body gets built: with `StationLink::actions_enabled()` false they return an empty string, so
// nothing is built, let alone sent -- the caller's job is just "non-empty and a live socket? send it.
// otherwise don't."
inline std::string maybe_build_reset_action(const StationLink& link, int64_t t_ms) {
  if (!link.actions_enabled() || !link.assignment().present) return std::string();
  return build_station_action_body(link.assignment().id, "reset", t_ms);
}

// Polish round 2: takes the whole queued report, not a bare player_num -- `station_id` is the one
// captured at the moment of the award (PendingTakenReport, station_link.h), never the station's
// CURRENT assignment, which may have moved on by the time this is flushed.
inline std::string maybe_build_taken_action(const StationLink& link, const PendingTakenReport& rep, uint32_t now_ms) {
  if (!link.actions_enabled()) return std::string();
  // unsigned subtraction: correct across a millis() wrap, as long as the report is under ~49 days old
  uint32_t age = now_ms - (uint32_t)rep.t_ms;
  return build_station_action_taken_body(rep.station_id, rep.player_num, rep.t_ms, age);
}

// The stats pages a short press cycles through ("view stats, local only"): station kind, who took
// the item last, time to the next spawn, MC link, battery. `LAST_ITEM`/`NEXT_SPAWN` only mean
// anything on a powerup station -- the .ino shows a dash on any other kind, not a crash or a stale
// number.
enum class StatsPage : uint8_t {
  KIND = 0,
  LAST_ITEM = 1,
  NEXT_SPAWN = 2,
  LINK = 3,
  BATTERY = 4,
  PAGE_COUNT = 5,
};

enum class ButtonPhase : uint8_t {
  NORMAL = 0,         // showing a stats page
  CONFIRM_ARMED = 1,  // one long press opened the confirm prompt; waiting on a SECOND
};

// A pure button state machine. It knows nothing about Wi-Fi, MC, or the advert -- the .ino reads
// `on_long_press()`'s return to decide whether to actually send `station_action`, and separately
// decides what "RESET NEEDS MISSION CONTROL" means (no link at all).
class StationButtons {
 public:
  ButtonPhase phase() const { return phase_; }
  StatsPage page() const { return page_; }

  // A clean press-and-release under LONG_PRESS_MS. Pages in NORMAL; cancels the confirm in
  // CONFIRM_ARMED (a short press is never a confirmation -- only a second LONG press is, so this is
  // the escape hatch for "I didn't mean to hold that").
  void on_short_press() {
    if (phase_ == ButtonPhase::CONFIRM_ARMED) {
      phase_ = ButtonPhase::NORMAL;
      return;
    }
    page_ = (StatsPage)(((uint8_t)page_ + 1) % (uint8_t)StatsPage::PAGE_COUNT);
  }

  // A press held past LONG_PRESS_MS (the .ino calls this once per hold gesture, from its button
  // library's own "wasHold" edge, never continuously while held). Returns true exactly on the
  // CONFIRMING press -- the caller sends `station_action` on a true return, never on the first.
  bool on_long_press(uint32_t now_ms) {
    if (phase_ == ButtonPhase::NORMAL) {
      phase_ = ButtonPhase::CONFIRM_ARMED;
      armed_at_ms_ = now_ms;
      return false;
    }
    if (now_ms - armed_at_ms_ <= RESET_CONFIRM_TIMEOUT_MS) {
      phase_ = ButtonPhase::NORMAL;
      return true;
    }
    // Past the timeout this is not a confirmation of a stale prompt -- it opens a fresh one.
    armed_at_ms_ = now_ms;
    return false;
  }

  // Call every loop(): a confirm prompt left open must not sit there forever after the operator
  // walks away. Returns true the one call that times it out, so the caller can repaint once.
  bool poll_timeout(uint32_t now_ms) {
    if (phase_ == ButtonPhase::CONFIRM_ARMED && now_ms - armed_at_ms_ > RESET_CONFIRM_TIMEOUT_MS) {
      phase_ = ButtonPhase::NORMAL;
      return true;
    }
    return false;
  }

 private:
  ButtonPhase phase_ = ButtonPhase::NORMAL;
  StatsPage page_ = StatsPage::KIND;
  uint32_t armed_at_ms_ = 0;
};

// ---- A58: the force restart (A + B held together) -------------------------------------------------
// Holding A AND B together for FORCE_RESTART_HOLD_MS restarts the Stick (ESP.restart() in the .ino),
// whether the match lock is on or not: the lock is RAM-only, so a restart is also the operator's way
// out of a lock set by mistake. After FORCE_RESTART_SHOW_MS of the joint hold the screen shows a
// countdown ("RESTART IN 5"), so nobody restarts a station by accident; releasing EITHER button
// cancels, and the next joint press starts the full 7 s again.
//
// The joint hold must not ALSO fire A's 1 s home or B's 2 s reset arm, so `suppress_single()` is
// true from the moment both are down until one full loop() AFTER both are up again: the button
// library reports a click or a hold on the release edge, and the loop in which the last button comes
// up must still swallow it. (A single-button hold that reached its own threshold BEFORE the second
// button went down has already fired by then; both of those are harmless -- home changes no state,
// and a reset arm still needs a second, separate hold to confirm.)
//
// The .ino calls `update()` once per loop() with the button library's own `isPressed()` levels, never its
// edge events, so this struct owns the whole gesture and is host-tested on its own.
constexpr uint32_t FORCE_RESTART_HOLD_MS = 7000;
constexpr uint32_t FORCE_RESTART_SHOW_MS = 2000;

class ForceRestart {
 public:
  // Returns true exactly once per joint hold: the call on which it reaches FORCE_RESTART_HOLD_MS.
  bool update(bool a_down, bool b_down, uint32_t now_ms) {
    bool both = a_down && b_down;
    bool any = a_down || b_down;
    bool fire = false;
    if (both) {
      if (!joint_) {
        joint_ = true;
        fired_ = false;
        start_ms_ = now_ms;
      }
      suppress_ = true;
      if (!fired_ && now_ms - start_ms_ >= FORCE_RESTART_HOLD_MS) {
        fired_ = true;
        fire = true;
      }
    } else {
      joint_ = false;  // either button up cancels the countdown
      // Lift the suppression only on the SECOND consecutive all-up call (see the class comment).
      if (!any && !prev_any_) suppress_ = false;
    }
    prev_any_ = any;
    now_ms_ = now_ms;
    return fire;
  }

  bool joint_active() const { return joint_; }
  bool suppress_single() const { return suppress_; }

  // 0 = no countdown on screen; otherwise the whole seconds left, rounded up ("RESTART IN 5" at 2 s).
  uint32_t countdown_s() const {
    if (!joint_ || fired_) return 0;
    uint32_t held = now_ms_ - start_ms_;
    if (held < FORCE_RESTART_SHOW_MS) return 0;
    if (held >= FORCE_RESTART_HOLD_MS) return 0;
    return (FORCE_RESTART_HOLD_MS - held + 999u) / 1000u;
  }

 private:
  bool joint_ = false;
  bool fired_ = false;
  bool suppress_ = false;
  bool prev_any_ = false;
  uint32_t start_ms_ = 0;
  uint32_t now_ms_ = 0;
};

// ---- a button already down at boot is ignored until it has been released once ---------------------
// Bench 2026-09-24: after the A+B force restart the operator was still holding both buttons when the
// new boot came up, and the button library read that as a fresh press, so the new boot logged
// "BTN A hold" (and, held on, would have gone home, armed a RESET, or started a second force-restart
// countdown). The first `update()` call records which buttons are down; each one stays masked until it
// has been up for one full loop() -- the same "swallow the release edge too" rule as ForceRestart,
// since the library reports a click on the loop in which the button comes up.
//
// The .ino feeds the raw `isPressed()` levels once per loop(), before anything else reads a button,
// and treats a masked button as not pressed and without edges (ForceRestart gets `a_down()`/`b_down()`).
class BootHeldButtons {
 public:
  void update(bool a_down, bool b_down) {
    if (!started_) {
      started_ = true;
      a_.masked = a_down;
      b_.masked = b_down;
    }
    step(a_, a_down);
    step(b_, b_down);
  }
  bool a_masked() const { return a_.masked; }
  bool b_masked() const { return b_.masked; }
  // The level the rest of the loop should see: a masked button reads as up.
  bool a_down() const { return a_.down && !a_.masked; }
  bool b_down() const { return b_.down && !b_.masked; }

 private:
  struct One {
    bool masked = false;
    bool down = false;
    bool prev_down = false;
  };
  static void step(One& o, bool down) {
    // Unmask on the SECOND consecutive up call: the loop in which it comes up still swallows its edge.
    if (o.masked && !down && !o.prev_down) o.masked = false;
    o.prev_down = down;
    o.down = down;
  }
  bool started_ = false;
  One a_, b_;
};

// ---- A58: which serial commands still run while the match lock is on ------------------------------
// Default DENY: anything not named here answers "ERR locked" while locked, so a command added later
// is locked until someone decides otherwise. Allowed: the read-only ones (PING, STATUS), the RAW dump
// toggle (it changes only what this Stick prints), and AUTO OFF (it only STOPS a transmit). Refused:
// everything that changes station state or puts IR on the field -- RESET, MODE, ID, GAME, TXPIN, the
// H8 link commands (WIFI, MC, LINK ..., ACTIONS), SELFTEST (it transmits), TX, TXN and AUTO <bits>.
// The single-key r/s/c commands are handled before any line is parsed and are left as they are:
// they toggle the RAW dump, print the frame count, and zero that counter, none of which is play.
inline bool serial_command_allowed_while_locked(const std::string& line) {
  return line == "PING" || line == "STATUS" || line == "RAW ON" || line == "RAW OFF" || line == "AUTO" ||
         line == "AUTO OFF";
}

// A short, arm's-length label for the LINK stats page and the screen's status line.
inline const char* link_state_label(LinkState s) {
  switch (s) {
    case LinkState::NOT_CONFIGURED: return "NO WI-FI SET";
    case LinkState::JOINING_WIFI: return "JOINING WI-FI";
    case LinkState::LOOKING_FOR_MC: return "LOOKING FOR MC";
    case LinkState::CONNECTING: return "CONNECTING";
    case LinkState::HELLO_SENT: return "LINKING";
    case LinkState::WELCOMED: return "LINKED, NOT ARMED";
    case LinkState::ASSIGNED: return "MC-ARMED";
  }
  return "?";
}

}  // namespace brx
