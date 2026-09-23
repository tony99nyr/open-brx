"""Link-layer timeline of a btsnoop HCI log: who ended each BLE link (F293).

`btsnoop.py` keeps only the ATT payloads, so it shows what the phone and the gun said, but not why a link
ended. This module reads the HCI commands and events around those payloads and prints one timeline per
connection:

- the connect: peer address, role, connection interval, peripheral latency and supervision timeout
- connection-parameter requests (from the gun: LL or L2CAP) and updates, data-length and PHY changes
- the ATT MTU exchange
- each disconnect with its HCI reason, and a Disconnect command the phone's own host sent before it
- the last gun frame (`<<`) before each drop, for example a `$RADSK`

Each drop gets one verdict:

| verdict | evidence |
|---|---|
| `phone-host` | the phone's host sent HCI Disconnect on that handle, or the reason is 0x16 |
| `gun-host` | reason 0x13, 0x14 or 0x15 with no local Disconnect: the gun's own host chose to end it |
| `link-loss` | reason 0x08 (supervision timeout), 0x22 (LL response timeout), 0x28 or 0x3E: nobody chose it |
| `other` | any other reason; the reason is printed |

The verdict names who ended the link, not why. A gun whose headset link fails and which then drops the phone
reads `gun-host`; a radio starved of air time reads `link-loss`. It is a reading of one capture, never a bench
result on its own.

Usage: python -m brx_mcp.btlink <btsnoop_hci.log | bugreport.zip> [--gun AA:BB:CC:DD:EE:FF] [--frames]
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path
from typing import Any

from .btsnoop import extract_att, parse_btsnoop, reconstruct_frames

REASONS = {
    0x05: "authentication failure", 0x08: "connection timeout (supervision)", 0x13: "remote user terminated",
    0x14: "remote low resources", 0x15: "remote power off", 0x16: "terminated by local host",
    0x1A: "unsupported remote feature", 0x1F: "unspecified error", 0x22: "LL response timeout",
    0x28: "instant passed", 0x2A: "transaction collision", 0x3B: "unacceptable connection parameters",
    0x3D: "MIC failure", 0x3E: "failed to be established",
}
GUN_HOST = {0x13, 0x14, 0x15}
LINK_LOSS = {0x08, 0x22, 0x28, 0x3E}

CMD_DISCONNECT = 0x0406
CMD_LE_CREATE_CONN = 0x200D
CMD_LE_EXT_CREATE_CONN = 0x2043
CMD_LE_CONN_UPDATE = 0x2013
CMD_LE_REM_PARAM_REPLY = 0x2020
CMD_LE_REM_PARAM_NEG = 0x2021
EVT_DISCONN_COMPLETE = 0x05
EVT_LE_META = 0x3E

ATT_CID, SIG_CID = 0x0004, 0x0005


def _addr(b: bytes) -> str:
    return ":".join(f"{x:02X}" for x in reversed(b[:6]))


def _params(interval: int, latency: int, timeout: int) -> str:
    return f"interval {interval * 1.25:g} ms, latency {latency}, supervision {timeout * 10} ms"


def _split(p: dict[str, Any]) -> tuple[str, bool, bytes] | None:
    """-> (kind, received, body) for one record. kind is cmd, evt or acl; received means controller -> host."""
    d, flags = p["data"], p["flags"]
    received = bool(flags & 0x01)
    if p["datalink"] == 1001:   # Apple PacketLogger: the type is in the record flags, no type byte
        if flags & 0x02:
            return ("evt" if received else "cmd", received, d)
        return ("acl", received, d)
    if not d:
        return None
    kind = {0x01: "cmd", 0x04: "evt", 0x02: "acl"}.get(d[0])
    return (kind, received, d[1:]) if kind else None


def link_events(packets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The link-layer events of a capture, in capture order. Each is a dict with ts_us, conn and what."""
    out: list[dict[str, Any]] = []
    pending_peer = None

    def add(p, conn, what, **kw):
        out.append({"ts_us": p["ts_us"], "conn": conn, "what": what, **kw})

    for p in packets:
        s = _split(p)
        if not s:
            continue
        kind, received, b = s
        if kind == "cmd" and len(b) >= 3:
            op, n = struct.unpack("<HB", b[:3])
            prm = b[3:3 + n]
            if op == CMD_DISCONNECT and len(prm) >= 3:
                h, reason = struct.unpack("<HB", prm[:3])
                add(p, h & 0x0FFF, "phone-disconnect", reason=reason)
            elif op == CMD_LE_CREATE_CONN and len(prm) >= 12:
                pending_peer = _addr(prm[6:12])
                add(p, None, "phone-connect-request", peer=pending_peer)
            elif op == CMD_LE_EXT_CREATE_CONN and len(prm) >= 9:
                pending_peer = _addr(prm[3:9])
                add(p, None, "phone-connect-request", peer=pending_peer)
            elif op == CMD_LE_CONN_UPDATE and len(prm) >= 10:
                h, lo, hi, lat, to = struct.unpack("<HHHHH", prm[:10])
                add(p, h & 0x0FFF, "phone-param-request", detail=f"{lo * 1.25:g}-{hi * 1.25:g} ms, latency {lat}, supervision {to * 10} ms")
            elif op in (CMD_LE_REM_PARAM_REPLY, CMD_LE_REM_PARAM_NEG) and len(prm) >= 2:
                h = struct.unpack("<H", prm[:2])[0]
                add(p, h & 0x0FFF, "phone-param-reply", detail="accepted" if op == CMD_LE_REM_PARAM_REPLY else "refused")
        elif kind == "evt" and len(b) >= 2:
            code, prm = b[0], b[2:2 + b[1]]
            if code == EVT_DISCONN_COMPLETE and len(prm) >= 4:
                status, h, reason = struct.unpack("<BHB", prm[:4])
                if status == 0:
                    add(p, h & 0x0FFF, "disconnect", reason=reason)
            elif code == EVT_LE_META and prm:
                sub, q = prm[0], prm[1:]
                if sub in (0x01, 0x0A, 0x29) and len(q) >= 11:
                    status, h, role, _t = struct.unpack("<BHBB", q[:5])
                    peer = _addr(q[5:11])
                    rest = q[11:] if sub == 0x01 else q[23:]
                    if status != 0:
                        add(p, None, "connect-failed", peer=peer or pending_peer, reason=status)
                    elif len(rest) >= 6:
                        add(p, h & 0x0FFF, "connect", peer=peer, role="central" if role == 0 else "peripheral",
                            detail=_params(*struct.unpack("<HHH", rest[:6])))
                elif sub == 0x03 and len(q) >= 9:
                    status, h, iv, lat, to = struct.unpack("<BHHHH", q[:9])
                    add(p, h & 0x0FFF, "param-update", detail=_params(iv, lat, to) if status == 0 else f"failed 0x{status:02X}")
                elif sub == 0x06 and len(q) >= 10:
                    h, lo, hi, lat, to = struct.unpack("<HHHHH", q[:10])
                    add(p, h & 0x0FFF, "gun-param-request", detail=f"LL: {lo * 1.25:g}-{hi * 1.25:g} ms, latency {lat}, supervision {to * 10} ms")
                elif sub == 0x07 and len(q) >= 10:
                    h, tx, _tt, rx, _rt = struct.unpack("<HHHHH", q[:10])
                    add(p, h & 0x0FFF, "data-length", detail=f"tx {tx} B, rx {rx} B")
                elif sub == 0x0C and len(q) >= 5:
                    status, h, tx, rx = struct.unpack("<BHBB", q[:5])
                    add(p, h & 0x0FFF, "phy-update", detail=f"tx PHY {tx}, rx PHY {rx}")
        elif kind == "acl" and len(b) >= 8:
            h = struct.unpack("<H", b[:2])[0] & 0x0FFF
            l2len, cid = struct.unpack("<HH", b[4:8])
            pl = b[8:8 + l2len]
            who = "gun" if received else "phone"
            if cid == ATT_CID and len(pl) >= 3 and pl[0] in (0x02, 0x03):
                mtu = struct.unpack("<H", pl[1:3])[0]
                add(p, h, f"{who}-mtu-{'request' if pl[0] == 0x02 else 'response'}", detail=f"MTU {mtu}")
            elif cid == SIG_CID and len(pl) >= 4 and pl[0] == 0x12 and len(pl) >= 12:
                lo, hi, lat, to = struct.unpack("<HHHH", pl[4:12])
                add(p, h, f"{who}-param-request", detail=f"L2CAP: {lo * 1.25:g}-{hi * 1.25:g} ms, latency {lat}, supervision {to * 10} ms")
            elif cid == SIG_CID and len(pl) >= 6 and pl[0] == 0x13:
                add(p, h, f"{who}-param-reply", detail="accepted" if struct.unpack("<H", pl[4:6])[0] == 0 else "refused")
    return out


