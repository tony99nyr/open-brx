"""Adapter: run the flagship Extraction engine on the standard live driver.

`ExtractionGame` predates the uniform `GameEngine` interface and has its own
richer Action set (Bank/ChannelStarted/Extracted/LootDropped/…). This wraps it so
`play extraction <guns…>` / `run_live` drive it exactly like every other mode:

  * BLE stream → engine calls: `$HIR` shooter-team is recorded (FFA → team is a
    single player), `$HP,0` → `on_death(victim, killer)`. Host respawn brings a
    DOWN player back after `respawn_s`.
  * Station events → zone/loot calls: `ZONE <zone>` = enter (start the channel),
    `LEAVE` = leave, `LOOT <value>` = pickup, `PICKUP <drop_id>` = grab a dropped
    token. (Fed by the Utility Box / phone once B4/B13 land; testable now.)
  * Extraction Actions → base Actions the driver already executes (Bank→Score,
    ChannelStarted→countdown alarm, Extracted→scored cue, GameOver→GameOver).

Kill attribution mirrors DeathmatchEngine: last `$HIR` shooter-team within a fuse,
resolved to the specific killer via the 1:1 FFA team→player map.
"""
from __future__ import annotations

from typing import Optional

from .. import sounds as snd
from . import base
from .base import Action, GameEngine, hp_values, is_hit, shooter_team, shooter_player_id
from .params import Param, resolve as _resolve_params
from . import extraction as ex

ATTRIB_FUSE_S = 6.0


def _to_base(a: ex.Action) -> list[Action]:
    """Translate one extraction Action into base Action(s) the driver runs."""
    if isinstance(a, ex.Bank):
        return [base.Score(a.player_id, a.value, a.total)]
    if isinstance(a, ex.ChannelStarted):
        # the signature loud "extraction inbound" moment — field-wide alarm
        return [base.PlaySound(snd.EXTRACTION_CALLED, scope=a.player_id, slot="voice"),
                base.PlaySound(snd.EXTRACTION_ALERT, scope="all", slot="voice")]
    if isinstance(a, ex.ChannelReset):
        return [base.Callout(f"channel reset for {a.player_id} at {a.zone} ({a.reason})",
                             scope=a.player_id)]
    if isinstance(a, ex.Extracted):
        return [base.PlaySound(snd.EXTRACTED, scope="all", slot="voice")]
    if isinstance(a, ex.LootDropped):
        return [base.Callout(f"loot dropped from {a.from_player} "
                             f"({a.value}, → {a.by})", scope="all")]
    if isinstance(a, ex.GameOver):
        return [base.GameOver(a.winner, detail=f"banked={a.total}")]
    if isinstance(a, ex.Callout):
        return [base.Callout(a.text, scope=a.scope)]
    if isinstance(a, ex.SendFrame):
        return [base.SendFrame(a.player_id, a.frame)]
    return []


def _translate(actions: list[ex.Action]) -> list[Action]:
    out: list[Action] = []
    for a in actions:
        out.extend(_to_base(a))
    return out


