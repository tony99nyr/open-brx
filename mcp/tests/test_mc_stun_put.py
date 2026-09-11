"""F15 / A20: `config.stun` reaches the session through PUT /api/config.

Found on the way (2026-09-11): `Session._CONFIG_KEYS` is the PUT whitelist, and `stun` was not in it, so the
compiler's EMP row was unreachable over MC -- a config could not stun however the operator asked. The whitelist
IGNORES unknown keys rather than refusing them, which is exactly the "absence reports as health" shape (F40).
"""
from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session


def _sess():
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    s.set_config({"mode": "tdm"})
    return s


def test_put_keeps_stun_and_the_compiled_head_carries_the_emp_row():
    s = _sess()
    s.set_config({"stun": {"duration_s": 12}})
    assert s.config.get("stun") == {"duration_s": 12}, "PUT dropped stun"
    guns = [g["gun_id"] for g in s.armory.list()][:1]
    s.add_player("P0", s.config["teams"][0]["team_id"], guns[0], "male")
    p = next(iter(s.players.values()))
    head = s._compile_rolled(p)["head"]
    assert any(f.startswith("$SIR,8,0,,24,") for f in head), head
    # null clears it, and the row leaves with it
    s.set_config({"stun": None})
    assert "stun" not in s.config
    assert not any(f.startswith("$SIR,8,0,,24,") for f in s._compile_rolled(p)["head"])
    # CONTROL: the shape is checked at PUT, in the operator's voice
    try:
        s.set_config({"stun": 10})
        raise AssertionError("a bare number was accepted as stun")
    except ValueError as e:
        assert "stun" in str(e)
    # CONTROL: a config that never mentions stun ships no EMP row (the default is OFF)
    t = _sess()
    t.add_player("P0", t.config["teams"][0]["team_id"], guns[0], "male")
    assert not any(f.startswith("$SIR,8,0,,24,") for f in t._compile_rolled(next(iter(t.players.values())))["head"])
