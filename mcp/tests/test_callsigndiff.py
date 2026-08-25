"""Tests for the callsigndiff capture-vs-arm parser (pure — no capture files).

Guards the string logic (`cmd_of`/`toks`/`baseline_frames`) that the whole diff
report is built on — bang-frames and trailing-`*` stripping are exactly the kind
of silently-wrong parsing that would skew the report without erroring.
"""

from brx_mcp.callsigndiff import cmd_of, toks, baseline_frames, SUSPECT_PREFIXES


def test_cmd_of_normal_and_bang_frames():
    assert cmd_of("$GSET,1,0,1,0,1,0,50,1,*") == "GSET"
    assert cmd_of("$SFLASH,*") == "SFLASH"
    assert cmd_of("$UP") == "UP"                     # no comma, no trailing *
    assert cmd_of("$!5,PB,1,*") == "PB"              # bang-frame -> 2nd token


def test_toks_strips_trailing_star_forms():
    assert toks("$TID,1,*") == ["TID", "1"]          # ",*" stripped
    assert toks("$SPAWN,,*") == ["SPAWN", ""]         # empty middle token kept
    assert toks("$UP") == ["UP"]                      # nothing to strip
    assert toks("$FOO,1*") == ["FOO", "1"]            # bare trailing "*"


def test_baseline_frames_are_ordered_and_nonempty():
    b = baseline_frames("ffa")
    assert b and b[0].startswith("$VOL")             # the arm opens with volume
    assert any(f.startswith("$SPAWN") for f in b)     # ...and spawns live
    assert baseline_frames("tdm")[0].startswith("$VOL")


def test_suspect_prefixes_flag_playbook_not_ordinary_config():
    assert "PBGAME".startswith(SUSPECT_PREFIXES)     # $PB* playbook -> suspect
    assert "NRFSET".startswith(SUSPECT_PREFIXES)
    assert not "GSET".startswith(SUSPECT_PREFIXES)   # ordinary config -> not
    assert not "PSET".startswith(SUSPECT_PREFIXES)
