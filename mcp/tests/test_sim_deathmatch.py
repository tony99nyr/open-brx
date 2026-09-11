"""Exhaustive TDM/FFA + health-variant scenarios over the SimGame harness.

These drive the WHOLE stack (config→setup frames, DeathmatchEngine rules, driver
Action→frame execution, host respawn, teardown) with in-memory guns, to harden the
engine before bench testing. Each `test_*` asserts the CORRECT behaviour per the
`deathmatch.py` docstring + the gameconfig.py / modes/ docstrings (docs/m0-game-engine.md was retired 2026-09-06) — not merely what the code does.

Any scenario that revealed a genuine engine/driver bug is preserved as a
`scenario_*` function (skipped by the runner) with a `# SUSPECTED BUG:` note.

Reference: tests/test_sim_harness.py (harness usage), tests/test_modes.py (pure
engine-level equivalents of several of these).
"""

from brx_mcp import poolgauge as pg
from brx_mcp.gameconfig import GameConfig
from brx_mcp.sim import SimGame


# --------------------------------------------------------------------------- #
# TDM — scoring, win conditions                                               #
# --------------------------------------------------------------------------- #
def test_tdm_kill_credits_shooter_team():
    """A kill scores for the SHOOTER's team, not the victim's."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0)).setup()
    g.kill("G2", shooter_team=1)                 # G1(team1) kills G2(team2)
    snap = g.snapshot()
    assert snap["team_score"].get(1, 0) == 1
    assert snap["team_score"].get(2, 0) == 0
    assert snap["players"]["G2"]["deaths"] == 1
    assert not g.over


def test_tdm_credits_the_specific_killer_when_a_team_holds_two_guns():
    """Q17 REGRESSION (bench-found 2026-08-30, 3 taggers, TDM 2v1).

    Attribution used to resolve the killer from the shooter's TEAM, which only
    identifies one gun when the team has exactly one member. With G1 and G3 both on
    team 1, a kill by either credited NOBODY - every gun read `kills: 0` while the
    team score stayed correct. The fix reads the shooter's PLAYER id from `$HIR`
    token 3 and maps it through the driver's assignment.

    This test could not even be written before: the fake gun hardcoded `$HIR` token 3
    to 0, so no sim scenario could express a two-gun team. That is why 156 scenarios
    missed it.
    """
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0),
                guns={"G1": 1, "G3": 1, "G2": 2}).setup()
    wire = g.drv.player_ids                    # addr -> $PSET token 1
    g.kill("G2", shooter_team=1, shooter_id=wire["G3"])   # G3 gets this one, not G1

    snap = g.snapshot()
    assert snap["team_score"].get(1, 0) == 1, "team scoring must still work"
    assert snap["players"]["G2"]["deaths"] == 1
    assert snap["players"]["G3"]["kills"] == 1, "the SPECIFIC killer must be credited"
    assert snap["players"]["G1"]["kills"] == 0, "the teammate must NOT be credited"


def test_tdm_falls_back_to_team_when_the_shooter_id_is_unknown():
    """An unmapped shooter id must not lose the kill: fall back to team resolution.

    Only resolvable when the team holds one gun, which is exactly what the old
    behaviour did, so a gun we never assigned an id to is no worse off than before.
    """
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0)).setup()  # 1v1
    g.kill("G2", shooter_team=1, shooter_id=61)   # 61 was never assigned to anyone

    snap = g.snapshot()
    assert snap["team_score"].get(1, 0) == 1
    assert snap["players"]["G1"]["kills"] == 1, "team fallback must still credit G1"


def test_tdm_frag_limit_ends_with_right_winner():
    """Reaching frag_limit ends the game with the leading team as winner."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=2, game_time_s=0, respawn_s=3)).setup()
    g.kill("G2", 1, now=1.0)                      # team1: 1
    assert not g.over                            # 1 < 2, still going
    g.tick(now=5.0)                              # G2 respawns
    assert g.alive("G2")
    g.kill("G2", 1, now=6.0)                      # team1: 2 → frag limit
    assert g.over
    assert g.snapshot()["winner"] == "team1"


def test_tdm_time_limit_ends_with_leader():
    """game_time_s expiry ends the game and the leading team wins."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=10, respawn_s=99)).setup()
    g.kill("G2", 1, now=0.5)                      # team1 ahead 1–0
    g.run_until_over(dt=1.0, start=1.0)
    assert g.over
    assert g.snapshot()["winner"] == "team1"


def test_tdm_time_limit_draw_when_tied():
    """A tied score at time expiry is a draw."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=20, respawn_s=5)).setup()
    g.kill("G2", 1, now=1.0)                      # team1: 1
    g.tick(now=6.0)                              # G2 back
    assert g.alive("G2")
    g.kill("G1", 2, now=7.0)                      # team2: 1  → 1–1
    g.run_until_over(dt=1.0, start=8.0)
    assert g.over
    assert g.snapshot()["winner"] == "draw"


