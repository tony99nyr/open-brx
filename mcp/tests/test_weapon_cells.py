"""F315 (MC half): each weapon's `$HIR` cell on the roster and the catalogue, and the bench-gated
`--distinct-weapon-cells` flag that moves a same-cell, same-magnitude weapon onto a free cell.

A victim's phone names what hit it by matching the `$HIR` word against the shooter's weapons. The S56
roster carried magnitudes only, so the Assault Rifle and the Energy Rifle (both <0,0>, both 9) read as
"A / B". `cells` carries the (proto, subtype) each magnitude rides, read from the COMPILED frame; the
flag moves the later weapon of such a pair to <0,2> with a plain-damage row of the same function.
"""
import contextlib

from brx_mcp import hitaudio as _ha
from brx_mcp.mc import compile as _compile
from brx_mcp.mc.compile import Compiler, cells_from_weap, hir_from_weap
from brx_mcp.mc.views import weapon_views
from _session import match_config

from test_mc_loadout import mk, online


@contextlib.contextmanager
def _patched(obj, name, value):
    """A stdlib stand-in for `monkeypatch.setattr` (`run_tests.py` runs under system python, no pytest)."""
    old = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, old)

_TEAMS = [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
          {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 3}]
_ER_ROW = "$SIR,0,2,,1,0,0,1,,*"      # the (0,0) row's function and tail, on the moved cell

OFF = Compiler()
ON = Compiler(distinct_weapon_cells=True)


def _player(num, weapons, team="blue", perk=None):
    lo = {"weapons": [{"weapon_id": w} for w in weapons]}
    if perk:
        lo["perk"] = perk
    return {"player_id": f"p{num}", "player_num": num, "display": f"P{num}", "team_id": team,
            "node_id": None, "gun_id": None, "voice": "male", "ready": True, "loadout": lo}


def _roster(*loadouts):
    return [_player(i + 1, w) for i, w in enumerate(loadouts)]


def _weap(bundle, slot):
    return next(f for f in bundle["head"] if f.startswith(f"$WEAP,{slot},"))


def _cell(frame):
    t = frame.split(",")
    return (t[4], t[5])


def _compile_all(c, roster, cfg=None):
    cfg = cfg or match_config("tdm", teams=_TEAMS)
    plan = c.hit_plan(roster)
    return plan, [c.compile(cfg, p, _TEAMS, plan=plan) for p in roster]


# ---- the contract shape ------------------------------------------------------
def test_cells_from_weap_is_hir_from_weap_with_the_frames_own_cell():
    for w in OFF.catalog.all():
        frame = w["weap_frame"]
        cells = cells_from_weap(frame)
        assert [c["mag"] for c in cells] == hir_from_weap(frame), w["weapon_id"]
        proto, sub = _cell(frame)
        assert all(c == {"proto": int(proto or 0), "subtype": int(sub or 0), "mag": c["mag"]} for c in cells)


def test_catalogue_views_carry_cells():
    views = {v["weapon_id"]: v for v in weapon_views(OFF.weapon_catalog())}
    assert views["assault_rifle"]["cells"] == [{"proto": 0, "subtype": 0, "mag": 9}]
    assert views["charge_rifle"]["cells"] == [{"proto": 8, "subtype": 0, "mag": m}
                                              for m in OFF.catalog.hir_magnitudes("charge_rifle")]


# ---- collision detection -----------------------------------------------------
def test_only_the_same_cell_same_magnitude_pair_is_moved():
    """The USP-S (<0,3>, 9) and the Suppressor (<0,0>, 8) share a magnitude or a cell with the AR, never both."""
    plan = ON.hit_plan(_roster(["assault_rifle", "usp"], ["suppressor", "shotgun"]))
    assert all(c == OFF._weapon_cell(w) for w, c in plan.cells.items()), plan.cells
    plan = ON.hit_plan(_roster(["assault_rifle"], ["energy_rifle"]))
    assert plan.cells["assault_rifle"] == ("0", "0")
    assert plan.cells["energy_rifle"] == ("0", "2")


def test_the_catalogue_order_decides_who_moves_not_the_roster_order():
    plan = ON.hit_plan(_roster(["energy_rifle"], ["assault_rifle"]))
    assert plan.cells["energy_rifle"] == ("0", "2") and plan.cells["assault_rifle"] == ("0", "0")


