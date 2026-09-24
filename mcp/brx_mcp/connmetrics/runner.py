"""BLE connect-metrics bench run (docs/FOLLOWUPS.md F297, BLE setup-reliability P0).

docs/FOLLOWUPS.md F297 calls connect time, first-connect success rate, and "no headset drop on
connect" P0 measured metrics, not impressions. This module connects a fresh gun+headset pair N times
from cold and logs, per run: time to link, whether the first attempt succeeded, and whether the
headset link dropped within the first 30 s of the connect.

Same shape as `brx_mcp/soak/runner.py` (read that module's own docstring first): one coroutine, one
`Clock` (real time wraps `time.monotonic`/`asyncio.sleep`; tests inject a fake that advances a counter
instead of actually waiting), and `mgr` accepted as a duck-typed parameter so a test can pass a fake
that never touches bleak/BLE hardware. `Clock` itself is imported from `soak.runner` rather than
copied: it is a generic time source with nothing soak-specific in it.

Gun facts this module leans on (docs/FOLLOWUPS.md F297):
  * `$VERSION,*` replies `$VERSION,<fw>,<hds>,<n>,,<host>,*` -- token 2 (`hds`) is `hds.<n>` when a
    headset is linked, `?` when it is not. `parse_version()` in `protocol.py` does not surface this
    token (it was never needed there), so `_headset_state()` below tokenizes the raw frame itself.
  * A gun whose headset link is bad drops the BLE link itself within seconds (about every 4-12 s). A
    headset drop therefore shows as EITHER token 2 turning `?` OR the BLE link dropping -- both are
    recorded, separately, as `headset_lost_s` and `ble_drop_s`.
  * Only `$PING,*` and `$VERSION,*` are ever sent: neither changes gun state.
  * Connect establishment is intermittent (see `ble.py ConnectionManager.connect`'s own docstring), so
    the FIRST attempt's result is the metric that matters. This runs `mgr.connect(..., attempts=1)`
    inside its own attempt loop so each attempt is timed and its error recorded individually, rather
    than asking `ble.py`'s own retry loop to do it invisibly.
"""
from __future__ import annotations

import contextlib
import dataclasses
import json
import math
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, TextIO

from .. import protocol
from ..soak.runner import Clock

DEFAULT_MAX_ATTEMPTS = 5
ATTEMPT_GAP_S = 1.5              # ble.py ConnectionManager.connect's own retry gap
REPLY_TIMEOUT_S = 5.0
REPLY_POLL_S = 0.1
SCAN_DURATION_S = 1
DROP_SETTLE_S = 2.0   # how long a failed send waits for `is_connected` to report the drop
ADVERT_POLL_S = 0.25              # short and independent of the batch's hold-window poll_s, so
                                  # t_advert_s/t_link_from_t0_s aren't inflated by it (up to ~4 s on
                                  # real hardware, where a scan actually takes SCAN_DURATION_S)


# -- per-run records ---------------------------------------------------------

@dataclass
class ConnectAttempt:
    attempt: int
    t_start_s: float     # relative to the attempt loop's own start (attempt 1's start)
    duration_s: float
    ok: bool
    error: str | None = None


@dataclass
class ConnectRun:
    run: int
    cold: str
    t_advert_s: float | None = None
    advert_timeout: bool = False
    attempts: list[ConnectAttempt] = field(default_factory=list)
    first_attempt_ok: bool | None = None
    ok: bool = False                       # the link was established at all (within max_attempts)
    t_link_s: float | None = None          # first attempt's start to the successful attempt's success
    t_link_from_t0_s: float | None = None  # cold-prep t0 to the successful attempt's success
    t_pong_ms: float | None = None
    headset_at_link: str = "n/a"           # "linked" / "not_linked" / "no_reply" / "n/a"
    ble_drop_s: float | None = None        # relative to link, first time is_connected() went False
                                            # (or a send raised after the link was up)
    headset_lost_s: float | None = None    # relative to link, first "?" reading after a "linked" one
    headset_ever_linked: bool = False      # headset was seen "linked" at any point in the run, even
                                            # if it took a few hold-window polls to get there
    headset_drop_30s: bool = False         # ble_drop_s or headset_lost_s, and it happened AT OR
                                            # BEFORE hold_s -- a drop timed past the window is real but
                                            # out of scope for this run's P0 metric
    error: str | None = None               # an unexpected exception during this run

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)

    def render(self) -> str:
        if self.error:
            return f"  run {self.run:>3}: ERROR  {self.error}"
        if self.advert_timeout:
            return f"  run {self.run:>3}: NO ADVERT within the timeout"
        if not self.ok:
            last = self.attempts[-1].error if self.attempts else "no attempts made"
            return (f"  run {self.run:>3}: CONNECT FAILED  attempts={len(self.attempts)}  "
                    f"first_ok={self.first_attempt_ok}  last_error={last}")
        pong = f"{self.t_pong_ms:.0f}ms" if self.t_pong_ms is not None else "no reply"
        drop = []
        if self.ble_drop_s is not None:
            drop.append(f"BLE@{self.ble_drop_s:.1f}s")
        if self.headset_lost_s is not None:
            drop.append(f"headset@{self.headset_lost_s:.1f}s")
        drop_s = ",".join(drop) if drop else "none"
        return (f"  run {self.run:>3}: ok  first_ok={self.first_attempt_ok!s:<5} "
                f"attempts={len(self.attempts)}  t_advert={self.t_advert_s:.1f}s  "
                f"t_link={self.t_link_s:.2f}s (t0+{self.t_link_from_t0_s:.2f}s)  "
                f"pong={pong}  headset@link={self.headset_at_link}  "
                f"drop_30s={self.headset_drop_30s} [{drop_s}]")


