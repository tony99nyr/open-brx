"""A3: every constant `GunStage` mirrors from the phone's JS equals the JS value, in the stage's units.

The stage exists to PREDICT `app/src/engine.js`. UNITS: the JS runs on `Date.now()` (ms); the stage runs on
`time.monotonic` (SECONDS), so a `*_MS` constant is a `*_S` float here. One table row per mirrored constant:
(stage name, JS file, JS name, divisor). A divisor of 1000 is the ms-to-s conversion, 1 is a plain copy.

A second test fails when a stage constant that has a JS counterpart is missing from the table, so a new mirror
cannot go unchecked. A constant that is deliberately not mirrored goes in NOT_MIRRORED with its reason.
"""
from __future__ import annotations

import ast
import pathlib
import re

from brx_mcp.mc.types import PLAY_QUEUE_STALE_MS
from brx_mcp.stage import stage as S

_REPO = pathlib.Path(__file__).resolve().parents[2]
_SRC = _REPO / "app" / "src"
_STAGE_PY = pathlib.Path(S.__file__)

# (stage name, JS file under app/src, JS name, divisor)
# Seams review 2026-10-10 #3: the engine tunables (51 of them) moved into the contract (`mc/types.py`, "Engine tunables"),
# which app/src reads as generated names and the stage imports. A moved name has no row here: the contract is its one
# copy, `app/test/contract-copies.test.mjs` bans a JS redeclaration and `test_contract_copies_python_cpp.py` bans a
# Python restatement of a string or table. What stays is what the contract cannot own:
TABLE = [
    # wire frames that other modules also spell (modes/driver.py, gameconfig.py END_SEQUENCE, play-queue.js, brxlink.js)
    ("SFLASH", "engine.js", "SFLASH", 1),
    ("PLAYX", "engine.js", "PLAYX", 1),
    ("PARSER_RESET", "engine.js", "PARSER_RESET", 1),
    # a boolean: gen_contract.py exports no booleans
    ("SPAWN_SHIELD_FULL", "engine.js", "SPAWN_SHIELD_FULL", 1),
]

# Stage constants deliberately absent from the table, each with the reason.
NOT_MIRRORED = {
    # F478: announcer.js keeps it as one field of `ANNOUNCE_TTL_MS` (an object, not a literal this table can read);
    # test_stage_hp_mirror.py pins it against that field.
    "STATUS_TTL_MS": "announcer.js ANNOUNCE_TTL_MS.status, pinned in test_stage_hp_mirror.py",
    "FILLER_IDS": "the contract's PLAY_FILLER_IDS (seams D), which engine.js `_write` reads; pinned in test_stage_hp_mirror.py",
    "BEACON_DEDUPE_S": "the contract's BEACON_DEDUPE_MS in seconds (seams D), pinned in test_stage.py",
    "HILL_CUES": "a dict, pinned cue by cue in test_stage.py",
    "HILL_AUDIO_EXCLUDED_MODES": "a Set, pinned in test_stage.py",
    "IR_CALLOUT": "an object literal in engine.js (`IR_CALLOUT`), pinned key by key in test_stage_ammo_ports.py",
}


def _js_value(file: str, name: str):
    """The literal behind `const NAME = ...` (or `, NAME = ...` in a comma list) in an app/src file."""
    text = (_SRC / file).read_text(encoding="utf-8")
    pat = (rf"(?:\bconst\s+|,\s*)(?:export\s+)?{re.escape(name)}\s*=\s*"
           r"('[^']*'|\"[^\"]*\"|-?\d+(?:\.\d+)?|true|false)\s*[,;]")
    m = re.search(pat, text)
    if not m:
        return None
    raw = m.group(1)
    if raw in ("true", "false"):
        return raw == "true"
    if raw[0] in "'\"":
        return raw[1:-1]
    return float(raw) if "." in raw else int(raw)


