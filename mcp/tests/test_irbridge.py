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


# ---- range_stats (walk-back range reading) --------------------------------- #
from brx_mcp.irbridge import range_stats


def _f(idx, bits="", overflow=False):
    return IRFrame(index=idx, durations_us=[1000, 500], bits=bits, overflow=overflow)


def test_range_stats_clean_full_range():
    B = "0" * 25
    frames = [_f(i, bits=B) for i in range(5)]
    s = range_stats(frames, expected=5)
    assert s["detected"] == 5 and s["decoded"] == 5
    assert s["decode_rate"] == 1.0 and s["detect_rate"] == 1.0
    assert s["unique_patterns"] == 1 and s["overflow"] == 0


def test_range_stats_marginal_partial_decodes():
    # bursts arrive but only some decode to a clean 25-bit word → edge of range
    frames = [_f(0, bits="0" * 25), _f(1, bits="011"), _f(2, bits="")]
    s = range_stats(frames, expected=4)
    assert s["detected"] == 3 and s["decoded"] == 1
    assert s["decode_rate"] == round(1 / 3, 3)
    assert s["detect_rate"] == round(3 / 4, 3)     # 3 of 4 shots reached


def test_range_stats_out_of_range_and_no_expected():
    assert range_stats([])["detected"] == 0
    assert range_stats([])["decode_rate"] == 0.0
    assert "detect_rate" not in range_stats([_f(0, bits="0" * 25)])  # expected omitted


def test_range_stats_detect_rate_caps_at_one():
    # more detections than expected (reflections/repeat frames) → capped at 1.0
    frames = [_f(i, bits="0" * 25) for i in range(9)]
    assert range_stats(frames, expected=5)["detect_rate"] == 1.0


def test_range_stats_counts_overflow():
    frames = [_f(0, bits="0" * 25), _f(1, overflow=True)]
    assert range_stats(frames)["overflow"] == 1


# ---- BRX IR word decode (pulses -> bits -> fields) ------------------------- #
from brx_mcp.irbridge import pulses_to_bits, decode_word, encode_word, bits_to_pulses


def test_encode_decode_word_roundtrip():
    bits = encode_word(player=42, team=2, damage=9, bullet=3, crit=1)
    assert len(bits) == 25
    d = decode_word(bits)
    assert d["player"] == 42 and d["team"] == 2 and d["damage"] == 9
    assert d["bullet"] == 3 and d["crit"] == 1
    assert d["parity_valid"] and d["complete"]


def test_pulses_to_bits_strips_sync_and_decodes():
    bits = encode_word(player=7, team=1, damage=25)
    pulses = bits_to_pulses(bits)            # prepends a 2 ms sync + per-bit marks
    assert pulses_to_bits(pulses) == bits    # sync stripped, 25 bits recovered
    assert decode_word(pulses_to_bits(pulses))["player"] == 7


def test_pulses_without_sync_return_empty():
    # a train that does NOT start with a >=1500us sync mark is not a BRX frame
    assert pulses_to_bits([500, 500, 1000, 500, 500, 500]) == ""


def test_decode_word_parity_detects_bad_frame():
    good = encode_word(player=1)
    bad = good[:23] + "00"                    # Z0 == Z1 -> parity invalid
    assert decode_word(good)["parity_valid"] is True
    assert decode_word(bad)["parity_valid"] is False


def test_decode_word_incomplete_is_flagged():
    d = decode_word("0101")                   # far short of 25 bits
    assert d["complete"] is False and d["nbits"] == 4


def test_frame_shot_prefers_bits_then_falls_back_to_pulses():
    bits = encode_word(player=63, team=3, damage=100, crit=1)
    # (a) firmware already gave us bits
    f1 = IRFrame(index=1, durations_us=[], bits=bits)
    assert f1.shot()["player"] == 63 and f1.shot()["parity_valid"]
    # (b) no bits — decode straight from the raw pulses
    f2 = IRFrame(index=2, durations_us=bits_to_pulses(bits), bits="")
    s = f2.shot()
    assert s["player"] == 63 and s["team"] == 3 and s["damage"] == 100 and s["crit"] == 1