# -- summary maths (pure, unit-testable without a run) -----------------------

def _median(values: list[float]) -> float | None:
    return statistics.median(values) if values else None


def _p90(values: list[float]) -> float | None:
    """Nearest-rank 90th percentile: the value at position ceil(0.9 * n) (1-indexed)."""
    if not values:
        return None
    s = sorted(values)
    idx = min(len(s) - 1, math.ceil(0.9 * len(s)) - 1)
    return s[idx]


def summarize(runs: list[ConnectRun]) -> dict[str, Any]:
    """Pure function: `runs` in, a stats dict out. Kept separate from `run_connect_metrics` so the
    maths (median/p90, the various rates) can be tested against a known list without running an
    async loop at all."""
    n = len(runs)
    completed = [r for r in runs if r.error is None]
    attempted = [r for r in completed if r.attempts]
    first_ok = [r for r in attempted if r.first_attempt_ok]
    ok_runs = [r for r in completed if r.ok]  # the BLE link came up at all
    link_times = [r.t_link_s for r in ok_runs if r.t_link_s is not None]
    failed = [r for r in completed if not r.ok]
    # "not linked at the moment we asked" (may still catch up during the hold window) vs "never
    # linked in the whole run" -- a slow-to-link headset and a dead one look the same at the link
    # instant, and only the second is the real failure.
    headset_not_linked_at_link = [r for r in ok_runs if r.headset_at_link != "linked"]
    headset_never_linked = [r for r in ok_runs if not r.headset_ever_linked]
    drops = [r for r in ok_runs if r.headset_drop_30s]
    return {
        "runs": n,
        "runs_with_errors": n - len(completed),
        "attempted_runs": len(attempted),
        "first_attempt_success_rate": (len(first_ok) / len(attempted)) if attempted else None,
        "link_time_median_s": _median(link_times),
        "link_time_p90_s": _p90(link_times),
        "link_time_max_s": max(link_times) if link_times else None,
        # count and rate share one denominator, `ok_runs`: a run that never linked at all did not
        # "drop" a link it never had, but it DID link over BLE, so it still belongs in the base.
        "headset_drop_count": len(drops),
        "headset_drop_rate": (len(drops) / len(ok_runs)) if ok_runs else None,
        "headset_not_linked_at_link_count": len(headset_not_linked_at_link),
        "headset_never_linked_count": len(headset_never_linked),
        "failed_runs": len(failed),
    }


