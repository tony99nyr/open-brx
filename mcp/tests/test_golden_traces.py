"""Golden traces (architecture item #6): the bench stage (GunStage) replays the SAME trace files the phone engine
recorded (app/test/fixtures/traces/, format in that folder's README.md) and must produce the same gun writes and
the same state at every checkpoint.

The stage exists to PREDICT the phone (stage.py's own docstring; seven of nine defects in one night were a
stage/phone divergence). test_stage_mirror.py pins pieces of it by hand; this pins whole sequences against the
engine's recorded output. The golden is the ENGINE's output: `node app/tools/record-traces.mjs` writes it, and this
file never re-records.

Only the traces that list `stage` in `runners` run here. A trace says what the stage does not model in its
`stage_ignores` list, one entry per field or write class with a reason, so a gap is visible and never silent:
  - `{"what": "state.<field>"}`: that state field is not compared;
  - `{"what": "write:<prefix>"}`: writes starting with that prefix are dropped from BOTH sides before comparing
    (any entry may carry `"at": "<checkpoint>"` to apply at that one checkpoint only);
  - `{"what": "checkpoint:<label>:writes"}`: that checkpoint's writes are not compared (its state still is);
  - `{"what": "trace"}`: the whole trace is engine-only (its `runners` then lacks `stage`).
A reason that starts `DIVERGENCE:` is a real engine-vs-stage difference this trace exposed and nobody has fixed.
A field the stage cannot produce and the trace does not ignore FAILS, naming the field, and an entry the stage no
longer needs FAILS too, so a closed gap cannot stay hidden.

The preamble differs on purpose: the engine reaches the match through MC's assign/config/start messages, the stage
through its own ARM and SPAWN buttons. So `mc` steps are skipped here, and the checkpoint marked `preamble` compares
state only, and it must be the FIRST checkpoint. Every step after it is replayed identically.

Limits of what this compares (read them before trusting a green run):
  - The stage has no auto-respawn timer (its revive is the operator's button). The runner presses `revive()` at the
    engine's `respawn.delay_s`, so a revive trace checks the revive EFFECTS only. The operator path itself is tested
    in test_stage.py `test_down_writes_nothing_at_death_one_rearm_insurance_then_stops_before_revive` and
    test_stage_cure.py `test_fake_dead_gun_life_probe_reading_is_switchable_and_a_real_revive_still_works`.
  - An `mc` `end` step presses the stage's GAME END (`game_end()`); every other `mc` step is skipped.
  - `phase`, `deaths` and `moment` are never compared (the stage has no match phase, death count or HUD moment slot).
  - The stage runs on an instant `sleep`, so held writes (the low-health line, flash holds, a `$PLAY` waiting for the
    gun) land at other checkpoints. Each one is a per-write `stage_ignores` entry; the holds themselves are pinned on a
    clock-driven `sleep` in test_stage_hp_mirror.py. A trace with `setup.stage_sleep: "clock"` runs the stage's
    `sleep` on the trace clock after the preamble instead (`_ClockSleep`), and its holds then land where the engine's do. Two hp traces compare no writes at one checkpoint (a
    `checkpoint:<label>:writes` entry): hp-armour-spill and hp-solicited. Twenty hp traces also drop every `$GLED`
    readout write from both sides, so the stage's readout frames are NOT compared there.
  - A trace with no `countdown_s` is a LATE start on the engine (no `_preArmTable`), so the stage's SPAWN takes the late
    path too (`spawn(pre_arm=False)`, F479).

The engine recording also holds the facts and reports MC hears (`emit`/`report`). They are never compared here:
GunStage has no MC link, so it emits neither (the engine test compares them).
"""
from __future__ import annotations

import asyncio
import copy
import json
import pathlib
import re

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.mc.compile import Compiler
from brx_mcp.stage.stage import PROBE_LIFE, GunStage
from test_stage import _Clock, settle

ROOT = pathlib.Path(__file__).resolve().parents[2]
TRACE_DIR = ROOT / "app" / "test" / "fixtures" / "traces"
GOLDEN = json.loads((ROOT / "mcp" / "brx_mcp" / "mc" / "golden_bundle.json").read_text())
BASE = json.loads((TRACE_DIR / "_base.json").read_text())
GUN = "FA:KE:00:00:00:01"


def trace_names() -> list[str]:
    return sorted(p.stem for p in TRACE_DIR.glob("*.json") if not p.name.startswith("_"))


def load(name: str) -> dict:
    return json.loads((TRACE_DIR / f"{name}.json").read_text())


