"""The `domination-hills` check (Domination scored from the phones, 2026-11-07): the recap's points follow the hills'
owner timelines, and a target end needs a team that really reached the target, unless a step was still on a phone out
of Wi-Fi at the whistle (the known limit). Codex pass 2026-11-07 found the check passing a finish below the target; the
Codex review of the phone scoring found the queued exemption outliving the step it was for."""
from __future__ import annotations

from types import SimpleNamespace

from _skip import needs

try:
    from brx_mcp.chaos.registry import InvariantError
    from brx_mcp.chaos.scenarios import domination_hills as dh
    HAVE_CHAOS = True
except ImportError:   # the chaos stack needs the server extras; system python may not have them
    HAVE_CHAOS = False

GO, END = 10_000, 20_000


def _world(red_from, *, reason="hold_target", queued=(), target=4):
    """Red owns hill A from `red_from` (or never), to the whistle at END; the recap says what the truth says."""
    red_ms = END - red_from if red_from is not None else 0
    teams = {"red": {"tid": 0}, "blue": {"tid": 1}}
    session = SimpleNamespace(phase="recap", end_reason=reason, config={"scoring": {"hold_target_s": target}},
                              last_recap={"possession": {"by_team": {"red": round(red_ms / 1000), "blue": 0}},
                                          "winner": {"team_id": "red"} if red_ms else {"team_id": None, "tie": ["blue", "red"]}})
    world = SimpleNamespace(session=session, finishes=[{"reason": reason, "at_ms": END}])
    world.hill_tl = {nid: [] for nid in dh.HILLS}
    if red_from is not None:
        world.hill_tl[dh.HILLS[0]] = [(red_from, 0)]
    world.hill_queued = list(queued)
    return world, SimpleNamespace(teams=teams, go_live_t=GO, end_t=END)


def _refused(world, sc) -> bool:
    real = dh.match_scorer
    dh.match_scorer = lambda _s: sc
    try:
        dh.domination_hills_check(world)
    except InvariantError:
        return True
    finally:
        dh.match_scorer = real
    return False


def test_a_target_finish_below_the_target_is_refused():
    needs(HAVE_CHAOS, "the chaos stack (server extras)")
    assert not _refused(*_world(END - 6_000)), "CONTROL: red held 6 s against a 4 s target"
    assert _refused(*_world(END - 1_000, target=10)), "1 point of 10 must fail"
    assert _refused(*_world(None)), "a target finish with nothing held must fail"


def test_the_queued_exemption_covers_only_a_step_still_on_a_phone_at_the_whistle():
    needs(HAVE_CHAOS, "the chaos stack (server extras)")
    still_out = [{"at": END - 5_000, "acked": END + 3_000}]
    long_delivered = [{"at": GO + 500, "acked": GO + 900}]
    assert not _refused(*_world(END - 1_000, target=10, queued=still_out)), "a drain still on a phone: the known limit"
    assert _refused(*_world(END - 1_000, target=10, queued=long_delivered)), "a step delivered long before the whistle"
