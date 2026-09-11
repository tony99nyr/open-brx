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


def test_a_hill_config_cannot_even_HOLD_a_neutral_team():
    """🔴 The last open F82 route, found in the operator review 2026-09-10, and it was reachable.

    `validate()` scans the ROSTER, so a koth config carrying an EMPTY yellow (tid 2) team passed, the
    push succeeded, and the Lobby then renders every config team as a drop target. One drag ran
    `_after_player_change` -> `_resend`, which re-compiles and re-pushes BEFORE `_validate` — so
    `$TID,2` reached a real gun with nothing but an advisory error on a screen the operator had already
    left. The team must therefore not exist in the config at all.
    """
    s = _sess("koth")
    teams = [{"team_id": "blue", "name": "BLUE TEAM", "color": "#3a86ff", "tid": 1},
             {"team_id": "yellow", "name": "YELLOW TEAM", "color": "#ffd23f", "tid": 2}]
    try:
        s.set_config({"teams": teams})
        raise AssertionError("F82: PUT /api/config accepted a tid-2 team for a hill mode")
    except ValueError as e:
        assert "F82" in str(e) and "2" in str(e), e
    assert all(t["tid"] != 2 for t in s.config["teams"]), s.config["teams"]
    # CONTROL 1: the same shape of PUT is fine in a mode with no hill, where 2 is an ordinary team.
    s.set_config({"mode": "tdm"})
    s.set_config({"teams": teams})
    assert [t["tid"] for t in s.config["teams"]] == [1, 2]
    # CONTROL 2: and a hill mode still takes any other pair.
    s.set_config({"mode": "koth"})
    s.set_config({"teams": [teams[0], {"team_id": "green", "name": "GREEN TEAM", "color": "#2ecc71", "tid": 3}]})
    assert [t["tid"] for t in s.config["teams"]] == [1, 3]
    s.push_config(force=True)


def test_validate_names_an_empty_neutral_team_not_just_a_roster_on_one():
    """A config that arrives another way (a preset stored before the PUT refusal, the CLI, a fixture)
    must still be caught — and named BEFORE a body is dropped on it, which is the whole point."""
    cfg = default_config("koth")
    cfg["teams"] = list(cfg["teams"]) + [{"team_id": "yellow", "name": "Y", "color": "y", "tid": 2}]
    errs = C.validate(cfg, [], {})["errors"]
    assert any("F82" in e and "yellow" in e for e in errs), errs
    # CONTROL: the same config without that team validates clean, so the guard reads the team list.
    assert not any("F82" in e for e in C.validate(default_config("koth"), [], {})["errors"])


def test_compiling_a_hill_head_on_the_neutral_tid_raises():
    """The frame itself must be unbuildable, not merely warned about: `_resend` compiles and pushes
    without consulting `validate()`, so this is the only layer a post-push team change cannot slip
    past. Same shape as the F79 / A17 head guards."""
    teams = [{"team_id": "blue", "name": "B", "color": "b", "tid": 1},
             {"team_id": "yellow", "name": "Y", "color": "y", "tid": 2}]
    cfg = dict(default_config("koth"), teams=teams)
    player = {"player_id": "p1", "player_num": 1, "display": "REAPER", "team_id": "yellow",
              "node_id": None, "gun_id": None, "voice": "male", "ready": True,
              "loadout": {"weapons": [{"weapon_id": "assault_rifle"}]}}
    try:
        C.compile(cfg, player, teams)
        raise AssertionError("F82: compiled a koth head on $TID 2")
    except ValueError as e:
        assert "F82" in str(e) and "REAPER" in str(e), e
    # CONTROL 1: the same player on tid 1 compiles, and its head ends on $TID,1.
    ok = C.compile(cfg, dict(player, team_id="blue"), teams)
    assert ok["head"][-1] == "$TID,1,*"
    # CONTROL 2: tid 2 is still compilable in a mode with no hill — this guard is mode-scoped.
    tdm = C.compile(dict(cfg, mode="tdm"), player, teams)
    assert tdm["head"][-1] == "$TID,2,*"


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