@dataclass
class ConnectMetricsSummary:
    address: str
    runs_requested: int
    poll_s: float = 3.0  # the hold-window poll interval runs were taken with -- also the drop-time
                         # resolution: see `to_dict`/`render`
    runs: list[ConnectRun] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "address": self.address,
            "runs_requested": self.runs_requested,
            "runs": [r.to_dict() for r in self.runs],
            "stats": summarize(self.runs),
            "drop_time_resolution_s": self.poll_s,
            "drop_time_note": ("ble_drop_s and headset_lost_s are read at hold-window polls, so "
                               "their resolution is this poll interval, not the wall clock"),
        }

    def render(self) -> str:
        stats = summarize(self.runs)
        lines = [f"=== connect-metrics: {self.address} ({len(self.runs)}/{self.runs_requested} run(s)) ==="]
        lines += [r.render() for r in self.runs]

        def fmt(x: Any, suffix: str = "") -> str:
            if x is None:
                return "n/a"
            if isinstance(x, float):
                return f"{x:.2f}{suffix}"
            return f"{x}{suffix}"

        rate = stats["first_attempt_success_rate"]
        drop_rate = stats["headset_drop_rate"]
        lines.append(
            f"  --- totals: first-attempt success {fmt(rate * 100 if rate is not None else None, '%')} "
            f"({stats['attempted_runs']} attempted)  "
            f"link time median={fmt(stats['link_time_median_s'], 's')} "
            f"p90={fmt(stats['link_time_p90_s'], 's')} max={fmt(stats['link_time_max_s'], 's')}  "
            f"headset drop {stats['headset_drop_count']}/{len(self.runs)} "
            f"({fmt(drop_rate * 100 if drop_rate is not None else None, '%')})  "
            f"not-linked-at-link={stats['headset_not_linked_at_link_count']}  "
            f"never-linked={stats['headset_never_linked_count']}  "
            f"failed={stats['failed_runs']}  errors={stats['runs_with_errors']}  "
            f"(drop time resolution = poll interval, {fmt(self.poll_s, 's')})")
        return "\n".join(lines)


# -- helpers -------------------------------------------------------------

def _headset_state(raw: str) -> str:
    """Token 2 of a `$VERSION` reply: `hds.<n>` (any value) = linked, `?` = not linked."""
    tokens = protocol.tokenize(raw)
    hds = tokens[2] if len(tokens) > 2 else None
    if not hds:
        return "unknown"
    if hds == "?":
        return "not_linked"
    if hds.startswith("hds."):
        return "linked"
    return "unknown"


def _log(log_path: Path | None, kind: str, **fields: Any) -> None:
    if log_path is None:
        return
    line = {"wall_ts": time.time(), "kind": kind, **fields}
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line) + "\n")


async def _wait_for_advert(mgr: Any, address: str, t0: float, timeout_s: float,
                           poll_s: float, clock: Clock) -> float | None:
    """Poll `mgr.scan()` until `address` shows up, or `timeout_s` (from `t0`) passes."""
    addr_l = address.lower()
    while True:
        try:
            results = await mgr.scan(duration_s=SCAN_DURATION_S)
        except Exception:  # noqa: BLE001 -- a scan hiccup is not a reason to give up early
            results = []
        if any(str(r.get("address", "")).lower() == addr_l for r in results):
            return clock.now() - t0
        if clock.now() - t0 >= timeout_s:
            return None
        await clock.sleep(poll_s)


async def _attempt_connect(mgr: Any, address: str, alias: str, max_attempts: int,
                           clock: Clock) -> tuple[list[ConnectAttempt], bool, float]:
    """The attempt loop this module owns (not `ble.py`'s own retry): each call is
    `mgr.connect(..., attempts=1)` so every attempt is timed and its own error recorded, and the
    FIRST attempt's outcome survives as `first_attempt_ok` regardless of whether a later one
    succeeds."""
    attempts: list[ConnectAttempt] = []
    loop_start = clock.now()
    success = False
    for i in range(1, max_attempts + 1):
        a_start = clock.now()
        try:
            await mgr.connect(address, alias, attempts=1)
            ok, err = True, None
        except Exception as e:  # noqa: BLE001 -- recorded per attempt, never raised out of the loop
            ok, err = False, f"{type(e).__name__}: {e}"
        attempts.append(ConnectAttempt(attempt=i, t_start_s=a_start - loop_start,
                                       duration_s=clock.now() - a_start, ok=ok, error=err))
        if ok:
            success = True
            break
        if i < max_attempts:
            await clock.sleep(ATTEMPT_GAP_S)
    return attempts, success, loop_start


async def _time_reply(mgr: Any, alias: str, cmd: str, prefix: str, clock: Clock,
                      timeout_s: float = REPLY_TIMEOUT_S,
                      poll_s: float = REPLY_POLL_S) -> tuple[float | None, dict[str, Any] | None]:
    """Send `cmd` and poll `get_events` for the first rx frame starting with `prefix`, the same
    fire-then-poll shape `soak/runner.py _reconnect` already uses for its own `$PING`/`$PONG` check."""
    session = mgr.sessions.get(alias)
    seq_before = session.seq if session is not None else 0
    t_start = clock.now()
    await mgr.send(alias, cmd, reply_window_ms=0)
    while True:
        events = mgr.get_events(alias, since_seq=seq_before)["events"]
        for e in events:
            if e["direction"] == "rx" and e["raw"].startswith(prefix):
                return clock.now() - t_start, e
        if clock.now() - t_start >= timeout_s:
            return None, None
        await clock.sleep(poll_s)


