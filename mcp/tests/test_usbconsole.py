"""Tests for the USB device-record parser (pure — no serial/hardware)."""

from brx_mcp.usbconsole import parse_query

SAMPLE = """Gun Info
Gun Version: v4.32
Serial Number/Head PIN: R0BQT
Gun Name: Tactix2
Headset Version: hds.59
Gun: 7.671 VOLTS
PlayerID 0
FieldID1
NRFhost 1
NRFslave 1
devHost 1
Head: 3.837 VOLTS
Head Tested:
Head BURN in test: 0
Gun BURN in test: 3hours28minutes
Grenade Pin: 0
Laser: 16.9 mW
Tested by: JB
PCB-5
BTchip- 4
BT central V: devhost.03
"""


def test_parses_core_identity_fields():
    r = parse_query(SAMPLE)
    assert r["gun_version"] == "v4.32"
    assert r["serial_head_pin"] == "R0BQT"       # the headset sticker id
    assert r["gun_name"] == "Tactix2"
    assert r["headset_version"] == "hds.59"
    assert r["bt_central_v"] == "devhost.03"


def test_parses_numeric_fields():
    r = parse_query(SAMPLE)
    assert r["gun_volts"] == 7.671 and r["head_volts"] == 3.837
    assert r["player_id"] == 0 and r["field_id"] == 1
    assert r["nrf_host"] == 1 and r["nrf_slave"] == 1 and r["dev_host"] == 1
    assert r["laser_mw"] == 16.9
    assert r["pcb"] == 5 and r["bt_chip"] == 4
    assert r["grenade_pin"] == 0


def test_headset_linked_flag():
    assert parse_query(SAMPLE)["headset_linked"] is True
    # a fresh power-cycle reads Headset Version '?' until re-handshake → not linked
    unlinked = SAMPLE.replace("Headset Version: hds.59", "Headset Version: ?") \
                     .replace("Serial Number/Head PIN: R0BQT", "Serial Number/Head PIN:")
    assert parse_query(unlinked)["headset_linked"] is False


def test_real_world_quirks_nul_padding_and_untested_laser():
    # the actual gun over USB: NUL-padded name, CRCR line ends, non-numeric laser
    raw = ("Gun Name: Tactix\x00\x00\x00\x00\r\r\n"
           "Grenade Pin: 7052\r\r\n"
           "Laser: UNTESTED\r\r\n"
           "Gun BURN in test:  None\r\r\n")
    r = parse_query(raw)
    assert r["gun_name"] == "Tactix"          # NUL padding stripped
    assert r["grenade_pin"] == 7052           # a real non-zero pin
    assert r["laser"] == "UNTESTED" and r["laser_mw"] is None
    assert r["gun_burn_in"] == "None"


def test_numeric_laser_still_parses():
    r = parse_query("Laser: 16.9 mW\r\n")
    assert r["laser_mw"] == 16.9 and r["laser"] == "16.9 mW"


def test_empty_and_garbage_dont_crash():
    assert parse_query("")["gun_version"] is None
    assert parse_query("random noise\nno fields here")["serial_head_pin"] is None
    assert parse_query("")["headset_linked"] is False


def test_gun_name_does_not_bleed_across_interleaved_read():
    # a stale/interleaved read: "Gun Name: Tac" then a re-echoed "QUERY\rGun Info"
    raw = "Gun Name: Tac\x00\x00QUERY\rGun Info\r\n"
    assert parse_query(raw)["gun_name"] == "Tac"   # bounded at NUL, no bleed


# ---- armory inventory accumulator (temp BASE_DIR, no hardware) ------------- #
import tempfile, pathlib
import brx_mcp.storage as _storage
from brx_mcp import usbconsole as _uc


def _with_tmp_base(fn):
    old = _storage.BASE_DIR
    _storage.BASE_DIR = pathlib.Path(tempfile.mkdtemp())
    try:
        fn()
    finally:
        _storage.BASE_DIR = old


def test_inventory_add_and_merge_keyed_by_pin():
    def body():
        assert _uc.load_inventory() == {}
        _uc.add_to_inventory(parse_query(SAMPLE) | {"serial_head_pin": "R0BQT"})
        inv = _uc.load_inventory()
        assert "R0BQT" in inv and inv["R0BQT"]["headset_linked"] is True
        _uc.add_to_inventory(parse_query(SAMPLE) | {"serial_head_pin": "R0BQT", "player_id": 5})
        inv = _uc.load_inventory()
        assert len(inv) == 1 and inv["R0BQT"]["player_id"] == 5
        _uc.add_to_inventory(parse_query(SAMPLE) | {"serial_head_pin": "Z9XYZ"})
        assert set(_uc.load_inventory()) == {"R0BQT", "Z9XYZ"}
    _with_tmp_base(body)


def test_inventory_ignores_record_without_pin():
    def body():
        _uc.add_to_inventory({"gun_name": "Tactix"})
        assert _uc.load_inventory() == {}
    _with_tmp_base(body)
