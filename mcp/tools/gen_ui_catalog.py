#!/usr/bin/env python3
"""Regenerate the two hand-copied weapon/mode catalogs in the UIs from the server's own source.

    python3 mcp/tools/gen_ui_catalog.py            # rewrite both files
    python3 mcp/tools/gen_ui_catalog.py --check    # exit 1 if either is stale (what the test does)

2026-09-12 doc-rot review (Tony's D5). `webapp/mc/src/mock/data.ts` and `app/src/demo-catalog.js` each
carry a COPY of the weapon catalog, both headed "GENERATED from mcp/brx_mcp/mc/weapons.json" by a
script that was never checked in. They had drifted: the mock listed the assault rifle at 384 reserve
and 39 rof when the shipped weapon is 192 and 54, and its mode blurbs were a release behind
`mc/state.py`. A demo that shows numbers the server does not send is worse than no demo: it is what
the operator learns the arsenal from.

2026-09-12 polish pass: the PERK arrays were the last hand copies. Both files carried one OUTSIDE the
markers and all three texts had drifted apart (`body_armor`'s blurb read differently in perks.json, in
the mock and in the demo), so the operator and the player were being taught three different perks.
They are generated now too.

Source of truth, in every case the thing MC actually publishes:
  weapons  `Compiler().weapon_catalog()` -> `views.weapon_views()`  (the API.md `WeaponView`, so the
           derived fields (mags, dmg_per_hit, pool, ttk_ms, ammo_total, bars, caution) come along,
           and a `hidden` row like `melee` is dropped exactly where the server drops it)
  perks    `perks.default_perks().all()` -> the API.md `PerkView` (`PerkCatalog.view()`, the same rows
           `GET /api/perks` serves), so hidden `slot_frame` rows are dropped where the server drops them
  modes    `mc/state.py MODES`, prose fields only (`params`/`defaults` stay hand-written TS)

Only the text BETWEEN the marker comments is replaced; everything else in each file is left alone.
"""
from __future__ import annotations

import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
DATA_TS = REPO / "webapp" / "mc" / "src" / "mock" / "data.ts"
DEMO_JS = REPO / "app" / "src" / "demo-catalog.js"

# `WeaponView` (webapp/mc/src/api/types.ts) has no `reload_ms`; a TS object literal typed as
# WeaponView[] is rejected for an excess property, so it is dropped on the way out.
_DROP = ("reload_ms",)
_MODE_TEXT_KEYS = ("name", "abbr", "desc", "brief", "teams_text", "win_text", "respawn_text")


def weapon_views() -> list[dict]:
    sys.path.insert(0, str(REPO / "mcp"))
    from brx_mcp.mc import views
    from brx_mcp.mc.compile import Compiler

    out = []
    for v in views.weapon_views(Compiler().weapon_catalog()):
        out.append({k: v[k] for k in v if k not in _DROP})
    return sorted(out, key=lambda w: w["weapon_id"])


def perk_views() -> list[dict]:
    """Every VISIBLE perk as a `PerkView` — `PerkCatalog.all()` is the exact list `/api/perks` serves,
    so the demo browses the perks the server would hand a phone, with perks.json's own copy."""
    sys.path.insert(0, str(REPO / "mcp"))
    from brx_mcp.mc.perks import default_perks

    return default_perks().all()


def mode_text() -> list[dict]:
    sys.path.insert(0, str(REPO / "mcp"))
    from brx_mcp.mc.state import MODES

    return [{"mode": m["mode"], **{k: m.get(k, "") for k in _MODE_TEXT_KEYS}} for m in MODES]


def _lit(obj, indent: int) -> str:
    """A JSON literal (valid TS and JS) at a fixed indent, deterministic and diff-friendly."""
    pad = " " * indent
    body = json.dumps(obj, indent=2, ensure_ascii=False)
    return "\n".join(pad + ln if i else ln for i, ln in enumerate(body.split("\n")))


def _splice(text: str, tag: str, block: str, path: pathlib.Path) -> str:
    start, end = f"// GENERATED-START {tag}", f"// GENERATED-END {tag}"
    if start not in text or end not in text:
        # RuntimeError, not SystemExit: `run_tests.py` catches Exception, and a SystemExit from an
        # in-process render would kill the whole suite instead of failing one test. `main()` turns it
        # back into exit 1 for the CLI.
        raise RuntimeError(f"{path}: missing the {start} / {end} markers - add them around the block first")
    head = text[:text.index(start) + len(start)]
    tail = text[text.index(end):]
    return f"{head}\n{block.rstrip()}\n{tail}"


def render() -> dict[pathlib.Path, str]:
    """The two files as they SHOULD be. Pure: reads the sources, touches nothing."""
    weapons, perks, modes = weapon_views(), perk_views(), mode_text()

    ts = DATA_TS.read_text(encoding="utf-8")
    ts = _splice(ts, "weapons",
                 "// Regenerate: python3 mcp/tools/gen_ui_catalog.py - never hand-edit between the markers.\n"
                 "export const WEAPONS: WeaponView[] = " + _lit(weapons, 0) + ";", DATA_TS)
    ts = _splice(ts, "modes",
                 "// Prose only; `params` and `defaults` below stay hand-written.\n"
                 "const MODE_TEXT: Record<string, Omit<ModeInfo, 'params' | 'defaults'>> = "
                 + _lit({m["mode"]: m for m in modes}, 0) + ";", DATA_TS)
    ts = _splice(ts, "perks",
                 "// Visible perks only, exactly as `GET /api/perks` serves them.\n"
                 "export const PERKS: PerkView[] = " + _lit(perks, 0) + ";", DATA_TS)

    js = DEMO_JS.read_text(encoding="utf-8")
    js = _splice(js, "weapons", "export const DEMO_WEAPONS = " + _lit(weapons, 0) + ";", DEMO_JS)
    js = _splice(js, "perks", "export const DEMO_PERKS = " + _lit(perks, 0) + ";", DEMO_JS)

    return {DATA_TS: ts, DEMO_JS: js}


def main(argv: list[str]) -> int:
    check = "--check" in argv
    try:
        targets = render()
    except RuntimeError as exc:          # a renamed/missing marker: a CLI error, exit 1, no traceback
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    stale = []
    for path, want in targets.items():
        if path.read_text(encoding="utf-8") == want:
            continue
        stale.append(str(path.relative_to(REPO)))
        if not check:
            path.write_text(want, encoding="utf-8")
    if check:
        if stale:
            print("STALE (run python3 mcp/tools/gen_ui_catalog.py): " + ", ".join(stale))
            return 1
        print("up to date")
        return 0
    print("rewrote: " + (", ".join(stale) if stale else "nothing (already up to date)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
