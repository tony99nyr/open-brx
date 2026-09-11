"""The PRESENTATION profile: which sound and which lights each game event gets, per game (A11).

Tony, 2026-09-04: *"how the gleds and hleds behave, what sounds are used and when, these should be
made into a config that MC can program. That we can tweak per mode if we want to. Maybe silenced
snipers cuts out the announcer stuff and extra led flashes. maybe for a counter-strike mode we use
the bomb armed and bomb defused sounds. maybe a 'protect the VIP' mode we use different appropriate
sounds for VIP hits."*

Shape (lives in `GameConfig.presentation`, validated by `merge`, expanded by `resolve`):

    {
      "preset": "standard" | "silenced" | "counter_strike" | "vip" | "infection" | "last_stand" | "extraction" | "custom",
      "announcer":    bool,   # kill lines, medals, lead changes, objective callouts (voice)
      "gun_flash":    bool,   # $GLED event bursts on the player's own gun
      "headset_team": bool,   # derived mirror of headset.in_play/pregame == "team" (older readers)
      "hud_events": bool, "mc_events": bool, "mc_confidence": bool,   # A11.5 event classes + the confidence gate
      "blackout":     bool,  # A16/led-language.md §4/§6#2: no light ANYWHERE except `down` (own switch,
                             # separate from `config.night` -- night dims/shortens, blackout empties)
      "headset": {pregame, start_flash, in_play, hit, death, respawn_flash, role},   # A11.6/§3.3
                 # (death: flash|native|colour; `role` was `carrier` -- both accepted, `role` canonical,
                 # `carrier` still an input alias mapped onto it by `merge()`/`resolve()`)
      "gun": {in_play, pregame, readout},   # A11.7/§3.1 (blank-then-hold, taken 2.5 s after $SPAWN;
                                            # readout = {pools, hold_s, reload_glance_s}, [] = off)
      "sight_flash":  bool,   # $SFLASH on a credited kill
      "events": { <event>: { "sound": <id>|"voice:<role>"|null, "gun_led": 0-8|null, "headset": 0-8|null, "flash": "green"|null } }
                 # flash = the small headset LED (A11.8); "voice:<role>" (A15) = the PLAYER's own voice line for that
                 # role (kill, spawn, boast, taunt, intro, gas_death, death_scream, hurt_loop, healed, kill_confirm, defeat_taunt,
                 # pain, pain_short / pain_long / pain_melee (A15.3), name -- voices.SOUND_ROLES), resolved per player at compile time
    }

Every sound id must be ON THE GUN (`sounds.on_gun_ids()`, from the catalog read off the hardware);
colours are the shared 9-colour palette (0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal ·
6 white · 7 pink · 8 orange). A preset name REPLACES the whole profile; editing any field afterwards
makes it `custom` (same rule as `loadout_policy`, A10.2).

What consumes it: `compile.py` turns it into the per-player bundle -- `cues[<event>]` (pre-composed
`$PLAY` frames, A6.3; a V-family id goes in the announcer slot, anything else in the SFX slot),
`leds[<event>]` (an optional `$LED` small-LED flash first, then the tuned 3-flash `$GLED` burst ending
on the gun's rest frame, hardware-tuned 2026-09-03, plus an optional static `$HLED` that now holds and
reverts rather than staying lit -- §6 finding #6), `gun.readout` (the transient 3/2/1-segment pool
readout, §3.1/§5, `gun_readout()`) and `headset.role` (held states -- carrier/infected/vip/beacon/
extracted, §3.3, `headset_frames()`). `hit_taken`/`healed`/`armour_up`/`shield_up`/`died`/`respawned`
carry NO default gun burst any more (2026-09-07, led-language.md §6 finding #5): the readout is the
feedback for a pool change, death is hands-off, and a respawn burst would land inside the 2.5 s the
body is still blanking off the firmware's own spawn breathing (`led_table()` still honours an explicit
`events.<ev>.gun_led` override for any of them). `announcer: false` empties every voice cue (the
`$SFLASH` still fires); `gun_flash: false` empties `leds`; `blackout: true` empties `leds`/`gun` and
reduces `headset` to just `down`.

Not here: the 3-flash burst timing itself (`poolgauge`; capped at three flashes in a second, never
a fourth, never a repaint during a flash) and the pool gauge colours. Those are hardware limits,
not taste.
"""
from __future__ import annotations

import copy
import re

from .. import poolgauge as pg
from .. import sounds as snd

PALETTE = {"red": 0, "blue": 1, "yellow": 2, "green": 3, "purple": 4, "teal": 5, "white": 6,
           "pink": 7, "orange": 8}

