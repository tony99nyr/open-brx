// presence.h - the Bluetooth-only station core (Tony, 2026-09-24: Stick stations are
// Bluetooth-only for the MVP; IR RECEIVE is post-MVP, F314, because the onboard receiver cannot
// hear BRX shots). Three pure parts, each a port of the phone station's own code, so a Stick and a
// phone standing at the same spot give the same answer:
//
//   PlayerPresence   app/src/beacon.js `Presence`, the player half: which players are AT the station,
//                    by smoothed RSSI against a threshold, with dwell, hysteresis and expiry.
//   BleControlPoint  app/src/control.js `ControlPoint`: the kind-5 hill, driven by the living,
//                    present players of each team. Its three advert bytes are what every HUD reads.
//   ReviveCounter    app/src/utility.js tick(): a respawn station counts a present player's alive bit
//                    going 0 -> 1 as a revive that happened here.
//
// The phone station uses a 0.8 s dwell and its extraction threshold from the generated phone defaults.
// beacon.js has different class defaults. The shared values live in contract.gen.h.
// Pure C++17, header-only; the clock is passed in so the host tests (test/test_presence.cpp) drive it.
#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <climits>
#include <cstdint>
#include <string>

#include "contract.gen.h"
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
constexpr uint32_t PRESENCE_DWELL_MS = contract::PRESENCE_DWELL_MS;
// F440 (Tony, 2026-10-02): 3 dB, not 6, so the circle is nearly the same size in and out; the exit grace absorbs
// the dips. beacon.js EXIT_BAND_DB.
constexpr int PRESENCE_HYSTERESIS_DB = contract::PRESENCE_EXIT_BAND_DB;
constexpr uint32_t PRESENCE_EXPIRY_MS = contract::PRESENCE_EXPIRY_MS;
// F440 (Tony 2026-10-02, "a minimum threshold and you are in the circle"): leaving is debounced. A PRESENT player
// leaves only after the EMA has stayed below the exit level this long, so a dip is not a step out. beacon.js EXIT_GRACE_MS.
// P-M2 (review 2026-10-03): 4 s, was 2.5 s, so body shadowing (about 12 dB for 2-5 s) does not drop a standing player.
constexpr uint32_t PRESENCE_EXIT_GRACE_MS = contract::PRESENCE_EXIT_GRACE_MS;
// F440: a credible sighting (the window median below, at or above the threshold) keeps a player "in the circle"
// this long. Staying in otherwise comes from `present`. beacon.js SIGHT_MS.
constexpr uint32_t PRESENCE_SIGHT_MS = contract::PRESENCE_SIGHT_MS;
// F440: a sighting is the MEDIAN of the adverts heard in the last PRESENCE_SIGHT_WINDOW_MS at or above the threshold
// (beacon.js SIGHT_WINDOW_MS): the same circle edge for a dense and a sparse advertiser. SIGHT_RECENT_MAX bounds it.
constexpr uint32_t PRESENCE_SIGHT_WINDOW_MS = contract::PRESENCE_SIGHT_WINDOW_MS;
constexpr size_t SIGHT_RECENT_MAX = contract::PRESENCE_SIGHT_RECENT_MAX;
// F452(b): when the window is full it is bounded near-evenly across time, never trimmed from the old end (the memory cap
// only: what the window says is `time_weighted_median` below). The sample whose
// two neighbours are closest together (smallest t[i+1] - t[i-1]) goes, never the oldest and never the newest; among
// equal spans the one nearest the middle of the list (the lower index on a tie), so removals spread across the window.
// The window still spans PRESENCE_SIGHT_WINDOW_MS at any advert rate; a steady stream is thinned only above 32 adverts a
// second (SIGHT_RECENT_MAX / PRESENCE_SIGHT_WINDOW_MS). Returns the index to remove from t[0..n), n >= 3.
// beacon.js `thinWindow` is the twin; the signed difference keeps it wrap-safe on millis().
inline size_t sight_thin_index(const uint32_t* t, size_t n) {
  int32_t best = INT32_MAX;
  for (size_t i = 1; i + 1 < n; i++) { const int32_t s = (int32_t)(t[i + 1] - t[i - 1]); if (s < best) best = s; }
  size_t at = 0;
  size_t at_dist2 = 0;  // 2 * |i - mid|, kept integral: 2i - (n - 1)
  for (size_t i = 1; i + 1 < n; i++) {
    if ((int32_t)(t[i + 1] - t[i - 1]) != best) continue;
    const long d = (long)(2 * i) - (long)(n - 1);
    const size_t d2 = (size_t)(d < 0 ? -d : d);
    if (at == 0 || d2 < at_dist2) { at = i; at_dist2 = d2; }
  }
  return at;
}

