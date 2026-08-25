"""Tests for the BLE notify-frame reassembler (extract_frames).

Guards the '$'/'*' boundary logic — including the real bench quirk where a frame
arrived without its trailing '*' and ran into the next one.
"""

from brx_mcp.protocol import extract_frames


def test_single_complete_frame():
    assert extract_frames("$HP,45,70,0,*") == (["$HP,45,70,0,*"], "")


def test_multiple_frames_in_one_buffer():
    f, r = extract_frames("$BUT,0,1,*$ALCD,35,100,0,108,0,*")
    assert f == ["$BUT,0,1,*", "$ALCD,35,100,0,108,0,*"] and r == ""


def test_partial_tail_carried_as_remainder():
    # a frame that hasn't finished (no '*' and no following '$') stays as remainder
    f, r = extract_frames("$VOLTS,7299,3617,25")
    assert f == [] and r == "$VOLTS,7299,3617,25"
    # ...completed by the next notification
    f2, r2 = extract_frames(r + ",19,*")
    assert f2 == ["$VOLTS,7299,3617,25,19,*"] and r2 == ""


def test_merged_frame_missing_star_splits_on_dollar():
    # the bench quirk: $ALCD lost its '*' and ran straight into $BUT
    f, r = extract_frames("$ALCD,36,100,0,108,0$BUT,0,1,*")
    assert f == ["$ALCD,36,100,0,108,0", "$BUT,0,1,*"] and r == ""


def test_leading_orphan_bytes_dropped():
    f, r = extract_frames("70,0,*$SFLASH,*")   # stray tail before the first '$'
    assert f == ["$SFLASH,*"] and r == ""


def test_no_dollar_clears_buffer():
    assert extract_frames("noise no dollar") == ([], "")


def test_dollar_only_kept_until_complete():
    # split so the '$' arrives, then the rest — nothing emitted until it's whole
    f, r = extract_frames("$SP")
    assert f == [] and r == "$SP"
    f2, r2 = extract_frames(r + ",99,*")
    assert f2 == ["$SP,99,*"] and r2 == ""
