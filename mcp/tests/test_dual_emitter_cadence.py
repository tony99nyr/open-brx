"""F638 (bench 2026-11-01): a weapon whose headset also fires must not out-pace the headset.

A `$WEAP` with t1 = 2 (gun AND headset) relays a second word to the SHOOTER's own headset on every shot, and the headset
spaces its words at least 200 ms apart (`protocol/brx-protocol.md`, the t12/t13/t42 row). The SMG fires every 100 ms,
so its headset words queue: after release the victim kept taking the 2-damage word about every 0.21 s for about 2 s,
even across a respawn (MC session 20261101T172409Z-8403e3). The Shotgun (400 ms) and the Rocket Launcher (1000 ms)
are slower than the headset and drain.

This guard fails when a dual weapon's cadence (t14) is under HEADSET_MIN_MS, unless the weapon is a known open
exception. The SMG is that exception until Tony decides F638's fix; the allow-list keeps a new weapon from joining it.

Run: python3 run_tests.py dual_emitter_cadence
"""
from brx_mcp.mc.compile import Compiler

HEADSET_MIN_MS = 250        # the 200 ms clamp, plus the 210-245 ms spacing the bench saw
OPEN_EXCEPTIONS = {"smg": "F638"}


def _dual_cadences():
    c = Compiler()
    out = {}
    for w in c.weapon_catalog():
        s = c.catalog.resolve(w["weapon_id"], 0, environment="outdoor").split(",")
        tok = lambda n: s[n + 1] if n + 1 < len(s) else ""   # noqa: E731
        if tok(1) in ("2", "4"):                              # GunAndHead, DoubleGunAndHead
            out[w["weapon_id"]] = int(tok(14) or 0)
    return out


def test_no_dual_weapon_outpaces_the_headset():
    fast = {wid: ms for wid, ms in _dual_cadences().items() if ms < HEADSET_MIN_MS and wid not in OPEN_EXCEPTIONS}
    assert not fast, f"dual-emitter weapons faster than the headset ({HEADSET_MIN_MS} ms) queue headset words: {fast}"


def test_the_open_exceptions_are_still_real():
    """When F638 is fixed, the SMG leaves the allow-list: this fails so the list cannot go stale."""
    cad = _dual_cadences()
    stale = {wid for wid in OPEN_EXCEPTIONS if cad.get(wid, HEADSET_MIN_MS) >= HEADSET_MIN_MS}
    assert not stale, f"no longer a fast dual weapon, remove from OPEN_EXCEPTIONS: {stale}"
    assert set(cad) >= {"shotgun"}, cad                       # the control: the scan sees the dual weapons at all
