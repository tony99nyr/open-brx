"""The two UI weapon/perk catalogs are GENERATED — this fails when either drifts from the server.

2026-09-12 doc-rot review (Tony's D5). `webapp/mc/src/mock/data.ts` and `app/src/demo-catalog.js` each
hold a copy of the weapon catalog under a "GENERATED from weapons.json" banner, written by a script
nobody checked in, so in practice they were hand-maintained and both had drifted: the mock showed the
assault rifle at 384 reserve / 39 rof against a shipped 192 / 54, and the mode blurbs trailed
`mc/state.py`. The demo IS where the arsenal gets learned, so a wrong number there teaches a wrong gun.

The PERK arrays were the same story a layer down (polish pass, 2026-09-12): each file carried a
hand-typed copy of `perks.json` OUTSIDE the markers, and `body_armor`'s blurb read differently in all
three places. They are spliced from `PerkCatalog.all()` now, so the demo perk is the served perk.

`mcp/tools/gen_ui_catalog.py` is now that script, and this test runs it in memory.

Run: python3 run_tests.py ui_catalog
"""
from __future__ import annotations

import ast
import importlib.util
import pathlib
import re

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
        # 2026-09-17 (arsenal review): 8 more weapons joined melee as `hidden`, so the visible arsenal
        # is 13 rows now (9 primaries + 2 sidearms + 2 pickup_only-but-catalogue-visible heavies), not
        # the pre-cut 21+.
        assert text.count('"weapon_id"') >= 13, f"{path.name} has only {text.count(chr(34) + 'weapon_id' + chr(34))} weapons"


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


def test_the_generated_perks_are_the_shipped_ones():
    """The perk blurb the player reads in the demo is the one `GET /api/perks` serves.

    Pin the TEXT, not just the ids: three copies of `body_armor` with three different descriptions is
    what this block replaced, and only a text assertion catches that coming back.
    """
    import json
    raw = json.loads((REPO / "mcp" / "brx_mcp" / "mc" / "perks.json").read_text(encoding="utf-8"))
    visible = [p for p in raw["perks"] if not p.get("hidden")]
    hidden = [p for p in raw["perks"] if p.get("hidden")]
    assert visible and hidden, "perks.json no longer has both a visible and a hidden row to tell apart"
    for path, text in _render().items():
        assert "GENERATED-START perks" in text, f"{path.name} has no generated perk block"
        block = text[text.index("GENERATED-START perks"):text.index("GENERATED-END perks")]
        for p in visible:
            assert f'"perk_id": "{p["perk_id"]}"' in block, f"{path.name} lost perk {p['perk_id']}"
            assert json.dumps(p["desc"], ensure_ascii=False) in block, (
                f"{path.name}'s {p['perk_id']} text is not perks.json's — run `{COMMAND}`")
        for p in hidden:
            assert f'"perk_id": "{p["perk_id"]}"' not in block, (
                f"{path.name} publishes the hidden perk {p['perk_id']}; the server does not")


def test_no_perk_array_survives_outside_the_markers():
    """The defect itself: a second, hand-typed perk list somewhere else in the file. Only the generated
    block may declare one, or the copies drift apart again."""
    for path in (REPO / "webapp" / "mc" / "src" / "mock" / "data.ts", REPO / "app" / "src" / "demo-catalog.js"):
        if not path.is_file():
            raise Skipped(f"{path.relative_to(REPO)} is missing")
        text = path.read_text(encoding="utf-8")
        assert "GENERATED-START perks" in text, f"{path.relative_to(REPO)} has no perk markers"
        outside = text[:text.index("GENERATED-START perks")] + text[text.index("GENERATED-END perks"):]
        assert "perk_id:" not in outside and '"perk_id"' not in outside, (
            f"{path.relative_to(REPO)} declares perk rows outside the generated block — move them inside "
            f"the markers and run `{COMMAND}`")


