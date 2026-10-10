"""A8: the BRX LED palette is written ONCE (poolgauge.LED_PALETTE) and every surface reads it.

The stage page used to restate the nine names, the nine drawing colours, the dark rule and a whole readout level
table (whose fallback painted the shield WHITE while poolgauge says TEAL). These tests pin the single source and
the page's lack of copies. The page is HTML/JS, so the checks are on the server payload (the page's only input)
plus a static scan of page.html for the shapes that used to be copies.
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess

from _skip import needs

from brx_mcp import poolgauge as pg

PAGE = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "stage" / "page.html"


def test_the_palette_is_nine_named_coloured_entries_in_index_order():
    assert [e["id"] for e in pg.LED_PALETTE] == list(range(9))
    assert [e["name"] for e in pg.LED_PALETTE] == ["red", "blue", "yellow", "green", "purple", "teal", "white", "pink", "orange"]
    assert all(re.fullmatch(r"#[0-9a-f]{6}", e["hex"]) for e in pg.LED_PALETTE)
    # the named constants are the same indices the table holds
    names = {e["name"].upper(): e["id"] for e in pg.LED_PALETTE}
    for const in ("RED", "BLUE", "YELLOW", "GREEN", "PURPLE", "TEAL", "WHITE", "PINK", "ORANGE"):
        assert getattr(pg, const) == names[const], const
    assert pg.SHIELD_COLOUR == names["TEAL"] and pg.LED_PALETTE[pg.SHIELD_COLOUR]["name"] == "teal"


def test_dark_is_the_indices_after_the_palette():
    assert pg.DARK_INDICES == (9, 10)
    assert not set(pg.DARK_INDICES) & {e["id"] for e in pg.LED_PALETTE}
    assert pg.DARK in pg.DARK_INDICES


def test_the_stage_page_keeps_no_copy_of_the_palette_or_the_level_table():
    src = PAGE.read_text(encoding="utf-8")
    assert "'orange'" not in src and "'teal'" not in src, "a colour-name list is back in page.html"
    assert not re.search(r"#ff2a1f|#17e0d0", src, re.I), "a palette hex is back in page.html"
    assert "const PAL" not in src and "GLED_HEX" not in src
    assert "levelTable" not in src or "hue" not in src.split("function levelTable", 1)[-1][:600], \
        "levelTable still builds a fallback frame from a hard-coded hue"
    assert not re.search(r"hue\s*=\s*\{", src), "a per-pool hue map is back in page.html"
    assert "i < lit ? palette().shield" in src, "the shield strip hue is not read from the served palette"
    assert not re.search(r"c\s*<=\s*8|!==\s*9", src), "page.html decides 'dark' with its own rule"


def _run_page(state: dict, tail: str) -> object:
    """Run page.html's own script under node with a stub DOM, set `st = state`, then evaluate `tail` (JS) and return its JSON."""
    needs(shutil.which("node") is not None, "node")
    src = re.search(r"<script>(.*?)</script>", PAGE.read_text(encoding="utf-8"), re.S).group(1)
    prog = ("const stub = new Proxy(function(){}, {get: (t, k) => k === Symbol.toPrimitive ? () => '' : stub, apply: () => stub, set: () => true});\n"
            "const bar = {innerHTML: '', onclick: null};\n"
            "globalThis.document = {querySelector: s => s === '#gledbar' ? bar : stub, querySelectorAll: () => [], activeElement: {}, addEventListener: () => {}, createElement: () => stub};\n"
            "globalThis.location = {search: ''}; globalThis.fetch = () => Promise.reject(new Error('no net'));\n"
            "globalThis.setInterval = () => 0;\n"
            f"{src}\n;st = {json.dumps(state)}; console.log(JSON.stringify((() => {{ {tail} }})()));")
    out = subprocess.run(["node", "-e", prog], capture_output=True, text=True, timeout=20)
    assert out.returncode == 0, out.stderr[-600:]
    return json.loads(out.stdout.strip().splitlines()[-1])


_PAL = {"colours": [dict(e) for e in pg.LED_PALETTE], "dark": list(pg.DARK_INDICES), "shield": 5, "armour": 4}
_FULL = {p: pg.readout_levels(p) for p in ("health", "armor", "shield")}


def test_the_scene_builder_survives_a_server_without_a_level_table():
    """An older stage server serves no readout.fallback_levels: scenes() must return [] (the restart warning shows), not throw."""
    assert _run_page({"palette": _PAL, "readout": {}}, "return scenes('health').length;") == 0
    assert _run_page({"palette": _PAL, "readout": {"fallback_levels": _FULL}}, "return scenes('health').length;") > 5


def test_a_server_without_a_palette_gets_the_restart_warning_and_no_frames():
    """An OLD stage process serves the new page from disk: levels but no palette. No frame may carry `undefined`."""
    tail = ("const sc = scenes('health'); const f = [shieldF(2, 10), ...sc.flatMap(s => s.steps.map(x => x[0]))];"
            "buildSceneBar(); const strip = {c: [0, 0, 0], b: 10, lit: true};"
            "paintStrip({classList: {toggle() {}}, children: []}, strip);"
            "return {scenes: sc.length, frames: JSON.stringify(f), shield: shieldF(2, 10), stale: staleServer, bar: document.querySelector('#gledbar').innerHTML};")
    r = _run_page({"readout": {"levels": _FULL}}, tail)
    assert r["scenes"] == 0 and r["shield"] is None and "undefined" not in r["frames"]
    assert r["stale"] is True and "Restart it" in r["bar"] and "undefined" not in r["bar"]


def test_the_default_table_is_labelled_not_warned_about():
    r = _run_page({"palette": _PAL, "readout": {"fallback_levels": _FULL}},
                  "buildSceneBar(); return document.querySelector('#gledbar').innerHTML;")
    assert "MC default (no bundle)" in r and "Restart it" not in r
