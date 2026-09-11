"""Exhaustive scenario suite for Infection (survival) and Last-Man-Standing, driven
end-to-end through the SimGame harness (real GameDriver + FakeTaggers, no BLE).

Each scenario asserts the CORRECT behaviour promised by the engine docstrings +
the gameconfig.py / modes/ docstrings (docs/m0-game-engine.md was retired 2026-09-06):
  * Infection (survival.py): a dead human respawns onto the INFECTED team (host flips
    $TID); last human falling ends the game (infected win); any human death flips the
    victim (regardless of who shot them); the win check is among-HUMANS (by team), not
    "an infected is alive".
  * LMS (lms.py): finite lives = respawns+1; eliminated only after the last life; last
    player / last team standing wins; a gun with lives left respawns and returns;
    time-limit resolves to most-lives.

Anything that FAILS and looks like a real engine bug is parked as `scenario_*` (NOT
`test_*`) with a `# SUSPECTED BUG:` note so the file stays green.
"""

from brx_mcp.gameconfig import GameConfig
from brx_mcp.sim import SimGame


# --------------------------------------------------------------------------- #
# Infection / survival                                                        #
# --------------------------------------------------------------------------- #

def test_infection_dead_human_flips_to_infected_with_tid_frame():
    """A human killed by the infected flips onto the infected team, and the flipped
    gun actually receives a `$TID,2` frame (SetTeam→driver→sender)."""
    g = SimGame(GameConfig(mode="infection", game_time_s=0),
                guns={"h1": 1, "h2": 1, "z": 2}).setup()
    g.kill("h1", shooter_team=2, now=1.0)          # infected kills h1
    snap = g.snapshot()
    assert snap["players"]["h1"]["team"] == 2, "dead human must join the infected team"
    assert "$TID,2,*" in g.frames_to("h1"), "flipped gun must get a $TID,<infected> frame"
    assert not g.over, "two humans still stood at seed time — game must not end yet"
    # F86 (bench 2026-09-10): the firmware moves hit resolution on `$TID` but leaves the LEDs on the old
    # colour, so the driver blanks then paints the NEW team right after the write -- the verified remedy.
    from brx_mcp import poolgauge as pg
    fr = g.frames_to("h1")
    i = fr.index("$TID,2,*")
    assert fr[i + 1] == pg.GUN_BLANK, fr[i:i + 4]
    assert fr[i + 2] == pg.team_frame(2, dim=True) and fr[i + 3] == pg.headset_team_frame(2), fr[i:i + 4]
    # CONTROL: the untouched human's gun got no repaint
    assert pg.GUN_BLANK not in g.frames_to("h2")[1:] or "$TID,2,*" not in g.frames_to("h2")


def test_infection_flipped_human_respawns_as_infected():
    """A dead human respawns (tick past respawn_s) — and comes back ALIVE on the
    infected team, having been sent $TID,2 and a $SPAWN."""
    g = SimGame(GameConfig(mode="infection", respawn_s=10, game_time_s=0),
                guns={"h1": 1, "h2": 1, "z": 2}).setup()
    g.kill("h1", shooter_team=2, now=1.0)
    assert not g.alive("h1")                        # down immediately after conversion
    g.tick(now=12.0)                                # 11s ≥ respawn_s → host revives it
    assert g.alive("h1"), "converted human must respawn"
    assert g.snapshot()["players"]["h1"]["team"] == 2, "respawns onto INFECTED team"
    tid = g.frames_to("h1").index("$TID,2,*")
    assert any(f.startswith("$SPAWN") for f in g.frames_to("h1")[tid:]), \
        "a $SPAWN follows the team flip on respawn"


def test_infection_last_human_falling_ends_game_infected_win():
    """The game ends the moment the LAST human falls; winner = infected."""
    g = SimGame(GameConfig(mode="infection", game_time_s=0),
                guns={"h1": 1, "h2": 1, "z": 2}).setup()
    g.kill("h1", shooter_team=2, now=1.0)
    assert not g.over
    g.kill("h2", shooter_team=2, now=2.0)          # last human
    assert g.over
    snap = g.snapshot()
    assert snap["winner"] == "infected"
    assert snap["humans_left"] == 0


def test_infection_single_seed_infects_progressively():
    """One seed grinds through a squad of humans; humans_left decays 3→2→1→0 and only
    the final kill ends it."""
    g = SimGame(GameConfig(mode="infection", game_time_s=0),
                guns={"h1": 1, "h2": 1, "h3": 1, "z": 2}).setup()
    assert g.snapshot()["humans_left"] == 3
    g.kill("h1", shooter_team=2, now=1.0)
    assert g.snapshot()["humans_left"] == 2 and not g.over
    g.kill("h2", shooter_team=2, now=2.0)
    assert g.snapshot()["humans_left"] == 1 and not g.over
    g.kill("h3", shooter_team=2, now=3.0)
    assert g.snapshot()["humans_left"] == 0 and g.over
    assert g.snapshot()["winner"] == "infected"


