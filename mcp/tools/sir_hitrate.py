"""Does the size of the `$SIR` table change how many shots REGISTER? Interleaved A/B.

The differential this chases (2026-09-02): the same tagger, same 3 ft, same geometry, unmoved --
  native game, nothing from us .............. hit EVERY time (operator-observed)
  our arming with the FULL 10-row $SIR table . 16/16
  our arming with ONE $SIR row ............... 3/10, then 4/10
The one-row table was a simplification I made in two later tools. It is the only difference in the
arming between the 100% run and the 40% runs, and it tracks the numbers exactly. That is a
correlation across three runs, not a result -- hence this.

Design, so the answer survives:
  * INTERLEAVED, A B A B A B. This bench has spent two sessions learning that anything compared
    across time on a drifting rig is worthless; alternating is the closest thing to simultaneous
    that one emitter and one victim allow.
  * Both arms re-arm from scratch every round, so a round measures the TABLE, not the history.
  * Every shot is witnessed; unwitnessed shots are excluded, never counted as misses.
  * mag 1, so nothing dies and no respawn can confound a round.
  * The per-round numbers are printed, not just the totals: if the two arms drift together over the
    session, that is a time effect masquerading as a table effect and the rounds will show it.

Usage: python sir_hitrate.py <addr> [emitter_com=COM8] [shots_per_arm=8] [rounds=3] [receiver_com=COM7]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import witnessed, word
from brx_mcp.irbridge import IRBridge

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40
ARMS = [("FULL 10-row $SIR", None), ("ONE $SIR row", [B.SIR_PLAIN])]


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    nshot = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    rounds = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    recv_com = sys.argv[5] if len(sys.argv) > 5 else "COM7"

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    tally = {name: [0, 0] for name, _ in ARMS}
    async with B.connected(mgr, (addr, "v")):

        async def arm(sirs):
            for fr in B.arming_frames(PID, VICTIM_TEAM, sirs=sirs):
                await mgr.send("v", fr, reply_window_ms=140)
                await asyncio.sleep(0.12)
            await mgr.send("v", B.AR, reply_window_ms=140)
            await asyncio.sleep(0.15)
            await mgr.send("v", "$SPAWN,*", reply_window_ms=300)
            await asyncio.sleep(1.5)

        async def volley():
            hit = fired = 0
            for _ in range(nshot):
                mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
                rx._ser.reset_input_buffer()
                tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                await asyncio.sleep(1.0)
                w = witnessed(rx._readlines(0.4))
                evs = [e.get("raw", "").strip() for e in
                       mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
                got = any(e.startswith("$HIR") for e in evs)
                if w or got:
                    fired += 1
                    hit += got
                await asyncio.sleep(0.4)
            return hit, fired

        print(f"interleaved A/B, {rounds} rounds x {nshot} shots per arm\n", flush=True)
        for r in range(1, rounds + 1):
            for name, sirs in ARMS:
                await arm(sirs)
                h, f = await volley()
                tally[name][0] += h
                tally[name][1] += f
                print(f"   round {r}  {name:18s}  {h}/{f}", flush=True)

    print("\n=== TOTALS (confirmed-fired shots only) ===")
    for name, _ in ARMS:
        h, f = tally[name]
        pct = 100.0 * h / f if f else 0.0
        print(f"   {name:18s}  {h}/{f}   {pct:.0f}%")
    a, b = tally[ARMS[0][0]], tally[ARMS[1][0]]
    if not a[1] or not b[1]:
        print("\n   ABORT: an arm has ZERO confirmed-fired shots, so there is nothing to compare.")
        print("   Fix the aim/rig and re-run. A verdict from no observations is how this bench")
        print("   produced several confident wrong answers on 2026-09-02.")
        rx.close(); tx.close(); return
    ra = a[0] / a[1] if a[1] else 0
    rb = b[0] / b[1] if b[1] else 0
    print()
    if abs(ra - rb) < 0.15:
        print("   The table makes NO clear difference. The 16/16-vs-4/10 gap is something else --")
        print("   do not keep blaming $SIR. Look for what ELSE differed between those runs.")
    elif ra > rb:
        print("   The FULL table registers more. That is our arming degrading hit detection, i.e.")
        print("   OUR bug -- and it would silently cost hits in a real match. Bisect the 10 rows next.")
    else:
        print("   The ONE-row table registers more, which is the opposite of the hypothesis. Record")
        print("   it and re-think; do not quietly drop the result because it is inconvenient.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
