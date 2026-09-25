// station_render.h - draws a ScreenSpec (station_screen.h) with M5GFX. Arduino-only: this is the
// half of the design that `mcp/tests/test_sticks3_core.py` never builds, because it needs the real
// M5Unified/M5GFX headers. station_screen.h decides WHAT to show; this file only decides HOW to draw
// it, one to one with `mockups/render.py` (the design of record Tony approved 2026-09-24).
//
// Flicker: every screen is drawn into an off-screen M5Canvas (an M5GFX sprite) and pushed to the
// panel ONCE with pushSprite() -- nothing is ever drawn straight to M5.Display. m5sticks3.ino only
// calls renderScreen() when the ScreenSpec actually changed, or at most ~4 times a second for a
// countdown (README's "Screens" section), so drawing never competes for CPU with IR receive (RMT is
// hardware-buffered) or the Wi-Fi/BLE loop.
#pragma once
#include <cstdint>
#include <algorithm>
#include <cctype>
#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

#include <M5Unified.h>

#include "station_screen.h"

namespace brx_render {
using namespace brx;

// ---- device canvas (native M5StickS3 landscape resolution, mockups/render.py's W/H) -----------
constexpr int SCREEN_W = 240, SCREEN_H = 135;
constexpr int STRIP_H = 14, HINT_H = 14;
constexpr int MAIN_TOP = STRIP_H, MAIN_BOTTOM = SCREEN_H - HINT_H;

// ---- palette, ported from mockups/render.py's flattened CSS custom properties -----------------
inline uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}
const uint16_t COL_BG = rgb(5, 8, 13);
const uint16_t COL_PLATE = rgb(14, 26, 40);
const uint16_t COL_EDGE = rgb(42, 78, 110);
const uint16_t COL_NUM = rgb(238, 249, 255);
const uint16_t COL_MUT = rgb(127, 160, 184);
const uint16_t COL_GLOW = rgb(95, 214, 255);
const uint16_t COL_WARN = rgb(255, 176, 32);
const uint16_t COL_BAD = rgb(255, 82, 82);
const uint16_t COL_OK = rgb(57, 224, 124);
const uint16_t COL_DIM = rgb(58, 68, 80);
const uint16_t COL_SHIELD = rgb(36, 217, 196);
const uint16_t COL_NEUTRAL = rgb(90, 104, 120);

// team index 0..3 = RED/BLUE/YELLOW/GREEN, matching m5sticks3.ino's existing teamColor()/TEAM_NAMES.
const uint16_t TEAM_COLOR[4] = {rgb(244, 63, 94), rgb(58, 134, 255), rgb(255, 210, 63), rgb(46, 204, 113)};
const uint16_t TEAM_INK[4] = {rgb(26, 4, 4), rgb(4, 18, 30), rgb(26, 20, 0), rgb(4, 26, 12)};
const char* const TEAM_LETTER[4] = {"RED", "BLUE", "YELLOW", "GREEN"};

inline uint16_t teamColor(int team) { return (team >= 0 && team <= 3) ? TEAM_COLOR[team] : COL_NEUTRAL; }
inline uint16_t teamInk(int team) { return (team >= 0 && team <= 3) ? TEAM_INK[team] : COL_NUM; }

// "#rrggbb" (MC's item colour) -> rgb565; malformed or empty input falls back to `fallback`.
inline uint16_t parseHexColor(const std::string& hex, uint16_t fallback) {
  if (hex.size() != 7 || hex[0] != '#') return fallback;
  auto hexNibble = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  uint8_t v[3];
  for (int i = 0; i < 3; i++) {
    int hi = hexNibble(hex[1 + i * 2]), lo = hexNibble(hex[2 + i * 2]);
    if (hi < 0 || lo < 0) return fallback;
    v[i] = (uint8_t)((hi << 4) | lo);
  }
  return rgb(v[0], v[1], v[2]);
}

// ---- fonts and fitting text -------------------------------------------------------------------
// House look (render.py) is Saira Condensed bold, condensed + uppercase. M5GFX ships no condensed
// bold font; the closest built-ins are the Adafruit-GFX "FreeSansBold" family at four fixed point
// sizes (9/12/18/24 pt) -- bold, but not condensed, so a long word sits wider than the mockup's.
// README's "Screens" section notes converting the repo's own Saira Condensed TTF to a VLW/u8g2 font
// as a follow-up.
//
// fitCenterText NEVER draws text wider than its box (the screen gate, sim/, found 14 screens that
// did; the old picker drew with its smallest candidate whether it fitted or not). At each size, the
// caller's candidates first and then the smaller FreeSansBold sizes down to 9 pt, it tries in order:
//   1. the text on one line;
//   2. the text on two lines, when the caller gave a height (maxH) that holds two lines at that size;
//   3. the caller's documented short form (e.g. "MC" for "MISSION CONTROL"), one line then two.
// Last resort, at 9 pt: the short form (else the text) cut to the width, so nothing ever overflows.
constexpr int TEXT_MAX_W = SCREEN_W - 16;  // the widest text box: 8 px clear of each screen edge

