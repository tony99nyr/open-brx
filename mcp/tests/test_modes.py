"""Tests for the M0 mode engines + the driver (pure, no BLE)."""

import asyncio

from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes import (
    DeathmatchEngine, InfectionEngine, LastManStandingEngine, GameDriver,
    build_engine, GameOver, Respawn, Score, Eliminate, SetTeam, Callout, Heal,
)
from brx_mcp.modes.driver import assign_teams
from brx_mcp import poolgauge as pg


def hp(hp_, armor, shield=0):
    return {"command": "HP", "tokens": ["HP", str(hp_), str(armor), str(shield)]}


def hir(shooter_team):
    # token 3 = shooter wire id; 1, not 0 ("no identity", A5.1 -- never a player).
    return {"command": "HIR", "tokens": ["HIR", "0", "0", "1", str(shooter_team), "9", "0", "3"]}


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


def hir_hill_damage(owner_team, mag=8):
    """The ambient DAMAGE word a grenade hill puts on the air every ~5 s (F69).

    Captured 2026-09-10 as `$HIR,0,0,0,1,8,0,0`: an ORDINARY protocol-0 shot -- not the
    protocol-15 beacon -- carrying the hill owner's team and **shooter wire id 0**.
    """
    return {"command": "HIR",
            "tokens": ["HIR", "0", "0", "0", str(owner_team), str(mag), "0", "0"]}


def test_a_hill_that_kills_you_scores_for_nobody():
    """F69: an unattended hill drained Tony to zero in ~106 s. Its damage word is a
    normal protocol-0 shot, so the beacon check (`token2 == 15`) never saw it; it was
    stored as `_last_shot`, and because ATTRIB_FUSE_S (6 s) is WIDER than the hill's ~5 s
    period the attribution was always fresh. The hill's owning team was credited with a
    kill it did not make -- a wrong scoreboard, not merely a missing one.

    The guard is A5.1: wire 0 is "no identity ... never a player".
    """
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0))
    e.add_player("red", 1)
    e.add_player("blue", 2)
    # a red-held hill ticks blue down; every tick lands inside the 6 s fuse
    for t in (0.0, 5.0, 10.0, 15.0):
        e.on_event("blue", hir_hill_damage(owner_team=1), now=t)
    acts = e.on_event("blue", death(), now=17.0)
    assert e.team_score.get(1, 0) == 0, "the hill scored for its owning team"
    assert not _types(acts, Score), "a hill kill must credit no score at all"
    assert e.roster.get("red").kills == 0


def test_a_real_shot_still_scores_when_a_hill_is_also_ticking():
    """The control for the guard above: same engine, same fuse, a REAL shooter (wire 1)
    interleaved with hill words still lands the kill. Without this, 'no score' would be
    satisfied just as well by an engine that credits nothing at all."""
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0))
    e.add_player("red", 1)
    e.add_player("blue", 2)
    e.on_event("blue", hir_hill_damage(owner_team=1), now=0.0)
    e.on_event("blue", hir(1), now=1.0)                  # red actually shoots blue
    acts = e.on_event("blue", death(), now=1.5)
    assert e.team_score[1] == 1
    assert _types(acts, Score)


def hill_beacon_pair(owner_team=2, hp=45, armor=70):
    """The exact pair a hill puts on a gun's BLE stream every ~5.0 s, captured 2026-09-10.

    A `$SIR,15,0,,28` row makes the beacon REGISTER (that is the point — the host can read it),
    and a registration emits `$HIR` **and** `$HP` even though no pool moved.
    """
    return ({"command": "HIR", "tokens": ["HIR", "4", "15", "0", str(owner_team), "8", "0", "0"]},
            {"command": "HP", "tokens": ["HP", str(hp), str(armor), "0"]})


def test_standing_in_a_hill_does_not_block_health_regen():
    """A hill beacons every ~5.0 s and `regen_delay_s` is 6.0.

    The engine used to restart the regen idle timer on any non-fatal `$HP`, on the premise that
    "an $HP means you were hit". A beacon's `$HP` echo carries UNCHANGED pools, so that premise
    made `now - last_damage` reset every 5 s and never reach 6 — **a player standing in a hill
    never regenerated, for the entire match**, in any regen mode. Nothing damaged them; the
    objective's own heartbeat did it. Same shape as F69: a constant wider than the hill's period.

    Damage is a DROP in the pools, so the control below matters as much as the assertion: a real
    hit must still suppress regen, or "regen works" would be satisfied by an engine that ignores
    damage entirely.
    """
    hir, hp_echo = hill_beacon_pair()
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0, regen=True))
    e.add_player("red", 1)
    e.add_player("blue", 2)
    e.on_event("red", hp_echo, now=0.0)                 # a genuine hit lands at t=0
    heals = []
    for i in range(1, 13):                              # 60 s parked on the point
        t = i * 5.0
        e.on_event("red", hir, now=t)
        e.on_event("red", hp_echo, now=t)               # pools never move
        heals += [a for a in e.tick(t + 0.1) if isinstance(a, Heal)]
    assert heals, "the beacon's $HP echo suppressed regen for the whole match"


