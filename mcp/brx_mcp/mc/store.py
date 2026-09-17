"""SQLite event log for M-MC: every inbound envelope with t, t_recv, match_id, parked."""
from __future__ import annotations

import json
import math
import sqlite3
import time
from pathlib import Path
from typing import Any, TypeGuard

from ..storage import home_dir
from .types import STATION_KINDS, RecapView


def _is_recap(value: object) -> TypeGuard[RecapView]:
    """Recognize the required outer shape of a persisted recap before serving it as typed JSON.

    Recaps are decoded from SQLite, so their values are untrusted even though current writes come from
    ``Scorer.recap()``.  Keep this boundary deliberately structural: additive recap fields remain
    forward-compatible, while a scalar or half-written required field cannot leak through as a
    ``RecapView``.
    """
    if not isinstance(value, dict):
        return False
    winner = value.get("winner")
    score = value.get("score")
    rows = value.get("rows")
    honors = value.get("honors")
    missing = value.get("missing")
    if not isinstance(winner, dict) or not isinstance(score, dict):
        return False
    if any(key not in {"team_id", "player_id", "undecided", "tie"} for key in winner):
        return False
    if "team_id" in winner and winner["team_id"] is not None and not isinstance(winner["team_id"], str):
        return False
    if "player_id" in winner and winner["player_id"] is not None and not isinstance(winner["player_id"], str):
        return False
    if "undecided" in winner and not isinstance(winner["undecided"], str):
        return False
    if "tie" in winner and (not isinstance(winner["tie"], list) or not all(isinstance(t, str) for t in winner["tie"])):
        return False
    if not all(isinstance(k, str) and type(v) is int for k, v in score.items()):
        return False
    if not isinstance(rows, list) or not all(_is_score_row(row) for row in rows):
        return False
    if not isinstance(honors, list) or not all(
            isinstance(honor, dict) and all(isinstance(honor.get(k), str) for k in ("award", "player_id", "stat"))
            for honor in honors):
        return False
    if not isinstance(value.get("provisional"), bool):
        return False
    if not isinstance(missing, list) or not all(isinstance(item, str) for item in missing):
        return False
    warnings = value.get("warnings")
    if warnings is not None and (not isinstance(warnings, list) or not all(isinstance(item, str) for item in warnings)):
        return False
    if "settling" in value and not isinstance(value["settling"], bool):
        return False
    if "awaiting" in value and (not isinstance(value["awaiting"], list)
                                or not all(isinstance(item, str) for item in value["awaiting"])):
        return False
    if "since_end_ms" in value and value["since_end_ms"] is not None and type(value["since_end_ms"]) is not int:
        return False
    if any(key in value and type(value[key]) is not int for key in ("post_end", "post_end_facts", "parked")):
        return False
    after_end = value.get("after_end")
    if after_end is not None:
        if not isinstance(after_end, dict) or type(after_end.get("facts")) is not int:
            return False
        by_player = after_end.get("by_player")
        if not isinstance(by_player, dict) or not all(
                isinstance(pid, str) and isinstance(stats, dict)
                and type(stats.get("kills")) is int and type(stats.get("deaths")) is int
                for pid, stats in by_player.items()):
            return False
    possession = value.get("possession")
    if possession is not None:
        if not isinstance(possession, dict) or not isinstance(possession.get("by_team"), dict):
            return False
        if not all(isinstance(tid, str) and type(seconds) in (int, float) and math.isfinite(seconds)
                   for tid, seconds in possession["by_team"].items()):
            return False
        if any(type(possession.get(key)) not in (int, float) or not math.isfinite(possession[key])
               for key in ("neutral_s", "observed_s")):
            return False
        if any(type(possession.get(key)) is not int for key in ("sites", "reports")):
            return False
        if possession.get("of_s") is not None and type(possession["of_s"]) is not int:
            return False
    stations = value.get("stations")
    if stations is not None and (not isinstance(stations, list) or not all(_is_station_row(row) for row in stations)):
        return False
    return True


