"""The data held by one scheduled Mission Control match."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable

from .scoring import Scorer
from .types import (FrameBundle, GameConfig, Player, RecapStationRow, STATION_ID_MAX,
                    STATION_TEAM_ANY, is_station_kind)


@dataclass
class MatchBlock:
    head: dict | None = None
    node_player: dict[str, str] = field(default_factory=dict)
    current_nodes: dict[str, str] = field(default_factory=dict)
    unbound_nodes: set[str] = field(default_factory=set)
    evicted_nodes: set[str] = field(default_factory=set)
    departed_stations: dict[str, RecapStationRow] = field(default_factory=dict)
    invalid_departed: int = 0


def snapshot_departed_station(row: object) -> RecapStationRow | None:
    """Read one frozen station tally from an untrusted JSON session snapshot."""
    if not isinstance(row, dict):
        return None
    nid, kind = row.get("node_id"), row.get("kind")
    sid, team, heard = row.get("id"), row.get("team"), row.get("heard")
    if not (isinstance(nid, str) and nid and is_station_kind(kind)
            and isinstance(sid, int) and not isinstance(sid, bool) and 1 <= sid <= STATION_ID_MAX
            and isinstance(team, int) and not isinstance(team, bool)
            and (team in (0, 1, 2, 3) or team == STATION_TEAM_ANY)
            and isinstance(heard, bool)):
        return None
    out: RecapStationRow = {"node_id": nid, "kind": kind, "id": sid, "team": team, "heard": heard}
    if kind == "respawn":
        revives = row.get("revives")
        if revives is not None and (not isinstance(revives, int) or isinstance(revives, bool) or revives < 0):
            return None
        out["revives"] = revives
    elif kind == "control":
        hold_ms, owner = row.get("hold_ms"), row.get("owner")
        if hold_ms is not None and (not isinstance(hold_ms, dict)
                                    or not all(isinstance(k, str) and isinstance(v, int)
                                               and not isinstance(v, bool) and v >= 0
                                               for k, v in hold_ms.items())):
            return None
        if owner is not None and (not isinstance(owner, int) or isinstance(owner, bool)
                                  or owner not in (0, 1, 2, 3, STATION_TEAM_ANY)):
            return None
        if "hold_ms" in row:
            out["hold_ms"] = None if hold_ms is None else dict(hold_ms)
        if "owner" in row:
            out["owner"] = owner
    return out


def parse_snapshot(block: object, roster_ids: Iterable[str]) -> MatchBlock:
    """Normalise the saved match fields without depending on a Session or store."""
    parsed = MatchBlock()
    if not isinstance(block, dict):
        return parsed
    mid, go, seq, cfg = (block.get(key) for key in ("match_id", "go_live_t", "seq", "config"))
    if isinstance(mid, str) and mid and isinstance(go, int) and isinstance(seq, int) and \
            isinstance(cfg, dict) and cfg.get("mode"):
        cd = block.get("countdown_s")
        parsed.head = {"match_id": mid, "go_live_t": go, "seq": seq,
                       "countdown_s": cd if isinstance(cd, int) else 0}
        if block.get("adopted"):
            parsed.head["adopted"] = True
    roster = set(roster_ids)
    raw_np = block.get("node_player")
    parsed.node_player = {n: p for n, p in (raw_np.items() if isinstance(raw_np, dict) else ())
                          if isinstance(n, str) and isinstance(p, str) and p in roster}
    cur = block.get("current_nodes")
    parsed.current_nodes = {pid: nid for pid, nid in (cur.items() if isinstance(cur, dict) else ())
                            if isinstance(pid, str) and isinstance(nid, str) and pid in roster}
    unb = block.get("unbound_nodes")
    parsed.unbound_nodes = {n for n in (unb if isinstance(unb, list) else ()) if isinstance(n, str)}
    ev = block.get("evicted_nodes")
    parsed.evicted_nodes = {n for n in (ev if isinstance(ev, list) else ()) if isinstance(n, str)}
    raw_departed = block.get("departed_stations")
    if isinstance(raw_departed, list):
        for raw in raw_departed:
            row = snapshot_departed_station(raw)
            if row is None or row["node_id"] in parsed.departed_stations:
                parsed.invalid_departed += 1
                continue
            parsed.departed_stations[row["node_id"]] = row
    elif raw_departed is not None:
        parsed.invalid_departed = 1
    return parsed


@dataclass
class Match:
    head: dict | None = None
    scorer: Scorer | None = None
    played: dict[str, Player] | None = None
    nodes: dict[str, str] = field(default_factory=dict)
    current: dict[str, str] = field(default_factory=dict)
    evicted: set[str] = field(default_factory=set)
    unbound: set[str] = field(default_factory=set)
    departed_stations: dict[str, RecapStationRow] = field(default_factory=dict)
    frozen_stations: list[RecapStationRow] | None = None

    @classmethod
    def begin(cls, head: dict, scorer: Scorer, played: dict[str, Player], nodes: dict[str, str], *,
              current: dict[str, str] | None = None, evicted: set[str] | None = None,
              unbound: set[str] | None = None,
              departed_stations: dict[str, RecapStationRow] | None = None) -> Match:
        """Install the prepared fields for a scheduled, resumed or adopted match."""
        return cls(head=head, scorer=scorer, played=played, nodes=nodes,
                   current=current if current is not None else {},
                   evicted=evicted if evicted is not None else set(),
                   unbound=unbound if unbound is not None else set(),
                   departed_stations=departed_stations if departed_stations is not None else {})

    def clear_active(self) -> None:
        """Keep bindings and frozen rows when a match leaves play."""
        self.head = None
        self.scorer = None

    def to_snapshot(self, *, live: bool, adopted: bool, config: GameConfig,
                    roster: dict[str, Player], node_player: dict[str, str],
                    synced_at_lobby: dict[str, bool], clock_suspect: Any,
                    bundles: dict[str, FrameBundle], acks: dict[str, dict],
                    store_path: str | None) -> dict:
        """Write the running match block for session.json."""
        if self.head is None or self.scorer is None:
            raise ValueError("only a match in play has a snapshot block")
        si = self.head
        players = self.played if self.played is not None else roster
        return {"match_id": si["match_id"], "go_live_t": si["go_live_t"], "seq": si["seq"],
                "countdown_s": si.get("countdown_s", 0), "adopted": adopted,
                "live": live,   # F451: a resume after a backward clock step must not re-arm it
                "config": config, "players": {pid: dict(p) for pid, p in players.items()},
                "node_player": {nid: pid for nid, pid in {**self.nodes, **node_player}.items()
                                if pid in players},
                # cross-lane #1: each player's node right now, so a resume binds only that one (the map above keeps
                # every node the match ran, for the scorer). A resumed process keeps the restored rule until each phone
                # is back: before any re-hello the live map is empty, and a second restart lost it (0.4.19 review H2).
                "current_nodes": {**{pid: nid for pid, nid in self.current.items() if pid in players},
                                  **{pid: nid for nid, pid in node_player.items() if pid in players}},
                "evicted_nodes": sorted(self.evicted),
                "unbound_nodes": sorted(self.unbound),
                "synced_at_lobby": dict(synced_at_lobby),
                "clock_suspect": clock_suspect,
                "joined_t": dict(self.scorer.joined_t),
                "cap_recv": self.scorer.cap_recv,
                "alerts": self.scorer.match_state_alerts(),
                "departed_stations": [dict(row) for row in sorted(
                    self.departed_stations.values(), key=lambda row: row["node_id"])],
                "bundles": bundles, "acks": acks, "store_path": store_path}
