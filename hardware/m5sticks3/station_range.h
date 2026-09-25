// station_range.h - F365 (contract A67 and its two addenda): an operator edits a station's RANGE on
// the Stick during play, and the edit syncs to Mission Control. Pure C++17, no Arduino: host-tested in
// test/test_range.cpp, owned by StationLink (station_link.h), driven by the glue and the buttons.
//
// Two settings sync the same way, each on its own:
//   threshold  the presence radius, in dBm (what a player's advert must reach to count as "here"); it is
//              also the advert's byte 14, which phones measure the station by.
//   tx_power   the Stick's own advertising power: ultra_low -18 dBm, low -9, medium 0, high +9 (default).
//
// THE RULE (A67), per setting. MC's `station_config` carries its value and `<field>_age_ms` (how long ago
// MC's value was last set). If the Stick holds an on-station edit YOUNGER than that age, the edit stays
// (reported src "station"); otherwise MC's value applies and the edit is dropped (src "mc"). An absent
// age (an MC before A67) applies MC's value only when it CHANGED: the same value re-sent as the lock
// carrier or on a reconnect keeps the edit. An absent tx_power leaves the Stick's alone.
// Threshold 0 from MC means the Stick's own default, STICK_DEFAULT_THRESHOLD_DBM.
//
// AFTER A REBOOT the edited value comes back from NVS, but its age is unknown, so it is treated as
// EDIT_AGE_UNKNOWN_MS old: any MC value MC reports an age for wins at MC's next config. Until then the
// status says src "station" with that large age.
#pragma once
#include <climits>
#include <cstdint>
#include <string>
#include <vector>

#include "json_lite.h"

namespace brx {

// The StickS3's platform default presence threshold: -57 dBm (Tony, 2026-09-24, after walking both
// stations at 3-5 m: "the stick actually works better"; a phone station defaults to -70). It is also
// what the Stick advertises in byte 14, so it measures by the value it advertises.
constexpr int STICK_DEFAULT_THRESHOLD_DBM = -57;

// The on-station radius edit: 3 dB a click, clamped. Closer = a smaller radius = a higher (less
// negative) threshold.
constexpr int RANGE_MIN_DBM = -90;
constexpr int RANGE_MAX_DBM = -40;
constexpr int RANGE_STEP_DB = 3;
inline int clamp_threshold_dbm(int v) { return v < RANGE_MIN_DBM ? RANGE_MIN_DBM : (v > RANGE_MAX_DBM ? RANGE_MAX_DBM : v); }

// An edit restored from NVS after a reboot has no known age: it counts as this old (INT32_MAX ms,
// about 24.8 days), so any MC value that comes with an age wins.
constexpr int64_t EDIT_AGE_UNKNOWN_MS = INT32_MAX;

// ---- TX power (A67 addendum 1) ------------------------------------------------------------------
constexpr int TX_POWER_ULTRA_LOW = 0, TX_POWER_LOW = 1, TX_POWER_MEDIUM = 2, TX_POWER_HIGH = 3;
constexpr int TX_POWER_DEFAULT = TX_POWER_HIGH;  // +9 dBm: what the Stick has always advertised at
inline const char* tx_power_name(int level) {
  switch (level) {
    case TX_POWER_ULTRA_LOW: return "ultra_low";
    case TX_POWER_LOW: return "low";
    case TX_POWER_MEDIUM: return "medium";
    default: return "high";
  }
}
// The ESP32-S3's advertising power, in its 3 dB steps (esp_power_level_t N18 / N9 / N0 / P9).
inline int tx_power_dbm(int level) {
  switch (level) {
    case TX_POWER_ULTRA_LOW: return -18;
    case TX_POWER_LOW: return -9;
    case TX_POWER_MEDIUM: return 0;
    default: return 9;
  }
}
inline int parse_tx_power(const std::string& s) {  // -1 = absent or unknown
  if (s == "ultra_low") return TX_POWER_ULTRA_LOW;
  if (s == "low") return TX_POWER_LOW;
  if (s == "medium") return TX_POWER_MEDIUM;
  if (s == "high") return TX_POWER_HIGH;
  return -1;
}
inline int clamp_tx_power(int level) { return level < 0 ? 0 : (level > 3 ? 3 : level); }

// ---- the rough distance a threshold means, for the RANGE screen ----------------------------------
// ROUGH, and marked so on screen. Anchored on Tony's one measurement (2026-09-24): a phone 3 m from a
// StickS3 reads -53 to -58 dBm, so -57 dBm ~ 3 m. The other rows follow free-space loss (6 dB per
// doubling of distance) from that anchor, rounded; walls, bodies and phone pockets move them a lot.
struct RangeDistanceRow {
  int at_least_dbm;
  const char* label;
};
constexpr RangeDistanceRow RANGE_DISTANCE_TABLE[] = {
    {-45, "UNDER 1 M"}, {-51, "~1 M"}, {-54, "~2 M"}, {-58, "~3 M"}, {-62, "~5 M"},
    {-66, "~8 M"},      {-70, "~12 M"}, {-76, "~20 M"},
};
inline const char* range_distance_label(int dbm) {
  for (const auto& row : RANGE_DISTANCE_TABLE)
    if (dbm >= row.at_least_dbm) return row.label;
  return "OVER 20 M";
}

// ---- one synced setting ------------------------------------------------------------------------
class SyncedSetting {
 public:
  explicit SyncedSetting(int fallback) : mc_(fallback), fallback_(fallback) {}

