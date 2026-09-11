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

**Domination/KotH also run off a real BRX Smart Grenade**, with no station device at all:
`hillbeacon` decodes the grenade's protocol-15 `$HIR` beacons and `DominationEngine` consumes them
in the same `on_event`. The two sources are deliberately NOT unified, because their team tokens do
not mean the same thing:

* A `$CAPTURE` is host-authored text, so a **zero** team is malformed and is refused (`_team()`).
* A beacon's team is the wire's 2-bit `$TID` field, where **0 is a real team (red)** and **2 means
  NEUTRAL** — bench-captured 2026-09-10 in both directions. Routing a beacon through `_team()` would
  throw away every capture by team red and score neutral as if a team owned it.
"""

from __future__ import annotations

from typing import Optional

from .. import sounds as snd
from . import hillbeacon as hb
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
        # The grenade bridge. A beacon carries no station id (the player field is 0 on every beacon
        # ever captured), so it can only ever speak for ONE point — the first site. That is exactly
        # KotH; a multi-point Domination still needs a station source that names its point.
        self.beacons = hb.HillBeaconReader()
        self.hill_site = self.sites[0]

    def add_player(self, player_id: str, team: int) -> None:
        """🔴 F82: **team 2 is not a team here, it is NEUTRAL.**

        A neutral hill broadcasts team 2, and the gun's polarity gate compares that against its own
        `$TID`. A player rostered on team 2 therefore reads every uncaptured point as their own:
        they go deaf to it under an enemy-only `$SIR` row and the hill's `proto=0` damage word
        cannot land on them, so they walk onto any neutral point untouched while everyone else is
        contested. Both halves are bench-measured; only the consequence is predicted, and it is
        cheap to make impossible. Teams 0, 1 and 3 are all free.

        This raises rather than silently re-assigning: a hill mode that quietly moved a player to
        another team would hand them a different set of enemies than the operator set up.
        """
        if team == hb.NEUTRAL_TEAM:
            raise ValueError(
                f"F82: {player_id!r} cannot be on team {hb.NEUTRAL_TEAM} in a hill mode — that is "
                "the value a NEUTRAL grenade broadcasts, so this player would read every uncaptured "
                "point as their own and take no hill damage. Use team 0, 1 or 3.")
        self.roster.add(player_id, team)
        self._acc.setdefault(team, 0.0)

    def _in_play(self, team: Optional[int]) -> bool:
        """Can `team` actually field a player in THIS match?

        🔴 Ownership and scoring are not the same question, and conflating them let a team with
        nobody in it win a game. A grenade PERSISTS its hill owner between matches (F70: ten
        straight beacons on one owner), so a hill still held by red from an earlier game beacons red
        from the first second of a blue/green match. The engine adopted that owner — correctly, the
        point really is held — and then `tick()` accrued 1 pt/s for it and `_leader()` announced
        `team0` as the winner. A team that cannot field a player cannot hold a point *for score*.
        """
        return team is not None and any(p.team == team for p in self.roster.players.values())

    def capture(self, site: str, team: Optional[int], now: float,
                from_neutral: Optional[bool] = None) -> list[Action]:
        """`team` is the NEW owner, or None when the point went neutral (nobody accrues).

        `from_neutral` says whether the point was UNOWNED before, and it changes who is told what:
        taking a neutral point is one announcement to everybody, while stealing one is two facts at
        once — the side that took it hears "Hill Captured", the side that lost it hears "Hill Lost".
        None means the caller could not tell (no prior beacon), and the engine falls back to its own
        record of the owner. On the beacon path this is exactly the `mag=53` distinction: present =
        taken from neutral, absent = stolen from an enemy.
        """
        if self.over or site not in self.owner or self.owner[site] == team:
            return []
        previous = self.owner[site]
        self.owner[site] = team
        if team is None:
            return [Callout(f"Point {site} → neutral")]
        in_play = self._in_play(team)
        if in_play:
            self._acc.setdefault(team, 0.0)
        held = sum(1 for o in self.owner.values() if o == team)
        acts: list[Action] = [
            Callout(f"Point {site} → team{team}  (holds {held}/{len(self.sites)})" if in_play else
                    f"Point {site} → team{team}, who are NOT IN THIS MATCH — held, not scoring")]
        stolen = (previous is not None) if from_neutral is None else (not from_neutral)
        if not stolen:
            # Nobody in this match took it, so there is nothing to announce to anybody. (A STEAL by
            # an outsider still falls through to the loop below: whoever LOST the point is told, and
            # `p.team == team` cannot match, so no one hears "Hill Captured".)
            if in_play:
                acts.append(PlaySound(hb.HILL_CAPTURED, scope="all", slot="voice"))
            return acts
        # A steal. `previous` is the team that lost it when we know it; when we do not (the node
        # joined mid-match and only learned of the theft from a mag=50), everyone who is not the
        # capturing team hears the loss — that is the honest read of "somebody lost this point".
        for pid, p in self.roster.players.items():
            if p.team == team:
                acts.append(PlaySound(hb.HILL_CAPTURED, scope=pid, slot="voice"))
            elif previous is None or p.team == previous:
                acts.append(PlaySound(hb.HILL_LOST, scope=pid, slot="voice"))
        return acts

    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        if self.over:
            return []
        if ev.get("command") == "CAPTURE":
            team = _team(ev, 2, self.roster, player_id)   # guards garbage/zero/missing → None
            if team is None:
                return []
            return self.capture(_ev(ev, 1), team, now)
        return self._on_beacon(player_id, ev, now)

    def _on_beacon(self, player_id: str, ev: dict, now: float) -> list[Action]:
        """The grenade bridge. Costs one dict lookup for any frame that is not a proto-15 `$HIR` —
        including the hill's ambient `proto=0 mag=8` damage word, which must never move ownership."""
        acts: list[Action] = []
        for be in self.beacons.on_event(player_id, ev, now):
            if isinstance(be, hb.PointCaptured):
                acts += self.capture(self.hill_site, be.owner, now, from_neutral=be.from_neutral)
            elif isinstance(be, hb.HillBeacon) and self.owner[self.hill_site] != be.owner:
                # The heartbeat reports an owner we do not have: we missed the mag=50 (out of range
                # for a beat), or the game joined a hill that was already held. Adopt it — the
                # grenade is ground truth for SCORING — but announce nothing, because the capture
                # already happened and may be minutes old.
                self.owner[self.hill_site] = be.owner
                if self._in_play(be.owner):
                    self._acc.setdefault(be.owner, 0.0)
            elif isinstance(be, hb.NeutralCaptureConfirmed) and be.corrected:
                acts.append(Callout(f"Point {self.hill_site} was neutral (mag 53 confirms)"))
        return acts

    def tick(self, now: float) -> list[Action]:
        if self.over:
            return []
        dt = now - self._last_tick
        self._last_tick = now
        # Presence ages out on ≥ 2 missed beacons, never on one: reception at the edge of range is
        # intermittent by measurement (rung R), so a single miss is normal, not "left the hill".
        left = [Callout(f"{e.player_id} left {self.hill_site}") for e in self.beacons.expire(now)]
        if dt > 0:
            # A mid-interval steal credits the whole dt to the CURRENT owner.
            # Bounded by the ~0.5s tick cadence (run_live) → ≤0.5s misattributed
            # per steal; acceptable for scoring at this granularity.
            for owner in self.owner.values():
                # `_in_play`, not `is not None`: this line creates the accumulator itself, so a
                # hill held by a team that is not in this match would score (and win) here no
                # matter what `capture()` refused to set up. See `_in_play`.
                if self._in_play(owner):
                    self._acc[owner] = self._acc.get(owner, 0.0) + dt
        # win by score target
        if self.target:
            for team, sc in self._acc.items():
                if int(sc) >= self.target:
                    return left + self._end(f"team{team}")
        # time limit → most point-time wins
        if self.config.game_time_s and (now - self.start) >= self.config.game_time_s:
            return left + self._end(self._leader())
        return left

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
        # `hill` is ADDITIVE — the keys the MC UI already reads (owner/target/score/players) keep
        # their exact shape. It reports what the grenade bridge knows: who holds the point, whether
        # it is genuinely neutral (as opposed to never heard from), and which guns are close enough
        # to be hearing it.
        return {"mode": "domination", "over": self.over, "winner": self.winner,
                "owner": dict(self.owner), "target": self.target,
                "score": {t: int(s) for t, s in self._acc.items()},
                # `owner_in_play` False = the point is genuinely held, by a team with nobody in
                # this match (a grenade carried in still owned from the last game). A recap can say
                # that instead of showing it as neutral, which would be a lie about the hardware.
                "hill": dict(self.beacons.snapshot(self._last_tick), site=self.hill_site,
                             owner_in_play=self._in_play(self.owner[self.hill_site])),
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
