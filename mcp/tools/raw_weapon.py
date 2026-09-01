"""Push ONE raw $WEAP frame with full tutorial scaffolding. Usage: raw_weapon.py <addr> '<frame>'"""
import asyncio, sys

from bench_common import GSET, PSET as _PSET   # one copy of the arming frames (bench_common.py)

PSET = _PSET.format(pid=0)


async def main() -> None:
    address, frame = sys.argv[1], sys.argv[2]
    toks = frame.split(",")
    mag = toks[17] if len(toks) > 17 else "32"
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    await mgr.connect(address, "raw")
    try:
        for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", GSET, PSET,
                   "$SIR,0,0,,1,0,0,1,,*", "$TID,1,*", frame, "$SPAWN,,*", "$PLAYX,0,*",
                   f"$AMMO,0,{mag},{int(mag) * 6 if mag.isdigit() else 192},1,*", "$BMAP,0,0,,,,,*"]:
            await mgr.send("raw", fr, reply_window_ms=350)
        print("pushed raw frame - gun LIVE:", frame[:80], flush=True)
        await mgr.disconnect("raw")
    finally:
        import contextlib
        with contextlib.suppress(Exception): await mgr.disconnect("raw")



asyncio.run(main())
