"""The two UI weapon catalogs are GENERATED — this fails when either drifts from the server.

2026-09-12 doc-rot review (Tony's D5). `webapp/mc/src/mock/data.ts` and `app/src/demo-catalog.js` each
hold a copy of the weapon catalog under a "GENERATED from weapons.json" banner, written by a script
nobody checked in, so in practice they were hand-maintained and both had drifted: the mock showed the
assault rifle at 384 reserve / 39 rof against a shipped 192 / 54, and the mode blurbs trailed
`mc/state.py`. The demo IS where the arsenal gets learned, so a wrong number there teaches a wrong gun.

`mcp/tools/gen_ui_catalog.py` is now that script, and this test runs it in memory.

Run: python3 run_tests.py ui_catalog
"""
from __future__ import annotations

import importlib.util
import pathlib

from _skip import Skipped

REPO = pathlib.Path(__file__).resolve().parents[2]
GENERATOR = REPO / "mcp" / "tools" / "gen_ui_catalog.py"
COMMAND = "python3 mcp/tools/gen_ui_catalog.py"


def _render() -> dict[pathlib.Path, str]:
    if not GENERATOR.is_file():
        raise Skipped(f"{GENERATOR.relative_to(REPO)} is missing")
    spec = importlib.util.spec_from_file_location("gen_ui_catalog", GENERATOR)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
        return mod.render()
    except Skipped:
        raise
    except ImportError as e:                    # the MC package needs deps system python may lack
        raise Skipped(f"gen_ui_catalog imports: {e}")
    except FileNotFoundError as e:              # a target file was moved or renamed
        raise Skipped(f"gen_ui_catalog source missing: {e}")


def _diff_hint(path: pathlib.Path, want: str, got: str) -> str:
    want_lines, got_lines = want.split("\n"), got.split("\n")
    for i, (a, b) in enumerate(zip(want_lines, got_lines), 1):
        if a != b:
            return f"line {i}\n  generated: {a[:120]}\n  on disk:   {b[:120]}"
    return f"length differs: generated {len(want_lines)} lines, on disk {len(got_lines)}"


def test_the_ui_catalogs_match_the_generator():
    stale = []
    for path, want in _render().items():
        got = path.read_text(encoding="utf-8")
        if got != want:
            stale.append(f"{path.relative_to(REPO)}: {_diff_hint(path, want, got)}")
    assert not stale, (f"a UI catalog is stale — run `{COMMAND}`:\n" + "\n".join(stale))


def test_the_generator_produces_a_real_catalog():
    """The floor: an empty render would match nothing and pass nothing. Both files must come back with
    the whole arsenal in them, and the hidden `melee` row must NOT (the server drops it, so the demo
    must too)."""
    rendered = _render()
    assert len(rendered) == 2, f"the generator no longer emits two files: {list(rendered)}"
    for path, text in rendered.items():
        assert "assault_rifle" in text and "rocket_launcher" in text, f"{path.name} lost the arsenal"
        assert '"weapon_id": "melee"' not in text, f"{path.name} publishes the hidden melee row"
        assert text.count('"weapon_id"') > 15, f"{path.name} has only {text.count(chr(34) + 'weapon_id' + chr(34))} weapons"


def test_the_generated_numbers_are_the_shipped_ones():
    """The drift that started this: the mock's assault rifle disagreed with weapons.json. Pin the
    values from the SOURCE, so this fails if the generator ever stops reading the real catalog."""
    import json
    import sys
    sys.path.insert(0, str(REPO / "mcp"))
    raw = json.loads((REPO / "mcp" / "brx_mcp" / "mc" / "weapons.json").read_text(encoding="utf-8"))
    ar = next(w for w in raw["weapons"] if w["weapon_id"] == "assault_rifle")
    for path, text in _render().items():
        block = text[text.index('"weapon_id": "assault_rifle"'):][:1200]
        assert f'"reserve": {ar["reserve"]}' in block, f"{path.name} does not quote weapons.json reserve"
        assert f'"rpm": {ar["rof"]}' in block, f"{path.name} does not quote weapons.json rof"
