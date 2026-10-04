"""Shared GunStage test fixtures: the fake clock, the stage builders, the IR/hill feeders and the
hill word constants. They used to live in `test_stage.py` and be imported by a dozen other test
modules; `test_helpers_lint.py` now fails if a test module imports another test module.
"""
from __future__ import annotations

import asyncio

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.mc.compile import Compiler
from brx_mcp.stage.stage import GunStage


BLUE_TO_RED = [                              # the enemy-to-enemy capture: NO mag 53 anywhere in the stream
    (291755, "$HIR,4,15,0,1,8,0,0,*"),       # blue (team 1) still holds it
    (292265, "$HIR,4,15,0,0,50,0,0,*"),      # mag 50: NEW OWNER = team 0 (red)
    (296835, "$HIR,4,15,0,0,8,0,0,*"),       # first hill beacon owned by RED
    (301845, "$HIR,4,15,0,0,8,0,0,*"),
]


CAPTURED = "$PLAY,,4,6,VB0N,,,,*"            # VB0N "Hill Captured"


LOST = "$PLAY,,4,6,VB0P,,,,*"                # VB0P "Hill Lost!"


class LegacyCompiler(Compiler):
    """A compiler whose bundle has no `respawn_profile`: the legacy spawn/revive path (an app < 0.4.3).
    Tests written against the legacy `spawn`/`revive` lists use it, as app/test/spawn-protect.test.mjs does.
    test_stage_respawn_profile.py covers the profile path."""

    def compile(self, *a, **kw):
        bundle = super().compile(*a, **kw)
        bundle.pop("respawn_profile", None)
        return bundle


# The VERBATIM $HIR streams read off the BLE link at the bench, docs/experiment-log/2026-09.md,
# "2026-09-10 (evening, cont.) -- CAPTURE PROVEN END TO END" and "... `mag=53` MEANS THE POINT WAS
# NEUTRAL", with the trailing `,*` the wire carries restored. `(t_ms, frame)`; t is the log's own clock.
NEUTRAL_TO_BLUE = [                          # gun on team 1 (blue), a NEUTRAL grenade, one AR round
    (41770, "$HIR,4,15,0,2,8,0,0,*"),        # last NEUTRAL beacon (a neutral point broadcasts team 2)
    (41820, "$HIR,4,15,0,1,50,0,0,*"),       # mag 50: NEW OWNER = team 1, 50 ms after the shot
    (46780, "$HIR,0,15,0,2,53,0,0,*"),       # mag 53, ~5 s LATER, on a DIFFERENT sensor: the state left was neutral (team 2)
    (46780, "$HIR,4,15,0,1,8,0,0,*"),        # first hill beacon owned by team 1
    (51720, "$HIR,4,15,0,1,8,0,0,*"),
    (56770, "$HIR,4,15,0,1,8,0,0,*"),
]


PLAYX = "$PLAYX,0,*"


TICK = "$PLAY,U100,4,6,,,,,*"                # U100 possession tick


class StageClock:
    """A hand-driven `now` in SECONDS. `at_ms()` places it on the bench log's own millisecond clock."""

    def __init__(self, t: float = 1000.0):
        self.t = float(t)
        self._base = None

    def __call__(self) -> float:
        return self.t

    def advance(self, dt_s: float) -> float:
        self.t += float(dt_s)
        return self.t

    def at_ms(self, t_ms: float) -> float:
        """Jump to a capture's timestamp, keeping the gaps BETWEEN frames exactly as they were measured."""
        if self._base is None:
            self._base = t_ms - self.t * 1000.0
        self.t = (t_ms - self._base) / 1000.0
        return self.t


async def _nosleep(_s):
    return None


async def feed(st, mgr, clock, frames, alias="stage"):
    """Play a captured `(t_ms, frame)` stream at its MEASURED timing, through the real rx path:
    record it on the session the way a BLE notification would, then let `poll()` drain and tick it."""
    for t_ms, raw in frames:
        clock.at_ms(t_ms)
        mgr.sessions[alias].record("rx", raw)
        st.poll()
        await settle(st)


