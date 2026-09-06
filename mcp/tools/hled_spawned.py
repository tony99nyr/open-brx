"""Does ONE `$HLED` frame HOLD on a SPAWNED gun mid-game? The unmeasured claim the F1 design rests on.

The surface split (experiment-log 2026-09-02 night) says: gun strip = what the PLAYER sees, contested
by the firmware's own animation, so a single paint only breathes; headset = what OTHER players see,
UNcontested because in native play the headset is dark and lights only on a hit, at team assignment
and while out. From that it follows that a single `$HLED` frame should hold steady with no hammering
and no strobe. Every word of that after "says" is REASONING, and reasoning has lost to the operator's
eyes on this exact class of question three times in two days (`docs/archive/bench-2026-09-03.md` item 2).

First run (2026-09-03, purple, one frame after spawn, 20 s hold): the operator saw the spawn's dim
blue blink, then dark, one native hit flash, then dark. **Our colour never appeared.** That run had
no control and printed no echoes, so it could not say whether the gun IGNORED the frame or the write
never landed. This version runs as ONE sequence, controls in the same burst (method rule 1):

  1. CONTROL  the same frame on the ARMED-UNSPAWNED gun (known to light from the palette sweep)
  2. $SPAWN   with our colour still up -- does the spawn clear it?
  3. REPAINT  after spawn, static form -- the case the design needs
  4. HIT      (if an emitter COM is given) -- flash colour, and is ours back afterwards?
  5. BLINK    the t2=2 effect form after spawn -- does an animated frame get through?
  6. BLANK    then a teardown that leaves the gun hittable

Every step prints what the gun echoed in its window, so "ignored" and "never landed" are told apart.

One colour per run, so the operator judges against dark on both sides rather than against the
previous colour. Never advances on the operator's cue -- the holds are long and announced with their
times, so what they saw binds to the one frame that was sent.

Usage: python hled_spawned.py <addr> [colour=3] [hold_s=20] [team=1] [emitter_com=]
       colours: 0 red 1 blue 2 yellow 3 green 4 purple 5 teal 6 white 7 pink 8 orange
       give an emitter COM (e.g. COM8) to land one witnessed hit during the hold.
"""
import asyncio
import sys
import time

import bench_common as B

PALETTE = {0: "red", 1: "blue", 2: "yellow", 3: "green", 4: "purple", 5: "teal", 6: "white",
           7: "pink", 8: "orange"}
VICTIM_TEAM_DEFAULT, ENEMY_TEAM, PID = 1, 2, 40


def say(msg):
    print(f"   [{time.strftime('%H:%M:%S')}] {msg}", flush=True)


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    colour = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    hold_s = float(sys.argv[3]) if len(sys.argv) > 3 else 20.0
    team = int(sys.argv[4]) if len(sys.argv) > 4 else VICTIM_TEAM_DEFAULT
    com = sys.argv[5] if len(sys.argv) > 5 else None
    frame = f"$HLED,{colour},0,,,10,,*"

    tx = None
    if com:
        import serial
        from f11_ab import word
        tx = serial.Serial(com, 115200, timeout=0.3)
        time.sleep(1.6)
        tx.reset_input_buffer()
        shot = ("TX " + word(20, 0, ENEMY_TEAM) + "\n").encode()

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()

    async def step(label, frames, secs):
        """Send `frames`, hold `secs`, then print EVERY frame the gun sent back in that window.

        The first run of this tool sent with no reply window and printed nothing, so when the
        operator saw no colour there was no way to tell "the gun ignored it" from "the write never
        landed". The echo is the difference between those two.
        """
        mark = B.mark_of(mgr, "v")
        for fr in frames:
            await mgr.send("v", fr, reply_window_ms=0)
            await asyncio.sleep(0.1)
        say(f"{label}  (holding {secs:.0f} s)")
        await asyncio.sleep(secs)
        got = B.frames_since(mgr, "v", mark)
        print(f"              gun said: {got if got else 'NOTHING'}", flush=True)

    async with B.connected(mgr, (addr, "v")):
        for fr in B.arming_frames(PID, team):
            await mgr.send("v", fr, reply_window_ms=0)
            await asyncio.sleep(0.1)
        await mgr.send("v", B.AR, reply_window_ms=0)
        await mgr.send("v", "$VOL,30,0,*", reply_window_ms=0)
        await asyncio.sleep(1.0)
        say(f"ARMED, NOT spawned, team {team}.")

        # 1. CONTROL: the same frame on the unspawned gun. Known to light (ledsweep, 2026-09-02).
        await step(f"1 CONTROL unspawned: PAINT {frame} ({PALETTE.get(colour, '?')}) -- Q: lit?",
                   [frame], 8.0)

        # 2. SPAWN with our colour still up: does the spawn clear it?
        await step("2 $SPAWN with the paint still up -- Q: does our colour SURVIVE the spawn?",
                   ["$SPAWN,,*"], 8.0)

        # 3. Repaint AFTER spawn, the case the design needs.
        await step(f"3 spawned: REPAINT {frame} -- Q: lit? for how long?", [frame], hold_s)

        # 4. Hit mid-life, if an emitter is on hand: does the native hit flash leave our colour?
        if tx is not None:
            mark = B.mark_of(mgr, "v")
            tx.write(shot)
            tx.flush()
            say(f"4 HIT from team {ENEMY_TEAM} -- Q: flash colour, and is OUR colour back after?")
            await asyncio.sleep(6.0)
            got = [f for f in B.frames_since(mgr, "v", mark) if f.startswith(("$HIR", "$HP"))]
            print(f"              gun said: {got if got else 'NO $HIR -- the shot did not register'}",
                  flush=True)

        # 5. The blink EFFECT form (t2=2, measured as a full-brightness repeating blink): does an
        #    animated frame get through where a static one did not?
        blink = f"$HLED,{colour},2,300,300,10,200,*"
        await step(f"5 spawned: BLINK {blink} -- Q: blinking {PALETTE.get(colour, '?')}?",
                   [blink], 8.0)

        # 6. Blank, then teardown that leaves the gun hittable.
        await step("6 BLANK $HLED,,6 -- Q: dark and STAYS dark?", ["$HLED,,6,,,,,*"], 5.0)
        for fr in B.teardown_frames():
            await mgr.send("v", fr, reply_window_ms=0)
            await asyncio.sleep(0.1)
        say("done -- gun torn down and left HITTABLE ($SIR table restored).")
    if tx is not None:
        tx.close()


if __name__ == "__main__":
    asyncio.run(main())
