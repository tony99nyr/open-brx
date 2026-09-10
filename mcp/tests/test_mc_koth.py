"""King of the Hill from MISSION CONTROL — the operator-facing half of F70/F82/F88.

The engine side (hillbeacon → DominationEngine → the phone's callouts) is covered by
`test_hillbeacon.py`. What is asserted here is that an operator can actually SELECT and RUN the
mode from MC: a koth config validates, compiles, and pushes; the objective source is a real closed
vocabulary rather than any non-empty string; a hill roster on the neutral team is refused before the
match starts; and the one physical setup step nothing in software can do (power-cycle the grenade so
the hill starts NEUTRAL) reaches the operator.

Run: python3 run_tests.py mc_koth
"""
from brx_mcp.mc.compile import STATION_SOURCES, Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import MODES, Session, default_config

C = Compiler()


def _sess(mode="koth", n=2, **cfg):
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()))
    s.set_config({"mode": mode, "time_limit_s": 600, **cfg})
    for i in range(n):
        s.add_player(f"OP{i}", gun_id=f"GUN-{chr(65 + i)}")
    return s


def _roster(session):
    return list(session.players.values())


# --------------------------------------------------------------------------- #
# 1. the mode RUNS: selectable, valid, and the compiled head can hear a hill  #
# --------------------------------------------------------------------------- #
def test_a_koth_game_compiles_and_its_head_can_hear_the_hill():
    """The whole point of the mode row: pick koth in MC and every gun goes out able to REPORT the
    grenade's beacon. `$SIR,15,0,,28,...` is the row that does it (fn 28 = registers with zero player
    feedback, F73) — without it the firmware discards the beacon in silence and the node never sees
    the point at all (F60/F70/F72)."""
    s = _sess("koth")
    assert s.config["mode"] == "koth"
    res = s._validate()
    assert res["ok"], res["errors"]
    # `force` waves the readiness board (no phones in a unit test); it does NOT wave a config error --
    # `push_config` validates after the readiness gate and raises on any red, which is what the F82 test
    # below leans on.
    s.push_config(force=True)
    for p in _roster(s):
        head = s.bundles[p["player_id"]]["head"]
        assert "$SIR,15,0,,28,0,0,1,,*" in head, f"koth head cannot hear a hill beacon: {head}"
    # CONTROL: the same session on TDM ships no protocol-15 row, so this is the mode driving it and
    # not a row every head happens to carry.
    s.set_config({"mode": "tdm"})
    s.push_config(force=True)
    for p in _roster(s):
        assert not any(f.startswith("$SIR,15,0,") for f in s.bundles[p["player_id"]]["head"])


def test_the_koth_defaults_never_put_anyone_on_the_neutral_team():
    """🔴 F82: a NEUTRAL hill broadcasts team 2. A player rostered there reads every uncaptured point
    as their own — deaf to it under an enemy-only row, and untouchable by the hill's damage word — so
    the mode's default teams must not contain tid 2."""
    s = _sess("koth")
    tids = {t["tid"] for t in s.config["teams"]}
    assert 2 not in tids, tids
    assert tids == {1, 3}, tids                      # blue + green, the pair `assign_teams` also defaults to
    for p in _roster(s):
        assert p["team_id"] in {t["team_id"] for t in s.config["teams"]}
    # CONTROL: tid 2 is an ordinary team in a mode with no hill, and TDM still uses it.
    assert 2 in {t["tid"] for t in default_config("tdm")["teams"]}


