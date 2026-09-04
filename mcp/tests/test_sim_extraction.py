"""Exhaustive scenario suite for Extraction (the flagship raid-and-extract mode),
driven end-to-end through the SimGame harness (config → setup → driver → engine →
Action execution → fake guns), no Bluetooth.

Each scenario asserts the CORRECT behavior per the ExtractionGame /
ExtractionEngineAdapter docstrings + docs/m0-game-engine.md — NOT merely what the
code happens to do. Passing scenarios are `test_*`; any scenario that exposes a
real bug is demoted to `scenario_*` with a `# SUSPECTED BUG:` note so the suite
stays green while flagging the defect.

Extraction is FFA-teamed: each gun is its own team, so kills attribute 1:1. The
harness keys extraction station events (`$LOOT`/`$ZONE`/`$LEAVE`/`$PICKUP`) to the
GUN doing the action.
"""

from brx_mcp import sounds as snd
from brx_mcp.gameconfig import GameConfig
from brx_mcp.sim import SimGame

COUNTDOWN_PLAY = f"$PLAY,{snd.COUNTDOWN},4,6,,,,,*"   # the loud extraction alarm


def _game(guns=("G1", "G2"), damage=200, **cfg):
    """A set-up Extraction SimGame. `damage=200` = one-hit kills (terse); pass 25
    for the real model when a scenario needs a *non-fatal* hit."""
    cfg.setdefault("game_time_s", 0)
    g = SimGame(GameConfig(mode="extraction", **cfg), guns=list(guns), damage=damage)
    return g.setup()


def _p(g, pid):
    return g.snapshot()["players"][pid]


# --------------------------------------------------------------------------- #
# Core loop: loot → summon zone → hold the channel → EXTRACT → bank → win      #
# --------------------------------------------------------------------------- #
def test_loot_zone_hold_channel_extract_banks_and_wins():
    g = _game(channel_s=10, win_target=15)
    g.station("G1", "$LOOT,15,*", now=0.0)          # pick up 15
    assert _p(g, "G1")["carried"] == 15
    g.station("G1", "$ZONE,Alpha,*", now=1.0)       # summon extraction (channel starts @1)
    g.tick(now=10.0)                                # only 9s held — not yet
    assert not g.over and _p(g, "G1")["banked"] == 0
    g.tick(now=12.0)                               # 11s ≥ channel 10 → extract
    snap = g.snapshot()
    assert snap["over"] and snap["winner"] == "G1"
    assert snap["players"]["G1"]["banked"] == 15    # banked += carried value
    assert snap["players"]["G1"]["carried"] == 0    # wallet emptied on extract


def test_extract_banks_carried_value_without_reaching_target():
    # A completed extraction banks the carried value even when it doesn't win.
    g = _game(channel_s=5, win_target=1000)
    g.station("G1", "$LOOT,30,*", now=0.0)
    g.station("G1", "$ZONE,Alpha,*", now=1.0)
    g.tick(now=7.0)                                 # 6s ≥ 5 → extract
    assert not g.over
    assert _p(g, "G1")["banked"] == 30
    assert _p(g, "G1")["status"] == "extracted"     # default extract_removes_player


def test_win_target_ends_game_and_engine_is_inert_after():
    g = _game(channel_s=5, win_target=100, extract_removes_player=False)
    g.station("G1", "$LOOT,100,*", now=0.0)
    g.station("G1", "$ZONE,Alpha,*", now=1.0)
    g.tick(now=7.0)
    assert g.over and g.snapshot()["winner"] == "G1"
    # further events do nothing once the game is over
    g.station("G1", "$LOOT,50,*", now=8.0)
    g.tick(now=20.0)
    assert _p(g, "G1")["carried"] == 0              # loot after game-over ignored


# --------------------------------------------------------------------------- #
# The channel is a HOLD: leaving or dying resets it                            #
# --------------------------------------------------------------------------- #
def test_leaving_zone_before_channel_resets_no_extraction():
    g = _game(channel_s=10, win_target=100)
    g.station("G1", "$LOOT,50,*", now=0.0)
    g.station("G1", "$ZONE,Alpha,*", now=1.0)       # channel @1
    g.station("G1", "$LEAVE,*", now=5.0)            # bail at 5s → channel reset
    g.tick(now=12.0)                               # would be 11s held — but it reset
    assert not g.over
    assert _p(g, "G1")["banked"] == 0
    assert _p(g, "G1")["carried"] == 50             # still carrying it


def test_reentering_zone_restarts_the_channel_then_extracts():
    g = _game(channel_s=10, win_target=100)
    g.station("G1", "$LOOT,50,*", now=0.0)
    g.station("G1", "$ZONE,Alpha,*", now=1.0)
    g.station("G1", "$LEAVE,*", now=5.0)            # reset
    g.station("G1", "$ZONE,Alpha,*", now=12.0)      # fresh channel @12
    g.tick(now=20.0)                               # 8s < 10 — not done
    assert _p(g, "G1")["banked"] == 0
    g.tick(now=23.0)                               # 11s ≥ 10 → extract
    assert _p(g, "G1")["banked"] == 50


