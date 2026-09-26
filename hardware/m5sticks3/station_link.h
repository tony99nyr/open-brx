// station_link.h - the M5StickS3's Wi-Fi client to Mission Control (H8, docs/spec/utility.md §5g).
//
// Pure C++17, header-only, no Arduino/Wi-Fi/WebSocket/JSON-library dependency: the state machine,
// the message builders and the tolerant parsers all live here so `test/test_link.cpp` runs them on
// the host. `m5sticks3.ino` is plumbing on top: it owns the actual Wi-Fi radio, the mDNS browse,
// the WebSocket socket, and calls into this header to decide what to send and what a reply means.
//
// What this header does NOT do: it never binds a gun (a station has none, §5g.2), never acks a
// config, never runs a store-and-forward ring (a station emits no persisted facts -- `seq_next` is
// 0 forever, honestly, per §5g.2), and never builds pickup mechanics for a `powerup` station (the
// ALT-cycle/`$AMMO` dance in docs/spec/powerups.md is the PLAYER phone's job). It parses and stores
// a `station_config.item` and a `station_update` -- kind, team, id, threshold, game, valid_ids, and
// the powerup schedule -- and turns the schedule into the two advert bytes every kind already has
// (state, value); nothing more.
#pragma once
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>

#include "brx_advert.h"
#include "json_lite.h"
#include "presence.h"  // the Bluetooth hill and the revive count a control/respawn assignment runs
#include "station_range.h"  // F365/A67: the on-station range edit and its sync (STICK_DEFAULT_THRESHOLD_DBM)

namespace brx {

// ---- association mode (§5g.4) ------------------------------------------------------------------
enum class AssocMode : uint8_t {
  MUSTER = 0,  // join at muster, take station_config, drop the association for the match (`LINK MUSTER`)
  HELD = 1,    // the boot default (MVP): stay linked for the whole match, reconnecting per backoff
};
// The mode a Stick boots in: its saved NVS `assoc` byte when it has one, else HELD (Tony, 2026-09-25: a Stick is
// armed at MC in Wi-Fi, then carried to the field). An unknown byte also falls back to HELD. A bare StationLink
// (the host tests) still starts MUSTER; the firmware always calls set_mode(boot_assoc_mode(...)) at boot.
inline AssocMode boot_assoc_mode(bool saved, uint8_t raw) {
  return saved && raw == (uint8_t)AssocMode::MUSTER ? AssocMode::MUSTER : AssocMode::HELD;
}

// ---- link state (§5g.2/§5g.3/§5g.4) ------------------------------------------------------------
enum class LinkState : uint8_t {
  NOT_CONFIGURED = 0,  // no Wi-Fi credentials yet (nothing to join)
  JOINING_WIFI = 1,    // credentials known, associating (or re-associating after a drop)
  LOOKING_FOR_MC = 2,  // Wi-Fi is up; browsing mDNS or waiting on a typed `MC <ws-url>`
  CONNECTING = 3,      // an address is known (mDNS or typed); dialling the WebSocket
  HELLO_SENT = 4,      // socket open, hello sent, waiting for welcome
  WELCOMED = 5,        // welcome received, node_key held; not yet armed
  ASSIGNED = 6,        // a station_config has been applied
};

// Every address source, typed or discovered, must honour both operator and match stops.
inline bool mc_dial_allowed(bool wifi_up, bool dropped_for_match, bool link_off) {
  return wifi_up && !dropped_for_match && !link_off;
}

// ---- identity (persisted in Preferences by the .ino; §5g.2/§5g.3) -------------------------------
struct StationIdentity {
  std::string node_id;    // stable across reboots, or MC sees a new item every power cycle
  std::string node_key;   // "" until a welcome grants one; re-presented on the next hello (A8.2)
  std::string app_ver;    // "<sketch version>+<sha>"
  std::string platform = "esp32";
};

// ---- A56 (powerup schedule, additive) ------------------------------------------------------------
// `item` on a `station_config` for kind "powerup" (docs/spec/powerups.md, confirmed 2026-09-24):
// {kind:"weapon"|"overshield", weapon_id?, charges?, amount?, spawn_every_s, first_at_s, name, color}.
// Items spawn at fixed match-clock times, not a cooldown after a grant; the Stick has no synced
// clock, so it never computes a spawn time itself -- only what `station_update` last told it.
struct StationItem {
  bool present = false;
  std::string kind;       // "weapon" | "overshield"
  std::string weapon_id;  // kind == "weapon"
  long charges = 0;       // optional
  long amount = 0;        // optional (kind == "overshield")
  int spawn_every_s = 0;  // 1..255
  int first_at_s = 0;     // match-clock seconds of the first spawn
  std::string name;       // at most 12 chars (MC enforces it); a longer one from an older MC is the
                          // screen's problem to marquee, not this header's to truncate
  std::string color;      // "#rrggbb", the item's own colour, never a team key
};

struct StationAssignment {
  bool present = false;
  std::string kind;  // "respawn" | "powerup" | "extraction" | "bomb" | "control"
  int team = 255;     // TEAM_ANY
  int id = 0;
  int threshold = -57;  // dBm; parse_station_config resolves 0/absent to STICK_DEFAULT_THRESHOLD_DBM
  bool threshold_defaulted = false;  // MC sent 0/absent: `threshold` is the Stick's default, not MC's
  int game = 0;         // per-match byte; 0 = "any" (v1, unscoped)
  std::vector<int> valid_ids;
  StationItem item;  // A56, additive: absent on an older MC or a non-powerup kind
  int lock_s = 0;    // A58, additive: seconds to lock the operator controls from receipt; 0/absent = unlocked
  int64_t ends_in_ms = -1; // A68: -1 unknown; otherwise MC duration anchored on local receipt
  bool starts_known = false; // A68: a START config supplied the go-live offset
  int64_t starts_in_ms = 0; // MC offset anchored on local receipt; may be negative after go-live
  int64_t duration_ms = 0; // A68 extension: timed fallback duration from first alive game advert
  bool timed_hill = false; // flash marker: a restored timed hill waits for a fresh MC clock
  // A67 (additive): how long ago MC's threshold was last set (-1 = absent, an older MC: apply as today),
  // and MC's advertising power for this station (-1 = absent: keep the Stick's own) with its age.
  int64_t threshold_age_ms = -1;
  int tx_power = -1;
  int64_t tx_power_age_ms = -1;
};

inline bool same_powerup_claim_scope(const StationAssignment& before, const StationAssignment& after) {
  if (!before.present || !after.present || before.kind != "powerup" || after.kind != "powerup" ||
      before.id != after.id || before.game != after.game) return false;
  const StationItem& a = before.item;
  const StationItem& b = after.item;
  return a.present == b.present && a.kind == b.kind && a.weapon_id == b.weapon_id &&
         a.charges == b.charges && a.amount == b.amount && a.spawn_every_s == b.spawn_every_s &&
         a.first_at_s == b.first_at_s && a.name == b.name && a.color == b.color;
}

// ---- A58 (the match lock, additive) --------------------------------------------------------------
// `station_config.lock_s?: int` locks the Stick's OWN operator controls (the B-hold RESET and the
// state-changing serial commands; station_ui.h's `serial_command_allowed_while_locked`) for that many
// seconds from receipt, so a curious player cannot reset a station mid-match. Clamped to 0..7200 (two
// hours: longer than any match, short enough that a wrong value cannot strand a station for a day).
// Absent means 0. A LATER station_config REPLACES the running lock outright, including a same-game
// re-push (MC re-sends the current config mid-match as the lock's carrier), and lock_s 0 unlocks at
// once. The state machine is in RAM, while F391 snapshots its remaining time to NVS. An ordinary
// restart restores that snapshot. A+B held 7 s clears the saved lock before the forced restart.
constexpr int MATCH_LOCK_MAX_S = 7200;

inline int clamp_lock_s(long v) {
  if (v < 0) return 0;
  if (v > MATCH_LOCK_MAX_S) return MATCH_LOCK_MAX_S;
  return (int)v;
}

// F391: flash stores a remaining-time snapshot, refreshed at most once per five minutes.
constexpr uint32_t MATCH_LOCK_SAVE_INTERVAL_MS = 300000;
constexpr uint32_t MATCH_LOCK_RESTORE_MAX_S = 120;
inline uint32_t lock_restore_remaining_s(uint32_t saved_s) {
  return saved_s > MATCH_LOCK_RESTORE_MAX_S ? MATCH_LOCK_RESTORE_MAX_S : saved_s;
}
inline bool lock_save_due(uint32_t remaining_s, uint32_t last_saved_ms, uint32_t now_ms) {
  return remaining_s > 0 && (uint32_t)(now_ms - last_saved_ms) >= MATCH_LOCK_SAVE_INTERVAL_MS;
}

class MatchLock {
 public:
  // Replaces whatever lock was running (never extends or merges it): the newest config is the truth.
  void start(int lock_s, uint32_t now_ms) {
    lock_s = clamp_lock_s(lock_s);
    if (lock_s == 0) { active_ = false; return; }
    active_ = true;
    until_ms_ = now_ms + (uint32_t)lock_s * 1000u;
  }
  void restore(uint32_t lock_s, uint32_t now_ms) { start((int)lock_s, now_ms); }
  void clear() { active_ = false; }

  // Wrap-safe (the same signed-subtraction idiom as PowerupSchedule::tick): 7200 s is far inside
  // int32's ~24.8 days, so a lock that straddles a millis() wrap still ends on time.
  bool locked(uint32_t now_ms) const { return active_ && (int32_t)(now_ms - until_ms_) < 0; }

  // Whole seconds left, rounded UP (never reads 0 while still locked); 0 when unlocked.
  uint32_t remaining_s(uint32_t now_ms) const {
    if (!locked(now_ms)) return 0;
    uint32_t ms = until_ms_ - now_ms;
    return (ms + 999u) / 1000u;
  }

  // Call every loop(): returns true the one call that auto-unlocks at zero, so the caller can log,
  // repaint and release the PMIC side-button lock once.
  bool poll(uint32_t now_ms) {
    if (active_ && (int32_t)(now_ms - until_ms_) >= 0) {
      active_ = false;
      return true;
    }
    return false;
  }

