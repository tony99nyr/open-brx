"""T1-B (field session 2026-09-12): a post-match diagnostic that reproduces, as ONE command, the
analysis Tony's session did by hand against `~/.brx-mcp/mc/session-25eebce5.sqlite` — go_live/ended/
duration, mode/config_id/environment/cfg health, total shots, hits, hit%, deaths, arm_state +
alive distributions, per-node `preflight.gun_linked` counts, the per-node POOL columns below,
`shooter_team` values seen, and each node's `ack_config` config_id vs the match it was pushed for.

The pool columns, and what each one can and cannot see (C-3/C-4, 2026-09-13):

  * `cfg_health` -- `config.health` for the match. This is the NARROW question: a per-player
    `LoadoutOverrides.max_hp/max_armor` is baked into the pushed `$PSET` and never into
    `config.health`, so `hp_mismatch_vs_cfg` / `armor_mismatch_vs_cfg` flag every node in a game
    that uses one. They are named `_vs_cfg` so the reader is never left guessing which number they
    were compared against. (Perk-aware: armor ABOVE the config is a `body_armor` perk and is never
    flagged; armor below it cannot be.)
  * `pushed_pool` -- the `$PSET` in the head MC ACTUALLY PUSHED this node's player, read back out of
    the persisted snapshot (`state.py _schedule` stores `config["_heads"][player_id]`). Overrides and
    the perk are already in it, so `hp_mismatch_vs_pushed` / `armor_mismatch_vs_pushed` are exact and
    are the flags that mean "this gun was on another head". `None` when the store predates `_heads`,
    when the node's status bodies never named a player, or when the head carries no readable `$PSET`.
  * `first_live_pool` -- the (hp, armor) on the FIRST `status` with `arm_state: live` and
    `alive: true`, i.e. the first frame of that node's first life. This is the exact signature the
    A36 pool check exists for and the one `max_hp`/`max_armor` cannot see: a gun that spawned into
    the wrong head's pool and then self-corrected has a clean max and a damning first frame.

Read-only, pure sqlite — no `Session` import needed, so it can be pointed at a real session file
Mission Control still has open (`GET /api/diag/matches` shares a live `Store.db` connection) or at
one from any earlier night (`python -m brx_mcp.mc.diag <path/to/session.sqlite>`).

`hits` counts BOTH shapes the envelope table can hold a fact in: a row logged with `kind ==
"hit_taken"` (today's shape — see `store.py`/`state.py`: every fact, batched or not, is logged under
its OWN `type`) and, defensively, a `hit_taken` nested inside `body.events` on a row logged with
`kind == "event_batch"` (an older or different writer's shape) — so a diag run against a session
written by something other than this exact server still counts every hit.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from . import frames as _frames      # the one reader for a `$PSET`/`$WEAP` frame MC actually sent


# ---------------------------------------------------------------- data access ---- #

def _load_row_config(cfg_json: str | None) -> dict:
    if not cfg_json:
        return {}
    try:
        cfg = json.loads(cfg_json)
    except (TypeError, ValueError):
        return {}
    return cfg if isinstance(cfg, dict) else {}


def _matches(db: sqlite3.Connection, match_id: str | None = None) -> list[dict]:
    """Every row in `matches`, oldest first (the order the night was played) — unlike `Store.matches()`,
    which serves the RECAP history newest-first and skips a match with no recap. A diag run wants
    every match that went live, recap or not (a match aborted before `_finish()` still owes an
    explanation for its shots/hits)."""
    q = "SELECT match_id, config, go_live_t, ended_t FROM matches"
    args: list[Any] = []
    if match_id is not None:
        q += " WHERE match_id=?"
        args.append(match_id)
    q += " ORDER BY go_live_t, rowid"
    return [{"match_id": r[0], "config": _load_row_config(r[1]), "go_live_t": r[2], "ended_t": r[3]}
            for r in db.execute(q, args)]


def _status_rows(db: sqlite3.Connection, match_id: str) -> list[tuple[str, dict]]:
    """Every `status` body of this match, IN ARRIVAL ORDER.

    The order is load-bearing since C-4: "the first live frame of the first life" is a question about
    sequence, and an unordered SELECT answers it only by luck of the storage engine."""
    out = []
    for node_id, body_json in db.execute(
            "SELECT node_id, body FROM envelopes WHERE match_id=? AND kind='status' ORDER BY t_recv, rowid",
            (match_id,)):
        try:
            body = json.loads(body_json)
        except (TypeError, ValueError):
            continue
        if isinstance(body, dict):
            out.append((node_id, body))
    return out


def _hit_events(db: sqlite3.Connection, match_id: str) -> list[dict]:
    """Every `hit_taken` fact for this match: rows logged directly under that kind, PLUS any nested
    in a `body.events` list on a row logged as `event_batch` (see the module docstring)."""
    out: list[dict] = []
    for (body_json,) in db.execute(
            "SELECT body FROM envelopes WHERE match_id=? AND kind='hit_taken'", (match_id,)):
        try:
            body = json.loads(body_json)
        except (TypeError, ValueError):
            continue
        if isinstance(body, dict):
            out.append(body)
    for (body_json,) in db.execute(
            "SELECT body FROM envelopes WHERE match_id=? AND kind='event_batch'", (match_id,)):
        try:
            body = json.loads(body_json)
        except (TypeError, ValueError):
            continue
        if not isinstance(body, dict):
            continue
        for ev in body.get("events") or []:
            if isinstance(ev, dict) and ev.get("type") == "hit_taken":
                out.append(ev)
    return out


def _death_count(db: sqlite3.Connection, match_id: str) -> int:
    return db.execute("SELECT COUNT(*) FROM envelopes WHERE match_id=? AND kind='death'", (match_id,)).fetchone()[0]


def _latest_ack_before(db: sqlite3.Connection, node_id: str, go_live_t: int | None) -> dict | None:
    """This node's most recently ACKED config as of `go_live_t` — `ack_config` lands with `match_id`
    unset (it happens in the lobby, before a match exists), so the only way to line one up with a
    match is by time: the last ack at or before the match's own go-live."""
    if go_live_t is None:
        return None
    row = db.execute(
        "SELECT body, t_recv FROM envelopes WHERE node_id=? AND kind='ack_config' AND t_recv<=? "
        "ORDER BY t_recv DESC LIMIT 1", (node_id, go_live_t)).fetchone()
    if row is None:
        return None
    try:
        body = json.loads(row[0])
    except (TypeError, ValueError):
        return None
    if not isinstance(body, dict):
        return None
    return {"config_id": body.get("config_id"), "ok": body.get("ok"), "t_recv": row[1]}


