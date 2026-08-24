"""BLE connection manager for BRX taggers (Gen2/3, Nordic UART Service).

Holds multiple simultaneous BleakClient sessions keyed by alias. Each session
buffers tagger→host notifications into a ring buffer with monotonic sequence
numbers so an MCP client can poll with get_events / block with wait_for.

Gen1 taggers use Bluetooth Classic (SPP) which bleak cannot reach; identify()
reports that so the user can fall back to a paired COM port + pyserial.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError

from .protocol import (
    NUS_RX_CHAR_UUID,
    NUS_SERVICE_UUID,
    NUS_TX_CHAR_UUID,
    BufferedEvent,
    parse_event,
)

BUFFER_SIZE = 5000


@dataclass
class Session:
    alias: str
    address: str
    client: BleakClient
    opened_at: float = field(default_factory=time.monotonic)
    seq: int = 0
    buffer: deque[BufferedEvent] = field(default_factory=lambda: deque(maxlen=BUFFER_SIZE))
    new_event: asyncio.Event = field(default_factory=asyncio.Event)
    last_seen: float | None = None
    rx_partial: str = ""
    log_file: Path | None = None
    log_label: str | None = None

    def t_ms(self) -> int:
        return int((time.monotonic() - self.opened_at) * 1000)

    def record(self, direction: str, raw: str) -> BufferedEvent:
        self.seq += 1
        ev = BufferedEvent(
            seq=self.seq,
            t_ms=self.t_ms(),
            direction=direction,
            raw=raw,
            parsed=parse_event(raw) if direction == "rx" else {},
        )
        self.buffer.append(ev)
        if direction == "rx":
            self.last_seen = time.monotonic()
        if self.log_file is not None:
            with self.log_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"wall_ts": time.time(), **ev.to_dict()}) + "\n")
        self.new_event.set()
        return ev


class ConnectionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}

    # -- discovery ---------------------------------------------------------

    async def scan(self, duration_s: int = 8) -> list[dict[str, Any]]:
        devices = await BleakScanner.discover(timeout=duration_s, return_adv=True)
        results = []
        for address, (device, adv) in devices.items():
            uuids = [u.lower() for u in (adv.service_uuids or [])]
            results.append({
                "name": device.name or adv.local_name or "",
                "address": address,
                "rssi": adv.rssi,
                "has_uart_service": NUS_SERVICE_UUID in uuids,
            })
        results.sort(key=lambda d: (not d["has_uart_service"], -(d["rssi"] or -999)))
        return results

    async def identify(self, address: str) -> dict[str, Any]:
        """Connect briefly, send $PING,*, report reachability and generation."""
        info: dict[str, Any] = {"address": address, "reachable": False,
                               "generation": "unknown", "pong_latency_ms": None}
        try:
            async with BleakClient(address, timeout=15.0) as client:
                info["reachable"] = True
                got_pong = asyncio.Event()
                reply: list[str] = []

                def on_notify(_char: Any, data: bytearray) -> None:
                    text = data.decode("utf-8", errors="replace")
                    reply.append(text)
                    if "PONG" in text:
                        got_pong.set()

                await client.start_notify(NUS_TX_CHAR_UUID, on_notify)
                t0 = time.monotonic()
                await client.write_gatt_char(NUS_RX_CHAR_UUID, b"$PING,*", response=False)
                try:
                    await asyncio.wait_for(got_pong.wait(), timeout=5.0)
                    info["pong_latency_ms"] = int((time.monotonic() - t0) * 1000)
                    info["generation"] = "Gen2/3 (BLE + PONG)"
                except asyncio.TimeoutError:
                    info["generation"] = "BLE reachable but no PONG — may not be a BRX"
                info["raw_replies"] = reply
                await client.stop_notify(NUS_TX_CHAR_UUID)
        except Exception as e:  # noqa: BLE001 — surface everything to the model
            info["error"] = str(e)
            info["note"] = (
                "If this device never appears on BLE scans it may be a Gen1 tagger "
                "(Bluetooth Classic/SPP, 57600 baud, headset must be connected). "
                "Pair it in the OS and use a serial COM port instead."
            )
        return info

    # -- lifecycle ---------------------------------------------------------

    async def connect(self, address: str, alias: str, pair: bool = False,
                      attempts: int = 5) -> dict[str, Any]:
        """Connect, retrying — establishment is intermittent, holding is not.

        Verified 2026-08-23: a session that comes up cleanly runs for 75 s+,
        but roughly 1 connect in 3 succeeds (the official app shows the same
        behaviour). A single failed attempt says nothing about the link, so
        retry rather than surfacing the first error.
        """
        if alias in self.sessions:
            raise ValueError(f"alias '{alias}' already connected to "
                             f"{self.sessions[alias].address}")
        last_error: Exception | None = None
        for attempt in range(1, attempts + 1):
            client = BleakClient(address, timeout=20.0)
            try:
                await client.connect()
                break
            except Exception as e:  # noqa: BLE001 — any failure is retryable
                last_error = e
                try:
                    await client.disconnect()
                except Exception:  # noqa: BLE001
                    pass
                if attempt < attempts:
                    await asyncio.sleep(1.5)
        else:
            raise BleakError(
                f"could not connect to {address} after {attempts} attempts; "
                f"last error: {type(last_error).__name__}: {last_error}"
            ) from last_error
        if pair:
            # CoreBluetooth has no explicit pairing API — it bonds implicitly
            # when a characteristic demands encryption. Don't die on macOS.
            try:
                await client.pair()
            except NotImplementedError:
                pass
        session = Session(alias=alias, address=address, client=client)

        def on_notify(_char: Any, data: bytearray) -> None:
            # Frames can arrive split across notifications; reassemble on ',*'
            session.rx_partial += data.decode("utf-8", errors="replace")
            while ",*" in session.rx_partial:
                frame, session.rx_partial = session.rx_partial.split(",*", 1)
                session.record("rx", frame + ",*")

        await client.start_notify(NUS_TX_CHAR_UUID, on_notify)
        self.sessions[alias] = session
        return {"alias": alias, "address": address, "connected": True}

    async def disconnect(self, alias: str) -> dict[str, Any]:
        session = self._get(alias)
        try:
            await session.client.disconnect()
        finally:
            del self.sessions[alias]
        return {"alias": alias, "disconnected": True}

    def list_connections(self) -> list[dict[str, Any]]:
        out = []
        for s in self.sessions.values():
            out.append({
                "alias": s.alias,
                "address": s.address,
                "connected": s.client.is_connected,
                "buffer_depth": len(s.buffer),
                "last_seq": s.seq,
                "last_seen_s_ago": (round(time.monotonic() - s.last_seen, 1)
                                    if s.last_seen else None),
                "logging": s.log_label,
            })
        return out

    # -- I/O ---------------------------------------------------------------

    @staticmethod
    async def _write(client: BleakClient, payload: bytes) -> None:
        # ATT write-without-response caps at MTU-3 (20 bytes at the default
        # MTU of 23, which the tagger sticks to). NUS is a byte stream, so
        # long frames are chunked; the tagger reassembles on ',*'.
        try:
            chunk = max(20, (client.mtu_size or 23) - 3)
        except Exception:  # noqa: BLE001 — backend without mtu_size
            chunk = 20
        for i in range(0, len(payload), chunk):
            await client.write_gatt_char(
                NUS_RX_CHAR_UUID, payload[i:i + chunk], response=False)
            await asyncio.sleep(0.02)

    async def send(self, alias: str, command: str,
                   reply_window_ms: int = 500) -> dict[str, Any]:
        session = self._get(alias)
        seq_before = session.seq
        session.record("tx", command)
        await self._write(session.client, command.encode("utf-8"))
        await asyncio.sleep(reply_window_ms / 1000)
        replies = [e.to_dict() for e in list(session.buffer)
                   if e.seq > seq_before + 1 and e.direction == "rx"]
        return {"sent": command, "replies_within_window": replies}

    async def send_batch(self, alias: str, commands: list[str],
                         gap_ms: int = 100) -> dict[str, Any]:
        session = self._get(alias)
        seq_before = session.seq
        for cmd in commands:
            session.record("tx", cmd)
            await self._write(session.client, cmd.encode("utf-8"))
            await asyncio.sleep(gap_ms / 1000)
        replies = [e.to_dict() for e in list(session.buffer)
                   if e.seq > seq_before and e.direction == "rx"]
        return {"sent_count": len(commands), "replies": replies}

    def get_events(self, alias: str, since_seq: int = 0,
                   max_events: int = 200) -> dict[str, Any]:
        session = self._get(alias)
        events = [e.to_dict() for e in list(session.buffer) if e.seq > since_seq]
        truncated = len(events) > max_events
        events = events[:max_events]
        return {
            "alias": alias,
            "events": events,
            "last_seq": session.seq,
            "truncated": truncated,
        }

    async def wait_for(self, alias: str, prefix: str,
                       timeout_s: int = 30) -> dict[str, Any]:
        session = self._get(alias)
        deadline = time.monotonic() + timeout_s
        floor_seq = session.seq
        while True:
            for e in list(session.buffer):
                if (e.seq > floor_seq and e.direction == "rx"
                        and e.raw.startswith(prefix)):
                    return {"matched": True, "event": e.to_dict()}
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return {"matched": False,
                        "timeout_s": timeout_s,
                        "note": f"no message starting with '{prefix}' arrived"}
            session.new_event.clear()
            try:
                await asyncio.wait_for(session.new_event.wait(),
                                       timeout=min(remaining, 1.0))
            except asyncio.TimeoutError:
                pass

    # -- diagnostics -------------------------------------------------------

    async def diagnose(self, address: str, volts_wait_s: int = 6) -> dict[str, Any]:
        """One-shot BLE health sweep of a single tagger: connect, read firmware
        (`$VERSION`), ping latency (`$PING`→`$PONG`), and battery (`$VOLTS`,
        which streams ~30 s in app mode), then disconnect. Returns one record.
        Never raises for an unreachable tagger — reports it in the record.
        """
        rec: dict[str, Any] = {"address": address, "reachable": False,
                               "firmware": None, "battery": None,
                               "pong_latency_ms": None}
        alias = f"__diag_{address}"
        if alias in self.sessions:  # stale from a prior aborted sweep
            try:
                await self.disconnect(alias)
            except Exception:  # noqa: BLE001
                self.sessions.pop(alias, None)
        try:
            await self.connect(address, alias)
            rec["reachable"] = True

            # firmware
            await self.send(alias, "$VERSION,*", reply_window_ms=100)
            vr = await self.wait_for(alias, "$VERSION", timeout_s=3)
            if vr.get("matched"):
                p = vr["event"]["parsed"]
                rec["firmware"] = p.get("firmware")
                rec["host_image"] = p.get("host_image")
                rec["is_devhost"] = p.get("is_devhost")

            # ping latency
            t0 = time.monotonic()
            await self.send(alias, "$PING,*", reply_window_ms=100)
            pr = await self.wait_for(alias, "$PONG", timeout_s=3)
            if pr.get("matched"):
                rec["pong_latency_ms"] = int((time.monotonic() - t0) * 1000)

            # battery — VOLTS streams periodically; wait a little for one
            br = await self.wait_for(alias, "$VOLTS", timeout_s=volts_wait_s)
            if br.get("matched"):
                p = br["event"]["parsed"]
                rec["battery"] = {"pack_v": p.get("pack_v"),
                                  "cell_v": p.get("cell_v"),
                                  "charge_pct": p.get("charge_pct")}
        except Exception as e:  # noqa: BLE001 — report, don't crash a fleet sweep
            rec["error"] = f"{type(e).__name__}: {e}"
        finally:
            try:
                await self.disconnect(alias)
            except Exception:  # noqa: BLE001
                self.sessions.pop(alias, None)
        return rec

    async def fleet_status(self, addresses: list[str] | None = None,
                           scan_s: int = 8) -> dict[str, Any]:
        """Armory dashboard: if addresses is None, scan for BRX (Nordic-UART)
        devices first, then diagnose each **serially** (one radio → one BLE
        link at a time). Returns the scan list + a per-tagger diagnostic record.
        """
        scanned = await self.scan(scan_s)
        if addresses is None:
            addresses = [d["address"] for d in scanned if d["has_uart_service"]]
        rssi = {d["address"]: d["rssi"] for d in scanned}
        names = {d["address"]: d["name"] for d in scanned}
        fleet = []
        for addr in addresses:
            rec = await self.diagnose(addr)
            rec["name"] = names.get(addr, "")
            rec["rssi"] = rssi.get(addr)
            fleet.append(rec)
        return {"scanned": len(scanned), "taggers": fleet}

    # -- helpers -----------------------------------------------------------

    def _get(self, alias: str) -> Session:
        if alias not in self.sessions:
            known = ", ".join(self.sessions) or "(none)"
            raise ValueError(f"no connection with alias '{alias}'; connected: {known}")
        return self.sessions[alias]
