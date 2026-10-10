"""Writes app/test/fixtures/gun-replies.json by RUNNING mcp/brx_mcp/fake.py FakeTagger (A9, review 2026-10-10).

FakeTagger is the bench-proven gun model CI tests the phone against. app/src/fakegun.js, the browser e2e rig's
gun, must answer the same writes with the same frames: app/test/fakegun-cases.test.mjs holds it to this file, and
mcp/tests/test_gun_reply_cases.py fails when fake.py changes until the file is regenerated on purpose.
Run from mcp/: python3 tools/gen_gun_replies.py"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mcp"))
from brx_mcp.fake import FakeTagger  # noqa: E402

OUT = ROOT / "app" / "test" / "fixtures" / "gun-replies.json"
TRACE = ROOT / "app" / "test" / "fixtures" / "traces" / "alt-swap.json"


def _arming() -> tuple[list[str], list[str]]:
    """A real arming sequence (golden trace alt-swap, the engine's own writes), split at the spawn batch."""
    writes = json.loads(TRACE.read_text(encoding="utf-8"))["expect"][0]["writes"]
    start, cut = writes.index("$CLEAR,*"), writes.index("$PLAYX,0,*")
    return writes[start:cut], writes[cut:]          # from $CLEAR: the connect ritual ($PHONE, $VERSION) is not the head


def scenarios() -> list[dict]:
    head, spawn = _arming()
    w0 = next(f for f in head if f.startswith("$WEAP,0,"))
    return [
        {"name": "the head: one $ALCD per $WEAP slot, with that slot's clip (t16) and t40 reserve",
         "steps": [{"write": head}]},
        {"name": "the spawn after the head: $LCD with the pools and slot 0's clip and carried reserve (t17)",
         "steps": [{"write": head}, {"write": spawn[:2]}]},
        {"name": "the whole arming sequence: spawn, $AMMO per slot, then the $LIFE probes on a live gun",
         "steps": [{"write": head}, {"write": spawn}]},
        {"name": "the $LIFE,0,0,0 probe on a live gun answers its unchanged pools",
         "steps": [{"write": head}, {"write": ["$SPAWN,,*"]}, {"write": ["$LIFE,0,0,0,*"]}]},
        {"name": "$AMMO sets a slot's magazine and reserve and echoes them",
         "steps": [{"write": head}, {"write": ["$SPAWN,,*"]}, {"write": ["$AMMO,0,20,100,1,*"]}]},
        {"name": "each round fired reports the magazine left at once",
         "steps": [{"write": head}, {"write": ["$SPAWN,,*"]}, {"fire": 0}, {"fire": 0}, {"fire": 0}]},
        {"name": "a re-spawn refills the magazine fired from",
         "steps": [{"write": head}, {"write": ["$SPAWN,,*"]}, {"fire": 0}, {"fire": 0}, {"write": ["$SPAWN,,*"]}]},
        {"name": "a second $WEAP,0 resets slot 0's magazine to its clip",
         "steps": [{"write": head}, {"write": ["$SPAWN,,*"]}, {"fire": 0}, {"write": [w0]}]},
    ]


def run(steps: list[dict]) -> list[dict]:
    now = [0.0]
    gun = FakeTagger("AA:BB:CC:DD:3D:4F", clock=lambda: now[0])
    gun.drain()
    out = []
    for s in steps:
        if "write" in s:
            for f in s["write"]:
                gun.write(f)
        else:
            gun.fire(s["fire"])
        now[0] += 1.0                       # past every write's reply delay
        out.append({**s, "replies": gun.drain()})
    return out


def document() -> dict:
    return {
        "_comment": "A9 (review 2026-10-10): what a gun sends back for the writes and trigger pulls below, GENERATED from "
                    "mcp/brx_mcp/fake.py FakeTagger by mcp/tools/gen_gun_replies.py; never edit by hand. A step is "
                    "`write` (the frames the phone wrote, in order, as one batch) or `fire` (one round from a slot); "
                    "`replies` is every frame the gun sends after it, in order, once the reply delay has passed. The "
                    "head and spawn frames are the engine's own writes from golden trace alt-swap. Read by "
                    "app/test/fakegun-cases.test.mjs (app/src/fakegun.js) and mcp/tests/test_gun_reply_cases.py.",
        "cases": [{"name": s["name"], "steps": run(s["steps"])} for s in scenarios()],
    }


if __name__ == "__main__":
    doc = document()
    OUT.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    for c in doc["cases"]:
        print(c["name"], "->", [s["replies"] for s in c["steps"]][-1])
