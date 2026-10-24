#!/usr/bin/env python3
"""Refresh only the derived `ttk_ms` values in weapons.json.

    python3 mcp/tools/gen_weapon_ttk.py
    python3 mcp/tools/gen_weapon_ttk.py --check
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CATALOGUE = ROOT / "mcp" / "brx_mcp" / "mc" / "weapons.json"
sys.path.insert(0, str(ROOT / "mcp"))
from brx_mcp.mc.compile import DEFAULT_POOL, WeaponCatalog  # noqa: E402

TTK_LINE = re.compile(r'(?m)^(   "ttk_ms": )\d+(,?)$')


def render() -> str:
    text = CATALOGUE.read_text(encoding="utf-8")
    rows = json.loads(text)["weapons"]
    matches = list(TTK_LINE.finditer(text))
    if len(matches) != len(rows):
        raise ValueError("each weapon needs one top-level ttk_ms line")
    cat = WeaponCatalog()
    if [row["weapon_id"] for row in rows] != [row["weapon_id"] for row in cat._rows]:
        raise ValueError("catalogue order changed while deriving ttk_ms")
    for match, row in zip(matches, rows):
        if int(match.group()[len(match.group(1)):].rstrip(",")) != row["ttk_ms"]:
            raise ValueError(f"{row['weapon_id']}: ttk_ms line differs from parsed value")
    derived = iter(0 if row.get("lethal") is False else cat.time_to_kill(row["weapon_id"], DEFAULT_POOL)
                   for row in rows)
    return TTK_LINE.sub(lambda match: f"{match.group(1)}{next(derived)}{match.group(2)}", text)


def main(argv: list[str]) -> int:
    old = CATALOGUE.read_text(encoding="utf-8")
    want = render()
    if "--check" in argv:
        print("up to date" if old == want else "STALE (run python3 mcp/tools/gen_weapon_ttk.py)")
        return 0 if old == want else 3
    if old != want:
        CATALOGUE.write_text(want, encoding="utf-8")
    print("rewrote: mcp/brx_mcp/mc/weapons.json" if old != want else "up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
