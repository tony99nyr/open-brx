"""S16: the Toxin Rifle's damage-over-time table (compile) and the lethal-tick kill credit (scoring).

The victim's node runs the tick clock (`app/src/engine.js`, spec/node.md §3.17). MC's part is two things: ship the
SHOOTER's tick numbers to every victim, keyed by the IR protocol the victim reads off `$HIR`, and credit the kill a
lethal tick produces to the player who applied the poison.

No pytest import: `run_tests.py` runs this file under system python, which has no pytest.
"""
from copy import deepcopy
from brx_mcp.mc.compile import Compiler, default_compiler, golden_bundle
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.scoring import Scorer
from brx_mcp.mc.state import Session

from test_mc_scoring import T0, death, mk


def _player(pid, num, team, *weapons):
    return {"player_id": pid, "player_num": num, "display": pid.upper(), "team_id": team, "node_id": None,
            "gun_id": None, "voice": "male", "ready": True,
            "loadout": {"weapons": [{"weapon_id": w} for w in weapons]}}


_CONFIG = {"config_id": "tox", "mode": "tdm", "environment": "indoor", "night": False, "time_limit_s": 600,
           "respawn": {"type": "auto", "delay_s": 15}, "scoring": {"frag_limit": 0, "win_by": "kills"},
           "health": {"max_hp": 45, "max_armor": 70},
           "teams": [{"team_id": "blue", "name": "Blue", "color": "blue", "tid": 1},
                     {"team_id": "yellow", "name": "Yellow", "color": "yellow", "tid": 3}]}


def test_the_victim_gets_the_shooters_tick_numbers_keyed_by_protocol():
    """The victim carries an SMG and nothing else. Its bundle must still hold the Toxin Rifle's numbers, because
    the plan is the MATCH's, and the key is the protocol on the wire (t3 = 11), as a string."""
    c = default_compiler()
    shooter, victim = _player("tox", 1, "blue", "toxin_rifle"), _player("vic", 2, "yellow", "smg")
    plan = c.hit_plan([shooter, victim])
    b = c.compile(_CONFIG, victim, _CONFIG["teams"], plan=plan)
    assert b["dot"] == {"11": {"weapon_id": "toxin_rifle", "per_tick": 4, "tick_ms": 1000, "duration_ms": 5000}}
    # The shooter's own bundle carries the same table: every node gets the one game-wide copy.
    assert c.compile(_CONFIG, shooter, _CONFIG["teams"], plan=plan)["dot"] == b["dot"]


def test_the_toxin_rifle_is_in_the_picker_and_compiles():
    """The node half landed (spec/node.md §3.17), so the row is visible: it is in the picker, and a game that
    names it compiles with its cell and its table."""
    c = default_compiler()
    assert "toxin_rifle" in {w["weapon_id"] for w in c.catalog.all()}, "the row is no longer hidden"
    p = _player("tox", 1, "blue", "toxin_rifle")
    b = c.compile(_CONFIG, p, _CONFIG["teams"])
    assert any(f.startswith("$WEAP,0,") and f.split(",")[4] == "11" for f in b["head"]), "t3 = 11 on the wire"
    assert b["dot"]["11"]["per_tick"] == 4


def test_breacher_and_toxin_share_one_match_without_tripping_the_a17_guard():
    """Playtest 2026-09-20: this exact new-weapon pair was blamed when the A17 guard stopped the arm.
    Pin the whole contract: Breacher is the legal secondary, Toxin the primary, every victim receives
    both conditional SIR rows, and the poison table reaches both phones."""
    c = default_compiler()
    specialist = _player("specialist", 1, "blue", "toxin_rifle", "stripper")
    victim = _player("victim", 2, "yellow", "smg")
    roster = [specialist, victim]
    result = c.validate(_CONFIG, roster)
    assert result["ok"], result
    plan = c.hit_plan(roster)
    for player in roster:
        bundle = c.compile(_CONFIG, player, _CONFIG["teams"], plan=plan)
        live = bundle["sir_pool"][0]
        assert _sir(live, ("5", "0")) and _sir(live, ("11", "0")), live
        assert bundle["dot"]["11"]["weapon_id"] == "toxin_rifle"


