"""FF polarity probe: BOTH guns same team with GSET token1 = 1 (real-game value).
Silence on a same-team shot = token1=1 blocks friendly fire (our bench 0 allowed it).
"""
import asyncio, sys

AR = "$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*"
PSET = "$PSET,{pid},0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"
SIRS = ["$SIR,0,0,,1,0,0,1,,*", "$SIR,0,1,,36,0,0,1,,*", "$SIR,0,3,,37,0,0,1,,*", "$SIR,10,0,X13,1,0,100,2,60,*",
        "$SIR,13,0,H50,1,0,0,1,,*", "$SIR,13,1,H57,1,0,0,1,,*", "$SIR,13,3,H49,1,0,100,0,60,*",
        "$SIR,6,0,H02,1,0,90,1,40,*", "$SIR,8,0,,38,0,0,1,,*", "$SIR,9,3,,24,10,0,,,*"]


async def main() -> None:
    shooter, victim = sys.argv[1], sys.argv[2]
    secs = int(sys.argv[3]) if len(sys.argv) > 3 else 30
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    print("connecting shooter...", flush=True); await mgr.connect(shooter, "shooter")
    print("connecting victim...", flush=True); await mgr.connect(victim, "victim")
    sessions = next((getattr(mgr, a) for a in ("sessions", "_sessions") if isinstance(getattr(mgr, a, None), dict)), {})

    async def setup(alias, pid, weapon=None):
        frames = ["$VOL,60,0,*", "$CLEAR,*", "$START,*", "$GSET,1,0,1,0,1,0,50,1,*", PSET.format(pid=pid)] + SIRS + ["$TID,1,*"]
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
        await mgr.send(a, "$PLAYX,0,*", reply_window_ms=300); await mgr.send(a, "$CLEAR,*", reply_window_ms=300)
    await mgr.disconnect("shooter"); await mgr.disconnect("victim")


asyncio.run(main())
