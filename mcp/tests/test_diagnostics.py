"""Parser tests for the Mission Control diagnostics layer.

Gun-off: these validate the pure parsers against known-good frames/dumps, so the
diagnostics tools can be trusted before a tagger is ever connected.
Run: python -m pytest mcp/tests/  (or python mcp/tests/test_diagnostics.py)
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from brx_mcp import protocol as P  # noqa: E402


def test_parse_version():
    v = P.parse_version("$VERSION,v4.32,?,4,,devhost.03,*")
    assert v["firmware"] == "v4.32"
    assert v["host_image"] == "devhost.03"
    assert v["is_devhost"] is True
    # retail-style host image is not flagged devhost
    assert P.parse_version("$VERSION,v5.00,?,4,,rel.01,*")["is_devhost"] is False
    assert P.parse_version("$PONG,*") == {}


def test_parse_volts():
    b = P.parse_volts("$VOLTS,7662,3921,55,70,*")
    assert b["pack_mv"] == 7662 and b["cell_mv"] == 3921
    assert b["pack_v"] == 7.662 and b["cell_v"] == 3.921
    assert b["charge_pct"] == 55 and b["level_pct"] == 70
    # missing tokens degrade to None, not a crash
    assert P.parse_volts("$VOLTS,*")["pack_mv"] is None
    assert P.parse_volts("$HP,0,*") == {}


def test_parse_event_routes_diagnostics():
    assert P.parse_event("$VOLTS,7662,3921,55,70,*")["pack_v"] == 7.662
    assert P.parse_event("$VERSION,v4.32,?,4,,devhost.03,*")["firmware"] == "v4.32"


def test_parse_query():
    dump = (
        "BRX QUERY\n"
        "Serial Number/Head PIN: R0BQT\n"
        "BT central V: devhost.03\n"
        "NRFhost 1\nNRFslave 1\ndevHost 1\n"
        "Tested by: JB\n"
        "PCB-5\n"
    )
    q = P.parse_query(dump)
    assert q["serial_head_pin"] == "R0BQT"
    assert q["bt_central_version"] == "devhost.03"
    assert q["nrf_host"] == 1 and q["nrf_slave"] == 1 and q["dev_host"] == 1
    assert q["pcb_rev"] == "PCB-5"
    assert q["tested_by"] == "JB"
    assert q["raw"] == dump  # raw always preserved


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"PASS {name}")
    print("all diagnostics parser tests passed")
