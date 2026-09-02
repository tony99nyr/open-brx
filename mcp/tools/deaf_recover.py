"""Can a FRAME clear the deaf-headset fault, instead of a power cycle?

F11's headset stops reporting IR while everything else about it stays healthy, and the timeline says
it goes deaf ACROSS AN ARMING SEQUENCE rather than from being shot. If a frame breaks it, a frame may
fix it -- and a software recovery is worth far more than "power cycle it twice": MC could run it the
moment preflight detects the fault, mid-match, with no operator involved.

Confirms the fault is present first (a "recovery" measured against a healthy unit proves nothing),
then sends ONE candidate at a time and fires a small burst after each. Respawns before every burst so
a death can never be mistaken for deafness.

Usage: python deaf_recover.py <victim_addr> [emitter_com=COM8] [shots=3]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from brx_mcp.irbridge import payload_parity

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40


def word(mag, proto, team, sub=0, pid=42, crit=0):
    f = lambda v, n: format(v & ((1 << n) - 1), "0%db" % n)
    pay = f(proto, 4) + f(pid, 6) + f(team, 2) + f(mag, 8) + f(crit, 1) + f(sub, 2)
    return pay + payload_parity(pay)


async def main():
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    shots = int(sys.argv[3]) if len(sys.argv) > 3 else 3

    from brx_mcp.ble import ConnectionManager
    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    mgr = ConnectionManager()
    await mgr.connect(addr, "v")

    async def snd(f, s=0.22):
        await mgr.send("v", f, reply_window_ms=140)
        await asyncio.sleep(s)

    async def burst(label):
        await snd("$SPAWN,,*", 1.2)            # full pools: a death must not look like deafness
        seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
        for _ in range(shots):
            tx.write(("TX " + word(20, 0, ENEMY_TEAM) + "\n").encode())
            tx.flush()
            await asyncio.sleep(1.0)
        await asyncio.sleep(1.2)
        evs = [e.get("raw", "").strip() for e in
               mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
        hir = [e for e in evs if e.startswith("$HIR")]
        doms = sorted({h.split(",")[1] for h in hir})
        print("   %-42s %d/%d hits   sensors %s%s"
              % (label, len(hir), shots, doms or "-",
                 "   <<< RECOVERED" if hir else ""), flush=True)
        return len(hir)

    print("=== can a frame clear the deaf headset? (emitter aimed at a HEADSET dome) ===\n")
    try:
        for fr in B.arming_frames(PID, VICTIM_TEAM, sirs=[B.SIR_PLAIN]):
            await snd(fr)
        await snd(B.AR)
        await snd("$AMMO,0,32,192,1,*")
        await snd("$BMAP,0,0,,,,,*")

        if await burst("BASELINE (is the fault actually present?)"):
            print("\n   !! the headset is WORKING -- there is no fault to recover from.")
            print("      Nothing below would mean anything. Re-run once it is deaf again.")
            return

        cands = [
            ("$SPAWN again",                     ["$SPAWN,,*"]),
            ("$SPAWN x3",                        ["$SPAWN,,*", "$SPAWN,,*", "$SPAWN,,*"]),
            ("$TID re-sent",                     [f"$TID,{VICTIM_TEAM},*"]),
            ("$PSET re-sent",                    [B.PSET.format(pid=PID)]),
            ("$GSET re-sent",                    [B.GSET]),
            ("$SIR re-sent",                     [B.SIR_PLAIN]),
            ("$STOP then $START",                ["$STOP,*", "$START,*"]),
            ("full $CLEAR + re-arm",             None),
            ("$HLED wake then $SPAWN",           ["$HLED,6,0,,,10,,*", "$HLED,,6,,,,,*", "$SPAWN,,*"]),
        ]
        for label, frames in cands:
            if frames is None:
                for fr in B.arming_frames(PID, VICTIM_TEAM, sirs=[B.SIR_PLAIN]):
                    await snd(fr)
                await snd(B.AR)
                await snd("$AMMO,0,32,192,1,*")
                await snd("$BMAP,0,0,,,,,*")
            else:
                for fr in frames:
                    await snd(fr, 0.5)
            if await burst(label):
                print("\n   >>> %s CLEARED IT. That is a software recovery." % label, flush=True)
                break
    finally:
        await snd("$CLEAR,*", 0.2)
        try:
            await mgr.disconnect("v")
        except Exception:
            pass
        tx.close()


asyncio.run(main())
