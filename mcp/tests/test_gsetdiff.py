"""gsetdiff.py: config_frames() filtering and the main() token-by-token diff it drives.

Captures are built in-process as tiny datalink-1001 (Apple PacketLogger) btsnoop files —
the same trick as test_btsnoop_multigun.py — so nothing here needs a real capture file.
"""
from __future__ import annotations

import io
import struct
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from brx_mcp import gsetdiff as G

ATT_CID = 0x0004
ATT_WRITE_CMD = 0x52
ATT_NOTIFY = 0x1B
NUS_RX_HANDLE = 0x000E


def _acl(conn: int, att: bytes) -> bytes:
    l2cap = struct.pack("<HH", len(att), ATT_CID) + att
    return struct.pack("<HH", conn & 0x0FFF, len(l2cap)) + l2cap


def _write(conn: int, payload: bytes) -> bytes:
    return _acl(conn, struct.pack("<BH", ATT_WRITE_CMD, NUS_RX_HANDLE) + payload)


def _notify(conn: int, payload: bytes) -> bytes:
    return _acl(conn, struct.pack("<BH", ATT_NOTIFY, NUS_RX_HANDLE) + payload)


def _capture(frames: list[tuple[str, bytes]]) -> Path:
    """frames: [(direction, ascii payload incl. trailing ',*'), ...] -> path to a btsnoop file."""
    blob = b"btsnoop\x00" + struct.pack(">II", 1, 1001)
    for i, (direction, payload) in enumerate(frames):
        pkt = (_write if direction == "tx" else _notify)(0x0041, payload)
        blob += struct.pack(">IIIIq", len(pkt), len(pkt), 0, 0, i * 1000)
        blob += pkt
    fh = tempfile.NamedTemporaryFile(suffix=".log", delete=False)
    fh.write(blob)
    fh.close()
    return Path(fh.name)


def _run_main(argv: list[str]):
    """Run gsetdiff.main() with argv, capturing stdout/stderr and any sys.exit code."""
    old_argv = sys.argv
    sys.argv = ["gsetdiff.py", *argv]
    out, err = io.StringIO(), io.StringIO()
    code = None
    try:
        with redirect_stdout(out), redirect_stderr(err):
            try:
                G.main()
            except SystemExit as e:
                code = e.code
    finally:
        sys.argv = old_argv
    return out.getvalue(), err.getvalue(), code


# ---------------------------------------------------------------------------
# config_frames()
# ---------------------------------------------------------------------------

def test_config_frames_returns_only_frames_matching_the_exact_command_prefix():
    path = _capture([("tx", b"$GSET,1,0,1,*"), ("tx", b"$PSET,7,*"), ("tx", b"$GSETX,9,*")])
    try:
        assert G.config_frames(str(path), "GSET") == ["$GSET,1,0,1,*"]
    finally:
        path.unlink()


def test_config_frames_excludes_rx_notify_frames_even_when_shaped_like_a_match():
    path = _capture([("tx", b"$GSET,1,*"), ("rx", b"$GSET,9,*")])
    try:
        assert G.config_frames(str(path), "GSET") == ["$GSET,1,*"]
    finally:
        path.unlink()


def test_config_frames_returns_empty_list_when_the_command_never_appears():
    path = _capture([("tx", b"$PSET,1,*")])
    try:
        assert G.config_frames(str(path), "GSET") == []
    finally:
        path.unlink()


def test_config_frames_preserves_capture_order_across_multiple_matches():
    path = _capture([("tx", b"$GSET,1,*"), ("tx", b"$WEAP,0,<ar>,*"), ("tx", b"$GSET,2,*")])
    try:
        assert G.config_frames(str(path), "GSET") == ["$GSET,1,*", "$GSET,2,*"]
    finally:
        path.unlink()


# ---------------------------------------------------------------------------
# main() — the token-by-token diff
# ---------------------------------------------------------------------------

def test_main_identifies_the_single_token_that_moved():
    a = _capture([("tx", b"$GSET,1,0,1,0,1,0,50,1,*")])
    b = _capture([("tx", b"$GSET,1,0,1,0,1,0,75,1,*")])   # token 7 (0-indexed on the split) differs
    try:
        out, err, code = _run_main([str(a), str(b)])
    finally:
        a.unlink(); b.unlink()
    assert code is None
    assert ">>> token 7 is the one that moved. <<<" in out


def test_main_reports_no_isolation_when_multiple_tokens_differ():
    a = _capture([("tx", b"$GSET,1,0,*")])
    b = _capture([("tx", b"$GSET,0,1,*")])   # tokens 1 AND 2 differ
    try:
        out, err, code = _run_main([str(a), str(b)])
    finally:
        a.unlink(); b.unlink()
    assert "tokens [1, 2] all differ" in out
    assert "cannot isolate a field" in out


def test_main_reports_no_tokens_differ_for_identical_captures():
    a = _capture([("tx", b"$GSET,1,0,1,*")])
    b = _capture([("tx", b"$GSET,1,0,1,*")])
    try:
        out, err, code = _run_main([str(a), str(b)])
    finally:
        a.unlink(); b.unlink()
    assert "NO TOKENS DIFFER" in out


def test_main_dash_dash_cmd_flag_selects_the_command_to_diff():
    # $GSET frames are identical between captures (so they must not drive the diff); only the
    # $PSET frames differ, at token 1.
    a = _capture([("tx", b"$GSET,1,*"), ("tx", b"$PSET,5,*")])
    b = _capture([("tx", b"$GSET,1,*"), ("tx", b"$PSET,9,*")])
    try:
        out, err, code = _run_main(["--cmd", "PSET", str(a), str(b)])
    finally:
        a.unlink(); b.unlink()
    assert "token-by-token ($PSET, first frame of each):" in out
    assert ">>> token 1 is the one that moved. <<<" in out


def test_main_skips_an_unreadable_capture_and_reports_it_without_crashing():
    ok = _capture([("tx", b"$GSET,1,0,*")])
    try:
        out, err, code = _run_main(["/no/such/capture.log", str(ok)])
    finally:
        ok.unlink()
    assert code is None
    assert "!! /no/such/capture.log:" in err
    assert "need $GSET in at least two captures to compare" in err


def test_main_requires_at_least_two_positional_arguments():
    out, err, code = _run_main(["only_one.log"])
    assert code == 2
    assert "python -m brx_mcp.gsetdiff <capA.log> <capB.log>" in err