# event -> (group, what it is, default sound, default gun colour, default headset colour)
#   group "player"    fires on the player's own node from its gun's frames
#   group "announcer" is MC feedback to the shooter (voice); gated by `announcer`
#   group "objective" is MC-pushed for the mode; the SOUND is gated by `announcer`, the LEDs are not
# led-language.md §3.1 / §6 finding #5 (2026-09-07 build): hit_taken, healed, armour_up, shield_up,
# died AND respawned no longer carry a default GUN burst. The transient pool readout (`gun_readout`,
# built from `poolgauge.readout_bands`) is now the feedback for a pool change, and "died" is inside the
# 2.5 s hands-off window after $HP,0 where the node writes NOTHING to either surface (the native hit
# flash and headset out-flash are already the brightest thing we have -- a burst here can only mask
# them). "respawned" is dropped for a related hardware reason: a burst written at respawn lands INSIDE
# the first 2.5 s of the new life, before `gun.take` has blanked the body off the firmware's own spawn
# breathing (A11.7/S4) -- painting there fights that animation and renders wrong, the same failure mode
# the blank-then-hold scheme exists to avoid. The headset's white double-flash plus the spawn sound
# already mark a respawn (team-lead correction 2026-09-07: the build message that listed five events
# predates this reason; the design doc's six-event list is the current authority).
EVENTS: dict[str, dict] = {
    "hit_taken":     dict(source="hud", group="player",    desc="you were hit",                      sound=None,   gun_led=None,    headset=None),
    "died":          dict(source="hud", group="player",    desc="you are out",                       sound=None,   gun_led=None,    headset=None),
    "respawned":     dict(source="hud", group="player",    desc="back in: the player's own spawn line (A15.2, one random take)", sound="voice:spawn", gun_led=None, headset=None),
    "healed":        dict(source="hud", group="player",    desc="health restored",                   sound=None,   gun_led=None,  headset=None),
    "armour_up":     dict(source="hud", group="player",    desc="armour granted",                    sound=None,   gun_led=None, headset=None),
    "shield_up":     dict(source="hud", group="player",    desc="shield granted",                    sound=None,   gun_led=None,   headset=None),
    "low_health":    dict(source="hud", group="player",    desc="HP below 15: the player's own hurt loop, once per life (A17.2 -- was 'armour gone', which fired at full health)", sound="voice:hurt_loop", gun_led=None, headset=pg.PINK),
    # -- the shooter's kill feedback (MC `feedback` push; ONE of these per kill, most specific wins) --
    "kill":          dict(source="mc", group="announcer", desc="you scored a kill",                 sound="voice:kill", gun_led=None, headset=None, flash="green"),
    "first_blood":   dict(source="mc", group="announcer", desc="first kill of the match",           sound="VA7H", gun_led=None,      headset=None, flash="green"),
    "double_kill":   dict(source="mc", group="announcer", desc="2 kills inside the multi window",   sound="VA7E", gun_led=None,      headset=None, flash="green"),
    "triple_kill":   dict(source="mc", group="announcer", desc="3 kills inside the window",         sound="VA7Q", gun_led=None,      headset=None, flash="green"),
    "killtacular":   dict(source="mc", group="announcer", desc="4+ kills inside the window",        sound="V124", gun_led=None,      headset=None, flash="green"),
    "killing_spree": dict(source="mc", group="announcer", desc="5 kills without dying",             sound="VA7K", gun_led=None,      headset=None, flash="green"),
    "unstoppable":   dict(source="mc", group="announcer", desc="10 kills without dying (no bank line; flash only)", sound=None, gun_led=None, headset=None, flash="green"),
    "multi":         dict(source="mc", group="announcer", desc="legacy: any multi-kill (older MCs)", sound="VA7E", gun_led=None,      headset=None),
    "medal":         dict(source="mc", group="announcer", desc="legacy: any streak medal",           sound="VA7K", gun_led=None,      headset=None),
    # -- match state, pushed to EVERY node it concerns --
    "lead_taken":    dict(source="mc", group="announcer", desc="your team takes the lead",          sound="VA6D", gun_led=None,      headset=None),
    "lead_lost":     dict(source="mc", group="announcer", desc="your team lost the lead",           sound="VA6E", gun_led=None,      headset=None),
    "next_kill_wins":dict(source="mc", group="announcer", desc="one kill from the cap",             sound="V115", gun_led=None,      headset=None),
    "last_survivor": dict(source="mc", group="announcer", desc="one player left alive (lms / infection) -- opt-in: MC only knows deaths from CONNECTED HUDs", sound=None, gun_led=None, headset=None),
    "infected":      dict(source="both", group="announcer", desc="a survivor turned (infection)",      sound="VB1M", gun_led=None,      headset=None),
    "survivors_win": dict(source="hud", group="announcer", desc="the clock ran out on the infected", sound="VB1T", gun_led=None,      headset=None),
    # -- the clock, fired by the NODE from its own synced end time (works out of MC range) --
    "time_60":       dict(source="hud", group="announcer", desc="one minute left",                   sound="V113", gun_led=None,      headset=None),
    "time_30":       dict(source="hud", group="announcer", desc="30 seconds left",                   sound="V112", gun_led=None,      headset=None),
    "time_10":       dict(source="hud", group="announcer", desc="10 seconds left",                   sound="V114", gun_led=None,      headset=None),
    "victory":       dict(source="mc", group="announcer", desc="winners, at the whistle",           sound="VSF+JAY", gun_led=None,   headset=None),
    "game_over":     dict(source="both", group="announcer", desc="everyone, at the whistle",          sound="VA33", gun_led=None,      headset=None),
    "objective_taken":  dict(source="mc", group="objective", desc="flag / objective taken",         sound=snd.OBJECTIVE_TAKEN,  gun_led=pg.ORANGE, headset=None),
    "objective_scored": dict(source="mc", group="objective", desc="flag captured / objective scored", sound=snd.OBJECTIVE_SCORED, gun_led=pg.WHITE, headset=None),
    "flag_returned":    dict(source="mc", group="objective", desc="flag returned",                  sound=snd.FLAG_RETURNED,    gun_led=None,      headset=None),
    "point_captured":   dict(source="mc", group="objective", desc="control point captured",         sound=snd.POINT_CAPTURED,   gun_led=pg.WHITE,  headset=None),
    "hill_captured":    dict(source="mc", group="objective", desc="hill captured",                  sound=snd.HILL_CAPTURED,    gun_led=pg.WHITE,  headset=None),
    "bomb_planted":     dict(source="mc", group="objective", desc="bomb planted",                   sound=None,   gun_led=None,      headset=None),
    "bomb_defused":     dict(source="mc", group="objective", desc="bomb defused",                   sound=None,   gun_led=None,      headset=None),
    "bomb_detonated":   dict(source="mc", group="objective", desc="bomb detonated",                 sound=None,   gun_led=None,      headset=None),
    "vip_hit":          dict(source="mc", group="objective", desc="the VIP was hit",                sound=None,   gun_led=None,      headset=None),
    "vip_down":         dict(source="mc", group="objective", desc="the VIP is down",                sound=None,   gun_led=None,      headset=None),
    # -- extraction, the ARC Raiders / Fortnite-Sprites shape Tony is picturing (game-modes.md §Extraction):
    #    loot -> reach a site -> CALL the extract (a 45-90 s inbound sequence everyone can hear) -> the window
    #    OPENS (crate lands / chopper arrives) -> stand in the zone when it closes to bank -> leave the zone or
    #    die and the extract fails; the raid has a HARD END that kills everyone still out there.
    #    The extractor's own events are HUD-local once the channel runs on the node (zone = station/grenade
    #    beacons on its own gun); `extraction_alert` is what OTHERS hear and is MC best-effort until a field radio.
    "extraction_called":   dict(source="hud", group="player",    desc="you called the extract; it is inbound and LOUD",  sound="VA1C", gun_led=pg.ORANGE, headset=None),  # "Black Hawk inbound."
    "extraction_tick":     dict(source="hud", group="player",    desc="inbound / window running (repeats every ~10 s)",  sound="K01",  gun_led=None,      headset=None),       # 10 s rotor fly-by
    "extraction_open":     dict(source="hud", group="player",    desc="the extract is here: window open",               sound="VA1U", gun_led=pg.WHITE,  headset=None),   # "Incoming Chopper."
    "extraction_closing":  dict(source="hud", group="player",    desc="window closing (10 s)",                          sound="VX0R", gun_led=pg.ORANGE, headset=None),       # "10 Seconds Remain."
    "extraction_complete": dict(source="hud", group="player",    desc="you extracted -- loot banked, you are out safe",  sound="VQ8",  gun_led=pg.WHITE,  headset=None),   # "Objective complete!"
    "extraction_failed":   dict(source="hud", group="player",    desc="left the zone or died: extract lost",            sound="VA8X", gun_led=pg.RED,    headset=None),       # "Fail."
    "extraction_alert":    dict(source="mc", group="objective", desc="someone ELSE called an extract nearby",          sound="VA1S", gun_led=pg.ORANGE, headset=None),       # "enemy chopper detected."
    "loot_picked":         dict(source="hud", group="player",    desc="loot picked up",                                 sound="VA1Q", gun_led=pg.WHITE,  headset=None),       # "Care Package."
    "loot_dropped":        dict(source="hud", group="player",    desc="you died and dropped your loot",                 sound=None,   gun_led=None,      headset=None),
    "raid_ending":         dict(source="hud", group="player",    desc="hard end approaching: extract or die (node clock)", sound="VA3U", gun_led=pg.RED, headset=None),     # "Incoming air raid, find cover."
    "raid_over":           dict(source="hud", group="player",    desc="the bombardment: everyone still out is killed",  sound="X20",  gun_led=pg.RED,    headset=None),     # 4 artillery explosions (by ear)
}
# MC-driven events that assert something about the WHOLE match. Sent only while MC is confident (A11.5).
GLOBAL_STATE_EVENTS = {"lead_taken", "lead_lost", "next_kill_wins", "last_survivor"}

# HUD banner text per event (the node shows it as an `alert` moment; the brx-hud session owns the look).
TEXT = {
    "first_blood": "FIRST BLOOD", "double_kill": "DOUBLE KILL", "triple_kill": "TRIPLE KILL",
    "killtacular": "KILLTACULAR", "killing_spree": "KILLING SPREE", "unstoppable": "UNSTOPPABLE",
    "lead_taken": "YOUR TEAM TAKES THE LEAD", "lead_lost": "YOUR TEAM LOST THE LEAD",
    "next_kill_wins": "NEXT KILL WINS", "last_survivor": "ONE SURVIVOR REMAINS",
    "infected": "THE INFECTION SPREADS", "survivors_win": "SURVIVORS HELD THEIR GROUND",
    "time_60": "ONE MINUTE LEFT", "time_30": "30 SECONDS", "time_10": "10 SECONDS",
    "objective_taken": "FLAG TAKEN", "objective_scored": "FLAG CAPTURED", "flag_returned": "FLAG RETURNED",
    "point_captured": "POINT CAPTURED", "hill_captured": "HILL CAPTURED",
    "bomb_planted": "BOMB PLANTED", "bomb_defused": "BOMB DEFUSED", "bomb_detonated": "BOMB DETONATED",
    "vip_hit": "VIP UNDER FIRE", "vip_down": "VIP DOWN",
    "extraction_called": "EXTRACTION INBOUND", "extraction_tick": "EXTRACTING", "extraction_open": "EXTRACT OPEN",
    "extraction_closing": "EXTRACT CLOSING", "extraction_complete": "EXTRACTED", "extraction_failed": "EXTRACTION FAILED",
    "extraction_alert": "EXTRACTION NEARBY", "loot_picked": "LOOT", "loot_dropped": "LOOT DROPPED",
    "raid_ending": "EXTRACT OR DIE", "raid_over": "RAID OVER",
}


