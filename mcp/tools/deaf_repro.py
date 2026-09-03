"""ROOT CAUSE: how many hits does it take before the headset stops registering?

F11 (a tagger that arms, spawns and looks healthy while scoring nothing) recovered and relapsed three
times in one session, each time within minutes of a successful power cycle. That regularity is the
most useful thing we have. If it consistently goes deaf after N hits, N is the trigger and there is
something to chase. If it goes deaf after a fixed TIME regardless of hits, that is a different
mechanism entirely. Nobody has measured which, and the two are indistinguishable from a burst.

Fires ONE shot at a time with a generous gap, confirms each on the wire, and reports the exact shot
number where reporting stops -- alongside elapsed seconds, so a time-based cause separates from a
count-based one. Respawns when health gets low so a DEATH can never be mistaken for deafness: a dead
gun legitimately accepts no IR, and that confound has already wasted time on this rig.

Usage: python deaf_repro.py <victim_addr> [emitter_com=COM8] [gap_s=3] [max_shots=40]
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


def pools(fr):
    try:
        t = fr.split(",")
        return int(t[1]), int(t[2]), int(t[3])
    except Exception:
        return None


async def main():
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    gap = float(sys.argv[3]) if len(sys.argv) > 3 else 3.0
    cap = int(sys.argv[4]) if len(sys.argv) > 4 else 40

    from brx_mcp.ble import ConnectionManager
    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    mgr = ConnectionManager()
    await mgr.connect(addr, "v")

    async def snd(f, s=0.2):
        await mgr.send("v", f, reply_window_ms=140)
        await asyncio.sleep(s)

    async def arm():
        for fr in B.arming_frames(PID, VICTIM_TEAM, sirs=[B.SIR_PLAIN]):
            await snd(fr)
        await snd(B.AR)
        await snd("$SPAWN,,*", 1.2)
        await snd("$AMMO,0,32,192,1,*")
        await snd("$BMAP,0,0,,,,,*")

    async def headset_native():
        """What is the headset showing WITHOUT us overriding it? Blinking green = stuck DEAD.

        Tony's hypothesis, and the strongest one: the gun reports alive ($LCD,45,70) after a $SPAWN
        while the HEADSET is still in its death state. A dead headset takes no IR, still answers
        $HLED (LED control is a separate path), and only a power cycle clears it. That matches the
        field note of 2026-08-30: dark in play, blinking green after death, stops on respawn.
        """
        await snd("$HLED,,6,,,,,*", 0.4)      # clear OUR colour so the native pattern shows
        await asyncio.sleep(1.2)

    print("=== how many hits before it goes deaf? ===")
    print("   one shot at a time, %.1fs apart, each confirmed on the wire\n" % gap)
    print("   %-6s %-8s %-20s %s" % ("shot", "t+s", "pools", "result"))
    t0 = time.time()
    misses = hits = 0
    try:
        await arm()
        for n in range(1, cap + 1):
            seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            tx.write(("TX " + word(20, 0, ENEMY_TEAM) + "\n").encode())
            tx.flush()
            await asyncio.sleep(gap)
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
            hp = [e for e in evs if e.startswith("$HP")]
            hir = [e for e in evs if e.startswith("$HIR")]
            p = pools(hp[-1]) if hp else None
            if hir:
                misses += 0
                misses = 0
                hits += 1
                print("   %-6d %-8.1f %-20s HIT" % (n, time.time() - t0, str(p)), flush=True)
                if p and (p[0] <= 0 or (p[0] + p[1]) <= 25):
                    await snd("$SPAWN,,*", 1.2)
                    print("        (respawned so a death cannot look like deafness)", flush=True)
            else:
                misses += 1
                print("   %-6d %-8.1f %-20s NO REPORT (%d in a row)"
                      % (n, time.time() - t0, "-", misses), flush=True)
                if misses >= 5:
                    print("\n   >>> WENT DEAF after %d successful hits, %.0f s into the run"
                          % (hits, time.time() - t0), flush=True)
                    break
        else:
            print("\n   >>> survived all %d shots (%d hits) without going deaf" % (cap, hits), flush=True)
    finally:
        # $CLEAR wipes the $SIR table; a gun with no rows ignores every hit (F11). Put it back.
        await snd("$CLEAR,*", 0.2)
        for _sir in B.SIRS:
            await snd(_sir, 0.1)
        try:
            await mgr.disconnect("v")
        except Exception:
            pass
        tx.close()


asyncio.run(main())
