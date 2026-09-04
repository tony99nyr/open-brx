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
      "headset_team": bool,   # keep the headset on the team colour (repainted after spawn / hit)
      "sight_flash":  bool,   # $SFLASH on a credited kill
      "events": { <event>: { "sound": <id>|null, "gun_led": 0-8|null, "headset": 0-8|null } }
    }

Every sound id must be ON THE GUN (`sounds.on_gun_ids()`, from the catalog read off the hardware);
colours are the shared 9-colour palette (0 red · 1 blue · 2 yellow · 3 green · 4 purple · 5 teal ·
6 white · 7 pink · 8 orange). A preset name REPLACES the whole profile; editing any field afterwards
makes it `custom` (same rule as `loadout_policy`, A10.2).

What consumes it: `compile.py` turns it into the per-player bundle -- `cues[<event>]` (pre-composed
`$PLAY` frames, A6.3; a V-family id goes in the announcer slot, anything else in the SFX slot) and
`leds[<event>]` (the tuned 3-flash `$GLED` burst back to the team colour, hardware-tuned
2026-09-03, plus an optional static `$HLED`). The node plays them on its own events (hit_taken,
died, respawned, healed, armour_up, shield_up) and on MC `feedback` pushes (kill, multi, medal,
victory) and objective pushes. `announcer: false` empties every voice cue (the `$SFLASH` still
fires); `gun_flash: false` empties `leds`.

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
EVENTS: dict[str, dict] = {
    "hit_taken":     dict(source="hud", group="player",    desc="you were hit",                      sound=None,   gun_led=pg.RED,    headset=None),
    "died":          dict(source="hud", group="player",    desc="you are out",                       sound=None,   gun_led=pg.RED,    headset=None),
    "respawned":     dict(source="hud", group="player",    desc="back in",                           sound=None,   gun_led=pg.WHITE,  headset=None),
    "healed":        dict(source="hud", group="player",    desc="health restored",                   sound=None,   gun_led=pg.GREEN,  headset=None),
    "armour_up":     dict(source="hud", group="player",    desc="armour granted",                    sound=None,   gun_led=pg.PURPLE, headset=None),
    "shield_up":     dict(source="hud", group="player",    desc="shield granted",                    sound=None,   gun_led=pg.TEAL,   headset=None),
    "low_health":    dict(source="hud", group="player",    desc="armour gone, HP dropping (once per life)", sound="VA8B", gun_led=None, headset=pg.PINK),
    # -- the shooter's kill feedback (MC `feedback` push; ONE of these per kill, most specific wins) --
    "kill":          dict(source="mc", group="announcer", desc="you scored a kill",                 sound="voice:kill", gun_led=None, headset=None),
    "first_blood":   dict(source="mc", group="announcer", desc="first kill of the match",           sound="VA7H", gun_led=None,      headset=None),
    "double_kill":   dict(source="mc", group="announcer", desc="2 kills inside the multi window",   sound="VA7E", gun_led=None,      headset=None),
    "triple_kill":   dict(source="mc", group="announcer", desc="3 kills inside the window",         sound="VA7Q", gun_led=None,      headset=None),
    "killtacular":   dict(source="mc", group="announcer", desc="4+ kills inside the window",        sound="V124", gun_led=None,      headset=None),
    "killing_spree": dict(source="mc", group="announcer", desc="5 kills without dying",             sound="VA7K", gun_led=None,      headset=None),
    "unstoppable":   dict(source="mc", group="announcer", desc="10 kills without dying (no bank line; flash only)", sound=None, gun_led=None, headset=None),
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
    its OWN bundle (so the presentation profile is honoured per player) and shows `text` as a HUD alert."""
    body = {"kind": kind, "text": TEXT.get(kind, kind.replace("_", " ").upper())}
    for k, v in (extra or {}).items():
        if k not in ALERT_EXTRA:
            raise ValueError(f"alert extra {k!r} is not a wire field")
        body[ALERT_EXTRA[k]] = v
    return body


# The scorer's `extra` keys and the wire field each becomes. `player_id` (who turned / who is the last
# survivor) travels as `player_id_subject`: the body's `player_id` is the RECIPIENT, set per push by
# `Session._alert`, and the two collided until polish 2026-09-04 (the subject was silently overwritten).
ALERT_EXTRA = {"player_id": "player_id_subject", "carrier": "carrier", "flag_tid": "flag_tid", "hud": "hud"}


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
# wipe it (native flash, then dark); the blink form `$HLED,<c>,2,<on>,<off>,10,<count>` works in game; the
# firmware blinks the headset GREEN on its own while a player is out (the "out-blink", F13). Whether a
# count-limited blink ends DARK on its own is unverified, so every flash is followed by an explicit frame.
#   pregame:     "team" | "off"      lobby: the team colour (the headset organises teams -- Tony)
#   start_flash: bool                T-0: a white double-flash, then the in-play state
#   in_play:     "dark" | "team"     between events: dark (native-like) or held on the team colour
#   hit:         colour | null       a short flash of that colour on every hit taken (null = leave native)
#   death:       "native" | colour   while out: our slow blink in a colour (default GREEN, the native look).
#                "native" = write nothing -- ⚠ in a HOSTED game the firmware's own out-blink does NOT fire once
#                the node has taken the headset (Tony, live on the phones, 2026-09-04): the headset just stays
#                dark, and in scanner-respawn a downed player walking to a station is invisible as "out".
#   respawn_flash: bool              back in: a white double-flash, then the in-play state
#   carrier:     bool                holding the flag / objective: blink the FLAG colour until scored/lost/dead
HEADSET_DEFAULT = {"pregame": "team", "start_flash": True, "in_play": "dark", "hit": pg.RED,
                   "death": pg.GREEN, "respawn_flash": True, "carrier": True}
# The out-blink is ~0.8 s per cycle; 200 cycles is ~160 s. A scanner-respawn player can be down longer, so
# the node re-asserts frames.headset.death while it stays down (brx-grenade, engine side); the count itself is
# kept at 200 because token 6's upper range is unverified on hardware.
DEATH_BLINK_COUNT = 200
HEADSET_BLANK = "$HLED,,6,,,,,*"

# ---- the GUN BODY LED (A11.7, S4) ------------------------------------------------------------------
# Bench 2026-09-04 (brx-grenade, R0BQT, Tony watching; experiment-log "IN-GAME GUN LED CONTROL" + the
# three "GUN LED bench (S4)" entries): a spawned gun BREATHES its team colour and a plain $GLED only
# alternates with it -- but `$GLED,,,,5,,,*` (the blank) takes the LED out of the breathing loop: the gun
# goes dark and stays dark, and any colour painted after it HOLDS (snaps between colours, survives firing,
# reloads and registered hits; armour 70 -> 0 without losing the paint). `$SPAWN` re-enables the breathing,
# so the blank + paint go right after every $SPAWN (spawn AND revive). The three body LEDs are independent
# after a blank, and 10 is already maximum brightness.
#   in_play: "native"  = the firmware breathing; nothing is sent. NOT the default since the 2026-09-04 walkthrough:
#                        with the breathing running, EVERY event burst alternated with it ("all of the leds in every
#                        sequence were wrong, you aren't clearing the gleds" -- Tony, R0BQT, 45-step walkthrough).
#            "team"    = blank, then the team colour held solid (DEFAULT: bursts read, the body looks like today)
#            "dark"    = blank only: the gun body is off in play (events still flash)
#            "health"  = blank, then the health hue (green / yellow / red, poolgauge.HEALTH_BANDS); the node
#                        repaints on each band change and after every event burst
#   pregame: "team" | "off"  the armed, unspawned gun body: team colour (like the headset) or dark. Walkthrough
#                            2026-09-04, Tony: "the gun led does not get set on arm, its dark" -> default team.
GUN_DEFAULT = {"in_play": "team", "pregame": "team"}
# Bench 2026-09-04 (R0BQT, Tony watching, stage `raw` ladder): a blank INSIDE the spawn burst does not take -- the
# firmware's spawn animation re-enables the breathing. Bare $SPAWN then blank + paint at +1.0 s: breathing;
# +1.5 s: breathing; +2.0 s: SOLID. So the node takes the body 2.5 s after every $SPAWN (margin over 2.0).
GUN_AFTER_SPAWN_S = 2.5
GUN_IN_PLAY = ("native", "team", "dark", "health")
GUN_BLANK = "$GLED,,,,5,,,*"

_BASE = {"announcer": True, "gun_flash": True, "headset_team": True, "sight_flash": True,
         "hud_events": True, "mc_events": True, "mc_confidence": True, "headset": dict(HEADSET_DEFAULT),
         "gun": dict(GUN_DEFAULT)}
SWITCHES = ("announcer", "gun_flash", "headset_team", "sight_flash", "hud_events", "mc_events", "mc_confidence")

PRESETS: dict[str, dict] = {
    "standard": {**_BASE, "events": {}},
    # Tony: "silenced snipers cuts out the announcer stuff and extra led flashes"
    "silenced": {**_BASE, "announcer": False, "gun_flash": False, "events": {}},
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
    # Last man standing: a death is final, and the player's OWN gun knows that -- so the death gets the
    # heavier treatment. `last_survivor` is deliberately NOT in the preset: MC only learns deaths from
    # HUDs that are connected, so "one survivor remains" is exactly the announcement most likely to be
    # wrong or missing when HUDs drop off mid-game (Tony, 2026-09-04). It stays available as an event.
    "last_stand": {**_BASE, "events": {
        "died":          {"gun_led": pg.RED, "headset": pg.RED},                    # out for good: mark the head too
    }},
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
    if v in ("voice:kill", "VSF+JAY"):
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
            elif hk in ("start_flash", "respawn_flash", "carrier"):
                if not isinstance(hv, bool):
                    raise ValueError(f"presentation.headset.{hk} must be true/false")
                cur[hk] = hv
            elif hk == "hit":
                cur[hk] = _colour(hv)
            elif hk == "death":
                if hv is None:
                    raise ValueError("presentation.headset.death must be \"native\" or a colour (null would fail at push time)")
                cur[hk] = "native" if hv == "native" else _colour(hv)
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
                else:
                    raise ValueError(f"presentation.events.{ev}.{fk}: unknown field")
            prof["events"][ev] = cur
            edited = True
    if edited:
        prof["preset"] = "custom"
    return prof


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
    prof["headset"] = {**HEADSET_DEFAULT, **(base.get("headset") or {}), **(raw.get("headset") or {})}
    prof["gun"] = {**GUN_DEFAULT, **(base.get("gun") or {}), **(raw.get("gun") or {})}
    prof["events"] = {**prof.get("events", {}), **(raw.get("events") or {})}
    events = {}
    for ev, d in EVENTS.items():
        spec = {"sound": d["sound"], "gun_led": d["gun_led"], "headset": d["headset"], "group": d["group"],
                "source": d.get("source", "mc"), "desc": d["desc"]}
        spec.update({k: v for k, v in (prof.get("events") or {}).get(ev, {}).items() if k in ("sound", "gun_led", "headset")})
        events[ev] = spec
    prof["events"] = events
    return prof


def play_frame(sound: str, voice_kill_line: str | None) -> str | None:
    """A bank id -> the pre-composed `$PLAY` frame (A6.3). V-family ids speak on the announcer slot."""
    if sound == "voice:kill":
        return f"$PLAY,,4,6,{voice_kill_line},,,,*" if voice_kill_line else None
    if sound == "VSF+JAY":
        return "$PLAY,VSF,4,6,JAY,,,,*"
    if re.fullmatch(r"V[A-Z0-9]{1,3}", sound):
        return f"$PLAY,,4,6,{sound},,,,*"
    return f"$PLAY,{sound},4,6,,,,,*"


def cue_frames(profile: dict, voice_kill_line: str | None) -> dict[str, str]:
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
        fr = play_frame(s, voice_kill_line)
        if fr:
            out[ev] = fr
    return out


def led_table(profile: dict, team: int | None, night: bool, leds_on: bool) -> dict[str, list]:
    """event -> [[frame, hold_s], ...]: the tuned 3-flash gun burst ending on the team colour, then an
    optional static `$HLED` for the headset (hold 0 = leave it). Empty when LEDs are off for the game
    (night / blackout) or the profile turned gun flashes off."""
    if not leds_on:
        return {}
    out: dict[str, list] = {}
    for ev, spec in profile["events"].items():
        src = spec.get("source", "mc")
        if (src == "hud" and not profile.get("hud_events", True)) or (src == "mc" and not profile.get("mc_events", True)):
            continue
        if not profile.get("gun_flash", True):
            continue                        # "no extra led flashes": neither the gun burst nor a headset paint
        seq: list[list] = []
        c = spec.get("gun_led")
        if c is not None:
            flash = f"$GLED,{c},{c},{c},0,{pg.BRIGHT_DIM if night else pg.BRIGHT_FULL},,*"
            # A11.7: the burst ends on the gun's RESTING frame. Native / team: the team colour (the firmware
            # breathing or the held paint). Dark: the dark frame. Health: the full-health hue here, and the
            # node repaints the current band right after (it alone knows the hp).
            gf = gun_frames(profile, team, night, True)
            back = gf["rest"] if gf else pg.team_frame(team, night)
            for i in range(pg.BURST_FLASHES):
                seq.append([flash, pg.BURST_FLASH_S])
                seq.append([back, pg.BURST_GAP_S if i < pg.BURST_FLASHES - 1 else 0.0])
        h = spec.get("headset")
        if h is not None and ev != "low_health":          # low_health keeps Callsign's blink (cues.hurt_led)
            seq.append([f"$HLED,{h},0,,,10,,*", 0.0])
        if seq:
            out[ev] = seq
    return out


def _blink(colour: int, on_ms: int, off_ms: int, count: int) -> str:
    return f"$HLED,{colour},2,{on_ms},{off_ms},10,{count},*"


def headset_frames(profile: dict, tid: int | None, leds_on: bool, team_colours: dict[int, int] | None = None) -> dict:
    """The bundle's `headset` table (A11.6): what the NODE writes to the headset at each moment.

    Every entry is a list of [frame, hold_s] steps ending on an explicit state frame, because a
    count-limited blink ending dark on its own is not yet verified on hardware. `in_play` names the
    resting state the node returns to after every flash. Empty when LEDs are off for the game."""
    if not leds_on:
        return {}
    h = {**HEADSET_DEFAULT, **(profile.get("headset") or {})}
    team_paint = f"$HLED,{tid},0,,,10,,*" if tid is not None and 0 <= int(tid) <= 7 else None
    rest = team_paint if (h["in_play"] == "team" and team_paint) else HEADSET_BLANK
    white2 = _blink(pg.WHITE, 120, 120, 2)
    out: dict = {"in_play": h["in_play"], "rest": rest, "blank": HEADSET_BLANK,
                 "pregame": [team_paint] if (h["pregame"] == "team" and team_paint) else [],
                 "start": [[white2, 0.6], [rest, 0.0]] if h["start_flash"] else [[rest, 0.0]],
                 "hit": [[_blink(h["hit"], 100, 100, 2), 0.5], [rest, 0.0]] if h["hit"] is not None else [],
                 "death": [] if h["death"] == "native" else [[_blink(int(h["death"]), 400, 400, DEATH_BLINK_COUNT), 0.0]],
                 "respawn": [[white2, 0.6], [rest, 0.0]] if h["respawn_flash"] else [[rest, 0.0]],
                 "carrier": {}}
    if h["carrier"]:
        for t, c in (team_colours or {}).items():
            out["carrier"][str(t)] = [[_blink(int(c), 300, 300, 200), 0.0]]
    return out


def gun_frames(profile: dict, tid: int | None, night: bool, leds_on: bool) -> dict:
    """The bundle's `gun` table (A11.7): what the NODE paints on the gun body in play.

    {} when LEDs are off for the game or `in_play` is "native" (nothing is sent; the firmware breathes).
    Otherwise: `in_play`, `blank` (the frame that suppresses the breathing; sent once after every $SPAWN),
    `rest` (the frame that follows the blank: team colour, dark, or the full-health hue) and, for
    "health", `bands`: [[fraction_above, frame], ...] highest first -- the node paints the first band whose
    fraction the current hp/max exceeds, on every band change and at the end of every event burst."""
    g = {**GUN_DEFAULT, **(profile.get("gun") or {})}
    if not leds_on or g["in_play"] == "native":
        return {}
    b = pg.BRIGHT_DIM if night else pg.BRIGHT_FULL
    dark = f"$GLED,{pg.DARK},{pg.DARK},{pg.DARK},0,{b},,*"
    out: dict = {"in_play": g["in_play"], "blank": GUN_BLANK, "after_spawn_s": GUN_AFTER_SPAWN_S}
    if g["in_play"] == "team":
        out["rest"] = pg.team_frame(tid, night)
    elif g["in_play"] == "dark":
        out["rest"] = dark
    else:   # health
        out["bands"] = [[thr, pg.pool_paint_frame("health", int(round(thr * 1000)) + 1, 1000, night)] for thr, _c in pg.HEALTH_BANDS]
        out["rest"] = out["bands"][0][1]          # full health = the top band
    out["take"] = [GUN_BLANK, out["rest"]]        # what the node writes after_spawn_s after every $SPAWN
    return out


def gun_pregame(profile: dict, tid: int | None, night: bool, leds_on: bool) -> list[str]:
    """The armed-unspawned gun body: [team frame] when `gun.pregame` is team and LEDs are on. A paint holds on an
    unspawned gun (no breathing loop runs before $SPAWN); the spawn tail then blanks + repaints."""
    g = {**GUN_DEFAULT, **(profile.get("gun") or {})}
    if not leds_on or g.get("pregame", "team") != "team":
        return []
    return [pg.team_frame(tid, night)]


def gun_spawn_tail(profile: dict, tid: int | None, night: bool, leds_on: bool) -> list[str]:
    """RETIRED 2026-09-04 (kept for callers): a blank inside the spawn burst does not take; the node writes
    `gun.take` after `gun.after_spawn_s` instead. Always []."""
    return []


def summary(profile: dict) -> dict:
    """What the UI shows: preset + the four switches + which events carry a custom sound."""
    return {"preset": profile.get("preset", "standard"),
            **{k: bool(profile.get(k, True)) for k in SWITCHES},
            "headset": {**HEADSET_DEFAULT, **(profile.get("headset") or {})},
            "gun": {**GUN_DEFAULT, **(profile.get("gun") or {})},
            "custom_events": sorted(ev for ev, spec in (profile.get("events") or {}).items()
                                    if spec.get("sound") or spec.get("gun_led") is not None or spec.get("headset") is not None)}


def table(config: dict) -> list[dict]:
    """The resolved profile as rows for the MC's read-only ADVANCED view: every event with its source
    (hud / mc / both), what fires it, the sound (id + the catalog's words), and the colours."""
    prof = resolve(config)
    rows = []
    for ev, spec in prof["events"].items():
        s = spec.get("sound")
        words = ""
        if s and s not in ("voice:kill", "VSF+JAY"):
            words = snd.describe(s)
        elif s == "voice:kill":
            words = "the player's own voice: kill line"
        elif s == "VSF+JAY":
            words = "Victory! + sting"
        rows.append({"event": ev, "source": spec.get("source", "mc"), "desc": spec.get("desc", ""),
                     "sound": s, "words": words, "gun_led": spec.get("gun_led"), "headset": spec.get("headset"),
                     "text": TEXT.get(ev, ""),
                     "enabled": not ((spec.get("source") == "hud" and not prof.get("hud_events", True))
                                     or (spec.get("source") == "mc" and not prof.get("mc_events", True))
                                     or (spec["group"] in ("announcer", "objective") and not prof.get("announcer", True)))})
    return rows
