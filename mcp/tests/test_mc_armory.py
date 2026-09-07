"""M-ARMORY adapter (mc/armory.py): `_to_record()`'s BLE-tail/platform-key/sticker/gen/fw
fallback rules, and `LocalArmory.list()`/`bind_player()` against a stubbed `usbconsole`.

`_to_record` is pure and exercised directly. `LocalArmory.list()` imports `usbconsole.load_inventory`
lazily inside the method body, so it is patched on the already-imported `brx_mcp.usbconsole` module
object (the `from X import Y` re-resolves `Y` off that object at call time) — always restored in a
`finally`, since `run_tests.py` imports every test module into one interpreter.
"""
from __future__ import annotations

from _async import run
import platform
import sys

import brx_mcp.usbconsole as _uc
from brx_mcp.mc import armory as A


# ---------------------------------------------------------------------------
# _to_record: BLE tail
# ---------------------------------------------------------------------------

def test_to_record_ble_tail_is_last_four_alnum_chars_uppercased():
    r = A._to_record("SN1", {"ble_address": "aa:bb:cc:dd:ee:1f"})
    assert r["ble"]["tail"] == "EE1F"


def test_to_record_ble_tail_strips_all_non_alnum_punctuation():
    # bleak on macOS hands back a UUID with dashes, not a colon-separated MAC — the strip must
    # not be colon-specific.
    r = A._to_record("SN1", {"ble_address": "1234ABCD-56EF-0000-0000-00112233FF9A"})
    assert r["ble"]["tail"] == "FF9A"


def test_to_record_short_address_keeps_the_whole_alnum_run():
    r = A._to_record("SN1", {"ble_address": "a:b"})
    assert r["ble"]["tail"] == "AB"


def test_to_record_empty_address_yields_empty_tail_and_no_platform_key():
    r = A._to_record("SN1", {})
    assert r["ble"] == {"tail": ""}
    assert "uuid" not in r["ble"] and "address" not in r["ble"]


def test_to_record_empty_string_address_is_treated_as_absent():
    r = A._to_record("SN1", {"ble_address": ""})
    assert r["ble"] == {"tail": ""}


# ---------------------------------------------------------------------------
# _to_record: platform-keyed BLE identifier (macOS gives UUIDs, not MAC addresses)
# ---------------------------------------------------------------------------

def _to_record_as(sysname: str, serial: str, row: dict):
    old = platform.system
    platform.system = lambda: sysname
    try:
        return A._to_record(serial, row)
    finally:
        platform.system = old


def test_to_record_uses_uuid_key_on_darwin():
    r = _to_record_as("Darwin", "SN1", {"ble_address": "AA:BB:CC:DD"})
    assert r["ble"]["uuid"] == "AA:BB:CC:DD"
    assert "address" not in r["ble"]


def test_to_record_uses_address_key_off_darwin():
    for sysname in ("Windows", "Linux"):
        r = _to_record_as(sysname, "SN1", {"ble_address": "AA:BB:CC:DD"})
        assert r["ble"]["address"] == "AA:BB:CC:DD", sysname
        assert "uuid" not in r["ble"], sysname


def test_to_record_platform_check_restores_cleanly():
    # guards the monkeypatch pattern itself: a leaked patch would corrupt every later test in
    # this one-interpreter suite (CLAUDE.md / run_tests.py).
    before = platform.system
    _to_record_as("Darwin", "SN1", {"ble_address": "AA:BB:CC:DD"})
    assert platform.system is before


# ---------------------------------------------------------------------------
# _to_record: sticker / gen / fw fallbacks
# ---------------------------------------------------------------------------

def test_to_record_sticker_falls_back_to_tactix_dash_tail_when_unnamed():
    r = A._to_record("SN1", {"ble_address": "AA:BB:CC:DD"})
    assert r["sticker"] == "Tactix-CCDD"


def test_to_record_sticker_uses_gun_name_stripped_of_whitespace():
    r = A._to_record("SN1", {"gun_name": "  Reaper  ", "ble_address": "AA:BB:CC:DD"})
    assert r["sticker"] == "Reaper"


def test_to_record_gen_is_gen1_only_for_the_exact_lowercase_string():
    assert A._to_record("SN1", {"gen": "gen1"})["gen"] == "gen1"
    assert A._to_record("SN1", {"gen": "Gen1"})["gen"] == "gen2_3"   # case-sensitive on purpose (pinned, not endorsed)
    assert A._to_record("SN1", {"gen": "gen2"})["gen"] == "gen2_3"
    assert A._to_record("SN1", {})["gen"] == "gen2_3"


def test_to_record_fw_prefers_firmware_key_over_fw_key():
    assert A._to_record("SN1", {"firmware": "v4.32", "fw": "stale"})["fw"] == "v4.32"


