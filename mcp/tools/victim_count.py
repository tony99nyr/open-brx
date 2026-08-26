"""Arm the victim properly, then count $HIR registrations for N seconds."""
import asyncio, sys

PSET = "$PSET,40,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"
SIRS = ["$SIR,0,0,,1,0,0,1,,*", "$SIR,0,1,,36,0,0,1,,*", "$SIR,0,3,,37,0,0,1,,*", "$SIR,10,0,X13,1,0,100,2,60,*",
        "$SIR,13,0,H50,1,0,0,1,,*", "$SIR,13,1,H57,1,0,0,1,,*", "$SIR,13,3,H49,1,0,100,0,60,*",
        "$SIR,6,0,H02,1,0,90,1,40,*", "$SIR,8,0,,38,0,0,1,,*", "$SIR,9,3,,24,10,0,,,*"]


async def main() -> None:
    victim = sys.argv[1]
    secs = int(sys.argv[2]) if len(sys.argv) > 2 else 40
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(victim, "victim")
    sessions = next((getattr(mgr, a) for a in ("sessions", "_sessions") if isinstance(getattr(mgr, a, None), dict)), {})
    for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", "$GSET,0,0,1,0,1,0,50,1,*", PSET] + SIRS + ["$TID,1,*", "$SPAWN,,*", "$PLAYX,0,*"]:
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
    await mgr.disconnect("victim")


asyncio.run(main())
