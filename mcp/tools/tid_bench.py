"""Handoff experiment 4: $TID team range. Phases set (shooterTID, victimTID); a registered $HIR
means cross-team damage applied; silence on same-team = FF correctly off.
Usage: python tid_bench.py <shooter> <victim> [secs=12]
"""
import asyncio, sys, time

from bench_common import AR, arming_frames   # one copy of the arming frames + their ORDER
# (shooter TID, victim TID, expectation)
PHASES = [(4, 5, "expect HIT"), (4, 4, "expect NO hit (same team, FF off)"),
          (30, 31, "expect HIT"), (62, 63, "expect HIT"), (63, 63, "expect NO hit"),
          (100, 101, "beyond 6 bits - behavior unknown")]


async def main() -> None:
    shooter, victim = sys.argv[1], sys.argv[2]
    secs = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    from brx_mcp.ble import ConnectionManager
    mgr = ConnectionManager()
    print("connecting shooter...", flush=True); await mgr.connect(shooter, "shooter")
    print("connecting victim...", flush=True); await mgr.connect(victim, "victim")
    sessions = next((getattr(mgr, a) for a in ("sessions", "_sessions") if isinstance(getattr(mgr, a, None), dict)), {})

    async def send(alias, fr):
        await mgr.send(alias, fr, reply_window_ms=300)

    async def setup(alias, pid, tid, weapon=None):
        for fr in arming_frames(pid, tid):
            await send(alias, fr)
        if weapon:
            await send(alias, weapon)
        await send(alias, "$SPAWN,,*"); await send(alias, "$PLAYX,0,*")
        await send(alias, "$AMMO,0,32,192,1,*"); await send(alias, "$BMAP,0,0,,,,,*")

    for stid, vtid, note in PHASES:
        await setup("shooter", 5, stid, AR)
        await setup("victim", 40, vtid)
        mark = len(sessions["victim"].buffer) if "victim" in sessions else 0
        await send("shooter", "$PLAY,U16,4,6,,,,,*")
        print("", flush=True)
        print("=== shooter TID %d vs victim TID %d (%s)  t=%s" % (stid, vtid, note, time.strftime("%H:%M:%S")), flush=True)
        await asyncio.sleep(secs)
        hits = 0
        for e in list(sessions["victim"].buffer)[mark:] if "victim" in sessions else []:
            d = e.to_dict() if hasattr(e, "to_dict") else e
            raw = d.get("raw", "")
            if "$HIR" in raw:
                hits += 1; print("    victim<<", raw, flush=True)
        print("    RESULT: %s" % ("HIT registered" if hits else "no hit"), flush=True)
    print("", flush=True); print("done - clearing", flush=True)
    for a in ("shooter", "victim"):
        await send(a, "$PLAYX,0,*"); await send(a, "$CLEAR,*")
    await mgr.disconnect("shooter"); await mgr.disconnect("victim")


asyncio.run(main())
