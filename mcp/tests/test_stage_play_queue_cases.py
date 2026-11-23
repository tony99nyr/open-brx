"""The bench stage's play path against the phone's play queue (app/src/play-queue.js), as data: each case of
app/test/fixtures/play-queue-cases.json runs through `GunStage.write` on a hand-driven clock, and the stage must send
what the phone sends, when the phone sends it. Every plan the stage makes for a group that waits (`_plan_send`, the
`sendAt` mirror) must be the phone's plan for that job (F498, F681 review).

The case file's header says how a case runs. The stage side: a write is `GunStage.write` (`life`, `settle_rows`), a hit
is a clip added to the stage's gun audio model, a hold moves `_play_hold_until` (a stun-expiry stop), a cancel is `_cancel_pending_play_writes` (the stage's death path). The
stage's sleeps resolve on the case clock, due timers first, then the events at that time, as the phone's runner does.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from brx_mcp.fake import FakeConnectionManager, FakeTagger
from brx_mcp.stage import stage as S
from brx_mcp.stage.stage import GunStage
from _stage import GUN, StageClock, settle

FIXTURE = json.loads((Path(__file__).resolve().parents[2] / "app/test/fixtures/play-queue-cases.json").read_text())

# Cases the stage does not run, and why. A case leaves this list when the stage learns its rule.
SKIP = {
    # The stage has no must-hear write path (`_take_play_turn`: "job.mustHear has no stage write path here").
    "F419: a must-hear line does not wait for the gun": "must-hear",
    "F419: a must-hear line drops the cues still on the phone, but never a life burst": "must-hear",
}
CASE_T0 = 1000.0   # the stage's clock at case time 0, in seconds


class _Timers:
    """The stage's `sleep` on the case clock: a sleep resolves when the runner reaches its end (whole ms)."""

    def __init__(self, clock: StageClock) -> None:
        self.clock = clock
        self.on = False
        self.waiting: list[tuple[int, int, asyncio.Future]] = []
        self.n = 0

    async def sleep(self, s: float) -> None:
        if not self.on or s <= 0:
            return
        fut = asyncio.get_running_loop().create_future()
        self.waiting.append((round((self.clock() + s) * 1000), self.n, fut))
        self.n += 1
        await fut

    def next_ms(self) -> float:
        return min((w[0] for w in self.waiting), default=float("inf"))

    def fire(self) -> bool:
        now = round(self.clock() * 1000)
        due = sorted(w for w in self.waiting if w[0] <= now)
        for w in due:
            self.waiting.remove(w)
            if not w[2].done():
                w[2].set_result(None)
        return bool(due)


def _ms(clock: StageClock) -> int:
    return round((clock() - CASE_T0) * 1000)


def _name(why: str, frames: list[str]) -> str:
    play = next((f for f in frames if f.startswith("$PLAY,")), None)
    return f"{why}:{S._cue_id(play) if play else '-'}"


