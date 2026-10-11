"""One gun model, held: the golden traces' gun (`_trace_gun.TraceGun`, twin of app/test/golden-trace-runner.mjs) against CI's
gun (mcp/brx_mcp/fake.py FakeTagger, recorded in app/test/fixtures/gun-replies.json), on every write TraceGun models.

TraceGun is a deliberately small gun, so the comparison is of what it CLAIMS to model. The comparison leaves out
`$QUERY`'s status array, which the engine never reads (only its `$LCD` is compared). Reply order includes FakeTagger's
delayed `$ALCD` echoes. Every other difference is named in KNOWN with its reason, and each entry must still
differ, so a fixed gap leaves the list. Found here: TraceGun's `$WEAP` echo took t17 for the reserve where the bench
(F207) and FakeTagger take t40; seven traces recorded an echo no real gun sends."""
from __future__ import annotations

import json
import pathlib

from _trace_gun import TraceGun

DOC = json.loads((pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "gun-replies.json")
                 .read_text(encoding="utf-8"))
ALL_ON = {"spawn": True, "probe": True, "life": True, "ammo": True, "alcd_echo": True}

# Case name -> (the step where TraceGun first differs, why). Each is a real gap or an option a trace sets, never a silent
# drift. The step is pinned, so a NEW difference earlier in the same case fails instead of hiding behind the known one.
KNOWN = {
    "a $QUERY on a shielded gun answers the $LCD with the shield token as fake.py sends it":
        (3, "fake.py and fakegun.js send 0 in the $QUERY $LCD t3; TraceGun sends the live shield (brx-protocol.md: $LCD t3 is the shield); a bench row decides which gun is wrong"),
}


def _norm(replies: list[str]) -> list[str]:
    return [f for f in replies if not f.startswith("$QUERY,")]


def _first_difference(case: dict) -> tuple[int, str] | None:
    """The first step where TraceGun and FakeTagger disagree, as (step, detail), or None."""
    gun = TraceGun({**ALL_ON, **case.get("opts", {})}, [45, 70, 0])
    for i, step in enumerate(case["steps"]):
        if "write" not in step:
            # a trigger pull is the gun's own act; the runner hands TraceGun the gun's frames (`heard`), which TraceGun
            # does not model as a fire (its magazine does not move), so there is nothing of its own to compare here
            for f in step["replies"]:
                gun.heard(f)
            gun.take()
            continue
        gun.wrote(step["write"])
        got = gun.take()
        if _norm(got) != _norm(step["replies"]):
            return i, f"step {i}: FakeTagger {step['replies']} TraceGun {got}"
    return None


def test_the_trace_gun_answers_every_modelled_write_as_ci_s_gun_does():
    bad = {c["name"]: d[1] for c in DOC["cases"] if c["name"] not in KNOWN and (d := _first_difference(c))}
    assert not bad, "\n".join(f"{k}: {v}" for k, v in bad.items())


def test_every_known_difference_still_differs():
    names = {c["name"]: c for c in DOC["cases"]}
    missing = [n for n in KNOWN if n not in names]
    assert not missing, f"KNOWN names a case gun-replies.json no longer has: {missing}"
    seen = {n: _first_difference(names[n]) for n in KNOWN}
    fixed = [n for n, d in seen.items() if d is None]
    assert not fixed, f"these now agree, so drop them from KNOWN: {fixed}"
    moved = {n: d[1] for n, d in seen.items() if d and d[0] != KNOWN[n][0]}
    assert not moved, f"a new difference comes before the known one: {moved}"


def test_the_weap_echo_takes_t40_as_the_bench_does():
    """F207 (bench 2026-09-16): the reserve a gun echoes for a `$WEAP` is t40 (index 41), else half of t17."""
    t = ["$WEAP", "0"] + [""] * 15 + ["32", "192"] + [""] * 22 + ["96"]
    gun = TraceGun(ALL_ON, [45, 70])
    gun.wrote([",".join(t) + ",*"])
    assert gun.take() == ["$ALCD,32,100,0,96,0,*"]
    gun.wrote([",".join(t[:41]) + ",*"])
    assert gun.take() == ["$ALCD,32,100,0,96,0,*"], "no t40: half of t17"


def test_an_empty_spawn_ammo_option_uses_the_default_refill():
    gun = TraceGun({**ALL_ON, "spawn_ammo": []}, [45, 70, 0])
    gun.wrote(["$SPAWN,,*"])
    assert gun.take() == ["$LCD,45,70,0,0,32,192,*"]
    assert (gun.mag, gun.reserve) == (32, 192)


def test_spawn_ammo_changes_the_state_after_the_spawn_reply():
    gun = TraceGun({**ALL_ON, "spawn_ammo": [20, 100]}, [45, 70, 0])
    gun.wrote(["$SPAWN,,*"])
    assert gun.take() == ["$LCD,45,70,0,0,32,192,*"]
    gun.wrote(["$QUERY,*"])
    assert gun.take() == ["$LCD,45,70,0,0,20,100,*"]
