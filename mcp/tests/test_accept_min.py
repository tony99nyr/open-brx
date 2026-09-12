"""ACCEPT_MIN — the A24 exception to strict required-field validation, pinned end to end.

`envelope.validate(env, direction=...)` picks its required-field table by direction:
`direction="node"` (MC receiving a node frame) always checks the full `REQUIRED[kind]`; a node is
never forgiven a missing field. `direction="mc"` (a node receiving an MC frame) checks
`ACCEPT_MIN.get(kind, REQUIRED[kind])` instead — for the one kind currently listed, `result`, a body
missing everything but `match_id` still reaches the node/engine rather than being dropped silently
as `missing_field` (A24, contract-dry-spec.md §3).

This file pins: the override actually softens `direction="mc"` decoding; `ACCEPT_MIN`'s own
invariants (its keys are a subset of `MC_KINDS`, and what it accepts is a subset of what
`REQUIRED` promises — a typo'd/over-broad entry must fail here, not miss silently); and that
`MockNode` (the stage/mock node, which decodes with `direction="mc"` — mock_node.py ~line 263/284)
accepts the same minimal `result` a real phone accepts, so the stage does not diverge from the
phone (spec §3, "the stage/mock node must accept exactly what the phone accepts").

Run: python3 run_tests.py accept_min
"""
from __future__ import annotations

from brx_mcp.mc import envelope as E
from brx_mcp.mc.mock_node import MockNode
from brx_mcp.mc.types import MC_KINDS


def _minimal_result_env() -> dict:
    return E.make_envelope("result", {"match_id": "m-accept-min"})


def test_a_minimal_result_decodes_for_the_node_direction():
    """The A24 guarantee itself: direction='mc' (a node decoding an MC frame) accepts a `result`
    body carrying only `match_id`."""
    env = _minimal_result_env()
    got = E.decode(E.encode(env), direction="mc")
    assert got["body"] == {"match_id": "m-accept-min"}


def test_the_same_short_body_fails_required_s_full_strictness():
    """`direction='node'` (MC receiving) is never forgiven — it always checks the full `REQUIRED`
    table, never `ACCEPT_MIN`. `result` is an MC->node-only kind (not in NODE_KINDS), so a literal
    `E.decode(..., direction="node")` never reaches the missing-field check at all: the kind
    allowlist rejects it first as `unknown_kind`. That IS direction='node' strictness working
    (a node has no business emitting a `result`), so assert that; then separately prove the
    field-level claim ACCEPT_MIN exists to relax — REQUIRED['result'] demands strictly more than
    ACCEPT_MIN — by checking the tables directly, since no real kind lets both branches of
    validate()'s required-field `if` be driven through one shared kind."""
    env = _minimal_result_env()
    try:
        E.decode(E.encode(env), direction="node")
    except E.EnvelopeError as e:
        assert e.reason == "unknown_kind", (
            f"expected 'result' to be refused as unknown_kind under direction='node' "
            f"(it is not a NODE_KINDS member), got {e.reason!r}")
    else:
        raise AssertionError("direction='node' accepted a result envelope — result must be MC-only")
    body = {"match_id": "m-accept-min"}
    missing_under_full_required = [k for k in E.REQUIRED["result"] if k not in body]
    assert missing_under_full_required, (
        "REQUIRED['result'] must demand more than match_id, or ACCEPT_MIN softens nothing")


def test_accept_min_keys_are_mc_kinds():
    assert set(E.ACCEPT_MIN) <= MC_KINDS, (
        f"ACCEPT_MIN names a kind MC never sends: {set(E.ACCEPT_MIN) - MC_KINDS} "
        f"(a typo'd key would otherwise miss silently)")


def test_accept_min_fields_are_a_subset_of_required():
    for kind, fields in E.ACCEPT_MIN.items():
        extra = set(fields) - set(E.REQUIRED[kind])
        assert not extra, (
            f"ACCEPT_MIN[{kind!r}] claims {sorted(extra)}, which REQUIRED[{kind!r}] does not even "
            f"promise the sender sends — the override cannot accept MORE than the sender promises")


def test_mock_node_accepts_the_same_minimal_result_the_phone_accepts():
    """mock_node.py decodes with direction='mc' (lines ~263, ~284) without ever opening a socket to
    do so, so this drives that exact call + the dict-only `_handle()` path directly."""
    node = MockNode("ws://example.invalid/ws", node_id="accept-min-probe")
    env = E.decode(E.encode(_minimal_result_env()), direction="mc")
    before = len(node.received)
    node._handle(env)
    assert len(node.received) == before + 1
    assert node.received[-1]["body"] == {"match_id": "m-accept-min"}
