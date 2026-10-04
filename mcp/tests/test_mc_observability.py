"""O6/O7/O8/O10: failures MC used to swallow are counted, logged once, and put on the snapshot."""
import logging, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from test_mc_state import T0, mk, online
from brx_mcp.mc.api import Broadcaster


class _BrokenStore:
    def __init__(self): self.fail = True; self.rows = 0
    def log(self, *a, **k):
        if self.fail: raise OSError(28, "No space left on device")
        self.rows += 1


def _errors(caplog):
    return [r for r in caplog.records if r.levelno >= logging.ERROR]


def test_o7_a_store_that_raises_sets_not_saving_and_logs_once_not_per_envelope(caplog):
    s, net, clock, ps = mk()
    s.store = _BrokenStore()
    assert "not_saving" not in s.snapshot()
    with caplog.at_level(logging.INFO, logger="brx.mc"):
        for i in range(50):
            s._log("n", "event", {"t": i}, clock["t"])
    ns = s.snapshot()["not_saving"]
    assert set(ns) == {"store"} and ns["store"]["count"] == 50 and ns["store"]["since"] == T0
    assert "No space left" in ns["store"]["error"]
    assert len(_errors(caplog)) == 1                      # one traceback, not fifty
    clock["t"] += 61_000
    with caplog.at_level(logging.INFO, logger="brx.mc"):
        s._log("n", "event", {"t": 99}, clock["t"])
    assert len(_errors(caplog)) == 2 and "51 failures" in _errors(caplog)[1].getMessage()
    s.store.fail = False                                  # the next success clears it
    s._log("n", "event", {"t": 100}, clock["t"])
    assert "not_saving" not in s.snapshot()


def test_o7_a_snapshot_that_cannot_be_written_is_the_snapshot_part_only(tmp_path, caplog):
    s, net, clock, ps = mk()
    s._persist_path = tmp_path / "no-such-dir" / "a" / "session.json"   # tmp.write_text raises
    s._persist_last = 0.0
    with caplog.at_level(logging.INFO, logger="brx.mc"):
        s._persist()
    ns = s.snapshot()["not_saving"]
    assert set(ns) == {"snapshot"} and ns["snapshot"]["count"] == 1
    s._persist_path.parent.mkdir(parents=True); s._persist_last = 0.0
    s._persist()
    assert "not_saving" not in s.snapshot()


def test_o8_a_tick_that_raises_three_times_sets_ticker_failing_and_writes_one_error_line(caplog):
    s, net, clock, ps = mk()
    b = Broadcaster(s)
    def boom(): raise RuntimeError("bad tick")
    s.tick = boom
    with caplog.at_level(logging.INFO, logger="brx.mc"):
        for _ in range(3): b.tick_once()
    tf = s.snapshot()["ticker_failing"]
    assert tf["count"] == 3 and tf["since"] == T0 and "bad tick" in tf["error"]
    assert len(_errors(caplog)) == 1
    s.tick = lambda: None
    b.tick_once()
    assert "ticker_failing" not in s.snapshot()


def test_o8_a_join_info_that_raises_is_logged_with_the_url_and_exposed(caplog):
    s, net, clock, ps = mk()
    def bad(): raise RuntimeError("no interface")
    net.join_info = bad
    with caplog.at_level(logging.INFO, logger="brx.mc"):
        s._attach_net()
    je = s.snapshot()["join_error"]
    assert "no interface" in je["error"] and je["ws_url"] == s.lan.get("ws_url", "")
    assert any("join_info failed" in r.getMessage() for r in _errors(caplog))


def test_o6_o10_the_node_keeps_the_maximum_cumulative_loss_counts():
    s, net, clock, ps = mk()
    online(s, net, clock, ps[0], 0)
    def beat(**k): net.simulate_status("node0", {"player_id": ps[0]["player_id"], "arm_state": "kitted", **k}, clock["t"])
    row = lambda: next(n for n in s.snapshot()["nodes"] if n["node_id"] == "node0")
    assert "outbox_lost" not in row() and "claims_dropped" not in row()
    beat(dropped=2, dropped_total=2)
    beat(dropped=3, dropped_total=5)
    beat()                                    # a beat without the field changes nothing
    beat(dropped_total=1)                     # a restarted phone restarts its own count: the maximum stays
    assert row()["outbox_lost"] == 5
    beat(actions_dropped=3)
    beat(actions_dropped=1)
    assert row()["claims_dropped"] == 3


def test_o10_a_stick_that_dropped_claims_gets_a_station_attention_line():
    s, net, clock, ps = mk()
    net.simulate_status("stick-1", {"arm_state": "connected", "role": "utility", "kind": "powerup", "station_id": 4, "actions_dropped": 3}, clock["t"])
    assert s.nodes["stick-1"]["claims_dropped"] == 3
    st = next(v for v in s.stations_view() if v["node_id"] == "stick-1")
    assert "3 CLAIM REPORTS DROPPED BY THE STICK: CHECK WHO TOOK THE ITEM" in st["attention"]
