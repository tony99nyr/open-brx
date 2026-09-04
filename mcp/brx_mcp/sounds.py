"""Grounded BRX sound catalog — semantic names → verified `$PLAY` sound IDs.

The gun's **2166-id bank** (`protocol/callsign-extract/sound-bank.md`, from the
Callsign app's `Sounds.json`) is the set of valid `$PLAY,<id>,…` arguments — an id
not in the bank plays a fallback (experiment-log #7). This module gives the engines
*semantic* names so they emit the RIGHT clip instead of a raw literal, and records
how sure we are of each mapping.

Confidence:
  CONFIRMED   — heard in a capture, in the `$SIR` table, or in David Knox's
                "DK BRX Audio File Names" map (credit DK; restated as reference).
  PROVISIONAL — in the correct *documented range* but the exact clip isn't yet
                verified by ear. V101–V144 are the app's CTF/Slayer/KotH voice
                callouts (sound-bank.md); which one is which is a by-ear task
                (verification-checklist → "objective callouts"). Safe to ship:
                every id here is a real bank id, so it plays *a* real clip.

Every id in this module is asserted to exist in the real bank by test_sounds.py.
"""
from __future__ import annotations

from dataclasses import dataclass

CONFIRMED = "confirmed"
PROVISIONAL = "provisional"

# --- Game flow (CONFIRMED: captures / DK map) ------------------------------- #
CONNECT = "VA20"          # "connection established"
COUNTDOWN = "VA81"        # 3-2-1 spawn countdown
GAME_OVER = "VA33"        # game over + music
GAME_OVER_QUIET = "VA85"  # countdown to game-over, no music
LIVES_DEPLETED = "VA46"   # "Life's depleted." (transcript 2026-09-03) -- lives, NOT a multi-kill cue
RESPAWN_PING = "N41"      # revive-countdown ping
DEATH_BEEP = "NA0"        # death beep

# --- Pickups / $SIR effects (CONFIRMED) ------------------------------------- #
ADD_HP = "H29"            # respawn / add-HP
ADD_ARMOR = "VA1G"        # "Body Armor." (VA16 is "armor suit", a menu item)
ADD_SHIELD = "VA8C"       # add shields

# --- Objective callouts (VERIFIED BY TRANSCRIPT 2026-09-03) ------------------- #
# Every id below was read off the gun's own audio (Whisper transcript, `data/sound_catalog.json`).
# The previous PROVISIONAL picks from the "V101-V144 range" were wrong in kind, not just in
# detail: V100 is a death scream and V108/V110 are twelve-second game-rules explainers.
# More: HILL_CAPTURED = "VB0N", BOMB_PLANTED = "VA1I", FLAG_RETURNED = "VB0D".
OBJECTIVE_TAKEN = "VB0E"    # "flag taken" (V100 was a DEATH SCREAM -- transcript 2026-09-03)
OBJECTIVE_SCORED = "VB0C"   # "Flag captured." (V108 was the 12 s KotH rules explainer)
POINT_CAPTURED = "VA23"     # "Control Point Captured." (V109 was "Capture the flag!", a mode name)

# --- CS / bomb ------------------------------------------------------------- #
# A plant kicks off the detonation countdown → reuse COUNTDOWN (VA81) for it.
BOMB_DETONATED = "X13"      # explosion (CONFIRMED: rocket/explosion in the $SIR table)
HILL_CAPTURED = "VB0N"      # "Hill Captured"
BOMB_PLANTED = "VA1I"       # "Bomb Planted"
FLAG_RETURNED = "VB0D"      # "Flag returned."
# --- Extraction (game-modes.md §Extraction; ARC Raiders / Fortnite-Sprites shape) --------- #
EXTRACTION_CALLED = "VA1C"  # "Black Hawk inbound." -- the extractor's own LOUD call
EXTRACTION_OPEN = "VA1U"    # "Incoming Chopper." -- the window is open
EXTRACTION_ALERT = "VA1S"   # "enemy chopper detected." -- what everyone else hears
EXTRACTED = "VQ8"           # "Objective complete!"
EXTRACTION_FAILED = "VA8X"  # "Fail."
LOOT_PICKED = "VA1Q"        # "Care Package."
RAID_ENDING = "VA3U"        # "Incoming air raid, find cover."
BOMBARDMENT = "X20"         # four artillery explosions (Tony, by ear 2026-09-04)
BOMB_DEFUSED = "VA1H"       # "BOMB DEFUSED" (V110 was the 12 s Slayer Pro rules explainer)


@dataclass(frozen=True)
class Cue:
    name: str
    sid: str
    meaning: str
    confidence: str


