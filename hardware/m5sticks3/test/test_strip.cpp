// Host tests for led_strip.h: the power cap, the wire bytes and the bench patterns.
#include "check.h"
#include "led_strip.h"
#include "strip_roles.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>

using namespace brx;

static std::vector<Rgb> frame(StripPattern p, int team, uint32_t elapsed, size_t n) {
  std::vector<Rgb> px(n);
  strip_render(p, team, elapsed, px.data(), n);
  return px;
}

static void every_full_frame_stays_under_the_budget() {
  for (size_t n : {size_t(1), size_t(10), size_t(60), size_t(STRIP_MAX_LEDS)}) {
    for (StripPattern p : {StripPattern::RED, StripPattern::GREEN, StripPattern::BLUE, StripPattern::WHITE,
                           StripPattern::WALK, StripPattern::TEAMS, StripPattern::TEAM}) {
      auto px = frame(p, 3, 0, n);
      CHECK(strip_estimate_ma(px.data(), n) <= STRIP_BUDGET_MA);
    }
  }
  // 60 x full white uncapped would be about 3.6 A.
  std::vector<Rgb> white(60, Rgb{255, 255, 255});
  CHECK(strip_estimate_ma(white.data(), 60) > 3600);
  CHECK(strip_cap(white.data(), 60));
  CHECK(strip_estimate_ma(white.data(), 60) <= STRIP_BUDGET_MA);
  CHECK_EQ(white[0].r, 17);  // 3060 / 180 channels
}

static void a_small_frame_is_not_dimmed() {
  auto px = frame(StripPattern::WALK, 0, 0, 60);
  CHECK(px[0] == (Rgb{255, 255, 255}));
  CHECK(px[1] == Rgb{});
  std::vector<Rgb> one(60);
  one[5] = {255, 0, 0};
  CHECK(!strip_cap(one.data(), 60));
  CHECK_EQ(one[5].r, 255);
}

static void the_cap_keeps_the_hue() {
  std::vector<Rgb> px(60, Rgb{200, 100, 0});
  strip_cap(px.data(), 60);
  CHECK(px[0].r > 0 && px[0].g > 0);
  CHECK(px[0].r >= 2 * px[0].g - 1 && px[0].r <= 2 * px[0].g + 1);
}

static void the_walk_steps_end_to_end_and_wraps() {
  CHECK_EQ(strip_walk_index(0, 60), size_t(0));
  CHECK_EQ(strip_walk_index(STRIP_WALK_STEP_MS, 60), size_t(1));
  CHECK_EQ(strip_walk_index(59 * STRIP_WALK_STEP_MS, 60), size_t(59));
  CHECK_EQ(strip_walk_index(60 * STRIP_WALK_STEP_MS, 60), size_t(0));
  auto px = frame(StripPattern::WALK, 0, 59 * STRIP_WALK_STEP_MS, 60);
  CHECK(px[59] == (Rgb{255, 255, 255}));
}

static void sk6812_takes_green_first() {
  Rgb px[2] = {{1, 2, 3}, {4, 5, 6}};
  uint8_t out[6];
  strip_bytes(px, 2, true, out);
  CHECK(out[0] == 2 && out[1] == 1 && out[2] == 3 && out[3] == 5 && out[4] == 4 && out[5] == 6);
  strip_bytes(px, 2, false, out);
  CHECK(out[0] == 1 && out[1] == 2 && out[2] == 3);
}

// The LED palette is pinned: the screen's hex reads wrong on an SK6812 (rose red reads pink, bench 2026-11-14).
static void team_colours_are_the_led_palette() {
  CHECK(team_rgb(0) == (Rgb{255, 0, 0}));
  CHECK(team_rgb(1) == (Rgb{0, 40, 255}));
  CHECK(team_rgb(2) == (Rgb{255, 150, 0}));
  CHECK(team_rgb(3) == (Rgb{150, 0, 255}));
  CHECK(team_rgb(-1) == Rgb{});
  CHECK(team_rgb(4) == Rgb{});
  auto px = frame(StripPattern::TEAMS, 0, 0, 4);  // one LED a team, under the budget, so uncapped
  CHECK(px[0] == team_rgb(0) && px[1] == team_rgb(1) && px[2] == team_rgb(2) && px[3] == team_rgb(3));
}

