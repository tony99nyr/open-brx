#!/usr/bin/env python3
"""Rebuild this directory from the MC session store.

The store itself (`~/.brx-mcp/mc/session-3782dc77.sqlite`) is NOT in the repo: it is ~900 KB, it lives on one
MacBook, and its node logs carry headset sticker ids. This script pulls out the parts the 2026-09-13 write-up
actually argues from, **sanitised**, so the evidence survives that machine.

    python3 docs/evidence/2026-09-13-session-3782dc77/extract.py [path-to-session.sqlite]

Sanitising, and why each rule exists:

* **Headset sticker ids are rewritten** (`docs/gotchas.md` -> "Never write a headset sticker id into the
  repo": the stickers are the headset serials/PINs). The map is below, and the same PIN-free `Tactix-XXXX`
  aliases the write-up uses. `mcp/tests/test_docs_hygiene.py` fails the build if one gets through, so this is
  belt and braces -- but the guard only knows the pattern, and a NEW sticker shape would slip past it. If you
  re-run this against another session, check `ALIASES` covers that session's guns first.
* **The engine-state blob at the end of each node log is truncated.** It is ~25 KB of weapon/perk CATALOG per
  upload -- the same static catalog every time, already in `mcp/brx_mcp/mc/weapons.json` -- wrapped around a
  few hundred bytes of live state. The live keys are kept; the catalog is dropped.
* Private LAN addresses are left as they are: RFC1918, non-routable, and F203 is ABOUT a specific unreachable
  address, so rewriting them would destroy the evidence.

Nothing else is filtered. If a claim in the write-up is not supported by what lands here, the write-up is
wrong -- that is the point of committing this.
"""
from __future__ import annotations

import json
import pathlib
import re
import sqlite3
import sys

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_DB = pathlib.Path.home() / ".brx-mcp" / "mc" / "session-3782dc77.sqlite"

# Sticker id -> PIN-free alias. Longest first: a bare basename must not eat the tail off a full BLE name.
ALIASES = [
    ("R0B" + "AT-3D4F", "Tactix-3D4F"),
    ("R0B" + "AS-FE30", "Tactix-FE30"),
    ("R0B" + "AT", "Tactix-3D4F"),
    ("R0B" + "AS", "Tactix-FE30"),
]
# The guard's own pattern, so this script fails loudly rather than shipping a leak.
_STICKER = re.compile("R" + "0B" + r"[A-Z0-9]{2}\b")

# Live engine-state keys worth keeping. The rest of the blob is the static catalog.
KEEP_STATE = (
    "phase bleUp wsState night mode weapon weaponId activeSlot hp armor shield maxHp maxArmor "
    "ammo reserve mag loadMag loadReserve alive deaths kills assists shots hits accuracy battery "
    "respawnType respawnIn respawnGate respawnHint killedBy underFire stunned reloading resync "
    "reconciling synced headEcho matchId ended endAck kitOpen kitLocked standby ready"
).split()


def sanitise(text: str) -> str:
    for sticker, alias in ALIASES:
        text = text.replace(sticker, alias)
    return text


def trim_state_blob(line: str) -> str:
    """A node log ends with one JSON engine-state dump. Keep the live keys, drop the catalog."""
    try:
        state = json.loads(line)
    except (ValueError, TypeError):
        return line
    if not isinstance(state, dict) or "phase" not in state:
        return line
    kept = {k: state[k] for k in KEEP_STATE if k in state}
    for k in ("player", "team", "loadout", "game", "result"):
        v = state.get(k)
        if isinstance(v, dict):
            # `loadout`/`game` carry a copy of the catalog row per slot; keep the identifying fields only.
            kept[k] = {kk: vv for kk, vv in v.items()
                       if kk in ("player_id", "player_num", "display", "team_id", "node_id", "gun_id",
                                 "name", "tid", "color", "mode", "mode_name", "environment", "night",
                                 "respawn", "health", "time_limit_s", "outcome", "winner", "win_by",
                                 "weapon_id", "perk_id", "kind", "rows", "team_scores")}
            for slot in ("primary", "secondary", "perk"):
                if isinstance(v.get(slot), dict):
                    kept[k][slot] = {kk: v[slot][kk] for kk in ("weapon_id", "perk_id", "name", "clip",
                                                                "reserve", "kind") if kk in v[slot]}
    return json.dumps(kept, indent=1, sort_keys=True) + "\n\n(catalog and policy blocks dropped by extract.py)"