def alert_body(kind: str, extra: dict | None = None) -> dict:
    """The MC→node `alert` body for a named event (A11.4): the node plays cues[kind] + leds[kind] from
    its OWN bundle (so the presentation profile is honoured per player) and shows `text` as a HUD alert.

    A19: an extra `role` = `{name, on, tid?}` is checked here against `ROLE_STATES` -- a body naming a role the
    node cannot hold is a CODE bug on this side, and the node logs-and-ignores it rather than painting it."""
    body = {"kind": kind, "text": TEXT.get(kind, kind.replace("_", " ").upper())}
    for k, v in (extra or {}).items():
        if k not in ALERT_EXTRA:
            raise ValueError(f"alert extra {k!r} is not a wire field")
        if k == "role":
            v = _check_role(v)
        body[ALERT_EXTRA[k]] = v
    return body


def _check_role(v) -> dict:
    if not isinstance(v, dict) or v.get("name") not in ROLE_STATES or not isinstance(v.get("on"), bool):
        raise ValueError(f"alert role must be {{name: one of {ROLE_STATES}, on: bool, tid?: 0-3}}, not {v!r}")
    tid = v.get("tid")
    if tid is not None and not (isinstance(tid, int) and not isinstance(tid, bool) and tid in pg.TEAM_TIDS):
        raise ValueError(f"alert role tid must be a $TID 0-3 or absent, not {tid!r}")
    out = {"name": v["name"], "on": v["on"]}
    if tid is not None:
        out["tid"] = tid
    return out


# A19: what the HUD banner says when MC hands a player a held role (the node paints the lamp from its own
# `headset.role[name]`; MC sends only the name). Off = the role ended without a death (a death clears it on
# the node already).
ROLE_TEXT_ON = {"vip": "YOU ARE THE VIP", "beacon": "YOU ARE THE EXTRACTION BEACON",
                "extracted": "EXTRACTED — YOU ARE OUT", "carrier": "YOU HAVE THE OBJECTIVE",
                "infected": "YOU ARE INFECTED"}


def role_alert_body(name: str, on: bool, tid: int | None = None) -> dict:
    """The `alert` body that assigns (or ends) a held headset role (A19, led-language.md §3.3). Kind `role` is
    not a presentation EVENT -- the node plays no cue for it, only `_setRole` -- so a silenced game still tells
    its VIP who they are."""
    body = alert_body("role", {"role": {"name": name, "on": on, **({"tid": tid} if tid is not None else {})}})
    body["text"] = ROLE_TEXT_ON.get(name, f"YOU ARE THE {name.upper()}") if on else f"{name.upper()} ROLE ENDED"
    return body


# The scorer's `extra` keys and the wire field each becomes. `player_id` (who turned / who is the last
# survivor) travels as `player_id_subject`: the body's `player_id` is the RECIPIENT, set per push by
# `Session._alert`, and the two collided until polish 2026-09-04 (the subject was silently overwritten).
# A19: `role` = `{name, on, tid?}`, the held headset state the recipient now holds (or stops holding).
ALERT_EXTRA = {"player_id": "player_id_subject", "carrier": "carrier", "flag_tid": "flag_tid", "hud": "hud",
               "role": "role"}


# `sound` specials: "voice:kill" = the player's own voice family's kill line (compile.kill_line);
# "VSF+JAY" = Callsign's victory pair, both slots in one frame. Anything else is a bare bank id.

# hud_events: the node's own events (source "hud"/"both") · mc_events: MC-pushed events (source "mc"/"both") ·
# mc_confidence: MC pushes a global-state event ONLY while every player's HUD is connected and flushed,
# so "takes the lead" / "next kill wins" / "last survivor" are never said on a stale picture (Tony, 2026-09-04).
# --- the HEADSET, as its own block (Tony, 2026-09-04: "we also need headset led. make sure it does the
# proper behavior pre game showing team color, going dark at start of game, maybe we have a certain white
# flash to mark the start of game, flash on hit, flash during death until spawned, maybe another white
# flash to indicate respawn and active. maybe holding flag means flashing the flag color").
# Hardware facts behind the defaults (bench 2026-09-03): a static $HLED holds solid; $SPAWN and every hit
# wipe it (native flash, then dark); the blink form `$HLED,<c>,2,<on>,<off>,10,<count>` works in game.
# ⚠️ RETRACTED 2026-09-07 (led-language.md §3.2): the 2026-09-04 "hosted games do not get the native
# out-blink" finding named the wrong cause. The firmware DOES run its own bright out-flash on the small
# LED in a hosted game, exactly like native play -- our own `$HLED,,6` blank (the old `in_play: dark`
# rest frame, now HEADSET_BLANK) was switching it off for the rest of that life. `in_play: dark` now
# rests on HEADSET_DARK (a colour write, "$HLED,9,0,..."), which leaves the native flash alone; the down
# signal itself lives in `headset_frames()["down"]`, not in this block. Whether a count-limited blink
# ends DARK on its own is still unverified, so every flash below is still followed by an explicit frame.
#   pregame:     "team" | "off"      lobby: the team colour (the headset organises teams -- Tony)
#   start_flash: bool                T-0: a white double-flash, then the in-play state
#   in_play:     "dark" | "team"     between events: dark (HEADSET_DARK -- the native flash still runs) or team colour
#   hit:         colour | null       a short flash of that colour on every hit taken (null = leave native)
#   death:       "native" | colour   OUR opt-in on top of the firmware's own out-flash (2026-09-07):
#                "native" (DEFAULT) = write nothing extra here -- `headset_frames()["down"]` already
#                re-arms the native flash (`$HLOOP`) if a blank ever slips through; a colour = ALSO
#                slow-blink the big LED in that colour while out. "flash" (the old small-LED pulse
#                scheme, A11.8, deleted 2026-09-07) is retired: `merge()` maps it to "native" so a saved
#                game that picked it keeps loading instead of 500ing at push time.
#   respawn_flash: bool              back in: a white double-flash, then the in-play state
#   role:        bool                held role states (`headset_frames()["role"]`, §3.3): carrier,
#                                    infected, VIP, extraction beacon, extracted -- re-asserted by the
#                                    node after every registered hit so a hit does not erase them.
#                                    `carrier` (bool) is still accepted as an input alias for this same
#                                    field (led-language.md §4 collapse map: `headset.carrier` →
#                                    `headset.role`) -- `merge()` writes whichever key it is fed onto
#                                    THIS one, so the stored profile never carries both.
# hit: None (native) since the 2026-09-04 headset ladder -- the firmware's own hit flash is "like a camera flash"
# and NO BLE frame ($HLED any effect/level, $BLINK, $LED) comes close; painting over it only dims it. A colour here
# adds our flash-then-rest ON TOP of the native flash (an opt-in for games that want a colour-coded hit).
HEADSET_DEFAULT = {"pregame": "team", "start_flash": True, "in_play": "dark", "hit": None,
                   "death": "native", "respawn_flash": True, "role": True}
# The out-blink is ~0.8 s per cycle; 200 cycles is ~160 s. A scanner-respawn player can be down longer, so
# the node re-asserts frames.headset.death while it stays down (brx-grenade, engine side); the count itself is
# kept at 200 because token 6's upper range is unverified on hardware.
DEATH_BLINK_COUNT = 200
HEADSET_DARK = "$HLED,9,0,,,10,,*"   # dark BY COLOUR (verified dark by eye, 2026-09-07 bench): the in-play
                                      # rest frame. Unlike HEADSET_BLANK, a colour write does NOT disable
                                      # the firmware's own death-flash loop (led-language.md §3.2).
HEADSET_BLANK = "$HLED,,6,,,,,*"     # TEARDOWN ONLY -- NEVER send this while a match is running: effect 6
                                      # (the blank) disables the native death-flash loop for the rest of
                                      # that life (2026-09-07 bench). `gameconfig.END_SEQUENCE` actually
                                      # tears down with a different literal ("$HLED,0,0,0,0,0,0,*"), not
                                      # this constant -- the two disagreeing blanks is led-language.md §6
                                      # finding #13, left alone here (gameconfig.py is not this module).