def test_a_hill_roster_on_the_neutral_team_is_refused_at_the_push():
    """The operator can drag players onto any team, so the guard has to hold at validate/push time
    and not only in the mode defaults."""
    s = _sess("koth")
    s.set_config({"teams": [{"team_id": "blue", "name": "BLUE TEAM", "color": "#3a86ff", "tid": 1},
                            {"team_id": "yellow", "name": "YELLOW TEAM", "color": "#ffd23f", "tid": 2}]})
    for p in _roster(s):
        s.patch_player(p["player_id"], team_id="yellow")
    res = s._validate()
    assert not res["ok"] and any("F82" in e for e in res["errors"]), res["errors"]
    try:
        s.push_config(force=True)          # even the operator override must not get past this
        raise AssertionError("F82: MC pushed a koth game with a roster on tid 2")
    except ValueError as e:
        assert "F82" in str(e), e
    # CONTROL: move the same players to tid 3 and the identical game pushes clean, so the refusal is
    # reading the TID and not simply objecting to every hill roster.
    s.set_config({"teams": [{"team_id": "blue", "name": "BLUE TEAM", "color": "#3a86ff", "tid": 1},
                            {"team_id": "green", "name": "GREEN TEAM", "color": "#2ecc71", "tid": 3}]})
    for p in _roster(s):
        s.patch_player(p["player_id"], team_id="green")
    assert s._validate()["ok"], s.config_errors
    s.push_config(force=True)


# --------------------------------------------------------------------------- #
# 2. station_source: a real vocabulary, not a truthiness gate                  #
# --------------------------------------------------------------------------- #
def test_a_koth_config_carries_a_station_source_the_operator_can_see():
    cfg = default_config("koth")
    assert cfg["station_source"] == "grenade", cfg.get("station_source")
    # A mode with no objective emitter must not grow the key at all: a saved game's identity is its
    # whole config, so a null nobody set would have re-keyed every stored game.
    assert "station_source" not in default_config("tdm")


def test_a_station_gated_mode_with_no_source_is_refused_and_the_error_names_the_valid_values():
    """The gate used to be `not opts.get("station_source")` with nothing anywhere defining a legal
    value, so the operator got an error they could not satisfy from the UI."""
    cfg = dict(default_config("koth"))
    cfg.pop("station_source")
    res = C.validate(cfg, [], {})
    bad = [e for e in res["errors"] if "station_source" in e]
    assert bad, res["errors"]
    assert all(v in bad[0] for v in STATION_SOURCES), bad[0]
    assert "grenade" in bad[0]


def test_a_typo_in_station_source_is_caught_rather_than_satisfying_the_gate():
    """A truthiness gate accepts "grendae" and ships a hill mode with nothing emitting anything."""
    cfg = dict(default_config("koth"), station_source="grendae")
    res = C.validate(cfg, [], {})
    bad = [e for e in res["errors"] if "grendae" in e]
    assert bad, res["errors"]
    assert all(v in bad[0] for v in STATION_SOURCES), bad[0]
    # CONTROL: every value in the vocabulary passes the same check, so this is not a gate that
    # refuses everything.
    for good in STATION_SOURCES:
        ok = C.validate(dict(cfg, station_source=good), [], {})
        assert not any("station_source" in e for e in ok["errors"]), (good, ok["errors"])


def test_the_config_put_refuses_an_unknown_station_source():
    """MC's own PUT path: a bad value is a 400 with the vocabulary in it, not a config that reaches
    the compiler and fails there."""
    s = _sess("koth")
    try:
        s.set_config({"station_source": "utility_box"})
        raise AssertionError("MC accepted an unknown station_source")
    except ValueError as e:
        assert all(v in str(e) for v in STATION_SOURCES), e
    assert s.config["station_source"] == "grenade", "the refused PUT must not have touched the config"
    # CONTROL: a value IN the vocabulary applies.
    s.set_config({"station_source": "ir_station"})
    assert s.config["station_source"] == "ir_station"


def test_clearing_the_source_leaves_a_koth_game_unpushable_with_a_useful_error():
    s = _sess("koth")
    s.set_config({"station_source": None})
    assert "station_source" not in s.config
    try:
        s.push_config(force=True)
        raise AssertionError("MC pushed a koth game with no objective source")
    except ValueError as e:
        assert "station_source" in str(e) and "grenade" in str(e), e


