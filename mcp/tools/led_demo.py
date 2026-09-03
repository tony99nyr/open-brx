"""Play the F1 event paints on a live, SPAWNED gun so a human can watch them.

ONE frame per event -- deliberately NOT hammered. Hammering at ~30 Hz does win the hue (93% of frames
against 18% for a single paint) but it STROBES, and flicker in the 10-25 Hz band is the
photosensitive-epilepsy trigger range. Tony, watching it: *"it looks like its having a seizure"*.

A single paint instead lets the gun's own animation BREATHE our colour in and out, which is what the
18% actually looks like to a person: a pulse of our hue rather than a solid block or a strobe. Tony:
*"lets just do it as soon as we can so it ends up breathing into our color"*.

⚠️ EXACTLY ONE frame per paint, because that is what `GameDriver._paint_event` sends. An earlier
version of this tool sent 3 repeats ~120 ms apart as "delivery insurance" -- and Tony, watching it:
*"white flashed twice, it caused the blue to flicker on the next fade in"*. The repeats interleave
with the native animation and produce a double flash, so the demo was showing something MC would
never send. A demo that does not match the shipped path is worse than no demo.

Announces each event before it plays, with a pause, so the operator can name what they saw without
having to guess which one is which.

Pass an EVENT NAME as the 4th arg to play just that one and stop, leaving the gun on the team
colour. That is the way to actually judge these: one at a time, with the team colour either side of
it, so you are comparing against the baseline rather than against the previous flash.

Usage: python led_demo.py <addr> [team=1] [night=0] [event] [hold_s] [paint_hz] [reps] [gap_s]
       events: hit_landed hit_taken kill_confirm healed armour_up shield_up died respawned
               pool:<pool>:<level>:<max>   e.g. pool:health:10:45
"""
import asyncio
import sys
import time

import bench_common as B
from brx_mcp import poolgauge as pg

# Repaint rate DURING an event's hold, in Hz. 0 = one frame only (what GameDriver sends today).
#
# One frame turned out to be INVISIBLE on a spawned gun -- Tony, watching it: "i didnt see it". A
# single paint survives only until the firmware's next animation frame (median ~0.33 s), so a 0.6 s
# event can be over before it is ever shown.
#
# The counter-intuitive part: MORE repaints means LESS flicker, not more. At ~32 Hz our colour wins
# 93% of frames, i.e. nearly solid. The strobe that looked like "a seizure" came from hammering
# CONTINUOUSLY across every event back-to-back, not from one short flash. A 0.6 s fully-painted
# flash and a multi-second hammer are different things and must be judged separately.
# ⚠️ These are ARGUMENTS, not environment variables. Env vars do NOT cross the WSL -> Windows
# interop boundary: `PAINT_HZ=25 python.exe ...` silently arrives as None, so an earlier run of this
# tool judged a "25 Hz" flash that was actually a single frame. If a knob does not visibly change
# the behaviour, check it is being read at all before believing the result.
def _opt(i, default):
    return type(default)(sys.argv[i]) if len(sys.argv) > i else default


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

        async def hold(frame, secs, PAINT_HZ=0.0):
            """One frame (PAINT_HZ=0, the shipped behaviour) or repainted at PAINT_HZ for `secs`."""
            if PAINT_HZ <= 0:
                await mgr.send("v", frame, reply_window_ms=0)
                await asyncio.sleep(secs)
                return
            end = time.time() + secs
            while time.time() < end:
                await mgr.send("v", frame, reply_window_ms=0)
                await asyncio.sleep(1.0 / PAINT_HZ)

        async def show(label, frame, secs):
            print(f"   >>> {label}", flush=True)
            await hold(frame, secs)
            await hold(pg.team_frame(team, night), 1.2)     # back to team colour
            await asyncio.sleep(1.0)

        only = sys.argv[4] if len(sys.argv) > 4 else None
        HOLD_S = _opt(5, 0.0)      # 0 = the event's own hold
        PAINT_HZ = _opt(6, 0.0)    # 0 = ONE frame, which is what GameDriver sends
        REPS = _opt(7, 1)
        GAP_S = _opt(8, 3.0)
        # Tony's idea: TWO short flashes rather than one. It buys redundancy -- a single paint is
        # sometimes overwritten by the firmware before it is ever seen ("one of them it got painted
        # over, the other two were quick flashes") -- and a deliberate double-blink reads as
        # intentional rather than as a glitch.
        PULSES = _opt(9, 1)
        PULSE_GAP_S = _opt(10, 0.35)
        # `all` walks the DISTINCT colours (hit_taken and died are both red; hit_landed and
        # respawned are both white), so this compares hues rather than replaying duplicates.
        DISTINCT = ["hit_taken", "hit_landed", "kill_confirm", "healed", "armour_up", "shield_up"]
        if only == "all":
            print(f"   >>> baseline, then each colour x{REPS}: "
                  f"{PULSES} x {HOLD_S or 0.08:.2f}s sep {PULSE_GAP_S:.2f}s\n", flush=True)
            await hold(pg.team_frame(team, night), 4.0)
            for ev in DISTINCT:
                for i in range(REPS):
                    print(f"   >>> {ev:13s} (colour {pg.EVENT_PAINTS[ev][0]})  [{i + 1}/{REPS}]",
                          flush=True)
                    for k in range(PULSES):
                        await hold(pg.event_frame(ev, night), HOLD_S or 0.08, PAINT_HZ)
                        if k < PULSES - 1:
                            await hold(pg.team_frame(team, night), PULSE_GAP_S)
                    await hold(pg.team_frame(team, night), 1.2 if i + 1 < REPS else GAP_S)
            print("\n   done -- gun left on the team colour.", flush=True)
            return
        if only:
            # baseline first, so the eye has something to compare the flash against
            print("   >>> TEAM COLOUR (baseline) for 4s -- watch it settle", flush=True)
            await hold(pg.team_frame(team, night), 4.0)
            if only.startswith("pool:"):
                _, pool, lvl, mx = only.split(":")
                frame, secs, label = (pg.pool_paint_frame(pool, int(lvl), int(mx), night),
                                      HOLD_S or 1.5, f"POOL {pool} {lvl}/{mx}")
            else:
                frame, secs, label = (pg.event_frame(only, night),
                                      HOLD_S or pg.event_hold_s(only),
                                      f"{only} (colour {pg.EVENT_PAINTS[only][0]})")
            for i in range(REPS):
                print(f"   >>> [{i + 1}/{REPS}] {label}  {PULSES} x {secs:.2f}s"
                      + (f" sep {PULSE_GAP_S:.2f}s" if PULSES > 1 else ""), flush=True)
                for k in range(PULSES):
                    await hold(frame, secs, PAINT_HZ)
                    if k < PULSES - 1:
                        await hold(pg.team_frame(team, night), PULSE_GAP_S)
                print(f"   >>> team colour for {GAP_S:.0f}s", flush=True)
                await hold(pg.team_frame(team, night), GAP_S)
            print("\n   done -- one event only, gun left on the team colour.", flush=True)
            return

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
