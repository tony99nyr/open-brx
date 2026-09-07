"""Weapon test range: push every catalog weapon to ONE bench gun, ~N seconds each.

Usage: python weapon_range.py <address> [secs_per_weapon=22] [start_index=0]
The operator just keeps firing; a tick sound + reload chain marks each advance.
Ends with a $CLEAR + $SIR restore (F11). Output is ASCII-only (Windows console safe).
"""
import asyncio, sys, time

import bench_common as B


async def main() -> None:
    address = sys.argv[1]
    secs = int(sys.argv[2]) if len(sys.argv) > 2 else 22
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    from brx_mcp.ble import ConnectionManager
    from brx_mcp.mc.compile import Compiler
    c = Compiler()
    weapons = c.weapon_catalog()
    mgr = ConnectionManager()
    await mgr.connect(address, "range")
    print("connected: %s  (%d weapons, %ds each)" % (address, len(weapons), secs), flush=True)

    async def send_all(frames):
        for fr in frames:
            await mgr.send("range", fr, reply_window_ms=350)

    try:
        for i, w in enumerate(weapons):
            if i < start:
                continue
            wire = w.get("desc") or ""
            print("", flush=True)
            print("=== [%2d/%d] %s (%s) t=%s" % (i + 1, len(weapons), w["name"], w["weapon_id"], time.strftime("%H:%M:%S")), flush=True)
            frames = c.tutorial_frames(w, "indoor")
            await send_all(frames)
            await mgr.send("range", "$PLAY,U16,4,6,,,,,*", reply_window_ms=350)  # advance tick
            print("    pushed - FIRE NOW", flush=True)
            await asyncio.sleep(secs)
        print("", flush=True)
        print("range complete - clearing", flush=True)
        # never sign off on a bare $CLEAR: it wipes the $SIR table and the next run gets a gun
        # that silently ignores every hit while reporting healthy (F11).
        await send_all(["$PLAYX,0,*"] + B.teardown_frames())
    finally:
        try:
            await mgr.disconnect("range")
        except Exception:
            pass


asyncio.run(main())
