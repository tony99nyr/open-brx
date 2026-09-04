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

⚠️ **A SEGMENTED BAR DOES NOT WORK ON A SPAWNED GUN** (measured 2026-09-02, 7 samples per case).
While the native animation runs, a MIXED frame does not produce mixed output: setting `$GLED,5,9,9`
left all three LEDs lit at 194/204/191, indistinguishable from `$GLED,5,5,5` at 199/209/195. What DOES
work in game is the WHOLE STRIP: a uniform colour holds (our hue dominates), and `$GLED,9,9,9` really
does blank it (155 against 209 native). So in a live game the strip is a ONE-COLOUR indicator, not a
three-segment bar. The per-segment mapping below is still correct and still verified on an unspawned
gun, and is kept for pre-game and lobby use.

This retracts "F1's three-segment gauge is buildable", which was measured on a UNIFORM colour and
generalised to per-segment control without testing that step.

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

# --- THE EVENT BURST, tuned on hardware 2026-09-03 --------------------------- #
# A single paint is NOT reliably visible on a spawned gun: the firmware repaints the strip within
# ~0.33 s (median) and often sooner, so one frame is a coin flip -- Tony, watching it: "i didnt see
# it". Three short flashes fix it two ways: redundancy (if the firmware swallows one, another lands)
# and rhythm (a deliberate triple-blink reads as an event, not as a glitch). Tony's verdict on this
# pattern: "that is the best so far by a lot".
#
# ⚠️ DO NOT ADD A FOURTH FLASH. The general guidance is no more than THREE flashes in any one-second
# window, and this burst already puts 3 into ~0.46 s. Tightening the separation stays within that;
# adding a flash does not. (The gun's LEDs are a small source rather than a full field, which is the
# mitigating factor here -- it is not licence to go further.)
#
# Also do NOT repaint DURING a flash to make it "solid": winning the strip outright takes ~30 Hz,
# which strobes, and that is the whole reason the detailed feedback lives on the phone HUD.
BURST_FLASHES = 3
BURST_FLASH_S = 0.08
BURST_GAP_S = 0.10
# Minimum wall-clock between two bursts for the SAME player. Three flashes is the per-second ceiling,
# so two bursts a second apart would double it. A dropped second paint is better than exceeding it.
BURST_MIN_SPACING_S = 1.0


def event_burst(event: str, team: int | None, night: bool = False) -> list[tuple[str, float]]:
    """The full (frame, hold_seconds) sequence for one event, ending back on the team colour.

    Pure: no I/O, no clock. The caller plays it. Returns [] for an unknown event.
    """
    frame = event_frame(event, night)
    if frame is None:
        return []
    back = team_frame(team, night)
    out: list[tuple[str, float]] = []
    for i in range(BURST_FLASHES):
        out.append((frame, BURST_FLASH_S))
        out.append((back, BURST_GAP_S if i < BURST_FLASHES - 1 else 0.0))
    return out

# Brightness (token 5): 0 off, 1 dim, >=2 full. Night mode dims the strip so a lit gun does not
# blind its own player or give their position away in the dark.
BRIGHT_FULL, BRIGHT_DIM = 10, 1

# ⚠️⚠️ DO NOT DRIVE THESE BY HAMMERING `$GLED` IN A LIVE GAME. ⚠️⚠️
# Repainting at ~30 Hz does win the hue (93% of frames vs 18% for a single paint), but the result
# STROBES -- the operator's words on seeing it were "it looks like its having a seizure". Flicker in
# roughly the 10-25 Hz band is the photosensitive-epilepsy trigger range, and this sits on a gun in a
# dark arena in front of a player's face for a whole match. Hue-dominance per frame is not perceived
# steadiness, and the measurement that said 93% was answering the wrong question.
#
# The headset is the right surface: in native play it is DARK, so a single `$HLED` frame has nothing
# to fight. Keep `$GLED` for pre-game and lobby, where nothing is animating and it renders cleanly.
#
# --- WHICH SURFACE? Split by WHO THE MESSAGE IS FOR ------------------------- #
# Tony: *"you cant see your own head to confirm a kill or know your health"*. That decides the
# split, and it is not the one this file first assumed:
#
#   GUN STRIP  = what the PLAYER sees. Health / armour / shield, and anything they must act on.
#                Contested by the firmware's own animation, so a single paint BREATHES our colour in
#                and out (~18% of frames) rather than holding. That is acceptable for a pulse and is
#                the ONLY safe option: winning it outright needs ~30 Hz hammering, which strobes.
#   HEADSET    = what OTHER PLAYERS see. Hit taken, out, team. Dark in native play, so a single
#                `$HLED` frame has nothing to fight -- no hammering, no strobe. Nobody needs to read
#                their own headset, which is exactly why it is the safe surface.
#
# And for a kill confirm the gun already has a NATIVE answer: `$SFLASH`, the green sight flash, which
# `GameDriver` already sends on `KillConfirm`. It is in the sight the player is already looking
# through, and it costs no LED fight at all. Prefer it over painting the strip.
#
# --- EVENT PAINTS ----------------------------------------------------------- #
# Tony: "when we get a hit we should flash something. when we get hit we should flash something.
# when we get healed or get shields or get armor we should paint leds. when we die, when we respawn."
#
# These are WHOLE-STRIP colours on purpose: that is the only thing that reliably holds while the
# native animation runs (see the module note). Each carries its own hold time, because the events
# differ in how long they should own the strip -- a kill confirm is a blink, being out is a state.
EVENT_PAINTS = {
    #  event         colour   hold_s   why this colour
    "hit_landed":   (WHITE,   0.6),   # you hit someone: brief, bright, unmistakable
    "hit_taken":    (RED,     0.8),   # you were hit: red is the one colour nobody has to learn
    "healed":       (GREEN,   1.5),   # health restored
    "armour_up":    (PURPLE,  1.5),   # matches the armour pool hue
    "shield_up":    (TEAL,    1.5),   # matches the shield pool hue
    "died":         (RED,     3.0),   # you are out: long, and red so it reads across the field
    "respawned":    (WHITE,   1.2),   # back in: a clean flash before the team colour returns
    "kill_confirm": (ORANGE,  0.6),   # you finished someone
}


