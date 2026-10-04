"""O6/O7/O8/O10: failures MC used to swallow are counted, logged once, and put on the snapshot."""
import logging, pathlib, sys, tempfile
from contextlib import contextmanager
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from _session import mk_session, online, T0


class _BrokenStore:
    def __init__(self): self.fail = True; self.rows = 0
    def log(self, *a, **k):
        if self.fail: raise OSError(28, "No space left on device")
        self.rows += 1


class _Records(logging.Handler):
    """Collects the `brx.mc` log records (run_tests.py has no pytest `caplog`)."""
    def __init__(self):
        super().__init__(logging.INFO)
        self.records = []

    def emit(self, record):
        self.records.append(record)


@contextmanager
def _capture():
    h, lg = _Records(), logging.getLogger("brx.mc")
    old = lg.level
    lg.addHandler(h)
    lg.setLevel(logging.INFO)
    try:
        yield h
    finally:
        lg.removeHandler(h)
        lg.setLevel(old)


def logged(fn):
    """Run `fn(log)` with the `brx.mc` records collected (no pytest fixture: run_tests.py has none)."""
    def run():
        with _capture() as h:
            fn(h)
    run.__name__ = fn.__name__
    return run


def _errors(h):
    return [r for r in h.records if r.levelno >= logging.ERROR]


@logged
def test_o7_a_store_that_raises_sets_not_saving_and_logs_once_not_per_envelope(caplog):
    s, net, clock, ps = mk_session()
    s.store = _BrokenStore()
    assert "not_saving" not in s.snapshot()
    if True:
        for i in range(50):
            s._log("n", "event", {"t": i}, clock["t"])
    ns = s.snapshot()["not_saving"]
    assert set(ns) == {"store"} and ns["store"]["count"] == 50 and ns["store"]["since"] == T0
    assert "No space left" in ns["store"]["error"]
    assert len(_errors(caplog)) == 1                      # one traceback, not fifty
    clock["t"] += 61_000
    if True:
        s._log("n", "event", {"t": 99}, clock["t"])
    assert len(_errors(caplog)) == 2 and "51 failures" in _errors(caplog)[1].getMessage()
    s.store.fail = False                                  # the next success clears it
    s._log("n", "event", {"t": 100}, clock["t"])
    assert "not_saving" not in s.snapshot()


@logged
def test_o7_a_snapshot_that_cannot_be_written_is_the_snapshot_part_only(caplog):
    tmp_dir = tempfile.TemporaryDirectory()
    tmp_path = pathlib.Path(tmp_dir.name)
    s, net, clock, ps = mk_session()
    blocker = tmp_path / "blocker"                  # a FILE where the snapshot's folder should be: the write cannot
    blocker.write_text("x")                         # succeed (atomic_write_text creates a missing folder, but not this)
    s._persist_path = blocker / "session.json"
    s._persist_last = 0.0
    if True:
        s._persist()
    ns = s.snapshot()["not_saving"]
    assert set(ns) == {"snapshot"} and ns["snapshot"]["count"] == 1
    blocker.unlink(); blocker.mkdir(); s._persist_last = 0.0
    s._persist()
    assert "not_saving" not in s.snapshot()


@logged
def test_o8_a_tick_that_raises_three_times_sets_ticker_failing_and_writes_one_error_line(caplog):
    try:
        from brx_mcp.mc.api import Broadcaster      # needs starlette: skips cleanly under the bare system python
    except ImportError:
        return
    s, net, clock, ps = mk_session()
    b = Broadcaster(s)
    def boom(): raise RuntimeError("bad tick")
    s.tick = boom
    if True:
        for _ in range(3): b.tick_once()
    tf = s.snapshot()["ticker_failing"]
    assert tf["count"] == 3 and tf["since"] == T0 and "bad tick" in tf["error"]
    assert len(_errors(caplog)) == 1
    s.tick = lambda: None
    b.tick_once()
    assert "ticker_failing" not in s.snapshot()


@logged
def test_o8_a_join_info_that_raises_is_logged_with_the_url_and_exposed(caplog):
    s, net, clock, ps = mk_session()
    def bad(): raise RuntimeError("no interface")
    net.join_info = bad
    if True:
        s._attach_net()
    je = s.snapshot()["join_error"]
    assert "no interface" in je["error"] and je["ws_url"] == s.lan.get("ws_url", "")
    assert any("join_info failed" in r.getMessage() for r in _errors(caplog))


def _beat(net, clock, ps, lost=None, **k):
    body = {"player_id": ps[0]["player_id"], "arm_state": "kitted", **k}
    if lost is not None:
        body["outbox_lost"] = {"match_id": lost[0], "n": lost[1]}
    net.simulate_status("node0", body, clock["t"])


def _row(s):
    return next(n for n in s.snapshot()["nodes"] if n["node_id"] == "node0")


def _arm(s, net, clock, ps, mid="m-now"):
    """Put the session in a started match `mid` (the scoped counts compare a report's match_id with this)."""
    s.start_info = {"match_id": mid, "go_live_t": clock["t"], "seq": 1, "countdown_s": 0}
    s.phase = "live"


