"""`$CLEAR` immediately followed by `$SPAWN` leaves the GUN in game and the HEADSET dark and deaf.

Captured 2026-09-02 by `desync_fuzz.py` on its first trial, and confirmed by eye: gun `$LCD,45,70`
(alive, in game), headset DARK, 0/3 witnessed shots registered. That is the F11 state Tony has
described since the first sighting -- "acting like death state but dark leds" -- reproduced on demand
from two frames.

Mechanism, consistent with everything measured tonight: the gun QUEUES commands and executes them
serially (four bolt-pulls drained from one burst), and a command arriving while the headset is still
executing a previous state change is LOST rather than deferred (proven separately: a respawn within
2.0 s of death is swallowed; 2.5 s is clean). `$CLEAR` starts the headset's transition to its
inactive/config state; `$SPAWN` lands ~10 ms later, mid-transition, and never reaches it. The GUN
enters the game. The HEADSET never does.

⚠️ This is the shape MC ships: `setup_frames()` begins `$VOL, $CLEAR, $START, ...` and `driver.py`
sends the whole bundle with NO sleep between frames.

This runs the pair N times from a re-verified good baseline each trial. Determinism is the question:
N/N is a cause, 1/N is a coincidence, and the run says which.

Usage: python clear_spawn_repro.py <addr> [emitter=COM8] [trials=5] [receiver=COM7] [gap=0.0]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import witnessed, word
from brx_mcp.irbridge import IRBridge

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    trials = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    recv_com = sys.argv[4] if len(sys.argv) > 4 else "COM7"
    gap = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):

        async def lcd():
            mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            await mgr.send("v", "$QUERY,*", reply_window_ms=1200)
            await asyncio.sleep(0.9)
            q = [e.get("raw", "").strip() for e in
                 mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
            return next((x for x in q if x.startswith("$LCD")), "")

        async def volley(n):
            hit = fired = 0
            for _ in range(n):
                mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
                rx._ser.reset_input_buffer()
                tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                await asyncio.sleep(0.85)
                w = witnessed(rx._readlines(0.35))
                evs = [e.get("raw", "").strip() for e in
                       mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
                h = [e for e in evs if e.startswith("$HIR")]
                if w or h:
                    fired += 1
                    hit += bool(h)
                await asyncio.sleep(0.2)
            return hit, fired

        async def known_good():
            for fr in B.arming_frames(PID, VICTIM_TEAM):
                await mgr.send("v", fr, reply_window_ms=140)
                await asyncio.sleep(0.15)
            await mgr.send("v", B.AR, reply_window_ms=140)
            await asyncio.sleep(0.2)
            await mgr.send("v", "$SPAWN,*", reply_window_ms=300)
            await asyncio.sleep(3.0)

        hits = 0
        valid = 0
        print(f"   $CLEAR -> (gap {gap:.2f}s) -> $SPAWN,  {trials} trials\n")
        print(f"   {'trial':>5s}  {'baseline':>8s}  pools            after")
        for t in range(1, trials + 1):
            await known_good()
            hb, fb = await volley(2)
            if fb and hb == 0:
                print(f"   {t:5d}  {hb}/{fb} SKIP  baseline not clean", flush=True)
                continue
            await mgr.send("v", "$CLEAR,*", reply_window_ms=0)
            if gap:
                await asyncio.sleep(gap)
            await mgr.send("v", "$SPAWN,*", reply_window_ms=0)
            await asyncio.sleep(2.5)
            pools = await lcd()
            alive = bool(pools) and not pools.startswith("$LCD,0,0")
            h, f = await volley(3)
            if not alive:
                print(f"   {t:5d}  {hb}/{fb}      {pools[:16]:16s} {h}/{f}  (dead - discarded)",
                      flush=True)
                continue
            valid += 1
            got = f and h == 0
            hits += got
            print(f"   {t:5d}  {hb}/{fb}      {pools[:16]:16s} {h}/{f}"
                  f"{'   <<-- DEAF (alive, in game)' if got else ''}", flush=True)

        print(f"\n   reproduced {hits}/{valid} valid trials")
        if not valid:
            print("   NO VALID TRIALS -- every one was discarded (gun dead, or baseline unclean).")
            print("   Nothing is concluded. Do not read the absence of a repro as a negative result.")
            rx.close(); tx.close(); return
        if valid and hits == valid:
            print("   DETERMINISTIC. $CLEAR immediately followed by $SPAWN reliably strands the")
            print("   headset outside the game while the gun is in it. This is OUR bug: MC's")
            print("   setup_frames() starts $VOL,$CLEAR,$START,... and driver.py sends the bundle")
            print("   with no gap at all.")
        elif hits:
            print("   INTERMITTENT -- which matches how this fault has always behaved in the field.")
        else:
            print("   Did NOT reproduce. The single capture was a coincidence; say so and keep the")
            print("   fuzzer running over the rest of the grid.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
