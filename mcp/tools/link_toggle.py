"""Does the BLE LINK STATE decide whether the tagger registers hits? Repeated, both directions.

Written after six single-run explanations for this fault died to a control on 2026-09-02 (emitter
stall, $GLED, native-mode deafness, geometry, the $SIR table, $STOP). The fault is intermittent, so
one observation is worth nothing here, and the only thing that will settle anything is a repeated
A/B in both directions.

The lead: Tony saw the gun deaf, this tool's predecessor connected, and its first volley -- before
sending a single frame -- read 6/6, after which he saw it recover. But a previous run stayed deaf for
22 shots WHILE connected. So the lead is already contradicted by data we hold. That is why this
repeats instead of concluding.

Each round:
    CONNECTED    volley, scored by $HIR over BLE
    DISCONNECTED volley, scored by the OPERATOR counting headset flashes -- BLE cannot score this
                 half, because a gun outside our game state reports nothing (established tonight)
Shots while disconnected are spaced widely and announced with a countdown so they can be counted.

Read it as: deaf ONLY in the disconnected half, in every round, is a real effect. Anything less is
not, and should be written down as not.

Usage: python link_toggle.py <addr> [emitter_com=COM8] [rounds=3] [shots=6] [receiver_com=COM7]
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
    rounds = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    nshot = int(sys.argv[4]) if len(sys.argv) > 4 else 6
    recv_com = sys.argv[5] if len(sys.argv) > 5 else "COM7"

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    def fire():
        rx._ser.reset_input_buffer()
        tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
        tx.flush()
        time.sleep(0.5)
        return witnessed(rx._readlines(0.4))

    from brx_mcp.ble import ConnectionManager

    for r in range(1, rounds + 1):
        print(f"\n========== ROUND {r} ==========", flush=True)

        # --- half A: CONNECTED, scored by $HIR
        mgr = ConnectionManager()
        await mgr.connect(addr, "v")
        try:
            hit = fired = 0
            for _ in range(nshot):
                mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
                w = fire()
                await asyncio.sleep(0.6)
                evs = [e.get("raw", "").strip() for e in
                       mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
                got = any(e.startswith("$HIR") for e in evs)
                if w or got:
                    fired += 1
                    hit += got
                await asyncio.sleep(0.4)
            print(f"   CONNECTED    $HIR {hit}/{fired}", flush=True)
        finally:
            await mgr.disconnect("v")
        print("   >>> BLE DISCONNECTED. Watch R0BQT's headset and COUNT FLASHES.", flush=True)
        await asyncio.sleep(2.5)

        # --- half B: DISCONNECTED, scored by the operator's eyes
        heard = 0
        for i in range(nshot):
            print(f"       ... firing {i+1} of {nshot}", flush=True)
            heard += fire()
            await asyncio.sleep(2.0)
        print(f"   DISCONNECTED witness heard {heard}/{nshot}  -- YOUR flash count for round {r}?",
              flush=True)
        await asyncio.sleep(1.0)

    print("\n  Report the flash count for each disconnected half.")
    print("  Deaf ONLY while disconnected, in EVERY round -> real, and a serious one: a gun that")
    print("  loses its phone mid-match would stop taking hits. Anything less -> not established,")
    print("  and it goes in the log as not established.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