def test_channel_interrupted_by_death_resets_no_extraction():
    g = _game(channel_s=10, win_target=100)
    g.station("G1", "$LOOT,50,*", now=0.0)
    g.station("G1", "$ZONE,Alpha,*", now=1.0)       # channel @1
    g.kill("G1", shooter_team=2, now=5.0)          # G2 downs G1 mid-channel
    g.tick(now=12.0)                               # 11s elapsed — but channel died with G1
    assert not g.over
    assert _p(g, "G1")["banked"] == 0
    assert _p(g, "G1")["carried"] == 0              # loot dropped on death
    assert _p(g, "G1")["status"] == "down"


# --------------------------------------------------------------------------- #
# Drop-on-death + drop policies                                                #
# --------------------------------------------------------------------------- #
def test_kill_drops_carried_loot_and_downs_the_carrier():
    g = _game(drop_policy="ground", loot_per_kill=0)
    g.station("G2", "$LOOT,40,*", now=0.0)
    g.kill("G2", shooter_team=1, now=1.0)          # G1 downs G2
    assert _p(g, "G2")["carried"] == 0              # dropped everything
    assert _p(g, "G2")["status"] == "down"


def test_drop_policy_killer_credits_killer_with_drop_plus_killloot():
    # policy "killer": the victim's carried loot goes straight to the killer's
    # wallet, and the killer ALSO gains loot_per_kill on top.
    g = _game(drop_policy="killer", loot_per_kill=10)
    g.station("G2", "$LOOT,40,*", now=0.0)
    g.kill("G2", shooter_team=1, now=1.0)          # G1 (team1) kills G2
    assert _p(g, "G1")["carried"] == 50             # 40 drop + 10 kill-loot
    assert _p(g, "G2")["carried"] == 0


def test_drop_policy_ground_leaves_a_pickable_token():
    g = _game(drop_policy="ground", loot_per_kill=0)
    g.station("G2", "$LOOT,40,*", now=0.0)
    g.kill("G2", shooter_team=1, now=1.0)          # drops as ground token #1
    g.station("G1", "$PICKUP,1,*", now=2.0)         # G1 grabs it
    assert _p(g, "G1")["carried"] == 40


def test_ground_token_consumed_once_only():
    g = _game(drop_policy="ground", loot_per_kill=0)
    g.station("G2", "$LOOT,40,*", now=0.0)
    g.kill("G2", shooter_team=1, now=1.0)
    g.station("G1", "$PICKUP,1,*", now=2.0)
    g.station("G1", "$PICKUP,1,*", now=3.0)         # already gone
    assert _p(g, "G1")["carried"] == 40             # not doubled


def test_drop_policy_pool_is_not_ground_pickable():
    # "pool": loot returns to the shared pool (host re-seeds) — NOT a grabbable
    # ground token.
    g = _game(drop_policy="pool", loot_per_kill=0)
    g.station("G2", "$LOOT,40,*", now=0.0)
    g.kill("G2", shooter_team=1, now=1.0)
    g.station("G1", "$PICKUP,1,*", now=2.0)         # nothing on the ground to grab
    assert _p(g, "G1")["carried"] == 0
    assert _p(g, "G2")["carried"] == 0


def test_dead_killer_fallback_to_ground_not_double_credited():
    # policy "killer", but the resolved killer is already DOWN when the carrier
    # dies → the loot must become a grabbable GROUND token (by="ground"), NOT be
    # silently handed to the dead killer. Verifies no double-credit: the dead
    # killer gets 0 AND exactly one 40-value token exists on the ground.
    g = _game(guns=("G1", "G2", "G3"), damage=25,
              drop_policy="killer", loot_per_kill=0)
    g.station("G1", "$LOOT,40,*", now=0.0)
    g.hit("G1", shooter_team=2, now=1.0)            # G2 tags G1 (records the shooter, non-fatal)
    g.kill("G2", shooter_team=3, now=2.0)          # G3 downs G2 (the would-be killer)
    g.event("G1", "$HP,0,0,0,*", now=3.0)          # G1 dies, attributed to (down) G2
    assert _p(g, "G2")["carried"] == 0              # dead killer received nothing
    g.station("G3", "$PICKUP,1,*", now=4.0)         # the token is on the ground, grabbable
    assert _p(g, "G3")["carried"] == 40
    assert _p(g, "G1")["carried"] == 0


# --------------------------------------------------------------------------- #
# Kill-loot                                                                    #
# --------------------------------------------------------------------------- #
def test_kill_loot_credited_to_killer():
    g = _game(loot_per_kill=10, drop_policy="ground")
    g.station("G2", "$LOOT,0,*", now=0.0)          # no carried loot to drop
    g.kill("G2", shooter_team=1, now=1.0)          # G1 kills G2
    assert _p(g, "G1")["carried"] == 10             # kill-loot only
    assert _p(g, "G2")["carried"] == 0


