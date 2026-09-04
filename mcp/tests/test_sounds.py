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
    """Since 2026-09-03 the authority is the ON-GUN catalog (2477 ids read off the hardware), not the
    app's 2166-id Sounds.json: 468 ids exist only on the gun (VA8X "Fail." is one) and 157 app ids are
    not on the gun at all. So validate against what the gun actually has."""
    missing = snd.unknown_against_bank(snd.on_gun_ids())
    assert missing == [], f"catalog ids not on the gun: {missing}"

def test_names_and_ids_are_unique():
    names = [c.name for c in snd.CATALOG]
    ids = [c.sid for c in snd.CATALOG]
    assert len(names) == len(set(names))
    assert len(ids) == len(set(ids))


def test_sid_lookup_and_meaning():
    assert snd.sid("GAME_OVER") == "VA33"
    assert snd.meaning("VA33") == "game over + music"
    assert snd.meaning("ZZZ_unlisted") == "ZZZ_unlisted"   # passthrough


def test_no_cue_is_provisional_any_more():
    """2026-09-03: every semantic cue was checked against the gun's own audio (Whisper transcripts
    in data/sound_catalog.json). The objective callouts that used to be PROVISIONAL were wrong in
    kind (a death scream, two rules explainers) and are replaced; nothing is left to confirm by ear."""
    assert snd.provisional() == []

def test_engines_use_catalog_not_raw_ids():
    """Regression: no engine emits a raw-literal PlaySound (single or double
    quoted) — every cue goes through the grounded catalog (snd.*)."""
    import inspect
    from brx_mcp.modes import objectives, cs, deathmatch, survival, lms
    for mod in (objectives, cs, deathmatch, survival, lms):
        src = inspect.getsource(mod)
        assert 'PlaySound("' not in src and "PlaySound('" not in src, \
            f"{mod.__name__} has a raw-literal PlaySound id"