def _pushed_pool(cfg: dict, player_id: str | None) -> dict[str, int] | None:
    """(hp, armor) the head MC ACTUALLY PUSHED this player arms, from the persisted snapshot.

    `state.py _schedule` stores the compiled head of every player beside the match config as
    `config["_heads"][player_id]` ("the head is the ground truth -- it shows the token, not a setting
    that maps to it"). Its `$PSET` has the per-player `LoadoutOverrides` and the `body_armor` perk
    already baked in by the compiler, so this is the only per-node pool that is true without a second
    model of the rules. None for a store written before `_heads` existed, for a node whose status
    bodies never named a player, or for a head with no readable `$PSET` -- in each case the caller
    must say nothing rather than guess (the same rule `frames.py` states).
    """
    heads = cfg.get("_heads")
    if not player_id or not isinstance(heads, dict):
        return None
    head = heads.get(player_id)
    if not isinstance(head, list):
        return None
    pool = _frames.head_pool(head)
    return None if pool is None else {"hp": pool[0], "armor": pool[1]}


# ---------------------------------------------------------------- analysis ---- #

def analyze_match(db: sqlite3.Connection, match: dict) -> dict:
    mid, cfg = match["match_id"], match["config"]
    go_live_t, ended_t = match["go_live_t"], match["ended_t"]
    health = cfg.get("health") or {}
    cfg_hp, cfg_armor = health.get("max_hp"), health.get("max_armor")

    status_rows = _status_rows(db, mid)
    by_node: dict[str, list[dict]] = {}
    for nid, body in status_rows:
        by_node.setdefault(nid, []).append(body)

    nodes: dict[str, dict] = {}
    for nid, bodies in sorted(by_node.items()):
        arm_state: dict[str, int] = {}
        alive: dict[str, int] = {"true": 0, "false": 0}
        linked: dict[str, int] = {"true": 0, "false": 0, "none": 0}
        max_shots = max_hp = max_armor = 0
        first_live: dict[str, int] | None = None      # C-4, below
        # Which player this node reported for -- the key into the persisted heads (C-3). The status
        # body carries it on every heartbeat; the LAST one wins, because a node re-bound mid-session
        # is playing as whoever it says it is now.
        player_id: str | None = next((b["player_id"] for b in reversed(bodies)
                                      if isinstance(b.get("player_id"), str) and b["player_id"]), None)
        for b in bodies:
            # C-4: the pool on the FIRST frame of this node's first life. `max` cannot see the exact
            # signature the A36 pool check exists for -- a gun that spawned into the WRONG head's
            # pool and then self-corrected has a clean `max` and a damning first frame -- and that is
            # the frame a field report is looking for. First life is enough for a table.
            if first_live is None and b.get("arm_state") == "live" and b.get("alive") is True:
                hp0, ar0 = b.get("hp"), b.get("armor")
                if isinstance(hp0, int) and not isinstance(hp0, bool) and isinstance(ar0, int) and not isinstance(ar0, bool):
                    first_live = {"hp": hp0, "armor": ar0}
            st = b.get("arm_state")
            if st is not None:
                arm_state[str(st)] = arm_state.get(str(st), 0) + 1
            a = b.get("alive")
            if a is True:
                alive["true"] += 1
            elif a is False:
                alive["false"] += 1
            gl = (b.get("preflight") or {}).get("gun_linked")
            linked["true" if gl is True else "false" if gl is False else "none"] += 1
            if isinstance(b.get("shots"), (int, float)):
                max_shots = max(max_shots, int(b["shots"]))
            if isinstance(b.get("hp"), (int, float)):
                max_hp = max(max_hp, int(b["hp"]))
            if isinstance(b.get("armor"), (int, float)):
                max_armor = max(max_armor, int(b["armor"]))

        # Perk-aware mismatch rule VS `config.health` (evidence 2026-09-12): a `body_armor` perk only
        # ever ADDS to the armed armor pool, so a reported armor ABOVE the config is expected (the
        # perk, not a stale push) and is never flagged; a reported armor BELOW the config cannot come
        # from that perk and is a genuine mismatch. HP has no perk that raises it, so any HP
        # difference is flagged.
        #
        # C-3: the column names say `_vs_cfg` because that is the only question they answer, and it
        # is the NARROWER one. `LoadoutOverrides.max_hp/max_armor` are baked into the pushed `$PSET`
        # and never into `config.health`, so under the old name any game using one reported that node
        # mismatched in every single match. The PAIR is reported beside the flag, and where the
        # snapshot carries the head MC actually pushed that player, so is the comparison that
        # actually matters.
        hp_mismatch_vs_cfg = bool(bodies) and cfg_hp is not None and max_hp != cfg_hp
        armor_mismatch_vs_cfg = bool(bodies) and cfg_armor is not None and max_armor < cfg_armor

        # C-3: the per-node truth. `state.py _schedule` persists the compiled head of every player
        # beside the config (`config["_heads"][player_id]`), and its `$PSET` already has the
        # per-player overrides and the `body_armor` perk baked in -- so this needs no perk model of
        # its own and cannot drift from one. None when the snapshot has no head for this node (a
        # pre-A36 store, or a node whose status bodies never named a player).
        pushed = _pushed_pool(cfg, player_id)
        ack = _latest_ack_before(db, nid, go_live_t)
        ack_config_id = ack.get("config_id") if ack else None
        nodes[nid] = {
            "player_id": player_id,
            "arm_state_counts": arm_state,
            "alive_counts": alive,
            "gun_linked_counts": linked,
            "max_shots": max_shots,
            "max_hp": max_hp,
            "max_armor": max_armor,
            # C-4: the first settled pool of the first life, beside the max-seen pair.
            "first_live_pool": first_live,
            # C-3: both halves of the pair, per node, so the table never asks the reader to remember
            # which number the flag was compared against.
            "cfg_health": {"max_hp": cfg_hp, "max_armor": cfg_armor},
            "pushed_pool": pushed,
            "hp_mismatch_vs_cfg": hp_mismatch_vs_cfg,
            "armor_mismatch_vs_cfg": armor_mismatch_vs_cfg,
            # Exact, not perk-aware: the head IS this node's pool, overrides and perk included, so
            # there is nothing left for a difference to mean except a gun on another head.
            "hp_mismatch_vs_pushed": (max_hp != pushed["hp"]) if pushed else None,
            "armor_mismatch_vs_pushed": (max_armor != pushed["armor"]) if pushed else None,
            "ack_config_id": ack_config_id,
            "ack_matches_config": (ack_config_id == cfg.get("config_id")) if ack_config_id is not None else None,
        }

    total_shots = sum(n["max_shots"] for n in nodes.values())
    hits = _hit_events(db, mid)
    hit_count = len(hits)
    teams_seen: set[int] = set()
    for h in hits:
        st = h.get("shooter_team")
        if st is not None:
            teams_seen.add(st)
    shooter_teams = sorted(teams_seen)
    deaths = _death_count(db, mid)
    duration_s = round((ended_t - go_live_t) / 1000.0, 3) if (go_live_t is not None and ended_t is not None) else None
    hit_pct = round(100.0 * hit_count / total_shots, 1) if total_shots else 0.0

    return {
        "match_id": mid,
        "mode": cfg.get("mode"),
        "config_id": cfg.get("config_id"),
        "environment": cfg.get("environment"),
        "go_live_t": go_live_t,
        "ended_t": ended_t,
        "duration_s": duration_s,
        "cfg_health": {"max_hp": cfg_hp, "max_armor": cfg_armor},
        "shots": total_shots,
        "hits": hit_count,
        "hit_pct": hit_pct,
        "deaths": deaths,
        "shooter_team_values": shooter_teams,
        "nodes": nodes,
    }


