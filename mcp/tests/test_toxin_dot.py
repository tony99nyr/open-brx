"""S16: the Toxin Rifle's damage-over-time table (compile) and the lethal-tick kill credit (scoring).

The victim's node runs the tick clock (`app/src/engine.js`, spec/node.md §3.17). MC's part is two things: ship the
SHOOTER's tick numbers to every victim, keyed by the IR protocol the victim reads off `$HIR`, and credit the kill a
lethal tick produces to the player who applied the poison.
"""
import pytest

from brx_mcp.mc.compile import Compiler, default_compiler, golden_bundle
from brx_mcp.mc.scoring import Scorer

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


def test_the_toxin_rifle_is_hidden_and_still_compiles():
    """The row ships hidden until the node half lands. A hidden weapon is out of the picker, not out of the
    catalogue, so a custom game that names it must compile, with its cell and its table."""
    c = default_compiler()
    assert "toxin_rifle" not in {w["weapon_id"] for w in c.catalog.all()}, "setup: the row is hidden"
    p = _player("tox", 1, "blue", "toxin_rifle")
    b = c.compile(_CONFIG, p, _CONFIG["teams"])
    assert any(f.startswith("$WEAP,0,") and f.split(",")[4] == "11" for f in b["head"]), "t3 = 11 on the wire"
    assert b["dot"]["11"]["per_tick"] == 4


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
    with pytest.raises(ValueError, match="S16"):
        c.dot_table(c.hit_plan([_player("t", 1, "blue", "toxin_rifle", "plain_eleven")]))


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
