// presence.h - the Bluetooth-only station core (Tony, 2026-09-24: Stick stations are
// Bluetooth-only for the MVP; IR RECEIVE is post-MVP, F314, because the onboard receiver cannot
// hear BRX shots). Three pure parts, each a port of the phone station's own code, so a Stick and a
// phone standing at the same spot give the same answer:
//
//   PlayerPresence   app/src/beacon.js `Presence`, the player half: which players are AT the station,
//                    by smoothed RSSI against a threshold, with dwell, hysteresis and expiry.
//   BleControlPoint  app/src/control.js `ControlPoint`: the kind-5 hill, driven by the living,
//                    present players of each team. Its three advert bytes are what every HUD reads.
//                    F382: the Stick pauses the hold tally while contested; app/src/control.js:187
//                    still accrues it and needs the same change.
//   ReviveCounter    app/src/utility.js tick(): a respawn station counts a present player's alive bit
//                    going 0 -> 1 as a revive that happened here.
//
// The numbers come from the phone station, not from control.js's own class defaults where the two
// differ: utility.js builds its Presence with a 0.8 s dwell and a -74 dBm threshold (DEFAULTS), not
// beacon.js's 2 s / -62. A JS rule that is subtle is copied, not improved, and its JS line is named.
// Pure C++17, header-only; the clock is passed in so the host tests (test/test_presence.cpp) drive it.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>

#include "brx_advert.h"
#include "brx_ir.h"