def _is_score_row(row: object) -> bool:
    if not isinstance(row, dict):
        return False
    if not all(isinstance(row.get(key), str) for key in ("player_id", "display")):
        return False
    if "team_id" not in row or (row["team_id"] is not None and not isinstance(row["team_id"], str)):
        return False
    if not all(type(row.get(key)) is int for key in ("kills", "deaths", "assists", "shots", "hits", "streak")):
        return False
    if "accuracy" not in row or (row["accuracy"] is not None and
                                 (type(row["accuracy"]) not in (int, float) or not math.isfinite(row["accuracy"]))):
        return False
    if type(row.get("kd")) not in (int, float) or not math.isfinite(row["kd"]):
        return False
    if not isinstance(row.get("medals"), list) or not all(isinstance(m, str) for m in row["medals"]):
        return False
    if any(key in row and type(row[key]) is not int for key in
           ("shots_total", "best_streak", "multi_best", "after_end_kills", "after_end_deaths")):
        return False
    if any(key in row and not isinstance(row[key], bool) for key in ("first_blood", "acc_provisional")):
        return False
    return True


def _is_station_row(row: object) -> bool:
    if not isinstance(row, dict) or not isinstance(row.get("node_id"), str):
        return False
    if row.get("kind") not in STATION_KINDS:
        return False
    if type(row.get("id")) is not int or type(row.get("team")) is not int or not isinstance(row.get("heard"), bool):
        return False
    if any(key in row and row[key] is not None and type(row[key]) is not int for key in ("revives", "owner")):
        return False
    holds = row.get("hold_ms")
    return holds is None or (isinstance(holds, dict) and all(isinstance(tid, str) and type(ms) is int
                                                               for tid, ms in holds.items()))


def _decode_recap(raw: object) -> RecapView | None:
    """Decode a stored recap, supplying fields absent from older archived rows."""
    if not isinstance(raw, dict) or "rows" not in raw:
        return None
    value = dict(raw)
    value.setdefault("winner", {})
    value.setdefault("score", {})
    value.setdefault("honors", [])
    value.setdefault("provisional", False)
    value.setdefault("missing", [])
    return value if _is_recap(value) else None


def mc_dir() -> Path:
    """`<BRX_MCP_HOME or ~/.brx-mcp>/mc` -- where session-*.sqlite files live. Honours
    `BRX_MCP_HOME` via `storage.home_dir()` so a test run never lands here for real."""
    d = home_dir() / "mc"
    d.mkdir(parents=True, exist_ok=True)
    return d


