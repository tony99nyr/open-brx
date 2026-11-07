"""A88 (brx5 and brx4, 2026-11-07): the phones relay each Domination hill's own tally to MC as a persisted `hill_tally`
fact. This file pins the contract: MC's socket takes the fact and refuses one without its required fields.

Run: python3 run_tests.py mc_hill_tally
"""
from _session import mc_session
from brx_mcp.mc.envelope import EnvelopeError, validate_event

_sess = mc_session


def _tally(**over):
    return {"type": "hill_tally", "t": 1_800_000_000_000, "match_id": "m1", "node_id": "n1", "player_id": "p1",
            "site": "1", "game_byte": 3, "own_s": {"0": 40, "1": 12}, "final": True, "partial": False,
            "heard_age_ms": 900, **over}


def test_the_socket_takes_a_hill_tally_and_refuses_one_missing_a_required_field():
    assert validate_event(_tally())["type"] == "hill_tally"
    validate_event({k: v for k, v in _tally().items() if k not in ("partial", "heard_age_ms")})   # both optional
    for key in ("site", "game_byte", "own_s", "final"):
        try:
            validate_event({k: v for k, v in _tally().items() if k != key})
        except EnvelopeError as e:
            assert key in str(e), (key, e)
        else:
            raise AssertionError(f"a hill_tally without {key} was accepted")
