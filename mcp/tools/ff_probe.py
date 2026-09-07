"""FF polarity probe: BOTH guns same team with GSET token1 = 1 (real-game value).
Silence on a same-team shot = token1=1 blocks friendly fire (our bench 0 allowed it).
"""
import asyncio, sys

import bench_common as B
from bench_common import AR, GSET_FF, PSET, SIRS   # one copy of the arming frames (bench_common.py)


async def main() -> None:
    shooter, victim = sys.argv[1], sys.argv[2]
    secs = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    print("connecting shooter...", flush=True); await mgr.connect(shooter, "shooter")
    print("connecting victim...", flush=True); await mgr.connect(victim, "victim")
    sessions = next((getattr(mgr, a) for a in ("sessions", "_sessions") if isinstance(getattr(mgr, a, None), dict)), {})

    async def setup(alias, pid, weapon=None):
        frames = ["$VOL,60,0,*", "$CLEAR,*", "$START,*", GSET_FF, PSET.format(pid=pid)] + SIRS + ["$TID,1,*"]
        if weapon:
            frames.append(weapon)
        frames += ["$SPAWN,,*", "$PLAYX,0,*", "$AMMO,0,32,192,1,*", "$BMAP,0,0,,,,,*"]
        for fr in frames:
            await mgr.send(alias, fr, reply_window_ms=300)

    await setup("shooter", 5, AR)
    await setup("victim", 40)
    mark = len(sessions["victim"].buffer) if "victim" in sessions else 0
    print("ARMED - both team 1, GSET token1=1. FIRE AT THE VICTIM NOW (%ds)" % secs, flush=True)
    await asyncio.sleep(secs)
    hirs = [(e.to_dict() if hasattr(e, "to_dict") else e).get("raw", "") for e in (list(sessions["victim"].buffer)[mark:] if "victim" in sessions else [])]
    hirs = [h for h in hirs if "$HIR" in h]
    print("HIR count: %d %s" % (len(hirs), "-> SAME-TEAM DAMAGE STILL LANDS (token1 is not FF)" if hirs else "-> BLOCKED: GSET token1=1 stops friendly fire (our 0 allowed it)"), flush=True)
    for h in hirs[:4]:
        print("  ", h, flush=True)
    for a in ("shooter", "victim"):
        await mgr.send(a, "$PLAYX,0,*", reply_window_ms=300)
        for _f in B.teardown_frames():          # never sign off on a bare $CLEAR (F11)
            await mgr.send(a, _f, reply_window_ms=300)
    await mgr.disconnect("shooter"); await mgr.disconnect("victim")


asyncio.run(main())
