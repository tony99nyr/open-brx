"""Tests for the grounded sound catalog — every id must be a real bank id."""

import json
import pathlib

from brx_mcp import sounds as snd

_BANK = (pathlib.Path(__file__).resolve().parents[2]
         / "protocol" / "callsign-extract" / "Sounds.json")


def _bank_ids():
    data = json.loads(_BANK.read_text())
    return set(data["SoundsLengthMap"].keys())


def test_every_catalog_id_is_a_real_bank_id():
    """The whole point of the catalog: no id plays the invalid-id fallback."""
    assert _BANK.exists(), f"bank not found at {_BANK}"
    missing = snd.unknown_against_bank(_bank_ids())
    assert missing == [], f"catalog ids not in the 2166 bank: {missing}"


def test_names_and_ids_are_unique():
    names = [c.name for c in snd.CATALOG]
    ids = [c.sid for c in snd.CATALOG]
    assert len(names) == len(set(names))
    assert len(ids) == len(set(ids))


def test_sid_lookup_and_meaning():
    assert snd.sid("GAME_OVER") == "VA33"
    assert snd.meaning("VA33") == "game over + music"
    assert snd.meaning("ZZZ_unlisted") == "ZZZ_unlisted"   # passthrough


def test_provisional_flagged_for_verification():
    prov = {c.name for c in snd.provisional()}
    # objective callouts are the by-ear TODO; game flow is confirmed
    assert "OBJECTIVE_SCORED" in prov
    assert "GAME_OVER" not in prov


def test_objectives_use_catalog_not_raw_ids():
    """Regression: engines emit semantic catalog ids, not stray literals."""
    import inspect
    from brx_mcp.modes import objectives
    src = inspect.getsource(objectives)
    assert 'PlaySound("' not in src   # every PlaySound goes through snd.*
