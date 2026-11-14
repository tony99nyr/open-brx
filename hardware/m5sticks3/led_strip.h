// led_strip.h - the pure half of the Stick's addressable LED strip: patterns, the power cap and the
// wire bytes. No Arduino; host-tested in test/test_strip.cpp. The RMT output lives in m5sticks3.ino.
//
// The strip: M5Stack Digital RGB LED Weatherproof Strip (A093-B), SK6812, 1 m, 60 LEDs, on the Grove port.
//
// POWER (hard rule). The Grove port's 5 V is the M5PM1 EXT_5V rail, good for about 0.38 A. One SK6812 at
// 255 draws about 20 mA per channel (an estimate), so 60 at full white is about 3.6 A and would brown out
// the Stick. Every frame goes through strip_cap() before it is sent:
//   - budget: 300 mA for the whole strip (STRIP_BUDGET_MA), which leaves about 80 mA of the rail for the
//     IR LED and receiver;
//   - idle: about 1 mA per LED even when dark (STRIP_IDLE_MA_PER_LED, an estimate), so 60 LEDs spend
//     60 mA of the budget before any colour;
//   - colour: the rest (240 mA for 60 LEDs) caps the sum of every channel value in the frame at
//     240 / 20 x 255 = 3060. A frame above that is scaled down, all channels by one factor.
// EXTERNAL 5 V (STRIPPOWER EXT, Tony 2026-11-14): with the strip's 5 V from its own supply (a power bank's second
// port; the Stick's Grove 5 V NOT connected), the budget is 2000 mA (STRIP_EXT_BUDGET_MA), because many banks share
// about 2.4 A across both ports. The same per-frame scaling applies. GROVE is the default and the safe one.
// In GROVE mode all 60 at "full" red send about 51 per LED, and all 60 at "full" white about 17 per channel. A
// single walking LED stays at full brightness, because one LED is well inside the budget.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

#include "station_team.h"

