"""Characterisation tests for brx_mcp/weapmap.py (the $WEAP cross-capture aligner).

`toks()` is pure and gets direct coverage for its edge cases (this is the exact
function protecting against the off-by-one the module's own docstring warns
about). `main()` is a CLI: it reads real btsnoop files via
brx_mcp.btsnoop.reconstruct_frames, so it's driven end-to-end against synthetic
btsnoop bytes built in-process (same technique as test_btsnoop_multigun.py) —
no capture files needed, and it stays portable.
"""

import io
import struct
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from brx_mcp.weapmap import main, toks

# --------------------------------------------------------------------------- #
# toks() — pure, index-alignment-critical                                     #
# --------------------------------------------------------------------------- #
def test_toks_drops_the_weap_command_word_and_comma_star_terminator():
    # protocol-classes.md indexes $WEAP fields with t0 = slot — dropping the
    # command word is what keeps FIELDS[0] == "slot" correct.
    assert toks("$WEAP,0,,100,*") == ["0", "", "100"]


def test_toks_handles_a_bare_star_terminator_with_no_comma():
    assert toks("$WEAP,0,1*") == ["0", "1"]


def test_toks_handles_a_frame_missing_any_terminator():
    assert toks("$WEAP,0,1") == ["0", "1"]


def test_toks_on_a_non_weap_frame_is_not_shifted():
    # only frames whose first token is literally "WEAP" get the command word
    # dropped — anything else must come back untouched, or a caller that
    # blindly fed it a $TID frame would silently misalign every column.
    assert toks("$TID,1,*") == ["TID", "1"]


def test_toks_on_an_empty_weap_body_returns_no_fields():
    assert toks("$WEAP,*") == []


def test_toks_strips_leading_dollar_only_once():
    assert toks("$WEAP,0,*")[0] == "0"


# --------------------------------------------------------------------------- #
# main() — CLI over synthetic btsnoop captures                                #
# --------------------------------------------------------------------------- #
ATT_CID = 0x0004
ATT_WRITE_CMD = 0x52
NUS_RX_HANDLE = 0x000E
FIELD_WIDTH = 43  # indices 0..42, per weapmap.FIELDS


def _acl(conn: int, att: bytes) -> bytes:
    l2cap = struct.pack("<HH", len(att), ATT_CID) + att
    return struct.pack("<HH", conn & 0x0FFF, len(l2cap)) + l2cap


def _write(conn: int, payload: bytes) -> bytes:
    return _acl(conn, struct.pack("<BH", ATT_WRITE_CMD, NUS_RX_HANDLE) + payload)


def _btsnoop_file(frames: list[str]) -> Path:
    """One or more already-terminated `$...,*` ASCII frames -> a datalink-1001
    btsnoop file (each frame as its own single ATT write)."""
    packets = [_write(0x0041, f.encode("ascii")) for f in frames]
    blob = b"btsnoop\x00" + struct.pack(">II", 1, 1001)
    for i, pkt in enumerate(packets):
        blob += struct.pack(">IIIIq", len(pkt), len(pkt), 0, 0, i * 1000)
        blob += pkt
    fh = tempfile.NamedTemporaryFile(suffix=".log", delete=False)
    fh.write(blob)
    fh.close()
    return Path(fh.name)


def _weap_frame(slot="0", sound="C01", dmg="10", overrides: dict | None = None) -> str:
    """A $WEAP frame with FIELD_WIDTH tokens, aligned so tok index == FIELDS key."""
    t = ["Z"] * FIELD_WIDTH
    t[0] = slot
    t[5] = dmg     # primaryDamage
    t[27] = sound  # primaryFire_Snd — the nearest thing to a weapon identity
    for i, v in (overrides or {}).items():
        t[i] = v
    return "$WEAP," + ",".join(t) + ",*"


def _run_main(argv: list[str]) -> tuple[str, str, int]:
    """Run weapmap.main() with argv, returning (stdout, stderr, exit_code)."""
    old_argv = sys.argv
    sys.argv = ["weapmap"] + argv
    out, err = io.StringIO(), io.StringIO()
    code = 0
    try:
        with redirect_stdout(out), redirect_stderr(err):
            main()
    except SystemExit as e:
        code = e.code or 0
    finally:
        sys.argv = old_argv
    return out.getvalue(), err.getvalue(), code


