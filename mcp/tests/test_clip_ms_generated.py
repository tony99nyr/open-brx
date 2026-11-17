"""The phone's clip-length table (`app/src/clipms.gen.js`) matches its generator (A8, maintainability review 2026-10-03).

`CLIP_MS` in `app/src/announcer.js` was a hand-kept copy of 87 catalogue lengths; `announcer.test.mjs` checked each row,
but nothing added the row a new cue needed, so an unlisted clip ran on the 2.5 s default. It is now generated from
`mcp/brx_mcp/data/sound_catalog.json` by `mcp/tools/gen_clip_ms.py`, the same in-memory-render-vs-disk pattern as
`test_contract_generated.py`. Freshness is test_generated_fresh.py's job; this file keeps the content tests.

Run: python3 run_tests.py clip_ms_generated
"""
from __future__ import annotations

import json
import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[2]
JS_OUT = REPO / "app" / "src" / "clipms.gen.js"
CATALOG = REPO / "mcp" / "brx_mcp" / "data" / "sound_catalog.json"


def _on_disk_rows() -> dict[str, int]:
    js = JS_OUT.read_text(encoding="utf-8")
    body = re.search(r"export const CLIP_MS = \{(.*?)\n\};", js, re.S)
    assert body, "no CLIP_MS table in the generated file"
    return {k.strip("'"): int(v) for k, v in re.findall(r"('[^']+'|[A-Za-z_$][\w$]*): (\d+)", body.group(1))}


def test_every_on_gun_sound_has_its_catalogue_length():
    """A floor under the freshness test: an empty render and an empty file would otherwise agree. F463: every on-gun id
    with a length has a row, so no clip the gun holds runs on the 2.5 s default."""
    rows = _on_disk_rows()
    sounds = json.loads(CATALOG.read_text(encoding="utf-8"))["sounds"]
    on_gun = {s["id"]: s["duration_s"] for s in sounds
              if s.get("on_gun") and isinstance(s.get("duration_s"), (int, float)) and s["duration_s"] > 0}
    assert set(rows) == set(on_gun), sorted(set(rows) ^ set(on_gun))[:10]
    for sid, ms in rows.items():
        assert ms == int(on_gun[sid] * 1000 + 0.5), sid
    # the four hill lines and the tick, which the node's literal fallbacks time by; F463's stun clip and victory sting
    assert (rows["VB0N"], rows["VB0P"], rows["VB0O"], rows["VB0Q"], rows["U100"]) == (1924, 2976, 2078, 2424, 114)
    assert (rows["X17"], rows["VSF"]) == (7883, 1860), (rows["X17"], rows["VSF"])
