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
BURST_N = 5                  # the phone's burst: `transport.js` sends this many time_req back to back
BURST_SPAN_MS = 1500         # ...so five time_req inside this span are a burst, and a slow trickle (the 5 s periodic one) is not
BURST_SETTLE_MS = 1000       # a burst's own stamps still carry the OLD offset; the first replies need about this long to land
GATE_TIMEOUT_MS = 10_000     # a node that never shows a whole burst after its hello is sampled anyway after this long
LIVE_MS = 10_000             # a node counts as live for the MC-step vote if it sent a sample this recently
MC_STEP_HOLD_MS = 10_000     # after an MC step, a node shifting by the same amount is re-baselined, not suspected


class _Node:
    __slots__ = ("base", "pend", "clear", "fresh", "last_push", "gated", "hello_t", "reqs", "burst_t", "last")

    def __init__(self) -> None:
        self.base: list[int] = []                   # the last accepted drifts (median = the node's level)
        self.pend: list[tuple[int, int]] = []       # (drift, t_recv) samples that left the level the same way
        self.clear: list[tuple[int, int]] = []      # while suspect: samples back near the reference level
        self.fresh: list[tuple[int, int]] = []      # while suspect: samples after the burst MC asked for
        self.last_push: int | None = None
        self.gated = False                          # True from a hello until its connect burst is over
        self.hello_t: int | None = None             # t_recv of the first sample after the hello
        self.reqs: list[int] = []                   # t_recv of the latest time_req (up to BURST_N)
        self.burst_t: int | None = None             # t_recv of the last whole burst's final time_req
        self.last: tuple[int, int] | None = None    # (drift, t_recv) of the newest sample taken


