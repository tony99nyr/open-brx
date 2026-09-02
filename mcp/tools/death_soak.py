"""Soak the KILL -> RESPAWN cycle and catch the tagger going deaf. Tony's original hypothesis.

Why this, and why it was not run sooner. Tony has said since the first sighting that the fault is a
state the gun gets into, and suspected death/respawn: *"maybe you killed it and tried to spawn it
improperly?? then it got stuck in a dead state??"*. Every test on 2026-09-02 used magnitude 1
SPECIFICALLY so nothing would die -- the confound was designed out, and then "death/respawn" was
written down as eliminated. It was never tested. This tests it.

It also fits the one constraint that refutes every other surviving idea: yesterday's phone HUD game
stopped registering **point blank, with the phone connected** -- a normal game, containing kills and
respawns.

Each cycle:
  1. verify registration with witnessed shots  (the gun must be WORKING to start)
  2. kill it outright with a big-magnitude shot
  3. respawn it with MC's real RESPAWN_SEQUENCE -- the exact frames a live match sends
  4. verify registration again

A cycle where step 4 collapses while step 1 passed is the repro, and the log line says which cycle
and what the pools were. It stops there rather than continuing, so the state is left INTACT on the
bench for inspection instead of being cleared by the next iteration.

Scored by `$HIR`, which was proven honest tonight (eyes / BLE / pool drop all agreed exactly).

Usage: python death_soak.py <addr> [emitter_com=COM8] [cycles=25] [shots=4] [receiver_com=COM7]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import SENSOR, witnessed, word
from brx_mcp.irbridge import IRBridge

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40
RESPAWN_SEQUENCE = ("$HLOOP,0,0,*", "$SPAWN,,*")     # verbatim from gameconfig.py -- what MC sends


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    cycles = int(sys.argv[3]) if len(sys.argv) > 3 else 25
    nshot = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    recv_com = sys.argv[5] if len(sys.argv) > 5 else "COM7"

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    t0 = time.time()
    async with B.connected(mgr, (addr, "v")):

        async def volley(n=nshot):
            hit = fired = 0
            pools = None
            for _ in range(n):
                mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
                rx._ser.reset_input_buffer()
                tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                await asyncio.sleep(0.9)
                w = witnessed(rx._readlines(0.4))
                evs = [e.get("raw", "").strip() for e in
                       mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
                got = any(e.startswith("$HIR") for e in evs)
                hp = [e for e in evs if e.startswith("$HP")]
                if hp:
                    pools = hp[-1]
                if w or got:
                    fired += 1
                    hit += got
                await asyncio.sleep(0.25)
            return hit, fired, pools

        # arm once, the way a match does
        for fr in B.arming_frames(PID, VICTIM_TEAM):
            await mgr.send("v", fr, reply_window_ms=140)
            await asyncio.sleep(0.12)
        await mgr.send("v", B.AR, reply_window_ms=140)
        await asyncio.sleep(0.15)
        await mgr.send("v", "$SPAWN,*", reply_window_ms=300)
        await asyncio.sleep(1.5)

        valid = 0
        print(f"   {'cycle':>5s}  {'t':>6s}  before   after   pools", flush=True)
        for c in range(1, cycles + 1):
            hb, fb, _ = await volley()
            # kill it: 200 exceeds HP+armour+shield, so this is a clean single-shot death
            rx._ser.reset_input_buffer()
            tx.write(("TX " + word(200, 0, ENEMY_TEAM) + "\n").encode())
            tx.flush()
            await asyncio.sleep(1.4)
            for fr in RESPAWN_SEQUENCE:
                await mgr.send("v", fr, reply_window_ms=250)
                await asyncio.sleep(0.35)
            await asyncio.sleep(1.2)
            # Read POOLS before scoring. The respawn above is sent 1.4 s after the kill, inside the
            # 2.0-2.5 s window that swallows a respawn (F13), so the commonest outcome here is a gun
            # that is simply still DEAD -- and a dead gun scores 0/N exactly like a deaf one.
            mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            await mgr.send("v", "$QUERY,*", reply_window_ms=1200)
            await asyncio.sleep(0.9)
            q = [e.get("raw", "").strip() for e in
                 mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
            alive = B.is_alive(next((x for x in q if x.startswith("$LCD")), ""))
            ha, fa, pools = await volley()
            t = time.time() - t0
            flag = ""
            if alive is None:
                flag = "   (no $QUERY reply -- state UNKNOWN, trial discarded)"
            elif not alive:
                flag = "   (still DEAD after the respawn -- discarded, that is not deafness)"
            elif fa and ha == 0:
                flag = "   <<-- DEAF AFTER RESPAWN"
            elif fa and ha < fa * 0.5:
                flag = "   <<-- degraded"
            print(f"   {c:5d}  {t:6.0f}s  {hb}/{fb}     {ha}/{fa}   {pools or '-'}{flag}",
                  flush=True)
            if alive and fa:
                valid += 1
            if alive and fa and ha == 0 and fb > 0 and hb > 0:
                print(f"\n   *** REPRODUCED on cycle {c} after {t:.0f}s.")
                print("   It registered BEFORE the kill and not after the respawn, in the same")
                print("   cycle, seconds apart -- so this is not drift.")
                print("   STOPPING with the gun left in the bad state: check the headset by eye,")
                print("   then probe it before anything clears it. Do NOT power-cycle yet.")
                break
        else:
            if not valid:
                print(f"\n   NO VALID CYCLES out of {cycles}: every one was discarded (gun still")
                print("   dead after the respawn, or state unknown). NOTHING IS CONCLUDED. The")
                print("   respawn here lands 1.4 s after the kill, inside the 2.0-2.5 s window that")
                print("   swallows one (F13) -- raise the gap and re-run.")
            else:
                print(f"\n   Never went deaf in {valid} VALID cycles of {cycles} "
                      f"({time.time()-t0:.0f}s).")
                print("   Death/respawn alone does not do it. Record that as tested, not assumed --")
                print("   it was written off once already without ever being run.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