def test_two_weapons_in_one_capture_are_aligned_into_two_columns():
    a = _weap_frame(sound="C01", dmg="10")
    b = _weap_frame(sound="C02", dmg="20")
    path = _btsnoop_file([a, b])
    try:
        out, err, code = _run_main([str(path)])
    finally:
        path.unlink()
    assert code == 0
    assert "2 distinct weapon frame(s)" in out
    assert "C01 s0" in out and "C02 s0" in out
    assert "varying tokens: [5, 27]" in out
    # neither varying position is one of the never-validated ones
    assert "no previously-unvalidated position moved" in out


def test_identical_weapon_repeated_across_captures_does_not_duplicate_a_column():
    a = _weap_frame(sound="C01", dmg="10")
    b = _weap_frame(sound="C02", dmg="20")
    c_same_as_a = _weap_frame(sound="C01", dmg="10")  # byte-identical stat line
    path1 = _btsnoop_file([a, b])
    path2 = _btsnoop_file([c_same_as_a])
    try:
        out, err, code = _run_main([str(path1), str(path2)])
    finally:
        path1.unlink()
        path2.unlink()
    assert f"{path1.name}: 2 new weapon frame(s)" in err
    assert f"{path2.name}: 0 new weapon frame(s)" in err  # already seen -> not a new column
    assert "2 distinct weapon frame(s)" in out


def test_same_sound_different_stats_is_kept_as_a_separate_column_and_suffixed():
    # cap18 showed the SAME fire-sound on two different weapons with different
    # stats — keying on the full stat line (not the sound) is what catches that;
    # keying on sound alone would silently merge them into one column.
    a = _weap_frame(sound="C01", dmg="10")
    c = _weap_frame(sound="C01", dmg="30")  # same sound+slot, different damage
    path = _btsnoop_file([a, c])
    try:
        out, err, code = _run_main([str(path)])
    finally:
        path.unlink()
    assert "3 distinct weapon frame(s)" not in out  # sanity: only 2 frames fed
    assert "2 distinct weapon frame(s)" in out
    assert "C01 s0" in out
    assert "C01 s0#2" in out  # the collision gets a disambiguating suffix


def test_slot_filter_excludes_frames_on_other_slots():
    slot0 = _weap_frame(slot="0", sound="C01", dmg="10")
    slot1 = _weap_frame(slot="1", sound="C02", dmg="20")
    path = _btsnoop_file([slot0, slot1])
    try:
        out, err, code = _run_main(["--slot", "0", str(path)])
    finally:
        path.unlink()
    assert code == 0
    assert "1 distinct weapon frame(s)" in out
    assert "C02 s1" not in out


def test_unvalidated_position_that_finally_moves_is_flagged_as_new_info():
    # index 7 = secondaryFireChance, one of the positions the 2-frame derivation
    # could never validate (weapmap.UNVALIDATED). Two weapons that differ ONLY
    # there must surface it as newly-informative, not just "varies".
    a = _weap_frame(sound="C01", dmg="10", overrides={7: "0"})
    b = _weap_frame(sound="C02", dmg="10", overrides={7: "5"})
    path = _btsnoop_file([a, b])
    try:
        out, err, code = _run_main([str(path)])
    finally:
        path.unlink()
    assert "previously-unvalidated position(s) finally moved: [7]" in out
    assert "**NEW INFO**" in out


def test_no_weap_frames_in_any_capture_exits_nonzero():
    path = _btsnoop_file(["$TID,1,*", "$PING,*"])
    try:
        out, err, code = _run_main([str(path)])
    finally:
        path.unlink()
    assert code == 1
    assert "no $WEAP frames found" in err


def test_unreadable_capture_is_reported_and_skipped_not_fatal():
    out, err, code = _run_main(["/nonexistent/path/does-not-exist.log"])
    assert code == 1  # nothing usable was found, but it didn't crash getting there
    assert "!! " in err and "does-not-exist.log" in err


def test_no_arguments_prints_usage_and_exits_2():
    out, err, code = _run_main([])
    assert code == 2
    assert "weapmap" in err or "$WEAP" in err  # the module docstring, on stderr
