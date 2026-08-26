"""Handoff experiment 2: does $WEAP t5 mean damage?
Shooter cycles 4 captured frames (t5 = 9/45/80/115); victim respawns FULL (45/70) before each shot.
Usage: python damage_bench.py <shooter_addr> <victim_addr> [secs_per_phase=25]
"""
import asyncio, sys, time

FRAMES = [
    ("AR t5=9",      "$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*"),
    ("SHOTGUN t5=45","$WEAP,0,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*"),
    ("SNIPER t5=80", "$WEAP,0,,100,0,1,80,0,,,,,,,,300,850,4,24,1700,0,7,100,100,,0,,,S16,D20,D19,,D04,D03,D21,D18,,,,,4,12,75,*"),
    ("ROCKET t5=115","$WEAP,0,2,100,10,0,115,0,,,,,,115,80,1000,850,2,8,1200,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,4,75,30,*"),
]
PSET = "$PSET,{pid},0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"


async def main() -> None:
    shooter, victim = sys.argv[1], sys.argv[2]
    secs = int(sys.argv[3]) if len(sys.argv) > 3 else 25
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(shooter, "shooter"); await mgr.connect(victim, "victim")
    sessions = None
    for attr in ("sessions", "_sessions", "connections", "_connections"):
        d = getattr(mgr, attr, None)
        if isinstance(d, dict):
            sessions = d; break
    print("connected both; session store:", "ok" if sessions else "NOT FOUND (deltas from replies only)", flush=True)

    async def send(alias, fr, win=350):
        return await mgr.send(alias, fr, reply_window_ms=win)

    async def setup(alias, pid, tid):
        for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", "$GSET,0,0,1,0,1,0,50,1,*",
                   PSET.format(pid=pid), "$SIR,0,0,,1,0,0,1,,*", "$SIR,0,1,,36,0,0,1,,*", "$SIR,0,3,,37,0,0,1,,*", "$SIR,10,0,X13,1,0,100,2,60,*", "$SIR,13,0,H50,1,0,0,1,,*", "$SIR,13,1,H57,1,0,0,1,,*", "$SIR,13,3,H49,1,0,100,0,60,*", "$SIR,6,0,H02,1,0,90,1,40,*", "$SIR,8,0,,38,0,0,1,,*", "$SIR,9,3,,24,10,0,,,*", f"$TID,{tid},*"]:
            await send(alias, fr)

    def buf_len(alias):
        return len(sessions[alias].buffer) if sessions and alias in sessions else 0

    def buf_new(alias, mark):
        if not sessions or alias not in sessions:
            return []
        return [e.to_dict() if hasattr(e, "to_dict") else e for e in list(sessions[alias].buffer)[mark:]]

    await setup("shooter", 5, 1)
    await setup("victim", 40, 2)
    only = (sys.argv[4].upper().split(",") if len(sys.argv) > 4 else None)
    for name, frame in FRAMES:
        if only and not any(o in name.upper() for o in only):
            continue
        print("", flush=True)
        print("=== %s  t=%s" % (name, time.strftime("%H:%M:%S")), flush=True)
        await send("shooter", frame)
        # full cold-start on the victim every phase: a dead gun does not revive on $SPAWN alone
        await setup("victim", 40, 2)
        await send("victim", "$SPAWN,,*"); await send("victim", "$PLAYX,0,*")
        await send("victim", "$AMMO,0,32,192,1,*"); await send("victim", "$BMAP,0,0,,,,,*")
        await send("shooter", "$SPAWN,,*"); await send("shooter", "$PLAYX,0,*")
        await send("shooter", "$AMMO,0,32,384,1,*"); await send("shooter", "$BMAP,0,0,,,,,*")
        mark = buf_len("victim")
        await send("shooter", "$PLAY,U16,4,6,,,,,*")
        print("    READY - FIRE ONE SHOT AT THE VICTIM", flush=True)
        await asyncio.sleep(secs)
        for e in buf_new("victim", mark):
            raw = e.get("raw", "")
            if any(k in raw for k in ("$HIR", "$HP", "$DD")):
                print("    victim<<", raw, flush=True)
    print("", flush=True); print("done - clearing both", flush=True)
    for a in ("shooter", "victim"):
        await send(a, "$PLAYX,0,*"); await send(a, "$CLEAR,*")
    await mgr.disconnect("shooter"); await mgr.disconnect("victim")


asyncio.run(main())
