"""Proves `__main__.py`'s CLI wire tables are runtime-identical to `gameconfig.py`'s, BEFORE the
dedupe that deletes the CLI copies and imports from `gameconfig` instead.

Run this against the UNMODIFIED code first: a pass here is what makes deleting the CLI copies a
safe refactor rather than a hopeful one. `_SIR_TABLE` and `_BMAP` have no standalone name in
`__main__.py` -- they are hand-duplicated inline as `$SIR,...`/`$BMAP,...` rows inside
`GAME_CONFIG`, so those two checks extract the matching rows instead of comparing named constants.
"""
from brx_mcp import __main__ as cli
from brx_mcp import gameconfig as gc


def test_weapon_tails_identical():
    assert cli.WEAPON_TAILS == gc.WEAPON_TAILS


def test_weapon_ammo_identical():
    assert cli.WEAPON_AMMO == gc.WEAPON_AMMO


def test_spawn_sequence_identical():
    assert list(cli.SPAWN_SEQUENCE) == list(gc.SPAWN_SEQUENCE)


def test_respawn_sequence_identical():
    assert list(cli.RESPAWN_SEQUENCE) == list(gc.RESPAWN_SEQUENCE)


def test_sir_table_rows_in_game_config_match_gameconfig():
    rows = [f for f in cli.GAME_CONFIG if f.startswith("$SIR,")]
    assert rows == list(gc._SIR_TABLE)


def test_bmap_rows_in_game_config_match_gameconfig():
    rows = [f for f in cli.GAME_CONFIG if f.startswith("$BMAP,")]
    assert rows == list(gc._BMAP)
