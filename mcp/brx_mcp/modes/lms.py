"""Last Man Standing engine (M0).

Each player gets a fixed number of lives (config.respawns + 1). A death costs a
life and host-respawns while lives remain; at zero lives the player is eliminated
(no respawn). Last player (or last team) still in wins.
"""

from __future__ import annotations

from typing import Optional

from .base import (
    Action, Callout, Eliminate, GameEngine, GameOver, Respawn, Roster,
    is_death, is_hit, shooter_team,
)


class LastManStandingEngine(GameEngine):
    def __init__(self, config, now: float = 0.0):
        self.config = config
        self.roster = Roster()
        self.start = now
        self.over = False
        self.winner: Optional[str] = None
        self._last_shooter_team: dict[str, int] = {}
        # default 3 lives if unlimited was left on (LMS needs finite lives)
        self._lives = config.lives() if config.lives() is not None else 3

    def add_player(self, player_id: str, team: int) -> None:
        self.roster.add(player_id, team, lives=self._lives)

    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        if self.over:
            return []
        p = self.roster.get(player_id)
        if p is None:
            return []
        if is_hit(ev):
            st = shooter_team(ev)
            if st is not None:
                self._last_shooter_team[player_id] = st
            return []
        if is_death(ev) and p.alive:
            return self._handle_death(player_id, now)
        return []

    def _handle_death(self, victim_id: str, now: float) -> list[Action]:
        v = self.roster.get(victim_id)
        v.alive = False
        v.deaths += 1
        v.dead_since = now
        self._last_shooter_team.pop(victim_id, None)
        if v.lives is not None:
            v.lives -= 1
        actions: list[Action] = []
        if v.lives is not None and v.lives <= 0:
            actions.append(Eliminate(victim_id))
            actions.append(Callout(f"{victim_id} eliminated"))
            actions += self._check_win()
        return actions

    def tick(self, now: float) -> list[Action]:
        if self.over:
            return []
        actions: list[Action] = []
        for p in list(self.roster.players.values()):
            if not p.alive and p.dead_since is not None and (p.lives or 0) > 0:
                if now - p.dead_since >= self.config.respawn_delay(p.deaths - 1):
                    p.alive = True
                    p.dead_since = None
                    actions.append(Respawn(p.player_id))
        if self.config.game_time_s and (now - self.start) >= self.config.game_time_s:
            actions += self._check_win(force=True)
        return actions

    def _still_in(self):
        # a player is "in" if alive OR has lives left to respawn
        return [p for p in self.roster.players.values()
                if p.alive or (p.lives or 0) > 0]

    def _check_win(self, force: bool = False) -> list[Action]:
        standing = self._still_in()
        teams = {p.team for p in standing}
        if len(standing) <= 1 or len(teams) <= 1:
            if standing:
                w = standing[0].player_id if len(standing) == 1 else f"team{next(iter(teams))}"
            else:
                w = "draw"
            return self._end(w)
        if force:
            # time up with multiple in → most lives/kills wins, else draw
            standing.sort(key=lambda p: (p.lives or 0, p.kills), reverse=True)
            return self._end(standing[0].player_id)
        return []

    def _end(self, winner: str) -> list[Action]:
        if self.over:
            return []
        self.over = True
        self.winner = winner
        return [GameOver(winner)]

    def snapshot(self) -> dict:
        return {
            "mode": "lms", "over": self.over, "winner": self.winner,
            "players": {pid: {"team": p.team, "alive": p.alive, "lives": p.lives,
                              "deaths": p.deaths}
                        for pid, p in self.roster.players.items()},
        }
