"""Survival / Infection engine (M0).

Humans vs. infected. When a human dies, they respawn onto the INFECTED team
(host flips their $TID). Infected have unlimited respawns; humans that die are
converted. Win: last human alive (humans win at time limit if any survive).
"""

from __future__ import annotations

from typing import Optional

from .base import (
    Action, Callout, GameEngine, GameOver, Respawn, Roster, SetTeam,
    is_death, is_hit, shooter_team,
)

HUMAN_TEAM = 1
INFECTED_TEAM = 2


class InfectionEngine(GameEngine):
    def __init__(self, config, now: float = 0.0,
                 human_team: int = HUMAN_TEAM, infected_team: int = INFECTED_TEAM):
        self.config = config
        self.roster = Roster()
        self.human_team = human_team
        self.infected_team = infected_team
        self.start = now
        self.over = False
        self.winner: Optional[str] = None
        self._last_shooter_team: dict[str, int] = {}

    def add_player(self, player_id: str, team: int) -> None:
        # team as given (caller designates the starting infected — usually 1 player)
        self.roster.add(player_id, team, lives=None)

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
        actions: list[Action] = []
        # a human who dies becomes infected
        if v.team == self.human_team:
            v.team = self.infected_team
            actions.append(SetTeam(victim_id, self.infected_team))
            actions.append(Callout(f"{victim_id} was infected!"))
            actions += self._check_win()
        return actions

    def tick(self, now: float) -> list[Action]:
        if self.over:
            return []
        actions: list[Action] = []
        for p in list(self.roster.players.values()):
            if not p.alive and p.dead_since is not None:
                if now - p.dead_since >= self.config.respawn_delay(p.deaths - 1):
                    p.alive = True
                    p.dead_since = None
                    actions.append(Respawn(p.player_id))
        if self.config.game_time_s and (now - self.start) >= self.config.game_time_s:
            humans = [p for p in self.roster.players.values() if p.team == self.human_team]
            actions += self._end("humans" if humans else "infected")
        return actions

    def _check_win(self) -> list[Action]:
        humans = [p for p in self.roster.players.values() if p.team == self.human_team]
        if not humans:
            return self._end("infected")
        return []

    def _end(self, winner: str) -> list[Action]:
        if self.over:
            return []
        self.over = True
        self.winner = winner
        return [GameOver(winner)]

    def snapshot(self) -> dict:
        humans = [pid for pid, p in self.roster.players.items() if p.team == self.human_team]
        return {
            "mode": "infection", "over": self.over, "winner": self.winner,
            "humans_left": len(humans), "humans": humans,
            "players": {pid: {"team": p.team, "alive": p.alive, "deaths": p.deaths}
                        for pid, p in self.roster.players.items()},
        }