class ClockWatch:
    def __init__(self, now_ms: Callable[[], int] | None = None) -> None:
        self.now_ms = now_ms
        self._n: dict[str, _Node] = {}
        # nid -> windows {"since", "until" (None = still suspect), "shift" (stepped level minus reference), "ref"}
        self.windows: dict[str, list[dict[str, Any]]] = {}
        self.mc_shift: tuple[int, int] | None = None   # (shift, t_recv) of the last MC-wide step

    def _node(self, nid: str) -> _Node:
        return self._n.setdefault(nid, _Node())

    def suspect(self, nid: str) -> bool:
        w = self.windows.get(nid)
        return bool(w) and w[-1]["until"] is None

    def pending(self, nid: str) -> bool:
        """A shifted sample is waiting for its confirmation. A take cannot be undone, so the pickup path reads this."""
        n = self._n.get(nid)
        return bool(n and n.pend) and not self.suspect(nid)

    def connect(self, nid: str) -> None:
        """A hello: the phone is about to run its connect burst. Its saved offset may be stale (another MC host, an
        old session) until that burst lands, so no drift is taken as a baseline before then."""
        n = self._node(nid)
        n.gated, n.hello_t, n.burst_t, n.reqs, n.pend, n.clear, n.fresh = True, None, None, [], [], [], []

    def sample(self, nid: str, d: int, t_recv: int, kind: str = "status") -> list[str]:
        """One live drift sample. Returns the edges it caused: "suspect", "cleared" and/or "mc_step"."""
        n = self._node(nid)
        if kind == "time_req":
            n.reqs = (n.reqs + [t_recv])[-BURST_N:]
            if len(n.reqs) == BURST_N and n.reqs[-1] - n.reqs[0] <= BURST_SPAN_MS:
                n.burst_t, n.reqs = t_recv, []
        if n.gated:
            if n.hello_t is None:
                n.hello_t = t_recv
            if (n.burst_t is not None and t_recv >= n.burst_t + BURST_SETTLE_MS) or t_recv - n.hello_t >= GATE_TIMEOUT_MS:
                n.gated = False
            else:
                return []
        if n.burst_t is not None and n.burst_t <= t_recv < n.burst_t + BURST_SETTLE_MS:
            return []        # the burst's own stamps and the heartbeats right behind it still carry the old offset
        n.last = (d, t_recv)
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
        if self.mc_shift is not None and t_recv - self.mc_shift[1] <= MC_STEP_HOLD_MS \
                and abs((d - level) - self.mc_shift[0]) <= CLOCK_STEP_MS:
            n.base, n.pend = [d], []     # MC's own clock stepped a moment ago: this node is only now showing it
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
        if self._is_mc_step(nid, shifted - level, t_recv):
            return ["mc_step"]
        ws = self.windows.setdefault(nid, [])
        ws.append({"since": first[1], "until": None, "shift": shifted - level, "ref": level})
        del ws[:-MAX_WINDOWS]
        n.pend, n.clear, n.fresh, n.base = [], [], [], [shifted]
        return ["suspect"]

    def _is_mc_step(self, nid: str, shift: int, t_recv: int) -> bool:
        """MC's own wall clock stepping (WSL2 TimeSync) moves EVERY node's drift the same way at once. When at least two
        live nodes, and at least half of them, show a same-sign shift within CLOCK_STEP_MS of this one, it is MC's step:
        re-baseline them all and suspect nobody."""
        live, match = [], []
        for k, x in self._n.items():
            if not x.base or x.last is None or t_recv - x.last[1] > LIVE_MS or self.suspect(k):
                continue
            live.append(k)
            sh = x.last[0] - int(statistics.median(x.base))
            if abs(sh) > CLOCK_STEP_MS and (sh > 0) == (shift > 0) and abs(sh - shift) <= CLOCK_STEP_MS:
                match.append(k)
        if nid not in match or len(match) < 2 or 2 * len(match) < len(live):
            return False
        for k in match:
            x = self._n[k]
            x.base, x.pend = [x.last[0]] if x.last else [], []
        self.mc_shift = (shift, t_recv)
        return True

    def _sample_suspect(self, nid: str, n: _Node, d: int, t_recv: int) -> list[str]:
        w = self.windows[nid][-1]
        # (1) the drift is back near the level it had before the step
        if abs(d - w["ref"]) <= CLOCK_STEP_MS:
            n.clear.append((d, t_recv))
            if t_recv - n.clear[0][1] >= CLOCK_STEP_CONFIRM_GAP_MS:
                return self._close(nid, n, n.clear[0][1], [c[0] for c in n.clear])
        else:
            n.clear = []
        # (2) MC asked for a re-sync and the phone ran a fresh burst: it now holds a NEW stable level (its saved offset
        # was stale, or the step was real and stays). Two samples after that burst, within CLOCK_STEP_MS of each other
        # and 2 s apart, are that level.
        if n.last_push is not None and n.burst_t is not None and n.burst_t > n.last_push:
            for f in n.fresh:
                if t_recv - f[1] >= CLOCK_STEP_CONFIRM_GAP_MS and abs(d - f[0]) <= CLOCK_STEP_MS:
                    return self._close(nid, n, f[1], [f[0], d])
            n.fresh = (n.fresh + [(d, t_recv)])[-CLOCK_BASELINE_N:]
        return []

    def _close(self, nid: str, n: _Node, until: int, drifts: list[int]) -> list[str]:
        self.windows[nid][-1]["until"] = until
        n.base = drifts[-CLOCK_BASELINE_N:]
        n.pend, n.clear, n.fresh = [], [], []
        return ["cleared"]

    def should_push(self, nid: str, t_recv: int) -> bool:
        """At most one `clock_resync` per CLOCK_RESYNC_MIN_GAP_MS per node; records the push when it says yes."""
        n = self._node(nid)
        if n.last_push is not None and 0 <= t_recv - n.last_push < CLOCK_RESYNC_MIN_GAP_MS:
            return False
        n.last_push, n.fresh = t_recv, []
        return True

    def stepped(self, nid: str, t: int, t_recv: int) -> bool:
        """True when a fact (own time `t`, received at `t_recv`) must be scored at `t_recv`: it arrived while the node
        was suspect, or it arrived AFTER the window closed with its own `t` in the stepped copy of that window (a fact
        queued offline through the step and flushed later). A fact that arrived outside the window and is dated before
        it is genuine pre-step time: the band applies only to a late flush. A fact dated before `since` is read as
        genuine too: after a backward step the stepped copy of a window longer than the step overlaps the time before
        it, and trusting the older fact there is the safer reading."""
        for w in self.windows.get(nid, ()):
            if t_recv >= w["since"] and (w["until"] is None or t_recv <= w["until"]):
                return True
            if w["until"] is not None and t_recv > w["until"] and t >= w["since"] \
                    and w["since"] + w["shift"] - CLOCK_TIE_MS <= t <= w["until"] + w["shift"] + CLOCK_TIE_MS:
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
