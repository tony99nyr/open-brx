// strip_roles.h - what the LED strip shows for the station's role, from the same StickState the screen
// uses (stick_state.h). Pure: no Arduino; host-tested in test/test_strip.cpp. Every frame still goes
// through strip_cap() (led_strip.h), so no pattern here can break the budget (300 mA on the Grove 5 V, STRIPPOWER).
//
// The roles (brx1's 2026-10-18 design):
//   - hill: neutral is dim white; a capture fills the strip from LED 0 in the capturer's colour at the
//     capture progress (an owner losing the point drains the same way); owned is solid with a slow pulse
//     only while the owner scores (a living owner player counted on it, not contested: F554); owned with
//     no owner scoring holds the owner's colour steady at 15 % (Tony 2026-11-15, option 1);
//     contested flashes the two largest teams' colours in turn; an ended game holds the owner's colour
//     dim (a third) and still.
//   - respawn: a steady team colour at half the budget, and the full budget for a flash on each respawn
//     (the flash needs the post-MVP revive feedback; presence.h).
//   - power-up: a chase in the item's colour while it is ready; while it refills, dark, with a dim bar
//     that grows to full at the next spawn.
//   - no Mission Control link and no role yet: a slow dim amber blink. A station with a role keeps showing
//     it when the link drops, because a HELD station plays on without Mission Control.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

#include "led_strip.h"
#include "station_screen.h"