 private:
  bool active_ = false;  // the glue may restore a bounded NVS snapshot during boot
  uint32_t until_ms_ = 0;
};

// A56: `station_update {id, available, next_spawn_in_ms?}`. MC sends it on a pickup and at every
// spawn time, and re-sends the current state on reconnect -- so the Stick never has to remember
// across a link drop, only apply whatever arrives next.
struct StationUpdateMsg {
  bool present = false;
  int id = 0;
  bool available = false;
  long next_spawn_in_ms = -1;  // relative (no synced clock); -1 = absent
  // A56 polish round 2 (brx5): MC sets this only on an operator RESET. `app/src/powerup.js` does
  // not exist in this checkout to mirror; this shape and the accept/refuse rule below are built from
  // the brief alone (docs/spec/powerups.md, and the coordinator's message, are the only sources).
  bool reset = false;
};

struct WelcomeMsg {
  bool ok = false;
  std::string session_id;
  std::string node_key;
};

// ---- message builders (this Stick -> MC) ---------------------------------------------------------
inline std::string build_hello_body(const StationIdentity& id, uint32_t seq_next) {
  std::string j = "{";
  j += "\"node_id\":" + json::quote(id.node_id) + ",";
  j += "\"node_type\":\"utility\",";
  j += "\"app_ver\":" + json::quote(id.app_ver) + ",";
  j += "\"platform\":" + json::quote(id.platform) + ",";
  j += "\"seq_next\":" + std::to_string(seq_next);
  if (!id.node_key.empty()) j += ",\"node_key\":" + json::quote(id.node_key);
  j += "}";
  return j;
}

// Mirrors `utilityStatusBody()` (app/src/utility.js), plus the envelope-required `node_id`/
// `arm_state`/`synced` (envelope.py REQUIRED["status"]). `arm_state` is always "connected": a
// station has no kit/lobby/armed/live state machine of its own (its own `armed` bool means
// "MC has armed me", a different thing). `synced` is always false: a station needs no NTP-lite
// clock sync, having nothing time-critical to report.
struct StatusFields {
  std::string node_id;
  std::string app_ver;
  std::string platform = "esp32";
  std::string kind = "respawn";  // the current advert kind, whatever MC last armed (or the default)
  int team = 255;
  int station_id = 0;
  int threshold = -57;
  bool live = false;    // currently advertising
  bool armed = false;   // MC has armed this station (a station_config was applied)
  int battery_pct = -1; // -1 = absent (no battery reading yet)
  bool has_control = false;
  int control_owner = 255;
  int control_progress = 0;
  bool control_contested = false;
  // Additive (left unset, the body is byte-identical to the older shape and its goldens): the
  // possession tally MC's recap reads (`report.control.hold_ms`, state.py _merge_station_recap_report),
  // keyed by tid as a string; a team that never held the point is left out, as control.js holdMs does.
  bool control_has_hold = false;
  uint32_t control_hold_ms[4] = {0, 0, 0, 0};
  // Additive, respawn only: the revives counted here (utility.js `revives`; StationReport.revives).
  bool has_revives = false;
  uint32_t revives = 0;
  // A58 (additive; left unset, the body is byte-identical to the pre-A58 shape and its goldens):
  // MC detects a restart when `uptime_s` goes backwards or `boot_count` moves, and reads the
  // association mode so it knows whether a mid-match re-push can reach this Stick at all.
  bool has_health = false;
  uint32_t uptime_s = 0;     // millis() / 1000
  uint32_t boot_count = 0;   // Preferences counter, incremented once per boot
  std::string assoc;         // "muster" | "held"
  long lock_s = -1;          // seconds left on the match lock (0 = unlocked); -1 = absent
  // A67 (additive; left unset, the body is byte-identical to the older shape): where `threshold` came
  // from ("station" | "mc"), the station edit's age (only when "station"), the advertising power with the
  // same pair, and the last on-station edits as a JSON array (restated every beat; MC dedupes by seq).
  std::string threshold_src;
  int64_t threshold_edit_age_ms = -1;
  std::string tx_power;
  std::string tx_power_src;
  int64_t tx_power_edit_age_ms = -1;
  std::string range_edits_json;
};

inline std::string build_status_body(const StatusFields& f) {
  std::string j = "{";
  j += "\"node_id\":" + json::quote(f.node_id) + ",";
  j += "\"arm_state\":\"connected\",";
  j += "\"synced\":false,";
  j += "\"role\":\"utility\",";
  j += "\"kind\":" + json::quote(f.kind) + ",";
  j += "\"team\":" + std::to_string(f.team) + ",";
  j += "\"station_id\":" + std::to_string(f.station_id) + ",";
  j += "\"threshold\":" + std::to_string(f.threshold) + ",";
  j += "\"live\":" + std::string(f.live ? "true" : "false") + ",";
  j += "\"armed\":" + std::string(f.armed ? "true" : "false") + ",";
  j += "\"app_ver\":" + json::quote(f.app_ver) + ",";
  j += "\"platform\":" + json::quote(f.platform);
  if (f.battery_pct >= 0) j += ",\"battery\":" + std::to_string(f.battery_pct);
  if (f.has_control) {
    j += ",\"control\":{\"owner\":" + std::to_string(f.control_owner) +
         ",\"progress\":" + std::to_string(f.control_progress) +
         ",\"contested\":" + std::string(f.control_contested ? "true" : "false");
    if (f.control_has_hold) {
      j += ",\"hold_ms\":{";
      bool first = true;
      for (int t = 0; t < 4; t++) {
        if (!f.control_hold_ms[t]) continue;
        if (!first) j += ",";
        first = false;
        j += "\"" + std::to_string(t) + "\":" + std::to_string(f.control_hold_ms[t]);
      }
      j += "}";
    }
    j += "}";
  }
  if (f.has_revives) j += ",\"revives\":" + std::to_string(f.revives);
  if (f.has_health) {
    j += ",\"uptime_s\":" + std::to_string(f.uptime_s);
    j += ",\"boot_count\":" + std::to_string(f.boot_count);
    j += ",\"assoc\":" + json::quote(f.assoc);
  }
  if (f.lock_s >= 0) j += ",\"lock_s\":" + std::to_string(f.lock_s);
  if (!f.threshold_src.empty()) {
    j += ",\"threshold_src\":" + json::quote(f.threshold_src);
    if (f.threshold_src == "station" && f.threshold_edit_age_ms >= 0)
      j += ",\"threshold_edit_age_ms\":" + std::to_string(f.threshold_edit_age_ms);
  }
  if (!f.tx_power.empty()) {
    j += ",\"tx_power\":" + json::quote(f.tx_power);
    if (!f.tx_power_src.empty()) j += ",\"tx_power_src\":" + json::quote(f.tx_power_src);
    if (f.tx_power_src == "station" && f.tx_power_edit_age_ms >= 0)
      j += ",\"tx_power_edit_age_ms\":" + std::to_string(f.tx_power_edit_age_ms);
  }
  if (!f.range_edits_json.empty() && f.range_edits_json != "[]") j += ",\"range_edits\":" + f.range_edits_json;
  j += "}";
  return j;
}

// The envelope `t` (and a station_action body `t`) must be wall-clock ms since 1970: MC's envelope.py
// rejects anything outside 2017..2096 as `bad_t` and closes the socket (1008, "bad hello: bad_t").
// A Stick has no clock, so it borrows MC's: every MC frame carries MC's own `t`, and the Stick keeps
// the offset between that and its millis(). Before the first MC frame (the hello itself) it uses a
// fixed plausible base; MC dates a station's boots from uptime_s/boot_count, never from `t`
// (bench 2026-09-24: every Stick hello was refused until this).
constexpr int64_t CLOCK_BASE_MS = 1'790'000'000'000LL;     // 2026-09, inside MC's accepted range
constexpr int64_t CLOCK_T_MIN_MS = 1'500'000'000'000LL;    // envelope.py T_MIN_MS
constexpr int64_t CLOCK_T_MAX_MS = 4'000'000'000'000LL;    // envelope.py T_MAX_MS
struct McClock {
  int64_t offset_ms = CLOCK_BASE_MS;  // epoch ms = offset + millis()
  bool synced = false;
  // Feed every received MC envelope's `t`; an out-of-range value is ignored.
  void observe(int64_t mc_t_ms, uint32_t now_ms) {
    if (mc_t_ms < CLOCK_T_MIN_MS || mc_t_ms > CLOCK_T_MAX_MS) return;
    offset_ms = mc_t_ms - (int64_t)now_ms;
    synced = true;
  }
  int64_t epoch(uint32_t millis_value) const { return offset_ms + (int64_t)millis_value; }
};

inline std::string make_envelope(const std::string& kind, const std::string& body_json,
                                  const std::string& env_id, int64_t t_ms) {
  return "{\"v\":1,\"kind\":" + json::quote(kind) + ",\"id\":" + json::quote(env_id) +
         ",\"t\":" + std::to_string(t_ms) + ",\"body\":" + body_json + "}";
}

// ---- tolerant parsers (MC -> this Stick) -----------------------------------------------------
inline WelcomeMsg parse_welcome(const json::Value& body) {
  WelcomeMsg w;
  if (!body.is_object()) return w;
  w.session_id = body.get("session_id").as_string();
  w.node_key = body.get("node_key").as_string();
  w.ok = !w.session_id.empty();
  return w;
}

inline StationItem parse_item(const json::Value& v) {
  StationItem it;
  if (!v.is_object()) return it;
  it.present = true;
  it.kind = v.get("kind").as_string();
  it.weapon_id = v.get("weapon_id").as_string();
  it.charges = v.get("charges").as_int();
  it.amount = v.get("amount").as_int();
  it.spawn_every_s = (int)v.get("spawn_every_s").as_int();
  if (it.spawn_every_s < 1) it.spawn_every_s = 1;
  if (it.spawn_every_s > 255) it.spawn_every_s = 255;
  it.first_at_s = (int)v.get("first_at_s").as_int();
  it.name = v.get("name").as_string();  // <=12 chars is MC's contract to keep, not ours to enforce
  it.color = v.get("color").as_string();
  return it;
}

// THRESHOLD (confirmed 2026-09-24): 0 in station_config -- explicit or absent, `json::Value::as_int`
// answers 0 for both -- means "use the Stick's own default", not "an RSSI floor of literally 0
// dBm" (which would always be true and defeat the point of a threshold). An MC value other than 0
// overrides it. This is a placeholder pending a bench measurement (README).
// -57 dBm, the StickS3's platform default (Tony, 2026-09-24, walked at 3-5 m: "the stick actually works better";
// a phone station defaults to -70). It is
// also what the Stick advertises in byte 14, and a player's phone measures a respawn station against byte 14
// (beacon.js Presence), so the Stick must advertise the same value it measures by.
// STICK_DEFAULT_THRESHOLD_DBM (-57, Tony 2026-09-24) lives in station_range.h, beside the range edit.

// Required per contracts.md §5 (`REQUIRED["station_config"]`): kind, team, id. `threshold`/`game`/
// `valid_ids`/`item` are optional (utility.md §5c, A56).
inline StationAssignment parse_station_config(const json::Value& body) {
  StationAssignment a;
  if (!body.is_object() || !body.has("kind") || !body.has("id")) return a;
  a.present = true;
  a.kind = body.get("kind").as_string();
  a.team = (int)body.get("team").as_int(255);
  a.id = (int)body.get("id").as_int();
  int t = (int)body.get("threshold").as_int(0);
  a.threshold = (t == 0) ? STICK_DEFAULT_THRESHOLD_DBM : t;
  // The saved copy (station_config_storage_body) writes the resolved value plus this marker, so a
  // restored config still knows MC asked for "the default". MC itself never sends the key.
  a.threshold_defaulted = (t == 0) || body.get("threshold_default").as_bool(false);
  a.game = (int)body.get("game").as_int(0);
  const json::Value& ids = body.get("valid_ids");
  if (ids.is_array()) {
    for (const auto& x : ids.arr) a.valid_ids.push_back((int)x.as_int());
  }
  a.item = parse_item(body.get("item"));
  if (body.has("ends_in_ms")) {
    const json::Value& end = body.get("ends_in_ms");
    const double d = end.type == json::Value::Type::Number ? end.num : -1.0;
    a.ends_in_ms = d < 0 ? -1 : (d > 2147483647.0 ? 2147483647 : (int64_t)d);
  }
  if (body.has("starts_in_ms")) {
    const json::Value& start = body.get("starts_in_ms");
    if (start.type == json::Value::Type::Number) {
      const double d = start.num;
      a.starts_known = true;
      a.starts_in_ms = d < -2147483647.0 ? -2147483647 :
                       (d > 2147483647.0 ? 2147483647 : (int64_t)d);
    }
  }
  if (body.has("duration_ms")) {
    const json::Value& duration = body.get("duration_ms");
    const double d = duration.type == json::Value::Type::Number ? duration.num : 0.0;
    a.duration_ms = d < 0 ? 0 : (d > 2147483647.0 ? 2147483647 : (int64_t)d);
  }
  a.timed_hill = body.get("timed_hill").as_bool(false);
  // A67: ages are relative to receipt, so they are never saved (station_config_storage_body leaves them out).
  if (body.has("threshold_age_ms")) a.threshold_age_ms = body.get("threshold_age_ms").as_int64(-1);
  a.tx_power = parse_tx_power(body.get("tx_power").as_string());
  if (a.tx_power >= 0 && body.has("tx_power_age_ms")) a.tx_power_age_ms = body.get("tx_power_age_ms").as_int64(-1);
  // Clamp as a double first: a (long) cast of an out-of-range number is undefined and could come out 0,
  // which would turn a garbage lock into an unlock. Anything above the cap locks for the cap.
  {
    const json::Value& v = body.get("lock_s");
    double d = v.type == json::Value::Type::Number ? v.num : 0.0;
    a.lock_s = d >= (double)MATCH_LOCK_MAX_S ? MATCH_LOCK_MAX_S : clamp_lock_s((long)(d > 0 ? d : 0));
  }
  return a;
}

// ---- the saved assignment (Tony, 2026-09-24: a restart mid-match comes straight back) -----------
// A Stick that restarts mid-match (a crash, the side button, the A+B force restart) must come back
// as the same station: under MUSTER it is off Wi-Fi for the whole match, so without a saved copy a
// restarted pickup station stayed dead until the next muster. The glue saves the last APPLIED
// station_config in Preferences ("brxmc"/"station_cfg") and applies it again at boot.
//
// The stored copy is this canonical re-serialisation of the PARSED assignment, not the raw frame:
// a fixed key order makes "is it the same config?" a plain string compare, and it can never carry a
// field this firmware does not read. It deliberately has NO lock_s: MC re-sends the same config
// mid-match as the lock's carrier (A58), and a lock must never survive a boot. So a same-config
// re-push with a new lock_s serialises to the same string and costs no flash write. `threshold` is
// the resolved value (never 0), so it parses back unchanged.
inline std::string station_config_storage_body(const StationAssignment& a) {
  std::string j = "{";
  j += "\"kind\":" + json::quote(a.kind);
  j += ",\"team\":" + std::to_string(a.team);
  j += ",\"id\":" + std::to_string(a.id);
  j += ",\"threshold\":" + std::to_string(a.threshold);
  if (a.threshold_defaulted) j += ",\"threshold_default\":true";
  if (a.tx_power >= 0) j += ",\"tx_power\":" + json::quote(tx_power_name(a.tx_power));
  if (a.duration_ms > 0) j += ",\"duration_ms\":" + std::to_string(a.duration_ms);
  j += ",\"game\":" + std::to_string(a.game);
  if (a.kind == "control" && (a.ends_in_ms >= 0 || a.duration_ms > 0 || a.timed_hill)) j += ",\"timed_hill\":true";
  j += ",\"valid_ids\":[";
  for (size_t i = 0; i < a.valid_ids.size(); i++) {
    if (i) j += ",";
    j += std::to_string(a.valid_ids[i]);
  }
  j += "]";
  if (a.item.present) {
    const StationItem& it = a.item;
    j += ",\"item\":{\"kind\":" + json::quote(it.kind);
    j += ",\"weapon_id\":" + json::quote(it.weapon_id);
    j += ",\"charges\":" + std::to_string(it.charges);
    j += ",\"amount\":" + std::to_string(it.amount);
    j += ",\"spawn_every_s\":" + std::to_string(it.spawn_every_s);
    j += ",\"first_at_s\":" + std::to_string(it.first_at_s);
    j += ",\"name\":" + json::quote(it.name);
    j += ",\"color\":" + json::quote(it.color) + "}";
  }
  j += "}";
  return j;
}

// A mirror of what is in flash, so the glue writes only when the stored copy would change. It owns
// no I/O: `note_applied`/`note_released` return true when the glue must write (or erase) the key.
class SavedStationConfig {
 public:
  // At boot, with whatever Preferences held ("" = nothing saved). `session_id` is the WELCOME
  // session the config was saved in ("" on a copy saved before session ids were stored: stale).
  void loaded(const std::string& body, const std::string& session_id = "") {
    stored_ = body;
    session_id_ = body.empty() ? "" : session_id;
  }
  const std::string& stored() const { return stored_; }
  const std::string& session_id() const { return session_id_; }
  bool has() const { return !stored_.empty(); }

