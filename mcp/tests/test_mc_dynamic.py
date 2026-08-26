"""Config changes after a finished match roll the session forward instead of erroring."""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pytest
from test_mc_state import mk


def test_set_config_in_recap_rolls_session():
    s, net, clock, ps = mk()
    s.phase = "recap"
    old_sid = s.session_id
    s.set_config({"mode": "ffa"})
    assert s.phase == "build"      # rolled forward, operator lands on mode select
    assert s.session_id != old_sid
    assert s.config["mode"] == "ffa"
    assert len(s.players) == 2          # roster kept


def test_set_config_mid_match_still_blocked():
    s, net, clock, ps = mk()
    s.phase = "live"
    with pytest.raises(ValueError):
        s.set_config({"mode": "ffa"})