def test_o6_a_loss_shows_only_against_the_current_match():
    s, net, clock, ps = mk_session()
    online(s, net, clock, ps[0], 0)
    _arm(s, net, clock, ps)
    _beat(net, clock, ps, lost=("m-old", 30))           # a hot-joiner: 30 drops from ANOTHER match
    assert "outbox_lost" not in _row(s)
    _beat(net, clock, ps, lost=("m-now", 0))
    assert "outbox_lost" not in _row(s)
    _beat(net, clock, ps, lost=("m-now", 7))
    assert _row(s)["outbox_lost"] == 7
    _beat(net, clock, ps, lost=("m-now", 3))            # a phone whose storage was reset restarts at 0: the 7 already lost stay
    assert _row(s)["outbox_lost"] == 7
    _beat(net, clock, ps, lost=("m-now", 9))
    assert _row(s)["outbox_lost"] == 9
    s.start_info = {"match_id": "m-next", "go_live_t": clock["t"], "seq": 2, "countdown_s": 0}   # the next match: the old match's count is history
    assert "outbox_lost" not in _row(s)


def test_o6_a_resume_shows_losses_reported_after_the_restart():
    from _session import fresh_mc_with_phones_in
    from _session import resume_status
    s, net, clock, ps, _ = fresh_mc_with_phones_in(2, [None, None])
    resume_status(net, clock, 0, "live", "m-old", outbox_lost={"match_id": "m-old", "n": 12})    # lost during the outage
    resume_status(net, clock, 1, "live", "m-old", outbox_lost={"match_id": "m-old", "n": 0})
    s.adopt_orphan("m-old")
    assert s.phase == "live"
    row = next(n for n in s.snapshot()["nodes"] if n["node_id"] == "node0")
    assert row["outbox_lost"] == 12                     # the adopted match's outage losses are not hidden
    resume_status(net, clock, 0, "live", "m-old", outbox_lost={"match_id": "m-old", "n": 15})
    assert next(n for n in s.snapshot()["nodes"] if n["node_id"] == "node0")["outbox_lost"] == 15


def test_o6_a_malformed_loss_report_is_ignored():
    s, net, clock, ps = mk_session()
    online(s, net, clock, ps[0], 0)
    _arm(s, net, clock, ps)
    _beat(net, clock, ps, lost=("m-now", 4))
    assert _row(s)["outbox_lost"] == 4
    net.simulate_status("node0", {"player_id": ps[0]["player_id"], "arm_state": "kitted", "outbox_lost": {"match_id": 5, "n": "x"}}, clock["t"])
    assert _row(s)["outbox_lost"] == 4                  # junk changes nothing


def test_o10_dropped_claims_are_scoped_to_the_game_and_say_where_to_look():
    s, net, clock, ps = mk_session()
    base = {"arm_state": "connected", "role": "utility", "kind": "powerup", "station_id": 4}
    game = s._game_byte()
    net.simulate_status("stick-1", {**base, "actions_dropped": 0, "actions_dropped_game": game}, clock["t"])
    stick = lambda: next(v for v in s.stations_view() if v["node_id"] == "stick-1")
    assert not any("CLAIM REPORT" in a for a in stick()["attention"])
    net.simulate_status("stick-1", {**base, "actions_dropped": 3, "actions_dropped_game": game}, clock["t"])
    assert "3 CLAIM REPORTS DROPPED BY THE STICK: CHECK THE RECAP'S PICKUPS FOR STATION #4" in stick()["attention"]
    net.simulate_status("stick-1", {**base, "actions_dropped": 0, "actions_dropped_game": game}, clock["t"])   # rebooted in the SAME game
    assert any(a.startswith("3 CLAIM REPORTS DROPPED") for a in stick()["attention"]), "a reboot does not erase the loss"
    net.simulate_status("stick-1", {**base, "actions_dropped": 5, "actions_dropped_game": game}, clock["t"])
    assert any(a.startswith("5 CLAIM REPORTS DROPPED") for a in stick()["attention"])
    net.simulate_status("stick-1", {**base, "actions_dropped": 3, "actions_dropped_game": game + 1}, clock["t"])   # armed for another game
    assert not any("CLAIM REPORT" in a for a in stick()["attention"]), "a count from another game is history"


def test_o10_a_match_start_clears_stored_stick_counts_so_a_wrapped_game_byte_never_shows_a_stale_one():
    s, net, clock, ps = mk_session()
    base = {"arm_state": "connected", "role": "utility", "kind": "powerup", "station_id": 4}
    game = s._game_byte()
    net.simulate_status("stick-1", {**base, "actions_dropped": 3, "actions_dropped_game": game}, clock["t"])
    stick = lambda: next(v for v in s.stations_view() if v["node_id"] == "stick-1")
    assert any("CLAIM REPORT" in a for a in stick()["attention"])
    s._clear_claims()                                     # what every match start / resume / adopt / arm does
    assert not any("CLAIM REPORT" in a for a in stick()["attention"])


