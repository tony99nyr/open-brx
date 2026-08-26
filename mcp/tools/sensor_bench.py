"""Map $HIR token 1 (sensor id): shoot each headset side + the gun, read which id reports.
Usage: python sensor_bench.py <shooter> <victim> [secs=12]
"""
import asyncio, sys, time

AR = "$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*"
PSET = "$PSET,{pid},0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"
SIRS = ["$SIR,0,0,,1,0,0,1,,*", "$SIR,0,1,,36,0,0,1,,*", "$SIR,0,3,,37,0,0,1,,*", "$SIR,10,0,X13,1,0,100,2,60,*",
        "$SIR,13,0,H50,1,0,0,1,,*", "$SIR,13,1,H57,1,0,0,1,,*", "$SIR,13,3,H49,1,0,100,0,60,*",
        "$SIR,6,0,H02,1,0,90,1,40,*", "$SIR,8,0,,38,0,0,1,,*", "$SIR,9,3,,24,10,0,,,*"]
PHASES = ["HEADSET FRONT ONLY - shield the gun sensors and the back dome", "HEADSET BACK ONLY - shield the gun and the front dome", "GUN ONLY - shield the whole headset dome"]


async def main() -> None:
    shooter, victim = sys.argv[1], sys.argv[2]
    secs = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    print("connecting shooter...", flush=True)
    await mgr.connect(shooter, "shooter")
    print("connecting victim...", flush=True)
    await mgr.connect(victim, "victim")
    sessions = next((getattr(mgr, a) for a in ("sessions", "_sessions") if isinstance(getattr(mgr, a, None), dict)), {})

    async def send(alias, fr):
        await mgr.send(alias, fr, reply_window_ms=300)

    async def setup(alias, pid, tid):
        for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", "$GSET,0,0,1,0,1,0,50,1,*", PSET.format(pid=pid)] + SIRS + [f"$TID,{tid},*"]:
            await send(alias, fr)
        await send(alias, "$SPAWN,,*"); await send(alias, "$PLAYX,0,*")
        await send(alias, "$AMMO,0,32,192,1,*"); await send(alias, "$BMAP,0,0,,,,,*")

    await setup("shooter", 5, 1)
    await send("shooter", AR)
    await setup("victim", 40, 2)
    print("armed", flush=True)
    for label in PHASES:
        # re-arm the victim fresh so it never dies mid-mapping
        await setup("victim", 40, 2)
        mark = len(sessions["victim"].buffer) if "victim" in sessions else 0
        await send("shooter", "$PLAY,U16,4,6,,,,,*")
        print("", flush=True); print("=== SHOOT %s  t=%s" % (label, time.strftime("%H:%M:%S")), flush=True)
        await asyncio.sleep(secs)
        for e in list(sessions["victim"].buffer)[mark:] if "victim" in sessions else []:
            d = e.to_dict() if hasattr(e, "to_dict") else e
            raw = d.get("raw", "")
            if "$HIR" in raw or "$HP" in raw:
                print("    victim<<", raw, flush=True)
    print("done - clearing", flush=True)
    for a in ("shooter", "victim"):
        await send(a, "$PLAYX,0,*"); await send(a, "$CLEAR,*")
    await mgr.disconnect("shooter"); await mgr.disconnect("victim")


asyncio.run(main())
