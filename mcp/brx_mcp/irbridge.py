"""Claude↔hardware bridge: drive the ESP32-S3 IR board over USB serial.

The ESP32 runs `hardware/esp32-ir-bridge/ir_capture.ino` (streams RAW/DECODE lines)
or `ir_emit.ino` (accepts `TX <bits>`). This module opens the serial port and
turns those into structured frames / emit calls, so the `ir-capture` / `ir-emit`
CLI (and later MCP tools) can operate the BRX IR bench.

The line PARSER is pure (no serial) → unit-tested without hardware. `pyserial` is
already installed in the Windows venv (added for the grenade USB probe).
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class IRFrame:
    index: int
    durations_us: list[int] = field(default_factory=list)  # mark/space run lengths
    bits: str = ""                                          # decoded 25-bit string
    overflow: bool = False

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "n_edges": len(self.durations_us) + 1,
            "durations_us": self.durations_us,
            "bits": self.bits,
            "nbits": len(self.bits),
            "overflow": self.overflow,
        }


# Tolerant: `edges=` is optional; the us=[...] list is what matters.
_RAW = re.compile(r"^RAW\s+(\d+).*?us=\[([0-9,]*)\]")
_DEC = re.compile(r"^DECODE\s+bits=(\d+)\s+val=([01]*)")


def parse_frames(lines: list[str]) -> list[IRFrame]:
    """Turn a stream of firmware lines into IRFrames. Pure — testable.

    Pairs each `RAW …` line with the `DECODE …` that follows it.
    """
    frames: list[IRFrame] = []
    cur: Optional[IRFrame] = None
    for raw_line in lines:
        line = raw_line.strip()
        m = _RAW.match(line)
        if m:
            idx = int(m.group(1))
            overflow = "OVERFLOW" in line
            durs = [int(x) for x in m.group(2).split(",") if x != ""]
            cur = IRFrame(index=idx, durations_us=durs, overflow=overflow)
            frames.append(cur)
            continue
        d = _DEC.match(line)
        if d and cur is not None:
            cur.bits = d.group(2)
            cur = None
    return frames


def diff_bits(a: str, b: str) -> str:
    """Return a marker string ('.'=same, 'X'=differ) aligning two bit strings —
    handy for spotting which bits carry team/mode/type when sweeping."""
    n = min(len(a), len(b))
    out = "".join("." if a[i] == b[i] else "X" for i in range(n))
    if len(a) != len(b):
        out += f"  (len {len(a)} vs {len(b)})"
    return out


def find_esp32_port() -> Optional[str]:
    """Best-effort auto-detect of the ESP32's serial port (CP210x/CH340/native-USB
    CDC). Returns a device string (e.g. 'COM7' / '/dev/ttyACM0') or None."""
    try:
        import serial.tools.list_ports as lp
    except Exception:
        return None
    cands = []
    for p in lp.comports():
        blob = f"{p.description} {p.manufacturer} {p.hwid}".lower()
        if any(k in blob for k in
               ("cp210", "ch340", "ch910", "esp32", "usb serial", "usb jtag",
                "espressif", "1a86", "10c4", "303a")):  # 303a = Espressif VID
            cands.append(p.device)
    return cands[0] if cands else None


class IRBridge:
    """Thin serial wrapper around the ESP32 IR firmware."""

    def __init__(self, port: Optional[str] = None, baud: int = 115200,
                 timeout: float = 0.2):
        self.port = port or find_esp32_port()
        if not self.port:
            raise RuntimeError("no ESP32 serial port found (pass one explicitly)")
        import serial  # local import so the module loads without pyserial on WSL
        self._ser = serial.Serial(self.port, baud, timeout=timeout)
        time.sleep(0.3)

    def close(self) -> None:
        try:
            self._ser.close()
        except Exception:
            pass

    def _readlines(self, secs: float) -> list[str]:
        out: list[str] = []
        buf = b""
        end = time.time() + secs
        while time.time() < end:
            n = self._ser.in_waiting
            chunk = self._ser.read(n or 1)
            if chunk:
                buf += chunk
                while b"\n" in buf:
                    ln, buf = buf.split(b"\n", 1)
                    out.append(ln.decode("ascii", "ignore").rstrip("\r"))
        return out

    def capture(self, secs: float = 15.0) -> list[IRFrame]:
        """Listen for `secs`; return decoded IR frames (fire the gun during it)."""
        return parse_frames(self._readlines(secs))

    def emit(self, bits: str, repeat: int = 1) -> str:
        """Send a frame via ir_emit.ino. Returns the firmware's ack line(s)."""
        cmd = (f"TXN {repeat} {bits}" if repeat > 1 else f"TX {bits}")
        self._ser.write((cmd + "\n").encode())
        return " | ".join(self._readlines(0.6))

    def ping(self) -> bool:
        self._ser.write(b"PING\n")
        return any("PONG" in ln for ln in self._readlines(0.5))