// Hooks for the screen simulator (sim/shim/M5Unified.h defines them; on the Stick they compile away):
// NOTE_TEXT reports the whole logical text a fitter drew (a two-line block's full text, or the short form
// it chose), NOTE_CUT a last-resort cut, which the screen gate fails on.
#ifndef BRX_RENDER_NOTE_TEXT
#define BRX_RENDER_NOTE_TEXT(canvas, text) ((void)0)
#endif
#ifndef BRX_RENDER_NOTE_CUT
#define BRX_RENDER_NOTE_CUT(canvas, text) ((void)0)
#endif

inline const lgfx::GFXfont* const* fontLadder() {
  static const lgfx::GFXfont* const ladder[4] = {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b,
                                                 &fonts::FreeSansBold12pt7b, &fonts::FreeSansBold9pt7b};
  return ladder;
}

// A two-line block (the font must be set): the pitch keeps a few pixels between the lines' capitals,
// and the block is one pitch plus one capital (about 3/4 of the font height) tall. On the real metrics
// FreeSansBold9pt7b's fontHeight() is 18, so a 9 pt block needs 16 + 13 = 29 px and fits the 34 px the
// small notes pass; the screen gate pins that it wraps (EXPECT "lines" in sim/stick_sim.py).
inline int linePitch(M5Canvas& c) { return c.fontHeight() * 9 / 10; }
inline int capHeight(M5Canvas& c) { return c.fontHeight() * 3 / 4; }

// Splits `text` at one space into two lines that both fit `maxW` in the current font. A " - " or a
// ", " is the preferred break (the dash is dropped); otherwise the most even split wins.
inline bool splitTwoLines(M5Canvas& c, const std::string& text, int maxW, std::string& a, std::string& b) {
  size_t dash = text.find(" - ");
  if (dash != std::string::npos) {
    a = text.substr(0, dash);
    b = text.substr(dash + 3);
    if (c.textWidth(a.c_str()) <= maxW && c.textWidth(b.c_str()) <= maxW) return true;
  }
  size_t comma = text.find(", ");
  if (comma != std::string::npos) {
    a = text.substr(0, comma + 1);
    b = text.substr(comma + 2);
    if (c.textWidth(a.c_str()) <= maxW && c.textWidth(b.c_str()) <= maxW) return true;
  }
  int best = -1;
  for (size_t i = 0; i < text.size(); i++) {
    if (text[i] != ' ') continue;
    std::string l = text.substr(0, i), r = text.substr(i + 1);
    int w = std::max(c.textWidth(l.c_str()), c.textWidth(r.c_str()));
    if (w <= maxW && (best < 0 || w < best)) {
      best = w;
      a = l;
      b = r;
    }
  }
  return best >= 0;
}

// Cuts `text` from the end until it fits `maxW` in the current font (no trailing space).
inline std::string cutToWidth(M5Canvas& c, std::string text, int maxW) {
  if (c.textWidth(text.c_str()) > maxW) BRX_RENDER_NOTE_CUT(c, text);
  while (!text.empty() && c.textWidth(text.c_str()) > maxW) text.pop_back();
  while (!text.empty() && text.back() == ' ') text.pop_back();
  return text;
}

inline void fitCenterText(M5Canvas& c, int cx, int cy, const std::string& text, int maxW,
                           std::initializer_list<const lgfx::GFXfont*> candidates, uint16_t color,
                           int maxH = 0, const std::string& shortForm = std::string()) {
  std::vector<const lgfx::GFXfont*> sizes(candidates);
  const lgfx::GFXfont* const* ladder = fontLadder();
  int from = 0;
  for (int i = 0; i < 4; i++) if (!sizes.empty() && ladder[i] == sizes.back()) from = i + 1;
  for (int i = from; i < 4; i++) sizes.push_back(ladder[i]);
  c.setTextDatum(textdatum_t::middle_center);
  c.setTextColor(color);
  for (const lgfx::GFXfont* f : sizes) {
    c.setFont(f);
    for (const std::string* form : {&text, &shortForm}) {
      if (form->empty()) continue;
      if (c.textWidth(form->c_str()) <= maxW) {
        BRX_RENDER_NOTE_TEXT(c, *form);
        c.drawString(form->c_str(), cx, cy);
        return;
      }
      const int pitch = linePitch(c);
      std::string a, b;
      if (maxH > 0 && pitch + capHeight(c) <= maxH && splitTwoLines(c, *form, maxW, a, b)) {
        BRX_RENDER_NOTE_TEXT(c, *form);
        c.drawString(a.c_str(), cx, cy - pitch / 2);
        c.drawString(b.c_str(), cx, cy + pitch - pitch / 2);
        return;
      }
    }
  }
  c.setFont(&fonts::FreeSansBold9pt7b);
  c.drawString(cutToWidth(c, shortForm.empty() ? text : shortForm, maxW).c_str(), cx, cy);
}

