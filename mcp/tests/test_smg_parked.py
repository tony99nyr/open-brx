"""F638 (Tony 2026-11-01: "disable the smg for today, need to fix it"). The SMG row is `hidden` with a `hidden_why`
until its headset-backlog fix lands: no picker offers it, and a loadout that still holds it (a session saved
before the hide) is refit to a legal weapon on restore, as `snapshot_codec` does with `policy.apply`.
The balance board keeps it (`balance_review._off_the_board`), because the fix is judged against it.

Run: python3 run_tests.py smg_parked
"""
from brx_mcp.mc import policy as P
from brx_mcp.mc.compile import Compiler

C = Compiler()


def test_the_smg_is_parked_with_its_reason():
    row = C.catalog._by_id["smg"]
    assert row.get("hidden") is True and "F638" in row.get("hidden_why", ""), row.get("hidden_why")
    assert "smg" not in {w["weapon_id"] for w in C.weapon_catalog()}


def test_no_pool_offers_it_and_a_stored_smg_is_refit():
    W, PK = C.weapon_catalog(), C.perk_catalog()
    pol = P.preset_rules("open")
    lp = P.pool(pol, W, PK)
    assert "smg" not in lp["primary"] and "smg" not in lp["secondary_weapons"]
    out = P.apply(pol, lp, {"weapons": [{"weapon_id": "smg"}, {"weapon_id": "smg"}]}, W, PK)
    assert out["weapons"] == [{"weapon_id": "assault_rifle"}], out


def test_the_balance_board_keeps_it():
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "tools"))
    import balance_review as R
    assert "smg" in R.loadout_ids(C.catalog)
    assert "plasma_sniper" not in R.loadout_ids(C.catalog)        # a plain hidden row stays off the board