def test_to_record_fw_falls_back_to_fw_key_when_firmware_absent():
    assert A._to_record("SN1", {"fw": "v4.32"})["fw"] == "v4.32"


def test_to_record_fw_is_none_when_neither_key_present():
    assert A._to_record("SN1", {})["fw"] is None


# ---------------------------------------------------------------------------
# _to_record: passthrough fields
# ---------------------------------------------------------------------------

def test_to_record_gun_id_and_headset_pin_both_come_from_the_serial():
    r = A._to_record("SN-42", {})
    assert r["gun_id"] == "SN-42"
    assert r["headset_pin"] == "SN-42"


def test_to_record_labeled_is_coerced_to_bool_and_defaults_false():
    assert A._to_record("SN1", {"labeled": 1})["labeled"] is True
    assert A._to_record("SN1", {"labeled": 0})["labeled"] is False
    assert A._to_record("SN1", {})["labeled"] is False


def test_to_record_notes_defaults_to_empty_string():
    assert A._to_record("SN1", {})["notes"] == ""
    assert A._to_record("SN1", {"notes": "bent antenna"})["notes"] == "bent antenna"


# ---------------------------------------------------------------------------
# LocalArmory.list() — against a stubbed usbconsole.load_inventory
# ---------------------------------------------------------------------------

def _with_inventory(fn_or_dict, run):
    """Patch brx_mcp.usbconsole.load_inventory for the duration of `run()`, then restore it."""
    old = _uc.load_inventory
    _uc.load_inventory = fn_or_dict if callable(fn_or_dict) else (lambda: fn_or_dict)
    try:
        return run()
    finally:
        _uc.load_inventory = old


def test_local_armory_list_maps_every_inventory_row_through_to_record():
    inv = {"SN1": {"gun_name": "Reaper", "ble_address": "AA:BB:CC:DD"},
           "SN2": {"ble_address": "11:22:33:44"}}
    recs = _with_inventory(inv, lambda: A.LocalArmory().list())
    by_id = {r["gun_id"]: r for r in recs}
    assert set(by_id) == {"SN1", "SN2"}
    assert by_id["SN1"]["sticker"] == "Reaper"
    assert by_id["SN2"]["sticker"] == "Tactix-3344"


def test_local_armory_list_returns_empty_list_when_inventory_load_raises():
    def boom():
        raise RuntimeError("no usb console attached")
    recs = _with_inventory(boom, lambda: A.LocalArmory().list())
    assert recs == []


def test_local_armory_list_returns_empty_list_when_usbconsole_import_itself_fails():
    # armory.py imports `load_inventory` from `brx_mcp.usbconsole` lazily, inside the same
    # try/except that covers calling it — an import failure (e.g. the module missing on a lean
    # deploy) must be swallowed exactly like a raised call.
    had = "brx_mcp.usbconsole" in sys.modules
    old = sys.modules.get("brx_mcp.usbconsole")
    sys.modules["brx_mcp.usbconsole"] = None
    try:
        recs = A.LocalArmory().list()
    finally:
        if had:
            sys.modules["brx_mcp.usbconsole"] = old
        else:
            del sys.modules["brx_mcp.usbconsole"]
    assert recs == []


# ---------------------------------------------------------------------------
# LocalArmory.bind_player()
# ---------------------------------------------------------------------------

def test_local_armory_bind_player_raises_keyerror_for_a_gun_not_in_the_inventory():
    try:
        _with_inventory({}, lambda: A.LocalArmory().bind_player("GHOST", "p1"))
        assert False, "expected KeyError"
    except KeyError:
        pass


def test_local_armory_bind_player_is_a_noop_for_a_known_gun():
    result = _with_inventory({"SN1": {}}, lambda: A.LocalArmory().bind_player("SN1", "p1"))
    assert result is None   # bind_player validates only; it does not persist anything itself


# ---------------------------------------------------------------------------
# LocalArmory.scan() — BLE unavailable branch (system python here has no bleak; forced explicitly
# too, so the test does not depend on that environmental fact holding forever)
# ---------------------------------------------------------------------------

def test_local_armory_scan_returns_no_adverts_when_ble_is_unimportable():
    had = "brx_mcp.ble" in sys.modules
    old = sys.modules.get("brx_mcp.ble")
    sys.modules["brx_mcp.ble"] = None   # forces `from brx_mcp.ble import ConnectionManager` to raise
    try:
        rows = run(A.LocalArmory().scan(1))
    finally:
        if had:
            sys.modules["brx_mcp.ble"] = old
        else:
            del sys.modules["brx_mcp.ble"]
    assert rows == []