def test_session_push_builds_breacher_and_toxin_plan_from_real_player_records():
    """The 2026-09-20 failure lived above Compiler: Session passed its public identity-only roster to
    hit_plan(), dropping every loadout. This real push pins the production seam that direct compilation
    cannot cover."""
    s = Session(default_compiler(), FakeNet(), FakeArmory(demo_armory()))
    cfg = deepcopy(_CONFIG)
    cfg["scoring"]["frag_limit"] = None
    s.set_config(cfg)
    s.add_player("SPECIALIST", "blue", "GUN-A",
                 loadout={"weapons": [{"weapon_id": "toxin_rifle"}, {"weapon_id": "stripper"}]})
    s.add_player("VICTIM", "yellow", "GUN-B", loadout={"weapons": [{"weapon_id": "smg"}]})
    result = s.push_config(force=True)
    assert result["ok"] and set(s._pinned_hit_plan.cells) >= {"toxin_rifle", "stripper"}
    for bundle in s.bundles.values():
        live = bundle["sir_pool"][0]
        assert _sir(live, ("5", "0")) and _sir(live, ("11", "0")), live
        assert bundle["dot"]["11"]["weapon_id"] == "toxin_rifle"


def test_node_driven_dot_weapon_cannot_omit_its_app_floor():
    base = default_compiler()
    c = Compiler(catalog=type(base.catalog)(deepcopy(base.catalog._rows)))
    c.catalog._by_id["toxin_rifle"].pop("min_app")
    p = _player("tox", 1, "blue", "toxin_rifle")
    try:
        c.compile(_CONFIG, p, _CONFIG["teams"])
        raise AssertionError("a victim-side effect without an app floor compiled")
    except ValueError as e:
        assert "min_app" in str(e) and "toxin_rifle" in str(e), e

    c = Compiler(catalog=type(base.catalog)(deepcopy(base.catalog._rows)))
    c.catalog._by_id["toxin_rifle"]["min_app"] = "next"
    try:
        c.compile(_CONFIG, p, _CONFIG["teams"])
        raise AssertionError("a malformed app floor compiled")
    except ValueError as e:
        assert "MAJOR.MINOR.PATCH" in str(e) and "toxin_rifle" in str(e), e


def _sir(rows, cell):
    return [r for r in rows if r.startswith(f"$SIR,{cell[0]},{cell[1]},")]


def test_the_poison_cell_ships_a_plain_damage_row_only_in_a_game_that_carries_it():
    """F11 class. The direct hit is `$SIR <11,0>` fn 1. A gun with no row for the cell drops every hit and
    reports healthy, so the row must reach every gun in a game with a Toxin Rifle in it, the victim's too.
    The row is the same as the plain `<0,0>` damage row except for its cell: an empty sound token (so the
    pool sound plays, F38) and the same tail. A game without the weapon does not spend a row on it
    (`hitaudio.MAX_SIR_ROWS`). The head carries the cell as the fn-28 pregame registrar (F121)."""
    c = default_compiler()
    shooter, victim = _player("tox", 1, "blue", "toxin_rifle"), _player("vic", 2, "yellow", "smg")
    plan = c.hit_plan([shooter, victim])
    b = c.compile(_CONFIG, victim, _CONFIG["teams"], plan=plan)
    plain = _sir(b["sir_pool"][0], ("0", "0"))[0]
    for take in b["sir_pool"]:
        assert _sir(take, ("11", "0")) == [plain.replace("$SIR,0,0,", "$SIR,11,0,", 1)], take
    assert _sir(b["head"], ("11", "0")) == ["$SIR,11,0,,28,0,0,1,,*"]
    assert c.validate(_CONFIG, [shooter, victim])["ok"]

    plain_game = [_player("a", 1, "blue", "assault_rifle"), _player("b", 2, "yellow", "smg")]
    b2 = c.compile(_CONFIG, plain_game[1], _CONFIG["teams"], plan=c.hit_plan(plain_game))
    assert not _sir(b2["sir_pool"][0], ("11", "0")) and not _sir(b2["head"], ("11", "0"))


