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
        self.responses: list[bool] = []  # F270: the `response=` each write_gatt_char call carried

    async def write_gatt_char(self, _uuid, data, response=False):
        await asyncio.sleep(self.delay_s)
        self.writes.append(bytes(data))
        self.responses.append(response)


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


# F270 (transport-hardening.md §5, FOLLOWUPS): response_for_multi_packet. Off by default (module flag
# RESPONSE_FOR_MULTI_PACKET) -- pin today's behaviour, that every chunk still carries response=False --
# and, passed True for one call, only a payload over one chunk is affected.
def test_response_for_multi_packet_off_by_default_pins_todays_behaviour():
    async def go():
        c = _Client()
        long_command = "$" + "A" * 30 + ",*"       # two chunks at the default chunk_size=20
        assert len(long_command) > 20
        await _mgr(c).send_phone_paced("g", long_command, chunk_gap_ms=0, frame_gap_ms=0)
        assert c.responses == [False, False]
    run(go())


def test_response_for_multi_packet_on_affects_only_a_multi_packet_payload():
    async def go():
        long_command = "$" + "A" * 30 + ",*"       # two chunks
        short_command = "$PING,*"                  # one chunk
        c_long = _Client()
        await _mgr(c_long).send_phone_paced("g", long_command, chunk_gap_ms=0, frame_gap_ms=0,
                                            response_for_multi_packet=True)
        assert c_long.responses == [True, True]
        c_short = _Client()
        await _mgr(c_short).send_phone_paced("g", short_command, chunk_gap_ms=0, frame_gap_ms=0,
                                             response_for_multi_packet=True)
        assert c_short.responses == [False], "a single-packet frame is never sent with response"
    run(go())


def test_write_gatt_char_response_for_multi_packet_matches_the_module_flag():
    """The lower-level `ConnectionManager._write` path (used by `send`/`send_batch`), same contract as
    `send_phone_paced` above: off by default, on only for a multi-packet payload, per-call override."""
    async def go():
        long_payload = b"$" + b"A" * 30 + b",*"
        assert len(long_payload) > 20
        c_off = _Client()
        await ConnectionManager._write(c_off, long_payload)
        assert c_off.responses == [False, False], "default (no keyword): byte-identical to before F270"
        c_on = _Client()
        await ConnectionManager._write(c_on, long_payload, response_for_multi_packet=True)
        assert c_on.responses == [True, True]
        c_single = _Client()
        await ConnectionManager._write(c_single, b"$PING,*", response_for_multi_packet=True)
        assert c_single.responses == [False], "a single-packet frame is never sent with response"
    run(go())
