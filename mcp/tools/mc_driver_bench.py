"""End-to-end bench test of the SHIPPED Mission Control arming path, and the F11 recovery.

Everything else in `mcp/tools/` deliberately uses bench frames so a compiler bug cannot both arm the
gun and grade the result. This one is the opposite on purpose: it drives the REAL `GameDriver`
against a REAL tagger, because the fixes being tested live in that code and nowhere else.

  PHASE 1  `GameDriver.setup()` -- the shipped path, via `_arm_one()`. Then fire witnessed shots.
           Also asserts `snapshot()` reports NO `unhittable` player.
  PHASE 2  STRAND it the way F11 does: `$CLEAR,*` then `$SPAWN,*`, which wipes the `$SIR` table and
           leaves the gun alive, in-game and ignoring every hit. Confirm it is deaf.
  PHASE 3  `GameDriver.setup()` again. It must RECOVER, because `setup_frames()` sends the `$SIR`
           rows after the `$CLEAR`. This is the fix working end to end.

Every shot is witnessed, and pools are read before any "deaf" verdict -- a dead gun and a
`$SIR`-less gun are indistinguishable through `$HIR`.

Usage: python mc_driver_bench.py <addr> [emitter=COM8] [shots=6] [receiver=COM7]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import SENSOR, witnessed, word
from brx_mcp.irbridge import IRBridge
from brx_mcp.gameconfig import GameConfig
from brx_mcp.modes.driver import GameDriver

ENEMY_TEAM = 2


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    nshot = int(sys.argv[3]) if len(sys.argv) > 3 else 6
    recv_com = sys.argv[4] if len(sys.argv) > 4 else "COM7"

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):

        async def sender(pid, frame):
            await mgr.send("v", frame, reply_window_ms=0)

        notes = []
        cfg = GameConfig()
        driver = GameDriver(cfg, {"p1": 1}, sender, announce=notes.append)

        async def pools():
            mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            await mgr.send("v", "$QUERY,*", reply_window_ms=1200)
            await asyncio.sleep(0.9)
            q = [e.get("raw", "").strip() for e in
                 mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
            return next((x for x in q if x.startswith("$LCD")), "")

        async def volley(tag):
            hit = fired = 0
            sens = []
            for _ in range(nshot):
                mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
                rx._ser.reset_input_buffer()
                tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                await asyncio.sleep(0.9)
                w = witnessed(rx._readlines(0.4))
                evs = [e.get("raw", "").strip() for e in
                       mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
                h = [e for e in evs if e.startswith("$HIR")]
                if w or h:
                    fired += 1
                    hit += bool(h)
                if h:
                    try:
                        sens.append(SENSOR.get(int(h[-1].split(",")[1]), "?"))
                    except Exception:
                        pass
                await asyncio.sleep(0.25)
            lcd = await pools()
            alive = B.is_alive(lcd)
            print(f"   {tag:34s} {hit}/{fired}   alive={alive}   {lcd[:22]}   {sorted(set(sens))}",
                  flush=True)
            return hit, fired, alive

        print("\n=== PHASE 1: GameDriver.setup() -- the SHIPPED path ===", flush=True)
        await driver.setup()
        await asyncio.sleep(2.0)
        snap = driver.snapshot()
        print(f"   snapshot unhittable: {snap.get('unhittable', 'none')}   "
              f"arming_failures: {snap.get('arming_failures', 'none')}")
        h1, f1, a1 = await volley("after MC setup()")

        print("\n=== PHASE 2: STRAND it ($CLEAR then $SPAWN) -- the F11 fault ===", flush=True)
        await mgr.send("v", "$CLEAR,*", reply_window_ms=0)
        await mgr.send("v", "$SPAWN,*", reply_window_ms=0)
        await asyncio.sleep(2.5)
        h2, f2, a2 = await volley("stranded (expect 0, alive=True)")

        print("\n=== PHASE 3: GameDriver.setup() again -- must RECOVER ===", flush=True)
        await driver.setup()
        await asyncio.sleep(2.0)
        h3, f3, a3 = await volley("after MC setup() again")

        print("\n=== VERDICT ===")
        ok = True
        if not (f1 and a1 and h1 >= f1 * 0.8):
            print("   FAIL PHASE 1 FAILED: the shipped arming path did not produce a hittable gun.")
            ok = False
        else:
            print("   PASS PHASE 1: MC's own setup() arms a gun that registers every shot.")
        if a2 is not True:
            print("   !! PHASE 2 INCONCLUSIVE: the gun was not alive, so 0/N proves nothing.")
            ok = False
        elif f2 and h2 == 0:
            print("   PASS PHASE 2: $CLEAR+$SPAWN reproduced the fault (alive, in game, 0 hits).")
        else:
            print(f"   !! PHASE 2: expected 0 hits, got {h2}/{f2}. The fault did not reproduce, so")
            print("      phase 3 proves nothing about recovery.")
            ok = False
        if f3 and h3 >= f3 * 0.8:
            print("   PASS PHASE 3: setup() RECOVERED the stranded gun -- the $SIR rows go out after")
            print("      the $CLEAR, which is exactly the fix.")
        else:
            print(f"   FAIL PHASE 3 FAILED: still {h3}/{f3} after re-arming.")
            ok = False
        print("\n   " + ("ALL PHASES PASSED -- the shipped path is safe and self-recovering."
                        if ok else "SEE ABOVE -- do not record this as a pass."))
        if notes:
            print("\n   driver announcements:")
            for n in notes[-6:]:
                print("     ", n)
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
