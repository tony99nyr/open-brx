"""F325: `respawn.gate` survives `PUT /api/config` (it used to be dropped silently), and a bad value is refused.

Run: python3 run_tests.py mc_respawn_gate
"""
from brx_mcp.mc.fakes import FakeArmory, FakeCompiler, FakeNet, demo_armory
from brx_mcp.mc.state import Session


def _s():
    return Session(FakeCompiler(), FakeNet(), FakeArmory(demo_armory()))


def test_the_presence_gate_is_kept_and_reaches_the_phones_brief():
    s = _s()
    s.set_config({"respawn": {"type": "scanner", "delay_s": 10, "gate": "presence"}})
    assert s.config["respawn"]["gate"] == "presence"
    assert s.game_brief()["respawn"]["gate"] == "presence", "the node reads it from the brief"


def test_an_absent_or_null_gate_leaves_the_nodes_default():
    s = _s()
    s.set_config({"respawn": {"type": "scanner", "delay_s": 10, "gate": "presence"}})
    s.set_config({"respawn": {"type": "scanner", "delay_s": 10, "gate": None}})
    assert "gate" not in s.config["respawn"]


def test_a_bad_gate_is_refused():
    s = _s()
    try:
        s.set_config({"respawn": {"type": "scanner", "delay_s": 10, "gate": "proximity"}})
        raise AssertionError("accepted an unknown gate")
    except ValueError as e:
        assert "respawn.gate" in str(e)


def test_a_non_scanner_respawn_drops_the_gate():
    s = _s()
    s.set_config({"respawn": {"type": "scanner", "delay_s": 10, "gate": "presence"}})
    s.set_config({"respawn": {"type": "auto", "delay_s": 10}})
    assert "gate" not in s.config["respawn"], "the gate is scanner-only"