def verdict(reason: int, phone_sent_disconnect: bool) -> str:
    if phone_sent_disconnect or reason == 0x16:
        return "phone-host"
    if reason in GUN_HOST:
        return "gun-host"
    if reason in LINK_LOSS:
        return "link-loss"
    return "other"


def analyse(packets: list[dict[str, Any]]) -> dict[str, Any]:
    """-> {"events": [...], "drops": [...], "peers": {conn: peer}} with a verdict and context on every drop."""
    events = link_events(packets)
    frames = reconstruct_frames(extract_att(packets))
    peers: dict[int, str] = {}
    up_at: dict[int, int] = {}
    asked: dict[int, bool] = {}
    drops = []
    for e in events:
        c = e["conn"]
        if e["what"] == "connect":
            peers[c] = e["peer"]; up_at[c] = e["ts_us"]; asked[c] = False
        elif e["what"] == "phone-disconnect":
            asked[c] = True
        elif e["what"] == "disconnect":
            last_rx = [f for f in frames if f["conn"] == c and f["direction"] == "rx" and f["ts_us"] <= e["ts_us"]
                       and f["ts_us"] >= up_at.get(c, 0)]
            drops.append({"ts_us": e["ts_us"], "conn": c, "peer": peers.get(c), "reason": e["reason"],
                          "verdict": verdict(e["reason"], asked.get(c, False)),
                          "held_s": (e["ts_us"] - up_at[c]) / 1e6 if c in up_at else None,
                          "last_rx": last_rx[-1]["raw"] if last_rx else None,
                          "last_rx_before_s": (e["ts_us"] - last_rx[-1]["ts_us"]) / 1e6 if last_rx else None})
            asked[c] = False
    return {"events": events, "drops": drops, "peers": peers, "frames": frames}


