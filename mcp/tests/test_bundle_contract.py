"""S15: guard the FrameBundle boundary, the one that actually runs a match.

`test_ui_contract.py` guards the MC console. The **phone** consumes a different contract entirely --
the `FrameBundle` the compiler builds -- and reads it in ~57 places in `app/src/engine.js` against
zero mirrored declarations. A key the compiler renames or drops therefore fails as `undefined` in
someone's hand mid-match rather than in CI.

Raised by brx-sound on 2026-09-07 while closing an unrelated contract failure, and it proved itself
the same hour: their two new keys (`sir_pool`, `hit_audio`) were declared in the A17 amendment row
and in `types.py`, but NOT in the §3 FrameBundle block. **An amendment row is not a declaration.**
The drift this catches happens on the way IN, not only on renames.

Directions, deliberately asymmetric (brx-sound's advice, and it is right):

* compiler → spec is an **error**. If the compiler ships a key, both `types.py` and `contracts.md`
  §3 must name it, or nobody reviewing the wire can know it exists.
* engine → compiler is a **warning**. The engine tolerates older bundles on purpose: `_pickTable`
  returns `[]` with no `sir_pool`, an absent `pset_pool` means the head's `$PSET` stands. Those
  graceful-degradation paths read keys a minimal compile legitimately does not emit, so failing on
  them would flag the opposite of a bug.

No pytest: plain test_* functions, run by run_tests.py under the system python.
"""
from __future__ import annotations

import ast
import pathlib
import re

from _skip import Skipped

REPO = pathlib.Path(__file__).resolve().parents[2]
COMPILE = REPO / "mcp" / "brx_mcp" / "mc" / "compile.py"
TYPES = REPO / "mcp" / "brx_mcp" / "mc" / "types.py"
CONTRACTS = REPO / "docs" / "spec" / "contracts.md"
ENGINE = REPO / "app" / "src" / "engine.js"


def _read(p: pathlib.Path) -> str:
    if not p.exists():
        raise Skipped(str(p))
    return p.read_text(encoding="utf-8")


def emitted_keys() -> set[str]:
    """Top-level keys `compile()` puts on the bundle: the literal, plus later `bundle["x"] =`."""
    src = _read(COMPILE)
    lit = re.search(r"bundle: FrameBundle = \{(.*?)\n        \}", src, re.S)
    if not lit:
        raise Skipped("the `bundle: FrameBundle = {` literal moved; update this test")
    keys = set(re.findall(r'"([a-z_][a-z0-9_]*)":', lit.group(1)))
    # `bundle["cues"]["team_led"]` contributes "cues" only -- the first subscript is the top-level key
    keys |= set(re.findall(r'bundle\["([a-z_][a-z0-9_]*)"\]', src))
    return keys


def typed_keys() -> set[str]:
    tree = ast.parse(_read(TYPES))
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "FrameBundle":
            return {s.target.id for s in node.body if isinstance(s, ast.AnnAssign)}
    raise Skipped("no FrameBundle TypedDict in types.py")


def spec_keys() -> set[str]:
    """Top-level keys of the `FrameBundle { … }` block in contracts.md §3 (depth 0 only)."""
    md = _read(CONTRACTS)
    marker = "FrameBundle {"
    if marker not in md:
        raise Skipped("no FrameBundle block in contracts.md")
    body, depth = "", 0
    for ch in md[md.index(marker) + len(marker):]:
        if ch == "{":
            depth += 1
        elif ch == "}":
            if depth == 0:
                break
            depth -= 1
        if depth == 0:                      # skip nested shapes (cues{…}, leds{…})
            body += ch
    body = re.sub(r"//[^\n]*", "", body)    # comments carry prose, not keys
    # lookahead so a shared comma cannot swallow the next key ("config_id, player_id,")
    return set(re.findall(r"(?:^|,|\n)\s*([a-z_][a-z0-9_]*)\s*\??\s*(?=[:,\n])", body))


def test_every_compiled_bundle_key_is_declared_in_types():
    missing = sorted(emitted_keys() - typed_keys())
    assert not missing, (
        f"compile.py puts {missing} on the bundle but types.py's FrameBundle does not declare them; "
        "the node reads this contract and nothing else tells it the key exists"
    )


def test_every_compiled_bundle_key_is_declared_in_the_spec():
    """The case that actually happened: declared in the amendment row, absent from §3."""
    missing = sorted(emitted_keys() - spec_keys())
    assert not missing, (
        f"compile.py ships {missing} on the bundle but docs/spec/contracts.md §3 does not name them. "
        "An amendment row is not a declaration: add the key to the FrameBundle block so the wire is "
        "reviewable (this is exactly how sir_pool/hit_audio drifted in on 2026-09-07)"
    )


def test_the_spec_and_the_types_agree_on_the_bundle():
    """Neither is allowed to grow a key the other has never heard of."""
    spec, typed = spec_keys(), typed_keys()
    assert not sorted(spec - typed), f"contracts.md §3 names {sorted(spec - typed)}, absent from types.py FrameBundle"
    assert not sorted(typed - spec), f"types.py FrameBundle declares {sorted(typed - spec)}, absent from contracts.md §3"


def test_engine_bundle_reads_are_emitted_by_the_compiler():
    """WARNING direction. Reported, never failed: the engine tolerates older bundles on purpose."""
    src = _read(ENGINE)
    read = set(re.findall(r"\bframes\s*\.\s*([a-z_][a-z0-9_]*)", src))
    read |= set(re.findall(r"\bframes\s*\[\s*['\"]([a-z_][a-z0-9_]*)['\"]", src))
    # `frames.length`, `frames.map(...)` and friends are JS on the value, not keys of the contract
    JS_BUILTINS = {"length", "map", "filter", "slice", "concat", "join", "push", "indexOf", "includes",
                   "forEach", "find", "some", "every", "constructor", "hasOwnProperty", "toString"}
    unknown = sorted(read - emitted_keys() - JS_BUILTINS)
    if unknown:
        print(f"    note (S15, not a failure): engine.js reads bundle keys the compiler never emits: "
              f"{unknown} — fine if each is a graceful-degradation path, a bug if one is a typo")
    # the assertion is only that the scan still finds the boundary at all; a rename that emptied it
    # would otherwise make this step pass by looking at nothing
    assert read, "found no `frames.<key>` reads in engine.js — the scan broke, not the engine"
