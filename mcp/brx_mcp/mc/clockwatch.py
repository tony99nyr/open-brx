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
MC_STEP_QUIET_MS = 10_000    # after MC's OWN wall clock steps, every genuine phone `t` leads `t_recv` by the step: the future rule rests
GATE_TIMEOUT_MS = 10_000     # a node that never shows a whole burst after its hello is sampled anyway after this long


class _Node:
    __slots__ = ("base", "pend", "pend_seq", "clear", "fresh", "last_push", "gated", "hello_t", "hello_recv", "gate_close", "pre", "chk", "reqs", "burst_t", "last")

    def __init__(self) -> None:
        self.base: list[int] = []                   # the last accepted drifts (median = the node's level)
        self.pend: list[tuple[int, int]] = []       # (drift, t_recv) samples that left the level the same way
        self.pend_seq: int | None = None            # the node's seq_hi when the first of `pend` was taken
        self.clear: list[tuple[int, int]] = []      # while suspect: samples back near the reference level
        self.fresh: list[tuple[int, int]] = []      # while suspect: samples after the burst MC asked for
        self.last_push: int | None = None
        self.gated = False                          # True from a hello until its connect burst is over
        self.hello_t: int | None = None             # t_recv of the first sample after the hello
        self.hello_recv = 0                         # F476: MC's clock when the hello arrived
        self.gate_close: int | None = None          # F476: t_recv of the sample that closed the gate
        self.pre: int | None = None                 # F476: the pre-disconnect level, while the post-gate check is open
        self.chk: list[tuple[int, int]] = []        # F476: the first accepted samples after the gate
        self.reqs: list[int] = []                   # t_recv of the latest time_req (up to BURST_N)
        self.burst_t: int | None = None             # t_recv of the last whole burst's final time_req
        self.last: tuple[int, int] | None = None    # (drift, t_recv) of the newest sample taken


