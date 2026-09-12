"""Proves the SimGame harness drives every mode family end-to-end (guns + station
events + timers). The exhaustive per-mode scenarios live in test_sim_<family>.py."""

from brx_mcp.gameconfig import GameConfig
from sim import SimGame


def test_sim_tdm_kill_to_frag_limit():
    g = SimGame(GameConfig(mode="tdm", frag_limit=1, game_time_s=0)).setup()
    g.kill("G2", shooter_team=1)                  # G1(team1) kills G2(team2)
    assert g.over and g.snapshot()["winner"] == "team1"


def test_sim_tdm_respawn_then_kill_again():
    g = SimGame(GameConfig(mode="tdm", frag_limit=2, respawn_s=5, game_time_s=0)).setup()
    g.kill("G2", 1, now=1.0)                       # kill 1
    assert not g.alive("G2")
    g.tick(now=7.0)                                # past respawn_s → G2 back (sender $SPAWN)
    assert g.alive("G2")
    g.kill("G2", 1, now=8.0)                       # kill 2 → frag limit
    assert g.over and g.snapshot()["team_score"][1] == 2


def test_sim_domination_station_capture_and_hold():
    cfg = GameConfig(mode="domination", control_points=1, score_target=5, game_time_s=0)
    g = SimGame(cfg).setup()
    g.station("ST", "$CAPTURE,A,1,*", now=0.0)     # team1 takes the point
    g.tick(now=6.0)                                # holds 6s ≥ target 5
    assert g.over and g.snapshot()["winner"] == "team1"


def test_sim_ctf_station_grab_cap():
    g = SimGame(GameConfig(mode="ctf", cap_target=1, game_time_s=0)).setup()
    g.station("ST", "$GRAB,flag,1,*")
    g.station("ST", "$CAP,1,*")
    assert g.over and g.snapshot()["winner"] == "team1"


def test_sim_cs_plant_detonates():
    g = SimGame(GameConfig(mode="cs", detonation_s=8, rounds_to_win=0)).setup()
    g.station("ST", "$PLANT,A,*", now=1.0)
    g.tick(now=10.0)                               # 9s ≥ detonation → attackers win
    assert g.over and g.snapshot()["winner"] == "attackers"


def test_sim_extraction_loot_zone_extract():
    cfg = GameConfig(mode="extraction", channel_s=10, win_target=15, game_time_s=0)
    g = SimGame(cfg).setup()
    g.station("G1", "$LOOT,15,*", now=0.0)         # extraction events keyed to the gun
    g.station("G1", "$ZONE,Alpha,*", now=1.0)
    g.tick(now=12.0)                               # held 11s ≥ channel 10 → extract → win
    assert g.over and g.snapshot()["winner"] == "G1"


def test_sim_frames_to_gun_include_setup_and_teardown():
    g = SimGame(GameConfig(mode="tdm", frag_limit=1, game_time_s=0)).setup()
    setup_frames = g.frames_to("G1")
    assert any(f.startswith("$TID,") for f in setup_frames)   # team pushed
    assert any(f.startswith("$SPAWN") for f in setup_frames)  # spawned live
    g.kill("G2", 1)
    g.teardown()
    assert "$SPAWN,,*" in g.frames_to("G1")                   # teardown revive
