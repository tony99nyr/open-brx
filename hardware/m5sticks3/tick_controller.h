// Per-tick station decisions. The callers supply current facts and apply these intents in order.
// The player rule uses the host-tested link, presence and flash mirrors. No hardware lives here.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "control_point.h"
#include "station_link.h"

namespace brx {

constexpr uint32_t BACKLIGHT_IDLE_MS = 30000;
constexpr uint32_t REPAINT_INTERVAL_MS = 250;

enum class TickIntentKind : uint8_t {
  CLEAR_PENDING_CAPTURE, SEND_CAPTURE, SEND_BEACON, SEND_AUTO,
  PAINT, BRIGHTEN, CLEAR_DIRTY, DIM,
  CLEAR_SIGHTINGS, CLEAR_PRESENCE,
  SAVE_HILL, SAVE_CLOCK, QUEUE_CAPTURE, WAKE_SCREEN, REVIVE_FLASH,
  SERIAL_PRINTF, SERIAL_PRINTLN,
};

struct TickIntent {
  TickIntentKind kind;
  int value = 0;
  std::string text;
  TickIntent(TickIntentKind kind, int value = 0, std::string text = {})
      : kind(kind), value(value), text(text) {}
  bool operator==(const TickIntent& other) const {
    return kind == other.kind && value == other.value && text == other.text;
  }
};
using TickIntents = std::vector<TickIntent>;

struct TickRadioFacts {
  uint32_t now_ms = 0;
  int capture_team = -1;
  bool ble_hill = false;
  bool bench_hill = false;
  bool assignment_present = false;
  bool auto_active = false;
  uint32_t auto_interval_ms = 400;
};

struct TickDisplayFacts {
  uint32_t now_ms = 0;
  bool dirty = false;
};

struct PlayerAdmission {
  bool due = false;
  TickIntents intents;
};

class TickController {
 public:
  static bool player_tick_allowed(bool control, bool respawn, bool revive_feedback) {
    return control || (revive_feedback && respawn);
  }

  TickIntents radio(const TickRadioFacts& f) {
    TickIntents out;
    if (f.capture_team >= 0) {
      out.push_back({TickIntentKind::CLEAR_PENDING_CAPTURE});
      if (f.ble_hill) out.push_back({TickIntentKind::SEND_CAPTURE, f.capture_team});
    }
    if (f.bench_hill && !f.assignment_present && f.now_ms - last_beacon_ms_ >= static_cast<uint32_t>(contract::GRENADE_BEACON_PERIOD_MS)) {
      last_beacon_ms_ = f.now_ms;
      out.push_back({TickIntentKind::SEND_BEACON});
    }
    if (f.auto_active && f.now_ms - last_auto_ms_ >= f.auto_interval_ms) {
      last_auto_ms_ = f.now_ms;
      out.push_back({TickIntentKind::SEND_AUTO});
    }
    return out;
  }

  TickIntents display(const TickDisplayFacts& f) {
    TickIntents out;
    if (f.dirty || f.now_ms - last_paint_ms_ >= REPAINT_INTERVAL_MS) {
      out.push_back({TickIntentKind::PAINT});
      last_paint_ms_ = f.now_ms;
      if (f.dirty) {
        last_wake_ms_ = f.now_ms;
        if (dimmed_) {
          out.push_back({TickIntentKind::BRIGHTEN});
          dimmed_ = false;
        }
      }
      out.push_back({TickIntentKind::CLEAR_DIRTY});
    }
    if (!dimmed_ && f.now_ms - last_wake_ms_ >= BACKLIGHT_IDLE_MS) {
      out.push_back({TickIntentKind::DIM});
      dimmed_ = true;
    }
    return out;
  }

