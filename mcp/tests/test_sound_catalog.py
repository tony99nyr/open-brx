"""The derived on-gun sound catalog, and every id we ship checked against it.

2026-09-03: the whole bank (2477 `.LTP` files) was read off a v4.32 tagger and analysed. Two things
this pins: (1) the catalog file is well-formed and carries the facts the pickers rely on; (2) every
sound id hard-coded anywhere in the server exists ON THE GUN -- the app's own bank (restated as
`data/sound_ids.json`, from Sounds.json -- see protocol/callsign-extract/RAW_ASSETS_NOTE.md) lists
157 ids the gun does not have, and `test_sounds.py`'s bank check could not see that.

2026-09-18: folded in community labels from the LaserTagMods BRX Audio sheet (`mcp/tools/
soundbank_community.py`, `data/community_sound_labels.csv`). `test_community_label_never_overwrites_
our_own_evidence` pins the one rule that matters: a community label is a guess, and it never
replaces our own `description` / `transcript` / `verified_by_ear`.
"""
import json
import pathlib
import re
import sys

from brx_mcp import sounds as snd

ROOT = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp"
TOOLS = pathlib.Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
import soundbank_community as sbc  # noqa: E402
import soundbank_classify as sbclass  # noqa: E402

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


def test_app_derivative_round_trip_keeps_the_468_gun_only_ids():
    """Regenerating from the union catalog must not mistake every on-gun row for an app row."""
    app_ids = sbclass.app_durations(CATALOG)
    restated = json.load(open(ROOT / "data" / "sound_ids.json"))
    # The analysis catalog carries measured file durations while sound_ids.json restates the app's
    # values; a few round differently. This contract is membership, not measurement equality.
    assert set(app_ids) == set(sbclass.app_durations(restated))
    assert len(app_ids) == 2166
    assert sum(1 for e in CATALOG["sounds"] if e["on_gun"] and e["id"] not in app_ids) == 468


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
    assert BY_ID["V116"]["transcript"] == "gained the lead"
    assert BY_ID["V116"]["transcript_verified_by_ear"] is True


def test_row_review_does_not_overstate_transcript_confidence():
    """VA2 was identified as the gas-victim cough, not transcribed syllable by syllable."""
    assert BY_ID["VA2"]["verified_by_ear"] is True
    assert not BY_ID["VA2"].get("transcript_verified_by_ear")


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


def test_every_confirmed_runtime_cue_is_described_in_the_public_catalog_source():
    """The site is generated from sound_catalog.json. A cue known to the runtime but absent here
    used to leave the public table blank or machine-only even though the repo knew its meaning."""
    missing = [c.sid for c in snd.CATALOG if c.confidence == snd.CONFIRMED and not BY_ID[c.sid].get("known_use")]
    assert missing == [], f"confirmed runtime cues missing known_use in sound_catalog.json: {missing}"


def test_community_fields_are_well_formed_where_present():
    """`community_label` / `community_status` / `community_flag_noise` are optional, but never
    malformed when present: every labelled id is on the gun, and status is one of the three we know."""
    for e in CATALOG["sounds"]:
        if "community_label" in e:
            assert e["on_gun"], e["id"]
            assert e["community_label"], e["id"]
            assert e.get("community_status") in ("new_label", "agrees", "differs"), e["id"]
        if e.get("community_flag_noise"):
            assert e["community_flag_noise"] is True, e["id"]
    assert CATALOG.get("community_source"), "top-level community_source is missing"


def test_noise_flagged_ids_are_not_shipped_anywhere():
    """The 20 ids the community reports broken since firmware v4.30 (S1, docs/FOLLOWUPS.md) must not
    be hard-coded into any weapon or voice config until they are ear-checked."""
    noisy = {e["id"] for e in CATALOG["sounds"] if e.get("community_flag_noise")}
    assert len(noisy) == 20
    files = [ROOT / "sounds.py", ROOT / "modes" / "announcer.py", ROOT / "mc" / "compile.py",
             ROOT / "gameconfig.py", ROOT / "modes" / "cs.py", ROOT / "mc" / "weapons.json"]
    for f in files:
        if not f.exists():
            continue
        text = f.read_text()
        hit = {i for i in noisy if i in text}
        assert not hit, f"{f.name} ships a NOISE-flagged id: {hit}"


def test_community_label_never_overwrites_our_own_evidence():
    """`soundbank_community.merge()` must never touch `description`, `transcript` or
    `verified_by_ear` -- a community label is an unconfirmed guess, not a bench finding.

    Break it once and watch it fail: change `merge()` to also set
    `entry["description"] = row["label"]` and this test goes red.
    """
    fake_catalog = {"sounds": [{
        "id": "ZZ99", "on_gun": True, "in_app": True, "kind": "fx", "category": "fx:misc_fx",
        "description": "our own evidence, must survive", "transcript": "",
        "verified_by_ear": True,
    }]}
    fake_labels = {"ZZ99": {"id": "ZZ99", "label": "a community guess", "status": "differs"}}
    sbc.merge(fake_catalog, fake_labels)
    entry = fake_catalog["sounds"][0]
    assert entry["description"] == "our own evidence, must survive"
    assert entry["transcript"] == ""
    assert entry["verified_by_ear"] is True
    assert entry["community_label"] == "a community guess"
    assert entry["community_status"] == "differs"