def test_unattributed_death_grants_no_kill_loot():
    # A death with no valid attribution (no shooter / self) must not mint kill-loot
    # for anyone — mirrors the engine's `killer_id != victim_id` guard.
    g = _game(loot_per_kill=10)
    g.event("G2", "$HP,0,0,0,*", now=5.0)          # bare death, no preceding $HIR
    assert _p(g, "G1")["carried"] == 0
    assert _p(g, "G2")["carried"] == 0


def test_attribution_fuse_stale_hit_does_not_miscredit_killloot():
    # A stale non-fatal hit long before a later (unattributed) death must NOT be
    # credited as the kill — the 6s attribution fuse drops it.
    g = _game(guns=("G1", "G2"), damage=25, loot_per_kill=10)
    g.hit("G2", shooter_team=1, now=0.0)           # G1 tags G2 once, non-fatally
    g.event("G2", "$HP,0,0,0,*", now=100.0)        # G2 dies 100s later, no fresh shooter
    assert _p(g, "G1")["carried"] == 0              # stale hit didn't steal the kill-loot


# --------------------------------------------------------------------------- #
# Host respawn                                                                 #
# --------------------------------------------------------------------------- #
def test_host_respawn_returns_player_alive_after_delay():
    g = _game(respawn_s=5)
    g.kill("G2", shooter_team=1, now=1.0)          # down at 1
    assert _p(g, "G2")["status"] == "down"
    g.tick(now=3.0)                                # too soon
    assert _p(g, "G2")["status"] == "down"
    g.tick(now=7.0)                                # 1 + 5 = 6 ≤ 7 → respawn
    assert _p(g, "G2")["status"] == "alive"
    assert g.alive("G2")                            # $SPAWN reached the gun too


def test_repeat_death_while_down_does_not_reset_respawn_clock():
    # A stray repeat $HP,0 while already DOWN must not push out the respawn time.
    g = _game(respawn_s=5)
    g.kill("G2", shooter_team=1, now=1.0)          # DOWN at 1 → respawn due @6
    g.event("G2", "$HP,0,0,0,*", now=3.0)          # stray repeat — must NOT reset to 3
    g.tick(now=6.1)                                # 6 ≤ 6.1 → respawn is due
    assert _p(g, "G2")["status"] == "alive"


# --------------------------------------------------------------------------- #
# extract_removes_player: leave-the-raid vs. keep-playing                      #
# --------------------------------------------------------------------------- #
def test_extract_removes_player_true_leaves_the_raid():
    g = _game(channel_s=5, win_target=1000, extract_removes_player=True)
    g.station("G1", "$LOOT,30,*", now=0.0)
    g.station("G1", "$ZONE,Alpha,*", now=1.0)
    g.tick(now=7.0)
    assert _p(g, "G1")["status"] == "extracted"
    assert _p(g, "G1")["banked"] == 30


def test_extract_removes_player_false_keeps_playing_and_can_extract_again():
    g = _game(channel_s=5, win_target=1000, extract_removes_player=False)
    g.station("G1", "$LOOT,30,*", now=0.0)
    g.station("G1", "$ZONE,Alpha,*", now=1.0)
    g.tick(now=7.0)                                # first extract
    assert _p(g, "G1")["status"] == "alive"        # respawn clean, still in the raid
    assert _p(g, "G1")["banked"] == 30 and _p(g, "G1")["carried"] == 0
    # a second raid+extract accrues on top
    g.station("G1", "$LOOT,20,*", now=8.0)
    g.station("G1", "$ZONE,Bravo,*", now=9.0)
    g.tick(now=15.0)
    assert _p(g, "G1")["banked"] == 50


# --------------------------------------------------------------------------- #
# The loud channel cue (genre signature: "everyone knows where you are")       #
# --------------------------------------------------------------------------- #
def test_entering_zone_emits_fieldwide_extraction_alarm():
    # ChannelStarted -> the CALLER hears "Black Hawk inbound" and EVERY gun hears the chopper alert
    # (A11 extraction ladder; the old field-wide countdown was a placeholder).
    from brx_mcp import sounds as snd
    called = f"$PLAY,,4,6,{snd.EXTRACTION_CALLED},,,,*"
    alert = f"$PLAY,,4,6,{snd.EXTRACTION_ALERT},,,,*"
    g = _game(guns=("G1", "G2"), channel_s=10, win_target=100)
    before = {p: (g.frames_to(p).count(called), g.frames_to(p).count(alert)) for p in ("G1", "G2")}
    g.station("G1", "$ZONE,Alpha,*", now=1.0)
    after = {p: (g.frames_to(p).count(called), g.frames_to(p).count(alert)) for p in ("G1", "G2")}
    assert after["G1"] == (before["G1"][0] + 1, before["G1"][1] + 1)     # the extractor: call + alert
    assert after["G2"] == (before["G2"][0], before["G2"][1] + 1)         # everyone else: the alert only
