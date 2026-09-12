"""Send raw frames to one tagger. Usage: python sendframes.py <address> '<frame1>' ['<frame2>' ...]"""
import asyncio, sys

from bench_common import connected   # one copy of the connect/teardown ritual (bench_common.py)


async def main() -> None:
    address, frames = sys.argv[1], sys.argv[2:]
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with connected(mgr, (address, "bench")):
        for fr in frames:
            reply = await mgr.send("bench", fr, reply_window_ms=600)
            print(">>", fr, "| reply:", reply if reply else "(none)", flush=True)


asyncio.run(main())