// F452(b): the TIME-WEIGHTED median of a sighting window (beacon.js `timeWeightedMedian` is the twin). Each sample speaks
// for the time it covers, not as one vote: a burst cannot outvote a longer stretch of one signal, so every advert rate
// reads the same level. A sample covers from the midpoint with its predecessor to the midpoint with its successor. The two
// ends are treated alike: the OLDEST covers from its own time (clipped to the window start, now - the window length) and
// the NEWEST up to now, so no cover leaves [now - window, now] and no sample is credited with time before it or after now
// (a newest cover that ran past now, or an oldest one that began before its own time, gave an end sample a half gap more
// than the window had seen: an advantage for a sparse phone, whose window holds two samples). At an observe (now = its own
// t) the newest covers half a gap; at a later tick it holds its level until now. A tie falls to the lower rssi, as the
// lower middle does. The result is the lowest rssi whose cumulative
// cover reaches half the total (the lower middle); one sample is that sample; a zero total falls back to the plain lower middle. Arithmetic is on 2x integer milliseconds relative to `now`
// (exact, wrap-safe), so it matches beacon.js bit for bit. n samples oldest first, 1 <= n <= SIGHT_RECENT_MAX.
//
// COST per call at n = 64 (F452 bench check on the ESP32): weights 64 (3 subtractions each), an insertion sort of 64 index
// pairs by rssi (about 64*63/4 = 1000 compare-and-moves on average, 2016 worst), then one cumulative scan of at most 64.
// About 1.3k simple integer operations per insert, and the same per PRESENT player per 250 ms tick (the exit level).
// A sorted copy is not kept between calls on purpose: measure first (bench), then decide whether it needs one.
inline int time_weighted_median(const uint32_t* t, const int* rssi, size_t n, uint32_t now, uint32_t window_ms) {
  if (n == 1) return rssi[0];
  long long u[SIGHT_RECENT_MAX];
  long long w[SIGHT_RECENT_MAX];
  size_t order[SIGHT_RECENT_MAX];
  for (size_t i = 0; i < n; i++) u[i] = (int32_t)(t[i] - now);
  const long long ws2 = -2LL * (long long)window_ms;
  w[0] = (u[0] + u[1]) - std::max(ws2, 2 * u[0]);  // the oldest covers from its own time, never from before it
  for (size_t i = 1; i + 1 < n; i++) w[i] = u[i + 1] - u[i - 1];
  w[n - 1] = 0 - (u[n - 2] + u[n - 1]);  // the newest covers from the midpoint to now, never past it
  long long total = 0;
  for (size_t i = 0; i < n; i++) { if (w[i] < 0) w[i] = 0; total += w[i]; }
  for (size_t i = 0; i < n; i++) {  // insertion sort of indices by rssi, stable
    size_t j = i;
    while (j > 0 && rssi[order[j - 1]] > rssi[i]) { order[j] = order[j - 1]; j--; }
    order[j] = i;
  }
  if (total <= 0) return rssi[order[(n - 1) / 2]];  // the plain lower middle, as beacon.js medianOf
  long long cum = 0;
  for (size_t k = 0; k < n; k++) { cum += w[order[k]]; if (2 * cum >= total) return rssi[order[k]]; }
  return rssi[order[n - 1]];
}
constexpr double PRESENCE_ALPHA = contract::PRESENCE_ALPHA;
constexpr double PRESENCE_ALPHA_REF_MS = contract::PRESENCE_ALPHA_REF_MS;  // F452(c): the advert period alpha was tuned at
constexpr double PRESENCE_ALPHA_DT_CAP_MS = contract::PRESENCE_ALPHA_DT_CAP_MS;  // F452(c): the longest gap the EMA credits
constexpr int PRESENCE_DEFAULT_THRESHOLD_DBM = contract::STATION_DEFAULT_THRESHOLD_DBM_PHONE_EXTRACTION;
constexpr size_t MEDIAN_SAMPLES = contract::PRESENCE_MEDIAN_SAMPLES;
constexpr int REVIVE_MARGIN_DB = contract::REVIVE_MARGIN_DB;
constexpr uint32_t STATION_TICK_MS = contract::STATION_TICK_MS;
constexpr int HILL_CAPTURE_S = contract::HILL_CAPTURE_S;
constexpr int HILL_NET_CAP = contract::HILL_NET_CAP;
constexpr uint32_t HILL_MAX_STEP_MS = contract::HILL_MAX_STEP_MS;
constexpr int HILL_NEUTRAL = contract::STATION_TEAM_ANY;
constexpr int HILL_REFUSED_TID = contract::HILL_REFUSED_TID;
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
  bool below = false;  // F440: beacon.js `belowSince != null`
  uint32_t below_since = 0;
  int level = 0;         // F452(b) round 3: beacon.js `e.level`, the time-weighted median as of the last advert
  bool sighted = false;  // F440: beacon.js `sightedAt != null`
  uint32_t sighted_at = 0;
  uint32_t recent_t[SIGHT_RECENT_MAX] = {};  // F440: beacon.js `e.recent`, oldest first
  int recent_rssi[SIGHT_RECENT_MAX] = {};
  size_t n_recent = 0;
  bool in_circle = false;  // F440: beacon.js `inCircle`: present, or a credible sighting within sight_ms
};