def test_an_ir_station_objective_says_out_loud_that_we_have_never_had_one():
    """It was honest in exactly one place (the designer's picker hint) and silent everywhere that
    matters: the `SETUP:` line was gated on `src == "grenade"`, so a game saved on `ir_station` pushed
    clean with nothing said about a source we have never put on a bench (operator review 2026-09-10)."""
    s = _sess("koth")
    s.set_config({"station_source": "ir_station"})
    setup = [w for w in s.config_warnings if w.startswith("SETUP:")]
    assert len(setup) == 1, s.config_warnings
    w = setup[0].upper()
    assert "UNPROVEN" in w and "NEVER HAD ONE" in w, w
    assert "POWER-CYCLE THE GRENADE" not in w, w          # the grenade's step is not this source's step
    # CONTROL: switching back to the grenade brings the grenade's own step back, so the two are not
    # one string with a word swapped.
    s.set_config({"station_source": "grenade"})
    assert any("POWER-CYCLE THE GRENADE" in x.upper() for x in s.config_warnings), s.config_warnings
    assert not any("UNPROVEN" in x.upper() for x in s.config_warnings), s.config_warnings


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


# --------------------------------------------------------------------------- #
# 5. possession: MC counts the hill, and four teammates do not count it 4x     #
# --------------------------------------------------------------------------- #
def _scorer(session, time_limit_s=600, nodes=()):
    """A Scorer for the session's roster, with `nodes` bound node_id -> player_id."""
    from brx_mcp.mc.scoring import Scorer
    node_player = dict(nodes)
    return Scorer("m1", 1_000_000, time_limit_s, session.config["mode"], session.players, session.teams,
                  node_player, {n: True for n in node_player}, now_ms=lambda: 1_000_000,
                  win_by=session.config["scoring"]["win_by"])


def _poss(hold_ms, observed_ms=None, site="A"):
    ev = {"type": "possession", "match_id": "m1", "t": 1_100_000, "hold_ms": hold_ms}
    if observed_ms is not None:
        ev["observed_ms"] = observed_ms
    if site:
        ev["site"] = site
    return ev


def test_four_teammates_on_one_hill_do_not_score_it_four_times():
    """🔴 The rule the whole fact shape exists for. Every node in beacon range of the same point
    reports the same ownership, so SUMMING them would quadruple a four-player squad's possession and
    hand the match to whoever brought the most phones. Merged by MAX per (site, team)."""
    s = _sess("koth", n=4)
    pids = [p["player_id"] for p in _roster(s)]
    sc = _scorer(s, nodes=[(f"node{i}", pid) for i, pid in enumerate(pids)])
    blue = s.config["teams"][0]
    for i in range(4):                                   # all four saw the same 120 s of blue ownership
        assert sc.ingest(f"node{i}", _poss({str(blue["tid"]): 120_000}, observed_ms=300_000), 1_100_000) == "scored"
    poss = sc.possession()
    assert poss["by_team"][blue["team_id"]] == 120, poss
    assert poss["reports"] == 4, poss
    # CONTROL: a node that genuinely saw MORE raises the total — max is not "ignore everyone but the
    # first", which would pass the assertion above just as well.
    sc.ingest("node0", _poss({str(blue["tid"]): 200_000}, observed_ms=300_000), 1_100_000)
    assert sc.possession()["by_team"][blue["team_id"]] == 200


def test_a_resent_tally_is_idempotent_and_a_node_total_never_shrinks():
    s = _sess("koth")
    pid = _roster(s)[0]["player_id"]
    sc = _scorer(s, nodes=[("n1", pid)])
    tid = str(s.config["teams"][0]["tid"])
    for _ in range(3):                                   # the same cumulative report, three times
        sc.ingest("n1", _poss({tid: 60_000}, observed_ms=60_000), 1_100_000, seq=None)
    assert sc.possession()["by_team"][s.config["teams"][0]["team_id"]] == 60
    # a LOWER figure from the same node (an outbox replay of an older tally) must not walk it back
    sc.ingest("n1", _poss({tid: 10_000}), 1_100_000)
    assert sc.possession()["by_team"][s.config["teams"][0]["team_id"]] == 60


def test_a_hills_neutral_time_is_nobodys():
    """Team 2 is NEUTRAL on the wire (bench 2026-09-10), not a team. Crediting it to a colour would
    invent possession; dropping it silently would hide how long the point sat unowned."""
    s = _sess("koth")
    pid = _roster(s)[0]["player_id"]
    sc = _scorer(s, nodes=[("n1", pid)])
    blue, green = s.config["teams"][0], s.config["teams"][1]
    sc.ingest("n1", _poss({"2": 90_000, str(blue["tid"]): 30_000}, observed_ms=120_000), 1_100_000)
    poss = sc.possession()
    assert poss["neutral_s"] == 90 and poss["by_team"][blue["team_id"]] == 30, poss
    assert poss["by_team"][green["team_id"]] == 0, poss
    assert 2 not in {t["tid"] for t in s.config["teams"]}      # and no team could have claimed it anyway


