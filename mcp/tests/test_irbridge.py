"""Tests for the IR-bridge serial-line parser (pure — no hardware/pyserial).

Feeds synthetic firmware output through parse_frames / diff_bits — the same lines
`ir_capture.ino` prints.
"""

from brx_mcp.irbridge import parse_frames, diff_bits, IRFrame


def test_parse_single_frame():
    lines = [
        "# BRX IR capture ready",
        "RAW 1 edges=51 us=[1000,500,500,500,1000,500]",
        "DECODE bits=3 val=101",
    ]
    frames = parse_frames(lines)
    assert len(frames) == 1
    f = frames[0]
    assert f.index == 1
    assert f.durations_us == [1000, 500, 500, 500, 1000, 500]
    assert f.bits == "101"
    assert not f.overflow


def test_parse_overflow_flag():
    lines = [
        "RAW 7 edges=256 (OVERFLOW) us=[500,500]",
        "DECODE bits=1 val=0",
    ]
    f = parse_frames(lines)[0]
    assert f.overflow is True


def test_parse_multiple_frames_and_ignores_noise():
    lines = [
        "RAW 1 edges=4 us=[1000,500]",
        "DECODE bits=1 val=1",
        "# some comment",
        "RAW 2 edges=4 us=[500,500]",
        "DECODE bits=1 val=0",
    ]
    frames = parse_frames(lines)
    assert [f.bits for f in frames] == ["1", "0"]
    assert [f.index for f in frames] == [1, 2]


def test_raw_without_decode_still_captured():
    # a RAW with no following DECODE (e.g. truncated) should still yield a frame
    frames = parse_frames(["RAW 3 us=[500]"])
    assert len(frames) == 1 and frames[0].bits == ""


def test_empty_us_list():
    frames = parse_frames(["RAW 4 edges=1 us=[]", "DECODE bits=0 val="])
    assert frames[0].durations_us == [] and frames[0].bits == ""


def test_frame_to_dict():
    f = IRFrame(index=2, durations_us=[1000, 500], bits="10")
    d = f.to_dict()
    assert d["nbits"] == 2 and d["n_edges"] == 3 and d["bits"] == "10"


def test_diff_bits_marks_differences():
    assert diff_bits("11110", "11010") == "..X.."
    # different lengths note the mismatch
    assert "len" in diff_bits("111", "11")