class ExtractionEngineAdapter(GameEngine):
    """Wrap `ExtractionGame` behind the uniform GameEngine interface."""

    # A18: the `ExtractionConfig` knobs, on the wire. They used to exist only on the CLI dataclass, so an
    # Extraction game set up in MC ran on the engine's defaults whatever the operator wanted.
    PARAMS = {
        "channel_s": Param("float", 45.0, "seconds a player must hold the extraction point", lo=5, hi=600),
        "win_target": Param("int", 0, "banked loot that wins the raid outright; 0 = the clock decides", lo=0, hi=100000),
        "loot_per_kill": Param("int", 10, "loot a killer picks up per kill", lo=0, hi=1000),
        "drop_policy": Param("str", "ground", "where a downed player's loot goes", choices=("ground", "killer", "pool")),
        "extract_removes_player": Param("bool", True, "an extracted player is out of the raid (off: they respawn clean)"),
    }

    def __init__(self, config, now: float = 0.0):
        self.config = config
        self.params = _resolve_params(type(self), config)
        self._now = now
        self._players: list[str] = []
        self._teams: dict[str, int] = {}
        # wire player id ($PSET token 1, echoed as $HIR token 3) -> player_id. Populated by the
        # driver, which assigns those ids; empty until it does, and attribution then falls back to
        # team resolution. Mirrors `Roster.wire_ids` -- this engine has no Roster of its own.
        self.wire_ids: dict[int, str] = {}
        self._game: Optional[ex.ExtractionGame] = None
        # victim -> (shooter team, when, shooter wire id or None)
        self._last_shot: dict[str, tuple[int, float, Optional[int]]] = {}
        self._down_since: dict[str, float] = {}    # victim → time went DOWN (host respawn)

    # -- setup --------------------------------------------------------------- #
    def _ex_config(self) -> ex.ExtractionConfig:
        g, p = self.config, self.params
        return ex.ExtractionConfig(
            channel_s=float(p["channel_s"]),
            # the CLI dataclass's `score_target` still stands in for an unset win target (pre-A18 behaviour)
            win_target=int(p["win_target"] or getattr(g, "score_target", 0) or 0),
            loot_per_kill=int(p["loot_per_kill"]),
            drop_policy=str(p["drop_policy"]),
            extract_removes_player=bool(p["extract_removes_player"]),
        )

    def add_player(self, player_id: str, team: int) -> None:
        if player_id not in self._teams:
            self._players.append(player_id)
        self._teams[player_id] = team
        self._game = None                           # rebuild lazily with the new roster

    def _ensure(self) -> ex.ExtractionGame:
        if self._game is None:
            self._game = ex.ExtractionGame(self._players, self._ex_config(), now=self._now)
        return self._game

    @property
    def over(self) -> bool:
        return self._game is not None and self._game.over

    # -- events -------------------------------------------------------------- #
    def on_event(self, player_id: str, ev: dict, now: float) -> list[Action]:
        self._now = now
        game = self._ensure()
        if game.over:
            return []
        cmd = ev.get("command")

        # station-fed objective events (team-agnostic; keyed by the emitting node)
        if cmd == "ZONE":
            zone = ev.get("tokens", ["", "?"])[1] if len(ev.get("tokens", [])) > 1 else "?"
            return _translate(game.enter_zone(player_id, zone, now))
        if cmd == "LEAVE":
            return _translate(game.leave_zone(player_id, now))
        if cmd == "LOOT":
            return _translate(game.loot_pickup(player_id, _int(ev, 1, 0)))
        if cmd == "PICKUP":
            return _translate(game.pickup_dropped(player_id, _int(ev, 1, -1)))

        # combat from the gun's own BLE stream
        if is_hit(ev):
            st = shooter_team(ev)
            if st is not None:
                self._last_shot[player_id] = (st, now, shooter_player_id(ev))
            return []
        hv = hp_values(ev)
        if hv is not None and hv[0] == 0:
            # only a real ALIVE→DOWN transition; a repeat $HP,0 while already DOWN
            # must NOT reset the respawn clock (and must not KeyError on an
            # unregistered id → membership check via .get).
            p = game.players.get(player_id)
            if p is None or p.status is not ex.Status.ALIVE:
                return []
            killer = self._resolve_killer(player_id, now)
            acts = _translate(game.on_death(player_id, killer, now))
            self._down_since[player_id] = now
            return acts
        return []

    def _sole_member_of_team(self, team: int) -> Optional[str]:
        """The one gun on `team`, or None when the team holds several.

        Deliberately fails CLOSED. The map this replaced was `team -> last player registered on it`,
        which failed to the WRONG gun."""
        members = [pid for pid, t in self._teams.items() if t == team]
        return members[0] if len(members) == 1 else None

    def _resolve_killer(self, victim_id: str, now: float) -> Optional[str]:
        """Credit the specific gun that fired, mirroring `DeathmatchEngine` (Q17, bench 2026-08-30).

        Prefer the shooter's PLAYER id ($HIR token 3, set per gun via $PSET token 1) -- it names one
        gun even when a team holds several. Fall back to team resolution, which is only sound 1:1.

        ⚠ This used to read `self._team_player[team]`, a LAST-WRITE-WINS map. With two guns on one
        team it did not fail to nobody the way old TDM did -- it credited whichever gun was
        registered last, silently handing the kill and its loot to a teammate who never fired. That
        is worse than no attribution, because no attribution is visible and a wrong one is not. It
        was unreachable only while `assign_teams` happened to give extraction guns unique teams,
        which is a caller's habit, not a guarantee."""
        entry = self._last_shot.pop(victim_id, None)
        if not entry or now - entry[1] > ATTRIB_FUSE_S:
            return None
        team, _when, wire = entry
        killer = self.wire_ids.get(wire) if wire is not None else None
        if killer is not None and self._teams.get(killer) != team:
            killer = None          # id and team disagree: trust neither, don't guess
        if killer is None:
            killer = self._sole_member_of_team(team)
        return killer if killer and killer != victim_id else None

    # -- time ---------------------------------------------------------------- #
    def tick(self, now: float) -> list[Action]:
        self._now = now
        game = self._ensure()
        if game.over:
            return []
        actions = _translate(game.tick(now))
        # host respawn: bring DOWN players back after respawn_s
        delay = float(getattr(self.config, "respawn_s", 0) or 0)
        for pid, since in list(self._down_since.items()):
            if game.status(pid) is ex.Status.DOWN and now - since >= delay:
                if game.respawn(pid):  # returns [] but flips status
                    pass
                if game.status(pid) is ex.Status.ALIVE:
                    self._down_since.pop(pid, None)
                    actions.append(base.Respawn(pid))
        return actions

    # -- state --------------------------------------------------------------- #
    def snapshot(self) -> dict:
        game = self._ensure()
        return {"mode": "extraction", "over": game.over, "winner": game.winner,
                "win_target": game.config.win_target,
                "players": {pid: {"banked": game.banked(pid),
                                  "carried": game.carried(pid),
                                  "status": game.status(pid).value}
                            for pid in self._players}}


def _int(ev: dict, i: int, default: int) -> int:
    t = ev.get("tokens", [])
    try:
        return int(t[i]) if i < len(t) else default
    except (TypeError, ValueError):
        return default