# ---- the headset's SMALL flash LED (2026-09-04 ladder, GAMMA) -------------------------------------------------
# The native "camera flash" on a hit is a separate GREEN-ONLY LED next to the big RGB one (the APK's
# `isUsedGreenLed`), and `$LED` drives it: `$LED,<colour>,<useGreenLed>,<effect>,<pulses>,*` -- token 2 = 1 fires
# the small green LED (one clearly visible flash per frame -- well below the firmware's own hit flash by wall reflection,
# 2026-09-04; tokens 3/4 made no visible difference at 0-50); token 2 =
# 0 paints the BIG LED in <colour> instead (0 red -- Tony first read that as a red small-LED flash, corrected on
# the bench: "that is the hled not fled"). Token 1 also paints the big LED WITH the flash unless it is 9 (dark).
# `events[ev].flash = green|null` fires the small LED at the event start. This is the ONLY surviving
# user of `$LED` one-shots on this LED: the A11.8 `death_flash` scheme that used to pulse this same
# frame every DEATH_FLASH_MS while a player was down was deleted 2026-09-07 (led-language.md §3.2) --
# the down signal is now the firmware's own loop, driven by `$HLOOP` (`headset_frames()["down"]`), not
# this one-shot. Kill-family feedback (kill / medal flashes below) is unrelated and stays.
FLASH_COLOURS = {"green": 1}


def flash_frame(colour: str) -> str:
    # token 1 = 9 (dark) leaves the big LED alone; 0 paints it RED alongside the flash and the mix reads yellowish
    # (Tony, side by side with a native headset). An empty token 1 is rejected (nothing fires).
    return f"$LED,9,{FLASH_COLOURS[colour]},1,1,*"

# ---- the GUN BODY LED (A11.7, S4) ------------------------------------------------------------------
# Bench 2026-09-04 (brx-grenade, GAMMA, Tony watching; experiment-log "IN-GAME GUN LED CONTROL" + the
# three "GUN LED bench (S4)" entries): a spawned gun BREATHES its team colour and a plain $GLED only
# alternates with it -- but `$GLED,,,,5,,,*` (the blank) takes the LED out of the breathing loop: the gun
# goes dark and stays dark, and any colour painted after it HOLDS (snaps between colours, survives firing,
# reloads and registered hits; armour 70 -> 0 without losing the paint). `$SPAWN` re-enables the breathing,
# so the blank + paint go right after every $SPAWN (spawn AND revive). The three body LEDs are independent
# after a blank, and 10 is already maximum brightness.
#   in_play: "native"  = the firmware breathing; nothing is sent. NOT the default since the 2026-09-04 walkthrough:
#                        with the breathing running, EVERY event burst alternated with it ("all of the leds in every
#                        sequence were wrong, you aren't clearing the gleds" -- Tony, GAMMA, 45-step walkthrough).
#            "team"    = blank, then the team colour held solid (DEFAULT: bursts read, the body looks like today)
#            "dark"    = blank only: the gun body is off in play (events still flash)
#            "health"  = blank, then the health hue (green / yellow / red, poolgauge.HEALTH_BANDS); the node
#                        repaints on each band change and after every event burst
#   pregame: "team" | "off"  the armed, unspawned gun body: team colour (like the headset) or dark. Walkthrough
#                            2026-09-04, Tony: "the gun led does not get set on arm, its dark" -> default team.
#   readout: {pools, hold_s, reload_glance_s}   the transient pool readout (§3.1/§5, `gun_readout()`
#                            below) -- always built when LEDs are on, independent of `in_play`; a saved
#                            game that never set it gets GUN_READOUT_DEFAULT.
# DEFAULT IS "team" -- Tony, 2026-09-09: "instead of going dark lets put the team color on the gun led".
# History, because this flipped twice and the reasons are not the same reasons: it was "team" until the
# 2026-09-07 readout review moved it to "dark" (finding #5) on the argument that the transient pool
# readout had become the feedback, so a static paint was redundant. What that argument missed is that
# the readout is TRANSIENT -- it holds ~4 s and reverts -- so "dark rest" means the gun is unlit for
# almost all of a match, which loses team identity at a glance and reads as a dead gun rather than a
# quiet one. The readout still owns the strip while it runs and reverts to this frame afterwards.
# ⚠ Brightness is a SEPARATE axis and is unchanged here: night already dims every compiled $GLED
# (token 5 = 1), day is full. If a full-brightness team body turns out to be too much indoors, that is
# a brightness decision, not a reason to go dark again.
# `"health"` (the old whole-strip health hue) is kept for older nodes; its collapse onto the new shape
# is "team rest + readout limited to health" (see `gun_readout()`).
GUN_DEFAULT = {"in_play": "team", "pregame": "team"}
# Bench 2026-09-04 (GAMMA, Tony watching, stage `raw` ladder): a blank INSIDE the spawn burst does not take -- the
# firmware's spawn animation re-enables the breathing. Bare $SPAWN then blank + paint at +1.0 s: breathing;
# +1.5 s: breathing; +2.0 s: SOLID. So the node takes the body 2.5 s after every $SPAWN (margin over 2.0).
GUN_AFTER_SPAWN_S = 2.5
GUN_IN_PLAY = ("native", "team", "dark", "health")
GUN_BLANK = pg.GUN_BLANK    # one string, defined once (poolgauge) -- the CLI driver paints with it too (F86)

# ---- the transient pool readout (led-language.md §3.1/§5, 2026-09-07 build) --------------------------
# Outermost pool first (shield, armor, health -- the order BRX depletes them, `poolgauge.changed_pool`),
# each a static per-band $GLED segment frame (poolgauge.readout_bands) MC ships so the node never parses
# a frame: it just measures its own level/max and picks the first band whose fraction that exceeds.
READOUT_POOL_ORDER = ("shield", "armor", "health")
GUN_READOUT_DEFAULT = {"pools": list(READOUT_POOL_ORDER), "hold_s": 4, "reload_glance_s": 2}
NIGHT_READOUT = {"hold_s": 2, "reload_glance_s": 1}   # §3.4: night halves both holds

# `blackout` (led-language.md §4/§6 finding #2, 2026-09-07): the EXPLICIT "no lights anywhere except
# the down signal" switch, separate from `config.night` (an overlay: dim + shorter holds, everything
# still lights) and from the legacy top-level `config.led.mode == "off"` (still honoured by
# `compile._to_gc` for back-compat -- `leds` is on only when NEITHER says off). Night used to double as
# a blackout (`leds = ... and not config["night"]`), which silently deleted the down signal along with
# everything else; the two are independent now, and `down` is unconditional regardless of either.
_BASE = {"announcer": True, "gun_flash": True, "headset_team": True, "sight_flash": True,
         "hud_events": True, "mc_events": True, "mc_confidence": True, "blackout": False,
         "headset": dict(HEADSET_DEFAULT), "gun": dict(GUN_DEFAULT)}
SWITCHES = ("announcer", "gun_flash", "headset_team", "sight_flash", "hud_events", "mc_events",
            "mc_confidence", "blackout")

