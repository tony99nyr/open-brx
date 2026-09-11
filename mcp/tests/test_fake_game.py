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

from _async import run as _run

from brx_mcp.gameconfig import GameConfig
from brx_mcp.fake import FakeTagger, FakeConnectionManager
from brx_mcp.modes.driver import run_live




# ---- FakeTagger unit behaviour --------------------------------------------- #
def test_faketagger_hit_emits_hir_and_hp_then_dies():
    t = FakeTagger("AA:1", team=2, hp=45, armor=70, damage=25)
    t.receive_ir(shooter_team=1)                     # enemy hit
    out = t.drain()
    assert any(o.startswith("$HIR,0,0,1,1,") for o in out)   # wire id 1, shooter team 1
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


# ---- F96: more guns than the wire has teams --------------------------------- #
def test_run_live_refuses_a_fifth_ffa_gun_with_a_readable_error():
    """The exposed caller. FFA needs one `$TID` per gun and the wire only has four teams, so a
    fifth gun would be armed on `$TID,4` — a team that does not exist, whose shots read friendly to
    a real team while it still takes their damage (F96/F35). The operator gets the same
    `{"over": False, "error": ...}` shape as "no taggers connected", not a traceback.

    Checked AFTER connecting on purpose: a 5-gun run where one gun never connects is a legal 4-gun
    game, and refusing on the REQUESTED list would have blocked it.
    """
    guns = [FakeTagger(f"AA:{i}", name=f"G{i}") for i in range(5)]
    mgr = FakeConnectionManager(guns)
    cfg = GameConfig(mode="ffa", frag_limit=1, game_time_s=0)

    async def play():
        # ⚠ `wait_for`, not a bare await: WITHOUT the refusal this does not fail, it HANGS — the
        # game happily arms five guns on $TID 0-4 and then loops to run_live's 1-hour wall-clock
        # cap, because nobody in this scenario ever shoots. A guard that takes an hour to disagree
        # is a guard nobody runs, so the disagreement is bounded to five seconds.
        return await asyncio.wait_for(
            run_live(cfg, [g.address for g in guns], manager=mgr, tick_s=0.01), timeout=5)

    out = _run(play())
    assert out["over"] is False
    assert "0-3" in out["error"] and "F96" in out["error"], out["error"]
    assert len(out["connected"]) == 5                 # it connected, then refused to arm

    # CONTROL: four of the same guns play a real game to a real end, so the refusal is about the
    # fifth gun and not about FFA on this path at all.
    four = [FakeTagger(f"BB:{i}", name=f"H{i}") for i in range(4)]
    mgr4 = FakeConnectionManager(four)

    async def play4():
        task = asyncio.ensure_future(
            run_live(cfg, [g.address for g in four], manager=mgr4, tick_s=0.01))
        await asyncio.sleep(0.08)
        assert sorted(g.team for g in four) == [0, 1, 2, 3]   # every $TID a real wire team
        mgr4.inject_kill("BB:1", shooter_team=four[0].team)
        return await asyncio.wait_for(task, timeout=5)

    snap = _run(play4())
    assert snap["over"] and "error" not in snap, snap


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


def test_fake_run_live_reconnects_dropped_gun():
    # a recoverable mid-game drop is brought back (reconnect + resetup) so the gun
    # rejoins and the game can still finish — not lost for the rest of the match.
    A = FakeTagger("AA:1"); B = FakeTagger("BB:2")
    mgr = FakeConnectionManager([A, B])
    cfg = GameConfig(mode="tdm", frag_limit=1, game_time_s=0, respawn_s=1)

    async def play():
        task = asyncio.ensure_future(
            run_live(cfg, ["AA:1", "BB:2"], manager=mgr, tick_s=0.01))
        await asyncio.sleep(0.05)
        mgr.drop("BB:2")                             # recoverable drop (not in fail_connect)
        await asyncio.sleep(0.15)                    # run_live detects + reconnects it
        assert mgr.is_connected("BB:2")              # B is back on the link
        mgr.inject_kill("BB:2", shooter_team=1)      # killable again → A scores → win
        return await asyncio.wait_for(task, timeout=5)

    snap = _run(play())
    assert snap["over"] and snap["winner"] == "team1"


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