namespace brx {

// ---- revive feedback: POST-MVP, off (Tony, 2026-09-24: "lets remove the revive count for now and we can
// add those post mvp") ---------------------------------------------------------------------------------
// The ONE switch. Off (the default build): a respawn Stick only advertises. It runs no player scan (which
// also ends the scan-vs-advert flicker seen at the bench, Block 9 S7), counts no revives, shows no count and
// no REDEPLOY flash, has no REDEPLOY serial command, and sends no `revives` in its status. On: all of that
// comes back unchanged. The counting code (ReviveCounter) is always compiled, and the host tests build
// once each way (mcp/tests/test_sticks3_core.py), so the post-MVP path cannot rot. Build it on with
// -DBRX_REVIVE_FEEDBACK=1.
#ifndef BRX_REVIVE_FEEDBACK
#define BRX_REVIVE_FEEDBACK 0
#endif
constexpr bool REVIVE_FEEDBACK_ENABLED = BRX_REVIVE_FEEDBACK != 0;

// ---- the phone station's numbers ------------------------------------------------------------
constexpr uint32_t PRESENCE_DWELL_MS = 800;          // utility.js DEFAULTS.dwell (arm's length, with -74)
constexpr int PRESENCE_HYSTERESIS_DB = 6;            // beacon.js Presence hysteresisDb
constexpr uint32_t PRESENCE_EXPIRY_MS = 4000;        // beacon.js Presence expiryMs
constexpr double PRESENCE_ALPHA = 0.35;              // beacon.js Presence alpha (utility.js passes 0.35 too)
constexpr int PRESENCE_DEFAULT_THRESHOLD_DBM = -74;  // utility.js DEFAULTS.threshold (the port's own default;
                                                     // a Stick station passes STICK_DEFAULT_THRESHOLD_DBM, -57)
constexpr size_t MEDIAN_SAMPLES = 3;                 // beacon.js MEDIAN_SAMPLES
constexpr int REVIVE_MARGIN_DB = 10;                 // beacon.js REVIVE_MARGIN_DB (F344)
constexpr uint32_t STATION_TICK_MS = 250;            // utility.js `setInterval(tick, 250)`
constexpr int HILL_CAPTURE_S = 10;                   // control.js DEFAULT_CAPTURE_S
constexpr int HILL_NET_CAP = 3;                      // control.js DEFAULT_NET_CAP
constexpr uint32_t HILL_MAX_STEP_MS = 1000;          // control.js MAX_STEP_MS
constexpr int HILL_NEUTRAL = TEAM_ANY;               // control.js NEUTRAL (advert byte 9 = 255)
constexpr int HILL_REFUSED_TID = 2;                  // control.js REFUSED_TID (F82)
constexpr uint8_t PLAYER_ALIVE = 1;                  // beacon.js PLAYER_STATE.alive (player advert byte 10 bit 0)
// A player number is 1..63 (the claim advert's own limit), so 64 slots never run out in a real game.
// beacon.js has no cap; a 65th distinct player is dropped and counted (`dropped()`), never overwrites one.
constexpr size_t PRESENCE_MAX_PLAYERS = 64;

// control.js claimable(): 0..3 are the four $TID teams, 4-7 are colours, 255 is "any", and 2 is
// refused (F82: a NEUTRAL grenade hill broadcasts team 2, so tid 2 can never name an owner).
inline bool hill_claimable(int tid) { return tid == 0 || tid == 1 || tid == 3; }

// Which assigned kinds run the shared player scan. `control` reads PlayerPresence all the time; `powerup` reads only its CLAIM gate, and only while the item is available, exactly as the
// pickup scan always has (so a taken item keeps the radio as quiet as before). Every other kind
// (extraction, bomb) runs no player-side rule on a Stick yet.
// `respawn` scans at a LIGHT duty (scan_window_units): at the hill's 50/100 the scan starved the Stick's
// own advert (bench 2026-09-24, Block 9 S7: a phone 3 m away saw the station go "left" at -54 dBm every
// few seconds). It scans only with REVIVE_FEEDBACK_ENABLED: the scan exists to count revives and flash
// REDEPLOY, both post-MVP, so by default a respawn Stick only advertises.
inline bool station_needs_player_scan(const std::string& kind, bool powerup_available) {
  if (kind == "control") return true;
  if (kind == "respawn") return REVIVE_FEEDBACK_ENABLED;
  if (kind == "powerup") return powerup_available;
  return false;
}

// The scan window per kind, in 0.625 ms units of a 100-unit interval. The hill needs a heavy scan
// for capture, and a pickup needs one while available so a ready claim reaches the next batch.
// A respawn only has to catch an alive bit flip.
constexpr uint16_t SCAN_WINDOW_HILL_UNITS = 50;
constexpr uint16_t SCAN_WINDOW_CLAIM_UNITS = 50;
constexpr uint16_t SCAN_WINDOW_LIGHT_UNITS = 15;
inline uint16_t scan_window_units(const std::string& kind) {
  if (kind == "control") return SCAN_WINDOW_HILL_UNITS;
  if (kind == "powerup") return SCAN_WINDOW_CLAIM_UNITS;
  return SCAN_WINDOW_LIGHT_UNITS;
}

// ---- PlayerPresence (beacon.js Presence, players only) -------------------------------------------
struct PlayerEntry {
  bool used = false;
  uint16_t id = 0;  // the player's player_num (advert bytes 6-7)
  uint8_t team = TEAM_ANY;
  uint8_t state = 0;  // bit0 alive, bit4 claiming, bit5 claim_ready
  uint8_t value = 0;
  uint8_t seq = 0;
  uint8_t game = 0;
  int threshold = 0;  // a player advert's byte 14; 0 = use the station's default
  double rssi = 0;    // the EMA
  int raw = 0;        // the last raw sample
  int samples[MEDIAN_SAMPLES] = {};  // the last MEDIAN_SAMPLES raw samples, oldest first (beacon.js e.samples)
  size_t n_samples = 0;
  uint32_t seen_at = 0;
  uint32_t age_ms = 0;
  bool present = false;
  bool above = false;  // beacon.js `sinceAbove != null`
  uint32_t since_above = 0;
};

class PlayerPresence {
 public:
  uint32_t dwell_ms = PRESENCE_DWELL_MS;
  int hysteresis_db = PRESENCE_HYSTERESIS_DB;
  uint32_t expiry_ms = PRESENCE_EXPIRY_MS;
  double alpha = PRESENCE_ALPHA;
  int default_threshold = PRESENCE_DEFAULT_THRESHOLD_DBM;
  uint8_t game = 0;  // the station's game byte; 0 = any