// ---- status strip (top) and hint bar (bottom) -- drawn on every screen -------------------------
inline void drawBluetoothGlyph(M5Canvas& c, int cx, int cy, int size, uint16_t color) {
  float h = size, w = size * 0.6f;
  float top = cy - h / 2, bot = cy + h / 2;
  c.drawLine(cx, top, cx, bot, color);
  c.drawLine(cx - w / 2, top + h * 0.25f, cx + w / 2, bot - h * 0.25f, color);
  c.drawLine(cx + w / 2, top + h * 0.25f, cx - w / 2, bot - h * 0.25f, color);
  c.drawLine(cx, top, cx + w / 2, top + h * 0.25f, color);
  c.drawLine(cx, bot, cx + w / 2, bot - h * 0.25f, color);
}

inline int drawBatteryGlyph(M5Canvas& c, int x, int cy, int pct, int w = 16, int h = 8) {
  uint16_t color = pct > 30 ? COL_OK : (pct > LOW_BATTERY_PCT ? COL_WARN : COL_BAD);
  int top = cy - h / 2;
  c.drawRect(x, top, w + 1, h + 1, COL_MUT);
  c.fillRect(x + w + 1, top + (int)(h * 0.28f), 2, (int)(h * 0.44f) + 1, COL_MUT);
  int fillW = pct > 0 ? ((w - 2) * pct) / 100 : 0;
  if (fillW > 0) c.fillRect(x + 1, top + 1, fillW, h - 1, color);
  return x + w + 4;
}

inline void drawStatusStrip(M5Canvas& c, const StatusStripSpec& strip) {
  int y = STRIP_H / 2;
  c.drawLine(0, STRIP_H - 1, SCREEN_W, STRIP_H - 1, COL_EDGE);
  int x = 7;
  drawBluetoothGlyph(c, x, y, 9, strip.ble_on ? COL_GLOW : COL_DIM);
  x += 10;
  uint16_t mcColor = strip.mc_connected ? COL_OK : COL_BAD;
  c.fillCircle(x, y, 2, mcColor);
  x += 7;
  c.setFont(&fonts::Font0);
  c.setTextDatum(textdatum_t::middle_left);
  c.setTextColor(strip.mc_connected ? COL_MUT : mcColor);
  c.drawString("MC", x, y);
  x += c.textWidth("MC") + 6;
  c.fillCircle(x, y, 2, strip.ir_active ? COL_WARN : COL_DIM);
  x += 7;
  c.setTextColor(strip.ir_active ? COL_WARN : COL_MUT);
  c.drawString("IR", x, y);
  if (strip.locked) {
    // A58: a small padlock (shackle arc over a filled body) while the match lock is on.
    x += c.textWidth("IR") + 9;
    c.drawCircle(x + 3, y - 2, 3, COL_WARN);
    c.fillRect(x - 1, y - 1, 9, 6, COL_WARN);
  }

  int rx = SCREEN_W - 4;
  c.setTextDatum(textdatum_t::middle_right);
  c.setTextColor(COL_MUT);
  if (strip.station_id >= 0) {
    std::string sid = "#" + std::to_string(strip.station_id);
    c.drawString(sid.c_str(), rx, y);
    rx -= c.textWidth(sid.c_str()) + 10;
  }
  if (strip.battery_pct >= 0) {
    std::string pct = std::to_string(strip.battery_pct) + "%";
    int textW = c.textWidth(pct.c_str());
    int bx = rx - textW - 26;
    int endX = drawBatteryGlyph(c, bx, y, strip.battery_pct);
    c.setTextDatum(textdatum_t::middle_left);
    c.drawString(pct.c_str(), endX, y);
  }
}

inline void drawHintBar(M5Canvas& c, const std::string& hint) {
  c.drawLine(0, SCREEN_H - HINT_H, SCREEN_W, SCREEN_H - HINT_H, COL_EDGE);
  c.setFont(&fonts::Font0);
  c.setTextDatum(textdatum_t::middle_center);
  c.setTextColor(COL_MUT);
  c.drawString(hint.c_str(), SCREEN_W / 2, SCREEN_H - HINT_H / 2);
}

inline void drawKicker(M5Canvas& c, const std::string& text) {
  c.setFont(&fonts::Font0);
  c.setTextDatum(textdatum_t::top_left);
  c.setTextColor(COL_MUT);
  c.drawString(text.c_str(), 10, MAIN_TOP + 4);
}

inline void fillMain(M5Canvas& c, uint16_t color) {
  c.fillRect(0, MAIN_TOP, SCREEN_W, MAIN_BOTTOM - MAIN_TOP, color);
}

inline void drawWarnStripes(M5Canvas& c, uint16_t stripeColor) {
  int stripeW = 14;
  bool on = false;
  for (int sx = -20; sx < SCREEN_W + 20; sx += stripeW) {
    on = !on;
    if (on) {
      int x0 = sx, x1 = sx + stripeW, x2 = sx + stripeW - 10, x3 = sx - 10;
      c.fillTriangle(x0, MAIN_TOP + 22, x1, MAIN_TOP + 22, x2, MAIN_BOTTOM - 20, stripeColor);
      c.fillTriangle(x0, MAIN_TOP + 22, x2, MAIN_BOTTOM - 20, x3, MAIN_BOTTOM - 20, stripeColor);
    }
  }
}

