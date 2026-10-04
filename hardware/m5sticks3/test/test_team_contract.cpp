#include <cstdio>
#include <string>

#include "station_team.h"

int main() {
  if (std::string(brx_render::TEAM_LETTER[3]) != "PURPLE" ||
      brx_render::TEAM_COLOR[3] != brx_render::rgb(191, 76, 230)) {
    std::printf("FAIL team 3 renders PURPLE in #bf4ce6\n");
    return 1;
  }
  std::puts("all checks passed");
  return 0;
}
