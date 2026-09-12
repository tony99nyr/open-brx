"""A18 / E1 — `GameConfig.mode_params`: a mode's own rules, declared by its engine, validated by MC,
carried on the wire, and READ by the engine instead of a literal.

The gap it closes (docs/archive/mode-extensibility.md G1): the wire config had no slot for a mode's
parameters, so an objective mode could not be configured from Mission Control at all. Every test here
carries a CONTROL: the same path with the knob absent, a mode that declares none, or the old CLI
dataclass, so a pass proves the parameter did the work and not something that happened alongside it.

Run: python3 run_tests.py mode_params
"""
from brx_mcp.gameconfig import GameConfig as CliConfig
from brx_mcp.mc.state import MODES, default_config
from brx_mcp.modes import (BombEngine, CtfEngine, DominationEngine, LastManStandingEngine,
                           build_engine, params_schema, params_schema_json, registry, validate_mode_params)
from brx_mcp.modes.extraction_adapter import ExtractionEngineAdapter
from brx_mcp.modes.params import Param, resolve, validate
from _session import mc_session


_sess = mc_session   # shared fixture: tests/_session.py


def _raises(fn, *needles):
    try:
        fn()
    except ValueError as e:
        for n in needles:
            assert n in str(e), f"{n!r} not in {e}"
        return str(e)
    raise AssertionError("expected a ValueError")


def cap(site, team):
    return {"command": "CAPTURE", "tokens": ["CAPTURE", site, str(team)]}


# --------------------------------------------------------------------------- #
# 1. the schema: engines declare, the registry serves                          #
# --------------------------------------------------------------------------- #
def test_every_engine_with_literals_now_declares_them_and_the_registry_finds_them():
    """The params that used to be hardcoded constants / dataclass-only knobs are declared on the engine
    that reads them. CONTROL: tdm/ffa/infection declare nothing -- their rules already ride the wire as
    scoring / respawn / teams, and a knob the engine ignored would be a control that does nothing."""
    assert set(DominationEngine.PARAMS) == {"score_target", "points_per_s"}
    assert set(CtfEngine.PARAMS) == {"cap_target"}
    assert set(BombEngine.PARAMS) == {"detonation_s", "rounds_to_win", "attackers_team", "defenders_team"}
    assert set(ExtractionEngineAdapter.PARAMS) == {"channel_s", "win_target", "loot_per_kill", "drop_policy",
                                                   "extract_removes_player"}
    assert set(LastManStandingEngine.PARAMS) == {"lives"}
    for mode in ("tdm", "ffa", "infection"):
        assert params_schema(mode) == {}, mode
    # the registry resolves every alias the driver used to switch on by string
    assert registry.engine_class("koth") is DominationEngine and registry.engine_class("bomb") is BombEngine
    _raises(lambda: registry.engine_class("hopscotch"), "unknown mode 'hopscotch'")
    # `control_points` is deliberately NOT a wire param (F88: a beacon carries no station id)
    assert "control_points" not in DominationEngine.PARAMS


def test_the_schema_rows_are_what_a_ui_needs_to_render_a_control():
    rows = {r["name"]: r for r in params_schema_json("extraction")}
    assert rows["channel_s"] == {"name": "channel_s", "type": "float", "default": 45.0, "min": 5, "max": 600,
                                 "desc": rows["channel_s"]["desc"]}
    assert rows["drop_policy"]["choices"] == ["ground", "killer", "pool"] and rows["drop_policy"]["type"] == "str"
    assert rows["extract_removes_player"] == {"name": "extract_removes_player", "type": "bool", "default": True,
                                              "desc": rows["extract_removes_player"]["desc"]}
    assert params_schema_json("tdm") == []                          # CONTROL: no rows for a mode with none
    # `Param` refuses a default outside its own bounds -- a schema cannot ship a value it would then reject
    _raises(lambda: Param("int", 99, "x", lo=0, hi=10), "default")
    _raises(lambda: Param("colour", 1, "x"), "type must be one of")


# --------------------------------------------------------------------------- #
# 2. validation: unknown keys and bad values are refused, in the operator's voice #
# --------------------------------------------------------------------------- #
def test_validate_fills_defaults_and_refuses_unknown_keys_and_out_of_range_values():
    resolved, errs = validate_mode_params("koth", {"score_target": 120})
    assert errs == [] and resolved == {"score_target": 120, "points_per_s": 1.0}    # defaults filled in
    _, errs = validate_mode_params("koth", {"score_target": -1})
    assert errs and "at least 0" in errs[0] and "'koth'" in errs[0]
    _, errs = validate_mode_params("koth", {"hill_period_s": 5})
    assert errs and "has no parameter 'hill_period_s'" in errs[0] and "points_per_s, score_target" in errs[0]
    _, errs = validate_mode_params("tdm", {"anything": 1})
    assert errs and "takes no mode_params" in errs[0]
    # types are strict: JSON true is not 1, 1.5 is not a whole number, a str param honours its vocabulary
    assert validate_mode_params("koth", {"score_target": True})[1]
    assert validate_mode_params("koth", {"score_target": 1.5})[1]
    assert validate_mode_params("koth", {"score_target": 10.0})[0]["score_target"] == 10     # an integral float is fine
    assert validate_mode_params("extraction", {"drop_policy": "sky"})[1]
    assert validate_mode_params("extraction", {"extract_removes_player": "yes"})[1]
    assert validate_mode_params("cs", {"attackers_team": 4})[1]                               # F35: tids are 0-3
    # CONTROL: the same values inside their bounds pass clean
    assert validate_mode_params("extraction", {"drop_policy": "killer", "extract_removes_player": False})[1] == []


