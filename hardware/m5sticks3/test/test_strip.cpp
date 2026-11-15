// Host tests for led_strip.h: the power cap, the wire bytes and the bench patterns.
#include "check.h"
#include "led_strip.h"

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

int main() {
  every_full_frame_stays_under_the_budget();
  a_small_frame_is_not_dimmed();
  the_cap_keeps_the_hue();
  the_walk_steps_end_to_end_and_wraps();
  sk6812_takes_green_first();
  team_colours_are_the_led_palette();
  the_bench_command_parses();
  return report("strip: all checks passed");
}
