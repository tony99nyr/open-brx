// station_screen.h - the Stick's screen MODEL: a pure function from the Stick's own state to a
// ScreenSpec (which screen, its words, its colours-by-role, its progress value, its hint bar text
// and its status-strip flags). No Arduino, no M5GFX: `test/test_screen.cpp` runs this on the host.
//
// THE DESIGN OF RECORD is `mockups/render.py` (Tony approved it 2026-09-24): every screen here is
// named and worded to match it exactly. `station_render.h` is the Arduino-only other half: it takes
// a ScreenSpec and draws it with M5GFX. This header only ever DECIDES; it never touches a pixel.
//
// What this header does NOT own: `station_ui.h`'s StationButtons (the page/confirm state machine)
// and `station_link.h`'s StationLink/PowerupSchedule stay exactly as they are -- this header only
// reads them (via the plain StickState snapshot below) and never gets a setter into either. Two
// things this header DOES add, because Tony asked for them after `render.py` shipped and neither one
// changes any station state: HomeNav (a tiny idle-timeout/long-press-A "go home" tracker) and the
// low-battery/reset-confirm/reset-outcome priority order below.
#pragma once
#include <cstdint>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

#include "station_ui.h"  // ButtonPhase, RESET_CONFIRM_TIMEOUT_MS, link_state_label, StationLink types

namespace brx {

// ---------------------------------------------------------------------------------------------
// Home navigation (Tony, 2026-09-24, added after render.py): the operator must always be able to
// get back to the station's home (live gameplay) screen without a restart, without either gesture
// changing any station state -- only which screen is drawn.
constexpr uint32_t HOME_IDLE_TIMEOUT_MS = 20000;  // (a) 20 s with no button press returns home
constexpr uint32_t HOME_LONG_PRESS_MS = 1000;     // (b) a 1 s hold of A goes home from anywhere

class HomeNav {
 public:
  bool at_home() const { return at_home_; }

  // A's short press moved to a stats/diagnostics page (station_ui.h's own page cycle still runs;
  // this only tracks "we left home" for the screen model). Never changes station state.
  void leave_home(uint32_t now_ms) {
    at_home_ = false;
    last_activity_ms_ = now_ms;
  }

  // A's long press ("home"), or B resolving/cancelling a RESET confirm: go home at once, whatever
  // the idle clock says.
  void go_home(uint32_t now_ms) {
    at_home_ = true;
    last_activity_ms_ = now_ms;
  }

  // Any other button activity that should reset the idle clock without leaving (or entering) home.
  void note_activity(uint32_t now_ms) { last_activity_ms_ = now_ms; }

  // Call every loop(): returns true the one call that times out an away-from-home page, so the
  // caller can repaint once. Wrap-safe (unsigned subtraction), matching this codebase's own style
  // (e.g. control_point.h's beacon-staleness check).
  bool poll_idle(uint32_t now_ms) {
    if (!at_home_ && (now_ms - last_activity_ms_) >= HOME_IDLE_TIMEOUT_MS) {
      at_home_ = true;
      return true;
    }
    return false;
  }