def hill_audio(mgr, n) -> list[str]:
    """Just the hill lines out of the tx stream: the two callouts, the tick, and our own preempt."""
    return [f for f in since(mgr, n) if f in (CAPTURED, LOST, TICK, PLAYX)]


async def in_play(st):
    """Armed, spawned and alive, with everything the spawn burst wrote already drained and settled."""
    await st.connect("FA:KE:00:00:00:01")
    await st.arm()
    st.bundle["cues"]["countdown"] = ""       # these tests are about the hill, not the spawn countdown
    await st.spawn()
    await settle(st)
    st.poll()
    await settle(st)


def install_levels_readout(st, max_=6, **timing):
    """Patch the stage's already-compiled bundle with a synthetic 7-level `gun.readout` for `health`
    (and a fixed `rest` frame), so the drop/rise animation can be exercised on the bench harness before
    a real compiler ships `levels`. Returns the readout dict (mutate `["pools"]` to add more)."""
    readout = {"pools": [{"pool": "health", "max": max_, "levels": LEVELS7}],
               "hold_s": timing.get("hold_s", 2), "lead_ms": timing.get("lead_ms", 100),
               "blink_gap_ms": timing.get("blink_gap_ms", 200), "step_ms": timing.get("step_ms", 300),
               "blink_ms": timing.get("blink_ms", 400), "min_gap_ms": timing.get("min_gap_ms", 400)}
    st.bundle["gun"]["readout"] = readout
    st.bundle["gun"]["rest"] = "REST"
    return readout


def mark(mgr, alias="stage") -> int:
    return mgr.sessions[alias].seq


