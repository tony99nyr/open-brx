"""Exhaustive scenario suite for Domination and King of the Hill, driven through
the full stack with the SimGame harness (GameConfig → GameDriver → engine →
Action→frame execution), no hardware.

Asserts the CORRECT behavior per DominationEngine's docstring + the gameconfig.py / modes/ docstrings (docs/m0-game-engine.md was retired 2026-09-06):
  * N control points; each point a team owns scores 1 pt/s for that team, over TICKS.
  * Win at score_target point-seconds, OR (on a game_time_s clock) the most-held-time
    leader wins; an equal split is a draw; nobody-ever-held is a draw.
  * KotH = Domination forced to a single point (build_engine replaces control_points=1).
  * score_target=0 AND game_time_s=0 = intentionally unlimited → never self-ends.
  * Objective events come from a STATION: a missing/garbage/zero team token is
    ignored, never fabricated or scored (per the engine docstring).

Scoring accrues on tick(now): tick credits dt = now - last_tick to each owned
point's team. The engine starts at now=0 (SimGame builds the driver at now=0), so
a capture at now=0 then tick(now=T) credits T point-seconds.

A scenario that reproduces a REAL engine bug lives in a `scenario_*` function
(NOT run by run_tests.py) tagged `# SUSPECTED BUG:` — see the bottom of the file.
"""

from brx_mcp.gameconfig import GameConfig
from brx_mcp.sim import SimGame

from brx_mcp.modes import hillbeacon as _hb
# "Hill Captured" (VB0N) on the ANNOUNCER slot. Confirmed by ear 2026-09-10 (rung S) and Tony's own
# pick over the three male "Control Point" lines; a capture is a voice line, not an effect.
CAP_SOUND = _hb.HILL_CAPTURED
CAP_FRAME = f"$PLAY,,4,6,{CAP_SOUND},,,,*"


def _cap_sound_count(g) -> int:
    """How many point-captured $PLAY cues were emitted, across all guns."""
    return sum(1 for (_pid, f) in g.all_frames() if f == CAP_FRAME)


def _dom(**kw) -> GameConfig:
    base = dict(mode="domination", control_points=1, score_target=0, game_time_s=0)
    base.update(kw)
    return GameConfig(**base)


# --------------------------------------------------------------------------- #
# Single-point capture → hold → win by score_target                           #
# --------------------------------------------------------------------------- #
def test_single_point_hold_reaches_target_team1_wins():
    g = SimGame(_dom(control_points=1, score_target=5)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)     # team1 claims the only point
    g.tick(now=4.0)                                # 4 point-seconds < 5 → not yet
    assert not g.over
    g.tick(now=5.0)                                # 5 ≥ 5 → team1 wins
    s = g.snapshot()
    assert g.over and s["winner"] == "team1"
    assert s["owner"]["A"] == 1
    # the score reflects the hold time (5 point-seconds)
    assert s["score"][1] == 5