  // After apply_station_config accepted `a`, in WELCOME session `session_id`. True = write
  // `stored()` AND `session_id()` to flash now. A same-config re-push in the same session writes
  // nothing; the same config in a NEW session (MC restarted) rewrites once, so the copy is not
  // judged stale on the next WELCOME of that session.
  bool note_applied(const StationAssignment& a, const std::string& session_id) {
    if (!a.present) return false;
    std::string body = station_config_storage_body(a);
    if (body == stored_ && session_id == session_id_) return false;
    stored_ = body;
    session_id_ = session_id;
    return true;
  }

  // After control release_utility, or a stale copy found on WELCOME. True = erase both keys now
  // (false when nothing was stored).
  bool note_released() {
    if (stored_.empty()) return false;
    stored_.clear();
    session_id_.clear();
    return true;
  }

  // Review round 1 (HIGH): a copy saved in another MC session is a stale assignment from an old
  // match. A copy with no session id counts as stale too. Nothing saved is never stale.
  // A WELCOME with no session id says nothing about staleness (MC always sends one; envelope.py), so
  // it never erases: otherwise every reconnect would churn NVS and drop a restored station.
  bool stale_for(const std::string& welcome_session_id) const {
    if (welcome_session_id.empty()) return false;
    return has() && (session_id_.empty() || session_id_ != welcome_session_id);
  }

  // The saved assignment, or one with present == false (nothing saved, or a body that no longer
  // parses; the glue erases a bad one). Never carries a lock, whatever the body says.
  StationAssignment restore() const {
    if (stored_.empty()) return StationAssignment();
    bool ok = false;
    json::Value v = json::parse(stored_, &ok);
    if (!ok) return StationAssignment();
    StationAssignment a = parse_station_config(v);
    a.lock_s = 0;
    return a;
  }

 private:
  std::string stored_;
  std::string session_id_;
};

inline StationUpdateMsg parse_station_update(const json::Value& body) {
  StationUpdateMsg u;
  if (!body.is_object() || !body.has("id")) return u;
  u.present = true;
  u.id = (int)body.get("id").as_int();
  u.available = body.get("available").as_bool(false);
  u.next_spawn_in_ms = body.has("next_spawn_in_ms") ? body.get("next_spawn_in_ms").as_int(-1) : -1;
  u.reset = body.get("reset").as_bool(false);
  return u;
}

inline std::string parse_control_cmd(const json::Value& body) {
  if (!body.is_object()) return "";
  return body.get("cmd").as_string();
}

// ---- what a powerup kind maps to on the advert's `kind` byte ----------------------------------
inline uint8_t station_kind_byte(const std::string& kind) {
  if (kind == "respawn") return KIND_RESPAWN;
  if (kind == "powerup") return KIND_POWERUP;
  if (kind == "extraction") return KIND_EXTRACTION;
  if (kind == "bomb") return KIND_BOMB;
  return KIND_CONTROL;  // "control", or anything MC would never actually send (it validates first)
}

// ---- the presence threshold (hill + respawn) -------------------------------------------------------
// The threshold a Bluetooth station measures PLAYERS against. MC's value when it sent one; when it sent
// 0/absent, the StickS3's own default for that kind (-75 dBm for control, -57 otherwise). A defaulted
// control advert keeps byte 14 at -57 for phone-side presence because the radio paths are asymmetric.
// The pickup claim has no RSSI floor at all (ClaimGate): the phone's own
// claim_ready already proves the player stood at the station.
inline int presence_threshold_dbm(const StationAssignment& a) {
  return a.threshold_defaulted ? (a.kind == "control" ? STICK_HILL_DEFAULT_THRESHOLD_DBM : STICK_DEFAULT_THRESHOLD_DBM)
                               : a.threshold;
}

// ---- the saved hill owner (F332: a restart must not wipe an enemy hold) ----------------------------
// A mirror of Preferences "brxmc" hill_owner / hill_game / hill_id / hill_sid / hill_hold, like
// SavedStationConfig: it owns no I/O, and each call answers whether the glue must write or erase now.
// Written when the owner changes and once at the whistle, never on a progress tick,
// with the possession tally as it stood then. Tagged with the game byte, the station id AND
// the MC session the config came in, because a new MC session numbers its games from 1 again and must
// not revive an old match's owner. `held` is `owner != HILL_NEUTRAL` (control.js: held <=> owner).
class SavedHill {
 public:
  // At boot, from Preferences (`has` false = no hill_owner key). `hold` may be null (no tally saved).
  void loaded(bool has, int owner, int game, int id, const std::string& session_id, const uint32_t* hold) {
    has_ = has;
    owner_ = owner;
    game_ = game;
    id_ = id;
    session_id_ = session_id;
    for (int t = 0; t < 4; t++) hold_[t] = hold ? hold[t] : 0;
    final_saved_ = false;
  }
  bool has() const { return has_; }
  int owner() const { return owner_; }
  int game() const { return game_; }
  int id() const { return id_; }
  const std::string& session_id() const { return session_id_; }
  const uint32_t* hold_ms() const { return hold_; }

  // After every hill tick of a control assignment, with the session the assignment came in (the saved
  // config's, which a restored MUSTER Stick still knows with no WELCOME). Write on owner change or
  // once on freeze, so a reboot after the whistle restores the final recap tally.
  bool note_owner(const StationAssignment& a, const std::string& session_id, const BleControlPoint& hill) {
    const int owner = hill.owner;
    if (!has_ && owner == HILL_NEUTRAL) return false;  // nothing held, nothing saved: nothing to say
    // Unchanged = same owner under the same tag, compared plainly (never via tag_matches, whose "no
    // empty session" rule would make an untagged save look changed and write flash every tick).
    if (has_ && owner == owner_ && game_ == a.game && id_ == a.id && session_id_ == session_id &&
        !(hill.frozen && !final_saved_)) return false;
    has_ = true;
    owner_ = owner;
    game_ = a.game;
    id_ = a.id;
    session_id_ = session_id;
    for (int t = 0; t < 4; t++) hold_[t] = hill.hold_ms[t];
    final_saved_ = hill.frozen;
    return true;
  }

  // After every applied or restored station_config: a save that belongs to another game, id, kind or
  // session is cleared. True = erase the keys now.
  bool note_config(const StationAssignment& a, const std::string& session_id) {
    if (!has_) return false;
    if (a.present && a.kind == "control" && tag_matches(a, session_id)) return false;
    return clear();
  }

  // A WELCOME from another MC session: the save is an old match's (as SavedStationConfig::stale_for).
  // A WELCOME with no session id says nothing. True = erase the keys now.
  bool note_welcome(const std::string& welcome_session_id) {
    if (!has_ || welcome_session_id.empty() || welcome_session_id == session_id_) return false;
    return clear();
  }

  // control{release_utility} or the operator's point RESET: the hold goes. True = erase the keys now.
  bool clear() {
    if (!has_) return false;
    has_ = false;
    owner_ = HILL_NEUTRAL;
    for (auto& h : hold_) h = 0;
    final_saved_ = false;
    return true;
  }

  // At boot, after a saved station_config was restored: the owner to bring the point back held by, or
  // HILL_NEUTRAL when the tag does not match that config and its session (or nothing is saved).
  int restore_owner(const StationAssignment& a, const std::string& session_id) const {
    if (!has_ || !tag_matches(a, session_id)) return HILL_NEUTRAL;
    return hill_claimable(owner_) ? owner_ : HILL_NEUTRAL;
  }