PRESETS: dict[str, dict] = {
    "standard": {**_BASE, "events": {}},
    # Tony: "silenced snipers cuts out the announcer stuff and extra led flashes".
    # led-language.md §3.5: "bursts off, readout off, hit null" -- `hit null` is already the
    # HEADSET_DEFAULT (unedited here), but the READOUT half was never implemented (2026-09-07 gap,
    # caught by the engine lane's fixture work): a silenced bundle still shipped the full three-pool
    # `gun.readout`, so a "gun stays dark" sniper mode painted a segment bar on every hit anyway.
    # `readout.pools: []` empties it -- `gun_readout()` returns {} for an empty pool list.
    "silenced": {**_BASE, "announcer": False, "gun_flash": False,
                "gun": {**GUN_DEFAULT, "readout": {"pools": []}}, "events": {}},
    # Tony: "for a counter-strike mode we use the bomb armed and bomb defused sounds".
    # X12 is the unambiguous heavy explosion by ear (2026-09-04); X13 "might actually be a sniper".
    "counter_strike": {**_BASE, "events": {
        "bomb_planted":   {"sound": snd.BOMB_PLANTED, "gun_led": pg.ORANGE},
        "bomb_defused":   {"sound": snd.BOMB_DEFUSED, "gun_led": pg.GREEN},
        "bomb_detonated": {"sound": "X12", "gun_led": pg.RED},
    }},
    # Tony: "a 'protect the VIP' mode we use different appropriate sounds for VIP hits"
    "vip": {**_BASE, "events": {
        "vip_hit":  {"sound": "VIP", "gun_led": pg.ORANGE, "headset": pg.ORANGE},   # the announcer says "VIP"
        "vip_down": {"sound": "VA72", "gun_led": pg.RED},                            # "The VIP has been killed!"
    }},
    # MC modes (state.MODES): infection turns and the survivors' ending; last-man-standing's last survivor
    "infection": {**_BASE, "events": {
        "infected":      {"sound": "VB1M", "gun_led": pg.RED, "headset": pg.RED},   # "The infection is spread."
        "last_survivor": {"sound": "V4V"},                                          # "One survivor remains."
        "survivors_win": {"sound": "VB1T"},                                         # "The survivors have held their ground."
    }},
    # Last man standing: `last_survivor` is deliberately NOT in the preset: MC only learns deaths from
    # HUDs that are connected, so "one survivor remains" is exactly the announcement most likely to be
    # wrong or missing when HUDs drop off mid-game (Tony, 2026-09-04). It stays available as an event.
    # `died` used to also paint the gun red and flash the headset here ("out for good: mark the head
    # too") -- retired 2026-09-07 (led-language.md §3.1 "Death is hands-off"): the node writes NOTHING
    # to either surface for the 2.5 s after $HP,0, so a died-event colour write can only ever be
    # dropped or fight the native flash it was meant to sit beside. The dark rest + the down signal
    # already mark "out for good" on the gun and the headset.
    "last_stand": {**_BASE, "events": {}},
    # Extraction (game-modes.md): the extractor is LOUD by design, everyone else gets the chopper alert.
    "extraction": {**_BASE, "events": {
        "extraction_called":   {"sound": "VA1C", "gun_led": pg.ORANGE, "headset": pg.ORANGE},
        "extraction_tick":     {"sound": "K01"},
        "extraction_open":     {"sound": "VA1U", "gun_led": pg.WHITE, "headset": pg.WHITE},
        "extraction_closing":  {"sound": "VX0R", "gun_led": pg.ORANGE},
        "extraction_complete": {"sound": "VQ8", "gun_led": pg.WHITE, "headset": pg.WHITE},
        "extraction_failed":   {"sound": "VA8X", "gun_led": pg.RED},
        "extraction_alert":    {"sound": "VA1S", "gun_led": pg.ORANGE},
        "loot_picked":         {"sound": "VA1Q", "gun_led": pg.WHITE},
        "raid_ending":         {"sound": "VA3U", "gun_led": pg.RED, "headset": pg.RED},
        "raid_over":           {"sound": "X20", "gun_led": pg.RED, "headset": pg.RED},
    }},
}
MODE_PRESET = {"cs": "counter_strike", "infection": "infection", "lms": "last_stand", "extraction": "extraction"}
# tdm / ffa (and anything unlisted) start on "standard"


def default_for(mode: str | None = None) -> dict:
    return profile_from_preset(MODE_PRESET.get(mode or "", "standard"))


def profile_from_preset(name: str) -> dict:
    if name not in PRESETS:
        raise ValueError(f"presentation.preset must be one of {sorted(PRESETS)}")
    p = copy.deepcopy(PRESETS[name])
    p["preset"] = name
    return p


def _colour(v):
    if v is None:
        return None
    if isinstance(v, str) and v.lower() in PALETTE:
        return PALETTE[v.lower()]
    if isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 8:
        return v
    raise ValueError(f"colour must be 0..8 or one of {sorted(PALETTE)}, got {v!r}")


def _sound(v):
    if v is None or v == "":
        return None
    if not isinstance(v, str):
        raise ValueError("sound must be a bank id string or null")
    if v == "VSF+JAY":
        return v
    if v.startswith("voice:"):
        from ..voices import SOUND_ROLES
        if v[6:] not in SOUND_ROLES:
            raise ValueError(f"sound {v!r}: the voice role must be one of {SOUND_ROLES}")
        return v
    sid = v.upper()
    if sid not in snd.on_gun_ids():
        raise ValueError(f"sound {v!r} is not on the gun (see data/sound_catalog.json)")
    return sid


def merge(current: dict | None, patch: dict) -> dict:
    """Apply a client patch onto a profile: whitelist + validate (A8.3 style). Pure; raises ValueError.

    A `preset` in the patch REPLACES the profile with that preset first; any other field then edits
    it and marks the result `custom` (so a saved game that was tweaked reads as tweaked)."""
    if not isinstance(patch, dict):
        raise ValueError("presentation must be an object")
    prof = copy.deepcopy(current) if current else default_for()
    if "preset" in patch:
        prof = profile_from_preset(patch["preset"])
    edited = False
    for k in SWITCHES:
        if k in patch:
            if not isinstance(patch[k], bool):
                raise ValueError(f"presentation.{k} must be true/false")
            if prof.get(k) != patch[k]:
                edited = True
            prof[k] = patch[k]
    if "headset" in patch:
        h = patch["headset"]
        if not isinstance(h, dict):
            raise ValueError("presentation.headset must be an object")
        cur = dict(prof.get("headset") or HEADSET_DEFAULT)
        for hk, hv in h.items():
            if hk == "pregame":
                if hv not in ("team", "off"):
                    raise ValueError("presentation.headset.pregame must be team|off")
                cur[hk] = hv
            elif hk == "in_play":
                if hv not in ("dark", "team"):
                    raise ValueError("presentation.headset.in_play must be dark|team")
                cur[hk] = hv
            elif hk in ("start_flash", "respawn_flash", "role"):
                if not isinstance(hv, bool):
                    raise ValueError(f"presentation.headset.{hk} must be true/false")
                cur[hk] = hv
            elif hk == "carrier":
                # led-language.md §4 collapse map: `headset.carrier` -> `headset.role` (§3.3 broadened
                # the single carrier blink into 5 held role states gated by the same one switch).
                # Written onto the canonical "role" field so the stored profile never carries both.
                if not isinstance(hv, bool):
                    raise ValueError("presentation.headset.carrier must be true/false")
                cur["role"] = hv
                cur.pop("carrier", None)
            elif hk == "hit":
                cur[hk] = _colour(hv)
            elif hk == "death":
                if hv is None:
                    raise ValueError("presentation.headset.death must be \"native\" or a colour (null would fail at push time)")
                if hv == "flash":
                    # A11.8 death_flash scheme retired 2026-09-07 (led-language.md §3.2, $HLOOP replaces
                    # it) -- map the old value forward so a saved game does not 500 at push time.
                    hv = "native"
                cur[hk] = hv if hv == "native" else _colour(hv)
            else:
                raise ValueError(f"presentation.headset.{hk}: unknown field")
        if cur != prof.get("headset"):
            edited = True
        prof["headset"] = cur
        # the legacy switch mirrors the block so older readers agree with it
        prof["headset_team"] = cur["in_play"] == "team" or cur["pregame"] == "team"
    if "gun" in patch:
        g = patch["gun"]
        if not isinstance(g, dict):
            raise ValueError("presentation.gun must be an object")
        cur = dict(prof.get("gun") or GUN_DEFAULT)
        for gk, gv in g.items():
            if gk == "in_play":
                if gv not in GUN_IN_PLAY:
                    raise ValueError(f"presentation.gun.in_play must be one of {'|'.join(GUN_IN_PLAY)}")
                cur[gk] = gv
            elif gk == "pregame":
                if gv not in ("team", "off"):
                    raise ValueError("presentation.gun.pregame must be team|off")
                cur[gk] = gv
            elif gk == "readout":
                if not isinstance(gv, dict):
                    raise ValueError("presentation.gun.readout must be an object")
                r = dict(cur.get("readout") or GUN_READOUT_DEFAULT)
                for rk, rv in gv.items():
                    if rk == "pools":
                        if not (isinstance(rv, list) and set(rv) <= set(READOUT_POOL_ORDER)):
                            raise ValueError(f"presentation.gun.readout.pools must be a subset of {READOUT_POOL_ORDER}")
                        r[rk] = list(rv)
                    elif rk in ("hold_s", "reload_glance_s"):
                        if not (isinstance(rv, (int, float)) and not isinstance(rv, bool) and 1 <= rv <= 10):
                            raise ValueError(f"presentation.gun.readout.{rk} must be 1..10")
                        r[rk] = rv
                    else:
                        raise ValueError(f"presentation.gun.readout.{rk}: unknown field")
                cur[gk] = r
            else:
                raise ValueError(f"presentation.gun.{gk}: unknown field")
        if cur != prof.get("gun"):
            edited = True
        prof["gun"] = cur
    if "events" in patch:
        if not isinstance(patch["events"], dict):
            raise ValueError("presentation.events must be an object")
        for ev, spec in patch["events"].items():
            if ev not in EVENTS:
                raise ValueError(f"unknown presentation event {ev!r}; known: {sorted(EVENTS)}")
            if spec is None:
                prof["events"].pop(ev, None)
                edited = True
                continue
            if not isinstance(spec, dict):
                raise ValueError(f"presentation.events.{ev} must be an object or null")
            cur = dict(prof["events"].get(ev, {}))
            for fk, fv in spec.items():
                if fk == "sound":
                    cur["sound"] = _sound(fv)
                elif fk in ("gun_led", "headset"):
                    cur[fk] = _colour(fv)
                elif fk == "flash":
                    if fv is not None and fv not in FLASH_COLOURS:
                        raise ValueError(f"presentation.events.{ev}.flash must be green|null (the small LED is green-only)")
                    cur[fk] = fv
                else:
                    raise ValueError(f"presentation.events.{ev}.{fk}: unknown field")
            prof["events"][ev] = cur
            edited = True
    if edited:
        prof["preset"] = "custom"
    return prof