namespace brx {

constexpr Rgb STRIP_NEUTRAL{12, 12, 12};
constexpr Rgb STRIP_AMBER{32, 12, 0};  // 60 LEDs at this fit the budget uncapped
constexpr Rgb STRIP_ITEM_WEAPON{238, 249, 255};  // the screen's COL_NUM, the weapon pickup's default
constexpr Rgb STRIP_ITEM_SPECIAL{36, 217, 196};  // the screen's COL_SHIELD
constexpr uint32_t STRIP_PULSE_MS = 2000;        // owned: one slow breath
constexpr uint32_t STRIP_CONTEST_MS = 400;       // contested: each colour's turn
constexpr uint32_t STRIP_OWNED_IDLE_PCT = 15;    // owned, scoring nothing: steady at this share of the owner colour (Tony 2026-11-15)
constexpr uint32_t STRIP_CHASE_STEP_MS = 50;     // power-up ready: one LED a step
constexpr size_t STRIP_CHASE_LEN = 6;
constexpr uint32_t STRIP_AMBER_PERIOD_MS = 2000; // no link: 500 ms on, 1500 ms off
constexpr uint32_t STRIP_AMBER_ON_MS = 500;
constexpr uint32_t STRIP_FRAME_MS = 50;          // the role frame rate, 20 Hz

enum class StripRole : uint8_t {
  OFF, NO_LINK, HILL_NEUTRAL, HILL_FILL, HILL_OWNED, HILL_OWNED_IDLE, HILL_CONTESTED, HILL_ENDED,
  RESPAWN, RESPAWN_FLASH, POWERUP_READY, POWERUP_REFILL,
};

inline const char* strip_role_name(StripRole r) {
  switch (r) {
    case StripRole::OFF: return "off";
    case StripRole::NO_LINK: return "no-link";
    case StripRole::HILL_NEUTRAL: return "hill-neutral";
    case StripRole::HILL_FILL: return "hill-fill";
    case StripRole::HILL_OWNED: return "hill-owned";
    case StripRole::HILL_OWNED_IDLE: return "hill-owned-idle";
    case StripRole::HILL_CONTESTED: return "hill-contested";
    case StripRole::HILL_ENDED: return "hill-ended";
    case StripRole::RESPAWN: return "respawn";
    case StripRole::RESPAWN_FLASH: return "respawn-flash";
    case StripRole::POWERUP_READY: return "powerup-ready";
    case StripRole::POWERUP_REFILL: return "powerup-refill";
  }
  return "?";
}

inline bool strip_team_ok(int t) { return t >= 0 && t <= 3; }

// The team whose colour fills the hill strip: the owner, else the team building it (advert byte 9).
inline int strip_hill_team(const StickState& s) {
  if (strip_team_ok(s.control_owner)) return s.control_owner;
  return strip_team_ok(s.control_bar_team) ? s.control_bar_team : -1;
}

inline StripRole strip_role(const StickState& s) {
  if (s.control_present) {
    if (s.control_ended) return StripRole::HILL_ENDED;
    if (s.control_waiting) return StripRole::HILL_NEUTRAL;
    if (s.control_contested && strip_team_ok(s.control_contest_a) && strip_team_ok(s.control_contest_b))
      return StripRole::HILL_CONTESTED;
    const int team = strip_hill_team(s);
    if (team < 0) return StripRole::HILL_NEUTRAL;
    if (strip_team_ok(s.control_owner) && s.control_progress_pct >= 100)
      return s.control_scoring ? StripRole::HILL_OWNED : StripRole::HILL_OWNED_IDLE;
    return s.control_progress_pct > 0 ? StripRole::HILL_FILL : StripRole::HILL_NEUTRAL;
  }
  if (s.respawn_present) return s.respawn_redeploy ? StripRole::RESPAWN_FLASH : StripRole::RESPAWN;
  if (s.powerup_present) {
    if (s.powerup_ended) return StripRole::OFF;
    return s.powerup_available ? StripRole::POWERUP_READY : StripRole::POWERUP_REFILL;
  }
  if (s.link_state != LinkState::NOT_CONFIGURED && !s.mc_connected) return StripRole::NO_LINK;
  return StripRole::OFF;
}

inline Rgb strip_item_rgb(const StickState& s) {
  const std::string& h = s.item_color_hex;
  if (h.size() == 7 && h[0] == '#') {
    int v[6];
    bool ok = true;
    for (int i = 0; i < 6; i++) ok = ok && (v[i] = brx_render::hex_nibble(h[i + 1])) >= 0;
    if (ok) return Rgb{(uint8_t)(v[0] * 16 + v[1]), (uint8_t)(v[2] * 16 + v[3]), (uint8_t)(v[4] * 16 + v[5])};
  }
  return s.item_is_special ? STRIP_ITEM_SPECIAL : STRIP_ITEM_WEAPON;
}

inline Rgb strip_scale(Rgb c, uint32_t num, uint32_t den) {
  return Rgb{(uint8_t)(c.r * num / den), (uint8_t)(c.g * num / den), (uint8_t)(c.b * num / den)};
}

// Scale an already capped frame by num/den (a dimmer level inside the budget).
inline void strip_dim(Rgb* px, size_t n, uint32_t num, uint32_t den) {
  for (size_t i = 0; i < n; i++) px[i] = strip_scale(px[i], num, den);
}

// How many LEDs a fill of pct percent lights: 0 at 0, all n at 100, at least one above 0.
inline size_t strip_fill_count(int pct, size_t n) {
  if (pct <= 0 || !n) return 0;
  if (pct >= 100) return n;
  const size_t k = (size_t)pct * n / 100;
  return k ? k : 1;
}

// The owned pulse level, 40..100 percent, a triangle over STRIP_PULSE_MS.
inline uint32_t strip_pulse_pct(uint32_t now_ms) {
  const uint32_t ph = now_ms % STRIP_PULSE_MS, half = STRIP_PULSE_MS / 2;
  const uint32_t up = ph < half ? ph : STRIP_PULSE_MS - ph;  // 0..half
  return 40 + 60 * up / half;
}

inline StripRole strip_render_role(const StickState& s, uint32_t now_ms, Rgb* px, size_t n,
                                   uint32_t budget_ma = STRIP_BUDGET_MA) {
  const StripRole role = strip_role(s);
  for (size_t i = 0; i < n; i++) px[i] = Rgb{};
  switch (role) {
    case StripRole::OFF: break;
    case StripRole::NO_LINK:
      if (now_ms % STRIP_AMBER_PERIOD_MS < STRIP_AMBER_ON_MS)
        for (size_t i = 0; i < n; i++) px[i] = STRIP_AMBER;
      break;
    case StripRole::HILL_NEUTRAL:
      for (size_t i = 0; i < n; i++) px[i] = STRIP_NEUTRAL;
      break;
    case StripRole::HILL_FILL: {
      const size_t k = strip_fill_count(s.control_progress_pct, n);
      const Rgb c = team_rgb(strip_hill_team(s));
      for (size_t i = 0; i < n; i++) px[i] = i < k ? c : STRIP_NEUTRAL;
      // cap the fill against what the neutral rest leaves, so the rest stays the same dim white
      const uint64_t rest = (uint64_t)(n - k) * (STRIP_NEUTRAL.r + STRIP_NEUTRAL.g + STRIP_NEUTRAL.b);
      const uint64_t budget = strip_channel_budget(n, budget_ma);
      strip_cap_to(px, k, budget > rest ? budget - rest : 0);
      break;
    }
    case StripRole::HILL_OWNED:
    case StripRole::HILL_OWNED_IDLE:  // the owner scores nothing: no pulse, steady and dim
      for (size_t i = 0; i < n; i++) px[i] = team_rgb(s.control_owner);
      strip_cap(px, n, budget_ma);
      strip_dim(px, n, role == StripRole::HILL_OWNED ? strip_pulse_pct(now_ms) : STRIP_OWNED_IDLE_PCT, 100);
      break;
    case StripRole::HILL_CONTESTED: {
      const int t = (now_ms / STRIP_CONTEST_MS) % 2 ? s.control_contest_b : s.control_contest_a;
      for (size_t i = 0; i < n; i++) px[i] = team_rgb(t);
      break;
    }
    case StripRole::HILL_ENDED:
      if (strip_team_ok(s.control_owner)) {
        for (size_t i = 0; i < n; i++) px[i] = team_rgb(s.control_owner);
        strip_cap(px, n, budget_ma);
        strip_dim(px, n, 1, 3);
      } else {
        for (size_t i = 0; i < n; i++) px[i] = STRIP_NEUTRAL;
      }
      break;
    case StripRole::RESPAWN:
    case StripRole::RESPAWN_FLASH: {
      const Rgb c = strip_team_ok(s.respawn_team) ? team_rgb(s.respawn_team) : Rgb{255, 255, 255};
      for (size_t i = 0; i < n; i++) px[i] = c;
      strip_cap(px, n, budget_ma);
      if (role == StripRole::RESPAWN) strip_dim(px, n, 1, 2);  // the flash is the full budget, so twice as bright
      break;
    }
    case StripRole::POWERUP_READY: {
      const Rgb c = strip_item_rgb(s);
      const size_t head = n ? (now_ms / STRIP_CHASE_STEP_MS) % n : 0;
      for (size_t j = 0; j < STRIP_CHASE_LEN && j < n; j++) px[(head + n - j) % n] = strip_scale(c, STRIP_CHASE_LEN - j, STRIP_CHASE_LEN);
      break;
    }
    case StripRole::POWERUP_REFILL: {
      const uint32_t period = s.powerup_period_s ? s.powerup_period_s : 1;
      const uint32_t left = s.powerup_remaining_s < period ? s.powerup_remaining_s : period;
      const int pct = s.powerup_known ? (int)((period - left) * 100 / period) : 0;
      const Rgb c = strip_scale(strip_item_rgb(s), 1, 6);
      const size_t k = strip_fill_count(pct, n);
      for (size_t i = 0; i < k; i++) px[i] = c;
      break;
    }
  }
  // EVERY role ends here (polish review 2026-11-15): a fill over a dim rest, or a dimmed frame, is capped once more,
  // so no role and no length can pass the budget. Dimming only lowers a capped frame, so this changes nothing there.
  strip_cap(px, n, budget_ma);
  return role;
}

}  // namespace brx