  // Restore the point itself: held by the saved owner at 100, with the saved tally. False (and the point
  // left as it is) when the save is not this config's.
  bool restore_into(const StationAssignment& a, const std::string& session_id, BleControlPoint& hill) const {
    if (!has_ || !tag_matches(a, session_id)) return false;
    hill.restore_held(owner_, hold_);
    return true;
  }

 private:
  bool tag_matches(const StationAssignment& a, const std::string& session_id) const {
    return a.present && a.kind == "control" && game_ == a.game && id_ == a.id && !session_id.empty() &&
           session_id_ == session_id;
  }
  bool has_ = false;
  int owner_ = HILL_NEUTRAL;
  int game_ = 0;
  int id_ = 0;
  std::string session_id_;
  uint32_t hold_[4] = {0, 0, 0, 0};
  bool final_saved_ = false;
};

// ---- the saved hill clock (A68 review 2026-09-25: an offline restart must not move the whistle) ------
// A mirror of Preferences "brxmc" hclk_game / hclk_id / hclk_sid / hclk_rem, like SavedHill: no I/O here,
// and note() answers whether the glue must write now. `remaining` is the ms left to a duration hill's
// deadline (StationLink::hill_clock_remaining_ms). It is written when a clock first runs, then at most once
// per HILL_CLOCK_SAVE_MS (at most 241 writes in a 7200 s match), and once as 0 at the whistle. A restart
// resumes from the last save, so the whistle is late by at most HILL_CLOCK_SAVE_MS plus the time the Stick
// was off. Tagged like SavedHill: game, station id and MC session.
constexpr uint32_t HILL_CLOCK_SAVE_MS = 30000;
class SavedHillClock {
 public:
  void loaded(bool has, int game, int id, const std::string& session_id, int32_t remaining_ms) {
    has_ = has && remaining_ms >= 0;
    game_ = game;
    id_ = id;
    session_id_ = session_id;
    remaining_ = remaining_ms < 0 ? 0 : remaining_ms;
    written_at_ = 0;
  }
  bool has() const { return has_; }
  int game() const { return game_; }
  int id() const { return id_; }
  const std::string& session_id() const { return session_id_; }
  int32_t remaining_ms() const { return remaining_; }

  // After every hill tick. `remaining_ms` < 0 = no duration clock running (nothing to say).
  bool note(const StationAssignment& a, const std::string& session_id, int32_t remaining_ms, uint32_t now_ms) {
    if (remaining_ms < 0 || session_id.empty()) return false;
    const bool same = has_ && tag_matches(a, session_id);
    if (same && remaining_ms == 0 && remaining_ == 0) return false;  // the whistle is already saved
    if (same && remaining_ms > 0 && (uint32_t)(now_ms - written_at_) < HILL_CLOCK_SAVE_MS) return false;
    has_ = true;
    game_ = a.game;
    id_ = a.id;
    session_id_ = session_id;
    remaining_ = remaining_ms;
    written_at_ = now_ms;
    return true;
  }
  // After every applied or restored station_config: another game, id, kind or session clears it.
  bool note_config(const StationAssignment& a, const std::string& session_id) {
    if (!has_ || (a.present && a.kind == "control" && tag_matches(a, session_id))) return false;
    return clear();
  }
  // After every station_config the link APPLIED (never the boot restore, whose clock resumes after this):
  // `remaining_ms` < 0 means MC's config left no clock running (a same-game lobby or abort re-send, an untimed
  // START, END), so the save no longer describes a match and a restart must not resume it.
  bool note_config_applied(const StationAssignment& a, const std::string& session_id, int32_t remaining_ms) {
    if (note_config(a, session_id)) return true;
    return remaining_ms < 0 && clear();
  }
  bool note_welcome(const std::string& welcome_session_id) {
    if (!has_ || welcome_session_id.empty() || welcome_session_id == session_id_) return false;
    return clear();
  }
  bool clear() {
    if (!has_) return false;
    has_ = false;
    remaining_ = 0;
    return true;
  }
  // At boot, after the saved station_config was restored: the ms left, or -1 when the save is not its.
  int32_t restore_remaining(const StationAssignment& a, const std::string& session_id) const {
    return has_ && tag_matches(a, session_id) ? remaining_ : -1;
  }

 private:
  bool tag_matches(const StationAssignment& a, const std::string& session_id) const {
    return a.present && a.kind == "control" && game_ == a.game && id_ == a.id && !session_id.empty() &&
           session_id_ == session_id;
  }
  bool has_ = false;
  int game_ = 0;
  int id_ = 0;
  std::string session_id_;
  int32_t remaining_ = 0;
  uint32_t written_at_ = 0;
};

// ---- the advert state byte of a kind with no live state of its own -------------------------------
// respawn: utility.js advertFields() sends `state: 1` ("ready"), and engine.js _respawnStation() skips
// any respawn advert whose state is 0 (beacon.js byte 10: 0 = disabled). Before 2026-09-24 a Stick
// sent 0 here, so no phone ever used a Stick respawn station. extraction / bomb: 0, "armed and doing
// nothing" (no player-side rule for either yet). control and powerup carry live state and never ask.
inline uint8_t station_static_state(const std::string& kind) { return kind == "respawn" ? 1 : 0; }

// ---- the powerup schedule (A56, final design 2026-09-24; NOT pickup mechanics) -------------------
// State 1 = available, value 0. State 0 = taken, value = seconds to the next spawn (capped at
// 255), byte 15 = the taker's player_num (0 = none). SELF-SPAWN: the Stick counts its own local
// clock down to the next spawn and flips itself available at 0 -- "a lost MC link must not freeze
// it" -- and every `station_update` RE-ANCHORS that clock (MC is authoritative whenever it can
// reach the Stick; the schedule's fixed times are MC's to compute, not the Stick's). A RESET
// (button, station_action) changes nothing here by itself: it only asks MC to answer with a fresh
// `station_update`, which lands through the same `apply_update` path as any other one. The Stick
// announces nothing of its own to players (no LED, no callout) -- they compute "<ITEM> AVAILABLE"
// from the schedule MC already gave them; this only feeds the advert bytes.
struct PowerupAdvertView {
  uint8_t state = 0;
  uint8_t value = 0;
  uint8_t taker = 0;
};

class PowerupSchedule {
 public:
  bool known() const { return known_; }
  bool available() const { return available_; }
  uint8_t taker() const { return taker_; }
  uint32_t anchor_ms() const { return anchor_ms_; }
  // Restart survival only: a Stick restarted offline mid-match has no anchor, so it offers the item at once.
  void assume_available() { known_ = true; available_ = true; }
  // F374 round 1: a Stick that lost MC before START's update falls back the same way; a known schedule is kept.
  void assume_available_if_unknown() { if (!known_) assume_available(); }

  void apply_item(const StationItem& it) {
    if (it.present && it.spawn_every_s > 0) spawn_every_s_ = it.spawn_every_s;
  }

  // A56 polish round 2 (brx5): should an incoming `station_update{available:true}` actually be
  // applied? A station that has awarded the current spawn (a LOCAL claim, `mark_taken`) must REFUSE
  // a stale or duplicate `available:true` for that SAME spawn -- accepting it would silently
  // un-claim an item a player already legitimately holds. Accepted when: nothing is being protected
  // (no local award since the last genuine spawn); `reset` is set (an explicit operator RESET is
  // always honoured -- "a reset keeps the fixed next spawn", so it still goes through the normal
  // re-anchor below, just never refused); or the incoming update's own implied next-spawn instant is
  // at least half a `spawn_every_s` interval past the awarded one, which can only mean a genuinely
  // later spawn cycle, not an echo of the one just claimed. `app/src/powerup.js` does not exist in
  // this checkout to mirror; this rule is built from the brief alone.
  bool should_accept_available(bool reset, long incoming_next_spawn_in_ms, uint32_t received_at_ms) const {
    if (!has_awarded_instant_) return true;
    if (reset) return true;
    if (incoming_next_spawn_in_ms < 0) return false;  // nothing to prove this is a later cycle
    uint32_t incoming_next_ms = received_at_ms + (uint32_t)incoming_next_spawn_in_ms;
    long half_interval_ms = (long)(spawn_every_s_ > 0 ? spawn_every_s_ : 60) * 1000L / 2;
    long advance_ms = (long)(incoming_next_ms - awarded_instant_ms_);
    return advance_ms >= half_interval_ms;
  }

  // MC is authoritative: always re-anchors when a next_spawn_in_ms rides along, even one that is
  // already in the past by the time it lands (`tick()` below folds a stale anchor forward without
  // an extra false spawn). An ACCEPTED `available:true` clears any taker shown locally and lifts the
  // local-award protection above; a REFUSED one changes nothing at all (not even the anchor), since
  // applying half of a rejected update would be its own kind of wrong.
  void apply_update(const StationUpdateMsg& u, uint32_t received_at_ms) {
    if (!u.present) return;
    if (u.available && !should_accept_available(u.reset, u.next_spawn_in_ms, received_at_ms)) return;
    known_ = true;
    available_ = u.available;
    if (u.next_spawn_in_ms >= 0) {
      anchor_ms_ = received_at_ms + (uint32_t)u.next_spawn_in_ms;
      has_anchor_ = true;
    }
    if (available_) { taker_ = 0; has_awarded_instant_ = false; }
  }

  // The Stick's own local clock (SELF-SPAWN). Call every loop() with the current millis(); returns
  // true the one call that crosses into available, so a caller can log/repaint once.
  bool tick(uint32_t now_ms) {
    if (!known_ || available_ || !has_anchor_) return false;
    if ((int32_t)(now_ms - anchor_ms_) < 0) return false;  // not due yet (wrap-safe signed compare)
    available_ = true;
    taker_ = 0;
    has_awarded_instant_ = false;
    return true;
  }

  // A claim just won (ClaimGate, below). The NEXT spawn is `spawn_every_s` after the LAST scheduled
  // instant, never "now + spawn_every_s" -- the schedule is fixed-time, not a cooldown after a
  // grant -- folding forward past any periods already missed so a late-processed claim never
  // double-spawns an instant it already passed. MC's own next `station_update` corrects this
  // estimate once it arrives; this is only the Stick's best local guess until then. Returns the
  // spawn instant that was just claimed (the caller enqueues it as the CLAIM report's dedup key).
  uint32_t mark_taken(uint8_t player_num, uint32_t now_ms) {
    uint32_t awarded = has_anchor_ ? anchor_ms_ : now_ms;
    available_ = false;
    taker_ = player_num;
    has_awarded_instant_ = true;
    awarded_instant_ms_ = awarded;
    uint32_t period_ms = (uint32_t)(spawn_every_s_ > 0 ? spawn_every_s_ : 60) * 1000u;
    if (!has_anchor_) {
      anchor_ms_ = now_ms + period_ms;
      has_anchor_ = true;
      return awarded;
    }
    while ((int32_t)(now_ms - anchor_ms_) >= 0) anchor_ms_ += period_ms;
    return awarded;
  }

  PowerupAdvertView view(uint32_t now_ms) const {
    PowerupAdvertView v;
    if (!known_) return v;
    if (available_) { v.state = 1; return v; }
    if (!has_anchor_) { v.taker = taker_; return v; }
    v.state = 0;
    v.taker = taker_;
    int32_t remaining_ms = (int32_t)(anchor_ms_ - now_ms);
    if (remaining_ms < 0) remaining_ms = 0;
    long secs = ((long)remaining_ms + 999) / 1000;  // ceiling: never reads 0 while still taken
    if (secs > 255) secs = 255;
    v.value = (uint8_t)secs;
    return v;
  }

