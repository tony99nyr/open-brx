"""T1-B (field session 2026-09-12): a post-match diagnostic that reproduces, as ONE command, the
analysis Tony's session did by hand against `~/.brx-mcp/mc/session-25eebce5.sqlite` — go_live/ended/
duration, mode/config_id/environment/cfg health, total shots, hits, hit%, deaths, arm_state +
alive distributions, per-node `preflight.gun_linked` counts, the per-node POOL columns below,
`shooter_team` values seen, and each node's `ack_config` config_id vs the match it was pushed for.

F175: a node can carry more than one player binding during one match. The node summary keeps its
physical-node totals but has no single `player_id` in that case; `attributions` partitions every status-derived
fact by that heartbeat's explicit player id (and an honest null bucket when it named none). Cumulative shots are
attributed by counter deltas, including resets, so a 10 → 15 rebind remains 15 shots rather than becoming 25.

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
  * `first_live_pool` -- on the physical-node summary, the (hp, armor) on its FIRST `status` with
    `arm_state: live` and `alive: true`; on an attribution row (and therefore a CLI table row), the
    first such status explicitly naming that player/null bucket. This is the exact signature the A36
    pool check exists for and the one `max_hp`/`max_armor` cannot see: a gun that spawned into the
    wrong head's pool and then self-corrected has a clean max and a damning first frame.

Read-only, pure sqlite — no `Session` import needed, so it can be pointed at a real session file
Mission Control still has open (`GET /api/diag/matches` opens its own short-lived read-only handle)
or at one from any earlier night (`python -m brx_mcp.mc.diag <path/to/session.sqlite>`).

`hits` counts BOTH shapes the envelope table can hold a fact in: a row logged with `kind ==
"hit_taken"` (today's shape — see `store.py`/`state.py`: every fact, batched or not, is logged under
its OWN `type`) and, defensively, a `hit_taken` nested inside `body.events` on a row logged with
`kind == "event_batch"` (an older or different writer's shape) — so a diag run against a session
written by something other than this exact server still counts every hit.
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path
from typing import Any, TypeGuard

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


def _status_player(body: dict) -> str | None:
    player_id = body.get("player_id")
    return player_id if isinstance(player_id, str) and player_id else None


def _finite_number(value: object) -> TypeGuard[int | float]:
    """JSON number safe to compare; avoid coercing arbitrary-size Python ints through float."""
    return ((isinstance(value, int) and not isinstance(value, bool))
            or (isinstance(value, float) and math.isfinite(value)))


def _shot_deltas(bodies: list[dict]) -> list[int]:
    """Attribute a cumulative counter without double-counting across bindings or resets."""
    previous: int | None = None
    deltas: list[int] = []
    for body in bodies:
        raw = body.get("shots")
        delta = 0
        if _finite_number(raw) and raw >= 0:
            current = int(raw)
            delta = current if previous is None or current < previous else current - previous
            previous = current
        deltas.append(delta)
    return deltas


def _status_summary(bodies: list[dict], shot_deltas: list[int], cfg: dict,
                    player_id: str | None) -> dict:
    """Status-derived facts for one node or one explicit node/player attribution."""
    health = cfg.get("health") or {}
    cfg_hp, cfg_armor = health.get("max_hp"), health.get("max_armor")
    arm_state: dict[str, int] = {}
    alive: dict[str, int] = {"true": 0, "false": 0}
    linked: dict[str, int] = {"true": 0, "false": 0, "none": 0}
    max_shots = max_hp = max_armor = 0
    first_live: dict[str, int] | None = None
    for body in bodies:
        if first_live is None and body.get("arm_state") == "live" and body.get("alive") is True:
            hp0, ar0 = body.get("hp"), body.get("armor")
            if (isinstance(hp0, int) and not isinstance(hp0, bool)
                    and isinstance(ar0, int) and not isinstance(ar0, bool)):
                first_live = {"hp": hp0, "armor": ar0}
        state = body.get("arm_state")
        if state is not None:
            arm_state[str(state)] = arm_state.get(str(state), 0) + 1
        is_alive = body.get("alive")
        if is_alive is True:
            alive["true"] += 1
        elif is_alive is False:
            alive["false"] += 1
        gun_linked = (body.get("preflight") or {}).get("gun_linked")
        linked["true" if gun_linked is True else "false" if gun_linked is False else "none"] += 1
        shots, hp, armor = body.get("shots"), body.get("hp"), body.get("armor")
        if _finite_number(shots):
            max_shots = max(max_shots, int(shots))
        if _finite_number(hp):
            max_hp = max(max_hp, int(hp))
        if _finite_number(armor):
            max_armor = max(max_armor, int(armor))

    pushed = _pushed_pool(cfg, player_id)
    return {
        "player_id": player_id,
        "arm_state_counts": arm_state,
        "alive_counts": alive,
        "gun_linked_counts": linked,
        "shots": sum(shot_deltas),
        "max_shots": max_shots,
        "max_hp": max_hp,
        "max_armor": max_armor,
        "first_live_pool": first_live,
        "cfg_health": {"max_hp": cfg_hp, "max_armor": cfg_armor},
        "pushed_pool": pushed,
        "hp_mismatch_vs_cfg": bool(bodies) and cfg_hp is not None and max_hp != cfg_hp,
        "armor_mismatch_vs_cfg": bool(bodies) and cfg_armor is not None and max_armor < cfg_armor,
        "hp_mismatch_vs_pushed": (max_hp != pushed["hp"]) if pushed else None,
        "armor_mismatch_vs_pushed": (max_armor != pushed["armor"]) if pushed else None,
    }


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
        deltas = _shot_deltas(bodies)
        explicit_players = list(dict.fromkeys(pid for b in bodies if (pid := _status_player(b)) is not None))
        player_id = (explicit_players[0] if len(explicit_players) == 1
                     and all(_status_player(body) == explicit_players[0] for body in bodies) else None)
        summary = _status_summary(bodies, deltas, cfg, player_id)

        groups: dict[str | None, tuple[list[dict], list[int]]] = {}
        for body, delta in zip(bodies, deltas):
            group_bodies, group_deltas = groups.setdefault(_status_player(body), ([], []))
            group_bodies.append(body)
            group_deltas.append(delta)
        attributions = [_status_summary(group_bodies, group_deltas, cfg, attributed_player)
                        for attributed_player, (group_bodies, group_deltas) in groups.items()]

        ack = _latest_ack_before(db, nid, go_live_t)
        ack_config_id = ack.get("config_id") if ack else None
        nodes[nid] = {
            **summary,
            # F175: a physical node can report more than one binding inside a match. Never put its
            # combined pools beside the LAST player's head; retain every explicit id in arrival order
            # and expose status-derived facts per id (with a separate null bucket for unknown rows).
            "player_ids": explicit_players,
            "attributions": attributions,
            "ack_config_id": ack_config_id,
            "ack_matches_config": (ack_config_id == cfg.get("config_id")) if ack_config_id is not None else None,
        }

    total_shots = sum(n["shots"] for n in nodes.values())
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


def build_report_path(path: str | Path, match_id: str | None = None) -> list[dict]:
    """Build a report through a connection owned and closed by the calling worker.

    The HTTP route calls this inside its executor. Keeping the open/read/close lifecycle here means
    the event-loop thread's live ``Store.db`` writer is never shared with a diagnostic scan.
    """
    # `as_uri` quotes URI metacharacters in otherwise-valid filenames (`%`, `?`, `#`) and produces
    # the right absolute file URI on both POSIX and Windows. One explicit read transaction keeps the
    # report's many SELECTs on a single snapshot while the live Store may still append delayed facts.
    db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        db.execute("BEGIN")
        return build_report(db, match_id)
    finally:
        db.close()


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
                  "| node_id | player | arm_state | alive T/F | linked T/F/none | shots | "
                  "first_live hp/armor | max hp/armor | cfg hp/armor | pushed hp/armor | "
                  "hp≠cfg | armor≠cfg | hp≠pushed | armor≠pushed | ack_config_id | ack==cfg |",
                  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for nid, n in sorted(r["nodes"].items()):
            rows = n.get("attributions") or [n]
            for attributed in rows:
                lines.append("| " + " | ".join(_fmt(x) for x in (
                    nid, attributed["player_id"], attributed["arm_state_counts"],
                    f"{attributed['alive_counts']['true']}/{attributed['alive_counts']['false']}",
                    f"{attributed['gun_linked_counts']['true']}/{attributed['gun_linked_counts']['false']}/"
                    f"{attributed['gun_linked_counts']['none']}",
                    attributed["shots"], _pair(attributed["first_live_pool"], "hp", "armor"),
                    f"{attributed['max_hp']}/{attributed['max_armor']}",
                    _pair(attributed["cfg_health"], "max_hp", "max_armor"),
                    _pair(attributed["pushed_pool"], "hp", "armor"),
                    attributed["hp_mismatch_vs_cfg"], attributed["armor_mismatch_vs_cfg"],
                    attributed["hp_mismatch_vs_pushed"], attributed["armor_mismatch_vs_pushed"],
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
    reports = build_report_path(path, args.match_id)

    if not reports:
        print("no matches found" + (f" for {args.match_id!r}" if args.match_id else ""), file=sys.stderr)
        return 1 if args.match_id else 0
    print(json.dumps(reports, indent=2) if args.json else render_markdown(reports))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
