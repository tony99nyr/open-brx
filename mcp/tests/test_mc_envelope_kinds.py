"""Every kind MC actually pushes must survive the wire — the guard for a whole class of silent drop.

WHY. `alert` was defined in `docs/spec/contracts.md` (§ the MC->node table, A11.4) and sent by
`state.py`, but was missing from `types.MC_KINDS`. `envelope.validate()` rejects any kind not in that
set, so every `alert` MC sent was refused by the decoder at the node -- `lead_taken`,
`next_kill_wins`, `last_survivor`, `infected` and every objective/extraction alert never reached a
HUD, while MC counted them as delivered. A shipped feature, dead end to end, with a green suite.

WHY THE SUITE MISSED IT. The MC-side tests assert on `FakeNet.pushed`, which records the call and
performs NO validation; the app-side tests call `engine.onMcMessage` directly. Both sides were
tested and the WIRE BETWEEN THEM was not. So this file tests the seam itself, and does it
GENERATIVELY -- it reads the kinds out of `state.py` rather than listing them, so the next kind
someone adds and forgets to register fails here instead of going silently missing in a match.
"""
import ast
import pathlib

from brx_mcp.mc import envelope as E
from brx_mcp.mc import types as T

STATE_PY = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp" / "mc" / "state.py"


def pushed_kinds() -> set[str]:
    """Every literal kind passed to `self.net.push(node_id, KIND, body)` in state.py."""
    tree = ast.parse(STATE_PY.read_text())
    out = set()
    for n in ast.walk(tree):
        if not isinstance(n, ast.Call):
            continue
        f = n.func
        if isinstance(f, ast.Attribute) and f.attr == "push" and len(n.args) >= 2:
            k = n.args[1]
            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                out.add(k.value)
    return out


def test_the_scan_actually_finds_the_push_sites():
    """A generative test that finds nothing passes vacuously. Pin the floor."""
    kinds = pushed_kinds()
    assert len(kinds) >= 8, f"only found {len(kinds)} pushed kinds ({sorted(kinds)}) — the AST scan is broken"
    assert "assign" in kinds and "config" in kinds, f"expected the core kinds in {sorted(kinds)}"


def test_every_kind_mc_pushes_is_registered_in_MC_KINDS():
    """The bug that motivated this file: `alert` was sent but never registered, so the decoder
    rejected it and the node dropped it silently."""
    missing = sorted(pushed_kinds() - T.MC_KINDS)
    assert not missing, (
        f"state.py pushes {missing} but types.MC_KINDS does not list them, so envelope.validate() "
        f"rejects them at the node and the message is silently dropped. Add them to MC_KINDS.")


# Values that satisfy the codec's per-kind type checks; anything else gets a harmless placeholder.
_SAMPLE = {"frames": ["$VOL,80,*"], "cmd": "end", "events": [], "roster": [], "config": {},
           "ok": True, "ready": True, "last": True, "synced": True, "open": True, "t": 1_700_000_000_000}


def _body_for(kind: str) -> dict:
    """A minimal VALID body for `kind`, built from the codec's own required-field table.

    Derived rather than hand-written, so a new required field automatically shows up here instead of
    silently making this test assert less than it looks like it does."""
    return {k: _SAMPLE.get(k, 1 if k.endswith(("_t", "_s", "seq", "seq_hi", "bytes", "lines")) else k)
            for k in E.REQUIRED[kind]}


def test_every_kind_mc_pushes_survives_a_real_encode_decode_round_trip():
    """MC_KINDS membership is necessary but not sufficient — this drives the actual codec, which is
    what the node runs."""
    for kind in sorted(pushed_kinds()):
        env = E.make_envelope(kind, _body_for(kind))
        try:
            got = E.decode(E.encode(env), direction="mc")
        except Exception as e:                                   # noqa: BLE001 — report which kind
            raise AssertionError(f"kind {kind!r} does not survive the MC->node wire: {e}") from None
        assert got["kind"] == kind, f"round trip changed the kind: {kind!r} -> {got['kind']!r}"


def test_every_registered_kind_has_a_required_field_entry():
    """`validate()` does a BARE `REQUIRED[kind]` lookup, so a kind registered in MC_KINDS/NODE_KINDS
    with no entry here raises a raw KeyError instead of a clean EnvelopeError — the caller sees a
    crash rather than a rejected frame. Registering `alert` hit exactly this on the way in."""
    missing = sorted((T.MC_KINDS | T.NODE_KINDS) - set(E.REQUIRED))
    assert not missing, (
        f"these kinds are registered but have no REQUIRED entry, so validate() will raise KeyError "
        f"instead of EnvelopeError: {missing}")


def test_the_decoder_still_rejects_a_kind_nobody_defined():
    """The guard above is only meaningful if validation actually rejects unknown kinds."""
    env = E.make_envelope("assign", {})
    env["kind"] = "not_a_real_kind"
    try:
        E.decode(E.encode(env), direction="mc")
    except E.EnvelopeError as e:
        assert e.reason == "unknown_kind", f"expected unknown_kind, got {e.reason!r}"
    else:
        raise AssertionError("the decoder accepted a kind that does not exist")


def test_node_and_mc_kind_sets_do_not_overlap_by_accident():
    """The two directions are separate vocabularies; a kind in both would make `direction` meaningless.
    `apply` is the known, deliberate exception (envelope.py:161 unions it into the MC direction)."""
    both = (T.NODE_KINDS & T.MC_KINDS) - {"apply"}
    assert not both, f"these kinds are in both directions: {sorted(both)}"


# --- the fallback compiler must not disagree with the real one --------------- #

def test_the_fallback_compiler_does_not_play_the_victory_sting_at_every_game_over():
    """`FakeCompiler` is a RUNTIME FALLBACK, not a test stub: `__main__.build()` selects it whenever
    the real compiler raises on import. Until 2026-09-07 its `game_over` cue was byte-identical to
    the real compiler's VICTORY frame, and it carried no `victory` key at all — so every `--demo`
    run and every fallback game played the victory sting to everyone at the whistle, losers included.

    Pinned as an inequality plus a key check rather than a literal, so it keeps holding if either
    sound id is later re-pinned by ear."""
    from brx_mcp.mc.compile import Compiler
    from brx_mcp.mc.fakes import FakeCompiler
    real, fake = Compiler().cues("male"), FakeCompiler().cues("male")
    assert fake["game_over"] != real["victory"], (
        "the fallback compiler files the VICTORY frame under game_over — everyone hears the win sting")
    assert "victory" in fake, "the fallback compiler has no victory cue at all"
    assert fake["victory"] == real["victory"], "victory should be the same frame in both compilers"
    assert fake["game_over"] == "$PLAY,,4,6,VA33,,,,*", "game_over should be the neutral line the real bundle ships"
