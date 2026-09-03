"""Does this headset's IR range FADE with time since power-on? The F11 diagnostic.

F11 turned out to be time-dependent, not permanent: full range for about a minute after a power
cycle, fading to nothing within a few minutes. That single fact invalidated a string of earlier
conclusions (a "two power cycles" pattern, a "$GSET recovery", an "arm/spawn trigger") -- all of them
were the clock rather than the treatment, because every apparent recovery happened to be measured in
the first minute.

So the measurement that matters is hit rate as a function of TIME. Fires a small burst at fixed
intervals and prints a decay curve, with the gun's own sensor as a built-in control: the gun body is
known healthy, so if IT keeps registering while the headset domes fade, the emitter and the rig are
exonerated for free and the fade is real.

Run it immediately after a power cycle, with the emitter at a FIXED distance (3 ft is where the fault
showed) aimed so it can reach both the headset and the gun body if possible.

Usage: python range_decay.py <victim_addr> [emitter_com=COM8] [minutes=10] [every_s=60]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from brx_mcp.irbridge import payload_parity

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40
SHOTS = 6


def word(mag, proto, team, sub=0, pid=42, crit=0):
    f = lambda v, n: format(v & ((1 << n) - 1), "0%db" % n)
    pay = f(proto, 4) + f(pid, 6) + f(team, 2) + f(mag, 8) + f(crit, 1) + f(sub, 2)
    return pay + payload_parity(pay)


async def main():
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    minutes = float(sys.argv[3]) if len(sys.argv) > 3 else 10.0
    every = float(sys.argv[4]) if len(sys.argv) > 4 else 60.0

    from brx_mcp.ble import ConnectionManager
    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    mgr = ConnectionManager()
    await mgr.connect(addr, "v")

    async def snd(f, s=0.25):
        await mgr.send("v", f, reply_window_ms=150)
        await asyncio.sleep(s)

    async def arm():
        for fr in B.arming_frames(PID, VICTIM_TEAM, sirs=[B.SIR_PLAIN]):
            await snd(fr)
        await snd(B.AR)
        await snd("$AMMO,0,32,192,1,*")
        await snd("$BMAP,0,0,,,,,*")

    print("=== does the headset's range fade with time since power-on? ===")
    print("   %d shots every %.0fs for %.0f min, fixed distance." % (SHOTS, every, minutes))
    print("   The GUN BODY sensor (tok1=4) is the built-in control: if it keeps registering while")
    print("   the headset domes (tok1=0..3) fade, the rig is exonerated and the fade is real.\n")
    print("   %-8s %-9s %-9s %-9s %s" % ("t+min", "headset", "gunbody", "battery", "domes seen"))
    t0 = time.time()
    try:
        await arm()
        while time.time() - t0 < minutes * 60:
            await snd("$SPAWN,,*", 1.2)          # full pools: a death must not look like a fade
            seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            for _ in range(SHOTS):
                tx.write(("TX " + word(20, 0, ENEMY_TEAM) + "\n").encode())
                tx.flush()
                await asyncio.sleep(0.9)
            await asyncio.sleep(1.2)
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
            hir = [e for e in evs if e.startswith("$HIR")]
            volts = [e for e in evs if e.startswith("$VOLTS")]
            head = [h for h in hir if h.split(",")[1] in ("0", "1", "2", "3")]
            body = [h for h in hir if h.split(",")[1] == "4"]
            domes = sorted({h.split(",")[1] for h in head})
            v = volts[-1].split(",")[1] + " mV" if volts else "-"
            print("   %-8.1f %-9s %-9s %-9s %s"
                  % ((time.time() - t0) / 60, "%d/%d" % (len(head), SHOTS),
                     "%d" % len(body), v, domes or "-"), flush=True)
            await asyncio.sleep(max(0.0, every - SHOTS * 0.9 - 3.0))
    finally:
        # $CLEAR wipes the $SIR table; a gun with no rows ignores every hit (F11). Put it back.
        await snd("$CLEAR,*", 0.2)
        for _sir in B.SIRS:
            await snd(_sir, 0.1)
        try:
            await mgr.disconnect("v")
        except Exception:
            pass
        tx.close()


asyncio.run(main())
