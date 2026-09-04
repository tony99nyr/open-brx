"""Tests for the B18 killstreak/multikill announcer — pure logic + FFA integration.

The announcer is the host-side reconstruction of native kill feedback, driven over
BLE exactly as the official app does it (protocol §7o): $SFLASH for the green-sight
flash plus $PLAY on the token-4 announcer slot.
"""

import asyncio

from brx_mcp.modes.announcer import KILL_LINE, KillAnnouncer
from brx_mcp.modes.base import Callout, KillConfirm, PlaySound
from brx_mcp.modes.deathmatch import DeathmatchEngine
from brx_mcp.gameconfig import GameConfig


def _phrases(actions):
    return [a.text for a in actions if isinstance(a, Callout)]


def _run(coro):
    """Drive a coroutine on the suite's shared loop.

    Deliberately NOT `asyncio.run()`: that closes the loop it creates, and this
    module sorts first, so every later `get_event_loop()` test would fail.
    """
    return asyncio.get_event_loop().run_until_complete(coro)


# --------------------------------------------------------------------------- #
# Pure KillAnnouncer                                                          #
# --------------------------------------------------------------------------- #
def test_first_blood_fires_once_across_the_game():
    a = KillAnnouncer()
    assert "First Blood" in _phrases(a.on_kill("A", "B", now=0.0))
    # a later kill (by anyone) is not first blood again
    assert "First Blood" not in _phrases(a.on_kill("C", "D", now=10.0))


def test_double_then_triple_within_window():
    a = KillAnnouncer(window_s=4.0)
    assert "Double Kill" not in _phrases(a.on_kill("A", "B", now=0.0))   # 1st
    assert "Double Kill" in _phrases(a.on_kill("A", "C", now=2.0))       # 2nd within 4s
    assert "Triple Kill" in _phrases(a.on_kill("A", "D", now=3.5))       # 3rd within 4s of 2nd


def test_multikill_window_expiry_resets_chain():
    a = KillAnnouncer(window_s=4.0)
    a.on_kill("A", "B", now=0.0)
    # 2nd kill is >4s after the 1st → chain resets, NOT a double kill
    assert "Double Kill" not in _phrases(a.on_kill("A", "C", now=5.0))
    assert a.snapshot()["chains"]["A"] == 1


def test_multikill_is_per_shooter():
    a = KillAnnouncer(window_s=4.0)
    a.on_kill("A", "X", now=0.0)
    # B's first kill right after is NOT a double (different shooter)
    assert "Double Kill" not in _phrases(a.on_kill("B", "Y", now=1.0))


def test_streak_thresholds_5_and_10():
    a = KillAnnouncer(window_s=100.0)   # wide window so chain never resets on timing
    phrases = []
    for i in range(10):
        phrases.append(_phrases(a.on_kill("A", f"v{i}", now=float(i))))
    assert "Killing Spree" in phrases[4]     # 5th kill
    assert "Unstoppable" in phrases[9]        # 10th kill


def test_streak_and_chain_reset_on_death():
    a = KillAnnouncer(window_s=4.0)
    for i in range(4):
        a.on_kill("A", f"v{i}", now=float(i))
    assert a.snapshot()["streaks"]["A"] == 4
    a.on_death("A")
    assert "A" not in a.snapshot()["streaks"]           # streak gone
    # next kill starts a fresh streak of 1 and no multikill chain
    acts = a.on_kill("A", "v9", now=10.0)
    assert a.snapshot()["streaks"]["A"] == 1
    assert "Double Kill" not in _phrases(acts)


def test_multikill_tiers_announce_once_no_spam_beyond_four():
    a = KillAnnouncer(window_s=100.0)   # wide window: chain keeps growing
    phrases = [_phrases(a.on_kill("A", f"v{i}", now=float(i))) for i in range(6)]
    assert "Killtacular" in phrases[3]      # 4th kill announces the top tier
    assert "Killtacular" not in phrases[4]  # 5th — not repeated
    assert "Killtacular" not in phrases[5]  # 6th — not repeated


def test_medal_playsound_emitted_only_when_id_configured():
    """The MEDAL line needs a configured id; the plain kill line is confirmed and
    always plays (§7o) — so an id set to None means Callout + kill line only. Since
    2026-09-03 the defaults ARE configured from the gun's own audio (VA7E = "Double Kill")."""
    a = KillAnnouncer(sounds={"double_kill": None})
    a.on_kill("A", "B", now=0.0)
    acts = a.on_kill("A", "C", now=1.0)
    ids = [x.sound_id for x in acts if isinstance(x, PlaySound)]
    assert ids == [KILL_LINE]                    # kill confirm line, no medal sound
    assert "Double Kill" in _phrases(acts)
    d = KillAnnouncer()                          # the shipped default speaks the real medal
    d.on_kill("A", "B", now=0.0)
    acts = d.on_kill("A", "C", now=1.0)
    assert [x.sound_id for x in acts if isinstance(x, PlaySound)] == [KILL_LINE, "VA7E"]
    # configure the double-kill id → its PlaySound appears alongside the kill line
    b = KillAnnouncer(sounds={"double_kill": "VX99"})
    b.on_kill("A", "B", now=0.0)
    acts = b.on_kill("A", "C", now=1.0)
    ps = [x for x in acts if isinstance(x, PlaySound)]
    assert [x.sound_id for x in ps] == [KILL_LINE, "VX99"]
    assert all(x.scope == "A" for x in ps)
    # every announcer line speaks on the token-4 voice slot, not the effect slot
    assert all(x.slot == "voice" for x in ps)