# ---- the inputs, built exactly as app/test/golden-trace-runner.mjs builds them -----------------------------------

def build_frames(setup: dict) -> dict:
    f = {**copy.deepcopy(GOLDEN), "player_id": BASE["player"]["player_id"], **copy.deepcopy(setup.get("frames") or {})}
    p = setup.get("frames_patch") or {}
    if p.get("head_append"):
        f["head"] = [*f["head"], *p["head_append"]]
    if p.get("after_last_ammo"):
        def add(lst):
            idx = [i for i, x in enumerate(lst) if x.startswith("$AMMO,")]
            return lst if not idx else [*lst[:idx[-1] + 1], *p["after_last_ammo"], *lst[idx[-1] + 1:]]
        f["spawn"] = add(f["spawn"]); f["revive"] = add(f["revive"])
        if f.get("respawn_profile"):
            rp = f["respawn_profile"]
            f["respawn_profile"] = {**rp, "spawn": add(rp["spawn"]), "revive": add(rp["revive"]), "revive_station": add(rp["revive_station"])}
    for k in p.get("drop") or []:
        f.pop(k, None)
    return f


def build_config(setup: dict) -> dict:
    return {**copy.deepcopy(BASE["config"]), **copy.deepcopy(setup.get("config") or {})}


def head_maxima(frames: dict) -> list[int]:
    p = next((f for f in frames.get("head") or [] if f.startswith("$PSET,")), None)
    if not p:
        return [45, 70, 0]
    t = p.split(",")
    return [int(t[3] or 0), int(t[4] or 0), int(t[5] or 0)]


def _num(tok: str) -> int:
    """JavaScript's `+tok`: an empty token (a `$HP` that omits the shield) reads as 0, as in the engine runner."""
    return int(tok) if tok.strip() else 0


class TraceGun:
    """golden-trace-runner.mjs `TraceGun`, rule for rule (the README states the rules once)."""

    def __init__(self, opts: dict | None, maxima: list[int]):
        self.o = {"spawn": True, "probe": True, "life": False, "ammo": False, "alcd_echo": False, "spawn_ammo": [32, 192], **(opts or {})}
        self.maxima = maxima
        self.spawned = False; self.answer = True
        self.hp = self.armor = self.shield = 0
        self.slot = self.mag = self.reserve = 0
        self.replies: list[str] = []

    def pools(self) -> str:
        return f"{self.hp},{self.armor},{self.shield}"

    def wrote(self, frames: list[str]) -> None:
        for f in frames:
            t = f.split(",")
            if t[0] == "$SPAWN" and self.o["spawn"]:
                self.hp, self.armor = self.maxima[0], self.maxima[1]; self.shield = 0; self.spawned = True; self.slot = 0
                self.mag, self.reserve = self.o["spawn_ammo"]
                self.replies.append(f"$LCD,{self.pools()},{self.slot},{self.mag},{self.reserve},*")
            elif f == PROBE_LIFE:
                if self.o["probe"] and self.answer:
                    self.replies.append(f"$HP,{self.pools()},*")
            elif f == "$QUERY,*":
                if self.o["probe"] and self.answer:
                    self.replies.append(f"$LCD,{self.pools()},{self.slot},{self.mag},{self.reserve},*")
            elif t[0] == "$LIFE" and self.o["life"] and re.fullmatch(r"\$LIFE,-?\d+,-?\d+,-?\d+,\*", f):
                dh, da, ds = (int(x) for x in t[1:4])
                self.hp = max(0, min(self.maxima[0], self.hp + dh)); self.armor = max(0, min(self.maxima[1], self.armor + da))
                self.shield = max(0, self.shield + ds)
                self.replies.append(f"$LCD,0,0,0,{self.slot},{self.mag},{self.reserve},*" if self.hp == 0 else f"$HP,{self.pools()},*")
            elif t[0] == "$AMMO":
                if self.o["ammo"] and int(t[1]) == self.slot:
                    self.mag, self.reserve = int(t[2]), int(t[3])
                if self.o["alcd_echo"]:
                    self.replies.append(f"$ALCD,{t[2]},100,{t[1]},{t[3]},0,*")
            elif t[0] == "$WEAP" and self.o["alcd_echo"]:
                self.replies.append(f"$ALCD,{(t[17] if len(t) > 17 else '') or 0},100,{t[1]},{(t[18] if len(t) > 18 else '') or 0},0,*")

    def heard(self, f: str) -> None:
        t = f.split(",")
        if t[0] == "$HP" and len(t) >= 4:
            self.hp, self.armor, self.shield = _num(t[1]), _num(t[2]), _num(t[3])
        elif t[0] == "$LCD" and len(t) >= 7 and t[1] != "":
            self.hp, self.armor, self.shield = _num(t[1]), _num(t[2]), _num(t[3])

    def take(self) -> list[str]:
        r, self.replies = self.replies, []
        return r


