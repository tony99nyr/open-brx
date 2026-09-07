"""Per-gun PLAYER ID in `$PSET` token 1 (protocol §7p).

Confirmed on hardware by cap10+cap11: the wire is **0-based, 0–63** (6 bits) while
the Callsign UI shows 1–64. Distinct ids are the prerequisite for per-player
attribution — with every gun on the default id, the shooter field is a constant.
"""

import asyncio

from _async import run as _run

from brx_mcp.gameconfig import MAX_PLAYER_ID, GameConfig
from brx_mcp.modes.driver import GameDriver


def _pset_of(frames):
    return next(f for f in frames if f.startswith("$PSET,"))


def test_pset_token1_is_the_player_id():
    f = _pset_of(GameConfig().setup_frames(6))
    assert f.split(",")[1] == "6", f
    # cap11 on the wire, verbatim
    assert f.startswith("$PSET,6,0,45,70,70,50,,H44,")


def test_default_is_zero():
    assert _pset_of(GameConfig().setup_frames()).split(",")[1] == "0"


def test_out_of_range_is_clamped_not_wrapped():
    """A wrapped id would silently collide with another player's and mis-attribute
    kills; clamping is loud-ish and safe. 69 -> 63 is what the app itself does."""
    assert _pset_of(GameConfig().setup_frames(69)).split(",")[1] == str(MAX_PLAYER_ID)
    assert _pset_of(GameConfig().setup_frames(-4)).split(",")[1] == "0"
    assert MAX_PLAYER_ID == 63          # 6 bits, matching the IR payload's player field




def _setup_sends(players, cfg=None):
    sent = []

    async def sender(pid, frame):
        sent.append((pid, frame))

    drv = GameDriver(cfg or GameConfig(mode="ffa"), players, sender=sender,
                     announce=lambda *_: None)
    _run(drv.setup())
    return drv, sent


def test_driver_auto_numbers_the_fleet_distinctly():
    drv, sent = _setup_sends({"A": 1, "B": 2, "C": 3})
    ids = {pid: f.split(",")[1] for pid, f in sent if f.startswith("$PSET,")}
    assert ids == {"A": "0", "B": "1", "C": "2"}, ids
    assert len(set(ids.values())) == 3          # the whole point: distinct


def test_pinned_ids_win_over_auto_numbering():
    cfg = GameConfig(mode="ffa", player_ids={"B": 40})
    _, sent = _setup_sends({"A": 1, "B": 2}, cfg)
    ids = {pid: f.split(",")[1] for pid, f in sent if f.startswith("$PSET,")}
    assert ids == {"A": "0", "B": "40"}, ids


def test_resetup_reuses_the_same_id():
    """A mid-game reconnect must not re-identify the player — a changed id would
    orphan every kill already credited to them."""
    drv, sent = _setup_sends({"A": 1, "B": 2})
    first = [f for pid, f in sent if pid == "B" and f.startswith("$PSET,")][0]
    sent.clear()
    _run(drv.resetup("B"))
    again = [f for pid, f in sent if pid == "B" and f.startswith("$PSET,")][0]
    # The voice slots are now the DEFAULT family (male / VA*), not the hardcoded Heavy pack (V3*)
    # every player used to get regardless of their `voice` — see gameconfig.VOICE_PACKS.
    # A15.3: the battleRespawnCry token AND the three pain tokens are EMPTY -- the node plays those itself.
    assert first == again == "$PSET,1,0,45,70,70,50,,H44,JAD,VA3,,,,,VA7,H06,H55,H13,H21,H02,U15,W71,A10,*"
