"""The EMP perk (Tony 2026-10-24, in place of the Haze weapon): a phone-driven throw that jams enemy guns.

The holder's phone writes a host `$IRTX` on the free cell `<8,1>`; every gun in the match carries a fn-23 row on
that cell, so a victim's gun registers it with no pool moving and its phone runs the existing stun (F15/A20).
`<8,0>` stays the Charge Rifle's cell, untouched. Hidden until the bench rows in docs/bench-0426.md pass.
"""
from _session import TEAMS, match_config
from brx_mcp import hitaudio as _ha
from brx_mcp.mc.compile import Compiler, _sir_index
from brx_mcp.mc.perks import PerkCatalog, gain_cost_lines

C = Compiler()


def _cfg(**kw):
    return dict(match_config("tdm", frag=0, time_limit_s=600, teams=TEAMS), **kw)


def _player(num=7, team="blue", perk=None, weapons=("assault_rifle", "shotgun")):
    lo = {"weapons": [{"weapon_id": w} for w in weapons]}
    if perk:
        lo["perk"] = perk
    return {"player_id": f"p{num}", "player_num": num, "display": "REAPER", "team_id": team,
            "node_id": None, "gun_id": None, "voice": "male", "ready": True, "loadout": lo}


def _fn(rows, cell):
    return _sir_index([f for f in rows if f.startswith("$SIR,")]).get(cell)


def test_the_emp_row_is_hidden_unverified_and_carries_placeholder_numbers():
    cat = PerkCatalog()
    row = cat.row("emp")
    assert row["hidden"] is True and row["verified"] is False
    assert row["effects"] == {"cooldown_s": 45, "stun_duration_s": 6}, "placeholders; 6 s matches the gun's own fn-23 blind (SMOKE_MS)"
    assert "emp" not in cat.visible_ids(), "a hidden perk never reaches a picker"
    assert "concussion" in [r["perk_id"] for r in cat._rows], "concussion stays as it was"
    gain, cost = gain_cost_lines("emp", row["effects"])
    assert gain and cost, (gain, cost)


def test_no_holder_ships_no_emp_cell_and_leaves_the_charge_rifle_cell_alone():
    plan = C.hit_plan([_player(7), _player(8, "yellow")])
    b = C.compile(_cfg(), _player(7), TEAMS, plan=plan)
    assert _fn(b["sir_pool"][0], ("8", "1")) is None
    assert _fn(b["sir_pool"][0], ("8", "0")) == 1, "the Charge Rifle's plain damage"
    assert "emp" not in b


def test_one_holder_puts_the_emp_cell_on_every_gun_in_the_match():
    roster = [_player(7, perk="emp"), _player(8, "yellow")]
    plan = C.hit_plan(roster)
    for p in roster:
        b = C.compile(_cfg(), p, TEAMS, plan=plan)
        for take in b["sir_pool"]:
            assert _fn(take, ("8", "1")) == 23, take
            assert _fn(take, ("8", "0")) == 1, "the <8,0> cell is unchanged"
        assert _fn(b["head"], ("8", "1")) == 28, "the head's copy is disarmed like every other cell (F121)"
        assert b["emp"] == {"cooldown_s": 45, "duration_s": 6}, b.get("emp")


def test_the_emp_cell_stands_beside_config_stun():
    roster = [_player(7, perk="emp")]
    b = C.compile(_cfg(stun={"duration_s": 10}), roster[0], TEAMS, plan=C.hit_plan(roster))
    assert _fn(b["sir_pool"][0], ("8", "0")) == 23 and _fn(b["sir_pool"][0], ("8", "1")) == 23


def test_the_emp_cell_is_reserved_from_the_class_sound_allocator():
    assert ("8", "1") in _ha.RESERVED_CELLS


def test_a_sir_table_over_the_community_ceiling_warns_with_its_row_count():
    """brx3 Medium 1: the worst case today is an EMP holder, a Breacher and a Toxin Rifle: 15 live rows, one over
    `hitaudio.MAX_SIR_ROWS` (14, a community figure nobody has measured, F39). CONTROL: without the EMP it is 14."""
    over = [_player(7, perk="emp", weapons=("assault_rifle", "stripper")), _player(8, "yellow", weapons=("toxin_rifle", "usp"))]
    w = C.validate(_cfg(), over)["warnings"]
    hits = [x for x in w if "$SIR" in x and "15 rows" in x]
    assert hits, w
    under = [_player(7, weapons=("assault_rifle", "stripper")), _player(8, "yellow", weapons=("toxin_rifle", "usp"))]
    assert not [x for x in C.validate(_cfg(), under)["warnings"] if "rows, over the" in x]


def test_a_late_joiner_with_the_emp_in_a_match_pinned_without_it_gets_no_throw():
    """brx3 Medium 2: the guns in play hold the pinned plan's table, so a joiner's EMP would land on no gun. Its bundle
    carries no `emp` and no <8,1> row; the phone shows EMP OFF and logs why (app/test/emp.test.mjs)."""
    pinned = C.hit_plan([_player(8, "yellow")])
    b = C.compile(_cfg(), _player(7, perk="emp"), TEAMS, plan=pinned)
    assert "emp" not in b and _fn(b["sir_pool"][0], ("8", "1")) is None