async def _time_reply_or_drop(mgr: Any, alias: str, cmd: str, prefix: str, clock: Clock,
                              link_time: float, *, timeout_s: float = REPLY_TIMEOUT_S,
                              poll_s: float = REPLY_POLL_S
                              ) -> tuple[float | None, dict[str, Any] | None, float | None]:
    """Like `_time_reply`, but a send that raises once the link was already up is the BLE drop
    itself, not a bug in this tool -- `ble.py`'s send raises when the peripheral has gone away
    mid-command. Returns `(elapsed, event, ble_drop_s)`. `ble_drop_s` (relative to `link_time`) is
    set only when the send raised AND the link really is down now (`mgr.is_connected(alias)` is
    False); a raise while the manager still reports the link as up is a genuine error and is
    re-raised unchanged, same as `_time_reply` would have done."""
    try:
        elapsed, ev = await _time_reply(mgr, alias, cmd, prefix, clock, timeout_s=timeout_s,
                                        poll_s=poll_s)
        return elapsed, ev, None
    except Exception:
        failed_at = clock.now() - link_time
        # bleak's `is_connected` can lag a real drop (WinRT's session status, CoreBluetooth's async
        # didDisconnect), so give it DROP_SETTLE_S to catch up before calling the raise a tool error.
        waited = 0.0
        while mgr.is_connected(alias) and waited < DROP_SETTLE_S:
            await clock.sleep(0.25)
            waited += 0.25
        if mgr.is_connected(alias):
            raise
        return None, None, failed_at


async def _cold_prep(mgr: Any, alias: str, k: int, n: int, cold: str, warm_off_s: float,
                     clock: Clock, prompt: Callable[[str], Any]) -> float:
    with contextlib.suppress(Exception):
        if mgr.is_connected(alias):
            await mgr.disconnect(alias)
    if cold == "manual":
        prompt(f"Run {k}/{n}: power-cycle the gun AND its headset, then press Enter")
        return clock.now()
    if cold == "warm":
        await clock.sleep(warm_off_s)
        return clock.now()
    raise ValueError(f"unknown cold mode: {cold!r} (expected 'manual' or 'warm')")