def test_the_missing_marker_error_does_not_kill_the_suite():
    """`_splice` used to raise SystemExit, which `run_tests.py` (catching Exception) would not catch: one
    renamed marker took the whole suite down instead of failing one test."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("gen_ui_catalog_probe", GENERATOR)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except ImportError as e:
        raise Skipped(f"gen_ui_catalog imports: {e}")
    try:
        mod._splice("no markers here", "perks", "block", pathlib.Path("probe.ts"))
    except RuntimeError as e:
        assert "markers" in str(e)
        return
    except SystemExit:
        raise AssertionError("_splice still raises SystemExit — run_tests.py catches only Exception, so a "
                             "missing marker would abort the suite instead of failing this test")
    raise AssertionError("_splice accepted text with no markers at all")


# 2026-09-17 (DRY drift): `data.ts`'s `MODES` scoring/respawn defaults are a hand-kept copy of
# `state.py`'s `MODES`, and FFA drifted silently to a 15 frag limit against a served 25. Neither file
# is generated (the mock's `base()`/`defaults: base(...)` shape does not fit `gen_ui_catalog.py`'s
# splice-a-block approach), so this reads both sources as text and pins the numbers directly.

def _server_modes() -> dict[str, dict]:
    """`state.py`'s `MODES` list, read as a Python literal rather than imported — the mock's tsc/vitest
    gate has no reason to import the MC package, and this stays a plain-text read like the rest of
    this file's checks."""
    text = (REPO / "mcp" / "brx_mcp" / "mc" / "state.py").read_text(encoding="utf-8")
    anchor = "MODES: list[ModeRow] = ["
    start = text.index(anchor) + len(anchor) - 1     # the anchor string's own trailing "["
    depth, end = 0, None
    for i in range(start, len(text)):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    assert end is not None, "MODES list in state.py has no closing bracket — did its shape change?"
    modes = ast.literal_eval(text[start:end])
    return {m["mode"]: m for m in modes}


def _paren_span(text: str, open_idx: int) -> int:
    """The index one past the `)` that closes the `(` at `open_idx`."""
    depth = 0
    for i in range(open_idx, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i + 1
    raise AssertionError("unbalanced parens in data.ts's MODES array")


_RESPAWN_RE = re.compile(r"respawn:\s*\{\s*type:\s*'(\w+)',\s*delay_s:\s*([\d.]+)\s*\}")
_SCORING_RE = re.compile(r"scoring:\s*\{\s*frag_limit:\s*(null|\d+),\s*win_by:\s*'(\w+)'\s*\}")


def _mock_mode_defaults() -> dict[str, dict]:
    """`data.ts`'s `MODES` array: each row is `base(mode, overrides?)`, and an override only appears
    when that mode disagrees with `base()`'s own respawn/scoring defaults — so a mode with no
    `respawn`/`scoring` override inherits `base()`'s, exactly as `{...base_obj, ...over}` does at
    runtime."""
    path = REPO / "webapp" / "mc" / "src" / "mock" / "data.ts"
    text = path.read_text(encoding="utf-8")

    base_src = text[text.index("const base = ("):text.index("const KOTH_PARAMS")]
    base_respawn, base_scoring = _RESPAWN_RE.search(base_src), _SCORING_RE.search(base_src)
    assert base_respawn and base_scoring, "base()'s own respawn/scoring shape changed — update this parser"
    base_defaults = {
        "respawn": {"type": base_respawn.group(1), "delay_s": float(base_respawn.group(2))},
        "frag_limit": None if base_scoring.group(1) == "null" else int(base_scoring.group(1)),
        "win_by": base_scoring.group(2),
    }

    modes_src = text[text.index("export const MODES: ModeInfo[] = ["):text.index("// guns:")]
    out: dict[str, dict] = {}
    for m in re.finditer(r"MODE_TEXT\.(\w+),", modes_src):
        mode = m.group(1)
        call_idx = modes_src.index(f"base('{mode}'", m.end())
        call_end = _paren_span(modes_src, modes_src.index("(", call_idx))
        call_src = modes_src[call_idx:call_end]
        respawn, scoring = _RESPAWN_RE.search(call_src), _SCORING_RE.search(call_src)
        out[mode] = {
            "respawn": ({"type": respawn.group(1), "delay_s": float(respawn.group(2))}
                        if respawn else base_defaults["respawn"]),
            "frag_limit": ((None if scoring.group(1) == "null" else int(scoring.group(1)))
                           if scoring else base_defaults["frag_limit"]),
            "win_by": scoring.group(2) if scoring else base_defaults["win_by"],
        }
    return out


def test_mock_mode_defaults_match_the_server():
    """The console mock's `frag_limit`/`win_by`/`respawn` per mode are a hand-kept copy of `state.py`'s
    `MODES`, and FFA drifted to a 15 frag limit against the server's 25 (2026-09-17). Pin every mode's
    numbers against the source of truth so the demo never teaches a wrong rule."""
    server = _server_modes()
    mock = _mock_mode_defaults()
    mismatches = []
    for mode, row in server.items():
        got = mock.get(mode)
        assert got is not None, f"data.ts's MODES has no entry for {mode!r}"
        want = {"frag_limit": row["frag_limit"], "win_by": row["win_by"],
                "respawn": {"type": row["respawn"]["type"], "delay_s": float(row["respawn"]["delay_s"])}}
        if got != want:
            mismatches.append(f"{mode}: data.ts has {got}, state.py has {want}")
    assert not mismatches, "the mock's mode defaults drifted from state.py:\n" + "\n".join(mismatches)
