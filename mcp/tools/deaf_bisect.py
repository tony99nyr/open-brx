"""Find the frame that makes a tagger go deaf, by bisecting what we send it.

The evidence this is built on (2026-09-02, all witnessed):
  * R0BQT registered 16/16, then 0/22 in the same rig an hour later, with R0BAT taking hits from the
    same emitter at the same time and R0BQT's headset showing NO flash at all.
  * Alive, spawned, full pools, headset linked, BLE healthy throughout. Not a game-state fault.
  * Between the good run and the bad one, the ONLY frames it received were `$GLED`.

That last line is the lead. It may be wrong -- it is a differential, not a mechanism, and this bench
has an eight-hypothesis graveyard. So the design does not assume it: after a power cycle it fires a
witnessed volley after EVERY stage, and reports the first stage after which registration dies. If
`$GLED` is innocent the table says so just as clearly.

Rules that make the result mean something:
  * A stage is only judged on shots the WITNESS confirms were fired.
  * The baseline volley must pass before anything is sent. If the gun is already deaf, a power cycle
    is required first and the run aborts rather than producing a table of zeros.
  * mag-1 shots: nothing dies, nothing respawns, so "it died" can never be the explanation.

Usage: python deaf_bisect.py <victim_addr> [emitter_com=COM8] [shots_per_stage=5] [receiver_com=COM7]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import witnessed, word
from brx_mcp.irbridge import IRBridge

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40

# The arming ritual, one frame per stage, then the $GLED frames the LED calibration actually sent.
STAGES = (
    [("$VOL", "$VOL,60,0,*"), ("$CLEAR", "$CLEAR,*"), ("$START", "$START,*"),
     ("$GSET", B.GSET), ("$PSET", B.PSET.format(pid=PID)), ("$SIR", B.SIR_PLAIN),
     ("$TID", f"$TID,{VICTIM_TEAM},*"), ("$WEAP", B.AR), ("$SPAWN", "$SPAWN,*")]
    + [("GLED blank", "$GLED,,,,5,,,*"),
       ("GLED white x3", "$GLED,6,6,6,0,10,,*"),
       ("GLED 1-only (9=dark)", "$GLED,6,9,9,0,10,,*"),
       ("GLED 2-only", "$GLED,9,6,9,0,10,,*"),
       ("GLED 3-only", "$GLED,9,9,6,0,10,,*"),
       ("GLED blank again", "$GLED,,,,5,,,*")]
)


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
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    rx._ser.write(b"s\n")
    if not any("frames=" in l for l in rx._readlines(0.6)):
        raise SystemExit("receiver did not answer -- no witness, no experiment")
    for _ in range(2):
        rx._ser.write(b"r\n")
        if any("RAW dump ON" in l for l in rx._readlines(0.5)):
            break

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):

        async def volley():
            hit = fired = 0
            for _ in range(nshot):
                mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
                rx._ser.reset_input_buffer()
                tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                await asyncio.sleep(0.9)
                w = witnessed(rx._readlines(0.4))
                evs = [e.get("raw", "").strip() for e in
                       mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
                got = any(e.startswith("$HIR") for e in evs)
                if w:
                    fired += 1
                    hit += got
                elif got:                 # witness missed it but the gun proves it was fired
                    fired += 1
                    hit += 1
            return hit, fired

        # A baseline that must PASS. Without it a run on an already-deaf gun produces a full table
        # of zeros and every stage looks equally guilty.
        print("baseline (nothing sent yet) ...", flush=True)
        h, f = await volley()
        print(f"   registered {h}/{f} confirmed-fired")
        if f == 0:
            raise SystemExit("ABORT: no shot could be confirmed fired. Fix the aim.")
        if h == 0:
            raise SystemExit("ABORT: the gun is ALREADY deaf before we sent anything.\n"
                             "  Power-cycle it (twice, if that is what it takes) and re-run --\n"
                             "  this test can only find what BREAKS a working gun.")

        print(f"\n   {'stage':22s} {'frame':34s} registered")
        broke = None
        for label, frame in STAGES:
            await mgr.send("v", frame, reply_window_ms=200)
            await asyncio.sleep(0.5)
            h, f = await volley()
            flag = ""
            if h == 0 and f > 0 and broke is None:
                broke = label
                flag = "   <<-- WENT DEAF HERE"
            print(f"   {label:22s} {frame[:34]:34s} {h}/{f}{flag}", flush=True)

        print()
        if broke:
            print(f"   *** registration died immediately after: {broke}")
            print("   Confirm before believing it: power-cycle, then send ONLY that frame and")
            print("   re-test. One run is a lead, not a cause.")
        else:
            print("   Never went deaf. The trigger is NOT in this frame list -- widen it, or the")
            print("   fault is time/thermal/physical rather than something we send.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
