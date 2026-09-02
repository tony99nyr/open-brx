"""The live-game condition: CONTINUOUS assault-rifle fire through MC's real death/respawn path.

What the live failure actually was, in Tony's words: an assault rifle held down at max fire rate,
point blank at the headset, during a game -- so the target is being killed, respawned by MC, and shot
at again WITHOUT the fire ever stopping.

Nothing on the bench has done that. `rapid_fire.py` fired 30 rapid shots but at magnitude 1, so
nothing died and nothing respawned -- it isolated the fire rate and left out the rest of the
scenario. This puts the whole scenario together:

  * arming uses MC's REAL frames (`GameConfig.setup_frames` / `spawn_frames`), sent back-to-back with
    NO gap, exactly as `driver.py` sends them
  * fire is CONTINUOUS at the captured AR's 100 ms cycle, from a background thread, and does not stop
    for the death, the respawn, or anything else
  * death is detected from the gun's own `$HP`, and the respawn is MC's real `RESPAWN_SEQUENCE`
    (`$HLOOP,0,0,*`, `$SPAWN,,*`) sent back-to-back, again exactly as `driver.py` sends it

After N cycles the fire STOPS and a spaced verification volley asks the only question that matters:
does it still register? A collapse here is the live-game bug, reproduced on the bench.

`--gap` sets the death->respawn delay. MC's default `respawn_s` is 15 s, well clear of the 2.0-2.5 s
wedge threshold measured tonight; a short gap is the risky configuration and is worth testing too.

Usage: python live_sim.py <addr> [emitter=COM8] [cycles=5] [gap_s=3.0] [dmg=20] [receiver=COM7]
"""
import asyncio
import sys
import threading
import time

import serial

import bench_common as B
from f11_ab import SENSOR, witnessed, word
from brx_mcp.irbridge import IRBridge
from brx_mcp.gameconfig import GameConfig

VICTIM_TEAM, ENEMY_TEAM, WIRE_ID = 1, 2, 0
AR_CYCLE_S = 0.100
RESPAWN_SEQUENCE = ("$HLOOP,0,0,*", "$SPAWN,,*")


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    cycles = int(sys.argv[3]) if len(sys.argv) > 3 else 5
    gap = float(sys.argv[4]) if len(sys.argv) > 4 else 3.0
    dmg = int(sys.argv[5]) if len(sys.argv) > 5 else 20
    recv_com = sys.argv[6] if len(sys.argv) > 6 else "COM7"

    cfg = GameConfig()
    setup = list(cfg.setup_frames(WIRE_ID)) + [f"$TID,{VICTIM_TEAM},*"]
    spawn = list(cfg.spawn_frames())

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

    firing = threading.Event()
    stop = threading.Event()
    lock = threading.Lock()
    shots = [0]

    def gun():
        """The trigger, held down. Never stops for the death or the respawn."""
        while not stop.is_set():
            if firing.is_set():
                with lock:
                    tx.write(("TX " + word(dmg, 0, ENEMY_TEAM) + "\n").encode())
                    tx.flush()
                    shots[0] += 1
                time.sleep(AR_CYCLE_S)
            else:
                time.sleep(0.02)

    th = threading.Thread(target=gun, daemon=True)
    th.start()

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    try:
        async with B.connected(mgr, (addr, "v")):

            async def send_all(frames):
                for f in frames:                     # zero gap -- exactly what driver.py does
                    await mgr.send("v", f, reply_window_ms=0)

            async def volley(tag, n=8):
                hit = fired = 0
                sens = []
                for _ in range(n):
                    mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
                    with lock:
                        rx._ser.reset_input_buffer()
                        tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                        tx.flush()
                    await asyncio.sleep(0.9)
                    w = witnessed(rx._readlines(0.4))
                    evs = [e.get("raw", "").strip() for e in
                           mgr.get_events("v", since_seq=mark).get("events", [])
                           if isinstance(e, dict)]
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
                print(f"   {tag:32s} {hit}/{fired}   {sorted(set(sens))}", flush=True)
                return hit, fired

            await send_all(setup)
            await send_all(spawn)
            await asyncio.sleep(2.0)
            h, f = await volley("baseline (MC arm, no fire)")
            if f and h < f * 0.8:
                raise SystemExit(f"ABORT: already degraded ({h}/{f}) before we started.")

            for c in range(1, cycles + 1):
                firing.set()
                # wait for the gun's own $HP to report death, fire never pausing
                died = False
                t_start = time.time()
                while time.time() - t_start < 25:
                    await asyncio.sleep(0.4)
                    evs = [e.get("raw", "").strip() for e in
                           mgr.get_events("v", since_seq=0).get("events", [])[-25:]
                           if isinstance(e, dict)]
                    if any(e.startswith("$HP,0,0") for e in evs):
                        died = True
                        break
                await asyncio.sleep(gap)             # death -> respawn delay, STILL FIRING
                # Stop firing BEFORE the respawn on the LAST cycle only: continuing to pour 10
                # shots/s of mag-20 into a freshly respawned gun just kills it again, and the
                # verification volley then measures a CORPSE. The first run of this tool did
                # exactly that and printed "REPRODUCED" at a gun that was merely dead.
                if c == cycles:
                    firing.clear()
                    await asyncio.sleep(0.8)
                await send_all(RESPAWN_SEQUENCE)     # MC's real respawn, zero gap
                await asyncio.sleep(1.5)
                firing.clear()
                await asyncio.sleep(1.5)
                print(f"   cycle {c}: died={died}  shots so far={shots[0]}", flush=True)

            await asyncio.sleep(2.0)

            # ALIVE CHECK -- the check every tool tonight was missing. A dead gun and a deaf gun are
            # indistinguishable through $HIR, so a "deaf" verdict is worthless without proving the
            # gun has pools. Revive it if it does not, and say so.
            mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            await mgr.send("v", "$QUERY,*", reply_window_ms=1200)
            await asyncio.sleep(1.0)
            q = [e.get("raw", "").strip() for e in
                 mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
            lcd = next((x for x in q if x.startswith("$LCD")), "")
            print(f"   pools before verifying: {lcd or '(no reply)'}", flush=True)
            dead = lcd.startswith("$LCD,0,0")
            if dead:
                print("   gun is DEAD -- reviving before the verification volley, because a corpse"
                      "\n   scores 0/N and that is not deafness.", flush=True)
                await send_all(RESPAWN_SEQUENCE)
                await asyncio.sleep(2.5)

            hv, fv = await volley("AFTER continuous fire + respawns")

            print()
            if fv and hv == 0:
                print("   *** REPRODUCED. Continuous AR fire through MC's death/respawn path leaves")
                print("   it DEAF. Stopping here with the gun in the bad state -- check the headset")
                print("   by eye and do NOT power-cycle it yet.")
            elif fv and hv < fv * 0.6:
                print("   *** DEGRADED, not dead. Repeat before believing it: a partial result on")
                print("   this bench has been noise more often than signal.")
            else:
                print("   No effect. The full live-game condition -- continuous AR fire, real MC")
                print("   arming, real deaths, real respawns -- does NOT reproduce it either.")
    finally:
        stop.set()
        th.join(timeout=2.0)
        rx.close()
        tx.close()


if __name__ == "__main__":
    asyncio.run(main())