def test_infection_human_on_human_kill_flips_the_victim():
    """The conversion rule is cause-agnostic: a human killed by ANOTHER human (friendly
    fire is on by default) still flips the VICTIM to infected — never the shooter."""
    g = SimGame(GameConfig(mode="infection", game_time_s=0),
                guns={"h1": 1, "h2": 1, "z": 2}).setup()
    g.kill("h2", shooter_team=1, now=1.0)          # a fellow human's team-1 IR downs h2
    snap = g.snapshot()
    assert snap["players"]["h2"]["team"] == 2, "victim of a human kill still becomes infected"
    assert snap["players"]["h1"]["team"] == 1, "the shooter (h1) is unaffected"
    assert "$TID,2,*" in g.frames_to("h2")


def test_infection_infected_death_does_not_flip_or_end():
    """An infected getting shot by a human is a no-op for scoring: no SetTeam, no win,
    humans_left unchanged — the infected simply goes down (and will respawn)."""
    g = SimGame(GameConfig(mode="infection", respawn_s=10, game_time_s=0),
                guns={"h1": 1, "h2": 1, "z": 2}).setup()
    before = g.snapshot()["humans_left"]
    n_frames = len(g.frames_to("z"))               # frames already sent to z at setup
    g.kill("z", shooter_team=1, now=1.0)           # human downs the infected
    snap = g.snapshot()
    assert snap["humans_left"] == before, "shooting an infected must not change humans"
    assert snap["players"]["z"]["team"] == 2, "infected stays infected"
    new_frames = g.frames_to("z")[n_frames:]       # only what the death produced
    assert not any(f.startswith("$TID") for f in new_frames), \
        "an infected death issues no team flip (only humans convert)"
    assert not g.over
    g.tick(now=12.0)                                # infected respawns (unlimited lives)
    assert g.alive("z")


def test_infection_win_is_among_humans_not_alive_infected():
    """The win check counts HUMANS (by team), not "is an infected alive": with the sole
    infected currently DOWN, killing the last human still ends it as an infected win."""
    g = SimGame(GameConfig(mode="infection", respawn_s=60, game_time_s=0),
                guns={"h": 1, "z": 2}).setup()
    g.kill("z", shooter_team=1, now=1.0)           # infected is down (long respawn)
    assert not g.alive("z") and not g.over
    g.kill("h", shooter_team=2, now=2.0)           # last human falls while z is dead
    assert g.over, "no humans remain → infected win, even with the infected down"
    assert g.snapshot()["winner"] == "infected"


def test_infection_one_human_one_infected_ends_at_first_kill():
    """Edge: 1 human + 1 infected — the very first human death ends the game."""
    g = SimGame(GameConfig(mode="infection", game_time_s=0),
                guns={"h": 1, "z": 2}).setup()
    g.kill("h", shooter_team=2, now=1.0)
    assert g.over and g.snapshot()["winner"] == "infected"
    assert g.snapshot()["humans_left"] == 0


def test_infection_all_but_one_infected_already():
    """Edge: a lone human against a swarm — converting them ends it immediately."""
    g = SimGame(GameConfig(mode="infection", game_time_s=0),
                guns={"h": 1, "z1": 2, "z2": 2, "z3": 2}).setup()
    assert g.snapshot()["humans_left"] == 1
    g.kill("h", shooter_team=2, now=1.0)
    assert g.over and g.snapshot()["winner"] == "infected"


def test_infection_humans_win_at_time_limit_if_any_survive():
    """A configured time limit with a surviving human ends the game as a HUMAN win."""
    g = SimGame(GameConfig(mode="infection", game_time_s=5, respawn_s=99),
                guns={"h1": 1, "h2": 1, "z": 2}).setup()
    g.run_until_over(dt=1.0, start=1.0)             # ticks to now=5 → time up, humans alive
    assert g.over and g.snapshot()["winner"] == "humans"
    assert g.snapshot()["humans_left"] == 2


# --------------------------------------------------------------------------- #
# Last Man Standing                                                           #
# --------------------------------------------------------------------------- #

def test_lms_finite_lives_equals_respawns_plus_one():
    """lives = respawns + 1 (the engine's contract)."""
    g = SimGame(GameConfig(mode="lms", respawns=2, game_time_s=0),
                guns={"a": 1, "b": 2}).setup()
    players = g.snapshot()["players"]
    assert players["a"]["lives"] == 3 and players["b"]["lives"] == 3


def test_lms_one_life_eliminates_and_declares_last_standing():
    """respawns=0 → 1 life. The first death eliminates and the survivor wins."""
    g = SimGame(GameConfig(mode="lms", respawns=0, game_time_s=0),
                guns={"a": 1, "b": 2}).setup()
    g.kill("b", shooter_team=1, now=1.0)
    assert g.over
    snap = g.snapshot()
    assert snap["winner"] == "a", "last player standing wins by player id"
    assert snap["players"]["b"]["lives"] == 0


