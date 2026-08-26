"""ONE clean hit test. Owns both guns, one timeline, no background anything.
1. Arms the VICTIM (full known-good config, team 1).
2. Arms the SHOOTER (AR, team 2).
3. Plays a LOUD tick on the shooter = the ONLY go signal.
4. 30s fire window.
5. Reports BOTH sides: shots the shooter actually fired (its mag delta) AND hits the victim registered.
Usage: python hittest.py <shooter_addr> <victim_addr>
"""
import asyncio, sys

AR = "$WEAP,0,,100,0,0,9,0,,,,,,,,100,850,32,384,1400,0,0,100,100,,0,,,R01,,,,D04,D03,D02,D18,,,,,32,192,75,*"
PSET = "$PSET,{pid},0,45,70,70,50,,H44,JAD,V33,V3I,V3C,V3G,V3E,V37,H06,H55,H13,H21,H02,U15,W71,A10,*"
SIRS = ["$SIR,0,0,,1,0,0,1,,*", "$SIR,0,1,,36,0,0,1,,*", "$SIR,0,3,,37,0,0,1,,*", "$SIR,10,0,X13,1,0,100,2,60,*",
        "$SIR,13,0,H50,1,0,0,1,,*", "$SIR,13,1,H57,1,0,0,1,,*", "$SIR,13,3,H49,1,0,100,0,60,*",
        "$SIR,6,0,H02,1,0,90,1,40,*", "$SIR,8,0,,38,0,0,1,,*", "$SIR,9,3,,24,10,0,,,*"]


async def main() -> None:
    shooter, victim = sys.argv[1], sys.argv[2]
    weapon = sys.argv[3] if len(sys.argv) > 3 else AR
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    print("connecting victim...", flush=True); await mgr.connect(victim, "victim")
    print("connecting shooter...", flush=True); await mgr.connect(shooter, "shooter")
    try:
        sessions = next((getattr(mgr, a) for a in ("sessions", "_sessions") if isinstance(getattr(mgr, a, None), dict)), {})

        async def send(alias, fr):
            await mgr.send(alias, fr, reply_window_ms=300)

        async def setup(alias, pid, tid, weapon=None):
            for fr in ["$VOL,60,0,*", "$CLEAR,*", "$START,*", "$GSET,0,0,1,0,1,0,50,1,*", PSET.format(pid=pid)] + SIRS + [f"$TID,{tid},*"]:
                await send(alias, fr)
            if weapon:
                await send(alias, weapon)
            await send(alias, "$SPAWN,,*"); await send(alias, "$PLAYX,0,*")
            await send(alias, "$AMMO,0,32,192,1,*"); await send(alias, "$BMAP,0,0,,,,,*")

        await setup("victim", 40, 1)
        print("victim armed", flush=True)
        await setup("shooter", 5, 2, weapon)
        print("shooter armed", flush=True)
        vmark = len(sessions["victim"].buffer)
        smark = len(sessions["shooter"].buffer)
        await send("shooter", "$PLAY,U16,4,6,,,,,*")
        print("GO GO GO - FIRE AT THE VICTIM (30s)", flush=True)
        await asyncio.sleep(30)

        def frames(alias, mark, pat):
            out = []
            for e in list(sessions[alias].buffer)[mark:]:
                d = e.to_dict() if hasattr(e, "to_dict") else e
                raw = d.get("raw", "")
                if any(p in raw for p in pat):
                    out.append(raw)
            return out
        shots = frames("shooter", smark, ("$ALCD",))
        hits = frames("victim", vmark, ("$HIR", "$HP"))
        mags = [int(f.split(",")[1]) for f in shots if f.split(",")[1].isdigit()]
        fired = (mags[0] - mags[-1]) if len(mags) >= 2 else 0
        print("SHOOTER: %d ALCD frames, mag %s -> %s (= %d shots fired)" % (len(shots), mags[0] if mags else "?", mags[-1] if mags else "?", fired), flush=True)
        print("VICTIM: %d hit frames" % len(hits), flush=True)
        for h in hits[:6]:
            print("   ", h, flush=True)
        await mgr.disconnect("shooter"); await mgr.disconnect("victim")
    finally:
        import contextlib
        with contextlib.suppress(Exception): await mgr.disconnect("shooter")
        with contextlib.suppress(Exception): await mgr.disconnect("victim")



asyncio.run(main())
