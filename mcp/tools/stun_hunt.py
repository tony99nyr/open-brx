"""Which `$SIR` FUNCTION is the stun? Replay the captured Sentinel EMP word at OUR game, one fn at a time.

Bench 2026-09-03: the native Sentinel EMP is one IR word -- proto 8, mag 15, sub 0. Replayed from
our emitter at a gun in a NATIVE Supremacy game it stunned the holder in 2 of 5 single trials and 3
of 3 sequences (and when it did, until death -- unexplained; see the experiment log). So the stun is
delivered as an ordinary 25-bit shot word, and what makes it a stun is the VICTIM's `$SIR` row for
protocol 8. NOTE the host-driven stun (`$AMMO` zero/restore, FOLLOWUPS F15) is the shippable answer;
this hunt is about whether the firmware has a stun FUNCTION of its own. In a native game that row
is the firmware's own; in ours it is whatever we send, and nobody knows which function number is
"stun" -- the enemy-polarity shortlist (functions that register a `$HIR` but move no pool) is
8, 24, 25, 26, 27, 28, 35 (`unknowns.md` U11'), plus 38, the value our bench table already puts on
protocol 8.

Per candidate: arm the gun with proto 0 -> fn 1 (plain damage, the control row) and proto 8 -> the
candidate; spawn; emit the EMP word; the holder tries to fire AT ONCE; then emit a plain proto-0
shot as the control. Every step is timestamped, and the `$HIR`/`$HP` the gun sends back are printed
so a "no effect" can be told from "the shot never registered" (a wrongly-teamed or unmatched frame
produces NO `$HIR` at all and looks exactly like a dead emitter -- `bench-tomorrow.md`).

The holder answers ONE question per candidate: after the EMP hit, could you fire? A candidate where
the trigger dies is the stun. A candidate where the shot did not register (no `$HIR`) is VOID, not a
negative. Ends on `teardown_frames()` so the gun is left hittable (F11).

Usage: python stun_hunt.py <addr> [emitter_com=COM8] [fns=38,8,24,25,26,27,28,35] [victim_team=1]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import word

PID, ENEMY_TEAM = 40, 2


def EMP_WORD(team: int) -> str:
    """The captured Sentinel EMP word (proto 8, mag 15, sub 0, player 11), re-teamed."""
    return word(15, 8, team, pid=11)


def CTRL_WORD(team: int) -> str:
    """A plain shot of the same magnitude -- the control."""
    return word(15, 0, team, pid=11)


def say(msg):
    print(f"   [{time.strftime('%H:%M:%S')}] {msg}", flush=True)


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    fns = [int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else "38,8,24,25,26,27,28,35").split(",")]
    victim_team = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    assert ENEMY_TEAM != victim_team

    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()

    def fire(bits):
        tx.write(("TX " + bits + "\n").encode())
        tx.flush()

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()

    def replies(mark):
        return [f for f in B.frames_since(mgr, "v", mark) if f.startswith(("$HIR", "$HP", "$LCD"))]

    async with B.connected(mgr, (addr, "v")):
        for fn in fns:
            sirs = [B.SIR_PLAIN, f"$SIR,8,0,,{fn},0,0,1,,*"]
            # BMAP before spawn and the spawn tail after it: without them the operator has no
            # working trigger and every "could you fire?" answer is meaningless (F16).
            for fr in B.arming_frames(PID, victim_team, sirs=sirs) + [B.AR] + B.BMAP + ["$PLAYX,0,*", "$VOL,60,0,*"]:
                await mgr.send("v", fr, reply_window_ms=0)
                await asyncio.sleep(0.1)
            mark = B.mark_of(mgr, "v")
            await mgr.send("v", "$SPAWN,,*", reply_window_ms=0)
            for fr in B.spawn_tail():
                await mgr.send("v", fr, reply_window_ms=0)
                await asyncio.sleep(0.1)
            await asyncio.sleep(3.0)
            say(f"=== fn {fn}: armed + spawned, proto 8 -> fn {fn}. pools: "
                f"{[f for f in replies(mark) if f.startswith('$LCD')]}")

            mark = B.mark_of(mgr, "v")
            fire(EMP_WORD(ENEMY_TEAM))
            say(f"fn {fn}: EMP word sent -- TRY TO FIRE NOW")
            await asyncio.sleep(7.0)
            got = replies(mark)
            say(f"fn {fn}: gun said after EMP: {got if got else 'NOTHING -- shot did not register, VOID'}")

            mark = B.mark_of(mgr, "v")
            fire(CTRL_WORD(ENEMY_TEAM))
            say(f"fn {fn}: CONTROL plain shot sent -- can you fire?")
            await asyncio.sleep(5.0)
            got = replies(mark)
            say(f"fn {fn}: gun said after control: {got if got else 'NOTHING'}")

        for fr in B.teardown_frames():
            await mgr.send("v", fr, reply_window_ms=0)
            await asyncio.sleep(0.1)
        say("done -- gun torn down and left HITTABLE.")
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
