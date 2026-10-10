"""B18 — the TIER 0 CLI killstreak / multikill announcer.

Not Mission Control's. This module is imported by `modes/deathmatch.py` and nothing
else: it serves `python -m brx_mcp play|game-sim`. Its medal ladder (keys, labels, clips,
the multikill window) is read from `mc.types.MEDALS` and `MULTI_KILL_MS`, so the CLI
announces what a match awards (A11, 2026-10-10).

The scorekeeper drives the feedback itself: watch credited kills, and send the right
feedback back to the SHOOTER's gun.

**This is what the official app does** — `cap8` (protocol §7o) caught Callsign, which
has no nRF radio either, emitting per kill over plain BLE:

    $SFLASH,*              the green-sight kill-confirm flash  (~0.4 s after the shot)
    $PLAY,,4,6,V3A,,,,*    "kill", on the token-4 ANNOUNCER slot
    $PLAY,,4,6,VB17,,,,*   score line, only when the lead changes

So the earlier reading — *"green-sight is nRF-only, BLE-invisible, audio
compensates"* — is **superseded**: it probed `$GLED` (team-derived, §7i), the wrong
command. The visual is ours too, via `KillConfirm`.

Pure / transport-free → unit-tested without hardware. An engine calls `on_kill`
when it credits a kill to a *specific* shooter gun (works where team→player is 1:1:
FFA / unique `$TID`, or once P2 sets a real PlayerID) and `on_death` when a gun
dies (its streak ends). The returned `PlaySound`/`Callout` Actions are executed by
the driver like any other.

Multikill window = **4 s** (data/medals.json Key 14 "Double Kill", restated from the app's own
game-medals-config.json -- see protocol/callsign-extract/RAW_ASSETS_NOTE.md: 2+ kills within 4 s
of the previous kill). Streaks are per-life and reset on the shooter's own death.

The plain **kill** line is CONFIRMED (`V3A`, documented as "kill" in `sound-bank.md`
and captured live). The **medal/streak** ids were read off the gun's own audio on
2026-09-03 (`data/sound_catalog.json`); they live in a config map so a mode can swap them.
Where an id is None only a `Callout` (the phrase) is emitted, so the driver can still
log/surface it; a set id also emits a `PlaySound` to the shooter.
"""
from __future__ import annotations

from ..mc.types import CLOCK_TIE_MS, MEDALS, MULTI_KILL_MS
from .base import Action, Callout, KillConfirm, PlaySound

# The per-kill confirm line — CONFIRMED (sound-bank.md "V3A kill"; live in cap8).
KILL_LINE = "V3A"

MULTIKILL_WINDOW_S = MULTI_KILL_MS / 1000   # data/medals.json Key 14 "Double Kill" (window_s)

# A11 (2026-10-10): the ladder is the match's own, `mc.types.MEDALS` (keys, labels and the gun's voice clips, read
# off its own audio 2026-09-03 and ear-checked 2026-09-24). This CLI kept a short copy that went silent past 4,
# named its keys `streak_5`/`streak_10` and had no clip for Unstoppable (VX0U). A clip of None = Callout only.
_LADDER = [m for m in MEDALS if m["kind"] in ("first", "multi", "streak")]
DEFAULT_SOUNDS: dict[str, str | None] = {m["key"]: m["clip"] for m in _LADDER}

# multikill tiers, highest first: (chain length, sound key, spoken phrase). A chain past the top tier repeats the
# top tier, the way `mc.scoring.Scorer` awards it.
_MULTIKILL = sorted(((m["count"], m["key"], m["label"].title()) for m in _LADDER if m["kind"] == "multi"), reverse=True)
# per-life streak count -> (sound key, spoken phrase)
_STREAK = {m["count"]: (m["key"], m["label"].title()) for m in _LADDER if m["kind"] == "streak"}
_FIRST_BLOOD = next(m for m in _LADDER if m["kind"] == "first")


class KillAnnouncer:
    def __init__(self, sounds: dict | None = None, window_s: float = MULTIKILL_WINDOW_S):
        self.sounds = dict(DEFAULT_SOUNDS)
        if sounds:
            self.sounds.update(sounds)
        self.window_s = window_s
        self._last_kill: dict[str, float] = {}   # shooter -> time of their previous kill
        self._chain: dict[str, int] = {}         # shooter -> current multikill chain length
        self._streak: dict[str, int] = {}        # shooter -> kills this life
        self._first_blood = False

    def _emit(self, key: str, phrase: str, shooter: str) -> list[Action]:
        acts: list[Action] = [Callout(phrase, scope=shooter)]
        sid = self.sounds.get(key)
        if sid:
            acts.insert(0, PlaySound(sid, scope=shooter, slot="voice"))
        return acts

    def on_kill(self, shooter: str, victim: str, now: float) -> list[Action]:
        """Credit a kill to `shooter` and return announcer Actions (scoped to shooter).

        Always leads with the app's own per-kill pair — the green-sight flash and the
        confirmed kill line (§7o) — then any medal/streak lines earned on top.
        """
        acts: list[Action] = [KillConfirm(scope=shooter)]
        if KILL_LINE:
            acts.append(PlaySound(KILL_LINE, scope=shooter, slot="voice"))

        if not self._first_blood:
            self._first_blood = True
            acts += self._emit(_FIRST_BLOOD["key"], _FIRST_BLOOD["label"].title(), shooter)

        # multikill: consecutive kills each within window_s of the previous one
        # Scorer's rule: a kill more than CLOCK_TIE_MS before the newest is late, a chain of one that never moves the
        # chain clock; inside the band (two kills a moment apart, arrived swapped) it still chains.
        # Whole milliseconds, as Scorer counts: 8.3 - 4.3 in floats is a hair over 4.0 and missed the inclusive edge.
        last = self._last_kill.get(shooter)
        gap_ms = None if last is None else round((now - last) * 1000)
        if gap_ms is not None and -gap_ms > CLOCK_TIE_MS:
            n = 1
        else:
            if gap_ms is not None and -CLOCK_TIE_MS <= gap_ms <= round(self.window_s * 1000):
                self._chain[shooter] = self._chain.get(shooter, 1) + 1
            else:
                self._chain[shooter] = 1
            self._last_kill[shooter] = max(now, last) if last is not None else now
            n = self._chain[shooter]
        tier = next(((key, phrase) for count, key, phrase in _MULTIKILL if n >= count), None)
        if n >= 2 and tier:                 # every chain kill voices its tier; past the top, the top repeats
            acts += self._emit(*tier, shooter)

        # streak: cumulative kills this life
        s = self._streak.get(shooter, 0) + 1
        self._streak[shooter] = s
        if s in _STREAK:
            key, phrase = _STREAK[s]
            acts += self._emit(key, phrase, shooter)

        return acts

    def on_death(self, player: str) -> None:
        """The player died: end their streak. The multikill chain is a clock window and survives, as in Scorer."""
        self._streak.pop(player, None)

    def snapshot(self) -> dict:
        return {"first_blood": self._first_blood,
                "streaks": dict(self._streak),
                "chains": dict(self._chain)}
