"""O3 (operator review 2026-10-03): the match start and end rows went to SQLite inside `except: pass`, and
`match_ended` was an UPDATE that matched zero rows when the start row was missing. A played match could
vanish from RECAP history, the bug report and `diag` with no log line."""
import logging
import tempfile
from pathlib import Path
from unittest import mock

from test_mc_result import go_live

from brx_mcp.mc.store import Store


class _Capture(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.messages = []

    def emit(self, record):
        self.messages.append(record.getMessage())


def _capturing(fn):
    """Run fn() and return the brx.mc log messages it produced (the plain runner has no caplog)."""
    h, lg = _Capture(), logging.getLogger("brx.mc")
    lg.addHandler(h)
    try:
        fn()
    finally:
        lg.removeHandler(h)
    return h.messages


def _tmp_store():
    return Store("o3", Path(tempfile.mkdtemp()) / "s.sqlite")


def test_match_ended_for_a_match_with_no_start_row_still_lands_in_history():
    st = _tmp_store()
    msgs = _capturing(lambda: st.match_ended("m-orphan", {"rows": []}))
    assert [m["match_id"] for m in st.matches()] == ["m-orphan"]
    assert any("m-orphan" in m and "no start row" in m for m in msgs)


def test_match_ended_after_a_start_row_still_updates_it_in_place():
    st = _tmp_store()
    st.match_started("m1", {"mode": "tdm"}, 1000)
    st.match_ended("m1", {"rows": []})
    rows = st.matches()
    assert len(rows) == 1 and rows[0]["go_live_t"] == 1000 and rows[0]["config"] == {"mode": "tdm"}


def test_a_failed_start_row_is_logged_counted_and_the_match_still_reaches_history():
    def boom(self, *a, **k):
        raise RuntimeError("disk I/O error")
    box = {}

    def play():
        with mock.patch.object(Store, "match_started", boom):
            box["g"] = go_live(2)
    msgs = _capturing(play)
    s, net, clock, ps, info = box["g"]
    assert s.store_errors == 1
    assert any("match_started" in m and info["match_id"] in m for m in msgs), \
        "the failure left no log line naming the match"
    assert s.snapshot()["store_errors"] == 1
    s.control("end")
    assert info["match_id"] in [m["match_id"] for m in s.store.matches()], \
        "a match whose start row failed vanished from RECAP history"


def test_a_failed_end_row_is_logged_and_counted():
    s, net, clock, ps, info = go_live(2)
    assert "store_errors" not in s.snapshot()

    def boom(self, *a, **k):
        raise RuntimeError("database is locked")
    with mock.patch.object(Store, "match_ended", boom):
        msgs = _capturing(lambda: s.control("end"))
    assert s.store_errors >= 1
    assert any("match_ended" in m and info["match_id"] in m for m in msgs)


def test_r5_a_failed_late_recap_rewrite_is_counted_too():
    """Review round 5: the late-fact recap re-write (`_restore_recap`) went straight to the store and bypassed
    `_store_write`, so its failure was logged but never counted on the board."""
    s, net, clock, ps, info = go_live(2)
    s.control("end")
    before = s.store_errors

    def boom(self, *a, **k):
        raise RuntimeError("database is locked")
    with mock.patch.object(Store, "match_ended", boom):
        s._restore_recap()
    assert s.store_errors == before + 1
