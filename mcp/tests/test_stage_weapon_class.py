"""DRY-1 (review 2026-10-10): the stage decides "energy weapon" with the phone's ONE rule (app/src/weaponclass.js
`isEnergyClass`): the catalogue row's `weapon_class` decides, and the id regex /energy|charge/i is only the fallback for a
row without a class (a pre-A48 bundle). Both sides read app/test/fixtures/weapon-class-cases.json."""
import json
import pathlib
import sys

if __name__ == "__main__":
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from brx_mcp.stage.stage import is_energy_class
from _stage import mk_stage

CASES = pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "weapon-class-cases.json"


def test_the_stage_rule_matches_every_shared_case():
    cases = json.loads(CASES.read_text())["cases"]
    assert len(cases) >= 4, "control: the shared file has cases"
    bad = [c for c in cases if is_energy_class(c.get("weapon_class"), c["weapon_id"]) is not c["energy"]]
    assert not bad, bad


def test_the_reload_reads_the_catalogue_row_class_not_the_id():
    st, _ = mk_stage()
    rows = st.compiler.weapon_catalog()
    energy = [r for r in rows if r.get("weapon_class") == "energy" and not __import__("re").search("energy|charge", r["weapon_id"], 2)]
    assert energy, "control: the catalogue has an energy weapon whose id the regex would miss"
    st.player = {"loadout": {"weapons": [{"weapon_id": energy[0]["weapon_id"]}]}}
    st.active_slot = 0
    assert st._active_weapon_is_energy() is True, energy[0]["weapon_id"]
