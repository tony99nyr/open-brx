"""Tests for the M0 mode engines + the driver (pure, no BLE)."""

import asyncio

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import (
    DeathmatchEngine, InfectionEngine, LastManStandingEngine, GameDriver,
    build_engine, GameOver, Respawn, Score, Eliminate, SetTeam, Callout,
)


def hir(shooter_team):
    return {"command": "HIR", "tokens": ["HIR", "0", "0", "0", str(shooter_team), "9", "0", "3"]}


def hir_grenade():
    return {"command": "HIR", "tokens": ["HIR", "0", "15", "0", "2", "8", "0", "0"]}


def death():
    return {"command": "HP", "tokens": ["HP", "0", "0", "0"]}


def _types(actions, typ):
    return [a for a in actions if isinstance(a, typ)]


# ---- deathmatch (TDM) ------------------------------------------------------- #
def test_tdm_scores_kill_by_team():
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0))
    e.add_player("red", 1)
    e.add_player("blue", 2)
    # blue(team2) shoots red → red reports $HIR shooter team 2, then dies
    e.on_event("red", hir(2), now=1.0)
    acts = e.on_event("red", death(), now=1.1)
    sc = _types(acts, Score)
    assert sc and sc[0].total == 1
    assert e.team_score[2] == 1


def test_tdm_no_score_for_friendly_or_grenade():
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0))
    e.add_player("red", 1)
    # same-team shooter (team 1) → no score
    e.on_event("red", hir(1), now=1.0)
    acts = e.on_event("red", death(), now=1.1)
    assert not _types(acts, Score)
    # grenade beacon must not count as a kill
    e2 = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0))
    e2.add_player("red", 1)
    e2.on_event("red", hir_grenade(), now=1.0)
    acts2 = e2.on_event("red", death(), now=1.1)
    assert not _types(acts2, Score)


def test_tdm_host_respawn_after_delay():
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0, respawn_s=15))
    e.add_player("red", 1)
    e.on_event("red", hir(2), now=0.0)
    e.on_event("red", death(), now=0.0)
    assert e.tick(now=10.0) == []              # too soon
    acts = e.tick(now=15.0)
    assert _types(acts, Respawn) and e.roster.get("red").alive


def test_tdm_frag_limit_ends_game():
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0, frag_limit=1))
    e.add_player("red", 1)
    e.add_player("blue", 2)
    e.on_event("red", hir(2), now=1.0)
    acts = e.on_event("red", death(), now=1.1)
    assert _types(acts, GameOver) and e.over


def test_tdm_time_limit_ends_game():
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=300))
    e.add_player("red", 1)
    e.add_player("blue", 2)
    assert e.tick(now=299.0) == []
    acts = e.tick(now=300.0)
    assert _types(acts, GameOver)


# ---- FFA (per-player credit) ----------------------------------------------- #
def test_ffa_credits_specific_killer():
    e = DeathmatchEngine(GameConfig(mode="ffa", game_time_s=0))
    e.add_player("alice", 1)
    e.add_player("bob", 2)
    e.on_event("alice", hir(2), now=1.0)       # bob (team 2) killed alice
    e.on_event("alice", death(), now=1.1)
    assert e.roster.get("bob").kills == 1


# ---- infection -------------------------------------------------------------- #
def test_infection_flips_dead_human_to_infected():
    e = InfectionEngine(GameConfig(mode="infection", game_time_s=0))
    e.add_player("h1", 1)   # human
    e.add_player("h2", 1)   # human
    e.add_player("z", 2)    # infected
    acts = e.on_event("h1", death(), now=1.0)
    assert _types(acts, SetTeam)[0].team == 2
    assert e.roster.get("h1").team == 2


def test_infection_last_human_wins():
    e = InfectionEngine(GameConfig(mode="infection", game_time_s=0))
    e.add_player("h1", 1)
    e.add_player("z", 2)
    acts = e.on_event("h1", death(), now=1.0)   # last human infected
    over = _types(acts, GameOver)
    assert over and over[0].winner == "infected"


# ---- last man standing ------------------------------------------------------ #
def test_lms_eliminates_at_zero_lives_and_declares_winner():
    e = LastManStandingEngine(GameConfig(mode="lms", respawns=0, game_time_s=0))  # 1 life
    e.add_player("a", 1)
    e.add_player("b", 2)
    acts = e.on_event("a", death(), now=1.0)    # a out (1 life)
    assert _types(acts, Eliminate)
    over = _types(acts, GameOver)
    assert over and over[0].winner == "b"       # b last standing


def test_lms_respawns_while_lives_remain():
    e = LastManStandingEngine(GameConfig(mode="lms", respawns=2, respawn_s=10, game_time_s=0))
    e.add_player("a", 1)
    e.add_player("b", 2)
    e.on_event("a", death(), now=0.0)           # a: 3→2 lives
    acts = e.tick(now=10.0)
    assert _types(acts, Respawn) and not e.over


# ---- build_engine + driver -------------------------------------------------- #
def test_build_engine_maps_modes():
    assert isinstance(build_engine(GameConfig(mode="tdm")), DeathmatchEngine)
    assert isinstance(build_engine(GameConfig(mode="infection")), InfectionEngine)
    assert isinstance(build_engine(GameConfig(mode="lms")), LastManStandingEngine)


def test_build_engine_rejects_unknown():
    try:
        build_engine(GameConfig(mode="nope"))
        assert False, "should have raised"
    except ValueError:
        pass


def test_driver_executes_respawn_via_sender():
    sent = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    cfg = GameConfig(mode="tdm", game_time_s=0, respawn_s=5)
    drv = GameDriver(cfg, {"red": 1, "blue": 2}, sender)

    async def scenario():
        # blue kills red
        await drv.execute(drv.feed("red", hir(2), now=0.0))
        await drv.execute(drv.feed("red", death(), now=0.0))
        # respawn fires at tick after the delay → sender gets the respawn frames
        await drv.execute(drv.tick(now=5.0))

    asyncio.run(scenario())
    assert any("$SPAWN" in f for _, f in sent), f"no respawn frames sent: {sent}"


def test_driver_setup_configs_then_spawns_all_guns():
    order = []

    async def sender(pid, frame):
        order.append((pid, frame))

    drv = GameDriver(GameConfig(mode="tdm"), {"g1": 1, "g2": 2}, sender)
    asyncio.run(drv.setup())
    # every gun got $START (config) BEFORE any $SPAWN (barrier), and both spawned
    first_spawn = next(i for i, (_, f) in enumerate(order) if f.startswith("$SPAWN"))
    last_start = max(i for i, (_, f) in enumerate(order) if f == "$START,*")
    assert last_start < first_spawn
    spawned = {pid for pid, f in order if f.startswith("$SPAWN")}
    assert spawned == {"g1", "g2"}
