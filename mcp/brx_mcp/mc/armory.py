"""M-ARMORY adapter for MC (docs/spec/contracts.md §1.1; the retired armory.md is docs/archive/spec-armory.md): list() over the USB inventory,
scan-only BLE presence/identity → ScanRow[], bind_player validation. Thin by design."""
from __future__ import annotations

import logging
import platform
import time

from .types import ArmoryRecord, ScanRow

log = logging.getLogger("brx.mc.armory")


def _to_record(serial: str, r: dict) -> ArmoryRecord:
    addr = r.get("ble_address") or ""
    tail = "".join(ch for ch in addr if ch.isalnum())[-4:].upper() if addr else ""
    ble = {"tail": tail}
    if addr:
        ble["uuid" if platform.system() == "Darwin" else "address"] = addr
    return {"gun_id": serial, "sticker": (r.get("gun_name") or f"Tactix-{tail}").strip(), "headset_pin": serial,
            "ble": ble, "gen": "gen1" if r.get("gen") == "gen1" else "gen2_3", "fw": r.get("firmware") or r.get("fw"),
            "labeled": bool(r.get("labeled")), "notes": r.get("notes", "")}


class LocalArmory:
    def list(self) -> list[ArmoryRecord]:
        try:
            from brx_mcp.usbconsole import load_inventory
            inv = load_inventory()
        except Exception as e:
            log.warning("armory inventory unavailable: %s", e)
            return []
        return [_to_record(s, r) for s, r in inv.items()]

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
        try:
            correlate([{"name": d["name"], "address": d["address"]} for d in taggers])
        except Exception as e:
            log.warning("correlate failed: %s", e)
        inv = load_inventory()
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
