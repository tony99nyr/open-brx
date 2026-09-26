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

// F398: keep the countdown ring clear of the NEXT SPAWN label below it.
constexpr int PICKUP_COUNTDOWN_INDICATOR_Y = 79;

// ---------------------------------------------------------------------------------------------
// Home navigation (Tony, 2026-09-24, added after render.py): the operator must always be able to
// get back to the station's home (live gameplay) screen without a restart, without either gesture
// changing any station state -- only which screen is drawn.
constexpr uint32_t HOME_IDLE_TIMEOUT_MS = 20000;  // (a) 20 s with no button press returns home
constexpr uint32_t HOME_LONG_PRESS_MS = A_HOME_HOLD_MS;  // (b) a 1 s hold of A goes home (on release, F365)

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

// F365: the RANGE editor must close (never edit invisibly) when no station is assigned any more (a
// release_utility, a re-assignment to none) or when the low-battery screen takes over.
inline bool range_must_close(bool assignment_present, int battery_pct) {
  return !assignment_present || (battery_pct >= 0 && battery_pct <= LOW_BATTERY_PCT);
}

// The hint bar's default copy, ported verbatim from render.py's DEFAULT_HINT.
constexpr const char* DEFAULT_HINT = "A: STATS   HOLD B: RESET";
constexpr const char* RESET_CONFIRM_HINT = "A: CANCEL";  // render.py's reset_confirm scene override
// Linked (or joining) but no station assigned: there is nothing to reset, so B's hold is not offered
// (gate finding 2026-09-24: an unassigned Stick offered TO RESET STATION #-1).
constexpr const char* NO_STATION_HINT = "A: STATS";
// A58: while the match lock is on, B's hold does nothing but say LOCKED, so the hint stops offering it.
constexpr const char* LOCKED_HINT = "LOCKED  A+B 7S: RESTART";
// Bench mode (no Wi-Fi set): A pages DIAGNOSTICS, a B hold flips HILL/BRIDGE. The hint names the current
// mode, since both modes share one home screen (bench 2026-09-24: the flip was invisible otherwise).
inline std::string bench_hint(const std::string& mode_label) {
  return (mode_label.empty() ? std::string("BENCH") : mode_label) + "   A: DIAG   HOLD B: MODE";
}
constexpr const char* FORCE_RESTART_HINT = "RELEASE TO CANCEL";
// F365: the RANGE screen's hints (A click / B click / A hold) per field, and the STATS page's hold cue.
constexpr const char* RANGE_RADIUS_HINT = "A CLOSER  B FARTHER  HOLD A: STRENGTH";
constexpr const char* RANGE_STRENGTH_HINT = "A WEAKER  B STRONGER  HOLD A: RADIUS";
constexpr const char* RANGE_CUE_HINT = "HOLD FOR RANGE";

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
// item per station, so no station ever needs it). HILL_CAPTURING, HILL_CONTESTED and RESPAWN_* are
// reached only by an MC-armed Bluetooth station (presence.h): its hill measures rising, falling and
// contested, and its respawn counts revives. Bench mode (control_point.h's IR HILL/BRIDGE) still
// shows only NEUTRAL / HELD / BRIDGE_WAITING, because the IR hill has no such states to show.
enum class ScreenKind : uint8_t {
  HILL_NEUTRAL,
  SCR_NO_WIFI,  // no Wi-Fi set (bench mode): not a station yet, so it claims to be none
  RESPAWN_REDEPLOY,  // a revive just happened: the green flash, then back to RESPAWN_OWNED
  BRIDGE_WAITING,  // bench BRIDGE mode with no live grenade beacon: nothing to repeat yet
  HILL_HELD,
  HILL_CAPTURING,
  HILL_CONTESTED,
  PICKUP_READY,
  PICKUP_TAKEN,
  PICKUP_EMPTY,  // F374: armed, no station_update from MC yet (the schedule is unknown)
  PICKUP_OVER,   // F386 for a pickup: the match ended; frozen, no countdown, no ring (mirrors HILL_HELD's ended note)
  RESPAWN_OWNED,
  RESPAWN_IDLE,
  SCR_DIAGNOSTICS,
  SCR_SETTINGS,
  SCR_ASSIGNED,
  SCR_JOINING,
  SCR_LINKED_WAITING,  // welcomed by MC, no station assigned yet: "LINKED / ASSIGN ME IN MC"
  SCR_LOW_BATTERY,
  SCR_STATS,
  SCR_RESET_CONFIRM,
  SCR_RESET_SENT,
  SCR_RESET_NEEDS_MC,
  SCR_RESET_LOCKED,   // A58: a B-hold RESET refused by the match lock (the reset-outcome transient)
  SCR_FORCE_RESTART,  // A58: A+B held past FORCE_RESTART_SHOW_MS, "RESTART IN n"
  SCR_RANGE,          // F365: the on-station range editor (RADIUS and STRENGTH), from STATS by a 5 s A hold
};