def test_validate_refuses_the_toxin_rifle_when_nothing_ships_its_row():
    """The guard reads the table the roster ships. Take away the row's only source (the catalogue `sir_fn`)
    and `validate()` must say NO ROW, not wave the weapon through. Control: the unchanged catalogue passes."""
    base = default_compiler()
    rows = [dict(r) for r in base.catalog._rows]
    roster = [_player("tox", 1, "blue", "toxin_rifle")]
    assert Compiler(catalog=type(base.catalog)(rows)).validate(_CONFIG, roster)["ok"]
    next(r for r in rows if r["weapon_id"] == "toxin_rifle").pop("sir_fn")
    r = Compiler(catalog=type(base.catalog)(rows)).validate(_CONFIG, roster)
    assert not r["ok"] and any("toxin_rifle keys $SIR 11,0" in e and "NO ROW" in e for e in r["errors"]), r


def test_a_game_with_no_poison_weapon_ships_no_table():
    """Absent, not empty: an older node sees nothing new, and the golden bundle is unchanged in shape."""
    assert "dot" not in golden_bundle()
    c = default_compiler()
    p = _player("a", 1, "blue", "assault_rifle", "smg")
    assert "dot" not in c.compile(_CONFIG, p, _CONFIG["teams"])


def test_a_plain_weapon_sharing_the_poison_protocol_is_refused():
    """The victim keys the poison on the protocol alone. A second weapon on protocol 11 would poison with every
    hit, so the compile refuses rather than ship a table the node cannot read. Control: without the extra row
    the same plan compiles."""
    base = default_compiler()
    rows = [dict(r) for r in base.catalog._rows]
    c_ok = Compiler(catalog=type(base.catalog)(rows))
    assert c_ok.dot_table(c_ok.hit_plan([_player("t", 1, "blue", "toxin_rifle", "smg")]))["11"]
    clone = dict(next(r for r in rows if r["weapon_id"] == "toxin_rifle"))
    clone["weapon_id"] = "plain_eleven"
    clone.pop("dot")
    c = Compiler(catalog=type(base.catalog)(rows + [clone]))
    try:
        c.dot_table(c.hit_plan([_player("t", 1, "blue", "toxin_rifle", "plain_eleven")]))
    except ValueError as e:
        assert "S16" in str(e), e
    else:
        raise AssertionError("a plain weapon on the poison protocol compiled")


def test_a_lethal_tick_credits_the_player_who_applied_the_poison():
    """Tony 2026-09-18: kill credit goes to the applier. The node names the applier in `shooter_num` and flags
    the fact `dot: true`; the scorer must credit that player exactly as it credits a hit, first blood included.
    Control: the same death with shooter 0 (the pre-S16 unattributed lethal tick) credits nobody."""
    sc, fb, feed = mk()
    assert death(sc, "n1", "p1", 1, T0 + 1000, dot=True) == "scored"      # p0 (num 1) poisoned p1
    rows = {r["player_id"]: r for r in sc.rows()}
    assert rows["p0"]["kills"] == 1 and rows["p1"]["deaths"] == 1
    assert sc.first_blood == "p0" and fb and fb[0][0] == "p0" and fb[0][1]["kind"] == "kill"

    sc2, fb2, _ = mk()
    death(sc2, "n1", "p1", 0, T0 + 1000, dot=True)
    rows2 = {r["player_id"]: r for r in sc2.rows()}
    assert rows2["p0"]["kills"] == 0 and rows2["p1"]["deaths"] == 1 and not fb2


def test_a_lethal_tick_on_a_teammate_is_a_team_kill_like_any_other():
    """A friendly applier gets the same friendly-fire booking a friendly bullet would. Poison is not a way
    round the friendly rule. p2 (num 3) and p0 are both blue in the scorer fixture."""
    sc, _fb, feed = mk()
    death(sc, "n0", "p0", 3, T0 + 1000, dot=True)
    rows = {r["player_id"]: r for r in sc.rows()}
    assert rows["p2"]["kills"] == -1 and feed[-1]["tag"] == "TEAM KILL"


def test_scorer_import_is_the_real_one():
    assert Scorer.__name__ == "Scorer"
