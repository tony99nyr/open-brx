"""Seams batch B: the MC console constants gen_contract.py exports equal the Python they come from.

The staleness test (test_contract_generated) proves the files match the generator. This file proves the generator
reads the right sources: it loads the generated JS in node and compares every export with the owning module, and it
pins the copies that still live as separate literals (so the owning lane learns when one drifts)."""
import json
import pathlib
import re
import shutil
import subprocess
import sys

MCP = pathlib.Path(__file__).resolve().parents[1]
REPO = MCP.parent
sys.path.insert(0, str(MCP))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from _skip import needs   # noqa: E402

from brx_mcp.mc import compile as C, favourites as F, gamepick as G, pieces as P, policy as PO   # noqa: E402
from brx_mcp.mc import powerups as PW, state as S, stations as ST, types as T   # noqa: E402

JS = REPO / "app" / "src" / "transport" / "contract.gen.js"
TS = REPO / "webapp" / "mc" / "src" / "api" / "contract.gen.ts"
EXPORTED = ["POWERUP_PRESETS", "HEALTH_PRESETS", "OBJECTIVE_MODES", "SOLO_MODES", "TEAM_COUNT_MIN", "TEAM_COUNT_MAX",
         "TEAM_COLOURS", "ONE_TEAM_REFUSAL", "RE_PUSH_ON_LOBBY", "NAME_MAX", "RUNWAY_MIN_S", "RUNWAY_MAX_S",
         "STATION_KIND_LABEL", "STATION_KIND_SHORT", "PRESET_LABELS", "HILL_CLAIMABLE_TIDS"]