class _SilentTagger(FakeTagger):
    """A fake gun that says nothing on its own: every reply comes from the trace's `TraceGun`, the same rules the
    engine runner uses, so both runners hear the same gun."""

    def __init__(self, gun: TraceGun, **kw):
        super().__init__(GUN, "FAKE-STAGE", **kw)
        self.gun = gun

    def write(self, frame: str) -> None:
        self.gun.wrote([frame])

    def drain(self) -> list[str]:
        return []


class _TraceCompiler(Compiler):
    """Every compile the stage asks for (ARM re-compiles) returns the trace's own bundle, so the stage plays the
    frames the engine was given and not a bundle of its own."""

    def __init__(self, frames: dict):
        super().__init__()
        self._frames = frames

    def compile(self, *_a, **_kw):
        return copy.deepcopy(self._frames)


class _ZeroRng:
    """engine.js `rng: () => 0`: every pool pick takes index 0."""

    def choice(self, seq):
        return seq[0]

    def randrange(self, n, *_a):
        return 0

    def random(self):
        return 0.0


# ---- the state fields, named as golden-trace-runner.mjs `FIELDS` names them ---------------------------------------

def _poison(st):
    p = st.poison
    return {"ticks": p["ticks"], "perTick": p["per"]} if p else None


def _hill(st):
    h = st.hill
    return {"owner": h["owner"], "contested": bool(h.get("contested")), "progress": h.get("progress")} if h else None


FIELDS = {
    "alive": lambda st: bool(st.alive),
    "spawned": lambda st: bool(st.spawned),
    "hp": lambda st: st.hp, "armor": lambda st: st.armor, "shield": lambda st: st.shield,
    "activeSlot": lambda st: st.active_slot,
    "ammo": lambda st: st.ammo, "reserve": lambda st: st.reserve,
    "switching": lambda st: st.switching is not None,
    "reloading": lambda st: st._reloading_view() is not None,
    "poison": _poison,
    "hill": _hill,
}


class Unsupported(Exception):
    pass


class _ClockSleep:
    """The stage's `sleep` on the trace clock, for a trace that sets `setup.stage_sleep: "clock"`: a sleep resolves at
    the first runner sub-step at or past its end (whole ms), as engine.js's `delay` does on the runner's timers. Off
    (instant) while `on` is False: the preamble, and every other trace."""

    def __init__(self, clock):
        self.clock = clock
        self.on = False
        self.waiting: list = []

    async def sleep(self, s: float) -> None:
        if not self.on or s <= 0:
            return
        fut = asyncio.get_running_loop().create_future()
        self.waiting.append((round((self.clock.t + s) * 1000), fut))
        await fut

    def fire(self) -> None:
        now = round(self.clock.t * 1000)
        for w in sorted([w for w in self.waiting if w[0] <= now], key=lambda w: w[0]):
            self.waiting.remove(w)
            if not w[1].done():
                w[1].set_result(None)


async def _yield(n: int = 60) -> None:
    for _ in range(n):
        await asyncio.sleep(0)


async def _press(st, coro, sched) -> None:
    """A stage button the runner presses. On the trace clock it runs as a task (its own holds wait for later sub-steps)."""
    if sched.on:
        st._spawn_task(coro)
        await _yield()
    else:
        await coro