  int applied() const { return has_edit_ ? edit_ : mc_; }
  bool from_station() const { return has_edit_; }
  const char* src() const { return has_edit_ ? "station" : "mc"; }
  int mc_value() const { return mc_; }
  // How old the on-station edit is (only meaningful while from_station()).
  int64_t edit_age_ms(uint32_t now_ms) const {
    return age_known_ ? (int64_t)(uint32_t)(now_ms - edit_at_ms_) : EDIT_AGE_UNKNOWN_MS;
  }

  // The rule. Returns true when MC's value now applies.
  //  - With an age: the edit stays only if it is YOUNGER than MC's value (the contract rule).
  //  - With NO age (every MC before A67): MC re-sends the same station_config as the A58 lock carrier and
  //    on every hello/reconnect, so an ageless value EQUAL to the last MC value applied is a re-push, not
  //    a decision, and the edit stays. Only a CHANGED value is MC's new decision, and it applies.
  bool apply_mc(int mc_value, int64_t mc_age_ms, uint32_t now_ms) {
    const bool same_as_before = mc_value == mc_;
    mc_ = mc_value;
    if (has_edit_) {
      if (mc_age_ms >= 0 && edit_age_ms(now_ms) < mc_age_ms) return false;  // the edit is newer
      if (mc_age_ms < 0 && same_as_before) return false;                      // an ageless re-push
    }
    has_edit_ = false;
    return true;
  }
  // MC's value with no age and no rule (a restored config at boot): the edit, if any, is left alone.
  void set_mc(int mc_value) { mc_ = mc_value; }
  void edit_to(int value, uint32_t now_ms) {
    has_edit_ = true;
    edit_ = value;
    age_known_ = true;
    edit_at_ms_ = now_ms;
  }
  // After a reboot: the value from NVS, its age unknown (EDIT_AGE_UNKNOWN_MS).
  void restore_edit(int value) {
    has_edit_ = true;
    edit_ = value;
    age_known_ = false;
  }
  void reset() {
    has_edit_ = false;
    age_known_ = false;
    mc_ = fallback_;
  }

 private:
  int mc_;
  int fallback_;
  bool has_edit_ = false;
  int edit_ = 0;
  bool age_known_ = false;
  uint32_t edit_at_ms_ = 0;
};

// ---- the edit log MC reads (A67 addendum 2) -----------------------------------------------------
// The last RANGE_EDIT_LOG_MAX on-station edits, oldest first, restated on EVERY status beat (MC dedupes
// by seq; there is no ack). seq rises per edit and survives a reboot (NVS); an entry restored after a
// reboot reports the large unknown age. Written to NVS only on an edit, never per beat.
constexpr size_t RANGE_EDIT_LOG_MAX = 8;

struct RangeEdit {
  uint32_t seq = 0;
  bool tx_power = false;  // false = the threshold
  int from = 0, to = 0;   // dBm for the threshold, a level (0..3) for tx_power
  bool locked = false;    // an A58 match lock was running at the edit
  bool age_known = false;
  uint32_t at_ms = 0;
};

class RangeEditLog {
 public:
  const std::vector<RangeEdit>& edits() const { return edits_; }
  uint32_t next_seq() const { return next_seq_; }

