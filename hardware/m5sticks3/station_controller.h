// station_controller.h - what each Mission Control message does to the Stick's SAVED state, and in what
// order (ARCH-4, review 2026-10-10). A welcome, a station_config, a station_update and a release each
// write or erase some of: the saved config, the hill owner, the hill clock and the match-lock snapshot.
// Those choices, and their order, used to live in mc_link_glue.h's mcHandleFrame, the one file the host
// never builds, so a wrong order (a stale lock surviving a new session, a released Stick coming back
// armed) showed up only on a bench. They live here now, and test/test_controller.cpp drives message
// SEQUENCES through them against a fake Preferences.
//
// Pure C++17, header-only, no Arduino. The controller owns the three flash mirrors and the lock-snapshot
// bookkeeping; it never touches flash, the radio or the screen itself. Every such action is one call on
// StationEffects, which the glue implements with real Preferences, the claim scan and the socket, and the
// host test implements with a fake that records each call in order.
#pragma once
#include <cstdint>
#include <string>

#include "json_lite.h"
#include "station_link.h"
#include "station_persistence.h"

namespace brx {

// Everything the controller asks the outside world to do. Each saved-state call maps to one of the
// glue's existing mc* functions, which keep their own serial lines; `log` carries the controller's own.
class StationEffects {
 public:
  // ---- flash ("brxmc") ----
  virtual void write_config(const std::string& body, const std::string& session_id) = 0;  // station_cfg + station_sid
  virtual void erase_config() = 0;
  virtual void erase_hill() = 0;
  virtual void erase_clock() = 0;
  virtual bool write_lock(uint32_t seconds, uint8_t game) = 0;  // lock_s + lock_game; false = not written
  virtual bool clear_lock() = 0;                                 // remove lock_s + lock_game; false = not cleared
  virtual void save_node_key(const std::string& key) = 0;
  virtual void save_range_if_changed() = 0;  // A67: the glue compares StationLink::range_storage_body itself
  // ---- radio, link and screen ----
  virtual bool pause_claim_feed(bool discard) = 0;  // returns whether the scan was feeding claims
  virtual void resume_claim_feed(bool was_feeding) = 0;
  virtual void muster_drop() = 0;
  virtual void dial_succeeded() = 0;  // TypedMcFallback: a typed address answered
  virtual void wake_screen() = 0;
  // One serial line, terminator included: "\n" where the glue used Serial.printf, "\r\n" where it used
  // Serial.println, so the bench console reads exactly what it read before the move.
  virtual void log(const std::string& text) = 0;

 protected:
  ~StationEffects() = default;
};

// F391's lock snapshot bookkeeping: what is on flash, and whether a write or a clear is still owed.
struct LockSnapshotBook {
  bool clear_pending = false;  // a clear failed (NVS would not open or remove); mcLoop retries it
  bool save_pending = false;   // a write failed; the next due check writes regardless of the interval
  uint32_t last_saved_ms = 0;
  uint32_t last_saved_seconds = 0;
  uint8_t last_saved_game = 255;
};

class StationController {
 public:
  SavedStationConfig config;  // "station_cfg" / "station_sid"
  SavedHill hill;             // "hill_v1" and the legacy hill keys
  SavedHillClock clock;       // "hclk_*"
  LockSnapshotBook lock;      // "lock_s" / "lock_game"

  // One MC frame's kind and body. `now_ms` is millis() at receipt (the lock counts from it).
  void on_message(StationLink& link, const std::string& kind, const json::Value& body, uint32_t now_ms,
                  StationEffects& fx) {
    if (kind == "welcome") on_welcome(link, parse_welcome(body), fx);
    else if (kind == "station_config") on_station_config(link, parse_station_config(body), now_ms, fx);
    else if (kind == "station_update") on_station_update(link, parse_station_update(body), now_ms, fx);
    else if (kind == "control" && parse_control_cmd(body) == "release_utility") on_release(link, fx);
  }

  void on_welcome(StationLink& link, const WelcomeMsg& w, StationEffects& fx) {
    link.apply_welcome(w);
    if (w.ok) fx.dial_succeeded();
    fx.wake_screen();
    if (!w.node_key.empty()) fx.save_node_key(w.node_key);
    fx.log("WELCOME session=" + w.session_id + "\n");
    // Review round 1 (HIGH): a saved config from another MC session is an old match's; erase it, and
    // drop the assignment too while it is still the restored one (apply_welcome_to_saved decides).
    const bool was_restored = link.restored();
    if (w.ok && was_restored && config.stale_for(w.session_id)) fx.pause_claim_feed(true);
    if (w.ok && apply_welcome_to_saved(link, config, w.session_id)) {
      fx.erase_config();
      clear_lock(fx);
      if (was_restored && !link.restored()) fx.log("STALE restored config (new MC session): UNASSIGNED\r\n");
    }
    if (w.ok && hill.note_welcome(w.session_id)) fx.erase_hill();  // another session's hold
    if (w.ok && clock.note_welcome(w.session_id)) fx.erase_clock();
  }

