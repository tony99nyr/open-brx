"""F207: `GUN ECHO ≠ CONFIG` compared the echo against the WRONG `$WEAP` field on every gun.

Evidence, session 3782dc77, 2026-09-13 (`docs/evidence/2026-09-13-session-3782dc77/heads.md` and
`acks.md`): three real weapons, six real acks, mag correct every time and reserve exactly HALF the
configured reserve every time. `compile.py` keeps the invariant `tok17 == 2 * tok40` on every head
it writes, and the gun's own `$ALCD` echo mirrors t40, not t17. `frames.head_spawn_ammo` used to
read t17, so the check could never pass on any weapon on any gun.

These frames are pasted VERBATIM from the evidence, not re-derived, so this suite cannot agree with
itself by construction the way a synthetic-frame test can.

Run: python3 run_tests.py frames_echo
"""
from brx_mcp.mc import frames as _f
from brx_mcp.mc.compile import Compiler
from test_mc_config_proof import ack, mk, online, row

# Real `$WEAP,0` heads, byte for byte off the gun, one per weapon.
SNIPER_EXTENDED_MAGS_HEAD = [
    "$WEAP,0,,100,0,1,60,0,,,,,,,,1500,850,8,48,1700,0,7,100,100,,0,,,S16,D20,D19,,D04,D03,D02,"
    "D18,,,,,8,24,75,*",
]
AMR_HEAD = [
    "$WEAP,0,,100,0,3,24,0,,,,,,,,400,850,14,56,1400,0,7,100,100,,0,,,S07,D20,D19,,D04,D03,D02,"
    "D18,,,,,14,28,75,*",
]
BURST_RIFLE_HEAD = [
    "$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,"
    ",,,,36,108,75,*",
]

# Real `$ALCD` echoes the guns answered with, same session (`acks.md`).
SNIPER_EXTENDED_MAGS_ECHO = "$ALCD,8,100,0,24,0,*"
AMR_ECHO = "$ALCD,14,100,0,28,0,*"
BURST_RIFLE_ECHO = "$ALCD,36,100,0,108,0,*"


def _proves(head: list[str], echo: str) -> bool:
    """True when the gun's real echo matches what MC expects it to answer with."""
    want = _f.head_spawn_ammo(head)
    got = _f.alcd_ammo(echo)
    assert want is not None and got is not None
    return want == got


def test_sniper_extended_mags_real_echo_now_proves():
    assert _proves(SNIPER_EXTENDED_MAGS_HEAD, SNIPER_EXTENDED_MAGS_ECHO)


def test_amr_real_echo_now_proves():
    assert _proves(AMR_HEAD, AMR_ECHO)


def test_burst_rifle_real_echo_now_proves():
    assert _proves(BURST_RIFLE_HEAD, BURST_RIFLE_ECHO)


def test_head_spawn_ammo_reads_t40_not_t17():
    """Pin the exact field: t17 (the configured, doubled reserve) must NOT be what comes back."""
    mag, reserve = _f.head_spawn_ammo(SNIPER_EXTENDED_MAGS_HEAD)
    assert (mag, reserve) == (8, 24)
    assert reserve != 48, "48 is t17, the CONFIGURED reserve -- the gun never echoes that"


def test_head_spawn_ammo_falls_back_to_half_t17_when_t40_is_missing():
    """A frame with t40 blanked (an older capture) still has to say something: t17 // 2."""
    p = SNIPER_EXTENDED_MAGS_HEAD[0].split(",")
    p[41] = ""                                   # blank t40, keep t17 (48) and the full length
    blanked = ",".join(p)
    mag, reserve = _f.head_spawn_ammo([blanked])
    assert (mag, reserve) == (8, 24)


def test_a_real_captured_head_and_echo_prove_the_check_through_state_py():
    """End to end: swap a compiled bundle's head for the REAL captured one, ack with the REAL
    echo, and the board must read PROVEN, not a red `GUN ECHO ≠ CONFIG` on a healthy gun."""
    s, net, clock, ps = mk(1, compiler=Compiler())
    online(s, net, clock, ps[0], 0)
    s.push_config()
    pid = ps[0]["player_id"]
    s.bundles[pid]["head"] = SNIPER_EXTENDED_MAGS_HEAD
    ack(net, s, 0, pid, echo=SNIPER_EXTENDED_MAGS_ECHO)
    r = row(s, pid)
    assert r["echo"] == "proven" and r["status"] == "green", r
