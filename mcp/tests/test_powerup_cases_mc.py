"""Mission Control against the powerup station cases it shares with the phone and the Stick (A2 follow-up).

app/test/fixtures/powerup-station-cases.json holds one rule set. The phone (app/src/powerup.js) and the Stick
(station_link.h) run its `steps`; this file runs each case's `mc` block on the REAL Session: the spawn schedule
(`_powerup_tick`), the take dedupe (`_take_item`, from a station's `taken` report and a player's `pickup` fact),
the operator reset and the reconnect update. Format: the fixture's `about`. Source of truth: docs/spec/powerups.md.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from brx_mcp.mc.compile import Compiler
from brx_mcp.mc.fakes import FakeArmory, FakeNet, demo_armory
from brx_mcp.mc.state import Session

FIXTURE = Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "powerup-station-cases.json"
NID = "u1"
RUNWAY_S = 3


class _Clock:
    def __init__(self, t: int = 1_800_000_000_000):
        self.t = t

    def __call__(self) -> int:
        return self.t


def _cases() -> list[dict]:
    doc = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return [c for c in doc["cases"] if "mc" in c and ("only" not in c or "mc" in c["only"])]


def _session(sid: int, spawn_every_s: int | None):
    clock = _Clock()
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=clock, voice_rng=random.Random(7))
    s.powerups_enabled = True
    s.set_config({"mode": "tdm"})
    teams = [t["team_id"] for t in s.config["teams"]]
    for i, g in enumerate([g["gun_id"] for g in s.armory.list()][:2]):
        s.add_player(f"P{i}", teams[i % len(teams)], g, "male")
    for i, p in enumerate(s.players.values()):
        s.net.simulate_hello(f"phone-{i}", p["gun_id"])
    s.net.simulate_utility_hello(NID)
    body: dict = {"kind": "powerup", "team": "any", "id": sid, "item_preset": "overshield"}
    if spawn_every_s is not None:
        body["spawn_every_s"] = spawn_every_s
    s.set_station(NID, body)
    return s, clock


def _updates(s) -> list[dict]:
    return [b for n, k, b in s.net.pushed if k == "station_update" and n == NID]


def _took(s) -> int:
    return sum(" TOOK " in r["text"] for r in s.feed)


def _run(case: dict) -> None:
    mc, sid = case["mc"], case["setup"]["id"]
    s, clock = _session(sid, mc.get("item_spawn_every_s"))
    roster = [s.players[s.node_player[f"phone-{i}"]] for i in range(2)]
    s.net.pushed.clear()
    s.push_config(force=True)
    s.start(runway_s=RUNWAY_S, force=True)
    s.tick()
    go = s.start_info["go_live_t"]
    if "armed" in mc:
        assert _updates(s) == mc["armed"]["updates"], f"{case['name']}: arm"
    for step in mc["steps"]:
        at = f"{case['name']} @ t={step['t']} {step['do']}"
        clock.t = go + step["t"]
        s.net.pushed.clear()
        what = step["do"]
        player = roster[step["player"]] if "player" in step else None
        if what == "tick":
            s.tick()
        elif what == "taken":
            body = {"id": step.get("station_id", sid), "action": "taken", "player_num": player["player_num"], "t": clock.t}
            if "age_ms" in step:
                body["age_ms"] = step["age_ms"]
            s.net.simulate_node_message(NID, "station_action", body, clock.t)
        elif what == "pickup":
            node = f"phone-{step['player']}"
            ev = {"type": "pickup", "t": go + step["fact_t"] if "fact_t" in step else clock.t,
                  "match_id": s.start_info["match_id"], "node_id": node, "player_id": player["player_id"],
                  "station_id": step.get("station_id", sid), "item_kind": "overshield", "seq": 1000 + step["t"]}
            s.net.simulate_event(node, ev, clock.t)
        elif what == "reset":
            s.net.simulate_node_message(NID, "station_action", {"id": sid, "action": "reset", "t": clock.t}, clock.t)
        elif what == "hello":
            s.net.simulate_utility_hello(NID)
        else:
            raise AssertionError(f"{at}: unknown step")
        view, ex = s._station_view(NID), step.get("expect", {})
        if "available" in ex:
            assert view["item_available"] is ex["available"], f"{at}: available"
        if "taken_by" in ex:
            want = None if ex["taken_by"] is None else roster[ex["taken_by"]]["player_num"]
            assert view.get("taken_by") == want, f"{at}: taken_by {view.get('taken_by')!r} != {want!r}"
        if "feed_took" in ex:
            assert _took(s) == ex["feed_took"], f"{at}: TOOK lines"
        if "updates" in ex:
            assert _updates(s) == ex["updates"], f"{at}: station_update bodies"


def test_the_fixture_has_mc_cases():
    assert len(_cases()) >= 8


def test_every_mc_case():
    for case in _cases():
        _run(case)