 private:
  bool known_ = false;      // F374: false until MC's first station_update (or a restore), like the phone's null
  bool available_ = false;
  bool has_anchor_ = false;
  uint32_t anchor_ms_ = 0;
  int spawn_every_s_ = 60;
  uint8_t taker_ = 0;
  bool has_awarded_instant_ = false;  // true once a LOCAL claim has awarded the current spawn
  uint32_t awarded_instant_ms_ = 0;
};

// ---- the CLAIM award (A56, confirmed 2026-09-24) -------------------------------------------------
// A claiming player's OWN advert sets PLAYER_CLAIMING once it is in range, and PLAYER_CLAIM_READY
// only after ITS OWN 1 s dwell timer -- the Stick counts no dwell of its own; it awards the FIRST
// `claim_ready` it hears for its id, while available, at ANY signal strength. The 100 ms window
// lets the loop collect simultaneous adverts; a later ready advert cannot displace the first.
// Equal timestamp ties go to the lower player_num.
// No RSSI floor (Tony, 2026-09-24): the phone's claim_ready already proves it is at the station (its own
// 1 s dwell on the station's strong advert), while the Stick hears player adverts weakly (bench: -75 to
// -91 even nearby), so a -80 floor refused real claims. A pickup may sit outside Wi-Fi, so this award
// and the taker byte in the advert are the whole offline path.

struct ClaimWinner {
  bool won = false;
  uint8_t player_num = 0;
};

constexpr uint32_t CLAIM_TIE_WINDOW_MS = 100;

class ClaimGate {
 public:
  void configure(int station_id, int game) { station_id_ = station_id; game_ = game; }

  // Feed every player advert seen in the current scan batch. `player_num` is the claimant (1..63,
  // the advert's own `id` field), `target_station_id` is that advert's `value`. A game of 0 is
  // unscoped, matching every other game-byte check in this codebase (state.py `_game_byte`).
  // `alive` is the advert's alive bit (state bit0): a DOWN player's claim_ready (or a stale one left
  // over from before they went down) is ignored, as the phone station does (app/src/powerup.js).
  // player_num 0 is "no player" on the wire (the advert's taker byte uses it so), never a claimant.
  void observe(int player_num, int target_station_id, int game, bool claiming, bool claim_ready, bool alive,
               int rssi_dbm, uint32_t now_ms = 0) {
    if (claiming) any_claiming_ = true;
    if (!claim_ready || !alive) return;
    if (player_num < 1 || player_num > 63) return;
    if (target_station_id != station_id_) return;
    if (game != 0 && game_ != 0 && game != game_) return;
    (void)rssi_dbm;  // kept in the signature for a future tie-break; no floor
    if (!candidate_seen_) first_ready_at_ms_ = now_ms;
    // A later ready advert cannot displace the first claimant. Break only simultaneous ties by id.
    if (!candidate_seen_ || (now_ms == first_ready_at_ms_ && player_num < candidate_player_num_)) {
      candidate_seen_ = true;
      candidate_player_num_ = player_num;
    }
  }

  bool any_claiming_this_batch() const { return any_claiming_; }
  bool ready_due(uint32_t now_ms) const {
    return candidate_seen_ && (uint32_t)(now_ms - first_ready_at_ms_) >= CLAIM_TIE_WINDOW_MS;
  }

  // Call once at the end of a scan batch. Clears the batch's candidates either way, so the next
  // batch starts clean; a caller only awards the claim when `won` and the station is `available()`.
  ClaimWinner resolve_batch() {
    ClaimWinner w;
    if (candidate_seen_) { w.won = true; w.player_num = (uint8_t)candidate_player_num_; }
    candidate_seen_ = false;
    any_claiming_ = false;
    first_ready_at_ms_ = 0;
    return w;
  }

 private:
  int station_id_ = 0, game_ = 0;
  bool candidate_seen_ = false;
  uint32_t first_ready_at_ms_ = 0;
  int candidate_player_num_ = 0;
  bool any_claiming_ = false;
};

// ---- reconnect backoff, mirroring app/src/transport/transport.js (base 500 ms, x2, cap 10 s, +-20%) --
struct Backoff {
  uint32_t base_ms = 500, cap_ms = 10000;
  float jitter = 0.2f;
  uint32_t attempt = 0;

  void reset() { attempt = 0; }

  // `rand01` in [0, 1): the caller supplies it (host tests fix it for determinism; the sketch
  // reads `esp_random()`). Doubling is done by shift, capped before it can overflow a uint32_t.
  uint32_t next(float rand01) {
    uint32_t raw = attempt < 16 ? (base_ms << attempt) : cap_ms;
    if (raw > cap_ms || raw < base_ms) raw = cap_ms;
    attempt++;
    float j = 1.0f + (rand01 * 2.0f - 1.0f) * jitter;
    float scaled = (float)raw * j;
    if (scaled < 0) scaled = 0;
    return (uint32_t)scaled;
  }
};

// ---- pending station_action reports (polish round 2) ---------------------------------------------
// A CLAIM award happens inside a BLE scan-complete callback (mc_link_glue.h), which must NEVER touch
// the WebSocket directly -- the library is not written to be called from there, and no I/O belongs
// in a callback anyway. The callback only enqueues; mcLoop is the one place that ever sends. Bounded
// (a handful of stray claims is already an unusual field state) and keyed by the spawn instant being
// reported: a second report for the SAME instant replaces the first ("the newest per spawn instant
// wins") instead of piling up, and the OLDEST distinct instant is dropped to make room once full --
// a report about a spawn cycle several cycles ago is the one MC needs least.
struct PendingTakenReport {
  int station_id = 0;  // captured at the moment of the award -- a later reassignment must not relabel it
  int player_num = 0;
  uint32_t spawn_instant_ms = 0;
  int64_t t_ms = 0;
};

class PendingActionQueue {
 public:
  static constexpr size_t CAPACITY = 8;

  void push(int station_id, int player_num, uint32_t spawn_instant_ms, int64_t t_ms) {
    for (auto& e : entries_) {
      if (e.station_id == station_id && e.spawn_instant_ms == spawn_instant_ms) {
        e.player_num = player_num;
        e.t_ms = t_ms;
        return;
      }
    }
    if (entries_.size() >= CAPACITY) entries_.erase(entries_.begin());
    entries_.push_back(PendingTakenReport{station_id, player_num, spawn_instant_ms, t_ms});
  }

  bool empty() const { return entries_.empty(); }
  size_t size() const { return entries_.size(); }
  void clear() { entries_.clear(); }

  // FIFO: the oldest queued report comes out first. Returns false (leaving `out` untouched) when
  // the queue is empty.
  bool pop_front(PendingTakenReport& out) {
    if (entries_.empty()) return false;
    out = entries_.front();
    entries_.erase(entries_.begin());
    return true;
  }

 private:
  std::vector<PendingTakenReport> entries_;
};

// How long a MUSTER drop after a restore waits for MC's re-anchoring station_update (review round 1).
constexpr uint32_t MUSTER_DROP_DEFER_MS = 2000;
// F374 round 1: how long a powerup Stick still waiting for START's station_update keeps rejoining once MC is out of
// reach (a blip, or the operator carrying it out to the field), before it takes the MUSTER drop.
constexpr uint32_t MUSTER_WAIT_OFFLINE_MS = 60000;

// F390: rejoin when the station's own match deadline or lock ends, whichever is known first.
inline bool muster_rejoin_due(bool dropped, bool lock_known, int64_t hill_ends_in_ms, uint32_t lock_remaining_s,
                              bool link_off = false) {
  (void)lock_known;
  (void)lock_remaining_s;
  return dropped && !link_off && hill_ends_in_ms == 0;
}

// ---- the link state machine ------------------------------------------------------------------
// Owns no I/O: the .ino drives every transition from a real Wi-Fi/socket event and reads back what
// to do next. §5g.4's whole point lives in one method here (`should_drop_link_at_match_start`): the
// only place "muster vs held" is allowed to matter.
class StationLink {
 public:
  LinkState state() const { return state_; }
  AssocMode mode() const { return mode_; }
  // Switching to HELD clears a muster drop: a held station must never sit behind a latch it cannot see (round 3).
  void set_mode(AssocMode m) {
    mode_ = m;
    if (m == AssocMode::HELD) { dropped_for_match_ = false; drop_pending_ = false; }
  }

  const StationIdentity& identity() const { return identity_; }
  void set_identity(const StationIdentity& id) { identity_ = id; }

  const StationAssignment& assignment() const { return assignment_; }
  const StationUpdateMsg& last_update() const { return last_update_; }
  PowerupSchedule& powerup() { return powerup_; }
  const PowerupSchedule& powerup() const { return powerup_; }
  ClaimGate& claims() { return claims_; }
  void discard_claim_batch() { claims_.resolve_batch(); }

  Backoff& backoff() { return backoff_; }

  // MC accepts `station_action` since A56 (f3fe3cf6), so the default is ON; the .ino persists the
  // choice (`ACTIONS ON|OFF`), and OFF is for an older MC that would count every one as a malformed
  // frame toward its per-socket quarantine (net.md §8). Gates only the REPORT to MC
  // (`maybe_build_reset_action`/`maybe_build_taken_action`, station_ui.h): a reset still runs its
  // local confirm flow and a claim still awards locally (the advert carries `taker`) whatever this
  // flag says.
  void set_actions_enabled(bool on) { actions_enabled_ = on; }
  bool actions_enabled() const { return actions_enabled_; }

  // ---- transitions ----
  void wifi_configured() {
    if (state_ == LinkState::NOT_CONFIGURED) state_ = LinkState::JOINING_WIFI;
  }
  void wifi_cleared() {
    state_ = LinkState::NOT_CONFIGURED;
    dropped_for_match_ = false;
    drop_pending_ = false;
  }
  void wifi_up() {
    if (state_ == LinkState::NOT_CONFIGURED || state_ == LinkState::JOINING_WIFI) {
      state_ = LinkState::LOOKING_FOR_MC;
    }
  }
  // A drop mid-match under `held` still has known credentials -- it re-joins, it does not forget
  // them. Only NOT_CONFIGURED (no SSID at all) means "nothing to join".
  void wifi_down() {
    if (state_ != LinkState::NOT_CONFIGURED) state_ = LinkState::JOINING_WIFI;
  }
  void mc_address_known() {
    if (state_ == LinkState::LOOKING_FOR_MC) state_ = LinkState::CONNECTING;
  }
  void ws_open_hello_sent() {
    if (state_ == LinkState::CONNECTING) state_ = LinkState::HELLO_SENT;
  }
  // The socket dropped from any connected state. §5g.4: never discard node_key or the current
  // assignment here -- a `held` station reconnects and re-hellos with the same identity, and even
  // `muster` keeps its last assignment until the operator changes it (a stale assignment is still
  // the truth standing on the field until told otherwise).
  void ws_closed() {
    if (state_ != LinkState::NOT_CONFIGURED && state_ != LinkState::JOINING_WIFI) {
      state_ = LinkState::LOOKING_FOR_MC;
    }
  }

  void apply_welcome(const WelcomeMsg& w) {
    if (!w.ok) return;
    if (!w.node_key.empty()) identity_.node_key = w.node_key;
    session_id_ = w.session_id;
    state_ = LinkState::WELCOMED;
    backoff_.reset();
  }

