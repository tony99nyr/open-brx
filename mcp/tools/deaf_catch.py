"""F11 caught in the act: WHAT does a deaf tagger need before it registers again?

GAMMA registered 16/16 earlier on 2026-09-02 and then stopped, in the same rig, with nothing
reconfigured in between. That is the F11 state Tony has described since the start -- "it maybe is a
bad state it gets in". Every previous attempt to explain it compared measurements taken at different
times, and produced eight retracted hypotheses.

This tool does the one thing none of those did: it PRESERVES the bad state and escalates out of it in
the smallest steps possible, with a validated witness on every shot, so the step that revives the gun
is the answer.

  PHASE A  connect, send NOTHING.        <- the bad state, untouched. Does it register?
  PHASE B  $SPAWN only.                  <- was it merely un-spawned / dead?
  PHASE C  full arm + spawn.             <- the full ritual, the thing that "fixes" it by hand

The 2x2 that matters is witness x tagger, per shot:
  witness heard, tagger silent  -> genuinely deaf. The fault is real and it is in the tagger.
  witness silent, tagger silent -> nothing was fired at it. Aim, not deafness. NOT a data point.
  witness silent, tagger hit    -> the witness false-negatived; the shot still counts.

Order matters: arming FIRST would destroy the evidence, which is why this escalates instead.

Usage: python deaf_catch.py <victim_addr> [emitter_com=COM8] [shots_per_phase=8] [receiver_com=COM7]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import SENSOR, witnessed, word
from brx_mcp.irbridge import IRBridge

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    nshot = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    recv_com = sys.argv[4] if len(sys.argv) > 4 else "COM7"

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    results = {}
    async with B.connected(mgr, (addr, "v")):

        async def volley(tag):
            hits, wit, rows = 0, 0, []
            for i in range(nshot):
                mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
                rx._ser.reset_input_buffer()
                tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                await asyncio.sleep(1.0)
                w = witnessed(rx._readlines(0.45))
                evs = [e.get("raw", "").strip() for e in
                       mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
                hir = [e for e in evs if e.startswith("$HIR")]
                wit += w
                if hir:
                    hits += 1
                    try:
                        sen = SENSOR.get(int(hir[-1].split(",")[1]), "?")
                    except Exception:
                        sen = "?"
                    got = f"HIT({sen})"
                else:
                    got = "  --  "
                rows.append((w, bool(hir)))
                other = [e for e in evs if not e.startswith("$HIR")]
                print(f"     shot {i+1}: {got}   witness={'OK ' if w else 'silent'}"
                      + (f"   other frames: {other[:2]}" if other else ""), flush=True)
            # only shots we KNOW were fired count against the tagger
            real = [r for r in rows if r[0]]
            deaf = sum(1 for w, h in real if not h)
            print(f"   -> {tag}: registered {hits}/{nshot}   witnessed {wit}/{nshot}   "
                  f"DEAF on {deaf}/{len(real)} confirmed-fired shots", flush=True)
            results[tag] = (hits, wit, deaf, len(real))

        print("\n=== PHASE A -- bad state PRESERVED, nothing sent to the gun ===")
        print("    !! PHASE A CANNOT DETECT A HIT. If the gun is not already in OUR game state,")
        print("       `$HIR` never reaches BLE and this phase reads 0/N on a healthy gun.", flush=True)
        await volley("A: untouched")

        print("\n=== PHASE B -- $SPAWN only ===")
        print("    !! SAME CAVEAT AS PHASE A: a zero here is not evidence of anything.", flush=True)
        await mgr.send("v", "$SPAWN,*", reply_window_ms=300)
        await asyncio.sleep(1.2)
        await volley("B: spawn only")

        print("\n=== PHASE C -- full arm + spawn ===", flush=True)
        for fr in B.arming_frames(PID, VICTIM_TEAM, sirs=[B.SIR_PLAIN]):
            await mgr.send("v", fr, reply_window_ms=140)
            await asyncio.sleep(0.12)
        await mgr.send("v", B.AR, reply_window_ms=140)
        await asyncio.sleep(0.15)
        await mgr.send("v", "$SPAWN,*", reply_window_ms=300)
        await asyncio.sleep(1.2)
        await volley("C: full arm")

    print("\n=== WHICH STEP REVIVED IT ===")
    for tag, (hits, wit, deaf, real) in results.items():
        print(f"   {tag:16s} registered {hits}/{nshot}  (deaf on {deaf}/{real} confirmed-fired)")
    print("\n   !! PHASES A AND B ARE BLE-BLIND -- treat their numbers as UNKNOWN, not as zero.")
    print("   Only phase C, which puts the gun in our game state, can detect a hit at all.")
    print("   A already good      -> it is NOT deaf now; the fault had already cleared.")
    print("   A deaf, B good      -> UNRELIABLE (both are BLE-blind); confirm with phase C.")
    print("   B deaf, C good      -> something in the arming set is required; bisect the frames next.")
    print("   C still deaf        -> not a config state at all. Look at the headset link / hardware.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