// ---- per-kind screens, one to one with render.py's draw_hill/draw_pickup/draw_respawn/draw_system

inline void drawHill(M5Canvas& c, const ScreenSpec& s) {
  if (s.kind == ScreenKind::HILL_NEUTRAL) {
    drawKicker(c, s.hill_kicker);
    fitCenterText(c, SCREEN_W / 2, 62, "NEUTRAL", TEXT_MAX_W,
                  {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b}, COL_NUM);
    std::string note = !s.hill_note.empty() ? s.hill_note
                       : (s.hill_kicker == "BRIDGE" ? "GRENADE IS NEUTRAL" : "SHOOT TO CAPTURE");
    fitCenterText(c, SCREEN_W / 2, 104, note, TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT, 34);
  } else if (s.kind == ScreenKind::HILL_HELD) {
    uint16_t bg = teamColor(s.hill_team), ink = teamInk(s.hill_team);
    fillMain(c, bg);
    c.setFont(&fonts::Font0);
    c.setTextDatum(textdatum_t::top_left);
    c.setTextColor(ink);
    c.drawString(s.hill_kicker.c_str(), 10, MAIN_TOP + 4);
    std::string label = std::string(TEAM_LETTER[s.hill_team >= 0 && s.hill_team <= 3 ? s.hill_team : 0]) + " HOLDS";
    fitCenterText(c, SCREEN_W / 2, 60, label, TEXT_MAX_W, {&fonts::FreeSansBold18pt7b, &fonts::FreeSansBold12pt7b}, ink);
    fitCenterText(c, SCREEN_W / 2, 104, s.hill_note.empty() ? "HELD " + s.hold_time : s.hill_note,
                  TEXT_MAX_W, {&fonts::FreeSansBold12pt7b}, ink);
  } else if (s.kind == ScreenKind::HILL_CAPTURING) {
    drawKicker(c, s.hill_kicker);
    uint16_t tc = teamColor(s.hill_team);
    std::string label = std::string(TEAM_LETTER[s.hill_team >= 0 && s.hill_team <= 3 ? s.hill_team : 0]) + " " + s.hill_verb;
    fitCenterText(c, SCREEN_W / 2, 52, label, TEXT_MAX_W, {&fonts::FreeSansBold18pt7b, &fonts::FreeSansBold12pt7b}, tc);
    int bx0 = 20, bx1 = SCREEN_W - 20, by0 = 84, by1 = 96;
    c.drawRect(bx0, by0, bx1 - bx0, by1 - by0, COL_EDGE);
    c.fillRect(bx0 + 1, by0 + 1, bx1 - bx0 - 2, by1 - by0 - 2, COL_PLATE);
    int fillX = bx0 + ((bx1 - bx0 - 2) * s.hill_pct) / 100;
    if (fillX > bx0 + 1) c.fillRect(bx0 + 1, by0 + 1, fillX - bx0 - 1, by1 - by0 - 2, tc);
    fitCenterText(c, SCREEN_W / 2, 112, std::to_string(s.hill_pct) + "%", TEXT_MAX_W, {&fonts::FreeSansBold12pt7b}, COL_NUM);
  } else {  // HILL_CONTESTED
    drawKicker(c, s.hill_kicker);
    drawWarnStripes(c, rgb(40, 26, 4));
    fitCenterText(c, SCREEN_W / 2, 66, "CONTESTED", TEXT_MAX_W, {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b}, COL_WARN);
    fitCenterText(c, SCREEN_W / 2, 104, s.hill_note.empty() ? std::string("BOTH TEAMS FIRING") : s.hill_note,
                  TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT, 34);
  }
}

inline void drawPickup(M5Canvas& c, const ScreenSpec& s) {
  drawKicker(c, "PICKUP");
  uint16_t itemColor = s.item_color_hex.empty() ? (s.item_is_special ? COL_SHIELD : COL_NUM)
                                                 : parseHexColor(s.item_color_hex, COL_NUM);
  if (s.kind == ScreenKind::PICKUP_READY) {
    fitCenterText(c, SCREEN_W / 2, 50, s.item_name, TEXT_MAX_W,
                  {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b, &fonts::FreeSansBold12pt7b}, itemColor);
    fitCenterText(c, SCREEN_W / 2, 92, "STAND HERE TO TAKE", TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_OK);
  } else if (s.kind == ScreenKind::PICKUP_TAKEN) {
    fitCenterText(c, SCREEN_W / 2, 34, s.item_name, TEXT_MAX_W, {&fonts::FreeSansBold12pt7b}, COL_MUT);
    if (!s.taken_by.empty()) {
      fitCenterText(c, SCREEN_W / 2, 54, "TAKEN BY " + s.taken_by, TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT);
    }
    int cx = SCREEN_W / 2, cy = PICKUP_COUNTDOWN_INDICATOR_Y, r = 16;
    c.drawCircle(cx, cy, r, COL_EDGE);
    float frac = s.pickup_frac_pct / 100.0f;
    if (frac > 0.0f) c.drawArc(cx, cy, r - 1, r + 1, -90, -90 + 360 * frac, COL_WARN);
    fitCenterText(c, cx, 110, "NEXT SPAWN " + s.next_spawn, TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_WARN);
  } else {  // PICKUP_EMPTY: armed, no schedule from MC yet (F374)
    fitCenterText(c, SCREEN_W / 2, 46, s.item_name, TEXT_MAX_W, {&fonts::FreeSansBold12pt7b}, COL_DIM);
    fitCenterText(c, SCREEN_W / 2, 88, "EMPTY", TEXT_MAX_W, {&fonts::FreeSansBold24pt7b}, COL_DIM);
  }
}

