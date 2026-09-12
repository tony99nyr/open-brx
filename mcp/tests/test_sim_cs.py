"""Exhaustive CS / bomb (plant-defuse) scenarios through the SimGame harness.

Drives the REAL GameDriver + BombEngine + FakeTaggers end-to-end (station events,
kills, and clock ticks) with no hardware. Asserts the CORRECT round/match rules
from the cs.py docstring + the gameconfig.py / modes/ docstrings (docs/m0-game-engine.md was retired 2026-09-06):

  * bomb defused                     → defenders
  * bomb detonates (timer)           → attackers
  * all defenders eliminated         → attackers (uncontested)
  * all attackers eliminated, no plant → defenders
  * round time expires, no plant     → defenders (survived)
  * a planted bomb ignores the round clock — only detonation/defuse ends it
  * a plant arriving at/after the round clock must NOT flip the round
  * first side to `rounds_to_win` wins the match

GameConfig default teams: attackers_team=2, defenders_team=1. In SimGame the
default cs guns are G1→team1 (defender) and G2→team2 (attacker); multi-player
scenarios pass an explicit addr→team map. Note round_time_s = game_time_s or 120,
so game_time_s=0 means a 120s round (used when we only care about the bomb timer).
"""

from brx_mcp.gameconfig import GameConfig
from sim import SimGame

PLANT_CUE = "VA81"       # snd.COUNTDOWN — the plant kicks off the detonation countdown


def _sim(game_time_s=0, detonation_s=40, rounds_to_win=0, multi=False):
    """A set-up CS SimGame. `multi` gives 2v2 (D1/D2 defenders, A1/A2 attackers)
    so elimination scenarios have more than one player per side."""
    cfg = GameConfig(mode="cs", game_time_s=game_time_s,
                     detonation_s=detonation_s, rounds_to_win=rounds_to_win)
    guns = {"D1": 1, "D2": 1, "A1": 2, "A2": 2} if multi else None
    return SimGame(cfg, guns=guns).setup()


# --------------------------------------------------------------------------- #
# Plant → detonation                                                          #
# --------------------------------------------------------------------------- #
def test_plant_then_detonation_attackers_win():
    g = _sim(detonation_s=8)
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.tick(now=10.0)                                  # 9s ≥ 8 → detonate
    assert g.over
    s = g.snapshot()
    assert s["winner"] == "attackers"
    assert s["score"] == {"attackers": 1, "defenders": 0}


def test_detonation_timer_does_not_fire_early():
    g = _sim(detonation_s=40)
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.tick(now=30.0)                                  # 29s since plant < 40 → still ticking
    assert not g.over and g.snapshot()["score"] == {"attackers": 0, "defenders": 0}
    g.tick(now=41.0)                                  # 40s since plant → detonate
    assert g.over and g.snapshot()["winner"] == "attackers"


def test_planted_bomb_ignores_round_time_until_detonation():
    # Planted near the end of the round: the round clock (120s) elapses but a
    # planted bomb is governed by the detonation timer, not the round time.
    g = _sim(game_time_s=120, detonation_s=40)
    g.station("ST", "$PLANT,A,*", now=100.0)
    g.tick(now=125.0)                                 # past round time, 25s since plant < 40
    assert not g.over
    g.tick(now=140.0)                                 # 40s since plant → detonate
    assert g.over and g.snapshot()["winner"] == "attackers"


# --------------------------------------------------------------------------- #
# Defuse                                                                       #
# --------------------------------------------------------------------------- #
def test_plant_then_defuse_before_detonation_defenders_win():
    g = _sim(detonation_s=40)
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.station("ST", "$DEFUSE,*", now=10.0)           # defused well before 40s
    assert g.over
    s = g.snapshot()
    assert s["winner"] == "defenders"
    assert s["score"] == {"attackers": 0, "defenders": 1}


def test_defuse_before_plant_is_noop():
    g = _sim(detonation_s=40)
    g.station("ST", "$DEFUSE,*", now=5.0)            # nothing planted → ignored
    assert not g.over and g.snapshot()["score"] == {"attackers": 0, "defenders": 0}


# --------------------------------------------------------------------------- #
# Elimination                                                                  #
# --------------------------------------------------------------------------- #
def test_all_defenders_eliminated_attackers_win():
    g = _sim(detonation_s=40, multi=True)
    g.kill("D1", shooter_team=2, now=1.0)
    assert not g.over                                # one defender still alive
    g.kill("D2", shooter_team=2, now=2.0)            # last defender down
    assert g.over and g.snapshot()["winner"] == "attackers"


def test_all_attackers_eliminated_before_plant_defenders_win():
    g = _sim(detonation_s=40, multi=True)
    g.kill("A1", shooter_team=1, now=1.0)
    assert not g.over
    g.kill("A2", shooter_team=1, now=2.0)            # last attacker down, no plant
    assert g.over and g.snapshot()["winner"] == "defenders"


def test_all_attackers_dead_after_plant_bomb_still_detonates():
    # A planted bomb is uncontested by attacker deaths: wiping the attackers after
    # the plant must NOT hand the round to defenders — the bomb still detonates.
    g = _sim(detonation_s=20, multi=True)
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.kill("A1", shooter_team=1, now=2.0)
    g.kill("A2", shooter_team=1, now=3.0)
    assert not g.over                                # bomb is planted → round continues
    g.tick(now=25.0)                                 # 24s since plant ≥ 20 → detonate
    assert g.over and g.snapshot()["winner"] == "attackers"