async def run_stage(trace: dict) -> list[dict]:
    setup = trace.get("setup") or {}
    frames = build_frames(setup)
    gun = TraceGun(setup.get("gun"), head_maxima(frames))
    clock = _Clock(BASE["clock0_ms"] / 1000)
    mgr = FakeConnectionManager([_SilentTagger(gun, clock=clock)])
    sched = _ClockSleep(clock)   # `setup.stage_sleep: "clock"`: the stage's holds run on the trace clock (off in the preamble)
    st = GunStage(mgr, None, compiler=_TraceCompiler(frames), sleep=sched.sleep, now=clock,
                  voice_verdict_sink=lambda _r: None, rng=_ZeroRng())   # type: ignore[arg-type]
    st.load_config(build_config(setup), source="golden trace")
    await st.connect(GUN)
    s = mgr.sessions["stage"]

    async def stl(st):
        if sched.on:
            await _yield()   # a hold waits on the clock here: `settle` would wait for it for ever
        else:
            await settle(st)

    async def feed(f: str) -> None:
        gun.heard(f)
        s.record("rx", f)
        st.poll()
        await stl(st)

    async def flush() -> None:
        for _ in range(20):   # an answer can cause a write, whose answer is fed too (bounded, as in the engine runner)
            rs = gun.take()
            if not rs:
                return
            for r in rs:
                await feed(r)

    # the stage's own path to a live gun (the engine's is MC's start; see the module docstring)
    await st.arm()
    # F479: a trace with no countdown is a LATE start on the engine (go-live before PRE_ARM_TABLE_MS, so no `_preArmTable`);
    # the stage's SPAWN takes the same late path, the live table riding in front of `$SPAWN`.
    await st.spawn(pre_arm=bool(setup.get("countdown_s")))
    await stl(st)
    await flush()
    st.poll(); await stl(st)

    sched.on = setup.get("stage_sleep") == "clock"
    out: list[dict] = []
    mark = s.seq
    step_s = (setup.get("tick_ms") or 250) / 1000
    cfg_respawn = (build_config(setup).get("respawn") or {})
    auto_respawn = cfg_respawn.get("type") == "auto"
    respawn_s = max(3.0, cfg_respawn.get("delay_s") or 10)   # engine.js `respawnDelayMs`
    dead_at = None
    for i, step in enumerate(trace.get("steps") or []):
        if "frame" in step or "frames" in step:
            for f in step.get("frames") or [step["frame"]]:
                await feed(f)
            if st.alive:
                dead_at = None
            elif st.spawned and dead_at is None:
                dead_at = clock.t   # the engine's `deadAt` is the moment the death frame landed
        elif "advance_ms" in step:
            end = clock.t + step["advance_ms"] / 1000
            while clock.t < end - 1e-9:
                clock.advance(min(step_s, end - clock.t))
                sched.fire()
                await flush()
                st.poll(); await stl(st)
                await flush()
                # engine.js `tick()`: an `auto` respawn revives the player once `respawn.delay_s` (at least
                # MIN_RESPAWN_S) has passed. The stage has no such timer (its revive is the operator's button, a
                # KNOWN_UNMIRRORED policy), so the harness presses it at the engine's moment.
                if st.alive:
                    dead_at = None
                elif st.spawned:
                    dead_at = clock.t if dead_at is None else dead_at
                    if auto_respawn and clock.t - dead_at >= respawn_s - 1e-9:
                        await _press(st, st.revive(), sched); await stl(st); await flush(); st.poll(); await stl(st)
                        dead_at = None
        elif "stations" in step:
            if not step["stations"]:
                st.station_stop()
            for e in step["stations"]:
                if e.get("kind") != "control":
                    raise Unsupported(f"step {i}: the stage models control stations only, not {e.get('kind')!r}")
                team = e.get("team", 255)
                st.station_advert(id=e["id"], team=None if team == 255 else team, flags=e.get("state", 0),
                                  value=e.get("value", 0), present=e.get("present", (e.get("median", -50)) >= -74))
            await stl(st)
        elif "mc" in step:
            # MC messages: the stage has no MC link (the preamble's are covered by ARM and SPAWN). The one a trace
            # checks the effect of is the match `end`, which the stage's own END button does.
            if step["mc"].get("kind") == "control" and (step["mc"].get("body") or {}).get("cmd") == "end":
                await _press(st, st.game_end(), sched)   # the whistle: the game_over cue, then the end frames (engine.js `rc.end`)
        elif "gun" in step:
            for k, v in step["gun"].items():
                setattr(gun, k, v)
        elif "check" in step:
            await stl(st)
            writes = [e.raw for e in s.buffer if e.seq > mark and e.direction == "tx"]
            mark = s.seq
            if step.get("preamble") and out:
                raise Unsupported(f"step {i}: `preamble` is allowed on the first checkpoint only (a later one would hide its writes)")
            out.append({"at": step["check"], "step": i, "preamble": bool(step.get("preamble")), "writes": writes, "st": st})
            out[-1]["state"] = {k: (FIELDS[k](st) if k in FIELDS else _NoField(k)) for k in _fields(trace)}
        else:
            raise Unsupported(f"step {i}: the stage runner has no {sorted(step)} step")
        if "check" not in step:
            await stl(st)
            await flush()   # a real gun answers within a BLE round trip, before the next step
    return out