 private:
  bool at_home_ = true;
  uint32_t last_activity_ms_ = 0;
};

// ---------------------------------------------------------------------------------------------
// Full battery-screen threshold (render.py's `low_battery` system page): the same cutoff where the
// status strip's own battery glyph already turns BAD (draw_battery_glyph: OK > 30, WARN > 12, else
// BAD). Bench to confirm: the on-device battery reading is not wired up yet (README), so this never
// fires until it is.
constexpr int LOW_BATTERY_PCT = 12;

// The hint bar's default copy, ported verbatim from render.py's DEFAULT_HINT.
constexpr const char* DEFAULT_HINT = "A: STATS   HOLD B: RESET";
constexpr const char* RESET_CONFIRM_HINT = "A: CANCEL";  // render.py's reset_confirm scene override

// m:ss, minutes unpadded, seconds zero-padded to 2 -- render.py's own scene literals use this shape
// ("1:40") for a countdown; render.py never defines the formatter itself (its state dicts hardcode
// the string), so this is the one canonical implementation every countdown on the Stick goes through.
inline std::string format_mmss(uint32_t total_seconds) {
  uint32_t m = total_seconds / 60;
  uint32_t sec = total_seconds % 60;
  char buf[16];
  std::snprintf(buf, sizeof buf, "%u:%02u", (unsigned)m, (unsigned)sec);
  return std::string(buf);
}

// ---------------------------------------------------------------------------------------------
// The screen catalogue -- exactly render.py's SCENES groups, minus the charges screen (Tony: one
// item per station, so no station ever needs it). RESPAWN_*, HILL_CAPTURING and HILL_CONTESTED are
// kept (and station_render.h draws them) for design-of-record fidelity, but `compute_screen` below
// never emits them today: this firmware tracks no revive count for a respawn station, and
// control_point.h's HILL has no discrete "capturing" transition or contested detection (see the
// README's "could not match" note).
enum class ScreenKind : uint8_t {
  HILL_NEUTRAL,
  HILL_HELD,
  HILL_CAPTURING,
  HILL_CONTESTED,
  PICKUP_READY,
  PICKUP_TAKEN,
  PICKUP_EMPTY,
  RESPAWN_OWNED,
  RESPAWN_IDLE,
  SCR_DIAGNOSTICS,
  SCR_SETTINGS,
  SCR_ASSIGNED,
  SCR_JOINING,
  SCR_LOW_BATTERY,
  SCR_STATS,
  SCR_RESET_CONFIRM,
  SCR_RESET_SENT,
  SCR_RESET_NEEDS_MC,
};

// The top status strip's own flags (render.py's draw_status_strip). `station_id` -1 = not shown.
struct StatusStripSpec {
  bool ble_on = true;
  bool mc_connected = false;
  bool ir_active = false;
  int battery_pct = -1;  // -1 = absent, no glyph
  int station_id = -1;   // -1 = absent, no "#n"
};

// What to draw. One flat struct, not a tagged union: only the fields for `kind` are meaningful, the
// rest sit at their default -- station_render.h's switch on `kind` mirrors render.py's per-group
// draw_* functions field for field.
struct ScreenSpec {
  ScreenKind kind = ScreenKind::SCR_JOINING;

  // HILL
  int hill_team = -1;         // -1 neutral/none; 0..3 a team, for HILD_HELD/CAPTURING/CONTESTED
  std::string hold_time;      // "M:SS", HILL_HELD only
  int hill_pct = 0;           // HILL_HELD's share of charge, or HILL_CAPTURING's progress, 0..100

  // PICKUP
  std::string item_name;
  std::string item_color_hex;  // "#rrggbb" from MC, "" = fall back to the item_is_special default
  bool item_is_special = false;  // true = SHIELD-style default colour (e.g. overshield), not a weapon
  std::string taken_by;        // resolved display label, e.g. "VIPER" or "P7"; "" if not shown
  std::string next_spawn;      // "M:SS"
  int pickup_frac_pct = 0;     // the taken ring's fill, 0..100

  // RESPAWN (unreached today; kept for design completeness, see class comment)
  int respawn_team = -1;
  int revives = 0;

  // SYSTEM: diagnostics (standalone bench, local-only; no MC needed)
  uint32_t ir_heard = 0;
  uint32_t ir_sent = 0;
  std::string last_word;    // "-" if none yet
  std::string selftest;     // "-" | "PASS" | "FAIL"
  int tx_pin = 0;

  // SYSTEM: settings (not wired to any button flow yet; kept for design completeness)
  std::vector<std::string> settings_rows;
  int settings_highlighted = 0;

  // SYSTEM: assigned (a kind this firmware arms but runs no player-side rule for yet, §5g.5:
  // "shown and reported, not faked")
  std::string assigned_role;  // e.g. "RESPAWN #1"

  // SYSTEM: joining
  int dot_phase = 1;  // 1..3