# --------------------------------------------------------------------------- #
# Round-time expiry / late plant                                              #
# --------------------------------------------------------------------------- #
def test_time_expires_without_plant_defenders_win():
    g = _sim(game_time_s=10, detonation_s=40)
    g.tick(now=10.0)                                  # round clock hit, nothing planted
    assert g.over and g.snapshot()["winner"] == "defenders"


def test_late_plant_at_round_limit_does_not_flip_round():
    # LATE plant (the cs.py fix): a plant arriving AT the round limit must not
    # flip the round to attackers — defenders keep it, and nothing is planted.
    g = _sim(game_time_s=10, detonation_s=40)
    g.station("ST", "$PLANT,A,*", now=10.0)          # now - round_start == round_time
    assert g.over
    s = g.snapshot()
    assert s["winner"] == "defenders" and s["planted"] is None


def test_late_plant_after_round_limit_does_not_flip_round():
    g = _sim(game_time_s=10, detonation_s=40)
    g.station("ST", "$PLANT,A,*", now=15.0)          # well after the round clock
    assert g.over
    s = g.snapshot()
    assert s["winner"] == "defenders" and s["planted"] is None


# --------------------------------------------------------------------------- #
# Plant cue / snapshot                                                         #
# --------------------------------------------------------------------------- #
def test_plant_emits_countdown_cue_to_all_guns():
    g = _sim(detonation_s=40)
    before = {p: g.frames_to(p).count(f"$PLAY,{PLANT_CUE},4,6,,,,,*") for p in g.teams}
    g.station("ST", "$PLANT,A,*", now=1.0)
    # the plant broadcasts the detonation-countdown cue to every gun
    for p in g.teams:
        after = g.frames_to(p).count(f"$PLAY,{PLANT_CUE},4,6,,,,,*")
        assert after == before[p] + 1
    assert g.snapshot()["planted"] == "A"            # planted state recorded


def test_plant_records_site_in_snapshot():
    g = _sim(detonation_s=40)
    g.station("ST", "$PLANT,B,*", now=1.0)           # site B
    assert g.snapshot()["planted"] == "B" and not g.over


def test_double_plant_keeps_first_site():
    g = _sim(detonation_s=40)
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.station("ST", "$PLANT,B,*", now=2.0)           # second plant ignored
    assert g.snapshot()["planted"] == "A" and not g.over


# --------------------------------------------------------------------------- #
# Best-of-N match play                                                         #
# --------------------------------------------------------------------------- #
def test_single_round_ends_match_when_rounds_to_win_zero():
    # rounds_to_win=0 → the engine plays a single round (rounds_to_win coerced to 1).
    g = _sim(detonation_s=8, rounds_to_win=0)
    assert g.snapshot()["rounds_to_win"] == 1
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.tick(now=10.0)
    assert g.over and g.snapshot()["winner"] == "attackers"


def test_next_round_resets_plant_and_alive_state():
    g = _sim(detonation_s=40, rounds_to_win=2, multi=True)
    g.kill("D1", shooter_team=2, now=1.0)
    g.kill("D2", shooter_team=2, now=2.0)            # attackers take round 1
    assert not g.over and g.snapshot()["score"] == {"attackers": 1, "defenders": 0}
    g.drv.engine.next_round(now=10.0)
    s = g.snapshot()
    assert s["round"] == 2 and s["planted"] is None
    assert all(p["alive"] for p in s["players"].values())   # roster revived


def test_best_of_three_match_winner():
    g = _sim(detonation_s=40, rounds_to_win=2)
    # round 1 — defenders defuse
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.station("ST", "$DEFUSE,*", now=2.0)
    assert not g.over and g.snapshot()["score"] == {"attackers": 0, "defenders": 1}
    # round 2 — attackers detonate
    g.drv.engine.next_round(now=10.0)
    g.station("ST", "$PLANT,A,*", now=11.0)
    g.tick(now=60.0)
    assert not g.over and g.snapshot()["score"] == {"attackers": 1, "defenders": 1}
    # round 3 — defenders defuse → reach rounds_to_win=2 → match over
    g.drv.engine.next_round(now=70.0)
    g.station("ST", "$PLANT,A,*", now=71.0)
    g.station("ST", "$DEFUSE,*", now=72.0)
    assert g.over
    s = g.snapshot()
    assert s["winner"] == "defenders" and s["score"] == {"attackers": 1, "defenders": 2}


def test_next_round_is_noop_after_match_over():
    g = _sim(detonation_s=8, rounds_to_win=0)
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.tick(now=10.0)                                  # match over (single round)
    assert g.over
    g.drv.engine.next_round(now=20.0)                # must not restart the match
    assert g.over and g.snapshot()["round"] == 1


# --------------------------------------------------------------------------- #
# Idempotency after the match is over                                         #
# --------------------------------------------------------------------------- #
def test_no_events_after_match_over():
    g = _sim(detonation_s=8, rounds_to_win=0)
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.tick(now=10.0)
    final = g.snapshot()
    assert final["winner"] == "attackers"
    # further plant / defuse / tick must do nothing
    g.station("ST", "$PLANT,B,*", now=11.0)
    g.station("ST", "$DEFUSE,*", now=12.0)
    g.tick(now=1000.0)
    after = g.snapshot()
    assert after["score"] == final["score"]
    assert after["winner"] == "attackers" and after["planted"] == final["planted"]