  // Feed every scan hit. Only ROLE_PLAYER adverts are kept: a Stick station counts players, and
  // never reads another station (beacon.js keeps both roles in one map; the station half is the
  // phone HUD's business). Returns the entry, or nullptr when the advert was ignored.
  const PlayerEntry* observe(const Advert& d, int rssi, uint32_t now) {
    if (d.role != ROLE_PLAYER) return nullptr;
    // beacon.js observe(): `if (this.game && d.game && d.game !== this.game) return null` -- a 0 on
    // either side is unscoped.
    if (game && d.game && d.game != game) return nullptr;
    PlayerEntry* e = find(d.id);
    if (!e) {
      e = free_slot();
      if (!e) { dropped_++; return nullptr; }
      *e = PlayerEntry();
      e->used = true;
      copy(*e, d);
      e->rssi = rssi;  // beacon.js: a new entry starts its EMA AT the first sample
      e->raw = rssi;
      push_sample(*e, (int)rssi);
      e->seen_at = now;
      return e;
    }
    copy(*e, d);
    e->raw = rssi;
    push_sample(*e, (int)rssi);
    e->seen_at = now;
    e->rssi = e->rssi + alpha * (rssi - e->rssi);
    return e;
  }

  static void push_sample(PlayerEntry& e, int v) {
    if (e.n_samples < MEDIAN_SAMPLES) { e.samples[e.n_samples++] = v; return; }
    for (size_t i = 1; i < MEDIAN_SAMPLES; i++) e.samples[i - 1] = e.samples[i];
    e.samples[MEDIAN_SAMPLES - 1] = v;
  }
  // beacon.js medianOf(): the lower middle of the sorted samples.
  static int median_of(const PlayerEntry& e) {
    int a[MEDIAN_SAMPLES];
    for (size_t i = 0; i < e.n_samples; i++) a[i] = e.samples[i];
    std::sort(a, a + e.n_samples);
    return e.n_samples ? a[(e.n_samples - 1) / 2] : e.raw;
  }

  // beacon.js thresholdFor(): `e.threshold || this.defaultThreshold`.
  int threshold_for(const PlayerEntry& e) const { return e.threshold ? e.threshold : default_threshold; }

  // beacon.js tick(), line for line. Unsigned subtraction keeps it wrap-safe on millis().
  void tick(uint32_t now) {
    for (auto& e : entries_) {
      if (!e.used) continue;
      e.age_ms = now - e.seen_at;
      if (now - e.seen_at > expiry_ms) {
        e.present = false;
        e.above = false;
        // beacon.js: the entry is forgotten only at twice the expiry.
        if (now - e.seen_at > 2 * expiry_ms) e = PlayerEntry();
        continue;
      }
      const int thr = threshold_for(e);
      if (e.present) {
        // Hysteresis: off only once the EMA is `hysteresis_db` BELOW the threshold (strictly).
        if (e.rssi < thr - hysteresis_db) { e.present = false; e.above = false; }
        continue;
      }
      if (e.rssi >= thr) {
        if (!e.above) { e.above = true; e.since_above = now; }
        if (now - e.since_above >= dwell_ms) e.present = true;
      } else {
        e.above = false;
      }
    }
  }

  void clear() {
    for (auto& e : entries_) e = PlayerEntry();
    dropped_ = 0;
  }

