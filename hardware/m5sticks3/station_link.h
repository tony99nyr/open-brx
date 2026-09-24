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
#include <cstdint>
#include <string>
#include <vector>

#include "brx_advert.h"
#include "json_lite.h"

namespace brx {

// ---- association mode (§5g.4) ------------------------------------------------------------------
enum class AssocMode : uint8_t {
  MUSTER = 0,  // default: join at muster, take station_config, drop the association for the match
  HELD = 1,    // join at muster and stay linked for the whole match, reconnecting per backoff
};

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
  int threshold = -58;  // dBm; parse_station_config resolves 0/absent to STICK_DEFAULT_THRESHOLD_DBM
  int game = 0;         // per-match byte; 0 = "any" (v1, unscoped)
  std::vector<int> valid_ids;
  StationItem item;  // A56, additive: absent on an older MC or a non-powerup kind
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
  int threshold = -74;
  bool live = false;    // currently advertising
  bool armed = false;   // MC has armed this station (a station_config was applied)
  int battery_pct = -1; // -1 = absent (no battery reading yet)
  bool has_control = false;
  int control_owner = 255;
  int control_progress = 0;
  bool control_contested = false;
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
         ",\"contested\":" + std::string(f.control_contested ? "true" : "false") + "}";
  }
  j += "}";
  return j;
}

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
constexpr int STICK_DEFAULT_THRESHOLD_DBM = -58;

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
  a.game = (int)body.get("game").as_int(0);
  const json::Value& ids = body.get("valid_ids");
  if (ids.is_array()) {
    for (const auto& x : ids.arr) a.valid_ids.push_back((int)x.as_int());
  }
  a.item = parse_item(body.get("item"));
  return a;
}

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
  uint8_t state = 1;
  uint8_t value = 0;
  uint8_t taker = 0;
};

class PowerupSchedule {
 public:
  bool available() const { return available_; }
  uint8_t taker() const { return taker_; }
  uint32_t anchor_ms() const { return anchor_ms_; }

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
    if (available_ || !has_anchor_) return false;
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
    if (available_ || !has_anchor_) return v;  // state 1, value 0, taker 0
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
  bool available_ = true;   // the muster default, before any report has ever arrived
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
// `claim_ready` it hears for its id, while available, at CLAIM_RSSI_FLOOR_DBM or stronger. Ties
// inside one scan batch (more than one phone reads ready in the same BLE scan window) go to the
// lower player_num; the decision is still made once per batch, not per advert, so a batch is
// resolved only after every advert in it has been observed.
constexpr int CLAIM_RSSI_FLOOR_DBM = -80;

struct ClaimWinner {
  bool won = false;
  uint8_t player_num = 0;
};

class ClaimGate {
 public:
  void configure(int station_id, int game) { station_id_ = station_id; game_ = game; }

  // Feed every player advert seen in the current scan batch. `player_num` is the claimant (1..63,
  // the advert's own `id` field), `target_station_id` is that advert's `value`. A game of 0 is
  // unscoped, matching every other game-byte check in this codebase (state.py `_game_byte`).
  void observe(int player_num, int target_station_id, int game, bool claiming, bool claim_ready,
               int rssi_dbm) {
    if (claiming) any_claiming_ = true;
    if (!claim_ready) return;
    if (target_station_id != station_id_) return;
    if (game != 0 && game_ != 0 && game != game_) return;
    if (rssi_dbm < CLAIM_RSSI_FLOOR_DBM) return;
    if (!candidate_seen_ || player_num < candidate_player_num_) {
      candidate_seen_ = true;
      candidate_player_num_ = player_num;
    }
  }

  bool any_claiming_this_batch() const { return any_claiming_; }

  // Call once at the end of a scan batch. Clears the batch's candidates either way, so the next
  // batch starts clean; a caller only awards the claim when `won` and the station is `available()`.
  ClaimWinner resolve_batch() {
    ClaimWinner w;
    if (candidate_seen_) { w.won = true; w.player_num = (uint8_t)candidate_player_num_; }
    candidate_seen_ = false;
    any_claiming_ = false;
    return w;
  }

 private:
  int station_id_ = 0, game_ = 0;
  bool candidate_seen_ = false;
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

// ---- the link state machine ------------------------------------------------------------------
// Owns no I/O: the .ino drives every transition from a real Wi-Fi/socket event and reads back what
// to do next. §5g.4's whole point lives in one method here (`should_drop_link_at_match_start`): the
// only place "muster vs held" is allowed to matter.
class StationLink {
 public:
  LinkState state() const { return state_; }
  AssocMode mode() const { return mode_; }
  // Switching to HELD clears a muster drop: a held station must never sit behind a latch it cannot see (round 3).
  void set_mode(AssocMode m) { mode_ = m; if (m == AssocMode::HELD) dropped_for_match_ = false; }

  const StationIdentity& identity() const { return identity_; }
  void set_identity(const StationIdentity& id) { identity_ = id; }

