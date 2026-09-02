"""The gun appends `-<MACtail>` to its advert; `$NAME` must never carry one.

Regression for the 2026-09-02 bench find: R0BAT was advertising as `R0BAT-3D4F-3D4F` because a
rename had been issued with the advertised name (which `scan` prints) instead of the bare name.
"""
from brx_mcp.__main__ import strip_advert_tail

ADDR = "FE:AD:FD:10:3D:4F"


def test_strips_the_tail_this_address_actually_appends():
    assert strip_advert_tail("R0BAT-3D4F", ADDR) == ("R0BAT", True)


def test_repairs_an_already_doubled_name():
    # the exact string found on the bench
    assert strip_advert_tail("R0BAT-3D4F-3D4F", ADDR) == ("R0BAT", True)


def test_case_insensitive():
    assert strip_advert_tail("R0BAT-3d4f", ADDR) == ("R0BAT", True)


def test_leaves_a_bare_name_alone():
    assert strip_advert_tail("R0BAT", ADDR) == ("R0BAT", False)


def test_keeps_hex_that_is_not_THIS_gun_tail():
    # a legitimate name that merely ends in hex must survive
    assert strip_advert_tail("SQUAD-BEEF", ADDR) == ("SQUAD-BEEF", False)


def test_does_not_eat_the_whole_name():
    # a name that IS only the tail leaves nothing; caller must refuse to send it
    assert strip_advert_tail("-3D4F", ADDR)[0] == "-3D4F"


def test_macos_uuid_address_has_no_mac_tail_to_match():
    uuid = "0B1C2D3E-4F50-6172-8394-A5B6C7D8E9FA"
    # tail is the last 4 alnum of the uuid; an unrelated name is untouched
    assert strip_advert_tail("R0BAT", uuid) == ("R0BAT", False)


# --- the ORDER test. The bug that reached hardware was not in strip_advert_tail (which was
# correct and green); it was that clean_callsign truncated FIRST, so the stripper never matched.
# These call the function _rename actually uses.
from brx_mcp.__main__ import name_for_rename


def test_doubled_name_survives_truncation_and_is_repaired():
    # "R0BAT-3D4F-3D4F" is 15 chars; CALLSIGN_MAX truncation must not get there first
    assert name_for_rename("R0BAT-3D4F-3D4F", ADDR) == ("R0BAT", True)


def test_single_tail_is_repaired_too():
    assert name_for_rename("R0BAT-3D4F", ADDR) == ("R0BAT", True)


def test_the_wrong_name_we_actually_wrote_is_repaired():
    # what the ordering bug put on the gun, fed back in
    assert name_for_rename("R0BAT-3D4F-3", ADDR)[0] == "R0BAT-3D4F-3"


def test_plain_name_passes_through():
    assert name_for_rename("R0BAT", ADDR) == ("R0BAT", False)


def test_framing_chars_still_sanitized():
    assert "," not in name_for_rename("R0B,AT-3D4F", ADDR)[0]


# --- a name that IS just this gun's own tail. `strip_advert_tail` deliberately won't
# reduce a name to nothing (test_does_not_eat_the_whole_name above), so on its own it
# leaves "-3D4F" untouched -- and untouched means `_rename` would happily ship it,
# producing "-3D4F-3D4F" on the gun: the exact doubling bug, from a typed name instead
# of a copy-pasted advert. `name_for_rename` is the one place that can catch this (it
# knows both the stripped result AND the tail), so it must blank it, not pass it through.
def test_name_that_is_only_the_tail_with_dash_is_refused():
    assert name_for_rename("-3D4F", ADDR) == ("", True)


def test_name_that_is_only_the_bare_tail_is_refused():
    assert name_for_rename("3D4F", ADDR) == ("", True)


def test_a_tail_only_name_on_the_macos_uuid_path_is_unaffected():
    # no MAC on this address form → no tail computed → nothing to refuse
    uuid = "0B1C2D3E-4F50-6172-8394-A5B6C7D8E9FA"
    assert name_for_rename("-3D4F", uuid) == ("-3D4F", False)


# --- unicode: CALLSIGN_MAX is a budget in WIRE BYTES; name_for_rename must not let a
# multi-byte name (accents, emoji) sail past it by counting Python characters instead.
def test_multibyte_name_is_capped_in_bytes_not_characters():
    from brx_mcp.modes.driver import CALLSIGN_MAX
    nm, _ = name_for_rename("Ω" * 20, ADDR)
    assert len(nm.encode("utf-8")) <= CALLSIGN_MAX
