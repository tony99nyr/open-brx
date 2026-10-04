// sim/shim/M5Unified.h - the host stand-in for <M5Unified.h>, used ONLY by the screen simulator
// (sim/stick_sim.cpp). station_render.h includes <M5Unified.h>; the simulator puts this directory
// first on the include path, so the real renderer compiles unchanged against the real LovyanGFX
// sprite code from the installed M5GFX library (no panel, no SDL: a sprite draws into memory).
//
// M5Canvas here is an LGFX_Sprite that also records every drawString(): the text, its font, and
// the box its ink actually covers (drawn again on a large scratch sprite, so ink that runs off the
// 240x135 screen is measured, not clipped away). It records every drawCircle() and drawArc() the
// same way (F398: the pickup countdown ring), so the gate checks shapes against text from measured
// pixels, never from a radius copied out of station_render.h. The gate reads those boxes.
//
// Why the sprite stands for the panel (F398, checked 2026-10-03 against M5GFX 0.2.28, the version in both
// Arduino libraries folders): src/M5GFX.cpp's board_M5StickS3 branch sets a Panel_ST7789 with panel_width
// 135, panel_height 240, offset_x 52, offset_y 40, offset_rotation 0. m5sticks3.ino calls setRotation(1)
// (240 x 135), draws into a 240 x 135 M5Canvas and pushes it with pushSprite(0, 0): no scaling, no crop.
// Fonts, text datums, drawCircle and drawArc run the same LGFXBase code here and on the Stick, so a pixel
// here is the pixel on the panel. A real difference would have to come from outside that code.
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

// A circle or an arc the renderer drew (F398): what it was and the box its ink covers.
struct SimShapeRecord {
  std::string kind;  // "circle" or "arc"
  int x0 = 0, y0 = 0, x1 = 0, y1 = 0;  // ink box, inclusive, in screen pixels
};

class M5Canvas : public lgfx::LGFX_Sprite {
 public:
  static constexpr int PAD = 160;  // scratch margin around the screen, wider than any 24pt word overrun

  std::vector<SimTextRecord> texts;
  std::vector<std::string> logical;  // whole texts the fitter drew (a two-line block's full text too)
  std::vector<std::string> cuts;     // texts the fitter had to cut to width: the gate fails on any
  std::vector<SimShapeRecord> shapes;  // every drawCircle() and drawArc(), with its measured ink box

  size_t drawString(const char* s, int32_t x, int32_t y) {
    record(s, x, y);
    return lgfx::LGFX_Sprite::drawString(s, x, y);
  }

  // These hide LGFXBase's templates of the same signature (lgfx/v1/LGFXBase.hpp), so station_render.h
  // calls them unchanged; each draws the real shape on the scratch sprite first, to measure its ink.
  template <typename T>
  void drawCircle(int32_t x, int32_t y, int32_t r, const T& color) {
    shape("circle", [&](lgfx::LGFX_Sprite& s) { s.drawCircle(x + PAD, y + PAD, r, (uint8_t)0xFF); });
    lgfx::LGFX_Sprite::drawCircle(x, y, r, color);
  }
  template <typename T>
  void drawArc(int32_t x, int32_t y, int32_t r0, int32_t r1, float a0, float a1, const T& color) {
    shape("arc", [&](lgfx::LGFX_Sprite& s) { s.drawArc(x + PAD, y + PAD, r0, r1, a0, a1, (uint8_t)0xFF); });
    lgfx::LGFX_Sprite::drawArc(x, y, r0, r1, a0, a1, color);
  }

 private:
  // Clears the scratch sprite, lets `draw` ink it, and returns the ink box in screen pixels.
  template <typename F>
  bool measure(F draw, int& x0, int& y0, int& x1, int& y1) {
    const int w = width() + 2 * PAD, h = height() + 2 * PAD;
    if (!scratch_.getBuffer()) {
      scratch_.setColorDepth(8);
      scratch_.createSprite(w, h);
    }
    scratch_.fillScreen(0);
    draw(scratch_);
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
    if (maxx < 0) return false;
    x0 = minx - PAD;
    y0 = miny - PAD;
    x1 = maxx - PAD;
    y1 = maxy - PAD;
    return true;
  }

  template <typename F>
  void shape(const char* kind, F draw) {
    SimShapeRecord r;
    r.kind = kind;
    if (measure(draw, r.x0, r.y0, r.x1, r.y1)) shapes.push_back(r);
  }

  void record(const char* s, int32_t x, int32_t y) {
    SimTextRecord r;
    r.text = s ? s : "";
    r.font = sim_font_name(getFont());
    r.anchor_x = x;
    r.anchor_y = y;
    r.inked = measure([&](lgfx::LGFX_Sprite& sc) {
      sc.setFont(getFont());
      sc.setTextSize(getTextSizeX(), getTextSizeY());
      sc.setTextDatum(getTextDatum());
      sc.setTextColor(0xFF);
      sc.drawString(r.text.c_str(), x + PAD, y + PAD);
    }, r.x0, r.y0, r.x1, r.y1);
    texts.push_back(r);
  }

  lgfx::LGFX_Sprite scratch_;
};

// station_render.h's simulator hooks (it defines them as no-ops only when these are not defined).
#define BRX_RENDER_NOTE_TEXT(canvas, text) ((canvas).logical.push_back(text))
#define BRX_RENDER_NOTE_CUT(canvas, text) ((canvas).cuts.push_back(text))