// The top status strip's own flags (render.py's draw_status_strip). `station_id` -1 = not shown.
struct StatusStripSpec {
  bool ble_on = true;
  bool mc_connected = false;
  bool ir_active = false;
  int battery_pct = -1;  // -1 = absent, no glyph
  int station_id = -1;   // -1 = absent, no "#n"
  bool locked = false;   // A58: a small padlock glyph while the match lock is on
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
  // HILL_CAPTURING's word after the team: "CAPTURING" (rising), "LOSING" (its bar is draining) or
  // "STALLED" (part built, nobody pushing). Only the Bluetooth hill sets anything but the default.
  std::string hill_verb = "CAPTURING";
  // The small line under NEUTRAL / CONTESTED; "" = the renderer's IR copy ("SHOOT TO CAPTURE",
  // "BOTH TEAMS FIRING"), which is wrong for a hill that counts bodies, not shots.
  std::string hill_note;

  // PICKUP
  std::string item_name;
  std::string item_color_hex;  // "#rrggbb" from MC, "" = fall back to the item_is_special default
  bool item_is_special = false;  // true = SHIELD-style default colour (e.g. overshield), not a weapon
  std::string taken_by;        // resolved display label, e.g. "VIPER" or "P7"; "" if not shown
  std::string next_spawn;      // "M:SS"
  int pickup_frac_pct = 0;     // the taken ring's fill, 0..100

  // RESPAWN (an MC-armed Bluetooth respawn station)
  int respawn_team = -1;     // 0..3 a team's station; -1 = any team (advert team 255)
  int revives = 0;
  std::string respawn_note;  // RESPAWN_IDLE's small line; "" = the renderer's "AWAITING ASSIGNMENT"

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
  std::string assigned_role;  // e.g. "EXTRACTION #1"

  // SYSTEM: joining
  int dot_phase = 1;  // 1..3
  bool wifi_joined = true;  // false while the Wi-Fi association itself is still coming up (JOINING WI-FI)

  // SYSTEM: stats (the operator's one combined kv table -- render.py's `stats` page)
  std::string stats_kind;        // e.g. "PICKUP - ROCKETS", "HILL #3", "-"
  std::string stats_last_taken;  // display label or "-"
  std::string stats_next_spawn;  // "M:SS" | "AVAILABLE" | "-"
  std::string stats_mc_link;     // link_state_label(), upper-case already
  std::string stats_ir_words;    // "128/64"
  std::string stats_battery;     // "NN%" or "-" (render.py's stats page row)

  // SYSTEM: reset_confirm
  int reset_timeout_pct = 100;    // counts down 100 -> 0 over RESET_CONFIRM_TIMEOUT_MS
  int station_id_for_reset = -1;

  // A58: SCR_RESET_LOCKED's "UNLOCKS IN m:ss" and SCR_FORCE_RESTART's "RESTART IN n"
  std::string lock_remaining;
  uint32_t restart_in_s = 0;