  const StationAssignment& assignment() const { return assignment_; }
  const StationUpdateMsg& last_update() const { return last_update_; }
  PowerupSchedule& powerup() { return powerup_; }
  const PowerupSchedule& powerup() const { return powerup_; }
  ClaimGate& claims() { return claims_; }

  Backoff& backoff() { return backoff_; }

  // Polish round 1 (2026-09-24): `station_action` is PROPOSED and not yet in MC's `NODE_KINDS`
  // whitelist, so every one sent today is a malformed frame MC counts toward its per-socket
  // quarantine (net.md §8, ~20/s). Default OFF, persisted by the .ino (`ACTIONS ON|OFF`). Gates only
  // the REPORT to MC (`maybe_build_reset_action`/`maybe_build_taken_action`, station_ui.h): a reset
  // still runs its local confirm flow and a claim still awards locally (the advert carries `taker`)
  // whatever this flag says.
  void set_actions_enabled(bool on) { actions_enabled_ = on; }
  bool actions_enabled() const { return actions_enabled_; }

  // ---- transitions ----
  void wifi_configured() {
    if (state_ == LinkState::NOT_CONFIGURED) state_ = LinkState::JOINING_WIFI;
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
    state_ = LinkState::WELCOMED;
    backoff_.reset();
  }

  // Polish round 1 (2026-09-24): whether SELF-SPAWN ticking and the CLAIM scan should run at all.
  // This is the PERSISTED assignment, never the link state -- state() drops to LOOKING_FOR_MC on any
  // WS hiccup, and gating on it froze the schedule on every disconnect (the exact bug SELF-SPAWN
  // exists to prevent). §5g.4 is explicit that an assignment survives a drop; this is that survival,
  // read by the glue instead of re-deriving it from link state.
  bool has_powerup_assignment() const { return assignment_.present && assignment_.kind == "powerup"; }

  // Returns true when a field that changes the advert actually moved, so the caller republishes
  // only when it must (mirrors `AdvertPolicy::due`'s "first/state/progress" distinction upstream).
  bool apply_station_config(const StationAssignment& a) {
    if (!a.present) return false;
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
    }
    // A56 (brx5): unsent `taken` reports belong to the game they were awarded in; a new game drops them.
    if (game_changed) pending_actions_.clear();
    assignment_ = a;
    state_ = LinkState::ASSIGNED;
    if (a.kind == "powerup") {
      powerup_.apply_item(a.item);
      claims_.configure(a.id, a.game);
    }
    // The actual Wi-Fi disconnect is the glue's (it owns the radio); this only records the decision,
    // so mcLoop's reconnect logic can respect it. It stays latched until the operator's explicit
    // `clear_dropped_for_match()` -- there is no wire signal a station could use to notice "the match
    // is over" on its own (§5g.2: no facts, no ring, no `result`/`control{end}` routed to it).
    if (game_changed && should_drop_link_at_match_start()) dropped_for_match_ = true;
    return changed;
  }

  // A56: applies only when it names the currently-assigned station id (a stray update for an id
  // this Stick was reassigned away from is dropped, silently -- the same discipline `on_word`'s
  // parity gate uses for a bad IR frame).
  bool apply_station_update(const StationUpdateMsg& u, uint32_t received_at_ms) {
    if (!u.present || !assignment_.present || u.id != assignment_.id) return false;
    last_update_ = u;
    last_update_at_ms_ = received_at_ms;
    powerup_.apply_update(u, received_at_ms);
    return true;
  }

  // SELF-SPAWN (A56): call every loop() with the current millis(), gated on `has_powerup_assignment()`
  // ONLY -- never on link state. A lost MC link must not freeze the schedule.
  bool tick_powerup(uint32_t now_ms) { return powerup_.tick(now_ms); }

  // A claim batch resolved to a winner (ClaimGate::resolve_batch, called by the .ino after a BLE
  // scan window): take it, if the station is still available, whatever the link state is (the same
  // "assignment survives a drop" rule as SELF-SPAWN). Polish round 2: the report to MC is only
  // ENQUEUED here, never sent -- the BLE scan-complete callback that calls this must not touch the
  // socket. `mcLoop` (or a test) drains it with `pop_pending_action`.
  bool award_claim(const ClaimWinner& w, uint32_t now_ms) {
    if (!w.won || !powerup_.available()) return false;
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
  void apply_release() {
    assignment_ = StationAssignment();
    last_update_ = StationUpdateMsg();
    powerup_ = PowerupSchedule();
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
  void clear_dropped_for_match() { dropped_for_match_ = false; }

 private:
  LinkState state_ = LinkState::NOT_CONFIGURED;
  AssocMode mode_ = AssocMode::MUSTER;
  StationIdentity identity_;
  StationAssignment assignment_;
  StationUpdateMsg last_update_;
  uint32_t last_update_at_ms_ = 0;
  PowerupSchedule powerup_;
  ClaimGate claims_;
  PendingActionQueue pending_actions_;
  Backoff backoff_;
  bool actions_enabled_ = false;
  bool dropped_for_match_ = false;
};

}  // namespace brx
