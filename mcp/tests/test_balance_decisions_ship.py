"""What ships is what Tony decided (docs/balance-decisions.md), read off the COMPILED frames (desk review 2026-11-06).

The catalogue tests read weapons.json; these read the `$WEAP` lines `Compiler.compile()` puts in a real head, for every
weapon in the primary slot, every venue, day and night, the standard and silenced presentations and the ammunition
perks, plus the pickup slots and the try-out. A number that is right in weapons.json but lost on one compile path
(a perk's rekey, the silent-weapon tokens, night scaling, an override) fails here.

Decisions checked, each with its section in docs/balance-decisions.md:
- F646 option A (2026-11-02): Charge Rifle charge 60, tap 16; heat.per_tap 2 is the sim's model of the gun, not a token.
- F649 (2026-11-02): melee 60 damage and 3000 ms between swings, on the slot-4 `$WEAP` (t5, t14).
- AMR crit 30 to 20 (2026-11-02): t6 20.
- Night range cut, option (a) (2026-11-02): t2, t13 and t42 at 0.75 of the day value, floor 13; nothing else moves.
- F661 (2026-11-02): the Energy Shotgun is hidden, and its frame carries t38 1 and t24 13.
- F662 R2: recovery is approved in principle but ships on no row; F663 reset_on_release ships on no row either.
- The recoil ladder: the selectable rows that degrade are exactly AR, Suppressor, Energy Rifle and Toxin Rifle.
Run: python3 run_tests.py balance_decisions_ship
"""
from __future__ import annotations

import itertools
import json
import pathlib
import sys

from _session import TEAMS, match_config
from brx_mcp.mc import compile as compile_mod
from brx_mcp.mc.compile import Compiler, WeaponCatalog

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mcp" / "tools"))
import balance_sim as B  # noqa: E402

C = Compiler()
T = WeaponCatalog._T
ROWS = {r["weapon_id"]: r for r in json.loads((ROOT / "mcp/brx_mcp/mc/weapons.json").read_text())["weapons"]}
# Tony 2026-11-02: night changes the outdoor range and both headset ranges, written out here rather than read from the
# compiler, so a key dropped from NIGHT_RANGE_KEYS turns this red (Codex review 2026-11-07).
NIGHT_CELLS = {T[k] + 1 for k in ("range_outdoor", "headset_range_outdoor", "headset_range_indoor")}
PICKUPS = [{"weapon_id": "energy_shotgun", "slot": 2}, {"weapon_id": "charge_rifle", "slot": 3}]


def _tok(frame: list[str], key: str) -> str:
    i = T[key] + 1
    return frame[i] if i < len(frame) else ""


def _weaps(primary: str, *, env, night: bool, pres: str = "standard", perk: str | None = None,
           mode: str = "tdm") -> dict[str, list[str]]:
    lo: dict = {"weapons": [{"weapon_id": primary}, {"weapon_id": "glock"}]}
    if perk:
        lo["perk"] = perk
    player = {"player_id": "p1", "player_num": 7, "display": "A", "team_id": "blue", "node_id": None, "gun_id": None,
              "voice": "male", "ready": True, "loadout": lo}
    cfg = match_config(mode, teams=TEAMS, environment=env, night=night, presentation={"preset": pres}, powerups=PICKUPS)
    head = C.compile(cfg, player, TEAMS)["head"]
    return {f.split(",")[1]: f.split(",") for f in head if f.startswith("$WEAP,")}


def _check_decisions(w: dict[str, list[str]], primary: str, ctx) -> None:
    by_slot = {"0": primary, "1": "glock", "2": "energy_shotgun", "3": "charge_rifle", "4": "melee"}
    assert set(w) == set(by_slot), (ctx, sorted(w))
    for slot, wid in by_slot.items():
        f = w[slot]
        if wid == "charge_rifle":
            assert (_tok(f, "dmg"), _tok(f, "tap")) == ("60", "16"), (ctx, slot, "F646 charge 60, tap 16")
        if wid == "melee":
            assert (_tok(f, "dmg"), _tok(f, "fire")) == ("60", "3000"), (ctx, "F649 melee 60 at 3000 ms")
        if wid == "amr":
            assert _tok(f, "crit") == "20", (ctx, "AMR crit 20")
        if wid == "energy_shotgun":
            assert (f[39], f[25]) == ("1", "13"), (ctx, slot, "F661 t38 1, t24 13")


