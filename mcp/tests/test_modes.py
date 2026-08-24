"""Tests for the M0 mode engines + the driver (pure, no BLE)."""

import asyncio

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import (
    DeathmatchEngine, InfectionEngine, LastManStandingEngine, GameDriver,
    build_engine, GameOver, Respawn, Score, Eliminate, SetTeam, Callout, Heal,
)
from brx_mcp.modes.driver import assign_teams


def hp(hp_, armor, shield=0):
    return {"command": "HP", "tokens": ["HP", str(hp_), str(armor), str(shield)]}


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


def test_syphon_heals_the_killer_in_ffa():
    e = DeathmatchEngine(GameConfig(mode="ffa", game_time_s=0, syphon=True,
                                    syphon_armor=30))
    e.add_player("alice", 1)
    e.add_player("bob", 2)
    e.on_event("alice", hir(2), now=1.0)         # bob kills alice
    acts = e.on_event("alice", death(), now=1.1)
    heals = _types(acts, Heal)
    assert heals and heals[0].player_id == "bob" and heals[0].armor == 30


def test_syphon_off_by_default():
    e = DeathmatchEngine(GameConfig(mode="ffa", game_time_s=0))
    e.add_player("alice", 1); e.add_player("bob", 2)
    e.on_event("alice", hir(2), now=1.0)
    acts = e.on_event("alice", death(), now=1.1)
    assert not _types(acts, Heal)


def test_regen_refills_after_no_damage_delay():
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0, regen=True,
                                    regen_delay_s=6.0, hp=45, armor=70))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("red", hp(45, 40), now=1.0)       # red took damage (armor 70→40)
    assert e.tick(now=5.0) == []                 # too soon
    acts = e.tick(now=7.0)                        # 6s since damage → regen
    heals = _types(acts, Heal)
    assert heals and heals[0].player_id == "red" and heals[0].armor == 70
    # only once per idle — a second tick doesn't re-heal
    assert not _types(e.tick(now=9.0), Heal)
    # fresh damage re-arms regen
    e.on_event("red", hp(45, 30), now=10.0)
    assert not _types(e.tick(now=14.0), Heal)    # too soon again
    assert _types(e.tick(now=16.0), Heal)        # re-armed → heals again


def test_regen_does_not_fire_on_respawn():
    # Regression (review High): stale _last_damage must not trigger a full-heal the
    # tick a player respawns (respawn already refilled them).
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0, regen=True,
                                    regen_delay_s=6.0, respawn_s=15))
    e.add_player("red", 1); e.add_player("blue", 2)
    e.on_event("red", hp(45, 40), now=1.0)       # damaged
    e.on_event("red", hir(2), now=2.0)
    e.on_event("red", death(), now=2.0)          # died
    acts = e.tick(now=17.0)                        # respawns (15s) at this tick
    assert _types(acts, Respawn)
    assert not _types(acts, Heal), "stale regen fired on respawn"
    # and no lingering heal on the next tick either
    assert not _types(e.tick(now=18.0), Heal)


def test_regen_off_by_default():
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0))
    e.add_player("red", 1)
    e.on_event("red", hp(45, 40), now=1.0)
    assert not _types(e.tick(now=100.0), Heal)


def test_tdm_finite_lives_does_not_end_early_for_respawning_teammate():
    # Regression (review Critical): a dead-but-respawning teammate must keep the
    # team "in". team1={red, alice}, team2={blue}, 2 lives each.
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0, respawns=1))
    e.add_player("red", 1)
    e.add_player("alice", 1)
    e.add_player("blue", 2)
    # alice dies once (down, respawning, 1 life left)
    e.on_event("alice", hir(2), now=1.0)
    e.on_event("alice", death(), now=1.0)
    # red loses both lives while alice is still down
    e.on_event("red", hir(2), now=2.0)
    e.on_event("red", death(), now=2.0)         # red 2→1
    e.roster.get("red").alive = True            # (respawned)
    e.on_event("red", hir(2), now=3.0)
    acts = e.on_event("red", death(), now=3.0)  # red 1→0 → Eliminate → check standing
    # team1 still has alice (down but respawnable) → game must NOT be over
    assert not e.over, "ended early: alice (team1) still had a life left"
    assert not [a for a in acts if isinstance(a, GameOver)]


def test_tdm_stale_hit_does_not_credit_a_kill_on_late_death():
    # Regression (review High): a non-fatal enemy hit long ago must not steal a
    # kill on a later suicide/environmental death (no fresh $HIR).
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0))
    e.add_player("red", 1)
    e.add_player("blue", 2)
    e.on_event("red", hir(2), now=1.0)          # red hit by blue, survives
    acts = e.on_event("red", death(), now=30.0) # dies 29 s later, no new hit
    assert not [a for a in acts if isinstance(a, Score)]
    assert e.team_score.get(2, 0) == 0
    # respawn red, then a FRESH hit within the fuse DOES credit
    e.roster.get("red").alive = True
    e.on_event("red", hir(2), now=40.0)
    acts2 = e.on_event("red", death(), now=41.0)
    assert [a for a in acts2 if isinstance(a, Score)]


def test_driver_survives_a_failing_send_midgame():
    # Regression (review High): one gun's send error must not abort the game.
    calls = {"n": 0}

    async def flaky(pid, frame):
        calls["n"] += 1
        if "$PLAY" in frame:
            raise RuntimeError("gun disconnected")

    drv = GameDriver(GameConfig(mode="tdm"), {"red": 1, "blue": 2}, flaky,
                     announce=lambda s: None)

    async def scenario():
        from brx_mcp.modes.base import PlaySound, Respawn as R
        await drv.execute([PlaySound("VA20", scope="all"), R("red")])

    asyncio.run(scenario())      # must not raise
    assert calls["n"] > 0


def test_assign_teams_variants():
    addrs = ["a", "b", "c"]
    assert assign_teams("ffa", addrs) == {"a": 1, "b": 2, "c": 3}
    assert assign_teams("tdm", addrs) == {"a": 1, "b": 2, "c": 1}
    inf = assign_teams("infection", addrs)
    assert inf == {"a": 2, "b": 1, "c": 1}       # exactly one seed infected
    assert list(inf.values()).count(2) == 1
    # explicit wins
    assert assign_teams("tdm", addrs, {"a": 5})["a"] == 5


def test_kid_mode_class_order_keeps_health_floor():
    # Regression (review Medium): scout (hp 35) + kid_mode must not drop below the
    # kid-mode floor (class applied first, then kid floors).
    from brx_mcp.gameconfig import GameConfig as GC
    s = GC(game_class="scout", kid_mode=True).apply_presets()
    assert s.hp >= 75 and s.armor >= 100


def test_ammo_matches_selected_weapon():
    from brx_mcp.gameconfig import GameConfig as GC
    sf = GC(primary="charge").spawn_frames()
    ammo0 = [f for f in sf if f.startswith("$AMMO,0")][0]
    assert ammo0.startswith("$AMMO,0,20,")       # charge mag = 20, not the default 36


def test_setup_loads_melee_slot_and_full_sir():
    from brx_mcp.gameconfig import GameConfig as GC
    frames = GC().setup_frames()
    assert [f for f in frames if f.startswith("$WEAP,4")]        # melee slot loaded
    assert len([f for f in frames if f.startswith("$SIR,")]) == 10  # all 10 rows


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
