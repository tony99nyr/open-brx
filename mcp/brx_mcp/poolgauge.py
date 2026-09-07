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

⚠️ **A SEGMENTED BAR DOES NOT WORK ON A GUN THAT IS STILL BREATHING** (measured 2026-09-02, 7 samples
per case). While the native spawn animation runs, a MIXED frame does not produce mixed output: setting
`$GLED,5,9,9` left all three LEDs lit at 194/204/191, indistinguishable from `$GLED,5,5,5` at
199/209/195. What DOES work while breathing is the WHOLE STRIP: a uniform colour holds (our hue
dominates), and `$GLED,9,9,9` really does blank it (155 against 209 native).

This retracted "F1's three-segment gauge is buildable", which was measured on a UNIFORM colour and
generalised to per-segment control without testing that step.

**PARTIALLY RE-RETRACTED 2026-09-04** (`mc.presentation` `GUN_BLANK`, A11.7/S4): `$GLED,,,,5,,,*` takes
the strip OUT of the breathing loop entirely, and a mixed frame painted after that blank DOES render
per-segment and HOLDS. So the per-segment mapping below is not just a pregame/lobby fallback -- it is
buildable in a live game too, provided the gun is blanked first. What is still unverified (see
`led-language.md` §2): the hold surviving minutes with no traffic, whether `$PLAY`/`$AMMO`/`$HLED`/
`$LED` disturb a held paint, and a dim (token 5 = 1) paint keeping its hue after a blank. Nothing in
this module drives the blank itself yet -- that lives in `mc.presentation`/`mc.compile`, and the
transient in-play readout `gauge_frame` would need to drive is a design (`led-language.md` §3.1), not
built here (led-language.md §6 finding #5).

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

# Our choice, not the gun's: nothing on the wire dictates a team colour, so the tid IS the palette
# index by default -- red 0 / blue 1 / yellow 2 / green 3, matching `state.py`'s TEAM_DEFS and the
# headset's own painting. This is the WIRE IDENTITY map (F33 below); the colour actually PAINTED is a
# separate lookup, `TEAM_DISPLAY_COLOURS`, a few lines down -- see its comment for why.
# F33 (2026-09-07 bench, led-language.md §6 #1): this table used to be OFFSET from the server's tids
# (`{1: BLUE, 2: RED, 3: YELLOW, 4: GREEN}`), so a yellow-team (tid 2) gun painted RED, a red-team
# (tid 0, not a key at all) gun fell through to DEFAULT_TEAM_COLOUR (WHITE), and only blue (tid 1, the
# one colour every bench happened to test) ever agreed with the headset.
TEAM_COLOURS = {0: RED, 1: BLUE, 2: YELLOW, 3: GREEN}
DEFAULT_TEAM_COLOUR = WHITE   # an unknown/None tid (5th+ team, or no team yet) -- not itself a bug

# F35 (bench 2026-09-07, FOLLOWUPS): the IR word's team field is only 2 BITS, so a gun armed on
# `$TID,4`-`$TID,7` transmits `tid & 3` on the wire while the VICTIM compares the shooter's word
# against its own FULL tid -- proven both directions: a `$TID,4` gun took FULL damage from a team-0
# shot (a real friendly hit misread as hostile), and a tid>=4 player's own shots read as a DIFFERENT,
# lower team to everyone else, who then treat them as friendly and take nothing. Teams 4-7 are
# therefore BROKEN for combat; only 0-3 are valid `$TID` values. Validated in `state.py` (config
# teams) and `mc.compile.Compiler.validate()`. The COLOUR range (0-7, below) is NOT affected by this --
# it is a separate, cosmetic lookup and colours 4-7 are bench-confirmed fine on both surfaces.
TEAM_TIDS = tuple(range(4))

# led-language.md §6 finding #11 / Q19: FFA has no team identity to protect, so both surfaces paint
# WHITE (palette 6, "white is usually used for ffa" -- Tony, matches stock behaviour) for every player
# instead of a per-player colour. FFA's own `$TID` stays within TEAM_TIDS (0-3) -- only the PAINT is
# fixed to white, same colour/identity split as `TEAM_DISPLAY_COLOURS` below.
FFA_COLOUR = WHITE

# Headset colour indices the palette is confirmed on: 0-3 bench 2026-09-02/03, 4-7 (purple/teal/white/
# pink, the SAME palette as the gun) bench-confirmed 2026-09-07 -- shared with the gun's own 0-8
# palette. led-language.md §6 finding #13: `compile.py` used to allow only 0-3 here while
# `presentation.py` allowed 0-7 -- one constant, both modules agree on 0-7. Colour 8 (orange on the
# gun) is still UNVERIFIED on the headset (the protocol doc claims it reads red there) and stays out
# of this range.
HEADSET_TIDS = tuple(range(8))

# The colour actually PAINTED for a team -- decoupled from `TEAM_COLOURS` (the wire identity a gun
# fights under). Bench 2026-09-07: green reads as the headset's own native hit/out flash at range
# (led-language.md §6 finding #11), and colours 4-7 are now confirmed on the headset, so team 3 keeps
# GREEN on the wire (`$TID,3`, F35 -- its combat identity cannot move) but PAINTS purple instead.
# `display_colour()` is the one place this mapping happens; nothing else should assume colour == tid.
TEAM_DISPLAY_COLOURS = {0: RED, 1: BLUE, 2: YELLOW, 3: PURPLE}


def display_colour(tid: int | None, overrides: dict[int, int] | None = None) -> int:
    """The colour to PAINT for wire team `tid`: an explicit per-tid override first (a future
    presentation-profile knob -- none ships yet, this is the hook for it), else `TEAM_DISPLAY_COLOURS`,
    else the generic fallback. `tid` itself is never returned as a colour by assumption."""
    if overrides and tid in overrides:
        return overrides[tid]
    return TEAM_DISPLAY_COLOURS.get(tid, DEFAULT_TEAM_COLOUR)

# Pool identity is carried by HUE so the player can tell at a glance WHICH bar they are looking at.
# F33-adjacent (led-language.md §3.1 readout mapping, 2026-09-07 design review): shield reads WHITE,
# not teal -- teal was never bench-validated as the shield hue and the reviewed readout table calls
# for white/purple/health-band on the three pools.
SHIELD_COLOUR = WHITE
ARMOUR_COLOUR = PURPLE
# Health additionally shifts colour as it falls -- the one bar where the level itself is urgent.
HEALTH_BANDS = ((0.66, GREEN), (0.33, YELLOW), (0.0, RED))
# The transient pool readout (led-language.md §3.1/§5): fraction-of-max -> how many of the 3 LEDs
# light up. Same thresholds as HEALTH_BANDS, expressed as segment counts rather than colours so
# shield/armour (constant hue) and health (hue shifts per band) can share one table shape.
READOUT_THRESHOLDS = ((0.66, 3), (0.33, 2), (0.0, 1))

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
# The headset is the right surface for THIS module's bursts: in native play it is DARK, so a single
# `$HLED` frame has nothing to fight -- no hammering, no strobe. `$GLED` renders cleanly in pre-game
# and lobby too, where nothing is animating; whether it can also hold cleanly IN PLAY is not "no"
# any more -- `mc.presentation`'s `$GLED,,,,5,,,*` blank (2026-09-04) takes the strip out of the
# breathing loop first, and a paint after that holds uncontested. This module's own bursts
# (`event_burst`, `gauge_frame`) do not use that blank and still fight the breathing as described below.
#
# --- WHICH SURFACE? Split by WHO THE MESSAGE IS FOR ------------------------- #
# Tony: *"you cant see your own head to confirm a kill or know your health"*. That decides the
# split, and it is not the one this file first assumed:
#
#   GUN STRIP  = what the PLAYER sees. Health / armour / shield, and anything they must act on.
#                THIS MODULE's bursts are contested by the firmware's own animation (no blank is sent),
#                so a single paint BREATHES our colour in and out (~18% of frames) rather than holding --
#                acceptable for a pulse, and the ONLY safe option without a blank: winning it outright
#                needs ~30 Hz hammering, which strobes. (A blanked gun does not have this problem --
#                see above -- but nothing here drives that path.)
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

    ⚠️ Segments only render while the gun's native animation is running if it is UNSPAWNED (pre-game,
    lobby) or already blanked (`mc.presentation.GUN_BLANK`, 2026-09-04) -- on a SPAWNED, unblanked gun
    the breathing loop wins and a mixed frame reads as one solid colour. `pool_paint_frame` (below)
    carries the same information as a whole-strip colour and is always safe on a breathing gun.
    """
    lit = _segments(level, maximum)
    colour = pool_colour(pool, level, maximum)
    leds = [colour if i < lit else DARK for i in range(3)]
    b = BRIGHT_DIM if night else BRIGHT_FULL
    return f"$GLED,{leds[0]},{leds[1]},{leds[2]},0,{b},,*"


def pool_paint_frame(pool: str, level: int, maximum: int, night: bool = False) -> str:
    """The IN-GAME form: the whole strip in the pool's colour.

    The safe choice for a BREATHING (unblanked) gun, where segments are not reliable: level is carried
    by HUE alone -- which is why health shifts green/yellow/red as it falls, and why shield and armour
    keep a constant hue (their level is not the urgent part; which pool moved is). A blanked gun can
    show real segments instead (`gauge_frame`); this module does not decide which one a live game uses.
    """
    colour = pool_colour(pool, level, maximum)
    b = BRIGHT_DIM if night else BRIGHT_FULL
    return f"$GLED,{colour},{colour},{colour},0,{b},,*"


def segment_frame(colour: int, lit: int, night: bool = False) -> str:
    """A `$GLED` frame with the first `lit` (0-3) of the three LEDs in `colour`, the rest dark.

    The BLANKED-gun form of a pool reading (led-language.md §3.1/§5): unlike `pool_paint_frame`
    (whole strip, safe on a still-breathing gun), this is only meaningful once the strip has been
    taken out of the native animation (`mc.presentation.GUN_BLANK`) -- callers that paint a live,
    unblanked gun should use `pool_paint_frame` instead.
    """
    leds = [colour if i < lit else DARK for i in range(3)]
    b = BRIGHT_DIM if night else BRIGHT_FULL
    return f"$GLED,{leds[0]},{leds[1]},{leds[2]},0,{b},,*"


def readout_bands(pool: str, night: bool = False) -> list[tuple[float, str]]:
    """[[fraction_above, frame], ...], highest band first, for the transient pool readout
    (led-language.md §5 `gun.readout.pools[].bands`). The node picks the first band whose
    `level/max` exceeds `fraction_above`; a level of exactly 0 exceeds none of them, so the caller
    reverts to the gun's rest frame -- there is no "0" row here (down: dark, §3.1).

    Shield and armour hold ONE hue across all three bands (only the segment count moves); health's
    hue shifts band to band too (`HEALTH_BANDS`), so its row pairs each threshold with its own colour.
    """
    if pool == "shield":
        return [(thr, segment_frame(SHIELD_COLOUR, lit, night)) for thr, lit in READOUT_THRESHOLDS]
    if pool == "armor":
        return [(thr, segment_frame(ARMOUR_COLOUR, lit, night)) for thr, lit in READOUT_THRESHOLDS]
    if pool == "health":
        return [(thr, segment_frame(colour, lit, night))
                for (thr, colour), (_thr2, lit) in zip(HEALTH_BANDS, READOUT_THRESHOLDS)]
    raise ValueError(f"readout_bands: unknown pool {pool!r}")


def team_frame(team: int | None, night: bool = False, ffa: bool = False) -> str:
    """Revert frame: all three LEDs to the team's PAINT colour (`display_colour`, e.g. purple for the
    green team, F35/finding #11), or WHITE for every player in FFA (Q19)."""
    c = FFA_COLOUR if ffa else display_colour(team)
    b = BRIGHT_DIM if night else BRIGHT_FULL
    return f"$GLED,{c},{c},{c},0,{b},,*"


def headset_team_frame(team: int | None, ffa: bool = False) -> str:
    """The HEADSET in the team colour, static, full brightness -- what OTHER players see.

    Bench 2026-09-03 (`hled_spawned.py`, `hled_bright.py`, gun DELTA-9498, operator watching):
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
    Colour indices 0-7 are shared with the gun palette (camera rig, 2026-09-02; 4-7 bench-confirmed on
    the headset itself 2026-09-07). Never dimmed for night mode: callers skip the headset entirely
    when LEDs are off, because lighting a player's head in a blackout game is the one thing that
    setting exists to prevent. Paints `display_colour(team)`, not the raw tid (F35/finding #11).
    """
    c = FFA_COLOUR if ffa else display_colour(team)
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