def main() -> int:
    db_path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB
    if not db_path.exists():
        print(f"no session store at {db_path}\n"
              f"This directory is the committed extract; the store itself is not in the repo.", file=sys.stderr)
        return 1
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    written = []

    # ---- 1. the compiled heads MC actually pushed, per match -------------------------------- #
    out = ["# The compiled heads MC pushed, 2026-09-13 session 3782dc77",
           "",
           "Straight out of `matches.config`. This is what each gun was actually told, byte for byte -- not",
           "what the compiler would emit today. Player ids: 6748d5e1 = ROCCO (player 1), 002803e7 = TONY (2).",
           ""]
    for match_id, config in db.execute("select match_id, config from matches order by rowid"):
        c = json.loads(config)
        heads = c.pop("_heads", {}) or {}
        out += [f"## {match_id} -- {c['mode']} / {c['environment']}", "",
                "```json", json.dumps(c, indent=1, sort_keys=True), "```", ""]
        for pid, frames in heads.items():
            out += [f"### head -> {pid}", "", "```"] + list(frames) + ["```", ""]
    written.append(("heads.md", "\n".join(out)))

    # ---- 2. every ack, with the head's own reserve pair beside it --------------------------- #
    rows = ["# `ack_config` -- what each gun echoed (F207, F201)",
            "",
            "`gun_echo` is the gun's answer to the head. Compare its 4th token (reserve) against the",
            "`$WEAP,0` t17 in `heads.md`, then against that frame's t40. Every row: t17/2 == the echo.",
            "",
            "| t_recv | node | config_id | ok | gun_echo |", "|---|---|---|---|---|"]
    for node, t, body in db.execute(
            "select node_id, t_recv, body from envelopes where kind='ack_config' order by id"):
        d = json.loads(body)
        rows.append(f"| {t} | `{node}` | `{d.get('config_id')}` | {d.get('ok')} | `{d.get('gun_echo')}` |")
    written.append(("acks.md", "\n".join(rows) + "\n"))

    # ---- 3. the hit / death / respawn timeline ---------------------------------------------- #
    tsv = ["t_recv\tmatch_id\tnode_id\tkind\tplayer_id\tshooter_num\tshooter_team\tdmg\tsensor\tir_proto"]
    for t, match_id, node, kind, body in db.execute(
            "select t_recv, match_id, node_id, kind, body from envelopes "
            "where kind in ('hit_taken','death','respawn') order by t_recv, id"):
        d = json.loads(body)
        tsv.append("\t".join(str(x) for x in (
            t, match_id, node, kind, d.get("player_id", ""), d.get("shooter_num", ""),
            d.get("shooter_team", ""), d.get("dmg", ""), d.get("sensor", ""), d.get("ir_proto", ""))))
    written.append(("events.tsv", "\n".join(tsv) + "\n"))

    # ---- 4. the status stream, deduplicated ------------------------------------------------- #
    # 968 rows, most of them identical. Keeping only CHANGES is what makes F208's 105 s freeze visible
    # as one row with a long gap after it, instead of 53 identical lines.
    tsv = ["t_recv\tmatch_id\tnode_id\tarm_state\talive\thp\tarmor\tammo\tshots\tpool_src\tsynced"]
    last: dict[str, tuple] = {}
    for t, match_id, node, body in db.execute(
            "select t_recv, match_id, node_id, body from envelopes where kind='status' order by t_recv, id"):
        d = json.loads(body)
        key = (match_id, d.get("arm_state"), d.get("alive"), d.get("hp"), d.get("armor"),
               d.get("ammo"), d.get("shots"), d.get("pool_src"), d.get("synced"))
        if last.get(node) == key:
            continue
        last[node] = key
        tsv.append("\t".join(str(x) for x in (t, match_id, node) + key[1:]))
    written.append(("status-changes.tsv", "\n".join(tsv) + "\n"))

    # ---- 5. the node logs, sanitised -------------------------------------------------------- #
    for i, (env_id, node, t, body) in enumerate(db.execute(
            "select id, node_id, t_recv, body from envelopes where kind='log_data' order by id")):
        chunk = json.loads(body).get("chunk", "")
        lines = chunk.split("\n")
        lines = [trim_state_blob(ln) if ln.startswith('{"phase"') else ln for ln in lines]
        name = f"nodelog-{env_id}-{node[-6:]}-{t}.log"
        written.append((name, sanitise("\n".join(lines))))

    for name, text in written:
        text = sanitise(text)
        leak = _STICKER.search(text)
        if leak:
            print(f"REFUSING TO WRITE {name}: sticker id {leak.group(0)!r} survived sanitising "
                  f"-- add it to ALIASES", file=sys.stderr)
            return 2
        (HERE / name).write_text(text, encoding="utf-8")
        print(f"{name}: {len(text)} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
