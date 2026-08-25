"""Unit tests for the diagnostics handshake (bleak-free, against FakeTaggers).
Protects the $STOP→$PHONE→$VERSION→$VOLTS sequence fixed live on 2026-08-24."""

import asyncio

from brx_mcp.fake import FakeTagger, FakeConnectionManager
from brx_mcp.diagnostics import run_diagnose


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_diagnose_reads_firmware_and_battery():
    mgr = FakeConnectionManager([FakeTagger("AA:1")])
    rec = _run(run_diagnose(mgr, "AA:1", volts_wait_s=1))
    assert rec["reachable"] is True
    assert rec["firmware"] == "v4.32" and rec["host_image"] == "devhost.03"
    # battery came back → proves $VOLTS was reached, which only streams after $PHONE
    assert rec["battery"]["charge_pct"] == 55 and rec["battery"]["level_pct"] == 70
    assert rec["pong_latency_ms"] is None           # fake (like the real fw) never $PONGs
    assert "__diag_AA:1" not in mgr.sessions         # session released + disconnected


def test_diagnose_needs_the_phone_ritual():
    # if the handshake stopped opening the tap ($PHONE), the gun answers NEITHER
    # $VERSION nor $VOLTS (a cold gun is silent) — guards the whole ritual insight.
    class NoPhone(FakeTagger):
        def write(self, frame):
            if frame.startswith("$PHONE"):
                return                                # tap never opens
            super().write(frame)
    mgr = FakeConnectionManager([NoPhone("BB:2")])
    rec = _run(run_diagnose(mgr, "BB:2", volts_wait_s=1))
    assert rec["reachable"] is True                  # it connected...
    assert rec["firmware"] is None                    # ...but stayed silent without the tap
    assert rec["battery"] is None


def test_diagnose_unreachable_is_reported_not_raised():
    mgr = FakeConnectionManager([FakeTagger("CC:3")])
    mgr.fail_connect.add("CC:3")
    rec = _run(run_diagnose(mgr, "CC:3"))
    assert rec["reachable"] is False and rec["firmware"] is None
    assert "error" in rec                            # reported, not raised


from brx_mcp.diagnostics import run_fleet_status


def test_fleet_status_assembles_dashboard():
    mgr = FakeConnectionManager([FakeTagger("AA:1", name="Ace"),
                                 FakeTagger("BB:2", name="Bee")])
    res = _run(run_fleet_status(mgr))                # addresses=None → scan finds both
    assert res["scanned"] == 2 and len(res["taggers"]) == 2
    for t in res["taggers"]:
        assert t["reachable"] and t["firmware"] == "v4.32"
        assert t["battery"]["charge_pct"] == 55
        assert t["name"] in ("Ace", "Bee") and t["rssi"] == -50


def test_fleet_status_explicit_addresses_and_one_unreachable():
    mgr = FakeConnectionManager([FakeTagger("AA:1"), FakeTagger("BB:2")])
    mgr.fail_connect.add("BB:2")
    res = _run(run_fleet_status(mgr, addresses=["AA:1", "BB:2"]))
    recs = {t["address"]: t for t in res["taggers"]}
    assert recs["AA:1"]["reachable"] and recs["BB:2"]["reachable"] is False