  // F365: SCR_RANGE. The radius (dBm, its rough distance, where it came from) and the strength (level),
  // and which one A/B edit. On SCR_STATS, range_cue_pct >= 0 draws the "HOLD FOR RANGE" bar.
  int range_threshold_dbm = STICK_DEFAULT_THRESHOLD_DBM;
  bool range_threshold_hill = false;
  bool range_threshold_edited = false;
  int range_tx_level = TX_POWER_DEFAULT;
  bool range_tx_edited = false;
  bool range_edit_strength = false;  // false = RADIUS is the active field
  int range_cue_pct = -1;

  // Shared chrome
  std::string hint = DEFAULT_HINT;
  std::string hill_kicker = "HILL POINT";  // "BRIDGE" when the owner shown is a repeated grenade's
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
  std::string bench_mode_label;  // "HILL" | "BRIDGE" in bench mode (no Wi-Fi set); shown in the hint
  bool assignment_present = false;
  int assignment_id = -1;

  // the point (control_point.h, EITHER a standalone bench HILL/BRIDGE with no MC at all, or an
  // MC-armed "control" kind -- the .ino decides which and sets this the same way either time)
  bool control_present = false;
  bool bridge_mode = false;         // bench BRIDGE: the Stick repeats a grenade's beacon, it is not a hill itself
  bool bridge_beacon_live = false;  // BRIDGE only: a grenade beacon was heard recently (the advert is up)
  uint8_t control_owner = 255;  // TEAM_ANY
  int control_progress_pct = 0;
  std::string control_hold_time;  // "M:SS", pre-formatted by the .ino (it tracks "held since")
  // An MC-armed control station runs the Bluetooth hill (presence.h BleControlPoint) instead; these
  // carry what it measures and the IR hill cannot. control_owner/control_progress_pct above are its
  // owner and its progress then.
  bool control_ble = false;
  bool control_ended = false;
  bool control_waiting = false;
  int control_bar_team = -1;  // advert byte 9 when not 255: the owner while held, else the team building it
  bool control_contested = false;
  int control_dir = 0;        // +1 rising, -1 falling, 0 static

  // respawn (an MC-armed Bluetooth respawn station: advert state 1, revives counted here)
  bool respawn_present = false;
  int respawn_team = 255;       // the assignment's team; 255 = any team
  uint32_t respawn_revives = 0;
  bool respawn_redeploy = false;  // a revive just happened here: flash green REDEPLOY (Tony, 2026-09-24)
  bool respawn_live = false;    // the BLE advert is actually up

  // powerup (A56, station_link.h's PowerupSchedule)
  bool powerup_present = false;
  bool powerup_known = false;
  bool powerup_available = true;
  bool powerup_ended = false;  // F386 for a pickup: MATCH OVER, no more countdown, no more claims
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
  bool reset_outcome_locked = false;  // A58: the RESET was refused by the match lock (beats _ok)

  // A58: the match lock (station_link.h's MatchLock) and the A+B force restart (station_ui.h)
  bool locked = false;
  uint32_t lock_remaining_s = 0;
  uint32_t force_restart_countdown_s = 0;  // 0 = no countdown on screen

  // home navigation (HomeNav, above), polled once per paint by the .ino
  bool at_home = true;

  // F365: the RANGE editor (station_ui.h RangeEditor) and the link's applied range values
  bool range_active = false;
  bool range_edit_strength = false;
  int range_threshold_dbm = STICK_DEFAULT_THRESHOLD_DBM;
  bool range_threshold_hill = false;
  bool range_threshold_edited = false;
  int range_tx_level = TX_POWER_DEFAULT;
  bool range_tx_edited = false;
  int range_cue_pct = -1;  // the A hold's "HOLD FOR RANGE" progress on STATS, -1 = none

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
  spec.strip.locked = s.locked;
  if (s.link_state == LinkState::NOT_CONFIGURED) spec.hint = bench_hint(s.bench_mode_label);
  else if (!s.assignment_present) spec.hint = NO_STATION_HINT;
  if (s.locked) spec.hint = LOCKED_HINT;

