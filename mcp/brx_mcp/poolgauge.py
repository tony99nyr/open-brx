"""F1: paint health / armour / shield onto the three gun LEDs, then revert to the team colour.

Tony's spec, verbatim: *"during game we want to be able to take over and show shield health. after a
time of no damage reset to team color."* … *"on health/armor/shield change +/- the leds should
indicate that status. then after a few seconds maybe 3-5s go back to team color or mode color."*

**Why we are driving this from the host at all.** The stock firmware has a segmented gauge -- Tony
saw it on Supremacy's Marauder -- so the cheap answer would have been a config field, costing one
setting instead of a BLE write per hit. That was hunted on hardware 2026-09-02 and **ruled out**:
ten candidates (`$GSET` t8 gameMods 1/2/4/8/16, `$GSET` t4, `$GSET` t5, `$PSET` t2) all left the
three LEDs moving together with no per-segment collapse. See `experiment-log.md` 2026-09-02 (night,
F1). So we paint it.

Everything here is PURE: frames in, frames out, no I/O and no clock. The driver owns the timer and
the sending. That keeps the mapping testable without a tagger, which matters because the LED
semantics below cost two sessions to establish and are easy to get subtly wrong.

`$GLED,<led1>,<led2>,<led3>,<apply-gate>,<brightness>,,*`
  * tokens 1-3 are direct palette indices, one per LED
  * token 4 is an APPLY GATE, not an effect: 0/6/7/8/9/10 apply at full brightness, 5 applies at
    ~1/3, and 1/2/3/4 are NO-OPS that leave whatever was lit before still lit
  * token 5 is brightness: 0 off, 1 dim, >=2 full
Encode with COLOUR, not brightness: at the dim setting our colour stops being the dominant hue in
the frame (measured 2026-09-02), so a dim gauge is not reliably readable.
"""
from __future__ import annotations

# The nine-colour palette, read off a gun 2026-09-02. 9 and above are dark.
RED, BLUE, YELLOW, GREEN, PURPLE, TEAL, WHITE, PINK, ORANGE = range(9)
DARK = 9

# Our choice, not the gun's: nothing on the wire dictates a team colour. Blue/red first because they
# are the two the taggers already pulse pre-game, so they read as "team" to a player without being
# taught.
TEAM_COLOURS = {1: BLUE, 2: RED, 3: YELLOW, 4: GREEN}
DEFAULT_TEAM_COLOUR = WHITE

# Pool identity is carried by HUE so the player can tell at a glance WHICH bar they are looking at.
SHIELD_COLOUR = TEAL
ARMOUR_COLOUR = PURPLE
# Health additionally shifts colour as it falls -- the one bar where the level itself is urgent.
HEALTH_BANDS = ((0.66, GREEN), (0.33, YELLOW), (0.0, RED))

REVERT_AFTER_S = 4.0     # Tony: "a few seconds maybe 3-5s"


def _segments(level: int, maximum: int) -> int:
    """How many of the three LEDs are lit for `level` out of `maximum`.

    Anything above zero lights at least one segment: a player on 1 HP must not look identical to a
    player who is out. Zero lights none.
    """
    if maximum <= 0 or level <= 0:
        return 0
    frac = min(1.0, level / maximum)
    return max(1, min(3, -(-round(frac * 300) // 100)))   # ceil to a third, without float drift


def health_colour(level: int, maximum: int) -> int:
    if maximum <= 0:
        return GREEN
    frac = max(0.0, min(1.0, level / maximum))
    for threshold, colour in HEALTH_BANDS:
        if frac > threshold:
            return colour
    return RED


def pool_colour(pool: str, level: int, maximum: int) -> int:
    if pool == "shield":
        return SHIELD_COLOUR
    if pool == "armor":
        return ARMOUR_COLOUR
    return health_colour(level, maximum)


def gauge_frame(pool: str, level: int, maximum: int) -> str:
    """One `$GLED` frame showing `level`/`maximum` as a three-segment bar for `pool`."""
    lit = _segments(level, maximum)
    colour = pool_colour(pool, level, maximum)
    leds = [colour if i < lit else DARK for i in range(3)]
    return f"$GLED,{leds[0]},{leds[1]},{leds[2]},0,10,,*"


def team_frame(team: int | None) -> str:
    """Revert frame: all three LEDs to the team colour."""
    c = TEAM_COLOURS.get(team, DEFAULT_TEAM_COLOUR)
    return f"$GLED,{c},{c},{c},0,10,,*"


def changed_pool(before: tuple[int, int, int] | None,
                 after: tuple[int, int, int]) -> str | None:
    """Which of (hp, armor, shield) moved? Returns 'health' | 'armor' | 'shield' | None.

    Shield first, then armour, then health -- BRX depletes in that order, so when a single hit spills
    across two pools the INNER one is the news. A hit that takes the last of the shield and bites
    into armour should show armour, because that is what the player has left.
    """
    if before is None:
        return None
    hp0, ar0, sh0 = before
    hp1, ar1, sh1 = after
    if hp1 != hp0:
        return "health"
    if ar1 != ar0:
        return "armor"
    if sh1 != sh0:
        return "shield"
    return None
