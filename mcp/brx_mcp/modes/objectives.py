"""Objective modes — Domination, King of the Hill, Capture the Flag (M0).

Host-rule engines over objective events emitted by a station device (Utility Box /
grenade / phone). Events (fed via on_event, or the convenience methods):
  CAPTURE <site> <team>   a point/hill was shot & claimed by <team>
  GRAB <flag> <team>      <team> grabbed the enemy flag (CTF)
  CAP <team>              <team> returned the enemy flag to base → a capture (CTF)
  DROP <team>             <team>'s carried flag returned home (carrier tagged)
Plus `$HP,0` deaths (a callout; the station reports the actual flag DROP).
Objective events come from a station, so their team is the explicit token, not a
roster player — a missing/garbage/zero team token is ignored, not scored.

Domination/KotH score over TIME held (the station shows local truth; the host tallies).
CTF scores by flag captures. All fit the uniform GameEngine interface.
"""

from __future__ import annotations

from typing import Optional

from .. import sounds as snd
from .base import Action, Callout, PlaySound, Score, ScoredEngine, hp_values


def _ev(ev, i, default=None):
    t = ev.get("tokens", [])
    return t[i] if i < len(t) else default


def _team(ev, idx, roster, player_id):
    """Resolve a team for an objective event: the roster player if it came from a
    gun, else the event's team token. Returns None for a missing/garbage/zero team
    (station events are trusted but must be well-formed → don't fabricate team 0)."""
    p = roster.get(player_id)
    if p is not None:
        return p.team
    try:
        t = int(_ev(ev, idx))
        return t if t > 0 else None
    except (TypeError, ValueError):
        return None


class DominationEngine(ScoredEngine):
    """N control points; each point owned by a team scores 1 pt/s for it. Win at
    score_target (or most points-time when the clock runs out). KotH = 1 point.

    With score_target=0 AND game_time_s=0 the game is intentionally unlimited —
    it never self-ends; the operator stops it manually (teardown / GameOver)."""

    def __init__(self, config, now: float = 0.0):
        super().__init__(config, now)
        n = max(1, getattr(config, "control_points", 3))
        self.sites = [chr(ord("A") + i) for i in range(n)]
        self.owner: dict[str, Optional[int]] = {s: None for s in self.sites}
        self.target = getattr(config, "score_target", 0) or 0
        self._last_tick = now
        self._acc: dict[int, float] = {}

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
                PlaySound(snd.POINT_CAPTURED, scope="all")]

    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        if self.over:
            return []
        if ev.get("command") == "CAPTURE":
            team = _team(ev, 2, self.roster, player_id)   # guards garbage/zero/missing → None
            if team is None:
                return []
            return self.capture(_ev(ev, 1), team, now)
        return []

    def tick(self, now: float) -> list[Action]:
        if self.over:
            return []
        dt = now - self._last_tick
        self._last_tick = now
        if dt > 0:
            # A mid-interval steal credits the whole dt to the CURRENT owner.
            # Bounded by the ~0.5s tick cadence (run_live) → ≤0.5s misattributed
            # per steal; acceptable for scoring at this granularity.
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
        return super()._end(winner, detail=f"points={ {t:int(s) for t,s in self._acc.items()} }")

    def snapshot(self) -> dict:
        return {"mode": "domination", "over": self.over, "winner": self.winner,
                "owner": dict(self.owner), "target": self.target,
                "score": {t: int(s) for t, s in self._acc.items()},
                "players": {pid: {"team": p.team} for pid, p in self.roster.players.items()}}


class CtfEngine(ScoredEngine):
    """Capture the Flag: grab the enemy flag, return it to your base to score.
    Possession is tracked per team (`held`) — a CAP only scores if that team is
    actually carrying a flag. The station is the source of truth for grab/cap and
    for a DROP (the flag returned home, e.g. the carrier was tagged). First to
    cap_target wins.

    Station events carry the team explicitly (GRAB <flag> <team>, CAP <team>,
    DROP <team>) — they come from a station, not a player gun, so the team is
    resolved from the token, not the roster. A malformed/zero team is ignored."""

    def __init__(self, config, now: float = 0.0):
        super().__init__(config, now)
        self.target = getattr(config, "cap_target", 3)
        self.caps: dict[int, int] = {}
        self.held: set[int] = set()   # teams currently carrying the enemy flag

    def add_player(self, player_id: str, team: int) -> None:
        self.roster.add(player_id, team)
        self.caps.setdefault(team, 0)

    def grab(self, team: int, now: float) -> list[Action]:
        """`team` grabbed the ENEMY flag."""
        if self.over:
            return []
        self.held.add(team)
        return [Callout(f"team{team} grabbed the flag!"), PlaySound(snd.OBJECTIVE_TAKEN, scope="all")]

    def drop(self, team: int, now: float) -> list[Action]:
        """`team`'s carried flag returned home (carrier tagged / manual return)."""
        if self.over or team not in self.held:
            return []
        self.held.discard(team)
        return [Callout(f"team{team} dropped the flag — it returns home")]

    def cap(self, team: int, now: float) -> list[Action]:
        if self.over:
            return []
        if team not in self.held:                       # can't capture without carrying
            return [Callout(f"team{team} has no flag to capture")]
        self.held.discard(team)
        self.caps[team] = self.caps.get(team, 0) + 1
        actions: list[Action] = [Score(f"team{team}", +1, self.caps[team]),
                                 Callout(f"team{team} captured the flag! ({self.caps[team]})"),
                                 PlaySound(snd.OBJECTIVE_SCORED, scope="all")]
        if self.caps[team] >= self.target:
            return actions + self._end(f"team{team}")
        return actions

    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        if self.over:
            return []
        cmd = ev.get("command")
        if cmd == "GRAB":
            team = _team(ev, 2, self.roster, player_id)
            return self.grab(team, now) if team is not None else []
        if cmd == "CAP":
            team = _team(ev, 1, self.roster, player_id)
            return self.cap(team, now) if team is not None else []
        if cmd == "DROP":
            team = _team(ev, 1, self.roster, player_id)
            return self.drop(team, now) if team is not None else []
        hv = hp_values(ev)
        if hv is not None and hv[0] == 0:
            p = self.roster.get(player_id)
            if p:
                p.alive = False
                return [Callout(f"{player_id} down")]
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
        return super()._end(winner, detail=f"caps={self.caps}")

    def snapshot(self) -> dict:
        return {"mode": "ctf", "over": self.over, "winner": self.winner,
                "target": self.target, "caps": dict(self.caps),
                "held": sorted(self.held),
                "players": {pid: {"team": p.team, "alive": p.alive}
                            for pid, p in self.roster.players.items()}}
