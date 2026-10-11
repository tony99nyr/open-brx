"""Server-generated PICK and config PUT cases shared with the console mock.

Set BRX_GENERATE_CONFIG_PICK_CASES=1 when running this named test to refresh the JSON.
The normal test replays the checked-in cases against a real Session on FakeNet.
"""
from __future__ import annotations

import json
import os
import pathlib
import tempfile

from _session import mk_session
from brx_mcp.mc.picks import GamePick
from brx_mcp.mc.pieces import PieceStore
from brx_mcp.mc.state import TEAM_DEFS


PATH = pathlib.Path(__file__).resolve().parents[2] / "app/test/fixtures/config-pick-cases.json"


def teams(*ids: str) -> list[dict]:
    return [TEAM_DEFS[x].copy() for x in ids]


def spec(name: str, start: dict, *steps: dict) -> dict:
    return {"name": name, "start": start, "steps": list(steps)}


def start(mode: str = "tdm", roster: tuple[str, ...] = ("red", "blue", "red", "blue"),
          colours: tuple[str, ...] | None = None, **config: object) -> dict:
    return {"mode": mode, "teams": list(colours or (("ffa",) if mode == "ffa" else ("red", "blue"))),
            "players": list(roster), "config": config}


def pick(mode: str | None = None, **match: object) -> dict:
    return {"pick": {"pieces": {"mode": f"builtin:mode:{mode}"} if mode else {}, "match": match}}


def put(**patch: object) -> dict:
    return {"put": patch}


def specifications() -> list[dict]:
    return [
        spec("mode resets time and frag", start(), put(time_limit_s=900, scoring={"frag_limit": 30}), pick("koth")),
        spec("same pick sets new limits and hold", start(), pick("koth", time_limit_s=720, frag_limit=12, hold_target_s=45), pick(time_limit_s=750)),
        spec("carry illegal yellow to free red", start(roster=("blue", "yellow", "blue", "yellow"), colours=("blue", "yellow")), pick("koth")),
        spec("carry legal purple and blue", start(roster=("purple", "blue", "purple", "blue"), colours=("purple", "blue")), pick("koth")),
        spec("carry KOTH colours into TDM", start("koth", ("purple", "blue", "purple", "blue"), ("purple", "blue")), pick("tdm")),
        spec("three teams to two rebalances", start(roster=("red", "blue", "purple", "red", "blue", "purple"), colours=("red", "blue", "purple")), pick("koth")),
        spec("two teams to three rebalances", start(), put(teams=teams("red", "blue", "purple"))),
        spec("three teams to four rebalances", start(roster=("red", "blue", "purple", "red", "blue", "purple"), colours=("red", "blue", "purple")), pick(teams=["red", "blue", "purple", "yellow"])),
        spec("KOTH refuses three teams", start(), pick("koth", teams=["red", "blue", "purple"]), put(mode="koth", teams=teams("red", "blue", "purple"))),
        spec("KOTH refuses yellow", start(), pick("koth", teams=["red", "yellow"]), put(mode="koth", teams=teams("red", "yellow"))),
        spec("PICK refuses one team", start(), pick(teams=["red"])),
        spec("PICK refuses five teams", start(), pick(teams=["red", "blue", "yellow", "purple", "red"])),
        spec("PICK refuses duplicate colours", start(), pick(teams=["red", "red"])),
        spec("non-KOTH PICK omits hold target", start(), pick(hold_target_s=30)),
        spec("KOTH PUT copies hold target into PICK", start("koth"), put(scoring={"hold_target_s": 90}), pick(time_limit_s=660)),
        spec("same TDM pick keeps roster colours", start(roster=("blue", "yellow", "blue", "yellow"), colours=("blue", "yellow")), pick("tdm")),
        spec("non-KOTH PUT refuses hold target", start(), put(scoring={"hold_target_s": 30})),
        spec("hold target above range", start(), pick("koth", hold_target_s=7201)),
        spec("hold target below range on PUT", start("koth", ("red", "blue")), put(scoring={"hold_target_s": 0})),
        spec("venue volume survives PICK", start(volume=75), pick("koth")),
        spec("venue volume survives mode PUT", start(volume=68), put(mode="ffa")),
        spec("explicit volume wins mode PUT", start(volume=68), put(mode="koth", volume=88)),
        spec("FFA has no sides", start(), pick("ffa")),
        spec("FFA returns to team defaults", start("ffa", ("ffa", "ffa", "ffa", "ffa")), pick("tdm")),
        spec("same-count recolour preserves split", start(roster=("red", "blue", "blue", "blue")), put(teams=teams("purple", "blue")), pick(teams=None)),
        spec("PUT teams become PICK carry source", start(), put(teams=teams("purple", "blue")), pick("koth")),
        spec("night survives mode PICK", start(), pick(night=True), pick("koth")),
    ]


