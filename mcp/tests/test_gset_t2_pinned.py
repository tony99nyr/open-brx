"""$GSET token 2 (`outdoorMode`) must ship 0 at EVERY venue.

Field-measured 2026-09-13: t2=1 collapses hit reception on the receiving gun — a full clip at 30 ft
registered zero hits, while the same gun at t2=0 registered nearly every shot. It is the whole of the
2026-09-12 outdoor failure. This test exists so that wiring t2 back to the venue flag fails loudly
instead of silently making outdoor games unplayable again.
"""
from brx_mcp.gameconfig import GameConfig
from brx_mcp.mc.compile import Compiler, VOL_TRYOUT
from brx_mcp.mc.fakes import FakeCompiler
from _session import match_config


_TEAMS = [
    {"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
    {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 2},
]


def _player():
    return {
        "player_id": "p7", "player_num": 7, "display": "REAPER", "team_id": "blue",
        "node_id": None, "gun_id": None, "voice": "male", "ready": True,
        "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]},
    }


def _frame_t2(frames: list[str]) -> str:
    gsets = [frame for frame in frames if frame.startswith("$GSET,")]
    assert len(gsets) == 1, f"expected one $GSET, got {gsets}"
    return gsets[0].split(",")[2]


def _t2(cfg) -> str:
    return cfg._gset().split(",")[2]


def test_gset_token2_is_zero_indoors_and_outdoors():
    for outdoor in (False, True):
        cfg = GameConfig()
        cfg.outdoor = outdoor
        assert _t2(cfg) == "0", (
            f"$GSET t2 shipped {_t2(cfg)!r} with outdoor={outdoor}. It must be 0 at BOTH venues: "
            "t2=1 cripples hit reception on the receiving gun (field 2026-09-13). "
            "See docs/archive/HANDOFF-gset-t2-2026-09-13.md"
        )


def test_gset_token2_does_not_track_the_venue():
    a, b = GameConfig(), GameConfig()
    a.outdoor, b.outdoor = False, True
    assert _t2(a) == _t2(b), "$GSET t2 must not vary with the venue"


def test_the_other_gset_tokens_still_carry_their_meaning():
    cfg = GameConfig()
    cfg.friendly_fire = True
    toks = cfg._gset().split(",")
    assert toks[1] == "1", "token 1 is friendlyFire and must still follow the config"
    assert toks[3] == "1", "token 3 (gunLaserRegion) unchanged"


def test_player_heads_pin_t2_but_keep_venue_volume_in_real_and_fallback_compilers():
    """Both compilers can reach real guns, so both must keep the reception fix and venue volume."""
    for compiler in (Compiler(), FakeCompiler()):
        for environment, volume in (("indoor", 80), ("outdoor", 90)):
            config = match_config("tdm", teams=_TEAMS)
            config["environment"] = environment
            head = compiler.compile(config, _player(), _TEAMS)["head"]
            assert _frame_t2(head) == "0", f"{type(compiler).__name__}/{environment}"
            assert head[0] == f"$VOL,{volume},0,*", (
                f"{type(compiler).__name__}/{environment}: venue volume stopped tracking environment"
            )


def test_utility_tryouts_pin_t2_at_both_venues_in_real_and_fallback_compilers():
    """Try-outs bypass `GameConfig._gset`; guard their hand-built frame at both venues."""
    weapon = {"weapon_id": "assault_rifle"}
    for compiler in (Compiler(), FakeCompiler()):
        for environment in ("indoor", "outdoor"):
            frames = compiler.tutorial_frames(weapon, environment)
            assert _frame_t2(frames) == "0", f"{type(compiler).__name__}/{environment}"
            assert frames[0] == f"$VOL,{VOL_TRYOUT},0,*", (
                f"{type(compiler).__name__}/{environment}: try-out volume policy changed"
            )