class Store:
    def __init__(self, session_id: str, path: Path | None = None, read_only: bool = False):
        self.path = path or (mc_dir() / f"session-{session_id}.sqlite")
        if read_only:
            # F-2026-09-17e: a resume only ever READS another process's store (`state._import_facts`),
            # so it must never create a WAL/SHM file beside a store it does not own, nor race that
            # process's own writer. `mode=ro` refuses even the schema PRAGMAs below -- the file must
            # already exist and hold the table, which a real session store always does.
            self.db = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True, check_same_thread=False)
            self.session_id = session_id
            return
        self.db = sqlite3.connect(str(self.path), check_same_thread=False)
        # `log()` runs synchronously on the asyncio event loop (net.py's per-message dispatch), once
        # per hit/kill/status envelope during LIVE PLAY -- there is no executor hop. The default
        # rollback-journal + synchronous=FULL commit fsyncs the disk on every call: measured 6.7 ms/call
        # on a local SSD (audit 2026-09-07), which is 6.7 ms the event loop cannot process the next
        # node's message, WS send, or score push. WAL + synchronous=NORMAL keeps the same durability a
        # single-writer log needs (safe against a crashed process; only an OS-level power loss could
        # drop the last few commits) while cutting that to ~0.01 ms/call -- no query or schema changes.
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS envelopes (
            id INTEGER PRIMARY KEY, node_id TEXT, kind TEXT, seq INTEGER, t INTEGER, t_recv INTEGER,
            match_id TEXT, parked INTEGER, body TEXT)""")
        self.db.execute("CREATE INDEX IF NOT EXISTS ix_env_match ON envelopes(match_id)")
        self.db.execute("""CREATE TABLE IF NOT EXISTS matches (
            match_id TEXT PRIMARY KEY, session_id TEXT, config TEXT, go_live_t INTEGER, ended_t INTEGER, recap TEXT)""")
        self.db.commit()
        self.session_id = session_id

    def log(self, node_id, kind, seq, t, t_recv, match_id, parked, body) -> None:
        self.db.execute("INSERT INTO envelopes(node_id,kind,seq,t,t_recv,match_id,parked,body) VALUES (?,?,?,?,?,?,?,?)",
                        (node_id, kind, seq, t, t_recv, match_id, 1 if parked else 0, json.dumps(body, default=str)))
        self.db.commit()

    def match_started(self, match_id: str, config: dict, go_live_t: int) -> None:
        self.db.execute("INSERT OR REPLACE INTO matches(match_id,session_id,config,go_live_t) VALUES (?,?,?,?)",
                        (match_id, self.session_id, json.dumps(config), go_live_t))
        self.db.commit()

    def match_ended(self, match_id: str, recap: dict) -> None:
        self.db.execute("UPDATE matches SET ended_t=?, recap=? WHERE match_id=?",
                        (int(time.time() * 1000), json.dumps(recap, default=str), match_id))
        self.db.commit()

    def matches(self) -> list[dict[str, Any]]:
        """Every finished match in this session, newest first — the history behind MC's RECAP screen.

        Field 2026-08-30: "the recap doesn't show the previous game once another is started ... we have
        no way to view previous". The rows were always being written here; nothing ever read them back.
        """
        out = []
        # rowid breaks the tie: two matches can end in the same millisecond, and without it sqlite
        # falls back to insertion order — i.e. OLDEST first, exactly the wrong way round.
        for r in self.db.execute(
                "SELECT match_id,config,go_live_t,ended_t,recap FROM matches "
                "WHERE recap IS NOT NULL ORDER BY COALESCE(ended_t, go_live_t) DESC, rowid DESC"):
            # Degrade, do not drop: a corrupt CONFIG must not take a perfectly good recap out of the
            # history with it. Only an unreadable recap disqualifies the row, because without one there
            # is no result to show.
            try:
                raw_recap = json.loads(r[4]) if r[4] else None
            except (ValueError, TypeError):
                continue
            recap = _decode_recap(raw_recap)
            if recap is None:
                continue
            try:
                cfg = json.loads(r[1]) if r[1] else {}
            except (ValueError, TypeError):
                cfg = {}
            out.append({"match_id": r[0], "config": cfg if isinstance(cfg, dict) else {},
                        "go_live_t": r[2], "ended_t": r[3], "recap": recap})
        return out

    def events(self, match_id: str | None = None, parked: bool | None = None,
               kinds: "tuple[str, ...] | list[str] | None" = None) -> list[dict]:
        """Every logged envelope, oldest first. `kinds` narrows to the rows the caller actually wants.

        The filter is SQL, not a comprehension, on purpose: a 10-minute match logs a `status`
        heartbeat per node every ~2 s, so the envelope table is mostly heartbeats and the recap
        replay (`state._match_facts`) wants five kinds out of it. Reading them all back meant a
        `json.loads` of every heartbeat body — twice per late death — to throw the result away.
        """
        q, args = "SELECT node_id,kind,seq,t,t_recv,match_id,parked,body FROM envelopes", []
        conds = []
        if match_id is not None:
            conds.append("match_id=?"); args.append(match_id)
        if parked is not None:
            conds.append("parked=?"); args.append(1 if parked else 0)
        if kinds is not None:
            ks = list(kinds)
            if not ks:
                return []
            conds.append("kind IN (%s)" % ",".join("?" * len(ks))); args.extend(ks)
        if conds:
            q += " WHERE " + " AND ".join(conds)
        return [{"node_id": r[0], "kind": r[1], "seq": r[2], "t": r[3], "t_recv": r[4], "match_id": r[5],
                 "parked": bool(r[6]), "body": json.loads(r[7])} for r in self.db.execute(q + " ORDER BY id", args)]

    def close(self) -> None:
        self.db.close()
