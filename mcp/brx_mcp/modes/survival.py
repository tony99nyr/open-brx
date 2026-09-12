"""Survival / Infection engine (M0).

Humans vs. infected. When a human dies, they respawn onto the INFECTED team
(host flips their $TID). Infected have unlimited respawns; humans that die are
converted. Win: last human alive (humans win at time limit if any survive).
"""

from __future__ import annotations

from .base import Action, Callout, Player, Respawn, ScoredEngine, SetTeam

HUMAN_TEAM = 1
INFECTED_TEAM = 2


class InfectionEngine(ScoredEngine):
    def __init__(self, config, now: float = 0.0,
                 human_team: int = HUMAN_TEAM, infected_team: int = INFECTED_TEAM):
        super().__init__(config, now)
        self.human_team = human_team
        self.infected_team = infected_team

    def add_player(self, player_id: str, team: int) -> None:
        # team as given (caller designates the starting infected — usually 1 player)
        self.roster.add(player_id, team, lives=None)

    # on_event: inherited from ScoredEngine — infection scores by conversion,
    # not kill credit, so a fresh death is the only event that matters, and
    # that shared prologue+dispatch is byte-identical to LMS's (clone review,
    # 2026-09-07).

    def _handle_death(self, victim: Player, now: float) -> list[Action]:
        victim.alive = False
        victim.deaths += 1
        victim.dead_since = now
        actions: list[Action] = []
        # a human who dies becomes infected
        if victim.team == self.human_team:
            victim.team = self.infected_team
            actions.append(SetTeam(victim.player_id, self.infected_team))
            actions.append(Callout(f"{victim.player_id} was infected!"))
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

    # _end: inherited from ScoredEngine (no per-mode detail string to add).

    def snapshot(self) -> dict:
        humans = [pid for pid, p in self.roster.players.items() if p.team == self.human_team]
        return {
            "mode": "infection", "over": self.over, "winner": self.winner,
            "humans_left": len(humans), "humans": humans,
            "players": {pid: {"team": p.team, "alive": p.alive, "deaths": p.deaths}
                        for pid, p in self.roster.players.items()},
        }
