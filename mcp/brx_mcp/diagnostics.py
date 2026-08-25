"""Transport-agnostic BLE diagnostics flow — bleak-free so it's unit-testable.

The handshake here (`$STOP → $PHONE → $VERSION`, then wait for `$VOLTS`) was
reverse-engineered and fixed live on hardware (experiment-log 2026-08-24): a cold
`$VERSION`/`$VOLTS` gets no reply — the gun answers `$VERSION` only after the app's
ritual preamble, and `$VOLTS` telemetry only starts once `$PHONE` opens the event
tap. `ConnectionManager.diagnose` delegates here so the real BLE manager and a
`FakeConnectionManager` run the SAME flow; a regression in the sequence now fails
a test instead of silently breaking diagnostics on the bench.

`mgr` is any object exposing `sessions`, `connect`, `send`, `wait_for`, `disconnect`.
"""
from __future__ import annotations

import time
from typing import Any


async def run_diagnose(mgr, address: str, volts_wait_s: int = 34) -> dict[str, Any]:
    """Connect, read firmware (`$VERSION`), ping latency (`$PING`→`$PONG`; unanswered
    on this firmware), and battery (`$VOLTS`), then disconnect. Never raises for an
    unreachable tagger — reports it in the record."""
    rec: dict[str, Any] = {"address": address, "reachable": False,
                           "firmware": None, "battery": None,
                           "pong_latency_ms": None}
    alias = f"__diag_{address}"
    if alias in mgr.sessions:                      # stale from a prior aborted sweep
        try:
            await mgr.disconnect(alias)
        except Exception:  # noqa: BLE001
            mgr.sessions.pop(alias, None)
    try:
        await mgr.connect(address, alias)
        rec["reachable"] = True

        # ritual: $STOP (clean) → $PHONE (open tap → VOLTS streams) → $VERSION
        await mgr.send(alias, "$STOP,*", reply_window_ms=80)
        await mgr.send(alias, "$PHONE,*", reply_window_ms=250)
        await mgr.wait_for(alias, "$BUT", timeout_s=2)   # $PHONE replies $BUT,3,0

        await mgr.send(alias, "$VERSION,*", reply_window_ms=100)
        vr = await mgr.wait_for(alias, "$VERSION", timeout_s=3)
        if vr.get("matched"):
            p = vr["event"]["parsed"]
            rec["firmware"] = p.get("firmware")
            rec["host_image"] = p.get("host_image")
            rec["is_devhost"] = p.get("is_devhost")

        t0 = time.monotonic()
        await mgr.send(alias, "$PING,*", reply_window_ms=100)
        pr = await mgr.wait_for(alias, "$PONG", timeout_s=2)
        if pr.get("matched"):
            rec["pong_latency_ms"] = int((time.monotonic() - t0) * 1000)

        br = await mgr.wait_for(alias, "$VOLTS", timeout_s=volts_wait_s)
        if br.get("matched"):
            p = br["event"]["parsed"]
            rec["battery"] = {"pack_v": p.get("pack_v"), "cell_v": p.get("cell_v"),
                              "charge_pct": p.get("charge_pct"),
                              "level_pct": p.get("level_pct")}
    except Exception as e:  # noqa: BLE001 — report, don't crash a fleet sweep
        rec["error"] = f"{type(e).__name__}: {e}"
    finally:
        try:
            await mgr.send(alias, "$STOP,*", reply_window_ms=80)  # release the $PHONE menu lock
        except Exception:  # noqa: BLE001
            pass
        try:
            await mgr.disconnect(alias)
        except Exception:  # noqa: BLE001
            mgr.sessions.pop(alias, None)
    return rec
