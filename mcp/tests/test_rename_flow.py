"""Flow-level tests for `_rename` — the whole CLI path (connect → $STOP/$PLAYX/$NAME →
disconnect → armory update), not just the tail-stripping helpers. Runs against
FakeConnectionManager (brx_mcp.fake) with `brx_mcp.ble` stubbed in `sys.modules`, so
these load fine even where `bleak` isn't installed (system python, no BT/CI) — exactly
how `run_tests.py` is required to stay green.

Bench-confirmed 2026-09-02: a gun goes off the air the instant it accepts `$NAME`, so
(a) the disconnect that follows a successful rename can itself raise, and (b) a second
`rename` run immediately after fails to even connect. Neither should look like a plain
rename failure to the operator, and (a) must not stop the armory record from being
updated — the rename DID land on the wire.
"""
import asyncio

from _async import run as _run
import contextlib
import io
import pathlib
import sys
import tempfile
import types

import brx_mcp.storage as _storage
from brx_mcp import usbconsole as _uc
from brx_mcp.__main__ import _rename
from brx_mcp.fake import FakeConnectionManager, FakeTagger

ADDR = "AA:BB:CC:DD:EE:01"




def _with_tmp_base(fn):
    old = _storage.BASE_DIR
    _storage.BASE_DIR = pathlib.Path(tempfile.mkdtemp())
    try:
        fn()
    finally:
        _storage.BASE_DIR = old


def _rename_capturing_stderr(mgr, address, name) -> str:
    """Run `_rename` against a fake manager and return everything printed to stderr.

    `_rename` does `from .ble import ConnectionManager` INSIDE the function (so the CLI
    loads without bleak installed) and resolves that against `sys.modules['brx_mcp.ble']`
    — stub that entry rather than importing the real (bleak-dependent) module, so this
    test runs under system python same as everything else in the suite.
    """
    had_real = "brx_mcp.ble" in sys.modules
    old = sys.modules.get("brx_mcp.ble")
    stub = types.ModuleType("brx_mcp.ble")
    stub.ConnectionManager = lambda: mgr
    sys.modules["brx_mcp.ble"] = stub
    try:
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            _run(_rename(address, name))
        return buf.getvalue()
    finally:
        if had_real:
            sys.modules["brx_mcp.ble"] = old
        else:
            del sys.modules["brx_mcp.ble"]


class _DropsOnDisconnect(FakeConnectionManager):
    """Models the bench find: the gun goes off the air the moment it accepts $NAME, so
    the disconnect that follows a SUCCESSFUL rename raises — that is the NORMAL case,
    not a failure of the rename."""

    async def disconnect(self, alias):
        if alias == "rn":
            raise ConnectionError(f"device vanished (alias={alias})")
        return await super().disconnect(alias)


def test_disconnect_after_success_does_not_get_reported_as_a_failed_rename():
    def body():
        _uc.add_to_inventory({"serial_head_pin": "S1", "gun_name": "Old",
                              "ble_address": ADDR, "name_confirmed": True})
        mgr = _DropsOnDisconnect([FakeTagger(ADDR, name="Old")])
        err = _rename_capturing_stderr(mgr, ADDR, "Bravo")
        # the $NAME send itself succeeded — a disconnect-time drop must not be reported
        # as the rename failing
        assert "FAILED" not in err, err
        # ...and the armory record must reflect the rename that actually happened on
        # the wire, not be left stuck on the pre-rename name because of the disconnect
        rec = _uc.load_inventory()["S1"]
        assert rec["gun_name"] == "Bravo"
        assert rec["name_confirmed"] is False          # pending reboot, as usual
    _with_tmp_base(body)


def test_a_gun_still_off_the_air_gets_a_power_cycle_hint_not_a_raw_bleak_error():
    def body():
        mgr = FakeConnectionManager([FakeTagger(ADDR, name="Bravo")])
        mgr.fail_connect.add(ADDR)          # e.g. a SECOND `rename` right after the first
        err = _rename_capturing_stderr(mgr, ADDR, "Charlie")
        assert "FAILED" in err                      # still reported as a failure...
        assert "power-cycle" in err.lower()          # ...but with the known cause, not a raw trace
    _with_tmp_base(body)


# --- What actually goes ON THE WIRE ------------------------------------------ #
# The hole that let the bad fix ship, found by mutation on 2026-09-02: changing the send loop to
# `$NAME,{name}` (the RAW operator input) instead of `{nm}` (the sanitized, tail-stripped name) left
# the ENTIRE suite green while the CLI would write `$NAME,ALPHA-3D4F-3D4F,*` to a real gun. Every
# other test asserts stderr text or the armory record, and the armory value comes from the same
# variable rather than from the transmitted frame. So: assert the frame.

def _tx_frames(mgr, alias="rn"):
    sess = next(iter(mgr.sessions.values())) if mgr.sessions else None
    buf = sess.buffer if sess is not None else []
    return [e.raw for e in buf if getattr(e, "direction", "") == "tx"]


def test_the_NAME_frame_ON_THE_WIRE_carries_the_stripped_name():
    def body():
        mgr = FakeConnectionManager([FakeTagger(ADDR)])
        sent = {}
        real_send = mgr.send

        async def spy(alias, command, reply_window_ms=0):
            sent.setdefault("frames", []).append(command)
            return await real_send(alias, command, reply_window_ms)

        mgr.send = spy
        # feed it the ADVERTISED name, tail and all -- what `scan` prints and an operator pastes
        _rename_capturing_stderr(mgr, ADDR, "ALPHA-ee01")
        names = [f for f in sent.get("frames", []) if f.startswith("$NAME")]
        assert names, "no $NAME frame was ever sent"
        assert names[-1] == "$NAME,ALPHA,*", f"wrong name on the wire: {names[-1]}"
        assert "ee01" not in names[-1].lower(), "the gun's own tail was sent back to it"

    _with_tmp_base(body)


def test_a_macos_uuid_address_does_not_mangle_a_legitimate_name_on_the_wire():
    """No MAC means no known tail, so nothing may be stripped.

    Deriving a tail from a CoreBluetooth UUID invented one, which both disabled the protection on
    the match-day machine and ate 5 characters off names that merely ended in those hex digits.
    """
    uuid = "0B1C2D3E-4F50-6172-8394-A5B6C7D8E9FA"

    def body():
        mgr = FakeConnectionManager([FakeTagger(uuid)])
        sent = []
        real_send = mgr.send

        async def spy(alias, command, reply_window_ms=0):
            sent.append(command)
            return await real_send(alias, command, reply_window_ms)

        mgr.send = spy
        _rename_capturing_stderr(mgr, uuid, "SQUAD-E9FA")
        names = [f for f in sent if f.startswith("$NAME")]
        assert names and names[-1] == "$NAME,SQUAD-E9FA,*", f"name was mangled: {names}"

    _with_tmp_base(body)