# ---- the assignment ----------------------------------------------------------
def test_the_energy_rifle_compiles_on_0_2_and_every_table_gains_the_row():
    roster = _roster(["assault_rifle", "usp"], ["energy_rifle"])
    plan, bundles = _compile_all(ON, roster)
    er = _weap(bundles[1], 0)
    assert _cell(er) == ("0", "2")
    assert _cell(_weap(bundles[0], 0)) == ("0", "0")
    # the move is the cell alone: every other token of the frame is the unmoved compile's
    _p, off = _compile_all(OFF, roster)
    off_er = _weap(off[1], 0).split(",")
    off_er[4:6] = ["0", "2"]
    assert er == ",".join(off_er)
    for b in bundles:
        for take in b["sir_pool"]:
            assert _ER_ROW in take
        assert _compile.sir_spawn_protected([_ER_ROW])[0] in b["head"]   # the head's disarmed twin
        assert b["hit_audio"]["cells"]["energy_rifle"] == "0,2"


def test_the_move_composes_with_class_sounds_and_stun():
    cfg = match_config("tdm", teams=_TEAMS, hit_audio_class=True, stun={})
    roster = _roster(["assault_rifle"], ["energy_rifle"])
    _plan, bundles = _compile_all(ON, roster, cfg)
    for b in bundles:
        for take in b["sir_pool"]:
            assert ("0", "2") in _compile._sir_index(take)
            assert _compile._sir_index(take)[("0", "2")] == 1


def test_armour_piercing_still_wins_the_primary_cell():
    roster = [_player(1, ["assault_rifle"]), _player(2, ["energy_rifle"], perk="armor_piercing")]
    cfg = match_config("tdm", teams=_TEAMS)
    plan = ON.hit_plan(roster)
    b = ON.compile(cfg, roster[1], _TEAMS, plan=plan)
    assert _cell(_weap(b, 0)) == _compile._AP_CELL


def test_validate_names_the_move_and_the_row_budget():
    roster = _roster(["assault_rifle"], ["energy_rifle"])
    cfg = match_config("tdm", teams=_TEAMS)
    warns = ON.validate(cfg, roster)["warnings"]
    assert any("moved energy_rifle to <0,2>" in w for w in warns), warns
    assert not any("MAX_SIR_ROWS" in w for w in warns)
    # a tighter ceiling makes the same table over budget, and validate says so
    with _patched(_ha, "MAX_SIR_ROWS", 5):
        warns = ON.validate(cfg, roster)["warnings"]
    assert any("MAX_SIR_ROWS" in w for w in warns), warns


def test_hit_audio_rekey_skips_the_flag_and_says_so():
    roster = _roster(["assault_rifle"], ["energy_rifle"])
    cfg = match_config("tdm", teams=_TEAMS, hit_audio_rekey=True)
    assert ON.hit_plan(roster, rekey=True).cells == OFF.hit_plan(roster, rekey=True).cells
    warns = ON.validate(cfg, roster)["warnings"]
    assert any("--distinct-weapon-cells is SKIPPED" in w for w in warns), warns


# ---- flag off changes nothing ------------------------------------------------
def test_flag_off_is_byte_identical():
    """Off, the colliding pair compiles exactly as it did before F315: both on <0,0>, no <0,2> row anywhere."""
    roster = _roster(["assault_rifle", "usp"], ["energy_rifle"])
    cfg = match_config("tdm", teams=_TEAMS)
    plan, bundles = _compile_all(OFF, roster, cfg)
    assert plan.cells["energy_rifle"] == ("0", "0")
    for b in bundles:
        assert all(_cell(f) != ("0", "2") for f in b["head"] if f.startswith("$WEAP,"))
        assert not any(f.startswith("$SIR,0,2,") for f in b["head"] + [r for t in b["sir_pool"] for r in t])
    warns = OFF.validate(cfg, roster)["warnings"]
    assert not any("F315" in w for w in warns), warns


def test_flag_on_with_no_collision_is_byte_identical_to_off():
    roster = _roster(["smg", "deagle"], ["shotgun", "usp"])
    _p, a = _compile_all(OFF, roster)
    _p, b = _compile_all(ON, roster)
    for x, y in zip(a, b):
        assert x["head"] == y["head"] and x["sir_pool"] == y["sir_pool"]


