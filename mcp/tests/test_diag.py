"""Tests for the diagnostic-game pure logic (predicates, scorecard, requirements).

No BLE — synthetic parsed-event lists exercise the verify predicates, and hand-built
Reports exercise the scorecard. Mirrors what the live runner would feed them.
"""

from brx_mcp.diag.model import (
    Capability, DiagCase, Outcome, Report, Result,
    saw_command, saw_pong, hp_dropped, ammo_decremented, grenade_beacon,
)
from brx_mcp.diag import CATALOG


def _ev(raw, command, tokens):
    return {"raw": raw, "command": command, "tokens": tokens}


# ---- verify predicates ------------------------------------------------------ #
def test_saw_pong_detects_pong():
    ok, _ = saw_pong()([_ev("$!DFP,PONG,*", "PONG", ["PONG"])])
    assert ok
    ok, _ = saw_pong()([_ev("$BUT,0,1,*", "BUT", ["BUT", "0", "1"])])
    assert not ok


def test_hp_dropped_sees_damage_below_spawn():
    ok, detail = hp_dropped()([
        _ev("$HP,45,70,0,*", "HP", ["HP", "45", "70", "0"]),   # baseline (no damage)
        _ev("$HP,45,52,0,*", "HP", ["HP", "45", "52", "0"]),   # armor fell → damage
    ])
    assert ok and "52" in detail


def test_hp_dropped_false_when_full():
    ok, _ = hp_dropped()([_ev("$HP,45,70,0,*", "HP", ["HP", "45", "70", "0"])])
    assert not ok


def test_ammo_decremented():
    evs = [
        _ev("$ALCD,36,100,0,108,0,*", "ALCD", ["ALCD", "36", "100", "0", "108", "0"]),
        _ev("$ALCD,33,100,0,108,0,*", "ALCD", ["ALCD", "33", "100", "0", "108", "0"]),
    ]
    ok, detail = ammo_decremented()(evs)
    assert ok and "36" in detail and "33" in detail


def test_ammo_not_decremented_single_sample():
    ok, _ = ammo_decremented()([
        _ev("$ALCD,36,100,0,108,0,*", "ALCD", ["ALCD", "36", "100", "0", "108", "0"]),
    ])
    assert not ok


def test_grenade_beacon_detects_token2_15():
    ok, detail = grenade_beacon()([
        _ev("$HIR,0,15,0,2,8,0,0,*", "HIR", ["HIR", "0", "15", "0", "2", "8", "0", "0"]),
    ])
    assert ok and "15" in detail
    # a gun shot ($HIR token2=0) must NOT count as a grenade beacon
    ok, _ = grenade_beacon()([
        _ev("$HIR,0,0,0,2,9,0,3,*", "HIR", ["HIR", "0", "0", "0", "2", "9", "0", "3"]),
    ])
    assert not ok


# ---- scorecard / report ----------------------------------------------------- #
def test_report_counts_and_clean():
    rep = Report("Tactix-TEST")
    rep.add(Result("a", "A", "conn", Outcome.PASS))
    rep.add(Result("b", "B", "conn", Outcome.SKIP, detail="needs 2guns"))
    rep.add(Result("c", "C", "audio", Outcome.MANUAL))
    assert rep.passed()                      # no fail/error → clean
    rep.add(Result("d", "D", "health", Outcome.FAIL, detail="no damage"))
    assert not rep.passed()                  # a FAIL makes it not clean
    c = rep.counts()
    assert c["pass"] == 1 and c["skip"] == 1 and c["manual"] == 1 and c["fail"] == 1


def test_scorecard_renders_all_categories():
    rep = Report("T")
    rep.add(Result("a", "Ping", "connectivity", Outcome.PASS, "1× $PONG"))
    rep.add(Result("i", "IR capture", "ir", Outcome.SKIP, "needs ir"))
    s = rep.scorecard()
    assert "connectivity" in s and "ir" in s
    assert "Ping" in s and "CLEAN" in s


# ---- requirement gating (skip logic, via the catalog) ----------------------- #
def test_ir_cases_require_ir_capability():
    ir_cases = [c for c in CATALOG if c.category == "ir"]
    assert ir_cases, "catalog should have IR cases"
    for c in ir_cases:
        assert Capability.IR in c.requires   # so they SKIP without the ESP32 bridge


def test_ble_only_cases_dont_require_hardware_extras():
    ping = next(c for c in CATALOG if c.id == "conn.ping")
    assert ping.requires == (Capability.BLE,)


def test_catalog_ids_unique():
    ids = [c.id for c in CATALOG]
    assert len(ids) == len(set(ids))