  // Read-only iteration over the used slots (order is slot order; nothing here depends on it).
  size_t capacity() const { return PRESENCE_MAX_PLAYERS; }
  const PlayerEntry& slot(size_t i) const { return entries_[i]; }
  const PlayerEntry* get(uint16_t id) const {
    for (const auto& e : entries_) if (e.used && e.id == id) return &e;
    return nullptr;
  }
  size_t count() const {
    size_t n = 0;
    for (const auto& e : entries_) if (e.used) n++;
    return n;
  }
  size_t present_count() const {
    size_t n = 0;
    for (const auto& e : entries_) if (e.used && e.present) n++;
    return n;
  }
  uint32_t dropped() const { return dropped_; }

 private:
  static void copy(PlayerEntry& e, const Advert& d) {
    e.id = d.id;
    e.team = d.team;
    e.state = d.state;
    e.value = d.value;
    e.seq = d.seq;
    e.game = d.game;
    e.threshold = d.threshold;
  }
  PlayerEntry* find(uint16_t id) {
    for (auto& e : entries_) if (e.used && e.id == id) return &e;
    return nullptr;
  }
  PlayerEntry* free_slot() {
    for (auto& e : entries_) if (!e.used) return &e;
    return nullptr;
  }
  PlayerEntry entries_[PRESENCE_MAX_PLAYERS];
  uint32_t dropped_ = 0;
};

// ---- BleControlPoint (control.js ControlPoint) ----------------------------------------------------
// What one update() did. control.js returns a list of events; a Stick needs only the edges, and at
// most one of each can happen per step (a step is clamped to HILL_MAX_STEP_MS).
struct HillUpdate {
  bool changed = false;
  bool captured = false;         // progress reached 100 for a new owner
  int captured_team = -1;
  int captured_from = -1;        // control.js `from: this.lastOwner` (-1 = null)
  bool neutralised = false;      // an owner's progress drained to 0: it LOST the point
  int neutralised_team = -1;
  int neutralised_by = -1;
  bool contested_edge = false;   // became contested this step
  bool uncontested_edge = false;
  bool refused = false;          // F82: a tid-2 player arrived (the rising edge only)
};

class BleControlPoint {
 public:
  int capture_s = HILL_CAPTURE_S;
  int net_cap = HILL_NET_CAP;
  int owner = HILL_NEUTRAL;   // the team that HOLDS it, or HILL_NEUTRAL
  int capturing = -1;         // while neutral, the team building progress up (-1 = null)
  double progress = 0;        // 0..100 for the team named by owner-or-capturing
  int last_owner = -1;
  uint32_t hold_ms[4] = {0, 0, 0, 0};  // possession per tid, for the status report (MC's recap)
  bool contested = false;
  int dir = 0;                // +1 rising, -1 falling, 0 static
  int net = 0;
  int lead = -1;
  int counts[4] = {0, 0, 0, 0};
  bool refused_seen = false;
  uint32_t captures = 0;      // every `captured` edge, for STATUS
  bool frozen = false;        // the whistle freezes the hill and its recap tally

  double rate() const { return 100.0 / capture_s; }

  // Hand the point back to nobody (utility.js resetPoint), keeping the tuning.
  void reset() {
    const int cs = capture_s, nc = net_cap;
    *this = BleControlPoint();
    capture_s = cs;
    net_cap = nc;
  }

  void freeze() { frozen = true; }

  // Restart survival (F332: the side button can still restart a locked Stick, and a restart must not
  // wipe an enemy's hold). Brings the point back HELD by `tid` at 100 with the possession tally saved at
  // the last change of hands (`hold` may be null); no conversion is carried over. A tid that cannot hold
  // a point leaves it neutral, with the tally still restored.
  void restore_held(int tid, const uint32_t* hold = nullptr) {
    reset();
    if (hold) for (int t = 0; t < 4; t++) hold_ms[t] = hold[t];
    if (!hill_claimable(tid)) return;
    owner = tid;
    progress = 100;
  }

