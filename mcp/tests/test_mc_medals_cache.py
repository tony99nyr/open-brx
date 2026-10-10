"""mc.md #12 (measured 2026-10-10): every status message pushed the scores, and every push rebuilt each player's medal
chips by walking the WHOLE kill history (`earned_medals`, 88% of `_on_status` at 6000 facts; a heartbeat round grew
from 0.8 ms to 10 ms over a long match). A kill's medals are fixed when it is appended, so the chips only change when
a kill is added: they are cached on the number of kills."""
from __future__ import annotations

from _session import go_live, kill


def _fresh(sc):
    sc._earned_cache = None
    return sc.earned_medals()


def test_a_status_heartbeat_reuses_the_medal_chips():
    s, net, clock, ps, info = go_live(3)
    for seq in range(1, 9):
        kill(s, net, clock, ps, 0, 1 + seq % 2, info, seq=seq, dt=400)   # quick kills: multi-kill medals
    sc = s.scorer
    first = sc.earned_medals()
    assert first, "control: the kills earned medals"
    walked = []
    real = sc.kills.__iter__
    class Spy(list):
        def __iter__(self):
            walked.append(1)
            return real()
    sc.kills = Spy(sc.kills)
    assert sc.earned_medals() == first and not walked, "no new kill: the cached chips, not a walk of the kills"


def test_a_new_kill_updates_the_chips_and_the_cache_always_matches_a_fresh_walk():
    s, net, clock, ps, info = go_live(3)
    sc = s.scorer
    for seq in range(1, 25):
        kill(s, net, clock, ps, seq % 3, (seq + 1) % 3, info, seq=seq, dt=300 if seq % 5 else 9000)
        cached = sc.earned_medals()
        assert cached == _fresh(sc), seq


def test_a_caller_that_edits_the_chips_cannot_corrupt_the_cache():
    """Review (Codex and Opus): every call returned the one cached dict, so a caller that edited it would corrupt the
    chips until the next kill. Each call hands out its own copy."""
    s, net, clock, ps, info = go_live(3)
    for seq in range(1, 6):
        kill(s, net, clock, ps, 0, 1 + seq % 2, info, seq=seq, dt=400)
    sc = s.scorer
    got = sc.earned_medals()
    assert got, "control: medals earned"
    for chips in got.values():
        chips.append("JUNK")
    got.clear()
    assert sc.earned_medals() == _fresh(sc) and sc.earned_medals(), "the cache is untouched"