def _collapse_headset(raw_headset: dict | None) -> dict:
    """led-language.md §4 collapse map, applied to ONE layer of a `headset` dict: `carrier` (legacy) ->
    `role` (canonical) when `role` is not itself present in that same layer, so an unmerged/hand-edited
    profile that only ever set the old key still resolves correctly. Pure -- called once per layer in
    `resolve()` so the caller's own precedence (raw overrides base overrides default) is untouched."""
    if not raw_headset:
        return {}
    h = dict(raw_headset)
    if "carrier" in h and "role" not in h:
        h["role"] = h.pop("carrier")
    else:
        h.pop("carrier", None)
    return h


def resolve(config: dict) -> dict:
    """The FULL profile for a config: preset defaults + overrides, every event filled in."""
    raw = config.get("presentation") or {}
    # A bare {"preset": "silenced"} (what a client sends, or a saved game stores) expands from the preset;
    # any switch or event present in `raw` overlays it.
    base = profile_from_preset(raw["preset"]) if raw.get("preset") in PRESETS else default_for(config.get("mode"))
    prof = copy.deepcopy(base)
    for k in SWITCHES:
        if k in raw:
            prof[k] = bool(raw[k])
    if raw.get("preset") == "custom":
        prof["preset"] = "custom"
    prof["headset"] = {**HEADSET_DEFAULT, **_collapse_headset(base.get("headset")), **_collapse_headset(raw.get("headset"))}
    prof["gun"] = {**GUN_DEFAULT, **(base.get("gun") or {}), **(raw.get("gun") or {})}
    prof["events"] = {**prof.get("events", {}), **(raw.get("events") or {})}
    events = {}
    for ev, d in EVENTS.items():
        spec = {"sound": d["sound"], "gun_led": d["gun_led"], "headset": d["headset"], "group": d["group"],
                "source": d.get("source", "mc"), "desc": d["desc"], "flash": d.get("flash")}
        spec.update({k: v for k, v in (prof.get("events") or {}).get(ev, {}).items() if k in ("sound", "gun_led", "headset", "flash")})
        events[ev] = spec
    prof["events"] = events
    return prof


def play_frame(sound: str, voice) -> str | None:
    """A bank id -> the pre-composed `$PLAY` frame (A6.3). V-family ids speak on the announcer slot.
    `voice` = the player's `{role: id}` map (compile._voice_map) for `voice:<role>` sounds; a bare str is
    the kill-line id (the pre-A15 shape). A role the player's family cannot fill -> None (no cue)."""
    if sound.startswith("voice:"):
        role = sound[6:]
        sid = voice.get(role) if isinstance(voice, dict) else (voice if role == "kill" else None)
        if isinstance(sid, (list, tuple)):
            sid = sid[0] if sid else None           # A15.1: a POOL -- the deterministic first; the pool itself is cue_pool_frames()
        return f"$PLAY,,4,6,{sid},,,,*" if sid else None
    if sound == "VSF+JAY":
        return "$PLAY,VSF,4,6,JAY,,,,*"
    if re.fullmatch(r"V[A-Z0-9]{1,3}", sound):
        return f"$PLAY,,4,6,{sound},,,,*"
    return f"$PLAY,{sound},4,6,,,,,*"


def cue_frames(profile: dict, voice) -> dict[str, str]:
    """event -> `$PLAY` frame for every event with a sound, honouring the announcer switch.

    `announcer: false` silences the voice groups (announcer + objective) but keeps the player's own
    status sounds (low_health). A silenced event is present with "" so the node knows it is
    deliberately mute rather than missing."""
    out: dict[str, str] = {}
    for ev, spec in profile["events"].items():
        s = spec.get("sound")
        if not s:
            continue
        src = spec.get("source", "mc")
        muted = ((spec["group"] in ("announcer", "objective") and not profile.get("announcer", True))
                 or (src == "hud" and not profile.get("hud_events", True))
                 or (src == "mc" and not profile.get("mc_events", True)))
        if muted:
            out[ev] = ""
            continue
        fr = play_frame(s, voice)
        if fr:
            out[ev] = fr
    return out


def _muted(profile: dict, spec: dict) -> bool:
    src = spec.get("source", "mc")
    return ((spec["group"] in ("announcer", "objective") and not profile.get("announcer", True))
            or (src == "hud" and not profile.get("hud_events", True))
            or (src == "mc" and not profile.get("mc_events", True)))


def cue_pool_frames(profile: dict, voice) -> dict[str, list[str]]:
    """A15.1: event -> EVERY `$PLAY` frame its `voice:<role>` sound may resolve to, for events whose pool has
    two or more lines (three kill confirms + two taunts on `voice:kill`, six pains on `voice:pain`). The node
    picks ONE at random per event; `cue_frames()[ev]` stays the deterministic first for readers without pools.
    Muted events and single-line roles are absent."""
    out: dict[str, list[str]] = {}
    if not isinstance(voice, dict):
        return out
    for ev, spec in profile["events"].items():
        s = spec.get("sound")
        if not s or not s.startswith("voice:") or _muted(profile, spec):
            continue
        ids = voice.get(s[6:])
        if isinstance(ids, (list, tuple)) and len(ids) > 1:
            out[ev] = [f"$PLAY,,4,6,{i},,,,*" for i in ids]
    return out


# led-language.md §6 finding #6, built 2026-09-07: a one-shot event colour on the headset (`vip_hit`
# orange, `infected` red, …) used to be written with hold 0.0 -- the convention this module uses
# elsewhere for "this frame already IS the rest state" -- and so it simply stayed lit for the rest of
# the life. Every static event `$HLED` now holds for this long, then reverts to the headset's own
# rest frame. `poolgauge.REVERT_AFTER_S` (the pool-readout hold) is the closest bench-backed duration
# for "how long does a one-shot status light stay up before it must go back to being unremarkable".
STATIC_EVENT_HLED_HOLD_S = pg.REVERT_AFTER_S


def _hled(colour: int, night: bool = False) -> str:
    """A static (non-blinking) `$HLED` paint at full or, at night, dim brightness (led-language.md §3.4:
    pregame / role states / low health dim to tok5=1; the down signal and the native hit flash do not)."""
    b = pg.BRIGHT_DIM if night else pg.BRIGHT_FULL
    return f"$HLED,{colour},0,,,{b},,*"