namespace brx {

struct Rgb {
  uint8_t r = 0, g = 0, b = 0;
  bool operator==(const Rgb& o) const { return r == o.r && g == o.g && b == o.b; }
  bool operator!=(const Rgb& o) const { return !(*this == o); }
};

constexpr uint16_t STRIP_DEFAULT_LEDS = 60;
constexpr uint16_t STRIP_MAX_LEDS = 144;            // a 1 m strip at 144/m; idle alone is then 144 mA
constexpr uint32_t STRIP_RAIL_MA = 380;             // EXT_5V, M5PM1 (about 0.38 A)
constexpr uint32_t STRIP_BUDGET_MA = 300;           // GROVE: the whole strip, idle included
constexpr uint32_t STRIP_EXT_BUDGET_MA = 2000;      // EXT: the strip on its own 5 V supply
constexpr uint32_t STRIP_IDLE_MA_PER_LED = 1;       // estimate
constexpr uint32_t STRIP_MA_PER_CHANNEL_FULL = 20;  // one channel at 255, estimate
constexpr uint32_t STRIP_WALK_STEP_MS = 250;        // 60 LEDs in 15 s: slow enough to count by eye
static_assert(STRIP_BUDGET_MA < STRIP_RAIL_MA, "the strip budget must stay under the EXT_5V rail");
static_assert(STRIP_MAX_LEDS * STRIP_IDLE_MA_PER_LED < STRIP_BUDGET_MA, "idle alone must fit the budget");

enum class StripPower : uint8_t { GROVE, EXT };
inline uint32_t strip_budget_ma(StripPower p) { return p == StripPower::EXT ? STRIP_EXT_BUDGET_MA : STRIP_BUDGET_MA; }
inline const char* strip_power_name(StripPower p) { return p == StripPower::EXT ? "ext" : "grove"; }

// The estimated current of a frame in mA: idle plus colour, rounded up.
inline uint32_t strip_estimate_ma(const Rgb* px, size_t n) {
  uint64_t sum = 0;
  for (size_t i = 0; i < n; i++) sum += (uint32_t)px[i].r + px[i].g + px[i].b;
  return (uint32_t)(n * STRIP_IDLE_MA_PER_LED + (sum * STRIP_MA_PER_CHANNEL_FULL + 254) / 255);
}

// The largest sum of channel values a frame of n LEDs may carry.
inline uint32_t strip_channel_budget(size_t n, uint32_t budget_ma = STRIP_BUDGET_MA) {
  const uint32_t idle = (uint32_t)n * STRIP_IDLE_MA_PER_LED;
  if (idle >= budget_ma) return 0;
  return (budget_ma - idle) * 255 / STRIP_MA_PER_CHANNEL_FULL;
}

// Scale the frame down (one factor for every channel, rounded down) so it fits the budget. Returns true
// when it scaled. After this, strip_estimate_ma(px, n) <= budget_ma for any frame.
// strip_cap_to() scales px[0..n) to at most `limit` in channel sum: for a part of a frame whose other part is
// already counted (a capture fill over a dim neutral rest).
inline bool strip_cap_to(Rgb* px, size_t n, uint64_t limit) {
  uint64_t sum = 0;
  for (size_t i = 0; i < n; i++) sum += (uint32_t)px[i].r + px[i].g + px[i].b;
  if (sum <= limit) return false;
  for (size_t i = 0; i < n; i++) {
    px[i].r = (uint8_t)(px[i].r * limit / sum);
    px[i].g = (uint8_t)(px[i].g * limit / sum);
    px[i].b = (uint8_t)(px[i].b * limit / sum);
  }
  return true;
}
inline bool strip_cap(Rgb* px, size_t n, uint32_t budget_ma = STRIP_BUDGET_MA) {
  return strip_cap_to(px, n, strip_channel_budget(n, budget_ma));
}

// The wire bytes, 3 per LED. SK6812 RGB takes green first (GRB); `grb = false` sends RGB, for a strip
// whose red test shows green (STRIPORDER RGB on the serial port).
inline void strip_bytes(const Rgb* px, size_t n, bool grb, uint8_t* out) {
  for (size_t i = 0; i < n; i++) {
    out[3 * i + 0] = grb ? px[i].g : px[i].r;
    out[3 * i + 1] = grb ? px[i].r : px[i].g;
    out[3 * i + 2] = px[i].b;
  }
}

constexpr Rgb team_rgb(int team) {
  return team < 0 || team > 3 ? Rgb{}
       : Rgb{(uint8_t)(brx_render::hex_nibble(contract::TEAM_COLOUR_HEX[team][1]) * 16 + brx_render::hex_nibble(contract::TEAM_COLOUR_HEX[team][2])),
             (uint8_t)(brx_render::hex_nibble(contract::TEAM_COLOUR_HEX[team][3]) * 16 + brx_render::hex_nibble(contract::TEAM_COLOUR_HEX[team][4])),
             (uint8_t)(brx_render::hex_nibble(contract::TEAM_COLOUR_HEX[team][5]) * 16 + brx_render::hex_nibble(contract::TEAM_COLOUR_HEX[team][6]))};
}

// ---- bench patterns (the STRIP serial command) --------------------------------------------------------
// AUTO is the station role (strip_roles.h), the default; the rest are bench patterns that override it.
enum class StripPattern : uint8_t { AUTO, OFF, RED, GREEN, BLUE, WHITE, WALK, TEAMS, TEAM };

// "auto", "off", "red", "green", "blue", "white", "walk", "teams", "team <0-3>". False on anything else.
inline bool parse_strip_pattern(const std::string& s, StripPattern& out, int& team) {
  if (s == "auto") out = StripPattern::AUTO;
  else if (s == "off") out = StripPattern::OFF;
  else if (s == "red") out = StripPattern::RED;
  else if (s == "green") out = StripPattern::GREEN;
  else if (s == "blue") out = StripPattern::BLUE;
  else if (s == "white") out = StripPattern::WHITE;
  else if (s == "walk") out = StripPattern::WALK;
  else if (s == "teams") out = StripPattern::TEAMS;
  else if (s.size() == 6 && s.rfind("team ", 0) == 0 && s[5] >= '0' && s[5] <= '3') {
    out = StripPattern::TEAM;
    team = s[5] - '0';
  } else return false;
  return true;
}

inline const char* strip_pattern_name(StripPattern p) {
  switch (p) {
    case StripPattern::AUTO: return "auto";
    case StripPattern::OFF: return "off";
    case StripPattern::RED: return "red";
    case StripPattern::GREEN: return "green";
    case StripPattern::BLUE: return "blue";
    case StripPattern::WHITE: return "white";
    case StripPattern::WALK: return "walk";
    case StripPattern::TEAMS: return "teams";
    case StripPattern::TEAM: return "team";
  }
  return "?";
}

// Which LED the walk lights `elapsed_ms` after it started.
inline size_t strip_walk_index(uint32_t elapsed_ms, size_t n) { return n ? (elapsed_ms / STRIP_WALK_STEP_MS) % n : 0; }

// Draw the pattern at full level, then cap it. AUTO draws nothing here: the sketch renders the role instead. TEAMS: four equal blocks, team 0 to 3 from LED 0.
inline void strip_render(StripPattern p, int team, uint32_t elapsed_ms, Rgb* px, size_t n,
                         uint32_t budget_ma = STRIP_BUDGET_MA) {
  for (size_t i = 0; i < n; i++) {
    Rgb c;
    switch (p) {
      case StripPattern::AUTO: case StripPattern::OFF: break;
      case StripPattern::RED: c = {255, 0, 0}; break;
      case StripPattern::GREEN: c = {0, 255, 0}; break;
      case StripPattern::BLUE: c = {0, 0, 255}; break;
      case StripPattern::WHITE: c = {255, 255, 255}; break;
      case StripPattern::WALK: if (i == strip_walk_index(elapsed_ms, n)) c = {255, 255, 255}; break;
      case StripPattern::TEAMS: c = team_rgb((int)(i * 4 / n)); break;
      case StripPattern::TEAM: c = team_rgb(team); break;
    }
    px[i] = c;
  }
  strip_cap(px, n, budget_ma);
}

}  // namespace brx
