"""F271: ``ack_config.gun_config`` proves the gun took identity, team and pool maxima.

The field is additive/optional so an older phone remains compatible.  When a current phone does
make the claim, Mission Control compares it with the head it actually pushed, paints a mismatch
red, and refuses START (including host override).

Run: python3 run_tests.py mc_query_readback
"""
from copy import deepcopy

from brx_mcp.mc.compile import Compiler
from test_mc_config_proof import ack, mk, online, row


def _expected_from_pushed_head(s, pid):
    """Independent fixture reader: the expected literal values in MC's emitted head."""
    head = s.bundles[pid]["head"]
    pset = next(frame.split(",") for frame in head if frame.startswith("$PSET,"))
    team = int(pset[2])
    for frame in head:
        parts = frame.split(",")
        if frame.startswith("$PSET,"):
            team = int(parts[2])
        elif frame.startswith("$TID,"):
            team = int(parts[1])
    return {
        "player_id": int(pset[1]),
        "team": team,
        "hp": int(pset[3]),
        "armor": int(pset[4]),
        "shield": int(pset[5]),
    }


def _ack_with_config(net, s, pid, gun_config):
    net.simulate_node_message(
        "node0",
        "ack_config",
        {
            "config_id": s.config["config_id"],
            "ok": True,
            "gun_echo": "$LCD,0,0,0,0,0,0,*",
            "gun_config": gun_config,
        },
        s.now_ms(),
    )


def _pushed_one_player():
    s, net, clock, ps = mk(1, compiler=Compiler())
    online(s, net, clock, ps[0], 0)
    s.push_config()
    return s, net, clock, ps, ps[0]["player_id"]


def test_matching_gun_config_is_preserved_in_the_ack_and_allows_start():
    s, net, _clock, _ps, pid = _pushed_one_player()
    expected = _expected_from_pushed_head(s, pid)

    _ack_with_config(net, s, pid, expected)

    assert s.acks[pid]["gun_config"] == expected
    assert row(s, pid)["status"] == "green", row(s, pid)
    s.start(runway_s=10)
    assert s.phase == "armed"


def test_missing_gun_config_is_compatible_with_an_older_phone_and_makes_no_claim():
    s, net, _clock, _ps, pid = _pushed_one_player()

    ack(net, s, 0, pid, echo="$LCD,0,0,0,0,0,0,*")

    assert "gun_config" not in s.acks[pid]
    assert not any("READ-BACK" in b or "GUN CONFIG" in b for b in row(s, pid)["blockers"])
    s.start(runway_s=10)
    assert s.phase == "armed"


def test_any_query_readback_mismatch_is_red_and_refuses_start_even_with_force():
    cases = [
        ("player_id", 0),    # wire id 0 is the F80 failure: hits score for nobody
        ("team", 0),         # F206: the gun silently drops enemy hits as friendly
        ("hp", 44),
        ("armor", 69),
        ("shield", 1),
    ]
    for field, wrong in cases:
        for force in (False, True):
            s, net, _clock, _ps, pid = _pushed_one_player()
            expected = _expected_from_pushed_head(s, pid)
            got = deepcopy(expected)
            got[field] = wrong

            _ack_with_config(net, s, pid, got)

            readiness = row(s, pid)
            assert readiness["status"] == "red", (field, force, readiness)
            fault = next(
                (b for b in readiness["blockers"] if "READ-BACK" in b or "GUN CONFIG" in b),
                None,
            )
            assert fault is not None, (field, force, readiness["blockers"])
            assert field.upper() in fault.upper(), fault
            assert str(wrong) in fault and str(expected[field]) in fault, fault

            try:
                s.start(runway_s=10, force=force)
                raise AssertionError(f"start(force={force}) accepted a {field} read-back mismatch")
            except ValueError as exc:
                message = str(exc).lower()
                assert "read-back" in message or "gun config" in message or "re-push" in message, message
            assert s.phase == "lobby"


def test_a_stale_ack_owns_the_row_instead_of_also_claiming_a_readback_mismatch():
    s, net, _clock, _ps, pid = _pushed_one_player()
    old_id = s.config["config_id"]
    old_expected = _expected_from_pushed_head(s, pid)
    s.set_config({"time_limit_s": 120})

    net.simulate_node_message(
        "node0",
        "ack_config",
        {
            "config_id": old_id,
            "ok": True,
            "gun_echo": "$LCD,0,0,0,0,0,0,*",
            "gun_config": old_expected,
        },
        s.now_ms(),
    )

    blockers = row(s, pid)["blockers"]
    assert sum("OLDER CONFIG" in b for b in blockers) == 1, blockers
    assert not any("READ-BACK" in b or "GUN CONFIG" in b for b in blockers), blockers