def _mismatch(stage_name, js_file, js_name, divisor):
    """None when the stage constant equals the JS one in the stage's units, else a message naming both values."""
    js = _js_value(js_file, js_name)
    if js is None:
        return f"{js_file} no longer defines a literal {js_name} (stage.{stage_name} mirrors it)"
    want = js / divisor if divisor != 1 and not isinstance(js, bool) else js
    got = getattr(S, stage_name)
    if isinstance(want, bool) or isinstance(got, bool):
        ok = got is want
    elif isinstance(want, (int, float)):
        ok = abs(got - want) < 1e-9
    else:
        ok = got == want
    if ok:
        return None
    return (f"stage.{stage_name} = {got!r} but {js_file} {js_name} = {js!r}"
            f"{f' (/{divisor} = {want!r})' if divisor != 1 else ''}")


def test_stage_constants_match_the_engine():
    bad = [m for row in TABLE if (m := _mismatch(*row))]
    assert not bad, "stage constants drifted from the engine:\n  " + "\n  ".join(bad)


def test_every_stage_constant_with_a_js_counterpart_is_in_the_table():
    """A new mirror must get a row. A stage constant counts as a mirror when its line cites a `.js` file, or when
    its name (with `_S` read as `_MS`) is a literal constant in engine.js or announcer.js."""
    src = _STAGE_PY.read_text(encoding="utf-8")
    lines = src.splitlines()
    tabled = {r[0] for r in TABLE}
    missing = []
    for node in ast.parse(src).body:
        if not isinstance(node, ast.Assign):
            continue
        try:
            ast.literal_eval(node.value)
        except ValueError:
            continue   # derived from an import (a contract name, `X_MS / 1000`): the contract is the copy, nothing to pin
        names = [n.id for t in node.targets for n in ([t] if isinstance(t, ast.Name) else getattr(t, "elts", []))
                 if isinstance(n, ast.Name)]
        cites_js = bool(re.search(r"\b\w+\.js\b", lines[node.lineno - 1]))
        for name in names:
            if name.startswith("_") or name in tabled or name in NOT_MIRRORED:
                continue
            cands = [name] + ([name[:-2] + "_MS"] if name.endswith("_S") else [])
            has_twin = any(_js_value(f, c) is not None for f in ("engine.js", "announcer.js") for c in cands)
            if cites_js or has_twin:
                missing.append(name)
    assert not missing, (f"stage constants that mirror a JS constant but have no row in TABLE: {missing}. "
                         "Add a row, or list the name in NOT_MIRRORED with a reason.")


def test_every_table_row_names_a_real_stage_constant_and_not_twice():
    names = [r[0] for r in TABLE]
    assert len(names) == len(set(names)), "a stage constant has two rows"
    assert not [n for n in names if not hasattr(S, n)], "a row names a stage constant that does not exist"
    assert not [n for n in NOT_MIRRORED if not hasattr(S, n)], "NOT_MIRRORED names a missing constant"


def test_the_life_burst_hold_cap_matches_the_engine():
    """F493: engine.js LIFE_BURST_HOLD_MAX_MS is an expression (PLAY_QUEUE_STALE_MS + 2000), so the TABLE's literal reader
    cannot pin it, and the stage keeps it on the class (`GunStage.LIFE_BURST_HOLD_MAX_S`)."""
    js = (_SRC / "engine.js").read_text(encoding="utf-8")
    m = re.search(r"export const LIFE_BURST_HOLD_MAX_MS = PLAY_QUEUE_STALE_MS \+ (\d+);", js)
    assert m, "engine.js LIFE_BURST_HOLD_MAX_MS changed shape: re-pin it here"
    want_ms = PLAY_QUEUE_STALE_MS + int(m.group(1))
    assert abs(S.GunStage.LIFE_BURST_HOLD_MAX_S * 1000 - want_ms) < 1e-9, (S.GunStage.LIFE_BURST_HOLD_MAX_S, want_ms)
