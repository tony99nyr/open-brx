"""Exhaustive Capture-the-Flag scenarios over the SimGame harness.

CTF drives the whole stack (config→spawn setup, CtfEngine rules, driver execution)
with in-memory guns instead of Bluetooth. Objective events come from a STATION
device, so the team is the explicit token in the frame — NOT a roster player. We
therefore feed station events on a NON-gun node id ("ST"): the engine resolves the
team from the token, never the roster. (Feeding on a gun id would let the roster
override the token — that path is the gun-death callout, tested separately.)

Behaviour asserted here is the CtfEngine contract (objectives.py docstring +
docs/m0-game-engine.md): per-team possession `held`; a CAP scores only if that team
is carrying; a DROP returns the flag home; malformed/zero/missing team tokens are
ignored (never fabricate team0); first to cap_target wins; on the clock the caps
leader wins and a tie is a draw; everything is inert after game over.

Default guns: G1→team1, G2→team2 (so caps is seeded {1:0, 2:0}).
"""

from brx_mcp.gameconfig import GameConfig
from brx_mcp.sim import SimGame

ST = "ST"   # a station node id — NOT a gun, so team comes from the token


def _ctf(cap_target=3, game_time_s=0, **kw):
    return SimGame(GameConfig(mode="ctf", cap_target=cap_target,
                              game_time_s=game_time_s, **kw)).setup()


# --------------------------------------------------------------------------- #
# Scoring: grab → cap                                                          #
# --------------------------------------------------------------------------- #
def test_grab_then_cap_scores_once():
    """A GRAB then a CAP records exactly one capture and clears possession."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,1,*")
    assert g.snapshot()["held"] == [1]          # carrying
    g.station(ST, "$CAP,1,*")
    s = g.snapshot()
    assert s["caps"][1] == 1                     # scored once
    assert s["held"] == []                       # flag returned on the cap
    assert not g.over                            # target 3 not reached


def test_reach_cap_target_that_team_wins():
    """Two grab→cap cycles reach cap_target=2 → that team wins."""
    g = _ctf(cap_target=2)
    g.station(ST, "$GRAB,flag,1,*")
    g.station(ST, "$CAP,1,*")
    assert not g.over and g.snapshot()["caps"][1] == 1
    g.station(ST, "$GRAB,flag,1,*")
    g.station(ST, "$CAP,1,*")
    s = g.snapshot()
    assert g.over and s["winner"] == "team1" and s["caps"][1] == 2


def test_caps_accumulate_without_winning():
    """Captures accumulate on a team while the target is still out of reach."""
    g = _ctf(cap_target=5)
    for _ in range(3):
        g.station(ST, "$GRAB,flag,1,*")
        g.station(ST, "$CAP,1,*")
    assert not g.over and g.snapshot()["caps"][1] == 3


def test_both_teams_score_independently():
    """Each team banks its own captures; the tally tracks both."""
    g = _ctf(cap_target=9)
    g.station(ST, "$GRAB,flag,1,*"); g.station(ST, "$CAP,1,*")
    g.station(ST, "$GRAB,flag,2,*"); g.station(ST, "$CAP,2,*")
    g.station(ST, "$GRAB,flag,2,*"); g.station(ST, "$CAP,2,*")
    caps = g.snapshot()["caps"]
    assert caps[1] == 1 and caps[2] == 2 and not g.over


def test_double_grab_then_cap_scores_once():
    """Possession is a per-team flag: two GRABs before a CAP still score once."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,1,*")
    g.station(ST, "$GRAB,flag,1,*")        # redundant grab (already carrying)
    assert g.snapshot()["held"] == [1]
    g.station(ST, "$CAP,1,*")
    assert g.snapshot()["caps"][1] == 1


# --------------------------------------------------------------------------- #
# CAP guards: no possession → no score                                        #
# --------------------------------------------------------------------------- #
def test_cap_without_grab_does_not_score():
    """A CAP with no prior GRAB (team isn't carrying) does NOT score."""
    g = _ctf(cap_target=3)
    g.station(ST, "$CAP,1,*")
    s = g.snapshot()
    assert s["caps"].get(1, 0) == 0 and not g.over and s["held"] == []


def test_cap_after_drop_does_not_score():
    """After a DROP returns the flag, a CAP does NOT score (nothing to capture)."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,1,*")
    g.station(ST, "$DROP,1,*")             # flag returned home
    assert g.snapshot()["held"] == []
    g.station(ST, "$CAP,1,*")              # can't cap — not carrying
    assert g.snapshot()["caps"].get(1, 0) == 0 and not g.over


def test_drop_without_grab_is_noop():
    """A DROP for a team that isn't carrying is a harmless no-op."""
    g = _ctf(cap_target=3)
    g.station(ST, "$DROP,1,*")
    assert g.snapshot()["held"] == [] and not g.over


# --------------------------------------------------------------------------- #
# Possession tracking: held reflects who's carrying                           #
# --------------------------------------------------------------------------- #
def test_grab_sets_and_drop_clears_held():
    """GRAB sets possession; DROP clears it; the snapshot's held tracks both."""
    g = _ctf(cap_target=3)
    assert g.snapshot()["held"] == []
    g.station(ST, "$GRAB,flag,1,*")
    assert g.snapshot()["held"] == [1]
    g.station(ST, "$DROP,1,*")
    assert g.snapshot()["held"] == []


