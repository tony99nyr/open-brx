"""F293: btlink names who ended each BLE link in an Android HCI snoop capture.

Builds datalink-1002 (Android, H4 type byte) btsnoop bytes in-process, so no capture file is needed.
"""

import io
import struct
import tempfile
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

from brx_mcp.btlink import analyse, load, main, verdict

GUN = bytes([0x30, 0xFE, 0x11, 0x22, 0x33, 0xC4])      # little-endian on the wire: C4:33:22:11:FE:30
HEADSET = bytes([0x01, 0x02, 0x03, 0x04, 0x05, 0xD0])  # D0:05:04:03:02:01
NUS = 0x000E


def _evt(code, params):
    return bytes([0x04, code, len(params)]) + params


def _cmd(op, params):
    return bytes([0x01]) + struct.pack("<HB", op, len(params)) + params


def _acl(conn, cid, payload):
    l2 = struct.pack("<HH", len(payload), cid) + payload
    return bytes([0x02]) + struct.pack("<HH", conn, len(l2)) + l2


def connect(conn, peer, interval=24, latency=0, timeout=500):
    return _evt(0x3E, bytes([0x01]) + struct.pack("<BHBB", 0, conn, 0, 0) + peer
                + struct.pack("<HHHB", interval, latency, timeout, 0))


def disconnect(conn, reason):
    return _evt(0x05, struct.pack("<BHB", 0, conn, reason))


def notify(conn, text):
    return _acl(conn, 0x0004, struct.pack("<BH", 0x1B, NUS) + text.encode())


def mtu(conn, opcode, value):
    return _acl(conn, 0x0004, struct.pack("<BH", opcode, value))


def capture(records):
    """records: [(t_seconds, bytes, received)] -> a btsnoop path."""
    blob = b"btsnoop\x00" + struct.pack(">II", 1, 1002)
    for t, pkt, rx in records:
        blob += struct.pack(">IIIIq", len(pkt), len(pkt), 1 if rx else 0, 0, int(t * 1e6)) + pkt
    f = Path(tempfile.mkdtemp()) / "btsnoop_hci.log"
    f.write_bytes(blob)
    return f


def test_gun_host_drop_names_the_last_gun_frame():
    f = capture([
        (0.0, _cmd(0x200D, struct.pack("<HHBB", 96, 96, 0, 0) + GUN + bytes(13)), False),
        (0.1, connect(0x40, GUN), True),
        (0.2, mtu(0x40, 0x02, 517), False),
        (0.3, mtu(0x40, 0x03, 23), True),
        (5.0, notify(0x40, "$RADSK,*"), True),
        (5.5, disconnect(0x40, 0x13), True),
    ])
    r = analyse(load(f))
    (d,) = r["drops"]
    assert d["verdict"] == "gun-host"
    assert d["peer"] == "C4:33:22:11:FE:30"
    assert d["last_rx"] == "$RADSK,*"
    assert abs(d["held_s"] - 5.4) < 1e-6 and abs(d["last_rx_before_s"] - 0.5) < 1e-6
    assert [e["detail"] for e in r["events"] if e["what"].endswith("mtu-response")] == ["MTU 23"]


def test_phone_disconnect_command_wins_over_the_reason():
    f = capture([
        (0.0, connect(0x41, GUN), True),
        (3.0, _cmd(0x0406, struct.pack("<HB", 0x41, 0x13)), False),
        (3.1, disconnect(0x41, 0x13), True),   # the local command decides it, whatever reason the event carries
    ])
    assert [d["verdict"] for d in analyse(load(f))["drops"]] == ["phone-host"]


def test_supervision_timeout_is_link_loss_and_a_second_peer_is_flagged():
    f = capture([
        (0.0, connect(0x42, GUN), True),
        (1.0, connect(0x43, HEADSET), True),
        (7.0, disconnect(0x42, 0x08), True),
    ])
    r = analyse(load(f))
    assert [d["verdict"] for d in r["drops"]] == ["link-loss"]
    out = io.StringIO()
    with redirect_stdout(out):
        main([str(f), "--gun", "C4:33:22:11:FE:30"])
    text = out.getvalue()
    assert "D0:05:04:03:02:01 central" in text and "NOT THE GUN" in text
    assert "1 drop(s): link-loss 1" in text


def test_verdict_table():
    assert verdict(0x16, False) == "phone-host"
    assert verdict(0x15, False) == "gun-host"
    assert verdict(0x3E, False) == "link-loss"
    assert verdict(0x3B, False) == "other"


def test_reads_the_snoop_log_inside_a_bugreport_zip():
    f = capture([(0.0, connect(0x44, GUN), True), (2.0, disconnect(0x44, 0x08), True)])
    z = f.parent / "bugreport.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("FS/data/misc/bluetooth/logs/btsnoop_hci.log", f.read_bytes())
    assert [d["verdict"] for d in analyse(load(z))["drops"]] == ["link-loss"]
