"""The shared honours cases (app/test/fixtures/honors-cases.json) against scoring.Scorer.honors() (Seams Batch C).

A case gives each player's end-of-match summary; this sets it on a real Scorer and replaces only the three
views honors() reads that need a fact history (accuracy, longest life, objective seconds) with the given
numbers. Every award rule, floor, tie and stat string is the server's own code."""
from __future__ import annotations

import json
import pathlib

from brx_mcp.mc.scoring import Scorer

CASES_PATH = pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "honors-cases.json"
T0 = 1_000_000


def load() -> dict:
    return json.loads(CASES_PATH.read_text(encoding="utf-8"))


def run_case(case: dict) -> list[dict]:
    mode = case.get("mode", "tdm")
    rows = case["players"]
    ffa = mode == "ffa"
    teams = ([{"team_id": "ffa", "name": "FFA", "color": "#fff", "tid": 1}] if ffa else
             [{"team_id": "blue", "name": "B", "color": "#00f", "tid": 1},
              {"team_id": "yellow", "name": "Y", "color": "#ff0", "tid": 2}])
    players = {}
    for i, r in enumerate(rows):
        team = "ffa" if ffa else ("blue" if i % 2 == 0 else "yellow")
        players[r["id"]] = {"player_id": r["id"], "player_num": i + 1, "display": r["id"].upper(), "team_id": team,
                            "node_id": f"n{i}", "gun_id": None, "loadout": {"weapons": []}, "voice": "male", "ready": True}
    sc = Scorer("m1", T0, 600, mode, players, teams, {f"n{i}": r["id"] for i, r in enumerate(rows)},
                {f"n{i}": True for i in range(len(rows))}, now_ms=lambda: T0 + 600_000)
    acc: dict[int, float | None] = {}
    for r in rows:
        st = sc.stats[r["id"]]
        st.kills, st.deaths, st.assists = r.get("kills", 0), r.get("deaths", 0), r.get("assists", 0)
        st.best_streak = r.get("best_streak", 0)
        st.multis = list(r.get("multis", []))
        st.multi_best = max(st.multis, default=0)
        st.shots = r.get("shots", 0)
        st.flushed = r.get("flushed", True)
        acc[id(st)] = r.get("accuracy")
        if r.get("unsynced"):
            sc.unsynced_pids.add(r["id"])
        if r.get("hot_join"):
            sc.joined_t[r["id"]] = T0 + 60_000
    life = {r["id"]: r.get("longest_life_ms", 0) for r in rows}
    obj = {r["id"]: r.get("objective_s", 0) for r in rows}
    sc._accuracy = lambda st: acc[id(st)]                       # type: ignore[method-assign]
    sc._longest_life = lambda pid: life[pid]                   # type: ignore[method-assign]
    sc.objective_s = lambda pid: obj[pid]                      # type: ignore[method-assign]
    fb = case.get("first_blood")
    if fb is not None:
        sc.first_blood = fb["player_id"]
        sc.kills.append({"killer": fb["player_id"], "t": T0 + fb["t_match_s"] * 1000})
    return [{"key": h["key"], "award": h["award"], "player_id": h["player_id"], "stat": h["stat"]} for h in sc.honors()]


DOC = load()


def test_every_case_awards_what_the_server_awards():
    for c in DOC["cases"]:
        assert run_case(c) == c["honors"], c["name"]


def test_the_cases_award_every_honour_and_hit_the_floor():
    from brx_mcp.mc.types import AWARDS
    seen = {h["key"] for c in DOC["cases"] for h in c["honors"]}
    assert seen == {a["key"] for a in AWARDS}, seen ^ {a["key"] for a in AWARDS}
    assert any(len(c["players"]) < 3 and not c["honors"] for c in DOC["cases"])
    assert any(len({h["player_id"] for h in c["honors"] if h["key"] == "mvp"}) > 1 for c in DOC["cases"])


def test_the_case_names_are_unique():
    names = [c["name"] for c in DOC["cases"]]
    assert len(names) == len(set(names))