def load(path: str | Path) -> list[dict[str, Any]]:
    """Reads a btsnoop file, or the largest btsnoop_hci.log inside an `adb bugreport` zip."""
    if str(path).lower().endswith(".zip"):
        import tempfile
        import zipfile
        with zipfile.ZipFile(path) as z:
            names = [i for i in z.infolist() if i.filename.endswith("btsnoop_hci.log")]
            if not names:
                raise ValueError("no btsnoop_hci.log in the zip: was HCI snoop set to Enabled before the capture?")
            data = z.read(max(names, key=lambda i: i.file_size))
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "btsnoop_hci.log"
            f.write_bytes(data)
            return parse_btsnoop(f)
    return parse_btsnoop(path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m brx_mcp.btlink", description="Link-layer timeline of a btsnoop HCI log: who ended each BLE link (F293).")
    ap.add_argument("capture", help="btsnoop HCI log (Android bugreport or PacketLogger export)")
    ap.add_argument("--gun", help="the gun's address; other peers are flagged (for example the headset)")
    ap.add_argument("--frames", action="store_true", help="also print every NUS frame in the timeline")
    a = ap.parse_args(argv)
    packets = load(a.capture)
    r = analyse(packets)
    rows = [(e["ts_us"], e) for e in r["events"]]
    if a.frames:
        rows += [(f["ts_us"], {"conn": f["conn"], "what": ">>" if f["direction"] == "tx" else "<<", "detail": f["raw"]})
                 for f in r["frames"]]
    rows.sort(key=lambda x: x[0])
    t0 = rows[0][0] if rows else 0
    gun = a.gun.upper() if a.gun else None
    for ts, e in rows:
        c = "  -  " if e.get("conn") is None else f"0x{e['conn']:03x}"
        extra = " ".join(str(x) for x in (e.get("peer"), e.get("role"), e.get("detail")) if x)
        if "reason" in e:
            extra += f" reason 0x{e['reason']:02X} ({REASONS.get(e['reason'], 'unknown')})"
        if gun and e.get("peer") and e["peer"] != gun:
            extra += "  <-- NOT THE GUN"
        print(f"[{(ts - t0) / 1e6:9.3f}s] {c} {e['what']:<22} {extra}".rstrip())
    print()
    tally: dict[str, int] = {}
    for d in r["drops"]:
        tally[d["verdict"]] = tally.get(d["verdict"], 0) + 1
        held = f"held {d['held_s']:.1f} s" if d["held_s"] is not None else "held ?"
        last = f"last gun frame {d['last_rx_before_s']:.2f} s before: {d['last_rx']}" if d["last_rx"] else "no gun frame on this link"
        print(f"DROP [{(d['ts_us'] - t0) / 1e6:9.3f}s] {d['peer'] or '?'} {d['verdict']} "
              f"(0x{d['reason']:02X} {REASONS.get(d['reason'], 'unknown')}), {held}, {last}")
    print(f"\n{len(r['drops'])} drop(s): " + (", ".join(f"{k} {v}" for k, v in sorted(tally.items())) or "none")
          + f"; peers: {', '.join(sorted(set(r['peers'].values()))) or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