  void add(bool tx_power, int from, int to, bool locked, uint32_t now_ms) {
    RangeEdit e;
    e.seq = next_seq_++;
    e.tx_power = tx_power;
    e.from = from;
    e.to = to;
    e.locked = locked;
    e.age_known = true;
    e.at_ms = now_ms;
    edits_.push_back(e);
    if (edits_.size() > RANGE_EDIT_LOG_MAX) edits_.erase(edits_.begin());
  }

  // `[{"seq":3,"field":"threshold","from":-57,"to":-60,"locked":false,"age_ms":1200}, ...]`
  std::string status_json(uint32_t now_ms) const {
    std::string j = "[";
    for (size_t i = 0; i < edits_.size(); i++) {
      const RangeEdit& e = edits_[i];
      if (i) j += ",";
      j += "{\"seq\":" + std::to_string(e.seq) + ",\"field\":" + (e.tx_power ? "\"tx_power\"" : "\"threshold\"");
      j += ",\"from\":" + value_json(e.tx_power, e.from) + ",\"to\":" + value_json(e.tx_power, e.to);
      j += ",\"locked\":" + std::string(e.locked ? "true" : "false");
      const int64_t age = e.age_known ? (int64_t)(uint32_t)(now_ms - e.at_ms) : EDIT_AGE_UNKNOWN_MS;
      j += ",\"age_ms\":" + std::to_string(age) + "}";
    }
    return j + "]";
  }

  // NVS: `{"next":5,"e":[[seq,tx,from,to,locked],...]}`; ages are not kept (a reboot makes them unknown).
  std::string storage() const {
    std::string j = "{\"next\":" + std::to_string(next_seq_) + ",\"e\":[";
    for (size_t i = 0; i < edits_.size(); i++) {
      const RangeEdit& e = edits_[i];
      if (i) j += ",";
      j += "[" + std::to_string(e.seq) + "," + (e.tx_power ? "1" : "0") + "," + std::to_string(e.from) + "," +
           std::to_string(e.to) + "," + (e.locked ? "1" : "0") + "]";
    }
    return j + "]}";
  }
  bool load(const std::string& body) {
    bool ok = false;
    json::Value v = json::parse(body, &ok);
    return ok && load(v);
  }
  // seq NEVER goes down (brx3: MC reads a lower seq as a reset and re-announces every edit): a copy whose
  // `next` is lower than the one already in RAM cannot lower it. The one case that restarts seq at 1 is an
  // NVS that is erased or unreadable at boot (a reinstall or a factory erase): nothing on the Stick then
  // knows the old value, and MC sees a reset, which is the truth.
  bool load(const json::Value& v) {
    if (!v.is_object()) return false;
    const uint32_t floor_seq = next_seq_;
    edits_.clear();
    next_seq_ = (uint32_t)v.get("next").as_int(1);
    const json::Value& list = v.get("e");
    if (list.is_array()) {
      for (const auto& x : list.arr) {
        if (!x.is_array() || x.arr.size() < 5) continue;
        RangeEdit e;
        e.seq = (uint32_t)x.arr[0].as_int();
        e.tx_power = x.arr[1].as_int() != 0;
        e.from = (int)x.arr[2].as_int();
        e.to = (int)x.arr[3].as_int();
        e.locked = x.arr[4].as_int() != 0;
        e.age_known = false;  // a reboot: the large unknown age
        edits_.push_back(e);
        if (e.seq >= next_seq_) next_seq_ = e.seq + 1;  // never reuse a seq MC may already hold
      }
    }
    while (edits_.size() > RANGE_EDIT_LOG_MAX) edits_.erase(edits_.begin());
    if (next_seq_ < 1) next_seq_ = 1;
    if (next_seq_ < floor_seq) next_seq_ = floor_seq;
    return true;
  }

 private:
  static std::string value_json(bool tx_power, int v) {
    return tx_power ? json::quote(tx_power_name(v)) : std::to_string(v);
  }
  std::vector<RangeEdit> edits_;
  uint32_t next_seq_ = 1;
};

}  // namespace brx