def test_single_point_score_tracks_hold_time_before_end():
    g = SimGame(_dom(control_points=1, score_target=0, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)
    g.tick(now=3.0)
    assert g.snapshot()["score"][1] == 3          # 3s held → 3 pts
    g.tick(now=7.0)
    assert g.snapshot()["score"][1] == 7          # accrues to 7


# --------------------------------------------------------------------------- #
# Two points → double scoring rate → target reached faster                    #
# --------------------------------------------------------------------------- #
def test_two_points_double_rate_reaches_target_at_half_time():
    g = SimGame(_dom(control_points=2, score_target=20, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)
    g.station("ST", "$CAPTURE,B,1,*", now=0.0)     # team1 holds BOTH → 2 pts/s
    g.tick(now=10.0)                               # 2 * 10 = 20 → win at t=10
    s = g.snapshot()
    assert g.over and s["winner"] == "team1"
    assert s["score"][1] == 20


def test_single_point_same_target_not_reached_at_same_time():
    # Control for the double-rate claim: one point at target 20 is NOT done at t=10.
    g = SimGame(_dom(control_points=1, score_target=20, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)
    g.tick(now=10.0)                               # only 10 point-seconds
    assert not g.over and g.snapshot()["score"][1] == 10


def test_two_points_split_between_teams_each_scores_own_rate():
    g = SimGame(_dom(control_points=2, score_target=0, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)     # team1 holds A
    g.station("ST", "$CAPTURE,B,2,*", now=0.0)     # team2 holds B
    g.tick(now=8.0)
    s = g.snapshot()["score"]
    assert s[1] == 8 and s[2] == 8                 # each 1 pt/s, no double rate
    assert not g.over


# --------------------------------------------------------------------------- #
# Steal: ownership (and scoring) transfers to the new holder                   #
# --------------------------------------------------------------------------- #
def test_steal_transfers_scoring_from_steal_point():
    g = SimGame(_dom(control_points=1, score_target=0, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)     # team1 holds A
    g.tick(now=4.0)                                # team1 +4
    g.station("ST", "$CAPTURE,A,2,*", now=4.0)     # team2 steals A at the tick boundary
    g.tick(now=10.0)                               # team2 +6
    s = g.snapshot()
    assert s["owner"]["A"] == 2
    assert s["score"][1] == 4 and s["score"][2] == 6   # each team's accrual is correct


def test_steal_back_and_forth_accrues_to_current_owner():
    g = SimGame(_dom(control_points=1, score_target=0, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)
    g.tick(now=3.0)                                # team1 +3
    g.station("ST", "$CAPTURE,A,2,*", now=3.0)
    g.tick(now=8.0)                                # team2 +5
    g.station("ST", "$CAPTURE,A,1,*", now=8.0)
    g.tick(now=10.0)                               # team1 +2
    s = g.snapshot()["score"]
    assert s[1] == 5 and s[2] == 5                 # 3+2 vs 5
    assert g.snapshot()["owner"]["A"] == 1


# --------------------------------------------------------------------------- #
# No-ops: same owner, non-existent site, garbage/missing team                 #
# --------------------------------------------------------------------------- #
def test_recapture_by_same_owner_is_noop():
    g = SimGame(_dom(control_points=1)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)
    assert _cap_sound_count(g) == 2               # cue broadcast to both guns, once
    g.station("ST", "$CAPTURE,A,1,*", now=1.0)     # same team re-shoots → no-op
    assert _cap_sound_count(g) == 2               # no fresh cue
    assert g.snapshot()["owner"]["A"] == 1


def test_capture_nonexistent_site_is_noop():
    g = SimGame(_dom(control_points=1)).setup()    # only site "A" exists
    g.station("ST", "$CAPTURE,Z,1,*", now=0.0)     # no such point
    assert _cap_sound_count(g) == 0                # nothing captured
    owner = g.snapshot()["owner"]
    assert "Z" not in owner and owner["A"] is None


def test_garbage_team_token_is_ignored_no_crash_no_phantom():
    g = SimGame(_dom(control_points=1)).setup()
    g.station("ST", "$CAPTURE,A,red,*", now=0.0)   # non-numeric team → ValueError, swallowed
    g.tick(now=5.0)
    s = g.snapshot()
    assert s["owner"]["A"] is None                 # never captured
    assert _cap_sound_count(g) == 0
    # no phantom team fabricated in the scoreboard (only the roster's own teams -- read from the
    # game rather than hard-coded, so this keeps meaning what it says if the default teams move)
    assert set(s["score"].keys()) <= set(g.teams.values())
    assert all(v == 0 for v in s["score"].values())


def test_missing_team_token_is_ignored():
    g = SimGame(_dom(control_points=1)).setup()
    g.station("ST", "$CAPTURE,A,*", now=0.0)       # no team token → TypeError, swallowed
    g.tick(now=5.0)
    s = g.snapshot()
    assert s["owner"]["A"] is None and _cap_sound_count(g) == 0


def test_garbage_then_valid_capture_still_works():
    # A malformed event must not poison later valid ones.
    g = SimGame(_dom(control_points=1, score_target=3)).setup()
    g.station("ST", "$CAPTURE,A,junk,*", now=0.0)  # ignored
    g.station("ST", "$CAPTURE,A,2,*", now=0.0)     # valid → team2 owns A
    g.tick(now=3.0)
    s = g.snapshot()
    assert g.over and s["winner"] == "team2" and s["owner"]["A"] == 2


# --------------------------------------------------------------------------- #
# Time-limit ending (game_time_s, score_target=0)                             #
# --------------------------------------------------------------------------- #
def test_time_limit_leader_wins():
    g = SimGame(_dom(control_points=2, score_target=0, game_time_s=10)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)     # team1 holds one point the whole game
    g.run_until_over(dt=1.0, start=1.0)
    s = g.snapshot()
    assert g.over and s["winner"] == "team1"
    assert s["score"][1] > s["score"].get(2, 0)


def test_time_limit_genuine_tie_is_draw():
    g = SimGame(_dom(control_points=2, score_target=0, game_time_s=10)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)     # team1 holds A
    g.station("ST", "$CAPTURE,B,2,*", now=0.0)     # team2 holds B → equal split
    g.run_until_over(dt=1.0, start=1.0)
    s = g.snapshot()
    assert g.over and s["winner"] == "draw"
    assert s["score"][1] == s["score"][2]


def test_time_limit_no_captures_is_draw():
    g = SimGame(_dom(control_points=2, score_target=0, game_time_s=8)).setup()
    g.run_until_over(dt=1.0, start=1.0)            # nobody ever held a point
    s = g.snapshot()
    assert g.over and s["winner"] == "draw"
    assert all(v == 0 for v in s["score"].values())


def test_time_limit_target_reached_before_clock_ends_first():
    # When both a target and a clock exist, hitting the target ends it early.
    g = SimGame(_dom(control_points=1, score_target=3, game_time_s=100)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)
    g.tick(now=3.0)                                # 3 pts ≥ target, long before t=100
    s = g.snapshot()
    assert g.over and s["winner"] == "team1"


# --------------------------------------------------------------------------- #
# King of the Hill = Domination forced to one point                           #
# --------------------------------------------------------------------------- #
def test_koth_forces_single_point():
    g = SimGame(GameConfig(mode="koth", control_points=5,
                           score_target=0, game_time_s=0)).setup()
    # build_engine replaces control_points with 1 → only hill "A"
    assert list(g.snapshot()["owner"].keys()) == ["A"]


def test_koth_hold_the_hill_for_time_wins():
    g = SimGame(GameConfig(mode="koth", control_points=5,
                           score_target=5, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)     # team1 takes the hill
    g.tick(now=5.0)                                # holds 5s ≥ target
    s = g.snapshot()
    assert g.over and s["winner"] == "team1" and s["score"][1] == 5


def test_koth_steal_the_hill_flips_the_winner():
    g = SimGame(GameConfig(mode="koth", control_points=1,
                           score_target=6, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)
    g.tick(now=4.0)                                # team1 +4 (< 6)
    g.station("ST", "$CAPTURE,A,2,*", now=4.0)     # team2 steals the hill
    g.tick(now=10.0)                              # team2 +6 → team2 wins
    s = g.snapshot()
    assert g.over and s["winner"] == "team2"
    assert s["score"][1] == 4 and s["score"][2] == 6


# --------------------------------------------------------------------------- #
# Intentionally-unlimited game never self-ends                                #
# --------------------------------------------------------------------------- #
def test_unlimited_never_self_ends():
    g = SimGame(_dom(control_points=1, score_target=0, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)
    for t in range(1, 501):                        # tick a long time
        g.tick(now=float(t))
    assert not g.over                              # unlimited → operator must stop it
    assert g.snapshot()["score"][1] == 500         # but it keeps scoring


# --------------------------------------------------------------------------- #
# The point-capture callout / $PLAY cue                                        #
# --------------------------------------------------------------------------- #
def test_capture_emits_play_cue_to_all_guns():
    g = SimGame(_dom(control_points=1)).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)
    # PlaySound(scope="all") → the cue reaches every gun. A capture from NEUTRAL is one
    # announcement to everybody; a STEAL is per-team instead (see test_hillbeacon.py).
    for pid in ("G1", "G2"):
        assert CAP_FRAME in g.frames_to(pid)


# =========================================================================== #
# FIXED (2026-08-25): DominationEngine.on_event now routes CAPTURE through       #
# _team() (the same zero/garbage guard CTF uses), so this is a live test.        #
# =========================================================================== #
def test_zero_team_token_ignored():
    # Regression: a zero team token used to fabricate + score a phantom "team0".
    #
    # Repro: a station sends "$CAPTURE,A,0,*" (a zero team token).
    # Expected (per DominationEngine docstring: "a missing/garbage/zero team token
    #   is ignored, not scored" — the same rule CTF enforces via _team()):
    #     the capture is a no-op; owner["A"] stays None; no team0 in the scoreboard.
    # Actual: on_event does `int(_ev(ev,2))` = 0 and calls capture(A, 0), which
    #   passes the `owner[site] == team` guard (None != 0), so it SETS owner["A"]=0,
    #   emits the capture cue, and tick() then accrues point-seconds to team0.
    # Root cause: DominationEngine.on_event bypasses the `_team()` zero/negative
    #   guard that CtfEngine uses; capture() has no team > 0 check.
    g = SimGame(_dom(control_points=1, score_target=0, game_time_s=0)).setup()
    g.station("ST", "$CAPTURE,A,0,*", now=0.0)
    g.tick(now=5.0)
    s = g.snapshot()
    assert s["owner"]["A"] is None, f"phantom team0 captured the point: {s['owner']}"
    assert 0 not in s["score"], f"phantom team0 was scored: {s['score']}"
    assert _cap_sound_count(g) == 0