  void on_station_config(StationLink& link, const StationAssignment& a, uint32_t rx, StationEffects& fx) {
    if (!a.present && a.refused) fx.log(std::string("station_config REFUSED: ") + a.refused + "\n");
    if (!a.present) return;
    const bool preserve_claim = same_powerup_claim_scope(link.assignment(), a);
    const bool was_feeding = fx.pause_claim_feed(!preserve_claim);
    // §5g.4 + polish round 2: apply_station_config() decides AND latches `dropped_for_match()`; the
    // radio action is the glue's, through fx.muster_drop() below.
    link.apply_station_config(a, rx);  // A58: also REPLACES the match lock, counted from `rx`
    if (a.lock_s > 0) {
      // Write the snapshot only when it would change (or a write or clear is owed); MC re-sends the same
      // config mid-match as the lock's carrier, and that re-push must not wear the flash.
      const bool clear_was_pending = lock.clear_pending;
      lock.clear_pending = false;
      if (clear_was_pending || lock.save_pending || lock.last_saved_seconds != (uint32_t)a.lock_s ||
          lock.last_saved_game != (uint8_t)a.game) {
        lock.save_pending = !fx.write_lock(lock_snapshot_seconds((uint32_t)a.lock_s), (uint8_t)a.game);
      }
      if (!lock.save_pending) {
        lock.last_saved_ms = rx;
        lock.last_saved_seconds = (uint32_t)a.lock_s;
        lock.last_saved_game = (uint8_t)a.game;
      }
    } else {
      clear_lock(fx);
    }
    if (preserve_claim) fx.resume_claim_feed(was_feeding);
    fx.save_range_if_changed();  // A67: MC's value may have replaced an on-station edit
    // Only when it differs (lock_s excluded) or the session is new.
    if (config.note_applied(link.assignment(), link.session_id())) fx.write_config(config.stored(), config.session_id());
    if (hill.note_config(link.assignment(), config.session_id())) fx.erase_hill();  // new game/id/session
    // A new game/id/session, or no clock left running (a same-game lobby or abort re-send, END): erase.
    if (clock.note_config_applied(link.assignment(), config.session_id(), link.hill_clock_remaining_ms(rx)))
      fx.erase_clock();
    fx.wake_screen();
    fx.log("MC-ARMED kind=" + a.kind + " team=" + std::to_string(a.team) + " id=" + std::to_string(a.id) +
           " game=" + std::to_string(a.game) + " threshold=" + std::to_string(a.threshold) +
           " lock_s=" + std::to_string(a.lock_s) + "\n");
    // A hill with a START clock can leave Wi-Fi now, even when the match is untimed.
    if (link.take_muster_drop(rx)) fx.muster_drop();
    else if (link.muster_drop_pending()) fx.log("MUSTER: waiting for START or offline fallback\r\n");
  }

  void on_station_update(StationLink& link, const StationUpdateMsg& u, uint32_t now_ms, StationEffects& fx) {
    if (u.present && link.has_powerup_assignment() && u.id == link.assignment().id) fx.pause_claim_feed(true);
    if (!link.apply_station_update(u, now_ms)) return;
    fx.wake_screen();
    fx.log("STATION_UPDATE id=" + std::to_string(u.id) + " available=" + std::to_string((int)u.available) +
           " next_spawn_in_ms=" + std::to_string(u.next_spawn_in_ms) + "\n");
    if (link.take_muster_drop(now_ms)) fx.muster_drop();  // a deferred drop: the re-anchor landed
  }

  // control{release_utility}: a released Stick must not come back armed, held or locked.
  void on_release(StationLink& link, StationEffects& fx) {
    fx.pause_claim_feed(true);
    link.apply_release();
    clear_lock(fx);
    fx.save_range_if_changed();  // A67: the edited values go with the station (the log and its seq stay)
    if (config.note_released()) fx.erase_config();
    if (hill.clear()) fx.erase_hill();
    if (clock.clear()) fx.erase_clock();
    fx.wake_screen();
    fx.log("RELEASED (control.release_utility): back to UNASSIGNED\r\n");
  }

  // ---- the lock snapshot outside a message: mcLoop, the A+B restart and boot ----------------------
  // Clear the saved lock. A failure leaves `clear_pending` set, and tick_lock retries it every loop.
  bool clear_lock(StationEffects& fx) {
    lock.clear_pending = true;
    if (!fx.clear_lock()) return false;
    lock.clear_pending = false;
    lock.save_pending = false;
    lock.last_saved_seconds = 0;
    lock.last_saved_game = 255;
    return true;
  }

  // Every loop(): the lock running out, a clear still owed, and the once-a-minute snapshot refresh (F391).
  void tick_lock(StationLink& link, uint32_t now_ms, StationEffects& fx) {
    if (link.poll_lock(now_ms)) {
      clear_lock(fx);
      fx.wake_screen();
      fx.log("UNLOCKED (match lock ran out)\r\n");
    }
    if (lock.clear_pending) clear_lock(fx);
    save_lock_if_due(link, now_ms, fx);
  }

  void save_lock_if_due(const StationLink& link, uint32_t now_ms, StationEffects& fx) {
    const uint32_t remaining = link.lock().remaining_s(now_ms);
    if ((!lock.save_pending && !lock_save_due(remaining, lock.last_saved_ms, now_ms)) ||
        (remaining == lock.last_saved_seconds && !lock.save_pending))
      return;
    if (!fx.write_lock(lock_snapshot_seconds(remaining), (uint8_t)link.assignment().game)) {
      lock.save_pending = true;
      return;
    }
    lock.save_pending = false;
    lock.last_saved_ms = now_ms;
    lock.last_saved_seconds = remaining;
    lock.last_saved_game = (uint8_t)link.assignment().game;
  }

  // At boot, after the glue restored `seconds` of a saved lock for game `game` (0 = none restored).
  void lock_restored(uint32_t seconds, uint8_t game) {
    lock.last_saved_seconds = seconds;
    if (seconds > 0) lock.last_saved_game = game;
  }
};

}  // namespace brx
