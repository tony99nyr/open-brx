"""MINIMAL victim config: fewest frames possible so a flaky link can finish the burst.
Config survives the BLE drop - the gun stays a working target afterward."""
import asyncio, sys


async def main() -> None:
    victim = sys.argv[1]
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    print("connecting...", flush=True)
    await mgr.connect(victim, "v")
    print("connected - pushing minimal config", flush=True)
    for fr in ["$CLEAR,*", "$START,*",
               "$PSET,40,0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*",
               "$SIR,0,0,,1,0,0,1,,*", "$TID,1,*", "$SPAWN,,*"]:
        await mgr.send("v", fr, reply_window_ms=250)
        print("  ok:", fr.split(",")[0], flush=True)
    print("VICTIM CONFIGURED + SPAWNED - link may now drop freely", flush=True)
    try:
        await mgr.disconnect("v")
    except Exception:
        pass


asyncio.run(main())
