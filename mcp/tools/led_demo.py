"""Play the F1 event paints on a live, SPAWNED gun so a human can watch them.

ONE frame per event -- deliberately NOT hammered. Hammering at ~30 Hz does win the hue (93% of frames
against 18% for a single paint) but it STROBES, and flicker in the 10-25 Hz band is the
photosensitive-epilepsy trigger range. Tony, watching it: *"it looks like its having a seizure"*.

A single paint instead lets the gun's own animation BREATHE our colour in and out, which is what the
18% actually looks like to a person: a pulse of our hue rather than a solid block or a strobe. Tony:
*"lets just do it as soon as we can so it ends up breathing into our color"*.

A couple of repeats spaced ~120 ms are sent per event, not for duty cycle but for DELIVERY -- a
single BLE write that does not land would drop the event silently.

Announces each event before it plays, with a pause, so the operator can name what they saw without
having to guess which one is which.

Usage: python led_demo.py <addr> [team=1] [night=0]
"""
import asyncio
import sys
import time

import bench_common as B
from brx_mcp import poolgauge as pg

REPEATS, REPEAT_GAP_S = 3, 0.12   # delivery insurance, NOT duty cycle


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    team = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    night = bool(int(sys.argv[3])) if len(sys.argv) > 3 else False

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):
        for fr in B.arming_frames(40, team):
            await mgr.send("v", fr, reply_window_ms=0)
            await asyncio.sleep(0.1)
        await mgr.send("v", B.AR, reply_window_ms=0)
        await asyncio.sleep(0.15)
        await mgr.send("v", "$SPAWN,,*", reply_window_ms=0)
        await mgr.send("v", "$VOL,30,0,*", reply_window_ms=0)
        await asyncio.sleep(4.0)
        print(f"   armed + spawned, team {team}, night={night}. Native animation is running.\n",
              flush=True)

        async def hold(frame, secs):
            """Send the frame a few times for delivery, then LET IT BREATHE for the rest of `secs`."""
            for _ in range(REPEATS):
                await mgr.send("v", frame, reply_window_ms=0)
                await asyncio.sleep(REPEAT_GAP_S)
            await asyncio.sleep(max(0.0, secs - REPEATS * REPEAT_GAP_S))

        async def show(label, frame, secs):
            print(f"   >>> {label}", flush=True)
            await hold(frame, secs)
            await hold(pg.team_frame(team, night), 1.2)     # back to team colour
            await asyncio.sleep(1.0)

        await show("TEAM COLOUR (baseline)", pg.team_frame(team, night), 2.5)
        for ev in ("hit_landed", "hit_taken", "kill_confirm", "healed",
                   "armour_up", "shield_up", "died", "respawned"):
            await show(f"{ev:14s} {pg.EVENT_PAINTS[ev][0]:>2} for {pg.event_hold_s(ev)}s",
                       pg.event_frame(ev, night), pg.event_hold_s(ev))

        print("   >>> POOL PAINTS (in-game form: whole strip, colour carries the level)", flush=True)
        for pool, lvl, mx in (("shield", 70, 70), ("armor", 35, 70),
                              ("health", 45, 45), ("health", 20, 45), ("health", 5, 45)):
            print(f"       {pool} {lvl}/{mx}", flush=True)
            await hold(pg.pool_paint_frame(pool, lvl, mx, night), 2.0)
        await hold(pg.team_frame(team, night), 2.0)
        print("\n   done -- left on the team colour.", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