def test_held_tracks_both_carriers():
    """Two teams can carry at once; held lists every current carrier, sorted."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,1,*")
    g.station(ST, "$GRAB,flag,2,*")
    assert g.snapshot()["held"] == [1, 2]
    g.station(ST, "$CAP,1,*")              # team1 caps → only team2 still carrying
    assert g.snapshot()["held"] == [2]


# --------------------------------------------------------------------------- #
# Team resolution from the explicit station token                             #
# --------------------------------------------------------------------------- #
def test_team_from_explicit_token_credits_that_team():
    """$GRAB,flag,2 / $CAP,2 on a station node credit team2 (the TOKEN, not the
    roster — the node "ST" is not a gun)."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,2,*")
    assert g.snapshot()["held"] == [2]
    g.station(ST, "$CAP,2,*")
    assert g.snapshot()["caps"][2] == 1


def test_malformed_grab_team_ignored():
    """A non-integer team token ($GRAB,flag,red) is ignored: no crash, no score."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,red,*")
    s = g.snapshot()
    assert s["held"] == [] and s["caps"] == {1: 0, 2: 0}


def test_malformed_cap_team_ignored():
    """A non-integer CAP team token ($CAP,x) is ignored: no crash, no score."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,1,*")        # team1 IS carrying
    g.station(ST, "$CAP,x,*")              # garbage team → not resolved, no score
    assert g.snapshot()["caps"].get(1, 0) == 0 and g.snapshot()["held"] == [1]


def test_missing_team_token_ignored_no_phantom_team0():
    """A bare GRAB/CAP with no team token is ignored — no phantom team0 appears."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,*")
    g.station(ST, "$CAP,*")
    s = g.snapshot()
    assert s["held"] == [] and 0 not in s["caps"]


def test_zero_team_token_ignored():
    """A zero team token ($GRAB,flag,0) is rejected — team 0 is never fabricated."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,0,*")
    s = g.snapshot()
    assert s["held"] == [] and 0 not in s["caps"]


# --------------------------------------------------------------------------- #
# Carrier death (gun $HP,0) — a callout, but the station owns the real DROP    #
# --------------------------------------------------------------------------- #
def test_carrier_death_does_not_change_held():
    """A carrier's gun going to $HP,0 emits a death callout but does NOT itself
    return the flag — possession only clears when the station reports the DROP."""
    g = _ctf(cap_target=3)
    g.station(ST, "$GRAB,flag,1,*")        # team1 is carrying
    g.kill("G1", shooter_team=2)           # G1 (team1) killed → $HP,0
    s = g.snapshot()
    assert s["players"]["G1"]["alive"] is False   # death processed (callout path)
    assert s["held"] == [1]                        # still carrying — no auto-return
    g.station(ST, "$DROP,1,*")             # the station reports the real return
    assert g.snapshot()["held"] == []


# --------------------------------------------------------------------------- #
# Time-limit endings                                                          #
# --------------------------------------------------------------------------- #
def test_time_limit_leader_wins():
    """With a high cap_target and a clock, the caps leader wins when time runs out."""
    g = _ctf(cap_target=99, game_time_s=60)
    g.station(ST, "$GRAB,flag,1,*")
    g.station(ST, "$CAP,1,*")              # team1: 1, team2: 0
    g.tick(now=60.0)
    s = g.snapshot()
    assert g.over and s["winner"] == "team1"


def test_time_limit_tie_is_draw():
    """Equal caps at time-up → a draw (no single leader)."""
    g = _ctf(cap_target=99, game_time_s=60)
    g.station(ST, "$GRAB,flag,1,*"); g.station(ST, "$CAP,1,*")
    g.station(ST, "$GRAB,flag,2,*"); g.station(ST, "$CAP,2,*")
    g.tick(now=60.0)
    s = g.snapshot()
    assert g.over and s["winner"] == "draw"


def test_time_limit_no_caps_is_draw():
    """Nobody scored before time-up → a draw."""
    g = _ctf(cap_target=99, game_time_s=30)
    g.tick(now=30.0)
    assert g.over and g.snapshot()["winner"] == "draw"


# --------------------------------------------------------------------------- #
# Idempotency after game over                                                 #
# --------------------------------------------------------------------------- #
def test_no_scoring_after_game_over():
    """Once won, further GRAB/CAP/DROP/tick/kill change nothing."""
    g = _ctf(cap_target=1)
    g.station(ST, "$GRAB,flag,1,*")
    g.station(ST, "$CAP,1,*")
    assert g.over and g.snapshot()["winner"] == "team1"
    before = g.snapshot()
    g.station(ST, "$GRAB,flag,2,*")
    g.station(ST, "$CAP,2,*")
    g.station(ST, "$DROP,1,*")
    g.kill("G2", shooter_team=1)
    g.tick(now=999.0)
    after = g.snapshot()
    assert after["over"] and after["winner"] == "team1"
    assert after["caps"] == before["caps"] == {1: 1, 2: 0}
    assert after["held"] == []