  // A58: an operator mid-way through the A+B force restart beats everything, even a flat battery:
  // they are holding two buttons on purpose and must see the countdown to know it is working.
  if (s.force_restart_countdown_s > 0) {
    spec.kind = ScreenKind::SCR_FORCE_RESTART;
    spec.restart_in_s = s.force_restart_countdown_s;
    spec.hint = FORCE_RESTART_HINT;
    return spec;
  }

  if (s.battery_pct >= 0 && s.battery_pct <= LOW_BATTERY_PCT) {
    spec.kind = ScreenKind::SCR_LOW_BATTERY;
    return spec;
  }

  if (s.button_phase == ButtonPhase::CONFIRM_ARMED && s.assignment_present) {  // no station, nothing to confirm
    spec.kind = ScreenKind::SCR_RESET_CONFIRM;
    spec.station_id_for_reset = s.assignment_id;
    uint32_t elapsed = s.now_ms - s.confirm_armed_at_ms;  // wrap-safe: both are millis()
    uint32_t timeout = RESET_CONFIRM_TIMEOUT_MS;
    int pct = elapsed >= timeout ? 0 : (int)(100 - (elapsed * 100 / timeout));
    spec.reset_timeout_pct = pct < 0 ? 0 : (pct > 100 ? 100 : pct);
    spec.hint = RESET_CONFIRM_HINT;
    return spec;
  }
  if (s.reset_outcome_active && (!s.reset_outcome_locked || s.locked)) {
    if (s.reset_outcome_locked) {
      spec.kind = ScreenKind::SCR_RESET_LOCKED;
      spec.lock_remaining = format_mmss(s.lock_remaining_s);
      return spec;
    }
    spec.kind = s.reset_outcome_ok ? ScreenKind::SCR_RESET_SENT : ScreenKind::SCR_RESET_NEEDS_MC;
    return spec;
  }

  // F365: the RANGE editor (entered from STATS; a station must be assigned). It edits during play only while the A58 lock is unlocked, so the padlock and the lock stay as they are.
  if (s.range_active && s.assignment_present) {
    spec.kind = ScreenKind::SCR_RANGE;
    spec.range_threshold_dbm = s.range_threshold_dbm;
    spec.range_threshold_hill = s.range_threshold_hill;
    spec.range_threshold_edited = s.range_threshold_edited;
    spec.range_tx_level = s.range_tx_level;
    spec.range_tx_edited = s.range_tx_edited;
    spec.range_edit_strength = s.range_edit_strength;
    spec.hint = s.range_edit_strength ? RANGE_STRENGTH_HINT : RANGE_RADIUS_HINT;
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
    spec.stats_next_spawn = s.powerup_present ? (!s.powerup_known ? std::string("-") : s.powerup_available ? std::string("AVAILABLE")
                                                                      : format_mmss(s.powerup_remaining_s))
                                               : std::string("-");
    spec.stats_mc_link = link_state_label(s.link_state);
    spec.stats_ir_words = std::to_string(s.ir_heard) + "/" + std::to_string(s.ir_sent);
    spec.stats_battery = s.battery_pct >= 0 ? std::to_string(s.battery_pct) + "%" : std::string("-");
    if (spec.kind == ScreenKind::SCR_STATS && s.range_cue_pct >= 0) {
      spec.range_cue_pct = s.range_cue_pct > 100 ? 100 : s.range_cue_pct;
      spec.hint = RANGE_CUE_HINT;
    }
    return spec;
  }