def test_put_config_refuses_bad_params_and_stores_the_complete_set():
    s = _sess("koth")
    assert s.config["mode_params"] == {"score_target": 0, "points_per_s": 1.0}   # the default is COMPLETE
    s.set_config({"mode_params": {"score_target": 90}})
    assert s.config["mode_params"] == {"score_target": 90, "points_per_s": 1.0}   # partial patch merges
    _raises(lambda: s.set_config({"mode_params": {"score_target": 90, "bogus": 1}}), "has no parameter 'bogus'")
    _raises(lambda: s.set_config({"mode_params": {"points_per_s": 0}}), "at least 0.1")
    _raises(lambda: s.set_config({"mode_params": "fast"}), "must be an object")
    assert s.config["mode_params"] == {"score_target": 90, "points_per_s": 1.0}   # a refused PUT changed nothing
    # CONTROL: a mode that declares nothing carries no key, and cannot be handed one
    s.set_config({"mode": "tdm"})
    assert "mode_params" not in s.config
    _raises(lambda: s.set_config({"mode_params": {"score_target": 1}}), "takes no mode_params")
    assert "mode_params" not in default_config("tdm") and "mode_params" not in default_config("ffa")
    # a mode switch resets to the NEW mode's defaults (the old mode's keys do not leak across)
    s.set_config({"mode": "koth", "mode_params": {"score_target": 30}})
    s.set_config({"mode": "extraction"})
    assert s.config["mode_params"] == {r["name"]: r["default"] for r in params_schema_json("extraction")}


def test_the_compiler_refuses_bad_params_too_and_the_config_still_pushes_when_they_are_good():
    """Belt and braces: a config that never went through PUT (a fixture, the CLI) is still refused by
    `validate()`. And the honest CONTROL: a good set passes validate, compiles, and rides the pushed
    `config` body untouched, so a node reads the rules MC set."""
    s = _sess("koth", mode_params={"score_target": 60})
    res = s._validate()
    assert res["ok"], res["errors"]
    s.config["mode_params"]["score_target"] = 999_999          # bypass PUT
    res = s._validate()
    assert not res["ok"] and any("at most 36000" in e for e in res["errors"]), res
    s.config["mode_params"] = {"score_target": 60, "points_per_s": 2.0}
    assert s._validate()["ok"]
    s.push_config(force=True)
    cfgs = [b["config"] for _, k, b in s.net.pushed if k == "config"]
    # no phones in a unit test => nothing pushed over a socket; the bundle map still proves the compile ran
    assert set(s.bundles) == {p["player_id"] for p in s.players.values()}
    assert all(c["mode_params"] == {"score_target": 60, "points_per_s": 2.0} for c in cfgs)
    # and `GET /api/modes` carries the schema next to the defaults
    row = next(m for m in s.modes() if m["mode"] == "koth")
    assert {r["name"] for r in row["params"]} == {"score_target", "points_per_s"}
    assert row["defaults"]["mode_params"] == {"score_target": 0, "points_per_s": 1.0}
    assert next(m for m in s.modes() if m["mode"] == "tdm")["params"] == []


def test_a_saved_game_round_trips_its_params_and_an_old_one_gains_the_defaults():
    s = _sess("extraction")
    s.set_config({"mode_params": {"channel_s": 20, "drop_policy": "killer"}})
    stored = s.sanitize_config(dict(s.config))
    assert stored["mode_params"]["channel_s"] == 20.0 and stored["mode_params"]["drop_policy"] == "killer"
    # a preset saved before A18 (no key) sanitizes to the complete defaults -- no hidden state (contracts §3)
    old = {k: v for k, v in s.config.items() if k != "mode_params"}
    assert s.sanitize_config(old)["mode_params"] == {r["name"]: r["default"] for r in params_schema_json("extraction")}
    # a preset that names a knob the engine no longer has is refused, not silently trimmed
    _raises(lambda: s.sanitize_config({**s.config, "mode_params": {"loot_per_kill": 10, "gone": 1}}), "has no parameter 'gone'")


