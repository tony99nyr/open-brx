"""F577 (Tony 2026-10-18, "Lets hide it"): the Haze (`smoke_gun`, `$SIR` fn 23) is hidden like glock and the cut arsenal.

Its 3 s blind beats AR + Body Armor at mid about 0.94 in the sim (0.29 at 1.5 s, brx2's balance review). Whether a `$SIR`
magnitude can shorten the blind is unbenched, and the S53 HUD is not built; it comes back when both are done. Hidden means
it leaves every picker, preset pool and type toggle, while the row and its frame stay for the bench and the sim.

Run: python3 run_tests.py mc_haze_hidden
"""
from brx_mcp.mc import pieces
from brx_mcp.mc.compile import WeaponCatalog

CAT = WeaponCatalog()


def test_f577_the_haze_row_is_hidden_and_says_why():
    row = CAT._row("smoke_gun")
    assert row.get("hidden") is True, "the Haze is still selectable"
    assert "F577" in row.get("notes", ""), "the row does not record why it is hidden"


def test_f577_the_haze_leaves_the_visible_catalogue_and_what_a_preset_may_name():
    assert "smoke_gun" not in {w["weapon_id"] for w in CAT.all()}
    weapon_ids, _perks = pieces._pickable_ids()
    assert "smoke_gun" not in weapon_ids, "a preset may still name the Haze"


def test_f577_the_support_type_token_no_longer_expands_to_the_haze():
    out = pieces._expand_type_tokens(["support"])
    assert isinstance(out, list) and "smoke_gun" not in out, out


def test_f577_the_row_and_frame_stay_for_the_bench_and_the_sim():
    # CONTROL: hidden is not deleted, the same as glock (test_mc_sidearms)
    assert CAT._row("smoke_gun")["name"] == "Haze"
    assert CAT.resolve("smoke_gun", 2)
