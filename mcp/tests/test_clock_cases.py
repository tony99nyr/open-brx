"""The stand-in phone's clock (mock_node.py MockNode) against app/test/fixtures/clock-cases.json (T4).

The file is generated from app/src/transport/clock.js, the phone, by gen-clock-cases.mjs; app/test/clock-cases.test.mjs
runs clock.js against it. The chaos clock scenarios and test_mc_clock_step.py trust MockNode's copy, so this pins it."""
from __future__ import annotations

import json
import pathlib

from brx_mcp.mc import mock_node as M
from brx_mcp.mc.types import CLOCK_STEP_MS

DOC = json.loads((pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures"
                  / "clock-cases.json").read_text(encoding="utf-8"))


class _Wall:
    """Stands in for the `time` module inside mock_node, so a step's `now` is the phone's wall clock."""
    def __init__(self) -> None:
        self.ms = 0.0

    def time(self) -> float:
        return self.ms / 1000.0


def run_case(steps: list[dict]) -> list[dict]:
    node = M.MockNode("ws://127.0.0.1:1/unused")
    node._send = lambda env: None                           # type: ignore[method-assign]  # no socket: drop the time_reqs
    wall, real = _Wall(), M.time
    M.time = wall                                           # type: ignore[assignment]
    out = []
    try:
        for s in steps:
            got = dict(s)
            if s["op"] == "seed":
                wall.ms = s["now"]
                node._apply_welcome({"server_t": s["server_t"]})
            elif s["op"] == "new_burst":
                node._start_reconnect_burst()
            elif s["op"] == "restart":
                node._handle({"kind": "control", "body": {"cmd": "clock_resync"}})
            else:
                wall.ms = s["now"]
                got["accepted"] = node._take_time_res({"t_node": s["t_node"], "server_t": s["server_t"]})
            got["offset"] = node.offset_ms
            got["synced"] = node.synced   # brx3 1d4c36b7: a welcome seed alone no longer sets it
            out.append(got)
    finally:
        M.time = real                                       # type: ignore[assignment]
    return out


def _same(a: list[dict], b: list[dict]) -> bool:
    return len(a) == len(b) and all(
        x.keys() == y.keys() and all(abs(x[k] - y[k]) < 1e-6 if isinstance(x[k], float) or isinstance(y[k], float)
                                     else x[k] == y[k] for k in x) for x, y in zip(a, b))


def test_mock_node_gives_every_clock_case_the_offset_clock_js_gives():
    assert len(DOC["cases"]) >= 10
    for c in DOC["cases"]:
        inputs = [{k: v for k, v in s.items() if k not in ("offset", "accepted", "synced")} for s in c["steps"]]
        got = run_case(inputs)
        assert _same(got, c["steps"]), (c["name"], [(g.get("accepted"), g["offset"]) for g in got])


def test_the_cases_were_made_with_this_clock_step():
    assert DOC["clock_step_ms"] == CLOCK_STEP_MS
