"""Hardware-free integration tests: run the FULL live path (run_live + driver +
scoring + teardown) against FakeTaggers, no bleak, no bench.

What these VALIDATE: the run_live control flow + DeathmatchEngine scoring against
an in-memory gun — kill attribution, host respawn, frag-limit end + winner, team
assignment, config-all-then-spawn ordering, FFA specific-killer credit, teardown
revive, and survival of a mid-game link drop. What they do NOT validate (needs
hardware — see docs/experiment-log.md 2026-08-25): real BLE reliability/timing,
MTU chunking, physical LED/headset/audio state, native firmware multikill audio,
or that $GSET/weapon config changes on-gun damage."""

import asyncio

from brx_mcp.gameconfig import GameConfig
from brx_mcp.fake import FakeTagger, FakeConnectionManager
from brx_mcp.modes.driver import run_live


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---- FakeTagger unit behaviour --------------------------------------------- #
def test_faketagger_hit_emits_hir_and_hp_then_dies():
    t = FakeTagger("AA:1", team=2, hp=45, armor=70, damage=25)
    t.receive_ir(shooter_team=1)                     # enemy hit
    out = t.drain()
    assert any(o.startswith("$HIR,0,0,0,1,") for o in out)   # shooter team 1 in token4
    assert any(o.startswith("$HP,") for o in out)
    assert t.alive                                    # 25 dmg vs 70 armor → survives
    for _ in range(10):
        t.receive_ir(1)
    assert not t.alive and t.hp == 0
    assert any(o.startswith("$HP,0,") for o in t.drain())     # death frame


def test_faketagger_friendly_off_and_dead_are_noops():
    t = FakeTagger("AA:1", team=1)                   # friendly_fire off by default
    t.receive_ir(shooter_team=1)                     # same team, FF off → no damage
    assert t.drain() == [] and t.armor == 70
    t.hp = 0; t.alive = False
    t.receive_ir(shooter_team=2)                     # dead → no events
    assert t.drain() == []


def test_faketagger_friendly_fire_on_damages_same_team():
    t = FakeTagger("AA:1", team=1, friendly_fire=True)
    t.receive_ir(shooter_team=1)                     # same team, FF on → registers
    assert t.drain() and t.armor < 70
    # and $GSET token1=1 turns FF on the way a real game config does
    t2 = FakeTagger("BB:2", team=1)
    t2.write("$GSET,1,0,1,0,1,0,50,1,*")
    assert t2.friendly_fire is True
    t2.receive_ir(1)
    assert t2.drain()


def test_faketagger_spawn_revives_and_config_sets_health():
    t = FakeTagger("AA:1", team=2)
    t.write("$PSET,0,0,60,80,0,*")                    # config hp=60 armor=80
    for _ in range(20):
        t.receive_ir(1)
    assert not t.alive
    t.drain()
    t.write("$SPAWN,,*")                              # revive to configured health
    assert t.alive and t.hp == 60 and t.armor == 80
    assert any(o.startswith("$LCD,60,80") for o in t.drain())


# ---- full game through run_live -------------------------------------------- #
def test_fake_run_live_full_tdm_game():
    A = FakeTagger("AA:1", name="A")
    B = FakeTagger("BB:2", name="B")
    mgr = FakeConnectionManager([A, B])
    cfg = GameConfig(mode="tdm", frag_limit=1, respawn_s=1, game_time_s=0)

    async def play():
        task = asyncio.ensure_future(
            run_live(cfg, ["AA:1", "BB:2"], manager=mgr, tick_s=0.01))
        await asyncio.sleep(0.08)                     # let connect+setup complete
        assert A.team == 1 and B.team == 2            # setup pushed $TID (assign_teams)
        mgr.inject_kill("BB:2", shooter_team=1)       # A (team1) kills B
        return await asyncio.wait_for(task, timeout=5)

    snap = _run(play())
    assert snap["over"] is True
    assert snap["winner"] == "team1"
    assert snap["team_score"][1] == 1


def test_fake_teardown_revives_dead_gun():
    # the loser (dead at frag-limit) must be revived by END_SEQUENCE, not left stuck.
    A = FakeTagger("AA:1"); B = FakeTagger("BB:2")
    mgr = FakeConnectionManager([A, B])
    cfg = GameConfig(mode="tdm", frag_limit=1, respawn_s=1, game_time_s=0)

    async def play():
        task = asyncio.ensure_future(
            run_live(cfg, ["AA:1", "BB:2"], manager=mgr, tick_s=0.01))
        await asyncio.sleep(0.08)
        mgr.inject_kill("BB:2", shooter_team=1)      # B dies
        return await asyncio.wait_for(task, timeout=5)

    _run(play())
    assert B.alive and B.hp == B.cfg_hp              # teardown $SPAWN revived it


