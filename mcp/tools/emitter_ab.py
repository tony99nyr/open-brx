"""OUR emitter vs a REAL GUN, same target, same minute. The only comparison that settles it.

Tonight has twice produced a confident verdict about our emitter that a control then killed: first
"it stalls mid-frame" (killed by firing a real gun at the receiver), then "it is clean, 20/20". Both
were single-instrument readings. This is the two-instrument version: the same headset, in the same
position, shot by our ESP32 and then by a real BRX gun, minutes apart, scored by the same `$HIR`
stream over BLE.

  ours hits, gun hits      -> the rig is fine; look elsewhere for whatever blocked the run
  ours misses, gun hits    -> it is OUR emitter, wherever it sits and whether or not it moved
  ours misses, gun misses  -> the tagger or its config; the emitter is exonerated
  ours hits, gun misses    -> you missed, or the gun is out of ammo. Re-fire.

The gun must already be armed and in OUR game state, or `$HIR` will not reach BLE at all -- so this
arms it first through MC's own path.

Usage: python emitter_ab.py <addr> [emitter_com=COM8] [shots=5]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import SENSOR, witnessed, word
from brx_mcp.irbridge import IRBridge
from brx_mcp.gameconfig import GameConfig

VICTIM_TEAM, ENEMY_TEAM, WIRE_ID = 1, 2, 0


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    nshot = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    recv_com = sys.argv[4] if len(sys.argv) > 4 else "COM7"

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    # The WITNESS, on both halves. Without it a zero cannot be told apart from "nothing was ever
    # fired" -- and it hears the real gun just as well as it hears ours, so BOTH arms get an
    # independent confirmation that light actually left something.
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):
        cfg = GameConfig()
        for f in list(cfg.setup_frames(WIRE_ID)) + [f"$TID,{VICTIM_TEAM},*"]:
            await mgr.send("v", f, reply_window_ms=0)
        for f in cfg.spawn_frames():
            await mgr.send("v", f, reply_window_ms=0)
        await mgr.send("v", "$VOL,30,0,*", reply_window_ms=0)
        await asyncio.sleep(2.5)

        async def count(window_s, tag):
            mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            rx._ser.reset_input_buffer()
            seen = 0
            end = time.time() + window_s
            while time.time() < end:
                await asyncio.sleep(0.3)
                if witnessed(rx._readlines(0.05)):
                    seen += 1
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
            hirs = [e for e in evs if e.startswith("$HIR")]
            sens = []
            for h in hirs:
                try:
                    sens.append(SENSOR.get(int(h.split(",")[1]), "?"))
                except Exception:
                    pass
            print(f"   {tag:32s} {len(hirs)} hit(s)   witness saw {seen} burst(s)   "
                  f"{sorted(set(sens))}", flush=True)
            return len(hirs), seen

        print(f"\n   >>> A: OUR emitter, {nshot} shots", flush=True)

        async def ours():
            for _ in range(nshot):
                tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                await asyncio.sleep(1.0)

        task = asyncio.ensure_future(ours())
        a, a_wit = await count(nshot + 2.0, "A: our emitter")
        await task

        print(f"\n   >>> B: FIRE THE REAL GUN AT THE HEADSET NOW -- {nshot} shots, you have 20 s",
              flush=True)
        b, b_wit = await count(20.0, "B: real gun")

        print("\n=== VERDICT ===")
        if not a_wit and not b_wit:
            print("   NOTHING WAS WITNESSED IN EITHER HALF. No light reached the receiver at all,")
            print("   so nothing here is interpretable -- this is not evidence about the tagger.")
        elif not b_wit:
            print("   The real gun was never witnessed: it did not fire into the beam path, so")
            print("   half B is void. Re-run and fire at the headset within the 20 s window.")
        elif not a_wit:
            print("   OUR EMITTER EMITTED NOTHING the receiver could see -- that is an emitter or")
            print("   wiring fault, not a tagger fault.")
        elif a and b:
            print("   Both landed. The rig is fine -- whatever blocked the run is elsewhere.")
        elif not a and b:
            print("   OUR EMITTER is the problem: the same headset, in the same position, took the")
            print("   real gun's shots and none of ours. That holds whether or not the board moved.")
        elif a and not b:
            print("   Ours landed and the real gun did not -- most likely a miss or no ammo. Re-fire")
            print("   before reading anything into this.")
        else:
            print("   NEITHER landed. The emitter is exonerated; the tagger or its config is the")
            print("   problem. Do not blame the boards.")
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
