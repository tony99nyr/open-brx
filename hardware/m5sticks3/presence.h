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
#include <cstdio>
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
// F440 (Tony, 2026-10-02): 3 dB, not 6, so the circle is nearly the same size in and out; the exit grace absorbs
// the dips. beacon.js EXIT_BAND_DB.
// F440 (Tony 2026-10-02, "a minimum threshold and you are in the circle"): leaving is debounced. A PRESENT player
// leaves only after the EMA has stayed below the exit level this long, so a dip is not a step out. beacon.js EXIT_GRACE_MS.
// P-M2 (review 2026-10-03): 4 s, was 2.5 s, so body shadowing (about 12 dB for 2-5 s) does not drop a standing player.
// F440: a credible sighting (the window median below, at or above the threshold) keeps a player "in the circle"
// this long. Staying in otherwise comes from `present`. beacon.js SIGHT_MS.
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
// KEPT aliases: the narrowed type matters at the use (double division and std::min; size_t array bounds and loop
// counters; uint32_t millisecond arithmetic), and a contract int32_t would change the result or add a sign-compare warning.
// contract::PRESENCE_ALPHA_REF_MS: F452(c): the advert period alpha was tuned at
constexpr double PRESENCE_ALPHA_DT_CAP_MS = contract::PRESENCE_ALPHA_DT_CAP_MS;  // F452(c): the longest gap the EMA credits
constexpr size_t MEDIAN_SAMPLES = contract::PRESENCE_MEDIAN_SAMPLES;
// A player number is 1..63 (the claim advert's own limit), so 64 slots never run out in a real game.
// beacon.js has no cap; a 65th distinct player is dropped and counted (`dropped()`), never overwrites one.
constexpr size_t PRESENCE_MAX_PLAYERS = (size_t)contract::MAX_PLAYERS + 1;   // seams D: numbers 0..MAX_PLAYERS (63), so 64 slots
static_assert(PRESENCE_MAX_PLAYERS == 64, "one slot per 6-bit player number");

// control.js claimable(): 0..3 are the four $TID teams, 4-7 are colours, 255 is "any", and 2 is
// refused (F82: a NEUTRAL grenade hill broadcasts team 2, so tid 2 can never name an owner).
inline bool hill_claimable(int tid) {
  for (size_t i = 0; i < contract::HILL_CLAIMABLE_TIDS_COUNT; i++)
    if (contract::HILL_CLAIMABLE_TIDS[i] == tid) return true;
  return false;
}

// Which assigned kinds run the shared player scan. `control` and `powerup` read PlayerPresence all the time (a powerup
// also feeds its CLAIM gate). Every other kind
// (extraction, bomb) runs no player-side rule on a Stick yet.
// `respawn` scans at a LIGHT duty (scan_window_units): at the hill's 50/100 the scan starved the Stick's
// own advert (bench 2026-09-24, Block 9 S7: a phone 3 m away saw the station go "left" at -54 dBm every
// few seconds). It scans only with REVIVE_FEEDBACK_ENABLED: the scan exists to count revives and flash
// REDEPLOY, both post-MVP, so by default a respawn Stick only advertises.
// F658: a powerup now scans all the time, taken or not: it follows the players' live game (a new game must reach it
// while its item is taken), so it reads PlayerPresence as a hill does. `powerup_available` no longer gates it.
inline bool station_needs_player_scan(const std::string& kind, bool powerup_available) {
  (void)powerup_available;
  if (kind == "control") return true;
  if (kind == "respawn") return REVIVE_FEEDBACK_ENABLED;
  if (kind == "powerup") return true;
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
  uint16_t id = 0;  // the player's player_num (advert byte 7; A86)
  uint8_t team = contract::STATION_TEAM_ANY;
  uint8_t state = 0;  // bit0 alive, bit4 claiming, bit5 claim_ready
  uint8_t value = 0;
  uint8_t seq = 0;
  uint8_t game = 0;
  uint8_t scope_kinds = 0;  // A86: the advert's scope kind mask (byte 8)
  uint16_t scope = 0;       // A86: the advert's station-id map (bytes 6 and 15), bit (id % 16)
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
  // C.7 (Tony 2026-10-16, "to cap you have to be close, to contest you can be at edge"): beacon.js `fading`, PRESENT with
  // the exit level under the band for fade_after_ms or more (inside the exit grace; a shorter dip is not fading). A fading
  // player still contests, but builds no capture.
  bool fading = false;
};