def event_frame(event: str, night: bool = False) -> str | None:
    """Whole-strip paint for a game event, or None if the event has no paint.

    Whole-strip because that is what survives the native animation in a live game. Night mode drops
    to the dim brightness rather than changing colour: hue is the message, brightness is comfort.
    """
    spec = EVENT_PAINTS.get(event)
    if spec is None:
        return None
    colour, _hold = spec
    b = BRIGHT_DIM if night else BRIGHT_FULL
    return f"$GLED,{colour},{colour},{colour},0,{b},,*"


def event_hold_s(event: str) -> float:
    """How long this event owns the strip before the team colour returns."""
    spec = EVENT_PAINTS.get(event)
    return spec[1] if spec else 0.0


def _segments(level: int, maximum: int) -> int:
    """How many of the three LEDs are lit for `level` out of `maximum`.

    Anything above zero lights at least one segment: a player on 1 HP must not look identical to a
    player who is out. Zero lights none.
    """
    if maximum <= 0 or level <= 0:
        return 0
    # Exact integer ceiling. The earlier `-(-round(frac*300)//100)` was a rounded ceiling and
    # mis-binned cases like 335/1000, where banker's rounding of 100.5 lands on 100.
    return max(1, min(3, -(-min(level, maximum) * 3 // maximum)))


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


def gauge_frame(pool: str, level: int, maximum: int, night: bool = False) -> str:
    """One `$GLED` frame showing `level`/`maximum` as a three-segment bar for `pool`.

    ⚠️ Segments only render on an UNSPAWNED gun (pre-game, lobby). In a live game use
    `pool_paint_frame`, which carries the same information as a whole-strip colour.
    """
    lit = _segments(level, maximum)
    colour = pool_colour(pool, level, maximum)
    leds = [colour if i < lit else DARK for i in range(3)]
    b = BRIGHT_DIM if night else BRIGHT_FULL
    return f"$GLED,{leds[0]},{leds[1]},{leds[2]},0,{b},,*"


def pool_paint_frame(pool: str, level: int, maximum: int, night: bool = False) -> str:
    """The IN-GAME form: the whole strip in the pool's colour.

    A live gun cannot show segments, so level is carried by HUE alone -- which is why health shifts
    green/yellow/red as it falls, and why shield and armour keep a constant hue (their level is not
    the urgent part; which pool moved is).
    """
    colour = pool_colour(pool, level, maximum)
    b = BRIGHT_DIM if night else BRIGHT_FULL
    return f"$GLED,{colour},{colour},{colour},0,{b},,*"


def team_frame(team: int | None, night: bool = False) -> str:
    """Revert frame: all three LEDs to the team colour."""
    c = TEAM_COLOURS.get(team, DEFAULT_TEAM_COLOUR)
    b = BRIGHT_DIM if night else BRIGHT_FULL
    return f"$GLED,{c},{c},{c},0,{b},,*"


def headset_team_frame(team: int | None) -> str:
    """The HEADSET in the team colour, static, full brightness -- what OTHER players see.

    Bench 2026-09-03 (`hled_spawned.py`, `hled_bright.py`, gun R0BP1-9498, operator watching):
      * a static `$HLED` painted AFTER `$SPAWN` holds SOLID (20 s, no breathing, no fight) -- the
        headset really is uncontested between events;
      * `$SPAWN` CLEARS it, and so does every registered HIT (native flash, then dark, ours never
        returns) -- so it has to be re-sent after each spawn and each `$HIR`, which is what
        `GameDriver` does;
      * a paint 1 s after spawn lit, so no post-spawn settling gap is needed (the >= 3 s rule is for
        AFTER A DEATH, F13);
      * token 5 is a two-level brightness exactly like the gun's: 1 dim, 2/10/255 identical and
        maximum. 10 (Callsign's value) is already full. The dim team blink seen at spawn is the
        firmware's own and cannot be turned up -- we paint over it instead.
    Colour indices 0-7 are shared with the gun palette (camera rig, 2026-09-02). Never dimmed for
    night mode: callers skip the headset entirely when LEDs are off, because lighting a player's
    head in a blackout game is the one thing that setting exists to prevent.
    """
    c = TEAM_COLOURS.get(team, DEFAULT_TEAM_COLOUR)
    return f"$HLED,{c},0,,,{BRIGHT_FULL},,*"


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
