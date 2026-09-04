"""Can we paint the headset TEAM COLOUR full-bright after spawn, and does `$HLED` token 5 change brightness?

Context (bench 2026-09-03). Tony, watching a spawn: the headset "blinked dim blue". That blink is the
FIRMWARE's -- our shipped `spawn`/`revive` bundles send `$SPAWN` + `$AMMO`s and no `$HLED` at all, and
the bench tool that showed it sent none either. So the fix is not to brighten a frame we send; it is
to PAINT the team colour after spawn, which `hled_spawned.py` showed holds solid on a spawned gun.

Two things this run has to settle before that fix is written:

  1. HOW SOON after `$SPAWN` can the paint go? The headset is a second device behind a relay and a
     `$SPAWN` sent within ~2 s of a death is never executed there (F13, `$HLED` is named as subject
     to the same rule). Step 1 paints 1 s after spawn; step 2 paints again 6 s later as the control.
     If step 1 is dark and step 2 lit, the repaint needs the same >= 3 s gap.
  2. IS TOKEN 5 A BRIGHTNESS on the headset? On the GUN it is (0 off, 1 dim, >=2 full, 10 saturated).
     On the headset it is UNKNOWN -- `compile.py` keeps Callsign's 10 for exactly that reason, and a
     wrong guess (a repeat count) would be harmless here because the static form (t2=0) has nothing
     to repeat. Steps 3-6 sweep 1 / 2 / 100 / 255 against the 10 control, same gun, same burst.

Operator-in-the-loop: each step is announced with the value; judge BRIGHTER / SAME / DIMMER / DARK
against step 2 (the 10 control). Blanks between steps so each is judged against dark.

Usage: python hled_bright.py <addr> [colour=1] [team=1] [ab=10,255,10,1]
       With a 4th arg the run is a plain A/B: spawn, then show each listed token-5 value for 6 s
       with 3 s of dark between, in that order, nothing else. Four lit periods are trackable by
       eye; the eight-step sweep above was not (2026-09-03, first run).
"""
import asyncio
import sys
import time

import bench_common as B

PID = 40
SWEEP = (1, 2, 100, 255)


def say(msg):
    print(f"   [{time.strftime('%H:%M:%S')}] {msg}", flush=True)


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    colour = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    team = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    ab = [int(v) for v in sys.argv[4].split(",")] if len(sys.argv) > 4 else None

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()

    async def paint(label, frame, secs):
        mark = B.mark_of(mgr, "v")
        await mgr.send("v", frame, reply_window_ms=0)
        say(f"{label}: {frame}  (hold {secs:.0f} s)")
        await asyncio.sleep(secs)
        got = B.frames_since(mgr, "v", mark)
        print(f"              gun said: {got if got else 'NOTHING'}", flush=True)

    async def blank(secs=2.5):
        await mgr.send("v", "$HLED,,6,,,,,*", reply_window_ms=0)
        await asyncio.sleep(secs)

    async with B.connected(mgr, (addr, "v")):
        for fr in B.arming_frames(PID, team):
            await mgr.send("v", fr, reply_window_ms=0)
            await asyncio.sleep(0.1)
        await mgr.send("v", B.AR, reply_window_ms=0)
        await mgr.send("v", "$VOL,30,0,*", reply_window_ms=0)
        await asyncio.sleep(0.5)

        say("$SPAWN -- watch for the firmware's own dim team blink.")
        await mgr.send("v", "$SPAWN,,*", reply_window_ms=0)
        await asyncio.sleep(1.0)
        if ab:
            await asyncio.sleep(3.0)
            for i, t5 in enumerate(ab, start=1):
                await paint(f"{i} t5={t5}", f"$HLED,{colour},0,,,{t5},,*", 6.0)
                await blank(3.0)
            for fr in B.teardown_frames():
                await mgr.send("v", fr, reply_window_ms=0)
                await asyncio.sleep(0.1)
            say("done -- gun torn down and left HITTABLE.")
            return
        await paint("1 paint +1 s after spawn (t5=10) -- Q: LIT or DARK?",
                    f"$HLED,{colour},0,,,10,,*", 6.0)
        await blank()
        await paint("2 CONTROL t5=10 -- judge the rest against THIS",
                    f"$HLED,{colour},0,,,10,,*", 6.0)
        await blank()
        for i, t5 in enumerate(SWEEP, start=3):
            await paint(f"{i} t5={t5} -- Q: BRIGHTER / SAME / DIMMER / DARK vs step 2?",
                        f"$HLED,{colour},0,,,{t5},,*", 6.0)
            await blank()
        await paint("7 CONTROL again t5=10 -- closing control", f"$HLED,{colour},0,,,10,,*", 5.0)
        await blank(3.0)

        for fr in B.teardown_frames():
            await mgr.send("v", fr, reply_window_ms=0)
            await asyncio.sleep(0.1)
        say("done -- gun torn down and left HITTABLE.")


if __name__ == "__main__":
    asyncio.run(main())
