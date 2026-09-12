"""The wire's kind vocabulary is spelled out in three places — they must not drift.

2026-09-12 doc-rot review. `docs/spec/contracts.md` §5 is the spec of record; `mc/types.py` is what
Mission Control will send; `app/src/transport/contract.gen.js` (generated from types.py + envelope.py,
and what `envelope.js` re-exports and the phone node runs against) is what the phone node will ACCEPT.
A kind missing from the node's set is not a loud error: `validate()` throws `unknown_kind` and the
message is dropped before `onMessage` ever runs, so the feature simply never happens. That has now
bitten twice for real -- `alert` (A11.4, unlisted at the node until 2026-09-07: every alert MC sent
was discarded) and `station_config` (A13.5/F104: MC's arming message for a utility phone, same silent
drop).

`test_mc_envelope_kinds.py` already pins the two CODE sets against each other. What is added here is
the SPEC as the third party, so a kind that exists in both implementations but was never written down
(or written down and never built) is caught too.

Run: python3 run_tests.py contract_kinds
"""
from __future__ import annotations

import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[2]
CONTRACTS = REPO / "docs" / "spec" / "contracts.md"
TYPES_PY = REPO / "mcp" / "brx_mcp" / "mc" / "types.py"
# GENERATED from types.py by mcp/tools/gen_contract.py (contract-dry-spec.md §4); envelope.js
# re-exports these kind sets from here rather than defining them literally.
ENVELOPE_JS = REPO / "app" / "src" / "transport" / "contract.gen.js"

# Kinds specified but not yet built on both sides. EMPTY on 2026-09-12: A24's `result` landed in
# types.py and envelope.js the same day this test was written. An entry here is a dated IOU, not a
# permanent exemption — name the amendment and the date, and delete it when the kind ships.
PENDING: dict[str, str] = {}


def _spec_kinds(header: str) -> list[str]:
    """The first column of the markdown table under a `**Node → MC** (`kind`):` style heading."""
    text = CONTRACTS.read_text(encoding="utf-8")
    assert header in text, f"contracts.md no longer has the {header!r} section"
    out: list[str] = []
    for line in text[text.index(header) + len(header):].split("\n"):
        m = re.match(r"\|\s*`([a-z_]+)`\s*\|", line)
        if m:
            out.append(m.group(1))
        elif out and not line.startswith("|"):
            break
    return out


def _py_set(name: str) -> set[str]:
    text = TYPES_PY.read_text(encoding="utf-8")
    m = re.search(rf"^{name} = \{{(.*?)\}}", text, re.S | re.M)
    assert m, f"{name} not found in {TYPES_PY.name}"
    body = re.sub(r"#[^\n]*", "", m.group(1))          # comments quote OTHER kinds by name
    return set(re.findall(r'"([a-z_]+)"', body))


def _js_set(name: str) -> set[str]:
    text = ENVELOPE_JS.read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = new Set\(\[(.*?)\]\)", text, re.S)
    assert m, f"{name} not found in {ENVELOPE_JS.name}"
    body = "\n".join(re.sub(r"//.*", "", ln) for ln in m.group(1).split("\n"))
    return set(re.findall(r"'([a-z_]+)'", body))


def _compare(direction: str, spec: list[str], py: set[str], js: set[str]) -> None:
    spec_set = set(spec)
    assert len(spec_set) == len(spec), f"contracts.md lists a {direction} kind twice: {spec}"
    problems = []
    for kind in sorted(spec_set):
        if kind in PENDING:
            continue
        where = [n for n, s in (("mc/types.py", py), ("app/src/transport/contract.gen.js", js)) if kind not in s]
        if where:
            problems.append(f"{kind!r} is specified but missing from {' and '.join(where)}")
    for kind in sorted(py - spec_set):
        problems.append(f"{kind!r} is in mc/types.py {direction} but nowhere in contracts.md §5")
    for kind in sorted(js - spec_set):
        problems.append(f"{kind!r} is in contract.gen.js (envelope.js's generated source) {direction} but nowhere in contracts.md §5")
    assert not problems, (
        f"{direction} kind drift (a kind the node does not list is DROPPED as malformed, silently):\n  "
        + "\n  ".join(problems))


def test_mc_to_node_kinds_match_the_spec():
    _compare("MC→node", _spec_kinds("**MC → Node** (`kind`):"), _py_set("MC_KINDS"), _js_set("MC_KINDS"))


def test_node_to_mc_kinds_match_the_spec():
    _compare("node→MC", _spec_kinds("**Node → MC** (`kind`):"), _py_set("NODE_KINDS"), _js_set("NODE_KINDS"))


def test_the_three_sources_actually_parsed():
    """A check whose three parsers all return the empty set agrees with itself perfectly and proves
    nothing. Every table and every literal must yield a plausible number of kinds."""
    counts = {
        "spec MC→node": len(_spec_kinds("**MC → Node** (`kind`):")),
        "spec node→MC": len(_spec_kinds("**Node → MC** (`kind`):")),
        "types.MC_KINDS": len(_py_set("MC_KINDS")),
        "types.NODE_KINDS": len(_py_set("NODE_KINDS")),
        "envelope.MC_KINDS": len(_js_set("MC_KINDS")),
        "envelope.NODE_KINDS": len(_js_set("NODE_KINDS")),
    }
    thin = {k: v for k, v in counts.items() if v < 10}
    assert not thin, f"a kind source stopped parsing: {thin} (all of {counts})"


def test_the_drift_check_can_actually_fail():
    """Provoke it: a spec kind absent from both implementations must be reported, not shrugged off."""
    try:
        _compare("probe", ["welcome", "a_kind_nobody_built"], {"welcome"}, {"welcome"})
    except AssertionError as e:
        assert "a_kind_nobody_built" in str(e) and "types.py" in str(e), str(e)
        return
    raise AssertionError("the drift check passed a kind that exists in neither implementation")