class PlayerPresence {
 public:
  uint32_t dwell_ms = PRESENCE_DWELL_MS;
  int hysteresis_db = PRESENCE_HYSTERESIS_DB;
  uint32_t expiry_ms = PRESENCE_EXPIRY_MS;
  uint32_t exit_grace_ms = PRESENCE_EXIT_GRACE_MS;
  uint32_t sight_ms = PRESENCE_SIGHT_MS;
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
      stamp_sighting(*e, rssi, now);
      return e;
    }
    copy(*e, d);
    e->raw = rssi;
    push_sample(*e, (int)rssi);
    // F452(c) (Tony 2026-10-04, option C): the entry EMA is TIME-based, as beacon.js: the weight for the time dt since this entry's
    // last advert is 1 - (1 - alpha)^(min(dt, PRESENCE_ALPHA_DT_CAP_MS) / PRESENCE_ALPHA_REF_MS), alpha at the nominal 250 ms
    // period. The cap stops a sparse phone's single advert from replacing the EMA (which would admit its noise). The tick-based
    // dwell (since_above) needs no change: it already counts real time above the threshold.
    const int32_t gap = (int32_t)(now - e->seen_at);
    const double dt = gap < 0 ? 0.0 : (gap > (int32_t)expiry_ms ? (double)expiry_ms : (double)gap);
    const double a = 1.0 - std::pow(1.0 - alpha, std::min(dt, PRESENCE_ALPHA_DT_CAP_MS) / PRESENCE_ALPHA_REF_MS);
    e->seen_at = now;
    e->rssi = e->rssi + a * (rssi - e->rssi);
    stamp_sighting(*e, rssi, now);
    return e;
  }

  // F440 (beacon.js inCircleNow): present, or a credible sighting within sight_ms.
  bool in_circle_now(const PlayerEntry& e, uint32_t now) const {
    return e.present || (e.sighted && now - e.sighted_at <= sight_ms);
  }
  // F440 (beacon.js observe): the median of the adverts in the last PRESENCE_SIGHT_WINDOW_MS, at or above the threshold
  // (a full window thinned evenly across time, F452(b)).
  void stamp_sighting(PlayerEntry& e, int rssi, uint32_t now) const {
    size_t keep = 0;
    for (size_t i = 0; i < e.n_recent; i++) {
      if (now - e.recent_t[i] < PRESENCE_SIGHT_WINDOW_MS) { e.recent_t[keep] = e.recent_t[i]; e.recent_rssi[keep] = e.recent_rssi[i]; keep++; }
    }
    e.n_recent = keep;
    if (e.n_recent == SIGHT_RECENT_MAX) {  // full: thin evenly across time (F452(b)), the new sample being the newest of 65
      uint32_t t[SIGHT_RECENT_MAX + 1];
      for (size_t i = 0; i < e.n_recent; i++) t[i] = e.recent_t[i];
      t[e.n_recent] = now;
      const size_t drop = sight_thin_index(t, e.n_recent + 1);  // 1..n_recent-1: an existing, never the oldest or the new one
      for (size_t i = drop + 1; i < e.n_recent; i++) { e.recent_t[i - 1] = e.recent_t[i]; e.recent_rssi[i - 1] = e.recent_rssi[i]; }
      e.n_recent--;
    }
    e.recent_t[e.n_recent] = now;
    e.recent_rssi[e.n_recent] = rssi;
    e.n_recent++;
    // F452(b) round 3: the level is computed here, at the advert's own time, and exit_level reads it (read at tick time the
    // newest advert would cover up to now while the oldest starts at its own time, so the exit time would depend on advert rate).
    e.level = time_weighted_median(e.recent_t, e.recent_rssi, e.n_recent, now, PRESENCE_SIGHT_WINDOW_MS);
    const int med = e.level;
    if (med >= threshold_for(e)) { e.sighted = true; e.sighted_at = now; }
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

  // beacon.js tick() `exitLevel`: the stored time-weighted level of the last advert (F452(b) round 3, set in stamp_sighting)
  // while that advert is inside the last PRESENCE_SIGHT_WINDOW_MS, else the last raw sample.
  static int exit_level(const PlayerEntry& e, uint32_t now) {
    if (e.n_recent > 0 && now - e.recent_t[e.n_recent - 1] < PRESENCE_SIGHT_WINDOW_MS) return e.level;
    return e.raw;
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
        e.below = false;
        e.in_circle = false;
        // beacon.js: the entry is forgotten only at twice the expiry.
        if (now - e.seen_at > 2 * expiry_ms) e = PlayerEntry();
        continue;
      }
      const int thr = threshold_for(e);
      if (e.present) {
        // Hysteresis: off only once the exit level is `hysteresis_db` BELOW the threshold (strictly), and (F440) has
        // stayed there `exit_grace_ms`: a dip is not a step out of the circle. Round 2 (review 2026-10-04): the exit
        // level is the median of the last PRESENCE_SIGHT_WINDOW_MS of raw samples (the last raw sample when the window
        // is empty), not the EMA, whose per-advert alpha lags on a sparse phone. beacon.js `exitLevel`.
        if (exit_level(e, now) < thr - hysteresis_db) {
          if (!e.below) { e.below = true; e.below_since = now; }
          if (now - e.below_since >= exit_grace_ms) { e.present = false; e.above = false; e.below = false; }
        } else {
          e.below = false;
        }
        e.in_circle = in_circle_now(e, now);
        continue;
      }
      if (e.rssi >= thr) {
        if (!e.above) { e.above = true; e.since_above = now; }
        if (now - e.since_above >= dwell_ms) e.present = true;
      } else {
        e.above = false;
      }
      e.in_circle = in_circle_now(e, now);
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
      if (!p.used || !(p.present || p.in_circle)) continue;  // F440: outside the circle: not on the point
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
        if (progress >= 100 - 1e-9) progress = 100;  // F456: control.js, so a capture is never left reading rising
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
      if (progress <= 1e-9) progress = 0;  // F456: the same at the bottom
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
  uint32_t seen_at = 0;
};
template <size_t N>
class SightingRing {
 public:
  bool push(const Advert& a, int rssi, uint32_t seen_at = 0) {
    const size_t next = (head_ + 1) % N;
    if (next == tail_) { overflow_++; return false; }
    buf_[head_].advert = a;
    buf_[head_].rssi = rssi;
    buf_[head_].seen_at = seen_at;
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
