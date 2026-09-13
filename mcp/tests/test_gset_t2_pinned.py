"""$GSET token 2 (`outdoorMode`) must ship 0 at EVERY venue.

Field-measured 2026-09-13: t2=1 collapses hit reception on the receiving gun — a full clip at 30 ft
registered zero hits, while the same gun at t2=0 registered nearly every shot. It is the whole of the
2026-09-12 outdoor failure. This test exists so that wiring t2 back to the venue flag fails loudly
instead of silently making outdoor games unplayable again.
"""
from brx_mcp.gameconfig import GameConfig


def _t2(cfg) -> str:
    return cfg._gset().split(",")[2]


def test_gset_token2_is_zero_indoors_and_outdoors():
    for outdoor in (False, True):
        cfg = GameConfig()
        cfg.outdoor = outdoor
        assert _t2(cfg) == "0", (
            f"$GSET t2 shipped {_t2(cfg)!r} with outdoor={outdoor}. It must be 0 at BOTH venues: "
            "t2=1 cripples hit reception on the receiving gun (field 2026-09-13). "
            "See docs/HANDOFF-gset-t2-2026-09-13.md"
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