  // Polish round 1 (2026-09-24): whether SELF-SPAWN ticking and the CLAIM scan should run at all.
  // This is the PERSISTED assignment, never the link state -- state() drops to LOOKING_FOR_MC on any
  // WS hiccup, and gating on it froze the schedule on every disconnect (the exact bug SELF-SPAWN
  // exists to prevent). §5g.4 is explicit that an assignment survives a drop; this is that survival,
  // read by the glue instead of re-deriving it from link state.
  bool has_powerup_assignment() const { return assignment_.present && assignment_.kind == "powerup"; }
  // The same persisted-assignment rule for the Bluetooth stations (presence.h): a MUSTER station
  // plays its hill or counts its revives with Wi-Fi down for the whole match.
  bool has_control_assignment() const { return assignment_.present && assignment_.kind == "control"; }
  bool has_respawn_assignment() const { return assignment_.present && assignment_.kind == "respawn"; }

  // The Bluetooth hill (control.js ControlPoint) and the respawn revive count. They reset with the
  // powerup schedule, on the same rule: a new kind, id or GAME starts clean, and a same-game re-push
  // (MC's mid-match lock carrier) keeps the match going.
  BleControlPoint& hill() { return hill_; }
  const BleControlPoint& hill() const { return hill_; }
  const ReviveCounter& revives() const { return revives_; }

  // The operator's point RESET (serial RESET, the bench A hold; utility.js btnPointReset): the Bluetooth
  // hill goes back to nobody when a control station is assigned. True when there was one to reset (the
  // glue then clears the saved owner too).
  bool reset_hill() {
    if (!has_control_assignment()) return false;
    if (hill_.frozen) return false;  // keep the finished match's recap tally
    hill_.reset();
    return true;
  }

  // Bumps whenever the station becomes a DIFFERENT station: a new kind, id or game, a restore, a
  // release. A same-game re-push leaves it alone. The glue empties its sighting ring on a bump.
  uint32_t assignment_epoch() const { return epoch_; }

  // One STATION_TICK_MS step of the assigned kind's player rule, after PlayerPresence::tick. The
  // caller acts on the returned edges (the IR capture word, the screen); nothing here does I/O.
  HillUpdate tick_players(const PlayerPresence& players, uint32_t now_ms) {
    HillUpdate u;
    if (has_control_assignment()) {
      if (starts_known_ && !hill_live_ && (int32_t)(now_ms - hill_starts_ms_) >= 0 && !hill_.frozen) {
        hill_live_ = true;
        hill_.update(players, hill_starts_ms_);
      } else if (!starts_known_ && !heard_start_ && !hill_live_ && assignment_.duration_ms <= 0 &&
                 state_ == LinkState::JOINING_WIFI) {
        // A duration hill waits for its anchor instead (anchor_hill_on_advert): going live here would count the lobby.
        if (!hill_offline_waiting_) { hill_offline_waiting_ = true; hill_offline_since_ms_ = now_ms; }
        if ((uint32_t)(now_ms - hill_offline_since_ms_) >= MUSTER_WAIT_OFFLINE_MS) hill_live_ = true;
      } else if (state_ != LinkState::JOINING_WIFI) {
        hill_offline_waiting_ = false;
      }
      if (deadline_known_ && (int32_t)(now_ms - hill_deadline_ms_) >= 0) {
        if (!hill_.frozen) {
          if (hill_live_) u = hill_.update(players, hill_deadline_ms_);
          hill_.freeze();
        }
      } else if (hill_live_) {
        u = hill_.update(players, now_ms);
      }
    }
    else if (REVIVE_FEEDBACK_ENABLED && has_respawn_assignment()) revives_.update(players, assignment_.id);
    return u;
  }
  // A68 fallback anchor, fed every player advert the scan hears (any RSSI). Only the alive advert of a player
  // this Stick has already heard DOWN in this game anchors go-live: engine.js replaces `config` in a welcome
  // whatever its phase, so a phone still LIVE in the last match (it missed END) advertises alive with the NEW
  // game byte in the lobby (review 2026-09-25). A lobby phone advertises down with this game's byte, so a
  // Stick armed at MC hears every lobby player down; one that did not waits for a death and a respawn.
  bool anchor_hill_on_advert(const Advert& d, uint32_t now_ms) {
    if (!has_control_assignment() || assignment_.duration_ms <= 0 || mc_start_known_ || duration_anchor_known_ ||
        d.role != ROLE_PLAYER || d.game == 0 || d.game != assignment_.game) return false;
    const bool heard_down = std::find(heard_down_.begin(), heard_down_.end(), d.id) != heard_down_.end();
    if (!(d.state & PLAYER_ALIVE)) {
      if (!heard_down && heard_down_.size() < HEARD_DOWN_MAX) heard_down_.push_back(d.id);
      return false;
    }
    if (!heard_down) return false;
    if (hill_restore_guard_) {
      hill_restore_guard_ = false;
      duration_restore_wait_ = false;
      hill_.frozen = false;
    }
    duration_anchor_known_ = true;
    starts_known_ = true;
    hill_live_ = true;
    hill_starts_ms_ = now_ms;
    deadline_known_ = true;
    hill_deadline_ms_ = now_ms + (uint32_t)assignment_.duration_ms;
    return true;
  }
  // The ms left on a duration hill's running clock, for SavedHillClock: -1 when none runs (no duration, not
  // yet anchored or live, or a restored hill still waiting), 0 once the hill froze.
  int32_t hill_clock_remaining_ms(uint32_t now_ms) const {
    if (!has_control_assignment() || assignment_.duration_ms <= 0 || duration_restore_wait_) return -1;
    if (hill_.frozen) return 0;
    if (!deadline_known_ || !hill_live_) return -1;
    const int32_t left = (int32_t)(hill_deadline_ms_ - now_ms);
    return left > 0 ? left : 0;
  }
  // At boot, after restore_station_config: a restored duration hill resumes from its saved time left at once
  // (0 = the whistle had gone: MATCH OVER). False when there is no restored duration hill to resume.
  bool resume_hill_clock(int32_t remaining_ms, uint32_t now_ms) {
    if (!has_control_assignment() || !duration_restore_wait_ || remaining_ms < 0) return false;
    duration_restore_wait_ = false;
    hill_restore_guard_ = false;
    duration_anchor_known_ = true;
    if (remaining_ms == 0) { hill_.freeze(); return true; }
    hill_.frozen = false;
    starts_known_ = true;
    hill_live_ = true;
    hill_starts_ms_ = now_ms;
    deadline_known_ = true;
    hill_deadline_ms_ = now_ms + (uint32_t)remaining_ms;
    return true;
  }
  bool hill_ended() const { return has_control_assignment() && hill_.frozen && !duration_restore_wait_; }
  // F386 for a pickup: same rule as the hill's `hill_ended`, but for a powerup assignment -- set by
  // apply_station_config on an END/recap/RECALL (`ends_in_ms:0`) or by tick_powerup once a known match
  // deadline passes (deadline_known_/hill_deadline_ms_, the same fields the hill's own clock uses; a
  // station is only ever one kind at a time, so the two never collide). Cleared by a new game/kind/id or
  // by a config carrying a fresh START.
  bool powerup_ended() const { return has_powerup_assignment() && powerup_ended_; }
  bool hill_waiting(uint32_t now_ms) const {
    return has_control_assignment() && !hill_live_ &&
           (duration_restore_wait_ || (!hill_.frozen && (!starts_known_ || (int32_t)(now_ms - hill_starts_ms_) < 0)));
  }
  void enforce_restored_hill_freeze() {
    if (restored_ && has_control_assignment() && assignment_.timed_hill) hill_.freeze();
  }
  // ---- F365 / A67: the station's range, as applied NOW (MC's value, or a younger on-station edit) ----
  int threshold_dbm() const { return threshold_.applied(); }
  // Byte 14 drives the phone's own presence decision. Keep the prior value for an unedited hill
  // default because the Stick receives phones about 25 dB more weakly than phones receive it.
  int threshold_advertised_dbm() const {
    return assignment_.present && assignment_.kind == "control" && assignment_.threshold_defaulted &&
                   !threshold_.from_station()
               ? STICK_DEFAULT_THRESHOLD_DBM : threshold_.applied();
  }
  int tx_power_level() const { return tx_power_.applied(); }
  const SyncedSetting& threshold_setting() const { return threshold_; }
  const SyncedSetting& tx_power_setting() const { return tx_power_; }
  const RangeEditLog& range_edits() const { return edits_; }

  // The operator's edits on the RANGE screen: allowed during play only while the A58 lock is unlocked, but only with a station assigned. Each step applies at once (the
  // glue re-reads threshold_dbm()/tx_power_level() for presence, byte 14 and the radio) and is logged
  // for MC. False when nothing changed (no station, or already at the clamp).
  bool edit_threshold(int delta_db, uint32_t now_ms) {
    if (!assignment_.present || lock_.locked(now_ms)) return false;
    const int from = threshold_.applied();
    const int to = clamp_threshold_dbm(from + delta_db);
    if (to == from) return false;
    threshold_.edit_to(to, now_ms);
    edits_.add(false, from, to, lock_.locked(now_ms), now_ms);
    return true;
  }
  bool edit_tx_power(int delta_levels, uint32_t now_ms) {
    if (!assignment_.present || lock_.locked(now_ms)) return false;
    const int from = tx_power_.applied();
    const int to = clamp_tx_power(from + delta_levels);
    if (to == from) return false;
    tx_power_.edit_to(to, now_ms);
    edits_.add(true, from, to, lock_.locked(now_ms), now_ms);
    return true;
  }

  // NVS (written by the glue on each edit only): the current on-station values, tagged with the station
  // id they were made on, and the edit log with its seq. `{"id":3,"thr":-60,"tx":1,"log":{...}}`.
  std::string range_storage_body() const {
    std::string j = "{\"id\":" + std::to_string(assignment_.present ? assignment_.id : -1);
    if (threshold_.from_station()) j += ",\"thr\":" + std::to_string(threshold_.applied());
    if (tx_power_.from_station()) j += ",\"tx\":" + std::to_string(tx_power_.applied());
    return j + ",\"log\":" + edits_.storage() + "}";
  }
  // At boot, after restore_station_config: the log and its seq always come back; the edited values only
  // onto the same station id, with their age unknown (EDIT_AGE_UNKNOWN_MS), so any MC value wins later.
  bool restore_range(const std::string& body) {
    bool ok = false;
    json::Value v = json::parse(body, &ok);
    if (!ok || !v.is_object()) return false;
    const json::Value& log = v.get("log");
    if (log.is_object()) edits_.load(log);
    if (assignment_.present && v.get("id").as_int(-1) == assignment_.id) {
      if (v.has("thr")) threshold_.restore_edit(clamp_threshold_dbm((int)v.get("thr").as_int()));
      if (v.has("tx")) tx_power_.restore_edit(clamp_tx_power((int)v.get("tx").as_int()));
    }
    return true;
  }

  // A58: the operator-control lock (MatchLock, above). Read-only for the glue and the screen.
  const MatchLock& lock() const { return lock_; }
  bool poll_lock(uint32_t now_ms) { return lock_.poll(now_ms); }
  void restore_lock(uint32_t seconds, uint32_t now_ms) {
    lock_deadline_known_ = seconds > 0;
    lock_.restore(seconds, now_ms);
  }