def test_resetup_does_not_revive_a_dead_player():
    # reconnect resetup must NOT spawn a gun the engine has DEAD (avoids the
    # gun-alive/engine-dead desync) — but DOES spawn a live one.
    from brx_mcp.modes.driver import GameDriver

    sent = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    cfg = GameConfig(mode="tdm", frag_limit=5, respawn_s=100, game_time_s=0)
    drv = GameDriver(cfg, {"AA": 1, "BB": 2}, sender)
    _run(drv.setup())
    # kill BB in the engine (long respawn_s so it stays dead)
    _run(drv.execute(drv.feed("BB", {"command": "HIR",
         "tokens": ["HIR", "0", "0", "1", "1", "9", "0", "3"]}, 0.0)))
    _run(drv.execute(drv.feed("BB", {"command": "HP", "tokens": ["HP", "0", "0", "0"]}, 0.0)))
    assert not drv.engine.roster.get("BB").alive

    sent.clear()
    _run(drv.resetup("BB"))
    bb = [f for (p, f) in sent if p == "BB"]
    assert any(f.startswith("$TID") for f in bb)        # re-configured + team
    assert not any(f.startswith("$SPAWN") for f in bb)  # but NOT revived (engine says dead)

    sent.clear()
    _run(drv.resetup("AA"))                              # AA is alive → gets spawned
    assert any(f.startswith("$SPAWN") for f in [f for (p, f) in sent if p == "AA"])


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


def test_fake_run_live_ffa_drives_sflash_and_kill_line_to_the_shooter():
    """A scored FFA kill must drive the app's per-kill feedback — $SFLASH (green
    flash) + the V3A kill line on the token-4 slot — to the SHOOTER's gun, all the
    way through run_live -> engine -> driver (§7o). Guards against the engine
    silently ceasing to call the announcer, which every Action-level test misses."""
    A = FakeTagger("AA:1"); B = FakeTagger("BB:2"); C = FakeTagger("CC:3")
    mgr = FakeConnectionManager([A, B, C])
    cfg = GameConfig(mode="ffa", frag_limit=1, respawn_s=1, game_time_s=0)

    sent: list[tuple[str, str]] = []
    _orig_send = mgr.send

    async def _rec(alias, command, reply_window_ms=0):
        sent.append((alias, command))
        return await _orig_send(alias, command, reply_window_ms)
    mgr.send = _rec

    async def play():
        task = asyncio.ensure_future(
            run_live(cfg, ["AA:1", "BB:2", "CC:3"], manager=mgr, tick_s=0.01))
        await asyncio.sleep(0.08)
        mgr.inject_kill("CC:3", shooter_team=A.team)   # A (team1) kills C
        return await asyncio.wait_for(task, timeout=5)

    _run(play())
    to_shooter = [f for (p, f) in sent if p == "AA:1"]
    assert "$SFLASH,*" in to_shooter                    # green-sight kill-confirm flash
    assert "$PLAY,,4,6,V3A,,,,*" in to_shooter          # kill line on the token-4 slot
    # feedback goes to the SHOOTER, never the victim
    assert "$SFLASH,*" not in [f for (p, f) in sent if p == "CC:3"]


def test_a_hill_drains_a_fake_gun_to_death_and_scores_for_nobody():
    """F69 end to end, through the fake tagger's own frames rather than hand-built dicts.

    A grenade in hill mode puts TWO words on the air every ~5 s: a protocol-15 beacon (no
    pool change) and an ordinary protocol-0 magnitude-8 DAMAGE word carrying shooter wire
    id 0. Both are now expressible by the fake (F78) -- before this the sim could only emit
    a protocol-0 magnitude-9 player shot, so the whole mechanic was unmodellable and the
    scoring bug sat green under 1000 tests.

    The gun really does die here (the damage is real, and F69's damage half is still open).
    What must NOT happen is the hill's owning team collecting the kill.
    """
    from brx_mcp.modes.driver import GameDriver
    from brx_mcp.fake import FakeTagger
    from brx_mcp.protocol import parse_event

    sent = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    cfg = GameConfig(mode="tdm", frag_limit=5, respawn_s=100, game_time_s=0)
    drv = GameDriver(cfg, {"AA": 1, "BB": 2}, sender)
    _run(drv.setup())

    # BB stands in a hill held by team 1. 25 armour + 25 hp, 8 a tick.
    gun = FakeTagger("BB", hp=25, armor=25, team=2)
    t = 0.0
    for _ in range(12):
        gun.beacon(owner_team=1)                       # the half our table discards today
        gun.receive_ir(shooter_team=1, shooter_id=0, mag=8)   # the half that lands
        for frame in gun.drain():
            ev = drv.feed("BB", parse_event(frame), t)
            _run(drv.execute(ev))
        t += 5.0                                       # the real hill period
        if not gun.alive:
            break

    assert not gun.alive, "the hill must still be able to kill -- F69's damage half is open"
    assert drv.engine.team_score.get(1, 0) == 0, "the hill scored for its owning team"
    assert drv.engine.roster.get("AA").kills == 0
