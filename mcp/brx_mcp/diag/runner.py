"""The diagnostic-game runner: drives cases against a live tagger and scores them.

The BLE plumbing is thin; all judgement lives in the pure predicates (model.py).
Human-verified cases print a prompt and read y/n from stdin (when a person runs it),
or accept an injected answer callback (when Claude/automation drives it).
"""

from __future__ import annotations

import asyncio
import time
from typing import Callable, Optional

from .model import Capability, DiagCase, Outcome, Report, Result


# An "asker" turns a yes/no question into a bool. Default = stdin prompt.
Asker = Callable[[str], bool]


def _stdin_asker(question: str) -> bool:
    try:
        ans = input(f"    ❓ {question} [y/N] ").strip().lower()
    except EOFError:
        return False
    return ans in ("y", "yes")


async def run_case(mgr, sid: str, case: DiagCase, available: set[Capability],
                   asker: Asker, parse_event) -> Result:
    """Run one case against session `sid` of ConnectionManager `mgr`."""
    missing = [c.value for c in case.requires if c not in available]
    if missing:
        return Result(case.id, case.name, case.category, Outcome.SKIP,
                      detail=f"needs {', '.join(missing)}")

    try:
        # setup frames (unmeasured)
        for f in case.setup:
            await mgr.send(sid, f, reply_window_ms=250)

        if case.prompt_before:
            print(f"    👉 {case.prompt_before}")

        last = mgr.sessions[sid].seq
        for f in case.frames:
            await mgr.send(sid, f, reply_window_ms=250)
        last = mgr.sessions[sid].seq if not case.frames else last

        # collect rx events across the window
        events: list[dict] = []
        end = time.monotonic() + case.window_ms / 1000
        while time.monotonic() < end:
            await asyncio.sleep(0.15)
            for ev in mgr.get_events(sid, since_seq=last)["events"]:
                last = ev["seq"]
                if ev["direction"] == "rx":
                    p = parse_event(ev["raw"])
                    p["raw"] = ev["raw"]
                    events.append(p)

        evidence = [e["raw"] for e in events][-12:]

        # verification
        if case.verify is not None:
            passed, detail = case.verify(events)
            return Result(case.id, case.name, case.category,
                          Outcome.PASS if passed else Outcome.FAIL,
                          detail=detail, evidence=evidence)
        if case.ask_after:
            passed = asker(case.ask_after)
            return Result(case.id, case.name, case.category,
                          Outcome.PASS if passed else Outcome.FAIL,
                          detail="(human-confirmed)" if passed else "(human said no)",
                          evidence=evidence)
        # no verify + no question → informational only
        return Result(case.id, case.name, case.category, Outcome.MANUAL,
                      detail="ran; no auto check", evidence=evidence)
    except Exception as e:  # noqa: BLE001 — one bad case shouldn't kill the run
        return Result(case.id, case.name, case.category, Outcome.ERROR,
                      detail=f"{type(e).__name__}: {e}")


async def run_game(address: str, cases: list[DiagCase], available: set[Capability],
                   asker: Optional[Asker] = None) -> Report:
    """Connect, run the catalog, tear down, return the scored Report."""
    from ..ble import ConnectionManager
    from ..protocol import parse_event

    asker = asker or _stdin_asker
    mgr = ConnectionManager()
    report = Report(target=address)
    sid = "diag"
    print(f"connecting {address} for the diagnostic game ...")
    await mgr.connect(address, sid)
    try:
        for case in cases:
            print(f"\n▶ [{case.category}] {case.name}")
            r = await run_case(mgr, sid, case, available, asker, parse_event)
            icon = {"pass": "✅", "fail": "❌", "skip": "⏭️", "error": "💥",
                    "manual": "📝"}[r.outcome.value]
            print(f"  {icon} {r.outcome.value.upper()} — {r.detail}")
            report.add(r)
    finally:
        try:
            for f in ("$STOP,*", "$CLEAR,*"):
                await mgr.send(sid, f, reply_window_ms=200)
        except Exception:
            pass
        await mgr.disconnect(sid)
    return report
