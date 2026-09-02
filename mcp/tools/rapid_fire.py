"""Hammer the headset at ASSAULT-RIFLE rate and see if it goes into the bad state.

Tony's account of the live failure, and the condition nothing this session has tested:
*"i was using an assault rifle weapon in game and shooting at max fire rate right at the headset
during the game. maybe doing that during spawn can put it in a bad state?"*

Every shot fired on the bench on 2026-09-02 was ~1 s apart. The captured AR (`bench_common.AR`) has a
**100 ms** cycle -- ten shots a second, into a headset at point-blank range. That is two orders of
magnitude more IR than anything we have thrown at it, and it is what the real game does.

It also rhymes with the one thing we DID reproduce tonight: a `$SPAWN` arriving within 2 s of death
wedges the headset, because it lands while the headset is mid-sequence. Rapid IR is the same insult
from the other side, and a burst DURING spawn stacks both.

Phases, each with a spaced verification volley so a collapse is attributable:
    A  baseline           spaced shots -- must pass, or the run aborts
    B  rapid burst        `n` shots at the AR's real 100 ms cycle
    C  after the burst    spaced shots -- did the burst break it?
    D  burst DURING spawn the same burst fired straight into the spawn sequence
    E  after that         spaced shots

mag 1 throughout, so a burst of 30 is 30 damage against 115 of pools: this isolates FIRE RATE from
death. If it only breaks when the target also dies, that is a different experiment and a real result.

Usage: python rapid_fire.py <addr> [emitter_com=COM8] [burst=30] [shots=8] [receiver_com=COM7]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from f11_ab import SENSOR, witnessed, word
from brx_mcp.irbridge import IRBridge

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40
AR_CYCLE_S = 0.100          # the captured Assault Rifle's stock cycle -- $WEAP token 3 = 100


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    burst = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    nshot = int(sys.argv[4]) if len(sys.argv) > 4 else 8
    recv_com = sys.argv[5] if len(sys.argv) > 5 else "COM7"

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
            await asyncio.sleep(2.0)

        async def volley(tag):
            hit = fired = 0
            sens = []
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
                        sens.append(SENSOR.get(int(h[-1].split(",")[1]), "?"))
                    except Exception:
                        pass
                await asyncio.sleep(0.25)
            print(f"   {tag:34s} {hit}/{fired}   {sorted(set(sens))}", flush=True)
            return hit, fired

        def rapid(n):
            """`n` shots at the AR's real cycle. No witnessing -- frames merge at this rate."""
            for _ in range(n):
                tx.write(("TX " + word(1, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                time.sleep(AR_CYCLE_S)

        await arm()
        h, f = await volley("A. baseline (spaced)")
        if f == 0:
            raise SystemExit("ABORT: nothing confirmed fired. Fix the aim.")
        if h < f * 0.8:
            raise SystemExit(f"ABORT: already degraded ({h}/{f}) before the burst. Power-cycle,"
                             " re-arm, and re-run -- this can only find what BREAKS a working gun.")

        print(f"\n   >>> B. RAPID BURST: {burst} shots at {AR_CYCLE_S*1000:.0f}ms "
              f"({1/AR_CYCLE_S:.0f}/s, the AR's real rate)", flush=True)
        rapid(burst)
        await asyncio.sleep(2.5)
        hc, fc = await volley("C. after the burst")

        print(f"\n   >>> D. RAPID BURST FIRED INTO THE SPAWN SEQUENCE", flush=True)
        await mgr.send("v", "$SPAWN,*", reply_window_ms=0)
        rapid(burst)                       # straight into the spawn, no settle at all
        await asyncio.sleep(2.5)
        he, fe = await volley("E. after burst-during-spawn")

        print()
        if fc and hc == 0:
            print("   *** THE RAPID BURST ALONE BREAKS IT. That is the repro, and it is the real")
            print("   game's condition -- an AR emptied into a headset at point blank.")
        elif fe and he == 0:
            print("   *** BURST DURING SPAWN BREAKS IT (the burst alone did not). The trigger needs")
            print("   both: rapid IR arriving while the headset is mid-spawn.")
        elif (fc and hc < fc * 0.6) or (fe and he < fe * 0.6):
            print("   *** DEGRADED but not dead. Worth repeating before believing -- a partial")
            print("   result on this bench has been noise more often than signal.")
        else:
            print("   No effect. Rapid fire at the AR's rate does not do it, alone or during spawn.")
            print("   Record as tested. Next variable to add is DEATH during the burst (mag 200),")
            print("   which is what the live game actually did.")
    rx.close()
    tx.close()


if __name__ == "__main__":
    asyncio.run(main())
