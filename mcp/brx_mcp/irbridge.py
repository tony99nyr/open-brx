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

    def shot(self) -> dict:
        """Field-decode this frame (protocol/brx-ir-protocol.md). Prefers the
        firmware's decoded `bits`; falls back to decoding the raw pulses itself,
        so we don't depend on the ESP32's DECODE line being correct."""
        bits = self.bits or pulses_to_bits(self.durations_us)
        return decode_word(bits)


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


def range_stats(frames: list["IRFrame"], expected: Optional[int] = None) -> dict:
    """Summarize a capture window into a RANGE reading (pure — testable).

    For a walk-back test you stand at a tape distance, fire N shots, and read:
      detected     — IR bursts the receiver picked up (any edges)
      decoded      — clean full-length 25-bit frames (signal-quality metric)
      decode_rate  — decoded / detected  (how CLEAN the signal is at this range)
      overflow     — captures that overran the buffer (too close / noise)
      unique_patterns — distinct decoded bit-strings (should be 1 for one weapon)
    Give `expected` (= shots fired) to also get detect_rate = detected/expected
    (COVERAGE — did the shot reach at all). Both hit 0 past effective range.
    """
    n = len(frames)
    decoded = [f for f in frames if len(f.bits) == 25]
    overflow = sum(1 for f in frames if f.overflow)
    uniq = {f.bits for f in decoded if f.bits}
    out = {
        "detected": n,
        "decoded": len(decoded),
        "overflow": overflow,
        "decode_rate": round(len(decoded) / n, 3) if n else 0.0,
        "unique_patterns": len(uniq),
    }
    if expected:
        out["expected"] = expected
        out["detect_rate"] = round(min(1.0, n / expected), 3)
    return out


def diff_bits(a: str, b: str) -> str:
    """Return a marker string ('.'=same, 'X'=differ) aligning two bit strings —
    handy for spotting which bits carry team/mode/type when sweeping."""
    n = min(len(a), len(b))
    out = "".join("." if a[i] == b[i] else "X" for i in range(n))
    if len(a) != len(b):
        out += f"  (len {len(a)} vs {len(b)})"
    return out


# --- BRX IR word: pulses -> bits -> fields (protocol/brx-ir-protocol.md) ------ #
# Pure + hardware-free, so captures decode/validate offline and the field layout
# is available host-side (per-player attribution, FOLLOWUPS P2).
SYNC_MIN_US = 1500   # a mark >= this is the ~2 ms sync (matches ir_capture.ino)
MARK_ONE_US = 750    # a payload mark > this is a 1, else 0
MARK_MIN_US = 200    # ignore glitches shorter than this
PAYLOAD_BITS = 25
_IR_FIELDS = {
    "bullet": (0, 4), "player": (4, 10), "team": (10, 12), "damage": (12, 20),
    "crit": (20, 21), "unknown": (21, 23), "parity": (23, 25),
}


def pulses_to_bits(durations_us) -> str:
    """Decode the alternating mark/space duration list (ir_capture's `us=[...]`)
    into the payload bits — sync-gated, independent of the firmware's DECODE line.
    Marks are the even indices; the first mark (~2 ms) is the sync and is stripped.
    Returns "" if there is no leading sync (not a decodable BRX frame start)."""
    marks = [d for i, d in enumerate(durations_us) if i % 2 == 0]
    if not marks or marks[0] < SYNC_MIN_US:
        return ""
    bits = []
    for m in marks[1:]:
        if m < MARK_MIN_US or m >= SYNC_MIN_US:
            continue                       # glitch or stray long pulse — not a bit
        bits.append("1" if m > MARK_ONE_US else "0")
    return "".join(bits)


def decode_word(bits: str) -> dict:
    """Slice a (>=25-bit) BRX payload into fields + parity (brx-ir-protocol.md).
    parity_valid = the two parity bits are present and differ (Z0 != Z1)."""
    b = bits[:PAYLOAD_BITS]

    def seg(name):
        lo, hi = _IR_FIELDS[name]
        s = b[lo:hi]
        return int(s, 2) if s else 0

    z0 = b[23] if len(b) > 23 else ""
    z1 = b[24] if len(b) > 24 else ""
    return {
        "bullet": seg("bullet"), "player": seg("player"), "team": seg("team"),
        "damage": seg("damage"), "crit": seg("crit"), "unknown": seg("unknown"),
        "parity_bits": z0 + z1,
        "parity_valid": bool(z0) and bool(z1) and z0 != z1,
        "nbits": len(bits), "complete": len(bits) >= PAYLOAD_BITS,
    }


def encode_word(player=0, team=0, damage=0, bullet=0, crit=0, unknown=0, parity="01") -> str:
    """Build a 25-bit payload. `parity` defaults to a valid differing pair ('01' →
    parity_valid); pass explicit 2-bit Z if the bench shows parity is computed from
    the payload. Field endianness is not yet bench-verified; encode/decode share it."""
    def f(v, n):
        return format(v & ((1 << n) - 1), f"0{n}b")
    parity = (parity + "01")[:2]        # tolerate a short/empty parity arg
    return (f(bullet, 4) + f(player, 6) + f(team, 2) + f(damage, 8)
            + f(crit, 1) + f(unknown, 2) + parity)


def bits_to_pulses(bits, sync_us=2000, one_us=1000, zero_us=500, space_us=500) -> list[int]:
    """Synthesize the alternating mark/space list a receiver sees (emit model / tests).
    No explicit end-of-frame pulse is appended: after the last bit the line goes idle,
    so a receiver's pulseIn(LOW) times out to 0, satisfying node1's `<250us` end check."""
    out = [sync_us, space_us]
    for ch in bits:
        out.append(one_us if ch == "1" else zero_us)
        out.append(space_us)
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
