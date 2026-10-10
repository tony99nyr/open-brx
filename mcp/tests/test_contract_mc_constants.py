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
            "if (Array.isArray(v)) o[n + '#rows'] = v.every(r => typeof r !== 'object' || Object.isFrozen(r)); }"
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
    assert all(isinstance(v, list) for v in (j["HILL_CLAIMABLE_TIDS"],)), "HILL_CLAIMABLE_TIDS is not a frozen array"


def test_the_ts_file_exports_every_name():
    ts = TS.read_text(encoding="utf-8")
    for n in EXPORTED:
        assert re.search(rf"^export const {n}\b", ts, re.M), n


def test_the_ts_hill_claimable_tids_is_a_readonly_array_not_a_set():
    assert "export const HILL_CLAIMABLE_TIDS = [0, 1, 3] as const;" in TS.read_text(encoding="utf-8")


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
