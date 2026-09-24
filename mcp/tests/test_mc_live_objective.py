"""Visual QA 2026-09-23 (lane B1): what the LIVE snapshot gives the board.

H2: a KOTH match is won on possession, and LIVE headlined the kill score because the live view carried
no possession at all. `LiveView.possession` is the same merged tally the recap already carries
(`Scorer.possession()`), absent until a node reports one. Nothing about how it is scored changes.

H3: a row MC has never heard in this process carries `sync_age_ms == NEVER_SEEN_MS`, a sentinel the
console must not print as an age. It is a named constant now, so both ends read the same number.

Run: python3 run_tests.py mc_live_objective
"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from test_mc_pool_stale import _status
from test_mc_state import mk, online
from brx_mcp.mc.types import NEVER_SEEN_MS, STALE_AFTER_MS


def _live(mode="koth", n=2, heard=None):
    """A session walked to LIVE. `heard` = the indexes whose node came online (default: all)."""
    s, net, clock, ps = mk(n)
    s.set_config({"mode": mode, "time_limit_s": 600})
    ids = [t["team_id"] for t in s.config["teams"]]
    for i, p in enumerate(ps):
        s.patch_player(p["player_id"], team_id=ids[i % len(ids)])
    heard = range(n) if heard is None else heard
    for i in heard:
        online(s, net, clock, ps[i], i)
    s.push_config(force=True)
    s.start(force=True)
    clock["t"] = s.start_info["go_live_t"] + 10
    s.tick()
    for i in heard:
        _status(net, clock, i, ps[i], arm_state="live")
    assert s.phase == "live", s.phase
    return s, net, clock, ps


def _poss(s, clock, hold_ms, observed_ms):
    return {"type": "possession", "match_id": s.scorer.match_id, "t": clock["t"], "site": "A",
            "hold_ms": hold_ms, "observed_ms": observed_ms}


def test_the_live_view_carries_possession_once_a_node_reports_it():
    s, net, clock, ps = _live()
    assert "possession" not in s.snapshot()["live"], "absent until a node reports possession"
    blue, green = s.config["teams"][0], s.config["teams"][1]
    net.simulate_event("node0", {**_poss(s, clock, {str(blue["tid"]): 214_000, str(green["tid"]): 131_000}, 441_000),
                                 "node_id": "node0", "player_id": ps[0]["player_id"]}, clock["t"], seq=1)
    lv = s.snapshot()["live"]
    assert lv["possession"]["by_team"] == {blue["team_id"]: 214, green["team_id"]: 131}, lv["possession"]
    assert lv["possession"]["observed_s"] == 441 and lv["possession"]["of_s"] == 600
    # CONTROL: the KILL score is unchanged by possession, and it is still what `score` carries
    assert lv["score"] == s.scorer.team_scores()
    # and it is the same tally the recap and the winner read
    assert lv["possession"] == s.scorer.possession()


def test_a_kill_scored_match_never_carries_possession():
    s, net, clock, ps = _live(mode="tdm")
    assert "possession" not in s.snapshot()["live"]


def test_a_row_never_heard_carries_the_named_sentinel():
    s, net, clock, ps = _live(mode="tdm", heard=[0])
    rows = {r["player_id"]: r for r in s.snapshot()["live"]["rows"]}
    assert rows[ps[1]["player_id"]]["sync_age_ms"] == NEVER_SEEN_MS
    assert rows[ps[1]["player_id"]]["status"] == "stale"
    # CONTROL: the heard row carries a real age, well under the stale line
    assert rows[ps[0]["player_id"]]["sync_age_ms"] < STALE_AFTER_MS
    assert NEVER_SEEN_MS == 10**9, "the UI's copy of this number is generated from types.py"