def build_report(db: sqlite3.Connection, match_id: str | None = None) -> list[dict]:
    return [analyze_match(db, m) for m in _matches(db, match_id)]


# ---------------------------------------------------------------- rendering ---- #

def _fmt(v: Any) -> str:
    return "-" if v is None else str(v)


def _pair(d: dict | None, a: str, b: str) -> str:
    """"100/60", or "-" when the pool is unknown. A dash is a fact ("nothing was recorded"); a 0/0
    would be a claim about a gun."""
    if not d or d.get(a) is None or d.get(b) is None:
        return "-"
    return f"{d[a]}/{d[b]}"


def render_markdown(reports: list[dict]) -> str:
    lines = ["| match_id | mode | config_id | environment | duration_s | shots | hits | hit% | deaths |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in reports:
        lines.append("| " + " | ".join(_fmt(x) for x in (
            r["match_id"], r["mode"], r["config_id"], r["environment"], r["duration_s"],
            r["shots"], r["hits"], r["hit_pct"], r["deaths"])) + " |")
    for r in reports:
        lines += ["", f"## {r['match_id']} — {r['mode']} / {r['environment']} / cfg {r['config_id']}",
                  f"cfg health: hp={_fmt(r['cfg_health']['max_hp'])} armor={_fmt(r['cfg_health']['max_armor'])} · "
                  f"shooter_team values seen: {r['shooter_team_values']}",
                  "",
                  # C-3: every pool column is a PAIR, and the two mismatch columns name what they
                  # were compared against. `vs cfg` is the narrow question (`config.health`, which
                  # never carries a per-player override); `vs pushed` is the `$PSET` this node's
                  # player was actually sent, overrides and perk included.
                  "| node_id | player | arm_state | alive T/F | linked T/F/none | max_shots | "
                  "first_live hp/armor | max hp/armor | cfg hp/armor | pushed hp/armor | "
                  "hp≠cfg | armor≠cfg | hp≠pushed | armor≠pushed | ack_config_id | ack==cfg |",
                  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for nid, n in sorted(r["nodes"].items()):
            lines.append("| " + " | ".join(_fmt(x) for x in (
                nid, n["player_id"], n["arm_state_counts"], f"{n['alive_counts']['true']}/{n['alive_counts']['false']}",
                f"{n['gun_linked_counts']['true']}/{n['gun_linked_counts']['false']}/{n['gun_linked_counts']['none']}",
                n["max_shots"], _pair(n["first_live_pool"], "hp", "armor"),
                f"{n['max_hp']}/{n['max_armor']}",
                _pair(n["cfg_health"], "max_hp", "max_armor"), _pair(n["pushed_pool"], "hp", "armor"),
                n["hp_mismatch_vs_cfg"], n["armor_mismatch_vs_cfg"],
                n["hp_mismatch_vs_pushed"], n["armor_mismatch_vs_pushed"],
                n["ack_config_id"], n["ack_matches_config"])) + " |")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- CLI ---- #

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m brx_mcp.mc.diag",
                                  description="Post-match diagnostic over a Mission Control session store (read-only).")
    ap.add_argument("session_db", help="path to a session-*.sqlite file")
    ap.add_argument("--match", dest="match_id", default=None, help="limit to one match_id")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of the markdown tables")
    args = ap.parse_args(argv)

    path = Path(args.session_db)
    if not path.exists():
        print(f"no such file: {path}", file=sys.stderr)
        return 2
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        reports = build_report(db, args.match_id)
    finally:
        db.close()

    if not reports:
        print("no matches found" + (f" for {args.match_id!r}" if args.match_id else ""), file=sys.stderr)
        return 1 if args.match_id else 0
    print(json.dumps(reports, indent=2) if args.json else render_markdown(reports))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