def projection(s) -> dict:
    c = s.config
    match = s.game_pick["match"]
    return {"mode": c["mode"], "teams": [{k: t[k] for k in ("team_id", "name", "color", "tid")} for t in c["teams"]],
            "time_limit_s": c.get("time_limit_s"), "frag_limit": c["scoring"].get("frag_limit"),
            "hold_target_s": c["scoring"].get("hold_target_s"), "night": c["night"],
            "volume": c.get("volume"), "respawn": c["respawn"],
            "game_pick": {"pieces": {"mode": s.game_pick["pieces"].get("mode")}, "match": {k: match[k] for k in ("teams", "hold_target_s", "time_limit_s", "frag_limit", "night", "silenced") if k in match}},
            "players": [p["team_id"] for p in sorted(s.players.values(), key=lambda p: p["player_num"])]}


def replay(case: dict, expected: bool) -> list[dict]:
    st = case["start"]
    setup = {"teams": teams(*st["teams"]), **st["config"]}
    s, _net, _clock, _players = mk_session(0, mode=st["mode"], time_limit_s=600, cfg=setup)
    for i, team_id in enumerate(st["players"]):
        s.add_player(f"P{i + 1}", team_id=team_id)
    with tempfile.TemporaryDirectory() as folder:
        s.attach_pieces(PieceStore(pathlib.Path(folder) / "pieces.json"))
        game = GamePick(s)
        results = []
        for i, step in enumerate(case["steps"]):
            try:
                if "pick" in step:
                    p = step["pick"]
                    response = game.pick(p["pieces"], p["match"])
                else:
                    response = s.set_config(step["put"])
                outcome = {"ok": True} if response["ok"] else {"refusal": response["errors"][0], "thrown": False}
            except ValueError as exc:
                outcome = {"refusal": str(exc), "thrown": True}
            row = {**step, "outcome": outcome, "result": projection(s)}
            if expected:
                want = case["steps"][i]
                assert outcome == want["outcome"], (case["name"], i, outcome, want["outcome"])
                assert row["result"] == want["result"], (case["name"], i, row["result"], want["result"])
            results.append(row)
        return results


def test_config_pick_cases():
    cases = specifications()
    assert 15 <= len(cases) <= 30
    if os.environ.get("BRX_GENERATE_CONFIG_PICK_CASES") == "1":
        doc = {"_comment": "Generated by the server through mcp/tests/test_config_pick_cases.py. Each step uses GamePick.pick or Session.set_config, then records the Session projection.",
               "cases": [{**c, "steps": replay(c, False)} for c in cases]}
        PATH.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    doc = json.loads(PATH.read_text(encoding="utf-8"))
    assert [c["name"] for c in doc["cases"]] == [c["name"] for c in cases]
    assert len({c["name"] for c in cases}) == len(cases)
    for actual, defined in zip(doc["cases"], cases):
        assert actual["start"] == defined["start"], actual["name"]
        assert [{k: v for k, v in step.items() if k in ("pick", "put")} for step in actual["steps"]] == defined["steps"], actual["name"]
        replay(actual, True)