static void the_bench_command_parses() {
  StripPattern p; int team = 0;
  CHECK(parse_strip_pattern("walk", p, team) && p == StripPattern::WALK);
  CHECK(parse_strip_pattern("team 2", p, team) && p == StripPattern::TEAM && team == 2);
  CHECK(!parse_strip_pattern("team 4", p, team));
  CHECK(!parse_strip_pattern("rainbow", p, team));
  CHECK(parse_strip_pattern("off", p, team) && p == StripPattern::OFF);
}

// ---- the role patterns (strip_roles.h) ----------------------------------------------------------------
static StickState hill(int owner, int bar, int pct) {
  StickState s;
  s.link_state = LinkState::ASSIGNED;
  s.mc_connected = true;
  s.control_present = true;
  s.control_ble = true;
  s.control_owner = (uint8_t)(owner < 0 ? contract::STATION_TEAM_ANY : owner);
  s.control_bar_team = bar;
  s.control_progress_pct = pct;
  s.control_scoring = owner >= 0 && pct >= 100;  // a living owner player on the point (test_link.cpp drives the real rule)
  return s;
}

static std::vector<Rgb> role_frame(const StickState& s, uint32_t now, size_t n = 60) {
  std::vector<Rgb> px(n);
  strip_render_role(s, now, px.data(), n);
  CHECK(strip_estimate_ma(px.data(), n) <= STRIP_BUDGET_MA);
  return px;
}

static bool same_hue(Rgb a, Rgb want) {  // a is want scaled down: scaled back up, each channel within 40 of want
  int k = std::max({a.r, a.g, a.b}), m = std::max({want.r, want.g, want.b});
  if (!k || !m) return false;
  auto near = [&](int x, int y) { return std::abs(x * m / k - y) <= 40; };
  return near(a.r, want.r) && near(a.g, want.g) && near(a.b, want.b);
}

static void a_neutral_hill_is_dim_white() {
  CHECK(strip_role(hill(-1, -1, 0)) == StripRole::HILL_NEUTRAL);
  auto px = role_frame(hill(-1, -1, 0), 0);
  CHECK(px[0] == STRIP_NEUTRAL && px[59] == STRIP_NEUTRAL);
}

static void a_capture_fills_the_strip_in_the_capturers_colour_at_the_progress() {
  auto s = hill(-1, 1, 50);
  CHECK(strip_role(s) == StripRole::HILL_FILL);
  auto px = role_frame(s, 0);
  CHECK(same_hue(px[0], team_rgb(1)) && same_hue(px[29], team_rgb(1)));
  CHECK(px[30] == STRIP_NEUTRAL && px[59] == STRIP_NEUTRAL);
  CHECK_EQ(strip_fill_count(1, 60), size_t(1));
  CHECK_EQ(strip_fill_count(100, 60), size_t(60));
  CHECK_EQ(strip_fill_count(0, 60), size_t(0));
  // an owner losing the point drains in its own colour
  auto d = hill(0, 0, 25);
  CHECK(strip_role(d) == StripRole::HILL_FILL);
  auto dp = role_frame(d, 0);
  CHECK(same_hue(dp[14], team_rgb(0)) && dp[15] == STRIP_NEUTRAL);
}

static void an_owned_hill_is_solid_and_pulses_slowly() {
  auto s = hill(2, 2, 100);
  CHECK(strip_role(s) == StripRole::HILL_OWNED);
  auto lo = role_frame(s, 0), hi = role_frame(s, STRIP_PULSE_MS / 2);
  CHECK(lo[0] == lo[59] && hi[0] == hi[59]);
  CHECK(same_hue(hi[0], team_rgb(2)));
  CHECK(hi[0].r > lo[0].r);  // the pulse breathes
  CHECK_EQ(strip_pulse_pct(0), 40u);
  CHECK_EQ(strip_pulse_pct(STRIP_PULSE_MS / 2), 100u);
}

