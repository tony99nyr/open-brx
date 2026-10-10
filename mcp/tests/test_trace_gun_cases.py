"""One gun model, held: the golden traces' gun (`_trace_gun.TraceGun`, twin of app/test/golden-trace-runner.mjs) against CI's
gun (mcp/brx_mcp/fake.py FakeTagger, recorded in app/test/fixtures/gun-replies.json), on every write TraceGun models.

TraceGun is a deliberately small gun, so the comparison is of what it CLAIMS to model. Two simplifications are
normalised: it answers a `$WEAP`/`$AMMO` write at once, where FakeTagger holds the `$ALCD` for its 40 ms write latency
(so the replies of one step compare as a multiset), and it leaves out `$QUERY`'s status array, which the engine never
reads (only its `$LCD` is compared). Every other difference is named in KNOWN with its reason, and each entry must still
differ, so a fixed gap leaves the list. Found here: TraceGun's `$WEAP` echo took t17 for the reserve where the bench
(F207) and FakeTagger take t40; seven traces recorded an echo no real gun sends."""
from __future__ import annotations

import collections
import json
import pathlib

from _trace_gun import TraceGun

DOC = json.loads((pathlib.Path(__file__).resolve().parents[2] / "app" / "test" / "fixtures" / "gun-replies.json")
                 .read_text(encoding="utf-8"))
ALL_ON = {"spawn": True, "probe": True, "life": True, "ammo": True, "alcd_echo": True}

# Case name -> why TraceGun answers differently. Each is a real gap or an option a trace sets, never a silent drift.
KNOWN = {
    "$LIFE token 3 fills the shield up to the $PSET t5 ceiling":
        "TraceGun does not cap the shield at the $PSET t5 ceiling (its maxima are hp and armour only)",
    "$LIFE mode 1 sets the pools outright, clamped at the maxima, and revives a dead gun":
        "TraceGun models only the additive $LIFE; a mode 1 set (the engine's pool repair) gets no answer",
    "$LIFE mode 2 sets the pools outright with no clamp":
        "TraceGun models only the additive $LIFE; a mode 2 set gets no answer",
    "a re-pushed $WEAP,0 with a new clip resets the magazine, and the next spawn refills to the new clip":
        "TraceGun refills a spawn to its fixed spawn_ammo option, not to the last $WEAP's clip and t17",
}


def _norm(replies: list[str]) -> collections.Counter:
    return collections.Counter(f for f in replies if not f.startswith("$QUERY,"))


def _differs(case: dict) -> str | None:
    """The first step where TraceGun and FakeTagger disagree, or None."""
    gun = TraceGun(ALL_ON, [45, 70])
    for i, step in enumerate(case["steps"]):
        if "write" not in step:
            continue                      # a trigger pull is the gun's own act; TraceGun is fed it as a frame, not a write
        gun.wrote(step["write"])
        got = gun.take()
        if _norm(got) != _norm(step["replies"]):
            return f"step {i}: FakeTagger {step['replies']} TraceGun {got}"
    return None


def test_the_trace_gun_answers_every_modelled_write_as_ci_s_gun_does():
    bad = {c["name"]: d for c in DOC["cases"] if c["name"] not in KNOWN and (d := _differs(c))}
    assert not bad, "\n".join(f"{k}: {v}" for k, v in bad.items())


def test_every_known_difference_still_differs():
    names = {c["name"]: c for c in DOC["cases"]}
    missing = [n for n in KNOWN if n not in names]
    assert not missing, f"KNOWN names a case gun-replies.json no longer has: {missing}"
    fixed = [n for n in KNOWN if _differs(names[n]) is None]
    assert not fixed, f"these now agree, so drop them from KNOWN: {fixed}"


def test_the_weap_echo_takes_t40_as_the_bench_does():
    """F207 (bench 2026-09-16): the reserve a gun echoes for a `$WEAP` is t40 (index 41), else half of t17."""
    t = ["$WEAP", "0"] + [""] * 15 + ["32", "192"] + [""] * 22 + ["96"]
    gun = TraceGun(ALL_ON, [45, 70])
    gun.wrote([",".join(t) + ",*"])
    assert gun.take() == ["$ALCD,32,100,0,96,0,*"]
    gun.wrote([",".join(t[:41]) + ",*"])
    assert gun.take() == ["$ALCD,32,100,0,96,0,*"], "no t40: half of t17"
