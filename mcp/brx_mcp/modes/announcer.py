"""B18 — host-side killstreak / multikill announcer (MC as scorekeeper).

Implements the feedback layer proven possible over BLE in the 2026-08-25 bench
session (exp-log "feedback fork resolved"): the guns' native green-sight/"double
kill" ride the nRF mesh and are invisible to BLE, BUT `$PLAY,<id>` works over BLE,
so **Mission Control can rebuild the announcer audio itself** — watch credited
kills, and play the right line back to the SHOOTER's gun.

Pure / transport-free → unit-tested without hardware. An engine calls `on_kill`
when it credits a kill to a *specific* shooter gun (works where team→player is 1:1:
FFA / unique `$TID`, or once P2 sets a real PlayerID) and `on_death` when a gun
dies (its streak ends). The returned `PlaySound`/`Callout` Actions are executed by
the driver like any other.

Multikill window = **4 s** (game-medals-config.json Key 14: 2+ kills within 4 s of
the previous kill). Streaks are per-life and reset on the shooter's own death.

Sound ids are **UNCONFIRMED** — the digested sound-bank lacks the medal announcer
ids. They live in a config map to fill from a bench `$PLAY` probe or the full 2166
bank. Until an id is set, only a `Callout` (the phrase) is emitted, so the driver
can still log/surface it; a set id also emits a `PlaySound` to the shooter.
"""
from __future__ import annotations

from .base import Action, Callout, PlaySound

MULTIKILL_WINDOW_S = 4.0  # game-medals-config.json Key 14

# announcer sound ids — CONFIRM on bench; None => Callout only (no PlaySound yet).
DEFAULT_SOUNDS: dict[str, str | None] = {
    "first_blood": None,
    "double_kill": None,
    "triple_kill": None,
    "killtacular": None,   # 4+ in a window
    "streak_5": None,      # killing spree
    "streak_10": None,     # unstoppable
}

# multikill chain length -> (sound key, spoken phrase). 5+ in a window announces
# nothing new (the per-life streak lines take over) rather than repeating the top tier.
_MULTIKILL = {2: ("double_kill", "Double Kill"),
              3: ("triple_kill", "Triple Kill"),
              4: ("killtacular", "Killtacular")}
# per-life streak count -> (sound key, spoken phrase)
_STREAK = {5: ("streak_5", "Killing Spree"),
           10: ("streak_10", "Unstoppable")}


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
            acts.insert(0, PlaySound(sid, scope=shooter))
        return acts

    def on_kill(self, shooter: str, victim: str, now: float) -> list[Action]:
        """Credit a kill to `shooter` and return announcer Actions (scoped to shooter)."""
        acts: list[Action] = []

        if not self._first_blood:
            self._first_blood = True
            acts += self._emit("first_blood", "First Blood", shooter)

        # multikill: consecutive kills each within window_s of the previous one
        last = self._last_kill.get(shooter)
        if last is not None and (now - last) <= self.window_s:
            self._chain[shooter] = self._chain.get(shooter, 1) + 1
        else:
            self._chain[shooter] = 1
        self._last_kill[shooter] = now
        n = self._chain[shooter]
        if n in _MULTIKILL:                 # announce each tier once (2/3/4); 5+ is silent
            key, phrase = _MULTIKILL[n]
            acts += self._emit(key, phrase, shooter)

        # streak: cumulative kills this life
        s = self._streak.get(shooter, 0) + 1
        self._streak[shooter] = s
        if s in _STREAK:
            key, phrase = _STREAK[s]
            acts += self._emit(key, phrase, shooter)

        return acts

    def on_death(self, player: str) -> None:
        """The player died — end their streak and reset their multikill chain."""
        self._streak.pop(player, None)
        self._chain.pop(player, None)
        self._last_kill.pop(player, None)

    def snapshot(self) -> dict:
        return {"first_blood": self._first_blood,
                "streaks": dict(self._streak),
                "chains": dict(self._chain)}