class PlayerPresence {
 public:
  uint32_t dwell_ms = contract::PRESENCE_DWELL_MS;
  int hysteresis_db = contract::PRESENCE_EXIT_BAND_DB;
  uint32_t expiry_ms = contract::PRESENCE_EXPIRY_MS;
  uint32_t exit_grace_ms = contract::PRESENCE_EXIT_GRACE_MS;
  uint32_t fade_after_ms = contract::PRESENCE_FADE_AFTER_MS;  // C.7 softer variant: beacon.js `fadeAfterMs`
  uint32_t sight_ms = contract::PRESENCE_SIGHT_MS;
  double alpha = contract::PRESENCE_ALPHA;
  int default_threshold = contract::STATION_DEFAULT_THRESHOLD_DBM_PHONE_EXTRACTION;
  uint8_t game = 0;  // the station's game byte; 0 = any
  // F658 (beacon.js `keyByGame`): a following hill hears every game, so one player number in two games is two entries.
  bool key_by_game = false;

  // Feed every scan hit. Only player-role adverts are kept: a Stick station counts players, and
  // never reads another station (beacon.js keeps both roles in one map; the station half is the
  // phone HUD's business). Returns the entry, or nullptr when the advert was ignored.
  const PlayerEntry* observe(const Advert& d, int rssi, uint32_t now) {
    if (d.role != contract::ADVERT_ROLE_PLAYER) return nullptr;
    // beacon.js observe(): `if (this.game && d.game && d.game !== this.game) return null` -- a 0 on
    // either side is unscoped.
    if (game && d.game && d.game != game) return nullptr;
    PlayerEntry* e = find(d.id, d.game);
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
    const double a = 1.0 - std::pow(1.0 - alpha, std::min(dt, PRESENCE_ALPHA_DT_CAP_MS) / contract::PRESENCE_ALPHA_REF_MS);
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
        e.fading = false;
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
        e.fading = e.present && e.below && now - e.below_since >= fade_after_ms;  // beacon.js, after the grace check
        e.in_circle = in_circle_now(e, now);
        continue;
      }
      e.fading = false;
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
    e.scope_kinds = d.scope_kinds;
    e.scope = d.scope;
    e.threshold = d.threshold;
  }
  PlayerEntry* find(uint16_t id, uint8_t g) {
    for (auto& e : entries_) if (e.used && e.id == id && (!key_by_game || e.game == g)) return &e;
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
// most one of each can happen per step (a step is clamped to contract::HILL_MAX_STEP_MS).
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

// F658 (control.js HillFollower): which heard players the point may count. Following: only live-bit players of the
// followed game. Not following (only old phones heard): the MC-armed game's players, 0 on either side = any game.
// A86: never a player outside its scope (the control kind bit and this station's id bit); a zero scope never counts.
struct HillFilter {
  bool follows = false;
  uint8_t game = 0;   // the followed game byte
  uint8_t armed = 0;  // the MC-armed game byte (0 = any)
  int station_id = 0; // A86: this control station's id (0 = unassigned: counts nobody)
  bool counts(const PlayerEntry& p) const {
    if (!in_scope(p.scope_kinds, p.scope, contract::ADVERT_SCOPE_KIND_CONTROL, station_id)) return false;
    if (follows) return (p.state & contract::ADVERT_PLAYER_STATE_LIVE) && p.game == game;
    return !armed || !p.game || p.game == armed;
  }
};

// F658: one game's point state while another game is current (control.js snapshot(): progress kept to 0.1).
struct HillSnap {
  int owner = contract::STATION_TEAM_ANY;
  int capturing = -1;
  double progress = 0;
  int last_owner = -1;
  uint32_t hold_ms[4] = {0, 0, 0, 0};
  uint32_t own_ms[4] = {0, 0, 0, 0};  // the owned clock (Domination), control.js `ownMs`
  bool contested = false;
  int dir = 0;
  uint32_t captures = 0;
};

class BleControlPoint {
 public:
  int capture_s = contract::HILL_CAPTURE_S;
  int net_cap = contract::HILL_NET_CAP;
  int decay_s = contract::HILL_DECAY_S;
  uint32_t decay_delay_ms = contract::HILL_DECAY_DELAY_MS;  // F464 option 1
  uint32_t absent_ms = 0;     // F464: real time with nobody counted on the point (reset() and a restore start it at 0)
  int owner = contract::STATION_TEAM_ANY;   // the team that HOLDS it, or STATION_TEAM_ANY
  int capturing = -1;         // while neutral, the team building progress up (-1 = null)
  double progress = 0;        // 0..100 for the team named by owner-or-capturing
  int last_owner = -1;
  uint32_t hold_ms[4] = {0, 0, 0, 0};  // possession per tid, for the status report (MC's recap)
  // The owned clock (Domination), control.js `ownMs`: per tid, banks while that tid OWNS the point, contested or not,
  // with or without a body on it; stops when the point drains to neutral.
  uint32_t own_ms[4] = {0, 0, 0, 0};
  int owned_by = -1;          // control.js `ownedBy`: the owner the last update left, or -1
  bool contested = false;
  int held_by = -1;           // F554: the team counted ALONE on the point at the last update (control.js `heldBy`), or -1
  int dir = 0;                // +1 rising, -1 falling, 0 static
  int net = 0;
  int lead = -1;
  int counts[4] = {0, 0, 0, 0};
  bool refused_seen = false;
  uint32_t captures = 0;      // every `captured` edge, for STATUS
  bool frozen = false;        // the whistle freezes the hill and its recap tally

  double rate() const { return 100.0 / capture_s; }
  double decay_rate() const { return 100.0 / decay_s; }  // F464

  // Hand the point back to nobody (utility.js resetPoint), keeping the tuning.
  void reset() {
    const int cs = capture_s, nc = net_cap, ds = decay_s;
    const uint32_t dd = decay_delay_ms;
    *this = BleControlPoint();
    capture_s = cs;
    net_cap = nc;
    decay_s = ds;
    decay_delay_ms = dd;
  }

  void freeze() { frozen = true; }

  // F658: control.js snapshot() for the tally ring.
  HillSnap snap() const {
    HillSnap s;
    s.owner = owner;
    s.capturing = capturing;
    s.progress = js_round(progress * 10) / 10.0;
    s.last_owner = last_owner;
    for (int t = 0; t < 4; t++) s.hold_ms[t] = hold_ms[t];
    for (int t = 0; t < 4; t++) s.own_ms[t] = own_ms[t];
    s.contested = contested;
    s.dir = dir;
    s.captures = captures;
    return s;
  }
  // F658: control.js restore() through HillFollower's loadPoint: a saved game's state (null = a fresh, neutral point),
  // keeping the tuning, with the clock restarted, nothing counted and no freeze.
  void load(const HillSnap* s) {
    reset();
    if (!s) return;
    owner = (s->owner == contract::STATION_TEAM_ANY || hill_claimable(s->owner)) ? s->owner : contract::STATION_TEAM_ANY;
    capturing = s->capturing >= 0 && hill_claimable(s->capturing) ? s->capturing : -1;
    progress = std::max(0.0, std::min(100.0, s->progress));
    last_owner = s->last_owner >= 0 && hill_claimable(s->last_owner) ? s->last_owner : -1;
    for (int t = 0; t < 4; t++) hold_ms[t] = s->hold_ms[t];
    for (int t = 0; t < 4; t++) own_ms[t] = s->own_ms[t];
    contested = s->contested;
    dir = (s->dir == 1 || s->dir == -1) ? s->dir : 0;
    captures = s->captures;
    if (owner != contract::STATION_TEAM_ANY) capturing = -1;
    else if (capturing < 0) progress = 0;
  }
  // F593: lift a freeze and restart the clock, so the first step back banks none of the time the point stood frozen
  // (utility.js `applyHillClock`). A point that is not frozen keeps its clock.
  void thaw() {
    if (!frozen) return;
    frozen = false;
    has_at_ = false;
    held_by = -1;
  }

  // Restart survival (F332: the side button can still restart a locked Stick, and a restart must not
  // wipe an enemy's hold). Brings the point back HELD by `tid` at 100 with the possession tally saved at
  // the last change of hands (`hold` and `own` may be null); no conversion is carried over. A tid that cannot hold
  // a point leaves it neutral, with the tally still restored.
  void restore_held(int tid, const uint32_t* hold = nullptr, const uint32_t* own = nullptr) {
    reset();
    if (hold) for (int t = 0; t < 4; t++) hold_ms[t] = hold[t];
    if (own) for (int t = 0; t < 4; t++) own_ms[t] = own[t];   // F658: the owned clock survives too
    if (!hill_claimable(tid)) return;
    owner = tid;
    progress = 100;
  }

  // control.js advert(): byte 9 the owner while held, else the team building it, else 255;
  // byte 10 held/contested/rising/falling; byte 11 Math.round(progress).
  AdvertView advert() const {
    AdvertView v;
    const bool held = owner != contract::STATION_TEAM_ANY;
    v.team = (uint8_t)(held ? owner : (capturing >= 0 ? capturing : contract::STATION_TEAM_ANY));
    uint8_t s = held ? contract::ADVERT_CONTROL_STATE_HELD : 0;
    if (contested) s |= contract::ADVERT_CONTROL_STATE_CONTESTED;
    if (dir > 0) s |= contract::ADVERT_CONTROL_STATE_RISING;
    else if (dir < 0) s |= contract::ADVERT_CONTROL_STATE_FALLING;
    v.state = s;
    v.value = (uint8_t)js_round(progress);
    v.active = true;
    return v;
  }

  // control.js update(), step for step.
  HillUpdate update(const PlayerPresence& players, uint32_t now, const HillFilter* filter = nullptr) {
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
    const uint32_t dt = std::min<uint32_t>(elapsed, contract::HILL_MAX_STEP_MS);  // unsigned, like elapsed
    at_ = now;
    has_at_ = true;
    const Key before = key();

    // Who is standing here, and does it count? (control.js "who is standing here")
    for (int& c : counts) c = 0;
    int cap_counts[4] = {0, 0, 0, 0};  // C.7 (control.js `capCounts`): the same players minus the fading ones
    int refused = 0;
    for (size_t i = 0; i < players.capacity(); i++) {
      const PlayerEntry& p = players.slot(i);
      if (!p.used || !(p.present || p.in_circle)) continue;  // F440: outside the circle: not on the point
      if (filter && !filter->counts(p)) continue;              // F658: another game, or not live while following
      if (!(p.state & contract::ADVERT_PLAYER_STATE_ALIVE)) continue;      // DOWN on the point contributes nothing
      if (p.team == contract::HILL_REFUSED_TID) { refused++; continue; }  // F82
      if (!hill_claimable(p.team)) continue;        // no team / a colour tid: no claim
      counts[p.team]++;
      if (!p.fading) cap_counts[p.team]++;
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
    if (lead < 0) absent_ms += elapsed; else absent_ms = 0;  // F464: control.js `absentMs`
    const int second = nr > 1 ? counts[ranked[1]] : 0;
    // §5d.1: the largest SINGLE other team, never the sum, clamped to net_cap. C.7 (Tony 2026-10-16, "to cap you have to be
    // close, to contest you can be at edge"): the lead's FADING players build nothing, but every counted player contests,
    // so `second`, the lead and the decay still read `counts`. Clamped at 0: a fading lead never drains its own point.
    net = lead < 0 ? 0 : std::max(0, std::min(net_cap, cap_counts[lead] - second));
    const bool now_contested = nr > 1;
    if (now_contested != contested) {
      contested = now_contested;
      if (now_contested) out.contested_edge = true;
      else out.uncontested_edge = true;
    }

    // Possession time, on the unclamped clock.
    // F382: the team tick pauses while contested, even though it keeps ownership.
    // F554 (control.js): and banks only while the owner has a living player counted here (`counts`, so a fading owner holds).
    // A gap banks in full only when the owner was counted alone at both ends; otherwise at most HILL_MAX_STEP_MS (`dt`).
    const int sole = contested ? -1 : lead;
    if (owner != contract::STATION_TEAM_ANY && owner < 4 && sole == owner && elapsed) hold_ms[owner] += held_by == owner ? elapsed : dt;
    held_by = sole;
    // The owned clock (control.js `ownMs`): the owner across this interval banks it, contested or empty; the same gap clamp.
    if (owner != contract::STATION_TEAM_ANY && owner < 4 && elapsed) own_ms[owner] += owned_by == owner ? elapsed : dt;

    // The two phases. A step that runs out of bar carries its remaining work into the next phase
    // (control.js: the tick that crossed zero used to render "RED STALLED AT 0%").
    // F464 (Tony 2026-10-05): a built-up NEUTRAL capture DECAYS while nobody is counted on the point (control.js, same rule).
    // Only when NO team is counted: a contested point neither builds nor decays; a lone other team already drains the bar in
    // the DRAIN phase below; an OWNED point is never decayed.
    // Option 1: the drain starts only after `decay_delay_ms` with nobody counted (control.js `pastDelay`).
    const uint32_t past_delay = std::min(dt, absent_ms > decay_delay_ms ? absent_ms - decay_delay_ms : 0u);
    if (owner == contract::STATION_TEAM_ANY && capturing >= 0 && lead < 0 && past_delay) {
      progress = std::max(0.0, progress - decay_rate() * (past_delay / 1000.0));
      if (progress <= 1e-9) progress = 0;
    }
    double work = (net > 0 && dt) ? rate() * net * (dt / 1000.0) : 0;
    for (int guard = 0; work > 1e-9 && guard < 4; guard++) {
      int holder = owner != contract::STATION_TEAM_ANY ? owner : capturing;
      if (holder < 0) holder = capturing = lead;
      if (lead == holder) {  // BUILD, up to 100
        const double step = std::min(work, 100 - progress);
        progress += step;
        work -= step;
        if (progress >= 100 - 1e-9) progress = 100;  // F456: control.js, so a capture is never left reading rising
        if (progress >= 100 - 1e-9 && owner == contract::STATION_TEAM_ANY) {
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
      if (owner != contract::STATION_TEAM_ANY) {
        last_owner = owner;
        out.neutralised = true;
        out.neutralised_team = owner;
        out.neutralised_by = lead;
        owner = contract::STATION_TEAM_ANY;
      }
      capturing = lead;  // the contender now owns the bar, at 0, and keeps pushing
    }
    if (owner == contract::STATION_TEAM_ANY && capturing >= 0 && progress <= 1e-9 && lead != capturing) {
      capturing = -1;  // nobody is pushing an empty bar: fully neutral
    }
    // Direction is read off the state the step LEFT BEHIND (control.js: at a zero crossing the bar
    // fell and is now rising for the other team, and "rising" is the true thing to show).
    dir = 0;
    if (net > 0) {
      const int h = owner != contract::STATION_TEAM_ANY ? owner : capturing;
      if (h >= 0) dir = lead == h ? (progress < 100 ? 1 : 0) : (progress > 0 ? -1 : 0);
    }
    owned_by = owner != contract::STATION_TEAM_ANY ? owner : -1;
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

// ---- F658 game end (control.js noteGameEnd / followSwitch): one rule for the hill and the powerup follower ---------
// Tony 2026-11-07: a following station never leaves its current game for another while the current game is live. The
// current game ENDS here when a player this station heard live in it advertises without the live bit (its whistle; a
// countdown phone was never heard live, so it cannot end a game), or when no live player of it has been heard for
// HILL_RING_STALE_MS (10 min). Only an in-scope advert of the current byte counts. Then the strongest other live game
// takes the station at once; the first follow takes a game at once too. Not saved: a restart has heard no one live yet.
struct FollowEnd {
  uint64_t live_ids = 0;  // bit n: player n heard live in the current game (player_num 1..63)
  bool ended = false;
  void reset() { *this = FollowEnd(); }
  void note(const PlayerEntry& p, bool has_current, uint8_t current) {
    if (!has_current || p.game != current || p.id >= 64) return;
    const uint64_t bit = (uint64_t)1 << p.id;
    if (p.state & contract::ADVERT_PLAYER_STATE_LIVE) live_ids |= bit;
    else if (live_ids & bit) ended = true;
  }
  // True = switch to the strongest other live game now.
  bool switch_now(bool has_current, bool has_best, uint32_t current_heard_at, uint32_t now, uint32_t stale_ms) {
    if (!has_best) return false;
    if (!has_current) return true;
    if (!ended && (int32_t)(now - current_heard_at) > (int32_t)stale_ms) ended = true;
    return ended;
  }
};

// ---- HillFollower (control.js HillFollower, F658: the static hill) --------------------------------
// A hill set up once plays every following game with no walk-out, no Wi-Fi and no re-arm. Player phones set the live
// bit from go-live to the whistle; once the hill hears any live-bit player it FOLLOWS: its current game is the byte of
// the live players it hears. Another live game takes it only once the current game has ended here (FollowEnd), never
// while it is live. Only live-bit players of the current game count. One point state per game byte, at most
// HILL_RING_SIZE, with the last time each was heard: a byte back after more than HILL_RING_STALE_MS starts fresh, and a
// new byte with the ring full evicts the least recently heard (never the current). control.js says why, line for line.
struct HillGame {
  bool used = false;
  uint8_t game = 0;
  uint32_t heard_at = 0;  // the newest live advert of this game
  uint32_t since = 0;     // when this game was first heard (or started fresh): "newest" compares it
  bool has_snap = false;  // false = a fresh point when it becomes current (the current game's state is the point itself)
  HillSnap snap;
};

struct HillFollowStep {
  HillFilter filter;
  bool switched = false;  // the current game changed (or restarted fresh) this step
  int from = -1, to = -1;
  bool fresh = false;
};

class HillFollower {
 public:
  size_t size = (size_t)contract::HILL_RING_SIZE;
  uint32_t stale_ms = (uint32_t)contract::HILL_RING_STALE_MS;
  bool follows = false;
  bool has_current = false;
  uint8_t current = 0;
  HillGame games[contract::HILL_RING_SIZE];
  FollowEnd end;  // the current game's end at this hill (FollowEnd)

  // The byte the hill advertises and counts under: the followed game, else MC's.
  uint8_t game(uint8_t armed_game) const { return follows && has_current ? current : armed_game; }

  HillFollowStep step(BleControlPoint& point, const PlayerPresence& players, uint32_t now, uint8_t armed_game, int station_id) {
    HillFollowStep out;
    out.filter.station_id = station_id;
    struct H { uint8_t game; uint32_t at; int n; };  // n: live players on the point (present or in sight)
    H heard[PRESENCE_MAX_PLAYERS];
    size_t nh = 0;
    for (size_t i = 0; i < players.capacity(); i++) {
      const PlayerEntry& p = players.slot(i);
      if (!p.used || !(p.state & contract::ADVERT_PLAYER_STATE_LIVE) || p.age_ms > players.expiry_ms) continue;
      // A86: a player whose scope does not name this control station does not exist for the hill
      if (!in_scope(p.scope_kinds, p.scope, contract::ADVERT_SCOPE_KIND_CONTROL, station_id)) continue;
      if (p.game == 0 && armed_game != 0) continue;  // a hand-played phone is followed only by a hill of game 0
      const uint32_t at = now - p.age_ms;
      size_t k = 0;
      while (k < nh && heard[k].game != p.game) k++;
      if (k == nh) heard[nh++] = {p.game, at, 0};
      else if ((int32_t)(at - heard[k].at) > 0) heard[k].at = at;
      if (p.present || p.in_circle) heard[k].n++;
    }
    const bool first = !follows && nh > 0;
    if (nh) follows = true;
    if (!follows) {
      out.filter.armed = armed_game;
      return out;
    }
    bool fresh_current = false;
    for (size_t k = 0; k < nh; k++) {
      HillGame* e = find(heard[k].game);
      if (e && (int32_t)(heard[k].at - e->heard_at) > (int32_t)stale_ms) {
        e->has_snap = false;
        e->since = heard[k].at;
        if (has_current && e->game == current) fresh_current = true;
      }
      if (!e) {
        if (used() >= std::min(size, (size_t)contract::HILL_RING_SIZE)) evict();
        e = free_slot();
        if (!e) continue;  // cannot happen: evict() frees one
        *e = HillGame();
        e->used = true;
        e->game = heard[k].game;
        e->heard_at = heard[k].at;
        e->since = heard[k].at;
      }
      if ((int32_t)(heard[k].at - e->heard_at) > 0) e->heard_at = heard[k].at;
    }
    // The first follow takes the game with the most live players on the point, then the newest. Later, another live
    // game takes the hill only once the current game has ended here (FollowEnd), never while it is live. The current
    // byte back after HILL_RING_STALE_MS is a new game on that byte: the last one's end does not end it (Codex review r2).
    if (fresh_current) end.reset();
    for (size_t i = 0; i < players.capacity(); i++) {
      const PlayerEntry& p = players.slot(i);
      if (p.used && p.age_ms <= players.expiry_ms && in_scope(p.scope_kinds, p.scope, contract::ADVERT_SCOPE_KIND_CONTROL, station_id))
        end.note(p, has_current, current);
    }
    auto count = [&](int g) { for (size_t k = 0; k < nh; k++) if (heard[k].game == g) return heard[k].n; return 0; };
    const HillGame* best = nullptr;
    for (size_t k = 0; k < nh; k++) {
      if (has_current && heard[k].game == current) continue;
      const HillGame* e = find(heard[k].game);
      if (!e) continue;  // evicted in this same step
      const int ne = heard[k].n, nb = best ? count(best->game) : -1;
      if (!best || ne > nb || (ne == nb && ((int32_t)(e->since - best->since) > 0 || (e->since == best->since && e->game > best->game)))) best = e;
    }
    int next = has_current ? current : -1;
    const HillGame* cur = has_current ? find(current) : nullptr;
    if (end.switch_now(has_current, best != nullptr, cur ? cur->heard_at : now, now, stale_ms)) next = best->game;
    if (next >= 0 && !has_current && first && (armed_game == 0 || armed_game == next)) {
      // the first follow into MC's own game (or from a hill of any game) keeps the point it counted
      current = (uint8_t)next;
      has_current = true;
      out.switched = true;
      out.to = next;
    } else if (next >= 0 && (!has_current || next != current)) {
      if (has_current) {
        HillGame* from = find(current);
        if (from) { from->snap = point.snap(); from->has_snap = true; }
      }
      HillGame* to = find((uint8_t)next);
      out.switched = true;
      out.from = has_current ? current : -1;
      out.to = next;
      out.fresh = !(to && to->has_snap);
      point.load(to && to->has_snap ? &to->snap : nullptr);
      if (to) to->has_snap = false;
      current = (uint8_t)next;
      has_current = true;
    } else if (fresh_current) {
      point.load(nullptr);
      out.switched = true;
      out.from = out.to = current;
      out.fresh = true;
    }
    if (out.switched) {  // a new current game (or the same byte started again): nothing of it heard yet
      end.reset();
      for (size_t i = 0; i < players.capacity(); i++) {
        const PlayerEntry& p = players.slot(i);
        if (p.used && p.age_ms <= players.expiry_ms && in_scope(p.scope_kinds, p.scope, contract::ADVERT_SCOPE_KIND_CONTROL, station_id))
          end.note(p, has_current, current);
      }
    }
    out.filter.follows = true;
    out.filter.game = current;
    return out;
  }

  const HillGame* get(uint8_t g) const {
    for (const auto& e : games) if (e.used && e.game == g) return &e;
    return nullptr;
  }
  size_t used() const {
    size_t n = 0;
    for (const auto& e : games) if (e.used) n++;
    return n;
  }
  // A game's tally for the heartbeat: the point itself for the current game, else its saved state (fresh = empty).
  HillSnap tally(const HillGame& e, const BleControlPoint& point) const {
    if (has_current && e.game == current) return point.snap();
    return e.has_snap ? e.snap : HillSnap();
  }
  void clear() { *this = HillFollower(); }

 private:
  HillGame* find(uint8_t g) {
    for (auto& e : games) if (e.used && e.game == g) return &e;
    return nullptr;
  }
  HillGame* free_slot() {
    for (auto& e : games) if (!e.used) return &e;
    return nullptr;
  }
  void evict() {
    HillGame* worst = nullptr;
    for (auto& e : games)
      if (e.used && !(has_current && e.game == current) && (!worst || (int32_t)(e.heard_at - worst->heard_at) < 0)) worst = &e;
    if (worst) *worst = HillGame();
  }
};


// F658: the follower and its ring in one NVS string ("hill_ring"), so a restarted hill keeps following with every game's
// tally (the phone saves the same in localStorage "brx.station.hillring"). Times are saved as ms AGO, since millis()
// restarts at boot. "r2|<station id>|<follows>|<current or -1>|<ended>|<live ids, hex>|<game>,<heard ago>,<since ago>,<owner>,<capturing>,
// <progress x10>,<last owner>,<hold0>,<hold1>,<hold2>,<hold3>,<own0>,<own1>,<own2>,<own3>;..." with the current game's
// state taken from the point. An entry with only the first 11 fields (saved before own_ms) restores with own_ms 0. An "r1"
// string (saved before the end evidence, Codex review r2) restores with no end evidence.
inline std::string encode_hill_ring(int station_id, const HillFollower& f, const BleControlPoint& point, uint32_t now) {
  char e[40];
  std::snprintf(e, sizeof e, "%d|%llx|", f.end.ended ? 1 : 0, (unsigned long long)f.end.live_ids);
  std::string s = "r2|" + std::to_string(station_id) + "|" + (f.follows ? "1" : "0") + "|" +
                  (f.has_current ? std::to_string(f.current) : std::string("-1")) + "|" + e;
  for (const HillGame& g : f.games) {
    if (!g.used) continue;
    const HillSnap t = f.tally(g, point);
    char b[224];
    std::snprintf(b, sizeof b, "%u,%lu,%lu,%d,%d,%ld,%d,%lu,%lu,%lu,%lu,%lu,%lu,%lu,%lu;", (unsigned)g.game, (unsigned long)(now - g.heard_at),
                  (unsigned long)(now - g.since), t.owner, t.capturing, BleControlPoint::js_round(t.progress * 10), t.last_owner,
                  (unsigned long)t.hold_ms[0], (unsigned long)t.hold_ms[1], (unsigned long)t.hold_ms[2], (unsigned long)t.hold_ms[3],
                  (unsigned long)t.own_ms[0], (unsigned long)t.own_ms[1], (unsigned long)t.own_ms[2], (unsigned long)t.own_ms[3]);
    s += b;
  }
  return s;
}

// Restore what encode_hill_ring saved, for this station id only. False (nothing changed) when it does not parse, is
// another station's, or is not following. On success the point holds the current game's state, its clock restarted.
// `power_on` (the glue: esp_reset_reason() == ESP_RST_POWERON): the "ms ago" times cannot count the hours the Stick was
// off, so every restored game is marked stale (it starts fresh when heard) and the point starts neutral. A software
// reset (brownout, watchdog, panic) keeps the ring as saved.
inline bool decode_hill_ring(const std::string& s, int station_id, HillFollower& f, BleControlPoint& point, uint32_t now,
                             bool power_on = false) {
  int id = 0, follows = 0, current = -1, used = 0, ended = 0;
  unsigned long long live_ids = 0;
  if (s.rfind("r2|", 0) == 0) {   // r2 adds the current game's end evidence; r1 (older firmware) restores none
    if (std::sscanf(s.c_str(), "r2|%d|%d|%d|%d|%llx|%n", &id, &follows, &current, &ended, &live_ids, &used) < 5 || used <= 0) return false;
  } else if (s.rfind("r1|", 0) == 0) {
    if (std::sscanf(s.c_str(), "r1|%d|%d|%d|%n", &id, &follows, &current, &used) < 3 || used <= 0) return false;
  } else {
    return false;
  }
  if (id != station_id || follows != 1 || current < 0 || current > 255) return false;
  HillFollower out;
  out.size = f.size;
  out.stale_ms = f.stale_ms;
  bool have_current = false;
  HillSnap current_snap;
  size_t pos = (size_t)used, n = 0;
  while (pos < s.size()) {
    const size_t end = s.find(';', pos);
    if (end == std::string::npos) return false;
    unsigned game = 0;
    unsigned long heard = 0, since = 0, h[4] = {0, 0, 0, 0}, o[4] = {0, 0, 0, 0};
    int owner = 0, capturing = 0, last_owner = 0;
    long p10 = 0;
    const int got = std::sscanf(s.substr(pos, end - pos).c_str(), "%u,%lu,%lu,%d,%d,%ld,%d,%lu,%lu,%lu,%lu,%lu,%lu,%lu,%lu", &game, &heard,
                                &since, &owner, &capturing, &p10, &last_owner, &h[0], &h[1], &h[2], &h[3], &o[0], &o[1], &o[2], &o[3]);
    if ((got != 11 && got != 15) || game > 255 || n >= contract::HILL_RING_SIZE) return false;
    HillGame& g = out.games[n++];
    g.used = true;
    g.game = (uint8_t)game;
    g.heard_at = now - (uint32_t)heard;
    g.since = now - (uint32_t)since;
    HillSnap t;
    t.owner = owner;
    t.capturing = capturing;
    t.progress = p10 / 10.0;
    t.last_owner = last_owner;
    for (int k = 0; k < 4; k++) t.hold_ms[k] = (uint32_t)h[k];
    for (int k = 0; k < 4; k++) t.own_ms[k] = (uint32_t)o[k];
    if ((int)game == current) { have_current = true; current_snap = t; }
    else { g.snap = t; g.has_snap = true; }
    pos = end + 1;
  }
  if (!have_current) return false;
  out.follows = true;
  out.has_current = true;
  out.current = (uint8_t)current;
  out.end.ended = ended != 0;
  out.end.live_ids = (uint64_t)live_ids;
  if (power_on) {
    for (HillGame& g : out.games) {
      if (!g.used) continue;
      g.heard_at = g.since = now - out.stale_ms - 1;
      g.has_snap = false;
    }
  }
  f = out;
  point.load(power_on ? nullptr : &current_snap);
  return true;
}

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
  // ADVERT_PLAYER_STATE_REVIVED set and value == station_id counts once per rising edge of that bit. A phone that has ever
  // shown the bit is counted ONLY that way (no double count); older phones fall back to the F344 near rule.
  uint32_t update(const PlayerPresence& players, int station_id = -1) {
    uint32_t n = 0;
    bool seen[PRESENCE_MAX_PLAYERS] = {};
    for (size_t i = 0; i < players.capacity(); i++) {
      const PlayerEntry& p = players.slot(i);
      if (!p.used) continue;
      const bool alive = (p.state & contract::ADVERT_PLAYER_STATE_ALIVE) != 0;
      Known* k = find(p.id);
      // beacon.js countRevives (F344, brx5): a revive counts when the player is NEAR, not `present`: the
      // median of the last MEDIAN_SAMPLES readings at or above the threshold minus REVIVE_MARGIN_DB, with no
      // dwell. The station hears the player's medium-TX advert ~8 dB weaker, and a walk-in revive never
      // reached `present` (the Stick missed a real revive at 20:51:00Z on 2026-09-24).
      const bool fresh = p.age_ms <= players.expiry_ms;
      const bool near = fresh && PlayerPresence::median_of(p) >= players.threshold_for(p) - contract::REVIVE_MARGIN_DB;
      const bool revived_here = station_id >= 0 && (p.state & contract::ADVERT_PLAYER_STATE_REVIVED) && p.value == (uint8_t)station_id;
      const bool uses_bit = (p.state & contract::ADVERT_PLAYER_STATE_REVIVED) != 0 || (k && k->uses_bit);
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
    bool revived = false;   // contract::ADVERT_PLAYER_STATE_REVIVED with our id, last time we saw this player
    bool uses_bit = false;  // this phone speaks contract::ADVERT_PLAYER_STATE_REVIVED: count only on it
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
  w.proto = contract::HILL_BEACON_PROTO;
  w.player = 0;
  w.team = owner == contract::STATION_TEAM_ANY ? contract::HILL_REFUSED_TID : owner;
  w.mag = contract::HILL_MAG;
  return w;
}
inline Word hill_capture_word(int owner) {
  Word w = hill_beacon_word(owner);
  w.mag = contract::HILL_CAPTURE_MAG;
  return w;
}

}  // namespace brx
