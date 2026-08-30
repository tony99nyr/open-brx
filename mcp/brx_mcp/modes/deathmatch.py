"""Team Deathmatch + Free-For-All engine (M0).

Scores kills from the event stream, host-respawns after the configured delay,
ends on time or frag limit. TDM scores by team; FFA scores per gun (each gun on
its own team via a unique $TID, so shooter-team → the specific killer).
"""

from __future__ import annotations

from typing import Optional

from .base import (
    Action, Callout, Eliminate, GameEngine, GameOver, Heal, Respawn, Roster, Score,
    hp_values, is_hit, shooter_team, shooter_player_id,
)
from .announcer import KillAnnouncer

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
        self._last_damage: dict[str, float] = {}   # player_id → time last hit (for regen)
        self._regenerated: set[str] = set()        # players already refilled this idle
        # B18 killstreak/multikill announcer — fires only where a SPECIFIC killer gun
        # is resolved (FFA / unique team). Sound ids come from config if present.
        self.announcer = KillAnnouncer(sounds=getattr(config, "announcer_sounds", None))

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
                # keep the shooter's PLAYER id too: team alone cannot identify the
                # killer once a team holds 2+ guns (Q17).
                self._last_shot[player_id] = (st, now, shooter_player_id(ev))
            return []
        hv = hp_values(ev)
        if hv is not None:
            if hv[0] == 0 and p.alive:                 # $HP,0 = died
                return self._handle_death(player_id, now)
            # a non-fatal $HP = took damage → (re)start the regen idle timer
            self._last_damage[player_id] = now
            self._regenerated.discard(player_id)
        return []

    def _handle_death(self, victim_id: str, now: float) -> list[Action]:
        v = self.roster.get(victim_id)
        v.alive = False
        v.deaths += 1
        v.dead_since = now
        self.announcer.on_death(victim_id)             # streak ends at death
        # clear regen state so a respawn (which already refills) doesn't trigger a
        # stale full-heal on the next idle tick.
        self._last_damage.pop(victim_id, None)
        self._regenerated.discard(victim_id)
        actions: list[Action] = []

        entry = self._last_shot.pop(victim_id, None)
        fresh = entry is not None and now - entry[1] <= ATTRIB_FUSE_S
        killer_team = entry[0] if fresh else None
        killer_wire_id = entry[2] if (fresh and len(entry) > 2) else None
        if killer_team is not None and killer_team != v.team:
            self.team_score[killer_team] = self.team_score.get(killer_team, 0) + 1
            # Credit the specific killer. Prefer the shooter's PLAYER id ($HIR token 3,
            # set per gun via $PSET token 1) — it identifies one gun even when a team
            # holds several. Fall back to team resolution, which only works 1:1 (FFA,
            # 1v1), for guns whose id we never assigned. Bench 2026-08-30 (Q17): without
            # this, TDM 2v1 credited nobody while team scoring stayed correct.
            killer = self.roster.by_wire_id(killer_wire_id)
            if killer is not None and killer.team != killer_team:
                killer = None          # id and team disagree: trust neither, don't guess
            if killer is None:
                killer = self.roster.sole_member_of_team(killer_team)
            if killer:
                killer.kills += 1
            who = (killer.player_id if (self._ffa and killer) else f"team{killer_team}")
            actions.append(Score(who, +1, self.team_score[killer_team]))
            actions.append(Callout(f"{who} scored (→ {self.team_score[killer_team]})"))
            if killer and killer.alive:   # per-shooter announcer — skip a dead trade-killer
                actions += self.announcer.on_kill(killer.player_id, victim_id, now)
            # Syphon: heal the killer on the kill. Needs the SPECIFIC killer — works in
            # FFA (team→player 1:1); in TDM it wants per-player id (P2), so skip there.
            if self.config.syphon and killer and killer.alive:
                actions.append(Heal(killer.player_id, hp=self.config.syphon_hp,
                                    armor=self.config.syphon_armor))
                self._regenerated.discard(killer.player_id)  # healed → allow regen again
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
        # host-driven regen (Halo shields): after no damage for the delay, refill to
        # full ($LIFE is additive+clamped, so a big grant tops them off). Once per idle.
        if self.config.regen:
            for pid, t in list(self._last_damage.items()):
                p = self.roster.get(pid)
                if (p and p.alive and pid not in self._regenerated
                        and now - t >= self.config.regen_delay_s):
                    actions.append(Heal(pid, hp=self.config.hp, armor=self.config.armor))
                    self._regenerated.add(pid)
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
            "announcer": self.announcer.snapshot(),
        }