async def _run_one(mgr: Any, address: str, alias: str, k: int, n: int, *, cold: str,
                   warm_off_s: float, hold_s: float, poll_s: float, max_attempts: int,
                   advert_timeout_s: float, clock: Clock, prompt: Callable[[str], Any],
                   log_path: Path | None) -> ConnectRun:
    """Run one connect-metrics cycle. Always returns (never raises): an exception anywhere in the
    body is recorded on `run.error` so the caller's loop can go straight on to the next run. Always
    disconnects, and always appends exactly one JSON line to `log_path` -- one line per run, whatever
    happened to it, plus whatever the session's own frame log records once a link comes up (see the
    `session.log_file` assignment below, the same mechanism `soak/runner.py` uses)."""
    run = ConnectRun(run=k, cold=cold)
    try:
        t0 = await _cold_prep(mgr, alias, k, n, cold, warm_off_s, clock, prompt)

        t_advert = await _wait_for_advert(mgr, address, t0, advert_timeout_s, ADVERT_POLL_S, clock)
        run.t_advert_s = t_advert
        if t_advert is None:
            run.advert_timeout = True
            run.ok = False
        else:
            attempts, success, loop_start = await _attempt_connect(mgr, address, alias, max_attempts,
                                                                    clock)
            run.attempts = attempts
            run.first_attempt_ok = attempts[0].ok if attempts else None
            run.ok = success
            if success:
                link_time = clock.now()
                run.t_link_s = link_time - loop_start
                run.t_link_from_t0_s = link_time - t0

                if log_path is not None:
                    session = mgr.sessions.get(alias)
                    if session is not None:
                        session.log_file = log_path
                        session.log_label = f"connect-metrics-run{k}"

                # A send below can raise because the link just dropped -- `_time_reply_or_drop`
                # turns that into `ble_drop_s` (a real P0 drop) rather than letting it fall through
                # to the `except Exception` below and be recorded, wrongly, as a tool error.
                elapsed, _, drop_s = await _time_reply_or_drop(mgr, alias, "$PING,*", "$PONG", clock,
                                                               link_time)
                run.t_pong_ms = elapsed * 1000 if elapsed is not None else None
                if drop_s is not None:
                    run.ble_drop_s = drop_s

                seen_linked = False
                if run.ble_drop_s is None:
                    _, version_ev, drop_s = await _time_reply_or_drop(mgr, alias, "$VERSION,*",
                                                                       "$VERSION", clock, link_time)
                    if drop_s is not None:
                        run.ble_drop_s = drop_s
                        run.headset_at_link = "no_reply"
                    else:
                        run.headset_at_link = (_headset_state(version_ev["raw"]) if version_ev
                                               else "no_reply")
                        seen_linked = run.headset_at_link == "linked"
                else:
                    run.headset_at_link = "no_reply"  # the link was already gone by the time we asked

                if run.ble_drop_s is None:
                    hold_deadline = link_time + hold_s
                    next_poll = link_time + poll_s
                    while next_poll <= hold_deadline:
                        delta = next_poll - clock.now()
                        if delta > 0:
                            await clock.sleep(delta)
                        if not mgr.is_connected(alias):
                            run.ble_drop_s = clock.now() - link_time
                            break
                        _, v_ev, drop_s = await _time_reply_or_drop(mgr, alias, "$VERSION,*",
                                                                     "$VERSION", clock, link_time,
                                                                     timeout_s=min(poll_s, 2.0))
                        if drop_s is not None:
                            run.ble_drop_s = drop_s
                            break
                        if v_ev is not None:
                            state = _headset_state(v_ev["raw"])
                            if state == "linked":
                                seen_linked = True
                            elif state == "not_linked" and seen_linked and run.headset_lost_s is None:
                                run.headset_lost_s = clock.now() - link_time
                        next_poll += poll_s

                run.headset_ever_linked = seen_linked
                # ble_drop_s/headset_lost_s are read at hold-window polls, so their resolution is
                # `poll_s`, not the wall clock: a drop recorded past `hold_s` -- a late poll, or a
                # reply slow enough to push detection past the window -- is real but happened
                # outside the window this run measures, and must not count towards the P0 metric.
                run.headset_drop_30s = (
                    (run.ble_drop_s is not None and run.ble_drop_s <= hold_s)
                    or (run.headset_lost_s is not None and run.headset_lost_s <= hold_s)
                )
    except Exception as e:  # noqa: BLE001 -- one run's bug must not stop the rest of the bench run
        run.error = f"{type(e).__name__}: {e}"
    finally:
        with contextlib.suppress(Exception):
            await mgr.disconnect(alias)
    _log(log_path, "connect_metrics_run", **run.to_dict())
    return run


async def run_connect_metrics(mgr: Any, address: str, runs: int, *, cold: str = "manual",
                              warm_off_s: float = 10.0, hold_s: float = 30.0, poll_s: float = 3.0,
                              max_attempts: int = DEFAULT_MAX_ATTEMPTS,
                              advert_timeout_s: float = 60.0, clock: Clock = Clock(),
                              prompt: Callable[[str], Any] = input, log_path: Path | None = None,
                              out: TextIO | None = sys.stdout) -> ConnectMetricsSummary:
    """Connect a fresh gun+headset pair `runs` times from cold and measure, per run: time to link,
    whether the first attempt succeeded, and whether the headset link dropped within the first
    `hold_s` (default 30 s) of the connect. See the module docstring for the gun facts this leans on.

    `cold="manual"` (the default, and the only one that proves a REAL cold boot) prompts before each
    run and times from when the prompt returns. `cold="warm"` disconnects, waits `warm_off_s`, and
    times from then -- useful for a quick unattended rehearsal of the tool itself, not a substitute
    for the manual runs the bench sheet asks for.

    One JSON line is appended to `log_path` per run (plus whatever the session's own frame log
    records once a link is up, the same `session.log_file` mechanism `soak/runner.py` uses). An
    exception during one run is recorded on that run (`ConnectRun.error`) and the next run still
    goes.
    """
    alias = "connmetrics"
    summary = ConnectMetricsSummary(address=address, runs_requested=runs, poll_s=poll_s)
    for k in range(1, runs + 1):
        run = await _run_one(mgr, address, alias, k, runs, cold=cold, warm_off_s=warm_off_s,
                             hold_s=hold_s, poll_s=poll_s, max_attempts=max_attempts,
                             advert_timeout_s=advert_timeout_s, clock=clock, prompt=prompt,
                             log_path=log_path)
        summary.runs.append(run)
        if out is not None:
            out.write(run.render() + "\n")
            out.flush()
    return summary
