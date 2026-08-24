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
LIVES_DEPLETED = "VA46"   # lives depleted / multi-kill
RESPAWN_PING = "N41"      # revive-countdown ping
DEATH_BEEP = "NA0"        # death beep

# --- Pickups / $SIR effects (CONFIRMED) ------------------------------------- #
ADD_HP = "H29"            # respawn / add-HP
ADD_ARMOR = "VA16"        # add armor
ADD_SHIELD = "VA8C"       # add shields

# --- Objective callouts (PROVISIONAL: V101–V144 range) ---------------------- #
# Exact clip TBD by ear; distinct ids within the documented objective range so
# grab/score/capture are at least audibly different from each other.
OBJECTIVE_TAKEN = "V100"    # enemy flag grabbed / objective taken
OBJECTIVE_SCORED = "V108"   # flag captured / objective scored
POINT_CAPTURED = "V109"     # control point / hill captured

# --- CS / bomb ------------------------------------------------------------- #
# A plant kicks off the detonation countdown → reuse COUNTDOWN (VA81) for it.
BOMB_DETONATED = "X13"      # explosion (CONFIRMED: rocket/explosion in the $SIR table)
BOMB_DEFUSED = "V110"       # PROVISIONAL success voice (objective-callout range)


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
    Cue("LIVES_DEPLETED", LIVES_DEPLETED, "lives depleted / multi-kill", CONFIRMED),
    Cue("RESPAWN_PING", RESPAWN_PING, "revive-countdown ping", CONFIRMED),
    Cue("DEATH_BEEP", DEATH_BEEP, "death beep", CONFIRMED),
    Cue("ADD_HP", ADD_HP, "respawn / add-HP", CONFIRMED),
    Cue("ADD_ARMOR", ADD_ARMOR, "add armor", CONFIRMED),
    Cue("ADD_SHIELD", ADD_SHIELD, "add shields", CONFIRMED),
    Cue("OBJECTIVE_TAKEN", OBJECTIVE_TAKEN, "enemy flag grabbed / objective taken", PROVISIONAL),
    Cue("OBJECTIVE_SCORED", OBJECTIVE_SCORED, "flag captured / objective scored", PROVISIONAL),
    Cue("POINT_CAPTURED", POINT_CAPTURED, "control point / hill captured", PROVISIONAL),
    Cue("BOMB_DETONATED", BOMB_DETONATED, "explosion / bomb detonated", CONFIRMED),
    Cue("BOMB_DEFUSED", BOMB_DEFUSED, "bomb defused (success voice)", PROVISIONAL),
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