def _js_exports() -> dict:
    needs(shutil.which("node"), "node")
    prog = ("import * as c from %s; const o = {}; for (const n of %s) {"
            "const v = c[n]; o[n] = v; o[n + '#frozen'] = Object.isFrozen(v) || typeof v !== 'object'; "
            "if (Array.isArray(v)) o[n + '#rows'] = v.every(r => typeof r !== 'object' || Object.isFrozen(r)); "
            "else if (v && typeof v === 'object') o[n + '#rows'] = Object.values(v).every(r => typeof r !== 'object' || Object.isFrozen(r)); }"
            "console.log(JSON.stringify(o));" % (json.dumps(JS.as_uri()), json.dumps(EXPORTED)))
    r = subprocess.run(["node", "--input-type=module", "-e", prog], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr[-600:]
    return json.loads(r.stdout)


def test_every_export_equals_its_python_source():
    j = _js_exports()
    assert j["POWERUP_PRESETS"] == [{"id": k, **v} for k, v in PW._PRESETS.items()]
    assert [r["id"] for r in j["POWERUP_PRESETS"]] == list(PW._PRESETS), "source order lost"
    assert j["HEALTH_PRESETS"] == {k: dict(zip(("max_hp", "max_armor", "max_shield"), v))
                                   for k, v in C.HEALTH_PRESETS.items()}
    assert list(j["HEALTH_PRESETS"]) == list(C.HEALTH_PRESETS)
    assert set(j["OBJECTIVE_MODES"]) == set(T.OBJECTIVE_MODES)
    assert set(j["SOLO_MODES"]) == set(C.SOLO_MODES)
    assert set(j["TEAM_COLOURS"]) == set(G.TEAM_COLOURS)
    assert j["ONE_TEAM_REFUSAL"] == S.Session._ONE_TEAM_REFUSAL
    assert j["RE_PUSH_ON_LOBBY"] == S.Session._RE_PUSH_ON_LOBBY
    assert j["NAME_MAX"] == P._NAME_MAX
    assert (j["RUNWAY_MIN_S"], j["RUNWAY_MAX_S"]) == (F._COUNTDOWN_MIN, F._COUNTDOWN_MAX)
    assert j["STATION_KIND_LABEL"] == S._STATION_KIND_LABEL
    assert j["STATION_KIND_SHORT"] == ST.StationRegistry._DEPARTURE_NAME
    assert j["PRESET_LABELS"] == PO.PRESET_LABELS
    assert j["HILL_CLAIMABLE_TIDS"] == sorted(T.HILL_CLAIMABLE_TIDS)


def test_the_station_kind_tables_cover_exactly_the_station_kinds_in_order():
    j = _js_exports()
    for name in ("STATION_KIND_LABEL", "STATION_KIND_SHORT"):
        assert list(j[name]) == list(T.STATION_KINDS), name


def test_the_js_tables_are_frozen_all_the_way_down():
    j = _js_exports()
    for n in EXPORTED:
        assert j[n + "#frozen"], f"{n} is mutable in the generated JS"
    assert j["POWERUP_PRESETS#rows"], "a POWERUP_PRESETS row is mutable"
    assert j["HEALTH_PRESETS#rows"], "a HEALTH_PRESETS row is mutable"
    assert all(isinstance(v, list) for v in (j["HILL_CLAIMABLE_TIDS"],)), "HILL_CLAIMABLE_TIDS is not a frozen array"


def test_the_ts_file_exports_every_name():
    ts = TS.read_text(encoding="utf-8")
    for n in EXPORTED:
        assert re.search(rf"^export const {n}\b", ts, re.M), n


# ---- copies that are still separate literals today: pin them equal ----

def test_team_colour_vocabularies_agree():
    assert set(G.TEAM_COLOURS) == set(F._TEAM_COLOURS) == set(T.TEAM_KEYS)


def test_name_max_copies_agree():
    assert P._NAME_MAX == F._NAME_MAX


def test_runway_bounds_in_api_py_match_favourites():
    src = (MCP / "brx_mcp" / "mc" / "api.py").read_text(encoding="utf-8")
    pairs = set(re.findall(r'_int\([^\n]*runway_s[^\n]*?,\s*(\d+),\s*(\d+)\)', src))
    assert pairs == {(str(F._COUNTDOWN_MIN), str(F._COUNTDOWN_MAX))}, pairs


def test_team_count_bounds_literal_in_gamepick_and_favourites():
    for mod in ("gamepick", "favourites"):
        src = (MCP / "brx_mcp" / "mc" / f"{mod}.py").read_text(encoding="utf-8")
        found = re.findall(r"(\d+) <= len\(\w+\) <= (\d+)", src)
        assert found == [("2", "4")], (mod, found)


# ---- polish: a module constant must not be shadowed by an _mc_constants row ----

def _gen():
    import importlib.util
    spec = importlib.util.spec_from_file_location("gen_contract_b", MCP / "tools" / "gen_contract.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _clash(value):
    gen = _gen()
    old = getattr(T, "TEAM_COUNT_MIN", None)
    T.TEAM_COUNT_MIN = value
    try:
        gen.render()
    except ValueError as e:
        return str(e)
    finally:
        del T.TEAM_COUNT_MIN
    return None


def test_a_types_constant_with_a_different_value_than_its_row_raises():
    msg = _clash(3)
    assert msg and "TEAM_COUNT_MIN" in msg and "remove the _mc_constants row" in msg, msg


def test_a_types_constant_with_the_same_value_as_its_row_raises_too():
    msg = _clash(2)
    assert msg and "remove the _mc_constants row" in msg, msg


def test_types_own_objective_modes_set_does_not_clash_with_its_row():
    _gen().render()   # OBJECTIVE_MODES is a set in types.py: not emitted, so the row supplies it


# ---- polish: the console calls .includes on these with a wide string/number ----

def test_the_ts_membership_arrays_are_typed_wide():
    ts = TS.read_text(encoding="utf-8")
    for n in ("OBJECTIVE_MODES", "SOLO_MODES", "TEAM_COLOURS"):
        assert re.search(rf"^export const {n}: readonly string\[\] = \[", ts, re.M), n
    assert re.search(r"^export const HILL_CLAIMABLE_TIDS: readonly number\[\] = \[0, 1, 3\];", ts, re.M)


def test_includes_with_a_wide_string_compiles_under_tsc():
    needs(shutil.which("npx") and (REPO / "webapp" / "mc" / "node_modules").is_dir(), "webapp/mc node_modules")
    probe = REPO / "webapp" / "mc" / "src" / "api" / f"_probe_includes_{__import__('os').getpid()}.ts"
    probe.write_text("import { OBJECTIVE_MODES, SOLO_MODES, TEAM_COLOURS, HILL_CLAIMABLE_TIDS } from './contract.gen';\n"
                     "export const a = (m: string, n: number) => OBJECTIVE_MODES.includes(m) && SOLO_MODES.includes(m)"
                     " && TEAM_COLOURS.includes(m) && HILL_CLAIMABLE_TIDS.includes(n);\n", encoding="utf-8")
    try:
        r = subprocess.run(["npx", "tsc", "--noEmit"], cwd=REPO / "webapp" / "mc", capture_output=True, text=True, timeout=300)
    finally:
        probe.unlink()
    assert r.returncode == 0, (r.stdout + r.stderr)[-800:]
