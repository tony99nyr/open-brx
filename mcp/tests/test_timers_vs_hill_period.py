"""F84 (2026-09-11): every host timer wider than the shortest ambient period on the wire is judged here.

Three bugs in one day had the same shape -- a constant WIDER than a hill's 5 s beacon period that reset
on a frame's ARRIVAL rather than on what the frame MEANT never fired once a hill was in play:
`ATTRIB_FUSE_S` 6 s kept hill-kill attribution fresh (F69), `regen_delay_s` 6 s never let regen start
(F84), and the driver's never-hit detector would have read a beacon as a hit. The rule is now a test:
every `*_S` / `*_MS` constant in `mcp/brx_mcp/` that is >= the beacon period must be listed below WITH
the reason it is safe, or this fails. A new objective that adds a timer has to write its sentence here.
"""
from __future__ import annotations

import pathlib
import re

from brx_mcp.modes import hillbeacon as hb

PKG = pathlib.Path(__file__).resolve().parents[1] / "brx_mcp"
PERIOD_S = hb.BEACON_PERIOD_S

# name -> why a 5 s emitter cannot keep it from firing (or why it is not a fuse at all)
JUDGED = {
    "OFFLINE_AFTER_MS": "node heartbeat age, fed by the phone's status cadence, not by any IR frame",
    "STALE_AFTER_MS": "same: a socket-liveness threshold on the status heartbeat",
    "SYNC_FRESH_MS": "clock-sync freshness on time_req/time_res, not on game frames",
    "HEADSET_LINK_PROOF_MS": "A32: how long a BLE link must hold before it proves a headset; measured from the "
                             "phone's own `preflight.gun_linked`, and reset only by that flag going false — no IR "
                             "frame of any kind reaches it",
    "LATE_ARM_GRACE_MS": "a one-shot window after go-live for a node to arm; nothing resets it",
    "CONFIG_TTL_MS": "how long a pushed config stays valid; nothing resets it",
    "RESYNC_PROBE_S": "the node's resync prompt cadence, driven by the operator's trigger pull",
    "DEFAULT_RUNWAY_S": "the countdown length, not a fuse",
    "PRUNE_AFTER_MS": "unbound-node record lifetime on the socket's silence",
    "HELLO_TIMEOUT_S": "grace for a hello after connect; a frame cannot reset it",
    "NEVER_HIT_AFTER_S": "the driver's unhittable-gun detector; `driver.py` excludes proto-15 beacons from `hits_taken` explicitly",
    "MIN_RECONNECT_S": "BLE reconnect rate limit, per gun, on link state",
    "ATTRIB_FUSE_S": "reset only by a shot with an identity: `shooter_team()` returns None for a beacon and for wire 0 (F69), pinned in test_modes.py",
    "PRESENCE_GRACE_S": "DESIGNED against the period: two missed beacons plus slack (rung R)",
    "CONFIRM_WINDOW_S": "designed against the period: a mag=53 confirms a capture within two cycles",
    "BEACON_PERIOD_S": "the period itself",
    "HILL_PRESENCE_S": "the stage's mirror of engine.js HILL_PRESENCE_MS -- the same two-missed-beacons rule",
    "HILL_CONTESTED_MIN_S": "the stage's mirror of engine.js HILL_CONTESTED_MIN_MS: a floor BETWEEN repeats of one line on the phone-station path; a beacon cannot reach it (F102)",
    "_STUN_DEFAULT_S": "F15: the EMP disarm length when config.stun names none; started by a proto-8 $HIR only, and the <15,0> beacon row (fn 28) never reaches the <8,0> cell",
    "_STUN_MAX_S": "F15: the validator's ceiling on config.stun.duration_s, not a timer that runs",
    "STUN_DEFAULT_S": "the stage's mirror of engine.js STUN_DEFAULT_S: same proto-8-only start as _STUN_DEFAULT_S; a beacon is proto 15 and cannot extend it",
    "_T_MIN_MS": "an envelope timestamp sanity bound, not a timer",
    "_T_MAX_MS": "an envelope timestamp sanity bound, not a timer",
    "REPLAY_PERIOD_MS": "the F77 detector's own window for a ~5 s replay; it MEASURES the period rather than resetting on it",
}

_CONST = re.compile(r"^\s*([A-Z_][A-Z0-9_]*_(S|MS))\s*(?::\s*[\w\[\], ]+)?\s*=\s*\(?\s*(-?\d[\d_.]*)", re.M)


def _seconds(name: str, value: str) -> float:
    v = float(value.replace("_", ""))
    return v / 1000 if name.endswith("_MS") else v


def test_every_timer_at_or_above_the_hill_period_has_been_judged():
    unjudged = []
    for f in sorted(PKG.rglob("*.py")):
        if "tools" in f.parts or "tests" in f.parts:
            continue
        for m in _CONST.finditer(f.read_text(encoding="utf-8")):
            name, _, raw = m.group(1), m.group(2), m.group(3)
            if _seconds(name, raw) >= PERIOD_S and name not in JUDGED:
                unjudged.append(f"{f.relative_to(PKG)}:{name}={raw}")
    assert not unjudged, ("F84: these timers are wider than the 5 s hill period and nobody has written down why a "
                          "beacon cannot keep them from firing -- add each to JUDGED with its reason: " + ", ".join(unjudged))


def test_the_judged_list_names_real_constants_only():
    """A stale entry (a constant that was renamed or deleted) would let a new one slip in under the old name."""
    found = set()
    for f in PKG.rglob("*.py"):
        if "tools" in f.parts:
            continue
        found |= {m.group(1) for m in _CONST.finditer(f.read_text(encoding="utf-8"))}
    stale = sorted(set(JUDGED) - found)
    assert not stale, f"JUDGED names constants that no longer exist: {stale}"


def test_the_two_fixed_fuses_stay_fixed_against_a_hill():
    """The two that bit, re-asserted through their engines rather than by reading the code."""
    from brx_mcp.gameconfig import GameConfig
    from brx_mcp.modes import build_engine
    from brx_mcp.protocol import parse_event
    hill = parse_event("$HIR,0,0,0,1,8,0,0,*")          # the hill's ambient damage word (wire 0, team 1)
    beacon = parse_event("$HIR,0,15,0,1,8,0,0,*")       # the beacon itself
    e = build_engine(GameConfig(mode="tdm", regen=1, regen_delay_s=6.0))
    e.add_player("a", 0); e.add_player("b", 1)
    # 60 s of standing in a hill: beacons and chip damage every 5 s, and then a death
    for i in range(12):
        e.on_event("a", beacon, now=i * 5.0)
        e.on_event("a", hill, now=i * 5.0 + 0.01)
    acts = e.on_event("a", parse_event("$HP,0,0,0,*"), now=61.0)
    from brx_mcp.modes import Score
    assert not any(isinstance(x, Score) and getattr(x, "team", None) == 1 for x in acts), \
        "a hill's kill was credited to its owning team (the ATTRIB_FUSE_S shape)"
