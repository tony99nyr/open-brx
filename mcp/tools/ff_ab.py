"""Controlled A/B: does `$GSET` token 1 (friendlyFire) gate whether an emitted IR word registers?

WHY THIS EXISTS (2026-09-07, at the bench). Two sessions shot the same gun with the same emitter on
the same evening. brx-sound landed ~30 of 30 with `$GSET,1,0,...` (friendly fire ON). brx-led landed
about 3 of 18 with `$GSET,0,...` (OFF, which is what a TDM config compiles to), and the 3 that landed
did not reproduce. The only difference visible in the frames is token 1.

That SHOULD NOT matter: the emitted word claims team 0, the gun is on `$TID,1`, so the shot is an
ENEMY shot and friendly fire only gates SAME-team shots. If FF genuinely decides it, our understanding
of the flag is wrong -- and every hosted TDM game we ship sets it to 0, which would mean a whole class
of hits is being silently discarded in real matches. That is worth ten minutes to settle properly
instead of guessing at the bench, which is what wasted the operator's time tonight.

METHOD. One gun, one emitter, nothing moved between arms. Arm + spawn, fire N shots with FF ON,
count `$HIR`; re-arm with FF OFF ONLY (every other frame byte-identical), fire N shots, count `$HIR`.
Alternate the order on a second pass so a drifting bench (battery, aim, temperature) cannot fake the
result -- that is the control the first attempt lacked.

READING IT. Registration is `$HIR`, not damage and not sound: no `$HIR` means the word never landed
(emitter, aim, or polarity); `$HIR` with unchanged `$HP` means it landed and the row did nothing.
Those are different faults and the difference is two seconds per shot.

    python.exe -m brx_mcp.tools.ff_ab <ADDR> [--port COM8] [--shots 6]
"""
from __future__ import annotations

import argparse
import asyncio
import time

from brx_mcp.ble import ConnectionManager
from brx_mcp.irbridge import IRBridge, encode_word
from brx_mcp.mc.compile import golden_bundle

# team 0 shooter, 20 damage, standard proto -- an ENEMY shot against a $TID,1 gun.
SHOT = encode_word(player=42, team=0, damage=20, proto=0)


def head_with_ff(ff: int) -> list[str]:
    """The golden head with `$GSET` token 1 forced, and INDOOR (token 2 = 0) so the only variable is FF."""
    out = []
    for f in golden_bundle()["head"]:
        if f.startswith("$GSET,"):
            t = f.split(",")
            t[1], t[2] = str(ff), "0"
            f = ",".join(t)
        out.append(f)
    return out


SPAWN = ["$PLAYX,0,*", "$SPAWN,,*", "$AMMO,0,32,192,1,*", "$BMAP,0,0,,,,,*"]


async def run_leg(mgr, alias: str, bridge: IRBridge, ff: int, shots: int) -> dict:
    for f in head_with_ff(ff):
        await mgr.send(alias, f)
        await asyncio.sleep(0.12)
    for f in SPAWN:
        await mgr.send(alias, f)
        await asyncio.sleep(0.18)
    await asyncio.sleep(3.0)                      # let the spawn settle before shooting
    seq = mgr.get_events(alias).get("last_seq", 0)
    hirs = hps = 0
    for _ in range(shots):
        bridge.emit(SHOT, 1)
        await asyncio.sleep(1.2)
        ev = mgr.get_events(alias, since_seq=seq)
        seq = ev.get("last_seq", seq)
        for e in ev.get("events", []):
            raw = e.get("raw", "")
            hirs += raw.startswith("$HIR")
            hps += raw.startswith("$HP")
    return {"ff": ff, "shots": shots, "hir": hirs, "hp": hps}


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("address")
    ap.add_argument("--port", default="COM8")
    ap.add_argument("--shots", type=int, default=6)
    a = ap.parse_args()

    bridge = IRBridge(a.port)
    if not bridge.ping():
        raise SystemExit(f"emitter on {a.port} did not answer PING -- fix that before trusting a result")
    mgr = ConnectionManager()
    await mgr.connect(a.address, "ffab")
    try:
        rows = []
        for ff in (1, 0, 0, 1):                   # alternated: a drifting bench cannot fake this
            rows.append(await run_leg(mgr, "ffab", bridge, ff, a.shots))
            print(f"  FF={ff}  {rows[-1]['hir']}/{a.shots} registered ($HIR), {rows[-1]['hp']} $HP")
        on = sum(r["hir"] for r in rows if r["ff"] == 1)
        off = sum(r["hir"] for r in rows if r["ff"] == 0)
        n = a.shots * 2
        print(f"\nFF ON : {on}/{n} registered\nFF OFF: {off}/{n} registered")
        if on and not off:
            print("VERDICT: friendly fire gates registration for this word. Our TDM configs ship FF=0,")
            print("         so this would discard hits in real matches -- file it and re-read the flag.")
        elif on and off:
            print("VERDICT: FF is NOT the cause. Both legs register; look at aim/distance next.")
        else:
            print("VERDICT: nothing registered either way -- the emitter is not reaching a sensor.")
            print("         Check aim (<= 6 ft, at the gun body or a headset dome) before anything else.")
    finally:
        # F11: never leave the gun on a bare $CLEAR. The head above re-armed a full $SIR table and the
        # gun is spawned and hittable, which is the state we want to hand back.
        await mgr.disconnect("ffab")


if __name__ == "__main__":
    asyncio.run(main())
