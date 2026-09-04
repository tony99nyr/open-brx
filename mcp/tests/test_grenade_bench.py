"""The grenade bench turns a gun's `$HIR` echo of a grenade beacon into the word our emitter replays.

The echo carries every field of the 25-bit word but the parity trailer, so the replay word is
derivable without the (fragmenting, F12) receiver. These pin that derivation to the same encoder
the 2026-08-26 brute force used, so a replay that fails is a finding about the gun, not a typo.
"""
import pathlib
import sys

TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))

import grenade_bench as G  # noqa: E402
from brx_mcp.irbridge import decode_word, payload_parity  # noqa: E402


def _brute_force_word(bullet=0, player=42, team=2, damage=20, crit=0, unknown=0):
    """`word()` exactly as `~/.brx-mcp/brute_revive.py` wrote it on 2026-08-26."""
    f = lambda v, n: format(v & ((1 << n) - 1), "0%db" % n)  # noqa: E731
    pay = f(bullet, 4) + f(player, 6) + f(team, 2) + f(damage, 8) + f(crit, 1) + f(unknown, 2)
    return pay + payload_parity(pay)


def test_respawn_beacon_echo_becomes_the_brute_force_word():
    # exp-log #37: a Respawn grenade claimed by team 1 beacons `$HIR,0,15,0,1,6,0,0`
    raw = "$HIR,0,15,0,1,6,0,0,*"
    assert G.is_beacon(raw)
    assert G.beacon_word(raw) == _brute_force_word(bullet=15, player=0, team=1, damage=6)
    assert G.beacon_word(raw) == G.respawn_beacon(1)
    d = decode_word(G.beacon_word(raw))
    assert (d["proto"], d["team"], d["damage"], d["subtype"]) == (15, 1, 6, 0)
    assert d["parity_matches"]


def test_hill_beacon_and_describe():
    raw = "$HIR,0,15,0,2,8,0,0,*"
    assert G.beacon_word(raw) == G.hill_beacon(2)
    assert "HILL" in G.describe_beacon(raw) and "team2" in G.describe_beacon(raw)


def test_gun_shot_is_not_a_beacon():
    raw = "$HIR,0,0,0,2,9,0,3,*"          # a real gun hit from exp-log #35
    assert not G.is_beacon(raw)
    assert G.beacon_word(raw) == _brute_force_word(bullet=0, player=0, team=2, damage=9, unknown=3)
    assert G.describe_beacon(raw) == raw
    assert G.hir_fields("$HP,45,70,0,*") is None


def test_alive_from_hp_and_lcd_only():
    assert G.alive_from("$LCD,45,70,0,0,32,384,*") is True
    assert G.alive_from("$LCD,0,0,0,0,0,0,*") is False
    assert G.alive_from("$HP,0,0,0,*") is False
    assert G.alive_from("$HP,15,70,20,*") is True
    assert G.alive_from("$HIR,0,15,0,1,6,0,0,*") is None
    assert G.alive_from("$BUT,1,*") is None


def test_kill_word_out_damages_the_bench_pools():
    d = decode_word(G.kill_word())
    assert d["proto"] == 0 and d["damage"] == 200 and d["team"] == G.ENEMY_TEAM
    assert d["damage"] > 45 + 70 + 70        # HP + armour + shield capacity in bench PSET


def test_passthru_rows_cover_every_subtype_with_a_no_pool_function():
    assert len(G.PASSTHRU_ROWS) == 4
    for u, row in enumerate(G.PASSTHRU_ROWS):
        assert row.startswith(f"$SIR,15,{u},,24,")


def test_configs_end_hittable_and_fireable():
    for mode in ("passthru", "game"):
        fr = G.config_frames(mode)
        assert "$CLEAR,*" in fr and any(f.startswith("$SIR,0,0,") for f in fr)
        assert fr.index("$CLEAR,*") < min(i for i, f in enumerate(fr) if f.startswith("$SIR,"))
        assert fr.index("$BMAP,0,0,,,,,*") < fr.index("$SPAWN,,*")      # F16
        assert fr[-1] == "$BMAP,0,0,,,,,*"
    assert G.config_frames("bare") == []
    assert any(f.startswith("$SIR,15,") for f in G.config_frames("passthru"))
    assert not any(f.startswith("$SIR,15,") for f in G.config_frames("game"))