def test_every_compiled_head_carries_the_decided_numbers():
    """Every weapon as the primary, beside the two pickup slots and melee: 3 venues x day/night x 2 presentations x
    the ammunition perks. Armour Piercing is left out: it owns the whole pull by design (S50) and refuses most rows."""
    n = 0
    for wid, env, night, pres, perk in itertools.product(ROWS, ("outdoor", "indoor", None), (False, True),
                                                         ("standard", "silenced"), (None, "extended_mags", "fast_hands")):
        _check_decisions(_weaps(wid, env=env, night=night, pres=pres, perk=perk), wid, (wid, env, night, pres, perk))
        n += 1
    assert n == len(ROWS) * 36


def test_the_objective_modes_carry_the_same_numbers():
    for mode in ("ffa", "koth", "domination"):
        for night in (False, True):
            _check_decisions(_weaps("charge_rifle", env="outdoor", night=night, mode=mode), "charge_rifle", (mode, night))


def test_night_moves_only_the_three_range_cells_of_every_weapon_and_every_slot():
    """For every primary, venue and presentation: the night head equals the day head except t2, t13 and t42, and each of
    those is night_range() of its day value. An empty cell stays empty."""
    for wid, env, pres in itertools.product(ROWS, ("outdoor", "indoor", None), ("standard", "silenced")):
        day = _weaps(wid, env=env, night=False, pres=pres)
        night = _weaps(wid, env=env, night=True, pres=pres)
        for slot, d in day.items():
            n = night[slot]
            assert len(d) == len(n), (wid, env, slot)
            for i, (a, b) in enumerate(zip(d, n)):
                if i in NIGHT_CELLS and a.strip() not in ("", "*"):
                    assert b == str(compile_mod.night_range(int(a))), (wid, env, pres, slot, i, a, b)
                else:
                    assert a == b, (wid, env, pres, slot, i, a, b)
    melee_day = _weaps("assault_rifle", env="outdoor", night=False)["4"]
    melee_night = _weaps("assault_rifle", env="outdoor", night=True)["4"]
    assert (_tok(melee_day, "range_outdoor"), _tok(melee_night, "range_outdoor")) == ("60", "45")


def test_the_try_out_carries_the_decided_numbers_day_and_night():
    """The pre-game try-out builds its `$WEAP` on its own path (`tutorial_frames`)."""
    cat = {w["weapon_id"]: w for w in C.weapon_catalog()}
    for night in (False, True):
        cfg = match_config("tdm", teams=TEAMS, environment="outdoor", night=night)
        cr = next(f.split(",") for f in C.tutorial_frames(cat["charge_rifle"], "outdoor", config=cfg)
                  if f.startswith("$WEAP,"))
        assert (_tok(cr, "dmg"), _tok(cr, "tap")) == ("60", "16")
        amr = next(f.split(",") for f in C.tutorial_frames(cat["amr"], "outdoor", config=cfg) if f.startswith("$WEAP,"))
        assert _tok(amr, "crit") == "20"
        day_t2 = int(_tok(next(f.split(",") for f in C.tutorial_frames(cat["amr"], "outdoor") if f.startswith("$WEAP,")),
                          "range_outdoor"))
        assert int(_tok(amr, "range_outdoor")) == (compile_mod.night_range(day_t2) if night else day_t2)


def test_the_energy_shotgun_is_hidden_and_the_charge_rifle_heat_model_is_the_bench_fit():
    assert ROWS["energy_shotgun"].get("hidden") is True
    assert "energy_shotgun" not in {w["weapon_id"] for w in C.weapon_catalog() if not w.get("hidden")}
    assert ROWS["charge_rifle"]["heat"]["per_tap"] == 2, "F646 option A: the bench heat fit"


def test_no_row_ships_hold_length_recovery_or_reset_on_release():
    for wid, row in ROWS.items():
        r = row.get("recoil") or {}
        assert "recovery" not in r, f"{wid}: F662 R2 ships on no row until Tony picks one"
        assert not r.get("reset_on_release"), f"{wid}: F663 ships on no row"
        prof = B.recoil_profile(row)
        assert prof is None or (prof.recovery is None and not prof.reset_on_release), wid


def test_the_selectable_recoil_ladder_is_the_four_automatics():
    ladder = {wid for wid, row in ROWS.items() if not row.get("hidden") and B.recoil_profile(row) is not None}
    assert ladder == {"assault_rifle", "suppressor", "energy_rifle", "toxin_rifle"}, sorted(ladder)
