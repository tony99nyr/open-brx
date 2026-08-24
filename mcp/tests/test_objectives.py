"""Tests for the objective engines — Domination, KotH, CTF."""

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import DominationEngine, CtfEngine, GameOver, Score, Callout, build_engine


def cap(site, team):
    return {"command": "CAPTURE", "tokens": ["CAPTURE", site, str(team)]}


def death():
    return {"command": "HP", "tokens": ["HP", "0", "0", "0"]}


def _types(actions, typ):
    return [a for a in actions if isinstance(a, typ)]


# ---- Domination ------------------------------------------------------------- #
def test_domination_owner_scores_over_time():
    e = DominationEngine(GameConfig(mode="domination", control_points=2,
                                    score_target=10, game_time_s=0))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("red", cap("A", 1), now=0.0)      # red owns A → 1 pt/s
    assert e.tick(now=5.0) == []                 # 5 pts < 10
    acts = e.tick(now=10.0)                       # 10 pts → win
    assert _types(acts, GameOver) and e.snapshot()["score"][1] >= 10


def test_domination_two_points_double_rate():
    e = DominationEngine(GameConfig(mode="domination", control_points=2,
                                    score_target=20, game_time_s=0))
    e.add_player("red", 1)
    e.on_event("red", cap("A", 1), now=0.0)
    e.on_event("red", cap("B", 1), now=0.0)      # holds both → 2 pt/s
    acts = e.tick(now=10.0)                        # 2*10 = 20 → win
    assert _types(acts, GameOver)


def test_domination_steal_transfers_scoring():
    e = DominationEngine(GameConfig(mode="domination", control_points=1,
                                    score_target=0, game_time_s=0))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("red", cap("A", 1), now=0.0)
    e.tick(now=4.0)                                # red +4
    e.on_event("blue", cap("A", 2), now=4.0)      # blue steals A
    e.tick(now=10.0)                              # blue +6
    s = e.snapshot()["score"]
    assert s[1] == 4 and s[2] == 6


def test_domination_time_limit_leader_wins():
    e = DominationEngine(GameConfig(mode="domination", control_points=1, game_time_s=30))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("red", cap("A", 1), now=0.0)
    acts = e.tick(now=30.0)
    over = _types(acts, GameOver)
    assert over and over[0].winner == "team1"


def test_capture_same_owner_is_noop():
    e = DominationEngine(GameConfig(mode="domination", control_points=1))
    e.add_player("red", 1)
    e.on_event("red", cap("A", 1), now=0.0)
    assert e.on_event("red", cap("A", 1), now=1.0) == []


# ---- KotH (domination with 1 point via build_engine) ------------------------ #
def test_koth_builds_single_point():
    e = build_engine(GameConfig(mode="koth", control_points=5))
    assert isinstance(e, DominationEngine) and len(e.sites) == 1


# ---- CTF -------------------------------------------------------------------- #
# Objective events come from a STATION (not a gun) → team is the explicit token.
def grab(team, flag="flag"):
    return {"command": "GRAB", "tokens": ["GRAB", flag, str(team)]}


def capflag(team):
    return {"command": "CAP", "tokens": ["CAP", str(team)]}


def drop(team):
    return {"command": "DROP", "tokens": ["DROP", str(team)]}


def test_ctf_capture_scores_and_wins_at_target():
    e = CtfEngine(GameConfig(mode="ctf", cap_target=2, game_time_s=0))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("station", grab(1), now=1.0)
    a1 = e.on_event("station", capflag(1), now=5.0)
    assert _types(a1, Score) and e.caps[1] == 1 and not e.over
    e.on_event("station", grab(1), now=6.0)
    a2 = e.on_event("station", capflag(1), now=9.0)
    assert _types(a2, GameOver) and e.caps[1] == 2


def test_ctf_cap_without_grab_does_not_score():
    e = CtfEngine(GameConfig(mode="ctf", cap_target=2))
    e.add_player("red", 1)
    acts = e.on_event("station", capflag(1), now=1.0)
    assert not _types(acts, Score) and e.caps.get(1, 0) == 0


def test_ctf_drop_clears_possession():
    e = CtfEngine(GameConfig(mode="ctf", cap_target=2))
    e.add_player("red", 1)
    e.on_event("station", grab(1), now=1.0)
    e.on_event("station", drop(1), now=2.0)
    assert 1 not in e.held
    acts = e.on_event("station", capflag(1), now=3.0)   # dropped → can't cap
    assert not _types(acts, Score)


def test_ctf_malformed_team_token_does_not_crash():
    e = CtfEngine(GameConfig(mode="ctf"))
    e.add_player("red", 1)
    # station sends a non-integer team → ignored, no exception, no phantom score
    assert e.on_event("station", {"command": "GRAB", "tokens": ["GRAB", "f", "red"]}, now=1.0) == []
    assert e.on_event("station", {"command": "CAP", "tokens": ["CAP", "x"]}, now=2.0) == []
    assert e.held == set() and e.caps.get(0) is None


def test_ctf_zero_team_token_not_scored():
    e = CtfEngine(GameConfig(mode="ctf"))
    e.add_player("red", 1)
    # bare CAP/GRAB with no team → _ev default 0 → rejected, no team0 fabricated
    assert e.on_event("station", {"command": "GRAB", "tokens": ["GRAB", "f"]}, now=1.0) == []
    assert e.on_event("station", {"command": "CAP", "tokens": ["CAP"]}, now=2.0) == []
    assert 0 not in e.held and "team0" not in (e.snapshot()["caps"])


def test_ctf_carrier_death_callout():
    e = CtfEngine(GameConfig(mode="ctf"))
    e.add_player("red", 1)
    acts = e.on_event("red", death(), now=1.0)
    assert _types(acts, Callout)


def test_ctf_time_limit_leader_wins():
    e = CtfEngine(GameConfig(mode="ctf", cap_target=99, game_time_s=60))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("station", grab(1), now=1.0)
    e.on_event("station", capflag(1), now=5.0)
    acts = e.tick(now=60.0)
    over = _types(acts, GameOver)
    assert over and over[0].winner == "team1"


def test_build_engine_maps_objective_modes():
    from brx_mcp.modes import DominationEngine as D, CtfEngine as C
    assert isinstance(build_engine(GameConfig(mode="domination")), D)
    assert isinstance(build_engine(GameConfig(mode="ctf")), C)
