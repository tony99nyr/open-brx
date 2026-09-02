"""Arm the gun the way MISSION CONTROL ACTUALLY DOES -- zero gap -- and see if it registers hits.

The gap this closes. Every bench tool uses `bench_common.arming_frames` with 0.12 s between frames.
MC's driver has NO sleep anywhere: `setup_frames()` (27 frames) then `spawn_frames()` (4 frames) go
out back-to-back as fast as BLE accepts them, and `resetup()` does the same mid-match after a
reconnect. So all fifteen F11 hypotheses eliminated on 2026-09-02 were tested against a GENTLER setup
than the one we ship, and the shipped one has never been on this bench at all.

Why it is a candidate. `$SPAWN,,*` is the FIRST of the four spawn frames and has a headset-side
effect; `$AMMO`, `$AMMO`, `$BMAP` land immediately behind it while the headset is still processing.
That is the same shape that wedged the headset display when a respawn arrived within 2 s of death
(threshold measured tonight: 2.0 s fails, 2.5 s clean) -- and Tony's mechanism for it, that the
headset is a second device behind a relay and needs a settling gap, does not care whether the burst
is a respawn or a game start.

Design. A/B, INTERLEAVED, using the REAL frames from `GameConfig` rather than a bench copy of them --
the point is to test what ships, so a hand-maintained duplicate would defeat the whole exercise:

    ZERO GAP  exactly MC's driver: no sleep between any of the 31 frames
    SPACED    the same 31 frames, 0.30 s apart

Rounds alternate so a drift over the session cannot masquerade as an arm difference. Every shot is
witnessed; unwitnessed shots are excluded rather than counted as misses. mag 1, so nothing dies.

Read it as: ZERO GAP registering worse, repeatably, is our bug in code we control, and the fix is
pacing. Both arms at 100% means the burst is NOT the trigger -- record that and stop suspecting it.

Usage: python mc_burst.py <addr> [emitter_com=COM8] [shots=8] [rounds=3] [receiver_com=COM7]
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
    nshot = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    rounds = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    recv_com = sys.argv[5] if len(sys.argv) > 5 else "COM7"

    cfg = GameConfig()
    setup = list(cfg.setup_frames(WIRE_ID)) + [f"$TID,{VICTIM_TEAM},*"]
    spawn = list(cfg.spawn_frames())
    print(f"   MC's real bundle: {len(setup)} setup + {len(spawn)} spawn = {len(setup)+len(spawn)} frames")

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    rx = IRBridge(port=recv_com)
    time.sleep(1.2)
    B.arm_receiver(rx)

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    tally = {"ZERO GAP": [0, 0], "SPACED": [0, 0]}
    sensors = {"ZERO GAP": [], "SPACED": []}
    async with B.connected(mgr, (addr, "v")):

        async def arm(gap):
            for f in setup:
                await mgr.send("v", f, reply_window_ms=0)
                if gap:
                    await asyncio.sleep(gap)
            for f in spawn:
                await mgr.send("v", f, reply_window_ms=0)
                if gap:
                    await asyncio.sleep(gap)
            await asyncio.sleep(2.0)          # equal settle for BOTH arms before any shot

        async def volley(name):
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
                h = [e for e in evs if e.startswith("$HIR")]
                if w or h:
                    fired += 1
                    hit += bool(h)
                if h:
                    try:
                        sensors[name].append(SENSOR.get(int(h[-1].split(",")[1]), "?"))
                    except Exception:
                        pass
                await asyncio.sleep(0.25)
            tally[name][0] += hit
            tally[name][1] += fired
            return hit, fired

        for r in range(1, rounds + 1):
            for name, gap in (("ZERO GAP", 0.0), ("SPACED", 0.30)):
                await arm(gap)
                h, f = await volley(name)
                print(f"   round {r}  {name:9s}  {h}/{f}", flush=True)

    print("\n=== TOTALS (confirmed-fired only) ===")
    for name in ("ZERO GAP", "SPACED"):
        h, f = tally[name]
        print(f"   {name:9s}  {h}/{f}  {100.0*h/f if f else 0:.0f}%   sensors={sorted(set(sensors[name]))}")
    z = tally["ZERO GAP"]
    s = tally["SPACED"]
    if not z[1] or not s[1]:
        print("\n   ABORT: an arm has ZERO confirmed-fired shots -- nothing to compare. Fix the rig.")
        rx.close(); tx.close(); return
    rz = z[0] / z[1] if z[1] else 0
    rs = s[0] / s[1] if s[1] else 0
    print()
    if rz < rs - 0.15:
        print("   *** ZERO GAP registers WORSE. That is MC's shipped arming path degrading hit")
        print("   detection -- our bug, in code we control, and the fix is pacing the bundle.")
    elif rs < rz - 0.15:
        print("   SPACED is worse, which is backwards. Record it and re-think; do not drop it.")
    else:
        print("   No difference. MC's zero-gap burst is NOT the trigger -- record that as tested")
        print("   and take it off the suspect list rather than leaving it as a maybe.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