inline void drawRespawn(M5Canvas& c, const ScreenSpec& s) {
  if (s.kind == ScreenKind::RESPAWN_OWNED) {
    uint16_t bg = teamColor(s.respawn_team), ink = teamInk(s.respawn_team);
    fillMain(c, bg);
    if (REVIVE_FEEDBACK_ENABLED) {  // the MVP layout below says RESPAWN in the body, so no kicker there
      c.setFont(&fonts::Font0);
      c.setTextDatum(textdatum_t::top_left);
      c.setTextColor(ink);
      c.drawString("RESPAWN", 10, MAIN_TOP + 4);
    }
    // respawn_team -1 is a station for any team (advert team 255): neutral colour, no team named.
    const bool named = s.respawn_team >= 0 && s.respawn_team <= 3;
    if (REVIVE_FEEDBACK_ENABLED) {  // post-MVP (presence.h): the team's respawn and its revive count
      std::string label = named ? std::string(TEAM_LETTER[s.respawn_team]) + " RESPAWN" : std::string("ANY TEAM");
      fitCenterText(c, SCREEN_W / 2, 58, label, TEXT_MAX_W, {&fonts::FreeSansBold18pt7b, &fonts::FreeSansBold12pt7b}, ink);
      fitCenterText(c, SCREEN_W / 2, 102, "REVIVES " + std::to_string(s.revives), TEXT_MAX_W, {&fonts::FreeSansBold12pt7b}, ink);
    } else {  // MVP: just the team and RESPAWN
      fitCenterText(c, SCREEN_W / 2, 56, named ? std::string(TEAM_LETTER[s.respawn_team]) : std::string("ANY TEAM"),
                    TEXT_MAX_W, {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b}, ink);
      fitCenterText(c, SCREEN_W / 2, 100, "RESPAWN", TEXT_MAX_W, {&fonts::FreeSansBold12pt7b}, ink);
    }
  } else {  // RESPAWN_IDLE
    drawKicker(c, "RESPAWN");
    fitCenterText(c, SCREEN_W / 2, 60, "IDLE", TEXT_MAX_W, {&fonts::FreeSansBold24pt7b}, COL_MUT);
    fitCenterText(c, SCREEN_W / 2, 104, s.respawn_note.empty() ? std::string("AWAITING ASSIGNMENT") : s.respawn_note,
                  TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT, 34);
  }
}

// A stats value that would run into its label is never overdrawn. In order: the value in 9 pt; the whole
// value in the small label font (Font0, 6 px a character); the part after a comma in 9 pt, the state
// that matters ("LINKED, NOT ARMED" -> "NOT ARMED"); last, cut to the width in Font0. Sets the font.
inline std::string fitKvValue(M5Canvas& c, const std::string& v, int maxW) {
  c.setFont(&fonts::FreeSansBold9pt7b);
  if (c.textWidth(v.c_str()) <= maxW) return v;
  c.setFont(&fonts::Font0);
  if (c.textWidth(v.c_str()) <= maxW) return v;
  size_t comma = v.find(", ");
  if (comma != std::string::npos) {
    std::string tail = v.substr(comma + 2);
    c.setFont(&fonts::FreeSansBold9pt7b);
    if (c.textWidth(tail.c_str()) <= maxW) return tail;
    c.setFont(&fonts::Font0);
  }
  return cutToWidth(c, v, maxW);
}

inline void drawKvRows(M5Canvas& c, const std::vector<std::pair<std::string, std::string>>& rows, int y0, int rowH) {
  c.setFont(&fonts::Font0);
  int y = y0;
  for (const auto& kv : rows) {
    c.setTextDatum(textdatum_t::middle_left);
    c.setTextColor(COL_MUT);
    c.drawString(kv.first.c_str(), 10, y);
    uint16_t vcolor = (kv.second == "PASS" || kv.second == "CONNECTED" || kv.second == "MC-ARMED") ? COL_OK
                     : (kv.second == "FAIL" || kv.second == "OFFLINE" || kv.second == "-") ? COL_MUT
                     : COL_NUM;
    const int valueMaxW = (SCREEN_W - 10) - (10 + c.textWidth(kv.first.c_str()) + 8);  // clear of the label
    const std::string value = fitKvValue(c, kv.second, valueMaxW);  // sets the font it fits in
    c.setTextDatum(textdatum_t::middle_right);
    c.setTextColor(vcolor);
    c.drawString(value.c_str(), SCREEN_W - 10, y);
    y += rowH;
    c.setFont(&fonts::Font0);
  }
}

