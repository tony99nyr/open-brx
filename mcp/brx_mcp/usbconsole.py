"""USB serial-console backend (B7) — read a tagger's device record over the cable.

The BRX "Programming Port" is the Teensy's USB CDC serial port (VID 16C0). It runs a
plain serial console (NOT the BLE `$…,*` protocol): commands are case-insensitive and
CR-terminated. `QUERY` is read-only and dumps the whole device record — including the
**Serial Number/Head PIN that matches the sticker on the paired headset**, the headset
version + voltage, PlayerID, nRF flags, PCB rev, and laser power — none of which BLE
exposes (verified 2026-08-24).

Pure `parse_query()` is testable without hardware. `UsbConsole` needs pyserial + a
cabled tagger (runs on the machine with the USB port; here, the Windows tower).

Credit: the QUERY/SETUP command set is from LaserTagMods' "Pairing Headset and Tagger".
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Optional

TEENSY_VID = "16c0"   # PJRC/Teensy — the BRX gun's USB CDC


def find_tagger_port() -> Optional[str]:
    """Best-effort auto-detect of a cabled tagger's COM port (Teensy VID 16C0)."""
    try:
        import serial.tools.list_ports as lp
    except Exception:
        return None
    for p in lp.comports():
        if f"{p.hwid}".lower().find("16c0") >= 0:
            return p.device
    return None


def _num(s: Optional[str]):
    if s is None:
        return None
    s = s.strip()
    try:
        return int(s)
    except ValueError:
        try:
            return float(s)
        except ValueError:
            return s or None


def parse_query(text: str) -> dict:
    """Parse a `QUERY` device-record dump into a normalized dict (pure)."""
    def grab(pattern: str):
        m = re.search(pattern, text, re.IGNORECASE)
        if not m:
            return None
        # fields are CR-terminated and some are NUL-padded (e.g. Gun Name) — strip
        # control chars/nulls, then whitespace
        val = re.sub(r"[\x00-\x1f]", "", m.group(1)).strip()
        return val or None

    rec = {
        "gun_version": grab(r"Gun Version:\s*(\S+)"),
        "serial_head_pin": grab(r"Serial Number/Head PIN:\s*(\S+)"),
        "gun_name": grab(r"Gun Name:\s*(.+)"),
        "headset_version": grab(r"Headset Version:\s*(\S+)"),
        "gun_volts": _num(grab(r"Gun:\s*([\d.]+)\s*VOLTS")),
        "head_volts": _num(grab(r"Head:\s*([\d.]+)\s*VOLTS")),
        "player_id": _num(grab(r"PlayerID\s*[:]?\s*(\d+)")),
        "field_id": _num(grab(r"FieldID\s*[:]?\s*(\d+)")),
        "nrf_host": _num(grab(r"NRFhost\s*[:]?\s*(\d+)")),
        "nrf_slave": _num(grab(r"NRFslave\s*[:]?\s*(\d+)")),
        "dev_host": _num(grab(r"devHost\s*[:]?\s*(\d+)")),
        "grenade_pin": _num(grab(r"Grenade Pin:\s*(\d+)")),
        "laser": grab(r"Laser:\s*([^\r\n]+)"),        # "16.9 mW" or "UNTESTED"
        "laser_mw": _num(grab(r"Laser:\s*([\d.]+)\s*mW")),
        "tested_by": grab(r"Tested by:\s*(.+)"),
        "gun_burn_in": grab(r"Gun BURN in test:\s*(.+)"),
        "head_burn_in": _num(grab(r"Head BURN in test:\s*(\d+)")),
        "pcb": _num(grab(r"PCB-?\s*(\d+)")),
        "bt_chip": _num(grab(r"BTchip-?\s*(\d+)")),
        "bt_central_v": grab(r"BT central V:\s*(\S+)"),
    }
    # a linked headset = a Serial/Head PIN present and a real (non-'?') version
    hv = rec["headset_version"]
    rec["headset_linked"] = bool(rec["serial_head_pin"]) and hv not in (None, "?")
    return rec


class UsbConsole:
    """Thin pyserial wrapper around the tagger's USB CDC console."""

    def __init__(self, port: Optional[str] = None, baud: int = 115200,
                 timeout: float = 0.25):
        self.port = port or find_tagger_port()
        if not self.port:
            raise RuntimeError("no tagger USB port found (Teensy VID 16C0); pass one "
                               "explicitly, e.g. COM5 / /dev/ttyACM0")
        import serial  # local import so the module loads without pyserial on WSL
        self._ser = serial.Serial(self.port, baud, timeout=timeout)
        time.sleep(0.3)

    def close(self) -> None:
        try:
            self._ser.close()
        except Exception:
            pass

    def _read_until_quiet(self, overall_s: float = 3.0, quiet_s: float = 0.6) -> str:
        """Read until no new bytes for `quiet_s`, or `overall_s` elapses."""
        chunks: list[str] = []
        start = time.monotonic()
        last = start
        while time.monotonic() - start < overall_s:
            data = self._ser.read(256)
            if data:
                chunks.append(data.decode("utf-8", errors="replace"))
                last = time.monotonic()
            elif time.monotonic() - last >= quiet_s and chunks:
                break
        return "".join(chunks)

    def query(self) -> dict:
        """Send `QUERY` and return the parsed device record + raw text."""
        self._ser.reset_input_buffer()
        self._ser.write(b"QUERY\r")
        text = self._read_until_quiet()
        return {"port": self.port, "raw": text, **parse_query(text)}


def backup_dir() -> Path:
    from .storage import BASE_DIR
    d = BASE_DIR / "device-backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_backup(record: dict) -> Optional[Path]:
    """Save the raw QUERY dump — the ONLY local device backup (contains the headset
    PIN, so it lives under ~/.brx-mcp, never the repo). Named by serial, else port."""
    raw = record.get("raw")
    if not raw:
        return None
    name = record.get("serial_head_pin") or record.get("port", "tagger")
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", str(name))
    path = backup_dir() / f"{safe}.txt"
    path.write_text(raw, encoding="utf-8")
    return path
