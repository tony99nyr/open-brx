"""M-ARMORY adapter for MC (docs/spec/contracts.md §1.1; the retired armory.md is docs/archive/spec-armory.md): list() over the USB inventory,
scan-only BLE presence/identity → ScanRow[], bind_player validation. Thin by design."""
from __future__ import annotations

import asyncio
import logging
import platform
import time

from .types import ArmoryRecord, BleId, ScanRow

log = logging.getLogger("brx.mc.armory")


def _to_record(serial: str, r: dict) -> ArmoryRecord:
    addr = r.get("ble_address") or ""
    tail = "".join(ch for ch in addr if ch.isalnum())[-4:].upper() if addr else ""
    ble: BleId = {"tail": tail}
    if addr:
        if platform.system() == "Darwin":
            ble["uuid"] = addr
        else:
            ble["address"] = addr
    return {"gun_id": serial, "sticker": (r.get("gun_name") or f"Tactix-{tail}").strip(), "headset_pin": serial,
            "ble": ble, "gen": "gen1" if r.get("gen") == "gen1" else "gen2_3", "fw": r.get("firmware") or r.get("fw"),
            "labeled": bool(r.get("labeled")), "notes": r.get("notes", "")}


class LocalArmory:
    # O2: set when an inventory read hit a corrupt armory.json, or could not read it at all. A corrupt read
    # NEVER moves the live file: it leaves it in place with an exact 0600 backup copy beside it, and every
    # write to the armory refuses until the operator's DISMISS moves the file aside (`dismiss_corrupt`, the
    # console's DISMISS). The corrupt variant is STICKY (a later read, even a good one, does not clear it) and
    # persisted (armory.json.corrupt-notice) so it survives an MC restart. The `unreadable` variant (any other
    # read failure) is transient: the next successful read clears it. While either is set the last good
    # inventory is served (else empty) and `last_read_ok` is False, so the session never replaces its gun
    # index from a failed read. Session.snapshot() surfaces the warning as `armory_corrupt`.
    corrupt: dict | None = None
    last_read_ok: bool = True

    def __init__(self) -> None:
        self._last_good: dict | None = None      # last successful inventory read, served while reads fail
        try:
            from brx_mcp.usbconsole import read_corrupt_notice
            self.corrupt = read_corrupt_notice()
        except Exception:
            self.corrupt = None

    def _note_read(self, exc: BaseException | None) -> None:
        try:
            from brx_mcp.usbconsole import InventoryCorrupt
        except Exception:      # usbconsole itself cannot be imported: nothing to classify
            InventoryCorrupt = ()      # type: ignore[assignment]
        if exc is None:
            return
        self.last_read_ok = False
        if InventoryCorrupt and isinstance(exc, InventoryCorrupt):
            self.corrupt = {"kept": str(exc.kept) if exc.kept else None, "error": exc.error}
        elif not (self.corrupt and not self.corrupt.get("unreadable")):
            # the armory could not be read (PermissionError, any OSError), which is not the same as empty.
            # Never downgrade a sticky corrupt warning to this one.
            self.corrupt = {"kept": None, "error": f"{type(exc).__name__}: {exc}", "unreadable": True}

    def _read_ok(self, inv: dict) -> None:
        self.last_read_ok = True
        self._last_good = dict(inv)
        if self.corrupt and self.corrupt.get("unreadable"):
            self.corrupt = None

    def dismiss_corrupt(self) -> bool:
        """The operator acknowledged the warning. True when there was one. For a corrupt file this is the ONLY
        place it is moved aside (under the inventory lock, only if still corrupt), so a fresh armory can be
        written again. If the move fails the exception propagates and the warning stays."""
        c = self.corrupt
        if c is None:
            return False
        if not c.get("unreadable"):
            from brx_mcp.usbconsole import dismiss_corrupt_inventory
            dismiss_corrupt_inventory()
            self._last_good = None
        self.corrupt = None
        return True

    def _load(self) -> dict:
        """The inventory, or the last known good one when this read fails (never an empty one made by a failure)."""
        try:
            from brx_mcp.usbconsole import load_inventory
            inv = load_inventory()
        except Exception as e:
            self._note_read(e)
            log.error("armory inventory unavailable: %s", e)
            return dict(self._last_good or {})
        self._read_ok(inv)
        return inv

    def list(self) -> list[ArmoryRecord]:
        return [_to_record(s, r) for s, r in self._load().items()]

    async def scan(self, duration_s: int = 6) -> list[ScanRow]:
        try:
            from brx_mcp.ble import ConnectionManager
            from brx_mcp.usbconsole import advert_basename, correlate, load_inventory
        except Exception as e:
            log.warning("BLE scan unavailable here (%s) — returning no adverts", e)
            return []
        try:
            devices = await ConnectionManager().scan(duration_s)
        except Exception as e:
            log.warning("BLE scan failed: %s", e)
            return []
        taggers = [d for d in devices if d.get("has_uart_service")]
        try:     # blocking (file lock, up to a 10 s wait): off the event loop
            await asyncio.to_thread(correlate, [{"name": d["name"], "address": d["address"]} for d in taggers])
        except Exception as e:
            self._note_read(e)      # a corrupt file makes correlate refuse: record it
            log.warning("correlate failed: %s", e)
        try:
            inv = await asyncio.to_thread(load_inventory)
            self._read_ok(inv)
        except Exception as e:
            self._note_read(e)
            log.error("armory inventory unavailable: %s", e)
            inv = dict(self._last_good or {})
        by_name = {}
        for serial, r in inv.items():
            by_name.setdefault((r.get("gun_name") or "").strip().lower(), []).append((serial, r))
        now = int(time.time() * 1000)
        rows: list[ScanRow] = []
        for d in taggers:
            name = d.get("name") or ""
            base = advert_basename(name)
            addr = d.get("address") or ""
            tail = name.rsplit("-", 1)[-1].upper() if "-" in name else "".join(ch for ch in addr if ch.isalnum())[-4:].upper()
            matches = by_name.get(base.lower(), [])
            if base.lower() in ("tactix2", "tactix"):
                identity, gun_id = ("reverted" if inv else "unknown"), None
            elif len(matches) == 1:
                gun_id = matches[0][0]
                identity = "ok" if matches[0][1].get("name_confirmed") else "unconfirmed"
            elif len(matches) > 1:
                identity, gun_id = "reverted", None
            else:
                identity, gun_id = "unknown", None
            rows.append({"tail": tail, "name": name, "basename": base, "gun_id": gun_id,
                         "rssi": int(d.get("rssi") or -99), "identity": identity, "t": now})
        return rows

    def bind_player(self, gun_id: str, player_id: str) -> None:
        if gun_id not in {r["gun_id"] for r in self.list()}:
            raise KeyError(f"unknown gun {gun_id}")