// ---- F365: the RANGE editor -----------------------------------------------------------------------
// Two panels side by side: RADIUS (the threshold in dBm, with its rough distance) and STRENGTH (the
// advertising power, by name and dBm). The panel A/B edit is lit; each says EDITED (an on-station value
// MC has not overridden) or MC. The distances are rough (station_range.h RANGE_DISTANCE_TABLE), and the
// kicker says so.
inline void drawRangePanel(M5Canvas& c, int x0, int x1, bool active, const char* label, bool edited,
                           const std::string& value, const std::string& detail) {
  const int y0 = MAIN_TOP + 14, y1 = MAIN_BOTTOM - 3;
  if (active) {
    c.fillRect(x0, y0, x1 - x0, y1 - y0, COL_PLATE);
    c.drawRect(x0, y0, x1 - x0, y1 - y0, COL_GLOW);
    c.drawRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2, COL_GLOW);
  } else {
    c.drawRect(x0, y0, x1 - x0, y1 - y0, COL_EDGE);
  }
  c.setFont(&fonts::Font0);
  c.setTextDatum(textdatum_t::top_left);
  c.setTextColor(active ? COL_GLOW : COL_MUT);
  c.drawString(label, x0 + 6, y0 + 6);
  c.setTextDatum(textdatum_t::top_right);
  c.setTextColor(edited ? COL_WARN : COL_MUT);
  c.drawString(edited ? "EDITED" : "MC", x1 - 6, y0 + 6);
  const int cx = (x0 + x1) / 2, w = x1 - x0 - 12;
  fitCenterText(c, cx, y0 + 42, value, w, {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b},
                active ? COL_NUM : COL_MUT, 40);
  fitCenterText(c, cx, y0 + 76, detail, w, {&fonts::FreeSansBold9pt7b}, active ? COL_NUM : COL_MUT);
}

inline void drawRange(M5Canvas& c, const ScreenSpec& s) {
  drawKicker(c, "RANGE   HOLD B: DONE   ~ = ROUGH");
  std::string radiusDetail = s.range_threshold_hill
      ? std::string(range_distance_label(s.range_threshold_dbm, true))
      : "dBm  " + std::string(range_distance_label(s.range_threshold_dbm));
  int txDbm = tx_power_dbm(s.range_tx_level);
  std::string txDetail = (txDbm > 0 ? "+" : "") + std::to_string(txDbm) + " dBm";
  std::string txName = tx_power_name(s.range_tx_level);
  for (auto& ch : txName) ch = ch == '_' ? ' ' : (char)toupper((unsigned char)ch);
  drawRangePanel(c, 6, SCREEN_W / 2 - 3, !s.range_edit_strength, "RADIUS", s.range_threshold_edited,
                 std::to_string(s.range_threshold_dbm), radiusDetail);
  drawRangePanel(c, SCREEN_W / 2 + 3, SCREEN_W - 6, s.range_edit_strength, "STRENGTH", s.range_tx_edited, txName,
                 txDetail);
}

// The STATS page's "HOLD FOR RANGE" cue: the hint bar fills as A is held from 1 s towards 5 s.
// Amber fill over a light grey-blue track, dark text on both: readable at arm's length on the panel.
inline void drawRangeCue(M5Canvas& c, int pct) {
  const int y0 = SCREEN_H - HINT_H + 1;
  c.fillRect(0, y0, SCREEN_W, HINT_H - 1, COL_MUT);
  c.fillRect(0, y0, SCREEN_W * pct / 100, HINT_H - 1, COL_WARN);
  c.setFont(&fonts::Font0);
  c.setTextDatum(textdatum_t::middle_center);
  c.setTextColor(COL_BG);
  c.drawString(RANGE_CUE_HINT, SCREEN_W / 2, SCREEN_H - HINT_H / 2);
}

