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


def _session(sid: int, spawn_every_s: int | None, preset: str = "overshield", clock: _Clock | None = None):
    clock = clock or _Clock()
    s = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=clock, voice_rng=random.Random(7))
    s.powerups_enabled = True
    s.set_config({"mode": "tdm"})
    teams = [t["team_id"] for t in s.config["teams"]]
    for i, g in enumerate([g["gun_id"] for g in s.armory.list()][:2]):
        s.add_player(f"P{i}", teams[i % len(teams)], g, "male")
    for i, p in enumerate(s.players.values()):
        s.net.simulate_hello(f"phone-{i}", p["gun_id"])
    s.net.simulate_utility_hello(NID)
    body: dict = {"kind": "powerup", "team": "any", "id": sid, "item_preset": preset}
    if spawn_every_s is not None:
        body["spawn_every_s"] = spawn_every_s
    s.set_station(NID, body)
    return s, clock


def _restart(s, clock, sid, roster, old_shape=False):
    """MC stops and starts: the same snapshot, a new Session (A56 M1)."""
    import tempfile
    s._persist_path = Path(tempfile.mkdtemp()) / "session.json"
    s._persist_last = 0.0
    s._persist()
    if old_shape:     # a snapshot written before F454 had none of these fields
        doc = json.loads(s._persist_path.read_text(encoding="utf-8"))
        for row in doc["powerups"]["st"].values():
            for k in ("taken", "by_station", "line", "prev", "fid", "hist"):
                row.pop(k, None)
        s._persist_path.write_text(json.dumps(doc), encoding="utf-8")
    s2 = Session(Compiler(), FakeNet(), FakeArmory(demo_armory()), now_ms=clock, voice_rng=random.Random(7))
    s2.powerups_enabled = True
    s2._persist_path = s._persist_path
    try:
        assert s2.restore_snapshot()
    finally:   # the snapshot has done its job: leave no folder behind, and no later write into it
        import shutil
        shutil.rmtree(s._persist_path.parent, ignore_errors=True)
        s._persist_path = s2._persist_path = None
    s2.tick()
    assert s2.phase in ("armed", "live") and s2.start_info["match_id"] == s.start_info["match_id"]
    return s2, [s2.players[s2.node_player.get(f"phone-{i}")] if s2.node_player.get(f"phone-{i}") else r
                for i, r in enumerate(roster)]


def _updates(s) -> list[dict]:
    return [b for n, k, b in s.net.pushed if k == "station_update" and n == NID]


def _took(s) -> int:
    return sum(" TOOK " in r["text"] for r in s.feed)


def _run(case: dict) -> None:
    mc, sid = case["mc"], case["setup"]["id"]
    if "spawn_every_s" in case["setup"] and "item_spawn_every_s" in mc:
        assert case["setup"]["spawn_every_s"] == mc["item_spawn_every_s"], f"{case['name']}: setup and mc disagree"
    preset = mc.get("item_preset", "overshield")
    kind = "weapon" if preset != "overshield" else "overshield"
    s, clock = _session(sid, mc.get("item_spawn_every_s"), preset)
    roster = [s.players[s.node_player[f"phone-{i}"]] for i in range(2)]
    edits: list[dict] = []
    s.on_feed_edit(lambda e: edits.append(dict(e)))
    s.net.pushed.clear()
    s.push_config(force=True)
    s.start(runway_s=RUNWAY_S, force=True)
    s.tick()
    go, mid = s.start_info["go_live_t"], s.start_info["match_id"]
    if "armed" in mc:
        assert _updates(s) == mc["armed"]["updates"], f"{case['name']}: arm"
    for step in mc["steps"]:
        at = f"{case['name']} @ t={step['t']} {step['do']}"
        clock.t = go + step["t"]
        s.net.pushed.clear()
        edits.clear()
        what = step["do"]
        player = roster[step["player"]] if "player" in step else None
        if what == "tick":
            s.tick()
        elif what == "taken":
            num = step["player_num"] if "player_num" in step else player["player_num"]
            body = {"id": step.get("station_id", sid), "action": "taken", "player_num": num, "t": clock.t}
            if "age_ms" in step:
                body["age_ms"] = step["age_ms"]
            s.net.simulate_node_message(NID, "station_action", body, clock.t)
        elif what == "pickup":
            node = f"phone-{step['player']}"
            ev = {"type": "pickup", "t": go + step["fact_t"] if "fact_t" in step else clock.t,
                  "match_id": step.get("match_id", mid), "node_id": node, "player_id": player["player_id"],
                  "station_id": step.get("station_id", sid), "item_kind": kind, "seq": 1000 + step["t"]}
            s.net.simulate_event(node, ev, clock.t)
        elif what == "reset":
            s.net.simulate_node_message(NID, "station_action", {"id": sid, "action": "reset", "t": clock.t}, clock.t)
        elif what == "hello":
            s.net.simulate_utility_hello(NID)
        elif what == "end":
            s.control("end")
        elif what == "next_match":
            s.next_match()
        elif what == "restart":
            s, roster = _restart(s, clock, sid, roster, step.get("old_shape", False))
            s.on_feed_edit(lambda e: edits.append(dict(e)))
        elif what == "reset_api":
            refused = None
            try:
                s.reset_station(step.get("node", NID))
            except (ValueError, KeyError) as e:
                refused = str(e)
            want = step.get("expect", {}).get("refused")
            assert (want is None and refused is None) or (want and refused and want in refused), f"{at}: refused {refused!r}"
        else:
            raise AssertionError(f"{at}: unknown step")
        view, ex = (s._station_view(NID) if s.phase in ("armed", "live") else {}), step.get("expect", {})
        if "available" in ex:
            assert view["item_available"] is ex["available"], f"{at}: available"
        if "taken_by" in ex:
            want = None if ex["taken_by"] is None else roster[ex["taken_by"]]["player_num"]
            assert view.get("taken_by") == want, f"{at}: taken_by {view.get('taken_by')!r} != {want!r}"
        if "feed_took" in ex:
            assert _took(s) == ex["feed_took"], f"{at}: TOOK lines"
        lines = [r for r in s.feed if " TOOK " in r["text"]]
        if "took_lines" in ex:
            assert [r["text"] for r in lines] == ex["took_lines"], f"{at}: TOOK lines {[r['text'] for r in lines]}"
        if "edited_rows" in ex:
            ids = [r["id"] for r in lines]
            assert [ids.index(e["id"]) if e["id"] in ids else None for e in edits] == ex["edited_rows"], f"{at}: feed_edit rows"
        for text in ex.get("feed_has", []):
            assert any(text in r["text"] for r in s.feed), f"{at}: feed lacks {text!r}"
        for text in ex.get("feed_lacks", []):
            assert not any(text in r["text"] for r in s.feed), f"{at}: feed has {text!r}"
        if "updates" in ex:
            assert _updates(s) == ex["updates"], f"{at}: station_update bodies"


def test_the_fixture_has_mc_cases():
    assert len(_cases()) >= 8


def test_every_mc_case():
    bad = []
    for case in _cases():
        try:
            _run(case)
        except AssertionError as e:
            bad.append(str(e))
    assert not bad, "\n".join(bad)