  // Returns true when a field that changes the advert actually moved, so the caller republishes
  // only when it must (mirrors `AdvertPolicy::due`'s "first/state/progress" distinction upstream).
  // `received_at_ms` is millis() at receipt (A58): the lock counts from then. The glue must pass it;
  // the default exists only so the many older host tests that never look at the lock stay short.
  bool apply_station_config(const StationAssignment& a, uint32_t received_at_ms = 0) {
    if (!a.present) return false;
    // A58: every station_config REPLACES the running lock, before and independent of the kind/id/game
    // logic below -- a same-game re-push (MC's mid-match lock carrier) must change the lock and
    // nothing else, and lock_s 0 (or absent) unlocks at once.
    lock_.start(a.lock_s, received_at_ms);
    // Restart survival: the first MC config after a boot-time restore is MC's answer to "I am back".
    // It replaces the restored copy (with the current lock), and from here on `restored()` is false.
    bool after_restore = restored_;
    restored_ = false;
    // Polish round 1: a kind or id change is a NEW station identity, whatever it used to be --
    // powerup(8) -> control(8) -> powerup(8) must start clean, not resume the first powerup's
    // available/taker/anchor state. Team/game alone changing (the same station re-armed) does not
    // reset the schedule.
    bool kind_or_id_changed = !assignment_.present || assignment_.kind != a.kind || assignment_.id != a.id;
    // Polish round 2: the game byte moving is the muster-push edge (§5g.4) -- including the very
    // FIRST arm after boot (assignment_.present was false), since a station has no other way to
    // observe "I have just been armed for a match": there is no separate "armed but not yet live"
    // signal it ever receives. `lastGameByte`-style tracking used to live in the glue and required a
    // 0-is-never-real sentinel that excluded exactly this case.
    bool game_changed = !assignment_.present || assignment_.game != a.game;
    bool changed = kind_or_id_changed || assignment_.team != a.team || game_changed;
    // Polish round 3: a new GAME is a new match, and a match's spawn schedule starts again from first_at_s, so the
    // taker and anchor of the last match must not carry over (under MUSTER no station_update can arrive to correct it
    // before play). Only a same-game re-push (the same config sent again) keeps the schedule.
    if (kind_or_id_changed || game_changed) {
      powerup_ = PowerupSchedule();
      claims_ = ClaimGate();
      hill_.reset();
      revives_.reset();
      hill_live_ = false;
      starts_known_ = false;
      heard_start_ = false;
      hill_offline_waiting_ = false;
      hill_restore_guard_ = false;
      duration_anchor_known_ = false;
      mc_start_known_ = false;
      duration_restore_wait_ = false;
      heard_down_.clear();
      powerup_ended_ = false;
      epoch_++;
    }
    if (a.kind == "control" && a.starts_known) {
      if (a.starts_in_ms > 0 && hill_live_) hill_.reset();
      heard_start_ = true;
      mc_start_known_ = true;
      duration_anchor_known_ = false;
      duration_restore_wait_ = false;
      starts_known_ = true;
      hill_starts_ms_ = received_at_ms + (uint32_t)(int32_t)a.starts_in_ms;
      hill_live_ = a.starts_in_ms <= 0;
      hill_offline_waiting_ = false;
    } else if (a.kind == "control" && a.ends_in_ms != 0 && a.duration_ms <= 0) {
      // A same-game LOBBY or abort re-send has no match clock.
      starts_known_ = false;
      hill_live_ = false;
      hill_offline_waiting_ = false;
      if (!hill_restore_guard_) hill_.frozen = false;
    } else if (a.kind == "control" && a.duration_ms > 0) {
      // Polish round 2: MC sends a duration without a start only when no match runs (LOBBY, or an abort back to it).
      // That stops an advert anchor or a resumed clock too; the next START or down -> alive edge anchors again.
      duration_anchor_known_ = false;
      mc_start_known_ = false;
      starts_known_ = false;
      hill_live_ = false;
      hill_offline_waiting_ = false;
      if (!hill_restore_guard_) hill_.frozen = false;
    }
    if (kind_or_id_changed || game_changed || a.ends_in_ms >= 0 || a.starts_known ||
        (!a.starts_known && a.duration_ms <= 0) ||
        (a.duration_ms > 0 && !duration_anchor_known_)) {
      deadline_known_ = a.starts_known && a.ends_in_ms >= 0;
      if (deadline_known_) hill_deadline_ms_ = received_at_ms + (uint32_t)a.ends_in_ms;
    }
    if (hill_restore_guard_ && a.starts_known) {
      hill_restore_guard_ = false;
      if (a.ends_in_ms != 0) hill_.frozen = false;
    }
    if (a.ends_in_ms == 0) hill_.freeze();
    // F386 for a pickup: END/recap/RECALL (`ends_in_ms:0`) freezes the schedule into MATCH OVER, the
    // same edge the hill above reads off the same field. A config carrying a fresh START (`starts_known`)
    // is a new match clock, whatever kind the station is, so it lifts the freeze; either edge beats the
    // kind/id/game reset above, since a same-game re-push (END then a later START) must still clear it.
    if (a.kind == "powerup" && a.ends_in_ms == 0) powerup_ended_ = true;
    if (a.starts_known) powerup_ended_ = false;
    // F365: a new station (kind or id) starts from MC's values (the log stays). A new GAME alone is the
    // same station in the same place for the next match: apply_mc below decides (the age rule, or the
    // ageless changed-value guard), so a pre-match edit survives arming.
    if (kind_or_id_changed) {
      threshold_.reset();
      tx_power_.reset();
    }
    // A56 (brx5): unsent `taken` reports belong to the game they were awarded in; a new game drops them.
    if (game_changed) pending_actions_.clear();
    assignment_ = a;
    lock_deadline_known_ = a.lock_s > 0;
    assignment_.timed_hill = a.kind == "control" && (deadline_known_ || hill_.frozen || a.duration_ms > 0);
    state_ = LinkState::ASSIGNED;
    // A67: MC's range values, each through the keep-the-younger-edit rule (station_range.h).
    threshold_.apply_mc(presence_threshold_dbm(a), a.threshold_age_ms, received_at_ms);
    if (a.tx_power >= 0) tx_power_.apply_mc(a.tx_power, a.tx_power_age_ms, received_at_ms);
    if (a.kind == "powerup") {
      powerup_.apply_item(a.item);
      claims_.configure(a.id, a.game);
    }
    // The actual Wi-Fi disconnect is the glue's (it owns the radio); this only records the decision,
    // so mcLoop's reconnect logic can respect it. It stays latched until the operator's explicit
    // `clear_dropped_for_match()`. A68 can freeze the hill at the whistle, but it cannot reconnect
    // a MUSTER station for the next match.
    //
    // After a restore, the first MC config latches the MUSTER drop too, even for the SAME game: it is
    // the first arm this boot, exactly as the first-ever arm after a clean boot is. (The schedule
    // above still resets only on a kind/id/game change, so the restored station keeps playing.)
    //
    // Review round 1 (MEDIUM): after a restore, dropping the radio at once would lose MC's re-anchor
    // (the station_update MC sends right after the config), and under MUSTER nothing else could ever
    // re-anchor the restored schedule. So that one drop is DEFERRED: `take_muster_drop()` answers
    // true only once the next station_update is applied or MUSTER_DROP_DEFER_MS has passed. A powerup
    // waits longer (F374, below). Every other drop is due at once, as before.
    if ((game_changed || after_restore) && should_drop_link_at_match_start()) {
      dropped_for_match_ = true;
      drop_pending_ = true;
      drop_deferred_ = after_restore;
      // F374: a powerup keeps the radio up until MC's first station_update (sent at START) while MC is live. That
      // update is the only go-live anchor a MUSTER Stick ever gets; without it the Stick would offer its item from
      // arming, not at first_at_s. After a restore too: a reboot in LOBBY must not skip START's anchor. Once MC is
      // out of reach, take_muster_drop's offline rule below takes over.
      // A hill waits for the START config instead. Either kind uses the same offline fallback.
      drop_wait_for_update_ = a.kind == "powerup" || (a.kind == "control" && !a.starts_known);
      wait_offline_ = false;
      drop_latched_at_ms_ = received_at_ms;
    }
    if (a.kind != "powerup" && a.kind != "control") {
      drop_wait_for_update_ = false;
    }
    if (a.kind == "control" && a.starts_known) drop_wait_for_update_ = false;
    return changed;
  }

  // The glue calls this after every station_config, after every station_update, and every loop().
  // True exactly once per latched drop, when the radio should actually go down.
  bool take_muster_drop(uint32_t now_ms) {
    if (!drop_pending_ || !dropped_for_match_) return false;
    if (drop_wait_for_update_) {
      // F374 round 1: while MC is live, wait (no timeout). Once it is out of reach (a blip, or the station carried
      // out before START, as the spec's placement flow does) fall back to available at once, so phones can still
      // claim, and keep rejoining for MUSTER_WAIT_OFFLINE_MS before the drop. The limit: that item is on offer
      // before first_at_s.
      // Round 2: the clock runs only while Wi-Fi itself is down; a closed socket with Wi-Fi up (MC restarting, a
      // laptop asleep) falls back but keeps waiting, so START can still anchor the schedule.
      const bool mc_live = state_ == LinkState::WELCOMED || state_ == LinkState::ASSIGNED;
      if (mc_live) { wait_offline_ = false; return false; }
      if (has_powerup_assignment()) powerup_.assume_available_if_unknown();
      if (state_ != LinkState::JOINING_WIFI) { wait_offline_ = false; return false; }
      if (!wait_offline_) {
        wait_offline_ = true;
        wait_offline_since_ms_ = now_ms;
      }
      if ((uint32_t)(now_ms - wait_offline_since_ms_) < MUSTER_WAIT_OFFLINE_MS) return false;
      if (has_control_assignment() && !heard_start_ && assignment_.duration_ms <= 0) hill_live_ = true;
    } else if (drop_deferred_ && (uint32_t)(now_ms - drop_latched_at_ms_) < MUSTER_DROP_DEFER_MS) {
      return false;
    }
    drop_pending_ = false;
    drop_deferred_ = false;
    drop_wait_for_update_ = false;
    return true;
  }
  bool muster_drop_pending() const { return drop_pending_ && dropped_for_match_; }

  // Restart survival (Tony, 2026-09-24): apply the assignment SavedStationConfig kept in flash, at
  // boot, before the link comes up. A timed hill stays frozen until MC gives it a fresh clock.
  // What differs from a live config:
  //   - no lock in the saved config: the glue restores a game-bound NVS snapshot, capped at 120 s;
  //   - a schedule assumed available (no anchor, no taker; F374: a fresh arm starts unknown instead); if
  //     MC can reach the Stick, the station_update it sends after its config re-anchors it (under
  //     MUSTER the radio stays up for that update before it drops: MUSTER_DROP_DEFER_MS, or for a
  //     powerup until START while MC is live; take_muster_drop);
  //   - the link state is left alone: MC has not armed this Stick THIS boot, so status says
  //     armed=false until it does (the screen and the advert read the assignment, not the state);
  //   - it NEVER sets dropped_for_match. A restored muster station cannot know whether the match is
  //     still running, so it tries to rejoin Wi-Fi. If MC answers, its current config (with the
  //     remaining lock) replaces the restore, and that config latches the drop as the first arm of
  //     this boot. If MC does not answer (out of range mid-match), the station keeps playing the
  //     restored assignment and keeps retrying, which is the price of never going dark.
  bool restore_station_config(StationAssignment a) {
    if (!a.present) return false;
    a.lock_s = 0;
    lock_.clear();
    powerup_ = PowerupSchedule();
    claims_ = ClaimGate();
    hill_.reset();  // neutral here; the glue brings a saved hold back (SavedHill::restore_into, F332)
    revives_.reset();
    epoch_++;
    pending_actions_.clear();
    last_update_ = StationUpdateMsg();
    deadline_known_ = false;  // millis() deadlines cannot survive a reboot
    starts_known_ = false;
    heard_start_ = false;
    hill_live_ = false;
    hill_offline_waiting_ = false;
    hill_restore_guard_ = a.kind == "control" && a.timed_hill;
    duration_restore_wait_ = hill_restore_guard_ && a.duration_ms > 0;
    duration_anchor_known_ = false;
    mc_start_known_ = false;
    heard_down_.clear();
    powerup_ended_ = false;  // a fresh powerup schedule (assume_available below) is never restored ended
    assignment_ = a;
    if (a.kind == "control" && a.timed_hill) hill_.freeze();
    // A67: MC's saved values come back as MC's; an on-station edit is restored after this, from its own
    // NVS copy (restore_range), with its age unknown.
    threshold_.reset();
    tx_power_.reset();
    threshold_.set_mc(presence_threshold_dbm(a));
    if (a.tx_power >= 0) tx_power_.set_mc(a.tx_power);
    if (a.kind == "powerup") {
      powerup_.apply_item(a.item);
      powerup_.assume_available();
      claims_.configure(a.id, a.game);
    }
    restored_ = true;
    return true;
  }

