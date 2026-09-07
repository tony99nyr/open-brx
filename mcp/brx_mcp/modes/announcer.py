"""B18 — host-side killstreak / multikill announcer (MC as scorekeeper).

Mission Control is the scorekeeper and drives the feedback itself: watch credited
kills, and send the right feedback back to the SHOOTER's gun.

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

from .base import Action, Callout, KillConfirm, PlaySound

# The per-kill confirm line — CONFIRMED (sound-bank.md "V3A kill"; live in cap8).
KILL_LINE = "V3A"

MULTIKILL_WINDOW_S = 4.0  # data/medals.json Key 14 "Double Kill" (window_s)

# announcer sound ids -- read off the gun's own audio 2026-09-03 (Whisper transcripts in
# data/sound_catalog.json): VA7H "First Blood" · VA7E "Double Kill" · VA7Q "Triple Kill!" ·
# V124 "KILL TACULAR!" · VA7K "Killing spree". No "unstoppable" line exists in the bank, so the
# 10-streak stays Callout-only (None => no PlaySound).
DEFAULT_SOUNDS: dict[str, str | None] = {
    "first_blood": "VA7H",
    "double_kill": "VA7E",
    "triple_kill": "VA7Q",
    "killtacular": "V124",   # 4+ in a window
    "streak_5": "VA7K",      # killing spree
    "streak_10": None,       # "unstoppable": not in the bank
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