def test_lms_gun_with_lives_left_respawns_and_returns():
    """A death with lives remaining does NOT eliminate; the gun respawns after the
    delay and rejoins alive — the game keeps running."""
    g = SimGame(GameConfig(mode="lms", respawns=2, respawn_s=10, game_time_s=0),
                guns={"a": 1, "b": 2}).setup()
    g.kill("b", shooter_team=1, now=1.0)
    assert not g.alive("b") and not g.over
    assert g.snapshot()["players"]["b"]["lives"] == 2   # 3 → 2, still in
    g.tick(now=12.0)                                     # 11s ≥ respawn_s
    assert g.alive("b"), "a gun with lives left must come back"
    assert not g.over
    assert any(f.startswith("$SPAWN") for f in g.frames_to("b"))


def test_lms_eliminated_only_after_the_last_life_is_spent():
    """A 2-life gun survives its first death (respawns) and is eliminated only on the
    second — then the opponent wins."""
    g = SimGame(GameConfig(mode="lms", respawns=1, respawn_s=5, game_time_s=0),
                guns={"a": 1, "b": 2}).setup()
    g.kill("b", shooter_team=1, now=1.0)                 # 2 → 1 life, down but IN
    assert not g.over and g.snapshot()["players"]["b"]["lives"] == 1
    g.tick(now=7.0)                                      # respawns on its last life
    assert g.alive("b")
    g.kill("b", shooter_team=1, now=8.0)                 # 1 → 0 → eliminated
    assert g.over and g.snapshot()["winner"] == "a"
    assert g.snapshot()["players"]["b"]["lives"] == 0


def test_lms_last_team_standing_wins():
    """With multiple players per team, wiping a whole team leaves one side → team win."""
    g = SimGame(GameConfig(mode="lms", respawns=0, game_time_s=0),
                guns={"a": 1, "b": 1, "c": 2}).setup()
    g.kill("c", shooter_team=1, now=1.0)                 # team 2 wiped (1 life each)
    assert g.over
    assert g.snapshot()["winner"] == "team1", "last team standing wins by team label"


def test_lms_ends_immediately_when_only_one_side_remains():
    """The game ends the instant only one team is left standing — not after further
    deaths. Two survivors on the winning team both remain alive at game end."""
    g = SimGame(GameConfig(mode="lms", respawns=0, game_time_s=0),
                guns={"a": 1, "b": 1, "c": 2, "d": 2}).setup()
    g.kill("c", shooter_team=1, now=1.0)
    assert not g.over, "team 2 still has d"
    g.kill("d", shooter_team=1, now=2.0)                 # team 2 fully wiped
    assert g.over and g.snapshot()["winner"] == "team1"
    assert g.alive("a") and g.alive("b"), "winners never had to die"


def test_lms_multi_team_wins_after_repeated_respawns():
    """A gun burns through several lives (respawning each time) and is only eliminated
    on its final death — a fuller life-cycle, not just a single trade."""
    g = SimGame(GameConfig(mode="lms", respawns=2, respawn_s=5, game_time_s=0),
                guns={"a": 1, "b": 2}).setup()
    now = 1.0
    for expected_lives in (2, 1):                        # 3→2→1, respawning each time
        g.kill("b", shooter_team=1, now=now)
        assert not g.over and g.snapshot()["players"]["b"]["lives"] == expected_lives
        now += 5.0
        g.tick(now=now)                                  # respawn
        assert g.alive("b")
        now += 1.0
    g.kill("b", shooter_team=1, now=now)                 # 1→0 → eliminated
    assert g.over and g.snapshot()["winner"] == "a"


def test_lms_two_finalists_resolve_to_single_winner_no_false_draw():
    """Sequential elimination of the second-to-last player yields the OTHER as sole
    winner — never a spurious 'draw' (draw is only for an empty field)."""
    g = SimGame(GameConfig(mode="lms", respawns=0, game_time_s=0),
                guns={"a": 1, "b": 2}).setup()
    g.kill("a", shooter_team=2, now=1.0)
    assert g.over
    assert g.snapshot()["winner"] == "b", "one finalist eliminated → the other wins"


def test_lms_time_limit_resolves_to_most_lives():
    """Time-limit end with several teams still in → the gun with the most lives wins."""
    g = SimGame(GameConfig(mode="lms", respawns=5, respawn_s=99, game_time_s=5),
                guns={"a": 1, "b": 2}).setup()
    g.kill("a", shooter_team=2, now=1.0)                 # a spends a life (6→5); b stays 6
    g.run_until_over(dt=1.0, start=2.0)                  # ticks to now=5 → time up
    assert g.over
    snap = g.snapshot()
    assert snap["players"]["b"]["lives"] == 6 and snap["players"]["a"]["lives"] == 5
    assert snap["winner"] == "b", "most lives left wins on the clock"


def test_lms_default_lives_when_respawns_unset():
    """LMS forces finite lives even if respawns was left unlimited: default is 3."""
    g = SimGame(GameConfig(mode="lms", game_time_s=0),
                guns={"a": 1, "b": 2}).setup()
    assert g.snapshot()["players"]["a"]["lives"] == 3
