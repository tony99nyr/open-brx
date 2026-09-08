"""SQLite event log for M-MC: every inbound envelope with t, t_recv, match_id, parked."""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path


def mc_dir() -> Path:
    d = Path(os.environ.get("BRX_MC_DIR") or (Path.home() / ".brx-mcp" / "mc"))
    d.mkdir(parents=True, exist_ok=True)
    return d


class Store:
    def __init__(self, session_id: str, path: Path | None = None):
        self.path = path or (mc_dir() / f"session-{session_id}.sqlite")
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

    def matches(self) -> list[dict]:
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
                recap = json.loads(r[4]) if r[4] else None
            except (ValueError, TypeError):
                continue
            if recap is None:
                continue
            try:
                cfg = json.loads(r[1]) if r[1] else {}
            except (ValueError, TypeError):
                cfg = {}
            out.append({"match_id": r[0], "config": cfg if isinstance(cfg, dict) else {},
                        "go_live_t": r[2], "ended_t": r[3], "recap": recap})
        return out

    def events(self, match_id: str | None = None, parked: bool | None = None) -> list[dict]:
        q, args = "SELECT node_id,kind,seq,t,t_recv,match_id,parked,body FROM envelopes", []
        conds = []
        if match_id is not None:
            conds.append("match_id=?"); args.append(match_id)
        if parked is not None:
            conds.append("parked=?"); args.append(1 if parked else 0)
        if conds:
            q += " WHERE " + " AND ".join(conds)
        return [{"node_id": r[0], "kind": r[1], "seq": r[2], "t": r[3], "t_recv": r[4], "match_id": r[5],
                 "parked": bool(r[6]), "body": json.loads(r[7])} for r in self.db.execute(q + " ORDER BY id", args)]

    def close(self) -> None:
        self.db.close()
