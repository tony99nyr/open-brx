"""EFF-3 (engine.js cdd90010): an ANSWERED `$LIFE` read is the divergence poll's own, whoever asked, so a solicited `$HP`
stamps `_poll_at`; an unsolicited `$HP` and an unanswered probe stamp nothing (the poll stays due)."""
import pathlib
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from _stage import StageClock, mk_stage


def _st():
    clock = StageClock()
    st, _mgr = mk_stage(now=clock)
    st.spawned = st.alive = True
    return st, clock


def test_a_solicited_hp_answer_stamps_the_poll_clock():
    st, clock = _st()
    st._poll_at = 0.0
    st._query_at = clock.t; st._probe_seen = {}                 # a read went out (the cure, a repair, a read-back)
    clock.advance(0.2)
    st._on_rx("$HP,45,70,0,*")
    assert st._poll_at == clock.t, "the answered read is this cadence's poll"


def test_an_unsolicited_hp_or_an_unanswered_probe_stamps_nothing():
    st, clock = _st()
    st._poll_at = 0.0
    st._query_at = 0.0; st._probe_seen = {}
    st._on_rx("$HP,45,70,0,*")                                 # the gun reporting on its own
    assert st._poll_at == 0.0
    st._query_at = clock.t                                     # a read went out...
    clock.advance(st.QUERY_REPLY_S + 0.5)                       # ...and nothing came back inside its window
    st._on_rx("$HP,45,70,0,*")
    assert st._poll_at == 0.0, "an unanswered probe leaves the poll due"


def test_a_second_hp_inside_the_same_window_is_not_an_answer():
    """`_solicited` answers ONCE per probe: a hit report 0.1 s after the answer is the gun talking, so it keeps the
    first stamp (Opus r1: a window-only check would have stamped it again)."""
    st, clock = _st()
    st._poll_at = 0.0
    st._query_at = clock.t; st._probe_seen = {}
    clock.advance(0.2)
    st._on_rx("$HP,45,70,0,*")
    first = st._poll_at
    clock.advance(0.1)
    st._on_rx("$HP,36,70,0,*")
    assert st._poll_at == first, (first, st._poll_at)