def led_table(profile: dict, team: int | None, night: bool, leds_on: bool, ffa: bool = False) -> dict[str, list]:
    """event -> [[frame, hold_s], ...]: the tuned 3-flash gun burst ending on the gun's rest frame, then
    an optional static `$HLED` for the headset that HOLDS for `STATIC_EVENT_HLED_HOLD_S` and reverts to
    the headset's own rest frame (finding #6 above -- a hold of 0.0 used to mean "and never revert").
    Empty when LEDs are off for the game (night / blackout) or the profile turned gun flashes off."""
    if not leds_on:
        return {}
    out: dict[str, list] = {}
    gf = gun_frames(profile, team, night, True, ffa)
    hf = headset_frames(profile, team, True, ffa=ffa)
    for ev, spec in profile["events"].items():
        src = spec.get("source", "mc")
        if (src == "hud" and not profile.get("hud_events", True)) or (src == "mc" and not profile.get("mc_events", True)):
            continue
        if not profile.get("gun_flash", True):
            continue                        # "no extra led flashes": neither the gun burst nor a headset paint
        seq: list[list] = []
        if spec.get("flash") in FLASH_COLOURS:
            seq.append([flash_frame(spec["flash"]), 0.0])      # the small LED: one clearly visible flash (below native), no hold needed
        c = spec.get("gun_led")
        if c is not None:
            b = pg.BRIGHT_DIM if night else pg.BRIGHT_FULL
            flash = f"$GLED,{c},{c},{c},0,{b},,*"
            # A11.7: the burst ends on the gun's RESTING frame. Native / team: the team colour (the firmware
            # breathing or the held paint). Dark: the dark frame. Health: the full-health hue here, and the
            # node repaints the current band right after (it alone knows the hp).
            back = gf["rest"] if gf else pg.team_frame(team, night, ffa)
            # led-language.md §6 finding #3 (2026-09-07, caught by the LED invariant tests): a burst
            # ALTERNATES flash-colour and rest-colour, so if they are the SAME colour the strip never
            # actually changes and the player sees nothing -- e.g. `hit_landed` (WHITE) against an
            # FFA/no-team rest (also WHITE, Q19), or the older red-on-red-team case the dark-rest
            # default only happens to hide, not fix. When the two collide, alternate against DARK
            # instead so every flash is a real transition; the burst still ENDS on the true rest frame
            # (unchanged) -- `_colour()` never accepts 9 for an event's `gun_led`, so DARK is always a
            # safe, visibly-different "off" state to alternate against.
            back_colour = back.split(",")[1] if back.startswith("$GLED,") else None
            gap = f"$GLED,{pg.DARK},{pg.DARK},{pg.DARK},0,{b},,*" if back_colour == str(c) else back
            for i in range(pg.BURST_FLASHES):
                last = i == pg.BURST_FLASHES - 1
                seq.append([flash, pg.BURST_FLASH_S])
                seq.append([back if last else gap, pg.BURST_GAP_S if not last else 0.0])
        h = spec.get("headset")
        if h is not None and ev != "low_health":          # low_health keeps Callsign's blink (cues.hurt_led)
            rest = hf["rest"] if hf else HEADSET_DARK
            seq.append([f"$HLED,{h},0,,,10,,*", STATIC_EVENT_HLED_HOLD_S])
            seq.append([rest, 0.0])
        if seq:
            out[ev] = seq
    return out


def _blink(colour: int, on_ms: int, off_ms: int, count: int, night: bool = False) -> str:
    b = pg.BRIGHT_DIM if night else pg.BRIGHT_FULL
    return f"$HLED,{colour},2,{on_ms},{off_ms},{b},{count},*"


# led-language.md §3.3 (built 2026-09-07): held role states, re-asserted by the NODE after every
# registered hit so a hit does not erase them (unlike a one-shot event colour, which the hold+rest
# pattern above already returns from on its own). Carrier is WHITE -- never the flag's team colour,
# because team colours are identity and a role is a state, not an identity (finding #11). Infected is
# the only role that still needs a TEAM colour (the SURVIVING team reads "who turned" by colour), so it
# alone is keyed per-tid like the old carrier table was.
ROLE_STATES = ("carrier", "infected", "vip", "beacon", "extracted")


def headset_frames(profile: dict, tid: int | None, leds_on: bool, team_colours: dict[int, int] | None = None,
                   ffa: bool = False, night: bool = False) -> dict:
    """The bundle's `headset` table (A11.6): what the NODE writes to the headset at each moment.

    Every entry is a list of [frame, hold_s] steps ending on an explicit state frame, because a
    count-limited blink ending dark on its own is not yet verified on hardware. `in_play` names the
    resting state the node returns to after every flash.

    `down` (2026-09-07, led-language.md §3.2) is present even when LEDs are off/blackout: it costs no
    light budget and it is the one signal other players must read. The node writes NOTHING to the
    headset at death -- the firmware's own bright out-flash is already running by itself and is the
    brightest thing we have (our old `$HLED,,6` blank was the only thing that was ever switching it
    off). At `rearm_after_ms` after `$HP,0` the node sends `rearm` (`$HLOOP,2,750,*`) once, as
    belt-and-braces insurance for any life where a blank slipped through -- harmless when the native
    loop is already running. `stop` (`$HLOOP,0,0,*`) is sent before a revive; `$SPAWN` clears the loop
    by itself too. Everything else in this table is empty when LEDs are off for the game.

    `role` (§3.3) is the held-state table: `carrier`/`vip`/`beacon`/`extracted` are single [frame, 0.0]
    sequences (0.0 = "and this IS now the resting state", same convention as `rest` -- these are not
    one-shot events, so the hold+rest pattern in `led_table()` does not apply to them); `infected` is
    keyed by tid like the old carrier table because it is the one role whose COLOUR is a team fact.
    `role` is `{}` when `headset.role` is off, gated the same way `carrier` used to be."""
    down = {"rearm": "$HLOOP,2,750,*", "stop": "$HLOOP,0,0,*", "rearm_after_ms": 2500}
    if not leds_on:
        return {"down": down}
    h = {**HEADSET_DEFAULT, **_collapse_headset(profile.get("headset"))}
    # F35/finding #11 (2026-09-07): PAINT colour, never the raw tid (team 3 stays green on the wire
    # but paints purple -- `pg.display_colour`).
    colour = pg.FFA_COLOUR if ffa else (pg.display_colour(tid) if tid is not None else None)
    team_paint = _hled(colour, night) if colour is not None and int(colour) in pg.HEADSET_TIDS else None
    rest = team_paint if (h["in_play"] == "team" and team_paint) else HEADSET_DARK
    n_flashes = 1 if night else 2
    white_start = _blink(pg.WHITE, 120, 120, n_flashes, night)
    out: dict = {"in_play": h["in_play"], "rest": rest, "blank": HEADSET_DARK, "down": down,
                 "pregame": [team_paint] if (h["pregame"] == "team" and team_paint) else [],
                 "start": [[white_start, 0.6], [rest, 0.0]] if h["start_flash"] else [[rest, 0.0]],
                 "hit": [[_blink(h["hit"], 100, 100, 2), 0.5], [rest, 0.0]] if h["hit"] is not None else [],
                 "death": [] if h["death"] == "native" else [[_blink(int(h["death"]), 400, 400, DEATH_BLINK_COUNT), 0.0]],
                 "respawn": [[white_start, 0.6], [rest, 0.0]] if h["respawn_flash"] else [[rest, 0.0]],
                 "role": {}}
    if h.get("role", True):
        out["role"] = {
            "carrier":   [[_blink(pg.WHITE, 300, 300, 200, night), 0.0]],
            "vip":       [[_hled(pg.WHITE, night), 0.0]],
            "beacon":    [[_blink(pg.ORANGE, 300, 300, 200, night), 0.0]],
            "extracted": [[_hled(pg.WHITE, night), 0.0]],
            "infected":  {str(t): [[_hled(int(c), night), 0.0]] for t, c in (team_colours or {}).items()},
        }
        # BACK-COMPAT (2026-09-07, retargeted): `stage.py` has now migrated to `role`, but this key is
        # NOT dead yet -- it is what a PRE-A16 NODE reads. `engine.js` falls back to
        # `headset.carrier[<tid>]` when `headset.role` is absent, so an APK built before tonight gets its
        # carrier blink from here and nothing else. Deleting it the moment the stage migrated would have
        # silently killed the flag blink for every phone still on the old build (they are on 0.1.6/0.1.7;
        # `role` needs an APK that does not exist yet). The colour is superseded -- this emits the FLAG's
        # team colour, while §3.3 says carrier is WHITE -- so an old node keeps the old look, which is the
        # correct compromise: stale, not broken. DELETE THIS once an APK carrying `role` is on every
        # phone (tracked in FOLLOWUPS S10).
        out["carrier"] = {str(t): [[_blink(int(c), 300, 300, 200, night), 0.0]] for t, c in (team_colours or {}).items()}
    return out