  // control.js advert(): byte 9 the owner while held, else the team building it, else 255;
  // byte 10 held/contested/rising/falling; byte 11 Math.round(progress).
  AdvertView advert() const {
    AdvertView v;
    const bool held = owner != HILL_NEUTRAL;
    v.team = (uint8_t)(held ? owner : (capturing >= 0 ? capturing : HILL_NEUTRAL));
    uint8_t s = held ? CONTROL_HELD : 0;
    if (contested) s |= CONTROL_CONTESTED;
    if (dir > 0) s |= CONTROL_RISING;
    else if (dir < 0) s |= CONTROL_FALLING;
    v.state = s;
    v.value = (uint8_t)js_round(progress);
    v.active = true;
    return v;
  }

  // control.js update(), step for step.
  HillUpdate update(const PlayerPresence& players, uint32_t now) {
    HillUpdate out;
    if (frozen) return out;
    // F103: `elapsed` is real time and feeds possession; `dt` is clamped and feeds conversion only.
    // control.js: `Math.max(0, now - this.at)`; the signed cast gives the same 0 for a clock that
    // stepped backwards.
    uint32_t elapsed = 0;
    if (has_at_) {
      const int32_t d = (int32_t)(now - at_);
      elapsed = d > 0 ? (uint32_t)d : 0;
    }
    const uint32_t dt = elapsed < HILL_MAX_STEP_MS ? elapsed : HILL_MAX_STEP_MS;
    at_ = now;
    has_at_ = true;
    const Key before = key();

    // Who is standing here, and does it count? (control.js "who is standing here")
    for (int& c : counts) c = 0;
    int refused = 0;
    for (size_t i = 0; i < players.capacity(); i++) {
      const PlayerEntry& p = players.slot(i);
      if (!p.used || !p.present) continue;          // outside the bubble: not on the point
      if (!(p.state & PLAYER_ALIVE)) continue;      // DOWN on the point contributes nothing
      if (p.team == HILL_REFUSED_TID) { refused++; continue; }  // F82
      if (!hill_claimable(p.team)) continue;        // no team / a colour tid: no claim
      counts[p.team]++;
    }
    // F103: the refused banner is an episode: told once on the rising edge, cleared when nobody is.
    if (refused && !refused_seen) { refused_seen = true; out.refused = true; }
    else if (!refused) refused_seen = false;

    // control.js: `ranked` sorts the teams present by count, descending, ties to the LOWER tid.
    int ranked[4];
    int nr = 0;
    for (int t = 0; t < 4; t++) if (counts[t] > 0) ranked[nr++] = t;
    for (int i = 1; i < nr; i++) {  // insertion sort, stable on the ascending tid order above
      int t = ranked[i], j = i - 1;
      while (j >= 0 && counts[ranked[j]] < counts[t]) { ranked[j + 1] = ranked[j]; j--; }
      ranked[j + 1] = t;
    }
    lead = nr ? ranked[0] : -1;
    const int second = nr > 1 ? counts[ranked[1]] : 0;
    // §5d.1: the largest SINGLE other team, never the sum, clamped to net_cap.
    net = lead < 0 ? 0 : std::min(net_cap, counts[lead] - second);
    const bool now_contested = nr > 1;
    if (now_contested != contested) {
      contested = now_contested;
      if (now_contested) out.contested_edge = true;
      else out.uncontested_edge = true;
    }

    // Possession time, on the unclamped clock.
    // F382: the team tick pauses while contested, even though it keeps ownership.
    if (owner != HILL_NEUTRAL && !contested && elapsed) hold_ms[owner] += elapsed;

    // The two phases. A step that runs out of bar carries its remaining work into the next phase
    // (control.js: the tick that crossed zero used to render "RED STALLED AT 0%").
    double work = (net > 0 && dt) ? rate() * net * (dt / 1000.0) : 0;
    for (int guard = 0; work > 1e-9 && guard < 4; guard++) {
      int holder = owner != HILL_NEUTRAL ? owner : capturing;
      if (holder < 0) holder = capturing = lead;
      if (lead == holder) {  // BUILD, up to 100
        const double step = std::min(work, 100 - progress);
        progress += step;
        work -= step;
        if (progress >= 100 - 1e-9 && owner == HILL_NEUTRAL) {
          owner = holder;
          capturing = -1;
          out.captured = true;
          out.captured_team = owner;
          out.captured_from = last_owner;
          captures++;
        }
        break;  // 100 is the end of the road
      }
      const double step = std::min(work, progress);  // DRAIN, down to 0
      progress -= step;
      work -= step;
      if (progress > 1e-9) break;
      if (owner != HILL_NEUTRAL) {
        last_owner = owner;
        out.neutralised = true;
        out.neutralised_team = owner;
        out.neutralised_by = lead;
        owner = HILL_NEUTRAL;
      }
      capturing = lead;  // the contender now owns the bar, at 0, and keeps pushing
    }
    if (owner == HILL_NEUTRAL && capturing >= 0 && progress <= 1e-9 && lead != capturing) {
      capturing = -1;  // nobody is pushing an empty bar: fully neutral
    }
    // Direction is read off the state the step LEFT BEHIND (control.js: at a zero crossing the bar
    // fell and is now rising for the other team, and "rising" is the true thing to show).
    dir = 0;
    if (net > 0) {
      const int h = owner != HILL_NEUTRAL ? owner : capturing;
      if (h >= 0) dir = lead == h ? (progress < 100 ? 1 : 0) : (progress > 0 ? -1 : 0);
    }
    out.changed = !(before == key());
    return out;
  }

