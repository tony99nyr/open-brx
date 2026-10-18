"""F560 (field 2026-10-17): the last match's `ended_t` was rewritten to "now" on every late fact in RECAP.

`_restore_recap` re-archives the recap whenever a fact lands after the whistle (store-and-forward flushes, possession
tallies), and `Store.match_ended` stamped `ended_t` with the wall clock each time. A 838 s match read 6705 s by the
time MC stopped. `ended_t` is now the scorer's own end time, and a later write never moves it to "now".
"""
from _session import go_live_stored, kill, scorer_of


def _ended_row(s, mid):
    return s.store.db.execute("SELECT go_live_t, ended_t FROM matches WHERE match_id=?", (mid,)).fetchone()


def test_a_late_fact_in_recap_does_not_move_the_stored_end_time():
    s, net, clock, ps, info = go_live_stored(2, "ffa", {"scoring": {"frag_limit": 1, "win_by": "kills"}})
    kill(s, net, clock, ps, 0, 1, info, seq=1)
    assert s.phase == "recap"
    end_t = scorer_of(s).end_t
    go, ended = _ended_row(s, info["match_id"])
    assert ended == end_t, (ended, end_t)
    clock["t"] += 3_600_000                         # an hour of late facts while MC sits in RECAP
    kill(s, net, clock, ps, 1, 0, info, seq=2)      # a late kill re-archives the recap
    assert _ended_row(s, info["match_id"])[1] == end_t, "ended_t moved with the clock"


def test_store_match_ended_keeps_an_end_time_it_already_has():
    import pathlib, tempfile
    from brx_mcp.mc.store import Store
    st = Store("t", pathlib.Path(tempfile.mkdtemp()) / "s.sqlite")
    st.match_started("m1", {"mode": "tdm"}, 1_000)
    st.match_ended("m1", {"x": 1}, 61_000)
    st.match_ended("m1", {"x": 2})                  # a later rewrite with no end time: keep 61_000
    assert st.db.execute("SELECT ended_t, recap FROM matches WHERE match_id='m1'").fetchone() == (61_000, '{"x": 2}')
    st.close()


def test_a_timed_end_stores_go_live_plus_the_time_limit_not_the_tick_that_noticed_it():
    s, net, clock, ps, info = go_live_stored(2, "ffa")
    tl = s.config["time_limit_s"]
    clock["t"] = info["go_live_t"] + tl * 1000 + 9_000      # the tick notices the end late
    s.tick()
    assert s.phase == "recap"
    assert _ended_row(s, info["match_id"])[1] == info["go_live_t"] + tl * 1000
