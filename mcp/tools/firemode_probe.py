"""Fire-mode probe: push ONE weapon with token overrides, leave the gun live.

Usage: python firemode_probe.py <address> <weapon_id> [idx=val ...]
e.g.   python firemode_probe.py FE:.. sniper_rifle 21=0     # doc t20 fire mode -> full auto

`idx` is the RAW comma-split index of the frame, and `toks[0]` is the command word `$WEAP`, so
**raw = doc token + 1** (protocol/brx-protocol.md: "the bench tool prints raw 1-indexed positions").
Doc t20 (fire mode) is raw 21; t21/t22 (accuracy) are raw 22/23; t6 (crit chance) is raw 7; the
secondary-fire block t7-t11 is raw 8-12. The old example here said `20=2`, which is doc t19 -- one
token low, and t19 is a token we cannot even name. This is the off-by-one that once wrote the rate
of fire into the swap-delay token and shipped every weapon at 10 shots/s.

The frame is PRINTED before it is sent: read it against the reference row in
docs/reference/weapons.md and confirm the value moved where you meant it to, BEFORE pulling the
trigger. A probe aimed at the wrong token reads exactly like an inert token.
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