  // JS Math.round for the non-negative values used here.
  static long js_round(double x) { return (long)std::floor(x + 0.5); }

 private:
  // control.js `changed` compares `${owner}:${capturing}:${Math.round(progress)}:${contested}:${dir}:${net}`.
  struct Key {
    int owner, capturing;
    long pct;
    bool contested;
    int dir, net;
    bool operator==(const Key& o) const {
      return owner == o.owner && capturing == o.capturing && pct == o.pct && contested == o.contested &&
             dir == o.dir && net == o.net;
    }
  };
  Key key() const { return Key{owner, capturing, js_round(progress), contested, dir, net}; }
  bool has_at_ = false;
  uint32_t at_ = 0;
};

// ---- ReviveCounter (utility.js tick(), the `wasAlive` loop) ---------------------------------------
// A revive is a PRESENT player whose alive bit went 0 -> 1 since the last tick. utility.js remembers
// the alive bit of every player it can hear, present or not, and forgets a player the moment Presence
// forgets them. So the edge only has to be seen while the player is present: a player heard DOWN from
// across the field who arrives and comes up alive at the station counts. The rule is copied as written.
class ReviveCounter {
 public:
  uint32_t revives = 0;

  // Call after PlayerPresence::tick. Returns how many revives this step counted.
  // `station_id` (this station's id, -1 = unknown) enables the explicit signal: a player advert with
  // PLAYER_REVIVED set and value == station_id counts once per rising edge of that bit. A phone that has ever
  // shown the bit is counted ONLY that way (no double count); older phones fall back to the F344 near rule.
  uint32_t update(const PlayerPresence& players, int station_id = -1) {
    uint32_t n = 0;
    bool seen[PRESENCE_MAX_PLAYERS] = {};
    for (size_t i = 0; i < players.capacity(); i++) {
      const PlayerEntry& p = players.slot(i);
      if (!p.used) continue;
      const bool alive = (p.state & PLAYER_ALIVE) != 0;
      Known* k = find(p.id);
      // beacon.js countRevives (F344, brx5): a revive counts when the player is NEAR, not `present`: the
      // median of the last MEDIAN_SAMPLES readings at or above the threshold minus REVIVE_MARGIN_DB, with no
      // dwell. The station hears the player's medium-TX advert ~8 dB weaker, and a walk-in revive never
      // reached `present` (the Stick missed a real revive at 20:51:00Z on 2026-09-24).
      const bool fresh = p.age_ms <= players.expiry_ms;
      const bool near = fresh && PlayerPresence::median_of(p) >= players.threshold_for(p) - REVIVE_MARGIN_DB;
      const bool revived_here = station_id >= 0 && (p.state & PLAYER_REVIVED) && p.value == (uint8_t)station_id;
      const bool uses_bit = (p.state & PLAYER_REVIVED) != 0 || (k && k->uses_bit);
      if (uses_bit) {
        if (revived_here && !(k && k->revived)) { revives++; n++; }
      } else if (k && !k->alive && alive && near) {
        revives++; n++;
      }
      if (!k) k = add(p.id);
      if (k) {
        k->alive = alive;
        k->revived = revived_here;
        k->uses_bit = uses_bit;
        seen[k - known_] = true;
      }
    }
    // utility.js: `for (const id of wasAlive.keys()) if (!seen.has(id)) wasAlive.delete(id)`
    for (size_t i = 0; i < PRESENCE_MAX_PLAYERS; i++) if (known_[i].used && !seen[i]) known_[i] = Known();
    return n;
  }

