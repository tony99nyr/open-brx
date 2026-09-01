"""U9: mid-session $WEAP re-push (a 'weapon pickup') WITHOUT $AMMO - what happens to mag/reserve?
Phases: arm AR -> tick -> fire ~3 -> auto re-push BURST frame (no $AMMO) -> tick -> fire ~3 -> report ALCD trail.
"""
import asyncio, sys

from bench_common import AR, BURST, GSET, SIR_PLAIN, PSET as _PSET, connected, frames_since, mark_of

PSET = _PSET.format(pid=5)


async def main() -> None:
    gun = sys.argv[1]
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    # `connected()` disconnects on the way out however this ends — a raise or a ^C used to leave the
    # tagger holding an open BLE link, and the next run could not connect until it was power-cycled.
    async with connected(mgr, (gun, "g")):
        async def send(fr):
            await mgr.send("g", fr, reply_window_ms=300)

        for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", GSET, PSET, SIR_PLAIN,
                   "$TID,2,*", AR, "$SPAWN,,*", "$PLAYX,0,*", "$AMMO,0,32,192,1,*", "$BMAP,0,0,,,,,*"]:
            await send(fr)
        mark = mark_of(mgr, "g")
        await send("$PLAY,U16,4,6,,,,,*")
        print("PHASE 1 GO - fire ~3 AR rounds (15s)", flush=True)
        await asyncio.sleep(15)
        print("re-pushing BURST frame, NO $AMMO...", flush=True)
        await send(BURST)
        await send("$PLAY,U16,4,6,,,,,*")
        print("PHASE 2 GO - fire ~3 bursts (15s)", flush=True)
        await asyncio.sleep(15)
        trail = [(t[1], t[4]) for t in (raw.split(",") for raw in frames_since(mgr, "g", mark))
                 if t[0] == "$ALCD" and len(t) > 4]
        print("ALCD trail (mag, reserve):", flush=True)
        print("  " + " -> ".join(f"{m}/{r}" for m, r in trail), flush=True)


asyncio.run(main())
