"""Does $HIR report EVERY hit? Human counts flashes, machine counts $HIR, same shots.

The question this settles matters more than any single tagger. On 2026-09-02 a gun in its native game
registered hits, flashed and took damage while sending NOTHING over BLE -- so `$HIR` silence never
meant "not hit". Then, inside OUR game, 10 witnessed shots produced only 3 `$HIR` while the operator
saw flashes early and late. If `$HIR` under-reports inside our own game state, Mission Control
silently loses hits in a live match, and every score we compute is wrong in a way nothing flags.

Design: shots are SLOW (default 2.5 s) and announced with a countdown, so a human can reliably count
flashes without rushing. Each shot is witnessed. At the end you type in how many flashes you saw and
it prints the gap.

`$HP` is the tiebreaker and the reason this is trustworthy: the gun reports its pools independently,
so a hit that lands WITHOUT an `$HIR` still shows up as armour going down. Three counters that cannot
all be wrong in the same direction -- eyes, `$HIR`, and the pool.

Usage: python hir_gap.py <addr> [emitter_com=COM8] [shots=10] [receiver_com=COM7] [gap_s=2.5]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import SENSOR, witnessed, word
from brx_mcp.irbridge import IRBridge

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40


def pools(fr):
    try:
        t = fr.split(",")
        return int(t[1]), int(t[2])
    except Exception:
        return None


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    nshot = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    recv_com = sys.argv[4] if len(sys.argv) > 4 else "COM7"
    gap = float(sys.argv[5]) if len(sys.argv) > 5 else 2.5

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    rx._ser.write(b"s\n")
    rx._readlines(0.5)
    for _ in range(2):
        rx._ser.write(b"r\n")
        if any("RAW dump ON" in l for l in rx._readlines(0.5)):
            break

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):
        for fr in B.arming_frames(PID, VICTIM_TEAM, sirs=[B.SIR_PLAIN]):
            await mgr.send("v", fr, reply_window_ms=140)
            await asyncio.sleep(0.12)
        await mgr.send("v", B.AR, reply_window_ms=140)
        await asyncio.sleep(0.15)
        await mgr.send("v", "$SPAWN,*", reply_window_ms=300)
        await asyncio.sleep(1.5)
        print(f"\narmed + spawned. Firing {nshot} shots, {gap:.1f}s apart. COUNT THE FLASHES.\n",
              flush=True)

        hir = wit = 0
        first_pool = last_pool = None
        for i in range(nshot):
            mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            rx._ser.reset_input_buffer()
            tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
            tx.flush()
            await asyncio.sleep(1.0)
            w = witnessed(rx._readlines(0.4))
            wit += w
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
            h = [e for e in evs if e.startswith("$HIR")]
            hp = [e for e in evs if e.startswith("$HP")]
            if hp:
                p = pools(hp[-1])
                if p:
                    if first_pool is None:
                        first_pool = p
                    last_pool = p
            if h:
                hir += 1
                try:
                    sen = SENSOR.get(int(h[-1].split(",")[1]), "?")
                except Exception:
                    sen = "?"
                tag = f"$HIR {sen}"
            else:
                tag = "  --  "
            print(f"   SHOT {i+1:2d} of {nshot}   {tag}   witness={'OK ' if w else 'silent'}"
                  + (f"   pools {hp[-1]}" if hp else ""), flush=True)
            await asyncio.sleep(gap)

        # Ask the gun what its pools are NOW -- independent of every $HIR we did or did not see.
        mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
        await mgr.send("v", "$QUERY,*", reply_window_ms=1200)
        await asyncio.sleep(1.0)
        q = [e.get("raw", "").strip() for e in
             mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
        print("\n   final $QUERY:", [x for x in q if x.startswith("$QUERY,") and len(x) > 10])

    print(f"\n   shots fired      : {nshot}   (witness confirmed {wit})")
    print(f"   $HIR received    : {hir}")
    if first_pool and last_pool:
        drop = (first_pool[0] - last_pool[0]) + (first_pool[1] - last_pool[1])
        print(f"   pool drop        : {drop}  ({first_pool} -> {last_pool})  = hits the gun APPLIED")
    # No input() prompt: this runs under an agent's shell, where stdin would simply hang. The
    # operator reports the flash count in conversation and the comparison is made there.
    print("\n   >>> NOW: how many FLASHES did you count?")
    print("       flashes >  $HIR  -> $HIR UNDER-REPORTS: the gun is hit more often than it tells")
    print("                           us over BLE. That is an MC scoring bug, not a tagger fault.")
    print("       flashes == $HIR  -> reporting is honest; the misses are real misses.")
    print("       Cross-check with the pool drop above -- the gun counts hits it may not report.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
