"""F474: notice a phone whose wall clock stepped AFTER its clock sync, and stop trusting its fact times.

A synced node stamps every envelope and fact with its own `t`, and MC scores that `t` (contracts §7). If the phone's
wall clock steps by about one spawn interval (an NTP correction, a user change) after the sync, every later `t` is
off by the step. MC cannot see the step in a fact, but it can see it in the DRIFT of the live messages: for a
`status` or `time_req`, `d = env.t - t_recv` is small and steady (latency only makes it more negative). A step
moves `d` by the step size at once.

Pure logic, no I/O. The Session feeds it one sample per live status or time_req and acts on what it returns.
Batched or offline-flushed facts are never fed in: only live heartbeats say what the clock is doing now.
"""
from __future__ import annotations

import statistics
from typing import Any, Callable

from .types import (CLOCK_BASELINE_N, CLOCK_RESYNC_MIN_GAP_MS, CLOCK_STEP_CONFIRM_GAP_MS, CLOCK_STEP_MS,
                    CLOCK_TIE_MS)

MAX_WINDOWS = 8      # per node: a window is a few numbers, but a phone that steps all match must not grow the snapshot


class _Node:
    __slots__ = ("base", "pend", "clear", "last_push")

    def __init__(self) -> None:
        self.base: list[int] = []                   # the last accepted drifts (median = the node's level)
        self.pend: list[tuple[int, int]] = []       # (drift, t_recv) samples that left the level the same way
        self.clear: list[tuple[int, int]] = []      # while suspect: samples back near the reference level
        self.last_push: int | None = None


class ClockWatch:
    def __init__(self, now_ms: Callable[[], int] | None = None) -> None:
        self.now_ms = now_ms
        self._n: dict[str, _Node] = {}
        # nid -> windows {"since", "until" (None = still suspect), "shift" (stepped level minus reference), "ref"}
        self.windows: dict[str, list[dict[str, Any]]] = {}

    def _node(self, nid: str) -> _Node:
        return self._n.setdefault(nid, _Node())

    def suspect(self, nid: str) -> bool:
        w = self.windows.get(nid)
        return bool(w) and w[-1]["until"] is None

    def sample(self, nid: str, d: int, t_recv: int) -> list[str]:
        """One live drift sample. Returns the edges it caused: "suspect" and/or "cleared"."""
        n = self._node(nid)
        if self.suspect(nid):
            return self._sample_suspect(nid, n, d, t_recv)
        if not n.base:
            n.base.append(d)
            return []
        level = int(statistics.median(n.base))
        if abs(d - level) <= CLOCK_STEP_MS:
            n.pend = []
            n.base = (n.base + [d])[-CLOCK_BASELINE_N:]
            return []
        # Left the level. One sample is never enough (a delayed message), and neither are samples that all reached
        # MC in one instant (a queue flushed at once).
        sign = 1 if d > level else -1
        if n.pend and (1 if n.pend[0][0] > level else -1) != sign:
            n.pend = []
        n.pend.append((d, t_recv))
        first = n.pend[0]
        if t_recv - first[1] < CLOCK_STEP_CONFIRM_GAP_MS:
            return []
        shifted = int(statistics.median([p[0] for p in n.pend]))
        ws = self.windows.setdefault(nid, [])
        ws.append({"since": first[1], "until": None, "shift": shifted - level, "ref": level})
        del ws[:-MAX_WINDOWS]
        n.pend, n.clear, n.base = [], [], [shifted]
        return ["suspect"]

    def _sample_suspect(self, nid: str, n: _Node, d: int, t_recv: int) -> list[str]:
        w = self.windows[nid][-1]
        if abs(d - w["ref"]) > CLOCK_STEP_MS:
            n.clear = []
            return []
        n.clear.append((d, t_recv))
        if t_recv - n.clear[0][1] < CLOCK_STEP_CONFIRM_GAP_MS:
            return []
        w["until"] = n.clear[0][1]
        n.base = [c[0] for c in n.clear][-CLOCK_BASELINE_N:]
        n.pend, n.clear = [], []
        return ["cleared"]

    def should_push(self, nid: str, t_recv: int) -> bool:
        """At most one `clock_resync` per CLOCK_RESYNC_MIN_GAP_MS per node; records the push when it says yes."""
        n = self._node(nid)
        if n.last_push is not None and 0 <= t_recv - n.last_push < CLOCK_RESYNC_MIN_GAP_MS:
            return False
        n.last_push = t_recv
        return True

    def stepped(self, nid: str, t: int, t_recv: int) -> bool:
        """True when a fact (own time `t`, received at `t_recv`) must be scored at `t_recv`: it arrived while the node
        was suspect, or its own `t` falls in the stepped copy of a closed window (a fact queued offline through the
        step and flushed after the clear)."""
        for w in self.windows.get(nid, ()):
            if t_recv >= w["since"] and (w["until"] is None or t_recv <= w["until"]):
                return True
            if w["until"] is not None and w["since"] + w["shift"] - CLOCK_TIE_MS <= t <= w["until"] + w["shift"] + CLOCK_TIE_MS:
                return True
        return False

    def clear_all(self) -> None:
        self._n.clear()
        self.windows.clear()

    def to_snapshot(self) -> dict[str, list[dict[str, Any]]]:
        return {nid: [dict(w) for w in ws] for nid, ws in self.windows.items() if ws}

    def restore(self, raw: object) -> None:
        if not isinstance(raw, dict):
            return
        for nid, ws in raw.items():
            if not isinstance(nid, str) or not isinstance(ws, list):
                continue
            ok = []
            for w in ws[-MAX_WINDOWS:]:
                if (isinstance(w, dict) and all(isinstance(w.get(k), int) and not isinstance(w.get(k), bool)
                                                for k in ("since", "shift", "ref"))
                        and (w.get("until") is None or (isinstance(w["until"], int) and not isinstance(w["until"], bool)))):
                    ok.append({"since": w["since"], "until": w["until"], "shift": w["shift"], "ref": w["ref"]})
            if ok:
                self.windows[nid] = ok