  // SYSTEM: stats (the operator's one combined kv table -- render.py's `stats` page)
  std::string stats_kind;        // e.g. "PICKUP - ROCKETS", "HILL #3", "-"
  std::string stats_last_taken;  // display label or "-"
  std::string stats_next_spawn;  // "M:SS" | "AVAILABLE" | "-"
  std::string stats_mc_link;     // link_state_label(), upper-case already
  std::string stats_ir_words;    // "128/64"

  // SYSTEM: reset_confirm
  int reset_timeout_pct = 100;    // counts down 100 -> 0 over RESET_CONFIRM_TIMEOUT_MS
  int station_id_for_reset = -1;

  // Shared chrome
  std::string hint = DEFAULT_HINT;
  StatusStripSpec strip;
};

// A player_num (1..63) -> display name lookup the .ino can wire to whatever roster MC last sent (or
// nothing at all, today). Returning "" means "not known"; compute_screen then falls back to "P<n>".
using PlayerNameLookup = std::function<std::string(int)>;
inline std::string no_player_names(int) { return std::string(); }

inline std::string resolve_player_label(uint8_t player_num, const PlayerNameLookup& name_of) {
  if (player_num == 0) return std::string();
  std::string name = name_of ? name_of((int)player_num) : std::string();
  if (!name.empty()) return name;
  return "P" + std::to_string((int)player_num);
}

// A plain snapshot of everything the model needs, gathered by m5sticks3.ino once per paint. No
// method on this struct ever changes anything: it is read, once, by compute_screen below.
struct StickState {
  uint32_t now_ms = 0;

  // link / assignment (station_link.h)
  LinkState link_state = LinkState::NOT_CONFIGURED;
  bool assignment_present = false;
  int assignment_id = -1;

  // the point (control_point.h, EITHER a standalone bench HILL/BRIDGE with no MC at all, or an
  // MC-armed "control" kind -- the .ino decides which and sets this the same way either time)
  bool control_present = false;
  uint8_t control_owner = 255;  // TEAM_ANY
  int control_progress_pct = 0;
  std::string control_hold_time;  // "M:SS", pre-formatted by the .ino (it tracks "held since")

  // powerup (A56, station_link.h's PowerupSchedule)
  bool powerup_present = false;
  bool powerup_available = true;
  uint8_t powerup_taker = 0;
  uint32_t powerup_remaining_s = 0;
  uint32_t powerup_period_s = 60;
  std::string item_name;
  std::string item_color_hex;
  bool item_is_special = false;

  // diagnostics (local-only; standalone bench or MC-linked, it needs no MC)
  uint32_t ir_heard = 0;
  uint32_t ir_sent = 0;
  std::string last_word;
  std::string selftest_result;  // "-" | "PASS" | "FAIL"
  int tx_pin = 0;

  // pre-formatted stats labels (the .ino already has the strings to build these; no need for this
  // header to duplicate that string-building)
  std::string stats_kind_label;   // e.g. "PICKUP - ROCKETS", "HILL #3", "RESPAWN #1", "-"
  std::string stats_last_taken;   // display label or "-"

  // operator UI (station_ui.h's StationButtons, read-only)
  ButtonPhase button_phase = ButtonPhase::NORMAL;
  uint32_t confirm_armed_at_ms = 0;

  // a RESET just resolved (the .ino tracks this transiently; station_ui.h has no outcome of its
  // own to read, since MC's answer -- or its absence -- is not part of that state machine)
  bool reset_outcome_active = false;
  bool reset_outcome_ok = false;  // true = sent to MC; false = RESET NEEDS MISSION CONTROL

  // home navigation (HomeNav, above), polled once per paint by the .ino
  bool at_home = true;