  // The glue clears the ring before it drains it when clear_sightings is true.
  PlayerAdmission begin_players(const StationLink& link, PlayerPresence& presence, uint32_t now_ms) {
    if (!player_tick_allowed(link.has_control_assignment(), link.has_respawn_assignment(), REVIVE_FEEDBACK_ENABLED))
      return {};
    if (now_ms - last_players_ms_ < static_cast<uint32_t>(contract::STATION_TICK_MS)) return {};
    last_players_ms_ = now_ms;
    presence.default_threshold = link.threshold_dbm();
    presence.game = (uint8_t)link.assignment().game;
    const uint32_t epoch = link.assignment_epoch();
    if (!epoch_set_) { last_epoch_ = epoch; epoch_set_ = true; }
    if (epoch != last_epoch_) {
      last_epoch_ = epoch;
      return {true, {{TickIntentKind::CLEAR_SIGHTINGS}, {TickIntentKind::CLEAR_PRESENCE}}};
    }
    return {true, {}};
  }

  void observe_player(StationLink& link, PlayerPresence& presence, uint32_t now_ms, const Sighting& sp) {
    link.anchor_hill_on_advert(sp.advert, sp.seen_at);
    const uint32_t at = (int32_t)(sp.seen_at - now_ms) > 0 ? now_ms : sp.seen_at;
    presence.observe(sp.advert, sp.rssi, at);
  }

  TickIntents finish_players(StationLink& link, PlayerPresence& presence, SavedHill& saved_hill,
                             SavedHillClock& saved_clock, const std::string& session_id, uint32_t now_ms) {
    presence.tick(now_ms);
    const uint32_t revives_before = link.revives().revives;
    const HillUpdate update = link.tick_players(presence, now_ms);
    TickIntents out;
    const StationAssignment& a = link.assignment();
    if (link.has_control_assignment() && saved_hill.note_owner(a, session_id, link.hill()))
      out.push_back({TickIntentKind::SAVE_HILL});
    if (saved_clock.note(a, session_id, link.hill_clock_remaining_ms(now_ms), now_ms))
      out.push_back({TickIntentKind::SAVE_CLOCK});
    TickIntents events = player_events(update, revives_before, link.revives().revives);
    out.insert(out.end(), events.begin(), events.end());
    return out;
  }

  static TickIntents player_events(const HillUpdate& u, uint32_t revives_before, uint32_t revives_after) {
    TickIntents out;
    if (u.captured) {
      out.push_back({TickIntentKind::QUEUE_CAPTURE, u.captured_team});
      out.push_back({TickIntentKind::WAKE_SCREEN});
      out.push_back({TickIntentKind::SERIAL_PRINTF, 0,
                     "HILL CAPTURED team=" + std::to_string(u.captured_team) + " from=" +
                         std::to_string(u.captured_from) + "\n"});
    }
    if (u.neutralised) {
      out.push_back({TickIntentKind::WAKE_SCREEN});
      out.push_back({TickIntentKind::SERIAL_PRINTF, 0,
                     "HILL NEUTRAL (team " + std::to_string(u.neutralised_team) + " lost it to team " +
                         std::to_string(u.neutralised_by) + ")\n"});
    }
    if (u.contested_edge || u.uncontested_edge) {
      out.push_back({TickIntentKind::WAKE_SCREEN});
      out.push_back({TickIntentKind::SERIAL_PRINTLN, 0,
                     u.contested_edge ? "HILL CONTESTED" : "HILL no longer contested"});
    }
    if (u.refused) out.push_back({TickIntentKind::SERIAL_PRINTLN, 0,
                                 "# F82: a player on tid 2 is on the point; tid 2 can never hold a hill (use 0, 1, 3)"});
    if (revives_after != revives_before) {
      out.push_back({TickIntentKind::WAKE_SCREEN});
      out.push_back({TickIntentKind::REVIVE_FLASH});
      out.push_back({TickIntentKind::SERIAL_PRINTF, 0, "REVIVE count=" + std::to_string(revives_after) + "\n"});
    }
    return out;
  }

 private:
  uint32_t last_beacon_ms_ = 0;
  uint32_t last_auto_ms_ = 0;
  uint32_t last_paint_ms_ = 0;
  uint32_t last_wake_ms_ = 0;
  bool dimmed_ = false;
  uint32_t last_players_ms_ = 0;
  uint32_t last_epoch_ = 0;
  bool epoch_set_ = false;
};

}  // namespace brx
