"""U9: mid-session $WEAP re-push (a 'weapon pickup') WITHOUT $AMMO - what happens to mag/reserve?
Phases: arm AR -> tick -> fire ~3 -> auto re-push BURST frame (no $AMMO) -> tick -> fire ~3 -> report ALCD trail.
"""
import asyncio, sys

AR = "$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*"
BURST = "$WEAP,0,,100,0,3,9,0,,,,,,,,75,850,36,216,1700,0,9,100,100,275,0,,,R18,,,,D04,D03,D02,D18,,,,,36,108,75,*"
PSET = "$PSET,5,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"


async def main() -> None:
    gun = sys.argv[1]
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    print("connecting...", flush=True)
    await mgr.connect(gun, "g")
    sessions = next((getattr(mgr, a) for a in ("sessions", "_sessions") if isinstance(getattr(mgr, a, None), dict)), {})

    async def send(fr):
        await mgr.send("g", fr, reply_window_ms=300)

    for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", "$GSET,0,0,1,0,1,0,50,1,*", PSET, "$SIR,0,0,,1,0,0,1,,*",
               "$TID,2,*", AR, "$SPAWN,,*", "$PLAYX,0,*", "$AMMO,0,32,192,1,*", "$BMAP,0,0,,,,,*"]:
        await send(fr)
    mark = len(sessions["g"].buffer)
    await send("$PLAY,U16,4,6,,,,,*")
    print("PHASE 1 GO - fire ~3 AR rounds (15s)", flush=True)
    await asyncio.sleep(15)
    print("re-pushing BURST frame, NO $AMMO...", flush=True)
    await send(BURST)
    await send("$PLAY,U16,4,6,,,,,*")
    print("PHASE 2 GO - fire ~3 bursts (15s)", flush=True)
    await asyncio.sleep(15)
    trail = []
    for e in list(sessions["g"].buffer)[mark:]:
        d = e.to_dict() if hasattr(e, "to_dict") else e
        raw = d.get("raw", "")
        if raw.startswith("$ALCD"):
            t = raw.split(",")
            trail.append((t[1], t[4]))
    print("ALCD trail (mag, reserve):", flush=True)
    print("  " + " -> ".join(f"{m}/{r}" for m, r in trail), flush=True)
    await mgr.disconnect("g")


asyncio.run(main())
