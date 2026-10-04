#pragma once
#include <cstdint>

#include "contract.gen.h"

namespace brx_render {

constexpr uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

constexpr int hex_nibble(char c) {
  return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10
       : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
}

constexpr uint16_t rgb_from_hex(const char* hex) {
  const int r = hex_nibble(hex[1]) * 16 + hex_nibble(hex[2]);
  const int g = hex_nibble(hex[3]) * 16 + hex_nibble(hex[4]);
  const int b = hex_nibble(hex[5]) * 16 + hex_nibble(hex[6]);
  return rgb((uint8_t)r, (uint8_t)g, (uint8_t)b);
}

constexpr uint16_t TEAM_COLOR[] = {
    rgb_from_hex(brx::contract::TEAM_COLOUR_HEX[0]), rgb_from_hex(brx::contract::TEAM_COLOUR_HEX[1]),
    rgb_from_hex(brx::contract::TEAM_COLOUR_HEX[2]), rgb_from_hex(brx::contract::TEAM_COLOUR_HEX[3]),
};
constexpr uint16_t TEAM_INK[] = {
    rgb_from_hex(brx::contract::TEAM_INK_HEX[0]), rgb_from_hex(brx::contract::TEAM_INK_HEX[1]),
    rgb_from_hex(brx::contract::TEAM_INK_HEX[2]), rgb_from_hex(brx::contract::TEAM_INK_HEX[3]),
};
constexpr const char* const* TEAM_LETTER = brx::contract::TEAM_NAMES;

}  // namespace brx_render
