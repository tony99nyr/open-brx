"""How fast can we send frames before the gun starts DROPPING them? Measured by its own echoes.

Tony's hypothesis, 2026-09-02: the commands may not be synchronous and may need spacing -- which he
also raised this morning as *"maybe your setup commands are too fast or out of order"*. It fits
things nothing else tonight explains: a headset wedged showing DEAD while the gun reported alive, and
state that gets stuck after bursts of frames but is fine after a single one. It also matches the
community note that BRX's serial parser needs ~5 ms PER CHARACTER (`community-notes.md`), which for a
40-character frame is ~200 ms -- far longer than the 120 ms our arming ritual currently uses between
frames, and far longer than the 350 ms respawn burst.

The gun ECHOES every command it accepts. So this needs no camera and no operator: send N identical
harmless frames at a given spacing, count the echoes, and the echo rate IS the acceptance rate.

`$VOL` is the probe because it is idempotent, has no game-state side effect, and is the same length
class as the frames the arming ritual actually sends. Volume is restored at the end.

If the fast rows drop echoes and the slow rows do not, MC's frame pacing is a real bug -- every
FrameBundle it compiles is sent as a burst, and a dropped $PSET or $TID would silently mis-configure
a player for a whole match.

Usage: python frame_spacing.py <addr> [n_per_rate=20]
"""
import asyncio
import sys

import bench_common as B

DELAYS = [0.02, 0.05, 0.10, 0.15, 0.20, 0.30, 0.50]
PROBE = "$VOL,60,0,*"


async def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    addr = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    async with B.connected(mgr, (addr, "v")):
        print(f"   probe = {PROBE}   {n} frames per rate\n")
        print(f"   {'gap':>7s}  {'echoes':>8s}  {'rate':>6s}")
        rows = []
        for d in DELAYS:
            # settle, then mark: anything after this belongs to this rate's burst
            await asyncio.sleep(1.5)
            mark = mgr.get_events("v", since_seq=0).get("last_seq", 0)
            for _ in range(n):
                await mgr.send("v", PROBE, reply_window_ms=0)
                await asyncio.sleep(d)
            await asyncio.sleep(2.0)          # let every late echo arrive before counting
            evs = [e.get("raw", "").strip() for e in
                   mgr.get_events("v", since_seq=mark).get("events", []) if isinstance(e, dict)]
            got = sum(1 for e in evs if e.startswith("$VOL"))
            rows.append((d, got))
            print(f"   {d*1000:5.0f}ms  {got:4d}/{n:<3d}  {100.0*got/n:5.0f}%", flush=True)
        await mgr.send("v", "$VOL,60,0,*", reply_window_ms=200)

    print()
    clean = [d for d, g in rows if g >= n]
    if clean and clean[0] > DELAYS[0]:
        print(f"   *** frames are DROPPED below ~{clean[0]*1000:.0f}ms spacing.")
        print(f"   Our arming ritual uses 120ms and the respawn burst 350ms -- check both against")
        print("   that number. A dropped $PSET or $TID would silently mis-configure a player.")
    elif clean:
        print("   No drops at any rate tested, including the fastest. Frame pacing is NOT the")
        print("   problem -- record that as tested, and do not keep it on the suspect list.")
    else:
        print("   Echoes were lost at EVERY rate, including the slowest. That means the echo is not")
        print("   a reliable acceptance signal, so this test cannot answer the question -- say so")
        print("   rather than reading the numbers as a rate curve.")


if __name__ == "__main__":
    asyncio.run(main())
