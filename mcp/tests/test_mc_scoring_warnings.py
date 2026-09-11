"""F77 + F80 (2026-09-11): the recap's after-the-fact detectors.

F74's phantom loop (a gun replaying `$HIR`+`$HP` every 5.07 s with no IR in the air) reaches the scorer
looking exactly like real fire, and F77 forbids a suppressor -- a "same shooter, same damage, regular
period" filter would silently eat real bursts. So the scorer NAMES the signature in the recap instead.
Wire-0 shooters (a hill's damage word, or a gun whose $PSET never landed -- F80) score for nobody by
design; the recap now says how many there were, so a mis-armed gun is visible after the match.
"""
from __future__ import annotations

from brx_mcp.mc.scoring import Scorer


def _scorer():
    players = {"p1": {"player_id": "p1", "player_num": 1, "display": "ALPHA", "team_id": "blue", "node_id": "n1"},
               "p2": {"player_id": "p2", "player_num": 2, "display": "BRAVO", "team_id": "red", "node_id": "n2"}}
    teams = [{"team_id": "blue", "name": "BLUE", "color": "b", "tid": 1}, {"team_id": "red", "name": "RED", "color": "r", "tid": 0}]
    return Scorer("m1", 1_000_000, 600, "tdm", players, teams, {"n1": "p1", "n2": "p2"},
                  {"n1": True, "n2": True}, on_feedback=lambda *a: None, on_feed=lambda *a: None, now_ms=lambda: 2_000_000)


def _hit(sc, t, shooter_num, dmg=20):
    sc.ingest("n2", {"type": "hit_taken", "t": t, "match_id": "m1", "node_id": "n2", "player_id": "p2",
                     "shooter_num": shooter_num, "shooter_team": 1, "dmg": dmg}, t)


def test_a_steady_five_second_run_of_identical_hits_is_named_in_the_recap_and_still_scored():
    sc = _scorer()
    for i in range(6):
        _hit(sc, 1_010_000 + i * 5070, 1)           # the measured 5.07 s replay, six times
    r = sc.recap()
    assert any("F74?" in w and "BRAVO" in w and "ALPHA" in w and "5.1 s" in w for w in r.get("warnings", [])), r.get("warnings")
    # NOT dropped: F77 says a suppressor would eat real bursts, so the detector only names it
    assert next(row for row in r["rows"] if row["player_id"] == "p1")["hits"] == 6


def test_real_fire_is_not_called_a_replay():
    # a burst (150 ms apart), a spaced firefight (1-2 s, irregular), and three 5 s hits (under the floor)
    sc = _scorer()
    for i in range(8):
        _hit(sc, 1_010_000 + i * 150, 1)
    for t in (1_100_000, 1_101_300, 1_103_900, 1_104_600, 1_107_000):
        _hit(sc, t, 1)
    sc2 = _scorer()
    for i in range(3):
        _hit(sc2, 1_010_000 + i * 5000, 1)
    assert "warnings" not in sc.recap(), sc.recap().get("warnings")
    assert "warnings" not in sc2.recap()
    # CONTROL: the same three plus one more at the same period trips it -- the floor is the fourth hit
    _hit(sc2, 1_010_000 + 3 * 5000, 1)
    assert any("F74?" in w for w in sc2.recap()["warnings"])


def test_wire_zero_facts_are_counted_and_named_not_credited():
    sc = _scorer()
    for i in range(3):
        _hit(sc, 1_010_000 + i * 5000, 0, dmg=8)    # a hill's ambient damage word
    sc.ingest("n2", {"type": "death", "t": 1_030_000, "match_id": "m1", "node_id": "n2", "player_id": "p2",
                     "shooter_num": 0, "shooter_team": 1}, 1_030_000)
    r = sc.recap()
    assert next(row for row in r["rows"] if row["player_id"] == "p1")["hits"] == 0, "wire 0 credits nobody"
    assert next(row for row in r["rows"] if row["player_id"] == "p1")["kills"] == 0
    assert any("WIRE 0" in w and "3 hit(s)" in w and "1 death(s)" in w and "F80" in w for w in r["warnings"]), r["warnings"]
    # CONTROL: an ordinary match says nothing
    assert "warnings" not in _scorer().recap()
