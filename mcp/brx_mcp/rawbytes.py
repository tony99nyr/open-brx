"""Bounded raw-byte bench helper (docs/FOLLOWUPS.md F269).

The screamers use cases A4/A7/A7b/A7c/A8 (docs/bench-screamers-2026-09-19.md) need a transport that
does NOT belong to the instrument's own framing: they exist to find out whether the GUN's parser
survives a byte stream that lands on the wire in ways `ble.py`'s helpers never produce. `send`/
`send_batch`/`send_phone_paced` always chunk a caller's FRAME, sleep 20 ms (or a phone-shaped gap)
between chunks, and log the frame's INTENT before it is sent. This module writes exactly the caller's
own bytes in exactly the caller's own pieces, with exactly the caller's own delays (including zero),
and logs each GATT write only once it has actually completed.

Two things this module is deliberately NOT:

  - It is not a second BLE stack. It reaches the tagger through the SAME `ble.py Session` every other
    helper uses: its `client` for the write, its `write_lock` so a raw-byte run cannot interleave with
    another writer's chunks on the wire (ble.py's own docstring explains why that matters), and its
    `record()` so the run lands in the session's normal JSONL log.
  - It is not a way around the safety rail. `protocol.deny_reason`/`is_known_safe` are re-applied to
    whatever frames the CONCATENATED payload decodes to, not to the caller's write boundaries, because
    the gun's parser does not see write boundaries either -- a denied command split across two writes
    is exactly as denied as one sent whole.

Planning (`repeat_stream`, `split_at`, `plan_from_stream`, `plan_from_segments`) is pure: no I/O, easy
to unit test, and reused by the CLI to print the plan before it connects. `validate_plan` is the one
refusal gate; `write_raw` always runs it (a `RawPlan` built by hand, not through the planners above,
still gets the same bounds and safety checks -- nothing that reaches `write_raw` skips them).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

from . import protocol
from .protocol import NUS_RX_CHAR_UUID
from .soak.runner import Clock

# ATT write-without-response caps at MTU-3; 20 B is the default-MTU figure `ble.py` also falls back
# to. A caller with a negotiated bigger MTU may pass a larger `max_chunk`.
MAX_CHUNK_BYTES = 20
MAX_TOTAL_BYTES = 8 * 1024        # 8 KiB
MAX_WRITES = 512
MAX_DELAY_MS = 10_000.0           # per gap
MAX_TOTAL_DELAY_MS = 60_000.0     # whole plan


def repeat_stream(frame: str, n: int) -> bytes:
    """`frame` repeated `n` times with no separator: the raw byte stream A7c/A8 replay onto the wire.

    `repeat_stream("$PING,*", 146)` is the 1,022-byte A7c stream; `147` is 1,029 B.
    """
    if n < 0:
        raise ValueError(f"n must be >= 0, got {n}")
    return frame.encode("utf-8") * n


def split_at(payload: bytes, size: int = MAX_CHUNK_BYTES) -> list[bytes]:
    """Split `payload` into `size`-byte pieces in order, the last one short. Every byte of `payload`
    appears exactly once, in exactly one piece: this is the ATT-boundary split A7/A7c/A8's zero-gap
    streams use, never re-aligned to a frame boundary."""
    if size <= 0:
        raise ValueError(f"chunk size must be positive, got {size}")
    return [payload[i:i + size] for i in range(0, len(payload), size)]


@dataclass(frozen=True)
class RawWrite:
    """One GATT write: exactly `data` on the wire, then (if > 0) a sleep before the next write."""
    data: bytes
    delay_after_ms: float = 0.0


@dataclass
class RawPlan:
    writes: list[RawWrite] = field(default_factory=list)

    @property
    def total_bytes(self) -> int:
        return sum(len(w.data) for w in self.writes)

    @property
    def total_delay_ms(self) -> float:
        return sum(w.delay_after_ms for w in self.writes)


def plan_from_stream(payload: bytes, *, chunk_size: int = MAX_CHUNK_BYTES) -> RawPlan:
    """A zero-gap plan: `payload` split at `chunk_size`-byte ATT boundaries, no delay between any of
    the writes (A7/A7c/A8's zero-application-gap byte stream)."""
    return RawPlan(writes=[RawWrite(chunk, 0.0) for chunk in split_at(payload, chunk_size)])


def plan_from_segments(segments: Sequence[bytes | str],
                       delays_ms: float | Sequence[float] = 0.0) -> RawPlan:
    """One `RawWrite` per supplied segment, in order, never re-chunked or coalesced: each segment
    stays exactly one GATT write (A7b: `$AMMO,0,2` and `3,50,1,*` each land as their own write).

    `delays_ms` is either one value applied to every gap, or a sequence with one delay per gap
    (`len(segments) - 1` entries: A7b's "wait 60 ms" between two writes is one gap for two segments).
    No delay follows the last write -- there is nothing left to wait for.
    """
    segs = [s.encode("utf-8") if isinstance(s, str) else bytes(s) for s in segments]
    n_gaps = max(0, len(segs) - 1)
    if isinstance(delays_ms, (int, float)):
        gaps = [float(delays_ms)] * n_gaps
    else:
        gaps = [float(d) for d in delays_ms]
        if len(gaps) != n_gaps:
            raise ValueError(
                f"expected {n_gaps} delay(s) between {len(segs)} segment(s), got {len(gaps)}")
    writes = [RawWrite(seg, gaps[i] if i < n_gaps else 0.0) for i, seg in enumerate(segs)]
    return RawPlan(writes=writes)


def validate_plan(plan: RawPlan, *, max_chunk: int = MAX_CHUNK_BYTES,
                  allow_incomplete: bool = False, confirm: bool = False) -> list[str]:
    """Refuse `plan` if it breaks a bound or a safety rule; otherwise return a (possibly empty) list
    of warnings. Raises `ValueError` with the reason -- never returns a partial pass.

    Bounds: every write is 1..`max_chunk` bytes, at most `MAX_WRITES` writes, at most
    `MAX_TOTAL_BYTES` total, every delay 0..`MAX_DELAY_MS`, at most `MAX_TOTAL_DELAY_MS` of delay
    altogether.

    Safety: the writes are concatenated back into one byte stream (the shape the gun's parser
    actually sees) and run through `protocol.extract_frames`. Any decoded frame in
    `DENIED_COMMANDS`/`HANG_PRONE_COMMANDS` is refused outright -- no `allow_hang` override exists
    here, unlike `server.send`: this helper has no supervised-hang path. A frame outside the
    known-safe list needs `confirm=True`, the same rule `server.send` applies. A trailing incomplete
    frame (A4's lost `'*'`) is refused unless `allow_incomplete=True`, in which case it comes back as
    a warning telling the caller to send `$*` next.
    """
    if not plan.writes:
        raise ValueError("plan has no writes")
    if len(plan.writes) > MAX_WRITES:
        raise ValueError(f"plan has {len(plan.writes)} writes, more than the {MAX_WRITES}-write bound")
    total_bytes = plan.total_bytes
    if total_bytes > MAX_TOTAL_BYTES:
        raise ValueError(f"plan totals {total_bytes} B, more than the {MAX_TOTAL_BYTES} B bound")
    total_delay_ms = plan.total_delay_ms
    if total_delay_ms > MAX_TOTAL_DELAY_MS:
        raise ValueError(
            f"plan totals {total_delay_ms:.0f} ms of delay, more than the {MAX_TOTAL_DELAY_MS:.0f} ms bound")
    for i, w in enumerate(plan.writes):
        if not (1 <= len(w.data) <= max_chunk):
            raise ValueError(f"write {i} is {len(w.data)} B; every write must be 1..{max_chunk} B")
        if not (0 <= w.delay_after_ms <= MAX_DELAY_MS):
            raise ValueError(
                f"write {i}'s delay is {w.delay_after_ms} ms; every delay must be 0..{MAX_DELAY_MS:.0f} ms")

    payload = b"".join(w.data for w in plan.writes)
    text = payload.decode("utf-8", errors="replace")
    first = text.find("$")
    if first < 0:
        raise ValueError("payload holds no '$' frame at all (a shell may have expanded '$AMMO' "
                         "inside double quotes: single-quote every frame)")
    if text[:first].strip():
        # The gun's parser may still hold a fragment from an earlier run; leading bytes would complete
        # it (an earlier '$FACT' plus 'ORY,*' is a denied $FACTORY). Nothing in A4-A8 needs this.
        raise ValueError(f"refused: bytes before the first '$' ({text[:first]!r}) could complete a "
                         "frame the gun already holds")
    warnings: list[str] = []
    pieces = ["$" + p for p in text[first + 1:].split("$")]
    for n, piece in enumerate(pieces):
        star = piece.find("*")
        if star < 0:
            last = n == len(pieces) - 1
            where = "ends with" if last else "holds"
            if not allow_incomplete:
                raise ValueError(
                    f"payload {where} an incomplete frame ({piece!r}); refused unless "
                    "allow_incomplete=True (the A4 lost-'*' case)")
            warnings.append(
                f"payload {where} an incomplete frame ({piece!r})"
                + ("; send '$*' next to reset the gun's parser before the next real frame" if last
                   else "; the next '$' starts a new frame over its stale tokens"))
            frame = piece
        else:
            frame, tail = piece[:star + 1], piece[star + 1:]
            if tail.strip():
                raise ValueError(f"refused: bytes after a frame's '*' ({tail!r}) sit outside any frame")
            if frame == "$*":
                continue                        # the bare parser reset (screamers A4): always allowed
        reason = protocol.deny_reason(frame)   # allow_hang defaults False: no override, ever, here
        if reason:
            raise ValueError(f"refused, confirm or not: {reason}")
        if not protocol.is_known_safe(frame) and not confirm:
            raise ValueError(
                f"'{protocol.command_name(frame)}' is not in the known-safe command list; "
                "retry with confirm=True if you intend to send it")
    return warnings


@dataclass
class RawWriteLog:
    """One completed GATT write, logged AFTER it finished (not when it was queued): `t_done_ms` is
    when the write actually returned, so a screamer lock-up shows up as a write with no `t_done_ms`
    at all rather than a falsely-timestamped one."""
    index: int
    n_bytes: int
    text: str
    t_start_ms: float
    t_done_ms: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index, "bytes": self.n_bytes, "text": self.text,
            "t_start_ms": round(self.t_start_ms, 1), "t_done_ms": round(self.t_done_ms, 1),
        }


