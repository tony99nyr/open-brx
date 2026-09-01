"""Bench item 1.5a — re-measure ALLY $SIR functions from DEPLETED pools.

WHY THIS EXISTS. The full $SIR function map was measured with the victim at FULL pools
(hp 45 / armour 70). A heal or an armour grant applied to a full pool CLAMPS, so it moves
nothing and reads as "registers a hit, moves no pool" -- i.e. it gets mis-binned as a status
function. That is exactly how fn 10, a KNOWN heal, ended up on the status shortlist. This
re-runs the ally functions with headroom opened first, so a grant has somewhere to land.

fn 10 and 11 are the POSITIVE CONTROLS. If they do not show as grants here, the METHOD is
wrong -- do not read anything into the other functions. Check the control before the result.

MECHANISM. The victim's own $SIR table decides what an incoming word does, so we arm the
victim with two rows and fire synthetic IR at it from the ESP32 emitter:
    $SIR,0,0,,1     <- protocol 0 = plain damage, fired from an ENEMY team, to deplete
    $SIR,1,0,,<fn>  <- protocol 1 = the ally function under test, fired from the OWN team
Team polarity is load-bearing: support functions apply only from your OWN team, damage only
from an ENEMY team, and a rejected shot emits NO $HIR at all (it is invisible, not zero).

Usage:  python ally_remeasure.py <victim_addr> [emitter_com=COM8] [fns=10,11,9,15,31,32,34]

Runs from Windows Python (WSL2 has no Bluetooth):
    /mnt/c/Users/Tony/.brx-mcp/venv/Scripts/python.exe mcp/tools/ally_remeasure.py <addr>

Needs the emitter board (B) aimed at the victim and the receiver serial monitor CLOSED --
Windows COM ports are exclusive and the Arduino monitor silently steals the port.
"""
import asyncio
import sys
import time

import serial

from bench_common import GSET, SIR_PLAIN   # the shared control frames (its AR/PSET are deliberately its own)
from brx_mcp.irbridge import payload_parity

# Victim config. Shield 150 is deliberate: it gives a third pool to open headroom in, and
# shields can only be granted by an IR function-11 event (P16), never by this $PSET token --
# so a shield grant showing up here is real evidence, not the value we wrote.
AR = ("$WEAP,0,,100,0,0,9,0,,,,,,,,190,850,32,384,1400,0,0,100,100,,0,,,"
      "R01,,,,D04,D03,D02,D18,,,,,32,192,75,*")
PSET = ("$PSET,40,0,45,70,150,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,"
        "H06,H55,H13,H21,H02,U15,W71,A10,*")

VICTIM_TEAM = 1
ENEMY_TEAM = 2
DEPLETE_MAG, DEPLETE_SHOTS = 30, 6      # 180 total vs shield 150 + armour 70 + hp 45
ALLY_MAG, ALLY_SHOTS = 50, 2


def word(mag: int, proto: int, team: int, sub: int = 0, pid: int = 42) -> str:
    """Build a 25-bit BRX IR word: B4 proto, P6 player, T2 team, D8 magnitude, C1 crit, U2 sub, Z2 parity."""
    f = lambda v, n: format(v & ((1 << n) - 1), "0%db" % n)
    pay = f(proto, 4) + f(pid, 6) + f(team, 2) + f(mag, 8) + f(0, 1) + f(sub, 2)
    return pay + payload_parity(pay)


def pools(frame):
    """`$HP,<hp>,<armor>,<shield>` -> (hp, armor, shield), or None if it isn't one."""
    try:
        t = frame.split(",")
        return int(t[1]), int(t[2]), int(t[3])
    except (ValueError, IndexError, AttributeError):
        return None


async def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit("need a victim address (get it from `python -m brx_mcp scan`)")
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    fns = [int(x) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 else [10, 11, 9, 15, 31, 32, 34]

    from brx_mcp.ble import ConnectionManager

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)                     # the ESP32 resets when the port opens
    tx.reset_input_buffer()
    mgr = ConnectionManager()
    await mgr.connect(addr, "p")

    async def arm(fn: int) -> None:
        for fr in ["$CLEAR,*", "$START,*", "$VOL,3,*", GSET, PSET, AR,
                   SIR_PLAIN, "$SIR,1,0,,%d,0,0,1,,*" % fn,
                   "$TID,%d,*" % VICTIM_TEAM, "$SPAWN,,*",
                   "$AMMO,0,32,192,1,*", "$BMAP,0,0,,,,,*"]:
            await mgr.send("p", fr, reply_window_ms=160)
        await asyncio.sleep(1.15)

    async def fire(mag: int, proto: int, team: int, n: int = 1, wait: float = 1.7):
        seq = mgr.get_events("p", since_seq=0).get("last_seq", 0)
        for _ in range(n):
            tx.write(("TX " + word(mag, proto, team) + "\n").encode())
            tx.flush()
            await asyncio.sleep(0.85)
        await asyncio.sleep(wait)
        evs = [e.get("raw", "").strip()
               for e in mgr.get_events("p", since_seq=seq).get("events", []) if isinstance(e, dict)]
        hir = [e for e in evs if e.startswith("$HIR")]
        hp = [e for e in evs if e.startswith("$HP")]
        return len(hir), (hp[-1] if hp else None)

    print("=== 1.5a - re-measure ALLY functions from DEPLETED pools ===", flush=True)
    print("   fn 10 and 11 are KNOWN grants = the positive controls. If they do not show as", flush=True)
    print("   grants, the METHOD is wrong and the other rows mean nothing.\n", flush=True)
    print("   %-6s %-20s %-20s %s" % ("fn", "after deplete", "after ally fn", "verdict"), flush=True)

    voids = 0
    try:
        for fn in fns:
            await arm(fn)
            _, depleted = await fire(DEPLETE_MAG, 0, ENEMY_TEAM, n=DEPLETE_SHOTS)
            if not depleted:
                voids += 1
                print("   %-6d %s" % (fn, "(deplete did not land - VOID, see note below)"), flush=True)
                continue
            before = pools(depleted)
            hits, after_frame = await fire(ALLY_MAG, 1, VICTIM_TEAM, n=ALLY_SHOTS)
            after = pools(after_frame) if after_frame else before
            if after is None:
                after = before
            d_hp, d_ar, d_sh = (after[0] - before[0], after[1] - before[1], after[2] - before[2])
            if d_hp > 0 or d_ar > 0 or d_sh > 0:
                verdict = "GRANT: hp+%d armour+%d shield+%d" % (d_hp, d_ar, d_sh)
            elif hits == 0:
                verdict = "did not register (no $HIR - check team polarity)"
            else:
                verdict = "lands, moves NO pool even with headroom -> real status function"
            print("   %-6d %-20s %-20s %s" % (fn, "%d/%d/%d" % before, "%d/%d/%d" % after, verdict), flush=True)
    finally:
        print("\n   (pools are hp/armour/shield.)", flush=True)
        if voids:
            print("   %d row(s) VOID: the deplete produced no $HP at all. That is an emitter-aim or\n"
                  "   connection problem, NOT a result -- the 2026-08-29 run voided this way because the\n"
                  "   gun was in the screamer state. Power-cycle, re-aim board B, and re-run." % voids,
                  flush=True)
        try:
            await mgr.send("p", "$CLEAR,*", reply_window_ms=250)
            await mgr.disconnect("p")
        except Exception:
            pass
        tx.close()


asyncio.run(main())
