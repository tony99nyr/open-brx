"""Handoff experiment 2: does $WEAP t5 mean damage?
Shooter cycles 4 captured frames (t5 = 9/45/80/115); victim respawns FULL (45/70) before each shot.
Usage: python damage_bench.py <shooter_addr> <victim_addr> [secs_per_phase=25]
"""
import asyncio, sys, time

import bench_common as B
from bench_common import AR, GSET, PSET, SIRS   # one copy of the arming frames (bench_common.py)

FRAMES = [
    ("AR t5=9",      AR),
    ("SHOTGUN t5=45","$WEAP,0,2,100,0,0,45,0,,,,,,70,80,900,850,6,24,400,2,7,100,100,,0,,,T01,,,,D01,D28,D27,D18,,,,,6,12,75,30,*"),
    ("SNIPER t5=80", "$WEAP,0,,100,0,1,80,0,,,,,,,,300,850,4,24,1700,0,7,100,100,,0,,,S16,D20,D19,,D04,D03,D21,D18,,,,,4,12,75,*"),
    ("ROCKET t5=115","$WEAP,0,2,100,10,0,115,0,,,,,,115,80,1000,850,2,8,1200,0,7,100,100,,0,,,C03,,,,D14,D13,D12,D18,,,,,2,4,75,30,*"),
]


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
        for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", GSET,
                   PSET.format(pid=pid)] + SIRS + [f"$TID,{tid},*"]:
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
        await send(a, "$PLAYX,0,*")
        for _f in B.teardown_frames():          # never sign off on a bare $CLEAR (F11)
            await send(a, _f)
    await mgr.disconnect("shooter"); await mgr.disconnect("victim")


asyncio.run(main())