def test_tdm_multiple_kills_accumulate():
    """Successive kills accumulate on the team score and the killer's tally."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0, respawn_s=5)).setup()
    g.kill("G2", 1, now=1.0)
    g.tick(now=6.0)
    g.kill("G2", 1, now=7.0)
    g.tick(now=12.0)
    g.kill("G2", 1, now=13.0)
    snap = g.snapshot()
    assert snap["team_score"][1] == 3
    assert snap["players"]["G1"]["kills"] == 3   # 2-gun TDM: team→player is 1:1
    assert snap["players"]["G2"]["deaths"] == 3


# --------------------------------------------------------------------------- #
# Host respawn                                                                 #
# --------------------------------------------------------------------------- #
def test_host_respawn_returns_after_delay_not_before():
    """A downed gun comes back only once respawn_s has elapsed."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0, respawn_s=15)).setup()
    g.kill("G2", 1, now=0.0)
    assert not g.alive("G2")
    g.tick(now=10.0)                             # too soon
    assert not g.alive("G2")
    g.tick(now=15.0)                             # delay reached
    assert g.alive("G2")
    # revive was driven over the wire ($SPAWN in the respawn sequence)
    assert any(f.startswith("$SPAWN") for f in g.frames_to("G2"))


def test_respawn_ramp_lengthens_successive_respawns():
    """respawn_ramp stretches each successive respawn: 15s then 30s (…45/90)."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0,
                           respawn_ramp=True)).setup()
    # 1st death → 15s
    g.kill("G2", 1, now=0.0)
    g.tick(now=14.0)
    assert not g.alive("G2")                     # 14 < 15
    g.tick(now=15.0)
    assert g.alive("G2")                         # first respawn at 15
    # 2nd death → 30s (not 15)
    g.kill("G2", 1, now=16.0)
    g.tick(now=45.0)
    assert not g.alive("G2")                     # 45-16=29 < 30 → still down
    g.tick(now=46.0)
    assert g.alive("G2")                         # second respawn needed the longer 30s


def test_respawns_cap_equals_lives_then_eliminated():
    """respawns=N → N+1 lives; a gun is eliminated (and never respawns) once used up."""
    guns = {"G1": 1, "G2": 2, "G3": 2}           # team2 keeps G3 so the game continues
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0,
                           respawns=1, respawn_s=5), guns=guns).setup()
    assert g.snapshot()["players"]["G2"]["lives"] == 2   # respawns=1 → 2 lives
    g.kill("G2", 1, now=1.0)                      # life 1 spent
    g.tick(now=6.0)                              # respawns (still has a life)
    assert g.alive("G2")
    g.kill("G2", 1, now=7.0)                      # last life spent → eliminated
    snap = g.snapshot()
    assert snap["players"]["G2"]["lives"] == 0
    assert not g.over                            # G3 keeps team2 in
    g.tick(now=100.0)                            # far past any respawn window
    assert not g.alive("G2")                     # eliminated → never comes back


# --------------------------------------------------------------------------- #
# Kill-attribution fuse (ATTRIB_FUSE_S = 6.0)                                  #
# --------------------------------------------------------------------------- #
def test_stale_hit_does_not_steal_kill():
    """A non-fatal hit long before an unrelated later death must NOT be credited."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0), damage=25).setup()
    g.hit("G2", 1, now=1.0)                       # enemy (team1) hits G2, survives
    g.event("G2", "$HP,0,0,0,*", now=30.0)       # dies 29s later, no fresh $HIR
    snap = g.snapshot()
    assert snap["team_score"].get(1, 0) == 0     # stale hitter (team1) gets nothing
    assert not g.over