def mk_hill(tid: int = 1, **profile):
    """A stage with a driveable clock and a three-team roster. Returns (stage, mgr, clock)."""
    clock = StageClock()
    # the fake's delayed $ALCD replies must age on the SAME clock the test drives (F259 flaky class),
    # not the real wall clock -- see mk_reload/mk_stun/mk_gain in test_stage_mirror.py.
    mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1, clock=clock)])
    st = GunStage(mgr, None, sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    st.load_config({**st.config, "teams": [dict(t) for t in HILL_ROSTER]}, source="test")
    st.set_profile(tid=tid, **profile)
    assert st.profile["tid"] == tid, "the roster must actually carry the tid under test"
    return st, mgr, clock


async def run_clock(st, clock, seconds: float, step: float = 0.2) -> list[float]:
    """Advance the clock with NO frames arriving, polling at the stage server's own 0.2 s cadence --
    which is what proves the tick and the presence expiry do not need a frame to run. Returns the clock
    time of every possession tick heard, for `assert_cadence`."""
    out: list[float] = []
    end = clock.t + seconds
    while clock.t < end - 1e-9:
        clock.advance(min(step, end - clock.t))
        n = mark(mgr_of(st))
        st.poll()
        await settle(st)
        out += [clock.t for f in hill_audio(mgr_of(st), n) if f == TICK]
    return out


async def settle(st):
    idle_passes = 0
    for _ in range(20):
        await asyncio.sleep(0)
        pending = set(st._pending)
        if pending:
            idle_passes = 0
            await asyncio.gather(*pending, return_exceptions=True)
        else:
            idle_passes += 1
            if idle_passes == 2:
                return


def since(mgr, n, alias="stage") -> list[str]:
    return [e.raw for e in mgr.sessions[alias].buffer if e.seq > n and e.direction == "tx"]


def tid_follows_pset(frames, tid):
    """F206: the last `$PSET` of a write must be followed, LATER IN THE SAME WRITE, by `$TID,<tid>,*`.

    Later, not at the next index. F206 got fixed twice, independently, and the merge carries both cures:
    `compile.py` re-asserts `$TID` inside the spawn and revive bursts, right after `$SPAWN`, and
    `stage.write` -> `_tid_after_pset` inserts one when a write carries none at all. The burst's own
    `$TID` now sits behind the eleven disarmed `$SIR` rows the F209 twin puts in front of `$SPAWN`, so the
    `$PSET` and the `$TID` are no longer neighbours. The rule was always the ordering; the adjacency was a
    coincidence of the old frame order, and pinning it is what broke. A write with no `$PSET` passes.

    Callers that care about frame COST should also assert the count: exactly one `$TID` per write, because
    the two cures must never both fire (see `_tid_after_pset`, which declines when a `$TID` already
    follows the `$PSET`)."""
    last_pset = max((i for i, f in enumerate(frames) if f.startswith("$PSET,")), default=-1)
    return last_pset < 0 or f"$TID,{tid},*" in frames[last_pset + 1:]


def tx(mgr, alias="stage"):
    try:
        # every event, not the fake's default first 200: a long test (12 revives) ran past that cap once F206
        # added a $TID after each $PSET, and "the LAST write" silently became a write from the middle of the run
        return [e["raw"] for e in mgr.get_events(alias, max_events=10**6)["events"] if e["direction"] == "tx"]
    except KeyError:          # never connected
        return []


def mk_stage(legacy=False, **profile):
    mgr = FakeConnectionManager([FakeTagger("FA:KE:00:00:00:01", "FAKE-STAGE", team=1)])
    st = GunStage(mgr, None, compiler=LegacyCompiler() if legacy else None,
                  sleep=_nosleep, voice_verdict_sink=lambda _r: None)   # never read/write ~/.brx-mcp from a test
    if profile:
        st.set_profile(**profile)
    return st, mgr


def mk_spawn_stage():
    # 2026-09-19: this file is the LEGACY path (a bundle with no `respawn_profile`, an app < 0.4.3), as
    # app/test/spawn-protect.test.mjs is. test_stage_respawn_profile.py covers the profile path.
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    clock = StageClock()
    st = GunStage(mgr, None, compiler=LegacyCompiler(), sleep=_nosleep, now=clock, voice_verdict_sink=lambda _r: None)
    return st, mgr, clock


async def live_stage(st, clock):
    await st.connect(GUN)
    await st.arm(); await st.spawn(); await settle(st)
    return st


GUN = "FA:KE:00:00:00:01"


def mk_point(tid: int = 1, source: str | None = "phone", **profile):
    """A stage whose game names a PHONE as the objective source (the F70 gate lets the station path through)."""
    st, mgr, clock = mk_hill(tid=tid, **profile)
    st.set_profile(station_source=source)
    return st, mgr, clock


# The captured streams involve teams 0 (red), 1 (blue) and 2 (neutral/yellow), and `recompile()` snaps
# `profile["tid"]` to a tid the ROSTER actually has -- the stage's default tdm config is blue(1)+yellow(2),
# so asking for tid 0 on it would silently land back on 1 and quietly test the wrong listener.
HILL_ROSTER = [{"tid": 0, "team_id": "red", "name": "RED TEAM"},
               {"tid": 1, "team_id": "blue", "name": "BLUE TEAM"},
               {"tid": 2, "team_id": "yellow", "name": "YELLOW TEAM"}]


# The MC lane is landing `gun.readout.pools[].levels` separately (in parallel); until it ships for real,
# these frame strings ("L0".."L6", "L3b" the blink-off variant) stand in for real $GLED syntax so the
# tests read the ANIMATION'S ORDER, not the LED encoding -- `stage.py` never inspects frame contents,
# it only ever writes exactly what the bundle hands it (Node rules: "never compose a frame").
LEVELS7 = [["L0", None], ["L1", "L1b"], ["L2", None], ["L3", "L3b"], ["L4", None], ["L5", "L5b"], ["L6", None]]


def mgr_of(st):
    return st.mgr
