"""Team Deathmatch + Free-For-All engine (M0).

Scores kills from the event stream, host-respawns after the configured delay,
ends on time or frag limit. TDM scores by team; FFA scores per gun (each gun on
its own team via a unique $TID, so shooter-team → the specific killer).
"""

from __future__ import annotations

from typing import Optional

from .base import (
    Action, Callout, Eliminate, GameEngine, GameOver, Respawn, Roster, Score,
    is_death, is_hit, shooter_team,
)

# A kill is credited to the last enemy who hit the victim WITHIN this window.
# Past it (suicide / environmental / expiry with no fresh $HIR), the death is
# uncredited — prevents an old non-fatal hitter stealing a stale kill.
ATTRIB_FUSE_S = 6.0


class DeathmatchEngine(GameEngine):
    def __init__(self, config, now: float = 0.0):
        self.config = config
        self.roster = Roster()
        self.team_score: dict[int, int] = {}
        self.start = now
        self.over = False
        self.winner: Optional[str] = None
        self._last_shot: dict[str, tuple[int, float]] = {}  # victim_id → (shooter team, when)
        self._ffa = (config.mode == "ffa")

    def add_player(self, player_id: str, team: int) -> None:
        self.roster.add(player_id, team, lives=self.config.lives())
        self.team_score.setdefault(team, 0)

    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        if self.over:
            return []
        p = self.roster.get(player_id)
        if p is None:
            return []
        if is_hit(ev):
            st = shooter_team(ev)
            if st is not None:
                self._last_shot[player_id] = (st, now)
            return []
        if is_death(ev) and p.alive:
            return self._handle_death(player_id, now)
        return []

    def _handle_death(self, victim_id: str, now: float) -> list[Action]:
        v = self.roster.get(victim_id)
        v.alive = False
        v.deaths += 1
        v.dead_since = now
        actions: list[Action] = []

        entry = self._last_shot.pop(victim_id, None)
        killer_team = entry[0] if (entry and now - entry[1] <= ATTRIB_FUSE_S) else None
        if killer_team is not None and killer_team != v.team:
            self.team_score[killer_team] = self.team_score.get(killer_team, 0) + 1
            # credit the specific killer where team→player is 1:1 (FFA)
            killer = self.roster.sole_member_of_team(killer_team)
            if killer:
                killer.kills += 1
            who = (killer.player_id if (self._ffa and killer) else f"team{killer_team}")
            actions.append(Score(who, +1, self.team_score[killer_team]))
            actions.append(Callout(f"{who} scored (→ {self.team_score[killer_team]})"))
            if self.config.frag_limit and self.team_score[killer_team] >= self.config.frag_limit:
                return actions + self._end(who)

        # lives / elimination
        if v.lives is not None:
            v.lives -= 1
            if v.lives <= 0:
                actions.append(Eliminate(victim_id))
                return actions + self._check_last_standing()
        return actions

    def tick(self, now: float) -> list[Action]:
        if self.over:
            return []
        actions: list[Action] = []
        # host respawn
        for p in list(self.roster.players.values()):
            if not p.alive and p.dead_since is not None and (p.lives is None or p.lives > 0):
                delay = self.config.respawn_delay(p.deaths - 1)
                if now - p.dead_since >= delay:
                    p.alive = True
                    p.dead_since = None
                    actions.append(Respawn(p.player_id))
        # time limit
        if self.config.game_time_s and (now - self.start) >= self.config.game_time_s:
            actions += self._end(self._leader())
        return actions

    def _leader(self) -> str:
        if not self.team_score:
            return "draw"
        best = max(self.team_score.values())
        leaders = [t for t, s in self.team_score.items() if s == best]
        if len(leaders) != 1:
            return "draw"
        t = leaders[0]
        if self._ffa:
            sole = self.roster.sole_member_of_team(t)
            return sole.player_id if sole else f"team{t}"
        return f"team{t}"

    def _check_last_standing(self) -> list[Action]:
        # "still in" = alive OR has a life left to respawn — a dead-but-respawning
        # teammate must NOT be counted out (else finite-lives games end early).
        teams = self.roster.standing_teams()
        if len(teams) <= 1:
            return self._end(f"team{next(iter(teams))}" if teams else "draw")
        return []

    def _end(self, winner: str) -> list[Action]:
        if self.over:
            return []
        self.over = True
        self.winner = winner
        return [GameOver(winner, detail=f"scores={self.team_score}")]

    def snapshot(self) -> dict:
        return {
            "mode": self.config.mode, "over": self.over, "winner": self.winner,
            "team_score": dict(self.team_score),
            "players": {pid: {"team": p.team, "alive": p.alive, "kills": p.kills,
                              "deaths": p.deaths, "lives": p.lives}
                        for pid, p in self.roster.players.items()},
        }