def test_o7_the_archive_has_its_own_red_kind_that_only_an_archive_write_clears():
    s, net, clock, ps = mk_session()
    class Store:
        started_fails = True
        def log(self, *a, **k): pass
        def match_started(self, *a, **k):
            if self.started_fails: raise OSError("database is locked")
        def match_ended(self, *a, **k): return 0          # the match has no row: the result was NOT kept
    s.store = Store()
    s._archive("match_started", "m", {}, 1)
    assert set(s.snapshot()["not_saving"]) == {"archive"}
    s._log("n", "event", {"t": 1}, clock["t"])            # store.log succeeds: it must NOT clear the archive failure
    assert "archive" in s.snapshot()["not_saving"]
    s.store.started_fails = False
    s._archive("match_started", "m", {}, 1)
    assert "not_saving" not in s.snapshot()
    s._archive("match_ended", "m", {})                    # END updates 0 rows
    ns = s.snapshot()["not_saving"]
    assert "archive" in ns and "no row" in ns["archive"]["error"]
    s.store.match_ended = lambda *a, **k: 1               # a later successful write of THAT match's row clears it
    s._archive("match_ended", "m", {})
    assert "not_saving" not in s.snapshot()


def test_o7_another_matchs_archive_write_does_not_clear_a_missing_row():
    s, net, clock, ps = mk_session()
    class Store:
        def log(self, *a, **k): pass
        def match_started(self, *a, **k): pass
        def match_ended(self, mid, *a, **k): return 0 if mid == "A" else 1
    s.store = Store()
    s._archive("match_ended", "A", {})                    # match A ended with 0 rows
    s._archive("match_started", "B", {}, 1)               # match B started and archived fine
    s._archive("match_ended", "B", {})
    assert "archive" in s.snapshot()["not_saving"], "A's missing result still stands"
    s.store.match_ended = lambda *a, **k: 1
    s._archive("match_ended", "A", {})
    assert "not_saving" not in s.snapshot()


def test_o7_match_ended_reports_rows_updated():
    from brx_mcp.mc.store import Store
    with tempfile.TemporaryDirectory() as d:
        st = Store("s", pathlib.Path(d) / "s.sqlite")
        try:
            assert st.match_ended("never-started", {}) == 0
            st.match_started("m1", {}, 1)
            assert st.match_ended("m1", {}) == 1
        finally:
            st.close()


def test_o8_a_later_join_info_success_clears_the_chip():
    s, net, clock, ps = mk_session()
    real = net.join_info
    def bad(): raise RuntimeError("no interface")
    net.join_info = bad
    assert s.refresh_join_info(net) is False and "join_error" in s.snapshot()
    net.join_info = real
    assert s.refresh_join_info(net) is True and "join_error" not in s.snapshot()


def test_o6_a_player_card_with_lost_facts_reads_amber_not_ready():
    s, net, clock, ps = mk_session()
    online(s, net, clock, ps[0], 0)
    _arm(s, net, clock, ps)
    pf = {"gun_linked": True, "screen_on": True, "foreground": True, "phone_batt": 90}
    _beat(net, clock, ps, lost=("m-now", 0), preflight=pf)
    row = lambda: next(r for r in s.readiness()["board"] if r["player_id"] == ps[0]["player_id"])
    before = [a for a in row()["ambers"] if "OUTBOX" in a]
    assert before == []
    _beat(net, clock, ps, lost=("m-now", 2), preflight=pf)
    assert "2 FACTS LOST FROM THE PHONE OUTBOX: CHECK THIS PLAYER'S RECAP BY HAND" in row()["ambers"]
    assert row()["status"] in ("amber", "red")        # never green READY while facts are missing
    assert not any("OUTBOX" in b for b in row()["blockers"])   # and it never blocks START


def test_o7_an_end_with_no_row_recreates_it_and_clears_the_chip():
    s, net, clock, ps = mk_session()
    class Store:
        def __init__(self): self.rows = set(); self.start_fails = True; self.recreate_fails = False
        def log(self, *a, **k): pass
        def match_started(self, mid, *a, **k):
            if self.start_fails: raise OSError("database is locked")
            self.rows.add(mid)
        def match_ended(self, mid, *a, **k): return 1 if mid in self.rows else 0
        def has_match(self, mid): return mid in self.rows
    st = s.store = Store()
    s._archive("match_started", "m", {}, 1)                 # fails once, never retried by MC
    assert "archive" in s.snapshot()["not_saving"]
    st.start_fails = False
    s._archive("match_ended", "m", {})                      # END updates 0 rows -> re-create the row, write again
    assert "not_saving" not in s.snapshot() and "m" in st.rows
    # if the re-create also fails the chip stands
    st.start_fails = True
    s._archive("match_ended", "n", {})
    assert "archive" in s.snapshot()["not_saving"]
    # new_session keeps a failure whose row is still missing, and prunes one whose row exists
    s.new_session()
    assert "archive" in s.snapshot()["not_saving"]
    st.rows.add("n")
    s.new_session()
    assert "not_saving" not in s.snapshot()
