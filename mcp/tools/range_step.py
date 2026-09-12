"""One rung of the range ladder: N witnessed shots at a stated distance, rate reported.

Purpose. This tagger's hit rate swung between ~40% and 100% three times on 2026-09-02 with the
geometry nominally unchanged, and no config variable survived as an explanation (arming, $SIR, spawn
state, team gating, death/respawn, battery were each tested and eliminated). That is the signature of
a link at the EDGE OF ITS MARGIN, not of a faulty tagger.

Waiting for the bad state to reappear is not an experiment. Distance CREATES it on demand. Run this
rung by rung, with a NATIVE gun's headset sat beside the instrumented one so the operator can count
its flashes on the very same shots:

    both fall off together  -> our emitter's margin. The tagger is exonerated, and the fix is
                               emitter power (R2) / beam divergence (Q16), which are already open.
    one falls off first     -> a real per-unit difference, produced under control instead of caught
                               by luck, and now measurable as a range rather than argued about.

Nothing about the gun is changed between rungs -- it is armed once per rung, identically.

Usage: python range_step.py <addr> <label> [emitter_com=COM8] [shots=10] [receiver_com=COM7]
       label is free text, e.g. "3ft" -- it only labels the output.
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from bench_common import SENSOR, witnessed, word
from brx_mcp.irbridge import IRBridge

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40


async def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    addr, label = sys.argv[1], sys.argv[2]
    com = sys.argv[3] if len(sys.argv) > 3 else "COM8"
    nshot = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    recv_com = sys.argv[5] if len(sys.argv) > 5 else "COM7"

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):
        for fr in B.arming_frames(PID, VICTIM_TEAM):
            await mgr.send("v", fr, reply_window_ms=140)
            await asyncio.sleep(0.12)
        await mgr.send("v", B.AR, reply_window_ms=140)
        await asyncio.sleep(0.15)
        mark0 = mgr.get_events("v", since_seq=0).get("last_seq", 0)
        await mgr.send("v", "$SPAWN,*", reply_window_ms=300)
        await asyncio.sleep(1.5)
        # Read the pools before scoring a single miss. A DEAD gun and a deaf gun are identical
        # through $HIR (pre-flight rule 3, docs/archive/bench-2026-09-03.md; now gotchas.md pre-flight step 4); the $SPAWN echo is an $LCD line
        # carrying the live pools, so a rung that starts on $LCD,0,0 must not be scored at all.
        lcds = [e.get("raw", "").strip() for e in
                mgr.get_events("v", since_seq=mark0).get("events", [])
                if isinstance(e, dict) and e.get("raw", "").startswith("$LCD")]
        alive = B.is_alive(lcds[-1] if lcds else "")
        if alive is False:
            raise SystemExit(f"ABORT: gun reads DEAD after $SPAWN ({lcds[-1]}) -- every miss below "
                             "would be a corpse scored as deafness. Power-cycle and re-arm.")
        print(f"   pools after spawn: {lcds[-1] if lcds else 'NO $LCD echo -- alive state UNKNOWN'}",
              flush=True)
        print(f"\n=== RUNG: {label} === {nshot} shots. Count the NATIVE headset's flashes.\n",
              flush=True)

        hit = fired = heard = 0
        domes = []
        for i in range(nshot):
            mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            rx._ser.reset_input_buffer()
            tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
            tx.flush()
            await asyncio.sleep(1.0)
            w = witnessed(rx._readlines(0.4))
            heard += w
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
            h = [e for e in evs if e.startswith("$HIR")]
            if w or h:
                fired += 1
                hit += bool(h)
            if h:
                try:
                    domes.append(SENSOR.get(int(h[-1].split(",")[1]), "?"))
                except Exception:
                    pass
            print(f"   shot {i+1:2d}  {'HIT' if h else ' --'}   witness={'OK ' if w else 'silent'}",
                  flush=True)
            await asyncio.sleep(0.6)

    pct = 100.0 * hit / fired if fired else 0.0
    print(f"\n   {label}:  registered {hit}/{fired} confirmed-fired  = {pct:.0f}%"
          f"   (witness heard {heard}/{nshot})")
    print(f"   sensors hit: {sorted(set(domes)) or 'none'}")
    print("   >>> now tell me how many flashes the NATIVE headset showed, out of "
          f"{nshot}. If it tracks this number, the emitter's margin is the whole story.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