static void a_contested_hill_flashes_the_two_teams_in_turn() {
  auto s = hill(0, 0, 100);
  s.control_contested = true;
  s.control_contest_a = 0;
  s.control_contest_b = 3;
  CHECK(strip_role(s) == StripRole::HILL_CONTESTED);
  CHECK(same_hue(role_frame(s, 0)[10], team_rgb(0)));
  CHECK(same_hue(role_frame(s, STRIP_CONTEST_MS)[10], team_rgb(3)));
}

static void a_respawn_is_steady_and_flashes_brighter_on_a_respawn() {
  StickState s;
  s.link_state = LinkState::ASSIGNED;
  s.respawn_present = true;
  s.respawn_team = 1;
  CHECK(strip_role(s) == StripRole::RESPAWN);
  auto steady = role_frame(s, 0), later = role_frame(s, 12345);
  CHECK(steady == later && same_hue(steady[0], team_rgb(1)));
  s.respawn_redeploy = true;
  auto flash = role_frame(s, 0);
  CHECK(flash[0].b > steady[0].b + steady[0].b / 2);
}

static void a_ready_powerup_chases_and_a_spent_one_refills_dark() {
  StickState s;
  s.link_state = LinkState::ASSIGNED;
  s.powerup_present = true;
  s.powerup_known = true;
  s.powerup_available = true;
  s.item_color_hex = "#ff8800";
  CHECK(strip_role(s) == StripRole::POWERUP_READY);
  auto a = role_frame(s, 0), b = role_frame(s, STRIP_CHASE_STEP_MS);
  CHECK(a[0] == (Rgb{255, 0x88, 0}) && b[1] == a[0] && b[0] != a[0]);
  CHECK(a[30] == Rgb{});
  s.powerup_available = false;
  s.powerup_period_s = 60;
  s.powerup_remaining_s = 30;
  CHECK(strip_role(s) == StripRole::POWERUP_REFILL);
  auto r = role_frame(s, 0);
  CHECK(r[0] != Rgb{} && r[29] != Rgb{} && r[30] == Rgb{});
  CHECK(r[0].r < 64);  // dim
  s.powerup_ended = true;
  CHECK(strip_role(s) == StripRole::OFF);
  s.powerup_ended = false;
  s.item_color_hex = "";
  s.item_is_special = true;
  CHECK(strip_item_rgb(s) == STRIP_ITEM_SPECIAL);
}

static void no_link_and_no_role_blinks_amber_slowly() {
  StickState s;
  s.link_state = LinkState::JOINING_WIFI;
  CHECK(strip_role(s) == StripRole::NO_LINK);
  CHECK(role_frame(s, 0)[0] == STRIP_AMBER);
  CHECK(role_frame(s, STRIP_AMBER_ON_MS)[0] == Rgb{});
  // a role keeps showing when the link drops (a HELD station plays on)
  auto h = hill(1, 1, 100);
  h.mc_connected = false;
  CHECK(strip_role(h) == StripRole::HILL_OWNED);
  // the standalone bench Stick never blinks amber
  StickState bench;
  CHECK(strip_role(bench) == StripRole::OFF);
}

// STRIPPOWER: GROVE keeps 300 mA, EXT (the strip on its own 5 V) allows 2000 mA, same scaling.
static void each_power_mode_has_its_own_budget() {
  CHECK_EQ(strip_budget_ma(StripPower::GROVE), 300u);
  CHECK_EQ(strip_budget_ma(StripPower::EXT), 2000u);
  for (StripPower pw : {StripPower::GROVE, StripPower::EXT}) {
    const uint32_t budget = strip_budget_ma(pw);
    std::vector<Rgb> px(60);
    strip_render(StripPattern::WHITE, 0, 0, px.data(), 60, budget);
    const uint32_t ma = strip_estimate_ma(px.data(), 60);
    CHECK(ma <= budget);
    CHECK(ma > budget * 9 / 10);  // the cap uses the budget, it does not waste it
    StickState s = hill(0, 0, 100);
    std::vector<Rgb> r(60);
    strip_render_role(s, STRIP_PULSE_MS / 2, r.data(), 60, budget);
    CHECK(strip_estimate_ma(r.data(), 60) <= budget);
  }
  std::vector<Rgb> g(60), e(60);
  strip_render(StripPattern::RED, 0, 0, g.data(), 60, STRIP_BUDGET_MA);
  strip_render(StripPattern::RED, 0, 0, e.data(), 60, STRIP_EXT_BUDGET_MA);
  CHECK(e[0].r > 4 * g[0].r);  // about 51 on the Grove 5 V, 255 on an external supply
  CHECK_EQ(e[0].r, 255);
}