def test_a_real_hit_still_suppresses_regen():
    """Control for the test above: pools that actually DROP must still restart the idle timer."""
    e = DeathmatchEngine(GameConfig(mode="tdm", game_time_s=0, regen=True))
    e.add_player("red", 1)
    e.add_player("blue", 2)
    e.on_event("red", hp(45, 70), now=0.0)
    heals = []
    for i in range(1, 13):                              # taking a real hit every 5 s
        t = i * 5.0
        e.on_event("red", hp(45, 70 - i * 5), now=t)    # armour genuinely falling
        heals += [a for a in e.tick(t + 0.1) if isinstance(a, Heal)]
    assert not heals, "regen fired while the player was still being shot"


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


def test_infection_simultaneous_last_two_humans_only_ends_after_both():
    # Edge case (pre-refactor pin, per review): two humans falling at the SAME
    # `now` must still be processed one death at a time — the game must not end
    # after the first (one human still standing) and must end on the second.
    e = InfectionEngine(GameConfig(mode="infection", game_time_s=0))
    e.add_player("h1", 1)
    e.add_player("h2", 1)
    e.add_player("z", 2)
    acts1 = e.on_event("h1", death(), now=5.0)
    assert not _types(acts1, GameOver), "one human still standing — must not end yet"
    assert e.roster.get("h1").team == 2
    acts2 = e.on_event("h2", death(), now=5.0)      # second falls at the identical instant
    over = _types(acts2, GameOver)
    assert over and over[0].winner == "infected"
    assert e.roster.get("h1").team == 2 and e.roster.get("h2").team == 2


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


def test_lms_two_lives_survives_first_eliminated_on_second():
    # Edge case (pre-refactor pin, per review): lives=N>1 must survive its first
    # death (respawn, no Eliminate/GameOver) and only go out on the LAST life.
    e = LastManStandingEngine(GameConfig(mode="lms", respawns=1, respawn_s=5, game_time_s=0))
    e.add_player("a", 1)
    e.add_player("b", 2)
    acts = e.on_event("b", death(), now=1.0)    # b: 2 lives → 1, still in
    assert not _types(acts, Eliminate) and not e.over
    assert e.roster.get("b").lives == 1
    tick_acts = e.tick(now=6.0)                 # respawns on its last life
    assert _types(tick_acts, Respawn) and e.roster.get("b").alive
    acts2 = e.on_event("b", death(), now=7.0)   # b: 1 → 0, eliminated
    assert _types(acts2, Eliminate)
    over = _types(acts2, GameOver)
    assert over and over[0].winner == "a"


def test_lms_last_team_standing_at_engine_level():
    # Multi-member team wins by TEAM label, distinct from LMS's per-player naming
    # when a single player is the last one in (see test above / test_lms_eliminates_*).
    e = LastManStandingEngine(GameConfig(mode="lms", respawns=0, game_time_s=0))
    e.add_player("a", 1)
    e.add_player("b", 1)
    e.add_player("c", 2)
    acts = e.on_event("c", death(), now=1.0)    # team2 wiped (1 life each)
    over = _types(acts, GameOver)
    assert over and over[0].winner == "team1"
    assert e.roster.get("a").alive and e.roster.get("b").alive, "winners never had to die"


def test_lms_time_limit_resolves_to_most_lives_at_engine_level():
    e = LastManStandingEngine(GameConfig(mode="lms", respawns=5, respawn_s=99, game_time_s=5))
    e.add_player("a", 1)
    e.add_player("b", 2)
    e.on_event("a", death(), now=1.0)           # a: 6→5 lives; b stays at 6
    assert e.tick(now=4.0) == []                # too soon
    acts = e.tick(now=5.0)                      # time up, multiple still in
    over = _types(acts, GameOver)
    assert over and over[0].winner == "b", "most lives left wins on the clock"


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