def test_possession_arriving_after_the_whistle_still_counts_and_is_clamped():
    """A6.1 freezes KILLS after the whistle. The possession report the phone sends AT the whistle is a
    tally for the whole match, and dropping it would throw away the only possession data MC gets — so
    it is accepted late and CLAMPED to the match length instead."""
    s = _sess("koth")
    pid = _roster(s)[0]["player_id"]
    sc = _scorer(s, time_limit_s=300, nodes=[("n1", pid)])
    late = _poss({str(s.config["teams"][0]["tid"]): 9_999_000}, observed_ms=9_999_000)
    late["t"] = sc.end_t + 30_000                        # well past the end freeze
    assert sc.ingest("n1", late, sc.end_t + 30_000) == "scored"
    poss = sc.possession()
    assert poss["by_team"][s.config["teams"][0]["team_id"]] == 300, poss     # not 9999
    assert poss["observed_s"] == 300 and poss["of_s"] == 300, poss
    # CONTROL: an ordinary late KILL is still frozen out, so the exemption is possession-only.
    dead = {"type": "death", "match_id": "m1", "t": sc.end_t + 30_000, "shooter_num": 0, "shooter_team": 0,
            "player_id": pid}
    assert sc.ingest("n1", dead, sc.end_t + 30_000) == "post_end"


def test_the_winner_of_a_koth_match_is_the_team_that_held_the_hill():
    """The card promised POSSESSION TIME and the recap said UNDECIDED after ten minutes. With a tally
    on the record MC names the winner; with none it still refuses to guess from kills."""
    s = _sess("koth")
    pid = _roster(s)[0]["player_id"]
    blue, green = s.config["teams"][0], s.config["teams"][1]
    sc = _scorer(s, nodes=[("n1", pid)])
    # no reports yet: undecided, NOT the kill leader
    sc.stats[pid].kills = 12
    assert sc.winner() == {"team_id": None, "undecided": "objective"}, sc.winner()
    assert "possession" not in sc.recap()
    sc.ingest("n1", _poss({str(blue["tid"]): 200_000, str(green["tid"]): 100_000}, observed_ms=300_000), 1_100_000)
    assert sc.winner() == {"team_id": blue["team_id"]}, sc.winner()
    r = sc.recap()
    assert r["possession"]["by_team"] == {blue["team_id"]: 200, green["team_id"]: 100}, r["possession"]
    # a level pair is a TIE, not a coin toss on dict order
    sc.ingest("n1", _poss({str(green["tid"]): 200_000}), 1_100_000)
    assert sc.winner() == {"team_id": None, "tie": sorted([blue["team_id"], green["team_id"]])}, sc.winner()
    # CONTROL: a SURVIVAL mode has no tally and must stay undecided — this path is objective-only.
    s2 = _sess("infection")
    sc2 = _scorer(s2)
    assert sc2.winner() == {"team_id": None, "undecided": "survival"}, sc2.winner()


def test_a_possession_fact_is_accepted_by_the_envelope_validator():
    """⚠ `PERSISTED_EVENT_TYPES` is a WHITELIST and an unlisted type is REJECTED at the socket — so a
    fact the phone learns to send reaches nothing at all until it is registered (the F40/F60 shape:
    both ends report healthy). This is the test that says the wire is open."""
    from brx_mcp.mc.envelope import EnvelopeError, validate_event
    ev = {"type": "possession", "t": 1_700_000_000_000, "node_id": "n1", "player_id": "p1",
          "match_id": "m1", "hold_ms": {"1": 1000}}
    assert validate_event(dict(ev)) is not None
    # and the fact itself is required
    try:
        validate_event({k: v for k, v in ev.items() if k != "hold_ms"})
        raise AssertionError("a possession event with no hold_ms was accepted")
    except EnvelopeError as e:
        assert "hold_ms" in str(e), e


def test_a_garbage_possession_payload_is_ignored_rather_than_scored():
    s = _sess("koth")
    pid = _roster(s)[0]["player_id"]
    sc = _scorer(s, nodes=[("n1", pid)])
    assert sc.ingest("n1", _poss("not-a-dict"), 1_100_000) == "ignored"
    assert sc.ingest("n1", _poss({"blue": "lots"}), 1_100_000) == "ignored"
    assert sc.possession() is None, sc.possession()
    # CONTROL: a well-formed report on the same scorer does land, so "ignored" is about the payload.
    assert sc.ingest("n1", _poss({str(s.config["teams"][0]["tid"]): 5_000}), 1_100_000) == "scored"
    assert sc.possession()["by_team"][s.config["teams"][0]["team_id"]] == 5