async def run_case(case: dict) -> tuple[list[dict], dict[str, tuple[int, int]]]:
    """The stage's sends ({t, frames}) and its plans ({job: (first seen at, planned)}) for one case."""
    clock = StageClock(CASE_T0)
    timers = _Timers(clock)
    mgr = FakeConnectionManager([FakeTagger(GUN, "FAKE-STAGE", team=1)])
    st = GunStage(mgr, None, sleep=timers.sleep, now=clock, voice_verdict_sink=lambda _r: None)
    await st.connect(GUN)
    await settle(st)
    clips = FIXTURE["clip_ms"]
    st._audio_clip_ms = lambda f: clips.get(S._cue_id(f) or "", 0)   # type: ignore[method-assign]
    st._gun_audio.clear()
    st._last_play_at = st._last_play_sent_at = None
    st._play_hold_until = 0.0
    for g in case.get("gun") or []:
        st._gun_audio.add(g["ms"], "on the gun", st._now_ms(), g["id"])
    sends: list[dict] = []
    send = st._send

    async def record(frames, gap_ms, on_start=None):
        sends.append({"t": _ms(clock), "frames": list(frames)})
        return await send(frames, gap_ms, on_start=on_start)
    st._send = record   # type: ignore[method-assign]
    plans: dict[str, tuple[int, int]] = {}

    async def step() -> None:
        for _ in range(60):   # not `settle`: it awaits the stage's tasks, and a write that sleeps on the case clock waits for us
            await asyncio.sleep(0)
        for e in list(st._play_entries):
            # a `settle_rows` entry that has not sent its rows plans them: the phone's rows job, `why:-`
            name = f"{e.why}:-" if e.settle else _name(e.why, e.frames)
            if e.state in ("queued", "wait") and name not in plans:
                at = st._plan_send(e, clock())
                if at is not None:
                    plans[name] = (_ms(clock), round((at - CASE_T0) * 1000))

    timers.on = True
    events = list(case["events"])
    while True:
        t_next, e_next = timers.next_ms() - round(CASE_T0 * 1000), events[0]["t"] if events else float("inf")
        if t_next == float("inf") and e_next == float("inf"):
            break
        if t_next <= e_next:
            clock.t = CASE_T0 + t_next / 1000
            timers.fire()
            await step()
            continue
        e = events.pop(0)
        clock.t = CASE_T0 + e["t"] / 1000
        if "write" in e:
            st._spawn_task(st.write(list(e["write"]), e["why"], life=bool(e.get("life")),
                                    settle_rows=bool(e.get("settle_rows"))))
        elif "hit" in e:
            st._gun_audio.add(e["hit"]["ms"], f"hit sound {e['hit']['id']}", st._now_ms(), e["hit"]["id"])
        elif e.get("cancel"):
            st._cancel_pending_play_writes()
        elif "hold" in e:
            st._play_hold_until = max(st._play_hold_until, CASE_T0 + e["hold"] / 1000)
        else:
            raise AssertionError(f"{case['name']}: unknown event {e}")
        await step()
    return sends, plans


def _check(case: dict) -> None:
    sends, plans = asyncio.run(run_case(case))
    want = [{"t": s["t"], "frames": s["frames"]} for s in case["expect"]["sends"]]
    assert sends == want, f"{case['name']}: the stage sent\n  {sends}\nthe phone sent\n  {want}"
    for job in case["expect"]["jobs"]:
        seen = plans.get(job["job"])
        if seen is None or job["planned"] is None or seen[0] != job["queued_t"]:
            continue   # the stage saw it wait at another time (it splits a write as it sends it), or it went at once
        assert seen[1] == job["planned"], f"{case['name']}: {job['job']} planned for {seen[1]}, the phone {job['planned']}"


def test_the_stage_runs_every_case_it_can():
    names = {c["name"] for c in FIXTURE["cases"]}
    assert set(SKIP) <= names, f"a skipped case is gone from the file: {set(SKIP) - names}"
    ran = 0
    for case in FIXTURE["cases"]:
        if case["name"] in SKIP:
            continue
        _check(case)
        ran += 1
    assert ran >= len(FIXTURE["cases"]) - len(SKIP)


def test_f681_review_the_stage_plans_a_life_burst_as_the_phone_does():
    """The F681 review cases: a life burst behind a stun's settle (and its gap), behind a cue that waits for the stun clip, and after
    a death that cancels the clip. Each plan is checked, and so is each send."""
    cases = [c for c in FIXTURE["cases"] if c["name"].startswith("F681 review")]
    assert len(cases) == 4, [c["name"] for c in cases]
    for case in cases:
        _, plans = asyncio.run(run_case(case))
        life = next(j for j in case["expect"]["jobs"] if j["job"].startswith("revive:"))
        assert plans.get(life["job"]) == (life["queued_t"], life["planned"]), (case["name"], plans, life)
        _check(case)


if __name__ == "__main__":
    test_the_stage_runs_every_case_it_can()
    test_f681_review_the_stage_plans_a_life_burst_as_the_phone_does()
    print("ok")
