"""Is the deaf headset caused by OUR arming being too fast, out of order, or incomplete?

Operator hypothesis, and there are real differences between what we send and what Callsign sends that
have never been controlled for:

  ORDER         Callsign: $CLEAR $START $GSET $PSET $WEAP*3 $SIR*10 $BMAP*7 $TID $PLAYX $PLAY
                          $SPAWN $AMMO $BMAP
                ours:     $VOL $CLEAR $START $GSET $PSET $SIR*1 $TID $WEAP $SPAWN $AMMO $BMAP
                -> we send $SIR before $WEAP and $TID before $WEAP; Callsign does the opposite.
  COMPLETENESS  we send ONE $SIR row and ONE $BMAP; Callsign sends TEN and SEVEN.
  TIMING        our gaps are 200-260 ms. Callsign's are not necessarily that tight.

Runs three arms against the same emitter, distance and target, and fires the same burst after each,
so the only thing that differs is HOW the gun was armed:

  A  our usual fast arm            (the control -- must reproduce the fault to mean anything)
  B  our frames, SLOW (700 ms)     (isolates timing alone)
  C  Callsign's order, full $SIR table, slow  (isolates order + completeness)

Usage: python careful_arm.py <victim_addr> [emitter_com=COM8] [shots=6]
"""
import asyncio
import sys
import time

import serial

import bench_common as B
from brx_mcp.irbridge import payload_parity

VICTIM_TEAM, ENEMY_TEAM, PID = 1, 2, 40


def word(mag, proto, team, sub=0, pid=42, crit=0):
    f = lambda v, n: format(v & ((1 << n) - 1), "0%db" % n)
    pay = f(proto, 4) + f(pid, 6) + f(team, 2) + f(mag, 8) + f(crit, 1) + f(sub, 2)
    return pay + payload_parity(pay)


async def main():
    addr = sys.argv[1]
    com = sys.argv[2] if len(sys.argv) > 2 else "COM8"
    shots = int(sys.argv[3]) if len(sys.argv) > 3 else 6

    from brx_mcp.ble import ConnectionManager
    tx = serial.Serial(com, 115200, timeout=0.3)
    time.sleep(1.6)
    tx.reset_input_buffer()
    mgr = ConnectionManager()
    await mgr.connect(addr, "v")

    async def snd(f, gap):
        await mgr.send("v", f, reply_window_ms=160)
        await asyncio.sleep(gap)

    async def burst(label):
        seq = mgr.get_events("v", since_seq=0).get("last_seq", 0)
        for _ in range(shots):
            tx.write(("TX " + word(20, 0, ENEMY_TEAM) + "\n").encode())
            tx.flush()
            await asyncio.sleep(1.0)
        await asyncio.sleep(1.3)
        evs = [e.get("raw", "").strip() for e in
               mgr.get_events("v", since_seq=seq).get("events", []) if isinstance(e, dict)]
        hir = [e for e in evs if e.startswith("$HIR")]
        doms = sorted({h.split(",")[1] for h in hir})
        print("   %-46s %d/%d hits   sensors %s" % (label, len(hir), shots, doms or "-"), flush=True)
        return len(hir)

    async def arm_ours(gap):
        for fr in B.arming_frames(PID, VICTIM_TEAM, sirs=[B.SIR_PLAIN]):
            await snd(fr, gap)
        await snd(B.AR, gap)
        await snd("$SPAWN,,*", 1.2)
        await snd("$AMMO,0,32,192,1,*", gap)
        await snd("$BMAP,0,0,,,,,*", gap)

    async def arm_callsign(gap):
        """Callsign's ORDER and completeness: weapon before SIR, full 10-row table, BMAP before TID."""
        await snd("$CLEAR,*", gap)
        await snd("$START,*", gap)
        await snd(B.GSET, gap)
        await snd(B.PSET.format(pid=PID), gap)
        await snd(B.AR, gap)
        for row in B.SIRS:                      # all TEN rows, as the app sends
            await snd(row, gap)
        await snd("$BMAP,0,0,,,,,*", gap)
        await snd(f"$TID,{VICTIM_TEAM},*", gap)
        await snd("$SPAWN,,*", 1.2)
        await snd("$AMMO,0,32,192,1,*", gap)
        await snd("$BMAP,0,0,,,,,*", gap)

    print("=== is it HOW we arm? same emitter, distance and target throughout ===\n")
    try:
        await arm_ours(0.22)
        a = await burst("A  our usual FAST arm (control)")
        await arm_ours(0.70)
        b = await burst("B  our frames, SLOW 700ms gaps")
        await arm_callsign(0.70)
        c = await burst("C  Callsign order + full $SIR table, slow")
        print()
        if a and b and c:
            print("   all three worked -- the fault is not present right now, so this proves nothing.")
        elif not a and (b or c):
            print("   >>> ARMING IS THE CAUSE. %s fixed it." %
                  ("Slower timing" if b else "Order/completeness"))
        elif not (a or b or c):
            print("   >>> arming is NOT the cause: every variant is deaf, including Callsign's own order.")
    finally:
        for _f in B.teardown_frames():              # never sign off on a bare $CLEAR (F11)
            await snd(_f, 0.15)
        try:
            await mgr.disconnect("v")
        except Exception:
            pass
        tx.close()


asyncio.run(main())
