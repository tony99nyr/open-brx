"""Last Man Standing engine (M0).

Each player gets a fixed number of lives (config.respawns + 1). A death costs a
life and host-respawns while lives remain; at zero lives the player is eliminated
(no respawn). Last player (or last team) still in wins.
"""

from __future__ import annotations

from .base import Action, Callout, Eliminate, Player, Respawn, ScoredEngine
from .params import Param, resolve as _resolve_params


class LastManStandingEngine(ScoredEngine):
    # A18: `lives` on the wire. The CLI dataclass expresses it as `respawns` (lives - 1, None = unlimited);
    # `config.lives()` is passed as the fallback so that path keeps its meaning, and an unlimited CLI config
    # still gets the finite default LMS needs.
    PARAMS = {
        "lives": Param("int", 3, "lives per player; the last one standing wins", lo=1, hi=20),
    }

    def __init__(self, config, now: float = 0.0):
        super().__init__(config, now)
        lives_fn = getattr(config, "lives", None)
        cli_lives = lives_fn() if callable(lives_fn) else None
        self.params = _resolve_params(type(self), config, fallback={"lives": cli_lives})
        self._lives = self.params["lives"]

    def add_player(self, player_id: str, team: int) -> None:
        self.roster.add(player_id, team, lives=self._lives)

    # on_event: inherited from ScoredEngine — a fresh death is the only event
    # LMS reacts to, and that shared prologue+dispatch is byte-identical to
    # Infection's (clone review, 2026-09-07).

    def _handle_death(self, victim: Player, now: float) -> list[Action]:
        victim.alive = False
        victim.deaths += 1
        victim.dead_since = now
        if victim.lives is not None:
            victim.lives -= 1
        actions: list[Action] = []
        if victim.lives is not None and victim.lives <= 0:
            actions.append(Eliminate(victim.player_id))
            actions.append(Callout(f"{victim.player_id} eliminated"))
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
        # NOT shared with Deathmatch's _check_last_standing (clone review,
        # 2026-09-07): this names a lone survivor by PLAYER id and only falls
        # back to a team label for a multi-member team win. Deathmatch always
        # names the winner `team{t}`, even in FFA, and never looks at player
        # identity. Same shape (count who's still in, end if ≤1 standing),
        # different question ("which player or team" vs "which team") —
        # collapsing them would silently change one engine's winner format.
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

    # _end: inherited from ScoredEngine (no per-mode detail string to add).

    def snapshot(self) -> dict:
        return {
            "mode": "lms", "over": self.over, "winner": self.winner,
            "players": {pid: {"team": p.team, "alive": p.alive, "lives": p.lives,
                              "deaths": p.deaths}
                        for pid, p in self.roster.players.items()},
        }
