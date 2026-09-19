"""`ConnectionManager.send_phone_paced` against a fake client (F283, polish review 2026-09-18).

Two properties of the phone's write queue (`app/src/brxlink.js`) that the soak must copy:
a native write that has not answered within `ackCapMs` is counted late and the next chunk goes
anyway, and the frame gap is part of the queue, so no other writer gets the link during it.
No BLE: the client is a stand-in with a controllable `write_gatt_char`.
"""
from __future__ import annotations

import asyncio

from _async import run
from _skip import Skipped

try:
    from brx_mcp.ble import ConnectionManager, Session
except ImportError as e:  # bleak missing under the system python
    raise Skipped(f"bleak not installed: {e}")


class _Client:
    def __init__(self, delay_s: float = 0.0) -> None:
        self.delay_s = delay_s
        self.writes: list[bytes] = []

    async def write_gatt_char(self, _uuid, data, response=False):
        await asyncio.sleep(self.delay_s)
        self.writes.append(bytes(data))


def _mgr(client: _Client) -> ConnectionManager:
    m = ConnectionManager()
    m.sessions["g"] = Session(alias="g", address="AA", client=client)  # type: ignore[arg-type]
    return m


def test_a_slow_write_is_counted_late_and_the_next_chunk_still_goes():
    async def go():
        c = _Client(delay_s=0.2)
        out = await _mgr(c).send_phone_paced("g", "$" + "A" * 30 + ",*", chunk_gap_ms=1,
                                             frame_gap_ms=1, ack_cap_ms=20)
        assert out["chunks"] == 2 and out["late_acks"] == 2
        await asyncio.sleep(0.3)                  # the writes were not cancelled
        assert len(c.writes) == 2
    run(go())


def test_a_prompt_write_is_not_late():
    async def go():
        out = await _mgr(_Client()).send_phone_paced("g", "$PING,*", chunk_gap_ms=1, frame_gap_ms=1)
        assert out["late_acks"] == 0
    run(go())


def test_the_frame_gap_holds_the_write_lock():
    async def go():
        m = _mgr(_Client())
        lock = m.sessions["g"].write_lock
        loop = asyncio.get_running_loop()
        t0 = loop.time()
        send = asyncio.ensure_future(m.send_phone_paced("g", "$PING,*", chunk_gap_ms=0, frame_gap_ms=150))
        await asyncio.sleep(0.02)                 # the chunk is written; the frame gap is running
        async with lock:
            waited = loop.time() - t0
        await send
        assert waited >= 0.14, waited
    run(go())
