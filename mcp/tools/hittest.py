"""ONE clean hit test. Owns both guns, one timeline, no background anything.
1. Arms the VICTIM (full known-good config, team 1).
2. Arms the SHOOTER (AR, team 2).
3. Plays a LOUD tick on the shooter = the ONLY go signal.
4. 30s fire window.
5. Reports BOTH sides: shots the shooter actually fired (its mag delta) AND hits the victim registered.
Usage: python hittest.py <shooter_addr> <victim_addr>
"""
import asyncio, sys

from bench_common import AR, arming_frames, connected, sessions_of   # one copy of the arming frames + their ORDER


async def main() -> None:
    shooter, victim = sys.argv[1], sys.argv[2]
    weapon = sys.argv[3] if len(sys.argv) > 3 else AR
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with connected(mgr, (victim, "victim"), (shooter, "shooter")):
        sessions = sessions_of(mgr)

        async def send(alias, fr):
            await mgr.send(alias, fr, reply_window_ms=300)

        async def setup(alias, pid, tid, weapon=None):
            for fr in arming_frames(pid, tid):
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


asyncio.run(main())