def test_fake_run_live_survives_mid_game_drop():
    # a gun's BLE link dying mid-match must NOT crash run_live; it still ends + tears down.
    A = FakeTagger("AA:1"); B = FakeTagger("BB:2")
    mgr = FakeConnectionManager([A, B])
    cfg = GameConfig(mode="tdm", frag_limit=0, respawn_s=1, game_time_s=1)  # ends on time

    async def play():
        task = asyncio.ensure_future(
            run_live(cfg, ["AA:1", "BB:2"], manager=mgr, tick_s=0.02))
        await asyncio.sleep(0.1)
        mgr.drop("BB:2")                             # B's link dies (send raises, reads silent)
        return await asyncio.wait_for(task, timeout=8)

    snap = _run(play())
    assert snap["over"] is True                      # game still completed despite the drop


def test_fake_run_live_connect_grace_one_gun_fails():
    # BLE establishment is flaky — a gun that won't connect must NOT abort the game;
    # run_live plays with whoever came up.
    A = FakeTagger("AA:1"); B = FakeTagger("BB:2"); C = FakeTagger("CC:3")
    mgr = FakeConnectionManager([A, B, C])
    mgr.fail_connect.add("BB:2")                     # B refuses to connect
    cfg = GameConfig(mode="ffa", frag_limit=1, respawn_s=1, game_time_s=0)

    async def play():
        task = asyncio.ensure_future(
            run_live(cfg, ["AA:1", "BB:2", "CC:3"], manager=mgr, tick_s=0.01))
        await asyncio.sleep(0.08)
        mgr.inject_kill("CC:3", shooter_team=A.team)
        return await asyncio.wait_for(task, timeout=5)

    snap = _run(play())
    assert snap["over"] and snap["winner"] == "AA:1"
    assert "BB:2" not in snap["players"]             # the unconnected gun isn't in the game


def test_fake_run_live_force_stops_on_stall():
    # a frag game (no clock) where the opponent drops so no more kills happen must
    # NOT hang — the wall-clock safety force-stops it.
    A = FakeTagger("AA:1"); B = FakeTagger("BB:2")
    mgr = FakeConnectionManager([A, B])
    cfg = GameConfig(mode="tdm", frag_limit=5, game_time_s=0, respawn_s=1)

    async def play():
        task = asyncio.ensure_future(
            run_live(cfg, ["AA:1", "BB:2"], manager=mgr, tick_s=0.02, max_s=0.3))
        await asyncio.sleep(0.05)
        mgr.drop("BB:2")                             # opponent gone; frag_limit=5 unreachable
        return await asyncio.wait_for(task, timeout=5)

    snap = _run(play())
    assert snap.get("force_stopped") is True and snap["over"] is False


def test_fake_run_live_no_taggers_connect_returns_error():
    A = FakeTagger("AA:1"); B = FakeTagger("BB:2")
    mgr = FakeConnectionManager([A, B])
    mgr.fail_connect.update(["AA:1", "BB:2"])        # nobody connects
    cfg = GameConfig(mode="tdm", frag_limit=1)
    snap = _run(run_live(cfg, ["AA:1", "BB:2"], manager=mgr, tick_s=0.01))
    assert snap.get("error") == "no taggers connected" and snap["over"] is False


def test_fake_run_live_ffa_credits_specific_gun():
    A = FakeTagger("AA:1"); B = FakeTagger("BB:2"); C = FakeTagger("CC:3")
    mgr = FakeConnectionManager([A, B, C])
    cfg = GameConfig(mode="ffa", frag_limit=1, respawn_s=1, game_time_s=0)

    async def play():
        task = asyncio.ensure_future(
            run_live(cfg, ["AA:1", "BB:2", "CC:3"], manager=mgr, tick_s=0.01))
        await asyncio.sleep(0.08)
        # FFA → unique teams; A is team1. A kills C.
        mgr.inject_kill("CC:3", shooter_team=A.team)
        return await asyncio.wait_for(task, timeout=5)

    snap = _run(play())
    assert snap["over"] and snap["winner"] == "AA:1"   # the specific killer, not a team