@dataclass
class RawResult:
    writes: list[RawWriteLog] = field(default_factory=list)
    reply_counts: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    # The last rx frame per command word: A4/A7b/A8 are judged on the magazine in the last `$ALCD`.
    last_frames: dict[str, str] = field(default_factory=dict)
    # After the plan: did a `$PING,*` get a `$PONG` inside `ping_after_s`? None when not asked.
    pong_after: bool | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "writes": [w.to_dict() for w in self.writes],
            "reply_counts": self.reply_counts,
            "warnings": self.warnings,
            "last_frames": self.last_frames,
            "pong_after": self.pong_after,
        }


async def write_raw(mgr: Any, alias: str, plan: RawPlan, *, clock: Clock | None = None,
                    response: bool = False, read_ms: int = 0, max_chunk: int = MAX_CHUNK_BYTES,
                    allow_incomplete: bool = False, confirm: bool = False,
                    ping_after_s: float = 0.0) -> RawResult:
    """Execute `plan` on `alias`'s session, exactly as written: no re-chunking, no extra pacing, no
    application sleep the plan did not ask for.

    Validated every time (see `validate_plan`), so a `RawPlan` built by hand still gets the bounds and
    safety checks -- there is no bypass for constructing one directly.

    The session's `write_lock` is held for the WHOLE plan, delays included: `ble.py`'s own rule is
    "hold it for the whole frame, not per chunk" (a second writer's chunks must never interleave with
    this one on the wire), and here the "frame" is the caller's whole plan, since the gun's parser
    sees one continuous byte stream regardless of how many independent writers queued pieces of it.

    Each write is logged (`session.record("tx-raw", ...)`, direction `tx-raw` so it is easy to find in
    a session JSONL) only AFTER `write_gatt_char` returns -- a write that never completes (the
    screamer mechanism this exists to characterise) never gets a log entry pretending it did.

    `read_ms` (default 0: no listening) optionally waits after the plan and counts buffered rx events
    by command word (`$PONG` for A7c, `$ALCD` for A7b/A8, ...).
    """
    clock = clock or Clock()
    warnings = validate_plan(plan, max_chunk=max_chunk, allow_incomplete=allow_incomplete,
                             confirm=confirm)
    if alias not in mgr.sessions:
        known = ", ".join(mgr.sessions) or "(none)"
        raise ValueError(f"no connection with alias '{alias}'; connected: {known}")
    session = mgr.sessions[alias]

    logs: list[RawWriteLog] = []
    # Count replies from BEFORE the first write: a $PONG can arrive while the stream is still going.
    seq_before = session.seq
    async with session.write_lock:
        for i, w in enumerate(plan.writes):
            t_start = clock.now() * 1000
            await session.client.write_gatt_char(NUS_RX_CHAR_UUID, w.data, response=response)
            t_done = clock.now() * 1000
            text = w.data.decode("utf-8", errors="replace")
            session.record("tx-raw", text)
            logs.append(RawWriteLog(index=i, n_bytes=len(w.data), text=text,
                                    t_start_ms=t_start, t_done_ms=t_done))
            if w.delay_after_ms > 0:
                await clock.sleep(w.delay_after_ms / 1000)

    reply_counts: dict[str, int] = {}
    last_frames: dict[str, str] = {}
    if read_ms > 0:
        await clock.sleep(read_ms / 1000)
        out = mgr.get_events(alias, since_seq=seq_before, max_events=100_000)
        for ev in out["events"]:
            if ev["direction"] != "rx":
                continue
            name = protocol.command_name(ev["raw"])
            reply_counts[name] = reply_counts.get(name, 0) + 1
            last_frames[name] = ev["raw"]

    pong_after: bool | None = None
    if ping_after_s > 0:
        # The screamers LOCK-UP definition: no `$PONG` within 10 s of a `$PING`. One complete, safe
        # frame, written only after the plan (and its lock) is done.
        mark = session.seq
        async with session.write_lock:
            await session.client.write_gatt_char(NUS_RX_CHAR_UUID, b"$PING,*", response=False)
            session.record("tx", "$PING,*")
        pong_after = False
        waited = 0.0
        while waited < ping_after_s:
            await clock.sleep(0.25)
            waited += 0.25
            out = mgr.get_events(alias, since_seq=mark, max_events=100_000)
            if any(e["direction"] == "rx" and protocol.command_name(e["raw"]) == "PONG"
                   for e in out["events"]):
                pong_after = True
                break

    return RawResult(writes=logs, reply_counts=reply_counts, warnings=warnings,
                     last_frames=last_frames, pong_after=pong_after)
