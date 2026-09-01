"""MINIMAL victim config: fewest frames possible so a flaky link can finish the burst.
Config survives the BLE drop - the gun stays a working target afterward."""
import asyncio, sys

from bench_common import PSET, SIR_PLAIN, connected   # one copy of the arming frames (bench_common.py)


async def main() -> None:
    victim = sys.argv[1]
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    # `connected()` disconnects on the way out however this ends — a raise or a ^C used to leave the
    # tagger holding an open BLE link, and the next run could not connect until it was power-cycled.
    async with connected(mgr, (victim, "v")):
        print("connected - pushing minimal config", flush=True)
        for fr in ["$CLEAR,*", "$START,*", PSET.format(pid=40), SIR_PLAIN, "$TID,1,*", "$SPAWN,,*"]:
            await mgr.send("v", fr, reply_window_ms=250)
            print("  ok:", fr.split(",")[0], flush=True)
        print("VICTIM CONFIGURED + SPAWNED - link may now drop freely", flush=True)


asyncio.run(main())