def test_an_out_of_range_tid_is_armed_but_warned_about_on_stderr():
    """F96, the operator's-own-rope half. `assign_teams` refuses a team it INVENTS outside 0-3, so a
    tid this high can only have been pinned explicitly — and "explicit wins" is load-bearing
    (`compile.py` arms try-outs on a deliberately odd id, and pinning keeps an identity stable).
    Taking the override away would break that contract; saying nothing leaves the operator with a
    gun whose shots read friendly to a real team and no clue why. So it arms, loudly.
    """
    import contextlib
    import io

    def _arm(players):
        sent = []

        async def sender(pid, frame):
            sent.append((pid, frame))

        drv = GameDriver(GameConfig(mode="tdm"), players, sender=sender, announce=lambda *_: None)
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            asyncio.get_event_loop_policy().new_event_loop().run_until_complete(drv.setup())
        return sent, err.getvalue()

    sent, err = _arm({"G1": 5, "G2": 1})
    assert "G1" in err and "$TID 5" in err, err
    assert "2 bits" in err and "FRIENDLY" in err, err          # the consequence, not just the number
    assert "team 1" in err, err                                # the team it actually transmits as
    # ... and it really did arm: the override is honoured, not silently rewritten.
    assert ("G1", "$TID,5,*") in sent, [f for p, f in sent if p == "G1" and "TID" in f]

    # CONTROL: a roster entirely within 0-3 says nothing at all, so the warning is reading the tid
    # and not printing on every arm.
    sent_ok, err_ok = _arm({"G1": 0, "G2": 3})
    assert err_ok == "", err_ok
    assert ("G1", "$TID,0,*") in sent_ok


def test_ffa_refuses_a_fifth_gun_because_the_wire_has_only_four_teams():
    """F96: FFA/extraction give every gun its OWN `$TID` for 1:1 kill attribution, and the wire's
    team field is 2 BITS — `protocol/brx-protocol.md` §7i: "use 4-7 as COLOURS only, never as a
    team". A gun armed on `$TID,5` TRANSMITS as wire team 1 while comparing incoming words against
    its own FULL tid, so its shots read FRIENDLY to the tid-1 player and do nothing, while it still
    takes damage from them. One-directional immunity: one player in the lobby simply cannot shoot
    one specific opponent. Refused now rather than armed onto a team that cannot fight.
    """
    for mode in ("ffa", "extraction"):
        try:
            assign_teams(mode, ["a", "b", "c", "d", "e"])
            raise AssertionError(f"{mode} armed a fifth gun on a team the wire does not have")
        except ValueError as exc:
            assert "0-3" in str(exc) and "team4" in str(exc), exc
    # CONTROL: four is still accepted, and every team it hands out is a REAL wire team — otherwise
    # "it refuses" would be satisfied just as well by a function that refuses everything.
    four = assign_teams("ffa", ["a", "b", "c", "d"])
    assert set(four.values()) <= set(pg.TEAM_TIDS), four
    assert len(set(four.values())) == 4, f"FFA needs a UNIQUE team per gun for 1:1 credit: {four}"


def test_an_explicit_team_is_still_the_operators_own_call():
    """The cap guards what `assign_teams` INVENTS. An explicitly-passed team is the operator saying
    what they want and is passed through — MC validates those separately (F35), and `compile.py`
    arms try-outs on a deliberately odd id."""
    assert assign_teams("tdm", ["a", "b"], {"a": 5})["a"] == 5
    five = assign_teams("ffa", ["a", "b", "c", "d", "e"], {"e": 3})
    assert five["e"] == 3 and set(five.values()) <= set(pg.TEAM_TIDS), five


def test_assign_teams_variants():
    addrs = ["a", "b", "c"]
    # FFA is 0-BASED so that four guns fill teams 0-3 exactly (F96); it used to start at 1 and arm
    # the fourth gun on $TID,4, a team the 2-bit wire field does not have.
    assert assign_teams("ffa", addrs) == {"a": 0, "b": 1, "c": 2}
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


def test_a_burst_task_collected_after_the_loop_closed_does_not_print_a_traceback():
    """F55: `_play_burst`'s `finally` called `asyncio.current_task()`, which RAISES once the loop is gone
    (a still-pending burst garbage-collected after `asyncio.run()` closed the loop). The suite reported
    0 failed while a traceback printed -- noise an operator reads as a failure, and a real error in that
    `finally` would be indistinguishable from it. Drive the coroutine to its `finally` with no loop and
    assert it stays quiet."""
    import asyncio
    from brx_mcp.modes.driver import GameDriver
    d = GameDriver.__new__(GameDriver)
    d._bursts = {}
    sends = []
    async def _send(pid, frame, reply_window_ms=0):
        sends.append(frame)
    d._send = _send
    coro = d._play_burst("p1", [("$GLED,1,1,1,0,10,,*", 0)])
    # No running loop: step the coroutine by hand, exactly the state a late GC finaliser sees.
    try:
        coro.send(None)
    except StopIteration:
        pass
    assert sends == ["$GLED,1,1,1,0,10,,*"]
    assert asyncio._get_running_loop() is None