def test_every_kill_emits_the_sight_flash_and_kill_line():
    """The app's per-kill pair: $SFLASH (green sight) + the confirmed kill line,
    both scoped to the shooter — even for an unremarkable kill with no medal."""
    a = KillAnnouncer()
    a.on_kill("A", "B", now=0.0)          # burn first blood
    acts = a.on_kill("C", "D", now=30.0)  # plain kill, no medal, no streak
    flashes = [x for x in acts if isinstance(x, KillConfirm)]
    assert len(flashes) == 1 and flashes[0].scope == "C"
    ids = [x.sound_id for x in acts if isinstance(x, PlaySound)]
    assert ids == [KILL_LINE]
    # the flash leads, exactly as the app orders it
    assert isinstance(acts[0], KillConfirm)


def test_all_actions_scoped_to_shooter():
    a = KillAnnouncer()
    acts = a.on_kill("SHOOTER", "victim", now=0.0)
    assert acts and all(a_.scope == "SHOOTER" for a_ in acts)


# --------------------------------------------------------------------------- #
# Integration through the FFA engine                                          #
# --------------------------------------------------------------------------- #
def _hir(team):
    return {"command": "HIR", "tokens": ["HIR", "4", "0", "0", str(team)]}


def _dead():
    return {"command": "HP", "tokens": ["HP", "0", "0", "0"]}


def test_ffa_double_kill_announced_to_the_killer():
    cfg = GameConfig(mode="ffa", frag_limit=0, game_time_s=0, respawn_s=5)
    e = DeathmatchEngine(cfg)
    e.add_player("G1", 1)
    e.add_player("G2", 2)
    e.add_player("G3", 3)

    e.on_event("G2", _hir(1), now=1.0)             # G1 tags G2
    a1 = e.on_event("G2", _dead(), now=1.0)        # G2 dies → G1 first blood
    e.on_event("G3", _hir(1), now=2.0)             # G1 tags G3
    a2 = e.on_event("G3", _dead(), now=2.0)        # G3 dies within 4s → G1 double kill

    fb = [x for x in a1 if isinstance(x, Callout) and x.text == "First Blood"]
    assert fb and fb[0].scope == "G1"
    dk = [x for x in a2 if isinstance(x, Callout) and x.text == "Double Kill"]
    assert dk and dk[0].scope == "G1"
    assert e.snapshot()["announcer"]["chains"]["G1"] == 2


def test_dead_trade_killer_is_not_announced():
    # a killer who died in the trade must NOT get a streak or a $PLAY to a dead gun
    cfg = GameConfig(mode="ffa", frag_limit=0, game_time_s=0, respawn_s=5)
    e = DeathmatchEngine(cfg)
    for gid, team in [("G1", 1), ("G2", 2), ("V", 3)]:
        e.add_player(gid, team)
    e.on_event("V", _hir(1), now=1.0)          # G1 tags V (records last_shot on V)
    e.on_event("G1", _hir(2), now=1.5)         # G2 tags G1
    e.on_event("G1", _dead(), now=1.5)         # G1 dies (G2 takes first blood)
    acts = e.on_event("V", _dead(), now=2.0)   # V dies, credited to a now-DEAD G1
    assert not any(isinstance(x, Callout) and x.scope == "G1" for x in acts)
    assert "G1" not in e.snapshot()["announcer"]["streaks"]


def test_tdm_does_not_announce_per_player():
    # in TDM (shared teams) no specific killer gun is resolved → no announcer callouts
    cfg = GameConfig(mode="tdm", frag_limit=0, game_time_s=0, respawn_s=5)
    e = DeathmatchEngine(cfg)
    e.add_player("G1", 1)
    e.add_player("G2", 1)   # same team as G1 → team1 has 2 members
    e.add_player("V", 2)
    e.on_event("V", _hir(1), now=1.0)
    acts = e.on_event("V", _dead(), now=1.0)
    assert "First Blood" not in _phrases(acts)      # team1 killer not a single gun
    assert e.snapshot()["announcer"]["first_blood"] is False


# --------------------------------------------------------------------------- #
# Wire rendering — what actually reaches the gun                              #
# --------------------------------------------------------------------------- #
def test_kill_feedback_renders_to_the_frames_the_app_sends():
    """End-to-end: a credited kill must put the app's exact per-kill frames on the
    shooter's gun — `$SFLASH,*` then the kill line on the **token-4** announcer slot
    (protocol §7o). Guards the slot rendering, which is easy to get backwards."""
    from brx_mcp.modes.driver import GameDriver

    sent: list[tuple[str, str]] = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    drv = GameDriver(GameConfig(mode="ffa"), {"A": 1, "B": 2}, sender=sender,
                     announce=lambda *_: None)
    acts = KillAnnouncer().on_kill("A", "B", now=0.0)
    _run(drv.execute(acts))

    assert ("A", "$SFLASH,*") in sent, sent
    assert ("A", f"$PLAY,,4,6,{KILL_LINE},,,,*") in sent, sent
    # the flash lands before the voice line, as the app orders it
    assert sent.index(("A", "$SFLASH,*")) < sent.index(("A", f"$PLAY,,4,6,{KILL_LINE},,,,*"))
    # nothing was addressed to the victim
    assert all(pid == "A" for pid, _ in sent), sent


def test_effect_slot_still_renders_the_token_1_form():
    """Non-announcer sounds (explosions, stings) keep the original slot-1 form —
    the two slots must not collapse into one."""
    from brx_mcp.modes.driver import GameDriver

    sent: list[tuple[str, str]] = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    drv = GameDriver(GameConfig(mode="ffa"), {"A": 1}, sender=sender,
                     announce=lambda *_: None)
    _run(drv.execute([PlaySound("X13", scope="A")]))                # default slot
    assert sent == [("A", "$PLAY,X13,4,6,,,,,*")], sent