# ---- guards ------------------------------------------------------------------
def test_no_reserved_cell_is_ever_a_candidate_or_a_destination():
    assert _compile.DISTINCT_CELL_CANDIDATES == (("0", "2"),)
    assert not set(_compile.DISTINCT_CELL_CANDIDATES) & _ha.RESERVED_CELLS
    every = [w["weapon_id"] for w in OFF.catalog.all()]
    plan = ON.hit_plan(_roster(*[[w] for w in every]))
    moved = {w: c for w, c in plan.cells.items() if c != OFF._weapon_cell(w)}
    assert moved and not set(moved.values()) & _ha.RESERVED_CELLS, moved


def test_no_free_cell_left_means_no_move():
    roster = _roster(["assault_rifle"], ["energy_rifle"])
    with _patched(_compile, "DISTINCT_CELL_CANDIDATES", ()):
        plan = ON.hit_plan(roster)
        warns = ON.validate(match_config("tdm", teams=_TEAMS), roster)["warnings"]
    assert plan.cells["energy_rifle"] == ("0", "0")
    assert any("share IR cell <0,0>" in w and "A / B" in w for w in warns), warns


def test_a_cell_another_weapon_keys_is_not_free():
    """Three same-magnitude weapons on <0,0>: the first in catalogue order stays, the second (the shotgun,
    which the catalogue lists before the Energy Rifle) takes <0,2>, and the third finds it taken and stays put."""
    c = Compiler(distinct_weapon_cells=True)
    real = c.catalog.hir_magnitudes
    with _patched(c.catalog, "hir_magnitudes", lambda w: [9] if w == "shotgun" else real(w)):
        plan = c.hit_plan(_roster(["assault_rifle"], ["energy_rifle"], ["shotgun"]))
    assert plan.cells["assault_rifle"] == ("0", "0")
    assert plan.cells["shotgun"] == ("0", "2")
    assert plan.cells["energy_rifle"] == ("0", "0")


# ---- the roster reads the compiled frame -------------------------------------
def _ps_with(s, weapons_by_player):
    for p, ws in zip(s.players.values(), weapons_by_player):
        p["loadout"] = {"weapons": [{"weapon_id": w} for w in ws]}


def test_roster_cells_come_from_the_compiled_frame():
    s, net, clock, ps = mk(2, compiler=Compiler(distinct_weapon_cells=True))
    online(s, net, clock, ps[0], 0)
    online(s, net, clock, ps[1], 1)
    _ps_with(s, [["assault_rifle"], ["energy_rifle"]])
    s.push_config()
    er = next(r for r in s.roster() if r["player_id"] == ps[1]["player_id"])["weapons"][0]
    assert er["cells"] == [{"proto": 0, "subtype": 2, "mag": 9}]
    # and it is the frame the gun holds, not a second derivation
    frame = next(f for f in s.bundles[ps[1]["player_id"]]["head"] if f.startswith("$WEAP,0,"))
    assert er["cells"] == cells_from_weap(frame) and er["hir"] == hir_from_weap(frame)
    ar = next(r for r in s.roster() if r["player_id"] == ps[0]["player_id"])["weapons"][0]
    assert ar["cells"] == [{"proto": 0, "subtype": 0, "mag": 9}]


def test_roster_cells_without_a_bundle_follow_the_pinned_plan():
    s, net, clock, ps = mk(2, compiler=Compiler(distinct_weapon_cells=True))
    online(s, net, clock, ps[0], 0)
    online(s, net, clock, ps[1], 1)
    _ps_with(s, [["assault_rifle"], ["energy_rifle"]])
    s.push_config()
    s.bundles.pop(ps[1]["player_id"])
    er = next(r for r in s.roster() if r["player_id"] == ps[1]["player_id"])["weapons"][0]
    assert er["cells"] == [{"proto": 0, "subtype": 2, "mag": 9}]


def test_the_cli_flag_is_off_by_default():
    from brx_mcp.mc.__main__ import parser
    assert parser().parse_args([]).distinct_weapon_cells is False
    assert parser().parse_args(["--distinct-weapon-cells"]).distinct_weapon_cells is True
