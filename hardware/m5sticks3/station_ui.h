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

// Polish round 1 (2026-09-24): MC does not accept `station_action` yet (it is not in `NODE_KINDS`),
// so sending one today is a malformed frame counted toward MC's per-socket quarantine. These two
// gates are the ONLY place either body gets built: with `StationLink::actions_enabled()` false
// (the default) they return an empty string, so nothing is built, let alone sent -- the caller's
// job is just "non-empty and a live socket? send it. otherwise don't."
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
