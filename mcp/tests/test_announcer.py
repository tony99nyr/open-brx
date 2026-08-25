"""Tests for the B18 killstreak/multikill announcer — pure logic + FFA integration.

The announcer is the host-side reconstruction of the guns' native (nRF-only)
killstreak audio, driven over BLE via $PLAY (exp-log "feedback fork resolved").
"""

from brx_mcp.modes.announcer import KillAnnouncer
from brx_mcp.modes.base import Callout, PlaySound
from brx_mcp.modes.deathmatch import DeathmatchEngine
from brx_mcp.gameconfig import GameConfig


def _phrases(actions):
    return [a.text for a in actions if isinstance(a, Callout)]


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


def test_playsound_emitted_only_when_id_configured():
    # no ids configured → Callout only
    a = KillAnnouncer()
    a.on_kill("A", "B", now=0.0)
    acts = a.on_kill("A", "C", now=1.0)
    assert not any(isinstance(x, PlaySound) for x in acts)
    assert "Double Kill" in _phrases(acts)
    # configure the double-kill id → PlaySound scoped to the shooter appears
    b = KillAnnouncer(sounds={"double_kill": "VX99"})
    b.on_kill("A", "B", now=0.0)
    acts = b.on_kill("A", "C", now=1.0)
    ps = [x for x in acts if isinstance(x, PlaySound)]
    assert ps and ps[0].sound_id == "VX99" and ps[0].scope == "A"


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