def gun_readout(profile: dict, night: bool, hp: int = 45, armor: int = 70, shield: int = 70) -> dict:
    """The transient pool readout (led-language.md §3.1/§5): 3/2/1 lit segments in the pool's hue,
    outermost pool first. `max` per pool is shipped so the node never parses a frame -- hp/armor come
    from the caller (the config, per-player overrides already applied); shield is whatever `$PSET`
    token 5 carries for this player. `{}` when `gun.readout.pools` is emptied (no readout at all).

    The legacy `gun.in_play == "health"` (the old whole-strip health hue, kept in `gun_frames()`'s
    `bands` for older nodes) collapses onto "readout limited to health" here UNLESS the profile also
    set its own `readout.pools` explicitly (led-language.md §4 collapse map).

    A16.3 (2026-09-07 bench, after the 3-band version): each pool ALSO carries `levels`, the 7-entry
    drop-animation table (`poolgauge.readout_levels`) alongside the original 3-band `bands` --
    `bands` stays exactly as before so an older node that has never heard of `levels` keeps working.
    The 4 drop-animation timings are fixed (not touched by night, same as the rest of the table) and
    ship once at the top of the readout, not per pool.
    """
    g = {**GUN_DEFAULT, **(profile.get("gun") or {})}
    conf = {**GUN_READOUT_DEFAULT, **(g.get("readout") or {})}
    if g["in_play"] == "health" and "readout" not in g:
        conf = {**conf, "pools": ["health"]}
    pools = [p for p in READOUT_POOL_ORDER if p in (conf.get("pools") or [])]
    if not pools:
        return {}
    hold_s, glance_s = conf.get("hold_s", 4), conf.get("reload_glance_s", 2)
    if night:
        hold_s = min(hold_s, NIGHT_READOUT["hold_s"])
        glance_s = min(glance_s, NIGHT_READOUT["reload_glance_s"])
    maxima = {"shield": shield, "armor": armor, "health": hp}
    return {"hold_s": hold_s, "reload_glance_s": glance_s,
            "lead_ms": pg.READOUT_LEAD_MS, "blink_gap_ms": pg.READOUT_BLINK_GAP_MS,
            "step_ms": pg.READOUT_STEP_MS, "blink_ms": pg.READOUT_BLINK_MS,
            "min_gap_ms": pg.READOUT_MIN_GAP_MS,
            "pools": [{"pool": p, "max": maxima[p],
                       "bands": [[thr, f] for thr, f in pg.readout_bands(p, night)],
                       "levels": pg.readout_levels(p, night)} for p in pools]}


def gun_frames(profile: dict, tid: int | None, night: bool, leds_on: bool, ffa: bool = False,
              hp: int = 45, armor: int = 70, shield: int = 70) -> dict:
    """The bundle's `gun` table (A11.7): what the NODE paints on the gun body in play.

    {} when LEDs are off for the game or `in_play` is "native" (nothing is sent; the firmware breathes).
    Otherwise: `in_play`, `blank` (the frame that suppresses the breathing; sent once after every $SPAWN),
    `rest` (the frame that follows the blank: team colour, dark, or the full-health hue) and, for
    "health", `bands`: [[fraction_above, frame], ...] highest first -- the node paints the first band whose
    fraction the current hp/max exceeds, on every band change and at the end of every event burst
    (kept for older nodes, led-language.md §4 collapse map). `readout` (§3.1/§5, `gun_readout()`) is the
    newer, additive transient pool readout -- always built when LEDs are on, independent of `in_play`."""
    g = {**GUN_DEFAULT, **(profile.get("gun") or {})}
    if not leds_on or g["in_play"] == "native":
        return {}
    b = pg.BRIGHT_DIM if night else pg.BRIGHT_FULL
    dark = f"$GLED,{pg.DARK},{pg.DARK},{pg.DARK},0,{b},,*"
    out: dict = {"in_play": g["in_play"], "blank": GUN_BLANK, "after_spawn_s": GUN_AFTER_SPAWN_S}
    if g["in_play"] == "team":
        out["rest"] = pg.team_frame(tid, night, ffa, dim=True)   # A16.4: the in-play rest is DIM (see team_frame)
    elif g["in_play"] == "dark":
        out["rest"] = dark
    else:   # health (legacy whole-strip; superseded by the segmented `readout` below)
        out["bands"] = [[thr, pg.pool_paint_frame("health", int(round(thr * 1000)) + 1, 1000, night)] for thr, _c in pg.HEALTH_BANDS]
        out["rest"] = out["bands"][0][1]          # full health = the top band
    out["take"] = [GUN_BLANK, out["rest"]]        # what the node writes after_spawn_s after every $SPAWN
    readout = gun_readout(profile, night, hp, armor, shield)
    if readout:
        out["readout"] = readout
    return out


def gun_pregame(profile: dict, tid: int | None, night: bool, leds_on: bool, ffa: bool = False) -> list[str]:
    """The armed-unspawned gun body: [team frame] when `gun.pregame` is team and LEDs are on. A paint holds on an
    unspawned gun (no breathing loop runs before $SPAWN); the spawn tail then blanks + repaints."""
    g = {**GUN_DEFAULT, **(profile.get("gun") or {})}
    if not leds_on or g.get("pregame", "team") != "team":
        return []
    return [pg.team_frame(tid, night, ffa)]


def gun_spawn_tail(profile: dict, tid: int | None, night: bool, leds_on: bool) -> list[str]:
    """RETIRED 2026-09-04 (kept for callers): a blank inside the spawn burst does not take; the node writes
    `gun.take` after `gun.after_spawn_s` instead. Always []."""
    return []


def summary(profile: dict) -> dict:
    """What the UI shows: preset + the switches + which events carry a custom sound.

    `headset.role` (led-language.md §3.3) is exposed under BOTH names: `role` (canonical going
    forward) and `carrier` (kept byte-identical so the existing console, which still reads
    `headset.carrier`, keeps working unchanged -- §4 "summary() keeps emitting the old switches")."""
    hs = {**HEADSET_DEFAULT, **_collapse_headset(profile.get("headset"))}
    return {"preset": profile.get("preset", "standard"),
            **{k: bool(profile.get(k, _BASE[k])) for k in SWITCHES},
            "headset": {**hs, "carrier": hs["role"]},
            "gun": {**GUN_DEFAULT, **(profile.get("gun") or {})},
            "custom_events": sorted(ev for ev, spec in (profile.get("events") or {}).items()
                                    if spec.get("sound") or spec.get("gun_led") is not None or spec.get("headset") is not None or spec.get("flash"))}


def table(config: dict) -> list[dict]:
    """The resolved profile as rows for the MC's read-only ADVANCED view: every event with its source
    (hud / mc / both), what fires it, the sound (id + the catalog's words), and the colours."""
    prof = resolve(config)
    rows = []
    for ev, spec in prof["events"].items():
        s = spec.get("sound")
        words = ""
        if s and not s.startswith("voice:") and s != "VSF+JAY":
            words = snd.describe(s)
        elif s and s.startswith("voice:"):
            from ..voices import ROLE_WORDS
            words = "the player's own voice: " + ("kill line" if s == "voice:kill" else ROLE_WORDS.get(s[6:], s[6:]))
        elif s == "VSF+JAY":
            words = "Victory! + sting"
        rows.append({"event": ev, "source": spec.get("source", "mc"), "desc": spec.get("desc", ""),
                     "sound": s, "words": words, "gun_led": spec.get("gun_led"), "headset": spec.get("headset"), "flash": spec.get("flash"),
                     "text": TEXT.get(ev, ""),
                     "enabled": not ((spec.get("source") == "hud" and not prof.get("hud_events", True))
                                     or (spec.get("source") == "mc" and not prof.get("mc_events", True))
                                     or (spec["group"] in ("announcer", "objective") and not prof.get("announcer", True)))})
    return rows
