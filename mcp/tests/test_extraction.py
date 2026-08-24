"""Tests for the Extraction game-mode rules engine.

Pure logic, no BLE — runs anywhere. Exercises the genre's defining moments:
loot accrual, the loud channel start, drop-on-death, pickup of dropped loot,
a successful extraction (bank + boost), and the win condition.
"""

from brx_mcp.modes import (
    Bank,
    Callout,
    ChannelReset,
    ChannelStarted,
    Extracted,
    ExtractionConfig,
    ExtractionGame,
    GameOver,
    LootDropped,
    SendFrame,
)
from brx_mcp.modes.extraction import Status


def _one(actions, typ):
    """Return the single action of type `typ` (asserts exactly one)."""
    hits = [a for a in actions if isinstance(a, typ)]
    assert len(hits) == 1, f"expected 1 {typ.__name__}, got {len(hits)}: {actions}"
    return hits[0]


def test_loot_accrues_into_the_wallet():
    g = ExtractionGame(["red", "blue"])
    g.loot_pickup("red", 30)
    g.loot_pickup("red", 20)
    assert g.carried("red") == 50
    assert g.banked("red") == 0


def test_entering_zone_starts_channel_and_fires_loud_callout():
    g = ExtractionGame(["red"])
    actions = g.enter_zone("red", "Alpha", now=0.0)
    started = _one(actions, ChannelStarted)
    assert started.zone == "Alpha"
    callout = _one(actions, Callout)
    assert callout.scope == "all"           # field-wide = "everyone knows"
    assert "Alpha" in callout.text
    # channel is in progress but not complete
    assert 0.0 < g.channel_progress("red", now=10.0) < 1.0


def test_successful_extraction_banks_loot_and_grants_boost():
    cfg = ExtractionConfig(channel_s=45.0, boost_per_extract=("$LIFE,0,0,50,*",))
    g = ExtractionGame(["red"], cfg)
    g.loot_pickup("red", 100)
    g.enter_zone("red", "Alpha", now=0.0)

    assert g.tick(now=44.0) == []            # not done yet
    actions = g.tick(now=45.0)               # channel elapsed

    ex = _one(actions, Extracted)
    assert ex.value == 100
    bank = _one(actions, Bank)
    assert bank.total == 100
    boost = _one(actions, SendFrame)
    assert boost.frame == "$LIFE,0,0,50,*" and boost.player_id == "red"
    assert g.carried("red") == 0 and g.banked("red") == 100
    assert g.status("red") is Status.EXTRACTED


def test_dying_mid_channel_drops_loot_and_resets_channel():
    g = ExtractionGame(["red", "blue"], ExtractionConfig(drop_policy="ground"))
    g.loot_pickup("red", 80)
    g.enter_zone("red", "Alpha", now=0.0)

    actions = g.on_death("red", killer_id="blue", now=20.0)
    _one(actions, ChannelReset)
    drop = _one(actions, LootDropped)
    assert drop.value == 80 and drop.from_player == "red"

    # red is down and empty; the channel is gone
    assert g.status("red") is Status.DOWN
    assert g.carried("red") == 0
    assert g.channel_progress("red", now=40.0) == 0.0
    # ...and it never completes even after the would-be channel time
    assert g.tick(now=60.0) == []
    # blue got kill-loot (default 10)
    assert g.carried("blue") == 10


def test_dropped_loot_can_be_picked_up_by_another_player():
    g = ExtractionGame(["red", "blue"], ExtractionConfig(loot_per_kill=0))
    g.loot_pickup("red", 80)
    drop = _one(g.on_death("red", killer_id="blue", now=5.0), LootDropped)

    g.pickup_dropped("blue", drop.drop_id)
    assert g.carried("blue") == 80
    # the token is consumed — can't be grabbed twice
    g.pickup_dropped("blue", drop.drop_id)
    assert g.carried("blue") == 80


def test_drop_policy_killer_sends_loot_straight_to_killer():
    g = ExtractionGame(["red", "blue"],
                       ExtractionConfig(drop_policy="killer", loot_per_kill=0))
    g.loot_pickup("red", 40)
    g.on_death("red", killer_id="blue", now=1.0)
    assert g.carried("blue") == 40
    assert g.dropped == {}                   # nothing left on the ground


def test_leaving_zone_resets_the_channel():
    g = ExtractionGame(["red"])
    g.loot_pickup("red", 50)
    g.enter_zone("red", "Alpha", now=0.0)
    reset = _one(g.leave_zone("red", now=10.0), ChannelReset)
    assert reset.reason == "left_zone"
    assert g.tick(now=50.0) == []            # no extraction — channel was reset
    assert g.banked("red") == 0


def test_down_player_cannot_loot_or_channel():
    g = ExtractionGame(["red", "blue"])
    g.on_death("red", killer_id=None, now=0.0)
    assert g.loot_pickup("red", 10) == []
    assert g.carried("red") == 0
    assert g.enter_zone("red", "Alpha", now=1.0) == []


def test_respawn_returns_player_alive_but_empty():
    g = ExtractionGame(["red"])
    g.loot_pickup("red", 30)
    g.on_death("red", killer_id=None, now=0.0)
    g.respawn("red")
    assert g.status("red") is Status.ALIVE
    assert g.carried("red") == 0             # loot was dropped on death


def test_killer_policy_with_dead_killer_falls_back_to_ground_labeled_correctly():
    # mutual kill: blue dies too, so the "killer" can't receive loot → it must become
    # a grabbable ground token, and LootDropped.by must say "ground" (not "killer"),
    # or a driver would double-credit (dead killer + the pickable token).
    g = ExtractionGame(["red", "blue"], ExtractionConfig(drop_policy="killer", loot_per_kill=0))
    g.loot_pickup("red", 40)
    g.on_death("blue", killer_id=None, now=1.0)      # blue is already down
    drop = _one(g.on_death("red", killer_id="blue", now=2.0), LootDropped)
    assert drop.by == "ground"                        # not "killer"
    assert g.carried("blue") == 0                     # dead killer got nothing
    assert drop.drop_id in g.dropped                  # token is on the ground, grabbable


def test_two_extractions_same_tick_with_win_target_stops_after_winner():
    # both channels elapse in the same tick(); with a win_target the first to complete
    # wins and the loop must stop — the second player must NOT also bank/extract.
    cfg = ExtractionConfig(channel_s=5.0, win_target=50, extract_removes_player=False)
    g = ExtractionGame(["red", "blue"], cfg)
    g.loot_pickup("red", 60)
    g.loot_pickup("blue", 60)
    g.enter_zone("red", "Alpha", now=0.0)
    g.enter_zone("blue", "Bravo", now=0.0)
    actions = g.tick(now=5.0)
    overs = [a for a in actions if isinstance(a, GameOver)]
    banks = [a for a in actions if isinstance(a, Bank)]
    assert len(overs) == 1                            # exactly one winner declared
    assert len(banks) == 1                            # only the winner banked this tick
    assert g.over is True
    # exactly one of them actually banked; the other kept its loot
    assert (g.banked("red") == 60) != (g.banked("blue") == 60)


def test_win_target_ends_the_game():
    cfg = ExtractionConfig(channel_s=5.0, win_target=100,
                           extract_removes_player=False)
    g = ExtractionGame(["red"], cfg)
    g.loot_pickup("red", 100)
    g.enter_zone("red", "Alpha", now=0.0)
    actions = g.tick(now=5.0)
    over = _one(actions, GameOver)
    assert over.winner == "red" and over.total == 100
    assert g.over is True
    # engine is inert after game over
    assert g.loot_pickup("red", 50) == []
    assert g.tick(now=10.0) == []
