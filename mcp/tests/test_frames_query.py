"""F271: read the config fields that ``$QUERY,*`` reports back from the pushed head.

The comparison must be against the frames MC actually sent, not a fresh compilation from the
catalog/config.  These tests pin the small pure reader that turns the effective ``$PSET``/team
writes in a head into the same five fields carried by ``ack_config.gun_config``.

Run: python3 run_tests.py frames_query
"""
from brx_mcp.mc import frames as _f


def test_head_gun_config_reads_player_team_and_all_three_pool_maxima():
    head = [
        "$PSET,7,1,33,11,22,V7M,1,77,S16,*",
        "$TID,3,*",
    ]

    assert _f.head_gun_config(head) == {
        "player_id": 7,
        "team": 3,
        "hp": 33,
        "armor": 11,
        "shield": 22,
    }


def test_head_gun_config_uses_the_last_effective_team_writer_in_frame_order():
    """The gun owns one team byte: ``$PSET`` t2 and ``$TID`` both overwrite it."""
    head = [
        "$TID,3,*",
        "$PSET,19,2,45,70,0,V3I,1,9,R01,*",
    ]

    assert _f.head_gun_config(head) == {
        "player_id": 19,
        "team": 2,
        "hp": 45,
        "armor": 70,
        "shield": 0,
    }


def test_head_gun_config_returns_none_when_the_pushed_head_cannot_make_the_claim():
    assert _f.head_gun_config(None) is None
    assert _f.head_gun_config(["$TID,1,*"]) is None
    assert _f.head_gun_config(["$PSET,7,1,45,,0,*", "$TID,1,*"]) is None
    assert _f.head_gun_config(["$PSET,not-a-player,1,45,70,0,*", "$TID,1,*"]) is None
