// control_point.h - who owns the point, in the two ways a Stick can know.
//
// BRIDGE: the Stick sits beside a stock grenade and mirrors what the grenade's own beacon
//         says (proto 15 mag 8, team bits = owner, team 2 = neutral). Nothing is decided here;
//         the grenade is the authority and the Stick republishes it over BLE for the HUDs.
// HILL:   the Stick IS the hill. Shots charge it and ownership flips on the PROVISIONAL rule
//         measured 2026-09-10: charge accumulates per team and the attacker wins ties. That
//         rule is 🟠 (F76: the discriminating trial was confounded), so it lives in one place
//         and is labelled, not built on.
// Pure C++17, header-only; the clock is passed in so the host tests can drive it.
#pragma once
#include <cstdint>
#include "brx_advert.h"
#include "brx_ir.h"

namespace brx {

enum class Mode : uint8_t { BRIDGE = 0, HILL = 1 };

constexpr uint32_t BEACON_PERIOD_MS = 5000;
// A node must not call a beacon gone on one miss (rung R, 2026-09-10): two missed beacons.
constexpr uint32_t BRIDGE_STALE_MS = 2 * BEACON_PERIOD_MS + 2000;
constexpr uint32_t RISING_HOLD_MS = 1500;  // how long a fresh capture shows the rising bit

class ControlPoint {
 public:
  Mode mode = Mode::BRIDGE;
  uint8_t owner = TEAM_ANY;  // 0..3, or TEAM_ANY when neutral
  uint32_t charge[4] = {0, 0, 0, 0};
  uint32_t last_beacon_at = 0;  // BRIDGE: when the grenade last spoke
  bool heard_beacon = false;
  bool rising = false;      // a capture just happened; shown for RISING_HOLD_MS
  uint32_t rising_at = 0;
  uint32_t captures = 0;  // count of ownership changes, for STATUS

  void reset() {
    owner = TEAM_ANY;
    for (auto& c : charge) c = 0;
    heard_beacon = false;
    last_beacon_at = 0;
    rising = false;
    rising_at = 0;
    captures = 0;
  }

  // BRIDGE: is the grenade still talking? Two missed beacons and it is not (rung R).
  bool beacon_live(uint32_t now) const {
    return heard_beacon && (now - last_beacon_at) <= BRIDGE_STALE_MS;
  }

  // Feed every complete, parity-valid word. Returns true when ownership changed.
  bool on_word(const Word& w, uint32_t now) {
    return mode == Mode::BRIDGE ? bridge(w, now) : hill(w, now);
  }

  // The beacon the hill emits so stock guns hear it via $SIR,15,0,,28 (HILL mode only).
  // A hill held by team 2 emits team 2, which IS the neutral beacon: the wire has no other value
  // for it, and a stock grenade captured by a tid-2 gun says the same. That is F82 (never field a
  // team on tid 2 in a hill game). The BLE advert still carries team 2 correctly.
  Word beacon_word() const {
    Word w;
    w.proto = PROTO_BEACON;
    w.player = 0;
    w.team = owner == TEAM_ANY ? GRENADE_NEUTRAL_TEAM : owner;
    w.mag = BEACON_HILL;
    return w;
  }

  // What to advertise. A BRIDGE whose grenade has gone quiet advertises NOTHING (active=false):
  // a stale owner would be indistinguishable from a live neutral point on every HUD.
  AdvertView view(uint32_t now) const {
    AdvertView v;
    v.team = owner;
    if (mode == Mode::BRIDGE) v.active = beacon_live(now);
    if (owner != TEAM_ANY) v.state |= CONTROL_HELD;
    if (rising && (now - rising_at) < RISING_HOLD_MS) v.state |= CONTROL_RISING;
    v.value = progress();
    return v;
  }

  // HILL: the holder's charge as a share of the total, 0..100. BRIDGE has no charge to show.
  uint8_t progress() const {
    if (mode != Mode::HILL || owner == TEAM_ANY) return 0;
    uint32_t total = 0;
    for (auto c : charge) total += c;
    return total ? (uint8_t)((charge[owner] * 100) / total) : 0;
  }

 private:
  bool bridge(const Word& w, uint32_t now) {
    if (w.proto != PROTO_BEACON) return false;
    if (w.mag == BEACON_HILL) {
      last_beacon_at = now;
      heard_beacon = true;
      uint8_t team = (w.team == GRENADE_NEUTRAL_TEAM) ? TEAM_ANY : (uint8_t)w.team;
      if (team != owner) {
        owner = team;
        captures++;
        return true;
      }
      return false;
    }
    if (w.mag == BEACON_CAPTURED) {
      // The capture word arrives ~50 ms after the shot and its team bits ARE the new owner
      // (protocol: "the owner being ENTERED"); the next mag=8 beacon only confirms it ~5 s later.
      // A node must act on this word alone, so ownership moves here, not on the beacon.
      last_beacon_at = now;
      heard_beacon = true;
      rising = true;
      rising_at = now;
      uint8_t team = (w.team == GRENADE_NEUTRAL_TEAM) ? TEAM_ANY : (uint8_t)w.team;
      if (team != owner) {
        owner = team;
        captures++;
        return true;
      }
      return false;
    }
    return false;  // respawn (6), boot (56), was-neutral (53): not ownership
  }

  bool hill(const Word& w, uint32_t now) {
    if (w.proto != PROTO_SHOT || w.team < 0 || w.team > 3) return false;
    uint8_t t = (uint8_t)w.team;
    charge[t] += (uint32_t)w.mag;
    if (owner == t) return false;
    // PROVISIONAL (F76): attacker's total >= holder's total flips it, and the attacker wins ties.
    // The winner then holds what it took to win: 5 AR rounds took a hill holding 45 and the
    // next taker needed 45 again (bench 2026-09-10), so the total carries over, not the last shot.
    uint32_t holding = owner == TEAM_ANY ? 0 : charge[owner];
    uint32_t attacking = charge[t];
    if (attacking >= holding) {
      owner = t;
      for (auto& c : charge) c = 0;
      charge[t] = attacking;
      rising = true;
      rising_at = now;
      captures++;
      return true;
    }
    return false;
  }
};

}  // namespace brx