  // status strip
  bool ble_on = true;
  bool mc_connected = false;
  bool ir_active = false;
  int battery_pct = -1;
};

// The one function this header exists for. Priority, highest first (Tony, 2026-09-24): a critical
// battery beats everything, including an open RESET confirm -- render.py's low_battery page is a
// full-screen warning, and a station that is about to lose power needs that warning seen over
// anything else on screen. A RESET confirm/outcome beats home-vs-stats, since it is itself the
// operator's current focus. Home-vs-away decides everything else.
inline ScreenSpec compute_screen(const StickState& s, const PlayerNameLookup& name_of = no_player_names) {
  ScreenSpec spec;
  spec.strip.ble_on = s.ble_on;
  spec.strip.mc_connected = s.mc_connected;
  spec.strip.ir_active = s.ir_active;
  spec.strip.battery_pct = s.battery_pct;
  spec.strip.station_id = s.assignment_present ? s.assignment_id : -1;

  if (s.battery_pct >= 0 && s.battery_pct <= LOW_BATTERY_PCT) {
    spec.kind = ScreenKind::SCR_LOW_BATTERY;
    return spec;
  }

  if (s.button_phase == ButtonPhase::CONFIRM_ARMED) {
    spec.kind = ScreenKind::SCR_RESET_CONFIRM;
    spec.station_id_for_reset = s.assignment_id;
    uint32_t elapsed = s.now_ms - s.confirm_armed_at_ms;  // wrap-safe: both are millis()
    uint32_t timeout = RESET_CONFIRM_TIMEOUT_MS;
    int pct = elapsed >= timeout ? 0 : (int)(100 - (elapsed * 100 / timeout));
    spec.reset_timeout_pct = pct < 0 ? 0 : (pct > 100 ? 100 : pct);
    spec.hint = RESET_CONFIRM_HINT;
    return spec;
  }
  if (s.reset_outcome_active) {
    spec.kind = s.reset_outcome_ok ? ScreenKind::SCR_RESET_SENT : ScreenKind::SCR_RESET_NEEDS_MC;
    return spec;
  }

  if (!s.at_home) {
    spec.kind = (s.link_state == LinkState::NOT_CONFIGURED) ? ScreenKind::SCR_DIAGNOSTICS : ScreenKind::SCR_STATS;
    spec.ir_heard = s.ir_heard;
    spec.ir_sent = s.ir_sent;
    spec.last_word = s.last_word;
    spec.selftest = s.selftest_result;
    spec.tx_pin = s.tx_pin;
    spec.stats_kind = s.stats_kind_label;
    spec.stats_last_taken = s.stats_last_taken;
    spec.stats_next_spawn = s.powerup_present ? (s.powerup_available ? std::string("AVAILABLE")
                                                                      : format_mmss(s.powerup_remaining_s))
                                               : std::string("-");
    spec.stats_mc_link = link_state_label(s.link_state);
    spec.stats_ir_words = std::to_string(s.ir_heard) + "/" + std::to_string(s.ir_sent);
    return spec;
  }

  // at_home: the live gameplay screen.
  if (s.control_present) {
    if (s.control_owner == TEAM_ANY) {
      spec.kind = ScreenKind::HILL_NEUTRAL;
    } else {
      spec.kind = ScreenKind::HILL_HELD;
      spec.hill_team = (int)s.control_owner;
      spec.hold_time = s.control_hold_time;
      spec.hill_pct = s.control_progress_pct;
    }
    return spec;
  }
  if (s.powerup_present) {
    spec.item_name = s.item_name;
    spec.item_color_hex = s.item_color_hex;
    spec.item_is_special = s.item_is_special;
    if (s.powerup_available) {
      spec.kind = ScreenKind::PICKUP_READY;
    } else {
      spec.kind = ScreenKind::PICKUP_TAKEN;
      spec.taken_by = resolve_player_label(s.powerup_taker, name_of);
      spec.next_spawn = format_mmss(s.powerup_remaining_s);
      uint32_t period = s.powerup_period_s ? s.powerup_period_s : 60;
      uint32_t elapsed_s = s.powerup_remaining_s >= period ? 0 : (period - s.powerup_remaining_s);
      spec.pickup_frac_pct = (int)((elapsed_s * 100) / period);
    }
    return spec;
  }
  if (s.assignment_present) {
    spec.kind = ScreenKind::SCR_ASSIGNED;
    spec.assigned_role = s.stats_kind_label;
    return spec;
  }
  spec.kind = ScreenKind::SCR_JOINING;
  spec.dot_phase = (int)((s.now_ms / 500) % 3) + 1;
  return spec;
}

}  // namespace brx
