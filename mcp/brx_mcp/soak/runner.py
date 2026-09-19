"""The soak run loop (docs/bench-screamers-2026-09-19.md, Phase C).

One coroutine, one clock, one tick: deliberately not a swarm of concurrent asyncio tasks, so a test
can drive it with a single fake clock without worrying about two "sleeping" tasks racing each other
to advance the same virtual clock. Real time comes from `Clock` (wraps `time.monotonic`/`asyncio.
sleep`); tests inject a fake that advances a counter instead of actually waiting (CLAUDE.md: "a mocked
clock, not sleeps").

Uses the EXISTING BLE transport (`brx_mcp.ble.ConnectionManager`), no new transport here. `mgr` is
accepted as a parameter (duck-typed the same way `brx_mcp/diag/runner.py run_case()` takes one) so
tests can pass a fake that never touches bleak/BLE hardware.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import math
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TextIO

from .. import protocol
from ..gameconfig import END_SEQUENCE
from .patterns import SoakPattern, PATTERNS, assert_pattern_is_safe

# ATT write-without-response chunk size (ble.py `_write`: MTU-3, default MTU 23 -> 20). Used only to
# ESTIMATE a packet count for the summary. The real count is whatever `ble.py` actually wrote; we do
# not have access to that number from here without changing the transport, so this is a print-time
# estimate, consistently derived the same way `ble.py` derives its own default.
_BLE_CHUNK = 20

PING_INTERVAL_S = 2.0
LOCKUP_AFTER_S = 10.0        # bench-screamers-2026-09-19.md definitions: LOCK-UP
RECONNECT_ANSWER_WINDOW_S = 5.0
TICK_S = 0.25

# `--phone-pacing` (docs/FOLLOWUPS.md F283, docs/bench-screamers-2026-09-19.md Phase C): the phone
# app's own write pacing, read from `app/src/brxlink.js` `WRITE_PACING` (2026-09-18), not guessed.
# The MCP instrument's own `ble.py _write()` sleeps a flat 20 ms after every 20-byte chunk and adds
# no frame gap, so it under-stresses a long frame by about 1.8x against the phone (F283's own maths:
# a 101-byte $WEAP frame is ~120 ms on `ble.py`, ~66 ms -- 6 chunks * 8 ms + one 18 ms frame gap --
# on the phone). PHONE_CHUNK_SIZE is the phone's hardcoded chunk (brxlink.js `write()`: `for (let o
# = 0; o < frame.length; o += 20)`; it never negotiates a bigger MTU the way `ble.py` does).
# PHONE_BLOCK_FRAMES/PHONE_BLOCK_PAUSE_MS mirror `WRITE_PACING.blockFrames`/`blockPauseMs`, which
# ship OFF (0/0) but are documented as "a bench session can try a value"
# (docs/spec/transport-hardening.md §8) -- so they are flags here too, not a hardcoded 0, ready for
# whatever value F269 turns them on with.
PHONE_CHUNK_SIZE = 20
PHONE_CHUNK_GAP_MS = 8
PHONE_FRAME_GAP_MS = 18
PHONE_BLOCK_FRAMES = 0
PHONE_BLOCK_PAUSE_MS = 0


class Clock:
    """Real time. `sleep(0)` still yields to the event loop, never blocks."""

    def now(self) -> float:
        return time.monotonic()

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(max(0.0, seconds))


@dataclass
class SoakSummary:
    pattern: str
    address: str
    minutes_requested: float
    minutes_run: float = 0.0
    frames_sent: int = 0
    packets_sent: int = 0
    lockups: list[dict[str, Any]] = field(default_factory=list)
    link_drops: list[dict[str, Any]] = field(default_factory=list)
    bad_frames: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "pattern": self.pattern, "address": self.address,
            "minutes_requested": self.minutes_requested, "minutes_run": round(self.minutes_run, 2),
            "frames_sent": self.frames_sent, "packets_sent": self.packets_sent,
            "lockups": self.lockups, "link_drops": self.link_drops, "bad_frames": self.bad_frames,
        }

    def render(self) -> str:
        lines = [
            f"=== soak summary: {self.pattern} @ {self.address} ===",
            f"  ran {self.minutes_run:.1f} of {self.minutes_requested:.1f} requested minute(s)",
            f"  frames sent: {self.frames_sent}   packets (est.): {self.packets_sent}",
            f"  LOCK-UP: {len(self.lockups)}   LINK DROP: {len(self.link_drops)}   "
            f"BAD FRAME: {len(self.bad_frames)}",
        ]
        for label, events in (("LOCK-UP", self.lockups), ("LINK DROP", self.link_drops),
                              ("BAD FRAME", self.bad_frames)):
            for ev in events:
                lines.append(f"    {label} @ t={ev['t_s']:.1f}s  {_event_detail(ev)}")
        return "\n".join(lines)


def _event_detail(ev: dict[str, Any]) -> str:
    extra = {k: v for k, v in ev.items() if k != "t_s"}
    return ", ".join(f"{k}={v}" for k, v in extra.items())


def _packets_for(cmd: str) -> int:
    return max(1, math.ceil(len(cmd.encode("utf-8")) / _BLE_CHUNK))


def _log(log_fp_path: Path | None, kind: str, **fields: Any) -> None:
    if log_fp_path is None:
        return
    line = {"wall_ts": time.time(), "kind": kind, **fields}
    with log_fp_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line) + "\n")


def _track_ammo_sent(cmd: str, expected: dict[str, tuple[int, int]]) -> None:
    """BAD FRAME bookkeeping: remember the (mag, reserve) an $AMMO frame just set for its slot, so a
    later $ALCD echo can be checked against it (see `_check_bad_frame`). $WEAP frames are NOT decoded
    here: `__main__.py`'s own comment on `WEAPON_AMMO` says the $WEAP ammo-start token positions
    "are not confidently decoded", so trusting them here would risk a false BAD FRAME. A $WEAP swap is
    verified indirectly: the arm sequence always follows it with an $AMMO frame for the same slot."""
    t = protocol.tokenize(cmd)
    if not t or t[0] != "AMMO" or len(t) < 3:
        return
    try:
        slot, mag = t[1], int(t[2])
        reserve = int(t[3]) if len(t) > 3 and t[3] != "" else 0
    except ValueError:
        return
    expected[slot] = (mag, reserve)


def _check_bad_frame(raw: str, expected: dict[str, tuple[int, int]],
                     summary: SoakSummary, t_s: float, log_path: Path | None) -> None:
    """A $WEAP/$AMMO write is verified against the gun's own next $ALCD echo (the mechanism `engine.
    js` documents at A36/A37: the gun volunteers an $ALCD carrying the magazine right after a head
    write). A mismatch is one BAD FRAME; each slot is checked once per $AMMO write, then cleared, so
    a later ammo change (a real reload) is never flagged against a stale expectation."""
    parsed = protocol.parse_alcd(raw)
    if not parsed:
        return
    slot = str(parsed.get("slot")) if parsed.get("slot") is not None else None
    if slot is None or slot not in expected:
        return
    want_mag, _want_reserve = expected.pop(slot)
    got_mag = parsed.get("mag")
    if got_mag is not None and got_mag != want_mag:
        ev = {"t_s": t_s, "slot": slot, "expected_mag": want_mag, "got_mag": got_mag, "raw": raw}
        summary.bad_frames.append(ev)
        _log(log_path, "BAD_FRAME", **ev)


async def _reconnect(mgr: Any, address: str, alias: str, clock: Clock) -> bool:
    """LINK DROP recovery: drop the stale session, reconnect, then send one $PING and see whether a
    $PONG comes back within `RECONNECT_ANSWER_WINDOW_S`: "record whether the gun answers again"
    (bench-screamers-2026-09-19.md). Mirrors `__main__.py _diag()`'s own reconnect recovery (drop the
    stale session by alias, retry connect) rather than inventing a second way to do it."""
    with contextlib.suppress(Exception):
        await mgr.disconnect(alias)
    mgr.sessions.pop(alias, None)
    try:
        await mgr.connect(address, alias)
    except Exception:  # noqa: BLE001 -- reconnect failed, the gun did not come back
        return False
    seq_before = mgr.sessions[alias].seq
    await mgr.send(alias, "$PING,*", reply_window_ms=0)
    deadline = clock.now() + RECONNECT_ANSWER_WINDOW_S
    while clock.now() < deadline:
        events = mgr.get_events(alias, since_seq=seq_before)["events"]
        if any(e["direction"] == "rx" and e["raw"].startswith("$PONG") for e in events):
            return True
        await clock.sleep(0.2)
    return False


def _print_status(stream: TextIO | None, t_s: float, summary: SoakSummary) -> None:
    if stream is None:
        return
    stream.write(
        f"\r[{t_s:7.1f}s] frames={summary.frames_sent:<6} pkts={summary.packets_sent:<6} "
        f"LOCKUP={len(summary.lockups)} DROP={len(summary.link_drops)} "
        f"BADFRAME={len(summary.bad_frames)}   ")
    stream.flush()


async def run_soak(mgr: Any, address: str, pattern: str | SoakPattern, minutes: float, *,
                   alias: str = "soak", gap_ms: int = 0, block: int | None = None,
                   pause_ms: int = 0, clock: Clock | None = None, log_path: Path | None = None,
                   status: TextIO | None = sys.stderr, phone_pacing: bool = False,
                   phone_chunk_gap_ms: int = PHONE_CHUNK_GAP_MS,
                   phone_frame_gap_ms: int = PHONE_FRAME_GAP_MS,
                   phone_block_frames: int = PHONE_BLOCK_FRAMES,
                   phone_block_pause_ms: int = PHONE_BLOCK_PAUSE_MS) -> SoakSummary:
    """Run one soak: connect, arm, replay `pattern` while probing liveness, for `minutes`.

    `gap_ms`/`block`+`pause_ms` are the Phase B pacing levers: `gap_ms` sleeps after every frame
    (on top of `ble.py`'s own 20 ms inter-chunk pacing); `block`+`pause_ms` sleeps once every `block`
    frames. Both default to 0/None: today's traffic shape, unpaced, so the tool's own default run
    reproduces current behaviour rather than a guess at a safer one.

    `phone_pacing` (F283) switches the transport itself, not just an extra sleep on top of it: each
    frame is chunked and paced through `mgr.send_phone_paced()` (`ble.py`), which copies the phone's
    own `write()` (`app/src/brxlink.js` `WRITE_PACING`) instead of `ble.py _write()`'s flat 20 ms per
    chunk. `phone_chunk_gap_ms`/`phone_frame_gap_ms`/`phone_block_frames`/`phone_block_pause_ms`
    default to the phone's own values (see the `PHONE_*` module constants) so a bare `--phone-pacing`
    reproduces today's phone traffic; passing one overrides only that lever, for whatever value a
    later bench session finds (F269 may turn the block pause on with a non-zero pair). Ignored
    (`gap_ms`/`block`/`pause_ms` still apply on top, unchanged) when `phone_pacing` is False.

    Ctrl-C (KeyboardInterrupt) ends the loop early but still runs the full teardown and returns a
    summary: "ends cleanly with the summary" (bench-screamers-2026-09-19.md). Teardown always sends
    the WHOLE of `gameconfig.END_SEQUENCE`, never a truncated prefix, so a run never ends on a bare
    `$CLEAR` (CLAUDE.md hard rule: `$CLEAR` alone leaves the gun with no `$SIR` table). If the link is
    already gone the teardown frames simply fail to send. Nothing here can wake a gun that is not
    listening, whatever sequence we ask the transport to write.
    """
    p = PATTERNS[pattern] if isinstance(pattern, str) else pattern
    assert_pattern_is_safe(p)   # DENIED/HANG_PRONE frames are refused here regardless of phone_pacing
    clock = clock or Clock()
    summary = SoakSummary(pattern=p.name, address=address, minutes_requested=minutes)
    expected_ammo: dict[str, tuple[int, int]] = {}

    await mgr.connect(address, alias)
    if log_path is not None:
        session = mgr.sessions.get(alias)
        if session is not None:
            session.log_file = log_path
            session.log_label = f"soak-{p.name}"

    async def send(cmd: str) -> None:
        _track_ammo_sent(cmd, expected_ammo)
        if phone_pacing:
            await mgr.send_phone_paced(alias, cmd, chunk_gap_ms=phone_chunk_gap_ms,
                                       frame_gap_ms=phone_frame_gap_ms,
                                       chunk_size=PHONE_CHUNK_SIZE)
        else:
            await mgr.send(alias, cmd, reply_window_ms=0)
        summary.frames_sent += 1
        summary.packets_sent += _packets_for(cmd)
        if gap_ms:
            await clock.sleep(gap_ms / 1000)
        if block and summary.frames_sent % block == 0:
            await clock.sleep((pause_ms or 0) / 1000)
        # Differs from the phone: brxlink.js counts `blockFrames` inside ONE multi-frame write() call,
        # while the soak sends one frame per call and counts across the run. Same while both ship 0/0;
        # revisit when F269 sets real block values.
        if (phone_pacing and phone_block_frames and phone_block_pause_ms
                and summary.frames_sent % phone_block_frames == 0):
            await clock.sleep(phone_block_pause_ms / 1000)

    t0 = clock.now()
    # captured BEFORE the arm sequence, not after: the gun's own $ALCD echo to an armed $AMMO frame
    # (engine.js A36/A37, see `_check_bad_frame`) can arrive while `once` is still sending, and a
    # `last_seq` taken afterwards would silently put that echo below the floor and never see it.
    last_seq = mgr.sessions[alias].seq if alias in mgr.sessions else 0

    for cmd in p.once:
        await send(cmd)

    next_due = {g.name: t0 + g.offset_s for g in p.repeating}   # offset_s: a group's first fire, after the arm
    next_ping = t0
    last_pong_at = t0
    lockup_open = False
    deadline = t0 + minutes * 60

    try:
        while clock.now() < deadline:
            now = clock.now()

            if now >= next_ping:
                await send("$PING,*")
                next_ping = now + PING_INTERVAL_S

            for g in p.repeating:
                if now >= next_due[g.name]:
                    for cmd in g.frames:
                        await send(cmd)
                    now = clock.now()
                    next_due[g.name] = now + g.every_s   # every_s==0 -> due again immediately

            connected = mgr.is_connected(alias)
            if connected:
                out = mgr.get_events(alias, since_seq=last_seq)
                for ev in out["events"]:
                    last_seq = max(last_seq, ev["seq"])
                    if ev["direction"] != "rx":
                        continue
                    raw = ev["raw"]
                    if raw.startswith("$PONG"):
                        last_pong_at = now
                        lockup_open = False
                    elif raw.startswith("$ALCD"):
                        _check_bad_frame(raw, expected_ammo, summary, now - t0, log_path)
            else:
                dropped_at = now - t0
                answered = await _reconnect(mgr, address, alias, clock)
                ev = {"t_s": dropped_at, "reconnected": answered}
                summary.link_drops.append(ev)
                _log(log_path, "LINK_DROP", **ev)
                last_pong_at = clock.now()
                lockup_open = False
                last_seq = mgr.sessions[alias].seq if alias in mgr.sessions else 0

            if connected and (now - last_pong_at) >= LOCKUP_AFTER_S and not lockup_open:
                lockup_open = True
                ev = {"t_s": now - t0, "silent_for_s": round(now - last_pong_at, 1)}
                summary.lockups.append(ev)
                _log(log_path, "LOCKUP", **ev)

            _print_status(status, now - t0, summary)
            await clock.sleep(TICK_S)
    except KeyboardInterrupt:
        pass
    finally:
        summary.minutes_run = (clock.now() - t0) / 60
        with contextlib.suppress(Exception):
            for cmd in END_SEQUENCE:
                await send(cmd)
        with contextlib.suppress(Exception):
            await mgr.disconnect(alias)
        if status is not None:
            status.write("\n")

    return summary