  void reset() {
    revives = 0;
    for (auto& k : known_) k = Known();
  }

 private:
  struct Known {
    bool used = false;
    uint16_t id = 0;
    bool alive = false;
    bool revived = false;   // PLAYER_REVIVED with our id, last time we saw this player
    bool uses_bit = false;  // this phone speaks PLAYER_REVIVED: count only on it
  };
  Known* find(uint16_t id) {
    for (auto& k : known_) if (k.used && k.id == id) return &k;
    return nullptr;
  }
  Known* add(uint16_t id) {
    for (auto& k : known_) if (!k.used) { k.used = true; k.id = id; return &k; }
    return nullptr;
  }
  Known known_[PRESENCE_MAX_PLAYERS];
};

// ---- SightingRing: scan hits handed from the BLE task to loop() -------------------------------------
// The scan callback pushes, loop() pops on its 250 ms tick (mc_link_glue.h wraps both in a spinlock;
// this class has no locking of its own). Full: the NEWEST sighting is dropped and counted, since the
// next scan window re-hears everyone. Emptied when the assignment changes, so an old game's sightings
// never reach a new game's presence.
struct Sighting {
  Advert advert;
  int rssi = 0;
};
template <size_t N>
class SightingRing {
 public:
  bool push(const Advert& a, int rssi) {
    const size_t next = (head_ + 1) % N;
    if (next == tail_) { overflow_++; return false; }
    buf_[head_].advert = a;
    buf_[head_].rssi = rssi;
    head_ = next;
    return true;
  }
  bool pop(Sighting& out) {
    if (tail_ == head_) return false;
    out = buf_[tail_];
    tail_ = (tail_ + 1) % N;
    return true;
  }
  void clear() { head_ = tail_ = 0; }
  size_t size() const { return (head_ + N - tail_) % N; }
  uint32_t overflow() const { return overflow_; }

 private:
  Sighting buf_[N];
  size_t head_ = 0, tail_ = 0;
  uint32_t overflow_ = 0;
};

// ---- IR transmit for a Bluetooth hill ----------------------------------------------------------------
// IR TRANSMIT stays in the MVP. These build the same two words control_point.h's HILL builds
// (beacon_word / capture_word), from a Bluetooth owner: team bits = the owner, or team 2 (the neutral
// grenade's own team) when nobody holds it. test_presence.cpp pins them equal to control_point.h's.
inline Word hill_beacon_word(int owner) {
  Word w;
  w.proto = PROTO_BEACON;
  w.player = 0;
  w.team = owner == HILL_NEUTRAL ? GRENADE_NEUTRAL_TEAM : owner;
  w.mag = BEACON_HILL;
  return w;
}
inline Word hill_capture_word(int owner) {
  Word w = hill_beacon_word(owner);
  w.mag = BEACON_CAPTURED;
  return w;
}

}  // namespace brx