CATALOG: tuple[Cue, ...] = (
    Cue("CONNECT", CONNECT, "connection established", CONFIRMED),
    Cue("COUNTDOWN", COUNTDOWN, "3-2-1 spawn countdown", CONFIRMED),
    Cue("GAME_OVER", GAME_OVER, "game over + music", CONFIRMED),
    Cue("GAME_OVER_QUIET", GAME_OVER_QUIET, "countdown to game-over, no music", CONFIRMED),
    Cue("LIVES_DEPLETED", LIVES_DEPLETED, "\"Life's depleted\"", CONFIRMED),
    Cue("RESPAWN_PING", RESPAWN_PING, "revive-countdown ping", CONFIRMED),
    Cue("DEATH_BEEP", DEATH_BEEP, "death beep", CONFIRMED),
    Cue("ADD_HP", ADD_HP, "respawn / add-HP", CONFIRMED),
    Cue("ADD_ARMOR", ADD_ARMOR, "\"Body Armor\"", CONFIRMED),
    Cue("ADD_SHIELD", ADD_SHIELD, "add shields", CONFIRMED),
    Cue("OBJECTIVE_TAKEN", OBJECTIVE_TAKEN, "\"flag taken\"", CONFIRMED),
    Cue("OBJECTIVE_SCORED", OBJECTIVE_SCORED, "\"Flag captured\"", CONFIRMED),
    Cue("POINT_CAPTURED", POINT_CAPTURED, "\"Control Point Captured\"", CONFIRMED),
    Cue("HILL_CAPTURED", HILL_CAPTURED, "\"Hill Captured\"", CONFIRMED),
    Cue("BOMB_PLANTED", BOMB_PLANTED, "\"Bomb Planted\"", CONFIRMED),
    Cue("FLAG_RETURNED", FLAG_RETURNED, "\"Flag returned\"", CONFIRMED),
    Cue("BOMB_DETONATED", BOMB_DETONATED, "explosion / bomb detonated", CONFIRMED),
    Cue("BOMB_DEFUSED", BOMB_DEFUSED, "\"BOMB DEFUSED\"", CONFIRMED),
    Cue("EXTRACTION_CALLED", EXTRACTION_CALLED, "\"Black Hawk inbound\"", CONFIRMED),
    Cue("EXTRACTION_OPEN", EXTRACTION_OPEN, "\"Incoming Chopper\"", CONFIRMED),
    Cue("EXTRACTION_ALERT", EXTRACTION_ALERT, "\"enemy chopper detected\"", CONFIRMED),
    Cue("EXTRACTED", EXTRACTED, "\"Objective complete!\"", CONFIRMED),
    Cue("EXTRACTION_FAILED", EXTRACTION_FAILED, "\"Fail\"", CONFIRMED),
    Cue("LOOT_PICKED", LOOT_PICKED, "\"Care Package\"", CONFIRMED),
    Cue("RAID_ENDING", RAID_ENDING, "\"Incoming air raid, find cover\"", CONFIRMED),
    Cue("BOMBARDMENT", BOMBARDMENT, "artillery bombardment (by ear)", CONFIRMED),
)

BY_NAME: dict[str, Cue] = {c.name: c for c in CATALOG}
BY_ID: dict[str, Cue] = {c.sid: c for c in CATALOG}


def sid(name: str) -> str:
    """Semantic name → sound id (raises KeyError if not catalogued)."""
    return BY_NAME[name].sid


def meaning(sound_id: str) -> str:
    """Sound id → human label, or the id itself if not catalogued."""
    c = BY_ID.get(sound_id)
    return c.meaning if c else sound_id


def provisional() -> list[Cue]:
    """Cues whose exact clip still needs by-ear confirmation."""
    return [c for c in CATALOG if c.confidence == PROVISIONAL]


def unknown_against_bank(bank_ids) -> list[str]:
    """Catalog ids NOT present in the given bank (for grounding validation)."""
    bank = set(bank_ids)
    return [c.sid for c in CATALOG if c.sid not in bank]


def catalog_path():
    """The derived on-gun catalog (`data/sound_catalog.json`, built by tools/soundbank_classify.py)."""
    import pathlib
    return pathlib.Path(__file__).with_name("data") / "sound_catalog.json"


def on_gun_ids() -> set[str]:
    """Ids physically present on a v4.32 tagger (2026-09-03). The app's Sounds.json lists 157 ids the
    gun does not have; those play the fallback, so THIS is the set to validate against."""
    import json
    data = json.load(open(catalog_path()))
    return {e["id"] for e in data["sounds"] if e.get("on_gun")}


def describe(sound_id: str) -> str:
    """Catalog description for an id (transcript for voices, shape for effects), or '' if unknown."""
    import json
    for e in json.load(open(catalog_path()))["sounds"]:
        if e["id"] == sound_id:
            return e.get("transcript") or e.get("description", "")
    return ""

