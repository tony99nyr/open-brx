#!/usr/bin/env python3
"""BRX M5StickS3 station screen mockups.

Every screen is drawn as a pure function of a state dict: `render(state) -> PIL.Image`.
The state shape and the layout grid (status strip / main block / hint bar) are meant to
port straight onto the firmware's M5GFX renderer later: each drawing helper below maps
onto an M5GFX call (fillRect, drawString, drawLine, fillTriangle, ...).

No hardware, no BLE, no firmware here. This is a visual reference only.

Run:
    /tmp/claude-1000/mockvenv/bin/python3 render.py

Writes one screen per state, upscaled 3x (720x405) with nearest-neighbour, to
/tmp/claude-1000/stick-mockups/<group>_<state>.png, plus one labelled grid
/tmp/claude-1000/stick-mockups/gallery.png.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Device canvas

W, H = 240, 135            # native M5StickS3 landscape resolution
EXPORT_SCALE = 3           # per-screen PNG scale (nearest-neighbour, so pixels stay crisp)
OUT_DIR = Path("/tmp/claude-1000/stick-mockups")

STRIP_H = 14                # top status strip
HINT_H = 14                 # bottom button-hint bar
MAIN_TOP = STRIP_H
MAIN_BOTTOM = H - HINT_H    # main block is [MAIN_TOP, MAIN_BOTTOM)

# ---------------------------------------------------------------------------
# Palette, ported from app/www/index.html's CSS custom properties (the phone HUD's
# look) so the Stick reads as the same product family, not a different device.

BG = (5, 8, 13)             # --bg, flattened (the CSS is a radial gradient; a small
                             # single-colour OLED-ish panel doesn't need one)
PLATE = (14, 26, 40)        # --plate, flattened from rgba(12,28,44,.85) over BG
EDGE = (42, 78, 110)        # --edge
NUM = (238, 249, 255)       # --num, near-white text
MUT = (127, 160, 184)       # --mut, dim label text
GLOW = (95, 214, 255)       # --glow, cyan accent (BLE / link)
WARN = (255, 176, 32)       # --warn
BAD = (255, 82, 82)         # --bad
OK = (57, 224, 124)         # --ok
DIM = (58, 68, 80)          # off/disabled icon or text
SHIELD = (36, 217, 196)     # --shield: a non-weapon item's own colour (Overshield)

TEAM_COLOR = {
    "blue": (58, 134, 255),
    "yellow": (255, 210, 63),
    "red": (244, 63, 94),
    "green": (46, 204, 113),
    None: (90, 104, 120),      # neutral / unassigned
}
TEAM_INK = {
    "blue": (4, 18, 30),
    "yellow": (26, 20, 0),
    "red": (26, 4, 4),
    "green": (4, 26, 12),
    None: NUM,
}

# ---------------------------------------------------------------------------
# Fonts. House look is Saira Condensed bold, condensed + uppercase. Fall back to
# DejaVu Sans Condensed Bold (bundled with the OS) if the repo copy isn't found.

_BOLD_CANDIDATES = [
    "/home/tony/brx4-l3/app/www/fonts/saira-condensed-700.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
]
_SEMI_CANDIDATES = [
    "/home/tony/brx4-l3/app/www/fonts/saira-condensed-600.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
]

FONT_BOLD = next((p for p in _BOLD_CANDIDATES if Path(p).exists()), None)
FONT_SEMI = next((p for p in _SEMI_CANDIDATES if Path(p).exists()), None)
if FONT_BOLD is None:
    raise SystemExit("No usable bold condensed font found (checked repo + DejaVu).")


@lru_cache(maxsize=None)
def font(size: int, semi: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_SEMI if (semi and FONT_SEMI) else FONT_BOLD
    return ImageFont.truetype(path, size)


def text_size(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont) -> tuple[int, int]:
    l, t, r, b = draw.textbbox((0, 0), text, font=f)
    return r - l, b - t


def fit_font(draw: ImageDraw.ImageDraw, text: str, max_w: int, start: int, min_size: int = 10,
             semi: bool = False) -> ImageFont.FreeTypeFont:
    """Shrink point size until `text` fits max_w, never below min_size."""
    size = start
    f = font(size, semi)
    while size > min_size and text_size(draw, text, f)[0] > max_w:
        size -= 1
        f = font(size, semi)
    return f


def center_text(draw, cx, cy, text, f, fill):
    w, h = text_size(draw, text, f)
    l, t, _, _ = draw.textbbox((0, 0), text, font=f)
    draw.text((cx - w / 2 - l, cy - h / 2 - t), text, font=f, fill=fill)


def left_text(draw, x, cy, text, f, fill):
    w, h = text_size(draw, text, f)
    l, t, _, _ = draw.textbbox((0, 0), text, font=f)
    draw.text((x - l, cy - h / 2 - t), text, font=f, fill=fill)


def right_text(draw, x, cy, text, f, fill):
    w, h = text_size(draw, text, f)
    l, t, _, _ = draw.textbbox((0, 0), text, font=f)
    draw.text((x - w - l, cy - h / 2 - t), text, font=f, fill=fill)


# ---------------------------------------------------------------------------
# Status strip (top) and hint bar (bottom) - drawn on every screen so the grid
# stays consistent across kinds. Each icon is a tiny glyph the firmware can
# redraw with a handful of M5GFX primitives (fillTriangle / drawRect / fillCircle).

def draw_bluetooth_glyph(draw, cx, cy, size, color):
    """A simplified bluetooth bowtie: two triangles meeting at the centre line."""
    h = size
    w = size * 0.6
    top = cy - h / 2
    bot = cy + h / 2
    draw.line([(cx, top), (cx, bot)], fill=color, width=1)
    draw.line([(cx - w / 2, top + h * 0.25), (cx + w / 2, bot - h * 0.25)], fill=color, width=1)
    draw.line([(cx + w / 2, top + h * 0.25), (cx - w / 2, bot - h * 0.25)], fill=color, width=1)
    draw.line([(cx, top), (cx + w / 2, top + h * 0.25)], fill=color, width=1)
    draw.line([(cx, bot), (cx + w / 2, bot - h * 0.25)], fill=color, width=1)


def draw_battery_glyph(draw, x, cy, pct, w=16, h=8):
    color = OK if pct > 30 else (WARN if pct > 12 else BAD)
    top = cy - h / 2
    draw.rectangle([x, top, x + w, top + h], outline=MUT, width=1)
    draw.rectangle([x + w + 1, top + h * 0.28, x + w + 2, top + h * 0.72], fill=MUT)
    fill_w = max(0, round((w - 2) * (pct / 100)))
    if fill_w:
        draw.rectangle([x + 1, top + 1, x + 1 + fill_w, top + h - 1], fill=color)
    return x + w + 4


def draw_status_strip(draw, state):
    y = STRIP_H / 2 - 0.5
    draw.line([(0, STRIP_H - 1), (W, STRIP_H - 1)], fill=EDGE, width=1)

    x = 4
    ble_on = state.get("ble", True)
    draw_bluetooth_glyph(draw, x + 3, y, 9, GLOW if ble_on else DIM)
    x += 10

    mc = state.get("mc", "connected")  # "connected" | "offline"
    mc_color = OK if mc == "connected" else BAD
    draw.ellipse([x, y - 2, x + 4, y + 2], fill=mc_color)
    x += 7
    f8 = font(8)
    draw.text((x, y - 4), "MC", font=f8, fill=mc_color if mc != "connected" else MUT)
    x += text_size(draw, "MC", f8)[0] + 6

    ir_active = state.get("ir_active", False)
    draw.ellipse([x, y - 2, x + 4, y + 2], fill=WARN if ir_active else DIM)
    x += 7
    draw.text((x, y - 4), "IR", font=f8, fill=WARN if ir_active else MUT)

    # right side: battery pct then station id
    sid = state.get("station_id")
    if sid is not None:
        sid_text = f"#{sid}"
        right_text(draw, W - 4, y, sid_text, f8, MUT)
        sid_w = text_size(draw, sid_text, f8)[0]
    else:
        sid_w = 0

    battery = state.get("battery")
    if battery is not None:
        bx = W - 4 - sid_w - 10 - 26
        end_x = draw_battery_glyph(draw, bx, y, battery)
        pct_text = f"{battery}%"
        draw.text((end_x, y - 4), pct_text, font=f8, fill=MUT)


def draw_hint_bar(draw, hint: str):
    draw.line([(0, H - HINT_H), (W, H - HINT_H)], fill=EDGE, width=1)
    f = font(9, semi=True)
    center_text(draw, W / 2, H - HINT_H / 2, hint, f, MUT)


#: Players never touch these buttons (a pickup is stand-here-1s, items spawn on the
#: match clock). Both buttons are OPERATOR-only, so the default hint names operator
#: actions, not player ones.
DEFAULT_HINT = "A: STATS   HOLD B: RESET"


# ---------------------------------------------------------------------------
# Shared main-block chrome: a kicker label near the top of the main block, used
# by every screen kind so the grid reads consistently.

def kicker(draw, text):
    f = font(10, semi=True)
    draw.text((10, MAIN_TOP + 4), text.upper(), font=f, fill=MUT)


def fill_main(draw, color):
    draw.rectangle([0, MAIN_TOP, W, MAIN_BOTTOM], fill=color)


# ---------------------------------------------------------------------------
# HILL (control point)

def draw_hill(draw, state):
    st = state["state"]
    if st == "neutral":
        kicker(draw, "HILL POINT")
        center_text(draw, W / 2, 62, "NEUTRAL", font(34), NUM)
        f = fit_font(draw, "SHOOT TO CAPTURE", W - 20, 14, semi=True)
        center_text(draw, W / 2, 106, "SHOOT TO CAPTURE", f, MUT)

    elif st == "held":
        team = state["team"]
        fill_main(draw, TEAM_COLOR[team])
        ink = TEAM_INK[team]
        f = font(10, semi=True)
        draw.text((10, MAIN_TOP + 4), "HILL POINT", font=f, fill=ink)
        label = f"{team.upper()} HOLDS"
        f2 = fit_font(draw, label, W - 20, 30)
        center_text(draw, W / 2, 60, label, f2, ink)
        hold_time = state.get("hold_time", "00:00")
        f3 = font(16, semi=True)
        center_text(draw, W / 2, 104, f"HELD {hold_time}", f3, ink)

    elif st == "capturing":
        team = state["team"]
        pct = state["pct"]
        kicker(draw, "HILL POINT")
        label = f"{team.upper()} CAPTURING"
        f = fit_font(draw, label, W - 20, 24)
        center_text(draw, W / 2, 52, label, f, TEAM_COLOR[team])
        # progress bar, skewed like the phone HUD's .bar elements
        bx0, bx1, by0, by1 = 20, W - 20, 84, 96
        draw.rectangle([bx0, by0, bx1, by1], outline=EDGE, width=1, fill=PLATE)
        fill_x = bx0 + round((bx1 - bx0 - 2) * (pct / 100))
        if fill_x > bx0 + 1:
            draw.rectangle([bx0 + 1, by0 + 1, fill_x, by1 - 1], fill=TEAM_COLOR[team])
        center_text(draw, W / 2, 112, f"{pct}%", font(14, semi=True), NUM)

    elif st == "contested":
        kicker(draw, "HILL POINT")
        # warning stripes, skewed, alternating warn/dark
        stripe_w = 14
        for i, sx in enumerate(range(-20, W + 20, stripe_w)):
            if i % 2 == 0:
                draw.polygon([(sx, MAIN_TOP + 22), (sx + stripe_w, MAIN_TOP + 22),
                              (sx + stripe_w - 10, MAIN_BOTTOM - 20), (sx - 10, MAIN_BOTTOM - 20)],
                             fill=(40, 26, 4))
        f = fit_font(draw, "CONTESTED", W - 20, 32)
        center_text(draw, W / 2, 66, "CONTESTED", f, WARN)
        f2 = font(12, semi=True)
        center_text(draw, W / 2, 106, "BOTH TEAMS FIRING", f2, MUT)


# ---------------------------------------------------------------------------
# PICKUP (powerup station)

def draw_pickup(draw, state):
    st = state["state"]
    item = state["item"]                       # names are capped at 12 chars (design rule)
    item_color = state.get("item_color", NUM)  # each item shows in its own colour (weapon vs not)
    kicker(draw, "PICKUP")

    if st == "ready":
        # Names are short enough now (<=12 chars) to fit at hero size without scrolling; the
        # marquee_frame() helper stays available below for a future name that genuinely overflows.
        f = fit_font(draw, item, W - 16, 36, min_size=22)
        center_text(draw, W / 2, 50, item, f, item_color)
        f2 = fit_font(draw, "STAND HERE TO TAKE", W - 20, 16, semi=True)
        center_text(draw, W / 2, 92, "STAND HERE TO TAKE", f2, OK)

    elif st == "taken":
        fname = fit_font(draw, item, W - 20, 20)
        center_text(draw, W / 2, 34, item, fname, MUT)
        taken_by = state.get("taken_by")
        if taken_by:
            f_tb = fit_font(draw, f"TAKEN BY {taken_by}", W - 20, 12, semi=True)
            center_text(draw, W / 2, 50, f"TAKEN BY {taken_by}", f_tb, MUT)

        # The ring alone carries the countdown (a bare arc, no digits inside it) so the one
        # line of text below states the spawn time exactly once, instead of twice.
        frac = max(0.0, min(1.0, state.get("frac", 0.5)))
        cx, cy, r = W / 2, 84, 16
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=EDGE, width=2)
        draw.arc([cx - r, cy - r, cx + r, cy + r], start=-90, end=-90 + 360 * frac, fill=WARN, width=3)

        remaining = state["remaining"]
        f2 = fit_font(draw, f"NEXT SPAWN {remaining}", W - 20, 13, semi=True)
        center_text(draw, cx, 110, f"NEXT SPAWN {remaining}", f2, WARN)

    elif st == "empty":
        fname = fit_font(draw, item, W - 20, 20)
        center_text(draw, W / 2, 46, item, fname, DIM)
        f = font(30)
        center_text(draw, W / 2, 88, "EMPTY", f, DIM)


# ---------------------------------------------------------------------------
# RESPAWN

def draw_respawn(draw, state):
    kicker_team = state.get("team")
    if kicker_team:
        fill_main(draw, TEAM_COLOR[kicker_team])
        ink = TEAM_INK[kicker_team]
        draw.text((10, MAIN_TOP + 4), "RESPAWN", font=font(10, semi=True), fill=ink)
        label = f"{kicker_team.upper()} RESPAWN"
        f = fit_font(draw, label, W - 20, 28)
        center_text(draw, W / 2, 58, label, f, ink)
        revives = state.get("revives", 0)
        f2 = font(16, semi=True)
        center_text(draw, W / 2, 102, f"REVIVES {revives}", f2, ink)
    else:
        kicker(draw, "RESPAWN")
        center_text(draw, W / 2, 60, "IDLE", font(34), MUT)
        f = fit_font(draw, "AWAITING ASSIGNMENT", W - 20, 13, semi=True)
        center_text(draw, W / 2, 104, "AWAITING ASSIGNMENT", f, MUT)


# ---------------------------------------------------------------------------
# SYSTEM pages

def draw_kv_rows(draw, rows, y0=None, row_h=15):
    """A label/value list: label left, value right, one row per tuple. Shared by
    DIAGNOSTICS and STATS so the two operator readouts stay visually identical."""
    f = font(11, semi=True)
    y = MAIN_TOP + 20 if y0 is None else y0
    for label, value in rows:
        draw.text((10, y), label, font=f, fill=MUT)
        vcolor = OK if value in ("PASS", "CONNECTED") else (BAD if value in ("FAIL", "OFFLINE") else NUM)
        vf = fit_font(draw, value, 118, 11, min_size=9, semi=True)
        right_text(draw, W - 10, y + 6, value, vf, vcolor)
        y += row_h


def draw_system(draw, state):
    page = state["page"]

    if page == "diagnostics":
        kicker(draw, "DIAGNOSTICS")
        draw_kv_rows(draw, [
            ("IR HEARD", str(state["heard"])),
            ("IR SENT", str(state["sent"])),
            ("LAST WORD", state["last_word"]),
            ("SELFTEST", state["selftest"]),
            ("TX PIN", str(state["tx_pin"])),
        ])

    elif page == "stats":
        kicker(draw, "STATS")
        draw_kv_rows(draw, [
            ("KIND", state["station_kind"]),
            ("LAST TAKEN", state["last_taker"]),
            ("NEXT SPAWN", state["next_spawn"]),
            ("MC LINK", state["mc"].upper()),
            ("BATTERY", f"{state['battery']}%"),
            ("IR WORDS", f"{state['heard']}/{state['sent']}"),
        ], row_h=14)  # 6 rows: a touch tighter than diagnostics' 5 so the last row clears the hint bar

    elif page == "settings":
        kicker(draw, "SETTINGS")
        rows = state["rows"]
        hi = state["highlighted"]
        f = font(13, semi=True)
        row_h = 19
        y0 = MAIN_TOP + 22
        for i, label in enumerate(rows):
            y = y0 + i * row_h
            color = GLOW if i == hi else MUT
            if i == hi:
                # Size the highlight to the glyphs' own bbox (ascenders + descenders),
                # not a fixed offset from row_h - that clipped tall letters before.
                l, t, r, b = draw.textbbox((14, y), label, font=f)
                pad = 3
                draw.rectangle([6, t - pad, W - 6, b + pad], fill=PLATE, outline=GLOW, width=1)
            draw.text((14, y), label, font=f, fill=color)

    elif page == "reset_confirm":
        kicker(draw, "RESET")
        station_id = state.get("station_id")
        f1 = fit_font(draw, "HOLD B AGAIN", W - 20, 26)
        center_text(draw, W / 2, 46, "HOLD B AGAIN", f1, WARN)
        line2 = f"TO RESET STATION #{station_id}"
        f2 = fit_font(draw, line2, W - 20, 14, semi=True)
        center_text(draw, W / 2, 70, line2, f2, NUM)
        # a draining timeout bar: the operator has a few seconds to confirm the hold
        frac = max(0.0, min(1.0, state.get("timeout_frac", 0.6)))
        bx0, bx1, by0, by1 = 20, W - 20, 96, 106
        draw.rectangle([bx0, by0, bx1, by1], outline=EDGE, width=1, fill=PLATE)
        fill_x = bx0 + round((bx1 - bx0 - 2) * frac)
        if fill_x > bx0 + 1:
            draw.rectangle([bx0 + 1, by0 + 1, fill_x, by1 - 1], fill=WARN)

    elif page == "reset_sent":
        kicker(draw, "RESET")
        f1 = fit_font(draw, "RESET SENT", W - 20, 28)
        center_text(draw, W / 2, 48, "RESET SENT", f1, OK)
        f2 = fit_font(draw, "WAITING FOR", W - 20, 16, semi=True)
        center_text(draw, W / 2, 78, "WAITING FOR", f2, MUT)
        f3 = fit_font(draw, "MISSION CONTROL", W - 20, 16, semi=True)
        center_text(draw, W / 2, 98, "MISSION CONTROL", f3, MUT)

    elif page == "reset_needs_mc":
        kicker(draw, "RESET")
        f1 = fit_font(draw, "RESET NEEDS", W - 20, 26)
        center_text(draw, W / 2, 48, "RESET NEEDS", f1, BAD)
        f2 = fit_font(draw, "MISSION CONTROL", W - 20, 20)
        center_text(draw, W / 2, 74, "MISSION CONTROL", f2, BAD)
        f3 = fit_font(draw, "MC OFFLINE - TRY AGAIN LATER", W - 20, 11, semi=True)
        center_text(draw, W / 2, 102, "MC OFFLINE - TRY AGAIN LATER", f3, MUT)

    elif page == "assigned":
        kicker(draw, "ASSIGNED")
        role = state["role"]
        f = fit_font(draw, role, W - 20, 30)
        center_text(draw, W / 2, 58, role, f, OK)
        f2 = fit_font(draw, "BY MISSION CONTROL", W - 20, 13, semi=True)
        center_text(draw, W / 2, 100, "BY MISSION CONTROL", f2, MUT)

    elif page == "joining":
        kicker(draw, "SYSTEM")
        f1 = fit_font(draw, "LOOKING FOR", W - 20, 22)
        center_text(draw, W / 2, 46, "LOOKING FOR", f1, NUM)
        f2 = fit_font(draw, "MISSION CONTROL", W - 20, 22)
        center_text(draw, W / 2, 70, "MISSION CONTROL", f2, NUM)
        dots = state.get("dot_phase", 1)
        cx = W / 2
        for i in range(3):
            on = i < dots
            draw.ellipse([cx - 16 + i * 16 - 3, 96 - 3, cx - 16 + i * 16 + 3, 96 + 3],
                         fill=GLOW if on else DIM)
        f3 = font(9, semi=True)
        center_text(draw, W / 2, 112, "WI-FI CONNECTED", f3, MUT)

    elif page == "low_battery":
        stripe_w = 14
        for i, sx in enumerate(range(-20, W + 20, stripe_w)):
            if i % 2 == 0:
                draw.polygon([(sx, MAIN_TOP), (sx + stripe_w, MAIN_TOP),
                              (sx + stripe_w - 8, MAIN_BOTTOM), (sx - 8, MAIN_BOTTOM)],
                             fill=(28, 10, 10))
        kicker(draw, "SYSTEM")
        f = fit_font(draw, "LOW BATTERY", W - 20, 32)
        center_text(draw, W / 2, 60, "LOW BATTERY", f, BAD)
        pct = state["battery"]
        f2 = font(20, semi=True)
        center_text(draw, W / 2, 102, f"{pct}%", f2, BAD)


# ---------------------------------------------------------------------------
# Top-level render

def render(state: dict) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    kind = state["kind"]
    if kind == "hill":
        draw_hill(draw, state)
    elif kind == "pickup":
        draw_pickup(draw, state)
    elif kind == "respawn":
        draw_respawn(draw, state)
    elif kind == "system":
        draw_system(draw, state)
    else:
        raise ValueError(f"unknown kind {kind!r}")

    draw_status_strip(draw, state)
    draw_hint_bar(draw, state.get("hint", DEFAULT_HINT))
    return img


# ---------------------------------------------------------------------------
# The screen catalogue. One row per group in the gallery, in this order.

STRIP_DEFAULTS = dict(ble=True, mc="connected", ir_active=False, battery=82, station_id=3)


def s(**kw):
    d = dict(STRIP_DEFAULTS)
    d.update(kw)
    return d


SCENES: list[tuple[str, list[tuple[str, dict]]]] = [
    ("hill", [
        ("neutral", s(kind="hill", state="neutral")),
        ("held_blue", s(kind="hill", state="held", team="blue", hold_time="04:12")),
        ("capturing_red", s(kind="hill", state="capturing", team="red", pct=62)),
        ("contested", s(kind="hill", state="contested")),
    ]),
    ("pickup", [
        ("ready_rockets", s(kind="pickup", state="ready", item="ROCKETS")),
        ("ready_overshield", s(kind="pickup", state="ready", item="OVERSHIELD", item_color=SHIELD)),
        ("taken_railgun", s(kind="pickup", state="taken", item="RAIL GUN", taken_by="VIPER",
                            remaining="1:40", frac=0.35)),
        ("empty", s(kind="pickup", state="empty", item="RAIL GUN")),
    ]),
    ("respawn", [
        ("blue_owned", s(kind="respawn", team="blue", revives=7)),
        ("idle", s(kind="respawn", team=None)),
    ]),
    ("system", [
        ("diagnostics", s(kind="system", page="diagnostics", heard=128, sent=64,
                          last_word="P7 T1 M9 OK", selftest="PASS", tx_pin=46, ir_active=True)),
        ("settings", s(kind="system", page="settings",
                       rows=["MODE", "STATION ID", "TX PIN", "BRIGHTNESS"], highlighted=0,
                       hint="B: NEXT   HOLD B: CHANGE")),
        ("assigned", s(kind="system", page="assigned", role="HILL #2")),
        ("joining", s(kind="system", page="joining", dot_phase=2, mc="offline")),
        ("low_battery", s(kind="system", page="low_battery", battery=8, mc="offline")),
        ("stats", s(kind="system", page="stats", station_kind="PICKUP - ROCKETS",
                    last_taker="VIPER", next_spawn="1:40", heard=128, sent=64)),
        ("reset_confirm", s(kind="system", page="reset_confirm", station_id=3,
                            timeout_frac=0.6, hint="A: CANCEL")),
        ("reset_sent", s(kind="system", page="reset_sent")),
        ("reset_needs_mc", s(kind="system", page="reset_needs_mc", mc="offline")),
    ]),
]


# ---------------------------------------------------------------------------
# Export: per-screen PNGs (3x, nearest-neighbour) + one labelled gallery grid.

def export_all():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rendered: list[tuple[str, str, Image.Image]] = []

    for group, states in SCENES:
        for name, state in states:
            img = render(state)
            big = img.resize((W * EXPORT_SCALE, H * EXPORT_SCALE), Image.NEAREST)
            out_path = OUT_DIR / f"{group}_{name}.png"
            big.save(out_path)
            rendered.append((group, name, img))
            print(f"wrote {out_path}")

    build_gallery(rendered)


def build_gallery(rendered: list[tuple[str, str, Image.Image]]):
    cell_scale = 2
    cell_w, cell_h = W * cell_scale, H * cell_scale
    label_h = 30
    pad = 14

    by_group: dict[str, list[tuple[str, Image.Image]]] = {}
    for group, name, img in rendered:
        by_group.setdefault(group, []).append((name, img))

    max_cols = max(len(v) for v in by_group.values())
    rows = len(by_group)

    gw = pad + max_cols * (cell_w + pad)
    gh = pad + rows * (cell_h + label_h + pad) + 40  # +40 for a title band

    gallery = Image.new("RGB", (gw, gh), (2, 4, 7))
    gd = ImageDraw.Draw(gallery)
    gd.text((pad, 10), "M5STICKS3 STATION SCREENS", font=font(18), fill=NUM)

    y = 40 + pad
    for group, items in by_group.items():
        x = pad
        for name, img in items:
            thumb = img.resize((cell_w, cell_h), Image.NEAREST)
            gallery.paste(thumb, (x, y))
            gd.rectangle([x, y, x + cell_w, y + cell_h], outline=EDGE, width=1)
            label = f"{group.upper()} — {name.upper().replace('_', ' ')}"
            lf = fit_font(gd, label, cell_w, 13, min_size=9, semi=True)
            center_text(gd, x + cell_w / 2, y + cell_h + label_h / 2, label, lf, MUT)
            x += cell_w + pad
        y += cell_h + label_h + pad

    gallery_path = OUT_DIR / "gallery.png"
    gallery.save(gallery_path)
    print(f"wrote {gallery_path}")


if __name__ == "__main__":
    export_all()
