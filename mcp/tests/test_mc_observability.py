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


def _beat(net, clock, ps, **k):
    net.simulate_status("node0", {"player_id": ps[0]["player_id"], "arm_state": "kitted", **k}, clock["t"])


def _row(s):
    return next(n for n in s.snapshot()["nodes"] if n["node_id"] == "node0")


def test_o6_the_chip_means_lost_this_match_not_lost_ever():
    s, net, clock, ps = mk()
    online(s, net, clock, ps[0], 0)
    _beat(net, clock, ps, dropped_total=0)
    assert "outbox_lost" not in _row(s)
    _beat(net, clock, ps, dropped_total=7)            # lost during the match in play (the baseline was set at 0)
    assert _row(s)["outbox_lost"] == 7
    s._loss_baseline()                                # the next match starts (start / resume / NEXT MATCH / new session)
    _beat(net, clock, ps, dropped_total=7)
    assert "outbox_lost" not in _row(s), "a carry-over from the last match shows no chip"
    _beat(net, clock, ps, dropped_total=9)
    assert _row(s)["outbox_lost"] == 2
    _beat(net, clock, ps, dropped_total=0)            # the phone's storage was reset: its count restarted
    assert "outbox_lost" not in _row(s)
    _beat(net, clock, ps, dropped_total=5)            # ...and 5 new losses show as 5, not masked by the old high-water mark
    assert _row(s)["outbox_lost"] == 5


def test_o6_a_first_report_before_any_match_is_not_this_matchs_loss():
    s, net, clock, ps = mk()
    online(s, net, clock, ps[0], 0)
    _beat(net, clock, ps, dropped_total=40)           # a phone that lost facts long before MC was told: nothing in play
    assert "outbox_lost" not in _row(s)
    _beat(net, clock, ps, dropped_total=41)
    assert _row(s)["outbox_lost"] == 1


def test_o10_dropped_claims_are_per_match_and_say_where_to_look():
    s, net, clock, ps = mk()
    net.simulate_status("stick-1", {"arm_state": "connected", "role": "utility", "kind": "powerup", "station_id": 4, "actions_dropped": 0}, clock["t"])
    stick = lambda: next(v for v in s.stations_view() if v["node_id"] == "stick-1")
    assert not any("CLAIM REPORT" in a for a in stick()["attention"])
    net.simulate_status("stick-1", {"arm_state": "connected", "role": "utility", "kind": "powerup", "station_id": 4, "actions_dropped": 3}, clock["t"])
    assert "3 CLAIM REPORTS DROPPED BY THE STICK: CHECK THE RECAP'S PICKUPS FOR STATION #4" in stick()["attention"]
    s._loss_baseline()
    assert not any("CLAIM REPORT" in a for a in stick()["attention"]), "a carry-over from the last match shows no line"
    net.simulate_status("stick-1", {"arm_state": "connected", "role": "utility", "kind": "powerup", "station_id": 4, "actions_dropped": 0}, clock["t"])   # reboot
    net.simulate_status("stick-1", {"arm_state": "connected", "role": "utility", "kind": "powerup", "station_id": 4, "actions_dropped": 1}, clock["t"])
    assert any(a.startswith("1 CLAIM REPORT DROPPED") for a in stick()["attention"])


def test_o7_a_failing_archive_row_is_the_red_store_kind(caplog):
    s, net, clock, ps = mk()
    class Store:
        def log(self, *a, **k): pass
        def match_started(self, *a, **k): raise OSError("database is locked")
        def match_ended(self, *a, **k): raise OSError("disk I/O error")
    s.store = Store()
    s._archive("match_ended", "m", {})
    ns = s.snapshot()["not_saving"]
    assert "store" in ns and "disk I/O error" in ns["store"]["error"]
    s.store.match_ended = lambda *a, **k: None
    s._archive("match_ended", "m", {})
    assert "not_saving" not in s.snapshot()


def test_o8_a_later_join_info_success_clears_the_chip():
    s, net, clock, ps = mk()
    real = net.join_info
    def bad(): raise RuntimeError("no interface")
    net.join_info = bad
    assert s.refresh_join_info(net) is False and "join_error" in s.snapshot()
    net.join_info = real
    assert s.refresh_join_info(net) is True and "join_error" not in s.snapshot()


def test_o6_a_player_card_with_lost_facts_reads_amber_not_ready():
    s, net, clock, ps = mk()
    online(s, net, clock, ps[0], 0)
    _beat(net, clock, ps, dropped_total=0, preflight={"gun_linked": True, "screen_on": True, "foreground": True, "phone_batt": 90})
    row = lambda: next(r for r in s.readiness()["board"] if r["player_id"] == ps[0]["player_id"])
    before = [a for a in row()["ambers"] if "OUTBOX" in a]
    assert before == []
    _beat(net, clock, ps, dropped_total=2, preflight={"gun_linked": True, "screen_on": True, "foreground": True, "phone_batt": 90})
    assert "2 FACTS LOST FROM THE PHONE OUTBOX: CHECK THIS PLAYER'S RECAP BY HAND" in row()["ambers"]
    assert row()["status"] in ("amber", "red")        # never green READY while facts are missing
    assert not any("OUTBOX" in b for b in row()["blockers"])   # and it never blocks START
