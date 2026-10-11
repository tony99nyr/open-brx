"""Writes app/test/fixtures/gun-replies.json by RUNNING mcp/brx_mcp/fake.py FakeTagger (A9, review 2026-10-10).

FakeTagger is the bench-proven gun model CI tests the phone against. app/src/fakegun.js, the browser e2e rig's
gun, must answer the same writes with the same frames: app/test/fakegun-cases.test.mjs holds it to this file, and
mcp/tests/test_gun_reply_cases.py fails when fake.py changes until the file is regenerated on purpose.
Run: python3 app/test/fixtures/gen_gun_replies.py (it sits beside the file it writes, as gen-clock-cases.mjs does)."""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
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
    t = w0.rstrip("*").rstrip(",").split(",")
    t[17], t[18], t[40], t[41] = "20", "120", "20", "60"
    w0_new = ",".join(t) + ",*"
    t = w0.rstrip("*").rstrip(",").split(",")[:41]
    t[18] = "300"                               # a t17 whose half (150) differs from the trimmed t40 (96)
    w0_no_t40 = ",".join(t) + ",*"
    live = [{"write": head}, {"write": ["$SPAWN,,*"]}]
    shield_head = [f.replace(",45,70,0,50,", ",45,70,50,50,", 1) if f.startswith("$PSET,") else f for f in head]
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
        {"name": "$LIFE adds per pool, floored at 0 and capped at the $PSET maxima, with no spill",
         "steps": live + [{"write": ["$LIFE,0,-5,0,*"]}, {"write": ["$LIFE,0,-100,0,*"]}, {"write": ["$LIFE,10,200,0,*"]}]},
        {"name": "$LIFE token 3 fills the shield up to the $PSET t5 ceiling",
         "steps": [{"write": shield_head}, {"write": ["$SPAWN,,*"]}, {"write": ["$LIFE,0,0,25,*"]}, {"write": ["$LIFE,0,0,100,*"]}]},
        {"name": "a lethal $LIFE sends the death $LCD with the slot's counts, and the dead gun then answers the zero probe with $HP,0,0,0",
         "steps": live + [{"write": ["$LIFE,-45,-70,0,*"]}, {"write": ["$LIFE,0,0,0,*"]}]},
        {"name": "$LIFE mode 1 sets the pools outright, clamped at the maxima, and revives a dead gun",
         "steps": live + [{"write": ["$LIFE,-45,-70,0,*"]}, {"write": ["$LIFE,30,90,0,1,*"]}]},
        {"name": "$LIFE mode 2 sets the pools outright with no clamp",
         "steps": live + [{"write": ["$LIFE,60,90,0,2,*"]}]},
        {"name": "a gun killed with armour left answers the zero probe with $HP,0,0,0",
         "steps": live + [{"write": ["$LIFE,-45,0,0,*"]}, {"write": ["$LIFE,0,0,0,*"]}]},
        {"name": "a zero-effect $LIFE mode 1 on a dead gun answers $HP before mode handling",
         "steps": live + [{"write": ["$LIFE,-45,-70,0,*"]}, {"write": ["$LIFE,0,0,0,1,*"]}]},
        {"name": "a re-pushed $WEAP,0 with a new clip resets the magazine, and the next spawn refills to the new clip",
         "steps": live + [{"fire": 0}, {"write": [w0_new]}, {"fire": 0}, {"write": ["$SPAWN,,*"]}]},
        {"name": "a $WEAP with no t40 echoes half its t17 as the reserve",
         "steps": [{"write": [w0_no_t40]}]},
        {"name": "a $QUERY on a shielded gun answers the $LCD with the shield token as fake.py sends it",
         "steps": [{"write": shield_head}, {"write": ["$SPAWN,,*"]}, {"write": ["$LIFE,0,0,30,*"]}, {"write": ["$QUERY,*"]}]},
        {"name": "a short $WEAP,0 echoes the stored clip and reserve",
         "steps": [{"write": [w0]}, {"write": ["$WEAP,0,*"]}]},
        {"name": "spawn_ammo applies after the spawn $LCD echoes the refill counts",
         "opts": {"spawn_ammo": [20, 100]},
         "steps": [{"write": head}, {"write": ["$SPAWN,,*", "$AMMO,0,20,100,1,*"]}, {"write": ["$QUERY,*"]}]},
        {"name": "a spawn zeroes a granted shield (F41)",
         "steps": [{"write": shield_head}, {"write": ["$SPAWN,,*"]}, {"write": ["$LIFE,0,0,25,*"]}, {"write": ["$SPAWN,,*"]},
                   {"write": ["$LIFE,0,0,0,*"]}]},
        {"name": "$QUERY reports the $PSET player id and the $TID team, then the live pools",
         "steps": live + [{"write": ["$TID,2,*"]}, {"write": ["$QUERY,*"]}]},
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
                    "mcp/brx_mcp/fake.py FakeTagger by app/test/fixtures/gen_gun_replies.py; never edit by hand. A step is "
                    "`write` (the frames the phone wrote, in order, as one batch) or `fire` (one round from a slot); "
                    "`replies` is every frame the gun sends after it, in order, once the reply delay has passed. The "
                    "head and spawn frames are the engine's own writes from golden trace alt-swap. Read by "
                    "app/test/fakegun-cases.test.mjs (app/src/fakegun.js) and mcp/tests/test_gun_reply_cases.py.",
        "cases": [{"name": s["name"], **({"opts": s["opts"]} if "opts" in s else {}),
                   "steps": run(s["steps"])} for s in scenarios()],
    }


if __name__ == "__main__":
    doc = document()
    OUT.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    for c in doc["cases"]:
        print(c["name"], "->", [s["replies"] for s in c["steps"]][-1])