inline void drawSystem(M5Canvas& c, const ScreenSpec& s) {
  switch (s.kind) {
    case ScreenKind::SCR_DIAGNOSTICS: {
      drawKicker(c, "DIAGNOSTICS");
      drawKvRows(c, {{"IR HEARD", std::to_string(s.ir_heard)},
                     {"IR SENT", std::to_string(s.ir_sent)},
                     {"LAST WORD", s.last_word.empty() ? "-" : s.last_word},
                     {"SELFTEST", s.selftest.empty() ? "-" : s.selftest},
                     {"TX PIN", std::to_string(s.tx_pin)}},
                  MAIN_TOP + 20, 15);
      break;
    }
    case ScreenKind::SCR_STATS: {
      drawKicker(c, "STATS");
      drawKvRows(c, {{"KIND", s.stats_kind.empty() ? "-" : s.stats_kind},
                     {"LAST TAKEN", s.stats_last_taken.empty() ? "-" : s.stats_last_taken},
                     {"NEXT SPAWN", s.stats_next_spawn.empty() ? "-" : s.stats_next_spawn},
                     {"MC LINK", s.stats_mc_link},
                     {"BATTERY", s.stats_battery.empty() ? "-" : s.stats_battery},
                     {"IR WORDS", s.stats_ir_words}},
                  MAIN_TOP + 20, 15);
      break;
    }
    case ScreenKind::SCR_SETTINGS: {  // not wired to any button flow yet; kept for design completeness
      drawKicker(c, "SETTINGS");
      int y0 = MAIN_TOP + 22, rowH = 19;
      c.setFont(&fonts::FreeSansBold12pt7b);
      for (size_t i = 0; i < s.settings_rows.size(); i++) {
        int y = y0 + (int)i * rowH;
        bool hi = (int)i == s.settings_highlighted;
        if (hi) c.fillRect(6, y - 2, SCREEN_W - 12, rowH - 2, COL_PLATE);
        c.setTextDatum(textdatum_t::middle_left);
        c.setTextColor(hi ? COL_GLOW : COL_MUT);
        c.drawString(s.settings_rows[i].c_str(), 14, y + rowH / 2 - 4);
      }
      break;
    }
    case ScreenKind::SCR_ASSIGNED: {
      drawKicker(c, "ASSIGNED");
      fitCenterText(c, SCREEN_W / 2, 58, s.assigned_role, TEXT_MAX_W,
                    {&fonts::FreeSansBold18pt7b, &fonts::FreeSansBold12pt7b}, COL_OK);
      fitCenterText(c, SCREEN_W / 2, 100, "BY MISSION CONTROL", TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT);
      break;
    }
    case ScreenKind::SCR_LINKED_WAITING:
      drawKicker(c, "SYSTEM");
      fitCenterText(c, SCREEN_W / 2, 52, "LINKED", TEXT_MAX_W,
                    {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b}, COL_NUM);
      fitCenterText(c, SCREEN_W / 2, 96, "ASSIGN ME IN MC", TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT);
      break;
    case ScreenKind::SCR_JOINING: {
      drawKicker(c, "SYSTEM");
      // Still associating: say so, and never WI-FI CONNECTED (gate finding 2026-09-24). Short form: MC.
      if (s.wifi_joined) {
        fitCenterText(c, SCREEN_W / 2, 58, "LOOKING FOR MISSION CONTROL", TEXT_MAX_W, {&fonts::FreeSansBold18pt7b}, COL_NUM, 60,
                      "LOOKING FOR MC");
      } else {
        fitCenterText(c, SCREEN_W / 2, 58, "JOINING WI-FI", TEXT_MAX_W, {&fonts::FreeSansBold18pt7b}, COL_NUM, 60);
      }
      int cx = SCREEN_W / 2;
      for (int i = 0; i < 3; i++) {
        bool on = i < s.dot_phase;
        c.fillCircle(cx - 16 + i * 16, 96, 3, on ? COL_GLOW : COL_DIM);
      }
      c.setFont(&fonts::Font0);
      c.setTextDatum(textdatum_t::middle_center);
      c.setTextColor(COL_MUT);
      if (s.wifi_joined) c.drawString("WI-FI CONNECTED", cx, 112);
      break;
    }
    case ScreenKind::SCR_LOW_BATTERY: {
      drawWarnStripes(c, rgb(28, 10, 10));
      drawKicker(c, "SYSTEM");
      fitCenterText(c, SCREEN_W / 2, 56, "LOW BATTERY", TEXT_MAX_W, {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b}, COL_BAD, 56);
      fitCenterText(c, SCREEN_W / 2, 104, std::to_string(s.strip.battery_pct) + "%", TEXT_MAX_W, {&fonts::FreeSansBold18pt7b}, COL_BAD);
      break;
    }
    case ScreenKind::SCR_RESET_CONFIRM: {
      drawKicker(c, "RESET");
      fitCenterText(c, SCREEN_W / 2, 46, "HOLD B AGAIN", TEXT_MAX_W, {&fonts::FreeSansBold18pt7b}, COL_WARN);
      std::string line2 = "TO RESET STATION #" + std::to_string(s.station_id_for_reset);
      fitCenterText(c, SCREEN_W / 2, 70, line2, TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_NUM);
      int bx0 = 20, bx1 = SCREEN_W - 20, by0 = 96, by1 = 106;
      c.drawRect(bx0, by0, bx1 - bx0, by1 - by0, COL_EDGE);
      c.fillRect(bx0 + 1, by0 + 1, bx1 - bx0 - 2, by1 - by0 - 2, COL_PLATE);
      int fillX = (bx1 - bx0 - 2) * s.reset_timeout_pct / 100;
      if (fillX > 0) c.fillRect(bx0 + 1, by0 + 1, fillX, by1 - by0 - 2, COL_WARN);
      break;
    }
    case ScreenKind::SCR_RESET_SENT: {
      drawKicker(c, "RESET");
      fitCenterText(c, SCREEN_W / 2, 48, "RESET SENT", TEXT_MAX_W, {&fonts::FreeSansBold18pt7b}, COL_OK);
      fitCenterText(c, SCREEN_W / 2, 88, "WAITING FOR MISSION CONTROL", TEXT_MAX_W, {&fonts::FreeSansBold12pt7b}, COL_MUT, 44,
                    "WAITING FOR MC");
      break;
    }
    case ScreenKind::SCR_RESET_NEEDS_MC: {
      drawKicker(c, "RESET");
      fitCenterText(c, SCREEN_W / 2, 56, "RESET NEEDS MISSION CONTROL", TEXT_MAX_W, {&fonts::FreeSansBold18pt7b}, COL_BAD, 60,
                    "RESET NEEDS MC");
      fitCenterText(c, SCREEN_W / 2, 104, "MC OFFLINE - TRY AGAIN LATER", TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT, 34);
      break;
    }
    case ScreenKind::SCR_RESET_LOCKED: {
      drawKicker(c, "RESET");
      fitCenterText(c, SCREEN_W / 2, 48, "LOCKED", TEXT_MAX_W, {&fonts::FreeSansBold18pt7b}, COL_WARN);
      fitCenterText(c, SCREEN_W / 2, 76, "MATCH IN PROGRESS", TEXT_MAX_W, {&fonts::FreeSansBold12pt7b}, COL_MUT);
      fitCenterText(c, SCREEN_W / 2, 100, "UNLOCKS IN " + s.lock_remaining, TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT);
      break;
    }
    case ScreenKind::SCR_RANGE:
      drawRange(c, s);
      break;
    case ScreenKind::SCR_FORCE_RESTART: {
      drawKicker(c, "SYSTEM");
      fitCenterText(c, SCREEN_W / 2, 56, "RESTART IN " + std::to_string(s.restart_in_s), TEXT_MAX_W,
                    {&fonts::FreeSansBold18pt7b, &fonts::FreeSansBold12pt7b}, COL_BAD);
      fitCenterText(c, SCREEN_W / 2, 90, "KEEP HOLDING A + B", TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT);
      break;
    }
    default:
      break;
  }
}