// Polish review 2026-11-15: a capture's dim neutral rest, and an ended hill with no owner, returned before the final cap,
// so from 80 LEDs on GROVE the frame went over the budget (548 mA at 144). Every role, every length, both budgets.
static void every_role_stays_under_the_budget_at_every_length() {
  std::vector<StickState> states;
  for (int pct : {1, 25, 50, 99, 100}) { states.push_back(hill(-1, 1, pct)); states.push_back(hill(0, 0, pct)); states.push_back(hill(2, 2, pct)); }
  states.push_back(hill(-1, -1, 0));
  StickState ended = hill(-1, -1, 0); ended.control_ended = true; states.push_back(ended);
  StickState ended_owned = hill(1, 1, 100); ended_owned.control_ended = true; states.push_back(ended_owned);
  StickState contested = hill(0, 1, 50); contested.control_contested = true; contested.control_contest_a = 0; contested.control_contest_b = 1;
  states.push_back(contested);
  StickState waiting = hill(-1, -1, 0); waiting.control_waiting = true; states.push_back(waiting);
  StickState idle = hill(0, 0, 100); idle.control_scoring = false; states.push_back(idle);
  for (bool flash : {false, true}) { StickState r; r.link_state = LinkState::ASSIGNED; r.mc_connected = true; r.respawn_present = true;
    r.respawn_team = 2; r.respawn_redeploy = flash; states.push_back(r); }
  for (bool avail : {false, true}) { StickState p; p.link_state = LinkState::ASSIGNED; p.mc_connected = true; p.powerup_present = true;
    p.powerup_available = avail; p.powerup_known = true; p.powerup_period_s = 30; p.powerup_remaining_s = 3; p.item_color_hex = "#ffffff"; states.push_back(p); }
  StickState nolink; nolink.link_state = LinkState::ASSIGNED; nolink.mc_connected = false; states.push_back(nolink);
  for (uint32_t budget : {STRIP_BUDGET_MA, STRIP_EXT_BUDGET_MA}) {
    for (size_t n : {size_t(1), size_t(60), size_t(79), size_t(80), size_t(100), size_t(STRIP_MAX_LEDS)}) {
      for (const StickState& st : states) {
        for (uint32_t now : {0u, 700u, 1500u, 2900u}) {
          std::vector<Rgb> px(n);
          strip_render_role(st, now, px.data(), n, budget);
          const uint32_t ma = strip_estimate_ma(px.data(), n);
          if (ma > budget) std::fprintf(stderr, "role %s n=%zu budget=%u: %u mA\n", strip_role_name(strip_role(st)), n, budget, ma);
          CHECK(ma <= budget);
        }
      }
    }
  }
}

int main() {
  every_role_stays_under_the_budget_at_every_length();
  every_full_frame_stays_under_the_budget();
  a_small_frame_is_not_dimmed();
  the_cap_keeps_the_hue();
  the_walk_steps_end_to_end_and_wraps();
  sk6812_takes_green_first();
  team_colours_are_the_led_palette();
  the_bench_command_parses();
  a_neutral_hill_is_dim_white();
  a_capture_fills_the_strip_in_the_capturers_colour_at_the_progress();
  an_owned_hill_is_solid_and_pulses_slowly();
  a_contested_hill_flashes_the_two_teams_in_turn();
  a_respawn_is_steady_and_flashes_brighter_on_a_respawn();
  a_ready_powerup_chases_and_a_spent_one_refills_dark();
  no_link_and_no_role_blinks_amber_slowly();
  each_power_mode_has_its_own_budget();
  return report("strip: all checks passed");
}
