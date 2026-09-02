"""Brute-force the F11 state: GUN IN GAME AND ALIVE, HEADSET INACTIVE. Search sequence x gap.

The mechanism, established 2026-09-02: the gun QUEUES commands and executes them serially -- Tony
heard four bolt-pulls drain from one burst -- and a command that arrives while the headset is still
executing a previous state change is LOST, not deferred. Proven case: a respawn within 2.0 s of death
is swallowed and the headset keeps showing dead while the gun is alive (clean at 2.5 s).

So the recipe for the fault is to drive the HEADSET into a non-game/dead state and return the GUN to
game before the headset can follow. This searches that grid.

Candidates all have the same shape: a state-change command with a headset-side effect, then a
game-entry command `gap` seconds later, with `gap` swept from 0 (what MC ships) upward.

DETECTION IS THE POINT, and it is what every tool tonight got wrong until the end:
    a dead gun and a deaf gun look identical through `$HIR`.
So every trial verifies POOLS first and only scores a trial where the gun is ALIVE. `0/N while dead`
is a corpse and is discarded; `0/N while alive and in game` is the fault.

Each trial re-establishes a known-good state and re-verifies it, so a hit is attributable to that
trial's sequence rather than to accumulated damage from earlier ones. On a hit it STOPS, leaving the
gun in the bad state for inspection.

Usage: python desync_fuzz.py <addr> [emitter=COM8] [receiver=COM7] [shots=3]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import witnessed, word
from brx_mcp.irbridge import IRBridge
from brx_mcp.gameconfig import GameConfig

VICTIM_TEAM, ENEMY_TEAM, PID, WIRE_ID = 1, 2, 40, 0
GAPS = [0.0, 0.05, 0.12, 0.25, 0.5, 1.0]


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    recv_com = sys.argv[3] if len(sys.argv) > 3 else "COM7"
    nshot = int(sys.argv[4]) if len(sys.argv) > 4 else 3

    cfg = GameConfig()
    mc_setup = list(cfg.setup_frames(WIRE_ID)) + [f"$TID,{VICTIM_TEAM},*"]
    mc_spawn = list(cfg.spawn_frames())

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

        async def send(frames, gap=0.0):
            for f in frames:
                await mgr.send("v", f, reply_window_ms=0)
                if gap:
                    await asyncio.sleep(gap)

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

        def kill():
            tx.write(("TX " + word(200, 0, ENEMY_TEAM) + "\n").encode())
            tx.flush()

        CASES = [
            ("$CLEAR -> $SPAWN",        ["$CLEAR,*"],            ["$SPAWN,*"]),
            ("$CLEAR -> $START,$SPAWN", ["$CLEAR,*"],            ["$START,*", "$SPAWN,*"]),
            ("$STOP  -> $SPAWN",        ["$STOP,*"],             ["$SPAWN,*"]),
            ("$STOP  -> $START,$SPAWN", ["$STOP,*"],             ["$START,*", "$SPAWN,*"]),
            ("MC full burst",           mc_setup,                mc_spawn),
            ("KILL   -> $SPAWN",        None,                    ["$SPAWN,*"]),
            ("KILL   -> RESPAWN_SEQ",   None,                    ["$HLOOP,0,0,*", "$SPAWN,,*"]),
        ]

        print(f"   {'case':26s} {'gap':>6s}  pools            rate", flush=True)
        for label, pre, post in CASES:
            for gap in GAPS:
                await known_good()
                hb, fb = await volley(2)
                if fb and hb == 0:
                    print(f"   (skipped {label} @ {gap}: baseline not clean)", flush=True)
                    continue
                if pre is None:
                    kill()
                    await asyncio.sleep(0.9)         # inside the death sequence
                else:
                    await send(pre)
                await asyncio.sleep(gap)
                await send(post)
                await asyncio.sleep(2.5)
                pools = await lcd()
                alive = bool(pools) and not pools.startswith("$LCD,0,0")
                h, f = await volley(nshot)
                mark = ""
                if alive and f and h == 0:
                    mark = "   <<-- GUN ALIVE AND IN GAME, REGISTERS NOTHING"
                elif not alive:
                    mark = "   (dead -- discarded, not deafness)"
                print(f"   {label:26s} {gap:5.2f}s  {pools[:16]:16s} {h}/{f}{mark}", flush=True)
                if mark.startswith("   <<--"):
                    print("\n   *** CAPTURED. Gun alive and in game, registering nothing.")
                    print("   STOPPING with the state intact -- look at the headset now, and do NOT")
                    print("   power-cycle. One hit is a lead: it must repeat before it is a cause.")
                    rx.close(); tx.close()
                    return
        print("\n   No combination produced it. The sequence/gap grid is not the trigger.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
