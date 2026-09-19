"""F279: `protocol.is_pool_probe` must actually be the Python twin of `engine.js`'s `isPoolProbe`,
and every Python reader in `mcp/brx_mcp` must go through it rather than its own `$LIFE` filter.

No pytest: plain test_* functions, run by run_tests.py under the system python.
"""
from __future__ import annotations

import pathlib
import re

from brx_mcp.protocol import is_pool_probe

REPO = pathlib.Path(__file__).resolve().parents[2]
SRC = REPO / "mcp" / "brx_mcp"

_FILTER = re.compile(r"(startswith|startsWith)\(\s*['\"`]\$LIFE")
_PREDICATE = re.compile(r"is_pool_probe|PROBE_LIFE")


def test_is_pool_probe_is_numeric_not_a_literal_string_match():
    """F279 misclassification #1: the predicate tested `t[i] == "0"`, a STRING match, while its JS
    twin tests `Number(t[i]) === 0`, an ARITHMETIC one. The row's own reasoning is arithmetic --
    "an all-zero add moves nothing, always" -- so a differently-spelled zero (`00`, `-0`, a gun's own
    echoed formatting, a hand-typed bench frame) must still read as a probe. Before this fix,
    `$LIFE,00,0,0,*` and `$LIFE,-0,0,0,*` came back `False`: a genuine zero-effect probe would have
    been counted as a real grant by anything using this predicate to tell the two apart."""
    assert is_pool_probe("$LIFE,00,0,0,*") is True, "a leading zero is still zero"
    assert is_pool_probe("$LIFE,-0,0,0,*") is True, "negative zero is still zero"
    assert is_pool_probe("$LIFE,0,00,0,*") is True, "any of the three tokens, not only the first"
    assert is_pool_probe("$LIFE,0,0,-0,*") is True


def test_is_pool_probe_control_shapes():
    """CONTROL, mirroring `engine.test.mjs`'s own assertions on `isPoolProbe` -- the predicate says
    what it claims, so the guards above and the scan below are not pointing at a no-op."""
    assert is_pool_probe("$LIFE,0,0,0,*") is True, "the probe itself"
    assert is_pool_probe("$LIFE,*") is True, "the bare poll form the 2018 app used"
    assert is_pool_probe("$LIFE,,,,*") is True, "empty tokens default to zero, same as absent ones"
    assert is_pool_probe("$LIFE,0,0,10,*") is False, "a shield grant is not a probe"
    assert is_pool_probe("$LIFE,30,0,0,1,*") is False, "nor the revive form -- same word, one token apart"
    assert is_pool_probe("$HP,0,0,0,*") is False, "a different command word entirely"
    assert is_pool_probe(None) is False  # type: ignore[arg-type]


def test_no_life_frame_filter_in_mcp_brx_mcp_skips_the_probe_predicate():
    """F279's own `Do`: "use the predicate everywhere a $LIFE is counted, matched or classified, and
    extend the scan beyond app/ if a second instance appears." `engine.test.mjs` already scans
    `app/src`/`app/test` for a `$LIFE` prefix filter that does not mention `isPoolProbe`/`PROBE_LIFE`;
    this is that scan's Python twin, scoped to the production package (`mcp/brx_mcp`) the row names as
    unguarded. A filter in one function is not the fix -- this scan is, because it fails on a NEW
    `$LIFE` filter that does not go through `is_pool_probe`."""
    files = sorted(SRC.rglob("*.py"))
    assert len(files) >= 20, f"only {len(files)} files scanned -- the scan is wrong, not the tree"
    offenders = []
    for path in files:
        src = path.read_text(encoding="utf8")
        lines = src.split("\n")
        for i, line in enumerate(lines, start=1):
            if not _FILTER.search(line):
                continue
            if _PREDICATE.search(line):
                continue
            if path.name == "protocol.py" and "def is_pool_probe" in src:
                # the predicate's own body must test the word: that is its job
                body_start = src.index("def is_pool_probe")
                body = src[body_start:].split("\n")[:40]
                if line in body:
                    continue
            offenders.append(f"{path.relative_to(REPO)}:{i}: {line.strip()}")
    assert offenders == [], "these count `$LIFE` frames without excluding the probe: " + " | ".join(offenders)
