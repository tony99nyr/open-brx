"""Arm the victim properly, then count $HIR registrations for N seconds."""
import asyncio, sys

from bench_common import GSET, PSET as _PSET, SIRS, connected, sessions_of   # one copy of the arming frames (bench_common.py)

PSET = _PSET.format(pid=40)


async def main() -> None:
    victim = sys.argv[1]
    secs = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with connected(mgr, (victim, "victim")):
        sessions = sessions_of(mgr)
        for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", GSET, PSET] + SIRS + ["$TID,1,*", "$SPAWN,,*", "$PLAYX,0,*"]:
            await mgr.send("victim", fr, reply_window_ms=300)
        mark = len(sessions["victim"].buffer) if "victim" in sessions else 0
        print("victim ARMED team 1 - DUMP THE MAG NOW (%ds window)" % secs, flush=True)
        await asyncio.sleep(secs)
        hirs = []
        for e in list(sessions["victim"].buffer)[mark:] if "victim" in sessions else []:
            d = e.to_dict() if hasattr(e, "to_dict") else e
            raw = d.get("raw", "")
            if "$HIR" in raw:
                hirs.append(raw)
        print("HIR count: %d" % len(hirs), flush=True)
        for h in hirs[:8]:
            print("  ", h, flush=True)


asyncio.run(main())
