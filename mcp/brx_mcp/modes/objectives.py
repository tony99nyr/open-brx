"""Objective modes — Domination, King of the Hill, Capture the Flag (M0).

Host-rule engines over objective events emitted by a station device (Utility Box /
grenade / phone). Events (fed via on_event, or the convenience methods):
  CAPTURE <site> <team>   a point/hill was shot & claimed by <team>
  GRAB <flag> <team>      <team> grabbed the enemy flag (CTF)
  CAP <team>              <team> returned the enemy flag to base → a capture (CTF)
Plus `$HP,0` deaths (CTF drops a carried flag).

Domination/KotH score over TIME held (the station shows local truth; the host tallies).
CTF scores by flag captures. All fit the uniform GameEngine interface.
"""

from __future__ import annotations

from typing import Optional

from .base import (
    Action, Callout, GameEngine, GameOver, PlaySound, Roster, Score, hp_values,
)


def _ev(ev, i, default=None):
    t = ev.get("tokens", [])
    return t[i] if i < len(t) else default


class DominationEngine(GameEngine):
    """N control points; each point owned by a team scores 1 pt/s for it. Win at
    score_target (or most points-time when the clock runs out). KotH = 1 point."""

    def __init__(self, config, now: float = 0.0):
        self.config = config
        self.roster = Roster()
        n = max(1, getattr(config, "control_points", 3))
        self.sites = [chr(ord("A") + i) for i in range(n)]
        self.owner: dict[str, Optional[int]] = {s: None for s in self.sites}
        self.target = getattr(config, "score_target", 0) or 0
        self.start = now
        self._last_tick = now
        self._acc: dict[int, float] = {}
        self.over = False
        self.winner: Optional[str] = None

    def add_player(self, player_id: str, team: int) -> None:
        self.roster.add(player_id, team)
        self._acc.setdefault(team, 0.0)

    def capture(self, site: str, team: int, now: float) -> list[Action]:
        if self.over or site not in self.owner or self.owner[site] == team:
            return []
        self.owner[site] = team
        self._acc.setdefault(team, 0.0)
        held = sum(1 for o in self.owner.values() if o == team)
        return [Callout(f"Point {site} → team{team}  (holds {held}/{len(self.sites)})"),
                PlaySound("VA20", scope="all")]

    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        if self.over:
            return []
        if ev.get("command") == "CAPTURE":
            try:
                return self.capture(_ev(ev, 1), int(_ev(ev, 2)), now)
            except (TypeError, ValueError):
                return []
        return []

    def tick(self, now: float) -> list[Action]:
        if self.over:
            return []
        dt = now - self._last_tick
        self._last_tick = now
        if dt > 0:
            for owner in self.owner.values():
                if owner is not None:
                    self._acc[owner] = self._acc.get(owner, 0.0) + dt
        # win by score target
        if self.target:
            for team, sc in self._acc.items():
                if int(sc) >= self.target:
                    return self._end(f"team{team}")
        # time limit → most point-time wins
        if self.config.game_time_s and (now - self.start) >= self.config.game_time_s:
            return self._end(self._leader())
        return []

    def _leader(self) -> str:
        if not self._acc or max(self._acc.values(), default=0) == 0:
            return "draw"
        best = max(self._acc.values())
        leaders = [t for t, s in self._acc.items() if s == best]
        return f"team{leaders[0]}" if len(leaders) == 1 else "draw"

    def _end(self, winner: str) -> list[Action]:
        if self.over:
            return []
        self.over = True
        self.winner = winner
        return [GameOver(winner, detail=f"points={ {t:int(s) for t,s in self._acc.items()} }")]

    def snapshot(self) -> dict:
        return {"mode": "domination", "over": self.over, "winner": self.winner,
                "owner": dict(self.owner), "target": self.target,
                "score": {t: int(s) for t, s in self._acc.items()},
                "players": {pid: {"team": p.team} for pid, p in self.roster.players.items()}}


class CtfEngine(GameEngine):
    """Capture the Flag: grab the enemy flag, return it to your base to score. A
    carried flag drops (returns home) if the carrier dies. First to cap_target wins."""

    def __init__(self, config, now: float = 0.0):
        self.config = config
        self.roster = Roster()
        self.target = getattr(config, "cap_target", 3)
        self.start = now
        self.caps: dict[int, int] = {}
        self.carrier: dict[int, Optional[str]] = {}   # team → the enemy player carrying THEIR flag
        self.over = False
        self.winner: Optional[str] = None

    def add_player(self, player_id: str, team: int) -> None:
        self.roster.add(player_id, team)
        self.caps.setdefault(team, 0)

    def grab(self, team: int, player_id: str, now: float) -> list[Action]:
        """`team` grabbed the ENEMY flag; player_id carries it."""
        if self.over:
            return []
        return [Callout(f"team{team} grabbed the flag!"), PlaySound("VA81", scope="all")]

    def cap(self, team: int, now: float) -> list[Action]:
        if self.over:
            return []
        self.caps[team] = self.caps.get(team, 0) + 1
        actions: list[Action] = [Score(f"team{team}", +1, self.caps[team]),
                                 Callout(f"team{team} captured the flag! ({self.caps[team]})"),
                                 PlaySound("VA20", scope="all")]
        if self.caps[team] >= self.target:
            return actions + self._end(f"team{team}")
        return actions

    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        if self.over:
            return []
        cmd = ev.get("command")
        if cmd == "GRAB":
            p = self.roster.get(player_id)
            return self.grab(p.team if p else int(_ev(ev, 2, 0)), player_id, now)
        if cmd == "CAP":
            p = self.roster.get(player_id)
            return self.cap(p.team if p else int(_ev(ev, 1, 0)), now)
        hv = hp_values(ev)
        if hv is not None and hv[0] == 0:
            p = self.roster.get(player_id)
            if p:
                p.alive = False
                return [Callout(f"{player_id} down — flag returns")]
        return []

    def tick(self, now: float) -> list[Action]:
        if self.over:
            return []
        if self.config.game_time_s and (now - self.start) >= self.config.game_time_s:
            best = max(self.caps.values(), default=0)
            leaders = [t for t, c in self.caps.items() if c == best]
            return self._end(f"team{leaders[0]}" if best and len(leaders) == 1 else "draw")
        return []

    def _end(self, winner: str) -> list[Action]:
        if self.over:
            return []
        self.over = True
        self.winner = winner
        return [GameOver(winner, detail=f"caps={self.caps}")]

    def snapshot(self) -> dict:
        return {"mode": "ctf", "over": self.over, "winner": self.winner,
                "target": self.target, "caps": dict(self.caps),
                "players": {pid: {"team": p.team, "alive": p.alive}
                            for pid, p in self.roster.players.items()}}