def test_fresh_hit_within_fuse_credits():
    """A fresh enemy hit inside the fuse window DOES credit the kill."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0), damage=25).setup()
    g.kill("G2", 1, now=40.0)                     # fresh $HIR + death, same instant
    assert g.snapshot()["team_score"].get(1, 0) == 1


# --------------------------------------------------------------------------- #
# Self / friendly fire — never credited                                       #
# --------------------------------------------------------------------------- #
def test_same_team_kill_not_credited():
    """Killing a teammate scores nothing (killer_team == victim_team)."""
    guns = {"G1": 1, "G2": 1, "G3": 2}           # G1 & G2 share team1
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0), guns=guns).setup()
    g.kill("G2", shooter_team=1)                 # G1 kills teammate G2
    snap = g.snapshot()
    assert snap["team_score"].get(1, 0) == 0     # no friendly-fire credit
    assert snap["players"]["G2"]["deaths"] == 1  # they did die though
    assert snap["players"]["G1"]["kills"] == 0


def test_self_shot_not_credited():
    """A gun that shoots itself gets no kill credit."""
    g = SimGame(GameConfig(mode="ffa", frag_limit=0, game_time_s=0)).setup()
    # Read the team off the game rather than writing "1": FFA numbering is not a fact these
    # scenarios are about, and hard-coding it made five of them fail when it moved (F96).
    g.kill("G1", shooter_team=g.teams["G1"])     # G1 shooting its own team
    snap = g.snapshot()
    assert snap["team_score"].get(g.teams["G1"], 0) == 0
    assert snap["players"]["G1"]["kills"] == 0


def test_the_first_gun_in_the_lobby_can_actually_score():
    """🔴 The falsy-zero trap, live until today: `GameDriver` auto-numbered the fleet from 0, and
    `$PSET,0` is A5.1's "no identity ... never a player" — which `shooter_player_id()` refuses
    outright since the F69 guard landed. So the FIRST gun of every game killed people and scored
    nothing: the victim went down, no score moved, and nothing said why.

    Driven from the gun's OWN arming id rather than a literal, because a literal is exactly what hid
    it: every other scenario in this file passes `shooter_id=1` and so never exercised gun #1.
    """
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0)).setup()
    first = g.drv.player_ids["G1"]
    assert first != 0, "a real player was armed on the 'no identity' id"
    g.kill("G2", shooter_team=g.teams["G1"], shooter_id=first)
    snap = g.snapshot()
    assert snap["team_score"][g.teams["G1"]] == 1, snap["team_score"]
    assert snap["players"]["G1"]["kills"] == 1
    # CONTROL: a shot that really does carry wire 0 — a mis-armed gun, or a grenade hill's ambient
    # damage word — still credits nobody. The guard is intact, not loosened to make the above pass.
    g2 = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0)).setup()
    g2.kill("G2", shooter_team=g2.teams["G1"], shooter_id=0)
    assert not any(g2.snapshot()["team_score"].values()), g2.snapshot()["team_score"]
    assert g2.snapshot()["players"]["G1"]["kills"] == 0


# --------------------------------------------------------------------------- #
# FFA — per-gun credit                                                         #
# --------------------------------------------------------------------------- #
def test_ffa_unique_team_per_gun():
    """FFA gives every gun its own team so scoring resolves to the specific gun."""
    g = SimGame(GameConfig(mode="ffa", frag_limit=0, game_time_s=0)).setup()
    # 0-BASED since F96, so four guns fill teams 0-3 exactly and a fifth is refused instead of
    # being armed on a $TID the 2-bit wire field does not have.
    assert g.teams == {"G1": 0, "G2": 1, "G3": 2}
    assert len(set(g.teams.values())) == len(g.teams), "FFA credit needs a UNIQUE team per gun"


def test_ffa_credits_specific_killer_gun():
    """A kill in FFA credits the killer GUN (not a team bucket)."""
    g = SimGame(GameConfig(mode="ffa", frag_limit=0, game_time_s=0)).setup()
    g.kill("G2", shooter_team=g.teams["G1"])     # G1 kills G2
    snap = g.snapshot()
    assert snap["players"]["G1"]["kills"] == 1
    assert snap["players"]["G2"]["kills"] == 0
    assert snap["players"]["G3"]["kills"] == 0


def test_ffa_frag_limit_ends_on_right_gun():
    """FFA frag_limit ends the game with the killer GUN id as winner."""
    g = SimGame(GameConfig(mode="ffa", frag_limit=2, game_time_s=0)).setup()
    g.kill("G2", shooter_team=g.teams["G1"])     # G1: 1
    assert not g.over
    g.kill("G3", shooter_team=g.teams["G1"])     # G1: 2 → frag limit
    assert g.over
    assert g.snapshot()["winner"] == "G1"        # a gun id, not "team1"


# --------------------------------------------------------------------------- #
# Q19: FFA paints WHITE on both surfaces                                       #
# --------------------------------------------------------------------------- #
def test_ffa_paints_white_on_both_surfaces_never_a_team_colour():
    """Q19: FFA has no team identity to protect, so BOTH surfaces paint WHITE for every player.

    The three rest paints — at spawn, after every registered hit, and the gauge revert — each called
    `poolgauge` directly and each had to remember `ffa=`; none of them did, so every FFA game painted
    per-gun team colours in the one mode that has no teams. Asserted on the frames the guns were
    actually SENT, not on a builder's return value: the builder is the thing that was right all
    along, and the call sites were the thing that was wrong.
    """
    white = pg.FFA_COLOUR
    g = SimGame(GameConfig(mode="ffa", frag_limit=0, game_time_s=0), damage=25).setup()
    # TWO hits: `changed_pool` compares against the PREVIOUS $HP, so the first one only establishes
    # the baseline and paints no gauge. One hit here left the body untested and the test green.
    g.hit("G1", g.teams["G2"], now=1.0)                    # a registered hit wipes + repaints the head
    g.hit("G1", g.teams["G2"], now=1.5)                    # ... this one moves a pool → gauge paint
    g.tick(now=1.5 + pg.REVERT_AFTER_S + 0.1)              # the gauge expires → body back to rest
    to_g1 = g.frames_to("G1")
    heads = [f for f in to_g1 if f.startswith("$HLED,")]
    assert heads, to_g1
    assert all(f.startswith(f"$HLED,{white},") for f in heads), heads
    # G1 is team 0 in FFA now, so the bug had a visible signature (a RED head). It must be gone.
    assert not any(f.startswith(f"$HLED,{pg.display_colour(g.teams['G1'])},") for f in heads), heads
    rests = [f for f in to_g1 if f.startswith("$GLED,") and ",0," in f]
    assert any(f.startswith(f"$GLED,{white},{white},{white},") for f in rests), rests
    g.close()

    # CONTROL: a TEAM mode still paints its team colour on both surfaces. Without it, "everything is
    # white" would be satisfied just as well by a driver that paints white for everybody.
    t = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0), damage=25).setup()
    t.hit("G1", t.teams["G2"], now=1.0)
    t.hit("G1", t.teams["G2"], now=1.5)
    t.tick(now=1.5 + pg.REVERT_AFTER_S + 0.1)
    colour = pg.display_colour(t.teams["G1"])
    assert colour != white, "the control cannot tell white from a team colour"
    t_heads = [f for f in t.frames_to("G1") if f.startswith("$HLED,")]
    assert t_heads and all(f.startswith(f"$HLED,{colour},") for f in t_heads), t_heads
    assert any(f.startswith(f"$GLED,{colour},{colour},{colour},")
               for f in t.frames_to("G1") if f.startswith("$GLED,"))
    t.close()


# --------------------------------------------------------------------------- #
# Health variant: Syphon (heal the killer on a kill)                          #
# --------------------------------------------------------------------------- #
def test_syphon_heals_killer_on_kill():
    """Syphon grants the killer armor on a kill — asserted numerically on the gun
    AND via the $LIFE frame actually sent."""
    g = SimGame(GameConfig(mode="ffa", frag_limit=0, game_time_s=0,
                           syphon=True, syphon_armor=30, syphon_hp=0),
                damage=25).setup()
    g.hit("G1", g.teams["G2"], now=1.0)           # G1 armor 70→45 (shot by G2)
    g.hit("G1", g.teams["G2"], now=1.0)           # G1 armor 45→20
    assert g.taggers["G1"].armor == 20
    g.kill("G3", shooter_team=g.teams["G1"], now=2.0)   # G1 kills G3 → syphon +30 armor
    assert g.taggers["G1"].armor == 50           # 20 + 30 (clamped ≤ 70)
    assert "$LIFE,0,30,0,*" in g.frames_to("G1")


def test_syphon_off_by_default_no_heal():
    g = SimGame(GameConfig(mode="ffa", frag_limit=0, game_time_s=0), damage=25).setup()
    g.hit("G1", g.teams["G2"], now=1.0)
    g.kill("G3", shooter_team=g.teams["G1"], now=2.0)
    assert not any(f.startswith("$LIFE") for f in g.frames_to("G1"))


# --------------------------------------------------------------------------- #
# Health variant: Regen (Halo-style refill after no damage)                   #
# --------------------------------------------------------------------------- #
def test_regen_refills_after_delay_and_rearms():
    """After regen_delay_s with no damage, armor refills via $LIFE; a new hit
    re-arms it so it can fire again."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0,
                           regen=True, regen_delay_s=6.0, hp=45, armor=70),
                damage=25).setup()
    g.hit("G1", 2, now=1.0)                       # armor 70→45
    assert g.taggers["G1"].armor == 45
    g.tick(now=5.0)                              # 4s < 6 → no regen yet
    assert not any(f.startswith("$LIFE") for f in g.frames_to("G1"))
    g.tick(now=7.0)                              # 6s idle → refill
    assert g.taggers["G1"].armor == 70
    assert "$LIFE,45,70,0,*" in g.frames_to("G1")
    # re-arm on fresh damage, then refill again
    g.hit("G1", 2, now=10.0)                      # armor 70→45, regen re-armed
    g.tick(now=13.0)                             # 3s < 6 → nothing
    g.tick(now=16.0)                             # 6s idle → refill again
    assert len([f for f in g.frames_to("G1") if f.startswith("$LIFE")]) == 2


