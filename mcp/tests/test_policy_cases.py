"""The shared loadout-pool cases (app/test/fixtures/policy-cases.json) against policy.py (Seams Batch C).

`pool` cases run policy.pool() on the file's own small catalogue; `easy_reload` cases run conflict() and
chain_conflict(). The console's computePool and its Easy Reload check read the same file (mc.md #4, brx3)."""
from __future__ import annotations

import json
import pathlib

from brx_mcp.mc import policy as P

CASES_PATH = pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "policy-cases.json"


def load() -> dict:
    return json.loads(CASES_PATH.read_text(encoding="utf-8"))


def run_pool(doc: dict, case: dict) -> dict:
    return dict(P.pool(case["policy"], doc["weapons"], doc["perks"]))


def run_easy_reload(doc: dict, case: dict) -> dict:
    return {"conflict": P.conflict(case["loadout"]), "chain_conflict": P.chain_conflict(case["loadout"], doc["weapons"])}


DOC = load()


def test_every_pool_case_gives_the_servers_pool_and_reasons():
    for c in DOC["pool"]:
        assert run_pool(DOC, c) == c["expect"], c["name"]


def test_every_easy_reload_case_gives_the_servers_conflicts():
    for c in DOC["easy_reload"]:
        assert run_easy_reload(DOC, c) == c["expect"], c["name"]


def test_the_cases_reach_every_empty_code():
    codes = {code for c in DOC["pool"] for code in (c["expect"].get("reasons") or {}).values()}
    assert codes == set(P.POOL_EMPTY_CODES), codes ^ set(P.POOL_EMPTY_CODES)
    assert any(c["expect"]["chain_conflict"] for c in DOC["easy_reload"])
    assert any(c["expect"]["conflict"] for c in DOC["easy_reload"])


def test_the_catalogue_states_what_pool_reads_from_python():
    """A TS reader has no UNPLAYABLE_IDS or weapons.json: the file must carry both facts itself."""
    ids = {w["weapon_id"] for w in DOC["weapons"]}
    assert {w["weapon_id"] for w in DOC["weapons"] if w.get("unplayable")} == set(P.UNPLAYABLE_IDS) & ids
    assert set(P.UNPLAYABLE_IDS) & ids, "no unplayable row: the rule goes untested"
    assert all(w.get("reload_type") in ("chain", "magazine") for w in DOC["weapons"])
    for c in DOC["easy_reload"]:
        assert {w["weapon_id"] for w in c["loadout"]["weapons"]} <= ids, c["name"]


def test_the_case_names_are_unique():
    names = [c["name"] for c in DOC["pool"] + DOC["easy_reload"]]
    assert len(names) == len(set(names))