# --------------------------------------------------------------------------- #
# 3. the physical setup step, and F88's one-point limit                        #
# --------------------------------------------------------------------------- #
def test_a_grenade_objective_tells_the_operator_to_power_cycle_it_first():
    """Nothing in software can make a hill start neutral. A grenade that comes to the field still
    holding its last owner banks possession for that team from t=0 and the match is skewed with no
    sign of why (bench 2026-09-10: a power-cycled grenade read team 2 = NEUTRAL; one that had been
    claimed in a native game still read its old owner)."""
    s = _sess("koth")
    setup = [w for w in s.config_warnings if w.startswith("SETUP:")]
    assert len(setup) == 1, s.config_warnings
    w = setup[0].upper()
    for phrase in ("POWER-CYCLE", "NEUTRAL", "HILL MODE", "PLACE IT"):
        assert phrase in w, (phrase, w)
    assert "F88" in setup[0], setup[0]         # the one-point limit is visible in the same breath
    # CONTROL: a mode with no grenade on the field says nothing about power-cycling one.
    s.set_config({"mode": "tdm"})
    assert not [x for x in s.config_warnings if x.startswith("SETUP:")], s.config_warnings


def test_multiple_control_points_on_a_grenade_source_are_refused():
    """F88: a beacon carries no station id, so two grenades in range are indistinguishable and would
    fight over the same point. MC cannot configure points today, so this is the guard for a config
    that reaches the compiler another way (a hand-built preset, the sim, a future designer field)."""
    cfg = dict(default_config("koth"), control_points=3)
    res = C.validate(cfg, [], {})
    assert any("F88" in e for e in res["errors"]), res["errors"]
    # CONTROLS: one point is fine, and a source that NAMES its point is not limited this way.
    assert not any("F88" in e for e in C.validate(dict(cfg, control_points=1), [], {})["errors"])
    assert not any("F88" in e for e in C.validate(dict(cfg, station_source="ir_station"), [], {})["errors"])


# --------------------------------------------------------------------------- #
# 4. what the UI is handed                                                     #
# --------------------------------------------------------------------------- #
def test_the_mode_row_is_shaped_like_every_other_one_and_wins_by_possession():
    """`GET /api/modes` renders these fields directly; a missing key is a blank card. `win_by` must be
    a value the UI already understands — "objective" is extraction's, and `scoring.py` reports it as
    `undecided` (Recap.tsx: "UNDECIDED — OBJECTIVE · HOST DECIDES") rather than inventing a winner
    from kills."""
    row = next(m for m in MODES if m["mode"] == "koth")
    ref = next(m for m in MODES if m["mode"] == "tdm")
    assert set(row) - {"station_source"} == set(ref), set(row) ^ set(ref)
    assert row["win_by"] == "objective" and row["frag_limit"] is None
    assert row["respawn"]["type"] == "auto" and row["respawn"]["delay_s"] >= 3      # bodies come back (F13: never 1-2 s)
    assert "POSSESSION" in row["win_text"].upper()
    # The rail's rows come off this row and the config, so both have to exist for koth.
    s = _sess("koth")
    view = next(m for m in s.modes() if m["mode"] == "koth")
    assert view["defaults"]["station_source"] == "grenade"
    assert view["defaults"]["presentation"]["preset"] == "standard"


def test_the_recap_of_a_possession_game_is_undecided_rather_than_won_on_kills():
    """MC has no objective scorer (utility-roadmap §8), and a hill mode's winner is possession time.
    Reporting the kill leader as the WINNER would be a wrong answer stated confidently."""
    from brx_mcp.mc.scoring import Scorer
    s = _sess("koth")
    sc = Scorer("m", 1000, 600, "koth", s.players, s.teams, {}, {}, now_ms=lambda: 2000,
                win_by=s.config["scoring"]["win_by"])
    assert sc.winner() == {"team_id": None, "undecided": "objective"}, sc.winner()
