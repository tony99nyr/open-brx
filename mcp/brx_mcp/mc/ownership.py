"""Domination scored from the phones (Tony 2026-11-07: "a hill shouldnt be the one reporting the score right? it should
be the phones"). Each phone near a hill sends `own_change` when the owner in the Stick's advert changes, and re-asserts
the owner it hears (first hearing, after a gap, and every 30 s). MC builds one owner timeline per hill from those facts
and sums each owner's time; an owned hill with nobody near it keeps scoring from the last change MC knows about.

Phones' clocks differ by up to a second or so, so the timeline is ordered by the CHAIN of changes (each change names the
owner it replaced, `from_tid`), and `at_ms` only places and times each step. A change whose `from_tid` is not the current
owner waits (another phone's earlier step may still come); once the timeline has moved `OWN_SKEW_MS` past it with no such
step, it applies anyway (a step nobody reported). So skew moves an interval's edge by about the skew, never the final
owner (brx1 2026-11-07: red to neutral from phone A, then neutral to blue from phone B whose clock is behind, must end
on blue).
"""
from __future__ import annotations

import bisect
from collections.abc import Iterable

NEUTRAL_TID = 2      # a hill nobody owns (bench-measured 2026-09-10; the console's objective.ts uses the same 2)
OWN_SKEW_MS = 3000   # how far apart two phones' clocks may be; a step waits this long for the step before it

JITTER_MS = 1000     # after the clocks are aligned: advert latency and what the alignment could not remove


def clock_offsets(rows: list[tuple[int, int, int, str]], skew_ms: int = OWN_SKEW_MS) -> dict[str, int]:
    """Each phone's clock offset from the field's, estimated from the steps phones share. Every phone near a hill reports
    every step, so the same (from, owner) step from two phones within the skew is mostly the same step; the MEDIAN gap
    over all such pairs is the offset (a wrong pairing is rare and lands anywhere, so it moves a median little). A phone
    that shares too few steps keeps offset 0. The offsets are then centred, so no one phone's clock is the reference."""
    by_node: dict[str, list[tuple[int, int, int]]] = {}
    for at, frm, own, node in rows:
        if frm != own:
            by_node.setdefault(node, []).append((at, frm, own))
    if len(by_node) < 2:
        return {}
    ref = max(by_node, key=lambda n: len(by_node[n]))
    off: dict[str, int] = {ref: 0}
    progress = True
    while progress:
        progress = False
        for node, steps in by_node.items():
            if node in off:
                continue
            index: dict[tuple[int, int], list[int]] = {}
            for m in off:
                for b_at, b_frm, b_own in by_node[m]:
                    index.setdefault((b_frm, b_own), []).append(b_at - off[m])
            for ats in index.values():
                ats.sort()
            gaps = []
            for at, frm, own in steps:
                ats = index.get((frm, own), [])
                i = bisect.bisect_left(ats, at)
                near = [at - ats[j] for j in (i - 1, i) if 0 <= j < len(ats) and abs(at - ats[j]) < skew_ms]
                if near:
                    gaps.append(min(near, key=abs))
            if len(gaps) >= 3:
                gaps.sort()
                off[node] = gaps[len(gaps) // 2]
                progress = True
    mid = sorted(off.values())[len(off) // 2]
    return {n: o - mid for n, o in off.items()}


OwnChange = tuple[int, int, int, str]   # (at_ms, from_tid, owner_tid, node_id); from == owner is a re-assertion


def owned_ms(changes: Iterable[tuple], start: int, end: int, skew_ms: int = OWN_SKEW_MS,
             offsets: dict[str, int] | None = None) -> dict[int, int]:
    """Milliseconds each tid owned the hill between `start` (go-live, when every hill is neutral) and `end` (now, or
    the whistle). A change heard after `end` is not counted; one stamped before `start` counts from `start`.

    Each phone near the hill reports every step, so most steps arrive once per phone, each stamped on that phone's
    clock. A report that matches a step another phone already gave (same from and owner, within the skew) is that
    step again, and each applied step takes at most one such copy from each other phone; a phone never repeats its own
    step, so its next matching report is a new flip."""
    if end <= start:
        return {}
    rows = [(int(c[0]), int(c[1]), int(c[2]), str(c[3]) if len(c) > 3 else "") for c in changes]
    off = clock_offsets(rows, skew_ms) if offsets is None else offsets
    rows = [(at - off.get(node, 0), frm, own, node) for at, frm, own, node in rows]
    evs = sorted((max(start, at), frm, own, node) for at, frm, own, node in rows if at <= end)
    if off and all(node in off for _at, frm, own, node in rows if frm != own):
        skew_ms = JITTER_MS   # every clock is aligned: what is left is advert latency
    owned: dict[int, int] = {}
    cur, cur_t = NEUTRAL_TID, start
    pending: list[OwnChange] = []
    applied: list[tuple[int, int, int, str, set[str]]] = []

    def apply(at: int, frm: int, own: int, node: str) -> None:
        nonlocal cur, cur_t
        t = max(at, cur_t)
        owned[cur] = owned.get(cur, 0) + (t - cur_t)
        cur, cur_t = own, t
        applied.append((at, frm, own, node, set()))

    def copy_of_applied(at: int, frm: int, own: int, node: str) -> bool:
        """True (and the copy is taken) when this is another phone's report of a step already applied."""
        if frm == own:
            return False
        for a_at, a_frm, a_own, a_node, took in reversed(applied[-8:]):
            if a_frm == frm and a_own == own and a_node != node and node not in took and abs(a_at - at) < skew_ms:
                took.add(node)
                return True
        return False

    def stale(at: int, frm: int, own: int, node: str) -> bool:
        # a re-assertion of an owner a step replaced within the skew of it: the phone heard it just before that step
        # (its clock is behind), so it says nothing new
        return frm == own and any(a_frm == own and a_at > at - skew_ms for a_at, a_frm, _o, _n, _t in applied[-8:])

    def drain() -> None:
        while True:
            nxt = min((p for p in pending if p[1] == cur and p[1] != p[2]), default=None)
            if nxt is None:
                # a re-assertion of the current owner says nothing; a change may still chain after another phone's step
                pending[:] = [p for p in pending if not (p[1] == p[2] == cur) and not stale(*p) and not copy_of_applied(*p)]
                return
            pending.remove(nxt)
            if not copy_of_applied(*nxt):
                apply(*nxt)

    def flush(limit: float) -> None:
        while True:
            drain()
            due = [p for p in pending if p[0] <= limit]
            if not due:
                return
            first = min(due)
            pending.remove(first)
            if first[2] != cur:   # nothing chained it in time: a step nobody reported, or a re-assertion that corrects
                apply(*first)

    for ev in evs:
        flush(ev[0] - skew_ms)
        if copy_of_applied(*ev) or ev[1] == ev[2] == cur:
            continue
        if ev[1] == cur and ev[1] != ev[2]:
            apply(*ev)
            drain()
        elif not stale(*ev):
            pending.append(ev)
    flush(float("inf"))
    owned[cur] = owned.get(cur, 0) + max(0, end - cur_t)
    return {tid: ms for tid, ms in owned.items() if ms > 0}
