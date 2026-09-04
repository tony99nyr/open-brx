"""The derived on-gun sound catalog, and every id we ship checked against it.

2026-09-03: the whole bank (2477 `.LTP` files) was read off a v4.32 tagger and analysed. Two things
this pins: (1) the catalog file is well-formed and carries the facts the pickers rely on; (2) every
sound id hard-coded anywhere in the server exists ON THE GUN -- the app's `Sounds.json` lists 157
ids the gun does not have, and `test_sounds.py`'s bank check could not see that.
"""
import json
import pathlib
import re

from brx_mcp import sounds as snd

ROOT = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp"
CATALOG = json.load(open(snd.catalog_path()))
BY_ID = {e["id"]: e for e in CATALOG["sounds"]}
ON_GUN = snd.on_gun_ids()


def test_catalog_shape_and_counts():
    assert CATALOG["count_on_gun"] == 2477
    assert CATALOG["count_app_only"] == 157
    for e in CATALOG["sounds"]:
        assert e["kind"] in ("voice", "fx", "missing")
        assert ":" in e["category"]
        assert e["description"]
        if e["kind"] == "voice":
            assert e["category"].startswith("voice:") and "speaker" in e and "transcript" in e
        if e["kind"] == "missing":
            assert not e["on_gun"] and e["in_app"]


def test_character_slot_layout_holds_for_every_character():
    """Slot M is the character's name; slots 3-5 are screams; slot 7 is the healed line."""
    for fam in ("V0", "V3", "V8", "VD", "VE", "VH", "VJ"):
        assert BY_ID[fam + "M"]["category"] == "voice:name", fam
        assert BY_ID[fam + "3"]["category"] in ("voice:death_scream", "voice:line"), fam
        assert BY_ID[fam + "7"]["category"] in ("voice:healed", "voice:line"), fam


def test_known_by_ear_ids_match_their_transcripts():
    assert BY_ID["VA33"]["transcript"].lower().startswith("game over")
    assert BY_ID["VA81"]["transcript"].lower().startswith("three, two, one")
    assert BY_ID["VSF"]["transcript"].lower().startswith("victory")
    assert "depleted" in BY_ID["VA8B"]["transcript"].lower()          # "Shields depleted."
    assert "lead" in BY_ID["VB17"]["transcript"].lower()              # "Red team takes the lead."
    assert BY_ID["V3I"]["transcript"].lower().startswith("get some")


def _ids_in(path: pathlib.Path) -> set[str]:
    src = path.read_text()
    # quoted ids of the bank's shape: 1-2 letters, then 1-3 alnum; skip obvious non-ids
    found = set(re.findall(r'"([A-Z]{1,2}[0-9][0-9A-Z]{0,2}|V[A-Z0-9]{1,3}|X[0-9]{2}|H[0-9]{2}|U[0-9]{2}|W[0-9]{2}|N[0-9]{2}|JA[A-Z])"', src))
    return {i for i in found if i in BY_ID}


def test_every_shipped_sound_id_is_on_the_gun():
    files = [ROOT / "sounds.py", ROOT / "modes" / "announcer.py", ROOT / "mc" / "compile.py",
             ROOT / "gameconfig.py", ROOT / "modes" / "cs.py"]
    missing = {}
    for f in files:
        for i in _ids_in(f):
            if i not in ON_GUN:
                missing.setdefault(f.name, []).append(i)
    assert not missing, f"ids shipped but NOT on the gun: {missing}"


def test_semantic_cues_say_what_their_names_claim():
    """The 2026-09-03 transcripts caught four cues playing the wrong clip (a death scream for
    'objective taken', 12 s rules explainers for 'scored' and 'defused'). Pin the corrected ones."""
    want = {
        snd.OBJECTIVE_TAKEN: "flag taken", snd.OBJECTIVE_SCORED: "flag captured",
        snd.POINT_CAPTURED: "control point captured", snd.HILL_CAPTURED: "hill captured",
        snd.BOMB_DEFUSED: "bomb defused", snd.BOMB_PLANTED: "bomb planted",
        snd.LIVES_DEPLETED: "life's depleted", snd.ADD_ARMOR: "body armor",
        snd.COUNTDOWN: "three, two, one", snd.GAME_OVER: "game over", snd.CONNECT: "connection established",
    }
    for sid, words in want.items():
        assert words in BY_ID[sid]["transcript"].lower(), (sid, BY_ID[sid]["transcript"])
    assert not snd.provisional(), "every semantic cue is now transcript-verified"