# --------------------------------------------------------------------------- #
# 3. the engines READ the params -- from the wire dict AND the CLI dataclass  #
# --------------------------------------------------------------------------- #
def test_domination_reads_score_target_and_points_per_s_from_a_wire_config():
    wire = {"mode": "domination", "mode_params": {"score_target": 10, "points_per_s": 2.0}, "game_time_s": 0}
    # a wire dict has no attributes; `resolve` reads `mode_params` and the engine tolerates the rest via getattr
    class W(dict):
        __getattr__ = dict.get
    e = DominationEngine(W(wire, control_points=1))
    e.add_player("red", 1); e.add_player("blue", 3)
    e.on_event("red", cap("A", 1), now=0.0)
    assert e.tick(now=4.0) == [] and e.snapshot()["score"][1] == 8       # 4 s x 2 pt/s
    assert any(type(a).__name__ == "GameOver" for a in e.tick(now=5.0))  # 10 reached at 5 s, not 10 s
    # CONTROL: the same match on the defaults scores 1 pt/s and needs 10 s
    e2 = DominationEngine(W({"mode": "domination", "mode_params": {}, "game_time_s": 0}, control_points=1))
    e2.add_player("red", 1); e2.add_player("blue", 3)
    e2.on_event("red", cap("A", 1), now=0.0)
    assert e2.tick(now=5.0) == [] and e2.snapshot()["score"][1] == 5 and e2.target == 0


def test_the_cli_dataclass_path_is_unchanged_and_an_out_of_range_dataclass_value_is_refused():
    """Pre-A18 callers build engines from `gameconfig.GameConfig`; `resolve` reads the same-named attribute."""
    e = DominationEngine(CliConfig(mode="domination", control_points=2, score_target=20, game_time_s=0))
    assert e.target == 20 and e.points_per_s == 1.0
    assert BombEngine(CliConfig(mode="cs", detonation_s=25, rounds_to_win=0)).detonation_s == 25.0
    assert BombEngine(CliConfig(mode="cs")).rounds_to_win == 1              # 0 still means "single round"
    assert LastManStandingEngine(CliConfig(mode="lms", respawns=4))._lives == 5       # respawns + 1, as before
    assert LastManStandingEngine(CliConfig(mode="lms"))._lives == 3                   # unlimited -> the finite default
    ad = ExtractionEngineAdapter(CliConfig(mode="extraction", channel_s=12, drop_policy="pool"))
    assert ad._ex_config().channel_s == 12.0 and ad._ex_config().drop_policy == "pool"
    # the engine will not START on a rule it cannot honour, whichever shape carried it
    _raises(lambda: CtfEngine(CliConfig(mode="ctf", cap_target=0)), "at least 1")
    _raises(lambda: build_engine(CliConfig(mode="extraction", drop_policy="sky")), "drop_policy must be one of")
    # and `resolve` on a wire dict with a bad value says the same thing
    _raises(lambda: resolve(DominationEngine, {"mode": "koth", "mode_params": {"score_target": -5}}), "at least 0")
    # CONTROL: `resolve` for an engine with no PARAMS is {} for either shape
    assert resolve(registry.engine_class("tdm"), CliConfig(mode="tdm")) == {}
    assert resolve(registry.engine_class("tdm"), {"mode": "tdm", "mode_params": {}}) == {}


def test_build_engine_still_forces_one_point_for_koth_and_names_the_vocabulary_for_a_stranger():
    e = build_engine(CliConfig(mode="koth", control_points=3))
    assert e.sites == ["A"]
    msg = _raises(lambda: build_engine(CliConfig(mode="hopscotch")), "unknown mode 'hopscotch'")
    assert "koth" in msg and "extraction" in msg


def test_register_mode_makes_a_new_mode_buildable_with_its_own_params():
    """The E2 seed: one call, and the registry / schema / validation / build_engine all know the mode."""
    from brx_mcp.modes.base import ScoredEngine

    class HopscotchEngine(ScoredEngine):
        PARAMS = {"squares": Param("int", 8, "squares on the court", lo=1, hi=20)}

        def add_player(self, player_id, team): self.roster.add(player_id, team)
        def tick(self, now): return []
        def snapshot(self): return {"mode": "hopscotch"}

    try:
        registry.register_mode("hopscotch", HopscotchEngine)
        assert params_schema_json("hopscotch")[0]["name"] == "squares"
        assert validate_mode_params("hopscotch", {"squares": 30})[1]
        assert "hopscotch" in registry.known_modes()
        class W(dict):
            __getattr__ = dict.get
        e = build_engine(W({"mode": "hopscotch", "mode_params": {"squares": 3}}))
        assert isinstance(e, HopscotchEngine) and resolve(HopscotchEngine, e.config) == {"squares": 3}
    finally:
        registry._EXTRA.pop("hopscotch", None)
    # CONTROL: gone again -- and the MC catalog (state.MODES) is still hand-registered, as documented
    _raises(lambda: registry.engine_class("hopscotch"), "unknown mode")
    assert "hopscotch" not in {m["mode"] for m in MODES}
