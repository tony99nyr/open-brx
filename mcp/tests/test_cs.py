"""Tests for the CS bomb/plant-defuse engine."""

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import BombEngine, GameOver, Score, Callout


def death():
    return {"command": "HP", "tokens": ["HP", "0", "0", "0"]}


def _types(actions, typ):
    return [a for a in actions if isinstance(a, typ)]


def _bomb(**kw):
    cfg = GameConfig(mode="cs", game_time_s=120, detonation_s=40, **kw)
    e = BombEngine(cfg)
    e.add_player("t1", 2)   # attacker
    e.add_player("t2", 2)
    e.add_player("ct1", 1)  # defender
    e.add_player("ct2", 1)
    return e


def test_defuse_wins_the_round_for_defenders():
    e = _bomb()
    e.plant("A", now=10.0)
    acts = e.defuse(now=15.0)
    assert e.score["defenders"] == 1
    assert _types(acts, GameOver)          # rounds_to_win defaults to 1


def test_detonation_wins_for_attackers():
    e = _bomb()
    e.plant("A", now=10.0)
    assert e.tick(now=40.0) == []          # 30s elapsed, not yet
    acts = e.tick(now=50.0)                 # 40s since plant → detonate
    assert e.score["attackers"] == 1 and _types(acts, GameOver)


def test_all_defenders_eliminated_wins_for_attackers():
    e = _bomb()
    e.on_event("ct1", death(), now=5.0)
    acts = e.on_event("ct2", death(), now=6.0)
    assert e.score["attackers"] == 1 and _types(acts, GameOver)


def test_all_attackers_dead_before_plant_wins_for_defenders():
    e = _bomb()
    e.on_event("t1", death(), now=5.0)
    acts = e.on_event("t2", death(), now=6.0)
    assert e.score["defenders"] == 1 and _types(acts, GameOver)


def test_time_expires_without_plant_defenders_win():
    e = _bomb()
    acts = e.tick(now=120.0)
    assert e.score["defenders"] == 1


def test_planted_bomb_ignores_round_time_until_detonation():
    e = _bomb()
    e.plant("A", now=100.0)                 # planted near end of round
    # round time (120s) passes but bomb is planted → detonation timer rules, not time
    assert e.tick(now=125.0) == []          # 25s since plant < 40 → still ticking
    acts = e.tick(now=140.0)                 # 40s since plant → detonate (attackers)
    assert e.score["attackers"] == 1


def test_plant_after_time_expired_gives_round_to_defenders():
    # Regression (review Medium): a PLANT arriving after the round clock expired
    # (before the expiry tick) must not flip the round to attackers.
    e = _bomb()                                  # round_time = game_time_s = 120
    acts = e.plant("A", now=121.0)               # too late
    assert e.score["defenders"] == 1 and e.planted_at is None
    assert _types(acts, GameOver)


def test_defuse_before_plant_is_noop():
    e = _bomb()
    assert e.defuse(now=5.0) == []


def test_double_plant_is_noop():
    e = _bomb()
    e.plant("A", now=10.0)
    assert e.plant("B", now=11.0) == []     # already planted


def test_plant_defuse_via_on_event():
    e = _bomb()
    a1 = e.on_event("t1", {"command": "PLANT", "tokens": ["PLANT", "B"]}, now=10.0)
    assert _types(a1, Callout) and e.planted_site == "B"
    a2 = e.on_event("ct1", {"command": "DEFUSE", "tokens": ["DEFUSE"]}, now=15.0)
    assert e.score["defenders"] == 1


def test_best_of_three_needs_two_rounds():
    e = _bomb(rounds_to_win=2)
    e.plant("A", now=10.0)
    e.defuse(now=12.0)                        # defenders 1
    assert not e.over
    e.next_round(now=20.0)
    assert e.planted_at is None and all(p.alive for p in e.roster.players.values())
    e.plant("A", now=25.0)
    acts = e.tick(now=70.0)                   # detonate → attackers 1 (1-1, not over)
    e2_over = _types(acts, GameOver)
    assert not e2_over and e.score == {"attackers": 1, "defenders": 1}