// The one entry point m5sticks3.ino calls. `canvas` must already be 240x135 (createSprite once in
// setup()); this fills it and leaves it to the caller to pushSprite().
inline void renderScreen(M5Canvas& canvas, const ScreenSpec& spec) {
  canvas.fillScreen(COL_BG);
  switch (spec.kind) {
    case ScreenKind::SCR_NO_WIFI:
      drawKicker(canvas, "SETUP");
      fitCenterText(canvas, SCREEN_W / 2, 58, "NO WI-FI", TEXT_MAX_W,
                    {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b}, COL_NUM);
      fitCenterText(canvas, SCREEN_W / 2, 100, "SET IT OVER USB", TEXT_MAX_W, {&fonts::FreeSansBold9pt7b}, COL_MUT);
      break;
    case ScreenKind::RESPAWN_REDEPLOY:
      fillMain(canvas, rgb(20, 170, 70));
      fitCenterText(canvas, SCREEN_W / 2, 58, "REDEPLOY", TEXT_MAX_W,
                    {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b}, rgb(255, 255, 255));
      fitCenterText(canvas, SCREEN_W / 2, 102, "REVIVES " + std::to_string(spec.revives), TEXT_MAX_W,
                    {&fonts::FreeSansBold12pt7b}, rgb(255, 255, 255));
      break;
    case ScreenKind::BRIDGE_WAITING:
      drawKicker(canvas, "BRIDGE");
      fitCenterText(canvas, SCREEN_W / 2, 58, "NO BEACON", TEXT_MAX_W,
                    {&fonts::FreeSansBold24pt7b, &fonts::FreeSansBold18pt7b}, COL_NUM);
      fitCenterText(canvas, SCREEN_W / 2, 102, "MOVE NEAR A GRENADE", TEXT_MAX_W,
                    {&fonts::FreeSansBold9pt7b}, COL_MUT, 34);
      break;
    case ScreenKind::HILL_NEUTRAL:
    case ScreenKind::HILL_HELD:
    case ScreenKind::HILL_CAPTURING:
    case ScreenKind::HILL_CONTESTED:
      drawHill(canvas, spec);
      break;
    case ScreenKind::PICKUP_READY:
    case ScreenKind::PICKUP_TAKEN:
    case ScreenKind::PICKUP_EMPTY:
      drawPickup(canvas, spec);
      break;
    case ScreenKind::RESPAWN_OWNED:
    case ScreenKind::RESPAWN_IDLE:
      drawRespawn(canvas, spec);
      break;
    default:
      drawSystem(canvas, spec);
      break;
  }
  drawStatusStrip(canvas, spec.strip);
  if (spec.range_cue_pct >= 0) drawRangeCue(canvas, spec.range_cue_pct);
  else drawHintBar(canvas, spec.hint);
}

}  // namespace brx_render
