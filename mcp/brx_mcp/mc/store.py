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