def test_regen_no_spurious_heal_on_respawn():
    """A real fix: stale damage state must NOT trigger a full-heal the tick a gun
    respawns (respawn already refilled it)."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=0, game_time_s=0,
                           regen=True, regen_delay_s=6.0, respawn_s=15),
                damage=25).setup()
    g.kill("G1", 2, now=1.0)                      # took damage then died (team2 kills G1)
    g.tick(now=17.0)                             # respawns at 15s (well past regen delay)
    assert g.alive("G1")
    assert not any(f.startswith("$LIFE") for f in g.frames_to("G1")), \
        "stale regen fired a heal on respawn"
    g.tick(now=18.0)                             # and none lingers the next tick
    assert not any(f.startswith("$LIFE") for f in g.frames_to("G1"))


# --------------------------------------------------------------------------- #
# kid_mode — protective floors + forced friendly-fire off                     #
# --------------------------------------------------------------------------- #
def test_kid_mode_health_floor_applied():
    """kid_mode floors health up (hp≥75, armor≥100) and pushes it to the gun."""
    g = SimGame(GameConfig(mode="tdm", kid_mode=True, hp=45, armor=70)).setup()
    tg = g.taggers["G1"]
    assert tg.cfg_hp == 75 and tg.cfg_armor == 100     # $PSET floors reached the gun
    assert tg.hp == 75 and tg.armor == 100             # spawned at the floored pool
    # The id comes from the driver, not written inline: this scenario is about the health FLOOR,
    # and the fleet is numbered from 1 (A5.1 reserves wire 0 for "no identity").
    assert any(f.startswith(f"$PSET,{g.drv.player_ids['G1']},0,75,100,") for f in g.frames_to("G1"))


def test_kid_mode_forces_friendly_fire_off():
    """kid_mode overrides friendly_fire=True → OFF, and that actually stops a
    same-team hit from doing damage."""
    guns = {"G1": 1, "G2": 1, "G3": 2}
    g = SimGame(GameConfig(mode="tdm", kid_mode=True, friendly_fire=True),
                guns=guns).setup()
    assert any(f.startswith("$GSET,0,") for f in g.frames_to("G1"))   # FF token off
    before = g.taggers["G2"].armor
    g.hit("G2", shooter_team=1)                  # teammate shoots G2
    assert g.taggers["G2"].armor == before       # FF off → no damage
    assert g.alive("G2")


# --------------------------------------------------------------------------- #
# Config → frames sanity                                                       #
# --------------------------------------------------------------------------- #
def test_setup_frames_include_tid_gset_vol_ammo():
    """Setup pushes team, game settings (FF token = config), volume, and spawn ammo."""
    g = SimGame(GameConfig(mode="tdm", friendly_fire=True)).setup()
    frames = g.frames_to("G1")
    assert any(f.startswith("$TID,") for f in frames)
    assert any(f.startswith("$VOL,") for f in frames)
    assert any(f.startswith("$AMMO,") for f in frames)
    assert any(f.startswith("$GSET,1,") for f in frames)   # FF ON reflected


def test_gset_reflects_friendly_fire_off():
    g = SimGame(GameConfig(mode="tdm", friendly_fire=False)).setup()
    assert any(f.startswith("$GSET,0,") for f in g.frames_to("G1"))


def test_teardown_sends_spawn_revive():
    """Teardown revives a gun left dead at game end (END_SEQUENCE starts $SPAWN)."""
    g = SimGame(GameConfig(mode="tdm", frag_limit=1, game_time_s=0)).setup()
    g.kill("G2", 1)
    assert g.over
    g.teardown()
    assert "$SPAWN,,*" in g.frames_to("G2")      # dead gun revived on teardown
    assert "$SPAWN,,*" in g.frames_to("G1")