  // at_home: the live gameplay screen. With no Wi-Fi set the Stick is armed as nothing, and its IR
  // hill and grenade bridge are post-MVP (Tony, 2026-09-24), so it says what is true: set up Wi-Fi.
  if (s.link_state == LinkState::NOT_CONFIGURED && !s.bench_mode_label.empty()) {  // the .ino sets the label in bench mode only
    spec.kind = ScreenKind::SCR_NO_WIFI;
    return spec;
  }
  if (s.control_present && s.control_ble) {
    // The Bluetooth hill. Contested beats everything (two teams' living bodies on it is the fact a
    // defender needs); then a held point shows HELD unless its bar is draining; a neutral one shows
    // the team building it, or NEUTRAL when nobody is.
    spec.hill_pct = s.control_progress_pct;
    if (s.control_waiting) {
      spec.kind = ScreenKind::HILL_NEUTRAL;
      spec.hill_pct = 0;
      spec.hill_note = "WAITING FOR START";
    } else if (s.control_ended) {
      if (s.control_owner != TEAM_ANY) {
        spec.kind = ScreenKind::HILL_HELD;
        spec.hill_team = (int)s.control_owner;
        spec.hold_time = s.control_hold_time;
      } else {
        spec.kind = ScreenKind::HILL_NEUTRAL;
      }
      spec.hill_note = "MATCH OVER";
    } else if (s.control_contested) {
      spec.kind = ScreenKind::HILL_CONTESTED;
      spec.hill_note = "TEAMS ON THE POINT";
    } else if (s.control_owner != TEAM_ANY && s.control_dir >= 0) {
      spec.kind = ScreenKind::HILL_HELD;
      spec.hill_team = (int)s.control_owner;
      spec.hold_time = s.control_hold_time;
      if (s.control_ended) spec.hill_note = "MATCH OVER";
    } else if (s.control_bar_team >= 0 && s.control_bar_team <= 3) {
      spec.kind = ScreenKind::HILL_CAPTURING;
      spec.hill_team = s.control_bar_team;
      spec.hill_verb = s.control_dir > 0 ? "CAPTURING" : (s.control_dir < 0 ? "LOSING" : "STALLED");
    } else {
      spec.kind = ScreenKind::HILL_NEUTRAL;
      spec.hill_note = "STAND HERE TO CAPTURE";
    }
    return spec;
  }
  if (s.control_present) {
    if (s.bridge_mode) {
      spec.hill_kicker = "BRIDGE";
      if (!s.bridge_beacon_live) {
        spec.kind = ScreenKind::BRIDGE_WAITING;
        return spec;
      }
    }
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
    if (s.powerup_ended) {
      // F386 for a pickup: the same freeze the hill gets, whatever the schedule was doing when the
      // whistle went (unknown, ready or taken) -- no NEXT SPAWN line, no ring, just the item and MATCH OVER.
      spec.kind = ScreenKind::PICKUP_OVER;
    } else if (!s.powerup_known) {
      spec.kind = ScreenKind::PICKUP_EMPTY;
    } else if (s.powerup_available) {
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
  if (s.respawn_present) {
    // Truthful either way: OWNED only while the advert phones read is actually up (with state 1,
    // "ready"); a station whose advert failed says so rather than looking ready.
    if (!s.respawn_live) {
      spec.kind = ScreenKind::RESPAWN_IDLE;
      spec.respawn_note = "ADVERT DOWN";
    } else {
      spec.kind = ScreenKind::RESPAWN_OWNED;
      spec.respawn_team = (s.respawn_team >= 0 && s.respawn_team <= 3) ? s.respawn_team : -1;
      if (REVIVE_FEEDBACK_ENABLED) {  // post-MVP (presence.h): no count and no REDEPLOY flash by default
        spec.revives = (int)s.respawn_revives;
        if (s.respawn_redeploy) spec.kind = ScreenKind::RESPAWN_REDEPLOY;
      }
    }
    return spec;
  }
  if (s.assignment_present) {
    spec.kind = ScreenKind::SCR_ASSIGNED;
    spec.assigned_role = s.stats_kind_label;
    return spec;
  }
  // Linked but not assigned (bench 2026-09-24: the screen said LOOKING FOR MISSION CONTROL while MC
  // already listed the Stick). Only the states before the welcome are "looking".
  if (s.link_state == LinkState::WELCOMED) {
    spec.kind = ScreenKind::SCR_LINKED_WAITING;
    return spec;
  }
  spec.kind = ScreenKind::SCR_JOINING;
  spec.dot_phase = (int)((s.now_ms / 500) % 3) + 1;
  spec.wifi_joined = s.link_state != LinkState::JOINING_WIFI;  // never claim WI-FI CONNECTED before it is
  return spec;
}

}  // namespace brx
