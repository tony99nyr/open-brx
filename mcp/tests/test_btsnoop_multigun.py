"""Two simultaneously-connected taggers must decode as two separate streams.

The nRF-feedback capture (docs/handoff-callsign-nrf-capture.md) is a TWO-GUN
trace. Identical taggers expose the same ATT characteristic handle, so keying
byte streams on that alone merges both guns into one buffer and reassembly
yields garbage — silently, which is the dangerous part. Streams are keyed on
the ACL connection handle as well; these tests pin that.

Builds btsnoop bytes in-process (datalink 1001 = Apple PacketLogger, the format
PacketLogger exports) so the suite stays portable — no capture files required.
"""

import struct
import tempfile
from pathlib import Path

from brx_mcp.btsnoop import extract_att, parse_btsnoop, reconstruct_frames

ATT_CID = 0x0004
ATT_WRITE_CMD = 0x52
ATT_NOTIFY = 0x1B
NUS_RX_HANDLE = 0x000E  # same on every tagger — that's the whole point


def _acl(conn: int, att: bytes) -> bytes:
    l2cap = struct.pack("<HH", len(att), ATT_CID) + att
    return struct.pack("<HH", conn & 0x0FFF, len(l2cap)) + l2cap


def _write(conn: int, payload: bytes) -> bytes:
    return _acl(conn, struct.pack("<BH", ATT_WRITE_CMD, NUS_RX_HANDLE) + payload)


def _notify(conn: int, payload: bytes) -> bytes:
    return _acl(conn, struct.pack("<BH", ATT_NOTIFY, NUS_RX_HANDLE) + payload)


def _btsnoop(packets: list[bytes]) -> Path:
    """packets in order -> a datalink-1001 btsnoop file; returns its path."""
    blob = b"btsnoop\x00" + struct.pack(">II", 1, 1001)
    for i, pkt in enumerate(packets):
        blob += struct.pack(">IIIIq", len(pkt), len(pkt), 0, 0, i * 1000)
        blob += pkt
    fh = tempfile.NamedTemporaryFile(suffix=".log", delete=False)
    fh.write(blob)
    fh.close()
    return Path(fh.name)


def test_two_connections_do_not_interleave():
    # Both guns get config writes, strictly interleaved packet-by-packet —
    # the worst case for a decoder that ignores the connection handle.
    a, b = 0x0041, 0x0042
    path = _btsnoop([
        _write(a, b"$GSET,1,0,1,"), _write(b, b"$GSET,0,1,1,"),
        _write(a, b"0,1,0,50,1,*"), _write(b, b"0,1,0,25,1,*"),
        _write(a, b"$TID,1,*"),     _write(b, b"$TID,2,*"),
    ])
    frames = reconstruct_frames(extract_att(parse_btsnoop(str(path))))
    path.unlink()

    by_conn = {}
    for f in frames:
        by_conn.setdefault(f["conn"], []).append(f["raw"])
    assert set(by_conn) == {a, b}, f"expected two connections, got {list(by_conn)}"
    # Each gun's chunks reassemble into ITS OWN frames, not a blend of both.
    assert by_conn[a] == ["$GSET,1,0,1,0,1,0,50,1,*", "$TID,1,*"], by_conn[a]
    assert by_conn[b] == ["$GSET,0,1,1,0,1,0,25,1,*", "$TID,2,*"], by_conn[b]


def test_direction_split_per_connection():
    a, b = 0x0041, 0x0042
    path = _btsnoop([
        _write(a, b"$SPAWN,,*"), _notify(a, b"$HP,45,70,0,*"),
        _write(b, b"$SPAWN,,*"), _notify(b, b"$HP,0,0,0,*"),
    ])
    frames = reconstruct_frames(extract_att(parse_btsnoop(str(path))))
    path.unlink()

    seen = {(f["conn"], f["direction"], f["raw"]) for f in frames}
    assert (a, "tx", "$SPAWN,,*") in seen
    assert (a, "rx", "$HP,45,70,0,*") in seen
    assert (b, "rx", "$HP,0,0,0,*") in seen
    # the dead-gun notify must not be attributed to gun A
    assert (a, "rx", "$HP,0,0,0,*") not in seen


def test_single_connection_still_decodes():
    """Regression guard: the existing one-gun captures must be unaffected."""
    path = _btsnoop([_write(0x0041, b"$CLEAR,*$START,*")])
    frames = reconstruct_frames(extract_att(parse_btsnoop(str(path))))
    path.unlink()
    assert [f["raw"] for f in frames] == ["$CLEAR,*", "$START,*"]
    assert {f["conn"] for f in frames} == {0x0041}
