"""PRINT one complete arm sequence, with $WEAP token overrides and $SIR edits. Sends nothing.

Why this exists: every bench rung that needs a non-stock weapon token or a non-stock $SIR table used
to hand-roll the arm sequence, and on 2026-09-10 that cost three arms in a row -- the gun spawned,
showed HP and armour, looked armed, and the trigger fired nothing (no $AMMO, no $BMAP, `$SPAWN,*` for
`$SPAWN,,*`). `gameconfig.arm_sequence()` is the fix for that, but it has no CLI, so a rung sheet
either printed a frame list that drifts from the code or asked the operator to write Python at the
bench. This is the CLI: it calls `arm_sequence()`, applies the edits, re-runs
`assert_arm_sequence_complete()` + `assert_sir_follows_clear()` on the RESULT, and prints the frames
for pasting into the MCP `send_batch` tool (or `sendframes.py`).

Token overrides are given in **DOC numbering** (`t3=7`, the numbering in
protocol/brx-protocol.md 6 and docs/reference/weapons.md), never the raw comma index -- the tool does
`raw = doc + 1` itself and prints both, because that off-by-one once wrote the rate of fire into the
swap-delay token and shipped every weapon at 10 shots/s.

No Bluetooth, no serial: runs under the WSL venv (`.venv/bin/python`) as happily as the Windows one.

Usage:
    python armgen.py <team> <pid> [weapon] [KEY=VAL ...]

    weapon          a WEAPON_TAILS key for SLOT 0 = the primary the trigger fires (default `ar`).
    t<N>=<v>        override doc token N of the slot-0 $WEAP frame (t3 protocol, t5 magnitude,
                    t14 ms/round, t21/t22 accuracy ceiling/floor).
    s<N>=<v>        same for the SLOT 1 (secondary) frame.
    +sir=<frame>    append a $SIR row (repeatable).
    -sir=<p>,<s>    drop the $SIR row on cell <protocol>,<subtype> (repeatable).
    -sir=all        drop the WHOLE stock 10-row table, keeping only the rows added with +sir --
                    the one-row method every $SIR function sweep needs, so that a word which
                    mis-decodes into another cell is discarded instead of scoring elsewhere.
    <field>=<v>     any GameConfig field: volume=80 friendly_fire=0 hp=45 outdoor=1 ...

Examples:
    python armgen.py 1 5 ar t3=7                      # F91: move the primary onto IR protocol 7
    python armgen.py 1 5 ar t5=70                      # rung X: a magnitude-70 word from a t1=0 weapon
    python armgen.py 1 5 ar t14=50                     # rung Z1: 50 ms/round
    python armgen.py 1 5 ar t3=7 -sir=0,0 '+sir=$SIR,7,0,,1,0,0,1,,*'
    python armgen.py 1 5 ar -sir=all '+sir=$SIR,5,0,,35,0,0,1,,*'    # one row, one function
"""
from __future__ import annotations

import sys

from brx_mcp.gameconfig import (WEAPON_TAILS, arm_sequence, assert_arm_sequence_complete,
                                assert_sir_follows_clear)

# GameConfig fields that take a bool; everything else is int unless the current value is a str.
_TRUEISH = {"1", "true", "True", "yes", "on"}