  // True while the current assignment came from flash and MC has not sent a config since boot.
  bool restored() const { return restored_; }

  // Review round 1 (HIGH): a WELCOME from a different MC session means a restored assignment is left
  // over from an old match. Drops it back to UNASSIGNED only while restored() is true: a config MC
  // sent THIS boot is never touched. Returns true when it dropped something.
  bool drop_restored_assignment() {
    if (!restored_) return false;
    apply_release();
    return true;
  }

  const std::string& session_id() const { return session_id_; }

  // A56: applies only when it names the currently-assigned station id (a stray update for an id
  // this Stick was reassigned away from is dropped, silently -- the same discipline `on_word`'s
  // parity gate uses for a bad IR frame).
  bool apply_station_update(const StationUpdateMsg& u, uint32_t received_at_ms) {
    if (!u.present || !has_powerup_assignment() || u.id != assignment_.id) return false;
    last_update_ = u;
    last_update_at_ms_ = received_at_ms;
    powerup_.apply_update(u, received_at_ms);
    drop_deferred_ = false;  // the re-anchor landed: a deferred MUSTER drop is due now
    drop_wait_for_update_ = false;
    return true;
  }

  // SELF-SPAWN (A56): call every loop() with the current millis(), gated on `has_powerup_assignment()`
  // ONLY -- never on link state. A lost MC link must not freeze the schedule.
  // F374 round 3: in either mode, an unknown schedule with MC out of reach falls back to available (true: repaint),
  // so a station that cannot hear START is never dead; take_muster_drop does the same for a MUSTER drop.
  bool tick_powerup(uint32_t now_ms) {
    // F386 for a pickup: a known match deadline passing freezes the schedule, whether or not MC is
    // reachable to send the END config itself (deadline_known_/hill_deadline_ms_, wrap-safe as above).
    if (has_powerup_assignment() && deadline_known_ && (int32_t)(now_ms - hill_deadline_ms_) >= 0) {
      powerup_ended_ = true;
    }
    if (powerup_ended()) return false;  // countdown stopped: the screen reads MATCH OVER instead
    const bool mc_live = state_ == LinkState::WELCOMED || state_ == LinkState::ASSIGNED;
    if (!mc_live && !powerup_.known()) {
      powerup_.assume_available_if_unknown();
      return true;
    }
    return powerup_.tick(now_ms);
  }

  // A claim batch resolved to a winner (ClaimGate::resolve_batch, called by the .ino after a BLE
  // scan window): take it, if the station is still available, whatever the link state is (the same
  // "assignment survives a drop" rule as SELF-SPAWN). Polish round 2: the report to MC is only
  // ENQUEUED here, never sent -- the BLE scan-complete callback that calls this must not touch the
  // socket. `mcLoop` (or a test) drains it with `pop_pending_action`.
  bool award_claim(const ClaimWinner& w, uint32_t now_ms) {
    // F386 for a pickup: a claim after the whistle is refused -- no local award, no `taken` report
    // queued for MC. A player standing at the Stick after MATCH OVER gets nothing.
    if (!w.won || w.player_num == 0 || !powerup_.available() || powerup_ended()) return false;
    uint32_t spawn_instant = powerup_.mark_taken(w.player_num, now_ms);
    pending_actions_.push(assignment_.id, w.player_num, spawn_instant, (int64_t)now_ms);
    return true;
  }

  bool pop_pending_action(PendingTakenReport& out) { return pending_actions_.pop_front(out); }
  bool has_pending_actions() const { return !pending_actions_.empty(); }
  size_t pending_action_count() const { return pending_actions_.size(); }

  // control{cmd:"release_utility"} (§5g.7): drop to UNASSIGNED -- the nearest true equivalent of a
  // phone's BACK TO HUD, since a Stick has no HUD to return to. The Wi-Fi/MC link itself is
  // untouched: this is an arming change, not a connectivity one.
  // A58: a release also lifts the lock -- an unarmed station has nothing left to protect, and a
  // released Stick locked for up to two hours would only strand the operator.
  void apply_release() {
    // A67: an unarmed Stick has no range to hold; the edit goes (the edit LOG and its seq stay).
    threshold_.reset();
    tx_power_.reset();
    lock_.clear();
    restored_ = false;
    assignment_ = StationAssignment();
    deadline_known_ = false;
    starts_known_ = false;
    heard_start_ = false;
    last_update_ = StationUpdateMsg();
    powerup_ = PowerupSchedule();
    hill_.reset();
    revives_.reset();
    hill_live_ = false;
    hill_offline_waiting_ = false;
    hill_restore_guard_ = false;
    powerup_ended_ = false;
    // F374: a drop still waiting for START's update was never taken; with nothing armed there is nothing to wait
    // for, so cancel it rather than let a later loss of MC drop an unassigned Stick. A drop already taken stays.
    if (drop_wait_for_update_ && drop_pending_) {
      dropped_for_match_ = false;
      drop_pending_ = false;
    }
    drop_wait_for_update_ = false;
    wait_offline_ = false;
    epoch_++;
    if (state_ == LinkState::ASSIGNED) state_ = LinkState::WELCOMED;
  }

  // §5g.4: the ONE call site that decides whether MUSTER mode would drop the Wi-Fi association for
  // the match. `held` returns false and nothing about the link changes on a game-byte edge.
  bool should_drop_link_at_match_start() const { return mode_ == AssocMode::MUSTER; }

  // Polish round 2: the latch `apply_station_config` sets when a MUSTER drop just happened. While
  // true, the glue's Wi-Fi reconnect kick must NOT re-associate (or the deliberate drop is undone on
  // the very next loop() tick, which was the bug). Cleared only by the operator's explicit action
  // (documented as `LINK RECONNECT`, README "Mission Control link (H8)") -- there is no automatic
  // "match over" signal this station could observe instead.
  bool dropped_for_match() const { return dropped_for_match_; }
  // F374: the radio is actually down for the match (the latched drop was taken). A latched drop still waiting
  // for MC's station_update keeps rejoining Wi-Fi after a blip, or it could never hear that update.
  bool radio_down_for_match() const { return dropped_for_match_ && !drop_pending_; }
  void clear_dropped_for_match() { dropped_for_match_ = false; drop_pending_ = false; }
  bool automatic_rejoin_due(uint32_t now_ms, bool link_off = false) const {
    const bool hill_end = deadline_known_ && (int32_t)(now_ms - hill_deadline_ms_) >= 0;
    return muster_rejoin_due(radio_down_for_match(), lock_deadline_known_, hill_end ? 0 : -1,
                             lock_.remaining_s(now_ms), link_off);
  }

 private:
  LinkState state_ = LinkState::NOT_CONFIGURED;
  AssocMode mode_ = AssocMode::MUSTER;
  StationIdentity identity_;
  StationAssignment assignment_;
  StationUpdateMsg last_update_;
  uint32_t last_update_at_ms_ = 0;
  PowerupSchedule powerup_;
  ClaimGate claims_;
  BleControlPoint hill_;
  ReviveCounter revives_;
  uint32_t epoch_ = 0;
  PendingActionQueue pending_actions_;
  Backoff backoff_;
  bool actions_enabled_ = true;   // MC accepts station_action since A56 landed (f3fe3cf6); `ACTIONS OFF` for an older MC
  bool dropped_for_match_ = false;
  bool lock_deadline_known_ = false;
  MatchLock lock_;  // A58, the glue restores this from NVS at boot
  bool deadline_known_ = false;
  uint32_t hill_deadline_ms_ = 0;
  bool starts_known_ = false;
  bool heard_start_ = false;
  uint32_t hill_starts_ms_ = 0;
  bool hill_live_ = false;
  bool hill_restore_guard_ = false;
  bool duration_anchor_known_ = false;
  bool mc_start_known_ = false;
  bool duration_restore_wait_ = false;
  static constexpr size_t HEARD_DOWN_MAX = 64;  // player ids heard down in this game (A68 anchor guard)
  std::vector<uint16_t> heard_down_;
  bool hill_offline_waiting_ = false;
  uint32_t hill_offline_since_ms_ = 0;
  bool powerup_ended_ = false;  // F386 for a pickup: the match ended (END/deadline) while this was a powerup
  SyncedSetting threshold_{STICK_DEFAULT_THRESHOLD_DBM};  // A67
  SyncedSetting tx_power_{TX_POWER_DEFAULT};              // A67 addendum 1
  RangeEditLog edits_;                                    // A67 addendum 2
  bool restored_ = false;  // the assignment came from flash this boot (restore_station_config)
  std::string session_id_;  // the last WELCOME's session_id ("" before any)
  bool drop_pending_ = false;   // a latched MUSTER drop the glue has not performed yet
  bool drop_deferred_ = false;  // ...and it waits for the re-anchor (first config after a restore)
  bool drop_wait_for_update_ = false;  // ...or waits for MC's first station_update while MC is live (F374, a powerup)
  bool wait_offline_ = false;          // F374 round 1: MC went out of reach during that wait...
  uint32_t wait_offline_since_ms_ = 0;  // ...at this millis()
  uint32_t drop_latched_at_ms_ = 0;
};

// The NVS "range" body read at boot: absent ("", a first boot) or one that parses is usable. A body that
// exists but does not parse is treated like an unreadable namespace: that boot never writes the key, so
// a seq it cannot see is never overwritten by a lower one (brx3: seq never goes down).
inline bool range_body_usable(const std::string& body) {
  if (body.empty()) return true;
  bool ok = false;
  json::Value v = json::parse(body, &ok);
  return ok && v.is_object() && v.get("log").is_object();
}

// A67: the range half of a status beat, from the link (the glue calls this every beat). `threshold` is the
// value applied NOW; the edit ages are reported only while an on-station edit stands.
inline void fill_range_status(const StationLink& link, StatusFields& f, uint32_t now_ms) {
  const SyncedSetting& thr = link.threshold_setting();
  const SyncedSetting& tx = link.tx_power_setting();
  f.threshold = thr.applied();
  f.threshold_src = thr.src();
  f.threshold_edit_age_ms = thr.from_station() ? thr.edit_age_ms(now_ms) : -1;
  f.tx_power = tx_power_name(tx.applied());
  f.tx_power_src = tx.src();
  f.tx_power_edit_age_ms = tx.from_station() ? tx.edit_age_ms(now_ms) : -1;
  f.range_edits_json = link.range_edits().status_json(now_ms);
}

// Review round 1 (HIGH): what a WELCOME means for the saved copy. A copy from another session (or
// with no session id) is erased, and a restored assignment still standing is dropped to UNASSIGNED.
// Call after apply_welcome(). Returns true when the glue must erase the saved keys.
inline bool apply_welcome_to_saved(StationLink& link, SavedStationConfig& saved, const std::string& session_id) {
  if (!saved.stale_for(session_id)) return false;
  link.drop_restored_assignment();
  return saved.note_released();
}

}  // namespace brx
