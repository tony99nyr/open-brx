"""Fire-mode probe: push ONE weapon with token overrides, leave the gun live.

Usage: python firemode_probe.py <address> <weapon_id> [idx=val ...]
e.g.   python firemode_probe.py FE:.. sniper_rifle 20=2
Token idx is the raw comma-split index of the $WEAP frame.
"""
import asyncio, sys


async def main() -> None:
    address, wid = sys.argv[1], sys.argv[2]
    overrides = [a.split("=") for a in sys.argv[3:]]
    from brx_mcp.ble import ConnectionManager
    from brx_mcp.mc.compile import Compiler
    c = Compiler()
    w = next(x for x in c.weapon_catalog() if x["weapon_id"] == wid)
    frames = c.tutorial_frames(w, "indoor")
    for i, fr in enumerate(frames):
        if fr.startswith("$WEAP,"):
            toks = fr.split(",")
            for idx, val in overrides:
                toks[int(idx)] = val
            frames[i] = ",".join(toks)
            print("weapon frame:", frames[i], flush=True)
    mgr = ConnectionManager()
    await mgr.connect(address, "probe")
    for fr in frames:
        await mgr.send("probe", fr, reply_window_ms=350)
    print("pushed %s with %s - gun is LIVE, test the trigger" % (wid, sys.argv[3:] or "no overrides"), flush=True)
    await mgr.disconnect("probe")   # config survives the BLE drop (protocol 7r)


asyncio.run(main())
