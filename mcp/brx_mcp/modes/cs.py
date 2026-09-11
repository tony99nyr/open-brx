"""Counter-Strike plant/defuse engine (M0 — flagship objective mode).

Attackers plant a bomb at a site (a Utility Box / grenade / phone-terminal); a
detonation countdown runs; defenders defuse to win the round, or it detonates.
The engine owns the ROUND logic + the detonation timer; the site device only
reports plant/defuse events (fed as `PLANT`/`DEFUSE` events, or via plant()/defuse()).

Round ends (standard CS):
  * bomb defused                → defenders
  * bomb detonates (timer)      → attackers
  * all defenders eliminated    → attackers (uncontested)
  * all attackers eliminated AND not planted → defenders
  * round time expires, not planted → defenders (survived)
First side to `rounds_to_win` wins the match.
"""

from __future__ import annotations

from typing import Optional

from .. import sounds as snd
from .base import (
    Action, Callout, GameEngine, GameOver, PlaySound, Roster, Score,
    hp_values,
)
from .params import Param, resolve as _resolve_params

# Grounded cues (brx_mcp/sounds.py). A plant starts the detonation countdown, so
# the plant cue IS the countdown clip.
PLANT_SOUND = snd.COUNTDOWN          # VA81 — detonation countdown begins
DEFUSE_SOUND = snd.BOMB_DEFUSED      # V110 (provisional success voice)
DETONATION_SOUND = snd.BOMB_DETONATED  # X13 — explosion


class BombEngine(GameEngine):
    # A18: the round rules an operator may set on `GameConfig.mode_params`. The two team ids are the
    # $TIDs of the sides (0-3, F35); `rounds_to_win` 0 keeps the CLI dataclass's meaning of "single round".
    PARAMS = {
        "detonation_s": Param("float", 40.0, "seconds from the plant to the detonation", lo=5, hi=600),
        "rounds_to_win": Param("int", 0, "rounds a side must win to take the match; 0 = a single round", lo=0, hi=30),
        "attackers_team": Param("int", 2, "$TID of the attacking side (plants the bomb)", lo=0, hi=3),
        "defenders_team": Param("int", 1, "$TID of the defending side (defuses it)", lo=0, hi=3),
    }

    def __init__(self, config, now: float = 0.0):
        self.config = config
        self.roster = Roster()
        self.params = _resolve_params(type(self), config)
        self.attackers = self.params["attackers_team"]
        self.defenders = self.params["defenders_team"]
        self.detonation_s = self.params["detonation_s"]
        self.round_time_s = config.game_time_s or 120
        self.rounds_to_win = self.params["rounds_to_win"] or 1
        self.score = {"attackers": 0, "defenders": 0}
        self.round = 1
        self.round_start = now
        self.over = False
        self.winner: Optional[str] = None
        self.planted_at: Optional[float] = None
        self.planted_site: Optional[str] = None
        self._round_done = False

    def add_player(self, player_id: str, team: int) -> None:
        self.roster.add(player_id, team)

    # -- objective events (from the site device) ----------------------------- #
    def plant(self, site: str, now: float) -> list[Action]:
        if self.over or self._round_done or self.planted_at is not None:
            return []
        # too late — the round clock already expired (defenders survived); a plant
        # arriving before the expiry tick must not flip the round to attackers.
        if now - self.round_start >= self.round_time_s:
            return self._end_round("defenders", now)
        self.planted_at = now
        self.planted_site = site
        return [Callout(f"Bomb planted at {site}! {int(self.detonation_s)}s"),
                PlaySound(PLANT_SOUND, scope="all")]

    def defuse(self, now: float) -> list[Action]:
        if self.over or self._round_done or self.planted_at is None:
            return []
        return [Callout("Bomb defused!"), PlaySound(DEFUSE_SOUND, scope="all")] + \
            self._end_round("defenders", now)

    # -- uniform interface --------------------------------------------------- #
    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        if self.over or self._round_done:
            return []
        cmd = ev.get("command")
        if cmd == "PLANT":
            t = ev.get("tokens", ["PLANT", "A"])
            return self.plant(t[1] if len(t) > 1 else "A", now)
        if cmd == "DEFUSE":
            return self.defuse(now)
        hv = hp_values(ev)
        if hv is not None and hv[0] == 0:
            p = self.roster.get(player_id)
            if p and p.alive:
                p.alive = False
                return self._check_elimination(now)
        return []

    def tick(self, now: float) -> list[Action]:
        if self.over or self._round_done:
            return []
        # detonation
        if self.planted_at is not None and now - self.planted_at >= self.detonation_s:
            return ([Callout("Bomb detonated!"), PlaySound(DETONATION_SOUND, scope="all")]
                    + self._end_round("attackers", now))
        # round time (only matters pre-plant; once planted the timer rules)
        if self.planted_at is None and now - self.round_start >= self.round_time_s:
            return self._end_round("defenders", now)
        return []

    # -- round / match resolution -------------------------------------------- #
    def _check_elimination(self, now: float) -> list[Action]:
        def alive(team):
            return [p for p in self.roster.team_members(team) if p.alive]
        if not alive(self.defenders):
            return self._end_round("attackers", now)
        if not alive(self.attackers) and self.planted_at is None:
            return self._end_round("defenders", now)
        return []

    def _end_round(self, winner_side: str, now: float) -> list[Action]:
        if self._round_done:
            return []
        self._round_done = True
        self.score[winner_side] += 1
        actions: list[Action] = [
            Score(winner_side, +1, self.score[winner_side]),
            Callout(f"Round {self.round} → {winner_side} "
                    f"(A {self.score['attackers']} – {self.score['defenders']} D)"),
        ]
        if self.score[winner_side] >= self.rounds_to_win:
            self.over = True
            self.winner = winner_side
            actions.append(GameOver(winner_side, detail=f"score={self.score}"))
        return actions

    def next_round(self, now: float) -> None:
        """Reset for the next round (driver calls between rounds). No-op if over."""
        if self.over:
            return
        self.round += 1
        self.round_start = now
        self.planted_at = None
        self.planted_site = None
        self._round_done = False
        for p in self.roster.players.values():
            p.alive = True

    def snapshot(self) -> dict:
        return {
            "mode": "cs", "over": self.over, "winner": self.winner,
            "round": self.round, "score": dict(self.score),
            "planted": self.planted_site, "rounds_to_win": self.rounds_to_win,
            "players": {pid: {"team": p.team, "alive": p.alive}
                        for pid, p in self.roster.players.items()},
        }
