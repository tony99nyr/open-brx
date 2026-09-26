// stick_state.h - how the Stick's real state becomes a StickState (station_screen.h). Pure: no
// Arduino, no M5GFX. m5sticks3.ino's buildStickState() gathers its globals into StickInputs and
// calls build_stick_state() below; the screen simulator (sim/stick_sim.cpp) builds the same
// StickInputs from real StationLink/ControlPoint/PlayerPresence objects and calls the same function,
// so the gallery shows exactly the screen the firmware would pick.
#pragma once
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <string>

#include "brx_advert.h"
#include "brx_ir.h"
#include "control_point.h"
#include "presence.h"
#include "station_link.h"
#include "station_screen.h"
#include "station_ui.h"

namespace brx {

// Everything buildStickState() reads from the .ino's globals, read-only, for one paint.
struct StickInputs {
  uint32_t now_ms = 0;
  const StationLink* link = nullptr;  // brx_glue::link
  const ControlPoint* point = nullptr;  // the bench IR point
  bool advertising = false;             // the BLE advert is actually up (publishAdvert succeeded)
  uint32_t revive_flash_until_ms = 0;   // brx_glue::reviveFlashUntilMs

  // IR diagnostics
  uint32_t last_word_at_ms = 0;  // 0 = no word heard yet
  Word last_word;
  uint32_t word_count = 0;
  uint32_t sent_word_count = 0;
  std::string selftest_result = "-";
  int tx_pin = 0;

