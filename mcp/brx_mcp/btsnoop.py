"""Parse Android btsnoop HCI logs and reconstruct BRX serial traffic.

Extracts ATT Write Command/Request (host→tagger) and Handle Value
Notification/Indication (tagger→host) payloads, reassembles the ASCII byte
stream per direction, and splits on the ',*' frame terminator. Handles are
not resolved against GATT discovery — we simply keep any stream that yields
$-framed ASCII, which is exactly the NUS traffic.

btsnoop format: 16-byte file header ("btsnoop\\0", version, datalink),
then records: orig_len, incl_len, flags, drops, ts_us (8 bytes), packet.
Packet for datalink 1002 (HCI UART) starts with an HCI packet-type byte:
02 = ACL. ACL: handle/flags(2) len(2) | L2CAP: len(2) cid(2) | ATT payload.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path
from typing import Any

ATT_WRITE_CMD = 0x52
ATT_WRITE_REQ = 0x12
ATT_NOTIFY = 0x1B
ATT_INDICATE = 0x1D
ATT_CID = 0x0004


def parse_btsnoop(path: str | Path) -> list[dict[str, Any]]:
    data = Path(path).read_bytes()
    if data[:8] != b"btsnoop\x00":
        raise ValueError("not a btsnoop file (bad magic)")
    datalink = struct.unpack(">I", data[12:16])[0]
    offset = 16
    packets = []
    while offset + 24 <= len(data):
        _orig, incl, flags, _drops, ts = struct.unpack(">IIIIq", data[offset:offset + 24])
        offset += 24
        pkt = data[offset:offset + incl]
        offset += incl
        packets.append({"ts_us": ts, "flags": flags, "data": pkt,
                        "datalink": datalink})
    return packets


def extract_att(packets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pull ATT opcode/handle/value out of ACL packets."""
    events = []
    for p in packets:
        d = p["data"]
        # 1001 = unencapsulated HCI (Apple PacketLogger): no packet-type byte,
        # the type lives in the record flags (bit 1: 0 = ACL, 1 = cmd/event)
        # and the ACL header starts at offset 0.
        # 1002 = HCI UART (Android): leading 0x02 type byte marks ACL.
        if p["datalink"] == 1001:
            if p["flags"] & 0x02:  # command or event, not ACL data
                continue
            acl = d
        else:
            if not d or d[0] != 0x02:  # ACL only
                continue
            acl = d[1:]
        if len(acl) < 8:
            continue
        l2len, cid = struct.unpack("<HH", acl[4:8])
        if cid != ATT_CID:
            continue
        att = acl[8:8 + l2len]
        if len(att) < 3:
            continue
        opcode = att[0]
        if opcode in (ATT_WRITE_CMD, ATT_WRITE_REQ):
            direction = "tx"
        elif opcode in (ATT_NOTIFY, ATT_INDICATE):
            direction = "rx"
        else:
            continue
        handle = struct.unpack("<H", att[1:3])[0]
        events.append({"ts_us": p["ts_us"], "direction": direction,
                       "handle": handle, "value": att[3:]})
    return events


def reconstruct_frames(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Reassemble per-(direction, handle) byte streams and split on ',*'."""
    streams: dict[tuple[str, int], bytes] = {}
    frames = []
    for ev in events:
        key = (ev["direction"], ev["handle"])
        streams[key] = streams.get(key, b"") + ev["value"]
        buf = streams[key]
        while b",*" in buf:
            raw, buf = buf.split(b",*", 1)
            text = (raw + b",*").decode("utf-8", errors="replace")
            if "$" in text:
                text = text[text.index("$"):]
                frames.append({"ts_us": ev["ts_us"], "direction": ev["direction"],
                               "handle": ev["handle"], "raw": text})
        streams[key] = buf
    frames.sort(key=lambda f: f["ts_us"])
    return frames


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python -m brx_mcp.btsnoop <btsnoop_hci.log> [out.jsonl]",
              file=sys.stderr)
        sys.exit(2)
    packets = parse_btsnoop(sys.argv[1])
    frames = reconstruct_frames(extract_att(packets))
    t0 = frames[0]["ts_us"] if frames else 0
    lines = []
    for f in frames:
        arrow = ">>" if f["direction"] == "tx" else "<<"
        line = f"[{(f['ts_us'] - t0) / 1e6:9.3f}s] {arrow} {f['raw']}"
        print(line)
        lines.append(line)
    print(f"\n{len(frames)} frames from {len(packets)} HCI packets",
          file=sys.stderr)
    if len(sys.argv) > 2:
        import json
        with open(sys.argv[2], "w", encoding="utf-8") as fh:
            for f in frames:
                fh.write(json.dumps(f) + "\n")
        print(f"wrote {sys.argv[2]}", file=sys.stderr)


if __name__ == "__main__":
    main()