def _cfg_value(current, raw: str):
    if isinstance(current, bool):
        return raw in _TRUEISH
    if isinstance(current, float):
        return float(raw)
    if isinstance(current, int):
        return int(raw)
    return raw


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    team, pid = int(argv[0]), int(argv[1])
    rest = list(argv[2:])
    weapon = "ar"
    if rest and "=" not in rest[0]:
        weapon = rest.pop(0)
    if weapon not in WEAPON_TAILS:
        print(f"unknown weapon {weapon!r}; WEAPON_TAILS keys are {', '.join(WEAPON_TAILS)}")
        return 2

    ptoks: dict[int, str] = {}      # slot 0, doc token -> value
    stoks: dict[int, str] = {}      # slot 1, doc token -> value
    add_sir: list[str] = []
    drop_cells: list[tuple[str, str]] = []
    drop_all_sir = False
    cfg_kwargs: dict[str, object] = {}

    import dataclasses

    from brx_mcp.gameconfig import GameConfig
    fields = {f.name: getattr(GameConfig(), f.name) for f in dataclasses.fields(GameConfig)}

    for arg in rest:
        if "=" not in arg:
            print(f"cannot parse {arg!r} (expected KEY=VALUE)")
            return 2
        key, val = arg.split("=", 1)
        if key == "+sir":
            add_sir.append(val)
        elif key == "-sir":
            if val.strip() == "all":
                drop_all_sir = True
                continue
            p, _, s = val.partition(",")
            drop_cells.append((p.strip(), s.strip()))
        elif key.startswith("t") and key[1:].isdigit():
            ptoks[int(key[1:])] = val
        elif key.startswith("s") and key[1:].isdigit():
            stoks[int(key[1:])] = val
        elif key in fields:
            cfg_kwargs[key] = _cfg_value(fields[key], val)
        else:
            print(f"unknown setting {key!r} (not a GameConfig field, not t<N>/s<N>/+sir/-sir)")
            return 2

    frames = arm_sequence(team, pid, weapon, extra_sir=tuple(add_sir), **cfg_kwargs)

    notes: list[str] = []

    def _override(frame: str, toks: dict[int, str], label: str) -> str:
        parts = frame.split(",")
        before = frame
        for doc, val in sorted(toks.items()):
            raw = doc + 1          # parts[0] is '$WEAP', parts[1] is the slot -> raw = doc + 1
            if raw >= len(parts) - 1:
                raise SystemExit(f"doc t{doc} (raw index {raw}) is past the end of {label}")
            notes.append(f"  {label} doc t{doc} = raw index {raw}: "
                         f"{parts[raw]!r} -> {val!r}")
            parts[raw] = val
        out = ",".join(parts)
        if out != before:
            notes.append(f"  {label} before: {before}")
            notes.append(f"  {label} after:  {out}")
        return out

    kept: list[str] = []
    matched_drops: set[tuple[str, str]] = set()
    for f in frames:
        if ptoks and f.startswith("$WEAP,0,"):
            f = _override(f, ptoks, "$WEAP,0 (PRIMARY, the trigger)")
        elif stoks and f.startswith("$WEAP,1,"):
            f = _override(f, stoks, "$WEAP,1 (secondary)")
        if f.startswith("$SIR,"):
            t = f.split(",")
            if drop_all_sir and f not in add_sir:
                notes.append(f"  DROPPED $SIR cell <{t[1]},{t[2]}> (-sir=all): {f}")
                continue
            if (t[1], t[2]) in drop_cells:
                matched_drops.add((t[1], t[2]))
                notes.append(f"  DROPPED $SIR cell <{t[1]},{t[2]}>: {f}")
                continue
        kept.append(f)

    # A drop that matched nothing, or a cell still present after the drop, VOIDS the rung: the gun
    # would be armed with exactly the row the rung is trying to remove. Fail at the desk.
    never_matched = [c for c in drop_cells if c not in matched_drops]
    if never_matched:
        raise SystemExit("asked to drop $SIR cell(s) that are not in the table: "
                         + ", ".join(f"<{p},{s}>" for p, s in never_matched))
    survivors = {(f.split(",")[1], f.split(",")[2]) for f in kept if f.startswith("$SIR,")}
    still_there = [c for c in drop_cells if c in survivors]
    if still_there:
        raise SystemExit("asked to drop $SIR cell(s) but a row on that cell is still in the table: "
                         + ", ".join(f"<{p},{s}>" for p, s in still_there))

    # The result is validated, not the input: an edit that breaks the arm must fail HERE, at the
    # desk, not at the bench where it reads as a dead trigger.
    assert_arm_sequence_complete(kept)
    assert_sir_follows_clear(kept)

    for f in kept:
        print(f)
    if notes:
        print("\n# what changed", file=sys.stderr)
        for n in notes:
            print(n, file=sys.stderr)
    print(f"\n# {len(kept)} frames, validated. Slot 0 = {weapon} (PRIMARY, what the trigger fires).",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