  // operator UI
  ButtonPhase button_phase = ButtonPhase::NORMAL;
  uint32_t confirm_armed_at_ms = 0;
  bool reset_outcome_active = false;
  bool reset_outcome_ok = false;
  bool reset_outcome_locked = false;
  uint32_t force_restart_countdown_s = 0;
  bool at_home = true;
  // F365: the RANGE editor and the A hold's cue (station_ui.h)
  bool range_active = false;
  bool range_edit_strength = false;
  int range_cue_pct = -1;
};

// Times "HELD m:ss": the owner the last paint saw, and when it took the point. The one piece of
// state build_stick_state() keeps between paints.
struct HeldClock {
  uint8_t last_owner = TEAM_ANY;
  uint32_t since_ms = 0;
};

inline std::string upper_ascii(const std::string& in) {
  std::string out = in;
  for (auto& ch : out) ch = (char)std::toupper((unsigned char)ch);
  return out;
}

inline StickState build_stick_state(const StickInputs& in, HeldClock& held) {
  const StationLink& link = *in.link;
  const ControlPoint& point = *in.point;
  const uint32_t now = in.now_ms;
  StickState st;
  st.now_ms = now;
  st.link_state = link.state();
  st.ble_on = true;
  st.mc_connected = (link.state() == LinkState::WELCOMED || link.state() == LinkState::ASSIGNED);
  st.ir_active = in.last_word_at_ms != 0 && (now - in.last_word_at_ms) < 300;
  st.battery_pct = -1;  // bench to confirm: no on-device battery reading wired up yet (README)

  const StationAssignment& a = link.assignment();
  st.assignment_present = a.present;
  st.assignment_id = a.present ? a.id : -1;

  bool standalone = (link.state() == LinkState::NOT_CONFIGURED);
  st.control_present = standalone || (a.present && a.kind == "control");
  st.bridge_mode = standalone && point.mode == Mode::BRIDGE;
  st.bridge_beacon_live = st.bridge_mode && in.advertising;  // pollAdvert withdraws it when the grenade goes quiet
  if (st.control_present) {
    // The Bluetooth hill when MC armed a control station, else the bench IR point.
    const bool ble = link.has_control_assignment();
    const uint8_t owner = ble ? (uint8_t)link.hill().owner : point.owner;
    st.control_owner = owner;
    if (ble) {
      const BleControlPoint& h = link.hill();
      const AdvertView hv = h.advert();
      st.control_ble = true;
      st.control_ended = link.hill_ended();
      st.control_waiting = link.hill_waiting(now);
      st.control_progress_pct = hv.value;
      st.control_bar_team = hv.team == TEAM_ANY ? -1 : (int)hv.team;
      st.control_contested = h.contested;
      st.control_dir = h.dir;
    } else {
      st.control_progress_pct = point.progress();
    }
    if (owner != held.last_owner) {
      held.since_ms = now;
      held.last_owner = owner;
    }
    uint32_t heldMs = (owner == TEAM_ANY) ? 0 : (now - held.since_ms);
    st.control_hold_time = format_mmss(heldMs / 1000);
  }
  if (link.has_respawn_assignment()) {
    st.respawn_present = true;
    st.respawn_team = a.team;
    if (REVIVE_FEEDBACK_ENABLED) {  // post-MVP (presence.h): no count and no REDEPLOY flash by default
      st.respawn_revives = link.revives().revives;
      st.respawn_redeploy = (int32_t)(in.revive_flash_until_ms - now) > 0;
    }
    st.respawn_live = in.advertising;
  }

  if (a.present && a.kind == "powerup") {
    st.powerup_present = true;
    st.powerup_available = link.powerup().available();
    st.powerup_known = link.powerup().known();
    st.powerup_ended = link.powerup_ended();
    st.powerup_taker = link.powerup().taker();
    PowerupAdvertView pv = link.powerup().view(now);
    st.powerup_remaining_s = pv.value;
    st.powerup_period_s = a.item.spawn_every_s > 0 ? (uint32_t)a.item.spawn_every_s : 60;
    st.item_name = upper_ascii(a.item.name);
    st.item_color_hex = a.item.color;
    st.item_is_special = a.item.kind != "weapon";
  }

  st.ir_heard = in.word_count;
  st.ir_sent = in.sent_word_count;
  if (in.last_word_at_ms) {
    char buf[32];
    std::snprintf(buf, sizeof buf, "P%d T%d M%d OK", in.last_word.player, in.last_word.team, in.last_word.mag);
    st.last_word = buf;
  }
  st.selftest_result = in.selftest_result;
  st.tx_pin = in.tx_pin;

  if (a.present) {
    st.stats_kind_label = (a.kind == "powerup")
        ? "PICKUP - " + (a.item.name.empty() ? std::string("?") : upper_ascii(a.item.name))
        : upper_ascii(a.kind) + " #" + std::to_string(a.id);
    st.stats_last_taken = (a.kind == "powerup" && link.powerup().taker())
        ? "P" + std::to_string(link.powerup().taker()) : std::string("-");
  } else if (standalone) {
    st.stats_kind_label = point.mode == Mode::HILL ? "HILL (BENCH)" : "BRIDGE (BENCH)";
    st.bench_mode_label = point.mode == Mode::HILL ? "HILL" : "BRIDGE";
    st.stats_last_taken = "-";
  } else {
    st.stats_kind_label = "-";
    st.stats_last_taken = "-";
  }

  st.button_phase = in.button_phase;
  st.confirm_armed_at_ms = in.confirm_armed_at_ms;
  st.reset_outcome_active = in.reset_outcome_active;
  st.reset_outcome_ok = in.reset_outcome_ok;
  st.reset_outcome_locked = in.reset_outcome_locked;
  st.locked = link.lock().locked(now);
  st.lock_remaining_s = link.lock().remaining_s(now);
  st.force_restart_countdown_s = in.force_restart_countdown_s;
  st.at_home = in.at_home;
  st.range_active = in.range_active;
  st.range_edit_strength = in.range_edit_strength;
  st.range_cue_pct = in.range_cue_pct;
  st.range_threshold_dbm = link.threshold_dbm();
  st.range_threshold_hill = link.assignment().present && link.assignment().kind == "control";
  st.range_threshold_edited = link.threshold_setting().from_station();
  st.range_tx_level = link.tx_power_level();
  st.range_tx_edited = link.tx_power_setting().from_station();
  return st;
}

}  // namespace brx