class _NoField:
    def __init__(self, k):
        self.k = k

    def __repr__(self):
        return f"<the stage does not model {self.k}>"


def _fields(trace: dict) -> list[str]:
    return ["phase", "alive", "spawned", "hp", "armor", "shield", "activeSlot", "ammo", "reserve", "deaths",
            *((trace.get("setup") or {}).get("fields") or [])]


def compare(trace: dict, got: list[dict]) -> str | None:
    """The first difference between the stage's replay and the engine's recorded `expect`, or None."""
    entries = trace.get("stage_ignores") or []
    def ignored(what: str, at: str) -> bool:
        return any(i["what"] == what and i.get("at", at) == at for i in entries)

    def keep(ws: list[str], at: str) -> list[str]:
        """Drop the writes an ignore names, everywhere or (with `at`) at that one checkpoint only."""
        pre = tuple(i["what"][len("write:"):] for i in entries
                    if i["what"].startswith("write:") and i.get("at", at) == at)
        return [w for w in ws if not (pre and w.startswith(pre))]

    exp = trace["expect"]
    if len(exp) != len(got):
        return f"checkpoint count: expected {len(exp)}, got {len(got)}"
    for e, g in zip(exp, got):
        where = f'checkpoint "{e["at"]}" (step {g["step"]})'
        if e["at"] != g["at"]:
            return f"{where}: label {g['at']!r} != {e['at']!r}"
        for k, v in e["state"].items():
            if ignored(f"state.{k}", e["at"]):
                continue
            gv = g["state"].get(k)
            if isinstance(gv, _NoField):
                return f"{where}: the stage does not model state.{k}; add it to stage_ignores with a reason"
            if json.dumps(gv) != json.dumps(v):
                return f"{where}: state.{k} expected {json.dumps(v)} (engine), stage has {json.dumps(gv)}"
        if g["preamble"] or ignored(f"checkpoint:{e['at']}:writes", e["at"]):
            continue
        ew, gw = keep(e["writes"], e["at"]), keep(g["writes"], e["at"])
        for j in range(max(len(ew), len(gw))):
            a = ew[j] if j < len(ew) else None
            b = gw[j] if j < len(gw) else None
            if a != b:
                return (f"{where}: write #{j} differs\n  engine: {a or '(none)'}\n  stage:  {b or '(none)'}\n"
                        f"  engine writes: {ew}\n  stage writes:  {gw}")
    return None


STAGE_TRACES = [n for n in trace_names() if "stage" in load(n).get("runners", [])]


def test_the_stage_runs_at_least_the_traces_it_models():
    """The starter set (item #6) names five stage-runnable behaviours: self-hit, poison, ALT, ALT mid-reload, hill."""
    assert len(STAGE_TRACES) >= 5, STAGE_TRACES
    for n in trace_names():
        t = load(n)
        for ig in t.get("stage_ignores") or []:
            assert ig.get("what") and len(ig.get("why", "")) > 10, (n, ig)
        assert t.get("expect"), f"{n} has no recorded expect: cd app && node tools/record-traces.mjs {n}"


def stage_problems(name: str) -> list[str]:
    """Everything wrong with one trace on the stage: the first divergence, or each stage_ignores entry it no longer needs."""
    trace = load(name)
    got = asyncio.run(run_stage(trace))
    diff = compare(trace, got)
    if diff is not None:
        return [f"{name}: the stage diverged from the engine's golden trace.\n{diff}\n"
                "Fix the stage, or record the gap in the trace's stage_ignores (prefix DIVERGENCE: when it is a real difference)."]
    # Every ignore must still be NEEDED: a gap someone closed must not stay hidden behind a stale entry.
    entries = trace.get("stage_ignores") or []
    return [f"{name}: stage_ignores entry {e['what']!r}{' at ' + e['at'] if 'at' in e else ''} is no longer needed "
            "(the stage matches without it): remove it from the trace"
            for i, e in enumerate(entries) if compare({**trace, "stage_ignores": entries[:i] + entries[i + 1:]}, got) is None]


def test_the_stage_matches_the_engines_golden_traces():
    """One test over every stage trace (run_tests.py calls test functions bare, so no pytest parametrize). Each trace
    is replayed in full and every problem is reported, not just the first trace's."""
    problems = [p for name in STAGE_TRACES for p in stage_problems(name)]
    assert not problems, "\n\n".join(problems)
