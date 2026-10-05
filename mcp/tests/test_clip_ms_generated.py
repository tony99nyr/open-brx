"""The phone's clip-length table (`app/src/clipms.gen.js`) matches its generator (A8, maintainability review 2026-10-03).

`CLIP_MS` in `app/src/announcer.js` was a hand-kept copy of 87 catalogue lengths; `announcer.test.mjs` checked each row,
but nothing added the row a new cue needed, so an unlisted clip ran on the 2.5 s default. It is now generated from
`mcp/brx_mcp/data/sound_catalog.json` by `mcp/tools/gen_clip_ms.py`, the same in-memory-render-vs-disk pattern as
`test_contract_generated.py`. Forgetting to regenerate after a catalogue change fails here.

Run: python3 run_tests.py clip_ms_generated
"""
from __future__ import annotations

import importlib.util
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
GENERATOR = REPO / "mcp" / "tools" / "gen_clip_ms.py"
JS_OUT = REPO / "app" / "src" / "clipms.gen.js"
CATALOG = REPO / "mcp" / "brx_mcp" / "data" / "sound_catalog.json"
COMMAND = "python3 mcp/tools/gen_clip_ms.py"


def _load():
    spec = importlib.util.spec_from_file_location("gen_clip_ms", GENERATOR)
    assert spec and spec.loader, f"no generator at {GENERATOR}"
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_the_generated_file_exists():
    assert JS_OUT.is_file(), f"{JS_OUT.relative_to(REPO)} is missing -- run `{COMMAND}`"


def test_the_generated_clip_table_matches_the_generator():
    want = _load().render()
    got = JS_OUT.read_text(encoding="utf-8") if JS_OUT.exists() else "<file is missing>"
    if got != want:
        for i, (a, b) in enumerate(zip(want.split("\n"), got.split("\n")), 1):
            if a != b:
                raise AssertionError(f"{JS_OUT.relative_to(REPO)} is stale -- run `{COMMAND}`\n"
                                     f"line {i}\n  generated: {a[:160]}\n  on disk:   {b[:160]}")
        raise AssertionError(f"{JS_OUT.relative_to(REPO)} is stale -- run `{COMMAND}` (length differs)")


def _on_disk_rows() -> dict[str, int]:
    js = JS_OUT.read_text(encoding="utf-8")
    body = re.search(r"export const CLIP_MS = \{(.*?)\n\};", js, re.S)
    assert body, "no CLIP_MS table in the generated file"
    return {k.strip("'"): int(v) for k, v in re.findall(r"('[^']+'|[A-Za-z_$][\w$]*): (\d+)", body.group(1))}


def test_every_row_is_the_catalogue_length_and_every_golden_bundle_sound_has_one():
    """A floor under the freshness test: an empty render and an empty file would otherwise agree."""
    rows = _on_disk_rows()
    gen = _load()
    sounds = json.loads(CATALOG.read_text(encoding="utf-8"))["sounds"]
    on_gun = {s["id"]: s["duration_s"] for s in sounds if s.get("on_gun")}
    for sid, ms in rows.items():
        assert sid in on_gun, f"{sid} is not on the gun"
        assert ms == int(on_gun[sid] * 1000 + 0.5), sid
    golden = gen._golden_ids(set(on_gun))
    assert len(golden) > 60, "the golden bundle walk found almost nothing"
    assert golden - set(gen.DEFERRED) <= set(rows), sorted(golden - set(gen.DEFERRED) - set(rows))
    assert set(gen.EXTRAS) <= set(rows) and not set(gen.DEFERRED) & set(rows)
    # the four hill lines and the tick, which the node's literal fallbacks time by
    assert (rows["VB0N"], rows["VB0P"], rows["VB0O"], rows["VB0Q"], rows["U100"]) == (1924, 2976, 2078, 2424, 114)

