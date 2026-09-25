// sim/shim/M5Unified.h - the host stand-in for <M5Unified.h>, used ONLY by the screen simulator
// (sim/stick_sim.cpp). station_render.h includes <M5Unified.h>; the simulator puts this directory
// first on the include path, so the real renderer compiles unchanged against the real LovyanGFX
// sprite code from the installed M5GFX library (no panel, no SDL: a sprite draws into memory).
//
// M5Canvas here is an LGFX_Sprite that also records every drawString(): the text, its font, and
// the box its ink actually covers (drawn again on a large scratch sprite, so ink that runs off the
// 240x135 screen is measured, not clipped away). The gate reads those boxes.
#pragma once
#include <lgfx/v1/LGFX_Sprite.hpp>

#include <cstdint>
#include <string>
#include <vector>

// `fonts::` is already a global namespace in lgfx_fonts.hpp, as on the device.
using lgfx::textdatum_t;

struct SimTextRecord {
  std::string text;
  std::string font;
  int anchor_x = 0, anchor_y = 0;
  bool inked = false;  // false: nothing visible (an empty string)
  int x0 = 0, y0 = 0, x1 = 0, y1 = 0;  // ink box, inclusive, in screen pixels (may lie off screen)
};

inline std::string sim_font_name(const lgfx::IFont* f) {
  if (f == &fonts::FreeSansBold9pt7b) return "FreeSansBold9pt7b";
  if (f == &fonts::FreeSansBold12pt7b) return "FreeSansBold12pt7b";
  if (f == &fonts::FreeSansBold18pt7b) return "FreeSansBold18pt7b";
  if (f == &fonts::FreeSansBold24pt7b) return "FreeSansBold24pt7b";
  if (f == &fonts::Font0) return "Font0";
  return "other";
}

class M5Canvas : public lgfx::LGFX_Sprite {
 public:
  static constexpr int PAD = 160;  // scratch margin around the screen, wider than any 24pt word overrun

  std::vector<SimTextRecord> texts;

  size_t drawString(const char* s, int32_t x, int32_t y) {
    record(s, x, y);
    return lgfx::LGFX_Sprite::drawString(s, x, y);
  }

 private:
  void record(const char* s, int32_t x, int32_t y) {
    SimTextRecord r;
    r.text = s ? s : "";
    r.font = sim_font_name(getFont());
    r.anchor_x = x;
    r.anchor_y = y;
    const int w = width() + 2 * PAD, h = height() + 2 * PAD;
    if (!scratch_.getBuffer()) {
      scratch_.setColorDepth(8);
      scratch_.createSprite(w, h);
    }
    scratch_.fillScreen(0);
    scratch_.setFont(getFont());
    scratch_.setTextSize(getTextSizeX(), getTextSizeY());
    scratch_.setTextDatum(getTextDatum());
    scratch_.setTextColor(0xFF);
    scratch_.drawString(r.text.c_str(), x + PAD, y + PAD);
    const uint8_t* buf = (const uint8_t*)scratch_.getBuffer();
    int minx = w, miny = h, maxx = -1, maxy = -1;
    for (int yy = 0; yy < h; yy++) {
      const uint8_t* row = buf + (size_t)yy * w;
      for (int xx = 0; xx < w; xx++) {
        if (row[xx]) {
          if (xx < minx) minx = xx;
          if (xx > maxx) maxx = xx;
          if (yy < miny) miny = yy;
          if (yy > maxy) maxy = yy;
        }
      }
    }
    if (maxx >= 0) {
      r.inked = true;
      r.x0 = minx - PAD;
      r.y0 = miny - PAD;
      r.x1 = maxx - PAD;
      r.y1 = maxy - PAD;
    }
    texts.push_back(r);
  }

  lgfx::LGFX_Sprite scratch_;
};