class ClockWatch:
    def __init__(self, now_ms: Callable[[], int] | None = None) -> None:
        self.now_ms = now_ms
        self._n: dict[str, _Node] = {}
        # nid -> windows {"since", "until" (None = still suspect), "shift" (stepped level minus reference), "ref"}
        self.windows: dict[str, list[dict[str, Any]]] = {}
        self._mc_step_t: int | None = None      # MC's wall clock when `note_clock` last saw MC's own step
        self._clock_ref: int | None = None      # MC's wall clock minus its monotonic clock, as last read

    def _node(self, nid: str) -> _Node:
        return self._n.setdefault(nid, _Node())

    def suspect(self, nid: str) -> bool:
        w = self.windows.get(nid)
        return bool(w) and w[-1]["until"] is None

    def pending(self, nid: str) -> bool:
        """A shifted sample is waiting for its confirmation. A take cannot be undone, so the pickup path reads this."""
        n = self._n.get(nid)
        return bool(n and n.pend) and not self.suspect(nid)

    def connect(self, nid: str, t_recv: int = 0) -> None:
        """A hello: the phone is about to run its connect burst. Its saved offset may be stale (another MC host, an
        old session) until that burst lands, so no drift is taken as a baseline before then."""
        n = self._node(nid)
        # F495: a gate still open, or one whose post-gate check has not resolved, is not over. Keep its hello, so the
        # window the next check opens covers both gates. The baseline is untouched meanwhile (the check holds the samples).
        if not (n.gated or n.pre is not None):
            n.hello_recv = t_recv
        n.pre, n.chk = None, []
        n.gated, n.hello_t, n.burst_t, n.reqs, n.pend, n.clear, n.fresh = True, None, None, [], [], [], []

    def note_clock(self, wall_ms: int, mono_ms: int) -> bool:
        """MC's OWN wall clock stepping (WSL2 TimeSync, an NTP step on the laptop) moves every node's drift at once, and
        nothing in the drifts tells it from the phones all stepping together. So MC reads it directly: its wall clock
        minus its monotonic clock is constant until the wall clock steps. `wall_ms` is the `t_recv` of the sample and
        `mono_ms` the monotonic clock read at the same moment. A change beyond CLOCK_STEP_MS re-baselines every node
        (each re-seeds from its next sample) and suspects nobody. Returns True on that step."""
        ref = wall_ms - mono_ms
        if self._clock_ref is None:
            self._clock_ref = ref
            return False
        if abs(ref - self._clock_ref) <= CLOCK_STEP_MS:
            return False
        delta = ref - self._clock_ref        # how far MC's wall clock moved: every t_recv from now on is `delta` later
        self._clock_ref = ref
        self._mc_step_t = wall_ms
        for n in self._n.values():
            n.base, n.pend, n.clear, n.fresh = [], [], [], []
            n.reqs, n.pre, n.chk = [], None, []
            for f in ("last_push", "burst_t", "hello_t"):
                v = getattr(n, f)
                if v is not None:
                    setattr(n, f, v + delta)
            if n.last is not None:
                n.last = (n.last[0] - delta, n.last[1] + delta)
        # An open or closed window is dated in the OLD time frame. Move it into the new one: its times shift with MC's
        # clock, and its reference drift moves the other way (a phone that did not step now reads `delta` less).
        for ws in self.windows.values():
            for w in ws:
                w["since"] += delta
                if w["until"] is not None:
                    w["until"] += delta
                w["ref"] -= delta
        return True

    def sample(self, nid: str, d: int, t_recv: int, kind: str = "status", seq_hi: int | None = None) -> list[str]:
        """One live drift sample. Returns the edges it caused: "suspect" and/or "cleared"."""
        n = self._node(nid)
        if kind == "time_req":
            n.reqs = (n.reqs + [t_recv])[-BURST_N:]
            if len(n.reqs) == BURST_N and n.reqs[-1] - n.reqs[0] <= BURST_SPAN_MS:
                n.burst_t, n.reqs = t_recv, []
        if n.gated:
            if n.hello_t is None:
                n.hello_t = t_recv
            if (n.burst_t is not None and t_recv >= n.burst_t + BURST_SETTLE_MS) or t_recv - n.hello_t >= GATE_TIMEOUT_MS:
                n.gated, n.gate_close = False, t_recv
                # F476: the level the node held BEFORE the disconnect. The first samples after the gate say whether the
                # offset was safe while the gate was open. That sample is the gate's own: the check starts after it.
                if n.base and not self.suspect(nid):
                    n.pre, n.chk = int(statistics.median(n.base)), []
                    return []
            else:
                return []
        if n.burst_t is not None and n.burst_t <= t_recv < n.burst_t + BURST_SETTLE_MS:
            return []        # the burst's own stamps and the heartbeats right behind it still carry the old offset
        n.last = (d, t_recv)
        if n.pre is not None:
            n.chk.append((d, t_recv))
            if t_recv - n.chk[0][1] < CLOCK_STEP_CONFIRM_GAP_MS:
                return []
            pre, chk, n.pre, n.chk = n.pre, n.chk, None, []
            if max(c[0] for c in chk) - min(c[0] for c in chk) > CLOCK_STEP_MS:
                # A split pair: the clock moved AFTER the gate. No gate verdict; the older samples are the old level and
                # the newest one goes down the normal F474 step path below.
                n.base = (n.base + [c[0] for c in chk[:-1]])[-CLOCK_BASELINE_N:]
            else:
                level = int(statistics.median([c[0] for c in chk]))
                if abs(level - pre) <= CLOCK_STEP_MS:
                    n.base = (n.base + [c[0] for c in chk])[-CLOCK_BASELINE_N:]      # the common reconnect: nothing to do
                    return []
                # F476: the offset moved while the gate was open, so a LIVE fact of the gate carries an unsettled stamp. The
                # window spans the hello to the gate's close; the level after it is the node's new baseline.
                ws = self.windows.setdefault(nid, [])
                ws.append({"since": n.hello_recv, "until": n.gate_close, "shift": level - pre, "ref": pre, "seq": None, "gate": True})
                del ws[:-MAX_WINDOWS]
                n.base = [c[0] for c in chk][-CLOCK_BASELINE_N:]
                return ["gate"]
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
        if not n.pend:
            n.pend_seq = seq_hi
        n.pend.append((d, t_recv))
        first = n.pend[0]
        if t_recv - first[1] < CLOCK_STEP_CONFIRM_GAP_MS:
            return []
        shifted = int(statistics.median([p[0] for p in n.pend]))
        ws = self.windows.setdefault(nid, [])
        ws.append({"since": first[1], "until": None, "shift": shifted - level, "ref": level, "seq": n.pend_seq})
        del ws[:-MAX_WINDOWS]
        n.pend, n.clear, n.fresh, n.base = [], [], [], [shifted]
        return ["suspect"]

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
            # ...and only a level near MC time counts: a phone whose replies never landed sits on the stepped level, and
            # a correctly synced phone reads a drift of about 0 (latency only pulls it a little negative).
            if abs(d) <= CLOCK_STEP_MS:
                for f in n.fresh:
                    if t_recv - f[1] >= CLOCK_STEP_CONFIRM_GAP_MS and abs(f[0]) <= CLOCK_STEP_MS and abs(d - f[0]) <= CLOCK_STEP_MS:
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

    def stepped(self, nid: str, t: int, t_recv: int, seq: int | None = None) -> bool:
        """True when a fact must be scored at `t_recv` (see `verdict`)."""
        return self.verdict(nid, t, t_recv, seq) is not None

    def verdict(self, nid: str, t: int, t_recv: int, seq: int | None = None) -> str | None:
        """What to make of a fact's own time `t` (received at `t_recv`, node seq `seq`):

        * `"stepped"`: it arrived while the node was suspect, so its `t` is the stepped clock's. Score it at `t_recv`.
        * `"ambiguous"`: it arrived AFTER a window closed with its `t` in the stepped copy of that window, and nothing
          proves it was made before the step (a late flush; the node's seq is above the anchor, or was reset). It may
          have been queued before the step or after it, so neither `t` nor `t_recv` is safe. A scoring fact is scored
          at `t_recv`; a pickup takes nothing, because the station's own report settles the spawn (F454).
        * `None`: trust `t`.

        F485: a fact dated more than CLOCK_STEP_MS AHEAD of its arrival (more by a positive node baseline) cannot be
        genuine. It is `"stepped"` at once, before any window exists: a death in the first seconds after a forward step
        must not wait for the confirmation. The rule rests for MC_STEP_QUIET_MS after MC's own clock stepped.

        A fact that arrived outside the window and is dated before it is genuine pre-step time. A fact dated before
        `since` is read as genuine too when the node has no seq anchor: after a backward step the stepped copy of a
        window longer than the step overlaps the time before it."""
        for w in self.windows.get(nid, ()):
            if t_recv >= w["since"] and (w["until"] is None or t_recv <= w["until"]):
                return "stepped"
            if w.get("gate"):
                continue     # F476: a gate window dates arrival only; a late flush after it keeps its own time
            if w["until"] is None or t_recv <= w["until"]:
                continue
            # A late flush: its `t` is in the stepped copy of the window. `since + ref` is the phone's own time at `since`
            # (it does not move with MC's clock, `ref` moves the other way), so the band holds across an MC step.
            lo, hi = w["since"] + w["ref"] + w["shift"], w["until"] + w["ref"] + w["shift"]
            if not (lo - CLOCK_TIE_MS <= t <= hi + CLOCK_TIE_MS):
                continue
            wseq = w.get("seq")
            if w.get("reset"):
                return "ambiguous"
            if seq is not None and wseq is not None:
                # The node's seq is monotonic in stamp order: a fact sent before the window opened has a seq the node
                # had already delivered at `since`. That settles a window shorter than a backward step, where the
                # stepped copy overlaps genuine earlier time.
                if seq > wseq:
                    return "ambiguous"
            elif t >= w["since"]:
                return "ambiguous"
        # F485 (after the windows, so an ambiguous late flush stays ambiguous). A phone cannot send from the future, so the
        # lead is measured against arrival itself; only a node whose own baseline is positive widens it. A negative
        # baseline (a slow uplink) must not shrink it. Without a baseline (a fresh process) the plain rule holds.
        if self._mc_step_t is not None and 0 <= t_recv - self._mc_step_t <= MC_STEP_QUIET_MS:
            return None
        n = self._n.get(nid)
        level = int(statistics.median(n.base)) if n is not None and n.base else 0
        if t - t_recv > CLOCK_STEP_MS + max(0, level):
            return "stepped"
        return None

    def drop_seq(self, nid: str) -> None:
        """The phone reset its storage (it restarts its counter at `welcome.seq_hi + 1`, which MC no longer remembers), or
        MC restarted and lost what it had received: a seq no longer orders its facts against the window's. Every window of the node falls back to the safe reading: a late flush in the stepped band is
        stepped."""
        for w in self.windows.get(nid, ()):
            w["seq"], w["reset"] = None, True

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
                    sq = w.get("seq")
                    ok.append({"since": w["since"], "until": w["until"], "shift": w["shift"], "ref": w["ref"],
                               "seq": sq if isinstance(sq, int) and not isinstance(sq, bool) else None})
                    if w.get("gate") is True:
                        ok[-1]["gate"] = True
                    if w.get("reset") is True:
                        ok[-1]["reset"] = True
            if ok:
                self.windows[nid] = ok
