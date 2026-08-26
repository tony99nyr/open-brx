"""Send raw frames to one tagger. Usage: python sendframes.py <address> '<frame1>' ['<frame2>' ...]"""
import asyncio, sys


async def main() -> None:
    address, frames = sys.argv[1], sys.argv[2:]
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(address, "bench")
    try:
        for fr in frames:
            reply = await mgr.send("bench", fr, reply_window_ms=600)
            print(">>", fr, "| reply:", reply if reply else "(none)", flush=True)
        await mgr.disconnect("bench")
    finally:
        import contextlib
        with contextlib.suppress(Exception): await mgr.disconnect("bench")



asyncio.run(main())
