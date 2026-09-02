"""Find the frame that puts a tagger into the DEAF state, by sending suspects one at a time.

The state being hunted (2026-09-02, repro'd several times at a fixed 3 ft):
  * WORKING looks like 16/16, then 24/24 -- and simultaneously 24/24 on a native gun beside it.
  * DEAF looks like 0/22 with NO headset flash at all, at the same distance, unmoved.
That is BIMODAL, not a marginal link degrading smoothly, and it matches Tony's account from the
start: a state it gets into, which a power cycle clears. It has cost a live game.

Ruled out already, by measurement rather than argument: arming order, the $SIR table (interleaved
A/B, 24/24 both arms), spawn state, team gating, death/respawn, battery charge, headset orientation,
our emitter (a native gun beside it registered the same shots), and distance.

METHOD -- and the fix that makes it work at all. The previous version took its baseline on an
UNARMED gun, where `$HIR` never reaches BLE (established tonight: a natively-running gun registers
hits and reports nothing). It would have aborted, or blamed whichever frame happened to precede the
first `$HIR`. So: arm FIRST, prove the gun is at 100%, and only then send suspects one at a time,
re-testing after each. The suspect after which registration collapses is the trigger.

It keeps going after a collapse and then RE-ARMS, because "does re-arming clear it?" is the other
half of the answer -- if it does, the state is soft and we can recover from it in MC; if only a power
cycle clears it, that is a very different and much worse fact.

Usage: python deaf_bisect.py <addr> [emitter_com=COM8] [shots=6] [receiver_com=COM7]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import witnessed, word
from brx_mcp.irbridge import IRBridge

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40

# Suspects, sent one at a time to an ARMED, VERIFIED-WORKING gun. The $GLED frames lead because they
# are what the LED calibration sent between a 16/16 run and a 0/22 run -- a differential, not a
# mechanism, and the A/B on $SIR already showed how fast a differential like that can die.
SUSPECTS = [
    ("GLED blank (t4=5)",   "$GLED,,,,5,,,*"),
    ("GLED white x3",       "$GLED,6,6,6,0,10,,*"),
    ("GLED 1-only, 9=dark", "$GLED,6,9,9,0,10,,*"),
    ("GLED 2-only",         "$GLED,9,6,9,0,10,,*"),
    ("GLED 3-only",         "$GLED,9,9,6,0,10,,*"),
    ("GLED blank again",    "$GLED,,,,5,,,*"),
    ("HLED green solid",    "$HLED,3,0,,,10,,*"),
    ("HLED off",            "$HLED,,6,,,,,*"),
    ("re-send $TID",        f"$TID,{VICTIM_TEAM},*"),
    ("re-send $WEAP",       B.AR),
    ("re-send $SPAWN",      "$SPAWN,*"),
    ("$STOP",               "$STOP,*"),
]


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
    rx._ser.write(b"s\n")
    rx._readlines(0.5)
    for _ in range(2):
        rx._ser.write(b"r\n")
        if any("RAW dump ON" in l for l in rx._readlines(0.5)):
            break

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):

        async def arm():
            for fr in B.arming_frames(PID, VICTIM_TEAM):
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
                await asyncio.sleep(0.3)
            return hit, fired

        await arm()
        h, f = await volley()
        print(f"baseline after arming: {h}/{f}", flush=True)
        if f == 0:
            raise SystemExit("ABORT: nothing could be confirmed fired. Fix the aim.")
        if h < f * 0.8:
            raise SystemExit(
                f"ABORT: the gun is ALREADY degraded ({h}/{f}) before any suspect was sent.\n"
                "  This test can only find what BREAKS a working gun. Power-cycle it (twice if that\n"
                "  is what it takes), re-arm, and re-run once the baseline is clean.")

        print(f"\n   {'suspect':22s} {'frame':30s} rate")
        broke = None
        for label, frame in SUSPECTS:
            await mgr.send("v", frame, reply_window_ms=200)
            await asyncio.sleep(0.6)
            h, f = await volley()
            flag = ""
            if f and h < f * 0.5 and broke is None:
                broke = label
                flag = "   <<-- COLLAPSED HERE"
            print(f"   {label:22s} {frame[:30]:30s} {h}/{f}{flag}", flush=True)

        print()
        if broke:
            print(f"   *** registration collapsed right after: {broke}")
            print("   Now testing whether RE-ARMING clears it ...", flush=True)
            await arm()
            h, f = await volley()
            print(f"   after re-arm: {h}/{f}")
            if f and h >= f * 0.8:
                print("   -> re-arming RECOVERS it. The state is soft; MC could detect and clear it.")
            else:
                print("   -> re-arming does NOT recover it. Only a power cycle does, which means a")
                print("      player in a live match stays out until they reboot the gun. That is the")
                print("      severe version of this bug.")
            print("\n   ONE RUN IS A LEAD, NOT A CAUSE. Power-cycle, then send ONLY that frame to a")
            print("   verified-working gun and re-test. Today has already killed four confident")
            print("   explanations that looked at least this good.")
        else:
            print("   Never collapsed. The trigger is NOT in this list -- so it is not something we")
            print("   send, or not something we send ONCE. Next: soak it (repeat volleys for many")
            print("   minutes) and watch for the state to appear on its own.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
